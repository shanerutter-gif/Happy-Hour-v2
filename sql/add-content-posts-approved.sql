-- Content Calendar: owner approval state for draft posts.
-- Safe to run more than once.

ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT false;

ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;
