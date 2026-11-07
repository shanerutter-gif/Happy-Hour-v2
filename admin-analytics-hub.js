/* admin-analytics-hub.js
 * Consolidates the admin portal's scattered analytics pages into ONE sidebar
 * item — "📈 Analytics" — with a tab bar at the top of each child page:
 *
 *   🌐 Traffic (page-analytics, admin-analytics.js)
 *   🧭 Attribution (page-attribution, admin-attribution.js)
 *   📱 Social (page-social-analytics, admin-social-analytics.js)
 *   ✉️ Email (page-email-analytics, admin-email-analytics.js)
 *   🏆 Top Venues (page-venues-top, admin.html)
 *   🗺️ Cities (page-cities, admin.html)
 *
 * Before this, those six pages were six sidebar items split between "Insights"
 * and the bottom of "Tools". The Users hub (Overview / Activity / Churn) is
 * unchanged.
 *
 * Non-invasive by design: each page's own nav item is kept in the DOM but
 * HIDDEN, and the tabs simply .click() it — so every page's existing
 * switchTo()/showPage() + data loading runs exactly as before and none of the
 * six scripts had to change. A rAF-coalesced MutationObserver re-adds the tab
 * bar if a page re-renders, and lights up the hub item whenever any child page
 * is active (however it was opened — tab, dashboard link, deep showPage call).
 *
 * Also folds the single-item "Team" group into Tools.
 *
 * Must load LAST in SCRIPT_TAGS (api/admin-page.js) so the other scripts'
 * nav items exist to be hidden.
 */
(function () {
  'use strict';

  const TABS = [
    { page: 'analytics',        label: '🌐 Traffic' },
    { page: 'attribution',      label: '🧭 Attribution' },
    { page: 'social-analytics', label: '📱 Social' },
    { page: 'email-analytics',  label: '✉️ Email' },
    { page: 'venues-top',       label: '🏆 Top Venues' },
    { page: 'cities',           label: '🗺️ Cities' },
  ];
  const PAGES = new Set(TABS.map(t => t.page));
  const LS_LAST = 'spotd-admin-analytics-tab';

  function openTab(page) {
    try { localStorage.setItem(LS_LAST, page); } catch (e) {}
    const nav = document.getElementById('nav-' + page);
    if (nav) nav.click();
    else if (typeof window.showPage === 'function') window.showPage(page);
    schedule();
  }
  window.showAnalyticsHub = function (page) {
    let last = page;
    if (!last) { try { last = localStorage.getItem(LS_LAST); } catch (e) {} }
    if (!PAGES.has(last)) last = 'analytics';
    // A tab whose script hasn't injected its page yet → fall back to Traffic.
    if (!document.getElementById('page-' + last)) last = 'analytics';
    openTab(last);
  };

  function findLabel(container, cls, text) {
    if (!container) return null;
    return Array.from(container.querySelectorAll('.' + cls))
      .find(el => el.textContent.trim().toLowerCase() === text.toLowerCase()) || null;
  }

  function ensureHubNav() {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && !document.getElementById('nav-insights')) {
      const label = findLabel(sidebar, 'sidebar-label', 'Insights');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sidebar-item';
      btn.id = 'nav-insights';
      btn.textContent = '📈 Analytics';
      btn.addEventListener('click', () => window.showAnalyticsHub());
      if (label) {
        label.textContent = 'Analytics';
        label.parentNode.insertBefore(btn, label.nextSibling);
      } else {
        const users = document.getElementById('nav-users');
        if (users) users.parentNode.insertBefore(btn, users.nextSibling);
        else sidebar.appendChild(btn);
      }
    }
    const drawer = document.getElementById('mob-nav-dashboard')?.parentNode;
    if (drawer && !document.getElementById('mob-nav-insights')) {
      const label = findLabel(drawer, 'drawer-section-label', 'Insights');
      const btn = document.createElement('button');
      btn.className = 'drawer-item';
      btn.id = 'mob-nav-insights';
      btn.textContent = '📈 Analytics';
      btn.addEventListener('click', () => {
        if (typeof window.closeMobileMenu === 'function') window.closeMobileMenu();
        window.showAnalyticsHub();
      });
      if (label) {
        label.textContent = 'Analytics';
        label.parentNode.insertBefore(btn, label.nextSibling);
      } else {
        const users = document.getElementById('mob-nav-users');
        if (users) users.parentNode.insertBefore(btn, users.nextSibling);
      }
    }
  }

  function hideChildNavs() {
    TABS.forEach(t => {
      ['nav-', 'mob-nav-'].forEach(prefix => {
        const el = document.getElementById(prefix + t.page);
        if (el && el.style.display !== 'none') {
          el.style.display = 'none';
          el.setAttribute('aria-hidden', 'true');
        }
      });
    });
  }

  // "Team" was its own group with a single item — fold it into Tools.
  function foldTeam() {
    [['.sidebar', 'sidebar-label', 'nav-team', 'nav-cms'],
     [null, 'drawer-section-label', 'mob-nav-team', 'mob-nav-cms']].forEach(([sel, cls, teamId, toolsFirstId]) => {
      const team = document.getElementById(teamId);
      const toolsFirst = document.getElementById(toolsFirstId);
      if (!team || !toolsFirst || team.dataset.folded) return;
      const container = sel ? document.querySelector(sel) : team.parentNode;
      const label = findLabel(container, cls, 'Team');
      if (label) label.remove();
      // Append Team after the last nav item in the Tools run (stop at the next
      // section label or any non-nav element, e.g. the drawer's Sign Out footer).
      const prefix = teamId.replace('team', '');
      let last = toolsFirst;
      let n = toolsFirst.nextElementSibling;
      while (n && !n.classList.contains(cls) && n.id && n.id.startsWith(prefix)) { last = n; n = n.nextElementSibling; }
      last.parentNode.insertBefore(team, last.nextSibling);
      team.dataset.folded = '1';
    });
  }

  function tabBarHTML(activePage) {
    return TABS.filter(t => t.page === activePage || document.getElementById('page-' + t.page))
      .map(t => `<button type="button" class="hub-tab${t.page === activePage ? ' active' : ''}" data-hub-tab="${t.page}">${t.label}</button>`)
      .join('');
  }

  function ensureTabBars() {
    TABS.forEach(t => {
      const page = document.getElementById('page-' + t.page);
      if (!page) return;
      let bar = page.querySelector(':scope > .hub-tabs[data-hub="analytics"]');
      const html = tabBarHTML(t.page);
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'hub-tabs hub-tabs--analytics';
        bar.dataset.hub = 'analytics';
        bar.addEventListener('click', e => {
          const b = e.target.closest('[data-hub-tab]');
          if (b && !b.classList.contains('active')) openTab(b.dataset.hubTab);
        });
        const title = page.querySelector(':scope > .page-title');
        const sub = page.querySelector(':scope > .page-sub');
        const anchor = sub || title;
        if (anchor) anchor.parentNode.insertBefore(bar, anchor.nextSibling);
        else page.insertBefore(bar, page.firstChild);
      }
      if (bar.dataset.sig !== html) { bar.innerHTML = html; bar.dataset.sig = html; }
    });
  }

  function syncActive() {
    const active = document.querySelector('.main-content > .page.active, .page.active');
    const id = active && active.id ? active.id.replace(/^page-/, '') : '';
    const on = PAGES.has(id);
    ['nav-insights', 'mob-nav-insights'].forEach(nid => {
      const el = document.getElementById(nid);
      if (el) el.classList.toggle('active', on);
    });
    if (on) {
      const title = document.getElementById('mobilePageTitle');
      if (title && title.textContent !== 'Analytics') title.textContent = 'Analytics';
    }
  }

  let queued = false;
  function apply() {
    queued = false;
    try {
      ensureHubNav();
      hideChildNavs();
      foldTeam();
      ensureTabBars();
      syncActive();
    } catch (e) { console.warn('[analytics-hub]', e); }
  }
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(apply);
  }

  function injectCss() {
    if (document.getElementById('analytics-hub-css')) return;
    const st = document.createElement('style');
    st.id = 'analytics-hub-css';
    st.textContent = '.hub-tabs--analytics{max-width:none;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}' +
      '.hub-tabs--analytics::-webkit-scrollbar{display:none}' +
      '.hub-tabs--analytics .hub-tab{flex:0 0 auto;min-width:0}';
    document.head.appendChild(st);
  }

  function init() {
    injectCss();
    apply();
    // The other extension scripts inject their nav/pages on their own timers;
    // keep re-applying cheaply until they've all landed, then rely on the observer.
    let ticks = 0;
    const iv = setInterval(() => { apply(); if (++ticks > 40) clearInterval(iv); }, 500);
    const root = document.body;
    if (root && 'MutationObserver' in window) {
      new MutationObserver(schedule).observe(root, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['class'],
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 300));
  else setTimeout(init, 300);
})();
