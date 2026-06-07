/* ============================================================
   lib/auth.js — API key authentication & response helpers
   Shared across the Build ecosystem
   ============================================================ */

const { checkRateLimit } = require("./rate-limit");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization",
};

/** Standard JSON response with CORS headers. */
function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** Standard error response. */
function errorResponse(statusCode, message, extra = {}) {
  return jsonResponse(statusCode, { success: false, error: message, ...extra });
}

/** First day of next month as ISO string — for quota reset messaging. */
function nextMonthStart() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Create an authenticate function bound to product config + storage.
 *
 * @param {object} config
 * @param {string} config.keyPrefix          – e.g. "bqte_"
 * @param {string} config.quotaField         – e.g. "quotesPerMonth"
 * @param {string} config.quotaMessage       – e.g. "Monthly quote limit reached."
 * @param {string} config.upgradeUrl         – e.g. "https://buildquotes.co/api/docs#pricing"
 * @param {boolean} config.enableRateLimiter – whether to use in-memory rate limiting
 * @param {boolean} config.defaultCountUsage – default for countUsage option (default true)
 * @param {object} storage                   – storage instance from createStorage()
 */
function createAuth(config, storage) {
  const {
    keyPrefix,
    quotaField,
    quotaMessage = "Monthly limit reached.",
    upgradeUrl = "",
    enableRateLimiter = false,
    defaultCountUsage = true,
  } = config;

  /**
   * Authenticate an API request.
   * @param {object} event   – Netlify Function event
   * @param {object} options – { countUsage?: boolean }
   * @returns {{ auth: object|null, response: object|null }}
   */
  async function authenticate(event, options = {}) {
    // Handle CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return { auth: null, response: { statusCode: 204, headers: CORS_HEADERS, body: "" } };
    }

    const countUsage = options.countUsage !== undefined ? options.countUsage : defaultCountUsage;

    // Extract API key from headers
    const apiKey =
      event.headers["x-api-key"] ||
      event.headers["X-API-Key"] ||
      (event.headers["authorization"] || "").replace(/^Bearer\s+/i, "");

    if (!apiKey || !apiKey.startsWith(keyPrefix)) {
      return {
        auth: null,
        response: errorResponse(401, `Missing or invalid API key. Include X-API-Key: ${keyPrefix}yourkey`),
      };
    }

    // Validate key against store
    const keyData = await storage.validateKey(apiKey);
    if (!keyData) {
      return {
        auth: null,
        response: errorResponse(401, "API key not found or inactive."),
      };
    }

    // Optional in-memory rate limiting
    if (enableRateLimiter && keyData.tier.ratePerMinute) {
      const rateLimited = checkRateLimit(keyData.hash, keyData.tier.ratePerMinute);
      if (rateLimited) {
        return {
          auth: null,
          response: errorResponse(429, "Rate limit exceeded. Please slow down.", {
            retryAfter: "60s",
          }),
        };
      }
    }

    // Check quota
    const quota = await storage.checkQuota(keyData.hash, keyData.tier);
    if (countUsage && !quota.allowed) {
      return {
        auth: null,
        response: errorResponse(429, quotaMessage, {
          used: quota.used,
          limit: quota.limit,
          tier: keyData.tier.name || keyData.meta.tier,
          reset: nextMonthStart(),
          upgrade: upgradeUrl,
        }),
      };
    }

    return {
      auth: {
        hash: keyData.hash,
        tier: keyData.tier,
        meta: keyData.meta,
        quota,
      },
      response: null,
    };
  }

  return { authenticate };
}

module.exports = { createAuth, jsonResponse, errorResponse, CORS_HEADERS };
