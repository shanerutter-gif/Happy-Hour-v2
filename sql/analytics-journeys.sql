-- analytics-journeys.sql
-- Visitor journey drill-down for the Site Traffic admin dashboard (applied via
-- MCP, apply_migration analytics_journeys). Powers the "Visitor journeys" card:
-- a list of recent sessions (source, entry page, pages, duration) and a
-- click-through step-by-step replay of one session — e.g. "landed from
-- chatgpt.com on /happy-hour/orange-county → neighborhood → venue → outbound".
--
-- Same pattern as the other ae_* RPCs: SECURITY DEFINER, gated by
-- is_giveaway_admin(), granted broadly (the gate is inside the function).

-- ae_journey filters by session; give it an index (the table only had
-- user/created_at + visitor indexes).
create index if not exists idx_ae_session_time
  on public.analytics_events (session_id, created_at);

-- One row per session in the range: who arrived, from where, what they did.
drop function if exists public.ae_recent_journeys(timestamptz, timestamptz, text, int);
create function public.ae_recent_journeys(
  p_from timestamptz, p_to timestamptz,
  p_surface text default 'site', p_limit int default 50
)
returns table(
  session_id text, visitor_id text, user_id uuid, display_name text,
  started_at timestamptz, ended_at timestamptz,
  pageviews bigint, events bigint,
  entry_path text, exit_path text,
  source text, referrer text, device text, country text,
  outbound_clicks bigint, signed_up boolean
)
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
      -- Attribution: first utm_source in the session (ChatGPT/newsletters tag
      -- themselves this way), else the first external referrer host, else direct.
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
      and (p_surface = 'all' or public._ae_surface(e.surface, e.platform, e.path) = p_surface)
    group by e.session_id
    having count(*) filter (where e.event_name = 'page_view') > 0
  )
  select s.session_id, s.visitor_id, s.user_id, p.display_name,
         s.started_at, s.ended_at, s.pageviews, s.events,
         s.entry_path, s.exit_path, s.source, s.referrer, s.device, s.country,
         s.outbound_clicks,
         -- "became a user": session was authenticated, or the stitched visitor
         -- has a signup event at any point (pre-signup journeys count).
         (s.user_id is not null or (s.visitor_id is not null and exists (
            select 1 from public.analytics_events x
            where x.visitor_id = s.visitor_id
              and x.event_name in ('signup', 'signup_completed', 'login_completed')))) as signed_up
  from sess s
  left join public.profiles p on p.id = s.user_id
  order by s.started_at desc
  limit coalesce(p_limit, 50);
$$;

-- Full ordered event stream for one session — the step-by-step replay.
drop function if exists public.ae_journey(text, int);
create function public.ae_journey(p_session text, p_limit int default 300)
returns table(created_at timestamptz, event_name text, path text, props jsonb, platform text, user_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select created_at, event_name, path, props, platform, user_id
  from public.analytics_events
  where public.is_giveaway_admin()
    and session_id = p_session
  order by created_at asc
  limit coalesce(p_limit, 300);
$$;

grant execute on function
  public.ae_recent_journeys(timestamptz, timestamptz, text, int),
  public.ae_journey(text, int)
  to anon, authenticated, service_role;
