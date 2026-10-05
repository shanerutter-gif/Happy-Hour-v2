export const config = { runtime: 'edge' };

import { canonicalHood } from './_lib/seo.js';

// Sitemap for the crawlable directory + city/neighborhood happy-hour landing
// pages. Canonical host is www (the apex redirects). See api/spots-directory.js
// and api/happy-hour.js.
const SITE_URL = 'https://www.spotd.biz';

const DAY_SLUGS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// slugify lives in _lib/seo.js (used internally by canonicalHood).

function urlEntry(loc, priority, changefreq, lastmod) {
  return `  <url>
    <loc>${loc}</loc>
    ${lastmod ? `<lastmod>${lastmod}</lastmod>\n` : ''}    <changefreq>${changefreq}</changefreq>
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
      `${supabaseUrl}/rest/v1/venues?active=eq.true&photo_url=not.is.null&select=city_slug,neighborhood,updated_at`,
      { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    );

    // city -> Map of canonical neighborhood slug -> true. Freeform variants
    // ("Gaslamp" vs "Gaslamp Quarter", "PB" vs "Pacific Beach") collapse to
    // one canonical slug via canonicalHood() so the sitemap never emits
    // duplicate thin neighborhood pages. Unmapped variants are kept as-is
    // (logged) rather than dropped.
    //
    // lastmod: track the newest venue updated_at per city / neighborhood so
    // Google can skip re-crawling hub pages whose data hasn't changed — a
    // crawl-budget win while 2,300+ URLs sit discovered-but-not-indexed.
    const cities = {};
    const loggedVariants = new Set();
    const dayOf = (ts) => ts ? new Date(ts).toISOString().split('T')[0] : '';
    for (const v of venues) {
      const c = v.city_slug;
      if (!c) continue;
      if (!cities[c]) cities[c] = { hoods: new Map(), lastmod: '' };
      const lm = dayOf(v.updated_at);
      if (lm && lm > cities[c].lastmod) cities[c].lastmod = lm;
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
      const prev = cities[c].hoods.get(canon.slug) || '';
      if (lm && lm > prev) cities[c].hoods.set(canon.slug, lm);
      else if (!cities[c].hoods.has(canon.slug)) cities[c].hoods.set(canon.slug, '');
    }

    const entries = [urlEntry(`${SITE_URL}/spots`, '0.9', 'daily')];

    for (const city of Object.keys(cities).sort()) {
      const cityLm = cities[city].lastmod;
      entries.push(urlEntry(`${SITE_URL}/happy-hour/${city}`, '0.9', 'daily', cityLm));
      // City-level day filters (target "tuesday happy hour san diego" etc.)
      for (const day of DAY_SLUGS) {
        entries.push(urlEntry(`${SITE_URL}/happy-hour/${city}?day=${day}`, '0.6', 'weekly', cityLm));
      }
      // Neighborhood pages — canonical slugs only.
      for (const hood of [...cities[city].hoods.keys()].sort()) {
        entries.push(urlEntry(`${SITE_URL}/happy-hour/${city}/${hood}`, '0.7', 'weekly', cities[city].hoods.get(hood) || cityLm));
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
