-- Migration v14: Premium Banner System
-- This migration adds support for a top-level banner/slider system for featured content.

DROP TABLE IF EXISTS banners CASCADE;

CREATE TABLE IF NOT EXISTS banners (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title_ar TEXT,
    title_en TEXT,
    image_url TEXT NOT NULL,
    target_url TEXT, -- External link or internal route
    deal_id TEXT REFERENCES deals(id) ON DELETE SET NULL,
    store_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    position TEXT DEFAULT 'home_top', -- 'home_top', 'category_top', etc.
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE banners ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Public can view active banners" ON banners
    FOR SELECT USING (is_active = true AND (expires_at IS NULL OR expires_at > NOW()));

CREATE POLICY "Admins have full access to banners" ON banners
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid()::text AND user_type = 'admin'
        )
    );

-- Index for performance
CREATE INDEX idx_banners_active_position ON banners(is_active, position, display_order);
