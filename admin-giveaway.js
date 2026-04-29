/* admin-giveaway.js
 * Injects a "🎁 Giveaway" tab into the existing admin portal (admin.html).
 * Loaded via the Vercel edge wrapper at /admin.html (see api/admin-page.js).
 * Reads admin session from localStorage['spotd-admin-session'] — same as admin.html.
 *
 * The page shows:
 *   - This week's leaderboard: every user with entries, their self/referral
 *     counts, and email so you can reach out manually.
 *   - "Pick random winner" button — picks weighted-random by entry count
 *     and records the winner. Strictly local randomness, then stamped to DB.
 *   - "Record winner" — manually pick a specific user (e.g. via UI click).
 *   - Past winners with prize_status workflow (pending → sent → delivered).
 *
 * All RPCs are gated server-side by is_giveaway_admin() so a non-admin auth
 * user can't read other users' entries by hitting the RPC directly.
 */
(function () {
  'use strict';

  const SUPABASE_URL  = 'https://opcskuzbdfrlnyhraysk.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_M97B-GmwsRF6xPVahp_ytw_49nI9igs';
  const LS_KEY        = 'spotd-admin-session';

  // ── auth + rest helpers ─────────────────────────────
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

  // Use the persisted refresh_token to mint a fresh access_token.
  // Returns true on success, false if the refresh token is missing or rejected
  // (in which case the user has to sign in again).
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
          // refresh token is no good; clear stale session bits but leave user
          // info so the existing login form pre-fills the email if you want.
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
      } catch (e) {
        return false;
      } finally {
        _refreshInFlight = null;
      }
    })();
    return _refreshInFlight;
  }

  function isJwtExpiredError(payload) {
    if (!payload) return false;
    const msg  = (payload.message || payload.error || payload.code || '').toString().toLowerCase();
    return msg.includes('jwt expired') || msg.includes('jwt_expired') || payload.code === 'PGRST301';
  }

  async function rpc(name, body) {
    const send = () => fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method:  'POST',
      headers: hdrs(),
      body:    JSON.stringify(body || {}),
    });

    let r = await send();
    let text = await r.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }

    // Auto-refresh on JWT expiry: refresh + retry once
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

  // ── utils ───────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch (e) { return ''; }
  }
  function toast(msg) {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--ink,#111);color:var(--bg,#fff);padding:10px 20px;border-radius:10px;z-index:99999;font-family:"DM Sans",sans-serif;font-size:13px;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,0.2)';
    d.textContent = msg;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 2600);
  }
  // Monday of last ISO week (PT) — "the week we're judging today"
  function lastMondayPT() {
    // Supabase function gives us THIS week's Monday in PT — easier to call it.
    return null; // we let the server compute it via current_week_start_pt() implicitly
  }

  // ── state ───────────────────────────────────────────
  let leaderboard  = [];
  let winners      = [];
  let weekStart    = null;       // YYYY-MM-DD (PT Monday) currently shown
  let weekChoice   = 'this';     // 'this' | 'last' | 'custom'

  // ── data loaders ────────────────────────────────────
  async function loadLeaderboard() {
    const el = document.getElementById('giveaway-leaderboard');
    if (el) el.innerHTML = '<div style="padding:24px;color:var(--muted);text-align:center">Loading…</div>';

    try {
      const arg = weekStart ? { p_week_start: weekStart } : {};
      const data = await rpc('admin_giveaway_leaderboard', arg);
      leaderboard = Array.isArray(data) ? data : [];
      // capture the week the server returned (used for "record winner" calls)
      if (leaderboard.length && leaderboard[0].week_start) {
        weekStart = leaderboard[0].week_start;
      }
      renderHeader();
      renderLeaderboard();
    } catch (e) {
      if (el) el.innerHTML = `<div style="padding:24px;color:var(--coral);text-align:center">Error: ${esc(e.message)}</div>`;
    }
  }

  async function loadWinners() {
    const el = document.getElementById('giveaway-winners');
    if (el) el.innerHTML = '<div style="padding:24px;color:var(--muted);text-align:center">Loading…</div>';
    try {
      const data = await rpc('admin_list_winners', { p_limit: 30 });
      winners = Array.isArray(data) ? data : [];
      renderWinners();
    } catch (e) {
      if (el) el.innerHTML = `<div style="padding:24px;color:var(--coral);text-align:center">Error: ${esc(e.message)}</div>`;
    }
  }

  // ── rendering ──────────────────────────────────────
  function renderHeader() {
    const total = leaderboard.reduce((sum, r) => sum + (r.total_entries || 0), 0);
    const users = leaderboard.length;
    const week  = weekStart || '—';
    const stats = document.getElementById('giveaway-stats');
    if (!stats) return;
    stats.innerHTML = `
      <span class="kpi-card" style="cursor:default">
        <div class="kpi-label">Week of</div>
        <div class="kpi-value" style="font-family:'DM Mono',monospace">${esc(week)}</div>
      </span>
      <span class="kpi-card" style="cursor:default">
        <div class="kpi-label">Users in pool</div>
        <div class="kpi-value">${users}</div>
      </span>
      <span class="kpi-card" style="cursor:default">
        <div class="kpi-label">Total entries (tickets)</div>
        <div class="kpi-value">${total}</div>
      </span>`;
  }

  function renderLeaderboard() {
    const el = document.getElementById('giveaway-leaderboard');
    if (!el) return;
    if (!leaderboard.length) {
      el.innerHTML = `<div style="padding:32px;text-align:center;color:var(--muted)">
        No entries yet for the week of ${esc(weekStart || '—')}.
      </div>`;
      return;
    }

    el.innerHTML = `
      <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:var(--bg2);text-align:left">
            <th style="padding:10px 12px;font-family:'Cabinet Grotesk',sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">User</th>
            <th style="padding:10px 12px;font-family:'Cabinet Grotesk',sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Email</th>
            <th style="padding:10px 12px;font-family:'Cabinet Grotesk',sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;text-align:right">Self</th>
            <th style="padding:10px 12px;font-family:'Cabinet Grotesk',sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;text-align:right">Referral</th>
            <th style="padding:10px 12px;font-family:'Cabinet Grotesk',sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;text-align:right">Total</th>
            <th style="padding:10px 12px;font-family:'Cabinet Grotesk',sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Code</th>
            <th style="padding:10px 12px"></th>
          </tr>
        </thead>
        <tbody>
          ${leaderboard.map(r => `
            <tr style="border-bottom:1px solid var(--border)">
              <td style="padding:10px 12px;font-weight:600">${esc(r.display_name || '(no name)')}</td>
              <td style="padding:10px 12px;color:var(--muted);font-size:13px">
                ${r.email ? `<a href="mailto:${esc(r.email)}?subject=${encodeURIComponent('You won the Spotd $25 weekly giveaway 🎉')}" style="color:var(--coral);text-decoration:none">${esc(r.email)}</a>` : '<span style="color:var(--muted)">—</span>'}
              </td>
              <td style="padding:10px 12px;text-align:right;font-family:'DM Mono',monospace">${r.self_entry || 0}</td>
              <td style="padding:10px 12px;text-align:right;font-family:'DM Mono',monospace">${r.referral_bonus ? '+' + r.referral_bonus : '0'}</td>
              <td style="padding:10px 12px;text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:var(--coral)">${r.total_entries || 0}</td>
              <td style="padding:10px 12px"><code style="background:var(--bg);padding:2px 8px;border-radius:6px;font-size:12px">${esc(r.code || '—')}</code></td>
              <td style="padding:10px 12px;text-align:right">
                <button class="btn-action giveaway-btn-pick" data-user-id="${esc(r.user_id)}" data-user-name="${esc(r.display_name || r.email || r.user_id)}"
                        style="background:var(--coral);color:#fff;border:none;padding:6px 12px;border-radius:8px;font-weight:600;font-size:12px;cursor:pointer">
                  Choose as winner
                </button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>`;
  }

  function renderWinners() {
    const el = document.getElementById('giveaway-winners');
    if (!el) return;
    if (!winners.length) {
      el.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted)">No winners yet.</div>`;
      return;
    }

    el.innerHTML = `
      <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:var(--bg2);text-align:left">
            <th style="padding:10px 12px;font-family:'Cabinet Grotesk',sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Week</th>
            <th style="padding:10px 12px;font-family:'Cabinet Grotesk',sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Winner</th>
            <th style="padding:10px 12px;font-family:'Cabinet Grotesk',sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Email</th>
            <th style="padding:10px 12px;font-family:'Cabinet Grotesk',sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;text-align:right">Tickets</th>
            <th style="padding:10px 12px;font-family:'Cabinet Grotesk',sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Status</th>
            <th style="padding:10px 12px"></th>
          </tr>
        </thead>
        <tbody>
          ${winners.map(w => {
            const pillBg = w.prize_status === 'delivered' ? '#2A1F14' : w.prize_status === 'sent' ? '#D6F2DD' : '#FFE9D6';
            const pillFg = w.prize_status === 'delivered' ? '#F5EFE6' : w.prize_status === 'sent' ? '#1F6B3A' : '#B05A18';
            return `
            <tr style="border-bottom:1px solid var(--border)">
              <td style="padding:10px 12px;font-family:'DM Mono',monospace">${esc(w.week_start)}</td>
              <td style="padding:10px 12px;font-weight:600">${esc(w.display_name || '(no name)')}</td>
              <td style="padding:10px 12px;color:var(--muted);font-size:13px">${w.email ? `<a href="mailto:${esc(w.email)}" style="color:var(--coral);text-decoration:none">${esc(w.email)}</a>` : '—'}</td>
              <td style="padding:10px 12px;text-align:right;font-family:'DM Mono',monospace">${w.winner_entry_count} / ${w.total_entries}</td>
              <td style="padding:10px 12px"><span style="background:${pillBg};color:${pillFg};padding:3px 10px;border-radius:999px;font-family:'DM Mono',monospace;font-size:11px;font-weight:500">${esc(w.prize_status)}</span></td>
              <td style="padding:10px 12px;text-align:right">
                ${w.prize_status === 'pending'  ? `<button class="giveaway-btn-status" data-week="${esc(w.week_start)}" data-status="sent"      style="background:var(--coral);color:#fff;border:none;padding:6px 12px;border-radius:8px;font-weight:600;font-size:12px;cursor:pointer">Mark sent</button>` : ''}
                ${w.prize_status === 'sent'     ? `<button class="giveaway-btn-status" data-week="${esc(w.week_start)}" data-status="delivered" style="background:#2A1F14;color:#F5EFE6;border:none;padding:6px 12px;border-radius:8px;font-weight:600;font-size:12px;cursor:pointer">Mark delivered</button>` : ''}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      </div>`;
  }

  // ── actions ─────────────────────────────────────────
  // Weighted random by entry count: each entry == one ticket.
  function pickWeightedRandom() {
    if (!leaderboard.length) return null;
    const total = leaderboard.reduce((s, r) => s + (r.total_entries || 0), 0);
    if (total <= 0) return null;
    let n = Math.floor(Math.random() * total);
    for (const r of leaderboard) {
      n -= (r.total_entries || 0);
      if (n < 0) return r;
    }
    return leaderboard[leaderboard.length - 1];
  }

  async function pickRandomWinner() {
    if (!leaderboard.length) { toast('No entries yet'); return; }
    const winner = pickWeightedRandom();
    if (!winner) { toast('No entries yet'); return; }
    const ok = confirm(
      `Random pick — weighted by entry count:\n\n` +
      `${winner.display_name || winner.email || winner.user_id}\n` +
      `${winner.email || ''}\n` +
      `${winner.total_entries} of ${leaderboard.reduce((s,r)=>s+r.total_entries,0)} tickets\n\n` +
      `Record this user as the winner for week ${weekStart}?`
    );
    if (!ok) return;
    await recordWinner(winner.user_id, winner.display_name || winner.email);
  }

  async function recordWinner(userId, label) {
    if (!weekStart) { toast('Week not set'); return; }
    try {
      await rpc('admin_record_winner', { p_week_start: weekStart, p_winner_user_id: userId });
      toast(`Winner recorded: ${label || userId}`);
      await loadWinners();
    } catch (e) {
      // 23505 = unique violation = already a winner for this week
      if ((e.message || '').includes('duplicate key') || (e.message || '').includes('23505')) {
        alert(`A winner has already been recorded for ${weekStart}. Look in the "Past Winners" table.`);
      } else {
        alert('Failed to record winner: ' + (e.message || e));
      }
    }
  }

  async function setStatus(week, status) {
    try {
      await rpc('admin_set_prize_status', { p_week_start: week, p_status: status });
      toast(`Marked ${status}`);
      await loadWinners();
    } catch (e) {
      alert('Failed: ' + (e.message || e));
    }
  }

  // ── navigation ──────────────────────────────────────
  function switchTo() {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.drawer-item').forEach(i => i.classList.remove('active'));
    document.getElementById('page-giveaway')?.classList.add('active');
    document.getElementById('nav-giveaway')?.classList.add('active');
    document.getElementById('mob-nav-giveaway')?.classList.add('active');
    const title = document.getElementById('mobilePageTitle');
    if (title) title.textContent = 'Giveaway';
    refresh();
  }

  function refresh() {
    loadLeaderboard();
    loadWinners();
  }

  function setWeekChoice(choice) {
    weekChoice = choice;
    if (choice === 'this') {
      weekStart = null; // server uses current_week_start_pt() default
    } else if (choice === 'last') {
      // compute last Monday in PT in JS
      const now = new Date();
      // shift to PT
      const ptStr = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
      const pt = new Date(ptStr);
      const day = pt.getDay(); // 0=Sun..6=Sat
      // ISO Monday: subtract (day === 0 ? 6 : day - 1) to get this week's Monday
      const thisMondayOffset = (day === 0 ? 6 : day - 1);
      const mon = new Date(pt);
      mon.setDate(pt.getDate() - thisMondayOffset - 7);
      weekStart = mon.toISOString().slice(0,10);
    } else if (choice === 'custom') {
      const v = (document.getElementById('giveaway-week-input')?.value || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { toast('Use YYYY-MM-DD (Monday)'); return; }
      weekStart = v;
    }
    document.querySelectorAll('.giveaway-week-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.giveaway-week-tab[data-choice="${choice}"]`)?.classList.add('active');
    refresh();
  }

  // ── DOM injection ───────────────────────────────────
  function inject() {
    // Sidebar nav — append at the very bottom
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && !document.getElementById('nav-giveaway')) {
      const label = document.createElement('div');
      label.className = 'sidebar-label';
      label.style.cssText = 'margin-top:20px;margin-bottom:8px';
      label.textContent = 'Promotions';

      const item = document.createElement('div');
      item.className = 'sidebar-item';
      item.id = 'nav-giveaway';
      item.style.cursor = 'pointer';
      item.innerHTML = `🎁 Giveaway`;
      item.addEventListener('click', switchTo);

      sidebar.appendChild(label);
      sidebar.appendChild(item);
    }

    // Mobile drawer item
    const drawer = document.getElementById('mobileDrawer');
    if (drawer && !document.getElementById('mob-nav-giveaway')) {
      const sectionLabel = document.createElement('div');
      sectionLabel.className = 'drawer-section-label';
      sectionLabel.textContent = 'Promotions';

      const btn = document.createElement('button');
      btn.className = 'drawer-item';
      btn.id = 'mob-nav-giveaway';
      btn.innerHTML = `🎁 Giveaway`;
      btn.addEventListener('click', () => {
        switchTo();
        if (typeof window.closeMobileMenu === 'function') window.closeMobileMenu();
      });

      // Insert before the drawer footer
      const footer = drawer.querySelector('.drawer-footer');
      if (footer) {
        drawer.insertBefore(sectionLabel, footer);
        drawer.insertBefore(btn, footer);
      } else {
        drawer.appendChild(sectionLabel);
        drawer.appendChild(btn);
      }
    }

    // Main page container
    const main = document.querySelector('.main-content');
    if (main && !document.getElementById('page-giveaway')) {
      const page = document.createElement('div');
      page.className = 'page';
      page.id = 'page-giveaway';
      page.innerHTML = `
        <div class="page-title">🎁 Weekly Giveaway</div>
        <div class="page-sub">
          $25 gift card every Monday. Each entry = one ticket.
          Reach out manually to the winner via email.
        </div>

        <!-- Week selector -->
        <div style="display:flex;gap:6px;align-items:center;margin:8px 0 16px;flex-wrap:wrap">
          <button class="giveaway-week-tab active" data-choice="this"
                  style="padding:6px 14px;border-radius:999px;border:1px solid var(--border);background:var(--card);font-weight:600;font-size:13px;cursor:pointer">This week</button>
          <button class="giveaway-week-tab" data-choice="last"
                  style="padding:6px 14px;border-radius:999px;border:1px solid var(--border);background:var(--card);font-weight:600;font-size:13px;cursor:pointer">Last week</button>
          <button class="giveaway-week-tab" data-choice="custom"
                  style="padding:6px 14px;border-radius:999px;border:1px solid var(--border);background:var(--card);font-weight:600;font-size:13px;cursor:pointer">Custom</button>
          <input type="text" id="giveaway-week-input" placeholder="2026-04-27"
                 style="padding:6px 10px;border:1px solid var(--border);border-radius:8px;font-family:'DM Mono',monospace;font-size:13px;width:120px">
          <button id="giveaway-refresh"
                  style="margin-left:auto;padding:6px 14px;border-radius:8px;border:1px solid var(--border);background:var(--card);font-weight:600;font-size:13px;cursor:pointer">↻ Refresh</button>
        </div>

        <!-- Stats -->
        <div class="kpi-row" id="giveaway-stats" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px"></div>

        <!-- Leaderboard -->
        <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:24px">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border)">
            <div>
              <div style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Entries this week</div>
              <div style="font-size:12px;color:var(--muted);margin-top:2px">Click a user's email to draft a message · "Choose as winner" records them in the DB</div>
            </div>
            <button id="giveaway-pick-random"
                    style="background:var(--coral);color:#fff;border:none;padding:8px 16px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer">
              🎲 Pick random winner
            </button>
          </div>
          <div id="giveaway-leaderboard"></div>
        </div>

        <!-- Past winners -->
        <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden">
          <div style="padding:14px 16px;border-bottom:1px solid var(--border)">
            <div style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700">Past winners</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px">Mark sent once you've emailed the gift card · mark delivered once they confirm receipt</div>
          </div>
          <div id="giveaway-winners"></div>
        </div>
      `;
      main.appendChild(page);

      // wire interactions
      page.querySelectorAll('.giveaway-week-tab').forEach(btn => {
        btn.addEventListener('click', () => setWeekChoice(btn.dataset.choice));
      });
      page.querySelector('#giveaway-week-input').addEventListener('change', () => setWeekChoice('custom'));
      page.querySelector('#giveaway-refresh').addEventListener('click', refresh);
      page.querySelector('#giveaway-pick-random').addEventListener('click', pickRandomWinner);

      page.addEventListener('click', (ev) => {
        const pickBtn   = ev.target.closest('.giveaway-btn-pick');
        const statusBtn = ev.target.closest('.giveaway-btn-status');
        if (pickBtn) {
          const id    = pickBtn.dataset.userId;
          const name  = pickBtn.dataset.userName;
          if (confirm(`Record ${name} as the winner for week ${weekStart}?`)) {
            recordWinner(id, name);
          }
        }
        if (statusBtn) {
          setStatus(statusBtn.dataset.week, statusBtn.dataset.status);
        }
      });

      // expose .active styling for week tabs
      const style = document.createElement('style');
      style.textContent = `
        .giveaway-week-tab.active {
          background: var(--coral) !important;
          color: #fff !important;
          border-color: var(--coral) !important;
        }
      `;
      document.head.appendChild(style);
    }
  }

  // ── bootstrap ───────────────────────────────────────
  function init() {
    inject();
    // No initial load — only fires when the user clicks the tab.
    // (Avoids fetching 100+ rows on every admin page open.)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 200));
  } else {
    setTimeout(init, 200);
  }
})();
