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
 */
(function () {
  'use strict';

  function get() { try { return localStorage.getItem('spotd_consent'); } catch (e) { return null; } }
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

  // Do-Not-Track → treat as a decline, no banner.
  try {
    if (navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.msDoNotTrack === '1') {
      window.__spotdConsent = 'denied'; return;
    }
  } catch (e) {}

  var prior = get();
  if (prior === 'granted' || prior === 'denied') { window.__spotdConsent = prior; return; }

  // Undecided — hold sending and show the banner.
  window.__spotdConsent = 'pending';

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
