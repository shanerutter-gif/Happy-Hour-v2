/* ═══════════════════════════════════════════════════════
   APP.JS — Spotd UI Logic
   Home · City View · Happy Hours · Events · Map · Auth
   ═══════════════════════════════════════════════════════ */

const DAYS    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const TODAY   = DAYS[new Date().getDay()];

// Parse just today's hours from the full hours string
// Handles both "Mon–Thu 5–9pm" and "11am – 10pm Mon–Thu" formats
// Separators: ", " or " · "
function getTodayHours(v) {
  if (!v.hours) return '';
  const dayOrder = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const todayIdx = dayOrder.indexOf(TODAY);
  if (todayIdx === -1) return v.hours;

  // Split by " · " or ", "
  const segments = v.hours.split(/\s·\s|,\s*/);

  for (const seg of segments) {
    const trimmed = seg.trim();
    let startDay, endDay, time;

    // Try "Days Time" format: "Mon–Thu 5–9pm"
    const m1 = trimmed.match(/^([A-Z][a-z]+)(?:–([A-Z][a-z]+))?\s+(.+)$/);
    // Try "Time Days" format: "11am – 10pm Mon–Thu"
    const m2 = trimmed.match(/^(.+?)\s+([A-Z][a-z]+)(?:–([A-Z][a-z]+))?$/);

    if (m1) {
      startDay = m1[1]; endDay = m1[2]; time = m1[3];
    } else if (m2) {
      time = m2[1]; startDay = m2[2]; endDay = m2[3];
    } else {
      continue;
    }

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
  { key: 'has_happy_hour',  label: 'Happy Hour',  icon: 'beer', eventType: null, emoji: '🍺' },
  { key: 'has_sports_tv',   label: 'Sports TV',   icon: 'tv', eventType: null, emoji: '📺' },
  { key: 'is_dog_friendly', label: 'Dog Friendly', icon: 'dog', eventType: null, emoji: '🐕' },
  { key: 'has_live_music',  label: 'Live Music',   icon: 'music', eventType: 'Live Music', emoji: '🎵' },
  { key: 'has_karaoke',     label: 'Karaoke',      icon: 'mic', eventType: 'Karaoke', emoji: '🎤' },
  { key: 'has_trivia',      label: 'Trivia',       icon: 'brain', eventType: 'Trivia', emoji: '🧠' },
  { key: 'has_bingo',       label: 'Bingo',        icon: 'target', eventType: 'Bingo', emoji: '🎯' },
  { key: 'has_comedy',      label: 'Comedy',       icon: 'masks', eventType: 'Comedy', emoji: '😂' },
];

// Smart suggestions — fun prefixed queries that combine amenity filters + search
const SUGGESTIONS = [
  { id: 'pup',     emoji: '🐕', label: 'Drinks with the pup?', amenities: ['is_dog_friendly','has_happy_hour'], search: '' },
  { id: 'game',    emoji: '🏈', label: 'Catch the game',        amenities: ['has_sports_tv'], search: '' },
  { id: 'sing',    emoji: '🎤', label: 'Sing your heart out',   amenities: ['has_karaoke'], search: '' },
  { id: 'live',    emoji: '🎵', label: 'Live vibes tonight',    amenities: ['has_live_music'], search: '' },
  { id: 'trivia',  emoji: '🧠', label: 'Test your brain',       amenities: ['has_trivia'], search: '' },
  { id: 'comedy',  emoji: '😂', label: 'Make me laugh',         amenities: ['has_comedy'], search: '' },
  { id: 'cheap',   emoji: '💰', label: '$5 deals & under',      amenities: ['has_happy_hour'], search: '$5' },
  { id: 'rooftop', emoji: '🌅', label: 'Rooftop sunset vibes',  amenities: [], search: 'rooftop' },
];
let _activeSuggestion = null;
// Map event_type string → amenity config
const EVENT_TYPE_AMENITY = {};
AMENITIES.forEach(a => { if (a.eventType) EVENT_TYPE_AMENITY[a.eventType] = a; });

const state = {
  sort: 'name',
  userLat: null,
  userLng: null,
  view: 'list',
  showFilter: 'all', // 'all' | 'happyhour' | 'events'
  filtersOpen: false, favFilterOn: false,
  filters: { day: null, area: null, type: null, amenities: [], search: '' },
  city: null,
  venues: [], events: [], filtered: [],
  activeItemId: null, activeItemType: 'venue',
  reviewCache: {}, reviewCacheTime: {},
  map: null, markers: {},
  goingCounts: {},
  goingByMe: new Set(),
  todayCheckInCount: 0,  // tracked locally; enforces 5/day cap
  descCache: {},         // top "Locals Say" per venue
};

const CACHE_MS = 60000;

async function loadSiteCopy() {
  try {
    const { data } = await db.from('site_copy').select('key,value').eq('page','home');
    if (!data?.length) return;
    const map = Object.fromEntries(data.map(r => [r.key, r.value]));
    if (map.hero_title)    document.getElementById('copy-home-title').innerHTML    = map.hero_title;
    if (map.hero_subtitle) document.getElementById('copy-home-subtitle').textContent = map.hero_subtitle;
    if (map.hero_eyebrow)  document.getElementById('copy-home-eyebrow').textContent = map.hero_eyebrow;
    if (map.meta_desc) {
      const m = document.querySelector('meta[name="description"]');
      if (m) m.setAttribute('content', map.meta_desc);
    }
  } catch(e) {}
}

const CITIES = [
  { slug:'san-diego',    name:'San Diego',     state_code:'CA', venue_count:400, active:true  },
  { slug:'los-angeles',  name:'Los Angeles',   state_code:'CA', venue_count:0,  active:false },
  { slug:'new-york',     name:'New York',      state_code:'NY', venue_count:0,  active:false },
  { slug:'chicago',      name:'Chicago',       state_code:'IL', venue_count:0,  active:false },
  { slug:'austin',       name:'Austin',        state_code:'TX', venue_count:0,  active:false },
  { slug:'miami',        name:'Miami',         state_code:'FL', venue_count:0,  active:false },
  { slug:'orange-county',name:'Orange County', state_code:'CA', venue_count:0,  active:false },
];

document.addEventListener('DOMContentLoaded', () => {
  // Global iOS tap fix — iOS WKWebView has unreliable click event delivery.
  // This handler synthesizes immediate clicks via touchend for ALL tappable elements.
  let _tapX = 0, _tapY = 0;
  document.addEventListener('touchstart', function(e) {
    const t = e.touches[0];
    _tapX = t.clientX;
    _tapY = t.clientY;
  }, { passive: true });
  document.addEventListener('touchend', function(e) {
    const t = e.changedTouches[0];
    if (Math.abs(t.clientX - _tapX) > 10 || Math.abs(t.clientY - _tapY) > 10) return;

    // Card tap — open modal directly (cards use onclick on the container, not buttons)
    const card = e.target.closest('.card-hero, .card-compact, .card-std, .card');
    if (card && card.dataset.id && !e.target.closest('button')) {
      e.preventDefault();
      const type = (card.classList.contains('card') && !card.classList.contains('card-std')) ? 'event' : 'venue';
      openModal(card.dataset.id, type);
      return;
    }

    // Form fields: explicitly focus on iOS (native focus is unreliable in WKWebView overlays)
    const formEl = e.target.closest('input, select, textarea');
    if (formEl) {
      if (formEl.type !== 'file') formEl.focus();
      return;
    }

    // Everything else — find the nearest clickable element and fire .click()
    const clickable = e.target.closest('button, a, [onclick], [role="button"], label');
    if (clickable) {
      e.preventDefault();
      clickable.click();
    }
  }, { passive: false });

  loadSiteCopy();
  renderCityGrid();
  renderNav(currentUser);
  // Capture ?ref=CODE from URL into sessionStorage for the signup step
  if (typeof captureReferralFromURL === 'function') captureReferralFromURL();
  if (typeof obInit === 'function') obInit();
  const ffg = document.getElementById('favFilterGroup');
  if (ffg) ffg.style.display = currentUser ? '' : 'none';
  const homeAuth = document.getElementById('homeAuthRow');
  if (homeAuth) homeAuth.style.display = currentUser ? 'none' : '';
  const homeSkip = document.getElementById('homeSkipAuth');
  if (homeSkip) homeSkip.style.display = currentUser ? 'none' : '';

  // Handle OAuth callback (Google SSO redirect)
  if (typeof handleOAuthCallback === 'function') {
    handleOAuthCallback();
  }

  // Detect password reset redirect from Supabase email link
  const hash = window.location.hash;
  if (hash && hash.includes('type=recovery')) {
    const params = new URLSearchParams(hash.replace('#', ''));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (accessToken) {
      db.auth.setSession({ access_token: accessToken, refresh_token: refreshToken || '' })
        .then(() => {
          window.history.replaceState({}, document.title, window.location.pathname);
          openResetPassword();
        })
        .catch(() => openResetPassword());
    }
  }

  // Deep-link: /?list=<uuid> opens list detail directly (used by shared list links)
  const deepParams = new URLSearchParams(window.location.search);
  const listId = deepParams.get('list');
  const spotId = deepParams.get('spot');

  // Auto-enter last city (or default San Diego) if user is signed in
  if (currentUser) {
    const lastSlug = localStorage.getItem('spotd-last-city') || 'san-diego';
    const city = CITIES.find(c => c.slug === lastSlug && c.active) || CITIES[0];
    enterCity(city.slug, city.name, city.state_code).then(() => {
      if (listId) {
        window.history.replaceState({}, document.title, '/');
        openListDetail(listId);
      } else if (spotId) {
        // Deep-link: /?spot=<uuid> opens venue modal directly (used by SEO venue pages)
        window.history.replaceState({}, document.title, window.location.pathname);
        openModal(spotId, 'venue');
      }
    });
  } else {
    const city = CITIES[0];
    if (listId) {
      enterCity(city.slug, city.name, city.state_code).then(() => {
        window.history.replaceState({}, document.title, '/');
        openListDetail(listId);
      });
    } else if (spotId) {
      // Guest deep-link: enter default city then open modal
      enterCity(city.slug, city.name, city.state_code).then(() => {
        window.history.replaceState({}, document.title, window.location.pathname);
        openModal(spotId, 'venue');
      });
    }
  }
});

function onAuthChange(user) {
  if (user && typeof obComplete === 'function') obComplete();
  // Guard: DOM may not be ready if called during session restore
  if (!document.body) return;
  renderNav(user);
  const ffg = document.getElementById('favFilterGroup');
  if (ffg) ffg.style.display = user ? '' : 'none';
  if (!user && state.favFilterOn) { state.favFilterOn = false; applyFilters(); }
  // Refresh unread badge whenever auth state changes
  if (user) dmRefreshBadge();
  // Push prompt is now shown via the soft modal after check-in/save flow
  // If user just signed in, enter pending city or auto-enter last city
  if (user && window._pendingCity) {
    const { slug, name, stateCode } = window._pendingCity;
    window._pendingCity = null;
    enterCity(slug, name, stateCode);
  } else if (user && !state.city) {
    const lastSlug = localStorage.getItem('spotd-last-city') || 'san-diego';
    const city = CITIES.find(c => c.slug === lastSlug && c.active) || CITIES[0];
    enterCity(city.slug, city.name, city.state_code);
  }
}

// ── NAV ────────────────────────────────────────────────
function renderNav(user) {
  renderBottomNav(user);
}

function renderBottomNav(user) {
  if (!user) {
    // No user — hide nav if it exists
    const bar = document.getElementById('bottomNav');
    if (bar) bar.style.display = 'none';
    return;
  }
  // Build initials for profile avatar
  const fullName = user.user_metadata?.full_name || '';
  const initials = fullName
    ? fullName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  let bar = document.getElementById('bottomNav');
  if (!bar) {
    bar = document.createElement('nav');
    bar.id = 'bottomNav';
    bar.className = 'bottom-nav';
    bar.innerHTML = `
      <button class="bottom-nav-btn active" id="bnFeed" onclick="bottomNavFeed(this)">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1"/></svg>
        <span>The Spots</span>
      </button>
      <button class="bottom-nav-btn" id="bnSocial" onclick="bottomNavSocial(this)">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-1a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        <span>The Spotrs</span>
      </button>
      <button class="bottom-nav-btn" id="bnNews" onclick="bottomNavNews(this)">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><line x1="10" y1="6" x2="18" y2="6"/><line x1="10" y1="10" x2="18" y2="10"/><line x1="10" y1="14" x2="14" y2="14"/></svg>
        <span>Your News</span>
      </button>
      <button class="bottom-nav-btn" id="bnProfile" onclick="bottomNavProfile(this)">
        <div class="bn-avatar" id="bnAvatarCircle">${initials}<span class="bn-dot" id="bnProfileBadge" style="display:none"></span></div>
        <span id="bnProfileLabel">Profile</span>
      </button>`;
    document.body.appendChild(bar);
  } else {
    const avatar = document.getElementById('bnAvatarCircle');
    if (avatar) avatar.textContent = initials;
  }
  bar.style.display = 'flex';
}

// ── THEME ──────────────────────────────────────────────
function toggleTheme() {
  const root = document.documentElement;
  const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.body.classList.add('theme-transitioning');
  root.setAttribute('data-theme', next);
  localStorage.setItem('spotd-theme', next);
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.innerHTML = next === 'dark' ? icn('sun',14) : icn('moon',14);
  setTimeout(() => document.body.classList.remove('theme-transitioning'), 400);
}

function _navHideAll(keep) {
  if (keep !== 'dm')     closeDmTab();
  if (keep !== 'social') closeSocialTab();
  if (keep !== 'news')   closeNewsTab();
  if (keep !== 'profile') closeProfile();
  closeSubPage('findPeoplePage');
  closeSubPage('followersPage');
  closeSubPage('feedPage');
  closeSubPage('leaderboardPage');
  closeOverlay('modalOverlay');
  closeOverlay('authOverlay');
  closeSubPage('pubProfilePage');
}

function bottomNavFeed(btn) {
  if(typeof haptic==='function')haptic('light');
  document.querySelectorAll('.bottom-nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _navHideAll();
  if (!state.city) showHome();
  // Scroll feed back to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bottomNavSocial(btn) {
  if(typeof haptic==='function')haptic('light');
  document.querySelectorAll('.bottom-nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _navHideAll('social');
  openSocialTab();
}

function bottomNavNews(btn) {
  if(typeof haptic==='function')haptic('light');
  document.querySelectorAll('.bottom-nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _navHideAll('news');
  openNewsTab();
}

function bottomNavProfile(btn) {
  if(typeof haptic==='function')haptic('light');
  document.querySelectorAll('.bottom-nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _navHideAll('profile');
  if (currentUser) openProfile();
  else openAuth('signin');
}

// ── SOCIAL TAB ─────────────────────────────────────────
function openSocialTab() {
  if (!currentUser) { openAuth('signin'); return; }
  document.getElementById('socialTab').classList.add('tab-open');
  loadSocialFeed();
  maybeShowSocialNudge();
  checkSocialNotifications();
}

function maybeShowSocialNudge() {
  const KEY = 'spotd_social_nudge';
  const seen = parseInt(localStorage.getItem(KEY) || '0', 10);
  if (seen >= 3) return;
  localStorage.setItem(KEY, String(seen + 1));
  // Small delay so the feed loads behind the modal
  setTimeout(() => {
    const overlay = document.createElement('div');
    overlay.id = 'socialNudgeOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:600;background:rgba(42,31,20,0.55);display:flex;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(3px);animation:fadeInOverlay .2s ease';
    overlay.innerHTML = `
      <div style="background:var(--card);border-radius:20px;padding:28px 24px;max-width:320px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(42,31,20,0.18);animation:scaleInModal .22s ease">
        <div style="font-size:32px;margin-bottom:10px">${icn('camera',32)}</div>
        <div style="font-family:'Cabinet Grotesk',sans-serif;font-size:19px;font-weight:900;margin-bottom:8px;color:var(--text)">Share your night out</div>
        <div style="font-size:13px;color:var(--muted);line-height:1.5;margin-bottom:20px">Check in at a spot and add a photo — it shows up in this feed for everyone in the city.</div>
        <button onclick="document.getElementById('socialNudgeOverlay').remove()" style="width:100%;padding:13px;background:var(--coral);color:#fff;border:none;border-radius:12px;font-family:'Cabinet Grotesk',sans-serif;font-size:15px;font-weight:700;cursor:pointer">Got it</button>
        ${seen < 2 ? `<div style="font-size:11px;color:var(--muted);margin-top:8px">${2 - seen} reminder${2 - seen !== 1 ? 's' : ''} left</div>` : ''}
      </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    presentOverlay(overlay);
  }, 400);
}
function closeSocialTab() {
  document.getElementById('socialTab').classList.remove('tab-open');
}

function openAddSpotForm() {
  if (!currentUser) { openAuth('signin'); return; }
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.onclick = e => { if (e.target === overlay) dismissOverlay(overlay); };
  overlay.innerHTML = `
    <div class="sheet">
      <div class="sheet-handle"></div>
      <div style="font-weight:800;font-size:17px;margin-bottom:20px;">Add a Spot</div>

      <div class="p-section">
        <div class="p-section-title">Venue Name</div>
        <div class="add-spot-search-wrap">
          <input class="field" id="addSpotName" type="text" placeholder="Search or type a venue name…" autocomplete="off" style="width:100%;box-sizing:border-box" oninput="_addSpotVenueSearch(this.value)">
          <div class="add-spot-results" id="addSpotResults" style="display:none"></div>
        </div>
        <div class="add-spot-linked" id="addSpotLinked" style="display:none"></div>
      </div>

      <div class="p-section">
        <div class="p-section-title">Neighborhood <span style="font-weight:400;color:var(--muted)">(optional)</span></div>
        <input class="field" id="addSpotHood" type="text" placeholder="e.g. Gaslamp, North Park" style="width:100%;box-sizing:border-box">
      </div>

      <div class="p-section">
        <div class="p-section-title">Your Experience</div>
        <textarea class="field" id="addSpotNote" placeholder="What was the vibe? Great drinks, cool music, good food…" style="width:100%;box-sizing:border-box;min-height:80px;resize:none"></textarea>
      </div>

      <div class="p-section">
        <div class="p-section-title">Rating</div>
        <div class="star-picker" id="addSpotStars" data-val="0">${[1,2,3,4,5].map(n => `<button class="sp" onclick="pickAddSpotStar(${n})">★</button>`).join('')}</div>
      </div>

      <div class="p-section">
        <div class="p-section-title">Photo or Video <span style="font-weight:400;color:var(--muted)">(optional)</span></div>
        <div class="add-spot-photo-area" id="addSpotPhotoArea" style="position:relative;border:2px dashed var(--border2);border-radius:12px;padding:24px;text-align:center;cursor:pointer">
          <input type="file" accept="image/*,video/mp4,video/quicktime,video/webm" id="addSpotMediaInput"
            style="position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;z-index:2"
            onchange="handleAddSpotMedia(this)">
          <div style="color:var(--muted);font-size:13px;pointer-events:none">${icn('camera',24)}<br>Tap to add a photo or video</div>
        </div>
        <div id="addSpotPhotoPreview" style="display:none;position:relative;margin-top:8px">
          <img id="addSpotPreviewImg" src="" alt="Preview" style="width:100%;border-radius:10px;max-height:200px;object-fit:cover">
          <button onclick="clearAddSpotMedia()" style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.5);color:#fff;border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:14px">✕</button>
        </div>
        <div id="addSpotVideoPreview" style="display:none;position:relative;margin-top:8px">
          <video id="addSpotPreviewVid" src="" playsinline muted loop style="width:100%;border-radius:10px;max-height:240px;object-fit:cover;background:#000"></video>
          <div class="add-spot-video-duration" id="addSpotVideoDuration" style="position:absolute;bottom:12px;left:10px;background:rgba(0,0,0,0.6);color:#fff;font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px"></div>
          <button onclick="clearAddSpotMedia()" style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.5);color:#fff;border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:14px">✕</button>
          <div class="cover-picker" id="addSpotCoverPicker" style="display:none;margin-top:8px">
            <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:6px">Choose cover frame</div>
            <div class="cover-filmstrip" id="addSpotFilmstrip"></div>
          </div>
        </div>
        <div id="addSpotMediaHint" style="display:none;font-size:11px;color:var(--muted);margin-top:6px;text-align:center"></div>
      </div>

      <progress id="addSpotUploadProgress" max="100" value="0" style="display:none;width:100%;height:6px;border-radius:3px;margin-top:8px;accent-color:var(--coral)"></progress>
      <button class="btn-save-sm" id="addSpotBtn" style="width:100%;padding:14px;margin-top:8px" onclick="submitSpotExperience()">Share with the feed</button>
    </div>`;
  presentOverlay(overlay);
}

// ── Add-a-Spot venue autocomplete ──
window._addSpotVenueId = null;
let _addSpotSearchTimer = null;

function _addSpotVenueSearch(query) {
  const results = document.getElementById('addSpotResults');
  if (!results) return;
  clearTimeout(_addSpotSearchTimer);
  const q = query.trim().toLowerCase();

  // If user edits after selecting, clear the linked venue
  if (window._addSpotVenueId) {
    window._addSpotVenueId = null;
    const linked = document.getElementById('addSpotLinked');
    if (linked) linked.style.display = 'none';
  }

  if (q.length < 2) { results.style.display = 'none'; return; }

  _addSpotSearchTimer = setTimeout(() => {
    const allVenues = [...(state.venues || []), ...(state.events || [])];
    const matches = allVenues.filter(v => v.name && v.name.toLowerCase().includes(q)).slice(0, 6);

    if (!matches.length) { results.style.display = 'none'; return; }

    results.innerHTML = matches.map(v => {
      const rating = v.google_rating ? `<span style="color:var(--muted);font-size:12px"> · ${ICN.star} ${v.google_rating}</span>` : '';
      return `<div class="add-spot-result" onclick="_addSpotSelectVenue('${v.id}')">
        <div class="add-spot-result-name">${esc(v.name)}${rating}</div>
        <div class="add-spot-result-hood">${esc(v.neighborhood || v.city_slug || '')}</div>
      </div>`;
    }).join('') +
    `<div class="add-spot-result add-spot-result--custom" onclick="document.getElementById('addSpotResults').style.display='none'">
      <div class="add-spot-result-name" style="color:var(--muted)">Not listed? Keep typing to add a new spot</div>
    </div>`;
    results.style.display = 'block';
  }, 150);
}

function _addSpotSelectVenue(venueId) {
  const allVenues = [...(state.venues || []), ...(state.events || [])];
  const v = allVenues.find(x => String(x.id) === String(venueId));
  if (!v) return;

  window._addSpotVenueId = v.id;

  // Fill form fields
  const nameInput = document.getElementById('addSpotName');
  const hoodInput = document.getElementById('addSpotHood');
  if (nameInput) nameInput.value = v.name;
  if (hoodInput && v.neighborhood) hoodInput.value = v.neighborhood;

  // Hide results
  document.getElementById('addSpotResults').style.display = 'none';

  // Show linked venue badge
  const linked = document.getElementById('addSpotLinked');
  if (linked) {
    linked.style.display = 'flex';
    linked.innerHTML = `
      <div class="add-spot-linked-info">
        <span class="add-spot-linked-icon">${ICN.pin}</span>
        <span class="add-spot-linked-name">${esc(v.name)}</span>
        ${v.neighborhood ? `<span class="add-spot-linked-hood">${esc(v.neighborhood)}</span>` : ''}
      </div>
      <button class="add-spot-linked-clear" onclick="_addSpotClearVenue()">✕</button>`;
  }
}

function _addSpotClearVenue() {
  window._addSpotVenueId = null;
  const linked = document.getElementById('addSpotLinked');
  if (linked) linked.style.display = 'none';
  const nameInput = document.getElementById('addSpotName');
  if (nameInput) { nameInput.value = ''; nameInput.focus(); }
}

function handleAddSpotMedia(input) {
  const file = input.files?.[0];
  if (!file) return;
  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  if (!isVideo && !isImage) { showToast('Please choose a photo or video'); return; }

  const area = document.getElementById('addSpotPhotoArea');
  const photoPreview = document.getElementById('addSpotPhotoPreview');
  const videoPreview = document.getElementById('addSpotVideoPreview');
  const hint = document.getElementById('addSpotMediaHint');

  if (isImage) {
    if (file.size > 10 * 1024 * 1024) { showToast('Photo must be under 10 MB'); return; }
    window._pendingAddSpotPhoto = file;
    window._pendingAddSpotVideo = null;
    const reader = new FileReader();
    reader.onload = e => {
      const img = document.getElementById('addSpotPreviewImg');
      if (img) img.src = e.target.result;
      if (photoPreview) photoPreview.style.display = 'block';
      if (videoPreview) videoPreview.style.display = 'none';
      if (area) area.style.display = 'none';
      if (hint) hint.style.display = 'none';
    };
    reader.readAsDataURL(file);
  } else {
    // Video file
    if (file.size > 100 * 1024 * 1024) { showToast('Video must be under 100 MB'); return; }

    // Validate duration client-side before accepting
    const tempUrl = URL.createObjectURL(file);
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      const dur = probe.duration;
      URL.revokeObjectURL(tempUrl);
      if (dur > 60) {
        showToast('Video must be 60 seconds or less');
        return;
      }
      window._pendingAddSpotVideo = file;
      window._pendingAddSpotPhoto = null;
      window._pendingCoverDataUrl = null;

      const vid = document.getElementById('addSpotPreviewVid');
      if (vid) {
        vid.src = URL.createObjectURL(file);
        vid.play().catch(() => {});
        // Build filmstrip cover picker once video is ready
        vid.onloadeddata = () => buildCoverPicker(vid);
      }
      const durLabel = document.getElementById('addSpotVideoDuration');
      if (durLabel) durLabel.textContent = dur < 60 ? `0:${Math.round(dur).toString().padStart(2,'0')}` : '1:00';
      if (videoPreview) videoPreview.style.display = 'block';
      if (photoPreview) photoPreview.style.display = 'none';
      if (area) area.style.display = 'none';
      if (hint) { hint.textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB · ${Math.round(dur)}s`; hint.style.display = 'block'; }
    };
    probe.onerror = () => { URL.revokeObjectURL(tempUrl); showToast('Could not read video file'); };
    probe.src = tempUrl;
  }
}

function clearAddSpotMedia() {
  window._pendingAddSpotPhoto = null;
  window._pendingAddSpotVideo = null;
  window._pendingCoverDataUrl = null;
  const photoPreview = document.getElementById('addSpotPhotoPreview');
  const videoPreview = document.getElementById('addSpotVideoPreview');
  const area = document.getElementById('addSpotPhotoArea');
  const hint = document.getElementById('addSpotMediaHint');
  const vid = document.getElementById('addSpotPreviewVid');
  if (vid && vid.src) { vid.pause(); URL.revokeObjectURL(vid.src); vid.removeAttribute('src'); }
  if (photoPreview) photoPreview.style.display = 'none';
  if (videoPreview) videoPreview.style.display = 'none';
  if (hint) hint.style.display = 'none';
  if (area) area.style.display = '';
}

// ── Client-side video compression (FFmpeg.wasm, lazy loaded) ────
let _ffmpegInstance = null;
async function getFFmpeg() {
  if (_ffmpegInstance) return _ffmpegInstance;
  try {
    const { FFmpeg } = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/+esm');
    const { fetchFile } = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/+esm');
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({
      coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js',
    });
    _ffmpegInstance = { ffmpeg, fetchFile };
    return _ffmpegInstance;
  } catch(e) {
    console.warn('[FFmpeg] Failed to load:', e);
    return null;
  }
}

/**
 * Compress a video file client-side. Returns the compressed File or the
 * original if compression fails or is unavailable.
 * @param {File} file
 * @param {function(string):void} [onStatus] – status text callback
 */
async function compressVideo(file, onStatus) {
  // Skip if file is already small (under 20MB)
  if (file.size < 20 * 1024 * 1024) return file;

  if (onStatus) onStatus('Loading compressor…');
  const ff = await getFFmpeg();
  if (!ff) return file; // FFmpeg unavailable, use original

  try {
    const { ffmpeg, fetchFile } = ff;
    const inputName = 'input.' + (file.name.split('.').pop() || 'mp4');
    const outputName = 'output.mp4';

    if (onStatus) onStatus('Compressing video…');
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    // Compress: re-encode to H.264 at reasonable bitrate, scale to max 720p
    await ffmpeg.exec([
      '-i', inputName,
      '-vf', 'scale=-2:min(720\\,ih)',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '28',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      '-y', outputName
    ]);

    const data = await ffmpeg.readFile(outputName);
    const compressed = new File([data.buffer], 'compressed.mp4', { type: 'video/mp4' });

    // Only use compressed if it's actually smaller
    if (compressed.size < file.size) {
      console.log(`[FFmpeg] Compressed ${(file.size/1024/1024).toFixed(1)}MB → ${(compressed.size/1024/1024).toFixed(1)}MB`);
      return compressed;
    }
    return file;
  } catch(e) {
    console.warn('[FFmpeg] Compression failed:', e);
    return file; // Fall back to original
  }
}

// ── Cover frame picker (filmstrip) ──────────────────────
function extractVideoFrames(videoEl, count) {
  return new Promise(resolve => {
    const dur = videoEl.duration;
    if (!dur || !isFinite(dur)) { resolve([]); return; }
    const frames = [];
    const step = dur / (count + 1);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    // Use a small thumbnail size for filmstrip
    canvas.width = 96;
    canvas.height = 72;
    let idx = 0;

    function grabNext() {
      if (idx >= count) { resolve(frames); return; }
      const t = step * (idx + 1);
      videoEl.currentTime = t;
    }

    videoEl.onseeked = () => {
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      frames.push({ time: videoEl.currentTime, dataUrl: canvas.toDataURL('image/jpeg', 0.7) });
      idx++;
      grabNext();
    };
    grabNext();
  });
}

async function buildCoverPicker(videoEl) {
  const picker = document.getElementById('addSpotCoverPicker');
  const strip = document.getElementById('addSpotFilmstrip');
  if (!picker || !strip) return;

  const wasPaused = videoEl.paused;
  videoEl.pause();
  const frames = await extractVideoFrames(videoEl, 8);
  if (!wasPaused) videoEl.play().catch(() => {});
  // Reset to start
  videoEl.currentTime = 0;

  if (frames.length === 0) return;
  strip.innerHTML = '';
  // Default to first frame
  window._pendingCoverDataUrl = frames[0].dataUrl;

  frames.forEach((f, i) => {
    const thumb = document.createElement('img');
    thumb.src = f.dataUrl;
    thumb.className = 'cover-frame' + (i === 0 ? ' cover-frame--active' : '');
    thumb.onclick = () => {
      strip.querySelectorAll('.cover-frame').forEach(t => t.classList.remove('cover-frame--active'));
      thumb.classList.add('cover-frame--active');
      window._pendingCoverDataUrl = f.dataUrl;
      // Scrub video to the selected time
      videoEl.currentTime = f.time;
    };
    strip.appendChild(thumb);
  });
  picker.style.display = 'block';
}

function pickAddSpotStar(n) {
  const picker = document.getElementById('addSpotStars');
  picker.dataset.val = n;
  picker.querySelectorAll('.sp').forEach((b, i) => b.classList.toggle('lit', i < n));
}

async function submitSpotExperience() {
  const name = (document.getElementById('addSpotName')?.value || '').trim();
  const hood = (document.getElementById('addSpotHood')?.value || '').trim();
  const note = (document.getElementById('addSpotNote')?.value || '').trim();
  const rating = parseInt(document.getElementById('addSpotStars')?.dataset.val || '0');
  if (!name) { showToast('Please enter a venue name'); return; }
  if (!note) { showToast('Tell us about your experience'); return; }

  const btn = document.getElementById('addSpotBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Posting…'; }

  try {
    const citySlug = state.city?.slug || 'san-diego';
    const meta = { note, rating: rating || null, manual: true };

    // Upload photo or video if one was selected
    const photoFile = window._pendingAddSpotPhoto;
    const videoFile = window._pendingAddSpotVideo;
    if (photoFile) {
      if (btn) btn.textContent = 'Uploading photo…';
      const uploaded = await uploadCheckinPhoto(photoFile, currentUser.id);
      if (uploaded) {
        meta.photo_url = uploaded.url;
        meta.photo_storage_path = uploaded.storagePath;
      }
    } else if (videoFile) {
      if (btn) btn.textContent = 'Uploading video…';
      const uploaded = await uploadCheckinVideo(videoFile, currentUser.id);
      if (!uploaded || uploaded.error) {
        showToast('Video upload failed: ' + (uploaded?.error || 'unknown error'));
        if (btn) { btn.disabled = false; btn.textContent = 'Share with the feed'; }
        return;
      }
      meta.video_url = uploaded.url;
      meta.video_storage_path = uploaded.storagePath;
      if (window._pendingCoverDataUrl) meta.video_poster = window._pendingCoverDataUrl;
    }

    const linkedVenueId = window._addSpotVenueId || null;

    await db.from('activity_feed').insert({
      user_id: currentUser.id,
      activity_type: 'check_in',
      venue_id: linkedVenueId,
      venue_name: name,
      neighborhood: hood || null,
      meta,
    });

    // If linked to a real venue, also create a check-in and review
    if (linkedVenueId) {
      const today = new Date().toISOString().slice(0, 10);
      // Add check-in (ignore if duplicate)
      await db.from('check_ins').upsert({
        user_id: currentUser.id,
        venue_id: linkedVenueId,
        city_slug: citySlug,
        date: today,
        note: note || null,
      }, { onConflict: 'user_id, venue_id, date', ignoreDuplicates: true }).catch(() => {});

      // Add review if they gave a rating
      if (rating) {
        await db.from('reviews').insert({
          venue_id: linkedVenueId,
          user_id: currentUser.id,
          rating,
          text: note || null,
          name: currentUser.user_metadata?.full_name || 'Anonymous',
        }).catch(() => {});
      }
    }

    window._addSpotVenueId = null;

    window._pendingAddSpotPhoto = null;
    window._pendingAddSpotVideo = null;
    window._pendingCoverDataUrl = null;
    dismissOverlay(document.querySelector('.overlay.open'));
    showToast('Spot shared!');
    _socialLoading = false;
    loadSocialFeed();
  } catch(e) {
    console.error('submitSpotExperience error:', e);
    showToast('Could not post — try again');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Share with the feed'; }
}

function showFeedTooltip() {
  if(typeof haptic==='function')haptic('light');
  const existing = document.getElementById('feedTooltip');
  if (existing) { existing.remove(); return; }
  const tip = document.createElement('div');
  tip.id = 'feedTooltip';
  tip.innerHTML = `
    <div class="feed-tooltip">
      <button class="feed-tooltip-close" onclick="this.closest('#feedTooltip').remove()">&times;</button>
      <div class="feed-tooltip-title">Your City's Feed</div>
      <p class="feed-tooltip-desc">See what's happening in your city over the last 30 days. Posts from people you follow show up first.</p>
      <div class="feed-tooltip-ways">
        <div class="feed-tooltip-way"><span>📍</span> <strong>Check in</strong> at a venue to show where you are</div>
        <div class="feed-tooltip-way"><span>📸</span> <strong>Share a photo</strong> when you check in</div>
        <div class="feed-tooltip-way"><span>⭐</span> <strong>Leave a review</strong> on any venue</div>
        <div class="feed-tooltip-way"><span>❤️</span> <strong>Save a spot</strong> to your favorites</div>
      </div>
      <p class="feed-tooltip-footer">All of these show up in the feed for your city!</p>
    </div>`;
  document.getElementById('socialTab').prepend(tip);
}

let _socialLoading = false;
let _socialItems = [];
let _socialActiveTab = 'following';

async function loadSocialFeed() {
  if (_socialLoading) return;
  _socialLoading = true;

  const container = document.getElementById('socialFeedContent');
  container.innerHTML = '<div class="social-loading"><div class="social-spinner"></div></div>';

  try {
    const followingIds = currentUser ? await getFollowing(currentUser.id) : [];
    const citySlug = state.city?.slug || 'san-diego';
    const items = await fetchSocialFeed(citySlug, followingIds, 60);

    // Hydrate like + comment counts for each feed item
    if (items.length) {
      const postIds = items.map(i => i.id).filter(Boolean);
      const [likesMap, commentCounts] = await Promise.all([
        fetchLikesBulk(postIds),
        fetchCommentCountsBulk(postIds),
      ]);
      items.forEach(item => {
        const likers = likesMap[item.id] || [];
        item._likeCount = likers.length;
        item._liked = currentUser ? likers.includes(currentUser.id) : false;
        item._commentCount = commentCounts[item.id] || 0;
      });
    }

    _socialItems = items;
    renderSocialTab(_socialActiveTab);
  } catch(e) {
    console.error('loadSocialFeed:', e);
    container.innerHTML = '<div class="social-empty"><div class="social-empty-sub">Failed to load — pull to refresh</div></div>';
  } finally {
    _socialLoading = false;
  }
}

function switchSocialTab(tab) {
  _socialActiveTab = tab;
  document.getElementById('socialSubFollowing').classList.toggle('active', tab === 'following');
  document.getElementById('socialSubPublic').classList.toggle('active', tab === 'public');
  renderSocialTab(tab);
}

function renderSocialTab(tab) {
  const container = document.getElementById('socialFeedContent');
  const filtered = tab === 'following'
    ? _socialItems.filter(i => i.isFollowing)
    : _socialItems.filter(i => !i.isFollowing);

  if (tab === 'following' && !filtered.length) {
    const hasAnyFollowing = _socialItems.some(i => i.isFollowing);
    container.innerHTML = `
      <div class="social-empty">
        <div class="social-empty-icon">${icn('users',32)}</div>
        <div class="social-empty-title">${hasAnyFollowing ? 'Nothing here yet' : 'Follow people to see their activity'}</div>
        <div class="social-empty-sub">When you follow someone, their check-ins and photos show up here.</div>
        <a href="https://apps.apple.com/us/app/spotd/id6760452388" class="social-share-cta" onclick="shareSpotsWithFriend();return false;">
          ${icn('share',18)} Share Spotd with a friend!
        </a>
      </div>`;
    return;
  }

  if (!filtered.length) {
    container.innerHTML = `
      <div class="social-empty">
        <div class="social-empty-icon">${icn('camera',32)}</div>
        <div class="social-empty-title">Nothing here yet</div>
        <div class="social-empty-sub">Be the first to check in and share a photo tonight</div>
      </div>`;
    return;
  }

  // ── Modular masonry layout ──
  // Photo/video posts → full-width hero cards
  // Text-only posts → batched into 2-up compact rows with occasional full-width singles
  let html = '';
  let textBatch = [];
  let batchIdx = 0;

  const flushTextBatch = () => {
    if (!textBatch.length) return;
    // Every 3rd batch, let the first item be full-width for rhythm
    while (textBatch.length > 0) {
      if (textBatch.length >= 2 && batchIdx % 3 !== 2) {
        html += `<div class="sf-compact-row">${renderSocialItem(textBatch.shift(), 'compact')}${renderSocialItem(textBatch.shift(), 'compact')}</div>`;
      } else {
        html += renderSocialItem(textBatch.shift(), 'wide');
      }
      batchIdx++;
    }
  };

  filtered.forEach(item => {
    const hasMedia = item.type === 'photo' || (item.type === 'check_in' && (item.meta?.photo_url || item.meta?.video_url));
    if (hasMedia) {
      flushTextBatch();
      html += renderSocialItem(item, 'hero');
    } else {
      textBatch.push(item);
    }
  });
  flushTextBatch();

  container.innerHTML = html;
  observeFeedVideos();
}

function shareSpotsWithFriend() {
  if(typeof haptic==='function')haptic('light');
  const msg = 'Check out Spotd — find the best happy hours, events & nightlife near you!\n\nhttps://apps.apple.com/us/app/spotd/id6760452388';
  if (navigator.share) { navigator.share({ title: 'Spotd', text: msg }).catch(() => {}); }
  else { window.open(`sms:?body=${encodeURIComponent(msg)}`, '_blank'); }
}

function renderSocialItem(item, variant) {
  const allItems = [...(state.venues || []), ...(state.events || [])];
  const venue = item.venue_id ? allItems.find(v => String(v.id) === String(item.venue_id)) : null;
  const venueName = venue?.name || item.venue_name || 'a spot';
  const neighborhood = venue?.neighborhood || item.neighborhood || '';
  const profile = item.profile || {};
  const displayName = profile.display_name || 'Someone';
  const avatarHtml = initialsAvatar(displayName, '', profile.avatar_emoji, profile.avatar_url);
  const isMe = item.user_id === currentUser?.id;
  const timeAgo = fmtDate(item.created_at);

  const profileClick = !isMe
    ? `onclick="openPublicProfile('${item.user_id}')" style="cursor:pointer"` : '';
  const venueClick = venue
    ? `onclick="openModal('${item.venue_id}','${venue.event_type ? 'event' : 'venue'}')" style="cursor:pointer"` : '';

  const postId = item.id || '';
  const postType = item.type || '';
  const likeCount = item._likeCount || 0;
  const isLiked = item._liked || false;
  const commentCount = item._commentCount || 0;
  if (!window._socialPostMeta) window._socialPostMeta = {};
  window._socialPostMeta[postId] = item.meta || null;

  // ── Action type labels ──
  const actionVerbs = { photo: 'checked in at', check_in: 'checked in at', review: 'reviewed', favorite: 'saved', going_tonight: 'is going to', tagged_at: 'was tagged at' };
  const actionVerb = actionVerbs[item.type] || 'visited';
  const actionSuffix = item.type === 'going_tonight' ? ' tonight' : '';

  // ── Rating display ──
  const rating = item.meta?.rating || 0;
  const ratingHtml = rating ? `<span class="sf-stars">${'★'.repeat(rating)}${'☆'.repeat(5-rating)}</span>` : '';

  // ── Caption / note ──
  const caption = item.caption || item.meta?.note || item.meta?.text || '';

  // ── Photo URL ──
  const photoUrl = item.photo_url || item.meta?.photo_url || '';
  const videoUrl = item.meta?.video_url || '';
  const videoPoster = item.meta?.video_poster || '';

  // ── Action buttons (shared) — orange gradient pills ──
  const actionBtns = `
    <div class="sf-actions">
      <button class="sf-action-btn${isLiked ? ' sf-liked' : ''}" id="like-${postId}" onclick="event.stopPropagation();doToggleLike('${postId}','${postType}',this)">
        ${isLiked ? ICN.heartFill : ICN.heart}${likeCount ? `<span>${likeCount}</span>` : ''}
      </button>
      <button class="sf-action-btn" onclick="event.stopPropagation();openCommentsSheet('${postId}','${postType}')">
        ${ICN.comment}${commentCount ? `<span>${commentCount}</span>` : ''}
      </button>
      <button class="sf-action-btn sf-more" onclick="event.stopPropagation();openReportMenu('${postType}','${postId}','${item.user_id}',${isMe})" title="${isMe ? 'Options' : 'Report'}">···</button>
    </div>`;

  // ═══════════════════════════════════════════
  // HERO VARIANT — full-bleed photo/video card
  // ═══════════════════════════════════════════
  if (variant === 'hero') {
    // Build the info overlay once — it's nested INSIDE sf-hero-media so its
    // absolute `bottom: 0` is the bottom of the photo, not the bottom of the
    // whole card (which would put it behind the action-bar row below).
    const infoOverlay = `<div class="sf-hero-info">
      <div class="sf-hero-user" ${profileClick}>
        <div class="sf-hero-avatar">${avatarHtml}</div>
        <span class="sf-hero-name">${esc(displayName)}</span>
      </div>
      <div class="sf-hero-venue" ${venueClick}>${esc(venueName)}</div>
      <div class="sf-hero-meta">${neighborhood ? `<span>${esc(neighborhood)}</span><span class="sf-dot"></span>` : ''}<span>${timeAgo}</span></div>
      ${caption ? `<div class="sf-hero-caption">${esc(caption)}</div>` : ''}
      ${ratingHtml ? `<div class="sf-hero-rating">${ratingHtml}</div>` : ''}
    </div>`;

    const mediaInner = videoUrl
      ? `<div class="sf-hero-media" onclick="toggleFeedVideo(this)">
          <video class="social-video" data-src="${esc(videoUrl)}" playsinline muted loop preload="none"
            ${videoPoster ? `poster="${esc(videoPoster)}"` : ''}
            onerror="this.closest('.sf-hero-media').remove()"></video>
          <div class="social-video-play-overlay">${ICN.play || '▶'}</div>
          <div class="social-video-mute-btn" onclick="event.stopPropagation();toggleFeedVideoMute(this)">${ICN.volumeOff || '🔇'}</div>
          <div class="sf-hero-grad"></div>
          ${infoOverlay}
        </div>`
      : `<div class="sf-hero-media" ${venueClick}>
          <img class="sf-hero-img" src="${esc(photoUrl)}" alt="${esc(venueName)}" loading="lazy"
            onerror="this.closest('.sf-hero').style.background='linear-gradient(135deg,#2A1F14,#1A1208)';this.remove()">
          <div class="sf-hero-grad"></div>
          ${infoOverlay}
        </div>`;

    return `<div class="sf-hero">
      ${mediaInner}
      ${actionBtns}
    </div>`;
  }

  // ═══════════════════════════════════════════
  // COMPACT VARIANT — small card for 2-up grid
  // ═══════════════════════════════════════════
  if (variant === 'compact') {
    return `<div class="sf-compact">
      <div class="sf-compact-header" ${profileClick}>
        <div class="sf-compact-avatar">${avatarHtml}</div>
        <span class="sf-compact-name">${esc(displayName)}</span>
      </div>
      <div class="sf-compact-body" ${venueClick}>
        <div class="sf-compact-venue">${esc(venueName)}</div>
        ${ratingHtml ? `<div class="sf-compact-rating">${ratingHtml}</div>` : ''}
        ${caption ? `<div class="sf-compact-caption">${esc(caption)}</div>` : ''}
        <div class="sf-compact-meta">${esc(neighborhood || timeAgo)}</div>
      </div>
      <div class="sf-compact-actions">
        <button class="sf-action-btn${isLiked ? ' sf-liked' : ''}" id="like-${postId}" onclick="event.stopPropagation();doToggleLike('${postId}','${postType}',this)">
          ${isLiked ? ICN.heartFill : ICN.heart}${likeCount ? `<span>${likeCount}</span>` : ''}
        </button>
        <button class="sf-action-btn" onclick="event.stopPropagation();openCommentsSheet('${postId}','${postType}')">
          ${ICN.comment}${commentCount ? `<span>${commentCount}</span>` : ''}
        </button>
      </div>
    </div>`;
  }

  // ═══════════════════════════════════════════
  // WIDE VARIANT — full-width text card
  // ═══════════════════════════════════════════
  return `<div class="sf-wide">
    <div class="sf-wide-header" ${profileClick}>
      <div class="sf-wide-avatar">${avatarHtml}</div>
      <span class="sf-wide-hname">${esc(displayName)}</span>
    </div>
    <div class="sf-wide-body" ${venueClick}>
      <div class="sf-wide-headline">
        <span class="sf-wide-name" ${profileClick}>${esc(displayName)}</span>
        <span class="sf-wide-verb">${actionVerb}</span>
        <span class="sf-wide-venue">${esc(venueName)}</span>${actionSuffix}
      </div>
      ${ratingHtml ? `<div class="sf-wide-rating">${ratingHtml}</div>` : ''}
      ${caption ? `<div class="sf-wide-caption">"${esc(caption)}"</div>` : ''}
      <div class="sf-wide-meta">${neighborhood ? `${esc(neighborhood)} · ` : ''}${timeAgo}</div>
    </div>
    ${actionBtns}
  </div>`;
}
// ── COMMENTS BOTTOM SHEET ──
async function openCommentsSheet(postId, postType) {
  if(typeof haptic==='function')haptic('light');
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.onclick = e => { if (e.target === overlay) dismissOverlay(overlay); };
  overlay.innerHTML = `
    <div class="sheet" style="max-height:70vh">
      <div class="sheet-handle"></div>
      <div style="font-weight:800;font-size:17px;margin-bottom:16px">Comments</div>
      <div class="sf-comments-list" id="clist-sheet-${postId}">
        <div style="padding:20px 0;text-align:center;color:var(--muted);font-size:13px">Loading...</div>
      </div>
      ${currentUser ? `<div class="sf-comment-compose">
        <input class="field" id="cinput-sheet-${postId}" type="text" placeholder="Add a comment..." maxlength="280"
          onkeydown="if(event.key==='Enter')submitCommentSheet('${postId}','${postType}')" style="flex:1">
        <button class="sf-comment-send-btn" onclick="submitCommentSheet('${postId}','${postType}')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>` : ''}
    </div>`;
  presentOverlay(overlay);

  const list = document.getElementById('clist-sheet-' + postId);
  const comments = await fetchComments(postId, postType);
  list.innerHTML = comments.length
    ? comments.map(c => `<div class="sf-comment-row">
        <span class="sf-comment-author">${esc(c.profile?.display_name || 'User')}</span>
        <span class="sf-comment-text">${esc(c.text)}</span>
        <span class="sf-comment-time">${fmtDate(c.created_at)}</span>
      </div>`).join('')
    : '<div style="padding:24px 0;text-align:center;color:var(--muted);font-size:13px">No comments yet — be the first</div>';
}

async function submitCommentSheet(postId, postType) {
  const input = document.getElementById('cinput-sheet-' + postId);
  if (!input || !currentUser) return;
  const text = input.value.trim();
  if (!text) return;
  if(typeof haptic==='function')haptic('medium');
  input.value = '';
  const result = await addComment(postId, postType, currentUser.id, text);
  if (result) {
    const list = document.getElementById('clist-sheet-' + postId);
    const name = currentUser.user_metadata?.full_name || 'You';
    // Remove "No comments" placeholder
    const placeholder = list?.querySelector('div[style*="text-align:center"]');
    if (placeholder) placeholder.remove();
    const el = document.createElement('div');
    el.className = 'sf-comment-row';
    el.innerHTML = `<span class="sf-comment-author">${esc(name)}</span><span class="sf-comment-text">${esc(text)}</span><span class="sf-comment-time">Just now</span>`;
    list?.appendChild(el);
    // Update comment count on the card button
    const btn = document.querySelectorAll(`[onclick*="openCommentsSheet('${postId}"]`);
    btn.forEach(b => {
      const countEl = b.querySelector('span');
      const c = parseInt(countEl?.textContent || '0', 10) || 0;
      if (countEl) countEl.textContent = c + 1;
      else b.innerHTML += `<span>1</span>`;
    });
  }
}

// ── Feed video controls ──────────────────────────────────
function toggleFeedVideo(wrap) {
  const vid = wrap.querySelector('video');
  const overlay = wrap.querySelector('.social-video-play-overlay');
  if (!vid) return;
  if (vid.paused) {
    vid.play().catch(() => {});
    if (overlay) overlay.style.opacity = '0';
  } else {
    vid.pause();
    if (overlay) overlay.style.opacity = '1';
  }
}

function toggleFeedVideoMute(btn) {
  const vid = btn.closest('.social-video-wrap')?.querySelector('video');
  if (!vid) return;
  vid.muted = !vid.muted;
  btn.innerHTML = vid.muted ? (ICN.volumeOff || '🔇') : (ICN.volumeOn || '🔊');
}

// Preload observer — loads video src when approaching viewport
const _preloadMargin = (navigator.connection?.effectiveType === '4g') ? '300px' : '100px';
const _feedVideoPreloader = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const vid = entry.target.querySelector('video[data-src]');
    if (vid && !vid.src) {
      vid.src = vid.dataset.src;
      vid.removeAttribute('data-src');
    }
    _feedVideoPreloader.unobserve(entry.target);
  });
}, { rootMargin: _preloadMargin });

// Play/pause observer — autoplay muted when visible, pause when out
const _feedVideoObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    const vid = entry.target.querySelector('video');
    if (!vid) return;
    const overlay = entry.target.querySelector('.social-video-play-overlay');
    if (entry.isIntersecting) {
      // Ensure src is loaded before playing
      if (vid.dataset.src && !vid.src) { vid.src = vid.dataset.src; vid.removeAttribute('data-src'); }
      vid.play().catch(() => {});
      if (overlay) overlay.style.opacity = '0';
    } else {
      vid.pause();
      if (overlay) overlay.style.opacity = '1';
    }
  });
}, { threshold: 0.5 });

function observeFeedVideos() {
  document.querySelectorAll('.social-video-wrap').forEach(wrap => {
    _feedVideoPreloader.observe(wrap);
    _feedVideoObserver.observe(wrap);
  });
}

async function doToggleLike(postId, postType, btn) {
  if (!currentUser) { openAuth('signin'); return; }
  if(typeof haptic==='function')haptic('light');
  const result = await toggleLike(postId, postType, currentUser.id);
  if (!result) return;
  const countEl = btn.querySelector('span');
  const currentCount = parseInt(countEl?.textContent || '0', 10) || 0;
  if (result.liked) {
    btn.classList.add('liked', 'sf-liked');
    btn.innerHTML = `${ICN.heartFill}<span>${currentCount + 1}</span>`;
  } else {
    btn.classList.remove('liked', 'sf-liked');
    const newCount = Math.max(0, currentCount - 1);
    btn.innerHTML = `${ICN.heart}${newCount ? `<span>${newCount}</span>` : ''}`;
  }
}

async function doSignOut() { await authSignOut(); showToast('Signed out'); }

// ── HOME ───────────────────────────────────────────────
function renderCityGrid() {
  const grid = document.getElementById('cityGrid');
  grid.innerHTML = CITIES.map(c => {
    const onclick = c.active ? `onclick="enterCity('${c.slug}','${c.name}','${c.state_code}')"` : '';
    const countBadge = c.active && c.venue_count ? `<div class="city-card-count">${c.venue_count}+ spots</div>` : '';
    return `<div class="city-card${c.active ? '' : ' coming'}" ${onclick}>
      <div class="city-card-name">${c.name}</div>
      <div class="city-card-state">${c.state_code}</div>
      ${countBadge}
    </div>`;
  }).join('');
}

// ── CITY DROPDOWN ──────────────────────────────────────
function toggleCityDropdown() {
  const dd = document.getElementById('cityDropdown');
  const pill = document.getElementById('cityPill');
  const isOpen = dd.classList.contains('open');
  if (isOpen) {
    dd.classList.remove('open');
    pill.classList.remove('open');
    return;
  }
  dd.innerHTML = CITIES.map(c => {
    const isCurrent = state.city?.slug === c.slug;
    const disabled = !c.active;
    return `<button class="city-dropdown-item${isCurrent ? ' current' : ''}${disabled ? ' disabled' : ''}"
      ${c.active ? `onclick="selectCity('${c.slug}','${c.name}','${c.state_code}')"` : ''}>
      <span class="city-dropdown-name">${c.name}, ${c.state_code}</span>
      ${isCurrent ? '<span class="city-dropdown-check">✓</span>' : ''}
      ${disabled ? '<span class="city-dropdown-soon">Soon</span>' : ''}
    </button>`;
  }).join('');
  dd.classList.add('open');
  pill.classList.add('open');
  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function _close(e) {
      if (!e.target.closest('.city-selector-wrap')) {
        dd.classList.remove('open');
        pill.classList.remove('open');
        document.removeEventListener('click', _close);
      }
    });
  }, 0);
}

function selectCity(slug, name, stateCode) {
  document.getElementById('cityDropdown').classList.remove('open');
  document.getElementById('cityPill').classList.remove('open');
  if (state.city?.slug === slug) return;
  enterCity(slug, name, stateCode);
}

function showHome() {
  document.getElementById('homePage').style.display = 'flex';
  document.getElementById('appPage').style.display  = 'none';
  state.city = null;
  state.venues = []; state.events = []; state.filtered = [];
  document.title = 'Spotd — Happy Hours & Events Near You';
  // Reset filters
  state.filters = { day: null, area: null, type: null, search: '', amenities: [] };
  state.favFilterOn = false;
  if (state.map) { state.map.remove(); state.map = null; state.markers = {}; }
  renderNav(currentUser);
}

async function enterCity(slug, name, stateCode) {
  state.city = { slug, name, stateCode };
  localStorage.setItem('spotd-last-city', slug);
  document.getElementById('homePage').style.display = 'none';
  document.getElementById('appPage').style.display  = 'block';
  document.getElementById('cityBarName').textContent = `${name}, ${stateCode}`;
  document.title = `Spotd — ${name} Happy Hours & Events`;
  renderNav(currentUser);
  track('city_entered', { city_slug: slug });
  if (typeof maybeShowGiveawayBanner === 'function') maybeShowGiveawayBanner();

  // Reset
  state.showFilter = 'all';
  state.filters.amenity = null;
  state.filters = { day: null, area: null, type: null, search: '', amenities: [] };
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

  // Native iOS: cache venues for offline + index in Spotlight
  if (window.spotdNative?.platform === 'ios') {
    try {
      const cachePayload = venues.map(v => ({ id: v.id, name: v.name, neighborhood: v.neighborhood, cuisine: v.cuisine, deals: v.deals, lat: v.lat, lng: v.lng, photo_url: v.photo_url }));
      window.spotdCache?.set('venues', JSON.stringify(cachePayload));
      window.spotdCache?.set('city', name);
      window.spotdSpotlight?.indexVenues(JSON.stringify(cachePayload));
    } catch(e) {}
  }

  // Fire-and-forget — data loads in background, cards render immediately
  // loadReviewAverages no longer calls renderCards() so it won't nuke the DOM
  loadGoingTonight(slug);
  loadReviewAverages(slug);
  loadTopDescriptions(venues);

  // Build filter pills + suggestions
  buildFilterPills();
  renderSuggestions();

  // ── Location permission logic ──────────────────────────
  // Granted once  → silently fetch fresh coords every time, sort by Nearest
  // Denied/never  → default A-Z, re-ask every 3rd app open
  const locationGranted = localStorage.getItem('spotd-location-granted') === 'yes';
  const nearBtn = document.getElementById('sort-distance');

  function _defaultToAZ() {
    state.sort = 'name';
    document.querySelectorAll('#sortFilters .pill').forEach(b => b.classList.remove('active'));
    document.getElementById('sort-name')?.classList.add('active');
    applyFilters();
  }

  function _activateNearest() {
    state.sort = 'distance';
    document.querySelectorAll('#sortFilters .pill').forEach(b => b.classList.remove('active'));
    if (nearBtn) nearBtn.classList.add('active');
  }

  function _requestLocation() {
    if (!navigator.geolocation) { _defaultToAZ(); return; }
    _activateNearest();
    if (nearBtn) { nearBtn.innerHTML = `${ICN.pin} Locating…`; nearBtn.disabled = true; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        state.userLat = pos.coords.latitude;
        state.userLng = pos.coords.longitude;
        localStorage.setItem('spotd-location-granted', 'yes');
        localStorage.removeItem('spotd-location-deny-count');
        try { localStorage.setItem('spotd-user-location', JSON.stringify({ lat: state.userLat, lng: state.userLng })); } catch(e) {}
        if (nearBtn) { nearBtn.innerHTML = `${ICN.pin} Nearest`; nearBtn.disabled = false; }
        applyFilters();
      },
      () => {
        localStorage.setItem('spotd-location-deny-count', '0');
        if (nearBtn) { nearBtn.innerHTML = `${ICN.pin} Nearest`; nearBtn.disabled = false; }
        _defaultToAZ();
      },
      { timeout: 6000 }
    );
  }

  if (locationGranted) {
    // Permission already granted — render cards immediately with cached/AZ sort,
    // then silently get fresh coords and re-sort when ready
    const cached = localStorage.getItem('spotd-user-location');
    if (cached) {
      try {
        const loc = JSON.parse(cached);
        state.userLat = loc.lat;
        state.userLng = loc.lng;
      } catch(e) {}
    }
    // Render cards NOW (with cached location or A-Z if no cache)
    if (state.userLat !== null) {
      _activateNearest();
    }
    applyFilters();
    // Then fetch fresh GPS in background and re-sort
    _requestLocation();
  } else {
    // Not yet granted — check if we should ask on this open
    const denyCount = parseInt(localStorage.getItem('spotd-location-deny-count'), 10);
    // Always render cards immediately in A-Z, then request location in background
    _defaultToAZ();
    if (isNaN(denyCount)) {
      // First time ever — ask (cards already showing)
      _requestLocation();
    } else {
      // Previously denied — increment counter, ask every 3rd open
      const newCount = denyCount + 1;
      if (newCount >= 3) {
        localStorage.setItem('spotd-location-deny-count', '0');
        _requestLocation();
      } else {
        localStorage.setItem('spotd-location-deny-count', String(newCount));
      }
    }
  }

  initMap();

  // ── Push notification prompt (after location dialog settles) ──
  // Show soft push prompt ~3s after entering city for the first time
  if (!localStorage.getItem('spotd-push-prompted')) {
    localStorage.setItem('spotd-push-prompted', '1');
    setTimeout(() => {
      if (typeof promptPushIfAppropriate === 'function') {
        promptPushIfAppropriate(true);
      }
    }, 3000);
  }

  // Tooltip walkthrough for first-time users (after cards render)
  if (typeof ttStart === 'function') setTimeout(ttStart, 2000);
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

  // Amenity cards (2-col grid, emoji + label)
  const af = document.getElementById('amenityFilters');
  if (af) {
    af.innerHTML = '';
    AMENITIES.forEach(a => {
      const btn = document.createElement('button');
      btn.className = 'amenity-card' + (state.filters.amenities.includes(a.key) ? ' active' : '');
      btn.innerHTML = `<span class="am-emoji">${a.emoji}</span><span class="am-label">${a.label}</span>`;
      btn.onclick = () => toggleAmenityFilter(a.key, btn);
      af.appendChild(btn);
    });
  }
}

function mkPill(label, onclick) {
  const b = document.createElement('button'); b.className = 'pill'; b.textContent = label; b.onclick = onclick; return b;
}
function clearAllVisible() {
  if(typeof haptic==='function')haptic('light');
  state.filters = { day: null, area: null, type: null, search: '', amenities: [] };
  state.favFilterOn = false;
  _activeSuggestion = null;
  document.getElementById('searchBox').value = '';
  ['dayFilters','areaFilters','typeFilters'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.tagName === 'SELECT') el.selectedIndex = 0;
  });
  document.querySelectorAll('#amenityFilters .amenity-card.active').forEach(b => b.classList.remove('active'));
  document.getElementById('chipsRow').innerHTML = '';
  document.getElementById('favFilterBtn')?.classList.remove('active');
  applyFilters(); updateDot(); renderSuggestions(); updateClearBtn();
}
function updateClearBtn() {
  const has = state.filters.day || state.filters.area || state.filters.type || state.filters.search || state.filters.amenities.length || state.favFilterOn;
  const btn = document.getElementById('clearAllBtn');
  if (btn) btn.style.display = has ? '' : 'none';
}
function clearAllFilters() {
  state.filters = { day: null, area: null, type: null, search: '', amenities: [] };
  state.favFilterOn = false;
  _activeSuggestion = null;
  document.getElementById('searchBox').value = '';
  ['dayFilters','areaFilters','typeFilters'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.tagName === 'SELECT') el.selectedIndex = 0;
  });
  document.querySelectorAll('#amenityFilters .amenity-card.active').forEach(b => b.classList.remove('active'));
  document.getElementById('chipsRow').innerHTML = '';
  document.getElementById('favFilterBtn')?.classList.remove('active');
  applyFilters(); updateDot(); toggleFilters(); renderSuggestions();
}

function setFilterFromSelect(key, selectEl) {
  const val = selectEl.value || null;
  state.filters[key] = val;
  applyFilters(); updateChips(); updateDot();
}
function setFilter(key, val, btn) {
  if(typeof haptic==='function')haptic('light');
  if (state.filters[key] === val) { state.filters[key] = null; btn.classList.remove('active'); }
  else { btn.parentElement.querySelectorAll('.pill.active').forEach(b => b.classList.remove('active')); state.filters[key] = val; btn.classList.add('active'); }
  applyFilters(); updateChips(); updateDot();
}
function toggleAmenityFilter(key, btn) {
  if(typeof haptic==='function')haptic('light');
  _activeSuggestion = null;
  const idx = state.filters.amenities.indexOf(key);
  if (idx >= 0) { state.filters.amenities.splice(idx, 1); btn.classList.remove('active'); }
  else { state.filters.amenities.push(key); btn.classList.add('active'); }
  applyFilters(); updateChips(); updateDot(); renderSuggestions();
}
function updateChips() {
  const row = document.getElementById('chipsRow'); row.innerHTML = '';
  const { day, area, type, search } = state.filters;
  if (day)    addChip(row, `Day: ${day}`,    () => clearFilter('day'));
  if (area)   addChip(row, `Area: ${area}`,  () => clearFilter('area'));
  if (type)   addChip(row, `Type: ${type}`,  () => clearFilter('type'));
  if (search) addChip(row, `"${search}"`,    () => { state.filters.search = ''; document.getElementById('searchBox').value = ''; applyFilters(); updateChips(); updateDot(); });
  if (state.filters.amenities.length) {
    state.filters.amenities.forEach(key => {
      const a = AMENITIES.find(x => x.key === key);
      if (a) addChip(row, `${a.emoji} ${a.label}`, () => {
        state.filters.amenities = state.filters.amenities.filter(k => k !== key);
        _activeSuggestion = null;
        document.querySelectorAll('#amenityFilters .amenity-card').forEach(b => { if (b.textContent.includes(a.label)) b.classList.remove('active'); });
        applyFilters(); updateChips(); updateDot(); renderSuggestions();
      });
    });
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
  const has = state.filters.day || state.filters.area || state.filters.type || state.filters.amenities.length || state.favFilterOn;
  document.getElementById('filterDot').classList.toggle('show', !!has);
  updateClearBtn();
  document.getElementById('filterToggle').classList.toggle('active', !!has);
}
// ── SMART SUGGESTIONS ────────────────────────────────
function renderSuggestions() {
  const row = document.getElementById('suggestionsRow');
  if (!row) return;
  row.innerHTML = '<span class="suggestions-label">Suggested</span>' + SUGGESTIONS.map(s => `
    <button class="suggestion-chip${_activeSuggestion === s.id ? ' suggestion-chip--active' : ''}"
            onclick="applySuggestion('${s.id}')">
      <span class="sg-emoji">${s.emoji}</span>${s.label}
    </button>
  `).join('');
}

function applySuggestion(id) {
  if(typeof haptic==='function')haptic('medium');
  const s = SUGGESTIONS.find(x => x.id === id);
  if (!s) return;

  // Toggle off if already active
  if (_activeSuggestion === id) {
    _activeSuggestion = null;
    state.filters.amenities = [];
    state.filters.search = '';
    document.getElementById('searchBox').value = '';
    document.querySelectorAll('#amenityFilters .amenity-card.active').forEach(b => b.classList.remove('active'));
    applyFilters(); updateChips(); updateDot(); renderSuggestions();
    return;
  }

  _activeSuggestion = id;
  // Clear existing then apply suggestion's filters
  state.filters.amenities = [...s.amenities];
  state.filters.search = s.search;
  document.getElementById('searchBox').value = s.search;
  // Sync amenity card active states
  document.querySelectorAll('#amenityFilters .amenity-card').forEach(btn => {
    const key = AMENITIES.find(a => btn.textContent.includes(a.label))?.key;
    btn.classList.toggle('active', key && s.amenities.includes(key));
  });
  applyFilters(); updateChips(); updateDot(); renderSuggestions();
}

let _searchTimer = null;
function debounceSearch() {
  clearTimeout(_searchTimer);
  _activeSuggestion = null; renderSuggestions();
  _searchTimer = setTimeout(() => {
    applyFilters(); updateChips(); updateDot();
    const q = (document.getElementById('searchBox')?.value || '').trim();
    if (q.length >= 2) track('search', { query_length: q.length });
  }, 250);
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
    const { day, area, type, amenities } = state.filters;
    const isEvent = !!v.event_type;

    if (day && !(v.days || []).includes(day)) return false;
    if (area && v.neighborhood !== area) return false;
    if (type) {
      const t = type.toLowerCase();
      const haystack = [v.name, v.neighborhood, v.cuisine, v.event_type, ...(v.deals || [])].join(' ').toLowerCase();
      if (!haystack.includes(t)) return false;
    }
    if (amenities && amenities.length) {
      for (const amenity of amenities) {
        const amenityDef = AMENITIES.find(a => a.key === amenity);
        if (isEvent) {
          if (!amenityDef?.eventType || v.event_type !== amenityDef.eventType) return false;
        } else {
          if (!v[amenity]) return false;
        }
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
    // Pin featured venues to the top, then sort by distance within each group
    state.filtered.sort((a, b) => {
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;
      const da = haversine(state.userLat, state.userLng, a.lat, a.lng);
      const db = haversine(state.userLat, state.userLng, b.lat, b.lng);
      return da - db;
    });
  } else if (state.sort === 'name') {
    state.filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } else {
    // Featured: only show venues/events marked as featured
    state.filtered = state.filtered.filter(v => v.featured);
    state.filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
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
  if(typeof haptic==='function')haptic('light');
  state.sort = val;
  document.querySelectorAll('#sortFilters .pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  if (val === 'distance') {
    btn.innerHTML = `${ICN.pin} Locating…`;
    btn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      pos => {
        state.userLat = pos.coords.latitude;
        state.userLng = pos.coords.longitude;
        localStorage.setItem('spotd-location-granted', 'yes');
        localStorage.removeItem('spotd-location-deny-count');
        try { localStorage.setItem('spotd-user-location', JSON.stringify({ lat: state.userLat, lng: state.userLng })); } catch(e) {}
        btn.innerHTML = `${ICN.pin} Nearest`;
        btn.disabled = false;
        applyFilters();
      },
      err => {
        showToast('Location access denied — enable in browser settings');
        state.sort = 'default';
        btn.innerHTML = `${ICN.pin} Nearest`;
        btn.disabled = false;
        document.getElementById('sort-default')?.classList.add('active');
        btn.classList.remove('active');
      },
      { timeout: 8000 }
    );
  } else {
    applyFilters();
  }
}

function toggleFilters() {
  if(typeof haptic==='function')haptic('light');
  state.filtersOpen = !state.filtersOpen;
  document.getElementById('filterPanel').classList.toggle('open', state.filtersOpen);
  document.getElementById('filterToggle').classList.toggle('active', state.filtersOpen || !!(state.filters.day || state.filters.area || state.filters.type));
}

// ── CARDS ──────────────────────────────────────────────
let _renderCardsRaf = null;
function renderCards() {
  if (_renderCardsRaf) cancelAnimationFrame(_renderCardsRaf);
  _renderCardsRaf = requestAnimationFrame(_renderCardsNow);
}
// ═══════════════════════════════════════════════════════
// FEED REDESIGN — Mixed layout render pipeline
// Replaces: _renderCardsNow() and venueCardHTML()
// Keeps: renderCards(), eventCardHTML(), all helpers
// ═══════════════════════════════════════════════════════

function _renderCardsNow() {
  _renderCardsRaf = null;
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

  const items = state.filtered;
  const events = items.filter(v => v.event_type);
  const venues = items.filter(v => !v.event_type);

  // Split into tiers
  const heroes   = venues.filter(v => v.is_hero && (v.photo_url || (v.photo_urls && v.photo_urls.length)));
  const nonHeroes = venues.filter(v => !v.is_hero || !(v.photo_url || (v.photo_urls && v.photo_urls.length)));

  // Compact = next batch with photos (up to 6 venues = 3 rows of 2)
  const withPhoto    = nonHeroes.filter(v => v.photo_url || (v.photo_urls && v.photo_urls.length));
  const withoutPhoto = nonHeroes.filter(v => !(v.photo_url || (v.photo_urls && v.photo_urls.length)));

  const compactVenues = withPhoto.slice(0, 6);
  const standardVenues = withPhoto.slice(6).concat(withoutPhoto);

  let html = '';
  let delay = 0;

  // ── Hero cards ──
  if (heroes.length) {
    html += `<div class="feed-label">🔥 Hot right now</div>`;
    heroes.forEach(v => {
      html += heroCardHTML(v, delay);
      delay += 80;
    });
  }

  // ── Compact grid ──
  if (compactVenues.length) {
    html += `<div class="feed-label">${heroes.length ? 'Near you' : 'Today\'s happy hours'}</div>`;
    for (let i = 0; i < compactVenues.length; i += 2) {
      html += `<div class="card-compact-row">`;
      html += compactCardHTML(compactVenues[i], delay);
      delay += 60;
      if (compactVenues[i + 1]) {
        html += compactCardHTML(compactVenues[i + 1], delay);
        delay += 60;
      }
      html += `</div>`;
    }
  }

  // ── Standard rows ──
  if (standardVenues.length) {
    html += `<div class="feed-label">More spots</div>`;
    standardVenues.forEach(v => {
      html += standardCardHTML(v, delay);
      delay += 40;
    });
  }

  // ── Event cards (keep existing) ──
  if (events.length) {
    html += `<div class="feed-label">Events</div>`;
    events.forEach(v => { html += eventCardHTML(v); });
  }

  grid.innerHTML = html;

  // Attach delegated click handler once for reliable iOS taps
  if (!grid._cardDelegateAttached) {
    grid._cardDelegateAttached = true;
    grid.addEventListener('click', function(e) {
      if (e.target.closest('button')) return;
      const card = e.target.closest('.card-hero, .card-compact, .card-std, .card');
      if (!card) return;
      const id = card.dataset.id;
      if (id) openModal(id, card.classList.contains('card') && !card.classList.contains('card-std') ? 'event' : 'venue');
    });
  }
}

// ── LOCALS SAY ────────────────────────────────────────
async function loadTopDescriptions(venues) {
  if (!venues.length) return;
  const ids = venues.map(v => v.id);
  state.descCache = await fetchTopDescriptions(ids);
  renderCards();
}

function localsSaySnippet(venueId) {
  const d = state.descCache[venueId];
  if (!d) return '';
  const txt = d.description_text.length > 90 ? d.description_text.slice(0, 87) + '\u2026' : d.description_text;
  return '<div class="locals-say"><span class="locals-say-label">Locals say</span> <span class="locals-say-text">\u201C' + esc(txt) + '\u201D</span></div>';
}

function localsSayInline(venueId) {
  const d = state.descCache[venueId];
  if (!d) return '';
  const txt = d.description_text.length > 55 ? d.description_text.slice(0, 52) + '\u2026' : d.description_text;
  return '<div class="locals-say-inline"><span class="locals-say-label">Locals say</span> \u201C' + esc(txt) + '\u201D</div>';
}

async function loadModalDescriptions(venueId) {
  const [descs, myUpvotes] = await Promise.all([
    fetchVenueDescriptions(venueId),
    fetchMyUpvotedDescs(venueId),
  ]);
  const el = document.getElementById('locals-say-' + venueId);
  if (!el || !descs.length) return;
  el.innerHTML = '<div class="desc-list-section"><h3 class="desc-list-title">What people are saying</h3>' +
    descs.map(function(d) {
      const name = d.profiles?.display_name || 'Someone';
      const voted = myUpvotes.has(d.id);
      return '<div class="desc-card">' +
        '<div class="desc-card-text">\u201C' + esc(d.description_text) + '\u201D</div>' +
        '<div class="desc-card-meta"><span class="desc-card-author">' + esc(name) + '</span>' +
        '<span class="desc-card-time">' + fmtDate(d.created_at) + '</span></div>' +
        (d.tags && d.tags.length ? '<div class="desc-card-tags">' + d.tags.map(function(t) { return '<span class="desc-tag-sm">' + t + '</span>'; }).join('') + '</div>' : '') +
        '<button class="desc-upvote-btn' + (voted ? ' upvoted' : '') + '" onclick="doToggleUpvote(\'' + d.id + '\',this)">\uD83D\uDC4D <span>' + (d.upvotes || 0) + '</span></button>' +
        '</div>';
    }).join('') + '</div>';
}

async function doSubmitDescription(venueId) {
  if (!currentUser) { openAuth('signin'); return; }
  var ta = document.getElementById('descTextInput-' + venueId);
  if (!ta) return;
  var text = ta.value.trim();
  if (text.length < 10) { showToast('Write at least 10 characters'); return; }
  var selectedTags = [];
  document.querySelectorAll('#descTags-' + venueId + ' .desc-tag-pill.selected').forEach(function(b) {
    selectedTags.push(b.dataset.tag);
  });
  var result = await submitVenueDescription(venueId, text, selectedTags);
  if (result) {
    showToast('Thanks for sharing!');
    if (typeof haptic === 'function') haptic('medium');
    ta.value = '';
    document.getElementById('descCharCount-' + venueId).textContent = '0';
    document.querySelectorAll('#descTags-' + venueId + ' .selected').forEach(function(b) { b.classList.remove('selected'); });
    loadModalDescriptions(venueId);
    // Update cache
    state.descCache[venueId] = { description_text: text, profiles: { display_name: currentUser.user_metadata?.full_name || 'You' } };
    renderCards();
  } else {
    showToast('Could not save — try again');
  }
}

async function doToggleUpvote(descId, btn) {
  if (!currentUser) { openAuth('signin'); return; }
  var upvoted = await toggleDescUpvote(descId);
  var span = btn.querySelector('span');
  var count = parseInt(span.textContent) || 0;
  if (upvoted) {
    btn.classList.add('upvoted');
    span.textContent = count + 1;
  } else {
    btn.classList.remove('upvoted');
    span.textContent = Math.max(0, count - 1);
  }
  if (typeof haptic === 'function') haptic('light');
}

// ═══════════════════════════════════════
// HERO CARD
// ═══════════════════════════════════════
function heroCardHTML(v, delay) {
  const photoUrl = v.photo_url || (v.photo_urls && v.photo_urls[0]) || '';
  const cached   = state.reviewCache[v.id] || [];
  const avg      = avgFromList(cached);
  const faved    = isFavorite(v.id);
  const todayH   = getTodayHours(v);
  const count    = state.goingCounts[v.id] || 0;
  const isMeIn   = state.goingByMe.has(v.id);

  // Badges
  const badges = [];
  if (count >= 2)       badges.push(`<span class="badge badge-fire">🔥 ${count} going</span>`);
  if (v.has_sports_tv)  badges.push(`<span class="badge badge-sports">📺</span>`);
  if (v.owner_verified) badges.push(`<span class="badge badge-verified">✓</span>`);

  // Deals as glass pills (max 3)
  const deals = (v.deals || []).slice(0, 3).map(d =>
    `<span class="card-hero-deal">${esc(d)}</span>`
  ).join('');

  // Going tonight bar
  const goingBar = count > 0 ? `
    <div class="card-hero-going">
      <div class="card-hero-going-left">
        <div class="card-hero-going-avatars">${goingAvatars(v.id, count)}</div>
        ${count} ${count === 1 ? 'person' : 'people'} going tonight
      </div>
      <button class="card-hero-going-btn${isMeIn ? ' joined' : ''}"
        onclick="event.stopPropagation();doGoingTonight('${v.id}',this)">${isMeIn ? '✓ Going!' : '+ Join'}</button>
    </div>` : `
    <div class="card-hero-going">
      <div class="card-hero-going-left">Be the first one here tonight</div>
      <button class="card-hero-going-btn"
        onclick="event.stopPropagation();doGoingTonight('${v.id}',this)">+ Check In</button>
    </div>`;

  return `<div class="card-hero" data-id="${v.id}"
    onclick="openModal('${v.id}','venue')" style="animation-delay:${delay}ms">
    <img class="card-hero-img" src="${photoUrl}" alt="${esc(v.name)}" loading="eager"
      onerror="this.closest('.card-hero').style.background='linear-gradient(135deg,#2A1F14,#1A1208)';this.remove()">
    <div class="card-hero-overlay"></div>
    <button class="card-hero-fav${faved ? ' faved' : ''}"
      onclick="event.stopPropagation();doFavorite('${v.id}','venue',this);this.classList.toggle('faved');this.textContent=this.classList.contains('faved')?'★':'☆'">${faved ? '★' : '☆'}</button>
    <div class="card-hero-badges">${badges.join('')}</div>
    <div class="card-hero-info">
      <div class="card-hero-name">${esc(v.name)}</div>
      <div class="card-hero-meta">
        <span>${esc(v.neighborhood || '')}</span>
        <span class="dot"></span>
        <span>${esc(v.cuisine || '')}</span>
        ${todayH ? `<span class="dot"></span><span>${esc(todayH)}</span>` : ''}
        ${v.yelp_rating ? `<span class="dot"></span><span>★ ${v.yelp_rating}</span>` : avg > 0 ? `<span class="dot"></span><span>★ ${avg.toFixed(1)}</span>` : ''}
      </div>
      <div class="card-hero-deals">${deals}</div>
      ${localsSaySnippet(v.id)}
      ${goingBar}
    </div>
  </div>`;
}


// ═══════════════════════════════════════
// COMPACT CARD (2-up grid)
// ═══════════════════════════════════════
function compactCardHTML(v, delay) {
  const photoUrl = v.photo_url || (v.photo_urls && v.photo_urls[0]) || '';
  const cached   = state.reviewCache[v.id] || [];
  const avg      = avgFromList(cached);
  const faved    = isFavorite(v.id);
  const todayH   = getTodayHours(v);
  const count    = state.goingCounts[v.id] || 0;
  const deals    = (v.deals || []).slice(0, 2);

  // Badge
  let badge = '';
  if (v.has_sports_tv) badge = `<div class="card-compact-badge"><span class="badge badge-sports">📺 Sports</span></div>`;

  const dealsHtml = deals.length ? deals.map(d => `<div class="card-compact-deal">${esc(d)}</div>`).join('') : '';

  return `<div class="card-compact" data-id="${v.id}"
    onclick="openModal('${v.id}','venue')" style="animation-delay:${delay}ms">
    <img class="card-compact-img" src="${photoUrl}" alt="${esc(v.name)}" loading="lazy"
      onerror="this.closest('.card-compact').style.background='linear-gradient(135deg,#2A1F14,#1A1208)';this.remove()">
    <div class="card-compact-overlay"></div>
    <button class="card-compact-fav${faved ? ' faved' : ''}"
      onclick="event.stopPropagation();doFavorite('${v.id}','venue',this);this.classList.toggle('faved');this.textContent=this.classList.contains('faved')?'★':'☆'">${faved ? '★' : '☆'}</button>
    ${badge}
    <div class="card-compact-info">
      <div class="card-compact-name">${esc(v.name)}</div>
      <div class="card-compact-sub">${esc(v.cuisine || '')}${v.yelp_rating ? ` · ★ ${v.yelp_rating}` : avg > 0 ? ` · ★ ${avg.toFixed(1)}` : ''}${count > 0 ? ` · 🔥 ${count}` : ''}</div>
      ${dealsHtml}
      ${localsSayInline(v.id)}
    </div>
  </div>`;
}


// ═══════════════════════════════════════
// STANDARD CARD (horizontal row)
// ═══════════════════════════════════════
function standardCardHTML(v, delay) {
  const hasPhoto = !!(v.photo_url || (v.photo_urls && v.photo_urls.length));
  const photoUrl = v.photo_url || (v.photo_urls && v.photo_urls[0]) || '';
  const cached   = state.reviewCache[v.id] || [];
  const avg      = avgFromList(cached);
  const faved    = isFavorite(v.id);
  const todayH   = getTodayHours(v);
  const count    = state.goingCounts[v.id] || 0;
  const deals    = (v.deals || []).slice(0, 3);

  const photoEl = hasPhoto
    ? `<img class="card-std-img" src="${photoUrl}" alt="${esc(v.name)}" loading="lazy"
        onerror="this.outerHTML='<div class=\\'card-std-nophoto\\'>🍺</div>'">`
    : `<div class="card-std-nophoto">🍺</div>`;

  const yelpEl = v.yelp_rating ? `<div class="card-std-stars"><span class="s-lit">★</span> ${v.yelp_rating}${v.yelp_review_count ? `<span class="s-count">(${v.yelp_review_count})</span>` : ''}</div>` : '';
  const starsEl = yelpEl || `<div class="card-std-stars">${
    Array.from({length:5},(_,i) =>
      `<span class="${i < Math.round(avg) ? 's-lit' : 's-unlit'}">★</span>`
    ).join('')}<span class="s-count">(${cached.length || '—'})</span></div>`;

  return `<div class="card-std" data-id="${v.id}"
    onclick="openModal('${v.id}','venue')" style="animation-delay:${delay}ms">
    ${photoEl}
    <div class="card-std-body">
      <div class="card-std-name">${esc(v.name)}</div>
      <div class="card-std-meta">${esc(v.neighborhood || '')} · ${esc(v.cuisine || '')}${todayH ? ' · ' + esc(todayH) : ''}</div>
      ${deals.length ? deals.map(d => `<div class="card-std-deal">${esc(d)}</div>`).join('') : ''}
      ${localsSayInline(v.id)}
      ${count > 0 ? `<div class="card-std-going">🔥 ${count} going tonight</div>` : starsEl}
    </div>
    <button class="card-std-fav${faved ? ' faved' : ''}"
      onclick="event.stopPropagation();doFavorite('${v.id}','venue',this);this.classList.toggle('faved');this.textContent=this.classList.contains('faved')?'★':'☆'">${faved ? '★' : '☆'}</button>
  </div>`;
}


// ═══════════════════════════════════════
// SKELETON LOADING
// ═══════════════════════════════════════
function renderFeedSkeleton() {
  return `
    <div class="feed-label" style="opacity:0.3">Loading…</div>
    <div class="skel skel-hero"></div>
    <div class="skel-compact-row">
      <div class="skel skel-compact"></div>
      <div class="skel skel-compact"></div>
    </div>
    <div class="skel skel-std"></div>
    <div class="skel skel-std"></div>
    <div class="skel skel-std"></div>`;
}


// ═══════════════════════════════════════
// HELPER — avatar circles for going-tonight
// ═══════════════════════════════════════
function goingAvatars(venueId, count) {
  // Generate placeholder initials for the going-tonight avatars
  // In a future version, pull real profile data
  const initials = ['JK','TM','AL','SR','MK','LN','DP','RG'];
  const n = Math.min(count, 3);
  let html = '';
  for (let i = 0; i < n; i++) {
    html += `<span>${initials[i % initials.length]}</span>`;
  }
  if (count > 3) html += `<span>+${count - 3}</span>`;
  return html;
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
  if(typeof haptic==='function')haptic('light');
  const added = await toggleFavorite(itemId, itemType);
  btn.textContent = added ? '★' : '☆'; btn.classList.toggle('faved', added);
  showToast(added ? 'Saved ★' : 'Removed');
  if(added && typeof promptPushIfAppropriate==='function') promptPushIfAppropriate();
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
  if(typeof haptic==='function')haptic('light');
  state.activeItemId   = id;
  state.activeItemType = type;
  const items = type === 'venue' ? state.venues : state.events;
  const item  = items.find(x => String(x.id) === String(id));
  if (!item) return;
  track(type === 'event' ? 'event_modal_opened' : 'venue_modal_opened', { item_id: id });
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
  // Load UGC check-in photos + Locals Say descriptions
  if (type === 'venue') {
    fetchCheckinPhotos(id).then(photos => {
      const el = document.getElementById(`ugc-photos-${id}`);
      if (el) el.innerHTML = renderCheckinPhotos(photos, id);
    });
    loadModalDescriptions(id);
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
  const photos  = v.photo_urls?.length ? v.photo_urls : (v.photo_url ? [v.photo_url] : []);
  const photo   = photos[0] || '';
  const checkInCount = state.goingCounts[v.id] || 0;
  const isMeIn  = state.goingByMe.has(v.id);
  const cached  = state.reviewCache[v.id] || reviews || [];
  const avg     = avgFromList(cached);

  document.getElementById('modalContent').innerHTML = `
    ${photo ? `
    <div class="modal-hero-wrap" onclick="openPhotoLightbox('${esc(photo)}','${esc(v.name)}')">
      <img src="${esc(photo)}" alt="${esc(v.name)}" loading="lazy" onerror="this.closest('.modal-hero-wrap').style.background='linear-gradient(135deg,#2A1F14,#1A1208)';this.remove()">
      <div class="modal-hero-grad"></div>
      ${!isVenue ? `<div class="modal-hero-tag">${esc(v.event_type || 'Event')}</div>` : ''}
      <div class="modal-hero-name">${esc(v.name)}${v.owner_verified ? ' ✓' : ''}</div>
      <button class="modal-hero-fav${faved ? ' faved' : ''}" onclick="doFavorite('${v.id}','${type}',this)">${faved ? '★' : '☆'}</button>
    </div>` : `
    <div style="padding:16px 18px 0;display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
      <div>
        ${!isVenue ? `<div class="s-tag ev">${esc(v.event_type || 'Event')}</div>` : ''}
        <div class="s-name">${esc(v.name)}${v.owner_verified ? ' <span class="verified-badge verified-badge--modal">✓ Verified</span>' : ''}</div>
      </div>
      <button class="heart-btn heart-btn--lg${faved ? ' faved' : ''}" onclick="doFavorite('${v.id}','${type}',this)" style="margin-top:4px;flex-shrink:0">${faved ? '★' : '☆'}</button>
    </div>`}

    <div class="modal-actions-grid">
      <div class="modal-action primary" onclick="openVenueWebsite('${v.id}')">
        <span class="modal-action-icon">${icn('globe',20)}</span>
        <span class="modal-action-label">Website</span>
      </div>
      <div class="modal-action" onclick="goToMap('${v.id}')">
        <span class="modal-action-icon" style="background:var(--bg2);border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center">${icn('map',20)}</span>
        <span class="modal-action-label">Directions</span>
      </div>
      <div class="modal-action share" onclick="shareItem('${v.id}','${type}')">
        <span class="modal-action-icon">${icn('share',20)}</span>
        <span class="modal-action-label">Share</span>
      </div>
      ${currentUser ? `<div class="modal-action" onclick="dmOpenVenueSharePicker('${v.id}')">
        <span class="modal-action-icon" style="background:var(--bg2);border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center">${icn('comment',20)}</span>
        <span class="modal-action-label">Send</span>
      </div>` : `<div class="modal-action" onclick="openAuth('signin')">
        <span class="modal-action-icon" style="background:var(--bg2);border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center">${icn('bell',20)}</span>
        <span class="modal-action-label">Alerts</span>
      </div>`}
      ${isVenue ? `<div class="modal-action" onclick="openAddToList('${v.id}')">
        <span class="modal-action-icon" style="background:var(--bg2);border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center">${icn('bookmark',20)}</span>
        <span class="modal-action-label">Add to List</span>
      </div>` : ''}
    </div>

    ${isAdmin() && isVenue ? `<button class="admin-edit-btn" onclick="adminEditVenue('${v.id}')">✏️ Edit Venue</button>` : ''}

    <div class="modal-body-inner">
      <div class="modal-loc-row">
        <span class="modal-hood">${esc(v.neighborhood || '')}</span>
        ${v.neighborhood && v.address ? '<span class="modal-sep">·</span>' : ''}
        <span class="modal-addr">${ICN.pin} ${esc(v.address || '')}</span>
      </div>

      <div class="s-div"></div>
      <div class="modal-section-label">Schedule</div>
      <div class="modal-when">${esc(v.hours || '')}</div>
      <div class="s-days">${DAYS.map(d => `<span class="day-pill${(v.days || []).includes(d) ? (d === TODAY ? ' today' : ' on') : ''}">${d}</span>`).join('')}</div>

      ${isVenue ? `
        ${(() => { const tags = AMENITIES.filter(a => v[a.key]).map(a => `<span class="amenity-tag amenity-tag--${a.key}">${icn(a.icon,12)} ${a.label}</span>`).join(''); return tags ? `<div class="amenity-tags amenity-tags--modal" style="margin-top:10px">${tags}</div>` : ''; })()}
        <div class="s-div"></div>
        <div class="modal-section-label">Deals &amp; Specials</div>
        ${(v.deals || []).map(d => `<div class="modal-deal-item"><div class="modal-deal-arrow"></div>${esc(d)}</div>`).join('')}
        ${v.promo_code ? `
        <div class="modal-promo">
          <div class="modal-promo-inner" onclick="copyPromo('${esc(v.promo_code)}',this)">
            <div class="modal-promo-left">
              <span class="modal-promo-label">Promo Code</span>
              <span class="modal-promo-code">${esc(v.promo_code)}</span>
              ${v.promo_description ? `<span class="modal-promo-desc">${esc(v.promo_description)}</span>` : ''}
            </div>
            <span class="modal-promo-copy">${icn('copy',14)} Copy</span>
          </div>
        </div>` : ''}
        <div style="margin-top:4px;font-family:'DM Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">${esc(v.cuisine || '')}</div>
        ${(() => {
          const evs = state.events.filter(e => e.venue_name && v.name && e.venue_name.trim().toLowerCase() === v.name.trim().toLowerCase());
          if (!evs.length) return '';
          return `<div class="s-div"></div><div class="modal-section-label">Events at this venue</div>
          <div class="s-events-list">${evs.map(e => {
            const evToday = (e.days||[]).includes(TODAY);
            return `<div class="s-event-item">
              <div class="s-event-top">
                <span class="s-event-name">${esc(e.name||e.event_type)}</span>
                <span class="card-event-type">${esc(e.event_type||'')}</span>
                ${evToday ? `<span style="font-size:10px;color:var(--teal);font-weight:700">TONIGHT</span>` : ''}
              </div>
              <div class="s-event-meta">${(e.days||[]).join(', ')} · ${esc(e.hours||'')}${e.price && e.price !== 'Free' ? ` · ${esc(e.price)}` : ' · Free'}</div>
              ${e.description ? `<div class="s-event-desc">${esc(e.description)}</div>` : ''}
            </div>`;
          }).join('')}</div>`;
        })()}
        <div class="s-div"></div>
        <button class="modal-checkin-cta" onclick="doGoingTonight('${v.id}', this)">${checkInBtnLabel(checkInCount, isMeIn)}</button>
        ${checkInCount >= 2 ? `<div class="s-going-count">${ICN.fire} ${checkInCount} people checked in tonight</div>` : ''}
      ` : `
        <div class="s-div"></div>
        <div class="modal-section-label">About</div>
        <p style="font-size:14px;color:var(--muted);line-height:1.6">${esc(v.description || '')}</p>
        ${v.venue_name ? `<div style="margin-top:8px;font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">At ${esc(v.venue_name)}</div>` : ''}
        ${v.price ? `<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">Entry: ${esc(v.price)}</div>` : ''}
      `}

      ${isVenue ? `
        <div class="s-div"></div>
        <div id="locals-say-${v.id}"></div>
        <div class="desc-prompt-section" id="desc-prompt-${v.id}">
          <h3 class="desc-prompt-title">How would you describe ${esc(v.name)}?</h3>
          <p class="desc-prompt-subtitle">Help others know what to expect</p>
          <textarea id="descTextInput-${v.id}" class="desc-textarea" placeholder="e.g., great happy hour, strong pours, always a good crowd on Fridays..." maxlength="280" rows="3" oninput="document.getElementById('descCharCount-${v.id}').textContent=this.value.length"></textarea>
          <div class="desc-char-count"><span id="descCharCount-${v.id}">0</span>/280</div>
          <div class="desc-tags-row" id="descTags-${v.id}">
            ${['chill','hype','divey','bougie','date-night','group-friendly','late-night','craft-cocktails','cheap-drinks','dance-floor','hidden-gem','locals-only'].map(t =>
              '<button class="desc-tag-pill" data-tag="' + t + '" onclick="this.classList.toggle(\'selected\')">' + t + '</button>'
            ).join('')}
          </div>
          <button class="desc-submit-btn" onclick="doSubmitDescription('${v.id}')">Share</button>
        </div>
      ` : ''}

      ${isVenue ? `<div id="ugc-photos-${v.id}"></div>` : ''}
      <div class="s-div"></div>
      <div class="modal-section-label">Reviews</div>
      ${v.yelp_rating ? `<div class="modal-rating-summary">
        <div class="modal-rating-big">${v.yelp_rating}</div>
        <div class="modal-rating-detail">
          <div class="modal-rating-stars">${starHTML(v.yelp_rating, 5, 14)}</div>
          <div class="modal-rating-count">${v.yelp_review_count ? `${v.yelp_review_count.toLocaleString()} review${v.yelp_review_count !== 1 ? 's' : ''}` : ''}</div>
        </div>
      </div>` : cached.length ? `<div class="modal-rating-summary">
        <div class="modal-rating-big">${avg.toFixed(1)}</div>
        <div class="modal-rating-detail">
          <div class="modal-rating-stars">${starHTML(avg, 5, 14)}</div>
          <div class="modal-rating-count">${cached.length} review${cached.length !== 1 ? 's' : ''}</div>
        </div>
      </div>` : ''}
      <span id="ravg-${v.id}"></span>
      <div class="review-form">
        <div class="star-picker" id="sp-${v.id}" data-val="0">${[1,2,3,4,5].map(n => `<button class="sp" onclick="pickStar('${v.id}',${n})">★</button>`).join('')}</div>
        ${!currentUser ? `<p class="review-guest-note">Posting as guest — <button class="auth-switch-btn" onclick="openAuth('signin')">sign in</button> to manage reviews</p>` : ''}
        <input class="field" id="rname-${v.id}" type="text" value="${currentUser ? esc(currentUser.user_metadata?.full_name || '') : ''}" placeholder="Your name" ${currentUser ? 'style="display:none"' : ''} autocomplete="name">
        <textarea class="field" id="rtext-${v.id}" placeholder="How was it?" rows="3"></textarea>
        <button class="btn-submit" onclick="submitReview('${v.id}','${type}')">Post Review</button>
      </div>
      <div class="reviews-list" id="rlist-${v.id}">${reviews.length ? renderReviewList(reviews, v.id, type) : '<div class="no-reviews">Loading…</div>'}</div>
      ${v.yelp_rating ? '<div class="modal-yelp-attr">Some rating data provided by Yelp</div>' : ''}
    </div>`;
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
      </div>` : `<div class="review-acts"><button class="review-act" onclick="openReportMenu('review','${r.id}','${r.user_id}')">Report</button></div>`}
    </div>`;
  }).join('');
}

function pickStar(itemId, n) {
  if(typeof haptic==='function')haptic('light');
  const p = document.getElementById(`sp-${itemId}`);
  p.dataset.val = n;
  p.querySelectorAll('.sp').forEach((b, i) => b.classList.toggle('lit', i < n));
}
async function submitReview(itemId, type) {
  if(typeof haptic==='function')haptic('medium');
  const rating = parseInt(document.getElementById(`sp-${itemId}`).dataset.val || '0');
  if (!rating) { showToast('Pick a star rating first'); return; }
  const text      = document.getElementById(`rtext-${itemId}`)?.value.trim();
  const guestName = document.getElementById(`rname-${itemId}`)?.value.trim() || 'Anonymous';
  const { error } = await postReview({ itemId, itemType: type, rating, text, guestName });
  if (error) { showToast('Error: ' + error.message); return; }
  const p = document.getElementById(`sp-${itemId}`);
  p.dataset.val = '0'; p.querySelectorAll('.sp').forEach(b => b.classList.remove('lit'));
  const te = document.getElementById(`rtext-${itemId}`); if (te) te.value = '';
  await refreshReviews(itemId, type);
  showToast('Review posted!');
  if (typeof promptPushIfAppropriate === 'function') setTimeout(() => promptPushIfAppropriate(), 500);
}
function closeModal(e) { if (e && e.target !== document.getElementById('modalOverlay')) return; closeOverlay('modalOverlay'); }

function openVenueWebsite(id) {
  const all = [...state.venues, ...state.events];
  const v = all.find(x => String(x.id) === String(id));
  let url;
  if (v && v.url && v.url !== '#' && v.url.trim() !== '') {
    url = v.url;
  } else {
    const name = v ? v.name : '';
    const city = state.city?.name || 'San Diego';
    url = 'https://www.google.com/search?q=' + encodeURIComponent(name + ' ' + city);
  }
  // On native iOS, open in SFSafariViewController (in-app browser)
  if (window.spotdNative?.openBrowser) {
    window.spotdNative.openBrowser(url);
  } else {
    window.location.href = url;
  }
}

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
  if (error) { showToast('Error: ' + error.message); return; }
  delete state.reviewCache[`${type}-${itemId}`];
  closeOverlay('editOverlay');
  showToast('Review updated');
  if (state.activeItemId === itemId) refreshReviews(itemId, type);
}
async function doDeleteReview(reviewId, itemId, type) {
  if (!confirm('Delete this review?')) return;
  const error = await deleteReview(reviewId);
  if (error) { showToast('Error: ' + error.message); return; }
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
    <form id="authForm" onsubmit="event.preventDefault();doAuth('${mode}');" autocomplete="on">
    ${!si ? `<div class="field-group"><div class="field-label">Name</div><input class="field" id="aName" type="text" placeholder="Your name" autocomplete="name"></div>` : ''}
    <div class="field-group"><div class="field-label">Email</div><input class="field" id="aEmail" type="email" placeholder="you@example.com" autocomplete="${si ? 'username' : 'email'}"></div>
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
    <div class="field-group">
      <div class="field-label">Referral code <span style="font-weight:400;color:var(--muted)">(optional)</span></div>
      <input class="field" id="aReferral" type="text" maxlength="6" placeholder="e.g. SHANE7" autocapitalize="characters" autocorrect="off" spellcheck="false" value="${esc((typeof getPendingReferralCode==='function' ? getPendingReferralCode() : '') || '')}">
    </div>
    ` : ''}
    ${si ? `<button class="auth-forgot" onclick="doForgot()">Forgot password?</button>` : ''}
    <button class="btn-submit" id="authBtn" type="submit" style="width:100%;margin-top:4px">${si ? 'Sign In' : 'Create Account'}</button>
    </form>
    <div class="auth-divider"><span>or</span></div>
    <button class="btn-apple" onclick="doAppleSignIn()">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.51-3.23 0-1.44.64-2.2.45-3.06-.4C3.79 16.17 4.36 9.04 8.86 8.78c1.18.06 2 .7 2.7.73.98-.2 1.92-.77 2.98-.7 1.27.1 2.23.6 2.84 1.53-2.6 1.54-1.98 4.93.38 5.88-.46 1.2-.67 1.73-1.25 2.78-.85 1.5-2.04 3.37-3.46 3.28zM12.15 8.7c-.15-2.23 1.66-4.07 3.74-4.25.29 2.4-2.17 4.2-3.74 4.25z"/></svg>
      Continue with Apple
    </button>
    <button class="btn-google" onclick="doGoogleSignIn()">
      <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.0 24.0 0 0 0 0 21.56l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
      Continue with Google
    </button>
    <p class="auth-switch">${si ? "No account?" : 'Have an account?'} <button class="auth-switch-btn" onclick="renderAuth('${si ? 'signup' : 'signin'}')">${si ? 'Sign up free' : 'Sign in'}</button></p>
    <div class="auth-legal">By continuing, you agree to our <a href="#" onclick="event.preventDefault();event.stopPropagation();openLegalPage('terms')">Terms</a> and <a href="#" onclick="event.preventDefault();event.stopPropagation();openLegalPage('privacy')">Privacy Policy</a></div>`;
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
  if(typeof haptic==='function')haptic('medium');
  // Stash any referral code typed into the signup form before we kick off the API call
  if (mode === 'signup') {
    const refTyped = (document.getElementById('aReferral')?.value || '').trim();
    if (refTyped && typeof setPendingReferralCode === 'function') setPendingReferralCode(refTyped);
  }
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
      // Apply pending referral code (from URL ?ref= or form input)
      if (typeof applyPendingReferral === 'function') {
        try { await applyPendingReferral(currentUser.id); } catch(e) {}
      }
      // Persist the attribution selected during onboarding
      if (typeof applyPendingAttribution === 'function') {
        try { await applyPendingAttribution(currentUser.id); } catch(e) {}
      }
      // If they didn't already supply a referral code, ask politely.
      if (typeof maybeShowPostSignupReferralModal === 'function') {
        setTimeout(() => maybeShowPostSignupReferralModal(), 1200);
      }
    }
    closeOverlay('authOverlay');
    showToast(mode === 'signup' ? 'Account created!' : 'Welcome back!');
    track(mode === 'signup' ? 'signup_completed' : 'login', { method: 'email' });
  } catch(err) {
    showToast('Error: ' + (err.message || 'Something went wrong'));
    btn.disabled = false; btn.textContent = mode === 'signin' ? 'Sign In' : 'Create Account';
  }
}
async function doGoogleSignIn() {
  if(typeof haptic==='function')haptic('medium');
  track('login_attempt', { method: 'google' });
  const result = await authSignInWithGoogle();
  if (result.error) {
    showToast('Error: ' + result.error.message);
  }
  // Browser redirects to Google — no further action needed here
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
    showToast('Error: ' + error.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Forgot password?'; }
    return;
  }
  closeOverlay('authOverlay');
  showToast('Check your email for a reset link!');
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
    showToast('Error: ' + error.message);
    btn.disabled = false; btn.textContent = 'Update Password';
    return;
  }
  closeOverlay('authOverlay');
  // Clean URL
  window.history.replaceState({}, document.title, window.location.pathname);
  showToast("Password updated! You're signed in.");
}

// ── PROFILE ────────────────────────────────────────────
// ── PROFILE ─────────────────────────────────────────────
const BADGE_DEFS = {
  first_checkin:  { icon: 'pin',       label: 'First Check-in',        desc: 'Checked in for the first time' },
  regular:        { icon: 'medal',     label: 'Regular',               desc: 'Checked into the same spot 3+ times' },
  explorer:       { icon: 'compass',   label: 'Neighborhood Explorer', desc: 'Visited 5+ neighborhoods' },
  critic:         { icon: 'star',      label: 'Critic',                desc: 'Left 10+ reviews' },
  social:         { icon: 'handshake', label: 'Social Butterfly',      desc: 'Following 5+ people' },
  streak_4:       { icon: 'fire',      label: '4-Week Streak',         desc: 'Checked in 4 weeks in a row' },
  streak_8:       { icon: 'fire',      label: '8-Week Streak',         desc: 'Checked in 8 weeks in a row' },
  top_reviewer:   { icon: 'pen',       label: 'Top Reviewer',         desc: 'Left 25+ reviews' },
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
  closeProfileMenu();
}

function toggleProfileMenu(e) {
  e.stopPropagation();
  const dd = document.getElementById('pfDropdown');
  if (!dd) return;
  const isOpen = dd.classList.contains('pf-dropdown--open');
  if (isOpen) { closeProfileMenu(); return; }
  dd.classList.add('pf-dropdown--open');
  // Close on any outside click
  setTimeout(() => document.addEventListener('click', _closeMenuOnClick, { once: true }), 0);
}
function closeProfileMenu() {
  document.getElementById('pfDropdown')?.classList.remove('pf-dropdown--open');
  document.removeEventListener('click', _closeMenuOnClick);
}
function _closeMenuOnClick() { closeProfileMenu(); }

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
  setTimeout(() => { page.style.display = 'none'; }, 300);
}

async function renderProfile(user) {
  const areas = [...new Set([...state.venues, ...state.events].map(v => v.neighborhood).filter(Boolean))].sort();
  const [profile, myReviews, favItems, followed, checkIns, badges, following, followers] = await Promise.all([
    getProfile(user.id), fetchMyReviews(user.id), getFavoriteItems(user.id),
    getFollowedNeighborhoods(user.id), fetchAllCheckIns(user.id),
    getUserBadges(user.id), getFollowing(user.id), getFollowers(user.id),
  ]);

  let venueList = state.venues;
  if (!venueList.length && checkIns.length) {
    try { venueList = await fetchVenues('san-diego'); } catch(e) { venueList = []; }
  }
  const allItems     = [...venueList, ...state.events];
  const favIds       = new Set(favItems.map(f => String(f.item_id)));
  const favSpots     = allItems.filter(v => favIds.has(String(v.id)));
  const displayName  = profile?.display_name || user.user_metadata?.full_name || 'You';
  const totalVenues  = new Set(checkIns.map(c => c.venue_id)).size;
  const currentStreak = computeCurrentStreak(checkIns);

  const avatarUrl = profile?.avatar_url || '';
  const headerUrl = profile?.header_url || '';

  document.getElementById('profileContent').innerHTML = `
    <div class="pf-header">
      <img src="/spotd_logo_v5.png" alt="Spotd" class="header-logo-img" onerror="this.style.display='none'">
      <div class="pf-header-actions">
        <button class="pf-header-btn" onclick="closeProfile();openDmInbox()" title="Messages">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span class="social-notif-dot" id="pfDmBadge" style="display:none"></span>
        </button>
        <div class="pf-menu-anchor">
          <button class="pf-header-btn" onclick="toggleProfileMenu(event)" title="Menu" id="pfMenuBtn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
          </button>
          <div class="pf-dropdown" id="pfDropdown">
            <button class="pf-dropdown-item" id="themeToggleBtn" onclick="toggleTheme();closeProfileMenu()">
              ${document.documentElement.getAttribute('data-theme') === 'dark' ? icn('sun',16) : icn('moon',16)}
              <span>${document.documentElement.getAttribute('data-theme') === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
            </button>
            <button class="pf-dropdown-item" onclick="shareSpotd();closeProfileMenu()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              <span>Share Spotd</span>
            </button>
            <div class="pf-dropdown-sep"></div>
            <button class="pf-dropdown-item" onclick="pickProfilePhoto();closeProfileMenu()">
              ${icn('camera',16)}
              <span>Change Profile Photo</span>
            </button>
            <button class="pf-dropdown-item" onclick="pickHeaderPhoto();closeProfileMenu()">
              ${icn('camera',16)}
              <span>Change Header Photo</span>
            </button>
            <div class="pf-dropdown-sep"></div>
            <button class="pf-dropdown-item" onclick="openProfileSettings();closeProfileMenu()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              <span>Settings</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    ${headerUrl ? `
    <div class="pf-banner" onclick="pickHeaderPhoto()" id="myBannerHero">
      <img src="${esc(headerUrl)}" alt="Banner">
      <button class="pf-banner-edit" onclick="event.stopPropagation();pickHeaderPhoto()">
        ${icn('camera',13)}
      </button>
    </div>` : ''}

    <div class="pf-card${headerUrl ? ' pf-card--with-banner' : ''}">
      <div class="pf-avatar" id="myAvatar" onclick="pickProfilePhoto()">
        ${avatarUrl ? `<img src="${esc(avatarUrl)}" alt="Profile">` : initialsAvatar(displayName, 'initials-avatar--lg', profile?.avatar_emoji)}
        <div class="pf-avatar-cam">${icn('camera',11)}</div>
      </div>
      <div class="pf-name">${esc(displayName)}</div>
      ${profile?.bio
        ? `<div class="pf-bio">${esc(profile.bio)}</div>`
        : `<div class="pf-bio--empty" onclick="openProfileSettings()">+ add a bio</div>`}
      ${badges.length ? `<div class="pf-badges">${badges.map(b => {
        const def = BADGE_DEFS[b.badge_key] || {};
        return `<span class="pf-badge" onclick="showBadgeInfo('${b.badge_key}')">${icn(def.icon||'medal',16)} ${def.label||b.badge_key}</span>`;
      }).join('')}</div>` : ''}
    </div>
    <div class="pf-file-inputs">
      <input type="file" id="headerPhotoInput" accept="image/*" onchange="handleHeaderPhoto(this)">
      <input type="file" id="profilePhotoInput" accept="image/*" onchange="handleProfilePhoto(this)">
    </div>

    <div class="pf-stats">
      <div class="pf-stat" onclick="openActivityFeed()">
        <div class="pf-snum">${checkIns.length}</div>
        <div class="pf-slbl">Check-ins</div>
      </div>
      <div class="pf-stat">
        <div class="pf-snum">${myReviews.length}</div>
        <div class="pf-slbl">Reviews</div>
      </div>
      <div class="pf-stat" onclick="openFindPeople()">
        <div class="pf-snum" id="stat-following">${following.length}</div>
        <div class="pf-slbl">Following</div>
      </div>
      <div class="pf-stat" onclick="showFollowersList()">
        <div class="pf-snum" id="stat-followers">${followers.length}</div>
        <div class="pf-slbl">Followers</div>
      </div>
    </div>

    <!-- Giveaway tile -->
    <section class="giveaway-tile" id="giveawayTile">
      <div class="giveaway-tile__header">
        <span class="giveaway-tile__badge">$25 Weekly Giveaway</span>
        <span class="giveaway-tile__entries" id="giveawayEntryCount">…</span>
      </div>
      <div class="giveaway-tile__progress">
        <div class="giveaway-tile__row">
          <span>This week</span>
          <strong id="giveawayPersonalEntry">…</strong>
        </div>
        <div class="giveaway-tile__row">
          <span>Referral bonuses</span>
          <strong id="giveawayReferralBonus">+0</strong>
        </div>
        <div class="giveaway-tile__row">
          <span>Your code</span>
          <strong id="giveawayMyCode" class="giveaway-tile__code">—</strong>
        </div>
      </div>
      <p class="giveaway-tile__hint" id="giveawayHint">
        Check in, leave a review, or share a photo to enter this week.
      </p>
      <button class="giveaway-tile__cta" id="giveawayCTA" onclick="openReferralShareSheet()">Share my code</button>
      <button class="giveaway-tile__addcode" id="giveawayAddCode" onclick="openReferralCodeEntry()" style="display:none">
        Got referred? Add a code →
      </button>
    </section>

    ${!localStorage.getItem('spotd-idea-banner-dismissed') ? `
    <div class="pf-idea-banner" id="ideaBanner">
      <button class="pf-idea-close" onclick="dismissIdeaBanner()" title="Dismiss">&times;</button>
      <div class="pf-idea-text" onclick="openFeatureRequestForm()">
        <span style="font-size:15px">💡</span>
        <span>Have an idea for a feature? <strong>Let us know!</strong> We value our users' input. Or email <strong>support@spotd.biz</strong></span>
      </div>
    </div>` : ''}

    <div class="pf-tabs">
      <div class="pf-tabs-inner">
        <button class="pf-tab on" onclick="selectProfileTab('checkins',this)">Check-ins</button>
        <button class="pf-tab" onclick="selectProfileTab('reviews',this)">Reviews</button>
        <button class="pf-tab" onclick="selectProfileTab('saved',this)">Saved</button>
        <button class="pf-tab" onclick="selectProfileTab('lists',this)">Lists</button>
      </div>
    </div>

    <div class="pf-content">
      <div id="my-tab-checkins">
        ${checkIns.length ? checkIns.slice(0,30).map(c => {
          const v = allItems.find(x => String(x.id) === String(c.venue_id));
          return `<div class="pf-row"${v ? ` onclick="closeProfile();openModal('${c.venue_id}','venue')"` : ''}>
            <div class="pf-row-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            </div>
            <div class="pf-row-body">
              <div class="pf-row-name">${v ? esc(v.name) : esc(c.venue_name||'A spot')}</div>
              <div class="pf-row-meta">${c.neighborhood||''} · ${fmtDate(c.created_at||c.date)}</div>
            </div>
          </div>`;
        }).join('') : '<div class="pf-empty"><div class="pf-empty-icon">📍</div>No check-ins yet — go explore!</div>'}
      </div>

      <div id="my-tab-reviews" style="display:none">
        ${myReviews.length ? myReviews.map(r => {
          const item = allItems.find(x => String(x.id) === String(r.venue_id || r.event_id));
          const itype = r.venue_id ? 'venue' : 'event';
          return `<div class="pf-row">
            <div class="pf-row-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            </div>
            <div class="pf-row-body" style="flex:1">
              <div class="pf-row-name" onclick="closeProfile();openModal('${r.venue_id||r.event_id}','${itype}')" style="cursor:pointer">${item ? esc(item.name) : 'Unknown Spot'}</div>
              <div class="pf-row-meta">${starHTML(r.rating,5,11)} · ${fmtDate(r.created_at)}</div>
              ${r.text ? `<div class="pf-row-note">"${esc(r.text)}"</div>` : ''}
              <div class="review-acts">
                <button class="review-act" onclick="openEditReview('${r.id}','${r.venue_id||r.event_id}','${itype}',${r.rating},'${esc(r.text||'')}')">Edit</button>
                <button class="review-act del" onclick="doDeleteReview('${r.id}','${r.venue_id||r.event_id}','${itype}')">Delete</button>
              </div>
            </div>
          </div>`;
        }).join('') : '<div class="pf-empty"><div class="pf-empty-icon">⭐</div>No reviews yet</div>'}
      </div>

      <div id="my-tab-saved" style="display:none">
        ${favSpots.length ? favSpots.map(v =>
          `<div class="pf-row" onclick="closeProfile();openModal('${v.id}','${v.event_type?'event':'venue'}')">
            <div class="pf-row-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div class="pf-row-body">
              <div class="pf-row-name">${esc(v.name)}</div>
              <div class="pf-row-meta">${esc(v.neighborhood||'')} · ${esc(v.hours||'')}</div>
            </div>
          </div>`
        ).join('') : '<div class="pf-empty"><div class="pf-empty-icon">🔖</div>No saved spots yet — tap ★ on any venue</div>'}
      </div>

      <div id="my-tab-lists" style="display:none">
        <div style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:13px;color:var(--muted)">Your curated venue collections</span>
          <button class="list-create-btn" onclick="openCreateListForm()">+ New List</button>
        </div>
        <div id="myListsGrid"></div>
      </div>

      <div id="my-tab-hoods" style="display:none">
        <div style="margin-bottom:12px;font-size:13px;color:var(--muted);line-height:1.5">Follow neighborhoods to get notified when new deals are added.</div>
        ${areas.length ? `<div class="hood-grid">${areas.map(a =>
          `<button class="hood-pill${followed.includes(a) ? ' on' : ''}" onclick="toggleHood('${a.replace(/'/g,"\'")}',this)">${a}</button>`
        ).join('')}</div>` : '<div class="pf-empty">No neighborhoods found yet.</div>'}
      </div>
    </div>`;

  // Hydrate the giveaway tile after the profile HTML is in the DOM
  renderGiveawayTile().catch(() => {});
}

async function renderGiveawayTile() {
  const tile = document.getElementById('giveawayTile');
  if (!tile) return;
  if (!currentUser) { tile.style.display = 'none'; return; }

  try {
    const [entries, code, referred] = await Promise.all([
      getMyEntriesThisWeek(),
      getMyReferralCode(),
      typeof userHasReferrer === 'function' ? userHasReferrer(currentUser.id) : Promise.resolve(false),
    ]);

    const entryCountEl = document.getElementById('giveawayEntryCount');
    if (entryCountEl) {
      entryCountEl.textContent = `${entries.total} ${entries.total === 1 ? 'entry' : 'entries'}`;
    }
    const personalEl = document.getElementById('giveawayPersonalEntry');
    if (personalEl) {
      personalEl.textContent = entries.self > 0 ? '✓ Entered' : 'Not entered yet';
    }
    const referralEl = document.getElementById('giveawayReferralBonus');
    if (referralEl) referralEl.textContent = `+${entries.referral}`;

    const codeEl = document.getElementById('giveawayMyCode');
    if (codeEl) codeEl.textContent = code || '—';

    const hintEl = document.getElementById('giveawayHint');
    if (hintEl) {
      hintEl.textContent = entries.self === 0
        ? 'Check in, leave a review, or share a photo to enter this week.'
        : "You're entered. Invite friends — every active friend = +1 bonus entry.";
    }

    // Fallback link: only show if the user wasn't referred (i.e. didn't use a code)
    const addCodeEl = document.getElementById('giveawayAddCode');
    if (addCodeEl) addCodeEl.style.display = referred ? 'none' : 'block';
  } catch(e) {
    console.warn('renderGiveawayTile error', e);
  }
}

// ── POST-SIGNUP REFERRAL PROMPT ─────────────────────
// Shown once per user (tracked in localStorage), only if they have no
// referrer recorded. Same prompt is also reachable from the giveaway tile.
async function maybeShowPostSignupReferralModal() {
  if (!currentUser) return;
  if (localStorage.getItem('spotd-referral-prompt-seen')) return;
  try {
    if (typeof userHasReferrer === 'function' && await userHasReferrer(currentUser.id)) {
      localStorage.setItem('spotd-referral-prompt-seen', '1');
      return;
    }
  } catch(e) {}
  openReferralCodeEntry({ firstTime: true });
}

function openReferralCodeEntry(opts) {
  if (!currentUser) { openAuth('signin'); return; }
  // Avoid duplicate modals
  if (document.getElementById('referralCodeModal')) return;

  const firstTime = !!(opts && opts.firstTime);
  track('referral_modal_shown', { trigger: firstTime ? 'post_signup' : 'manual' });
  const overlay = document.createElement('div');
  overlay.id = 'referralCodeModal';
  overlay.className = 'ref-modal-overlay';
  overlay.innerHTML = `
    <div class="ref-modal" role="dialog" aria-modal="true" aria-labelledby="refModalTitle">
      <button class="ref-modal__close" aria-label="Close" onclick="closeReferralCodeEntry()">&times;</button>
      <div class="ref-modal__icon">🎁</div>
      <h2 class="ref-modal__title" id="refModalTitle">Did someone refer you?</h2>
      <p class="ref-modal__sub">
        Drop their 6-character code and they get a bonus weekly giveaway entry every time you check in,
        review, or post.
      </p>
      <div class="ref-modal__field">
        <input type="text" id="refModalInput" maxlength="6" placeholder="e.g. SHANE7"
               autocapitalize="characters" autocorrect="off" spellcheck="false" autocomplete="off"
               onkeydown="if(event.key==='Enter')submitReferralCodeEntry()">
      </div>
      <div class="ref-modal__msg" id="refModalMsg"></div>
      <button class="ref-modal__cta" id="refModalSubmit" onclick="submitReferralCodeEntry()">Apply code</button>
      <button class="ref-modal__skip" onclick="closeReferralCodeEntry(${firstTime ? 'true' : 'false'})">${firstTime ? 'No thanks, skip' : 'Cancel'}</button>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => {
    overlay.classList.add('ref-modal-overlay--open');
    document.getElementById('refModalInput')?.focus();
  }, 10);

  // Mark as seen so we don't auto-prompt again, even if they close it
  if (firstTime) {
    try { localStorage.setItem('spotd-referral-prompt-seen', '1'); } catch (e) {}
  }
}

function closeReferralCodeEntry() {
  const m = document.getElementById('referralCodeModal');
  if (!m) return;
  m.classList.remove('ref-modal-overlay--open');
  setTimeout(() => m.remove(), 200);
}

async function submitReferralCodeEntry() {
  const input = document.getElementById('refModalInput');
  const msg   = document.getElementById('refModalMsg');
  const btn   = document.getElementById('refModalSubmit');
  if (!input || !msg || !btn) return;
  const code = (input.value || '').trim().toUpperCase();
  msg.className = 'ref-modal__msg';
  msg.textContent = '';
  if (code.length !== 6) {
    msg.classList.add('ref-modal__msg--err');
    msg.textContent = 'Codes are 6 characters';
    return;
  }
  btn.disabled = true; btn.textContent = 'Applying…';
  const result = await applyReferralCodeManually(code);
  btn.disabled = false; btn.textContent = 'Apply code';
  if (!result.ok) {
    msg.classList.add('ref-modal__msg--err');
    msg.textContent = result.error || 'Could not apply that code';
    return;
  }
  msg.classList.add('ref-modal__msg--ok');
  msg.textContent = 'Locked in. Thanks for repping the source! 🎉';
  showToast('Referral applied');
  // Re-render the tile so the fallback link disappears
  if (typeof renderGiveawayTile === 'function') setTimeout(renderGiveawayTile, 200);
  setTimeout(closeReferralCodeEntry, 1100);
}

// ── GIVEAWAY BANNER + LANDING PAGE ──────────────────
const GIVEAWAY_BANNER_KEY = 'spotd-giveaway-banner-dismissed';

function maybeShowGiveawayBanner() {
  const banner = document.getElementById('giveawayBanner');
  if (!banner) return;
  if (localStorage.getItem(GIVEAWAY_BANNER_KEY)) { banner.style.display = 'none'; return; }
  banner.style.display = '';
}

function dismissGiveawayBanner() {
  try { localStorage.setItem(GIVEAWAY_BANNER_KEY, '1'); } catch (e) {}
  const banner = document.getElementById('giveawayBanner');
  if (banner) banner.style.display = 'none';
  if (typeof haptic === 'function') haptic('light');
  track('giveaway_banner_dismissed', {});
}

async function openGiveawayPage() {
  if (typeof haptic === 'function') haptic('light');
  track('giveaway_banner_clicked', {});
  openSubPage('giveawayPage');
  await renderGiveawayPage();
}

function _giveawayMonday(weekStart) {
  if (!weekStart) return '';
  try {
    const d = new Date(`${weekStart}T00:00:00`);
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  } catch (e) { return weekStart; }
}

async function renderGiveawayPage() {
  const wrap = document.getElementById('giveawayPageContent');
  if (!wrap) return;
  track('giveaway_page_viewed', { signed_in: !!currentUser });

  // Skeleton first so the page feels responsive
  wrap.innerHTML = `
    <div class="gw-page">
      <section class="gw-hero">
        <div class="gw-hero__kicker">$25 every Monday</div>
        <h1 class="gw-hero__title">Win a Spotd<br>Weekly Giveaway</h1>
        <p class="gw-hero__sub">A $25 gift card to any restaurant or bar on Spotd — your pick. One winner every Monday.</p>
      </section>
      <div id="giveawayPageStats" class="gw-stats-card">
        <div class="gw-stats-loading">Loading your entries…</div>
      </div>
      <section class="gw-section">
        <h2 class="gw-h2">How to enter</h2>
        <div class="gw-steps">
          <div class="gw-step"><div class="gw-step__num">1</div><div class="gw-step__body"><strong>Be active during the week.</strong> Do any of these once between Monday and Sunday and you're entered:
            <ul class="gw-step__list"><li>Check in at any venue</li><li>Leave a review</li><li>Share a photo or video in social</li></ul>
          </div></div>
          <div class="gw-step"><div class="gw-step__num">2</div><div class="gw-step__body"><strong>Stack the odds with referrals.</strong> Share your code. Every active friend = +1 entry every week they stay active.</div></div>
          <div class="gw-step"><div class="gw-step__num">3</div><div class="gw-step__body"><strong>Monday — winner picked.</strong> If you win, we'll email you to find out which Spotd restaurant or bar you want the $25 gift card for.</div></div>
        </div>
      </section>
      <section class="gw-section" id="giveawayPageWinnersSection" style="display:none">
        <h2 class="gw-h2">Recent winners</h2>
        <div id="giveawayPageWinners"></div>
      </section>
      <section class="gw-section">
        <h2 class="gw-h2">FAQ</h2>
        <details class="gw-faq"><summary>Can I enter more than once?</summary><p>Yes — through referrals. You get one personal entry per week regardless of how many things you do, but every friend who signs up with your code and stays active adds another entry to your name.</p></details>
        <details class="gw-faq"><summary>What counts as a check-in?</summary><p>Tapping "Check in" on a venue page. We allow one per venue per day so it stays honest.</p></details>
        <details class="gw-faq"><summary>How is the winner picked?</summary><p>Random draw, weighted by entries. Each entry = one ticket in the drawing. More entries = better odds.</p></details>
        <details class="gw-faq"><summary>What's the prize?</summary><p>A $25 gift card to any restaurant or bar currently listed on Spotd — winner picks the venue. We'll email you to confirm which one once you win.</p></details>
        <details class="gw-faq"><summary>What if the venue doesn't sell digital gift cards?</summary><p>Most places do, but if your pick doesn't, you can swap to a $25 digital DoorDash card (still food, still a vibe) or a $25 digital Visa card (universal — works almost anywhere). Same $25, same week, just a different format.</p></details>
        <details class="gw-faq"><summary>What if my favorite spot isn't on Spotd?</summary><p>We can only redeem at venues currently active on Spotd. If your top pick isn't on yet, suggest it via the "Add a spot" button — we add new venues regularly.</p></details>
        <details class="gw-faq"><summary>Do I have to be in San Diego?</summary><p>For now, yes. Spotd is San Diego-only at launch.</p></details>
      </section>
      <p class="gw-fineprint">No purchase necessary. Open to Spotd members 21+ with a valid US address. One entry per active week, plus referral bonuses. Winners announced Monday at 9 AM PT. Spotd reserves the right to disqualify suspicious activity.</p>
    </div>`;

  // Hydrate live stats
  const statsEl = document.getElementById('giveawayPageStats');
  if (statsEl) {
    if (!currentUser) {
      statsEl.innerHTML = `
        <div class="gw-stats-signedout">
          <div class="gw-stats-signedout__title">Make a free account to enter</div>
          <div class="gw-stats-signedout__sub">Takes 10 seconds. No credit card.</div>
          <button class="gw-cta-primary" onclick="closeSubPage('giveawayPage');openAuth('signup')">Create my account</button>
        </div>`;
    } else {
      try {
        const [entries, code, stats] = await Promise.all([
          getMyEntriesThisWeek(),
          getMyReferralCode(),
          typeof getMyReferralStats === 'function' ? getMyReferralStats() : Promise.resolve({ totalReferred: 0, activeThisWeek: 0 }),
        ]);
        const monday = _giveawayMonday(entries.weekStart);
        statsEl.innerHTML = `
          <div class="gw-stats-grid">
            <div class="gw-stat">
              <div class="gw-stat__num">${entries.total}</div>
              <div class="gw-stat__lbl">${entries.total === 1 ? 'entry' : 'entries'} this week</div>
            </div>
            <div class="gw-stat">
              <div class="gw-stat__num">+${entries.referral}</div>
              <div class="gw-stat__lbl">referral bonus</div>
            </div>
            <div class="gw-stat">
              <div class="gw-stat__num">${stats.totalReferred}</div>
              <div class="gw-stat__lbl">friends invited</div>
            </div>
          </div>
          <div class="gw-code-row">
            <div class="gw-code-row__label">Your referral code</div>
            <div class="gw-code-row__code">${esc(code || '—')}</div>
          </div>
          <button class="gw-cta-primary" onclick="openReferralShareSheet()">📤 Share my code</button>
          <p class="gw-stats-foot">${monday ? `Drawing for the week of ${esc(monday)}.` : ''} ${entries.self === 0 ? 'You’re not entered yet — check in, review, or post to lock in.' : 'You’re in. Good luck.'}</p>`;
      } catch (e) {
        statsEl.innerHTML = `<div class="gw-stats-loading">Could not load your entries.</div>`;
      }
    }
  }

  // Recent winners (public read)
  try {
    const { data: winners } = await db.from('giveaway_winners')
      .select('week_start, winner_user_id, winner_entry_count, total_entries, profiles(display_name, avatar_url)')
      .order('week_start', { ascending: false })
      .limit(5);
    if (winners && winners.length) {
      const sec = document.getElementById('giveawayPageWinnersSection');
      const list = document.getElementById('giveawayPageWinners');
      if (sec) sec.style.display = '';
      if (list) {
        list.innerHTML = winners.map(w => {
          const p = w.profiles || {};
          const initials = (p.display_name || '?').split(' ').map(x => x[0]).slice(0,2).join('').toUpperCase();
          const avatar = p.avatar_url
            ? `<img src="${esc(p.avatar_url)}" alt="">`
            : `<span class="gw-winner__initials">${esc(initials)}</span>`;
          return `
            <div class="gw-winner">
              <div class="gw-winner__avatar">${avatar}</div>
              <div class="gw-winner__body">
                <div class="gw-winner__name">${esc(p.display_name || 'A Spotd member')}</div>
                <div class="gw-winner__meta">Week of ${esc(_giveawayMonday(w.week_start))} · ${w.winner_entry_count} of ${w.total_entries} tickets</div>
              </div>
              <div class="gw-winner__prize">$25</div>
            </div>`;
        }).join('');
      }
    }
  } catch (e) { /* leave winners section hidden on error */ }
}

async function openReferralShareSheet() {
  if (!currentUser) { openAuth('signin'); return; }
  const code = await getMyReferralCode();
  if (!code) { showToast('Referral code not ready yet — try again in a moment'); return; }
  const link = `https://spotd.biz/?ref=${encodeURIComponent(code)}`;
  const text = `Find the best happy hours in San Diego with Spotd. Use my code ${code} or sign up here: ${link}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Join me on Spotd', text, url: link });
      track('referral_shared', { method: 'web_share' });
      return;
    }
  } catch(e) { /* user cancelled */ }
  try {
    await navigator.clipboard.writeText(link);
    showToast('Referral link copied');
    track('referral_shared', { method: 'clipboard' });
  } catch(e) {
    showToast(`Your code: ${code}`);
    track('referral_shared', { method: 'fallback_toast' });
  }
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
  overlay.className = 'overlay';
  overlay.onclick = e => { if (e.target === overlay) dismissOverlay(overlay); };

  const currentColor = document.getElementById('myBanner')?.style.getPropertyValue('--banner-color') || '#FF6B4A';

  overlay.innerHTML = `
    <div class="sheet">
      <div class="sheet-handle"></div>
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
        <div style="margin-top:10px;font-size:13px;color:var(--muted);text-align:center">
          Or email us directly at <a href="mailto:support@spotd.biz" style="color:var(--coral);font-weight:600;text-decoration:none">support@spotd.biz</a>
        </div>
      </div>

      <button onclick="authSignOut().then(()=>{dismissOverlay(this.closest('.overlay'));closeProfile();showHome();})"
        style="width:100%;margin-top:8px;padding:13px;border-radius:12px;border:1.5px solid #e53935;background:none;color:#e53935;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:700;cursor:pointer;">
        Sign Out
      </button>

      <div class="p-section" style="margin-top:24px;border-top:1px solid var(--border);padding-top:16px">
        <button onclick="doDeleteAccount().then(()=>dismissOverlay(this.closest('.overlay')))"
          style="width:100%;padding:13px;border-radius:12px;border:none;background:none;color:var(--muted);font-family:'DM Sans',sans-serif;font-size:13px;cursor:pointer;text-decoration:underline;">
          Delete Account
        </button>
      </div>

      <div style="text-align:center;margin-top:16px">
        <a href="#" onclick="event.preventDefault();openLegalPage('privacy')" style="font-size:12px;color:var(--muted)">Privacy Policy</a>
        <span style="color:var(--muted);font-size:12px"> · </span>
        <a href="#" onclick="event.preventDefault();openLegalPage('terms')" style="font-size:12px;color:var(--muted)">Terms of Service</a>
      </div>
    </div>`;

  // Pre-fill bio and toggles
  presentOverlay(overlay);
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
    const { error } = await db.from('feedback').insert({
      user_id: currentUser?.id || null,
      type,
      text,
      url: window.location.href,
      created_at: new Date().toISOString(),
    });
    if (error) { console.error('Feedback insert error:', error); showToast('❌ Could not send feedback'); }
    else {
      document.getElementById('pFeedbackType').value = '';
      document.getElementById('pFeedbackText').value = '';
      showToast('Feedback sent — thank you!');
    }
  } catch(e) {
    console.error('Feedback exception:', e);
    showToast('❌ Could not send feedback');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Send Feedback'; }
}

function dismissIdeaBanner() {
  localStorage.setItem('spotd-idea-banner-dismissed', '1');
  document.getElementById('ideaBanner')?.remove();
}

function openFeatureRequestForm() {
  const overlay = document.getElementById('authOverlay');
  document.getElementById('authContent').innerHTML = `
    <div class="auth-title">Share your idea</div>
    <p class="auth-sub">We'd love to hear what features you'd like to see in Spotd.</p>
    <div class="field-group"><div class="field-label">Your idea</div>
      <textarea class="field" id="featureText" placeholder="I wish Spotd could…" style="min-height:100px;resize:none;font-size:14px"></textarea>
    </div>
    <button class="btn-primary" id="featureSubmitBtn" onclick="submitFeatureRequest()" style="width:100%;padding:14px;margin-top:8px">Submit</button>
  `;
  openOverlay('authOverlay');
}

async function submitFeatureRequest() {
  const text = (document.getElementById('featureText')?.value || '').trim();
  if (!text) { showToast('Please describe your idea'); return; }
  const btn = document.getElementById('featureSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    const { error } = await db.from('feedback').insert({
      user_id: currentUser?.id || null,
      type: 'feature_request',
      text,
      url: window.location.href,
      created_at: new Date().toISOString(),
    });
    if (error) { console.error('Feature request insert error:', error); showToast('❌ Could not send — try again'); }
    else {
      closeOverlay('authOverlay');
      showToast('Thanks for your idea!');
    }
  } catch(e) {
    console.error('Feature request exception:', e);
    showToast('Could not send — try again');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Submit'; }
}

async function pickBannerColor(color, btn) {
  if(typeof haptic==='function')haptic('light');
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
  overlay.className = 'overlay';
  overlay.style.cssText = 'display:flex;align-items:center;justify-content:center;';
  overlay.onclick = e => { if (e.target === overlay) dismissOverlay(overlay); };
  overlay.innerHTML = `
    <div style="background:var(--card);border-radius:20px;padding:28px 24px;max-width:300px;width:90%;text-align:center;position:relative;">
      <button onclick="dismissOverlay(this.closest('.overlay'))" style="position:absolute;top:12px;right:16px;background:none;border:none;font-size:20px;cursor:pointer;color:var(--muted);">✕</button>
      <div style="margin-bottom:12px;">${icn(def.icon||'medal',48)}</div>
      <div style="font-size:18px;font-weight:800;margin-bottom:8px;">${def.label || badgeKey}</div>
      <div style="font-size:14px;color:var(--muted);line-height:1.5;">${def.desc || 'Badge earned on Spotd'}</div>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);font-size:12px;color:var(--muted);">${icn('trophy',14)} You've earned this badge!</div>
    </div>`;
  presentOverlay(overlay);
}

async function showFollowersList() {
  if (!currentUser) return;
  const content = document.getElementById('followersContent');
  content.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted)">Loading…</div>';
  openSubPage('followersPage');

  const followerRows = await getFollowers(currentUser.id);
  const followerIds  = (followerRows || []).map(r => r.follower_id || r).filter(Boolean);

  if (!followerIds.length) {
    content.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted)">No followers yet</div>';
    return;
  }
  const { data: profiles } = await db.from('profiles')
    .select('id, display_name, avatar_emoji, username').in('id', followerIds);
  content.innerHTML = (profiles || []).map(p => `
    <div style="display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--border);cursor:pointer;"
      onclick="closeSubPage('followersPage');openPublicProfile('${p.id}')">
      <div style="width:42px;height:42px;border-radius:50%;background:var(--bg2);display:flex;align-items:center;justify-content:center;flex-shrink:0;">${initialsAvatar(p.display_name, '', p.avatar_emoji, p.avatar_url)}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:14px;">${esc(p.display_name || 'Spotd User')}</div>
        ${p.username ? `<div style="font-size:12px;color:var(--muted);">@${esc(p.username)}</div>` : ''}
      </div>
      <div style="color:var(--muted);font-size:18px;">›</div>
    </div>`).join('') || '<div style="text-align:center;padding:32px;color:var(--muted)">No followers yet</div>';
}
function toggleAvatarPicker() {}
async function pickAvatar() {}
function pickProfilePhoto() {
  document.getElementById('profilePhotoInput')?.click();
}
function pickHeaderPhoto() {
  document.getElementById('headerPhotoInput')?.click();
}
async function handleProfilePhoto(input) {
  const file = input.files?.[0];
  if (!file || !currentUser) return;
  showToast('Uploading photo...');
  const url = await uploadProfilePhoto(file, currentUser.id, 'avatar');
  if (url) {
    document.getElementById('myAvatar').innerHTML = `<img src="${url}" alt="Profile" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
    showToast('Profile photo updated!');
  } else {
    showToast('Upload failed — try again');
  }
  input.value = '';
}
async function handleHeaderPhoto(input) {
  const file = input.files?.[0];
  if (!file || !currentUser) return;
  showToast('Uploading header...');
  const url = await uploadProfilePhoto(file, currentUser.id, 'header');
  if (url) {
    const hero = document.getElementById('myBannerHero');
    if (hero) hero.style.background = `url('${url}') center/cover no-repeat`;
    showToast('Header photo updated!');
  } else {
    showToast('Upload failed — try again');
  }
  input.value = '';
}
async function saveName() { const n = document.getElementById('pName').value.trim(); if (!n) return; if(typeof haptic==='function')haptic('medium'); await updateProfile(currentUser.id, { display_name: n }); showToast('Name saved'); }
async function saveBio() { const b = document.getElementById('pBio').value.trim(); if(typeof haptic==='function')haptic('medium'); await updateProfile(currentUser.id, { bio: b }); showToast('Bio saved'); }
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
  showToast(added ? `Following ${hood}` : `Unfollowed ${hood}`);
}

async function toggleHood(hood, btn) { if (!currentUser) return;
  if(typeof haptic==='function')haptic('light'); const added = await toggleNeighborhoodFollow(currentUser.id, hood); btn.classList.toggle('on', added); showToast(added ? `Following ${hood}` : `Unfollowed ${hood}`); }

// ── SOCIAL NOTIFICATIONS ──────────────────────────────
async function openSocialNotifications() {
  if (!currentUser) { openAuth('signin'); return; }
  const container = document.getElementById('socialFeedContent');
  container.innerHTML = '<div class="social-loading"><div class="social-spinner"></div></div>';

  // Mark as seen
  localStorage.setItem('spotd-notif-seen', new Date().toISOString());
  const dot = document.getElementById('socialNotifDot');
  if (dot) dot.style.display = 'none';

  const items = await fetchMyPostActivity(currentUser.id);
  if (!items.length) {
    container.innerHTML = `<div class="social-empty"><div class="social-empty-title">No notifications yet</div><div class="social-empty-sub">When people like or comment on your posts, you'll see it here</div></div>`;
    return;
  }

  container.innerHTML = `<div style="padding:12px 16px 8px;font-size:14px;font-weight:700;color:var(--text)">Activity</div>` +
    items.map(n => {
      const name = n.profile.display_name || 'Someone';
      const avatar = initialsAvatar(name, '', n.profile.avatar_emoji, n.profile.avatar_url);
      const time = fmtDate(n.created_at);
      if (n.type === 'like') {
        return `<div class="notif-row" onclick="showToast('${esc(name)} liked your post')">
          ${avatar}
          <div class="notif-body"><span class="notif-name">${esc(name)}</span> liked your post <span class="notif-time">${time}</span></div>
          <span class="notif-icon">${ICN.heartFill || '❤️'}</span>
        </div>`;
      } else {
        return `<div class="notif-row" onclick="showToast('${esc(name)}: ${esc(n.text?.slice(0,40) || '')}')">
          ${avatar}
          <div class="notif-body"><span class="notif-name">${esc(name)}</span> commented: "${esc((n.text || '').slice(0, 60))}" <span class="notif-time">${time}</span></div>
          <span class="notif-icon">${ICN.comment || '💬'}</span>
        </div>`;
      }
    }).join('') +
    `<div style="padding:16px;text-align:center"><button class="social-refresh-btn" style="width:auto;border-radius:12px;padding:8px 20px;font-size:12px;font-weight:600" onclick="loadSocialFeed()">Back to Feed</button></div>`;
}

// Check for unseen notifications and show dot
async function checkSocialNotifications() {
  if (!currentUser) return;
  try {
    const items = await fetchMyPostActivity(currentUser.id);
    if (!items.length) return;
    const lastSeen = localStorage.getItem('spotd-notif-seen');
    const unseenCount = lastSeen
      ? items.filter(n => new Date(n.created_at) > new Date(lastSeen)).length
      : items.length;
    const dot = document.getElementById('socialNotifDot');
    if (dot) dot.style.display = unseenCount > 0 ? '' : 'none';
  } catch(e) {}
}

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
      el.innerHTML = `<div class="pub-empty" style="padding-top:32px">Search above to find friends</div>`;
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
    <div class="feed-avatar" onclick="closeSubPage('findPeoplePage');openPublicProfile('${p.id}')" style="cursor:pointer">${initialsAvatar(p.display_name || 'Spotd User', '', p.avatar_emoji, p.avatar_url)}</div>
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
  if(typeof haptic==='function')haptic('light');
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
    showToast('Following!');
    await checkAndAwardBadges(currentUser.id);
  }
  refreshFollowStats();
}



// ── PROMO CODE COPY ───────────────────────────────────
function copyPromo(code, el) {
  if (typeof haptic === 'function') haptic('medium');
  navigator.clipboard.writeText(code).then(function() {
    var copyEl = el.querySelector('.modal-promo-copy');
    if (copyEl) { copyEl.innerHTML = '✓ Copied!'; setTimeout(function() { copyEl.innerHTML = icn('copy',14) + ' Copy'; }, 2000); }
    if (typeof showToast === 'function') showToast('Promo code copied!');
  }).catch(function() {
    if (typeof showToast === 'function') showToast('Tap and hold to copy: ' + code);
  });
}

// ── SHARE ──────────────────────────────────────────────
function shareItem(id, type) {
  if(typeof haptic==='function')haptic('light');
  const items = type === 'venue' ? state.venues : state.events;
  const v = items.find(x => String(x.id) === String(id)); if (!v) return;
  track(type === 'event' ? 'share_event' : 'share_venue', { item_id: id });
  const appUrl = 'https://apps.apple.com/us/app/spotd/id6760452388';
  const msg = type === 'venue'
    ? `Happy Hour at ${v.name}\n${v.neighborhood} — ${v.address}\n${v.hours}\n${(v.deals||[]).slice(0,2).join(' · ')}\n\nDownload Spotd: ${appUrl}`
    : `${v.event_type} at ${v.venue_name || v.name}\n${v.neighborhood} — ${v.address}\n${v.hours}\n\nDownload Spotd: ${appUrl}`;
  if (navigator.share) { navigator.share({ title: v.name, text: msg, url: appUrl }).catch(() => {}); }
  else { window.open(`sms:?body=${encodeURIComponent(msg)}`, '_blank'); }
}

// ── VIEW TOGGLE ────────────────────────────────────────
function toggleView() {
  if(typeof haptic==='function')haptic('light');
  const isMap = state.view === 'map'; state.view = isMap ? 'list' : 'map';
  track('view_toggled', { view: state.view });
  document.getElementById('listView').classList.toggle('active', state.view === 'list');
  document.getElementById('mapView').classList.toggle('active',  state.view === 'map');
  document.getElementById('viewIcon').textContent = state.view === 'map' ? 'List' : 'Map';
  document.getElementById('viewToggle').classList.toggle('map-active', state.view === 'map');
  if (state.view === 'map') {
    if (!state.map || !state._mapReady) initMap();
    setTimeout(() => {
      if (state.map) {
        state.map.invalidateSize();
        updateMapMarkers();
        buildMapSidebar();
        // Double invalidate to handle slow DOM reflow
        setTimeout(() => state.map && state.map.invalidateSize(), 300);
      }
    }, 100);
  }
}
function goToMap(id) { closeOverlay('modalOverlay'); if (state.view !== 'map') toggleView(); setTimeout(() => flyTo(id), 350); }

// ── MAP ────────────────────────────────────────────────
function initMap() {
  if (state.map) { state.map.remove(); state.map = null; }
  state._markerLayer = null;
  state._mapReady = false;
  const cityCenter = getCityCenter(state.city?.slug);
  try {
    const mapEl = document.getElementById('map');
    if (!mapEl) return;
    // Reset the container in case Leaflet left stale state
    mapEl.innerHTML = '';
    mapEl.style.height = '';
    const map = L.map('map', {
      center: cityCenter,
      zoom: 12,
      preferCanvas: true,
      zoomSnap: 0.5,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 120,
      inertia: true,
      inertiaDeceleration: 3400,
      inertiaMaxSpeed: 1500,
      easeLinearity: 0.2,
      fadeAnimation: true,
      zoomAnimation: true,
      markerZoomAnimation: true,
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
      updateWhenZooming: false,
      updateWhenIdle: true,
      keepBuffer: 4,
    }).addTo(map);
    state.map = map;
    state._mapReady = true;
  } catch(e) {
    console.warn('initMap failed, will retry on map open:', e);
    state.map = null;
    state._mapReady = false;
  }
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
  if (state._markerLayer) { state._markerLayer.clearLayers(); }
  else {
    state._markerLayer = L.markerClusterGroup({
      maxClusterRadius: 45,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      disableClusteringAtZoom: 17,
      animate: true,
      animateAddingMarkers: false,
      chunkedLoading: true,
      chunkInterval: 100,
      chunkDelay: 10,
    }).addTo(state.map);
  }
  state.markers = {};
  const markers = [];
  state.filtered.forEach(v => {
    if (!v.lat || !v.lng) return;
    const isEvent = !!v.event_type;
    const openToday = (v.days||[]).includes(TODAY);
    const bg = isEvent ? '#7C6FD8' : openToday ? '#FF6B4A' : '#9A8E82';
    const label = v.name.length > 16 ? v.name.slice(0, 15) + '\u2026' : v.name;
    const iconHtml = `<div class="map-pin-wrap"><div class="map-pin-dot" style="background:${bg};box-shadow:0 0 0 3px ${bg}22"></div><div class="map-pin-label" style="border-color:${bg}33;color:${bg}">${label}</div></div>`;
    const icon = L.divIcon({ className: '', html: iconHtml, iconSize: [10, 10], iconAnchor: [5, 5], popupAnchor: [0, -14] });
    const marker = L.marker([v.lat, v.lng], { icon });
    marker.bindPopup(popupHTML(v), { maxWidth: 260 });
    marker.on('click', () => hlMapCard(v.id));
    markers.push(marker);
    state.markers[v.id] = marker;
  });
  state._markerLayer.addLayers(markers);
  // Overlay check-in users on map
  loadMapCheckIns();
}

async function loadMapCheckIns() {
  if (!state.city || !state.map) return;
  var checkIns = await fetchTodayCheckInsWithProfiles(state.city.slug);
  if (!checkIns.length) return;

  // Group by venue
  var byVenue = {};
  checkIns.forEach(function(c) {
    if (!byVenue[c.venue_id]) byVenue[c.venue_id] = [];
    byVenue[c.venue_id].push(c);
  });

  // Remove old layer
  if (state._checkinMarkerLayer) {
    state.map.removeLayer(state._checkinMarkerLayer);
  }
  // Use MarkerCluster just like venue pins for proper clustering
  state._checkinMarkerLayer = L.markerClusterGroup({
    maxClusterRadius: 40,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    disableClusteringAtZoom: 17,
    animate: true,
    animateAddingMarkers: false,
    chunkedLoading: true,
    iconCreateFunction: function(cluster) {
      var count = cluster.getChildCount();
      return L.divIcon({
        className: '',
        html: '<div class="map-checkin-cluster-icon">' + count + '</div>',
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });
    }
  }).addTo(state.map);

  var markers = [];
  Object.keys(byVenue).forEach(function(venueId) {
    var venue = state.venues.find(function(v) { return String(v.id) === String(venueId); });
    if (!venue || !venue.lat || !venue.lng) return;
    var users = byVenue[venueId];
    var names = users.slice(0, 3).map(function(u) {
      return u.profiles?.display_name || 'Someone';
    });
    var label = names.join(', ');
    if (users.length > 3) label += ' +' + (users.length - 3);

    var avatarHtml = '<div class="map-checkin-cluster" title="' + label + '">';
    users.slice(0, 3).forEach(function(u, i) {
      var name = u.profiles?.display_name || '?';
      var initials = name.split(' ').map(function(w) { return w[0]; }).join('').toUpperCase().slice(0, 2);
      avatarHtml += '<div class="map-checkin-av" style="z-index:' + (3 - i) + '">' + initials + '</div>';
    });
    if (users.length > 3) {
      avatarHtml += '<div class="map-checkin-av map-checkin-more">+' + (users.length - 3) + '</div>';
    }
    avatarHtml += '</div>';

    var icon = L.divIcon({
      className: '',
      html: avatarHtml,
      iconSize: [users.length > 1 ? 60 : 28, 28],
      iconAnchor: [users.length > 1 ? 30 : 14, -8],
    });

    var marker = L.marker([venue.lat, venue.lng], { icon: icon, interactive: true });
    marker.bindPopup('<div style="font-size:13px;font-weight:600;color:var(--text)">' + label + '</div><div style="font-size:11px;color:var(--muted)">checked in at ' + esc(venue.name) + '</div>', { maxWidth: 200 });
    markers.push(marker);
  });
  state._checkinMarkerLayer.addLayers(markers);
}

function popupHTML(v) {
  return `<div class="popup-body"><div class="popup-name">${esc(v.name)}</div><div class="popup-hood">${esc(v.neighborhood||'')}</div><div class="popup-when">${esc(getTodayHours(v))}</div>${(v.deals||[]).slice(0,2).map(d=>`<div class="popup-deal">${esc(d)}</div>`).join('')}<div class="popup-actions"><button class="popup-btn" onclick="openModal('${v.id}','${v.event_type?'event':'venue'}')">Details</button><button class="popup-directions" onclick="getDirections(${v.lat},${v.lng},'${esc(v.name).replace(/'/g,"\\'")}')">Directions</button><button class="popup-share" onclick="shareItem('${v.id}','${v.event_type?'event':'venue'}')">Share</button></div></div>`;
}
function getDirections(lat, lng, name) {
  if(typeof haptic==='function')haptic('light');
  track('directions_clicked', { has_coords: !!(lat && lng) });
  const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  window.open(url, '_blank');
}
function flyTo(id) {
  const all = [...state.venues, ...state.events];
  const v   = all.find(x => String(x.id) === String(id));
  if (!v || !v.lat || !state.map) return;
  const marker = state.markers[id];
  if (marker && state._markerLayer && state._markerLayer.zoomToShowLayer) {
    state._markerLayer.zoomToShowLayer(marker, () => {
      setTimeout(() => marker.openPopup(), 300);
    });
  } else {
    state.map.flyTo([v.lat, v.lng], 17, { animate: true, duration: 1.1, easeLinearity: 0.15 });
    if (marker) setTimeout(() => marker.openPopup(), 900);
  }
  hlMapCard(id);
}
function hlMapCard(id) {
  document.querySelectorAll('.map-card').forEach(c => c.classList.toggle('highlighted', c.dataset.id == id));
  const c = document.querySelector(`.map-card[data-id="${id}"]`);
  if (c) c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function buildMapSidebar() {
  document.getElementById('mapCards').innerHTML = state.filtered.map(v => `<div class="map-card" data-id="${v.id}" onclick="flyTo('${v.id}')"><div class="map-card-name">${esc(v.name)}</div><div class="map-card-hood">${esc(v.neighborhood||'')}</div><div class="map-card-when">${esc(getTodayHours(v))}</div></div>`).join('');
}

// ── OVERLAY HELPERS ────────────────────────────────────
// Animate a dynamically created overlay into view (prevents flicker)
function presentOverlay(overlay) {
  overlay.classList.remove('open');
  document.body.appendChild(overlay);
  void overlay.offsetHeight;
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    const sheet = overlay.querySelector('.sheet');
    if (sheet) attachSwipeDismiss(sheet, overlay);
  });
}
function openOverlay(id)  {
  const el = document.getElementById(id); if (!el) return;
  // Ensure the sheet starts at translateY(100%) before animating in
  const sheet = el.querySelector('.sheet');
  if (sheet) {
    sheet.style.transition = 'none';
    sheet.style.transform = 'translateY(100%)';
  }
  // Force layout so the browser registers the starting state
  void el.offsetHeight;
  // Re-enable transitions and open
  if (sheet) {
    sheet.style.transition = '';
    sheet.style.transform = '';
  }
  requestAnimationFrame(() => {
    el.classList.add('open');
    const profileOpen = document.getElementById('profilePage')?.classList.contains('profile-page--open');
    if (!profileOpen) document.body.style.overflow = 'hidden';
    if (sheet) attachSwipeDismiss(sheet, id);
  });
}
function closeOverlay(id) {
  const el = document.getElementById(id); if (!el) return;
  el.classList.remove('open');
  // Delay body overflow restore until after the animation completes
  setTimeout(() => {
    if (!document.querySelector('.overlay.open')) document.body.style.overflow = '';
  }, 350);
}
function dismissOverlay(el) {
  if (!el) return;
  el.classList.remove('open');
  if (!document.querySelector('.overlay.open')) document.body.style.overflow = '';
  el.addEventListener('transitionend', () => el.remove(), { once: true });
  // Fallback in case transitionend never fires
  setTimeout(() => { if (el.parentNode) el.remove(); }, 500);
}

function attachSwipeDismiss(sheet, overlayId) {
  // Remove any previous listeners to avoid stacking
  if (sheet._swipeHandler) {
    sheet.removeEventListener('touchstart', sheet._swipeHandler, { passive: true });
    sheet.removeEventListener('touchmove',  sheet._swipeMoveHandler);
    sheet.removeEventListener('touchend',   sheet._swipeEndHandler);
  }

  let startY = 0, currentY = 0, dragging = false;
  const DISMISS_THRESHOLD = 100; // px needed to dismiss

  sheet._swipeHandler = (e) => {
    // Don't intercept touches on form fields (iOS needs native handling for focus/keyboard)
    if (e.target.closest('input, select, textarea')) return;
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
    if (dy < 0) { sheet.style.transform = 'translate3d(0,0,0)'; return; }
    e.preventDefault();
    sheet.style.transform = `translate3d(0,${dy}px,0)`;
  };

  sheet._swipeEndHandler = () => {
    if (!dragging) return;
    dragging = false;
    const dy = currentY - startY;

    if (dy > DISMISS_THRESHOLD) {
      sheet.style.transition = 'transform .28s cubic-bezier(.4,0,1,1)';
      sheet.style.transform = 'translate3d(0,100%,0)';
      setTimeout(() => {
        sheet.style.transition = '';
        sheet.style.transform = '';
        if (typeof overlayId === 'string') closeOverlay(overlayId);
        else dismissOverlay(overlayId);
      }, 300);
    } else {
      sheet.style.transition = 'transform .25s cubic-bezier(.2,.8,.4,1)';
      sheet.style.transform = '';
      setTimeout(() => { sheet.style.transition = ''; }, 260);
    }
  };

  sheet.addEventListener('touchstart', sheet._swipeHandler,     { passive: true });
  sheet.addEventListener('touchmove',  sheet._swipeMoveHandler, { passive: false });
  sheet.addEventListener('touchend',   sheet._swipeEndHandler,  { passive: true });
}

// ── UTILS ──────────────────────────────────────────────
function avgFromList(r)    { return r.length ? r.reduce((s,x) => s+x.rating, 0)/r.length : 0; }
function starHTML(rating, max=5, size=13) { return Array.from({length:max},(_,i)=>`<span style="font-size:${size}px;color:${i<Math.round(rating)?'var(--amber)':'var(--border2)'}">★</span>`).join(''); }
function fmtDate(iso)      { return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function showToast(msg)    { document.querySelectorAll('.toast').forEach(t=>t.remove()); const t=document.createElement('div'); t.className='toast'; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),2600); }
function shareSpotd() {
  if(typeof haptic==='function')haptic('light');
  const text = 'Check out Spotd — find the best happy hours, events & nightlife near you!';
  const url  = 'https://apps.apple.com/us/app/spotd/id6760452388';
  if (navigator.share) {
    navigator.share({ title: 'Spotd', text, url }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(url).then(() => showToast('Link copied!')).catch(() => {
      showToast('Link copied!');
    });
  }
}
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

    // Cards will be rendered after this returns — no extra renderCards() needed
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
    if(typeof haptic==='function')haptic('light');
    showToast('Check-in removed');
  } else {
    if (state.todayCheckInCount >= CHECK_IN_DAILY_LIMIT) {
      showToast(`You've hit the ${CHECK_IN_DAILY_LIMIT} check-in limit for today`);
      return;
    }
    // Update UI immediately — don't wait for DB
    state.goingByMe.add(venueId);
    state.todayCheckInCount++;
    state.goingCounts[venueId] = (state.goingCounts[venueId] || 0) + 1;
    if(typeof haptic==='function')haptic('medium');
    showToast('Checked in!');
    // Fire DB write and streak check in background
    addCheckIn({ userId: currentUser.id, venueId, citySlug: state.city.slug, date: today })
      .then(() => {
        checkStreakAfterCheckIn();
        // Refresh the giveaway tile if the profile is currently open
        if (typeof renderGiveawayTile === 'function' && document.getElementById('giveawayTile')) {
          renderGiveawayTile();
        }
      })
      .catch(() => {});
    setTimeout(() => maybeOpenPhotoCheckin(venueId), 600);
  }
  const count = state.goingCounts[venueId] || 0;
  const nowIn = state.goingByMe.has(venueId);
  if (btn) {
    btn.classList.toggle('going-active', nowIn);
    btn.classList.toggle('hot', nowIn || count >= 1);
    if (!nowIn && count < 1) btn.classList.remove('hot');
    btn.innerHTML = checkInBtnLabel(count, nowIn);
    // Trigger pop + ripple animation
    btn.classList.remove('checkin-anim');
    void btn.offsetWidth; // force reflow
    btn.classList.add('checkin-anim');
    setTimeout(() => btn.classList.remove('checkin-anim'), 500);
  }
  const badge = document.querySelector(`.card[data-id="${venueId}"] .fire-badge`);
  if (badge) {
    if (count >= 2) { badge.innerHTML = `${ICN.fire} ${count} here tonight`; badge.style.display = 'inline-flex'; }
    else badge.style.display = 'none';
  }
  refreshCheckInCounters();
}

function checkInBtnLabel(count, isIn) {
  if (isIn) return count > 1 ? `${ICN.pin} You + ${count - 1} here` : `${ICN.pin} You're here!`;
  if (state.todayCheckInCount >= CHECK_IN_DAILY_LIMIT) return `${icn('hand',14)} Limit reached for today`;
  return count > 0 ? `${ICN.fire} ${count} here — join?` : `${ICN.pin} Check In`;
}

function refreshCheckInCounters() {
  document.querySelectorAll('.going-btn, .vcard-checkin-btn, .modal-checkin-cta').forEach(btn => {
    const card = btn.closest('[data-id]');
    const vid = card?.dataset.id || btn.dataset.vid;
    if (!vid) return;
    const count = state.goingCounts[vid] || 0;
    const isIn = state.goingByMe.has(vid);
    btn.classList.toggle('going-active', isIn);
    btn.classList.toggle('hot', isIn || count >= 1);
    if (!isIn && count < 1) btn.classList.remove('hot');
    btn.innerHTML = checkInBtnLabel(count, isIn);
  });
}

function goingFireBadge(venueId) {
  const count = state.goingCounts[venueId] || 0;
  if (count < 2) return '';
  return `<span class="fire-badge">${ICN.fire} ${count} here tonight</span>`;
}

// ── PUBLIC PROFILE ──────────────────────────────────────
async function openPublicProfile(userId) {
  if (userId === currentUser?.id) { openProfile(); return; }
  document.getElementById('pubProfileContent').innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted)">Loading…</div>`;
  document.getElementById('pubProfileTitle').textContent = 'Profile';
  openSubPage('pubProfilePage');
  await renderPublicProfile(userId);
}

async function renderPublicProfile(userId) {
  const [profile, reviews, checkIns, badges, favItems, amIFollowing, following, followers] = await Promise.all([
    fetchPublicProfile(userId),
    fetchMyReviews(userId),
    fetchAllCheckIns(userId),
    getUserBadges(userId),
    getFavoriteItems(userId),
    currentUser ? isFollowing(currentUser.id, userId) : Promise.resolve(false),
    getFollowing(userId),
    getFollowers(userId),
  ]);

  if (!profile) {
    document.getElementById('pubProfileContent').innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted)">This profile is private.</div>`;
    return;
  }

  const allItems = [...state.venues, ...state.events];
  const favSpots = allItems.filter(v => new Set(favItems.map(f=>String(f.item_id))).has(String(v.id)));
  const recentCheckIns = checkIns.slice(0, 30);
  const reviewerName = reviews.length ? (reviews[0].name || null) : null;
  const displayName = profile.display_name || reviewerName || 'Spotd User';

  // Update header title
  document.getElementById('pubProfileTitle').textContent = displayName;

  const avatarUrl = profile.avatar_url || '';
  const headerUrl = profile.header_url || '';

  document.getElementById('pubProfileContent').innerHTML = `
    ${headerUrl ? `
    <div class="pf-banner">
      <img src="${esc(headerUrl)}" alt="Banner">
    </div>` : ''}

    <div class="pf-card${headerUrl ? ' pf-card--with-banner' : ''}">
      <div class="pf-avatar">
        ${avatarUrl ? `<img src="${esc(avatarUrl)}" alt="Profile">` : initialsAvatar(displayName, 'initials-avatar--lg', profile.avatar_emoji)}
      </div>
      <div class="pf-name">${esc(displayName)}</div>
      ${profile.username ? `<div style="font-size:13px;color:var(--muted);margin-bottom:4px">@${esc(profile.username)}</div>` : ''}
      ${profile.bio ? `<div class="pf-bio">${esc(profile.bio)}</div>` : ''}
      ${badges.length ? `<div class="pf-badges">${badges.map(b => {
        const def = BADGE_DEFS[b.badge_key] || {};
        return `<span class="pf-badge">${icn(def.icon||'medal',16)} ${def.label||b.badge_key}</span>`;
      }).join('')}</div>` : ''}
    </div>

    <div class="pf-stats">
      <div class="pf-stat">
        <div class="pf-snum">${checkIns.length}</div>
        <div class="pf-slbl">Check-ins</div>
      </div>
      <div class="pf-stat">
        <div class="pf-snum">${reviews.length}</div>
        <div class="pf-slbl">Reviews</div>
      </div>
      <div class="pf-stat">
        <div class="pf-snum">${following.length}</div>
        <div class="pf-slbl">Following</div>
      </div>
      <div class="pf-stat">
        <div class="pf-snum">${followers.length}</div>
        <div class="pf-slbl">Followers</div>
      </div>
    </div>

    ${currentUser && currentUser.id !== userId ? `
    <div style="display:flex;gap:10px;padding:0 16px 16px">
      <button class="pub-follow-btn ${amIFollowing ? 'following' : ''}" id="pub-follow-btn"
        onclick="toggleFollowUser('${userId}', this)" style="flex:1">
        ${amIFollowing ? '✓ Following' : '+ Follow'}
      </button>
      <button class="pub-follow-btn" onclick="dmOpenFromProfile('${userId}', '${esc(displayName)}')" style="flex:1;background:transparent;color:var(--coral);border:1.5px solid var(--coral)">
        ${ICN.comment} Message
      </button>
    </div>` : ''}

    <div class="pf-tabs" id="pub-pf-tabs">
      <div class="pf-tabs-inner">
        <button class="pf-tab on" onclick="switchPubTab('checkins', this)">Check-ins</button>
        <button class="pf-tab" onclick="switchPubTab('reviews', this)">Reviews</button>
        <button class="pf-tab" onclick="switchPubTab('favorites', this)">Saved</button>
      </div>
    </div>

    <div class="pf-content">
      <div id="pub-tab-checkins">
        ${recentCheckIns.length ? recentCheckIns.map(c => {
          const v = allItems.find(x => String(x.id) === String(c.venue_id));
          return `<div class="pf-row"${v ? ` onclick="closeSubPage('pubProfilePage');openModal('${c.venue_id}','venue')"` : ''}>
            <div class="pf-row-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            </div>
            <div class="pf-row-body">
              <div class="pf-row-name">${v ? esc(v.name) : esc(c.venue_name || 'A spot')}</div>
              <div class="pf-row-meta">${c.neighborhood || ''} · ${fmtDate(c.created_at || c.date)}</div>
              ${c.note ? `<div class="pf-row-note">"${esc(c.note)}"</div>` : ''}
            </div>
          </div>`;
        }).join('') : '<div class="pf-empty"><div class="pf-empty-icon">📍</div>No check-ins yet</div>'}
      </div>
      <div id="pub-tab-reviews" style="display:none">
        ${reviews.length ? reviews.map(r => {
          const item = allItems.find(x => String(x.id) === String(r.venue_id || r.event_id));
          return `<div class="pf-row"${item ? ` onclick="closeSubPage('pubProfilePage');openModal('${r.venue_id||r.event_id}','${r.venue_id?'venue':'event'}')"` : ''}>
            <div class="pf-row-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            </div>
            <div class="pf-row-body">
              <div class="pf-row-name">${item ? esc(item.name) : 'A spot'}</div>
              <div class="pf-row-meta">${starHTML(r.rating,5,11)} · ${fmtDate(r.created_at)}</div>
              ${r.text ? `<div class="pf-row-note">"${esc(r.text)}"</div>` : ''}
            </div>
          </div>`;
        }).join('') : '<div class="pf-empty"><div class="pf-empty-icon">⭐</div>No reviews yet</div>'}
      </div>
      <div id="pub-tab-favorites" style="display:none">
        ${favSpots.length ? favSpots.map(v => `
          <div class="pf-row" onclick="closeSubPage('pubProfilePage');openModal('${v.id}','${v.event_type?'event':'venue'}')">
            <div class="pf-row-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div class="pf-row-body">
              <div class="pf-row-name">${esc(v.name)}</div>
              <div class="pf-row-meta">${esc(v.neighborhood||'')} · ${esc(v.hours||'')}</div>
            </div>
          </div>`).join('') : '<div class="pf-empty"><div class="pf-empty-icon">🔖</div>No saved spots</div>'}
      </div>
    </div>`;
}

function switchPubTab(tab, btn) {
  if(typeof haptic==='function')haptic('light');
  const tabs = document.getElementById('pub-pf-tabs');
  if (!tabs) return;
  // Hide all tab content within the pub profile
  ['checkins','reviews','favorites'].forEach(t => {
    const el = document.getElementById('pub-tab-' + t);
    if (el) el.style.display = 'none';
  });
  document.getElementById('pub-tab-' + tab).style.display = 'block';
  tabs.querySelectorAll('.pf-tab').forEach(b => b.classList.remove('on'));
  if (btn) btn.classList.add('on');
}

async function toggleFollowUser(userId, btn) {
  if (!currentUser) { openAuth('signin'); return; }
  if(typeof haptic==='function')haptic('light');
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
    showToast('Following!');
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
          <div style="margin-bottom:12px">${icn('wave',32)}</div>
          <div style="font-weight:600;margin-bottom:8px">No activity yet</div>
          <div style="color:var(--muted);font-size:13px">Follow people to see their check-ins & reviews here</div>
          <button class="profile-action-btn" style="margin-top:16px;max-width:180px" onclick="closeSubPage('feedPage');openFindPeople()">${ICN.search} Find People</button>
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
    profileMap[currentUser.id] = { display_name: 'You' };
  }

  if (!activities.length) {
    document.getElementById('feedRows').innerHTML = `<div class="pub-empty">No activity yet</div>`;
    return;
  }

  const activityLabel = (a) => {
    if (a.activity_type === 'check_in') return 'checked in at <strong>' + esc(a.venue_name||'a spot') + '</strong>';
    if (a.activity_type === 'review') return 'reviewed <strong>' + esc(a.venue_name||'a spot') + '</strong>';
    if (a.activity_type === 'favorite') return 'saved <strong>' + esc(a.venue_name||'a spot') + '</strong>';
    if (a.activity_type === 'badge') { const def = BADGE_DEFS[a.meta?.badge_key]||{}; return 'earned ' + icn(def.icon||'medal',14) + ' <strong>' + (def.label||'a badge') + '</strong>'; }
    return 'was active';
  };

  document.getElementById('feedRows').innerHTML = activities.map(a => {
    const p = profileMap[a.user_id] || {};
    const isMe = a.user_id === currentUser.id;
    const name = isMe ? 'You' : (p.display_name || 'Someone');
    const feedAvatarHtml = initialsAvatar(name, '', p.avatar_emoji, p.avatar_url);
    const venue = a.venue_id ? allItems.find(x => String(x.id) === String(a.venue_id)) : null;
    const clickable = !!venue;
    const venueClick = clickable ? ' onclick="closeSubPage(\'feedPage\');openModal(\''+a.venue_id+'\',\'venue\')"' : '';
    const avatarClick = !isMe ? ' onclick="event.stopPropagation();closeSubPage(\'feedPage\');openPublicProfile(\''+a.user_id+'\')"' : '';
    const nameClick   = !isMe ? ' onclick="event.stopPropagation();closeSubPage(\'feedPage\');openPublicProfile(\''+a.user_id+'\')"' : '';
    return '<div class="feed-row' + (clickable ? ' feed-row--link' : '') + '"' + venueClick + '>'
      + '<div class="feed-avatar' + (!isMe ? ' feed-avatar--link' : '') + '"' + avatarClick + '>' + feedAvatarHtml + '</div>'
      + '<div class="feed-body">'
      + '<div class="feed-text"><span class="feed-name' + (!isMe ? ' feed-name--link' : '') + '"' + nameClick + '>' + esc(name) + '</span> ' + activityLabel(a) + '</div>'
      + '<div class="feed-meta">' + (a.neighborhood ? ICN.pin + ' ' + esc(a.neighborhood) + ' · ' : '') + fmtDate(a.created_at) + '</div>'
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
      '<div class="s-name" style="font-size:20px;margin-bottom:4px">' + icn('trophy',20) + ' Leaderboard</div>'
      + '<div style="color:var(--muted);font-size:13px;margin-bottom:20px">' + monthName + ' · Most check-ins in ' + (state.city?.name || 'your city') + '</div>'
      + (!ranked.length ? '<div class="pub-empty">No check-ins yet this month — be first!</div>'
      : ranked.map((u, i) => {
          const p = profileMap[u.uid] || {};
          const isMe = u.uid === currentUser?.id;
          const lbClick = !isMe ? ' onclick="closeSubPage(\'leaderboardPage\');openPublicProfile(\''+u.uid+'\')" style="cursor:pointer"' : '';
          return '<div class="leaderboard-row"' + lbClick + '>'
            + '<div class="lb-rank">' + (medals[i] || '#' + (i+1)) + '</div>'
            + '<div class="lb-avatar">' + initialsAvatar(isMe ? 'You' : (p.display_name || 'Spotd User'), '', p.avatar_emoji, p.avatar_url) + '</div>'
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
    msg.textContent = 'Something went wrong. Please try again.';
    return;
  }

  document.getElementById('requestContent').innerHTML = `
    <div style="text-align:center;padding:32px 16px">
      <div style="margin-bottom:16px">${icn('party',48)}</div>
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
  const milestones = { 2:'2 weeks in a row', 3:'3-week streak', 4:'4-week streak', 8:'8-week streak' };
  const label = milestones[streak] || (streak % 4 === 0 ? `${streak}-week streak!` : null);
  if (!label) return;

  // Remove any existing banner
  document.querySelectorAll('.streak-banner').forEach(b => b.remove());
  const banner = document.createElement('div');
  banner.className = 'streak-banner';
  banner.innerHTML = `${ICN.fire} ${label} — you're on a roll!`;
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
    btn.innerHTML = '<span class="s-btn-icon">' + ICN.bell + '</span>';
    showToast(`Unfollowed ${venueName}`);
  } else {
    await followVenue(currentUser.id, venueId);
    btn.classList.add('following');
    btn.innerHTML = '<span class="s-btn-icon">' + ICN.bell + '</span>';
    showToast(`Following ${venueName} — you'll be notified of new deals`);
  }
  btn.disabled = false;
}

// ── TAG A FRIEND ────────────────────────────────────────
async function maybeOpenTagFriends(venueId) {
  if (!currentUser) { _tryPushPromptAfterCheckin(); return; }
  // Only show if user follows at least one person
  const followingIds = await getFollowing(currentUser.id);
  if (!followingIds.length) { _tryPushPromptAfterCheckin(); return; }
  const venue = state.venues.find(x => String(x.id) === String(venueId));
  openTagFriends(venueId, venue?.name || 'this spot', followingIds);
}

// Show the push opt-in after the entire check-in flow (photo → tag) finishes
function _tryPushPromptAfterCheckin() {
  if (typeof promptPushIfAppropriate === 'function') {
    setTimeout(() => promptPushIfAppropriate(), 500);
  }
}

async function openTagFriends(venueId, venueName, followingIds) {
  const el = document.getElementById('tagFriendsContent');
  if (!el) return;

  el.innerHTML = `<div class="tag-prompt-title">Who'd you go with?</div>
    <div class="tag-prompt-sub">Tag a friend at ${esc(venueName)} and they'll see it in their feed.</div>
    <div class="tag-friends-grid" id="tagFriendsGrid">
      <div style="color:var(--muted);font-size:13px">Loading friends…</div>
    </div>
    <button class="tag-skip-btn" onclick="closeOverlay('tagFriendsOverlay'); _tryPushPromptAfterCheckin()">Skip</button>`;

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
        <span class="tag-friend-chip-avatar">${initialsAvatar(p.display_name || 'Friend', '', p.avatar_emoji, p.avatar_url)}</span>
        <span class="tag-friend-chip-name">${esc(p.display_name || 'Friend')}</span>
      </button>`).join('');
  } catch(e) {
    const grid = document.getElementById('tagFriendsGrid');
    if (grid) grid.innerHTML = `<div style="color:var(--muted);font-size:13px">Couldn't load friends right now.</div>`;
  }
}

async function tagFriend(toUserId, toName, venueId, venueName, chip) {
  if(typeof haptic==='function')haptic('light');
  if (chip.classList.contains('tagged')) return; // already tagged
  chip.classList.add('tagged');
  chip.style.pointerEvents = 'none';
  await tagFriendAtCheckIn(currentUser.id, toUserId, venueId, venueName);
  showToast(`Tagged ${toName} at ${venueName}`);
  // Close overlay after a brief moment so user sees the chip light up
  setTimeout(() => { closeOverlay('tagFriendsOverlay'); _tryPushPromptAfterCheckin(); }, 900);
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
      <div class="ugc-photos-label">${ICN.camera} From the crowd <span style="font-weight:400;font-size:10px">${photos.length} photo${photos.length !== 1 ? 's' : ''}</span></div>
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
    // No user — skip photo and tag friends entirely
    return;
  }
  const venue = state.venues.find(x => String(x.id) === String(venueId));
  openPhotoCheckinPrompt(venueId, venue?.name || 'this spot');
}

// ── PHOTO CHECK-IN — Capacitor Camera plugin ──────────
// Uses @capacitor/camera on native iOS/Android — no WKWebView file input hacks.
// Falls back to a plain file input when running in browser (dev/testing).

function _isCapacitorNative() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

// Convert a base64 data string + mime type into a File object
// (uploadCheckinPhoto expects a File — this keeps db.js unchanged)
function _base64ToFile(base64Data, mimeType, fileName) {
  const byteString = atob(base64Data);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
  return new File([ab], fileName, { type: mimeType });
}

// Show the preview once we have a data URL (shared by both native and web paths)
function _showPhotoPreview(dataUrl) {
  const wrap = document.getElementById('photoPreviewWrap');
  const img  = document.getElementById('photoPreviewImg');
  const area = document.getElementById('photoUploadArea');
  const btn  = document.getElementById('photoSubmitBtn');
  if (img)  img.src = dataUrl;
  if (wrap) wrap.style.display = 'block';
  if (area) area.style.display = 'none';
  if (btn)  btn.disabled = false;
}

// Take photo using Capacitor Camera plugin (native path)
async function _capacitorTakePhoto() {
  try {
    const { Camera, CameraResultType, CameraSource } = window.Capacitor.Plugins;
    const image = await Camera.getPhoto({
      quality:      90,
      allowEditing: false,
      resultType:   CameraResultType.Base64,
      source:       CameraSource.Camera,
    });
    const mime = 'image/jpeg';
    const file = _base64ToFile(image.base64String, mime, `checkin-${Date.now()}.jpg`);
    window._pendingCheckinPhoto = file;
    _showPhotoPreview(`data:${mime};base64,${image.base64String}`);
  } catch(e) {
    if (e.message === 'User cancelled photos app') return;
    console.error('[Photo] Camera error, falling back to file input:', e);
    _fallbackToFileInput();
  }
}

// Choose from library using Capacitor Camera plugin (native path)
async function _capacitorChoosePhoto() {
  try {
    const { Camera, CameraResultType, CameraSource } = window.Capacitor.Plugins;
    const image = await Camera.getPhoto({
      quality:      90,
      allowEditing: false,
      resultType:   CameraResultType.Base64,
      source:       CameraSource.Photos,
    });
    const mime = 'image/jpeg';
    const file = _base64ToFile(image.base64String, mime, `checkin-${Date.now()}.jpg`);
    window._pendingCheckinPhoto = file;
    _showPhotoPreview(`data:${mime};base64,${image.base64String}`);
  } catch(e) {
    if (e.message === 'User cancelled photos app') return;
    console.error('[Photo] Library error, falling back to file input:', e);
    _fallbackToFileInput();
  }
}

// Fallback: inject a file input and trigger it
function _fallbackToFileInput() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.display = 'none';
  input.onchange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    window._pendingCheckinPhoto = file;
    const reader = new FileReader();
    reader.onload = ev => _showPhotoPreview(ev.target.result);
    reader.readAsDataURL(file);
    input.remove();
  };
  document.body.appendChild(input);
  input.click();
}

function openPhotoCheckinPrompt(venueId, venueName) {
  // Close modal first to avoid stacking overlays
  closeOverlay('modalOverlay');

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.onclick = e => { if (e.target === overlay) { window._pendingCheckinPhoto = null; dismissOverlay(overlay); _tryPushPromptAfterCheckin(); } };

  // Store for use after camera returns
  window._checkinPhotoVenueId = venueId;
  window._checkinPhotoVenueName = venueName;

  // Build the file input separately so we can attach listener programmatically
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.id = 'photoFileInput';
  fileInput.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;z-index:2';

  overlay.innerHTML = `
    <div class="sheet">
      <div class="sheet-handle"></div>
      <div>
        <div class="photo-prompt-title">Add a photo? ${icn('camera',16)}</div>
        <div class="photo-prompt-sub">Show others what's happening at ${esc(venueName)} right now.</div>

        <div class="photo-upload-area" id="photoUploadArea" style="position:relative">
          <div style="position:relative;z-index:1;pointer-events:none;text-align:center">
            <div class="photo-upload-icon">${icn('camera',32)}</div>
            <div class="photo-upload-hint">Tap to add a photo</div>
          </div>
        </div>

        <div id="checkinPhotoPreview" style="display:none;position:relative;margin-bottom:12px">
          <img id="checkinPreviewImg" src="" alt="Preview" style="width:100%;border-radius:12px;max-height:240px;object-fit:cover">
          <button onclick="clearCheckinPhotoPreview()" style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.5);color:#fff;border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:14px">✕</button>
        </div>

        <textarea class="photo-caption-field" id="photoCaptionField"
          placeholder="Add a caption (optional)…" rows="2"></textarea>
        <button class="photo-submit-btn" id="photoSubmitBtn" disabled
          onclick="submitPhotoCheckin(window._checkinPhotoVenueId, window._checkinPhotoVenueName)">Share Photo</button>

        <div class="s-div" style="margin:16px 0"></div>
        <div class="tag-prompt-title">Who'd you go with?</div>
        <div class="tag-prompt-sub">Tag a friend at ${esc(venueName)} and they'll see it in their feed.</div>
        <div class="tag-friends-grid" id="tagFriendsGridInline">
          <div style="color:var(--muted);font-size:13px">Loading friends…</div>
        </div>
        <button class="photo-skip-btn" onclick="dismissOverlay(this.closest('.overlay')); _tryPushPromptAfterCheckin()">Done</button>
      </div>
    </div>`;

  // Insert file input into the upload area and attach listener AFTER DOM is ready
  const uploadArea = overlay.querySelector('#photoUploadArea');
  uploadArea.prepend(fileInput);

  // Use addEventListener — survives iOS camera suspend/resume better than onchange
  fileInput.addEventListener('change', function() {
    const file = this.files && this.files[0];
    if (!file) return;
    window._pendingCheckinPhoto = file;
    const reader = new FileReader();
    reader.onload = function(e) {
      const preview = document.getElementById('checkinPhotoPreview');
      const img = document.getElementById('checkinPreviewImg');
      const area = document.getElementById('photoUploadArea');
      const btn = document.getElementById('photoSubmitBtn');
      if (img) img.src = e.target.result;
      if (preview) preview.style.display = 'block';
      if (area) area.style.display = 'none';
      if (btn) btn.disabled = false;
    };
    reader.readAsDataURL(file);
  });

  presentOverlay(overlay);
  _loadTagFriendsInline(venueId, venueName);
}

function clearCheckinPhotoPreview() {
  window._pendingCheckinPhoto = null;
  const preview = document.getElementById('checkinPhotoPreview');
  const area = document.getElementById('photoUploadArea');
  const btn = document.getElementById('photoSubmitBtn');
  if (preview) preview.style.display = 'none';
  if (area) area.style.display = '';
  if (btn) btn.disabled = true;
}

async function _loadTagFriendsInline(venueId, venueName) {
  if (!currentUser) return;
  try {
    const followingIds = await getFollowing(currentUser.id);
    if (!followingIds?.length) {
      const grid = document.getElementById('tagFriendsGridInline');
      if (grid) grid.innerHTML = `<div style="color:var(--muted);font-size:13px">Follow people to tag them here.</div>`;
      return;
    }
    const { data: profiles } = await db.from('profiles')
      .select('id, display_name, avatar_emoji')
      .in('id', followingIds)
      .not('display_name', 'is', null)
      .limit(12);
    const grid = document.getElementById('tagFriendsGridInline');
    if (!grid) return;
    if (!profiles?.length) {
      grid.innerHTML = `<div style="color:var(--muted);font-size:13px">No friends to tag yet — follow people first.</div>`;
      return;
    }
    grid.innerHTML = profiles.map(p => `
      <button class="tag-friend-chip" id="tag-chip-${p.id}"
        onclick="tagFriendInline('${p.id}','${esc(p.display_name || '')}','${venueId}','${esc(venueName)}',this)">
        <span class="tag-friend-chip-avatar">${initialsAvatar(p.display_name || 'Friend', '', p.avatar_emoji, p.avatar_url)}</span>
        <span class="tag-friend-chip-name">${esc(p.display_name || 'Friend')}</span>
      </button>`).join('');
  } catch(e) {
    const grid = document.getElementById('tagFriendsGridInline');
    if (grid) grid.innerHTML = `<div style="color:var(--muted);font-size:13px">Couldn't load friends right now.</div>`;
  }
}

async function tagFriendInline(toUserId, toName, venueId, venueName, chip) {
  if(typeof haptic==='function')haptic('light');
  if (chip.classList.contains('tagged')) return;
  chip.classList.add('tagged');
  chip.style.pointerEvents = 'none';
  await tagFriendAtCheckIn(currentUser.id, toUserId, venueId, venueName);
  // Bump the local check-in count so UI reflects the tag immediately
  state.goingCounts[venueId] = (state.goingCounts[venueId] || 0) + 1;
  refreshCheckInCounters();
  showToast(`Tagged ${toName} at ${venueName}`);
}

// Web fallback handler (file input / drag-drop)
function handlePhotoDropOrChange(event, venueId, venueName) {
  event.preventDefault();
  document.getElementById('photoUploadArea')?.classList.remove('dragover');
  const file = event.dataTransfer?.files?.[0] || event.target?.files?.[0];
  if (!file || !file.type.startsWith('image/')) { showToast('Please choose an image file'); return; }
  if (file.size > 10 * 1024 * 1024) { showToast('Photo must be under 10 MB'); return; }
  window._pendingCheckinPhoto = file;
  const reader = new FileReader();
  reader.onload = e => _showPhotoPreview(e.target.result);
  reader.readAsDataURL(file);
}

function clearPhotoPreview(venueId, venueName) {
  window._pendingCheckinPhoto = null;
  const wrap = document.getElementById('photoPreviewWrap');
  const area = document.getElementById('photoUploadArea');
  const btn  = document.getElementById('photoSubmitBtn');
  const img  = document.getElementById('photoPreviewImg');
  if (wrap) wrap.style.display = 'none';
  if (img)  img.src = '';
  if (area) area.style.display = '';
  if (btn)  btn.disabled = true;
  // On native, re-show the source buttons
  if (_isCapacitorNative() && area) area.style.display = '';
}

async function submitPhotoCheckin(venueId, venueName) {
  const file    = window._pendingCheckinPhoto;
  const caption = document.getElementById('photoCaptionField')?.value.trim() || '';
  const btn     = document.getElementById('photoSubmitBtn');
  if (!file) { showToast('Please select a photo first'); return; }
  if (!currentUser) { openAuth('signin'); return; }

  btn.disabled = true;
  btn.textContent = 'Uploading…';

  try {
    const uploaded = await uploadCheckinPhoto(file, currentUser.id);
    if (!uploaded) {
      btn.disabled = false; btn.textContent = 'Share Photo';
      showToast('Upload failed — please try again'); return;
    }

    const saved = await saveCheckinPhoto({
      userId: currentUser.id, venueId, citySlug: state.city?.slug || '',
      photoUrl: uploaded.url, storagePath: uploaded.storagePath, caption
    });

    if (!saved) {
      btn.disabled = false; btn.textContent = 'Share Photo';
      showToast('Could not save photo — please try again'); return;
    }

    window._pendingCheckinPhoto = null;
    showToast('Photo shared!');
  } catch(e) {
    console.error('submitPhotoCheckin error:', e);
    btn.disabled = false; btn.textContent = 'Share Photo';
    showToast('Something went wrong — please try again');
    return;
  }

  // Refresh UGC photos in background
  const ugcEl = document.getElementById(`ugc-photos-${venueId}`);
  if (ugcEl) {
    fetchCheckinPhotos(venueId).then(photos => {
      ugcEl.innerHTML = renderCheckinPhotos(photos, venueId);
    });
  }

  // Scroll to the tag friends section within the same modal
  const tagSection = document.getElementById('tagFriendsGridInline');
  if (tagSection) tagSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
  if(typeof haptic==='function')haptic('light');
  closeOverlay('photoCheckinOverlay');
  setTimeout(() => maybeOpenTagFriends(venueId), 300);
}



// ── YOUR NEWS (ARTICLE FEED) ──────────────────────────
const NEWS_ARTICLES = [
  { city: 'san-diego', img: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800&q=80', tag: 'Events',      author: 'Shane',  title: 'San Diego Weekend Events: April 3\u20135, 2026', excerpt: 'Drone art shows, North Park Festival of Beers, Easter brunch, four Friday night markets, live tributes at Belly Up, and 25+ things to do this Easter weekend.', url: '/blog/sd-weekend-events-april-3-5-2026.html', date: 'April 2, 2026', readTime: '10 min' },
  { city: 'san-diego', img: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=800&q=80', tag: 'City Guide',  author: 'Shane',  title: 'Best Happy Hours in Pacific Beach (2026)', excerpt: '$2.50 beers at Rocky\u2019s, rooftop sushi at Cannonball, $3.50 drafts at Duck Dive \u2014 every PB happy hour worth your time.', url: '/blog/best-happy-hours-pacific-beach.html', date: 'March 31, 2026', readTime: '9 min' },
  { city: 'san-diego', img: 'https://images.unsplash.com/photo-1626700051175-6818013e1d4f?w=800&q=80', tag: 'City Guide',  author: 'Shane',  title: 'The Best Burritos in San Diego, Ranked', excerpt: 'La Perla\u2019s viral Oaxacalifornia, Lolita\u2019s classic California burrito, and 7 more spots locals swear by.', url: '/blog/best-burritos-san-diego.html', date: 'March 31, 2026', readTime: '8 min' },
  { city: 'san-diego', img: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=800&q=80', tag: 'City Guide',  author: 'Alexis', title: 'Best Tacos in San Diego: A Neighborhood Guide', excerpt: 'Tacos El Gordo\u2019s adobada, LOLA 55\u2019s Michelin creations, Mike\u2019s Red birria, Oscar\u2019s fish tacos \u2014 12 spots across every neighborhood.', url: '/blog/best-tacos-san-diego.html', date: 'March 30, 2026', readTime: '9 min' },
  { city: 'san-diego', img: 'https://images.unsplash.com/photo-1538970272646-f61fabb3a8a2?w=800&q=80', tag: 'City Guide',  author: 'Ryan',   title: 'A Local\u2019s Ultimate San Diego To-Do List', excerpt: 'Windansea sunsets, Torrey Pines hikes, sea cave kayaking, PopUp Bagels, and the spots only locals know.', url: '/blog/locals-san-diego-to-do-list.html', date: 'March 30, 2026', readTime: '9 min' },
  { city: 'san-diego', img: 'https://images.unsplash.com/photo-1572116469696-31de0f17cc34?w=800&q=80', tag: 'City Guide',  author: 'John',   title: '10 Happy Hour Spots San Diego Locals Swear By', excerpt: 'Skip the tourist traps. $1 oysters, 2-for-1 drinks, $7 wine, and late-night steals \u2014 the spots locals actually go to.', url: '/blog/happy-hour-spots-locals-love-san-diego.html', date: 'March 29, 2026', readTime: '7 min' },
  { city: 'san-diego', img: 'https://images.unsplash.com/photo-1471295253337-3ceaaedca402?w=800&q=80', tag: 'Events',      author: 'Shane',  title: 'San Diego Weekend Events: March 27\u201329, 2026', excerpt: 'Happy Opening Day. Padres vs. Tigers, Crew Classic, IRONMAN 70.3, Wave FC, live music, markets, and 30+ things to do this weekend.', url: '/blog/sd-weekend-events-march-27-29-2026.html', date: 'March 27, 2026', readTime: '12 min' },
  { city: 'san-diego', img: 'https://images.unsplash.com/photo-1436076863939-06870fe779c2?w=800&q=80', tag: 'City Guide',  author: 'Alexis', title: 'The 15 Best Happy Hours in San Diego (2026)', excerpt: 'From $5 margs in the Gaslamp to ocean-view pints in Pacific Beach \u2014 our definitive guide to San Diego\u2019s best happy hour deals.', url: '/blog/best-happy-hours-san-diego.html', date: 'March 25, 2026', readTime: '8 min' },
  { city: 'san-diego', img: 'https://images.unsplash.com/photo-1543007631-283050bb3e8c?w=800&q=80', tag: 'Events',      author: 'Ryan',   title: 'Best Trivia Nights in San Diego \u2014 Every Day of the Week', excerpt: 'Whether you\u2019re a Tuesday regular or a weekend warrior, here\u2019s where to flex your brain and score free drinks.', url: '/blog/best-trivia-nights-san-diego.html', date: 'March 24, 2026', readTime: '7 min' },
  { city: 'san-diego', img: 'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=800&q=80', tag: 'Niche Guide', author: 'John',   title: 'San Diego Rooftop Happy Hours You Can\u2019t Miss', excerpt: 'Sunset views + drink specials = peak San Diego. These rooftop bars deliver both, without the tourist-trap prices.', url: '/blog/rooftop-happy-hours-san-diego.html', date: 'March 22, 2026', readTime: '6 min' },
  { city: 'all',       img: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=800&q=80', tag: 'Tips',        author: 'Shane',  title: 'How to Find the Best Happy Hour Deals Near You', excerpt: 'Stop guessing, start saving. Here\u2019s the playbook for finding killer drink and food specials wherever you are.', url: '/blog/how-to-find-best-happy-hour-deals.html', date: 'March 20, 2026', readTime: '5 min' },
  { city: 'san-diego', img: 'https://images.unsplash.com/photo-1501612780327-45045538702b?w=800&q=80', tag: 'Events',      author: 'Alexis', title: 'Live Music + Happy Hour: San Diego\u2019s Best Combos', excerpt: 'Why choose between cheap drinks and great music? These San Diego spots serve both \u2014 and they\u2019re all on Spotd.', url: '/blog/live-music-happy-hours-san-diego.html', date: 'March 18, 2026', readTime: '6 min' },
];

function openNewsTab() {
  document.getElementById('newsTab').classList.add('tab-open');
  renderNewsFeed();
}

function closeNewsTab() {
  var el = document.getElementById('newsTab');
  if (el) el.classList.remove('tab-open');
}

function renderNewsFeed() {
  var container = document.getElementById('newsFeedContent');
  if (!container) return;
  var citySlug = state.city?.slug || 'san-diego';
  var articles = NEWS_ARTICLES.filter(function(a) {
    return a.city === citySlug || a.city === 'all';
  });

  if (!articles.length) {
    container.innerHTML = '<div class="news-empty"><div class="news-empty-icon">\uD83D\uDCF0</div><div class="news-empty-text">No articles for this city yet \u2014 stay tuned!</div></div>';
    return;
  }

  var cityName = state.city?.name || 'San Diego';
  // First article is hero, rest are standard cards
  var hero = articles[0];
  var rest = articles.slice(1);
  container.innerHTML =
    '<div class="news-city-label">' + cityName + '</div>' +
    '<a href="' + hero.url + '?inapp=1" class="news-hero">' +
      '<img src="' + hero.img + '" alt="" class="news-hero-img" loading="eager">' +
      '<div class="news-hero-overlay"></div>' +
      '<div class="news-hero-content">' +
        '<span class="news-hero-tag">' + hero.tag + '</span>' +
        '<div class="news-hero-title">' + hero.title + '</div>' +
        '<div class="news-hero-meta">By ' + hero.author + ' · ' + hero.readTime + ' read</div>' +
      '</div>' +
    '</a>' +
    '<div class="news-grid">' +
    rest.map(function(a) {
      return '<a href="' + a.url + '?inapp=1" class="news-card">' +
        '<div class="news-card-img-wrap">' +
          '<img src="' + a.img + '" alt="" class="news-card-img" loading="lazy">' +
        '</div>' +
        '<div class="news-card-body">' +
          '<span class="news-card-tag">' + a.tag + '</span>' +
          '<div class="news-card-title">' + a.title + '</div>' +
          '<div class="news-card-meta">By ' + a.author + ' · ' + a.readTime + ' read</div>' +
        '</div>' +
      '</a>';
    }).join('') +
    '</div>';
}

// ── MESSAGES ───────────────────────────────────────────
// Clean tab architecture — no overlays, no inline style hacks.
// Three named screens: inbox | convo | picker.
// Tab is shown/hidden via display:none/flex, same as feed.

let dmState = {
  screen: 'inbox',
  activeConvoId: null,
  activeConvoName: null,
  isGroup: false,
  subscription: null,
};

function openDmTab() {
  document.getElementById('dmTab').classList.add('tab-open');
}
function closeDmTab() {
  document.getElementById('dmTab').classList.remove('tab-open');
  if (dmState.subscription) { dmState.subscription.unsubscribe(); dmState.subscription = null; }
}
function openDmPage()  { openDmTab(); }
function closeDmPage() { closeDmTab(); }

function dmShowScreen(name) {
  ['dmScreenInbox', 'dmScreenConvo', 'dmScreenPicker'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById('dmScreen' + name.charAt(0).toUpperCase() + name.slice(1));
  if (target) target.style.display = (name === 'inbox') ? 'block' : 'flex';
  dmState.screen = name;

  const backBtn = document.getElementById('dmBackBtn');
  const newBtn  = document.getElementById('dmNewBtn');
  const title   = document.getElementById('dmTitle');
  if (name === 'inbox') {
    backBtn.style.display    = 'none';
    newBtn.style.display     = '';
    title.textContent        = 'Messages';
    title.style.textAlign    = 'left';
  } else {
    backBtn.style.display    = '';
    newBtn.style.display     = 'none';
    title.style.textAlign    = 'center';
  }
}

function dmNavBack() {
  if (dmState.screen === 'convo' || dmState.screen === 'picker') {
    if (dmState.subscription) { dmState.subscription.unsubscribe(); dmState.subscription = null; }
    dmState.activeConvoId = null;
    dmShowScreen('inbox');
    dmLoadInbox();
  }
}

async function openDmInbox() {
  if (!currentUser) { openAuth('signin'); return; }
  openDmTab();
  dmShowScreen('inbox');
  await dmLoadInbox();
}

const DM_EMPTY_HTML = `<div class="dm-empty-state">
  <div class="dm-empty-icon">💬</div>
  <div class="dm-empty-title">Your inbox is empty</div>
  <div class="dm-empty-sub">Share spots, plan nights out, and chat with friends on Spotd</div>
  <button class="dm-invite-btn" onclick="shareSpotd()">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
    </svg>
    Invite a Friend
  </button>
</div>`;

async function dmLoadInbox() {
  const list = document.getElementById('dmThreadList');
  list.innerHTML = '<div class="dm-loading">Loading…</div>';
  try {
    const { data: myParts, error: e1 } = await db
      .from('conversation_participants').select('conversation_id, last_read_at').eq('user_id', currentUser.id);
    if (e1) throw e1;
    if (!myParts?.length) { list.innerHTML = DM_EMPTY_HTML; dmUpdateBadge(0); return; }

    const convoIds  = myParts.map(r => r.conversation_id);
    const myReadMap = {};
    myParts.forEach(r => { myReadMap[r.conversation_id] = r.last_read_at; });

    const timeout = ms => new Promise(res => setTimeout(() => res({ data: [] }), ms));
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

    const otherIds = [...new Set(allParts.map(p => p.user_id).filter(id => id !== currentUser.id))];
    const pMap = {};
    if (otherIds.length) {
      try {
        const res = await Promise.race([
          db.from('profiles').select('id, display_name, avatar_emoji, avatar_url').in('id', otherIds),
          new Promise(res => setTimeout(() => res({ data: [] }), 2000))
        ]);
        (res.data || []).forEach(p => { pMap[p.id] = p; });
      } catch(e) {}
    }

    let totalUnread = 0;
    const rows = convoList.map(c => {
      try {
        const others = (convoPartsMap[c.id] || []).filter(id => id !== currentUser.id);
        const last   = lastMsgMap[c.id];
        const unread = unreadMap[c.id] || 0;
        totalUnread += unread;

        let name, avatar;
        if (c.is_group) {
          const myFirst    = (currentUser?.user_metadata?.full_name || 'You').split(' ')[0];
          const otherNames = others.map(id => (pMap[id]?.display_name || 'User').split(' ')[0]);
          name   = c.name || [myFirst, ...otherNames].join(', ') || 'Group';
          avatar = icn('users',20);
        } else {
          const p = pMap[others[0]] || {};
          name    = p.display_name || 'Spotd User';
          avatar  = initialsAvatar(name, '', p.avatar_emoji, p.avatar_url);
        }

        const preview  = last ? (last.msg_type === 'venue_share' ? 'Shared a venue' : (last.body || '').slice(0, 45)) : 'Say hello!';
        const time     = last ? fmtDate(last.created_at) : '';
        const safeName = (name || '').replace(/'/g, '&#39;');

        return `<div class="dm-thread-row${unread ? ' dm-thread-row--unread' : ''}" id="dmrow-${c.id}">
          <div class="dm-thread-swipe-wrap"
            ontouchstart="dmSwipeStart(event,this)"
            ontouchmove="dmSwipeMove(event,this)"
            ontouchend="dmSwipeEnd(event,this,'${c.id}')">
            <div class="dm-thread-main" onclick="dmOpenConvo('${c.id}','${safeName}',${!!c.is_group})">
              <div class="dm-thread-avatar">${avatar}</div>
              <div class="dm-thread-info">
                <div class="dm-thread-name">${esc(name)}</div>
                <div class="dm-thread-preview">${esc(preview)}</div>
              </div>
              <div class="dm-thread-right">
                <div class="dm-thread-time">${time}</div>
                ${unread ? `<span class="dm-unread-dot">${unread}</span>` : ''}
              </div>
            </div>
            <button class="dm-swipe-delete" onclick="dmDeleteConvo('${c.id}')">Delete</button>
          </div>
        </div>`;
      } catch(e) { return ''; }
    });

    list.innerHTML = rows.join('') || DM_EMPTY_HTML;
    dmUpdateBadge(totalUnread);
  } catch(e) {
    console.error('dmLoadInbox:', e);
    list.innerHTML = '<div class="dm-empty">Failed to load messages.</div>';
  }
}

const _sw = { x0: 0, y0: 0, swiping: false, revealed: null };
const SW_THRESH = 72;
function dmSwipeStart(e, wrap) { _sw.x0 = e.touches[0].clientX; _sw.y0 = e.touches[0].clientY; _sw.swiping = false; }
function dmSwipeMove(e, wrap) {
  const dx = e.touches[0].clientX - _sw.x0, dy = e.touches[0].clientY - _sw.y0;
  if (!_sw.swiping && Math.abs(dy) > Math.abs(dx)) return;
  if (Math.abs(dx) > 8) _sw.swiping = true;
  if (!_sw.swiping) return;
  e.preventDefault();
  wrap.style.transition = 'none';
  wrap.style.transform  = `translateX(${Math.max(-SW_THRESH, Math.min(0, dx))}px)`;
}
function dmSwipeEnd(e, wrap, convoId) {
  if (!_sw.swiping) return;
  _sw.swiping = false;
  const dx = e.changedTouches[0].clientX - _sw.x0;
  wrap.style.transition = 'transform .2s ease';
  if (dx < -(SW_THRESH / 2)) {
    wrap.style.transform = `translateX(-${SW_THRESH}px)`;
    if (_sw.revealed && _sw.revealed !== wrap) _sw.revealed.style.transform = '';
    _sw.revealed = wrap;
  } else {
    wrap.style.transform = '';
    if (_sw.revealed === wrap) _sw.revealed = null;
  }
}

async function dmDeleteConvo(convoId) {
  const { error } = await db.from('conversation_participants').delete()
    .eq('conversation_id', convoId).eq('user_id', currentUser.id);
  if (error) { showToast('Failed to delete'); return; }
  document.getElementById(`dmrow-${convoId}`)?.remove();
  const list = document.getElementById('dmThreadList');
  if (!list?.querySelector('.dm-thread-row')) list.innerHTML = DM_EMPTY_HTML;
  showToast('Conversation removed');
}

async function dmOpenConvo(convoId, name, isGroup, knownMembers) {
  if (!currentUser) { openAuth('signin'); return; }
  closeSubPage('pubProfilePage');

  const alreadyOpen       = dmState.activeConvoId === convoId;
  dmState.activeConvoId   = convoId;
  dmState.activeConvoName = name;
  dmState.isGroup         = isGroup;

  openDmTab();
  dmShowScreen('convo');
  document.getElementById('dmTitle').textContent = name;

  const bar = document.getElementById('dmMembersBar');
  if (isGroup) {
    bar.style.display = '';
    const renderMembers = (profs) => {
      const sorted = (profs || []).sort((a, b) => a.id === currentUser.id ? -1 : b.id === currentUser.id ? 1 : 0);
      bar.innerHTML = `<div class="dm-members-pills">${sorted.map(p =>
        `<div class="dm-member-pill">${initialsAvatar((p.display_name||'User').split(' ')[0], '', p.avatar_emoji, p.avatar_url)} ${esc((p.display_name||'User').split(' ')[0])}${p.id===currentUser.id?' (you)':''}</div>`
      ).join('')}</div>`;
    };
    if (knownMembers?.length) {
      renderMembers(knownMembers);
    } else {
      bar.innerHTML = '<div class="dm-members-pills"><div style="color:var(--muted);font-size:13px">Loading…</div></div>';
      (async () => {
        try {
          const { data: parts } = await db.from('conversation_participants').select('user_id').eq('conversation_id', convoId);
          const ids = (parts || []).map(p => p.user_id);
          const { data: profs } = ids.length ? await db.from('profiles').select('id, display_name, avatar_emoji, avatar_url').in('id', ids) : { data: [] };
          renderMembers(profs);
        } catch(e) { bar.style.display = 'none'; }
      })();
    }
  } else {
    bar.style.display = 'none';
    bar.innerHTML = '';
  }

  if (!alreadyOpen) {
    document.getElementById('dmMessages').innerHTML = '<div class="dm-loading">Loading…</div>';
    await dmLoadConvo();
    dmSubscribe();
  } else {
    dmScrollToBottom();
  }
}

async function dmLoadConvo() {
  const { data, error } = await db.from('messages')
    .select('id, sender_id, body, msg_type, venue_id, created_at')
    .eq('conversation_id', dmState.activeConvoId).order('created_at', { ascending: true });

  const el = document.getElementById('dmMessages');
  if (error) { el.innerHTML = '<div class="dm-empty">Failed to load.</div>'; return; }
  const msgs = data || [];

  const senderIds = [...new Set(msgs.map(m => m.sender_id).filter(Boolean))];
  const { data: profiles } = senderIds.length
    ? await db.from('profiles').select('id, display_name, avatar_emoji').in('id', senderIds) : { data: [] };
  const pMap = {};
  (profiles || []).forEach(p => { pMap[p.id] = p; });

  const venueIds = [...new Set(msgs.filter(m => m.venue_id).map(m => m.venue_id))];
  const { data: venues } = venueIds.length
    ? await db.from('venues').select('id, name, neighborhood, google_rating').in('id', venueIds) : { data: [] };
  const vMap = {};
  (venues || []).forEach(v => { vMap[v.id] = v; });

  if (!msgs.length) { el.innerHTML = '<div class="dm-empty">Say hi!</div>'; return; }
  el.innerHTML = msgs.map(m => dmRenderMsg(m, pMap, vMap)).join('');
  dmScrollToBottom();

  await db.from('conversation_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', dmState.activeConvoId).eq('user_id', currentUser.id);
}

function dmRenderMsg(m, pMap, vMap) {
  const isMine     = m.sender_id === currentUser.id;
  const senderName = isMine ? 'You' : (pMap[m.sender_id]?.display_name || 'User');
  const cls        = isMine ? 'dm-msg--mine' : 'dm-msg--theirs';
  const groupLabel = dmState.isGroup && !isMine ? `<div class="dm-sender-name">${esc(senderName)}</div>` : '';
  const time       = `<div class="dm-msg-time">${new Date(m.created_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</div>`;
  if (m.msg_type === 'venue_share') {
    const v = vMap?.[m.venue_id] || {};
    return `<div class="dm-msg ${cls}">${groupLabel}
      <div class="dm-venue-card" onclick="openModal('${m.venue_id}','venue')">
        <div class="dm-venue-icon">${ICN.pin}</div>
        <div class="dm-venue-info">
          <div class="dm-venue-name">${esc(v.name || 'Venue')}</div>
          <div class="dm-venue-meta">${esc(v.neighborhood || '')}${v.google_rating ? ' · ' + ICN.star + ' ' + v.google_rating : ''}</div>
        </div>
        <div class="dm-venue-arrow">›</div>
      </div>${time}</div>`;
  }
  return `<div class="dm-msg ${cls}">${groupLabel}<div class="dm-bubble">${esc(m.body || '')}</div>${time}</div>`;
}

async function dmSend() {
  const input = document.getElementById('dmInput');
  const body  = input.value.trim();
  if (!body || !dmState.activeConvoId) return;
  if(typeof haptic==='function')haptic('medium');
  input.value = '';
  const el  = document.getElementById('dmMessages');
  const tmp = document.createElement('div');
  tmp.className = 'dm-msg dm-msg--mine';
  tmp.innerHTML = `<div class="dm-bubble">${esc(body)}</div>
    <div class="dm-msg-time">${new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</div>`;
  el?.appendChild(tmp);
  dmScrollToBottom();
  const { error } = await db.from('messages').insert({ conversation_id: dmState.activeConvoId, sender_id: currentUser.id, body, msg_type: 'text' });
  if (error) { showToast('Failed to send'); tmp.remove(); input.value = body; }
}

async function dmSendVenue(venueId, convoId) {
  const { error } = await db.from('messages').insert({ conversation_id: convoId, sender_id: currentUser.id, venue_id: venueId, msg_type: 'venue_share' });
  if (error) { showToast('Failed to share venue'); return; }
  if(typeof haptic==='function')haptic('medium');
  showToast('Venue shared!');
  closeOverlay('modalOverlay');
  document.getElementById('dmSharePickerOverlay')?.remove();
}

async function dmStartNewConvo() {
  if (!currentUser) { openAuth('signin'); return; }
  const { data: following } = await db.from('user_follows').select('following_id').eq('follower_id', currentUser.id);
  const followIds = (following || []).map(f => f.following_id);
  const { data: profiles } = followIds.length
    ? await db.from('profiles').select('id, display_name, avatar_emoji, avatar_url').in('id', followIds) : { data: [] };
  dmShowPicker(profiles || [], false);
}

function dmShowPicker(users, isGroup) {
  window._dmPickerSelected = new Set();
  window._dmPickerUsers    = users;
  window._dmPickerIsGroup  = isGroup;
  openDmTab();
  dmShowScreen('picker');
  document.getElementById('dmTitle').textContent = isGroup ? 'New Group' : 'New Message';
  const btn = document.getElementById('dmPickerBtn');
  btn.textContent    = isGroup ? 'Create Group' : 'Start Chat';
  btn._pickerIsGroup = isGroup;
  document.getElementById('dmPickerScroll').innerHTML = `
    <div class="dm-picker-search-wrap">
      <input class="dm-picker-search" placeholder="Search by name…" oninput="dmFilterPicker(this.value)">
    </div>
    ${isGroup
      ? `<div class="dm-group-name-wrap"><input class="dm-picker-search" id="dmGroupName" placeholder="Group name (optional)…"></div>`
      : `<div class="dm-picker-toggle" onclick="dmShowPicker(window._dmPickerUsers,true)">${ICN.users} Create Group Instead</div>`
    }
    <div id="dmPickerList">
      ${users.length
        ? users.map(u => `
          <div class="dm-picker-row" id="dpick-${u.id}" onclick="dmPickerToggle('${u.id}',${isGroup})">
            <div class="dm-thread-avatar" style="width:40px;height:40px">${initialsAvatar(u.display_name||'User', '', u.avatar_emoji, u.avatar_url)}</div>
            <div style="flex:1;font-weight:600;font-size:15px">${esc(u.display_name||'User')}</div>
            <div class="dm-pick-check"></div>
          </div>`).join('')
        : '<div class="dm-empty">Follow people to message them</div>'
      }
    </div>`;
}
function dmShowUserPicker(users, isGroup) { dmShowPicker(users, isGroup); }

function dmFilterPicker(q) {
  document.querySelectorAll('.dm-picker-row').forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
  });
}

function dmPickerToggle(userId, isGroup) {
  const sel = window._dmPickerSelected, row = document.getElementById(`dpick-${userId}`);
  if (sel.has(userId)) { sel.delete(userId); row.classList.remove('dm-picker-row--selected'); }
  else {
    if (!isGroup) { sel.forEach(id => { document.getElementById(`dpick-${id}`)?.classList.remove('dm-picker-row--selected'); }); sel.clear(); }
    sel.add(userId); row.classList.add('dm-picker-row--selected');
  }
}

function dmCreateConvoFromPicker() { const btn = document.getElementById('dmPickerBtn'); dmCreateConvo(!!btn._pickerIsGroup); }

async function dmCreateConvo(isGroup) {
  const sel = window._dmPickerSelected;
  if (!sel?.size) { showToast('Select at least one person'); return; }
  const groupName = isGroup ? (document.getElementById('dmGroupName')?.value.trim() || null) : null;

  if (!isGroup && sel.size === 1) {
    const otherId = [...sel][0];
    const { data: myParts } = await db.from('conversation_participants').select('conversation_id').eq('user_id', currentUser.id);
    if (myParts?.length) {
      const myIds = myParts.map(r => r.conversation_id);
      const { data: otherParts } = await db.from('conversation_participants').select('conversation_id').eq('user_id', otherId).in('conversation_id', myIds);
      if (otherParts?.length) {
        const { data: c } = await db.from('conversations').select('is_group').eq('id', otherParts[0].conversation_id).single();
        if (c && !c.is_group) { const name = window._dmPickerUsers?.find(u => u.id === otherId)?.display_name || 'Chat'; await dmOpenConvo(otherParts[0].conversation_id, name, false); return; }
      }
    }
  }

  const { data: convo, error: cErr } = await db.from('conversations').insert({ is_group: isGroup, name: groupName, created_by: currentUser.id }).select().single();
  if (cErr) { showToast('Failed to create conversation'); return; }
  const participantIds = [currentUser.id, ...[...sel]];
  const { error: pErr } = await db.from('conversation_participants').insert(participantIds.map(uid => ({ conversation_id: convo.id, user_id: uid })));
  if (pErr) { showToast('Failed to add participants'); return; }

  const others      = window._dmPickerUsers?.filter(u => sel.has(u.id)) || [];
  const myFirstName = (currentUser?.user_metadata?.full_name || 'You').split(' ')[0];
  const displayName = groupName || (isGroup ? [myFirstName, ...others.map(u => (u.display_name||'User').split(' ')[0])].join(', ') : (others[0]?.display_name || 'Chat'));
  const knownMembers = isGroup ? [
    { id: currentUser.id, display_name: currentUser.user_metadata?.full_name || 'You', avatar_emoji: null },
    ...others.map(u => ({ id: u.id, display_name: u.display_name, avatar_emoji: u.avatar_emoji || null }))
  ] : null;
  await dmOpenConvo(convo.id, displayName, isGroup, knownMembers);
}

async function dmOpenFromProfile(userId, displayName) {
  if (!currentUser) { openAuth('signin'); return; }
  closeSubPage('pubProfilePage');
  const { data: myParts } = await db.from('conversation_participants').select('conversation_id').eq('user_id', currentUser.id);
  if (myParts?.length) {
    const myIds = myParts.map(r => r.conversation_id);
    const { data: otherParts } = await db.from('conversation_participants').select('conversation_id').eq('user_id', userId).in('conversation_id', myIds);
    if (otherParts?.length) {
      for (const p of otherParts) {
        const { data: c } = await db.from('conversations').select('is_group').eq('id', p.conversation_id).single();
        if (c && !c.is_group) { await dmOpenConvo(p.conversation_id, displayName, false); return; }
      }
    }
  }
  const { data: convo, error } = await db.from('conversations').insert({ is_group: false, created_by: currentUser.id }).select().single();
  if (error) { showToast('Failed to start conversation'); return; }
  await db.from('conversation_participants').insert([{ conversation_id: convo.id, user_id: currentUser.id }, { conversation_id: convo.id, user_id: userId }]);
  await dmOpenConvo(convo.id, displayName, false);
}

async function dmOpenVenueSharePicker(venueId) {
  if (!currentUser) { openAuth('signin'); return; }

  // Load existing conversations
  const { data: myParts } = await db.from('conversation_participants').select('conversation_id').eq('user_id', currentUser.id);
  const convoIds = myParts?.length ? [...new Set(myParts.map(r => r.conversation_id))] : [];
  let convos = [], allParts = [], profiles = [];
  if (convoIds.length) {
    const [r1, r2] = await Promise.all([
      db.from('conversations').select('id, is_group, name, updated_at').in('id', convoIds).order('updated_at', { ascending: false }),
      db.rpc('get_conversation_participants', { convo_ids: convoIds }),
    ]);
    convos = r1.data || []; allParts = r2.data || [];
  }
  const otherIds = [...new Set((allParts).map(p=>p.user_id).filter(id=>id!==currentUser.id))];
  if (otherIds.length) { const { data } = await db.from('profiles').select('id, display_name, avatar_emoji').in('id', otherIds); profiles = data || []; }
  const pMap = {}; profiles.forEach(p => { pMap[p.id] = p; });
  const convoPartsMap = {}; allParts.forEach(p => { if (!convoPartsMap[p.conversation_id]) convoPartsMap[p.conversation_id] = []; if (p.user_id !== currentUser.id) convoPartsMap[p.conversation_id].push(p.user_id); });
  const seen = new Set();
  const uniqueConvos = convos.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });

  // Build conversation rows HTML
  const convoRowsHTML = uniqueConvos.map(c => {
    const others = convoPartsMap[c.id] || [];
    const myFirst = (currentUser?.user_metadata?.full_name || 'You').split(' ')[0];
    const name   = c.is_group ? (c.name || [myFirst,...others.map(id=>(pMap[id]?.display_name||'User').split(' ')[0])].join(', ')) : (pMap[others[0]]?.display_name || 'Spotd User');
    const avatar = c.is_group ? icn('users',20) : initialsAvatar(name, '', pMap[others[0]]?.avatar_emoji, pMap[others[0]]?.avatar_url);
    return `<div class="dm-thread-row dm-share-row" data-name="${esc(name.toLowerCase())}" onclick="dmSendVenue('${venueId}','${c.id}');document.getElementById('dmSharePickerOverlay').remove()">
      <div class="dm-thread-main"><div class="dm-thread-avatar">${avatar}</div><div class="dm-thread-info"><div class="dm-thread-name">${esc(name)}</div></div></div>
      <div class="dm-share-send-btn">Send</div>
    </div>`;
  }).join('');

  document.getElementById('dmSharePickerOverlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'dmSharePickerOverlay'; overlay.className = 'overlay';
  overlay.onclick = e => { if (e.target === overlay) dismissOverlay(overlay); };
  overlay.innerHTML = `<div class="sheet" style="max-height:60vh;overflow-y:auto;">
    <div class="sheet-handle"></div>
    <div style="font-weight:800;font-size:17px;margin-bottom:12px;padding-right:32px;">Send to…</div>
    <input type="text" id="dmShareSearch" class="search-box" placeholder="Search by name…"
      style="margin-bottom:12px;width:100%;box-sizing:border-box;" autocomplete="off" autocorrect="off"
      oninput="dmFilterSharePicker(this.value)">
    <div id="dmShareSearchResults" style="display:none"></div>
    <div id="dmShareConvoList">${convoRowsHTML || '<div style="color:var(--muted);font-size:13px;padding:12px 0">No conversations yet</div>'}</div>
  </div>`;
  presentOverlay(overlay);
  // Auto-focus the search input
  setTimeout(() => document.getElementById('dmShareSearch')?.focus(), 100);

  // Store venueId for search result sends
  window._dmShareVenueId = venueId;
}

let _dmSearchTimeout = null;
function dmFilterSharePicker(query) {
  const q = query.trim().toLowerCase();
  const convoList = document.getElementById('dmShareConvoList');
  const searchResults = document.getElementById('dmShareSearchResults');

  // Filter existing conversations
  if (convoList) {
    convoList.querySelectorAll('.dm-share-row').forEach(row => {
      const name = row.dataset.name || '';
      row.style.display = name.includes(q) ? '' : 'none';
    });
  }

  // Search for users by name if query is 2+ chars
  if (q.length < 2) { if (searchResults) searchResults.style.display = 'none'; return; }

  clearTimeout(_dmSearchTimeout);
  _dmSearchTimeout = setTimeout(async () => {
    try {
      const { data: users } = await db.from('profiles')
        .select('id, display_name')
        .ilike('display_name', `%${q}%`)
        .neq('id', currentUser.id)
        .limit(8);
      if (!searchResults || !users?.length) { if (searchResults) searchResults.style.display = 'none'; return; }
      searchResults.style.display = 'block';
      searchResults.innerHTML = `<div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:8px 0 6px">People</div>`
        + users.map(u => `<div class="dm-thread-row dm-share-row"
          onclick="dmSendVenueToUser('${u.id}','${esc(u.display_name||'User')}')">
          <div class="dm-thread-main"><div class="dm-thread-avatar">${initialsAvatar(u.display_name || 'User', '', u.avatar_emoji, u.avatar_url)}</div>
          <div class="dm-thread-info"><div class="dm-thread-name">${esc(u.display_name || 'User')}</div></div></div>
          <div class="dm-share-send-btn">Send</div>
        </div>`).join('');
    } catch(e) {}
  }, 300);
}

async function dmSendVenueToUser(userId, displayName) {
  const venueId = window._dmShareVenueId;
  if (!venueId) return;
  document.getElementById('dmSharePickerOverlay')?.remove();
  showToast('Sending…');
  // Find or create conversation
  const { data: myConvos } = await db.from('conversation_participants').select('conversation_id').eq('user_id', currentUser.id);
  const { data: theirConvos } = await db.from('conversation_participants').select('conversation_id').eq('user_id', userId);
  const mySet = new Set((myConvos||[]).map(r=>r.conversation_id));
  const shared = (theirConvos||[]).find(r => mySet.has(r.conversation_id));

  let convoId;
  if (shared) {
    convoId = shared.conversation_id;
  } else {
    const { data: convo, error } = await db.from('conversations').insert({ is_group: false, created_by: currentUser.id }).select().single();
    if (error) { showToast('Failed to start conversation'); return; }
    await db.from('conversation_participants').insert([
      { conversation_id: convo.id, user_id: currentUser.id },
      { conversation_id: convo.id, user_id: userId }
    ]);
    convoId = convo.id;
  }
  await dmSendVenue(venueId, convoId);
  showToast(`Sent to ${displayName}`);
}

function dmSubscribe() {
  if (dmState.subscription) dmState.subscription.unsubscribe();
  dmState.subscription = db.channel('dm-' + dmState.activeConvoId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${dmState.activeConvoId}` }, payload => {
      const m = payload.new;
      if (m.sender_id === currentUser.id) return;
      dmAppendMessage(m);
    }).subscribe();
}

async function dmAppendMessage(m) {
  const el = document.getElementById('dmMessages');
  if (!el) return;
  let venue = null;
  if (m.venue_id) { const { data } = await db.from('venues').select('id, name, neighborhood, google_rating').eq('id', m.venue_id).single(); venue = data; }
  let senderName = 'User';
  if (dmState.isGroup) { const { data } = await db.from('profiles').select('display_name').eq('id', m.sender_id).single(); senderName = data?.display_name || 'User'; }
  const pMap = { [m.sender_id]: { display_name: senderName } };
  const vMap = venue ? { [m.venue_id]: venue } : {};
  el.insertAdjacentHTML('beforeend', dmRenderMsg(m, pMap, vMap));
  dmScrollToBottom();
  await db.from('conversation_participants').update({ last_read_at: new Date().toISOString() }).eq('conversation_id', dmState.activeConvoId).eq('user_id', currentUser.id);
}

async function dmRefreshBadge() {
  if (!currentUser) return;
  try {
    const { data: myParts } = await db.from('conversation_participants').select('conversation_id, last_read_at').eq('user_id', currentUser.id);
    if (!myParts?.length) { dmUpdateBadge(0); return; }
    const convoIds = myParts.map(r => r.conversation_id);
    const myReadMap = {}; myParts.forEach(r => { myReadMap[r.conversation_id] = r.last_read_at; });
    const { data: msgs } = await db.from('messages').select('conversation_id, sender_id, created_at').in('conversation_id', convoIds).neq('sender_id', currentUser.id);
    let unread = 0;
    (msgs || []).forEach(m => { const myRead = myReadMap[m.conversation_id]; if (!myRead || new Date(m.created_at) > new Date(myRead)) unread++; });
    dmUpdateBadge(unread);
  } catch(e) {}
}
setInterval(() => { if (currentUser) dmRefreshBadge(); }, 120000);

function dmUpdateBadge(count) {
  // Update badge on profile DM button
  const badge = document.getElementById('pfDmBadge');
  if (badge) {
    if (count > 0) { badge.textContent = count > 9 ? '9+' : count; badge.style.display = ''; }
    else badge.style.display = 'none';
  }
  // Update badge on social feed header DM button
  const socialDmDot = document.getElementById('socialDmDot');
  if (socialDmDot) {
    socialDmDot.style.display = count > 0 ? '' : 'none';
  }
  // Also show indicator on profile nav tab when there are unread DMs
  const navBadge = document.getElementById('bnProfileBadge');
  if (navBadge) {
    if (count > 0) { navBadge.style.display = ''; }
    else navBadge.style.display = 'none';
  }
}

function dmScrollToBottom() {
  const el = document.getElementById('dmMessages');
  if (el) setTimeout(() => { el.scrollTop = el.scrollHeight; }, 50);
}

document.addEventListener('focusin', e => { if (e.target.id === 'dmInput') setTimeout(() => dmScrollToBottom(), 300); });
document.addEventListener('focusout', e => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
    const sheet = e.target.closest('.sheet');
    if (sheet) setTimeout(() => { sheet.style.maxHeight = ''; }, 100);
  }
});
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    const vv = window.visualViewport;
    document.querySelectorAll('.overlay.open .sheet').forEach(sheet => { sheet.style.maxHeight = vv.height * 0.92 + 'px'; });
    const focused = document.activeElement;
    if (focused && (focused.tagName === 'TEXTAREA' || focused.tagName === 'INPUT')) {
      const sheet = focused.closest('.sheet');
      if (sheet) setTimeout(() => { focused.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50);
    }
  });
}


function selectProfileTab(tab, btn) {
  if(typeof haptic==='function')haptic('light');
  // Hide all tab content panels
  ['checkins','reviews','saved','lists','hoods'].forEach(t => {
    const el = document.getElementById('my-tab-' + t);
    if (el) el.style.display = 'none';
  });
  // Show selected panel
  const target = document.getElementById('my-tab-' + tab);
  if (target) target.style.display = 'block';
  // Update active state on buttons (supports both old .profile-tab and new .pf-tab)
  document.querySelectorAll('.pf-tab, .profile-tab').forEach(b => {
    b.classList.remove('active', 'on');
  });
  if (btn) { btn.classList.add('on'); btn.classList.add('active'); }
  if (tab === 'lists') loadMyLists();
}

// ── CURATED LISTS ─────────────────────────────────────
async function loadMyLists() {
  if (!currentUser) return;
  const grid = document.getElementById('myListsGrid');
  if (!grid) return;
  grid.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted)">Loading...</div>';
  const lists = await fetchUserLists(currentUser.id);
  if (!lists.length) {
    grid.innerHTML = '<div class="pf-empty"><div class="pf-empty-icon">\uD83D\uDCCB</div>No lists yet \u2014 create one to curate your favorite spots!</div>';
    return;
  }
  grid.innerHTML = lists.map(function(l) {
    var count = l.list_items?.[0]?.count || 0;
    return '<div class="list-card" onclick="openListDetail(\'' + l.id + '\')">' +
      '<div class="list-card-emoji">' + (l.cover_emoji || '\uD83C\uDF78') + '</div>' +
      '<div class="list-card-body">' +
      '<div class="list-card-title">' + esc(l.title) + '</div>' +
      '<div class="list-card-meta">' + count + ' spot' + (count !== 1 ? 's' : '') + '</div>' +
      '</div>' +
      '<button class="list-card-del" onclick="event.stopPropagation();doDeleteList(\'' + l.id + '\')" title="Delete">&times;</button>' +
      '</div>';
  }).join('');
}

function openCreateListForm() {
  var emojis = ['\uD83C\uDF78','\uD83C\uDF7A','\uD83C\uDF77','\uD83C\uDF7B','\uD83C\uDF7E','\uD83E\uDD42','\uD83C\uDF79','\uD83C\uDF75','\uD83C\uDF2E','\uD83C\uDF55','\uD83C\uDF1F','\uD83D\uDD25','\u2764\uFE0F','\uD83C\uDF05','\uD83C\uDFB5','\uD83C\uDFC8','\uD83C\uDF34','\uD83D\uDC95','\uD83E\uDD29','\uD83C\uDF1E'];
  var html = '<div class="list-form-overlay" id="listFormOverlay" onclick="if(event.target===this)closeListForm()">' +
    '<div class="list-form-sheet">' +
    '<div class="list-form-header"><span>New List</span><button onclick="closeListForm()">&times;</button></div>' +
    '<input class="field list-form-title" id="listTitleInput" type="text" placeholder="List name (e.g. Date Night Gaslamp)" maxlength="80">' +
    '<textarea class="field list-form-desc" id="listDescInput" placeholder="Description (optional)" rows="2" maxlength="280"></textarea>' +
    '<div class="list-form-label">Cover emoji</div>' +
    '<div class="list-emoji-grid" id="listEmojiGrid">' +
    emojis.map(function(e) { return '<button class="list-emoji-btn' + (e === '\uD83C\uDF78' ? ' selected' : '') + '" data-emoji="' + e + '" onclick="pickListEmoji(this)">' + e + '</button>'; }).join('') +
    '</div>' +
    '<button class="desc-submit-btn" onclick="doCreateList()">Create List</button>' +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function closeListForm() {
  var el = document.getElementById('listFormOverlay');
  if (el) el.remove();
}

function pickListEmoji(btn) {
  document.querySelectorAll('#listEmojiGrid .list-emoji-btn').forEach(function(b) { b.classList.remove('selected'); });
  btn.classList.add('selected');
}

async function doCreateList() {
  var title = document.getElementById('listTitleInput').value.trim();
  if (!title) { showToast('Enter a list name'); return; }
  var desc = document.getElementById('listDescInput').value.trim();
  var emojiBtn = document.querySelector('#listEmojiGrid .selected');
  var emoji = emojiBtn ? emojiBtn.dataset.emoji : '\uD83C\uDF78';
  var list = await createList(title, desc, emoji);
  if (list) {
    showToast('List created!');
    if (typeof haptic === 'function') haptic('medium');
    closeListForm();
    loadMyLists();
  } else {
    showToast('Could not create list');
  }
}

async function doDeleteList(listId) {
  if (!confirm('Delete this list?')) return;
  var ok = await deleteList(listId);
  if (ok) { showToast('List deleted'); loadMyLists(); }
}

async function openListDetail(listId) {
  var list = await fetchListDetail(listId);
  if (!list) { showToast('List not found'); return; }
  var isOwner = currentUser && list.user_id === currentUser.id;
  var authorName = list.profiles?.display_name || 'Someone';
  var items = list.items || [];

  var html = '<div class="sub-page" id="listDetailPage">' +
    '<div class="sub-page-header"><button class="sub-page-back" onclick="closeSubPage(\'listDetailPage\')">' + icn('back', 20) + '</button><span class="sub-page-title">List</span></div>' +
    '<div style="text-align:center;padding:20px 16px 0">' +
    '<div style="font-size:48px;margin-bottom:8px">' + (list.cover_emoji || '\uD83C\uDF78') + '</div>' +
    '<h2 style="font-family:\'Cabinet Grotesk\',sans-serif;font-weight:900;font-size:22px;color:var(--text);letter-spacing:-0.5px">' + esc(list.title) + '</h2>' +
    (list.description ? '<p style="font-size:13px;color:var(--muted);margin-top:4px">' + esc(list.description) + '</p>' : '') +
    '<div style="font-size:11px;color:var(--muted);margin-top:6px">by ' + esc(authorName) + ' \u00B7 ' + items.length + ' spot' + (items.length !== 1 ? 's' : '') + '</div>' +
    '<button class="list-share-btn" onclick="shareList(\'' + listId + '\',\'' + esc(list.title) + '\')">Share list</button>' +
    '</div>' +
    '<div style="padding:12px 16px">' +
    (items.length ? items.map(function(item) {
      var v = item.venues;
      if (!v) return '';
      var todayH = v.days && v.days.includes(TODAY) ? 'Open today' : '';
      return '<div class="list-venue-row" onclick="closeSubPage(\'listDetailPage\');openModal(\'' + v.id + '\',\'venue\')">' +
        (v.photo_url ? '<img class="list-venue-img" src="' + esc(v.photo_url) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '<div class="list-venue-img" style="background:var(--coral-dim);display:flex;align-items:center;justify-content:center;font-size:20px">\uD83C\uDF7A</div>') +
        '<div class="list-venue-body">' +
        '<div class="list-venue-name">' + esc(v.name) + '</div>' +
        '<div class="list-venue-meta">' + esc(v.neighborhood || '') + (v.cuisine ? ' \u00B7 ' + esc(v.cuisine) : '') + (todayH ? ' \u00B7 ' + todayH : '') + '</div>' +
        (item.note ? '<div class="list-venue-note">\u201C' + esc(item.note) + '\u201D</div>' : '') +
        '</div>' +
        (isOwner ? '<button class="list-venue-remove" onclick="event.stopPropagation();doRemoveFromList(\'' + listId + '\',\'' + v.id + '\',this)">&times;</button>' : '') +
        '</div>';
    }).join('') : '<div class="pf-empty"><div class="pf-empty-icon">\uD83D\uDCCD</div>No spots added yet \u2014 add venues from their detail page</div>') +
    '</div></div>';

  // Remove existing if any
  var existing = document.getElementById('listDetailPage');
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', html);
  var page = document.getElementById('listDetailPage');
  page.style.display = 'block';
  requestAnimationFrame(function() { requestAnimationFrame(function() { page.classList.add('sub-page--open'); }); });
}

async function doRemoveFromList(listId, venueId, btn) {
  var ok = await removeFromList(listId, venueId);
  if (ok) {
    var row = btn.closest('.list-venue-row');
    if (row) { row.style.opacity = '0'; setTimeout(function() { row.remove(); }, 200); }
    showToast('Removed from list');
  }
}

function shareList(listId, title) {
  var url = window.location.origin + '/?list=' + listId;
  if (navigator.share) {
    navigator.share({ title: title + ' \u2014 Spotd', url: url }).catch(function() {});
  } else {
    navigator.clipboard.writeText(url).then(function() { showToast('Link copied!'); });
  }
}

// "Add to List" from venue modal
async function openAddToList(venueId) {
  if (!currentUser) { openAuth('signin'); return; }
  var lists = await fetchListsContainingVenue(venueId);
  var html = '<div class="list-form-overlay" id="addToListOverlay" onclick="if(event.target===this)this.remove()">' +
    '<div class="list-form-sheet">' +
    '<div class="list-form-header"><span>Add to list</span><button onclick="document.getElementById(\'addToListOverlay\').remove()">&times;</button></div>' +
    (lists.length ? lists.map(function(l) {
      return '<button class="add-list-row' + (l.hasVenue ? ' in-list' : '') + '" onclick="doAddToList(\'' + l.id + '\',\'' + venueId + '\',this)">' +
        '<span>' + (l.cover_emoji || '\uD83C\uDF78') + ' ' + esc(l.title) + '</span>' +
        '<span class="add-list-check">' + (l.hasVenue ? '\u2713' : '+') + '</span>' +
        '</button>';
    }).join('') : '<div style="padding:16px;color:var(--muted);text-align:center;font-size:13px">No lists yet</div>') +
    '<button class="add-list-new" onclick="document.getElementById(\'addToListOverlay\').remove();openCreateListForm()">+ Create new list</button>' +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

async function doAddToList(listId, venueId, btn) {
  var check = btn.querySelector('.add-list-check');
  if (btn.classList.contains('in-list')) {
    var ok = await removeFromList(listId, venueId);
    if (ok) { btn.classList.remove('in-list'); if (check) check.textContent = '+'; showToast('Removed'); }
  } else {
    var ok2 = await addToList(listId, venueId);
    if (ok2) { btn.classList.add('in-list'); if (check) check.textContent = '\u2713'; showToast('Added!'); if (typeof haptic === 'function') haptic('light'); }
  }
}

// ── LEGAL PAGES ──────────────────────────────────────
function openLegalPage(page) {
  const el = document.getElementById('legalContent');
  if (page === 'privacy') {
    el.innerHTML = `
      <h2 style="font-size:20px;font-weight:800;margin-bottom:12px">Privacy Policy</h2>
      <p style="font-size:12px;color:var(--muted);margin-bottom:16px">Effective: March 2026</p>
      <div class="legal-body">
        <p>Spotd ("we", "us", "our") operates the Spotd mobile application and website (spotd.biz). This Privacy Policy explains how we collect, use, and protect your information.</p>
        <h3>Information We Collect</h3>
        <p><strong>Account data:</strong> When you create an account, we collect your email address, display name, and optionally your phone number.</p>
        <p><strong>Location data:</strong> With your permission, we collect your approximate location to show nearby venues and events. We use location only while the app is in use and do not track you in the background.</p>
        <p><strong>Usage data:</strong> We collect information about your interactions with the app, including check-ins, reviews, favorites, and social activity.</p>
        <p><strong>Photos:</strong> If you choose to upload check-in photos, we store them securely in our cloud storage.</p>
        <h3>How We Use Your Information</h3>
        <ul>
          <li>Display nearby happy hours, events, and venues</li>
          <li>Enable social features (check-ins, reviews, messaging)</li>
          <li>Send push notifications you've opted into</li>
          <li>Send promotional SMS messages if you've consented</li>
          <li>Improve the app experience and fix issues</li>
        </ul>
        <h3>Data Sharing</h3>
        <p>We do not sell your personal information. We share data only with:</p>
        <ul>
          <li><strong>Supabase:</strong> Our database and authentication provider</li>
          <li><strong>Google:</strong> If you sign in with Google OAuth</li>
          <li><strong>Apple:</strong> If you sign in with Apple</li>
        </ul>
        <h3>Data Retention & Deletion</h3>
        <p>You can delete your account and all associated data at any time from your Profile Settings. Upon deletion, we remove your profile, reviews, check-ins, messages, and favorites. Some anonymized aggregate data may be retained.</p>
        <h3>Your Rights</h3>
        <p>You may request access to, correction of, or deletion of your personal data at any time by emailing <a href="mailto:support@spotd.biz" style="color:var(--accent)">support@spotd.biz</a> or using the in-app account deletion feature.</p>
        <h3>Children's Privacy</h3>
        <p>Spotd is not intended for users under the age of 21. We do not knowingly collect information from anyone under 21.</p>
        <h3>Changes</h3>
        <p>We may update this policy from time to time. We will notify you of material changes via the app or email.</p>
        <h3>Contact</h3>
        <p>Questions? Email us at <a href="mailto:support@spotd.biz" style="color:var(--accent)">support@spotd.biz</a></p>
      </div>`;
  } else {
    el.innerHTML = `
      <h2 style="font-size:20px;font-weight:800;margin-bottom:12px">Terms of Service</h2>
      <p style="font-size:12px;color:var(--muted);margin-bottom:16px">Effective: March 2026</p>
      <div class="legal-body">
        <p>By using Spotd ("the App"), you agree to these Terms of Service. If you do not agree, do not use the App.</p>
        <h3>Eligibility</h3>
        <p>You must be at least 21 years of age to use Spotd. By creating an account, you confirm that you are 21 or older.</p>
        <h3>Account Responsibilities</h3>
        <p>You are responsible for maintaining the security of your account and for all activity under it. You agree to provide accurate information and keep it up to date.</p>
        <h3>Acceptable Use</h3>
        <p>You agree not to:</p>
        <ul>
          <li>Post false, misleading, or defamatory content</li>
          <li>Harass, bully, or threaten other users</li>
          <li>Upload illegal, obscene, or harmful content</li>
          <li>Spam or send unsolicited commercial messages</li>
          <li>Impersonate other users or entities</li>
          <li>Attempt to access other users' accounts</li>
          <li>Use the app for any unlawful purpose</li>
        </ul>
        <h3>User-Generated Content</h3>
        <p>You retain ownership of content you post (reviews, photos, comments). By posting, you grant Spotd a non-exclusive, worldwide license to display and distribute that content within the app. We may remove content that violates these terms.</p>
        <h3>Content Moderation</h3>
        <p>Users can report inappropriate content or users. We reserve the right to remove content and suspend or terminate accounts that violate these terms, at our sole discretion.</p>
        <h3>Venue Information</h3>
        <p>Happy hour times, deals, and event information are provided for convenience and may not always be current. Always verify directly with the venue.</p>
        <h3>Termination</h3>
        <p>You may delete your account at any time via Profile Settings. We may suspend or terminate accounts that violate these terms.</p>
        <h3>Disclaimer</h3>
        <p>Spotd is provided "as is" without warranties of any kind. We are not responsible for the accuracy of venue information or user-generated content.</p>
        <h3>Limitation of Liability</h3>
        <p>Spotd shall not be liable for any indirect, incidental, or consequential damages arising from your use of the app.</p>
        <h3>Contact</h3>
        <p>Questions? Email us at <a href="mailto:support@spotd.biz" style="color:var(--accent)">support@spotd.biz</a></p>
      </div>`;
  }
  openOverlay('legalOverlay');
}
function closeLegal(e) { if (e && e.target !== document.getElementById('legalOverlay')) return; closeOverlay('legalOverlay'); }

// ── AGE GATE ─────────────────────────────────────────
function checkAgeGate() {
  if (localStorage.getItem('spotd-age-verified')) return;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'ageGateOverlay';
  overlay.style.zIndex = '99999';
  overlay.innerHTML = `
    <div class="sheet" style="text-align:center">
      <div style="font-size:40px;margin-bottom:8px">🍸</div>
      <div style="font-weight:800;font-size:20px;margin-bottom:8px">Are you 21 or older?</div>
      <p style="color:var(--muted);font-size:14px;margin-bottom:20px;line-height:1.4">
        Spotd features bars, breweries, and happy hour deals.<br>You must be of legal drinking age to continue.
      </p>
      <button class="btn-submit" style="width:100%;margin-bottom:10px" onclick="confirmAge(true)">Yes, I'm 21+</button>
      <button style="width:100%;padding:13px;border-radius:12px;border:1.5px solid var(--border);background:none;color:var(--muted);font-family:'DM Sans',sans-serif;font-size:14px;cursor:pointer" onclick="confirmAge(false)">No, I'm under 21</button>
      <div style="margin-top:16px">
        <a href="#" onclick="event.preventDefault();openLegalPage('privacy')" style="font-size:12px;color:var(--muted)">Privacy Policy</a>
        <span style="color:var(--muted);font-size:12px"> · </span>
        <a href="#" onclick="event.preventDefault();openLegalPage('terms')" style="font-size:12px;color:var(--muted)">Terms of Service</a>
      </div>
    </div>`;
  presentOverlay(overlay);
}
function confirmAge(isOldEnough) {
  if (isOldEnough) {
    localStorage.setItem('spotd-age-verified', '1');
    const overlay = document.getElementById('ageGateOverlay');
    if (overlay) overlay.remove();
  } else {
    document.getElementById('ageGateOverlay').querySelector('.sheet').innerHTML = `
      <div style="font-size:40px;margin-bottom:8px">🚫</div>
      <div style="font-weight:800;font-size:20px;margin-bottom:8px">Sorry!</div>
      <p style="color:var(--muted);font-size:14px;line-height:1.4">
        You must be 21 or older to use Spotd.<br>Come back when you're of legal drinking age!
      </p>`;
  }
}

// ── ACCOUNT DELETION ─────────────────────────────────
async function doDeleteAccount() {
  if (!currentUser) return;
  const confirmed = confirm('Are you sure you want to delete your account? This will permanently remove all your data including reviews, check-ins, favorites, and messages. This cannot be undone.');
  if (!confirmed) return;
  const doubleConfirm = confirm('This is permanent. Type OK to confirm you want to delete your account and all data.');
  if (!doubleConfirm) return;
  try {
    showToast('Deleting account…');
    // Delete user data from all tables
    const userId = currentUser.id;
    await Promise.allSettled([
      db.from('reviews').delete().eq('user_id', userId),
      db.from('check_ins').delete().eq('user_id', userId),
      db.from('favorites').delete().eq('user_id', userId),
      db.from('social_likes').delete().eq('user_id', userId),
      db.from('social_comments').delete().eq('user_id', userId),
      db.from('messages').delete().eq('sender_id', userId),
      db.from('conversation_participants').delete().eq('user_id', userId),
      db.from('activity_feed').delete().eq('user_id', userId),
      db.from('neighborhood_follows').delete().eq('user_id', userId),
      db.from('user_follows').delete().eq('follower_id', userId),
      db.from('user_follows').delete().eq('followed_id', userId),
    ]);
    // Delete profile last
    await db.from('profiles').delete().eq('id', userId);
    // Sign out
    await authSignOut();
    showHome();
    showToast('Account deleted. We\'re sorry to see you go.');
  } catch(e) {
    showToast('Error deleting account. Please email support@spotd.biz');
    console.error('deleteAccount error', e);
  }
}

// ── REPORT / BLOCK ───────────────────────────────────
function openReportMenu(contentType, contentId, userId, isOwn) {
  if (!currentUser) { openAuth('signin'); return; }
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.onclick = e => { if (e.target === overlay) dismissOverlay(overlay); };

  // Retrieve meta from global map (populated during renderSocialItem)
  const meta = window._socialPostMeta?.[contentId] || null;

  if (isOwn === true) {
    // Own post — show delete option
    overlay.innerHTML = `
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div style="font-weight:800;font-size:17px;margin-bottom:16px">Post Options</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="report-option report-option--block" id="deletePostBtn" onclick="doDeletePost('${contentType}','${contentId}',this)">Delete this post</button>
        </div>
      </div>`;
  } else {
    // Other user's post — show report/block options
    overlay.innerHTML = `
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div style="font-weight:800;font-size:17px;margin-bottom:16px">Report</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="report-option" onclick="submitReport('${contentType}','${contentId}','${userId}','spam',this)">Spam or fake</button>
          <button class="report-option" onclick="submitReport('${contentType}','${contentId}','${userId}','inappropriate',this)">Inappropriate or offensive</button>
          <button class="report-option" onclick="submitReport('${contentType}','${contentId}','${userId}','harassment',this)">Harassment or bullying</button>
          <button class="report-option" onclick="submitReport('${contentType}','${contentId}','${userId}','misinformation',this)">False information</button>
        </div>
        ${userId && userId !== currentUser.id ? `
          <div style="border-top:1px solid var(--border);margin-top:16px;padding-top:16px">
            <button class="report-option report-option--block" onclick="doBlockUser('${userId}',this)">Block this user</button>
          </div>` : ''}
      </div>`;
  }
  overlay._postMeta = meta;
  presentOverlay(overlay);
}

async function submitReport(contentType, contentId, reportedUserId, reason, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Reporting…'; }
  try {
    await db.from('reports').insert({
      reporter_id: currentUser.id,
      content_type: contentType,
      content_id: contentId,
      reported_user_id: reportedUserId || null,
      reason: reason,
    });
    const overlay = btn?.closest('.overlay');
    if (overlay) dismissOverlay(overlay);
    showToast('Reported. We\'ll review this shortly.');
  } catch(e) {
    showToast('Report sent. Thank you.');
    const overlay = btn?.closest('.overlay');
    if (overlay) dismissOverlay(overlay);
  }
}

async function doBlockUser(userId, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Blocking…'; }
  try {
    await db.from('blocked_users').insert({
      blocker_id: currentUser.id,
      blocked_id: userId,
    });
    const overlay = btn?.closest('.overlay');
    if (overlay) dismissOverlay(overlay);
    showToast('User blocked. You won\'t see their content.');
  } catch(e) {
    showToast('User blocked.');
    const overlay = btn?.closest('.overlay');
    if (overlay) dismissOverlay(overlay);
  }
}

async function doDeletePost(postType, postId, btn) {
  // Two-tap confirmation (confirm() is blocked in iOS WKWebView)
  if (!btn._confirmed) {
    btn._confirmed = true;
    btn.textContent = 'Tap again to confirm';
    btn.style.background = 'var(--coral)';
    btn.style.color = '#fff';
    setTimeout(() => {
      if (btn && btn._confirmed) {
        btn._confirmed = false;
        btn.textContent = 'Delete this post';
        btn.style.background = '';
        btn.style.color = '';
      }
    }, 3000);
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
  try {
    const overlay = btn?.closest('.overlay');
    const meta = overlay?._postMeta || null;
    await deleteActivityPost(postId, postType, meta);
    if (overlay) dismissOverlay(overlay);
    showToast('Post deleted');
    _socialLoading = false;
    loadSocialFeed();
  } catch(e) {
    console.error('doDeletePost error:', e);
    showToast('Could not delete — try again');
    if (btn) { btn.disabled = false; btn.textContent = 'Delete this post'; btn._confirmed = false; }
  }
}

// ── APPLE SIGN IN ────────────────────────────────────
async function doAppleSignIn() {
  if(typeof haptic==='function')haptic('medium');
  track('login_attempt', { method: 'apple' });
  try {
    // On native iOS, use skipBrowserRedirect so we can route through ASWebAuthenticationSession
    if (window.spotdNative?.openOAuth) {
      const { data, error } = await db.auth.signInWithOAuth({
        provider: 'apple',
        options: {
          redirectTo: 'spotd://auth-callback',
          skipBrowserRedirect: true,
        }
      });
      if (error) throw error;
      if (data?.url) window.spotdNative.openOAuth(data.url);
      return { data, error: null };
    }
    const { data, error } = await db.auth.signInWithOAuth({
      provider: 'apple',
      options: {
        redirectTo: window.location.origin + '/?auth_callback=1',
      }
    });
    if (error) throw error;
    return { data, error: null };
  } catch(e) {
    showToast('Error: ' + e.message);
    return { error: { message: e.message } };
  }
}

// ── ADMIN INLINE EDIT ────────────────────────────────
function adminEditVenue(id) {
  const v = state.venues.find(x => x.id === id);
  if (!v || !isAdmin()) return;

  const amenityKeys = ['has_happy_hour','has_sports_tv','is_dog_friendly','has_live_music','has_karaoke','has_trivia','has_bingo','has_comedy'];
  const amenityLabels = { has_happy_hour:'Happy Hour', has_sports_tv:'Sports TV', is_dog_friendly:'Dog Friendly', has_live_music:'Live Music', has_karaoke:'Karaoke', has_trivia:'Trivia', has_bingo:'Bingo', has_comedy:'Comedy' };

  document.getElementById('modalContent').innerHTML = `
    <div class="admin-edit-form">
      <div class="admin-edit-header">
        <span class="admin-edit-title">Edit Venue</span>
        <button class="admin-edit-cancel" onclick="openModal('${id}','venue')">Cancel</button>
      </div>
      <div class="admin-field"><label>Name</label><input id="ae-name" value="${esc(v.name || '')}"></div>
      <div class="admin-field"><label>Neighborhood</label><input id="ae-neighborhood" value="${esc(v.neighborhood || '')}"></div>
      <div class="admin-field"><label>Address</label><input id="ae-address" value="${esc(v.address || '')}"></div>
      <div class="admin-field"><label>Cuisine</label><input id="ae-cuisine" value="${esc(v.cuisine || '')}"></div>
      <div class="admin-field"><label>Hours</label><input id="ae-hours" value="${esc(v.hours || '')}" placeholder="e.g. 11am – 10pm"></div>
      <div class="admin-field"><label>Website URL</label><input id="ae-url" value="${esc(v.url || '')}"></div>
      <div class="admin-field">
        <label>Days Open</label>
        <div class="admin-days">${DAYS.map(d => `<button class="admin-day-btn${(v.days || []).includes(d) ? ' on' : ''}" onclick="this.classList.toggle('on')" data-day="${d}">${d}</button>`).join('')}</div>
      </div>
      <div class="admin-field">
        <label>Deals (one per line)</label>
        <textarea id="ae-deals" rows="4" placeholder="$5 margaritas Mon-Fri 4-6pm">${(v.deals || []).join('\n')}</textarea>
      </div>
      <div class="admin-field">
        <label>Promo Code</label>
        <input id="ae-promo" value="${esc(v.promo_code || '')}">
      </div>
      <div class="admin-field">
        <label>Promo Description</label>
        <input id="ae-promo-desc" value="${esc(v.promo_description || '')}">
      </div>
      <div class="admin-field">
        <label>Photo URL</label>
        <input id="ae-photo" value="${esc(v.photo_url || '')}">
      </div>
      <div class="admin-field">
        <label>Amenities</label>
        <div class="admin-amenities">${amenityKeys.map(k => `<label class="admin-amenity-check"><input type="checkbox" data-key="${k}" ${v[k] ? 'checked' : ''}><span>${amenityLabels[k]}</span></label>`).join('')}</div>
      </div>
      <button class="admin-save-btn" onclick="adminSaveVenue('${id}')">Save Changes</button>
    </div>`;
}

async function adminSaveVenue(id) {
  if (!isAdmin() || !_accessToken) return;
  const btn = document.querySelector('.admin-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  const days = [...document.querySelectorAll('.admin-day-btn.on')].map(b => b.dataset.day);
  const dealsRaw = document.getElementById('ae-deals').value.trim();
  const deals = dealsRaw ? dealsRaw.split('\n').map(d => d.trim()).filter(Boolean) : [];

  const amenities = {};
  document.querySelectorAll('.admin-amenities input[type=checkbox]').forEach(cb => {
    amenities[cb.dataset.key] = cb.checked;
  });

  const payload = {
    name: document.getElementById('ae-name').value.trim(),
    neighborhood: document.getElementById('ae-neighborhood').value.trim() || null,
    address: document.getElementById('ae-address').value.trim() || null,
    cuisine: document.getElementById('ae-cuisine').value.trim() || null,
    hours: document.getElementById('ae-hours').value.trim() || null,
    url: document.getElementById('ae-url').value.trim() || null,
    days: days,
    deals: deals.length ? deals : null,
    promo_code: document.getElementById('ae-promo').value.trim() || null,
    promo_description: document.getElementById('ae-promo-desc').value.trim() || null,
    photo_url: document.getElementById('ae-photo').value.trim() || null,
    ...amenities
  };

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/venues?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${_accessToken}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error('Save failed');

    // Update local cache
    const v = state.venues.find(x => x.id === id);
    if (v) Object.assign(v, payload);

    openModal(id, 'venue');
    if (typeof haptic === 'function') haptic('success');
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }
    alert('Save failed: ' + e.message);
  }
}

// ── BOOT ──────────────────────────────────────────────
// Called here — after ALL functions above are defined —
// so onAuthChange exists when initAuth fires the callback.
checkAgeGate();
initAuth();
