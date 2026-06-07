/* ============================================================
   auth.js — BuildPDF API authentication
   Powered by @buildplatform/api-core
   ============================================================ */
const api = require("./api-core-config");

module.exports = {
  authenticate:  api.authenticate,
  jsonResponse:  api.jsonResponse,
  errorResponse: api.errorResponse,
  CORS_HEADERS:  api.CORS_HEADERS,
};
