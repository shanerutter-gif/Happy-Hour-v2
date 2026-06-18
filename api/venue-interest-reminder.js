export const config = { runtime: 'edge' };

// Behavioral re-engagement: "Still thinking about <venue>?"
//
// Fires off the `venue_modal_opened` analytics signal (logged by track() in
// js/app.js). For each signed-in user we look at the LAST venue they opened in
// their most recent session and, a couple of hours later, nudge them with a
// Loops `venue_interest` event — unless they've already returned, checked in,
// or been nudged today.
//
// Runs every couple of hours (Vercel Cron); the rules below make it idempotent
// and self-throttling, so the actual effect is at most one reminder per user
// per day:
//   * SETTLE   — only consider views that matured ≥ SETTLE_HOURS ago (give them
//                time to act before we email).
//   * LAST VENUE IN SESSION — anchor on the most recent venue_modal_opened; if
//                they viewed 4 places, we nudge about the last one.
//   * CANCEL ON RETURN — if the user has any analytics activity in a NEWER
//                session than that view (i.e. they came back / logged in again),
//                skip — they re-engaged on their own.
//   * LOCAL WINDOW — only send between SEND_START..SEND_END in the venue city's
//                timezone. A view that matures after 7pm is naturally held until
//                the next morning run (still within the 24h lookback).
//   * SUPPRESS — skip if they checked in at that venue, were already reminded
//                today, were reminded about this venue in the last 7 days, or
//                turned digests off.
//
// GET /api/venue-interest-reminder?key=<SERVICE_ROLE_KEY>  (or Vercel Cron secret)

const SETTLE_HOURS = 2;      // wait this long after the view before nudging
const LOOKBACK_HOURS = 24;   // ignore views older than this
const SEND_START = 9;        // earliest local hour to send (inclusive)
const SEND_END = 19;         // latest local hour to send (exclusive) → held past 7pm
const DAILY_COOLDOWN_HOURS = 20;  // ≤ 1 reminder per user per ~day
const VENUE_COOLDOWN_DAYS = 7;    // never the same venue twice within a week

// Active markets are all Pacific today; default keeps any new city sane until
// it's added here.
const CITY_TZ = {
  'san-diego': 'America/Los_Angeles',
  'orange-county': 'America/Los_Angeles',
};
const DEFAULT_TZ = 'America/Los_Angeles';

const SITE_URL = 'https://www.spotd.biz';

export default async function handler(req) {
  if (req.method !== 'GET') return jsonRes({ error: 'GET only' }, 405);

  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const loopsKey = process.env.LOOPS_API_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://opcskuzbdfrlnyhraysk.supabase.co';

  if (!svcKey) {
    console.error('[venue-interest] Missing SUPABASE_SERVICE_ROLE_KEY');
    return jsonRes({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }
  if (!loopsKey) {
    console.error('[venue-interest] Missing LOOPS_API_KEY');
    return jsonRes({ error: 'Missing LOOPS_API_KEY' }, 500);
  }

  // Auth: ?key=<SERVICE_ROLE_KEY> OR Vercel Cron's Bearer CRON_SECRET.
  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`;
  if (!isVercelCron && key !== svcKey) return jsonRes({ error: 'Unauthorized' }, 401);

  const sbHeaders = {
    'apikey': svcKey,
    'Authorization': `Bearer ${svcKey}`,
    'Content-Type': 'application/json',
  };

  const now = Date.now();
  const lookbackIso = new Date(now - LOOKBACK_HOURS * 3600e3).toISOString();
  const settleCutoff = now - SETTLE_HOURS * 3600e3;

  try {
    // 1. Pull recent authenticated activity. We grab ALL events (not just venue
    //    opens) so we can detect "returned in a newer session". Low volume today;
    //    revisit with a dedicated RPC if this table grows large.
    const evRes = await fetch(
      `${supabaseUrl}/rest/v1/analytics_events`
      + `?user_id=not.is.null`
      + `&created_at=gte.${lookbackIso}`
      + `&select=user_id,session_id,event_name,props,created_at`
      + `&order=created_at.desc&limit=10000`,
      { headers: sbHeaders }
    );
    if (!evRes.ok) {
      const body = await evRes.text();
      console.error('[venue-interest] analytics fetch failed:', evRes.status, body);
      return jsonRes({ error: 'analytics fetch failed', status: evRes.status, detail: body }, 502);
    }
    const events = await evRes.json();

    // 2. Group by user (events already sorted newest-first).
    const byUser = new Map();
    for (const e of events) {
      if (!byUser.has(e.user_id)) byUser.set(e.user_id, []);
      byUser.get(e.user_id).push(e);
    }

    // 3. Build candidates: last venue opened in the user's most recent session,
    //    matured, not yet returned, inside the local send window.
    const candidates = []; // { userId, venueId, venueName, citySlug }
    for (const [userId, evs] of byUser) {
      // Most recent venue_modal_opened (evs are newest-first).
      const lastView = evs.find(e => e.event_name === 'venue_modal_opened' && e.props && e.props.item_id);
      if (!lastView) continue;

      const viewTime = new Date(lastView.created_at).getTime();
      if (viewTime > settleCutoff) continue; // too fresh — catch a later run

      // Cancel on return: any activity in a DIFFERENT session after this view.
      const returned = evs.some(e =>
        e.session_id && e.session_id !== lastView.session_id &&
        new Date(e.created_at).getTime() > viewTime
      );
      if (returned) continue;

      const citySlug = lastView.props.city || '';
      const tz = CITY_TZ[citySlug] || DEFAULT_TZ;
      const hour = localHour(tz);
      if (hour < SEND_START || hour >= SEND_END) continue; // outside window → held

      candidates.push({
        userId,
        venueId: String(lastView.props.item_id),
        venueName: lastView.props.name || 'that spot',
        citySlug,
      });
    }

    if (!candidates.length) return jsonRes({ candidates: 0, sent: 0 });

    const userIds = [...new Set(candidates.map(c => c.userId))];

    // 4. Suppression sets (batched).
    // 4a. Already reminded today (any venue) / this venue in the last 7d.
    const dailyCutoff = new Date(now - DAILY_COOLDOWN_HOURS * 3600e3).toISOString();
    const venueCutoff = new Date(now - VENUE_COOLDOWN_DAYS * 86400e3).toISOString();
    const remindedTodayUsers = new Set();
    const remindedVenue = new Set(); // `${userId}:${venueId}`
    {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/venue_reminder_log`
        + `?user_id=in.(${userIds.join(',')})`
        + `&sent_at=gte.${venueCutoff}`
        + `&select=user_id,venue_id,sent_at`,
        { headers: sbHeaders }
      );
      if (r.ok) {
        for (const row of await r.json()) {
          if (row.sent_at >= dailyCutoff) remindedTodayUsers.add(row.user_id);
          remindedVenue.add(`${row.user_id}:${row.venue_id}`);
        }
      } else {
        console.error('[venue-interest] reminder_log fetch failed:', r.status, await r.text());
      }
    }

    // 4b. Already checked in at that venue (ever).
    const checkedIn = new Set(); // `${userId}:${venueId}`
    {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/check_ins`
        + `?user_id=in.(${userIds.join(',')})`
        + `&select=user_id,venue_id`,
        { headers: sbHeaders }
      );
      if (r.ok) {
        for (const row of await r.json()) checkedIn.add(`${row.user_id}:${row.venue_id}`);
      } else {
        console.error('[venue-interest] check_ins fetch failed:', r.status, await r.text());
      }
    }

    // 4c. Digest opt-out.
    const optedOut = new Set();
    {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/profiles`
        + `?id=in.(${userIds.join(',')})`
        + `&select=id,digest_enabled`,
        { headers: sbHeaders }
      );
      if (r.ok) {
        for (const p of await r.json()) if (p.digest_enabled === false) optedOut.add(p.id);
      }
    }

    // 5. Resolve venue details for the surviving candidates (neighborhood etc.).
    const survivors = candidates.filter(c =>
      !remindedTodayUsers.has(c.userId) &&
      !remindedVenue.has(`${c.userId}:${c.venueId}`) &&
      !checkedIn.has(`${c.userId}:${c.venueId}`) &&
      !optedOut.has(c.userId)
    );
    if (!survivors.length) return jsonRes({ candidates: candidates.length, sent: 0 });

    const venueIds = [...new Set(survivors.map(c => c.venueId))];
    const venueMap = {};
    {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/venues`
        + `?id=in.(${venueIds.join(',')})`
        + `&select=id,name,neighborhood,city_slug,active`,
        { headers: sbHeaders }
      );
      if (r.ok) for (const v of await r.json()) venueMap[v.id] = v;
      else console.error('[venue-interest] venues fetch failed:', r.status, await r.text());
    }

    const loopsHeaders = { 'Authorization': `Bearer ${loopsKey}`, 'Content-Type': 'application/json' };
    const emailCache = {};
    let sent = 0, errors = 0, skipped = 0;

    for (const c of survivors) {
      const v = venueMap[c.venueId];
      if (!v || v.active === false) { skipped++; continue; } // venue gone/inactive

      const email = await resolveEmail(supabaseUrl, svcKey, c.userId, emailCache);
      if (!email) { skipped++; continue; }

      const citySlug = v.city_slug || c.citySlug || '';
      const props = {
        venueName: v.name || c.venueName,
        neighborhood: v.neighborhood || '',
        citySlug,
        cityName: formatCity(citySlug),
        venueUrl: `${SITE_URL}/spots/${slugify(v.name || c.venueName)}`,
      };

      try {
        const er = await fetch('https://app.loops.so/api/v1/events/send', {
          method: 'POST',
          headers: loopsHeaders,
          body: JSON.stringify({ email, eventName: 'venue_interest', eventProperties: props }),
        });
        if (!er.ok) {
          errors++;
          console.error(`[venue-interest] send failed for ${email}:`, er.status, await er.text());
          continue;
        }
      } catch (e) {
        errors++;
        console.error(`[venue-interest] send error for ${email}:`, e.message);
        continue;
      }

      // Stamp the ledger so we don't nag again today / for this venue this week.
      try {
        await fetch(`${supabaseUrl}/rest/v1/venue_reminder_log`, {
          method: 'POST',
          headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ user_id: c.userId, venue_id: c.venueId, venue_name: props.venueName }),
        });
      } catch (e) {
        console.error(`[venue-interest] log insert error for ${c.userId}:`, e.message);
      }

      sent++;
      if (sent % 10 === 0) await sleep(1100); // Loops ~10 req/s
    }

    return jsonRes({ candidates: candidates.length, eligible: survivors.length, sent, errors, skipped });
  } catch (e) {
    console.error('[venue-interest] Error:', e.message);
    return jsonRes({ error: e.message }, 500);
  }
}

// Current hour (0–23) in a given IANA timezone.
function localHour(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
    return h === 24 ? 0 : h; // some engines emit "24" at midnight
  } catch {
    return new Date().getUTCHours();
  }
}

function slugify(name) {
  return String(name || '').toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatCity(slug) {
  if (!slug) return '';
  return slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// Resolve a user's email via the Supabase admin API (cached; mirrors daily-deals).
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
      console.error(`[venue-interest] auth lookup failed for ${uid}:`, r.status, await r.text());
    }
  } catch (e) {
    console.error(`[venue-interest] auth lookup error for ${uid}:`, e.message);
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
