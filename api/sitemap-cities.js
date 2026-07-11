export const config = { runtime: 'edge' };

// Sitemap for the crawlable directory + city/neighborhood happy-hour landing
// pages. Canonical host is www (the apex redirects). See api/spots-directory.js
// and api/happy-hour.js.
const SITE_URL = 'https://www.spotd.biz';

const DAY_SLUGS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function slugify(name) {
  return (name || '').toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function urlEntry(loc, priority, changefreq) {
  return `  <url>
    <loc>${loc}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

// Fetch ALL rows, paging past PostgREST's 1,000-row cap via Range headers.
// Without this, neighborhoods on venues beyond row 1,000 were missing from the
// city/neighborhood sitemap after the 7-city launch.
async function fetchAllRows(url, headers) {
  const out = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const res = await fetch(url, {
      headers: { ...headers, Range: `${from}-${from + pageSize - 1}`, 'Range-Unit': 'items' },
    });
    if (!res.ok) break;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

export default async function handler() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) return new Response('Server error', { status: 500 });

  try {
    const venues = await fetchAllRows(
      `${supabaseUrl}/rest/v1/venues?active=eq.true&photo_url=not.is.null&select=city_slug,neighborhood`,
      { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    );

    // city -> Set of neighborhood slugs
    const cities = {};
    for (const v of venues) {
      const c = v.city_slug;
      if (!c) continue;
      if (!cities[c]) cities[c] = new Set();
      if (v.neighborhood) cities[c].add(slugify(v.neighborhood));
    }

    const entries = [urlEntry(`${SITE_URL}/spots`, '0.9', 'daily')];

    for (const city of Object.keys(cities).sort()) {
      entries.push(urlEntry(`${SITE_URL}/happy-hour/${city}`, '0.9', 'daily'));
      // City-level day filters (target "tuesday happy hour san diego" etc.)
      for (const day of DAY_SLUGS) {
        entries.push(urlEntry(`${SITE_URL}/happy-hour/${city}?day=${day}`, '0.6', 'weekly'));
      }
      // Neighborhood pages.
      for (const hood of [...cities[city]].sort()) {
        entries.push(urlEntry(`${SITE_URL}/happy-hour/${city}/${hood}`, '0.7', 'weekly'));
      }
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>`;

    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400'
      }
    });
  } catch {
    return new Response('Error generating sitemap', { status: 500 });
  }
}
