// supabase/functions/pick-giveaway-winner/index.ts
//
// Picks a random row from giveaway_entries for the previous ISO week
// (Mon 00:00 PT → Sun 23:59 PT). Each row = 1 ticket, so users with
// referral bonuses have proportionally better odds.
//
// Idempotent: refuses to pick twice for the same week_start.
//
// Deploy via Supabase Dashboard → Edge Functions, with these env vars:
//   SUPABASE_URL                (auto-provided)
//   SUPABASE_SERVICE_ROLE_KEY   (auto-provided)
//   LOOPS_API_KEY               (required for emails)
//   LOOPS_WINNER_TX_ID          (required: winner email transactional ID)
//   LOOPS_ADMIN_TX_ID           (required: admin notification transactional ID)
//   GIVEAWAY_ADMIN_EMAIL        (optional, defaults to shanerutter@gmail.com)
//
// Cron: hit POST https://<project>.supabase.co/functions/v1/pick-giveaway-winner
// every Monday 9:00 AM America/Los_Angeles via cron-job.org.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOOPS_API_KEY             = Deno.env.get('LOOPS_API_KEY') || '';
const LOOPS_WINNER_TX_ID        = Deno.env.get('LOOPS_WINNER_TX_ID') || '';
const LOOPS_ADMIN_TX_ID         = Deno.env.get('LOOPS_ADMIN_TX_ID') || '';
const ADMIN_EMAIL               = Deno.env.get('GIVEAWAY_ADMIN_EMAIL') || 'shanerutter@gmail.com';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Compute LAST week's Monday in PT (this week start - 7 days)
  const { data: thisWeekStart, error: wsErr } = await sb.rpc('current_week_start_pt');
  if (wsErr || !thisWeekStart) {
    return json({ ok: false, error: wsErr?.message || 'Could not compute week start' }, 500);
  }
  const lastWeekDate = new Date(`${thisWeekStart}T00:00:00Z`);
  lastWeekDate.setUTCDate(lastWeekDate.getUTCDate() - 7);
  const weekStartISO = lastWeekDate.toISOString().slice(0, 10);

  // Idempotency: refuse to pick twice for the same week
  const { data: existing } = await sb
    .from('giveaway_winners')
    .select('week_start, winner_user_id')
    .eq('week_start', weekStartISO)
    .maybeSingle();

  if (existing) {
    return json({
      ok: false,
      message: `Winner already picked for ${weekStartISO}`,
      week_start: weekStartISO,
      winner_user_id: existing.winner_user_id,
    });
  }

  // Pull all entries for last week
  const { data: entries, error: entriesErr } = await sb
    .from('giveaway_entries')
    .select('user_id, entry_type')
    .eq('week_start', weekStartISO);

  if (entriesErr) return json({ ok: false, error: entriesErr.message }, 500);

  if (!entries || entries.length === 0) {
    return json({ ok: false, message: `No entries for ${weekStartISO}` });
  }

  // Pick a random row — each row is one ticket
  const winnerEntry      = entries[Math.floor(Math.random() * entries.length)];
  const winnerEntryCount = entries.filter((e) => e.user_id === winnerEntry.user_id).length;

  // Look up the winner's profile
  const { data: winnerProfile } = await sb
    .from('profiles')
    .select('id, display_name')
    .eq('id', winnerEntry.user_id)
    .maybeSingle();

  if (!winnerProfile) {
    return json({ ok: false, error: 'Winner profile not found' }, 500);
  }

  // Look up the winner's email from auth.users (service role)
  let winnerEmail: string | null = null;
  try {
    const { data: au } = await sb.auth.admin.getUserById(winnerProfile.id);
    winnerEmail = au?.user?.email ?? null;
  } catch (_e) {
    winnerEmail = null;
  }

  // Insert the winner row
  const { error: insertErr } = await sb
    .from('giveaway_winners')
    .insert({
      week_start:         weekStartISO,
      winner_user_id:     winnerProfile.id,
      total_entries:      entries.length,
      winner_entry_count: winnerEntryCount,
      prize_status:       'pending',
    });

  if (insertErr) return json({ ok: false, error: insertErr.message }, 500);

  // Best-effort emails via Loops (don't fail the function on email errors)
  const sendLoops = async (txId: string, to: string, dataVariables: Record<string, unknown>) => {
    if (!LOOPS_API_KEY || !txId || !to) return;
    try {
      await fetch('https://app.loops.so/api/v1/transactional', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${LOOPS_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ transactionalId: txId, email: to, dataVariables }),
      });
    } catch (e) {
      console.error('Loops send failed', e);
    }
  };

  if (winnerEmail) {
    await sendLoops(LOOPS_WINNER_TX_ID, winnerEmail, {
      first_name:  winnerProfile.display_name || 'there',
      week_start:  weekStartISO,
      entry_count: winnerEntryCount,
      total_pool:  entries.length,
    });
  }

  await sendLoops(LOOPS_ADMIN_TX_ID, ADMIN_EMAIL, {
    winner_name:  winnerProfile.display_name || winnerEmail || winnerProfile.id,
    winner_email: winnerEmail || '(unknown)',
    entry_count:  winnerEntryCount,
    total_pool:   entries.length,
    week_start:   weekStartISO,
  });

  return json({
    ok:                  true,
    week_start:          weekStartISO,
    winner_email:        winnerEmail,
    winner_user_id:      winnerProfile.id,
    winner_entry_count:  winnerEntryCount,
    total_pool:          entries.length,
  });
});
