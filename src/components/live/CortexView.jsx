import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk-real';

// Cortex — the grandiose showcase of the attack-library scale. Non-technical:
// it just shows the sheer amount of adversarial knowledge we've accumulated,
// live from the FalkorDB cortex. Every engagement makes these numbers grow.

function useCountUp(target, ms = 1400) {
  const [v, setV] = useState(0);
  const raf = useRef();
  useEffect(() => {
    if (!target) { setV(0); return; }
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(Math.round(target * eased));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);
  return v;
}

function Big({ n, label }) {
  const v = useCountUp(n);
  return (
    <div>
      <div className="text-[clamp(2.4rem,7vw,5.5rem)] font-black tracking-tight text-slate-900 leading-none tabular-nums">
        {v.toLocaleString()}
      </div>
      <div className="text-[12px] font-semibold uppercase tracking-[0.2em] text-slate-500 mt-2">{label}</div>
    </div>
  );
}

function Stat({ n, label }) {
  const v = useCountUp(n);
  return (
    <div className="border border-slate-200 bg-white px-5 py-4">
      <div className="text-[30px] font-black tracking-tight text-slate-900 tabular-nums leading-none">{v.toLocaleString()}</div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 mt-1.5">{label}</div>
    </div>
  );
}

export default function CortexView() {
  const { getToken } = useAuth();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const API = import.meta.env.VITE_API_URL || '';

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken().catch(() => null);
        const r = await fetch(`${API}/api/cortex/stats`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!r.ok) { setErr(`cortex ${r.status}`); return; }
        setD(await r.json());
      } catch { setErr('cortex unreachable'); }
    })();
  }, []);

  const by = d?.byType || {};
  const g = (k) => by[k] || 0;

  const library = useMemo(() => [
    { n: g('Technique'), label: 'attack techniques' },
    { n: g('JailbreakPrompt') + g('LiberationCommand'), label: 'jailbreak prompts' },
    { n: g('TechniqueFamily'), label: 'technique families' },
    { n: g('Mechanism'), label: 'attack mechanisms' },
    { n: g('VulnClass') + g('ASIClass'), label: 'vulnerability classes' },
    { n: g('OWASPClass'), label: 'OWASP LLM classes' },
    { n: g('CWE'), label: 'CWE mappings' },
    { n: g('Benchmark'), label: 'benchmarks' },
  ], [d]);

  const proven = useMemo(() => [
    { n: g('Finding'), label: 'confirmed findings' },
    { n: g('Engagement'), label: 'authorized engagements' },
    { n: g('Source'), label: 'verified sources' },
    { n: g('StrategicLesson'), label: 'strategic lessons' },
    { n: g('Endpoint'), label: 'mapped endpoints' },
    { n: g('SystemPrompt'), label: 'system prompts' },
    { n: g('Guardrail') + g('DefenseProfile'), label: 'guardrail profiles' },
    { n: g('Program'), label: 'programs mapped' },
  ], [d]);

  if (err) return <div className="text-[13px] text-rose-500 font-mono">{err}</div>;
  if (!d) return <div className="text-[13px] text-slate-400 font-mono">loading cortex…</div>;

  return (
    <div className="space-y-10">
      {/* hero */}
      <div className="border-b border-slate-200 pb-8">
        <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400 mb-4">the bastion cortex · live</div>
        <div className="flex flex-wrap items-end gap-x-16 gap-y-6">
          <Big n={d.total} label="nodes of adversarial knowledge" />
          <Big n={d.relationships} label="mapped relationships" />
        </div>
        <p className="text-[14px] text-slate-500 max-w-[560px] mt-5">
          A single knowledge graph of how AI agents fail under attack. It compounds every engagement — a competitor starts empty and cannot buy or scrape what it took hundreds of real attacks to build.
        </p>
      </div>

      {/* attack library */}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-4">attack library</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {library.map((s) => <Stat key={s.label} n={s.n} label={s.label} />)}
        </div>
      </div>

      {/* proven at scale */}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-4">proven at scale</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {proven.map((s) => <Stat key={s.label} n={s.n} label={s.label} />)}
        </div>
      </div>
    </div>
  );
}
