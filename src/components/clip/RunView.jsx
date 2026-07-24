import { useState } from 'react';
import { Wrench, Graph, TreeStructure, CirclesThree, Terminal } from '@phosphor-icons/react';
import { WidgetTile, WidgetPage } from './Widget';
import { ToolboxPage } from './Toolbox';
import { GraphPage } from './GraphWidget';
import { AgentsPage } from './AgentsWidget';
import { SwarmPage } from './SwarmWidget';
import ExecSummary from './ExecSummary';
import LiveTranscript from '../live/LiveTranscript';

// A run view = a menu of widget tiles. Click a tile → open its full page.
// The Transcript tile is the ADMIN live view — only present when this run has a
// live session (Current Runs); Past/curated runs have no live transcript.
function TranscriptPage({ summary }) {
  return (
    <div className="h-[62vh] min-h-[420px] border border-slate-300 dark:border-slate-800 rounded-md overflow-hidden">
      <LiveTranscript sessionId={summary?.sessionId} />
    </div>
  );
}

const BASE_WIDGETS = [
  { id: 'swarm', title: 'Swarm', icon: CirclesThree, Page: SwarmPage },
  { id: 'toolbox', title: 'Toolbox', icon: Wrench, Page: ToolboxPage },
  { id: 'graph', title: 'Graph', icon: Graph, Page: GraphPage },
  { id: 'agents', title: 'Agents', icon: TreeStructure, Page: AgentsPage },
];

export default function RunView({ live = true, activeRun = null, summary = null }) {
  const [openId, setOpenId] = useState(null);
  const transcriptTile = { id: 'transcript', title: 'Transcript', icon: Terminal, Page: TranscriptPage };
  // masternicho = the master orchestrator, not an engagement → transcript only.
  const WIDGETS = summary?.isMaster
    ? [transcriptTile]
    : summary?.sessionId
      ? [transcriptTile, ...BASE_WIDGETS]
      : BASE_WIDGETS;
  const active = WIDGETS.find((w) => w.id === openId);

  if (active) {
    const Page = active.Page;
    return (
      <WidgetPage title={active.title} onBack={() => setOpenId(null)}>
        <Page live={live} activeRun={activeRun} summary={summary} />
      </WidgetPage>
    );
  }

  return (
    <div>
      {summary && <ExecSummary run={summary} />}
      <div className="flex flex-wrap gap-3">
        {WIDGETS.map((w) => (
          <WidgetTile key={w.id} icon={w.icon} title={w.title} onOpen={() => setOpenId(w.id)} />
        ))}
      </div>
    </div>
  );
}
