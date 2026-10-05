// api/_lib/seo.js — shared SEO helpers for the edge-SSR routes.
// Edge-safe: no Node APIs, only pure functions. Imported by api/spots.js,
// api/sitemap-venues.js, api/sitemap-cities.js, api/happy-hour.js and
// api/spots-directory.js so every route agrees on slugs and canonical URLs.

export function slugify(name) {
  return (name || '').toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* ── Venue slug disambiguation ──────────────────────────────────────────
   slugify(name) ignores city, so ~44 cross-city name collisions exist
   ("Yard House" in San Diego vs Los Angeles, …). Previously the sitemap
   deduped by keeping the first and /spots/<slug> resolved via .find(),
   leaving losing venues with no indexable URL (their would-be URL 404'd).

   Group venues by natural slug IN THE ORDER GIVEN. Callers MUST pass rows in
   the same relative order — the PostgREST default (physical) order with no
   explicit order= param — so "first" matches what /spots/<slug> historically
   resolved to. Two passes:
     pass 1: every group-first keeps its natural slug (never breaks a
             currently-indexed winning URL);
     pass 2: losers get `<slug>-<city_slug>`, with a numeric fallback if that
             is somehow already taken.
   Returns { byId: Map<venueId, canonicalSlug>, bySlug: Map<canonicalSlug, venue> }. */
export function canonicalVenueSlugs(venues) {
  const groups = new Map();
  for (const v of venues) {
    const s = slugify(v.name);
    if (!s) continue;
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(v);
  }
  const byId = new Map();
  const bySlug = new Map();
  const used = new Set();
  const claim = (v, slug) => {
    let c = slug;
    let n = 2;
    while (used.has(c)) c = `${slug}-${n++}`;
    used.add(c);
    if (v.id != null) byId.set(v.id, c);
    bySlug.set(c, v);
  };
  for (const [nat, list] of groups) claim(list[0], nat); // winners keep URLs
  for (const [nat, list] of groups) {
    for (let i = 1; i < list.length; i++) {
      const cityPart = slugify(list[i].city_slug) || 'venue';
      claim(list[i], `${nat}-${cityPart}`);
    }
  }
  return { byId, bySlug };
}

/* ── Neighborhood canonicalization ────────────────────────────────────
   venues.neighborhood is freeform text, so variants ("Gaslamp" vs "Gaslamp
   Quarter", "PB" vs "Pacific Beach") used to spawn duplicate thin
   /happy-hour/<city>/<hood> pages. canonicalHood() maps known variants to one
   canonical slug + display name. Unknown variants are returned as-is
   (slugified) with mapped:false so callers can log them for admin cleanup —
   never silently dropped. */
export const NEIGHBORHOOD_NAMES = {
  'north-park': 'North Park',
  'gaslamp-quarter': 'Gaslamp Quarter',
  'pacific-beach': 'Pacific Beach',
  'ocean-beach': 'Ocean Beach',
  'mission-beach': 'Mission Beach',
  'hillcrest': 'Hillcrest',
  'old-town': 'Old Town',
  'downtown': 'Downtown',
  'east-village': 'East Village',
  'south-park': 'South Park',
  'normal-heights': 'Normal Heights',
  'university-heights': 'University Heights',
  'la-jolla': 'La Jolla',
  'point-loma': 'Point Loma',
};

// variant slug -> canonical slug
export const NEIGHBORHOOD_ALIASES = {
  'gaslamp': 'gaslamp-quarter',
  'pb': 'pacific-beach',
  'ob': 'ocean-beach',
};

export function canonicalHood(raw) {
  if (!raw || !String(raw).trim()) return null;
  const s = slugify(raw);
  if (!s) return null;
  if (NEIGHBORHOOD_NAMES[s]) return { slug: s, name: NEIGHBORHOOD_NAMES[s], mapped: true };
  const canon = NEIGHBORHOOD_ALIASES[s];
  if (canon && NEIGHBORHOOD_NAMES[canon]) {
    return { slug: canon, name: NEIGHBORHOOD_NAMES[canon], mapped: true };
  }
  return { slug: s, name: String(raw).trim(), mapped: false };
}

export function isHoodAlias(slug) {
  return !!NEIGHBORHOOD_ALIASES[(slug || '').toLowerCase()];
}

/* ── Conservative opening-hours parsing ───────────────────────────────
   Same philosophy as happy-hour.js parseStartHour: only emit structured hours
   when the freeform string is unambiguous. Returns { opens, closes } in
   24h "HH:MM", or null. NEVER guess. */
export function parseHoursRange(hours) {
  if (!hours) return null;
  const m = String(hours).match(
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i
  );
  if (!m) return null;
  const to24 = (h, min, ap) => {
    h = parseInt(h, 10);
    min = min ? parseInt(min, 10) : 0;
    if (min > 59) return null;
    ap = ap.toLowerCase();
    if (ap === 'pm' && h !== 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h < 0 || h > 23) return null;
    return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
  };
  const opens = to24(m[1], m[2], m[3]);
  const closes = to24(m[4], m[5], m[6]);
  if (!opens || !closes) return null;
  return { opens, closes };
}

const DAY_TO_SCHEMA = {
  Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday',
  Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday',
};

// Full openingHoursSpecification payload, or null when anything is ambiguous.
export function openingHoursSpec(days, hours) {
  if (!Array.isArray(days) || days.length === 0) return null;
  const dayOfWeek = [];
  for (const d of days) {
    const full = DAY_TO_SCHEMA[d];
    if (!full) return null; // unknown day token — omit rather than guess
    dayOfWeek.push(full);
  }
  const range = parseHoursRange(hours);
  if (!range) return null;
  return { dayOfWeek, opens: range.opens, closes: range.closes };
}
