// Check-in #315-page integrity tests (node, source assertions).
// Run from repo root: node tests/sofia-checkin-2026-11-12.test.mjs
// Guards Sofia 2026-11-12 check-in audit (HEAD f0881ea, post-#315 page):
//  (1) Cancel-during-submit: submitCheckin disabled only the Post button;
//      the ✕ / Skip exits (bail) stayed live and only cleared globals —
//      submit had already captured file/caption/tags locally, so the post
//      published anyway after the user closed the page. bail() must refuse
//      while window._ckSubmitting is set, submitCheckin must set/clear it
//      and refuse re-entry.
//  (2) Prompt singleton: openPhotoCheckinPrompt appended a new overlay per
//      open with no existing-prompt cleanup — two check-ins inside the
//      600ms prompt delay stacked prompts with duplicate ids, and submit
//      read the first prompt's caption against the second venue's global
//      id. Open must remove any live .ck-overlay (and revoke its preview
//      URL) before building a new one.
//  (3) Friends-load capture: _loadTagFriendsInline re-queried
//      #tagFriendsGridInline AFTER awaiting getFollowing, painting a dead
//      prompt's result into the live prompt. It must capture the grid
//      synchronously and paint only while that element isConnected.
//  (4) Touch targets: .ck-post / header ✕ / .ck-preview-btn shipped at
//      36/36/32px in the #315 CSS block; all must be >= 44px.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = readFileSync(join(ROOT, 'js/app.js'), 'utf8');
const cssSrc = readFileSync(join(ROOT, 'css/style.css'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}
function extract(src, name) {
  const i = src.indexOf(`function ${name}`);
  if (i < 0) return '';
  return src.slice(i, i + 9000);
}

// (1) cancel-during-submit guard
const submit = extract(appSrc, 'submitCheckin');
check('submitCheckin found', !!submit);
check('submitCheckin refuses re-entry while submitting', /if \(window\._ckSubmitting\) return;/.test(submit));
check('submitCheckin sets _ckSubmitting before the upload', /window\._ckSubmitting = true;/.test(submit));
check('submitCheckin clears _ckSubmitting on success and on failure',
  (submit.match(/window\._ckSubmitting = false;/g) || []).length >= 2);
const open = extract(appSrc, 'openPhotoCheckinPrompt');
check('openPhotoCheckinPrompt found', !!open);
check('bail() refuses to cancel during a submit', /const bail = \(\) => \{ if \(window\._ckSubmitting\)/.test(open));
check('open resets _ckSubmitting for the new prompt', /window\._ckSubmitting = false;/.test(open));

// (2) prompt singleton
check('open removes any live .ck-overlay before building a new prompt',
  open.indexOf("querySelectorAll('.ck-overlay')") >= 0 &&
  open.indexOf("querySelectorAll('.ck-overlay')") < open.indexOf("document.createElement('div')"));
check('open revokes a leftover preview URL before building', open.includes('_ckRevokePreview();'));

// (3) friends-load capture
const load = extract(appSrc, '_loadTagFriendsInline');
check('_loadTagFriendsInline found', !!load);
check('friends load captures the grid before any await',
  load.indexOf("getElementById('tagFriendsGridInline')") >= 0 &&
  load.indexOf("getElementById('tagFriendsGridInline')") < load.indexOf('await getFollowing'));
check('friends load does not re-query the grid after the await',
  load.indexOf("getElementById('tagFriendsGridInline')", load.indexOf('await getFollowing')) === -1);
check('friends load paints only while the captured grid isConnected', /gridEl\.isConnected/.test(load));

// (4) touch targets in the #315 CSS block
const ckBlock = cssSrc.slice(cssSrc.indexOf('POST-CHECK-IN PAGE v2'));
check('#315 CSS block found', ckBlock.length > 100);
check('.ck-post is 44px tall', /\.ck-post \{[^}]*height: 44px/.test(ckBlock));
check('header ✕ scoped to 44px on the check-in page', /\.ck-head \.cp-iconbtn \{ width: 44px; height: 44px; \}/.test(ckBlock));
check('.ck-preview-btn is 44px tall', /\.ck-preview-btn \{[^}]*height: 44px/.test(ckBlock));
check('.ck-preview-btn--x is 44px wide', /\.ck-preview-btn--x \{ width: 44px/.test(ckBlock));
check('.ck-head grid leads with a 44px column', /\.ck-head \{ grid-template-columns: 44px 1fr auto; \}/.test(ckBlock));

console.log(`sofia-checkin-2026-11-12: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log(failures.map(f => '  FAIL: ' + f).join('\n')); process.exit(1); }
