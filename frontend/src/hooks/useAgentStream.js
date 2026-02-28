import { useState, useEffect, useCallback, useRef } from 'react';

const API_BASE = '/api/agent';

/**
 * Custom hook that manages the full agent run lifecycle:
 *   - POST /api/agent/start to kick off the pipeline
 *   - GET  /api/agent/stream/:runId via SSE for live events
 *   - Accumulates agent state (logs, task blocks, report) in local state
 */
export function useAgentStream() {
  const [status, setStatus] = useState('idle'); // idle | starting | running | complete | error
  const [runId, setRunId] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [logs, setLogs] = useState([]);
  const [taskBlocks, setTaskBlocks] = useState([]);
  const [currentPhase, setCurrentPhase] = useState(null);
  const [report, setReport] = useState(null);
  const [screenshots, setScreenshots] = useState([]);
  const [browserFeed, setBrowserFeed] = useState([]);
  const [painPoints, setPainPoints] = useState([]);
  const [topProblem, setTopProblem] = useState(null);
  const [gapAnalysis, setGapAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({ postsFound: 0, painPointsFound: 0, competitorsChecked: 0 });

  const eventSourceRef = useRef(null);

  const addLog = useCallback((entry) => {
    setLogs((prev) => [...prev, { id: Date.now() + Math.random(), time: new Date().toLocaleTimeString(), ...entry }]);
  }, []);

  const processEvent = useCallback((event) => {
    switch (event.type) {
      case 'run_start':
        setStatus('running');
        setCurrentPhase('scout');
        addLog({ level: 'info', phase: 'init', message: event.message });
        break;

      case 'session_created':
        setSessionId(event.sessionId);
        setTaskBlocks(event.taskBlocks ?? []);
        addLog({ level: 'success', phase: 'init', message: `Acontext session ${event.sessionId?.slice(0, 8)}… created` });
        break;

      case 'phase_start':
        setCurrentPhase(event.phase);
        addLog({ level: 'phase', phase: event.phase, message: event.message });
        break;

      case 'phase_complete':
        addLog({ level: 'success', phase: event.phase, message: event.message });
        break;

      case 'phase_warning':
        addLog({ level: 'warn', phase: event.phase, message: event.message });
        break;

      case 'search_complete':
        setStats((s) => ({ ...s, postsFound: event.count }));
        addLog({ level: 'info', phase: 'scout', message: `Bright Data: ${event.message}` });
        break;

      case 'scrape_complete':
        setStats((s) => ({ ...s, postsFound: event.count }));
        addLog({ level: 'info', phase: 'scout', message: `Scraped ${event.count} Reddit posts` });
        break;

      case 'task_update':
        setTaskBlocks((prev) =>
          prev.map((t) => (t.id === event.taskId ? { ...t, status: event.status } : t))
        );
        break;

      case 'pain_points_extracted':
        setStats((s) => ({ ...s, painPointsFound: event.count }));
        addLog({ level: 'info', phase: 'brain', message: `Extracted ${event.count} pain points` });
        if (event.preview) setPainPoints(event.preview.map((p) => ({ problem: p })));
        break;

      case 'top_problem_selected':
        setTopProblem(event);
        addLog({
          level: 'success',
          phase: 'brain',
          message: `Top problem: "${event.problem?.slice(0, 80)}…"`,
        });
        break;

      case 'browser_action':
        setBrowserFeed((prev) => [
          ...prev,
          {
            id: Date.now() + Math.random(),
            time: new Date().toLocaleTimeString(),
            competitor: event.competitor,
            action: event.action,
            message: event.message,
            screenshot: event.screenshot ?? null,
            data: event.data ?? null,
          },
        ]);
        setStats((s) => {
          const names = new Set([
            ...Array.from({ length: s.competitorsChecked }, (_, i) => i),
            event.competitor,
          ]);
          return { ...s, competitorsChecked: names.size };
        });
        addLog({ level: 'info', phase: 'validate', message: `[${event.competitor}] ${event.message}` });
        break;

      case 'gap_analysis_complete':
        setGapAnalysis(event);
        addLog({
          level: event.gapConfirmed ? 'success' : 'warn',
          phase: 'validate',
          message: `Gap ${event.gapConfirmed ? 'CONFIRMED' : 'not confirmed'} (${event.confidence} confidence)`,
        });
        break;

      case 'report_ready':
        setReport(event.report);
        setScreenshots(event.screenshots?.filter((s) => s.screenshot) ?? []);
        setCurrentPhase('complete');
        addLog({ level: 'success', phase: 'brief', message: '📄 Opportunity Brief ready!' });
        break;

      case 'done':
        setStatus('complete');
        addLog({ level: 'success', phase: 'done', message: `Run complete in ${((event.durationMs ?? 0) / 1000).toFixed(1)}s` });
        break;

      case 'error':
        setStatus('error');
        setError(event.message);
        addLog({ level: 'error', phase: 'error', message: event.message });
        break;

      default:
        break;
    }
  }, [addLog]);

  const startAgent = useCallback(async (niche) => {
    setStatus('starting');
    setLogs([]);
    setTaskBlocks([]);
    setCurrentPhase(null);
    setReport(null);
    setScreenshots([]);
    setBrowserFeed([]);
    setPainPoints([]);
    setTopProblem(null);
    setGapAnalysis(null);
    setError(null);
    setStats({ postsFound: 0, painPointsFound: 0, competitorsChecked: 0 });

    try {
      const res = await fetch(`${API_BASE}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ niche }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Failed to start agent');
      }

      const { runId: id } = await res.json();
      setRunId(id);

      // Open SSE connection
      const es = new EventSource(`${API_BASE}/stream/${id}`);
      eventSourceRef.current = es;

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          processEvent(event);
        } catch {
          // ignore heartbeat comments and parse errors
        }
      };

      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          setStatus((s) => (s === 'running' || s === 'starting' ? 'complete' : s));
        }
      };
    } catch (err) {
      setStatus('error');
      setError(err.message);
    }
  }, [processEvent]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  return {
    status,
    runId,
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
  };
}
