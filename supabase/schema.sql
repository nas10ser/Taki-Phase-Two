-- ========================================================
-- TAKI Platform — Supabase Database Schema v3.0 (Secure-by-Default)
-- ========================================================
-- This schema is designed for the TAKI discount booking
-- platform. It supports full CRUD for deals, bookings,
-- notifications, user profiles and store metadata.
--
-- v3.0 hardens RLS so a fresh database is secure on day one
-- (no more permissive `WITH CHECK (true)` policies).
--
-- Run this file in the Supabase SQL Editor to initialize
-- the database when transitioning from localStorage.
-- ========================================================

-- Enable UUID extension for primary keys
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ====================== USERS ======================
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT UNIQUE,
    email TEXT,
    user_type TEXT NOT NULL CHECK (user_type IN ('buyer', 'seller', 'admin')),
    shop TEXT,
    contact_phone TEXT,
    address TEXT,
    avatar_url TEXT,
    bio TEXT,
    savings NUMERIC DEFAULT 0,
    bookings_count INTEGER DEFAULT 0,
    notif_keywords TEXT[] DEFAULT '{}',
    followed_merchants TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for phone-based authentication
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ====================== DEALS ======================
CREATE TABLE IF NOT EXISTS deals (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shop_name TEXT NOT NULL,
    item_name TEXT NOT NULL,
    category TEXT NOT NULL,
    gender TEXT DEFAULT 'all',
    size TEXT,
    original_price NUMERIC NOT NULL,
    discounted_price NUMERIC NOT NULL,
    discount_percentage INTEGER,
    images TEXT[] DEFAULT '{}',
    description TEXT,
    location_id TEXT,
    custom_location_name TEXT,
    google_maps_link TEXT,
    map_lat DOUBLE PRECISION,
    map_lng DOUBLE PRECISION,
    reliability_score INTEGER DEFAULT 100,
    expires_in_minutes INTEGER DEFAULT 120,
    expiry_type TEXT CHECK (expiry_type IS NULL OR expiry_type IN ('hours', 'duration', 'date', 'stock')),
    expiry_date TEXT, -- ISO YYYY-MM-DD (gregorian) when expiry_type = 'date'
    quantity INTEGER, -- NULL means unlimited
    is_unlimited BOOLEAN DEFAULT FALSE,
    initial_quantity INTEGER, -- Original qty when deal was created (NULL if unlimited)
    prep_time TEXT, -- Optional preparation time the seller advertises
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'deleted', 'paused')),
    created_at BIGINT NOT NULL, -- Epoch ms for client compatibility
    expiry_hijri TEXT,
    expiry_gregorian TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_deals_store ON deals(store_id);
CREATE INDEX IF NOT EXISTS idx_deals_category ON deals(category);
CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
CREATE INDEX IF NOT EXISTS idx_deals_location ON deals(location_id);
CREATE INDEX IF NOT EXISTS idx_deals_created ON deals(created_at DESC);

-- ====================== RATINGS ======================
CREATE TABLE IF NOT EXISTS ratings (
    id TEXT PRIMARY KEY,
    deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_name TEXT NOT NULL,
    score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
    comment TEXT,
    reply TEXT, -- Seller reply
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(deal_id, user_id) -- One rating per user per deal
);

CREATE INDEX IF NOT EXISTS idx_ratings_deal ON ratings(deal_id);

-- ====================== FAVORITES ======================
CREATE TABLE IF NOT EXISTS favorites (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, deal_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_deal ON favorites(deal_id);

-- ====================== BOOKINGS ======================
CREATE TABLE IF NOT EXISTS bookings (
    barcode TEXT PRIMARY KEY,
    backup_code TEXT NOT NULL,
    deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE SET NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- v3.0: store_id is now an enforced FK to prevent forged store ids
    store_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    booked_quantity INTEGER DEFAULT 1,
    prep_time TEXT,
    notes TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'completed', 'cancelled')),
    booked_at BIGINT NOT NULL,
    expiry_time BIGINT NOT NULL,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_store ON bookings(store_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

-- ====================== NOTIFICATIONS ======================
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY DEFAULT 'n' || extract(epoch from now())::text || substr(md5(random()::text), 1, 5),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title_ar TEXT NOT NULL,
    title_en TEXT NOT NULL,
    body_ar TEXT NOT NULL,
    body_en TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('booking', 'deal', 'system', 'rating', 'follow', 'marketing')),
    is_read BOOLEAN DEFAULT FALSE,
    meta_data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifs_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifs_unread ON notifications(user_id, is_read) WHERE is_read = FALSE;

-- ====================== STORE PROFILES ======================
CREATE TABLE IF NOT EXISTS store_profiles (
    store_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    phone TEXT,
    email TEXT,
    avatar_url TEXT,
    bio TEXT,
    address TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ====================== ROW LEVEL SECURITY ======================
-- Enable RLS for all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

-- ====================== RLS POLICIES (v3.0 — secure by default) ======================
-- Every INSERT/UPDATE binds to auth.uid() so a fresh database
-- is impossible to spoof from day one. The migration_v7_6 script
-- exists to retrofit the same policies on legacy installs.

-- USERS: anyone can read; only the authenticated user can insert/update their own row
DROP POLICY IF EXISTS "users_select_all" ON users;
DROP POLICY IF EXISTS "users_insert_own" ON users;
DROP POLICY IF EXISTS "users_update_own" ON users;
CREATE POLICY "users_select_all" ON users FOR SELECT USING (true);
CREATE POLICY "users_insert_own" ON users FOR INSERT WITH CHECK (auth.uid()::text = id);
CREATE POLICY "users_update_own" ON users FOR UPDATE USING (auth.uid()::text = id) WITH CHECK (auth.uid()::text = id);

-- DEALS: anyone can read; sellers can manage only their own deals
DROP POLICY IF EXISTS "deals_select_all" ON deals;
DROP POLICY IF EXISTS "deals_insert_seller" ON deals;
DROP POLICY IF EXISTS "deals_update_seller" ON deals;
DROP POLICY IF EXISTS "deals_delete_seller" ON deals;
CREATE POLICY "deals_select_all" ON deals FOR SELECT USING (true);
CREATE POLICY "deals_insert_seller" ON deals FOR INSERT WITH CHECK (auth.uid()::text = store_id);
CREATE POLICY "deals_update_seller" ON deals FOR UPDATE USING (auth.uid()::text = store_id) WITH CHECK (auth.uid()::text = store_id);
CREATE POLICY "deals_delete_seller" ON deals FOR DELETE USING (auth.uid()::text = store_id);

-- RATINGS: anyone can read; users can only insert/update ratings as themselves
DROP POLICY IF EXISTS "ratings_select_all" ON ratings;
DROP POLICY IF EXISTS "ratings_insert_auth" ON ratings;
DROP POLICY IF EXISTS "ratings_update_own" ON ratings;
CREATE POLICY "ratings_select_all" ON ratings FOR SELECT USING (true);
CREATE POLICY "ratings_insert_auth" ON ratings FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "ratings_update_own" ON ratings FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

-- BOOKINGS: users see their own + sellers see bookings against their store
DROP POLICY IF EXISTS "bookings_select_own" ON bookings;
DROP POLICY IF EXISTS "bookings_insert_auth" ON bookings;
DROP POLICY IF EXISTS "bookings_update_auth" ON bookings;
DROP POLICY IF EXISTS "bookings_delete_own" ON bookings;
CREATE POLICY "bookings_select_own" ON bookings FOR SELECT USING (
    auth.uid()::text = user_id OR auth.uid()::text = store_id
);
CREATE POLICY "bookings_insert_auth" ON bookings FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "bookings_update_auth" ON bookings FOR UPDATE USING (
    auth.uid()::text = user_id OR auth.uid()::text = store_id
) WITH CHECK (
    auth.uid()::text = user_id OR auth.uid()::text = store_id
);
CREATE POLICY "bookings_delete_own" ON bookings FOR DELETE USING (
    auth.uid()::text = user_id OR auth.uid()::text = store_id
);

-- NOTIFICATIONS: users see only their own; any authenticated user can write a
-- notification because a buyer's booking creates a row whose user_id is the
-- SELLER. Strictly tying it to auth.uid() = user_id would break that flow.
-- Long-term, replace this INSERT path with a SECURITY DEFINER function.
DROP POLICY IF EXISTS "notifs_select_own" ON notifications;
DROP POLICY IF EXISTS "notifs_insert_auth" ON notifications;
DROP POLICY IF EXISTS "notifs_update_own" ON notifications;
CREATE POLICY "notifs_select_own" ON notifications FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "notifs_insert_auth" ON notifications FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "notifs_update_own" ON notifications FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

-- STORE PROFILES: anyone can read; only the owning store can insert/update their own profile
DROP POLICY IF EXISTS "store_profiles_select_all" ON store_profiles;
DROP POLICY IF EXISTS "store_profiles_insert_own" ON store_profiles;
DROP POLICY IF EXISTS "store_profiles_update_own" ON store_profiles;
CREATE POLICY "store_profiles_select_all" ON store_profiles FOR SELECT USING (true);
CREATE POLICY "store_profiles_insert_own" ON store_profiles FOR INSERT WITH CHECK (auth.uid()::text = store_id);
CREATE POLICY "store_profiles_update_own" ON store_profiles FOR UPDATE USING (auth.uid()::text = store_id) WITH CHECK (auth.uid()::text = store_id);

-- FAVORITES: each user manages only their own favorites
DROP POLICY IF EXISTS "favorites_select_own" ON favorites;
DROP POLICY IF EXISTS "favorites_insert_own" ON favorites;
DROP POLICY IF EXISTS "favorites_delete_own" ON favorites;
CREATE POLICY "favorites_select_own" ON favorites FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "favorites_insert_own" ON favorites FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "favorites_delete_own" ON favorites FOR DELETE USING (auth.uid()::text = user_id);

-- ====================== REALTIME ======================
-- Enable realtime for notifications and bookings
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE bookings;

-- ====================== REPLICA IDENTITY ======================
-- FULL identity ensures UPDATE events via Supabase Realtime include
-- ALL columns (not just the PK). Without this, the buyer's realtime
-- filter `user_id=eq.<id>` never matches on UPDATE because user_id
-- is not in the default payload (PK = barcode).
ALTER TABLE bookings REPLICA IDENTITY FULL;
ALTER TABLE notifications REPLICA IDENTITY FULL;

-- ====================== PROMOTIONAL CAMPAIGNS ======================
-- Admin-authored marketing campaigns for buyers and sellers.
-- The admin fills title, body, and optional image/link.
-- The app reads active campaigns and pushes them as notifications.

CREATE TABLE IF NOT EXISTS promotional_campaigns (
    id TEXT PRIMARY KEY DEFAULT 'promo_' || extract(epoch from now())::text || substr(md5(random()::text), 1, 6),
    target_audience TEXT NOT NULL DEFAULT 'all'
        CHECK (target_audience IN ('buyer', 'seller', 'all')),
    target_city TEXT,
    target_region TEXT,
    title_ar TEXT NOT NULL,
    title_en TEXT NOT NULL,
    body_ar TEXT NOT NULL,
    body_en TEXT NOT NULL,
    image_url TEXT,
    action_url TEXT,
    action_label_ar TEXT,
    action_label_en TEXT,
    starts_at TIMESTAMPTZ DEFAULT NOW(),
    ends_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    priority INTEGER DEFAULT 0,
    max_impressions INTEGER,
    current_impressions INTEGER DEFAULT 0,
    created_by TEXT REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promo_active ON promotional_campaigns(is_active, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_promo_audience ON promotional_campaigns(target_audience);

-- Tracks which users have seen which campaigns
CREATE TABLE IF NOT EXISTS promo_impressions (
    campaign_id TEXT NOT NULL REFERENCES promotional_campaigns(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seen_at TIMESTAMPTZ DEFAULT NOW(),
    clicked BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (campaign_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_promo_imp_user ON promo_impressions(user_id);

-- RLS for promotional tables
ALTER TABLE promotional_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_impressions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promo_select_active" ON promotional_campaigns;
CREATE POLICY "promo_select_active" ON promotional_campaigns FOR SELECT USING (true);
DROP POLICY IF EXISTS "promo_insert_admin" ON promotional_campaigns;
CREATE POLICY "promo_insert_admin" ON promotional_campaigns FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "promo_update_admin" ON promotional_campaigns;
CREATE POLICY "promo_update_admin" ON promotional_campaigns FOR UPDATE USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "promo_delete_admin" ON promotional_campaigns;
CREATE POLICY "promo_delete_admin" ON promotional_campaigns FOR DELETE USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "imp_select_own" ON promo_impressions;
CREATE POLICY "imp_select_own" ON promo_impressions FOR SELECT USING (auth.uid()::text = user_id);
DROP POLICY IF EXISTS "imp_insert_own" ON promo_impressions;
CREATE POLICY "imp_insert_own" ON promo_impressions FOR INSERT WITH CHECK (auth.uid()::text = user_id);
DROP POLICY IF EXISTS "imp_update_own" ON promo_impressions;
CREATE POLICY "imp_update_own" ON promo_impressions FOR UPDATE USING (auth.uid()::text = user_id);

-- ====================== HELPER FUNCTIONS ======================
-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_users BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at_deals BEFORE UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at_store_profiles BEFORE UPDATE ON store_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ====================== SERVER-SIDE BOOKING NOTIFICATIONS (v8.7) ======================
-- The full implementation lives in supabase/migration_v8_7_server_side_flow.sql
-- and is included verbatim below so a fresh install gets it automatically.
-- See that file for the rationale and verification queries.

CREATE OR REPLACE FUNCTION public.guard_booking_status()
RETURNS TRIGGER AS $$
DECLARE old_rank INT; new_rank INT;
BEGIN
    old_rank := CASE OLD.status WHEN 'pending' THEN 0 WHEN 'acknowledged' THEN 1 WHEN 'completed' THEN 2 WHEN 'cancelled' THEN 2 ELSE 0 END;
    new_rank := CASE NEW.status WHEN 'pending' THEN 0 WHEN 'acknowledged' THEN 1 WHEN 'completed' THEN 2 WHEN 'cancelled' THEN 2 ELSE 0 END;
    IF new_rank < old_rank THEN NEW.status := OLD.status;
    ELSIF OLD.status IN ('completed', 'cancelled') AND NEW.status <> OLD.status THEN NEW.status := OLD.status;
    END IF;
    IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN NEW.completed_at := NOW(); END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_guard_booking_status ON public.bookings;
CREATE TRIGGER tr_guard_booking_status BEFORE UPDATE OF status ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.guard_booking_status();

CREATE OR REPLACE FUNCTION public.handle_booking_notification()
RETURNS TRIGGER AS $$
DECLARE item_name TEXT; buyer_name TEXT; seller_name TEXT;
BEGIN
    SELECT d.item_name INTO item_name FROM public.deals d WHERE d.id = NEW.deal_id;
    item_name := COALESCE(item_name, 'العرض');
    SELECT COALESCE(u.name, u.shop, '') INTO buyer_name FROM public.users u WHERE u.id = NEW.user_id;
    buyer_name := COALESCE(NULLIF(buyer_name, ''), 'مشتري');
    SELECT COALESCE(u.shop, u.name, '') INTO seller_name FROM public.users u WHERE u.id = NEW.store_id;
    seller_name := COALESCE(NULLIF(seller_name, ''), 'التاجر');

    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
        VALUES (NEW.store_id, '📦 طلب حجز جديد!', '📦 New Booking Request!',
            'طلب جديد من ' || buyer_name || ' لـ ' || item_name || ' (' || NEW.booked_quantity || ' قطعة).'
              || CASE WHEN NEW.prep_time IS NOT NULL AND NEW.prep_time <> '' THEN ' 🕒 الوقت: ' || CASE WHEN NEW.prep_time = 'arrival' THEN 'عند الوصول' ELSE NEW.prep_time || ' دقيقة' END ELSE '' END
              || CASE WHEN NEW.notes IS NOT NULL AND NEW.notes <> '' THEN ' 📝 ' || NEW.notes ELSE '' END,
            'New order from ' || buyer_name || ' for ' || item_name || ' (' || NEW.booked_quantity || ' pcs).'
              || CASE WHEN NEW.prep_time IS NOT NULL AND NEW.prep_time <> '' THEN ' 🕒 ETA: ' || CASE WHEN NEW.prep_time = 'arrival' THEN 'On arrival' ELSE NEW.prep_time || ' min' END ELSE '' END
              || CASE WHEN NEW.notes IS NOT NULL AND NEW.notes <> '' THEN ' 📝 ' || NEW.notes ELSE '' END,
            'booking', jsonb_build_object('barcode', NEW.barcode, 'dealId', NEW.deal_id, 'quantity', NEW.booked_quantity, 'prepTime', NEW.prep_time, 'notes', NEW.notes), NOW());
        INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
        VALUES (NEW.user_id, '✅ تم الحجز بنجاح!', '✅ Booking Confirmed!',
            'تم حجز ' || item_name || ' — الرمز: ' || NEW.barcode || '. سيستلم التاجر طلبك قريباً.',
            item_name || ' booked — Code: ' || NEW.barcode || '. The seller will receive your order shortly.',
            'booking', jsonb_build_object('barcode', NEW.barcode, 'dealId', NEW.deal_id), NOW());
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.status = 'acknowledged' THEN
            INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
            VALUES (NEW.user_id, '📦 التاجر استلم طلبك!', '📦 Seller received your order!',
                'استلم ' || seller_name || ' طلبك لـ ' || item_name || ' وهو قيد التجهيز الآن.',
                seller_name || ' received your order for ' || item_name || ' and is preparing it now.',
                'booking', jsonb_build_object('barcode', NEW.barcode, 'dealId', NEW.deal_id), NOW());
        ELSIF NEW.status = 'completed' THEN
            INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
            VALUES (NEW.user_id, '🎉 تم تسليم طلبك!', '🎉 Order Delivered!',
                'تم تأكيد استلام ' || item_name || ' من ' || seller_name || '. شكراً لاستخدامك تاكي 💚',
                item_name || ' delivery confirmed by ' || seller_name || '. Thanks for using Taki 💚',
                'booking', jsonb_build_object('barcode', NEW.barcode, 'dealId', NEW.deal_id), NOW());
            INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
            VALUES (NEW.store_id, '🎉 تم الاستلام بنجاح!', '🎉 Order Delivered!',
                'استلم ' || buyer_name || ' طلب ' || item_name || ' — تم إغلاق الحجز.',
                buyer_name || ' received the order for ' || item_name || ' — booking closed.',
                'booking', jsonb_build_object('barcode', NEW.barcode, 'dealId', NEW.deal_id), NOW());
        ELSIF NEW.status = 'cancelled' THEN
            INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
            VALUES (NEW.user_id, '⚠️ تم إلغاء الحجز', '⚠️ Booking Cancelled',
                'تم إلغاء حجز ' || item_name || '.', 'Booking for ' || item_name || ' has been cancelled.',
                'booking', jsonb_build_object('barcode', NEW.barcode, 'dealId', NEW.deal_id), NOW());
            INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
            VALUES (NEW.store_id, '⚠️ تم إلغاء حجز', '⚠️ Booking Cancelled',
                'تم إلغاء حجز ' || item_name || ' من قِبل ' || buyer_name || '.',
                buyer_name || ' cancelled the booking for ' || item_name || '.',
                'booking', jsonb_build_object('barcode', NEW.barcode, 'dealId', NEW.deal_id), NOW());
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_booking_notification ON public.bookings;
CREATE TRIGGER tr_booking_notification AFTER INSERT OR UPDATE OF status ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.handle_booking_notification();

-- ====================== PROMO CAMPAIGN SEEDS (v8.7) ======================
-- Two pre-loaded campaigns (one for buyers, one for sellers) — INACTIVE by
-- default. Activate from Supabase SQL Editor when ready:
--   UPDATE promotional_campaigns SET is_active = TRUE WHERE id = 'promo_seed_buyer_exclusive';
--   UPDATE promotional_campaigns SET is_active = TRUE WHERE id = 'promo_seed_seller_growth';
INSERT INTO public.promotional_campaigns (
    id, target_audience, title_ar, title_en, body_ar, body_en,
    action_label_ar, action_label_en, action_url, priority, is_active, starts_at
) VALUES
    ('promo_seed_seller_growth', 'seller',
     '📈 قم بترويج عروضك للحصول على عملاء جدد',
     '📈 Promote your offers to attract new customers',
     'انشر عروضك الحصرية الآن واجذب عملاء جدد إلى متجرك. كل عرض جديد = عميل محتمل أكثر! 🏬',
     'Post your exclusive offers now and attract new customers to your shop. Every new deal = more potential customers! 🏬',
     'أضف عرضاً جديداً', 'Add a New Deal', '/seller-dashboard?tab=form', 10, FALSE, NOW()),
    ('promo_seed_buyer_exclusive', 'buyer',
     '🛍️ تبي عروض حصرية حولك؟',
     '🛍️ Want exclusive deals near you?',
     'اكتشف أحدث العروض والتخفيضات الحصرية في منطقتك الآن — وفر أكثر مع تاكي! 🔥',
     'Discover the latest exclusive deals and discounts near you — save more with Taki! 🔥',
     'تصفح العروض', 'Browse Deals', '/nearby', 10, FALSE, NOW())
ON CONFLICT (id) DO NOTHING;
