/* ═══════════════════════════════════════════════════════
   TOOLTIPS.JS — First-use tooltip walkthrough
   Highlights real UI elements after city entry.
   Completely separate from onboarding.js.
   ═══════════════════════════════════════════════════════ */

const TT_KEY = 'spotd-tooltips-done';
const TT_STEPS = [
  {
    target: '#searchBox',
    text: 'Search for bars, restaurants, deals, or neighborhoods.',
    pos: 'below',
  },
  {
    target: '#filterToggle',
    text: 'Filter by day, vibe, or amenities to find your perfect spot.',
    pos: 'below',
  },
  {
    target: '#viewToggle',
    text: 'Switch between list and map view.',
    pos: 'below',
  },
  {
    target: '.card-hero, .card-compact, .card-std',
    text: 'Tap any spot to see deals, check in, and leave reviews.',
    pos: 'below',
  },
  {
    target: '#bottomNav',
    text: 'Explore social, news, and your profile from here.',
    pos: 'above',
  },
];

let _ttStep = 0;
let _ttOverlay = null;
let _ttBubble = null;
let _ttHighlight = null;

function ttShouldShow() {
  if (localStorage.getItem(TT_KEY)) return false;
  // Only show for logged-in users (onboarding handles pre-auth)
  if (typeof currentUser === 'undefined' || !currentUser) return false;
  return true;
}

function ttStart() {
  if (!ttShouldShow()) return;
  // Wait for cards to render
  setTimeout(() => {
    const firstTarget = document.querySelector(TT_STEPS[0].target);
    if (!firstTarget) return;
    _ttStep = 0;
    _ttBuild();
    _ttShow(_ttStep);
  }, 800);
}

function _ttBuild() {
  // Backdrop
  _ttOverlay = document.createElement('div');
  _ttOverlay.className = 'tt-overlay';
  _ttOverlay.onclick = function(e) {
    if (e.target === _ttOverlay) _ttNext();
  };

  // Highlight cutout
  _ttHighlight = document.createElement('div');
  _ttHighlight.className = 'tt-highlight';

  // Bubble
  _ttBubble = document.createElement('div');
  _ttBubble.className = 'tt-bubble';

  _ttOverlay.appendChild(_ttHighlight);
  _ttOverlay.appendChild(_ttBubble);
  document.body.appendChild(_ttOverlay);
}

function _ttShow(idx) {
  const step = TT_STEPS[idx];
  const el = document.querySelector(step.target);
  if (!el) { _ttNext(); return; }

  const rect = el.getBoundingClientRect();
  const pad = 6;

  // Position highlight around target
  _ttHighlight.style.top = (rect.top - pad) + 'px';
  _ttHighlight.style.left = (rect.left - pad) + 'px';
  _ttHighlight.style.width = (rect.width + pad * 2) + 'px';
  _ttHighlight.style.height = (rect.height + pad * 2) + 'px';

  // Scroll target into view if needed
  if (rect.top < 0 || rect.bottom > window.innerHeight) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Counter
  const counter = (idx + 1) + '/' + TT_STEPS.length;
  const isLast = idx === TT_STEPS.length - 1;

  _ttBubble.innerHTML = '<div class="tt-text">' + step.text + '</div>' +
    '<div class="tt-footer">' +
    '<span class="tt-counter">' + counter + '</span>' +
    '<button class="tt-btn" onclick="event.stopPropagation();_ttNext()">' + (isLast ? 'Got it!' : 'Next') + '</button>' +
    '</div>';

  // Position bubble
  var bw = 280;
  var left = Math.max(12, Math.min(rect.left + rect.width / 2 - bw / 2, window.innerWidth - bw - 12));

  if (step.pos === 'above') {
    _ttBubble.style.top = 'auto';
    _ttBubble.style.bottom = (window.innerHeight - rect.top + pad + 12) + 'px';
    _ttBubble.className = 'tt-bubble tt-bubble--above';
  } else {
    _ttBubble.style.bottom = 'auto';
    _ttBubble.style.top = (rect.bottom + pad + 12) + 'px';
    _ttBubble.className = 'tt-bubble tt-bubble--below';
  }
  _ttBubble.style.left = left + 'px';
  _ttBubble.style.width = bw + 'px';

  // Animate in
  _ttBubble.style.opacity = '0';
  _ttBubble.style.transform = step.pos === 'above' ? 'translateY(8px)' : 'translateY(-8px)';
  requestAnimationFrame(function() {
    _ttBubble.style.opacity = '1';
    _ttBubble.style.transform = 'translateY(0)';
  });
}

function _ttNext() {
  if (typeof haptic === 'function') haptic('light');
  _ttStep++;
  if (_ttStep >= TT_STEPS.length) {
    _ttFinish();
  } else {
    _ttShow(_ttStep);
  }
}

function _ttFinish() {
  localStorage.setItem(TT_KEY, '1');
  if (_ttOverlay) {
    _ttOverlay.style.opacity = '0';
    setTimeout(function() {
      if (_ttOverlay && _ttOverlay.parentNode) _ttOverlay.parentNode.removeChild(_ttOverlay);
      _ttOverlay = null;
      _ttBubble = null;
      _ttHighlight = null;
    }, 300);
  }
}
