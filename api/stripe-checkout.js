// api/stripe-checkout.js
// Creates a Stripe Checkout session for a venue Pro upgrade
//
// Required Vercel env vars:
//   STRIPE_SECRET_KEY          — sk_live_... or sk_test_...
//   STRIPE_PRO_PRICE_ID        — price_... (create $49/mo recurring in Stripe dashboard)
//   SUPABASE_URL               — https://opcskuzbdfrlnyhraysk.supabase.co
//   SUPABASE_SERVICE_KEY       — service_role key (NOT anon key)
//   NEXT_PUBLIC_SITE_URL       — https://spotd.biz

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const {
    STRIPE_SECRET_KEY,
    STRIPE_PRO_PRICE_ID,
    SUPABASE_URL,
    SUPABASE_SERVICE_KEY,
    NEXT_PUBLIC_SITE_URL,
  } = process.env;

  if (!STRIPE_SECRET_KEY || !STRIPE_PRO_PRICE_ID || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return json({ error: 'Missing server configuration' }, 500);
  }

  // Verify the user is authenticated
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return json({ error: 'Unauthorized' }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { venueId } = body;
  if (!venueId) return json({ error: 'venueId required' }, 400);

  // 1. Verify the calling user actually owns this venue
  const venueRes = await fetch(
    `${SUPABASE_URL}/rest/v1/venues?id=eq.${venueId}&select=id,name,owner_id,stripe_customer_id,subscription_tier`,
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
  if (venue.subscription_tier === 'founding') {
    return json({ error: 'Founding partners do not need a subscription' }, 400);
  }

  // 2. Resolve or create Stripe customer
  let stripeCustomerId = venue.stripe_customer_id;

  if (!stripeCustomerId) {
    // Get user email from Supabase auth
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${token}` }
    });
    const user = await userRes.json();
    const email = user?.email || '';

    // Create Stripe customer
    const custRes = await stripePost('https://api.stripe.com/v1/customers', {
      email,
      metadata: { venue_id: venueId, supabase_user_id: user?.id || '' },
      description: `Spotd venue: ${venue.name}`,
    }, STRIPE_SECRET_KEY);

    if (custRes.error) return json({ error: custRes.error.message }, 400);
    stripeCustomerId = custRes.id;

    // Save customer ID to Supabase
    await fetch(`${SUPABASE_URL}/rest/v1/venues?id=eq.${venueId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ stripe_customer_id: stripeCustomerId }),
    });
  }

  // 3. Create Checkout session
  const siteUrl = NEXT_PUBLIC_SITE_URL || 'https://spotd.biz';
  const session = await stripePost('https://api.stripe.com/v1/checkout/sessions', {
    customer: stripeCustomerId,
    mode: 'subscription',
    line_items: [{ price: STRIPE_PRO_PRICE_ID, quantity: 1 }],
    success_url: `${siteUrl}/business-portal.html?upgraded=true&venue=${venueId}`,
    cancel_url: `${siteUrl}/business-portal.html?canceled=true&venue=${venueId}`,
    subscription_data: {
      metadata: { venue_id: venueId },
    },
    metadata: { venue_id: venueId },
    allow_promotion_codes: true,
  }, STRIPE_SECRET_KEY);

  if (session.error) return json({ error: session.error.message }, 400);

  return json({ url: session.url });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

async function stripePost(url, params, secretKey) {
  // Stripe API uses application/x-www-form-urlencoded
  const body = toFormData(params);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  return res.json();
}

function toFormData(obj, prefix = '') {
  const parts = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      parts.push(toFormData(value, fullKey));
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => parts.push(`${fullKey}[${i}]=${encodeURIComponent(v)}`));
    } else {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.join('&');
}
