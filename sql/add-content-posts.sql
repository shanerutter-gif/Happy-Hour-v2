-- Content Calendar posts table
CREATE TABLE IF NOT EXISTS public.content_posts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  caption text,
  scheduled_date date,
  scheduled_time text,
  status text DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published')),
  platforms text[] DEFAULT '{}',
  tags text[] DEFAULT '{}',
  media_urls text[] DEFAULT '{}',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index for calendar queries
CREATE INDEX IF NOT EXISTS idx_content_posts_date ON public.content_posts(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_content_posts_status ON public.content_posts(status);

-- RLS: allow service role full access
ALTER TABLE public.content_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.content_posts
  FOR ALL USING (true) WITH CHECK (true);
