// Profile follow integrity tests (node).
// Run: node tests/profile-follow-integrity.test.mjs
// Guards Sofia 2026-10-22 finding: unfollowUser / unfollowVenue (js/db.js)
// awaited their DELETE without reading the PostgREST `error` field and
// returned true unconditionally — the exact removeCheckIn bug fixed
// 2026-10-20, one table over — while toggleFollowUser /
// toggleFollowFromSearch / toggleVenueFollow (js/app.js) flipped the UI,
// local following set, and success toast without checking any result.
// A rejected unfollow therefore showed "Unfollowed" while the row (and
// the follow relationship the social feed ranks by) persisted.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbSrc = readFileSync(join(ROOT, 'js/db.js'), 'utf8');
const appSrc = readFileSync(join(ROOT, 'js/app.js'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}

function extract(src, name) {
  const m = src.match(new RegExp(`async function ${name}[\\s\\S]*?\\n\\}\\n`));
  return m ? m[0] : '';
}

function makeCtx(fnSrc, deleteResult) {
  const chain = {
    eq() { return chain; },
    delete() { return chain; }, insert() { return chain; }, select() { return chain; },
    then(res) { res(deleteResult); },
  };
  const sandbox = { console, track: () => {}, db: { from: () => chain } };
  vm.createContext(sandbox);
  vm.runInContext(fnSrc, sandbox);
  return sandbox;
}

for (const [fn, table] of [['unfollowUser', 'user_follows'], ['unfollowVenue', 'venue_follows']]) {
  const fnSrc = extract(dbSrc, fn);
  check(`${fn} found in js/db.js`, !!fnSrc);
  check(`${fn} reads the delete result error`,
    new RegExp(`\\{\\s*error\\s*\\}\\s*=\\s*await db\\.from\\('${table}'\\)\\.delete\\(\\)`).test(fnSrc) && /if \(error\) throw/.test(fnSrc));
  const bad = makeCtx(fnSrc, { data: null, error: { message: 'RLS denied' } });
  check(`${fn}: rejected DELETE returns false`, (await bad[fn]('u1', 'x1')) === false);
  const good = makeCtx(fnSrc, { data: null, error: null });
  check(`${fn}: successful DELETE returns true`, (await good[fn]('u1', 'x1')) === true);
}

for (const fn of ['toggleFollowUser', 'toggleFollowFromSearch', 'toggleVenueFollow']) {
  const fnSrc = extract(appSrc, fn);
  check(`${fn} found in js/app.js`, !!fnSrc);
  check(`${fn} captures the follow/unfollow result and bails on failure`,
    /const ok = await (un)?follow(User|Venue)\(/.test(fnSrc) && /if \(!ok\)/.test(fnSrc));
}

console.log(`profile-follow-integrity: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log(failures.join('\n')); process.exit(1); }
