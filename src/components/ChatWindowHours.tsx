/**
 * ChatWindowHours — مهلةُ الكتابة بعد إغلاق الطلب، داخل نصٍّ ظاهر (v16.18)
 * ═══════════════════════════════════════════════════════════════════════════
 * توأمُ `HoldHours` و`RefundWindowHours` ولنفس السبب المدفوع ثمنُه مرّتين:
 * الرقمُ يُضبط من لوحة المدير (`platform_settings.chat_after_close_hours`)،
 * وهذا هو **المكان الوحيد** الذي يتحوّل فيه إلى نصٍّ معروض. فلا يُكتب
 * «٧٢ ساعة» حرفياً في سؤالٍ شائعٍ ثمّ يُضبط الرقمُ فتكذب الصفحةُ على المشتري.
 *
 * 🔴 وسببُ وجوده بالذات (بلاغُ ناصر ١٣ نوفمبر ٢٠٢٦): الأسئلةُ الشائعة كانت
 *    تقول «تواصل مع التاجر عبر شات الحجز» للاسترداد — **والشاتُ كان يُقفل
 *    لحظةَ الاستلام**. وعدٌ في نصٍّ ظاهرٍ لا ينفّذه الكود، وهو أخطرُ ما نكتبه.
 *
 * 🪤 وصفرٌ حالةٌ صالحةٌ تعني «تُقفل فوراً»، فتُصاغ جملةً أخرى لا «٠ ساعة».
 */
import React from 'react';
import { useApp } from '../context/AppContext';
import { holdLabelGen } from '../utils/bookingHold';

export const useChatWindowHours = (): number =>
    useApp().platformSettings.chatAfterCloseHours;

const ChatWindowHours: React.FC = () => {
    const { language, platformSettings } = useApp();
    const isRTL = language === 'ar';
    const n = platformSettings.chatAfterCloseHours;
    if (!(n > 0)) return <>{isRTL ? 'حتى لحظة إغلاق الطلب' : 'until the order closes'}</>;
    return <>{isRTL ? `لمدّة ${holdLabelGen(n, true)}` : `for ${holdLabelGen(n, false)}`}</>;
};

export default ChatWindowHours;
