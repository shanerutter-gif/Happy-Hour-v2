/* admin-activity.js
 * Injects a "📈 User Activity" tab into the admin portal — a GA-style,
 * adjustable dashboard over public.analytics_events (per-user backend event
 * capture; see js/db.js captureEvent + /api/track-event).
 *
 * Adjustable date range (Today / 7d / 30d / 90d / custom), KPI cards, an
 * events-over-time chart, top events, a switchable dimension breakdown, the
 * most-active users, and a per-user event timeline drill-down.
 *
 * All data comes from the ae_* RPCs, which are SECURITY DEFINER + gated by
 * is_giveaway_admin(), so only the admin can read even though they bypass RLS.
 * Mirrors the auth/refresh pattern in admin-attribution.js.
 */
(function () {
  'use strict';

  const SUPABASE_URL  = 'https://opcskuzbdfrlnyhraysk.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_M97B-GmwsRF6xPVahp_ytw_49nI9igs';
  const LS_KEY        = 'spotd-admin-session';

  // ── auth helpers (token refresh, mirroring admin-attribution.js) ──
  function session() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveSession(patch) {
    localStorage.setItem(LS_KEY, JSON.stringify({ ...session(), ...patch }));
  }
  function hdrs() {
    const s = session();
    return {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_ANON,
      'Authorization': 'Bearer ' + (s.token || SUPABASE_ANON),
    };
  }
  let _refreshInFlight = null;
  async function tryRefreshSession() {
    if (_refreshInFlight) return _refreshInFlight;
    const s = session();
    if (!s.refresh_token) return false;
    _refreshInFlight = (async () => {
      try {
        const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
          body:    JSON.stringify({ refresh_token: s.refresh_token }),
        });
        const data = await r.json();
        if (!r.ok || !data.access_token) {
          saveSession({ token: null, refresh_token: null, expires_at: null });
          return false;
        }
        saveSession({
          token:         data.access_token,
          refresh_token: data.refresh_token || s.refresh_token,
          expires_at:    data.expires_at    || null,
          user:          data.user || s.user,
        });
        return true;
      } catch (e) { return false; }
      finally { _refreshInFlight = null; }
    })();
    return _refreshInFlight;
  }
  function isJwtExpiredError(payload) {
    if (!payload) return false;
    const msg = (payload.message || payload.error || payload.code || '').toString().toLowerCase();
    return msg.includes('jwt expired') || msg.includes('jwt_expired') || payload.code === 'PGRST301';
  }
  async function rpc(name, body) {
    const send = () => fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: hdrs(), body: JSON.stringify(body || {}),
    });
    let r = await send();
    let text = await r.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if ((r.status === 401 || r.status === 403) && isJwtExpiredError(data)) {
      if (await tryRefreshSession()) {
        r = await send();
        text = await r.text();
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
      } else {
        throw new Error('Session expired — please refresh the page and sign in again.');
      }
    }
    if (!r.ok) throw new Error((data && (data.message || data.error)) || `HTTP ${r.status}`);
    return data;
  }

  // ── utils ──────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtNum(n) { return (n == null ? 0 : Number(n)).toLocaleString('en-US'); }
  function fmtDateTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' +
             d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch (e) { return ''; }
  }
  function relTime(iso) {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 0) return 'just now';
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.floor(h / 24);
    return d + 'd ago';
  }
  function prettyEvent(n) {
    return String(n || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  function fmtBucket(iso, bucket) {
    const d = new Date(iso);
    if (bucket === 'hour') return d.toLocaleTimeString('en-US', { hour: 'numeric' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function fmtDur(a, b) {
    const s = Math.max(0, Math.round((new Date(b) - new Date(a)) / 1000));
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ' + String(s % 60).padStart(2, '0') + 's';
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }
  function fmtDelta(a, b) {
    const s = Math.round((new Date(b) - new Date(a)) / 1000);
    if (s < 1) return '';
    if (s < 60) return '+' + s + 's';
    const m = Math.floor(s / 60);
    return '+' + m + 'm ' + String(s % 60).padStart(2, '0') + 's';
  }
  // AI answer engines get a robot badge — these referrals are the GEO signal.
  const AI_SOURCES = ['chatgpt.com', 'perplexity.ai', 'claude.ai', 'openai.com', 'gemini.google.com', 'copilot.microsoft.com', 'bing.com/chat'];
  function isAiSource(src) { return AI_SOURCES.some(a => (src || '').toLowerCase().includes(a)); }
  function sourceBadge(src) {
    const s = src || '(direct)';
    const ai = isAiSource(s);
    const search = /google|bing|duckduckgo|yahoo|baidu/.test(s);
    const bg = ai ? 'rgba(139,92,246,.14)' : search ? 'rgba(59,130,246,.12)' : s === '(direct)' ? 'var(--bg2)' : 'rgba(255,107,74,.12)';
    const fg = ai ? '#8B5CF6' : search ? '#3B82F6' : s === '(direct)' ? 'var(--muted)' : 'var(--coral)';
    return `<span style="display:inline-block;background:${bg};color:${fg};border-radius:999px;padding:2px 9px;font-size:11px;font-weight:700;white-space:nowrap">${ai ? '🤖 ' : ''}${esc(s)}</span>`;
  }

  // Switchable breakdown dimensions (event + a prop key to group by).
  const BREAKDOWNS = [
    { id: 'venue', label: 'Top venues opened',  event: 'venue_modal_opened',  prop: 'name' },
    { id: 'tab',   label: 'Tabs viewed',        event: 'tab_change',          prop: 'tab' },
    { id: 'city',  label: 'Cities entered',     event: 'city_entered',        prop: 'city_slug' },
    { id: 'blog',  label: 'Blog articles',      event: 'blog_article_opened', prop: 'url' },
    { id: 'auth',  label: 'Auth method clicks', event: 'auth_method_clicked', prop: 'method' },
    { id: 'plat',  label: 'Platform (all events)', event: '__all__',          prop: 'platform' },
  ];

  // Site-traffic breakdown dimensions (passed to ae_traffic_breakdown).
  const TRAFFIC_DIMS = [
    { id: 'source',   label: 'Top sources' },
    { id: 'referrer', label: 'Referrers' },
    { id: 'device',   label: 'Device' },
    { id: 'country',  label: 'Country' },
    { id: 'platform', label: 'Platform' },
  ];

  // ── state ──────────────────────────────────────────
  const state = {
    view: 'users',                 // 'users' | 'traffic'
    preset: '7d', customFrom: '', customTo: '', bucket: 'day',
    bdSel: 'venue', tdSel: 'source', surface: 'site', selUser: null,
    selSession: null, jFilter: 'all',
  };
  const data = {
    kpis: {}, series: [], topEvents: [], activeUsers: [],
    breakdown: [], userResults: [], timeline: [],
    tKpis: {}, tSeries: [], topPages: [], tBreakdown: [],
    journeys: [], journey: [],
  };

  function rangeBounds() {
    const now = new Date();
    let from, to = new Date(now.getTime() + 60000);
    if (state.preset === 'today')      { from = new Date(now); from.setHours(0, 0, 0, 0); }
    else if (state.preset === '7d')    { from = new Date(now.getTime() - 7 * 864e5); }
    else if (state.preset === '30d')   { from = new Date(now.getTime() - 30 * 864e5); }
    else if (state.preset === '90d')   { from = new Date(now.getTime() - 90 * 864e5); }
    else { // custom
      from = state.customFrom ? new Date(state.customFrom + 'T00:00:00') : new Date(now.getTime() - 7 * 864e5);
      to   = state.customTo   ? new Date(state.customTo   + 'T23:59:59') : to;
    }
    const spanDays = (to - from) / 864e5;
    return { from: from.toISOString(), to: to.toISOString(), bucket: spanDays <= 2 ? 'hour' : 'day' };
  }

  // ── data loads ─────────────────────────────────────
  function loadAll() { return state.view === 'traffic' ? loadTraffic() : loadUsers(); }

  async function loadUsers() {
    const { from, to, bucket } = rangeBounds();
    state.bucket = bucket;
    setLoading();
    try {
      const [k, ts, te, au] = await Promise.all([
        rpc('ae_kpis',         { p_from: from, p_to: to }),
        rpc('ae_timeseries',   { p_from: from, p_to: to, p_bucket: bucket }),
        rpc('ae_top_events',   { p_from: from, p_to: to, p_limit: 25 }),
        rpc('ae_active_users', { p_from: from, p_to: to, p_limit: 25 }),
      ]);
      data.kpis        = (k && typeof k === 'object') ? k : {};
      data.series      = Array.isArray(ts) ? ts : [];
      data.topEvents   = Array.isArray(te) ? te : [];
      data.activeUsers = Array.isArray(au) ? au : [];
      render();
      loadBreakdown();
    } catch (e) { showError(e); }
  }

  async function loadTraffic() {
    const { from, to, bucket } = rangeBounds();
    state.bucket = bucket;
    setLoading();
    try {
      const [k, ts, tp] = await Promise.all([
        rpc('ae_traffic_kpis',       { p_from: from, p_to: to, p_surface: state.surface }),
        rpc('ae_traffic_timeseries', { p_from: from, p_to: to, p_bucket: bucket, p_surface: state.surface }),
        rpc('ae_traffic_breakdown',  { p_dim: 'page', p_from: from, p_to: to, p_limit: 20, p_surface: state.surface }),
      ]);
      data.tKpis    = (k && typeof k === 'object') ? k : {};
      data.tSeries  = Array.isArray(ts) ? ts : [];
      data.topPages = Array.isArray(tp) ? tp : [];
      renderTraffic();
      loadTrafficBreakdown();
      loadJourneys();
    } catch (e) { showError(e); }
  }

  async function loadTrafficBreakdown() {
    const { from, to } = rangeBounds();
    try {
      const rows = await rpc('ae_traffic_breakdown', { p_dim: state.tdSel, p_from: from, p_to: to, p_limit: 15, p_surface: state.surface });
      data.tBreakdown = Array.isArray(rows) ? rows : [];
    } catch (e) { data.tBreakdown = []; }
    renderTrafficBreakdown();
  }

  async function loadJourneys() {
    const { from, to } = rangeBounds();
    try {
      const rows = await rpc('ae_recent_journeys', { p_from: from, p_to: to, p_surface: state.surface, p_limit: 60 });
      data.journeys = Array.isArray(rows) ? rows : [];
    } catch (e) { data.journeys = []; }
    renderJourneys();
  }

  async function selectJourney(sid) {
    state.selSession = sid;
    renderJourneys(); // re-highlight the picked row
    try {
      const rows = await rpc('ae_journey', { p_session: sid, p_limit: 300 });
      data.journey = Array.isArray(rows) ? rows : [];
    } catch (e) { data.journey = []; }
    renderJourneyPanel();
    document.getElementById('ae-journey-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function loadBreakdown() {
    const { from, to } = rangeBounds();
    const bd = BREAKDOWNS.find(b => b.id === state.bdSel) || BREAKDOWNS[0];
    try {
      // The "__all__" sentinel means "across every event" — pass a null event
      // so the RPC's event filter is skipped (handled below via a NULL p_event).
      const rows = await rpc('ae_breakdown', {
        p_event: bd.event === '__all__' ? null : bd.event,
        p_prop: bd.prop, p_from: from, p_to: to, p_limit: 15,
      });
      data.breakdown = Array.isArray(rows) ? rows : [];
    } catch (e) { data.breakdown = []; }
    renderBreakdown();
  }

  async function searchUsers(q) {
    try {
      const rows = await rpc('ae_user_search', { p_q: q || '', p_limit: 20 });
      data.userResults = Array.isArray(rows) ? rows : [];
    } catch (e) { data.userResults = []; }
    renderUserPanel();
  }

  async function selectUser(uid, name) {
    state.selUser = { id: uid, name: name };
    try {
      const rows = await rpc('ae_user_timeline', { p_user: uid, p_limit: 250 });
      data.timeline = Array.isArray(rows) ? rows : [];
    } catch (e) { data.timeline = []; }
    renderUserPanel();
    document.getElementById('ae-user-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── rendering ──────────────────────────────────────
  function setLoading() {
    const wrap = document.getElementById('activity-content');
    if (wrap) wrap.innerHTML = '<div style="padding:48px;text-align:center;color:var(--muted)">Loading activity…</div>';
  }
  function showError(e) {
    const wrap = document.getElementById('activity-content');
    if (wrap) wrap.innerHTML = `<div style="padding:24px;color:var(--coral);text-align:center">Error: ${esc(e.message || e)}</div>`;
  }

  function kpiCard(label, value, sub) {
    return `<div class="kpi-card" style="cursor:default;min-width:130px">
      <div class="kpi-label">${esc(label)}</div>
      <div class="kpi-value">${esc(value)}</div>
      ${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ''}
    </div>`;
  }

  // Full-width events-over-time chart. preserveAspectRatio="none" + non-scaling
  // strokes keeps lines crisp at any container width without distorting them.
  function chartSVG(rows, bucket) {
    if (!rows.length) {
      return '<div style="padding:48px;text-align:center;color:var(--muted)">No events in this range yet.</div>';
    }
    const W = 1000, H = 260, padL = 46, padR = 16, padT = 14, padB = 26;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const maxE = Math.max(1, ...rows.map(r => +r.events));
    const n = rows.length;
    const x = i => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const y = v => padT + innerH - (v / maxE) * innerH;
    const ptsE = rows.map((r, i) => `${x(i).toFixed(1)},${y(+r.events).toFixed(1)}`).join(' ');
    const ptsU = rows.map((r, i) => `${x(i).toFixed(1)},${y(+r.users).toFixed(1)}`).join(' ');
    const area = `${padL},${padT + innerH} ${ptsE} ${x(n - 1).toFixed(1)},${padT + innerH}`;
    const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
      const yy = (padT + innerH - f * innerH).toFixed(1);
      return `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="var(--border)" stroke-width="1" vector-effect="non-scaling-stroke"/>`
           + `<text x="${padL - 8}" y="${(+yy + 4)}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="DM Mono,monospace">${fmtNum(Math.round(maxE * f))}</text>`;
    }).join('');
    const step = Math.max(1, Math.ceil(n / 7));
    let xlabels = '';
    for (let i = 0; i < n; i += step) {
      xlabels += `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--muted)" font-family="DM Mono,monospace">${esc(fmtBucket(rows[i].bucket, bucket))}</text>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="260" preserveAspectRatio="none" style="display:block">
      <defs><linearGradient id="aeArea" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#FF6B4A" stop-opacity="0.30"/>
        <stop offset="100%" stop-color="#FF6B4A" stop-opacity="0"/>
      </linearGradient></defs>
      ${grid}
      <polygon points="${area}" fill="url(#aeArea)"/>
      <polyline points="${ptsU}" fill="none" stroke="#3B82F6" stroke-width="1.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>
      <polyline points="${ptsE}" fill="none" stroke="#FF6B4A" stroke-width="2.25" vector-effect="non-scaling-stroke"/>
      ${xlabels}
    </svg>`;
  }

  // Shared top bar: App Users / Site Traffic mode toggle + date range controls.
  function controlsBarHTML() {
    const presets = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days']];
    const modes = [['users', '👤 App Users'], ['traffic', '🌐 Site Traffic']];
    return `
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
        <div style="display:inline-flex;background:var(--bg2);border-radius:999px;padding:3px;gap:2px">
          ${modes.map(([id, lbl]) => `
            <button class="ae-mode" data-mode="${id}"
              style="padding:7px 14px;border-radius:999px;border:none;font-weight:700;font-size:13px;cursor:pointer;background:${state.view === id ? 'var(--coral)' : 'transparent'};color:${state.view === id ? '#fff' : 'var(--text)'}">${lbl}</button>`).join('')}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-left:8px">
          ${presets.map(([id, lbl]) => `
            <button class="ae-preset" data-preset="${id}"
              style="padding:7px 14px;border-radius:999px;border:1px solid var(--border);font-weight:600;font-size:13px;cursor:pointer;background:${state.preset === id ? 'var(--coral)' : 'var(--card)'};color:${state.preset === id ? '#fff' : 'var(--text)'}">${lbl}</button>`).join('')}
        </div>
        <div style="display:flex;gap:6px;align-items:center;margin-left:auto;flex-wrap:wrap">
          <input type="date" id="ae-from" value="${esc(state.customFrom)}" style="padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:13px">
          <span style="color:var(--muted);font-size:13px">→</span>
          <input type="date" id="ae-to" value="${esc(state.customTo)}" style="padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:13px">
          <button id="ae-refresh" style="padding:7px 14px;border-radius:999px;border:1px solid var(--border);background:var(--card);color:var(--text);font-weight:600;font-size:13px;cursor:pointer">↻ Refresh</button>
        </div>
      </div>`;
  }

  function render() {
    const wrap = document.getElementById('activity-content');
    if (!wrap) return;

    const k = data.kpis || {};
    const totalEvents = +k.total_events || 0;
    const uniqUsers   = +k.unique_users || 0;
    const perUser     = uniqUsers ? (totalEvents / uniqUsers).toFixed(1) : '0';

    const maxEvt = data.topEvents.reduce((m, r) => Math.max(m, +r.events || 0), 0);

    wrap.innerHTML = `
      ${controlsBarHTML()}

      <!-- KPI cards -->
      <div class="kpi-row" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px">
        ${kpiCard('Total events', fmtNum(totalEvents))}
        ${kpiCard('Active users', fmtNum(uniqUsers), 'signed-in')}
        ${kpiCard('Sessions', fmtNum(k.sessions))}
        ${kpiCard('Events / user', perUser)}
        ${kpiCard('Event types', fmtNum(k.event_types))}
        ${kpiCard('Guest events', fmtNum(k.guest_events))}
      </div>

      <!-- Chart -->
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:18px;overflow:hidden">
        <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Events over time</div>
          <div style="display:flex;gap:14px;font-size:12px;color:var(--muted)">
            <span><span style="display:inline-block;width:14px;height:3px;background:#FF6B4A;vertical-align:middle;border-radius:2px"></span> Events</span>
            <span><span style="display:inline-block;width:14px;height:0;border-top:2px dashed #3B82F6;vertical-align:middle"></span> Active users</span>
            <span style="font-family:'DM Mono',monospace">${state.bucket === 'hour' ? 'hourly' : 'daily'}</span>
          </div>
        </div>
        <div style="padding:14px 10px 6px">${chartSVG(data.series, state.bucket)}</div>
      </div>

      <!-- Top events + Breakdown -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-bottom:18px">
        <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden">
          <div style="padding:14px 16px;border-bottom:1px solid var(--border);font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Top events</div>
          <div style="padding:8px 16px 14px">
            ${data.topEvents.length === 0 ? `<div style="padding:18px;text-align:center;color:var(--muted)">No events yet.</div>` :
              data.topEvents.map(r => {
                const w = maxEvt > 0 ? Math.round((+r.events / maxEvt) * 100) : 0;
                return `<div style="padding:7px 0">
                  <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px">
                    <span style="font-weight:600">${esc(prettyEvent(r.event_name))}</span>
                    <span style="font-family:'DM Mono',monospace;color:var(--muted)"><strong style="color:var(--text)">${fmtNum(r.events)}</strong> · ${fmtNum(r.users)}u</span>
                  </div>
                  <div style="background:var(--bg2);border-radius:5px;height:8px;overflow:hidden"><div style="background:linear-gradient(90deg,#FF6B4A,#E8943A);height:100%;width:${w}%;border-radius:5px"></div></div>
                </div>`;
              }).join('')}
          </div>
        </div>

        <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden">
          <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Breakdown</span>
            <select id="ae-bd-select" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:13px;font-weight:600;cursor:pointer">
              ${BREAKDOWNS.map(b => `<option value="${b.id}"${b.id === state.bdSel ? ' selected' : ''}>${esc(b.label)}</option>`).join('')}
            </select>
          </div>
          <div id="ae-breakdown-body" style="padding:8px 16px 14px"></div>
        </div>
      </div>

      <!-- Most active users -->
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:18px">
        <div style="padding:14px 16px;border-bottom:1px solid var(--border)">
          <div style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Most active users</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">In the selected range — click a row to see their full timeline</div>
        </div>
        ${data.activeUsers.length === 0 ? `<div style="padding:24px;text-align:center;color:var(--muted)">No signed-in activity in this range.</div>` : `
        <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead><tr style="background:var(--bg2);text-align:left">
            <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.5px">User</th>
            <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Email</th>
            <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;text-align:right">Events</th>
            <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Last seen</th>
          </tr></thead>
          <tbody>
            ${data.activeUsers.map(u => `
              <tr class="ae-user-row" data-uid="${esc(u.user_id)}" data-name="${esc(u.display_name || u.email || 'User')}" style="border-bottom:1px solid var(--border);cursor:pointer">
                <td style="padding:10px 12px;font-weight:600">${esc(u.display_name || '(no name)')}</td>
                <td style="padding:10px 12px;color:var(--muted);font-size:13px">${esc(u.email || '—')}</td>
                <td style="padding:10px 12px;text-align:right;font-family:'DM Mono',monospace"><strong>${fmtNum(u.events)}</strong></td>
                <td style="padding:10px 12px;color:var(--muted);font-size:13px;white-space:nowrap">${esc(relTime(u.last_event))}</td>
              </tr>`).join('')}
          </tbody>
        </table></div>`}
      </div>

      <!-- Per-user drill-down -->
      <div id="ae-user-panel" style="background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden"></div>
    `;

    renderBreakdown();
    renderUserPanel();
    wireControls();
  }

  function renderBreakdown() {
    const body = document.getElementById('ae-breakdown-body');
    if (!body) return;
    const rows = data.breakdown || [];
    const max = rows.reduce((m, r) => Math.max(m, +r.events || 0), 0);
    body.innerHTML = rows.length === 0
      ? `<div style="padding:18px;text-align:center;color:var(--muted)">No data for this dimension yet.</div>`
      : rows.map(r => {
          const w = max > 0 ? Math.round((+r.events / max) * 100) : 0;
          return `<div style="padding:7px 0">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px;gap:10px">
              <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.value)}</span>
              <span style="font-family:'DM Mono',monospace;color:var(--text)"><strong>${fmtNum(r.events)}</strong></span>
            </div>
            <div style="background:var(--bg2);border-radius:5px;height:8px;overflow:hidden"><div style="background:linear-gradient(90deg,#3B82F6,#60A5FA);height:100%;width:${w}%;border-radius:5px"></div></div>
          </div>`;
        }).join('');
  }

  function propsChips(props) {
    if (!props || typeof props !== 'object') return '';
    const skip = new Set(['platform']);
    const parts = [];
    for (const key of Object.keys(props)) {
      if (skip.has(key)) continue;
      let v = props[key];
      if (v == null || v === '') continue;
      v = String(v);
      if (v.length > 42) v = v.slice(0, 42) + '…';
      parts.push(`<span style="background:var(--bg2);border-radius:6px;padding:1px 7px;font-size:11px;color:var(--muted);font-family:'DM Mono',monospace">${esc(key)}: ${esc(v)}</span>`);
      if (parts.length >= 4) break;
    }
    return parts.join(' ');
  }

  function renderUserPanel() {
    const panel = document.getElementById('ae-user-panel');
    if (!panel) return;
    const sel = state.selUser;
    const tl = data.timeline || [];
    const results = data.userResults || [];

    panel.innerHTML = `
      <div style="padding:14px 16px;border-bottom:1px solid var(--border)">
        <div style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Per-user timeline</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">Search a user, or click one above, to replay their actions</div>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <input id="ae-user-search" placeholder="Search name or email…" value=""
            style="flex:1;min-width:200px;padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:14px">
          <button id="ae-user-search-btn" style="padding:8px 16px;border-radius:8px;border:none;background:var(--coral);color:#fff;font-weight:600;font-size:14px;cursor:pointer">Search</button>
        </div>
        ${results.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">
          ${results.map(u => `<button class="ae-user-pick" data-uid="${esc(u.user_id)}" data-name="${esc(u.display_name || u.email || 'User')}"
              style="padding:5px 10px;border-radius:999px;border:1px solid var(--border);background:${sel && sel.id === u.user_id ? 'var(--coral)' : 'var(--card)'};color:${sel && sel.id === u.user_id ? '#fff' : 'var(--text)'};font-size:12px;cursor:pointer">
              ${esc(u.display_name || u.email || 'User')} <span style="opacity:.7">· ${fmtNum(u.events)}</span></button>`).join('')}
        </div>` : ''}
      </div>
      ${!sel ? `<div style="padding:28px;text-align:center;color:var(--muted)">No user selected.</div>` : `
        <div style="padding:12px 16px;border-bottom:1px solid var(--border);font-size:13px">
          <strong>${esc(sel.name)}</strong> <span style="color:var(--muted)">· ${fmtNum(tl.length)} recent events</span>
        </div>
        ${tl.length === 0 ? `<div style="padding:24px;text-align:center;color:var(--muted)">No events captured for this user yet.</div>` : `
        <div style="max-height:520px;overflow-y:auto">
          ${tl.map(ev => `
            <div style="display:flex;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border)">
              <div style="width:120px;flex-shrink:0;font-family:'DM Mono',monospace;font-size:12px;color:var(--muted)">${esc(fmtDateTime(ev.created_at))}</div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:14px">${esc(prettyEvent(ev.event_name))}
                  ${ev.platform ? `<span style="font-size:11px;color:var(--muted);font-weight:400">· ${esc(ev.platform)}</span>` : ''}
                </div>
                ${propsChips(ev.props) ? `<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:5px">${propsChips(ev.props)}</div>` : ''}
              </div>
            </div>`).join('')}
        </div>`}`}
    `;

    // wire per-user panel controls
    const inp = document.getElementById('ae-user-search');
    const btn = document.getElementById('ae-user-search-btn');
    const go = () => searchUsers((inp && inp.value || '').trim());
    if (btn) btn.addEventListener('click', go);
    if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    panel.querySelectorAll('.ae-user-pick').forEach(b => {
      b.addEventListener('click', () => selectUser(b.dataset.uid, b.dataset.name));
    });
  }

  function wireShared() {
    const wrap = document.getElementById('activity-content');
    if (!wrap) return;
    wrap.querySelectorAll('.ae-mode').forEach(b => {
      b.addEventListener('click', () => {
        if (state.view === b.dataset.mode) return;
        state.view = b.dataset.mode;
        loadAll();
      });
    });
    wrap.querySelectorAll('.ae-preset').forEach(b => {
      b.addEventListener('click', () => {
        state.preset = b.dataset.preset;
        state.customFrom = ''; state.customTo = '';
        loadAll();
      });
    });
    const from = document.getElementById('ae-from');
    const to   = document.getElementById('ae-to');
    const onCustom = () => {
      state.customFrom = from ? from.value : '';
      state.customTo   = to ? to.value : '';
      if (state.customFrom || state.customTo) { state.preset = 'custom'; loadAll(); }
    };
    if (from) from.addEventListener('change', onCustom);
    if (to)   to.addEventListener('change', onCustom);
    document.getElementById('ae-refresh')?.addEventListener('click', loadAll);
  }

  function wireControls() {
    wireShared();
    document.getElementById('ae-bd-select')?.addEventListener('change', e => {
      state.bdSel = e.target.value;
      loadBreakdown();
    });
    document.querySelectorAll('#activity-content .ae-user-row').forEach(r => {
      r.addEventListener('click', () => selectUser(r.dataset.uid, r.dataset.name));
    });
  }

  function wireTraffic() {
    wireShared();
    document.querySelectorAll('#activity-content .ae-surface').forEach(b => {
      b.addEventListener('click', () => {
        if (state.surface === b.dataset.surface) return;
        state.surface = b.dataset.surface;
        loadTraffic();
      });
    });
    document.getElementById('ae-td-select')?.addEventListener('change', e => {
      state.tdSel = e.target.value;
      loadTrafficBreakdown();
    });
  }

  // ── Site Traffic view ──────────────────────────────
  function renderTraffic() {
    const wrap = document.getElementById('activity-content');
    if (!wrap) return;
    const k = data.tKpis || {};
    const pageviews = +k.pageviews || 0;
    const visitors  = +k.visitors || 0;
    const signups   = +k.signups || 0;
    const conv = visitors ? ((signups / visitors) * 100).toFixed(1) + '%' : '0%';
    const maxPv = data.topPages.reduce((m, r) => Math.max(m, +r.pageviews || 0), 0);
    // Reuse chartSVG by mapping pageviews→events, visitors→users.
    const chartRows = data.tSeries.map(r => ({ bucket: r.bucket, events: r.pageviews, users: r.visitors }));

    const surfaces = [['site', 'Website'], ['app', 'App'], ['all', 'All']];

    wrap.innerHTML = `
      ${controlsBarHTML()}

      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px">
        <span style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:700">Source</span>
        <div style="display:inline-flex;background:var(--bg2);border-radius:999px;padding:3px;gap:2px">
          ${surfaces.map(([id, lbl]) => `
            <button class="ae-surface" data-surface="${id}"
              style="padding:6px 16px;border-radius:999px;border:none;font-weight:600;font-size:13px;cursor:pointer;background:${state.surface === id ? 'var(--coral)' : 'transparent'};color:${state.surface === id ? '#fff' : 'var(--text)'}">${lbl}</button>`).join('')}
        </div>
        <span style="font-size:12px;color:var(--muted)">${state.surface === 'site' ? 'Public website pages only (the app shell is excluded)' : state.surface === 'app' ? 'The web + iOS app only' : 'Website + app combined'}</span>
      </div>

      <div class="kpi-row" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px">
        ${kpiCard('Pageviews', fmtNum(pageviews))}
        ${kpiCard('Sessions', fmtNum(k.sessions))}
        ${kpiCard('Visitors', fmtNum(visitors), 'unique')}
        ${kpiCard('Signed-in', fmtNum(k.signed_in_users))}
        ${kpiCard('Signups', fmtNum(signups))}
        ${kpiCard('Conversion', conv, 'signups / visitors')}
      </div>

      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:18px;overflow:hidden">
        <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Traffic over time</div>
          <div style="display:flex;gap:14px;font-size:12px;color:var(--muted)">
            <span><span style="display:inline-block;width:14px;height:3px;background:#FF6B4A;vertical-align:middle;border-radius:2px"></span> Pageviews</span>
            <span><span style="display:inline-block;width:14px;height:0;border-top:2px dashed #3B82F6;vertical-align:middle"></span> Visitors</span>
            <span style="font-family:'DM Mono',monospace">${state.bucket === 'hour' ? 'hourly' : 'daily'}</span>
          </div>
        </div>
        <div style="padding:14px 10px 6px">${chartSVG(chartRows, state.bucket)}</div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px">
        <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden">
          <div style="padding:14px 16px;border-bottom:1px solid var(--border);font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Top pages</div>
          <div style="padding:8px 16px 14px">
            ${data.topPages.length === 0 ? `<div style="padding:18px;text-align:center;color:var(--muted)">No pageviews yet.</div>` :
              data.topPages.map(r => {
                const w = maxPv > 0 ? Math.round((+r.pageviews / maxPv) * 100) : 0;
                return `<div style="padding:7px 0">
                  <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px;gap:10px">
                    <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.value)}</span>
                    <span style="font-family:'DM Mono',monospace;color:var(--muted)"><strong style="color:var(--text)">${fmtNum(r.pageviews)}</strong> · ${fmtNum(r.sessions)}s</span>
                  </div>
                  <div style="background:var(--bg2);border-radius:5px;height:8px;overflow:hidden"><div style="background:linear-gradient(90deg,#FF6B4A,#E8943A);height:100%;width:${w}%;border-radius:5px"></div></div>
                </div>`;
              }).join('')}
          </div>
        </div>

        <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden">
          <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Breakdown</span>
            <select id="ae-td-select" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:13px;font-weight:600;cursor:pointer">
              ${TRAFFIC_DIMS.map(d => `<option value="${d.id}"${d.id === state.tdSel ? ' selected' : ''}>${esc(d.label)}</option>`).join('')}
            </select>
          </div>
          <div id="ae-tbreakdown-body" style="padding:8px 16px 14px"></div>
        </div>
      </div>

      <!-- Visitor journeys: recent sessions → click one to replay it step by step -->
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-top:18px">
        <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div>
            <div style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Visitor journeys</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px">Recent sessions — click one to replay it step by step (source → pages → outbound)</div>
          </div>
          <select id="ae-j-filter" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:13px;font-weight:600;cursor:pointer"></select>
        </div>
        <div id="ae-journeys-body"></div>
      </div>

      <!-- Step-by-step replay of the selected session -->
      <div id="ae-journey-panel" style="margin-top:18px"></div>
    `;

    renderTrafficBreakdown();
    renderJourneys();
    renderJourneyPanel();
    wireTraffic();
  }

  function renderJourneys() {
    const body = document.getElementById('ae-journeys-body');
    const filterSel = document.getElementById('ae-j-filter');
    if (!body) return;
    const all = data.journeys || [];

    // Source filter options rebuilt from the loaded rows (AI sources pinned first).
    if (filterSel) {
      const srcs = [...new Set(all.map(j => j.source || '(direct)'))]
        .sort((a, b) => (isAiSource(b) - isAiSource(a)) || a.localeCompare(b));
      filterSel.innerHTML = `<option value="all">All sources (${all.length})</option>` +
        srcs.map(s => `<option value="${esc(s)}"${state.jFilter === s ? ' selected' : ''}>${isAiSource(s) ? '🤖 ' : ''}${esc(s)}</option>`).join('');
      if (state.jFilter !== 'all' && !srcs.includes(state.jFilter)) state.jFilter = 'all';
      filterSel.value = state.jFilter;
      filterSel.onchange = () => { state.jFilter = filterSel.value; renderJourneys(); };
    }

    const rows = state.jFilter === 'all' ? all : all.filter(j => (j.source || '(direct)') === state.jFilter);
    if (rows.length === 0) {
      body.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted)">No visits in this range yet.</div>`;
      return;
    }
    body.innerHTML = `
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:var(--bg2);text-align:left">
          <th style="padding:9px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap">When</th>
          <th style="padding:9px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Source</th>
          <th style="padding:9px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Entry page</th>
          <th style="padding:9px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;text-align:right">Pages</th>
          <th style="padding:9px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;text-align:right">Time</th>
          <th style="padding:9px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Visitor</th>
          <th style="padding:9px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.5px"></th>
        </tr></thead>
        <tbody>
          ${rows.map(j => {
            const sel = state.selSession === j.session_id;
            const dur = j.pageviews > 1 || j.events > 1 ? fmtDur(j.started_at, j.ended_at) : '—';
            const who = j.display_name ? `<strong>${esc(j.display_name)}</strong>`
              : `${esc(j.device || '?')} · ${esc(j.country || '?')}`;
            const flags = [
              +j.outbound_clicks > 0 ? `<span title="Clicked out to a venue site">↗ ${j.outbound_clicks}</span>` : '',
              j.signed_up ? `<span title="This visitor signed up" style="color:var(--coral)">✨</span>` : '',
            ].filter(Boolean).join(' ');
            return `<tr class="ae-j-row" data-sid="${esc(j.session_id)}"
              style="border-bottom:1px solid var(--border);cursor:pointer;${sel ? 'background:rgba(255,107,74,.07)' : ''}">
              <td style="padding:9px 12px;white-space:nowrap;color:var(--muted)">${esc(relTime(j.started_at))}</td>
              <td style="padding:9px 12px">${sourceBadge(j.source)}</td>
              <td style="padding:9px 12px;font-family:'DM Mono',monospace;font-size:12px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(j.entry_path || '—')}</td>
              <td style="padding:9px 12px;text-align:right;font-family:'DM Mono',monospace"><strong>${fmtNum(j.pageviews)}</strong></td>
              <td style="padding:9px 12px;text-align:right;font-family:'DM Mono',monospace;color:var(--muted)">${esc(dur)}</td>
              <td style="padding:9px 12px;font-size:12px;color:var(--muted);white-space:nowrap">${who}</td>
              <td style="padding:9px 12px;font-size:12px;white-space:nowrap">${flags}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>`;
    body.querySelectorAll('.ae-j-row').forEach(r => {
      r.addEventListener('click', () => selectJourney(r.dataset.sid));
    });
  }

  // Icons + labels per event type in the replay.
  function journeyStep(ev) {
    const n = ev.event_name || '';
    const p = ev.props || {};
    if (n === 'page_view')      return { icon: '📄', label: ev.path || '/', sub: p.title || '' };
    if (n === 'outbound_click') return { icon: '↗',  label: 'Outbound click', sub: p.href || '' };
    if (n === 'cta_click')      return { icon: '👆', label: 'CTA: ' + (p.label || ''), sub: ev.path || '' };
    if (/signup|login/.test(n)) return { icon: '✨', label: prettyEvent(n), sub: '' };
    return { icon: '·', label: prettyEvent(n), sub: ev.path || '' };
  }

  function renderJourneyPanel() {
    const panel = document.getElementById('ae-journey-panel');
    if (!panel) return;
    if (!state.selSession) { panel.innerHTML = ''; return; }
    const meta = (data.journeys || []).find(j => j.session_id === state.selSession);
    const tl = data.journey || [];
    const src = meta ? (meta.source || '(direct)') : '';
    const arrived = meta && meta.referrer
      ? `Arrived from <strong>${esc(src)}</strong> <span style="color:var(--muted);font-family:'DM Mono',monospace;font-size:11px;word-break:break-all">(${esc(meta.referrer)})</span>`
      : `Arrived ${src === '(direct)' ? 'directly (no referrer)' : 'from <strong>' + esc(src) + '</strong>'}`;

    panel.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden">
        <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
          <div>
            <div style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Journey replay ${meta && isAiSource(src) ? '🤖' : ''}</div>
            <div style="font-size:13px;margin-top:4px">${arrived}</div>
            ${meta ? `<div style="font-size:12px;color:var(--muted);margin-top:3px">
              ${esc(fmtDateTime(meta.started_at))} · ${esc(meta.device || '?')} · ${esc(meta.country || '?')}
              · ${fmtNum(meta.pageviews)} pages in ${esc(fmtDur(meta.started_at, meta.ended_at))}
              ${meta.display_name ? ` · became <strong style="color:var(--text)">${esc(meta.display_name)}</strong>` : meta.signed_up ? ' · ✨ later signed up' : ''}
            </div>` : ''}
          </div>
          <button id="ae-j-close" style="padding:5px 12px;border-radius:999px;border:1px solid var(--border);background:var(--card);color:var(--muted);font-size:12px;cursor:pointer">✕ Close</button>
        </div>
        ${tl.length === 0 ? `<div style="padding:24px;text-align:center;color:var(--muted)">Loading journey…</div>` : `
        <div style="padding:8px 0;max-height:480px;overflow-y:auto">
          ${tl.map((ev, i) => {
            const st = journeyStep(ev);
            const delta = i > 0 ? fmtDelta(tl[i - 1].created_at, ev.created_at) : '';
            return `<div style="display:flex;gap:12px;padding:9px 16px;${i < tl.length - 1 ? 'border-bottom:1px dashed var(--border);' : ''}">
              <div style="width:84px;flex-shrink:0;text-align:right;font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);padding-top:2px">
                ${i === 0 ? esc(new Date(ev.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })) : esc(delta)}
              </div>
              <div style="width:26px;flex-shrink:0;text-align:center;font-size:15px">${st.icon}</div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:13px;font-family:${ev.event_name === 'page_view' ? "'DM Mono',monospace" : 'inherit'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(st.label)}</div>
                ${st.sub ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(st.sub)}</div>` : ''}
              </div>
            </div>`;
          }).join('')}
        </div>`}
      </div>`;
    document.getElementById('ae-j-close')?.addEventListener('click', () => {
      state.selSession = null; data.journey = [];
      renderJourneyPanel(); renderJourneys();
    });
  }

  function renderTrafficBreakdown() {
    const body = document.getElementById('ae-tbreakdown-body');
    if (!body) return;
    const rows = data.tBreakdown || [];
    const max = rows.reduce((m, r) => Math.max(m, +r.pageviews || 0), 0);
    body.innerHTML = rows.length === 0
      ? `<div style="padding:18px;text-align:center;color:var(--muted)">No data for this dimension yet.</div>`
      : rows.map(r => {
          const w = max > 0 ? Math.round((+r.pageviews / max) * 100) : 0;
          return `<div style="padding:7px 0">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px;gap:10px">
              <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.value)}</span>
              <span style="font-family:'DM Mono',monospace;color:var(--text)"><strong>${fmtNum(r.pageviews)}</strong> <span style="color:var(--muted)">· ${fmtNum(r.sessions)}s</span></span>
            </div>
            <div style="background:var(--bg2);border-radius:5px;height:8px;overflow:hidden"><div style="background:linear-gradient(90deg,#3B82F6,#60A5FA);height:100%;width:${w}%;border-radius:5px"></div></div>
          </div>`;
        }).join('');
  }

  // ── navigation ─────────────────────────────────────
  // Consolidated into the "Users" hub — Activity is reached via the hub tab bar,
  // so it no longer owns a standalone sidebar/drawer nav item. It lights up the
  // parent "Users" nav instead.
  function switchTo() {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.drawer-item').forEach(i => i.classList.remove('active'));
    document.getElementById('page-activity')?.classList.add('active');
    document.getElementById('nav-users')?.classList.add('active');
    document.getElementById('mob-nav-users')?.classList.add('active');
    const title = document.getElementById('mobilePageTitle');
    if (title) title.textContent = 'Users';
    window.scrollTo(0, 0);
    loadAll();
  }
  // Expose so the Users-hub tab bar (in admin.html) can open this view.
  window.showActivityPage = switchTo;

  // ── DOM injection ──────────────────────────────────
  function inject() {
    // Page only — navigation lives in the Users hub tab bar.
    const main = document.querySelector('.main-content');
    if (main && !document.getElementById('page-activity')) {
      const page = document.createElement('div');
      page.className = 'page';
      page.id = 'page-activity';
      page.innerHTML = `
        <div class="page-title">Users</div>
        <div class="page-sub">
          Our own in-house analytics. <strong>App Users</strong> = per-user actions
          (tab changes, venue opens, searches, auth…). <strong>Site Traffic</strong> =
          everyone who reaches any page (venue/blog/landing) across desktop + mobile —
          pageviews, sources, devices, geography, conversions. Adjust the date range, switch modes, drill into any user.
        </div>
        <div class="hub-tabs">
          <button class="hub-tab" onclick="showPage('users')">📊 Overview</button>
          <button class="hub-tab active" onclick="window.showActivityPage&&window.showActivityPage()">📈 Activity</button>
          <button class="hub-tab" onclick="showPage('churn')">📉 Churn</button>
        </div>
        <div id="activity-content"></div>
      `;
      main.appendChild(page);
    }
  }

  function init() { setTimeout(inject, 250); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
