// scripts/generate-vapid-keys.mjs
// Generate a fresh VAPID (P-256) key pair for Web Push.
//   node scripts/generate-vapid-keys.mjs
//
// Output:
//   VAPID_PUBLIC_KEY  -> paste into js/push.js (VAPID_PUBLIC_KEY constant)
//   VAPID_PRIVATE_KEY -> add to Vercel env vars (Production + Preview)
//
// WARNING: rotating keys invalidates every existing web-push subscription
// (browsers subscribed with the old public key). Only rotate if the current
// VAPID_PRIVATE_KEY env var does NOT match the public key in js/push.js —
// check with: POST /api/send-push { "diagnose": true } (Bearer PUSH_API_KEY)
// which reports the derived public key for comparison.
import crypto from 'node:crypto';

const ecdh = crypto.createECDH('prime256v1');
ecdh.generateKeys();
const b64u = (b) => Buffer.from(b).toString('base64url');

console.log('VAPID_PUBLIC_KEY=' + b64u(ecdh.getPublicKey()));
console.log('VAPID_PRIVATE_KEY=' + b64u(ecdh.getPrivateKey()));
