// Onboarding guard tests — Sofia 2026-11-05 audit (onboarding slice).
// Guards three NEW findings (code-verified at HEAD 83327ea; the emulated
// iPhone pass was blocked this run by the Hatch Chromium WebGL policy —
// see qa-2026-11-05-onboarding.md):
//  S1 — Stale neighborhood across a city change: obSelectNeighborhood writes
//       obState.selectedNeighborhood once and nothing ever clears it.
//       obSelectCity() re-stashes picks without invalidating the pick, so a
//       user who picks East Austin, goes back, switches to San Diego and
//       skips the hood screen is written to Loops (and the OAuth stash) as
//       San Diego + East Austin. _loopsSignupContext (js/db.js) reads
//       obState.selectedNeighborhood FIRST, so the stale value wins.
//  S2 — Auto-advance race: obSelectCity / obSelectNeighborhood /
//       obSelectAttribution schedule a bare setTimeout(obNext) that reads
//       obState.screen at fire time. Two rapid picks advance TWO screens
//       (the value-preview screen is skipped); a Back tap inside the window
//       is overridden by the stale timer (user is dragged forward again).
//  S3 — Focus left inside aria-hidden screens: obGoTo sets aria-hidden=true
//       on the screen being left but never moves/releases focus, so the
//       tapped control stays document.activeElement inside an aria-hidden
//       subtree (VoiceOver/keyboard lose their place; ARIA forbids focus
//       inside aria-hidden content).
// Run: node tests/onboarding-2026-11-05-sofia.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const obSrc = readFileSync(join(ROOT, 'js/onboarding.js'), 'utf8');
const dbSrc = readFileSync(join(ROOT, 'js/db.js'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Minimal DOM stub ───────────────────────────────────────────────────
function makeScreen(id) {
  const s = { id, classes: new Set(), attrs: {}, children: new Set(),
    classList: { add(...c) { c.forEach(x => s.classes.add(x)); },
                 remove(...c) { c.forEach(x => s.classes.delete(x)); },
                 toggle() {} },
    setAttribute(k, v) { s.attrs[k] = v; },
    removeAttribute(k) { delete s.attrs[k]; },
    getAttribute(k) { return k in s.attrs ? s.attrs[k] : null; },
    contains(el) { return s.children.has(el); } };
  return s;
}
const screens = Array.from({ length: 8 }, (_, i) => makeScreen('screen' + i));
const els = {};
function elFor(id) {
  if (!els[id]) els[id] = { textContent: '', innerHTML: '', dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; } };
  return els[id];
}
const storage = () => ({ _m: {}, getItem(k) { return this?._m?.[k] ?? null; } });
function makeStorage() {
  return { _m: {},
    getItem(k) { return k in this._m ? this._m[k] : null; },
    setItem(k, v) { this._m[k] = String(v); },
    removeItem(k) { delete this._m[k]; },
    key() { return null; }, length: 0 };
}
const documentStub = {
  activeElement: null,
  body: { tagName: 'BODY' },
  getElementById: (id) => elFor(id),
  querySelectorAll: (sel) => {
    if (sel === '.ob-screen') return screens;
    return [];
  },
};
const sandbox = {
  console,
  localStorage: makeStorage(),
  sessionStorage: makeStorage(),
  document: documentStub,
  navigator: { userAgent: 'node-vm' },
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(obSrc, sandbox, { filename: 'js/onboarding.js' });

// _loopsSignupContext extracted verbatim from js/db.js (self-contained:
// reads storage + obState + OB_CITY_CONFIG; _readPendingUtm stubbed).
const ctxStart = dbSrc.indexOf('function _loopsSignupContext()');
const ctxEnd = dbSrc.indexOf('\n}\n', ctxStart) + 3;
check('setup: _loopsSignupContext extracted from db.js', ctxStart >= 0 && ctxEnd > ctxStart);
sandbox._readPendingUtm = () => ({});
vm.runInContext(dbSrc.slice(ctxStart, ctxEnd), sandbox, { filename: 'js/db.js#ctx' });
const run = (code) => vm.runInContext(code, sandbox);
const ctxNow = () => run('_loopsSignupContext()');

// ══ S1: hood pick must not survive a city change ═══════════════════════
run("obGoTo(1);");
run("obSelectCity('austin', null);");
await sleep(450);                       // auto-advance fires (screen 1 -> 2)
run("obGoTo(4);");
run("obSelectNeighborhood('East Austin', 21, { classList: { add() {}, remove() {} } });");
await sleep(450);                       // auto-advance fires (screen 4 -> 5)
let ctx1 = ctxNow();
check('S1 setup: Austin + East Austin recorded',
  ctx1.city_slug === 'austin' && ctx1.neighborhood === 'East Austin',
  JSON.stringify(ctx1));
run("obGoTo(1);");
run("obSelectCity('san-diego', null);");
await sleep(450);
const stash = JSON.parse(sandbox.sessionStorage.getItem('spotd-ob-picks') || '{}');
const ctx2 = ctxNow();
check('S1: city change clears obState.selectedNeighborhood',
  run('obState.selectedNeighborhood') === null,
  JSON.stringify(run('obState.selectedNeighborhood')));
check('S1: picks stash rewritten with no neighborhood after city change',
  !stash.neighborhood, JSON.stringify(stash));
check('S1: Loops context pairs the new city with NO stale neighborhood',
  ctx2.city_slug === 'san-diego' && ctx2.neighborhood === '',
  JSON.stringify(ctx2));

// ══ S2: auto-advance must fire at most once, and never after Back ══════
// (a) double-tap on the city screen advances exactly one screen
run("obGoTo(1);");
run("obSelectCity('austin', null); obSelectCity('chicago', null);");
await sleep(500);
check('S2a: two rapid city picks advance exactly one screen (1 -> 2)',
  run('obState.screen') === 2, 'screen=' + run('obState.screen'));
check('S2a: last pick still wins the city',
  run('obState.citySlug') === 'chicago', run('obState.citySlug'));
// (b) Back inside the advance window is not overridden by the stale timer
run("obGoTo(1);");
run("obSelectCity('miami', null); obBack();");
await sleep(500);
check('S2b: Back tap inside the 300ms window sticks (stays on entry)',
  run('obState.screen') === 0, 'screen=' + run('obState.screen'));
// (c) double-tap on the hood screen advances exactly one screen
run("obGoTo(4);");
run("obSelectNeighborhood('Downtown', 12, { classList: { add() {}, remove() {} } });"
  + " obSelectNeighborhood('Downtown', 12, { classList: { add() {}, remove() {} } });");
await sleep(500);
check('S2c: two rapid hood picks advance exactly one screen (4 -> 5)',
  run('obState.screen') === 5, 'screen=' + run('obState.screen'));
// (d) double-tap on the attribution screen advances exactly one screen
run("obGoTo(5);");
run("obSelectAttribution('tiktok', null); obSelectAttribution('tiktok', null);");
await sleep(600);
check('S2d: two rapid attribution picks advance exactly one screen (5 -> 6)',
  run('obState.screen') === 6, 'screen=' + run('obState.screen'));

// ══ S3: leaving a screen releases focus held inside it ═════════════════
const btn = { tagName: 'BUTTON', _blurred: false,
  blur() { this._blurred = true; if (documentStub.activeElement === this) documentStub.activeElement = null; } };
screens[3].children.add(btn);           // the vibe CTA lives on screen idx 3
documentStub.activeElement = btn;
run("obState.screen = 3; obGoTo(4);");
check('S3: focus is blurred when its screen is hidden with aria-hidden',
  btn._blurred === true && screens[3].getAttribute('aria-hidden') === 'true',
  `blurred=${btn._blurred} aria=${screens[3].getAttribute('aria-hidden')}`);
documentStub.activeElement = documentStub.body;
run("obGoTo(5);");
check('S3: body focus is left alone on later navigations',
  documentStub.activeElement === documentStub.body);

console.log(`\nonboarding-2026-11-05-sofia: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
