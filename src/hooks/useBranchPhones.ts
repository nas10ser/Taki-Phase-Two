/**
 * useBranchPhones — رقمُ التواصل لكلّ فرع، حيّاً لا منسوخاً (v16.52)
 * ═══════════════════════════════════════════════════════════════════════════
 * أمرُ ناصر (٢٠ نوفمبر ٢٠٢٦): «تاجرٌ عنده ٣٠ فرعاً ولكلّ فرعٍ رقمٌ خاصّ…
 * وتاجرٌ ثانٍ رقمٌ موحّدٌ لعشرين فرعاً. وتأكّد أن الخيار متاحٌ حتى عند حجز
 * المشتري الطلبَ لنفس الفرع».
 *
 * 🔴 **ولا يُنسخ الرقمُ داخل العرض ولا داخل الحجز.** نسخةٌ مجمّدةٌ ثانيةٌ من
 *    وسيلة تواصلٍ تعني أن تغييرَ التاجر لرقمه لا يصل الطلباتِ القائمة —
 *    فيتّصل المشتري برقمٍ ميّت (نفسُ عيب `deals.shop_name` في v14.36، وهناك
 *    كان التجميدُ مقصوداً لأنه **اسمُ لحظة البيع**؛ أمّا رقمُ التواصل فما
 *    يُراد منه أن يعمل **الآن**).
 *
 * 🪤 ولا دالّةَ قاعدةٍ جديدة ولا سطحَ عامٍّ جديد: `branches_select_all` تسمح
 *    بقراءة الفروع للجميع أصلاً (قِيس على جدة)، والرقمُ معروضٌ للمشتري بالقصد.
 *    فنداءٌ واحدٌ بـ`in(...)` يكفي مهما كثرت الطلبات في الشاشة.
 *
 * 🪤 والنداءُ **مشروط**: بلا معرّفاتٍ لا طلبَ شبكة إطلاقاً — فصفحةُ عرضٍ
 *    بموقعٍ واحد (وهي الأغلب) لا تدفع شيئاً.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { logger } from '../utils/logger';

/** خريطةُ `branchId → phone`. الغائبُ يرتدّ إلى رقم المتجر الموحّد. */
export type BranchPhones = Record<string, string>;

/**
 * 🪤 مخزونٌ على مستوى الوحدة: شاشةُ الحجوزات تُعيد البناء كثيراً، ونداءٌ
 *    لكلّ إعادةِ بناءٍ يُحوّل ميزةً صغيرةً إلى حملٍ دائم. ويُفرَّغ عند تحديث
 *    الصفحة — وهو ما يكفي لرقمٍ يتغيّر مرّاتٍ في السنة.
 */
const cache = new Map<string, string>();

export const useBranchPhones = (branchIds: (string | null | undefined)[]): BranchPhones => {
    // المعرّفاتُ الحقيقيّة وحدها: `primary` ليست فرعاً في الجدول.
    const ids = Array.from(new Set(
        branchIds.filter((x): x is string => !!x && x !== 'primary'),
    )).sort();
    const key = ids.join(',');

    const [map, setMap] = useState<BranchPhones>(() => {
        const seed: BranchPhones = {};
        for (const id of ids) { const v = cache.get(id); if (v) seed[id] = v; }
        return seed;
    });

    useEffect(() => {
        if (!key) return;
        const missing = ids.filter(id => !cache.has(id));
        if (missing.length === 0) {
            // كلُّها مخزونة — تُركَّب بلا طلبِ شبكة.
            const seed: BranchPhones = {};
            for (const id of ids) { const v = cache.get(id); if (v) seed[id] = v; }
            setMap(seed);
            return;
        }
        let alive = true;
        (async () => {
            const { data, error } = await supabase
                .from('store_branches')
                .select('id, phone')
                .in('id', missing);
            if (error) { logger.error('branch phones', error); return; }
            for (const r of (data || [])) {
                // يُخزَّن حتى الفارغ (نصّاً فارغاً) فلا يُعاد سؤالُ فرعٍ بلا رقم.
                cache.set(String(r.id), String((r as any).phone || ''));
            }
            if (!alive) return;
            const next: BranchPhones = {};
            for (const id of ids) { const v = cache.get(id); if (v) next[id] = v; }
            setMap(next);
        })();
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    return map;
};
