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
    // 1. Active cities — everything keys off this table, so activating a new
    //    market (LA, NYC…) automatically gives its users a digest, no code change.
    const citiesRes = await fetch(`${supabaseUrl}/rest/v1/cities?select=slug,name&active=eq.true`, { headers: sbHeaders });
    if (!citiesRes.ok) {
      const body = await citiesRes.text();
      console.error('[daily-deals] cities fetch failed:', citiesRes.status, body);
      throw new Error(`Failed to fetch cities: ${citiesRes.status} ${body}`);
    }
    const cities = await citiesRes.json();
    if (!cities.length) {
      console.error('[daily-deals] No active cities found');
      return jsonRes({ error: 'No active cities' }, 400);
    }

    // 2. Fetch active venues that have deals, grouped by city.
    //    NOTE: venues has a single `hours` text column — there is NO
    //    hours_start/hours_end (naming them here previously 400'd the query).
    const r = await fetch(
      `${supabaseUrl}/rest/v1/venues?select=id,name,neighborhood,city_slug,deals,hours,days&active=eq.true&deals=not.is.null&limit=2000`,
      { headers: sbHeaders }
    );
    if (!r.ok) {
      const body = await r.text();
      console.error('[daily-deals] venues fetch failed:', r.status, body);
      throw new Error(`Failed to fetch venues: ${r.status} ${body}`);
    }
    const allVenues = (await r.json()).filter(v => Array.isArray(v.deals) && v.deals.length > 0);
    const byCity = {};
    for (const v of allVenues) (byCity[v.city_slug] = byCity[v.city_slug] || []).push(v);

    const dayOfYear = getDayOfYear();
    const dateFormatted = new Date().toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    });
    const loopsHeaders = {
      'Authorization': `Bearer ${loopsKey}`,
      'Content-Type': 'application/json',
    };

    // 3. Per active city: pick that city's deal venues (rotated daily), build
    //    props, and send daily_deals to that city's subscribers
    //    (profiles.city_slug = slug, digest not turned off).
    const emailCache = {};
    const perCity = {};
    let sent = 0, errors = 0, recipients = 0;

    for (const c of cities) {
      const cityVenues = byCity[c.slug] || [];
      if (!cityVenues.length) {
        console.error(`[daily-deals] No deal venues for ${c.slug} — skipping`);
        perCity[c.slug] = { venues: [], recipients: 0, sent: 0 };
        continue;
      }

      // Pick up to 3, rotating daily by day-of-year (within this city's list).
      const take = Math.min(3, cityVenues.length);
      const offset = (dayOfYear * 3) % cityVenues.length;
      const picked = [];
      for (let i = 0; i < take; i++) picked.push(cityVenues[(offset + i) % cityVenues.length]);

      const props = { cityName: c.name, date_formatted: dateFormatted };
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

      const userIds = await cityRecipientIds(supabaseUrl, sbHeaders, c.slug);
      let citySent = 0, cityRecipients = 0;
      for (const uid of userIds) {
        const email = await resolveEmail(supabaseUrl, svcKey, uid, emailCache);
        if (!email) continue;
        cityRecipients++; recipients++;
        try {
          const er = await fetch('https://app.loops.so/api/v1/events/send', {
            method: 'POST',
            headers: loopsHeaders,
            body: JSON.stringify({
              email,
              eventName: 'daily_deals',
              eventProperties: props,
            }),
          });
          if (er.ok) { sent++; citySent++; }
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
      perCity[c.slug] = { venues: picked.map(v => v.name), recipients: cityRecipients, sent: citySent };
    }

    return jsonRes({
      success: true,
      cities: cities.map(c => c.slug),
      recipients,
      sent,
      errors,
      perCity,
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

// Recipient user_ids for a city = profiles whose city_slug matches and who
// haven't turned the digest off (digest_enabled is true or null). Paginated.
async function cityRecipientIds(supabaseUrl, sbHeaders, slug) {
  const ids = [];
  const pageSize = 1000;
  let offset = 0;
  for (;;) {
    try {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/profiles?select=id,digest_enabled&city_slug=eq.${slug}&limit=${pageSize}&offset=${offset}`,
        { headers: sbHeaders }
      );
      if (!r.ok) {
        const body = await r.text();
        console.error(`[daily-deals] profiles recipients fetch failed for ${slug}:`, r.status, body);
        break;
      }
      const rows = await r.json();
      for (const p of rows) if (p.digest_enabled !== false) ids.push(p.id);
      if (rows.length < pageSize) break;
      offset += pageSize;
    } catch (e) {
      console.error(`[daily-deals] profiles recipients error for ${slug}:`, e.message);
      break;
    }
  }
  return ids;
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
