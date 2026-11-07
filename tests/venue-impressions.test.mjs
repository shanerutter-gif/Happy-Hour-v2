// Guards venue impression tracking (2026-11-07): js/impressions.js → /api/vibe
// anonymous path → ae_venue_impressions. Run: node tests/venue-impressions.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
let passed = 0, failed = 0; const failures = [];
function check(name, cond) { if (cond) passed++; else { failed++; failures.push(name); } }

// 1. App wiring
const app = read('js/app.js');
for (const cls of ['card-hero', 'card-compact', 'card-std']) {
  check(`app: ${cls} carries data-vid`, app.includes(`<div class="${cls}" data-id="\${v.id}" data-vid="\${v.id}"`));
}
check('app: rescan after feed render', /grid\.innerHTML = html;\s*_feedArmObserver\(\);\s*try \{ window\.spotdImpScan/.test(app));
check('app: modal records a detail view', app.includes("window.spotdImpView(id, 'app_modal')"));
check('index.html loads impressions.js', read('index.html').includes('js/impressions.js?v='));

// 2. Website wiring
check('spots.js: detail view on body', read('api/spots.js').includes('data-venue-view="${esc(String(venue.id))}"'));
check('spots.js: nearby cards tracked', read('api/spots.js').includes('data-imp-src="site_nearby"'));
check('happy-hour.js: selects id', read('api/happy-hour.js').includes('&select=id,name,'));
check('happy-hour.js: rows tracked', read('api/happy-hour.js').includes('data-imp-src="site_hub"'));
check('spots-directory.js: rows tracked', read('api/spots-directory.js').includes('data-imp-src="site_directory"'));
for (const f of ['api/spots.js', 'api/happy-hour.js', 'api/spots-directory.js']) {
  check(`${f}: loads impressions.js`, read(f).includes('/js/impressions.js?v='));
}

// 3. Tracker: anonymous, internal/bot-silent, disconnects before rescanning
const imp = read('js/impressions.js');
check('impressions: anonymous ping', imp.includes('anon: true'));
check('impressions: internal switch respected', imp.includes('__spotdInternal'));
check('impressions: observer disconnect before re-observe', /io\.disconnect\(\);[\s\S]{0,200}io\.observe/.test(imp));

// 4. Server: only well-formed venue props get through the anonymous path
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-key';
const inserted = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('/rest/v1/analytics_events')) inserted.push(...JSON.parse(init.body));
  return new Response('[]', { status: 201 });
};
const { default: handler } = await import('../api/track-event.js');
const good = '915d3c56-a029-4011-aec4-4218a77178a9';
const req = new Request('https://www.spotd.biz/api/vibe', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
  body: JSON.stringify({ anon: true, platform: 'web', device: 'mobile', events: [
    { n: 'venue_impressions', p: { ids: [good, good, 'not-a-uuid', 42], src: 'app_feed', city: 'san-diego', junk: { x: 1 } }, path: '/', t: Date.now() },
    { n: 'venue_impressions', p: { ids: ['nope'] }, path: '/', t: Date.now() },
    { n: 'venue_view', p: { id: good, src: 'site_page', extra: 'x' }, path: '/spots/x', t: Date.now() },
    { n: 'venue_view', p: { id: 'bad' }, path: '/', t: Date.now() },
  ] }),
});
const res = await handler(req);
check('server: 200', res.status === 200);
const impRows = inserted.filter(r => r.event_name === 'venue_impressions');
const viewRows = inserted.filter(r => r.event_name === 'venue_view');
check('server: one impression row kept', impRows.length === 1);
check('server: ids deduped + validated', impRows[0] && JSON.stringify(impRows[0].props.ids) === JSON.stringify([good]));
check('server: junk props stripped', impRows[0] && !('junk' in impRows[0].props) && impRows[0].props.anon === true);
check('server: one valid view row kept', viewRows.length === 1 && viewRows[0].props.id === good && !('extra' in viewRows[0].props));
check('server: anon hashed visitor', impRows[0] && /^anon_/.test(impRows[0].session_id));

// 5. SQL + admin
const sql = read('sql/venue-impressions-20261107.sql');
check('sql: admin-gated', (sql.match(/is_giveaway_admin\(\)/g) || []).length >= 2);
check('sql: bots excluded', sql.includes("_ae_bot_bucket(e.user_agent) = 'human'"));
check('admin: Venues mode', read('admin-activity.js').includes("['venues', '👁 Venues']"));

console.log(`venue-impressions: ${passed} passed, ${failed} failed`);
if (failed) { console.error(failures.map(f => '  ✗ ' + f).join('\n')); process.exit(1); }
