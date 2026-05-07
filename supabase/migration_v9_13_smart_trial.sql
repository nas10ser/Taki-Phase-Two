-- Migration v9.13: Smart auto-trial for new sellers
--
-- Replaces migration_v12's trigger which was never installed AND hardcoded
-- 14 days. This version:
--   • Reads trial_days + basic_plan_price_sar from platform_settings live
--   • Sets the subscription amount so when the trial expires the seller
--     is billed at the platform's current default rate
--   • Writes BOTH store_profiles (auth source) AND users.trial_*_at columns
--   • Skips sellers who already have a paid/explicit plan (admin grants win)

CREATE OR REPLACE FUNCTION handle_new_seller_trial()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
    v_trial_days INT;
    v_amount NUMERIC;
    v_existing_plan TEXT;
BEGIN
    IF NEW.user_type IS DISTINCT FROM 'seller' THEN
        RETURN NEW;
    END IF;

    -- Live settings (fall back to sane defaults if rows missing).
    BEGIN
        SELECT (value::text)::int INTO v_trial_days
        FROM platform_settings WHERE key = 'trial_days';
    EXCEPTION WHEN OTHERS THEN v_trial_days := NULL;
    END;
    v_trial_days := COALESCE(NULLIF(v_trial_days, 0), 14);

    BEGIN
        SELECT (value::text)::numeric INTO v_amount
        FROM platform_settings WHERE key = 'basic_plan_price_sar';
    EXCEPTION WHEN OTHERS THEN v_amount := NULL;
    END;
    v_amount := COALESCE(v_amount, 199);

    -- Skip if seller already has a paid/explicit plan (admin set it manually).
    SELECT subscription_plan INTO v_existing_plan
    FROM store_profiles WHERE store_id = NEW.id;

    IF v_existing_plan IN ('premium', 'trial') THEN
        RETURN NEW;
    END IF;

    -- Upsert the trial row.
    INSERT INTO store_profiles (
        store_id,
        subscription_plan,
        subscription_amount,
        subscription_started_at,
        subscription_expires_at,
        discount_percentage
    )
    VALUES (
        NEW.id,
        'trial',
        v_amount,
        NOW(),
        NOW() + (v_trial_days || ' days')::INTERVAL,
        0
    )
    ON CONFLICT (store_id) DO UPDATE SET
        subscription_plan = 'trial',
        subscription_amount = EXCLUDED.subscription_amount,
        subscription_started_at = EXCLUDED.subscription_started_at,
        subscription_expires_at = EXCLUDED.subscription_expires_at,
        discount_percentage = 0;

    -- Mirror onto users for redundant trial tracking.
    UPDATE users SET
        trial_starts_at = NOW(),
        trial_ends_at = NOW() + (v_trial_days || ' days')::INTERVAL
    WHERE id = NEW.id;

    RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS tr_new_seller_trial ON users;
CREATE TRIGGER tr_new_seller_trial
    AFTER INSERT OR UPDATE OF user_type ON users
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_seller_trial();

COMMENT ON FUNCTION handle_new_seller_trial() IS
    'Auto-grants every new seller a free trial sized by platform_settings.trial_days '
    'and pre-populated with platform_settings.basic_plan_price_sar so the post-trial '
    'billing amount matches the current platform price. Skips sellers who already '
    'have a premium or trial plan (admin overrides win).';
