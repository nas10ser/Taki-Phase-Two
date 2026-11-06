/**
 * useStoreHold — مهلةُ حجزِ **هذا المتجر** (v15.43)
 * ═══════════════════════════════════════════════════════════════════════════
 * صارت المهلةُ بيد التاجر (أمرُ ناصر)، فلم يَعُد رقمُ المنصّة صحيحاً لكلّ عرض.
 * وهذا الخطّافُ هو الموضعُ الوحيد الذي يجلبه، فلا تُكتب سلسلةُ الارتداد
 * (استثناءُ المتجر ← افتراضُ المنصّة) في أربع شاشاتٍ تنحرف.
 *
 * 🪤 والحسابُ ليس هنا بل على القاعدة: `store_policies` تُعيد المهلةَ
 *    **الفعّالة** محسوبةً بـ`taki_booking_hold_hours(kind, store)` — وهي نفسُها
 *    الدالّةُ التي يستعملها مشغّلُ الحجز. فما يُعرض هو ما سيُطبَّق حرفاً بحرف.
 * 🪤 وقبل وصول الجواب تُعرض قيمةُ المنصّة لا صفرٌ ولا فراغ: أكثرُ المتاجر
 *    تتبع الافتراض، وشاشةٌ تقول «٠ ساعة» لحظةً أسوأُ من رقمٍ يُصحَّح.
 * 🪤 والنتيجةُ تُحفظ في خريطةٍ على مستوى الوحدة: صفحةُ العرض وورقةُ الحجز
 *    تسألان عن نفس المتجر، وطلبان لنفس الرقم في ثانيةٍ واحدة هدرٌ بلا سبب.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { refundRepository } from '../repositories/refundRepository';
import { supabase } from '../services/supabaseClient';
import { holdLabel } from '../utils/bookingHold';

export interface StoreHold {
    pickup: number;
    delivery: number;
    /** الصياغةُ هنا لا في الشاشة: `bookingHold.ts` هو محرّكها الوحيد. */
    pickupLabelAr: string;
    deliveryLabelAr: string;
    loaded: boolean;
}

/**
 * 🔴 v15.51 (شكوى ناصر: «عند تغيير ساعات الاستلام والتوصيل عند التاجر لا
 * يتغيّر في نفس اللحظة عند المشتري») — كانت هذه الخريطةُ **خالدة**: لا مهلةَ
 * ولا إبطال، وصفرُ `cache.delete` في الملفّ كلّه. فمشترٍ فتح صفحةَ عرضٍ لمتجرٍ
 * قبل التغيير يرى الرقمَ القديم **ما بقيت الصفحةُ مفتوحة**، ولو بدّل التاجرُ
 * مهلتَه عشر مرّات.
 *
 * والعلاجُ طبقتان، لا واحدة:
 *   ١) مهلةٌ قصيرة: أيُّ قراءةٍ بعدها تسأل الخادمَ من جديد — سقفٌ للخطأ.
 *   ٢) **بثٌّ لحظيّ** على `store_profiles` حين يتغيّر صفُّ هذا المتجر: يُبطل
 *      الخريطةَ فوراً فيُعاد الحساب في نفس اللحظة. والجدولُ منشورٌ للريل-تايم
 *      أصلاً ومفتاحُه `store_id`، وسياسةُ قراءته `true` للجميع — أي أن كلَّ
 *      القطع كانت موجودةً ولا أحدَ وصلها (قِيس على جدّة).
 * 🪤 ولا يُشترك على الجدول كلِّه: اشتراكٌ بلا مرشِّح لكلّ عميلٍ يعني أن كلَّ
 *    تعديلِ متجرٍ يوقظ كلَّ المتصلين — وهو بعينه ما يُسقط الموقع عند الآلاف.
 *    فالاشتراكُ **بمرشِّح `store_id=eq.<المتجر>`** وعلى المتجر المفتوح وحده.
 */
const TTL_MS = 45_000;
const cache = new Map<string, { pickup: number; delivery: number; at: number }>();
const inFlight = new Map<string, Promise<void>>();

/** يُبطل متجراً واحداً (أو الكلَّ) فتُعاد القراءةُ عند أقرب استعمال. */
export const invalidateStoreHold = (storeId?: string | null): void => {
    const id = (storeId || '').trim();
    if (id) cache.delete(id); else cache.clear();
};

export const useStoreHold = (storeId?: string | null): StoreHold => {
    const { platformSettings } = useApp();
    const plat = platformSettings.bookingHolds;
    const id = (storeId || '').trim();
    const [hit, setHit] = useState(() => (id ? cache.get(id) : undefined));

    useEffect(() => {
        if (!id) { setHit(undefined); return; }
        let alive = true;

        const load = (force = false) => {
            const known = cache.get(id);
            if (!force && known && Date.now() - known.at < TTL_MS) { setHit(known); return; }
            if (force) cache.delete(id);
            const run = inFlight.get(id) || (async () => {
                const r = await refundRepository.storePolicies(id);
                // 🪤 ولا يُخزَّن فشلٌ عابر: `ok:false` تعني «تعذّرت القراءة» لا
                //    «يتبع المنصّة» — وتخزينُه يُجمّد رقماً خاطئاً لبقيّة الجلسة.
                if (r.ok && r.holdPickupHours != null && r.holdDeliveryHours != null) {
                    cache.set(id, { pickup: r.holdPickupHours, delivery: r.holdDeliveryHours, at: Date.now() });
                }
            })().finally(() => inFlight.delete(id));
            inFlight.set(id, run);
            run.then(() => { if (alive) setHit(cache.get(id)); }).catch(() => { /* يبقى افتراضُ المنصّة */ });
        };

        load();

        // البثُّ اللحظيّ على صفّ هذا المتجر وحده.
        const ch = supabase
            .channel(`store-hold-${id}`)
            .on('postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'store_profiles', filter: `store_id=eq.${id}` },
                () => { if (alive) load(true); })
            .subscribe();

        return () => { alive = false; try { supabase.removeChannel(ch); } catch { /* أُغلقت */ } };
    }, [id]);

    const pickup = hit ? hit.pickup : plat.pickupHours;
    const delivery = hit ? hit.delivery : plat.deliveryHours;
    return {
        pickup,
        delivery,
        pickupLabelAr: holdLabel(pickup, true),
        deliveryLabelAr: holdLabel(delivery, true),
        loaded: !!hit,
    };
};

export default useStoreHold;
