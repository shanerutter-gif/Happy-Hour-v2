-- ── venue_requests: separate user venue requests from business add-venue requests ──
-- Run in the Supabase SQL editor (safe to re-run: IF NOT EXISTS / DROP IF EXISTS).
--
-- Background: venue_requests receives rows from three origins with no discriminator:
--   user_form       – in-app "Request Venue" form            (js/app.js submitVenueRequest)
--   composer        – auto-filed when a user tags a custom venue in a post (js/app.js)
--   business_portal – business.html "add venue" form        (business-portal.html)
-- Ownership claims live in the separate venue_claims table and are untouched here.
--
-- After this runs, the admin portal filters each surface to its own source:
--   Revenue Funnel "All Business Requests" -> source = 'business_portal'
--   Venue Requests review queue            -> source IN ('user_form','composer')

-- 1. Column. Existing rows default to 'user_form'; step 3 fixes composer rows.
alter table public.venue_requests
  add column if not exists source text not null default 'user_form';

-- 2. Allowed values.
alter table public.venue_requests drop constraint if exists venue_requests_source_check;
alter table public.venue_requests
  add constraint venue_requests_source_check
  check (source in ('user_form', 'composer', 'business_portal'));

-- 3. Backfill: composer rows carry a distinctive reason. All other historical rows
--    predate the business-portal add-venue form (added Sep 2026), so they are
--    user requests (confirmed: the 11 known rows are Shane's/friends').
update public.venue_requests
  set source = 'composer'
  where reason = 'Tagged in a post (auto-submitted from the composer)';

comment on column public.venue_requests.source is
  'Origin of the request: user_form | composer | business_portal. Ownership claims live in venue_claims.';
