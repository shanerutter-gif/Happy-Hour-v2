export const config = { runtime: 'edge' };

// Dynamic sitemap for DB-backed blog posts (admin Blog Manager → blog_posts).
// These render at the extensionless /blog/<slug> via api/blog-post.js. The 26
// static blog/*.html posts live in sitemap-pages.xml; this fans out the dynamic
// ones. Referenced from the sitemap index as /api/sitemap-blog.
// Canonical host is www (the apex redirects), matching the post's canonical.
const SITE_URL = 'https://www.spotd.biz';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default async function handler() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return new Response('Server error', { status: 500 });
  }

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/blog_posts?status=eq.published&select=slug,updated_at,created_at&order=created_at.desc`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    const posts = res.ok ? await res.json() : [];

    const urls = posts.filter(p => p.slug).map(p => {
      const lastmod = (p.updated_at || p.created_at)
        ? new Date(p.updated_at || p.created_at).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];
      return `  <url>
    <loc>${SITE_URL}/blog/${esc(p.slug)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
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
