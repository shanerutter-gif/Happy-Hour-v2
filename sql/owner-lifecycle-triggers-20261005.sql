-- Business-owner lifecycle triggers bookkeeping.
-- Run ONCE in the Supabase SQL editor (Shane applies migrations manually).
-- NOT applied by automation; safe to re-run (all idempotent).
--
-- Supports:
--   1. venue_claim.approved  — fired from admin-claims.js approve(); needs approved_at.
--   2. venue.listing_updated — fired from business-portal.html proposeVenueEdit();
--      stamps venues.owner_last_update_at (relies on the existing owner-scoped
--      "Owners can update their venues" policy from security-hardening-20260709.sql;
--      the stamp is best-effort — the cron also falls back to venue_edit_proposals).
--   3. /api/loops-owner-inactive cron — owner.inactive_7d / owner.inactive_30d;
--      stamps owner_reengaged_7d_at / owner_reengaged_30d_at so each owner gets
--      each nudge at most once.

-- ── venue_claims: approval timestamp + nudge dedup stamps ──
alter table public.venue_claims
  add column if not exists approved_at            timestamptz,
  add column if not exists owner_reengaged_7d_at  timestamptz,
  add column if not exists owner_reengaged_30d_at timestamptz;

-- Backfill: claims already approved before this column existed inherit reviewed_at.
update public.venue_claims
   set approved_at = coalesce(approved_at, reviewed_at, created_at)
 where status = 'approved'
   and approved_at is null;

-- ── venues: last time the approved owner saved an edit ──
alter table public.venues
  add column if not exists owner_last_update_at timestamptz;

-- Helpful index for the cron's approved-claims scan.
create index if not exists idx_venue_claims_status_approved
  on public.venue_claims (status)
  where status = 'approved';
