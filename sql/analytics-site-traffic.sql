-- analytics-site-traffic.sql
-- Extends analytics_events (sql/analytics-events.sql) into a site-wide, in-house
-- GA: capture every visitor on every page (SEO venue/city pages, /spots, blog,
-- marketing/legal) plus the app, with identity stitching, device + geo, and
-- traffic-report RPCs. Applied via MCP (apply_migration analytics_site_traffic).
--
-- Capture pieces (code, not SQL): js/site-analytics.js (public pages),
-- js/db.js captureEvent/analyticsPageView/analyticsIdentify (app), and
-- api/track-event.js (ingest: server geo from Vercel headers, bot filter,
-- and the visitor_id -> user_id backfill on the 'identify' event).

alter table public.analytics_events add column if not exists visitor_id text;  -- persistent anon id (localStorage 'spotd_vid'); stitches pre-signup journey to a user
alter table public.analytics_events add column if not exists device     text;  -- 'desktop' | 'mobile' | 'tablet' | 'unknown'
alter table public.analytics_events add column if not exists country    text;  -- ISO country from Vercel edge geo headers (server-injected; no IP stored)

create index if not exists idx_ae_visitor  on public.analytics_events (visitor_id, created_at desc);
create index if not exists idx_ae_pageview on public.analytics_events (created_at desc) where event_name = 'page_view';

-- host(url) helper for referrer/source grouping (strip scheme, leading www, path)
create or replace function public._ae_host(u text)
returns text language sql immutable as $$
  select case
    when u is null or u = '' then null
    else regexp_replace(regexp_replace(regexp_replace(u, '^https?://', ''), '^www\.', ''), '/.*$', '')
  end;
$$;

create or replace function public.ae_traffic_kpis(p_from timestamptz, p_to timestamptz)
returns json language sql stable security definer set search_path = public, pg_temp as $$
  select case when public.is_giveaway_admin() then (
    select json_build_object(
      'pageviews',       count(*) filter (where event_name = 'page_view'),
      'sessions',        count(distinct session_id),
      'visitors',        count(distinct visitor_id),
      'signed_in_users', count(distinct user_id) filter (where user_id is not null),
      'signups',         count(*) filter (where event_name in ('signup_completed','signup')),
      'total_events',    count(*)
    )
    from public.analytics_events
    where created_at >= p_from and created_at < p_to
  ) else null end;
$$;

create or replace function public.ae_traffic_timeseries(p_from timestamptz, p_to timestamptz, p_bucket text)
returns table(bucket timestamptz, pageviews bigint, sessions bigint, visitors bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select date_trunc(case when p_bucket = 'hour' then 'hour' else 'day' end, created_at) as bucket,
         count(*) filter (where event_name = 'page_view')::bigint as pageviews,
         count(distinct session_id)::bigint as sessions,
         count(distinct visitor_id)::bigint as visitors
  from public.analytics_events
  where public.is_giveaway_admin()
    and created_at >= p_from and created_at < p_to
  group by 1 order by 1;
$$;

-- One flexible breakdown over a chosen traffic dimension (page-views only).
create or replace function public.ae_traffic_breakdown(p_dim text, p_from timestamptz, p_to timestamptz, p_limit int)
returns table(value text, sessions bigint, pageviews bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    case p_dim
      when 'page'     then coalesce(nullif(path, ''), '(none)')
      when 'device'   then coalesce(nullif(device, ''), 'unknown')
      when 'country'  then coalesce(nullif(country, ''), 'unknown')
      when 'platform' then coalesce(nullif(platform, ''), 'unknown')
      when 'referrer' then coalesce(public._ae_host(props->>'referrer'), '(direct)')
      when 'source'   then coalesce(nullif(props->>'utm_source', ''), public._ae_host(props->>'referrer'), '(direct)')
      else '(none)'
    end as value,
    count(distinct session_id)::bigint as sessions,
    count(*)::bigint as pageviews
  from public.analytics_events
  where public.is_giveaway_admin()
    and event_name = 'page_view'
    and created_at >= p_from and created_at < p_to
  group by 1
  order by pageviews desc
  limit coalesce(p_limit, 15);
$$;

grant execute on function
  public.ae_traffic_kpis(timestamptz, timestamptz),
  public.ae_traffic_timeseries(timestamptz, timestamptz, text),
  public.ae_traffic_breakdown(text, timestamptz, timestamptz, int),
  public._ae_host(text)
  to anon, authenticated, service_role;
