import { Deal } from '../data/mock';
import { supabase } from '../services/supabaseClient';
import { logger } from '../utils/logger';

export const dealRepository = {
    getAll: async (): Promise<Deal[]> => {
        try {
            const { data, error } = await supabase.from('deals').select('*').neq('status', 'deleted').order('created_at', { ascending: false });
            if (error) throw error;
            if (data) {
                const mappedData: Deal[] = data.map(dealRepository.mapRowToDeal);
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

        let { error } = await supabase.from('deals').upsert(dbDeal);
        // Tolerate the case where the deals table is on an older schema that
        // hasn't yet picked up the expiry_type / expiry_date columns
        // (migration v8.16). Drop the new fields and retry once so the user
        // can still publish — the values will start sticking the moment the
        // migration runs, without forcing a hard release coupling.
        if (error && /expiry_(type|date)/i.test(error.message || '')) {
            const { expiry_type, expiry_date, ...legacyDeal } = dbDeal;
            const retry = await supabase.from('deals').upsert(legacyDeal);
            error = retry.error;
        }
        if (error) {
            console.error('❌ Remote deal upsert failed:', error.message);
            throw error;
        }
        logger.log('✅ Deal saved to remote:', deal.id);
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
        if ('expiry_type' in d && d.expiry_type) deal.expiryType = d.expiry_type;
        if ('expiry_date' in d && d.expiry_date) deal.expiryDate = d.expiry_date;

        // Analytics counters (migration v13). Optional — older rows may be null.
        if ('views' in d && d.views != null)   deal.views  = Number(d.views)  || 0;
        if ('clicks' in d && d.clicks != null) deal.clicks = Number(d.clicks) || 0;

        return deal;
    }
};
