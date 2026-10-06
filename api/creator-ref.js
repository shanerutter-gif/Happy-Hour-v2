// GET /r/:handle  (wired in vercel.json: /r/([^/]+) -> /api/creator-ref.js?handle=$1)
// Creator referral links (spec §9): spotd.biz/r/[handle] resolves the
// creator's handle, logs the click attribution, and redirects into the
// EXISTING referral pipeline (/?ref=CODE -> sessionStorage ->
// applyPendingReferral -> referrals row + profiles.referred_by).
//
// Deliberate reuse (no parallel attribution system): creator-driven signups
// are measured by querying `referrals` where referrer_id = the creator's id.
// No `referred_by_creator` column was added — profiles.referred_by already
// carries it.
export const config = { runtime: 'edge' };

function supa() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://opcskuzbdfrlnyhraysk.supabase.co',
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

async function rest(path, url, key, init = {}) {
  const r = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  return r.json();
}

export default async function handler(req) {
  const { url, key } = supa();
  const u = new URL(req.url);
  const rawHandle = (u.searchParams.get('handle') || '').trim().replace(/^@/, '');

  const goHome = (ref) =>
    Response.redirect(`${u.origin}/${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`, 302);

  if (!rawHandle || !key) return goHome(null);

  try {
    // 1. Resolve handle -> active creator.
    const creators = await rest(
      `profiles?is_creator=eq.true&username=ilike.${encodeURIComponent(rawHandle)}&select=id,username&limit=1`,
      url, key
    );
    const creator = creators && creators[0];
    if (!creator) return goHome(null);

    // 2. Fire-and-forget click attribution (never blocks the redirect).
    rest('analytics_events', url, key, {
      method: 'POST',
      body: JSON.stringify({
        event_name: 'creator_ref_click',
        props: { creator_id: creator.id, handle: creator.username },
        path: `/r/${creator.username}`,
        platform: 'web',
      }),
    }).catch(() => {});

    // 3. Resolve the creator's referral code (auto-minted for every profile
    //    by the giveaway_system trigger) and hand off to the existing flow.
    const codes = await rest(
      `referral_codes?user_id=eq.${creator.id}&select=code&limit=1`,
      url, key
    );
    const code = codes && codes[0] && codes[0].code;
    return goHome(code || null);
  } catch (e) {
    console.error('[creator-ref] failed:', e.message);
    return goHome(null);
  }
}
