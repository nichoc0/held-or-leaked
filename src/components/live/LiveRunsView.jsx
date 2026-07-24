import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk-real';
import LiveTranscript from './LiveTranscript';

// Mission control: tiling workspace of live Claude sessions. Left rail groups
// Active (live + Bastion + master) vs Idle. Click to tile; each tile is a live
// Claude Code terminal with a composer to type into the session.

function cols(n) {
  if (n <= 1) return 1;
  if (n <= 4) return 2;
  if (n <= 9) return 3;
  return 4;
}

function SessionRow({ s, open, toggle }) {
  const isOpen = open.includes(s.id);
  const label = s.master ? 'masternicho' : s.name;
  return (
    <button onClick={() => toggle(s.id)}
      className={`w-full text-left px-3 py-1.5 border-l-2 transition-colors ${isOpen ? 'border-slate-400 bg-slate-200' : 'border-transparent hover:bg-slate-100'}`}>
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${s.live ? 'bg-slate-600' : 'bg-slate-300'}`} />
        <span className={`text-[12px] truncate ${s.master ? 'text-slate-900 font-semibold' : 'text-slate-700'}`}>{label}</span>
        {s.bastion && !s.master && <span className="text-[9px] text-slate-500 shrink-0">bastion</span>}
      </div>
      <div className="text-[9px] font-mono text-slate-500 mt-0.5">{s.id.slice(0, 8)} · {Math.round((s.size || 0) / 1024)}KB</div>
    </button>
  );
}

function Composer({ sessionId, talkable, api, getToken }) {
  const [val, setVal] = useState('');
  const [err, setErr] = useState(null);
  const send = async () => {
    if (!val.trim()) return;
    const text = val;
    setVal('');
    setErr(null);
    try {
      const token = await getToken().catch(() => null);
      const r = await fetch(`${api}/api/sessions/${sessionId}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) setErr(r.status === 409 ? 'read-only (not in a tmux)' : `send ${r.status}`);
    } catch { setErr('send failed'); }
  };
  return (
    <div className="shrink-0 border-t border-slate-300 bg-white px-2 py-1 flex items-center gap-1">
      <span className="text-slate-400 font-mono text-[12px]">{'>'}</span>
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        placeholder={talkable ? 'type to the session, enter to send' : 'read-only (not in a tmux)'}
        disabled={!talkable}
        className="flex-1 bg-transparent text-slate-800 text-[12px] font-mono outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
      />
      {err && <span className="text-[10px] text-slate-400 font-mono">{err}</span>}
    </div>
  );
}

export default function LiveRunsView() {
  const { getToken } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [open, setOpen] = useState([]);
  const [err, setErr] = useState(null);
  const [showIdle, setShowIdle] = useState(false);
  const autoDone = useRef(false);
  const API = import.meta.env.VITE_API_URL || '';

  async function refresh() {
    try {
      const token = await getToken().catch(() => null);
      const r = await fetch(`${API}/api/sessions?scope=recent`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!r.ok) { setErr(`relay ${r.status}${r.status === 403 ? ' — not admin' : r.status === 401 ? ' — token rejected' : ''}`); return; }
      const d = await r.json();
      setSessions(d.sessions || []);
      setErr(null);
    } catch { setErr('relay unreachable'); }
  }
  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, []);

  const { active, idle } = useMemo(() => {
    const rank = (s) => (s.master ? 0 : s.live && s.bastion ? 1 : s.bastion ? 2 : s.live ? 3 : 9);
    const sorted = [...sessions].sort((a, b) => rank(a) - rank(b) || b.mtime - a.mtime);
    return { active: sorted.filter((s) => rank(s) < 9), idle: sorted.filter((s) => rank(s) === 9) };
  }, [sessions]);

  // auto-tile the master + live Bastion sessions once
  useEffect(() => {
    if (!autoDone.current && active.length) {
      autoDone.current = true;
      setOpen(active.filter((s) => s.master || (s.live && s.bastion)).slice(0, 4).map((s) => s.id));
    }
  }, [active]);

  const toggle = (id) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  const byId = (id) => sessions.find((s) => s.id === id);

  return (
    <div className="flex gap-2 h-[calc(100vh-150px)] min-h-[520px] -mx-4">
      <div className="w-56 shrink-0 flex flex-col border-r border-slate-200 overflow-hidden">
        <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-600 border-b border-slate-200 flex items-center">
          mission control
          {err && <span className="text-rose-500 ml-auto normal-case font-mono text-[9px]">{err}</span>}
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 pt-2 pb-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-600">active · {active.length}</div>
          {active.map((s) => <SessionRow key={s.id} s={s} open={open} toggle={toggle} />)}
          {active.length === 0 && !err && <div className="px-3 py-1 text-[10px] text-slate-500">none</div>}
          {idle.length > 0 && (
            <>
              <div className="px-3 pt-3 pb-1.5">
                <button onClick={() => setShowIdle((v) => !v)}
                  className="w-full px-2 py-1 rounded border border-slate-300 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors">
                  {showIdle ? 'hide idle' : `all sessions (${active.length + idle.length})`}
                </button>
              </div>
              {showIdle && (
                <>
                  <div className="px-3 pb-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">idle · {idle.length}</div>
                  {idle.map((s) => <SessionRow key={s.id} s={s} open={open} toggle={toggle} />)}
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 p-1">
        {open.length === 0 ? (
          <div className="h-full grid place-items-center text-slate-600 text-sm font-mono">select a session</div>
        ) : (
          <div className="grid gap-1.5 h-full" style={{ gridTemplateColumns: `repeat(${cols(open.length)}, minmax(0, 1fr))`, gridAutoRows: '1fr' }}>
            {open.map((id) => {
              const s = byId(id);
              if (!s) return null;
              return (
                <div key={id} className="flex flex-col min-h-0 rounded-md overflow-hidden border border-slate-300 bg-white">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 border-b border-slate-300 shrink-0">
                    <span className={`w-1.5 h-1.5 rounded-full ${s.live ? 'bg-slate-600' : 'bg-slate-300'}`} />
                    <span className={`text-[11px] font-semibold truncate ${s.master ? 'text-slate-900' : 'text-slate-800'}`}>{s.master ? 'masternicho' : s.name}</span>
                    <span className="text-[9px] font-mono text-slate-600 truncate">{s.cwd}</span>
                    <button onClick={() => toggle(id)} className="ml-auto text-slate-500 hover:text-slate-800 shrink-0 text-[13px] leading-none">×</button>
                  </div>
                  <div className="flex-1 min-h-0"><LiveTranscript sessionId={id} /></div>
                  <Composer sessionId={id} talkable={s.talkable} api={API} getToken={getToken} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
