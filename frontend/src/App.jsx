import { useState, useEffect } from 'react';
import { useAgentStream } from './hooks/useAgentStream';
import { NicheInput } from './components/NicheInput';
import { MissionControl } from './components/MissionControl';
import { AgentLog } from './components/AgentLog';
import { BrowserFeed } from './components/BrowserFeed';
import { ReportView } from './components/ReportView';

function App() {
  const {
    status,
    sessionId,
    logs,
    taskBlocks,
    currentPhase,
    report,
    screenshots,
    browserFeed,
    painPoints,
    topProblem,
    gapAnalysis,
    error,
    stats,
    startAgent,
  } = useAgentStream();

  const [spaceId, setSpaceId] = useState(null);

  // Extract spaceId from taskBlocks when available
  useEffect(() => {
    if (taskBlocks?.length > 0 && taskBlocks[0].spaceId) {
      setSpaceId(taskBlocks[0].spaceId);
    }
  }, [taskBlocks]);

  const handleStart = (niche) => {
    startAgent(niche);
  };

  return (
    <div className="min-h-screen bg-dark-950">
      {/* Main container */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header section - NicheInput when idle, or status when running */}
        <div className="mb-8">
          {status === 'idle' ? (
            <NicheInput onStart={handleStart} disabled={false} />
          ) : (
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-400 text-xs font-medium mono mb-4">
                <span className={`w-1.5 h-1.5 rounded-full bg-brand-400 ${status === 'running' ? 'animate-pulse' : ''}`} />
                MARKET GAP AGENT v1.0
              </div>
              <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">
                {status === 'running' ? 'Agent Running...' : status === 'complete' ? 'Analysis Complete' : status === 'error' ? 'Error' : 'Starting...'}
              </h1>
              {error && (
                <div className="mt-4 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Main content grid */}
        {status !== 'idle' && (
          <div className="space-y-6">
            {/* Top two-column grid — Mission Control + Browser Feed */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left column - Mission Control */}
              <div className="lg:col-span-1 space-y-6">
                <MissionControl
                  sessionId={sessionId}
                  spaceId={spaceId}
                  currentPhase={currentPhase}
                  taskBlocks={taskBlocks}
                  stats={stats}
                  topProblem={topProblem}
                  gapAnalysis={gapAnalysis}
                />
              </div>

              {/* Right column - Browser Feed & Report */}
              <div className="lg:col-span-2 space-y-6">
                <BrowserFeed feed={browserFeed} />
                <ReportView report={report} screenshots={screenshots} />
              </div>
            </div>

            {/* Full-width Agent Log — below Mission Control and Browser Feed */}
            <AgentLog logs={logs} status={status} />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
