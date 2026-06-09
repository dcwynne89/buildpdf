/* ============================================================
   Build Ecosystem Auth — Optional "Sign in to save" component
   
   Usage: Add to any Build site's <head>:
   <script src="/build-ecosystem-auth.js" defer></script>
   
   Provides:
   - Sign in / Sign up / Reset password modals
   - Nav integration (Sign In button → avatar dropdown)
   - Global BuildAuth API for product-specific integration
   
   Firebase project: vital-plating-422300-u2
   ============================================================ */

(function () {
  "use strict";

  // Prevent double-init
  if (window.BuildAuth) return;

  // ── Firebase Config ─────────────────────────────────────────
  const FIREBASE_CONFIG = {
    projectId: "vital-plating-422300-u2",
    appId: "1:508333980445:web:499558a9e0ac6c1fa9bff4",
    apiKey: "AIzaSyBEw8Fuha_9oHFKOjffTtG25_UafCJkWFE",
    authDomain: "vital-plating-422300-u2.firebaseapp.com",
    storageBucket: "vital-plating-422300-u2.firebasestorage.app",
    messagingSenderId: "508333980445",
  };
  const FIRESTORE_DB_ID = "ai-studio-8bfb8fad-f46f-42aa-9d90-c831ae70acbd";
  const FIREBASE_CDN = "https://www.gstatic.com/firebasejs/11.8.1";

  // ── State ───────────────────────────────────────────────────
  let firebaseApp = null;
  let firebaseAuth = null;
  let firebaseDb = null;
  let currentUser = null;
  let authListeners = [];
  let sdkReady = false;

  // ── Detect current product ──────────────────────────────────
  const host = window.location.hostname.replace(/^www\./, "");
  const PRODUCT_MAP = {
    "buildtakeoff.co":       "buildtakeoff",
    "buildquotes.co":        "buildquotes",
    "buildinvoice.co":       "buildinvoice",
    "buildchangeorder.co":   "buildchangeorder",
    "buildpdf.co":           "buildpdf",
    "buildcertificates.com": "buildcertificates",
  };
  const currentProduct = PRODUCT_MAP[host] || "unknown";

  // ── SSO Bridge ──────────────────────────────────────────────
  const BRIDGE_ORIGIN  = "https://buildstatus.co";
  const BRIDGE_URL     = BRIDGE_ORIGIN + "/auth-bridge.html";
  const IS_BRIDGE_HOST = (host === "buildstatus.co");
  let bridgeIframe = null;
  let bridgeReady  = false;


  // ── Load Firebase SDK modules from CDN ──────────────────────
  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.type = "module";
      s.src = url;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // We use the compat SDK for simplicity in a non-module environment
  function loadFirebaseCompat() {
    return new Promise(function (resolve, reject) {
      if (window.firebase) { resolve(); return; }
      var s1 = document.createElement("script");
      s1.src = FIREBASE_CDN + "/firebase-app-compat.js";
      s1.onload = function () {
        var s2 = document.createElement("script");
        s2.src = FIREBASE_CDN + "/firebase-auth-compat.js";
        s2.onload = function () {
          var s3 = document.createElement("script");
          s3.src = FIREBASE_CDN + "/firebase-firestore-compat.js";
          s3.onload = resolve;
          s3.onerror = reject;
          document.head.appendChild(s3);
        };
        s2.onerror = reject;
        document.head.appendChild(s2);
      };
      s1.onerror = reject;
      document.head.appendChild(s1);
    });
  }

  async function initFirebase() {
    try {
      await loadFirebaseCompat();
      // Use existing app if already initialized (e.g. from HTML <script> tags)
      if (firebase.apps && firebase.apps.length > 0) {
        firebaseApp = firebase.app();
      } else {
        firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);
      }
      firebaseAuth = firebase.auth();

      // Use .settings({databaseId}) — the correct compat-SDK way to connect to a named DB.
      // firebase.app().firestore(dbId) bypasses proper routing and hangs silently.
      firebaseDb = firebase.firestore();
      firebaseDb.settings({ databaseId: FIRESTORE_DB_ID });
      
      firebaseAuth.onAuthStateChanged(function (user) {
        currentUser = user;
        updateNavUI();
        authListeners.forEach(function (fn) { fn(user); });
        if (user) {
          updateUserProfile(user);
        }
      });

      sdkReady = true;

      // When user signs out locally, also tell bridge to sign out everywhere
      firebaseAuth.onAuthStateChanged(function(user) {
        if (!user && bridgeIframe && bridgeReady) {
          try {
            bridgeIframe.contentWindow.postMessage({ type: "BUILD_AUTH_SIGNOUT" }, BRIDGE_ORIGIN);
          } catch(e) {}
        }
      });

    } catch (err) {
      console.warn("[BuildAuth] Firebase init failed:", err.message);
    }
  }

  // ── SSO Bridge Setup ────────────────────────────────────────

  function initBridge() {
    // The bridge host (buildstatus.co) IS the bridge — no iframe needed
    if (IS_BRIDGE_HOST) return;

    // Inject hidden iframe
    bridgeIframe = document.createElement("iframe");
    bridgeIframe.src = BRIDGE_URL;
    bridgeIframe.style.cssText = "display:none;width:0;height:0;border:0;position:absolute;";
    bridgeIframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(bridgeIframe);

    // Listen for auth state from bridge
    window.addEventListener("message", function(e) {
      if (e.origin !== BRIDGE_ORIGIN) return;
      var data = e.data || {};

      if (data.type === "BUILD_AUTH_BRIDGE_READY") {
        bridgeReady = true;
        // Request current state immediately
        try {
          bridgeIframe.contentWindow.postMessage({ type: "BUILD_AUTH_PING" }, BRIDGE_ORIGIN);
        } catch(err) {}
      }

      if (data.type === "BUILD_AUTH_STATE") {
        if (data.token && data.user) {
          // Sign in on this domain using the bridge's ID token
          if (firebaseAuth && !firebaseAuth.currentUser) {
            firebaseAuth.signInWithCustomToken(data.token).catch(function() {
              // Custom token requires Cloud Function — fall back to displaying user info
              // without a Firebase session (read-only mode, good for nav display)
              currentUser = {
                uid: data.user.uid,
                email: data.user.email,
                displayName: data.user.displayName,
                photoURL: data.user.photoURL,
                _bridged: true,  // flag: session from bridge, not local Firebase
              };
              updateNavUI();
              authListeners.forEach(function(fn) { fn(currentUser); });
            });
          }
        } else {
          // Bridge says logged out — if we were only bridged, clear the UI
          if (currentUser && currentUser._bridged) {
            currentUser = null;
            updateNavUI();
            authListeners.forEach(function(fn) { fn(null); });
          }
        }
      }
    });
  }

  // ── Firestore Helpers ───────────────────────────────────────

  async function updateUserProfile(user) {
    if (!firebaseDb || !user) return;
    try {
      var userRef = firebaseDb.collection("users").doc(user.uid);
      var doc = await userRef.get();
      if (!doc.exists) {
        await userRef.set({
          displayName: user.displayName || "",
          email: user.email || "",
          company: "",
          phone: "",
          defaultAccentColor: "#7C3AED",
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastSeenAt: firebase.firestore.FieldValue.serverTimestamp(),
          products: [currentProduct],
        });
      } else {
        var data = doc.data();
        var products = data.products || [];
        if (products.indexOf(currentProduct) === -1) {
          products.push(currentProduct);
        }
        await userRef.update({
          lastSeenAt: firebase.firestore.FieldValue.serverTimestamp(),
          products: products,
        });
      }
    } catch (e) {
      console.warn("[BuildAuth] Profile update failed:", e.message);
    }
  }

  async function saveDocument(type, title, formData, extra) {
    if (!currentUser || !firebaseDb) return null;
    extra = extra || {};
    try {
      var docRef = await firebaseDb.collection("saved_documents").add({
        type: type,
        title: title,
        product: currentProduct,
        ownerUid: currentUser.uid,
        clientName: extra.clientName || "",
        total: extra.total || 0,
        status: extra.status || "draft",
        formData: formData,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      return docRef.id;
    } catch (e) {
      console.warn("[BuildAuth] Save failed:", e.message);
      return null;
    }
  }

  async function loadDocuments(type) {
    if (!currentUser || !firebaseDb) return [];
    try {
      var snap = await firebaseDb.collection("saved_documents")
        .where("ownerUid", "==", currentUser.uid)
        .where("type", "==", type)
        .orderBy("updatedAt", "desc")
        .limit(50)
        .get();
      var docs = [];
      snap.forEach(function (d) { docs.push(Object.assign({ id: d.id }, d.data())); });
      return docs;
    } catch (e) {
      console.warn("[BuildAuth] Load failed:", e.message);
      return [];
    }
  }

  async function getDocument(docId) {
    if (!currentUser || !firebaseDb) return null;
    try {
      var doc = await firebaseDb.collection("saved_documents").doc(docId).get();
      if (!doc.exists) return null;
      var data = doc.data();
      if (data.ownerUid !== currentUser.uid) return null;
      return Object.assign({ id: doc.id }, data);
    } catch (e) { return null; }
  }

  async function deleteDocument(docId) {
    if (!currentUser || !firebaseDb) return false;
    try {
      await firebaseDb.collection("saved_documents").doc(docId).delete();
      return true;
    } catch (e) { return false; }
  }

  async function saveClient(clientData) {
    if (!currentUser || !firebaseDb) return null;
    try {
      var ref = await firebaseDb.collection("clients").add(Object.assign({}, clientData, {
        ownerUid: currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastUsedAt: firebase.firestore.FieldValue.serverTimestamp(),
        usedIn: [currentProduct],
      }));
      return ref.id;
    } catch (e) { return null; }
  }

  async function loadClients() {
    if (!currentUser || !firebaseDb) return [];
    try {
      var snap = await firebaseDb.collection("clients")
        .where("ownerUid", "==", currentUser.uid)
        .orderBy("lastUsedAt", "desc")
        .limit(100)
        .get();
      var clients = [];
      snap.forEach(function (d) { clients.push(Object.assign({ id: d.id }, d.data())); });
      return clients;
    } catch (e) { return []; }
  }

  // ── Auth Actions ────────────────────────────────────────────

  async function signIn(email, password) {
    if (!firebaseAuth) throw new Error("Firebase not loaded");
    return firebaseAuth.signInWithEmailAndPassword(email, password);
  }

  async function signUp(email, password, displayName) {
    if (!firebaseAuth) throw new Error("Firebase not loaded");
    var cred = await firebaseAuth.createUserWithEmailAndPassword(email, password);
    if (displayName && cred.user) {
      await cred.user.updateProfile({ displayName: displayName });
    }
    return cred;
  }

  async function signOut() {
    if (!firebaseAuth) return;
    await firebaseAuth.signOut();
  }

  async function resetPassword(email) {
    if (!firebaseAuth) throw new Error("Firebase not loaded");
    return firebaseAuth.sendPasswordResetEmail(email);
  }

  // ── Inject CSS ──────────────────────────────────────────────

  var style = document.createElement("style");
  style.textContent = `
    /* Auth button in nav */
    .bea-nav-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      font-family: 'Inter', system-ui, sans-serif;
      cursor: pointer;
      transition: all 0.2s ease;
      text-decoration: none;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.06);
      color: rgba(255,255,255,0.75);
      white-space: nowrap;
    }
    .bea-nav-btn:hover {
      background: rgba(255,255,255,0.1);
      color: #fff;
      border-color: rgba(255,255,255,0.2);
    }
    .bea-avatar {
      width: 26px; height: 26px;
      border-radius: 50%;
      background: linear-gradient(135deg, #6C63FF, #3B82F6);
      display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 700; color: #fff;
      flex-shrink: 0;
    }

    /* Dropdown */
    .bea-dropdown {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      min-width: 200px;
      background: #131520;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 6px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.5);
      z-index: 200;
      display: none;
      font-family: 'Inter', system-ui, sans-serif;
    }
    .bea-dropdown.open { display: block; }
    .bea-dropdown-item {
      display: block;
      width: 100%;
      padding: 10px 14px;
      border: none;
      background: none;
      color: rgba(255,255,255,0.7);
      font-size: 13px;
      font-family: inherit;
      text-align: left;
      cursor: pointer;
      border-radius: 8px;
      transition: all 0.15s;
    }
    .bea-dropdown-item:hover {
      background: rgba(255,255,255,0.06);
      color: #fff;
    }
    .bea-dropdown-divider {
      height: 1px;
      background: rgba(255,255,255,0.08);
      margin: 4px 8px;
    }
    .bea-dropdown-email {
      padding: 10px 14px 6px;
      font-size: 11px;
      color: rgba(255,255,255,0.35);
      font-family: inherit;
    }

    /* Modal overlay */
    .bea-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(8px);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.2s ease;
      font-family: 'Inter', system-ui, sans-serif;
    }
    .bea-overlay.visible { opacity: 1; }

    /* Modal */
    .bea-modal {
      background: #131520;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 32px;
      width: 100%;
      max-width: 380px;
      box-shadow: 0 24px 80px rgba(0,0,0,0.6);
      transform: translateY(20px);
      transition: transform 0.25s ease;
    }
    .bea-overlay.visible .bea-modal { transform: translateY(0); }

    .bea-modal h2 {
      margin: 0 0 4px;
      font-size: 20px;
      font-weight: 700;
      color: #fff;
    }
    .bea-modal .bea-subtitle {
      margin: 0 0 24px;
      font-size: 13px;
      color: rgba(255,255,255,0.45);
    }

    .bea-field { margin-bottom: 16px; }
    .bea-field label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: rgba(255,255,255,0.5);
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .bea-field input {
      width: 100%;
      padding: 10px 14px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.04);
      color: #fff;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.2s;
      box-sizing: border-box;
    }
    .bea-field input:focus {
      border-color: rgba(108,99,255,0.6);
    }

    .bea-btn-primary {
      width: 100%;
      padding: 12px;
      border: none;
      border-radius: 10px;
      background: linear-gradient(135deg, #6C63FF, #3B82F6);
      color: #fff;
      font-size: 14px;
      font-weight: 700;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.2s;
      margin-top: 8px;
    }
    .bea-btn-primary:hover { filter: brightness(1.1); transform: translateY(-1px); }
    .bea-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

    .bea-link-row {
      display: flex;
      justify-content: space-between;
      margin-top: 16px;
      font-size: 12.5px;
    }
    .bea-link {
      color: rgba(108,99,255,0.8);
      cursor: pointer;
      background: none;
      border: none;
      font-size: inherit;
      font-family: inherit;
      padding: 0;
      text-decoration: none;
    }
    .bea-link:hover { color: #6C63FF; text-decoration: underline; }

    .bea-error {
      background: rgba(239,68,68,0.1);
      border: 1px solid rgba(239,68,68,0.3);
      color: #f87171;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 12.5px;
      margin-bottom: 16px;
      display: none;
    }
    .bea-error.visible { display: block; }

    .bea-success {
      background: rgba(16,185,129,0.1);
      border: 1px solid rgba(16,185,129,0.3);
      color: #34d399;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 12.5px;
      margin-bottom: 16px;
      display: none;
    }
    .bea-success.visible { display: block; }

    .bea-close-modal {
      position: absolute;
      top: 16px; right: 16px;
      background: none; border: none;
      color: rgba(255,255,255,0.3);
      font-size: 20px; cursor: pointer;
      padding: 4px 8px; border-radius: 6px;
      transition: all 0.15s;
    }
    .bea-close-modal:hover { color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.06); }

    /* Save prompt */
    .bea-save-hint {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: 8px;
      background: rgba(108,99,255,0.08);
      border: 1px solid rgba(108,99,255,0.15);
      color: rgba(108,99,255,0.8);
      font-size: 13px;
      font-family: 'Inter', system-ui, sans-serif;
      cursor: pointer;
      transition: all 0.2s;
    }
    .bea-save-hint:hover {
      background: rgba(108,99,255,0.12);
      color: #6C63FF;
    }

    @media (max-width: 640px) {
      .bea-modal { margin: 16px; padding: 24px; }
    }
  `;
  document.head.appendChild(style);

  // ── Nav UI ──────────────────────────────────────────────────

  var navContainer = null;

  function injectNavButton() {
    // Find the nav's links container — try by ID first, fall back to class
    var navLinks = document.getElementById("siteNav") ||
                   document.querySelector(".navbar-links") ||
                   document.querySelector(".nav-links");
    if (!navLinks) return;

    // Create wrapper for auth button + dropdown
    navContainer = document.createElement("div");
    navContainer.style.cssText = "position:relative;display:inline-flex;align-items:center;margin-left:auto;";
    navContainer.id = "bea-nav-container";

    // Append INSIDE the nav links container so it travels with it on mobile
    navLinks.appendChild(navContainer);

    updateNavUI();
  }

  function updateNavUI() {
    if (!navContainer) return;

    if (currentUser) {
      var initials = (currentUser.displayName || currentUser.email || "?")
        .split(" ").map(function(w) { return w[0]; }).join("").toUpperCase().slice(0, 2);

      navContainer.innerHTML =
        '<button class="bea-nav-btn" id="beaUserBtn">' +
          '<div class="bea-avatar">' + initials + '</div>' +
          '<span>' + (currentUser.displayName || "Account") + '</span>' +
        '</button>' +
        '<div class="bea-dropdown" id="beaDropdown">' +
          '<div class="bea-dropdown-email">' + (currentUser.email || "") + '</div>' +
          '<div class="bea-dropdown-divider"></div>' +
          '<button class="bea-dropdown-item" id="beaSignOut">Sign Out</button>' +
        '</div>';

      document.getElementById("beaUserBtn").addEventListener("click", function (e) {
        e.stopPropagation();
        var dd = document.getElementById("beaDropdown");
        dd.classList.toggle("open");
      });
      document.getElementById("beaSignOut").addEventListener("click", function () {
        signOut();
        document.getElementById("beaDropdown").classList.remove("open");
      });
      document.addEventListener("click", function () {
        var dd = document.getElementById("beaDropdown");
        if (dd) dd.classList.remove("open");
      });
    } else {
      navContainer.innerHTML =
        '<button class="bea-nav-btn" id="beaSignInBtn">Sign In</button>';
      document.getElementById("beaSignInBtn").addEventListener("click", function () {
        showModal("signin");
      });
    }
  }

  // ── Auth Modal ──────────────────────────────────────────────

  function showModal(mode) {
    // mode: "signin" | "signup" | "reset"
    var overlay = document.createElement("div");
    overlay.className = "bea-overlay";
    overlay.id = "beaOverlay";

    var modalHTML = '<div class="bea-modal" style="position:relative;">';
    modalHTML += '<button class="bea-close-modal" id="beaCloseModal">&times;</button>';
    modalHTML += '<div class="bea-error" id="beaError"></div>';
    modalHTML += '<div class="bea-success" id="beaSuccess"></div>';

    if (mode === "signin") {
      modalHTML += '<h2>Welcome back</h2>';
      modalHTML += '<p class="bea-subtitle">Sign in to access your saved work across Build tools.</p>';
      modalHTML += '<div class="bea-field"><label>Email</label><input type="email" id="beaEmail" autocomplete="email"></div>';
      modalHTML += '<div class="bea-field"><label>Password</label><input type="password" id="beaPassword" autocomplete="current-password"></div>';
      modalHTML += '<button class="bea-btn-primary" id="beaSubmit">Sign In</button>';
      modalHTML += '<div class="bea-link-row">';
      modalHTML += '<button class="bea-link" id="beaToSignup">Create account</button>';
      modalHTML += '<button class="bea-link" id="beaToReset">Forgot password?</button>';
      modalHTML += '</div>';
    } else if (mode === "signup") {
      modalHTML += '<h2>Create account</h2>';
      modalHTML += '<p class="bea-subtitle">Save your work and sync across Build tools. Free.</p>';
      modalHTML += '<div class="bea-field"><label>Full Name</label><input type="text" id="beaName" autocomplete="name"></div>';
      modalHTML += '<div class="bea-field"><label>Email</label><input type="email" id="beaEmail" autocomplete="email"></div>';
      modalHTML += '<div class="bea-field"><label>Password</label><input type="password" id="beaPassword" autocomplete="new-password"></div>';
      modalHTML += '<button class="bea-btn-primary" id="beaSubmit">Create Account</button>';
      modalHTML += '<div class="bea-link-row">';
      modalHTML += '<button class="bea-link" id="beaToSignin">Already have an account?</button>';
      modalHTML += '<span></span>';
      modalHTML += '</div>';
    } else if (mode === "reset") {
      modalHTML += '<h2>Reset password</h2>';
      modalHTML += '<p class="bea-subtitle">We\'ll send a reset link to your email.</p>';
      modalHTML += '<div class="bea-field"><label>Email</label><input type="email" id="beaEmail" autocomplete="email"></div>';
      modalHTML += '<button class="bea-btn-primary" id="beaSubmit">Send Reset Link</button>';
      modalHTML += '<div class="bea-link-row">';
      modalHTML += '<button class="bea-link" id="beaToSignin">Back to sign in</button>';
      modalHTML += '<span></span>';
      modalHTML += '</div>';
    }

    modalHTML += '</div>';
    overlay.innerHTML = modalHTML;
    document.body.appendChild(overlay);

    // Animate in
    requestAnimationFrame(function () { overlay.classList.add("visible"); });

    // Focus first input
    setTimeout(function () {
      var firstInput = overlay.querySelector("input");
      if (firstInput) firstInput.focus();
    }, 100);

    // Close handlers
    document.getElementById("beaCloseModal").addEventListener("click", closeModal);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal();
    });

    // Submit
    document.getElementById("beaSubmit").addEventListener("click", function () {
      handleSubmit(mode);
    });

    // Enter key on inputs
    overlay.querySelectorAll("input").forEach(function (input) {
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") handleSubmit(mode);
      });
    });

    // Mode switches
    var toSignup = document.getElementById("beaToSignup");
    var toSignin = document.getElementById("beaToSignin");
    var toReset = document.getElementById("beaToReset");
    if (toSignup) toSignup.addEventListener("click", function () { closeModal(); showModal("signup"); });
    if (toSignin) toSignin.addEventListener("click", function () { closeModal(); showModal("signin"); });
    if (toReset) toReset.addEventListener("click", function () { closeModal(); showModal("reset"); });
  }

  function closeModal() {
    var overlay = document.getElementById("beaOverlay");
    if (!overlay) return;
    overlay.classList.remove("visible");
    setTimeout(function () { overlay.remove(); }, 200);
  }

  async function handleSubmit(mode) {
    var btn = document.getElementById("beaSubmit");
    var errEl = document.getElementById("beaError");
    var successEl = document.getElementById("beaSuccess");
    var email = (document.getElementById("beaEmail") || {}).value || "";
    var password = (document.getElementById("beaPassword") || {}).value || "";
    var name = (document.getElementById("beaName") || {}).value || "";

    errEl.classList.remove("visible");
    successEl.classList.remove("visible");
    btn.disabled = true;
    btn.textContent = "Loading...";

    try {
      if (mode === "signin") {
        await signIn(email, password);
        closeModal();
      } else if (mode === "signup") {
        await signUp(email, password, name);
        closeModal();
      } else if (mode === "reset") {
        await resetPassword(email);
        successEl.textContent = "Reset link sent! Check your inbox.";
        successEl.classList.add("visible");
        btn.textContent = "Sent ✓";
        return;
      }
    } catch (err) {
      var msg = err.message || "Something went wrong.";
      // Clean up Firebase error messages
      msg = msg.replace("Firebase: ", "").replace(/\(auth\/.*\)\.?/, "").trim();
      if (!msg) msg = "Invalid email or password.";
      errEl.textContent = msg;
      errEl.classList.add("visible");
      btn.disabled = false;
      btn.textContent = mode === "signin" ? "Sign In" : mode === "signup" ? "Create Account" : "Send Reset Link";
    }
  }

  // ── Public API ──────────────────────────────────────────────

  window.BuildAuth = {
    // State
    getUser: function () { return currentUser; },
    isReady: function () { return sdkReady; },

    // Auth actions
    showModal: function (mode) { showModal(mode || "signin"); },
    showSignIn: function () { showModal("signin"); },
    showSignUp: function () { showModal("signup"); },
    signOut: signOut,

    // Listeners
    onAuthChange: function (fn) {
      authListeners.push(fn);
      // Fire immediately with current state if SDK is ready
      if (sdkReady) fn(currentUser);
    },

    // Document storage
    saveDocument: saveDocument,
    loadDocuments: loadDocuments,
    getDocument: getDocument,
    deleteDocument: deleteDocument,

    // Client storage
    saveClient: saveClient,
    loadClients: loadClients,

    // Product info
    currentProduct: currentProduct,

    // Database access (for product-specific queries)
    getDb: function () { return firebaseDb; },
  };

  // ── Initialize ──────────────────────────────────────────────

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      injectNavButton();
      initFirebase();
      initBridge();
    });
  } else {
    injectNavButton();
    initFirebase();
    initBridge();
  }
})();
