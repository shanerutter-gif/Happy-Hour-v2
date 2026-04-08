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

function ttShouldShow() {
  if (localStorage.getItem(TT_KEY)) return false;
  if (typeof currentUser === 'undefined' || !currentUser) return false;
  return true;
}

function ttStart() {
  if (!ttShouldShow()) return;
  setTimeout(function() {
    var firstTarget = document.querySelector(TT_STEPS[0].target);
    if (!firstTarget) return;
    _ttStep = 0;
    _ttBuild();
    _ttShow(_ttStep);
  }, 1000);
}

function _ttBuild() {
  _ttOverlay = document.createElement('div');
  _ttOverlay.className = 'tt-overlay';
  _ttOverlay.innerHTML = '<div class="tt-backdrop"></div><div class="tt-highlight"></div><div class="tt-bubble"></div>';
  _ttOverlay.querySelector('.tt-backdrop').onclick = function() { _ttNext(); };
  document.body.appendChild(_ttOverlay);
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
  var rect = el.getBoundingClientRect();
  var pad = 8;
  var hl = _ttOverlay.querySelector('.tt-highlight');
  var bubble = _ttOverlay.querySelector('.tt-bubble');

  // Highlight
  hl.style.top = (rect.top - pad) + 'px';
  hl.style.left = (rect.left - pad) + 'px';
  hl.style.width = (rect.width + pad * 2) + 'px';
  hl.style.height = (rect.height + pad * 2) + 'px';

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
      (idx > 0 ? '<button class="tt-skip" onclick="event.stopPropagation();_ttFinish()">Skip</button>' : '') +
      '<button class="tt-btn" onclick="event.stopPropagation();_ttNext()">' + (isLast ? 'Let\u2019s go!' : 'Next \u2192') + '</button>' +
    '</div>';

  // Position — keep bubble fully on screen
  var bw = Math.min(300, window.innerWidth - 32);
  var left = Math.max(16, Math.min(rect.left + rect.width / 2 - bw / 2, window.innerWidth - bw - 16));

  bubble.style.width = bw + 'px';
  bubble.style.left = left + 'px';

  if (step.pos === 'above') {
    bubble.style.top = 'auto';
    bubble.style.bottom = (window.innerHeight - rect.top + pad + 16) + 'px';
    bubble.className = 'tt-bubble tt-bubble--above tt-bubble--enter';
  } else {
    bubble.style.bottom = 'auto';
    // Clamp so it doesn't go off screen bottom
    var topPos = rect.bottom + pad + 16;
    var maxTop = window.innerHeight - 200;
    bubble.style.top = Math.min(topPos, maxTop) + 'px';
    bubble.className = 'tt-bubble tt-bubble--below tt-bubble--enter';
  }

  // Arrow position
  var arrowLeft = Math.max(24, Math.min(rect.left + rect.width / 2 - left, bw - 24));
  bubble.style.setProperty('--arrow-left', arrowLeft + 'px');

  // Trigger animation
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      bubble.classList.remove('tt-bubble--enter');
    });
  });
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
  if (_ttOverlay) {
    _ttOverlay.classList.add('tt-overlay--out');
    setTimeout(function() {
      if (_ttOverlay && _ttOverlay.parentNode) _ttOverlay.parentNode.removeChild(_ttOverlay);
      _ttOverlay = null;
    }, 350);
  }
}
