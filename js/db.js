/* ═══════════════════════════════════════════════════════
   DB.JS — Supabase client + all data helpers
   !! Replace the two placeholders below before deploying !!
   ═══════════════════════════════════════════════════════ */

const SUPABASE_URL      = 'https://opcskuzbdfrlnyhraysk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_M97B-GmwsRF6xPVahp_ytw_49nI9igs';

// Storage key — derived from your project ref
const _projectRef  = SUPABASE_URL.match(/\/\/([^.]+)\./)?.[1] || 'project';
const _storageKey  = `sb-${_projectRef}-auth-token`;

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── ADMIN ─────────────────────────────────────────────
// Add your admin email(s) here to enable in-app editing
const ADMIN_EMAILS = ['shanerutter@gmail.com'];
function isAdmin() { return currentUser && ADMIN_EMAILS.includes(currentUser.email); }

// ── ANALYTICS ─────────────────────────────────────────
// Single entry point for GA4 events. Safe no-op if gtag isn't loaded
// (e.g. user disabled GA via ?disable_ga=true). Strips known PII keys
// before sending. Snake_case event names; values are scalars only.
function track(eventName, params) {
  try {
    if (typeof gtag !== 'function') return;
    if (!eventName) return;
    const safe = {};
    if (params && typeof params === 'object') {
      const blocked = new Set(['email','password','token','phone','full_name','display_name']);
      for (const k of Object.keys(params)) {
        if (blocked.has(k)) continue;
        const v = params[k];
        if (v == null) continue;
        // Only allow scalar values; coerce booleans/numbers/strings.
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          safe[k] = v;
        }
      }
    }
    gtag('event', String(eventName).slice(0, 40), safe);
  } catch (e) { /* never let analytics break the app */ }
}

// ── AUTH STATE ─────────────────────────────────────────
let currentUser   = null;
let userFavorites = new Set();
let _accessToken  = null;

// initAuth — called explicitly from the END of app.js so that
// onAuthChange is guaranteed to be defined before it fires.
let _refreshTimer = null;

async function _refreshAndPersist(refreshToken) {
  const { data, error } = await db.auth.refreshSession({
    refresh_token: refreshToken,
  });
  if (error || !data?.session) return null;
  const s = data.session;
  currentUser  = s.user;
  _accessToken = s.access_token;
  localStorage.setItem(_storageKey, JSON.stringify({
    access_token:  s.access_token,
    refresh_token: s.refresh_token,
    expires_at:    s.expires_at,
    expires_in:    s.expires_in,
    token_type:    'bearer',
    user:          s.user,
  }));
  await db.auth.setSession({
    access_token:  s.access_token,
    refresh_token: s.refresh_token,
  });
  _scheduleTokenRefresh(s.expires_in);
  return s;
}

function _scheduleTokenRefresh(expiresInSec) {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  if (!expiresInSec || expiresInSec < 30) return;
  // Refresh 2 minutes before expiry (or at half-life if < 5 min)
  const refreshIn = Math.max((expiresInSec - 120), expiresInSec / 2) * 1000;
  _refreshTimer = setTimeout(async () => {
    try {
      const raw = localStorage.getItem(_storageKey);
      if (!raw) return;
      const stored = JSON.parse(raw);
      if (!stored?.refresh_token) return;
      const s = await _refreshAndPersist(stored.refresh_token);
      if (!s) {
        // Refresh failed — sign out cleanly
        localStorage.removeItem(_storageKey);
        currentUser = null; _accessToken = null; userFavorites = new Set();
        if (typeof onAuthChange === 'function') onAuthChange(null);
      }
    } catch(e) { console.warn('[tokenRefresh] error', e); }
  }, refreshIn);
}

async function initAuth() {
  try {
    const raw = localStorage.getItem(_storageKey);
    if (!raw) return;
    const stored = JSON.parse(raw);
    if (!stored?.user) return;

    const now = Math.floor(Date.now() / 1000);

    // Immediately restore user so the UI doesn't flash the home page
    currentUser  = stored.user;
    _accessToken = stored.access_token;

    if (stored.expires_at > now) {
      // Token still valid — restore session
      await db.auth.setSession({
        access_token:  stored.access_token,
        refresh_token: stored.refresh_token || '',
      });
      _scheduleTokenRefresh(stored.expires_at - now);
    } else if (stored.refresh_token) {
      // Token expired — enter city immediately, refresh in background
      _refreshAndPersist(stored.refresh_token).then(s => {
        if (!s) {
          localStorage.removeItem(_storageKey);
          currentUser = null; _accessToken = null; userFavorites = new Set();
          if (typeof onAuthChange === 'function') onAuthChange(null);
        }
      }).catch(() => {});
    } else {
      // No refresh token — clear and bail
      localStorage.removeItem(_storageKey);
      currentUser = null; _accessToken = null;
      return;
    }

    // Load favorites in background — don't block city entry
    loadFavorites().catch(() => {});
    if (typeof onAuthChange === 'function') onAuthChange(currentUser);

    // Fire-and-forget: update last_seen timestamp on profile
    _updateLastSeen();
  } catch(e) {
    console.warn('[initAuth] error', e);
    // If we had a user but hit an error, still try to enter
    if (currentUser && typeof onAuthChange === 'function') onAuthChange(currentUser);
  }
}

// Update last_seen on profiles table (fire-and-forget, throttled to once per hour)
function _updateLastSeen() {
  if (!currentUser?.id || !_accessToken) return;
  const key = `last_seen_ping_${currentUser.id}`;
  const lastPing = parseInt(localStorage.getItem(key) || '0', 10);
  if (Date.now() - lastPing < 3600000) return; // throttle: once per hour
  localStorage.setItem(key, String(Date.now()));
  fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${currentUser.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${_accessToken}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ last_seen: new Date().toISOString() }),
  }).catch(() => {});
}

// Re-validate session when app returns from background (iOS/Android)
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  if (!currentUser) return;
  try {
    const raw = localStorage.getItem(_storageKey);
    if (!raw) return;
    const stored = JSON.parse(raw);
    const now = Math.floor(Date.now() / 1000);
    // If token expired or will expire within 60s, refresh now
    if (stored.expires_at && stored.expires_at - now < 60 && stored.refresh_token) {
      const s = await _refreshAndPersist(stored.refresh_token);
      if (!s) {
        localStorage.removeItem(_storageKey);
        currentUser = null; _accessToken = null; userFavorites = new Set();
        if (typeof onAuthChange === 'function') onAuthChange(null);
      }
    }
  } catch(e) { console.warn('[visibilitychange] refresh error', e); }
});

function getSession() {
  return _accessToken ? { user: currentUser, access_token: _accessToken } : null;
}

// ── LOOPS ONBOARDING (fire-and-forget) ────────────────
function triggerLoopsOnboarding(email, firstName, userId, source) {
  fetch('/api/loops-onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, firstName, userId, source }),
  }).catch(e => console.warn('[Loops] Onboarding trigger failed:', e.message));
}

// ── LOOPS EVENTS (fire-and-forget) ───────────────────
function sendLoopsEvent(eventName, properties) {
  const email = currentUser?.email;
  if (!email) return;
  fetch('/api/loops-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, eventName, properties }),
  }).catch(e => console.warn(`[Loops] Event "${eventName}" failed:`, e.message));
}

// ── AUTH ───────────────────────────────────────────────
async function authSignIn(email, password) {
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'signin', email, password })
    });
    const data = await res.json();
    if (data.error_description) return { error: { message: data.error_description } };
    if (data.error)             return { error: { message: data.error } };
    if (!data.access_token)     return { error: { message: 'No token received' } };

    // Persist session
    localStorage.setItem(_storageKey, JSON.stringify({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_at:    data.expires_at,
      expires_in:    data.expires_in,
      token_type:    'bearer',
      user:          data.user
    }));

    currentUser  = data.user;
    _accessToken = data.access_token;
    // Inject token into db client so RLS works
    await db.auth.setSession({
      access_token:  data.access_token,
      refresh_token: data.refresh_token || '',
    });
    if (data.expires_in) _scheduleTokenRefresh(data.expires_in);
    await loadFavorites();
    if (typeof onAuthChange === 'function') onAuthChange(currentUser);
    return { data, error: null };
  } catch (e) {
    return { error: { message: e.message } };
  }
}

async function authSignUp(email, password, displayName) {
  track('signup_started', { method: 'email' });
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'signup', email, password, name: displayName })
    });
    const data = await res.json();
    if (data.error_description) { track('signup_failed', { method: 'email' }); return { error: { message: data.error_description } }; }
    if (data.error)             { track('signup_failed', { method: 'email' }); return { error: { message: data.error } }; }
    // Trigger onboarding email sequence (fire-and-forget)
    triggerLoopsOnboarding(email, displayName, data.user?.id, 'email-signup');
    if (data.access_token) return authSignIn(email, password);
    return { data, error: null };
  } catch (e) {
    track('signup_failed', { method: 'email', reason: 'network' });
    return { error: { message: e.message } };
  }
}

async function authSignOut() {
  localStorage.removeItem(_storageKey);
  currentUser  = null;
  _accessToken = null;
  userFavorites = new Set();
  try { await db.auth.signOut(); } catch(e) {}
  if (typeof onAuthChange === 'function') onAuthChange(null);
}

// ── GOOGLE SSO ────────────────────────────────────────
async function authSignInWithGoogle() {
  try {
    // On native iOS, use skipBrowserRedirect so we can route through ASWebAuthenticationSession
    if (window.spotdNative?.openOAuth) {
      const { data, error } = await db.auth.signInWithOAuth({
        provider: 'google',
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
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/?auth_callback=1',
      }
    });
    if (error) throw error;
    return { data, error: null };
  } catch(e) {
    return { error: { message: e.message } };
  }
}

// Handle the OAuth redirect callback (called from DOMContentLoaded)
async function handleOAuthCallback() {
  const hash = window.location.hash;
  const search = window.location.search;

  // Supabase returns tokens in the URL hash after OAuth redirect
  if (!hash || !hash.includes('access_token')) return false;

  try {
    const params = new URLSearchParams(hash.replace('#', ''));
    const accessToken  = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const expiresIn    = parseInt(params.get('expires_in') || '3600', 10);
    const expiresAt    = Math.floor(Date.now() / 1000) + expiresIn;

    if (!accessToken) return false;

    // Set the session in Supabase client
    const { data, error } = await db.auth.setSession({
      access_token:  accessToken,
      refresh_token: refreshToken || '',
    });

    if (error) throw error;

    const user = data?.session?.user || data?.user;
    if (!user) return false;

    // Persist session
    localStorage.setItem(_storageKey, JSON.stringify({
      access_token:  accessToken,
      refresh_token: refreshToken,
      expires_at:    expiresAt,
      expires_in:    expiresIn,
      token_type:    'bearer',
      user:          user,
    }));

    currentUser  = user;
    _accessToken = accessToken;
    _scheduleTokenRefresh(expiresIn);
    await loadFavorites();

    // Trigger onboarding for new OAuth signups (Loops dedupes existing contacts)
    if (user.email) {
      triggerLoopsOnboarding(user.email, user.user_metadata?.full_name, user.id, 'google-oauth');
    }

    const _provider = user.app_metadata?.provider || 'oauth';
    const _isNew = !!(user.created_at && (Date.now() - new Date(user.created_at).getTime() < 60000));
    track(_isNew ? 'signup_completed' : 'oauth_login', { method: _provider, new_user: _isNew });

    // Apply any pending referral code captured before the OAuth redirect.
    // No-op if there's no stashed code or the user was already referred.
    try { await applyPendingReferral(user.id); } catch(e) {}
    // Persist any onboarding attribution that was stashed pre-redirect.
    try { await applyPendingAttribution(user.id); } catch(e) {}
    // Prompt for referral code post-signup if they didn't supply one.
    setTimeout(() => {
      try {
        if (typeof window.maybeShowPostSignupReferralModal === 'function') {
          window.maybeShowPostSignupReferralModal();
        }
      } catch (e) {}
    }, 1500);

    // Clean URL
    window.history.replaceState({}, document.title, window.location.pathname);

    if (typeof onAuthChange === 'function') onAuthChange(currentUser);
    if (typeof showToast === 'function') showToast('Welcome, ' + (user.user_metadata?.full_name || user.email?.split('@')[0] || '') + '!');

    return true;
  } catch(e) {
    console.warn('[OAuth callback] error:', e);
    return false;
  }
}

// ── PROFILE ────────────────────────────────────────────
async function getProfile(userId) {
  const { data } = await db.from('profiles').select('*').eq('id', userId).maybeSingle();
  return data;
}
async function updateProfile(userId, updates) {
  return db.from('profiles').upsert({ id: userId, ...updates });
}
async function getFollowedNeighborhoods(userId) {
  const { data } = await db.from('neighborhood_follows').select('neighborhood').eq('user_id', userId);
  return (data || []).map(r => r.neighborhood);
}
async function toggleNeighborhoodFollow(userId, neighborhood) {
  const followed = await getFollowedNeighborhoods(userId);
  if (followed.includes(neighborhood)) {
    await db.from('neighborhood_follows').delete().eq('user_id', userId).eq('neighborhood', neighborhood);
    return false;
  }
  await db.from('neighborhood_follows').insert({ user_id: userId, neighborhood });
  return true;
}
async function setDigestPreference(userId, enabled) {
  return db.from('profiles').update({ digest_enabled: enabled }).eq('id', userId);
}

// ── VENUES & EVENTS (from Supabase) ───────────────────
async function fetchVenues(citySlug) {
  const { data } = await db.from('venues')
    .select('*')
    .eq('city_slug', citySlug)
    .eq('active', true)
    .order('name');
  return data || [];
}
async function fetchEvents(citySlug) {
  const { data } = await db.from('events')
    .select('*')
    .eq('city_slug', citySlug)
    .eq('active', true)
    .order('name');
  return data || [];
}
async function fetchCities() {
  try {
    const { data, error } = await db.from('cities').select('*').order('name');
    if (error) throw error;
    return data || [];
  } catch(e) { return []; }
}

// ── REVIEWS ────────────────────────────────────────────
async function fetchReviews(itemId, itemType = 'venue') {
  const col = itemType === 'venue' ? 'venue_id' : 'event_id';
  try {
    const { data, error } = await db.from('reviews')
      .select('*')
      .eq(col, itemId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    // Enrich with display names from profiles
    const reviews = data || [];
    const userIds = [...new Set(reviews.map(r => r.user_id).filter(Boolean))];
    if (userIds.length) {
      const { data: profiles } = await db.from('profiles')
        .select('id, display_name, avatar_emoji, avatar_url, is_official')
        .in('id', userIds);
      const pMap = {};
      (profiles || []).forEach(p => { pMap[p.id] = p; });
      reviews.forEach(r => { if (r.user_id) r.profiles = pMap[r.user_id] || null; });
    }
    return reviews;
  } catch(e) {
    return [];
  }
}
async function fetchMyReviews(userId) {
  const { data } = await db.from('reviews').select('*').eq('user_id', userId)
    .order('created_at', { ascending: false });
  return data || [];
}
async function postReview({ itemId, itemType = 'venue', rating, text, guestName }) {
  const session = getSession();
  const col = itemType === 'venue' ? 'venue_id' : 'event_id';
  const payload = {
    [col]: itemId, rating, text: text || null,
    user_id: session?.user?.id || null,
    name: session?.user?.user_metadata?.full_name || guestName || 'Anonymous'
  };

  // Use authed client if user is logged in so RLS allows insert + read-back
  let client = db;
  if (session?.access_token) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${session.access_token}` } }
    });
  }

  const { data, error } = await client.from('reviews').insert(payload).select().single();
  if (error) console.error('postReview error:', error);
  if (!error) {
    track('review_submitted', { item_type: itemType, rating: rating, has_text: !!text });
  }
  // Loops: first_review event
  if (!error && session?.user?.id) {
    db.from('reviews').select('id').eq('user_id', session.user.id).then(({ data: all }) => {
      if (all?.length === 1) {
        sendLoopsEvent('first_review', { itemId, itemType, rating });
        track('first_review', { item_type: itemType, rating: rating });
      }
    }).catch(() => {});
  }
  return { data, error };
}
async function updateReview(reviewId, { rating, text }) {
  const { data, error } = await db.from('reviews')
    .update({ rating, text, updated_at: new Date().toISOString() })
    .eq('id', reviewId).select().single();
  return { data, error };
}
async function deleteReview(reviewId) {
  const { error } = await db.from('reviews').delete().eq('id', reviewId);
  return error;
}

// ── FAVORITES ──────────────────────────────────────────
async function loadFavorites() {
  if (!currentUser) { userFavorites = new Set(); return; }
  const { data } = await db.from('favorites').select('item_id').eq('user_id', currentUser.id);
  userFavorites = new Set((data || []).map(r => r.item_id));
}
function isFavorite(itemId) { return userFavorites.has(String(itemId)); }
async function toggleFavorite(itemId, itemType = 'venue') {
  if (!currentUser) return null;
  const id = String(itemId);
  if (isFavorite(id)) {
    await db.from('favorites').delete().eq('user_id', currentUser.id).eq('item_id', id);
    userFavorites.delete(id);
    track('favorite_toggled', { item_type: itemType, saved: false });
    return false;
  }
  await db.from('favorites').insert({ user_id: currentUser.id, item_id: id, item_type: itemType });
  userFavorites.add(id);
  track('favorite_toggled', { item_type: itemType, saved: true });
  return true;
}
async function getFavoriteItems(userId) {
  const { data } = await db.from('favorites').select('item_id, item_type').eq('user_id', userId);
  return data || [];
}
// ── CHECK-INS (legacy aliases kept for any remaining references) ──
// Main implementations are in the CHECK-INS block below
async function fetchGoingCounts(citySlug, date) { return fetchCheckInCounts(citySlug, date); }
async function fetchMyGoingTonight(userId, date) { return fetchMyCheckIns(userId, date); }
async function addGoingTonight(args) { return addCheckIn(args); }
async function removeGoingTonight(userId, venueId, date) { return removeCheckIn(userId, venueId, date); }


// ── VENUE REQUESTS ─────────────────────────────────────
async function submitVenueRequestToDB(payload) {
  const { data, error } = await db.from('venue_requests').insert(payload);
  if (error) console.error('submitVenueRequest error:', error);
  if (!error) sendLoopsEvent('venue_request_submitted', { venueName: payload.venue_name, citySlug: payload.city_slug });
  return { data, error };
}

// ── CHECK-INS (renamed from going_tonight) ─────────────
async function fetchCheckInCounts(citySlug, date) {
  try {
    const { data, error } = await db.from('check_ins')
      .select('venue_id')
      .eq('city_slug', citySlug).eq('date', date);
    if (error) throw error;
    const counts = {};
    (data || []).forEach(r => { counts[r.venue_id] = (counts[r.venue_id] || 0) + 1; });
    return Object.entries(counts).map(([venue_id, count]) => ({ venue_id, count }));
  } catch(e) { console.warn('fetchCheckInCounts error', e); return []; }
}
async function fetchMyCheckIns(userId, date) {
  try {
    const { data } = await db.from('check_ins').select('venue_id').eq('user_id', userId).eq('date', date);
    return data || [];
  } catch(e) { return []; }
}
async function fetchAllCheckIns(userId) {
  try {
    const { data } = await db.from('check_ins').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    return data || [];
  } catch(e) { return []; }
}
async function addCheckIn({ userId, venueId, citySlug, date, note }) {
  try {
    const { error } = await db.from('check_ins').insert({ user_id: userId, venue_id: venueId, city_slug: citySlug, date, note: note || null });
    if (error) throw error;
    // Log to activity feed
    await logActivity(userId, 'check_in', venueId, { note });
    // Check badges
    await checkAndAwardBadges(userId);
    // Loops events: first check-in + milestones
    _fireCheckinLoopsEvents(userId, venueId);
    track('checkin_added', { venue_id: venueId, city_slug: citySlug, has_note: !!note });
    return true;
  } catch(e) { console.warn('addCheckIn error', e); return false; }
}
async function _fireCheckinLoopsEvents(userId, venueId) {
  try {
    const { data } = await db.from('check_ins').select('id').eq('user_id', userId);
    const count = data?.length || 0;
    if (count === 1) { sendLoopsEvent('first_checkin', { venueId }); track('first_checkin', { venue_id: venueId }); }
    if (count === 3 || count === 5 || count === 10 || count === 25 || count === 50) {
      sendLoopsEvent('checkin_streak', { count, venueId });
      track('checkin_milestone', { count: count, venue_id: venueId });
    }
  } catch(e) {}
}
async function removeCheckIn(userId, venueId, date) {
  try {
    await db.from('check_ins').delete().eq('user_id', userId).eq('venue_id', venueId).eq('date', date);
    track('checkin_removed', { venue_id: venueId });
    // Also remove the matching activity_feed row so the social feed
    // doesn't keep stale "Shane checked in at X" cards after un-check-in.
    // Match by user + venue + same calendar day.
    try {
      const dayStart = `${date}T00:00:00`;
      const dayEnd   = `${date}T23:59:59.999`;
      await db.from('activity_feed')
        .delete()
        .eq('user_id', userId)
        .eq('venue_id', venueId)
        .eq('activity_type', 'check_in')
        .gte('created_at', dayStart)
        .lte('created_at', dayEnd);
    } catch (e) { /* best-effort cleanup */ }
    return true;
  } catch(e) { return false; }
}

// ── ACTIVITY FEED ──────────────────────────────────────
async function logActivity(userId, type, venueId, meta = {}) {
  try {
    // Get venue info for denormalization
    let venue_name = null, neighborhood = null;
    if (venueId) {
      const { data } = await db.from('venues').select('name, neighborhood').eq('id', venueId).single();
      venue_name = data?.name; neighborhood = data?.neighborhood;
    }
    await db.from('activity_feed').insert({ user_id: userId, activity_type: type, venue_id: venueId, venue_name, neighborhood, meta });
  } catch(e) { console.warn('logActivity error', e); }
}
async function fetchActivityFeed(userIds, limit = 30) {
  try {
    const { data } = await db.from('activity_feed')
      .select('*')
      .in('user_id', userIds)
      .order('created_at', { ascending: false })
      .limit(limit);
    const rows = data || [];
    const ids = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
    if (ids.length) {
      const { data: profiles } = await db.from('profiles').select('id, display_name, avatar_emoji, avatar_url, username, is_official').in('id', ids);
      const pMap = {};
      (profiles || []).forEach(p => { pMap[p.id] = p; });
      rows.forEach(r => { r.profiles = pMap[r.user_id] || null; });
    }
    return rows;
  } catch(e) { return []; }
}
async function fetchUserActivity(userId, limit = 20) {
  try {
    const { data } = await db.from('activity_feed')
      .select('*').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(limit);
    return data || [];
  } catch(e) { return []; }
}

// ── FOLLOWS ────────────────────────────────────────────
async function followUser(followerId, followingId) {
  try {
    const { error } = await db.from('user_follows').insert({ follower_id: followerId, following_id: followingId });
    if (error) { console.warn('followUser error:', error.message); return false; }
    track('user_followed', {});
    // Loops: first_follow (for the person doing the follow)
    db.from('user_follows').select('id').eq('follower_id', followerId).then(({ data }) => {
      if (data?.length === 1) sendLoopsEvent('first_follow', { followingId });
    }).catch(() => {});
    // Loops: got_first_follower (for the person being followed)
    db.from('user_follows').select('id').eq('following_id', followingId).then(async ({ data }) => {
      if (data?.length === 1) {
        // Look up their email to send the event
        const { data: profile } = await db.from('profiles').select('id').eq('id', followingId).single();
        if (profile) {
          // We need their email from auth — but we can only get it if it's the current user
          // Instead, send via the follower's email with the followingId as context
          sendLoopsEvent('got_first_follower', { followedUserId: followingId, followerId });
        }
      }
    }).catch(() => {});
    return true;
  } catch(e) { return false; }
}
async function unfollowUser(followerId, followingId) {
  try {
    await db.from('user_follows').delete().eq('follower_id', followerId).eq('following_id', followingId);
    return true;
  } catch(e) { return false; }
}
async function getFollowing(userId) {
  try {
    const { data, error } = await db.from('user_follows').select('following_id').eq('follower_id', userId);
    if (error) return [];
    return (data || []).map(r => r.following_id);
  } catch(e) { return []; }
}
async function getFollowers(userId) {
  try {
    const { data } = await db.from('user_follows').select('follower_id').eq('following_id', userId);
    return data || [];
  } catch(e) { return []; }
}
async function isFollowing(followerId, followingId) {
  try {
    const { data, error } = await db.from('user_follows').select('id').eq('follower_id', followerId).eq('following_id', followingId).maybeSingle();
    if (error) return false;
    return !!data;
  } catch(e) { return false; }
}
async function fetchPublicProfile(userId) {
  try {
    const { data, error } = await db.from('profiles')
      .select('id, display_name, bio, avatar_emoji, avatar_url, username, digest_enabled, is_public, is_official')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      console.warn('fetchPublicProfile error:', error.message);
      // Return a minimal stub so profile page still renders
      return { id: userId, display_name: null, bio: null, avatar_emoji: null, is_public: true };
    }
    // If no profile row exists yet, return a stub (user exists but never set up profile)
    if (!data) return { id: userId, display_name: null, bio: null, avatar_emoji: null, is_public: true };
    // Respect privacy — is_public defaults to true if column doesn't exist yet
    if (data.is_public === false) return null;
    return data;
  } catch(e) { return { id: userId, display_name: null, bio: null, avatar_emoji: null, is_public: true }; }
}
async function searchProfiles(query) {
  try {
    const { data, error } = await db.from('profiles')
      .select('id, display_name, avatar_emoji, avatar_url, bio, is_official')
      .not('display_name', 'is', null)
      .ilike('display_name', `%${query}%`)
      .limit(15);
    if (error) return [];
    return data || [];
  } catch(e) { return []; }
}
async function savePrivacySetting(userId, isPublic) {
  try {
    await updateProfile(userId, { is_public: isPublic });
    return true;
  } catch(e) { return false; }
}

// ── BADGES ─────────────────────────────────────────────
async function getUserBadges(userId) {
  try {
    const { data } = await db.from('user_badges').select('badge_key, earned_at').eq('user_id', userId);
    return data || [];
  } catch(e) { return []; }
}
async function awardBadge(userId, badgeKey) {
  try {
    await db.from('user_badges').insert({ user_id: userId, badge_key: badgeKey });
    await logActivity(userId, 'badge', null, { badge_key: badgeKey });
    return true;
  } catch(e) { return false; } // unique constraint handles duplicates silently
}
async function checkAndAwardBadges(userId) {
  try {
    const [checkIns, reviews, following, existingBadges] = await Promise.all([
      fetchAllCheckIns(userId),
      fetchMyReviews(userId),
      getFollowing(userId),
      getUserBadges(userId),
    ]);
    const earned = new Set(existingBadges.map(b => b.badge_key));
    const award = key => !earned.has(key) && awardBadge(userId, key);

    // First check-in
    if (checkIns.length >= 1) award('first_checkin');

    // Regular — same venue 3+ times
    const venueCounts = {};
    checkIns.forEach(c => { venueCounts[c.venue_id] = (venueCounts[c.venue_id] || 0) + 1; });
    if (Object.values(venueCounts).some(c => c >= 3)) award('regular');

    // Explorer — 5+ distinct neighborhoods
    const hoods = new Set(checkIns.map(c => c.neighborhood).filter(Boolean));
    if (hoods.size >= 5) award('explorer');

    // Critic / Top Reviewer
    if (reviews.length >= 10) award('critic');
    if (reviews.length >= 25) award('top_reviewer');

    // Social
    if (following.length >= 5) award('social');

    // Streak — check for 4 and 8 consecutive weeks with a check-in
    const weekSet = new Set(checkIns.map(c => {
      const d = new Date(c.date || c.created_at);
      const jan1 = new Date(d.getFullYear(), 0, 1);
      return `${d.getFullYear()}-W${Math.ceil(((d - jan1) / 86400000 + 1) / 7)}`;
    }));
    const weeks = [...weekSet].sort();
    let maxStreak = 1, cur = 1;
    for (let i = 1; i < weeks.length; i++) {
      // rough consecutive check
      cur = weeks[i] > weeks[i-1] ? cur + 1 : 1;
      maxStreak = Math.max(maxStreak, cur);
    }
    if (maxStreak >= 4) award('streak_4');
    if (maxStreak >= 8) award('streak_8');
  } catch(e) { console.warn('checkAndAwardBadges error', e); }
}

// ── VENUE FOLLOWS (deal alerts) ────────────────────────
async function followVenue(userId, venueId) {
  try {
    const { error } = await db.from('venue_follows').insert({ user_id: userId, venue_id: venueId });
    if (error) throw error;
    track('venue_followed', { venue_id: venueId });
    return true;
  } catch(e) { return false; }
}
async function unfollowVenue(userId, venueId) {
  try {
    await db.from('venue_follows').delete().eq('user_id', userId).eq('venue_id', venueId);
    return true;
  } catch(e) { return false; }
}
async function isFollowingVenue(userId, venueId) {
  try {
    const { data } = await db.from('venue_follows').select('id').eq('user_id', userId).eq('venue_id', venueId).maybeSingle();
    return !!data;
  } catch(e) { return false; }
}

// ── TAG A FRIEND ───────────────────────────────────────
// Writes an activity_feed entry visible on the tagged user's feed.
// No new table needed — reuses existing activity_feed infrastructure.
async function tagFriendAtCheckIn(fromUserId, toUserId, venueId, venueName) {
  try {
    // Denormalize venue info for feed display
    let neighborhood = null;
    if (venueId) {
      const { data } = await db.from('venues').select('neighborhood').eq('id', venueId).single();
      neighborhood = data?.neighborhood || null;
    }
    await db.from('activity_feed').insert({
      user_id:       toUserId,        // appears on the tagged user's feed
      activity_type: 'tagged_at',
      venue_id:      venueId,
      venue_name:    venueName,
      neighborhood,
      meta:          { tagged_by: fromUserId }
    });
    return true;
  } catch(e) { console.warn('tagFriendAtCheckIn error', e); return false; }
}

// ── PHOTO CHECK-INS ────────────────────────────────────
const CHECKIN_PHOTO_BUCKET = 'checkin-photos';

async function uploadCheckinPhoto(file, userId) {
  // Path: {userId}/{timestamp}-{random}.jpg  — bucket RLS enforces owner-only writes
  const ext  = file.name.split('.').pop().replace('heic','jpg') || 'jpg';
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const session = getSession();
  const client  = session?.access_token
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${session.access_token}` } }
      })
    : db;

  console.log('[Photo] Uploading to', path, 'size:', file.size, 'type:', file.type);
  const { data, error } = await client.storage
    .from(CHECKIN_PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });

  if (error) { console.error('[Photo] Upload error:', JSON.stringify(error)); return null; }
  console.log('[Photo] Upload success:', data);

  const { data: urlData } = client.storage
    .from(CHECKIN_PHOTO_BUCKET)
    .getPublicUrl(path);

  console.log('[Photo] Public URL:', urlData.publicUrl);
  return { url: urlData.publicUrl, storagePath: path };
}

// Identical to uploadCheckinPhoto but preserves video content type
async function uploadCheckinVideo(file, userId) {
  const ext  = file.name.split('.').pop() || 'mp4';
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const session = getSession();
  const client  = session?.access_token
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${session.access_token}` } }
      })
    : db;

  console.log('[Video] Uploading to', path, 'size:', file.size, 'type:', file.type);
  const { data, error } = await client.storage
    .from(CHECKIN_PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type || 'video/mp4', upsert: false });

  if (error) {
    console.error('[Video] Upload error:', JSON.stringify(error));
    return { error: error.message || error.statusCode || 'Upload failed' };
  }
  console.log('[Video] Upload success:', data);

  const { data: urlData } = client.storage
    .from(CHECKIN_PHOTO_BUCKET)
    .getPublicUrl(path);

  console.log('[Video] Public URL:', urlData.publicUrl);
  return { url: urlData.publicUrl, storagePath: path };
}

// Delete an activity feed post (and its storage file if video/photo)
async function deleteActivityPost(postId, postType, meta) {
  const session = getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${session.access_token}` } }
  });

  // Determine the DB table and real ID from the normalized post ID
  let table, realId;
  if (postType === 'photo' || postId.startsWith('photo-')) {
    table = 'checkin_photos';
    realId = postId.replace('photo-', '');
  } else if (postType === 'going_tonight' || postId.startsWith('going-')) {
    table = 'check_ins';
    realId = postId.replace('going-', '');
  } else {
    table = 'activity_feed';
    realId = postId.replace('activity-', '');
  }

  console.log('[Delete] Deleting', table, realId, 'postId:', postId);

  // Delete the post itself first (most important)
  const { error } = await client.from(table).delete().eq('id', realId);
  if (error) { console.error('[Delete] Error:', error); throw error; }

  // Best-effort cleanup of storage, likes, comments (don't throw)
  try {
    const storagePath = meta?.photo_storage_path || meta?.video_storage_path;
    if (storagePath) await client.storage.from(CHECKIN_PHOTO_BUCKET).remove([storagePath]);
  } catch(e) { console.warn('[Delete] Storage cleanup error:', e); }

  try { await client.from('social_likes').delete().eq('post_id', postId); } catch(e) {}
  try { await client.from('social_comments').delete().eq('post_id', postId); } catch(e) {}

  return true;
}

async function saveCheckinPhoto({ userId, venueId, citySlug, photoUrl, storagePath, caption, mediaUrls, postType, title, body, pinnedUntil }) {
  try {
    const session = getSession();
    const client  = session?.access_token
      ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          global: { headers: { Authorization: `Bearer ${session.access_token}` } }
        })
      : db;
    const payload = {
      user_id: userId,
      venue_id: venueId || null,
      city_slug: citySlug,
      photo_url: photoUrl || (Array.isArray(mediaUrls) && mediaUrls[0]) || null,
      storage_path: storagePath || null,
      caption: caption || null,
      media_urls: Array.isArray(mediaUrls) && mediaUrls.length ? mediaUrls : (photoUrl ? [photoUrl] : null),
      post_type: postType || 'photo',
      title: title || null,
      body: body || null,
      pinned_until: pinnedUntil || null,
    };
    const { data, error } = await client.from('checkin_photos').insert(payload).select().single();
    if (error) throw error;
    const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(photoUrl || '');
    const eventName = postType === 'editorial' ? 'editorial_posted'
                    : postType === 'text'      ? 'status_posted'
                    : isVideo                  ? 'video_posted'
                                               : 'photo_posted';
    track(eventName, { venue_id: venueId || null, city_slug: citySlug, has_caption: !!caption, media_count: payload.media_urls?.length || 0 });
    return data;
  } catch(e) { console.error('saveCheckinPhoto error', e); return null; }
}

// Quick text-only status post. Optional venue tag.
async function saveTextPost({ text, venueId, citySlug }) {
  if (!currentUser) return null;
  if (!text || !text.trim()) return null;
  return saveCheckinPhoto({
    userId:    currentUser.id,
    venueId:   venueId || null,
    citySlug:  citySlug || (typeof state !== 'undefined' && state?.city?.slug) || 'san-diego',
    caption:   text.trim(),
    postType:  'text',
  });
}

// Editorial post (officials only — client gates via is_official check).
async function saveEditorialPost({ title, body, mediaUrls, venueId, citySlug, pinnedUntilDays }) {
  if (!currentUser) return null;
  const pinnedUntil = pinnedUntilDays
    ? new Date(Date.now() + pinnedUntilDays * 86400000).toISOString()
    : null;
  return saveCheckinPhoto({
    userId:    currentUser.id,
    venueId:   venueId || null,
    citySlug:  citySlug || (typeof state !== 'undefined' && state?.city?.slug) || 'san-diego',
    title:     title || null,
    body:      body || null,
    mediaUrls: Array.isArray(mediaUrls) ? mediaUrls : null,
    postType:  'editorial',
    pinnedUntil,
  });
}

// Edit caption / title / body of a post you own (RLS enforces ownership).
async function updateMyPost(postId, { caption, title, body, pinnedUntilDays }) {
  if (!currentUser) return { error: 'Not signed in' };
  const session = getSession();
  if (!session?.access_token) return { error: 'No auth' };
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${session.access_token}` } }
  });
  const patch = { edited: true, updated_at: new Date().toISOString() };
  if (typeof caption !== 'undefined') patch.caption = caption || null;
  if (typeof title   !== 'undefined') patch.title   = title   || null;
  if (typeof body    !== 'undefined') patch.body    = body    || null;
  if (typeof pinnedUntilDays !== 'undefined') {
    patch.pinned_until = pinnedUntilDays ? new Date(Date.now() + pinnedUntilDays * 86400000).toISOString() : null;
  }
  const { error } = await client.from('checkin_photos').update(patch).eq('id', postId).eq('user_id', currentUser.id);
  if (error) return { error: error.message };
  track('post_edited', {});
  return { ok: true };
}

// Currently-pinned editorial posts for a city. Used to render at top of feed.
async function fetchPinnedEditorialPosts(citySlug, limit = 3) {
  try {
    const { data } = await db.from('checkin_photos')
      .select('id, user_id, venue_id, photo_url, media_urls, caption, title, body, post_type, city_slug, pinned_until, created_at, edited')
      .eq('city_slug', citySlug)
      .eq('post_type', 'editorial')
      .gt('pinned_until', new Date().toISOString())
      .order('pinned_until', { ascending: false })
      .limit(limit);
    return data || [];
  } catch(e) { return []; }
}

async function fetchCheckinPhotos(venueId, limit = 20) {
  try {
    const { data, error } = await db.from('checkin_photos')
      .select('*')
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    const rows = data || [];
    // Enrich with display names
    const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
    if (userIds.length) {
      const { data: profiles } = await db.from('profiles')
        .select('id, display_name, avatar_emoji, avatar_url, is_official').in('id', userIds);
      const pMap = {};
      (profiles || []).forEach(p => { pMap[p.id] = p; });
      rows.forEach(r => { r.profile = pMap[r.user_id] || null; });
    }
    return rows;
  } catch(e) { return []; }
}

async function deleteCheckinPhotoFromDB(photoId, storagePath) {
  try {
    const session = getSession();
    const client  = session?.access_token
      ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          global: { headers: { Authorization: `Bearer ${session.access_token}` } }
        })
      : db;
    await client.storage.from(CHECKIN_PHOTO_BUCKET).remove([storagePath]);
    await client.from('checkin_photos').delete().eq('id', photoId);
    return true;
  } catch(e) { return false; }
}

// ── PROFILE PHOTO UPLOAD ──────────────────────────────
const PROFILE_PHOTO_BUCKET = 'checkin-photos'; // reuse same bucket, different path prefix

async function uploadProfilePhoto(file, userId, type) {
  // type: 'avatar' or 'header'
  const ext  = file.name?.split('.').pop().replace('heic','jpg') || 'jpg';
  const path = `profiles/${userId}/${type}-${Date.now()}.${ext}`;

  const session = getSession();
  const client  = session?.access_token
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${session.access_token}` } }
      })
    : db;

  const { data, error } = await client.storage
    .from(PROFILE_PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: true });

  if (error) { console.error('uploadProfilePhoto error', error); return null; }

  const { data: urlData } = client.storage
    .from(PROFILE_PHOTO_BUCKET)
    .getPublicUrl(path);

  // Save URL to profile
  const field = type === 'avatar' ? 'avatar_url' : 'header_url';
  await updateProfile(userId, { [field]: urlData.publicUrl });

  return urlData.publicUrl;
}

// ── SOCIAL COMMENTS ───────────────────────────────────
async function fetchComments(postId, postType) {
  try {
    const { data } = await db.from('social_comments')
      .select('id, user_id, post_id, post_type, text, created_at')
      .eq('post_id', postId)
      .eq('post_type', postType)
      .order('created_at', { ascending: true })
      .limit(50);
    if (!data || !data.length) return [];
    const uids = [...new Set(data.map(c => c.user_id))];
    const { data: profiles } = await db.from('profiles').select('id, display_name, avatar_emoji, avatar_url, is_official').in('id', uids);
    const pmap = Object.fromEntries((profiles||[]).map(p => [p.id, p]));
    return data.map(c => ({ ...c, profile: pmap[c.user_id] || {} }));
  } catch(e) { console.error('fetchComments:', e); return []; }
}

async function addComment(postId, postType, userId, text) {
  try {
    const session = getSession();
    const client = session?.access_token
      ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          global: { headers: { Authorization: `Bearer ${session.access_token}` } }
        })
      : db;
    const { data, error } = await client.from('social_comments').insert({
      post_id: postId, post_type: postType, user_id: userId, text
    }).select().single();
    if (error) throw error;
    track('comment_added', { post_type: postType });
    return data;
  } catch(e) { console.error('addComment:', e); return null; }
}

async function fetchCommentCountsBulk(postIds) {
  try {
    if (!postIds.length) return {};
    const { data } = await db.from('social_comments')
      .select('post_id')
      .in('post_id', postIds);
    const map = {};
    (data || []).forEach(r => {
      map[r.post_id] = (map[r.post_id] || 0) + 1;
    });
    return map;
  } catch(e) { console.error('fetchCommentCountsBulk:', e); return {}; }
}

// ── SOCIAL LIKES ──────────────────────────────────────
async function fetchLikes(postId, postType) {
  try {
    const { data, count } = await db.from('social_likes')
      .select('id, user_id', { count: 'exact' })
      .eq('post_id', postId)
      .eq('post_type', postType);
    return { count: count || (data?.length || 0), likes: data || [] };
  } catch(e) { console.error('fetchLikes:', e); return { count: 0, likes: [] }; }
}

async function fetchLikesBulk(postIds) {
  try {
    if (!postIds.length) return {};
    const { data } = await db.from('social_likes')
      .select('post_id, user_id')
      .in('post_id', postIds);
    const map = {};
    (data || []).forEach(r => {
      if (!map[r.post_id]) map[r.post_id] = [];
      map[r.post_id].push(r.user_id);
    });
    return map;
  } catch(e) { console.error('fetchLikesBulk:', e); return {}; }
}

async function toggleLike(postId, postType, userId) {
  try {
    const session = getSession();
    const client = session?.access_token
      ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          global: { headers: { Authorization: `Bearer ${session.access_token}` } }
        })
      : db;
    // Check if already liked
    const { data: existing } = await client.from('social_likes')
      .select('id')
      .eq('post_id', postId)
      .eq('post_type', postType)
      .eq('user_id', userId)
      .maybeSingle();
    if (existing) {
      await client.from('social_likes').delete().eq('id', existing.id);
      track('like_toggled', { post_type: postType, liked: false });
      return { liked: false };
    } else {
      await client.from('social_likes').insert({ post_id: postId, post_type: postType, user_id: userId });
      // Loops: post_liked — fire for the liker (could trigger "your community is active" campaigns)
      sendLoopsEvent('post_liked', { postId, postType });
      track('like_toggled', { post_type: postType, liked: true });
      return { liked: true };
    }
  } catch(e) { console.error('toggleLike:', e); return null; }
}

// ── ACTIVITY NOTIFICATIONS ────────────────────────────
// Fetch likes and comments on the current user's posts
async function fetchMyPostActivity(userId) {
  try {
    // Get all post IDs owned by this user from activity_feed, checkin_photos, check_ins
    const [af, cp, ci] = await Promise.all([
      db.from('activity_feed').select('id').eq('user_id', userId),
      db.from('checkin_photos').select('id').eq('user_id', userId),
      db.from('check_ins').select('id, venue_id').eq('user_id', userId),
    ]);
    const myPostIds = new Set();
    (af.data || []).forEach(r => myPostIds.add('activity-' + r.id));
    (cp.data || []).forEach(r => myPostIds.add('photo-' + r.id));
    (ci.data || []).forEach(r => myPostIds.add('going-' + r.id));
    if (!myPostIds.size) return [];

    const postIdArr = [...myPostIds];
    // Fetch likes on my posts (not by me)
    const { data: likes } = await db.from('social_likes')
      .select('id, post_id, post_type, user_id, created_at')
      .in('post_id', postIdArr)
      .neq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    // Fetch comments on my posts (not by me)
    const { data: comments } = await db.from('social_comments')
      .select('id, post_id, post_type, user_id, text, created_at')
      .in('post_id', postIdArr)
      .neq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    // Fetch profiles for all users involved
    const userIds = [...new Set([...(likes||[]).map(l=>l.user_id), ...(comments||[]).map(c=>c.user_id)])];
    const profiles = {};
    if (userIds.length) {
      const { data: pdata } = await db.from('profiles').select('id, display_name, avatar_emoji, avatar_url, is_official').in('id', userIds);
      (pdata || []).forEach(p => { profiles[p.id] = p; });
    }

    // Merge into unified list sorted by time
    const items = [];
    (likes || []).forEach(l => items.push({ type: 'like', ...l, profile: profiles[l.user_id] || {} }));
    (comments || []).forEach(c => items.push({ type: 'comment', ...c, profile: profiles[c.user_id] || {} }));
    items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return items.slice(0, 50);
  } catch(e) { console.error('fetchMyPostActivity:', e); return []; }
}

// ── SOCIAL FEED ────────────────────────────────────────
// Fetches a city-wide social feed merging photos, check-ins,
// reviews, and going-tonight activity. Following-first ordering
// is applied client-side after the parallel fetches.
async function fetchSocialFeed(citySlug, followingIds = [], limit = 60) {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Parallel fetch all four sources
    const [photosRes, activityRes, goingRes] = await Promise.allSettled([
      // 1. Posts (city-wide, last 30 days). post_type covers photo / text / editorial.
      db.from('checkin_photos')
        .select('id, user_id, venue_id, photo_url, media_urls, caption, title, body, post_type, city_slug, pinned_until, edited, created_at')
        .eq('city_slug', citySlug)
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
        .limit(limit),

      // 2. Activity feed (check-ins, reviews, favorites) city-wide via venue
      db.from('activity_feed')
        .select('id, user_id, activity_type, venue_id, venue_name, neighborhood, meta, created_at')
        .in('activity_type', ['check_in', 'review', 'favorite', 'tagged_at'])
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
        .limit(limit),

      // 3. Going tonight (today only)
      db.from('check_ins')
        .select('id, user_id, venue_id, city_slug, created_at')
        .eq('city_slug', citySlug)
        .eq('date', new Date().toISOString().slice(0, 10))
        .order('created_at', { ascending: false })
        .limit(40),
    ]);

    const photos   = photosRes.status   === 'fulfilled' ? (photosRes.value.data   || []) : [];
    const activity = activityRes.status === 'fulfilled' ? (activityRes.value.data || []) : [];
    const going    = goingRes.status    === 'fulfilled' ? (goingRes.value.data    || []) : [];

    // Collect all unique user IDs across all sources
    const allUserIds = [...new Set([
      ...photos.map(r => r.user_id),
      ...activity.map(r => r.user_id),
      ...going.map(r => r.user_id),
    ].filter(Boolean))];

    // Fetch profiles in one shot
    const pMap = {};
    if (allUserIds.length) {
      const { data: profiles } = await db.from('profiles')
        .select('id, display_name, avatar_emoji, avatar_url, username, is_official')
        .in('id', allUserIds);
      (profiles || []).forEach(p => { pMap[p.id] = p; });
    }

    // Fetch venue names for going-tonight (not denormalized there)
    const venueIds = [...new Set(going.map(r => r.venue_id).filter(Boolean))];
    const vMap = {};
    if (venueIds.length) {
      const { data: venues } = await db.from('venues')
        .select('id, name, neighborhood')
        .in('id', venueIds);
      (venues || []).forEach(v => { vMap[v.id] = v; });
    }

    // Normalise into a unified shape
    const followSet = new Set(followingIds);

    const items = [
      // Posts (photo / text / editorial — all live in checkin_photos)
      ...photos.map(r => ({
        id:           `photo-${r.id}`,
        post_id_raw:  r.id,
        type:         r.post_type === 'editorial' ? 'editorial'
                    : r.post_type === 'text'      ? 'text'
                    :                               'photo',
        user_id:      r.user_id,
        venue_id:     r.venue_id,
        photo_url:    r.photo_url,
        media_urls:   Array.isArray(r.media_urls) ? r.media_urls : (r.photo_url ? [r.photo_url] : []),
        caption:      r.caption || '',
        title:        r.title || null,
        body:         r.body || null,
        pinned_until: r.pinned_until || null,
        edited:       !!r.edited,
        venue_name:   null,
        neighborhood: null,
        created_at:   r.created_at,
        profile:      pMap[r.user_id] || null,
        isFollowing:  followSet.has(r.user_id),
      })),

      // Activity feed events (dedupe check-ins that also have a photo)
      ...activity.map(r => ({
        id:          `activity-${r.id}`,
        type:        r.activity_type,  // 'check_in' | 'review' | 'favorite'
        user_id:     r.user_id,
        venue_id:    r.venue_id,
        venue_name:  r.venue_name,
        neighborhood: r.neighborhood,
        meta:        r.meta || {},
        created_at:  r.created_at,
        profile:     pMap[r.user_id] || null,
        isFollowing: followSet.has(r.user_id),
      })),

      // Going tonight
      ...going.map(r => ({
        id:          `going-${r.id}`,
        type:        'going_tonight',
        user_id:     r.user_id,
        venue_id:    r.venue_id,
        venue_name:  vMap[r.venue_id]?.name || null,
        neighborhood: vMap[r.venue_id]?.neighborhood || null,
        created_at:  r.created_at,
        profile:     pMap[r.user_id] || null,
        isFollowing: followSet.has(r.user_id),
      })),
    ];

    // Remove current user's own activity (they see it in their profile)
    // Actually keep it — seeing yourself in the city feed is a nice touch

    // Dedupe by (user, venue, day). A single check-in can surface from up to
    // three sources at once: a photo post, the check_ins table ("going_tonight"),
    // and the activity_feed row. Prefer photo > going_tonight > check_in so the
    // user only ever sees one card.
    const keyOf = (i) => `${i.user_id}-${i.venue_id}-${i.created_at?.slice(0,10)}`;
    const photoKeys = new Set(items.filter(i => i.type === 'photo').map(keyOf));
    const goingKeys = new Set(items.filter(i => i.type === 'going_tonight').map(keyOf));
    const deduped = items.filter(i => {
      if (i.type === 'photo') return true;
      const k = keyOf(i);
      // going_tonight loses to a photo of the same check-in
      if (i.type === 'going_tonight') return !photoKeys.has(k);
      // check_in (activity_feed) loses to either a photo or a going_tonight
      if (i.type === 'check_in') return !photoKeys.has(k) && !goingKeys.has(k);
      return true;
    });

    // Sort: following first, then by recency within each group
    deduped.sort((a, b) => {
      if (a.isFollowing && !b.isFollowing) return -1;
      if (!a.isFollowing && b.isFollowing) return 1;
      return new Date(b.created_at) - new Date(a.created_at);
    });

    return deduped.slice(0, limit);
  } catch(e) {
    console.error('fetchSocialFeed error', e);
    return [];
  }
}

// ── VENUE DESCRIPTIONS ("Locals Say") ─────────────────
async function fetchTopDescriptions(venueIds) {
  if (!venueIds.length) return {};
  try {
    const { data } = await db.from('venue_descriptions')
      .select('venue_id, description_text, profiles(display_name)')
      .in('venue_id', venueIds)
      .order('upvotes', { ascending: false })
      .limit(200);
    if (!data) return {};
    // Keep only the top description per venue
    const map = {};
    data.forEach(d => { if (!map[d.venue_id]) map[d.venue_id] = d; });
    return map;
  } catch(e) { return {}; }
}

async function fetchVenueDescriptions(venueId) {
  try {
    const { data } = await db.from('venue_descriptions')
      .select('*, profiles(display_name, avatar_url, avatar_emoji)')
      .eq('venue_id', venueId)
      .order('upvotes', { ascending: false });
    return data || [];
  } catch(e) { return []; }
}

async function submitVenueDescription(venueId, text, tags) {
  if (!currentUser) return null;
  const { data, error } = await db.from('venue_descriptions')
    .upsert({
      user_id: currentUser.id,
      venue_id: venueId,
      description_text: text,
      tags: tags || [],
    }, { onConflict: 'user_id,venue_id' })
    .select()
    .single();
  if (error) { console.error('submitDesc error', error); return null; }
  return data;
}

async function toggleDescUpvote(descId) {
  if (!currentUser) return;
  // Check if already upvoted
  const { data: existing } = await db.from('description_upvotes')
    .select('id')
    .eq('user_id', currentUser.id)
    .eq('description_id', descId)
    .maybeSingle();
  if (existing) {
    await db.from('description_upvotes').delete().eq('id', existing.id);
    await db.rpc('decrement_desc_upvotes', { desc_id: descId }).catch(() => {
      // Fallback: manual decrement
      db.from('venue_descriptions').select('upvotes').eq('id', descId).single().then(({ data }) => {
        if (data) db.from('venue_descriptions').update({ upvotes: Math.max(0, (data.upvotes || 0) - 1) }).eq('id', descId);
      });
    });
    return false;
  } else {
    await db.from('description_upvotes').insert({ user_id: currentUser.id, description_id: descId });
    await db.rpc('increment_desc_upvotes', { desc_id: descId }).catch(() => {
      db.from('venue_descriptions').select('upvotes').eq('id', descId).single().then(({ data }) => {
        if (data) db.from('venue_descriptions').update({ upvotes: (data.upvotes || 0) + 1 }).eq('id', descId);
      });
    });
    return true;
  }
}

async function fetchMyUpvotedDescs(venueId) {
  if (!currentUser) return new Set();
  try {
    const { data } = await db.from('description_upvotes')
      .select('description_id')
      .eq('user_id', currentUser.id);
    return new Set((data || []).map(d => d.description_id));
  } catch(e) { return new Set(); }
}

// ── CURATED LISTS ─────────────────────────────────────
async function fetchUserLists(userId) {
  try {
    const { data } = await db.from('user_lists')
      .select('*, list_items(count)')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    return data || [];
  } catch(e) { return []; }
}

async function createList(title, description, emoji) {
  if (!currentUser) return null;
  const { data, error } = await db.from('user_lists')
    .insert({
      user_id: currentUser.id,
      title,
      description: description || null,
      cover_emoji: emoji || '\uD83C\uDF78',
    })
    .select()
    .single();
  if (error) { console.error('createList error', error); return null; }
  return data;
}

async function fetchListDetail(listId) {
  try {
    const { data: list, error: listErr } = await db.from('user_lists')
      .select('*, profiles(display_name, avatar_url)')
      .eq('id', listId)
      .single();
    if (listErr || !list) {
      // Retry without join in case profiles relation fails
      const { data: listOnly } = await db.from('user_lists')
        .select('*')
        .eq('id', listId)
        .single();
      if (!listOnly) return null;
      Object.assign(listOnly, { profiles: null });
      const { data: items } = await db.from('list_items')
        .select('*, venues(id, name, neighborhood, cuisine, photo_url, deals, days)')
        .eq('list_id', listId)
        .order('position');
      listOnly.items = items || [];
      return listOnly;
    }
    const { data: items } = await db.from('list_items')
      .select('*, venues(id, name, neighborhood, cuisine, photo_url, deals, days)')
      .eq('list_id', listId)
      .order('position');
    list.items = items || [];
    return list;
  } catch(e) { console.error('fetchListDetail error:', e); return null; }
}

async function addToList(listId, venueId, note) {
  const { data: items } = await db.from('list_items')
    .select('position')
    .eq('list_id', listId)
    .order('position', { ascending: false })
    .limit(1);
  const nextPos = items?.length ? (items[0].position + 1) : 0;
  const { error } = await db.from('list_items')
    .insert({ list_id: listId, venue_id: venueId, note: note || null, position: nextPos });
  if (!error) {
    await db.from('user_lists').update({ updated_at: new Date().toISOString() }).eq('id', listId);
  }
  return !error;
}

async function removeFromList(listId, venueId) {
  const { error } = await db.from('list_items')
    .delete()
    .eq('list_id', listId)
    .eq('venue_id', venueId);
  return !error;
}

async function fetchListsContainingVenue(venueId) {
  if (!currentUser) return [];
  try {
    const { data: lists } = await db.from('user_lists')
      .select('id, title, cover_emoji')
      .eq('user_id', currentUser.id)
      .order('updated_at', { ascending: false });
    if (!lists?.length) return [];
    const { data: items } = await db.from('list_items')
      .select('list_id')
      .eq('venue_id', venueId)
      .in('list_id', lists.map(l => l.id));
    const inSet = new Set((items || []).map(i => i.list_id));
    return lists.map(l => ({ ...l, hasVenue: inSet.has(l.id) }));
  } catch(e) { return []; }
}

async function toggleListSave(listId) {
  if (!currentUser) return;
  const { data: existing } = await db.from('list_saves')
    .select('id')
    .eq('user_id', currentUser.id)
    .eq('list_id', listId)
    .maybeSingle();
  if (existing) {
    await db.from('list_saves').delete().eq('id', existing.id);
    return false;
  } else {
    await db.from('list_saves').insert({ user_id: currentUser.id, list_id: listId });
    return true;
  }
}

async function deleteList(listId) {
  if (!currentUser) return false;
  const { error } = await db.from('user_lists')
    .delete()
    .eq('id', listId)
    .eq('user_id', currentUser.id);
  return !error;
}

// ── CHECK-IN MAP DATA ─────────────────────────────────
async function fetchTodayCheckInsWithProfiles(citySlug) {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { data } = await db.from('check_ins')
      .select('venue_id, user_id, profiles(display_name, avatar_url, avatar_emoji)')
      .eq('city_slug', citySlug)
      .eq('date', today);
    return data || [];
  } catch(e) { return []; }
}

// ════════════════════════════════════════════════════════
// GIVEAWAY + REFERRAL SYSTEM
// ════════════════════════════════════════════════════════

const PENDING_REFERRAL_KEY = 'spotd_pending_referral';

// Capture ?ref= from the URL on first load and stash it for the signup step.
function captureReferralFromURL() {
  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('ref');
    if (code) sessionStorage.setItem(PENDING_REFERRAL_KEY, code.toUpperCase());
    return sessionStorage.getItem(PENDING_REFERRAL_KEY) || null;
  } catch(e) { return null; }
}

function getPendingReferralCode() {
  try { return sessionStorage.getItem(PENDING_REFERRAL_KEY) || null; } catch(e) { return null; }
}

function setPendingReferralCode(code) {
  try {
    if (!code) sessionStorage.removeItem(PENDING_REFERRAL_KEY);
    else       sessionStorage.setItem(PENDING_REFERRAL_KEY, String(code).toUpperCase());
  } catch(e) {}
}

// Apply a stashed referral code to the freshly-signed-up user.
// Looks up the referrer by code, inserts a row in `referrals`, and sets
// profiles.referred_by. Idempotent: safe to call multiple times.
async function applyPendingReferral(newUserId) {
  if (!newUserId) return null;
  let code = null;
  try { code = sessionStorage.getItem(PENDING_REFERRAL_KEY); } catch(e) {}
  if (!code) return null;

  try {
    const { data: codeRow, error: codeErr } = await db
      .from('referral_codes')
      .select('user_id')
      .eq('code', code.toUpperCase())
      .maybeSingle();

    if (codeErr || !codeRow) {
      sessionStorage.removeItem(PENDING_REFERRAL_KEY);
      return null;
    }
    if (codeRow.user_id === newUserId) {
      sessionStorage.removeItem(PENDING_REFERRAL_KEY);
      return null;
    }

    const { error: refErr } = await db.from('referrals').insert({
      referrer_id:        codeRow.user_id,
      referee_id:         newUserId,
      referral_code_used: code.toUpperCase(),
    });

    // Unique violation = already referred; treat as success.
    if (refErr && refErr.code !== '23505') {
      console.warn('applyPendingReferral insert error', refErr);
    }

    if (!refErr || refErr.code === '23505') {
      try {
        await db.from('profiles')
          .update({ referred_by: codeRow.user_id })
          .eq('id', newUserId);
      } catch(e) {}
      if (!refErr) track('referral_applied', { source: 'pending_code' });
    }

    sessionStorage.removeItem(PENDING_REFERRAL_KEY);
    return codeRow.user_id;
  } catch(e) {
    console.warn('applyPendingReferral error', e);
    return null;
  }
}

async function getMyReferralCode() {
  if (!currentUser) return null;
  try {
    const { data } = await db.from('referral_codes')
      .select('code')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    return data?.code || null;
  } catch(e) { return null; }
}

// { total, self, referral } for the current ISO week (PT).
async function getMyEntriesThisWeek() {
  if (!currentUser) return { total: 0, self: 0, referral: 0 };
  try {
    const { data: weekStart, error: wsErr } = await db.rpc('current_week_start_pt');
    if (wsErr) throw wsErr;
    const { data: entries } = await db.from('giveaway_entries')
      .select('entry_type')
      .eq('user_id', currentUser.id)
      .eq('week_start', weekStart);
    const rows     = entries || [];
    const self     = rows.filter(e => e.entry_type === 'self').length;
    const referral = rows.filter(e => e.entry_type === 'referral_bonus').length;
    return { total: self + referral, self, referral, weekStart };
  } catch(e) {
    console.warn('getMyEntriesThisWeek error', e);
    return { total: 0, self: 0, referral: 0 };
  }
}

async function getMyReferralStats() {
  if (!currentUser) return { totalReferred: 0, activeThisWeek: 0 };
  try {
    const { count: totalReferred } = await db.from('referrals')
      .select('*', { count: 'exact', head: true })
      .eq('referrer_id', currentUser.id);

    const { data: weekStart } = await db.rpc('current_week_start_pt');
    const { count: activeThisWeek } = await db.from('giveaway_entries')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', currentUser.id)
      .eq('week_start', weekStart)
      .eq('entry_type', 'referral_bonus');

    return {
      totalReferred:   totalReferred  ?? 0,
      activeThisWeek:  activeThisWeek ?? 0,
    };
  } catch(e) {
    return { totalReferred: 0, activeThisWeek: 0 };
  }
}

// Public read; used to show "last week's winner".
async function getLastWeekWinner() {
  try {
    const { data } = await db.from('giveaway_winners')
      .select('week_start, winner_user_id, total_entries, winner_entry_count, prize_status, profiles!inner(display_name, avatar_url)')
      .order('week_start', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data || null;
  } catch(e) { return null; }
}

// ════════════════════════════════════════════════════════
// SIGNUP ATTRIBUTION
// ════════════════════════════════════════════════════════

const PENDING_ATTRIBUTION_KEY = 'spotd_pending_attribution';

function getPendingAttribution() {
  try { return sessionStorage.getItem(PENDING_ATTRIBUTION_KEY) || null; } catch(e) { return null; }
}

// Write the stashed attribution (selected during onboarding) to the DB.
// Idempotent: PK is user_id, so a second insert silently no-ops.
async function applyPendingAttribution(newUserId) {
  if (!newUserId) return null;
  let source = null;
  try { source = sessionStorage.getItem(PENDING_ATTRIBUTION_KEY); } catch(e) {}
  if (!source) return null;

  try {
    const { error } = await db.from('signup_attributions').insert({
      user_id: newUserId,
      source:  source,
    });
    // 23505 = already recorded; treat as success
    if (error && error.code !== '23505') {
      console.warn('applyPendingAttribution error', error);
    }
  } catch(e) {
    console.warn('applyPendingAttribution exception', e);
  } finally {
    try { sessionStorage.removeItem(PENDING_ATTRIBUTION_KEY); } catch(e) {}
  }
  return source;
}

// Has this user already been referred? Used to gate the post-signup
// "Did someone refer you?" modal so it doesn't show for users who came in
// via ?ref=CODE.
async function userHasReferrer(userId) {
  if (!userId) return false;
  try {
    const { data } = await db.from('referrals')
      .select('referee_id')
      .eq('referee_id', userId)
      .maybeSingle();
    return !!data;
  } catch(e) { return false; }
}

// Apply a referral code typed in by the user post-signup (from the
// "Did someone refer you?" modal or the profile-tile fallback).
// Returns { ok, error, referrerId }.
async function applyReferralCodeManually(code) {
  if (!currentUser) return { ok: false, error: 'Not signed in' };
  const clean = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(clean)) return { ok: false, error: 'Code should be 6 letters/numbers' };

  try {
    const { data: codeRow } = await db.from('referral_codes')
      .select('user_id')
      .eq('code', clean)
      .maybeSingle();
    if (!codeRow) return { ok: false, error: "We couldn't find that code" };
    if (codeRow.user_id === currentUser.id) return { ok: false, error: "Can't use your own code" };

    const { error: refErr } = await db.from('referrals').insert({
      referrer_id:        codeRow.user_id,
      referee_id:         currentUser.id,
      referral_code_used: clean,
    });
    if (refErr && refErr.code !== '23505') {
      return { ok: false, error: refErr.message || 'Could not save referral' };
    }
    if (refErr && refErr.code === '23505') {
      return { ok: false, error: 'You already entered a referral code' };
    }

    // Mirror onto profiles.referred_by for fast lookup
    try {
      await db.from('profiles')
        .update({ referred_by: codeRow.user_id })
        .eq('id', currentUser.id);
    } catch(e) {}

    track('referral_applied', { source: 'manual_modal' });
    return { ok: true, referrerId: codeRow.user_id };
  } catch(e) {
    return { ok: false, error: e.message || 'Unexpected error' };
  }
}
