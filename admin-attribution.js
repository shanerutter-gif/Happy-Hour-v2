/* admin-attribution.js
 * Injects an "📊 Attribution" tab into the admin portal showing where
 * recent signups came from. Mirrors the admin-giveaway.js pattern.
 *
 * Reads admin session from localStorage['spotd-admin-session']. All RPCs
 * are gated by is_giveaway_admin() so non-admin auth users can't pull
 * the data by hitting the RPC directly.
 */
(function () {
  'use strict';

  const SUPABASE_URL  = 'https://opcskuzbdfrlnyhraysk.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_M97B-GmwsRF6xPVahp_ytw_49nI9igs';
  const LS_KEY        = 'spotd-admin-session';

  // ── auth helpers (with token refresh, mirroring admin-giveaway.js) ──
  function session() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveSession(patch) {
    const s = session();
    localStorage.setItem(LS_KEY, JSON.stringify({ ...s, ...patch }));
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
      const ok = await tryRefreshSession();
      if (ok) {
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
  function fmtDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' +
             d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  const SOURCE_LABELS = {
    instagram: '📸 Instagram',
    tiktok:    '🎵 TikTok',
    twitter:   '𝕏 X / Twitter',
    facebook:  '📘 Facebook',
    google:    '🔎 Google search',
    email:     '📧 Email / Newsletter',
    reddit:    '👽 Reddit',
    podcast:   '🎙️ Podcast',
    press:     '📰 Press / blog',
    event:     '🎟️ In-person event',
    app_store: '📱 App Store',
    friend:    '🫶 A cool friend',
    other:     '✨ Somewhere else',
  };
  const sourceLabel = (s) => SOURCE_LABELS[s] || esc(s);

  // ── state ──────────────────────────────────────────
  let breakdown = [];
  let recent    = [];
  let coverage  = null;
  let days      = 30;

  // ── data ───────────────────────────────────────────
  async function loadAll() {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    const until = new Date().toISOString();

    setLoading();
    try {
      const [bd, rc, cov] = await Promise.all([
        rpc('admin_attribution_breakdown', { p_since: since, p_until: until }),
        rpc('admin_attribution_recent',    { p_limit: 50 }),
        rpc('admin_attribution_coverage',  { p_days: days }),
      ]);
      breakdown = Array.isArray(bd) ? bd : [];
      recent    = Array.isArray(rc) ? rc : [];
      coverage  = Array.isArray(cov) && cov[0] ? cov[0] : null;
      render();
    } catch (e) {
      const wrap = document.getElementById('attribution-content');
      if (wrap) wrap.innerHTML = `<div style="padding:24px;color:var(--coral);text-align:center">Error: ${esc(e.message)}</div>`;
    }
  }

  function setLoading() {
    const wrap = document.getElementById('attribution-content');
    if (wrap) wrap.innerHTML = '<div style="padding:32px;text-align:center;color:var(--muted)">Loading…</div>';
  }

  function render() {
    const wrap = document.getElementById('attribution-content');
    if (!wrap) return;

    const totalSignups = (coverage && coverage.total_signups) || 0;
    const withSource   = (coverage && coverage.with_source)   || 0;
    const pctCovered   = (coverage && coverage.pct_covered)   || 0;

    const max = breakdown.reduce((m, r) => Math.max(m, r.signups || 0), 0);

    wrap.innerHTML = `
      <!-- Coverage stats -->
      <div class="kpi-row" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
        <div class="kpi-card" style="cursor:default">
          <div class="kpi-label">Signups (last ${days}d)</div>
          <div class="kpi-value">${totalSignups}</div>
        </div>
        <div class="kpi-card" style="cursor:default">
          <div class="kpi-label">With attribution</div>
          <div class="kpi-value">${withSource}</div>
          <div class="kpi-sub">${pctCovered}% of new signups</div>
        </div>
        <div class="kpi-card" style="cursor:default">
          <div class="kpi-label">Sources tracked</div>
          <div class="kpi-value">${breakdown.length}</div>
        </div>
      </div>

      <!-- Breakdown bar chart -->
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:24px">
        <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Where signups came from</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px">Self-reported during onboarding</div>
          </div>
          <div style="display:flex;gap:6px">
            ${[7, 30, 90].map(d => `
              <button class="attr-day-tab${d === days ? ' active' : ''}" data-days="${d}"
                      style="padding:6px 12px;border-radius:999px;border:1px solid var(--border);background:${d === days ? 'var(--coral)' : 'var(--card)'};color:${d === days ? '#fff' : 'var(--text)'};font-weight:600;font-size:13px;cursor:pointer">
                ${d}d
              </button>`).join('')}
          </div>
        </div>
        <div style="padding:16px">
          ${breakdown.length === 0 ? `
            <div style="padding:20px;text-align:center;color:var(--muted)">
              No attribution data yet for this window.
            </div>` : breakdown.map(row => {
              const w = max > 0 ? Math.round((row.signups / max) * 100) : 0;
              return `
                <div style="display:flex;align-items:center;gap:12px;padding:8px 0">
                  <div style="width:160px;font-weight:600;font-size:14px">${sourceLabel(row.source)}</div>
                  <div style="flex:1;background:var(--bg2);border-radius:6px;height:22px;position:relative;overflow:hidden">
                    <div style="background:linear-gradient(90deg,#FF6B4A,#E8943A);height:100%;width:${w}%;border-radius:6px;transition:width .3s ease"></div>
                  </div>
                  <div style="width:80px;text-align:right;font-family:'DM Mono',monospace;font-size:13px">
                    <strong>${row.signups}</strong> <span style="color:var(--muted)">· ${row.pct}%</span>
                  </div>
                </div>`;
            }).join('')}
        </div>
      </div>

      <!-- Recent attributions table -->
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden">
        <div style="padding:14px 16px;border-bottom:1px solid var(--border)">
          <div style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Recent signups</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">Most recent 50 with an attribution recorded</div>
        </div>
        ${recent.length === 0 ? `<div style="padding:24px;text-align:center;color:var(--muted)">No attributions recorded yet.</div>` : `
        <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead>
            <tr style="background:var(--bg2);text-align:left">
              <th style="padding:10px 12px;font-family:'Cabinet Grotesk',sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">When</th>
              <th style="padding:10px 12px;font-family:'Cabinet Grotesk',sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">User</th>
              <th style="padding:10px 12px;font-family:'Cabinet Grotesk',sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Email</th>
              <th style="padding:10px 12px;font-family:'Cabinet Grotesk',sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Source</th>
            </tr>
          </thead>
          <tbody>
            ${recent.map(r => `
              <tr style="border-bottom:1px solid var(--border)">
                <td style="padding:10px 12px;font-family:'DM Mono',monospace;font-size:13px;color:var(--muted);white-space:nowrap">${esc(fmtDate(r.created_at))}</td>
                <td style="padding:10px 12px;font-weight:600">${esc(r.display_name || '(no name)')}</td>
                <td style="padding:10px 12px;color:var(--muted);font-size:13px">${esc(r.email || '—')}</td>
                <td style="padding:10px 12px">${sourceLabel(r.source)}${r.source === 'other' && r.source_other ? ` <span style="color:var(--muted)">· ${esc(r.source_other)}</span>` : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        </div>`}
      </div>`;

    // Wire up day-tab clicks
    wrap.querySelectorAll('.attr-day-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        days = parseInt(btn.dataset.days, 10) || 30;
        loadAll();
      });
    });
  }

  // ── navigation ─────────────────────────────────────
  function switchTo() {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.drawer-item').forEach(i => i.classList.remove('active'));
    document.getElementById('page-attribution')?.classList.add('active');
    document.getElementById('nav-attribution')?.classList.add('active');
    document.getElementById('mob-nav-attribution')?.classList.add('active');
    const title = document.getElementById('mobilePageTitle');
    if (title) title.textContent = 'Attribution';
    loadAll();
  }

  // ── DOM injection ──────────────────────────────────
  function inject() {
    // Sidebar — under the Promotions section added by admin-giveaway.js
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && !document.getElementById('nav-attribution')) {
      const item = document.createElement('div');
      item.className = 'sidebar-item';
      item.id = 'nav-attribution';
      item.style.cursor = 'pointer';
      item.innerHTML = `📊 Attribution`;
      item.addEventListener('click', switchTo);
      // Try to insert after the Giveaway nav item; fall back to bottom
      const giveawayNav = document.getElementById('nav-giveaway');
      if (giveawayNav && giveawayNav.parentNode) {
        giveawayNav.parentNode.insertBefore(item, giveawayNav.nextSibling);
      } else {
        sidebar.appendChild(item);
      }
    }

    // Mobile drawer
    const drawer = document.getElementById('mobileDrawer');
    if (drawer && !document.getElementById('mob-nav-attribution')) {
      const btn = document.createElement('button');
      btn.className = 'drawer-item';
      btn.id = 'mob-nav-attribution';
      btn.innerHTML = `📊 Attribution`;
      btn.addEventListener('click', () => {
        switchTo();
        if (typeof window.closeMobileMenu === 'function') window.closeMobileMenu();
      });
      const giveawayMob = document.getElementById('mob-nav-giveaway');
      if (giveawayMob && giveawayMob.parentNode) {
        giveawayMob.parentNode.insertBefore(btn, giveawayMob.nextSibling);
      } else {
        const footer = drawer.querySelector('.drawer-footer');
        if (footer) drawer.insertBefore(btn, footer);
        else drawer.appendChild(btn);
      }
    }

    // Page
    const main = document.querySelector('.main-content');
    if (main && !document.getElementById('page-attribution')) {
      const page = document.createElement('div');
      page.className = 'page';
      page.id = 'page-attribution';
      page.innerHTML = `
        <div class="page-title">📊 Signup Attribution</div>
        <div class="page-sub">
          Self-reported source from the onboarding flow.
          Use this to figure out which channels are actually bringing people in.
        </div>
        <div id="attribution-content"></div>
      `;
      main.appendChild(page);
    }
  }

  // ── bootstrap ──────────────────────────────────────
  function init() {
    // Wait until admin-giveaway.js has injected (it adds the Promotions
    // sidebar label we want to live near). 250ms is plenty in practice.
    setTimeout(inject, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
