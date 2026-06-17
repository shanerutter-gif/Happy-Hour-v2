-- analytics-surface.sql
-- Separate website vs app traffic in the Site Traffic dashboard. Applied via MCP
-- (apply_migration analytics_surface_segment). Adds a captured `surface` tag
-- ('app' from js/db.js, 'site' from js/site-analytics.js), a fallback derivation
-- for rows captured before the tag existed, and a p_surface filter on the
-- ae_traffic_* RPCs (default 'all'; the dashboard defaults the view to 'site').

alter table public.analytics_events add column if not exists surface text;  -- 'app' | 'site'

-- Effective surface: prefer the captured tag; else derive (ios_app, or the SPA
-- shell at path '/' = app; any real page path = site).
create or replace function public._ae_surface(p_surface text, p_platform text, p_path text)
returns text language sql immutable as $$
  select coalesce(
    nullif(p_surface, ''),
    case when p_platform = 'ios_app' then 'app'
         when p_path is null or p_path = '' or p_path = '/' then 'app'
         else 'site' end
  );
$$;

drop function if exists public.ae_traffic_kpis(timestamptz, timestamptz);
create function public.ae_traffic_kpis(p_from timestamptz, p_to timestamptz, p_surface text default 'all')
returns json language sql stable security definer set search_path = public, pg_temp as $$
  select case when public.is_giveaway_admin() then (
    select json_build_object(
      'pageviews',       count(*) filter (where event_name = 'page_view'),
      'sessions',        count(distinct session_id),
      'visitors',        count(distinct visitor_id),
      'signed_in_users', count(distinct user_id) filter (where user_id is not null),
      -- signups = visitors in this surface who (via stitched visitor_id) have a
      -- signup event — i.e. real "(surface) visitor → signup" conversions.
      'signups',         count(distinct visitor_id) filter (where visitor_id in (
                            select visitor_id from public.analytics_events
                            where event_name in ('signup_completed','signup') and visitor_id is not null)),
      'total_events',    count(*)
    )
    from public.analytics_events
    where created_at >= p_from and created_at < p_to
      and (p_surface = 'all' or public._ae_surface(surface, platform, path) = p_surface)
  ) else null end;
$$;

drop function if exists public.ae_traffic_timeseries(timestamptz, timestamptz, text);
create function public.ae_traffic_timeseries(p_from timestamptz, p_to timestamptz, p_bucket text, p_surface text default 'all')
returns table(bucket timestamptz, pageviews bigint, sessions bigint, visitors bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select date_trunc(case when p_bucket = 'hour' then 'hour' else 'day' end, created_at) as bucket,
         count(*) filter (where event_name = 'page_view')::bigint as pageviews,
         count(distinct session_id)::bigint as sessions,
         count(distinct visitor_id)::bigint as visitors
  from public.analytics_events
  where public.is_giveaway_admin()
    and created_at >= p_from and created_at < p_to
    and (p_surface = 'all' or public._ae_surface(surface, platform, path) = p_surface)
  group by 1 order by 1;
$$;

drop function if exists public.ae_traffic_breakdown(text, timestamptz, timestamptz, int);
create function public.ae_traffic_breakdown(p_dim text, p_from timestamptz, p_to timestamptz, p_limit int, p_surface text default 'all')
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
    and (p_surface = 'all' or public._ae_surface(surface, platform, path) = p_surface)
  group by 1 order by pageviews desc
  limit coalesce(p_limit, 15);
$$;

grant execute on function
  public.ae_traffic_kpis(timestamptz, timestamptz, text),
  public.ae_traffic_timeseries(timestamptz, timestamptz, text, text),
  public.ae_traffic_breakdown(text, timestamptz, timestamptz, int, text),
  public._ae_surface(text, text, text)
  to anon, authenticated, service_role;
