-- post_tags.sql
-- Photo-post tagging: when a user posts a photo (checkin_photos row), they
-- can tag friends who were there. Tagged users get a notification + push,
-- the post shows "with @X, @Y" on the feed, and tagged photos appear in
-- a section on the tagged user's profile.
--
-- The previous implementation wrote tagged_at rows directly to the tagged
-- user's activity_feed, which violates activity_feed RLS and silently
-- failed — zero tag rows exist as of this migration.

CREATE TABLE IF NOT EXISTS public.post_tags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id         UUID NOT NULL REFERENCES public.checkin_photos(id) ON DELETE CASCADE,
  tagged_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tagged_by       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, tagged_user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_tags_tagged_user
  ON public.post_tags (tagged_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_tags_post
  ON public.post_tags (post_id);
CREATE INDEX IF NOT EXISTS idx_post_tags_tagger
  ON public.post_tags (tagged_by, created_at DESC);

ALTER TABLE public.post_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone reads post_tags" ON public.post_tags;
CREATE POLICY "anyone reads post_tags"
  ON public.post_tags FOR SELECT
  TO authenticated USING (true);

-- The post owner is the only one who can attach tags. tagged_by must equal
-- the caller and the post must belong to them.
DROP POLICY IF EXISTS "post owner tags others" ON public.post_tags;
CREATE POLICY "post owner tags others"
  ON public.post_tags FOR INSERT
  TO authenticated
  WITH CHECK (
    tagged_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.checkin_photos
      WHERE id = post_id AND user_id = auth.uid()
    )
  );

-- Either party can remove the tag: the post owner (who added it) or the
-- tagged user (untagging themselves).
DROP POLICY IF EXISTS "tagged or owner untags" ON public.post_tags;
CREATE POLICY "tagged or owner untags"
  ON public.post_tags FOR DELETE
  TO authenticated
  USING (tagged_user_id = auth.uid() OR tagged_by = auth.uid());

-- Trigger: notify the tagged user (in-app notification + push). Skips self-tags.
CREATE OR REPLACE FUNCTION public.trg_notify_on_tag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor_name text;
  v_venue_name text;
BEGIN
  -- Don't notify on self-tag
  IF NEW.tagged_user_id = NEW.tagged_by THEN RETURN NEW; END IF;

  -- Insert in-app notification. Use the photo-<id> post_id convention used
  -- elsewhere (see trg_notify_on_like) so the existing notification renderer
  -- can deep-link straight to the photo.
  INSERT INTO public.notifications (user_id, actor_id, type, post_id, post_type)
  VALUES (NEW.tagged_user_id, NEW.tagged_by, 'tagged', 'photo-' || NEW.post_id, 'photo');

  SELECT display_name INTO v_actor_name
    FROM public.profiles WHERE id = NEW.tagged_by;

  SELECT cp.venue_id, v.name INTO v_venue_name
    FROM public.checkin_photos cp
    LEFT JOIN public.venues v ON v.id = cp.venue_id
    WHERE cp.id = NEW.post_id;

  PERFORM public.send_push_to_user(
    NEW.tagged_user_id,
    'You were tagged 📷',
    COALESCE(v_actor_name, 'Someone') ||
      CASE WHEN v_venue_name IS NOT NULL
           THEN ' tagged you at ' || v_venue_name
           ELSE ' tagged you in a photo'
      END,
    '/'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_tags_notify ON public.post_tags;
CREATE TRIGGER trg_post_tags_notify
  AFTER INSERT ON public.post_tags
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_on_tag();

GRANT SELECT, INSERT, DELETE ON public.post_tags TO authenticated;
