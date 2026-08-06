import React from 'react';
import { Deal } from '../data/mock';
import { isDealComingSoon, formatComingSoonRemaining, dealLifespanStart } from '../utils/helpers';
import { useCountdownTick } from '../utils/useCountdownTick';

/**
 * DealCountdown — شارة الوقت المتبقّي على بطاقة العرض (v13.61)
 *
 * كانت هذه الشارة جزءاً من `DealCard`، وكل ثانية تُحدِّث حالة البطاقة كاملة —
 * أي أن عنصر الصورة وكل الشارات تمرّ في دورة تصالُح React عشرين مرة في الثانية
 * على شاشة فيها عشرون بطاقة. عزلناها في مكوّن مستقلّ **يقرأ نبضة مشتركة
 * واحدة**، فصار التحديث نصّاً صغيراً في عقدة واحدة لا غير: التمرير يبقى
 * سلساً ولا تُعاد رسم الصور إطلاقاً.
 */

const formatRemaining = (createdAt: number, expiresInMinutes: number, isRTL: boolean): { text: string; urgent: boolean; expired: boolean } => {
    const lifespan = (expiresInMinutes || 0) * 60 * 1000;
    const expiry = (createdAt || 0) + lifespan;
    const diff = expiry - Date.now();
    if (diff <= 0) return { text: isRTL ? 'منتهي' : 'Expired', urgent: false, expired: true };

    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff / 3600000) % 24);
    const mins = Math.floor((diff / 60000) % 60);
    const secs = Math.floor((diff / 1000) % 60);
    const urgent = diff < 3600000; // less than 1 hour

    if (days > 0) return { text: isRTL ? `${days}ي ${hours}س` : `${days}d ${hours}h`, urgent: false, expired: false };
    if (hours > 0) return { text: isRTL ? `${hours}س ${mins}د` : `${hours}h ${mins}m`, urgent, expired: false };
    if (mins > 0) return { text: isRTL ? `${mins}د ${secs.toString().padStart(2, '0')}ث` : `${mins}m ${secs}s`, urgent: true, expired: false };
    return { text: isRTL ? `${secs}ث` : `${secs}s`, urgent: true, expired: false };
};

interface Props {
    deal: Deal;
    isRTL: boolean;
    comingSoon: boolean;
}

const DealCountdown: React.FC<Props> = ({ deal, isRTL, comingSoon }) => {
    // النبضة المشتركة: كل العدّادات على الشاشة تتحدّث في نفس الإطار، مرة/ثانية.
    useCountdownTick();

    // v11.20 — العرض القادم يعدّ تنازلياً حتى الإطلاق (startsAt) لا حتى الانتهاء.
    const remaining = comingSoon && deal.startsAt
        ? (() => { const r = formatComingSoonRemaining(deal.startsAt!, isRTL); return { text: r.text, urgent: r.urgent, expired: false }; })()
        : formatRemaining(dealLifespanStart(deal), deal.expiresInMinutes || 0, isRTL);

    return (
        <div style={{
            position: 'absolute',
            bottom: 10,
            [isRTL ? 'left' : 'right']: 10,
            background: remaining.expired
                ? 'rgba(100,116,139,0.92)'
                : comingSoon && remaining.urgent
                    ? 'linear-gradient(135deg, #dc2626, #b91c1c)'
                    : comingSoon
                        ? 'linear-gradient(135deg, #6366f1, #4f46e5)'
                        : remaining.urgent
                            ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
                            : 'rgba(15,23,42,0.78)',
            color: 'white',
            padding: '4px 10px',
            borderRadius: 8,
            fontSize: '0.7rem',
            fontWeight: 900,
            boxShadow: (remaining.urgent || comingSoon) ? '0 2px 10px rgba(99,102,241,0.45)' : '0 2px 6px rgba(0,0,0,0.25)',
            animation: remaining.urgent && !remaining.expired ? 'pulse 1.4s ease-in-out infinite' : 'none',
            display: 'flex', alignItems: 'center', gap: 4,
            zIndex: 2,
        }}>
            <span style={{ fontSize: '0.75rem' }}>{remaining.expired ? '⏹' : comingSoon ? '⏳' : '⏱'}</span>
            <span>{remaining.text}</span>
        </div>
    );
};

export default React.memo(DealCountdown);

// يُصدَّر للاختبار/إعادة الاستخدام — نفس صياغة الوقت المستعملة في البطاقات.
export { formatRemaining };
