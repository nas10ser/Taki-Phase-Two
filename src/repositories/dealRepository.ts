import { Deal } from '../data/mock';
import { supabase } from '../services/supabaseClient';
import { logger } from '../utils/logger';
import { withTimeout } from '../utils/helpers';

export const dealRepository = {
    getAll: async (): Promise<Deal[]> => {
        try {
            const { data, error } = await supabase.from('deals').select('*').neq('status', 'deleted').order('created_at', { ascending: false });
            if (error) throw error;
            if (data) {
                const mappedData: Deal[] = data.map(dealRepository.mapRowToDeal);
                // Hydrate ratings from the dedicated table in one round trip.
                // Empty deal list → skip the second query entirely.
                if (mappedData.length > 0) {
                    const ids = mappedData.map(d => d.id);
                    const { data: ratingRows } = await supabase
                        .from('ratings')
                        .select('*')
                        .in('deal_id', ids)
                        .is('deleted_at', null)
                        .order('created_at', { ascending: false });
                    if (Array.isArray(ratingRows) && ratingRows.length > 0) {
                        const byDeal: Record<string, any[]> = {};
                        for (const r of ratingRows) {
                            (byDeal[r.deal_id] ||= []).push({
                                id: r.id,
                                userId: r.user_id,
                                userName: r.user_name,
                                score: Number(r.score) || 0,
                                comment: r.comment ?? '',
                                date: r.created_at ? new Date(r.created_at).toISOString().split('T')[0] : '',
                                reply: r.reply ?? undefined,
                                repliedBy: r.replied_by ?? undefined,
                                repliedAt: r.replied_at ?? undefined,
                                likedBy: Array.isArray(r.liked_by) ? r.liked_by : [],
                                likeCount: Number(r.like_count) || 0,
                            });
                        }
                        for (const d of mappedData) {
                            d.ratings = byDeal[d.id] || [];
                        }
                    }
                }
                logger.log('📡 Fetched deals from remote:', mappedData.length);
                return mappedData;
            }
            return [];
        } catch (e) {
            console.error('❌ Remote deals fetch failed:', e);
            return [];
        }
    },

    getById: async (id: string): Promise<Deal | undefined> => {
        try {
            const { data, error } = await supabase.from('deals').select('*').eq('id', id).maybeSingle();
            if (error) throw error;
            return data ? dealRepository.mapRowToDeal(data) : undefined;
        } catch (e) {
            console.error('❌ Remote deal fetch by id failed:', e);
            return undefined;
        }
    },

    save: async (deal: Deal): Promise<void> => {
        // Optimistic local state update should be handled by the caller (AppContext)
        // Persistence is now purely remote.

        // 2. Sync to Remote
        const dbDeal: Record<string, any> = {
            id: deal.id,
            store_id: deal.storeId,
            shop_name: deal.shopName,
            item_name: deal.itemName,
            category: deal.category,
            gender: deal.gender || 'all',
            size: deal.size || null,
            original_price: deal.originalPrice,
            discounted_price: deal.discountedPrice,
            discount_percentage: deal.discountPercentage,
            images: deal.images || [],
            description: deal.description || '',
            location_id: deal.locationId || null,
            google_maps_link: deal.googleMapsLink || null,
            map_lat: deal.mapLocation?.lat ?? null,
            map_lng: deal.mapLocation?.lng ?? null,
            // Denormalized region/city so the filter chain works for
            // deals whose location_id is a `custom_<ts>` (not in LOCATIONS).
            region: deal.region || null,
            city: deal.city || null,
            reliability_score: deal.reliabilityScore ?? 100,
            expires_in_minutes: deal.expiresInMinutes ?? 525600,
            expiry_type: deal.expiryType || null,
            expiry_date: deal.expiryDate || null,
            quantity: deal.quantity === 'unlimited' ? null : deal.quantity,
            is_unlimited: deal.quantity === 'unlimited',
            initial_quantity: deal.initialQuantity === 'unlimited' ? null : (deal.initialQuantity ?? (deal.quantity === 'unlimited' ? null : deal.quantity)),
            status: deal.status,
            created_at: deal.createdAt || Date.now()
        };

        // Internal 25s ceiling per attempt. The deal triggers
        // (handle_deal_smart_notifications + tr_enforce_location_cap +
        // tr_guard_deal_publish) plus AP-NE1 RTT can take a few seconds
        // on healthy 4G, but anything past 25s means the request is hung
        // (commonly: Supabase JS auth-refresh inTabLock on backgrounded
        // iOS Safari). Surfacing fast lets the caller try again instead
        // of holding the spinner against an outer 40s wall.
        let { error } = await withTimeout(
            supabase.from('deals').upsert(dbDeal) as unknown as Promise<{ error: any }>,
            25000
        );
        // Tolerate the case where the deals table is on an older schema that
        // hasn't yet picked up the expiry_type / expiry_date columns
        // (migration v8.16). Drop the new fields and retry once so the user
        // can still publish — the values will start sticking the moment the
        // migration runs, without forcing a hard release coupling.
        if (error && /expiry_(type|date)/i.test(error.message || '')) {
            const { expiry_type, expiry_date, ...legacyDeal } = dbDeal;
            const retry = await withTimeout(
                supabase.from('deals').upsert(legacyDeal) as unknown as Promise<{ error: any }>,
                25000
            );
            error = retry.error;
        }
        // Same tolerance if the region/city columns don't exist yet.
        if (error && /column "(region|city)"/i.test(error.message || '')) {
            const { region, city, ...noGeo } = dbDeal;
            const retry = await withTimeout(
                supabase.from('deals').upsert(noGeo) as unknown as Promise<{ error: any }>,
                25000
            );
            error = retry.error;
        }
        if (error) {
            console.error('❌ Remote deal upsert failed:', error.message);
            throw error;
        }
        logger.log('✅ Deal saved to remote:', deal.id);
    },

    /**
     * Partial update for stock-only changes (e.g. a buyer booking decrements
     * quantity by N). Crucially this does NOT touch the `status` column, which
     * means the `tr_guard_deal_publish` trigger (BEFORE UPDATE OF status) does
     * NOT fire. Fixes the bug where buyers got SUBSCRIPTION_REQUIRED if the
     * merchant's subscription happened to be expired at booking time —
     * already-published deals must remain bookable.
     */
    updateQuantity: async (dealId: string, newQuantity: number | 'unlimited'): Promise<void> => {
        const payload: Record<string, any> = {
            quantity: newQuantity === 'unlimited' ? null : newQuantity,
            is_unlimited: newQuantity === 'unlimited',
        };
        const { error } = await supabase.from('deals').update(payload).eq('id', dealId);
        if (error) {
            console.error('❌ Remote deal quantity update failed:', error.message);
            throw error;
        }
        logger.log('✅ Deal quantity updated remotely:', dealId, '→', newQuantity);
    },

    /**
     * Save an entire deals array (bulk update).
     */
    saveDeals: async (deals: Deal[]): Promise<void> => {
        try {
            const dbDeals = deals.map(deal => ({
                id: deal.id,
                store_id: deal.storeId,
                shop_name: deal.shopName,
                item_name: deal.itemName,
                category: deal.category,
                gender: deal.gender,
                size: deal.size,
                original_price: deal.originalPrice,
                discounted_price: deal.discountedPrice,
                discount_percentage: deal.discountPercentage,
                images: deal.images,
                description: deal.description,
                location_id: deal.locationId || null,
                google_maps_link: deal.googleMapsLink || null,
                map_lat: deal.mapLocation?.lat || null,
                map_lng: deal.mapLocation?.lng || null,
                region: deal.region || null,
                city: deal.city || null,
                reliability_score: deal.reliabilityScore || 100,
                expires_in_minutes: deal.expiresInMinutes || 525600,
                quantity: deal.quantity === 'unlimited' ? null : deal.quantity,
                is_unlimited: deal.quantity === 'unlimited',
                initial_quantity: deal.initialQuantity === 'unlimited' ? null : (deal.initialQuantity ?? (deal.quantity === 'unlimited' ? null : deal.quantity)),
                status: deal.status,
                created_at: deal.createdAt || Date.now()
            }));
            const { error } = await supabase.from('deals').upsert(dbDeals);
            if (error) throw error;
            logger.log('✅ Deals bulk-saved to remote');
        } catch (e) {
            console.error('Remote bulk sync failed:', e);
        }
    },

    remove: async (id: string): Promise<void> => {
        // Soft-delete first: set status to 'deleted' so FK constraints (bookings)
        // don't block the operation. The client filters out 'deleted' deals on fetch.
        // If soft-delete succeeds, also attempt hard delete for cleanup.
        try {
            const { error: softError } = await supabase
                .from('deals')
                .update({ status: 'deleted' })
                .eq('id', id);
            if (softError) throw softError;
            logger.log('✅ Deal soft-deleted from remote');

            // Best-effort hard delete — may fail if bookings still reference it
            const { error: hardError } = await supabase.from('deals').delete().eq('id', id);
            if (hardError) {
                // Expected when bookings exist — soft delete is sufficient
                logger.log('ℹ️ Hard delete skipped (FK constraint), soft delete active');
            } else {
                logger.log('✅ Deal hard-deleted from remote');
            }
        } catch (e) {
            console.error('Remote delete failed:', e);
            throw e; // Let caller handle the error
        }
    },

    clearAll: async (): Promise<void> => {
        // Remote clear not allowed for safety
    },

    mapRowToDeal: (d: any): Deal => {
        const deal: Deal = {
            id: d.id,
            storeId: d.store_id,
            shopName: d.shop_name,
            itemName: d.item_name,
            category: d.category,
            gender: d.gender || 'all',
            size: d.size || undefined,
            originalPrice: Number(d.original_price) || 0,
            discountedPrice: Number(d.discounted_price) || 0,
            discountPercentage: Number(d.discount_percentage) || 0,
            images: Array.isArray(d.images) ? d.images : [],
            description: d.description || '',
            locationId: d.location_id || '',
            reliabilityScore: Number(d.reliability_score) || 100,
            expiresInMinutes: Number(d.expires_in_minutes) || 525600,
            quantity: d.is_unlimited ? 'unlimited' : (d.quantity ?? 0),
            initialQuantity: d.is_unlimited ? 'unlimited' : (d.initial_quantity ?? d.quantity ?? 0),
            ratings: [],
            prepTime: d.prep_time || undefined,
            status: (d.status === 'expired' ? 'expired' : (d.status === 'paused' ? 'paused' : (d.status === 'deleted' ? 'deleted' as any : 'active'))),
            createdAt: isNaN(Number(d.created_at)) ? new Date(d.created_at).getTime() : Number(d.created_at)
        };

        // Only add location fields if they exist in the payload to avoid overwriting with undefined during partial realtime updates
        if ('google_maps_link' in d) deal.googleMapsLink = d.google_maps_link || undefined;
        if ('map_lat' in d && 'map_lng' in d) {
            deal.mapLocation = { lat: Number(d.map_lat), lng: Number(d.map_lng) };
        }
        if ('region' in d) deal.region = d.region || undefined;
        if ('city' in d) deal.city = d.city || undefined;
        if ('expiry_type' in d && d.expiry_type) deal.expiryType = d.expiry_type;
        if ('expiry_date' in d && d.expiry_date) deal.expiryDate = d.expiry_date;

        // Analytics counters (migration v13). Optional — older rows may be null.
        if ('views' in d && d.views != null)   deal.views  = Number(d.views)  || 0;
        if ('clicks' in d && d.clicks != null) deal.clicks = Number(d.clicks) || 0;

        return deal;
    }
};
