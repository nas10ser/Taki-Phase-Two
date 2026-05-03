-- ========================================================
-- TAKI Migration v7.6 — Tighten Row-Level Security (table-tolerant)
-- ========================================================
-- Replaces six permissive `WITH CHECK (true)` / `USING (true)`
-- policies with `auth.uid()`-bound checks.
--
-- This file is *table-tolerant*: if a table doesn't exist
-- yet (e.g. `ratings` or `store_profiles` was never created),
-- its block is skipped silently instead of failing.
-- That way the same script runs cleanly on any database
-- state — fresh, partial, or fully migrated.
--
-- Idempotent: every block uses `DROP POLICY IF EXISTS`
-- before `CREATE POLICY`, so re-running is safe.
--
-- Why notifs_insert_auth stays open-ish:
--   A buyer's booking creates a notification row whose
--   `user_id` is the SELLER. Tightening to
--   `auth.uid() = user_id` would break that flow.
--   The compromise is `auth.uid() IS NOT NULL` — anonymous
--   spam is blocked, but cross-user inserts still work.
--   Long-term: replace with a SECURITY DEFINER function.
-- ========================================================

-- ---------- USERS ----------
DO $$ BEGIN
    IF to_regclass('public.users') IS NOT NULL THEN
        DROP POLICY IF EXISTS "users_insert_own" ON users;
        CREATE POLICY "users_insert_own"
            ON users FOR INSERT
            WITH CHECK (auth.uid()::text = id);
    END IF;
END $$;

-- ---------- DEALS ----------
DO $$ BEGIN
    IF to_regclass('public.deals') IS NOT NULL THEN
        DROP POLICY IF EXISTS "deals_insert_seller" ON deals;
        CREATE POLICY "deals_insert_seller"
            ON deals FOR INSERT
            WITH CHECK (auth.uid()::text = store_id);

        DROP POLICY IF EXISTS "deals_update_seller" ON deals;
        CREATE POLICY "deals_update_seller"
            ON deals FOR UPDATE
            USING (auth.uid()::text = store_id)
            WITH CHECK (auth.uid()::text = store_id);
    END IF;
END $$;

-- ---------- RATINGS ----------
DO $$ BEGIN
    IF to_regclass('public.ratings') IS NOT NULL THEN
        DROP POLICY IF EXISTS "ratings_insert_auth" ON ratings;
        CREATE POLICY "ratings_insert_auth"
            ON ratings FOR INSERT
            WITH CHECK (auth.uid()::text = user_id);

        DROP POLICY IF EXISTS "ratings_update_own" ON ratings;
        CREATE POLICY "ratings_update_own"
            ON ratings FOR UPDATE
            USING (auth.uid()::text = user_id)
            WITH CHECK (auth.uid()::text = user_id);
    END IF;
END $$;

-- ---------- BOOKINGS ----------
DO $$ BEGIN
    IF to_regclass('public.bookings') IS NOT NULL THEN
        DROP POLICY IF EXISTS "bookings_insert_auth" ON bookings;
        CREATE POLICY "bookings_insert_auth"
            ON bookings FOR INSERT
            WITH CHECK (auth.uid()::text = user_id);
    END IF;
END $$;

-- ---------- NOTIFICATIONS ----------
DO $$ BEGIN
    IF to_regclass('public.notifications') IS NOT NULL THEN
        DROP POLICY IF EXISTS "notifs_insert_auth" ON notifications;
        CREATE POLICY "notifs_insert_auth"
            ON notifications FOR INSERT
            WITH CHECK (auth.uid() IS NOT NULL);
    END IF;
END $$;

-- ---------- STORE PROFILES ----------
DO $$ BEGIN
    IF to_regclass('public.store_profiles') IS NOT NULL THEN
        DROP POLICY IF EXISTS "store_profiles_insert_own" ON store_profiles;
        CREATE POLICY "store_profiles_insert_own"
            ON store_profiles FOR INSERT
            WITH CHECK (auth.uid()::text = store_id);
    END IF;
END $$;

-- ========================================================
-- Verification — run this AFTER the migration to see what
-- got applied. Tables that don't exist will simply be absent.
-- ========================================================
-- SELECT
--     n.nspname  AS schema,
--     c.relname  AS table_name,
--     p.polname  AS policy,
--     p.polcmd   AS cmd,
--     pg_get_expr(p.polqual,      p.polrelid) AS using_expr,
--     pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr
-- FROM pg_policy p
-- JOIN pg_class c    ON c.oid = p.polrelid
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE c.relname IN ('users','deals','ratings','bookings','notifications','store_profiles')
-- ORDER BY c.relname, p.polname;
