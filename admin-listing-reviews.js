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

function loadProposals() {   return sbGet('venue_edit_proposals',     'select=*,venue:venues(id,name,neighborhood,city_slug,hours,days,deals,description,photo_url,photo_urls,' +     'has_happy_hour,has_sports_tv,is_dog_friendly,has_live_music,has_karaoke,has_trivia,has_bingo,has_comedy,' +     'promo_code,promo_description)&status=eq.pending&order=created_at.desc'   ).then(function (data) {     allProposals = Array.isArray(data) ? data : [];     updateCounts();     render();   }).catch(function (e) {     console.warn('[listing-reviews] load failed:', e.message);     allProposals = [];     updateCounts();     render();   }); } function updateCounts() {   var n = allProposals.length;   var el = document.getElementById('sidebar-reviews-count');   if (el) { el.textContent = n; el.classList.toggle('zero', n === 0); } } function renderDiff(p) {   var venue = p.venue || {};   var changes = p.changes || {};   var keys = Object.keys(changes);   if (!keys.length) return '<div style="opacity:.6;font-size:13px">(no field changes)</div>';   var rows = keys.map(function (k) {     return '<tr style="border-top:1px solid var(--border)">' +       '<td style="padding:8px 8px 8px 0;font-weight:600;white-space:nowrap;vertical-align:top">' + esc(k) + '</td>' +       '<td style="padding:8px;opacity:.65;vertical-align:top;max-width:260px;overflow:hidden;text-overflow:ellipsis">' + fmtVal(venue[k]) + '</td>' +       '<td style="padding:8px 4px;vertical-align:top">&rarr;</td>' +       '<td style="padding:8px;vertical-align:top;max-width:260px;overflow:hidden;text-overflow:ellipsis;font-weight:600">' + fmtVal(changes[k]) + '</td>' +       '</tr>';   }).join('');   return '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px">' + rows + '</table>'; } function render() {   var list = document.getElementById('reviews-list');   if (!list) return;   if (!allProposals.length) {     list.innerHTML = '<div class="empty-state"><div class="empty-icon">&#127881;</div>' +       '<div>All caught up — no pending listing edits.</div></div>';     return;   }   list.innerHTML = allProposals.map(function (p) {     var v = p.venue || {};     var title = v.name || ('Venue ' + String(p.venue_id || '').slice(0, 8));     var sub = [v.neighborhood, v.city_slug].filter(Boolean).join(' · ');     var who = p.proposed_by ? String(p.proposed_by).slice(0, 8) + '…' : 'unknown';     return '<div class="request-card" id="lr-' + esc(p.id) + '">' +       '<div class="req-header"><div><div class="req-title">' + esc(title) + '</div>' +       '<div class="req-sub">' + esc(sub) + (sub ? ' · ' : '') + 'section: ' + esc(p.section || 'general') + '</div>' +       '<div class="req-sub">Proposed by ' + esc(who) + ' · ' + esc(fmtDate(p.created_at)) + '</div>' +       '</div></div>' +       renderDiff(p) +       '<div style="display:flex;gap:10px;margin-top:12px">' +       '<button class="btn-approve" data-lr-approve="' + esc(p.id) + '">Approve &amp; publish</button>' +       '<button class="btn-reject" data-lr-reject="' + esc(p.id) + '">Reject</button>' +       '</div></div>';   }).join(''); }  function approve(id) {   var p = null;   for (var i = 0; i < allProposals.length; i++) if (String(allProposals[i].id) === String(id)) p = allProposals[i];   if (!p) return;   var vname = (p.venue && p.venue.name) || 'this venue';   if (window.__lrArm !== 'a:' + id) { window.__lrArm = 'a:' + id; toast('Tap "Approve & publish" again to confirm'); setTimeout(function () { if (window.__lrArm === 'a:' + id) window.__lrArm = null; }, 6000); return; } window.__lrArm = null;   var changes = p.changes || {};   var apply = Promise.resolve();   if (p.venue_id && Object.keys(changes).length) apply = sbPatch('venues', p.venue_id, changes);   apply.then(function () { return sbPatch('venue_edit_proposals', id, { status: 'approved' }); })     .then(function () {       allProposals = allProposals.filter(function (x) { return String(x.id) !== String(id); });       updateCounts(); render();       toast('Approved & published');     })     .catch(function (e) { toast('Approve failed: ' + (e.message || e)); }); } function rejectIt(id) {   var p = null;   for (var i = 0; i < allProposals.length; i++) if (String(allProposals[i].id) === String(id)) p = allProposals[i];   if (!p) return;   var vname = (p.venue && p.venue.name) || 'this venue';   if (window.__lrArm !== 'r:' + id) { window.__lrArm = 'r:' + id; toast('Tap "Reject" again to confirm'); setTimeout(function () { if (window.__lrArm === 'r:' + id) window.__lrArm = null; }, 6000); return; } window.__lrArm = null;   sbPatch('venue_edit_proposals', id, { status: 'rejected' })     .then(function () {       allProposals = allProposals.filter(function (x) { return String(x.id) !== String(id); });       updateCounts(); render();       toast('Rejected — listing unchanged');     })     .catch(function (e) { toast('Reject failed: ' + (e.message || e)); }); } function switchTo() {   document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });   document.querySelectorAll('.sidebar-item').forEach(function (i) { i.classList.remove('active'); });   var pg = document.getElementById('page-reviews');   if (pg) pg.classList.add('active');   var nv = document.getElementById('nav-reviews');   if (nv) nv.classList.add('active');   loadProposals(); } function inject() {   var claimsNav = document.getElementById('nav-claims');   if (claimsNav && !document.getElementById('nav-reviews')) {     var el = document.createElement('div');     el.className = 'sidebar-item';     el.id = 'nav-reviews';     el.style.cursor = 'pointer';     el.innerHTML = '&#128221; Listing Reviews <span class="sidebar-count zero" id="sidebar-reviews-count">—</span>';     el.addEventListener('click', switchTo);     claimsNav.parentNode.insertBefore(el, claimsNav.nextSibling);   }   var mobClaims = document.getElementById('mob-nav-claims');   if (mobClaims && !document.getElementById('mob-nav-reviews')) {     var m = document.createElement('button');     m.className = 'drawer-item';     m.id = 'mob-nav-reviews';     m.innerHTML = '&#128221; Listing Reviews';     m.addEventListener('click', function () {       if (typeof window.closeMobileMenu === 'function') window.closeMobileMenu();       switchTo();     });     mobClaims.parentNode.insertBefore(m, mobClaims.nextSibling);   }   var main = document.querySelector('.main-content');   if (main && !document.getElementById('page-reviews')) {     var page = document.createElement('div');     page.className = 'page';     page.id = 'page-reviews';     page.innerHTML = '<div class="page-title">&#128221; Listing Reviews</div>' +       '<div class="page-sub">Owner-submitted listing edits awaiting review. ' +       'Approve to publish live, or reject to leave the listing unchanged.</div>' +       '<div id="reviews-list"></div>';     main.appendChild(page);     page.addEventListener('click', function (ev) {       var a = ev.target.closest('[data-lr-approve]');       var r = ev.target.closest('[data-lr-reject]');       if (a) approve(a.getAttribute('data-lr-approve'));       else if (r) rejectIt(r.getAttribute('data-lr-reject'));     });   } } function init() {   inject();   loadProposals();   var tries = 0;   var iv = setInterval(function () {     var s = session();     if (s && s.token) { clearInterval(iv); loadProposals(); }     else if (tries++ > 120) { clearInterval(iv); }   }, 1500); } if (document.readyState === 'loading') {   document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 150); }); } else {   setTimeout(init, 150); }
})();
