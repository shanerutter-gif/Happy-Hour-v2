// Guards the 2026-11-06 analytics + SEO/AIO audit fixes.
// Run: node tests/analytics-seo-audit-2026-11-06.test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hasHappyHourSignal } from '../api/_lib/seo.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond) { if (cond) passed++; else { failed++; failures.push(name); } }

// 1. Happy-hour signal: real deals yes, menu notes / covers no.
check('HH: explicit happy hour', hasHappyHourSignal({ deals: ['Happy hour Mon-Fri 3pm-6pm'] }));
check('HH: price deal', hasHappyHourSignal({ deals: ['$5 wells', '$4 beer'] }));
check('HH: half-price', hasHappyHourSignal({ deals: ['Half-price beverages Mon-Fri from 4pm'] }));
check('HH: flag wins', hasHappyHourSignal({ has_happy_hour: true, deals: ['Cash only'] }));
check('no HH: menu notes', !hasHappyHourSignal({ deals: ['Hand-pressed tortillas', 'Hefty burritos and street tacos'] }));
check('no HH: omakase', !hasHappyHourSignal({ deals: ['What to order: the full chef-led omakase, $250'] }));
check('no HH: cover charge', !hasHappyHourSignal({ deals: ['General cover runs around $20'] }));
check('no HH: bare time range', !hasHappyHourSignal({ deals: ['Saturday drag brunch 1pm-4pm'] }));
check('no HH: empty', !hasHappyHourSignal({ deals: [] }));

// 2. Venue page: happy-hour claims gated, no third-party AggregateRating.
const spots = read('api/spots.js');
check('spots: isHH computed', /const isHH = hasHappyHourSignal\(venue\)/.test(spots));
check('spots: FAQ "Does X have happy hour" gated', /if \(isHH && deals\.length\) \{\s*venueFaqs\.push\(\{\s*q: `Does/.test(spots));
check('spots: offer catalog gated', spots.includes('...(isHH && deals.length && {'));
check('spots: no Google-rating AggregateRating', !/googleRating\.toFixed\(1\),\s*bestRating/.test(spots));

// 3. Hubs + sitemap use the same filter.
check('happy-hour.js filters', read('api/happy-hour.js').includes('venues = venues.filter(hasHappyHourSignal)'));
check('sitemap-cities filters', read('api/sitemap-cities.js').includes('if (!hasHappyHourSignal(v)) continue;'));

// 4. GA never loads unconditionally anywhere.
const pages = [
  ...readdirSync(ROOT).filter(f => f.endsWith('.html')),
  ...readdirSync(join(ROOT, 'blog')).filter(f => f.endsWith('.html')).map(f => 'blog/' + f),
  'api/spots.js', 'api/happy-hour.js', 'api/spots-directory.js', 'api/blog-post.js',
];
for (const p of pages) {
  const s = read(p);
  check(`${p}: no ungated gtag.js tag`, !s.includes('<script async src="https://www.googletagmanager.com/gtag/js'));
}
check('admin.html: no GA', !read('admin.html').includes('googletagmanager'));
check('blog.html: in-house tracker', read('blog.html').includes('/js/site-analytics.js'));

// 5. Internal-traffic exclusion.
check('consent.js: ?internal switch', read('js/consent.js').includes("localStorage.setItem('spotd_internal', '1')"));
check('db.js: internal skip', read('js/db.js').includes('if (window.__spotdInternal)'));
check('site-analytics: internal skip', read('js/site-analytics.js').includes('__spotdInternal'));
check('track-event: plus-alias exclusion', read('api/track-event.js').includes('function isInternalEmail'));

// 6. Native app gets the consent banner (no isNative early return).
check('consent.js: banner not suppressed in native', !read('js/consent.js').includes('if (isNative) return;'));

// 7. Signed-in pre-consent batches never create the persistent visitor id.
check('db.js: visitor id only created after consent', read('js/db.js').includes("(_cs === 'granted' || _cs === 'unknown') ? _aeVisitorId() : _aeExistingVisitorId()"));

console.log(`analytics-seo-audit: ${passed} passed, ${failed} failed`);
if (failed) { console.error(failures.map(f => '  ✗ ' + f).join('\n')); process.exit(1); }
