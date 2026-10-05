// Owner lifecycle triggers — test harness (node).
// Run: node tests/owner-lifecycle.test.mjs
// Covers:
//   1. classifyOwnerCohorts unit tests (7d vs 30d vs active vs already-nudged)
//   2. /api/loops-owner-inactive dry-run end to end (stubbed fetch)
//   3. /api/loops-owner-inactive full send path (stubbed fetch): Loops calls,
//      claim stamps, analytics mirrors — exactly one per cohort member
//   4. business-portal _onOwnerListingSaved gating (approved vs pending/rejected)
//   5. admin-claims fireClaimApprovedEvent exactly-once
//   6. loops-event mirrorAnalyticsEvent shape + missing-key skip

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86400000;

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}

// ── brace-aware function extractor (lexical stack: strings/comments/template ${} handled)
function extractFunction(src, startMarker) {
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error('marker not found: ' + startMarker);
  let i = src.indexOf('{', start);
  let depth = 0;
  const stack = [{ t: 'code' }]; // code | sq | dq | tpl | expr | line | block
  const top = () => stack[stack.length - 1];
  while (i < src.length) {
    const ch = src[i], nx = src[i + 1], m = top().t;
    if (m === 'line') { if (ch === '\n') stack.pop(); i++; continue; }
    if (m === 'block') { if (ch === '*' && nx === '/') { stack.pop(); i += 2; } else i++; continue; }
    if (m === 'sq' || m === 'dq' || m === 'tpl') {
      if (ch === '\\') { i += 2; continue; }
      const close = m === 'sq' ? "'" : m === 'dq' ? '"' : '`';
      if (ch === close) { stack.pop(); i++; continue; }
      if (m === 'tpl' && ch === '$' && nx === '{') { depth++; stack.push({ t: 'expr', d: depth }); i += 2; continue; }
      i++; continue;
    }
    // code or expr
    if (ch === '/' && nx === '/') { stack.push({ t: 'line' }); i += 2; continue; }
    if (ch === '/' && nx === '*') { stack.push({ t: 'block' }); i += 2; continue; }
    if (ch === "'") { stack.push({ t: 'sq' }); i++; continue; }
    if (ch === '"') { stack.push({ t: 'dq' }); i++; continue; }
    if (ch === '`') { stack.push({ t: 'tpl' }); i++; continue; }
    if (ch === '{') { depth++; i++; continue; }
    if (ch === '}') {
      depth--;
      if (m === 'expr' && depth === top().d - 1) stack.pop();
      if (depth === 0 && m === 'code') return src.slice(start, i + 1);
      i++; continue;
    }
    i++;
  }
  throw new Error('unbalanced braces for ' + startMarker);
}

// ═══════════════════════════════════════════════════════════════
// 1. classifyOwnerCohorts unit tests
// ═══════════════════════════════════════════════════════════════
{
  const mod = await import('../api/loops-owner-inactive.js');
  const { classifyOwnerCohorts } = mod;
  const now = Date.now();
  const iso = (daysAgo) => new Date(now - daysAgo * DAY).toISOString();
  const mk = (over) => ({
    id: over.id, contact_name: 'Sam Owner', contact_email: 'sam@bar.com',
    venue_id: 'v1', user_id: 'u1', approved_at: iso(over.approvedDaysAgo ?? 40),
    created_at: iso((over.approvedDaysAgo ?? 40) + 1),
    owner_reengaged_7d_at: null, owner_reengaged_30d_at: null,
    venue: { name: 'Test Bar', owner_last_update_at: over.stamp ?? null },
    ...over.extra,
  });
  const noProps = new Map();
  const ids = (r) => r.map(e => e.claim.id).sort();

  // A: approved 10d ago, never touched → 7d
  let r = classifyOwnerCohorts([mk({ id: 'A', approvedDaysAgo: 10 })], noProps, now);
  check('A: 10d dormant → 7d cohort', ids(r.cohort7).join() === 'A' && r.cohort30.length === 0);

  // B: approved 40d ago, never touched → 30d (precedence)
  r = classifyOwnerCohorts([mk({ id: 'B', approvedDaysAgo: 40 })], noProps, now);
  check('B: 40d dormant → 30d cohort only', ids(r.cohort30).join() === 'B' && r.cohort7.length === 0);

  // C: 40d dormant, 30d nudge already sent, 7d never sent → still gets the 7d
  // nudge (bands are independent; matches the loops-inactive.js consumer
  // precedent — each nudge is sent at most once, but a long-dormant owner can
  // receive both on consecutive runs).
  r = classifyOwnerCohorts([mk({ id: 'C', approvedDaysAgo: 40, extra: { owner_reengaged_30d_at: iso(35) } })], noProps, now);
  check('C: 30d sent, 7d not → 7d cohort', ids(r.cohort7).join() === 'C' && r.cohort30.length === 0);

  // D: 40d dormant, got 7d nudge but not 30d → 30d
  r = classifyOwnerCohorts([mk({ id: 'D', approvedDaysAgo: 40, extra: { owner_reengaged_7d_at: iso(20) } })], noProps, now);
  check('D: 7d sent, 30d not → 30d cohort', ids(r.cohort30).join() === 'D');

  // E: active owner (stamp 2d ago) → neither
  r = classifyOwnerCohorts([mk({ id: 'E', approvedDaysAgo: 40, stamp: iso(2) })], noProps, now);
  check('E: active 2d ago → skipped', r.cohort7.length === 0 && r.cohort30.length === 0);

  // F: approved 3d ago, never edited → neither (too recent)
  r = classifyOwnerCohorts([mk({ id: 'F', approvedDaysAgo: 3 })], noProps, now);
  check('F: approved 3d ago → skipped', r.cohort7.length === 0 && r.cohort30.length === 0);

  // G: 45d approved but proposal 5d ago (fallback signal) → neither
  r = classifyOwnerCohorts(
    [mk({ id: 'G', approvedDaysAgo: 45 })],
    new Map([['v1|u1', iso(5)]]), now);
  check('G: recent proposal overrides stale stamp → skipped', r.cohort7.length === 0 && r.cohort30.length === 0);

  // H: 20d approved, stamp 20d ago, no 7d stamp → 7d
  r = classifyOwnerCohorts([mk({ id: 'H', approvedDaysAgo: 20, stamp: iso(20) })], noProps, now);
  check('H: 20d dormant → 7d cohort', ids(r.cohort7).join() === 'H');

  // I: no email → skipped
  r = classifyOwnerCohorts([mk({ id: 'I', approvedDaysAgo: 40, extra: { contact_email: null } })], noProps, now);
  check('I: missing email → skipped', r.cohort7.length === 0 && r.cohort30.length === 0);

  // J: 10d dormant, 7d already sent → neither
  r = classifyOwnerCohorts([mk({ id: 'J', approvedDaysAgo: 10, extra: { owner_reengaged_7d_at: iso(9) } })], noProps, now);
  check('J: 7d already sent → skipped', r.cohort7.length === 0 && r.cohort30.length === 0);

  // K: boundary — exactly 7d → included (<= comparison)
  r = classifyOwnerCohorts([mk({ id: 'K', approvedDaysAgo: 7 })], noProps, now);
  check('K: exactly 7d → 7d cohort', ids(r.cohort7).join() === 'K');

  // L: 6.9d → not yet
  r = classifyOwnerCohorts([mk({ id: 'L', approvedDaysAgo: 6 })], noProps, now);
  check('L: 6d dormant → skipped', r.cohort7.length === 0 && r.cohort30.length === 0);

  // M: proposal for a DIFFERENT user must not count
  r = classifyOwnerCohorts(
    [mk({ id: 'M', approvedDaysAgo: 40 })],
    new Map([['v1|other-user', iso(1)]]), now);
  check('M: other-user proposal ignored → 30d cohort', ids(r.cohort30).join() === 'M');

  // N: mixed batch classifies independently
  r = classifyOwnerCohorts([
    mk({ id: 'N1', approvedDaysAgo: 10 }),
    mk({ id: 'N2', approvedDaysAgo: 40 }),
    mk({ id: 'N3', approvedDaysAgo: 2 }),
  ], noProps, now);
  check('N: mixed batch', ids(r.cohort7).join() === 'N1' && ids(r.cohort30).join() === 'N2');
}

// ═══════════════════════════════════════════════════════════════
// 1b. classifyNudgeCohorts unit tests (day-3 / day-10 onboarding nudges)
// ═══════════════════════════════════════════════════════════════
{
  const mod = await import('../api/loops-owner-inactive.js');
  const { classifyNudgeCohorts } = mod;
  const now = Date.now();
  const iso = (daysAgo) => new Date(now - daysAgo * DAY).toISOString();
  const mk = (over) => ({
    id: over.id, contact_name: 'Sam Owner', contact_email: 'sam@bar.com',
    venue_id: 'v1', user_id: 'u1', approved_at: iso(over.approvedDaysAgo ?? 12),
    created_at: iso((over.approvedDaysAgo ?? 12) + 1),
    owner_nudged_3d_at: null, owner_nudged_10d_at: null,
    venue: { name: 'Test Bar', owner_last_update_at: over.stamp ?? null },
    ...over.extra,
  });
  const noProps = new Map();
  const ids3 = (r) => r.nudge3.map(e => e.claim.id).sort();
  const ids10 = (r) => r.nudge10.map(e => e.claim.id).sort();

  // P1: approved 3.5d ago, untouched → nudge3
  let r = classifyNudgeCohorts([mk({ id: 'P1', approvedDaysAgo: 3.5 })], noProps, now);
  check('P1: 3.5d untouched → nudge3', ids3(r).join() === 'P1' && r.nudge10.length === 0);

  // P2: approved 2d ago → neither (too early)
  r = classifyNudgeCohorts([mk({ id: 'P2', approvedDaysAgo: 2 })], noProps, now);
  check('P2: 2d → skipped', r.nudge3.length === 0 && r.nudge10.length === 0);

  // P3: approved 12d ago, untouched, never nudged → nudge3 first (catch-up pacing)
  r = classifyNudgeCohorts([mk({ id: 'P3', approvedDaysAgo: 12 })], noProps, now);
  check('P3: 12d missed nudge3 → nudge3 (not both)', ids3(r).join() === 'P3' && r.nudge10.length === 0);

  // P4: 12d ago, nudge3 already sent → nudge10
  r = classifyNudgeCohorts([mk({ id: 'P4', approvedDaysAgo: 12, extra: { owner_nudged_3d_at: iso(9) } })], noProps, now);
  check('P4: nudge3 sent → nudge10', ids10(r).join() === 'P4' && r.nudge3.length === 0);

  // P5: both nudges sent → neither
  r = classifyNudgeCohorts([mk({ id: 'P5', approvedDaysAgo: 20, extra: { owner_nudged_3d_at: iso(17), owner_nudged_10d_at: iso(10) } })], noProps, now);
  check('P5: both sent → skipped', r.nudge3.length === 0 && r.nudge10.length === 0);

  // P6: owner touched listing after approval (stamp) → neither
  r = classifyNudgeCohorts([mk({ id: 'P6', approvedDaysAgo: 12, stamp: iso(2) })], noProps, now);
  check('P6: touched 2d ago → skipped', r.nudge3.length === 0 && r.nudge10.length === 0);

  // P7: owner proposal after approval (fallback signal) → neither
  r = classifyNudgeCohorts(
    [mk({ id: 'P7', approvedDaysAgo: 12 })],
    new Map([['v1|u1', iso(5)]]), now);
  check('P7: proposal after approval → skipped', r.nudge3.length === 0 && r.nudge10.length === 0);

  // P8: proposal BEFORE approval does not count as a touch
  r = classifyNudgeCohorts(
    [mk({ id: 'P8', approvedDaysAgo: 3.5 })],
    new Map([['v1|u1', iso(4)]]), now);
  check('P8: pre-approval proposal ignored → nudge3', ids3(r).join() === 'P8');

  // P9: missing email → skipped
  r = classifyNudgeCohorts([mk({ id: 'P9', approvedDaysAgo: 5, extra: { contact_email: null } })], noProps, now);
  check('P9: missing email → skipped', r.nudge3.length === 0 && r.nudge10.length === 0);

  // P10: exactly 3d boundary → included
  r = classifyNudgeCohorts([mk({ id: 'P10', approvedDaysAgo: 3 })], noProps, now);
  check('P10: exactly 3d → nudge3', ids3(r).join() === 'P10');

  // P11: exactly 10d, nudge3 sent → nudge10
  r = classifyNudgeCohorts([mk({ id: 'P11', approvedDaysAgo: 10, extra: { owner_nudged_3d_at: iso(7) } })], noProps, now);
  check('P11: exactly 10d, nudge3 sent → nudge10', ids10(r).join() === 'P11');

  // P12: approved_at null falls back to created_at
  r = classifyNudgeCohorts([mk({ id: 'P12', approvedDaysAgo: 5, extra: { approved_at: null, created_at: iso(5) } })], noProps, now);
  check('P12: null approved_at → created_at fallback → nudge3', ids3(r).join() === 'P12');
}

// ═══════════════════════════════════════════════════════════════
// 2+3. Endpoint dry-run and full send path (stubbed fetch)
// ═══════════════════════════════════════════════════════════════
{
  const mod = await import('../api/loops-owner-inactive.js');
  const handler = mod.default;
  const now = Date.now();
  const iso = (d) => new Date(now - d * DAY).toISOString();

  const fakeClaims = [
    { id: 'c7', contact_name: 'Amy Owner', contact_email: 'amy@bar.com', venue_id: 'v7',
      user_id: 'u7', approved_at: iso(10), created_at: iso(11),
      owner_reengaged_7d_at: null, owner_reengaged_30d_at: null,
      venue: { name: 'Amy Bar', owner_last_update_at: null } },
    { id: 'c30', contact_name: 'Bob Owner', contact_email: 'bob@bar.com', venue_id: 'v30',
      user_id: 'u30', approved_at: iso(45), created_at: iso(46),
      owner_reengaged_7d_at: null, owner_reengaged_30d_at: null,
      venue: { name: 'Bob Bar', owner_last_update_at: iso(45) } },
    { id: 'cactive', contact_name: 'Cat Owner', contact_email: 'cat@bar.com', venue_id: 'vcat',
      user_id: 'ucat', approved_at: iso(45), created_at: iso(46),
      owner_reengaged_7d_at: null, owner_reengaged_30d_at: null,
      venue: { name: 'Cat Bar', owner_last_update_at: iso(1) } },
  ];
  const calls = [];
  const stubFetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : undefined });
    if (String(url).includes('/rest/v1/venue_claims')) {
      if ((opts.method || 'GET') === 'GET') return { ok: true, json: async () => fakeClaims };
      return { ok: true, text: async () => '' }; // stamp PATCH
    }
    if (String(url).includes('/rest/v1/venue_edit_proposals')) {
      return { ok: true, json: async () => [] };
    }
    if (String(url).includes('app.loops.so')) return { ok: true, text: async () => '' };
    if (String(url).includes('/rest/v1/analytics_events')) return { ok: true, text: async () => '' };
    throw new Error('unexpected fetch: ' + url);
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = stubFetch;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-svc-key';
  process.env.LOOPS_API_KEY = 'test-loops-key';
  delete process.env.CRON_SECRET;

  const req = (qs) => ({
    method: 'GET',
    url: `https://x/api/loops-owner-inactive?key=test-svc-key${qs}`,
    headers: new Headers(),
  });

  // 2. dry run
  calls.length = 0;
  let res = await handler(req('&dry=1'));
  let body = await res.json();
  check('dry: returns cohorts without sending',
    body.dry === true && body.cohort7.length === 1 && body.cohort30.length === 1 &&
    body.nudge3.length === 1 && body.nudge10.length === 0 &&
    body.cohort7[0].claim_id === 'c7' && body.cohort30[0].claim_id === 'c30' &&
    body.nudge3[0].claim_id === 'c7');
  check('dry: no Loops calls made', !calls.some(c => c.url.includes('app.loops.so')));
  check('dry: no stamps written', !calls.some(c => c.method === 'PATCH'));
  check('dry: no analytics inserts', !calls.some(c => c.url.includes('analytics_events')));

  // 3. full send path
  calls.length = 0;
  res = await handler(req(''));
  body = await res.json();
  check('send: counts',
    body.sent7 === 1 && body.sent30 === 1 && body.sentNudge3 === 1 && body.sentNudge10 === 0 &&
    body.cohort7 === 1 && body.cohort30 === 1 && body.nudge3 === 1 && body.nudge10 === 0,
    JSON.stringify(body));
  const loopsCalls = calls.filter(c => c.url.includes('app.loops.so'));
  check('send: 3 Loops events (7d + 30d + nudge3)', loopsCalls.length === 3);
  const ev7 = loopsCalls.find(c => c.body.eventName === 'owner.inactive_7d');
  const ev30 = loopsCalls.find(c => c.body.eventName === 'owner.inactive_30d');
  const evN3 = loopsCalls.find(c => c.body.eventName === 'owner.nudge_3d');
  check('send: 7d → amy@bar.com', ev7 && ev7.body.email === 'amy@bar.com');
  check('send: 30d → bob@bar.com', ev30 && ev30.body.email === 'bob@bar.com');
  check('send: nudge3 → amy@bar.com (c7 missed day-3, paced catch-up)', evN3 && evN3.body.email === 'amy@bar.com');
  check('send: c30 not double-nudged (30d suppresses nudge)',
    !loopsCalls.some(c => c.body.email === 'bob@bar.com' && c.body.eventName.startsWith('owner.nudge')));
  check('send: 7d props carry venue + portal',
    ev7 && ev7.body.eventProperties.venueName === 'Amy Bar' &&
    ev7.body.eventProperties.portalUrl === 'https://www.spotd.biz/business-portal.html' &&
    ev7.body.eventProperties.firstName === 'Amy');
  const stamps = calls.filter(c => c.method === 'PATCH' && c.url.includes('venue_claims'));
  check('send: 3 claim stamps', stamps.length === 3);
  check('send: 7d stamp column', stamps.some(c => c.url.includes('id=eq.c7') && c.body.owner_reengaged_7d_at));
  check('send: 30d stamp column', stamps.some(c => c.url.includes('id=eq.c30') && c.body.owner_reengaged_30d_at));
  check('send: nudge3 stamp column', stamps.some(c => c.url.includes('id=eq.c7') && c.body.owner_nudged_3d_at));
  const analytics = calls.filter(c => c.url.includes('analytics_events'));
  check('send: 3 analytics mirrors', analytics.length === 3);
  const aRow = analytics.find(c => c.body[0].event_name === 'owner.inactive_7d');
  check('send: analytics attributed to owner',
    aRow && aRow.body[0].user_id === 'u7' && aRow.body[0].props.venue_id === 'v7');

  // auth: wrong key → 401
  res = await handler({ method: 'GET', url: 'https://x/api/loops-owner-inactive?key=wrong', headers: new Headers() });
  check('auth: wrong key → 401', res.status === 401);

  globalThis.fetch = realFetch;
}

// ═══════════════════════════════════════════════════════════════
// 4. Portal _onOwnerListingSaved gating
// ═══════════════════════════════════════════════════════════════
{
  const html = readFileSync(join(ROOT, 'business-portal.html'), 'utf8');
  const fnSrc = extractFunction(html, 'async function _onOwnerListingSaved(venueId, section)');
  check('portal: _onOwnerListingSaved exists', fnSrc.includes('venue.listing_updated'));

  async function runCase(claimStatus, { user = true } = {}) {
    const calls = [];
    const sandbox = {
      window: { _editingClaimStatus: claimStatus, _editingVenue: { name: 'Gate Bar' }, _editingVenueId: 'vg1' },
      currentUser: user ? { email: 'owner@gate.bar' } : null,
      _sendPortalLoopsEvent: (email, eventName, props) => calls.push({ type: 'loops', email, eventName, props }),
      getToken: () => 'tok-1',
      sb: { headers: () => ({}) },
      SUPABASE_URL: 'https://sb.test',
      fetch: async (url, opts = {}) => {
        calls.push({ type: 'fetch', url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : undefined });
        return { ok: true };
      },
      console,
    };
    const fn = new Function(...Object.keys(sandbox), `${fnSrc}; return _onOwnerListingSaved('vg1', 'deals');`);
    await fn(...Object.values(sandbox));
    return calls;
  }

  let calls = await runCase('approved');
  check('portal: approved → Loops event fired',
    calls.some(c => c.type === 'loops' && c.eventName === 'venue.listing_updated' && c.email === 'owner@gate.bar'));
  check('portal: approved → correct props',
    calls.some(c => c.type === 'loops' && c.props.venueId === 'vg1' && c.props.section === 'deals' && c.props.venueName === 'Gate Bar'));
  check('portal: approved → owner_last_update_at stamped',
    calls.some(c => c.type === 'fetch' && c.method === 'PATCH' && String(c.url).includes('/rest/v1/venues') && c.body.owner_last_update_at));
  check('portal: approved → analytics POST to /api/track-event',
    calls.some(c => c.type === 'fetch' && String(c.url).includes('/api/track-event') && c.body.events[0].n === 'venue.listing_updated'));

  for (const s of ['pending', 'rejected', null, undefined]) {
    calls = await runCase(s);
    check(`portal: status ${String(s)} → nothing fired`, calls.length === 0, `${calls.length} calls`);
  }
  calls = await runCase('approved', { user: false });
  check('portal: approved but signed out → nothing fired', calls.length === 0);
}

// ═══════════════════════════════════════════════════════════════
// 5. fireClaimApprovedEvent exactly-once
// ═══════════════════════════════════════════════════════════════
{
  const src = readFileSync(join(ROOT, 'admin-claims.js'), 'utf8');
  const setSrc = 'const __approvedEventFired = new Set();';
  const fnSrc = extractFunction(src, 'async function fireClaimApprovedEvent(c)');
  const calls = [];
  const sandbox = {
    fetch: async (url, opts = {}) => {
      calls.push({ url, body: JSON.parse(opts.body) });
      return { ok: true };
    },
    window: {},
    console,
  };
  const factory = new Function(...Object.keys(sandbox),
    `${setSrc}\n${fnSrc}\nreturn fireClaimApprovedEvent;`);
  const fire = factory(...Object.values(sandbox));
  const claim = {
    id: 'claim-1', contact_name: 'Dana Owner', contact_email: 'dana@bar.com',
    venue_id: 'vd1', user_id: 'ud1', venue: { name: 'Dana Bar', city_slug: 'san-diego' },
  };
  const [r1, r2, r3] = await Promise.all([fire(claim), fire(claim), fire(claim)]);
  check('approve: concurrent triple-call → one fetch', calls.length === 1, `${calls.length} fetches`);
  check('approve: first call true, rest false', r1 === true && r2 === false && r3 === false);
  const p = calls[0].body;
  check('approve: payload → venue_claim.approved', p.eventName === 'venue_claim.approved' && calls[0].url === '/api/loops-event');
  check('approve: properties carry portal + names',
    p.properties.firstName === 'Dana' && p.properties.venueName === 'Dana Bar' &&
    p.properties.portalUrl === 'https://www.spotd.biz/business-portal.html');
  check('approve: mirror attributed to owner',
    p.mirror.userId === 'ud1' && p.mirror.eventName === 'venue_claim.approved');
  // different claim id → fires independently
  const r4 = await fire({ ...claim, id: 'claim-2', contact_email: 'eve@bar.com' });
  check('approve: second claim fires independently', r4 === true && calls.length === 2);
  // missing email → no fetch
  const r5 = await fire({ ...claim, id: 'claim-3', contact_email: '' });
  check('approve: missing email → no fetch', r5 === false && calls.length === 2);
}

// ═══════════════════════════════════════════════════════════════
// 6. loops-event mirrorAnalyticsEvent
// ═══════════════════════════════════════════════════════════════
{
  const mod = await import('../api/loops-event.js');
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body) });
    return { ok: true, text: async () => '' };
  };
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-svc-key';
  await mod.mirrorAnalyticsEvent({
    userId: 'um1', eventName: 'venue_claim.approved',
    props: { venue_id: 'vm1' }, path: '/admin/claims', platform: 'web',
  });
  check('mirror: inserts into analytics_events',
    calls.length === 1 && calls[0].url.includes('/rest/v1/analytics_events'));
  const row = calls[0].body[0];
  check('mirror: row shape', row.user_id === 'um1' && row.event_name === 'venue_claim.approved' &&
    row.props.venue_id === 'vm1' && row.path === '/admin/claims');

  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  calls.length = 0;
  await mod.mirrorAnalyticsEvent({ userId: 'um1', eventName: 'x' });
  check('mirror: missing service key → skipped gracefully', calls.length === 0);
  globalThis.fetch = realFetch;
}

// ── report ──
console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
