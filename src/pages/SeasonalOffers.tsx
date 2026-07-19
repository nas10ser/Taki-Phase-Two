import React, { useMemo, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import BottomNav from '../components/BottomNav';
import DealCard from '../components/DealCard';
import { Deal, CATEGORIES, GENDERS, Category, GenderTarget } from '../data/mock';
import { getSeasonById, campaignPublicLive, campaignSellerOpen } from '../data/seasons';
import { isDealComingSoon, isDealExpiredByTime, getAuthenticityBadge } from '../utils/helpers';
import { useNowTick } from '../utils/useNowTick';
import { getShopStatus } from '../utils/workingHours';
import { dealService } from '../services/dealService';

/**
 * v12.48 — صفحة عروض الموسم الحصرية (أعيد بناؤها من placeholder «قريباً»).
 * تعرض فقط العروض التي وسمها التجار بموسم الحملة النشطة (deals.season_id)
 * داخل النافذة التي حددها المالك. الوصول:
 *  - العامة: خلال النافذة العامة (public_from → public_to) فقط — البوابة في
 *    App.tsx (SeasonalGate) تعيد التوجيه للرئيسية خارجها.
 *  - التجار والأدمن: معاينة مبكرة خلال نافذة إضافة العروض.
 * v12.50 — الهيدر يحترم المساحة الآمنة أعلى iOS (كان يلاصق ساعة الجوال)،
 * وأضيفت نفس فلاتر قائمة العروض: مفتوح الآن/كل المحلات/عروض حقيقية +
 * الفئة العمرية + التصنيف + بحث + زر ترتيب.
 */
const SeasonalOffers: React.FC = () => {
    const history = useHistory();
    const { language, deals, platformSettings, blockedMerchants, user, storeProfiles } = useApp();
    const isRTL = language === 'ar';
    const nowTick = useNowTick(15000);

    const camp = platformSettings.seasonCampaign;
    const season = camp ? getSeasonById(camp.seasonId) : undefined;
    const publicLive = campaignPublicLive(camp);
    const earlyPreview = !publicLive && campaignSellerOpen(camp)
        && (user?.userType === 'seller' || user?.userType === 'admin');

    // فلاتر مطابقة لقائمة العروض (DealsList)
    const [openNow, setOpenNow] = useState(true);
    const [verifiedOnly, setVerifiedOnly] = useState(false);
    const [activeGender, setActiveGender] = useState<GenderTarget>('all');
    const [activeCategory, setActiveCategory] = useState<Category | 'all'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<'discount' | 'price' | 'new' | 'reliability'>('discount');

    const hasStock = (d: Deal) => {
        if (d.quantity === 'unlimited') return true;
        if (typeof d.quantity === 'number' && d.quantity > 0) return true;
        const initial = d.initialQuantity;
        return !(typeof initial === 'number' && initial > 0);
    };

    const seasonDeals = useMemo(() => {
        if (!camp) return [];
        let list = deals.filter(d => d.seasonId === camp.seasonId
            && d.status === 'active'
            && !isDealComingSoon(d)
            && !isDealExpiredByTime(d)
            && hasStock(d)
            && !blockedMerchants.includes(d.storeId));

        if (activeCategory !== 'all') {
            list = list.filter(d => d.category === activeCategory || (d.category as string) === 'all');
        }
        if (activeGender !== 'all') {
            list = list.filter(d => d.gender === activeGender || d.gender === 'all');
        }
        if (openNow) {
            list = list.filter(d => getShopStatus((storeProfiles[d.storeId] as any)?.workingHours).open);
        }
        if (verifiedOnly) {
            list = list.filter(d => {
                const b = getAuthenticityBadge(d.authReal, d.authFake, isRTL);
                return b.show && b.real;
            });
        }

        if (searchQuery.trim()) {
            return list
                .map(d => ({
                    d,
                    score: Math.max(
                        dealService.searchScore(searchQuery, d.itemName) * 1.0,
                        dealService.searchScore(searchQuery, d.shopName) * 0.9,
                        dealService.searchScore(searchQuery, `${d.category} ${d.description || ''}`) * 0.5,
                    ),
                }))
                .filter(x => x.score > 0)
                .sort((a, b) => b.score - a.score)
                .map(x => x.d);
        }

        if (sortBy === 'discount') list.sort((a, b) => b.discountPercentage - a.discountPercentage);
        else if (sortBy === 'price') list.sort((a, b) => a.discountedPrice - b.discountedPrice);
        else if (sortBy === 'reliability') list.sort((a, b) => (b.reliabilityScore || 0) - (a.reliabilityScore || 0));
        else list.sort((a, b) => b.createdAt - a.createdAt);
        return list;
    }, [deals, camp?.seasonId, blockedMerchants, nowTick, activeCategory, activeGender, openNow, verifiedOnly, searchQuery, sortBy, storeProfiles, isRTL]);

    if (!season || !camp) return null; // البوابة في App.tsx تمنع الوصول أصلاً

    return (
        <div className="page-content" style={{ background: 'var(--body-bg)', minHeight: '100vh', direction: isRTL ? 'rtl' : 'ltr' }}>
            {/* هيدر الموسم — تدرّج الموسم نفسه (مستقل عن الثيم الحالي).
                v12.50: padding علوي يحسب env(safe-area-inset-top) حتى لا يلتصق
                المحتوى بساعة iOS والنوتش داخل التطبيق المثبّت. */}
            <div style={{
                background: season.swatch, color: '#fff',
                padding: 'calc(env(safe-area-inset-top, 0px) + 26px) 20px 30px',
                borderRadius: '0 0 28px 28px', position: 'relative', overflow: 'hidden',
                textAlign: 'center', boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
            }}>
                <button
                    onClick={() => history.push('/')}
                    aria-label={isRTL ? 'العودة للرئيسية' : 'Back to home'}
                    style={{
                        position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 16px)', [isRTL ? 'right' : 'left']: 16,
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

            {/* v12.50 — صف الفلاتر الأول: مفتوح الآن / كل المحلات / عروض حقيقية + زر الترتيب */}
            <div style={{ display: 'flex', gap: 8, padding: '14px 12px 0', overflowX: 'auto', alignItems: 'center' }} className="hide-scrollbar">
                <button
                    onClick={() => {
                        const next: typeof sortBy = sortBy === 'discount' ? 'price' : sortBy === 'price' ? 'new' : sortBy === 'new' ? 'reliability' : 'discount';
                        setSortBy(next);
                    }}
                    aria-label={isRTL ? 'تغيير الترتيب' : 'Change sort'}
                    className="filter-chip"
                    style={{ flexShrink: 0 }}
                >
                    ⇅ {isRTL
                        ? (sortBy === 'discount' ? 'الأقوى خصماً' : sortBy === 'price' ? 'الأرخص' : sortBy === 'new' ? 'الأحدث' : 'الأوثق')
                        : (sortBy === 'discount' ? 'Top discount' : sortBy === 'price' ? 'Cheapest' : sortBy === 'new' ? 'Newest' : 'Trusted')}
                </button>
                <button onClick={() => setOpenNow(true)} className={`filter-chip ${openNow ? 'active' : ''}`} style={{ flexShrink: 0 }}>🟢 {isRTL ? 'المفتوحة الآن' : 'Open now'}</button>
                <button onClick={() => setOpenNow(false)} className={`filter-chip ${!openNow ? 'active' : ''}`} style={{ flexShrink: 0 }}>🏪 {isRTL ? 'جميع المحلات' : 'All shops'}</button>
                <button onClick={() => setVerifiedOnly(v => !v)} className={`filter-chip ${verifiedOnly ? 'active' : ''}`} style={{ flexShrink: 0 }}>🔵 {isRTL ? 'عروض حقيقية' : 'Verified real'}</button>
            </div>

            {/* صف الفئات العمرية */}
            <div style={{ display: 'flex', gap: 8, padding: '10px 12px 0', overflowX: 'auto' }} className="hide-scrollbar">
                <button
                    onClick={() => setActiveGender('all')}
                    className={`filter-chip ${activeGender === 'all' && activeCategory === 'all' ? 'active' : ''}`}
                    style={{ flexShrink: 0 }}>
                    {isRTL ? '🔥 الكل' : '🔥 All'}
                </button>
                {GENDERS.filter(g => g.id !== 'all' && g.id !== 'other').map(g => (
                    <button key={g.id} onClick={() => setActiveGender(g.id)}
                        className={`filter-chip ${activeGender === g.id ? 'active' : ''}`}
                        style={{ flexShrink: 0 }}>
                        {g.emoji} {isRTL ? g.ar : g.en}
                    </button>
                ))}
            </div>

            {/* صف التصنيفات */}
            <div style={{ display: 'flex', gap: 8, padding: '10px 12px 0', overflowX: 'auto' }} className="hide-scrollbar">
                {CATEGORIES.map(cat => (
                    <button key={cat.id} onClick={() => setActiveCategory(cat.id)}
                        className={`filter-chip ${activeCategory === cat.id ? 'active' : ''}`}
                        style={{ flexShrink: 0 }}>
                        <span style={{ fontSize: '1rem' }}>{cat.emoji}</span> {isRTL ? cat.ar : cat.en}
                    </button>
                ))}
            </div>

            {/* بحث داخل عروض الموسم */}
            <div style={{ padding: '12px 12px 0' }}>
                <div style={{
                    background: 'var(--card-bg)', border: '1px solid var(--border-color)',
                    borderRadius: 14, display: 'flex', alignItems: 'center', height: 48, paddingInline: 14, gap: 8,
                }}>
                    <span style={{ fontSize: '1.1rem' }}>🔍</span>
                    <input
                        type="search"
                        inputMode="search"
                        autoComplete="off"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={isRTL ? `ابحث في عروض ${season.ar}...` : `Search ${season.en} deals...`}
                        style={{
                            flex: 1, border: 'none', background: 'transparent', outline: 'none',
                            fontSize: '16px', fontFamily: 'inherit', color: 'var(--text-primary)',
                            direction: isRTL ? 'rtl' : 'ltr', minWidth: 0,
                        }}
                    />
                </div>
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
                        {(activeCategory !== 'all' || activeGender !== 'all' || verifiedOnly || openNow || searchQuery.trim()) && (
                            <button
                                onClick={() => { setActiveCategory('all'); setActiveGender('all'); setVerifiedOnly(false); setOpenNow(false); setSearchQuery(''); }}
                                style={{
                                    marginTop: 18, padding: '12px 24px',
                                    background: 'var(--primary)', color: 'white',
                                    border: 'none', borderRadius: 12, fontWeight: 800, cursor: 'pointer',
                                }}>
                                {isRTL ? '🔄 إعادة ضبط الفلاتر' : '🔄 Reset filters'}
                            </button>
                        )}
                    </div>
                )}
            </div>

            <BottomNav />
        </div>
    );
};

export default SeasonalOffers;
