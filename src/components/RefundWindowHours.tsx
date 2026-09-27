/**
 * RefundWindowHours — نافذة الاسترداد المضمون داخل نصٍّ قانونيّ (v14.97)
 * ═══════════════════════════════════════════════════════════════════════════
 * توأمُ `HoldHours` ولنفس السبب: الرقمُ يُضبط من لوحة المدير
 * (`platform_settings.refund_window`)، وهذا هو **المكان الوحيد** الذي يتحوّل
 * فيه إلى نصٍّ معروض. فلا يُكتب «ساعتين» حرفياً في شرطٍ أو سياسةٍ ثمّ يُغيَّر
 * الرقم فتكذب الوثيقة على المشتري (درس v14.12، وقبله v14.10).
 *
 * 🪤 ولا تُصاغ الساعاتُ يدوياً أبداً: «٦ ساعة» و«1 hours» كلاهما خطأ.
 *    `holdLabelGen` وحدها (فوقها `arPlural`) — وحارسٌ في البناء يمنع غيرها.
 *
 * 🪤 و`hours = 0` حالةٌ صالحة تعني «لا نافذة معلنة»، ولذلك يُصدَّر
 *    `useRefundWindow` أيضاً: الصفحة تسأل أوّلاً **هل هناك وعدٌ أصلاً**، ثمّ
 *    تصوغه. عرضُ «خلال ٠ ساعة» وعدٌ سخيف، وحذفُ الجملة هو الصواب.
 */
import React from 'react';
import { useApp } from '../context/AppContext';
import { holdLabel, holdLabelGen } from '../utils/bookingHold';

/** `{ hours, merchantButton }` كما وصلت من القاعدة (أو الافتراض حتى تصل). */
export const useRefundWindow = (): { hours: number; merchantButton: boolean } =>
    useApp().platformSettings.refundWindow;

/** `form="gen"` لصيغة المجرور العربية: «خلال ساعتين» لا «خلال ساعتان». */
export const RefundWindowHours: React.FC<{ form?: 'nom' | 'gen' }> = ({ form = 'gen' }) => {
    const { language, platformSettings } = useApp();
    const isRTL = language === 'ar';
    const n = platformSettings.refundWindow.hours;
    return <>{(form === 'gen' ? holdLabelGen : holdLabel)(n, isRTL)}</>;
};

export default RefundWindowHours;
