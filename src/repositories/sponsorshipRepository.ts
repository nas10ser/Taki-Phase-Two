/**
 * Sponsorship Repository — server-only data access for sponsored deals,
 * native ads, top-slider banners, inline banners and pinned stores.
 */
import { supabase } from '../services/supabaseClient';
import { logger } from '../utils/logger';

export type SponsorshipType =
    | 'sponsored_deal' | 'native_ad' | 'top_slider'
    | 'inline_banner' | 'verified_badge';

export interface Sponsorship {
    id: string;
    merchantId?: string;
    dealId?: string;
    type: SponsorshipType;
    targetAudience?: 'buyer' | 'seller' | 'all';
    targetRegion?: string;
    targetCity?: string;
    targetMall?: string;
    badgeLabelAr: string;
    badgeLabelEn: string;
    titleAr?: string;
    titleEn?: string;
    bodyAr?: string;
    bodyEn?: string;
    imageUrl?: string;
    actionUrl?: string;
    ctaLabelAr?: string;
    ctaLabelEn?: string;
    startsAt: string;
    endsAt?: string;
    priority: number;
    isActive: boolean;
    impressions: number;
    clicks: number;
    insertionInterval: number;
    createdBy?: string;
    createdAt: string;
}

export interface PinnedStore {
    id: string;
    storeId: string;
    targetRegion?: string;
    targetCity?: string;
    targetMall?: string;
    rank: number;
    startsAt: string;
    endsAt?: string;
    contractReference?: string;
    notes?: string;
    isActive: boolean;
    createdBy?: string;
    createdAt: string;
}

const mapSpn = (r: any): Sponsorship => ({
    id: r.id,
    merchantId: r.merchant_id,
    dealId: r.deal_id,
    type: r.type,
    targetAudience: r.target_audience,
    targetRegion: r.target_region,
    targetCity: r.target_city,
    targetMall: r.target_mall,
    badgeLabelAr: r.badge_label_ar || 'برعاية',
    badgeLabelEn: r.badge_label_en || 'Sponsored',
    titleAr: r.title_ar,
    titleEn: r.title_en,
    bodyAr: r.body_ar,
    bodyEn: r.body_en,
    imageUrl: r.image_url,
    actionUrl: r.action_url,
    ctaLabelAr: r.cta_label_ar,
    ctaLabelEn: r.cta_label_en,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    priority: r.priority || 0,
    isActive: !!r.is_active,
    impressions: r.impressions || 0,
    clicks: r.clicks || 0,
    insertionInterval: r.insertion_interval || 4,
    createdBy: r.created_by,
    createdAt: r.created_at
});

const mapPin = (r: any): PinnedStore => ({
    id: r.id,
    storeId: r.store_id,
    targetRegion: r.target_region,
    targetCity: r.target_city,
    targetMall: r.target_mall,
    rank: r.rank || 0,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    contractReference: r.contract_reference,
    notes: r.notes,
    isActive: !!r.is_active,
    createdBy: r.created_by,
    createdAt: r.created_at
});

export const sponsorshipRepository = {
    /** Active sponsorships of any type, filtered by scope, ordered by priority. */
    listActive: async (filters?: {
        type?: SponsorshipType | SponsorshipType[];
        city?: string;
        mall?: string;
    }): Promise<Sponsorship[]> => {
        let q = supabase
            .from('sponsorships')
            .select('*')
            .eq('is_active', true)
            .lte('starts_at', new Date().toISOString())
            .order('priority', { ascending: false });

        if (filters?.type) {
            if (Array.isArray(filters.type)) q = q.in('type', filters.type);
            else q = q.eq('type', filters.type);
        }

        const { data, error } = await q;
        if (error) {
            logger.warn('listActive sponsorships failed:', error.message);
            return [];
        }

        const now = new Date();
        return (data || [])
            .filter(r => !r.ends_at || new Date(r.ends_at) > now)
            .filter(r => !r.target_city || !filters?.city || r.target_city === filters.city)
            .filter(r => !r.target_mall || !filters?.mall || r.target_mall === filters.mall)
            .map(mapSpn);
    },

    /** Admin: full list. */
    listAll: async (): Promise<Sponsorship[]> => {
        const { data, error } = await supabase
            .from('sponsorships')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) {
            logger.warn('listAll sponsorships failed:', error.message);
            return [];
        }
        return (data || []).map(mapSpn);
    },

    create: async (input: Partial<Sponsorship> & { type: SponsorshipType; createdBy: string }): Promise<Sponsorship> => {
        const { data, error } = await supabase
            .from('sponsorships')
            .insert({
                merchant_id: input.merchantId || null,
                deal_id: input.dealId || null,
                type: input.type,
                target_audience: input.targetAudience || 'all',
                target_region: input.targetRegion || null,
                target_city: input.targetCity || null,
                target_mall: input.targetMall || null,
                badge_label_ar: input.badgeLabelAr || 'برعاية',
                badge_label_en: input.badgeLabelEn || 'Sponsored',
                title_ar: input.titleAr || null,
                title_en: input.titleEn || null,
                body_ar: input.bodyAr || null,
                body_en: input.bodyEn || null,
                image_url: input.imageUrl || null,
                action_url: input.actionUrl || null,
                cta_label_ar: input.ctaLabelAr || null,
                cta_label_en: input.ctaLabelEn || null,
                starts_at: input.startsAt || new Date().toISOString(),
                ends_at: input.endsAt || null,
                priority: input.priority ?? 0,
                is_active: input.isActive !== false,
                insertion_interval: input.insertionInterval ?? 4,
                created_by: input.createdBy
            })
            .select()
            .single();
        if (error) throw error;
        return mapSpn(data);
    },

    update: async (id: string, patch: Partial<Sponsorship>): Promise<void> => {
        const dbPatch: Record<string, any> = {};
        const map: Record<string, string> = {
            merchantId: 'merchant_id',
            dealId: 'deal_id',
            targetAudience: 'target_audience',
            targetRegion: 'target_region',
            targetCity: 'target_city',
            targetMall: 'target_mall',
            badgeLabelAr: 'badge_label_ar',
            badgeLabelEn: 'badge_label_en',
            titleAr: 'title_ar',
            titleEn: 'title_en',
            bodyAr: 'body_ar',
            bodyEn: 'body_en',
            imageUrl: 'image_url',
            actionUrl: 'action_url',
            ctaLabelAr: 'cta_label_ar',
            ctaLabelEn: 'cta_label_en',
            startsAt: 'starts_at',
            endsAt: 'ends_at',
            priority: 'priority',
            isActive: 'is_active',
            insertionInterval: 'insertion_interval'
        };
        for (const [k, v] of Object.entries(patch)) {
            if (map[k] !== undefined) dbPatch[map[k]] = v;
        }
        const { error } = await supabase.from('sponsorships').update(dbPatch).eq('id', id);
        if (error) throw error;
    },

    delete: async (id: string): Promise<void> => {
        const { error } = await supabase.from('sponsorships').delete().eq('id', id);
        if (error) throw error;
    },

    /** Atomic increment via SECURITY DEFINER RPC — works for anon visitors too. */
    trackImpression: async (id: string): Promise<void> => {
        await supabase.rpc('increment_sponsorship_metric', { p_id: id, p_metric: 'impression' });
    },

    trackClick: async (id: string): Promise<void> => {
        await supabase.rpc('increment_sponsorship_metric', { p_id: id, p_metric: 'click' });
    }
};

export const pinnedStoreRepository = {
    listAll: async (): Promise<PinnedStore[]> => {
        const { data, error } = await supabase
            .from('pinned_stores')
            .select('*')
            .order('rank', { ascending: true });
        if (error) {
            logger.warn('pinned_stores listAll failed:', error.message);
            return [];
        }
        return (data || []).map(mapPin);
    },

    listForScope: async (city?: string, mall?: string): Promise<PinnedStore[]> => {
        const { data, error } = await supabase
            .from('pinned_stores')
            .select('*')
            .eq('is_active', true)
            .order('rank', { ascending: true });
        if (error) return [];
        const now = new Date();
        return (data || [])
            .filter(r => !r.ends_at || new Date(r.ends_at) > now)
            .filter(r => !r.target_city || !city || r.target_city === city)
            .filter(r => !r.target_mall || !mall || r.target_mall === mall)
            .map(mapPin);
    },

    pinIds: async (city?: string, mall?: string): Promise<string[]> => {
        const { data, error } = await supabase.rpc('get_pinned_store_ids', {
            p_city: city || null,
            p_mall: mall || null
        });
        if (error) return [];
        return Array.isArray(data) ? (data as string[]) : [];
    },

    create: async (input: Omit<PinnedStore, 'id' | 'createdAt' | 'isActive'> & {
        isActive?: boolean;
    }): Promise<PinnedStore> => {
        const { data, error } = await supabase
            .from('pinned_stores')
            .insert({
                store_id: input.storeId,
                target_region: input.targetRegion || null,
                target_city: input.targetCity || null,
                target_mall: input.targetMall || null,
                rank: input.rank ?? 0,
                starts_at: input.startsAt || new Date().toISOString(),
                ends_at: input.endsAt || null,
                contract_reference: input.contractReference || null,
                notes: input.notes || null,
                is_active: input.isActive !== false,
                created_by: input.createdBy || null
            })
            .select()
            .single();
        if (error) throw error;
        return mapPin(data);
    },

    update: async (id: string, patch: Partial<PinnedStore>): Promise<void> => {
        const dbPatch: Record<string, any> = {};
        const map: Record<string, string> = {
            storeId: 'store_id',
            targetRegion: 'target_region',
            targetCity: 'target_city',
            targetMall: 'target_mall',
            rank: 'rank',
            startsAt: 'starts_at',
            endsAt: 'ends_at',
            contractReference: 'contract_reference',
            notes: 'notes',
            isActive: 'is_active'
        };
        for (const [k, v] of Object.entries(patch)) {
            if (map[k] !== undefined) dbPatch[map[k]] = v;
        }
        const { error } = await supabase.from('pinned_stores').update(dbPatch).eq('id', id);
        if (error) throw error;
    },

    delete: async (id: string): Promise<void> => {
        const { error } = await supabase.from('pinned_stores').delete().eq('id', id);
        if (error) throw error;
    }
};
