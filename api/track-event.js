// api/track-event.js — batched per-user event ingest for the admin User Activity
// dashboard. The browser tees every track() event here (see captureEvent() in
// js/db.js) in small batches. We insert with the service role key so RLS on
// analytics_events does not block the write.
//
// User attribution is derived SERVER-SIDE from the caller's access token (when
// present) — we never trust a client-supplied user_id, so events can't be
// spoofed onto another account. Guests (no token) are stored with a session_id
// only. Analytics must never disrupt the app: every failure path is swallowed.

export const config = { runtime: 'edge' };

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://opcskuzbdfrlnyhraysk.supabase.co';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const MAX_EVENTS = 50; // hard cap per batch

// Internal/founder accounts whose traffic is excluded from analytics entirely
// (GA-style "internal traffic" exclusion) — they test the app constantly and
// would otherwise dominate the dashboard. Their events are never stored.
const INTERNAL_EMAILS = ['shanerutter@gmail.com'];

// Crawlers / bots / link-preview fetchers — never stored (they'd swamp the
// site-wide pageview counts). Client-side site-analytics.js also self-filters,
// but Googlebot renders JS, so we filter here too as the reliable backstop.
const BOT_RE = /bot|crawl|spider|slurp|mediapartners|googlebot|bingpreview|adsbot|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|facebookexternalhit|embedly|quora|whatsapp|telegram|slackbot|discordbot|preview|scrapy|python-requests|axios|node-fetch|go-http|curl|wget|phantomjs/i;

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors() });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SERVICE_KEY) return json({ error: 'Missing service key' }, 500);

  // Drop crawler/bot traffic outright.
  const ua = req.headers.get('user-agent') || '';
  if (BOT_RE.test(ua)) return json({ ok: true, bot: true, inserted: 0 });

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const events = Array.isArray(body.events) ? body.events : [];
  if (!events.length) return json({ ok: true, inserted: 0 });

  // Trusted user id from the bearer token (if any). Never from the body.
  let userId = null, userEmail = null;
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (token) {
    try {
      const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
      });
      if (u.ok) {
        const j = await u.json();
        userId    = j && j.id ? j.id : null;
        userEmail = j && j.email ? String(j.email).toLowerCase() : null;
      }
    } catch { /* treat as guest */ }
  }

  // Drop internal/founder traffic — don't even store it.
  if (userEmail && INTERNAL_EMAILS.includes(userEmail)) {
    return json({ ok: true, excluded: true, inserted: 0 });
  }

  const sid  = typeof body.session_id === 'string' ? body.session_id.slice(0, 64) : null;
  const vid  = typeof body.visitor_id === 'string' ? body.visitor_id.slice(0, 64) : null;
  const plat = typeof body.platform === 'string' ? body.platform.slice(0, 16) : null;
  const dev  = typeof body.device === 'string' ? body.device.slice(0, 16) : null;
  const surf = (body.surface === 'app' || body.surface === 'site') ? body.surface : null;
  // Geo from Vercel's edge request headers (free, no IP stored).
  const country = req.headers.get('x-vercel-ip-country') || null;
  const now  = Date.now();

  const rows = events.slice(0, MAX_EVENTS).map(e => ({
    user_id:    userId,
    session_id: sid,
    visitor_id: vid,
    event_name: String((e && (e.n || e.event_name)) || '').slice(0, 60),
    props:      (e && e.p && typeof e.p === 'object') ? e.p : {},
    path:       (e && typeof e.path === 'string') ? e.path.slice(0, 200) : null,
    platform:   plat,
    device:     dev,
    surface:    surf,
    country:    country,
    created_at: new Date((e && typeof e.t === 'number') ? e.t : now).toISOString(),
  })).filter(r => r.event_name);

  if (!rows.length) return json({ ok: true, inserted: 0 });

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/analytics_events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(rows),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('[track-event] insert failed', r.status, t.slice(0, 300));
      return json({ error: 'insert failed' }, r.status);
    }

    // Identity stitching: whenever an AUTHENTICATED batch arrives with a
    // visitor_id, backfill that visitor's earlier ANONYMOUS rows (same
    // visitor_id, no user_id) onto their account so the full pre-signup journey
    // is attributed. Triggering on any attributed batch (not a specific
    // "identify" event) makes this robust to client token-timing — the first
    // batch sent after auth completes does the stitch. Idempotent (only touches
    // null-user rows) and bounded to 30 days (avoids a long-shared device's history).
    if (userId && vid) {
      try {
        const since = new Date(now - 30 * 864e5).toISOString();
        await fetch(`${SUPABASE_URL}/rest/v1/analytics_events?visitor_id=eq.${encodeURIComponent(vid)}&user_id=is.null&created_at=gte.${since}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ user_id: userId }),
        });
      } catch (e) { /* best-effort stitch */ }
    }

    return json({ ok: true, inserted: rows.length });
  } catch (e) {
    console.error('[track-event] error', e && e.message);
    return json({ error: e && e.message }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  });
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
