/* ============================================================
   @buildplatform/api-core — Shared API infrastructure
   
   Usage:
     const { createApiCore } = require("@buildplatform/api-core");
     const api = createApiCore({ keyPrefix: "bqte_", ... });
   ============================================================ */

const { createAuth, jsonResponse, errorResponse, CORS_HEADERS } = require("./lib/auth");
const { createStorage, hashKey, currentMonth } = require("./lib/storage");

/**
 * Create a fully configured API core instance for a Build product.
 *
 * @param {object} config
 * @param {string} config.keyPrefix              – API key prefix, e.g. "bqte_"
 * @param {string} config.quotaField             – Tier field for quota, e.g. "quotesPerMonth"
 * @param {object} config.tiers                  – Tier definitions object
 * @param {number} [config.maxBodyBytes]          – Max request body size (default 10MB)
 * @param {number} [config.maxRegistrationsPerHour] – IP registration limit (default 3)
 * @param {string} [config.quotaMessage]          – Message when quota exceeded
 * @param {string} [config.upgradeUrl]            – URL for tier upgrade info
 * @param {boolean} [config.enableRateLimiter]    – Enable in-memory rate limiting (default false)
 * @param {boolean} [config.defaultCountUsage]    – Default for countUsage in authenticate (default true)
 */
function createApiCore(config) {
  const {
    keyPrefix,
    quotaField,
    tiers,
    maxBodyBytes = 10 * 1024 * 1024,
    maxRegistrationsPerHour = 3,
    quotaMessage = "Monthly limit reached.",
    upgradeUrl = "",
    enableRateLimiter = false,
    defaultCountUsage = true,
  } = config;

  // Create storage instance
  const storage = createStorage({
    keyPrefix,
    quotaField,
    tiers,
    maxRegistrationsPerHour,
  });

  // Create auth instance
  const { authenticate } = createAuth({
    keyPrefix,
    quotaField,
    quotaMessage,
    upgradeUrl,
    enableRateLimiter,
    defaultCountUsage,
  }, storage);

  return {
    // Auth
    authenticate,
    jsonResponse,
    errorResponse,
    CORS_HEADERS,

    // Storage
    registerKey:               storage.registerKey,
    validateKey:               storage.validateKey,
    emailHasKey:               storage.emailHasKey,
    checkQuota:                storage.checkQuota,
    incrementUsage:            storage.incrementUsage,
    getUsage:                  storage.getUsage,
    checkRegistrationLimit:    storage.checkRegistrationLimit,
    recordRegistrationAttempt: storage.recordRegistrationAttempt,

    // Utilities
    hashKey,
    currentMonth,
    TIERS: tiers,
    MAX_BODY_BYTES: maxBodyBytes,
  };
}

module.exports = { createApiCore };
