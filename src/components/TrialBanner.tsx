import React, { useMemo } from 'react';
import { useHistory } from 'react-router-dom';
import { MerchantSubscription } from '../repositories/subscriptionRepository';

interface Props {
    subscription: MerchantSubscription | null;
    isRTL: boolean;
    showCTA?: boolean;
}

/**
 * Phase 2.3 — banner shown at the top of the seller dashboard.
 * Renders the trial countdown, frozen-state alert, or active period.
 */
const TrialBanner: React.FC<Props> = ({ subscription, isRTL, showCTA = true }) => {
    const history = useHistory();

    const info = useMemo(() => {
        if (!subscription) return null;

        const now = Date.now();

        if (subscription.status === 'trial' && subscription.trialEndsAt) {
            const ends = new Date(subscription.trialEndsAt).getTime();
            const daysLeft = Math.max(0, Math.ceil((ends - now) / 86400000));
            return {
                tone: daysLeft <= 3 ? 'warn' : 'info',
                titleAr: '🎁 تجربتك المجانية',
                titleEn: '🎁 Your Free Trial',
                bodyAr: daysLeft <= 0
                    ? 'انتهت الفترة المجانية — اشترك لاستئناف نشر العروض.'
                    : `متبقي ${daysLeft} يوم${daysLeft === 1 ? '' : 'اً'} من الـ 14 يوم المجانية. استمتع بكامل الميزات.`,
                bodyEn: daysLeft <= 0
                    ? 'Your trial has ended — subscribe to keep publishing.'
                    : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left of your free trial. Enjoy every feature.`,
                ctaAr: 'اشترك الآن',
                ctaEn: 'Subscribe Now'
            };
        }

        if (subscription.status === 'frozen') {
            return {
                tone: 'danger',
                titleAr: '⚠️ حسابك مجمّد',
                titleEn: '⚠️ Account Frozen',
                bodyAr: 'لا يمكنك إضافة عروض جديدة حتى تجدّد الاشتراك. عروضك الحالية تبقى ظاهرة للزبائن.',
                bodyEn: 'You cannot publish new deals until you renew. Your existing deals stay visible to customers.',
                ctaAr: 'تفعيل الاشتراك',
                ctaEn: 'Reactivate Subscription'
            };
        }

        if (subscription.status === 'active' || subscription.status === 'gifted') {
            const ends = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).getTime() : null;
            const daysLeft = ends ? Math.max(0, Math.ceil((ends - now) / 86400000)) : null;
            return {
                tone: 'success',
                titleAr: subscription.status === 'gifted' ? '🎁 اشتراك مهدى من الإدارة' : '✅ اشتراكك نشط',
                titleEn: subscription.status === 'gifted' ? '🎁 Gifted Subscription' : '✅ Subscription Active',
                bodyAr: daysLeft != null
                    ? `يتبقى ${daysLeft} يوم${daysLeft === 1 ? '' : 'اً'} على نهاية الفترة الحالية.`
                    : 'استمر بالنشر بدون قيود.',
                bodyEn: daysLeft != null
                    ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining in your period.`
                    : 'Keep publishing without limits.',
                ctaAr: 'إدارة الاشتراك',
                ctaEn: 'Manage Subscription'
            };
        }

        return null;
    }, [subscription]);

    if (!info) return null;

    const tone = info.tone;
    const tones: Record<string, { bg: string; border: string; color: string; cta: string }> = {
        info:    { bg: 'linear-gradient(135deg, #dbeafe, #bfdbfe)', border: '#93c5fd', color: '#1e3a8a', cta: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' },
        warn:    { bg: 'linear-gradient(135deg, #fef3c7, #fde68a)', border: '#fbbf24', color: '#78350f', cta: 'linear-gradient(135deg, #f59e0b, #b45309)' },
        success: { bg: 'linear-gradient(135deg, #d1fae5, #a7f3d0)', border: '#34d399', color: '#064e3b', cta: 'linear-gradient(135deg, #10b981, #047857)' },
        danger:  { bg: 'linear-gradient(135deg, #fee2e2, #fecaca)', border: '#f87171', color: '#7f1d1d', cta: 'linear-gradient(135deg, #ef4444, #b91c1c)' }
    };
    const t = tones[tone] || tones.info;

    return (
        <div style={{
            margin: '12px 16px 8px',
            background: t.bg,
            border: `1.5px solid ${t.border}`,
            borderRadius: 16,
            padding: '14px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            flexWrap: 'wrap'
        }}>
            <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 900, fontSize: '0.95rem', color: t.color, marginBottom: 4 }}>
                    {isRTL ? info.titleAr : info.titleEn}
                </div>
                <div style={{ fontSize: '0.83rem', fontWeight: 600, color: t.color, opacity: 0.85, lineHeight: 1.5 }}>
                    {isRTL ? info.bodyAr : info.bodyEn}
                </div>
            </div>
            {showCTA && (
                <button
                    onClick={() => history.push('/seller?tab=subscription')}
                    style={{
                        padding: '10px 16px',
                        borderRadius: 12,
                        border: 'none',
                        background: t.cta,
                        color: 'white',
                        fontWeight: 900,
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        flexShrink: 0,
                        boxShadow: '0 6px 14px rgba(0,0,0,0.15)'
                    }}
                >
                    {isRTL ? info.ctaAr : info.ctaEn}
                </button>
            )}
        </div>
    );
};

export default React.memo(TrialBanner);
