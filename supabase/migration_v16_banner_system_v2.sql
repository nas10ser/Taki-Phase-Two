-- Migration v16: Banner System v2
-- Adds:
--   - Text-only banners (image_url nullable, text_ar/text_en, bg_color)
--   - Per-banner schedule (publish_at + expires_at)
--   - banner_slots table: defines allowed places + max banners per slot
--   - platform_settings entry "banners_enabled" = master kill switch
-- Backwards compatible: existing image-only banners keep working.

-- ====================== 1. EXTEND banners TABLE ======================

-- Allow text-only banners
ALTER TABLE banners ALTER COLUMN image_url DROP NOT NULL;

-- Text content (independent of image — banner can have either, or both)
ALTER TABLE banners ADD COLUMN IF NOT EXISTS text_ar TEXT;
ALTER TABLE banners ADD COLUMN IF NOT EXISTS text_en TEXT;

-- Background color for text-only banners (CSS hex/gradient string)
ALTER TABLE banners ADD COLUMN IF NOT EXISTS bg_color TEXT DEFAULT '#10b981';

-- Display type — drives the renderer:
--   'image' → image only (legacy, default for back-compat)
--   'text'  → text only on bg_color
--   'both'  → image with text overlay
ALTER TABLE banners ADD COLUMN IF NOT EXISTS display_type TEXT NOT NULL DEFAULT 'image'
    CHECK (display_type IN ('image','text','both'));

-- Schedule: when to start showing
ALTER TABLE banners ADD COLUMN IF NOT EXISTS publish_at TIMESTAMPTZ DEFAULT NOW();

-- Sanity: a banner must have something to render
ALTER TABLE banners DROP CONSTRAINT IF EXISTS banners_has_content;
ALTER TABLE banners ADD CONSTRAINT banners_has_content CHECK (
    image_url IS NOT NULL OR text_ar IS NOT NULL OR text_en IS NOT NULL
);

-- Replace the public SELECT policy to honour publish_at as well as expires_at
DROP POLICY IF EXISTS "Public can view active banners" ON banners;
CREATE POLICY "Public can view active banners" ON banners
    FOR SELECT USING (
        is_active = true
        AND (publish_at IS NULL OR publish_at <= NOW())
        AND (expires_at IS NULL OR expires_at > NOW())
    );

-- ====================== 2. banner_slots TABLE ======================
-- Defines the allowed positions and how many banners each can hold.
-- Slots are admin-curated — sellers cannot add new slot keys via the UI.

CREATE TABLE IF NOT EXISTS banner_slots (
    slot_key TEXT PRIMARY KEY,
    label_ar TEXT NOT NULL,
    label_en TEXT NOT NULL,
    max_banners INTEGER NOT NULL DEFAULT 5 CHECK (max_banners >= 0),
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE banner_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read slots" ON banner_slots;
CREATE POLICY "Public can read slots" ON banner_slots
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Admins manage slots" ON banner_slots;
CREATE POLICY "Admins manage slots" ON banner_slots
    FOR ALL USING (
        EXISTS (SELECT 1 FROM users WHERE id = auth.uid()::text AND user_type = 'admin')
    );

-- Seed default slots
INSERT INTO banner_slots (slot_key, label_ar, label_en, max_banners, description) VALUES
    ('home_top', 'أعلى الصفحة الرئيسية', 'Home — top',         5, 'Above the categories filter on /'),
    ('deal_top', 'أعلى صفحة العرض',       'Deal page — top',   3, 'Above the deal hero on /deal/:id')
ON CONFLICT (slot_key) DO NOTHING;

-- ====================== 3. MASTER KILL SWITCH ======================
INSERT INTO platform_settings (key, value, description) VALUES
    ('banners_enabled', 'true'::jsonb, 'Global on/off switch for the banner system')
ON CONFLICT (key) DO NOTHING;

-- ====================== 4. INDEX FOR FAST FRONTEND QUERIES ======================
DROP INDEX IF EXISTS idx_banners_active_position;
CREATE INDEX IF NOT EXISTS idx_banners_visible
    ON banners(position, display_order)
    WHERE is_active = TRUE;
