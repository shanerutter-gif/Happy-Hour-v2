/* admin-social-analytics.js
 * Injects a "📊 Social Analytics" section into the admin portal — TikTok +
 * Instagram performance over the social_daily_metrics / social_post_metrics tables,
 * written daily by the metrics cron via /api/metrics-ingest.js
 * (spec: docs/analytics-dashboards-ops.md).
 *
 * Panels:
 *   F  Freshness banner — per-platform last pull, daily-cadence expectation.
 *   A  Social KPIs       — followers / views / interactions / profile visits /
 *                          posts published, each with 7-day deltas.
 *   B  Timeseries        — views + interactions per day, 30 days.
 *   C  Top posts         — per-post views/likes/comments/shares with links.
 *
 * Read-only. Reuses the signed-in admin's user JWT + anon key (same pattern as
 * admin-analytics.js). Zero new RPCs — reads the metrics tables directly via
 * PostgREST. Failed reads render a SUSPECT chip — never zeros.
 * Instagram does not expose per-post views/shares via the CLI, so those cells
 * show "—" rather than 0. TikTok numbers come from TikTok Studio (browser).
 *
 * Registered in api/admin-page.js SCRIPT_TAGS. Served from GitHub main at
 * request time.
 */
(function () {
  'use strict';

  const SUPABASE_URL  = 'https://opcskuzbdfrlnyhraysk.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_M97B-GmwsRF6xPVahp_ytw_49nI9igs';
  const LS_KEY        = 'spotd-admin-session';

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
  async function pg(path) {
    const send = () => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: hdrs() });
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
    return r.json();
  }

  // ── utils ──────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtNum(n) { return (n == null ? '—' : Number(n)).toLocaleString('en-US'); }
  function fmtInt(n) { return n == null ? '—' : Number(n).toLocaleString('en-US'); }
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

  const state = { platform: 'both' };
  // Per-panel health: { status: 'fresh'|'stale'|'suspect'|'loading', at: iso, note }
  const health = {
    fresh: { status: 'loading', at: null, note: '' },
    kpis:  { status: 'loading', at: null, note: '' },
    posts: { status: 'loading', at: null, note: '' },
  };
  const data = {
    daily: [],   // social_daily_metrics rows (last 40 days, both platforms)
    posts: [],   // social_post_metrics rows, deduped to latest snapshot
    perPlatform: {}, // { tiktok: {lastDay, lastPull}, instagram: {...} }
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

  function platforms() {
    return state.platform === 'both' ? ['tiktok', 'instagram'] : [state.platform];
  }
  function platformEmoji(p) { return p === 'tiktok' ? '🎵' : '📸'; }

  // ── data loads ─────────────────────────────────────
  async function loadAll() {
    setLoading();
    await Promise.allSettled([loadDaily(), loadPosts()]);
    render();
  }

  async function loadDaily() {
    try {
      const since = new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10);
      const rows = await pg(`social_daily_metrics?select=*&day=gte.${since}&order=day.asc&limit=200`);
      data.daily = Array.isArray(rows) ? rows : [];
      // per-platform freshness
      const pp = {};
      data.daily.forEach(r => {
        const cur = pp[r.platform];
        if (!cur || r.day > cur.lastDay) pp[r.platform] = { lastDay: r.day, lastPull: r.collected_at };
      });
      data.perPlatform = pp;
      const plats = Object.keys(pp);
      if (!plats.length) {
        mark('fresh', 'stale', 'no rows yet — the daily pull has not landed');
        mark('kpis', 'stale', 'no data yet');
      } else {
        const oldestPullH = Math.min(...plats.map(p => (Date.now() - new Date(pp[p].lastPull).getTime()) / 36e5));
        const notes = plats.map(p => `${platformEmoji(p)} ${p}: through ${pp[p].lastDay}, pulled ${relTime(pp[p].lastPull)}`).join(' · ');
        mark('fresh', oldestPullH > 30 ? 'stale' : 'fresh', notes + ' — pulls run daily ~06:00 PT');
        mark('kpis', 'fresh', `${data.daily.length} daily rows`);
      }
    } catch (e) {
      mark('fresh', 'suspect', 'read failed: ' + e.message);
      mark('kpis', 'suspect', e.message);
    }
  }

  async function loadPosts() {
    try {
      const rows = await pg('social_post_metrics?select=*&order=collected_at.desc&limit=300');
      // Dedupe to the latest snapshot per (platform, post_id)
      const seen = new Set();
      const deduped = [];
      (Array.isArray(rows) ? rows : []).forEach(r => {
        const k = r.platform + '|' + r.post_id;
        if (seen.has(k)) return;
        seen.add(k);
        deduped.push(r);
      });
      data.posts = deduped;
      mark('posts', 'fresh', `${deduped.length} posts`);
    } catch (e) {
      data.posts = [];
      mark('posts', 'suspect', 'read failed: ' + e.message);
    }
  }

  // ── KPI math ───────────────────────────────────────
  function windowSums(days, offsetDays) {
    // Sum metrics over a `days`-long window ending `offsetDays` ago.
    // "Both" is an explicit sum of the per-platform subtotals, so the toggle
    // views can never disagree with the combined view.
    const end = new Date(); end.setHours(0, 0, 0, 0); end.setDate(end.getDate() - offsetDays);
    const start = new Date(end); start.setDate(start.getDate() - days);
    const byPlatform = {};
    platforms().forEach(p => {
      byPlatform[p] = { views: 0, interactions: 0, profile_visits: 0, posts_published: 0, has: false };
    });
    data.daily.forEach(r => {
      const b = byPlatform[r.platform];
      if (!b) return; // row's platform is not selected by the toggle
      const d = new Date(r.day + 'T12:00:00');
      if (d >= start && d < end) {
        b.has = true;
        b.views += +r.views || 0;
        b.interactions += +r.interactions || 0;
        b.profile_visits += +r.profile_visits || 0;
        b.posts_published += +r.posts_published || 0;
      }
    });
    const out = { views: 0, interactions: 0, profile_visits: 0, posts_published: 0, has: false, byPlatform };
    Object.values(byPlatform).forEach(b => {
      if (!b.has) return;
      out.has = true;
      out.views += b.views;
      out.interactions += b.interactions;
      out.profile_visits += b.profile_visits;
      out.posts_published += b.posts_published;
    });
    return out;
  }
  function latestFollowers() {
    // Latest followers snapshot per selected platform (and 7d-ago value).
    const plats = new Set(platforms());
    const byPlat = {};
    data.daily.forEach(r => {
      if (!plats.has(r.platform) || r.followers == null) return;
      if (!byPlat[r.platform] || r.day > byPlat[r.platform].day) byPlat[r.platform] = r;
    });
    let cur = 0, prev = 0, has = false;
    Object.keys(byPlat).forEach(p => {
      has = true;
      cur += +byPlat[p].followers || 0;
      const target = new Date(byPlat[p].day + 'T12:00:00'); target.setDate(target.getDate() - 7);
      const targetDay = target.toISOString().slice(0, 10);
      const old = data.daily.find(r => r.platform === p && r.day <= targetDay && r.followers != null);
      // find() scans ascending, so take the last match instead
      const cands = data.daily.filter(r => r.platform === p && r.day <= targetDay && r.followers != null);
      if (cands.length) prev += +cands[cands.length - 1].followers || 0;
    });
    return { cur: has ? cur : null, prev: has && prev ? prev : null };
  }

  // ── rendering ──────────────────────────────────────
  function setLoading() {
    const wrap = document.getElementById('social-content');
    if (wrap) wrap.innerHTML = '<div style="padding:48px;text-align:center;color:var(--muted)">Loading social analytics…</div>';
  }

  function kpiCard(label, value, sub) {
    return `<div class="kpi-card" style="cursor:default;min-width:130px">
      <div class="kpi-label">${esc(label)}</div>
      <div class="kpi-value">${esc(value)}</div>
      ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
    </div>`;
  }

  // Two-series SVG chart (main = solid coral, secondary = dashed blue).
  // Pass subKey=null for a single-series chart.
  function chartSVG(rows, subKey, mainLabel, subLabel) {
    if (!rows.length) {
      return '<div style="padding:48px;text-align:center;color:var(--muted)">No data in this range yet.</div>';
    }
    const W = 1000, H = 260, padL = 46, padR = 16, padT = 14, padB = 26;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const maxV = Math.max(1, ...rows.map(r => Math.max(+r.main || 0, subKey ? +r[subKey] || 0 : 0)));
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
    const step = Math.max(1, Math.ceil(n / 8));
    let xlabels = '';
    for (let i = 0; i < n; i += step) {
      xlabels += `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--muted)" font-family="DM Mono,monospace">${esc(fmtDay(rows[i].bucket))}</text>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="260" preserveAspectRatio="none" style="display:block">
      <defs><linearGradient id="socArea" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#FF6B4A" stop-opacity="0.30"/>
        <stop offset="100%" stop-color="#FF6B4A" stop-opacity="0"/>
      </linearGradient></defs>
      ${grid}
      <polygon points="${area}" fill="url(#socArea)"/>
      ${subKey ? `<polyline points="${pts(subKey)}" fill="none" stroke="#3B82F6" stroke-width="1.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>` : ''}
      <polyline points="${pts('main')}" fill="none" stroke="#FF6B4A" stroke-width="2.25" vector-effect="non-scaling-stroke"/>
      ${xlabels}
    </svg>`;
  }

  function platformToggleHTML() {
    const opts = [['tiktok', '🎵 TikTok'], ['instagram', '📸 Instagram'], ['both', 'Both']];
    return `<div style="display:inline-flex;background:var(--bg2);border-radius:999px;padding:3px;gap:2px">
      ${opts.map(([id, lbl]) => `
        <button class="soc-plat" data-platform="${id}"
          style="padding:6px 14px;border-radius:999px;border:none;font-weight:600;font-size:13px;cursor:pointer;background:${state.platform === id ? 'var(--coral)' : 'transparent'};color:${state.platform === id ? '#fff' : 'var(--text)'}">${lbl}</button>`).join('')}
    </div>`;
  }

  function emptyStateHTML() {
    return `<div style="padding:48px 24px;text-align:center;color:var(--muted)">
      <div style="font-size:40px;margin-bottom:12px">📊</div>
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px">No social data yet</div>
      <div style="font-size:13px;max-width:460px;margin:0 auto">The daily metrics pull hasn't landed. Pulls run every morning at ~06:00 PT
      (Instagram via API, TikTok via TikTok Studio) and write to
      <span style="font-family:'DM Mono',monospace">social_daily_metrics</span>.
      Check back after the first pull — or run <span style="font-family:'DM Mono',monospace">scripts/pull-instagram-metrics.mjs</span> now.</div>
    </div>`;
  }

  function render() {
    const wrap = document.getElementById('social-content');
    if (!wrap) return;

    const plats = new Set(platforms());
    const cur = windowSums(7, 0), prev = windowSums(7, 7);
    const fol = latestFollowers();

    // 30-day series, summed across selected platforms
    const dayMap = {};
    data.daily.forEach(r => {
      if (!plats.has(r.platform)) return;
      const e = dayMap[r.day] || (dayMap[r.day] = { bucket: r.day, main: 0, sub: 0 });
      e.main += +r.views || 0;
      e.sub += +r.interactions || 0;
    });
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    const seriesRows = Object.keys(dayMap).sort()
      .filter(d => new Date(d + 'T12:00:00') >= cutoff)
      .map(d => dayMap[d]);

    // Top posts: latest snapshot per post, filtered by platform toggle
    const posts = data.posts
      .filter(r => plats.has(r.platform))
      .sort((a, b) => ((+b.views || 0) - (+a.views || 0)) || ((+b.likes || 0) - (+a.likes || 0)))
      .slice(0, 15);

    const hasData = data.daily.length > 0;

    wrap.innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
        ${platformToggleHTML()}
        <button id="soc-refresh" style="margin-left:auto;padding:7px 14px;border-radius:999px;border:1px solid var(--border);background:var(--card);color:var(--text);font-weight:600;font-size:13px;cursor:pointer">↻ Refresh</button>
      </div>

      <!-- Panel F — Freshness banner -->
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:18px;overflow:hidden">
        <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div style="font-family:'Cabinet Grotesk',sans-serif;font-size:15px;font-weight:700">Data freshness</div>
          ${chip('fresh')}
        </div>
        <div style="padding:12px 16px;font-size:13px;color:var(--muted);display:flex;flex-direction:column;gap:6px">
          <div>🕒 Pulls run daily at ~06:00 PT — Instagram via API, TikTok via TikTok Studio.</div>
          <div>${health.fresh.note ? esc(health.fresh.note) : '— checking…'}</div>
          <div>ℹ️ Instagram per-post views/shares aren't exposed by the API, so those cells show "—", not 0.</div>
          <div>ℹ️ Instagram account-level views/reach are 30-day daily averages — the API only exposes period totals, not true daily counts.</div>
        </div>
      </div>

      ${!hasData && health.kpis.status !== 'loading' ? emptyStateHTML() : `
      <!-- Panel A — Social KPIs -->
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:18px;overflow:hidden">
        <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Social KPIs</div>
          <div style="display:flex;gap:8px;align-items:center">${chip('kpis')}<span style="font-size:11px;color:var(--muted)">last 7 days vs prior 7</span></div>
        </div>
        ${health.kpis.status === 'suspect'
          ? `<div style="padding:24px;text-align:center;color:var(--coral)">Couldn't load KPIs: ${esc(health.kpis.note)}<br><span style="color:var(--muted);font-size:12px">Showing nothing rather than zeros.</span></div>`
          : `<div class="kpi-row" style="display:flex;gap:12px;flex-wrap:wrap;padding:16px">
              ${kpiCard('Followers', fol.cur == null ? '—' : fmtInt(fol.cur), fol.prev != null ? deltaHTML(fol.cur, fol.prev) + ' <span style="color:var(--muted)">vs 7d ago</span>' : '<span style="color:var(--muted)">latest snapshot</span>')}
              ${kpiCard('Views', cur.has ? fmtInt(cur.views) : '—', cur.has ? deltaHTML(cur.views, prev.has ? prev.views : null) : '')}
              ${kpiCard('Interactions', cur.has ? fmtInt(cur.interactions) : '—', cur.has ? deltaHTML(cur.interactions, prev.has ? prev.interactions : null) : '')}
              ${kpiCard('Profile visits', cur.has ? fmtInt(cur.profile_visits) : '—', cur.has ? deltaHTML(cur.profile_visits, prev.has ? prev.profile_visits : null) : '')}
              ${kpiCard('Posts published', cur.has ? fmtInt(cur.posts_published) : '—', '<span style="color:var(--muted)">in window</span>')}
            </div>`}
      </div>

      <!-- Panel B — Timeseries -->
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:18px;overflow:hidden">
        <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Views & interactions — last 30 days</div>
          ${chip('kpis')}
        </div>
        <div style="display:flex;gap:14px;font-size:12px;color:var(--muted);padding:10px 16px 0">
          <span><span style="display:inline-block;width:14px;height:3px;background:#FF6B4A;vertical-align:middle;border-radius:2px"></span> Views / day</span>
          <span><span style="display:inline-block;width:14px;height:0;border-top:2px dashed #3B82F6;vertical-align:middle"></span> Interactions / day</span>
        </div>
        <div style="padding:10px 10px 6px">${chartSVG(seriesRows, 'sub')}</div>
      </div>

      <!-- Panel C — Top posts -->
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:18px;overflow:hidden">
        <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Top posts</div>
          ${chip('posts')}
        </div>
        ${health.posts.status === 'suspect'
          ? `<div style="padding:24px;text-align:center;color:var(--coral)">Couldn't load posts: ${esc(health.posts.note)}</div>`
          : posts.length === 0
          ? `<div style="padding:24px;text-align:center;color:var(--muted)">No posts recorded yet.</div>`
          : `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead><tr style="text-align:left;color:var(--muted);font-size:11px;letter-spacing:.4px">
                <th style="padding:10px 12px">Post</th><th style="padding:10px 12px">Platform</th>
                <th style="padding:10px 12px">Posted</th>
                <th style="padding:10px 12px;text-align:right">Views</th><th style="padding:10px 12px;text-align:right">Likes</th>
                <th style="padding:10px 12px;text-align:right">Comments</th><th style="padding:10px 12px;text-align:right">Shares</th>
              </tr></thead>
              <tbody>${posts.map(p => `
                <tr style="border-top:1px solid var(--border)">
                  <td style="padding:10px 12px;max-width:280px">
                    ${p.url
                      ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" style="color:var(--coral);font-weight:600">${esc((p.caption_snippet || 'View post').slice(0, 60))}${(p.caption_snippet || '').length > 60 ? '…' : ''}</a>`
                      : esc((p.caption_snippet || '—').slice(0, 60))}
                  </td>
                  <td style="padding:10px 12px;white-space:nowrap">${platformEmoji(p.platform)} ${esc(p.platform)}</td>
                  <td style="padding:10px 12px;white-space:nowrap">${p.posted_at ? esc(fmtDay(p.posted_at)) : '—'}</td>
                  <td style="padding:10px 12px;text-align:right;font-family:'DM Mono',monospace">${fmtInt(p.views)}</td>
                  <td style="padding:10px 12px;text-align:right;font-family:'DM Mono',monospace">${fmtInt(p.likes)}</td>
                  <td style="padding:10px 12px;text-align:right;font-family:'DM Mono',monospace">${fmtInt(p.comments)}</td>
                  <td style="padding:10px 12px;text-align:right;font-family:'DM Mono',monospace">${fmtInt(p.shares)}</td>
                </tr>`).join('')}
              </tbody></table></div>`}
      </div>
      `}
    `;

    wireControls();
  }

  function wireControls() {
    const wrap = document.getElementById('social-content');
    if (!wrap) return;
    wrap.querySelectorAll('.soc-plat').forEach(b => {
      b.addEventListener('click', () => {
        if (state.platform === b.dataset.platform) return;
        state.platform = b.dataset.platform;
        render();
      });
    });
    document.getElementById('soc-refresh')?.addEventListener('click', loadAll);
  }

  // ── navigation ─────────────────────────────────────
  function switchTo() {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.drawer-item').forEach(i => i.classList.remove('active'));
    document.getElementById('page-social-analytics')?.classList.add('active');
    document.getElementById('nav-social-analytics')?.classList.add('active');
    document.getElementById('mob-nav-social-analytics')?.classList.add('active');
    const title = document.getElementById('mobilePageTitle');
    if (title) title.textContent = 'Social Analytics';
    window.scrollTo(0, 0);
    loadAll();
  }
  window.showSocialAnalyticsPage = switchTo;

  // ── DOM injection ──────────────────────────────────
  function inject() {
    // Sidebar — sit next to Traffic Analytics
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && !document.getElementById('nav-social-analytics')) {
      const item = document.createElement('div');
      item.className = 'sidebar-item';
      item.id = 'nav-social-analytics';
      item.style.cursor = 'pointer';
      item.innerHTML = `📊 Social Analytics`;
      item.addEventListener('click', switchTo);
      const ana = document.getElementById('nav-analytics');
      if (ana && ana.parentNode) {
        ana.parentNode.insertBefore(item, ana.nextSibling);
      } else {
        sidebar.appendChild(item);
      }
    }

    // Mobile drawer
    const drawer = document.getElementById('mobileDrawer');
    if (drawer && !document.getElementById('mob-nav-social-analytics')) {
      const btn = document.createElement('button');
      btn.className = 'drawer-item';
      btn.id = 'mob-nav-social-analytics';
      btn.innerHTML = `📊 Social Analytics`;
      btn.addEventListener('click', () => {
        switchTo();
        if (typeof window.closeMobileMenu === 'function') window.closeMobileMenu();
      });
      const anaMob = document.getElementById('mob-nav-analytics');
      if (anaMob && anaMob.parentNode) {
        anaMob.parentNode.insertBefore(btn, anaMob.nextSibling);
      } else {
        const footer = drawer.querySelector('.drawer-footer');
        if (footer) drawer.insertBefore(btn, footer);
        else drawer.appendChild(btn);
      }
    }

    // Page
    const main = document.querySelector('.main-content');
    if (main && !document.getElementById('page-social-analytics')) {
      const page = document.createElement('div');
      page.className = 'page';
      page.id = 'page-social-analytics';
      page.innerHTML = `
        <div class="page-title">📊 Social Analytics</div>
        <div class="page-sub">
          TikTok + Instagram performance, pulled daily at ~06:00 PT. Every panel
          carries a freshness chip; failures show up as
          <strong>SUSPECT</strong>, never as zeros.
        </div>
        <div id="social-content"></div>
      `;
      main.appendChild(page);
    }
  }

  // ── bootstrap ──────────────────────────────────────
  function init() {
    // Small delay so admin.html's own sidebar has rendered first
    // (and admin-analytics.js has injected its nav item for siting).
    setTimeout(inject, 600);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
