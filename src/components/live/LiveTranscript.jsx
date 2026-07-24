import { useEffect, useRef, useState, useMemo } from 'react';
import { useAuth } from '@clerk-real';

// LiveTranscript — a Claude Code terminal emulation for one session. Reads the
// live WS stream and renders turns the way the CLI does: ⏺ tool calls, ⎿ results,
// ✻ thinking, ❯ operator input. Monospace, dark, auto-scrolls with the stream.

function wsUrl(id) {
  const base = import.meta.env.VITE_API_URL;
  if (base) {
    const u = new URL(base);
    return `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}/api/sessions/${id}/stream`;
  }
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/sessions/${id}/stream`;
}

function compactArgs(input) {
  if (!input) return '';
  let obj = input;
  if (typeof input === 'string') { try { obj = JSON.parse(input); } catch { return input.slice(0, 80); } }
  if (obj && typeof obj === 'object') {
    return Object.entries(obj).map(([k, v]) => {
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      return `${k}: ${String(s).replace(/\n/g, ' ').slice(0, 60)}`;
    }).join(', ').slice(0, 120);
  }
  return String(obj).slice(0, 100);
}

function Line({ t, result }) {
  if (t.kind === 'thinking') {
    return (
      <div className="text-slate-500 italic whitespace-pre-wrap py-0.5">
        <span className="not-italic">✻ </span>{t.text}
      </div>
    );
  }
  if (t.kind === 'tool_use') {
    const res = result?.text || '';
    const firstLines = res.split('\n').slice(0, 6).join('\n');
    return (
      <div className="py-0.5">
        <div><span className="text-slate-400">⏺ </span><span className="text-slate-300">{t.tool_name}</span><span className="text-slate-500">({compactArgs(t.tool_input)})</span></div>
        {res && <div className="text-slate-500 pl-3 whitespace-pre-wrap">⎿ {firstLines}{res.split('\n').length > 6 ? '\n  …' : ''}</div>}
      </div>
    );
  }
  if (t.kind === 'tool_result') return null;
  if (t.kind === 'system' || t.kind === 'meta') {
    return <div className="text-slate-600 py-0.5 truncate">{t.kind === 'system' ? '· ' : '· '}{(t.text || '').slice(0, 120)}</div>;
  }
  // text
  if (t.role === 'user') {
    return <div className="text-slate-300 whitespace-pre-wrap py-0.5">❯ {t.text}</div>;
  }
  return <div className="text-slate-200 whitespace-pre-wrap py-0.5">{t.text}</div>;
}

export default function LiveTranscript({ sessionId }) {
  const { getToken } = useAuth();
  const [turns, setTurns] = useState([]);
  const [status, setStatus] = useState('connecting');
  const scrollRef = useRef(null);
  const atBottom = useRef(true);

  useEffect(() => {
    if (!sessionId) return;
    setTurns([]); setStatus('connecting');
    let ws, closed = false;
    (async () => {
      const token = await getToken().catch(() => null);
      if (closed) return;
      ws = new WebSocket(wsUrl(sessionId) + (token ? `?token=${encodeURIComponent(token)}` : ''));
      ws.onopen = () => setStatus('live');
      ws.onclose = () => setStatus('closed');
      ws.onerror = () => setStatus('error');
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.kind === 'snapshot') setTurns(msg.turns || []);
        else if (msg.kind === 'append') setTurns((p) => [...p, ...(msg.turns || [])]);
      };
    })();
    return () => { closed = true; if (ws) ws.close(); };
  }, [sessionId]);

  const results = useMemo(() => {
    const m = {};
    for (const t of turns) if (t.kind === 'tool_result' && t.tool_id) m[t.tool_id] = t;
    return m;
  }, [turns]);

  useEffect(() => {
    if (atBottom.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns]);

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}
      className="h-full overflow-y-auto bg-[#0d1117] text-[11px] leading-[1.45] font-mono px-3 py-2"
    >
      {turns.length === 0 && (
        <div className="text-slate-600">{status === 'live' ? 'waiting for output…' : status}</div>
      )}
      {turns.map((t, i) => (
        <Line key={t.uuid ? `${t.uuid}-${i}` : i} t={t} result={t.kind === 'tool_use' ? results[t.tool_id] : null} />
      ))}
    </div>
  );
}
