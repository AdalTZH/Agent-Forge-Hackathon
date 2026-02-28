import crypto from 'crypto';

export const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

export const hashString = (str) =>
  crypto.createHash('md5').update(str).digest('hex').slice(0, 8);

/**
 * Truncate a string cleanly at a word boundary.
 */
export const truncate = (str, maxLen = 500) => {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
};

/**
 * Safely parse JSON — returns null on failure instead of throwing.
 */
export const safeJsonParse = (str) => {
  try {
    // Strip markdown code fences if the LLM wrapped the output
    const cleaned = str.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
};

/**
 * Extract the first JSON object/array from a string.
 */
export const extractJson = (str) => {
  const match = str.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!match) return null;
  return safeJsonParse(match[1]);
};

/**
 * Deduplicate an array by a key function.
 */
export const dedupeBy = (arr, keyFn) => {
  const seen = new Set();
  return arr.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
