/* ═══════════════════════════════════════════════════════
   SPOTS-STATUS.JS — hydrates the open/closed pill on the SSR
   /spots/<slug> pages. The server renders the grouped schedule
   table plus an EMPTY pill placeholder carrying the venue's
   hours/days/city; the verdict itself is never baked into the
   (day-cached) HTML, where it would go stale. This script
   computes it at view time with the canonical parser in
   js/schedule.js, through the exact gate the in-app modal
   uses: parse → require parsed.ok → zonedNow(city) → status.
   Any failure removes the placeholder and the page keeps the
   schedule table + raw hours — never a guessed verdict.
   ═══════════════════════════════════════════════════════ */
(function () {
  function hydrate() {
    var el = document.querySelector('[data-open-status]');
    if (!el) return;
    try {
      var hours = el.getAttribute('data-hours') || '';
      var days = (el.getAttribute('data-days') || '').split(',').filter(Boolean);
      var city = el.getAttribute('data-city') || '';
      var parsed = parseVenueHours(hours, normDaysAbbrev(days));
      if (!parsed.ok) { el.remove(); return; }
      var now = zonedNow(city);
      if (!now) { el.remove(); return; } // unmapped city: fail closed
      var st = getOpenStatus(parsed, now.dayName, now.mins);
      el.className = 'sched-status sched-status--' + st.state;
      el.innerHTML = '<span class="sched-dot"></span><span></span>';
      el.lastChild.textContent = st.label;
      el.style.display = '';
    } catch (e) {
      try { el.remove(); } catch (e2) {}
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hydrate);
  else hydrate();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') hydrate();
  });
})();
