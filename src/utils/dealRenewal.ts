/**
 * v13.17 — منطق «تجديد/تفعيل العرض» المشترك بين لوحة التاجر و«صفحتي».
 *
 * ثلاث مشاكل أبلغ عنها ناصر كانت تُصلَح في مكان واحد فقط (أو لا تُصلَح إطلاقاً):
 *
 * 1) «تجيني رسالة أن العرض منشور في ٤ مواقع رغم أني لا أستطيع اختيار مواقع»
 *    السبب: مسار التجديد/التفعيل يمرّر كائن العرض **كما هو مخزَّن** — ومعه
 *    مصفوفة `locations` القديمة (٤ فروع) — فحارس القاعدة v13.16 يعدّها ويرفض،
 *    بينما نموذج التعديل كان قد قصّها في الواجهة فقط. الحل (v13.18، قرار ناصر):
 *    نكشف التجاوز بـ`dealLocationCount` وننقل التاجر لنموذج التعديل ليقرر بنفسه
 *    أي فرع يبقي — لا نقصّ مواقعه نيابةً عنه.
 *
 * 2) «عند التجديد حدّث التاريخ/الأيام/الساعات مثل ما كانت»
 *    عمر العرض = createdAt + expiresInMinutes، فإعادة createdAt للآن تُجدّد المدة
 *    تلقائياً. لكن حقل `expiryDate` المعروض كان يبقى بتاريخ الماضي فيتناقض مع
 *    العمر الفعلي. الحل: إعادة حسابه من لحظة التجديد بنفس المدة الأصلية.
 *
 * 3) «تفعيل» عرض موقوف انتهى وقته كان يعيده نشطاً فيختفي فوراً (منتهٍ بالساعة).
 *    الحل: إن كان منتهياً زمنياً وقت التفعيل، نُجدّده كالتجديد تماماً.
 */
import { Deal } from '../data/mock';
import { isDealExpiredByTime } from './helpers';

/** مفتاح الموقع — نفس صيغة الويب وحارس القاعدة `_taki_deal_loc_keys`. */
const locKey = (locationId?: string | null, lat?: number | null, lng?: number | null): string => {
    if (locationId && typeof locationId === 'string'
        && !locationId.startsWith('custom_') && locationId !== 'other') {
        return `loc:${locationId}`;
    }
    const rl = Math.round((lat ?? 0) * 1000) / 1000;
    const rg = Math.round((lng ?? 0) * 1000) / 1000;
    return `geo:${rl},${rg}`;
};

/** عدد المواقع المتميّزة التي يغطيها العرض (الأساسي + فروع النشر المتعدد). */
export const dealLocationCount = (deal: Deal): number => {
    const keys = new Set<string>();
    keys.add(locKey(deal.locationId, deal.mapLocation?.lat, deal.mapLocation?.lng));
    const locs = Array.isArray((deal as any).locations) ? (deal as any).locations : [];
    for (const l of locs) {
        if (!l || l.id === 'primary') continue;
        keys.add(locKey(l.locationId, l.lat, l.lng));
    }
    return keys.size;
};

/**
 * يُجهّز العرض للتجديد: يُعيد بدء عمره من الآن بنفس المدة الأصلية، ويعيد
 * حساب تاريخ الانتهاء المعروض، ويستعيد الكمية الأصلية.
 * @param restoreQuantity استعادة الكمية الأولية (التجديد) أو تركها (الاستئناف).
 */
export const refreshDealLifespan = (deal: Deal, restoreQuantity: boolean): Deal => {
    const now = Date.now();
    const next: any = { ...deal, createdAt: now };

    // عرض مجدوَل بدايته في الماضي: نُلغي الجدولة حتى يبدأ عمره من الآن فوراً
    // (وإلا بقي lifespanStart على تاريخ قديم فيولد منتهياً من جديد).
    if (typeof (deal as any).startsAt === 'number' && (deal as any).startsAt <= now) {
        next.startsAt = undefined;
    }

    // «ينتهي بتاريخ»: نُزحزح التاريخ المعروض بنفس المدة الأصلية من لحظة التجديد
    // (طلب ناصر: عرض ينتهي بعد يومين → عند التجديد يومان من تاريخ التجديد).
    if (deal.expiryType === 'date' && deal.expiresInMinutes) {
        const target = new Date(now + deal.expiresInMinutes * 60 * 1000);
        const y = target.getFullYear();
        const m = String(target.getMonth() + 1).padStart(2, '0');
        const d = String(target.getDate()).padStart(2, '0');
        next.expiryDate = `${y}-${m}-${d}`;   // محلي — toISOString يرجع يوماً للوراء
    }

    if (restoreQuantity) {
        next.quantity = deal.initialQuantity !== undefined
            ? deal.initialQuantity
            : (deal.quantity === 0 ? 10 : deal.quantity);
    }
    return next as Deal;
};

/** هل يحتاج هذا العرض تجديد عمره عند التفعيل؟ (موقوف لكنه انتهى زمنياً) */
export const needsLifespanRefresh = (deal: Deal): boolean => isDealExpiredByTime(deal);

/**
 * v13.19 — سقف مواقع الباقة **مقروءاً من القاعدة لحظة القرار**.
 *
 * الاعتماد على حالة React كان يُسقط الفحص: القيمة الافتراضية ٣، فعرض بموقعين
 * على باقة موقع واحد يمرّ (٢ > ٣ خطأ) فترفضه القاعدة، فتتوالى ثلاث رسائل على
 * التاجر. القراءة الحيّة هنا تجعل الاعتراض في العميل مضموناً دائماً.
 * عند تعذّر القراءة نُعيد `null` فيتصرّف المستدعي بحذر (لا يمنع ولا يدّعي).
 */
export const fetchStoreMaxBranches = async (storeId: string): Promise<number | null> => {
    try {
        const { supabase } = await import('../services/supabaseClient');
        const { data, error } = await supabase
            .from('store_profiles')
            .select('max_branches')
            .eq('store_id', storeId)
            .maybeSingle();
        if (error) return null;
        const n = Number(data?.max_branches);
        return n > 0 ? n : null;
    } catch {
        return null;
    }
};

/**
 * 🔴 v16.49 (بلاغُ ناصر ١٩ نوفمبر): «عند تجديد منتجٍ منتهيةٍ كمّيته والنقرِ
 *    على تجديد يحوّلني لصفحة العروض النشطة **ولكن يبقى في العروض المنتهية**».
 *
 *    والسببُ مقيسٌ على الإنتاج: عرضُ «كوووووووورة» حالتُه `active` وكمّيتُه
 *    ٢٠ وعمرُه سنة — ومع ذلك يُصنّف منتهياً، لأن عموداً ثالثاً مرفوع:
 *    `deals.sold_out`. و`isDealSoldOut` تقرؤه **أوّلاً** (مفتاحُ «نفد»
 *    اليدويُّ من v15.07)، فأيُّ تجديدٍ يُعيد الكمّيةَ والعمرَ ويترك المفتاح
 *    مرفوعاً = عرضٌ «نشط» بكمّيةٍ كاملة لا يُباع ولا يظهر.
 *
 * 🪤 **ولا يُكتب `sold_out` من `dealRepository.save`**: حمولةُ الحفظ لا تحمل
 *    العمودَ إطلاقاً (قِيس)، فوضعُ `soldOut:false` في كائن العرض لا يُغيّر
 *    شيئاً في القاعدة. الكاتبُ الوحيد هو `merchant_set_sold_out` — نفسُ
 *    النداء الذي يستعمله زرُّ «نفد/أعِده».
 *
 * 🪤 ويُنادى **قبل** الحفظ لا بعده: `updateDeal` تُعيد قراءةَ الصفّ بعد
 *    نجاحها، فإطفاءٌ بعدها يترك الحالةَ المحلّيةَ على القيمة القديمة.
 * 🪤 ويُطفأ عند **التجديد** وحده (الذي يُعيد الكمّية). أمّا استئنافُ عرضٍ
 *    أوقفه التاجر فلا يُلغي مفتاحاً رفعه بنفسه — له زرُّه الصريح.
 */
export const clearSoldOut = async (deal: Deal): Promise<boolean> => {
    if ((deal as any).soldOut !== true) return true;   // لا شيء ليُطفأ
    try {
        const { supabase } = await import('../services/supabaseClient');
        const { data, error } = await supabase.rpc('merchant_set_sold_out', {
            p_deal_id: deal.id, p_on: false, p_variant_id: null, p_location_id: null,
        });
        // 🪤 كتابةٌ ترفضها RLS تعود `error=null` — فلا يُقال «تمّ» إلّا بدليل.
        return !error && (data as any)?.ok === true;
    } catch {
        return false;
    }
};
