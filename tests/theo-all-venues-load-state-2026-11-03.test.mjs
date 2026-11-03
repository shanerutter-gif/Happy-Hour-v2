// Guard: All Venues load state (Theo 2026-11-03)
// Ravi reproduced the first-load flake 4 straight days (2026-10-30 → 11-03):
// first visit renders heading + filters only, the full list appears after
// ~8s with no reload. Code read of loadVenues at a2a100e found:
//  - no loading state at all during 5 sequential select=* paged fetches
//  - an error/non-array page silently `break`s, truncating the list
//  - a thrown fetch leaves a partial allVenues that the old
//    `if (allVenues.length) return` cache check serves forever
//  - re-entering mid-load can start a second interleaved load
// This guard pins the fix: loading state, single in-flight load,
// fail-loud pages, no cache poisoning, honest error state + retry.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const admin = readFileSync(join(ROOT, 'admin.html'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond) { if (cond) passed++; else { failed++; failures.push(name); } }

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

const loadSrc = fnText('loadVenues', admin);
const renderSrc = fnText('renderVenueList', admin);

// ── Static checks ──────────────────────────────────────────────────────
check('loadVenues exists', loadSrc.length > 0);
check('renderVenueList exists', renderSrc.length > 0);
check('old length-based cache check is gone', !loadSrc.includes('if (allVenues.length) return'));
check('load state declared: _venuesLoadPromise', admin.includes('let _venuesLoadPromise = null;'));
check('load state declared: _venuesLoaded', admin.includes('let _venuesLoaded = false;'));
check('cache only after a complete load', loadSrc.includes('if (_venuesLoaded) return'));
check('concurrent calls join the in-flight load', loadSrc.includes('if (_venuesLoadPromise) return _venuesLoadPromise'));
check('loading state is rendered at load start', loadSrc.includes('Loading…') && loadSrc.includes('Loading venues…'));
check('HTTP failure is thrown, not silently broken on', loadSrc.includes('if (!r.ok) throw new Error'));
check('non-array page is thrown, not silently broken on', loadSrc.includes('if (!Array.isArray(batch)) throw new Error'));
check('rows assemble locally and publish only on success', loadSrc.includes('const rows = []') && loadSrc.includes('allVenues = rows'));
check('_venuesLoaded set only after the full loop + count', loadSrc.indexOf('_venuesLoaded = true') > loadSrc.indexOf('activeVenueCount()'));
check('failure clears the partial cache', loadSrc.includes('allVenues = []'));
check('failure renders an honest error state with Retry', loadSrc.includes("Couldn't load venues") && loadSrc.includes('onclick="loadVenues()"'));
check('in-flight promise is always released', loadSrc.includes('_venuesLoadPromise = null'));
check('renderVenueList keeps the loading state mid-load', renderSrc.includes('if (_venuesLoadPromise && !_venuesLoaded) return'));
check('paged fetch shape unchanged (select=*, name order, PAGE 1000)',
  loadSrc.includes('select=*&order=name.asc&limit=${PAGE}&offset=${offset}') && loadSrc.includes('const PAGE = 1000'));

// ── Behaviour harness ──────────────────────────────────────────────────
function makeVenue(i) {
  return { id: 'id-' + i, name: 'Venue ' + String(i).padStart(4, '0'), city_slug: 'san-diego', neighborhood: 'North Park', address: '', cuisine: '', hours: '4-6pm', active: true };
}
const PAGE1 = Array.from({ length: 1000 }, (_, i) => makeVenue(i));
const PAGE2 = [makeVenue(1000)];

function makeContext(fetchImpl) {
  const els = {
    'venues-list': { innerHTML: '' },
    'venues-list-count': { textContent: '' },
    'venue-search-input': { value: '' },
    'venue-city-filter': { value: '' },
    'venue-status-filter': { value: '' },
  };
  const ctx = {
    console,
    document: { getElementById: (id) => els[id] || null },
    SUPABASE_URL: 'https://example.test',
    svcHeaders: () => ({}),
    activeVenueCount: async () => 3824,
    esc: (s) => String(s ?? ''),
    fetch: fetchImpl,
    allVenues: [],
    _activeVenueCount: null,
    _venuesLoadPromise: null,
    _venuesLoaded: false,
    __els: els,
  };
  vm.createContext(ctx);
  vm.runInContext(`${loadSrc}\n${renderSrc}\nthis.__loadVenues = loadVenues; this.__renderVenueList = renderVenueList;`, ctx);
  return ctx;
}
const okRes = (rows) => ({ ok: true, status: 200, json: async () => rows });
function pagedFetch(pages, counter) {
  return async (url) => {
    counter.n++;
    const offset = Number(new URL(url).searchParams.get('offset') || 0);
    return okRes(pages[offset / 1000] || []);
  };
}

// 1. Happy path: 2 pages assemble, count + rows render, cache sticks
{
  const counter = { n: 0 };
  const ctx = makeContext(pagedFetch([PAGE1, PAGE2], counter));
  await ctx.__loadVenues();
  check('happy path fetches both pages', counter.n === 2);
  check('happy path assembles all rows', ctx.allVenues.length === 1001);
  check('happy path marks loaded', ctx._venuesLoaded === true);
  check('happy path renders the count', ctx.__els['venues-list-count'].textContent.includes('1001 of 1001 venues'));
  check('happy path renders rows (not the empty state)', ctx.__els['venues-list'].innerHTML.includes('Venue 0000'));
  await ctx.__loadVenues();
  check('second load is served from cache (no new fetches)', counter.n === 2);
}

// 2. Concurrent re-entry joins one load
{
  const counter = { n: 0 };
  const ctx = makeContext(pagedFetch([PAGE1, PAGE2], counter));
  await Promise.all([ctx.__loadVenues(), ctx.__loadVenues(), ctx.__loadVenues()]);
  check('concurrent calls share one paged load', counter.n === 2 && ctx.allVenues.length === 1001);
}

// 3. Loading state is visible while the fetch is pending
{
  let release;
  const gate = new Promise((r) => { release = r; });
  const ctx = makeContext(async () => { await gate; return okRes([]); });
  const p = ctx.__loadVenues();
  check('loading state shown while fetch pending', ctx.__els['venues-list'].innerHTML.includes('Loading…'));
  ctx.__renderVenueList();
  check('filter render mid-load does not flash "No venues found"', !ctx.__els['venues-list'].innerHTML.includes('No venues found'));
  release();
  await p;
  check('empty-but-successful load still counts as loaded', ctx._venuesLoaded === true);
}

// 4. HTTP failure on page 2: no truncation, no poisoned cache, retry works
{
  const counter = { n: 0 };
  let failPage2 = true;
  const impl = async (url) => {
    counter.n++;
    const offset = Number(new URL(url).searchParams.get('offset') || 0);
    if (failPage2 && offset === 1000) return { ok: false, status: 500, json: async () => ({ message: 'boom' }) };
    return okRes(offset === 0 ? PAGE1 : PAGE2);
  };
  const ctx = makeContext(impl);
  await ctx.__loadVenues();
  check('failed page does not publish a truncated list', ctx.allVenues.length === 0);
  check('failed load does not mark loaded', ctx._venuesLoaded === false);
  check('failed load shows the error state, not "No venues found"',
    ctx.__els['venues-list'].innerHTML.includes("Couldn't load venues") && !ctx.__els['venues-list'].innerHTML.includes('No venues found'));
  failPage2 = false;
  await ctx.__loadVenues();
  check('retry after failure loads the full list', ctx._venuesLoaded === true && ctx.allVenues.length === 1001);
}

// 5. Non-array (error object) page is a failure, not end-of-list
{
  const ctx = makeContext(async () => okRes({ code: 'PGRST', message: 'error object, not rows' }));
  await ctx.__loadVenues();
  check('non-array page does not silently truncate', ctx._venuesLoaded === false && ctx.allVenues.length === 0);
  check('non-array page shows the error state', ctx.__els['venues-list'].innerHTML.includes("Couldn't load venues"));
}

console.log(`theo-all-venues-load-state: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exitCode = 1; }
