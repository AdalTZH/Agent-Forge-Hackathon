/**
 * Agent Orchestrator — LangGraph StateGraph
 *
 * The pipeline is modelled as a directed StateGraph with 4 nodes:
 *
 *   START → scoutNode → brainNode → validateNode → briefNode → END
 *
 * Each node:
 *   - Receives the full AgentState
 *   - Does its work (calls its service)
 *   - Returns a *partial* state update (LangGraph merges it in)
 *   - Emits real-time SSE events via state.emit()
 *
 * Why LangGraph over a custom pipeline:
 *   - State is typed, immutable between nodes, and automatically persisted
 *   - Each node is independently testable
 *   - Conditional edges let us add retry/branch logic cleanly later
 *   - LangGraph's execution model handles errors per-node without killing the run
 *   - Easy to add human-in-the-loop checkpoints (state.interrupt) in future
 */

import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import {
  searchRedditPainPoints,
  scrapeRedditPosts,
  scrapeCompetitorPage,
  closeBrightData,
} from './brightDataService.js';
import {
  createSession,
  storeMessage,
  writeReport,
  readReport,
  flushAndSummarise,
  createLearningSpace,
  initTaskBlocks,
  updateTaskBlock,
  getTaskBlocks,
} from './acontextService.js';
import { verifyAllCompetitors } from './actionbookService.js';
import {
  cleanAndFilterPosts,
  extractPainPoints,
  rankAndSelectProblem,
  analyseCompetitorData,
  generateOpportunityBrief,
} from './llmService.js';

const TAG = 'Orchestrator(LangGraph)';

// ─────────────────────────────────────────────
// 1. Define the LangGraph State
//
// Annotation.Root creates a typed state schema.
// Each field's reducer controls how partial updates are merged.
// Default: last-write wins (replace). For arrays, we accumulate.
// ─────────────────────────────────────────────
const AgentState = Annotation.Root({
  // ── Run metadata ──────────────────────────────────
  runId:     Annotation({ reducer: (_, v) => v, default: () => '' }),
  niche:     Annotation({ reducer: (_, v) => v, default: () => '' }),
  sessionId: Annotation({ reducer: (_, v) => v, default: () => '' }),
  spaceId:   Annotation({ reducer: (_, v) => v, default: () => null }),

  // ── Scout phase (Bright Data) ─────────────────────
  searchResults: Annotation({ reducer: (_, v) => v, default: () => [] }),
  rawPosts:      Annotation({ reducer: (_, v) => v, default: () => [] }),

  // ── Brain phase (Acontext + LLM) ──────────────────
  painPoints:  Annotation({ reducer: (_, v) => v, default: () => [] }),
  topProblem:  Annotation({ reducer: (_, v) => v, default: () => null }),

  // ── Validate phase (ActionBook + Puppeteer + LLM) ──
  competitorResults: Annotation({ reducer: (_, v) => v, default: () => [] }),
  gapAnalysis:       Annotation({ reducer: (_, v) => v, default: () => null }),

  // ── Brief phase (LLM) ─────────────────────────────
  opportunityBrief: Annotation({ reducer: (_, v) => v, default: () => null }),

  // ── Internal: SSE emitter (not serialised) ────────
  // We store emit as a function reference in state so nodes can fire live events.
  emit: Annotation({ reducer: (_, v) => v, default: () => () => {} }),

  // ── Error tracking ───────────────────────────────
  errors: Annotation({
    reducer: (acc, v) => [...acc, ...v],
    default: () => [],
  }),
});

// ─────────────────────────────────────────────
// 2. Node: scoutNode — Bright Data
//    Searches Reddit, scrapes posts, cleans data
// ─────────────────────────────────────────────
async function scoutNode(state) {
  const { niche, sessionId, emit } = state;
  logger.phase('SCOUT');
  emit('phase_start', { phase: 'scout', message: 'Phase 1: Scouting Reddit for pain points…' });

  let searchResults = [];
  let rawPosts = [];
  const errors = [];

  try {
    searchResults = await searchRedditPainPoints(niche);
    emit('search_complete', {
      count: searchResults.length,
      message: `Bright Data found ${searchResults.length} Reddit URLs`,
      urls: searchResults.slice(0, 5).map((r) => r.url),
    });

    rawPosts = await scrapeRedditPosts(searchResults, 15);
    emit('scrape_complete', {
      count: rawPosts.length,
      message: `Scraped ${rawPosts.length} Reddit posts`,
      preview: rawPosts.slice(0, 3).map((p) => ({ url: p.url, snippet: p.snippet?.slice(0, 120) })),
    });

    // Filter for signal quality
    const filtered = await cleanAndFilterPosts(rawPosts, niche);
    rawPosts = filtered.length >= 5 ? filtered : rawPosts;

    await storeMessage(sessionId, 'assistant', `[SCOUT] Scraped ${rawPosts.length} posts for niche "${niche}"`);
  } catch (err) {
    logger.error(TAG, 'Scout node error', err);
    errors.push({ phase: 'scout', message: err.message });
    emit('phase_warning', { phase: 'scout', message: `Scout degraded: ${err.message}` });

    // Fallback: use search snippets if scraping failed entirely
    if (rawPosts.length === 0 && searchResults.length > 0) {
      rawPosts = searchResults.map((r) => ({ ...r, content: r.snippet }));
    }
  }

  emit('phase_complete', { phase: 'scout', message: `Scout complete — ${rawPosts.length} posts collected` });

  return { searchResults, rawPosts, errors };
}

// ─────────────────────────────────────────────
// 3. Node: brainNode — Acontext + LLM
//    Extracts pain points, ranks, writes to Disk
// ─────────────────────────────────────────────
async function brainNode(state) {
  const { niche, sessionId, rawPosts, emit } = state;
  logger.phase('BRAIN');
  emit('phase_start', { phase: 'brain', message: 'Phase 2: Analysing pain points and identifying top problem…' });

  let painPoints = [];
  let topProblem = null;
  const errors = [];

  try {
    // Task Block 1
    updateTaskBlock(sessionId, 'extract_pain_points', 'running');
    emit('task_update', { taskId: 'extract_pain_points', status: 'running' });

    painPoints = await extractPainPoints(rawPosts, niche);

    updateTaskBlock(sessionId, 'extract_pain_points', 'complete');
    emit('task_update', { taskId: 'extract_pain_points', status: 'complete' });
    emit('pain_points_extracted', {
      count: painPoints.length,
      preview: painPoints.slice(0, 3).map((p) => p.problem),
    });

    await storeMessage(sessionId, 'assistant', `[BRAIN] Extracted ${painPoints.length} pain points.`);
    await writeReport(sessionId, { painPoints });

    // Task Block 2
    updateTaskBlock(sessionId, 'rank_and_select', 'running');
    emit('task_update', { taskId: 'rank_and_select', status: 'running' });

    topProblem = await rankAndSelectProblem(painPoints, niche);

    updateTaskBlock(sessionId, 'rank_and_select', 'complete');
    emit('task_update', { taskId: 'rank_and_select', status: 'complete' });
    emit('top_problem_selected', {
      problem: topProblem?.top_problem,
      frequency: topProblem?.frequency_score,
      severity: topProblem?.severity_score,
      keyword: topProblem?.gap_keyword,
    });

    await storeMessage(sessionId, 'assistant', `[BRAIN] Top problem: "${topProblem?.top_problem}". Gap keyword: "${topProblem?.gap_keyword}"`);
    await writeReport(sessionId, { topProblem });
  } catch (err) {
    logger.error(TAG, 'Brain node error', err);
    errors.push({ phase: 'brain', message: err.message });
    updateTaskBlock(sessionId, 'extract_pain_points', 'error');
    updateTaskBlock(sessionId, 'rank_and_select', 'error');
    emit('phase_warning', { phase: 'brain', message: `Analysis degraded: ${err.message}` });
  }

  emit('phase_complete', { phase: 'brain', message: 'Brain complete — top problem identified' });

  return { painPoints, topProblem, errors };
}

// ─────────────────────────────────────────────
// 4. Node: validateNode — ActionBook + Puppeteer + LLM
//    Navigates competitors, takes screenshots, confirms gap
// ─────────────────────────────────────────────
async function validateNode(state) {
  const { sessionId, topProblem, emit } = state;
  logger.phase('VALIDATE');
  emit('phase_start', { phase: 'validate', message: 'Phase 3: Verifying competitor gaps with ActionBook…' });

  updateTaskBlock(sessionId, 'verify_competitor_gaps', 'running');
  emit('task_update', { taskId: 'verify_competitor_gaps', status: 'running' });

  let competitorResults = [];
  let gapAnalysis = null;
  const errors = [];

  try {
    const targetKeyword = topProblem?.gap_keyword ?? '';

    competitorResults = await verifyAllCompetitors(targetKeyword, (type, data) => {
      emit(type, data);
    });

    // Bright Data fallback for any competitor Puppeteer couldn't access
    for (const result of competitorResults) {
      if (!result.success && !result.notes) {
        emit('browser_action', {
          competitor: result.name,
          action: 'fallback',
          message: `Falling back to Bright Data scrape for ${result.name}`,
        });
        const scraped = await scrapeCompetitorPage(result.pricingUrl);
        if (scraped.success) result.scrapedContent = scraped.content.slice(0, 1000);
      }
    }

    gapAnalysis = await analyseCompetitorData(competitorResults, topProblem);

    updateTaskBlock(sessionId, 'verify_competitor_gaps', 'complete');
    emit('task_update', { taskId: 'verify_competitor_gaps', status: 'complete' });
    emit('gap_analysis_complete', {
      gapConfirmed: gapAnalysis?.gap_confirmed,
      confidence: gapAnalysis?.confidence,
      summary: gapAnalysis?.gap_summary,
      competitorsMissing: gapAnalysis?.competitors_missing_feature,
    });

    // Strip base64 screenshots from the session message (too large)
    const storableResults = competitorResults.map(({ screenshot, ...rest }) => rest);
    await storeMessage(sessionId, 'assistant', `[VALIDATE] Gap confirmed: ${gapAnalysis?.gap_confirmed}. ${gapAnalysis?.gap_summary?.slice(0, 200)}`);
    await writeReport(sessionId, { competitorResults: storableResults, gapAnalysis });
  } catch (err) {
    logger.error(TAG, 'Validate node error', err);
    errors.push({ phase: 'validate', message: err.message });
    updateTaskBlock(sessionId, 'verify_competitor_gaps', 'error');
    emit('phase_warning', { phase: 'validate', message: `Validation degraded: ${err.message}` });
    gapAnalysis = { gap_confirmed: false, confidence: 'low', gap_summary: 'Automated validation failed.' };
  }

  emit('phase_complete', { phase: 'validate', message: 'Validation complete — evidence collected' });

  return { competitorResults, gapAnalysis, errors };
}

// ─────────────────────────────────────────────
// 5. Node: briefNode — LLM synthesis + Acontext final Disk write
// ─────────────────────────────────────────────
async function briefNode(state) {
  const { niche, sessionId, painPoints, topProblem, gapAnalysis, competitorResults, emit } = state;
  logger.phase('BRIEF');
  emit('phase_start', { phase: 'brief', message: 'Phase 4: Generating Opportunity Brief…' });

  updateTaskBlock(sessionId, 'generate_opportunity_brief', 'running');
  emit('task_update', { taskId: 'generate_opportunity_brief', status: 'running' });

  let opportunityBrief = null;
  const errors = [];

  try {
    opportunityBrief = await generateOpportunityBrief(
      niche,
      topProblem,
      gapAnalysis,
      competitorResults,
      painPoints
    );

    updateTaskBlock(sessionId, 'generate_opportunity_brief', 'complete');
    emit('task_update', { taskId: 'generate_opportunity_brief', status: 'complete' });

    // Flush session → triggers Acontext mid-term state extraction
    await flushAndSummarise(sessionId);

    // Final Disk write — authoritative report
    await writeReport(sessionId, {
      opportunityBrief,
      status: 'complete',
      completedAt: new Date().toISOString(),
      taskBlocks: getTaskBlocks(sessionId),
    });

    await storeMessage(sessionId, 'assistant', `[BRIEF] Opportunity Brief: "${opportunityBrief.headline}"`);

    const fullReport = readReport(sessionId);

    emit('report_ready', {
      report: fullReport,
      screenshots: competitorResults.map((c) => ({ name: c.name, screenshot: c.screenshot })),
      message: 'Market Gap Report is ready!',
    });

    logger.success(TAG, `Pipeline complete: "${opportunityBrief.headline}"`);
  } catch (err) {
    logger.error(TAG, 'Brief node error', err);
    errors.push({ phase: 'brief', message: err.message });
    updateTaskBlock(sessionId, 'generate_opportunity_brief', 'error');
    emit('phase_warning', { phase: 'brief', message: `Brief generation failed: ${err.message}` });
  }

  return { opportunityBrief, errors };
}

// ─────────────────────────────────────────────
// 6. Compile the StateGraph
//    START → scout → brain → validate → brief → END
// ─────────────────────────────────────────────
const graph = new StateGraph(AgentState)
  .addNode('scout',    scoutNode)
  .addNode('brain',    brainNode)
  .addNode('validate', validateNode)
  .addNode('brief',    briefNode)
  .addEdge(START,      'scout')
  .addEdge('scout',    'brain')
  .addEdge('brain',    'validate')
  .addEdge('validate', 'brief')
  .addEdge('brief',    END)
  .compile();

// ─────────────────────────────────────────────
// 7. Public API
// ─────────────────────────────────────────────

// Active run registry — keyed by runId
const activeRuns = new Map();

export function getActiveRun(runId) {
  return activeRuns.get(runId);
}

/**
 * Start a new agent run.
 * Initialises Acontext context, then invokes the compiled LangGraph.
 * Returns runId immediately; the graph runs asynchronously.
 */
export async function startRun(niche) {
  const runId = uuidv4();
  const emitter = new EventEmitter();

  activeRuns.set(runId, { emitter, status: 'running', niche, startedAt: new Date().toISOString() });

  // Fire-and-forget — the SSE stream carries all updates
  runGraph(runId, niche, emitter).catch((err) => {
    logger.error(TAG, `Unhandled graph error for run ${runId}`, err);
    emitter.emit('event', { type: 'error', message: err.message });
    emitter.emit('event', { type: 'done', runId });
  });

  return runId;
}

async function runGraph(runId, niche, emitter) {
  // Convenience: wrap emitter.emit so nodes receive a simple (type, data) function
  const emit = (type, data = {}) => {
    emitter.emit('event', { type, runId, timestamp: new Date().toISOString(), ...data });
  };

  let session = null;
  let space = null;

  try {
    emit('run_start', { niche, message: `Agent starting for niche: "${niche}"` });

    // ── Bootstrap Acontext context before graph starts ──────────────────
    session = await createSession(niche);
    space = await createLearningSpace(niche, session.id);
    initTaskBlocks(session.id);

    emit('session_created', {
      sessionId: session.id,
      spaceId: space?.id ?? null,
      taskBlocks: getTaskBlocks(session.id),
    });

    await writeReport(session.id, {
      runId,
      niche,
      sessionId: session.id,
      spaceId: space?.id ?? null,
      status: 'running',
    });

    // ── Invoke the compiled LangGraph ────────────────────────────────────
    // The initial state seeds the graph. Each node mutates and returns
    // a partial update; LangGraph merges them into the running state.
    const finalState = await graph.invoke({
      runId,
      niche,
      sessionId: session.id,
      spaceId: space?.id ?? null,
      emit, // nodes access this from state.emit
    });

    logger.success(TAG, `Graph completed for run ${runId}`);

    activeRuns.set(runId, {
      ...activeRuns.get(runId),
      status: finalState.errors?.length ? 'complete_with_warnings' : 'complete',
      sessionId: session.id,
    });

    emit('done', {
      runId,
      sessionId: session.id,
      message: 'Agent run complete',
      warnings: finalState.errors?.length ?? 0,
      durationMs: Date.now() - new Date(activeRuns.get(runId)?.startedAt).getTime(),
    });
  } catch (err) {
    logger.error(TAG, `Graph fatal error for ${runId}`, err);
    emit('error', { message: err.message });
    emit('done', { runId, message: 'Run ended with errors' });
    activeRuns.set(runId, { ...activeRuns.get(runId), status: 'error' });
  } finally {
    await closeBrightData().catch(() => {});
  }
}
