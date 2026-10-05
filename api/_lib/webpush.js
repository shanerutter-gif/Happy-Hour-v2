// api/_lib/webpush.js — minimal Web Push sender (RFC 8291 message encryption
// + RFC 8292 VAPID auth). Pure node:crypto, no npm dependencies (the repo's
// package.json is intentionally empty).
//
// Usage:
//   import { sendWebPushBatch, deriveVapidPublicKey } from './_lib/webpush.js';
//   const batch = await sendWebPushBatch(
//     [{ token: '<PushSubscription JSON>', user_id: '...' }],
//     { title, body, icon, badge, tag, data: { url } },
//     { privateKeyB64u: process.env.VAPID_PRIVATE_KEY, subject: 'mailto:shane@spotd.biz' }
//   );
//   // batch = { sent, total, results: [{ok, token, status|error}], deadTokens, errors }
//
// Env contract:
//   VAPID_PRIVATE_KEY — base64url-encoded raw 32-byte P-256 private key
//     (the same format the `web-push` npm package uses). The public key is
//     derived from it, so only the private key needs to be stored.
//     Generate a pair with: node scripts/generate-vapid-keys.mjs
//
// The matching PUBLIC key must be the one clients subscribe with — it is
// hardcoded as VAPID_PUBLIC_KEY in js/push.js. If you rotate keys, update
// BOTH js/push.js and the Vercel env var, or existing subscriptions break.

import crypto from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');

// ── VAPID key handling ──────────────────────────────────────────────

/** Derive the base64url uncompressed P-256 public key from a raw private key. */
export function deriveVapidPublicKey(privateKeyB64u) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(unb64u(privateKeyB64u));
  return b64u(ecdh.getPublicKey()); // 65-byte 0x04-prefixed, base64url
}

function vapidPrivateKeyObject(privateKeyB64u) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(unb64u(privateKeyB64u));
  const pub = ecdh.getPublicKey();
  return crypto.createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: b64u(pub.subarray(1, 33)),
      y: b64u(pub.subarray(33, 65)),
      d: String(privateKeyB64u).replace(/=+$/, ''),
    },
    format: 'jwk',
  });
}

/** Build the VAPID Authorization header value for a push-service origin. */
export function createVapidAuthHeader(endpoint, subject, privateKeyB64u, publicKeyB64u) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600, // RFC 8292: exp <= 24h
    sub: subject,
  }));
  const signer = vapidPrivateKeyObject(privateKeyB64u);
  const sig = b64u(crypto.sign('sha256', Buffer.from(`${header}.${claims}`), signer));
  return `vapid t=${header}.${claims}.${sig}, k=${publicKeyB64u}`;
}

// ── RFC 8291 (aesgcm) content encryption ────────────────────────────

function hkdf(salt, ikm, info, len) {
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  const out = [];
  let prev = Buffer.alloc(0);
  let i = 0;
  while (Buffer.concat(out).length < len) {
    i += 1;
    const h = crypto.createHmac('sha256', prk);
    h.update(prev);
    h.update(info);
    h.update(Buffer.from([i]));
    prev = h.digest();
    out.push(prev);
  }
  return Buffer.concat(out).subarray(0, len);
}

/**
 * Encrypt a plaintext payload for one PushSubscription (aesgcm).
 * Returns { ciphertext, salt, serverPublicKey } (all Buffers).
 */
export function encryptAesGcm(subscription, plaintext) {
  const clientPub = unb64u(subscription.keys.p256dh); // 65-byte uncompressed
  const authSecret = unb64u(subscription.keys.auth);  // 16 bytes

  const serverECDH = crypto.createECDH('prime256v1');
  serverECDH.generateKeys();
  const serverPub = serverECDH.getPublicKey();

  const sharedSecret = serverECDH.computeSecret(clientPub);

  // RFC 8291 §3.4 key schedule: PRK = Extract(salt=auth_secret, IKM=ECDH
  // secret); CEK/nonce = Expand(PRK, cek_info/nonce_info). hkdf() below does
  // Extract+Expand in one call, so pass authSecret as the salt directly.
  const cekInfo = Buffer.concat([Buffer.from('Content-Encoding: aesgcm\0'), clientPub, serverPub]);
  const nonceInfo = Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), clientPub, serverPub]);
  const cek = hkdf(authSecret, sharedSecret, cekInfo, 16);
  const nonce = hkdf(authSecret, sharedSecret, nonceInfo, 12);

  // aesgcm padding: data + 0x02 delimiter (+ zero pad to a full record; we
  // keep it minimal — one record, no extra padding).
  const padded = Buffer.concat([Buffer.from(plaintext), Buffer.from([0x02])]);

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  const salt = crypto.randomBytes(16); // informational for aesgcm; required by aes128gcm
  return { ciphertext, salt, serverPublicKey: serverPub };
}

// ── Single + batch send ─────────────────────────────────────────────

const PUSH_TTL_SECONDS = 4 * 7 * 24 * 3600; // 4 weeks — happy-hour alerts stay relevant

/** Send one encrypted push. Returns { ok, status } or { ok:false, status, error }. */
export async function sendWebPush(subscription, payload, { privateKeyB64u, publicKeyB64u, subject }) {
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/icon-192.png',
    tag: payload.tag || 'spotd',
    data: payload.data || {},
  });

  const { ciphertext, salt, serverPublicKey } = encryptAesGcm(subscription, body);
  const authHeader = createVapidAuthHeader(subscription.endpoint, subject, privateKeyB64u, publicKeyB64u);

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aesgcm',
      'Encryption': `salt=${b64u(salt)}`,
      'Crypto-Key': `dh=${b64u(serverPublicKey)}; p256ecdsa=${publicKeyB64u}`,
      'Authorization': authHeader,
      'TTL': String(PUSH_TTL_SECONDS),
    },
    body: ciphertext,
  });

  if (res.ok) return { ok: true, status: res.status };
  const text = await res.text().catch(() => '');
  return { ok: false, status: res.status, error: text.slice(0, 300) };
}

/**
 * Send to many subscriptions. `entries` = [{ token: PushSubscription JSON
 * string (as stored in push_tokens.token), user_id }].
 * Returns { sent, total, results, deadTokens, errors } — same shape as the
 * APNs batch helper so callers can merge them.
 */
export async function sendWebPushBatch(entries, payload, opts) {
  const results = [];
  const deadTokens = [];
  const errors = [];
  let sent = 0;

  const CONCURRENCY = 20;
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const chunk = entries.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(chunk.map(async ({ token, user_id }) => {
      let sub;
      try {
        sub = JSON.parse(token);
      } catch {
        return { ok: false, token, user_id, error: 'token is not valid PushSubscription JSON' };
      }
      if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
        return { ok: false, token, user_id, error: 'subscription missing endpoint/keys' };
      }
      try {
        const r = await sendWebPush(sub, payload, opts);
        if (r.ok) return { ok: true, token, user_id, status: r.status };
        // 404/410 = subscription gone forever (uninstalled / revoked).
        if (r.status === 404 || r.status === 410) deadTokens.push(token);
        return { ok: false, token, user_id, status: r.status, error: r.error };
      } catch (e) {
        return { ok: false, token, user_id, error: e.message };
      }
    }));
    for (const r of settled) {
      results.push(r);
      if (r.ok) sent += 1;
      else errors.push({ token: String(r.token).slice(0, 60) + '…', status: r.status, error: r.error });
    }
  }

  return { sent, total: entries.length, results, deadTokens, errors };
}
