export const config = { runtime: 'edge' };

// Web Push requires these headers for the VAPID protocol
const VAPID_PUBLIC_KEY  = 'BMkbnu3qwis5D-0GOq1boIfSjvfis991VIeFerO6go9bH0M3AMpbSHmYHXqnlfVVBpC_fU8YMn3skSdQId6ZKtc';

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders() });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Auth: require a secret key so only your backend/cron can call this
  const authHeader = req.headers.get('authorization');
  const expectedKey = process.env.PUSH_API_KEY;
  if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const supabaseUrl     = process.env.SUPABASE_URL;
  const supabaseKey     = process.env.SUPABASE_SERVICE_KEY;

  if (!vapidPrivateKey || !supabaseUrl || !supabaseKey) {
    return json({ error: 'Missing env vars' }, 500);
  }

  let body;
  try { body = await req.json(); } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { user_ids, title, body: msgBody, url, tag } = body;
  if (!title || !msgBody) {
    return json({ error: 'title and body are required' }, 400);
  }

  // Fetch push tokens from Supabase
  let query = `${supabaseUrl}/rest/v1/push_tokens?select=token,platform`;
  if (user_ids?.length) {
    query += `&user_id=in.(${user_ids.join(',')})`;
  }

  const tokensRes = await fetch(query, {
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
    },
  });
  const tokens = await tokensRes.json();

  if (!tokens?.length) {
    return json({ sent: 0, message: 'No tokens found' });
  }

  const payload = JSON.stringify({ title, body: msgBody, data: { url: url || '/' }, tag: tag || 'spotd' });

  let sent = 0;
  const errors = [];

  for (const { token, platform } of tokens) {
    try {
      if (platform === 'web') {
        await sendWebPush(token, payload, vapidPrivateKey);
        sent++;
      } else if (platform === 'ios') {
        // iOS APNs — requires APNs auth key configured separately
        // For now, log and skip; APNs integration can be added later
        errors.push({ platform, error: 'APNs not yet configured' });
      }
    } catch (e) {
      errors.push({ platform, error: e.message });
    }
  }

  return json({ sent, total: tokens.length, errors: errors.length ? errors : undefined });
}

// ── Web Push via raw fetch (no npm dependency needed in edge runtime) ──
async function sendWebPush(subscriptionJson, payload, privateKeyBase64) {
  const subscription = JSON.parse(subscriptionJson);
  const endpoint = subscription.endpoint;

  // Import the VAPID private key for signing
  const privateKeyBytes = base64UrlToBytes(privateKeyBase64);

  // Create JWT for VAPID authentication
  const jwt = await createVapidJwt(endpoint, privateKeyBytes);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type':     'application/json',
      'Authorization':    `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`,
      'TTL':              '86400',
    },
    body: payload,
  });

  if (!res.ok) {
    throw new Error(`Push failed: ${res.status} ${await res.text()}`);
  }
}

async function createVapidJwt(endpoint, privateKeyBytes) {
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour

  const header  = { typ: 'JWT', alg: 'ES256' };
  const claims  = { aud, exp, sub: 'mailto:hello@spotd.biz' };

  const headerB64  = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const claimsB64  = btoa(JSON.stringify(claims)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsigned   = `${headerB64}.${claimsB64}`;

  // Import the EC private key
  const key = await crypto.subtle.importKey(
    'pkcs8',
    ecPrivateKeyToPkcs8(privateKeyBytes),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned)
  );

  // Convert DER signature to raw r||s
  const rawSig = derToRaw(new Uint8Array(sig));
  const sigB64 = bytesToBase64Url(rawSig);

  return `${unsigned}.${sigB64}`;
}

// Convert a 32-byte raw EC private key to PKCS8 DER format
function ecPrivateKeyToPkcs8(rawKey) {
  // PKCS8 header for P-256 EC key
  const header = new Uint8Array([
    0x30, 0x81, 0x87, 0x02, 0x01, 0x00, 0x30, 0x13,
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
    0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d,
    0x03, 0x01, 0x07, 0x04, 0x6d, 0x30, 0x6b, 0x02,
    0x01, 0x01, 0x04, 0x20
  ]);
  const footer = new Uint8Array([
    0xa1, 0x44, 0x03, 0x42, 0x00
  ]);
  // We omit the public key portion — crypto.subtle can derive it
  const result = new Uint8Array(header.length + rawKey.length);
  result.set(header);
  result.set(rawKey, header.length);
  return result.buffer;
}

function derToRaw(der) {
  // DER encoded ECDSA signature to raw 64-byte r||s
  // Simple parser for the common case
  const raw = new Uint8Array(64);
  let offset = 2; // skip 0x30 + length
  // r
  offset++; // 0x02
  let rLen = der[offset++];
  const rStart = rLen === 33 ? offset + 1 : offset;
  raw.set(der.slice(rStart, rStart + 32), 0);
  offset += rLen;
  // s
  offset++; // 0x02
  let sLen = der[offset++];
  const sStart = sLen === 33 ? offset + 1 : offset;
  raw.set(der.slice(sStart, sStart + 32), 32);
  return raw;
}

function base64UrlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - b64.length % 4) % 4);
  const binary = atob(b64 + padding);
  return Uint8Array.from([...binary].map(c => c.charCodeAt(0)));
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
