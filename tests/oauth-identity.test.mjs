// OAuth identity regression tests (node).
// Run: node tests/oauth-identity.test.mjs
// Guards the Oct 2026 incident: OAuth (Google/Apple) signups stopped being
// identified — no identify events, no last_seen, no per-user activity in the
// admin Users page from Oct 9 onward — because the OAuth return handler only
// understood the implicit (hash-token) return while the auth library's return
// shape moved to PKCE (?code=). The handler now accepts both shapes, initAuth
// adopts library-held sessions, and the library is pinned to an exact version.
// These checks fail if any of that regresses.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = readFileSync(join(ROOT, 'js/db.js'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}

// Slice out one top-level function body (balanced braces) for scoped checks.
function fnBody(name) {
  const start = db.indexOf(`function ${name}(`);
  if (start === -1) return '';
  let i = db.indexOf('{', start);
  let depth = 0;
  const begin = i;
  for (; i < db.length; i++) {
    if (db[i] === '{') depth++;
    else if (db[i] === '}') { depth--; if (depth === 0) return db.slice(begin, i + 1); }
  }
  return '';
}

const cb = fnBody('handleOAuthCallback');
check('handleOAuthCallback exists', cb.length > 0);
check('callback handles implicit hash tokens', cb.includes("hash.includes('access_token')") || cb.includes('hashParams'));
check('callback handles PKCE code returns', cb.includes("get('code')") && cb.includes('exchangeCodeForSession'));
check('callback adopts library-exchanged session', cb.includes('db.auth.getSession()'));
check('callback persists the app session copy', cb.includes('localStorage.setItem(_storageKey'));
check('callback records last_seen (forced)', cb.includes('_updateLastSeen(true)'));
check('callback fires analyticsIdentify', cb.includes('analyticsIdentify()'));
check('callback still fires signup_completed/oauth_login', cb.includes('signup_completed'));

const si = fnBody('authSignIn');
check('authSignIn (email sign-in + signup funnel) exists', si.length > 0);
check('authSignIn records last_seen (forced) at session start', si.includes('_updateLastSeen(true)'));
check('authSignIn fires analyticsIdentify', si.includes('analyticsIdentify()'));

const ia = fnBody('initAuth');
check('initAuth exists', ia.length > 0);
check('initAuth adopts a library-held session when the app copy is missing',
  ia.includes('db.auth.getSession()') && ia.includes('localStorage.setItem(_storageKey'));
check('initAuth records last_seen (forced)', ia.includes('_updateLastSeen(true)'));
check('initAuth fires analyticsIdentify', ia.includes('analyticsIdentify()'));

// The auth library must stay pinned to an exact version in every page that
// loads it — a floating tag is what let the return shape change silently.
const pages = ['index.html', 'admin/board.html', 'creator-dashboard.html', 'business-landing.html'];
for (const page of pages) {
  const html = readFileSync(join(ROOT, page), 'utf8');
  check(`${page} pins supabase-js to an exact version`, /@supabase\/supabase-js@\d+\.\d+\.\d+/.test(html));
  check(`${page} has no floating supabase-js tag`, !/@supabase\/supabase-js@\d+["/]/.test(html.replace(/@supabase\/supabase-js@\d+\.\d+\.\d+/g, '')));
}

console.log(`oauth-identity: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exitCode = 1;
}
