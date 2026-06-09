-- Per-user city for digest routing (weekly-digest / daily-deals).
-- Every profile gets a city_slug so the crons can fan out per active city
-- straight off the cities table — no hardcoded slugs, scales to any new market.

alter table public.profiles
  add column if not exists city_slug text not null default 'san-diego';

create index if not exists profiles_city_slug_idx on public.profiles (city_slug);

-- City-agnostic backfill: set each user's city_slug to their most-frequent
-- check-in city (ties broken alphabetically for determinism). Users with no
-- check-ins keep the column default ('san-diego'). This naturally routes OC
-- check-in users to OC and everyone else to SD, and generalizes to any city.
with ranked as (
  select user_id,
         city_slug,
         row_number() over (
           partition by user_id
           order by count(*) desc, city_slug
         ) as rn
  from public.check_ins
  where city_slug is not null
  group by user_id, city_slug
)
update public.profiles p
   set city_slug = r.city_slug
  from ranked r
 where r.user_id = p.id
   and r.rn = 1;
