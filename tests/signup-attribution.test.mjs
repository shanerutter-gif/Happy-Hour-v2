// Signup attribution regression tests (node).
// Run: node tests/signup-attribution.test.mjs
// Guards the Oct 2026 attribution gap closed on 2026-10-14: signups were
// only attributed when a UTM tag or an onboarding survey answer had been
// stashed, so stash-gated direct signups (arrive straight at the app, no
// tagged landing) wrote NO signup_attributions row and were
// unattributable. Now capturePendingUtm always stashes (referrer +
// landing page of the session's first page load) and
// applyPendingAttribution always writes a row whose source is the survey
// answer, 'referral' (external referrer or ?ref= code), or 'web'.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = readFileSync(join(ROOT, 'js/db.js'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}

// Slice out one top-level function's full text (balanced braces).
function fnText(name, src) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) return '';
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}

// ── capturePendingUtm: always stash, with landing page ──────────────────
const cap = fnText('capturePendingUtm', db);
check('capturePendingUtm exists', cap.length > 0);
check('capture is first-touch (never overwrites an existing stash)',
  cap.includes('if (sessionStorage.getItem(PENDING_UTM_KEY)) return;'));
check('capture stashes the landing page path',
  cap.includes('utm.landing_page') && cap.includes('window.location.pathname'));
check('capture no longer bails when there is no UTM and no referrer',
  !cap.includes('!hasUtm && !ref'));
check('capture still records only external referrers',
  cap.includes('ru.origin !== window.location.origin'));

// ── applyPendingAttribution: always writes ──────────────────────────────
const app = fnText('applyPendingAttribution', db);
check('applyPendingAttribution exists', app.length > 0);
check('apply no longer returns early when nothing was stashed',
  !app.includes('if (!source && !hasUtm) return null'));
check('apply classifies via resolveAttributionSource',
  app.includes('resolveAttributionSource('));
check('apply copies landing_page into the row when present',
  app.includes("'landing_page'"));
check('apply degrades gracefully before the landing_page migration (PGRST204 retry)',
  app.includes("error.code === 'PGRST204'") && app.includes('delete row.landing_page'));
check('apply still treats a duplicate row as success (23505, first-touch wins)',
  app.includes("error.code !== '23505'"));
check('apply still clears the stash afterwards',
  app.includes('sessionStorage.removeItem(PENDING_UTM_KEY)'));

// ── resolveAttributionSource: classification logic (functional) ─────────
const resolverSrc = fnText('resolveAttributionSource', db);
check('resolveAttributionSource exists', resolverSrc.length > 0);
const resolveAttributionSource = new Function(`${resolverSrc}; return resolveAttributionSource;`)();
check('survey answer wins over referrer and ref code',
  resolveAttributionSource('tiktok', { referrer: 'https://www.google.com/' }, true) === 'tiktok');
check('external referrer classifies as referral',
  resolveAttributionSource(null, { referrer: 'https://www.google.com/' }, false) === 'referral');
check('a ?ref= code classifies as referral',
  resolveAttributionSource(null, {}, true) === 'referral');
check('bare direct arrival classifies as web',
  resolveAttributionSource(null, {}, false) === 'web');
check('landing page alone (no referrer) still classifies as web',
  resolveAttributionSource(null, { landing_page: '/spots/1st-street-bar' }, false) === 'web');
check('empty-string survey answer falls through to classification',
  resolveAttributionSource('', { referrer: 'https://x.com/' }, false) === 'referral');

// Every classification outcome must be inside the live source CHECK
// (sql/fix-signup-attribution-source.sql, 16 values).
const CHECK_VALUES = ['app_store', 'google', 'friend', 'tiktok', 'instagram', 'event', 'other',
  'twitter', 'facebook', 'email', 'reddit', 'podcast', 'press', 'referral', 'business_portal', 'web'];
check('all classification outcomes are CHECK-legal',
  ['referral', 'web'].every(v => CHECK_VALUES.includes(v)));

console.log(`signup-attribution: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exitCode = 1;
}
