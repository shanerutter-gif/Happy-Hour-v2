-- ── Allow video uploads in the checkin-photos bucket ─────
-- The bucket may restrict MIME types to images only. This adds video types.
UPDATE storage.buckets
SET allowed_mime_types = array[
  'image/jpeg','image/png','image/gif','image/webp','image/heic',
  'video/mp4','video/quicktime','video/webm'
]
WHERE id = 'checkin-photos';

-- ── RLS policies for deleting social content ────────────
-- Uses DROP IF EXISTS to avoid conflicts with existing policies.

-- Activity feed
alter table public.activity_feed enable row level security;
drop policy if exists "Users can delete own activity" on public.activity_feed;
create policy "Users can delete own activity"
  on public.activity_feed for delete
  using (auth.uid() = user_id);

-- Check-ins
alter table public.check_ins enable row level security;
drop policy if exists "Users can delete own check_ins" on public.check_ins;
create policy "Users can delete own check_ins"
  on public.check_ins for delete
  using (auth.uid() = user_id);

-- Checkin photos
alter table public.checkin_photos enable row level security;
drop policy if exists "Users can delete own checkin_photos" on public.checkin_photos;
create policy "Users can delete own checkin_photos"
  on public.checkin_photos for delete
  using (auth.uid() = user_id);

-- Social likes
alter table public.social_likes enable row level security;
drop policy if exists "Users can delete own likes" on public.social_likes;
create policy "Users can delete own likes"
  on public.social_likes for delete
  using (auth.uid() = user_id);

-- Social comments
alter table public.social_comments enable row level security;
drop policy if exists "Users can delete own comments" on public.social_comments;
create policy "Users can delete own comments"
  on public.social_comments for delete
  using (auth.uid() = user_id);
