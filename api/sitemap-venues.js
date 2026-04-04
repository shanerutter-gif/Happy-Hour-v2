export const config = { runtime: 'edge' };

function slugify(name) {
  return name.toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default async function handler() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return new Response('Server error', { status: 500 });
  }

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/venues?active=eq.true&select=name,updated_at`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    const venues = res.ok ? await res.json() : [];

    const urls = venues.map(v => {
      const slug = slugify(v.name);
      const lastmod = v.updated_at ? new Date(v.updated_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      return `  <url>
    <loc>https://spotd.biz/spots/${slug}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;
    });

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
