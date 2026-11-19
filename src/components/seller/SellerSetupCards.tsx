import React from 'react';
import PaymentDeclarationCard from './PaymentDeclarationCard';
import VatStatusCard from './VatStatusCard';
import StorePoliciesCard from './StorePoliciesCard';
import { VerifyLock } from './VerifyLock';
import { lazyBoundary } from '../../utils/lazyBoundary';

const WorkingHoursEditor = lazyBoundary(() => import('../WorkingHoursEditor'));
const ReferralCard = lazyBoundary(() => import('./ReferralCard'));
const GatewayCard = lazyBoundary(() => import('./GatewayCard'));
const StockLinkCard = lazyBoundary(() => import('./StockLinkCard'));

/**
 * SellerSetupCards — بطاقاتُ تهيئة المتجر فوق نموذج العرض (v16.38)
 * ═══════════════════════════════════════════════════════════════════════════
 * خرجت من `SellerDashboard.tsx` لسببين، أوّلهما تصميميّ:
 *   ① **السقّافة**: اللوحةُ ملفٌّ مُعلَنٌ ضخماً (٥٥٠٤ سطراً) ولا يُسمح له أن
 *      ينمو سطراً. وإضافةُ قفل التوثيق تحتاج غلافاً حول ستّ بطاقات — فالنقلُ
 *      هو الحلّ لا رفعُ السقف (قاعدةُ المشروع: **قلّص، لا ترفع السقف**).
 *   ② وهذه البطاقاتُ وحدةٌ واحدة معنى: «ما يجب أن يكتمل قبل أن يبيع المتجر».
 *
 * 🔴 **والترتيبُ مقصودٌ ولا يُبعثر** (أمرُ ناصر ١٨ نوفمبر):
 *    · `PaymentDeclarationCard` يبقى **مفتوحاً دائماً** — هو أوّلُ ما يُسأل
 *      عنه التاجر، وبلا جوابه ترفض القاعدةُ كلَّ حجزٍ على المتجر أصلاً.
 *      وناصرٌ بدأ قائمةَ الترميد من «ساعات العمل» لا من قبلها.
 *    · ومن «ساعات العمل» فما تحتها ⇒ داخل `VerifyLock`: ساعاتُ العمل ·
 *      سياسةُ الاسترداد · الوضعُ الضريبيّ · بوّابةُ الدفع · ربطُ المخزون ·
 *      رابطُ الدعوة.
 *
 * 🪤 والقفلُ يُحسب **مرّةً واحدة هنا** ويُمرَّر إلى نموذج العرض في اللوحة،
 *    فلا يُسأل الخادمُ مرّتين عن نفس الشيء في نفس الشاشة.
 */
export const SellerSetupCards: React.FC<{
    userId: string;
    isRTL: boolean;
    onAlert: (msg: string) => void;
    workingHours: unknown;
    hoursSaving: boolean;
    onSaveHours: (v: unknown) => void;
    locked: boolean;
}> = ({ userId, isRTL, onAlert, workingHours, hoursSaving, onSaveHours, locked }) => (
    <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* v14.08 (بلاغ ناصر: «متجر لم يضع طريقة الحساب وأستطيع الحجز») —
            الإقرار أولاً وفوق كل شيء: بلا جوابٍ عليه ترفض القاعدة كل حجز
            على هذا المتجر، فلا معنى لأن يملأ التاجر نموذج منتج قبله. */}
        <div id="setup-pay"><PaymentDeclarationCard userId={userId} isRTL={isRTL} onAlert={onAlert} /></div>

        <VerifyLock locked={locked} note="تُفتح ساعاتُ العمل وسياسةُ الاسترداد وما تحتها بعد توثيق متجرك — وبطاقةُ التوثيق أعلى الصفحة.">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div id="setup-hours">
                    <WorkingHoursEditor value={workingHours as never} isRTL={isRTL} saving={hoursSaving} onSave={onSaveHours as never} />
                </div>
                {/* v14.18 — سياسة الاسترداد والاستبدال وشروط المتجر: تُعرض
                    للمشتري في صفحة المتجر وفي صفحة العرض **قبل الحجز**. */}
                <div id="setup-refund"><StorePoliciesCard /></div>
                {/* v13.38 — الوضع الضريبي للتاجر: يحدّد شكل فواتير طلباته. */}
                <div id="setup-vat"><VatStatusCard userId={userId} isRTL={isRTL} onAlert={onAlert} /></div>
                {/* v12.81 — الدفع المباشر لحساب التاجر (0% عمولة). */}
                <GatewayCard userId={userId} isRTL={isRTL} onAlert={onAlert} />
                {/* v15.10 — اربط مخزونك بنظامك: بعد بوّابة الدفع، فكلاهما ربطٌ خارجيّ. */}
                <StockLinkCard />
                {/* v12.30 — رابط دعوة العملاء + باركود QR (الإحالة تُنسب للمتجر). */}
                <ReferralCard isRTL={isRTL} onAlert={onAlert} />
            </div>
        </VerifyLock>
    </div>
);

export default SellerSetupCards;
