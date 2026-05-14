import { supabase } from '../services/supabaseClient';

export interface StoreBranch {
    id: string;
    merchantId: string;
    nameAr: string;
    nameEn?: string | null;
    regionId?: string | null;
    cityId?: string | null;
    locationId?: string | null;
    address?: string | null;
    mapLat?: number | null;
    mapLng?: number | null;
    googleMapsLink?: string | null;
    phone?: string | null;
    isPrimary?: boolean;
    isActive?: boolean;
    createdAt?: string;
    updatedAt?: string;
}

const fromRow = (r: any): StoreBranch => ({
    id: r.id,
    merchantId: r.merchant_id,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    regionId: r.region_id,
    cityId: r.city_id,
    locationId: r.location_id,
    address: r.address,
    mapLat: r.map_lat,
    mapLng: r.map_lng,
    googleMapsLink: r.google_maps_link,
    phone: r.phone,
    isPrimary: r.is_primary,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
});

const toRow = (b: Partial<StoreBranch> & { merchantId: string; nameAr: string }) => ({
    ...(b.id ? { id: b.id } : {}),
    merchant_id: b.merchantId,
    name_ar: b.nameAr,
    name_en: b.nameEn ?? null,
    region_id: b.regionId ?? null,
    city_id: b.cityId ?? null,
    location_id: b.locationId ?? null,
    address: b.address ?? null,
    map_lat: b.mapLat ?? null,
    map_lng: b.mapLng ?? null,
    google_maps_link: b.googleMapsLink ?? null,
    phone: b.phone ?? null,
    is_primary: b.isPrimary ?? false,
    is_active: b.isActive ?? true,
    updated_at: new Date().toISOString(),
});

export const branchRepository = {
    async listByMerchant(merchantId: string): Promise<StoreBranch[]> {
        const { data, error } = await supabase
            .from('store_branches')
            .select('*')
            .eq('merchant_id', merchantId)
            .eq('is_active', true)
            .order('created_at', { ascending: true });
        if (error) {
            console.error('branches list error', error);
            return [];
        }
        return (data || []).map(fromRow);
    },

    async upsert(branch: Partial<StoreBranch> & { merchantId: string; nameAr: string }): Promise<StoreBranch | null> {
        const row = toRow(branch);
        const { data, error } = await supabase
            .from('store_branches')
            .upsert(row, { onConflict: 'id' })
            .select()
            .single();
        if (error) {
            console.error('branches upsert error', error);
            throw error;
        }
        return data ? fromRow(data) : null;
    },

    async remove(id: string): Promise<void> {
        const { error } = await supabase
            .from('store_branches')
            .delete()
            .eq('id', id);
        if (error) {
            console.error('branches delete error', error);
            throw error;
        }
    },
};
