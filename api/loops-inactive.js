export const config = { runtime: 'edge' };

// Cron endpoint: finds inactive users and sends Loops events.
// Call this daily via Vercel Cron or an external scheduler.
// GET /api/loops-inactive?key=<SERVICE_ROLE_KEY>

export default async function handler(req) {
  if (req.method !== 'GET') return jsonRes({ error: 'GET only' }, 405);

  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const loopsKey = process.env.LOOPS_API_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://opcskuzbdfrlnyhraysk.supabase.co';

  if (!svcKey || !loopsKey) return jsonRes({ error: 'Missing env vars' }, 500);
  // Auth: accept either ?key=<SERVICE_ROLE_KEY> or Vercel Cron's CRON_SECRET header
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`;
  if (!isVercelCron && key !== svcKey) return jsonRes({ error: 'Unauthorized' }, 401);

  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 86400000).toISOString();
  const thirtyDaysAgo = new Date(now - 30 * 86400000).toISOString();
  // Don't re-notify users we already notified (check within a window)
  const eightDaysAgo = new Date(now - 8 * 86400000).toISOString();
  const thirtyOneDaysAgo = new Date(now - 31 * 86400000).toISOString();

  const headers = {
    'apikey': svcKey,
    'Authorization': `Bearer ${svcKey}`,
    'Content-Type': 'application/json',
  };

  try {
    // Fetch users who were last seen 7-8 days ago (inactive_7d window)
    const [res7, res30] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/profiles?select=id,last_seen&last_seen=gte.${eightDaysAgo}&last_seen=lte.${sevenDaysAgo}&limit=500`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/profiles?select=id,last_seen&last_seen=gte.${thirtyOneDaysAgo}&last_seen=lte.${thirtyDaysAgo}&limit=500`, { headers }),
    ]);

    const users7 = res7.ok ? await res7.json() : [];
    const users30 = res30.ok ? await res30.json() : [];

    // We need emails — fetch from auth.users via Supabase admin API
    const allUserIds = [...new Set([...users7.map(u => u.id), ...users30.map(u => u.id)])];
    if (!allUserIds.length) return jsonRes({ sent7: 0, sent30: 0 });

    // Batch lookup emails from auth
    const emailMap = {};
    for (const uid of allUserIds) {
      try {
        const r = await fetch(`${supabaseUrl}/auth/v1/admin/users/${uid}`, {
          headers: { 'apikey': svcKey, 'Authorization': `Bearer ${svcKey}` },
        });
        if (r.ok) {
          const u = await r.json();
          if (u.email) emailMap[uid] = u.email;
        }
      } catch {}
    }

    const loopsHeaders = {
      'Authorization': `Bearer ${loopsKey}`,
      'Content-Type': 'application/json',
    };

    let sent7 = 0, sent30 = 0;

    // Send inactive_7d events
    for (const u of users7) {
      const email = emailMap[u.id];
      if (!email) continue;
      await fetch('https://app.loops.so/api/v1/events/send', {
        method: 'POST',
        headers: loopsHeaders,
        body: JSON.stringify({ email, eventName: 'inactive_7d' }),
      });
      sent7++;
    }

    // Send inactive_30d events
    for (const u of users30) {
      const email = emailMap[u.id];
      if (!email) continue;
      await fetch('https://app.loops.so/api/v1/events/send', {
        method: 'POST',
        headers: loopsHeaders,
        body: JSON.stringify({ email, eventName: 'inactive_30d' }),
      });
      sent30++;
    }

    return jsonRes({ sent7, sent30, totalLookedUp: allUserIds.length });
  } catch (e) {
    console.error('[loops-inactive] Error:', e.message);
    return jsonRes({ error: e.message }, 500);
  }
}

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
