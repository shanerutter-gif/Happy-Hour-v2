export const config = { runtime: 'edge' };

// Canonical host — www serves 200, the apex redirects. Keep canonical / og:url /
// JSON-LD on www so Google indexes the served URL rather than the redirect.
const SITE_URL = 'https://www.spotd.biz';

/* ── helpers ─────────────────────────────────────── */

function slugify(name) {
  return (name || '').toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cityName(slug) {
  return (slug || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function teaser(deals, max = 80) {
  if (!deals || !deals.length) return '';
  const d = String(deals[0]);
  return d.length > max ? d.slice(0, max - 3).trimEnd() + '…' : d;
}

const DAYS = [
  { q: 'monday',    abbr: 'Mon', label: 'Monday' },
  { q: 'tuesday',   abbr: 'Tue', label: 'Tuesday' },
  { q: 'wednesday', abbr: 'Wed', label: 'Wednesday' },
  { q: 'thursday',  abbr: 'Thu', label: 'Thursday' },
  { q: 'friday',    abbr: 'Fri', label: 'Friday' },
  { q: 'saturday',  abbr: 'Sat', label: 'Saturday' },
  { q: 'sunday',    abbr: 'Sun', label: 'Sunday' }
];

function hourLabel(h) {
  const ap = h >= 12 ? 'pm' : 'am';
  let hh = h % 12; if (hh === 0) hh = 12;
  return hh + ap;
}

// Extract a start hour (24h) from a freeform hours string, only when an am/pm
// marker makes it unambiguous. Returns null otherwise.
function parseStartHour(hours) {
  if (!hours) return null;
  const m = String(hours).match(/(\d{1,2})(?::\d{2})?\s*(am|pm)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const ap = m[2].toLowerCase();
  if (ap === 'pm' && h !== 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return (h >= 0 && h <= 23) ? h : null;
}

/* ── Supabase fetch ──────────────────────────────── */

async function fetchCityVenues(supabaseUrl, serviceKey, city) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/venues?active=eq.true&photo_url=not.is.null&city_slug=eq.${encodeURIComponent(city)}&select=name,neighborhood,address,deals,hours,days,cuisine,photo_url&order=name.asc`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  return res.ok ? res.json() : [];
}

function notFound() {
  return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Page Not Found — Spotd</title><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/blog.css"></head><body style="background:var(--bg);display:flex;flex-direction:column;min-height:100vh"><nav class="blog-nav"><a href="/" class="nav-brand"><img src="/spotd_logo_v5.png" alt="Spotd" class="nav-logo-img" onerror="this.style.display='none'"></a><div class="blog-nav-links"><a href="/" class="blog-nav-cta">Open Spotd</a></div></nav><div style="flex:1;display:flex;align-items:center;justify-content:center;text-align:center;padding:40px"><div><div style="font-size:48px;margin-bottom:16px">🍹</div><h1 style="font-family:'Cabinet Grotesk',sans-serif;font-size:24px;color:var(--ink);margin-bottom:8px">Nothing here yet</h1><p style="color:var(--muted);margin-bottom:20px">We don't have a happy hour guide for this area yet.</p><a href="/spots" style="color:var(--coral);font-weight:600;text-decoration:none">Browse all spots →</a></div></div></body></html>`, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' }
  });
}

/* ── Handler ─────────────────────────────────────── */

export default async function handler(req) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) return new Response('Server configuration error', { status: 500 });

  const reqUrl = new URL(req.url);
  const city = (reqUrl.searchParams.get('city') || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const hoodSlug = (reqUrl.searchParams.get('neighborhood') || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const dayParam = (reqUrl.searchParams.get('day') || '').toLowerCase();
  const activeDay = DAYS.find(d => d.q === dayParam) || null;

  if (!city) return notFound();

  try {
    const venues = await fetchCityVenues(supabaseUrl, serviceKey, city);
    if (!venues.length) return notFound();

    const cityNameStr = cityName(city);

    // Distinct neighborhoods in this city (for chips + counts).
    const hoodMap = {};
    for (const v of venues) {
      const n = v.neighborhood;
      if (!n) continue;
      const s = slugify(n);
      if (!hoodMap[s]) hoodMap[s] = { name: n, slug: s, count: 0 };
      hoodMap[s].count++;
    }
    const neighborhoods = Object.values(hoodMap).sort((a, b) => b.count - a.count);

    // Resolve neighborhood filter.
    let target = null;
    if (hoodSlug) {
      target = neighborhoods.find(n => n.slug === hoodSlug);
      if (!target) return notFound();
    }

    // Apply filters.
    let pool = target ? venues.filter(v => slugify(v.neighborhood || '') === target.slug) : venues;
    const dayPool = activeDay ? pool.filter(v => Array.isArray(v.days) && v.days.includes(activeDay.abbr)) : pool;
    const count = dayPool.length;

    const displayArea = target ? `${target.name}, ${cityNameStr}` : cityNameStr;
    const shortArea = target ? target.name : cityNameStr;

    // URLs. `basePath` (absolute, www) backs the canonical/og tags; `basePathRel`
    // (relative) backs the on-page <a href> nav so every internal link is a plain
    // crawlable relative anchor that resolves to the current (www) host.
    const basePath = target ? `${SITE_URL}/happy-hour/${city}/${target.slug}` : `${SITE_URL}/happy-hour/${city}`;
    const basePathRel = target ? `/happy-hour/${city}/${target.slug}` : `/happy-hour/${city}`;
    const canonical = activeDay ? `${basePath}?day=${activeDay.q}` : basePath;

    // Headings / meta.
    const h1 = activeDay
      ? `${activeDay.label} Happy Hours in ${displayArea}`
      : `The Best Happy Hours in ${displayArea}`;
    const title = `${h1} (2026) | Spotd`;

    // ── Unique, data-driven intro copy ──
    const sampleNames = dayPool.slice(0, 4).map(v => v.name);
    const sampleDeals = dayPool.filter(v => v.deals && v.deals.length).slice(0, 3).map(v => `${v.deals[0]} at ${v.name}`);
    const ogImage = (dayPool.find(v => v.photo_url) || {}).photo_url || `${SITE_URL}/icons/icon-512.png`;

    const introP1 = activeDay
      ? `There ${count === 1 ? 'is' : 'are'} <strong>${count}</strong> ${count === 1 ? 'spot' : 'spots'} on Spotd known to run happy hour on <strong>${activeDay.label}</strong> in ${esc(displayArea)} right now${target ? '' : `, spread across ${neighborhoods.length} neighborhoods`}.`
      : `${shortArea} has <strong>${pool.length}</strong> happy hour ${pool.length === 1 ? 'spot' : 'spots'} on Spotd right now${target ? '' : `, across ${neighborhoods.length} neighborhoods`} — from dive-bar well drinks to half-price oysters.`;
    const introP2 = sampleNames.length
      ? `Standouts include ${sampleNames.map(n => esc(n)).join(', ')}${count > sampleNames.length ? ` and ${count - sampleNames.length} more` : ''}. ${sampleDeals.length ? `Recent deals: ${esc(sampleDeals[0])}${sampleDeals[1] ? `; ${esc(sampleDeals[1])}` : ''}.` : ''}`
      : '';
    const introP3 = `Tap any spot below for its full deal list, hours, reviews and map. Happy hour times change often, so always verify directly with the venue before you head out.`;

    const metaDesc = `${count}${count >= 50 ? '+' : ''} ${activeDay ? activeDay.label + ' ' : ''}happy hour spots in ${displayArea}. Deals, hours, maps and reviews — find tonight's spot on Spotd.`;

    // ── Day filter chips ──
    const dayChips = DAYS.map(d => {
      const href = `${basePathRel}?day=${d.q}`;
      const cls = activeDay && activeDay.q === d.q ? 'hh-chip hh-chip--on' : 'hh-chip';
      return `<a class="${cls}" href="${href}">${d.label}</a>`;
    }).join('');
    const allDaysChip = `<a class="hh-chip${activeDay ? '' : ' hh-chip--on'}" href="${basePathRel}">All days</a>`;

    // ── Neighborhood chips (city page only) ──
    const hoodChips = !target ? neighborhoods.map(n =>
      `<a class="hh-chip" href="/happy-hour/${city}/${n.slug}">${esc(n.name)} <span>(${n.count})</span></a>`
    ).join('') : '';

    // ── Venue list ──
    const venueList = dayPool.map(v => {
      const slug = slugify(v.name);
      const t = teaser(v.deals);
      const metaBits = [];
      if (!target && v.neighborhood) metaBits.push(esc(v.neighborhood));
      if (v.hours) metaBits.push(esc(v.hours));
      return `<li class="hh-venue">
        <a class="hh-venue-name" href="/spots/${slug}">${esc(v.name)}</a>
        ${metaBits.length ? `<span class="hh-venue-meta">${metaBits.join(' · ')}</span>` : ''}
        ${t ? `<span class="hh-venue-deal">🍹 ${esc(t)}</span>` : ''}
      </li>`;
    }).join('');

    // ── FAQ (visible + JSON-LD must mirror exactly) ──
    const starts = pool.map(v => parseStartHour(v.hours)).filter(h => h !== null);
    let startAnswer;
    if (starts.length) {
      const freq = {};
      starts.forEach(h => { freq[h] = (freq[h] || 0) + 1; });
      const mode = Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0];
      const earliest = Math.min(...starts);
      startAnswer = `Most happy hours in ${displayArea} start around ${hourLabel(parseInt(mode, 10))}, with some kicking off as early as ${hourLabel(earliest)}. Each spot's exact window is listed on its page.`;
    } else {
      startAnswer = `Happy hour in ${displayArea} typically starts between 3pm and 6pm, but times vary by venue — check each spot's page for its exact window.`;
    }

    const tueVenues = pool.filter(v => Array.isArray(v.days) && v.days.includes('Tue'));
    const faqs = [];
    faqs.push({
      q: `How many happy hour spots are in ${displayArea}?`,
      a: `Spotd lists ${count} ${activeDay ? activeDay.label + ' ' : ''}happy hour ${count === 1 ? 'spot' : 'spots'} in ${displayArea} right now${!target && !activeDay ? `, across ${neighborhoods.length} neighborhoods` : ''}, each with up-to-date deals and hours.`
    });
    faqs.push({
      q: `What time does happy hour start in ${displayArea}?`,
      a: startAnswer
    });
    if (!activeDay) {
      faqs.push({
        q: `Which ${shortArea} spots have happy hour on Tuesday?`,
        a: `${tueVenues.length} ${shortArea} ${tueVenues.length === 1 ? 'spot runs' : 'spots run'} a Tuesday happy hour on Spotd${tueVenues.length ? `, including ${tueVenues.slice(0, 3).map(v => v.name).join(', ')}` : ''}. See the full list on the Tuesday filter.`
      });
    } else {
      faqs.push({
        q: `Which spots have ${activeDay.label} happy hour in ${displayArea}?`,
        a: count ? `${dayPool.slice(0, 5).map(v => v.name).join(', ')}${count > 5 ? ` and ${count - 5} more` : ''} all run a ${activeDay.label} happy hour in ${displayArea}.` : `We don't have any ${activeDay.label} happy hours listed for ${displayArea} yet — try another day or browse all spots.`
      });
    }
    const dealEx = pool.filter(v => v.deals && v.deals.length).slice(0, 3);
    faqs.push({
      q: `What are the best happy hour deals in ${displayArea}?`,
      a: dealEx.length ? `Popular picks include ${dealEx.map(v => `${v.deals[0]} at ${v.name}`).join('; ')}. Browse every deal on the spots below.` : `Browse the spots below for current happy hour deals in ${displayArea}.`
    });

    const faqHtml = faqs.map(f => `
      <div class="blog-faq-item">
        <div class="blog-faq-q">${esc(f.q)}</div>
        <div class="blog-faq-a">${esc(f.a)}</div>
      </div>`).join('');

    const faqLd = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map(f => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a }
      }))
    };

    const itemListLd = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: h1,
      numberOfItems: count,
      itemListElement: dayPool.map((v, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE_URL}/spots/${slugify(v.name)}`,
        name: v.name
      }))
    };

    const breadcrumbItems = [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: `${cityNameStr} Happy Hour`, item: `${SITE_URL}/happy-hour/${city}` }
    ];
    if (target) breadcrumbItems.push({ '@type': 'ListItem', position: 3, name: target.name, item: basePath });
    const breadcrumbLd = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: breadcrumbItems };

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<script>
(function(){
  var t = localStorage.getItem('spotd-theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
})();
</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(metaDesc)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonical}">
<meta property="og:title" content="${esc(h1)}">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:site_name" content="Spotd">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:url" content="${canonical}">
<meta name="twitter:title" content="${esc(h1)}">
<meta name="twitter:description" content="${esc(metaDesc)}">
<meta name="twitter:image" content="${esc(ogImage)}">
<meta name="robots" content="index, follow">

<script type="application/ld+json">${JSON.stringify(itemListLd)}</script>
<script type="application/ld+json">${JSON.stringify(faqLd)}</script>
<script type="application/ld+json">${JSON.stringify(breadcrumbLd)}</script>

<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cabinet+Grotesk:wght@400;500;700;800;900&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css">
<link rel="stylesheet" href="/css/blog.css">
<style>
  body { background: var(--bg); color: var(--text); margin: 0; font-family: 'DM Sans', sans-serif; }
  .hh-wrap { max-width: 860px; margin: 0 auto; padding: 0 16px 80px; }
  .hh-crumbs { font-size: 12px; color: var(--muted); padding: 18px 0 0; }
  .hh-crumbs a { color: var(--muted); text-decoration: none; }
  .hh-crumbs a:hover { color: var(--coral); }
  .hh-head { padding: 14px 0 8px; }
  .hh-h1 { font-family: 'Cabinet Grotesk', sans-serif; font-weight: 900; font-size: 32px; color: var(--ink); letter-spacing: -.6px; line-height: 1.12; margin: 0 0 12px; }
  .hh-intro p { font-size: 15px; color: var(--text); line-height: 1.6; margin: 0 0 10px; max-width: 680px; }
  .hh-intro strong { color: var(--ink); }
  .hh-filters { margin: 18px 0 6px; }
  .hh-filter-label { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); font-weight: 700; margin: 14px 0 8px; }
  .hh-chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .hh-chip { font-size: 13px; font-weight: 600; text-decoration: none; color: var(--text); background: var(--card); border: 1px solid var(--border2); padding: 7px 13px; border-radius: 50px; }
  .hh-chip span { color: var(--muted); font-weight: 500; }
  .hh-chip--on { background: var(--coral); color: #fff; border-color: var(--coral); }
  .hh-chip--on span { color: rgba(255,255,255,.8); }
  .hh-count { font-size: 13px; color: var(--muted); margin: 22px 0 10px; font-weight: 600; }
  .hh-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .hh-venue { background: var(--card); border: 1px solid var(--border2); border-radius: 14px; padding: 14px 16px; box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 4px; }
  .hh-venue-name { font-family: 'Cabinet Grotesk', sans-serif; font-weight: 800; font-size: 16px; color: var(--ink); text-decoration: none; }
  .hh-venue-name:hover { color: var(--coral); }
  .hh-venue-meta { font-size: 12px; color: var(--muted); }
  .hh-venue-deal { font-size: 13px; color: var(--text); }
  .hh-section-title { font-family: 'Cabinet Grotesk', sans-serif; font-weight: 800; font-size: 22px; color: var(--ink); margin: 36px 0 14px; }
  .blog-faq { margin-top: 8px; }
  .hh-back { display: inline-block; margin: 28px 0 0; color: var(--coral); font-weight: 700; text-decoration: none; }
  @media (max-width: 640px) { .hh-list { grid-template-columns: 1fr; } .hh-h1 { font-size: 26px; } }
</style>

<script async src="https://www.googletagmanager.com/gtag/js?id=G-5271Q2407Q"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-5271Q2407Q');
</script>
</head>
<body>

<nav class="blog-nav">
  <a href="/" class="nav-brand">
    <img src="/spotd_logo_v5.png" alt="Spotd" class="nav-logo-img"
      onerror="this.style.display='none';this.nextElementSibling.style.display='inline'">
    <span style="display:none">Spotd</span>
  </a>
  <div class="blog-nav-links">
    <a href="/spots" class="blog-nav-link">All Spots</a>
    <a href="/blog.html" class="blog-nav-link">Blog</a>
    <a href="/" class="blog-nav-cta">Open Spotd</a>
  </div>
</nav>

<main class="hh-wrap">
  <nav class="hh-crumbs">
    <a href="/">Home</a> › <a href="/happy-hour/${city}">${esc(cityNameStr)} Happy Hour</a>${target ? ` › <span>${esc(target.name)}</span>` : ''}
  </nav>

  <div class="hh-head">
    <h1 class="hh-h1">${esc(h1)}</h1>
    <div class="hh-intro">
      <p>${introP1}</p>
      ${introP2 ? `<p>${introP2}</p>` : ''}
      <p>${introP3}</p>
    </div>
  </div>

  <div class="hh-filters">
    <div class="hh-filter-label">Filter by day</div>
    <div class="hh-chips">${allDaysChip}${dayChips}</div>
    ${hoodChips ? `<div class="hh-filter-label">Browse by neighborhood</div><div class="hh-chips">${hoodChips}</div>` : ''}
  </div>

  <div class="hh-count">${count} ${count === 1 ? 'spot' : 'spots'}${activeDay ? ` with ${activeDay.label} happy hour` : ''} in ${esc(displayArea)}</div>
  <ul class="hh-list">${venueList}</ul>

  ${target ? `<a class="hh-back" href="/happy-hour/${city}">← All ${esc(cityNameStr)} happy hours</a>` : `<a class="hh-back" href="/spots">← Browse every spot on Spotd</a>`}

  <h2 class="hh-section-title">Frequently Asked Questions</h2>
  <div class="blog-faq">${faqHtml}</div>
</main>

<footer class="blog-footer">
  <div class="blog-footer-inner">
    <p class="blog-footer-brand">Spotd</p>
    <p class="blog-footer-copy">&copy; 2026 Spotd. Always verify times directly with venues.</p>
    <div class="blog-footer-links">
      <a href="/">Home</a>
      <a href="/spots">All Spots</a>
      <a href="/happy-hour/san-diego">San Diego</a>
      <a href="/happy-hour/orange-county">Orange County</a>
      <a href="/blog.html">Blog</a>
      <a href="/about.html">About</a>
    </div>
  </div>
</footer>

<script defer src="/js/site-analytics.js?v=20260616a"></script>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400'
      }
    });
  } catch (err) {
    return new Response('Internal server error', { status: 500 });
  }
}
