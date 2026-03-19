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

    if (stored.expires_at > now) {
      // Token still valid — restore directly
      currentUser  = stored.user;
      _accessToken = stored.access_token;
      await db.auth.setSession({
        access_token:  stored.access_token,
        refresh_token: stored.refresh_token || '',
      });
      _scheduleTokenRefresh(stored.expires_at - now);
    } else if (stored.refresh_token) {
      // Token expired — try to refresh silently
      const s = await _refreshAndPersist(stored.refresh_token);
      if (!s) {
        localStorage.removeItem(_storageKey);
        if (typeof onAuthChange === 'function') onAuthChange(null);
        return;
      }
    } else {
      // No refresh token — clear and bail
      localStorage.removeItem(_storageKey);
      return;
    }

    await loadFavorites();
    if (typeof onAuthChange === 'function') onAuthChange(currentUser);
  } catch(e) {
    console.warn('[initAuth] error', e);
  }
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
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'signup', email, password, name: displayName })
    });
    const data = await res.json();
    if (data.error_description) return { error: { message: data.error_description } };
    if (data.error)             return { error: { message: data.error } };
    if (data.access_token) return authSignIn(email, password);
    return { data, error: null };
  } catch (e) {
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
        .select('id, display_name, avatar_emoji')
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
    userFavorites.delete(id); return false;
  }
  await db.from('favorites').insert({ user_id: currentUser.id, item_id: id, item_type: itemType });
  userFavorites.add(id); return true;
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
    return true;
  } catch(e) { console.warn('addCheckIn error', e); return false; }
}
async function removeCheckIn(userId, venueId, date) {
  try {
    await db.from('check_ins').delete().eq('user_id', userId).eq('venue_id', venueId).eq('date', date);
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
      const { data: profiles } = await db.from('profiles').select('id, display_name, avatar_emoji, username').in('id', ids);
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
      .select('id, display_name, bio, avatar_emoji, username, digest_enabled, is_public')
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
      .select('id, display_name, avatar_emoji, bio')
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
    await db.from('activity_feed').insert({
      user_id:       toUserId,        // appears on the tagged user's feed
      activity_type: 'tagged_at',
      venue_id:      venueId,
      venue_name:    venueName,
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

  const { data, error } = await client.storage
    .from(CHECKIN_PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) { console.error('uploadCheckinPhoto error', error); return null; }

  const { data: urlData } = client.storage
    .from(CHECKIN_PHOTO_BUCKET)
    .getPublicUrl(path);

  return { url: urlData.publicUrl, storagePath: path };
}

async function saveCheckinPhoto({ userId, venueId, citySlug, photoUrl, storagePath, caption }) {
  try {
    const session = getSession();
    const client  = session?.access_token
      ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          global: { headers: { Authorization: `Bearer ${session.access_token}` } }
        })
      : db;
    const { data, error } = await client.from('checkin_photos').insert({
      user_id: userId, venue_id: venueId, city_slug: citySlug,
      photo_url: photoUrl, storage_path: storagePath, caption: caption || null
    }).select().single();
    if (error) throw error;
    return data;
  } catch(e) { console.error('saveCheckinPhoto error', e); return null; }
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
        .select('id, display_name, avatar_emoji').in('id', userIds);
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
    const { data: profiles } = await db.from('profiles').select('id, display_name, avatar_emoji').in('id', uids);
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
    return data;
  } catch(e) { console.error('addComment:', e); return null; }
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
      return { liked: false };
    } else {
      await client.from('social_likes').insert({ post_id: postId, post_type: postType, user_id: userId });
      return { liked: true };
    }
  } catch(e) { console.error('toggleLike:', e); return null; }
}

// ── SOCIAL FEED ────────────────────────────────────────
// Fetches a city-wide social feed merging photos, check-ins,
// reviews, and going-tonight activity. Following-first ordering
// is applied client-side after the parallel fetches.
async function fetchSocialFeed(citySlug, followingIds = [], limit = 60) {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Parallel fetch all four sources
    const [photosRes, activityRes, goingRes] = await Promise.allSettled([
      // 1. Photo check-ins (city-wide, last 7 days)
      db.from('checkin_photos')
        .select('id, user_id, venue_id, photo_url, caption, city_slug, created_at')
        .eq('city_slug', citySlug)
        .gte('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false })
        .limit(limit),

      // 2. Activity feed (check-ins, reviews, favorites) city-wide via venue
      db.from('activity_feed')
        .select('id, user_id, activity_type, venue_id, venue_name, neighborhood, meta, created_at')
        .in('activity_type', ['check_in', 'review', 'favorite'])
        .gte('created_at', sevenDaysAgo)
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
        .select('id, display_name, avatar_emoji, username')
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
      // Photo check-ins
      ...photos.map(r => ({
        id:          `photo-${r.id}`,
        type:        'photo',
        user_id:     r.user_id,
        venue_id:    r.venue_id,
        photo_url:   r.photo_url,
        caption:     r.caption || '',
        venue_name:  null, // resolved client-side via state.venues
        neighborhood: null,
        created_at:  r.created_at,
        profile:     pMap[r.user_id] || null,
        isFollowing: followSet.has(r.user_id),
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

    // Dedupe: if a check_in and a photo share the same user+venue+day, keep only the photo
    const photoKeys = new Set(
      items
        .filter(i => i.type === 'photo')
        .map(i => `${i.user_id}-${i.venue_id}-${i.created_at?.slice(0,10)}`)
    );
    const deduped = items.filter(i => {
      if (i.type !== 'check_in') return true;
      return !photoKeys.has(`${i.user_id}-${i.venue_id}-${i.created_at?.slice(0,10)}`);
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
