// api/stripe-billing-portal.js
// Creates a Stripe Customer Portal session so owners can manage/cancel billing
//
// Required Vercel env vars:
//   STRIPE_SECRET_KEY     — sk_live_... or sk_test_...
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
//   NEXT_PUBLIC_SITE_URL  — https://spotd.biz

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const { STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, NEXT_PUBLIC_SITE_URL } = process.env;
  if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return json({ error: 'Missing server configuration' }, 500);
  }

  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return json({ error: 'Unauthorized' }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { venueId } = body;
  if (!venueId) return json({ error: 'venueId required' }, 400);

  // Get stripe_customer_id from Supabase
  const venueRes = await fetch(
    `${SUPABASE_URL}/rest/v1/venues?id=eq.${venueId}&select=id,stripe_customer_id,subscription_tier`,
    {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${token}`,
      }
    }
  );
  const venues = await venueRes.json();
  const venue = Array.isArray(venues) ? venues[0] : null;

  if (!venue) return json({ error: 'Venue not found' }, 404);
  if (!venue.stripe_customer_id) return json({ error: 'No billing account found for this venue' }, 400);
  if (venue.subscription_tier === 'founding') {
    return json({ error: 'Founding partners do not have a billing account' }, 400);
  }

  // Create portal session
  const siteUrl = NEXT_PUBLIC_SITE_URL || 'https://spotd.biz';
  const params = new URLSearchParams({
    customer: venue.stripe_customer_id,
    return_url: `${siteUrl}/business-portal.html`,
  });

  const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const session = await res.json();
  if (session.error) return json({ error: session.error.message }, 400);

  return json({ url: session.url });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
