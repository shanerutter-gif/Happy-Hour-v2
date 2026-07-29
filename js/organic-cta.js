/* organic-cta.js — timed signup prompt for ORGANIC visitors on the public SEO
 * pages (SSR venue/city pages, /spots directory, blog posts, about).
 *
 * Behavior: if the visitor arrived from a search engine or AI answer engine
 * (referrer or utm_source), let them read for a few seconds, then slide up a
 * small bottom card inviting them to sign up. The CTA deep-links into the app
 * as "/?signup=1&city=<slug>" — js/app.js handles that param by skipping
 * onboarding, entering the landing page's city, and opening the auth sheet
 * directly (so the page they came from becomes their default city).
 *
 * Deliberately a NON-BLOCKING bottom card, not a full-screen modal — Google
 * penalizes intrusive interstitials on mobile organic entry, so the content
 * must stay visible and scrollable behind it.
 *
 * City source: window.__spotdOrganicCity (set inline by the SSR renderers),
 * falling back to path parsing (/happy-hour/<city>) and blog-slug heuristics.
 * Shown at most once per browser session. Self-contained (injects its own CSS
 * — the SSR pages don't load css/style.css). Every path is defensive so it can
 * never break a page or hurt SEO.
 */
(function () {
  'use strict';

  var DELAY_MS = 6000;                 // let them read the page first
  var SEEN_KEY = 'spotd_organic_cta';  // sessionStorage: prompt shown already

  // Active markets (mirrors the CITIES array in js/app.js). Only these slugs
  // are ever passed along; js/app.js re-validates against CITIES anyway.
  var CITY_NAMES = {
    'san-diego': 'San Diego',
    'orange-county': 'Orange County',
    'los-angeles': 'Los Angeles',
    'new-york': 'New York',
    'chicago': 'Chicago',
    'austin': 'Austin',
    'miami': 'Miami'
  };

  // Search engines + AI answer engines whose referrals count as organic.
  var ORGANIC_HOST_RE = /(^|\.)(google\.[a-z.]{2,6}|bing\.com|duckduckgo\.com|search\.yahoo\.com|ecosia\.org|search\.brave\.com|startpage\.com|qwant\.com|yandex\.(com|ru)|baidu\.com|chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)$/i;
  // ChatGPT appends utm_source=chatgpt.com to cited links; cover the rest too.
  var ORGANIC_UTM_RE = /^(google|bing|duckduckgo|yahoo|ecosia|brave|chatgpt|openai|perplexity|claude|gemini|copilot)/i;

  function isBot() {
    try {
      if (navigator.webdriver) return true;
      return /bot|crawl|spider|slurp|mediapartners|googlebot|bingpreview|adsbot|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|facebookexternalhit|embedly|quora|whatsapp|telegram|slackbot|discordbot|preview|scrapy|python-requests|axios|curl|wget|phantomjs/i.test(navigator.userAgent || '');
    } catch (e) { return false; }
  }

  // Signed-in app users keep a Supabase session in localStorage — don't nag them.
  function signedIn() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('sb-') === 0 && k.indexOf('-auth-token') !== -1) return true;
      }
    } catch (e) {}
    return false;
  }

  function isOrganic() {
    try {
      var utm = new URLSearchParams(location.search).get('utm_source') || '';
      if (utm && ORGANIC_UTM_RE.test(utm)) return true;
    } catch (e) {}
    try {
      if (!document.referrer) return false;
      var host = new URL(document.referrer).hostname || '';
      if (!host || host === location.hostname) return false;
      return ORGANIC_HOST_RE.test(host);
    } catch (e) { return false; }
  }

  function citySlug() {
    try {
      var g = window.__spotdOrganicCity;
      if (g && CITY_NAMES[String(g)]) return String(g);
      var p = (location.pathname || '').toLowerCase();
      // /happy-hour/<city>[/...] carries the slug directly.
      var m = p.match(/^\/happy-hour\/([a-z-]+)/);
      if (m && CITY_NAMES[m[1]]) return m[1];
      // Direct city-slug mention anywhere in the path (blog guides etc.).
      for (var slug in CITY_NAMES) { if (p.indexOf(slug) !== -1) return slug; }
      // Blog neighborhood guides: map well-known area names to their market.
      if (/(costa-mesa|irvine|newport|laguna|huntington|fullerton)/.test(p)) return 'orange-county';
      if (/(gaslamp|hillcrest|north-park|pacific-beach|ocean-beach|east-village|little-italy)/.test(p)) return 'san-diego';
    } catch (e) {}
    return '';
  }

  if (isBot() || signedIn() || !isOrganic()) return;
  try { if (sessionStorage.getItem(SEEN_KEY)) return; } catch (e) {}

  var CSS = [
    '.soc-wrap{position:fixed;left:0;right:0;bottom:0;z-index:9990;display:flex;justify-content:center;padding:0 10px calc(10px + env(safe-area-inset-bottom,0px));pointer-events:none}',
    '.soc-card{pointer-events:auto;position:relative;width:100%;max-width:430px;background:#FFFFFF;color:#2A1F14;border:1px solid rgba(42,31,20,0.10);border-radius:22px;box-shadow:0 12px 40px rgba(42,31,20,0.22);padding:18px 18px 16px;font-family:"DM Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;transform:translateY(120%);opacity:0;transition:transform .5s cubic-bezier(.16,1,.3,1),opacity .4s ease}',
    '.soc-card.soc-in{transform:translateY(0);opacity:1}',
    '.soc-close{position:absolute;top:10px;right:10px;width:30px;height:30px;border:none;border-radius:50%;background:rgba(42,31,20,0.07);color:#7A6A58;font-size:16px;line-height:30px;text-align:center;cursor:pointer;padding:0}',
    '.soc-head{display:flex;align-items:center;gap:11px;margin:0 26px 8px 0}',
    '.soc-logo{width:40px;height:40px;border-radius:11px;flex:0 0 auto}',
    '.soc-title{font-size:16.5px;font-weight:700;line-height:1.25;margin:0}',
    '.soc-sub{font-size:13.5px;line-height:1.5;color:#6E5E4C;margin:0 0 13px}',
    '.soc-actions{display:flex;align-items:center;gap:10px}',
    '.soc-cta{flex:1;display:block;text-align:center;text-decoration:none;font-size:15px;font-weight:700;color:#fff;background:linear-gradient(135deg,#FF6B4A,#E8943A);border-radius:999px;padding:12px 18px;box-shadow:0 6px 18px rgba(255,107,74,0.35)}',
    '.soc-later{flex:0 0 auto;border:none;background:none;font-size:13.5px;font-weight:600;color:#8A7A66;cursor:pointer;padding:10px 6px}',
    ':root[data-theme="dark"] .soc-card{background:#1D1712;color:#F5EFE6;border-color:rgba(255,255,255,0.10);box-shadow:0 12px 40px rgba(0,0,0,0.55)}',
    ':root[data-theme="dark"] .soc-close{background:rgba(255,255,255,0.09);color:#B6AA8F}',
    ':root[data-theme="dark"] .soc-sub{color:#C4B49E}',
    ':root[data-theme="dark"] .soc-later{color:#A79680}',
    '@media (min-width:720px){.soc-wrap{justify-content:flex-end;padding-right:22px;padding-bottom:22px}}',
    '@media (prefers-reduced-motion:reduce){.soc-card{transition:none;transform:none;opacity:1}}'
  ].join('\n');

  function show() {
    try { sessionStorage.setItem(SEEN_KEY, '1'); } catch (e) {}

    var slug = citySlug();
    var cityName = CITY_NAMES[slug] || '';
    var href = '/?signup=1' + (slug ? '&city=' + encodeURIComponent(slug) : '');

    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var wrap = document.createElement('div');
    wrap.className = 'soc-wrap';
    wrap.innerHTML =
      '<div class="soc-card" role="dialog" aria-label="Sign up for Spotd">' +
        '<button class="soc-close" data-track="organic-signup-dismiss" aria-label="Dismiss">&#10005;</button>' +
        '<div class="soc-head">' +
          '<img class="soc-logo" src="/icons/icon-180.png" alt="" loading="lazy" decoding="async">' +
          '<p class="soc-title">' + (cityName ? 'Loving ' + cityName + '&#8217;s happy hours?' : 'Loving the happy hour intel?') + '</p>' +
        '</div>' +
        '<p class="soc-sub">Join Spotd free to see what&#8217;s live right now' + (cityName ? ' in ' + cityName : '') + ', save your favorite spots, and never miss a deal.</p>' +
        '<div class="soc-actions">' +
          '<a class="soc-cta" data-track="organic-signup-cta" href="' + href + '">Sign up free</a>' +
          '<button class="soc-later" data-track="organic-signup-later">Keep reading</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    function dismiss() {
      try {
        var card = wrap.querySelector('.soc-card');
        if (card) card.classList.remove('soc-in');
        setTimeout(function () { try { wrap.remove(); } catch (e) {} }, 500);
      } catch (e) { try { wrap.remove(); } catch (e2) {} }
    }
    var closeBtn = wrap.querySelector('.soc-close');
    var laterBtn = wrap.querySelector('.soc-later');
    if (closeBtn) closeBtn.addEventListener('click', dismiss);
    if (laterBtn) laterBtn.addEventListener('click', dismiss);

    // The GDPR consent banner (#spotd-consent, js/consent.js) is also fixed to
    // the bottom at a near-max z-index and self-removes on Accept/Decline —
    // sit above it while it's visible so neither blocks the other.
    var lift = setInterval(function () {
      try {
        if (!document.body.contains(wrap)) { clearInterval(lift); return; }
        var bar = document.getElementById('spotd-consent');
        wrap.style.bottom = (bar && bar.offsetHeight) ? (bar.offsetHeight + 20) + 'px' : '';
      } catch (e) { clearInterval(lift); }
    }, 400);
    try {
      var bar0 = document.getElementById('spotd-consent');
      if (bar0 && bar0.offsetHeight) wrap.style.bottom = (bar0.offsetHeight + 20) + 'px';
    } catch (e) {}

    // Slide in on the next frame so the entrance transition runs.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var card = wrap.querySelector('.soc-card');
        if (card) card.classList.add('soc-in');
      });
    });
  }

  function arm() { setTimeout(function () { try { show(); } catch (e) {} }, DELAY_MS); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arm);
  else arm();
})();
