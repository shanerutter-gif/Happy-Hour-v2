// api/admin-enrich-venues.js — Google Places enrichment for venues.
//
// One-shot fill of photo_url/photo_urls/phone/place_id/google_rating/price_level/
// hours/url for venues that have name+address but lack media + contact metadata.
// Designed for batch use: client loops, each invocation processes `batch_size`
// venues so we stay well under the edge function timeout.
//
// Auth: caller must pass their Supabase access token in Authorization. Endpoint
// resolves the user via auth/v1/user and gates on email = shanerutter@gmail.com
// (mirrors public.is_giveaway_admin in the DB).
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY  (existing)
//   GOOGLE_PLACES_API_KEY               (new — set in Vercel before use)
//
// Usage examples:
//   GET  /api/admin-enrich-venues?action=preview&city=orange-county
//   POST /api/admin-enrich-venues   { action:'batch', city:'orange-county', batch_size:5, dry_run:false }
//   POST /api/admin-enrich-venues   { action:'venue', venue_id:'<uuid>' }

export const config = { runtime: 'edge' };

const ADMIN_EMAILS = new Set(['shanerutter@gmail.com']);

// Cap photos per venue. 4 keeps cost predictable and matches what fits on a card.
const MAX_PHOTOS = 4;

// Google Places SKU costs in micro-USD ($1e-6) — used for cost telemetry.
const COST = { find_place: 17_000, details_pro: 17_000, photo: 7_000 };

const PLACE_DETAIL_FIELDS = [
  'place_id', 'name', 'formatted_phone_number', 'international_phone_number',
  'website', 'opening_hours', 'rating', 'user_ratings_total',
  'price_level', 'photos', 'formatted_address',
].join(',');

// ── tiny helpers ─────────────────────────────────────
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
function corsPreflight() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
function slugify(s) {
  return String(s || '').toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── auth ─────────────────────────────────────────────
async function requireAdmin(req, supabaseUrl, serviceKey) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return { ok: false, error: 'Missing Bearer token', status: 401 };
  const token = auth.slice(7);
  const ures = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
  });
  if (!ures.ok) return { ok: false, error: 'Invalid session', status: 401 };
  const user = await ures.json();
  if (!user?.email || !ADMIN_EMAILS.has(user.email.toLowerCase())) {
    return { ok: false, error: 'Forbidden', status: 403 };
  }
  return { ok: true, user };
}

// ── Supabase REST ────────────────────────────────────
function sbHdrs(serviceKey) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
}
async function sbGet(supabaseUrl, serviceKey, path) {
  const r = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers: sbHdrs(serviceKey) });
  if (!r.ok) throw new Error(`sb GET ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}
async function sbPatch(supabaseUrl, serviceKey, table, idCol, idVal, body) {
  const r = await fetch(`${supabaseUrl}/rest/v1/${table}?${idCol}=eq.${idVal}`, {
    method: 'PATCH',
    headers: { ...sbHdrs(serviceKey), Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`sb PATCH ${table}: ${r.status} ${await r.text()}`);
}
async function sbInsert(supabaseUrl, serviceKey, table, body) {
  const r = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...sbHdrs(serviceKey), Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`sb INSERT ${table}: ${r.status} ${await r.text()}`);
}

// ── Storage upload ───────────────────────────────────
async function uploadPhoto(supabaseUrl, serviceKey, citySlug, venueId, idx, bytes, contentType) {
  const path = `${citySlug || 'misc'}/${venueId}/${idx}.jpg`;
  const r = await fetch(`${supabaseUrl}/storage/v1/object/venue-photos/${path}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': contentType || 'image/jpeg',
      'x-upsert': 'true',
    },
    body: bytes,
  });
  if (!r.ok) throw new Error(`storage upload: ${r.status} ${await r.text()}`);
  return `${supabaseUrl}/storage/v1/object/public/venue-photos/${path}`;
}

// ── Google Places ────────────────────────────────────
async function findPlaceId(apiKey, venue) {
  const query = [venue.name, venue.address, venue.neighborhood, 'CA'].filter(Boolean).join(', ');
  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json` +
    `?input=${encodeURIComponent(query)}&inputtype=textquery&fields=place_id&key=${apiKey}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`find_place http ${r.status}`);
  const data = await r.json();
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`find_place: ${data.status} ${data.error_message || ''}`.trim());
  }
  return data.candidates?.[0]?.place_id || null;
}
async function getPlaceDetails(apiKey, placeId) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json` +
    `?place_id=${encodeURIComponent(placeId)}&fields=${PLACE_DETAIL_FIELDS}&key=${apiKey}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`details http ${r.status}`);
  const data = await r.json();
  if (data.status !== 'OK') throw new Error(`details: ${data.status} ${data.error_message || ''}`.trim());
  return data.result;
}
async function downloadPlacePhoto(apiKey, photoRef, maxwidth = 1200) {
  const url = `https://maps.googleapis.com/maps/api/place/photo` +
    `?maxwidth=${maxwidth}&photo_reference=${encodeURIComponent(photoRef)}&key=${apiKey}`;
  // The Photo endpoint redirects to a CDN — fetch follows by default in edge runtime.
  const r = await fetch(url);
  if (!r.ok) throw new Error(`photo http ${r.status}`);
  const ct = r.headers.get('content-type') || 'image/jpeg';
  const buf = await r.arrayBuffer();
  return { bytes: new Uint8Array(buf), contentType: ct };
}

// ── enrichment per venue ─────────────────────────────
async function enrichOne(env, venue, opts) {
  const { supabaseUrl, serviceKey, googleKey } = env;
  const dryRun = !!opts.dryRun;
  const fields = [];
  let costMicro = 0;
  let placeId = venue.place_id || null;

  // 1. Find place_id if missing
  if (!placeId) {
    placeId = await findPlaceId(googleKey, venue);
    costMicro += COST.find_place;
    if (!placeId) {
      return { status: 'no_match', fields, costMicro, photo_count: 0, place_id: null };
    }
  }

  // 2. Place Details
  const details = await getPlaceDetails(googleKey, placeId);
  costMicro += COST.details_pro;

  // 3. Build patch — only fill blanks (don't clobber editor's curated copy)
  const patch = {};
  if (!venue.place_id && details.place_id)               { patch.place_id = details.place_id; fields.push('place_id'); }
  if (!venue.phone && (details.formatted_phone_number || details.international_phone_number)) {
    patch.phone = details.formatted_phone_number || details.international_phone_number;
    fields.push('phone');
  }
  if (!venue.url && details.website)                     { patch.url = details.website; fields.push('url'); }
  if (venue.google_rating == null && details.rating)     { patch.google_rating = details.rating; fields.push('google_rating'); }
  if (venue.price_level == null && details.price_level != null) { patch.price_level = details.price_level; fields.push('price_level'); }
  if ((!venue.hours || venue.hours.trim() === '') && details.opening_hours?.weekday_text) {
    patch.hours = details.opening_hours.weekday_text.join('\n');
    fields.push('hours');
  }

  // 4. Photos — download + upload to Supabase Storage
  let photoUrls = [];
  const photoRefs = (details.photos || []).slice(0, MAX_PHOTOS);
  if (photoRefs.length && !venue.photo_url) {
    if (!dryRun) {
      for (let i = 0; i < photoRefs.length; i++) {
        try {
          const { bytes, contentType } = await downloadPlacePhoto(googleKey, photoRefs[i].photo_reference);
          costMicro += COST.photo;
          const publicUrl = await uploadPhoto(supabaseUrl, serviceKey, venue.city_slug, venue.id, i + 1, bytes, contentType);
          photoUrls.push(publicUrl);
        } catch (e) {
          // Skip failed photo, keep going
          console.warn(`[enrich] photo ${i} failed for ${venue.id}: ${e.message}`);
        }
      }
      if (photoUrls.length) {
        patch.photo_url  = photoUrls[0];
        patch.photo_urls = photoUrls;
        fields.push('photo_url', 'photo_urls');
      }
    } else {
      // dry-run: count what we would have downloaded but don't fetch
      costMicro += photoRefs.length * COST.photo;
      fields.push('photo_url(dry)');
    }
  }

  // 5. Apply patch — write place_id separately so a unique-constraint
  //    conflict on it can't roll back the rest (photo/phone/hours/etc.).
  let placeIdConflict = false;
  if (!dryRun && Object.keys(patch).length) {
    const { place_id: pendingPlaceId, ...rest } = patch;
    if (Object.keys(rest).length) {
      rest.updated_at = new Date().toISOString();
      await sbPatch(supabaseUrl, serviceKey, 'venues', 'id', venue.id, rest);
    }
    if (pendingPlaceId) {
      try {
        await sbPatch(supabaseUrl, serviceKey, 'venues', 'id', venue.id, { place_id: pendingPlaceId });
      } catch (e) {
        // Another venue already owns this place_id (unique constraint). Keep the
        // rest of the enrichment; just don't claim the duplicate place_id.
        if (/\b409\b|23505|duplicate key/.test(String(e.message))) {
          placeIdConflict = true;
          const i = fields.indexOf('place_id');
          if (i >= 0) fields.splice(i, 1);
          fields.push('place_id_conflict');
        } else {
          throw e;
        }
      }
    }
  }

  return {
    status: dryRun ? 'dry_run' : (placeIdConflict ? 'partial' : 'success'),
    fields, costMicro, place_id: placeId,
    photo_count: photoUrls.length,
  };
}

// ── handlers ─────────────────────────────────────────
async function handlePreview(env, params) {
  const { supabaseUrl, serviceKey } = env;
  const city = params.city;
  if (!city) return json({ error: 'Missing city' }, 400);

  // Total active + how many lack place_id (need full enrichment)
  const all  = await sbGet(supabaseUrl, serviceKey,
    `venues?city_slug=eq.${city}&active=eq.true&select=id&limit=1000`);
  const todo = await sbGet(supabaseUrl, serviceKey,
    `venues?city_slug=eq.${city}&active=eq.true&place_id=is.null&select=id&limit=1000`);
  const noPhoto = await sbGet(supabaseUrl, serviceKey,
    `venues?city_slug=eq.${city}&active=eq.true&photo_url=is.null&select=id&limit=1000`);

  // Cost estimate for the `todo` set: find_place + details + ~3 photos avg
  const perVenueMicro = COST.find_place + COST.details_pro + 3 * COST.photo;
  const estCostUsd = (todo.length * perVenueMicro) / 1_000_000;

  return json({
    city,
    total_active: all.length,
    needs_enrichment: todo.length,
    without_photo: noPhoto.length,
    estimated_cost_usd: Number(estCostUsd.toFixed(2)),
    cost_per_venue_usd: Number((perVenueMicro / 1_000_000).toFixed(4)),
  });
}

async function handleBatch(env, params) {
  const { supabaseUrl, serviceKey } = env;
  const city       = params.city;
  const batchSize  = Math.max(1, Math.min(10, Number(params.batch_size) || 5));
  const dryRun     = !!params.dry_run;
  const force      = !!params.force;

  if (!city) return json({ error: 'Missing city' }, 400);

  // Pick venues that need enrichment. By default: place_id IS NULL.
  // With force=true, also re-enrich venues missing photo_url.
  const filter = force
    ? `or=(place_id.is.null,photo_url.is.null)`
    : `place_id=is.null`;
  const venues = await sbGet(supabaseUrl, serviceKey,
    `venues?city_slug=eq.${city}&active=eq.true&${filter}` +
    `&select=id,name,address,neighborhood,city_slug,place_id,phone,url,hours,price_level,google_rating,photo_url` +
    `&order=name.asc&limit=${batchSize}`);

  if (!venues.length) {
    return json({ processed: 0, results: [], remaining: 0, done: true });
  }

  const results = [];
  let totalCost = 0;
  for (const v of venues) {
    const startedAt = new Date().toISOString();
    try {
      const out = await enrichOne(env, v, { dryRun });
      totalCost += out.costMicro;
      results.push({ venue_id: v.id, name: v.name, ...out });
      if (!dryRun) {
        await sbInsert(supabaseUrl, serviceKey, 'enrichment_runs', {
          venue_id: v.id, city_slug: v.city_slug, status: out.status,
          place_id: out.place_id, photo_count: out.photo_count,
          fields_filled: out.fields, cost_usd_micro: out.costMicro,
          started_at: startedAt, finished_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      results.push({ venue_id: v.id, name: v.name, status: 'failed', error: e.message });
      if (!dryRun) {
        await sbInsert(supabaseUrl, serviceKey, 'enrichment_runs', {
          venue_id: v.id, city_slug: v.city_slug, status: 'failed',
          error: e.message, started_at: startedAt, finished_at: new Date().toISOString(),
        }).catch(() => {});
      }
    }
  }

  // Remaining count for progress bar
  const remainingRows = await sbGet(supabaseUrl, serviceKey,
    `venues?city_slug=eq.${city}&active=eq.true&${filter}&select=id&limit=1000`);

  return json({
    processed: results.length,
    results,
    remaining: remainingRows.length,
    done: remainingRows.length === 0,
    total_cost_usd: Number((totalCost / 1_000_000).toFixed(4)),
  });
}

async function handleSingleVenue(env, params) {
  const { supabaseUrl, serviceKey } = env;
  const venueId = params.venue_id;
  if (!venueId) return json({ error: 'Missing venue_id' }, 400);

  const rows = await sbGet(supabaseUrl, serviceKey,
    `venues?id=eq.${venueId}&select=id,name,address,neighborhood,city_slug,place_id,phone,url,hours,price_level,google_rating,photo_url`);
  if (!rows.length) return json({ error: 'Venue not found' }, 404);
  const v = rows[0];

  const startedAt = new Date().toISOString();
  try {
    const out = await enrichOne(env, v, { dryRun: !!params.dry_run });
    if (!params.dry_run) {
      await sbInsert(supabaseUrl, serviceKey, 'enrichment_runs', {
        venue_id: v.id, city_slug: v.city_slug, status: out.status,
        place_id: out.place_id, photo_count: out.photo_count,
        fields_filled: out.fields, cost_usd_micro: out.costMicro,
        started_at: startedAt, finished_at: new Date().toISOString(),
      });
    }
    return json({ venue_id: v.id, name: v.name, ...out });
  } catch (e) {
    if (!params.dry_run) {
      await sbInsert(supabaseUrl, serviceKey, 'enrichment_runs', {
        venue_id: v.id, city_slug: v.city_slug, status: 'failed',
        error: e.message, started_at: startedAt, finished_at: new Date().toISOString(),
      }).catch(() => {});
    }
    return json({ venue_id: v.id, name: v.name, status: 'failed', error: e.message }, 500);
  }
}

// ── main ─────────────────────────────────────────────
export default async function handler(req) {
  if (req.method === 'OPTIONS') return corsPreflight();

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;
  const googleKey   = process.env.GOOGLE_PLACES_API_KEY;

  if (!supabaseUrl || !serviceKey) return json({ error: 'Missing Supabase env vars' }, 500);

  const auth = await requireAdmin(req, supabaseUrl, serviceKey);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const env = { supabaseUrl, serviceKey, googleKey };

  // Parse params from query (GET) or body (POST)
  let params = {};
  if (req.method === 'GET') {
    const u = new URL(req.url);
    params = Object.fromEntries(u.searchParams.entries());
  } else if (req.method === 'POST') {
    try { params = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  } else {
    return json({ error: 'Method not allowed' }, 405);
  }

  const action = params.action || (params.venue_id ? 'venue' : 'preview');

  // Preview is the only action that doesn't need GOOGLE_PLACES_API_KEY
  if (action !== 'preview' && !googleKey) {
    return json({ error: 'GOOGLE_PLACES_API_KEY env var not set in Vercel' }, 500);
  }

  try {
    if (action === 'preview') return await handlePreview(env, params);
    if (action === 'batch')   return await handleBatch(env, params);
    if (action === 'venue')   return await handleSingleVenue(env, params);
    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
}
