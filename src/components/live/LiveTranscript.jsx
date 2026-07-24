import { useEffect, useRef, useState, useMemo } from 'react';
import { ThinkingBlock } from '../ui/ThinkingBlock';
import { ToolCallCard } from '../ui/ToolCallCard';

// LiveTranscript — connects to the relay WebSocket for one session and renders
// the live structured transcript (thinking / text / tool_use+result / system).
// Read-only here; the admin "talk to it" input is a sibling composer.

function wsUrl(id) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/api/sessions/${id}/stream`;
}

const AGENT_COLOR = { orchestrator: '#0f172a', subagent: '#7c3aed' };

function AgentDot({ agent }) {
  return <span className="rounded-full shrink-0" style={{ width: 7, height: 7, background: AGENT_COLOR[agent] || '#64748b' }} />;
}

function Turn({ t, resultFor }) {
  if (t.kind === 'thinking') return <ThinkingBlock content={t.text} />;
  if (t.kind === 'tool_use')
    return <ToolCallCard name={t.tool_name} input={t.tool_input} result={resultFor?.text} />;
  if (t.kind === 'tool_result') return null; // folded into its ToolCallCard
  if (t.kind === 'system' || t.kind === 'meta')
    return (
      <div className="px-3 py-1 text-[10px] font-mono text-slate-400 dark:text-slate-500 truncate">
        {t.kind === 'system' ? '⚙ ' : '↳ '}{(t.text || '').slice(0, 160)}
      </div>
    );
  // text
  const isUser = t.role === 'user';
  return (
    <div className={`px-3 py-2 ${isUser ? 'bg-slate-50 dark:bg-slate-800/40' : ''}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <AgentDot agent={t.agent} />
        <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
          {isUser ? 'operator' : t.agent}
        </span>
      </div>
      <div className="text-[13px] text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
        {t.text}
      </div>
    </div>
  );
}

export default function LiveTranscript({ sessionId, live }) {
  const [turns, setTurns] = useState([]);
  const [status, setStatus] = useState('connecting');
  const scrollRef = useRef(null);
  const atBottom = useRef(true);

  useEffect(() => {
    if (!sessionId) return;
    setTurns([]);
    setStatus('connecting');
    const ws = new WebSocket(wsUrl(sessionId));
    ws.onopen = () => setStatus('live');
    ws.onclose = () => setStatus('closed');
    ws.onerror = () => setStatus('error');
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.kind === 'snapshot') setTurns(msg.turns || []);
      else if (msg.kind === 'append') setTurns((prev) => [...prev, ...(msg.turns || [])]);
    };
    return () => ws.close();
  }, [sessionId]);

  // pair tool_result to its tool_use by tool_id
  const results = useMemo(() => {
    const m = {};
    for (const t of turns) if (t.kind === 'tool_result' && t.tool_id) m[t.tool_id] = t;
    return m;
  }, [turns]);

  useEffect(() => {
    if (atBottom.current && scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-200 dark:border-slate-800 text-[11px]">
        <span className={`w-1.5 h-1.5 rounded-full ${status === 'live' ? 'bg-emerald-500 animate-pulse' : status === 'error' ? 'bg-rose-500' : 'bg-slate-400'}`} />
        <span className="font-mono text-slate-500">{status}</span>
        <span className="text-slate-400 ml-auto">{turns.length} turns</span>
      </div>
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60"
      >
        {turns.length === 0 && (
          <div className="p-6 text-center text-slate-400 text-sm">waiting for transcript…</div>
        )}
        {turns.map((t, i) => (
          <Turn key={t.uuid ? `${t.uuid}-${i}` : i} t={t} resultFor={t.kind === 'tool_use' ? results[t.tool_id] : null} />
        ))}
      </div>
    </div>
  );
}
