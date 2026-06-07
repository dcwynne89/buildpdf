/* ============================================================
   lib/rate-limit.js — In-memory rate limiter (per-process)
   Optional — only used by products that enable it.
   ============================================================ */

/** In-memory map of keyHash → [timestamps] */
const rateLimitMap = new Map();
const WINDOW_MS = 60_000; // 1 minute

/**
 * Check if a key hash has exceeded its rate limit.
 * Returns true if rate-limited, false if allowed.
 *
 * @param {string} keyHash
 * @param {number} maxPerMinute
 * @returns {boolean} true if rate-limited
 */
function checkRateLimit(keyHash, maxPerMinute) {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  let timestamps = rateLimitMap.get(keyHash);
  if (!timestamps) {
    timestamps = [];
    rateLimitMap.set(keyHash, timestamps);
  }

  // Remove expired entries
  const valid = timestamps.filter((t) => t > cutoff);
  rateLimitMap.set(keyHash, valid);

  if (valid.length >= maxPerMinute) {
    return true; // rate-limited
  }

  valid.push(now);
  return false; // allowed
}

// Periodic cleanup to prevent memory leaks in long-running functions
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS * 2;
  for (const [key, timestamps] of rateLimitMap) {
    const valid = timestamps.filter((t) => t > cutoff);
    if (valid.length === 0) {
      rateLimitMap.delete(key);
    } else {
      rateLimitMap.set(key, valid);
    }
  }
}, 5 * 60_000); // Clean up every 5 minutes

module.exports = { checkRateLimit };
