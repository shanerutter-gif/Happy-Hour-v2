// Tour / guides / map-cluster regression tests (node).
// Run: node tests/tour-guides-map.test.mjs
// Covers the 2026-10-05 founder-requested adjustments:
//   1. Map cluster tap reverted to decluster-on-tap (no bottom sheet)
//   2. Guides entry point in the Share header
//   3. First-use tour copy refresh (no "news", guides step added)
//
// Static source assertions (the repo's DOM is rendered client-side, so these
// verify the wiring exists in source rather than a live DOM).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(ROOT, p), 'utf-8');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}

const tooltips = src('js/tooltips.js');
const app = src('js/app.js');
const indexHtml = src('index.html');
const css = src('css/style.css');

// ═══════════════════════════════════════════════════════════════
// 1. Map cluster tap = decluster-on-tap, no bottom sheet
// ═══════════════════════════════════════════════════════════════
// Venue marker cluster group (the first markerClusterGroup in updateMapMarkers)
// must zoom into bounds on tap.
const venueClusterBlock = app.slice(
  app.indexOf('state._markerLayer = L.markerClusterGroup({'),
  app.indexOf('state._markerLayer = L.markerClusterGroup({') + 600);
check('map: venue cluster group zooms to bounds on tap',
  venueClusterBlock.includes('zoomToBoundsOnClick: true'));
check('map: no clusterclick bottom-sheet handler on venue layer',
  !app.includes("on('clusterclick'"));
check('map: openClusterSheet fully removed',
  !app.includes('openClusterSheet') && !app.includes('clusterSheet'));
// Check-in overlay layer keeps its own clustering behavior (untouched).
check('map: check-in layer still clusters',
  app.includes('state._checkinMarkerLayer = L.markerClusterGroup({'));
// Pin label fixes from the earlier sweep are intact.
check('map: pin labels escaped',
  app.includes('const label = esc(v.name);'));
check('map: pin label CSS ellipsis present',
  css.includes('.map-pin-label'));

// ═══════════════════════════════════════════════════════════════
// 2. Guides entry point in the Share header
// ═══════════════════════════════════════════════════════════════
check('share: guides button in share header',
  indexHtml.includes('class="social-guides-btn"'));
check('share: guides button opens the guides panel',
  indexHtml.includes('class="social-guides-btn" onclick="openNewsTab()"'));
check('share: guides button labeled',
  /social-guides-btn[^>]*>.*Guides/s.test(indexHtml));
check('share: guides button styled',
  css.includes('.social-guides-btn'));
check('share: openNewsTab still opens the guides/blog panel',
  app.includes("function openNewsTab()") &&
  app.includes("getElementById('newsTab').classList.add('tab-open')"));
check('share: discover rail untouched',
  app.includes('function _guidesRailHTML()'));

// ═══════════════════════════════════════════════════════════════
// 3. First-use tour refresh
// ═══════════════════════════════════════════════════════════════
// Extract the TT_STEPS block and parse step targets/texts.
const stepsSrc = tooltips.slice(tooltips.indexOf('const TT_STEPS = ['), tooltips.indexOf('];') + 2);
const targets = [...stepsSrc.matchAll(/target:\s*'([^']+)'/g)].map(m => m[1]);
check('tour: 6 steps (guides step added)', targets.length === 6, `found ${targets.length}`);
check('tour: guides step targets the rail', targets.includes('.guides-rail'));
check('tour: guides step sits between cards and final nav step',
  targets.indexOf('.guides-rail') === targets.length - 2);
check('tour: final step has no "news" mention',
  !/news/i.test(stepsSrc.slice(stepsSrc.lastIndexOf("target: '#bottomNav'"))));
check('tour: final step mentions feed + profile',
  /feed/i.test(stepsSrc.slice(stepsSrc.lastIndexOf("target: '#bottomNav'"))) &&
  /profile/i.test(stepsSrc.slice(stepsSrc.lastIndexOf("target: '#bottomNav'"))));
check('tour: localStorage key unchanged (no re-tour)',
  tooltips.includes("const TT_KEY = 'spotd-tooltips-done'"));
// Every step target must exist in the current DOM sources.
check('tour: #searchBox exists', indexHtml.includes('id="searchBox"'));
check('tour: #filterToggle exists', indexHtml.includes('id="filterToggle"'));
check('tour: #viewToggle exists', indexHtml.includes('id="viewToggle"'));
check('tour: card classes exist', app.includes('card-hero') && app.includes('card-compact') && app.includes('card-std'));
check('tour: #bottomNav is created', app.includes("bar.id = 'bottomNav'"));
check('tour: .guides-rail is rendered', app.includes('guides-rail')); 

console.log(`\ntour-guides-map: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
