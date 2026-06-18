-- venue_reminder_log — suppression ledger for the "still thinking about <venue>?"
-- behavioral re-engagement email (api/venue-interest-reminder.js).
--
-- One row per email actually sent. Used to enforce:
--   * at most one reminder per user per day, and
--   * never the same venue twice within 7 days.
-- Service-role only (RLS enabled, NO policies) — mirrors push_campaigns. The
-- cron writes/reads with the service key, bypassing RLS.

create table if not exists public.venue_reminder_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  venue_id    text not null,            -- venue uuid as stored in analytics props.item_id
  venue_name  text,
  sent_at     timestamptz not null default now()
);

create index if not exists venue_reminder_log_user_sent_idx
  on public.venue_reminder_log (user_id, sent_at desc);
create index if not exists venue_reminder_log_user_venue_idx
  on public.venue_reminder_log (user_id, venue_id);

alter table public.venue_reminder_log enable row level security;
-- No policies: only the service role (cron) touches this table.
