/* ============================================================
   storage.js — BuildPDF key management & usage tracking
   Powered by @buildplatform/api-core
   ============================================================ */
const api = require("./api-core-config");

module.exports = {
  registerKey:               api.registerKey,
  validateKey:               api.validateKey,
  emailHasKey:               api.emailHasKey,
  checkRegistrationLimit:    api.checkRegistrationLimit,
  recordRegistrationAttempt: api.recordRegistrationAttempt,
  getUsage:                  api.getUsage,
  incrementUsage:            api.incrementUsage,
  checkQuota:                api.checkQuota,
  hashKey:                   api.hashKey,
  currentMonth:              api.currentMonth,
  TIERS:                     api.TIERS,
  MAX_BODY_BYTES:            api.MAX_BODY_BYTES,
};
