/* ═══════════════════════════════════════════════════════
   APP.JS — Spotd UI Logic
   Home · City View · Happy Hours · Events · Map · Auth
   ═══════════════════════════════════════════════════════ */

const DAYS    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const TODAY   = DAYS[new Date().getDay()];

// Parse just today's hours from the full hours string
// e.g. "Mon 4–10pm, Thu 4–11pm, Fri 11am–2am" → "4–11pm" on Thu
function getTodayHours(v) {
  if (!v.hours) return '';
  const dayOrder = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const todayIdx = dayOrder.indexOf(TODAY);
  if (todayIdx === -1) return v.hours;

  // Split by ", " but be careful of ranges like "Mon–Thu"
  const segments = v.hours.split(/,\s*/);

  for (const seg of segments) {
    // Match patterns like "Mon–Thu 5–9pm" or "Fri 11am–2am" or "Mon–Sun 4pm–2am"
    const m = seg.match(/^([A-Z][a-z]+)(?:–([A-Z][a-z]+))?\s+(.+)$/);
    if (!m) continue;
    const startDay = m[1], endDay = m[2], time = m[3];
    const startIdx = dayOrder.indexOf(startDay);
    const endIdx   = endDay ? dayOrder.indexOf(endDay) : startIdx;
    if (startIdx === -1) continue;

    // Handle wrap-around ranges (e.g. Fri–Sun)
    let inRange = false;
    if (endIdx >= startIdx) {
      inRange = todayIdx >= startIdx && todayIdx <= endIdx;
    } else {
      inRange = todayIdx >= startIdx || todayIdx <= endIdx;
    }
    if (inRange) return time;
  }

  // No match for today — venue not open today
  return (v.days || []).includes(TODAY) ? v.hours : 'Not open today';
}
const EVENT_TYPES = ['Trivia','Live Music','Karaoke','Bingo','Game Night','Comedy'];
const HH_TYPES    = ['Bar','Brewery','Seafood','Mexican','Italian','Asian','BBQ','Wine Bar','Steakhouse','Beach Bar'];
const AMENITIES   = [
  { key: 'has_happy_hour',  label: 'Happy Hour',  emoji: '🍺', eventType: null },
  { key: 'has_sports_tv',   label: 'Sports TV',   emoji: '📺', eventType: null },
  { key: 'is_dog_friendly', label: 'Dog Friendly', emoji: '🐶', eventType: null },
  { key: 'has_live_music',  label: 'Live Music',   emoji: '🎵', eventType: 'Live Music' },
  { key: 'has_karaoke',     label: 'Karaoke',      emoji: '🎤', eventType: 'Karaoke' },
  { key: 'has_trivia',      label: 'Trivia',       emoji: '🧠', eventType: 'Trivia' },
  { key: 'has_bingo',       label: 'Bingo',        emoji: '🎯', eventType: 'Bingo' },
  { key: 'has_comedy',      label: 'Comedy',       emoji: '🎭', eventType: 'Comedy' },
];
// Map event_type string → amenity config
const EVENT_TYPE_AMENITY = {};
AMENITIES.forEach(a => { if (a.eventType) EVENT_TYPE_AMENITY[a.eventType] = a; });

const state = {
  sort: 'default',
  userLat: null,
  userLng: null,
  view: 'list',
  showFilter: 'all', // 'all' | 'happyhour' | 'events'
  filtersOpen: false, favFilterOn: false,
  filters: { day: null, area: null, type: null, amenity: null, search: '' },
  city: null,
  venues: [], events: [], filtered: [],
  activeItemId: null, activeItemType: 'venue',
  reviewCache: {}, reviewCacheTime: {},
  map: null, markers: {},
  goingCounts: {},
  goingByMe: new Set(),
  todayCheckInCount: 0   // tracked locally; enforces 5/day cap
};

const CACHE_MS = 60000;

document.addEventListener('DOMContentLoaded', () => {
  renderCityGrid();
  // Re-render nav in case auth session was restored before DOM was ready
  renderNav(currentUser);
  const ffg = document.getElementById('favFilterGroup');
  if (ffg) ffg.style.display = currentUser ? '' : 'none';

  // Detect password reset redirect from Supabase email link
  // Supabase appends #access_token=...&type=recovery to the URL
  const hash = window.location.hash;
  if (hash && hash.includes('type=recovery')) {
    // Parse tokens from hash and sign the user in so updateUser() works
    const params = new URLSearchParams(hash.replace('#', ''));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (accessToken) {
      db.auth.setSession({ access_token: accessToken, refresh_token: refreshToken || '' })
        .then(() => {
          window.history.replaceState({}, document.title, window.location.pathname);
          openResetPassword();
        })
        .catch(() => openResetPassword()); // show form anyway, updateUser will validate
    }
  }
});

function onAuthChange(user) {
  // Guard: DOM may not be ready if called during session restore
  if (!document.getElementById('navRight')) return;
  renderNav(user);
  const ffg = document.getElementById('favFilterGroup');
  if (ffg) ffg.style.display = user ? '' : 'none';
  if (!user && state.favFilterOn) { state.favFilterOn = false; applyFilters(); }
  if (state.city) renderCards();
  // Refresh unread badge whenever auth state changes
  if (user) dmRefreshBadge();
  // If user just signed in and had a pending city, enter it now
  if (user && window._pendingCity) {
    const { slug, name, stateCode } = window._pendingCity;
    window._pendingCity = null;
    enterCity(slug, name, stateCode);
  }
}

// ── NAV ────────────────────────────────────────────────
function renderNav(user) {
  // No top nav — render home CTA buttons
  const cta = document.getElementById('homeCta');
  if (cta) {
    if (!state.city) {
      cta.innerHTML = `<a class="home-cta-btn home-cta-sec" href="business-landing.html">For Business</a>`;
    }
  }
  renderBottomNav(user);
}

function renderBottomNav(user) {
  if (!user) {
    // No user — hide nav if it exists
    const bar = document.getElementById('bottomNav');
    if (bar) bar.style.display = 'none';
    return;
  }
  let bar = document.getElementById('bottomNav');
  if (!bar) {
    bar = document.createElement('nav');
    bar.id = 'bottomNav';
    bar.className = 'bottom-nav';
    bar.innerHTML = `
      <button class="bottom-nav-btn active" id="bnFeed" onclick="bottomNavFeed(this)">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        <span>Feed</span>
      </button>
      <button class="bottom-nav-btn" id="bnMessages" onclick="bottomNavMessages(this)">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span>Messages<span class="bn-badge" id="bnMsgBadge" style="display:none"></span></span>
      </button>
      <button class="bottom-nav-btn" id="bnProfile" onclick="bottomNavProfile(this)">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
        <span id="bnProfileLabel">${(user.user_metadata?.full_name || 'Profile').split(' ')[0]}</span>
      </button>`;
    document.body.appendChild(bar);
  } else {
    const lbl = document.getElementById('bnProfileLabel');
    if (lbl) lbl.textContent = (user.user_metadata?.full_name || 'Profile').split(' ')[0];
  }
  bar.style.display = 'flex';
}

function _navHideAll(keep) {
  // Just remove --open; pages stay in DOM at z-index 498 (behind the incoming page at 499)
  if (keep !== 'dm') closeDmPage();
  if (keep !== 'profile') closeProfile();
  closeSubPage('findPeoplePage');
  closeSubPage('feedPage');
  closeSubPage('leaderboardPage');
  closeOverlay('modalOverlay');
  closeOverlay('authOverlay');
  closeOverlay('pubProfileOverlay');
}

function bottomNavFeed(btn) {
  document.querySelectorAll('.bottom-nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _navHideAll();
  if (!state.city) showHome();
}

function bottomNavMessages(btn) {
  document.querySelectorAll('.bottom-nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _navHideAll('dm');
  openDmInbox();
}

function bottomNavProfile(btn) {
  document.querySelectorAll('.bottom-nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _navHideAll('profile');
  if (currentUser) openProfile();
  else openAuth('signin');
}
async function doSignOut() { await authSignOut(); showToast('Signed out'); }

// ── HOME ───────────────────────────────────────────────
function renderCityGrid() {
  const grid = document.getElementById('cityGrid');

  const cities = [
    { slug:'san-diego',    name:'San Diego',     state_code:'CA', venue_count:85, active:true  },
    { slug:'los-angeles',  name:'Los Angeles',   state_code:'CA', venue_count:0,  active:false },
    { slug:'new-york',     name:'New York',      state_code:'NY', venue_count:0,  active:false },
    { slug:'chicago',      name:'Chicago',       state_code:'IL', venue_count:0,  active:false },
    { slug:'austin',       name:'Austin',        state_code:'TX', venue_count:0,  active:false },
    { slug:'miami',        name:'Miami',         state_code:'FL', venue_count:0,  active:false },
    { slug:'orange-county',name:'Orange County', state_code:'CA', venue_count:0,  active:false },
  ];

  grid.innerHTML = cities.map(c => {
    const onclick = c.active ? `onclick="enterCity('${c.slug}','${c.name}','${c.state_code}')"` : '';
    const countBadge = c.active && c.venue_count ? `<div class="city-card-count">${c.venue_count}+ spots</div>` : '';
    return `<div class="city-card${c.active ? '' : ' coming'}" ${onclick}>
      <div class="city-card-name">${c.name}</div>
      <div class="city-card-state">${c.state_code}</div>
      ${countBadge}
    </div>`;
  }).join('');
}

function showHome() {
  document.getElementById('homePage').style.display = 'flex';
  document.getElementById('appPage').style.display  = 'none';
  state.city = null;
  state.venues = []; state.events = []; state.filtered = [];
  document.title = 'Spotd — Happy Hours & Events Near You';
  // Reset filters
  state.filters = { day: null, area: null, type: null, search: '' };
  state.favFilterOn = false;
  if (state.map) { state.map.remove(); state.map = null; state.markers = {}; }
  renderNav(currentUser);
}

async function enterCity(slug, name, stateCode) {
  // Gate: require sign-in before entering a city
  if (!currentUser) {
    openAuth('signin');
    // After sign-in completes, re-enter the city
    window._pendingCity = { slug, name, stateCode };
    return;
  }
  state.city = { slug, name, stateCode };
  document.getElementById('homePage').style.display = 'none';
  document.getElementById('appPage').style.display  = 'block';
  document.getElementById('cityBarName').textContent = `${name}, ${stateCode}`;
  document.title = `Spotd — ${name} Happy Hours & Events`;
  renderNav(currentUser);

  // Reset
  state.showFilter = 'all';
  state.filters.amenity = null;
  state.filters = { day: null, area: null, type: null, search: '' };
  state.favFilterOn = false;
  state.filtered = [];
  document.getElementById('searchBox').value = '';
  document.getElementById('filterPanel').classList.remove('open');
  document.getElementById('filterDot').classList.remove('show');
  document.getElementById('filterToggle').classList.remove('active');
  document.getElementById('chipsRow').innerHTML = '';
  // Reset select dropdowns
  ['dayFilters','areaFilters','typeFilters','amenityFilters'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.tagName === 'SELECT') el.selectedIndex = 0;
  });
  // Reset show filter pills
  ['showAll','showHH','showEV'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', id === 'showAll');
  });

  // Show loading
  document.getElementById('cardsGrid').innerHTML = `<div class="loading-state"><span class="loading-dot"></span><span class="loading-dot"></span><span class="loading-dot"></span></div>`;

  // Load data — venues AND events together
  const [venues, events] = await Promise.all([fetchVenues(slug), fetchEvents(slug)]);
  state.venues = venues;
  state.events = events;

  // Load checked in tonight counts
  loadGoingTonight(slug);

  // Bulk-load review averages so cards show ratings immediately
  loadReviewAverages(slug);

  // Build filter pills
  buildFilterPills();

  // Auto-enable nearest sort with geolocation
  state.sort = 'distance';
  document.querySelectorAll('#sortFilters .pill').forEach(b => b.classList.remove('active'));
  const nearBtn = document.getElementById('sort-distance');
  if (nearBtn) nearBtn.classList.add('active');
  document.getElementById('sort-default')?.classList.remove('active');

  if (state.userLat !== null) {
    applyFilters();
  } else if (navigator.geolocation) {
    if (nearBtn) { nearBtn.textContent = '📍 Locating…'; nearBtn.disabled = true; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        state.userLat = pos.coords.latitude;
        state.userLng = pos.coords.longitude;
        if (nearBtn) { nearBtn.textContent = '📍 Nearest'; nearBtn.disabled = false; }
        applyFilters();
      },
      () => {
        // Permission denied — fall back to default sort silently
        state.sort = 'default';
        if (nearBtn) { nearBtn.textContent = '📍 Nearest'; nearBtn.disabled = false; nearBtn.classList.remove('active'); }
        document.getElementById('sort-default')?.classList.add('active');
        applyFilters();
      },
      { timeout: 6000 }
    );
  } else {
    state.sort = 'default';
    if (nearBtn) nearBtn.classList.remove('active');
    document.getElementById('sort-default')?.classList.add('active');
    applyFilters();
  }

  initMap();
}

// ── SHOW FILTER ────────────────────────────────────────
function setShowFilter(val, btn) {
  state.showFilter = val;
  document.querySelectorAll('#showFilters .pill').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  buildTypeFilters();
  applyFilters(); updateChips(); updateDot();
}

// ── FILTERS ────────────────────────────────────────────
function buildFilterPills() {
  // Days — populate select
  const df = document.getElementById('dayFilters');
  df.innerHTML = '<option value="">All days</option>';
  DAYS.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d; opt.textContent = d + (d === TODAY ? ' ★' : '');
    df.appendChild(opt);
  });

  // Neighborhoods
  const allItems = [...state.venues, ...state.events];
  const areas = [...new Set(allItems.map(v => v.neighborhood).filter(Boolean))].sort();
  const af = document.getElementById('areaFilters');
  af.innerHTML = '<option value="">All neighborhoods</option>';
  areas.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a; opt.textContent = a;
    af.appendChild(opt);
  });

  buildTypeFilters();
}

function buildTypeFilters() {
  const tf = document.getElementById('typeFilters');
  const currentType = state.filters.type;
  tf.innerHTML = '<option value="">All types</option>';
  const types = state.showFilter === 'events'
    ? EVENT_TYPES
    : state.showFilter === 'happyhour'
      ? HH_TYPES
      : [...HH_TYPES, ...EVENT_TYPES];
  types.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t;
    if (t === currentType) opt.selected = true;
    tf.appendChild(opt);
  });

  // Amenity select
  const af = document.getElementById('amenityFilters');
  if (af) {
    const currentAmenity = state.filters.amenity;
    af.innerHTML = '<option value="">All amenities</option>';
    AMENITIES.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.key; opt.textContent = a.emoji + ' ' + a.label;
      if (a.key === currentAmenity) opt.selected = true;
      af.appendChild(opt);
    });
  }
}

function mkPill(label, onclick) {
  const b = document.createElement('button'); b.className = 'pill'; b.textContent = label; b.onclick = onclick; return b;
}
function clearAllFilters() {
  state.filters = { day: null, area: null, type: null, search: '', amenity: null };
  state.favFilterOn = false;
  document.getElementById('searchBox').value = '';
  ['dayFilters','areaFilters','typeFilters','amenityFilters'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.tagName === 'SELECT') el.selectedIndex = 0;
  });
  document.getElementById('chipsRow').innerHTML = '';
  document.getElementById('favFilterBtn')?.classList.remove('active');
  applyFilters(); updateDot();
}

function setFilterFromSelect(key, selectEl) {
  const val = selectEl.value || null;
  state.filters[key] = val;
  applyFilters(); updateChips(); updateDot();
}
function setFilter(key, val, btn) {
  if (state.filters[key] === val) { state.filters[key] = null; btn.classList.remove('active'); }
  else { btn.parentElement.querySelectorAll('.pill.active').forEach(b => b.classList.remove('active')); state.filters[key] = val; btn.classList.add('active'); }
  applyFilters(); updateChips(); updateDot();
}
function updateChips() {
  const row = document.getElementById('chipsRow'); row.innerHTML = '';
  const { day, area, type, search } = state.filters;
  if (day)    addChip(row, `Day: ${day}`,    () => clearFilter('day'));
  if (area)   addChip(row, `Area: ${area}`,  () => clearFilter('area'));
  if (type)   addChip(row, `Type: ${type}`,  () => clearFilter('type'));
  if (search) addChip(row, `"${search}"`,    () => { state.filters.search = ''; document.getElementById('searchBox').value = ''; applyFilters(); updateChips(); updateDot(); });
  if (state.filters.amenity) {
    const a = AMENITIES.find(x => x.key === state.filters.amenity);
    if (a) addChip(row, `${a.emoji} ${a.label}`, () => { state.filters.amenity = null; document.querySelectorAll('#amenityFilters .pill.active').forEach(b=>b.classList.remove('active')); applyFilters(); updateChips(); updateDot(); });
  }
  if (state.favFilterOn) addChip(row, '★ Saved', () => { state.favFilterOn = false; document.getElementById('favFilterBtn').classList.remove('active'); applyFilters(); updateChips(); });
}
function addChip(row, label, fn) {
  const c = document.createElement('div'); c.className = 'chip';
  c.innerHTML = `${label} <span class="chip-x">✕</span>`; c.onclick = fn; row.appendChild(c);
}
function clearFilter(key) {
  state.filters[key] = null;
  const m = { day: 'dayFilters', area: 'areaFilters', type: 'typeFilters' };
  document.querySelectorAll(`#${m[key]} .pill.active`).forEach(b => b.classList.remove('active'));
  applyFilters(); updateChips(); updateDot();
}
function updateDot() {
  const has = state.filters.day || state.filters.area || state.filters.type || state.favFilterOn;
  document.getElementById('filterDot').classList.toggle('show', !!has);
  document.getElementById('filterToggle').classList.toggle('active', !!has);
}
function applyFilters() {
  const search = (document.getElementById('searchBox')?.value || '').toLowerCase().trim();
  state.filters.search = search;

  // Events that belong to a venue live only inside the venue modal — never as standalone cards.
  const venueNames = new Set(state.venues.map(v => v.name.trim().toLowerCase()));
  const standaloneEvents = state.events.filter(e =>
    !e.venue_name || !venueNames.has(e.venue_name.trim().toLowerCase())
  );

  let pool;
  if (state.showFilter === 'happyhour') {
    pool = state.venues;
  } else if (state.showFilter === 'events') {
    pool = standaloneEvents;
  } else {
    pool = [...state.venues, ...standaloneEvents];
  }

  state.filtered = pool.filter(v => {
    const { day, area, type, amenity } = state.filters;
    const isEvent = !!v.event_type;

    if (day && !(v.days || []).includes(day)) return false;
    if (area && v.neighborhood !== area) return false;
    if (type) {
      const t = type.toLowerCase();
      const haystack = [v.name, v.neighborhood, v.cuisine, v.event_type, ...(v.deals || [])].join(' ').toLowerCase();
      if (!haystack.includes(t)) return false;
    }
    if (amenity) {
      const amenityDef = AMENITIES.find(a => a.key === amenity);
      if (isEvent) {
        // Events only pass through if their event_type matches this amenity
        if (!amenityDef?.eventType || v.event_type !== amenityDef.eventType) return false;
      } else {
        if (!v[amenity]) return false;
      }
    }
    if (search) {
      const h = [v.name, v.neighborhood, v.cuisine, v.address, v.event_type, ...(v.deals || [])].join(' ').toLowerCase();
      if (!h.includes(search)) return false;
    }
    if (state.favFilterOn && !isFavorite(v.id)) return false;
    return true;
  });

  // Sort
  if (state.sort === 'distance' && state.userLat !== null) {
    state.filtered.sort((a, b) => {
      const da = haversine(state.userLat, state.userLng, a.lat, a.lng);
      const db = haversine(state.userLat, state.userLng, b.lat, b.lng);
      return da - db;
    });
  } else if (state.sort === 'name') {
    state.filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } else {
    // Default: featured first, then alphabetical
    state.filtered.sort((a, b) => {
      if (b.featured !== a.featured) return (b.featured ? 1 : 0) - (a.featured ? 1 : 0);
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  renderCards();
  if (state.view === 'map') updateMapMarkers();
  const rc = document.getElementById('resultsCount');
  if (rc) rc.textContent = `${state.filtered.length} of ${pool.length} venues`;
}
// ── SORT & GEO ────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  if (lat2 == null || lng2 == null) return Infinity;
  const R = 3958.8; // miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function fmtDistance(miles) {
  if (miles === Infinity || miles == null) return '';
  if (miles < 0.1) return 'Here';
  if (miles < 10) return miles.toFixed(1) + ' mi';
  return Math.round(miles) + ' mi';
}

function setSort(val, btn) {
  state.sort = val;
  document.querySelectorAll('#sortFilters .pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  if (val === 'distance') {
    if (state.userLat !== null) {
      applyFilters();
    } else {
      btn.textContent = '📍 Locating…';
      btn.disabled = true;
      navigator.geolocation.getCurrentPosition(
        pos => {
          state.userLat = pos.coords.latitude;
          state.userLng = pos.coords.longitude;
          btn.textContent = '📍 Nearest';
          btn.disabled = false;
          applyFilters();
        },
        err => {
          showToast('Location access denied — enable in browser settings');
          state.sort = 'default';
          btn.textContent = '📍 Nearest';
          btn.disabled = false;
          document.getElementById('sort-default')?.classList.add('active');
          btn.classList.remove('active');
        },
        { timeout: 8000 }
      );
    }
  } else {
    applyFilters();
  }
}

function toggleFilters() {
  state.filtersOpen = !state.filtersOpen;
  document.getElementById('filterPanel').classList.toggle('open', state.filtersOpen);
  document.getElementById('filterToggle').classList.toggle('active', state.filtersOpen || !!(state.filters.day || state.filters.area || state.filters.type));
}

// ── CARDS ──────────────────────────────────────────────
function renderCards() {
  const grid = document.getElementById('cardsGrid');
  if (!grid) return;
  if (!state.filtered.length) {
    grid.innerHTML = `<div class="empty-state">
      <svg width="96" height="96" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="48" cy="48" r="40" fill="rgba(255,107,74,0.08)"/>
        <circle cx="44" cy="44" r="18" stroke="#FF6B4A" stroke-width="3" fill="none"/>
        <line x1="57" y1="57" x2="70" y2="70" stroke="#FF6B4A" stroke-width="3" stroke-linecap="round"/>
        <circle cx="44" cy="38" r="3" fill="rgba(255,107,74,0.4)"/>
        <path d="M37 47 Q44 54 51 47" stroke="rgba(255,107,74,0.4)" stroke-width="2" stroke-linecap="round" fill="none"/>
      </svg>
      <div class="empty-state-title">No spots found</div>
      <div class="empty-state-sub">Try removing a filter or searching something different</div>
      <button class="request-venue-btn request-venue-btn--empty" onclick="openRequestVenue()">+ Request a Venue</button>
    </div>`;
    return;
  }
  grid.innerHTML = state.filtered.map(v => v.event_type ? eventCardHTML(v) : venueCardHTML(v)).join('');
}

function venueCardHTML(v) {
  const isToday = (v.days || []).includes(TODAY);
  const cached  = state.reviewCache[v.id] || [];
  const avg     = avgFromList(cached);
  const faved   = isFavorite(v.id);
  const hasPhoto = !!(v.photo_url || (v.photo_urls && v.photo_urls.length));
  const photoUrl = v.photo_url || (v.photo_urls && v.photo_urls[0]) || '';
  const distBadge = state.sort === 'distance' && state.userLat !== null
    ? fmtDistance(haversine(state.userLat, state.userLng, v.lat, v.lng)) : '';
  const photoBlock = hasPhoto ? `
    <div class="card-photo-wrap">
      <img src="${photoUrl}" class="card-photo-img" alt="${esc(v.name)}" loading="lazy" onerror="this.closest('.card-photo-wrap').style.display='none';this.closest('.card').classList.add('card-no-photo')">
      <div class="card-photo-gradient"></div>
      <div class="card-photo-name-over">${esc(v.name)}</div>
      ${distBadge ? `<div class="card-photo-dist-badge">${distBadge}</div>` : ''}
      <button class="card-photo-heart${faved ? ' faved' : ''}" onclick="event.stopPropagation();doFavorite('${v.id}','venue',this);this.classList.toggle('faved');this.textContent=this.classList.contains('faved')?'★':'☆'">${faved ? '★' : '☆'}</button>
    </div>` : '';
  return `<div class="card${hasPhoto ? '' : ' card-no-photo'}" data-id="${v.id}" onclick="openModal('${v.id}','venue')" role="button" tabindex="0">
    ${photoBlock}
    <div class="card-body">
    ${hasPhoto ? '' : `<div class="card-top">
      <div class="card-name">${esc(v.name)}${v.owner_verified ? ' <span class="verified-badge verified-badge--card">✓</span>' : ''}</div>
      <button class="heart-btn${faved ? ' faved' : ''}" onclick="event.stopPropagation();doFavorite('${v.id}','venue',this)">${faved ? '★' : '☆'}</button>
    </div>`}
    <div class="card-meta">
      <span>${esc(v.neighborhood || '')}</span>
      ${v.neighborhood && v.hours ? '<span class="card-sep">·</span>' : ''}
      ${v.hours ? `<span class="card-when">${esc(getTodayHours(v))}</span>` : ''}
      ${!hasPhoto && distBadge ? `<span class="card-sep">·</span><span class="card-dist">${distBadge}</span>` : ''}
    </div>
    ${v.featured ? '<div class="featured-crown">⭐ Featured</div>' : ''}
    ${(() => {
      const tags = AMENITIES.filter(a => v[a.key]).map(a => `<span class="amenity-tag amenity-tag--${a.key}">${a.emoji} ${a.label}</span>`).join('');
      return tags ? `<div class="amenity-tags">${tags}</div>` : '';
    })()}
    <ul class="deals">${(v.deals || []).slice(0, 3).map(d => `<li>${esc(d)}</li>`).join('')}${(v.deals || []).length > 3 ? `<li class="deals-more">+${v.deals.length - 3} more</li>` : ''}</ul>
    ${goingFireBadge(v.id)}
    </div>
    <div class="card-foot">
      <span class="card-cuisine">${esc(v.cuisine || '')}${v.owner_verified ? ' <span class="verified-badge verified-badge--card">✓ Verified</span>' : ''}</span>
      <div class="card-stars">${starHTML(avg, 5, 11)}<span class="card-rcount">${cached.length ? `(${cached.length})` : '—'}</span></div>
    </div>
    <div class="card-going">
      <button class="going-btn${state.goingByMe.has(v.id) ? ' going-active' : ''}" onclick="event.stopPropagation();doGoingTonight('${v.id}',this)">${checkInBtnLabel(state.goingCounts[v.id]||0, state.goingByMe.has(v.id))}</button>
    </div>
    ${!v.owner_verified ? `<div class="card-claim"><a href="business-portal.html" onclick="event.stopPropagation()" class="claim-link">Own this spot? Claim it →</a></div>` : ''}
  </div>`;
}

function eventCardHTML(v) {
  const faved = isFavorite(v.id);
  return `<div class="card" onclick="openModal('${v.id}','event')" role="button" tabindex="0">
    <div class="card-top">
      <div class="card-name">${esc(v.name)}</div>
      <button class="heart-btn${faved ? ' faved' : ''}" onclick="event.stopPropagation();doFavorite('${v.id}','event',this)">${faved ? '★' : '☆'}</button>
    </div>
    <div class="card-meta">
      <span>${esc(v.neighborhood || '')}</span>
      ${v.neighborhood ? '<span class="card-sep">·</span>' : ''}
      <span class="card-when">${esc(v.hours || '')}</span>
    </div>
    ${v.description ? `<ul class="deals"><li>${esc(v.description)}</li></ul>` : ''}
    <div class="card-foot">
      <span class="card-cuisine">${esc(v.venue_name || '')}</span>
    </div>
  </div>`;
}

async function doFavorite(itemId, itemType, btn) {
  if (!currentUser) { openAuth('signin'); showToast('Sign in to save'); return; }
  const added = await toggleFavorite(itemId, itemType);
  btn.textContent = added ? '★' : '☆'; btn.classList.toggle('faved', added);
  showToast(added ? 'Saved ★' : 'Removed');
}
function openFavView() {
  if (!currentUser) { openAuth('signin'); return; }
  state.favFilterOn = true;
  document.getElementById('favFilterBtn').classList.add('active');
  applyFilters(); updateChips();
}
function toggleFavFilter() {
  if (!currentUser) { openAuth('signin'); return; }
  state.favFilterOn = !state.favFilterOn;
  document.getElementById('favFilterBtn').classList.toggle('active', state.favFilterOn);
  applyFilters(); updateChips();
}

// ── MODAL ──────────────────────────────────────────────
async function openModal(id, type = 'venue') {
  state.activeItemId   = id;
  state.activeItemType = type;
  const items = type === 'venue' ? state.venues : state.events;
  const item  = items.find(x => String(x.id) === String(id));
  if (!item) return;
  renderModal(item, type, []);
  openOverlay('modalOverlay');
  const reviews = await getCachedReviews(id, type);
  const le = document.getElementById(`rlist-${id}`);
  const ae = document.getElementById(`ravg-${id}`);
  if (le) le.innerHTML = renderReviewList(reviews, id, type);
  if (ae) ae.innerHTML = avgHTML(reviews);
  // Load venue follow state (deal alerts button)
  if (type === 'venue' && currentUser) {
    isFollowingVenue(currentUser.id, id).then(following => {
      const fb = document.getElementById(`venue-follow-btn-${id}`);
      if (fb) {
        fb.classList.toggle('following', following);
        fb.innerHTML = '<span class="s-btn-icon">🔔</span>';
      }
    });
  }
  // Load UGC check-in photos
  if (type === 'venue') {
    fetchCheckinPhotos(id).then(photos => {
      const el = document.getElementById(`ugc-photos-${id}`);
      if (el) el.innerHTML = renderCheckinPhotos(photos, id);
    });
  }
}

async function getCachedReviews(id, type) {
  const key = `${type}-${id}`;
  const now  = Date.now();
  if (state.reviewCache[key] && (now - state.reviewCacheTime[key]) < CACHE_MS) return state.reviewCache[key];
  const r = await fetchReviews(id, type);
  state.reviewCache[key] = r; state.reviewCacheTime[key] = now; return r;
}
async function refreshReviews(id, type) {
  delete state.reviewCache[`${type}-${id}`];
  const r  = await getCachedReviews(id, type);
  const le = document.getElementById(`rlist-${id}`);
  const ae = document.getElementById(`ravg-${id}`);
  if (le) le.innerHTML = renderReviewList(r, id, type);
  if (ae) ae.innerHTML = avgHTML(r);
  renderCards();
}

function avgHTML(reviews) {
  if (!reviews.length) return '';
  const avg = avgFromList(reviews);
  return `${starHTML(avg, 5, 11)} <span class="review-summary-sub">${avg.toFixed(1)} · ${reviews.length} review${reviews.length !== 1 ? 's' : ''}</span>`;
}

function renderModal(v, type, reviews) {
  const faved   = isFavorite(v.id);
  const isVenue = type === 'venue';
  document.getElementById('modalContent').innerHTML = `
    ${(() => {
      const photos = v.photo_urls?.length ? v.photo_urls : (v.photo_url ? [v.photo_url] : []);
      if (!photos.length) return '';
      if (photos.length === 1) {
        return `<div class="s-photo-thumb" onclick="openPhotoLightbox('${photos[0]}','${esc(v.name)}')" title="Tap to enlarge"><img src="${photos[0]}" alt="${esc(v.name)}" loading="lazy" onerror="this.parentElement.remove()"><div class="s-photo-hint">📷 Tap to expand</div></div>`;
      }
      return `<div class="s-photos-strip">${photos.map((url, i) =>
        `<div class="s-photo-thumb s-photo-thumb--multi" onclick="openPhotoLightbox('${url}','${esc(v.name)}')" title="Tap to enlarge">
          <img src="${url}" alt="${esc(v.name)} photo ${i+1}" loading="lazy" onerror="this.parentElement.remove()">
          <div class="s-photo-hint">📷 ${i+1}/${photos.length}</div>
        </div>`
      ).join('')}</div>`;
    })()}
    <div class="s-tag ${isVenue ? 'hh' : 'ev'}">${isVenue ? 'Happy Hour' : esc(v.event_type || 'Event')}</div>
    <div style="display:flex;align-items:flex-start;gap:10px;padding-right:38px">
      <div style="flex:1">
        <div class="s-name">${esc(v.name)}${v.owner_verified ? ' <span class="verified-badge verified-badge--modal">✓ Verified</span>' : ''}</div>
        <div class="s-hood">${esc(v.neighborhood || '')}</div>
        <div class="s-addr">📍 ${esc(v.address || '')}</div>
      ${isVenue ? (() => {
        const tags = AMENITIES.filter(a => v[a.key]).map(a => `<span class="amenity-tag amenity-tag--${a.key}">${a.emoji} ${a.label}</span>`).join('');
        return tags ? `<div class="amenity-tags amenity-tags--modal">${tags}</div>` : '';
      })() : ''}
      </div>
      <button class="heart-btn heart-btn--lg${faved ? ' faved' : ''}" onclick="doFavorite('${v.id}','${type}',this)" style="margin-top:4px">${faved ? '★' : '☆'}</button>
    </div>
    <div class="s-div"></div>
    <div class="s-label">Schedule</div>
    <div class="s-when">${esc(v.hours || '')}</div>
    <div class="s-days">${DAYS.map(d => `<span class="day-pill${(v.days || []).includes(d) ? (d === TODAY ? ' today' : ' on') : ''}">${d}</span>`).join('')}</div>
    ${isVenue ? `
      <div class="s-div"></div>
      <div class="s-label">Deals &amp; Specials</div>
      <ul class="s-deals">${(v.deals || []).map(d => `<li>${esc(d)}</li>`).join('')}</ul>
      <div class="s-cuisine">${esc(v.cuisine || '')}</div>
      ${(() => {
        const evs = state.events.filter(e => e.venue_name && v.name && e.venue_name.trim().toLowerCase() === v.name.trim().toLowerCase());
        if (!evs.length) return '';
        return `<div class="s-div"></div>
        <div class="s-label">Events at this venue</div>
        <div class="s-events-list">${evs.map(e => {
          const evToday = (e.days||[]).includes(TODAY);
          return `<div class="s-event-item">
            <div class="s-event-top">
              <span class="s-event-name">${esc(e.name||e.event_type)}</span>
              <span class="card-event-type">${esc(e.event_type||'')}</span>
              ${evToday ? `<span style="font-size:10px;color:var(--teal);font-weight:700;font-family:'DM Sans',sans-serif">TONIGHT</span>` : ''}
            </div>
            <div class="s-event-meta">${(e.days||[]).join(', ')} · ${esc(e.hours||'')}${e.price && e.price !== 'Free' ? ` · ${esc(e.price)}` : ' · Free'}</div>
            ${e.description ? `<div class="s-event-desc">${esc(e.description)}</div>` : ''}
          </div>`;
        }).join('')}</div>`;
      })()}
    ` : `
      <div class="s-div"></div>
      <div class="s-label">About</div>
      <p style="font-size:14px;color:rgba(232,236,244,.75);line-height:1.6">${esc(v.description || '')}</p>
      ${v.venue_name ? `<div class="s-cuisine" style="margin-top:8px">At ${esc(v.venue_name)}</div>` : ''}
      ${v.price ? `<div class="s-cuisine">Entry: ${esc(v.price)}</div>` : ''}
    `}
    <div class="s-div"></div>
    ${isVenue ? `
    <div class="s-going-wrap">
      <button class="going-btn going-btn--lg${state.goingByMe.has(v.id) ? ' going-active' : ''}" id="modal-going-btn" onclick="doGoingTonight('${v.id}', this)">${checkInBtnLabel(state.goingCounts[v.id]||0, state.goingByMe.has(v.id))}</button>
      ${(state.goingCounts[v.id]||0) >= 2 ? `<div class="s-going-count">🔥 ${state.goingCounts[v.id]} people are here tonight</div>` : ''}
    </div>` : ''}
    <div class="s-secondary-actions">
      ${v.url ? `<a class="s-act-btn s-act-primary" href="${v.url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Website"><span class="s-btn-icon">🌐</span></a>` : `<a class="s-act-btn s-act-primary" href="https://www.google.com/search?q=${encodeURIComponent(v.name + ' ' + (state.city?.name || 'San Diego'))}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Search"><span class="s-btn-icon">🔍</span></a>`}
      <button class="s-act-btn" onclick="goToMap('${v.id}')" title="Map"><span class="s-btn-icon">🗺️</span></button>
      <button class="s-act-btn" onclick="shareItem('${v.id}','${type}')" title="Share"><span class="s-btn-icon">↗️</span></button>
      ${currentUser ? `<button class="s-act-btn" onclick="dmOpenVenueSharePicker('${v.id}')" title="Send"><span class="s-btn-icon">💬</span></button>` : ''}
      ${isVenue ? `<button class="s-act-btn" id="venue-follow-btn-${v.id}" onclick="toggleVenueFollow('${v.id}','${esc(v.name)}',this)" title="Follow"><span class="s-btn-icon">🔔</span></button>` : ''}
    </div>
    ${isVenue ? `<div id="ugc-photos-${v.id}"></div>` : ''}
    <div class="s-div"></div>
    <div class="s-label">Reviews <span id="ravg-${v.id}">${avgHTML(reviews)}</span></div>
    <div class="review-form">
      <div class="star-picker" id="sp-${v.id}" data-val="0">${[1,2,3,4,5].map(n => `<button class="sp" onclick="pickStar('${v.id}',${n})">★</button>`).join('')}</div>
      ${!currentUser ? `<p class="review-guest-note">Posting as guest — <button class="auth-switch-btn" onclick="openAuth('signin')">sign in</button> to manage reviews</p>` : ''}
      <input class="field" id="rname-${v.id}" type="text" value="${currentUser ? esc(currentUser.user_metadata?.full_name || '') : ''}" placeholder="Your name" ${currentUser ? 'style="display:none"' : ''} autocomplete="name">
      <textarea class="field" id="rtext-${v.id}" placeholder="How was it?" rows="3"></textarea>
      <button class="btn-submit" onclick="submitReview('${v.id}','${type}')">Post Review</button>
    </div>
    <div class="reviews-list" id="rlist-${v.id}">${reviews.length ? renderReviewList(reviews, v.id, type) : '<div class="no-reviews">Loading…</div>'}</div>`;
}

function renderReviewList(reviews, itemId, type) {
  if (!reviews.length) return `<div class="no-reviews">No reviews yet — be the first</div>`;
  return reviews.map(r => {
    const isOwn = currentUser && r.user_id === currentUser.id;
    const name  = r.profiles?.display_name || r.name || 'Anonymous';
    const nameEl = r.user_id && !isOwn
      ? `<span class="review-author review-author--link" onclick="openPublicProfile('${r.user_id}')">${esc(name)}</span>`
      : `<span class="review-author">${esc(name)}${isOwn ? ' <span class="review-you">(you)</span>' : ''}</span>`;
    return `<div class="review-item">
      <div class="review-head">
        ${nameEl}
        <span class="review-stars">${starHTML(r.rating, 5, 11)}</span>
        <span class="review-date">${fmtDate(r.created_at)}</span>
      </div>
      ${r.text ? `<div class="review-text">${esc(r.text)}</div>` : ''}
      ${isOwn ? `<div class="review-acts">
        <button class="review-act" onclick="openEditReview('${r.id}','${itemId}','${type}',${r.rating},\`${esc(r.text || '')}\`)">Edit</button>
        <button class="review-act del" onclick="doDeleteReview('${r.id}','${itemId}','${type}')">Delete</button>
      </div>` : ''}
    </div>`;
  }).join('');
}

function pickStar(itemId, n) {
  const p = document.getElementById(`sp-${itemId}`);
  p.dataset.val = n;
  p.querySelectorAll('.sp').forEach((b, i) => b.classList.toggle('lit', i < n));
}
async function submitReview(itemId, type) {
  const rating = parseInt(document.getElementById(`sp-${itemId}`).dataset.val || '0');
  if (!rating) { showToast('Pick a star rating first'); return; }
  const text      = document.getElementById(`rtext-${itemId}`)?.value.trim();
  const guestName = document.getElementById(`rname-${itemId}`)?.value.trim() || 'Anonymous';
  const { error } = await postReview({ itemId, itemType: type, rating, text, guestName });
  if (error) { showToast('❌ ' + error.message); return; }
  const p = document.getElementById(`sp-${itemId}`);
  p.dataset.val = '0'; p.querySelectorAll('.sp').forEach(b => b.classList.remove('lit'));
  const te = document.getElementById(`rtext-${itemId}`); if (te) te.value = '';
  await refreshReviews(itemId, type);
  showToast('Review posted!');
}
function closeModal(e) { if (e && e.target !== document.getElementById('modalOverlay')) return; closeOverlay('modalOverlay'); }

// ── EDIT REVIEW ────────────────────────────────────────
function openEditReview(reviewId, itemId, type, rating, text) {
  document.getElementById('editContent').innerHTML = `
    <div class="s-name" style="font-size:20px">Edit Review</div>
    <div class="review-form" style="margin-top:14px">
      <div class="star-picker" id="epick" data-val="${rating}">${[1,2,3,4,5].map((n,i) => `<button class="sp${i<rating?' lit':''}" onclick="pickEditStar(${n})">★</button>`).join('')}</div>
      <textarea class="field" id="etext" rows="4">${esc(text)}</textarea>
      <div style="display:flex;gap:8px">
        <button class="btn-submit" style="flex:1" onclick="saveEditReview('${reviewId}','${itemId}','${type}')">Save</button>
        <button class="btn-sec" onclick="closeOverlay('editOverlay')">Cancel</button>
      </div>
    </div>`;
  openOverlay('editOverlay');
}
function pickEditStar(n) { const p = document.getElementById('epick'); p.dataset.val = n; p.querySelectorAll('.sp').forEach((b,i) => b.classList.toggle('lit', i<n)); }
async function saveEditReview(reviewId, itemId, type) {
  const rating = parseInt(document.getElementById('epick').dataset.val || '0');
  const text   = document.getElementById('etext').value.trim();
  if (!rating) { showToast('Pick a rating'); return; }
  const { error } = await updateReview(reviewId, { rating, text });
  if (error) { showToast('❌ ' + error.message); return; }
  delete state.reviewCache[`${type}-${itemId}`];
  closeOverlay('editOverlay');
  showToast('Review updated');
  if (state.activeItemId === itemId) refreshReviews(itemId, type);
}
async function doDeleteReview(reviewId, itemId, type) {
  if (!confirm('Delete this review?')) return;
  const error = await deleteReview(reviewId);
  if (error) { showToast('❌ ' + error.message); return; }
  delete state.reviewCache[`${type}-${itemId}`];
  showToast('Review deleted');
  if (state.activeItemId === itemId) refreshReviews(itemId, type);
  renderCards();
}
function closeEditReview(e) { if (e && e.target !== document.getElementById('editOverlay')) return; closeOverlay('editOverlay'); }

// ── AUTH ───────────────────────────────────────────────
function openAuth(mode = 'signin') { renderAuth(mode); openOverlay('authOverlay'); }
function closeAuth(e) { if (e && e.target !== document.getElementById('authOverlay')) return; closeOverlay('authOverlay'); }
function renderAuth(mode) {
  const si = mode === 'signin';
  document.getElementById('authContent').innerHTML = `
    <div class="auth-title">${si ? 'Welcome back' : 'Create account'}</div>
    <p class="auth-sub">${si ? 'Sign in to save spots & manage reviews' : 'Free forever — save spots, write reviews'}</p>
    ${!si ? `<div class="field-group"><div class="field-label">Name</div><input class="field" id="aName" type="text" placeholder="Your name" autocomplete="name"></div>` : ''}
    <div class="field-group"><div class="field-label">Email</div><input class="field" id="aEmail" type="email" placeholder="you@example.com" autocomplete="email"></div>
    <div class="field-group"><div class="field-label">Password</div><input class="field" id="aPass" type="password" placeholder="${si ? 'Your password' : 'Min 8 characters'}" autocomplete="${si ? 'current-password' : 'new-password'}"></div>
    ${!si ? `
    <div class="field-group">
      <div class="field-label">Phone <span style="font-weight:400;color:var(--muted)">(optional)</span></div>
      <input class="field" id="aPhone" type="tel" placeholder="+1 (555) 000-0000" autocomplete="tel">
    </div>
    <label class="consent-row" id="smsConsentRow" style="display:none">
      <input type="checkbox" id="aSmsConsent">
      <span class="consent-text">I agree to receive promotional texts from Spotd. Message & data rates may apply. Reply STOP to unsubscribe.</span>
    </label>
    ` : ''}
    ${si ? `<button class="auth-forgot" onclick="doForgot()">Forgot password?</button>` : ''}
    <button class="btn-submit" id="authBtn" onclick="doAuth('${mode}')" style="width:100%;margin-top:4px">${si ? 'Sign In' : 'Create Account'}</button>
    <p class="auth-switch">${si ? "No account?" : 'Have an account?'} <button class="auth-switch-btn" onclick="renderAuth('${si ? 'signup' : 'signin'}')">${si ? 'Sign up free' : 'Sign in'}</button></p>`;
  setTimeout(() => {
    ['aEmail','aPass','aName','aPhone'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(mode); });
    });
    // Show SMS consent checkbox only when a phone number is entered
    const phoneEl = document.getElementById('aPhone');
    const consentRow = document.getElementById('smsConsentRow');
    if (phoneEl && consentRow) {
      phoneEl.addEventListener('input', () => {
        consentRow.style.display = phoneEl.value.trim().length > 3 ? 'flex' : 'none';
      });
    }
  }, 50);
}
async function doAuth(mode) {
  const btn = document.getElementById('authBtn');
  btn.disabled = true; btn.textContent = 'Please wait…';
  const email    = (document.getElementById('aEmail')?.value || '').trim();
  const password =  document.getElementById('aPass')?.value  || '';
  if (!email || !password) { showToast('Please fill in all fields'); btn.disabled = false; btn.textContent = mode === 'signin' ? 'Sign In' : 'Create Account'; return; }
  try {
    const result = mode === 'signup'
      ? await authSignUp(email, password, (document.getElementById('aName')?.value || '').trim())
      : await authSignIn(email, password);
    if (result.error) throw result.error;
    // Save phone + consent after signup
    if (mode === 'signup' && currentUser) {
      const phone = (document.getElementById('aPhone')?.value || '').trim();
      const smsConsent = document.getElementById('aSmsConsent')?.checked || false;
      if (phone || smsConsent) {
        await updateProfile(currentUser.id, {
          phone: phone || null,
          sms_consent: smsConsent,
          sms_consent_at: smsConsent ? new Date().toISOString() : null,
        });
      }
    }
    closeOverlay('authOverlay');
    showToast(mode === 'signup' ? 'Account created!' : 'Welcome back!');
  } catch(err) {
    showToast('❌ ' + (err.message || 'Something went wrong'));
    btn.disabled = false; btn.textContent = mode === 'signin' ? 'Sign In' : 'Create Account';
  }
}
async function doForgot() {
  const email = (document.getElementById('aEmail')?.value || '').trim();
  if (!email) { showToast('Enter your email first'); return; }
  // Show loading state
  const btn = document.querySelector('.auth-forgot');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/?reset=1'
  });
  if (error) {
    showToast('❌ ' + error.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Forgot password?'; }
    return;
  }
  closeOverlay('authOverlay');
  showToast('📧 Check your email for a reset link!');
}

function openResetPassword() {
  document.getElementById('authContent').innerHTML = `
    <div class="auth-title">Set new password</div>
    <p class="auth-sub">Choose a strong password for your account</p>
    <div class="field-group">
      <div class="field-label">New Password</div>
      <input class="field" id="rPass1" type="password" placeholder="Min 8 characters" autocomplete="new-password">
    </div>
    <div class="field-group">
      <div class="field-label">Confirm Password</div>
      <input class="field" id="rPass2" type="password" placeholder="Repeat password" autocomplete="new-password">
    </div>
    <button class="btn-submit" id="resetBtn" onclick="doResetPassword()" style="width:100%;margin-top:4px">Update Password</button>`;
  openOverlay('authOverlay');
  setTimeout(() => document.getElementById('rPass1')?.focus(), 100);
}

async function doResetPassword() {
  const p1 = document.getElementById('rPass1')?.value || '';
  const p2 = document.getElementById('rPass2')?.value || '';
  if (!p1 || p1.length < 8) { showToast('Password must be at least 8 characters'); return; }
  if (p1 !== p2) { showToast("Passwords don't match"); return; }
  const btn = document.getElementById('resetBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const { error } = await db.auth.updateUser({ password: p1 });
  if (error) {
    showToast('❌ ' + error.message);
    btn.disabled = false; btn.textContent = 'Update Password';
    return;
  }
  closeOverlay('authOverlay');
  // Clean URL
  window.history.replaceState({}, document.title, window.location.pathname);
  showToast("✅ Password updated! You're signed in.");
}

// ── PROFILE ────────────────────────────────────────────
// ── PROFILE ─────────────────────────────────────────────
const BADGE_DEFS = {
  first_checkin:  { emoji: '📍', label: 'First Check-in',        desc: 'Checked in for the first time' },
  regular:        { emoji: '🏅', label: 'Regular',               desc: 'Checked into the same spot 3+ times' },
  explorer:       { emoji: '🧭', label: 'Neighborhood Explorer', desc: 'Visited 5+ neighborhoods' },
  critic:         { emoji: '⭐', label: 'Critic',                desc: 'Left 10+ reviews' },
  social:         { emoji: '🤝', label: 'Social Butterfly',      desc: 'Following 5+ people' },
  streak_4:       { emoji: '🔥', label: '4-Week Streak',         desc: 'Checked in 4 weeks in a row' },
  streak_8:       { emoji: '🔥🔥', label: '8-Week Streak',       desc: 'Checked in 8 weeks in a row' },
  top_reviewer:   { emoji: '✍️', label: 'Top Reviewer',         desc: 'Left 25+ reviews' },
};

async function openProfile() {
  if (!currentUser) { openAuth('signin'); return; }
  const page = document.getElementById('profilePage');
  page.classList.add('profile-page--open');
  document.getElementById('bnProfile')?.classList.add('active');
  document.getElementById('bnFeed')?.classList.remove('active');
  await renderProfile(currentUser);
}
function closeProfile() {
  const page = document.getElementById('profilePage');
  if (!page) return;
  page.classList.remove('profile-page--open');
}

function openSubPage(id) {
  const page = document.getElementById(id);
  if (!page) return;
  page.style.display = 'block';
  requestAnimationFrame(() => requestAnimationFrame(() => page.classList.add('sub-page--open')));
}
function closeSubPage(id) {
  const page = document.getElementById(id);
  if (!page) return;
  page.classList.remove('sub-page--open');
  setTimeout(() => { page.style.display = 'none'; }, 250);
}

async function renderProfile(user) {
  const areas = [...new Set([...state.venues, ...state.events].map(v => v.neighborhood).filter(Boolean))].sort();
  const [profile, myReviews, favItems, followed, checkIns, badges, following, followers] = await Promise.all([
    getProfile(user.id), fetchMyReviews(user.id), getFavoriteItems(user.id),
    getFollowedNeighborhoods(user.id), fetchAllCheckIns(user.id),
    getUserBadges(user.id), getFollowing(user.id), getFollowers(user.id),
  ]);

  // If no city loaded yet, fetch San Diego venues so check-in names resolve
  let venueList = state.venues;
  if (!venueList.length && checkIns.length) {
    try { venueList = await fetchVenues('san-diego'); } catch(e) { venueList = []; }
  }
  const allItems = [...venueList, ...state.events];
  const favIds   = new Set(favItems.map(f => String(f.item_id)));
  const favSpots = allItems.filter(v => favIds.has(String(v.id)));
  const displayName = profile?.display_name || user.user_metadata?.full_name || 'You';
  const avatar = profile?.avatar_emoji || '🍺';
  const totalVenues = new Set(checkIns.map(c => c.venue_id)).size;
  const currentStreak = computeCurrentStreak(checkIns);
  const AVATARS = ['🍺','🍹','🍷','🥂','🍸','🎉','🌮','🔥','🎸','🏄','🌊','🎭'];

  const bannerColor = profile?.banner_color || '#FF6B4A';

  document.getElementById('profileContent').innerHTML = `
    <div class="my-profile-banner" id="myBanner" style="background: linear-gradient(135deg, ${bannerColor} 0%, ${bannerColor}cc 55%, ${bannerColor}88 100%);">
      <button class="profile-settings-btn" onclick="openProfileSettings()" title="Settings">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
      <div class="my-avatar-wrap banner-avatar-wrap">
        <div class="my-avatar" id="myAvatar" onclick="toggleAvatarPicker()" title="Change avatar">${avatar}</div>
        <div class="avatar-picker" id="avatarPicker" style="display:none">
          ${AVATARS.map(e => `<button class="avatar-opt" onclick="pickAvatar('${e}',this)">${e}</button>`).join('')}
        </div>
      </div>
    </div>
    <div class="my-profile-body">
      <div class="my-name">${esc(displayName)}</div>
      <div class="profile-email">${esc(user.email)}</div>
      ${badges.length ? `<div class="pub-badges">${badges.map(b => {
        const def = BADGE_DEFS[b.badge_key] || {};
        return '<span class="badge-chip" onclick="showBadgeInfo(\'' + b.badge_key + '\')">' + (def.emoji||'🏅') + ' ' + (def.label||b.badge_key) + '</span>';
      }).join('')}</div>` : ''}
      <div class="my-stats" id="myStatBar">
        <div class="my-stat" onclick="openActivityFeed()" style="cursor:pointer"><span>${checkIns.length}</span>Check-ins</div>
        <div class="my-stat"><span>${myReviews.length}</span>Reviews</div>
        ${currentStreak >= 2 ? `<div class="my-stat"><span>${currentStreak}</span>Streak</div>` : ''}
        <div class="my-stat" onclick="openFindPeople()" style="cursor:pointer"><span id="stat-following">${following.length}</span>Following</div>
        <div class="my-stat" onclick="showFollowersList()" style="cursor:pointer"><span id="stat-followers">${followers.length}</span>Followers</div>
      </div>
    </div>

    <div class="profile-section-picker">
      <button class="profile-section-btn" onclick="toggleProfileDropdown(this)" id="profileSectionBtn">
        <span id="profileSectionLabel">📍 Check-ins</span>
        <svg class="profile-dropdown-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="profile-section-menu" id="profileSectionMenu" style="display:none">
        <button onclick="selectProfileSection('checkins','📍 Check-ins',this)">📍 Check-ins</button>
        <button onclick="selectProfileSection('reviews','⭐ Reviews',this)">⭐ Reviews</button>
        <button onclick="selectProfileSection('saved','🔖 Saved',this)">🔖 Saved</button>
        <button onclick="selectProfileSection('hoods','🏘️ Areas',this)">🏘️ Areas</button>
        <button onclick="openFindPeople()">👥 People</button>
        <button onclick="openActivityFeed()">📊 Activity</button>
        <button onclick="openLeaderboard()">🏆 Ranks</button>
      </div>
    </div>

    <div id="my-tab-checkins" class="pub-tab-content active">
      ${checkIns.length ? checkIns.slice(0,30).map(c => {
        const v = allItems.find(x => String(x.id) === String(c.venue_id));
        return '<div class="pub-activity-row"' + (v ? ' onclick="closeProfile();openModal(\'' + c.venue_id + '\',\'venue\')" style="cursor:pointer"' : '') + '>'
          + '<div class="pub-activity-icon">📍</div>'
          + '<div class="pub-activity-body">'
          + '<div class="pub-activity-title">' + (v ? esc(v.name) : esc(c.venue_name||'A spot')) + '</div>'
          + '<div class="pub-activity-meta">' + (c.neighborhood||'') + ' · ' + fmtDate(c.created_at||c.date) + '</div>'
          + '</div></div>';
      }).join('') : '<div class="pub-empty">No check-ins yet — go explore! 🗺️</div>'}
    </div>

    <div id="my-tab-reviews" class="pub-tab-content" style="display:none">
      ${myReviews.length ? myReviews.map(r => {
        const item = allItems.find(x => String(x.id) === String(r.venue_id || r.event_id));
        const itype = r.venue_id ? 'venue' : 'event';
        return '<div class="pub-activity-row">'
          + '<div class="pub-activity-icon">⭐</div>'
          + '<div class="pub-activity-body" style="flex:1">'
          + '<div class="pub-activity-title" onclick="closeProfile();openModal(\'' + (r.venue_id||r.event_id) + '\',\'' + itype + '\')" style="cursor:pointer">' + (item ? esc(item.name) : 'Unknown Spot') + '</div>'
          + '<div class="pub-activity-meta">' + starHTML(r.rating,5,11) + ' · ' + fmtDate(r.created_at) + '</div>'
          + (r.text ? '<div class="pub-activity-note">"' + esc(r.text) + '"</div>' : '')
          + '<div class="review-acts">'
          + '<button class="review-act" onclick="openEditReview(\'' + r.id + '\',\'' + (r.venue_id||r.event_id) + '\',\'' + itype + '\',' + r.rating + ',\'' + esc(r.text||'') + '\')">Edit</button>'
          + '<button class="review-act del" onclick="doDeleteReview(\'' + r.id + '\',\'' + (r.venue_id||r.event_id) + '\',\'' + itype + '\')">Delete</button>'
          + '</div></div></div>';
      }).join('') : '<div class="pub-empty">No reviews yet</div>'}
    </div>

    <div id="my-tab-saved" class="pub-tab-content" style="display:none">
      ${favSpots.length ? favSpots.map(v =>
        '<div class="pub-activity-row" onclick="closeProfile();openModal(\'' + v.id + '\',\'' + (v.event_type?'event':'venue') + '\')" style="cursor:pointer">'
        + '<div class="pub-activity-icon">♥</div>'
        + '<div class="pub-activity-body"><div class="pub-activity-title">' + esc(v.name) + '</div>'
        + '<div class="pub-activity-meta">' + esc(v.neighborhood||'') + ' · ' + esc(v.hours||'') + '</div></div></div>'
      ).join('') : `<div class="empty-state" style="padding:32px 16px">
        <svg width="72" height="72" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="36" cy="36" r="30" fill="rgba(255,107,74,0.07)"/>
          <path d="M36 50 C36 50 20 40 20 28 C20 22 25 18 30 18 C33 18 35 20 36 22 C37 20 39 18 42 18 C47 18 52 22 52 28 C52 40 36 50 36 50Z" stroke="#FF6B4A" stroke-width="2.5" fill="rgba(255,107,74,0.12)" stroke-linejoin="round"/>
        </svg>
        <div class="empty-state-title">No saved spots yet</div>
        <div class="empty-state-sub">Tap the ★ on any venue to save it here</div>
      </div>`}
    </div>

    <div id="my-tab-hoods" class="pub-tab-content" style="display:none">
      <div style="margin-bottom:12px;font-size:13px;color:var(--muted);line-height:1.5">Follow neighborhoods to get notified when new deals are added nearby.</div>
      ${areas.length ? `<div class="hood-grid">${areas.map(a =>
        `<button class="hood-pill${followed.includes(a) ? ' on' : ''}" onclick="toggleHood('${a.replace(/'/g,"\\'")}',this)">${a}</button>`
      ).join('')}</div>` : '<div class="pub-empty">No neighborhoods found for this city yet.</div>'}
    </div>`;
}

function switchMyTab(tab, btn) {
  document.querySelectorAll('.pub-tab-content').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.pub-tab').forEach(b => b.classList.remove('active'));
  document.getElementById('my-tab-' + tab).style.display = 'block';
  if (btn) btn.classList.add('active');
}

function toggleProfileDropdown(btn) {
  const menu = document.getElementById('profileSectionMenu');
  const arrow = btn.querySelector('.profile-dropdown-arrow');
  const open = menu.style.display === 'none';
  menu.style.display = open ? 'block' : 'none';
  arrow.style.transform = open ? 'rotate(180deg)' : '';
}

function selectProfileSection(tab, label, menuBtn) {
  // Update label
  document.getElementById('profileSectionLabel').textContent = label;
  // Close menu
  document.getElementById('profileSectionMenu').style.display = 'none';
  document.querySelector('.profile-dropdown-arrow').style.transform = '';
  // Show tab
  document.querySelectorAll('.pub-tab-content').forEach(el => el.style.display = 'none');
  document.getElementById('my-tab-' + tab).style.display = 'block';
}

function openProfileSettings() {
  const BANNER_COLORS = [
    { color: '#FF6B4A', label: 'Coral' },
    { color: '#E53935', label: 'Red' },
    { color: '#8E24AA', label: 'Purple' },
    { color: '#1E88E5', label: 'Blue' },
    { color: '#00897B', label: 'Teal' },
    { color: '#43A047', label: 'Green' },
    { color: '#FB8C00', label: 'Orange' },
    { color: '#6D4C41', label: 'Brown' },
    { color: '#546E7A', label: 'Slate' },
    { color: '#1A1A2E', label: 'Midnight' },
  ];

  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  const currentColor = document.getElementById('myBanner')?.style.getPropertyValue('--banner-color') || '#FF6B4A';

  overlay.innerHTML = `
    <div class="sheet">
      <button class="sheet-close" onclick="this.closest('.overlay').remove()">✕</button>
      <div style="font-weight:800;font-size:17px;margin-bottom:20px;">Settings</div>

      <div class="p-section">
        <div class="p-section-title">Display Name</div>
        <div style="display:flex;gap:8px">
          <input class="field" id="pName" type="text" value="${esc(document.querySelector('.my-name')?.textContent || '')}" placeholder="Your name" style="flex:1">
          <button class="btn-save-sm" onclick="saveName()">Save</button>
        </div>
      </div>

      <div class="p-section">
        <div class="p-section-title">Bio <span style="font-weight:400;color:var(--muted)">Visible on your public profile</span></div>
        <div style="display:flex;gap:8px;align-items:flex-start">
          <textarea class="field" id="pBio" placeholder="What's your vibe?" style="flex:1;min-height:70px;resize:none"></textarea>
          <button class="btn-save-sm" onclick="saveBio()">Save</button>
        </div>
      </div>

      <div class="p-section">
        <div class="p-section-title">Banner Color</div>
        <div class="banner-color-grid" id="bannerColorGrid">
          ${BANNER_COLORS.map(c => `
            <button class="banner-color-swatch" style="background:${c.color}" title="${c.label}"
              onclick="pickBannerColor('${c.color}',this)">
              ${c.label === 'Coral' ? '✓' : ''}
            </button>`).join('')}
        </div>
      </div>

      <div class="p-section">
        <div class="p-section-title">Weekly Digest Email</div>
        <label class="toggle-row">
          <input type="checkbox" id="digestCb" onchange="saveDigest(this.checked)">
          <span class="t-track"><span class="t-thumb"></span></span>
          <span class="t-text">Email me new happy hours & events weekly</span>
        </label>
      </div>

      <div class="p-section">
        <div class="p-section-title">Privacy</div>
        <label class="toggle-row">
          <input type="checkbox" id="publicCb" checked onchange="savePrivacy(this.checked)">
          <span class="t-track"><span class="t-thumb"></span></span>
          <span class="t-text">Public profile — others can view your activity</span>
        </label>
      </div>

      <div class="p-section">
        <div class="p-section-title">Feedback & Data Issues</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <select class="field" id="pFeedbackType" style="font-size:14px">
            <option value="">Select a reason…</option>
            <option value="wrong_data">Restaurant/venue data is wrong</option>
            <option value="missing_venue">Missing a venue</option>
            <option value="hours_wrong">Happy hour hours are incorrect</option>
            <option value="bug">App bug or issue</option>
            <option value="suggestion">Feature suggestion</option>
            <option value="other">Other</option>
          </select>
          <textarea class="field" id="pFeedbackText" placeholder="Tell us what's wrong or what you'd like to see…" style="min-height:80px;resize:none;font-size:14px"></textarea>
          <button class="btn-save-sm" style="width:100%;padding:12px" onclick="submitFeedback()">Send Feedback</button>
        </div>
      </div>

      <button onclick="authSignOut().then(()=>{this.closest('.overlay').remove();closeProfile();})"
        style="width:100%;margin-top:8px;padding:13px;border-radius:12px;border:1.5px solid #e53935;background:none;color:#e53935;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:700;cursor:pointer;">
        Sign Out
      </button>
    </div>`;

  // Pre-fill bio and toggles
  document.body.appendChild(overlay);
  // Load current profile values
  if (currentUser) {
    fetchProfile(currentUser.id).then(p => {
      const bioEl = overlay.querySelector('#pBio');
      const digestEl = overlay.querySelector('#digestCb');
      const publicEl = overlay.querySelector('#publicCb');
      if (bioEl && p?.bio) bioEl.value = p.bio;
      if (digestEl) digestEl.checked = p?.digest_enabled || false;
      if (publicEl) publicEl.checked = p?.is_public !== false;
      // Mark current banner color
      const currentBanner = p?.banner_color || '#FF6B4A';
      overlay.querySelectorAll('.banner-color-swatch').forEach(sw => {
        sw.textContent = sw.style.background === currentBanner || sw.title === BANNER_COLORS.find(c=>c.color===currentBanner)?.label ? '✓' : '';
      });
    });
  }
}

async function submitFeedback() {
  const type = document.getElementById('pFeedbackType')?.value;
  const text = (document.getElementById('pFeedbackText')?.value || '').trim();
  if (!type) { showToast('Please select a feedback type'); return; }
  if (!text) { showToast('Please describe the issue'); return; }
  const btn = document.querySelector('#pFeedbackText + button') ||
              document.querySelector('[onclick="submitFeedback()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    await db.from('feedback').insert({
      user_id: currentUser?.id || null,
      type,
      text,
      url: window.location.href,
      created_at: new Date().toISOString(),
    });
    document.getElementById('pFeedbackType').value = '';
    document.getElementById('pFeedbackText').value = '';
    showToast('✓ Feedback sent — thank you!');
  } catch(e) {
    showToast('❌ Could not send feedback');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Send Feedback'; }
}

async function pickBannerColor(color, btn) {
  // Update banner immediately
  const banner = document.getElementById('myBanner');
  if (banner) banner.style.background = `linear-gradient(135deg, ${color} 0%, ${color}cc 55%, ${color}88 100%)`;
  // Update checkmarks
  btn.closest('.banner-color-grid').querySelectorAll('.banner-color-swatch').forEach(s => s.textContent = '');
  btn.textContent = '✓';
  // Save to profile
  await updateProfile(currentUser.id, { banner_color: color });
  showToast('Banner updated!');
}

function showBadgeInfo(badgeKey) {
  const def = BADGE_DEFS[badgeKey] || {};
  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.style.cssText = 'display:flex;align-items:center;justify-content:center;';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div style="background:var(--card);border-radius:20px;padding:28px 24px;max-width:300px;width:90%;text-align:center;position:relative;">
      <button onclick="this.closest('.overlay').remove()" style="position:absolute;top:12px;right:16px;background:none;border:none;font-size:20px;cursor:pointer;color:var(--muted);">✕</button>
      <div style="font-size:48px;margin-bottom:12px;">${def.emoji || '🏅'}</div>
      <div style="font-size:18px;font-weight:800;margin-bottom:8px;">${def.label || badgeKey}</div>
      <div style="font-size:14px;color:var(--muted);line-height:1.5;">${def.desc || 'Badge earned on Spotd'}</div>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);font-size:12px;color:var(--muted);">🏆 You've earned this badge!</div>
    </div>`;
  document.body.appendChild(overlay);
}

async function showFollowersList() {
  if (!currentUser) return;
  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="sheet" style="max-height:70vh;display:flex;flex-direction:column;">
      <div style="font-weight:800;font-size:17px;margin-bottom:16px;">Followers</div>
      <button class="sheet-close" onclick="this.closest('.overlay').remove()">✕</button>
      <div id="followers-list" style="overflow-y:auto;flex:1;">
        <div style="text-align:center;padding:20px;color:var(--muted);">Loading…</div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const followerRows = await getFollowers(currentUser.id);
  const list = document.getElementById('followers-list');
  // getFollowers returns [{follower_id: '...'}]
  const followerIds = (followerRows || []).map(r => r.follower_id || r).filter(Boolean);

  if (!followerIds.length) {
    list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">No followers yet</div>';
    return;
  }
  const { data: profiles } = await db.from('profiles')
    .select('id, display_name, avatar_emoji, username')
    .in('id', followerIds);
  list.innerHTML = (profiles || []).map(p => `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer;"
      onclick="this.closest('.overlay').remove();openPublicProfile('${p.id}')">
      <div style="width:42px;height:42px;border-radius:50%;background:var(--bg2);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">${p.avatar_emoji || '🍺'}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:14px;">${esc(p.display_name || 'Spotd User')}</div>
        ${p.username ? `<div style="font-size:12px;color:var(--muted);">@${esc(p.username)}</div>` : ''}
      </div>
      <div style="color:var(--muted);font-size:18px;">›</div>
    </div>`).join('') || '<div style="text-align:center;padding:20px;color:var(--muted);">No followers yet</div>';
}
function toggleAvatarPicker() {
  const p = document.getElementById('avatarPicker');
  p.style.display = p.style.display === 'none' ? 'flex' : 'none';
}
async function pickAvatar(emoji) {
  document.getElementById('myAvatar').textContent = emoji;
  document.getElementById('avatarPicker').style.display = 'none';
  await updateProfile(currentUser.id, { avatar_emoji: emoji });
  showToast('Avatar updated!');
}
async function saveName() { const n = document.getElementById('pName').value.trim(); if (!n) return; await updateProfile(currentUser.id, { display_name: n }); showToast('Name saved'); }
async function saveBio() { const b = document.getElementById('pBio').value.trim(); await updateProfile(currentUser.id, { bio: b }); showToast('Bio saved'); }
async function saveDigest(v) { await setDigestPreference(currentUser.id, v); showToast(v ? 'Digest enabled' : 'Digest off'); }
async function savePrivacy(isPublic) { await savePrivacySetting(currentUser.id, isPublic); showToast(isPublic ? 'Profile is now public' : 'Profile is now private'); }
async function renderHoodFollowBar() {
  const bar = document.getElementById('hoodFollowBar');
  if (!bar) return;
  const areas = [...new Set([...state.venues, ...state.events].map(v => v.neighborhood).filter(Boolean))].sort();
  if (!areas.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  let followed = [];
  if (currentUser) {
    try { followed = await getFollowedNeighborhoods(currentUser.id); } catch(e) {}
  }
  bar.innerHTML = `<span class="hood-follow-bar-label">Neighborhoods</span>`
    + areas.map(a => `<button class="hood-follow-pill${followed.includes(a) ? ' following' : ''}" onclick="toggleHoodFromBar('${a.replace(/'/g,"\\'")}',this)">${followed.includes(a) ? '✓ ' : ''}${a}</button>`).join('');
}

async function toggleHoodFromBar(hood, btn) {
  if (!currentUser) { openAuth('signin'); showToast('Sign in to follow neighborhoods'); return; }
  const added = await toggleNeighborhoodFollow(currentUser.id, hood);
  btn.classList.toggle('following', added);
  btn.textContent = (added ? '✓ ' : '') + hood;
  showToast(added ? `Following ${hood} 🏘️` : `Unfollowed ${hood}`);
}

async function toggleHood(hood, btn) { if (!currentUser) return; const added = await toggleNeighborhoodFollow(currentUser.id, hood); btn.classList.toggle('on', added); showToast(added ? `Following ${hood}` : `Unfollowed ${hood}`); }

// ── FIND PEOPLE ────────────────────────────────────────
async function openFindPeople() {
  if (!currentUser) { openAuth('signin'); return; }
  document.getElementById('findPeopleContent').innerHTML = `
    <div style="position:relative;margin-bottom:16px">
      <input class="field" id="peopleSearch" type="text" placeholder="Search by name…"
        oninput="debouncePeopleSearch(this.value)"
        style="width:100%;box-sizing:border-box">
    </div>
    <div id="peopleResults"><div style="text-align:center;padding:32px;color:var(--muted)">Loading…</div></div>`;
  openSubPage('findPeoplePage');
  setTimeout(() => document.getElementById('peopleSearch')?.focus(), 300);
  const following = await getFollowing(currentUser.id);
  state._following = new Set(following);
  await loadPeopleResults('');
}

async function loadPeopleResults(query) {
  const el = document.getElementById('peopleResults');
  if (!el) return;
  const followingSet = state._following || new Set();

  if (query.length >= 2) {
    el.innerHTML = `<div style="text-align:center;padding:16px;color:var(--muted);font-size:13px">Searching…</div>`;
    const results = await searchProfiles(query);
    const filtered = results.filter(p => p.id !== currentUser.id);
    if (!filtered.length) { el.innerHTML = `<div class="pub-empty">No one found for "${esc(query)}"</div>`; return; }
    el.innerHTML = filtered.map(p => peopleRowHTML(p, followingSet)).join('');
  } else {
    // Show following list
    if (followingSet.size === 0) {
      el.innerHTML = `<div class="pub-empty" style="padding-top:32px">Search above to find friends 👆</div>`;
      return;
    }
    el.innerHTML = `<div class="people-section-label">Following (${followingSet.size})</div><div style="text-align:center;padding:12px;color:var(--muted);font-size:13px">Loading…</div>`;
    const ids = [...followingSet];
    const { data } = await db.from('profiles').select('id, display_name, avatar_emoji, bio').in('id', ids);
    el.innerHTML = `<div class="people-section-label">Following (${followingSet.size})</div>` +
      (data || []).map(p => peopleRowHTML(p, followingSet)).join('');
  }
}

function peopleRowHTML(p, followingSet) {
  const isF = followingSet.has(p.id);
  const name = p.display_name || 'Spotd User';
  return `<div class="people-row">
    <div class="feed-avatar" onclick="closeSubPage('findPeoplePage');openPublicProfile('${p.id}')" style="cursor:pointer">${p.avatar_emoji || '🍺'}</div>
    <div class="people-info" onclick="closeSubPage('findPeoplePage');openPublicProfile('${p.id}')" style="cursor:pointer;flex:1;min-width:0">
      <div class="people-name">${esc(name)}</div>
      ${p.bio ? `<div class="people-bio">${esc(p.bio)}</div>` : ''}
    </div>
    <button class="people-follow-btn ${isF ? 'following' : ''}" onclick="toggleFollowFromSearch('${p.id}',this)">
      ${isF ? '✓ Following' : '+ Follow'}
    </button>
  </div>`;
}

let _peopleSearchTimer = null;
function debouncePeopleSearch(val) {
  clearTimeout(_peopleSearchTimer);
  _peopleSearchTimer = setTimeout(() => loadPeopleResults(val), 300);
}

function refreshFollowStats() {
  const f = state._following?.size ?? 0;
  const followingEl = document.getElementById('stat-following');
  if (followingEl) followingEl.textContent = f;
  // Also update pub-follow-btn in open public profiles
}

async function toggleFollowFromSearch(userId, btn) {
  if (!currentUser) return;
  const isNowFollowing = btn.classList.contains('following');
  if (isNowFollowing) {
    await unfollowUser(currentUser.id, userId);
    state._following?.delete(userId);
    btn.classList.remove('following');
    btn.textContent = '+ Follow';
    showToast('Unfollowed');
  } else {
    await followUser(currentUser.id, userId);
    state._following?.add(userId);
    btn.classList.add('following');
    btn.textContent = '✓ Following';
    showToast('Following! 🎉');
    await checkAndAwardBadges(currentUser.id);
  }
  refreshFollowStats();
}



// ── SHARE ──────────────────────────────────────────────
function shareItem(id, type) {
  const items = type === 'venue' ? state.venues : state.events;
  const v = items.find(x => String(x.id) === String(id)); if (!v) return;
  const msg = type === 'venue'
    ? `Happy Hour at ${v.name}\n📍 ${v.neighborhood} — ${v.address}\n🕐 ${v.hours}\n${(v.deals||[]).slice(0,2).join(' · ')}\n\nSpotd — spotd.app`
    : `${v.event_type} at ${v.venue_name || v.name}\n📍 ${v.neighborhood} — ${v.address}\n🕐 ${v.hours}\n\nSpotd — spotd.app`;
  if (navigator.share) { navigator.share({ title: v.name, text: msg }).catch(() => {}); }
  else { window.open(`sms:?body=${encodeURIComponent(msg)}`, '_blank'); }
}

// ── VIEW TOGGLE ────────────────────────────────────────
function toggleView() {
  const isMap = state.view === 'map'; state.view = isMap ? 'list' : 'map';
  document.getElementById('listView').classList.toggle('active', state.view === 'list');
  document.getElementById('mapView').classList.toggle('active',  state.view === 'map');
  document.getElementById('viewIcon').textContent = state.view === 'map' ? 'List' : 'Map';
  document.getElementById('viewToggle').classList.toggle('map-active', state.view === 'map');
  if (state.view === 'map') setTimeout(() => { state.map.invalidateSize(); updateMapMarkers(); buildMapSidebar(); }, 100);
}
function goToMap(id) { closeOverlay('modalOverlay'); if (state.view !== 'map') toggleView(); setTimeout(() => flyTo(id), 350); }

// ── MAP ────────────────────────────────────────────────
function initMap() {
  if (state.map) { state.map.remove(); state.map = null; }
  const cityCenter = getCityCenter(state.city?.slug);
  const map = L.map('map', { center: cityCenter, zoom: 11 });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© OpenStreetMap © CARTO', subdomains: 'abcd', maxZoom: 19 }).addTo(map);
  state.map = map;
}
function getCityCenter(slug) {
  const centers = {
    'san-diego':     [32.82, -117.18],
    'los-angeles':   [34.05, -118.24],
    'new-york':      [40.71,  -74.01],
    'chicago':       [41.88,  -87.63],
    'austin':        [30.27,  -97.74],
    'miami':         [25.77,  -80.19],
    'orange-county': [33.71, -117.83],
  };
  return centers[slug] || [39.5, -98.35];
}
function updateMapMarkers() {
  Object.values(state.markers).forEach(m => m.remove()); state.markers = {};
  state.filtered.forEach(v => {
    if (!v.lat || !v.lng) return;
    const isEvent = !!v.event_type;
    const color   = isEvent ? '#a588ff' : (v.days||[]).includes(TODAY) ? '#FF6B4A' : '#3A4560';
    const icon = L.divIcon({ className:'', html:`<div style="width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px solid rgba(255,255,255,0.6);box-shadow:0 2px 8px rgba(0,0,0,.5)"></div>`, iconSize:[24,24], iconAnchor:[12,24], popupAnchor:[0,-26] });
    const marker = L.marker([v.lat, v.lng], { icon }).addTo(state.map).bindPopup(popupHTML(v), { maxWidth: 250 });
    marker.on('click', () => hlMapCard(v.id));
    state.markers[v.id] = marker;
  });
}
function popupHTML(v) {
  return `<div class="popup-body"><div class="popup-name">${esc(v.name)}</div><div class="popup-hood">${esc(v.neighborhood||'')}</div><div class="popup-when">${esc(v.hours||'')}</div>${(v.deals||[]).slice(0,2).map(d=>`<div class="popup-deal">${esc(d)}</div>`).join('')}<div class="popup-actions"><button class="popup-btn" onclick="openModal('${v.id}','${v.event_type?'event':'venue'}')">Details</button><button class="popup-share" onclick="shareItem('${v.id}','${v.event_type?'event':'venue'}')">Share</button></div></div>`;
}
function flyTo(id) {
  const all = [...state.venues, ...state.events];
  const v   = all.find(x => String(x.id) === String(id));
  if (!v || !v.lat || !state.map) return;
  state.map.flyTo([v.lat, v.lng], 15, { animate: true, duration: 0.8 });
  if (state.markers[id]) setTimeout(() => state.markers[id].openPopup(), 900);
  hlMapCard(id);
}
function hlMapCard(id) {
  document.querySelectorAll('.map-card').forEach(c => c.classList.toggle('highlighted', c.dataset.id == id));
  const c = document.querySelector(`.map-card[data-id="${id}"]`);
  if (c) c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function buildMapSidebar() {
  document.getElementById('mapCards').innerHTML = state.filtered.map(v => `<div class="map-card" data-id="${v.id}" onclick="flyTo('${v.id}')"><div class="map-card-name">${esc(v.name)}</div><div class="map-card-hood">${esc(v.neighborhood||'')}</div><div class="map-card-when">${esc(v.hours||'')}</div></div>`).join('');
}

// ── OVERLAY HELPERS ────────────────────────────────────
function openOverlay(id)  {
  const el = document.getElementById(id); if (!el) return;
  el.classList.add('open');
  const profileOpen = document.getElementById('profilePage')?.classList.contains('profile-page--open');
  if (!profileOpen) document.body.style.overflow = 'hidden';
  // Attach swipe-down-to-dismiss to the sheet inside this overlay
  const sheet = el.querySelector('.sheet');
  if (sheet) attachSwipeDismiss(sheet, id);
}
function closeOverlay(id) {
  const el = document.getElementById(id); if (!el) return;
  el.classList.remove('open');
  if (!document.querySelector('.overlay.open')) document.body.style.overflow = '';
}

function attachSwipeDismiss(sheet, overlayId) {
  // Remove any previous listeners to avoid stacking
  if (sheet._swipeHandler) {
    sheet.removeEventListener('touchstart', sheet._swipeHandler, { passive: true });
    sheet.removeEventListener('touchmove',  sheet._swipeMoveHandler);
    sheet.removeEventListener('touchend',   sheet._swipeEndHandler);
  }

  let startY = 0, currentY = 0, dragging = false;
  const DISMISS_THRESHOLD = 80; // px needed to dismiss

  sheet._swipeHandler = (e) => {
    // Only start drag if at the very top of the sheet scroll
    if (sheet.scrollTop > 4) return;
    startY = e.touches[0].clientY;
    currentY = startY;
    dragging = true;
    sheet.style.transition = 'none';
  };

  sheet._swipeMoveHandler = (e) => {
    if (!dragging) return;
    currentY = e.touches[0].clientY;
    const dy = currentY - startY;
    if (dy < 0) { sheet.style.transform = ''; return; } // no upward drag
    // Resist a little — rubber band feel
    const resistance = dy / (1 + dy * 0.003);
    sheet.style.transform = `translateY(${resistance}px)`;
    // Fade the overlay backdrop as you drag
    const overlay = document.getElementById(overlayId);
    if (overlay) overlay.style.background = `rgba(26,18,8,${Math.max(0, 0.75 - (dy / 300))})`;
    e.preventDefault();
  };

  sheet._swipeEndHandler = () => {
    if (!dragging) return;
    dragging = false;
    const dy = currentY - startY;
    sheet.style.transition = '';

    if (dy > DISMISS_THRESHOLD) {
      // Animate out then close
      sheet.style.transform = `translateY(100%)`;
      sheet.style.opacity = '0';
      setTimeout(() => {
        sheet.style.transform = '';
        sheet.style.opacity  = '';
        closeOverlay(overlayId);
      }, 260);
    } else {
      // Snap back
      sheet.style.transform = '';
      const overlay = document.getElementById(overlayId);
      if (overlay) overlay.style.background = '';
    }
  };

  sheet.addEventListener('touchstart', sheet._swipeHandler,     { passive: true });
  sheet.addEventListener('touchmove',  sheet._swipeMoveHandler, { passive: false });
  sheet.addEventListener('touchend',   sheet._swipeEndHandler,  { passive: true });
}

// ── UTILS ──────────────────────────────────────────────
function avgFromList(r)    { return r.length ? r.reduce((s,x) => s+x.rating, 0)/r.length : 0; }
function starHTML(rating, max=5, size=13) { return Array.from({length:max},(_,i)=>`<span style="font-size:${size}px;color:${i<Math.round(rating)?'#E8943A':'rgba(42,31,20,0.15)'}">★</span>`).join(''); }
function fmtDate(iso)      { return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function showToast(msg)    { document.querySelectorAll('.toast').forEach(t=>t.remove()); const t=document.createElement('div'); t.className='toast'; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),2600); }
function openPhotoLightbox(url, name) {
  const lb = document.createElement('div');
  lb.id = 'photo-lightbox';
  lb.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:20px;';
  lb.innerHTML = `
    <button onclick="this.parentElement.remove()" style="position:absolute;top:16px;right:16px;background:rgba(255,255,255,0.15);border:none;color:#fff;font-size:22px;width:40px;height:40px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
    <img src="${url}" alt="${name}" style="max-width:100%;max-height:90vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.5);">
  `;
  lb.addEventListener('click', e => { if (e.target === lb) lb.remove(); });
  document.body.appendChild(lb);
}
function esc(s)            { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// ── CHECK-INS ──────────────────────────────────────────
async function loadReviewAverages(citySlug) {
  try {
    // Fetch all venue reviews in one query — just id + rating, no text needed
    const venueIds = state.venues.map(v => v.id);
    if (!venueIds.length) return;

    // Fetch in one shot — select only what we need
    const { data } = await db
      .from('reviews')
      .select('venue_id, rating')
      .in('venue_id', venueIds);

    if (!data || !data.length) return;

    // Group by venue_id and build synthetic cache entries
    const grouped = {};
    data.forEach(r => {
      if (!grouped[r.venue_id]) grouped[r.venue_id] = [];
      grouped[r.venue_id].push(r);
    });

    const now = Date.now();
    Object.entries(grouped).forEach(([vid, reviews]) => {
      const key = `venue-${vid}`;
      // Only populate if not already cached from a modal open
      if (!state.reviewCache[key]) {
        state.reviewCache[key] = reviews;
        state.reviewCacheTime[key] = now;
      }
    });

    // Re-render cards so stars show up
    renderCards();
  } catch(e) { console.warn('loadReviewAverages failed', e); }
}

async function loadGoingTonight(citySlug) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const counts = await fetchCheckInCounts(citySlug, today);
    state.goingCounts = {};
    (counts || []).forEach(r => { state.goingCounts[r.venue_id] = r.count; });
    state.goingByMe = new Set();
    state.todayCheckInCount = 0;
    if (currentUser) {
      const mine = await fetchMyCheckIns(currentUser.id, today);
      (mine || []).forEach(r => { state.goingByMe.add(r.venue_id); state.todayCheckInCount++; });
    }
  } catch(e) { console.warn('Check-in load failed', e); }
}

const CHECK_IN_DAILY_LIMIT = 5;

async function doGoingTonight(venueId, btn) {
  if (!currentUser) { openAuth('signin'); showToast('Sign in to check in'); return; }
  const isCheckedIn = state.goingByMe.has(venueId);
  const today = new Date().toISOString().slice(0, 10);
  if (isCheckedIn) {
    await removeCheckIn(currentUser.id, venueId, today);
    state.goingByMe.delete(venueId);
    state.todayCheckInCount = Math.max(0, state.todayCheckInCount - 1);
    state.goingCounts[venueId] = Math.max(0, (state.goingCounts[venueId] || 1) - 1);
    showToast('Check-in removed');
  } else {
    if (state.todayCheckInCount >= CHECK_IN_DAILY_LIMIT) {
      showToast(`You've hit the ${CHECK_IN_DAILY_LIMIT} check-in limit for today 🙌`);
      return;
    }
    await addCheckIn({ userId: currentUser.id, venueId, citySlug: state.city.slug, date: today });
    state.goingByMe.add(venueId);
    state.todayCheckInCount++;
    state.goingCounts[venueId] = (state.goingCounts[venueId] || 0) + 1;
    showToast('📍 Checked in!');
    if (typeof haptic === 'function') haptic('medium');
    setTimeout(() => checkStreakAfterCheckIn(), 2200);
    setTimeout(() => maybeOpenPhotoCheckin(venueId), 3200);
  }
  const count = state.goingCounts[venueId] || 0;
  const nowIn = state.goingByMe.has(venueId);
  if (btn) { btn.classList.toggle('going-active', nowIn); btn.innerHTML = checkInBtnLabel(count, nowIn); }
  const badge = document.querySelector(`.card[data-id="${venueId}"] .fire-badge`);
  if (badge) {
    if (count >= 2) { badge.textContent = `🔥 ${count} here tonight`; badge.style.display = 'inline-flex'; }
    else badge.style.display = 'none';
  }
  refreshCheckInCounters();
}

function checkInBtnLabel(count, isIn) {
  if (isIn) return count > 1 ? `📍 You + ${count - 1} here` : "📍 You're here!";
  if (state.todayCheckInCount >= CHECK_IN_DAILY_LIMIT) return '🙌 Limit reached for today';
  return count > 0 ? `🔥 ${count} here — join?` : '📍 Check In';
}

function refreshCheckInCounters() {
  document.querySelectorAll('.going-btn').forEach(btn => {
    const card = btn.closest('[data-id]');
    const vid = card?.dataset.id || btn.dataset.vid;
    if (!vid) return;
    const count = state.goingCounts[vid] || 0;
    const isIn = state.goingByMe.has(vid);
    btn.classList.toggle('going-active', isIn);
    btn.innerHTML = checkInBtnLabel(count, isIn);
  });
}

function goingFireBadge(venueId) {
  const count = state.goingCounts[venueId] || 0;
  if (count < 2) return '';
  return `<span class="fire-badge">🔥 ${count} here tonight</span>`;
}

// ── PUBLIC PROFILE ──────────────────────────────────────
async function openPublicProfile(userId) {
  if (userId === currentUser?.id) { openProfile(); return; }
  document.getElementById('pubProfileContent').innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted)">Loading…</div>`;
  openOverlay('pubProfileOverlay');
  await renderPublicProfile(userId);
}

async function renderPublicProfile(userId) {
  const [profile, reviews, checkIns, badges, favItems, amIFollowing] = await Promise.all([
    fetchPublicProfile(userId),
    fetchMyReviews(userId),
    fetchAllCheckIns(userId),
    getUserBadges(userId),
    getFavoriteItems(userId),
    currentUser ? isFollowing(currentUser.id, userId) : Promise.resolve(false),
  ]);

  if (!profile) {
    document.getElementById('pubProfileContent').innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted)">This profile is private.</div>`;
    return;
  }

  const allItems = [...state.venues, ...state.events];
  const favSpots = allItems.filter(v => new Set(favItems.map(f=>String(f.item_id))).has(String(v.id)));
  const recentCheckIns = checkIns.slice(0, 20);
  // Fall back to name from their reviews if no display_name set
  const reviewerName = reviews.length ? (reviews[0].name || null) : null;
  const displayName = profile.display_name || reviewerName || 'Spotd User';
  const avatar = profile.avatar_emoji || '🍺';
  const totalVenues = new Set(checkIns.map(c => c.venue_id)).size;

  document.getElementById('pubProfileContent').innerHTML = `
    <div class="pub-profile-header">
      <div class="pub-avatar">${avatar}</div>
      <div class="pub-profile-info">
        <div class="pub-name">${esc(displayName)}</div>
        ${profile.username ? `<div class="pub-username">@${esc(profile.username)}</div>` : ''}
        ${profile.bio ? `<div class="pub-bio">${esc(profile.bio)}</div>` : ''}
        <div class="pub-stats">
          <div class="pub-stat"><span>${checkIns.length}</span>Check-ins</div>
          <div class="pub-stat"><span>${reviews.length}</span>Reviews</div>
          <div class="pub-stat"><span>${totalVenues}</span>Venues</div>
        </div>
      </div>
    </div>
    ${badges.length ? `<div class="pub-badges">${badges.map(b => {
      const def = BADGE_DEFS[b.badge_key] || {};
      return `<span class="badge-chip" title="${def.desc || b.badge_key}">${def.emoji || '🏅'} ${def.label || b.badge_key}</span>`;
    }).join('')}</div>` : ''}
    ${currentUser && currentUser.id !== userId ? `
    <div class="pub-action-row">
      <button class="pub-follow-btn ${amIFollowing ? 'following' : ''}" id="pub-follow-btn"
        onclick="toggleFollowUser('${userId}', this)">
        ${amIFollowing ? '✓ Following' : '+ Follow'}
      </button>
      <button class="pub-dm-btn" onclick="dmOpenFromProfile('${userId}', '${esc(displayName)}')">
        💬 Message
      </button>
    </div>` : ''}
    <div class="pub-tabs">
      <button class="pub-tab active" onclick="switchPubTab('checkins', this)">📍 Check-ins</button>
      <button class="pub-tab" onclick="switchPubTab('reviews', this)">⭐ Reviews</button>
      <button class="pub-tab" onclick="switchPubTab('favorites', this)">♥ Saved</button>
    </div>
    <div id="pub-tab-checkins" class="pub-tab-content active">
      ${recentCheckIns.length ? recentCheckIns.map(c => {
        const v = allItems.find(x => String(x.id) === String(c.venue_id));
        return `<div class="pub-activity-row" onclick="${v ? `closeOverlay('pubProfileOverlay');openModal('${c.venue_id}','venue')` : ''}">
          <div class="pub-activity-icon">📍</div>
          <div class="pub-activity-body">
            <div class="pub-activity-title">${v ? esc(v.name) : esc(c.venue_name || 'A spot')}</div>
            <div class="pub-activity-meta">${c.neighborhood || ''} · ${fmtDate(c.created_at || c.date)}</div>
            ${c.note ? `<div class="pub-activity-note">"${esc(c.note)}"</div>` : ''}
          </div>
        </div>`;
      }).join('') : '<div class="pub-empty">No check-ins yet</div>'}
    </div>
    <div id="pub-tab-reviews" class="pub-tab-content" style="display:none">
      ${reviews.length ? reviews.map(r => {
        const item = allItems.find(x => String(x.id) === String(r.venue_id || r.event_id));
        return `<div class="pub-activity-row" onclick="${item ? `closeOverlay('pubProfileOverlay');openModal('${r.venue_id||r.event_id}','${r.venue_id?'venue':'event'}')` : ''}">
          <div class="pub-activity-icon">⭐</div>
          <div class="pub-activity-body">
            <div class="pub-activity-title">${item ? esc(item.name) : 'A spot'}</div>
            <div class="pub-activity-meta">${starHTML(r.rating,5,11)} · ${fmtDate(r.created_at)}</div>
            ${r.text ? `<div class="pub-activity-note">"${esc(r.text)}"</div>` : ''}
          </div>
        </div>`;
      }).join('') : '<div class="pub-empty">No reviews yet</div>'}
    </div>
    <div id="pub-tab-favorites" class="pub-tab-content" style="display:none">
      ${favSpots.length ? favSpots.map(v => `
        <div class="pub-activity-row" onclick="closeOverlay('pubProfileOverlay');openModal('${v.id}','${v.event_type?'event':'venue'}')">
          <div class="pub-activity-icon">♥</div>
          <div class="pub-activity-body">
            <div class="pub-activity-title">${esc(v.name)}</div>
            <div class="pub-activity-meta">${esc(v.neighborhood||'')} · ${esc(v.hours||'')}</div>
          </div>
        </div>`).join('') : '<div class="pub-empty">No saved spots</div>'}
    </div>`;
}

function switchPubTab(tab, btn) {
  document.querySelectorAll('.pub-tab-content').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.pub-tab').forEach(b => b.classList.remove('active'));
  document.getElementById('pub-tab-' + tab).style.display = 'block';
  btn.classList.add('active');
}

async function toggleFollowUser(userId, btn) {
  if (!currentUser) { openAuth('signin'); return; }
  const isFollowing = btn.classList.contains('following');
  if (isFollowing) {
    await unfollowUser(currentUser.id, userId);
    state._following?.delete(userId);
    btn.classList.remove('following');
    btn.textContent = '+ Follow';
    showToast('Unfollowed');
  } else {
    await followUser(currentUser.id, userId);
    state._following?.add(userId);
    btn.classList.add('following');
    btn.textContent = '✓ Following';
    showToast('Following! 🎉');
    await checkAndAwardBadges(currentUser.id);
  }
  refreshFollowStats();
}

// ── ACTIVITY FEED OVERLAY ──────────────────────────────
async function openActivityFeed() {
  if (!currentUser) { openAuth('signin'); return; }
  document.getElementById('feedContent').innerHTML = `
    <div class="feed-header">
      <button class="feed-tab-btn active" id="ftab-following" onclick="switchFeedTab('following',this)">Following</button>
      <button class="feed-tab-btn" id="ftab-mine" onclick="switchFeedTab('mine',this)">My Activity</button>
    </div>
    <div id="feedRows"><div style="text-align:center;padding:40px;color:var(--muted)">Loading…</div></div>`;
  openSubPage('feedPage');
  await loadFeedTab('following');
}

async function switchFeedTab(tab, btn) {
  document.querySelectorAll('.feed-tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('feedRows').innerHTML = `<div style="text-align:center;padding:32px;color:var(--muted)">Loading…</div>`;
  await loadFeedTab(tab);
}

async function loadFeedTab(tab) {
  const allItems = [...state.venues, ...state.events];
  let activities = [];
  let profileMap = {};

  if (tab === 'following') {
    const following = await getFollowing(currentUser.id);
    if (!following.length) {
      document.getElementById('feedRows').innerHTML = `
        <div class="pub-empty" style="padding:40px 16px">
          <div style="font-size:32px;margin-bottom:12px">👋</div>
          <div style="font-weight:600;margin-bottom:8px">No activity yet</div>
          <div style="color:var(--muted);font-size:13px">Follow people to see their check-ins & reviews here</div>
          <button class="profile-action-btn" style="margin-top:16px;max-width:180px" onclick="closeSubPage('feedPage');openFindPeople()">🔍 Find People</button>
        </div>`;
      return;
    }
    activities = await fetchActivityFeed([...following]);
    const uids = [...new Set(activities.map(a => a.user_id).filter(Boolean))];
    if (uids.length) {
      const { data } = await db.from('profiles').select('id, display_name, avatar_emoji').in('id', uids);
      (data || []).forEach(p => { profileMap[p.id] = p; });
    }
  } else {
    activities = await fetchUserActivity(currentUser.id, 40);
    profileMap[currentUser.id] = { display_name: 'You', avatar_emoji: '🍺' };
  }

  if (!activities.length) {
    document.getElementById('feedRows').innerHTML = `<div class="pub-empty">No activity yet</div>`;
    return;
  }

  const activityLabel = (a) => {
    if (a.activity_type === 'check_in') return 'checked in at <strong>' + esc(a.venue_name||'a spot') + '</strong>';
    if (a.activity_type === 'review') return 'reviewed <strong>' + esc(a.venue_name||'a spot') + '</strong>';
    if (a.activity_type === 'favorite') return 'saved <strong>' + esc(a.venue_name||'a spot') + '</strong>';
    if (a.activity_type === 'badge') { const def = BADGE_DEFS[a.meta?.badge_key]||{}; return 'earned ' + (def.emoji||'🏅') + ' <strong>' + (def.label||'a badge') + '</strong>'; }
    return 'was active';
  };

  document.getElementById('feedRows').innerHTML = activities.map(a => {
    const p = profileMap[a.user_id] || {};
    const isMe = a.user_id === currentUser.id;
    const name = isMe ? 'You' : (p.display_name || 'Someone');
    const avatar = p.avatar_emoji || '🍺';
    const venue = a.venue_id ? allItems.find(x => String(x.id) === String(a.venue_id)) : null;
    const clickable = !!venue;
    const venueClick = clickable ? ' onclick="closeSubPage(\'feedPage\');openModal(\''+a.venue_id+'\',\'venue\')"' : '';
    const avatarClick = !isMe ? ' onclick="event.stopPropagation();closeSubPage(\'feedPage\');openPublicProfile(\''+a.user_id+'\')"' : '';
    const nameClick   = !isMe ? ' onclick="event.stopPropagation();closeSubPage(\'feedPage\');openPublicProfile(\''+a.user_id+'\')"' : '';
    return '<div class="feed-row' + (clickable ? ' feed-row--link' : '') + '"' + venueClick + '>'
      + '<div class="feed-avatar' + (!isMe ? ' feed-avatar--link' : '') + '"' + avatarClick + '>' + avatar + '</div>'
      + '<div class="feed-body">'
      + '<div class="feed-text"><span class="feed-name' + (!isMe ? ' feed-name--link' : '') + '"' + nameClick + '>' + esc(name) + '</span> ' + activityLabel(a) + '</div>'
      + '<div class="feed-meta">' + (a.neighborhood ? '📍 ' + esc(a.neighborhood) + ' · ' : '') + fmtDate(a.created_at) + '</div>'
      + (a.meta?.note ? '<div class="pub-activity-note">"' + esc(a.meta.note) + '"</div>' : '')
      + '</div></div>';
  }).join('');
}

// ── LEADERBOARD ────────────────────────────────────────
async function openLeaderboard() {
  document.getElementById('leaderboardContent').innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted)">Loading…</div>`;
  openSubPage('leaderboardPage');

  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0,10);

  // Fetch this month's check-ins with profile info
  try {
    const { data } = await db.from('check_ins')
      .select('user_id, venue_id')
      .gte('created_at', monthStart)
      .eq('city_slug', state.city?.slug || 'san-diego');

    // Tally per user
    const userMap = {};
    (data || []).forEach(row => {
      const uid = row.user_id;
      if (!userMap[uid]) userMap[uid] = { count: 0, venues: new Set() };
      userMap[uid].count++;
      if (row.venue_id) userMap[uid].venues.add(row.venue_id);
    });

    // Fetch profiles for ranked users
    const rankedUids = Object.keys(userMap);
    let profileMap = {};
    if (rankedUids.length) {
      const { data: profiles } = await db.from('profiles').select('id, display_name, avatar_emoji').in('id', rankedUids);
      (profiles || []).forEach(p => { profileMap[p.id] = p; });
    }

    const ranked = Object.entries(userMap)
      .map(([uid, u]) => ({ uid, count: u.count, venues: u.venues.size }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    const medals = ['🥇','🥈','🥉'];
    const monthName = today.toLocaleString('default', { month: 'long' });

    document.getElementById('leaderboardContent').innerHTML =
      '<div class="s-name" style="font-size:20px;margin-bottom:4px">🏆 Leaderboard</div>'
      + '<div style="color:var(--muted);font-size:13px;margin-bottom:20px">' + monthName + ' · Most check-ins in ' + (state.city?.name || 'your city') + '</div>'
      + (!ranked.length ? '<div class="pub-empty">No check-ins yet this month — be first! 🚀</div>'
      : ranked.map((u, i) => {
          const p = profileMap[u.uid] || {};
          const isMe = u.uid === currentUser?.id;
          const lbClick = !isMe ? ' onclick="closeSubPage(\'leaderboardPage\');openPublicProfile(\''+u.uid+'\')" style="cursor:pointer"' : '';
          return '<div class="leaderboard-row"' + lbClick + '>'
            + '<div class="lb-rank">' + (medals[i] || '#' + (i+1)) + '</div>'
            + '<div class="lb-avatar">' + (p.avatar_emoji || '🍺') + '</div>'
            + '<div class="lb-info"><div class="lb-name">' + (isMe ? 'You' : esc(p.display_name || 'Spotd User')) + '</div>'
            + '<div class="lb-meta">' + u.venues + ' venue' + (u.venues !== 1 ? 's' : '') + '</div></div>'
            + '<div class="lb-count">' + u.count + ' <span style="font-size:11px;font-weight:500;opacity:.6">check-ins</span></div>'
            + '</div>';
        }).join(''));
  } catch(e) {
    document.getElementById('leaderboardContent').innerHTML = `<div class="pub-empty">Could not load leaderboard</div>`;
  }
}

// ── REQUEST A VENUE ────────────────────────────────────
function openRequestVenue() {
  const areas = [...new Set(state.venues.map(v => v.neighborhood).filter(Boolean))].sort();
  document.getElementById('requestContent').innerHTML = `
    <div class="s-tag hh">Request a Venue</div>
    <div class="s-name" style="font-size:22px;margin-bottom:4px">Know a great spot?</div>
    <p style="font-size:13px;color:var(--muted);margin-bottom:20px;line-height:1.6">Tell us about a venue you'd like to see on Spotd. We'll review it and add it if it's a fit.</p>
    <div class="field-group">
      <div class="field-label">Venue name *</div>
      <input class="field" id="req-name" type="text" placeholder="e.g. The Tipsy Crow" autocomplete="off">
    </div>
    <div class="field-group">
      <div class="field-label">Neighborhood</div>
      ${areas.length
        ? `<select class="field" id="req-neighborhood">
            <option value="">Select a neighborhood...</option>
            ${areas.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}
            <option value="__other__">Other / Not sure</option>
          </select>`
        : `<input class="field" id="req-neighborhood" type="text" placeholder="e.g. Gaslamp Quarter">`
      }
    </div>
    <div class="field-group">
      <div class="field-label">Why should we add it?</div>
      <textarea class="field" id="req-reason" rows="3" placeholder="Great happy hour deals, hidden gem, friend works there..."></textarea>
    </div>
    <div id="req-msg" style="display:none;font-size:13px;padding:10px 14px;border-radius:8px;margin-bottom:12px"></div>
    <button class="btn-submit" id="req-btn" onclick="submitVenueRequest()" style="width:100%">Submit Request</button>
    <p style="font-size:11px;color:var(--muted);text-align:center;margin-top:12px">We review all requests manually — usually within a few days.</p>
  `;
  openOverlay('requestOverlay');
}

function closeRequestVenue(e) {
  if (e && e.target !== document.getElementById('requestOverlay')) return;
  closeOverlay('requestOverlay');
}

async function submitVenueRequest() {
  const name = document.getElementById('req-name')?.value.trim();
  const rawNeighborhood = document.getElementById('req-neighborhood')?.value || '';
  const neighborhood = rawNeighborhood === '__other__' ? '' : rawNeighborhood;
  const reason = document.getElementById('req-reason')?.value.trim();
  const msg = document.getElementById('req-msg');
  const btn = document.getElementById('req-btn');

  if (!name) {
    msg.style.display = 'block';
    msg.style.background = 'rgba(200,80,60,0.08)';
    msg.style.border = '1px solid rgba(200,80,60,0.2)';
    msg.style.color = 'rgba(200,80,60,0.85)';
    msg.textContent = 'Please enter a venue name.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Submitting…';

  const { error } = await submitVenueRequestToDB({
    venue_name: name,
    neighborhood: neighborhood || null,
    reason: reason || null,
    city_slug: state.city?.slug || null,
    user_id: currentUser?.id || null,
    user_email: currentUser?.email || null,
  });

  if (error) {
    btn.disabled = false;
    btn.textContent = 'Submit Request';
    msg.style.display = 'block';
    msg.style.background = 'rgba(200,80,60,0.08)';
    msg.style.border = '1px solid rgba(200,80,60,0.2)';
    msg.style.color = 'rgba(200,80,60,0.85)';
    msg.textContent = '❌ Something went wrong. Please try again.';
    return;
  }

  document.getElementById('requestContent').innerHTML = `
    <div style="text-align:center;padding:32px 16px">
      <div style="font-size:48px;margin-bottom:16px">🙌</div>
      <div class="s-name" style="font-size:22px;margin-bottom:8px">Request sent!</div>
      <p style="font-size:14px;color:var(--muted);line-height:1.6">Thanks for the tip. We'll review <strong style="color:var(--text)">${esc(name)}</strong> and add it to Spotd if it's a great fit.</p>
      <button class="btn-sec" style="margin:24px auto 0;display:flex" onclick="closeOverlay('requestOverlay')">Close</button>
    </div>
  `;
}

// ══════════════════════════════════════════════
// WAVE 2: Streaks · Deal Alerts · Tag a Friend
// ══════════════════════════════════════════════

// ── STREAKS ────────────────────────────────────────────
function computeCurrentStreak(checkIns) {
  if (!checkIns.length) return 0;

  // Convert each check-in date to an ISO year-week string "YYYY-WW"
  // Uses ISO 8601 week (Monday start, Thursday determines the year)
  function toIsoWeek(dateStr) {
    const d = new Date(dateStr);
    const day = d.getDay() || 7; // Sunday=0 → 7
    const thu = new Date(d); thu.setDate(d.getDate() + 4 - day);
    const jan1 = new Date(thu.getFullYear(), 0, 1);
    const week = Math.ceil(((thu - jan1) / 86400000 + 1) / 7);
    return `${thu.getFullYear()}-${String(week).padStart(2, '0')}`;
  }

  const weekSet = new Set(checkIns.map(c => toIsoWeek(c.date || c.created_at)));
  const weeks = [...weekSet].sort().reverse(); // most recent first

  const currentWeek = toIsoWeek(new Date().toISOString());
  const lastWeek    = toIsoWeek(new Date(Date.now() - 7 * 86400000).toISOString());

  // Streak only counts if they checked in this week or last week
  if (weeks[0] !== currentWeek && weeks[0] !== lastWeek) return 0;

  let streak = 1;
  for (let i = 1; i < weeks.length; i++) {
    const [y1, w1] = weeks[i - 1].split('-').map(Number);
    const [y2, w2] = weeks[i].split('-').map(Number);
    // Consecutive: same year and w1-w2===1, or year boundary (w1=1, w2=52or53)
    const consecutive = (y1 === y2 && w1 - w2 === 1)
      || (y1 - y2 === 1 && w1 === 1 && w2 >= 52);
    if (consecutive) streak++;
    else break;
  }
  return streak;
}

async function checkStreakAfterCheckIn() {
  if (!currentUser) return;
  try {
    const checkIns = await fetchAllCheckIns(currentUser.id);
    const streak = computeCurrentStreak(checkIns);
    if (streak >= 2) showStreakCelebration(streak);
  } catch(e) {}
}

function showStreakCelebration(streak) {
  // Only celebrate on milestones to avoid being annoying every single week
  const milestones = { 2:'2 weeks in a row', 3:'3-week streak', 4:'4-week streak 🏆', 8:'8-week streak 🏆🏆' };
  const label = milestones[streak] || (streak % 4 === 0 ? `${streak}-week streak!` : null);
  if (!label) return;

  // Remove any existing banner
  document.querySelectorAll('.streak-banner').forEach(b => b.remove());
  const banner = document.createElement('div');
  banner.className = 'streak-banner';
  banner.textContent = `🔥 ${label} — you're on a roll!`;
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 3800);
}

// ── DEAL ALERTS (venue follows) ────────────────────────
async function toggleVenueFollow(venueId, venueName, btn) {
  if (!currentUser) { openAuth('signin'); showToast('Sign in to follow venues'); return; }
  const currently = btn.classList.contains('following');
  btn.disabled = true;
  if (currently) {
    await unfollowVenue(currentUser.id, venueId);
    btn.classList.remove('following');
    btn.innerHTML = '<span class="s-btn-icon">🔔</span>';
    showToast(`Unfollowed ${venueName}`);
  } else {
    await followVenue(currentUser.id, venueId);
    btn.classList.add('following');
    btn.innerHTML = '<span class="s-btn-icon">🔔</span>';
    showToast(`🔔 Following ${venueName} — you'll be notified of new deals`);
  }
  btn.disabled = false;
}

// ── TAG A FRIEND ────────────────────────────────────────
async function maybeOpenTagFriends(venueId) {
  if (!currentUser) return;
  // Only show if user follows at least one person
  const followingIds = await getFollowing(currentUser.id);
  if (!followingIds.length) return;
  const venue = state.venues.find(x => String(x.id) === String(venueId));
  openTagFriends(venueId, venue?.name || 'this spot', followingIds);
}

async function openTagFriends(venueId, venueName, followingIds) {
  const el = document.getElementById('tagFriendsContent');
  if (!el) return;

  el.innerHTML = `<div class="tag-prompt-title">Who'd you go with?</div>
    <div class="tag-prompt-sub">Tag a friend at ${esc(venueName)} and they'll see it in their feed.</div>
    <div class="tag-friends-grid" id="tagFriendsGrid">
      <div style="color:var(--muted);font-size:13px">Loading friends…</div>
    </div>
    <button class="tag-skip-btn" onclick="closeOverlay('tagFriendsOverlay')">Skip</button>`;

  openOverlay('tagFriendsOverlay');

  // Fetch profiles for everyone the user follows
  try {
    const { data: profiles } = await db.from('profiles')
      .select('id, display_name, avatar_emoji')
      .in('id', followingIds)
      .not('display_name', 'is', null)
      .limit(12);

    const grid = document.getElementById('tagFriendsGrid');
    if (!grid) return;
    if (!profiles?.length) {
      grid.innerHTML = `<div style="color:var(--muted);font-size:13px">No friends to tag yet — follow people first.</div>`;
      return;
    }
    grid.innerHTML = profiles.map(p => `
      <button class="tag-friend-chip" id="tag-chip-${p.id}"
        onclick="tagFriend('${p.id}','${esc(p.display_name || '')}','${venueId}','${esc(venueName)}',this)">
        <span class="tag-friend-chip-avatar">${p.avatar_emoji || '🍺'}</span>
        <span class="tag-friend-chip-name">${esc(p.display_name || 'Friend')}</span>
      </button>`).join('');
  } catch(e) {
    const grid = document.getElementById('tagFriendsGrid');
    if (grid) grid.innerHTML = `<div style="color:var(--muted);font-size:13px">Couldn't load friends right now.</div>`;
  }
}

async function tagFriend(toUserId, toName, venueId, venueName, chip) {
  if (chip.classList.contains('tagged')) return; // already tagged
  chip.classList.add('tagged');
  chip.style.pointerEvents = 'none';
  await tagFriendAtCheckIn(currentUser.id, toUserId, venueId, venueName);
  showToast(`Tagged ${toName} at ${venueName} 👋`);
  // Close overlay after a brief moment so user sees the chip light up
  setTimeout(() => closeOverlay('tagFriendsOverlay'), 900);
}

// ══════════════════════════════════════════════
// PHOTO CHECK-INS
// ══════════════════════════════════════════════

// Render the UGC photos strip inside the venue modal
function renderCheckinPhotos(photos, venueId) {
  if (!photos.length) return '';
  const isOwn = id => currentUser && id === currentUser.id;
  return `
    <div class="s-div"></div>
    <div class="ugc-photos-section">
      <div class="ugc-photos-label">📸 From the crowd <span style="font-weight:400;font-size:10px">${photos.length} photo${photos.length !== 1 ? 's' : ''}</span></div>
      <div class="ugc-photos-strip">
        ${photos.map(p => `
          <div class="ugc-photo-thumb" onclick="openPhotoLightbox('${esc(p.photo_url)}','${esc(p.profile?.display_name || 'Photo')}')">
            <img src="${esc(p.photo_url)}" alt="Check-in photo" loading="lazy" onerror="this.closest('.ugc-photo-thumb').remove()">
            <div class="ugc-photo-meta">${esc(p.profile?.display_name || 'Someone')}${p.caption ? ' · ' + esc(p.caption) : ''}</div>
            ${isOwn(p.user_id) ? `<button class="ugc-photo-delete" onclick="event.stopPropagation();doDeleteCheckinPhoto('${p.id}','${esc(p.storage_path)}','${venueId}',this)" title="Delete">✕</button>` : ''}
          </div>`).join('')}
      </div>
    </div>`;
}

// Prompt to add a photo after check-in (shown automatically)
async function maybeOpenPhotoCheckin(venueId) {
  if (!currentUser) {
    // Skip photo, go straight to tag friends
    const followingIds = await getFollowing(currentUser?.id).catch(() => []);
    if (followingIds.length) maybeOpenTagFriends(venueId);
    return;
  }
  const venue = state.venues.find(x => String(x.id) === String(venueId));
  openPhotoCheckinPrompt(venueId, venue?.name || 'this spot');
}

function openPhotoCheckinPrompt(venueId, venueName) {
  const el = document.getElementById('photoCheckinContent');
  if (!el) return;

  el.innerHTML = `
    <div class="photo-prompt-title">Add a photo? 📸</div>
    <div class="photo-prompt-sub">Show others what's happening at ${esc(venueName)} right now.</div>
    <div class="photo-upload-area" id="photoUploadArea"
      ondragover="event.preventDefault();this.classList.add('dragover')"
      ondragleave="this.classList.remove('dragover')"
      ondrop="handlePhotoDropOrChange(event,'${venueId}','${esc(venueName)}')">
      <input type="file" accept="image/*" capture="environment"
        onchange="handlePhotoDropOrChange(event,'${venueId}','${esc(venueName)}')">
      <div class="photo-upload-icon">📷</div>
      <div class="photo-upload-hint">Tap to take a photo or<br><strong>choose from your library</strong></div>
    </div>
    <div class="photo-preview-wrap" id="photoPreviewWrap">
      <img id="photoPreviewImg" src="" alt="Preview">
      <button class="photo-preview-remove" onclick="clearPhotoPreview()">✕</button>
    </div>
    <textarea class="photo-caption-field" id="photoCaptionField"
      placeholder="Add a caption (optional)…" rows="2"></textarea>
    <button class="photo-submit-btn" id="photoSubmitBtn" disabled
      onclick="submitPhotoCheckin('${venueId}','${esc(venueName)}')">Share Photo</button>
    <button class="photo-skip-btn" onclick="skipToTagFriends('${venueId}')">Skip →</button>`;

  openOverlay('photoCheckinOverlay');
}

// Shared handler for both file input change and drag-drop
function handlePhotoDropOrChange(event, venueId, venueName) {
  event.preventDefault();
  document.getElementById('photoUploadArea')?.classList.remove('dragover');
  const file = event.dataTransfer?.files?.[0] || event.target?.files?.[0];
  if (!file || !file.type.startsWith('image/')) { showToast('Please choose an image file'); return; }
  if (file.size > 5 * 1024 * 1024) { showToast('Photo must be under 5 MB'); return; }

  // Store file reference on the window so submitPhotoCheckin can grab it
  window._pendingCheckinPhoto = file;

  const reader = new FileReader();
  reader.onload = e => {
    const wrap = document.getElementById('photoPreviewWrap');
    const img  = document.getElementById('photoPreviewImg');
    const area = document.getElementById('photoUploadArea');
    const btn  = document.getElementById('photoSubmitBtn');
    if (wrap) { wrap.style.display = 'block'; }
    if (img)  { img.src = e.target.result; }
    if (area) { area.style.display = 'none'; }
    if (btn)  { btn.disabled = false; }
  };
  reader.readAsDataURL(file);
}

function clearPhotoPreview() {
  window._pendingCheckinPhoto = null;
  const wrap = document.getElementById('photoPreviewWrap');
  const area = document.getElementById('photoUploadArea');
  const btn  = document.getElementById('photoSubmitBtn');
  const img  = document.getElementById('photoPreviewImg');
  if (wrap) wrap.style.display = 'none';
  if (img)  img.src = '';
  if (area) area.style.display = '';
  if (btn)  btn.disabled = true;
}

async function submitPhotoCheckin(venueId, venueName) {
  const file    = window._pendingCheckinPhoto;
  const caption = document.getElementById('photoCaptionField')?.value.trim() || '';
  const btn     = document.getElementById('photoSubmitBtn');
  if (!file || !currentUser) return;

  btn.disabled = true;
  btn.textContent = 'Uploading…';

  const uploaded = await uploadCheckinPhoto(file, currentUser.id);
  if (!uploaded) {
    btn.disabled = false; btn.textContent = 'Share Photo';
    showToast('Upload failed — please try again'); return;
  }

  await saveCheckinPhoto({
    userId: currentUser.id, venueId, citySlug: state.city?.slug || '',
    photoUrl: uploaded.url, storagePath: uploaded.storagePath, caption
  });

  window._pendingCheckinPhoto = null;
  showToast('📸 Photo shared!');
  closeOverlay('photoCheckinOverlay');

  // Refresh UGC strip if the modal for this venue is open
  const ugcEl = document.getElementById(`ugc-photos-${venueId}`);
  if (ugcEl) {
    fetchCheckinPhotos(venueId).then(photos => {
      ugcEl.innerHTML = renderCheckinPhotos(photos, venueId);
    });
  }

  // Now open tag friends (the full post-check-in chain: photo → tag)
  setTimeout(() => maybeOpenTagFriends(venueId), 600);
}

async function doDeleteCheckinPhoto(photoId, storagePath, venueId, btn) {
  btn.textContent = '…';
  const ok = await deleteCheckinPhotoFromDB(photoId, storagePath);
  if (ok) {
    btn.closest('.ugc-photo-thumb').remove();
    // If strip is now empty, remove the whole section
    const strip = document.querySelector(`#ugc-photos-${venueId} .ugc-photos-strip`);
    if (strip && !strip.children.length) {
      const el = document.getElementById(`ugc-photos-${venueId}`);
      if (el) el.innerHTML = '';
    }
  } else {
    btn.textContent = '✕';
    showToast('Could not delete — please try again');
  }
}

function skipToTagFriends(venueId) {
  closeOverlay('photoCheckinOverlay');
  setTimeout(() => maybeOpenTagFriends(venueId), 300);
}



// ── MESSAGES V2 ────────────────────────────────────────
let dmState = {
  activeConvoId: null,
  activeConvoName: null,
  isGroup: false,
  subscription: null,
};

function openDmPage() {
  const page = document.getElementById('dmPage');
  if (!page) return;
  page.classList.add('dm-page--open');
}
function closeDmPage() {
  const page = document.getElementById('dmPage');
  if (!page) return;
  page.classList.remove('dm-page--open');
  page.style.height = '';
  page.style.top = '';
  if (dmState.subscription) { dmState.subscription.unsubscribe(); dmState.subscription = null; }
}

async function openDmInbox() {
  if (!currentUser) { openAuth('signin'); return; }
  openDmPage();
  dmShowInboxPane();
  await dmLoadInbox();
}

function dmShowInboxPane() {
  document.getElementById('dmInboxPane').style.display = '';
  document.getElementById('dmConvoPane').style.display = 'none';
  document.getElementById('dmBackBtn').style.visibility = 'hidden';
  document.getElementById('dmNewBtn').style.display = '';
  document.getElementById('dmTitle').textContent = 'Messages';
}

async function dmLoadInbox() {
  const list = document.getElementById('dmThreadList');
  list.innerHTML = '<div class="dm-loading">Loading…</div>';
  try {
    const { data: myParts, error: e1 } = await db
      .from('conversation_participants')
      .select('conversation_id, last_read_at')
      .eq('user_id', currentUser.id);
    if (e1) throw e1;
    if (!myParts?.length) {
      list.innerHTML = '<div class="dm-empty">No messages yet.<br>Tap + to start a conversation.</div>';
      dmUpdateBadge(0); return;
    }

    const convoIds = myParts.map(r => r.conversation_id);
    const myReadMap = {};
    myParts.forEach(r => { myReadMap[r.conversation_id] = r.last_read_at; });

    const timeout = ms => new Promise(res => setTimeout(() => res({ data: [], error: null }), ms));

    // Run all queries in parallel — messages gets a 3s timeout so it never blocks
    const [r2, r3, r4] = await Promise.allSettled([
      db.from('conversations').select('id, is_group, name, updated_at').in('id', convoIds).order('updated_at', { ascending: false }),
      db.rpc('get_conversation_participants', { convo_ids: convoIds }),
      Promise.race([
        db.from('messages').select('conversation_id, sender_id, body, msg_type, created_at').in('conversation_id', convoIds).order('created_at', { ascending: false }),
        timeout(3000)
      ])
    ]);

    const convos   = r2.status === 'fulfilled' ? (r2.value.data || []) : [];
    const allParts = r3.status === 'fulfilled' ? (r3.value.data || []) : [];
    const lastMsgs = r4.status === 'fulfilled' ? (r4.value.data || []) : [];

    // Fall back to synthetic list if conversations query failed/empty
    const convoList = convos.length ? convos : convoIds.map(id => ({ id, is_group: false, name: null, updated_at: null }));

    const lastMsgMap = {};
    lastMsgs.forEach(m => { if (!lastMsgMap[m.conversation_id]) lastMsgMap[m.conversation_id] = m; });

    const unreadMap = {};
    lastMsgs.forEach(m => {
      if (m.sender_id === currentUser.id) return;
      const myRead = myReadMap[m.conversation_id];
      if (!myRead || new Date(m.created_at) > new Date(myRead))
        unreadMap[m.conversation_id] = (unreadMap[m.conversation_id] || 0) + 1;
    });

    const convoPartsMap = {};
    allParts.forEach(p => {
      if (!convoPartsMap[p.conversation_id]) convoPartsMap[p.conversation_id] = [];
      convoPartsMap[p.conversation_id].push(p.user_id);
    });

    // Get unique other user IDs from allParts (already have display_name/avatar if RPC returns them)
    // Try profiles fetch with a timeout — render with blanks if it hangs
    const otherIds = [...new Set(allParts.map(p => p.user_id).filter(id => id !== currentUser.id))];
    const pMap = {};
    if (otherIds.length) {
      try {
        const profResult = await Promise.race([
          db.from('profiles').select('id, display_name, avatar_emoji').in('id', otherIds),
          new Promise(res => setTimeout(() => res({ data: [] }), 2000))
        ]);
        (profResult.data || []).forEach(p => { pMap[p.id] = p; });
      } catch(e) { /* render with blanks */ }
    }

    console.log('dmLoadInbox render:', { convoList: convoList.length, pMap: Object.keys(pMap).length });

    let totalUnread = 0;
    const rows = convoList.map(c => {
      try {
        const others = (convoPartsMap[c.id] || []).filter(id => id !== currentUser.id);
        const last   = lastMsgMap[c.id];
        const unread = unreadMap[c.id] || 0;
        totalUnread += unread;

        let name, avatar;
        if (c.is_group) {
          name   = c.name || others.map(id => (pMap[id]?.display_name || 'User').split(' ')[0]).join(', ') || 'Group';
          avatar = '👥';
        } else {
          const p = pMap[others[0]] || {};
          name   = p.display_name || 'Spotd User';
          avatar = p.avatar_emoji || '🍺';
        }

        const preview = last
          ? (last.msg_type === 'venue_share' ? '📍 Shared a venue' : (last.body || '').slice(0, 45))
          : 'Say hello!';
        const time = last ? fmtDate(last.created_at) : '';
        const safeName = (name || '').replace(/'/g, '&#39;');

        return `<div class="dm-thread-row" id="dmrow-${c.id}">
          <div class="dm-thread-main" onclick="dmOpenConvo('${c.id}','${safeName}',${!!c.is_group})">
            <div class="dm-thread-avatar">${avatar}</div>
            <div class="dm-thread-info">
              <div class="dm-thread-name">${esc(name)}${unread ? `<span class="dm-unread-dot">${unread}</span>` : ''}</div>
              <div class="dm-thread-preview">${esc(preview)}</div>
            </div>
            <div class="dm-thread-time">${time}</div>
          </div>
          <button class="dm-thread-delete" onclick="dmDeleteConvo('${c.id}')" title="Delete">🗑</button>
        </div>`;
      } catch(rowErr) {
        console.error('row render error:', rowErr, c);
        return '';
      }
    });

    list.innerHTML = rows.join('') || '<div class="dm-empty">No messages yet.<br>Tap + to start a conversation.</div>';
    dmUpdateBadge(totalUnread);
    console.log('dmLoadInbox done, rows:', rows.length);
  } catch(e) {
    console.error('dmLoadInbox:', e);
    list.innerHTML = '<div class="dm-empty">Failed to load messages.</div>';
  }
}


async function dmOpenConvo(convoId, name, isGroup) {
  if (!currentUser) { openAuth('signin'); return; }
  closeOverlay('pubProfileOverlay');

  const alreadyOpen = dmState.activeConvoId === convoId;
  dmState.activeConvoId = convoId;
  dmState.activeConvoName = name;
  dmState.isGroup = isGroup;

  openDmPage();
  document.getElementById('dmInboxPane').style.display = 'none';
  document.getElementById('dmConvoPane').style.display = 'flex';
  document.getElementById('dmBackBtn').style.visibility = 'visible';
  document.getElementById('dmNewBtn').style.display = 'none';
  document.getElementById('dmTitle').textContent = name;
  document.getElementById('dmComposeBar').style.display = '';

  if (!alreadyOpen) {
    document.getElementById('dmMessages').innerHTML = '<div class="dm-loading">Loading…</div>';
    await dmLoadConvo();
    dmSubscribe();
  } else {
    // Already loaded — just scroll to bottom
    const el = document.getElementById('dmMessages');
    if (el) el.scrollTop = el.scrollHeight;
  }
}

async function dmLoadConvo() {
  const { data, error } = await db
    .from('messages')
    .select('id, sender_id, body, msg_type, venue_id, created_at')
    .eq('conversation_id', dmState.activeConvoId)
    .order('created_at', { ascending: true });

  if (error) { document.getElementById('dmMessages').innerHTML = '<div class="dm-empty">Failed to load.</div>'; return; }

  const msgs = data || [];

  // Fetch sender profiles
  const senderIds = [...new Set(msgs.map(m => m.sender_id).filter(Boolean))];
  const { data: profiles } = senderIds.length
    ? await db.from('profiles').select('id, display_name, avatar_emoji').in('id', senderIds)
    : { data: [] };
  const pMap = {};
  (profiles || []).forEach(p => { pMap[p.id] = p; });

  // Fetch venues for shares
  const venueIds = [...new Set(msgs.filter(m => m.venue_id).map(m => m.venue_id))];
  const { data: venues } = venueIds.length
    ? await db.from('venues').select('id, name, neighborhood, google_rating').in('id', venueIds)
    : { data: [] };
  const vMap = {};
  (venues || []).forEach(v => { vMap[v.id] = v; });

  const el = document.getElementById('dmMessages');
  if (!msgs.length) { el.innerHTML = '<div class="dm-empty">Say hi! 👋</div>'; return; }

  el.innerHTML = msgs.map(m => {
    const isMine = m.sender_id === currentUser.id;
    const senderName = isMine ? 'You' : (pMap[m.sender_id]?.display_name || 'User');

    if (m.msg_type === 'venue_share') {
      const v = vMap[m.venue_id] || {};
      return `<div class="dm-msg ${isMine ? 'dm-msg--mine' : 'dm-msg--theirs'}">
        ${dmState.isGroup && !isMine ? `<div class="dm-sender-name">${esc(senderName)}</div>` : ''}
        <div class="dm-venue-card" onclick="openModal('${m.venue_id}','venue')">
          <div class="dm-venue-icon">📍</div>
          <div class="dm-venue-info">
            <div class="dm-venue-name">${esc(v.name || 'Venue')}</div>
            <div class="dm-venue-meta">${esc(v.neighborhood || '')}${v.google_rating ? ` · ⭐ ${v.google_rating}` : ''}</div>
          </div>
          <div class="dm-venue-arrow">›</div>
        </div>
        <div class="dm-msg-time">${new Date(m.created_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</div>
      </div>`;
    }

    return `<div class="dm-msg ${isMine ? 'dm-msg--mine' : 'dm-msg--theirs'}">
      ${dmState.isGroup && !isMine ? `<div class="dm-sender-name">${esc(senderName)}</div>` : ''}
      <div class="dm-bubble">${esc(m.body || '')}</div>
      <div class="dm-msg-time">${new Date(m.created_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</div>
    </div>`;
  }).join('');

  el.scrollTop = el.scrollHeight;

  // Mark read
  await db.from('conversation_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', dmState.activeConvoId)
    .eq('user_id', currentUser.id);
}

async function dmSend() {
  const input = document.getElementById('dmInput');
  const body = input.value.trim();
  if (!body || !dmState.activeConvoId) return;
  input.value = '';

  // Optimistic append
  const el = document.getElementById('dmMessages');
  const tempDiv = document.createElement('div');
  tempDiv.className = 'dm-msg dm-msg--mine';
  tempDiv.innerHTML = `<div class="dm-bubble">${esc(body)}</div>
    <div class="dm-msg-time">${new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</div>`;
  el?.appendChild(tempDiv);
  el.scrollTop = el.scrollHeight;

  const { error } = await db.from('messages').insert({
    conversation_id: dmState.activeConvoId,
    sender_id: currentUser.id,
    body,
    msg_type: 'text',
  });
  if (error) {
    showToast('Failed to send');
    tempDiv.remove();
    input.value = body;
  }
}

async function dmSendVenue(venueId, convoId) {
  const { error } = await db.from('messages').insert({
    conversation_id: convoId,
    sender_id: currentUser.id,
    venue_id: venueId,
    msg_type: 'venue_share',
  });
  if (error) { showToast('Failed to share venue'); return; }
  showToast('Venue shared! 📍');
  closeOverlay('modalOverlay');
  document.getElementById('dmSharePickerOverlay')?.remove();
}

// ── New conversation ───────────────────────────────────
async function dmStartNewConvo() {
  if (!currentUser) { openAuth('signin'); return; }
  const { data: following } = await db
    .from('user_follows')
    .select('following_id')
    .eq('follower_id', currentUser.id);

  const followIds = (following || []).map(f => f.following_id);
  const { data: profiles } = followIds.length
    ? await db.from('profiles').select('id, display_name, avatar_emoji').in('id', followIds)
    : { data: [] };

  dmShowUserPicker(profiles || [], false);
}

function dmShowUserPicker(users, isGroup) {
  document.getElementById('dmInboxPane').style.display = 'none';
  document.getElementById('dmConvoPane').style.display = 'flex';
  document.getElementById('dmBackBtn').style.visibility = 'visible';
  document.getElementById('dmNewBtn').style.display = 'none';
  document.getElementById('dmTitle').textContent = isGroup ? 'New Group' : 'New Message';
  document.getElementById('dmComposeBar').style.display = 'none';

  window._dmPickerSelected = new Set();
  window._dmPickerUsers = users;
  window._dmPickerIsGroup = isGroup;

  document.getElementById('dmMessages').innerHTML = `
    <div class="dm-picker">
      <div class="dm-picker-search-wrap">
        <input class="dm-picker-search" placeholder="Search by name…" oninput="dmFilterPicker(this.value)">
      </div>
      ${isGroup
        ? `<div class="dm-group-name-wrap"><input class="dm-picker-search" id="dmGroupName" placeholder="Group name (optional)…"></div>`
        : `<div class="dm-picker-toggle" onclick="dmShowUserPicker(window._dmPickerUsers, true)">👥 Create Group Instead</div>`
      }
      <div id="dmPickerList" class="dm-picker-list">
        ${users.length
          ? users.map(u => `
            <div class="dm-picker-row" id="dpick-${u.id}" onclick="dmPickerToggle('${u.id}',${isGroup})">
              <div class="dm-thread-avatar" style="width:36px;height:36px;font-size:20px;">${u.avatar_emoji||'🍺'}</div>
              <div style="flex:1">${esc(u.display_name||'User')}</div>
              <div class="dm-pick-check" id="dcheck-${u.id}">○</div>
            </div>`).join('')
          : '<div class="dm-empty" style="padding:20px">Follow people to message them</div>'
        }
      </div>
      <button class="dm-send-btn" style="margin:12px 16px;width:calc(100% - 32px);padding:14px;border-radius:14px;"
        onclick="dmCreateConvo(${isGroup})">
        ${isGroup ? 'Create Group' : 'Start Chat'}
      </button>
    </div>`;
}

function dmFilterPicker(q) {
  document.querySelectorAll('.dm-picker-row').forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
  });
}

function dmPickerToggle(userId, isGroup) {
  const sel = window._dmPickerSelected;
  const check = document.getElementById(`dcheck-${userId}`);
  const row = document.getElementById(`dpick-${userId}`);
  if (sel.has(userId)) {
    sel.delete(userId);
    check.textContent = '○';
    row.classList.remove('dm-picker-row--selected');
  } else {
    if (!isGroup) {
      // DM: clear others first
      sel.forEach(id => {
        document.getElementById(`dcheck-${id}`).textContent = '○';
        document.getElementById(`dpick-${id}`).classList.remove('dm-picker-row--selected');
      });
      sel.clear();
    }
    sel.add(userId);
    check.textContent = '●';
    row.classList.add('dm-picker-row--selected');
  }
}

async function dmCreateConvo(isGroup) {
  const sel = window._dmPickerSelected;
  if (!sel?.size) { showToast('Select at least one person'); return; }

  const groupName = isGroup ? (document.getElementById('dmGroupName')?.value.trim() || null) : null;

  // For DMs check if conversation already exists
  if (!isGroup && sel.size === 1) {
    const otherId = [...sel][0];
    const { data: myParts } = await db.from('conversation_participants').select('conversation_id').eq('user_id', currentUser.id);
    if (myParts?.length) {
      const myIds = myParts.map(r => r.conversation_id);
      const { data: otherParts } = await db.from('conversation_participants').select('conversation_id').eq('user_id', otherId).in('conversation_id', myIds);
      if (otherParts?.length) {
        const sharedId = otherParts[0].conversation_id;
        const { data: convoCheck } = await db.from('conversations').select('is_group').eq('id', sharedId).single();
        if (convoCheck && !convoCheck.is_group) {
          const name = window._dmPickerUsers?.find(u => u.id === otherId)?.display_name || 'Chat';
          document.getElementById('dmComposeBar').style.display = '';
          await dmOpenConvo(sharedId, name, false);
          return;
        }
      }
    }
  }

  // Create conversation
  const { data: convo, error: cErr } = await db
    .from('conversations')
    .insert({ is_group: isGroup, name: groupName, created_by: currentUser.id })
    .select()
    .single();
  console.log('dmCreateConvo result:', { convo, cErr });
  if (cErr) { console.error('create convo:', cErr); showToast('Failed to create conversation'); return; }

  // Add participants
  const participantIds = [currentUser.id, ...[...sel]];
  const { error: pErr } = await db.from('conversation_participants')
    .insert(participantIds.map(uid => ({ conversation_id: convo.id, user_id: uid })));
  if (pErr) { console.error('add participants:', pErr); showToast('Failed to add participants'); return; }

  const others = window._dmPickerUsers?.filter(u => sel.has(u.id)) || [];
  const displayName = groupName || (isGroup
    ? others.map(u => (u.display_name||'User').split(' ')[0]).join(', ')
    : (others[0]?.display_name || 'Chat'));

  document.getElementById('dmComposeBar').style.display = '';
  await dmOpenConvo(convo.id, displayName, isGroup);
}

// ── Open DM from public profile ────────────────────────
async function dmOpenFromProfile(userId, displayName) {
  if (!currentUser) { openAuth('signin'); return; }
  closeOverlay('pubProfileOverlay');

  // Check for existing DM
  const { data: myParts } = await db.from('conversation_participants').select('conversation_id').eq('user_id', currentUser.id);
  if (myParts?.length) {
    const myIds = myParts.map(r => r.conversation_id);
    const { data: otherParts } = await db.from('conversation_participants').select('conversation_id').eq('user_id', userId).in('conversation_id', myIds);
    if (otherParts?.length) {
      for (const p of otherParts) {
        const { data: c } = await db.from('conversations').select('is_group').eq('id', p.conversation_id).single();
        if (c && !c.is_group) {
          openDmPage();
          await dmOpenConvo(p.conversation_id, displayName, false);
          return;
        }
      }
    }
  }

  // Create new DM
  const { data: convo, error } = await db.from('conversations')
    .insert({ is_group: false, created_by: currentUser.id })
    .select().single();
  if (error) { showToast('Failed to start conversation'); return; }

  await db.from('conversation_participants').insert([
    { conversation_id: convo.id, user_id: currentUser.id },
    { conversation_id: convo.id, user_id: userId },
  ]);

  openDmPage();
  await dmOpenConvo(convo.id, displayName, false);
}

// ── Venue share picker ─────────────────────────────────
async function dmOpenVenueSharePicker(venueId) {
  if (!currentUser) { openAuth('signin'); return; }

  const { data: myParts } = await db.from('conversation_participants').select('conversation_id').eq('user_id', currentUser.id);
  if (!myParts?.length) { showToast('No conversations yet — start one first'); return; }

  // Deduplicate conversation IDs
  const convoIds = [...new Set(myParts.map(r => r.conversation_id))];
  const { data: convos } = await db.from('conversations').select('id, is_group, name, updated_at').in('id', convoIds).order('updated_at', { ascending: false });
  const { data: allParts } = await db.rpc('get_conversation_participants', { convo_ids: convoIds });

  const otherIds = [...new Set((allParts||[]).map(p=>p.user_id).filter(id=>id!==currentUser.id))];
  const { data: profiles } = otherIds.length ? await db.from('profiles').select('id, display_name, avatar_emoji').in('id', otherIds) : { data: [] };
  const pMap = {};
  (profiles||[]).forEach(p => { pMap[p.id] = p; });

  const convoPartsMap = {};
  (allParts||[]).forEach(p => {
    if (!convoPartsMap[p.conversation_id]) convoPartsMap[p.conversation_id] = [];
    if (p.user_id !== currentUser.id) convoPartsMap[p.conversation_id].push(p.user_id);
  });

  // Deduplicate convos by id just in case
  const seenConvos = new Set();
  const uniqueConvos = (convos||[]).filter(c => {
    if (seenConvos.has(c.id)) return false;
    seenConvos.add(c.id); return true;
  });

  document.getElementById('dmSharePickerOverlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'dmSharePickerOverlay';
  overlay.className = 'overlay open';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `<div class="sheet" style="max-height:60vh;overflow-y:auto;">
    <div style="font-weight:800;font-size:17px;margin-bottom:16px;padding-right:32px;">Send to…</div>
    <button class="sheet-close" onclick="document.getElementById('dmSharePickerOverlay').remove()">✕</button>
    ${uniqueConvos.map(c => {
      const others = convoPartsMap[c.id] || [];
      const name = c.is_group ? (c.name || others.map(id=>(pMap[id]?.display_name||'User').split(' ')[0]).join(', ')) : (pMap[others[0]]?.display_name || 'Spotd User');
      const avatar = c.is_group ? '👥' : (pMap[others[0]]?.avatar_emoji || '🍺');
      return `<div class="dm-thread-row" style="border-bottom:1px solid var(--bg2);" onclick="dmSendVenue('${venueId}','${c.id}');document.getElementById('dmSharePickerOverlay').remove()">
        <div class="dm-thread-main">
          <div class="dm-thread-avatar">${avatar}</div>
          <div class="dm-thread-info"><div class="dm-thread-name">${esc(name)}</div></div>
        </div>
        <div style="color:var(--coral);font-weight:700;font-size:13px;flex-shrink:0;">Send</div>
      </div>`;
    }).join('')}
  </div>`;
  document.body.appendChild(overlay);
}

// ── Back to inbox ──────────────────────────────────────
function dmShowInbox() {
  if (dmState.subscription) { dmState.subscription.unsubscribe(); dmState.subscription = null; }
  dmState.activeConvoId = null;
  dmState.activeConvoName = null;
  dmShowInboxPane();
  dmLoadInbox();
}

// ── Delete conversation ────────────────────────────────
async function dmDeleteConvo(convoId) {
  if (!confirm('Delete this conversation?')) return;
  // Remove self from participants (soft delete — others keep the convo)
  const { error } = await db
    .from('conversation_participants')
    .delete()
    .eq('conversation_id', convoId)
    .eq('user_id', currentUser.id);
  if (error) { showToast('Failed to delete'); return; }
  // Remove from UI immediately
  document.getElementById(`dmrow-${convoId}`)?.remove();
  const list = document.getElementById('dmThreadList');
  if (!list?.children.length) {
    list.innerHTML = '<div class="dm-empty">No messages yet.<br>Tap + to start a conversation.</div>';
  }
  showToast('Conversation removed');
}


function dmSubscribe() {
  if (dmState.subscription) dmState.subscription.unsubscribe();
  dmState.subscription = db.channel('dm-' + dmState.activeConvoId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages',
      filter: `conversation_id=eq.${dmState.activeConvoId}` }, payload => {
        const m = payload.new;
        // Don't re-render if it's our own message (already shown optimistically or via dmSend)
        if (m.sender_id === currentUser.id) return;
        dmAppendMessage(m);
      })
    .subscribe();
}

async function dmAppendMessage(m) {
  const el = document.getElementById('dmMessages');
  if (!el) return;

  // Fetch venue if needed
  let venue = null;
  if (m.venue_id) {
    const { data } = await db.from('venues').select('id, name, neighborhood, google_rating').eq('id', m.venue_id).single();
    venue = data;
  }

  // Fetch sender name for groups
  let senderName = 'User';
  if (dmState.isGroup) {
    const { data } = await db.from('profiles').select('display_name').eq('id', m.sender_id).single();
    senderName = data?.display_name || 'User';
  }

  const div = document.createElement('div');
  div.className = 'dm-msg dm-msg--theirs';
  if (m.msg_type === 'venue_share') {
    div.innerHTML = `
      ${dmState.isGroup ? `<div class="dm-sender-name">${esc(senderName)}</div>` : ''}
      <div class="dm-venue-card" onclick="openModal('${m.venue_id}','venue')">
        <div class="dm-venue-icon">📍</div>
        <div class="dm-venue-info">
          <div class="dm-venue-name">${esc(venue?.name || 'Venue')}</div>
          <div class="dm-venue-meta">${esc(venue?.neighborhood || '')}${venue?.google_rating ? ` · ⭐ ${venue.google_rating}` : ''}</div>
        </div>
        <div class="dm-venue-arrow">›</div>
      </div>
      <div class="dm-msg-time">${new Date(m.created_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</div>`;
  } else {
    div.innerHTML = `
      ${dmState.isGroup ? `<div class="dm-sender-name">${esc(senderName)}</div>` : ''}
      <div class="dm-bubble">${esc(m.body || '')}</div>
      <div class="dm-msg-time">${new Date(m.created_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</div>`;
  }
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;

  // Mark read
  await db.from('conversation_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', dmState.activeConvoId)
    .eq('user_id', currentUser.id);
}

// ── Badge refresh (silent, background) ────────────────
async function dmRefreshBadge() {
  if (!currentUser) return;
  try {
    const { data: myParts } = await db
      .from('conversation_participants')
      .select('conversation_id, last_read_at')
      .eq('user_id', currentUser.id);
    if (!myParts?.length) { dmUpdateBadge(0); return; }

    const convoIds = myParts.map(r => r.conversation_id);
    const myReadMap = {};
    myParts.forEach(r => { myReadMap[r.conversation_id] = r.last_read_at; });

    const { data: msgs } = await db
      .from('messages')
      .select('conversation_id, sender_id, created_at')
      .in('conversation_id', convoIds)
      .neq('sender_id', currentUser.id);

    let unread = 0;
    (msgs || []).forEach(m => {
      const myRead = myReadMap[m.conversation_id];
      if (!myRead || new Date(m.created_at) > new Date(myRead)) unread++;
    });
    dmUpdateBadge(unread);
  } catch(e) {}
}

// Poll for new messages every 60s
setInterval(() => { if (currentUser) dmRefreshBadge(); }, 60000);

function dmUpdateBadge(count) {
  const badge = document.getElementById('bnMsgBadge');
  if (!badge) return;
  if (count > 0) { badge.textContent = count > 9 ? '9+' : count; badge.style.display = ''; }
  else badge.style.display = 'none';
}

// ── iOS keyboard handling ──────────────────────────────
function dmScrollToBottom() {
  const el = document.getElementById('dmMessages');
  if (el) setTimeout(() => { el.scrollTop = el.scrollHeight; }, 50);
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    const page = document.getElementById('dmPage');
    if (!page?.classList.contains('dm-page--open')) return;
    // Shrink dm-page to the visual viewport so it sits above the keyboard
    const vv = window.visualViewport;
    page.style.height = vv.height + 'px';
    page.style.top = vv.offsetTop + 'px';
    dmScrollToBottom();
  });
  window.visualViewport.addEventListener('scroll', () => {
    const page = document.getElementById('dmPage');
    if (!page?.classList.contains('dm-page--open')) return;
    page.style.top = window.visualViewport.offsetTop + 'px';
  });
}
