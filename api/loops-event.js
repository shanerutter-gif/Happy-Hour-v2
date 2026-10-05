export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders() });
  if (req.method !== 'POST') return jsonRes({ error: 'Method not allowed' }, 405);

  const loopsKey = process.env.LOOPS_API_KEY;
  if (!loopsKey) return jsonRes({ error: 'Missing LOOPS_API_KEY' }, 500);

  let body;
  try { body = await req.json(); } catch { return jsonRes({ error: 'Invalid JSON' }, 400); }

  const { email, eventName, properties } = body;
  if (!email || !eventName) return jsonRes({ error: 'email and eventName required' }, 400);

  try {
    const r = await fetch('https://app.loops.so/api/v1/events/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${loopsKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        eventName,
        eventProperties: properties || {},
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error(`[Loops] Event "${eventName}" failed:`, r.status, err);
      return jsonRes({ error: 'Event send failed', detail: err }, r.status);
    }

    // Optional first-party analytics mirror: insert the lifecycle event into
    // analytics_events attributed to the OWNER (userId), so owner triggers are
    // visible in the admin Traffic Analytics dashboards, not just in Loops.
    // Used by callers whose own session must NOT own the event (e.g. the admin
    // approving a claim in admin-claims.js — the approver's internal session
    // would otherwise misattribute or drop the row). Fire-and-forget: never
    // fails the Loops send.
    //   mirror: { userId, eventName, props?, path?, platform? }
    const mirror = body.mirror;
    if (mirror && mirror.userId && mirror.eventName) {
      mirrorAnalyticsEvent(mirror).catch(e =>
        console.error('[Loops] analytics mirror failed:', e.message));
    }

    return jsonRes({ success: true });
  } catch (e) {
    console.error('[Loops] Error:', e.message);
    return jsonRes({ error: e.message }, 500);
  }
}

// Service-role insert into analytics_events. Exported for unit tests.
export async function mirrorAnalyticsEvent(mirror) {
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://opcskuzbdfrlnyhraysk.supabase.co';
  if (!svcKey) { console.error('[Loops] mirror skipped: missing SUPABASE_SERVICE_ROLE_KEY'); return; }
  const props = (mirror.props && typeof mirror.props === 'object') ? mirror.props : {};
  const r = await fetch(`${supabaseUrl}/rest/v1/analytics_events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': svcKey,
      'Authorization': `Bearer ${svcKey}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify([{
      user_id:    mirror.userId,
      event_name: String(mirror.eventName).slice(0, 60),
      props,
      path:      typeof mirror.path === 'string' ? mirror.path.slice(0, 200) : null,
      platform:  typeof mirror.platform === 'string' ? mirror.platform.slice(0, 16) : 'web',
    }]),
  });
  if (!r.ok) console.error('[Loops] mirror insert failed:', r.status, (await r.text()).slice(0, 200));
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
