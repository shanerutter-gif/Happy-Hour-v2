// api/admin-users.js — admin-JWT-gated proxy for the Supabase Auth admin API.
//
// The admin portal's Demo Data generator needs the auth admin endpoints
// (list / create / delete users), which require the service_role key. That key
// must never ship to the browser (docs/audit-2026-07.md S1), so this endpoint
// performs those calls server-side, gated exactly like api/admin-enrich-venues.js:
// Bearer user JWT → /auth/v1/user → ADMIN_EMAILS allow-list.
//
// Usage:
//   POST /api/admin-users { action:'list',   page:1 }                          → { users:[...] }
//   POST /api/admin-users { action:'create', email, password, user_metadata }  → created user
//   POST /api/admin-users { action:'delete', user_id }                         → { success:true }
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY.

export const config = { runtime: 'edge' };

const ADMIN_EMAILS = new Set(['shanerutter@gmail.com']);

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
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// ── auth (mirrors api/admin-enrich-venues.js) ────────
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
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server not configured' }, 500);

  const gate = await requireAdmin(req, supabaseUrl, serviceKey);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'Invalid JSON body' }, 400); }

  const svc = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

  try {
    if (body.action === 'list') {
      const page = Math.max(1, parseInt(body.page, 10) || 1);
      const r = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: svc });
      return json(await r.json(), r.status);
    }

    if (body.action === 'create') {
      if (!body.email || !body.password) return json({ error: 'email and password required' }, 400);
      const r = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: svc,
        body: JSON.stringify({
          email: body.email,
          password: body.password,
          email_confirm: body.email_confirm !== false,
          user_metadata: body.user_metadata || {},
        }),
      });
      return json(await r.json(), r.status);
    }

    if (body.action === 'delete') {
      if (!body.user_id) return json({ error: 'user_id required' }, 400);
      const r = await fetch(`${supabaseUrl}/auth/v1/admin/users/${body.user_id}`, {
        method: 'DELETE',
        headers: svc,
      });
      const text = await r.text();
      let data; try { data = text ? JSON.parse(text) : { success: r.ok }; } catch (e) { data = { success: r.ok }; }
      return json(data, r.status);
    }

    return json({ error: `Unknown action: ${body.action}` }, 400);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
