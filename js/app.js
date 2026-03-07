/* ═══════════════════════════════════════════════════════
   APP.JS — Spotd UI Logic
   Home · City View · Happy Hours · Events · Map · Auth
   ═══════════════════════════════════════════════════════ */

const DAYS    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const TODAY   = DAYS[new Date().getDay()];
const EVENT_TYPES = ['Trivia','Live Music','Karaoke','Bingo','Game Night','Comedy'];
const HH_TYPES    = ['Bar','Brewery','Seafood','Mexican','Italian','Asian','BBQ','Wine Bar','Steakhouse','Beach Bar','Sports TV'];

const state = {
  view: 'list', tab: 'happyhour',
  filtersOpen: false, favFilterOn: false,
  filters: { day: null, area: null, type: null, search: '' },
  city: null,
  venues: [], events: [], filtered: [],
  activeItemId: null, activeItemType: 'venue',
  reviewCache: {}, reviewCacheTime: {},
  map: null, markers: {},
  goingCounts: {},
  goingByMe: new Set()
};

const CACHE_MS = 60000;

document.addEventListener('DOMContentLoaded', () => {
  renderCityGrid();
});

function onAuthChange(user) {
  renderNav(user);
  document.getElementById('favFilterGroup').style.display = user ? '' : 'none';
  if (!user && state.favFilterOn) { state.favFilterOn = false; applyFilters(); }
  if (state.city) renderCards();
}

// ── NAV ────────────────────────────────────────────────
function renderNav(user) {
  const r = document.getElementById('navRight');
  r.innerHTML = user
    ? `<button class="nav-btn" onclick="openFavView()">★ Saved</button>
       <button class="nav-btn nav-profile" onclick="openProfile()">${(user.user_metadata?.full_name || user.email).split(' ')[0]} ↗</button>
       <button class="nav-btn nav-signout" onclick="doSignOut()">Sign out</button>`
    : `<button class="nav-btn nav-login" onclick="openAuth('signin')">Sign In / Join</button>`;
}
async function doSignOut() { await authSignOut(); showToast('Signed out'); }

// ── HOME ───────────────────────────────────────────────
async function renderCityGrid() {
  const grid = document.getElementById('cityGrid');
  grid.innerHTML = `<div class="loading-state"><span class="loading-dot"></span><span class="loading-dot"></span><span class="loading-dot"></span></div>`;

  const cities = await fetchCities();

  // Fallback city list if DB is empty
  const fallback = [
    { slug:'san-diego',    name:'San Diego',     state_code:'CA', venue_count:85, active:true  },
    { slug:'los-angeles',  name:'Los Angeles',   state_code:'CA', venue_count:0,  active:false },
    { slug:'new-york',     name:'New York',      state_code:'NY', venue_count:0,  active:false },
    { slug:'chicago',      name:'Chicago',       state_code:'IL', venue_count:0,  active:false },
    { slug:'austin',       name:'Austin',        state_code:'TX', venue_count:0,  active:false },
    { slug:'miami',        name:'Miami',         state_code:'FL', venue_count:0,  active:false },
    { slug:'orange-county',name:'Orange County', state_code:'CA', venue_count:0,  active:false },
  ];

  const list = cities.length ? cities : fallback;
  grid.innerHTML = list.map(c => `
    <div class="city-card${c.active ? '' : ' coming'}" onclick="${c.active ? `enterCity('${c.slug}','${c.name}','${c.state_code}')` : ''}">
      <div class="city-card-name">${c.name}</div>
      <div class="city-card-state">${c.state_code}</div>
      ${c.active && c.venue_count ? `<div class="city-card-count">${c.venue_count}+ spots</div>` : ''}
    </div>`).join('');
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
}

async function enterCity(slug, name, stateCode) {
  state.city = { slug, name, stateCode };
  document.getElementById('homePage').style.display = 'none';
  document.getElementById('appPage').style.display  = 'block';
  document.getElementById('cityBarName').textContent = `${name}, ${stateCode}`;
  document.title = `Spotd — ${name} Happy Hours & Events`;

  // Reset
  state.tab = 'happyhour';
  state.filters = { day: null, area: null, type: null, search: '' };
  state.favFilterOn = false;
  state.filtered = [];
  document.getElementById('searchBox').value = '';
  document.getElementById('tabHH').classList.add('active');
  document.getElementById('tabEV').classList.remove('active');
  document.getElementById('filterPanel').classList.remove('open');
  document.getElementById('filterDot').classList.remove('show');
  document.getElementById('filterToggle').classList.remove('active');
  document.getElementById('chipsRow').innerHTML = '';

  // Show loading
  document.getElementById('cardsGrid').innerHTML = `<div class="loading-state"><span class="loading-dot"></span><span class="loading-dot"></span><span class="loading-dot"></span></div>`;

  // Load data
  const [venues, events] = await Promise.all([fetchVenues(slug), fetchEvents(slug)]);
  state.venues = venues;
  state.events = events;

  // Load going tonight counts
  loadGoingTonight(slug);

  // Build filter pills
  buildFilterPills();
  applyFilters();
  initMap();
}

// ── TABS ───────────────────────────────────────────────
function setTab(tab) {
  state.tab = tab;
  document.getElementById('tabHH').classList.toggle('active', tab === 'happyhour');
  document.getElementById('tabEV').classList.toggle('active', tab === 'events');
  // Reset type filter when switching tabs
  state.filters.type = null;
  buildTypeFilters();
  applyFilters(); updateChips(); updateDot();
}

// ── FILTERS ────────────────────────────────────────────
function buildFilterPills() {
  // Days
  const df = document.getElementById('dayFilters');
  df.innerHTML = '';
  DAYS.forEach(d => { const b = mkPill(d + (d === TODAY ? ' ★' : ''), () => setFilter('day', d, b)); df.appendChild(b); });

  // Neighborhoods
  const items = state.tab === 'happyhour' ? state.venues : state.events;
  const areas = [...new Set(items.map(v => v.neighborhood).filter(Boolean))].sort();
  const af = document.getElementById('areaFilters');
  af.innerHTML = '';
  areas.forEach(a => { const b = mkPill(a, () => setFilter('area', a, b)); af.appendChild(b); });

  buildTypeFilters();
}

function buildTypeFilters() {
  const tf = document.getElementById('typeFilters');
  tf.innerHTML = '';
  const types = state.tab === 'happyhour' ? HH_TYPES : EVENT_TYPES;
  types.forEach(t => { const b = mkPill(t, () => setFilter('type', t, b)); tf.appendChild(b); });
  // Show/hide day filter for events (events have specific days too)
  document.getElementById('fgDay').style.display = '';
}

function mkPill(label, onclick) {
  const b = document.createElement('button'); b.className = 'pill'; b.textContent = label; b.onclick = onclick; return b;
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
  const items = state.tab === 'happyhour' ? state.venues : state.events;
  state.filtered = items.filter(v => {
    const { day, area, type } = state.filters;
    if (day  && !(v.days || []).includes(day)) return false;
    if (area && v.neighborhood !== area)       return false;
    if (type) {
      if (type === 'Sports TV') {
        if (!v.has_sports_tv) return false;
      } else {
        const t = type.toLowerCase();
        const haystack = [v.name, v.neighborhood, v.cuisine, v.event_type, ...(v.deals || [])].join(' ').toLowerCase();
        if (!haystack.includes(t)) return false;
      }
    }
    if (search) {
      const h = [v.name, v.neighborhood, v.cuisine, v.address, v.event_type, ...(v.deals || [])].join(' ').toLowerCase();
      if (!h.includes(search)) return false;
    }
    if (state.favFilterOn && !isFavorite(v.id)) return false;
    return true;
  });
  renderCards();
  if (state.view === 'map') updateMapMarkers();
  const rc = document.getElementById('resultsCount');
  if (rc) rc.textContent = `${state.filtered.length} of ${items.length} ${state.tab === 'happyhour' ? 'venues' : 'events'}`;
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
    grid.innerHTML = `<div class="no-results">No ${state.tab === 'happyhour' ? 'venues' : 'events'} match — try different filters</div>`;
    return;
  }
  grid.innerHTML = state.tab === 'happyhour'
    ? state.filtered.map(v => venueCardHTML(v)).join('')
    : state.filtered.map(v => eventCardHTML(v)).join('');
}

function venueCardHTML(v) {
  const isToday = (v.days || []).includes(TODAY);
  const cached  = state.reviewCache[v.id] || [];
  const avg     = avgFromList(cached);
  const faved   = isFavorite(v.id);
  return `<div class="card" data-id="${v.id}" onclick="openModal('${v.id}','venue')" role="button" tabindex="0">
    <div class="card-top">
      <div class="card-name">${esc(v.name)}</div>
      <div class="card-right">
        <button class="heart-btn${faved ? ' faved' : ''}" onclick="event.stopPropagation();doFavorite('${v.id}','venue',this)">${faved ? '★' : '☆'}</button>
        <div class="card-badge ${isToday ? 'today' : 'dim'}">${isToday ? 'Today' : 'Open'}</div>
      </div>
    </div>
    <div class="card-meta">
      <span>${esc(v.neighborhood || '')}</span>
      ${v.neighborhood ? '<span class="card-sep">·</span>' : ''}
      <span class="card-when">${esc(v.hours || '')}</span>
    </div>
    ${v.has_sports_tv ? `<span class="sports-badge">📺 Sports TV</span>` : ''}
    <ul class="deals">${(v.deals || []).slice(0, 3).map(d => `<li>${esc(d)}</li>`).join('')}${(v.deals || []).length > 3 ? `<li class="deals-more">+${v.deals.length - 3} more</li>` : ''}</ul>
    ${goingFireBadge(v.id)}
    <div class="card-foot">
      <span class="card-cuisine">${esc(v.cuisine || '')}</span>
      <div class="card-stars">${starHTML(avg, 5, 11)}<span class="card-rcount">${cached.length ? `(${cached.length})` : '—'}</span></div>
    </div>
    <div class="card-going">
      <button class="going-btn${state.goingByMe.has(v.id) ? ' going-active' : ''}" onclick="event.stopPropagation();doGoingTonight('${v.id}',this)">${goingBtnLabel(state.goingCounts[v.id]||0, state.goingByMe.has(v.id))}</button>
    </div>
    ${!v.owner_verified ? `<div class="card-claim"><a href="business-portal.html" onclick="event.stopPropagation()" class="claim-link">Own this spot? Claim it →</a></div>` : ''}
  </div>`;
}

function eventCardHTML(v) {
  const isToday = (v.days || []).includes(TODAY);
  const faved   = isFavorite(v.id);
  return `<div class="card" onclick="openModal('${v.id}','event')" role="button" tabindex="0">
    <div class="card-top">
      <div class="card-name">${esc(v.name)}</div>
      <div class="card-right">
        <button class="heart-btn${faved ? ' faved' : ''}" onclick="event.stopPropagation();doFavorite('${v.id}','event',this)">${faved ? '★' : '☆'}</button>
        <div class="card-badge event-badge">${esc(v.event_type || 'Event')}</div>
      </div>
    </div>
    <div class="card-meta">
      <span>${esc(v.neighborhood || '')}</span>
      ${v.neighborhood ? '<span class="card-sep">·</span>' : ''}
      <span class="card-when">${esc(v.hours || '')}</span>
      ${isToday ? '<span class="card-sep">·</span><span style="color:var(--teal);font-size:11px">Tonight</span>' : ''}
    </div>
    ${v.description ? `<ul class="deals"><li>${esc(v.description)}</li></ul>` : ''}
    <div class="card-foot">
      <span class="card-cuisine">${esc(v.venue_name || '')}</span>
      <span class="card-event-type">${esc(v.event_type || '')}</span>
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
    <div class="s-tag ${isVenue ? 'hh' : 'ev'}">${isVenue ? 'Happy Hour' : esc(v.event_type || 'Event')}</div>
    <div style="display:flex;align-items:flex-start;gap:10px;padding-right:38px">
      <div style="flex:1">
        <div class="s-name">${esc(v.name)}</div>
        <div class="s-hood">${esc(v.neighborhood || '')}</div>
        <div class="s-addr">📍 ${esc(v.address || '')}</div>
      ${isVenue && v.has_sports_tv ? `<span class="sports-badge sports-badge--modal">📺 Sports TV</span>` : ''}
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
    ` : `
      <div class="s-div"></div>
      <div class="s-label">About</div>
      <p style="font-size:14px;color:rgba(232,236,244,.75);line-height:1.6">${esc(v.description || '')}</p>
      ${v.venue_name ? `<div class="s-cuisine" style="margin-top:8px">At ${esc(v.venue_name)}</div>` : ''}
      ${v.price ? `<div class="s-cuisine">Entry: ${esc(v.price)}</div>` : ''}
    `}
    <div class="s-div"></div>
    <div class="s-actions">
      ${v.url ? `<a class="btn-primary" href="${v.url}" target="_blank" rel="noopener">Website ↗</a>` : `<button class="btn-primary" disabled style="opacity:.3;cursor:default">No Website</button>`}
      <button class="btn-sec" onclick="goToMap('${v.id}')">Map</button>
      <button class="btn-sec" onclick="shareItem('${v.id}','${type}')">Share</button>
    </div>
    ${isVenue ? `
    <div class="s-going-wrap">
      <button class="going-btn going-btn--lg${state.goingByMe.has(v.id) ? ' going-active' : ''}" id="modal-going-btn" onclick="doGoingTonight('${v.id}', this)">${goingBtnLabel(state.goingCounts[v.id]||0, state.goingByMe.has(v.id))}</button>
      ${(state.goingCounts[v.id]||0) >= 2 ? `<div class="s-going-count">🔥 ${state.goingCounts[v.id]} people are going tonight</div>` : ''}
    </div>` : ''}
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
    return `<div class="review-item">
      <div class="review-head">
        <span class="review-author">${esc(name)}${isOwn ? ' <span class="review-you">(you)</span>' : ''}</span>
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
    ${si ? `<button class="auth-forgot" onclick="doForgot()">Forgot password?</button>` : ''}
    <button class="btn-submit" id="authBtn" onclick="doAuth('${mode}')" style="width:100%;margin-top:4px">${si ? 'Sign In' : 'Create Account'}</button>
    <p class="auth-switch">${si ? "No account?" : 'Have an account?'} <button class="auth-switch-btn" onclick="renderAuth('${si ? 'signup' : 'signin'}')">${si ? 'Sign up free' : 'Sign in'}</button></p>`;
  setTimeout(() => {
    ['aEmail','aPass','aName'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(mode); });
    });
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
  const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  if (error) { showToast('❌ ' + error.message); return; }
  showToast('Reset link sent!'); closeOverlay('authOverlay');
}

// ── PROFILE ────────────────────────────────────────────
async function openProfile() { if (!currentUser) { openAuth('signin'); return; } await renderProfile(currentUser); openOverlay('profileOverlay'); }
function closeProfile(e) { if (e && e.target !== document.getElementById('profileOverlay')) return; closeOverlay('profileOverlay'); }
async function renderProfile(user) {
  const areas = [...new Set([...state.venues, ...state.events].map(v => v.neighborhood).filter(Boolean))].sort();
  const [profile, myReviews, favItems, followed] = await Promise.all([
    getProfile(user.id), fetchMyReviews(user.id), getFavoriteItems(user.id), getFollowedNeighborhoods(user.id)
  ]);
  const allItems = [...state.venues, ...state.events];
  const favIds   = new Set(favItems.map(f => String(f.item_id)));
  const favSpots = allItems.filter(v => favIds.has(String(v.id)));
  document.getElementById('profileContent').innerHTML = `
    <div class="s-name" style="font-size:20px">My Account</div>
    <div class="profile-email">${user.email}</div>
    <div class="p-section">
      <div class="p-section-title">Display Name</div>
      <div style="display:flex;gap:8px">
        <input class="field" id="pName" type="text" value="${esc(profile?.display_name || user.user_metadata?.full_name || '')}" placeholder="Your name" style="flex:1">
        <button class="btn-save-sm" onclick="saveName()">Save</button>
      </div>
    </div>
    <div class="p-section">
      <div class="p-section-title">Weekly Digest Email</div>
      <label class="toggle-row">
        <input type="checkbox" id="digestCb" ${profile?.digest_enabled ? 'checked' : ''} onchange="saveDigest(this.checked)">
        <span class="t-track"><span class="t-thumb"></span></span>
        <span class="t-text">Email me new happy hours & events weekly</span>
      </label>
    </div>
    ${areas.length ? `<div class="p-section">
      <div class="p-section-title">Followed Neighborhoods</div>
      <div class="hood-grid">${areas.map(a => `<button class="hood-pill${followed.includes(a) ? ' on' : ''}" onclick="toggleHood('${a}',this)">${a}</button>`).join('')}</div>
    </div>` : ''}
    <div class="p-section">
      <div class="p-section-title">Saved Spots (${favSpots.length})</div>
      ${favSpots.length ? `<div class="fav-list">${favSpots.map(v => `<div class="fav-item" onclick="closeOverlay('profileOverlay');openModal('${v.id}','${v.event_type ? 'event' : 'venue'}')"><div class="fav-name">${esc(v.name)}</div><div class="fav-meta">${esc(v.neighborhood || '')} · ${esc(v.hours || '')}</div></div>`).join('')}</div>` : '<div class="no-reviews">Nothing saved yet</div>'}
    </div>
    <div class="p-section">
      <div class="p-section-title">My Reviews (${myReviews.length})</div>
      ${myReviews.length ? `<div class="reviews-list">${myReviews.map(r => {
        const item = allItems.find(x => String(x.id) === String(r.venue_id || r.event_id));
        const itype = r.venue_id ? 'venue' : 'event';
        return `<div class="review-item">
          <span class="review-venue-link" onclick="closeOverlay('profileOverlay');openModal('${r.venue_id || r.event_id}','${itype}')">${item ? esc(item.name) : 'Unknown Spot'}</span>
          <div class="review-head"><span class="review-stars">${starHTML(r.rating,5,11)}</span><span class="review-date">${fmtDate(r.created_at)}</span></div>
          ${r.text ? `<div class="review-text">${esc(r.text)}</div>` : ''}
          <div class="review-acts">
            <button class="review-act" onclick="openEditReview('${r.id}','${r.venue_id||r.event_id}','${itype}',${r.rating},\`${esc(r.text||'')}\`)">Edit</button>
            <button class="review-act del" onclick="doDeleteReview('${r.id}','${r.venue_id||r.event_id}','${itype}')">Delete</button>
          </div>
        </div>`;
      }).join('')}</div>` : '<div class="no-reviews">No reviews yet</div>'}
    </div>`;
}
async function saveName() { const n = document.getElementById('pName').value.trim(); if (!n) return; await updateProfile(currentUser.id, { display_name: n }); showToast('Name saved'); }
async function saveDigest(v) { await setDigestPreference(currentUser.id, v); showToast(v ? 'Digest enabled' : 'Digest off'); }
async function toggleHood(hood, btn) { if (!currentUser) return; const added = await toggleNeighborhoodFollow(currentUser.id, hood); btn.classList.toggle('on', added); showToast(added ? `Following ${hood}` : `Unfollowed ${hood}`); }

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
function openOverlay(id)  { document.getElementById(id).classList.add('open');    document.body.style.overflow = 'hidden'; }
function closeOverlay(id) { document.getElementById(id).classList.remove('open'); document.body.style.overflow = ''; }

// ── UTILS ──────────────────────────────────────────────
function avgFromList(r)    { return r.length ? r.reduce((s,x) => s+x.rating, 0)/r.length : 0; }
function starHTML(rating, max=5, size=13) { return Array.from({length:max},(_,i)=>`<span style="font-size:${size}px;color:${i<Math.round(rating)?'#E8943A':'rgba(42,31,20,0.15)'}">★</span>`).join(''); }
function fmtDate(iso)      { return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function showToast(msg)    { document.querySelectorAll('.toast').forEach(t=>t.remove()); const t=document.createElement('div'); t.className='toast'; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),2600); }
function esc(s)            { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// ── GOING TONIGHT ──────────────────────────────────────
async function loadGoingTonight(citySlug) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    // Get all counts for this city today
    const counts = await fetchGoingCounts(citySlug, today);
    state.goingCounts = {};
    (counts || []).forEach(r => { state.goingCounts[r.venue_id] = r.count; });

    // Get current user's going entries
    state.goingByMe = new Set();
    if (currentUser) {
      const mine = await fetchMyGoingTonight(currentUser.id, today);
      (mine || []).forEach(r => state.goingByMe.add(r.venue_id));
    }
  } catch(e) { console.warn('Going tonight load failed', e); }
}

async function doGoingTonight(venueId, btn) {
  if (!currentUser) { openAuth('signin'); showToast('Sign in to mark Going Tonight'); return; }
  const going = state.goingByMe.has(venueId);
  const today = new Date().toISOString().slice(0, 10);

  if (going) {
    await removeGoingTonight(currentUser.id, venueId, today);
    state.goingByMe.delete(venueId);
    state.goingCounts[venueId] = Math.max(0, (state.goingCounts[venueId] || 1) - 1);
    showToast('Removed from Going Tonight');
  } else {
    await addGoingTonight({ userId: currentUser.id, venueId, citySlug: state.city.slug, date: today });
    state.goingByMe.add(venueId);
    state.goingCounts[venueId] = (state.goingCounts[venueId] || 0) + 1;
    showToast('🔥 Marked as Going Tonight!');
  }

  // Refresh button and card badge if visible
  const count = state.goingCounts[venueId] || 0;
  const isGoing = state.goingByMe.has(venueId);
  if (btn) {
    btn.classList.toggle('going-active', isGoing);
    btn.innerHTML = goingBtnLabel(count, isGoing);
  }
  // Update fire badge on card
  const badge = document.querySelector(`.card[data-id="${venueId}"] .fire-badge`);
  if (badge) {
    if (count >= 2) { badge.textContent = `🔥 ${count} going tonight`; badge.style.display = 'inline-flex'; }
    else badge.style.display = 'none';
  }
}

function goingBtnLabel(count, isGoing) {
  if (isGoing) return count > 1 ? `🔥 You + ${count - 1} going` : '🔥 You\'re going!';
  return count > 0 ? `🔥 ${count} going — join?` : 'Going Tonight?';
}

function goingFireBadge(venueId) {
  const count = state.goingCounts[venueId] || 0;
  if (count < 2) return '';
  return `<span class="fire-badge">🔥 ${count} going tonight</span>`;
}
