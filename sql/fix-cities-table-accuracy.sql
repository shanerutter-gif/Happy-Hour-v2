-- Make the public.cities table reflect reality.
--
-- Context: the frontend gates which cities are live via the hardcoded CITIES
-- array in js/app.js and deliberately ignores this table because it was stale
-- (it flagged every city active:true and had wrong venue/event counts). This
-- corrects the data so the table no longer lies to any internal tooling that
-- reads it.
--   * active      -> launched markets only (San Diego + Orange County)
--   * venue_count -> real count of active venues for that city_slug
--   * event_count -> real count of active events (matches how the app queries
--                    events: .eq('active', true) in js/db.js)
--
-- NOTE: these counts are a point-in-time correction and can drift as venues
-- are added/enriched. The `active` flag is an intentional launch decision and
-- must stay manual (e.g. New York has 89 active venue rows but no photos and
-- is not launched). Re-run this script after a city's data is enriched to
-- refresh the counts.
--
-- Applied to project opcskuzbdfrlnyhraysk as migration fix_cities_table_accuracy
-- on 2026-05-29.

update cities c set
  active      = (c.slug in ('san-diego','orange-county')),
  venue_count = coalesce(v.n, 0),
  event_count = coalesce(e.n, 0)
from (select slug from cities) s
left join (select city_slug, count(*) n from venues where active group by city_slug) v on v.city_slug = s.slug
left join (select city_slug, count(*) n from events  where active group by city_slug) e on e.city_slug = s.slug
where c.slug = s.slug;
