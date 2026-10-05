/* admin-email-analytics.js
 * Injects a "✉️ Email Analytics" section into the admin portal — Loops email
 * performance over the email_daily_metrics / email_campaigns tables, written
 * daily by the metrics cron via /api/metrics-ingest.js
 * (spec: docs/analytics-dashboards-ops.md).
 *
 * Panels:
 *   F  Freshness banner — per-workflow last pull, daily-cadence expectation.
 *   A  Email KPIs        — contacts / sends / open rate / click rate /
 *                          unsubscribes, with 7-day deltas.
 *   B  Workflows         — per-workflow sends/opens/clicks/unsub + rates.
 *   C  Timeseries        — sends + opens per day, 30 days.
 *   D  Recent campaigns  — one-off/broadcast campaigns with rates.
 *
 * Read-only. Reuses the signed-in admin's user JWT + anon key (same pattern as
 * admin-analytics.js). Zero new RPCs — reads the metrics tables directly via
 * PostgREST, plus the __audience_total__ sentinel row for the contacts KPI
 * (falling back to newsletter_subscribers when no audience row exists).
 * Failed reads render a SUSPECT chip — never zeros.
 *
 * Registered in api/admin-page.js SCRIPT_TAGS. Served from GitHub main at
 * request time.
 */
(function () {
  'use strict';

  const SUPABASE_URL  = 'https://opcskuzbdfrlnyhraysk.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_M97B-GmwsRF6xPVahp_ytw_49nI9igs';
  const LS_KEY        = 'spotd-admin-session';

  // Sentinel workflow row in email_daily_metrics: its `sends` column holds the
  // Loops audience contact count. It feeds ONLY the Contacts KPI — it must be
  // excluded from every send/open/click aggregation and from the workflows table.
  const AUDIENCE_WORKFLOW = '__audience_total__';

  // ── auth helpers (verbatim pattern from admin-analytics.js) ──
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
  // Read-only PostgREST GET. Same admin-JWT auth; one refresh retry on JWT expiry.
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
  // Exact row count for a table (Prefer: count=exact, no rows fetched).
  async function pgCount(table) {
    const send = () => fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id&limit=0`, {
      headers: { ...hdrs(), 'Prefer': 'count=exact' },
    });
    let r = await send();
    if ((r.status === 401 || r.status === 403)) {
      let data; try { data = await r.clone().json(); } catch (e) { data = null; }
      if (isJwtExpiredError(data) && await tryRefreshSession()) r = await send();
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const cr = r.headers.get('content-range') || '';
    const total = cr.split('/')[1];
    if (total == null || total === '*') throw new Error('count unavailable');
    return +total;
  }

  // ── utils ──────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtInt(n) { return n == null ? '—' : Number(n).toLocaleString('en-US'); }
  function fmtRate(num, den) {
    if (num == null || den == null || +den === 0) return '—';
    return ((+num / +den) * 100).toFixed(1) + '%';
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
  function fmtDay(isoOrDate) {
    const d = new Date(isoOrDate);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function deltaHTML(cur, prev) {
    if (prev == null || cur == null || +prev === 0) return '<span style="color:var(--muted)">—</span>';
    const pct = ((+cur - +prev) / +prev) * 100;
    if (Math.abs(pct) < 0.05) return '<span style="color:var(--muted)">±0%</span>';
    const up = pct > 0;
    return `<span style="color:${up ? '#22C55E' : 'var(--coral)'};font-weight:700">${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%</span>`;
  }
  // Delta for rates (percentage-point change, not percent change).
  function rateDeltaHTML(curNum, curDen, prevNum, prevDen) {
    if (curDen == null || prevDen == null || +curDen === 0 || +prevDen === 0) {
      return '<span style="color:var(--muted)">—</span>';
    }
    const pp = ((+curNum / +curDen) - (+prevNum / +prevDen)) * 100;
    if (Math.abs(pp) < 0.05) return '<span style="color:var(--muted)">±0.0pp</span>';
    const up = pp > 0;
    return `<span style="color:${up ? '#22C55E' : 'var(--coral)'};font-weight:700">${up ? '▲' : '▼'} ${Math.abs(pp).toFixed(1)}pp</span>`;
  }

  // Per-panel health: { status: 'fresh'|'stale'|'suspect'|'loading', at: iso, note }
  const health = {
    fresh: { status: 'loading', at: null, note: '' },
    kpis:  { status: 'loading', at: null, note: '' },
    camp:  { status: 'loading', at: null, note: '' },
  };
  const data = {
    daily: [],      // email_daily_metrics rows (last 90 days)
    campaigns: [],  // email_campaigns rows
    contacts: null, // Loops audience count (or legacy newsletter_subscribers count)
    contactsSource: null, // 'Loops audience' | 'newsletter_subscribers' | null
  };

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
    await Promise.allSettled([loadDaily(), loadCampaigns(), loadContacts()]);
    render();
  }

  async function loadDaily() {
    try {
      const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
      const r = await pg(`email_daily_metrics?select=*&day=gte.${since}&order=day.asc&limit=2000`);
      const rows = await r.json();
      data.daily = Array.isArray(rows) ? rows : [];
      // per-workflow freshness
      const pw = {};
      data.daily.forEach(x => {
        const cur = pw[x.workflow];
        if (!cur || x.day > cur.lastDay) pw[x.workflow] = { lastDay: x.day, lastPull: x.collected_at };
      });
      const wfs = Object.keys(pw);
      if (!wfs.length) {
        mark('fresh', 'stale', 'no rows yet — the daily pull has not landed');
        mark('kpis', 'stale', 'no data yet');
      } else {
        const oldestPullH = Math.min(...wfs.map(w => (Date.now() - new Date(pw[w].lastPull).getTime()) / 36e5));
        const notes = wfs.map(w => `${esc(w === AUDIENCE_WORKFLOW ? 'audience' : w)}: through ${pw[w].lastDay}, pulled ${relTime(pw[w].lastPull)}`).join(' · ');
        mark('fresh', oldestPullH > 30 ? 'stale' : 'fresh', notes + ' — pulls run daily ~06:00 PT');
        mark('kpis', 'fresh', `${data.daily.length} daily rows · ${wfs.length} workflows`);
      }
    } catch (e) {
      mark('fresh', 'suspect', 'read failed: ' + e.message);
      mark('kpis', 'suspect', e.message);
    }
  }

  async function loadCampaigns() {
    try {
      const r = await pg('email_campaigns?select=*&order=sent_at.desc&limit=30');
      const rows = await r.json();
      data.campaigns = Array.isArray(rows) ? rows : [];
      mark('camp', 'fresh', `${data.campaigns.length} campaigns`);
    } catch (e) {
      data.campaigns = [];
      mark('camp', 'suspect', 'read failed: ' + e.message);
    }
  }

  async function loadContacts() {
    // Primary source: the latest __audience_total__ row — its `sends` column
    // is the Loops audience contact count. Fallback: the legacy
    // newsletter_subscribers table (kept for history, currently empty).
    try {
      const r = await pg(`email_daily_metrics?select=sends,day&workflow=eq.${AUDIENCE_WORKFLOW}&order=day.desc&limit=1`);
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length && rows[0].sends != null) {
        data.contacts = +rows[0].sends;
        data.contactsSource = 'Loops audience';
        return;
      }
    } catch (e) { /* fall through to the legacy source */ }
    try {
      data.contacts = await pgCount('newsletter_subscribers');
      data.contactsSource = 'newsletter_subscribers';
    } catch (e) {
      data.contacts = null; // KPI card will show the SUSPECT state via health
      data.contactsSource = null;
      if (health.kpis.status === 'fresh') mark('kpis', 'fresh', (health.kpis.note || '') + ' · contacts read failed');
    }
  }

  // ── KPI math ───────────────────────────────────────
  function windowSums(days, offsetDays) {
    const end = new Date(); end.setHours(0, 0, 0, 0); end.setDate(end.getDate() - offsetDays);
    const start = new Date(end); start.setDate(start.getDate() - days);
    const out = { sends: 0, opens: 0, clicks: 0, unsubscribes: 0, bounces: 0, has: false };
    data.daily.forEach(r => {
      if (r.workflow === AUDIENCE_WORKFLOW) return; // contact count, not email activity
      const d = new Date(r.day + 'T12:00:00');
      if (d >= start && d < end) {
        out.has = true;
        out.sends += +r.sends || 0;
        out.opens += +r.opens || 0;
        out.clicks += +r.clicks || 0;
        out.unsubscribes += +r.unsubscribes || 0;
        out.bounces += +r.bounces || 0;
      }
    });
    return out;
  }

  // ── rendering ──────────────────────────────────────
  function setLoading() {
    const wrap = document.getElementById('email-content');
    if (wrap) wrap.innerHTML = '<div style="padding:48px;text-align:center;color:var(--muted)">Loading email analytics…</div>';
  }

  function kpiCard(label, value, sub) {
    return `<div class="kpi-card" style="cursor:default;min-width:130px">
      <div class="kpi-label">${esc(label)}</div>
      <div class="kpi-value">${esc(value)}</div>
      ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
    </div>`;
  }

  // Two-series SVG chart (main = solid coral, secondary = dashed blue).
  function chartSVG(rows) {
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
           + `<text x="${padL - 8}" y="${(+yy + 4)}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="DM Mono,monospace">${fmtInt(Math.round(maxV * f))}</text>`;
    }).join('');
    const step = Math.max(1, Math.ceil(n / 8));
    let xlabels = '';
    for (let i = 0; i < n; i += step) {
      xlabels += `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--muted)" font-family="DM Mono,monospace">${esc(fmtDay(rows[i].bucket))}</text>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="260" preserveAspectRatio="none" style="display:block">
      <defs><linearGradient id="emArea" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#FF6B4A" stop-opacity="0.30"/>
        <stop offset="100%" stop-color="#FF6B4A" stop-opacity="0"/>
      </linearGradient></defs>
      ${grid}
      <polygon points="${area}" fill="url(#emArea)"/>
      <polyline points="${pts('sub')}" fill="none" stroke="#3B82F6" stroke-width="1.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>
      <polyline points="${pts('main')}" fill="none" stroke="#FF6B4A" stroke-width="2.25" vector-effect="non-scaling-stroke"/>
      ${xlabels}
    </svg>`;
  }

  function emptyStateHTML() {
    return `<div style="padding:48px 24px;text-align:center;color:var(--muted)">
      <div style="font-size:40px;margin-bottom:12px">✉️</div>
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px">No email data yet</div>
      <div style="font-size:13px;max-width:460px;margin:0 auto">The daily Loops pull hasn't landed. Pulls run every morning at ~06:00 PT and write to
      <span style="font-family:'DM Mono',monospace">email_daily_metrics</span> and
      <span style="font-family:'DM Mono',monospace">email_campaigns</span>. Check back after the first pull.</div>
    </div>`;
  }

  function render() {
    const wrap = document.getElementById('email-content');
    if (!wrap) return;

    const cur = windowSums(7, 0), prev = windowSums(7, 7);
    const cur30 = windowSums(30, 0);

    // 30-day series: sends + opens per day, 30 days
    const dayMap = {};
    data.daily.forEach(r => {
      if (r.workflow === AUDIENCE_WORKFLOW) return; // contact count, not email activity
      const e = dayMap[r.day] || (dayMap[r.day] = { bucket: r.day, main: 0, sub: 0 });
      e.main += +r.sends || 0;
      e.sub += +r.opens || 0;
    });
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    const seriesRows = Object.keys(dayMap).sort()
      .filter(d => new Date(d + 'T12:00:00') >= cutoff)
      .map(d => dayMap[d]);

    // Per-workflow aggregates (last 30 days). The __audience_total__ sentinel is
    // excluded — it feeds the Contacts KPI, not this table.
    const wfMap = {};
    data.daily.forEach(r => {
      if (r.workflow === AUDIENCE_WORKFLOW) return;
      const d = new Date(r.day + 'T12:00:00');
      if (d < cutoff) return;
      const e = wfMap[r.workflow] || (wfMap[r.workflow] = { workflow: r.workflow, sends: 0, opens: 0, clicks: 0, unsubscribes: 0, bounces: 0 });
      e.sends += +r.sends || 0; e.opens += +r.opens || 0; e.clicks += +r.clicks || 0;
      e.unsubscribes += +r.unsubscribes || 0; e.bounces += +r.bounces || 0;
    });
    const workflows = Object.values(wfMap).sort((a, b) => b.sends - a.sends);

    const hasData = data.daily.length > 0;
    const contactsSuspect = data.contacts == null;

    wrap.innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
        <span style="font-size:13px;color:var(--muted)">Loops · last 30 days unless noted</span>
        <button id="em-refresh" style="margin-left:auto;padding:7px 14px;border-radius:999px;border:1px solid var(--border);background:var(--card);color:var(--text);font-weight:600;font-size:13px;cursor:pointer">↻ Refresh</button>
      </div>

      <!-- Panel F — Freshness banner -->
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:18px;overflow:hidden">
        <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div style="font-family:'Cabinet Grotesk',sans-serif;font-size:15px;font-weight:700">Data freshness</div>
          ${chip('fresh')}
        </div>
        <div style="padding:12px 16px;font-size:13px;color:var(--muted);display:flex;flex-direction:column;gap:6px">
          <div>🕒 Pulls run daily at ~06:00 PT from the Loops dashboard.</div>
          <div>${health.fresh.note ? esc(health.fresh.note) : '— checking…'}</div>
        </div>
      </div>

      ${!hasData && health.kpis.status !== 'loading' ? emptyStateHTML() : `
      <!-- Panel A — Email KPIs -->
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:18px;overflow:hidden">
        <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Email KPIs</div>
          <div style="display:flex;gap:8px;align-items:center">${chip('kpis')}<span style="font-size:11px;color:var(--muted)">last 7 days vs prior 7</span></div>
        </div>
        ${health.kpis.status === 'suspect'
          ? `<div style="padding:24px;text-align:center;color:var(--coral)">Couldn't load KPIs: ${esc(health.kpis.note)}<br><span style="color:var(--muted);font-size:12px">Showing nothing rather than zeros.</span></div>`
          : `<div class="kpi-row" style="display:flex;gap:12px;flex-wrap:wrap;padding:16px">
              ${kpiCard('Contacts', contactsSuspect ? 'SUSPECT' : fmtInt(data.contacts), data.contactsSource ? `<span style="color:var(--muted)">${esc(data.contactsSource)}</span>` : '')}
              ${kpiCard('Sends', cur.has ? fmtInt(cur.sends) : '—', cur.has ? deltaHTML(cur.sends, prev.has ? prev.sends : null) : '')}
              ${kpiCard('Open rate', cur.has ? fmtRate(cur.opens, cur.sends) : '—', cur.has ? rateDeltaHTML(cur.opens, cur.sends, prev.opens, prev.sends) : '')}
              ${kpiCard('Click rate', cur.has ? fmtRate(cur.clicks, cur.sends) : '—', cur.has ? rateDeltaHTML(cur.clicks, cur.sends, prev.clicks, prev.sends) : '')}
              ${kpiCard('Unsubscribes', cur.has ? fmtInt(cur.unsubscribes) : '—', cur.has ? deltaHTML(cur.unsubscribes, prev.has ? prev.unsubscribes : null) : '')}
            </div>`}
      </div>

      <!-- Panel B — Workflows -->
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:18px;overflow:hidden">
        <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Workflows — last 30 days</div>
          ${chip('kpis')}
        </div>
        ${workflows.length === 0
          ? `<div style="padding:24px;text-align:center;color:var(--muted)">No workflow data in the last 30 days.</div>`
          : `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead><tr style="text-align:left;color:var(--muted);font-size:11px;letter-spacing:.4px">
                <th style="padding:10px 12px">Workflow</th>
                <th style="padding:10px 12px;text-align:right">Sends</th><th style="padding:10px 12px;text-align:right">Opens</th>
                <th style="padding:10px 12px;text-align:right">Clicks</th><th style="padding:10px 12px;text-align:right">Unsub</th>
                <th style="padding:10px 12px;text-align:right">Open rate</th><th style="padding:10px 12px;text-align:right">Click rate</th>
              </tr></thead>
              <tbody>${workflows.map(w => `
                <tr style="border-top:1px solid var(--border)">
                  <td style="padding:10px 12px;font-weight:600">${esc(w.workflow)}</td>
                  <td style="padding:10px 12px;text-align:right;font-family:'DM Mono',monospace">${fmtInt(w.sends)}</td>
                  <td style="padding:10px 12px;text-align:right;font-family:'DM Mono',monospace">${fmtInt(w.opens)}</td>
                  <td style="padding:10px 12px;text-align:right;font-family:'DM Mono',monospace">${fmtInt(w.clicks)}</td>
                  <td style="padding:10px 12px;text-align:right;font-family:'DM Mono',monospace">${fmtInt(w.unsubscribes)}</td>
                  <td style="padding:10px 12px;text-align:right;font-family:'DM Mono',monospace">${fmtRate(w.opens, w.sends)}</td>
                  <td style="padding:10px 12px;text-align:right;font-family:'DM Mono',monospace">${fmtRate(w.clicks, w.sends)}</td>
                </tr>`).join('')}
              </tbody></table></div>`}
      </div>

      <!-- Panel C — Timeseries -->
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:18px;overflow:hidden">
        <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Sends & opens — last 30 days</div>
          ${chip('kpis')}
        </div>
        <div style="display:flex;gap:14px;font-size:12px;color:var(--muted);padding:10px 16px 0">
          <span><span style="display:inline-block;width:14px;height:3px;background:#FF6B4A;vertical-align:middle;border-radius:2px"></span> Sends / day</span>
          <span><span style="display:inline-block;width:14px;height:0;border-top:2px dashed #3B82F6;vertical-align:middle"></span> Opens / day</span>
        </div>
        <div style="padding:10px 10px 6px">${chartSVG(seriesRows)}</div>
      </div>

      <!-- Panel D — Recent campaigns -->
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:18px;overflow:hidden">
        <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Recent campaigns</div>
          ${chip('camp')}
        </div>
        ${health.camp.status === 'suspect'
          ? `<div style="padding:24px;text-align:center;color:var(--coral)">Couldn't load campaigns: ${esc(health.camp.note)}</div>`
          : data.campaigns.length === 0
          ? `<div style="padding:24px;text-align:center;color:var(--muted)">No campaigns recorded yet.</div>`
          : `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead><tr style="text-align:left;color:var(--muted);font-size:11px;letter-spacing:.4px">
                <th style="padding:10px 12px">Campaign</th><th style="padding:10px 12px">Sent</th>
                <th style="padding:10px 12px;text-align:right">Sends</th><th style="padding:10px 12px;text-align:right">Opens</th>
                <th style="padding:10px 12px;text-align:right">Clicks</th><th style="padding:10px 12px;text-align:right">Open rate</th>
                <th style="padding:10px 12px;text-align:right">Click rate</th>
              </tr></thead>
              <tbody>${data.campaigns.slice(0, 15).map(c => `
                <tr style="border-top:1px solid var(--border)">
                  <td style="padding:10px 12px;max-width:260px">
                    <div style="font-weight:600">${esc(c.name || '—')}</div>
                    ${c.subject ? `<div style="color:var(--muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px">${esc(c.subject)}</div>` : ''}
                  </td>
                  <td style="padding:10px 12px;white-space:nowrap">${c.sent_at ? esc(fmtDay(c.sent_at)) : '—'}</td>
                  <td style="padding:10px 12px;text-align:right;font-family:'DM Mono',monospace">${fmtInt(c.sends)}</td>
                  <td style="padding:10px 12px;text-align:right;font-family:'DM Mono',monospace">${fmtInt(c.opens)}</td>
                  <td style="padding:10px 12px;text-align:right;font-family:'DM Mono',monospace">${fmtInt(c.clicks)}</td>
                  <td style="padding:10px 12px;text-align:right;font-family:'DM Mono',monospace">${fmtRate(c.opens, c.sends)}</td>
                  <td style="padding:10px 12px;text-align:right;font-family:'DM Mono',monospace">${fmtRate(c.clicks, c.sends)}</td>
                </tr>`).join('')}
              </tbody></table></div>`}
      </div>
      `}
    `;

    document.getElementById('em-refresh')?.addEventListener('click', loadAll);
  }

  // ── navigation ─────────────────────────────────────
  function switchTo() {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.drawer-item').forEach(i => i.classList.remove('active'));
    document.getElementById('page-email-analytics')?.classList.add('active');
    document.getElementById('nav-email-analytics')?.classList.add('active');
    document.getElementById('mob-nav-email-analytics')?.classList.add('active');
    const title = document.getElementById('mobilePageTitle');
    if (title) title.textContent = 'Email Analytics';
    window.scrollTo(0, 0);
    loadAll();
  }
  window.showEmailAnalyticsPage = switchTo;

  // ── DOM injection ──────────────────────────────────
  function inject() {
    // Sidebar — sit next to Social Analytics
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && !document.getElementById('nav-email-analytics')) {
      const item = document.createElement('div');
      item.className = 'sidebar-item';
      item.id = 'nav-email-analytics';
      item.style.cursor = 'pointer';
      item.innerHTML = `✉️ Email Analytics`;
      item.addEventListener('click', switchTo);
      const soc = document.getElementById('nav-social-analytics');
      if (soc && soc.parentNode) {
        soc.parentNode.insertBefore(item, soc.nextSibling);
      } else {
        sidebar.appendChild(item);
      }
    }

    // Mobile drawer
    const drawer = document.getElementById('mobileDrawer');
    if (drawer && !document.getElementById('mob-nav-email-analytics')) {
      const btn = document.createElement('button');
      btn.className = 'drawer-item';
      btn.id = 'mob-nav-email-analytics';
      btn.innerHTML = `✉️ Email Analytics`;
      btn.addEventListener('click', () => {
        switchTo();
        if (typeof window.closeMobileMenu === 'function') window.closeMobileMenu();
      });
      const socMob = document.getElementById('mob-nav-social-analytics');
      if (socMob && socMob.parentNode) {
        socMob.parentNode.insertBefore(btn, socMob.nextSibling);
      } else {
        const footer = drawer.querySelector('.drawer-footer');
        if (footer) drawer.insertBefore(btn, footer);
        else drawer.appendChild(btn);
      }
    }

    // Page
    const main = document.querySelector('.main-content');
    if (main && !document.getElementById('page-email-analytics')) {
      const page = document.createElement('div');
      page.className = 'page';
      page.id = 'page-email-analytics';
      page.innerHTML = `
        <div class="page-title">✉️ Email Analytics</div>
        <div class="page-sub">
          Loops email performance, pulled daily at ~06:00 PT. Every panel
          carries a freshness chip; failures show up as
          <strong>SUSPECT</strong>, never as zeros.
        </div>
        <div id="email-content"></div>
      `;
      main.appendChild(page);
    }
  }

  // ── bootstrap ──────────────────────────────────────
  function init() {
    // Small delay so admin.html's own sidebar has rendered first
    // (and admin-social-analytics.js has injected its nav item for siting).
    setTimeout(inject, 800);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
