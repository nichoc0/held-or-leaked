import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk-real';
import { X, CircleNotch, Terminal, Star } from '@phosphor-icons/react';
import LiveTranscript from './LiveTranscript';

// Hyprland-style tiling workspace of live Claude sessions. Left rail = the
// sessions that matter (live + Bastion), collapsing the dead flood. Click to
// tile a session open; multiple tiles auto-arrange like a tiling WM.

const MASTER = (s) => (s.cwd || '').replace(/\/$/, '') === '/Users/nca'; // the masternicho session(s)

// grid columns by open-tile count (hyprland-ish auto-tiling)
function cols(n) {
  if (n <= 1) return 1;
  if (n <= 4) return 2;
  if (n <= 9) return 3;
  return 4;
}

function SessionRow({ s, open, toggle }) {
  const isOpen = open.includes(s.id);
  const master = MASTER(s);
  return (
    <button onClick={() => toggle(s.id)}
      className={`w-full text-left px-3 py-1.5 border-l-2 transition-colors cursor-pointer ${isOpen ? 'border-emerald-500 bg-slate-800/60' : 'border-transparent hover:bg-slate-800/30'}`}>
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${s.live ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`} />
        {master && <Star size={10} weight="fill" className="text-amber-400 shrink-0" />}
        <span className="text-[12px] font-medium text-slate-200 truncate">{master ? 'masternicho' : s.name}</span>
        {s.bastion && !master && <span className="text-[7px] px-1 rounded bg-violet-500/20 text-violet-300 font-bold uppercase shrink-0">bst</span>}
      </div>
      <div className="text-[9px] font-mono text-slate-500 mt-0.5">{s.id.slice(0, 8)} · {Math.round((s.size || 0) / 1024)}KB</div>
    </button>
  );
}

export default function LiveRunsView() {
  const { getToken } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [open, setOpen] = useState([]); // ordered list of open session ids (tiles)
  const [err, setErr] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const API = import.meta.env.VITE_API_URL || '';

  async function refresh() {
    try {
      const token = await getToken().catch(() => null);
      const r = await fetch(`${API}/api/sessions?scope=recent`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!r.ok) { setErr(`relay ${r.status}${r.status === 403 ? ' — not an admin' : r.status === 401 ? ' — token rejected' : ''}`); return; }
      const d = await r.json();
      setSessions(d.sessions || []);
      setErr(null);
    } catch { setErr('relay unreachable'); }
  }
  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, []);

  // what matters: live sessions + Bastion engagements + the master. The rest (idle
  // amazon-vrp pool, etc.) is collapsed behind "show all".
  const { primary, rest } = useMemo(() => {
    const rank = (s) => (MASTER(s) ? 0 : s.live && s.bastion ? 1 : s.live ? 2 : s.bastion ? 3 : 9);
    const sorted = [...sessions].sort((a, b) => rank(a) - rank(b) || b.mtime - a.mtime);
    return { primary: sorted.filter((s) => rank(s) < 9), rest: sorted.filter((s) => rank(s) === 9) };
  }, [sessions]);

  // auto-tile the live Bastion sessions + master on first load
  useEffect(() => {
    if (open.length === 0 && primary.length) {
      const auto = primary.filter((s) => s.live && (s.bastion || MASTER(s))).slice(0, 4).map((s) => s.id);
      if (auto.length) setOpen(auto);
    }
  }, [primary]); // eslint-disable-line

  const toggle = (id) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  const byId = (id) => sessions.find((s) => s.id === id);

  return (
    <div className="flex gap-2 h-[calc(100vh-150px)] min-h-[520px] -mx-4">
      {/* session rail — mission control */}
      <div className="w-56 shrink-0 flex flex-col border-r border-slate-800/60 overflow-hidden">
        <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5 border-b border-slate-800/60">
          <Terminal size={12} weight="bold" /> mission control
          {err && <span className="text-rose-500 ml-auto normal-case font-mono text-[9px]">{err}</span>}
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 pt-2 pb-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-500/80">active · {primary.length}</div>
          {primary.map((s) => <SessionRow key={s.id} s={s} open={open} toggle={toggle} />)}
          {primary.length === 0 && !err && <div className="px-3 py-1 text-[10px] text-slate-600">none live</div>}
          {rest.length > 0 && (
            <>
              <button onClick={() => setShowAll((v) => !v)} className="w-full px-3 pt-3 pb-0.5 text-left text-[9px] font-bold uppercase tracking-widest text-slate-600 hover:text-slate-400">
                {showAll ? '▾' : '▸'} idle · {rest.length}
              </button>
              {showAll && rest.map((s) => <SessionRow key={s.id} s={s} open={open} toggle={toggle} />)}
            </>
          )}
        </div>
      </div>

      {/* tiling grid */}
      <div className="flex-1 min-w-0 p-1">
        {open.length === 0 ? (
          <div className="h-full grid place-items-center text-slate-600 text-sm font-mono">select a session to tile it</div>
        ) : (
          <div className="grid gap-1.5 h-full" style={{ gridTemplateColumns: `repeat(${cols(open.length)}, minmax(0, 1fr))`, gridAutoRows: '1fr' }}>
            {open.map((id) => {
              const s = byId(id);
              if (!s) return null;
              return (
                <div key={id} className="flex flex-col min-h-0 rounded-md overflow-hidden border border-slate-800 bg-[#0d1117]">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#161b22] border-b border-slate-800 shrink-0">
                    <span className={`w-1.5 h-1.5 rounded-full ${s.live ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`} />
                    {MASTER(s) && <Star size={10} weight="fill" className="text-amber-400" />}
                    <span className="text-[11px] font-semibold text-slate-200 truncate">{MASTER(s) ? 'masternicho' : s.name}</span>
                    <span className="text-[9px] font-mono text-slate-600 truncate">{s.cwd}</span>
                    <button onClick={() => toggle(id)} className="ml-auto text-slate-500 hover:text-rose-400 shrink-0"><X size={13} /></button>
                  </div>
                  <div className="flex-1 min-h-0">
                    <LiveTranscript sessionId={id} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
