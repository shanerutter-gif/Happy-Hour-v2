/* ═══════════════════════════════════════════════════════
   DB.JS — Supabase client + all data helpers
   !! Replace the two placeholders below before deploying !!
   ═══════════════════════════════════════════════════════ */

const SUPABASE_URL      = 'REPLACE_WITH_YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'REPLACE_WITH_YOUR_SUPABASE_ANON_KEY';

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
  const { data } = await db.from('profiles').select('*').eq('id', userId).single();
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
  const { data } = await db.from('reviews')
    .select('*, profiles(display_name)')
    .eq(col, itemId)
    .order('created_at', { ascending: false });
  return data || [];
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
  const { data, error } = await db.from('reviews').insert(payload).select().single();
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
