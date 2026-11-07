// Guards the post-signup welcome tour wiring (js/welcome-tour.js).
// Run: node tests/welcome-tour.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
let passed = 0, failed = 0; const failures = [];
const check = (n, c) => { if (c) passed++; else { failed++; failures.push(n); } };

const wt = read('js/welcome-tour.js'), db = read('js/db.js'), app = read('js/app.js'), consent = read('js/consent.js'), idx = read('index.html'), css = read('css/style.css');

check('index.html loads welcome-tour.js after tooltips.js', /tooltips\.js\?v=[^"]+"><\/script>\s*<script defer src="js\/welcome-tour\.js/.test(idx));
check('db.js flags email signups before the session starts', /_markWelcomePending\(\);\s*const res = await authSignIn/.test(db));
check('db.js flags new OAuth signups', db.includes('if (_isNew) _markWelcomePending();'));
check('enterCity starts the tour instead of tooltips for new signups', app.includes("if (window.__spotdWelcomeActive && typeof wtMaybeStart === 'function') wtMaybeStart();"));
check('onAuthChange starts the tour when already inside a city', app.includes("} else if (user && typeof wtMaybeStart === 'function') {"));
check('push prompt held during the tour', app.includes('!window.__spotdWelcomeActive && !localStorage.getItem(\'spotd-push-prompted\')'));
check('referral prompt queues behind the tour', /maybeShowPostSignupReferralModal\(\) \{\s*if \(!currentUser\) return;\s*\/\/ Wait for the post-signup welcome tour/.test(app));
check('consent interstitial queues behind the tour', consent.includes('window.spotdAfterWelcome(window.spotdShowPostSignupConsent)'));
check('tour replaces the tooltip walkthrough', wt.includes("localStorage.setItem('spotd-tooltips-done', '1')"));
check('tour shows once', wt.includes('WT_DONE_KEY') && wt.includes("localStorage.removeItem(WT_PENDING_KEY)"));
check('profile photo saved via uploadProfilePhoto', wt.includes("uploadProfilePhoto(file, currentUser.id, 'avatar')"));
check('bio saved via updateProfile', wt.includes('updateProfile(currentUser.id, { bio })'));
check('illustrative previews are labelled', (wt.match(/wt-example/g) || []).length >= 2);
check('tour sits above the app-download banner (z 9999)', /\.wt\{position:fixed;inset:0;z-index:(\d+)/.test(css) && +css.match(/\.wt\{position:fixed;inset:0;z-index:(\d+)/)[1] > 9999);
check('no backdrop-filter in tour CSS', !/\.wt[^{]*\{[^}]*backdrop-filter/.test(css));

console.log(`welcome-tour: ${passed} passed, ${failed} failed`);
if (failed) { console.error(failures.map(f => '  ✗ ' + f).join('\n')); process.exit(1); }
