-- Business-owner onboarding nudge dedup stamps.
-- Run ONCE in the Supabase SQL editor. NOT applied by automation; safe to
-- re-run (all idempotent).
--
-- Supports the owner.nudge_3d / owner.nudge_10d events fired by
-- /api/loops-owner-inactive: each nudge is sent at most once per claim, and
-- only when the owner has not touched their listing since approval (the guard
-- Loops cannot express natively, evaluated in the cron instead).

alter table public.venue_claims
  add column if not exists owner_nudged_3d_at  timestamptz,
  add column if not exists owner_nudged_10d_at timestamptz;
