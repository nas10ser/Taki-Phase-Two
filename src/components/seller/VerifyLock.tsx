import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { verificationRepository } from '../../repositories/verificationRepository';
import type { MyVerification } from '../../repositories/verificationRepository';
// v16.38 — القرارُ في ملفٍّ خالصٍ ليُختبر بالتنفيذ (هذا الملفّ يستورد
// السياقَ والمستودع، فتحميلُه في Node يُنشئ عميلَ سوبابيس ويرمي).
import { computeVerifyLock } from './verifyLockRule';

/**
 * VerifyLock — يُرمِّد ما لا يقبله الخادمُ قبل التوثيق (v16.38)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 أمرُ ناصر (١٨ نوفمبر ٢٠٢٦): «ما بعد التوثيق بالاسفل لتنزيل المنتج — اعلم
 *    انه لن يقبل، ولكن اجعلها رماديه الى التوثيق: ساعات عمل المحل وسياسة
 *    الاسترداد وما تحتها، حتى يتم توثيق المتجر».
 *    أي: لا تَدَع التاجرَ يملأ حقولاً سيرفضها الخادمُ على أيّ حال — قُل له
 *    **قبل** أن يتعب، لا بعد أن يضغط «نشر».
 *
 * 🔴 **والشرطُ يطابق ما يفرضه الخادمُ حرفاً، لا أكثر.** وهذا أهمُّ ما في
 *    الملفّ: الترميدُ وعدٌ بأن «هذا لن يُقبل»، فإن رمّدنا ما يَقبله الخادمُ
 *    فعلاً صرنا نكذب على التاجر ونمنعه من عملٍ مسموح. فالقفلُ يقع في حالةٍ
 *    واحدة فقط:
 *        الوضعُ `required` · والمتجرُ غيرُ موثّق · ولا مهلةَ انتقاليّة سارية
 *    · `off`      ⇒ لا قفل (التوثيقُ مُطفأ أصلاً ولا شيء يُمنع).
 *    · `advisory` ⇒ **لا قفل** — النشرُ مفتوحٌ تماماً في هذا الوضع، فترميدُه
 *                   منعٌ اخترعناه نحن لا يفرضه أحد.
 *    · `graceUntil` ساريةٌ ⇒ لا قفل: هي امتيازٌ صريحٌ منحه الأدمنُ للنشر.
 *    🪤 و`mode` المقروءُ هنا هو الوضعُ **الفعليّ بعد أثر «وضع السفر»**
 *       (`my_verification_state` تُنزِّل `required` ⇐ `advisory` حين يُفعَّل)
 *       — فلا يُحسب الوضعُ المعلَنُ في الإعدادات مكانَه.
 *
 * 🪤 وحتى تُحسم الحالةُ لا يُقفل شيء: ومضةُ رمادٍ ثمّ ألوانٌ أسوأُ من انتظارٍ
 *    صامت، والأخطرُ منها أن يُقفل متجرٌ موثّقٌ لأن الشبكة تأخّرت لحظة.
 *
 * 🪤 و`pointer-events: none` وحدها لا تكفي للوحة المفاتيح: `inert` تمنع
 *    التركيزَ والقراءةَ الآلية معاً. وهي غيرُ مدعومةٍ في كلّ المتصفّحات بعد،
 *    فتُضبط عبر المرجع (السمةُ تُقبل كنصّ) ويبقى `pointer-events` شبكةَ أمان.
 */

/** حالةُ القفل كما يراها الخادم. `null` = لم تُحسم بعد. */
export const useVerifyLock = (): { locked: boolean; state: MyVerification | null } => {
    const { user, platformSettings } = useApp();
    const userId = user?.id || '';
    const [state, setState] = useState<MyVerification | null>(null);

    const load = useCallback(async () => {
        if (!userId) return;
        const res = await verificationRepository.myState();
        if (res.ok && res.state) setState(res.state);
    }, [userId]);

    useEffect(() => {
        // لا يُسأل الخادمُ إن كان التوثيقُ مُطفأً في الإعدادات — نداءٌ بلا أثر.
        if (platformSettings?.verification?.mode === 'off') return;
        load();
    }, [load, platformSettings?.verification?.mode]);

    return { locked: computeVerifyLock(state, Date.now()), state };
};

/**
 * يلفّ قسماً فيُرمِّده ويُعطّله حتى يُوثَّق المتجر. ولا يُخفيه: التاجرُ يحتاج
 * أن يرى **ما ينتظره** بعد التوثيق، وإخفاؤه يجعل الشاشةَ تبدو ناقصةً بلا سبب.
 */
export const VerifyLock: React.FC<{
    locked: boolean;
    /** نصٌّ قصير يقول لماذا — يظهر فوق المحتوى المرمَّد. */
    note?: string;
    children: React.ReactNode;
}> = ({ locked, note, children }) => {
    const holder = React.useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = holder.current;
        if (!el) return;
        if (locked) el.setAttribute('inert', '');
        else el.removeAttribute('inert');
    }, [locked]);

    if (!locked) return <>{children}</>;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div
                role="status"
                style={{
                    display: 'flex', alignItems: 'center', gap: 9,
                    background: 'var(--notif-unread-bg, rgba(245,158,11,.10))',
                    border: '1px solid var(--primary-light, rgba(245,158,11,.45))',
                    borderRadius: 14, padding: '10px 13px',
                    fontSize: '0.78rem', fontWeight: 800, lineHeight: 1.75,
                    color: 'var(--text-primary)',
                }}
            >
                <span aria-hidden="true" style={{ fontSize: '1.1rem' }}>🔒</span>
                <span>{note || 'تُفتح هذه الأقسام بعد توثيق متجرك — وبطاقة التوثيق أعلى الصفحة.'}</span>
            </div>
            <div
                ref={holder}
                aria-disabled="true"
                style={{ opacity: 0.5, pointerEvents: 'none', filter: 'grayscale(1)' }}
            >
                {children}
            </div>
        </div>
    );
};

export { computeVerifyLock };
export default VerifyLock;
