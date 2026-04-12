/* ============================================================
   storage.js — Netlify Blobs abstraction for API keys & usage
   ============================================================ */

const { getStore } = require("@netlify/blobs");

// ── Store names ──
const KEYS_STORE = "api-keys";
const USAGE_STORE = "api-usage";

// ── Get a properly configured store ──
// Netlify Blobs auto-context doesn't always inject in Git-linked deploys,
// so we explicitly pass siteID and token from environment variables.
function getConfiguredStore(name) {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_API_TOKEN;

  if (siteID && token) {
    return getStore({ name, siteID, token });
  }
  // Fallback to auto-context (works in some Netlify function environments)
  return getStore(name);
}


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

// ── Security constants ──
const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10MB max request body
const MAX_REGISTRATIONS_PER_IP_PER_HOUR = 3;

// ── API Key Operations ──

/**
 * Check if an email already has an active API key
 * @param {string} email
 * @returns {boolean}
 */
async function emailHasKey(email) {
  const store = getConfiguredStore(KEYS_STORE);
  try {
    const record = await store.get(`email:${email}`, { type: "json" });
    return record && record.active;
  } catch {
    return false;
  }
}

/**
 * Track registration attempts by IP address
 * @param {string} ip
 * @returns {{ allowed: boolean, remaining: number }}
 */
async function checkRegistrationLimit(ip) {
  const store = getConfiguredStore(USAGE_STORE);
  const key = `reg:${ip}`;

  try {
    const record = await store.get(key, { type: "json" });
    if (!record) return { allowed: true, remaining: MAX_REGISTRATIONS_PER_IP_PER_HOUR };

    const hourAgo = Date.now() - 3600_000;
    // Filter to only attempts within the last hour
    const recentAttempts = (record.attempts || []).filter((t) => t > hourAgo);

    if (recentAttempts.length >= MAX_REGISTRATIONS_PER_IP_PER_HOUR) {
      return { allowed: false, remaining: 0 };
    }
    return { allowed: true, remaining: MAX_REGISTRATIONS_PER_IP_PER_HOUR - recentAttempts.length };
  } catch {
    return { allowed: true, remaining: MAX_REGISTRATIONS_PER_IP_PER_HOUR };
  }
}

/**
 * Record a registration attempt for IP tracking
 * @param {string} ip
 */
async function recordRegistrationAttempt(ip) {
  const store = getConfiguredStore(USAGE_STORE);
  const key = `reg:${ip}`;

  let attempts = [];
  try {
    const record = await store.get(key, { type: "json" });
    const hourAgo = Date.now() - 3600_000;
    attempts = (record?.attempts || []).filter((t) => t > hourAgo);
  } catch {
    // first attempt
  }

  attempts.push(Date.now());
  await store.setJSON(key, { attempts });
}

/**
 * Register a new API key
 * @param {string} email
 * @returns {{ apiKey: string, keyHash: string }}
 */
async function registerKey(email) {
  const store = getConfiguredStore(KEYS_STORE);
  const apiKey = generateApiKey();
  const keyHash = await hashKey(apiKey);

  const metadata = {
    email,
    tier: "free",
    createdAt: new Date().toISOString(),
    active: true,
  };

  // Store the key metadata
  await store.setJSON(keyHash, metadata);

  // Store email→key index for dedup
  await store.setJSON(`email:${email}`, {
    keyHash,
    active: true,
    createdAt: metadata.createdAt,
  });

  return { apiKey, keyHash };
}

/**
 * Validate an API key and return its metadata + tier config
 * @param {string} apiKey
 * @returns {null | { hash: string, meta: object, tier: object }}
 */
async function validateKey(apiKey) {
  if (!apiKey || !apiKey.startsWith("bpdf_")) return null;

  const store = getConfiguredStore(KEYS_STORE);
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
  const store = getConfiguredStore(USAGE_STORE);
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
  const store = getConfiguredStore(USAGE_STORE);
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
  emailHasKey,
  checkRegistrationLimit,
  recordRegistrationAttempt,
  getUsage,
  incrementUsage,
  checkQuota,
  hashKey,
  currentMonth,
  TIERS,
  MAX_BODY_BYTES,
};
