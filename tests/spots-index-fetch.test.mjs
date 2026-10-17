// Paged venue-index fetch + botGate status tests (node).
// Run: node tests/spots-index-fetch.test.mjs
// Guards the Oct 2026 SEO-cliff fix (seo-cliff-diagnosis-2026-10-17.md):
// the old per-file fetchAllRows copies silently broke out of their paging
// loop on any failed Supabase page fetch and returned a partial index, so
// /spots/<slug> served styled 404s for venues that exist whenever a page
// fetch flaked. The shared _lib/fetch-all-rows.js must instead: page fully,
// verify against the count=exact total, retry failed pages, and throw
// IncompleteFetchError (handlers answer 503) when the index cannot be
// assembled. Fetch order and query URLs must NOT change — canonical slug
// assignment is fetch-order-dependent.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}

const {
  fetchAllRows,
  parseContentRangeTotal,
  IncompleteFetchError,
  serviceUnavailableResponse,
} = await import('../api/_lib/fetch-all-rows.js');
const { botGate, botVerdict } = await import('../api/_lib/botgate.js');

/* ── mock PostgREST ─────────────────────────────────────────────── */
// Serves `rows` in Range pages with a count=exact Content-Range, with
// scriptable per-range failures. Records every request for assertions.
function mockPostgrest(rows, opts = {}) {
  const requests = [];
  const attemptsByRange = {};
  const impl = async (url, init) => {
    requests.push({ url, headers: init.headers });
    const range = init.headers.Range;
    attemptsByRange[range] = (attemptsByRange[range] || 0) + 1;
    const attempt = attemptsByRange[range];
    const fail = opts.failIf && opts.failIf(range, attempt);
    if (fail === 'http') {
      return { ok: false, status: 500, json: async () => { throw new Error('no body'); }, headers: { get: () => null } };
    }
    if (fail === 'throw') throw new Error('network reset');
    const [from, to] = range.split('-').map(Number);
    const page = rows.slice(from, to + 1);
    if (fail === 'badjson') {
      return { ok: true, status: 200, json: async () => { throw new Error('truncated body'); }, headers: { get: () => `${from}-${from + page.length - 1}/${rows.length}` } };
    }
    return {
      ok: true,
      status: 200,
      json: async () => page,
      headers: {
        get: (name) => {
          if (name.toLowerCase() !== 'content-range' || opts.noContentRange) return null;
          return page.length ? `${from}-${from + page.length - 1}/${rows.length}` : `*/${rows.length}`;
        },
      },
    };
  };
  return { impl, requests, attemptsByRange };
}

const mkRows = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
const URL = 'https://db.example/rest/v1/venues?active=eq.true&select=id,name';
const HDRS = { apikey: 'k', Authorization: 'Bearer k' };

/* ── parseContentRangeTotal ─────────────────────────────────────── */
check('CR: bounded range parses total', parseContentRangeTotal('0-999/1922') === 1922);
check('CR: star range parses total', parseContentRangeTotal('*/1922') === 1922);
check('CR: null header -> null', parseContentRangeTotal(null) === null);
check('CR: garbage -> null', parseContentRangeTotal('bytes 0-1') === null);

/* ── happy paths ────────────────────────────────────────────────── */
{
  const { impl, requests } = mockPostgrest(mkRows(2500));
  const out = await fetchAllRows(URL, HDRS, impl);
  check('complete: 2500 rows across 3 pages', out.length === 2500, `got ${out.length}`);
  check('complete: fetch order preserved', out.every((r, i) => r.id === i + 1));
  check('complete: exactly 3 page requests', requests.length === 3, `got ${requests.length}`);
  check('complete: query URL passed through untouched (no order= added)',
    requests.every(r => r.url === URL && !r.url.includes('order=')));
  check('complete: every page asks count=exact', requests.every(r => r.headers.Prefer === 'count=exact'));
  check('complete: range headers step by 1000',
    requests.map(r => r.headers.Range).join(',') === '0-999,1000-1999,2000-2999');
}
{
  const { impl } = mockPostgrest([]);
  const out = await fetchAllRows(URL, HDRS, impl);
  check('empty table: returns [] without throwing', Array.isArray(out) && out.length === 0);
}
{
  // No Content-Range at all: fall back to short-page termination.
  const { impl } = mockPostgrest(mkRows(1500), { noContentRange: true });
  const out = await fetchAllRows(URL, HDRS, impl);
  check('no count header: short-page fallback still completes', out.length === 1500, `got ${out.length}`);
}

/* ── retries recover ────────────────────────────────────────────── */
{
  const { impl, attemptsByRange } = mockPostgrest(mkRows(2500), {
    failIf: (range, attempt) => (range === '1000-1999' && attempt < 3) ? 'http' : null,
  });
  const out = await fetchAllRows(URL, HDRS, impl);
  check('retry: page failing twice with HTTP 500 still completes', out.length === 2500, `got ${out.length}`);
  check('retry: failed page was attempted 3 times', attemptsByRange['1000-1999'] === 3);
}
{
  const { impl } = mockPostgrest(mkRows(1200), {
    failIf: (range, attempt) => (range === '1000-1999' && attempt === 1) ? 'badjson' : null,
  });
  const out = await fetchAllRows(URL, HDRS, impl);
  check('retry: truncated JSON body recovers on retry', out.length === 1200, `got ${out.length}`);
}
{
  const { impl } = mockPostgrest(mkRows(1200), {
    failIf: (range, attempt) => (range === '0-999' && attempt === 1) ? 'throw' : null,
  });
  const out = await fetchAllRows(URL, HDRS, impl);
  check('retry: network throw recovers on retry', out.length === 1200, `got ${out.length}`);
}

/* ── persistent failure fails loud ──────────────────────────────── */
{
  const { impl, attemptsByRange } = mockPostgrest(mkRows(2500), {
    failIf: (range) => range === '2000-2999' ? 'http' : null,
  });
  let err = null;
  try { await fetchAllRows(URL, HDRS, impl); } catch (e) { err = e; }
  check('fail-loud: persistent page failure throws IncompleteFetchError', err instanceof IncompleteFetchError, err && err.message);
  check('fail-loud: page attempted exactly 3 times before throwing', attemptsByRange['2000-2999'] === 3);
}
{
  // Count promises 2500 but the server goes empty after 2000 rows.
  const { impl } = mockPostgrest(mkRows(2000), {});
  const lyingImpl = async (url, init) => {
    const res = await impl(url, init);
    const origGet = res.headers.get.bind(res.headers);
    res.headers = { get: (n) => { const v = origGet(n); return v ? v.replace(/\/2000$/, '/2500') : v; } };
    return res;
  };
  let err = null;
  try { await fetchAllRows(URL, HDRS, lyingImpl); } catch (e) { err = e; }
  check('fail-loud: collected != count total throws IncompleteFetchError', err instanceof IncompleteFetchError, err && err.message);
}

/* ── 503 helper ─────────────────────────────────────────────────── */
{
  const res = serviceUnavailableResponse();
  check('503 helper: status 503', res.status === 503);
  check('503 helper: Retry-After present', !!res.headers.get('retry-after'));
  check('503 helper: no-store', (res.headers.get('cache-control') || '').includes('no-store'));
}

/* ── botGate: blocked is 403 now, allowlist untouched ───────────── */
function fakeReq(ua) {
  return {
    url: 'https://www.spotd.biz/spots/some-venue',
    headers: { get: (n) => (n.toLowerCase() === 'user-agent' ? ua : null) },
  };
}
check('botgate: curl UA blocked with 403', (() => { const r = botGate(fakeReq('curl/8.0')); return r && r.status === 403; })());
check('botgate: empty UA blocked with 403', (() => { const r = botGate(fakeReq('')); return r && r.status === 403; })());
check('botgate: python-requests blocked with 403', (() => { const r = botGate(fakeReq('python-requests/2.31')); return r && r.status === 403; })());
check('botgate: Googlebot allowed through', botGate(fakeReq('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')) === null);
check('botgate: browser UA passes', botGate(fakeReq('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15')) === null);
check('botgate: verdict fn agrees (block/pass)', botVerdict(fakeReq('curl/8.0')) === 'block' && botVerdict(fakeReq('Mozilla/5.0')) === 'pass');

/* ── source wiring: all surfaces use the shared fetcher ─────────── */
const spotsSrc = readFileSync(join(ROOT, 'api/spots.js'), 'utf8');
const dirSrc = readFileSync(join(ROOT, 'api/spots-directory.js'), 'utf8');
const smvSrc = readFileSync(join(ROOT, 'api/sitemap-venues.js'), 'utf8');
const smcSrc = readFileSync(join(ROOT, 'api/sitemap-cities.js'), 'utf8');
const hhSrc = readFileSync(join(ROOT, 'api/happy-hour.js'), 'utf8');

for (const [name, src] of [['spots', spotsSrc], ['spots-directory', dirSrc], ['sitemap-venues', smvSrc], ['sitemap-cities', smcSrc]]) {
  check(`wiring: ${name} imports shared fetchAllRows`, src.includes("from './_lib/fetch-all-rows.js'") && src.includes('fetchAllRows'));
  check(`wiring: ${name} maps IncompleteFetchError to 503`, src.includes('IncompleteFetchError') && src.includes('serviceUnavailableResponse'));
  check(`wiring: ${name} has no silent-break fetch loop left`, !src.includes('if (!res.ok) break'));
}
check('wiring: spots venue index query unchanged (no order=)',
  spotsSrc.includes('venues?active=eq.true&select=id,name,neighborhood,hours,city_slug'));
check('wiring: sitemap-venues query unchanged (no order=)',
  smvSrc.includes('venues?active=eq.true&photo_url=not.is.null&select=id,name,city_slug,updated_at'));
check('wiring: spots venue-miss 404 is no-store',
  spotsSrc.includes("status: 404") && spotsSrc.includes("'Cache-Control': 'no-store'") && !spotsSrc.includes("'Cache-Control': 'public, max-age=60'"));
check('wiring: happy-hour fails loud (no return-[] on fetch failure)',
  !hhSrc.includes('return res.ok ? res.json() : []') && hhSrc.includes('serviceUnavailableResponse'));

console.log(`spots-index-fetch: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exitCode = 1;
}
