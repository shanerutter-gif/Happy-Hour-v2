/* ═══════════════════════════════════════════════════════
   SPOTD — High-Conversion Onboarding Flow
   Entry → Value Preview → Vibe Picker → Neighborhood → Signup
   Research: Duolingo model, endowed progress, micro-commitments,
             loss aversion, real-time social proof
   ═══════════════════════════════════════════════════════ */

const OB_KEY = 'spotd-ob-complete';

// ── STATE ──────────────────────────────────────────────
const obState = {
  screen: 0,
  totalScreens: 8,
  citySlug: 'san-diego',       // chosen on the city-picker screen (screen 1)
  selectedVibes: new Set(),
  selectedNeighborhood: null,
  selectedAttribution: null,  // e.g. 'instagram', 'tiktok', 'friend'
  liveCount: 47,
};

const OB_ATTRIBUTION_KEY = 'spotd_pending_attribution';

// ── PER-CITY ONBOARDING CONTENT ───────────────────────
// To launch a new city in onboarding, add an entry here (see CLAUDE.md
// "Launching a new city" checklist) AND flip its `active` flag in CITIES
// (js/app.js). The city-picker screen renders one button per key below, so a
// city only appears in onboarding once it has real neighborhoods + venues here.
const OB_CITY_CONFIG = {
  'san-diego': {
    name: 'San Diego', state: 'CA', tagline: '490+ spots live',
    neighborhoods: [
      { name: 'North Park',    deals: 8,  popular: true  },
      { name: 'Downtown',      deals: 12, popular: false },
      { name: 'Little Italy',  deals: 9,  popular: false },
      { name: 'Gaslamp',       deals: 6,  popular: false },
      { name: 'Pacific Beach', deals: 7,  popular: false },
      { name: 'Hillcrest',     deals: 5,  popular: false },
      { name: 'East Village',  deals: 6,  popular: false },
      { name: 'Ocean Beach',   deals: 4,  popular: false },
      { name: 'La Jolla',      deals: 3,  popular: false },
      { name: 'Mission Hills', deals: 5,  popular: false },
    ],
    featured: [
      { name: 'Coin-Op Game Room',  deal: '$5 arcade tokens + $6 craft beers',  hood: 'North Park',    time: 'HH 4–7pm' },
      { name: 'Kettner Exchange',   deal: '$8 cocktails + $2 oysters',          hood: 'Little Italy',  time: 'HH 4–6pm' },
      { name: 'Wonderland OB',      deal: '$5 margs + ocean view',              hood: 'Ocean Beach',   time: 'HH 3–6pm' },
      { name: 'The Grass Skirt',    deal: '$7 tiki cocktails',                  hood: 'Pacific Beach', time: 'HH 4–7pm' },
      { name: 'Raised by Wolves',   deal: '$10 speakeasy cocktails',            hood: 'East Village',  time: 'HH 5–7pm' },
      { name: 'Cannonball',         deal: '$6 poolside margs',                  hood: 'Mission Beach', time: 'HH 3–5pm' },
      { name: 'Craft & Commerce',   deal: '$7 old fashioneds',                  hood: 'Little Italy',  time: 'HH 5–7pm' },
      { name: 'Fairweather',        deal: '$6 rooftop spritzes',                hood: 'North Park',    time: 'HH 4–6pm' },
    ],
    mapPins: [
      { primary: { hood: 'North Park', deals: 8, top: '32%', left: '38%' },  secondary: { hood: 'Downtown', deals: 12, top: '18%', right: '22%' } },
      { primary: { hood: 'Little Italy', deals: 9, top: '25%', left: '30%' }, secondary: { hood: 'Pacific Beach', deals: 7, top: '40%', right: '20%' } },
      { primary: { hood: 'Gaslamp', deals: 6, top: '35%', left: '45%' },     secondary: { hood: 'Ocean Beach', deals: 4, top: '20%', right: '28%' } },
      { primary: { hood: 'Hillcrest', deals: 5, top: '28%', left: '35%' },   secondary: { hood: 'East Village', deals: 6, top: '42%', right: '18%' } },
    ],
  },
  'orange-county': {
    name: 'Orange County', state: 'CA', tagline: '220+ spots live',
    neighborhoods: [
      { name: 'Newport Beach',    deals: 24, popular: true  },
      { name: 'Costa Mesa',       deals: 24, popular: false },
      { name: 'Santa Ana',        deals: 20, popular: false },
      { name: 'Huntington Beach', deals: 15, popular: false },
      { name: 'Anaheim',          deals: 15, popular: false },
      { name: 'Fullerton',        deals: 12, popular: false },
      { name: 'Laguna Beach',     deals: 10, popular: false },
      { name: 'Irvine',           deals: 10, popular: false },
    ],
    featured: [
      { name: 'Don The Beachcomber', deal: '$6 Mai Tais + tiki cocktails',        hood: 'Huntington Beach', time: 'HH 3–7pm' },
      { name: 'Pacific Hideaway',    deal: '$10 cocktails + $7 tacos',            hood: 'Newport Beach',    time: 'HH 4–6pm' },
      { name: 'The Cliff Restaurant',deal: 'Half-off apps + ocean views',         hood: 'Laguna Beach',     time: 'HH 3–6pm' },
      { name: 'Culinary Dropout',    deal: '$5 craft beers + half-off pretzels',  hood: 'Costa Mesa',       time: 'HH 3–6pm' },
      { name: 'The Blind Rabbit',    deal: '$8 speakeasy cocktails',              hood: 'Anaheim',          time: 'HH 4–7pm' },
      { name: 'Bosscat Kitchen',     deal: 'Half-off whiskey + $5 beer',          hood: 'Newport Beach',    time: 'HH 4–6pm' },
      { name: 'Steamers',            deal: '$5 wells + live jazz',                hood: 'Fullerton',        time: 'HH 5–8pm' },
      { name: 'Mozambique',          deal: '$7 cocktails + $6 wine',              hood: 'Laguna Beach',     time: 'HH 4–7pm' },
    ],
    mapPins: [
      { primary: { hood: 'Newport Beach', deals: 24, top: '32%', left: '38%' },    secondary: { hood: 'Costa Mesa', deals: 24, top: '18%', right: '22%' } },
      { primary: { hood: 'Huntington Beach', deals: 15, top: '25%', left: '30%' }, secondary: { hood: 'Santa Ana', deals: 20, top: '40%', right: '20%' } },
      { primary: { hood: 'Laguna Beach', deals: 10, top: '35%', left: '45%' },     secondary: { hood: 'Anaheim', deals: 15, top: '20%', right: '28%' } },
      { primary: { hood: 'Costa Mesa', deals: 24, top: '28%', left: '35%' },       secondary: { hood: 'Fullerton', deals: 12, top: '42%', right: '18%' } },
    ],
  },
};

// Returns the config for the currently selected onboarding city (defaults to SD).
function obCity() {
  return OB_CITY_CONFIG[obState.citySlug] || OB_CITY_CONFIG['san-diego'];
}

const OB_VIBES = [
  { id: 'cocktails', emoji: '🍸', label: 'Craft cocktails' },
  { id: 'dive',      emoji: '🍺', label: 'Dive bars'       },
  { id: 'rooftop',   emoji: '🌅', label: 'Rooftop views'   },
  { id: 'music',     emoji: '🎵', label: 'Live music'      },
  { id: 'wine',      emoji: '🍷', label: 'Wine bars'       },
  { id: 'food',      emoji: '🌮', label: 'Food + drinks'   },
  { id: 'brunch',    emoji: '🥂', label: 'Boozy brunch'    },
  { id: 'sports',    emoji: '🏈', label: 'Sports bars'     },
  { id: 'tiki',      emoji: '🌴', label: 'Tiki bars'       },
  { id: 'date',      emoji: '💕', label: 'Date night'      },
];

// ── DYNAMIC CONTENT POOLS ─────────────────────────────
// (Featured venues, map pins and neighborhoods are now per-city — see
// OB_CITY_CONFIG above. The rotating headline pools below are city-neutral;
// any {city} token is replaced at render time with the selected city name.)

// Screen 1 headlines rotate
const OB_SCREEN1_HEADLINES = [
  { title: '{count} deals are live right now.', sub: 'See what\u2019s happening tonight near you.' },
  { title: '{count} happy hours happening now.', sub: 'The best deals in {city}, updated live.' },
  { title: '{count} spots are popping off tonight.', sub: 'Find out where the locals are heading.' },
  { title: 'Tonight looks good \u2014 {count} deals live.', sub: 'Don\u2019t miss what\u2019s happening near you.' },
];

// Screen 2 (vibe) headlines rotate
const OB_SCREEN2_HEADLINES = [
  { title: 'What\u2019s your vibe tonight?',    sub: 'Pick all that apply \u2014 we\u2019ll show you the best spots.' },
  { title: 'What are you in the mood for?',     sub: 'Choose a few \u2014 we\u2019ll match you with the best deals.' },
  { title: 'Tell us what you\u2019re into.',     sub: 'We\u2019ll curate the perfect night for you.' },
  { title: 'How do you like to go out?',         sub: 'Pick your favorites and we\u2019ll do the rest.' },
];

// Screen 3 (neighborhood) headlines rotate
const OB_SCREEN3_HEADLINES = [
  { title: 'Where in {city}?',                  sub: '{total} deals live across the city tonight' },
  { title: 'Pick your neighborhood.',           sub: '{total} spots are serving deals right now' },
  { title: 'Where are you headed tonight?',     sub: '{total} happy hours live across {city}' },
  { title: 'Choose your turf.',                 sub: 'We\u2019ve got {total} deals waiting for you' },
];

function _obPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function _obShuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// Endowed progress — starts partially filled
const OB_PROGRESS = [14, 28, 42, 58, 72, 86, 96];

// ── VISIBILITY ─────────────────────────────────────────
function obShouldShow() {
  if (typeof currentUser !== 'undefined' && currentUser) return false;
  if (localStorage.getItem(OB_KEY)) return false;
  // Don't show if a stored Supabase session exists (user is logged in but auth hasn't resolved)
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) return false;
  }
  return true;
}

function obInit() {
  if (!obShouldShow()) return;
  const overlay = document.getElementById('onboardingOverlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  overlay.style.opacity = '1';
  if (!obState._started) {
    obState._started = true;
    if (typeof track === 'function') track('onboarding_started', {});
  }
  obGoTo(0);
  obRenderCities();
  obPopulateDynamic();
  obRenderVibes();
  obStartLiveCounter();
}

// ── CITY PICKER (Screen 1) ────────────────────────────
// Renders one button per launch-ready city. A city only appears here once it
// has an entry in OB_CITY_CONFIG, so the picker can never offer an empty city.
function obRenderCities() {
  var grid = document.getElementById('obCityGrid');
  if (!grid) return;
  grid.innerHTML = Object.keys(OB_CITY_CONFIG).map(function (slug) {
    var c = OB_CITY_CONFIG[slug];
    var sel = slug === obState.citySlug ? ' ob-neigh-btn--selected' : '';
    return '<button class="ob-neigh-btn ob-city-btn' + sel + '" onclick="obSelectCity(\'' + slug + '\',this)">'
      + '<span class="ob-neigh-name">' + c.name + ', ' + c.state + '</span>'
      + '<span class="ob-neigh-deals">' + c.tagline + '</span>'
      + '</button>';
  }).join('');
}

function obSelectCity(slug, el) {
  if (typeof haptic === 'function') haptic('medium');
  obState.citySlug = OB_CITY_CONFIG[slug] ? slug : 'san-diego';
  document.querySelectorAll('.ob-city-btn').forEach(function (b) { b.classList.remove('ob-neigh-btn--selected'); });
  if (el) el.classList.add('ob-neigh-btn--selected');
  // Persist so the app drops the user into the city they picked once they
  // sign up or skip (enterCity reads 'spotd-last-city' on next load).
  try { localStorage.setItem('spotd-last-city', obState.citySlug); } catch (e) {}
  if (typeof track === 'function') track('onboarding_city_selected', { city_slug: obState.citySlug });
  // Refresh the city-specific screens (map preview, neighborhoods, headlines).
  obPopulateDynamic();
  var grid = document.getElementById('obNeighGrid');
  if (grid) grid.dataset.rendered = '';
  setTimeout(function () { obNext(); }, 300);
}

// ── DYNAMIC CONTENT ───────────────────────────────────
function obPopulateDynamic() {
  // Screen 2 (value preview): featured venue + map pins + headline, all
  // pulled from the currently selected city's config.
  var city = obCity();
  var feat = _obPick(city.featured);
  var pins = _obPick(city.mapPins);
  var h1   = _obPick(OB_SCREEN1_HEADLINES);

  var mapCard = document.getElementById('obMapCardName');
  var mapDeal = document.getElementById('obMapCardDeal');
  var mapMeta = document.getElementById('obMapCardMeta');
  if (mapCard) mapCard.textContent = feat.name;
  if (mapDeal) mapDeal.textContent = feat.deal + ' \u00B7 ' + feat.time;
  if (mapMeta) mapMeta.innerHTML = feat.hood + ' \u00B7 Ends in <span class="ob-timer">' + (Math.floor(Math.random()*3)+1) + 'h ' + (Math.floor(Math.random()*50)+10) + 'm</span>';

  // Preview cards
  var pc1 = document.getElementById('obPreviewVenue');
  var pd1 = document.getElementById('obPreviewDeal');
  var pt1 = document.getElementById('obPreviewTag');
  if (pc1) pc1.textContent = feat.name;
  if (pd1) pd1.textContent = feat.deal + ' \u00B7 ' + feat.time;
  if (pt1) pt1.textContent = feat.hood;

  // Map pin labels
  var pin1 = document.getElementById('obPin1Label');
  var pin2 = document.getElementById('obPin2Label');
  if (pin1) pin1.textContent = pins.primary.hood + ' \u00B7 ' + pins.primary.deals + ' deals';
  if (pin2) pin2.textContent = pins.secondary.hood + ' \u00B7 ' + pins.secondary.deals + ' deals';

  // Screen 1 headline
  var s1t = document.getElementById('obScreen1Title');
  var s1s = document.getElementById('obScreen1Sub');
  if (s1t) s1t.innerHTML = h1.title.replace('{count}', '<span class="ob-live-num">' + obState.liveCount + '</span>');
  if (s1s) s1s.textContent = h1.sub.replace('{city}', city.name);

  // Screen 2 (vibe) copy is intentionally fixed/verbatim in index.html
  // ("What are you into?" / "Pick a few — we'll tune your feed…") so it no
  // longer rotates from OB_SCREEN2_HEADLINES.

  // Screen 3 headline (total gets filled at render time)
  var h3  = _obPick(OB_SCREEN3_HEADLINES);
  obState._screen3Headline = h3;
  var s3t = document.getElementById('obScreen3Title');
  if (s3t) s3t.textContent = h3.title.replace('{city}', city.name);
}

// Shared finalize: mark onboarding done + dismiss. Fires NO analytics —
// onboarding_completed fires in obGoTo when the final screen is reached, so
// skips can never count as completions again.
function _obFinalize() {
  localStorage.setItem(OB_KEY, '1');
  localStorage.removeItem('spotd-ob-pending');
  _obDismiss();
}

// Legacy entry point (kept in case anything still calls it) — finalize only.
function obComplete() {
  _obFinalize();
}

// Dismiss without marking complete (e.g. going to sign-in)
function closeOb() {
  _obDismiss();
}

function _obDismiss() {
  const overlay = document.getElementById('onboardingOverlay');
  if (!overlay || overlay.style.display === 'none') return;
  overlay.style.transition = 'opacity 0.35s ease';
  overlay.style.opacity = '0';
  setTimeout(() => { overlay.style.display = 'none'; }, 350);
}

// ── NAVIGATION ─────────────────────────────────────────
function obGoTo(idx) {
  const screens = document.querySelectorAll('.ob-screen');
  const prev = obState.screen;

  screens.forEach((s, i) => {
    s.classList.remove('ob-screen--active', 'ob-screen--prev', 'ob-screen--next');
    if (i === idx)        s.classList.add('ob-screen--active');
    else if (i < idx)     s.classList.add('ob-screen--prev');
    else                  s.classList.add('ob-screen--next');
  });

  obState.screen = idx;
  obUpdateProgress(idx);

  if (obState._lastViewedScreen !== idx) {
    obState._lastViewedScreen = idx;
    if (typeof track === 'function') track('onboarding_screen_viewed', { screen: idx });
    // Reaching the auth wall (last screen) = genuine completion of the
    // onboarding content. Guest skips from here fire guest_skip instead.
    if (idx === obState.totalScreens - 1 && !obState._completedTracked) {
      obState._completedTracked = true;
      if (typeof track === 'function') {
        track('onboarding_completed', { last_screen: idx });
        track('auth_sheet_shown', { context: 'onboarding' });
      }
    }
  }

  // DOM order of .ob-screen elements (the social-preview screen was inserted
  // before signup):
  // 0 entry · 1 city · 2 map · 3 vibe · 4 neighborhoods · 5 attribution · 6 social · 7 signup
  if (idx === 4) obRenderNeighborhoods();
  if (idx === 7) obUpdateSignupScreen();
}

// ── ATTRIBUTION (Screen 4) ────────────────────────────
function obSelectAttribution(source, el) {
  if (typeof haptic === 'function') haptic('medium');
  document.querySelectorAll('.ob-attr-btn').forEach(b => b.classList.remove('ob-attr-btn--selected'));
  if (el) el.classList.add('ob-attr-btn--selected');
  obState.selectedAttribution = source;
  try { sessionStorage.setItem(OB_ATTRIBUTION_KEY, source); } catch (e) {}
  if (typeof track === 'function') track('attribution_selected', { source: source });
  // Auto-advance so the user doesn't have to tap a second time
  setTimeout(() => obNext(), 350);
}

function obAttributionSkip() {
  obState.selectedAttribution = null;
  try { sessionStorage.removeItem(OB_ATTRIBUTION_KEY); } catch (e) {}
  obNext();
}

function obNext() {
  if (typeof haptic === 'function') haptic('light');
  obGoTo(Math.min(obState.screen + 1, obState.totalScreens - 1));
}

function obBack() {
  if (typeof haptic === 'function') haptic('light');
  obGoTo(Math.max(obState.screen - 1, 0));
}

function obSkip() {
  if (typeof track === 'function') track('onboarding_skipped', { from_screen: obState.screen });
  _obFinalize();
}

// Auth-wall "Skip for now — browse as guest" button (index.html). Counts as a
// guest skip + onboarding skip, never as a completion.
function obGuestSkip() {
  if (typeof track === 'function') track('guest_skip', { context: 'onboarding' });
  obSkip();
}

// ── PROGRESS DOTS ──────────────────────────────────────
function obUpdateProgress(screen) {
  const dots = document.querySelectorAll('.ob-dot');
  dots.forEach((d, i) => {
    d.classList.toggle('ob-dot--active', i <= screen);
  });
}

// ── LIVE COUNTER ───────────────────────────────────────
function obStartLiveCounter() {
  setInterval(() => {
    const delta = Math.floor(Math.random() * 5) - 2;
    obState.liveCount = Math.max(32, Math.min(89, obState.liveCount + delta));
    document.querySelectorAll('.ob-live-num').forEach(el => {
      el.textContent = obState.liveCount;
    });
  }, 4500);
}

// ── VIBE PICKER ────────────────────────────────────────
function obRenderVibes() {
  const grid = document.getElementById('obVibeGrid');
  if (!grid) return;
  // Shuffle and pick 6 so vibes feel fresh each visit
  const vibes = _obShuffle(OB_VIBES).slice(0, 6);
  grid.innerHTML = vibes.map(v => `
    <button class="ob-vibe-card" onclick="obToggleVibe('${v.id}',this)" data-vibe="${v.id}">
      <span class="ob-vibe-emoji">${v.emoji}</span>
      <span class="ob-vibe-label">${v.label}</span>
    </button>
  `).join('');
}

function obToggleVibe(id, el) {
  if (typeof haptic === 'function') haptic('light');
  if (obState.selectedVibes.has(id)) {
    obState.selectedVibes.delete(id);
    el.classList.remove('ob-vibe-card--selected');
  } else {
    obState.selectedVibes.add(id);
    el.classList.add('ob-vibe-card--selected');
  }
  const cta = document.getElementById('obVibeCta');
  if (cta) cta.textContent = obState.selectedVibes.size > 0 ? "That's my vibe →" : "Skip for now →";
}

// ── NEIGHBORHOOD PICKER ────────────────────────────────
function obRenderNeighborhoods() {
  const grid = document.getElementById('obNeighGrid');
  if (!grid || grid.dataset.rendered) return;
  grid.dataset.rendered = '1';

  // Shuffle neighborhoods and randomly assign "popular" badge to one
  var shuffled = _obShuffle(obCity().neighborhoods);
  var popIdx = Math.floor(Math.random() * Math.min(3, shuffled.length)); // top 3 get a chance

  const total = shuffled.reduce((s, n) => s + n.deals, 0);

  // Update screen 3 subtitle with total
  var h3 = obState._screen3Headline;
  var s3s = document.getElementById('obScreen3Sub');
  if (s3s && h3) s3s.textContent = h3.sub.replace('{total}', total).replace('{city}', obCity().name);
  var banner = document.getElementById('obTotalDeals');
  if (banner) banner.textContent = total;

  grid.innerHTML = shuffled.map((n, i) => `
    <button class="ob-neigh-btn${i === popIdx ? ' ob-neigh-btn--popular' : ''}"
            onclick="obSelectNeighborhood('${n.name}',${n.deals},this)">
      ${i === popIdx ? '<span class="ob-popular-badge">\uD83D\uDD25 Most popular tonight</span>' : ''}
      <span class="ob-neigh-name">${n.name}</span>
      <span class="ob-neigh-deals">${n.deals} deals live</span>
    </button>
  `).join('');
}

function obSelectNeighborhood(name, deals, el) {
  if (typeof haptic === 'function') haptic('medium');
  document.querySelectorAll('.ob-neigh-btn').forEach(b => b.classList.remove('ob-neigh-btn--selected'));
  el.classList.add('ob-neigh-btn--selected');
  obState.selectedNeighborhood = { name, deals };
  setTimeout(() => obNext(), 300);
}

// ── SIGNUP SCREEN ──────────────────────────────────────
function obUpdateSignupScreen() {
  // Auth-wall copy is fixed/verbatim now (the personalized "we found N…"
  // headline was replaced). Kept as a function so obGoTo still has a hook if we
  // want to re-personalize later.
  const hl = document.getElementById('obSignupHeadline');
  if (hl) hl.textContent = "You're in. Let's make it yours.";
}

// ── EMAIL FLOW ─────────────────────────────────────────
function obDoEmailSignup() {
  const emailEl = document.getElementById('obEmailInput');
  if (!emailEl) return;
  const email = emailEl.value.trim();
  if (!email || !email.includes('@')) {
    _obShake(emailEl);
    if (typeof showToast === 'function') showToast('Enter a valid email to continue');
    return;
  }
  if (typeof haptic === 'function') haptic('medium');
  if (typeof track === 'function') track('auth_method_clicked', { method: 'email' });
  // Close onboarding, open standard auth modal with email pre-filled
  _obDismiss();
  if (typeof openAuth === 'function') openAuth('signup', 'onboarding');
  setTimeout(() => {
    const aEmail = document.getElementById('aEmail');
    if (aEmail && email) aEmail.value = email;
  }, 150);
}

function _obShake(el) {
  el.style.animation = 'none';
  el.offsetHeight; // reflow
  el.style.animation = 'obShake 0.4s ease';
  setTimeout(() => { el.style.animation = ''; }, 400);
}

// ── SOCIAL AUTH ────────────────────────────────────────
function obDoGoogle() {
  if (typeof haptic === 'function') haptic('medium');
  localStorage.setItem('spotd-ob-pending', '1');
  if (typeof doGoogleSignIn === 'function') doGoogleSignIn();
}

function obDoApple() {
  if (typeof haptic === 'function') haptic('medium');
  localStorage.setItem('spotd-ob-pending', '1');
  if (typeof doAppleSignIn === 'function') doAppleSignIn();
}
