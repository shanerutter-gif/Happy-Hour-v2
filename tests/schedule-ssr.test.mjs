// Schedule parser + SSR /spots status tests (node).
// Run: node tests/schedule-ssr.test.mjs
// Guards the shared venue-hours parser (js/schedule.js, extracted verbatim
// from js/app.js 2026-10-14) and its two consumers: the app (classic
// script, globals) and the /spots/<slug> SSR pages (api/spots.js renders
// the grouped schedule table + an empty pill placeholder;
// js/spots-status.js hydrates the verdict at view time through the same
// parsed.ok gate the modal uses). The cautionary tale is the Oct 2026
// George's at the Cove bug: feed said "Not open today", modal said
// "Closed · Opens 11am today" — two parsers disagreeing. There is now
// ONE parser; a failure here is a merge blocker.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const S = require(join(ROOT, 'js/schedule.js'));
const appJs = readFileSync(join(ROOT, 'js/app.js'), 'utf8');
const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');
const spotsApi = readFileSync(join(ROOT, 'api/spots.js'), 'utf8');
const spotsStatus = readFileSync(join(ROOT, 'js/spots-status.js'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}

// ── Parser fixtures (the proposal's verification set) ───────────────────
// George's at the Cove regression shape: wrapping range, opens later today.
{
  const p = S.parseVenueHours('Sun–Sat 11am–9pm', ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  check('wrapping range Sun–Sat parses ok', p.ok === true);
  check('wrapping range fills every day 11am–9pm',
    S.SCHED_DAYS.every(d => p.days[d] && p.days[d].open === 660 && p.days[d].close === 1260));
  const st = S.getOpenStatus(p, 'Wed', 600); // 10:00am, opens 11am
  check('pre-open verdict matches the modal wording',
    st.state === 'closed' && st.label === 'Closed · Opens 11am today', st.label);
}
// Past-midnight close, checked after midnight against the previous day.
{
  const p = S.parseVenueHours('Fri 4pm–1am', ['Fri']);
  check('past-midnight close exceeds 1440', p.ok && p.days.Fri.close === 1500);
  const st = S.getOpenStatus(p, 'Sat', 30); // Sat 00:30
  check('still open at 00:30 via previous day window',
    st.state === 'open' && st.label === 'Open now · Closes 1am', st.label);
}
// Full-name days: the normaliser is load-bearing (mixed "Monday" formats).
// The trap is silent, not loud: raw full-name entries never match the
// parser's day codes, so the openDays safety check disables itself and a
// day days[] claims but the string never mentions gets a confident
// "closed" instead of an honest "unparsed".
{
  const hours = 'Mon 9am–5pm';
  const raw = S.parseVenueHours(hours, ['Monday', 'Tuesday']);
  check('UNNORMALIZED full-name days silently disable the safety check (ok=true, Tue confidently closed)',
    raw.ok === true && raw.days.Tue === null);
  const norm = S.parseVenueHours(hours, S.normDaysAbbrev(['Monday', 'Tuesday']));
  check('normalized days restore the check: claimed-but-unmentioned day is unparsed (ok=false)',
    norm.ok === false && norm.days.Tue === undefined);
  const clean = S.parseVenueHours('Mon–Fri 9am–5pm', S.normDaysAbbrev(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']));
  check('normalized full-name days parse ok when string and days agree', clean.ok === true);
  check('normDaysAbbrev maps full names and dedupes',
    JSON.stringify(S.normDaysAbbrev(['Monday', 'Tue', 'Tuesday', 'x'])) === '["Mon","Tue"]');
}
// Explicit closed-day segment.
{
  const p = S.parseVenueHours('Tue–Sun 11am–10pm · Closed Mon', S.normDaysAbbrev(['Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']));
  check('"Closed Mon" segment parses ok with Mon closed', p.ok === true && p.days.Mon === null);
}
// Unparseable string → no verdict, ever.
{
  const p = S.parseVenueHours('Call for hours', []);
  check('unparseable hours yield ok=false', p.ok === false);
}
// Grouped rows collapse identical consecutive days.
{
  const p = S.parseVenueHours('Mon–Fri 11am–10pm · Sat 10am–11pm · Closed Sun', S.normDaysAbbrev(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']));
  const rows = S.schedGroupRows(p);
  check('grouped rows: Sun closed / Mon–Fri / Sat',
    rows.length === 3 && rows[0].hours === null && rows[1].days.length === 5 && rows[2].days[0] === 'Sat',
    JSON.stringify(rows.map(r => r.days)));
}

// ── Timezones: complete map, fail closed ────────────────────────────────
check('CITY_TZ covers all 7 live cities',
  ['san-diego', 'orange-county', 'los-angeles', 'new-york', 'chicago', 'austin', 'miami']
    .every(slug => typeof S.CITY_TZ[slug] === 'string'));
check('CITY_TZ zones are the correct IANA zones',
  S.CITY_TZ['austin'] === 'America/Chicago' && S.CITY_TZ['miami'] === 'America/New_York' &&
  S.CITY_TZ['los-angeles'] === 'America/Los_Angeles' && S.CITY_TZ['chicago'] === 'America/Chicago');
{
  const z = S.zonedNow('austin');
  check('zonedNow returns a weekday + minutes for a mapped city',
    !!z && S.SCHED_DAYS.includes(z.dayName) && z.mins >= 0 && z.mins < 1440);
}
check('zonedNow fails closed for an unmapped city', S.zonedNow('not-a-city') === null);

// ── Structure: one canonical copy, both consumers wired ─────────────────
check('app.js no longer defines the parser (moved, not duplicated)',
  !appJs.includes('function parseVenueHours(') && !appJs.includes('const CITY_TZ'));
check('app.js modal renderer still present and uses the shared parser',
  appJs.includes('function renderScheduleBlock('));
check('index.html loads schedule.js BEFORE app.js',
  indexHtml.indexOf('js/schedule.js') !== -1 &&
  indexHtml.indexOf('js/schedule.js') < indexHtml.indexOf('js/app.js'));
check('api/spots.js imports the shared module',
  spotsApi.includes("from '../js/schedule.js'"));
check('api/spots.js renders the pill placeholder + grouped rows only when parsed',
  spotsApi.includes('data-open-status') && spotsApi.includes('schedGroupRows(schedParsed)') &&
  spotsApi.includes('schedParsed.ok'));
check('api/spots.js normalizes days before parsing (the full-name trap)',
  spotsApi.includes('normDaysAbbrev(venue.days)'));
check('api/spots.js edge cache is unchanged (no stale-verdict regression)',
  spotsApi.includes('s-maxage=86400'));
check('hydration gates on parsed.ok and fails closed on unmapped cities',
  spotsStatus.includes('if (!parsed.ok)') && spotsStatus.includes('if (!now)') &&
  spotsStatus.includes('el.remove()'));
check('hydration recomputes on visibilitychange (app left open past close)',
  spotsStatus.includes('visibilitychange'));

console.log(`schedule-ssr: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exitCode = 1;
}
