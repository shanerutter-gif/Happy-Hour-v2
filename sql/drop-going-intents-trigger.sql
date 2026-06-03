-- drop-going-intents-trigger.sql
-- The "going-out intent" feature (🍻 Going button + going_intents table) was
-- removed from the app. Its INSERT trigger notified every follower with a
-- notification of type 'mention' — which the app rendered as "X mentioned you"
-- even though no mention occurred (see the Kourtney Rutter false-mention bug).
--
-- Drop the trigger + function so the feature is fully inert. The going_intents
-- table and its existing rows are intentionally left in place (non-destructive).

DROP TRIGGER IF EXISTS trg_going_notify_followers ON public.going_intents;
DROP FUNCTION IF EXISTS public.trg_going_notify_followers();
