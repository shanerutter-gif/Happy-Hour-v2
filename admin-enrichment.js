/* admin-enrichment.js
 * Self-contained Venue Enrichment UI injected into admin.html.
 * Loaded via the Vercel edge wrapper at /admin.html (see api/admin-page.js).
 *
 * What it does:
 *   1. Preview — counts active venues per city, how many need place_id,
 *      how many lack a photo, and shows estimated cost
 *   2. Run — kicks off batched enrichment (5 venues per call), loops until
 *      done, streams results live, with a stop button
 *   3. Log — last 30 enrichment_runs rows with status, fields filled, cost
 */
(function () {
  'use strict';

  const SUPABASE_URL  = 'https://opcskuzbdfrlnyhraysk.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_M97B-GmwsRF6xPVahp_ytw_49nI9igs';
  const LS_KEY        = 'spotd-admin-session';
  const ENDPOINT      = '/api/admin-enrich-venues';

  // ── auth + helpers ────────────────────────────────
  function session() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; }
  }
  function token() { return session().token || ''; }

  async function api(method, body) {
    const url = method === 'GET' && body
      ? `${ENDPOINT}?${new URLSearchParams(body).toString()}`
      : ENDPOINT;
    const init = {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
    };
    if (method === 'POST') init.body = JSON.stringify(body || {});
    const r = await fetch(url, init);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  }

  async function sbGet(qs) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${qs}`, {
      headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + (token() || SUPABASE_ANON) },
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
    } catch (e) { return ''; }
  }
  function toast(msg) {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:10px 20px;border-radius:10px;z-index:99999;font-family:"DM Sans",sans-serif;font-size:13px;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,0.2)';
    d.textContent = msg;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 2600);
  }

  // ── state ─────────────────────────────────────────
  let running = false;
  let cancel  = false;

  // ── data + rendering ──────────────────────────────
  async function preview() {
    const city = document.getElementById('enrich-city').value;
    const out  = document.getElementById('enrich-preview-out');
    out.innerHTML = '<div style="color:var(--muted);font-size:13px">Loading…</div>';
    try {
      const data = await api('GET', { action: 'preview', city });
      out.innerHTML = `
        <div class="enrich-stats">
          <div class="enrich-stat"><div class="ev">${data.total_active}</div><div class="el">Active venues</div></div>
          <div class="enrich-stat"><div class="ev">${data.needs_enrichment}</div><div class="el">Need enrichment</div></div>
          <div class="enrich-stat"><div class="ev">${data.without_photo}</div><div class="el">Without photo</div></div>
          <div class="enrich-stat"><div class="ev">$${data.estimated_cost_usd}</div><div class="el">Est. cost</div></div>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-top:8px;font-family:'DM Sans',sans-serif">
          ~$${data.cost_per_venue_usd} per venue (find_place + details + ~3 photos avg)
        </div>`;
    } catch (e) {
      out.innerHTML = `<div style="color:var(--error);font-size:13px">${esc(e.message)}</div>`;
    }
  }

  function appendResult(r) {
    const log = document.getElementById('enrich-run-log');
    if (!log) return;
    const row = document.createElement('div');
    row.className = 'enrich-row';
    const statusColor = r.status === 'success' ? 'var(--success,#2A7A5A)'
      : r.status === 'no_match' ? '#B8860B'
      : r.status === 'dry_run' ? 'var(--muted)'
      : 'var(--error,#C0392B)';
    const fields  = (r.fields || []).join(', ');
    const photos  = r.photo_count ? ` · ${r.photo_count} photos` : '';
    const errPart = r.error ? ` · <span style="color:var(--error)">${esc(r.error)}</span>` : '';
    row.innerHTML = `
      <span class="enrich-dot" style="background:${statusColor}"></span>
      <span class="enrich-name">${esc(r.name || r.venue_id)}</span>
      <span class="enrich-meta">${esc(r.status)}${photos}${fields ? ' · ' + esc(fields) : ''}${errPart}</span>`;
    log.insertBefore(row, log.firstChild);
  }

  function setProgress(processed, total) {
    const bar = document.getElementById('enrich-bar-fill');
    const txt = document.getElementById('enrich-progress-text');
    if (bar && total > 0) {
      const pct = Math.min(100, Math.round((processed / total) * 100));
      bar.style.width = pct + '%';
    }
    if (txt) txt.textContent = `${processed} / ${total}`;
  }

  async function runBatch() {
    if (running) return;
    running = true;
    cancel  = false;

    const city      = document.getElementById('enrich-city').value;
    const dryRun    = document.getElementById('enrich-dry').checked;
    const force     = document.getElementById('enrich-force').checked;
    const batchSize = Math.max(1, Math.min(10, +document.getElementById('enrich-batch').value || 5));

    const log = document.getElementById('enrich-run-log');
    log.innerHTML = '';
    document.getElementById('enrich-run-btn').textContent = '⏸ Stop';
    document.getElementById('enrich-bar').style.display = 'block';

    let total = 0, processed = 0, totalCost = 0;
    try {
      // Get total upfront so the progress bar has a denominator
      const pre = await api('GET', { action: 'preview', city });
      total = pre.needs_enrichment;
      setProgress(0, total);

      while (!cancel) {
        const data = await api('POST', {
          action: 'batch', city, batch_size: batchSize, dry_run: dryRun, force,
        });
        (data.results || []).forEach(appendResult);
        processed += data.processed || 0;
        totalCost += data.total_cost_usd || 0;
        setProgress(Math.min(processed, total), total);
        if (data.done || (data.processed || 0) === 0) break;
      }
      toast(cancel ? 'Stopped' : `Done — $${totalCost.toFixed(3)} spent`);
    } catch (e) {
      toast('Error: ' + e.message);
      console.warn(e);
    } finally {
      running = false;
      cancel  = false;
      document.getElementById('enrich-run-btn').textContent = '▶ Run enrichment';
      loadRecent();
    }
  }

  function stopRun() {
    if (!running) return;
    cancel = true;
    document.getElementById('enrich-run-btn').textContent = 'Stopping…';
  }

  async function reEnrichOne() {
    const id = document.getElementById('enrich-single-id').value.trim();
    if (!id) { toast('Paste a venue id'); return; }
    const btn = document.getElementById('enrich-single-btn');
    btn.disabled = true; btn.textContent = 'Running…';
    try {
      const r = await api('POST', { action: 'venue', venue_id: id });
      appendResult(r);
      toast(`Done: ${r.status}`);
      loadRecent();
    } catch (e) {
      toast('Error: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Re-enrich';
    }
  }

  async function loadRecent() {
    const wrap = document.getElementById('enrich-recent');
    if (!wrap) return;
    try {
      const rows = await sbGet(
        'enrichment_runs?select=*,venue:venues(name,city_slug,neighborhood)' +
        '&order=started_at.desc&limit=30'
      );
      if (!Array.isArray(rows) || !rows.length) {
        wrap.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:14px">No runs yet.</div>';
        return;
      }
      wrap.innerHTML = rows.map(r => {
        const v = r.venue || {};
        const fields = (r.fields_filled || []).join(', ');
        const cost = r.cost_usd_micro ? '$' + (r.cost_usd_micro / 1_000_000).toFixed(4) : '';
        const dot = r.status === 'success' ? 'var(--success,#2A7A5A)'
          : r.status === 'no_match' ? '#B8860B'
          : r.status === 'failed' ? 'var(--error,#C0392B)'
          : 'var(--muted)';
        return `
        <div class="enrich-row">
          <span class="enrich-dot" style="background:${dot}"></span>
          <span class="enrich-name">${esc(v.name || r.venue_id)}</span>
          <span class="enrich-meta">${esc(r.status)}${r.photo_count ? ' · ' + r.photo_count + ' photos' : ''}${fields ? ' · ' + esc(fields) : ''}${r.error ? ' · ' + esc(r.error) : ''} · ${fmtDate(r.started_at)}${cost ? ' · ' + cost : ''}</span>
        </div>`;
      }).join('');
    } catch (e) {
      wrap.innerHTML = `<div style="color:var(--error);font-size:13px;padding:14px">${esc(e.message)}</div>`;
    }
  }

  // ── styles ────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('enrich-styles')) return;
    const s = document.createElement('style');
    s.id = 'enrich-styles';
    s.textContent = `
      .enrich-card{background:var(--bg2,#FAF7F2);border:1px solid var(--border,#EFE8DC);border-radius:14px;padding:18px;margin-bottom:16px}
      .enrich-card h3{font-family:'Cabinet Grotesk',sans-serif;font-size:15px;font-weight:800;margin:0 0 10px;letter-spacing:-0.2px}
      .enrich-row{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border,#EFE8DC);font-family:'DM Sans',sans-serif;font-size:13px}
      .enrich-row:last-child{border-bottom:none}
      .enrich-dot{width:8px;height:8px;border-radius:50%;flex:none}
      .enrich-name{font-weight:600;color:var(--text,#111);min-width:160px}
      .enrich-meta{color:var(--muted,#75695A);font-size:12px;flex:1}
      .enrich-stats{display:flex;gap:14px;flex-wrap:wrap}
      .enrich-stat{flex:1;min-width:120px;background:#fff;border:1px solid var(--border,#EFE8DC);border-radius:10px;padding:14px}
      .enrich-stat .ev{font-family:'Cabinet Grotesk',sans-serif;font-size:24px;font-weight:900;color:var(--text,#111)}
      .enrich-stat .el{font-family:'DM Sans',sans-serif;font-size:12px;color:var(--muted,#75695A);margin-top:2px}
      .enrich-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
      .enrich-controls label{font-family:'DM Sans',sans-serif;font-size:13px;color:var(--muted,#75695A);display:inline-flex;align-items:center;gap:6px}
      .enrich-controls select,.enrich-controls input[type="number"],.enrich-controls input[type="text"]{
        font-family:'DM Sans',sans-serif;font-size:13px;padding:8px 10px;border:1px solid var(--border,#EFE8DC);
        border-radius:8px;background:#fff;color:var(--text,#111)
      }
      .enrich-btn{background:var(--coral,#FF6B4A);color:#fff;border:none;border-radius:9px;padding:10px 18px;
        font-family:'DM Sans',sans-serif;font-size:13px;font-weight:700;cursor:pointer;transition:background .15s}
      .enrich-btn:hover{background:var(--coral2,#E5543A)}
      .enrich-btn.ghost{background:#fff;color:var(--text,#111);border:1px solid var(--border,#EFE8DC)}
      .enrich-btn:disabled{opacity:.5;cursor:not-allowed}
      .enrich-bar{display:none;background:var(--bg2,#FAF7F2);border-radius:9px;height:10px;margin:10px 0;overflow:hidden;position:relative}
      .enrich-bar-fill{height:100%;width:0;background:var(--coral,#FF6B4A);transition:width .25s}
      .enrich-progress{font-family:'DM Mono',monospace;font-size:12px;color:var(--muted,#75695A);margin-bottom:6px}
      .enrich-warning{background:rgba(232,148,58,0.08);border-left:3px solid #E8943A;border-radius:8px;
        padding:10px 14px;margin-bottom:12px;font-family:'DM Sans',sans-serif;font-size:13px;color:var(--text,#111)}
    `;
    document.head.appendChild(s);
  }

  // ── DOM injection ─────────────────────────────────
  function inject() {
    injectStyles();

    // Sidebar nav after All Venues
    const venuesNav = document.getElementById('nav-venues');
    if (venuesNav && !document.getElementById('nav-enrichment')) {
      const el = document.createElement('div');
      el.className = 'sidebar-item';
      el.id = 'nav-enrichment';
      el.style.cursor = 'pointer';
      el.innerHTML = `🪄 Enrichment`;
      el.addEventListener('click', switchTo);
      venuesNav.parentNode.insertBefore(el, venuesNav.nextSibling);
    }

    // Mobile drawer item after All Venues drawer
    const mobVenues = document.getElementById('mob-nav-venues');
    if (mobVenues && !document.getElementById('mob-nav-enrichment')) {
      const el = document.createElement('button');
      el.className = 'drawer-item';
      el.id = 'mob-nav-enrichment';
      el.innerHTML = `🪄 Enrichment`;
      el.addEventListener('click', () => {
        switchTo();
        if (typeof window.closeMobileMenu === 'function') window.closeMobileMenu();
      });
      mobVenues.parentNode.insertBefore(el, mobVenues.nextSibling);
    }

    // Main page container
    const main = document.querySelector('.main-content');
    if (main && !document.getElementById('page-enrichment')) {
      const page = document.createElement('div');
      page.className = 'page';
      page.id = 'page-enrichment';
      page.innerHTML = `
        <div class="page-title">🪄 Venue Enrichment</div>
        <div class="page-sub">Backfill <code>photo_url</code>, <code>phone</code>, <code>place_id</code>, <code>google_rating</code>, <code>price_level</code>, <code>hours</code>, and <code>url</code> from Google Places. Photos download to Supabase Storage. Existing values are preserved.</div>

        <div class="enrich-warning">
          Set <code>GOOGLE_PLACES_API_KEY</code> in Vercel env before running. Each venue costs ~$0.05 (find + details + 3 photos). Default city is Orange County — 225 venues, ~$11–15.
        </div>

        <div class="enrich-card">
          <h3>1 · Preview</h3>
          <div class="enrich-controls">
            <label>City
              <select id="enrich-city">
                <option value="orange-county" selected>Orange County</option>
                <option value="san-diego">San Diego</option>
              </select>
            </label>
            <button class="enrich-btn ghost" id="enrich-preview-btn">Refresh preview</button>
          </div>
          <div id="enrich-preview-out" style="margin-top:12px"></div>
        </div>

        <div class="enrich-card">
          <h3>2 · Run enrichment</h3>
          <div class="enrich-controls">
            <label>Batch size
              <input type="number" id="enrich-batch" value="5" min="1" max="10" style="width:64px">
            </label>
            <label><input type="checkbox" id="enrich-dry"> Dry run (no DB writes / no photo downloads)</label>
            <label><input type="checkbox" id="enrich-force"> Force (re-enrich already-enriched venues missing photos)</label>
            <button class="enrich-btn" id="enrich-run-btn">▶ Run enrichment</button>
          </div>
          <div class="enrich-bar" id="enrich-bar"><div class="enrich-bar-fill" id="enrich-bar-fill"></div></div>
          <div class="enrich-progress" id="enrich-progress-text"></div>
          <div id="enrich-run-log" style="margin-top:8px;max-height:340px;overflow-y:auto"></div>
        </div>

        <div class="enrich-card">
          <h3>3 · Re-enrich a single venue</h3>
          <div class="enrich-controls">
            <input type="text" id="enrich-single-id" placeholder="venue uuid" style="flex:1;min-width:240px">
            <button class="enrich-btn ghost" id="enrich-single-btn">Re-enrich</button>
          </div>
        </div>

        <div class="enrich-card">
          <h3>Recent runs</h3>
          <div id="enrich-recent"><div style="color:var(--muted);font-size:13px;padding:14px">Loading…</div></div>
        </div>
      `;
      main.appendChild(page);

      page.querySelector('#enrich-preview-btn').addEventListener('click', preview);
      page.querySelector('#enrich-run-btn').addEventListener('click', () => running ? stopRun() : runBatch());
      page.querySelector('#enrich-single-btn').addEventListener('click', reEnrichOne);
    }
  }

  // ── navigation ────────────────────────────────────
  function switchTo() {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.drawer-item').forEach(i => i.classList.remove('active'));
    document.getElementById('page-enrichment')?.classList.add('active');
    document.getElementById('nav-enrichment')?.classList.add('active');
    document.getElementById('mob-nav-enrichment')?.classList.add('active');
    const title = document.getElementById('mobilePageTitle');
    if (title) title.textContent = 'Venue Enrichment';
    preview();
    loadRecent();
  }

  // ── bootstrap ─────────────────────────────────────
  function init() {
    inject();
    // Don't auto-load until admin logs in
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      if (token()) {
        clearInterval(iv);
        // Pre-warm if user is on the page
        if (document.getElementById('page-enrichment')?.classList.contains('active')) {
          preview();
          loadRecent();
        }
      } else if (tries > 120) {
        clearInterval(iv);
      }
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 200));
  } else {
    setTimeout(init, 200);
  }
})();
