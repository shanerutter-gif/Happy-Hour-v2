/* Venue impressions — how many people saw each listing (app + website).
 *
 * Any element carrying data-vid="<venue uuid>" counts as an impression once it
 * has been at least half on screen for 1 second (IAB-style viewability).
 * Each venue is counted once per page load per source. A detail view (venue
 * modal in the app, /spots/<slug> page on the site) is a separate event.
 *
 * Sent as cookieless anonymous pings to /api/vibe (same path as consent.js's
 * anonymous page-view count): no client ids, no storage. The server derives a
 * daily-rotating visitor hash, so per-venue "unique viewers" works for every
 * visitor without tracking anyone. Aggregate counts only — the same model as
 * the anonymous page_view baseline. Internal browsers (?internal=1) and bots
 * send nothing.
 *
 * API:
 *   window.spotdImpScan(root?)   re-observe every [data-vid] (call after a render)
 *   window.spotdImpView(id, src) record a detail view of venue `id`
 * A page can set <body data-venue-view="<uuid>"> to record a detail view on load.
 */
(function () {
  if (window.spotdImpScan) return;
  var DWELL_MS = 1000, FLUSH_MS = 10000, MAX_IDS = 40;

  function blocked() {
    try {
      if (window.__spotdInternal || localStorage.getItem('spotd_internal') === '1') return true;
    } catch (e) {}
    try {
      if (navigator.webdriver) return true;
      return /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|gtmetrix|pingdom|preview|scrapy|python-requests|axios|curl|wget|phantomjs/i.test(navigator.userAgent || '');
    } catch (e) { return false; }
  }
  if (blocked()) {
    window.spotdImpScan = function () {};
    window.spotdImpView = function () {};
    return;
  }

  function platform() {
    try {
      if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return 'ios_app';
      if (window.spotdNative || location.protocol === 'capacitor:') return 'ios_app';
    } catch (e) {}
    return 'web';
  }
  function device() {
    try {
      var ua = navigator.userAgent || '';
      if (/iPad|Tablet|PlayBook|Silk/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) return 'tablet';
      if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|IEMobile/.test(ua)) return 'mobile';
      return 'desktop';
    } catch (e) { return 'unknown'; }
  }
  function city() {
    // app.js declares `state` as a top-level const: visible by name across
    // classic scripts, but not as window.state.
    try { if (typeof state !== 'undefined' && state.city && state.city.slug) return state.city.slug; } catch (e) {}
    try { return document.body.getAttribute('data-city') || undefined; } catch (e) { return undefined; }
  }
  function send(events) {
    if (!events.length) return;
    try {
      fetch('/api/vibe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anon: true, platform: platform(), device: device(), events: events }),
        keepalive: true,
      }).catch(function () {});
    } catch (e) {}
  }

  // ── impressions ──
  var seen = {};      // src|venueId → true (once per page load)
  var pending = {};   // src → [ids]
  var timers = new Map();
  var flushTimer = null;

  function srcOf(el) { return el.getAttribute('data-imp-src') || (location.pathname === '/' ? 'app_feed' : 'site_list'); }

  function record(id, src) {
    var k = src + '|' + id;
    if (seen[k]) return;
    seen[k] = true;
    (pending[src] = pending[src] || []).push(id);
    var total = 0; for (var s in pending) total += pending[s].length;
    if (total >= MAX_IDS) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
  }
  function flush() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    var events = [], c = city();
    for (var src in pending) {
      var ids = pending[src];
      for (var i = 0; i < ids.length; i += MAX_IDS) {
        var p = { ids: ids.slice(i, i + MAX_IDS), src: src };
        if (c) p.city = c;
        events.push({ n: 'venue_impressions', p: p, path: location.pathname, t: Date.now() });
      }
    }
    pending = {};
    for (var j = 0; j < events.length; j += 10) send(events.slice(j, j + 10));
  }

  var io = null;
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var el = en.target;
        if (en.isIntersecting && en.intersectionRatio >= 0.5) {
          if (timers.has(el)) return;
          timers.set(el, setTimeout(function () {
            timers.delete(el);
            if (!el.isConnected) return;
            var id = el.getAttribute('data-vid');
            if (id) record(id, srcOf(el));
          }, DWELL_MS));
        } else if (timers.has(el)) {
          clearTimeout(timers.get(el));
          timers.delete(el);
        }
      });
    }, { threshold: [0, 0.5] });
  }

  // IntersectionObserver strongly retains its targets, so a re-scan after an
  // innerHTML rebuild disconnects first (releases the orphaned cards) and then
  // re-observes every live [data-vid].
  window.spotdImpScan = function () {
    if (!io) return;
    try {
      io.disconnect();
      timers.forEach(function (t) { clearTimeout(t); });
      timers.clear();
      var els = document.querySelectorAll('[data-vid]');
      for (var i = 0; i < els.length; i++) io.observe(els[i]);
    } catch (e) {}
  };

  // ── detail views ──
  var viewed = {};
  window.spotdImpView = function (id, src) {
    if (!id) return;
    src = src || (location.pathname === '/' ? 'app_modal' : 'site_page');
    var k = src + '|' + id;
    if (viewed[k]) return;
    viewed[k] = true;
    var p = { id: String(id), src: src };
    var c = city(); if (c) p.city = c;
    send([{ n: 'venue_view', p: p, path: location.pathname, t: Date.now() }]);
  };

  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);

  function boot() {
    try {
      var v = document.body && document.body.getAttribute('data-venue-view');
      if (v) window.spotdImpView(v, 'site_page');
    } catch (e) {}
    window.spotdImpScan();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
