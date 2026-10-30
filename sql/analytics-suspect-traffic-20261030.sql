-- Analytics: exclude suspected automated traffic from every dashboard query
-- (2026-10-30 audit). Applied via Supabase MCP.
--
-- Since 2026-10-13 a headless-browser fleet (rotating IPs, mostly SG/CN/HK but
-- spread worldwide) has rendered our pages and fired the cookieless anonymous
-- page_view ping — ~63% of all page_views in the 45 days to 2026-10-28. Its
-- UAs are ordinary desktop Chrome, so the UA-based bot filters never caught
-- it. Signature: signed-out, desktop, outside our markets (US) and the UK, no
-- referrer and no UTM — one view per visitor. A second, smaller signature is
-- QA/test harnesses (Linux desktop Chrome reloading the app from our own
-- domain). Both are classified here, at query time, so the filter applies
-- retroactively and raw rows stay intact for inspection.
--
-- Dashboards (ae_kpis/ae_timeseries/ae_top_events/ae_breakdown,
-- ae_traffic_*, ae_recent_journeys) and the analytics_daily rollup exclude
-- suspect rows; the Bot-vs-Human panel (ae_bot_*) counts them as bots under
-- the name "Suspected automation".

create or replace function public._ae_suspect(p_user uuid, p_device text, p_country text, p_props jsonb, p_ua text)
returns boolean language sql immutable as $$
  select p_user is null and (
    (coalesce(p_device, '') = 'desktop'
      and coalesce(p_country, '') not in ('', 'US', 'GB')
      and nullif(p_props->>'referrer', '') is null
      and nullif(p_props->>'utm_source', '') is null)
    or (coalesce(p_ua, '') ~ 'X11; Linux x86_64'
      and coalesce(p_props->>'referrer', '') ~* '^https?://(www\.)?spotd\.biz')
  );
$$;

-- Bot bucket that also knows about suspected automation.
create or replace function public._ae_traffic_bucket(p_user uuid, p_device text, p_country text, p_props jsonb, p_ua text)
returns text language sql immutable as $$
  select case
    when public._ae_bot_bucket(p_ua) = 'human' and public._ae_suspect(p_user, p_device, p_country, p_props, p_ua) then 'bot'
    else public._ae_bot_bucket(p_ua)
  end;
$$;

create or replace function public._ae_traffic_bot_name(p_user uuid, p_device text, p_country text, p_props jsonb, p_ua text)
returns text language sql immutable as $$
  select case
    when public._ae_bot_bucket(p_ua) = 'human' and public._ae_suspect(p_user, p_device, p_country, p_props, p_ua)
      then 'Suspected automation (headless browser)'
    else public._ae_bot_name(p_ua)
  end;
$$;

-- ── App Users mode ──
create or replace function public.ae_kpis(p_from timestamptz, p_to timestamptz)
returns json language sql stable security definer set search_path = public, pg_temp as $$
  select case when public.is_giveaway_admin() then (
    select json_build_object(
      'total_events',     count(*),
      'unique_users',     count(distinct user_id) filter (where user_id is not null),
      'guest_events',     count(*) filter (where user_id is null),
      'signed_in_events', count(*) filter (where user_id is not null),
      'sessions',         count(distinct session_id),
      'event_types',      count(distinct event_name)
    )
    from public.analytics_events
    where created_at >= p_from and created_at < p_to
      and event_name <> 'bot_hit'
      and not public._ae_suspect(user_id, device, country, props, user_agent)
  ) else null end;
$$;

create or replace function public.ae_timeseries(p_from timestamptz, p_to timestamptz, p_bucket text)
returns table(bucket timestamptz, events bigint, users bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select date_trunc(case when p_bucket = 'hour' then 'hour' else 'day' end, created_at) as bucket,
         count(*)::bigint as events,
         count(distinct user_id) filter (where user_id is not null)::bigint as users
  from public.analytics_events
  where public.is_giveaway_admin()
    and created_at >= p_from and created_at < p_to
    and event_name <> 'bot_hit'
    and not public._ae_suspect(user_id, device, country, props, user_agent)
  group by 1 order by 1;
$$;

create or replace function public.ae_top_events(p_from timestamptz, p_to timestamptz, p_limit integer)
returns table(event_name text, events bigint, users bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select event_name,
         count(*)::bigint as events,
         count(distinct user_id) filter (where user_id is not null)::bigint as users
  from public.analytics_events
  where public.is_giveaway_admin()
    and created_at >= p_from and created_at < p_to
    and event_name <> 'bot_hit'
    and not public._ae_suspect(user_id, device, country, props, user_agent)
  group by event_name
  order by events desc
  limit coalesce(p_limit, 20);
$$;

create or replace function public.ae_breakdown(p_event text, p_prop text, p_from timestamptz, p_to timestamptz, p_limit integer)
returns table(value text, events bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(props->>p_prop, ''), '(none)') as value,
         count(*)::bigint as events
  from public.analytics_events
  where public.is_giveaway_admin()
    and (p_event is null or event_name = p_event)
    and created_at >= p_from and created_at < p_to
    and event_name <> 'bot_hit'
    and not public._ae_suspect(user_id, device, country, props, user_agent)
  group by 1
  order by events desc
  limit coalesce(p_limit, 15);
$$;

-- ── Site Traffic mode ──
create or replace function public.ae_traffic_kpis(p_from timestamptz, p_to timestamptz, p_surface text default 'all')
returns json language sql stable security definer set search_path = public, pg_temp as $$
  select case when public.is_giveaway_admin() then (
    select json_build_object(
      'pageviews',       count(*) filter (where event_name = 'page_view'),
      'sessions',        count(distinct session_id),
      'visitors',        count(distinct visitor_id),
      'signed_in_users', count(distinct user_id) filter (where user_id is not null),
      'signups',         count(distinct visitor_id) filter (where visitor_id in (
                            select visitor_id from public.analytics_events
                            where event_name in ('signup_completed','signup') and visitor_id is not null)),
      'total_events',    count(*)
    )
    from public.analytics_events
    where created_at >= p_from and created_at < p_to
      and event_name <> 'bot_hit'
      and not public._ae_suspect(user_id, device, country, props, user_agent)
      and (p_surface = 'all' or public._ae_surface(surface, platform, path) = p_surface)
  ) else null end;
$$;

create or replace function public.ae_traffic_timeseries(p_from timestamptz, p_to timestamptz, p_bucket text, p_surface text default 'all')
returns table(bucket timestamptz, pageviews bigint, sessions bigint, visitors bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select date_trunc(case when p_bucket = 'hour' then 'hour' else 'day' end, created_at) as bucket,
         count(*) filter (where event_name = 'page_view')::bigint as pageviews,
         count(distinct session_id)::bigint as sessions,
         count(distinct visitor_id)::bigint as visitors
  from public.analytics_events
  where public.is_giveaway_admin()
    and created_at >= p_from and created_at < p_to
    and event_name <> 'bot_hit'
    and not public._ae_suspect(user_id, device, country, props, user_agent)
    and (p_surface = 'all' or public._ae_surface(surface, platform, path) = p_surface)
  group by 1 order by 1;
$$;

create or replace function public.ae_traffic_breakdown(p_dim text, p_from timestamptz, p_to timestamptz, p_limit integer, p_surface text default 'all')
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
    and not public._ae_suspect(user_id, device, country, props, user_agent)
    and (p_surface = 'all' or public._ae_surface(surface, platform, path) = p_surface)
  group by 1
  order by pageviews desc
  limit coalesce(p_limit, 15);
$$;

create or replace function public.ae_recent_journeys(p_from timestamptz, p_to timestamptz, p_surface text default 'site', p_limit integer default 50)
returns table(session_id text, visitor_id text, user_id uuid, display_name text, started_at timestamptz, ended_at timestamptz, pageviews bigint, events bigint, entry_path text, exit_path text, source text, referrer text, device text, country text, outbound_clicks bigint, signed_up boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  with sess as (
    select
      e.session_id,
      max(e.visitor_id) as visitor_id,
      (array_agg(e.user_id order by e.created_at) filter (where e.user_id is not null))[1] as user_id,
      min(e.created_at) as started_at,
      max(e.created_at) as ended_at,
      count(*) filter (where e.event_name = 'page_view')       as pageviews,
      count(*)                                                  as events,
      (array_agg(e.path order by e.created_at)      filter (where e.event_name = 'page_view' and nullif(e.path,'') is not null))[1] as entry_path,
      (array_agg(e.path order by e.created_at desc) filter (where e.event_name = 'page_view' and nullif(e.path,'') is not null))[1] as exit_path,
      coalesce(
        (array_agg(nullif(e.props->>'utm_source','') order by e.created_at)
           filter (where nullif(e.props->>'utm_source','') is not null))[1],
        (array_agg(public._ae_host(e.props->>'referrer') order by e.created_at)
           filter (where public._ae_host(e.props->>'referrer') is not null
                     and public._ae_host(e.props->>'referrer') not like '%spotd.biz'))[1],
        '(direct)') as source,
      (array_agg(e.props->>'referrer' order by e.created_at)
         filter (where nullif(e.props->>'referrer','') is not null))[1] as referrer,
      max(e.device)  as device,
      max(e.country) as country,
      count(*) filter (where e.event_name = 'outbound_click') as outbound_clicks
    from public.analytics_events e
    where public.is_giveaway_admin()
      and e.created_at >= p_from and e.created_at < p_to
      and e.session_id is not null
      and e.event_name <> 'bot_hit'
      and not public._ae_suspect(e.user_id, e.device, e.country, e.props, e.user_agent)
      and (p_surface = 'all' or public._ae_surface(e.surface, e.platform, e.path) = p_surface)
    group by e.session_id
    having count(*) filter (where e.event_name = 'page_view') > 0
  )
  select s.session_id, s.visitor_id, s.user_id, p.display_name,
         s.started_at, s.ended_at, s.pageviews, s.events,
         s.entry_path, s.exit_path, s.source, s.referrer, s.device, s.country,
         s.outbound_clicks,
         (s.user_id is not null or (s.visitor_id is not null and exists (
            select 1 from public.analytics_events x
            where x.visitor_id = s.visitor_id
              and x.event_name in ('signup', 'signup_completed', 'login_completed')))) as signed_up
  from sess s
  left join public.profiles p on p.id = s.user_id
  order by s.started_at desc
  limit coalesce(p_limit, 50);
$$;

-- ── Bot-vs-Human panel: suspected automation counts as 'bot' ──
create or replace function public.ae_bot_kpis(p_from timestamptz, p_to timestamptz, p_surface text default 'all')
returns json language sql stable security definer set search_path = public, pg_temp as $$
  select case when public.is_giveaway_admin() then (
    select json_build_object(
      'total_pageviews',   count(*) filter (where b.bucket is not null),
      'human_pageviews',   count(*) filter (where b.bucket = 'human'),
      'bot_pageviews',     count(*) filter (where b.bucket = 'bot'),
      'blocked_pageviews', count(*) filter (where b.bucket = 'blocked'),
      'unknown_pageviews', count(*) filter (where b.bucket = 'unknown'),
      'human_sessions',    count(distinct session_id) filter (where b.bucket = 'human'),
      'human_visitors',    count(distinct visitor_id) filter (where b.bucket = 'human'),
      'human_share',       case when count(*) = 0 then null
                                else round(100.0 * count(*) filter (where b.bucket = 'human') / count(*), 1) end)
    from (
      select public._ae_traffic_bucket(user_id, device, country, props, user_agent) as bucket, session_id, visitor_id
      from public.analytics_events
      where created_at >= p_from and created_at < p_to
        and event_name in ('page_view', 'bot_hit')
        and (p_surface = 'all' or public._ae_surface(surface, platform, path) = p_surface)
    ) b
  ) else null end;
$$;

create or replace function public.ae_bot_timeseries(p_from timestamptz, p_to timestamptz, p_bucket text, p_surface text default 'all')
returns table(bucket timestamptz, human bigint, bots bigint, blocked bigint, unknown bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select date_trunc(case when p_bucket = 'hour' then 'hour' else 'day' end, created_at) as bucket,
         count(*) filter (where b = 'human')::bigint,
         count(*) filter (where b = 'bot')::bigint,
         count(*) filter (where b = 'blocked')::bigint,
         count(*) filter (where b = 'unknown')::bigint
  from (
    select created_at, public._ae_traffic_bucket(user_id, device, country, props, user_agent) as b
    from public.analytics_events
    where public.is_giveaway_admin()
      and created_at >= p_from and created_at < p_to
      and event_name in ('page_view', 'bot_hit')
      and (p_surface = 'all' or public._ae_surface(surface, platform, path) = p_surface)
  ) t
  group by 1 order by 1;
$$;

create or replace function public.ae_bot_breakdown(p_dim text, p_from timestamptz, p_to timestamptz, p_limit integer, p_surface text default 'all')
returns table(value text, bucket text, pageviews bigint, sessions bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select v.value, v.bucket, count(*)::bigint as pageviews, count(distinct v.session_id)::bigint as sessions
  from (
    select
      case when p_dim = 'bot_name' then public._ae_traffic_bot_name(user_id, device, country, props, user_agent)
           when p_dim = 'blocked_pattern' then public._ae_blocked_pattern(user_agent)
           when p_dim = 'country' then coalesce(nullif(country, ''), 'unknown')
           else '(none)' end as value,
      case when p_dim = 'country' then 'nonhuman'
           else public._ae_traffic_bucket(user_id, device, country, props, user_agent) end as bucket,
      session_id,
      public._ae_traffic_bucket(user_id, device, country, props, user_agent) as tb
    from public.analytics_events
    where public.is_giveaway_admin()
      and created_at >= p_from and created_at < p_to
      and event_name in ('page_view', 'bot_hit')
      and (p_surface = 'all' or public._ae_surface(surface, platform, path) = p_surface)
  ) v
  where (p_dim = 'bot_name' and v.tb = 'bot')
     or (p_dim = 'blocked_pattern' and v.tb = 'blocked')
     or (p_dim = 'country' and v.tb <> 'human')
  group by 1, 2
  order by pageviews desc
  limit coalesce(p_limit, 15);
$$;

-- ── Daily rollup: exclude suspect rows and bot_hit ──
create or replace function public.ae_rollup_and_prune(p_retention_days integer default 180, p_recent_days integer default 3)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rolled int := 0;
  v_pruned int := 0;
begin
  insert into public.analytics_daily as d (day, pageviews, sessions, visitors, events, signups, signed_in_users, updated_at)
  select date_trunc('day', created_at)::date as day,
         count(*) filter (where event_name = 'page_view'),
         count(distinct session_id),
         count(distinct visitor_id),
         count(*),
         count(*) filter (where event_name in ('signup_completed','signup')),
         count(distinct user_id) filter (where user_id is not null),
         now()
  from public.analytics_events
  where created_at >= (now() - make_interval(days => greatest(p_recent_days, 1)))
    and event_name <> 'bot_hit'
    and not public._ae_suspect(user_id, device, country, props, user_agent)
  group by 1
  on conflict (day) do update set
    pageviews = excluded.pageviews,
    sessions = excluded.sessions,
    visitors = excluded.visitors,
    events = excluded.events,
    signups = excluded.signups,
    signed_in_users = excluded.signed_in_users,
    updated_at = now();
  get diagnostics v_rolled = row_count;

  delete from public.analytics_events
  where created_at < (now() - make_interval(days => greatest(p_retention_days, 30)));
  get diagnostics v_pruned = row_count;

  return json_build_object('days_rolled', v_rolled, 'rows_pruned', v_pruned, 'retention_days', greatest(p_retention_days, 30));
end;
$$;

revoke all on function public.ae_rollup_and_prune(integer, integer) from public, anon, authenticated;

-- Re-roll the affected window so analytics_daily stops counting the fleet.
select public.ae_rollup_and_prune(180, 60);
