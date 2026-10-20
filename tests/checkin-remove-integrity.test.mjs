// Check-in removal integrity tests (node).
// Run: node tests/checkin-remove-integrity.test.mjs
// Guards Sofia 2026-10-20 finding: removeCheckIn (js/db.js) awaited the
// check_ins DELETE without reading the PostgREST `error` field, so it
// returned true on rejected deletes and the existence-checked rollback in
// doGoingTonight (app.js, shipped 2026-10-08 in 1de9ea1) could never fire.
// addCheckIn has always checked `error`; the remove path must too.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbSrc = readFileSync(join(ROOT, 'js/db.js'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}

// Extract removeCheckIn's source and run it against a stubbed Supabase client.
const m = dbSrc.match(/async function removeCheckIn[\s\S]*?\n\}\n/);
check('removeCheckIn found in js/db.js', !!m);
const fnSrc = m ? m[0] : '';

check('removeCheckIn reads the delete result error',
  /\{\s*error\s*\}\s*=\s*await db\.from\('check_ins'\)\.delete\(\)/.test(fnSrc) && /if \(error\) throw/.test(fnSrc));

function makeCtx(deleteResult) {
  const chain = {
    eq() { return chain; }, gte() { return chain; }, lte() { return chain; },
    delete() { return chain; },
    then(res) { res(deleteResult); },
  };
  const sandbox = {
    console,
    track: () => {},
    db: { from: () => chain },
  };
  vm.createContext(sandbox);
  vm.runInContext(fnSrc, sandbox);
  return sandbox;
}

{
  const s = makeCtx({ data: null, error: { message: 'RLS denied' } });
  const ok = await s.removeCheckIn('u1', 'v1', '2026-10-20');
  check('rejected DELETE returns false', ok === false, `got ${ok}`);
}
{
  const s = makeCtx({ data: null, error: null });
  const ok = await s.removeCheckIn('u1', 'v1', '2026-10-20');
  check('successful DELETE returns true', ok === true, `got ${ok}`);
}

console.log(`checkin-remove-integrity: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log(failures.join('\n')); process.exit(1); }
