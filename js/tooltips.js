/* ═══════════════════════════════════════════════════════
   TOOLTIPS.JS — First-use tooltip walkthrough
   Highlights real UI elements after city entry.
   Completely separate from onboarding.js.
   ═══════════════════════════════════════════════════════ */

const TT_KEY = 'spotd-tooltips-done';
const TT_STEPS = [
  {
    target: '#searchBox',
    title: 'Find Your Spot',
    text: 'Search bars, restaurants, deals, or neighborhoods.',
    emoji: '\uD83D\uDD0D',
    pos: 'below',
  },
  {
    target: '#filterToggle',
    title: 'Personalize It',
    text: 'Filter by day, vibe, or amenities to find exactly what you\u2019re looking for.',
    emoji: '\u2728',
    pos: 'below',
  },
  {
    target: '#viewToggle',
    title: 'Map or List',
    text: 'Switch views to explore spots your way.',
    emoji: '\uD83D\uDDFA\uFE0F',
    pos: 'below',
  },
  {
    target: '.card-hero, .card-compact, .card-std',
    title: 'Tap to Explore',
    text: 'See deals, check in, leave reviews, and add to your lists.',
    emoji: '\uD83C\uDF7A',
    pos: 'below',
  },
  {
    target: '#bottomNav',
    title: 'You\u2019re All Set!',
    text: 'Explore social, news, and your profile from the nav bar. Enjoy!',
    emoji: '\uD83C\uDF89',
    pos: 'above',
  },
];

let _ttStep = 0;
let _ttOverlay = null;

// The tour anchors to Discover elements, so it only makes sense while
// Discover is the visible screen (no tab / sub-page / sheet on top).
function _ttDiscoverVisible() {
  return !document.querySelector('.social-tab.tab-open, .news-tab.tab-open, .dm-tab.tab-open, .profile-page--open, .sub-page--open, .overlay.open');
}

function ttShouldShow() {
  if (localStorage.getItem(TT_KEY)) return false;
  if (typeof currentUser === 'undefined' || !currentUser) return false;
  return true;
}

function ttStart() {
  if (!ttShouldShow()) return;
  setTimeout(function() {
    if (_ttOverlay || !_ttDiscoverVisible()) return; // try again on the next city entry
    var firstTarget = document.querySelector(TT_STEPS[0].target);
    if (!firstTarget) return;
    _ttStep = 0;
    _ttBuild();
    _ttShow(_ttStep);
  }, 1000);
}

// Called whenever the user navigates away from Discover (tab switch, sub-page,
// sheet). The tour used to stay pinned over every other screen, dimming the
// whole app until "Next" was tapped five times; leaving Discover now ends it.
function ttAbort() {
  if (_ttOverlay) _ttFinish();
}

var _ttMoveRaf = null;
function _ttOnMove() {
  if (_ttMoveRaf) return;
  _ttMoveRaf = requestAnimationFrame(function() {
    _ttMoveRaf = null;
    if (_ttOverlay) _ttLayout(_ttStep);
  });
}

function _ttBuild() {
  _ttOverlay = document.createElement('div');
  _ttOverlay.className = 'tt-overlay';
  _ttOverlay.innerHTML = '<div class="tt-backdrop"></div><div class="tt-highlight"></div><div class="tt-bubble"></div>';
  _ttOverlay.querySelector('.tt-backdrop').onclick = function() { _ttNext(); };
  document.body.appendChild(_ttOverlay);
  // Keep the spotlight + bubble glued to their target while the feed scrolls
  // or the viewport resizes (they used to drift off the element).
  window.addEventListener('scroll', _ttOnMove, { passive: true });
  window.addEventListener('resize', _ttOnMove);
}

function _ttShow(idx) {
  var step = TT_STEPS[idx];
  var el = document.querySelector(step.target);
  if (!el) { _ttNext(); return; }

  var rect = el.getBoundingClientRect();
  var pad = 8;

  // Scroll into view first if needed
  if (rect.top < 60 || rect.bottom > window.innerHeight - 60) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(function() { _ttPosition(idx); }, 400);
  } else {
    _ttPosition(idx);
  }
}

function _ttPosition(idx) {
  var step = TT_STEPS[idx];
  var el = document.querySelector(step.target);
  if (!el) return;
  var bubble = _ttOverlay.querySelector('.tt-bubble');

  // Build bubble content
  var isLast = idx === TT_STEPS.length - 1;
  var dots = '';
  for (var i = 0; i < TT_STEPS.length; i++) {
    dots += '<span class="tt-dot' + (i === idx ? ' tt-dot--on' : i < idx ? ' tt-dot--done' : '') + '"></span>';
  }

  bubble.innerHTML =
    '<div class="tt-emoji">' + step.emoji + '</div>' +
    '<div class="tt-title">' + step.title + '</div>' +
    '<div class="tt-text">' + step.text + '</div>' +
    '<div class="tt-footer">' +
      '<div class="tt-dots">' + dots + '</div>' +
      '<button class="tt-skip" onclick="event.stopPropagation();_ttFinish()">Skip</button>' +
      '<button class="tt-btn" onclick="event.stopPropagation();_ttNext()">' + (isLast ? 'Let\u2019s go!' : 'Next \u2192') + '</button>' +
    '</div>';

  bubble.className = 'tt-bubble ' + (step.pos === 'above' ? 'tt-bubble--above' : 'tt-bubble--below') + ' tt-bubble--enter';
  _ttLayout(idx);

  // Trigger animation
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      bubble.classList.remove('tt-bubble--enter');
    });
  });
}

// Geometry only (highlight box + bubble placement) — safe to call on every
// scroll/resize frame without rebuilding the bubble or replaying its entrance.
function _ttLayout(idx) {
  var step = TT_STEPS[idx];
  var el = document.querySelector(step.target);
  if (!el || !_ttOverlay) return;
  var rect = el.getBoundingClientRect();
  var pad = 8;
  var hl = _ttOverlay.querySelector('.tt-highlight');
  var bubble = _ttOverlay.querySelector('.tt-bubble');

  hl.style.top = (rect.top - pad) + 'px';
  hl.style.left = (rect.left - pad) + 'px';
  hl.style.width = (rect.width + pad * 2) + 'px';
  hl.style.height = (rect.height + pad * 2) + 'px';

  var bw = Math.min(300, window.innerWidth - 32);
  var left = Math.max(16, Math.min(rect.left + rect.width / 2 - bw / 2, window.innerWidth - bw - 16));
  bubble.style.width = bw + 'px';
  bubble.style.left = left + 'px';
  if (step.pos === 'above') {
    bubble.style.top = 'auto';
    bubble.style.bottom = (window.innerHeight - rect.top + pad + 16) + 'px';
  } else {
    bubble.style.bottom = 'auto';
    var topPos = rect.bottom + pad + 16;
    var maxTop = window.innerHeight - 200;
    bubble.style.top = Math.min(topPos, maxTop) + 'px';
  }
  var arrowLeft = Math.max(24, Math.min(rect.left + rect.width / 2 - left, bw - 24));
  bubble.style.setProperty('--arrow-left', arrowLeft + 'px');
}

function _ttNext() {
  if (typeof haptic === 'function') haptic('light');
  _ttStep++;
  if (_ttStep >= TT_STEPS.length) {
    _ttFinish();
  } else {
    // Animate out then in
    var bubble = _ttOverlay.querySelector('.tt-bubble');
    bubble.classList.add('tt-bubble--exit');
    setTimeout(function() {
      bubble.classList.remove('tt-bubble--exit');
      _ttShow(_ttStep);
    }, 200);
  }
}

function _ttFinish() {
  localStorage.setItem(TT_KEY, '1');
  window.removeEventListener('scroll', _ttOnMove);
  window.removeEventListener('resize', _ttOnMove);
  if (_ttOverlay) {
    _ttOverlay.classList.add('tt-overlay--out');
    setTimeout(function() {
      if (_ttOverlay && _ttOverlay.parentNode) _ttOverlay.parentNode.removeChild(_ttOverlay);
      _ttOverlay = null;
    }, 350);
  }
}
