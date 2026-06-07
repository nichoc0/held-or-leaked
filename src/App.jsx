import { useState } from 'react';
import { SideNav } from './components/layout/SideNav';
import { TopBar } from './components/layout/TopBar';
import CliLogin from './components/auth/CliLogin';
import Docs from './components/views/Docs';
import RunView from './components/clip/RunView';
import PastRunsView from './components/clip/PastRunsView';
import StartRun from './components/clip/StartRun';
import EvalsView from './components/clip/EvalsView';

// clip — clean-slate dashboard.
// The staging.demo shell (sidebar + topbar + main card) kept intact; every
// view emptied to a blank canvas to build on. No data fetching, no changelog,
// no risk rail, no mode toggle.

const VALID_VIEWS = new Set(['current-runs', 'past-runs', 'evals']);

function detectInitialView() {
  if (typeof window === 'undefined') return 'current-runs';
  let path = window.location.pathname || '/';
  if (path.startsWith('/')) path = path.slice(1);
  const first = (path.split('/')[0] || '').toLowerCase();
  return VALID_VIEWS.has(first) ? first : 'current-runs';
}

const VIEW_LABEL = {
  'current-runs': 'Current Runs',
  'past-runs': 'Past Runs',
  evals: 'Evals',
};
const VIEW_TAG = { 'current-runs': 'live', 'past-runs': 'recorded', evals: 'weave' };

export default function App() {
  // /cli-login + /docs keep their dedicated routes (login lives here).
  const routePath = (typeof window !== 'undefined' && window.location.pathname) || '/';
  if (routePath === '/cli-login') return <CliLogin />;
  if (routePath === '/docs') return <Docs />;

  const [currentView, setCurrentView] = useState(detectInitialView());
  const [activeRun, setActiveRun] = useState(null);

  return (
    <div className="min-h-screen font-sans bg-slate-50 dark:bg-[#0B1120] text-slate-800 dark:text-slate-300 flex transition-colors duration-300 tech-grid">
      <SideNav currentView={currentView} setCurrentView={setCurrentView} />

      <main className="flex-1 sm:ml-[220px] h-screen overflow-y-auto overflow-x-hidden flex flex-col pb-16 sm:pb-0 relative z-10">
        <TopBar setCurrentView={setCurrentView} />
        <section className="flex-1 bg-transparent transition-colors duration-300 p-0 sm:p-6">
          <div className="h-full border-x border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f172a] shadow-sm relative px-6 sm:px-10 py-8">
            <div className="flex items-center gap-2 mb-5">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                {VIEW_LABEL[currentView] || 'Current Runs'}
              </h1>
              <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400 dark:text-slate-500">
                {VIEW_TAG[currentView] || ''}
              </span>
            </div>
            {/* Past Runs → pick a run. Current Runs → authoritative Start-a-run
                input (from the bounty-target registry), then the live widgets. */}
            {currentView === 'evals' ? (
              <EvalsView />
            ) : currentView === 'past-runs' ? (
              <PastRunsView />
            ) : (
              <>
                {activeRun ? (
                  <div className="flex items-center gap-3 mb-6 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f172a] px-4 h-12">
                    <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 pulse-dot" /><span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" /></span>
                    <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">{activeRun.name}</span>
                    <span className="font-tech text-[10px] uppercase tracking-widest text-slate-400 dark:text-slate-500">{activeRun.platform} · running</span>
                    <button onClick={() => setActiveRun(null)} className="ml-auto font-tech text-[10px] uppercase tracking-widest text-slate-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer">stop</button>
                  </div>
                ) : (
                  <StartRun onStart={setActiveRun} />
                )}
                <RunView key={activeRun ? activeRun.name : 'idle'} live activeRun={activeRun} />
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
