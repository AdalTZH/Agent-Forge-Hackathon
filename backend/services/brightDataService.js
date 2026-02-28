/**
 * Bright Data Service
 *
 * Primary scouting uses Reddit's own public JSON API — no zone, no payment
 * method, no Bright Data account setup required.
 *
 * Bright Data MCP (remote hosted server) is used as a FALLBACK for:
 *   - Google search_engine  : when Reddit JSON API misses results
 *   - scrape_as_markdown    : for scraping competitor pages
 *
 * NOTE: Bright Data tools require a "mcp_unlocker" zone on the account.
 * If that zone is missing, BD calls will silently return 0 results —
 * the Reddit JSON API path will already have succeeded before we get there.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { logger } from '../utils/logger.js';
import { truncate } from '../utils/helpers.js';

const TAG = 'BrightData';

/**
 * Tool groups to enable on the remote MCP server.
 * Covers all scraping, social, research, and browser capabilities.
 */
const MCP_GROUPS = [
  'advanced_scraping',
  'ecommerce',
  'social',
  'browser',
  'finance',
  'business',
  'research',
  'app_stores',
].join(',');

// ─────────────────────────────────────────────
// Reddit Public JSON API — Primary Scout Strategy
//
// Reddit exposes a public search endpoint that returns clean JSON.
// No auth token, no proxy zone, no rate-limit issues for light usage.
// Docs: https://www.reddit.com/dev/api/#GET_search
// ─────────────────────────────────────────────

/**
 * Search Reddit's public JSON API for pain-point posts about a niche.
 *
 * Key search decisions:
 *   - `type=self`  → only text posts (self posts have actual body content in
 *                    selftext; link posts have no body and were causing 0 pain
 *                    points to be extracted)
 *   - `self:1`     → redundant safety: Reddit query modifier for self posts
 *   - `sort=top`   → highest-upvoted = most resonant = strongest pain signal
 *   - `t=year`     → last 12 months — recent, relevant pain points only
 *   - score >= 3   → filter throwaway posts; real pain posts get upvotes
 *
 * @param {string} niche - The market niche to search
 * @param {number} maxPosts - Max posts to return (default 25)
 * @returns {Promise<Array<{url, title, snippet, content}>>}
 */
export async function searchRedditJSON(niche, maxPosts = 25) {
  // Use quoted niche + pain signal terms — quotes force exact match of the niche
  const queries = [
    `"${niche}" problem OR frustrated OR struggling self:1`,
    `"${niche}" wish OR annoying OR hate self:1`,
    `"${niche}" difficult OR broken OR missing self:1`,
  ];

  const REDDIT_HEADERS = {
    'User-Agent': 'MarketGapAgent/1.0 (hackathon research tool)',
    'Accept': 'application/json',
  };

  const seen = new Set();
  const results = [];

  for (const query of queries) {
    if (results.length >= maxPosts) break;

    // type=self → text posts only (have selftext body, not just external links)
    const searchUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=top&t=year&limit=25&type=self`;
    logger.info(TAG, `Reddit JSON API query: "${query}"`);

    try {
      const res = await fetch(searchUrl, { headers: REDDIT_HEADERS });

      if (!res.ok) {
        logger.warn(TAG, `Reddit JSON API HTTP ${res.status} for: "${query}"`);
        continue;
      }

      const data = await res.json();
      const children = data?.data?.children ?? [];

      let added = 0;
      for (const { data: post } of children) {
        if (!post?.permalink) continue;

        // Skip low-signal posts: deleted, removed, or very low score
        if (post.score < 3) continue;
        if (post.selftext === '[deleted]' || post.selftext === '[removed]') continue;

        const postUrl = `https://www.reddit.com${post.permalink}`.split('?')[0];
        if (seen.has(postUrl)) continue;
        seen.add(postUrl);

        results.push({
          url: postUrl,
          title: post.title ?? '',
          snippet: truncate((post.selftext ?? '').trim(), 300),
          content: truncate((post.selftext ?? '').trim(), 2000),
          score: post.score,
          subreddit: post.subreddit,
          num_comments: post.num_comments,
        });
        added++;
      }

      logger.success(TAG, `Reddit JSON API: ${added} new posts (total ${results.length}) for "${query}"`);

      // Polite delay between requests — Reddit allows ~60 req/min unauthenticated
      if (results.length < maxPosts) await new Promise((r) => setTimeout(r, 600));
    } catch (err) {
      logger.warn(TAG, `Reddit JSON API failed for "${query}": ${err.message}`);
    }
  }

  logger.success(TAG, `Reddit JSON API total: ${results.length} unique posts for "${niche}"`);
  return results.slice(0, maxPosts);
}

// ─────────────────────────────────────────────
// Bright Data MCP Client (Fallback)
// ─────────────────────────────────────────────

let _client = null;

async function getClient() {
  if (_client) return _client;

  if (!process.env.BRIGHTDATA_API_TOKEN) {
    throw new Error('BRIGHTDATA_API_TOKEN is not set in .env');
  }

  const mcpUrl = new URL('https://mcp.brightdata.com/mcp');
  mcpUrl.searchParams.set('token', process.env.BRIGHTDATA_API_TOKEN);
  mcpUrl.searchParams.set('groups', MCP_GROUPS);

  const transport = new StreamableHTTPClientTransport(mcpUrl);

  _client = new Client(
    { name: 'market-gap-agent', version: '1.0.0' },
    { capabilities: {} }
  );

  await _client.connect(transport);
  logger.success(TAG, `MCP client connected → ${mcpUrl.origin}/mcp`);

  // List available tools so we can detect naming differences between
  // the remote hosted server and the local @brightdata/mcp package.
  try {
    const { tools } = await _client.listTools();
    const names = tools.map((t) => t.name);
    logger.info(TAG, `Available tools (${names.length}): ${names.join(', ')}`);
  } catch (e) {
    logger.warn(TAG, `Could not list tools: ${e.message}`);
  }

  return _client;
}

/**
 * Search the web using Bright Data's search_engine tool.
 *
 * IMPORTANT — actual API behaviour (read from @brightdata/mcp source):
 *   - Google (default): returns JSON  { "organic": [{ link, title, description }] }
 *   - Bing / Yandex:    returns Markdown text
 *   - The `num_results` parameter does NOT exist — Google returns 10/page.
 *     Use the `cursor` param (page number string) to paginate.
 *
 * Returns an array of { url, title, snippet } objects.
 */
export async function searchWeb(query, maxResults = 10, page = 0) {
  logger.info(TAG, `Searching (page ${page}): "${query}"`);

  const client = await getClient();

  let result;
  try {
    result = await client.callTool({
      name: 'search_engine',
      arguments: {
        query,
        engine: 'google',
        ...(page > 0 ? { cursor: String(page) } : {}),
      },
    });
  } catch (err) {
    logger.error(TAG, `Bright Data search_engine failed: "${query}"`, err);
    throw err;
  }

  // Log the full content array type for diagnostics
  const contentArr = result.content ?? [];
  const raw = contentArr[0]?.text ?? '';

  // Always log a preview of the raw response so we can see errors immediately
  logger.info(TAG, `Raw response (${raw.length} chars): ${raw.slice(0, 300)}`);

  if (!raw || raw.trim().length === 0) {
    logger.warn(TAG, `Empty search response for: "${query}"`);
    return [];
  }

  // Google → JSON: { "organic": [{ "link", "title", "description" }] }
  try {
    const parsed = JSON.parse(raw);

    // Check for error responses from the remote MCP server
    if (parsed?.error || parsed?.message) {
      logger.warn(TAG, `search_engine error response: ${parsed.error ?? parsed.message}`);
      return [];
    }

    const organic = Array.isArray(parsed?.organic) ? parsed.organic : [];

    const entries = organic
      .map((item) => ({
        url: (item.link ?? item.url ?? '').trim(),
        title: (item.title ?? '').trim(),
        snippet: truncate((item.description ?? item.snippet ?? '').trim(), 300),
      }))
      .filter((e) => e.url.startsWith('http'));

    logger.success(TAG, `Found ${entries.length} results for: "${query}"`);
    return entries.slice(0, maxResults);
  } catch (_jsonErr) {
    // Bing / Yandex return Markdown — extract [title](url) links
    logger.info(TAG, `Non-JSON response — parsing as markdown for: "${query}"`);
    const linkMatches = [...raw.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)];
    const entries = linkMatches.map(([, title, url]) => ({ url, title, snippet: '' }));
    logger.success(TAG, `Markdown parse: ${entries.length} results for: "${query}"`);
    return entries.slice(0, maxResults);
  }
}

/**
 * Scrape a URL and return its content as clean Markdown.
 * Bright Data's Web Unlocker handles JS rendering, CAPTCHAs, and bot detection.
 */
export async function scrapeUrl(url) {
  logger.info(TAG, `Scraping: ${url}`);

  const client = await getClient();

  const result = await client.callTool({
    name: 'scrape_as_markdown',
    arguments: { url },
  });

  const content = result.content?.[0]?.text ?? '';

  // Log a preview — 83-char responses indicate an error, not real content
  if (content.length < 200) {
    logger.warn(TAG, `Short scrape response (${content.length} chars) from ${url}: "${content}"`);
  } else {
    logger.success(TAG, `Scraped ${content.length} chars from ${url}`);
  }

  return content;
}

/**
 * Search Reddit directly by scraping Reddit's own /search page.
 *
 * scrape_as_markdown strips all content EXCEPT links (remark strip plugin
 * keeps `link` and `linkReference` nodes). So the returned markdown will
 * contain only bare [title](url) pairs — which is enough to extract post URLs
 * and their titles.
 *
 * We use this as a secondary enrichment pass; primary is search_engine below.
 */
export async function searchRedditDirect(niche, maxUrls = 15) {
  const q = encodeURIComponent(niche.trim());

  const redditSearchUrls = [
    `https://www.reddit.com/search/?q=${q}+problem+OR+frustrating+OR+struggling&sort=relevance&t=year&type=link`,
    `https://www.reddit.com/search/?q=${q}+wish+OR+hate+OR+annoying&sort=top&t=all&type=link`,
    `https://www.reddit.com/search/?q=${q}&sort=top&t=year&type=link`,
  ];

  // Matches any reddit.com /r/.../comments/... post URL
  const POST_URL_RE = /https?:\/\/(?:www\.)?reddit\.com\/r\/[^/\s"')]+\/comments\/[^\s"')]+/g;

  const seen = new Set();
  const results = [];

  for (const searchUrl of redditSearchUrls) {
    if (results.length >= maxUrls) break;
    try {
      logger.info(TAG, `Direct Reddit scrape: ${searchUrl}`);
      const markdown = await scrapeUrl(searchUrl);

      // Extract [title](url) pairs first — preserves title
      const linkMatches = [...markdown.matchAll(/\[([^\]]{5,})\]\((https?:\/\/(?:www\.)?reddit\.com\/r\/[^)]+\/comments\/[^)]+)\)/g)];
      for (const [, title, url] of linkMatches) {
        const cleanUrl = url.split('?')[0]; // strip query params
        if (!seen.has(cleanUrl)) {
          seen.add(cleanUrl);
          results.push({ url: cleanUrl, title: title.trim(), snippet: '' });
        }
      }

      // Also catch bare URLs not wrapped in markdown links
      const bareMatches = [...markdown.matchAll(POST_URL_RE)];
      for (const [rawUrl] of bareMatches) {
        const cleanUrl = rawUrl.split('?')[0].replace(/[.,);]+$/, '');
        if (!seen.has(cleanUrl)) {
          seen.add(cleanUrl);
          results.push({ url: cleanUrl, title: '', snippet: '' });
        }
      }

      logger.info(TAG, `Direct scrape: ${results.length} posts so far`);
    } catch (err) {
      logger.warn(TAG, `Direct Reddit scrape failed (${searchUrl}): ${err.message}`);
    }
  }

  return results.slice(0, maxUrls);
}

/**
 * Use Bright Data's native web_data_reddit_posts tool to search Reddit directly.
 *
 * This is the most reliable strategy — it bypasses Google search and Reddit's
 * anti-bot measures by using Bright Data's structured Reddit data API.
 * Available on the remote MCP server under the `social` or `research` groups.
 *
 * @param {string} niche - The niche/topic to search
 * @param {number} maxPosts - Maximum number of posts to return
 * @returns {Promise<Array<{url, title, snippet, content}>>}
 */
export async function searchRedditWithWebData(niche, maxPosts = 15) {
  const client = await getClient();

  const queries = [
    `${niche} problem frustrating struggling`,
    `${niche} wish annoying hate`,
    `${niche} pain issue broken`,
  ];

  const seen = new Set();
  const results = [];

  for (const query of queries) {
    if (results.length >= maxPosts) break;
    try {
      logger.info(TAG, `web_data_reddit_posts query: "${query}"`);
      const result = await client.callTool({
        name: 'web_data_reddit_posts',
        arguments: {
          query,
          time_filter: 'year',
          sort_by: 'relevance',
          count: 10,
        },
      });

      const raw = result.content?.[0]?.text ?? '';
      logger.info(TAG, `web_data_reddit_posts raw (${raw.length} chars): ${raw.slice(0, 300)}`);

      if (!raw || raw.length < 10) continue;

      // Response can be JSON array of posts or markdown
      let posts = [];
      try {
        const parsed = JSON.parse(raw);
        posts = Array.isArray(parsed) ? parsed : (parsed?.posts ?? parsed?.data ?? []);
      } catch {
        // If not JSON, extract post URLs from the text
        const urlMatches = [...raw.matchAll(/https?:\/\/(?:www\.)?reddit\.com\/r\/[^/\s"']+\/comments\/[^\s"']+/g)];
        posts = urlMatches.map(([url]) => ({ url: url.split('?')[0], title: '', selftext: '' }));
      }

      for (const post of posts) {
        const url = (post.url ?? post.permalink ?? '').split('?')[0];
        if (!url || seen.has(url)) continue;
        seen.add(url);
        results.push({
          url,
          title: post.title ?? '',
          snippet: truncate(post.selftext ?? post.description ?? '', 300),
          content: truncate(post.selftext ?? '', 2000),
        });
      }

      logger.info(TAG, `web_data_reddit_posts: ${results.length} posts so far`);
    } catch (err) {
      logger.warn(TAG, `web_data_reddit_posts failed for "${query}": ${err.message}`);
    }
  }

  return results.slice(0, maxPosts);
}

/**
 * Search Reddit for pain points in a given niche.
 *
 * Strategy (in priority order):
 *   0. Reddit public JSON API — direct, zero-dependency, always works
 *   1. Bright Data web_data_reddit_posts — structured Reddit tool (if zone exists)
 *   2. Bright Data search_engine (Google site:reddit.com) — if zone exists
 *   3. Bright Data scrape_as_markdown on Reddit search page — last resort
 */
export async function searchRedditPainPoints(niche) {
  logger.info(TAG, `Scouting Reddit for niche: "${niche}"`);

  if (!niche || niche.trim().length === 0) {
    logger.warn(TAG, 'Empty niche provided to searchRedditPainPoints');
    return [];
  }

  const n = niche.trim();
  const allResults = [];

  // ── Strategy 0: Reddit public JSON API (primary — no Bright Data needed) ──
  logger.info(TAG, `Strategy 0: Reddit JSON API for "${n}"`);
  try {
    const jsonPosts = await searchRedditJSON(n, 25);
    if (jsonPosts.length > 0) {
      allResults.push(...jsonPosts);
      logger.success(TAG, `Strategy 0 yielded ${jsonPosts.length} posts — skipping Bright Data`);
      // Skip all Bright Data strategies — we already have enough signal
    }
  } catch (err) {
    logger.warn(TAG, `Strategy 0 failed: ${err.message}`);
  }

  // ── Strategy 1: Bright Data web_data_reddit_posts (if zone exists) ────
  if (allResults.length < 10) {
    logger.info(TAG, `Strategy 1: web_data_reddit_posts for "${n}"`);
    try {
      const nativePosts = await searchRedditWithWebData(n, 15);
      if (nativePosts.length > 0) {
        allResults.push(...nativePosts);
        logger.success(TAG, `Strategy 1 yielded ${nativePosts.length} posts`);
      } else {
        logger.warn(TAG, `Strategy 1 returned 0 posts — zone likely missing`);
      }
    } catch (err) {
      logger.warn(TAG, `Strategy 1 failed: ${err.message}`);
    }
  }

  // ── Strategy 2: Bright Data Google site:reddit.com (if zone exists) ───
  if (allResults.length < 10) {
    logger.info(TAG, `Strategy 2: Google site:reddit.com for "${n}"`);
    const googleQueries = [
      `site:reddit.com "${n}" problem OR frustrating OR struggling`,
      `site:reddit.com "${n}" wish OR annoying OR hate`,
      `site:reddit.com "${n}" pain OR issue OR broken`,
    ];

    for (const query of googleQueries) {
      for (const page of [0, 1]) {
        try {
          const hits = await searchWeb(query, 10, page);
          const redditHits = hits.filter((r) => r.url?.includes('reddit.com/r/'));
          if (redditHits.length > 0) {
            allResults.push(...redditHits);
            logger.info(TAG, `Google site:reddit.com p${page} "${query}" → ${redditHits.length} hits`);
          }
          if (page === 0 && redditHits.length === 0) break;
        } catch (err) {
          logger.warn(TAG, `Google query failed: "${query}" p${page} — ${err.message}`);
        }
      }
      if (allResults.length >= 20) break;
    }
  }

  // ── Strategy 3: Bright Data direct Reddit scrape (last resort) ────────
  if (allResults.length < 10) {
    logger.info(TAG, `Strategy 3: Direct Reddit scrape for "${n}"`);
    try {
      const direct = await searchRedditDirect(n, 15);
      allResults.push(...direct);
      logger.info(TAG, `Direct scrape added ${direct.length} posts`);
    } catch (err) {
      logger.warn(TAG, `Direct Reddit scrape threw: ${err.message}`);
    }
  }

  // Deduplicate by URL
  const seen = new Set();
  const unique = allResults.filter(({ url }) => {
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });

  logger.success(TAG, `Collected ${unique.length} unique Reddit URLs for "${n}"`);

  if (unique.length === 0) {
    logger.warn(TAG, `No Reddit URLs found for "${n}". Check:`);
    logger.warn(TAG, '  1. BRIGHTDATA_API_TOKEN is valid and has quota');
    logger.warn(TAG, '  2. Web Unlocker zone "mcp_unlocker" is active in Bright Data dashboard');
    logger.warn(TAG, '  3. Try a broader niche term');
  }

  return unique;
}

/**
 * Fetch full post content + top 5 comments from Reddit's own JSON API.
 *
 * Reddit exposes every post as `<url>.json` — returns post data and a comment
 * tree. No auth required. This is the richest source of signal for pain points
 * because comments often contain the most explicit frustrations.
 *
 * @param {string} postUrl - Full Reddit post URL
 * @returns {Promise<string>} - Combined title + selftext + top comments
 */
async function fetchRedditPostJSON(postUrl) {
  const jsonUrl = postUrl.replace(/\/?$/, '.json');

  const res = await fetch(jsonUrl, {
    headers: {
      'User-Agent': 'MarketGapAgent/1.0 (hackathon research tool)',
      'Accept': 'application/json',
    },
  });

  if (!res.ok) throw new Error(`Reddit post JSON HTTP ${res.status}`);

  const [listingData, commentsData] = await res.json();
  const post = listingData?.data?.children?.[0]?.data;

  if (!post) throw new Error('No post data in response');

  // Collect top comments — richest pain point signal
  const topComments = (commentsData?.data?.children ?? [])
    .slice(0, 8)
    .map((c) => c?.data?.body)
    .filter((b) => b && b !== '[deleted]' && b !== '[removed]' && b.length > 20)
    .join('\n\n---\n\n');

  const parts = [
    `Title: ${post.title ?? ''}`,
    post.selftext ? `Post body: ${post.selftext}` : '',
    topComments ? `Top comments:\n${topComments}` : '',
  ].filter(Boolean);

  return parts.join('\n\n');
}

/**
 * Enrich a set of Reddit posts with full content.
 *
 * Priority per post:
 *   1. Use existing content if already meaningful (from searchRedditJSON)
 *   2. Enrich via Reddit's own .json endpoint (post body + top comments)
 *   3. Fall back to Bright Data scrape_as_markdown (if zone exists)
 *   4. Last resort: use snippet from search result
 *
 * The key bug this fixes: previously the content fetched by searchRedditJSON
 * was silently discarded here, then overwritten with Bright Data error strings.
 */
export async function scrapeRedditPosts(urls, maxUrls = 15) {
  const capped = urls.slice(0, maxUrls);
  const posts = [];

  for (const { url, title, snippet, content: existingContent } of capped) {

    // ── 1. Already have good content (from Reddit JSON API search) ────────
    const isGoodContent = existingContent
      && existingContent.length > 80
      && !existingContent.includes('execution failed');

    if (isGoodContent) {
      logger.info(TAG, `Using pre-fetched content (${existingContent.length} chars) for ${url}`);
      posts.push({ url, title, snippet, content: truncate(existingContent, 2000) });
      continue;
    }

    // ── 2. Enrich via Reddit's own .json endpoint (post + top comments) ───
    try {
      const content = await fetchRedditPostJSON(url);
      logger.success(TAG, `Reddit .json enriched ${content.length} chars from ${url}`);
      posts.push({ url, title, snippet, content: truncate(content, 2000) });
      // Polite delay between individual post fetches
      await new Promise((r) => setTimeout(r, 400));
      continue;
    } catch (err) {
      logger.warn(TAG, `Reddit .json failed for ${url}: ${err.message}`);
    }

    // ── 3. Bright Data fallback (only if zone exists) ─────────────────────
    try {
      const content = await scrapeUrl(url);
      if (content && content.length > 100 && !content.includes('execution failed')) {
        posts.push({ url, title, snippet, content: truncate(content, 2000) });
        continue;
      }
    } catch (err) {
      logger.warn(TAG, `Bright Data scrape failed for ${url}: ${err.message}`);
    }

    // ── 4. Snippet-only fallback — at least preserve the title + summary ──
    if (title || snippet) {
      posts.push({ url, title, snippet, content: `${title}\n\n${snippet}`.trim() });
    }
  }

  logger.success(TAG, `scrapeRedditPosts: ${posts.length}/${capped.length} posts enriched`);
  return posts;
}

/**
 * Scrape a competitor page for gap analysis.
 */
export async function scrapeCompetitorPage(url) {
  try {
    const content = await scrapeUrl(url);
    return { url, content: truncate(content, 3000), success: true };
  } catch (err) {
    logger.warn(TAG, `Competitor scrape failed for ${url}: ${err.message}`);
    return { url, content: '', success: false, error: err.message };
  }
}

/**
 * Close the MCP client connection gracefully.
 */
export async function closeBrightData() {
  if (_client) {
    await _client.close();
    _client = null;
    logger.info(TAG, 'MCP client disconnected');
  }
}
