/* ============================================================
   register.js — API key registration endpoint
   POST /api/v1/register
   ============================================================ */

const { registerKey } = require("./utils/storage");
const { jsonResponse, errorResponse, CORS_HEADERS } = require("./utils/auth");

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return errorResponse(405, "Method not allowed. Use POST.");
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

  // Basic spam protection: limit to reasonable email length
  if (email.length > 254) {
    return errorResponse(400, "Email address too long.");
  }

  try {
    const { apiKey, keyHash } = await registerKey(email);

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
    return errorResponse(500, "Failed to create API key: " + err.message);
  }
};
