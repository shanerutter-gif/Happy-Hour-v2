export const config = { runtime: 'edge' };

// Weekly Digest — runs once per week via Vercel Cron (Thursdays).
// For each active city, ranks the week's top spots (by check-ins, falling back
// to top-rated venues with deals) and sends a `weekly_digest` Loops event to
// every engaged user in that city. Recipients come from the DATABASE (distinct
// check_ins.user_id per city, emails resolved via the Supabase admin API) —
// Loops has no list-all-contacts endpoint. The email body itself lives in Loops
// — we only send the event + properties (cityName + 3-5 spot names/deals).
// GET /api/weekly-digest   (Vercel Cron: Authorization: Bearer <CRON_SECRET>)
// GET /api/weekly-digest?key=<SERVICE_ROLE_KEY>   (manual trigger)

export default async function handler(req) {
  if (req.method !== 'GET') return jsonRes({ error: 'GET only' }, 405);

  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const loopsKey = process.env.LOOPS_API_KEY;
  const cronSecret = process.env.CRON_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://opcskuzbdfrlnyhraysk.supabase.co';

  if (!svcKey) {
    console.error('[weekly-digest] Missing env var SUPABASE_SERVICE_ROLE_KEY');
    return jsonRes({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }
  if (!loopsKey) {
    console.error('[weekly-digest] Missing env var LOOPS_API_KEY');
    return jsonRes({ error: 'Missing LOOPS_API_KEY' }, 500);
  }

  // Auth: validate CRON_SECRET (Vercel Cron) or a manual ?key=<SERVICE_ROLE_KEY>.
  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  const isVercelCron = cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`;
  const isManual = key && key === svcKey;
  if (!isVercelCron && !isManual) {
    console.error('[weekly-digest] Unauthorized — CRON_SECRET header or ?key did not match');
    return jsonRes({ error: 'Unauthorized' }, 401);
  }

  const sbHeaders = {
    'apikey': svcKey,
    'Authorization': `Bearer ${svcKey}`,
    'Content-Type': 'application/json',
  };
  const loopsHeaders = {
    'Authorization': `Bearer ${loopsKey}`,
    'Content-Type': 'application/json',
  };

  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  try {
    // 1. Active cities (the cities table `active` flag = launched markets).
    const cr = await fetch(`${supabaseUrl}/rest/v1/cities?select=slug,name&active=eq.true`, { headers: sbHeaders });
    if (!cr.ok) {
      const body = await cr.text();
      console.error('[weekly-digest] cities fetch failed:', cr.status, body);
      return jsonRes({ error: 'cities fetch failed', status: cr.status, detail: body }, 502);
    }
    const cities = await cr.json();
    if (!cities.length) {
      console.error('[weekly-digest] No active cities found');
      return jsonRes({ error: 'No active cities' }, 400);
    }

    // 2. Rank the week's top spots per city.
    const cityProps = {}; // slug -> { cityName, spots:[{name,deal}], props }
    for (const c of cities) {
      const spots = await rankTopSpots(supabaseUrl, sbHeaders, c.slug, weekAgo);
      if (!spots.length) {
        console.error(`[weekly-digest] No rankable spots for ${c.slug} — skipping city`);
        continue;
      }
      const props = { cityName: c.name };
      spots.forEach((s, i) => {
        props[`spot${i + 1}_name`] = s.name;
        props[`spot${i + 1}_deal`] = s.deal;
      });
      cityProps[c.slug] = { cityName: c.name, props };
    }

    if (!Object.keys(cityProps).length) {
      return jsonRes({ success: true, sent: 0, note: 'No cities had rankable spots' });
    }

    // 3. Resolve recipients from the database (Loops has no list-all endpoint):
    //    engaged users = distinct check_ins.user_id for the city. Skip anyone
    //    with profiles.digest_enabled = false; resolve emails via the admin API.
    // 4. Send weekly_digest (with that city's props) to each resolved email.
    const emailCache = {};   // user_id -> email | null (dedupe auth lookups across cities)
    const perCity = {};
    let sent = 0, errors = 0, recipients = 0;

    for (const slug of Object.keys(cityProps)) {
      const digest = cityProps[slug];
      const userIds = await engagedUserIds(supabaseUrl, sbHeaders, slug);
      if (!userIds.length) { perCity[slug] = 0; continue; }
      const disabled = await digestDisabledSet(supabaseUrl, sbHeaders, userIds);

      let citySent = 0;
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
              eventName: 'weekly_digest',
              ...digest.props,
            }),
          });
          if (er.ok) { sent++; citySent++; }
          else {
            errors++;
            const body = await er.text();
            console.error(`[weekly-digest] weekly_digest send failed for ${email}:`, er.status, body);
          }
        } catch (e) {
          errors++;
          console.error(`[weekly-digest] weekly_digest send error for ${email}:`, e.message);
        }
        // Loops rate limit (~10 req/s): small pause every 10 sends.
        if (sent % 10 === 0 && sent > 0) await sleep(1100);
      }
      perCity[slug] = citySent;
    }

    return jsonRes({
      success: true,
      cities: Object.keys(cityProps),
      recipients,
      sent,
      errors,
      perCity,
    });
  } catch (e) {
    console.error('[weekly-digest] Error:', e.message);
    return jsonRes({ error: e.message }, 500);
  }
}

// Returns up to 5 {name, deal} spots for a city: the week's most-checked-in
// venues first, topped up with the highest-rated active venues that have deals.
async function rankTopSpots(supabaseUrl, sbHeaders, slug, weekAgo) {
  const out = [];
  const seen = new Set();

  // Week's check-ins for this city → count by venue.
  try {
    const ckRes = await fetch(
      `${supabaseUrl}/rest/v1/check_ins?select=venue_id&city_slug=eq.${slug}&created_at=gte.${weekAgo}&venue_id=not.is.null&limit=5000`,
      { headers: sbHeaders }
    );
    if (ckRes.ok) {
      const rows = await ckRes.json();
      const counts = {};
      for (const r of rows) counts[r.venue_id] = (counts[r.venue_id] || 0) + 1;
      const ranked = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
      if (ranked.length) {
        const ids = ranked.slice(0, 5);
        const vRes = await fetch(
          `${supabaseUrl}/rest/v1/venues?select=id,name,deals&id=in.(${ids.join(',')})`,
          { headers: sbHeaders }
        );
        if (vRes.ok) {
          const venues = await vRes.json();
          const vMap = {}; venues.forEach(v => { vMap[v.id] = v; });
          for (const id of ids) {
            const v = vMap[id];
            if (v && !seen.has(v.id)) { seen.add(v.id); out.push(toSpot(v)); }
            if (out.length >= 5) break;
          }
        }
      }
    } else {
      const body = await ckRes.text();
      console.error(`[weekly-digest] check_ins fetch failed for ${slug}:`, ckRes.status, body);
    }
  } catch (e) {
    console.error(`[weekly-digest] check-in ranking error for ${slug}:`, e.message);
  }

  // Top up with highest-rated active venues that have deals.
  if (out.length < 3) {
    try {
      const fRes = await fetch(
        `${supabaseUrl}/rest/v1/venues?select=id,name,deals,google_rating&city_slug=eq.${slug}&active=eq.true&deals=not.is.null&order=google_rating.desc.nullslast&limit=25`,
        { headers: sbHeaders }
      );
      if (fRes.ok) {
        const venues = await fRes.json();
        for (const v of venues) {
          if (!Array.isArray(v.deals) || !v.deals.length) continue;
          if (seen.has(v.id)) continue;
          seen.add(v.id); out.push(toSpot(v));
          if (out.length >= 5) break;
        }
      } else {
        const body = await fRes.text();
        console.error(`[weekly-digest] fallback venues fetch failed for ${slug}:`, fRes.status, body);
      }
    } catch (e) {
      console.error(`[weekly-digest] fallback ranking error for ${slug}:`, e.message);
    }
  }

  return out.slice(0, 5);
}

function toSpot(v) {
  const deal = Array.isArray(v.deals) && v.deals.length ? String(v.deals[0]) : '';
  return { name: v.name, deal };
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
      console.error(`[weekly-digest] check_ins recipients fetch failed for ${slug}:`, r.status, body);
      return [];
    }
    const rows = await r.json();
    return [...new Set(rows.map(x => x.user_id).filter(Boolean))];
  } catch (e) {
    console.error(`[weekly-digest] check_ins recipients error for ${slug}:`, e.message);
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
        console.error('[weekly-digest] digest_enabled fetch failed:', r.status, body);
      }
    } catch (e) {
      console.error('[weekly-digest] digest_enabled error:', e.message);
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
      console.error(`[weekly-digest] auth lookup failed for ${uid}:`, r.status, body);
    }
  } catch (e) {
    console.error(`[weekly-digest] auth lookup error for ${uid}:`, e.message);
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
