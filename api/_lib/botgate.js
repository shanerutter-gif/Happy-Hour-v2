// Edge-level bot gate for the public SEO surfaces (/happy-hour/*, /spots,
// /spots/<slug>). Runs BEFORE any Supabase fetch, so a blocked hit costs one
// edge invocation and zero DB/egress.
//
// Policy, in order:
//   1. allowlist — search engines + the AI-search crawlers robots.txt
//      explicitly welcomes (OAI-SearchBot, GPTBot, ChatGPT-User, Perplexity,
//      Claude, Google-Extended, Applebot-Extended). These NEVER block.
//   2. blocklist — lazy scrapers: empty UA and script-library signatures.
//   3. everyone else renders normally.
//
// Deliberately does NOT try to catch spoofed browser UAs — that needs WAF /
// Cloudflare, which is a Shane call (see kill criteria in the triage note).
// Blocks are logged so Vercel logs give the blocked-vs-served split.

const ALLOW = /(googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|sogou|exabot|oai-searchbot|chatgpt-user|gptbot|perplexitybot|perplexity-user|claudebot|claude-searchbot|claude-user|google-extended|applebot-extended|applebot)/i;

// python-requests, scrapy, aiohttp, httpx, wget, curl, go-http-client, java,
// libwww-perl, nutch + aggressive SEO/scraper crawlers (mj12, ahrefs, semrush,
// dotbot, petalbot, bytespider). Curated 2026-10-09; extend as logs dictate.
const BLOCK = /(python-requests|scrapy|aiohttp|httpx\/|wget|curl|go-http-client|\bjava\/\b|libwww-perl|httpunit|nutch|mj12bot|ahrefsbot|semrushbot|dotbot|petalbot|bytespider|serpstat|dataforseo)/i;

export function botVerdict(req) {
  const ua = (req.headers.get('user-agent') || '').trim();
  if (!ua) return 'block'; // no UA = no browser and no legit crawler
  if (ALLOW.test(ua)) return 'allow';
  if (BLOCK.test(ua)) return 'block';
  return 'pass';
}

// Call at the very top of an edge handler, before any env/DB work.
// Returns a Response for blocked hits, null otherwise.
export function botGate(req) {
  if (botVerdict(req) !== 'block') return null;
  try {
    const url = new URL(req.url);
    console.log('[botgate] blocked', (req.headers.get('user-agent') || '').slice(0, 80), url.pathname);
  } catch (e) { /* logging must never break the gate */ }
  // 404, not 403: reads as a dead page to the crawler, stays out of error
  // dashboards, and costs one tiny edge response.
  return new Response('Not found', { status: 404 });
}
