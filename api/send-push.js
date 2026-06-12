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
// Web push is currently inert (iOS-only deployment); web platform rows are
// excluded from the token query. The old Edge-runtime VAPID/web-push code was
// removed with the conversion — re-implement in Node if web push returns.

import { getApnsConfig, createApnsJwt, sendApnsBatch, cleanupDeadTokens } from './_lib/apns.js';

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

  const { user_ids, title, body: msgBody, url, tag, sandbox, diagnose } = body;

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

  // Fetch push tokens from Supabase. Web platform is excluded (web push is
  // inert); pre-filter so denominators are honest.
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

  if (!Array.isArray(tokens) || !tokens.length) {
    return res.status(200).json({ sent: 0, message: 'No tokens found' });
  }

  const batch = await sendApnsBatch(
    tokens,
    { title, body: msgBody, url: url || '/', tag: tag || 'spotd' },
    { sandbox: !!sandbox }
  );

  // Auto-cleanup: 410 Unregistered / 400 BadDeviceToken rows are dead forever.
  if (batch.deadTokens.length) {
    await cleanupDeadTokens(batch.deadTokens);
  }

  const out = {
    sent: batch.sent,
    total: tokens.length,
    errors: batch.errors.length ? batch.errors : undefined,
  };

  // Every token rejected as BadDeviceToken against production = the tokens
  // were almost certainly issued by the sandbox APNs environment.
  if (!sandbox && batch.sent === 0 && batch.badDeviceTokens === tokens.length) {
    out.hint = 'All tokens rejected by production APNs — tokens were likely issued against the sandbox environment. Check that the App Store provisioning profile sets aps-environment=production (ios/App/App/App.entitlements currently says development; the App Store export normally flips it).';
  }

  return res.status(200).json(out);
}
