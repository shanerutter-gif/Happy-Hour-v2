-- Composer: free-text venue tagging (venue not yet on Spotd)
-- Applied to prod via Supabase MCP 2026-07-16 (migration composer_custom_venue).

-- 1. Posts can carry a custom venue name (no venues FK — it's just a label
--    until the venue is reviewed and added via the admin Review Queue).
alter table public.checkin_photos add column if not exists custom_venue text;

-- 2. Every new venue_requests row pushes a notification to the admin so
--    requests (including composer auto-submissions) surface immediately.
--    Rides the existing send_push_to_user() (SECURITY DEFINER, vault key,
--    www host — see sql/push_inapp_notifications.sql).
create or replace function public.notify_admin_venue_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid;
begin
  select id into v_admin from auth.users where email = 'shanerutter@gmail.com' limit 1;
  if v_admin is not null then
    perform public.send_push_to_user(
      v_admin,
      'New venue request',
      coalesce(new.venue_name, 'A venue')
        || case when new.city_slug is not null then ' · ' || new.city_slug else '' end
        || case when new.reason is not null then ' — ' || left(new.reason, 90) else '' end,
      '/',
      'venue-request'
    );
  end if;
  return new;
exception when others then
  -- Never block the insert on a notification failure
  return new;
end;
$$;

drop trigger if exists trg_notify_admin_venue_request on public.venue_requests;
create trigger trg_notify_admin_venue_request
  after insert on public.venue_requests
  for each row execute function public.notify_admin_venue_request();
