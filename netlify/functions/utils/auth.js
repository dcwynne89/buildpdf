/* ============================================================
   auth.js — Shared authentication & rate-limiting middleware
   ============================================================ */

const { validateKey, checkQuota, incrementUsage } = require("./storage");

// ── In-memory rate limiter (resets per cold start — good enough for MVP) ──
const rateLimitMap = new Map();

function checkRateLimit(keyHash, maxPerMinute) {
  const now = Date.now();
  const windowMs = 60_000;

  if (!rateLimitMap.has(keyHash)) {
    rateLimitMap.set(keyHash, []);
  }

  const timestamps = rateLimitMap.get(keyHash).filter((t) => t > now - windowMs);
  timestamps.push(now);
  rateLimitMap.set(keyHash, timestamps);

  return timestamps.length <= maxPerMinute;
}

// ── Standard CORS headers ──
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

// ── JSON response helpers ──
function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

function errorResponse(statusCode, message, details = null) {
  const body = { success: false, error: message };
  if (details) body.details = details;
  return jsonResponse(statusCode, body);
}

/**
 * Authenticate a request, check quota, and rate limit.
 * Returns { auth, response } — if response is set, return it immediately.
 *
 * @param {object} event — Netlify function event
 * @param {object} options — { requireExtract: false, countUsage: true }
 * @returns {{ auth: object|null, response: object|null }}
 */
async function authenticate(event, options = {}) {
  const { requireExtract = false, countUsage = true } = options;

  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { auth: null, response: { statusCode: 204, headers: CORS_HEADERS, body: "" } };
  }

  // Extract API key from header
  const apiKey =
    event.headers["x-api-key"] ||
    event.headers["X-API-Key"] ||
    (event.headers.authorization || "").replace(/^Bearer\s+/i, "");

  if (!apiKey) {
    return {
      auth: null,
      response: errorResponse(401, "API key required. Pass via X-API-Key header or Authorization: Bearer <key>"),
    };
  }

  // Validate key
  const keyData = await validateKey(apiKey);
  if (!keyData) {
    return {
      auth: null,
      response: errorResponse(401, "Invalid or inactive API key."),
    };
  }

  // Check feature gating
  if (requireExtract && !keyData.tier.extractEnabled) {
    return {
      auth: null,
      response: errorResponse(403, "PDF extraction requires Starter plan or above.", {
        currentTier: keyData.tier.name,
        upgrade: "https://buildpdf.co/api/docs#pricing",
      }),
    };
  }

  // Rate limit
  if (!checkRateLimit(keyData.hash, keyData.tier.ratePerMinute)) {
    return {
      auth: null,
      response: errorResponse(429, `Rate limit exceeded. ${keyData.tier.name} plan allows ${keyData.tier.ratePerMinute} requests/minute.`, {
        retryAfter: 60,
      }),
    };
  }

  // Check quota
  const quota = await checkQuota(keyData.hash, keyData.tier);
  if (!quota.allowed && countUsage) {
    return {
      auth: null,
      response: errorResponse(429, "Monthly conversion limit reached.", {
        used: quota.used,
        limit: quota.limit,
        resetsAt: nextMonthStart(),
        upgrade: "https://buildpdf.co/api/docs#pricing",
      }),
    };
  }

  return {
    auth: { ...keyData, quota },
    response: null,
  };
}

function nextMonthStart() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

module.exports = {
  authenticate,
  jsonResponse,
  errorResponse,
  CORS_HEADERS,
};
