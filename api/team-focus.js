// api/team-focus.js — per-agent "current focus" store for the admin portal's
// Team page.
//
// GET  /api/team-focus                       (no auth, read-only)
//   → { ok:true, rows:[{agent,focus,status,updated_at}] }
//
// POST /api/team-focus
//   { token, agent, focus, status? }          (status: active|blocked|idle)
//   → { ok:true, agent } | { error }
//
// Auth: POST uses the shared token compared timing-safe against the
// AGENT_LOG_TOKEN env var (same token as /api/agent-log). The token grants
// ONLY upserts on public.agent_focus. A leaked token can at worst rewrite an
// agent's focus line — it cannot read, delete, or touch any other table.
// GET is public and read-only by design (low-sensitivity team status), so the
// Team page works without needing an RLS policy on agent_focus.
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, AGENT_LOG_TOKEN.

export const config = { runtime: 'edge' };

const AGENTS = new Set([
  'Maya', 'Ravi', 'Jess', 'Marcus',
  'Theo', 'Sofia', 'Priya',
  'Leo',
  'Kai', 'Nora',
  'Diego', 'Elena',
  'Sam', 'Jordan',
]);
const STATUSES = new Set(['active', 'blocked', 'idle']);

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

function svc() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  return {
    url: supabaseUrl,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
  };
}

export default async function handler(req) {
  const s = svc();
  if (!s) return json({ error: 'Server not configured' }, 500);

  // ── READ: all focus rows, no auth ──
  if (req.method === 'GET') {
    const r = await fetch(
      `${s.url}/rest/v1/agent_focus?select=agent,focus,status,updated_at&order=agent.asc`,
      { headers: s.headers }
    );
    if (!r.ok) {
      let detail = '';
      try { detail = await r.text(); } catch {}
      return json({ error: 'Read failed', upstream_status: r.status, detail: detail.slice(0, 300) }, 502);
    }
    let rows = [];
    try { rows = await r.json(); } catch {}
    return json({ ok: true, rows });
  }

  // ── WRITE: upsert one agent's focus ──
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const agentToken = process.env.AGENT_LOG_TOKEN;
  if (!agentToken) return json({ error: 'Server not configured' }, 500);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body || !timingSafeEqual(body.token, agentToken)) {
    return json({ error: 'Forbidden' }, 403);
  }

  const agent = typeof body.agent === 'string' ? body.agent.trim() : '';
  if (!AGENTS.has(agent)) return json({ error: 'Unknown agent' }, 400);

  const focus = typeof body.focus === 'string' ? body.focus.trim().slice(0, 280) : '';
  if (!focus) return json({ error: 'focus is required' }, 400);

  const status = typeof body.status === 'string' ? body.status.trim().toLowerCase() : 'active';
  if (!STATUSES.has(status)) return json({ error: 'Invalid status' }, 400);

  const row = { agent, focus, status, updated_at: new Date().toISOString() };
  const r = await fetch(`${s.url}/rest/v1/agent_focus?on_conflict=agent`, {
    method: 'POST',
    headers: { ...s.headers, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    let detail = '';
    try { detail = await r.text(); } catch {}
    return json({ error: 'Upsert failed', upstream_status: r.status, detail: detail.slice(0, 300) }, 502);
  }
  return json({ ok: true, agent });
}
