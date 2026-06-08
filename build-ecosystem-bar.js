/* ============================================================
   Build Ecosystem Bar — Shared navigation strip
   
   Usage: Add to any Build site's <head>:
   <script src="/build-ecosystem-bar.js" defer></script>
   
   Auto-detects the current site and highlights it.
   Injects its own CSS. No dependencies.
   ============================================================ */

(function () {
  "use strict";

  const PRODUCTS = [
    { name: "Quotes",        domain: "buildquotes.co",        url: "https://buildquotes.co",        icon: "💼", accent: "#10b981" },
    { name: "Proposal",      domain: "buildproposal.co",      url: "https://buildproposal.netlify.app",      icon: "📑", accent: "#8b5cf6" },
    { name: "Contract",      domain: "buildcontract.co",      url: "https://buildcontract-396.netlify.app",  icon: "📝", accent: "#6366f1" },
    { name: "Invoice",       domain: "buildinvoice.co",       url: "https://buildinvoice.co",       icon: "⚡", accent: "#388BCA" },
    { name: "Receipt",       domain: "buildreceipt.co",       url: "https://buildreceipt.netlify.app",       icon: "🧾", accent: "#f43f5e" },
    { name: "ChangeOrder",   domain: "buildchangeorder.co",   url: "https://buildchangeorder.co",   icon: "📋", accent: "#F59E0B" },
    { name: "Timesheet",     domain: "buildtimesheet.co",     url: "https://buildtimesheet.netlify.app",     icon: "⏰", accent: "#06b6d4" },
    { name: "Warranty",      domain: "buildwarranty.co",      url: "https://buildwarranty.netlify.app",      icon: "🛡️", accent: "#d97706" },
    { name: "Paystub",       domain: "buildpaystub.co",       url: "https://buildpaystub.netlify.app",       icon: "💵", accent: "#10b981" },
    { name: "Certificates",  domain: "buildcertificates.com", url: "https://buildcertificates.com", icon: "🏅", accent: "#C5A55A" },
    { name: "Takeoff",       domain: "buildtakeoff.co",       url: "https://buildtakeoff.co",       icon: "📐", accent: "#F97316" },
    { name: "PDF",           domain: "buildpdf.co",           url: "https://buildpdf.co",           icon: "📄", accent: "#6C63FF" },
  ];

  const currentHost = window.location.hostname.replace(/^www\./, "");

  // Don't re-inject if already present
  if (document.getElementById("build-ecosystem-bar")) return;

  // ── Inject CSS ────────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = `
    #build-ecosystem-bar {
      position: relative;
      z-index: 50;
      width: 100%;
      background: linear-gradient(90deg, #06070b 0%, #0c0e18 50%, #06070b 100%);
      border-bottom: 1px solid rgba(255,255,255,0.06);
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      font-size: 12.5px;
      line-height: 1;
      user-select: none;
      -webkit-user-select: none;
      overflow: hidden;
    }

    #build-ecosystem-bar .beb-inner {
      display: flex;
      align-items: center;
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 16px;
      height: 36px;
      gap: 4px;
    }

    #build-ecosystem-bar .beb-label {
      color: rgba(255,255,255,0.35);
      font-size: 10.5px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      white-space: nowrap;
      margin-right: 8px;
      flex-shrink: 0;
    }

    #build-ecosystem-bar .beb-links {
      display: flex;
      align-items: center;
      gap: 2px;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
      -ms-overflow-style: none;
      flex: 1;
      min-width: 0;
      padding: 4px 0;
    }

    #build-ecosystem-bar .beb-links::-webkit-scrollbar {
      display: none;
    }

    #build-ecosystem-bar .beb-link {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border-radius: 6px;
      color: rgba(255,255,255,0.55);
      text-decoration: none;
      white-space: nowrap;
      transition: all 0.2s ease;
      flex-shrink: 0;
      font-weight: 500;
      border: 1px solid transparent;
    }

    #build-ecosystem-bar .beb-link:hover {
      color: rgba(255,255,255,0.95);
      background: rgba(255,255,255,0.06);
      border-color: rgba(255,255,255,0.08);
    }

    #build-ecosystem-bar .beb-link.beb-active {
      color: #fff;
      font-weight: 600;
      border-color: rgba(255,255,255,0.1);
    }

    #build-ecosystem-bar .beb-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
      opacity: 0.7;
    }

    #build-ecosystem-bar .beb-link.beb-active .beb-dot {
      opacity: 1;
      box-shadow: 0 0 6px currentColor;
    }

    #build-ecosystem-bar .beb-link-icon {
      font-size: 13px;
      line-height: 1;
    }

    #build-ecosystem-bar .beb-close {
      flex-shrink: 0;
      background: none;
      border: none;
      color: rgba(255,255,255,0.25);
      cursor: pointer;
      padding: 4px 6px;
      font-size: 14px;
      line-height: 1;
      border-radius: 4px;
      transition: all 0.2s ease;
      margin-left: 4px;
    }

    #build-ecosystem-bar .beb-close:hover {
      color: rgba(255,255,255,0.7);
      background: rgba(255,255,255,0.06);
    }

    /* Animate in */
    #build-ecosystem-bar.beb-entering {
      animation: bebSlideIn 0.3s ease-out forwards;
    }

    @keyframes bebSlideIn {
      from {
        height: 0;
        opacity: 0;
      }
      to {
        height: 36px;
        opacity: 1;
      }
    }

    /* Animate out */
    #build-ecosystem-bar.beb-leaving {
      animation: bebSlideOut 0.25s ease-in forwards;
    }

    @keyframes bebSlideOut {
      from {
        height: 36px;
        opacity: 1;
      }
      to {
        height: 0;
        opacity: 0;
      }
    }

    /* Mobile: hide label, let links scroll */
    @media (max-width: 640px) {
      #build-ecosystem-bar .beb-label {
        display: none;
      }

      #build-ecosystem-bar .beb-inner {
        padding: 0 8px;
      }

      #build-ecosystem-bar .beb-link {
        padding: 4px 8px;
        font-size: 11.5px;
      }
    }
  `;
  document.head.appendChild(style);

  // ── Build HTML ────────────────────────────────────────────
  const bar = document.createElement("div");
  bar.id = "build-ecosystem-bar";

  // Check if dismissed this session
  if (sessionStorage.getItem("beb-dismissed")) {
    return;
  }

  bar.classList.add("beb-entering");

  let linksHTML = "";
  PRODUCTS.forEach(function (p) {
    const isActive = currentHost === p.domain;
    const activeClass = isActive ? " beb-active" : "";
    const ariaLabel = isActive ? ' aria-current="page"' : "";
    const target = isActive ? "" : ' target="_blank" rel="noopener"';

    linksHTML += '<a href="' + p.url + '" class="beb-link' + activeClass + '"' + ariaLabel + target + '>'
      + '<span class="beb-dot" style="background:' + p.accent + ';color:' + p.accent + '"></span>'
      + '<span>Build' + p.name + '</span>'
      + '</a>';
  });

  bar.innerHTML = '<div class="beb-inner">'
    + '<span class="beb-label">Build Ecosystem</span>'
    + '<div class="beb-links">' + linksHTML + '</div>'
    + '<button class="beb-close" aria-label="Close ecosystem bar" title="Dismiss">&times;</button>'
    + '</div>';

  // ── Close handler ─────────────────────────────────────────
  bar.querySelector(".beb-close").addEventListener("click", function () {
    bar.classList.remove("beb-entering");
    bar.classList.add("beb-leaving");
    bar.addEventListener("animationend", function () {
      bar.remove();
    }, { once: true });
    sessionStorage.setItem("beb-dismissed", "1");
  });

  // ── Inject into page ──────────────────────────────────────
  // Insert as first child of <body>, before any nav or ad banner
  if (document.body.firstChild) {
    document.body.insertBefore(bar, document.body.firstChild);
  } else {
    document.body.appendChild(bar);
  }
})();
