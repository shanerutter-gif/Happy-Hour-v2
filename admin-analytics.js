/* admin-analytics.js
 * Injects a "🌐 Traffic Analytics" section into the admin portal — a dedicated,
 * trust-first analytics section over the ae_traffic_* RPCs (no more
 * devtools-console RPCs for headline traffic numbers).
 *
 * Panels (v1, roadmap item 13 — spec: hidden_files/priya-analytics-ui-spec-2026-09-29.md):
 *   E  Data-health banner  — rollup freshness, bot-skew flag, standing caveats.
 *   A  Traffic KPIs        — pageviews / sessions / visitors / signed-in / signups
 *                            / conversion, each with WoW delta vs the prior window.
 *   B  Timeseries          — pageviews + sessions per bucket, with a
 *                            "hide likely-bot days" toggle (day-level heuristic,
 *                            threshold labeled in-UI; v2 gets per-visitor scoring).
 *   C  Breakdowns          — top pages / sources / referrers / device / country /
 *                            platform via ae_traffic_breakdown + dimension select.
 *   D  Signup & activation — signups/day from profiles.created_at and
 *                            check-ins/day from check_ins.created_at (DB ground
 *                            truth, overlaid on the traffic shape) + inline
 *                            attribution summary reusing the Attribution RPCs.
 *
 * Read-only. Reuses the signed-in admin's user JWT + anon key (same pattern as
 * admin-activity.js / admin-attribution.js). Zero new tables, zero new RPCs,
 * zero schema changes. Failed reads render a SUSPECT chip — never zeros.
 *
 * Registered in api/admin-page.js SCRIPT_TAGS. Served from GitHub main at
 * request time, so the section appears as soon as the commit lands.
 */
(function () {
  'use strict';

  const SUPABASE_URL  = 'https://opcskuzbdfrlnyhraysk.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_M97B-GmwsRF6xPVahp_ytw_49nI9igs';
  const LS_KEY        = 'spotd-admin-session';

  // ── auth helpers (verbatim pattern from admin-activity.js) ──
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
  // Read-only PostgREST GET for table reads (profiles, check_ins, analytics_daily,
  // analytics_events). Same admin-JWT auth; one refresh retry on JWT expiry.
  async function pg(path, extraHeaders) {
    const send = () => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { ...hdrs(), ...(extraHeaders || {}) },
    });
    let r = await send();
    if ((r.status === 401 || r.status === 403)) {
      let data; try { data = await r.clone().json(); } catch (e) { data = null; }
      if (isJwtExpiredError(data) && await tryRefreshSession()) r = await send();
    }
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { const d = await r.json(); msg = d.message || d.error || msg; } catch (e) {}
      throw new Error(msg);
    }
    return r;
  }

  // ── utils ──────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtNum(n) { return (n == null ? 0 : Number(n)).toLocaleString('en-US'); }
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
  function fmtBucket(iso, bucket) {
    const d = new Date(iso);
    if (bucket === 'hour') return d.toLocaleTimeString('en-US', { hour: 'numeric' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function deltaHTML(cur, prev) {
    if (prev == null || +prev === 0) return '<span style="color:var(--muted)">—</span>';
    const pct = ((+cur - +prev) / +prev) * 100;
    if (Math.abs(pct) < 0.05) return '<span style="color:var(--muted)">±0%</span>';
    const up = pct > 0;
    return `<span style="color:${up ? '#22C55E' : 'var(--coral)'};font-weight:700">${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%</span>`;
  }
  // Duplicated from admin-attribution.js: the IIFE scopes its map, so the
  // strip re-declares it rather than reaching across. One static map, no logic.
  const SOURCE_LABELS = {
    instagram: '📸 Instagram', tiktok: '🎵 TikTok', twitter: '𝕏 X / Twitter',
    facebook: '📘 Facebook', google: '🔎 Google search', email: '📧 Email / Newsletter',
    reddit: '👽 Reddit', podcast: '🎙️ Podcast', press: '📰 Press / blog',
    event: '🎟️ In-person event', app_store: '📱 App Store', friend: '🫶 A cool friend',
    other: '✨ Somewhere else',
  };
  const sourceLabel = (s) => SOURCE_LABELS[s] || esc(s || 'unknown');

  // ── state ──────────────────────────────────────────
  const state = {
    preset: '7d', customFrom: '', customTo: '', surface: 'site',
    tdSel: 'source', hideBots: false,
  };
  // Per-panel health: { status: 'fresh'|'stale'|'suspect'|'loading', at: iso, note }
  const health = {
    rollup: { status: 'loading', at: null, note: '' },
    bot:    { status: 'loading', at: null, note: '' },
    kpis:   { status: 'loading', at: null, note: '' },
    series: { status: 'loading', at: null, note: '' },
    break:  { status: 'loading', at: null, note: '' },
    funnel: { status: 'loading', at: null, note: '' },
    attr:   { status: 'loading', at: null, note: '' },
  };
  const data = {
    kpis: {}, kpisPrev: {}, series: [], breakdown: [],
    funnel: [],            // [{bucket, signups, checkins}]
    botDays: 0,           // count of likely-bot days in the window
    attrCoverage: null, attrTop: [],
    parity: [],           // [{panel, rpc, params}] — reviewer parity gate
  };
  const BOT_PV_PER_VISITOR = 25; // day-level bot heuristic threshold (labeled in-UI)

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

  function mark(key, status, note) {
    health[key] = { status, at: new Date().toISOString(), note: note || '' };
  }

  function chip(key, label) {
    const h = health[key] || { status: 'loading' };
    const map = {
      loading: ['#9CA3AF', '⏳'],
      fresh:   ['#22C55E', '●'],
      stale:   ['#F59E0B', '●'],
      suspect: ['#EF4444', '●'],
    };
    const [color, dot] = map[h.status] || map.loading;
    const words = { loading: 'LOADING', fresh: 'FRESH', stale: 'STALE', suspect: 'SUSPECT' };
    const title = `Last refreshed: ${h.at ? relTime(h.at) : '—'}${h.note ? ' — ' + h.note : ''}`;
    return `<span title="${esc(title)}" style="display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:800;letter-spacing:.6px;color:${color};background:rgba(0,0,0,.04);border:1px solid var(--border);border-radius:999px;padding:3px 10px;white-space:nowrap">${dot} ${words[h.status] || h.status}${label ? ' · ' + esc(label) : ''}</span>`;
  }

  // ── data loads ─────────────────────────────────────
  async function loadAll() {
    setLoading();
    await Promise.allSettled([
      loadHealth(),
      loadKpis(),
      loadSeries(),
      loadPages(),
      loadBreakdown(),
      loadFunnel(),
      loadAttribution(),
    ]);
    render();
  }

  // Panel E — data health. Rollup freshness + today's bot-skew.
  async function loadHealth() {
    try {
      const r = await pg('analytics_daily?select=day,updated_at&order=day.desc&limit=1');
      const rows = await r.json();
      const latest = rows && rows[0];
      if (!latest) {
        mark('rollup', 'suspect', 'analytics_daily is empty — rollup may not have run yet');
      } else {
        const ageH = (Date.now() - new Date(latest.updated_at).getTime()) / 36e5;
        mark('rollup', ageH > 30 ? 'stale' : 'fresh', `rolled through ${latest.day}, updated ${relTime(latest.updated_at)}`);
      }
    } catch (e) { mark('rollup', 'suspect', 'read failed: ' + e.message); }

    try {
      // Today's pageviews, one row per view — count exact so we know if we hit the cap.
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const r = await pg(
        `analytics_events?select=visitor_id&event_name=eq.page_view&created_at=gte.${today.toISOString()}&limit=5000`,
        { 'Prefer': 'count=exact' }
      );
      const rows = await r.json();
      const totalHdr = r.headers.get('content-range');
      const total = totalHdr && totalHdr.split('/')[1] ? +totalHdr.split('/')[1] : rows.length;
      if (rows.length === 0) { mark('bot', 'fresh', 'no pageviews today yet'); return; }
      const byVisitor = {};
      rows.forEach(x => { const v = x.visitor_id || '(unknown)'; byVisitor[v] = (byVisitor[v] || 0) + 1; });
      const top = Math.max(...Object.values(byVisitor));
      const share = total > 0 ? (top / total) * 100 : 0;
      const sampled = total > rows.length;
      const note = `top visitor: ${fmtNum(top)} of ${fmtNum(total)} views (${share.toFixed(0)}%)${sampled ? ' — sampled from 5,000' : ''}`;
      mark('bot', share > 50 ? 'suspect' : 'fresh', note);
    } catch (e) { mark('bot', 'suspect', 'bot-skew check failed: ' + e.message); }
  }

  // Panel A — KPIs + prior-window KPIs for WoW deltas.
  async function loadKpis() {
    const { from, to } = rangeBounds();
    const span = new Date(to) - new Date(from);
    const pTo = new Date(from).toISOString();
    const pFrom = new Date(new Date(from) - span).toISOString();
    try {
      const params = { p_from: from, p_to: to, p_surface: state.surface };
      const [k, kp] = await Promise.all([
        rpc('ae_traffic_kpis', params),
        rpc('ae_traffic_kpis', { p_from: pFrom, p_to: pTo, p_surface: state.surface }),
      ]);
      data.kpis = (k && typeof k === 'object') ? k : {};
      data.kpisPrev = (kp && typeof kp === 'object') ? kp : {};
      data.parity.push({ panel: 'A (KPIs)', rpc: 'ae_traffic_kpis', params });
      mark('kpis', 'fresh', '');
    } catch (e) { mark('kpis', 'suspect', e.message); }
  }

  // Panel B — timeseries; flags likely-bot days (pageviews/visitor ratio).
  async function loadSeries() {
    const { from, to, bucket } = rangeBounds();
    state.bucket = bucket;
    try {
      const params = { p_from: from, p_to: to, p_bucket: bucket, p_surface: state.surface };
      const ts = await rpc('ae_traffic_timeseries', params);
      data.series = Array.isArray(ts) ? ts : [];
      data.botDays = data.series.filter(r => (+r.visitors || 0) > 0 && (+r.pageviews / +r.visitors) > BOT_PV_PER_VISITOR).length;
      data.parity.push({ panel: 'B (timeseries)', rpc: 'ae_traffic_timeseries', params });
      mark('series', data.series.length ? 'fresh' : 'stale', data.series.length ? `${data.series.length} buckets` : 'no rows in range');
    } catch (e) { mark('series', 'suspect', e.message); }
  }

  // Panel C (top pages) — same RPC, p_dim:'page'.
  async function loadPages() {
    const { from, to } = rangeBounds();
    try {
      const rows = await rpc('ae_traffic_breakdown', { p_dim: 'page', p_from: from, p_to: to, p_limit: 20, p_surface: state.surface });
      data.pages = Array.isArray(rows) ? rows : [];
    } catch (e) { data.pages = []; }
    renderPages();
  }

  // Panel C — switchable dimension breakdown.
  async function loadBreakdown() {
    const { from, to } = rangeBounds();
    try {
      const params = { p_dim: state.tdSel, p_from: from, p_to: to, p_limit: 15, p_surface: state.surface };
      const rows = await rpc('ae_traffic_breakdown', params);
      data.breakdown = Array.isArray(rows) ? rows : [];
      data.parity.push({ panel: 'C (breakdown)', rpc: 'ae_traffic_breakdown', params });
      mark('break', data.breakdown.length ? 'fresh' : 'stale', data.breakdown.length ? `${data.breakdown.length} rows` : 'no rows in range');
    } catch (e) { mark('break', 'suspect', e.message); }
  }

  // Panel D — DB ground truth: signups/day (profiles) + check-ins/day (check_ins).
  async function loadFunnel() {
    const { from, to, bucket } = rangeBounds();
    try {
      const q = `created_at=gte.${encodeURIComponent(from)}&created_at=lt.${encodeURIComponent(to)}&order=created_at.asc&limit=2000`;
      const [pr, cr] = await Promise.all([
        pg(`profiles?select=created_at&${q}`),
        pg(`check_ins?select=created_at&${q}`),
      ]);
      const [prows, crows] = [await pr.json(), await cr.json()];
      const key = bucket === 'hour'
        ? d => new Date(d).toISOString().slice(0, 13) + ':00'
        : d => new Date(d).toISOString().slice(0, 10);
      const map = {};
      (Array.isArray(prows) ? prows : []).forEach(x => { const k = key(x.created_at); (map[k] = map[k] || { signups: 0, checkins: 0 }).signups++; });
      (Array.isArray(crows) ? crows : []).forEach(x => { const k = key(x.created_at); (map[k] = map[k] || { signups: 0, checkins: 0 }).checkins++; });
      data.funnel = Object.keys(map).sort().map(k => ({ bucket: bucket === 'hour' ? k + ':00Z' : k + 'T00:00:00Z', signups: map[k].signups, checkins: map[k].checkins }));
      mark('funnel', 'fresh', `${fmtNum((prows || []).length)} signups · ${fmtNum((crows || []).length)} check-ins in window`);
    } catch (e) { mark('funnel', 'suspect', e.message); }
  }

  // Panel D (inline) — attribution summary, reusing the Attribution RPCs.
  async function loadAttribution() {
    const { from, to } = rangeBounds();
    const days = Math.max(1, Math.round((new Date(to) - new Date(from)) / 864e5));
    try {
      const [cov, bd] = await Promise.all([
        rpc('admin_attribution_coverage', { p_days: days }),
        rpc('admin_attribution_breakdown', { p_since: from, p_until: to }),
      ]);
      data.attrCoverage = (Array.isArray(cov) && cov[0]) || null;
      data.attrTop = (Array.isArray(bd) ? bd : []).sort((a, b) => (+b.signups || 0) - (+a.signups || 0)).slice(0, 3);
      mark('attr', 'fresh', '');
    } catch (e) { mark('attr', 'suspect', e.message); }
  }

  // ── rendering ──────────────────────────────────────
  function setLoading() {
    const wrap = document.getElementById('analytics-content');
    if (wrap) wrap.innerHTML = '<div style="padding:48px;text-align:center;color:var(--muted)">Loading analytics…</div>';
  }

  function kpiCard(label, value, sub) {
    return `<div class="kpi-card" style="cursor:default;min-width:130px">
      <div class="kpi-label">${esc(label)}</div>
      <div class="kpi-value">${esc(value)}</div>
      ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
    </div>`;
  }

  // Two-series SVG chart (main = solid coral, secondary = dashed blue).
  // rows: [{bucket, main, sub}] — already normalized by the caller.
  function chartSVG(rows, bucket, mainLabel, subLabel) {
    if (!rows.length) {
      return '<div style="padding:48px;text-align:center;color:var(--muted)">No data in this range yet.</div>';
    }
    const W = 1000, H = 260, padL = 46, padR = 16, padT = 14, padB = 26;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const maxV = Math.max(1, ...rows.map(r => Math.max(+r.main || 0, +r.sub || 0)));
    const n = rows.length;
    const x = i => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const y = v => padT + innerH - (v / maxV) * innerH;
    const pts = k => rows.map((r, i) => `${x(i).toFixed(1)},${y(+r[k] || 0).toFixed(1)}`).join(' ');
    const area = `${padL},${padT + innerH} ${pts('main')} ${x(n - 1).toFixed(1)},${padT + innerH}`;
    const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
      const yy = (padT + innerH - f * innerH).toFixed(1);
      return `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="var(--border)" stroke-width="1" vector-effect="non-scaling-stroke"/>`
           + `<text x="${padL - 8}" y="${(+yy + 4)}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="DM Mono,monospace">${fmtNum(Math.round(maxV * f))}</text>`;
    }).join('');
    const step = Math.max(1, Math.ceil(n / 7));
    let xlabels = '';
    for (let i = 0; i < n; i += step) {
      xlabels += `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--muted)" font-family="DM Mono,monospace">${esc(fmtBucket(rows[i].bucket, bucket))}</text>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="260" preserveAspectRatio="none" style="display:block">
      <defs><linearGradient id="anaArea" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#FF6B4A" stop-opacity="0.30"/>
        <stop offset="100%" stop-color="#FF6B4A" stop-opacity="0"/>
      </linearGradient></defs>
      ${grid}
      <polygon points="${area}" fill="url(#anaArea)"/>
      <polyline points="${pts('sub')}" fill="none" stroke="#3B82F6" stroke-width="1.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>
      <polyline points="${pts('main')}" fill="none" stroke="#FF6B4A" stroke-width="2.25" vector-effect="non-scaling-stroke"/>
      ${xlabels}
    </svg>`;
  }

  function controlsBarHTML() {
    const presets = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days']];
    const surfaces = [['site', 'Website'], ['app', 'App'], ['all', 'All']];
    return `
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${presets.map(([id, lbl]) => `
            <button class="ana-preset" data-preset="${id}"
              style="padding:7px 14px;border-radius:999px;border:1px solid var(--border);font-weight:600;font-size:13px;cursor:pointer;background:${state.preset === id ? 'var(--coral)' : 'var(--card)'};color:${state.preset === id ? '#fff' : 'var(--text)'}">${lbl}</button>`).join('')}
        </div>
        <div style="display:inline-flex;background:var(--bg2);border-radius:999px;padding:3px;gap:2px">
          ${surfaces.map(([id, lbl]) => `
            <button class="ana-surface" data-surface="${id}"
              style="padding:6px 14px;border-radius:999px;border:none;font-weight:600;font-size:13px;cursor:pointer;background:${state.surface === id ? 'var(--coral)' : 'transparent'};color:${state.surface === id ? '#fff' : 'var(--text)'}">${lbl}</button>`).join('')}
        </div>
        <div style="display:flex;gap:6px;align-items:center;margin-left:auto;flex-wrap:wrap">
          <input type="date" id="ana-from" value="${esc(state.customFrom)}" style="padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:13px">
          <span style="color:var(--muted);font-size:13px">→</span>
          <input type="date" id="ana-to" value="${esc(state.customTo)}" style="padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:13px">
          <button id="ana-refresh" style="padding:7px 14px;border-radius:999px;border:1px solid var(--border);background:var(--card);color:var(--text);font-weight:600;font-size:13px;cursor:pointer">↻ Refresh</button>
        </div>
      </div>
      <div style="font-size:12px;color:var(--muted);margin:-8px 0 16px">${state.surface === 'site' ? 'Website pages only (the app shell is excluded)' : state.surface === 'app' ? 'The web + iOS app only' : 'Website + app combined'}</div>`;
  }

  function barList(rows, valueKey, countKey, subKey, aiBadge) {
    const max = rows.reduce((m, r) => Math.max(m, +r[countKey] || 0), 0);
    return rows.length === 0
      ? `<div style="padding:18px;text-align:center;color:var(--muted)">No data for this dimension yet.</div>`
      : rows.map(r => {
          const w = max > 0 ? Math.round((+r[countKey] / max) * 100) : 0;
          const sub = subKey && r[subKey] != null ? ` <span style="color:var(--muted)">· ${fmtNum(r[subKey])}s</span>` : '';
          return `<div style="padding:7px 0">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px;gap:10px">
              <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${aiBadge && /chatgpt|perplexity|claude|openai|gemini|copilot/i.test(r[valueKey] || '') ? '🤖 ' : ''}${esc(r[valueKey])}</span>
              <span style="font-family:'DM Mono',monospace;color:var(--text)"><strong>${fmtNum(r[countKey])}</strong>${sub}</span>
            </div>
            <div style="background:var(--bg2);border-radius:5px;height:8px;overflow:hidden"><div style="background:linear-gradient(90deg,#3B82F6,#60A5FA);height:100%;width:${w}%;border-radius:5px"></div></div>
          </div>`;
        }).join('');
  }

  function render() {
    const wrap = document.getElementById('analytics-content');
    if (!wrap) return;
    const k = data.kpis || {};
    const kp = data.kpisPrev || {};
    const pageviews = +k.pageviews || 0;
    const visitors = +k.visitors || 0;
    const signups = +k.signups || 0;
    const conv = visitors ? ((signups / visitors) * 100).toFixed(1) + '%' : '0%';

    // Panel B rows: flag likely-bot days, optionally hide them.
    const flagged = new Set();
    const seriesRows = (data.series || []).map((r, i) => {
      const isBot = (+r.visitors || 0) > 0 && (+r.pageviews / +r.visitors) > BOT_PV_PER_VISITOR;
      if (isBot) flagged.add(i);
      return { bucket: r.bucket, main: +r.pageviews || 0, sub: +r.sessions || 0 };
    });
    const shownRows = state.hideBots ? seriesRows.filter((_, i) => !flagged.has(i)) : seriesRows;

    const funnelRows = (data.funnel || []).map(r => ({ bucket: r.bucket, main: r.signups, sub: r.checkins }));

    const cov = data.attrCoverage || {};
    const hBot = health.bot;

    wrap.innerHTML = `
      ${controlsBarHTML()}

      <!-- Panel E — Data-health banner -->
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:18px;overflow:hidden">
        <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div style="font-family:'Cabinet Grotesk',sans-serif;font-size:15px;font-weight:700">Data health</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${chip('rollup', 'rollup')}
            ${chip('bot', 'bot-skew')}
          </div>
        </div>
        <div style="padding:12px 16px;font-size:13px;color:var(--muted);display:flex;flex-direction:column;gap:6px">
          <div>🕒 <strong style="color:var(--text)">analytics_daily</strong> rollup ${health.rollup.note ? esc(health.rollup.note) : '— checking…'}</div>
          <div>🤖 Bot-skew: ${hBot.note ? esc(hBot.note) : '— checking…'} ${health.bot.status === 'suspect' ? '— traffic today is bot-dominated, treat KPIs with caution.' : ''}</div>
          <div>🧑‍💻 Founder traffic is excluded at ingest (spotd staff + shanerutter@gmail.com), so these numbers are public traffic only.</div>
          <div>📸 Check-in counts below exclude photo check-ins.</div>
          <div>⚠️ Venue counts are unreconciled (last audited 2026-09-29: dashboard showed 1,000 · DB active=true is 3,732 · venue list showed 4,473) — tracked separately, not a traffic-data issue.</div>
        </div>
      </div>

      <!-- Panel A — Traffic KPIs -->
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:18px;overflow:hidden">
        <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Traffic KPIs</div>
          <div style="display:flex;gap:8px;align-items:center">${chip('kpis')}<span style="font-size:11px;color:var(--muted)">vs prior ${esc(state.preset === 'custom' ? 'window' : state.preset)}</span></div>
        </div>
        ${health.kpis.status === 'suspect'
          ? `<div style="padding:24px;text-align:center;color:var(--coral)">Couldn't load KPIs: ${esc(health.kpis.note)}<br><span style="color:var(--muted);font-size:12px">Showing nothing rather than zeros.</span></div>`
          : `<div class="kpi-row" style="display:flex;gap:12px;flex-wrap:wrap;padding:16px">
              ${kpiCard('Pageviews', fmtNum(pageviews), deltaHTML(pageviews, kp.pageviews))}
              ${kpiCard('Sessions', fmtNum(k.sessions), deltaHTML(k.sessions, kp.sessions))}
              ${kpiCard('Visitors', fmtNum(visitors), deltaHTML(visitors, kp.visitors))}
              ${kpiCard('Signed-in', fmtNum(k.signed_in_users), deltaHTML(k.signed_in_users, kp.signed_in_users))}
              ${kpiCard('Signups', fmtNum(signups), deltaHTML(signups, kp.signups))}
              ${kpiCard('Conversion', conv, 'signups / visitors')}
            </div>`}
      </div>

      <!-- Panel B — Timeseries -->
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:18px;overflow:hidden">
        <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Traffic over time</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            ${chip('series')}
            <label style="font-size:12px;color:var(--muted);display:inline-flex;align-items:center;gap:6px;cursor:pointer">
              <input type="checkbox" id="ana-hide-bots" ${state.hideBots ? 'checked' : ''}>
              Hide likely-bot days (>${BOT_PV_PER_VISITOR} views/visitor)
            </label>
          </div>
        </div>
        <div style="display:flex;gap:14px;font-size:12px;color:var(--muted);padding:10px 16px 0">
          <span><span style="display:inline-block;width:14px;height:3px;background:#FF6B4A;vertical-align:middle;border-radius:2px"></span> Pageviews</span>
          <span><span style="display:inline-block;width:14px;height:0;border-top:2px dashed #3B82F6;vertical-align:middle"></span> Sessions</span>
          <span style="font-family:'DM Mono',monospace">${state.bucket === 'hour' ? 'hourly' : 'daily'}</span>
          ${data.botDays ? `<span style="color:#F59E0B;font-weight:700">⚠ ${data.botDays} likely-bot day${data.botDays === 1 ? '' : 's'}</span>` : ''}
        </div>
        <div style="padding:10px 10px 6px">${health.series.status === 'suspect' ? `<div style="padding:24px;text-align:center;color:var(--coral)">Couldn't load timeseries: ${esc(health.series.note)}</div>` : chartSVG(shownRows, state.bucket)}</div>
      </div>

      <!-- Panel C — Breakdowns -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-bottom:18px">
        <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden">
          <div style="padding:14px 16px;border-bottom:1px solid var(--border);font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Top pages</div>
          <div style="padding:8px 16px 14px" id="ana-pages-body"></div>
        </div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden">
          <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Breakdown</span>
            <div style="display:flex;gap:8px;align-items:center">
              ${chip('break')}
              <select id="ana-dim-select" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:13px;font-weight:600;cursor:pointer">
                ${[['source', 'Top sources'], ['referrer', 'Referrers'], ['device', 'Device'], ['country', 'Country'], ['platform', 'Platform']].map(([id, lbl]) => `<option value="${id}"${id === state.tdSel ? ' selected' : ''}>${lbl}</option>`).join('')}
              </select>
            </div>
          </div>
          <div style="padding:8px 16px 14px" id="ana-breakdown-body"></div>
        </div>
      </div>

      <!-- Panel D — Signup & activation strip -->
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:18px;overflow:hidden">
        <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Signup & activation</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px">DB ground truth (profiles + check_ins) — keeps traffic numbers honest</div>
          </div>
          ${chip('funnel')}
        </div>
        <div style="display:flex;gap:14px;font-size:12px;color:var(--muted);padding:10px 16px 0">
          <span><span style="display:inline-block;width:14px;height:3px;background:#FF6B4A;vertical-align:middle;border-radius:2px"></span> Signups / day</span>
          <span><span style="display:inline-block;width:14px;height:0;border-top:2px dashed #3B82F6;vertical-align:middle"></span> Check-ins / day</span>
        </div>
        <div style="padding:10px 10px 6px">${health.funnel.status === 'suspect' ? `<div style="padding:24px;text-align:center;color:var(--coral)">Couldn't load funnel data: ${esc(health.funnel.note)}</div>` : chartSVG(funnelRows, state.bucket)}</div>
        <div style="padding:12px 16px 16px;border-top:1px solid var(--border);display:flex;gap:12px;flex-wrap:wrap;align-items:center">
          ${chip('attr')}
          ${health.attr.status === 'suspect'
            ? `<span style="font-size:13px;color:var(--coral)">Attribution summary unavailable: ${esc(health.attr.note)}</span>`
            : `<span style="font-size:13px"><strong>${fmtNum(cov.total_signups)}</strong> signups in window · <strong>${cov.pct_covered || 0}%</strong> with attribution${(data.attrTop || []).length ? ' · top: ' + data.attrTop.map(t => `${sourceLabel(t.source)} (${fmtNum(t.signups)})`).join(', ') : ''}</span>`}
          <a href="#" id="ana-goto-attr" style="font-size:13px;color:var(--coral);font-weight:600">Open Attribution →</a>
        </div>
      </div>

      <!-- Reviewer parity gate -->
      <details style="background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:18px;padding:12px 16px">
        <summary style="font-size:13px;font-weight:700;cursor:pointer">🔍 Reviewer parity gate — exact RPC calls behind this render</summary>
        <div style="font-size:12px;color:var(--muted);margin:8px 0">Run these in the devtools console with the admin session and compare numbers before the live ship.</div>
        <pre style="font-family:'DM Mono',monospace;font-size:11px;background:var(--bg2);border-radius:8px;padding:12px;overflow-x:auto;white-space:pre-wrap">${esc(JSON.stringify(data.parity, null, 2) || '[]')}</pre>
      </details>
    `;

    renderPages();
    renderBreakdown();
    wireControls();
  }

  function renderPages() {
    const body = document.getElementById('ana-pages-body');
    if (!body) return;
    body.innerHTML = barList(data.pages || [], 'value', 'pageviews', 'sessions', false);
  }

  function renderBreakdown() {
    const body = document.getElementById('ana-breakdown-body');
    if (!body) return;
    if (health.break.status === 'suspect') {
      body.innerHTML = `<div style="padding:18px;text-align:center;color:var(--coral)">Couldn't load: ${esc(health.break.note)}</div>`;
      return;
    }
    body.innerHTML = barList(data.breakdown || [], 'value', 'pageviews', 'sessions', true);
  }

  function wireControls() {
    const wrap = document.getElementById('analytics-content');
    if (!wrap) return;
    wrap.querySelectorAll('.ana-preset').forEach(b => {
      b.addEventListener('click', () => {
        if (state.preset === b.dataset.preset) return;
        state.preset = b.dataset.preset; state.customFrom = ''; state.customTo = '';
        loadAll();
      });
    });
    wrap.querySelectorAll('.ana-surface').forEach(b => {
      b.addEventListener('click', () => {
        if (state.surface === b.dataset.surface) return;
        state.surface = b.dataset.surface;
        loadAll();
      });
    });
    const from = document.getElementById('ana-from');
    const to   = document.getElementById('ana-to');
    const onCustom = () => {
      state.customFrom = from ? from.value : '';
      state.customTo   = to ? to.value : '';
      if (state.customFrom || state.customTo) { state.preset = 'custom'; loadAll(); }
    };
    if (from) from.addEventListener('change', onCustom);
    if (to)   to.addEventListener('change', onCustom);
    document.getElementById('ana-refresh')?.addEventListener('click', loadAll);
    document.getElementById('ana-hide-bots')?.addEventListener('change', e => {
      state.hideBots = e.target.checked;
      render();
    });
    document.getElementById('ana-dim-select')?.addEventListener('change', e => {
      state.tdSel = e.target.value;
      loadBreakdown().then(renderBreakdown);
    });
    document.getElementById('ana-goto-attr')?.addEventListener('click', e => {
      e.preventDefault();
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
      document.querySelectorAll('.drawer-item').forEach(i => i.classList.remove('active'));
      document.getElementById('page-attribution')?.classList.add('active');
      document.getElementById('nav-attribution')?.classList.add('active');
      document.getElementById('mob-nav-attribution')?.classList.add('active');
      const title = document.getElementById('mobilePageTitle');
      if (title) title.textContent = 'Attribution';
      window.scrollTo(0, 0);
    });
  }

  // ── navigation ─────────────────────────────────────
  function switchTo() {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.drawer-item').forEach(i => i.classList.remove('active'));
    document.getElementById('page-analytics')?.classList.add('active');
    document.getElementById('nav-analytics')?.classList.add('active');
    document.getElementById('mob-nav-analytics')?.classList.add('active');
    const title = document.getElementById('mobilePageTitle');
    if (title) title.textContent = 'Traffic Analytics';
    window.scrollTo(0, 0);
    loadAll();
  }
  window.showAnalyticsPage = switchTo;

  // ── DOM injection ──────────────────────────────────
  function inject() {
    // Sidebar — sit next to Attribution (both are analytics surfaces)
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && !document.getElementById('nav-analytics')) {
      const item = document.createElement('div');
      item.className = 'sidebar-item';
      item.id = 'nav-analytics';
      item.style.cursor = 'pointer';
      item.innerHTML = `🌐 Traffic Analytics`;
      item.addEventListener('click', switchTo);
      const attr = document.getElementById('nav-attribution');
      if (attr && attr.parentNode) {
        attr.parentNode.insertBefore(item, attr.nextSibling);
      } else {
        sidebar.appendChild(item);
      }
    }

    // Mobile drawer
    const drawer = document.getElementById('mobileDrawer');
    if (drawer && !document.getElementById('mob-nav-analytics')) {
      const btn = document.createElement('button');
      btn.className = 'drawer-item';
      btn.id = 'mob-nav-analytics';
      btn.innerHTML = `🌐 Traffic Analytics`;
      btn.addEventListener('click', () => {
        switchTo();
        if (typeof window.closeMobileMenu === 'function') window.closeMobileMenu();
      });
      const attrMob = document.getElementById('mob-nav-attribution');
      if (attrMob && attrMob.parentNode) {
        attrMob.parentNode.insertBefore(btn, attrMob.nextSibling);
      } else {
        const footer = drawer.querySelector('.drawer-footer');
        if (footer) drawer.insertBefore(btn, footer);
        else drawer.appendChild(btn);
      }
    }

    // Page
    const main = document.querySelector('.main-content');
    if (main && !document.getElementById('page-analytics')) {
      const page = document.createElement('div');
      page.className = 'page';
      page.id = 'page-analytics';
      page.innerHTML = `
        <div class="page-title">🌐 Traffic Analytics</div>
        <div class="page-sub">
          Traffic KPIs, timeseries, breakdowns, and the signup funnel — no console
          RPCs needed. Every number carries a freshness chip; failures show up as
          <strong>SUSPECT</strong>, never as zeros.
        </div>
        <div id="analytics-content"></div>
      `;
      main.appendChild(page);
    }
  }

  // ── bootstrap ──────────────────────────────────────
  function init() {
    // Small delay so admin.html's own sidebar has rendered first
    // (and admin-attribution.js has injected its nav item for siting).
    setTimeout(inject, 400);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
