/**
 * useOpenOrdersBadge — عددُ الطلبات التي تنتظر التاجر، لشارة «لوحتي».
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 خرج من `AppContext.tsx` في v16.14 حين رفضت السقّافةُ نموَّه — والقاعدةُ
 *    عندنا «قلّص ولا ترفع السقف». وكان الخروجُ مكسباً لا التفافاً: صار
 *    للشارة موضعٌ واحدٌ يُقرأ ويحرسه `scripts/check-live-badge.js`.
 *
 * 🔴 v15.77 (أمرُ ناصر) — نظيرُ شارة «حجوزاتي» للتاجر. والعدُّ **من الخادم**
 *    لأن نافذة `bookings` المحمَّلة ٢٠٠ صفّ للطرفين معاً، فتاجرٌ نشطٌ تكذب
 *    شارتُه. والعدُّ المحلّيُّ يبقى **أرضيّةً** حتى يصل جوابُ الخادم (نفسُ
 *    نمط `notifUnread` المقيس في v14.26).
 *
 * 🔴 v16.14 — **سباقٌ قِيس** (بلاغُ ناصر: «الشارة تبقى ١ ولا تنزل إلّا إذا
 *    خرجتُ من التطبيق»). والدليلُ من القاعدة: الطلبُ `9225912126` خُتم
 *    ٢١:٢٢:٢٥ ولقطةُ الشاشة ٢١:٢٣ والشارةُ ما زالت ١.
 *
 *    والسببُ أن القياسَ كان مربوطاً بالعدّ **المحلّيّ** وحده:
 *      ① `completeBooking` يكتب الحالةَ محلّياً **تفاؤلاً** قبل أن يردّ الخادم.
 *      ② فينزل العدُّ المحلّيُّ من ١ إلى ٠ ⇒ يعمل الأثرُ **فوراً**.
 *      ③ فيسأل الخادمَ وهو **لم يستلم الكتابة بعد** ⇒ يردّ ١.
 *      ④ ثمّ يصل حدثُ الريل‑تايم بعد الالتزام، فلا يُغيّر عدّاً محلّياً هو
 *         صفرٌ أصلاً ⇒ **قائمةُ الاعتماد لا تتغيّر فلا قياسَ ثانياً أبداً**،
 *         و`Math.max` تُبقي الواحدَ الميّت حتى يُعاد تركيبُ السياق.
 *
 *    ⇒ القياسُ يُربط بما يقع **بعد الالتزام**: `bookingEventSeq` مشتقٌّ من
 *      `lastBookingEvent.seq` الذي لا يزيد إلّا على حدثِ قاعدةٍ ملتزَم.
 * 🪤 وتنظيفُ الأثر (`alive = false`) يُبطل جوابَ القياس السابق، فلا يدهس
 *    جوابٌ متأخّرٌ جواباً أحدث منه حين يتوالى حدثان.
 */
import { useEffect, useMemo, useState } from 'react';
import { bookingRepository } from '../repositories/bookingRepository';
import { openOrdersFloor } from './ratingPrompts';

export const useOpenOrdersBadge = (
    bookings: any[],
    userId: string | undefined,
    effectiveUserType: 'buyer' | 'seller' | 'admin',
    /** عدّادُ أحداث الحجز من الريل‑تايم — يزيد **بعد الالتزام** وحده. */
    bookingEventSeq: number,
): number => {
    const storeOpenLocal = useMemo(
        () => openOrdersFloor(bookings, userId), [bookings, userId]);
    const [storeOpenServer, setStoreOpenServer] = useState(0);

    useEffect(() => {
        if (!userId || (effectiveUserType !== 'seller' && effectiveUserType !== 'admin')) {
            setStoreOpenServer(0);
            return;
        }
        let alive = true;
        void bookingRepository.countOpenForStore(userId)
            .then(n => { if (alive) setStoreOpenServer(n); });
        return () => { alive = false; };
    }, [userId, effectiveUserType, storeOpenLocal, bookingEventSeq]);

    return Math.max(storeOpenServer, storeOpenLocal);
};

export default useOpenOrdersBadge;
