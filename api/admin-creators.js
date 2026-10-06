// api/admin-creators.js — admin-JWT-gated creator approval controls.
//
// One-click creator onboarding for the admin portal (Users page): set or
// clear the creator flags on a profile. Auth mirrors api/admin-users.js
// exactly — the service_role key must never ship to the browser
// (docs/audit-2026-07.md S1), so writes happen server-side here, gated on
// Bearer <redacted> JWT → /auth/v1/user → ADMIN_EMAILS allow-list.
//
// Usage:
//   POST /api/admin-creators { action:'set',   user_id, tier:'founding'|'verified' }
//     → PATCH profiles { is_creator:true, creator_tier:tier, creator_since:now }
//   POST /api/admin-creators { action:'clear', user_id }
//     → PATCH profiles { is_creator:false, creator_tier:null, creator_since:null }
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY.
//

export const config = { runtime: 'edge' };

const ADMIN_EMAILS = new Set(['shanerutter@gmail.com']);

export const CREATOR_TIERS = ['founding', 'verified'];

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

// ── auth (mirrors api/admin-users.js) ────────
async function requireAdmin(req, supabaseUrl, serviceKey) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return { ok: false, error: 'Missing Bearer <redacted>', status: 401 };
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

// ── pure logic (exported for the node test harness) ────────
// validateCreatorAction(body) → { ok:true, action, user_id, patch }
//                             | { ok:false, error }
export function validateCreatorAction(body = {}) {
  const action = body.action;
  const user_id = body.user_id;
  if (action !== 'set' && action !== 'clear') {
    return { ok: false, error: "action must be 'set' or 'clear'" };
  }
  if (!user_id || typeof user_id !== 'string') {
    return { ok: false, error: 'user_id is required' };
  }
  // UUID-shaped sanity check — rejects injection-y garbage early.
  if (!/^[0-9a-fA-F-]{8,64}$/.test(user_id)) {
    return { ok: false, error: 'user_id is malformed' };
  }
  if (action === 'set') {
    const tier = body.tier;
    if (!CREATOR_TIERS.includes(tier)) {
      return { ok: false, error: "tier must be 'founding' or 'verified'" };
    }
    return {
      ok: true, action, user_id, tier,
      patch: { is_creator: true, creator_tier: tier, creator_since: new Date().toISOString() },
    };
  }
  return {
    ok: true, action, user_id,
    patch: { is_creator: false, creator_tier: null, creator_since: null },
  };
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

  const v = validateCreatorAction(body);
  if (!v.ok) return json({ error: v.error }, 400);

  const svc = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
  const r = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(v.user_id)}`,
    { method: 'PATCH', headers: svc, body: JSON.stringify(v.patch) }
  );
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    return json({ error: `Profile update failed (${r.status})`, detail: t.slice(0, 200) }, 502);
  }
  const rows = await r.json().catch(() => []);
  if (!rows.length) return json({ error: 'Profile not found' }, 404);
  const p = rows[0];
  return json({
    success: true,
    profile: { id: p.id, is_creator: p.is_creator, creator_tier: p.creator_tier, creator_since: p.creator_since },
  });
}
