// Onboarding fabricated-numbers regression tests (node).
// Run: node tests/onboarding-fabricated-numbers.test.mjs
// Guards the Ravi 2026-10-18 findings (same family as the 2026-10-17
// truthfulness bundle, Leo F2/F4/F6/F7):
//  N1 — the map screen's featured-venue card printed a countdown
//       ("Ends in Xh Ym") generated from Math.random() on every render,
//       directly under the venue's real deal window. The main app has a
//       REAL "Ends in" badge (js/app.js fmtHHRemaining, computed from
//       venue data); onboarding mimicked it with invented numbers.
//       The onboarding card must claim no countdown at all — hood only.
//  N2 — the "live counter" was a hardcoded seed (47) random-walked ±2
//       every 4.5s, and the SAME invented number was labelled two
//       different things on two screens: "N people out right now"
//       (welcome pill) and "N deals are live right now" (Screen 1).
//       Neither was measured. The number must now be the selected
//       city's config deal total (the same config counts the
//       neighborhoods screen prints and the F6/F7 fixes treat as the
//       onboarding source of truth), labelled as deals on both
//       surfaces, and it must never move on a timer.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const obSrc = readFileSync(join(ROOT, 'js/onboarding.js'), 'utf8');
const indexSrc = readFileSync(join(ROOT, 'index.html'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}

// ── Source-level guards ────────────────────────────────────────────────
check('N1: onboarding.js contains no "Ends in" countdown text', !obSrc.includes('Ends in'));
check('N1: index.html onboarding markup contains no ob-timer span', !indexSrc.includes('ob-timer'));
check('N1: index.html onboarding markup contains no "Ends in"', !indexSrc.includes('Ends in'));
check('N2: index.html no longer claims "people out right now"', !indexSrc.includes('people out right now'));
check('N2: onboarding.js has no random-walk delta on liveCount', !/liveCount\s*\+\s*delta/.test(obSrc) && !obSrc.includes('Math.floor(Math.random() * 5) - 2'));

// ── Load onboarding.js in a vm with a minimal DOM stub ─────────────────
const els = {};
function elFor(id) {
  if (!els[id]) els[id] = { textContent: '', innerHTML: '', dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {} } };
  return els[id];
}
let intervalCalls = 0;
const sandbox = {
  console,
  localStorage: { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; }, key() { return null; }, length: 0 },
  sessionStorage: { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } },
  document: {
    getElementById: (id) => elFor(id),
    querySelectorAll: () => [],
  },
  setInterval: () => { intervalCalls++; return 0; }, clearInterval: () => {},
  setTimeout: () => 0,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(obSrc, sandbox, { filename: 'js/onboarding.js' });

function cityDealSum(slug) {
  return vm.runInContext(`OB_CITY_CONFIG['${slug}'].neighborhoods.reduce((a, n) => a + n.deals, 0)`, sandbox);
}

// ── N2 seed guard: initial liveCount equals the San Diego config sum ──
const sdSum = cityDealSum('san-diego');
const seed = vm.runInContext('obState.liveCount', sandbox);
check('N2: initial liveCount equals San Diego config deal sum', seed === sdSum, `seed=${seed} sdSum=${sdSum}`);
const pillMatch = indexSrc.match(/<span class="ob-live-num">(\d+)<\/span>/);
check('N2: index.html static live-num placeholder equals San Diego config deal sum',
  pillMatch && Number(pillMatch[1]) === sdSum, pillMatch ? `placeholder=${pillMatch[1]} sdSum=${sdSum}` : 'no placeholder found');

// ── N1/N2 behaviour: populate the map screen for San Diego ─────────────
vm.runInContext("obState.citySlug = 'san-diego'; obPopulateDynamic();", sandbox);
const meta = elFor('obMapCardMeta').textContent;
const cardName = elFor('obMapCardName').textContent;
const featHood = vm.runInContext(`(OB_CITY_CONFIG['san-diego'].featured.find(f => f.name === ${JSON.stringify(cardName)}) || {}).hood`, sandbox);
check('N1: map card meta is exactly the featured venue hood (no countdown)', meta === featHood, `meta=${JSON.stringify(meta)} hood=${JSON.stringify(featHood)}`);
check('N2: liveCount after populate equals San Diego config deal sum',
  vm.runInContext('obState.liveCount', sandbox) === sdSum);

// ── N2 behaviour: the counter never starts a random-walk interval ──────
vm.runInContext('obStartLiveCounter();', sandbox);
check('N2: obStartLiveCounter registers no interval', intervalCalls === 0, `intervalCalls=${intervalCalls}`);
check('N2: liveCount unchanged by obStartLiveCounter',
  vm.runInContext('obState.liveCount', sandbox) === sdSum);

// ── N2 behaviour: switching city re-derives the count ──────────────────
const laSum = cityDealSum('los-angeles');
vm.runInContext("obState.citySlug = 'los-angeles'; obPopulateDynamic();", sandbox);
check('N2: liveCount after switching to Los Angeles equals LA config deal sum',
  vm.runInContext('obState.liveCount', sandbox) === laSum, `liveCount=${vm.runInContext('obState.liveCount', sandbox)} laSum=${laSum}`);
const metaLA = elFor('obMapCardMeta').textContent;
check('N1: LA map card meta has no countdown either', !metaLA.includes('Ends in') && !metaLA.includes('ob-timer'), `meta=${JSON.stringify(metaLA)}`);

console.log(`\nonboarding-fabricated-numbers: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
