-- ================================================================
-- TAKI Migration v8.7 — Fully Server-Driven Notifications + Promo Seeds
-- ================================================================
--
-- Goals:
--   1. ALL booking-lifecycle notifications fire from the DATABASE,
--      not the client. The client only writes the booking row +
--      flips status; notifications are emitted by triggers. This
--      guarantees every notification fires even if the originating
--      client crashes, loses connection, or goes background.
--   2. The `bookings` UPDATE trigger refuses to revert a booking
--      from a higher status to a lower one (defends against stale
--      Realtime UPDATE replays).
--   3. Seed two promotional campaigns (one for buyers, one for
--      sellers) with `is_active = false` so the admin can flip them
--      ON from Supabase whenever they want — no code change needed.
--
-- Safe to re-run (idempotent: drop/replace functions, drop/recreate
-- triggers, ON CONFLICT DO NOTHING for seeds).
-- ================================================================

-- ====================== 1. BOOKING STATUS GUARD ======================
-- Refuses to revert a booking from completed/cancelled back to
-- pending/acknowledged. Stops stale Realtime UPDATEs and offline
-- writes from clobbering a confirmed receipt.
CREATE OR REPLACE FUNCTION public.guard_booking_status()
RETURNS TRIGGER AS $$
DECLARE
    old_rank INT;
    new_rank INT;
BEGIN
    old_rank := CASE OLD.status
        WHEN 'pending' THEN 0
        WHEN 'acknowledged' THEN 1
        WHEN 'completed' THEN 2
        WHEN 'cancelled' THEN 2
        ELSE 0
    END;
    new_rank := CASE NEW.status
        WHEN 'pending' THEN 0
        WHEN 'acknowledged' THEN 1
        WHEN 'completed' THEN 2
        WHEN 'cancelled' THEN 2
        ELSE 0
    END;

    -- Block any backward transition. Cancelled is terminal in the
    -- same rank as completed but they are NOT interchangeable.
    IF new_rank < old_rank THEN
        NEW.status := OLD.status;
    ELSIF OLD.status IN ('completed', 'cancelled') AND NEW.status <> OLD.status THEN
        NEW.status := OLD.status;
    END IF;

    -- Stamp completed_at the first time we transition INTO completed
    IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN
        NEW.completed_at := NOW();
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_guard_booking_status ON public.bookings;
CREATE TRIGGER tr_guard_booking_status
BEFORE UPDATE OF status ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.guard_booking_status();

-- ====================== 2. BOOKING NOTIFICATIONS (SERVER-SIDE) ======================
-- Emits notifications for every booking lifecycle event. This
-- replaces the client-side addNotification calls so the recipient
-- always gets the alert — even if the originator's tab crashes
-- mid-write or the recipient was offline when it happened (they
-- pull the notification on next login from the notifications table).
CREATE OR REPLACE FUNCTION public.handle_booking_notification()
RETURNS TRIGGER AS $$
DECLARE
    item_name TEXT;
    buyer_name TEXT;
    seller_name TEXT;
BEGIN
    -- Look up readable names. Coalesce to safe defaults so a missing
    -- row never breaks the trigger.
    SELECT d.item_name INTO item_name FROM public.deals d WHERE d.id = NEW.deal_id;
    item_name := COALESCE(item_name, 'العرض');

    SELECT COALESCE(u.name, u.shop, '') INTO buyer_name FROM public.users u WHERE u.id = NEW.user_id;
    buyer_name := COALESCE(NULLIF(buyer_name, ''), 'مشتري');

    SELECT COALESCE(u.shop, u.name, '') INTO seller_name FROM public.users u WHERE u.id = NEW.store_id;
    seller_name := COALESCE(NULLIF(seller_name, ''), 'التاجر');

    -- ── INSERT: new booking → notify the SELLER ──
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.notifications (
            user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at
        ) VALUES (
            NEW.store_id,
            '📦 طلب حجز جديد!',
            '📦 New Booking Request!',
            'طلب جديد من ' || buyer_name || ' لـ ' || item_name || ' (' || NEW.booked_quantity || ' قطعة).'
              || CASE
                  WHEN NEW.prep_time IS NOT NULL AND NEW.prep_time <> '' THEN
                      ' 🕒 الوقت: ' || CASE WHEN NEW.prep_time = 'arrival' THEN 'عند الوصول' ELSE NEW.prep_time || ' دقيقة' END
                  ELSE ''
              END
              || CASE WHEN NEW.notes IS NOT NULL AND NEW.notes <> '' THEN ' 📝 ' || NEW.notes ELSE '' END,
            'New order from ' || buyer_name || ' for ' || item_name || ' (' || NEW.booked_quantity || ' pcs).'
              || CASE
                  WHEN NEW.prep_time IS NOT NULL AND NEW.prep_time <> '' THEN
                      ' 🕒 ETA: ' || CASE WHEN NEW.prep_time = 'arrival' THEN 'On arrival' ELSE NEW.prep_time || ' min' END
                  ELSE ''
              END
              || CASE WHEN NEW.notes IS NOT NULL AND NEW.notes <> '' THEN ' 📝 ' || NEW.notes ELSE '' END,
            'booking',
            jsonb_build_object('barcode', NEW.barcode, 'dealId', NEW.deal_id, 'quantity', NEW.booked_quantity, 'prepTime', NEW.prep_time, 'notes', NEW.notes),
            NOW()
        );

        -- Also confirm to the BUYER that the booking landed.
        INSERT INTO public.notifications (
            user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at
        ) VALUES (
            NEW.user_id,
            '✅ تم الحجز بنجاح!',
            '✅ Booking Confirmed!',
            'تم حجز ' || item_name || ' — الرمز: ' || NEW.barcode || '. سيستلم التاجر طلبك قريباً.',
            item_name || ' booked — Code: ' || NEW.barcode || '. The seller will receive your order shortly.',
            'booking',
            jsonb_build_object('barcode', NEW.barcode, 'dealId', NEW.deal_id),
            NOW()
        );

        RETURN NEW;
    END IF;

    -- ── UPDATE: status transitions ──
    IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.status = 'acknowledged' THEN
            -- Notify the BUYER that the seller received the order
            INSERT INTO public.notifications (
                user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at
            ) VALUES (
                NEW.user_id,
                '📦 التاجر استلم طلبك!',
                '📦 Seller received your order!',
                'استلم ' || seller_name || ' طلبك لـ ' || item_name || ' وهو قيد التجهيز الآن.',
                seller_name || ' received your order for ' || item_name || ' and is preparing it now.',
                'booking',
                jsonb_build_object('barcode', NEW.barcode, 'dealId', NEW.deal_id),
                NOW()
            );

        ELSIF NEW.status = 'completed' THEN
            -- Final receipt: notify BOTH parties
            INSERT INTO public.notifications (
                user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at
            ) VALUES (
                NEW.user_id,
                '🎉 تم تسليم طلبك!',
                '🎉 Order Delivered!',
                'تم تأكيد استلام ' || item_name || ' من ' || seller_name || '. شكراً لاستخدامك تاكي 💚',
                item_name || ' delivery confirmed by ' || seller_name || '. Thanks for using Taki 💚',
                'booking',
                jsonb_build_object('barcode', NEW.barcode, 'dealId', NEW.deal_id),
                NOW()
            );
            INSERT INTO public.notifications (
                user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at
            ) VALUES (
                NEW.store_id,
                '🎉 تم الاستلام بنجاح!',
                '🎉 Order Delivered!',
                'استلم ' || buyer_name || ' طلب ' || item_name || ' — تم إغلاق الحجز.',
                buyer_name || ' received the order for ' || item_name || ' — booking closed.',
                'booking',
                jsonb_build_object('barcode', NEW.barcode, 'dealId', NEW.deal_id),
                NOW()
            );

        ELSIF NEW.status = 'cancelled' THEN
            -- Cancellation: notify the OTHER party (we don't know
            -- who triggered the cancel from inside the trigger, so
            -- notify both — the originator can ignore their own).
            INSERT INTO public.notifications (
                user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at
            ) VALUES (
                NEW.user_id,
                '⚠️ تم إلغاء الحجز',
                '⚠️ Booking Cancelled',
                'تم إلغاء حجز ' || item_name || '.',
                'Booking for ' || item_name || ' has been cancelled.',
                'booking',
                jsonb_build_object('barcode', NEW.barcode, 'dealId', NEW.deal_id),
                NOW()
            );
            INSERT INTO public.notifications (
                user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at
            ) VALUES (
                NEW.store_id,
                '⚠️ تم إلغاء حجز',
                '⚠️ Booking Cancelled',
                'تم إلغاء حجز ' || item_name || ' من قِبل ' || buyer_name || '.',
                buyer_name || ' cancelled the booking for ' || item_name || '.',
                'booking',
                jsonb_build_object('barcode', NEW.barcode, 'dealId', NEW.deal_id),
                NOW()
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_booking_notification ON public.bookings;
CREATE TRIGGER tr_booking_notification
AFTER INSERT OR UPDATE OF status ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.handle_booking_notification();

-- ====================== 3. PROMO CAMPAIGN SEEDS ======================
-- Seed the two campaigns the user requested. Loaded with
-- is_active = FALSE so they DO NOT fire until the admin flips
-- them on. Edit content directly in the row, then UPDATE
-- promotional_campaigns SET is_active = TRUE WHERE id = '...'.

INSERT INTO public.promotional_campaigns (
    id, target_audience, title_ar, title_en, body_ar, body_en,
    action_label_ar, action_label_en, action_url,
    priority, is_active, starts_at
) VALUES (
    'promo_seed_seller_growth',
    'seller',
    '📈 قم بترويج عروضك للحصول على عملاء جدد',
    '📈 Promote your offers to attract new customers',
    'انشر عروضك الحصرية الآن واجذب عملاء جدد إلى متجرك. كل عرض جديد = عميل محتمل أكثر! 🏬',
    'Post your exclusive offers now and attract new customers to your shop. Every new deal = more potential customers! 🏬',
    'أضف عرضاً جديداً',
    'Add a New Deal',
    '/seller-dashboard?tab=form',
    10,
    FALSE,
    NOW()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.promotional_campaigns (
    id, target_audience, title_ar, title_en, body_ar, body_en,
    action_label_ar, action_label_en, action_url,
    priority, is_active, starts_at
) VALUES (
    'promo_seed_buyer_exclusive',
    'buyer',
    '🛍️ تبي عروض حصرية حولك؟',
    '🛍️ Want exclusive deals near you?',
    'اكتشف أحدث العروض والتخفيضات الحصرية في منطقتك الآن — وفر أكثر مع تاكي! 🔥',
    'Discover the latest exclusive deals and discounts near you — save more with Taki! 🔥',
    'تصفح العروض',
    'Browse Deals',
    '/nearby',
    10,
    FALSE,
    NOW()
) ON CONFLICT (id) DO NOTHING;

-- ====================== 4. VERIFICATION ======================
-- After running, confirm:
--   SELECT id, target_audience, is_active FROM promotional_campaigns
--      WHERE id IN ('promo_seed_seller_growth', 'promo_seed_buyer_exclusive');
--   → both rows present, is_active = false
--
--   SELECT tgname FROM pg_trigger
--      WHERE tgrelid = 'public.bookings'::regclass
--      AND tgname IN ('tr_booking_notification', 'tr_guard_booking_status');
--   → both triggers present
--
-- To activate a campaign:
--   UPDATE promotional_campaigns SET is_active = TRUE WHERE id = 'promo_seed_buyer_exclusive';
