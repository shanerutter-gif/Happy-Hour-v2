/* consent.js — first-party analytics consent gate (GDPR / opt-in).
 * Loaded on every page (app + public site) BEFORE js/db.js / js/site-analytics.js.
 *
 * Sets window.__spotdConsent to 'granted' | 'denied' | 'pending' and persists an
 * explicit choice in localStorage ('spotd_consent'). The analytics layers check
 * this at flush time and only send when granted; they listen for the
 * 'spotd:consent' event to flush held events the moment the visitor accepts.
 *
 * Rules:
 *  - Native app shell  → 'pending' (no implied grant — the choice is surfaced
 *                        via the post-signup interstitial and the in-app
 *                        settings entry; consent is never assumed).
 *  - Do-Not-Track on   → 'denied'  (respect the signal, no banner).
 *  - Prior choice       → reuse it, no banner. An explicit 'denied' is never
 *                        re-prompted automatically.
 *  - 'Not now'          → a real third option: suppress for the rest of the
 *                        session, re-ask in a later session or after 7 days.
 *                        Never overrides an explicit 'denied'.
 *  - Otherwise          → 'pending' + delayed banner; nothing identified is
 *                        sent until an explicit choice. The banner appears on
 *                        the second pageview, after ~30s of engaged reading,
 *                        or immediately after signup — never on first paint.
 *
 * The banner offers Accept / Decline / Not now as three visually identical,
 * equally easy choices (no pre-selection, no dark patterns). Withdrawing or
 * changing consent is as easy as giving it: site footers and the app's
 * settings sheet get a "Cookie settings" entry that reopens the chooser
 * without altering the stored choice.
 *
 * Public API:
 *  - window.spotdShowConsent() — reopen the chooser (e.g. from "Cookie
 *    settings"). Never changes the stored choice by itself; the choice only
 *    changes when the visitor explicitly picks Accept or Decline.
 *  - window.spotdShowPostSignupConsent() — dedicated Accept/Decline
 *    interstitial shown immediately after signup. Never shown after an
 *    explicit Decline.
 *
 * ANONYMOUS PAGE-VIEW PING: identity-stitched tracking stays behind the Accept
 * button, but raw traffic counts were losing every visitor who bounced without
 * touching the banner (most SEO traffic — the GSC-vs-dashboard gap). So this
 * file also sends ONE cookieless, identifier-free page_view ping (no
 * localStorage, no cookies, nothing persistent — the server derives a
 * daily-rotating irreversible hash for aggregate counts, Plausible-style)
 * whenever the full tracker won't record the view: consent pending/denied, or
 * the tracker script was killed by a content blocker. Sent to /api/vibe (an
 * innocuous alias of /api/track-event that filter lists don't match).
 */
(function () {
  'use strict';

  function get() { try { return localStorage.getItem('spotd_consent'); } catch (e) { return null; } }

  // ── anonymous cookieless page-view ping ──
  function isBot() {
    try {
      if (navigator.webdriver) return true;
      return /bot|crawl|spider|slurp|mediapartners|googlebot|bingpreview|adsbot|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|facebookexternalhit|embedly|quora|whatsapp|telegram|slackbot|discordbot|preview|scrapy|python-requests|axios|curl|wget|phantomjs/i.test(navigator.userAgent || '');
    } catch (e) { return false; }
  }
  function deviceOf() {
    try {
      var ua = navigator.userAgent || '';
      if (/iPad|Tablet|PlayBook|Silk/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) return 'tablet';
      if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|IEMobile/.test(ua)) return 'mobile';
      return 'desktop';
    } catch (e) { return 'unknown'; }
  }
  function anonSend(events) {
    try {
      fetch('/api/vibe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anon: true, platform: 'web', device: deviceOf(), events: events }),
        keepalive: true,
      }).catch(function () {});
    } catch (e) {}
  }
  var pinged = false;
  function sendPing() {
    if (pinged || isBot()) return;
    pinged = true;
    window.__spotdAnonPinged = true; // trackers drop their held page_view on a later Accept
    try {
      var props = { title: (document.title || '').slice(0, 120) };
      try { if (document.referrer) props.referrer = document.referrer.slice(0, 300); } catch (e) {}
      try {
        var p = new URLSearchParams(location.search);
        ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (k) {
          var v = p.get(k); if (v) props[k] = String(v).slice(0, 80);
        });
      } catch (e) {}
      anonSend([{ n: 'page_view', p: props, path: location.pathname, t: Date.now() }]);
    } catch (e) {}
  }

  // ── anonymous click capture (outbound / CTA / app-store) ──
  // Mirrors the tracker's click listener so anonymous journeys get click steps
  // too. Double-count safety: while consent is PENDING the full tracker buffers
  // the same clicks (it sends them if the visitor later accepts), so anonymous
  // clicks are only sent when the tracker definitively won't send its copies —
  // consent denied, tracker script blocked, or the page ends still-pending.
  var clickBuf = [];
  function flushClicks(atExit) {
    if (!clickBuf.length) return;
    var st = window.__spotdConsent;
    if (st === 'granted') {
      if (window.__spotdPV) { clickBuf = []; return; } // alive tracker owns the clicks
      // tracker blocked → fall through and send anonymously
    } else if (st === 'pending' && !atExit) {
      if (clickBuf.length > 30) clickBuf = clickBuf.slice(-30);
      return; // visitor may still Accept — hold until the page ends unresolved
    }
    var batch = clickBuf.slice(0, 10); clickBuf = [];
    anonSend(batch);
  }
  function armClickCapture() {
    if (isBot()) return;
    try {
      document.addEventListener('click', function (e) {
        try {
          var el = e.target && e.target.closest && e.target.closest('a[href], [data-track]');
          if (!el) return;
          var dt = el.getAttribute && el.getAttribute('data-track');
          var href = el.getAttribute && el.getAttribute('href');
          var ev = null;
          if (dt) ev = { n: 'cta_click', p: { label: String(dt).slice(0, 60) } };
          else if (href && href.charAt(0) !== '#' && !/^(javascript|mailto|tel):/i.test(href)) {
            if (/apps\.apple\.com|play\.google\.com/i.test(href)) ev = { n: 'app_store_click', p: { href: href.slice(0, 200) } };
            else if (/^https?:\/\//i.test(href) && href.indexOf(location.host) === -1) ev = { n: 'outbound_click', p: { href: href.slice(0, 200) } };
          }
          if (!ev) return;
          ev.path = location.pathname; ev.t = Date.now();
          clickBuf.push(ev);
          flushClicks(false); // sends promptly when denied / tracker-blocked; holds while pending
        } catch (err) {}
      }, true);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') flushClicks(true);
      });
      window.addEventListener('pagehide', function () { flushClicks(true); });
      document.addEventListener('spotd:consent', function () {
        if (window.__spotdConsent === 'granted' && window.__spotdPV) clickBuf = []; // tracker takes over
        else if (window.__spotdConsent === 'denied') flushClicks(true); // tracker just dropped its copies
      });
    } catch (e) {}
  }
  // For granted visitors the full tracker records the view — unless a content
  // blocker killed the tracker script. Trackers set window.__spotdPV when they
  // capture their landing page_view; if that never happens, ping anonymously.
  function pingIfTrackerBlocked() { if (!window.__spotdPV) sendPing(); }
  function armBlockedTrackerFallback() {
    try {
      setTimeout(pingIfTrackerBlocked, 3000);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') pingIfTrackerBlocked();
      });
      window.addEventListener('pagehide', pingIfTrackerBlocked);
    } catch (e) {}
  }
  function setState(v) {
    window.__spotdConsent = v;
    try { if (v === 'granted' || v === 'denied') localStorage.setItem('spotd_consent', v); } catch (e) {}
    try { document.dispatchEvent(new Event('spotd:consent')); } catch (e) {}
  }

  // ── consent UI styles (injected once) ──
  // Accept / Decline / Not now share one identical button style: same size,
  // same weight, 44px minimum target — equally easy, no dark patterns.
  var CSS_INJECTED = false;
  function ensureConsentCSS() {
    if (CSS_INJECTED) return;
    try {
      if (document.getElementById('spotd-consent-css')) { CSS_INJECTED = true; return; }
      var st = document.createElement('style');
      st.id = 'spotd-consent-css';
      st.textContent = [
        '#spotd-consent{position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;max-width:560px;margin:0 auto;background:#1c1611;color:#F7F1EA;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.35);padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.5;transform:translateY(24px);opacity:0;transition:transform .35s cubic-bezier(.16,1,.3,1),opacity .3s ease}',
        '#spotd-consent.spc-in{transform:translateY(0);opacity:1}',
        '.spc-text{margin-bottom:12px}',
        '.spc-text a{color:#FF6B4A;text-decoration:underline}',
        '.spc-status{font-size:12px;opacity:.7;margin-bottom:6px}',
        '.spc-btns{display:flex;gap:8px;flex-wrap:wrap}',
        '.spc-btn{flex:1 1 0;min-width:110px;min-height:44px;padding:12px 16px;border-radius:999px;border:1px solid rgba(247,241,234,.4);background:rgba(247,241,234,.1);color:#F7F1EA;font-weight:600;font-size:14px;line-height:1.2;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent}',
        '.spc-btn:hover{background:rgba(247,241,234,.18)}',
        '.spc-btn:active{transform:scale(.97)}',
        '.spc-btn:focus-visible{outline:2px solid #FF6B4A;outline-offset:2px}',
        '#spotd-consent-modal{position:fixed;inset:0;z-index:2147483001;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(20,14,10,.62)}',
        '.spc-modal-card{width:100%;max-width:440px;background:#1c1611;color:#F7F1EA;border-radius:18px;padding:24px 20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.5)}',
        '.spc-modal-title{font-size:20px;line-height:1.25;margin:0 0 10px;font-weight:800}',
        '.spc-modal-text{font-size:14px;line-height:1.55;margin:0 0 18px;opacity:.92}',
        '@media (prefers-reduced-motion:reduce){#spotd-consent{transition:none;transform:none;opacity:1}}'
      ].join('\n');
    (document.head || document.documentElement).appendChild(st);
      CSS_INJECTED = true;
    } catch (e) {}
  }

  // ── delayed, engagement-aware ask ──
  var SNOOZE_KEY = 'spotd_consent_snooze_until';
  var ASKED_KEY = 'spotd_consent_asked'; // sessionStorage: asked/deferred this session
  var PV_KEY = 'spotd_consent_pv';
  var ENGAGE_MS = 30000;
  var bannerTimer = null;
  var bannerShown = false;
  var busyRetries = 0;

  function snoozed() {
    try { return parseInt(localStorage.getItem(SNOOZE_KEY) || '0', 10) > Date.now(); }
    catch (e) { return false; }
  }
  function sessionAsked() {
    try { return sessionStorage.getItem(ASKED_KEY) === '1'; } catch (e) { return false; }
  }
  // Don't pop the banner over onboarding or the auth sheet — the post-signup
  // interstitial covers new users instead.
  function uiBusy() {
    try {
      var ob = document.getElementById('onboardingOverlay');
      if (ob && ob.style.display !== 'none') return true;
      var ao = document.getElementById('authOverlay');
      if (ao && ao.style.display !== 'none') return true;
    } catch (e) {}
    return false;
  }

  var engaged = false;
  function markEngaged() { engaged = true; }

  function scheduleBanner() {
    var pv = 1;
    try {
      pv = (parseInt(localStorage.getItem(PV_KEY) || '0', 10) || 0) + 1;
      localStorage.setItem(PV_KEY, String(pv));
    } catch (e) {}
    if (sessionAsked()) return;
    try {
      ['scroll', 'click', 'keydown', 'touchstart'].forEach(function (ev) {
        window.addEventListener(ev, markEngaged, { passive: true });
      });
    } catch (e) {}
    if (pv >= 2) {
      bannerTimer = setTimeout(maybeShowBanner, 1500);
    } else {
      // ~30s of visible, engaged reading before the first ask.
      var last = Date.now(), visibleMs = 0;
      bannerTimer = setInterval(function () {
        var now = Date.now();
        try { if (!document.hidden) visibleMs += (now - last); } catch (e) {}
        last = now;
        if (visibleMs >= ENGAGE_MS && engaged) {
          try { clearInterval(bannerTimer); } catch (e) {}
          bannerTimer = null;
          maybeShowBanner();
        }
      }, 1000);
    }
  }

  function maybeShowBanner() {
    if (bannerShown) return;
    if (window.__spotdConsent !== 'pending') return;
    if (isNative) return; // native surfaces the choice via post-signup + settings
    if (document.getElementById('spotd-consent') || document.getElementById('spotd-consent-modal')) return;
    if (uiBusy()) {
      if (busyRetries < 20) { busyRetries++; setTimeout(maybeShowBanner, 15000); }
      return;
    }
    bannerShown = true;
    try { sessionStorage.setItem(ASKED_KEY, '1'); } catch (e) {}
    renderBanner(false);
  }

  function renderBanner(fromSettings) {
    if (document.getElementById('spotd-consent')) return;
    ensureConsentCSS();
    var bar = document.createElement('div');
    bar.id = 'spotd-consent';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Analytics consent');
    var status = '';
    if (fromSettings) {
      var cur = 'Not set';
      try {
        var v = localStorage.getItem('spotd_consent');
        cur = v === 'granted' ? 'On' : (v === 'denied' ? 'Off' : 'Not set');
      } catch (e) {}
      status = '<div class="spc-status">Current setting: <strong>' + cur + '</strong></div>';
    }
    bar.innerHTML =
      '<div class="spc-text">' + status +
      'We use first-party analytics to understand how Spotd is used and make it better. ' +
      '<a href="/privacy.html">Privacy Policy</a>.</div>' +
      '<div class="spc-btns">' +
        '<button type="button" class="spc-btn" id="spotd-consent-no">Decline</button>' +
        '<button type="button" class="spc-btn" id="spotd-consent-later">Not now</button>' +
        '<button type="button" class="spc-btn" id="spotd-consent-yes">Accept</button>' +
      '</div>';
    (document.body || document.documentElement).appendChild(bar);
    try {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { bar.classList.add('spc-in'); });
      });
    } catch (e) { try { bar.classList.add('spc-in'); } catch (e2) {} }
    function close() {
      try { bar.classList.remove('spc-in'); } catch (e) {}
      setTimeout(function () { try { bar.remove(); } catch (e) { bar.style.display = 'none'; } }, 300);
      try { document.dispatchEvent(new Event('spotd:consent-dismissed')); } catch (e) {}
    }
    document.getElementById('spotd-consent-yes').addEventListener('click', function () { setState('granted'); close(); });
    document.getElementById('spotd-consent-no').addEventListener('click', function () { setState('denied'); close(); });
    document.getElementById('spotd-consent-later').addEventListener('click', function () {
      try {
        localStorage.setItem(SNOOZE_KEY, String(Date.now() + 7 * 24 * 60 * 60 * 1000));
        sessionStorage.setItem(ASKED_KEY, '1');
      } catch (e) {}
      close();
    });
  }

  // ── public API ──
  // Reopen the chooser WITHOUT altering the stored choice — it only changes
  // when the visitor explicitly picks Accept or Decline.
  window.spotdShowConsent = function () {
    if (document.getElementById('spotd-consent') || document.getElementById('spotd-consent-modal')) return;
    renderBanner(true);
  };

  // Dedicated post-signup interstitial: Accept and Decline only, equally
  // prominent, nothing pre-selected. Never shown after an explicit Decline.
  window.spotdShowPostSignupConsent = function () {
    try {
      if (localStorage.getItem('spotd_consent') === 'denied') return; // explicit decline wins
      if (localStorage.getItem('spotd_consent') === 'granted') return;
      if (sessionStorage.getItem('spotd_postsignup_shown')) return;
      if (document.getElementById('spotd-consent-modal') || document.getElementById('spotd-consent')) return;
    } catch (e) {}
    try {
      sessionStorage.setItem('spotd_postsignup_shown', '1');
      sessionStorage.setItem(ASKED_KEY, '1');
    } catch (e) {}
    try { if (bannerTimer) { clearTimeout(bannerTimer); clearInterval(bannerTimer); } } catch (e) {}
    bannerTimer = null;
    bannerShown = true;
    ensureConsentCSS();
    var ov = document.createElement('div');
    ov.id = 'spotd-consent-modal';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Analytics consent');
    ov.innerHTML =
      '<div class="spc-modal-card">' +
        '<h2 class="spc-modal-title">One quick privacy choice</h2>' +
        '<p class="spc-modal-text">May we use first-party analytics to understand how Spotd is used and make it better? No third-party trackers, and you can change your mind anytime in Settings.</p>' +
        '<div class="spc-btns">' +
          '<button type="button" class="spc-btn" id="spotd-ps-no">Decline</button>' +
          '<button type="button" class="spc-btn" id="spotd-ps-yes">Accept</button>' +
        '</div>' +
      '</div>';
    (document.body || document.documentElement).appendChild(ov);
    function close() {
      try { ov.remove(); } catch (e) { ov.style.display = 'none'; }
      try { document.dispatchEvent(new Event('spotd:consent-dismissed')); } catch (e) {}
    }
    document.getElementById('spotd-ps-yes').addEventListener('click', function () { setState('granted'); close(); });
    document.getElementById('spotd-ps-no').addEventListener('click', function () { setState('denied'); close(); });
  };

  // ── "Cookie settings" entries ──
  function openSettings(e) {
    if (e) { try { e.preventDefault(); } catch (err) {} }
    try { window.spotdShowConsent(); } catch (err) {}
  }

  // Static page footers: add a "Cookie settings" link next to the Privacy link.
  function injectFooterLinks() {
    try {
      var footers = document.querySelectorAll('footer');
      for (var i = 0; i < footers.length; i++) {
        var f = footers[i];
        if (f.querySelector('[data-spotd-cookie-settings]')) continue;
        var priv = f.querySelector('a[href*="privacy"]');
        if (!priv || !priv.parentNode) continue;
        var sep = document.createElement('span');
        sep.textContent = ' · ';
        sep.setAttribute('aria-hidden', 'true');
        var link = document.createElement('a');
        link.href = '#';
        link.setAttribute('data-spotd-cookie-settings', '1');
        link.textContent = 'Cookie settings';
        link.addEventListener('click', openSettings);
        priv.parentNode.insertBefore(sep, priv.nextSibling);
        priv.parentNode.insertBefore(link, sep.nextSibling);
      }
    } catch (e) {}
  }

  // In-app settings sheet (rendered dynamically by js/app.js): it ends with a
  // centered Privacy · Terms footer — append a "Cookie settings" link there so
  // withdrawing/changing consent is as easy as giving it.
  function injectAppSettingsLink() {
    try {
      var links = document.querySelectorAll('a[onclick*="openLegalPage"]');
      for (var i = 0; i < links.length; i++) {
        var a = links[i];
        if (a.__spotdCookieDone) continue;
        var oc = a.getAttribute('onclick') || '';
        if (oc.indexOf("'terms'") === -1) continue;
        var parent = a.parentNode;
        if (!parent) continue;
        var st = parent.getAttribute('style') || '';
        if (st.indexOf('text-align:center') === -1) continue;
        if (parent.querySelector('[data-spotd-cookie-settings]')) { a.__spotdCookieDone = true; continue; }
        a.__spotdCookieDone = true;
        var sep = document.createElement('span');
        sep.setAttribute('style', 'color:var(--muted);font-size:12px');
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = ' · ';
        var link = document.createElement('a');
        link.href = '#';
        link.setAttribute('data-spotd-cookie-settings', '1');
        link.setAttribute('style', 'font-size:12px;color:var(--muted)');
        link.textContent = 'Cookie settings';
        link.addEventListener('click', openSettings);
        parent.appendChild(sep);
        parent.appendChild(link);
      }
    } catch (e) {}
  }

  function injectSettingsEntries() { injectFooterLinks(); injectAppSettingsLink(); }

  // ── post-signup trigger ──
  // A *signup* (not a sign-in or session restore) is detected two ways:
  //  - openAuth('signup', …) was called → explicit signup intent (session flag)
  //  - spotd-ob-pending was set at page load → onboarding OAuth signup flow
  // When a fresh Supabase auth token appears, show the dedicated interstitial.
  function hasAuthToken() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('sb-') === 0 && k.indexOf('-auth-token') !== -1) return true;
      }
    } catch (e) {}
    return false;
  }

  function armSignupHook() {
    if (typeof window.openAuth === 'function' && !window.openAuth.__spotdWrapped) {
      var origOpen = window.openAuth;
      window.openAuth = function (mode, ctx) {
        try { if (mode === 'signup') sessionStorage.setItem('spotd-signup-intent', '1'); } catch (e) {}
        return origOpen.apply(this, arguments);
      };
      window.openAuth.__spotdWrapped = true;
    } else if (typeof window.openAuth !== 'function') {
      setTimeout(armSignupHook, 300);
    }
  }

  var hadTokenAtLoad = hasAuthToken();
  var obPendingAtLoad = false;
  try { obPendingAtLoad = localStorage.getItem('spotd-ob-pending') === '1'; } catch (e) {}

  function armFreshAuthPoll() {
    var ticks = 0;
    var poll = setInterval(function () {
      ticks++;
      if (ticks > 300) { clearInterval(poll); return; } // ~5 minutes
      if (hadTokenAtLoad || !hasAuthToken()) return;
      hadTokenAtLoad = true;
      clearInterval(poll);
      var intent = false;
      try {
        intent = sessionStorage.getItem('spotd-signup-intent') === '1';
        sessionStorage.removeItem('spotd-signup-intent');
      } catch (e) {}
      if (intent || obPendingAtLoad) {
        setTimeout(function () { try { window.spotdShowPostSignupConsent(); } catch (e) {} }, 800);
      }
    }, 1000);
  }

  function bootExtras() {
    injectSettingsEntries();
    try {
      if (window.MutationObserver && document.documentElement) {
        new MutationObserver(function () { injectSettingsEntries(); })
          .observe(document.documentElement, { childList: true, subtree: true });
      }
    } catch (e) {}
    armSignupHook();
    armFreshAuthPoll();
  }

  // Native app shell — no implied grant. Native stays 'pending': the choice is
  // surfaced via the post-signup interstitial and the in-app settings entry.
  // The anonymous aggregate ping below still counts the visit.
  var isNative = false;
  try {
    isNative = !!(window.spotdNative ||
      (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ||
      location.protocol === 'capacitor:');
  } catch (e) {}

  // Settings entries + signup hooks run on every path — withdrawing/changing
  // consent must stay available no matter the current state.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootExtras);
  else bootExtras();

  // Every web path gets the anonymous click listener; flushClicks() decides
  // per-state whether its events are actually sent (see comment above).
  armClickCapture();

  // Do-Not-Track → treat as a decline, no banner. Still counted in the
  // anonymous aggregate (no identifiers, nothing stored — not tracking).
  try {
    if (navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.msDoNotTrack === '1') {
      window.__spotdConsent = 'denied'; sendPing(); return;
    }
  } catch (e) {}

  var prior = get();
  if (prior === 'granted') { window.__spotdConsent = 'granted'; armBlockedTrackerFallback(); return; }
  if (prior === 'denied')  { window.__spotdConsent = 'denied';  sendPing(); return; }

  // Undecided — hold identified sending and count the view anonymously right
  // away (bouncing visitors never touch the banner; this is the view GSC
  // counts but the consent-gated tracker was silently losing). The banner
  // itself is delayed: second pageview, ~30s of engaged reading, or right
  // after signup — never on first paint.
  window.__spotdConsent = 'pending';
  sendPing();

  if (!isNative && !snoozed()) {
    if (document.body) scheduleBanner();
    else document.addEventListener('DOMContentLoaded', scheduleBanner);
  }
})();
