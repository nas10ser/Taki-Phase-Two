-- ================================================================
-- TAKI Migration v8.6 — Server-Side Follow Notifications
-- ================================================================
-- 
-- Goal: Ensure merchant notifications are generated instantly on the 
-- server whenever a buyer follows them. This fulfills the user's
-- request for "Server-side" logic to guarantee speed across devices.
--
-- Logic: Monitors the `users` table for updates to `followed_merchants`.
-- If a new merchant ID is added to the array, a notification is 
-- automatically inserted into the `notifications` table.
-- ================================================================

CREATE OR REPLACE FUNCTION public.handle_follow_notification()
RETURNS TRIGGER AS $$
DECLARE
    added_merchant_id TEXT;
    buyer_name TEXT;
BEGIN
    -- 1. Find the merchant ID that was added to the array
    -- Logic: Find elements in NEW.followed_merchants that are NOT in OLD.followed_merchants
    SELECT elem INTO added_merchant_id
    FROM unnest(NEW.followed_merchants) AS elem
    WHERE elem NOT IN (SELECT unnest(COALESCE(OLD.followed_merchants, ARRAY[]::TEXT[])));

    -- 2. If a new merchant was followed, insert a notification for them
    IF added_merchant_id IS NOT NULL THEN
        -- Get the buyer's name
        buyer_name := COALESCE(NEW.name, 'مستخدم جديد');

        INSERT INTO public.notifications (
            user_id,
            title_ar,
            title_en,
            body_ar,
            body_en,
            type,
            meta_data,
            created_at
        ) VALUES (
            added_merchant_id,
            '👥 متابع جديد!',
            '👥 New Follower!',
            'بدأ ' || buyer_name || ' بمتابعة محلك لمشاهدة أحدث عروضك.',
            buyer_name || ' started following your shop to see your latest deals.',
            'follow',
            jsonb_build_object('followerId', NEW.id),
            NOW()
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create the Trigger
DROP TRIGGER IF EXISTS tr_follow_notification ON public.users;
CREATE TRIGGER tr_follow_notification
AFTER UPDATE OF followed_merchants ON public.users
FOR EACH ROW
WHEN (OLD.followed_merchants IS DISTINCT FROM NEW.followed_merchants)
EXECUTE FUNCTION public.handle_follow_notification();

DO $$ 
BEGIN 
  RAISE NOTICE '✅ Server-side follow notifications enabled via Trigger'; 
END $$;
