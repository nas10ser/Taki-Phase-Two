import React, { useMemo } from 'react';
import { useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import BottomNav from '../components/BottomNav';
import DealCard from '../components/DealCard';
import { Deal } from '../data/mock';
import { getSeasonById, campaignPublicLive, campaignSellerOpen } from '../data/seasons';
import { isDealComingSoon, isDealExpiredByTime } from '../utils/helpers';
import { useNowTick } from '../utils/useNowTick';

/**
 * v12.48 — صفحة عروض الموسم الحصرية (أعيد بناؤها من placeholder «قريباً»).
 * تعرض فقط العروض التي وسمها التجار بموسم الحملة النشطة (deals.season_id)
 * داخل النافذة التي حددها المالك. الوصول:
 *  - العامة: خلال النافذة العامة (public_from → public_to) فقط — البوابة في
 *    App.tsx (SeasonalGate) تعيد التوجيه للرئيسية خارجها.
 *  - التجار والأدمن: معاينة مبكرة خلال نافذة إضافة العروض.
 */
const SeasonalOffers: React.FC = () => {
    const history = useHistory();
    const { language, deals, platformSettings, blockedMerchants, user } = useApp();
    const isRTL = language === 'ar';
    const nowTick = useNowTick(15000);

    const camp = platformSettings.seasonCampaign;
    const season = camp ? getSeasonById(camp.seasonId) : undefined;
    const publicLive = campaignPublicLive(camp);
    const earlyPreview = !publicLive && campaignSellerOpen(camp)
        && (user?.userType === 'seller' || user?.userType === 'admin');

    const hasStock = (d: Deal) => {
        if (d.quantity === 'unlimited') return true;
        if (typeof d.quantity === 'number' && d.quantity > 0) return true;
        const initial = d.initialQuantity;
        return !(typeof initial === 'number' && initial > 0);
    };

    const seasonDeals = useMemo(() => {
        if (!camp) return [];
        return deals
            .filter(d => d.seasonId === camp.seasonId
                && d.status === 'active'
                && !isDealComingSoon(d)
                && !isDealExpiredByTime(d)
                && hasStock(d)
                && !blockedMerchants.includes(d.storeId))
            .sort((a, b) => b.discountPercentage - a.discountPercentage);
    }, [deals, camp?.seasonId, blockedMerchants, nowTick]);

    if (!season || !camp) return null; // البوابة في App.tsx تمنع الوصول أصلاً

    return (
        <div className="page-content" style={{ background: 'var(--body-bg)', minHeight: '100vh', direction: isRTL ? 'rtl' : 'ltr' }}>
            {/* هيدر الموسم — تدرّج الموسم نفسه (مستقل عن الثيم الحالي) */}
            <div style={{
                background: season.swatch, color: '#fff', padding: '26px 20px 30px',
                borderRadius: '0 0 28px 28px', position: 'relative', overflow: 'hidden',
                textAlign: 'center', boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
            }}>
                <button
                    onClick={() => history.push('/')}
                    aria-label={isRTL ? 'العودة للرئيسية' : 'Back to home'}
                    style={{
                        position: 'absolute', top: 16, [isRTL ? 'right' : 'left']: 16,
                        background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.3)',
                        borderRadius: 12, padding: '7px 14px', color: '#fff', fontWeight: 800, fontSize: '0.8rem', cursor: 'pointer',
                    }}>
                    {isRTL ? '← العودة' : '← Back'}
                </button>
                <div style={{ fontSize: '3rem', lineHeight: 1, marginBottom: 10, filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.35))' }}>{season.emoji}</div>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 900, marginBottom: 6, textShadow: '0 2px 8px rgba(0,0,0,0.25)' }}>
                    {isRTL ? `عروض ${season.ar}` : `${season.en} Deals`}
                </h1>
                <p style={{ fontSize: '0.82rem', fontWeight: 600, opacity: 0.94, maxWidth: 420, margin: '0 auto', lineHeight: 1.6 }}>
                    {isRTL ? season.taglineAr : season.taglineEn}
                </p>
                {camp.publicFrom && camp.publicTo && (
                    <div style={{
                        display: 'inline-block', marginTop: 12, padding: '6px 14px', borderRadius: 999,
                        background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.28)',
                        fontSize: '0.72rem', fontWeight: 800,
                    }}>
                        {isRTL ? `🗓 من ${camp.publicFrom} إلى ${camp.publicTo}` : `🗓 ${camp.publicFrom} → ${camp.publicTo}`}
                    </div>
                )}
                {earlyPreview && (
                    <div style={{
                        marginTop: 10, display: 'inline-block', padding: '6px 14px', borderRadius: 999,
                        background: 'rgba(0,0,0,0.28)', fontSize: '0.72rem', fontWeight: 800,
                    }}>
                        {isRTL ? '👁 معاينة مبكرة (للتجار والإدارة) — لم تُفتح للعامة بعد' : '👁 Early preview (sellers & admins)'}
                    </div>
                )}
            </div>

            {/* شبكة العروض الموسومة */}
            <div style={{ padding: '18px 16px 120px' }}>
                {seasonDeals.length > 0 ? (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 0 12px' }}>
                            <h2 style={{ fontSize: '1.02rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                                {isRTL ? `${seasonDeals.length} عرض حصري 🎯` : `${seasonDeals.length} exclusive deals 🎯`}
                            </h2>
                        </div>
                        <div className="taki-deals-grid" style={{ display: 'grid', gap: 10 }}>
                            {seasonDeals.map(deal => (
                                <DealCard key={deal.id} deal={deal} onClick={(id) => history.push(`/deal/${id}`)} />
                            ))}
                        </div>
                    </>
                ) : (
                    <div style={{
                        textAlign: 'center', padding: '70px 20px',
                        background: 'var(--card-bg)', borderRadius: 24, border: '1px dashed var(--border-color)',
                    }}>
                        <div style={{ fontSize: '3.4rem', marginBottom: 16 }}>{season.emoji}</div>
                        <div style={{ fontWeight: 900, fontSize: '1.05rem', color: 'var(--text-primary)', marginBottom: 8 }}>
                            {isRTL ? 'التجار يجهّزون عروض الموسم الآن' : 'Sellers are preparing their seasonal deals'}
                        </div>
                        <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 600, lineHeight: 1.7, maxWidth: 340, margin: '0 auto' }}>
                            {isRTL
                                ? 'عد قريباً — العروض الحصرية تُضاف تباعاً طوال فترة الموسم.'
                                : 'Check back soon — exclusive deals are being added throughout the season.'}
                        </div>
                    </div>
                )}
            </div>

            <BottomNav />
        </div>
    );
};

export default SeasonalOffers;
