-- Security hardening applied 2026-07-09 (via Supabase MCP) — remediates the
-- critical findings in docs/audit-2026-07.md. Recorded here for traceability;
-- already applied to production.

-- 1. approve_venue_claim was anon-executable with no admin check → anyone could
--    self-approve venue ownership. Nothing legitimate calls it (admin-claims.js
--    approves via direct service-role PATCH), so revoke + add an admin guard.
revoke execute on function public.approve_venue_claim(uuid) from anon, authenticated, public;

create or replace function public.approve_venue_claim(claim_id uuid)
returns void language plpgsql security definer set search_path = 'public', 'pg_temp' as $$
declare v_venue_id uuid; v_user_id uuid;
begin
  if not public.is_giveaway_admin() then
    raise exception 'Not authorized';
  end if;
  select venue_id, user_id into v_venue_id, v_user_id
  from public.venue_claims where id = claim_id and status = 'pending';
  if v_venue_id is null then raise exception 'Claim not found or already processed'; end if;
  update public.venue_claims set status='approved', reviewed_at=now() where id=claim_id;
  update public.venues set owner_id=v_user_id, owner_verified=true where id=v_venue_id;
end; $$;

-- 2. venues had "Authenticated users can update/insert venues" USING/CHECK(true)
--    → any logged-in user could rewrite any venue. Drop them; owner-scoped
--    policies ("Owners can update their venues") + service-role admin remain.
drop policy if exists "Authenticated users can update venues" on public.venues;
drop policy if exists "Authenticated users can insert venues" on public.venues;

-- 3. events had the same USING(true) authenticated write policies. Replace with
--    owner-scoped ones matching on venue_name -> owning verified venue, so the
--    business portal's event editor still works (admin uses service role).
drop policy if exists "Authenticated users can insert events" on public.events;
drop policy if exists "Authenticated users can update events" on public.events;
drop policy if exists "Authenticated users can delete events" on public.events;

create policy "Owners insert events for their venue" on public.events for insert to authenticated
  with check (exists (select 1 from public.venues v where v.name = events.venue_name and v.owner_id = auth.uid() and v.owner_verified = true));
create policy "Owners update events for their venue" on public.events for update to authenticated
  using (exists (select 1 from public.venues v where v.name = events.venue_name and v.owner_id = auth.uid() and v.owner_verified = true));
create policy "Owners delete events for their venue" on public.events for delete to authenticated
  using (exists (select 1 from public.venues v where v.name = events.venue_name and v.owner_id = auth.uid() and v.owner_verified = true));

-- 4. Enable RLS on 8 tables that were fully exposed to the anon key.
alter table public.conversations enable row level security;         -- policies already existed (conv_select/insert/update)

alter table public.newsletter_subscribers enable row level security; -- preserve anon blog-signup inserts
drop policy if exists "Anyone can subscribe" on public.newsletter_subscribers;
create policy "Anyone can subscribe" on public.newsletter_subscribers for insert to anon, authenticated with check (true);

-- Written only by admin/cron/enrichment; never read by the anon app. RLS on +
-- no policies = service-role only.
alter table public.social_posts enable row level security;
alter table public.social_post_features enable row level security;
alter table public.venue_nightly_runs enable row level security;
alter table public.venues_hours_backup_20260609 enable row level security;
alter table public.hours_research_20260609 enable row level security;
alter table public.venues_deactivated_20260610 enable row level security;
