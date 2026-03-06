/* ═══════════════════════════════════════════════════════
   DB.JS — Supabase client + all data helpers
   !! Replace the two placeholders below before deploying !!
   ═══════════════════════════════════════════════════════ */

const SUPABASE_URL      = 'REPLACE_WITH_YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'REPLACE_WITH_YOUR_SUPABASE_ANON_KEY';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: {
      getItem:    k => { try { return localStorage.getItem(k);    } catch { return sessionStorage.getItem(k);    } },
      setItem:    (k,v) => { try { localStorage.setItem(k,v);    } catch { sessionStorage.setItem(k,v);    } },
      removeItem: k => { try { localStorage.removeItem(k);       } catch { sessionStorage.removeItem(k);       } }
    }
  }
});

// ── AUTH STATE ─────────────────────────────────────────
let currentUser   = null;
let userFavorites = new Set();

db.auth.onAuthStateChange(async (_event, session) => {
  currentUser = session?.user ?? null;
  if (currentUser) await loadFavorites();
  else userFavorites = new Set();
  if (typeof onAuthChange === 'function') onAuthChange(currentUser);
});

async function getSession() {
  const { data } = await db.auth.getSession();
  return data.session;
}

// ── AUTH — goes through /api/auth proxy ────────────────
// This ensures sign-in works on Chrome iOS, Safari, and
// iPhone home screen (PWA) mode across all environments.
async function authSignIn(email, password) {
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'signin', email, password })
    });
    const data = await res.json();
    if (data.error_description || data.error) {
      return { error: { message: data.error_description || data.error } };
    }
    const { error } = await db.auth.setSession({
      access_token:  data.access_token,
      refresh_token: data.refresh_token
    });
    return { data, error };
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
    if (data.error_description || data.error) {
      return { error: { message: data.error_description || data.error } };
    }
    if (data.access_token) {
      await db.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
    }
    return { data, error: null };
  } catch (e) {
    return { error: { message: e.message } };
  }
}

async function authSignOut() {
  await db.auth.signOut();
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

// ── REVIEWS ────────────────────────────────────────────
async function fetchReviews(venueId) {
  const { data } = await db.from('reviews')
    .select('*, profiles(display_name)')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false });
  return data || [];
}
async function fetchMyReviews(userId) {
  const { data } = await db.from('reviews').select('*').eq('user_id', userId)
    .order('created_at', { ascending: false });
  return data || [];
}
async function postReview({ venueId, rating, text, guestName }) {
  const session = await getSession();
  const payload = {
    venue_id: venueId, rating, text: text || null,
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
  const { data } = await db.from('favorites').select('venue_id').eq('user_id', currentUser.id);
  userFavorites = new Set((data || []).map(r => r.venue_id));
}
function isFavorite(venueId)   { return userFavorites.has(venueId); }
async function toggleFavorite(venueId) {
  if (!currentUser) return null;
  if (isFavorite(venueId)) {
    await db.from('favorites').delete().eq('user_id', currentUser.id).eq('venue_id', venueId);
    userFavorites.delete(venueId); return false;
  }
  await db.from('favorites').insert({ user_id: currentUser.id, venue_id: venueId });
  userFavorites.add(venueId); return true;
}
async function getFavoriteVenues(userId) {
  const { data } = await db.from('favorites').select('venue_id').eq('user_id', userId);
  return (data || []).map(r => r.venue_id);
}
