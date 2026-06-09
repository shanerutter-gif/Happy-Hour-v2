export const config = { runtime: 'edge' };

// Daily Deals Newsletter — runs once per day via Vercel Cron.
// Picks 3 venues with deals, sends a `daily_deals` event to engaged users
// (everyone who's checked in across the active cities). Recipients come from the
// DATABASE (distinct check_ins.user_id, emails resolved via the Supabase admin
// API) — Loops has no list-all-contacts endpoint.
// GET /api/daily-deals?key=<SERVICE_ROLE_KEY>

export default async function handler(req) {
  if (req.method !== 'GET') return jsonRes({ error: 'GET only' }, 405);

  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const loopsKey = process.env.LOOPS_API_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://opcskuzbdfrlnyhraysk.supabase.co';

  if (!svcKey) {
    console.error('[daily-deals] Missing env var SUPABASE_SERVICE_ROLE_KEY');
    return jsonRes({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }
  if (!loopsKey) {
    console.error('[daily-deals] Missing env var LOOPS_API_KEY');
    return jsonRes({ error: 'Missing LOOPS_API_KEY' }, 500);
  }

  // Auth: Vercel Cron secret or service key
  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`;
  if (!isVercelCron && key !== svcKey) return jsonRes({ error: 'Unauthorized' }, 401);

  const sbHeaders = {
    'apikey': svcKey,
    'Authorization': `Bearer ${svcKey}`,
  };

  try {
    // 1. Fetch all active venues that have deals.
    //    NOTE: venues has a single `hours` text column — there is NO
    //    hours_start/hours_end (naming them here previously 400'd the whole
    //    query and 500'd this cron).
    const r = await fetch(
      `${supabaseUrl}/rest/v1/venues?select=id,name,neighborhood,city_slug,deals,hours,days&active=eq.true&deals=not.is.null&limit=1000`,
      { headers: sbHeaders }
    );
    if (!r.ok) {
      const body = await r.text();
      console.error('[daily-deals] venues fetch failed:', r.status, body);
      throw new Error(`Failed to fetch venues: ${r.status} ${body}`);
    }
    let venues = await r.json();

    // Filter to venues that actually have deals (non-empty array)
    venues = venues.filter(v => Array.isArray(v.deals) && v.deals.length > 0);
    if (venues.length < 3) {
      console.error('[daily-deals] Not enough venues with deals:', venues.length);
      return jsonRes({ error: 'Not enough venues with deals', count: venues.length }, 400);
    }

    // 2. Pick 3 venues — rotate daily using day-of-year as offset
    const dayOfYear = getDayOfYear();
    const offset = (dayOfYear * 3) % venues.length;
    const picked = [];
    for (let i = 0; i < 3; i++) {
      picked.push(venues[(offset + i) % venues.length]);
    }

    // 3. Build event properties
    const props = {};
    picked.forEach((v, i) => {
      const n = i + 1;
      props[`venue${n}_name`] = v.name;
      props[`venue${n}_neighborhood`] = v.neighborhood || '';
      props[`venue${n}_city`] = formatCity(v.city_slug);
      props[`venue${n}_deal1`] = v.deals[0] || '';
      props[`venue${n}_deal2`] = v.deals[1] || '';
      props[`venue${n}_deal3`] = v.deals[2] || '';
      props[`venue${n}_hours`] = formatHours(v);
    });
    props['date_formatted'] = new Date().toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    });

    // 4. Resolve recipients from the database (Loops has no list-all endpoint):
    //    engaged users = distinct check_ins.user_id across all active cities.
    const citiesRes = await fetch(`${supabaseUrl}/rest/v1/cities?select=slug&active=eq.true`, { headers: sbHeaders });
    if (!citiesRes.ok) {
      const body = await citiesRes.text();
      console.error('[daily-deals] cities fetch failed:', citiesRes.status, body);
      throw new Error(`Failed to fetch cities: ${citiesRes.status} ${body}`);
    }
    const cities = await citiesRes.json();

    const userIdSet = new Set();
    for (const c of cities) {
      const ids = await engagedUserIds(supabaseUrl, sbHeaders, c.slug);
      ids.forEach(id => userIdSet.add(id));
    }
    const userIds = [...userIdSet];
    if (!userIds.length) {
      console.error('[daily-deals] No engaged users found across active cities');
      return jsonRes({ success: true, venues: picked.map(v => v.name), recipients: 0, sent: 0, errors: 0 });
    }

    // Skip users who opted out of the digest.
    const disabled = await digestDisabledSet(supabaseUrl, sbHeaders, userIds);

    const loopsHeaders = {
      'Authorization': `Bearer ${loopsKey}`,
      'Content-Type': 'application/json',
    };

    // 5. Send daily_deals to each resolved email (with rate limiting).
    const emailCache = {};
    let sent = 0, errors = 0, recipients = 0;
    for (const uid of userIds) {
      if (disabled.has(uid)) continue;
      const email = await resolveEmail(supabaseUrl, svcKey, uid, emailCache);
      if (!email) continue;
      recipients++;
      try {
        const er = await fetch('https://app.loops.so/api/v1/events/send', {
          method: 'POST',
          headers: loopsHeaders,
          body: JSON.stringify({
            email,
            eventName: 'daily_deals',
            ...props,
          }),
        });
        if (er.ok) sent++;
        else {
          errors++;
          const body = await er.text();
          console.error(`[daily-deals] daily_deals send failed for ${email}:`, er.status, body);
        }
      } catch (e) {
        errors++;
        console.error(`[daily-deals] daily_deals send error for ${email}:`, e.message);
      }

      // Loops rate limit: ~10 req/s — add small delay
      if (sent % 10 === 0 && sent > 0) await sleep(1100);
    }

    return jsonRes({
      success: true,
      venues: picked.map(v => v.name),
      recipients,
      sent,
      errors,
    });
  } catch (e) {
    console.error('[daily-deals] Error:', e.message);
    return jsonRes({ error: e.message }, 500);
  }
}

function getDayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now - start) / 86400000);
}

function formatCity(slug) {
  if (!slug) return '';
  return slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

function formatHours(v) {
  const days = Array.isArray(v.days) ? v.days.join(', ') : '';
  const time = v.hours || '';
  return [days, time].filter(Boolean).join(' · ');
}

// Distinct engaged user_ids for a city = everyone who's ever checked in there.
async function engagedUserIds(supabaseUrl, sbHeaders, slug) {
  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/check_ins?select=user_id&city_slug=eq.${slug}&user_id=not.is.null&limit=20000`,
      { headers: sbHeaders }
    );
    if (!r.ok) {
      const body = await r.text();
      console.error(`[daily-deals] check_ins recipients fetch failed for ${slug}:`, r.status, body);
      return [];
    }
    const rows = await r.json();
    return [...new Set(rows.map(x => x.user_id).filter(Boolean))];
  } catch (e) {
    console.error(`[daily-deals] check_ins recipients error for ${slug}:`, e.message);
    return [];
  }
}

// Set of user_ids whose profiles.digest_enabled is explicitly false (opted out).
async function digestDisabledSet(supabaseUrl, sbHeaders, ids) {
  const disabled = new Set();
  const chunk = 200; // keep the in.() URL a sane length
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    try {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/profiles?select=id&id=in.(${slice.join(',')})&digest_enabled=is.false`,
        { headers: sbHeaders }
      );
      if (r.ok) {
        const rows = await r.json();
        rows.forEach(p => disabled.add(p.id));
      } else {
        const body = await r.text();
        console.error('[daily-deals] digest_enabled fetch failed:', r.status, body);
      }
    } catch (e) {
      console.error('[daily-deals] digest_enabled error:', e.message);
    }
  }
  return disabled;
}

// Resolve a user's email via the Supabase admin API (cached; mirrors loops-inactive).
async function resolveEmail(supabaseUrl, svcKey, uid, cache) {
  if (uid in cache) return cache[uid];
  let email = null;
  try {
    const r = await fetch(`${supabaseUrl}/auth/v1/admin/users/${uid}`, {
      headers: { 'apikey': svcKey, 'Authorization': `Bearer ${svcKey}` },
    });
    if (r.ok) {
      const u = await r.json();
      if (u.email) email = u.email;
    } else {
      const body = await r.text();
      console.error(`[daily-deals] auth lookup failed for ${uid}:`, r.status, body);
    }
  } catch (e) {
    console.error(`[daily-deals] auth lookup error for ${uid}:`, e.message);
  }
  cache[uid] = email;
  return email;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
