export const config = { runtime: 'edge' };

// Web Push requires these headers for the VAPID protocol
const VAPID_PUBLIC_KEY  = 'BMW9ZANN8ywdnRhtDWmd5haZ9mwI4Dr8n28hO67aNy60h3WPOmGaElvseWgSj9zfw9geaqR5gbVUfMPQ9VvrjfU';

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

  const { user_ids, title, body: msgBody, url, tag, sandbox } = body;
  if (!title || !msgBody) {
    return json({ error: 'title and body are required' }, 400);
  }

  // Fetch push tokens from Supabase. Web platform is currently excluded
  // (see continue in the loop below); pre-filter so denominators are honest.
  let query = `${supabaseUrl}/rest/v1/push_tokens?select=token,platform&platform=in.(ios,native)`;
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
    // Token tag — first 8 chars of the device token (or endpoint host for web)
    // — included in error messages so the admin UI can tell which device failed.
    let tag_id;
    try {
      tag_id = platform === 'web'
        ? (() => { try { return new URL(JSON.parse(token).endpoint).host; } catch { return 'web'; } })()
        : (token || '').slice(0, 8);
    } catch { tag_id = 'unknown'; }

    try {
      if (platform === 'web') {
        // Web push currently disabled — VAPID keypair mismatch with the
        // hardcoded public key. iOS-only deployment, so skip cleanly
        // rather than logging noisy 403s for every trigger.
        continue;
      } else if (platform === 'ios' || platform === 'native') {
        if (!apnsKeyBase64 || !apnsKeyId || !apnsTeamId) {
          errors.push({ platform, tag: tag_id, error: 'APNs env vars not configured' });
          continue;
        }
        await sendApnsPush(token, { title, body: msgBody, url: url || '/', tag: tag || 'spotd' }, {
          keyBase64: apnsKeyBase64, keyId: apnsKeyId, teamId: apnsTeamId, bundleId: apnsBundleId, sandbox: !!sandbox,
        });
        sent++;
      }
    } catch (e) {
      // Capture as much diagnostic info as we can — many push failures
      // surface as opaque "Network connection lost" without name/code.
      const detail = [
        e.name || 'Error',
        e.message || 'unknown',
        e.cause ? `(cause: ${e.cause.message || e.cause})` : '',
      ].filter(Boolean).join(' · ');
      console.error('[send-push]', platform, tag_id, detail);
      errors.push({ platform, tag: tag_id, error: detail });
    }
  }

  return json({ sent, total: tokens.length, errors: errors.length ? errors : undefined });
}

// ── APNs Push (iOS) via HTTP/2-compatible fetch ──
async function sendApnsPush(deviceToken, { title, body, url, tag }, { keyBase64, keyId, teamId, bundleId, sandbox }) {
  let jwt;
  try {
    jwt = await createApnsJwt(keyBase64, keyId, teamId);
  } catch (e) {
    throw new Error(`APNs JWT build failed (check APNS_KEY_BASE64 / APNS_KEY_ID / APNS_TEAM_ID): ${e.message}`);
  }
  if (!deviceToken || deviceToken.length !== 64) {
    throw new Error(`APNs token format invalid (expected 64 hex chars, got ${deviceToken?.length ?? 0})`);
  }
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

  // Production vs sandbox APNs endpoint. Tokens from TestFlight or Xcode
  // dev builds only validate against sandbox; App Store builds use production.
  const host = sandbox ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  const endpoint = `https://${host}/3/device/${deviceToken}`;
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

  // crypto.subtle.sign returns raw r||s (64 bytes), NOT DER
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      new TextEncoder().encode(unsigned)
    )
  );
  const sigB64 = bytesToBase64Url(sig);
  return `${unsigned}.${sigB64}`;
}

// ── Web Push via raw fetch (RFC 8291 + RFC 8188 encryption) ──
async function sendWebPush(subscriptionJson, payloadStr, privateKeyBase64) {
  const subscription = JSON.parse(subscriptionJson);
  const endpoint = subscription.endpoint;
  const p256dhKey = base64UrlToBytes(subscription.keys.p256dh);
  const authSecret = base64UrlToBytes(subscription.keys.auth);

  // Import VAPID private key and create JWT
  const vapidKeyBytes = base64UrlToBytes(privateKeyBase64);
  const jwt = await createVapidJwt(endpoint, vapidKeyBytes);

  // Encrypt payload per RFC 8291 (aes128gcm)
  const encrypted = await encryptPayload(payloadStr, p256dhKey, authSecret);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization':    `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type':     'application/octet-stream',
      'TTL':              '86400',
    },
    body: encrypted,
  });

  if (!res.ok) {
    throw new Error(`Push failed: ${res.status} ${await res.text()}`);
  }
}

async function encryptPayload(payloadStr, uaPublicBytes, authSecret) {
  const payload = new TextEncoder().encode(payloadStr);

  // Generate ephemeral ECDH key pair
  const localKey = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const localPubRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', localKey.publicKey)
  );

  // Import the subscriber's public key
  const uaPublicKey = await crypto.subtle.importKey(
    'raw', uaPublicBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  // ECDH shared secret
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: uaPublicKey },
      localKey.privateKey,
      256
    )
  );

  // HKDF to derive the IKM from shared secret + auth secret (RFC 8291 §3.3)
  const ikmInfo = concatBytes(
    new TextEncoder().encode('WebPush: info\0'),
    uaPublicBytes,
    localPubRaw
  );
  const ikm = await hkdf(authSecret, sharedSecret, ikmInfo, 32);

  // Salt (random 16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Derive content encryption key and nonce (RFC 8188)
  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  const cek = await hkdf(salt, ikm, cekInfo, 16);
  const nonce = await hkdf(salt, ikm, nonceInfo, 12);

  // Pad payload: add delimiter byte 0x02 then zero padding
  const padded = new Uint8Array(payload.length + 1);
  padded.set(payload);
  padded[payload.length] = 2; // delimiter

  // AES-128-GCM encrypt
  const key = await crypto.subtle.importKey(
    'raw', cek, { name: 'AES-GCM' }, false, ['encrypt']
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce }, key, padded
    )
  );

  // Build aes128gcm header: salt(16) + rs(4) + idlen(1) + keyid(65) + ciphertext
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs);
  header[20] = 65; // length of localPubRaw
  header.set(localPubRaw, 21);

  return concatBytes(header, ciphertext);
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey(
    'raw', ikm, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const prk = new Uint8Array(
    await crypto.subtle.sign('HMAC',
      await crypto.subtle.importKey(
        'raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
      ),
      ikm
    )
  );
  const prkKey = await crypto.subtle.importKey(
    'raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const infoWithCounter = concatBytes(info, new Uint8Array([1]));
  const okm = new Uint8Array(
    await crypto.subtle.sign('HMAC', prkKey, infoWithCounter)
  );
  return okm.slice(0, length);
}

function concatBytes(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { result.set(a, offset); offset += a.length; }
  return result;
}

async function createVapidJwt(endpoint, privateKeyBytes) {
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour

  const header  = { typ: 'JWT', alg: 'ES256' };
  const claims  = { aud, exp, sub: 'mailto:hello@spotd.biz' };

  const headerB64  = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const claimsB64  = btoa(JSON.stringify(claims)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsigned   = `${headerB64}.${claimsB64}`;

  // Import raw 32-byte EC private key via PKCS8 wrapper
  const key = await crypto.subtle.importKey(
    'pkcs8',
    ecPrivateKeyToPkcs8(privateKeyBytes),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  // crypto.subtle.sign returns raw r||s (64 bytes), NOT DER
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      new TextEncoder().encode(unsigned)
    )
  );
  const sigB64 = bytesToBase64Url(sig);

  return `${unsigned}.${sigB64}`;
}

// Convert a 32-byte raw EC private key to PKCS8 DER format
function ecPrivateKeyToPkcs8(rawKey) {
  const header = new Uint8Array([
    0x30, 0x41,       // SEQUENCE (65 bytes)
    0x02, 0x01, 0x00, // INTEGER 0 (version)
    0x30, 0x13,       // SEQUENCE (19 bytes)
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
    0x04, 0x27,       // OCTET STRING (39 bytes)
    0x30, 0x25,       // SEQUENCE (37 bytes)
    0x02, 0x01, 0x01, // INTEGER 1
    0x04, 0x20        // OCTET STRING (32 bytes)
  ]);
  const result = new Uint8Array(header.length + rawKey.length);
  result.set(header);
  result.set(rawKey, header.length);
  return result.buffer;
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
