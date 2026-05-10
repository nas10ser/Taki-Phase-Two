/**
 * Branch Repository — server-only data access for store branches.
 * The basic plan covers the first N (default 3); each extra branch is
 * billed via the subscription engine. branches_count on
 * merchant_subscriptions is auto-synced by the database trigger.
 */
import { supabase } from '../services/supabaseClient';
import { logger } from '../utils/logger';

export interface StoreBranch {
    id: string;
    merchantId: string;
    nameAr: string;
    nameEn?: string;
    regionId?: string;
    cityId?: string;
    locationId?: string;
    address?: string;
    mapLat?: number;
    mapLng?: number;
    googleMapsLink?: string;
    phone?: string;
    isPrimary: boolean;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

const mapRow = (r: any): StoreBranch => ({
    id: r.id,
    merchantId: r.merchant_id,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    regionId: r.region_id,
    cityId: r.city_id,
    locationId: r.location_id,
    address: r.address,
    mapLat: r.map_lat != null ? Number(r.map_lat) : undefined,
    mapLng: r.map_lng != null ? Number(r.map_lng) : undefined,
    googleMapsLink: r.google_maps_link,
    phone: r.phone,
    isPrimary: !!r.is_primary,
    isActive: !!r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at
});

export const branchRepository = {
    listForMerchant: async (merchantId: string): Promise<StoreBranch[]> => {
        const { data, error } = await supabase
            .from('store_branches')
            .select('*')
            .eq('merchant_id', merchantId)
            .order('created_at', { ascending: true });
        if (error) {
            logger.warn('branch list failed:', error.message);
            return [];
        }
        return (data || []).map(mapRow);
    },

    create: async (input: Omit<StoreBranch, 'id' | 'createdAt' | 'updatedAt' | 'isActive' | 'isPrimary'> & {
        isPrimary?: boolean; isActive?: boolean;
    }): Promise<StoreBranch> => {
        const { data, error } = await supabase
            .from('store_branches')
            .insert({
                merchant_id: input.merchantId,
                name_ar: input.nameAr,
                name_en: input.nameEn || null,
                region_id: input.regionId || null,
                city_id: input.cityId || null,
                location_id: input.locationId || null,
                address: input.address || null,
                map_lat: input.mapLat ?? null,
                map_lng: input.mapLng ?? null,
                google_maps_link: input.googleMapsLink || null,
                phone: input.phone || null,
                is_primary: !!input.isPrimary,
                is_active: input.isActive !== false
            })
            .select()
            .single();
        if (error) throw error;
        return mapRow(data);
    },

    update: async (id: string, patch: Partial<StoreBranch>): Promise<void> => {
        const dbPatch: Record<string, any> = {};
        if (patch.nameAr !== undefined) dbPatch.name_ar = patch.nameAr;
        if (patch.nameEn !== undefined) dbPatch.name_en = patch.nameEn;
        if (patch.regionId !== undefined) dbPatch.region_id = patch.regionId;
        if (patch.cityId !== undefined) dbPatch.city_id = patch.cityId;
        if (patch.locationId !== undefined) dbPatch.location_id = patch.locationId;
        if (patch.address !== undefined) dbPatch.address = patch.address;
        if (patch.mapLat !== undefined) dbPatch.map_lat = patch.mapLat;
        if (patch.mapLng !== undefined) dbPatch.map_lng = patch.mapLng;
        if (patch.googleMapsLink !== undefined) dbPatch.google_maps_link = patch.googleMapsLink;
        if (patch.phone !== undefined) dbPatch.phone = patch.phone;
        if (patch.isPrimary !== undefined) dbPatch.is_primary = patch.isPrimary;
        if (patch.isActive !== undefined) dbPatch.is_active = patch.isActive;
        const { error } = await supabase.from('store_branches').update(dbPatch).eq('id', id);
        if (error) throw error;
    },

    delete: async (id: string): Promise<void> => {
        const { error } = await supabase.from('store_branches').delete().eq('id', id);
        if (error) throw error;
    }
};
