// api/metrics-ingest.js — write-only intake for the analytics dashboards'
// daily metric pulls (Instagram, TikTok Studio, Loops).
//
// POST /api/metrics-ingest
//   Headers: x-ingest-token: <METRICS_INGEST_TOKEN>
//   Body: { table: 'social_daily_metrics'|'social_post_metrics'
//                  |'email_daily_metrics'|'email_campaigns',
//           rows: [ {...}, ... ] }
//   → { ok:true, table, written:<n> } | { error }
//
// Auth: shared token in the x-ingest-token header, compared timing-safe
// against the METRICS_INGEST_TOKEN env var (mirrors AGENT_LOG_TOKEN).
// 401 when the token is wrong/missing; 500 with a clear message when the
// env var is not set at all. A leaked token can at worst rewrite analytics
// rows — it cannot read, delete, or touch any other table.
//
// Writes use the service-role key server-side (bypasses RLS); the four
// tables have admin-read-only RLS policies (see
// sql/analytics-dashboards-20261005.sql).
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, METRICS_INGEST_TOKEN.

export const config = { runtime: 'edge' };

// table → PostgREST on_conflict columns + allowed column allowlist
const TABLES = {
  social_daily_metrics: {
    onConflict: 'day,platform',
    columns: new Set(['day', 'platform', 'followers', 'views', 'reach',
      'interactions', 'profile_visits', 'posts_published', 'collected_at']),
  },
  social_post_metrics: {
    onConflict: 'platform,post_id',
    columns: new Set(['platform', 'post_id', 'posted_at', 'url',
      'caption_snippet', 'views', 'likes', 'comments', 'shares', 'collected_at']),
  },
  email_daily_metrics: {
    onConflict: 'day,workflow',
    columns: new Set(['day', 'workflow', 'sends', 'opens', 'clicks',
      'unsubscribes', 'bounces', 'collected_at']),
  },
  email_campaigns: {
    onConflict: 'provider_id',
    columns: new Set(['provider_id', 'name', 'subject', 'sent_at', 'sends',
      'opens', 'clicks', 'unsubscribes', 'bounces', 'collected_at']),
  },
};

const MAX_ROWS = 500;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Constant-time string compare (TextEncoder is available in the edge runtime).
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const expected = process.env.METRICS_INGEST_TOKEN;
  if (!expected) {
    return json({ error: 'Server not configured: METRICS_INGEST_TOKEN is not set' }, 500);
  }
  const provided = req.headers.get('x-ingest-token');
  if (!timingSafeEqual(provided, expected)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Server not configured: SUPABASE_URL / SUPABASE_SERVICE_KEY missing' }, 500);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const spec = body && TABLES[body.table];
  if (!spec) {
    return json({ error: `Unknown table. Allowed: ${Object.keys(TABLES).join(', ')}` }, 400);
  }
  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return json({ error: 'rows must be a non-empty array' }, 400);
  }
  if (body.rows.length > MAX_ROWS) {
    return json({ error: `rows exceeds max of ${MAX_ROWS}` }, 400);
  }

  // Strip unknown columns so a sloppy puller can't 400 the whole batch.
  // Stamp collected_at server-side when the puller didn't.
  const now = new Date().toISOString();
  const clean = [];
  for (const r of body.rows) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      return json({ error: 'each row must be an object' }, 400);
    }
    const c = {};
    for (const k of Object.keys(r)) {
      if (spec.columns.has(k)) c[k] = r[k];
    }
    if (!('collected_at' in c)) c.collected_at = now;
    clean.push(c);
  }

  const svcHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates',
  };

  const r = await fetch(
    `${supabaseUrl}/rest/v1/${body.table}?on_conflict=${spec.onConflict}`,
    { method: 'POST', headers: svcHeaders, body: JSON.stringify(clean) }
  );
  if (!r.ok) {
    let detail = '';
    try { detail = await r.text(); } catch {}
    return json({ error: 'Upsert failed', upstream_status: r.status, detail: detail.slice(0, 500) }, 502);
  }
  return json({ ok: true, table: body.table, written: clean.length });
}
