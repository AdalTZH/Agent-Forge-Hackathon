/**
 * Agent Routes
 *
 * POST /api/agent/start      → kick off a new pipeline run
 * GET  /api/agent/stream/:id → SSE stream for live updates
 * GET  /api/agent/status/:id → current run status (polling fallback)
 * GET  /api/agent/report/:id → retrieve stored report from Acontext Disk
 */

import express from 'express';
import { startRun, getActiveRun } from '../services/agentOrchestrator.js';
import { readReport } from '../services/acontextService.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// ─────────────────────────────────────────────
// POST /api/agent/start
// ─────────────────────────────────────────────
router.post('/start', async (req, res) => {
  const { niche } = req.body;

  if (!niche || typeof niche !== 'string' || niche.trim().length < 3) {
    return res.status(400).json({ error: 'niche must be a string of at least 3 characters' });
  }

  try {
    const runId = await startRun(niche.trim());
    logger.info('Routes', `Run started: ${runId} for "${niche}"`);
    return res.status(202).json({ runId, niche: niche.trim(), message: 'Agent pipeline started' });
  } catch (err) {
    logger.error('Routes', 'Failed to start run', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/agent/stream/:runId
// Server-Sent Events — real-time pipeline updates
// ─────────────────────────────────────────────
router.get('/stream/:runId', (req, res) => {
  const { runId } = req.params;
  const run = getActiveRun(runId);

  if (!run) {
    return res.status(404).json({ error: 'Run not found' });
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering if behind proxy
  res.flushHeaders();

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Heartbeat to prevent connection timeout
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 20_000);

  // Forward pipeline events to this SSE connection
  const handler = (event) => {
    send(event);
    if (event.type === 'done' || event.type === 'error') {
      cleanup();
    }
  };

  run.emitter.on('event', handler);

  // If run already completed, send the current report and close
  if (run.status === 'complete' || run.status === 'error') {
    const report = readReport(run.sessionId);
    if (report) send({ type: 'report_ready', report });
    send({ type: 'done', runId });
    cleanup();
    return;
  }

  function cleanup() {
    clearInterval(heartbeat);
    run.emitter.off('event', handler);
    res.end();
  }

  req.on('close', cleanup);
});

// ─────────────────────────────────────────────
// GET /api/agent/status/:runId
// ─────────────────────────────────────────────
router.get('/status/:runId', (req, res) => {
  const run = getActiveRun(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });

  return res.json({
    runId: req.params.runId,
    status: run.status,
    niche: run.niche,
    startedAt: run.startedAt,
  });
});

// ─────────────────────────────────────────────
// GET /api/agent/report/:runId
// ─────────────────────────────────────────────
router.get('/report/:runId', (req, res) => {
  const run = getActiveRun(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });

  const report = readReport(run.sessionId);
  if (!report) return res.status(404).json({ error: 'Report not yet available' });

  return res.json(report);
});

export default router;
