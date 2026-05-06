// api/admin-page.js — serves admin.html with the claims script tag injected.
// Why: admin.html is ~360 KB and we don't want to rewrite it to add a one-line
// <script> tag. This edge function fetches the static file and injects the tag
// at serve time. Routed from /admin.html via vercel.json.

export const config = { runtime: 'edge' };

const SCRIPT_TAGS = [
  '<script src="/admin-claims.js" defer></script>',
  '<script src="/admin-giveaway.js" defer></script>',
  '<script src="/admin-attribution.js" defer></script>',
];

// Fetch admin.html from the GitHub Contents API instead of raw.githubusercontent.com.
// raw.githubusercontent.com aggressively caches for ~5 min, which delays admin
// updates even after a successful Vercel deploy. The Contents API serves the
// latest commit on main with a much shorter cache, so the admin reflects pushes
// almost immediately.
const SOURCE_URL = 'https://api.github.com/repos/shanerutter-gif/Happy-Hour-v2/contents/admin.html?ref=main';

export default async function handler() {
  try {
    const res = await fetch(SOURCE_URL, {
      cache: 'no-store',
      headers: {
        'Accept':     'application/vnd.github.raw',
        'User-Agent': 'spotd-admin-page',
      },
    });
    if (!res.ok) {
      return new Response('admin source unavailable: ' + res.status, { status: 502 });
    }
    let html = await res.text();
    for (const tag of SCRIPT_TAGS) {
      if (html.includes(tag)) continue;
      // inject immediately before </body>; fallback to appending if not found
      if (html.includes('</body>')) {
        html = html.replace('</body>', `${tag}\n</body>`);
      } else {
        html += `\n${tag}\n`;
      }
    }
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type':  'text/html; charset=utf-8',
        // Short edge cache so a deploy reflects within ~10s, not 60s+.
        // Browsers won't cache (no-store) so a refresh always re-fetches.
        'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30',
      },
    });
  } catch (e) {
    return new Response('admin-page error: ' + (e && e.message || e), { status: 500 });
  }
}
