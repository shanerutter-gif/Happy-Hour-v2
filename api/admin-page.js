// api/admin-page.js — serves admin.html with the claims script tag injected.
// Why: admin.html is ~360 KB and we don't want to rewrite it to add a one-line
// <script> tag. This edge function fetches the static file and injects the tag
// at serve time. Routed from /admin.html via vercel.json.

export const config = { runtime: 'edge' };

const SCRIPT_TAGS = [
  '<script src="/admin-claims.js" defer></script>',
  '<script src="/admin-giveaway.js" defer></script>',
];

// Fetch the static admin.html from the same deployment's raw GitHub source so
// we always reflect the latest main branch. Cached at the edge.
const SOURCE_URL = 'https://raw.githubusercontent.com/shanerutter-gif/Happy-Hour-v2/main/admin.html';

export default async function handler() {
  try {
    const res = await fetch(SOURCE_URL, { cache: 'no-store' });
    if (!res.ok) {
      return new Response('admin source unavailable', { status: 502 });
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
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (e) {
    return new Response('admin-page error: ' + (e && e.message || e), { status: 500 });
  }
}
