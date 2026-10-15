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
// Sub-venue labels ("Pizza counter:", "Wine bar:") must not swallow
// their segments: labeled parts of one venue union into a single span
// (earliest open, latest close). Regression shape: Smalls, Austin —
// pre-fix this parsed Mon–Sat as CLOSED with only Sun surviving.
{
  const p = S.parseVenueHours(
    'Pizza counter: Mon-Sat 11am-9pm, Sun 11am-3pm; Wine bar: Mon-Sat 4pm-10pm', []);
  check('labeled sub-venue segments parse ok', p.ok === true);
  check('labeled segments union Mon–Sat to 11am–10pm',
    p.days.Mon && p.days.Mon.open === 660 && p.days.Mon.close === 1320 &&
    p.days.Sat && p.days.Sat.open === 660 && p.days.Sat.close === 1320,
    JSON.stringify(p.days.Mon));
  check('unlabeled Sun segment unaffected by labels', p.days.Sun && p.days.Sun.open === 660 && p.days.Sun.close === 900);
  const st = S.getOpenStatus(p, 'Wed', 18 * 60 + 41); // Wed 6:41pm venue-local
  check('Smalls verdict at Wed 6:41pm: open, closes 10pm',
    st.state === 'open' && st.label === 'Open now · Closes 10pm', st.label);
  const plain = S.parseVenueHours('Mon 11am-9pm · Mon 4pm-10pm', ['Mon']);
  check('unlabeled same-day segments keep overwrite semantics (no union)',
    plain.days.Mon && plain.days.Mon.open === 960 && plain.days.Mon.close === 1320);
}
// Unparseable string → no verdict, ever.
{
  const p = S.parseVenueHours('Call for hours', []);
  check('unparseable hours yield ok=false', p.ok === false);
}
// Grouped rows collapse identical consecutive days (Mon-first display).
{
  const p = S.parseVenueHours('Mon–Fri 11am–10pm · Sat 10am–11pm · Closed Sun', S.normDaysAbbrev(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']));
  const rows = S.schedGroupRows(p);
  check('grouped rows: Mon–Fri / Sat / Sun closed',
    rows.length === 3 && rows[0].days.length === 5 && rows[1].days[0] === 'Sat' && rows[2].hours === null,
    JSON.stringify(rows.map(r => r.days)));
}
// Weekend partition regression (the ac90bea defect class): Sat and Sun
// with identical hours must form ONE row, and the rows must partition
// the week — no day in two rows, no day missing — for any schedule.
{
  const p = S.parseVenueHours('Mon–Fri 1pm–2am · Sat–Sun 12pm–2am',
    S.normDaysAbbrev(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']));
  check('overnight weekend venue parses ok', p.ok === true);
  const rows = S.schedGroupRows(p);
  check('Sat–Sun identical overnight hours merge into one row',
    rows.length === 2 && JSON.stringify(rows[1].days) === '["Sat","Sun"]' &&
    rows[1].hours.open === 720 && rows[1].hours.close === 1560,
    JSON.stringify(rows.map(r => r.days)));
  const flat = rows.flatMap(r => r.days);
  check('grouped rows partition the week (each day exactly once, Mon-first)',
    JSON.stringify(flat) === JSON.stringify(S.SCHED_DISPLAY_ORDER));
}
// Overnight verdict after midnight in the venue's own zone.
{
  const p = S.parseVenueHours('Mon–Fri 1pm–2am · Sat–Sun 12pm–2am',
    S.normDaysAbbrev(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']));
  const st = S.getOpenStatus(p, 'Sun', 60); // Sun 01:00 — inside Sat's 12pm–2am span
  check('Sun 1am still open via Saturday overnight span',
    st.state === 'open' && st.label === 'Open now · Closes 2am', st.label);
  const st2 = S.getOpenStatus(p, 'Sun', 180); // Sun 03:00 — span ended 2am, opens 12pm
  check('Sun 3am closed, opens 12pm today',
    st2.state === 'closed' && st2.label === 'Closed · Opens 12pm today', st2.label);
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
// Venue-local evaluation, pinned to ONE instant (Sat 2026-10-17 05:30 UTC
// = Fri 22:30 PDT / Sat 00:30 CDT / Sat 01:30 EDT): the same UTC moment
// is a different local day/time per city, and the verdict for the same
// venue hours must follow the VENUE's zone — never the viewer's clock.
{
  const at = new Date(Date.UTC(2026, 9, 17, 5, 30));
  const la = S.zonedNow('los-angeles', at), aus = S.zonedNow('austin', at), ny = S.zonedNow('new-york', at);
  check('pinned instant: LA is Fri 22:30', la.dayName === 'Fri' && la.mins === 1350, JSON.stringify(la));
  check('pinned instant: Austin is Sat 00:30', aus.dayName === 'Sat' && aus.mins === 30, JSON.stringify(aus));
  check('pinned instant: New York is Sat 01:30', ny.dayName === 'Sat' && ny.mins === 90, JSON.stringify(ny));
  const p = S.parseVenueHours('Fri 4pm–1am', ['Fri']);
  const vAus = S.getOpenStatus(p, aus.dayName, aus.mins);
  check('Austin venue at Sat 00:30 local: still open via Fri overnight span',
    vAus.state === 'open' && vAus.label === 'Open now · Closes 1am', vAus.label);
  const vNy = S.getOpenStatus(p, ny.dayName, ny.mins);
  check('same hours in New York at Sat 01:30 local: closed (span ended 1am)',
    vNy.state === 'closed' && vNy.label === 'Closed · Opens 4pm Fri', vNy.label);
  const vLa = S.getOpenStatus(p, la.dayName, la.mins);
  check('same hours in Los Angeles at Fri 22:30 local: open in today\'s window',
    vLa.state === 'open' && vLa.label === 'Open now · Closes 1am', vLa.label);
}

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
check('api/spots.js edge cache bounds hours staleness (1h fresh, verdict never cached)',
  spotsApi.includes('s-maxage=3600') && !spotsApi.includes('s-maxage=86400'));
check('api/spots.js SSR gate is ON for the Phase-2 rebuild',
  spotsApi.includes('SSR_OPEN_STATUS_ENABLED = true'));
check('modal parses with normalized days (SSR parity gate)',
  appJs.includes('parseVenueHours(v.hours, normDaysAbbrev(v.days))'));
check('modal verdict clock is the venue timezone (zonedNow on the venue slug)',
  appJs.includes('zonedNow(v.city_slug)') && !appJs.includes('now.getHours() * 60 + now.getMinutes()'));
check('getTodayHours parses with normalized days (feed/map parity gate)',
  appJs.includes('function getTodayHours(') &&
  appJs.slice(appJs.indexOf('function getTodayHours('), appJs.indexOf('function getTodayHours(') + 4000)
    .includes('parseVenueHours(v.hours, normDaysAbbrev(v.days))'));
check('no app.js consumer parses with raw v.days (the full-name trap)',
  !appJs.includes('parseVenueHours(v.hours, v.days)'));
// Functional shape of the trap getTodayHours must guard against: a venue
// whose HH days claim Saturday in full-name form while its hours string
// never mentions Saturday. Normalized, the claimed-day safety check
// fires (ok=false -> caller falls back to the raw string, no verdict).
// Unnormalized, the check silently disables and ok=true licenses a
// definitive "Not open today" from an incomplete string.
{
  const hours = 'Mon–Fri 11am–10pm';
  check('full-name claimed day disables the safety check when unnormalized (the trap)',
    S.parseVenueHours(hours, ['Saturday']).ok === true);
  check('normalized claimed day fires the safety check (no false verdict)',
    S.parseVenueHours(hours, S.normDaysAbbrev(['Saturday'])).ok === false);
}
check('hydration refreshes the verdict on a timer (no frozen pill)',
  spotsStatus.includes('setInterval(hydrate, 60000)'));
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
