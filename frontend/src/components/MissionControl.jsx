const PHASE_ORDER = ['scout', 'brain', 'validate', 'brief', 'complete'];

const PHASE_META = {
  scout: { label: 'Scout', icon: '🔍', color: 'text-sky-400', bg: 'bg-sky-400/10 border-sky-400/20', tool: 'Bright Data' },
  brain: { label: 'Brain', icon: '🧠', color: 'text-violet-400', bg: 'bg-violet-400/10 border-violet-400/20', tool: 'Acontext + OpenAI' },
  validate: { label: 'Validate', icon: '🔬', color: 'text-amber-400', bg: 'bg-amber-400/10 border-amber-400/20', tool: 'ActionBook + Puppeteer' },
  brief: { label: 'Brief', icon: '📄', color: 'text-green-400', bg: 'bg-green-400/10 border-green-400/20', tool: 'OpenAI GPT-4o' },
  complete: { label: 'Complete', icon: '✅', color: 'text-green-400', bg: 'bg-green-400/10 border-green-400/20', tool: '' },
};

const TASK_LABELS = {
  extract_pain_points: 'Extract Pain Points',
  rank_and_select: 'Rank & Select Problem',
  verify_competitor_gaps: 'Verify Competitor Gaps',
  generate_opportunity_brief: 'Generate Opportunity Brief',
};

export function MissionControl({ sessionId, spaceId, currentPhase, taskBlocks, stats, topProblem, gapAnalysis }) {
  const currentPhaseIdx = PHASE_ORDER.indexOf(currentPhase);

  return (
    <div className="glass rounded-2xl p-5 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-2 pb-3 border-b border-white/5">
        <span className="text-lg">🧠</span>
        <span className="font-semibold text-slate-200 text-sm">Agent Memory — Mission Control</span>
        <span className="ml-auto px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-400 text-xs mono">ACONTEXT</span>
      </div>

      {/* Acontext Primitives */}
      <div className="space-y-2">
        <p className="text-xs text-slate-500 mono uppercase tracking-widest">Acontext Primitives</p>
        <div className="grid grid-cols-2 gap-2">
          <Primitive
            icon="🎯"
            label="Space"
            value={spaceId ? `${spaceId.slice(0, 10)}…` : 'Creating…'}
            active={!!spaceId}
          />
          <Primitive
            icon="🔄"
            label="Session"
            value={sessionId ? `${sessionId.slice(0, 10)}…` : 'Creating…'}
            active={!!sessionId}
          />
          <Primitive
            icon="💾"
            label="Disk"
            value="market_gap_report.json"
            active={stats.painPointsFound > 0}
          />
          <Primitive
            icon="📊"
            label="Stats"
            value={`${stats.postsFound}p · ${stats.painPointsFound}pp · ${stats.competitorsChecked}c`}
            active={stats.postsFound > 0}
          />
        </div>
      </div>

      {/* Phase progress */}
      <div className="space-y-2">
        <p className="text-xs text-slate-500 mono uppercase tracking-widest">Pipeline Phases</p>
        <div className="space-y-1.5">
          {PHASE_ORDER.filter((p) => p !== 'complete').map((phase, idx) => {
            const meta = PHASE_META[phase];
            const isActive = currentPhase === phase;
            const isDone = currentPhaseIdx > idx;
            const isPending = currentPhaseIdx < idx;

            return (
              <div
                key={phase}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all ${
                  isActive
                    ? meta.bg
                    : isDone
                    ? 'bg-green-400/5 border-green-400/10'
                    : 'bg-white/2 border-white/5'
                }`}
              >
                <span className="text-sm">{isDone ? '✓' : isActive ? meta.icon : '○'}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-medium ${isActive ? meta.color : isDone ? 'text-green-400' : 'text-slate-500'}`}>
                    {meta.label}
                  </p>
                  <p className="text-xs text-slate-600 mono truncate">{meta.tool}</p>
                </div>
                {isActive && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" style={{ color: 'inherit' }} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Task Blocks */}
      {taskBlocks.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500 mono uppercase tracking-widest">Task Blocks</p>
          <div className="space-y-1">
            {taskBlocks.map((task) => (
              <TaskBlockRow key={task.id} task={task} />
            ))}
          </div>
        </div>
      )}

      {/* Top Problem */}
      {topProblem?.problem && (
        <div className="p-3 rounded-xl bg-violet-500/10 border border-violet-500/20 space-y-1 animate-slide-up">
          <p className="text-xs text-violet-400 mono uppercase tracking-wider">Top Problem Found</p>
          <p className="text-xs text-slate-200 leading-relaxed">{topProblem.problem}</p>
          {topProblem.frequency && (
            <div className="flex gap-2 mt-1">
              <Chip label={`freq: ${topProblem.frequency}/10`} />
              <Chip label={`sev: ${topProblem.severity}/10`} />
            </div>
          )}
        </div>
      )}

      {/* Gap Status */}
      {gapAnalysis && (
        <div
          className={`p-3 rounded-xl border space-y-1 animate-slide-up ${
            gapAnalysis.gapConfirmed
              ? 'bg-green-500/10 border-green-500/20'
              : 'bg-amber-500/10 border-amber-500/20'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm">{gapAnalysis.gapConfirmed ? '🎯' : '⚠️'}</span>
            <p className={`text-xs mono font-medium ${gapAnalysis.gapConfirmed ? 'text-green-400' : 'text-amber-400'}`}>
              Gap {gapAnalysis.gapConfirmed ? 'CONFIRMED' : 'Uncertain'} · {gapAnalysis.confidence}
            </p>
          </div>
          {gapAnalysis.summary && (
            <p className="text-xs text-slate-300 leading-relaxed line-clamp-2">{gapAnalysis.summary}</p>
          )}
        </div>
      )}
    </div>
  );
}

function Primitive({ icon, label, value, active }) {
  return (
    <div className={`flex items-start gap-2 p-2.5 rounded-lg border transition-all ${active ? 'bg-white/5 border-white/10' : 'bg-white/2 border-white/5 opacity-50'}`}>
      <span className="text-base mt-0.5">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-slate-400">{label}</p>
        <p className="text-xs text-slate-200 mono truncate">{value}</p>
      </div>
    </div>
  );
}

function TaskBlockRow({ task }) {
  const statusStyles = {
    pending: 'text-slate-500',
    running: 'text-brand-400',
    complete: 'text-green-400',
    error: 'text-red-400',
  };

  const dotStyles = {
    pending: 'bg-slate-600',
    running: 'bg-brand-400 animate-pulse',
    complete: 'bg-green-400',
    error: 'bg-red-400',
  };

  const label = TASK_LABELS[task.id] ?? task.id;

  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotStyles[task.status] ?? dotStyles.pending}`} />
      <span className={`text-xs flex-1 ${statusStyles[task.status] ?? 'text-slate-500'}`}>{label}</span>
      <span className="text-xs text-slate-600 mono">{task.status}</span>
    </div>
  );
}

function Chip({ label }) {
  return (
    <span className="px-2 py-0.5 rounded bg-white/10 text-xs text-slate-300 mono">{label}</span>
  );
}
