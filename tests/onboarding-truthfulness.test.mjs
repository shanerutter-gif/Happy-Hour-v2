// Onboarding truthfulness regression tests (node).
// Run: node tests/onboarding-truthfulness.test.mjs
// Guards the Leo 2026-10-16 onboarding re-audit findings (F2/F4/F6/F7):
//  F6 — the neighborhoods screen shuffled its rows on every render and
//       pinned the "🔥 Most popular tonight" badge on a RANDOM one of the
//       first 3 shuffled rows, ignoring both the deal counts printed on
//       the same screen and the config's `popular` flag — so the badge
//       routinely contradicted the numbers beside it and the list order
//       changed between visits. The badge must sit on the highest-deals
//       row and the order must be deterministic (deals descending).
//  F2 — the map screen's overlay card and its first preview card were
//       rendered from the SAME randomly picked featured venue, so one
//       venue appeared twice in a single viewport. The preview card
//       must show a different venue than the map card.
//  F7 — the onboarding city picker's hardcoded taglines ("520+ spots
//       live") had drifted 1–3 below the homepage's CITIES venue_count
//       for 6 of 7 cities. The two surfaces must quote the same count.
//  F4 — the attribution screen carried two controls wired to the exact
//       same skip action (top-right "Skip" AND a sticky "Skip for now →"
//       bar). Picking an answer already auto-advances; one skip is
//       enough. The screen must contain exactly one skip control.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const obSrc = readFileSync(join(ROOT, 'js/onboarding.js'), 'utf8');
const appSrc = readFileSync(join(ROOT, 'js/app.js'), 'utf8');
const indexSrc = readFileSync(join(ROOT, 'index.html'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}

// ── Load onboarding.js in a vm with a minimal DOM stub ─────────────────
const els = {};
function elFor(id) {
  if (!els[id]) els[id] = { textContent: '', innerHTML: '', dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {} } };
  return els[id];
}
const sandbox = {
  console,
  localStorage: { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; }, key() { return null; }, length: 0 },
  sessionStorage: { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } },
  document: {
    getElementById: (id) => elFor(id),
    querySelectorAll: () => [],
  },
  setInterval: () => 0, clearInterval: () => {},
  setTimeout: () => 0,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(obSrc, sandbox, { filename: 'js/onboarding.js' });

// ── F6: badge determinism + deals-max + descending order ───────────────
function renderNeighborhoods() {
  elFor('obNeighGrid').dataset = {}; // obRenderNeighborhoods renders once per dataset flag
  vm.runInContext("obState._screen3Headline = OB_SCREEN3_HEADLINES[0]; obRenderNeighborhoods();", sandbox);
  return elFor('obNeighGrid').innerHTML;
}
function parseRows(html) {
  const rows = [];
  const re = /<button class="ob-neigh-btn([^"]*)"[\s\S]*?<span class="ob-neigh-name">([^<]+)<\/span>\s*<span class="ob-neigh-deals">(\d+) deals live<\/span>/g;
  let m;
  while ((m = re.exec(html)) !== null) rows.push({ cls: m[1], name: m[2], deals: Number(m[3]), badged: html.slice(Math.max(0, m.index - 200), m.index).includes('ob-popular-badge') || m[1].includes('popular') });
  // Badge span sits INSIDE the button before the name span; detect per-row by slicing between buttons.
  const parts = html.split('<button class="ob-neigh-btn').slice(1);
  return parts.map((p, i) => ({ name: rows[i]?.name, deals: rows[i]?.deals, badged: p.includes('Most popular tonight') }));
}

let badgeAlwaysMax = true, orderAlwaysDesc = true, deterministic = true, exactlyOneBadge = true;
let firstHtml = null, maxDealsName = null;
for (let i = 0; i < 25; i++) {
  const html = renderNeighborhoods();
  if (firstHtml === null) firstHtml = html;
  if (html !== firstHtml) deterministic = false;
  const rows = parseRows(html);
  const badges = rows.filter(r => r.badged);
  if (badges.length !== 1) exactlyOneBadge = false;
  const maxDeals = Math.max(...rows.map(r => r.deals));
  const maxRow = rows.find(r => r.deals === maxDeals);
  if (i === 0) maxDealsName = maxRow?.name;
  if (!badges[0] || badges[0].deals !== maxDeals) badgeAlwaysMax = false;
  for (let j = 1; j < rows.length; j++) if (rows[j].deals > rows[j - 1].deals) orderAlwaysDesc = false;
}
check('F6: exactly one "Most popular tonight" badge per render', exactlyOneBadge);
check('F6: badge always on the highest-deals neighborhood', badgeAlwaysMax, `expected max-deals row (${maxDealsName})`);
check('F6: neighborhood order is deals-descending', orderAlwaysDesc);
check('F6: neighborhood render is deterministic across visits', deterministic);
check('F6: render path no longer shuffles neighborhoods',
  !/function obRenderNeighborhoods\(\)[\s\S]*?_obShuffle\(obCity\(\)\.neighborhoods\)/.test(obSrc));

// ── F2: map card and preview card never show the same venue ────────────
let dupeSeen = false, runs = 0;
for (let i = 0; i < 60; i++) {
  vm.runInContext('obPopulateDynamic();', sandbox);
  const mapName = elFor('obMapCardName').textContent;
  const previewName = elFor('obPreviewVenue').textContent;
  if (mapName && previewName) { runs++; if (mapName === previewName) dupeSeen = true; }
}
check('F2: map overlay and preview card show different venues (60 picks)', runs === 60 && !dupeSeen);

// ── F7: picker taglines match homepage CITIES counts ───────────────────
const citiesCounts = {};
for (const m of appSrc.matchAll(/slug:'([a-z-]+)',\s*name:'[^']+',\s*state_code:'[A-Z]+',\s*venue_count:(\d+)/g)) {
  citiesCounts[m[1]] = Number(m[2]);
}
const taglines = {};
for (const m of obSrc.matchAll(/'([a-z-]+)': \{\s*\n\s*name: '[^']+', state: '([A-Z]+)', tagline: '(\d+)\+ spots live'/g)) {
  taglines[m[1]] = Number(m[3]);
}
check('F7: parsed all 7 CITIES counts and all 7 onboarding taglines',
  Object.keys(citiesCounts).length === 7 && Object.keys(taglines).length === 7,
  `cities=${Object.keys(citiesCounts).length} taglines=${Object.keys(taglines).length}`);
for (const slug of Object.keys(citiesCounts)) {
  check(`F7: ${slug} picker count matches homepage (${citiesCounts[slug]})`,
    taglines[slug] === citiesCounts[slug], `picker=${taglines[slug]}`);
}

// ── F4: attribution screen has exactly one skip control ────────────────
const attrStart = indexSrc.indexOf('id="obScreen4"');
const attrEnd = indexSrc.indexOf('id="obScreenSocial"');
const attrBlock = attrStart !== -1 && attrEnd !== -1 ? indexSrc.slice(attrStart, attrEnd) : '';
const skipCalls = (attrBlock.match(/obAttributionSkip\(\)/g) || []).length;
check('F4: attribution screen contains exactly one obAttributionSkip control', skipCalls === 1, `found ${skipCalls}`);
check('F4: attribution screen has no duplicate sticky "Skip for now" bar', !attrBlock.includes('Skip for now'));

console.log(`onboarding-truthfulness: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exitCode = 1;
}
