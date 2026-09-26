/**
 * SellerSetupStack — عمود التهيئة في أعلى لوحة التاجر (v14.95)
 * ═══════════════════════════════════════════════════════════════════════════
 * `SetupPath` يقول للتاجر **ما ينقص متجره**، و`VerificationCard` تقول له **من
 * أنت في السجل** — وكلاهما يُقرأ قبل أي تبويب، فمكانهما واحد وترتيبهما ثابت:
 * سدّ النواقص أوّلاً (بها يصير المتجر قابلاً للبيع أصلاً)، ثمّ التوثيق.
 *
 * ولماذا ملفٌّ وسيط بدل سطرٍ ثانٍ في اللوحة: `SellerDashboard.tsx` **مُعلَنٌ في
 * سقّافة الأحجام** (`check-file-size.js`) فلا يُسمح له أن ينمو سطراً واحداً.
 * فصُمّم هذا المكوّن ليكون **بديلاً مباشراً** لـ`SetupPath`: نفس الخصائص، ونفس
 * ما كان يُستورد منه (`notifySetupGapsChanged` · `SetupAnchor`) — فالتبديل في
 * اللوحة سطرُ الاستيراد وحده، ولا يتغيّر موضع الاستعمال ولا عدد الأسطر.
 *
 * 🪤 ولذلك لا يُعاد تسمية شيء هنا ولا تُضاف خاصّية: أي اختلافٍ في سطح التصدير
 *    يحوّل «تبديل سطر» إلى تعديلٍ يُنمي ملفّاً ممنوعاً من النموّ.
 */
import React from 'react';
import SetupPath from './SetupPath';
import VerificationCard from './VerificationCard';

/** سطح التصدير نفسه الذي كانت اللوحة تستورده من `SetupPath`. */
export { notifySetupGapsChanged, SETUP_GAPS_CHANGED } from './SetupPath';
export type { SetupAnchor } from './SetupPath';

/** الخصائص تُشتقّ من `SetupPath` نفسه، فلا تنحرف نسخةٌ ثانية منها هنا. */
type Props = React.ComponentProps<typeof SetupPath>;

const SellerSetupStack: React.FC<Props> = (props) => (
    <>
        <SetupPath {...props} />
        {/* لا تأخذ خصائص: تقرأ الحساب واللغة وإعدادات المنصّة من السياق،
            ولا تُرسم إطلاقاً حين يكون وضع التوثيق `off`. */}
        <VerificationCard />
    </>
);

export default SellerSetupStack;
