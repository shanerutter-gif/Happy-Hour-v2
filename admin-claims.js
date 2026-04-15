/* admin-claims.js
 * Self-contained claims management UI that injects into the existing admin.html.
 * Loaded via the Vercel edge wrapper at /admin.html (see api/admin-page.js).
 * Reads admin session from localStorage['spotd-admin-session'] — same as admin.html.
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
  function hdrs() {
    const s = session();
    return {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_ANON,
      'Authorization': 'Bearer ' + (s.token || SUPABASE_ANON),
    };
  }
  async function sbGet(table, qs) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs || ''}`, { headers: hdrs() });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }
  async function sbPatch(table, id, data) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...hdrs(), 'Prefer': 'return=representation' },
      body: JSON.stringify(data),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }
  async function sbInsert(table, data) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...hdrs(), 'Prefer': 'return=representation' },
      body: JSON.stringify(data),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
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

  // ── state ───────────────────────────────────────────
  let allClaims = [];
  let filter = 'pending';

  // ── data ────────────────────────────────────────────
  async function loadClaims() {
    try {
      const data = await sbGet(
        'venue_claims',
        'select=*,venue:venues(name,neighborhood,city_slug)&order=created_at.desc'
      );
      allClaims = Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('[claims] loadClaims failed (likely not logged in):', e.message);
      allClaims = [];
    }
    updateCounts();
    render();
  }

  function updateCounts() {
    const pending = allClaims.filter(c => c.status === 'pending').length;
    const side = document.getElementById('sidebar-claims-count');
    if (side) { side.textContent = pending; side.classList.toggle('zero', pending === 0); }
    const kpi = document.getElementById('kpi-claims');
    if (kpi) kpi.textContent = pending;
    const mob = document.getElementById('mob-claims-badge');
    if (mob) { mob.textContent = pending || ''; mob.classList.toggle('show', pending > 0); }
    const tab = document.getElementById('tab-claims-pending-count');
    if (tab) tab.textContent = pending ? `(${pending})` : '';
  }

  function setFilter(f, btn) {
    filter = f;
    document.querySelectorAll('#claims-tabs .status-tab').forEach(t => t.classList.remove('active'));
    if (btn) btn.classList.add('active');
    render();
  }

  function render() {
    const el = document.getElementById('claims-list');
    if (!el) return;
    const list = filter === 'all' ? allClaims : allClaims.filter(c => c.status === filter);
    if (!list.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">${filter === 'pending' ? '🎉' : '📭'}</div><h3>${filter === 'pending' ? 'No pending claims' : 'No ' + filter + ' claims'}</h3><p></p></div>`;
      return;
    }
    el.innerHTML = list.map(c => {
      const v = c.venue || {};
      const name = v.name || '(venue removed)';
      const loc = [v.neighborhood, v.city_slug].filter(Boolean).join(' · ');
      return `
      <div class="request-card" id="claim-${c.id}">
        <div class="req-header">
          <div>
            <div class="req-name">${esc(name)}</div>
            <div class="req-meta">
              ${loc ? esc(loc) + ' · ' : ''}
              ${fmtDate(c.created_at)}
            </div>
          </div>
          <span class="req-status ${c.status}">${c.status}</span>
        </div>
        <div class="req-reason-label">Contact</div>
        <div class="req-reason">
          ${c.contact_name ? esc(c.contact_name) : '(no name)'}${c.business_name ? ' · ' + esc(c.business_name) : ''}<br>
          ${c.contact_email ? `<a href="mailto:${esc(c.contact_email)}" style="color:var(--coral);text-decoration:none">${esc(c.contact_email)}</a>` : ''}
          ${c.contact_phone ? ` · <a href="tel:${esc(c.contact_phone)}" style="color:var(--coral);text-decoration:none">${esc(c.contact_phone)}</a>` : ''}
        </div>
        ${c.notes ? `<div class="req-reason-label">Notes</div><div class="req-reason">${esc(c.notes)}</div>` : ''}
        <div class="req-actions">
          ${c.status === 'pending' ? `
            <button class="btn-approve" data-action="approve" data-id="${c.id}">✓ Approve &amp; Verify Venue</button>
            <button class="btn-reject"  data-action="reject"  data-id="${c.id}">✕ Reject</button>
          ` : ''}
          ${c.status === 'rejected' ? `<button class="btn-restore" data-action="restore" data-id="${c.id}">↩ Restore to Pending</button>` : ''}
          ${c.status === 'approved' ? `<span style="font-size:12px;color:var(--muted);font-family:'DM Sans',sans-serif">Approved ✓ ${c.reviewed_at ? fmtDate(c.reviewed_at) : ''}</span>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  // ── actions ─────────────────────────────────────────
  async function approve(id) {
    const c = allClaims.find(x => x.id === id);
    if (!c) return;
    if (!confirm(`Approve claim for "${c.venue?.name || 'this venue'}"?\n\nThis will:\n• Mark the venue as owner_verified = true\n• Import the contact into CRM\n• Set status to approved`)) return;

    const now = new Date().toISOString();
    const reviewer = session().user?.id || null;

    try {
      // 1. flip claim to approved
      await sbPatch('venue_claims', id, { status: 'approved', reviewed_at: now, reviewed_by: reviewer });

      // 2. mark venue as owner-verified
      if (c.venue_id) await sbPatch('venues', c.venue_id, { owner_verified: true });

      // 3. best-effort CRM import
      try {
        const contacts = await sbInsert('crm_contacts', {
          contact_name:  c.contact_name  || 'Unknown',
          business_name: c.business_name || c.venue?.name || null,
          email:         c.contact_email || null,
          phone:         c.contact_phone || null,
          city_slug:     c.venue?.city_slug || null,
          venue_id:      c.venue_id || null,
          source:        'venue_claim',
          stage:         'won',
        });
        const nc = Array.isArray(contacts) ? contacts[0] : null;
        if (nc?.id) {
          await sbInsert('crm_activities', {
            contact_id:    nc.id,
            activity_type: 'claim_approved',
            description:   `Venue claim approved for ${c.venue?.name || 'venue'}`,
            meta:          { claim_id: id, venue_id: c.venue_id },
          });
        }
      } catch (crmErr) { console.warn('[claims] CRM import skipped:', crmErr); }

      c.status = 'approved'; c.reviewed_at = now; c.reviewed_by = reviewer;
      updateCounts(); render();
      toast('Claim approved — venue marked verified');
    } catch (e) {
      alert('Failed to approve: ' + (e.message || e));
    }
  }

  async function reject(id) {
    const c = allClaims.find(x => x.id === id);
    if (!c) return;
    const reason = prompt(`Reject claim for "${c.venue?.name || 'this venue'}"?\n\nOptional reason (appended to notes):`);
    if (reason === null) return;

    const now      = new Date().toISOString();
    const reviewer = session().user?.id || null;
    const newNotes = reason
      ? `${c.notes ? c.notes + '\n\n' : ''}[Rejected ${now.slice(0, 10)}] ${reason}`
      : (c.notes || null);

    try {
      await sbPatch('venue_claims', id, { status: 'rejected', reviewed_at: now, reviewed_by: reviewer, notes: newNotes });
      c.status = 'rejected'; c.reviewed_at = now; c.reviewed_by = reviewer; c.notes = newNotes;
      updateCounts(); render();
      toast('Claim rejected');
    } catch (e) {
      alert('Failed to reject: ' + (e.message || e));
    }
  }

  async function restore(id) {
    try {
      await sbPatch('venue_claims', id, { status: 'pending', reviewed_at: null, reviewed_by: null });
      const c = allClaims.find(x => x.id === id);
      if (c) { c.status = 'pending'; c.reviewed_at = null; c.reviewed_by = null; }
      updateCounts(); render();
      toast('Restored to pending');
    } catch (e) {
      alert('Failed to restore: ' + (e.message || e));
    }
  }

  // ── navigation ──────────────────────────────────────
  function switchTo() {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.drawer-item').forEach(i => i.classList.remove('active'));
    document.getElementById('page-claims')?.classList.add('active');
    document.getElementById('nav-claims')?.classList.add('active');
    document.getElementById('mob-nav-claims')?.classList.add('active');
    const title = document.getElementById('mobilePageTitle');
    if (title) title.textContent = 'Business Claims';
    loadClaims();
  }

  // ── DOM injection ───────────────────────────────────
  function inject() {
    // Sidebar nav after Venue Requests
    const reqNav = document.getElementById('nav-requests');
    if (reqNav && !document.getElementById('nav-claims')) {
      const el = document.createElement('div');
      el.className = 'sidebar-item';
      el.id = 'nav-claims';
      el.style.cursor = 'pointer';
      el.innerHTML = `🏷️ Claims <span class="sidebar-count zero" id="sidebar-claims-count">—</span>`;
      el.addEventListener('click', switchTo);
      reqNav.parentNode.insertBefore(el, reqNav.nextSibling);
    }

    // Mobile drawer item after Venue Requests drawer
    const mobReq = document.getElementById('mob-nav-requests');
    if (mobReq && !document.getElementById('mob-nav-claims')) {
      const el = document.createElement('button');
      el.className = 'drawer-item';
      el.id = 'mob-nav-claims';
      el.innerHTML = `🏷️ Claims <span class="mob-badge" id="mob-claims-badge"></span>`;
      el.addEventListener('click', () => {
        switchTo();
        if (typeof window.closeMobileMenu === 'function') window.closeMobileMenu();
      });
      mobReq.parentNode.insertBefore(el, mobReq.nextSibling);
    }

    // Main page container
    const main = document.querySelector('.main-content');
    if (main && !document.getElementById('page-claims')) {
      const page = document.createElement('div');
      page.className = 'page';
      page.id = 'page-claims';
      page.innerHTML = `
        <div class="page-title">🏷️ Business Claims</div>
        <div class="page-sub">Business owners claiming ownership of their venue. Approve to mark the venue as <strong>owner_verified</strong> and import the contact into CRM.</div>
        <div class="status-tabs" id="claims-tabs">
          <button class="status-tab active" data-filter="pending">Pending <span id="tab-claims-pending-count"></span></button>
          <button class="status-tab" data-filter="approved">Approved</button>
          <button class="status-tab" data-filter="rejected">Rejected</button>
          <button class="status-tab" data-filter="all">All</button>
        </div>
        <div id="claims-list"></div>
      `;
      main.appendChild(page);
      page.querySelectorAll('.status-tab').forEach(btn => {
        btn.addEventListener('click', () => setFilter(btn.dataset.filter, btn));
      });
      page.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-action]');
        if (!btn) return;
        const id = btn.dataset.id;
        const action = btn.dataset.action;
        if (action === 'approve') approve(id);
        else if (action === 'reject') reject(id);
        else if (action === 'restore') restore(id);
      });
    }

    // KPI card after Business Users on User Analytics page
    const bizKpi = document.getElementById('kpi-business');
    const card = bizKpi ? bizKpi.closest('.kpi-card') : null;
    if (card && !document.getElementById('kpi-claims')) {
      const n = document.createElement('div');
      n.className = 'kpi-card';
      n.style.cursor = 'pointer';
      n.title = 'View claims';
      n.addEventListener('click', switchTo);
      n.innerHTML = `
        <div class="kpi-label">Claim Requests</div>
        <div class="kpi-value" id="kpi-claims">—</div>
        <div class="kpi-sub">Pending review</div>
      `;
      card.parentNode.insertBefore(n, card.nextSibling);
    }
  }

  // ── bootstrap ───────────────────────────────────────
  function init() {
    inject();
    loadClaims();
    // Re-load when admin logs in (session appears in localStorage)
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      const s = session();
      if (s && s.token) {
        clearInterval(iv);
        loadClaims();
      } else if (tries > 120) { // give up after ~3 min
        clearInterval(iv);
      }
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 150));
  } else {
    setTimeout(init, 150);
  }
})();
