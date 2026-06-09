export const config = { runtime: 'edge' };

// Cron endpoint: finds inactive users and sends Loops re-engagement events.
// Call this daily via Vercel Cron or an external scheduler.
// GET /api/loops-inactive?key=<SERVICE_ROLE_KEY>
//
// Inactivity is measured from coalesce(last_seen, created_at) so users who
// never recorded a last_seen still age in. Instead of brittle "exactly 7-8d"
// bands, we send to anyone "older than 7d / 30d AND not already re-engaged"
// and stamp profiles.reengaged_7d_at / reengaged_30d_at after each send so we
// never re-email the same cohort. The 30d cohort takes precedence so a long-
// dormant user gets a single inactive_30d, not both events in one run.

export default async function handler(req) {
  if (req.method !== 'GET') return jsonRes({ error: 'GET only' }, 405);

  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const loopsKey = process.env.LOOPS_API_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://opcskuzbdfrlnyhraysk.supabase.co';

  if (!svcKey) {
    console.error('[loops-inactive] Missing env var SUPABASE_SERVICE_ROLE_KEY');
    return jsonRes({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }
  if (!loopsKey) {
    console.error('[loops-inactive] Missing env var LOOPS_API_KEY');
    return jsonRes({ error: 'Missing LOOPS_API_KEY' }, 500);
  }

  // Auth: accept either ?key=<SERVICE_ROLE_KEY> or Vercel Cron's CRON_SECRET header
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`;
  if (!isVercelCron && key !== svcKey) return jsonRes({ error: 'Unauthorized' }, 401);

  const now = Date.now();
  const sevenDaysAgo  = new Date(now - 7  * 86400000).toISOString();
  const thirtyDaysAgo = new Date(now - 30 * 86400000).toISOString();

  const headers = {
    'apikey': svcKey,
    'Authorization': `Bearer ${svcKey}`,
    'Content-Type': 'application/json',
  };

  try {
    // Fetch candidate profiles: anyone not yet re-engaged in at least one band.
    // We compute the effective-last-seen (coalesce) and band membership in JS so
    // we don't depend on a Postgres view/RPC.
    const selUrl = `${supabaseUrl}/rest/v1/profiles`
      + `?select=id,last_seen,created_at,reengaged_7d_at,reengaged_30d_at`
      + `&or=(reengaged_7d_at.is.null,reengaged_30d_at.is.null)`
      + `&limit=2000`;
    const res = await fetch(selUrl, { headers });
    if (!res.ok) {
      const body = await res.text();
      console.error('[loops-inactive] profiles fetch failed:', res.status, body);
      return jsonRes({ error: 'profiles fetch failed', status: res.status, detail: body }, 502);
    }
    const profiles = await res.json();

    const cohort7 = [];
    const cohort30 = [];
    for (const p of profiles) {
      const effective = p.last_seen || p.created_at;
      if (!effective) continue;
      const seenAt = new Date(effective).toISOString();
      // 30d band takes precedence so we never double-send in one run.
      if (seenAt <= thirtyDaysAgo && !p.reengaged_30d_at) {
        cohort30.push(p);
      } else if (seenAt <= sevenDaysAgo && !p.reengaged_7d_at) {
        cohort7.push(p);
      }
    }

    if (!cohort7.length && !cohort30.length) {
      return jsonRes({ sent7: 0, sent30: 0, candidates: profiles.length });
    }

    // Resolve emails from auth.users (admin API), one lookup per id.
    const allIds = [...new Set([...cohort7.map(u => u.id), ...cohort30.map(u => u.id)])];
    const emailMap = {};
    for (const uid of allIds) {
      try {
        const r = await fetch(`${supabaseUrl}/auth/v1/admin/users/${uid}`, {
          headers: { 'apikey': svcKey, 'Authorization': `Bearer ${svcKey}` },
        });
        if (r.ok) {
          const u = await r.json();
          if (u.email) emailMap[uid] = u.email;
        } else {
          const body = await r.text();
          console.error(`[loops-inactive] auth lookup failed for ${uid}:`, r.status, body);
        }
      } catch (e) {
        console.error(`[loops-inactive] auth lookup error for ${uid}:`, e.message);
      }
    }

    const loopsHeaders = {
      'Authorization': `Bearer ${loopsKey}`,
      'Content-Type': 'application/json',
    };

    let sent7 = 0, sent30 = 0;

    // Helper: send the Loops event, then stamp the matching reengaged column.
    async function processCohort(cohort, eventName, stampCol) {
      let sent = 0;
      for (const u of cohort) {
        const email = emailMap[u.id];
        if (!email) { console.error(`[loops-inactive] no email for ${u.id}, skipping ${eventName}`); continue; }
        try {
          const er = await fetch('https://app.loops.so/api/v1/events/send', {
            method: 'POST',
            headers: loopsHeaders,
            body: JSON.stringify({ email, eventName }),
          });
          if (!er.ok) {
            const body = await er.text();
            console.error(`[loops-inactive] ${eventName} send failed for ${email}:`, er.status, body);
            continue;
          }
        } catch (e) {
          console.error(`[loops-inactive] ${eventName} send error for ${email}:`, e.message);
          continue;
        }
        // Stamp so we don't re-send this cohort tomorrow.
        try {
          const pr = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${u.id}`, {
            method: 'PATCH',
            headers: { ...headers, 'Prefer': 'return=minimal' },
            body: JSON.stringify({ [stampCol]: new Date().toISOString() }),
          });
          if (!pr.ok) {
            const body = await pr.text();
            console.error(`[loops-inactive] failed to stamp ${stampCol} for ${u.id}:`, pr.status, body);
          }
        } catch (e) {
          console.error(`[loops-inactive] stamp error ${stampCol} for ${u.id}:`, e.message);
        }
        sent++;
      }
      return sent;
    }

    sent30 = await processCohort(cohort30, 'inactive_30d', 'reengaged_30d_at');
    sent7  = await processCohort(cohort7,  'inactive_7d',  'reengaged_7d_at');

    return jsonRes({ sent7, sent30, cohort7: cohort7.length, cohort30: cohort30.length });
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
