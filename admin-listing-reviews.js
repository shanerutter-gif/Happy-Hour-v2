/* admin-listing-reviews.js
 * Listing-edit review queue for the admin panel.
 * Self-contained; injected via api/admin-page.js SCRIPT_TAGS.
 * Reads admin session from localStorage['spotd-admin-session'].
 */
(function () {
'use strict';

var SUPABASE_URL = 'https://opcskuzbdfrlnyhraysk.supabase.co';
var SUPABASE_ANON = 'sb_publishable_M97B-GmwsRF6xPVahp_ytw_49nI9igs';
var LS_KEY = 'spotd-admin-session';

function session() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
  catch (e) { return {}; }
}
function hdrs() {
  var s = session();
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON,
    'Authorization': 'Bearer ' + (s.token || SUPABASE_ANON)
  };
}
function sbGet(table, qs) {
  return fetch(SUPABASE_URL + '/rest/v1/' + table + '?' + (qs || ''), { headers: hdrs() })
    .then(function (r) {
      if (!r.ok) throw new Error('GET ' + table + ' failed: ' + r.status);
      return r.json();
    });
}
function sbPatch(table, id, data) {
  return fetch(SUPABASE_URL + '/rest/v1/' + table + '?id=eq.' + id, {
    method: 'PATCH',
    headers: Object.assign({}, hdrs(), { 'Prefer': 'return=representation' }),
    body: JSON.stringify(data)
  }).then(function (r) {
    if (!r.ok) throw new Error('PATCH ' + table + ' failed: ' + r.status);
    return r.json();
  });
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US',
      { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch (e) { return String(iso); }
}
function fmtVal(v) {
  if (v == null) return '<span style="opacity:.5">—</span>';
  if (Array.isArray(v)) return esc(v.length ? v.join(', ') : '(empty)');
  if (typeof v === 'object') return esc(JSON.stringify(v));
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return esc(String(v));
}
function toast(msg) {
  var d = document.createElement('div');
  d.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
    'background:#1a1a1a;color:#fff;padding:12px 20px;border-radius:8px;' +
    'font-size:14px;z-index:9999;';
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(function () { d.remove(); }, 2600);
}

var allProposals = [];

function loadProposals() {   return sbGet('venue_edit_proposals',     'select=*,venue:venues(id,name,neighborhood,city_slug,hours,days,deals,description,photo_url,photo_urls,' +     'has_happy_hour,has_sports_tv,is_dog_friendly,has_live_music,has_karaoke,has_trivia,has_bingo,has_comedy,' +     'promo_code,promo_description)&status=eq.pending&order=created_at.desc'   ).then(function (data) {     allProposals = Array.isArray(data) ? data : [];     updateCounts();     render();   }).catch(function (e) {     console.warn('[listing-reviews] load failed:', e.message);     allProposals = [];     updateCounts();     render();   }); } function updateCounts() {   var n = allProposals.length;   var el = document.getElementById('sidebar-reviews-count');   if (el) { el.textContent = n; el.classList.toggle('zero', n === 0); } } function renderDiff(p) {   var venue = p.venue || {};   var changes = p.changes || {};   var keys = Object.keys(changes);   if (!keys.length) return '<div style="opacity:.6;font-size:13px">(no field changes)</div>';   var rows = keys.map(function (k) {     return '<tr style="border-top:1px solid var(--border)">' +       '<td style="padding:8px 8px 8px 0;font-weight:600;white-space:nowrap;vertical-align:top">' + esc(k) + '</td>' +       '<td style="padding:8px;opacity:.65;vertical-align:top;max-width:260px;overflow:hidden;text-overflow:ellipsis">' + fmtVal(venue[k]) + '</td>' +       '<td style="padding:8px 4px;vertical-align:top">&rarr;</td>' +       '<td style="padding:8px;vertical-align:top;max-width:260px;overflow:hidden;text-overflow:ellipsis;font-weight:600">' + fmtVal(changes[k]) + '</td>' +       '</tr>';   }).join('');   return '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px">' + rows + '</table>'; } function render() {   var list = document.getElementById('reviews-list');   if (!list) return;   if (!allProposals.length) {     list.innerHTML = '<div class="empty-state"><div class="empty-icon">&#127881;</div>' +       '<div>All caught up — no pending listing edits.</div></div>';     return;   }   list.innerHTML = allProposals.map(function (p) {     var v = p.venue || {};     var title = v.name || ('Venue ' + String(p.venue_id || '').slice(0, 8));     var sub = [v.neighborhood, v.city_slug].filter(Boolean).join(' · ');     var who = p.proposed_by ? String(p.proposed_by).slice(0, 8) + '…' : 'unknown';     return '<div class="request-card" id="lr-' + esc(p.id) + '">' +       '<div class="req-header"><div><div class="req-title">' + esc(title) + '</div>' +       '<div class="req-sub">' + esc(sub) + (sub ? ' · ' : '') + 'section: ' + esc(p.section || 'general') + '</div>' +       '<div class="req-sub">Proposed by ' + esc(who) + ' · ' + esc(fmtDate(p.created_at)) + '</div>' +       '</div></div>' +       renderDiff(p) +       '<div style="display:flex;gap:10px;margin-top:12px">' +       '<button class="btn-approve" data-lr-approve="' + esc(p.id) + '">Approve &amp; publish</button>' +       '<button class="btn-reject" data-lr-reject="' + esc(p.id) + '">Reject</button>' +       '</div></div>';   }).join(''); }  // __CHUNK3__
})();
