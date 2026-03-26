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
];

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
  obRenderVibes();
  obStartLiveCounter();
}

function obComplete() {
  localStorage.setItem(OB_KEY, '1');
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
  grid.innerHTML = OB_VIBES.map(v => `
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

  const total = OB_NEIGHBORHOODS.reduce((s, n) => s + n.deals, 0);
  const banner = document.getElementById('obTotalDeals');
  if (banner) banner.textContent = total;

  grid.innerHTML = OB_NEIGHBORHOODS.map(n => `
    <button class="ob-neigh-btn${n.popular ? ' ob-neigh-btn--popular' : ''}"
            onclick="obSelectNeighborhood('${n.name}',${n.deals},this)">
      ${n.popular ? '<span class="ob-popular-badge">🔥 Most popular tonight</span>' : ''}
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
