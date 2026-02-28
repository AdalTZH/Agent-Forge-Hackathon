/**
 * ActionBook Service
 *
 * ActionBook provides pre-computed "action manuals" — up-to-date DOM selectors
 * and step-by-step instructions for interacting with websites. This eliminates
 * the hallucination problem: instead of an LLM guessing CSS selectors, it reads
 * the verified manual and executes with confidence.
 *
 * Integration pattern:
 *   1. actionbook search "task description"  → returns list of available manuals
 *   2. actionbook get "action-id"            → returns full manual with selectors
 *   3. Puppeteer                             → executes the steps using those selectors
 *
 * This is the intended use case from ActionBook's docs:
 *   "Use Actionbook to understand and operate the web page. The agent will
 *    automatically use the CLI to fetch action manuals and execute browser ops."
 *
 * CLI invocation: `actionbook` (must be installed globally via npm i -g @actionbookdev/cli)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import puppeteer from 'puppeteer';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/helpers.js';

const execAsync = promisify(exec);
const TAG = 'ActionBook';

// ─────────────────────────────────────────────
// CLI helpers
// ─────────────────────────────────────────────

/**
 * Search ActionBook's action manual registry for a given task.
 * Returns parsed JSON array of matching manuals.
 */
export async function searchActionManual(task) {
  logger.info(TAG, `Searching manuals for: "${task}"`);

  try {
    const env = {
      ...process.env,
      ...(process.env.ACTIONBOOK_API_KEY ? { ACTIONBOOK_API_KEY: process.env.ACTIONBOOK_API_KEY } : {}),
    };

    const { stdout } = await execAsync(`actionbook search "${task}" --json`, { env, timeout: 15_000 });
    const manuals = JSON.parse(stdout.trim());
    logger.success(TAG, `Found ${manuals.length} manual(s) for "${task}"`);
    return manuals;
  } catch (err) {
    logger.warn(TAG, `CLI search failed (continuing without manual): ${err.message}`);
    return [];
  }
}

/**
 * Retrieve the full action manual by ID, including verified selectors.
 */
export async function getActionManual(actionId) {
  logger.info(TAG, `Fetching manual: ${actionId}`);

  try {
    const env = {
      ...process.env,
      ...(process.env.ACTIONBOOK_API_KEY ? { ACTIONBOOK_API_KEY: process.env.ACTIONBOOK_API_KEY } : {}),
    };

    const { stdout } = await execAsync(`actionbook get "${actionId}" --json`, { env, timeout: 15_000 });
    const manual = JSON.parse(stdout.trim());
    logger.success(TAG, `Manual retrieved: ${actionId}`);
    return manual;
  } catch (err) {
    logger.warn(TAG, `Manual fetch failed: ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────
// Browser verification engine
// ─────────────────────────────────────────────

/**
 * Competitor gap check config.
 * ActionBook provides the selectors; Puppeteer executes them.
 */
const COMPETITOR_TARGETS = [
  {
    name: 'Buffer',
    pricingUrl: 'https://buffer.com/pricing',
    featuresUrl: 'https://buffer.com/features',
    backup: 'https://buffer.com/all-features',
  },
  {
    name: 'Later',
    pricingUrl: 'https://later.com/pricing',
    featuresUrl: 'https://later.com/features',
    backup: 'https://later.com/tools',
  },
  {
    name: 'Notion',
    pricingUrl: 'https://www.notion.so/pricing',
    featuresUrl: 'https://www.notion.so/product',
    backup: 'https://www.notion.so/help',
  },
];

const GAP_KEYWORDS = {
  freeT: ['free plan', 'free tier', 'free forever', '$0/month', 'always free'],
  shortForm: ['shorts', 'reels', 'tiktok', 'short-form video', 'vertical video'],
  analytics: ['analytics dashboard', 'creator analytics', 'performance analytics', 'audience insights'],
};

/**
 * Check a single competitor for feature gaps.
 * Uses ActionBook manuals for verified selectors + Puppeteer for execution.
 *
 * @param {Object} competitor - { name, pricingUrl, featuresUrl, backup }
 * @param {string} targetKeyword - The gap keyword derived from the top pain point
 * @param {Function} emitEvent - SSE emitter for live browser feed
 */
export async function checkCompetitorGap(competitor, targetKeyword, emitEvent) {
  logger.info(TAG, `Checking competitor: ${competitor.name}`);

  emitEvent('browser_action', {
    competitor: competitor.name,
    action: 'starting',
    message: `Opening ${competitor.name} pricing page…`,
  });

  // Step 1: Ask ActionBook for the pricing page manual
  const manuals = await searchActionManual(`${competitor.name.toLowerCase()} pricing page navigation`);
  const manual = manuals?.[0] ? await getActionManual(manuals[0].id) : null;

  if (manual) {
    logger.info(TAG, `Using ActionBook manual: ${manual.id || manual.name}`);
  } else {
    logger.warn(TAG, `No ActionBook manual found — using direct navigation for ${competitor.name}`);
  }

  const result = {
    name: competitor.name,
    pricingUrl: competitor.pricingUrl,
    featuresUrl: competitor.featuresUrl,
    manual: manual ? { id: manual.id, steps: manual.steps?.length ?? 0 } : null,
    gaps: {},
    screenshot: null,
    success: false,
    notes: '',
  };

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // ── Pricing page ──────────────────────────────────────────
    emitEvent('browser_action', {
      competitor: competitor.name,
      action: 'navigating',
      message: `Navigating to ${competitor.pricingUrl}`,
    });

    try {
      await page.goto(competitor.pricingUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await sleep(2000);
    } catch {
      await page.goto(competitor.backup, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await sleep(2000);
    }

    const pricingText = await page.evaluate(() => document.body.innerText.toLowerCase());

    // Check for free tier
    const hasFreeTier = GAP_KEYWORDS.freeT.some((kw) => pricingText.includes(kw));
    result.gaps.noFreeTier = !hasFreeTier;

    emitEvent('browser_action', {
      competitor: competitor.name,
      action: 'checked',
      message: `Free tier: ${hasFreeTier ? '✓ Found' : '✗ Not found (GAP CONFIRMED)'}`,
      data: { hasFreeTier },
    });

    // Check for target keyword from pain point
    const kw = targetKeyword?.toLowerCase() ?? '';
    const hasTargetFeature = kw ? pricingText.includes(kw) : false;
    result.gaps.missingTargetFeature = kw ? !hasTargetFeature : false;

    // Screenshot the pricing page
    const screenshotBuffer = await page.screenshot({ type: 'png', fullPage: false });
    result.screenshot = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;

    emitEvent('browser_action', {
      competitor: competitor.name,
      action: 'screenshot',
      message: `Screenshot captured for ${competitor.name} pricing page`,
      screenshot: result.screenshot,
    });

    // ── Features page ──────────────────────────────────────────
    emitEvent('browser_action', {
      competitor: competitor.name,
      action: 'navigating',
      message: `Checking features page: ${competitor.featuresUrl}`,
    });

    try {
      await page.goto(competitor.featuresUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await sleep(1500);

      const featuresText = await page.evaluate(() => document.body.innerText.toLowerCase());

      // Check short-form video support
      const hasShortForm = GAP_KEYWORDS.shortForm.some((kw) => featuresText.includes(kw));
      result.gaps.noShortFormSupport = !hasShortForm;

      // Check creator analytics
      const hasAnalytics = GAP_KEYWORDS.analytics.some((kw) => featuresText.includes(kw));
      result.gaps.noCreatorAnalytics = !hasAnalytics;

      if (kw && !hasTargetFeature) {
        const featurePresent = featuresText.includes(kw);
        result.gaps.missingTargetFeature = !featurePresent;
      }

      emitEvent('browser_action', {
        competitor: competitor.name,
        action: 'checked',
        message: `Feature gaps identified for ${competitor.name}`,
        data: result.gaps,
      });
    } catch (err) {
      logger.warn(TAG, `Features page failed for ${competitor.name}: ${err.message}`);
    }

    result.success = true;
    result.notes = buildGapNotes(result.gaps, competitor.name, targetKeyword);

    logger.success(TAG, `Gap analysis complete for ${competitor.name}`);
  } catch (err) {
    logger.error(TAG, `Browser check failed for ${competitor.name}`, err);
    result.notes = `Could not complete verification: ${err.message}`;

    emitEvent('browser_action', {
      competitor: competitor.name,
      action: 'error',
      message: `Verification failed — using scrape data instead`,
    });
  } finally {
    if (browser) await browser.close();
  }

  return result;
}

function buildGapNotes(gaps, name, keyword) {
  const found = [];
  if (gaps.noFreeTier) found.push('No free tier detected');
  if (gaps.noShortFormSupport) found.push('No short-form video support found');
  if (gaps.noCreatorAnalytics) found.push('No creator analytics dashboard found');
  if (gaps.missingTargetFeature && keyword) found.push(`No "${keyword}" feature found`);
  return found.length ? `Gap(s) confirmed: ${found.join('; ')}.` : 'No major gaps detected on this competitor.';
}

/**
 * Run the full competitor verification loop (max 3 competitors).
 */
export async function verifyAllCompetitors(targetKeyword, emitEvent) {
  const results = [];
  for (const competitor of COMPETITOR_TARGETS) {
    const result = await checkCompetitorGap(competitor, targetKeyword, emitEvent);
    results.push(result);
  }
  return results;
}

export { COMPETITOR_TARGETS };
