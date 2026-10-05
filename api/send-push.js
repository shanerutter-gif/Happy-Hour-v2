// api/send-push.js — Node serverless function (NOT Edge).
//
// Converted from the Edge runtime on 2026-06-12: APNs' provider API is
// HTTP/2-only and Edge fetch cannot negotiate HTTP/2 with api.push.apple.com,
// so every send failed with an opaque "Network connection lost". The actual
// APNs delivery now lives in api/_lib/apns.js (node:http2 + node:crypto),
// shared with /api/push-runner.js.
//
// Callers MUST hit https://www.spotd.biz/api/send-push (never bare spotd.biz —
// the apex 308-redirects to www and HTTP clients drop the Authorization header
// on the cross-host redirect, which silently 401'd every pg_cron call).
//
// Auth: Authorization: Bearer ${PUSH_API_KEY}
// Web push is LIVE: platform='web' and platform='android' rows carry a
// PushSubscription JSON in `token` and are delivered via VAPID (RFC 8291 /
// RFC 8292) in api/_lib/webpush.js — no Firebase needed. Requires the
// VAPID_PRIVATE_KEY env var (base64url raw P-256 key); its derived public
// key must match VAPID_PUBLIC_KEY in js/push.js (checked in diagnose mode).

import { getApnsConfig, createApnsJwt, sendApnsBatch, cleanupDeadTokens, saveInAppNotifications } from './_lib/apns.js';
import { sendWebPushBatch, deriveVapidPublicKey } from './_lib/webpush.js';

const VAPID_SUBJECT = 'mailto:shane@spotd.biz';
// Public key clients subscribe with (js/push.js). The server only needs the
// private key; the public key is derived from it and compared here in
// diagnose mode so a key mismatch is caught without sending anything.
const VAPID_PUBLIC_KEY_CLIENT = 'BMW9ZANN8ywdnRhtDWmd5haZ9mwI4Dr8n28hO67aNy60h3WPOmGaElvseWgSj9zfw9geaqR5gbVUfMPQ9VvrjfU';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth: require a secret key so only your backend/cron can call this
  const expectedKey = process.env.PUSH_API_KEY;
  const authHeader = req.headers['authorization'];
  if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const { keyBase64: apnsKeyBase64, keyId: apnsKeyId, teamId: apnsTeamId, bundleId: apnsBundleId } = getApnsConfig();

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Missing env vars' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { user_ids, title, body: msgBody, url, tag, sandbox, diagnose, inapp } = body;

  // Diagnostic mode: build the JWT, return its header+claims (NOT the
  // signature), don't actually call Apple. Lets us verify env vars are
  // configured correctly without sending anything.
  if (diagnose) {
    const out = {
      runtime: 'node',
      node_version: process.version,
      env: {
        VAPID_PRIVATE_KEY:  process.env.VAPID_PRIVATE_KEY ? `set (${process.env.VAPID_PRIVATE_KEY.length} chars)` : 'MISSING',
        APNS_KEY_BASE64:    apnsKeyBase64 ? `set (${apnsKeyBase64.length} chars)` : 'MISSING',
        APNS_KEY_ID:        apnsKeyId     || 'MISSING',
        APNS_TEAM_ID:       apnsTeamId    || 'MISSING',
        APNS_BUNDLE_ID:     apnsBundleId,
      },
      // Web push key check: derive the public key from VAPID_PRIVATE_KEY and
      // compare with the key clients actually subscribe with (js/push.js).
      // If these differ, web pushes will 401 at the push service — rotate
      // with: node scripts/generate-vapid-keys.mjs (updates both sides).
      webpush: (() => {
        try {
          const derived = deriveVapidPublicKey(process.env.VAPID_PRIVATE_KEY);
          return { derived_public_key: derived, matches_client_key: derived === VAPID_PUBLIC_KEY_CLIENT };
        } catch (e) {
          return { error: e.message };
        }
      })(),
    };
    if (apnsKeyBase64 && apnsKeyId && apnsTeamId) {
      try {
        const decoded = Buffer.from(apnsKeyBase64, 'base64').toString('utf8');
        out.apns_key_first_30_chars  = decoded.slice(0, 30);
        out.apns_key_starts_with_pem = decoded.startsWith('-----BEGIN PRIVATE KEY-----');
        const jwt = createApnsJwt(apnsKeyBase64, apnsKeyId, apnsTeamId);
        const [h, c] = jwt.split('.');
        out.jwt_header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
        out.jwt_claims = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
        out.jwt_built_ok = true;
      } catch (e) {
        out.jwt_built_ok = false;
        out.jwt_error = e.message;
      }
    }
    return res.status(200).json(out);
  }

  if (!title || !msgBody) {
    return res.status(400).json({ error: 'title and body are required' });
  }

  // Fetch push tokens from Supabase. Web + Android rows carry a
  // PushSubscription JSON in `token` and go through the VAPID web-push
  // sender (api/_lib/webpush.js); iOS/native device tokens go to APNs.
  let query = `${supabaseUrl}/rest/v1/push_tokens?select=token,platform,user_id&platform=in.(ios,native,web,android)`;
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

  if (!Array.isArray(tokens) || !tokens.length) {
    return res.status(200).json({ sent: 0, message: 'No tokens found' });
  }

  const webTokens = tokens.filter(t => t.platform === 'web' || t.platform === 'android');
  const apnsTokens = tokens.filter(t => t.platform === 'ios' || t.platform === 'native');

  const payload = { title, body: msgBody, url: url || '/', tag: tag || 'spotd' };

  // iOS / native via APNs (unchanged)
  const apnsBatch = apnsTokens.length
    ? await sendApnsBatch(apnsTokens, payload, { sandbox: !!sandbox })
    : { sent: 0, results: [], deadTokens: [], errors: [], badDeviceTokens: 0 };

  // Web + Android via VAPID web push (RFC 8291/8292, no Firebase needed)
  let webBatch = { sent: 0, results: [], deadTokens: [], errors: [] };
  if (webTokens.length) {
    const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
    if (!vapidPrivate) {
      return res.status(500).json({ error: 'VAPID_PRIVATE_KEY is not set — cannot send web push' });
    }
    webBatch = await sendWebPushBatch(webTokens, payload, {
      privateKeyB64u: vapidPrivate,
      publicKeyB64u: deriveVapidPublicKey(vapidPrivate),
      subject: VAPID_SUBJECT,
    });
  }

  const sent = apnsBatch.sent + webBatch.sent;
  const allResults = [...apnsBatch.results, ...webBatch.results];
  const allDead = [...apnsBatch.deadTokens, ...webBatch.deadTokens];
  const allErrors = [...apnsBatch.errors, ...webBatch.errors];

  // Auto-cleanup: dead APNs tokens + 404/410 web-push subscriptions.
  if (allDead.length) {
    await cleanupDeadTokens(allDead);
  }

  // Mirror the push into the in-app bell panel (notifications, type='push')
  // for every user with at least one successful delivery. DB triggers pass
  // inapp:false because they insert their own notifications rows.
  if (inapp !== false && sent > 0) {
    const tokenUser = new Map(tokens.map(t => [t.token, t.user_id]));
    const okUserIds = allResults.filter(r => r.ok).map(r => tokenUser.get(r.token)).filter(Boolean);
    await saveInAppNotifications(okUserIds, { title, body: msgBody, url: url || '/' });
  }

  const out = {
    sent,
    total: tokens.length,
    by_platform: { apns: apnsBatch.sent, web: webBatch.sent },
    errors: allErrors.length ? allErrors : undefined,
  };

  // Every token rejected as BadDeviceToken against production = the tokens
  // were almost certainly issued by the sandbox APNs environment.
  if (!sandbox && apnsTokens.length && apnsBatch.sent === 0 && apnsBatch.badDeviceTokens === apnsTokens.length) {
    out.hint = 'All tokens rejected by production APNs — tokens were likely issued against the sandbox environment. Check that the App Store provisioning profile sets aps-environment=production (ios/App/App/App.entitlements currently says development; the App Store export normally flips it).';
  }

  return res.status(200).json(out);
}
