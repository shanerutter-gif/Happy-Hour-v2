// GET /api/creators[?ordered_for=<city_slug>][&limit=N]
// Creator Program foundation (Spotd-side). Lists active creators for the
// creator directory page and the existing-user follow card. Pure ordering /
// eligibility helpers are exported for the node test harness.
//
// Spec: ~/workspace/goals/grow-and-monetize-spotd/hidden_files/creator-program-spec-2026-10-05.md (§2-§5, §9)

export const config = { runtime: 'edge' };

// ── Pure logic (unit-tested) ─────────────────────────────────────────────

// Ordering for auto-follow / directory display (spec §5):
// founding tier first, then creators covering the user's city, then the rest
// (earliest-joined first within each band). Scaling guard: when the roster
// exceeds 50, only the top 20 are returned.
export function orderCreatorsForAutoFollow(creators, userCitySlug) {
  const list = (creators || []).filter(c => c && c.id);
  const seen = new Set();
  const founding = [];
  const cityMatch = [];
  const rest = [];
  for (const c of list) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    if (c.creator_tier === 'founding') founding.push(c);
    else if (userCitySlug && c.city_slug === userCitySlug) cityMatch.push(c);
    else rest.push(c);
  }
  const bySeniority = (a, b) =>
    new Date(a.creator_since || a.created_at || 0) - new Date(b.creator_since || b.created_at || 0);
  founding.sort(bySeniority);
  cityMatch.sort(bySeniority);
  rest.sort(bySeniority);
  const ordered = [...founding, ...cityMatch, ...rest];
  // Scaling guard (spec §5): past 50 creators, auto-follow only the top 20.
  return ordered.length > 50 ? ordered.slice(0, 20) : ordered;
}

// Builds idempotent user_follows rows for a new signup. Dedupe is belt-and-
// braces: the DB trigger + unique(follower_id, following_id) is the real
// guard; this keeps client-side writers honest too.
export function buildAutoFollowRows(newUserId, orderedCreators) {
  if (!newUserId) return [];
  const seen = new Set();
  const rows = [];
  for (const c of orderedCreators || []) {
    if (!c || !c.id || c.id === newUserId || seen.has(c.id)) continue;
    seen.add(c.id);
    rows.push({ follower_id: newUserId, following_id: c.id, source: 'creator_auto_follow' });
  }
  return rows;
}

// Eligibility bar (spec §3). All six must hold. Thresholds are the pilot
// values from the spec; raise FOLLOWER_FLOOR once the program has a waitlist.
export const CREATOR_FOLLOWER_FLOOR = 1000;
export const CREATOR_MIN_POSTS_30D = 4;

export function meetsCreatorEligibility(input = {}) {
  const {
    hasNightlifeContent = false,
    postsLast30d = 0,
    followerCount = 0,
    cityRelevant = false,
    igAccountTypeOk = true, // false = personal IG account (API hard requirement)
    standingOk = false,    // manual review: nothing brand-unsafe
  } = input;
  return (
    hasNightlifeContent === true &&
    postsLast30d >= CREATOR_MIN_POSTS_30D &&
    followerCount >= CREATOR_FOLLOWER_FLOOR &&
    cityRelevant === true &&
    igAccountTypeOk === true &&
    standingOk === true
  );
}

// Normalizes a /r/[handle] path segment and matches it against a creator.
// Returns the creator object or null. Matching is case-insensitive and
// tolerates a leading @.
export function resolveCreatorRefHandle(handle, creators) {
  const norm = String(handle || '').trim().replace(/^@/, '').toLowerCase();
  if (!norm) return null;
  return (creators || []).find(c =>
    c && c.is_creator && String(c.username || '').toLowerCase() === norm
  ) || null;
}

export function creatorReferralPath(handle) {
  const norm = String(handle || '').trim().replace(/^@/, '');
  return `/r/${encodeURIComponent(norm)}`;
}

// ── HTTP handler ─────────────────────────────────────────────────────────

function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function supa(serviceRole) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://opcskuzbdfrlnyhraysk.supabase.co';
  const key = serviceRole
    ? process.env.SUPABASE_SERVICE_ROLE_KEY
    : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return { url, key };
}

async function rest(path, key, init = {}) {
  const { url } = supa(false);
  const r = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`supabase ${r.status}: ${await r.text()}`);
  return r.json();
}

export default async function handler(req) {
  if (req.method !== 'GET') return jsonRes({ error: 'Method not allowed' }, 405);
  const { key: svcKey } = supa(true);
  if (!svcKey) return jsonRes({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, 500);

  const u = new URL(req.url);
  const city = u.searchParams.get('ordered_for') || null;
  const limit = Math.min(parseInt(u.searchParams.get('limit') || '100', 10) || 100, 200);

  let creators;
  try {
    creators = await rest(
      'profiles?is_creator=eq.true' +
      '&select=id,display_name,username,avatar_url,avatar_emoji,creator_tier,creator_since,city_slug,created_at' +
      `&limit=${limit}`,
      svcKey
    );
  } catch (e) {
    console.error('[creators] list failed:', e.message);
    return jsonRes({ error: 'Failed to list creators' }, 500);
  }

  const ordered = orderCreatorsForAutoFollow(creators, city);
  return jsonRes({
    creators: ordered.map(c => ({
      id: c.id,
      display_name: c.display_name,
      username: c.username,
      avatar_url: c.avatar_url,
      avatar_emoji: c.avatar_emoji,
      creator_tier: c.creator_tier,
      creator_since: c.creator_since,
      city_slug: c.city_slug,
      referral_path: c.username ? creatorReferralPath(c.username) : null,
    })),
    count: ordered.length,
  });
}
