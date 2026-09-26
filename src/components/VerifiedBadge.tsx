/**
 * VerifiedBadge — «متجر موثّق» كما يراها المشتري (v14.95)
 * ═══════════════════════════════════════════════════════════════════════════
 * هذه الشارةُ هي **الشيء الوحيد** الذي يرى المشتري من نظام التوثيق كلّه. وما
 * دونها (الطلب · المراجعة · الرفض · السحب) شأنٌ بين التاجر والإدارة.
 *
 * 🪤 بوّابةُ الإظهار (`show_badge`) **على الخادم داخل `store_is_verified`** —
 *    ولا يُضاف فحصٌ ثانٍ هنا من `platformSettings`. مفتاحٌ واحد بمصدرين
 *    يفترقان بصمت: ذاك بالضبط عيبُ v14.71 (عمودان في جدولين وكاتبان لا يعرف
 *    أحدهما الآخر). فإن لم تظهر الشارة، فالمفتاح مُطفأ أو المتجر غير موثّق —
 *    لا ثالث.
 *
 * 🪤 ولا تُعرض «غير موثّق» أبداً: نفيٌ على صفحة متجرٍ قائم تهمةٌ لا معلومة،
 *    والوضع الافتراضي `off` يجعلها تهمةً عامّة على كل التجّار.
 *
 * والألوان كلّها من المتغيّرات: أي لونٍ ثابتٍ هنا يختفي في أحد الثيمين، والشارةُ
 * تظهر على بطاقةٍ وعلى رأس صفحةٍ وداخل نصّ — على ثلاث خلفياتٍ مختلفة.
 */
import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { verificationRepository } from '../repositories/verificationRepository';

export const VerifiedBadge: React.FC<{ storeId: string; compact?: boolean }> = ({ storeId, compact = false }) => {
    const { language } = useApp();
    const isRTL = language === 'ar';
    const [verified, setVerified] = useState(false);

    useEffect(() => {
        let alive = true;
        setVerified(false);
        if (!storeId) return;
        // الدالّة مُتاحة للزائر بلا حساب عمداً، وتبتلع أي فشلٍ إلى `false`:
        // شارةٌ لا تظهر أهونُ من خطأ على صفحة متجر.
        verificationRepository.isVerified(storeId)
            .then(v => { if (alive) setVerified(v); })
            .catch(() => { /* مبتلَعٌ داخل المستودع أصلاً */ });
        return () => { alive = false; };
    }, [storeId]);

    if (!verified) return null;

    const label = isRTL ? 'متجر موثّق' : 'Verified store';

    return (
        <span
            title={isRTL
                ? 'راجعت إدارة تاكي سجل هذا المتجر واعتمدته.'
                : 'TAKI reviewed and approved this store’s registration.'}
            style={{
                display: 'inline-flex', alignItems: 'center', gap: compact ? 3 : 5,
                background: 'var(--card-bg)',
                border: '1px solid var(--border-color)',
                borderRadius: 999,
                padding: compact ? '2px 7px' : '4px 10px',
                fontSize: compact ? '0.66rem' : '0.74rem',
                fontWeight: 800,
                color: 'var(--text-primary)',
                lineHeight: 1.6,
                whiteSpace: 'nowrap',
                direction: isRTL ? 'rtl' : 'ltr',
            }}
        >
            <span aria-hidden="true">✅</span>
            <span>{label}</span>
        </span>
    );
};

export default VerifiedBadge;
