// Analytics consent-gate regression tests (node).
// Run: node tests/analytics-consent.test.mjs
// Guards the Oct 2026 incident's root cause: _aeFlush held EVERY batch while
// the marketing-consent state was 'pending', including batches for signed-in
// users. The banner defers during onboarding/auth and snoozes 7 days on
// dismissal, so almost no new signup ever got identified — the admin Users
// page showed zero per-user activity from Oct 9 2026. Fix: the pending hold
// applies only to anonymous batches; signed-in batches (Authorization header
// attached) are first-party account telemetry, like last_seen. An explicit
// 'denied' still drops everything.

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

function fnBody(name, src) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) return '';
  let i = src.indexOf('{', start);
  let depth = 0;
  const begin = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(begin, i + 1); }
  }
  return '';
}

const flush = fnBody('_aeFlush', db);
check('_aeFlush exists', flush.length > 0);
check("explicit 'denied' still drops all batches", flush.includes("_cs === 'denied'") && flush.includes('_aeBuffer = []'));
check("pending hold is anonymous-only (signed-in batches send)",
  /_cs === 'pending' && !_accessToken/.test(flush));
check('flush attaches the Authorization header when a token exists',
  flush.includes("headers['Authorization'] = 'Bearer ' + _accessToken"));

const cid = fnBody('analyticsIdentify', db);
check('analyticsIdentify exists', cid.length > 0);
check('identify fires captureEvent + prompt flush', cid.includes("captureEvent('identify'") && cid.includes('_aeFlush()'));

console.log(`analytics-consent: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exitCode = 1;
}
