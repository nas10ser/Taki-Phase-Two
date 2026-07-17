import React, { useState, useMemo } from 'react';
import Navbar from '../components/Navbar';
import BottomNav from '../components/BottomNav';
import DealCard from '../components/DealCard';
import { REGIONS, CITIES, LOCATIONS, Category, GenderTarget, getCity, CATEGORIES, GENDERS, Deal , geoName } from '../data/mock';
import { useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { dealService } from '../services/dealService';
import { dealMatchesLocation, dealProximityTier, isDealComingSoon, isDealVisibleComingSoon, isDealExpiredByTime, interleaveSponsored, DisplayDeal } from '../utils/helpers';
import { useNowTick } from '../utils/useNowTick';
import LocationGate from '../components/LocationGate';
import PullToRefresh from '../components/PullToRefresh';
import { userRepository } from '../repositories/userRepository';
import { UserProfile } from '../services/authService';
import { useEffect, useCallback } from 'react';
import BannerSlider from '../components/BannerSlider';
import { bannerRepository, Banner } from '../repositories/bannerRepository';
import { contestRepository, isContestLive, contestMatchesAudience } from '../repositories/contestRepository';

const Home: React.FC = () => {
    const history = useHistory();
    const { deals, language, topLocation, setTopLocation, loading, followedMerchants, toggleFollowMerchant, blockedMerchants, storeProfiles, sponsors, refreshDeals, homeCity, user, locationPermission, requestLiveLocation } = useApp();
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
    // Explicit dropdown filter wins; otherwise we rank by home-city proximity.
    const explicitLocationFilter = !!(topLocation.region || topLocation.city || topLocation.mall);
    const useProximity = !explicitLocationFilter && !!homeCity;
    const [activeCategory, setActiveCategory] = useState<Category | 'all'>('all');
    const [activeGender, setActiveGender] = useState<GenderTarget>('all');
    const [sortBy, setSortBy] = useState<'reliability' | 'discount' | 'price' | 'new'>('reliability');
    const [matchingStores, setMatchingStores] = useState<UserProfile[]>([]);
    const [banners, setBanners] = useState<Banner[]>([]);
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
            setBanners([...contestBanners, ...imgBanners]);
        }).catch(() => { bannerRepository.getActive('home_top').then(setBanners); });
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

    const filteredCities = useMemo(() => {
        if (!topLocation.region) return [];
        return CITIES.filter(c => c.regionId === topLocation.region);
    }, [topLocation.region]);

    const filteredLocations = useMemo(() => {
        if (!topLocation.city) return [];
        return LOCATIONS.filter(l => l.cityId === topLocation.city);
    }, [topLocation.city]);

    // A deal is "in stock" if either: quantity is unlimited, the live counter
    // is positive, OR the seller never set a stock cap (initialQuantity 0/unset)
    // — those are time-based offers where the timer alone gates visibility.
    const hasStock = (d: Deal) => {
        if (d.quantity === 'unlimited') return true;
        if (typeof d.quantity === 'number' && d.quantity > 0) return true;
        const initial = d.initialQuantity;
        const hasCap = typeof initial === 'number' && initial > 0;
        return !hasCap;
    };

    /**
     * Apply the same region/city/mall filter that "كل العروض" uses, so
     * Trending + Top Discounts only show deals from where the user is.
     * Distance-based filtering is intentionally NOT used here — that's the
     * "حولي / Nearby" page's job. This is a city-level cut.
     */
    const applyLocationFilter = (list: Deal[]) =>
        list.filter(d => dealMatchesLocation(d, topLocation));

    // In proximity mode we do NOT cut at the city — we keep every deal and
    // let the tier be the PRIMARY sort key, so the customer's city shows
    // first, then بلجرشي/قلوة/الباحة … expanding outward until the list ends,
    // while each section still ranks by its own metric within a tier.
    // v11.20 — every "live" section excludes Coming Soon deals; they live
    // exclusively in the dedicated "العروض القادمة" carousel below.
    // "Live" = bookable right now: not scheduled for the future AND not past
    // its lifespan. Checking expiry HERE (by the clock) — instead of trusting
    // the DB `status` — is what stops expired offers from lingering when the
    // background status-flip tick was paused (iOS) or the server cron lagged.
    const isLive = (d: Deal) => !isDealComingSoon(d) && !isDealExpiredByTime(d);

    const trendingDeals = useMemo(() => {
        const base = deals.filter(d => d.status === 'active' && isLive(d) && hasStock(d) && !blockedMerchants.includes(d.storeId));
        const list = useProximity ? base.slice() : applyLocationFilter(base);
        list.sort((a, b) => {
            if (useProximity) {
                const t = dealProximityTier(a, homeCity) - dealProximityTier(b, homeCity);
                if (t !== 0) return t;
            }
            return (b.reliabilityScore || 0) - (a.reliabilityScore || 0);
        });
        // v11.25 — sponsors lead this carousel too (gold first, then every 5),
        // then cap at 8 cards so the section stays a tidy horizontal strip.
        return interleaveSponsored(list, sponsors).slice(0, 8);
    }, [deals, topLocation, useProximity, homeCity, blockedMerchants, sponsors, nowTick]);

    const bestDiscounts = useMemo(() => {
        const base = deals.filter(d => d.status === 'active' && isLive(d) && hasStock(d) && !blockedMerchants.includes(d.storeId));
        const list = useProximity ? base.slice() : applyLocationFilter(base);
        list.sort((a, b) => {
            if (useProximity) {
                const t = dealProximityTier(a, homeCity) - dealProximityTier(b, homeCity);
                if (t !== 0) return t;
            }
            return b.discountPercentage - a.discountPercentage;
        });
        return interleaveSponsored(list, sponsors).slice(0, 8);
    }, [deals, topLocation, useProximity, homeCity, blockedMerchants, sponsors, nowTick]);

    // v11.20 — Coming Soon carousel. Same look as trending/discount, but
    // ONLY deals whose startsAt is in the future AND inside the 7-day
    // visibility window. Deals scheduled further out stay hidden until
    // the window opens. Same proximity/location ranking so the section
    // respects the user's region/city/home filter.
    const comingSoonDeals = useMemo(() => {
        const base = deals.filter(d => d.status === 'active' && isDealVisibleComingSoon(d) && hasStock(d) && !blockedMerchants.includes(d.storeId));
        const list = useProximity ? base.slice() : applyLocationFilter(base);
        // Soonest-to-launch first — that's the most actionable for the buyer.
        list.sort((a, b) => {
            if (useProximity) {
                const t = dealProximityTier(a, homeCity) - dealProximityTier(b, homeCity);
                if (t !== 0) return t;
            }
            return (a.startsAt || 0) - (b.startsAt || 0);
        });
        return list.slice(0, 12);
    }, [deals, topLocation, useProximity, homeCity, blockedMerchants]);

    const filteredDeals = useMemo(() => {
        let list = deals.filter(d => d.status === 'active' && isLive(d) && hasStock(d) && !blockedMerchants.includes(d.storeId));

        if (activeCategory !== 'all') list = list.filter(d => d.category === activeCategory || (d.category as string) === 'all');
        if (activeGender !== 'all') list = list.filter(d => d.gender === activeGender || d.gender === 'all');

        // Only hard-cut when the user explicitly picked a region/city/mall.
        // Otherwise keep ALL deals and let home-city proximity rank them so
        // the list never "stops" at the customer's city.
        if (explicitLocationFilter) list = list.filter(d => dealMatchesLocation(d, topLocation));

        if (searchQuery.trim()) {
            // While the user is actively searching, RELEVANCE wins over the
            // sort toggle and the sponsored interleave — they want what they
            // typed, ranked best-match first (item name carries the most
            // weight, then shop, then category/description).
            const scored = list
                .map(d => ({
                    d,
                    score: Math.max(
                        dealService.searchScore(searchQuery, d.itemName) * 1.0,
                        dealService.searchScore(searchQuery, d.shopName) * 0.9,
                        dealService.searchScore(searchQuery, `${d.category} ${d.description || ''}`) * 0.5,
                    ),
                }))
                .filter(x => x.score > 0)
                .sort((a, b) => b.score - a.score || (b.d.reliabilityScore || 0) - (a.d.reliabilityScore || 0));
            // While searching, no sponsored interleave — relevance wins.
            return scored.map(x => ({ deal: x.d, sponsored: false })) as DisplayDeal[];
        }

        const metricCmp = (a: Deal, b: Deal) => {
            if (sortBy === 'discount') return b.discountPercentage - a.discountPercentage;
            if (sortBy === 'price') return a.discountedPrice - b.discountedPrice;
            return b.reliabilityScore - a.reliabilityScore; // 'reliability' / default
        };
        list.sort((a, b) => {
            if (useProximity) {
                const t = dealProximityTier(a, homeCity) - dealProximityTier(b, homeCity);
                if (t !== 0) return t;
            }
            return metricCmp(a, b);
        });

        // v11.23 — Official Sponsors: pull on-target sponsor deals out of the
        // stream and re-insert them as gold ads after every 5 normal deals,
        // rotating across all active sponsors (targeting + expiry respected
        // inside interleaveSponsored).
        return interleaveSponsored(list, sponsors);
    }, [deals, activeCategory, activeGender, topLocation, searchQuery, sortBy, storeProfiles, sponsors, useProximity, homeCity, explicitLocationFilter, blockedMerchants, nowTick]);

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
            {loading && (
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
                    <BannerSlider banners={banners} isRTL={isRTL} />
                </div>
            )}

            {/* Sub-Nav Filters */}
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
                section would just be noise on Home. Placed FIRST (above
                trending) so buyers see what's about to open and can prep,
                exactly the pattern Nasser asked for. */}
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
                ) : loading ? (
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
