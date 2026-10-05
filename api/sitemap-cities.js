export const config = { runtime: 'edge' };

import { canonicalHood } from './_lib/seo.js';

// Sitemap for the crawlable directory + city/neighborhood happy-hour landing
// pages. Canonical host is www (the apex redirects). See api/spots-directory.js
// and api/happy-hour.js.
const SITE_URL = 'https://www.spotd.biz';

const DAY_SLUGS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// slugify lives in _lib/seo.js (used internally by canonicalHood).

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

    // city -> Map of canonical neighborhood slug -> true. Freeform variants
    // ("Gaslamp" vs "Gaslamp Quarter", "PB" vs "Pacific Beach") collapse to
    // one canonical slug via canonicalHood() so the sitemap never emits
    // duplicate thin neighborhood pages. Unmapped variants are kept as-is
    // (logged) rather than dropped.
    const cities = {};
    const loggedVariants = new Set();
    for (const v of venues) {
      const c = v.city_slug;
      if (!c) continue;
      if (!cities[c]) cities[c] = new Map();
      if (!v.neighborhood) continue;
      const canon = canonicalHood(v.neighborhood);
      if (!canon) continue;
      if (!canon.mapped) {
        const key = `${c}|${canon.slug}`;
        if (!loggedVariants.has(key)) {
          loggedVariants.add(key);
          console.log(`[seo-recovery] unmapped neighborhood variant: "${v.neighborhood}" (city: ${c}) -> /happy-hour/${c}/${canon.slug}`);
        }
      }
      cities[c].set(canon.slug, true);
    }

    const entries = [urlEntry(`${SITE_URL}/spots`, '0.9', 'daily')];

    for (const city of Object.keys(cities).sort()) {
      entries.push(urlEntry(`${SITE_URL}/happy-hour/${city}`, '0.9', 'daily'));
      // City-level day filters (target "tuesday happy hour san diego" etc.)
      for (const day of DAY_SLUGS) {
        entries.push(urlEntry(`${SITE_URL}/happy-hour/${city}?day=${day}`, '0.6', 'weekly'));
      }
      // Neighborhood pages — canonical slugs only.
      for (const hood of [...cities[city].keys()].sort()) {
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
