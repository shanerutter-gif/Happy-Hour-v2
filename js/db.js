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

// Restore session on every page load
(async () => {
  try {
    const raw = localStorage.getItem(_storageKey);
    if (raw) {
      const stored = JSON.parse(raw);
      if (stored?.user && stored?.expires_at > Math.floor(Date.now() / 1000)) {
        currentUser  = stored.user;
        _accessToken = stored.access_token;
        await loadFavorites();
        if (typeof onAuthChange === 'function') onAuthChange(currentUser);
      }
    }
  } catch(e) {}
})();

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
  const { data } = await db.from('cities').select('*').order('name');
  return data || [];
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
    // Ensure both users have a profile row (FK requirement)
    await db.from('profiles').upsert({ id: followingId }, { onConflict: 'id', ignoreDuplicates: true });
    await db.from('profiles').upsert({ id: followerId  }, { onConflict: 'id', ignoreDuplicates: true });
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
      return { id: userId, display_name: null, bio: null, avatar_emoji: '🍺', is_public: true };
    }
    // If no profile row exists yet, return a stub (user exists but never set up profile)
    if (!data) return { id: userId, display_name: null, bio: null, avatar_emoji: '🍺', is_public: true };
    // Respect privacy — is_public defaults to true if column doesn't exist yet
    if (data.is_public === false) return null;
    return data;
  } catch(e) { return { id: userId, display_name: null, bio: null, avatar_emoji: '🍺', is_public: true }; }
}
async function searchProfiles(query) {
  try {
    const { data, error } = await db.from('profiles')
      .select('id, display_name, avatar_emoji, username, bio')
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
