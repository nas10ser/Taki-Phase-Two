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
import { holdLabel } from '../utils/bookingHold';

export interface StoreHold {
    pickup: number;
    delivery: number;
    /** الصياغةُ هنا لا في الشاشة: `bookingHold.ts` هو محرّكها الوحيد. */
    pickupLabelAr: string;
    deliveryLabelAr: string;
    loaded: boolean;
}

const cache = new Map<string, { pickup: number; delivery: number }>();
const inFlight = new Map<string, Promise<void>>();

export const useStoreHold = (storeId?: string | null): StoreHold => {
    const { platformSettings } = useApp();
    const plat = platformSettings.bookingHolds;
    const id = (storeId || '').trim();
    const [hit, setHit] = useState(() => (id ? cache.get(id) : undefined));

    useEffect(() => {
        if (!id) { setHit(undefined); return; }
        const known = cache.get(id);
        if (known) { setHit(known); return; }
        let alive = true;
        const run = inFlight.get(id) || (async () => {
            const r = await refundRepository.storePolicies(id);
            // 🪤 ولا يُخزَّن فشلٌ عابر: `ok:false` تعني «تعذّرت القراءة» لا
            //    «يتبع المنصّة» — وتخزينُه يُجمّد رقماً خاطئاً لبقيّة الجلسة.
            if (r.ok && r.holdPickupHours != null && r.holdDeliveryHours != null) {
                cache.set(id, { pickup: r.holdPickupHours, delivery: r.holdDeliveryHours });
            }
        })().finally(() => inFlight.delete(id));
        inFlight.set(id, run);
        run.then(() => { if (alive) setHit(cache.get(id)); }).catch(() => { /* يبقى افتراضُ المنصّة */ });
        return () => { alive = false; };
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
