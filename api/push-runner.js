// api/push-runner.js — Node serverless function (NOT Edge; APNs needs HTTP/2).
//
// The Push Center engine, run by Vercel Cron every 15 minutes (see
// vercel.json). Two modes, both run by default:
//
//   Mode A (scheduler):   processes due push_campaigns rows
//                         (status=scheduled AND send_at <= now). Recurring
//                         campaigns (cron expr in `recurrence`) get send_at
//                         advanced to the next occurrence instead of being
//                         marked sent.
//   Mode B (automations): evaluates enabled push_automations against live
//                         data (inactive_days, first_favorite,
//                         going_tonight_threshold, new_venue_in_city) and
//                         sends per-user templated pushes, respecting each
//                         automation's cooldown via push_automation_log.
//
// Auth (any of):
//   Authorization: Bearer ${PUSH_API_KEY}       (admin UI / manual)
//   Authorization: Bearer ${CRON_SECRET}        (Vercel Cron sends this
//                                                automatically when the env
//                                                var is defined)
//   ?key=${SUPABASE_SERVICE_ROLE_KEY}           (manual trigger, repo cron
//                                                convention)
// Optional: ?mode=campaigns|automations to run a single mode.

import { sendApnsBatch, cleanupDeadTokens, saveInAppNotifications } from './_lib/apns.js';

const MAX_SENDS_PER_AUTOMATION_RUN = 500; // safety cap per automation per run

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL
    || process.env.NEXT_PUBLIC_SUPABASE_URL
    || 'https://opcskuzbdfrlnyhraysk.supabase.co';
  const svcKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svcKey) {
    console.error('[push-runner] Missing SUPABASE_SERVICE_KEY / SUPABASE_SERVICE_ROLE_KEY');
    return res.status(500).json({ error: 'Missing Supabase service key env var' });
  }

  const authHeader = req.headers['authorization'] || '';
  const pushKey = process.env.PUSH_API_KEY;
  const cronSecret = process.env.CRON_SECRET;
  const urlKey = req.query?.key;
  const authorized =
    (pushKey && authHeader === `Bearer ${pushKey}`) ||
    (cronSecret && authHeader === `Bearer ${cronSecret}`) ||
    (urlKey && urlKey === svcKey);
  if (!authorized) return res.status(401).json({ error: 'Unauthorized' });

  const ctx = {
    supabaseUrl,
    headers: {
      'apikey': svcKey,
      'Authorization': `Bearer ${svcKey}`,
      'Content-Type': 'application/json',
    },
    now: new Date(),
  };

  const mode = req.query?.mode || 'all';
  const out = { success: true, ran_at: ctx.now.toISOString() };

  try {
    if (mode === 'all' || mode === 'campaigns') {
      out.campaigns = await processCampaigns(ctx);
    }
    if (mode === 'all' || mode === 'automations') {
      out.automations = await processAutomations(ctx);
    }
  } catch (e) {
    console.error('[push-runner] fatal:', e.message);
    return res.status(500).json({ error: e.message, ...out, success: false });
  }

  return res.status(200).json(out);
}

// ── Supabase REST helpers ───────────────────────────────────────
async function sbGet(ctx, pathAndQuery) {
  const r = await fetch(`${ctx.supabaseUrl}/rest/v1/${pathAndQuery}`, { headers: ctx.headers });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Supabase GET ${pathAndQuery.split('?')[0]} failed: ${r.status} ${body.slice(0, 200)}`);
  }
  return r.json();
}

async function sbPatch(ctx, pathAndQuery, body) {
  const r = await fetch(`${ctx.supabaseUrl}/rest/v1/${pathAndQuery}`, {
    method: 'PATCH',
    headers: { ...ctx.headers, 'Prefer': 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Supabase PATCH failed: ${r.status} ${text.slice(0, 200)}`);
  }
}

async function sbInsert(ctx, table, rows) {
  if (!rows.length) return;
  const r = await fetch(`${ctx.supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...ctx.headers, 'Prefer': 'return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    console.error(`[push-runner] insert into ${table} failed:`, r.status, text.slice(0, 200));
  }
}

// Fetch iOS push tokens, optionally restricted to a set of user ids.
// Returns [{ token, platform, user_id }].
async function fetchTokens(ctx, userIds) {
  let q = 'push_tokens?select=token,platform,user_id&platform=in.(ios,native)';
  if (userIds === null || userIds === undefined) {
    return sbGet(ctx, q + '&limit=10000');
  }
  if (!userIds.length) return [];
  // Chunk the in.() filter so huge audiences don't blow the URL length.
  const all = [];
  for (let i = 0; i < userIds.length; i += 200) {
    const chunk = userIds.slice(i, i + 200);
    all.push(...await sbGet(ctx, `${q}&user_id=in.(${chunk.join(',')})`));
  }
  return all;
}

// ── Mode A: scheduled campaigns ─────────────────────────────────
async function processCampaigns(ctx) {
  const nowIso = ctx.now.toISOString();
  const due = await sbGet(ctx,
    `push_campaigns?select=*&status=eq.scheduled&send_at=lte.${nowIso}&order=send_at.asc&limit=20`);

  const summaries = [];
  for (const c of due) {
    const summary = { id: c.id, title: c.title };
    try {
      const userIds = await resolveAudienceUserIds(ctx, c.audience);
      const tokens = await fetchTokens(ctx, userIds);

      let result = { sent: 0, total: tokens.length, errors: undefined };
      if (tokens.length) {
        const batch = await sendApnsBatch(
          tokens,
          { title: c.title, body: c.body, url: c.url || '/', tag: 'campaign-' + c.id.slice(0, 8) },
          { sandbox: false }
        );
        if (batch.deadTokens.length) await cleanupDeadTokens(batch.deadTokens);
        if (batch.sent > 0) {
          // Mirror into the in-app bell panel for delivered users
          const tokenUser = new Map(tokens.map(t => [t.token, t.user_id]));
          const okUserIds = batch.results.filter(r => r.ok).map(r => tokenUser.get(r.token)).filter(Boolean);
          await saveInAppNotifications(okUserIds, { title: c.title, body: c.body, url: c.url || '/' });
        }
        result = { sent: batch.sent, total: tokens.length, errors: batch.errors.length ? batch.errors : undefined };
      }

      const patch = { sent_at: nowIso, result };
      if (c.recurrence) {
        const next = nextCronOccurrence(c.recurrence, ctx.now);
        if (next) {
          patch.send_at = next.toISOString();
        } else {
          // Unparseable cron — complete the campaign rather than re-firing
          // it on every runner tick.
          patch.status = 'sent';
          result.errors = (result.errors || []).concat([{ error: `Invalid recurrence "${c.recurrence}" — campaign completed` }]);
        }
      } else {
        patch.status = 'sent';
      }
      await sbPatch(ctx, `push_campaigns?id=eq.${c.id}`, patch);
      summary.sent = result.sent;
      summary.total = result.total;
      summary.next_send_at = patch.send_at || null;
    } catch (e) {
      console.error('[push-runner] campaign', c.id, 'failed:', e.message);
      summary.error = e.message;
      // Leave the row scheduled so a transient failure retries next tick.
    }
    summaries.push(summary);
  }
  return { due: due.length, processed: summaries };
}

// audience: {"type":"all"} | {"type":"user_ids","user_ids":[...]} |
//           {"type":"city_slug","city_slug":...} | {"type":"platform","platform":...}
// Returns null for "all" (= no user filter on the token query).
async function resolveAudienceUserIds(ctx, audience) {
  const a = audience || { type: 'all' };
  if (a.type === 'all') return null;
  if (a.type === 'user_ids') return a.user_ids || [];
  if (a.type === 'city_slug') {
    const rows = await sbGet(ctx, `profiles?select=id&city_slug=eq.${encodeURIComponent(a.city_slug)}&limit=10000`);
    return rows.map(r => r.id);
  }
  if (a.type === 'platform') {
    // iOS-only today, but keep the shape future-proof
    const filter = a.platform === 'ios' ? 'platform=in.(ios,native)' : `platform=eq.${encodeURIComponent(a.platform)}`;
    const rows = await sbGet(ctx, `push_tokens?select=user_id&${filter}&limit=10000`);
    return [...new Set(rows.map(r => r.user_id))];
  }
  return [];
}

// ── Mode B: behavior automations ────────────────────────────────
async function processAutomations(ctx) {
  const automations = await sbGet(ctx, 'push_automations?select=*&enabled=eq.true');
  const summaries = [];

  for (const a of automations) {
    const summary = { id: a.id, name: a.name, trigger: a.trigger_type, sent: 0, targeted: 0, errors: 0 };
    try {
      // Target groups: [{ userIds: [...], props: {venue_name, city, count} }]
      const groups = await evaluateTrigger(ctx, a);
      if (!groups.length) { summaries.push(summary); continue; }

      // Cooldown: exclude users this automation pinged within cooldown_hours
      const cooldownH = a.cooldown_hours || 72;
      const since = new Date(ctx.now.getTime() - cooldownH * 3600000).toISOString();
      const recent = await sbGet(ctx,
        `push_automation_log?select=user_id&automation_id=eq.${a.id}&sent_at=gte.${since}&limit=10000`);
      const excluded = new Set(recent.map(r => r.user_id));

      const logRows = [];
      let capLeft = MAX_SENDS_PER_AUTOMATION_RUN;
      for (const group of groups) {
        if (capLeft <= 0) break;
        const userIds = group.userIds.filter(id => !excluded.has(id)).slice(0, capLeft);
        if (!userIds.length) continue;
        summary.targeted += userIds.length;

        const tokens = await fetchTokens(ctx, userIds);
        if (!tokens.length) continue;

        const renderedTitle = renderTemplate(a.template_title, group.props);
        const renderedBody = renderTemplate(a.template_body, group.props);
        const batch = await sendApnsBatch(
          tokens,
          { title: renderedTitle, body: renderedBody, url: a.url || '/', tag: 'auto-' + a.trigger_type },
          { sandbox: false }
        );
        if (batch.deadTokens.length) await cleanupDeadTokens(batch.deadTokens);
        summary.errors += batch.errors.length;

        // Log + count only users with at least one successful delivery so
        // token-less / all-failed users stay eligible next run.
        const okUsers = new Set();
        for (const r of batch.results) {
          if (r.ok) {
            const row = tokens.find(t => t.token === r.token);
            if (row) okUsers.add(row.user_id);
          }
        }
        for (const uid of okUsers) {
          logRows.push({ automation_id: a.id, user_id: uid, sent_at: ctx.now.toISOString() });
          excluded.add(uid); // one push per automation per run, across groups
          summary.sent++;
          capLeft--;
        }
        if (okUsers.size) {
          await saveInAppNotifications([...okUsers], { title: renderedTitle, body: renderedBody, url: a.url || '/' });
        }
      }
      await sbInsert(ctx, 'push_automation_log', logRows);
    } catch (e) {
      console.error('[push-runner] automation', a.id, a.name, 'failed:', e.message);
      summary.error = e.message;
    }
    summaries.push(summary);
  }
  return { enabled: automations.length, processed: summaries };
}

async function evaluateTrigger(ctx, automation) {
  const cfg = automation.trigger_config || {};
  switch (automation.trigger_type) {
    case 'inactive_days':            return triggerInactiveDays(ctx, cfg);
    case 'first_favorite':           return triggerFirstFavorite(ctx, cfg);
    case 'going_tonight_threshold':  return triggerGoingTonight(ctx, cfg);
    case 'new_venue_in_city':        return triggerNewVenue(ctx, cfg);
    default:
      console.error('[push-runner] unknown trigger_type:', automation.trigger_type);
      return [];
  }
}

// Users whose coalesce(last_seen, created_at) is older than N days.
async function triggerInactiveDays(ctx, cfg) {
  const days = Number(cfg.days) || 7;
  const cutoff = new Date(ctx.now.getTime() - days * 86400000).toISOString();
  const rows = await sbGet(ctx,
    `profiles?select=id&or=(last_seen.lt.${cutoff},and(last_seen.is.null,created_at.lt.${cutoff}))&limit=10000`);
  if (!rows.length) return [];
  return [{ userIds: rows.map(r => r.id), props: { count: days } }];
}

// Users whose very first favorite was created in the last 24h.
async function triggerFirstFavorite(ctx, cfg) {
  const windowStart = new Date(ctx.now.getTime() - 24 * 3600000).toISOString();
  const recent = await sbGet(ctx,
    `favorites?select=user_id,item_id,item_type,created_at&created_at=gte.${windowStart}&order=created_at.asc&limit=5000`);
  if (!recent.length) return [];

  const userIds = [...new Set(recent.map(r => r.user_id))];
  // Anyone with a favorite from BEFORE the window isn't on their first
  const prior = await sbGet(ctx,
    `favorites?select=user_id&created_at=lt.${windowStart}&user_id=in.(${userIds.join(',')})&limit=10000`);
  const notFirst = new Set(prior.map(r => r.user_id));

  // Group first-timers by the venue they favorited so {{venue_name}} renders
  const firstFavByUser = {};
  for (const r of recent) {
    if (notFirst.has(r.user_id) || firstFavByUser[r.user_id]) continue;
    firstFavByUser[r.user_id] = r;
  }
  const venueIds = [...new Set(Object.values(firstFavByUser)
    .filter(r => r.item_type === 'venue' && r.item_id)
    .map(r => r.item_id))];
  const venueNames = {};
  if (venueIds.length) {
    const venues = await sbGet(ctx, `venues?select=id,name,city_slug&id=in.(${venueIds.join(',')})`);
    for (const v of venues) venueNames[v.id] = v;
  }

  const groups = {};
  for (const [uid, fav] of Object.entries(firstFavByUser)) {
    const venue = fav.item_type === 'venue' ? venueNames[fav.item_id] : null;
    const key = venue ? venue.id : '_generic';
    if (!groups[key]) {
      groups[key] = {
        userIds: [],
        props: venue ? { venue_name: venue.name, city: venue.city_slug } : {},
      };
    }
    groups[key].userIds.push(uid);
  }
  return Object.values(groups);
}

// Venues with >= threshold check-ins today → ping that city's users
// (excluding people already checked in there).
async function triggerGoingTonight(ctx, cfg) {
  const threshold = Number(cfg.threshold) || 2;
  // check_ins.date is the user's local calendar date; the app is US-Pacific
  const today = ctx.now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const checkins = await sbGet(ctx,
    `check_ins?select=venue_id,user_id&date=eq.${today}&limit=10000`);
  if (!checkins.length) return [];

  const byVenue = {};
  for (const c of checkins) {
    if (!c.venue_id) continue;
    if (!byVenue[c.venue_id]) byVenue[c.venue_id] = new Set();
    byVenue[c.venue_id].add(c.user_id);
  }
  const hotVenueIds = Object.keys(byVenue).filter(vid => byVenue[vid].size >= threshold);
  if (!hotVenueIds.length) return [];

  const venues = await sbGet(ctx,
    `venues?select=id,name,city_slug&id=in.(${hotVenueIds.join(',')})&active=eq.true`);
  const cityNames = await fetchCityNames(ctx, venues.map(v => v.city_slug));

  const groups = [];
  for (const v of venues) {
    const profiles = await sbGet(ctx,
      `profiles?select=id&city_slug=eq.${encodeURIComponent(v.city_slug)}&limit=10000`);
    const checkedIn = byVenue[v.id];
    const userIds = profiles.map(p => p.id).filter(id => !checkedIn.has(id));
    if (!userIds.length) continue;
    groups.push({
      userIds,
      props: { venue_name: v.name, count: checkedIn.size, city: cityNames[v.city_slug] || v.city_slug },
    });
  }
  return groups;
}

// Active venues created in the last 24h → ping that city's users.
async function triggerNewVenue(ctx, cfg) {
  const windowStart = new Date(ctx.now.getTime() - 24 * 3600000).toISOString();
  const venues = await sbGet(ctx,
    `venues?select=id,name,city_slug&active=eq.true&created_at=gte.${windowStart}&limit=50`);
  if (!venues.length) return [];

  const cityNames = await fetchCityNames(ctx, venues.map(v => v.city_slug));
  const groups = [];
  for (const v of venues) {
    const profiles = await sbGet(ctx,
      `profiles?select=id&city_slug=eq.${encodeURIComponent(v.city_slug)}&limit=10000`);
    if (!profiles.length) continue;
    groups.push({
      userIds: profiles.map(p => p.id),
      props: { venue_name: v.name, city: cityNames[v.city_slug] || v.city_slug },
    });
  }
  return groups;
}

async function fetchCityNames(ctx, slugs) {
  const unique = [...new Set(slugs.filter(Boolean))];
  if (!unique.length) return {};
  const rows = await sbGet(ctx, `cities?select=slug,name&slug=in.(${unique.map(s => `"${s}"`).join(',')})`);
  const map = {};
  for (const r of rows) map[r.slug] = r.name;
  return map;
}

// {{venue_name}} / {{city}} / {{count}} — unknown placeholders render as ''
function renderTemplate(tpl, props) {
  return String(tpl || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (props && props[k] != null ? String(props[k]) : ''));
}

// ── Minimal cron parser ─────────────────────────────────────────
// 5-field UTC cron (min hour dom mon dow) supporting *, numbers, ranges,
// lists, and steps. Note: dom/dow are ANDed (vanilla cron ORs them when both
// are restricted) — the admin UI only ever restricts one of the two.
export function nextCronOccurrence(expr, fromDate) {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
  const fields = parts.map((p, i) => parseCronField(p, ranges[i][0], ranges[i][1]));
  if (fields.some(f => !f)) return null;
  const [min, hour, dom, mon, dow] = fields;

  const d = new Date(fromDate.getTime());
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (mon.has(d.getUTCMonth() + 1) && dom.has(d.getUTCDate()) && dow.has(d.getUTCDay()) &&
        hour.has(d.getUTCHours()) && min.has(d.getUTCMinutes())) {
      return d;
    }
    d.setUTCMinutes(d.getUTCMinutes() + 1);
  }
  return null;
}

function parseCronField(spec, lo, hi) {
  const set = new Set();
  for (const part of spec.split(',')) {
    const m = part.match(/^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/);
    if (!m) return null;
    const start = m[1] === '*' ? lo : parseInt(m[1], 10);
    const end = m[1] === '*' ? hi : (m[2] ? parseInt(m[2], 10) : start);
    const step = m[3] ? parseInt(m[3], 10) : 1;
    if (Number.isNaN(start) || Number.isNaN(end) || step < 1 || start < lo || end > hi || start > end) return null;
    for (let v = start; v <= end; v += step) set.add(v);
  }
  return set.size ? set : null;
}
