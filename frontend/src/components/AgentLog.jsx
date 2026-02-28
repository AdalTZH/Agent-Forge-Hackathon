import { useEffect, useRef } from 'react';

const LEVEL_STYLES = {
  info:    'text-slate-400',
  success: 'text-green-400',
  warn:    'text-amber-400',
  error:   'text-red-400',
  phase:   'text-brand-400 font-semibold',
};

const PHASE_COLORS = {
  scout:    'text-sky-500',
  brain:    'text-violet-500',
  validate: 'text-amber-500',
  brief:    'text-green-500',
  init:     'text-slate-500',
  done:     'text-green-500',
  error:    'text-red-500',
};

export function AgentLog({ logs, status }) {
  const bottomRef = useRef(null);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="glass rounded-2xl overflow-hidden flex flex-col h-72 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/2 flex-shrink-0">
        <div className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
        </div>
        <span className="text-xs text-slate-500 mono ml-2">agent.log</span>
        <span className={`ml-auto text-xs mono ${status === 'running' ? 'text-brand-400 animate-pulse' : status === 'complete' ? 'text-green-400' : 'text-slate-500'}`}>
          {status === 'running' ? '● LIVE' : status === 'complete' ? '✓ DONE' : status === 'error' ? '✗ ERROR' : '○ IDLE'}
        </span>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto p-4 space-y-0.5 terminal-bg relative">
        {logs.length === 0 ? (
          <p className="text-slate-600 text-xs mono">Waiting for agent to start…</p>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex gap-2 text-xs animate-fade-in">
              <span className="text-slate-600 mono flex-shrink-0">{log.time}</span>
              <span className={`flex-shrink-0 mono ${PHASE_COLORS[log.phase] ?? 'text-slate-500'}`}>
                [{log.phase?.toUpperCase() ?? 'SYS'}]
              </span>
              <span className={`${LEVEL_STYLES[log.level] ?? 'text-slate-400'} break-all`}>{log.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
