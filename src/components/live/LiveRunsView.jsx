import { useEffect, useState } from 'react';
import LiveTranscript from './LiveTranscript';

// LiveRunsView — the admin "every live claude transcript" surface. Left: the
// session list (auto-discovered from the relay; any spawned Bastion REPL appears
// here with zero registration). Right: the selected session's live transcript.
// Talk-to-it composer lands next (admin-only, POST /input); this is the read path.

export default function LiveRunsView() {
  const [sessions, setSessions] = useState([]);
  const [sel, setSel] = useState(null);
  const [err, setErr] = useState(null);

  const API = import.meta.env.VITE_API_URL || '';
  async function refresh() {
    try {
      const r = await fetch(`${API}/api/sessions?scope=recent`);
      const d = await r.json();
      setSessions(d.sessions || []);
      setErr(null);
      setSel((cur) => cur || (d.sessions || []).find((s) => s.live && s.bastion)?.id || (d.sessions || [])[0]?.id || null);
    } catch (e) {
      setErr('relay unreachable — start bridge/relay.py on :8477');
    }
  }
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  const selected = sessions.find((s) => s.id === sel);

  return (
    <div className="flex gap-3 h-[calc(100vh-160px)] min-h-[480px]">
      {/* session list */}
      <div className="w-72 shrink-0 border border-slate-200 dark:border-slate-800 rounded-lg overflow-y-auto">
        <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-900">
          Live sessions
        </div>
        {err && <div className="p-3 text-[11px] text-rose-500">{err}</div>}
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => setSel(s.id)}
            className={`w-full text-left px-3 py-2 border-b border-slate-50 dark:border-slate-800/50 cursor-pointer transition-colors ${
              s.id === sel ? 'bg-slate-100 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${s.live ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-600'}`} />
              <span className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-100 truncate">{s.name}</span>
              {s.bastion && <span className="text-[8px] px-1 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 font-bold uppercase">bastion</span>}
            </div>
            <div className="text-[10px] font-mono text-slate-400 mt-0.5">
              {s.id.slice(0, 8)} · {Math.round((s.size || 0) / 1024)}KB{s.talkable ? ' · talkable' : ''}
            </div>
          </button>
        ))}
        {sessions.length === 0 && !err && <div className="p-3 text-[11px] text-slate-400">no recent sessions</div>}
      </div>

      {/* transcript */}
      <div className="flex-1 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        {selected ? (
          <div className="flex flex-col h-full">
            <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800">
              <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100">{selected.name}</div>
              <div className="text-[10px] font-mono text-slate-400 truncate">{selected.cwd}</div>
            </div>
            <div className="flex-1 min-h-0">
              <LiveTranscript sessionId={selected.id} live={selected.live} />
            </div>
          </div>
        ) : (
          <div className="h-full grid place-items-center text-slate-400 text-sm">select a session</div>
        )}
      </div>
    </div>
  );
}
