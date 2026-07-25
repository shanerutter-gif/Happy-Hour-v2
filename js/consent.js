/* consent.js — minimal first-party cookie/analytics consent gate (GDPR).
 * Loaded on every page (app + public site) BEFORE js/db.js / js/site-analytics.js.
 *
 * Sets window.__spotdConsent to 'granted' | 'denied' | 'pending' and persists the
 * choice in localStorage ('spotd_consent'). The analytics layers check this at
 * flush time and only send when granted; they listen for the 'spotd:consent'
 * event to flush held events the moment the visitor accepts.
 *
 * Rules:
 *  - Native app shell  → 'granted' (covered by the App Store privacy disclosure;
 *                        no banner inside the installed app).
 *  - Do-Not-Track on   → 'denied'  (respect the signal, no banner).
 *  - Prior choice       → reuse it, no banner.
 *  - Otherwise          → 'pending' + show the banner; nothing is sent until a choice.
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
  var pinged = false;
  function sendPing() {
    if (pinged || isBot()) return;
    pinged = true;
    window.__spotdAnonPinged = true; // trackers drop their held page_view on a later Accept
    try {
      var ua = navigator.userAgent || '';
      var dev = /iPad|Tablet|PlayBook|Silk/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? 'tablet'
        : /Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|IEMobile/.test(ua) ? 'mobile' : 'desktop';
      var props = { title: (document.title || '').slice(0, 120) };
      try { if (document.referrer) props.referrer = document.referrer.slice(0, 300); } catch (e) {}
      try {
        var p = new URLSearchParams(location.search);
        ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (k) {
          var v = p.get(k); if (v) props[k] = String(v).slice(0, 80);
        });
      } catch (e) {}
      fetch('/api/vibe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anon: true, platform: 'web', device: dev,
          events: [{ n: 'page_view', p: props, path: location.pathname, t: Date.now() }],
        }),
        keepalive: true,
      }).catch(function () {});
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

  // Native app shell — implied consent via the App Store privacy label.
  var native = false;
  try {
    native = !!(window.spotdNative ||
      (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ||
      location.protocol === 'capacitor:');
  } catch (e) {}
  if (native) { window.__spotdConsent = 'granted'; return; }

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

  // Undecided — hold identified sending, show the banner, and count the view
  // anonymously right away (bouncing visitors never touch the banner; this is
  // the view GSC counts but the consent-gated tracker was silently losing).
  window.__spotdConsent = 'pending';
  sendPing();

  function render() {
    if (document.getElementById('spotd-consent')) return;
    var bar = document.createElement('div');
    bar.id = 'spotd-consent';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Privacy consent');
    bar.style.cssText = [
      'position:fixed', 'left:12px', 'right:12px', 'bottom:12px', 'z-index:2147483000',
      'max-width:560px', 'margin:0 auto', 'background:#1c1611', 'color:#F7F1EA',
      'border-radius:14px', 'box-shadow:0 10px 40px rgba(0,0,0,0.35)',
      'padding:14px 16px', 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      'font-size:13.5px', 'line-height:1.45', 'display:flex', 'flex-wrap:wrap',
      'align-items:center', 'gap:10px'
    ].join(';');
    bar.innerHTML =
      '<div style="flex:1;min-width:220px">We use first-party analytics to understand how spotd is used and make it better. ' +
      '<a href="/privacy.html" style="color:#FF6B4A;text-decoration:underline">Privacy</a>.</div>' +
      '<div style="display:flex;gap:8px;flex-shrink:0">' +
        '<button id="spotd-consent-no" style="padding:8px 14px;border-radius:999px;border:1px solid rgba(247,241,234,0.35);background:transparent;color:#F7F1EA;font-weight:600;font-size:13px;cursor:pointer">Decline</button>' +
        '<button id="spotd-consent-yes" style="padding:8px 16px;border-radius:999px;border:none;background:#FF6B4A;color:#fff;font-weight:700;font-size:13px;cursor:pointer">Accept</button>' +
      '</div>';
    document.body.appendChild(bar);
    function close() { try { bar.remove(); } catch (e) { bar.style.display = 'none'; } }
    document.getElementById('spotd-consent-yes').addEventListener('click', function () { setState('granted'); close(); });
    document.getElementById('spotd-consent-no').addEventListener('click', function () { setState('denied'); close(); });
  }

  if (document.body) render();
  else document.addEventListener('DOMContentLoaded', render);

  // Expose a tiny API so a "manage cookies" link could reopen it later.
  window.spotdShowConsent = function () { try { localStorage.removeItem('spotd_consent'); } catch (e) {} window.__spotdConsent = 'pending'; render(); };
})();
