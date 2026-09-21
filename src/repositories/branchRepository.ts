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

/**
 * صفّ القاعدة من كائن الفرع — **جزئيّ بالقصد** (v14.74).
 *
 * 🔴 ما كان قبله: كل حقلٍ يُكتب بـ`?? null` أو `?? false`، أي أن أي نداءٍ لا
 *    يذكر حقلاً **يمحوه**. وهو نفس العيب الذي كلّفنا `saveProfile` من قبل
 *    («اختفت المتابَعات بعد تعديل»). أثره هنا مباشر على ما شُحن اليوم:
 *      • `saveShopLocation` يبني كائناً بلا `address` — فكلّ ضغطة «حفظ الموقع»
 *        كانت ستمحو العنوان الذي كتبه التاجر للتوّ في الموقع الرئيسي.
 *      • ويبني بلا `isPrimary` في مسارٍ آخر — فيُصفَّر الموقع الرئيسي بلا أن
 *        يطلب أحد ذلك (وهو سببٌ مرشّح لـ«صفر رئيسي» في متجر تاكي).
 *
 * القاعدة الآن: عمودٌ يُكتب **فقط** إذا مُرِّر حقله صراحةً (`!== undefined`).
 * و`null` تبقى محواً مقصوداً. وللصفّ الجديد تكفي افتراضيّات القاعدة نفسها
 * (`is_active` = true · `is_primary` = false · `show_on_store_page` = false —
 * فُحصت على جدة)، فلا حاجة لكتابتها من هنا.
 */
const toRow = (b: Partial<StoreBranch> & { merchantId: string; nameAr: string }) => {
    const row: Record<string, any> = {
        ...(b.id ? { id: b.id } : {}),
        merchant_id: b.merchantId,
        name_ar: b.nameAr,
        updated_at: new Date().toISOString(),
    };
    const put = (col: string, v: any) => { if (v !== undefined) row[col] = v; };
    put('name_en', b.nameEn);
    put('region_id', b.regionId);
    put('city_id', b.cityId);
    put('location_id', b.locationId);
    put('address', b.address);
    put('map_lat', b.mapLat);
    put('map_lng', b.mapLng);
    put('google_maps_link', b.googleMapsLink);
    put('phone', b.phone);
    put('is_primary', b.isPrimary);
    put('is_active', b.isActive);
    put('show_on_store_page', b.showOnStorePage);
    return row;
};

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

    /**
     * الفروع الظاهرة للزوار على صفحة المتجر — **مسقوفة بحدّ الباقة الحيّ**.
     *
     * v13.67 — طبقة ثانية بأمر ناصر («تأكد أنها مربوطة بالباقة»). الطبقة الأولى
     * في القاعدة (مشغّلان: يمنع تجاوز الحدّ، ويُعيد المواءمة عند تغيّر الباقة).
     * لكن العرض كان يثق بعمود `show_on_store_page` وحده، فأي انحراف في الصفوف
     * — استعادة نسخة احتياطية، تعديل مباشر بـSQL، أو مسار اشتراك لا يُحدّث
     * الحدّ — كان يعني صفحةً تعرض أكثر مما تسمح به الباقة.
     *
     * الآن العدد **مسقوف عند القراءة**: مهما قالت الصفوف، لا يُعرض للزائر أكثر
     * من `store_profiles.max_branches`. الترتيب هو نفسه ترتيب دالة المواءمة في
     * القاعدة (الفرع الرئيسي ثم الأقدم) فلا تختلف النتيجتان أبداً.
     */
    async listDisplayed(merchantId: string): Promise<StoreBranch[]> {
        const [rowsRes, capRes] = await Promise.all([
            supabase.from('store_branches')
                .select('*').eq('merchant_id', merchantId)
                .eq('show_on_store_page', true).eq('is_active', true)
                .order('is_primary', { ascending: false }).order('created_at', { ascending: true }),
            supabase.from('store_profiles')
                .select('max_branches').eq('store_id', merchantId).maybeSingle(),
        ]);
        if (rowsRes.error) return [];
        const rows = (rowsRes.data || []).map(fromRow);
        // بلا سقف معروف لا نخترع واحداً: الصفوف كما هي (القاعدة تحرسها أصلاً).
        const cap = Number(capRes.data?.max_branches);
        if (!Number.isFinite(cap) || cap <= 0) return rows;
        return rows.slice(0, cap);
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
    /**
     * v14.74 — تحرير بطاقة الموقع: الاسم والعنوان.
     *
     * لماذا هذان الحقلان تحديداً: قِيس على الإنتاج (٢١ سبتمبر ٢٠٢٦) أن **صفراً
     * من عشرة** مواقع يحمل عنواناً نصّياً — لأن العمود موجود وصفحة المتجر
     * تعرضه، ولم يكن في النظام **حقل إدخالٍ واحد** له. وأن متجراً له فرعان
     * نشطان اسمهما «الدمام» على بُعد ٤ كيلومترات — ولا سبيل للتاجر أن يميّزهما
     * لأن الاسم يُولَّد من اسم المدينة/المول ولا يُحرَّر.
     *
     * 🪤 `.select()` إلزامي: تحديثٌ ترفضه RLS يعود بـ`error=null` وصفر صفوف،
     *    فتقول الشاشة «حُفظ» ولا شيء في القاعدة (فخّ «الأزرار الصامتة»).
     * 🪤 ولا يمسّ هذا التحديث حارس السقف: `tr_enforce_branch_cap` يعمل على
     *    `UPDATE OF location_id, map_lat, map_lng, is_active` وحدها، فتحرير
     *    الاسم والعنوان لا يُرفض بسبب باقةٍ ممتلئة (فُحص على جدة).
     */
    async setCard(id: string, patch: { nameAr?: string; address?: string | null }): Promise<{ ok: boolean; error?: string }> {
        const row: Record<string, any> = {};
        if (patch.nameAr !== undefined) {
            const n = String(patch.nameAr).trim().slice(0, 80);
            if (!n) return { ok: false, error: 'اسم الموقع لا يصحّ أن يكون فارغاً.' };
            row.name_ar = n;
        }
        if (patch.address !== undefined) {
            row.address = String(patch.address ?? '').trim().slice(0, 200) || null;
        }
        if (Object.keys(row).length === 0) return { ok: true };

        const { data, error } = await supabase.from('store_branches')
            .update(row).eq('id', id).select('id');
        if (error) {
            console.error('branches setCard error', error);
            // v14.74 — حارس القاعدة يمنع اسمين متطابقين بين المواقع النشطة.
            // رسالته تُترجَم هنا: نصّ خطأ PostgREST الخام لا يقول للتاجر ما يفعل.
            if (/BRANCH_NAME_DUP/i.test(error.message || '')) {
                return { ok: false, error: 'لديك موقعٌ آخر بهذا الاسم. اختر اسماً يميّزه (واكتب عنوانه) ليفرّق المشتري بينهما.' };
            }
            return { ok: false, error: error.message };
        }
        if (!data || data.length === 0) {
            return { ok: false, error: 'لم يُحفَظ التغيير في القاعدة (لا صلاحية على هذا الموقع). حدّث الصفحة وحاول مجدداً.' };
        }
        return { ok: true };
    },

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
