import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk-real';
import { CaretLeft, ArrowUpRight } from '@phosphor-icons/react';
import RunView from '../clip/RunView';

// Current Runs = live engagements, each shown like a Past Run (card → RunView
// detail). Admin-only (relay-gated). The live transcript is one widget inside
// RunView, not the whole view.

function toRun(s, sum) {
  return {
    id: s.id,
    sessionId: s.id,
    name: s.master ? 'masternicho' : s.name,
    surface: s.cwd || '',
    verdict: s.live ? 'running' : 'idle',
    turns: sum?.turns || 0,
    agents: Array.from({ length: sum?.agents || 1 }, (_, i) => ({ name: i === 0 ? 'orchestrator' : `agent ${i}`, color: '#64748b' })),
    tools: sum?.tools || [],
    findings: [],
  };
}

function RunCard({ s, sum, onOpen }) {
  const running = s.live;
  return (
    <button onClick={onOpen} className="group relative w-[300px] text-left border border-slate-200 bg-white hover:border-slate-400 transition-colors">
      {running && <span className="absolute left-0 inset-y-0 w-[2px] bg-slate-700" />}
      <div className="flex items-center gap-2 px-4 pt-3.5">
        <span className={`w-1.5 h-1.5 rounded-full ${running ? 'bg-slate-600' : 'bg-slate-300'}`} />
        <span className="text-[14px] font-bold tracking-tight text-slate-800 truncate">{s.master ? 'masternicho' : s.name}</span>
        <ArrowUpRight size={14} weight="bold" className="ml-auto shrink-0 text-slate-300 group-hover:text-slate-500 transition-colors" />
      </div>
      <div className="px-4 font-mono text-[10px] text-slate-400 mt-0.5 truncate">{s.cwd}</div>
      <div className="flex items-center gap-2 px-4 py-2.5 mt-1 font-mono text-[10px]">
        <span className="text-slate-600">{running ? 'running' : 'idle'}</span>
        <span className="ml-auto text-slate-400">{sum ? `${sum.agents} agents · ${sum.turns} turns` : '…'}</span>
      </div>
    </button>
  );
}

export default function LiveRunsView() {
  const { getToken } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [sums, setSums] = useState({});
  const [openId, setOpenId] = useState(null);
  const [err, setErr] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const API = import.meta.env.VITE_API_URL || '';

  const authed = async (path, opts = {}) => {
    const token = await getToken().catch(() => null);
    return fetch(`${API}${path}`, { ...opts, headers: { ...(opts.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  };

  async function refresh() {
    try {
      const r = await authed('/api/sessions?scope=recent');
      if (!r.ok) { setErr(`relay ${r.status}${r.status === 403 ? ' — not admin' : ''}`); return; }
      const d = await r.json();
      setSessions(d.sessions || []); setErr(null);
    } catch { setErr('relay unreachable'); }
  }
  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, []);

  const { active, idle } = useMemo(() => {
    const rank = (s) => (s.master ? 0 : s.live && s.bastion ? 1 : s.bastion ? 2 : s.live ? 3 : 9);
    const sorted = [...sessions].sort((a, b) => rank(a) - rank(b) || b.mtime - a.mtime);
    return { active: sorted.filter((s) => rank(s) < 9), idle: sorted.filter((s) => rank(s) === 9) };
  }, [sessions]);

  // lazily fetch derived stats for the cards on screen
  const visible = showAll ? [...active, ...idle] : active;
  useEffect(() => {
    visible.forEach(async (s) => {
      if (sums[s.id]) return;
      try {
        const r = await authed(`/api/sessions/${s.id}/summary`);
        if (r.ok) { const j = await r.json(); setSums((m) => ({ ...m, [s.id]: j })); }
      } catch {}
    });
  }, [visible.map((s) => s.id).join(','), showAll]); // eslint-disable-line

  const openSession = sessions.find((s) => s.id === openId);
  if (openSession) {
    const run = toRun(openSession, sums[openSession.id]);
    return (
      <div>
        <button onClick={() => setOpenId(null)} className="inline-flex items-center gap-1.5 mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-700 transition-colors">
          <CaretLeft size={13} weight="bold" /> Current runs
        </button>
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-base font-bold text-slate-900 tracking-tight">{run.name}</h2>
          <span className="font-mono text-[10px] text-slate-400 truncate">{run.surface}</span>
        </div>
        <RunView key={run.id} live summary={run} />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">active · {active.length}</span>
        {err && <span className="text-[10px] text-rose-500 font-mono">{err}</span>}
        {idle.length > 0 && (
          <button onClick={() => setShowAll((v) => !v)} className="ml-auto px-2 py-1 rounded border border-slate-300 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors">
            {showAll ? 'hide idle' : `all sessions (${active.length + idle.length})`}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        {active.map((s) => <RunCard key={s.id} s={s} sum={sums[s.id]} onOpen={() => setOpenId(s.id)} />)}
        {active.length === 0 && !err && <div className="text-[12px] text-slate-500 font-mono">no active runs</div>}
      </div>
      {showAll && idle.length > 0 && (
        <>
          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-6 mb-3">idle · {idle.length}</div>
          <div className="flex flex-wrap gap-3">
            {idle.map((s) => <RunCard key={s.id} s={s} sum={sums[s.id]} onOpen={() => setOpenId(s.id)} />)}
          </div>
        </>
      )}
    </div>
  );
}
