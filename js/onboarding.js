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
  totalScreens: 5,
  selectedVibes: new Set(),
  selectedNeighborhood: null,
  liveCount: 47,
};

const OB_NEIGHBORHOODS = [
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
];

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
// Featured venues rotate each visit so the onboarding feels fresh
const OB_FEATURED_VENUES = [
  { name: 'Coin-Op Game Room',  deal: '$5 arcade tokens + $6 craft beers',  hood: 'North Park',    time: 'HH 4\u20137pm' },
  { name: 'Kettner Exchange',   deal: '$8 cocktails + $2 oysters',          hood: 'Little Italy',  time: 'HH 4\u20136pm' },
  { name: 'Wonderland OB',      deal: '$5 margs + ocean view',             hood: 'Ocean Beach',   time: 'HH 3\u20136pm' },
  { name: 'The Grass Skirt',    deal: '$7 tiki cocktails',                  hood: 'Pacific Beach', time: 'HH 4\u20137pm' },
  { name: 'Raised by Wolves',   deal: '$10 speakeasy cocktails',            hood: 'East Village',  time: 'HH 5\u20137pm' },
  { name: 'Cannonball',         deal: '$6 poolside margs',                  hood: 'Mission Beach', time: 'HH 3\u20135pm' },
  { name: 'Craft & Commerce',   deal: '$7 old fashioneds',                  hood: 'Little Italy',  time: 'HH 5\u20137pm' },
  { name: 'Fairweather',        deal: '$6 rooftop spritzes',                hood: 'North Park',    time: 'HH 4\u20136pm' },
];

// Map pin configs that rotate
const OB_MAP_PIN_SETS = [
  { primary: { hood: 'North Park', deals: 8, top: '32%', left: '38%' },  secondary: { hood: 'Downtown', deals: 12, top: '18%', right: '22%' } },
  { primary: { hood: 'Little Italy', deals: 9, top: '25%', left: '30%' }, secondary: { hood: 'Pacific Beach', deals: 7, top: '40%', right: '20%' } },
  { primary: { hood: 'Gaslamp', deals: 6, top: '35%', left: '45%' },     secondary: { hood: 'Ocean Beach', deals: 4, top: '20%', right: '28%' } },
  { primary: { hood: 'Hillcrest', deals: 5, top: '28%', left: '35%' },   secondary: { hood: 'East Village', deals: 6, top: '42%', right: '18%' } },
];

// Screen 1 headlines rotate
const OB_SCREEN1_HEADLINES = [
  { title: '{count} deals are live right now.', sub: 'See what\u2019s happening tonight near you.' },
  { title: '{count} happy hours happening now.', sub: 'The best deals in San Diego, updated live.' },
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
  { title: 'Where in San Diego?',              sub: '{total} deals live across the city tonight' },
  { title: 'Pick your neighborhood.',           sub: '{total} spots are serving deals right now' },
  { title: 'Where are you headed tonight?',     sub: '{total} happy hours live across San Diego' },
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
const OB_PROGRESS = [20, 40, 58, 76, 92];

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
  obGoTo(0);
  obPopulateDynamic();
  obRenderVibes();
  obStartLiveCounter();
}

// ── DYNAMIC CONTENT ───────────────────────────────────
function obPopulateDynamic() {
  // Screen 1: featured venue + map pins + headline
  var feat = _obPick(OB_FEATURED_VENUES);
  var pins = _obPick(OB_MAP_PIN_SETS);
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
  if (s1s) s1s.textContent = h1.sub;

  // Screen 2 headline
  var h2  = _obPick(OB_SCREEN2_HEADLINES);
  var s2t = document.getElementById('obScreen2Title');
  var s2s = document.getElementById('obScreen2Sub');
  if (s2t) s2t.textContent = h2.title;
  if (s2s) s2s.textContent = h2.sub;

  // Screen 3 headline (total gets filled at render time)
  var h3  = _obPick(OB_SCREEN3_HEADLINES);
  obState._screen3Headline = h3;
  var s3t = document.getElementById('obScreen3Title');
  if (s3t) s3t.textContent = h3.title;
}

function obComplete() {
  localStorage.setItem(OB_KEY, '1');
  localStorage.removeItem('spotd-ob-pending');
  _obDismiss();
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

  if (idx === 3) obRenderNeighborhoods();
  if (idx === 4) obUpdateSignupScreen();
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
  obComplete();
}

// ── PROGRESS BAR ───────────────────────────────────────
function obUpdateProgress(screen) {
  const fill = document.getElementById('obProgressFill');
  if (fill) fill.style.width = (OB_PROGRESS[screen] ?? 20) + '%';
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
  var shuffled = _obShuffle(OB_NEIGHBORHOODS);
  var popIdx = Math.floor(Math.random() * Math.min(3, shuffled.length)); // top 3 get a chance

  const total = shuffled.reduce((s, n) => s + n.deals, 0);

  // Update screen 3 subtitle with total
  var h3 = obState._screen3Headline;
  var s3s = document.getElementById('obScreen3Sub');
  if (s3s && h3) s3s.textContent = h3.sub.replace('{total}', total);
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
  const n    = obState.selectedNeighborhood;
  const hood = n ? n.name : 'San Diego';
  const cnt  = n ? n.deals : 23;
  const hl   = document.getElementById('obSignupHeadline');
  if (hl) hl.textContent = `We found ${cnt} happy hours matching your vibe in ${hood}`;
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
  // Close onboarding, open standard auth modal with email pre-filled
  _obDismiss();
  if (typeof openAuth === 'function') openAuth('signup');
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
