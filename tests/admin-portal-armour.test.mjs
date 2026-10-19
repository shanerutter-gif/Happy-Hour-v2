// Admin portal AP1/AP2/AP4 regression tests (node).
// Run: node tests/admin-portal-armour.test.mjs
// Guards Leo's 2026-10-19 admin-portal re-audit fixes (Shane approved the
// bundle 2026-10-19):
//  AP1 — one venue count. The Dashboard KPI used to print the length of a
//        row fetch that PostgREST silently caps at 1,000 rows ("1,000
//        ACTIVE VENUES" for 12 days) and City Breakdown aggregated the
//        same capped fetch (per-city totals summed to exactly 1,000,
//        actives to 984) while the DB active=true count was 3,732. All
//        three surfaces now read the same exact count (sbCount /
//        Prefer: count=exact) and City Breakdown paginates every row.
//  AP2 — table armour. Push automations, Trending, Most Saved and Users
//        Activity headers now name the metric + window, status is a chip,
//        totals rows are visually distinct and labelled by scope, and
//        zebra striping separates rows — the unarmoured tables produced
//        five retracted numbers in one morning (22-vs-45 etc.).
//  AP4 — calendar lapsed flag. A draft whose slot time has passed gets a
//        coral "SLOT PASSED — still Draft" chip, a Lapsed group at the top
//        of the month/list views, and a "Lapsed: N" header count.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const admin = readFileSync(join(ROOT, 'admin.html'), 'utf8');
const push = readFileSync(join(ROOT, 'admin-push-center.js'), 'utf8');
const activity = readFileSync(join(ROOT, 'admin-activity.js'), 'utf8');
const analytics = readFileSync(join(ROOT, 'admin-analytics.js'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}

// Full source text of a top-level `function name(...) { ... }` declaration
// (including a leading `async` when present).
function fnText(name, src) {
  let start = src.indexOf(`function ${name}(`);
  if (start === -1) return '';
  if (src.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}

// ── AP1 ────────────────────────────────────────────────────────────────
check('AP1 sbCount exists and uses count=exact',
  fnText('sbCount', admin).includes("'Prefer': 'count=exact'"));
check('AP1 shared activeVenueCount helper reads venues active=eq.true',
  admin.includes("const activeVenueCount = () => sbCount('venues', 'active=eq.true');"));

const dash = fnText('loadDashboard', admin);
check('AP1 loadDashboard exists', dash.length > 0);
check('AP1 dashboard KPI comes from activeVenueCount()', dash.includes('activeVenueCount()'));
check('AP1 dashboard no longer prints a capped row-fetch length as the venue count',
  !dash.includes("getElementById('dk-venues').textContent = venues.length"));

const cities = fnText('loadCities', admin);
check('AP1 City Breakdown paginates ALL venue rows (sbFetchAll)',
  cities.includes("sbFetchAll('venues', 'select=id,city_slug,active&order=id.asc')"));
check('AP1 City Breakdown no longer uses the capped limit=2000 venue fetch',
  !cities.includes("select=id,city_slug,active&limit=2000"));
check('AP1 City Breakdown renders a totals row', cities.includes('armour-total-row'));

const venueList = fnText('renderVenueList', admin);
check('AP1 All Venues counter quotes the shared active count',
  venueList.includes('_activeVenueCount') && venueList.includes('active (DB active=true'));
check('AP1 stale "unreconciled venue counts" note removed from Traffic Analytics',
  !analytics.includes('Venue counts are unreconciled'));

// sbCount behavior: parses the exact total out of Content-Range.
{
  const ctx = {
    SUPABASE_URL: 'https://example.test',
    svcHeaders: () => ({}),
    authFetch: async () => ({ ok: true, headers: { get: h => (h === 'content-range' ? '0-0/3732' : null) } }),
  };
  vm.createContext(ctx);
  vm.runInContext(fnText('sbCount', admin), ctx);
  const n = await ctx.sbCount('venues', 'active=eq.true');
  check('AP1 sbCount returns the Content-Range total (3732)', n === 3732, `got ${n}`);
  const ctxBad = {
    SUPABASE_URL: 'https://example.test',
    svcHeaders: () => ({}),
    authFetch: async () => ({ ok: false, headers: { get: () => null } }),
  };
  vm.createContext(ctxBad);
  vm.runInContext(fnText('sbCount', admin), ctxBad);
  const nBad = await ctxBad.sbCount('venues', 'active=eq.true');
  check('AP1 sbCount returns null (never a wrong number) on failure', nBad === null, `got ${nBad}`);
}

// ── AP2 ────────────────────────────────────────────────────────────────
check('AP2 push automations label the count SENT — LIFETIME in header and rows',
  push.includes('Sent — Lifetime') && push.includes('sent — lifetime'));
check('AP2 push automations render a distinct totals row',
  push.includes('pc-total-row') && push.includes('Total — all automations'));
check('AP2 push status is an uppercase coloured chip',
  push.includes('text-transform:uppercase') && push.includes('pc-badge-on'));
check('AP2 push automations have zebra striping',
  push.includes('#pc-automations-list .push-history-item:nth-child(even)'));

check('AP2 Trending card title names metric + window',
  admin.includes('Trending Venues — Check-ins (7d)'));
check('AP2 Trending renders header + distinct totals row',
  fnText('loadDashboard', admin).includes('armour-head') &&
  fnText('loadDashboard', admin).includes('Total — all venues'));

const topVenues = fnText('renderTopVenues', admin);
check('AP2 Top Venues header names metric + window per tab',
  topVenues.includes("saves:'Saves — all time'") || topVenues.includes("'Saves — all time'"));
check('AP2 Top Venues status renders as a chip, not loose text',
  topVenues.includes('venue-status-badge'));
check('AP2 Top Venues totals row is scoped to rows shown',
  topVenues.includes('rows shown'));

check('AP2 Users Activity header names metric + selected window',
  activity.includes('Events — ${esc(rangeLabel)}') && activity.includes('rangeLabel'));
check('AP2 Users Activity renders a distinct totals row',
  activity.includes('ae-total-row') && activity.includes('users shown'));
check('AP2 Users Activity tables get sticky-header armour CSS',
  activity.includes('ae-armour-css') && activity.includes('position:sticky'));

// ── AP4 ────────────────────────────────────────────────────────────────
check('AP4 ccIsLapsed + ccSlotDate exist',
  fnText('ccIsLapsed', admin).length > 0 && fnText('ccSlotDate', admin).length > 0);
check('AP4 chip carries the spec text', admin.includes('Slot passed — still Draft'));
check('AP4 calendar header has a Lapsed stat card', admin.includes('id="cc-stat-lapsed"'));
check('AP4 ccRenderStats counts lapsed drafts',
  fnText('ccRenderStats', admin).includes('ccIsLapsed'));
check('AP4 month grid renders a Lapsed group',
  fnText('ccRenderCalendar', admin).includes('cc-lapsed-group'));
check('AP4 list view groups lapsed posts first',
  fnText('ccRenderList', admin).includes('cc-list-group-head'));

{
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(
    fnText('ccSlotDate', admin) + '\n' + fnText('ccIsLapsed', admin),
    ctx
  );
  const dayMs = 86400000;
  const fmt = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const yesterday = fmt(new Date(Date.now() - dayMs));
  const tomorrow = fmt(new Date(Date.now() + dayMs));
  check('AP4 past-dated draft is lapsed',
    ctx.ccIsLapsed({ status: 'draft', scheduled_date: yesterday, scheduled_time: '18:00' }) === true);
  check('AP4 future-dated draft is not lapsed',
    ctx.ccIsLapsed({ status: 'draft', scheduled_date: tomorrow, scheduled_time: '18:00' }) === false);
  check('AP4 published post is never lapsed',
    ctx.ccIsLapsed({ status: 'published', scheduled_date: yesterday, scheduled_time: '18:00' }) === false);
  check('AP4 scheduled post is not flagged (drafts only, per spec)',
    ctx.ccIsLapsed({ status: 'scheduled', scheduled_date: yesterday, scheduled_time: '18:00' }) === false);
  check('AP4 draft with no date has no slot to miss',
    ctx.ccIsLapsed({ status: 'draft', scheduled_date: '', scheduled_time: '18:00' }) === false);
  check('AP4 status defaults to draft when missing',
    ctx.ccIsLapsed({ scheduled_date: yesterday, scheduled_time: '18:00' }) === true);
}

console.log(`admin-portal-armour: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exitCode = 1;
}
