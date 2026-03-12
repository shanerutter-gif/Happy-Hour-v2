// api/stripe-webhook.js
// Handles Stripe webhook events to keep Supabase subscription state in sync
//
// Required Vercel env vars:
//   STRIPE_SECRET_KEY          — sk_live_... or sk_test_...
//   STRIPE_WEBHOOK_SECRET      — whsec_... (from Stripe webhook dashboard)
//   SUPABASE_URL               — https://opcskuzbdfrlnyhraysk.supabase.co
//   SUPABASE_SERVICE_KEY       — service_role key
//
// Stripe events handled:
//   checkout.session.completed          → activate pro
//   customer.subscription.updated       → sync status / period end
//   customer.subscription.deleted       → downgrade to free
//   invoice.payment_failed              → mark past_due
//   invoice.payment_succeeded           → ensure active

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

  if (!STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return new Response('Missing server configuration', { status: 500 });
  }

  // Verify Stripe signature
  const sig = req.headers.get('stripe-signature') || '';
  const rawBody = await req.text();

  let event;
  try {
    event = await verifyStripeSignature(rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  console.log(`[stripe-webhook] received: ${event.type}`);

  try {
    switch (event.type) {

      // ── Successful checkout → activate Pro ─────────────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription') break;
        const venueId = session.metadata?.venue_id;
        if (!venueId) { console.warn('No venue_id in session metadata'); break; }

        // Fetch the subscription to get period end
        const sub = await stripeGet(
          `https://api.stripe.com/v1/subscriptions/${session.subscription}`,
          STRIPE_SECRET_KEY
        );

        await updateVenue(venueId, {
          subscription_tier: 'pro',
          stripe_subscription_id: session.subscription,
          subscription_status: 'active',
          subscription_current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        }, SUPABASE_URL, SUPABASE_SERVICE_KEY);

        console.log(`[stripe-webhook] activated pro for venue ${venueId}`);
        break;
      }

      // ── Subscription updated (renewal, plan change, etc.) ───────────────
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const venueId = sub.metadata?.venue_id;
        if (!venueId) { console.warn('No venue_id in subscription metadata'); break; }

        const isActive = sub.status === 'active' || sub.status === 'trialing';
        await updateVenue(venueId, {
          subscription_tier: isActive ? 'pro' : 'free',
          subscription_status: sub.status,
          subscription_current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        }, SUPABASE_URL, SUPABASE_SERVICE_KEY);

        console.log(`[stripe-webhook] updated subscription for venue ${venueId}: ${sub.status}`);
        break;
      }

      // ── Subscription cancelled / expired → downgrade to free ───────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const venueId = sub.metadata?.venue_id;
        if (!venueId) { console.warn('No venue_id in subscription metadata'); break; }

        await updateVenue(venueId, {
          subscription_tier: 'free',
          subscription_status: 'canceled',
          stripe_subscription_id: null,
          subscription_current_period_end: null,
        }, SUPABASE_URL, SUPABASE_SERVICE_KEY);

        console.log(`[stripe-webhook] canceled pro for venue ${venueId}`);
        break;
      }

      // ── Payment failed → mark past_due (don't remove access immediately) ─
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subId = invoice.subscription;
        if (!subId) break;

        // Look up venue by stripe_subscription_id
        const venueId = await findVenueBySubscription(subId, SUPABASE_URL, SUPABASE_SERVICE_KEY);
        if (!venueId) break;

        await updateVenue(venueId, {
          subscription_status: 'past_due',
          // Keep tier = 'pro' for now — Stripe will retry and send subscription.deleted if it fails
        }, SUPABASE_URL, SUPABASE_SERVICE_KEY);

        console.log(`[stripe-webhook] payment failed for venue ${venueId}`);
        break;
      }

      // ── Payment succeeded (renewal) → ensure active ─────────────────────
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        if (invoice.billing_reason === 'subscription_create') break; // already handled by checkout.session.completed
        const subId = invoice.subscription;
        if (!subId) break;

        const venueId = await findVenueBySubscription(subId, SUPABASE_URL, SUPABASE_SERVICE_KEY);
        if (!venueId) break;

        const sub = await stripeGet(
          `https://api.stripe.com/v1/subscriptions/${subId}`,
          STRIPE_SECRET_KEY
        );

        await updateVenue(venueId, {
          subscription_tier: 'pro',
          subscription_status: 'active',
          subscription_current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        }, SUPABASE_URL, SUPABASE_SERVICE_KEY);

        console.log(`[stripe-webhook] renewal succeeded for venue ${venueId}`);
        break;
      }

      default:
        // Ignore other events
        break;
    }
  } catch (err) {
    console.error('[stripe-webhook] handler error:', err);
    return new Response(`Handler error: ${err.message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Supabase helpers ─────────────────────────────────────────────────────────

async function updateVenue(venueId, fields, supabaseUrl, serviceKey) {
  const res = await fetch(`${supabaseUrl}/rest/v1/venues?id=eq.${venueId}`, {
    method: 'PATCH',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase update failed: ${text}`);
  }
}

async function findVenueBySubscription(stripeSubscriptionId, supabaseUrl, serviceKey) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/venues?stripe_subscription_id=eq.${stripeSubscriptionId}&select=id`,
    {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      }
    }
  );
  const data = await res.json();
  return Array.isArray(data) && data[0] ? data[0].id : null;
}

// ── Stripe helpers ───────────────────────────────────────────────────────────

async function stripeGet(url, secretKey) {
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${secretKey}` }
  });
  return res.json();
}

// ── Stripe webhook signature verification (HMAC-SHA256) ─────────────────────
// Implements https://stripe.com/docs/webhooks/signatures without the SDK

async function verifyStripeSignature(payload, sigHeader, secret) {
  // sigHeader format: t=timestamp,v1=signature,v1=signature...
  const parts = Object.fromEntries(
    sigHeader.split(',').map(p => {
      const idx = p.indexOf('=');
      return [p.slice(0, idx), p.slice(idx + 1)];
    })
  );

  const timestamp = parts['t'];
  const signatures = sigHeader
    .split(',')
    .filter(p => p.startsWith('v1='))
    .map(p => p.slice(3));

  if (!timestamp || signatures.length === 0) {
    throw new Error('Invalid signature header');
  }

  // Check timestamp tolerance (5 min)
  const tolerance = 300;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > tolerance) {
    throw new Error('Timestamp outside tolerance');
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(signedPayload);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  const expectedSig = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const isValid = signatures.some(sig => sig === expectedSig);
  if (!isValid) throw new Error('Signature mismatch');

  // Parse and return the event
  return JSON.parse(payload);
}
