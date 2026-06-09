export const config = { runtime: 'edge' };

// Updates custom properties on an existing Loops contact.
// Mirrors api/loops-event.js: accepts { email, properties } and calls the
// Loops contacts/update endpoint. Used to flip userGroup -> "activated" on a
// user's first check-in, but generic for any contact-property update.

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders() });
  if (req.method !== 'POST') return jsonRes({ error: 'Method not allowed' }, 405);

  const loopsKey = process.env.LOOPS_API_KEY;
  if (!loopsKey) return jsonRes({ error: 'Missing LOOPS_API_KEY' }, 500);

  let body;
  try { body = await req.json(); } catch { return jsonRes({ error: 'Invalid JSON' }, 400); }

  const { email, properties } = body;
  if (!email) return jsonRes({ error: 'email required' }, 400);

  try {
    const r = await fetch('https://app.loops.so/api/v1/contacts/update', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${loopsKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        ...(properties || {}),
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error('[Loops] Contact update failed:', r.status, err);
      return jsonRes({ error: 'Contact update failed', detail: err }, r.status);
    }

    return jsonRes({ success: true });
  } catch (e) {
    console.error('[Loops] Error:', e.message);
    return jsonRes({ error: e.message }, 500);
  }
}

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
