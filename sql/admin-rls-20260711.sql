-- Admin RLS policies (2026-07-11) — service_role key removal, part 1 of the
-- docs/audit-2026-07.md S1 remediation. Lets the admin portal (admin.html,
-- admin/board.html, admin-push-center.js) operate with the signed-in admin's
-- user JWT + RLS instead of a service_role key shipped to the browser.
-- `public.is_giveaway_admin()` = SECURITY DEFINER email allow-list (Shane).
-- Applied to production via Supabase MCP on 2026-07-11.

-- ── 1. Tighten over-broad policies discovered during remediation ──────────

-- board_cards: was open to ANY authenticated user.
drop policy if exists "Auth users can read board_cards"   on public.board_cards;
drop policy if exists "Auth users can insert board_cards" on public.board_cards;
drop policy if exists "Auth users can update board_cards" on public.board_cards;
drop policy if exists "Auth users can delete board_cards" on public.board_cards;

-- content_posts: was USING(true) for everyone (including anon).
drop policy if exists "Allow all for authenticated" on public.content_posts;

-- crm_*: the "Service role full access" policies were USING(true) FOR ALL to
-- public — i.e. the anon key had full CRM read/write. The service role never
-- needed a policy (it bypasses RLS), so these were pure exposure.
drop policy if exists "Service role full access on crm_contacts"   on public.crm_contacts;
drop policy if exists "Service role full access on crm_notes"      on public.crm_notes;
drop policy if exists "Service role full access on crm_activities" on public.crm_activities;

-- ── 2. Admin FOR ALL policies (additive — existing public/user policies stay) ──

create policy "Admins manage board_cards"        on public.board_cards        for all to authenticated using (public.is_giveaway_admin()) with check (public.is_giveaway_admin());
create policy "Admins manage content_posts"      on public.content_posts      for all to authenticated using (public.is_giveaway_admin()) with check (public.is_giveaway_admin());
create policy "Admins manage crm_contacts"       on public.crm_contacts       for all to authenticated using (public.is_giveaway_admin()) with check (public.is_giveaway_admin());
create policy "Admins manage crm_notes"          on public.crm_notes          for all to authenticated using (public.is_giveaway_admin()) with check (public.is_giveaway_admin());
create policy "Admins manage crm_activities"     on public.crm_activities     for all to authenticated using (public.is_giveaway_admin()) with check (public.is_giveaway_admin());
create policy "Admins manage push_campaigns"     on public.push_campaigns     for all to authenticated using (public.is_giveaway_admin()) with check (public.is_giveaway_admin());
create policy "Admins manage push_automations"   on public.push_automations   for all to authenticated using (public.is_giveaway_admin()) with check (public.is_giveaway_admin());
create policy "Admins manage push_automation_log" on public.push_automation_log for all to authenticated using (public.is_giveaway_admin()) with check (public.is_giveaway_admin());
create policy "Admins manage blog_posts"         on public.blog_posts         for all to authenticated using (public.is_giveaway_admin()) with check (public.is_giveaway_admin());
create policy "Admins manage site_copy"          on public.site_copy          for all to authenticated using (public.is_giveaway_admin()) with check (public.is_giveaway_admin());
create policy "Admins manage venues"             on public.venues             for all to authenticated using (public.is_giveaway_admin()) with check (public.is_giveaway_admin());
create policy "Admins manage events"             on public.events             for all to authenticated using (public.is_giveaway_admin()) with check (public.is_giveaway_admin());
create policy "Admins manage profiles"           on public.profiles           for all to authenticated using (public.is_giveaway_admin()) with check (public.is_giveaway_admin());
create policy "Admins manage reviews"            on public.reviews            for all to authenticated using (public.is_giveaway_admin()) with check (public.is_giveaway_admin());
create policy "Admins manage check_ins"          on public.check_ins          for all to authenticated using (public.is_giveaway_admin()) with check (public.is_giveaway_admin());
create policy "Admins manage checkin_photos"     on public.checkin_photos     for all to authenticated using (public.is_giveaway_admin()) with check (public.is_giveaway_admin());
create policy "Admins manage activity_feed"      on public.activity_feed      for all to authenticated using (public.is_giveaway_admin()) with check (public.is_giveaway_admin());
create policy "Admins manage feedback"           on public.feedback           for all to authenticated using (public.is_giveaway_admin()) with check (public.is_giveaway_admin());
create policy "Admins manage venue_requests"     on public.venue_requests     for all to authenticated using (public.is_giveaway_admin()) with check (public.is_giveaway_admin());
create policy "Admins manage venue_claims"       on public.venue_claims       for all to authenticated using (public.is_giveaway_admin()) with check (public.is_giveaway_admin());
create policy "Admins manage newsletter_subscribers" on public.newsletter_subscribers for all to authenticated using (public.is_giveaway_admin()) with check (public.is_giveaway_admin());
create policy "Admins manage cities"             on public.cities             for all to authenticated using (public.is_giveaway_admin()) with check (public.is_giveaway_admin());

-- Push Center audience queries only need reads on push_tokens.
create policy "Admins read push_tokens" on public.push_tokens for select to authenticated using (public.is_giveaway_admin());

-- ── 3. Storage: Content Calendar uploads to the spotd-content bucket ──────
create policy "Admins manage spotd-content" on storage.objects for all to authenticated
  using (bucket_id = 'spotd-content' and public.is_giveaway_admin())
  with check (bucket_id = 'spotd-content' and public.is_giveaway_admin());
