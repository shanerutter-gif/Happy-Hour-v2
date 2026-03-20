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

  const vapidPrivateKey  = process.env.VAPID_PRIVATE_KEY;
  const supabaseUrl      = process.env.SUPABASE_URL;
  const supabaseKey      = process.env.SUPABASE_SERVICE_KEY;
  const apnsKeyBase64    = process.env.APNS_KEY_BASE64;    // .p8 key contents, base64-encoded
  const apnsKeyId        = process.env.APNS_KEY_ID;        // 10-char key ID from Apple
  const apnsTeamId       = process.env.APNS_TEAM_ID;       // Apple Developer Team ID
  const apnsBundleId     = process.env.APNS_BUNDLE_ID || 'biz.spotd.app';

  if (!supabaseUrl || !supabaseKey) {
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
        if (!vapidPrivateKey) { errors.push({ platform, error: 'VAPID_PRIVATE_KEY not set' }); continue; }
        await sendWebPush(token, payload, vapidPrivateKey);
        sent++;
      } else if (platform === 'ios' || platform === 'native') {
        if (!apnsKeyBase64 || !apnsKeyId || !apnsTeamId) {
          errors.push({ platform, error: 'APNs env vars not configured' });
          continue;
        }
        await sendApnsPush(token, { title, body: msgBody, url: url || '/', tag: tag || 'spotd' }, {
          keyBase64: apnsKeyBase64, keyId: apnsKeyId, teamId: apnsTeamId, bundleId: apnsBundleId,
        });
        sent++;
      }
    } catch (e) {
      errors.push({ platform, error: e.message });
    }
  }

  return json({ sent, total: tokens.length, errors: errors.length ? errors : undefined });
}

// ── APNs Push (iOS) via HTTP/2-compatible fetch ──
async function sendApnsPush(deviceToken, { title, body, url, tag }, { keyBase64, keyId, teamId, bundleId }) {
  const jwt = await createApnsJwt(keyBase64, keyId, teamId);
  const apnsPayload = JSON.stringify({
    aps: {
      alert: { title, body },
      sound: 'default',
      badge: 1,
      'mutable-content': 1,
    },
    url: url || '/',
    tag: tag || 'spotd',
  });

  // Use production APNs endpoint
  const endpoint = `https://api.push.apple.com/3/device/${deviceToken}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'authorization': `bearer ${jwt}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': '0',
      'content-type': 'application/json',
    },
    body: apnsPayload,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`APNs failed: ${res.status} ${errBody}`);
  }
}

async function createApnsJwt(keyBase64, keyId, teamId) {
  // Decode the .p8 key (PEM-encoded ES256 private key, base64-wrapped)
  const keyPem = atob(keyBase64);
  const pemBody = keyPem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const keyBytes = base64UrlToBytes(
    pemBody.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  );

  const header = { alg: 'ES256', kid: keyId };
  const claims = { iss: teamId, iat: Math.floor(Date.now() / 1000) };

  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const claimsB64 = btoa(JSON.stringify(claims)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsigned = `${headerB64}.${claimsB64}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes.buffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned)
  );

  const rawSig = derToRaw(new Uint8Array(sig));
  const sigB64 = bytesToBase64Url(rawSig);
  return `${unsigned}.${sigB64}`;
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

// Convert a 32-byte raw EC private key to PKCS8 DER format (without public key)
function ecPrivateKeyToPkcs8(rawKey) {
  const header = new Uint8Array([
    0x30, 0x41,       // SEQUENCE (65 bytes)
    0x02, 0x01, 0x00, // INTEGER 0 (version)
    0x30, 0x13,       // SEQUENCE (19 bytes - AlgorithmIdentifier)
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, // OID ecPublicKey
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, // OID P-256
    0x04, 0x27,       // OCTET STRING (39 bytes)
    0x30, 0x25,       // SEQUENCE (37 bytes - ECPrivateKey)
    0x02, 0x01, 0x01, // INTEGER 1 (version)
    0x04, 0x20        // OCTET STRING (32 bytes - private key data follows)
  ]);
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
