-- ── RLS policies for deleting social content ────────────
-- Run this in Supabase SQL Editor to enable post deletion.
--
-- These policies allow users to delete their own posts, check-ins,
-- and associated social data (likes/comments on their posts).

-- Activity feed: users can delete their own posts
alter table public.activity_feed enable row level security;
create policy "Users can delete own activity"
  on public.activity_feed for delete
  using (auth.uid() = user_id);

-- Check-ins: users can delete their own check-ins
alter table public.check_ins enable row level security;
create policy "Users can delete own check_ins"
  on public.check_ins for delete
  using (auth.uid() = user_id);

-- Checkin photos: users can delete their own photos
alter table public.checkin_photos enable row level security;
create policy "Users can delete own checkin_photos"
  on public.checkin_photos for delete
  using (auth.uid() = user_id);

-- Social likes: users can delete likes (for cleanup when post is deleted)
alter table public.social_likes enable row level security;
create policy "Users can delete own likes"
  on public.social_likes for delete
  using (auth.uid() = user_id);

-- Social comments: users can delete their own comments
alter table public.social_comments enable row level security;
create policy "Users can delete own comments"
  on public.social_comments for delete
  using (auth.uid() = user_id);
