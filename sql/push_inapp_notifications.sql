-- ═══════════════════════════════════════════════════════
-- SPOTD — In-app push notifications + send_push_to_user fixes
-- Applied via MCP 2026-06-12. Broadcast/campaign/automation pushes get saved
-- as notifications rows (type='push') so they show in the social bell panel;
-- opening the panel clears the iOS icon badge via /api/clear-badge.
-- ═══════════════════════════════════════════════════════

-- 1. Allow the new type (also adds 'tagged', which the app's renderer already
--    handles but the old constraint forbade).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('like','comment','follow','mention','tagged','push'));

-- 2. Push rows carry their own title + tap-through URL (actor_id stays null).
alter table public.notifications add column if not exists title text;
alter table public.notifications add column if not exists url text;

-- 3. send_push_to_user fixes:
--    (a) www host — the apex 308-redirect strips the Authorization header,
--        so every call via bare spotd.biz silently 401'd;
--    (b) inapp:false — this function's callers (tag/like triggers) already
--        insert their own notifications rows, so send-push must not save a
--        duplicate in-app row for these.
CREATE OR REPLACE FUNCTION public.send_push_to_user(p_user_id uuid, p_title text, p_body text, p_url text DEFAULT '/'::text, p_tag text DEFAULT 'spotd'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key text;
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;

  -- Pull the API key from Vault. Missing key = no-op.
  BEGIN
    SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
    WHERE name = 'push_api_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;
  IF v_key IS NULL OR v_key = '' THEN RETURN; END IF;

  -- Async fire-and-forget POST. Errors are swallowed so we never break
  -- the calling transaction (notifications + likes/comments still land).
  -- MUST be www: the apex 308-redirect strips the Authorization header.
  BEGIN
    PERFORM net.http_post(
      url     := 'https://www.spotd.biz/api/send-push',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body    := jsonb_build_object(
        'user_ids', jsonb_build_array(p_user_id),
        'title',    p_title,
        'body',     p_body,
        'url',      p_url,
        'tag',      p_tag,
        'inapp',    false
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;
END;
$function$;
