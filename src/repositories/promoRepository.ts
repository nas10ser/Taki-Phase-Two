/**
 * Promo Repository — Data access layer for promotional campaigns.
 * Reads campaigns from Supabase and tracks user impressions.
 */
import { supabase } from '../services/supabaseClient';
import { logger } from '../utils/logger';

export interface PromoCampaign {
    id: string;
    targetAudience: 'buyer' | 'seller' | 'all';
    targetCity?: string;
    targetRegion?: string;
    titleAr: string;
    titleEn: string;
    bodyAr: string;
    bodyEn: string;
    imageUrl?: string;
    actionUrl?: string;
    actionLabelAr?: string;
    actionLabelEn?: string;
    startsAt: string;
    endsAt?: string;
    isActive: boolean;
    priority: number;
    createdAt: string;
}

export const promoRepository = {
    /**
     * Fetch active campaigns for a specific user type and optional city.
     * Returns campaigns sorted by priority (highest first).
     */
    getActiveCampaigns: async (
        userType: 'buyer' | 'seller',
        city?: string
    ): Promise<PromoCampaign[]> => {
        try {
            let query = supabase
                .from('promotional_campaigns')
                .select('*')
                .eq('is_active', true)
                .lte('starts_at', new Date().toISOString())
                .order('priority', { ascending: false });

            // Filter by audience: show campaigns for this user type or 'all'
            query = query.or(`target_audience.eq.${userType},target_audience.eq.all`);

            const { data, error } = await query;
            if (error) throw error;

            if (!data || data.length === 0) return [];

            // Filter by end date client-side (easier than complex SQL with nullable ends_at)
            const now = new Date();
            const activeCampaigns = data.filter((c: any) => {
                if (!c.ends_at) return true; // No end date = always active
                return new Date(c.ends_at) > now;
            });

            // Filter by city if specified
            const filtered = city
                ? activeCampaigns.filter((c: any) => !c.target_city || c.target_city === city)
                : activeCampaigns;

            return filtered.map((c: any) => ({
                id: c.id,
                targetAudience: c.target_audience,
                targetCity: c.target_city,
                targetRegion: c.target_region,
                titleAr: c.title_ar,
                titleEn: c.title_en,
                bodyAr: c.body_ar,
                bodyEn: c.body_en,
                imageUrl: c.image_url,
                actionUrl: c.action_url,
                actionLabelAr: c.action_label_ar,
                actionLabelEn: c.action_label_en,
                startsAt: c.starts_at,
                endsAt: c.ends_at,
                isActive: c.is_active,
                priority: c.priority || 0,
                createdAt: c.created_at
            }));
        } catch (e) {
            console.warn('Failed to fetch promo campaigns:', e);
            return [];
        }
    },

    /**
     * Check if a user has already seen a specific campaign.
     */
    hasSeenCampaign: async (campaignId: string, userId: string): Promise<boolean> => {
        try {
            const { data, error } = await supabase
                .from('promo_impressions')
                .select('campaign_id')
                .eq('campaign_id', campaignId)
                .eq('user_id', userId)
                .maybeSingle();
            return !error && !!data;
        } catch {
            return false;
        }
    },

    /**
     * Mark a campaign as seen by a user.
     */
    markAsSeen: async (campaignId: string, userId: string): Promise<void> => {
        try {
            await supabase.from('promo_impressions').upsert({
                campaign_id: campaignId,
                user_id: userId,
                seen_at: new Date().toISOString(),
                clicked: false
            });

            // Best-effort impression count increment — non-blocking
            supabase
                .from('promotional_campaigns')
                .select('current_impressions')
                .eq('id', campaignId)
                .maybeSingle()
                .then(({ data: row }) => {
                    if (row) {
                        supabase
                            .from('promotional_campaigns')
                            .update({ current_impressions: (row.current_impressions || 0) + 1 })
                            .eq('id', campaignId)
                            .then(() => {});
                    }
                });

            logger.log('✅ Promo impression recorded');
        } catch (e) {
            console.warn('Failed to record promo impression:', e);
        }
    },

    /**
     * Mark a campaign as clicked by a user.
     */
    markAsClicked: async (campaignId: string, userId: string): Promise<void> => {
        try {
            await supabase
                .from('promo_impressions')
                .update({ clicked: true })
                .eq('campaign_id', campaignId)
                .eq('user_id', userId);
        } catch (e) {
            console.warn('Failed to record promo click:', e);
        }
    },

    /**
     * Admin: list every campaign (active or not, past or upcoming).
     * RLS lets any authenticated user read; the admin UI is the only
     * place that surfaces them.
     */
    listAll: async (): Promise<PromoCampaign[]> => {
        try {
            const { data, error } = await supabase
                .from('promotional_campaigns')
                .select('*')
                .order('created_at', { ascending: false });
            if (error) throw error;
            return (data || []).map((c: any) => ({
                id: c.id,
                targetAudience: c.target_audience,
                targetCity: c.target_city,
                targetRegion: c.target_region,
                titleAr: c.title_ar,
                titleEn: c.title_en,
                bodyAr: c.body_ar,
                bodyEn: c.body_en,
                imageUrl: c.image_url,
                actionUrl: c.action_url,
                actionLabelAr: c.action_label_ar,
                actionLabelEn: c.action_label_en,
                startsAt: c.starts_at,
                endsAt: c.ends_at,
                isActive: c.is_active,
                priority: c.priority || 0,
                createdAt: c.created_at,
                currentImpressions: c.current_impressions || 0,
                maxImpressions: c.max_impressions
            } as PromoCampaign & { currentImpressions: number; maxImpressions?: number }));
        } catch (e) {
            console.error('Failed to list campaigns:', e);
            return [];
        }
    },

    /**
     * Create a new promotional campaign (admin only — RLS enforced).
     */
    createCampaign: async (campaign: {
        targetAudience: 'buyer' | 'seller' | 'all';
        targetCity?: string;
        targetRegion?: string;
        titleAr: string;
        titleEn: string;
        bodyAr: string;
        bodyEn: string;
        imageUrl?: string;
        actionUrl?: string;
        actionLabelAr?: string;
        actionLabelEn?: string;
        startsAt?: string;
        endsAt?: string;
        priority?: number;
        createdBy: string;
        isActive?: boolean;
    }): Promise<PromoCampaign | null> => {
        try {
            const { data, error } = await supabase
                .from('promotional_campaigns')
                .insert({
                    target_audience: campaign.targetAudience,
                    target_city: campaign.targetCity,
                    target_region: campaign.targetRegion,
                    title_ar: campaign.titleAr,
                    title_en: campaign.titleEn,
                    body_ar: campaign.bodyAr,
                    body_en: campaign.bodyEn,
                    image_url: campaign.imageUrl,
                    action_url: campaign.actionUrl,
                    action_label_ar: campaign.actionLabelAr,
                    action_label_en: campaign.actionLabelEn,
                    starts_at: campaign.startsAt || new Date().toISOString(),
                    ends_at: campaign.endsAt,
                    priority: campaign.priority || 0,
                    created_by: campaign.createdBy,
                    is_active: campaign.isActive ?? true
                })
                .select()
                .single();

            if (error) throw error;
            logger.log('✅ Promo campaign created');
            return data ? {
                id: data.id,
                targetAudience: data.target_audience,
                titleAr: data.title_ar,
                titleEn: data.title_en,
                bodyAr: data.body_ar,
                bodyEn: data.body_en,
                isActive: data.is_active,
                priority: data.priority || 0,
                startsAt: data.starts_at,
                endsAt: data.ends_at,
                imageUrl: data.image_url,
                actionUrl: data.action_url,
                actionLabelAr: data.action_label_ar,
                actionLabelEn: data.action_label_en,
                targetCity: data.target_city,
                targetRegion: data.target_region,
                createdAt: data.created_at
            } as PromoCampaign : null;
        } catch (e) {
            console.error('Failed to create promo campaign:', e);
            throw e;
        }
    },

    /**
     * Update an existing campaign (admin only).
     */
    updateCampaign: async (id: string, patch: Partial<{
        titleAr: string; titleEn: string; bodyAr: string; bodyEn: string;
        targetAudience: 'buyer' | 'seller' | 'all'; targetCity: string | null;
        imageUrl: string | null; actionUrl: string | null;
        actionLabelAr: string | null; actionLabelEn: string | null;
        startsAt: string; endsAt: string | null;
        isActive: boolean; priority: number;
    }>): Promise<void> => {
        const dbPatch: Record<string, any> = {};
        if (patch.titleAr !== undefined) dbPatch.title_ar = patch.titleAr;
        if (patch.titleEn !== undefined) dbPatch.title_en = patch.titleEn;
        if (patch.bodyAr !== undefined) dbPatch.body_ar = patch.bodyAr;
        if (patch.bodyEn !== undefined) dbPatch.body_en = patch.bodyEn;
        if (patch.targetAudience !== undefined) dbPatch.target_audience = patch.targetAudience;
        if (patch.targetCity !== undefined) dbPatch.target_city = patch.targetCity;
        if (patch.imageUrl !== undefined) dbPatch.image_url = patch.imageUrl;
        if (patch.actionUrl !== undefined) dbPatch.action_url = patch.actionUrl;
        if (patch.actionLabelAr !== undefined) dbPatch.action_label_ar = patch.actionLabelAr;
        if (patch.actionLabelEn !== undefined) dbPatch.action_label_en = patch.actionLabelEn;
        if (patch.startsAt !== undefined) dbPatch.starts_at = patch.startsAt;
        if (patch.endsAt !== undefined) dbPatch.ends_at = patch.endsAt;
        if (patch.isActive !== undefined) dbPatch.is_active = patch.isActive;
        if (patch.priority !== undefined) dbPatch.priority = patch.priority;
        dbPatch.updated_at = new Date().toISOString();

        const { error } = await supabase
            .from('promotional_campaigns')
            .update(dbPatch)
            .eq('id', id);
        if (error) throw error;
    },

    /**
     * Delete a campaign and its impressions (admin only).
     */
    deleteCampaign: async (id: string): Promise<void> => {
        const { error } = await supabase
            .from('promotional_campaigns')
            .delete()
            .eq('id', id);
        if (error) throw error;
    },

    /**
     * Admin: send a campaign immediately to every targeted user
     * (server-side fan-out via the broadcast_campaign() function).
     * Returns the number of notification rows created.
     */
    broadcastNow: async (id: string): Promise<number> => {
        const { data, error } = await supabase.rpc('broadcast_campaign', { p_campaign_id: id });
        if (error) throw error;
        return (data as number) || 0;
    }
};
