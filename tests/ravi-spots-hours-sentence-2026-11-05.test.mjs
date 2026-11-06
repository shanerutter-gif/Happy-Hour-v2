// SSR hours-sentence guard (node).
// Run: node tests/ravi-spots-hours-sentence-2026-11-05.test.mjs
// Guards qa-2026-11-04-ssr-faq-days: api/spots.js glued the venue's
// happy-hour days[] onto its GENERAL operating-hours sentence in two
// places — the FAQ answer (visible + FAQPage JSON-LD that Google indexes
// verbatim) and the Details → Hours fallback row. A venue open 7 days
// with Mon–Fri happy hour rendered as "…open [Sat/Sun hours] on Monday,
// Tuesday, Wednesday, Thursday, Friday", i.e. closed weekends.
// Schema convention (repo CLAUDE.md / product bible §2.5): `hours` is
// general operating hours; happy-hour days live in `days[]` and surface
// in the deals list — the two fields must never share a sentence.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const spotsApi = readFileSync(join(ROOT, 'api/spots.js'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}

// The FAQ hours answer is built from venue.hours alone.
check('FAQ hours answer exists', spotsApi.includes("is open ${venue.hours}."));
check('FAQ hours answer carries no days[] suffix',
  !/is open \$\{venue\.hours\}\$\{venue\.days/.test(spotsApi));
// The Details fallback row renders the raw hours string alone.
check('Details fallback carries no days[] suffix',
  !/schedHoursHTML \|\| `\$\{hours\}\$\{venue\.days/.test(spotsApi));
// formatDays had exactly those two call sites; with both gone the helper
// itself must be gone too (no dead code left behind).
check('formatDays helper removed (was only used by the two buggy sites)',
  !spotsApi.includes('formatDays'));
// The grouped-schedule path is untouched: it still receives the
// normalized happy-hour days for its open-status gate.
check('grouped schedule still parses with normalized days',
  spotsApi.includes('parseVenueHours(venue.hours, schedDaysNorm)'));

console.log(`${passed} passed, ${failed} failed`);
if (failures.length) { console.log(failures.map(f => 'FAIL: ' + f).join('\n')); process.exit(1); }
