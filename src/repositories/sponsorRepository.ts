/**
 * Sponsor Repository (v11.23) — Official Sponsors (راعٍ رسمي).
 *
 * Read path: any client loads the active sponsors to render gold ads.
 * Write path: admin-only, routed through SECURITY DEFINER RPCs so RLS on
 * `sponsors` never has to self-reference.
 */
import { supabase } from '../services/supabaseClient';
import { Sponsor } from '../utils/helpers';
import { logger } from '../utils/logger';

const mapRow = (r: any): Sponsor => ({
    storeId: r.store_id,
    isActive: r.is_active ?? true,
    targetCategory: r.target_category ?? null,
    targetCity: r.target_city ?? null,
    targetRegion: r.target_region ?? null,
    targetLat: r.target_lat ?? null,
    targetLng: r.target_lng ?? null,
    targetRadiusKm: r.target_radius_km ?? null,
    priority: r.priority ?? 0,
    labelType: (r.label_type ?? 'ad'),
    startsAt: r.starts_at ?? null,
    expiresAt: r.expires_at ?? null,
});

export interface AdminSponsorRow extends Sponsor {
    storeName?: string;
    shop?: string;
    notes?: string | null;
}

export const sponsorRepository = {
    /**
     * Active, non-expired sponsors only. Used by every deal list to build the
     * gold-ad rotation. Cheap: one indexed scan, filtered to active rows.
     */
    getActive: async (): Promise<Sponsor[]> => {
        try {
            // NOTE: we deliberately do NOT use a PostgREST `.or(expires_at...)`
            // filter — an ISO timestamp contains ':' and '.' which break the
            // .or() mini-grammar and silently return nothing. Fetch active rows
            // and drop expired ones in JS (the active-sponsor set is tiny).
            const { data, error } = await supabase
                .from('sponsors')
                .select('*')
                .eq('is_active', true);
            if (error) throw error;
            const now = Date.now();
            return (data || [])
                .filter((r: any) => !r.expires_at || new Date(r.expires_at).getTime() > now)
                .map(mapRow);
        } catch (e) {
            console.warn('Failed to load sponsors:', e);
            return [];
        }
    },

    /** Admin: list every sponsor (active or not) with store name. */
    listAll: async (): Promise<AdminSponsorRow[]> => {
        const { data, error } = await supabase.rpc('admin_list_sponsors');
        if (error) {
            console.error('[sponsorRepository.listAll]', error);
            return [];
        }
        return (data || []).map((r: any) => ({
            ...mapRow(r),
            storeName: r.store_name,
            shop: r.shop,
            notes: r.notes ?? null,
        }));
    },

    /** Admin: grant / update a sponsorship. */
    set: async (p: {
        storeId: string;
        isActive?: boolean;
        targetCategory?: string | null;
        targetCity?: string | null;
        targetRegion?: string | null;
        targetLat?: number | null;
        targetLng?: number | null;
        targetRadiusKm?: number | null;
        priority?: number;
        startsAt?: string | null;
        expiresAt?: string | null;
        notes?: string | null;
        labelType?: 'ad' | 'sponsor' | 'none' | 'star';
    }): Promise<{ success: boolean; error?: string }> => {
        const { data, error } = await supabase.rpc('admin_set_sponsor', {
            p_store_id: p.storeId,
            p_is_active: p.isActive ?? true,
            p_target_category: p.targetCategory ?? null,
            p_target_city: p.targetCity ?? null,
            p_target_region: p.targetRegion ?? null,
            p_target_lat: p.targetLat ?? null,
            p_target_lng: p.targetLng ?? null,
            p_target_radius_km: p.targetRadiusKm ?? null,
            p_priority: p.priority ?? 0,
            p_expires_at: p.expiresAt ?? null,
            p_notes: p.notes ?? null,
            p_label_type: p.labelType ?? 'ad',
            p_starts_at: p.startsAt ?? null,
        });
        if (error) {
            console.error('[sponsorRepository.set]', error);
            return { success: false, error: error.message };
        }
        logger.log('✅ Sponsor saved');
        return { success: !!data?.success };
    },

    /** Admin: revoke a sponsorship. */
    remove: async (storeId: string): Promise<{ success: boolean; error?: string }> => {
        const { data, error } = await supabase.rpc('admin_remove_sponsor', { p_store_id: storeId });
        if (error) {
            console.error('[sponsorRepository.remove]', error);
            return { success: false, error: error.message };
        }
        return { success: !!data?.success };
    },
};
