/* ============================================================
   lib/storage.js — Netlify Blobs key management & usage tracking
   Shared across the Build ecosystem
   ============================================================ */

const { getStore } = require("@netlify/blobs");
const crypto = require("crypto");

const KEYS_STORE  = "api-keys";
const USAGE_STORE = "api-usage";

/**
 * Create a configured store instance, passing credentials explicitly
 * so bundled @netlify/blobs can find them from env vars.
 */
function getConfiguredStore(name) {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token  = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_API_TOKEN;
  if (siteID && token) return getStore({ name, siteID, token });
  return getStore(name);
}

/** SHA-256 hash of a string, returned as hex. */
async function hashKey(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

/** Current month as YYYY-MM string. */
function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Create storage functions bound to a product config.
 *
 * @param {object} config
 * @param {string} config.keyPrefix   – e.g. "bqte_"
 * @param {string} config.quotaField  – e.g. "quotesPerMonth"
 * @param {object} config.tiers       – tier definitions
 * @param {number} config.maxRegistrationsPerHour – IP rate limit (default 3)
 */
function createStorage(config) {
  const {
    keyPrefix,
    quotaField,
    tiers,
    maxRegistrationsPerHour = 3,
  } = config;

  /** Generate a new API key with the product prefix. */
  function generateApiKey() {
    return keyPrefix + crypto.randomBytes(24).toString("base64url");
  }

  /** Check if an email already has a registered key. */
  async function emailHasKey(email) {
    const store = getConfiguredStore(KEYS_STORE);
    try {
      const record = await store.get(`email:${email}`, { type: "json" });
      return record && record.active;
    } catch { return false; }
  }

  /** Check IP registration rate limit. */
  async function checkRegistrationLimit(ip) {
    const store = getConfiguredStore(USAGE_STORE);
    try {
      const record = await store.get(`reg:${ip}`, { type: "json" });
      if (!record) return { allowed: true, remaining: maxRegistrationsPerHour };
      const hourAgo = Date.now() - 3600_000;
      const recent  = (record.attempts || []).filter((t) => t > hourAgo);
      if (recent.length >= maxRegistrationsPerHour) return { allowed: false, remaining: 0 };
      return { allowed: true, remaining: maxRegistrationsPerHour - recent.length };
    } catch { return { allowed: true, remaining: maxRegistrationsPerHour }; }
  }

  /** Record an IP registration attempt. */
  async function recordRegistrationAttempt(ip) {
    const store = getConfiguredStore(USAGE_STORE);
    let attempts = [];
    try {
      const record  = await store.get(`reg:${ip}`, { type: "json" });
      const hourAgo = Date.now() - 3600_000;
      attempts = (record?.attempts || []).filter((t) => t > hourAgo);
    } catch {}
    attempts.push(Date.now());
    await store.setJSON(`reg:${ip}`, { attempts });
  }

  /** Register a new API key for an email. */
  async function registerKey(email) {
    const store   = getConfiguredStore(KEYS_STORE);
    const apiKey  = generateApiKey();
    const keyHash = await hashKey(apiKey);
    const metadata = { email, tier: "free", createdAt: new Date().toISOString(), active: true };
    await store.setJSON(keyHash, metadata);
    await store.setJSON(`email:${email}`, { keyHash, active: true, createdAt: metadata.createdAt });
    return { apiKey, keyHash };
  }

  /** Validate an API key. Returns { hash, meta, tier } or null. */
  async function validateKey(apiKey) {
    if (!apiKey || !apiKey.startsWith(keyPrefix)) return null;
    const store   = getConfiguredStore(KEYS_STORE);
    const keyHash = await hashKey(apiKey);
    try {
      const meta = await store.get(keyHash, { type: "json" });
      if (!meta || !meta.active) return null;
      const tier = tiers[meta.tier] || tiers.free;
      return { hash: keyHash, meta, tier };
    } catch { return null; }
  }

  /** Get current month's usage count for a key hash. */
  async function getUsage(keyHash) {
    const store = getConfiguredStore(USAGE_STORE);
    try {
      const val = await store.get(`${keyHash}:${currentMonth()}`, { type: "json" });
      return val?.count || 0;
    } catch { return 0; }
  }

  /** Increment usage for a key hash. Supports bulk via amount param. */
  async function incrementUsage(keyHash, amount = 1) {
    const store = getConfiguredStore(USAGE_STORE);
    const key   = `${keyHash}:${currentMonth()}`;
    let current = 0;
    try { const val = await store.get(key, { type: "json" }); current = val?.count || 0; } catch {}
    const newCount = current + amount;
    await store.setJSON(key, { count: newCount, lastUsed: new Date().toISOString() });
    return newCount;
  }

  /** Check if a key is within its tier quota. */
  async function checkQuota(keyHash, tier) {
    const used  = await getUsage(keyHash);
    const limit = tier[quotaField];
    return { allowed: used < limit, used, limit, remaining: Math.max(0, limit - used) };
  }

  return {
    registerKey,
    validateKey,
    emailHasKey,
    checkRegistrationLimit,
    recordRegistrationAttempt,
    getUsage,
    incrementUsage,
    checkQuota,
  };
}

module.exports = { createStorage, hashKey, currentMonth, getConfiguredStore };
