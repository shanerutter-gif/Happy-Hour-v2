export const config = { runtime: 'edge' };

// Canonical host — must match the venue page <link rel="canonical"> (www, the
// host that serves 200). The apex redirects, so apex sitemap URLs fail to fetch.
const SITE_URL = 'https://www.spotd.biz';

function slugify(name) {
  return name.toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

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
    const venues = await fetchAllRows(
      `${supabaseUrl}/rest/v1/venues?active=eq.true&photo_url=not.is.null&select=name,updated_at`,
      { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    );

    // Dedupe by slug: slugify(name) ignores city, so ~44 cross-city name
    // collisions would otherwise emit duplicate <loc>s. Keep the first.
    const seen = new Set();
    const urls = [];
    for (const v of venues) {
      const slug = slugify(v.name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      const lastmod = v.updated_at ? new Date(v.updated_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      urls.push(`  <url>
    <loc>${SITE_URL}/spots/${slug}</loc>
    <lastmod>${lastmod}</lastmod>
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
