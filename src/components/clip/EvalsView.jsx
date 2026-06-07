import { useEffect, useMemo, useRef, useState } from 'react';
import { CaretLeft, ArrowUpRight, Play, X } from '@phosphor-icons/react';
import { CTF_TARGETS } from '../../data/ctfTargets';
import { EvalsPage } from './EvalsWidget';

// Evals tab = Sandbox (pick an OSS CTF target, the harness clones/attaches it in
// a sandbox and runs a new eval) + Past evals (the held-or-leaked leaderboard +
// Weave traces). Clicking a CTF card starts a sandbox session; only the source
// is an outbound link.
const PAST_EVALS = [
  { id: 'held-or-leaked', name: 'Held or Leaked', sub: '2 agents · 9 vectors · scored in W&B Weave', vuln: '89%', held: '100%' },
];

// The sandbox boot log for a target. Repo-backed CTFs get cloned + built; hosted
// challenges are attached directly. Either way the harness then takes over.
function buildLog(ctf) {
  const isRepo = ctf.url.includes('github.com');
  const slug = ctf.id;
  if (isRepo) {
    return [
      `$ git clone ${ctf.url} /sandbox/${slug}`,
      `Cloning into '/sandbox/${slug}'...`,
      `remote: Enumerating objects: 312, done.`,
      `Receiving objects: 100% (312/312), 1.24 MiB | 4.1 MiB/s, done.`,
      `$ cd /sandbox/${slug} && docker compose up -d`,
      `[+] Running 2/2  network ${slug}_default  container ${slug}-app`,
      `target up on http://127.0.0.1:8000`,
      `$ bastion attach --target http://127.0.0.1:8000 --suite held-or-leaked`,
      `harness: orchestrator online, recon dispatched`,
      `harness: ${ctf.kind} surface mapped`,
      `harness: scoring held vs leaked, tracing to Weave`,
      `harness: run live. open Past Runs to watch the swarm`,
    ];
  }
  return [
    `$ bastion sandbox --hosted ${ctf.url}`,
    `sandbox: hosted target, no clone needed`,
    `$ bastion attach --target ${ctf.url} --suite held-or-leaked`,
    `harness: orchestrator online, recon dispatched`,
    `harness: ${ctf.kind} mapped`,
    `harness: scoring held vs leaked, tracing to Weave`,
    `harness: run live. open Past Runs to watch the swarm`,
  ];
}

function LogLine({ text }) {
  const cls = text.startsWith('$ ') ? 'text-blue-300'
    : text.startsWith('harness:') ? 'text-sky-300'
    : text.startsWith('target up') ? 'text-blue-300'
    : 'text-slate-400';
  return <div className={`whitespace-pre-wrap ${cls}`}>{text}</div>;
}

function SandboxSession({ ctf, onClose }) {
  const lines = useMemo(() => buildLog(ctf), [ctf.id]);
  const [n, setN] = useState(0);
  const endRef = useRef(null);

  useEffect(() => { setN(0); }, [ctf.id]);
  useEffect(() => {
    if (n >= lines.length) return undefined;
    const id = setTimeout(() => setN((x) => x + 1), n === 0 ? 120 : 320);
    return () => clearTimeout(id);
  }, [n, lines.length, ctf.id]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [n]);

  const done = n >= lines.length;
  return (
    <div className="mt-4 max-w-[640px] border border-slate-800 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-8 bg-[#0b1220] border-b border-slate-800">
        <span className="flex gap-1.5">
          <span className="w-2 h-2 rounded-full bg-slate-600" />
          <span className="w-2 h-2 rounded-full bg-slate-700" />
          <span className="w-2 h-2 rounded-full bg-slate-700" />
        </span>
        <span className="font-tech text-[11px] text-slate-300 ml-1">sandbox · {ctf.name}</span>
        {done
          ? <span className="font-tech text-[9px] text-blue-300 ml-1">live</span>
          : <span className="font-tech text-[9px] text-sky-300 ml-1 animate-pulse">running</span>}
        <button onClick={onClose} className="ml-auto text-slate-500 hover:text-slate-300 transition-colors cursor-pointer bg-transparent border-0 p-0"><X size={13} weight="bold" /></button>
      </div>
      <div className="bg-[#0b1220] px-3 py-2.5 max-h-[240px] overflow-y-auto font-tech text-[11px] leading-relaxed">
        {lines.slice(0, n).map((l, i) => <LogLine key={i} text={l} />)}
        {!done && <span className="text-slate-500">▍</span>}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function CtfCard({ c, active, onRun }) {
  return (
    <div className={`w-[230px] border bg-white dark:bg-[#0f172a] px-3.5 py-3 transition-colors ${active ? 'border-slate-400 dark:border-slate-500' : 'border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600'}`}>
      <button onClick={onRun} className="group block w-full text-left cursor-pointer bg-transparent border-0 p-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">{c.name}</span>
          <Play size={12} weight="fill" className="ml-auto text-slate-300 dark:text-slate-600 group-hover:text-blue-500 transition-colors" />
        </div>
        <div className="font-tech text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{c.kind}</div>
      </button>
      <a href={c.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 font-tech text-[9px] text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 mt-1.5 transition-colors">
        {c.src} <ArrowUpRight size={9} weight="bold" />
      </a>
    </div>
  );
}

export default function EvalsView() {
  const [openId, setOpenId] = useState(null);
  const [running, setRunning] = useState(null);
  const evalRun = PAST_EVALS.find((e) => e.id === openId);

  if (evalRun) {
    return (
      <div>
        <button onClick={() => setOpenId(null)} className="inline-flex items-center gap-1.5 mb-4 text-[11px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer bg-transparent border-0 p-0">
          <CaretLeft size={13} weight="bold" /> Evals
        </button>
        <EvalsPage />
      </div>
    );
  }

  return (
    <div>
      {/* Sandbox */}
      <div className="mb-7">
        <div className="flex items-baseline gap-2 mb-2">
          <h2 className="text-[13px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Sandbox</h2>
          <span className="text-[12px] text-slate-400 dark:text-slate-500">pick an OSS CTF target, the harness clones it into a sandbox and runs a new eval</span>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {CTF_TARGETS.map((c) => <CtfCard key={c.id} c={c} active={running?.id === c.id} onRun={() => setRunning(c)} />)}
        </div>
        {running && <SandboxSession ctf={running} onClose={() => setRunning(null)} />}
      </div>

      {/* Past evals */}
      <div>
        <h2 className="text-[13px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">Past evals</h2>
        <div className="flex flex-wrap gap-3">
          {PAST_EVALS.map((e) => (
            <button key={e.id} onClick={() => setOpenId(e.id)} className="group w-[320px] text-left border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f172a] hover:border-slate-400 dark:hover:border-slate-600 transition-colors cursor-pointer px-4 py-3.5">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-bold tracking-tight text-slate-800 dark:text-slate-100">{e.name}</span>
                <ArrowUpRight size={14} weight="bold" className="ml-auto text-slate-300 dark:text-slate-600 group-hover:text-slate-500 dark:group-hover:text-slate-400 transition-colors" />
              </div>
              <div className="font-tech text-[10px] text-slate-400 dark:text-slate-500 mt-1">{e.sub}</div>
              <div className="flex items-center gap-3 mt-2 font-tech text-[10px]">
                <span className="text-blue-700 dark:text-blue-400">vuln {e.vuln} leaked</span>
                <span className="text-sky-500 dark:text-sky-300">hardened {e.held} held</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
