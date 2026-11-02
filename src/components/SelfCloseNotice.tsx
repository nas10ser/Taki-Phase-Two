/**
 * SelfCloseNotice — بوّابةُ «الختم بلا كود» (v15.42)
 * ═══════════════════════════════════════════════════════════════════════════
 * أمرُ ناصر: «استلمتُ طلبي أظهرها بعد استلام الطلب من المتجر ١٠ دقائق ولا
 * تظهرها مباشرة». فهذا المكوّن يلفّ الزرّ: ما بقيت المهلةُ يعرض سطراً هادئاً
 * يقول متى يُفتح، وبعدها يعرض الزرّ نفسَه بلا أي تغيير فيه.
 *
 * 🪤 ولماذا سطرٌ لا زرٌّ معطَّل: زرٌّ ظاهرٌ يرفضه الخادمُ يصنع فشلاً بلا سبب
 *    مفهوم (درس v14.08) — والسطرُ يقول الشرطَ قبل أن يُحاول أحدٌ.
 * 🪤 والعدّادُ يملك حالتَه هو: `setInterval` في صفحة الحجوزات كان سيُعيد تصيير
 *    القائمةَ كلَّها كلَّ ثانية (درسُ «مؤقّتٌ لكلّ بطاقة» في وميض التمرير).
 *    والنبضُ ١٥ ثانية لأن المعروض دقائقُ لا ثوانٍ.
 * 🔴 وهذا **مرآةٌ لا حارس**: القاعدة تفرض نفسَ المهلة في
 *    `buyer_confirm_receipt` و`merchant_handover_booking` (P0028)، فحتى لو
 *    عُطّل هذا المكوّن لا يُختم طلبٌ قبل وقته.
 */
import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { selfCloseLeft } from '../utils/bookingHold';

interface Props {
    /** لحظةُ وصول الطلب إلى المتجر (مللي ثانية) — `bookings.booked_at`. */
    bookedAt: number | null | undefined;
    /** نصُّ السطر الهادئ أثناء الانتظار؛ يستقبل المدّة المتبقّية مصوغة. */
    waiting: (left: string) => string;
    children: React.ReactNode;
}

export const SelfCloseNotice: React.FC<Props> = ({ bookedAt, waiting, children }) => {
    const { language, platformSettings } = useApp();
    const isRTL = language === 'ar';
    const minutes = platformSettings.bookingHolds.selfCloseMinutes;
    const [now, setNow] = useState(() => Date.now());

    const left = selfCloseLeft(bookedAt, minutes, now);

    // النبضُ يتوقّف من تلقاء نفسه حين لا يبقى ما يُعدّ — فلا مؤقّتٌ أبديّ.
    useEffect(() => {
        if (!left) return;
        const t = setInterval(() => setNow(Date.now()), 15000);
        return () => clearInterval(t);
    }, [!!left]);

    if (!left) return <>{children}</>;

    return (
        <div style={{
            width: '100%', marginBottom: 20, padding: '11px 14px', borderRadius: 14,
            background: 'var(--body-bg)', border: '1px dashed var(--border-color)',
            color: 'var(--text-secondary)', fontWeight: 800, fontSize: '0.8rem',
            textAlign: 'center',
        }}>
            ⏳ {waiting(left.label(isRTL))}
        </div>
    );
};

export default SelfCloseNotice;
