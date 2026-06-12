/* admin-push-center.js
 * Builds the existing admin "Push Notifications" page out into a full Push
 * Center: scheduled/recurring campaigns + behavior-based automations, all
 * stored in Supabase (push_campaigns / push_automations / push_automation_log,
 * see sql/push_center.sql) and executed by /api/push-runner every 15 minutes.
 *
 * Injected by api/admin-page.js (SCRIPT_TAGS) — augments #page-push in place:
 *   - adds a "Schedule for later" block inside the existing compose card
 *   - adds Scheduled Campaigns + Automations sections after it
 *   - replaces renderPushHistory with a merged view (manual sends from
 *     localStorage + campaign/automation results from the DB)
 *
 * Data access uses the service-role key, same pragmatic pattern as the rest
 * of admin.html (svcHeaders) — the page is admin-gated. The push_* tables
 * have RLS enabled with no policies, so only the service role can read them.
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://opcskuzbdfrlnyhraysk.supabase.co';
  var SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wY3NrdXpiZGZybG55aHJheXNrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjc0NDcxNywiZXhwIjoyMDg4MzIwNzE3fQ.r8QJQARvCOG16ayEYN7BDTGuFOTKLLPZ4gBgoNXBfX4';
  var LS_KEY = 'spotd-admin-session';

  function svc(extra) {
    var h = {
      'Content-Type': 'application/json',
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': 'Bearer ' + SERVICE_ROLE_KEY,
    };
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  }

  async function sbFetch(pathAndQuery, opts) {
    var r = await fetch(SUPABASE_URL + '/rest/v1/' + pathAndQuery, opts || { headers: svc() });
    var text = await r.text();
    var data; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!r.ok) throw new Error((data && (data.message || data.error)) || 'HTTP ' + r.status);
    return data;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtWhen(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }) + ' · ' +
             d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' });
    } catch (e) { return iso; }
  }
  function myUserId() {
    try { return (JSON.parse(localStorage.getItem(LS_KEY) || '{}').user || {}).id || null; }
    catch (e) { return null; }
  }

  var TRIGGER_LABELS = {
    inactive_days:           '😴 Inactive for N days',
    first_favorite:          '⭐ First favorite saved',
    going_tonight_threshold: '🔥 Busy venue (check-in threshold)',
    new_venue_in_city:       '🆕 New venue in user’s city',
  };
  function triggerSummary(a) {
    var cfg = a.trigger_config || {};
    switch (a.trigger_type) {
      case 'inactive_days':           return 'after ' + (cfg.days || 7) + ' days inactive';
      case 'going_tonight_threshold': return 'when a venue hits ' + (cfg.threshold || 2) + '+ check-ins today';
      case 'first_favorite':          return 'on a user’s first saved spot';
      case 'new_venue_in_city':       return 'when a venue goes live in their city';
      default: return a.trigger_type;
    }
  }
  function audienceLabel(aud) {
    var a = aud || { type: 'all' };
    if (a.type === 'all') return 'All users (iOS)';
    if (a.type === 'user_ids') return (a.user_ids || []).length === 1 ? 'Just me (test)' : (a.user_ids || []).length + ' users';
    if (a.type === 'city_slug') return 'City: ' + a.city_slug;
    if (a.type === 'platform') return 'Platform: ' + a.platform;
    return 'Custom';
  }

  // ── state ──────────────────────────────────────────
  var scheduled = [];
  var sentCampaigns = [];
  var automations = [];
  var logCounts = {};
  var editingAutomation = null;

  // ── data ───────────────────────────────────────────
  async function loadAll() {
    try {
      var results = await Promise.all([
        sbFetch('push_campaigns?select=*&status=eq.scheduled&order=send_at.asc&limit=100'),
        sbFetch('push_campaigns?select=*&sent_at=not.is.null&order=sent_at.desc&limit=30'),
        sbFetch('push_automations?select=*&order=created_at.desc'),
        sbFetch('push_automation_log?select=automation_id&order=sent_at.desc&limit=10000'),
      ]);
      scheduled = results[0] || [];
      sentCampaigns = results[1] || [];
      automations = results[2] || [];
      logCounts = {};
      (results[3] || []).forEach(function (r) {
        logCounts[r.automation_id] = (logCounts[r.automation_id] || 0) + 1;
      });
    } catch (e) {
      console.warn('[push-center] load failed:', e.message);
      var el = document.getElementById('pc-scheduled-list');
      if (el) el.innerHTML = '<div style="padding:14px;color:var(--error,#c0392b);font-size:13px">Push Center tables unavailable: ' + esc(e.message) + ' — run sql/push_center.sql.</div>';
      return;
    }
    renderScheduled();
    renderAutomations();
    if (typeof window.renderPushHistory === 'function') window.renderPushHistory();
  }

  // ── scheduling ─────────────────────────────────────
  function toggleScheduleForm() {
    var f = document.getElementById('pc-schedule-form');
    if (f) f.style.display = f.style.display === 'none' ? 'block' : 'none';
  }

  function onRepeatChange() {
    var rep = document.getElementById('pc-repeat').value;
    document.getElementById('pc-repeat-day-wrap').style.display = rep === 'weekly' ? 'block' : 'none';
  }
  function onAudienceChange() {
    var aud = document.getElementById('pc-audience').value;
    document.getElementById('pc-city-wrap').style.display = aud === 'city' ? 'block' : 'none';
  }

  async function scheduleCampaign() {
    var status = document.getElementById('pc-schedule-status');
    var title = (document.getElementById('push-title') || {}).value || '';
    var body = (document.getElementById('push-body') || {}).value || '';
    var url = (document.getElementById('push-url') || {}).value || '';
    title = title.trim(); body = body.trim(); url = url.trim();
    var sendAtVal = document.getElementById('pc-send-at').value;
    var repeat = document.getElementById('pc-repeat').value;
    var audSel = document.getElementById('pc-audience').value;

    function fail(msg) { status.textContent = msg; status.style.color = 'var(--error, #c0392b)'; }
    if (!title || !body) return fail('Fill in the Title and Message above first');
    if (!sendAtVal) return fail('Pick a date & time');
    var sendAt = new Date(sendAtVal); // datetime-local = admin's local time
    if (isNaN(sendAt.getTime())) return fail('Invalid date');
    if (sendAt.getTime() < Date.now() - 60000) return fail('That time is in the past');

    var audience = { type: 'all' };
    if (audSel === 'me') {
      var uid = myUserId();
      if (!uid) return fail('Could not resolve your user id — sign out and back in');
      audience = { type: 'user_ids', user_ids: [uid] };
    } else if (audSel === 'city') {
      var slug = (document.getElementById('pc-city').value || '').trim().toLowerCase();
      if (!slug) return fail('Enter a city slug (e.g. san-diego)');
      audience = { type: 'city_slug', city_slug: slug };
    }

    var recurrence = null;
    if (repeat === 'daily') {
      recurrence = sendAt.getUTCMinutes() + ' ' + sendAt.getUTCHours() + ' * * *';
    } else if (repeat === 'weekly') {
      var dow = document.getElementById('pc-repeat-day').value;
      recurrence = sendAt.getUTCMinutes() + ' ' + sendAt.getUTCHours() + ' * * ' + dow;
    }

    try {
      status.textContent = 'Scheduling…'; status.style.color = 'var(--muted)';
      await sbFetch('push_campaigns', {
        method: 'POST',
        headers: svc({ 'Prefer': 'return=minimal' }),
        body: JSON.stringify({
          title: title, body: body, url: url || null,
          audience: audience, status: 'scheduled',
          send_at: sendAt.toISOString(), recurrence: recurrence,
        }),
      });
      // clear the compose form like an instant send does
      document.getElementById('push-title').value = '';
      document.getElementById('push-body').value = '';
      document.getElementById('push-url').value = '';
      document.getElementById('pc-send-at').value = '';
      if (typeof window.updatePushPreview === 'function') window.updatePushPreview();
      status.textContent = recurrence ? 'Scheduled (repeats: ' + recurrence + ' UTC)' : 'Scheduled ✓';
      status.style.color = 'var(--success, #27ae60)';
      loadAll();
    } catch (e) { fail(e.message); }
  }

  async function cancelCampaign(id) {
    if (!window.confirm('Cancel this scheduled campaign?')) return;
    try {
      await sbFetch('push_campaigns?id=eq.' + id, {
        method: 'PATCH',
        headers: svc({ 'Prefer': 'return=minimal' }),
        body: JSON.stringify({ status: 'canceled' }),
      });
      loadAll();
    } catch (e) { window.alert('Cancel failed: ' + e.message); }
  }

  function renderScheduled() {
    var el = document.getElementById('pc-scheduled-list');
    if (!el) return;
    if (!scheduled.length) {
      el.innerHTML = '<div class="empty-state" style="padding:24px"><div class="empty-icon">🗓️</div><h3>Nothing scheduled</h3><p>Use "Schedule for later" in the composer above.</p></div>';
      return;
    }
    el.innerHTML = scheduled.map(function (c) {
      return '<div class="push-history-item">' +
        '<div class="push-history-info">' +
          '<div class="push-history-title">' + esc(c.title) + (c.recurrence ? ' <span class="pc-badge">⟳ ' + esc(c.recurrence) + ' UTC</span>' : '') + '</div>' +
          '<div class="push-history-meta">' + esc((c.body || '').slice(0, 80)) + ((c.body || '').length > 80 ? '…' : '') +
            ' · ' + esc(audienceLabel(c.audience)) + '</div>' +
        '</div>' +
        '<div style="text-align:right;flex-shrink:0;display:flex;align-items:center;gap:14px">' +
          '<div><div class="push-history-stat" style="font-size:14px">' + fmtWhen(c.send_at) + '</div>' +
          '<div class="push-history-stat-label">' + (c.recurrence ? 'next send' : 'sends at') + '</div></div>' +
          '<button class="pc-btn pc-btn-danger" data-pc-cancel="' + c.id + '">Cancel</button>' +
        '</div>' +
      '</div>';
    }).join('');
    el.querySelectorAll('[data-pc-cancel]').forEach(function (b) {
      b.addEventListener('click', function () { cancelCampaign(b.getAttribute('data-pc-cancel')); });
    });
  }

  // ── automations ────────────────────────────────────
  function automationFormHTML(a) {
    a = a || {};
    var cfg = a.trigger_config || {};
    var type = a.trigger_type || 'inactive_days';
    return '<div class="push-compose" id="pc-automation-form" style="margin-bottom:20px">' +
      '<div class="push-compose-title">' + (a.id ? 'Edit Automation' : 'New Automation') + '</div>' +
      '<div class="push-field"><label>Name</label>' +
        '<input class="push-input" id="pc-auto-name" type="text" placeholder="e.g. Win back 7-day inactives" value="' + esc(a.name || '') + '"></div>' +
      '<div class="push-field"><label>Trigger</label>' +
        '<select class="push-input" id="pc-auto-trigger">' +
          Object.keys(TRIGGER_LABELS).map(function (t) {
            return '<option value="' + t + '"' + (t === type ? ' selected' : '') + '>' + TRIGGER_LABELS[t] + '</option>';
          }).join('') +
        '</select></div>' +
      '<div class="push-field" id="pc-auto-cfg-days-wrap"><label>Days inactive</label>' +
        '<input class="push-input" id="pc-auto-cfg-days" type="number" min="1" value="' + (cfg.days || 7) + '"></div>' +
      '<div class="push-field" id="pc-auto-cfg-threshold-wrap"><label>Check-in threshold (people today)</label>' +
        '<input class="push-input" id="pc-auto-cfg-threshold" type="number" min="1" value="' + (cfg.threshold || 2) + '"></div>' +
      '<div class="push-field"><label>Title template</label>' +
        '<input class="push-input" id="pc-auto-title" type="text" placeholder="e.g. {{venue_name}} is buzzing 🔥" value="' + esc(a.template_title || '') + '"></div>' +
      '<div class="push-field"><label>Message template <span style="font-size:9px;color:var(--muted);text-transform:none;letter-spacing:0">placeholders: {{venue_name}} {{city}} {{count}}</span></label>' +
        '<textarea class="push-input push-textarea" id="pc-auto-body" placeholder="e.g. {{count}} people just checked in at {{venue_name}}">' + esc(a.template_body || '') + '</textarea></div>' +
      '<div class="push-field"><label>Link URL (optional)</label>' +
        '<input class="push-input" id="pc-auto-url" type="text" placeholder="e.g. /" value="' + esc(a.url || '') + '"></div>' +
      '<div class="push-field"><label>Cooldown (hours) <span style="font-size:9px;color:var(--muted);text-transform:none;letter-spacing:0">min time between sends to the same user</span></label>' +
        '<input class="push-input" id="pc-auto-cooldown" type="number" min="1" value="' + (a.cooldown_hours || 72) + '"></div>' +
      '<div style="display:flex;align-items:center;gap:12px">' +
        '<button class="push-send-btn" id="pc-auto-save">' + (a.id ? 'Save Changes' : 'Create Automation') + '</button>' +
        '<button class="pc-btn" id="pc-auto-cancel">Cancel</button>' +
        '<span id="pc-auto-status" style="font-size:13px;color:var(--muted)"></span>' +
      '</div>' +
    '</div>';
  }

  function syncAutomationCfgVisibility() {
    var type = document.getElementById('pc-auto-trigger').value;
    document.getElementById('pc-auto-cfg-days-wrap').style.display = type === 'inactive_days' ? 'block' : 'none';
    document.getElementById('pc-auto-cfg-threshold-wrap').style.display = type === 'going_tonight_threshold' ? 'block' : 'none';
  }

  function openAutomationForm(a) {
    editingAutomation = a || null;
    var wrap = document.getElementById('pc-automation-form-wrap');
    wrap.innerHTML = automationFormHTML(a);
    syncAutomationCfgVisibility();
    document.getElementById('pc-auto-trigger').addEventListener('change', syncAutomationCfgVisibility);
    document.getElementById('pc-auto-save').addEventListener('click', saveAutomation);
    document.getElementById('pc-auto-cancel').addEventListener('click', function () {
      editingAutomation = null;
      wrap.innerHTML = '';
    });
    wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function saveAutomation() {
    var status = document.getElementById('pc-auto-status');
    var name = document.getElementById('pc-auto-name').value.trim();
    var type = document.getElementById('pc-auto-trigger').value;
    var title = document.getElementById('pc-auto-title').value.trim();
    var body = document.getElementById('pc-auto-body').value.trim();
    var url = document.getElementById('pc-auto-url').value.trim();
    var cooldown = parseInt(document.getElementById('pc-auto-cooldown').value, 10) || 72;
    if (!name || !title || !body) {
      status.textContent = 'Name, title and message are required';
      status.style.color = 'var(--error, #c0392b)';
      return;
    }
    var cfg = {};
    if (type === 'inactive_days') cfg.days = parseInt(document.getElementById('pc-auto-cfg-days').value, 10) || 7;
    if (type === 'going_tonight_threshold') cfg.threshold = parseInt(document.getElementById('pc-auto-cfg-threshold').value, 10) || 2;

    var row = {
      name: name, trigger_type: type, trigger_config: cfg,
      template_title: title, template_body: body,
      url: url || null, cooldown_hours: cooldown,
    };
    try {
      status.textContent = 'Saving…'; status.style.color = 'var(--muted)';
      if (editingAutomation && editingAutomation.id) {
        await sbFetch('push_automations?id=eq.' + editingAutomation.id, {
          method: 'PATCH', headers: svc({ 'Prefer': 'return=minimal' }), body: JSON.stringify(row),
        });
      } else {
        row.enabled = true;
        await sbFetch('push_automations', {
          method: 'POST', headers: svc({ 'Prefer': 'return=minimal' }), body: JSON.stringify(row),
        });
      }
      editingAutomation = null;
      document.getElementById('pc-automation-form-wrap').innerHTML = '';
      loadAll();
    } catch (e) {
      status.textContent = e.message;
      status.style.color = 'var(--error, #c0392b)';
    }
  }

  async function toggleAutomation(id, enabled) {
    try {
      await sbFetch('push_automations?id=eq.' + id, {
        method: 'PATCH', headers: svc({ 'Prefer': 'return=minimal' }),
        body: JSON.stringify({ enabled: enabled }),
      });
      loadAll();
    } catch (e) { window.alert('Toggle failed: ' + e.message); }
  }

  async function deleteAutomation(id) {
    if (!window.confirm('Delete this automation? Its send log goes with it.')) return;
    try {
      await sbFetch('push_automations?id=eq.' + id, { method: 'DELETE', headers: svc() });
      loadAll();
    } catch (e) { window.alert('Delete failed: ' + e.message); }
  }

  function renderAutomations() {
    var el = document.getElementById('pc-automations-list');
    if (!el) return;
    if (!automations.length) {
      el.innerHTML = '<div class="empty-state" style="padding:24px"><div class="empty-icon">🤖</div><h3>No automations yet</h3><p>Create one to send behavior-triggered pushes automatically.</p></div>';
      return;
    }
    el.innerHTML = automations.map(function (a) {
      var sentCount = logCounts[a.id] || 0;
      return '<div class="push-history-item" style="' + (a.enabled ? '' : 'opacity:.55') + '">' +
        '<div class="push-history-info">' +
          '<div class="push-history-title">' + esc(a.name) +
            (a.enabled ? ' <span class="pc-badge pc-badge-on">active</span>' : ' <span class="pc-badge">paused</span>') + '</div>' +
          '<div class="push-history-meta">' + esc(TRIGGER_LABELS[a.trigger_type] || a.trigger_type) + ' — ' + esc(triggerSummary(a)) +
            ' · cooldown ' + (a.cooldown_hours || 72) + 'h</div>' +
          '<div class="push-history-meta" style="margin-top:2px">“' + esc(a.template_title) + '”</div>' +
        '</div>' +
        '<div style="text-align:right;flex-shrink:0;display:flex;align-items:center;gap:14px">' +
          '<div><div class="push-history-stat">' + sentCount + '</div><div class="push-history-stat-label">sent</div></div>' +
          '<button class="pc-btn" data-pc-toggle="' + a.id + '" data-pc-enabled="' + (a.enabled ? '1' : '0') + '">' + (a.enabled ? 'Pause' : 'Enable') + '</button>' +
          '<button class="pc-btn" data-pc-edit="' + a.id + '">Edit</button>' +
          '<button class="pc-btn pc-btn-danger" data-pc-delete="' + a.id + '">Delete</button>' +
        '</div>' +
      '</div>';
    }).join('');
    el.querySelectorAll('[data-pc-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        toggleAutomation(b.getAttribute('data-pc-toggle'), b.getAttribute('data-pc-enabled') !== '1');
      });
    });
    el.querySelectorAll('[data-pc-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        var a = automations.find(function (x) { return x.id === b.getAttribute('data-pc-edit'); });
        if (a) openAutomationForm(a);
      });
    });
    el.querySelectorAll('[data-pc-delete]').forEach(function (b) {
      b.addEventListener('click', function () { deleteAutomation(b.getAttribute('data-pc-delete')); });
    });
  }

  // ── merged history (manual sends + campaign results) ─
  function renderMergedHistory() {
    var el = document.getElementById('push-history-list');
    if (!el) return;
    var manual = [];
    try { manual = JSON.parse(localStorage.getItem('spotd-push-history') || '[]'); } catch (e) {}
    var items = manual.map(function (h) {
      return {
        time: h.time, title: h.title, body: h.body, kind: 'manual',
        audience: h.audience === 'me' ? 'Just me (test)' : 'All users (iOS)',
        sent: h.sent || 0, total: h.total || 0, errors: [],
        errCount: h.errors || 0,
      };
    }).concat(sentCampaigns.map(function (c) {
      var r = c.result || {};
      return {
        time: c.sent_at, title: c.title, body: c.body,
        kind: c.recurrence ? 'recurring' : 'scheduled',
        audience: audienceLabel(c.audience),
        sent: r.sent || 0, total: r.total || 0,
        errors: r.errors || [], errCount: (r.errors || []).length,
      };
    }));
    items.sort(function (a, b) { return (b.time || '') < (a.time || '') ? -1 : 1; });

    if (!items.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><h3>No sends yet</h3><p>Compose and send your first notification above.</p></div>';
      return;
    }
    el.innerHTML = items.slice(0, 50).map(function (h) {
      var kindBadge = h.kind === 'manual' ? '' :
        ' <span class="pc-badge">' + (h.kind === 'recurring' ? '⟳ recurring' : '🗓️ scheduled') + '</span>';
      var errHtml = '';
      if (h.errors.length) {
        errHtml = '<details class="pc-errors"><summary>' + h.errors.length + ' failed</summary><ul>' +
          h.errors.map(function (e2) {
            return '<li><code>' + esc(e2.tag || '') + '</code> ' + esc(e2.error || JSON.stringify(e2)) + '</li>';
          }).join('') + '</ul></details>';
      } else if (h.errCount) {
        errHtml = '<div class="push-history-meta" style="color:var(--error,#c0392b)">' + h.errCount + ' failed</div>';
      }
      return '<div class="push-history-item">' +
        '<div class="push-history-info">' +
          '<div class="push-history-title">' + esc(h.title) + kindBadge + '</div>' +
          '<div class="push-history-meta">' + esc((h.body || '').slice(0, 80)) + ((h.body || '').length > 80 ? '…' : '') +
            ' · ' + esc(h.audience) + ' · ' + fmtWhen(h.time) + '</div>' + errHtml +
        '</div>' +
        '<div style="text-align:right;flex-shrink:0">' +
          '<div class="push-history-stat">' + h.sent + '</div>' +
          '<div class="push-history-stat-label">of ' + h.total + ' sent</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ── DOM injection ──────────────────────────────────
  function inject() {
    var page = document.getElementById('page-push');
    if (!page || document.getElementById('pc-schedule-block')) return;

    // styles
    var style = document.createElement('style');
    style.textContent =
      '.pc-badge{display:inline-block;font-size:10px;font-weight:600;letter-spacing:.5px;padding:2px 8px;border-radius:999px;background:var(--bg2,#f0e9df);color:var(--muted,#888);vertical-align:1px}' +
      '.pc-badge-on{background:#e7f6ec;color:#27ae60}' +
      '.pc-btn{padding:7px 14px;border-radius:8px;border:1px solid var(--border,#e8e0d8);background:var(--card,#fff);color:var(--text,#333);font-size:12px;font-weight:600;cursor:pointer}' +
      '.pc-btn:hover{border-color:var(--coral,#FF6B4A);color:var(--coral,#FF6B4A)}' +
      '.pc-btn-danger:hover{border-color:#c0392b;color:#c0392b}' +
      '.pc-errors{margin-top:4px;font-size:12px;color:var(--muted,#888)}' +
      '.pc-errors summary{cursor:pointer;color:var(--error,#c0392b)}' +
      '.pc-errors ul{margin:6px 0 0;padding-left:18px}' +
      '#pc-schedule-block{margin-top:18px;padding-top:16px;border-top:1px dashed var(--border,#e8e0d8)}' +
      '#pc-schedule-form{margin-top:12px}' +
      '.pc-row{display:flex;gap:12px;flex-wrap:wrap}.pc-row .push-field{flex:1;min-width:170px}';
    document.head.appendChild(style);

    // 1) schedule block inside the compose card
    var compose = page.querySelector('.push-compose');
    if (compose) {
      var block = document.createElement('div');
      block.id = 'pc-schedule-block';
      block.innerHTML =
        '<button class="pc-btn" id="pc-schedule-toggle">⏰ Schedule for later</button>' +
        '<div id="pc-schedule-form" style="display:none">' +
          '<div class="pc-row">' +
            '<div class="push-field"><label>Send at (your local time)</label>' +
              '<input class="push-input" id="pc-send-at" type="datetime-local"></div>' +
            '<div class="push-field"><label>Repeat</label>' +
              '<select class="push-input" id="pc-repeat">' +
                '<option value="none">Doesn’t repeat</option>' +
                '<option value="daily">Daily at this time</option>' +
                '<option value="weekly">Weekly at this time</option>' +
              '</select></div>' +
            '<div class="push-field" id="pc-repeat-day-wrap" style="display:none"><label>On</label>' +
              '<select class="push-input" id="pc-repeat-day">' +
                '<option value="1">Mondays</option><option value="2">Tuesdays</option>' +
                '<option value="3">Wednesdays</option><option value="4">Thursdays</option>' +
                '<option value="5">Fridays</option><option value="6">Saturdays</option>' +
                '<option value="0">Sundays</option>' +
              '</select></div>' +
            '<div class="push-field"><label>Audience</label>' +
              '<select class="push-input" id="pc-audience">' +
                '<option value="all">All users (iOS)</option>' +
                '<option value="me">🧪 Just me (test)</option>' +
                '<option value="city">Specific city…</option>' +
              '</select></div>' +
            '<div class="push-field" id="pc-city-wrap" style="display:none"><label>City slug</label>' +
              '<input class="push-input" id="pc-city" type="text" placeholder="e.g. san-diego"></div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:14px;margin-top:4px">' +
            '<button class="push-send-btn" id="pc-schedule-btn" style="background:var(--bg2,#f0e9df);color:var(--text,#333)">Schedule</button>' +
            '<span id="pc-schedule-status" style="font-size:13px;color:var(--muted)"></span>' +
          '</div>' +
          '<div style="font-size:11px;color:var(--muted);margin-top:8px">Uses the Title / Message / Link fields above. The first send happens at the date you set; weekly repeats then follow the day picked here.</div>' +
        '</div>';
      compose.appendChild(block);
      document.getElementById('pc-schedule-toggle').addEventListener('click', toggleScheduleForm);
      document.getElementById('pc-repeat').addEventListener('change', onRepeatChange);
      document.getElementById('pc-audience').addEventListener('change', onAudienceChange);
      document.getElementById('pc-schedule-btn').addEventListener('click', scheduleCampaign);
    }

    // 2) Scheduled + Automations sections, before the "Recent Sends" header
    var historyHeader = null;
    page.querySelectorAll('.section-header .section-title').forEach(function (t) {
      if (t.textContent.trim() === 'Recent Sends') historyHeader = t.closest('.section-header');
    });
    var sections = document.createElement('div');
    sections.innerHTML =
      '<div class="section-header"><div class="section-title">Scheduled Campaigns</div></div>' +
      '<div id="pc-scheduled-list" style="margin-bottom:28px"></div>' +
      '<div class="section-header" style="display:flex;justify-content:space-between;align-items:center">' +
        '<div class="section-title">Automations</div>' +
        '<button class="pc-btn" id="pc-new-automation">+ New Automation</button>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--muted);margin:-4px 0 12px">Behavior-triggered pushes, evaluated every 15 minutes by /api/push-runner. Cooldowns stop repeat sends to the same user.</div>' +
      '<div id="pc-automation-form-wrap"></div>' +
      '<div id="pc-automations-list" style="margin-bottom:28px"></div>';
    if (historyHeader) {
      historyHeader.parentNode.insertBefore(sections, historyHeader);
    } else {
      page.appendChild(sections);
    }
    document.getElementById('pc-new-automation').addEventListener('click', function () { openAutomationForm(null); });

    // 3) merged history
    window.renderPushHistory = renderMergedHistory;

    // hook the page loader so opening the Push tab refreshes everything
    var origLoad = window.loadPushPage;
    window.loadPushPage = async function () {
      if (typeof origLoad === 'function') await origLoad();
      loadAll();
    };

    // if the push page is already open (admin landed on it), load now
    if (page.classList.contains('active')) loadAll();
  }

  function init() {
    // small delay so admin.html's own scripts have defined loadPushPage etc.
    setTimeout(inject, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
