/* site-analytics.js — lightweight first-party telemetry for the PUBLIC SITE
 * (SSR venue/city pages, the /spots directory, static blog posts, and the
 * marketing/legal pages). These pages do NOT load js/db.js, so this is their
 * only path into our own analytics backend (/api/track-event → analytics_events).
 *
 * It is deliberately tiny, dependency-free, and defensive: every path is wrapped
 * so it can never break a page or hurt SEO. It shares the SAME visitor/session
 * ids as the app (js/db.js) so a visitor's pre-signup journey across the SEO
 * pages and the app stitches into one timeline.
 *
 * Captures: page_view (with referrer + UTM + device), outbound link clicks, and
 * CTA clicks (anything with [data-track] or an "open in app"/app-store link).
 * Bots are skipped client-side (and again server-side in /api/track-event).
 */
(function () {
  'use strict';

  // Shared id keys — MUST match js/db.js so the journey is one identity.
  var VID_KEY = 'spotd_vid';      // persistent visitor id (localStorage)
  var SID_KEY = 'spotd_ae_sid';   // per-tab session id (sessionStorage)
  var ENDPOINT = '/api/track-event';

  function isBot() {
    try {
      if (navigator.webdriver) return true;
      return /bot|crawl|spider|slurp|mediapartners|googlebot|bingpreview|adsbot|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|facebookexternalhit|embedly|quora|whatsapp|telegram|slackbot|discordbot|preview|scrapy|python-requests|axios|curl|wget|phantomjs/i.test(navigator.userAgent || '');
    } catch (e) { return false; }
  }
  // Respect Do-Not-Track as a basic privacy signal. (A full cookie-consent
  // banner is the recommended next step before this is GDPR-complete.)
  function consentOk() {
    try { return navigator.doNotTrack !== '1' && window.doNotTrack !== '1'; } catch (e) { return true; }
  }
  if (isBot() || !consentOk()) return;

  function uuid() {
    try { if (self.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'v_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  }
  function visitorId() {
    try {
      var v = localStorage.getItem(VID_KEY);
      if (!v) { v = uuid(); localStorage.setItem(VID_KEY, v); }
      return v;
    } catch (e) { return null; }
  }
  function sessionId() {
    try {
      var s = sessionStorage.getItem(SID_KEY);
      if (!s) { s = uuid(); sessionStorage.setItem(SID_KEY, s); }
      return s;
    } catch (e) { return null; }
  }
  function device() {
    try {
      var ua = navigator.userAgent || '';
      if (/iPad|Tablet|PlayBook|Silk/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) return 'tablet';
      if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|IEMobile/.test(ua)) return 'mobile';
      return 'desktop';
    } catch (e) { return 'unknown'; }
  }
  function utm() {
    var o = {};
    try {
      var p = new URLSearchParams(location.search);
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (k) {
        var v = p.get(k); if (v) o[k] = String(v).slice(0, 80);
      });
    } catch (e) {}
    return o;
  }

  var buffer = [], timer = null;
  var DEV = device();

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!buffer.length) return;
    var batch = buffer; buffer = [];
    var payload;
    try {
      payload = JSON.stringify({
        session_id: sessionId(),
        visitor_id: visitorId(),
        platform: 'web',
        device: DEV,
        events: batch,
      });
    } catch (e) { return; }
    try {
      fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(function () {});
    } catch (e) {}
  }

  function cap(name, props) {
    if (!name) return;
    try {
      buffer.push({ n: String(name).slice(0, 60), p: props || {}, path: location.pathname, t: Date.now() });
      if (buffer.length >= 15) { flush(); return; }
      if (!timer) timer = setTimeout(flush, 6000);
    } catch (e) {}
  }

  // ── page_view ──
  var pvProps = { device: DEV, title: (document.title || '').slice(0, 120) };
  try { if (document.referrer) pvProps.referrer = document.referrer.slice(0, 300); } catch (e) {}
  var u = utm();
  for (var k in u) pvProps[k] = u[k];
  cap('page_view', pvProps);

  // ── click capture (outbound + CTAs) ──
  document.addEventListener('click', function (e) {
    try {
      var el = e.target && e.target.closest && e.target.closest('a[href], [data-track]');
      if (!el) return;
      var dt = el.getAttribute && el.getAttribute('data-track');
      var href = el.getAttribute && el.getAttribute('href');
      if (dt) { cap('cta_click', { label: String(dt).slice(0, 60), path: location.pathname }); return; }
      if (!href || href.charAt(0) === '#' || /^(javascript|mailto|tel):/i.test(href)) return;
      var isAppStore = /apps\.apple\.com|play\.google\.com/i.test(href);
      var isOutbound = /^https?:\/\//i.test(href) && href.indexOf(location.host) === -1;
      if (isAppStore) cap('app_store_click', { href: href.slice(0, 200) });
      else if (isOutbound) cap('outbound_click', { href: href.slice(0, 200) });
    } catch (err) {}
  }, true);

  // Flush trailing events when the page is hidden / navigated away.
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
})();
