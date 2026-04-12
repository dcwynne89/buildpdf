/* ============================================================
   register.js — API key registration endpoint
   POST /api/v1/register

   Security:
   - IP-based rate limiting (3 keys/hour/IP)
   - Email deduplication (1 active key per email)
   - Request body size limit
   - No internal error leaking
   ============================================================ */

const {
  registerKey,
  emailHasKey,
  checkRegistrationLimit,
  recordRegistrationAttempt,
  MAX_BODY_BYTES,
} = require("./utils/storage");
const { jsonResponse, errorResponse, CORS_HEADERS } = require("./utils/auth");

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return errorResponse(405, "Method not allowed. Use POST.");
  }

  // ── Body size check ──
  if (event.body && Buffer.byteLength(event.body, "utf-8") > MAX_BODY_BYTES) {
    return errorResponse(413, "Request body too large.");
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return errorResponse(400, "Invalid JSON body.");
  }

  const { email } = body;

  if (!email || !email.includes("@")) {
    return errorResponse(400, "A valid email address is required.", {
      example: { email: "dev@example.com" },
    });
  }

  // Sanitize + validate email
  const cleanEmail = email.trim().toLowerCase();

  if (cleanEmail.length > 254) {
    return errorResponse(400, "Email address too long.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return errorResponse(400, "Invalid email format.");
  }

  // ── IP-based rate limiting ──
  const clientIp =
    event.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    event.headers["client-ip"] ||
    "unknown";

  const regLimit = await checkRegistrationLimit(clientIp);
  if (!regLimit.allowed) {
    return errorResponse(429, "Too many registration attempts. Try again in an hour.", {
      retryAfter: 3600,
    });
  }

  // ── Email deduplication ──
  const existing = await emailHasKey(cleanEmail);
  if (existing) {
    return errorResponse(409, "This email already has an active API key. Contact support if you need a replacement.", {
      docs: "https://buildpdf.co/api/docs",
    });
  }

  try {
    // Record the attempt (even on success) for IP tracking
    await recordRegistrationAttempt(clientIp);

    const { apiKey } = await registerKey(cleanEmail);

    return jsonResponse(201, {
      success: true,
      message: "API key created successfully. Store this key securely — it cannot be retrieved later.",
      apiKey,
      tier: "free",
      limits: {
        conversionsPerMonth: 100,
        maxFileSizeMB: 5,
        ratePerMinute: 10,
      },
      docs: "https://buildpdf.co/api/docs",
    });
  } catch (err) {
    console.error("Registration error:", err);
    // Don't leak internal error details to the client
    return errorResponse(500, "Failed to create API key. Please try again.");
  }
};
