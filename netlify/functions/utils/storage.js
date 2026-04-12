/* ============================================================
   storage.js — Netlify Blobs abstraction for API keys & usage
   ============================================================ */

const { getStore } = require("@netlify/blobs");

// ── Store names ──
const KEYS_STORE = "api-keys";
const USAGE_STORE = "api-usage";

// ── Helpers ──
function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function hashKey(apiKey) {
  // Node.js crypto for SHA-256
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

function generateApiKey() {
  const crypto = require("crypto");
  const prefix = "bpdf_";
  const random = crypto.randomBytes(24).toString("base64url");
  return prefix + random;
}

// ── Tier definitions ──
const TIERS = {
  free: {
    name: "Free",
    conversionsPerMonth: 100,
    maxFileSizeMB: 5,
    ratePerMinute: 10,
    watermark: true,
    extractEnabled: false,
    batchEnabled: false,
  },
  starter: {
    name: "Starter",
    conversionsPerMonth: 1000,
    maxFileSizeMB: 25,
    ratePerMinute: 60,
    watermark: false,
    extractEnabled: true,
    batchEnabled: false,
  },
  pro: {
    name: "Pro",
    conversionsPerMonth: 10000,
    maxFileSizeMB: 50,
    ratePerMinute: 300,
    watermark: false,
    extractEnabled: true,
    batchEnabled: true,
  },
  business: {
    name: "Business",
    conversionsPerMonth: 50000,
    maxFileSizeMB: 100,
    ratePerMinute: 1000,
    watermark: false,
    extractEnabled: true,
    batchEnabled: true,
  },
};

// ── API Key Operations ──

/**
 * Register a new API key
 * @param {string} email
 * @returns {{ apiKey: string, keyHash: string }}
 */
async function registerKey(email) {
  const store = getStore(KEYS_STORE);
  const apiKey = generateApiKey();
  const keyHash = await hashKey(apiKey);

  const metadata = {
    email,
    tier: "free",
    createdAt: new Date().toISOString(),
    active: true,
  };

  await store.setJSON(keyHash, metadata);
  return { apiKey, keyHash };
}

/**
 * Validate an API key and return its metadata + tier config
 * @param {string} apiKey
 * @returns {null | { hash: string, meta: object, tier: object }}
 */
async function validateKey(apiKey) {
  if (!apiKey || !apiKey.startsWith("bpdf_")) return null;

  const store = getStore(KEYS_STORE);
  const keyHash = await hashKey(apiKey);

  try {
    const meta = await store.get(keyHash, { type: "json" });
    if (!meta || !meta.active) return null;
    const tier = TIERS[meta.tier] || TIERS.free;
    return { hash: keyHash, meta, tier };
  } catch {
    return null;
  }
}

// ── Usage Tracking ──

/**
 * Get current month usage count for a key
 * @param {string} keyHash
 * @returns {number}
 */
async function getUsage(keyHash) {
  const store = getStore(USAGE_STORE);
  const key = `${keyHash}:${currentMonth()}`;

  try {
    const val = await store.get(key, { type: "json" });
    return val?.count || 0;
  } catch {
    return 0;
  }
}

/**
 * Increment usage count for a key
 * @param {string} keyHash
 * @returns {number} new count
 */
async function incrementUsage(keyHash) {
  const store = getStore(USAGE_STORE);
  const key = `${keyHash}:${currentMonth()}`;

  let current = 0;
  try {
    const val = await store.get(key, { type: "json" });
    current = val?.count || 0;
  } catch {
    // first use this month
  }

  const newCount = current + 1;
  await store.setJSON(key, { count: newCount, lastUsed: new Date().toISOString() });
  return newCount;
}

/**
 * Check if a key has remaining quota
 * @param {string} keyHash
 * @param {object} tier
 * @returns {{ allowed: boolean, used: number, limit: number, remaining: number }}
 */
async function checkQuota(keyHash, tier) {
  const used = await getUsage(keyHash);
  const limit = tier.conversionsPerMonth;
  return {
    allowed: used < limit,
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

module.exports = {
  registerKey,
  validateKey,
  getUsage,
  incrementUsage,
  checkQuota,
  hashKey,
  currentMonth,
  TIERS,
};
