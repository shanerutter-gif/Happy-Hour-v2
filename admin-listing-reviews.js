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

// __CHUNK2__
})();
