-- Migration v15: Cancel / Resume subscription RPCs
-- Adds the two RPCs that the SellerDashboard cancel-flow expects:
--   cancel_subscription(p_immediate boolean)
--   resume_subscription()
--
-- Both are SECURITY DEFINER and act on the calling auth.uid()'s subscription.

-- =========================================================
-- cancel_subscription
-- =========================================================
-- p_immediate = false (default):  soft-cancel — keeps access until current_period_end,
--                                 then auto-flips to 'cancelled' at period rollover.
-- p_immediate = true:             hard-cancel now — status='cancelled' and access ends.
CREATE OR REPLACE FUNCTION cancel_subscription(p_immediate BOOLEAN DEFAULT FALSE)
RETURNS merchant_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller TEXT := auth.uid()::text;
    v_row merchant_subscriptions;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT * INTO v_row
    FROM merchant_subscriptions
    WHERE merchant_id = v_caller
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No subscription found for merchant %', v_caller;
    END IF;

    IF v_row.status = 'cancelled' THEN
        RETURN v_row; -- idempotent
    END IF;

    IF p_immediate THEN
        UPDATE merchant_subscriptions
        SET status = 'cancelled',
            cancel_at_period_end = FALSE,
            current_period_end = NOW(),
            updated_at = NOW()
        WHERE merchant_id = v_caller
        RETURNING * INTO v_row;
    ELSE
        UPDATE merchant_subscriptions
        SET cancel_at_period_end = TRUE,
            updated_at = NOW()
        WHERE merchant_id = v_caller
        RETURNING * INTO v_row;
    END IF;

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_subscription(BOOLEAN) TO authenticated;

-- =========================================================
-- resume_subscription
-- =========================================================
-- Reverses a soft-cancel (cancel_at_period_end = true) while still inside the
-- paid period. If the subscription has already flipped to 'cancelled', this
-- function refuses — the merchant must start a new subscription instead.
CREATE OR REPLACE FUNCTION resume_subscription()
RETURNS merchant_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller TEXT := auth.uid()::text;
    v_row merchant_subscriptions;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT * INTO v_row
    FROM merchant_subscriptions
    WHERE merchant_id = v_caller
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No subscription found for merchant %', v_caller;
    END IF;

    IF v_row.status = 'cancelled' THEN
        RAISE EXCEPTION 'Subscription already terminated; please subscribe again';
    END IF;

    UPDATE merchant_subscriptions
    SET cancel_at_period_end = FALSE,
        updated_at = NOW()
    WHERE merchant_id = v_caller
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION resume_subscription() TO authenticated;
