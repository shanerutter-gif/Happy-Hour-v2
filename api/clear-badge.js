// api/clear-badge.js — Node serverless function (NOT Edge; APNs needs HTTP/2).
//
// Resets the caller's iOS app-icon badge to 0 by sending a silent badge-only
// APNs push ({"aps":{"badge":0}}) to their own devices — no native code or
// App Store update required. Called fire-and-forget by the web app when the
// user opens the social notifications panel (clearPushBadge() in js/db.js).
//
// Auth: the user's own Supabase JWT (Authorization: Bearer <access_token>).
// The JWT is validated against /auth/v1/user and the badge reset only ever
// targets that user's own push_tokens rows, so this is safe to expose.

import { sendApnsBatch, cleanupDeadTokens } from './_lib/apns.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Missing env vars' });

  const jwt = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return res.status(401).json({ error: 'Unauthorized' });

  // Resolve the caller from their own JWT
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${jwt}` },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid session' });
  const user = await userRes.json();
  if (!user?.id) return res.status(401).json({ error: 'Invalid session' });

  // Only this user's iOS tokens
  const tokensRes = await fetch(
    `${supabaseUrl}/rest/v1/push_tokens?select=token,platform&platform=in.(ios,native)&user_id=eq.${user.id}`,
    { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
  );
  const tokens = await tokensRes.json();
  if (!Array.isArray(tokens) || !tokens.length) {
    return res.status(200).json({ cleared: 0 });
  }

  const batch = await sendApnsBatch(tokens, {}, { badgeOnly: true });
  if (batch.deadTokens.length) await cleanupDeadTokens(batch.deadTokens);

  return res.status(200).json({ cleared: batch.sent, total: tokens.length });
}
