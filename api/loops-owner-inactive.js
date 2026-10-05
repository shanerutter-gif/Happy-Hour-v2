export const config = { runtime: 'edge' };

// GET /api/loops-owner-inactive?key=<SERVICE_ROLE_KEY>[&dry=1]
// Business-owner counterpart of /api/loops-inactive. Finds APPROVED venue
// claims whose owner has not touched their listing in 7+/30+ days and fires
// Loops owner lifecycle events (owner.inactive_7d / owner.inactive_30d) so
// Loops can run the owner retention emails.
//
// Also fires the onboarding nudge events owner.nudge_3d / owner.nudge_10d:
// exactly once per claim, only when the owner has NOT touched their listing
// since approval. (Loops cannot express "no venue.listing_updated since
// approval" as a workflow condition, so the guard is evaluated here and the
// Loops nudge workflows trigger on these dedicated events with no timer.)
//
// Owner activity ("last touch") is the max of:
//   1. venues.owner_last_update_at        (stamped by the business portal on
//                                          approved-owner saves)
//   2. latest venue_edit_proposals.created_at for that owner+venue (fallback —
//      every portal save writes a proposal, so a blocked stamp can't cause a
//      wrong nudge)
//   3. claim approved_at (else created_at) — the clock start for owners who
//      never edited anything.
//
// Dedup: stamps venue_claims.owner_reengaged_7d_at / owner_reengaged_30d_at
// after each successful send, so each owner gets each nudge at most once.
// The 30d band takes precedence so a long-dormant owner gets a single
// owner.inactive_30d, not both events in one run.
//
// ?dry=1 computes cohorts and returns them without sending events, stamping
// claims, or writing analytics — safe for testing.
// Auth: ?key=<SERVICE_ROLE_KEY> or Vercel Cron's CRON_SECRET bearer.

const DAY = 86400000;

// Pure cohort classification — exported for unit tests.
// claims: rows with { id, contact_email, venue_id, user_id, approved_at,
//   created_at, owner_reengaged_7d_at, owner_reengaged_30d_at, venue: { owner_last_update_at } }
// proposalMax: Map "venueId|userId" -> ISO timestamp of latest proposal
export function classifyOwnerCohorts(claims, proposalMax, nowMs) {
  const sevenDaysAgo  = nowMs - 7 * DAY;
  const thirtyDaysAgo = nowMs - 30 * DAY;
  const cohort7 = [];
  const cohort30 = [];
  for (const c of claims) {
    if (!c.contact_email || !c.venue_id) continue;
    const signals = [
      c.venue && c.venue.owner_last_update_at,
      proposalMax.get(`${c.venue_id}|${c.user_id}`),
      c.approved_at,
      c.created_at,
    ];
    let last = 0;
    for (const s of signals) {
      if (!s) continue;
      const t = new Date(s).getTime();
      if (!Number.isNaN(t) && t > last) last = t;
    }
    if (!last) continue;
    // 30d band takes precedence so we never double-send in one run.
    if (last <= thirtyDaysAgo && !c.owner_reengaged_30d_at) {
      cohort30.push({ claim: c, lastActivity: new Date(last).toISOString() });
    } else if (last <= sevenDaysAgo && !c.owner_reengaged_7d_at) {
      cohort7.push({ claim: c, lastActivity: new Date(last).toISOString() });
    }
  }
  return { cohort7, cohort30 };
}

// ── Nudge cohorts (day-3 / day-10 onboarding nudges) ──
// Fires owner.nudge_3d / owner.nudge_10d exactly once per claim, ONLY when the
// owner has not touched their listing since approval. Loops cannot express
// "no venue.listing_updated since approval" as a workflow condition, so the
// guard lives here: the cron evaluates it and fires a dedicated event per
// nudge, and the Loops workflows trigger on those events with no timer.
// Catch-up pacing: if a claim somehow missed its day-3 window (cron outage),
// it gets nudge_3d first and nudge_10d on the next run — never both same-day.
export function classifyNudgeCohorts(claims, proposalMax, nowMs) {
  const nudge3 = [];
  const nudge10 = [];
  for (const c of claims) {
    if (!c.contact_email || !c.venue_id) continue;
    const clockStart = c.approved_at || c.created_at;
    if (!clockStart) continue;
    const startMs = new Date(clockStart).getTime();
    if (Number.isNaN(startMs) || nowMs - startMs < 0) continue;
    // Owner touch = any owner-attributed edit AFTER the approval moment.
    let touched = false;
    const stamp = c.venue && c.venue.owner_last_update_at;
    if (stamp && new Date(stamp).getTime() > startMs) touched = true;
    const prop = proposalMax.get(`${c.venue_id}|${c.user_id}`);
    if (prop && new Date(prop).getTime() > startMs) touched = true;
    if (touched) continue;
    const age = nowMs - startMs;
    if (age >= 3 * DAY && !c.owner_nudged_3d_at) {
      nudge3.push({ claim: c, ageDays: +(age / DAY).toFixed(1) });
    } else if (age >= 10 * DAY && !c.owner_nudged_10d_at) {
      nudge10.push({ claim: c, ageDays: +(age / DAY).toFixed(1) });
    }
  }
  return { nudge3, nudge10 };
}

export default async function handler(req) {
  if (req.method !== 'GET') return jsonRes({ error: 'GET only' }, 405);

  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  const dry = url.searchParams.get('dry') === '1';
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const loopsKey = process.env.LOOPS_API_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://opcskuzbdfrlnyhraysk.supabase.co';

  if (!svcKey) {
    console.error('[loops-owner-inactive] Missing env var SUPABASE_SERVICE_ROLE_KEY');
    return jsonRes({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }
  if (!loopsKey && !dry) {
    console.error('[loops-owner-inactive] Missing env var LOOPS_API_KEY');
    return jsonRes({ error: 'Missing LOOPS_API_KEY' }, 500);
  }

  // Auth: accept either ?key=<SERVICE_ROLE_KEY> or Vercel Cron's CRON_SECRET header
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`;
  if (!isVercelCron && key !== svcKey) return jsonRes({ error: 'Unauthorized' }, 401);

  const headers = {
    'apikey': svcKey,
    'Authorization': `Bearer ${svcKey}`,
    'Content-Type': 'application/json',
  };
  const loopsHeaders = {
    'Authorization': `Bearer ${loopsKey}`,
    'Content-Type': 'application/json',
  };
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  try {
    // 1. Approved claims + venue activity stamp. The `or=` pre-filter keeps the
    //    scan cheap: only claims missing at least one nudge stamp are candidates.
    const selUrl = `${supabaseUrl}/rest/v1/venue_claims`
      + `?status=eq.approved`
      + `&select=id,contact_name,contact_email,venue_id,user_id,approved_at,created_at,owner_reengaged_7d_at,owner_reengaged_30d_at,owner_nudged_3d_at,owner_nudged_10d_at,venue:venues(name,owner_last_update_at)`
      + `&or=(owner_reengaged_7d_at.is.null,owner_reengaged_30d_at.is.null,owner_nudged_3d_at.is.null,owner_nudged_10d_at.is.null)`
      + `&limit=2000`;
    const res = await fetch(selUrl, { headers });
    if (!res.ok) {
      const body = await res.text();
      console.error('[loops-owner-inactive] claims fetch failed:', res.status, body);
      return jsonRes({ error: 'claims fetch failed', status: res.status, detail: body }, 502);
    }
    const claims = await res.json();

    // 2. Proposal fallback: latest edit proposal per (venue, owner). Bounded to
    //    candidate venues so the query stays small.
    const proposalMax = new Map();
    const venueIds = [...new Set(claims.map(c => c.venue_id).filter(Boolean))];
    if (venueIds.length) {
      const pUrl = `${supabaseUrl}/rest/v1/venue_edit_proposals`
        + `?venue_id=in.(${venueIds.map(encodeURIComponent).join(',')})`
        + `&select=venue_id,proposed_by,created_at`
        + `&order=created_at.desc&limit=5000`;
      const pr = await fetch(pUrl, { headers });
      if (pr.ok) {
        const proposals = await pr.json();
        for (const p of proposals) {
          const k = `${p.venue_id}|${p.proposed_by}`;
          if (!proposalMax.has(k)) proposalMax.set(k, p.created_at); // desc order → first wins
        }
      } else {
        console.error('[loops-owner-inactive] proposals fetch failed:', pr.status, (await pr.text()).slice(0, 200));
      }
    }

    const { cohort7, cohort30 } = classifyOwnerCohorts(claims, proposalMax, nowMs);
    let { nudge3, nudge10 } = classifyNudgeCohorts(claims, proposalMax, nowMs);
    // Pacing: a claim already getting the 30d dormant email doesn't also get a
    // nudge in the same run — one email per owner per run. (cohort7 has no
    // email workflow attached, so it needs no such guard.)
    const in30 = new Set(cohort30.map(e => e.claim.id));
    nudge3 = nudge3.filter(e => !in30.has(e.claim.id));
    nudge10 = nudge10.filter(e => !in30.has(e.claim.id));

    if (dry) {
      return jsonRes({
        dry: true,
        candidates: claims.length,
        cohort7: cohort7.map(e => summarize(e)),
        cohort30: cohort30.map(e => summarize(e)),
        nudge3: nudge3.map(e => summarize(e)),
        nudge10: nudge10.map(e => summarize(e)),
      });
    }

    if (!cohort7.length && !cohort30.length && !nudge3.length && !nudge10.length) {
      return jsonRes({ sent7: 0, sent30: 0, sentNudge3: 0, sentNudge10: 0, candidates: claims.length });
    }

    const ctx = { headers, loopsHeaders, supabaseUrl, nowIso };
    let sent7 = 0, sent30 = 0, sentNudge3 = 0, sentNudge10 = 0;
    sent30 = await processCohort(ctx, cohort30, 'owner.inactive_30d', 'owner_reengaged_30d_at');
    sent7  = await processCohort(ctx, cohort7,  'owner.inactive_7d',  'owner_reengaged_7d_at');
    sentNudge3  = await processCohort(ctx, nudge3,  'owner.nudge_3d',  'owner_nudged_3d_at');
    sentNudge10 = await processCohort(ctx, nudge10, 'owner.nudge_10d', 'owner_nudged_10d_at');

    return jsonRes({ sent7, sent30, sentNudge3, sentNudge10, cohort7: cohort7.length, cohort30: cohort30.length, nudge3: nudge3.length, nudge10: nudge10.length });
  } catch (e) {
    console.error('[loops-owner-inactive] Error:', e.message);
    return jsonRes({ error: e.message }, 500);
  }
}

function summarize({ claim, lastActivity }) {
  return {
    claim_id: claim.id,
    email: claim.contact_email,
    venue_id: claim.venue_id,
    venue_name: (claim.venue && claim.venue.name) || null,
    lastActivity,
    approved_at: claim.approved_at || null,
  };
}

// Sends one Loops event per cohort member, stamps the claim's dedup column,
// and mirrors the event into analytics_events (owner-attributed).
async function processCohort(ctx, cohort, eventName, stampCol) {
  const { headers, loopsHeaders, supabaseUrl, nowIso } = ctx;
  let sent = 0;
  for (const { claim } of cohort) {
    const email = claim.contact_email;
    const firstName = String(claim.contact_name || '').trim().split(/\s+/)[0] || 'there';
    const venueName = (claim.venue && claim.venue.name) || '';
    try {
      const er = await fetch('https://app.loops.so/api/v1/events/send', {
        method: 'POST',
        headers: loopsHeaders,
        body: JSON.stringify({
          email,
          eventName,
          eventProperties: {
            firstName,
            venueName,
            venueId: claim.venue_id,
            portalUrl: 'https://www.spotd.biz/business-portal.html',
          },
        }),
      });
      if (!er.ok) {
        const body = await er.text();
        console.error(`[loops-owner-inactive] ${eventName} send failed for ${email}:`, er.status, body);
        continue;
      }
    } catch (e) {
      console.error(`[loops-owner-inactive] ${eventName} send error for ${email}:`, e.message);
      continue;
    }
    // Stamp the claim so this nudge never re-sends.
    try {
      const pr = await fetch(`${supabaseUrl}/rest/v1/venue_claims?id=eq.${claim.id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ [stampCol]: nowIso }),
      });
      if (!pr.ok) {
        console.error(`[loops-owner-inactive] stamp ${stampCol} failed for claim ${claim.id}:`, pr.status, (await pr.text()).slice(0, 200));
      }
    } catch (e) {
      console.error(`[loops-owner-inactive] stamp error ${stampCol} for claim ${claim.id}:`, e.message);
    }
    // First-party analytics mirror (owner-attributed) for Traffic Analytics.
    try {
      await fetch(`${supabaseUrl}/rest/v1/analytics_events`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=minimal' },
        body: JSON.stringify([{
          user_id: claim.user_id || null,
          event_name: eventName,
          props: { venue_id: claim.venue_id, venue_name: venueName || null, claim_id: claim.id },
          path: '/api/loops-owner-inactive',
          platform: 'web',
        }]),
      });
    } catch (e) {
      console.error(`[loops-owner-inactive] analytics mirror failed for claim ${claim.id}:`, e.message);
    }
    sent++;
  }
  return sent;
}

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
