/* BuildPDF — API core configuration */
const { createApiCore } = require("../../../shared/api-core");

const api = createApiCore({
  keyPrefix: "bpdf_",
  quotaField: "conversionsPerMonth",
  maxBodyBytes: 10 * 1024 * 1024,
  maxRegistrationsPerHour: 3,
  quotaMessage: "Monthly conversion limit reached.",
  upgradeUrl: "https://buildpdf.co/api/docs#pricing",
  enableRateLimiter: true,
  defaultCountUsage: true,
  tiers: {
    free:     { name: "Free",     conversionsPerMonth: 100,   maxFileSizeMB: 5,   ratePerMinute: 10,   watermark: true,  extractEnabled: false, batchEnabled: false },
    starter:  { name: "Starter",  conversionsPerMonth: 1000,  maxFileSizeMB: 25,  ratePerMinute: 60,   watermark: false, extractEnabled: true,  batchEnabled: false },
    pro:      { name: "Pro",      conversionsPerMonth: 10000, maxFileSizeMB: 50,  ratePerMinute: 300,  watermark: false, extractEnabled: true,  batchEnabled: true },
    business: { name: "Business", conversionsPerMonth: 50000, maxFileSizeMB: 100, ratePerMinute: 1000, watermark: false, extractEnabled: true,  batchEnabled: true },
  },
});

/**
 * BuildPDF-specific auth wrapper: adds extractEnabled feature gating.
 */
async function authenticate(event, { requireExtract = false, ...opts } = {}) {
  const result = await api.authenticate(event, opts);
  if (result.response) return result;

  if (requireExtract && !result.auth.tier.extractEnabled) {
    return {
      auth: null,
      response: api.errorResponse(403, "PDF extraction requires Starter tier or above.", {
        upgrade: "https://buildpdf.co/api/docs#pricing",
      }),
    };
  }
  return result;
}

api.authenticate = authenticate;
module.exports = api;
