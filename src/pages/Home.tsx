import React, { useState, useMemo } from 'react';
import Navbar from '../components/Navbar';
import BottomNav from '../components/BottomNav';
import InfiniteScrollSentinel from '../components/InfiniteScrollSentinel';
import DealCard from '../components/DealCard';
import { REGIONS, CITIES, LOCATIONS, Category, GenderTarget, getCity, CATEGORIES, GENDERS, geoName } from '../data/mock';
import { useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { dealService } from '../services/dealService';
import { isDealExpiredByTime, interleaveSponsored, DisplayDeal } from '../utils/helpers';
import { useDealBrowse } from '../hooks/useDealBrowse';
import { useDealRail } from '../hooks/useDealRail';
import type { BrowseSort } from '../repositories/dealRepository';
import { useNowTick } from '../utils/useNowTick';
import LocationGate from '../components/LocationGate';
import PullToRefresh from '../components/PullToRefresh';
import { userRepository } from '../repositories/userRepository';
import { UserProfile } from '../services/authService';
import { useEffect, useCallback } from 'react';
import BannerSlider from '../components/BannerSlider';
import SeasonHero from '../components/SeasonHero';
import { getSeasonById, campaignPublicLive } from '../data/seasons';
import { bannerRepository, Banner } from '../repositories/bannerRepository';
import { contestRepository, isContestLive, contestMatchesAudience } from '../repositories/contestRepository';

// v13.04 — كاش وحدة للبنرات: يبقى بين إعادة تركيب الرئيسية (الرجوع من صفحة المنتج)
// فيظهر شريط البنر **فوراً** بدل أن يبقى فارغاً منهاراً حتى ينتهي الجلب — كان اختفاؤه
// ثوانٍ ثم عودته يزيح المحتوى ويربك استعادة موضع التمرير (بلاغ ناصر).
let _homeBannersCache: Banner[] = [];

const Home: React.FC = () => {
    const history = useHistory();
    const { language, topLocation, setTopLocation, followedMerchants, toggleFollowMerchant, blockedMerchants, storeProfiles, sponsors, refreshDeals, homeCity, user, locationPermission, requestLiveLocation, platformSettings } = useApp();
    const [searchQuery, setSearchQuery] = useState('');
    const [gateClosed, setGateClosed] = useState(false);
    // Persist the «فعّل موقعك» dismissal so it doesn't nag on every app launch.
    // (Once permission is granted, locationPermission flips to 'granted' and the
    // banner hides on its own anyway.) v12.02
    const [liveBannerDismissed, setLiveBannerDismissed] = useState<boolean>(() => {
        try { return localStorage.getItem('taki_live_loc_dismissed') === '1'; } catch { return false; }
    });
    const dismissLiveBanner = () => {
        try { localStorage.setItem('taki_live_loc_dismissed', '1'); } catch { /* ignore */ }
        setLiveBannerDismissed(true);
    };
    // First-open city prompt: buyers/guests only (sellers & admins have their
    // own dashboards), shown once until a home city is chosen/persisted.
    const isShopper = user?.userType !== 'seller' && user?.userType !== 'admin';
    const showLocationGate = isShopper && !homeCity && !gateClosed;
    // Explicit dropdown filter wins; otherwise the rails expand outward from
    // the user's home city (see railScope below). v13.25
    const explicitLocationFilter = !!(topLocation.region || topLocation.city || topLocation.mall);
    const [activeCategory, setActiveCategory] = useState<Category | 'all'>('all');
    const [activeGender, setActiveGender] = useState<GenderTarget>('all');
    const [sortBy, setSortBy] = useState<'reliability' | 'discount' | 'price' | 'new'>('reliability');
    const [matchingStores, setMatchingStores] = useState<UserProfile[]>([]);
    // v13.04 — يُبذَر من كاش الوحدة فيظهر البنر فوراً عند العودة للرئيسية (بلا وميض/اختفاء)
    const [banners, setBanners] = useState<Banner[]>(() => _homeBannersCache);
    // Advances every ~15s while visible so time-expired deals drop out of the
    // live lists on their own — no data change or refetch needed. v12.06
    const nowTick = useNowTick(15000);

    const isRTL = language === 'ar';

    // Image banners (admin) + live contests, surfaced together so shoppers
    // discover contests in the same hero carousel. Contest slides lead, and a
    // contest carries its own banner image when the owner uploaded one. (v11.49)
    const loadBanners = useCallback(() => {
        Promise.all([
            bannerRepository.getActive('home_top'),
            contestRepository.list(),
        ]).then(([imgBanners, contests]) => {
            const contestBanners: Banner[] = contests
                .filter((c) => isContestLive(c) && contestMatchesAudience(c, user?.userType))
                .map((c) => ({
                id: `contest-${c.id}`,
                kind: 'contest' as const,
                contest: { id: c.id, title: c.title, prize: c.prize, banner_image: c.banner_image },
                title_ar: c.title, title_en: c.title,
                image_url: '', target_url: '/contests',
                position: 'home_top', is_active: true, display_order: -1,
            }));
            const merged = [...contestBanners, ...imgBanners];
            _homeBannersCache = merged; // v13.04 — حدّث الكاش ليظهر فوراً في العودة القادمة
            setBanners(merged);
        }).catch(() => { bannerRepository.getActive('home_top').then(b => { _homeBannersCache = b; setBanners(b); }); });
    }, [user?.userType]);

    // Initial fetch on mount. Deals tab-switch refetching is handled centrally in
    // realtimeService; banners/contests are refreshed here on resume too, so an
    // ended contest drops (and a new one appears) without a hard reload — this is
    // why «البنر لا يتحدّث عند العودة» happened. (v11.49)
    useEffect(() => {
        refreshDeals();
        loadBanners();
        const onVisible = () => { if (document.visibilityState === 'visible') loadBanners(); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onVisible);
        window.addEventListener('pageshow', onVisible);
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', onVisible);
            window.removeEventListener('pageshow', onVisible);
        };
    }, [refreshDeals, loadBanners]);

    useEffect(() => {
        if (!searchQuery.trim()) {
            setMatchingStores([]);
            return;
        }
        
        // Instant local search for stores — shared, ranked matcher so the
        // closest store name surfaces first and behaves identically on
        // every page.
        setMatchingStores(dealService.matchStores(searchQuery.trim(), storeProfiles, 15) as any);
        // v12.40 — «المحلل الذكي»: سجّل الكلمة المبحوثة (debounce داخلي)
        import('../services/searchTracker').then(({ trackSearch }) => trackSearch(searchQuery, 'home')).catch(() => {});
    }, [searchQuery, storeProfiles]);

    // v13.25 — سقط جلب البحث اليدوي إلى النافذة: الشبكة نفسها صارت تسأل القاعدة
    // مباشرة عبر `useDealBrowse` أدناه، فلا حاجة لحقن النتائج في `deals`.

    const filteredCities = useMemo(() => {
        if (!topLocation.region) return [];
        return CITIES.filter(c => c.regionId === topLocation.region);
    }, [topLocation.region]);

    const filteredLocations = useMemo(() => {
        if (!topLocation.city) return [];
        return LOCATIONS.filter(l => l.cityId === topLocation.city);
    }, [topLocation.city]);

    // v13.25 — كل أقسام الرئيسية صارت تُرتَّب على **القاعدة كلها**، لا على
    // النافذة المُحمّلة. الفرق عملياً: «أقوى الخصومات» كانت تعرض أقوى خصم بين
    // آخر ٣٠ عرضاً؛ الآن تعرض أقوى خصم عندك فعلاً.
    //
    // القرب: بدل فرز الكتالوج كله بـtier (فرز كامل عند كل فتح للرئيسية — مستحيل
    // على الملايين) نستخدم **توسّعاً تدريجياً**: مدينة المستخدم أولاً، ثم منطقته،
    // ثم المملكة — كل خطوة ضربة فهرس واحدة، والنتيجة المرئية هي نفسها: القائمة
    // لا تتوقف عند مدينته.
    const railScope = useMemo(() => (
        explicitLocationFilter
            ? { city: topLocation.city || null, region: topLocation.region || null, expand: false }
            : { city: homeCity?.cityId || null, region: homeCity?.regionId || null, expand: true }
    ), [explicitLocationFilter, topLocation.city, topLocation.region, homeCity?.cityId, homeCity?.regionId]);

    // المول ليس نطاقاً في التوسّع — يُمرَّر كفلتر صريح حين يختاره المستخدم.
    const railMall = explicitLocationFilter ? (topLocation.mall || null) : null;

    const { deals: trendingBase } = useDealRail(
        { sort: 'reliability', limit: 8, mall: railMall, blocked: blockedMerchants }, railScope);
    const { deals: discountBase } = useDealRail(
        { sort: 'discount', limit: 8, mall: railMall, blocked: blockedMerchants }, railScope);

    const trendingDeals = useMemo(
        // v11.25 — sponsors lead this carousel too (gold first, then every 5).
        () => interleaveSponsored(trendingBase.filter(d => !isDealExpiredByTime(d)), sponsors, platformSettings.sponsorLayout).slice(0, 8),
        [trendingBase, sponsors, platformSettings.sponsorLayout, nowTick]);

    const bestDiscounts = useMemo(
        () => interleaveSponsored(discountBase.filter(d => !isDealExpiredByTime(d)), sponsors, platformSettings.sponsorLayout).slice(0, 8),
        [discountBase, sponsors, platformSettings.sponsorLayout, nowTick]);

    // v12.86 (طلب ناصر) — شريط «عروض الموسم» على الرئيسية بنفس شكل «الأكثر
    // تداولاً / أقوى الخصومات». يظهر فقط أثناء النافذة العامة للحملة النشطة،
    // ويعرض العروض الموسومة بموسمها (deals.season_id) مرتّبة بالأقوى خصماً،
    // ورأس الشريط يفتح صفحة الموسم الكاملة (/seasonal).
    const seasonCampaign = platformSettings.seasonCampaign;
    const seasonLive = campaignPublicLive(seasonCampaign);
    const activeSeason = seasonCampaign ? getSeasonById(seasonCampaign.seasonId) : undefined;

    const { deals: seasonDeals } = useDealRail(
        { sort: 'discount', limit: 12, mall: railMall, blocked: blockedMerchants, seasonId: seasonCampaign?.seasonId || null },
        railScope,
        !!(seasonCampaign && seasonLive));

    // v11.20 — Coming Soon carousel: عروض تبدأ خلال ٧ أيام فقط (قاعدة ناصر
    // المعتمدة v12.60)، الأقرب إطلاقاً أولاً.
    const { deals: comingSoonDeals } = useDealRail(
        { sort: 'soon', mode: 'coming_soon', limit: 12, mall: railMall, blocked: blockedMerchants }, railScope);

    // الشبكة الرئيسية — بحث/تصنيف/ترتيب على القاعدة مع ترقيم keyset.
    // أثناء البحث ينتقل الترتيب تلقائياً إلى «أفضل مطابقة».
    const gridSort: BrowseSort = searchQuery.trim() ? 'best' : sortBy;
    const {
        deals: gridDeals, total: gridTotal, hasMore: gridHasMore,
        loading: gridLoading, loadingMore: gridLoadingMore, loadMore: gridLoadMore,
    } = useDealBrowse({
        query: searchQuery,
        category: activeCategory,
        gender: activeGender,
        // نطاق الشبكة: اختيار المستخدم الصريح يحكم؛ وإلا مدينته (والتمرير يكشف
        // الباقي عبر keyset — الشبكة مرقّمة أصلاً فلا تحتاج توسّعاً يدوياً).
        region: explicitLocationFilter ? (topLocation.region || null) : null,
        city: explicitLocationFilter ? (topLocation.city || null) : null,
        mall: explicitLocationFilter ? (topLocation.mall || null) : null,
        sort: gridSort,
        blocked: blockedMerchants,
    });

    const filteredDeals = useMemo(() => {
        const live = gridDeals.filter(d => !isDealExpiredByTime(d));
        // While searching, no sponsored interleave — relevance wins.
        if (searchQuery.trim()) return live.map(deal => ({ deal, sponsored: false })) as DisplayDeal[];
        // v11.23 — Official Sponsors: gold ads interleaved per sponsor_layout.
        return interleaveSponsored(live, sponsors, platformSettings.sponsorLayout);
    }, [gridDeals, searchQuery, sponsors, platformSettings.sponsorLayout, nowTick]);

    return (
        <>
        {showLocationGate && <LocationGate onClose={() => setGateClosed(true)} />}
        <PullToRefresh isRTL={isRTL} onRefresh={() => {
            // Return the REAL fetch promise so the spinner stays until the new
            // products actually land (PullToRefresh caps it at ~7s as a
            // safety). Previously this was fire-and-forget and the spinner
            // vanished after 700ms while the list updated seconds later —
            // which read as "the refresh did nothing". v12.06
            return refreshDeals();
        }}>
        <div className="page-content" style={{ background: 'var(--body-bg)', minHeight: '100vh', direction: isRTL ? 'rtl' : 'ltr' }}>
            {/* No more full-screen blocker — modern apps show content shells while
                data hydrates in the background. A thin top progress bar gives a
                subtle hint that data is still arriving without blocking taps. */}
            {gridLoading && (
                <div
                    aria-hidden
                    style={{
                        position: 'fixed', top: 0, left: 0, right: 0, height: 3, zIndex: 1100,
                        background: 'linear-gradient(90deg, transparent 0%, var(--primary) 50%, transparent 100%)',
                        backgroundSize: '200% 100%',
                        animation: 'taki-progress 1.2s linear infinite',
                        pointerEvents: 'none',
                    }}
                />
            )}
            <Navbar searchQuery={searchQuery} onSearchChange={setSearchQuery} />

            {/* v12.44 — بانر هوية الموسم: يظهر فقط عندما يفعّل المالك موسماً من
                لوحة المدير، ويأخذ صدارة الصفحة لأن الهوية كلها تتبدّل معه. */}
            <SeasonHero />

            {/* Live-location prompt — shoppers only, on entry, while undecided.
                Once granted, the app-wide tracker follows them and pushes the
                nearest deals as they move; we never nag a second time. */}
            {user && user.userType !== 'seller' && locationPermission === 'prompt' && !liveBannerDismissed && (
                <div className="animate-fade-in" style={{
                    margin: '10px 16px 0', padding: '12px 14px', borderRadius: 16,
                    background: 'linear-gradient(135deg, #0ea5e9, #2563eb)', color: '#fff',
                    display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 8px 22px rgba(37,99,235,0.28)',
                }}>
                    <div style={{ fontSize: '1.6rem', lineHeight: 1 }}>📍</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 900, fontSize: '0.92rem' }}>
                            {isRTL ? 'فعّل موقعك المباشر' : 'Turn on live location'}
                        </div>
                        <div style={{ fontWeight: 600, fontSize: '0.76rem', opacity: 0.92, marginTop: 2, lineHeight: 1.5 }}>
                            {isRTL ? 'نعرض لك أقرب العروض لحظة بلحظة وأنت تتنقّل.' : 'See the nearest deals in real time as you move.'}
                        </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <button onClick={async () => { const ok = await requestLiveLocation(); if (ok) dismissLiveBanner(); }}
                            style={{ background: '#fff', color: '#2563eb', border: 'none', padding: '8px 14px', borderRadius: 10, fontWeight: 900, fontSize: '0.82rem', cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 40 }}>
                            {isRTL ? 'تفعيل' : 'Enable'}
                        </button>
                        <button onClick={dismissLiveBanner}
                            style={{ background: 'transparent', color: '#fff', border: 'none', padding: '2px', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer', opacity: 0.85 }}>
                            {isRTL ? 'لاحقاً' : 'Later'}
                        </button>
                    </div>
                </div>
            )}

            {/* Hierarchical Location Filter */}
            <div className="animate-fade-in" style={{ padding: '8px 16px', background: 'var(--card-bg)', borderBottom: '1px solid var(--border-color)', transition: 'background 0.3s ease' }}>
                <div style={{ display: 'flex', gap: 6, flexDirection: 'column' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <select
                            value={topLocation.region}
                            onChange={e => setTopLocation({ region: e.target.value, city: '', mall: '' })}
                            className="filter-select-premium"
                            style={{ flex: 1, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border-color)', background: 'var(--card-bg)', fontSize: '0.85rem', fontWeight: 700, appearance: 'none', minHeight: 38, color: 'var(--text-primary)' }}
                        >
                            <option value="">{isRTL ? 'كل المناطق' : 'All Regions'}</option>
                            {REGIONS.map(r => <option key={r.id} value={r.id}>{geoName(r, language)}</option>)}
                        </select>
                        <select
                            value={topLocation.city}
                            onChange={e => setTopLocation({ ...topLocation, city: e.target.value, mall: '' })}
                            disabled={!topLocation.region}
                            style={{ flex: 1, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border-color)', background: !topLocation.region ? 'var(--gray-100)' : 'var(--card-bg)', fontSize: '0.85rem', fontWeight: 700, appearance: 'none', opacity: !topLocation.region ? 0.6 : 1, minHeight: 38, color: 'var(--text-primary)' }}
                        >
                            <option value="">{isRTL ? 'كل المدن' : 'All Cities'}</option>
                            {filteredCities.map(c => <option key={c.id} value={c.id}>{geoName(c, language)}</option>)}
                        </select>
                    </div>
                    <select
                        value={topLocation.mall}
                        onChange={e => setTopLocation({ ...topLocation, mall: e.target.value })}
                        disabled={!topLocation.city}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border-color)', background: !topLocation.city ? 'var(--gray-100)' : 'var(--card-bg)', fontSize: '0.85rem', fontWeight: 700, appearance: 'none', opacity: !topLocation.city ? 0.6 : 1, minHeight: 38, color: 'var(--text-primary)' }}
                    >
                        <option value="">{isRTL ? 'كل المولات والأسواق' : 'All Malls & Markets'}</option>
                        {filteredLocations.map(l => <option key={l.id} value={l.id}>{geoName(l, language)}</option>)}
                    </select>
                </div>
            </div>

            {/* Banner Slider Section — inset card with side margins (NOT
                full-bleed): trimmed from both edges to match the rest of the page. */}
            {banners.length > 0 && (
                <div className="home-banner-wrap">
                    <BannerSlider banners={banners} isRTL={isRTL} autoplayMs={platformSettings.bannerSeconds * 1000} />
                </div>
            )}

            {/* Sub-Nav Filters */}
            {/* v13.64 — أُعيد شكل هذا الشريط كما كان بأمر ناصر: بلاغه عن الوميض
                لم يكن يقصده، وتغييري لمظهره (سطح معتم بحدّ سفلي) كان زيادة من
                عندي لا طلباً منه. الوميض عولج من جذره في v13.62–63 بلا حاجة
                للمساس بهوية الرئيسية. */}
            <div style={{ position: 'sticky', top: 110, zIndex: 90, background: 'var(--nav-bg)', backdropFilter: 'blur(10px)', padding: '10px 0 12px', transition: 'background 0.3s ease' }}>
                <div style={{ display: 'flex', gap: 8, padding: '0 16px 10px', overflowX: 'auto' }} className="hide-scrollbar">
                    {GENDERS.map(g => (
                        <button key={g.id} onClick={() => setActiveGender(g.id)}
                            className={`filter-chip${activeGender === g.id ? ' active' : ''}`}>
                            {isRTL ? g.ar : g.en}
                        </button>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: 8, padding: '0 16px', overflowX: 'auto' }} className="hide-scrollbar">
                    {CATEGORIES.map(cat => (
                        <button key={cat.id} onClick={() => setActiveCategory(cat.id)}
                            className={`filter-chip${activeCategory === cat.id ? ' active' : ''}`}>
                            <span style={{ fontSize: '1rem' }}>{cat.emoji}</span> {isRTL ? cat.ar : cat.en}
                        </button>
                    ))}
                </div>


            </div>

            {/* v11.20 — Coming Soon carousel. Only renders when at least one
                scheduled deal is inside its 7-day visibility window — empty
                section would just be noise on Home.
                v13.71 (أمر ناصر): صار **فوق شريط عروض الموسم** لا تحته —
                «ما سيُفتح قريباً» هو ما يجهّز له المشتري نفسه، فيتصدّر. */}
            {comingSoonDeals.length > 0 && (
                <div style={{ padding: '20px 0 10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px 12px' }}>
                        <h2 style={{ fontSize: '1.1rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                            {isRTL ? 'العروض القادمة ⏳' : 'Coming Soon ⏳'}
                        </h2>
                        <button
                            onClick={() => history.push('/deals?type=coming_soon')}
                            aria-label={isRTL ? 'عرض كل العروض القادمة' : 'View all coming soon'}
                            style={{ background: 'transparent', border: 'none', color: 'var(--primary)', fontSize: '0.85rem', fontWeight: 800, padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                            {isRTL ? 'عرض المزيد' : 'View more'} <span style={{ fontSize: '0.95rem' }}>{isRTL ? '‹' : '›'}</span>
                        </button>
                    </div>
                    <div style={{ display: 'flex', gap: 12, padding: '0 16px 10px', overflowX: 'auto' }} className="hide-scrollbar">
                        {comingSoonDeals.map(deal => {
                            const isSponsored = (storeProfiles[deal.storeId] as any)?.is_pinned;
                            return (
                                <div key={deal.id} style={{ width: 175, flexShrink: 0 }}>
                                    <DealCard deal={deal} onClick={(id) => history.push(`/deal/${id}`)} isSponsored={isSponsored} />
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* v12.86 — شريط «عروض الموسم»: نفس نمط الأكثر تداولاً/أقوى الخصومات،
                يتصدّر الأشرطة أثناء نافذة الحملة العامة فقط، ويحمل هوية الموسم
                (إيموجي + اسم)، ورأسه يفتح صفحة الموسم الكاملة. */}
            {seasonLive && activeSeason && seasonDeals.length > 0 && (
                <div style={{ padding: '20px 0 10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px 12px' }}>
                        <h2 style={{ fontSize: '1.1rem', fontWeight: 900, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: '1.25rem' }}>{activeSeason.emoji}</span>
                            {isRTL ? `عروض ${activeSeason.ar}` : `${activeSeason.en} Deals`}
                        </h2>
                        <button
                            onClick={() => history.push('/seasonal')}
                            aria-label={isRTL ? 'عرض كل عروض الموسم' : 'View all seasonal deals'}
                            style={{ background: 'transparent', border: 'none', color: 'var(--primary)', fontSize: '0.85rem', fontWeight: 800, padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                            {isRTL ? 'عرض المزيد' : 'View more'} <span style={{ fontSize: '0.95rem' }}>{isRTL ? '‹' : '›'}</span>
                        </button>
                    </div>
                    <div style={{ display: 'flex', gap: 12, padding: '0 16px 10px', overflowX: 'auto' }} className="hide-scrollbar">
                        {seasonDeals.map(deal => (
                            <div key={deal.id} style={{ width: 175, flexShrink: 0 }}>
                                <DealCard deal={deal} onClick={(id) => history.push(`/deal/${id}`)} />
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Trending Section — header is a button so the user can drill into a
                full-grid view (the Trendyol-style page at /deals?type=trending). */}
            <div style={{ padding: '20px 0 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px 12px' }}>
                    <h2 style={{ fontSize: '1.1rem', fontWeight: 900, color: 'var(--text-primary)' }}>{isRTL ? 'الأكثر تداولاً 🔥' : 'Most Trending 🔥'}</h2>
                    <button
                        onClick={() => history.push('/deals?type=trending')}
                        aria-label={isRTL ? 'عرض كل الأكثر تداولاً' : 'View all trending'}
                        style={{ background: 'transparent', border: 'none', color: 'var(--primary)', fontSize: '0.85rem', fontWeight: 800, padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                        {isRTL ? 'عرض المزيد' : 'View more'} <span style={{ fontSize: '0.95rem' }}>{isRTL ? '‹' : '›'}</span>
                    </button>
                </div>
                <div style={{ display: 'flex', gap: 12, padding: '0 16px 10px', overflowX: 'auto' }} className="hide-scrollbar">
                    {trendingDeals.map(({ deal, sponsored, sponsorLabel }) => (
                        <div key={deal.id} style={{ width: 175, flexShrink: 0 }}>
                            <DealCard deal={deal} onClick={(id) => history.push(`/deal/${id}`)} isSponsored={sponsored} sponsorLabel={sponsorLabel} />
                        </div>
                    ))}
                </div>
            </div>

            {/* High Discount Section */}
            <div style={{ padding: '10px 0 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px 12px' }}>
                    <h2 style={{ fontSize: '1.1rem', fontWeight: 900, color: 'var(--text-primary)' }}>{isRTL ? 'أقوى الخصومات 💸' : 'Highest Discount 💸'}</h2>
                    <button
                        onClick={() => history.push('/deals?type=discount')}
                        aria-label={isRTL ? 'عرض كل أقوى الخصومات' : 'View all top discounts'}
                        style={{ background: 'transparent', border: 'none', color: 'var(--primary)', fontSize: '0.85rem', fontWeight: 800, padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                        {isRTL ? 'عرض المزيد' : 'View more'} <span style={{ fontSize: '0.95rem' }}>{isRTL ? '‹' : '›'}</span>
                    </button>
                </div>
                <div style={{ display: 'flex', gap: 12, padding: '0 16px 10px', overflowX: 'auto' }} className="hide-scrollbar">
                    {bestDiscounts.map(({ deal, sponsored, sponsorLabel }) => (
                        <div key={deal.id} style={{ width: 175, flexShrink: 0 }}>
                            <DealCard deal={deal} onClick={(id) => history.push(`/deal/${id}`)} isSponsored={sponsored} sponsorLabel={sponsorLabel} />
                        </div>
                    ))}
                </div>
            </div>

            {/* Store Search Results */}
            {searchQuery.trim() && matchingStores.length > 0 && (
                <div className="animate-fade-in" style={{ padding: '15px 0 5px' }}>
                    <div style={{ padding: '0 16px 10px' }}>
                        <h2 style={{ fontSize: '1.1rem', fontWeight: 900, color: 'var(--text-primary)' }}>{isRTL ? 'المتاجر 🏪' : 'Stores 🏪'}</h2>
                    </div>
                    <div style={{ display: 'flex', gap: 12, padding: '0 16px 15px', overflowX: 'auto' }} className="hide-scrollbar">
                        {matchingStores.map(store => {
                            const isFollowed = followedMerchants.includes(store.id);
                            return (
                                <div
                                    key={store.id}
                                    role="button"
                                    tabIndex={0}
                                    aria-label={store.shop || store.name}
                                    onClick={() => history.push(`/store/${store.id}`)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); history.push(`/store/${store.id}`); } }}
                                    style={{ flexShrink: 0, width: 110, background: 'var(--card-bg)', borderRadius: 16, padding: '12px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.03)', border: '1px solid var(--border-color)', cursor: 'pointer', transition: 'transform 0.2s ease', WebkitTapHighlightColor: 'transparent' }}
                                >
                                    <img src={store.avatar_url || 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=150'} alt={store.shop || store.name} style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', marginBottom: 10, border: '2px solid var(--gray-100)' }} />
                                    <div style={{ fontSize: '0.85rem', fontWeight: 900, color: 'var(--text-primary)', textAlign: 'center', marginBottom: 10, display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{store.shop || store.name}</div>
                                    <button onClick={(e) => { e.stopPropagation(); toggleFollowMerchant(store.id); }} style={{ background: isFollowed ? 'var(--gray-100)' : 'var(--primary)', color: isFollowed ? 'var(--gray-600)' : 'white', border: 'none', borderRadius: 20, padding: '6px 12px', fontSize: '0.75rem', fontWeight: 800, width: '100%', transition: 'all 0.2s ease' }}>
                                        {isFollowed ? (isRTL ? 'متابع' : 'Following') : (isRTL ? '+ متابعة' : '+ Follow')}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <div style={{ padding: '0 16px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                    {searchQuery.trim() ? (isRTL ? 'العروض 🛍️' : 'Deals 🛍️') : (isRTL ? 'كل العروض' : 'All Deals')}
                </h2>
                {!searchQuery.trim() && (
                    <button
                        onClick={() => history.push('/deals?type=all')}
                        aria-label={isRTL ? 'عرض كل العروض' : 'View all deals'}
                        style={{ background: 'transparent', border: 'none', color: 'var(--primary)', fontSize: '0.85rem', fontWeight: 800, padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                        {isRTL ? 'عرض المزيد' : 'View more'} <span style={{ fontSize: '0.95rem' }}>{isRTL ? '‹' : '›'}</span>
                    </button>
                )}
            </div>

            {/* Deals Grid */}
            <div className="taki-deals-grid" style={{ padding: '0 16px 20px', display: 'grid', gap: 10 }}>
                {filteredDeals.length > 0 ? (
                    filteredDeals.map(({ deal, sponsored, sponsorLabel }) => (
                        <DealCard key={deal.id} deal={deal} onClick={(id) => history.push(`/deal/${id}`)} isSponsored={sponsored} sponsorLabel={sponsorLabel} />
                    ))
                ) : gridLoading ? (
                    // Skeleton placeholders while initial fetch is in flight.
                    // Shows immediately so the user never sees a blank screen.
                    Array.from({ length: 8 }).map((_, i) => (
                        <div key={`sk-${i}`} className="taki-skeleton" style={{ height: 240 }} />
                    ))
                ) : (
                    <div style={{ gridColumn: 'span 2', textAlign: 'center', padding: '80px 20px' }}>
                        <div style={{ fontSize: '3rem', marginBottom: 15 }}>🔍</div>
                        <div style={{ fontWeight: 800, color: 'var(--gray-400)' }}>{isRTL ? 'لم نجد عروضاً تطابق هذا البحث' : 'No deals found for this search'}</div>
                    </div>
                )}
            </div>

            {/* v13.22 — التمرير اللانهائي بدل تنزيل الكتالوج كله دفعة واحدة. */}
            <InfiniteScrollSentinel
                hasMore={gridHasMore}
                loading={gridLoadingMore}
                onLoadMore={gridLoadMore}
                isRTL={isRTL}
            />

        </div>
        </PullToRefresh>
        {/* BottomNav lives OUTSIDE the pull-to-refresh wrapper. The wrapper
            uses transform: translateY() while pulling, and any ancestor with
            a transform breaks `position: fixed` for descendants — the nav
            would scroll along with the page instead of pinning to the
            bottom. Keeping it as a sibling preserves true viewport pinning. */}
        <BottomNav />
        </>
    );
};

export default Home;
