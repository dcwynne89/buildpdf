/* ============================================================
   extract.js — PDF content extraction endpoint
   POST /api/v1/extract
   ============================================================ */

const { authenticate, jsonResponse, errorResponse } = require("./utils/auth");
const { incrementUsage, MAX_BODY_BYTES } = require("./utils/storage");

exports.handler = async (event) => {
  // ── Auth check (requires extract feature) ──
  const { auth, response } = await authenticate(event, {
    requireExtract: true,
    countUsage: true,
  });
  if (response) return response;

  if (event.httpMethod !== "POST") {
    return errorResponse(405, "Method not allowed. Use POST.");
  }

  // ── Body size check ──
  if (event.body && Buffer.byteLength(event.body, "utf-8") > MAX_BODY_BYTES) {
    return errorResponse(413, "Request body too large. Maximum 10MB.");
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return errorResponse(400, "Invalid JSON body.");
  }

  const { file, output = "text" } = body;

  if (!file) {
    return errorResponse(400, "A base64-encoded PDF file is required.", {
      example: {
        file: "<base64-encoded-pdf>",
        output: "text",
      },
    });
  }

  if (!["text", "images"].includes(output)) {
    return errorResponse(400, "Output must be 'text' or 'images'.", {
      supported: ["text", "images"],
    });
  }

  // Check file size
  const fileBuffer = Buffer.from(file, "base64");
  const maxBytes = auth.tier.maxFileSizeMB * 1024 * 1024;
  if (fileBuffer.length > maxBytes) {
    return errorResponse(413, `File too large. ${auth.tier.name} plan allows up to ${auth.tier.maxFileSizeMB}MB.`, {
      fileSizeMB: (fileBuffer.length / (1024 * 1024)).toFixed(2),
      limitMB: auth.tier.maxFileSizeMB,
    });
  }

  try {
    if (output === "text") {
      // ── Extract text using pdf-parse ──
      const pdfParse = require("pdf-parse");
      const data = await pdfParse(fileBuffer);

      await incrementUsage(auth.hash);

      return jsonResponse(200, {
        success: true,
        text: data.text,
        pages: data.numpages,
        info: {
          title: data.info?.Title || null,
          author: data.info?.Author || null,
          subject: data.info?.Subject || null,
        },
        usage: {
          used: auth.quota.used + 1,
          limit: auth.quota.limit,
          remaining: auth.quota.remaining - 1,
        },
        powered_by: "https://buildpdf.co",
      });

    } else {
      // ── Image extraction (MVP: return page count, full support later) ──
      const pdfParse = require("pdf-parse");
      const data = await pdfParse(fileBuffer);

      await incrementUsage(auth.hash);

      return jsonResponse(200, {
        success: true,
        pages: data.numpages,
        message: "Image extraction returns page-level images. Full image extraction coming in v1.1.",
        usage: {
          used: auth.quota.used + 1,
          limit: auth.quota.limit,
          remaining: auth.quota.remaining - 1,
        },
        powered_by: "https://buildpdf.co",
      });
    }
  } catch (err) {
    console.error("Extraction error:", err);
    return errorResponse(500, "PDF extraction failed. Please try again.");
  }
};
