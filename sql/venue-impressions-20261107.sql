-- Venue impressions: how many people saw each listing (app + website).
--
-- Source rows (written by /api/vibe's anonymous path, sent by js/impressions.js):
--   venue_impressions  props {ids:[uuid…], src, city?}  — cards/links ≥50% on
--                      screen for ≥1s, each venue once per page load per src
--   venue_view         props {id:uuid, src, city?}      — app venue modal open
--                      (src app_modal) or /spots/<slug> page view (site_page)
-- session_id on these rows is the server's daily-rotating anonymous visitor
-- hash, so "viewers" = distinct visitor-days (a person seen on 3 days counts 3).
-- Bot/blocked user agents are excluded via _ae_bot_bucket. Admin-gated like
-- every ae_* RPC. Raw rows follow the 180-day analytics_events retention.

create or replace function public.ae_venue_impressions(
  p_from timestamptz, p_to timestamptz,
  p_surface text default 'all', p_city text default null,
  p_q text default null, p_limit integer default 100)
returns table(venue_id uuid, name text, city_slug text, neighborhood text,
              impressions bigint, viewers bigint, app_impressions bigint, site_impressions bigint,
              detail_views bigint, detail_viewers bigint, ctr numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with base as (
    select e.event_name, e.props, e.session_id,
           public._ae_surface(e.surface, e.platform, e.path) as surf
    from public.analytics_events e
    where public.is_giveaway_admin()
      and e.event_name in ('venue_impressions', 'venue_view')
      and e.created_at >= p_from and e.created_at < p_to
      and public._ae_bot_bucket(e.user_agent) = 'human'
      and (p_surface = 'all' or public._ae_surface(e.surface, e.platform, e.path) = p_surface)
  ),
  imp as (
    select x.id::uuid as venue_id, b.session_id, b.surf
    from base b
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(b.props->'ids') = 'array' then b.props->'ids' else '[]'::jsonb end) as x(id)
    where b.event_name = 'venue_impressions'
      and x.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  vw as (
    select (b.props->>'id')::uuid as venue_id, b.session_id
    from base b
    where b.event_name = 'venue_view'
      and coalesce(b.props->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  ai as (
    select venue_id, count(*) as impressions, count(distinct session_id) as viewers,
           count(*) filter (where surf = 'app')  as app_impressions,
           count(*) filter (where surf = 'site') as site_impressions
    from imp group by venue_id
  ),
  av as (
    select venue_id, count(*) as detail_views, count(distinct session_id) as detail_viewers
    from vw group by venue_id
  )
  select v.id, v.name, v.city_slug, v.neighborhood,
         coalesce(ai.impressions, 0)::bigint, coalesce(ai.viewers, 0)::bigint,
         coalesce(ai.app_impressions, 0)::bigint, coalesce(ai.site_impressions, 0)::bigint,
         coalesce(av.detail_views, 0)::bigint, coalesce(av.detail_viewers, 0)::bigint,
         case when coalesce(ai.impressions, 0) > 0
              then round(100.0 * coalesce(av.detail_views, 0) / ai.impressions, 1) end
  from ai
  full join av on av.venue_id = ai.venue_id
  join public.venues v on v.id = coalesce(ai.venue_id, av.venue_id)
  where (p_city is null or p_city = '' or v.city_slug = p_city)
    and (p_q is null or p_q = '' or v.name ilike '%' || p_q || '%')
  order by coalesce(ai.impressions, 0) desc, coalesce(av.detail_views, 0) desc, v.name
  limit coalesce(p_limit, 100);
$$;

-- Daily/hourly series for one venue (admin drill-down chart).
create or replace function public.ae_venue_impression_series(
  p_venue uuid, p_from timestamptz, p_to timestamptz,
  p_bucket text default 'day', p_surface text default 'all')
returns table(bucket timestamptz, impressions bigint, detail_views bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select date_trunc(case when p_bucket = 'hour' then 'hour' else 'day' end, e.created_at) as bucket,
         count(*) filter (where e.event_name = 'venue_impressions')::bigint,
         count(*) filter (where e.event_name = 'venue_view')::bigint
  from public.analytics_events e
  where public.is_giveaway_admin()
    and e.event_name in ('venue_impressions', 'venue_view')
    and e.created_at >= p_from and e.created_at < p_to
    and public._ae_bot_bucket(e.user_agent) = 'human'
    and (p_surface = 'all' or public._ae_surface(e.surface, e.platform, e.path) = p_surface)
    and (
      (e.event_name = 'venue_view' and e.props->>'id' = p_venue::text)
      or (e.event_name = 'venue_impressions' and jsonb_typeof(e.props->'ids') = 'array'
          and e.props->'ids' ? p_venue::text)
    )
  group by 1 order by 1;
$$;

revoke all on function public.ae_venue_impressions(timestamptz, timestamptz, text, text, text, integer) from public, anon;
revoke all on function public.ae_venue_impression_series(uuid, timestamptz, timestamptz, text, text) from public, anon;
grant execute on function public.ae_venue_impressions(timestamptz, timestamptz, text, text, text, integer) to authenticated;
grant execute on function public.ae_venue_impression_series(uuid, timestamptz, timestamptz, text, text) to authenticated;
