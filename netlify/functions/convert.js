/* ============================================================
   convert.js — File/HTML to PDF conversion endpoint
   POST /api/v1/convert

   HTML path  → Chromium (puppeteer-core + @sparticuz/chromium)
                Full CSS, fonts, layout — real browser rendering
   Text path  → jsPDF (lightweight, no browser)
   Image path → jsPDF (lightweight, no browser)
   ============================================================ */

const { authenticate, jsonResponse, errorResponse } = require("./utils/auth");
const { incrementUsage, MAX_BODY_BYTES } = require("./utils/storage");

// ── Lazy-load Chromium deps (only when needed for HTML path) ──
let _browser = null;

async function getBrowser() {
  if (_browser) return _browser;

  const chromium = require("@sparticuz/chromium");
  const puppeteer = require("puppeteer-core");

  // Allow local override via env var (useful for local dev / CI)
  const executablePath =
    process.env.CHROMIUM_EXECUTABLE_PATH ||
    (await chromium.executablePath());

  _browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
  });

  return _browser;
}

exports.handler = async (event) => {
  // ── Auth check ──
  const { auth, response } = await authenticate(event, { countUsage: true });
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

  const { html, file, format, text, options = {} } = body;

  // ── Validate input ──
  if (!html && !file && !text) {
    return errorResponse(400, "Provide at least one input: 'html', 'file' (base64), or 'text'.", {
      example: {
        html: "<h1>Hello World</h1><p>This is a test PDF.</p>",
        options: { pageSize: "a4", orientation: "portrait" },
      },
    });
  }

  // ── Parse options with defaults ──
  const pageSize    = options.pageSize    || "a4";
  const orientation = options.orientation || "portrait";
  const margin      = options.margin != null ? Number(options.margin) : 10;
  const quality     = options.quality     || 0.95;

  // File size check for binary inputs
  if (file) {
    const fileSizeBytes = Buffer.from(file, "base64").length;
    const maxBytes = auth.tier.maxFileSizeMB * 1024 * 1024;
    if (fileSizeBytes > maxBytes) {
      return errorResponse(413, `File too large. ${auth.tier.name} plan allows up to ${auth.tier.maxFileSizeMB}MB.`, {
        fileSizeMB: (fileSizeBytes / (1024 * 1024)).toFixed(2),
        limitMB: auth.tier.maxFileSizeMB,
        upgrade: "https://buildpdf.co/api/docs#pricing",
      });
    }
  }

  try {
    let pdfBuffer;
    let pageCount = 1;

    // ────────────────────────────────────────────────────────────
    // PATH A: HTML → Real Chromium rendering
    // ────────────────────────────────────────────────────────────
    if (html) {
      pdfBuffer = await renderHtmlWithChromium(html, {
        pageSize,
        orientation,
        margin,
        watermark: auth.tier.watermark,
      });

      // Count pages: estimate from buffer (PDF page count is in /Count obj)
      const pageMatch = pdfBuffer.toString("binary").match(/\/Count\s+(\d+)/);
      pageCount = pageMatch ? parseInt(pageMatch[1], 10) : 1;

    // ────────────────────────────────────────────────────────────
    // PATH B: Plain text → jsPDF (lightweight)
    // ────────────────────────────────────────────────────────────
    } else if (text || (file && format === "text")) {
      const content = text || Buffer.from(file, "base64").toString("utf-8");
      const result = renderTextWithJsPDF(content, { pageSize, orientation, margin, watermark: auth.tier.watermark });
      pdfBuffer = result.buffer;
      pageCount = result.pages;

    // ────────────────────────────────────────────────────────────
    // PATH C: Image (JPG/PNG) → jsPDF
    // ────────────────────────────────────────────────────────────
    } else if (file) {
      const imgBuffer = Buffer.from(file, "base64");
      const imgFormat = detectImageFormat(imgBuffer);

      if (!imgFormat) {
        return errorResponse(400, "Unsupported image format. Supported: JPG, PNG.");
      }

      const result = renderImageWithJsPDF(file, imgFormat, { pageSize, orientation, margin, quality, watermark: auth.tier.watermark });
      pdfBuffer = result.buffer;
      pageCount = 1;

    } else {
      return errorResponse(400, "Unsupported input. Use 'html', 'text', or 'file' with format 'image' or 'text'.");
    }

    // ── Increment usage ──
    await incrementUsage(auth.hash);

    return jsonResponse(200, {
      success: true,
      pdf: pdfBuffer.toString("base64"),
      pages: pageCount,
      sizeBytes: pdfBuffer.length,
      watermark: auth.tier.watermark,
      usage: {
        used: auth.quota.used + 1,
        limit: auth.quota.limit,
        remaining: auth.quota.remaining - 1,
      },
      powered_by: "https://buildpdf.co",
    });

  } catch (err) {
    console.error("Conversion error:", err);
    return errorResponse(500, "PDF conversion failed. Please try again.");
  }
};

// ─────────────────────────────────────────────────────────────────
// Chromium HTML → PDF
// Full browser rendering: real CSS, fonts, images, layout
// ─────────────────────────────────────────────────────────────────
async function renderHtmlWithChromium(html, { pageSize, orientation, margin, watermark }) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    // Map our pageSize names to Chromium paper formats
    const formatMap = {
      a4:     "A4",
      letter: "Letter",
      a3:     "A3",
      legal:  "Legal",
    };
    const paperFormat = formatMap[pageSize] || "A4";
    const landscape   = orientation === "landscape";
    const marginMm    = `${margin}mm`;

    // Wrap bare HTML fragments in a full document if needed
    const fullHtml = html.trimStart().toLowerCase().startsWith("<!doctype") ||
                     html.trimStart().toLowerCase().startsWith("<html")
      ? html
      : `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #1a1a1a;
      margin: 0;
      padding: 0;
    }
    h1, h2, h3, h4, h5, h6 { margin-top: 0; font-weight: 600; }
    p  { margin-top: 0; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px 12px; border: 1px solid #ddd; text-align: left; }
    th { background: #f5f5f5; font-weight: 600; }
    img { max-width: 100%; height: auto; }
    pre, code { background: #f5f5f5; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
  </style>
</head>
<body>${html}</body>
</html>`;

    await page.setContent(fullHtml, { waitUntil: "networkidle0", timeout: 20000 });

    // Inject watermark via CSS if needed (Free tier)
    if (watermark) {
      await page.addStyleTag({
        content: `
          body::after {
            content: 'Generated by BuildPDF · buildpdf.co';
            position: fixed;
            bottom: 8px;
            right: 12px;
            font-size: 9px;
            font-family: Arial, sans-serif;
            color: #aaa;
            pointer-events: none;
          }
        `,
      });
    }

    const pdfBuffer = await page.pdf({
      format: paperFormat,
      landscape,
      margin: {
        top:    marginMm,
        right:  marginMm,
        bottom: watermark ? "16mm" : marginMm, // extra bottom space for watermark
        left:   marginMm,
      },
      printBackground: true,
    });

    return Buffer.from(pdfBuffer);

  } finally {
    await page.close();
  }
}

// ─────────────────────────────────────────────────────────────────
// jsPDF: Plain text → PDF
// ─────────────────────────────────────────────────────────────────
function renderTextWithJsPDF(text, { pageSize, orientation, margin, watermark }) {
  const { jsPDF } = require("jspdf");
  const doc = new jsPDF({ orientation, unit: "mm", format: pageSize });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usableW = pageW - margin * 2;
  const usableH = pageH - margin * 2;

  doc.setFontSize(11);
  doc.setTextColor(30, 30, 30);

  const lines = doc.splitTextToSize(text, usableW);
  const lineH  = 6;
  const perPage = Math.floor(usableH / lineH);
  let y = margin;
  let linesOnPage = 0;
  let pages = 1;

  for (let i = 0; i < lines.length; i++) {
    if (linesOnPage >= perPage && i > 0) {
      doc.addPage();
      y = margin;
      linesOnPage = 0;
      pages++;
    }
    doc.text(lines[i], margin, y);
    y += lineH;
    linesOnPage++;
  }

  if (watermark) {
    const total = doc.internal.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      doc.setPage(p);
      doc.setFontSize(8);
      doc.setTextColor(160, 160, 160);
      doc.text("Generated by BuildPDF — Free PDF Converter → buildpdf.co", pageW / 2, pageH - 5, { align: "center" });
    }
  }

  return { buffer: Buffer.from(doc.output("arraybuffer")), pages };
}

// ─────────────────────────────────────────────────────────────────
// jsPDF: Image → PDF
// ─────────────────────────────────────────────────────────────────
function renderImageWithJsPDF(base64, imgFormat, { pageSize, orientation, margin, quality, watermark }) {
  const { jsPDF } = require("jspdf");
  const doc = new jsPDF({ orientation, unit: "mm", format: pageSize });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usableW = pageW - margin * 2;
  const usableH = pageH - margin * 2;

  const jsPdfFmt = imgFormat === "jpeg" ? "JPEG" : "PNG";
  const dataUrl  = `data:image/${imgFormat};base64,${base64}`;

  doc.addImage(dataUrl, jsPdfFmt, margin, margin, usableW, usableH);

  if (watermark) {
    doc.setFontSize(8);
    doc.setTextColor(160, 160, 160);
    doc.text("Generated by BuildPDF — Free PDF Converter → buildpdf.co", pageW / 2, pageH - 5, { align: "center" });
  }

  return { buffer: Buffer.from(doc.output("arraybuffer")) };
}

// ─────────────────────────────────────────────────────────────────
// Detect image format from buffer magic bytes
// ─────────────────────────────────────────────────────────────────
function detectImageFormat(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "png";
  return null;
}
