import React, { useEffect, useMemo, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import DealCard from '../components/DealCard';
import BottomNav from '../components/BottomNav';
import InfiniteScrollSentinel from '../components/InfiniteScrollSentinel';
import { useApp } from '../context/AppContext';
import { CATEGORIES, GENDERS, Category, GenderTarget } from '../data/mock';
import { dealService } from '../services/dealService';
import { interleaveSponsored, DisplayDeal, isDealExpiredByTime } from '../utils/helpers';
import { useNowTick } from '../utils/useNowTick';
import { useDealBrowse } from '../hooks/useDealBrowse';
import type { BrowseSort } from '../repositories/dealRepository';
import SearchInput from '../components/SearchInput';

type DealsType = 'trending' | 'discount' | 'all' | 'coming_soon';

/** ترتيب الواجهة → ترتيب المحرك. `best` يُختار تلقائياً أثناء البحث. */
type UiSort = 'reliability' | 'discount' | 'price' | 'new';

const useQuery = () => {
    const { search } = useLocation();
    return useMemo(() => new URLSearchParams(search), [search]);
};

const TITLES: Record<DealsType, { ar: string; en: string; emoji: string }> = {
    trending: { ar: 'الأكثر تداولاً', en: 'Most Trending', emoji: '🔥' },
    discount: { ar: 'أقوى الخصومات', en: 'Top Discounts', emoji: '💸' },
    all: { ar: 'كل العروض', en: 'All Deals', emoji: '🛍️' },
    coming_soon: { ar: 'العروض القادمة', en: 'Coming Soon', emoji: '⏳' },
};

/**
 * DealsList — Trendyol-style 2-column grid view, opened from the home page
 * "view more" buttons. Shows the same deal cards (4:5 portrait images,
 * floating heart, discount badge, brand row, price row) in a denser layout.
 *
 * Query string: ?type=trending|discount|all
 *               ?cat=<category>
 *               ?gender=<gender>
 */
const DealsList: React.FC = () => {
    const history = useHistory();
    const query = useQuery();
    const { language, storeProfiles, sponsors, topLocation, followedMerchants, toggleFollowMerchant, platformSettings } = useApp();
    const isRTL = language === 'ar';

    const type = (query.get('type') || 'all') as DealsType;
    const initialCat = (query.get('cat') || 'all') as Category | 'all';
    const initialGender = (query.get('gender') || 'all') as GenderTarget;

    const [activeCategory, setActiveCategory] = useState<Category | 'all'>(initialCat);
    const [activeGender, setActiveGender] = useState<GenderTarget>(initialGender);
    const [sortBy, setSortBy] = useState<UiSort>(type === 'discount' ? 'discount' : 'reliability');
    const [searchQuery, setSearchQuery] = useState('');
    // «مفتوح الآن» (العروض الحيّة) هو الافتراضي. v11.77
    const [openNow, setOpenNow] = useState(true);
    // «عروض حقيقية» — يُظهر فقط العروض التي صوّت المشترون أنها حقيقية (أغلبية).
    // اختياري (افتراضياً مُطفأ) ليشجّع التجار على عروض صادقة. v11.98
    const [verifiedOnly, setVerifiedOnly] = useState(false);

    // v12.40 — «المحلل الذكي»: سجّل الكلمة المبحوثة (debounce داخل المتتبع)
    useEffect(() => {
        if (!searchQuery.trim()) return;
        import('../services/searchTracker').then(({ trackSearch }) => trackSearch(searchQuery, 'deals')).catch(() => {});
    }, [searchQuery]);

    // Smooth-scroll to top on type change so navigating between sections doesn't
    // leave the user mid-list.
    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [type]);

    const isComingSoonView = type === 'coming_soon';

    // v13.24 — الترشيح والترتيب والعدّ كلها على القاعدة. أثناء البحث يتحوّل
    // الترتيب تلقائياً إلى `best` (الأفضل مطابقةً) كما في متاجر العالم، ويعود
    // لاختيار المستخدم فور مسح البحث.
    const sort: BrowseSort = isComingSoonView ? 'soon' : (searchQuery.trim() ? 'best' : sortBy);

    const { deals, total, totalCapped, hasMore, loading, loadingMore, loadMore } = useDealBrowse({
        query: searchQuery,
        category: activeCategory,
        gender: activeGender,
        region: topLocation.region || null,
        city: topLocation.city || null,
        mall: topLocation.mall || null,
        sort,
        mode: isComingSoonView ? 'coming_soon' : 'live',
        // «قادم قريباً» لا يخضع لساعات العمل (لم يُفتح بعد).
        openNow: openNow && !isComingSoonView,
        verified: verifiedOnly,
    });

    // Re-evaluate every ~15s so an offer that expires while the user is looking
    // at the page falls off on its own. v12.06 — يُسقِط فقط ما انتهى وقته، فلا
    // يمكن أن يُخفي منتجاً قائماً (ذلك الترشيح كله صار على القاعدة).
    const nowTick = useNowTick(15000);

    const displayDeals = useMemo(() => {
        void nowTick;
        const live = isComingSoonView ? deals : deals.filter(d => !isDealExpiredByTime(d));
        // v11.23 — interleave gold sponsor ads (every 5, rotated, targeted).
        // Coming-soon view stays ad-free (those deals aren't bookable yet).
        if (isComingSoonView) return live.map(deal => ({ deal, sponsored: false })) as DisplayDeal[];
        return interleaveSponsored(live, sponsors, platformSettings.sponsorLayout);
    }, [deals, isComingSoonView, sponsors, platformSettings.sponsorLayout, nowTick]);

    // Store directory search — mirrors Home so "find a shop by name" works
    // identically when browsing the full lists too.
    const matchingStores = useMemo(
        () => (searchQuery.trim() ? dealService.matchStores(searchQuery.trim(), storeProfiles, 15) : []),
        [searchQuery, storeProfiles]
    );

    const title = TITLES[type];

    return (
        <div className="page-content" style={{ background: 'var(--body-bg)', minHeight: '100vh', direction: isRTL ? 'rtl' : 'ltr' }}>
            {/* Compact sticky header — matches the screenshot: back arrow + title centered */}
            <div style={{
                position: 'sticky',
                top: 0,
                zIndex: 100,
                background: 'var(--card-bg)',
                paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
                paddingBottom: 12,
                paddingInline: 12,
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
            }}>
                <button
                    onClick={() => history.length > 1 ? history.goBack() : history.push('/')}
                    aria-label={isRTL ? 'رجوع' : 'Back'}
                    style={{
                        width: 44, height: 44, minWidth: 44, minHeight: 44,
                        background: 'var(--gray-100)', border: 'none', borderRadius: 14,
                        fontSize: '1.2rem', fontWeight: 900,
                        color: 'var(--text-primary)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                >
                    {isRTL ? '→' : '←'}
                </button>

                <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
                    <div style={{ fontSize: '1rem', fontWeight: 900, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {(isRTL ? title.ar : title.en)} {title.emoji}
                    </div>
                    {/* v13.24 — العدّاد يقرأ عدد المطابقات في **القاعدة** لا عدد
                        المُحمّل على الشاشة. «+» تعني أن المطابقات تجاوزت سقف العدّ. */}
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 700, marginTop: 2 }}>
                        {loading ? '…' : `${total.toLocaleString('en-US')}${totalCapped ? '+' : ''}`} {isRTL ? 'منتج' : 'items'}
                    </div>
                </div>

                <button
                    onClick={() => {
                        const next: typeof sortBy = sortBy === 'discount' ? 'price' : sortBy === 'price' ? 'new' : sortBy === 'new' ? 'reliability' : 'discount';
                        setSortBy(next);
                    }}
                    aria-label={isRTL ? 'تغيير الترتيب' : 'Change sort'}
                    style={{
                        width: 44, height: 44, minWidth: 44, minHeight: 44,
                        background: 'var(--gray-100)', border: 'none', borderRadius: 14,
                        fontSize: '1rem', fontWeight: 900,
                        color: 'var(--text-primary)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                    title={isRTL ? `الترتيب: ${sortBy}` : `Sort: ${sortBy}`}
                >
                    ⇅
                </button>
            </div>

            {/* Open-now toggle (default ON) — يعرض العروض الحيّة من المحلات المفتوحة الآن */}
            {type !== 'coming_soon' && (
                <div style={{ display: 'flex', gap: 8, padding: '10px 12px 0', background: 'var(--card-bg)', overflowX: 'auto' }} className="hide-scrollbar">
                    <button onClick={() => setOpenNow(true)} className={`filter-chip ${openNow ? 'active' : ''}`} style={{ flexShrink: 0 }}>🟢 {isRTL ? 'المفتوحة الآن' : 'Open now'}</button>
                    <button onClick={() => setOpenNow(false)} className={`filter-chip ${!openNow ? 'active' : ''}`} style={{ flexShrink: 0 }}>🏪 {isRTL ? 'جميع المحلات' : 'All shops'}</button>
                    {/* «عروض حقيقية» — يصفّي على العروض الموثّقة بتصويت المشترين. v11.98 */}
                    <button onClick={() => setVerifiedOnly(v => !v)} className={`filter-chip ${verifiedOnly ? 'active' : ''}`} style={{ flexShrink: 0 }}>🔵 {isRTL ? 'عروض حقيقية' : 'Verified real'}</button>
                </div>
            )}

            {/* Filter chips — Brand / Category / Gender, matches Trendyol's look */}
            <div style={{
                display: 'flex',
                gap: 8,
                padding: '12px 12px 4px',
                overflowX: 'auto',
                background: 'var(--card-bg)',
                borderBottom: '1px solid var(--border-color)',
            }} className="hide-scrollbar">
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

            <div style={{
                display: 'flex',
                gap: 8,
                padding: '8px 12px 12px',
                overflowX: 'auto',
                background: 'var(--card-bg)',
                borderBottom: '1px solid var(--border-color)',
            }} className="hide-scrollbar">
                {CATEGORIES.map(cat => (
                    <button key={cat.id} onClick={() => setActiveCategory(cat.id)}
                        className={`filter-chip ${activeCategory === cat.id ? 'active' : ''}`}
                        style={{ flexShrink: 0 }}>
                        <span style={{ fontSize: '1rem' }}>{cat.emoji}</span> {isRTL ? cat.ar : cat.en}
                    </button>
                ))}
            </div>

            {/* Optional inline search */}
            <div style={{ padding: '12px 12px 8px', background: 'var(--body-bg)' }}>
                <div style={{
                    background: 'var(--card-bg)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 14,
                    display: 'flex',
                    alignItems: 'center',
                    height: 48,
                    paddingInline: 14,
                    gap: 8,
                }}>
                    <span style={{ fontSize: '1.1rem' }}>🔍</span>
                    <SearchInput
                        type="search"
                        inputMode="search"
                        autoComplete="off"
                        value={searchQuery}
                        onChange={setSearchQuery}
                        placeholder={isRTL ? 'ابحث في هذه القائمة...' : 'Search in this list...'}
                        style={{
                            flex: 1,
                            border: 'none',
                            background: 'transparent',
                            outline: 'none',
                            fontSize: '16px',
                            fontFamily: 'inherit',
                            color: 'var(--text-primary)',
                            direction: isRTL ? 'rtl' : 'ltr',
                            minWidth: 0,
                        }}
                    />
                </div>
            </div>

            {/* Store results — same ranked engine & card as Home */}
            {searchQuery.trim() && matchingStores.length > 0 && (
                <div style={{ padding: '6px 0 2px' }}>
                    <div style={{ padding: '0 12px 10px' }}>
                        <h2 style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--text-primary)' }}>{isRTL ? 'المتاجر 🏪' : 'Stores 🏪'}</h2>
                    </div>
                    <div style={{ display: 'flex', gap: 12, padding: '0 12px 14px', overflowX: 'auto' }} className="hide-scrollbar">
                        {matchingStores.map((store: any) => {
                            const isFollowed = followedMerchants.includes(store.id);
                            return (
                                <div
                                    key={store.id}
                                    role="button"
                                    tabIndex={0}
                                    aria-label={store.shop || store.name}
                                    onClick={() => history.push(`/store/${store.id}`)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); history.push(`/store/${store.id}`); } }}
                                    style={{ flexShrink: 0, width: 110, background: 'var(--card-bg)', borderRadius: 16, padding: '12px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.03)', border: '1px solid var(--border-color)', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
                                >
                                    <img src={store.avatar_url || 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=150'} alt={store.shop || store.name} style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', marginBottom: 10, border: '2px solid var(--gray-100)' }} />
                                    <div style={{ fontSize: '0.85rem', fontWeight: 900, color: 'var(--text-primary)', textAlign: 'center', marginBottom: 10, display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{store.shop || store.name}</div>
                                    <button onClick={(e) => { e.stopPropagation(); toggleFollowMerchant(store.id); }} style={{ background: isFollowed ? 'var(--gray-100)' : 'var(--primary)', color: isFollowed ? 'var(--gray-600)' : 'white', border: 'none', borderRadius: 20, padding: '6px 12px', fontSize: '0.75rem', fontWeight: 800, width: '100%' }}>
                                        {isFollowed ? (isRTL ? 'متابع' : 'Following') : (isRTL ? '+ متابعة' : '+ Follow')}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* 2-column grid — Trendyol-style.
                Single column under 320px (Galaxy Fold), 2-col on phones,
                3-col on tablets, 4-col on desktop. Driven by global media
                queries in styles.css. */}
            <div style={{
                padding: '8px 12px 24px',
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 10,
            }} className="taki-deals-list-grid">
                {displayDeals.length > 0 ? (
                    displayDeals.map(({ deal, sponsored, sponsorLabel }) => (
                        <DealCard
                            key={deal.id}
                            deal={deal}
                            onClick={(id) => history.push(`/deal/${id}`)}
                            isSponsored={sponsored}
                            sponsorLabel={sponsorLabel}
                        />
                    ))
                ) : loading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                        <div key={`sk-${i}`} className="taki-skeleton" style={{ aspectRatio: '4 / 5', height: 'auto' }} />
                    ))
                ) : (
                    <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '60px 20px' }}>
                        <div style={{ fontSize: '3rem', marginBottom: 12 }}>📭</div>
                        <div style={{ fontWeight: 800, color: 'var(--gray-400)' }}>
                            {isRTL ? 'لا توجد عروض في هذه الفئة' : 'No deals in this category'}
                        </div>
                        <button
                            onClick={() => { setActiveCategory('all'); setActiveGender('all'); setSearchQuery(''); }}
                            style={{
                                marginTop: 16, padding: '12px 24px',
                                background: 'var(--primary)', color: 'white',
                                border: 'none', borderRadius: 12, fontWeight: 800,
                                cursor: 'pointer'
                            }}>
                            {isRTL ? '🔄 إعادة ضبط الفلاتر' : '🔄 Reset filters'}
                        </button>
                    </div>
                )}
            </div>

            {/* v13.22 — التمرير اللانهائي: تُحمّل الصفحة التالية قبل بلوغ النهاية
                بشاشة تقريباً، فلا يرى المستخدم انتظاراً. */}
            <InfiniteScrollSentinel
                hasMore={hasMore}
                loading={loadingMore}
                onLoadMore={loadMore}
                isRTL={isRTL}
                endLabel={displayDeals.length > 0 ? (isRTL ? '— وصلت لنهاية العروض —' : '— End of results —') : undefined}
            />

            <BottomNav />
        </div>
    );
};

export default DealsList;
