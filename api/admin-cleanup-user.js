// api/admin-cleanup-user.js — admin-JWT-gated removal of one user's test data.
//
// Built 2026-10-12 for the QA-3 cleanup (Shane: "make team do it"). Deletes,
// for ONE explicitly supplied user_id only:
//   - check_ins rows at the supplied venue_ids
//   - activity_feed rows for that user
//   - user_badges rows for that user
// Nothing else is touched; there is no list/wildcard mode. Gated exactly like
// api/admin-users.js: Bearer user JWT → /auth/v1/user → ADMIN_EMAILS allow-list.
// All DB calls use the service_role key server-side (never shipped to browser).
//
// Usage (from the signed-in admin portal console):
//   POST /api/admin-cleanup-user { action:'count',  user_id, venue_ids:[...] }
//   POST /api/admin-cleanup-user { action:'delete', user_id, venue_ids:[...], confirm:user_id }
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY.

export const config = { runtime: 'edge' };

const ADMIN_EMAILS = new Set(['shanerutter@gmail.com']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
function corsPreflight() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

async function requireAdmin(req, supabaseUrl, serviceKey) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return { ok: false, error: 'Missing Bearer token', status: 401 };
  const token = auth.slice(7);
  const ures = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
  });
  if (!ures.ok) return { ok: false, error: 'Invalid session', status: 401 };
  const user = await ures.json();
  if (!user?.email || !ADMIN_EMAILS.has(user.email.toLowerCase())) {
    return { ok: false, error: 'Forbidden', status: 403 };
  }
  return { ok: true, user };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return corsPreflight();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server not configured' }, 500);

  const gate = await requireAdmin(req, supabaseUrl, serviceKey);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'Invalid JSON body' }, 400); }

  const userId = body.user_id;
  if (!userId || !UUID_RE.test(userId)) return json({ error: 'valid user_id (uuid) required' }, 400);
  const venueIds = Array.isArray(body.venue_ids) ? body.venue_ids.filter(v => UUID_RE.test(v)) : [];
  if (!venueIds.length) return json({ error: 'venue_ids (non-empty uuid array) required' }, 400);

  const svc = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  const venueList = venueIds.map(v => `"${v}"`).join(',');

  async function countRows() {
    const specs = [
      ['check_ins', `check_ins?user_id=eq.${userId}&venue_id=in.(${venueList})&select=id`],
      ['check_ins_all_for_user', `check_ins?user_id=eq.${userId}&select=id`],
      ['activity_feed', `activity_feed?user_id=eq.${userId}&select=id`],
      ['user_badges', `user_badges?user_id=eq.${userId}&select=id`],
    ];
    const out = {};
    for (const [name, path] of specs) {
      const r = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
        headers: { ...svc, Prefer: 'count=exact', Range: '0-0' },
      });
      if (!r.ok) throw new Error(`count ${name} failed: ${r.status} ${await r.text()}`);
      const cr = r.headers.get('content-range') || '';
      out[name] = parseInt((cr.split('/')[1] || '0'), 10);
    }
    return out;
  }

  async function deleteRows(path) {
    const r = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      method: 'DELETE',
      headers: { ...svc, Prefer: 'return=representation' },
    });
    if (!r.ok) throw new Error(`delete ${path.split('?')[0]} failed: ${r.status} ${await r.text()}`);
    const rows = await r.json();
    return rows.length;
  }

  try {
    if (body.action === 'count') {
      return json({ user_id: userId, venue_ids: venueIds, counts: await countRows() });
    }

    if (body.action === 'delete') {
      // Guard: caller must echo the exact user_id as `confirm`.
      if (body.confirm !== userId) return json({ error: 'confirm must equal user_id' }, 400);
      const before = await countRows();
      const deleted = {};
      deleted.activity_feed = await deleteRows(`activity_feed?user_id=eq.${userId}&select=id`);
      deleted.user_badges = await deleteRows(`user_badges?user_id=eq.${userId}&select=id`);
      deleted.check_ins = await deleteRows(`check_ins?user_id=eq.${userId}&venue_id=in.(${venueList})&select=id`);
      const after = await countRows();
      return json({ user_id: userId, venue_ids: venueIds, before, deleted, after });
    }

    return json({ error: `Unknown action: ${body.action}` }, 400);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
