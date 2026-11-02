/**
 * SelfCloseNotice — بوّابةُ «الختم بلا كود» (v15.42)
 * ═══════════════════════════════════════════════════════════════════════════
 * أمرُ ناصر (v15.42 ثمّ v15.44): «استلمتُ طلبي أظهرها بعد ١٠ دقائق **من بعد ما
 * يستلم التاجر الطلب ويضغط تم الاستلام**، لا من بداية إرسال الطلب». فهذا
 * المكوّن يلفّ الزرّ، وله ثلاثُ حالات: قبل تأكيد التاجر (الساعةُ لم تبدأ)،
 * وأثناء العدّ، وبعده يُعرض الزرّ نفسُه بلا أي تغيير فيه.
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
import { selfCloseState, SelfCloseInput } from '../utils/bookingHold';

interface Props {
    /** الطلبُ كما تعرفه الشاشة — منه تُشتقّ لحظةُ فتح الزرّ. */
    booking: SelfCloseInput;
    /** نصُّ الانتظار بعد بدء الساعة؛ يستقبل المدّة المتبقّية مصوغة. */
    waiting: (left: string) => string;
    /** نصُّ ما قبل تأكيد التاجر — المنتظَرُ شخصٌ لا وقت (ومعه المدّةُ الاحتياطيّة). */
    beforeAck: (left: string) => string;
    children: React.ReactNode;
}

export const SelfCloseNotice: React.FC<Props> = ({ booking, waiting, beforeAck, children }) => {
    const { language, platformSettings } = useApp();
    const isRTL = language === 'ar';
    const minutes = platformSettings.bookingHolds.selfCloseMinutes;
    const [now, setNow] = useState(() => Date.now());

    const state = selfCloseState(booking, minutes, now);
    const ticking = !!state;

    // النبضُ يعمل ما دام هناك ما يُعدّ، ويتوقّف من تلقاء نفسه بعده.
    useEffect(() => {
        if (!ticking) return;
        const t = setInterval(() => setNow(Date.now()), 15000);
        return () => clearInterval(t);
    }, [ticking]);

    if (!state) return <>{children}</>;

    return (
        <div style={{
            width: '100%', marginBottom: 20, padding: '11px 14px', borderRadius: 14,
            background: 'var(--body-bg)', border: '1px dashed var(--border-color)',
            color: 'var(--text-secondary)', fontWeight: 800, fontSize: '0.8rem',
            textAlign: 'center',
        }}>
            {state.acknowledged
                ? <>⏳ {waiting(state.label(isRTL))}</>
                : <>🕓 {beforeAck(state.label(isRTL))}</>}
        </div>
    );
};

export default SelfCloseNotice;
