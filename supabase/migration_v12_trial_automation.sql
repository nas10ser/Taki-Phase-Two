-- Migration v12: 14-Day Trial Automation & Smart Retention
-- This migration automates the SaaS trial period for new merchants and provides an RPC function to notify them 3 days before expiry.

-- 1. Trigger to automatically grant a 14-day trial to new sellers
CREATE OR REPLACE FUNCTION handle_new_seller_trial()
RETURNS TRIGGER AS $$
BEGIN
    -- Only apply to new sellers
    IF NEW.user_type = 'seller' THEN
        -- Insert a new profile with a 14-day trial, or update if it exists but lacks a plan
        INSERT INTO store_profiles (store_id, subscription_plan, subscription_expires_at)
        VALUES (NEW.id, 'trial', NOW() + INTERVAL '14 days')
        ON CONFLICT (store_id) DO UPDATE SET
            subscription_plan = 'trial',
            subscription_expires_at = NOW() + INTERVAL '14 days'
        WHERE store_profiles.subscription_plan IS NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_new_seller_trial ON users;
CREATE TRIGGER tr_new_seller_trial
    AFTER INSERT ON users
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_seller_trial();


-- 2. Smart Notification RPC (To be called via pg_cron or Edge Function once daily)
-- This function finds sellers whose trial ends within 3 days and sends them a retention notification with real stats.
CREATE OR REPLACE FUNCTION send_trial_ending_notifications()
RETURNS void AS $$
DECLARE
    seller RECORD;
    deal_stats RECORD;
    notif_id TEXT;
    notif_body_ar TEXT;
    notif_body_en TEXT;
BEGIN
    FOR seller IN 
        SELECT u.id, u.name, sp.subscription_expires_at 
        FROM users u
        JOIN store_profiles sp ON u.id = sp.store_id
        WHERE u.user_type = 'seller'
          AND sp.subscription_plan = 'trial'
          AND sp.subscription_expires_at IS NOT NULL
          AND sp.subscription_expires_at BETWEEN NOW() AND (NOW() + INTERVAL '3 days')
          -- Prevent duplicate warnings by checking if we already sent a trial_warning
          AND NOT EXISTS (
              SELECT 1 FROM notifications n 
              WHERE n.user_id = u.id 
                AND n.type = 'marketing' 
                AND n.meta_data->>'trial_warning' = 'true'
          )
    LOOP
        -- Calculate stats for this seller
        -- 'initial_quantity - quantity' represents bookings if we assume quantity drops on booking.
        -- We will also count total views if available, but for now we aggregate bookings (or simulated views/bookings).
        SELECT 
            COUNT(*) as deals_count,
            -- If initial_quantity exists, calculate bookings. Otherwise use a fallback stat.
            COALESCE(SUM(GREATEST(0, COALESCE(initial_quantity, quantity) - quantity)), 0) as total_bookings
        INTO deal_stats
        FROM deals 
        WHERE store_id = seller.id;

        notif_id := 'n' || extract(epoch from now())::text || substr(md5(random()::text), 1, 5);

        -- Construct personalized smart message
        notif_body_ar := 'لقد حققت عروضك (' || deal_stats.total_bookings || ') عملية حجز خلال الفترة المجانية، لا تدع الأرقام تتوقف! اشترك الآن واستمر في تنمية أعمالك 🚀.';
        notif_body_en := 'Your deals achieved (' || deal_stats.total_bookings || ') bookings during the free trial, don''t let the numbers stop! Subscribe now to continue growing 🚀.';

        INSERT INTO notifications (id, user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
        VALUES (
            notif_id,
            seller.id,
            '⏳ فترتك التجريبية توشك على الانتهاء!',
            '⏳ Your trial is ending soon!',
            notif_body_ar,
            notif_body_en,
            'marketing',
            '{"trial_warning": "true", "actionUrl": "/subscription"}'::jsonb
        );
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Optional: If pg_cron is enabled on the server, schedule the function to run daily at 10 AM.
-- DO NOT FAIL if pg_cron is not installed, wrap in a block.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
    ) THEN
        -- Schedule the job: '0 10 * * *' = 10:00 AM every day
        PERFORM cron.schedule('daily_trial_warning', '0 10 * * *', 'SELECT send_trial_ending_notifications();');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'pg_cron not enabled. You can manually call send_trial_ending_notifications() via Edge Functions.';
END
$$;
