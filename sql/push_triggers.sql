-- ═══════════════════════════════════════════════════════
-- SPOTD — Push Notification Triggers & Cron Jobs
-- Run this in Supabase SQL Editor after enabling pg_net
-- ═══════════════════════════════════════════════════════

-- Required extensions
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ── 1. DATABASE TRIGGER: New venue added → notify all users ──
-- Fires when a venue is inserted with active=true, or when
-- an existing venue is activated (active changes to true)

create or replace function notify_new_venue()
returns trigger language plpgsql security definer as $$
declare
  push_url   text;
  push_key   text;
begin
  -- Only fire when a venue becomes active
  if NEW.active is not true then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and OLD.active = true then
    return NEW;  -- was already active, skip
  end if;

  push_url := current_setting('app.settings.site_url', true);
  push_key := current_setting('app.settings.push_api_key', true);

  -- Fall back to hardcoded values if custom settings aren't configured
  if push_url is null or push_url = '' then
    push_url := 'https://spotd.biz';
  end if;

  if push_key is not null and push_key != '' then
    perform net.http_post(
      url     := push_url || '/api/send-push',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || push_key,
        'Content-Type',  'application/json'
      ),
      body    := jsonb_build_object(
        'title', 'New spot just dropped!',
        'body',  NEW.name || ' in ' || coalesce(NEW.neighborhood, NEW.city_slug) || ' — check out their deals',
        'url',   '/',
        'tag',   'new-venue'
      )
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists on_venue_activated on public.venues;
create trigger on_venue_activated
  after insert or update of active on public.venues
  for each row execute function notify_new_venue();


-- ── 2. CRON JOB: Daily happy hour reminder at 4pm PT ──
-- Sends a broadcast push to all users every day at 4pm Pacific (11pm UTC)
-- Adjust the cron schedule for your timezone

-- Remove existing job if re-running
select cron.unschedule('happy-hour-reminder')
  where exists (select 1 from cron.job where jobname = 'happy-hour-reminder');

-- NOTE: Replace YOUR_SITE_URL and YOUR_PUSH_API_KEY before running
-- Or set them as Supabase custom config:
--   alter database postgres set app.settings.site_url = 'https://spotd.biz';
--   alter database postgres set app.settings.push_api_key = 'your-key-here';

select cron.schedule(
  'happy-hour-reminder',
  '0 23 * * *',  -- 11:00 PM UTC = 4:00 PM PT
  $$
  select net.http_post(
    url     := coalesce(current_setting('app.settings.site_url', true), 'https://spotd.biz') || '/api/send-push',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.push_api_key', true),
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object(
      'title', 'Happy hour is starting!',
      'body',  'Check out tonight''s best deals and events near you',
      'url',   '/',
      'tag',   'happy-hour-daily'
    )
  );
  $$
);


-- ── 3. HELPER: Set Supabase custom config ──
-- Run these to configure the triggers/cron above:
--
--   alter database postgres set app.settings.site_url = 'https://spotd.biz';
--   alter database postgres set app.settings.push_api_key = 'your-push-api-key-here';
--
-- Then reload config:
--   select pg_reload_conf();


-- ── 4. MANAGEMENT QUERIES ──
-- View all cron jobs:
--   select * from cron.job;
--
-- View recent cron runs:
--   select * from cron.job_run_details order by start_time desc limit 20;
--
-- Unschedule a job:
--   select cron.unschedule('happy-hour-reminder');
