// App QA cleanup — regression tests for the fix sweep (node).
// Run: node tests/app-qa-cleanup.test.mjs
// Covers pure logic added in the 2026-10-05 QA fix sweep:
//   1. _isTimeBoundDeal / _splitDealsAndMenu (Fix #13: deals vs menu split)
//   2. _emptyGoingLine (Fix #12: zero-check-in variant rotation)
//   3. _tileSkeletonHTML / _rowSkeletonHTML (Fix #9: skeleton helpers)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'js/app.js'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}

// Extract top-level function/const declarations from app.js source and eval
// them in isolation. Each extracted snippet must be dependency-free (or carry
// its deps, included here explicitly).
function extract(name) {
  // matches "function NAME(" ... balanced braces, or "const NAME = [...]"
  const startMarkers = [`function ${name}(`, `const ${name} =`];
  let start = -1;
  for (const m of startMarkers) {
    const i = src.indexOf(m);
    if (i !== -1 && (start === -1 || i < start)) start = i;
  }
  if (start === -1) throw new Error(`not found: ${name}`);
  if (src[start] === 'c') {
    // const X = [...]; — find the terminating "];"
    const end = src.indexOf('];', start) + 2;
    return src.slice(start, end);
  }
  // function — balance braces from the first "{"
  let i = src.indexOf('{', start);
  let depth = 0;
  const begin = start;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
    // skip braces inside template literals / strings / regexes: crude but
    // sufficient for these small helpers (verified by the assertions below)
  }
  return src.slice(begin, i);
}

// _splitDealsAndMenu depends on _isTimeBoundDeal + _DEAL_SIGNALS; pull all three.
const helperSrc = [
  extract('_DEAL_SIGNALS'),
  extract('_isTimeBoundDeal'),
  extract('_splitDealsAndMenu'),
  extract('_emptyGoingLine'),
  extract('_tileSkeletonHTML'),
  extract('_rowSkeletonHTML'),
].join('\n');
const helpers = new Function(`${helperSrc}; return { _DEAL_SIGNALS, _isTimeBoundDeal, _splitDealsAndMenu, _emptyGoingLine, _tileSkeletonHTML, _rowSkeletonHTML };`)();
const { _isTimeBoundDeal, _splitDealsAndMenu, _emptyGoingLine, _tileSkeletonHTML, _rowSkeletonHTML } = helpers;

// ═══════════════════════════════════════════════════════════════
// 1. _isTimeBoundDeal
// ═══════════════════════════════════════════════════════════════
check('deal: price signal', _isTimeBoundDeal('$5 margaritas') === true);
check('deal: percent signal', _isTimeBoundDeal('20% off appetizers') === true);
check('deal: "off" signal', _isTimeBoundDeal('$2 off drafts') === true);
check('deal: half-price signal', _isTimeBoundDeal('Half-price wine') === true);
check('deal: BOGO signal', _isTimeBoundDeal('BOGO tacos') === true);
check('deal: day signal', _isTimeBoundDeal('Taco Tuesday specials') === true);
check('deal: time range signal', _isTimeBoundDeal('Happy hour 3-6pm') === true);
check('deal: happy hour signal', _isTimeBoundDeal('Happy hour deals') === true);
check('menu: plain dish name', _isTimeBoundDeal('Wood-fired pizzas') === false);
check('menu: plain dish name 2', _isTimeBoundDeal('Fish Tacos') === false);
check('menu: empty/null safe', _isTimeBoundDeal('') === false && _isTimeBoundDeal(null) === false);

// ═══════════════════════════════════════════════════════════════
// 2. _splitDealsAndMenu
// ═══════════════════════════════════════════════════════════════
let s = _splitDealsAndMenu(['$5 margaritas 3-6pm', 'Wood-fired pizzas', '20% off apps', 'Fish Tacos']);
check('split: timeBound', JSON.stringify(s.timeBound) === JSON.stringify(['$5 margaritas 3-6pm', '20% off apps']));
check('split: menu', JSON.stringify(s.menu) === JSON.stringify(['Wood-fired pizzas', 'Fish Tacos']));
s = _splitDealsAndMenu(['$5 beers']);
check('split: all deals → empty menu', s.timeBound.length === 1 && s.menu.length === 0);
s = _splitDealsAndMenu(['Truffle fries']);
check('split: all menu → empty timeBound', s.timeBound.length === 0 && s.menu.length === 1);
s = _splitDealsAndMenu([]);
check('split: empty in → empty out', s.timeBound.length === 0 && s.menu.length === 0);
s = _splitDealsAndMenu(null);
check('split: null safe', s.timeBound.length === 0 && s.menu.length === 0);

// ═══════════════════════════════════════════════════════════════
// 3. _emptyGoingLine — deterministic per venue, rotates variants
// ═══════════════════════════════════════════════════════════════
const a1 = _emptyGoingLine('venue-abc');
const a2 = _emptyGoingLine('venue-abc');
check('going line: deterministic', a1 === a2);
const seen = new Set(['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8'].map(_emptyGoingLine));
check('going line: rotates (>1 variant across venues)', seen.size > 1);
check('going line: non-empty string', typeof a1 === 'string' && a1.length > 0);
check('going line: empty id safe', typeof _emptyGoingLine('') === 'string');

// ═══════════════════════════════════════════════════════════════
// 4. Skeleton helpers return non-empty markup with skel blocks
// ═══════════════════════════════════════════════════════════════
const tiles = _tileSkeletonHTML(6);
check('tile skeleton: 6 skel blocks', (tiles.match(/class="skel"/g) || []).length === 6);
check('tile skeleton: grid wrapper', tiles.includes('pf-tagged-grid'));
const rows = _rowSkeletonHTML(4);
check('row skeleton: 4 avatar blocks', (rows.match(/skel--avatar/g) || []).length === 4);

console.log(`\napp-qa-cleanup: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
