/* ═══════════════════════════════════════════════════════
   WELCOME-TOUR.JS — post-signup walkthrough
   Shown ONCE, right after a brand-new account is created and the user lands
   in the app. A full-screen, swipeable 4-step story:
     1. Discover — a REAL venue from their city: deals, happy-hour countdown,
        save + share (animated taps)
     2. Share    — where friends and locals check in (illustrative preview)
     3. Post     — how to share a spot (illustrative composer)
     4. Profile  — interactive: add a profile photo + bio, find friends
   Finishing drops them on Discover and opens that example venue.

   Replaces the tooltip tour (js/tooltips.js) for new signups, and holds the
   other post-signup prompts (referral code, consent, push) until it's done —
   see spotdAfterWelcome().

   Trigger: db.js calls _markWelcomePending() on a genuine signup (email or
   OAuth). enterCity()/onAuthChange() call wtMaybeStart().
   ═══════════════════════════════════════════════════════ */

const WT_PENDING_KEY = 'spotd-welcome-pending';
const WT_DONE_KEY = 'spotd-welcome-done';
const WT_STEPS = 4;

let _wt = null;          // { el, step, venue, photoUrl, bioSaved }
let _wtWaitTimer = null;
const _wtQueue = [];

// Active from the moment a signup is flagged (before the tour can render),
// so prompts fired seconds after signup queue behind it instead of stacking.
try { window.__spotdWelcomeActive = localStorage.getItem(WT_PENDING_KEY) === '1'; } catch (e) {}

// Other post-signup prompts call this; they run once the tour is finished.
window.spotdAfterWelcome = function (fn) {
  if (window.__spotdWelcomeActive) { _wtQueue.push(fn); return; }
  try { fn(); } catch (e) {}
};

function _wtFlushQueue() {
  window.__spotdWelcomeActive = false;
  // Hold the queued prompts until the example venue sheet has been closed,
  // then show them one after another rather than all at once.
  let waited = 0;
  const go = () => {
    const sheetOpen = document.querySelector('#modalOverlay.open');
    if (sheetOpen && waited < 120000) { waited += 700; setTimeout(go, 700); return; }
    _wtQueue.splice(0).forEach((fn, i) => setTimeout(() => { try { fn(); } catch (e) {} }, i * 900));
  };
  setTimeout(go, 700);
}

function _wtUiBusy() {
  const ob = document.getElementById('onboardingOverlay');
  if (ob && ob.style.display !== 'none' && ob.offsetParent !== null) return true;
  return !!document.querySelector('.overlay.open, .sub-page--open, .profile-page--open, .social-tab.tab-open, .news-tab.tab-open, .dm-tab.tab-open');
}

// Pick a real venue to show: in this city, with a photo and real happy-hour
// deals; prefer one that's live right now, then featured.
function _wtPickVenue() {
  const list = (typeof state !== 'undefined' && state.venues) || [];
  const hhRe = /happy|\$\s?\d|half[- ]?(off|price)|\d+\s?%\s?off/i;
  const ok = list.filter(v => (v.photo_url || (v.photo_urls && v.photo_urls[0])) && (v.deals || []).some(d => hhRe.test(String(d))));
  if (!ok.length) return list[0] || null;
  const live = typeof hhActive === 'function' ? ok.filter(v => { try { return !!hhActive(v); } catch (e) { return false; } }) : [];
  return live.find(v => v.featured) || live[0] || ok.find(v => v.featured) || ok[0];
}

function wtMaybeStart() {
  let pending = false;
  try { pending = localStorage.getItem(WT_PENDING_KEY) === '1' && !localStorage.getItem(WT_DONE_KEY); } catch (e) {}
  if (!pending || _wt || _wtWaitTimer) return;
  if (typeof currentUser === 'undefined' || !currentUser) return;
  let tries = 0;
  const tick = () => {
    _wtWaitTimer = null;
    tries++;
    const ready = typeof state !== 'undefined' && state.city && state.venues && state.venues.length;
    if (ready && !_wtUiBusy()) { _wtOpen(); return; }
    if (tries > 360) { _wtFlushQueue(); return; } // ~3 min (e.g. age gate still open): give up for this load, keep pending
    _wtWaitTimer = setTimeout(tick, 500);
  };
  _wtWaitTimer = setTimeout(tick, 800);
}

function _wtFirstName() {
  const n = (window._myProfile && window._myProfile.display_name) || currentUser?.user_metadata?.full_name || '';
  return String(n).trim().split(/\s+/)[0] || '';
}

function _wtVenueCardHTML(v) {
  const photo = v.photo_url || (v.photo_urls && v.photo_urls[0]) || '';
  const img = photo ? (typeof optImg === 'function' ? optImg(photo, 640) : photo) : '';
  const deals = (v.deals || []).filter(Boolean).slice(0, 2);
  const badge = typeof hhBadgeHTML === 'function' ? hhBadgeHTML(v) : '';
  return `
    <div class="wt-card">
      <div class="wt-card-img"${img ? ` style="background-image:url('${esc(img)}')"` : ''}>
        <button class="wt-card-fav" tabindex="-1" aria-hidden="true"><span class="wt-heart-o">${icn('heart', 18)}</span><span class="wt-heart-f">${icn('heartFill', 18)}</span></button>
      </div>
      <div class="wt-card-body">
        <div class="wt-card-name">${esc(v.name)}</div>
        <div class="wt-card-meta">${esc([v.neighborhood, v.cuisine].filter(Boolean).join(' · '))}</div>
        ${badge}
        ${deals.map(d => `<div class="wt-card-deal">${icn('martini', 14)}<span>${esc(d)}</span></div>`).join('')}
        <div class="wt-card-actions">
          <span class="wt-act wt-act-save">${icn('bookmark', 16)} Save</span>
          <span class="wt-act wt-act-share">${icn('share', 16)} Share</span>
        </div>
      </div>
      <div class="wt-finger wt-finger-a"></div>
      <div class="wt-toast">Saved to your spots</div>
    </div>`;
}

function _wtFeedHTML(venues) {
  const rows = venues.slice(0, 3).map((v, i) => {
    const photo = v.photo_url || (v.photo_urls && v.photo_urls[0]) || '';
    const img = photo ? (typeof optImg === 'function' ? optImg(photo, 320) : photo) : '';
    const who = ['A friend', 'A local', 'Someone you follow'][i];
    return `
      <div class="wt-post" style="--i:${i}">
        <div class="wt-post-av">${icn('users', 14)}</div>
        <div class="wt-post-main">
          <div class="wt-post-line"><b>${who}</b> checked in at <b>${esc(v.name)}</b></div>
          ${img ? `<div class="wt-post-img" style="background-image:url('${esc(img)}')"></div>` : ''}
        </div>
        <span class="wt-post-heart">${icn('heartFill', 14)}</span>
      </div>`;
  }).join('');
  return `<div class="wt-feed"><div class="wt-example">Example</div>${rows}</div>`;
}

function _wtComposerHTML(v) {
  return `
    <div class="wt-comp">
      <div class="wt-example">Example</div>
      <div class="wt-comp-photo">${icn('camera', 22)}<span>Add a photo</span></div>
      <div class="wt-comp-row">${icn('pin', 15)}<span class="wt-type">${esc(v ? v.name : 'Your spot')}</span></div>
      <div class="wt-comp-row">${icn('users', 15)}<span>Tag friends</span></div>
      <div class="wt-comp-post">Post</div>
      <div class="wt-finger wt-finger-b"></div>
    </div>`;
}

function _wtSlide(i, eyebrow, title, text, mock) {
  return `
    <section class="wt-slide" data-i="${i}" aria-roledescription="slide" aria-label="${i + 1} of ${WT_STEPS}">
      <div class="wt-mock">${mock}</div>
      <div class="wt-copy">
        <div class="wt-eyebrow">${eyebrow}</div>
        <h2 class="wt-title">${title}</h2>
        <p class="wt-text">${text}</p>
      </div>
    </section>`;
}

function _wtOpen() {
  const v = _wtPickVenue();
  const others = ((typeof state !== 'undefined' && state.venues) || []).filter(x => x !== v && (x.photo_url || (x.photo_urls && x.photo_urls[0]))).slice(0, 3);
  const city = (state.city && state.city.name) || 'your city';
  const first = _wtFirstName();
  const avatar = window._myProfile?.avatar_url || currentUser?.user_metadata?.avatar_url || '';

  try { localStorage.setItem('spotd-tooltips-done', '1'); } catch (e) {} // this replaces the tooltip tour
  if (typeof ttAbort === 'function') ttAbort();

  const el = document.createElement('div');
  el.id = 'welcomeTour';
  el.className = 'wt';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Welcome to Spotd');
  el.innerHTML = `
    <div class="wt-top">
      <div class="wt-hello">${first ? `Welcome, ${esc(first)}` : 'Welcome to Spotd'}</div>
      <button class="wt-skip" onclick="wtSkip()">Skip</button>
    </div>
    <div class="wt-track" id="wtTrack">
      ${v ? _wtSlide(0, 'Discover', `Tonight's happy hours in ${esc(city)}`, 'Every spot shows its deals and when happy hour ends. Tap the heart to save it, or share it with your crew.', _wtVenueCardHTML(v)) : ''}
      ${_wtSlide(v ? 1 : 0, 'Share', 'See where everyone’s going', 'The Share tab shows check-ins and photos from friends and locals, so you know where the night is happening.', _wtFeedHTML(others))}
      ${_wtSlide(v ? 2 : 1, 'Post', 'Share a spot', 'Tap Post in the bar below to share a photo, tag the venue and the friends you’re with.', _wtComposerHTML(v))}
      <section class="wt-slide wt-slide--profile" data-i="${v ? 3 : 2}" aria-roledescription="slide">
        <div class="wt-copy wt-copy--top">
          <div class="wt-eyebrow">Your profile</div>
          <h2 class="wt-title">Make it yours</h2>
          <p class="wt-text">Add a photo and a line about you so friends can find you.</p>
        </div>
        <button class="wt-avatar" id="wtAvatar" onclick="wtPickPhoto()" aria-label="Add a profile photo">
          ${avatar ? `<img src="${esc(avatar)}" alt="">` : `<span class="wt-avatar-ic">${icn('camera', 26)}</span>`}
          <span class="wt-avatar-plus">${icn('plus', 14)}</span>
        </button>
        <input type="file" id="wtPhotoInput" accept="image/*" hidden onchange="wtHandlePhoto(this)">
        <label class="wt-bio-label" for="wtBio">Bio</label>
        <textarea id="wtBio" class="wt-bio" maxlength="160" rows="3" placeholder="e.g. Rooftops, trivia nights and anything with a margarita">${esc(window._myProfile?.bio || '')}</textarea>
        <button class="wt-friends" onclick="wtFinish('friends')">${icn('users', 16)} Find friends to follow</button>
      </section>
    </div>
    <div class="wt-bottom">
      <div class="wt-dots" id="wtDots">${Array.from({ length: v ? 4 : 3 }, (_, i) => `<span class="wt-dot${i ? '' : ' on'}"></span>`).join('')}</div>
      <button class="wt-next" id="wtNext" onclick="wtNext()">Next</button>
    </div>`;
  document.body.appendChild(el);
  _wt = { el, step: 0, venue: v, total: v ? 4 : 3, photoUrl: avatar };

  const track = el.querySelector('#wtTrack');
  let raf = 0;
  track.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; _wtSetStep(Math.round(track.scrollLeft / Math.max(1, track.clientWidth))); });
  }, { passive: true });
  requestAnimationFrame(() => { el.classList.add('wt--in'); _wtSetStep(0, true); });
  try { window.track && window.track('welcome_tour_shown', { has_venue: !!v }); } catch (e) {}
}

function _wtSetStep(i, force) {
  if (!_wt) return;
  i = Math.max(0, Math.min(_wt.total - 1, i));
  if (i === _wt.step && !force) return;
  _wt.step = i;
  _wt.el.querySelectorAll('.wt-slide').forEach((s, n) => s.classList.toggle('wt-slide--on', n === i));
  _wt.el.querySelectorAll('.wt-dot').forEach((d, n) => d.classList.toggle('on', n === i));
  const last = i === _wt.total - 1;
  const next = _wt.el.querySelector('#wtNext');
  if (next) next.textContent = last ? 'Start exploring' : 'Next';
  try { window.track && window.track('welcome_tour_step', { step: i + 1 }); } catch (e) {}
}

function wtNext() {
  if (!_wt) return;
  if (_wt.step >= _wt.total - 1) { wtFinish('done'); return; }
  const track = _wt.el.querySelector('#wtTrack');
  track.scrollTo({ left: (_wt.step + 1) * track.clientWidth, behavior: 'smooth' });
  _wtSetStep(_wt.step + 1);
}

function wtSkip() {
  if (!_wt) return;
  try { window.track && window.track('welcome_tour_skipped', { step: _wt.step + 1 }); } catch (e) {}
  _wtClose(false);
}

// ── profile step ──
function wtPickPhoto() {
  const cap = window.Capacitor;
  if (cap?.isNativePlatform?.() && cap.Plugins?.Camera && typeof _base64ToFile === 'function') {
    const { Camera, CameraResultType, CameraSource } = cap.Plugins;
    Camera.getPhoto({ quality: 90, allowEditing: true, resultType: CameraResultType.Base64, source: CameraSource.Prompt })
      .then(img => _wtUpload(_base64ToFile(img.base64String, 'image/jpeg', `avatar-${Date.now()}.jpg`)))
      .catch(e => { if (!/cancel/i.test(e?.message || '')) document.getElementById('wtPhotoInput')?.click(); });
    return;
  }
  document.getElementById('wtPhotoInput')?.click();
}

function wtHandlePhoto(input) {
  const f = input.files && input.files[0];
  input.value = '';
  if (f) _wtUpload(f);
}

async function _wtUpload(file) {
  if (!file || !currentUser || !_wt) return;
  const btn = document.getElementById('wtAvatar');
  btn?.classList.add('wt-avatar--busy');
  const url = await uploadProfilePhoto(file, currentUser.id, 'avatar');
  btn?.classList.remove('wt-avatar--busy');
  if (!url) { showToast('Upload failed — try again'); return; }
  if (window._myProfile) window._myProfile.avatar_url = url;
  if (_wt) _wt.photoUrl = url;
  if (btn) btn.innerHTML = `<img src="${esc(url)}" alt=""><span class="wt-avatar-plus">${icn('plus', 14)}</span>`;
  showToast('Looking good!');
}

async function _wtSaveBio() {
  const ta = document.getElementById('wtBio');
  const bio = ta ? ta.value.trim() : '';
  if (!bio || !currentUser || bio === (window._myProfile?.bio || '').trim()) return false;
  const { error } = await updateProfile(currentUser.id, { bio });
  if (error) { showToast('Could not save your bio — you can add it from your profile'); return false; }
  if (window._myProfile) window._myProfile.bio = bio;
  return true;
}

async function wtFinish(next) {
  if (!_wt) return;
  const venue = _wt.venue;
  const bioSaved = await _wtSaveBio();
  try { window.track && window.track('welcome_tour_completed', { photo: !!_wt.photoUrl, bio: bioSaved, next }); } catch (e) {}
  _wtClose(true);
  if (next === 'friends' && typeof openFindPeople === 'function') { openFindPeople(); return; }
  // Back on Discover, open the example venue so they see the real thing.
  if (typeof bottomNavFeed === 'function') bottomNavFeed();
  if (venue && typeof openModal === 'function') setTimeout(() => openModal(venue.id), 450);
}

function _wtClose(completed) {
  if (!_wt) return;
  const el = _wt.el;
  _wt = null;
  try { localStorage.setItem(WT_DONE_KEY, '1'); localStorage.removeItem(WT_PENDING_KEY); } catch (e) {}
  el.classList.remove('wt--in');
  setTimeout(() => el.remove(), 350);
  // The push prompt was held back during the tour (see enterCity).
  try {
    if (!localStorage.getItem('spotd-push-prompted') && typeof promptPushIfAppropriate === 'function') {
      localStorage.setItem('spotd-push-prompted', '1');
      _wtQueue.push(() => promptPushIfAppropriate(true));
    }
  } catch (e) {}
  _wtFlushQueue();
}
