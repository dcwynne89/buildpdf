/* ============================================================
   converter.js – Client-side file-to-PDF conversion logic
   Supports: Images (JPG/PNG/WEBP/GIF/BMP), DOCX, TXT, HTML
   Uses: jsPDF (bundled via CDN), mammoth.js (DOCX via CDN)
   ============================================================ */

(function () {
  'use strict';

  // ── FACEBOOK IN-APP BROWSER DETECTION ──
  const isFacebookBrowser = /FBAN|FBAV|FB_IAB|Instagram/i.test(navigator.userAgent);

  if (isFacebookBrowser) {
    showFacebookBanner();
  }

  function showFacebookBanner() {
    // Non-blocking top banner — lets users keep using the site
    const banner = document.createElement('div');
    banner.id = 'fb-browser-banner';
    banner.innerHTML = `
      <div class="fb-tip-inner">
        <span class="fb-tip-icon">💡</span>
        <span class="fb-tip-text">
          You're using Facebook's browser. Tap the <strong>⋮</strong> menu → <strong>"Open in Browser"</strong> for the best experience. You can still use this page!
        </span>
        <button id="fb-tip-close" class="fb-tip-close" aria-label="Dismiss">✕</button>
      </div>
    `;

    // Inject styles for banner + WebView-specific adjustments
    const style = document.createElement('style');
    style.textContent = `
      #fb-browser-banner {
        position: fixed; top: 0; left: 0; right: 0; z-index: 10001;
        background: linear-gradient(135deg, #1e1b4b, #1a1b30);
        border-bottom: 1px solid rgba(108,99,255,.3);
        padding: 12px 16px;
        animation: fbBannerSlide 0.35s ease;
      }
      @keyframes fbBannerSlide {
        from { transform: translateY(-100%); }
        to { transform: translateY(0); }
      }
      .fb-tip-inner {
        max-width: 860px; margin: 0 auto;
        display: flex; align-items: center; gap: 10px;
      }
      .fb-tip-icon { font-size: 1.2rem; flex-shrink: 0; }
      .fb-tip-text {
        font-size: 0.82rem; color: #c8c8d8; line-height: 1.5; flex: 1;
      }
      .fb-tip-text strong { color: #E8E8F0; }
      .fb-tip-close {
        background: none; border: none; color: #8889A8; font-size: 1rem;
        cursor: pointer; padding: 4px 8px; flex-shrink: 0;
        border-radius: 6px; transition: all 0.2s;
      }
      .fb-tip-close:hover { color: #E8E8F0; background: rgba(255,255,255,0.08); }

      /* Adjust page when banner is visible */
      #fb-browser-banner ~ .site-header { top: 0; }
      body.fb-browser { padding-top: 52px; }

      /* Hide drag-drop text — it doesn't work in WebView */
      body.fb-browser .drop-title { font-size: 1.2rem; }
      body.fb-browser .drop-sub { display: none; }
      body.fb-browser .drop-icon { display: none; }
      body.fb-browser .drop-zone { padding: 36px 24px 32px; }
      body.fb-browser .drop-zone::before {
        content: 'Tap the button below to select files from your device';
        display: block; color: #8889A8; font-size: 0.88rem;
        margin-bottom: 16px;
      }
    `;
    document.head.appendChild(style);
    document.body.classList.add('fb-browser');
    document.body.prepend(banner);

    // Dismiss banner
    document.getElementById('fb-tip-close').addEventListener('click', () => {
      banner.style.transform = 'translateY(-100%)';
      banner.style.transition = 'transform 0.25s ease';
      setTimeout(() => {
        banner.remove();
        document.body.style.paddingTop = '';
      }, 260);
    });
  }

  // ── DOM refs ──
  const dropZone      = document.getElementById('dropZone');
  const fileInput     = document.getElementById('fileInput');
  const browseBtn     = document.getElementById('browseBtn');
  const fileList      = document.getElementById('fileList');
  const fileItems     = document.getElementById('fileItems');
  const optionsPanel  = document.getElementById('optionsPanel');
  const convertRow    = document.getElementById('convertRow');
  const convertBtn    = document.getElementById('convertBtn');
  const progressArea  = document.getElementById('progressArea');
  const progressBar   = document.getElementById('progressBar');
  const progressLabel = document.getElementById('progressLabel');
  const resultArea    = document.getElementById('resultArea');
  const resultDesc    = document.getElementById('resultDesc');
  const downloadBtn   = document.getElementById('downloadBtn');
  const anotherBtn    = document.getElementById('anotherBtn');
  const clearBtn      = document.getElementById('clearBtn');


  const pdfGenOptions = document.getElementById('pdfGenOptions');
  const pdfExtractOptions = document.getElementById('pdfExtractOptions');
  const outputFormat = document.getElementById('outputFormat');
  const optionsTitle = document.getElementById('optionsTitle');
  const convertBtnText = document.getElementById('convertBtnText');
  const downloadBtnText = document.getElementById('downloadBtnText');

  let files = [];       // { file: File, id: number }
  let pdfBlob = null;
  let outputBlob = null;
  let outputFilename = null;
  let idCounter = 0;

  // ── Close sticky ad (guard: element may not exist) ──
  const adClose  = document.getElementById('adClose');
  const adSticky = document.getElementById('ad-sticky');
  if (adClose && adSticky) {
    adClose.addEventListener('click', () => {
      adSticky.style.display = 'none';
    });
  }

  // ── Drag & drop ──
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  ['dragleave', 'dragend'].forEach(ev =>
    dropZone.addEventListener(ev, () => dropZone.classList.remove('drag-over'))
  );
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    addFiles(Array.from(e.dataTransfer.files));
  });

  dropZone.addEventListener('click', e => {
    if (e.target === browseBtn || browseBtn.contains(e.target)) return;
    fileInput.click();
  });
  browseBtn.addEventListener('click', e => {
    e.stopPropagation();
    fileInput.click();
  });
  fileInput.addEventListener('change', () => addFiles(Array.from(fileInput.files)));

  // ── Clear all ──
  clearBtn.addEventListener('click', resetAll);

  // ── Convert ──
  convertBtn.addEventListener('click', runConversion);

  // ─── Another ──
  anotherBtn.addEventListener('click', resetAll);

  // ── Helpers ──
  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function getExt(name) {
    return (name.split('.').pop() || '').toLowerCase();
  }

  function getFileType(name) {
    const ext = getExt(name);
    if (['jpg','jpeg','png','webp','gif','bmp'].includes(ext)) return 'image';
    if (ext === 'docx') return 'docx';
    if (ext === 'txt')  return 'text';
    if (['html','htm'].includes(ext)) return 'html';
    if (ext === 'pdf') return 'pdf';
    return 'unknown';
  }

  function isSupported(name) {
    return getFileType(name) !== 'unknown';
  }

  function fileIconClass(type) {
    return { image: 'file-icon--image', docx: 'file-icon--doc', text: 'file-icon--text', html: 'file-icon--html', pdf: 'file-icon--pdf' }[type] || '';
  }
  function fileIconEmoji(type) {
    return { image: '🖼', docx: '📄', text: '📝', html: '🌐', pdf: '📄' }[type] || '📁';
  }

  // ── Add files ──
  function addFiles(raw) {
    const valid = raw.filter(f => isSupported(f.name));
    const invalid = raw.filter(f => !isSupported(f.name));
    if (invalid.length) {
      showToast(`${invalid.length} unsupported file(s) skipped.`, 'warn');
    }
    valid.forEach(f => {
      const id = ++idCounter;
      files.push({ file: f, id });
      appendFileItem(f, id);
    });
    if (files.length > 0) showControls();
    // reset input so same file can be re-added
    fileInput.value = '';
  }

  function appendFileItem(f, id) {
    const type = getFileType(f.name);
    const li = document.createElement('li');
    li.className = 'file-item';
    li.dataset.id = id;
    li.innerHTML = `
      <div class="file-icon ${fileIconClass(type)}">${fileIconEmoji(type)}</div>
      <div class="file-info">
        <div class="file-name" title="${escHtml(f.name)}">${escHtml(f.name)}</div>
        <div class="file-size">${formatBytes(f.size)}</div>
      </div>
      <button class="file-remove" title="Remove" data-id="${id}">✕</button>
    `;
    li.querySelector('.file-remove').addEventListener('click', () => removeFile(id));
    fileItems.appendChild(li);
  }

  function removeFile(id) {
    files = files.filter(f => f.id !== id);
    const li = fileItems.querySelector(`[data-id="${id}"]`);
    if (li) li.remove();
    if (files.length === 0) resetAll();
  }

  function showControls() {
    fileList.style.display    = '';
    optionsPanel.style.display = '';
    convertRow.style.display  = '';
    resultArea.style.display  = 'none';
    progressArea.style.display = 'none';
    pdfBlob = null;
    outputBlob = null;
    outputFilename = null;

    const hasPdf = files.some(f => getFileType(f.file.name) === 'pdf');
    if (hasPdf) {
      if (files.length > 1) {
         showToast('Multiple PDFs cannot be extracted at once. Proceeding with first PDF only.', 'warn');
      }
      optionsTitle.textContent = 'Extraction Options';
      pdfGenOptions.style.display = 'none';
      pdfExtractOptions.style.display = '';
      convertBtnText.textContent = 'Extract PDF';
      downloadBtnText.textContent = 'Download Files';
    } else {
      optionsTitle.textContent = 'PDF Options';
      pdfGenOptions.style.display = '';
      pdfExtractOptions.style.display = 'none';
      convertBtnText.textContent = 'Convert to PDF';
      downloadBtnText.textContent = 'Download PDF';
    }
  }

  function resetAll() {
    files = [];
    pdfBlob = null;
    outputBlob = null;
    outputFilename = null;
    fileItems.innerHTML = '';
    fileList.style.display     = 'none';
    optionsPanel.style.display = 'none';
    convertRow.style.display   = 'none';
    progressArea.style.display = 'none';
    resultArea.style.display   = 'none';
    convertBtn.disabled = false;
  }

  // ── TOAST ──
  function showToast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = `toast toast--${type}`;
    t.textContent = msg;
    Object.assign(t.style, {
      position: 'fixed', bottom: '110px', left: '50%', transform: 'translateX(-50%) translateY(20px)',
      background: type === 'warn' ? '#92400e' : '#1e1b4b',
      color: '#fff', borderRadius: '10px', padding: '10px 20px',
      fontSize: '.85rem', fontWeight: '600', zIndex: '9999',
      boxShadow: '0 4px 20px rgba(0,0,0,.4)',
      transition: 'opacity .3s, transform .3s',
      opacity: '0',
    });
    document.body.appendChild(t);
    requestAnimationFrame(() => {
      t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(() => {
      t.style.opacity = '0'; t.style.transform = 'translateX(-50%) translateY(20px)';
      setTimeout(() => t.remove(), 400);
    }, 3200);
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── PROGRESS HELPERS ──
  function setProgress(pct, label) {
    progressBar.style.width = pct + '%';
    progressLabel.textContent = label;
  }

  async function runConversion() {
    if (!files.length) return;
    convertBtn.disabled = true;

    const hasPdf = files.some(f => getFileType(f.file.name) === 'pdf');
    if (hasPdf) {
      await runExtraction();
      return;
    }

    const pageSize   = document.getElementById('pageSize').value;
    const orientation = document.getElementById('orientation').value;
    const margin     = parseInt(document.getElementById('margin').value, 10);
    const imgQual    = parseFloat(document.getElementById('imgQuality').value);

    convertRow.style.display   = 'none';
    progressArea.style.display = '';
    setProgress(0, 'Starting conversion…');

    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation, unit: 'mm', format: pageSize });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const usableW = pageW - margin * 2;
      const usableH = pageH - margin * 2;

      let firstPage = true;

      for (let i = 0; i < files.length; i++) {
        const { file } = files[i];
        const type = getFileType(file.name);
        const pct = Math.round(((i) / files.length) * 90);
        setProgress(pct, `Processing: ${file.name}`);

        if (!firstPage) doc.addPage();
        firstPage = false;

        if (type === 'image') {
          await addImagePage(doc, file, margin, usableW, usableH, imgQual);
        } else if (type === 'text') {
          await addTextPage(doc, file, margin, pageW, usableW, usableH);
        } else if (type === 'docx') {
          await addDocxPages(doc, file, margin, pageW, usableW, usableH);
        } else if (type === 'html') {
          await addHtmlPage(doc, file, margin, pageW, usableW, usableH);
        }
      }

      setProgress(95, 'Generating PDF…');
      pdfBlob = doc.output('blob');
      setProgress(100, 'Done!');

      setTimeout(() => {
        progressArea.style.display = 'none';
        resultArea.style.display   = '';
        resultDesc.textContent = `${files.length} file${files.length > 1 ? 's' : ''} converted successfully.`;
        downloadBtn.onclick = () => triggerDownload(pdfBlob, buildFilename());
      }, 400);

    } catch (err) {
      console.error(err);
      setProgress(0, '');
      progressArea.style.display = 'none';
      convertBtn.disabled = false;
      convertRow.style.display = '';
      showToast('Conversion failed: ' + err.message, 'warn');
    }
  }

  // ── PDF EXTRACTION ──
  async function runExtraction() {
    const pdfFile = files.find(f => getFileType(f.file.name) === 'pdf').file;
    const format = document.getElementById('outputFormat').value;

    convertRow.style.display   = 'none';
    progressArea.style.display = '';
    setProgress(0, 'Loading PDF…');

    try {
      const arrayBuffer = await pdfFile.arrayBuffer();
      const pdfDocs = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      if (format === 'text') {
        setProgress(20, 'Extracting text…');
        let fullText = '';
        for (let i = 1; i <= pdfDocs.numPages; i++) {
          setProgress(Math.round(20 + (i / pdfDocs.numPages) * 70), `Extracting page ${i}…`);
          const page = await pdfDocs.getPage(i);
          const textContent = await page.getTextContent();
          const strings = textContent.items.map(item => item.str);
          fullText += strings.join(' ') + '\n\n';
        }
        
        outputBlob = new Blob([fullText], { type: 'text/plain' });
        outputFilename = pdfFile.name.replace(/\.[^.]+$/, '') + '_extracted.txt';
        
      } else if (format === 'images') {
        setProgress(10, 'Initializing ZIP…');
        const zip = new JSZip();
        
        for (let i = 1; i <= pdfDocs.numPages; i++) {
          setProgress(Math.round(10 + (i / pdfDocs.numPages) * 80), `Rendering page ${i}…`);
          const page = await pdfDocs.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          
          await page.render({ canvasContext: ctx, viewport: viewport }).promise;
          const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
          const base64Data = dataUrl.split(',')[1];
          zip.file(`page_${i}.jpg`, base64Data, { base64: true });
        }
        
        setProgress(95, 'Zipping images…');
        outputBlob = await zip.generateAsync({ type: 'blob' });
        outputFilename = pdfFile.name.replace(/\.[^.]+$/, '') + '_images.zip';
      }

      setProgress(100, 'Done!');

      setTimeout(() => {
        progressArea.style.display = 'none';
        resultArea.style.display   = '';
        resultDesc.textContent = `PDF extracted successfully.`;
        downloadBtn.onclick = () => triggerDownload(outputBlob, outputFilename);
      }, 400);

    } catch (err) {
      console.error(err);
      setProgress(0, '');
      progressArea.style.display = 'none';
      convertBtn.disabled = false;
      convertRow.style.display = '';
      showToast('Extraction failed: ' + err.message, 'warn');
    }
  }

  // ── IMAGE → PDF ──
  async function addImagePage(doc, file, margin, usableW, usableH, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          const ratio = Math.min(usableW / img.width, usableH / img.height, 1);
          const w = img.width  * ratio;
          const h = img.height * ratio;
          const x = margin + (usableW - w) / 2;
          const y = margin + (usableH - h) / 2;
          const ext = getExt(file.name).toUpperCase();
          const fmt = ['JPG','JPEG'].includes(ext) ? 'JPEG' : 'PNG';
          // Use canvas for quality control on JPEG
          const canvas = document.createElement('canvas');
          canvas.width  = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const dataUrl = canvas.toDataURL(fmt === 'JPEG' ? 'image/jpeg' : 'image/png', quality);
          doc.addImage(dataUrl, fmt === 'JPEG' ? 'JPEG' : 'PNG', x, y, w, h);
          resolve();
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ── TEXT → PDF ──
  async function addTextPage(doc, file, margin, pageW, usableW, usableH) {
    const text = await file.text();
    const lines = doc.splitTextToSize(text, usableW);
    const lineH = 6;
    const perPage = Math.floor(usableH / lineH);
    let y = margin;
    let linesOnPage = 0;
    let firstPage = true;

    doc.setFontSize(11);
    doc.setTextColor(30, 30, 30);

    for (let i = 0; i < lines.length; i++) {
      if (!firstPage && linesOnPage >= perPage) {
        doc.addPage();
        y = margin;
        linesOnPage = 0;
      }
      doc.text(lines[i], margin, y);
      y += lineH;
      linesOnPage++;
      firstPage = false;
    }
  }

  // ── DOCX → PDF ──
  async function addDocxPages(doc, file, margin, pageW, usableW, usableH) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const text = result.value;
    // Reuse text page renderer
    const fakeFile = { text: () => Promise.resolve(text) };
    await addTextPage(doc, fakeFile, margin, pageW, usableW, usableH);

    if (result.messages && result.messages.length) {
      console.warn('mammoth messages:', result.messages);
    }
  }

  // ── HTML → PDF ──
  async function addHtmlPage(doc, file, margin, pageW, usableW, usableH) {
    const html = await file.text();
    // Strip tags for plain text fallback
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const text = tmp.innerText || tmp.textContent || '';
    const fakeFile = { text: () => Promise.resolve(text) };
    await addTextPage(doc, fakeFile, margin, pageW, usableW, usableH);
  }

  // ── DOWNLOAD (with Facebook WebView fallback chain) ──
  async function triggerDownload(blob, filename) {
    if (!isFacebookBrowser) {
      // Standard Blob URL download — works in all normal browsers
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return;
    }

    // ── FACEBOOK WEBVIEW: try multiple strategies ──

    // Strategy 1: Web Share API (works on most mobile WebViews)
    if (navigator.share && navigator.canShare) {
      try {
        const file = new File([blob], filename, { type: blob.type || 'application/pdf' });
        const shareData = { files: [file], title: filename };
        if (navigator.canShare(shareData)) {
          await navigator.share(shareData);
          return;
        }
      } catch (err) {
        // User cancelled share or API failed — fall through to next strategy
        if (err.name === 'AbortError') return; // user cancelled, that's fine
        console.warn('Web Share failed, trying fallback:', err);
      }
    }

    // Strategy 2: Open blob in new window/tab (lets user long-press to save)
    try {
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank');
      if (w) {
        // Show a toast to guide the user
        showToast('Your file opened in a new tab — long-press or use the share button to save it.', 'info');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        return;
      }
    } catch (e) {
      console.warn('window.open fallback failed:', e);
    }

    // Strategy 3: Data URI anchor click (last resort)
    const reader = new FileReader();
    reader.onload = function () {
      const a = document.createElement('a');
      a.href = reader.result;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => document.body.removeChild(a), 1000);
    };
    reader.readAsDataURL(blob);
  }

  function buildFilename() {
    if (files.length === 1) {
      const base = files[0].file.name.replace(/\.[^.]+$/, '');
      return base + '.pdf';
    }
    return 'converted_' + Date.now() + '.pdf';
  }

})();
