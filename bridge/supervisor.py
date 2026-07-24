"""
Agent supervisor — the robust substrate that replaces tmux.

The bridge spawns each agent as the REAL interactive `claude` REPL (never `-p`,
which refuses adversarial work) under a pseudo-terminal the bridge owns via
pty.fork(). The child gets its own session (setsid, done by pty.fork), so it can
outlive a bridge restart and be re-adopted. We drive it by controlling:
  - a fixed --session-id  → we know the JSONL transcript path immediately
  - the PTY master fd      → input ("talk to it") is os.write(master, text+CR)
Read path is the JSONL (see relay.py); this owns spawn / input / lifecycle.

Registry (agents.json) persists {session_id -> name,cwd,pid,pgid} so a restarted
bridge re-adopts live children and --resumes dead ones.
"""
from __future__ import annotations
import os, pty, json, time, fcntl, signal, errno, glob, struct, termios, uuid as uuidlib
from pathlib import Path

HOME = Path.home()
PROJECTS = HOME / ".claude/projects"
REG_PATH = Path(__file__).with_name("agents.json")
CLAUDE = os.environ.get("CLAUDE_BIN", "claude")

def _nonblock(fd):
    fl = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)

def _drain(fd, cap=200_000):
    out = b""
    try:
        while len(out) < cap:
            chunk = os.read(fd, 8192)
            if not chunk:
                break
            out += chunk
    except (BlockingIOError, OSError):
        pass
    return out

def _alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except OSError as e:
        return e.errno == errno.EPERM

def find_transcript(session_id):
    hits = glob.glob(str(PROJECTS / "*" / f"{session_id}.jsonl"))
    return hits[0] if hits else None


class AgentSupervisor:
    def __init__(self):
        self.agents: dict[str, dict] = {}   # session_id -> {name,cwd,pid,master,pgid,started}
        self._load()

    # ------------------------------------------------------------ persistence
    def _load(self):
        if REG_PATH.exists():
            try:
                for a in json.loads(REG_PATH.read_text()):
                    # re-adopt only if the process is still alive (master fd is lost on restart)
                    if _alive(a["pid"]):
                        a["master"] = None  # fd doesn't survive; input needs respawn/resume
                        self.agents[a["session_id"]] = a
            except Exception:
                pass

    def _save(self):
        data = [{k: v for k, v in a.items() if k != "master"} for a in self.agents.values()]
        REG_PATH.write_text(json.dumps(data, indent=2))

    # ------------------------------------------------------------ spawn / drive
    def spawn(self, name: str, cwd: str, session_id: str | None = None,
              extra_args: list[str] | None = None) -> dict:
        cwd = str(cwd)
        session_id = session_id or str(uuidlib.uuid4())
        args = [CLAUDE, "--dangerously-skip-permissions", "--session-id", session_id]
        args += (extra_args or [])
        pid, master = pty.fork()
        if pid == 0:  # child — becomes the agent
            try:
                os.chdir(cwd)
                # env hygiene: if the bridge itself was launched from a claude
                # session, the child inherits CLAUDE_CODE_CHILD_SESSION which
                # DISABLES transcript writing → no JSONL. Force persistence.
                os.environ.pop("CLAUDE_CODE_CHILD_SESSION", None)
                os.environ["CLAUDE_CODE_FORCE_SESSION_PERSISTENCE"] = "1"
                os.environ["CLAUDE_CODE_STOP_HOOK_BLOCK_CAP"] = os.environ.get(
                    "CLAUDE_CODE_STOP_HOOK_BLOCK_CAP", "1000")
                os.environ.setdefault("TERM", "xterm-256color")
                os.execvp(CLAUDE, args)
            except Exception as e:
                os.write(2, f"exec failed: {e}\n".encode())
                os._exit(127)
        # parent — the bridge owns `master`; give the TUI a real window size
        try:
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
        except OSError:
            pass
        _nonblock(master)
        rec = {"session_id": session_id, "name": name, "cwd": cwd, "pid": pid,
               "pgid": pid, "master": master, "started": time.time()}
        self.agents[session_id] = rec
        self._save()
        return rec

    def send(self, session_id: str, text: str) -> bool:
        a = self.agents.get(session_id)
        if not a or a.get("master") is None:
            return False
        try:
            os.write(a["master"], (text + "\r").encode())
            return True
        except OSError:
            return False

    def read(self, session_id: str) -> bytes:
        a = self.agents.get(session_id)
        return _drain(a["master"]) if a and a.get("master") is not None else b""

    def stop(self, session_id: str):
        a = self.agents.pop(session_id, None)
        if not a:
            return
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(a["pgid"], sig)
            except OSError:
                try:
                    os.kill(a["pid"], sig)
                except OSError:
                    pass
            if not _alive(a["pid"]):
                break
            time.sleep(0.8)
        self._save()

    def list(self) -> list[dict]:
        for a in list(self.agents.values()):
            a["alive"] = _alive(a["pid"])
            a["transcript"] = find_transcript(a["session_id"])
        return [{k: v for k, v in a.items() if k != "master"} for a in self.agents.values()]


# ------------------------------------------------------------------ self-test
def _validate():
    """Prove interactive claude runs under a bridge-owned PTY + accepts input + writes JSONL."""
    sup = AgentSupervisor()
    ws = "/tmp/bastion-pty-test"
    sid = str(uuidlib.uuid4())
    print(f"[1] spawning interactive claude under PTY  (session {sid[:8]}, cwd {ws})")
    rec = sup.spawn("pty-selftest", ws, session_id=sid)
    print(f"    pid={rec['pid']} master_fd={rec['master']}")
    # let the TUI boot, clear any startup prompts (trust dir / effort default)
    for i in range(8):
        time.sleep(1.5)
        buf = sup.read(sid)
        if buf:
            snippet = buf.decode("utf-8", "replace")
            low = snippet.lower()
            if any(k in low for k in ("do you trust", "yes, proceed", "❯ 1.", "accept", "press enter")):
                sup.send(sid, "")  # Enter to accept
        if find_transcript(sid):
            break
    tr = find_transcript(sid)
    print(f"[2] transcript created: {tr is not None}  ({tr})")
    print("[3] sending a message to it via the PTY…")
    sup.send(sid, "Reply with exactly: PTY_OK and nothing else.")
    ok = False
    for i in range(20):
        time.sleep(1.5)
        sup.read(sid)  # drain
        if tr and os.path.exists(tr):
            txt = Path(tr).read_text(errors="replace")
            if "PTY_OK" in txt and '"role":"assistant"' in txt.replace(" ", ""):
                ok = True
                break
        tr = tr or find_transcript(sid)
    print(f"[4] agent responded through the PTY: {ok}")
    print("[5] stopping agent…")
    sup.stop(sid)
    time.sleep(1)
    print(f"    alive after stop: {_alive(rec['pid'])}")
    print("\nRESULT:", "PASS — bridge-owned PTY substrate works" if (tr and ok)
          else "PARTIAL — see above (transcript={}, responded={})".format(bool(tr), ok))


if __name__ == "__main__":
    _validate()
