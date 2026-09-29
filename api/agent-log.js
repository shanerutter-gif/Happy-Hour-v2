// api/agent-log.js — write-only intake for Spotd's AI agents to log completed
// work to the Project Board (board_cards, the 'agents' board).
//
// POST /api/agent-log
//   { token, title, description?, type?, priority?, col? }
// → { ok:true, id } | { error }
//
// Auth: shared token compared timing-safe against the AGENT_LOG_TOKEN env var.
// The token grants ONLY card inserts on the 'agents' board (board is forced
// server-side; title/description lengths are capped). A leaked token can at
// worst spam the Agent Activity board — it cannot read, update, or delete
// anything, and it cannot touch any other table.
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, AGENT_LOG_TOKEN.

export const config = { runtime: 'edge' };

const BOARD = 'agents';
const COLS = new Set(['backlog', 'todo', 'inprogress', 'done', 'blocked']);
const TYPES = new Set(['feature', 'bug', 'chore', 'idea', 'design']);
const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);

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

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const agentToken = process.env.AGENT_LOG_TOKEN;
  if (!supabaseUrl || !serviceKey || !agentToken) {
    return json({ error: 'Server not configured' }, 500);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body || !timingSafeEqual(body.token, agentToken)) {
    return json({ error: 'Forbidden' }, 403);
  }

  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 160) : '';
  if (!title) return json({ error: 'title is required' }, 400);
  const description =
    typeof body.description === 'string' ? body.description.trim().slice(0, 4000) || null : null;
  const col = COLS.has(body.col) ? body.col : 'done';
  const type = TYPES.has(body.type) ? body.type : 'chore';
  const priority = PRIORITIES.has(body.priority) ? body.priority : 'medium';

  const card = { board: BOARD, col, type, priority, title, description, position: Date.now() };

  const r = await fetch(`${supabaseUrl}/rest/v1/board_cards`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(card),
  });
  if (!r.ok) return json({ error: 'Insert failed' }, 502);
  let rows = null;
  try {
    rows = await r.json();
  } catch {}
  return json({ ok: true, id: (rows && rows[0] && rows[0].id) || null });
}
