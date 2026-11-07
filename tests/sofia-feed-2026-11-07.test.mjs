// Feed load-integrity + city-scope tests (node).
// Run from repo root: node tests/sofia-feed-2026-11-07.test.mjs
// Guards Sofia 2026-11-07 feed audit:
//  (1) fetchVenues/fetchEvents (js/db.js) read only `data` — a PostgREST
//      failure resolves { data: null, error }, so a rejected main feed
//      load became an empty city and enterCity painted "No spots found —
//      try removing a filter". Readers now return null on error;
//      enterCity gates on null with an error + Retry state;
//      renderProfile's best-effort fallback coalesces with || [].
//  (2) fetchSocialFeed's activity source carried NO city filter —
//      activity_feed has no city column, so every city received the
//      same latest-60 rows from all cities (live-verified: an Austin
//      Flightpath Coffeehouse check-in rendered in San Diego's Public
//      feed). The query now inner-joins venues and filters
//      venues.city_slug = the requested city.
//  (3) Social/activity load masquerade: fetchSocialFeed's primary posts
//      read resolving with an error became a fake-empty social feed;
//      fetchActivityFeed/fetchUserActivity swallowed errors into [];
//      renderTrendingTab treated two errored RPCs as "Nothing trending
//      yet". All now distinguish failure (null / throw) from empty, and
//      the renderers paint their existing failure states.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbSrc = readFileSync(join(ROOT, 'js/db.js'), 'utf8');
const appSrc = readFileSync(join(ROOT, 'js/app.js'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}
function extract(src, name) {
  const m = src.match(new RegExp(`async function ${name}[\\s\\S]*?\\n\\}\\n`));
  return m ? m[0] : '';
}

// A supabase-js style chainable, thenable stub. Records every call.
function makeChain(result, calls) {
  const chain = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'not', 'gt', 'gte', 'lte', 'is']) {
    chain[m] = (...args) => { calls.push([m, ...args]); return chain; };
  }
  chain.then = (res, rej) => Promise.resolve(result).then(res, rej);
  return chain;
}
function makeCtx(fnSrcList, tables) {
  const callsByTable = {};
  const sandbox = {
    console,
    currentUser: null,
    localDateKey: () => '2026-11-07',
    db: {
      from: (t) => {
        callsByTable[t] = callsByTable[t] || [];
        return makeChain(tables[t] || { data: [], error: null }, callsByTable[t]);
      },
      rpc: () => Promise.resolve({ data: [], error: null }),
    },
  };
  vm.createContext(sandbox);
  for (const src of fnSrcList) vm.runInContext(src, sandbox);
  return { sandbox, callsByTable };
}

// ── (1) fetchVenues / fetchEvents ────────────────────────────────────
for (const [fn, table] of [['fetchVenues', 'venues'], ['fetchEvents', 'events']]) {
  const src = extract(dbSrc, fn);
  check(`${fn} found in js/db.js`, !!src);
  {
    const { sandbox } = makeCtx([src], { [table]: { data: null, error: { message: '400 Bad Request' } } });
    const r = await sandbox[fn]('san-diego');
    check(`${fn} returns null on a PostgREST error`, r === null, `got ${JSON.stringify(r)}`);
  }
  {
    const { sandbox } = makeCtx([src], { [table]: { data: [{ id: 'x1' }], error: null } });
    const r = await sandbox[fn]('san-diego');
    check(`${fn} returns rows on success`, Array.isArray(r) && r.length === 1 && r[0].id === 'x1');
  }
  {
    const { sandbox } = makeCtx([src], { [table]: { data: [], error: null } });
    const r = await sandbox[fn]('san-diego');
    check(`${fn} returns [] (not null) for a genuinely empty city`, Array.isArray(r) && r.length === 0);
  }
}

// ── (3a) fetchActivityFeed / fetchUserActivity ───────────────────────
{
  const src = extract(dbSrc, 'fetchActivityFeed');
  check('fetchActivityFeed found', !!src);
  const errCtx = makeCtx([src], { activity_feed: { data: null, error: { message: 'RLS denied' } } });
  check('fetchActivityFeed returns null on error', (await errCtx.sandbox.fetchActivityFeed(['u1'])) === null);
  const okCtx = makeCtx([src], {
    activity_feed: { data: [{ id: 'a1', user_id: 'u1', activity_type: 'check_in' }], error: null },
    profiles: { data: [], error: null },
  });
  const rows = await okCtx.sandbox.fetchActivityFeed(['u1']);
  check('fetchActivityFeed returns rows on success', Array.isArray(rows) && rows.length === 1);
}
{
  const src = extract(dbSrc, 'fetchUserActivity');
  check('fetchUserActivity found', !!src);
  const errCtx = makeCtx([src], { activity_feed: { data: null, error: { message: 'RLS denied' } } });
  check('fetchUserActivity returns null on error', (await errCtx.sandbox.fetchUserActivity('u1')) === null);
  const okCtx = makeCtx([src], { activity_feed: { data: [], error: null } });
  const rows = await okCtx.sandbox.fetchUserActivity('u1');
  check('fetchUserActivity returns [] on a genuinely empty history', Array.isArray(rows) && rows.length === 0);
}

// ── (2)+(3b) fetchSocialFeed: city scope + primary-error null ────────
{
  const src = extract(dbSrc, 'fetchSocialFeed');
  check('fetchSocialFeed found', !!src);
  const photoRow = { id: 'p1', user_id: 'u1', venue_id: null, post_type: 'photo', photo_url: 'x.jpg', created_at: '2026-11-07T10:00:00Z' };
  const actRow = { id: 'a1', user_id: 'u2', activity_type: 'check_in', venue_id: 'v1', venue_name: 'Some Spot', created_at: '2026-11-07T09:00:00Z' };
  const okCtx = makeCtx([src], {
    checkin_photos: { data: [photoRow], error: null },
    activity_feed: { data: [actRow], error: null },
    check_ins: { data: [], error: null },
    profiles: { data: [], error: null },
    venues: { data: [], error: null },
  });
  const items = await okCtx.sandbox.fetchSocialFeed('san-diego', [], 60);
  check('fetchSocialFeed returns normalized items on success', Array.isArray(items) && items.length === 2, `got ${JSON.stringify(items)}`);
  const actCalls = okCtx.callsByTable['activity_feed'] || [];
  const selectArg = (actCalls.find(c => c[0] === 'select') || [])[1] || '';
  check('activity query inner-joins venues for city scoping', String(selectArg).includes('venues!inner(city_slug)'), `select: ${selectArg}`);
  check('activity query filters venues.city_slug to the requested city',
    actCalls.some(c => c[0] === 'eq' && c[1] === 'venues.city_slug' && c[2] === 'san-diego'),
    `calls: ${JSON.stringify(actCalls)}`);

  const errCtx = makeCtx([src], {
    checkin_photos: { data: null, error: { message: '400 Bad Request' } },
    activity_feed: { data: [], error: null },
    check_ins: { data: [], error: null },
  });
  const r = await errCtx.sandbox.fetchSocialFeed('san-diego', [], 60);
  check('fetchSocialFeed returns null when the primary posts read errors', r === null, `got ${JSON.stringify(r)}`);
}

// ── Static gates in js/app.js ────────────────────────────────────────
const enterSrc = extract(appSrc, 'enterCity');
check('enterCity gates on a failed venue load', /venues === null/.test(enterSrc));
check('enterCity paints an honest load error (not "No spots found")', /Couldn't load spots/.test(enterSrc));
check('enterCity error state offers a Retry that re-enters the city', /onclick="enterCity\('\$\{slug\}'/.test(enterSrc));
check('renderProfile coalesces the fetchVenues fallback with || []', /\(await fetchVenues\('san-diego'\)\) \|\| \[\]/.test(appSrc));
const loadSocialSrc = extract(appSrc, 'loadSocialFeed');
check('loadSocialFeed gates on items === null', /items === null/.test(loadSocialSrc));
check('loadSocialFeed failure gate reuses the Failed-to-load state', /items === null[\s\S]{0,300}Failed to load/.test(loadSocialSrc));
const feedTabSrc = extract(appSrc, 'loadFeedTab');
check('loadFeedTab gates on activities === null', /activities === null/.test(feedTabSrc));
check('loadFeedTab failure gate offers a Retry', /activities === null[\s\S]{0,600}Retry/.test(feedTabSrc));
const trendingSrc = extract(appSrc, 'renderTrendingTab');
check('renderTrendingTab treats errored RPCs as failure, not empty', /trending\.error/.test(trendingSrc) && /throw trending\.error/.test(trendingSrc));

console.log(`feed-2026-11-07: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log(failures.join('\n')); process.exit(1); }
