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
