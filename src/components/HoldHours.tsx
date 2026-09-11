/**
 * HoldHours — مهلة الحجز داخل أي جملة، مقروءةً من الإعدادات لا مكتوبةً نصّاً.
 *
 * تُستعمل داخل نصوص الشروط والاسترداد والأسئلة الشائعة، وهي المكوّن الوحيد
 * الذي يُدخل الرقم في نصٍّ قانوني. فحين يضبط ناصر المهلة من لوحة المدير
 * (`platform_settings.booking_holds`) تتغيّر كل هذه الجمل معاً في اللحظة نفسها،
 * ولا يبقى وعدٌ مكتوب يخالف ما تفرضه القاعدة على الطلب فعلاً.
 *
 * `form="gen"` لصيغة المجرور العربية: «خلال ساعتين» لا «خلال ساعتان».
 */
import React from 'react';
import { useApp } from '../context/AppContext';
import { holdLabel, holdLabelGen } from '../utils/bookingHold';

export const HoldHours: React.FC<{ kind: 'pickup' | 'delivery'; form?: 'nom' | 'gen' }> = ({ kind, form = 'nom' }) => {
    const { language, platformSettings } = useApp();
    const isRTL = language === 'ar';
    const n = kind === 'delivery'
        ? platformSettings.bookingHolds.deliveryHours
        : platformSettings.bookingHolds.pickupHours;
    return <>{(form === 'gen' ? holdLabelGen : holdLabel)(n, isRTL)}</>;
};

export default HoldHours;
