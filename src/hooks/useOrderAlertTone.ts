/**
 * useOrderAlertTone — نغمةٌ تتكرّر حتى يُجاب الطلب (v16.57)
 * ═══════════════════════════════════════════════════════════════════════════
 * أمرُ ناصر (٢٤ نوفمبر ٢٠٢٦): «عند إرسال طلبٍ من متجر أريد نفس نغمة الإشعار،
 * ولكن تتكرّر إلى أن يُستلم الطلب من التاجر أو يُلغى من أحد الطرفين — لأن
 * التاجر قد لا ينتبه من نغمةٍ وحدة».
 *
 * 🪤 **والتوقّفُ بمقارنة القائمة لا بحدثٍ بعينه.** ربطُ الإيقاف بـ«حدثِ
 *    استلام» يترك الطلبَ يدقّ إن وصل التغييرُ بمسارٍ آخر: إعادةُ جلبٍ · حدثُ
 *    ريل‑تايم مختلف · إلغاءٌ من المشتري · انتهاءُ المهلة. أمّا مقارنةُ
 *    القائمة فتُصيب كلَّ المسارات: ما خرج منها يتوقّف وما دخلها يبدأ.
 *
 * 🪤 وللتاجر وحده: المشتري يعرف أنه حجز للتوّ، فتكرارُ النغمة عليه إزعاج.
 *
 * 🪤 وأُخرج من `AppContext` لأن السقّافة رفضت نموَّها — **وهي التصميم**:
 *    هذه وحدةٌ قائمةٌ بذاتها لا سطرٌ في سياقٍ من أربعة آلاف سطر.
 */
import { useEffect } from 'react';
import { syncRepeating, stopAllRepeating, unlockSound } from '../services/notificationSound';

export const useOrderAlertTone = (bookings: any[] | undefined, userId: string | undefined): void => {
    /**
     * 🔴 فتحُ قفل الصوت عند أوّل لمسة — وهنا لأن هذا الخطّاف يعمل في كلّ
     *    جلسة. بلا ذلك تُحجب **كلُّ** نغمةٍ في التطبيق بسياسة التشغيل
     *    التلقائي، وهو سببُ «الصوتُ في الكود ولا يُسمع» الذي بلّغ عنه ناصر.
     */
    useEffect(() => { unlockSound(); }, []);

    useEffect(() => {
        if (!userId) { stopAllRepeating(); return; }
        const waiting = (bookings || [])
            .filter((b: any) => b?.status === 'pending' && b?.deal?.storeId === userId)
            .map((b: any) => `order:${b.barcode}`)
            .filter(Boolean);
        syncRepeating(waiting);
    }, [bookings, userId]);

    useEffect(() => () => { stopAllRepeating(); }, []);
};

export default useOrderAlertTone;
