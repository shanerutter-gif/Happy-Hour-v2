// Creator Program foundation — test harness (node).
// Run: node tests/creator-program.test.mjs
// Covers pure logic exported from api/creators.js:
//   1. orderCreatorsForAutoFollow (founding first, city match, rest, 50->20 cap, dedupe)
//   2. buildAutoFollowRows (dedupe, self-exclusion, source tag)
//   3. meetsCreatorEligibility (spec §3 bar: all six must hold)
//   4. resolveCreatorRefHandle (/r/[handle] matching)
//   5. creatorReferralPath

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}

const {
  orderCreatorsForAutoFollow,
  buildAutoFollowRows,
  meetsCreatorEligibility,
  resolveCreatorRefHandle,
  creatorReferralPath,
  CREATOR_FOLLOWER_FLOOR,
  CREATOR_MIN_POSTS_30D,
} = await import('../api/creators.js');

// ── fixtures ─────────────────────────────────────────────────────────────
const mk = (over) => ({
  id: over.id,
  display_name: over.id,
  username: over.id,
  creator_tier: 'verified',
  creator_since: '2026-09-01T00:00:00Z',
  city_slug: 'san-diego',
  is_creator: true,
  ...over,
});
const ids = (arr) => arr.map(c => c.id || c.following_id);

// ═══════════════════════════════════════════════════════════════
// 1. orderCreatorsForAutoFollow
// ═══════════════════════════════════════════════════════════════
// A1: founding first, then city match, then rest
let r = orderCreatorsForAutoFollow([
  mk({ id: 'v-la', city_slug: 'los-angeles' }),
  mk({ id: 'f-sd', creator_tier: 'founding' }),
  mk({ id: 'v-sd', city_slug: 'san-diego' }),
], 'san-diego');
check('A1: founding → city → rest', ids(r).join() === 'f-sd,v-sd,v-la');

// A2: founding ordered by seniority among themselves
r = orderCreatorsForAutoFollow([
  mk({ id: 'f2', creator_tier: 'founding', creator_since: '2026-09-10T00:00:00Z' }),
  mk({ id: 'f1', creator_tier: 'founding', creator_since: '2026-09-01T00:00:00Z' }),
], null);
check('A2: founding by seniority', ids(r).join() === 'f1,f2');

// A3: no city given → founding then rest
r = orderCreatorsForAutoFollow([mk({ id: 'v1' }), mk({ id: 'f1', creator_tier: 'founding' })], null);
check('A3: no city → founding first', ids(r).join() === 'f1,v1');

// A4: dedupe by id
r = orderCreatorsForAutoFollow([mk({ id: 'v1' }), mk({ id: 'v1' })], null);
check('A4: dedupe', r.length === 1);

// A5: null/undefined entries skipped
r = orderCreatorsForAutoFollow([null, undefined, mk({ id: 'v1' })], null);
check('A5: nulls skipped', ids(r).join() === 'v1');

// A6: scaling guard — 60 creators → top 20, founding first
const many = [];
for (let i = 0; i < 5; i++) many.push(mk({ id: `f${i}`, creator_tier: 'founding' }));
for (let i = 0; i < 55; i++) many.push(mk({ id: `v${i}` }));
r = orderCreatorsForAutoFollow(many, 'san-diego');
check('A6: 60 creators → capped at 20', r.length === 20);
check('A6: founding all in top 20', r.slice(0, 5).every(c => c.creator_tier === 'founding'));

// A7: 50 creators → no cap (boundary)
const fifty = [];
for (let i = 0; i < 50; i++) fifty.push(mk({ id: `v${i}` }));
r = orderCreatorsForAutoFollow(fifty, null);
check('A7: exactly 50 → no cap', r.length === 50);

// A8: empty input
check('A8: empty → empty', orderCreatorsForAutoFollow([], null).length === 0);

// ═══════════════════════════════════════════════════════════════
// 2. buildAutoFollowRows
// ═══════════════════════════════════════════════════════════════
// B1: rows carry source tag
let rows = buildAutoFollowRows('newbie', [mk({ id: 'c1' }), mk({ id: 'c2' })]);
check('B1: source=creator_auto_follow',
  rows.length === 2 && rows.every(x => x.source === 'creator_auto_follow' && x.follower_id === 'newbie'));

// B2: dedupe + self-exclusion
rows = buildAutoFollowRows('newbie', [mk({ id: 'c1' }), mk({ id: 'c1' }), mk({ id: 'newbie' })]);
check('B2: dedupe + no self-follow', ids(rows).join() === 'c1');

// B3: no user → no rows
check('B3: null user → []', buildAutoFollowRows(null, [mk({ id: 'c1' })]).length === 0);

// ═══════════════════════════════════════════════════════════════
// 3. meetsCreatorEligibility (spec §3)
// ═══════════════════════════════════════════════════════════════
const good = {
  hasNightlifeContent: true, postsLast30d: 8, followerCount: 5000,
  cityRelevant: true, igAccountTypeOk: true, standingOk: true,
};
check('C1: pilot constants', CREATOR_FOLLOWER_FLOOR === 1000 && CREATOR_MIN_POSTS_30D === 4);
check('C2: all six hold → eligible', meetsCreatorEligibility(good) === true);

// Each failing condition → ineligible
const dims = [
  ['hasNightlifeContent', { ...good, hasNightlifeContent: false }],
  ['postsLast30d', { ...good, postsLast30d: 3 }],
  ['followerCount', { ...good, followerCount: 999 }],
  ['cityRelevant', { ...good, cityRelevant: false }],
  ['igAccountTypeOk', { ...good, igAccountTypeOk: false }],
  ['standingOk', { ...good, standingOk: false }],
];
for (const [dim, input] of dims) {
  check(`C3: ${dim} fails → ineligible`, meetsCreatorEligibility(input) === false);
}
// Boundaries: exactly at floor → eligible
check('C4: exactly 1000 followers + 4 posts → eligible',
  meetsCreatorEligibility({ ...good, followerCount: 1000, postsLast30d: 4 }) === true);
check('C5: empty input → ineligible', meetsCreatorEligibility({}) === false);

// ═══════════════════════════════════════════════════════════════
// 4. resolveCreatorRefHandle + creatorReferralPath
// ═══════════════════════════════════════════════════════════════
const creators = [
  mk({ id: 'c1', username: 'NightlifeNina', is_creator: true }),
  mk({ id: 'c2', username: 'plainuser', is_creator: false }),
];
// D1: case-insensitive
check('D1: case-insensitive match',
  resolveCreatorRefHandle('nightlifenina', creators)?.id === 'c1');
// D2: leading @ tolerated
check('D2: @ prefix tolerated',
  resolveCreatorRefHandle('@NightlifeNina', creators)?.id === 'c1');
// D3: non-creator excluded
check('D3: non-creator username → null',
  resolveCreatorRefHandle('plainuser', creators) === null);
// D4: unknown handle → null
check('D4: unknown → null', resolveCreatorRefHandle('nope', creators) === null);
// D5: empty → null
check('D5: empty → null', resolveCreatorRefHandle('', creators) === null);
// D6: referral path builder
check('D6: /r/[handle] path',
  creatorReferralPath('@NightlifeNina') === '/r/NightlifeNina');

// ═══════════════════════════════════════════════════════════════
// 5. Migration file sanity
// ═══════════════════════════════════════════════════════════════
const mig = readFileSync(join(ROOT, 'sql', 'creator-program-foundation-20261005.sql'), 'utf8');
for (const needle of [
  'is_creator', 'creator_tier', 'creator_since',
  'creator_connections', 'feed_items',
  'user_follows', "source text",
  'auto_follow_creators', 'creator_auto_follow',
  'unique (platform, platform_media_id)',
  'unique (follower_id, following_id)',
]) {
  check(`MIG: contains "${needle}"`, mig.includes(needle));
}

// ═══════════════════════════════════════════════════════════════
// 6. validateCreatorAction (api/admin-creators.js)
// ═══════════════════════════════════════════════════════════════
const { validateCreatorAction, CREATOR_TIERS } = await import('../api/admin-creators.js');

check('V0: tiers exported', Array.isArray(CREATOR_TIERS) && CREATOR_TIERS.join() === 'founding,verified');

// V1: valid set/founding → patch with all three flags
let v = validateCreatorAction({ action: 'set', user_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', tier: 'founding' });
check('V1: set founding → ok + patch',
  v.ok === true && v.tier === 'founding' &&
  v.patch.is_creator === true && v.patch.creator_tier === 'founding' &&
  typeof v.patch.creator_since === 'string' && !Number.isNaN(Date.parse(v.patch.creator_since)));

// V2: valid set/verified
v = validateCreatorAction({ action: 'set', user_id: 'abc12345', tier: 'verified' });
check('V2: set verified → ok', v.ok === true && v.patch.creator_tier === 'verified');

// V3: valid clear → nulls everything out
v = validateCreatorAction({ action: 'clear', user_id: 'abc12345' });
check('V3: clear → ok + nulls',
  v.ok === true && v.patch.is_creator === false &&
  v.patch.creator_tier === null && v.patch.creator_since === null);

// V4: bad tier rejected
v = validateCreatorAction({ action: 'set', user_id: 'abc12345', tier: 'gold' });
check('V4: bad tier rejected', v.ok === false && /tier/.test(v.error));

// V5: missing tier rejected
v = validateCreatorAction({ action: 'set', user_id: 'abc12345' });
check('V5: missing tier rejected', v.ok === false);

// V6: bad action rejected
v = validateCreatorAction({ action: 'delete', user_id: 'abc12345' });
check('V6: bad action rejected', v.ok === false);

// V7: missing user_id rejected
v = validateCreatorAction({ action: 'clear' });
check('V7: missing user_id rejected', v.ok === false);

// V8: malformed user_id rejected (injection guard)
v = validateCreatorAction({ action: 'clear', user_id: "1'; DROP TABLE profiles;--" });
check('V8: injection-y user_id rejected', v.ok === false);

// V9: empty body rejected
v = validateCreatorAction();
check('V9: empty body rejected', v.ok === false);

// ── report ───────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
