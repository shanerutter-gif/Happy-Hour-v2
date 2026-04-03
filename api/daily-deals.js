export const config = { runtime: 'edge' };

// Daily Deals Newsletter — runs once per day via Vercel Cron.
// Picks 3 venues with deals, sends a `daily_deals` event to all Loops contacts.
// GET /api/daily-deals?key=<SERVICE_ROLE_KEY>

export default async function handler(req) {
  if (req.method !== 'GET') return jsonRes({ error: 'GET only' }, 405);

  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const loopsKey = process.env.LOOPS_API_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://opcskuzbdfrlnyhraysk.supabase.co';

  if (!svcKey || !loopsKey) return jsonRes({ error: 'Missing env vars' }, 500);

  // Auth: Vercel Cron secret or service key
  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`;
  if (!isVercelCron && key !== svcKey) return jsonRes({ error: 'Unauthorized' }, 401);

  const sbHeaders = {
    'apikey': svcKey,
    'Authorization': `Bearer ${svcKey}`,
  };

  try {
    // 1. Fetch all active venues that have deals
    const r = await fetch(
      `${supabaseUrl}/rest/v1/venues?select=id,name,neighborhood,city_slug,deals,hours_start,hours_end,days&active=eq.true&deals=not.is.null&limit=1000`,
      { headers: sbHeaders }
    );
    if (!r.ok) throw new Error('Failed to fetch venues');
    let venues = await r.json();

    // Filter to venues that actually have deals (non-empty array)
    venues = venues.filter(v => Array.isArray(v.deals) && v.deals.length > 0);
    if (venues.length < 3) return jsonRes({ error: 'Not enough venues with deals', count: venues.length }, 400);

    // 2. Pick 3 venues — rotate daily using day-of-year as offset
    const dayOfYear = getDayOfYear();
    const offset = (dayOfYear * 3) % venues.length;
    const picked = [];
    for (let i = 0; i < 3; i++) {
      picked.push(venues[(offset + i) % venues.length]);
    }

    // 3. Build event properties
    const props = {};
    picked.forEach((v, i) => {
      const n = i + 1;
      props[`venue${n}_name`] = v.name;
      props[`venue${n}_neighborhood`] = v.neighborhood || '';
      props[`venue${n}_city`] = formatCity(v.city_slug);
      props[`venue${n}_deal1`] = v.deals[0] || '';
      props[`venue${n}_deal2`] = v.deals[1] || '';
      props[`venue${n}_deal3`] = v.deals[2] || '';
      props[`venue${n}_hours`] = formatHours(v);
    });
    props['date_formatted'] = new Date().toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    });

    // 4. Fetch all Loops contacts and send event to each
    //    Use Loops list contacts endpoint, paginated
    const loopsHeaders = {
      'Authorization': `Bearer ${loopsKey}`,
      'Content-Type': 'application/json',
    };

    // Get contacts from Loops (paginated, up to 5000)
    let allContacts = [];
    let hasMore = true;
    let loopOffset = 0;
    while (hasMore && loopOffset < 5000) {
      const cr = await fetch(`https://app.loops.so/api/v1/contacts?limit=100&offset=${loopOffset}`, {
        headers: { 'Authorization': `Bearer ${loopsKey}` },
      });
      if (!cr.ok) break;
      const batch = await cr.json();
      if (!batch.length) break;
      allContacts = allContacts.concat(batch);
      loopOffset += batch.length;
      hasMore = batch.length === 100;
    }

    // 5. Send daily_deals event to each contact (with rate limiting)
    let sent = 0;
    let errors = 0;
    for (const contact of allContacts) {
      if (!contact.email) continue;
      try {
        const er = await fetch('https://app.loops.so/api/v1/events/send', {
          method: 'POST',
          headers: loopsHeaders,
          body: JSON.stringify({
            email: contact.email,
            eventName: 'daily_deals',
            ...props,
          }),
        });
        if (er.ok) sent++;
        else errors++;
      } catch { errors++; }

      // Loops rate limit: ~10 req/s — add small delay
      if (sent % 10 === 0) await sleep(1100);
    }

    return jsonRes({
      success: true,
      venues: picked.map(v => v.name),
      contactsFound: allContacts.length,
      sent,
      errors,
    });
  } catch (e) {
    console.error('[daily-deals] Error:', e.message);
    return jsonRes({ error: e.message }, 500);
  }
}

function getDayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now - start) / 86400000);
}

function formatCity(slug) {
  if (!slug) return '';
  return slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

function formatHours(v) {
  if (!v.hours_start && !v.hours_end) return '';
  const days = Array.isArray(v.days) ? v.days.join(', ') : '';
  const time = [v.hours_start, v.hours_end].filter(Boolean).join(' – ');
  return [days, time].filter(Boolean).join(' · ');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
