/* ============================================================
   usage.js — API usage/quota check endpoint
   GET /api/v1/usage
   ============================================================ */

const { authenticate, jsonResponse } = require("./utils/auth");

exports.handler = async (event) => {
  // ── Auth check (don't count this as a conversion) ──
  const { auth, response } = await authenticate(event, { countUsage: false });
  if (response) return response;

  return jsonResponse(200, {
    success: true,
    tier: auth.tier.name,
    billing_period: currentBillingPeriod(),
    usage: {
      used: auth.quota.used,
      limit: auth.quota.limit,
      remaining: auth.quota.remaining,
      percentUsed: Math.round((auth.quota.used / auth.quota.limit) * 100),
    },
    limits: {
      maxFileSizeMB: auth.tier.maxFileSizeMB,
      ratePerMinute: auth.tier.ratePerMinute,
      extractEnabled: auth.tier.extractEnabled,
      batchEnabled: auth.tier.batchEnabled,
      watermark: auth.tier.watermark,
    },
    powered_by: "https://buildpdf.co",
  });
};

function currentBillingPeriod() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  };
}
