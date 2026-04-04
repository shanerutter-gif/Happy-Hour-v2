export const config = { runtime: 'edge' };

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

function starHTML(rating) {
  let s = '';
  for (let i = 1; i <= 5; i++) {
    s += i <= rating
      ? '<span style="color:var(--coral)">&#9733;</span>'
      : '<span style="color:var(--border2)">&#9733;</span>';
  }
  return s;
}

function formatDays(days) {
  if (!days || !days.length) return '';
  const order = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const sorted = days.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return sorted.join(', ');
}

/* ── Supabase fetch helpers ──────────────────────── */

async function fetchVenues(supabaseUrl, serviceKey) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/venues?active=eq.true&select=*`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  return res.ok ? res.json() : [];
}

async function fetchReviews(supabaseUrl, serviceKey, venueId) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/reviews?venue_id=eq.${venueId}&select=*&order=created_at.desc&limit=20`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  return res.ok ? res.json() : [];
}

/* ── Build the page ──────────────────────────────── */

function buildPage(venue, reviews, allVenues) {
  const name = esc(venue.name);
  const hood = esc(venue.neighborhood || '');
  const city = venue.city_slug ? venue.city_slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '';
  const address = esc(venue.address || '');
  const hours = esc(venue.hours || '');
  const deals = venue.deals || [];
  const cuisine = esc(venue.cuisine || '');
  const url = venue.url || '';
  const photoUrl = venue.photo_url || venue.photo_urls?.[0] || '';
  const ogImage = photoUrl || 'https://spotd.biz/icons/icon-512.png';

  // Compute average rating
  const avgRating = reviews.length
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : null;
  const ratingCount = reviews.length;

  // Build amenity tags
  const amenities = [];
  if (venue.has_happy_hour || deals.length) amenities.push('Happy Hour');
  if (venue.has_live_music) amenities.push('Live Music');
  if (venue.has_trivia) amenities.push('Trivia');
  if (venue.has_karaoke) amenities.push('Karaoke');
  if (venue.has_sports_tv) amenities.push('Sports TV');
  if (venue.is_dog_friendly) amenities.push('Dog Friendly');
  if (venue.has_bingo) amenities.push('Bingo');
  if (venue.has_comedy) amenities.push('Comedy');

  // Build meta description
  const dealText = deals.length ? ` Deals: ${deals.slice(0, 2).join(', ')}.` : '';
  const metaDesc = `${venue.name}${hood ? ` in ${venue.neighborhood}` : ''}${city ? `, ${city}` : ''}.${dealText} ${hours ? `Hours: ${hours}.` : ''} See reviews, deals & check in on Spotd.`;

  // JSON-LD: LocalBusiness
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': cuisine ? 'Restaurant' : 'LocalBusiness',
    name: venue.name,
    ...(address && { address: { '@type': 'PostalAddress', streetAddress: venue.address } }),
    ...(venue.lat && venue.lng && { geo: { '@type': 'GeoCoordinates', latitude: venue.lat, longitude: venue.lng } }),
    ...(url && { url }),
    ...(photoUrl && { image: photoUrl }),
    ...(cuisine && { servesCuisine: venue.cuisine }),
    ...(avgRating && {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: avgRating,
        reviewCount: ratingCount,
        bestRating: '5',
        worstRating: '1'
      }
    }),
    ...(deals.length && {
      hasOfferCatalog: {
        '@type': 'OfferCatalog',
        name: 'Happy Hour Deals',
        itemListElement: deals.map(d => ({
          '@type': 'Offer',
          description: d
        }))
      }
    })
  };

  // BreadcrumbList JSON-LD
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://spotd.biz' },
      { '@type': 'ListItem', position: 2, name: 'Spots', item: 'https://spotd.biz/spots' },
      { '@type': 'ListItem', position: 3, name: venue.name, item: `https://spotd.biz/spots/${slugify(venue.name)}` }
    ]
  };

  // Nearby venues (same neighborhood, max 6)
  const nearby = allVenues
    .filter(v => v.id !== venue.id && v.neighborhood === venue.neighborhood)
    .slice(0, 6);

  const venueSlug = slugify(venue.name);

  return `<!DOCTYPE html>
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
<title>${name}${hood ? ` — ${esc(venue.neighborhood)}` : ''} | Happy Hour & Deals — Spotd</title>
<meta name="description" content="${esc(metaDesc)}">
<link rel="canonical" href="https://spotd.biz/spots/${venueSlug}">

<!-- Open Graph -->
<meta property="og:type" content="place">
<meta property="og:url" content="https://spotd.biz/spots/${venueSlug}">
<meta property="og:title" content="${name}${hood ? ` — ${esc(venue.neighborhood)}` : ''} | Spotd">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:site_name" content="Spotd">
${venue.lat && venue.lng ? `<meta property="place:location:latitude" content="${venue.lat}">
<meta property="place:location:longitude" content="${venue.lng}">` : ''}

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${name}${hood ? ` — ${esc(venue.neighborhood)}` : ''}">
<meta name="twitter:description" content="${esc(metaDesc)}">
<meta name="twitter:image" content="${esc(ogImage)}">

<meta name="robots" content="index, follow">
<meta name="keywords" content="${name}, happy hour ${hood || city}, ${hood ? hood + ' happy hour, ' : ''}${city} bar deals, ${cuisine ? cuisine + ' ' + city + ', ' : ''}drink specials${hood ? ' ' + hood : ''}">

<!-- Structured Data -->
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<script type="application/ld+json">${JSON.stringify(breadcrumbLd)}</script>

<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cabinet+Grotesk:wght@400;500;700;800;900&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css">
<link rel="stylesheet" href="/css/blog.css">
<style>
  body { background: var(--bg); color: var(--text); margin: 0; font-family: 'DM Sans', sans-serif; }
  .spot-wrap { max-width: 640px; margin: 0 auto; padding: 0 16px 80px; }

  .spot-hero { position: relative; border-radius: 18px; overflow: hidden; margin-bottom: 20px; aspect-ratio: 16/10; background: var(--bg2); }
  .spot-hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .spot-hero-empty { display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px; color: var(--muted); }

  .spot-header { margin-bottom: 16px; }
  .spot-name { font-family: 'Cabinet Grotesk', sans-serif; font-weight: 900; font-size: 28px; color: var(--ink); letter-spacing: -.5px; line-height: 1.2; margin-bottom: 6px; }
  .spot-meta { font-size: 14px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .spot-meta-sep { color: var(--border); }
  .spot-rating { display: flex; align-items: center; gap: 4px; font-weight: 600; color: var(--ink); }
  .spot-rating-stars { font-size: 16px; letter-spacing: 1px; }

  .spot-cta { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 16px 24px; margin: 20px 0; border-radius: 14px; font-family: 'Cabinet Grotesk', sans-serif; font-weight: 800; font-size: 16px; background: var(--coral); color: #fff; border: none; cursor: pointer; text-decoration: none; box-shadow: 0 4px 16px rgba(255,107,74,0.3); transition: opacity .15s, transform .15s; }
  .spot-cta:active { opacity: .88; transform: scale(.98); }
  .spot-cta-sec { background: var(--card); color: var(--coral); border: 1.5px solid var(--border2); box-shadow: var(--shadow); margin-top: -8px; }

  .spot-section { margin-bottom: 20px; }
  .spot-section-title { font-family: 'Cabinet Grotesk', sans-serif; font-weight: 800; font-size: 18px; color: var(--ink); margin-bottom: 10px; }

  .spot-card { background: var(--card); border: 1px solid var(--border2); border-radius: 14px; padding: 16px; box-shadow: var(--shadow); }
  .spot-info-row { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border2); }
  .spot-info-row:last-child { border-bottom: none; }
  .spot-info-icon { width: 20px; text-align: center; flex-shrink: 0; color: var(--coral); margin-top: 1px; }
  .spot-info-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .4px; font-weight: 600; margin-bottom: 2px; }
  .spot-info-value { font-size: 14px; color: var(--text); line-height: 1.4; }
  .spot-info-value a { color: var(--coral); text-decoration: none; }

  .spot-tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .spot-tag { font-size: 12px; font-weight: 600; padding: 5px 12px; border-radius: 50px; background: var(--coral-dim); color: var(--coral); border: 1px solid rgba(255,107,74,0.15); }

  .spot-deal { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; background: var(--card); border: 1px solid var(--border2); border-radius: 12px; margin-bottom: 6px; box-shadow: var(--shadow); }
  .spot-deal-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
  .spot-deal-text { font-size: 14px; color: var(--text); line-height: 1.4; }

  .spot-review { padding: 14px; background: var(--card); border: 1px solid var(--border2); border-radius: 14px; margin-bottom: 8px; box-shadow: var(--shadow); }
  .spot-review-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .spot-review-name { font-weight: 700; font-size: 14px; color: var(--ink); }
  .spot-review-date { font-size: 11px; color: var(--muted); }
  .spot-review-text { font-size: 14px; color: var(--text); line-height: 1.5; font-style: italic; }

  .spot-nearby { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .spot-nearby-card { display: block; background: var(--card); border: 1px solid var(--border2); border-radius: 14px; padding: 14px; text-decoration: none; box-shadow: var(--shadow); transition: transform .15s; }
  .spot-nearby-card:active { transform: scale(.97); }
  .spot-nearby-name { font-family: 'Cabinet Grotesk', sans-serif; font-weight: 700; font-size: 14px; color: var(--ink); margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .spot-nearby-meta { font-size: 11px; color: var(--muted); }

  .spot-footer { text-align: center; padding: 32px 0; border-top: 1px solid var(--border2); margin-top: 20px; }
  .spot-footer-text { font-size: 13px; color: var(--muted); margin-bottom: 12px; }

  .spot-promo { background: linear-gradient(135deg, var(--coral-dim), rgba(255,107,74,0.08)); border: 1px solid rgba(255,107,74,0.2); border-radius: 14px; padding: 16px; margin-bottom: 20px; }
  .spot-promo-code { font-family: 'Cabinet Grotesk', sans-serif; font-weight: 800; font-size: 18px; color: var(--coral); letter-spacing: 1px; }
  .spot-promo-desc { font-size: 13px; color: var(--text); margin-top: 4px; }

  @media (max-width: 480px) {
    .spot-nearby { grid-template-columns: 1fr; }
    .spot-name { font-size: 24px; }
  }
</style>

<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-9PXGE6LEPE"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-9PXGE6LEPE');
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

<main class="spot-wrap">

  <!-- Hero Image -->
  <div class="spot-hero">
    ${photoUrl
      ? `<img src="${esc(photoUrl)}" alt="${name} — ${hood || city}">`
      : `<div class="spot-hero-empty">📍</div>`}
  </div>

  <!-- Header -->
  <div class="spot-header">
    <h1 class="spot-name">${name}</h1>
    <div class="spot-meta">
      ${hood ? `<span>${esc(venue.neighborhood)}</span><span class="spot-meta-sep">·</span>` : ''}
      ${city ? `<span>${esc(city)}</span>` : ''}
      ${avgRating ? `<span class="spot-meta-sep">·</span><span class="spot-rating"><span class="spot-rating-stars">${starHTML(Math.round(parseFloat(avgRating)))}</span> ${avgRating} (${ratingCount})</span>` : ''}
      ${venue.owner_verified ? '<span class="spot-meta-sep">·</span><span style="color:var(--coral);font-weight:600">✓ Verified</span>' : ''}
    </div>
  </div>

  <!-- Primary CTA -->
  <a href="/?spot=${venue.id}" class="spot-cta">
    Open in Spotd — See Deals & Check In
  </a>

  ${venue.promo_code ? `
  <div class="spot-promo">
    <div class="spot-promo-code">${esc(venue.promo_code)}</div>
    ${venue.promo_description ? `<div class="spot-promo-desc">${esc(venue.promo_description)}</div>` : ''}
  </div>` : ''}

  <!-- Deals -->
  ${deals.length ? `
  <div class="spot-section">
    <h2 class="spot-section-title">Happy Hour Deals</h2>
    ${deals.map(d => `
    <div class="spot-deal">
      <div class="spot-deal-icon">🍹</div>
      <div class="spot-deal-text">${esc(d)}</div>
    </div>`).join('')}
  </div>` : ''}

  <!-- Details Card -->
  <div class="spot-section">
    <h2 class="spot-section-title">Details</h2>
    <div class="spot-card">
      ${address ? `
      <div class="spot-info-row">
        <div class="spot-info-icon">📍</div>
        <div>
          <div class="spot-info-label">Address</div>
          <div class="spot-info-value">${esc(venue.address)}</div>
        </div>
      </div>` : ''}
      ${hours ? `
      <div class="spot-info-row">
        <div class="spot-info-icon">🕐</div>
        <div>
          <div class="spot-info-label">Happy Hour</div>
          <div class="spot-info-value">${hours}${venue.days?.length ? ` · ${formatDays(venue.days)}` : ''}</div>
        </div>
      </div>` : ''}
      ${cuisine ? `
      <div class="spot-info-row">
        <div class="spot-info-icon">🍽️</div>
        <div>
          <div class="spot-info-label">Cuisine</div>
          <div class="spot-info-value">${cuisine}</div>
        </div>
      </div>` : ''}
      ${url ? `
      <div class="spot-info-row">
        <div class="spot-info-icon">🔗</div>
        <div>
          <div class="spot-info-label">Website</div>
          <div class="spot-info-value"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a></div>
        </div>
      </div>` : ''}
    </div>
  </div>

  <!-- Amenity Tags -->
  ${amenities.length ? `
  <div class="spot-section">
    <h2 class="spot-section-title">What's Here</h2>
    <div class="spot-tags">
      ${amenities.map(a => `<span class="spot-tag">${esc(a)}</span>`).join('')}
    </div>
  </div>` : ''}

  <!-- Reviews -->
  ${reviews.length ? `
  <div class="spot-section">
    <h2 class="spot-section-title">Reviews (${ratingCount})</h2>
    ${reviews.slice(0, 10).map(r => `
    <div class="spot-review">
      <div class="spot-review-header">
        <span class="spot-review-name">${esc(r.name || 'Spotd User')}</span>
        <span style="font-size:14px">${starHTML(r.rating)}</span>
        <span class="spot-review-date">${new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
      </div>
      ${r.text ? `<div class="spot-review-text">"${esc(r.text)}"</div>` : ''}
    </div>`).join('')}
    ${ratingCount > 10 ? `<p style="font-size:13px;color:var(--muted);text-align:center;margin-top:12px">+ ${ratingCount - 10} more reviews — <a href="/?spot=${venue.id}" style="color:var(--coral);text-decoration:none;font-weight:600">see all in Spotd</a></p>` : ''}
  </div>` : ''}

  <!-- Secondary CTA -->
  <a href="/?spot=${venue.id}" class="spot-cta spot-cta-sec">
    See More on Spotd
  </a>

  <!-- Nearby Spots -->
  ${nearby.length ? `
  <div class="spot-section">
    <h2 class="spot-section-title">More in ${esc(venue.neighborhood)}</h2>
    <div class="spot-nearby">
      ${nearby.map(v => `
      <a href="/spots/${slugify(v.name)}" class="spot-nearby-card">
        <div class="spot-nearby-name">${esc(v.name)}</div>
        <div class="spot-nearby-meta">${esc(v.neighborhood || '')}${v.hours ? ` · ${esc(v.hours)}` : ''}</div>
      </a>`).join('')}
    </div>
  </div>` : ''}

  <!-- Footer -->
  <div class="spot-footer">
    <div class="spot-footer-text">Find the best happy hours, trivia, live music & events near you.</div>
    <a href="/" class="spot-cta" style="display:inline-flex;width:auto;padding:14px 32px;font-size:15px">
      Explore Spotd
    </a>
  </div>

</main>

</body>
</html>`;
}

/* ── Handler ──────────────────────────────────────── */

export default async function handler(req) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return new Response('Server configuration error', { status: 500 });
  }

  const reqUrl = new URL(req.url);
  const slug = (reqUrl.searchParams.get('slug') || '').replace(/^\/+|\/+$/g, '').toLowerCase();

  if (!slug) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const venues = await fetchVenues(supabaseUrl, serviceKey);
    const venue = venues.find(v => slugify(v.name) === slug);

    if (!venue) {
      // 404 page
      return new Response(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Spot Not Found — Spotd</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/blog.css"><link href="https://fonts.googleapis.com/css2?family=Cabinet+Grotesk:wght@400;700;800;900&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet"></head><body style="background:var(--bg);display:flex;flex-direction:column;min-height:100vh"><nav class="blog-nav"><a href="/" class="nav-brand"><img src="/spotd_logo_v5.png" alt="Spotd" class="nav-logo-img" onerror="this.style.display='none'"></a><div class="blog-nav-links"><a href="/" class="blog-nav-cta">Open Spotd</a></div></nav><div style="flex:1;display:flex;align-items:center;justify-content:center;text-align:center;padding:40px"><div><div style="font-size:48px;margin-bottom:16px">🍹</div><h1 style="font-family:'Cabinet Grotesk',sans-serif;font-size:24px;color:var(--ink);margin-bottom:8px">Spot not found</h1><p style="color:var(--muted);margin-bottom:20px">This venue doesn't exist or has been removed.</p><a href="/" style="color:var(--coral);font-weight:600;text-decoration:none">Browse all spots on Spotd →</a></div></div></body></html>`, {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' }
      });
    }

    const reviews = await fetchReviews(supabaseUrl, serviceKey, venue.id);
    const html = buildPage(venue, reviews, venues);

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
