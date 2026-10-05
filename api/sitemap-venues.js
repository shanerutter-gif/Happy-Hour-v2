export const config = { runtime: 'edge' };

import { canonicalVenueSlugs } from './_lib/seo.js';

// Canonical host — must match the venue page <link rel="canonical"> (www, the
// host that serves 200). The apex redirects, so apex sitemap URLs fail to fetch.
const SITE_URL = 'https://www.spotd.biz';

// slugify lives in _lib/seo.js (used internally by canonicalVenueSlugs).

// Fetch ALL rows, paging past PostgREST's 1,000-row default cap via Range
// headers. Active photo'd venues exceed 1,000 since the 7-city launch, so an
// un-paged fetch dropped ~900 URLs from this sitemap.
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

  if (!supabaseUrl || !serviceKey) {
    return new Response('Server error', { status: 500 });
  }

  try {
    // Only include venues with a real photo. Photoless venues render as grey
    // placeholder cards — keep them out of Google's index until the enrichment
    // pass populates photo_url. See api/admin-enrich-venues.js.
    // id + city_slug are needed for cross-city slug disambiguation below.
    // Rows arrive in PostgREST default (physical) order — the same relative
    // order api/spots.js sees — so group "firsts" here match the URLs that
    // /spots/<slug> resolves to. Do NOT add an order= param: it would reshuffle
    // winners and break currently-indexed URLs.
    const venues = await fetchAllRows(
      `${supabaseUrl}/rest/v1/venues?active=eq.true&photo_url=not.is.null&select=id,name,city_slug,updated_at`,
      { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    );

    // Cross-city disambiguation: previously this deduped by slug keeping the
    // first, so ~44 losing venues had no indexable URL at all (their would-be
    // URL 404'd). Now every venue gets a canonical slug — winners keep the
    // plain slug, losers get `<slug>-<city_slug>` — and all are emitted.
    const { byId } = canonicalVenueSlugs(venues);
    const lastmodOf = {};
    for (const v of venues) {
      lastmodOf[v.id] = v.updated_at
        ? new Date(v.updated_at).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];
    }
    const urls = [];
    for (const v of venues) {
      const slug = byId.get(v.id);
      if (!slug) continue;
      urls.push(`  <url>
    <loc>${SITE_URL}/spots/${slug}</loc>
    <lastmod>${lastmodOf[v.id]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`);
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
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
