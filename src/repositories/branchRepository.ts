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
    /** v13.61 — يظهر هذا الفرع على صفحة المتجر العامة. محكوم بحدّ الباقة
     *  عبر مشغّل في القاعدة (tr_enforce_branch_display_cap) لا بالواجهة. */
    showOnStorePage?: boolean;
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
    showOnStorePage: r.show_on_store_page ?? false,
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
    ...(b.showOnStorePage === undefined ? {} : { show_on_store_page: b.showOnStorePage }),
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

    /** v13.61 — إظهار/إخفاء فرع على صفحة المتجر. القاعدة هي التي تفرض حدّ
     *  الباقة؛ نُرجع رسالة عربية واضحة عند الرفض بدل خطأ تقني.
     *  v13.66 — نطلب الصفوف المتأثّرة (`select`) ونتحقّق أن الكتابة **وقعت**:
     *  سياسة RLS ترفض الكتابة بلا خطأ — تُرجع صفر صفوف و`error=null` — فكانت
     *  الواجهة تقول «تم» ولا شيء تغيّر في القاعدة. */
    async setDisplayed(id: string, show: boolean): Promise<{ ok: boolean; error?: string; cap?: number }> {
        const { data, error } = await supabase.from('store_branches')
            .update({ show_on_store_page: show }).eq('id', id).select('id');
        if (!error) {
            if (!data || data.length === 0) {
                return { ok: false, error: 'لم يُحفَظ التغيير في قاعدة البيانات (لا صلاحية على هذا الفرع). حدّث الصفحة وحاول مجدداً.' };
            }
            return { ok: true };
        }
        const m = /BRANCH_DISPLAY_CAP:(\d+)/.exec(error.message || '');
        if (m) return { ok: false, cap: Number(m[1]), error: `باقتك تسمح بعرض ${m[1]} موقع على صفحتك. أخفِ موقعاً آخر أولاً أو رقِّ باقتك.` };
        return { ok: false, error: error.message };
    },

    /** الفروع الظاهرة للزوار على صفحة المتجر. */
    async listDisplayed(merchantId: string): Promise<StoreBranch[]> {
        const { data, error } = await supabase.from('store_branches')
            .select('*').eq('merchant_id', merchantId)
            .eq('show_on_store_page', true).eq('is_active', true)
            .order('is_primary', { ascending: false }).order('created_at', { ascending: true });
        if (error) return [];
        return (data || []).map(fromRow);
    },

    /**
     * حذف فرع من القاعدة نهائياً.
     *
     * v13.66 — `.select()` إلزامي هنا: حذفٌ ترفضه سياسة RLS يعود بـ`error=null`
     * وصفر صفوف، فكانت الواجهة تُسقط الشريحة من الشاشة والصفّ باقٍ في القاعدة —
     * ويعود عند أول تحديث. الآن نتأكّد أن صفاً حُذف فعلاً وإلا نرمي خطأً
     * فيتراجع السياق ويرى التاجر رسالة صريحة. (بلاغ ناصر: «تأكد أن الإضافة
     * والحذف مربوطان بالداتابيس».)
     */
    async remove(id: string): Promise<void> {
        const { data, error } = await supabase
            .from('store_branches')
            .delete()
            .eq('id', id)
            .select('id');
        if (error) {
            console.error('branches delete error', error);
            throw error;
        }
        if (!data || data.length === 0) {
            const e = new Error('BRANCH_DELETE_NOOP: الصف لم يُحذف من القاعدة (لا صلاحية أو مُعرّف غير موجود).');
            console.error(e.message, id);
            throw e;
        }
    },
};
