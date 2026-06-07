import { useState } from 'react';
import { CaretLeft, ArrowUpRight } from '@phosphor-icons/react';
import RunView from './RunView';
import { PAST_RUNS } from '../../data/pastRuns';

// Past Runs = our engagement portfolio, ANONYMIZED (client names stripped, shown
// by agent surface). Pick a run → its executive summary + widget menu. Findings/
// verdicts are the real outcomes; only client identity is anonymized.

function RunCard({ run, onOpen }) {
  const breached = run.verdict === 'breached';
  return (
    <button onClick={onOpen} className="group relative w-[300px] text-left border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f172a] hover:border-slate-400 dark:hover:border-slate-600 transition-colors cursor-pointer">
      {breached && <span className="absolute left-0 inset-y-0 w-[2px] bg-blue-700 dark:bg-blue-500" />}
      <div className="flex items-center gap-2 px-4 pt-3.5">
        <span className="text-[14px] font-bold tracking-tight text-slate-800 dark:text-slate-100 truncate">{run.name}</span>
        <ArrowUpRight size={14} weight="bold" className="ml-auto shrink-0 text-slate-300 dark:text-slate-600 group-hover:text-slate-500 dark:group-hover:text-slate-400 transition-colors" />
      </div>
      <div className="px-4 font-tech text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">{run.surface}</div>
      <div className="flex items-center gap-2 px-4 py-2.5 mt-1 font-tech text-[10px]">
        <span className={breached ? 'text-blue-700 dark:text-blue-400' : 'text-sky-500 dark:text-sky-300'}>{run.verdict}</span>
        <span className="ml-auto text-slate-400 dark:text-slate-500">{run.agents.length} agents · {run.findings.length} findings</span>
      </div>
    </button>
  );
}

export default function PastRunsView() {
  const [openId, setOpenId] = useState(null);
  const run = PAST_RUNS.find((r) => r.id === openId);

  if (run) {
    return (
      <div>
        <button onClick={() => setOpenId(null)} className="inline-flex items-center gap-1.5 mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer bg-transparent border-0 p-0">
          <CaretLeft size={13} weight="bold" /> Past runs
        </button>
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">{run.name}</h2>
          <span className="font-tech text-[10px] text-slate-400 dark:text-slate-500">{run.surface}</span>
        </div>
        <RunView key={run.id} live={false} summary={run} />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      {PAST_RUNS.map((r) => <RunCard key={r.id} run={r} onOpen={() => setOpenId(r.id)} />)}
    </div>
  );
}
