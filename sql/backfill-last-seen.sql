-- Backfill profiles.last_seen from real user activity.
--
-- The client heartbeat (_updateLastSeen in js/db.js) was unreliable — it ran
-- synchronously in initAuth BEFORE a background token refresh set the access
-- token, so returning users whose stored token had expired never recorded a
-- last_seen. The admin "Last Seen" column therefore showed "Never" for many
-- clearly-active users (13 of 134 null-last_seen profiles had activity, one as
-- recent as the same day). The heartbeat is now also fired after every token
-- refresh and on app foreground; this one-time backfill cleans up history.
--
-- Sets last_seen to the most recent of (existing last_seen, latest check-in,
-- latest post, latest review) — only ever moves it FORWARD, never back.
-- Safe to re-run (idempotent).
with sub as (
  select u.id,
    greatest(
      coalesce((select max(created_at) from check_ins     ci where ci.user_id = u.id), 'epoch'),
      coalesce((select max(created_at) from checkin_photos cp where cp.user_id = u.id), 'epoch'),
      coalesce((select max(created_at) from reviews        r  where r.user_id  = u.id), 'epoch')
    ) as last_active
  from profiles u
)
update profiles p
set last_seen = sub.last_active
from sub
where p.id = sub.id
  and sub.last_active > 'epoch'
  and sub.last_active > coalesce(p.last_seen, 'epoch');
