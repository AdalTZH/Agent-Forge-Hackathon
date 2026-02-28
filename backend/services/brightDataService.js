/**
 * Bright Data Service
 *
 * Uses the official @brightdata/mcp package via the MCP SDK stdio client.
 * The MCP server is spawned as a subprocess; we communicate over stdin/stdout
 * using the JSON-RPC 2.0 protocol defined by MCP.
 *
 * Tools used:
 *   - search_engine  : Google/Bing search with CAPTCHA bypass
 *   - scrape_as_markdown : URL → clean Markdown (JS-rendered, unblocked)
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { logger } from '../utils/logger.js';
import { truncate } from '../utils/helpers.js';

const TAG = 'BrightData';

let _client = null;

async function getClient() {
  if (_client) return _client;

  if (!process.env.BRIGHTDATA_API_TOKEN) {
    throw new Error('BRIGHTDATA_API_TOKEN is not set in .env');
  }

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['@brightdata/mcp'],
    env: {
      ...process.env,
      API_TOKEN: process.env.BRIGHTDATA_API_TOKEN,
    },
  });

  _client = new Client(
    { name: 'market-gap-agent', version: '1.0.0' },
    { capabilities: {} }
  );

  await _client.connect(transport);
  logger.success(TAG, 'MCP client connected');
  return _client;
}

/**
 * Search the web (Google) using Bright Data's search_engine tool.
 * Returns an array of { title, url, snippet } objects.
 */
export async function searchWeb(query, maxResults = 20) {
  logger.info(TAG, `Searching: "${query}"`);

  const client = await getClient();

  const result = await client.callTool({
    name: 'search_engine',
    arguments: { query, num_results: maxResults },
  });

  const raw = result.content?.[0]?.text ?? '';

  // Bright Data returns results as markdown — parse into structured objects
  const entries = [];
  const blocks = raw.split(/\n(?=\d+\.\s)/);

  for (const block of blocks) {
    const urlMatch = block.match(/URL:\s*(https?:\/\/\S+)/i);
    const titleMatch = block.match(/Title:\s*(.+)/i);
    const snippetMatch = block.match(/Snippet:\s*(.+)/is);

    if (urlMatch) {
      entries.push({
        url: urlMatch[1].trim(),
        title: titleMatch?.[1]?.trim() ?? '',
        snippet: truncate(snippetMatch?.[1]?.trim() ?? '', 300),
      });
    }
  }

  // Fallback: if structured parsing failed, extract URLs from markdown links
  if (entries.length === 0) {
    const linkMatches = [...raw.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)];
    for (const [, title, url] of linkMatches) {
      entries.push({ url, title, snippet: '' });
    }
  }

  logger.success(TAG, `Found ${entries.length} results for: "${query}"`);
  return entries.slice(0, maxResults);
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
  logger.success(TAG, `Scraped ${content.length} chars from ${url}`);
  return content;
}

/**
 * Search Reddit for pain points in a given niche.
 * Runs 3 targeted queries and deduplicates by URL.
 */
export async function searchRedditPainPoints(niche) {
  logger.info(TAG, `Scouting Reddit for niche: "${niche}"`);

  const queries = [
    `site:reddit.com "${niche}" "I wish there was" OR "why isn't there a tool"`,
    `site:reddit.com "${niche}" "so frustrating" OR "no app for" OR "manually"`,
    `site:reddit.com "${niche}" "wish someone would build" OR "I hate having to"`,
  ];

  const allResults = [];

  for (const query of queries) {
    try {
      const results = await searchWeb(query, 8);
      allResults.push(...results);
    } catch (err) {
      logger.warn(TAG, `Query failed, continuing: ${err.message}`);
    }
  }

  // Deduplicate by URL
  const seen = new Set();
  const unique = allResults.filter(({ url }) => {
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });

  logger.success(TAG, `Collected ${unique.length} unique Reddit URLs for "${niche}"`);
  return unique;
}

/**
 * Scrape a set of Reddit URLs and return the raw text content.
 * Caps at maxUrls to prevent demo hangs.
 */
export async function scrapeRedditPosts(urls, maxUrls = 15) {
  const capped = urls.slice(0, maxUrls);
  const posts = [];

  for (const { url, title, snippet } of capped) {
    try {
      const content = await scrapeUrl(url);
      posts.push({ url, title, snippet, content: truncate(content, 2000) });
    } catch (err) {
      logger.warn(TAG, `Failed to scrape ${url}: ${err.message}`);
      // Include snippet-only fallback so we don't lose the signal
      if (snippet) posts.push({ url, title, snippet, content: snippet });
    }
  }

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
