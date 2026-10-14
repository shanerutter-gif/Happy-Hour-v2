/* ═══════════════════════════════════════════════════════
   SCHEDULE.JS — canonical venue-hours parser, shared by the
   app (js/app.js, via a classic <script> tag before app.js)
   and the /spots SSR pages (api/spots.js imports the exports
   below; js/spots-status.js hydrates the status pill).
   Extracted verbatim from js/app.js on 2026-10-14 — this is
   the ONE copy. Behavioural fixtures live in
   tests/schedule-ssr.test.mjs; a failure there is a merge
   blocker (parser drift = wrong open/closed verdicts).
   ═══════════════════════════════════════════════════════ */

// ── SCHEDULE REDESIGN: begin ──
// Freeform hours-string parser → per-day {open, close} in minutes since midnight.
// close may exceed 1440 for past-midnight closes (1am → 1500). Days the string
// never mentions are treated as closed (null), UNLESS v.days lists them as open
// — then they are unparsed (undefined) and the venue falls back to the legacy
// display. NEVER guess: anything ambiguous → unparsed → fallback.
const SCHED_DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const SCHED_DASH = '[–—-]'; // en-dash, em-dash, hyphen

function schedNormDay(tok) {
  const t = String(tok || '').trim().toLowerCase();
  if (t === 'daily') return 'DAILY';
  if (t.length < 3) return null;
  const cap = t.charAt(0).toUpperCase() + t.slice(1, 3).toLowerCase();
  return SCHED_DAYS.includes(cap) ? cap : null;
}

// venues.days arrives in mixed formats: most rows use 3-letter abbreviations
// ("Mon") but ~23% use full names ("Monday"). Every downstream comparison
// (TODAY, day filter, map pins, getTodayHours fallback) uses 3-letter codes,
// so normalize once at load. Read-only: never written back to the DB.
function normDaysAbbrev(days) {
  if (!Array.isArray(days)) return days;
  const out = [];
  for (const d of days) {
    const n = schedNormDay(d);
    if (n && n !== 'DAILY' && !out.includes(n)) out.push(n);
  }
  return out;
}

// Inclusive day expansion, wrapping around the week ("Fri–Sun" → Fri,Sat,Sun)
function schedExpandRange(startDay, endDay) {
  const out = [];
  let i = SCHED_DAYS.indexOf(startDay);
  const end = SCHED_DAYS.indexOf(endDay);
  if (i === -1 || end === -1) return out;
  for (let n = 0; n < 7; n++) {
    out.push(SCHED_DAYS[i]);
    if (i === end) break;
    i = (i + 1) % 7;
  }
  return out;
}

// "Mon–Thu" | "Fri" | "Daily" → [day names], or null when no day token found
function schedParseDayPart(part) {
  const p = String(part || '').trim();
  const m = p.match(new RegExp('^([A-Za-z]+)\\s*' + SCHED_DASH + '\\s*([A-Za-z]+)$'));
  if (m) {
    const a = schedNormDay(m[1]), b = schedNormDay(m[2]);
    if (!a || !b || a === 'DAILY' || b === 'DAILY') return null;
    return schedExpandRange(a, b);
  }
  const d = schedNormDay(p);
  if (d === 'DAILY') return SCHED_DAYS.slice();
  if (d) return [d];
  return null;
}

// "11am–11pm" | "5–9pm" | "11:30am–10pm" | "4pm–12am" → {open, close} | null.
// am/pm inference: "5–9pm" = 5pm–9pm. No marker on either side → null (never guess).
function schedParseTimeRange(str) {
  const parts = String(str || '').trim().split(new RegExp('\\s*' + SCHED_DASH + '\\s*'));
  if (parts.length !== 2) return null;
  const parseOne = (p) => {
    const m = p.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    if (h < 1 || h > 12 || min > 59) return null;
    if (h === 12) h = 0;
    return { mins: h * 60 + min, ap: m[3].toLowerCase() };
  };
  let a = parseOne(parts[0]), b = parseOne(parts[1]);
  if (!a && !b) return null;
  if (!a || !b) {
    const known = (a || b).ap; // inherit the one marker: "5–9pm"
    a = a || parseOne(parts[0] + known + 'm');
    b = b || parseOne(parts[1] + known + 'm');
    if (!a || !b) return null;
  }
  const open = a.mins + (a.ap === 'p' ? 720 : 0);
  let close = b.mins + (b.ap === 'p' ? 720 : 0);
  if (close <= open) close += 1440; // past-midnight: 1am → 1500, 12am → 1440
  return { open, close };
}

// Main entry: parse a venue's freeform hours string.
// Returns { ok, days } where days maps Sun..Sat → {open,close} | null (closed) |
// undefined (unparsed). ok is true only when ≥1 segment parsed and no day is unparsed.
function parseVenueHours(hoursStr, openDays) {
  const days = {};
  SCHED_DAYS.forEach(d => { days[d] = null; }); // default: closed
  const result = { ok: false, days };
  if (!hoursStr || !String(hoursStr).trim()) return result;
  const openSet = new Set(openDays || []);
  const mentioned = new Set();
  const segments = String(hoursStr).split(/\s*[·,;]\s*/);
  let anyParsed = false;
  let pendingDays = []; // days-only segments awaiting a time-only segment ("Mon, Wed" + "5–9pm")
  const markTime = (dayList, timeStr, union = false) => {
    const t = schedParseTimeRange(timeStr);
    if (!t) { // unparseable time: don't clobber a day an earlier segment already nailed
      dayList.forEach(d => { if (days[d] === null) days[d] = undefined; });
      return;
    }
    dayList.forEach(d => {
      // Sub-venue labeled segments ("Pizza counter: …", "Wine bar: …")
      // describe parts of ONE venue: union them (earliest open, latest
      // close) instead of letting the last label win or — worse — the
      // label swallowing the segment and the day reading as closed.
      if (union && days[d]) {
        days[d] = { open: Math.min(days[d].open, t.open), close: Math.max(days[d].close, t.close) };
      } else {
        days[d] = { open: t.open, close: t.close };
      }
      mentioned.add(d);
    });
    anyParsed = true;
  };
  for (const rawSeg of segments) {
    let seg = rawSeg.trim();
    if (!seg) continue;
    // Strip a sub-venue label prefix ("Pizza counter: Mon-Sat 11am-9pm")
    // when the remainder starts with a day token; the segment then
    // contributes as a union (see markTime). The label must be digit-free
    // so a time ("11:30am…") can never be mistaken for one.
    let labeled = false;
    const lm = seg.match(/^([^:]{2,40}):\s+(.+)$/);
    if (lm && !/\d/.test(lm[1]) && schedParseDayPart(lm[2].split(/\s+/)[0])) {
      seg = lm[2].trim();
      labeled = true;
    }
    // "Closed Mon" / "Mon Closed" / bare "Closed"
    if (/\bclosed\b/i.test(seg)) {
      const rest = seg.replace(/\bclosed\b/gi, ' ').trim();
      const dl = rest ? schedParseDayPart(rest) : SCHED_DAYS.slice();
      if (dl) { dl.forEach(d => { days[d] = null; mentioned.add(d); }); anyParsed = true; pendingDays = []; }
      continue;
    }
    // Day-first: "Mon–Thu 5–9pm" · "Daily 11am–11pm" · "Fri 4pm–12am"
    let m = seg.match(new RegExp('^([A-Za-z]+(?:\\s*' + SCHED_DASH + '\\s*[A-Za-z]+)?)\\s+(.+)$'));
    if (m) {
      const dl = schedParseDayPart(m[1]);
      if (dl) { markTime(pendingDays.concat(dl), m[2], labeled); pendingDays = []; }
      continue; // leading non-day word → noise, ignore
    }
    // Time-first: "11am – 10pm Mon–Thu"
    m = seg.match(new RegExp('^(.+?)\\s+([A-Za-z]+(?:\\s*' + SCHED_DASH + '\\s*[A-Za-z]+)?)$'));
    if (m) {
      const dl = schedParseDayPart(m[2]);
      if (dl && schedParseTimeRange(m[1])) { markTime(pendingDays.concat(dl), m[1], labeled); pendingDays = []; }
      continue;
    }
    // Days-only: accumulate for a following time-only segment
    const dl = schedParseDayPart(seg);
    if (dl) { pendingDays = pendingDays.concat(dl); continue; }
    // Time-only with pending days
    if (pendingDays.length && schedParseTimeRange(seg)) { markTime(pendingDays, seg); pendingDays = []; continue; }
    // Unrecognized noise ("call for hours") → ignore
  }
  if (pendingDays.length) pendingDays.forEach(d => { if (days[d] === null) days[d] = undefined; });
  // Conflict: v.days claims a day the string never mentions → don't guess
  SCHED_DAYS.forEach(d => { if (openSet.has(d) && !mentioned.has(d)) days[d] = undefined; });
  result.ok = anyParsed && SCHED_DAYS.every(d => days[d] !== undefined);
  return result;
}

// 660 → "11am" · 1500 → "1am" · 1290 → "9:30pm" · 1440 → "12am"
function schedFmt(mins) {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  let h = Math.floor(m / 60);
  const mm = m % 60;
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12; if (h === 0) h = 12;
  return mm ? h + ':' + String(mm).padStart(2, '0') + ap : h + ap;
}

// Open-now status from parsed hours. Handles past-midnight closes: a 1am close
// means still open at 12:30am (checked against the previous day's hours).
// Returns { state: 'open'|'closed', label }.
function getOpenStatus(parsed, dayName, minsNow) {
  const idx = SCHED_DAYS.indexOf(dayName);
  const prev = parsed.days[SCHED_DAYS[(idx + 6) % 7]];
  if (prev && prev.open != null && prev.close > 1440 && minsNow < prev.close - 1440) {
    return { state: 'open', label: 'Open now · Closes ' + schedFmt(prev.close) };
  }
  const today = parsed.days[dayName];
  if (today && today.open != null) {
    if (minsNow >= today.open && minsNow < today.close) {
      return { state: 'open', label: 'Open now · Closes ' + schedFmt(today.close) };
    }
    if (minsNow < today.open) {
      return { state: 'closed', label: 'Closed · Opens ' + schedFmt(today.open) + ' today' };
    }
  }
  for (let k = 1; k <= 7; k++) {
    const d = SCHED_DAYS[(idx + k) % 7];
    const h = parsed.days[d];
    if (h && h.open != null) {
      return { state: 'closed', label: 'Closed · Opens ' + schedFmt(h.open) + (k === 1 ? ' tomorrow' : ' ' + d) };
    }
  }
  return { state: 'closed', label: 'Closed today' };
}

// Collapse consecutive days with identical hours into grouped rows.
// Display order is Monday-first (SCHED_DAYS stays Sun-first: it is the
// parser/verdict indexing, not a display order). The rows form a strict
// PARTITION of the week — every day appears in exactly one row — and
// Sat/Sun are adjacent, so a weekend span ("Sat–Sun 12pm–2am") can never
// split into two overlapping-looking rows at opposite ends of the table
// (the ac90bea defect: Sun-first linear grouping stranded Sat and Sun
// with identical hours as separate first/last rows). Both consumers
// (modal + SSR) render THIS function, so grouping parity is structural.
const SCHED_DISPLAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function schedGroupRows(parsed) {
  const rows = [];
  let i = 0;
  while (i < 7) {
    const h = parsed.days[SCHED_DISPLAY_ORDER[i]];
    const key = h ? h.open + '-' + h.close : 'closed';
    let j = i;
    while (j + 1 < 7) {
      const h2 = parsed.days[SCHED_DISPLAY_ORDER[j + 1]];
      if ((h2 ? h2.open + '-' + h2.close : 'closed') !== key) break;
      j++;
    }
    rows.push({ days: SCHED_DISPLAY_ORDER.slice(i, j + 1), hours: h });
    i = j + 1;
  }
  return rows;
}

// ── CITY TIMEZONES ──
// Every live city_slug → IANA zone. Completed 2026-10-14 (the app.js
// original mapped only the two Pacific markets and silently defaulted
// the rest to Los Angeles). zonedNow() FAILS CLOSED: an unmapped city
// returns null and callers show no verdict, never a guessed one.
const CITY_TZ = {
  'san-diego': 'America/Los_Angeles',
  'orange-county': 'America/Los_Angeles',
  'los-angeles': 'America/Los_Angeles',
  'new-york': 'America/New_York',
  'miami': 'America/New_York',
  'chicago': 'America/Chicago',
  'austin': 'America/Chicago'
};

// Current weekday + minutes since midnight in the city's timezone
// (modelled on hhNow() in js/app.js, but keyed by an explicit slug).
// Returns { dayName, mins, tz } or null when the city is unmapped or
// the zone math fails — callers must treat null as "no verdict".
// `at` is an optional instant (tests pin it); production passes nothing.
// The verdict clock is ALWAYS this function with the VENUE's slug —
// never the browser's local clock and never the browsing city's clock
// (the ac90bea split-brain: modal paired hhNow's browsing-city day
// with browser-local minutes, so one page could show two verdicts).
function zonedNow(citySlug, at) {
  const tz = CITY_TZ[citySlug];
  if (!tz) return null;
  try {
    const map = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' })
      .formatToParts(at || new Date()).forEach(p => { map[p.type] = p.value; });
    if (!SCHED_DAYS.includes(map.weekday)) return null;
    let h = parseInt(map.hour, 10);
    if (h === 24) h = 0;
    return { dayName: map.weekday, mins: h * 60 + parseInt(map.minute, 10), tz };
  } catch (e) { return null; }
}

// Node / edge-bundler export surface. In the browser this file is a
// classic script and the declarations above are the globals.
const __scheduleExports = {
  SCHED_DAYS, SCHED_DASH, schedNormDay, normDaysAbbrev, schedExpandRange,
  schedParseDayPart, schedParseTimeRange, parseVenueHours, schedFmt,
  getOpenStatus, schedGroupRows, SCHED_DISPLAY_ORDER, CITY_TZ, zonedNow
};
if (typeof module !== 'undefined' && module.exports) module.exports = __scheduleExports;
