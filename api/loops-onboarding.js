export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders() });
  }
  if (req.method !== 'POST') return jsonRes({ error: 'Method not allowed' }, 405);

  const loopsKey = process.env.LOOPS_API_KEY;
  if (!loopsKey) return jsonRes({ error: 'Missing LOOPS_API_KEY' }, 500);

  let body;
  try { body = await req.json(); } catch { return jsonRes({ error: 'Invalid JSON' }, 400); }

  const { email, firstName, userId, source } = body;
  if (!email) return jsonRes({ error: 'Email required' }, 400);

  const loopsHeaders = {
    'Authorization': `Bearer ${loopsKey}`,
    'Content-Type': 'application/json',
  };

  try {
    // 1. Create or update contact in Loops
    const contactRes = await fetch('https://app.loops.so/api/v1/contacts/create', {
      method: 'POST',
      headers: loopsHeaders,
      body: JSON.stringify({
        email,
        firstName: firstName || email.split('@')[0],
        userId: userId || undefined,
        source: source || 'app',
        userGroup: 'new-signup',
      }),
    });

    // 409 = contact exists, that's fine (idempotent)
    if (!contactRes.ok && contactRes.status !== 409) {
      const err = await contactRes.text();
      console.error('[Loops] Contact create failed:', contactRes.status, err);
      return jsonRes({ error: 'Failed to create contact', detail: err }, contactRes.status);
    }

    // 2. Send the signup event to trigger the onboarding Loop
    const eventRes = await fetch('https://app.loops.so/api/v1/events/send', {
      method: 'POST',
      headers: loopsHeaders,
      body: JSON.stringify({
        email,
        eventName: 'signup',
      }),
    });

    if (!eventRes.ok) {
      const err = await eventRes.text();
      console.error('[Loops] Event send failed:', eventRes.status, err);
      return jsonRes({ error: 'Failed to send event', detail: err }, eventRes.status);
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
