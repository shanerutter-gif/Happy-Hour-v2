export const config = { runtime: 'edge' };

// Canonical host — www serves 200, the apex redirects. Keep canonical / og:url /
// JSON-LD on www so Google indexes the served URL rather than the redirect.
const SITE_URL = 'https://www.spotd.biz';

/* ── helpers ─────────────────────────────────────── */

function slugify(name) {
  return name.toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cityName(slug) {
  return (slug || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function teaser(deals) {
  if (!deals || !deals.length) return '';
  const d = String(deals[0]);
  return d.length > 70 ? d.slice(0, 67).trimEnd() + '…' : d;
}

/* ── Supabase fetch ──────────────────────────────── */

async function fetchVenues(supabaseUrl, serviceKey) {
  // Mirror the sitemap: only venues with a real photo are indexable. Photoless
  // venues render as grey placeholders and stay out of Google's index.
  const res = await fetch(
    `${supabaseUrl}/rest/v1/venues?active=eq.true&photo_url=not.is.null&select=name,neighborhood,city_slug,deals&order=city_slug.asc,name.asc`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  return res.ok ? res.json() : [];
}

/* ── Handler ─────────────────────────────────────── */

export default async function handler() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return new Response('Server configuration error', { status: 500 });
  }

  try {
    const venues = await fetchVenues(supabaseUrl, serviceKey);

    // Group by city, ordered by size (launched markets — SD, OC — surface first).
    const byCity = {};
    for (const v of venues) {
      const c = v.city_slug || 'other';
      (byCity[c] = byCity[c] || []).push(v);
    }
    const cities = Object.keys(byCity).sort((a, b) => byCity[b].length - byCity[a].length);

    const total = venues.length;

    // ItemList JSON-LD over every venue URL.
    const itemListLd = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Happy Hour Spots on Spotd',
      numberOfItems: total,
      itemListElement: venues.map((v, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE_URL}/spots/${slugify(v.name)}`,
        name: v.name
      }))
    };

    const breadcrumbLd = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: 'All Spots', item: `${SITE_URL}/spots` }
      ]
    };

    const jumpNav = cities.map(c =>
      `<a class="dir-jump" href="#city-${c}">${esc(cityName(c))} <span>(${byCity[c].length})</span></a>`
    ).join('');

    const sections = cities.map(c => {
      const list = byCity[c].map(v => {
        const slug = slugify(v.name);
        const t = teaser(v.deals);
        return `<li class="dir-item">
          <a class="dir-link" href="/spots/${slug}">${esc(v.name)}</a>
          <span class="dir-meta">${esc(v.neighborhood || '')}${t ? ` · ${esc(t)}` : ''}</span>
        </li>`;
      }).join('');
      return `<section class="dir-section" id="city-${c}">
        <h2 class="dir-city">${esc(cityName(c))} <span class="dir-city-count">${byCity[c].length} spots</span></h2>
        <ul class="dir-list">${list}</ul>
      </section>`;
    }).join('');

    const title = 'All Happy Hour Spots by City — Spotd';
    const metaDesc = `Browse every happy hour spot on Spotd — ${total}+ bars and restaurants with drink deals across San Diego, Orange County and more. Find tonight's spot by city and neighborhood.`;

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
<title>${title}</title>
<meta name="description" content="${esc(metaDesc)}">
<link rel="canonical" href="${SITE_URL}/spots">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE_URL}/spots">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:image" content="${SITE_URL}/icons/icon-512.png">
<meta property="og:site_name" content="Spotd">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:url" content="${SITE_URL}/spots">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${esc(metaDesc)}">
<meta name="robots" content="index, follow">

<script type="application/ld+json">${JSON.stringify(itemListLd)}</script>
<script type="application/ld+json">${JSON.stringify(breadcrumbLd)}</script>

<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cabinet+Grotesk:wght@400;500;700;800;900&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css">
<link rel="stylesheet" href="/css/blog.css">
<style>
  body { background: var(--bg); color: var(--text); margin: 0; font-family: 'DM Sans', sans-serif; }
  .dir-wrap { max-width: 880px; margin: 0 auto; padding: 0 16px 80px; }
  .dir-head { padding: 28px 0 12px; }
  .dir-h1 { font-family: 'Cabinet Grotesk', sans-serif; font-weight: 900; font-size: 30px; color: var(--ink); letter-spacing: -.5px; line-height: 1.15; margin: 0 0 8px; }
  .dir-intro { font-size: 15px; color: var(--muted); line-height: 1.55; max-width: 640px; }
  .dir-jumps { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 6px; }
  .dir-jump { font-size: 13px; font-weight: 600; text-decoration: none; color: var(--coral); background: var(--coral-dim); border: 1px solid rgba(255,107,74,0.15); padding: 6px 12px; border-radius: 50px; }
  .dir-jump span { color: var(--muted); font-weight: 500; }
  .dir-section { margin-top: 28px; scroll-margin-top: 16px; }
  .dir-city { font-family: 'Cabinet Grotesk', sans-serif; font-weight: 800; font-size: 22px; color: var(--ink); margin: 0 0 12px; display: flex; align-items: baseline; gap: 10px; }
  .dir-city-count { font-size: 13px; font-weight: 600; color: var(--muted); }
  .dir-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; }
  .dir-item { padding: 9px 0; border-bottom: 1px solid var(--border2); }
  .dir-link { font-weight: 700; font-size: 15px; color: var(--ink); text-decoration: none; }
  .dir-link:hover { color: var(--coral); }
  .dir-meta { display: block; font-size: 12px; color: var(--muted); margin-top: 2px; line-height: 1.4; }
  @media (max-width: 640px) { .dir-list { grid-template-columns: 1fr; } .dir-h1 { font-size: 25px; } }
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
    <a href="/blog.html" class="blog-nav-link">Blog</a>
    <a href="/" class="blog-nav-cta">Open Spotd</a>
  </div>
</nav>

<main class="dir-wrap">
  <div class="dir-head">
    <h1 class="dir-h1">Every Happy Hour Spot on Spotd</h1>
    <p class="dir-intro">Browse all ${total} happy hour bars and restaurants on Spotd, organised by city. Tap any spot for its deals, hours, reviews and map. Looking for a specific area? Try our <a href="/happy-hour/san-diego">San Diego happy hour guide</a>.</p>
    <nav class="dir-jumps">${jumpNav}</nav>
  </div>
  ${sections}
</main>

<footer class="blog-footer">
  <div class="blog-footer-inner">
    <p class="blog-footer-brand">Spotd</p>
    <p class="blog-footer-copy">&copy; 2026 Spotd. Always verify times directly with venues.</p>
    <div class="blog-footer-links">
      <a href="/">Home</a>
      <a href="/spots">All Spots</a>
      <a href="/happy-hour/san-diego">San Diego</a>
      <a href="/blog.html">Blog</a>
      <a href="/about.html">About</a>
      <a href="/business-landing.html">For Business</a>
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
