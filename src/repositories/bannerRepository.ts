import { supabase } from '../services/supabaseClient';

export type DisplayType = 'image' | 'text' | 'both';

export interface Banner {
    id: string;
    title_ar?: string;
    title_en?: string;
    text_ar?: string;
    text_en?: string;
    image_url?: string;
    bg_color?: string;
    display_type: DisplayType;
    target_url?: string;
    deal_id?: string;
    store_id?: string;
    position: string;
    is_active: boolean;
    display_order: number;
    publish_at?: string;
    expires_at?: string;
    created_at?: string;
}

export interface BannerSlot {
    slot_key: string;
    label_ar: string;
    label_en: string;
    max_banners: number;
    is_enabled: boolean;
    description?: string;
}

export const bannerRepository = {
    // Public read — only banners that should be live right now in the given slot.
    async getActive(position: string = 'home_top'): Promise<Banner[]> {
        // Master switch first — saves a query when banners are globally off
        const enabled = await bannerRepository.getMasterEnabled();
        if (!enabled) return [];

        const nowIso = new Date().toISOString();
        const { data, error } = await supabase
            .from('banners')
            .select('*')
            .eq('is_active', true)
            .eq('position', position)
            .lte('publish_at', nowIso)
            .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
            .order('display_order', { ascending: true });

        if (error) {
            // Table missing or RLS issue — fail silently so the page still renders.
            console.warn('[banners] getActive failed:', error.message);
            return [];
        }
        return data || [];
    },

    // Admin read — all banners regardless of schedule/active state.
    async getAll(): Promise<Banner[]> {
        const { data, error } = await supabase
            .from('banners')
            .select('*')
            .order('position', { ascending: true })
            .order('display_order', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    async create(banner: Partial<Banner>): Promise<Banner> {
        const { data, error } = await supabase
            .from('banners')
            .insert(banner)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async update(id: string, patch: Partial<Banner>): Promise<Banner> {
        const { data, error } = await supabase
            .from('banners')
            .update(patch)
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async remove(id: string): Promise<void> {
        const { error } = await supabase.from('banners').delete().eq('id', id);
        if (error) throw error;
    },

    // Bulk: flip is_active on many at once.
    async setActiveBulk(ids: string[], isActive: boolean): Promise<void> {
        if (ids.length === 0) return;
        const { error } = await supabase
            .from('banners')
            .update({ is_active: isActive })
            .in('id', ids);
        if (error) throw error;
    },

    async removeBulk(ids: string[]): Promise<void> {
        if (ids.length === 0) return;
        const { error } = await supabase.from('banners').delete().in('id', ids);
        if (error) throw error;
    },

    // ---------- Slots ----------
    async getSlots(): Promise<BannerSlot[]> {
        const { data, error } = await supabase
            .from('banner_slots')
            .select('*')
            .order('slot_key', { ascending: true });
        if (error) {
            console.warn('[banners] getSlots failed:', error.message);
            return [];
        }
        return data || [];
    },

    async updateSlot(slot_key: string, patch: Partial<BannerSlot>): Promise<void> {
        const { error } = await supabase
            .from('banner_slots')
            .update(patch)
            .eq('slot_key', slot_key);
        if (error) throw error;
    },

    // ---------- Master switch (platform_settings.banners_enabled) ----------
    async getMasterEnabled(): Promise<boolean> {
        const { data, error } = await supabase
            .from('platform_settings')
            .select('value')
            .eq('key', 'banners_enabled')
            .maybeSingle();
        if (error || !data) return true; // default: enabled if setting missing
        return data.value === true || data.value === 'true';
    },

    async setMasterEnabled(enabled: boolean): Promise<void> {
        const { error } = await supabase
            .from('platform_settings')
            .upsert({ key: 'banners_enabled', value: enabled }, { onConflict: 'key' });
        if (error) throw error;
    }
};
