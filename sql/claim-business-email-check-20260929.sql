-- ═══════════════════════════════════════════════════════════════════
-- STAGED migration — NOT APPLIED. Run in the Supabase dashboard SQL editor
-- (service_role) when ready. Shane approved 2026-09-29: new claims require a
-- venue-domain business email OR business proof.
--
-- Enforces the claim policy at the DB layer: a venue_claims row must have
-- either a venue-domain business email or business proof recorded in notes.
-- Free inboxes (Gmail/Yahoo/iCloud/…) and Apple Private Relay do not count
-- on their own. Client-side validation already exists in business-portal.html
-- (submitClaim / isBusinessEmail); this is the server-side backstop.
--
-- Uses NOT VALID so existing rows (the current pending queue) are not
-- blocked; the constraint applies to new inserts and updates. After the
-- stale queue is cleared, run:
--   ALTER TABLE public.venue_claims VALIDATE CONSTRAINT venue_claims_business_email_or_proof;
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.is_business_claim_email(email text)
RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT email IS NOT NULL
     AND email LIKE '%@%.%'
     AND split_part(lower(email), '@', 2) NOT IN (
       'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com',
       'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com',
       'protonmail.com', 'proton.me', 'zoho.com', 'yandex.com',
       'gmx.com', 'mail.com', 'inbox.com',
       'privaterelay.appleid.com')
     AND split_part(lower(email), '@', 2) NOT LIKE '%.privaterelay.appleid.com'
$$;

ALTER TABLE public.venue_claims
  ADD CONSTRAINT venue_claims_business_email_or_proof
  CHECK (
    public.is_business_claim_email(contact_email)
    OR nullif(btrim(notes), '') IS NOT NULL
  )
  NOT VALID;
