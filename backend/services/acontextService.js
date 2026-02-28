/**
 * Acontext Service
 *
 * Manages all agent memory using the @acontext/acontext TypeScript SDK.
 *
 * Architecture:
 *   Session  → stores the live conversation history and intermediate agent state
 *   Disk     → virtual persistent filesystem; we use it for the Market Gap Report
 *   Space    → learning space that distills successful runs into reusable skills
 *
 * Primitives used:
 *   client.sessions.create()            → start a new session
 *   client.sessions.storeMessage()      → append a message to the session log
 *   client.sessions.getMessages()       → retrieve session history
 *   client.sessions.flush()             → trigger mid-term state extraction
 *   client.sessions.getSessionSummary() → get auto-extracted task summary
 *   client.learningSpaces.create()      → create a learning space for this run
 *   client.learningSpaces.learn()       → attach session → space (triggers skill distillation)
 */

import { AcontextClient } from '@acontext/acontext';
import { logger } from '../utils/logger.js';

const TAG = 'Acontext';

let _client = null;

function getClient() {
  if (_client) return _client;

  if (!process.env.ACONTEXT_API_KEY) {
    throw new Error('ACONTEXT_API_KEY is not set in .env');
  }

  _client = new AcontextClient({ apiKey: process.env.ACONTEXT_API_KEY });
  logger.success(TAG, 'Client initialised');
  return _client;
}

// ─────────────────────────────────────────────
// Session management
// ─────────────────────────────────────────────

/**
 * Create a new agent session for a single pipeline run.
 * Returns the session object (contains .id).
 */
export async function createSession(niche) {
  const client = getClient();
  const session = await client.sessions.create();
  logger.success(TAG, `Session created: ${session.id} for niche "${niche}"`);

  // Store the initial system context as the first message
  await client.sessions.storeMessage(session.id, {
    blob: {
      role: 'user',
      content: `Agent run started. Niche: "${niche}". Task: Discover market gaps and validate them against competitor offerings.`,
    },
  });

  return session;
}

/**
 * Append a structured message to the session log.
 * role: 'user' | 'assistant'
 */
export async function storeMessage(sessionId, role, content) {
  const client = getClient();
  await client.sessions.storeMessage(sessionId, {
    blob: { role, content: typeof content === 'string' ? content : JSON.stringify(content) },
  });
}

/**
 * Retrieve full session message history.
 */
export async function getMessages(sessionId) {
  const client = getClient();
  const result = await client.sessions.getMessages(sessionId);
  return result;
}

/**
 * Flush the session to trigger mid-term state extraction (task tracking).
 * Returns the session summary produced by Acontext's background agent.
 */
export async function flushAndSummarise(sessionId) {
  const client = getClient();
  await client.sessions.flush(sessionId);
  const summary = await client.sessions.getSessionSummary({ sessionId });
  logger.success(TAG, `Session ${sessionId} flushed. Summary:`, summary?.summary?.slice?.(0, 80));
  return summary;
}

// ─────────────────────────────────────────────
// Disk — persistent report storage
// ─────────────────────────────────────────────

/**
 * In-process report store keyed by sessionId.
 * Acontext Disk is for file/artifact storage; we persist the JSON report here
 * by encoding it as an assistant message with a special prefix so it survives
 * session retrieval. (Disk file upload APIs require binary multipart — for the
 * hackathon we use the session message channel as structured disk storage.)
 */
const reportStore = new Map();

/**
 * Write or update the Market Gap Report on the virtual Disk for this session.
 */
export async function writeReport(sessionId, reportData) {
  reportStore.set(sessionId, { ...reportStore.get(sessionId), ...reportData, updatedAt: new Date().toISOString() });

  // Also persist to the session so judges can see it in Acontext dashboard
  const client = getClient();
  await client.sessions.storeMessage(sessionId, {
    blob: {
      role: 'assistant',
      content: `[DISK:market_gap_report] ${JSON.stringify(reportStore.get(sessionId))}`,
    },
  });

  logger.success(TAG, `Disk updated for session ${sessionId}`);
  return reportStore.get(sessionId);
}

/**
 * Read the current report from the virtual Disk.
 */
export function readReport(sessionId) {
  return reportStore.get(sessionId) ?? null;
}

// ─────────────────────────────────────────────
// Learning Space — long-term skill distillation
// ─────────────────────────────────────────────

/**
 * Create a Learning Space for this niche run and attach the session.
 * Acontext will distill the successful run into a reusable skill file.
 */
export async function createLearningSpace(niche, sessionId) {
  const client = getClient();
  try {
    const space = await client.learningSpaces.create();
    logger.success(TAG, `Learning space created: ${space.id}`);

    // Attach the session — Acontext will begin background skill distillation
    await client.learningSpaces.learn(space.id, { sessionId });
    logger.info(TAG, `Session ${sessionId} attached to space ${space.id} for skill learning`);

    return space;
  } catch (err) {
    // Space creation is non-critical for the demo; log and continue
    logger.warn(TAG, `Learning space setup failed (non-critical): ${err.message}`);
    return null;
  }
}

/**
 * Retrieve skills learned in a space (shown in the Mission Control panel).
 */
export async function listSkills(spaceId) {
  if (!spaceId) return [];
  const client = getClient();
  try {
    return await client.learningSpaces.listSkills(spaceId);
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────
// Task Block tracking (mid-term state)
// ─────────────────────────────────────────────

const taskBlocks = [
  { id: 'extract_pain_points', label: 'Extract Pain Points', status: 'pending' },
  { id: 'rank_and_select', label: 'Rank & Select Top Problem', status: 'pending' },
  { id: 'verify_competitor_gaps', label: 'Verify Competitor Gaps', status: 'pending' },
  { id: 'generate_opportunity_brief', label: 'Generate Opportunity Brief', status: 'pending' },
];

const taskState = new Map();

export function initTaskBlocks(sessionId) {
  taskState.set(sessionId, taskBlocks.map((t) => ({ ...t })));
}

export function updateTaskBlock(sessionId, taskId, status) {
  const blocks = taskState.get(sessionId);
  if (!blocks) return;
  const task = blocks.find((t) => t.id === taskId);
  if (task) task.status = status;
}

export function getTaskBlocks(sessionId) {
  return taskState.get(sessionId) ?? [];
}
