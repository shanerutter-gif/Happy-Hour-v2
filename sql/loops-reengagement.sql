-- Loops re-engagement bookkeeping for /api/loops-inactive.
-- Tracks when each profile was last sent an inactive_7d / inactive_30d event so
-- the cron sends to "older than Nd AND not already re-engaged" instead of a
-- brittle exact-day band, and never double-emails the same cohort.

alter table public.profiles
  add column if not exists reengaged_7d_at  timestamptz,
  add column if not exists reengaged_30d_at timestamptz;

-- One-time backfill: any profile that never recorded a last_seen inherits its
-- created_at, so the inactivity window (coalesce(last_seen, created_at)) is
-- accurate even before the client heartbeat lands.
update public.profiles
   set last_seen = coalesce(last_seen, created_at)
 where last_seen is null;
