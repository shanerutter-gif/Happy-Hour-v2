// api/analytics-rollup.js — daily retention job for the in-house analytics.
// Rolls recent raw events into analytics_daily (long-term trend summary) and
// prunes raw analytics_events older than the retention window so the table
// stays bounded as site-wide traffic grows. Runs on a Vercel cron.
//
// Auth (mirrors the other crons): Bearer ${CRON_SECRET} (Vercel Cron) OR
// ?key=<SERVICE_ROLE_KEY> (manual trigger). The actual work is the
// service-role-only Postgres fn ae_rollup_and_prune().

export const config = { runtime: 'edge' };

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://opcskuzbdfrlnyhraysk.supabase.co';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const RETENTION_DAYS = 180; // raw events kept this long; older rows pruned after rollup

export default async function handler(req) {
  const url  = new URL(req.url);
  const key  = url.searchParams.get('key');
  const auth = req.headers.get('authorization') || '';
  const okCron = CRON_SECRET && auth === `Bearer ${CRON_SECRET}`;
  const okKey  = SERVICE_KEY && key === SERVICE_KEY;
  if (!okCron && !okKey) return json({ error: 'Unauthorized' }, 401);
  if (!SERVICE_KEY) return json({ error: 'Missing service key' }, 500);

  const retention = parseInt(url.searchParams.get('retention_days') || String(RETENTION_DAYS), 10) || RETENTION_DAYS;

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ae_rollup_and_prune`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ p_retention_days: retention, p_recent_days: 3 }),
    });
    const text = await r.text();
    if (!r.ok) {
      console.error('[analytics-rollup] rpc failed', r.status, text.slice(0, 300));
      return json({ error: 'rollup failed', detail: text.slice(0, 300) }, r.status);
    }
    let result; try { result = JSON.parse(text); } catch { result = text; }
    return json({ success: true, result });
  } catch (e) {
    console.error('[analytics-rollup] error', e && e.message);
    return json({ error: e && e.message }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
