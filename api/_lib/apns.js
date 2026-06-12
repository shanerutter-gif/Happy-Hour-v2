// api/_lib/apns.js — shared APNs (Apple Push Notification service) sender.
//
// Node runtime ONLY. APNs' provider API is HTTP/2-only and the Vercel Edge
// runtime's fetch cannot negotiate HTTP/2 with api.push.apple.com — every
// Edge send failed with an opaque "Network connection lost". This module uses
// node:http2 directly and is shared by /api/send-push.js and
// /api/push-runner.js. The underscore-prefixed directory keeps Vercel from
// deploying it as its own endpoint.

import http2 from 'node:http2';
import crypto from 'node:crypto';

export function getApnsConfig() {
  return {
    keyBase64: process.env.APNS_KEY_BASE64, // .p8 key contents, base64-encoded
    keyId:     process.env.APNS_KEY_ID,     // 10-char key ID from Apple
    teamId:    process.env.APNS_TEAM_ID,    // Apple Developer Team ID
    bundleId:  process.env.APNS_BUNDLE_ID || 'biz.spotd.app',
  };
}

// ── APNs JWT (ES256) ────────────────────────────────────────────
// APNs rejects tokens older than 1h and rate-limits refreshes (TooManyProviderTokenUpdates),
// so cache the signed JWT at module level for ~40 minutes — the module
// instance survives between invocations on a warm lambda.
let _jwtCache = { jwt: null, iat: 0, keyId: null };
const JWT_MAX_AGE_S = 40 * 60;

export function createApnsJwt(keyBase64, keyId, teamId) {
  const nowS = Math.floor(Date.now() / 1000);
  if (_jwtCache.jwt && _jwtCache.keyId === keyId && nowS - _jwtCache.iat < JWT_MAX_AGE_S) {
    return _jwtCache.jwt;
  }
  const keyPem = Buffer.from(keyBase64, 'base64').toString('utf8');
  const privateKey = crypto.createPrivateKey(keyPem);

  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64url({ alg: 'ES256', kid: keyId })}.${b64url({ iss: teamId, iat: nowS })}`;
  // JWT ES256 requires the raw r||s signature (ieee-p1363), not DER
  const sig = crypto.sign('sha256', Buffer.from(unsigned), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  const jwt = `${unsigned}.${sig.toString('base64url')}`;
  _jwtCache = { jwt, iat: nowS, keyId };
  return jwt;
}

// ── HTTP/2 session ──────────────────────────────────────────────
function connectApns(host) {
  return new Promise((resolve, reject) => {
    const session = http2.connect(`https://${host}`);
    const timer = setTimeout(() => {
      session.destroy();
      reject(new Error(`APNs HTTP/2 connect timeout (${host})`));
    }, 10000);
    session.once('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`APNs HTTP/2 connect failed: ${e.message}`));
    });
    session.once('connect', () => {
      clearTimeout(timer);
      // Swallow late session-level errors so a dropped connection mid-batch
      // surfaces as per-request errors, not an unhandled exception.
      session.on('error', () => {});
      resolve(session);
    });
  });
}

function sendOnSession(session, deviceToken, jwt, bundleId, payload, priority) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    let req;
    try {
      req = session.request({
        ':method': 'POST',
        ':path': `/3/device/${deviceToken}`,
        'authorization': `bearer ${jwt}`,
        'apns-topic': bundleId,
        'apns-push-type': 'alert',
        'apns-priority': priority || '10',
        'apns-expiration': '0',
        'content-type': 'application/json',
      });
    } catch (e) {
      return done({ status: 0, reason: e.message });
    }
    let status = 0;
    let body = '';
    req.setEncoding('utf8');
    req.on('response', (headers) => { status = headers[':status'] || 0; });
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let reason = '';
      if (status !== 200) {
        try { reason = JSON.parse(body).reason || body; } catch { reason = body; }
      }
      done({ status, reason });
    });
    req.on('error', (e) => done({ status: 0, reason: e.message || 'stream error' }));
    req.setTimeout(10000, () => { req.close(); done({ status: 0, reason: 'request timeout' }); });
    req.end(payload);
  });
}

// ── Batch send ──────────────────────────────────────────────────
// tokenRows: [{ token, platform }] — web rows are skipped (web push inert).
// message:   { title, body, url, tag }
// opts:      { sandbox }   — TestFlight/Xcode-dev tokens validate only against sandbox.
//            { badgeOnly } — send a silent badge-reset ({"aps":{"badge":0}});
//                            no banner/sound, used to clear the icon badge.
//
// Returns { sent, errors, deadTokens, badDeviceTokens, results } where:
//   errors          [{ platform, tag, error }] (tag = first 8 chars of the token)
//   deadTokens      tokens APNs reported 410 Unregistered / 400 BadDeviceToken
//   badDeviceTokens count of BadDeviceToken rejections (env-mismatch heuristic)
//   results         per-token [{ token, platform, ok, status, reason }]
export async function sendApnsBatch(tokenRows, { title, body, url, tag } = {}, { sandbox = false, badgeOnly = false } = {}) {
  const { keyBase64, keyId, teamId, bundleId } = getApnsConfig();
  const out = { sent: 0, errors: [], deadTokens: [], badDeviceTokens: 0, results: [] };

  const targets = (tokenRows || []).filter(t => t.platform === 'ios' || t.platform === 'native');
  if (!targets.length) return out;

  if (!keyBase64 || !keyId || !teamId) {
    for (const t of targets) {
      out.errors.push({ platform: t.platform, tag: (t.token || '').slice(0, 8), error: 'APNs env vars not configured' });
      out.results.push({ token: t.token, platform: t.platform, ok: false, status: 0, reason: 'APNs env vars not configured' });
    }
    return out;
  }

  let jwt;
  try {
    jwt = createApnsJwt(keyBase64, keyId, teamId);
  } catch (e) {
    const msg = `APNs JWT build failed (check APNS_KEY_BASE64 / APNS_KEY_ID / APNS_TEAM_ID): ${e.message}`;
    for (const t of targets) {
      out.errors.push({ platform: t.platform, tag: (t.token || '').slice(0, 8), error: msg });
      out.results.push({ token: t.token, platform: t.platform, ok: false, status: 0, reason: msg });
    }
    return out;
  }

  // Badge-only pushes carry no alert/sound — iOS just updates the icon badge
  // silently. Push type stays 'alert' (Apple requires it for badge changes);
  // priority 5 since nothing is shown to the user.
  const payload = badgeOnly
    ? JSON.stringify({ aps: { badge: 0 } })
    : JSON.stringify({
        aps: {
          alert: { title, body },
          sound: 'default',
          badge: 1,
          'mutable-content': 1,
        },
        url: url || '/',
        tag: tag || 'spotd',
      });

  const host = sandbox ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  let session;
  try {
    session = await connectApns(host);
  } catch (e) {
    for (const t of targets) {
      out.errors.push({ platform: t.platform, tag: (t.token || '').slice(0, 8), error: e.message });
      out.results.push({ token: t.token, platform: t.platform, ok: false, status: 0, reason: e.message });
    }
    return out;
  }

  try {
    // One HTTP/2 session, all tokens multiplexed on it.
    const settled = await Promise.all(targets.map(async (t) => {
      const tagId = (t.token || '').slice(0, 8);
      if (!t.token || t.token.length !== 64) {
        return { ...t, tagId, status: 0, reason: `APNs token format invalid (expected 64 hex chars, got ${t.token?.length ?? 0})` };
      }
      const r = await sendOnSession(session, t.token, jwt, bundleId, payload, badgeOnly ? '5' : '10');
      return { ...t, tagId, ...r };
    }));

    for (const r of settled) {
      const ok = r.status === 200;
      out.results.push({ token: r.token, platform: r.platform, ok, status: r.status, reason: ok ? '' : r.reason });
      if (ok) {
        out.sent++;
        continue;
      }
      const detail = r.status ? `APNs failed: ${r.status} ${r.reason}` : r.reason;
      console.error('[apns]', r.platform, r.tagId, detail);
      out.errors.push({ platform: r.platform, tag: r.tagId, error: detail });
      if (r.status === 410 || (r.status === 400 && r.reason === 'BadDeviceToken')) {
        out.deadTokens.push(r.token);
      }
      if (r.status === 400 && r.reason === 'BadDeviceToken') out.badDeviceTokens++;
    }
  } finally {
    session.close();
  }
  return out;
}

// ── In-app notification mirror ──────────────────────────────────
// Saves a delivered push as a notifications row (type='push', no actor) per
// recipient so it appears in the app's social bell panel. Callers pass only
// users with at least one successful delivery. DB-trigger pushes
// (send_push_to_user) opt out via body {inapp:false} — their triggers insert
// their own social-shaped notifications rows already.
export async function saveInAppNotifications(userIds, { title, body, url }) {
  if (!userIds?.length) return 0;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return 0;
  const rows = [...new Set(userIds)].map(uid => ({
    user_id: uid,
    type: 'push',
    title: title || 'Spotd',
    preview: body || '',
    url: url || '/',
  }));
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/notifications`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(rows),
    });
    if (!res.ok) {
      console.error('[apns] in-app notification insert failed:', res.status, await res.text().catch(() => ''));
      return 0;
    }
    return rows.length;
  } catch (e) {
    console.error('[apns] in-app notification insert error:', e.message);
    return 0;
  }
}

// ── Dead-token cleanup ──────────────────────────────────────────
// APNs 410 Unregistered (app deleted) and 400 BadDeviceToken rows are useless
// forever — delete them so future sends report honest denominators.
export async function cleanupDeadTokens(deadTokens) {
  if (!deadTokens?.length) return 0;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return 0;
  try {
    const list = deadTokens.map(t => `"${t}"`).join(',');
    const res = await fetch(`${supabaseUrl}/rest/v1/push_tokens?token=in.(${list})`, {
      method: 'DELETE',
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
    });
    if (!res.ok) {
      console.error('[apns] dead-token cleanup failed:', res.status, await res.text().catch(() => ''));
      return 0;
    }
    return deadTokens.length;
  } catch (e) {
    console.error('[apns] dead-token cleanup error:', e.message);
    return 0;
  }
}
