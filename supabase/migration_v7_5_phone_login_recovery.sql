-- ========================================================
-- TAKI Migration v7.5 — Phone login recovery
-- ========================================================
-- Run AFTER migration_v7_4_cleanup_phantom_accounts.sql.
--
-- Background:
--   Buyers whose auth.users row was confirmed but who never
--   successfully signed in (because the phantom-account bug
--   corrupted their password) have no row in public.users.
--   The phone-login path (authService.signInWithPassword)
--   resolves phone → email exclusively through public.users,
--   so these accounts cannot log in even though the number
--   "exists in Supabase".
--
--   Symptom: a real number like 0591173715 visible in the
--   Supabase Auth dashboard returns "account not found" on
--   the website.
--
-- This migration does two things:
--   1. Backfills public.users from every confirmed
--      auth.users row that's missing one.
--   2. Installs find_email_by_phone(text) so the client can
--      resolve any phone format (0xxx, +966xxx, 966xxx,
--      bare 9-digit) to the matching email by searching BOTH
--      public.users and auth.users metadata.
-- ========================================================

-- ---------- 1. Backfill public.users from auth.users ----------
-- Only confirmed accounts. We pull name/phone/user_type from
-- raw_user_meta_data (set during signUpWithEmail) and fall
-- back to auth.users.email/phone for the bare columns.
INSERT INTO public.users (id, name, phone, email, user_type, shop, contact_phone, address)
SELECT
    a.id::text,
    COALESCE(NULLIF(a.raw_user_meta_data->>'name', ''), 'مستخدم'),
    COALESCE(a.raw_user_meta_data->>'phone', a.phone),
    COALESCE(a.email, a.raw_user_meta_data->>'email'),
    COALESCE(a.raw_user_meta_data->>'user_type', 'buyer'),
    a.raw_user_meta_data->>'shop',
    COALESCE(a.raw_user_meta_data->>'contact_phone', a.raw_user_meta_data->>'phone', a.phone),
    a.raw_user_meta_data->>'address'
FROM auth.users a
WHERE a.email_confirmed_at IS NOT NULL
  AND COALESCE(a.email, a.raw_user_meta_data->>'email') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.users p WHERE p.id = a.id::text)
ON CONFLICT (id) DO NOTHING;

-- ---------- 2. find_email_by_phone() RPC ----------
-- Normalizes the input to digits, strips +966/00966 country
-- code, then searches BOTH public.users AND auth.users
-- metadata across every common format. Returns NULL if no
-- match is found.
CREATE OR REPLACE FUNCTION public.find_email_by_phone(input_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    digits_only TEXT;
    bare        TEXT;  -- 9-digit form, no leading 0
    intl        TEXT;  -- +966 + bare
    country     TEXT;  -- 966 + bare
    found_email TEXT;
BEGIN
    digits_only := regexp_replace(COALESCE(input_phone, ''), '\D', '', 'g');

    IF length(digits_only) >= 13 AND left(digits_only, 5) = '00966' THEN
        digits_only := '0' || substring(digits_only from 6);
    ELSIF length(digits_only) >= 12 AND left(digits_only, 3) = '966' THEN
        digits_only := '0' || substring(digits_only from 4);
    END IF;

    IF length(digits_only) < 9 THEN
        RETURN NULL;
    END IF;

    -- Build all the variants we'll try
    IF left(digits_only, 1) = '0' THEN
        bare := substring(digits_only from 2);
    ELSE
        bare := digits_only;
    END IF;
    intl    := '+966' || bare;
    country := '966'  || bare;

    -- Search public.users (phone + contact_phone)
    SELECT email INTO found_email
      FROM public.users
     WHERE phone         IN (digits_only, '0' || bare, bare, intl, country)
        OR contact_phone IN (digits_only, '0' || bare, bare, intl, country)
     LIMIT 1;

    IF found_email IS NOT NULL THEN
        RETURN found_email;
    END IF;

    -- Fallback: search auth.users (raw phone column + metadata)
    SELECT COALESCE(email, raw_user_meta_data->>'email') INTO found_email
      FROM auth.users
     WHERE phone                          IN (digits_only, '0' || bare, bare, intl, country)
        OR raw_user_meta_data->>'phone'         IN (digits_only, '0' || bare, bare, intl, country)
        OR raw_user_meta_data->>'contact_phone' IN (digits_only, '0' || bare, bare, intl, country)
     LIMIT 1;

    RETURN found_email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_email_by_phone(TEXT) TO anon, authenticated;

-- ---------- Verification ----------
-- After running, this should return a real email for the
-- complaining number:
--   SELECT public.find_email_by_phone('0591173715');
