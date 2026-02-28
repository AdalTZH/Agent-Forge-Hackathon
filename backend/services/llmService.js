/**
 * LLM Service — OpenAI API
 *
 * All reasoning calls are isolated here. Each function is a named Skill Block
 * in our agent architecture — they are the reusable prompt templates that
 * Acontext distills into long-term skills after a successful run.
 *
 * Skill Blocks:
 *   extractPainPoints       → parse raw Reddit content → structured pain points
 *   rankAndSelectProblem    → rank by frequency/severity → top problem
 *   analyseCompetitorData   → interpret browser results → gap confirmation
 *   generateOpportunityBrief → synthesise everything → final report
 */

import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import { extractJson, safeJsonParse } from '../utils/helpers.js';

const TAG = 'LLM(OpenAI)';
let _client = null;

function getClient() {
  if (_client) return _client;
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set in .env');
  _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

/**
 * Core wrapper — gpt-4o with JSON mode enforced for structured outputs.
 */
async function callGPT(systemPrompt, userContent, maxTokens = 2000) {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  });
  return response.choices[0].message.content ?? '';
}

// ─────────────────────────────────────────────
// SKILL BLOCK 1: Extract Pain Points
// ─────────────────────────────────────────────

export async function extractPainPoints(rawPosts, niche) {
  logger.info(TAG, 'Skill Block 1: extractPainPoints');

  // OpenAI JSON mode requires a root object — we wrap the array under "pain_points"
  const system = `You are a product research analyst specialising in identifying unmet market needs.
Extract pain points, frustrations, and unmet needs from Reddit posts.

Rules:
- Extract ONLY genuine complaints, frustrations, or wish-list items
- Skip posts about resolved problems or existing solutions
- Ignore sidebar content, ads, and off-topic comments
- Each pain point must be specific and actionable

Return a JSON object with key "pain_points" containing an array:
{
  "pain_points": [
    {
      "problem": "short description of the pain point",
      "verbatim_quote": "exact words from the post",
      "source_url": "reddit URL",
      "intensity": "high|medium|low",
      "category": "workflow|cost|discovery|collaboration|other"
    }
  ]
}`;

  const postsText = rawPosts
    .map((p, i) => `--- POST ${i + 1} (${p.url}) ---\n${p.content || p.snippet}`)
    .join('\n\n');

  const user = `Niche: "${niche}"\n\nReddit posts:\n\n${postsText}`;

  const raw = await callGPT(system, user, 3000);
  const parsed = safeJsonParse(raw);

  if (!parsed?.pain_points || !Array.isArray(parsed.pain_points)) {
    logger.warn(TAG, 'Unexpected format — trying extractJson fallback');
    return extractJson(raw) ?? [];
  }

  logger.success(TAG, `Extracted ${parsed.pain_points.length} pain points`);
  return parsed.pain_points;
}

// ─────────────────────────────────────────────
// SKILL BLOCK 2: Rank & Select Top Problem
// ─────────────────────────────────────────────

export async function rankAndSelectProblem(painPoints, niche) {
  logger.info(TAG, 'Skill Block 2: rankAndSelectProblem');

  const system = `You are a startup product strategist. Analyse pain points and identify the single best market opportunity.

Ranking criteria:
1. Frequency — how many posts mention this?
2. Intensity — how frustrated are users?
3. Market size — how many people face this?
4. Solution gap — how absent are current solutions?
5. Buildability — can software solve this?

Return a JSON object:
{
  "top_problem": "one sentence description",
  "frequency_score": 1-10,
  "severity_score": 1-10,
  "market_size_estimate": "description",
  "gap_keyword": "2-3 word search term to verify gap in competitors",
  "supporting_quotes": [{ "text": "...", "source": "..." }],
  "why_this_wins": "2-3 sentences",
  "runner_up": "one sentence on second-best problem"
}`;

  const user = `Niche: "${niche}"\n\nPain points:\n${JSON.stringify(painPoints, null, 2)}`;

  const raw = await callGPT(system, user, 1500);
  const parsed = safeJsonParse(raw);

  if (!parsed?.top_problem) {
    logger.warn(TAG, 'Ranking returned unexpected format');
    return null;
  }

  logger.success(TAG, `Top problem: "${parsed.top_problem}"`);
  return parsed;
}

// ─────────────────────────────────────────────
// SKILL BLOCK 3: Analyse Competitor Gap Data
// ─────────────────────────────────────────────

export async function analyseCompetitorData(competitorResults, topProblem) {
  logger.info(TAG, 'Skill Block 3: analyseCompetitorData');

  const system = `You are a competitive intelligence analyst. Interpret browser automation results from competitor websites to determine whether a market gap is confirmed.

Return a JSON object:
{
  "gap_confirmed": true,
  "confidence": "high|medium|low",
  "gap_summary": "one paragraph explaining the gap and evidence",
  "competitors_missing_feature": ["Competitor A", "Competitor B"],
  "differentiator": "what a new product could uniquely offer",
  "market_entry_angle": "how to position against these competitors"
}`;

  // Strip screenshots and truncate scraped content to prevent context overflow.
  // Screenshots are base64 and can be hundreds of KB each. Notes + scrapedContent
  // from Puppeteer can also be many KB — cap at 800 chars per competitor.
  const safeResults = competitorResults.map(({ screenshot, scrapedContent, notes, ...rest }) => ({
    ...rest,
    notes: typeof notes === 'string' ? notes.slice(0, 800) : notes,
    ...(scrapedContent ? { scrapedContent: scrapedContent.slice(0, 800) } : {}),
  }));

  const user = `Top problem: "${topProblem?.top_problem}"\nGap keyword: "${topProblem?.gap_keyword}"\n\nCompetitor data:\n${JSON.stringify(safeResults, null, 2)}`;

  logger.info(TAG, `analyseCompetitorData payload: ~${Math.round(user.length / 4)} tokens estimated`);

  const raw = await callGPT(system, user, 1000);
  const parsed = safeJsonParse(raw);

  logger.success(TAG, `Gap confirmed: ${parsed?.gap_confirmed}`);
  return parsed ?? { gap_confirmed: false, confidence: 'low', gap_summary: 'Analysis inconclusive.' };
}

// ─────────────────────────────────────────────
// SKILL BLOCK 4: Generate Opportunity Brief
// ─────────────────────────────────────────────

export async function generateOpportunityBrief(niche, topProblem, gapAnalysis, competitorResults, painPoints) {
  logger.info(TAG, 'Skill Block 4: generateOpportunityBrief');

  const system = `You are a startup idea synthesiser. Create a compelling, investor-ready opportunity brief using real market research data. Be specific — use the actual data provided.

Return a JSON object:
{
  "headline": "punchy 8-10 word headline",
  "problem_statement": "2-3 sentence problem using evidence from research",
  "target_user": "specific description of who suffers most",
  "market_size_estimate": "qualitative estimate based on Reddit signals",
  "evidence_summary": "3-4 sentences citing specific Reddit signals and competitor gaps",
  "competitor_landscape": [{ "name": "...", "weakness": "..." }],
  "mvp_features": [{ "feature": "...", "why": "...", "priority": "must-have|nice-to-have" }],
  "go_to_market_angle": "2-3 sentences on how to acquire first 100 users",
  "suggested_name": "a catchy product name",
  "one_liner": "YC-style one-sentence pitch",
  "validation_confidence": "high|medium|low",
  "next_steps": ["step 1", "step 2", "step 3"]
}`;

  const user = `
Niche: "${niche}"
Top Problem: ${JSON.stringify(topProblem)}
Gap Analysis: ${JSON.stringify(gapAnalysis)}
Competitors Checked: ${competitorResults.map((c) => c.name).join(', ')}
Competitor Notes: ${competitorResults.map((c) => `${c.name}: ${c.notes}`).join(' | ')}
Sample Pain Points: ${JSON.stringify(painPoints.slice(0, 5))}`;

  const raw = await callGPT(system, user, 2500);
  const parsed = safeJsonParse(raw);

  if (!parsed?.headline) {
    logger.warn(TAG, 'Brief missing headline — returning degraded brief');
    return {
      headline: `Market gap identified in ${niche}`,
      problem_statement: topProblem?.top_problem ?? 'See pain points.',
      target_user: niche,
      mvp_features: [],
      validation_confidence: 'low',
    };
  }

  logger.success(TAG, `Brief: "${parsed.headline}"`);
  return parsed;
}

// ─────────────────────────────────────────────
// SKILL BLOCK 5: Identify Niche-Specific Competitors
// ─────────────────────────────────────────────

/**
 * Ask GPT-4o to identify the top 3 direct competitors for the given niche
 * and top problem. Returns a competitor config array compatible with the
 * checkCompetitorGap() function signature.
 *
 * This replaces the hardcoded COMPETITOR_TARGETS constant so that every niche
 * gets a relevant set of products checked — not always Buffer/Later/Notion.
 *
 * @param {string} niche
 * @param {Object|null} topProblem - { top_problem, gap_keyword }
 * @returns {Array<{ name, pricingUrl, featuresUrl, backup }>|null}
 */
export async function identifyCompetitors(niche, topProblem) {
  logger.info(TAG, 'Skill Block 5: identifyCompetitors');

  const system = `You are a competitive intelligence researcher.
Your job: identify the 3 most relevant DIRECT competitors that users in the given niche already use to solve their top problem.

Rules:
- Pick tools/products/apps that are widely used in this specific niche right now.
- Do NOT pick generic tools (e.g. Excel, Google Docs) unless they are the actual dominant solution in that niche.
- Prefer tools that have public pricing and features pages.
- Use real, currently-active products with real URLs you are confident exist.

Return a JSON object:
{
  "competitors": [
    {
      "name": "Exact Product Name",
      "pricingUrl": "https://exactdomain.com/pricing",
      "featuresUrl": "https://exactdomain.com/features",
      "backup": "https://exactdomain.com"
    }
  ]
}`;

  const user = `Niche: "${niche}"
Top Problem: "${topProblem?.top_problem ?? 'not yet identified'}"
Gap Keyword: "${topProblem?.gap_keyword ?? ''}"`;

  try {
    const raw = await callGPT(system, user, 800);
    const parsed = safeJsonParse(raw);

    if (!parsed?.competitors || !Array.isArray(parsed.competitors) || parsed.competitors.length === 0) {
      logger.warn(TAG, 'identifyCompetitors: unexpected format — falling back to defaults');
      return null;
    }

    // Ensure every entry has the required fields (guard against partial GPT output)
    const valid = parsed.competitors.filter(
      (c) => c.name && c.pricingUrl && c.featuresUrl
    );

    if (valid.length === 0) {
      logger.warn(TAG, 'identifyCompetitors: all entries missing required fields');
      return null;
    }

    logger.success(TAG, `Identified competitors: ${valid.map((c) => c.name).join(', ')}`);
    return valid;
  } catch (err) {
    logger.warn(TAG, `identifyCompetitors failed (non-fatal): ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────
// SKILL BLOCK 6: Clean and filter raw posts
// ─────────────────────────────────────────────

/**
 * Clean raw post list before Acontext storage.
 * Returns only posts containing genuine problem signals.
 */
export async function cleanAndFilterPosts(rawPosts, niche) {
  logger.info(TAG, 'Cleaning raw post data…');

  // JSON mode requires a root object
  const system = `Filter Reddit posts. Keep only those expressing a problem, frustration, or unmet need related to the niche.
Return a JSON object: { "keep_urls": ["url1", "url2", ...] }`;

  const user = `Niche: "${niche}"\nPosts:\n${rawPosts.map((p) => `${p.url}: ${p.snippet}`).join('\n')}`;

  try {
    const raw = await callGPT(system, user, 600);
    const parsed = safeJsonParse(raw);
    if (Array.isArray(parsed?.keep_urls)) {
      const filtered = rawPosts.filter((p) => parsed.keep_urls.includes(p.url));
      return filtered.length >= 5 ? filtered : rawPosts;
    }
  } catch (err) {
    logger.warn(TAG, `Post cleaning failed (non-critical): ${err.message}`);
  }

  return rawPosts;
}
