import { supabase } from '../services/supabaseClient';
import { DEFAULT_LOCATION_PACKAGES, LocationPackage } from '../data/packages';

/**
 * Location-package catalogue + monthly pricing (v11.36).
 *
 * Stored as a single jsonb row in `platform_settings` under
 * `location_packages`. Everyone can READ it (merchants render the cards);
 * only admins can WRITE (RLS on platform_settings). The admin edits every
 * field — price, discount, locations, duration, label, active — from the
 * "💎 باقات المواقع والأسعار" panel, so pricing is fully owner-controlled.
 */
const KEY = 'location_packages';

const sanitize = (arr: any): LocationPackage[] => {
    if (!Array.isArray(arr) || arr.length === 0) return DEFAULT_LOCATION_PACKAGES;
    return arr.map((p: any, i: number) => ({
        id: Number(p?.id) || i + 1,
        max: Math.max(1, Math.round(Number(p?.max) || 1)),
        price: Math.max(0, Math.round(Number(p?.price) || 0)),
        discount: Math.min(100, Math.max(0, Math.round(Number(p?.discount) || 0))),
        durationDays: Math.max(1, Math.round(Number(p?.durationDays) || 30)),
        ar: String(p?.ar || `باقة ${i + 1}`),
        en: String(p?.en || `Package ${i + 1}`),
        descAr: String(p?.descAr || ''),
        descEn: String(p?.descEn || ''),
        active: p?.active !== false,
    }));
};

export const packageRepository = {
    /** Live catalogue (admin-edited) with offline/empty fallback to defaults. */
    async get(): Promise<LocationPackage[]> {
        try {
            const { data, error } = await supabase
                .from('platform_settings')
                .select('value')
                .eq('key', KEY)
                .maybeSingle();
            if (error || !data?.value) return DEFAULT_LOCATION_PACKAGES;
            return sanitize(data.value);
        } catch {
            return DEFAULT_LOCATION_PACKAGES;
        }
    },

    /** Admin-only write (RLS enforces). Update-first, then upsert if missing. */
    async save(packages: LocationPackage[]): Promise<{ success: boolean; error?: string }> {
        const clean = sanitize(packages);
        const stamp = new Date().toISOString();
        const { data, error } = await supabase
            .from('platform_settings')
            .update({ value: clean, updated_at: stamp })
            .eq('key', KEY)
            .select('key');
        if (error) return { success: false, error: error.message };
        if (data && data.length > 0) return { success: true };
        const { error: insErr } = await supabase
            .from('platform_settings')
            .upsert({ key: KEY, value: clean, description: 'Location packages catalogue + monthly pricing', updated_at: stamp });
        if (insErr) return { success: false, error: insErr.message };
        return { success: true };
    },
};
