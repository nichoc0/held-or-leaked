"""
Bastion control-plane relay (single-node MVP).

The optimal transcript source is Claude Code's own structured JSONL session file
(~/.claude/projects/<proj>/<session>.jsonl), NOT a scraped tmux pane. This service:
  - discovers claude sessions and which are live (by file mtime),
  - normalizes each JSONL event into a stable "turn" schema the clip UI renders
    (thinking / text / tool_use / tool_result / system), with subagent attribution
    via isSidechain,
  - streams new turns over a WebSocket by tailing the file from a byte offset
    (sub-second, nothing scrolls off).

This is the read path (admin + client both consume it). The write path ("talk to
the session") and multi-node bridging land next; kept out of here so this stays a
clean, testable spine.
"""
from __future__ import annotations
import json, os, glob, time, asyncio, subprocess
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from clerk_auth import require_admin

PROJECTS = Path(os.environ.get("CLAUDE_PROJECTS", str(Path.home() / ".claude/projects")))
LIVE_WINDOW_S = 120          # a session is "live" if its jsonl was written this recently
POLL_S = 0.5                 # tail cadence — sub-second, effectively live

app = FastAPI(title="bastion-relay")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

# ---------------------------------------------------------------- normalization

def _short(v, n=4000):
    if isinstance(v, (dict, list)):
        v = json.dumps(v, ensure_ascii=False)
    if isinstance(v, str) and len(v) > n:
        return v[:n] + f"\n… (+{len(v)-n} chars)"
    return v

def normalize(obj: dict) -> list[dict]:
    """One raw JSONL object -> zero or more normalized turns."""
    t = obj.get("type")
    msg = obj.get("message") or {}
    role = msg.get("role") or ("assistant" if t == "assistant" else "user" if t == "user" else t)
    ts = obj.get("timestamp")
    uuid = obj.get("uuid")
    sidechain = bool(obj.get("isSidechain"))
    # agent identity: sidechain turns belong to a subagent; the sidechain root uuid
    # groups a given subagent's turns. Main-session turns are the orchestrator.
    agent = "subagent" if sidechain else "orchestrator"
    base = {"uuid": uuid, "ts": ts, "role": role, "agent": agent,
            "sidechain": sidechain, "parent": obj.get("parentUuid")}
    out = []

    if t == "system":
        out.append({**base, "kind": "system", "text": _short(obj.get("content") or obj.get("subtype") or "")})
        return out

    content = msg.get("content")
    if isinstance(content, str):
        content = [{"type": "text", "text": content}]
    if not isinstance(content, list):
        return out

    for b in content:
        if not isinstance(b, dict):
            continue
        bt = b.get("type")
        if bt == "thinking":
            txt = b.get("thinking") or ""
            if txt.strip():
                out.append({**base, "kind": "thinking", "text": _short(txt)})
        elif bt == "text":
            # user-role text with isMeta is injected context/tool-skill boilerplate → mark as meta
            meta = bool(obj.get("isMeta"))
            if role == "user" and meta:
                out.append({**base, "kind": "meta", "text": _short(b.get("text") or "")})
            elif (b.get("text") or "").strip():
                out.append({**base, "kind": "text", "text": _short(b.get("text") or "")})
        elif bt == "tool_use":
            out.append({**base, "kind": "tool_use", "tool_id": b.get("id"),
                        "tool_name": b.get("name"), "tool_input": _short(b.get("input"), 2000)})
        elif bt == "tool_result":
            c = b.get("content")
            if isinstance(c, list):  # content can be a list of {type,text}
                c = "\n".join(x.get("text", "") for x in c if isinstance(x, dict))
            out.append({**base, "kind": "tool_result", "tool_id": b.get("tool_use_id"),
                        "is_error": bool(b.get("is_error")), "text": _short(c)})
    return out

# ---------------------------------------------------------------- discovery

RECENT_WINDOW_S = 24 * 3600  # default listing = sessions touched in the last day

def _resolve_cwd_ts(path: Path):
    """Scan the first few lines for cwd + start timestamp (head line sometimes lacks cwd)."""
    cwd, first_ts = None, None
    try:
        with path.open("rb") as fh:
            for _ in range(20):
                line = fh.readline()
                if not line:
                    break
                try:
                    o = json.loads(line)
                except Exception:
                    continue
                first_ts = first_ts or o.get("timestamp")
                if o.get("cwd"):
                    cwd = o["cwd"]
                    break
    except OSError:
        pass
    return cwd, first_ts

def tmux_sessions() -> dict[str, str]:
    """{session_name: pane_cwd} for every live tmux session (the input channel)."""
    try:
        out = subprocess.run(["tmux", "ls", "-F", "#{session_name}"],
                             capture_output=True, text=True, timeout=3).stdout
    except Exception:
        return {}
    m = {}
    for name in out.split():
        try:
            cwd = subprocess.run(["tmux", "display-message", "-p", "-t", name, "#{pane_current_path}"],
                                capture_output=True, text=True, timeout=3).stdout.strip()
            if cwd:
                m[name] = cwd
        except Exception:
            pass
    return m

def _match_tmux(cwd: str | None, tmap: dict[str, str]) -> str | None:
    """Map a session's cwd to its tmux session name (exact cwd match, prefer bastion-*)."""
    if not cwd:
        return None
    hits = [n for n, c in tmap.items() if c.rstrip("/") == cwd.rstrip("/")]
    if not hits:
        return None
    hits.sort(key=lambda n: (not n.startswith("bastion-"), n))  # prefer bastion-named
    return hits[0]

def _friendly_name(cwd: str | None, project: str, sid: str) -> str:
    if cwd:
        base = Path(cwd).name
        # a bare home-dir session isn't descriptive — label it as a main REPL
        if str(cwd).rstrip("/") == str(Path.home()).rstrip("/"):
            return f"main · {sid[:6]}"
        return base
    return project.lstrip("-").replace("-", "/")

def _session_meta(path: Path, enrich: bool = True, tmap: dict | None = None) -> dict | None:
    try:
        st = path.stat()
    except OSError:
        return None
    now = time.time()
    m = {
        "id": path.stem,
        "project": path.parent.name,
        "path": str(path),
        "size": st.st_size,
        "mtime": st.st_mtime,
        "live": (now - st.st_mtime) < LIVE_WINDOW_S,
        "recent": (now - st.st_mtime) < RECENT_WINDOW_S,
    }
    if enrich:
        cwd, first_ts = _resolve_cwd_ts(path)
        m["cwd"] = cwd
        m["started"] = first_ts
        m["name"] = _friendly_name(cwd, m["project"], m["id"])
        m["bastion"] = bool(cwd and "bastion-red/engagements" in cwd)
        # the tmux session that owns this cwd = the input channel ("talk to it")
        m["tmux"] = _match_tmux(cwd, tmap if tmap is not None else tmux_sessions())
        m["talkable"] = bool(m["tmux"])
    return m

def list_sessions(scope: str = "recent") -> list[dict]:
    """scope: 'live' (writing now) | 'recent' (last 24h, default) | 'all'."""
    metas = []
    for p in glob.glob(str(PROJECTS / "*" / "*.jsonl")):
        m = _session_meta(Path(p), enrich=False)  # cheap stat-only pass first
        if not m:
            continue
        if scope == "live" and not m["live"]:
            continue
        if scope == "recent" and not m["recent"]:
            continue
        metas.append(m)
    metas.sort(key=lambda s: s["mtime"], reverse=True)
    tmap = tmux_sessions()  # one tmux scan for the whole set
    return [_session_meta(Path(m["path"]), enrich=True, tmap=tmap) for m in metas]

def _find(session_id: str) -> Path | None:
    hits = glob.glob(str(PROJECTS / "*" / f"{session_id}.jsonl"))
    return Path(hits[0]) if hits else None

def read_turns(path: Path, from_offset: int = 0):
    """Yield (new_offset, [turns]) by reading complete lines from a byte offset."""
    turns = []
    with path.open("rb") as fh:
        fh.seek(from_offset)
        data = fh.read()
        offset = from_offset + len(data)
    # only parse whole lines; stash a trailing partial by rewinding offset
    text = data.decode("utf-8", errors="replace")
    if text and not text.endswith("\n"):
        last_nl = text.rfind("\n")
        if last_nl == -1:
            return from_offset, []
        offset = from_offset + len(text[: last_nl + 1].encode("utf-8"))
        text = text[: last_nl + 1]
    for line in text.splitlines():
        if not line.strip():
            continue
        try:
            turns.extend(normalize(json.loads(line)))
        except Exception:
            continue
    return offset, turns

# ---------------------------------------------------------------- API

@app.get("/api/sessions")
def sessions(scope: str = "recent", authorization: str = Header(None)):
    require_admin(authorization)   # admin-only; fail-open only in local dev
    return {"sessions": list_sessions(scope)}

@app.get("/api/sessions/{session_id}/history")
def history(session_id: str, limit: int = 400, authorization: str = Header(None)):
    require_admin(authorization)
    p = _find(session_id)
    if not p:
        raise HTTPException(404, "session not found")
    _, turns = read_turns(p, 0)
    return {"id": session_id, "turns": turns[-limit:], "total": len(turns)}

@app.websocket("/api/sessions/{session_id}/stream")
async def stream(ws: WebSocket, session_id: str, token: str = None):
    # browsers can't set WS headers → token rides as ?token=<clerk jwt>
    try:
        require_admin(token)
    except HTTPException as e:
        await ws.close(code=4401)
        return
    await ws.accept()
    p = _find(session_id)
    if not p:
        await ws.send_json({"kind": "error", "text": "session not found"})
        await ws.close()
        return
    # 1) send recent history, 2) then tail forever
    offset, turns = read_turns(p, 0)
    await ws.send_json({"kind": "snapshot", "turns": turns[-400:], "live": (time.time() - p.stat().st_mtime) < LIVE_WINDOW_S})
    try:
        while True:
            await asyncio.sleep(POLL_S)
            if not p.exists():
                continue
            new_offset, new_turns = read_turns(p, offset)
            if new_turns:
                offset = new_offset
                await ws.send_json({"kind": "append", "turns": new_turns,
                                    "live": (time.time() - p.stat().st_mtime) < LIVE_WINDOW_S})
            else:
                offset = new_offset
    except WebSocketDisconnect:
        return

@app.get("/api/health")
def health():
    return {"ok": True, "projects": str(PROJECTS), "sessions": len(list_sessions())}
