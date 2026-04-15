/* ============================================================
   convert.js — File/HTML to PDF conversion endpoint
   POST /api/v1/convert

   HTML path  → pdfmake + html-to-pdfmake (real tables, headings,
                bold/italic, lists, colors — pure JS, no browser)
   Text path  → jsPDF (lightweight plain text renderer)
   Image path → jsPDF (JPG/PNG scaled to page)
   ============================================================ */

const { authenticate, jsonResponse, errorResponse } = require("./utils/auth");
const { incrementUsage, MAX_BODY_BYTES } = require("./utils/storage");

// Page size map: our API values → pdfmake values
const PAGE_SIZE_MAP = {
  a4:     "A4",
  letter: "LETTER",
  a3:     "A3",
  legal:  "LEGAL",
};

// mm → PDF points (1mm = 2.8346 pt)
const mmToPt = (mm) => mm * 2.8346;

exports.handler = async (event) => {
  // ── Auth ──
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

  // ── Parse options ──
  const pageSize    = options.pageSize    || "a4";
  const orientation = options.orientation || "portrait";
  const margin      = options.margin != null ? Number(options.margin) : 10;
  const quality     = options.quality     || 0.95;

  // ── File size check ──
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

    // ──────────────────────────────────────────────────────────
    // PATH A: HTML → pdfmake
    // Real tables, headings (h1–h6), bold, italic, lists, colors
    // ──────────────────────────────────────────────────────────
    if (html) {
      const result = await renderHtmlWithPdfmake(html, {
        pageSize, orientation, margin, watermark: auth.tier.watermark,
      });
      pdfBuffer = result.buffer;
      pageCount  = result.pages;

    // ──────────────────────────────────────────────────────────
    // PATH B: Plain text → jsPDF
    // ──────────────────────────────────────────────────────────
    } else if (text || (file && format === "text")) {
      const content = text || Buffer.from(file, "base64").toString("utf-8");
      const result = renderTextWithJsPDF(content, {
        pageSize, orientation, margin, watermark: auth.tier.watermark,
      });
      pdfBuffer = result.buffer;
      pageCount  = result.pages;

    // ──────────────────────────────────────────────────────────
    // PATH C: Image (JPG / PNG) → jsPDF
    // ──────────────────────────────────────────────────────────
    } else if (file) {
      const imgBuffer = Buffer.from(file, "base64");
      const imgFormat = detectImageFormat(imgBuffer);
      if (!imgFormat) {
        return errorResponse(400, "Unsupported image format. Supported: JPG, PNG.");
      }
      const result = renderImageWithJsPDF(file, imgFormat, {
        pageSize, orientation, margin, quality, watermark: auth.tier.watermark,
      });
      pdfBuffer  = result.buffer;
      pageCount  = 1;

    } else {
      return errorResponse(400, "Unsupported input. Use 'html', 'text', or 'file'.");
    }

    // ── Increment usage ──
    await incrementUsage(auth.hash);

    return jsonResponse(200, {
      success:     true,
      pdf:         pdfBuffer.toString("base64"),
      pages:       pageCount,
      sizeBytes:   pdfBuffer.length,
      watermark:   auth.tier.watermark,
      usage: {
        used:      auth.quota.used + 1,
        limit:     auth.quota.limit,
        remaining: auth.quota.remaining - 1,
      },
      powered_by: "https://buildpdf.co",
    });

  } catch (err) {
    console.error("Conversion error:", err);
    return errorResponse(500, "PDF conversion failed. Please try again.");
  }
};

// ─────────────────────────────────────────────────────────────
// pdfmake HTML renderer
// Handles: h1–h6, p, b/strong, i/em, ul/ol/li, table/tr/th/td,
//          br, a, span (with inline color), hr
// ─────────────────────────────────────────────────────────────
async function renderHtmlWithPdfmake(html, { pageSize, orientation, margin, watermark }) {
  const path          = require("path");
  const PdfPrinter    = require("pdfmake/src/printer");
  const htmlToPdfmake = require("html-to-pdfmake");
  const { JSDOM }     = require("jsdom");

  // jsdom window is required by html-to-pdfmake in Node.js
  const { window } = new JSDOM("");

  // Server-side pdfmake font loading — use actual .ttf file paths,
  // NOT the browser VFS. pdfmake ships Roboto fonts in its fonts/ directory.
  const pdfmakeDir = path.dirname(require.resolve("pdfmake/package.json"));
  const fontsDir   = path.join(pdfmakeDir, "fonts");
  const fonts = {
    Roboto: {
      normal:      path.join(fontsDir, "Roboto-Regular.ttf"),
      bold:        path.join(fontsDir, "Roboto-Medium.ttf"),
      italics:     path.join(fontsDir, "Roboto-Italic.ttf"),
      bolditalics: path.join(fontsDir, "Roboto-MediumItalic.ttf"),
    },
  };

  // Wrap bare HTML fragments in a full document
  const fullHtml = /^<!doctype|^<html/i.test(html.trim())
    ? html
    : `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;

  // Convert HTML → pdfmake content array
  const content = htmlToPdfmake(fullHtml, {
    window,
    tableAutoSize:     true,
    ignoreStyles:      false,
    removeExtraBlanks: true,
  });

  const marginPt = mmToPt(margin);

  const docDefinition = {
    content,
    pageSize:        PAGE_SIZE_MAP[pageSize] || "A4",
    pageOrientation: orientation === "landscape" ? "landscape" : "portrait",
    pageMargins:     [marginPt, marginPt, marginPt, watermark ? marginPt + 14 : marginPt],
    defaultStyle: {
      font:       "Roboto",
      fontSize:   11,
      lineHeight: 1.4,
      color:      "#1a1a1a",
    },
    styles: {
      "html-h1": { fontSize: 24, bold: true, marginBottom: 8 },
      "html-h2": { fontSize: 20, bold: true, marginBottom: 6 },
      "html-h3": { fontSize: 16, bold: true, marginBottom: 5 },
      "html-h4": { fontSize: 14, bold: true, marginBottom: 4 },
      "html-h5": { fontSize: 12, bold: true, marginBottom: 3 },
      "html-h6": { fontSize: 11, bold: true, marginBottom: 2 },
      "html-p":  { marginBottom: 6 },
      "html-li": { marginBottom: 2 },
      "html-a":  { color: "#6C63FF", decoration: "underline" },
    },
    footer: watermark
      ? (currentPage, pageCount) => ({
          text:      `Generated by BuildPDF — buildpdf.co  |  Page ${currentPage} of ${pageCount}`,
          alignment: "center",
          fontSize:  8,
          color:     "#aaaaaa",
          margin:    [marginPt, 6, marginPt, 0],
        })
      : undefined,
  };

  const printer = new PdfPrinter(fonts);
  const pdfDoc  = printer.createPdfKitDocument(docDefinition);

  return new Promise((resolve, reject) => {
    const chunks = [];
    pdfDoc.on("data",  (c) => chunks.push(c));
    pdfDoc.on("end",   () => {
      const buffer = Buffer.concat(chunks);
      const matches = buffer.toString("latin1").match(/\/Type\s*\/Page[^s]/g);
      resolve({ buffer, pages: matches ? matches.length : 1 });
    });
    pdfDoc.on("error", reject);
    pdfDoc.end();
  });
}

// ─────────────────────────────────────────────────────────────
// jsPDF: Plain text → PDF
// ─────────────────────────────────────────────────────────────
function renderTextWithJsPDF(text, { pageSize, orientation, margin, watermark }) {
  const { jsPDF } = require("jspdf");
  const doc = new jsPDF({ orientation, unit: "mm", format: pageSize });
  const pageW   = doc.internal.pageSize.getWidth();
  const pageH   = doc.internal.pageSize.getHeight();
  const usableW = pageW - margin * 2;
  const usableH = pageH - margin * 2;

  doc.setFontSize(11);
  doc.setTextColor(30, 30, 30);

  const lines   = doc.splitTextToSize(text, usableW);
  const lineH   = 6;
  const perPage = Math.floor(usableH / lineH);
  let y = margin, linesOnPage = 0, pages = 1;

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
      doc.text("Generated by BuildPDF — buildpdf.co", pageW / 2, pageH - 5, { align: "center" });
    }
  }

  return { buffer: Buffer.from(doc.output("arraybuffer")), pages };
}

// ─────────────────────────────────────────────────────────────
// jsPDF: Image (JPG / PNG) → PDF
// ─────────────────────────────────────────────────────────────
function renderImageWithJsPDF(base64, imgFormat, { pageSize, orientation, margin, quality, watermark }) {
  const { jsPDF } = require("jspdf");
  const doc = new jsPDF({ orientation, unit: "mm", format: pageSize });
  const pageW   = doc.internal.pageSize.getWidth();
  const pageH   = doc.internal.pageSize.getHeight();
  const usableW = pageW - margin * 2;
  const usableH = pageH - margin * 2;

  const jsPdfFmt = imgFormat === "jpeg" ? "JPEG" : "PNG";
  doc.addImage(`data:image/${imgFormat};base64,${base64}`, jsPdfFmt, margin, margin, usableW, usableH);

  if (watermark) {
    doc.setFontSize(8);
    doc.setTextColor(160, 160, 160);
    doc.text("Generated by BuildPDF — buildpdf.co", pageW / 2, pageH - 5, { align: "center" });
  }

  return { buffer: Buffer.from(doc.output("arraybuffer")) };
}

// ─────────────────────────────────────────────────────────────
// Detect image format from buffer magic bytes
// ─────────────────────────────────────────────────────────────
function detectImageFormat(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "png";
  return null;
}
