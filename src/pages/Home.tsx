import React, { useState, useMemo } from 'react';
import Navbar from '../components/Navbar';
import BottomNav from '../components/BottomNav';
import DealCard from '../components/DealCard';
import { REGIONS, CITIES, LOCATIONS, Category, GenderTarget, getCity, CATEGORIES, GENDERS, Deal } from '../data/mock';
import { useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { dealService } from '../services/dealService';
import { dealMatchesLocation } from '../utils/helpers';
import PullToRefresh from '../components/PullToRefresh';
import { userRepository } from '../repositories/userRepository';
import { UserProfile } from '../services/authService';
import { useEffect } from 'react';
import BannerSlider from '../components/BannerSlider';
import { bannerRepository, Banner } from '../repositories/bannerRepository';

const Home: React.FC = () => {
    const history = useHistory();
    const { deals, language, topLocation, setTopLocation, loading, followedMerchants, toggleFollowMerchant, storeProfiles, refreshDeals } = useApp();
    const [searchQuery, setSearchQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState<Category | 'all'>('all');
    const [activeGender, setActiveGender] = useState<GenderTarget>('all');
    const [sortBy, setSortBy] = useState<'reliability' | 'discount' | 'price' | 'new'>('reliability');
    const [matchingStores, setMatchingStores] = useState<UserProfile[]>([]);
    const [banners, setBanners] = useState<Banner[]>([]);

    const isRTL = language === 'ar';

    // Initial fetch on mount. Tab-switch / focus refetching is handled
    // centrally in realtimeService.handleVisibilityChange — duplicating it
    // here was firing 4-5 redundant Supabase round-trips per focus event,
    // hurting perceived speed on resumed tabs.
    useEffect(() => {
        refreshDeals();
        bannerRepository.getActive('home_top').then(setBanners);
    }, [refreshDeals]);

    useEffect(() => {
        if (!searchQuery.trim()) {
            setMatchingStores([]);
            return;
        }
        
        // Instant local search for stores — shared, ranked matcher so the
        // closest store name surfaces first and behaves identically on
        // every page.
        setMatchingStores(dealService.matchStores(searchQuery.trim(), storeProfiles, 15) as any);
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

    const trendingDeals = useMemo(() => {
        const base = deals.filter(d => d.status === 'active' && hasStock(d));
        return applyLocationFilter(base)
            .sort((a, b) => (b.reliabilityScore || 0) - (a.reliabilityScore || 0))
            .slice(0, 8);
    }, [deals, topLocation]);

    const bestDiscounts = useMemo(() => {
        const base = deals.filter(d => d.status === 'active' && hasStock(d));
        return applyLocationFilter(base)
            .sort((a, b) => b.discountPercentage - a.discountPercentage)
            .slice(0, 8);
    }, [deals, topLocation]);

    const filteredDeals = useMemo(() => {
        let list = deals.filter(d => d.status === 'active' && hasStock(d));

        if (activeCategory !== 'all') list = list.filter(d => d.category === activeCategory || (d.category as string) === 'all');
        if (activeGender !== 'all') list = list.filter(d => d.gender === activeGender || d.gender === 'all');

        list = list.filter(d => dealMatchesLocation(d, topLocation));

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
            return scored.map(x => x.d);
        }

        if (sortBy === 'discount') list.sort((a, b) => b.discountPercentage - a.discountPercentage);
        if (sortBy === 'price') list.sort((a, b) => a.discountedPrice - b.discountedPrice);
        if (sortBy === 'reliability') list.sort((a, b) => b.reliabilityScore - a.reliabilityScore);

        // Insertion Logic for Sponsored Deals
        const sponsored: Deal[] = [];
        const normal: Deal[] = [];
        list.forEach(d => {
            const profile = storeProfiles[d.storeId] as any;
            if (profile?.is_pinned) {
                sponsored.push(d);
            } else {
                normal.push(d);
            }
        });

        const interleaved: Deal[] = [];
        let sponsoredIndex = 0;
        let normalIndex = 0;
        
        // Insert 1 sponsored deal every 3 normal deals
        while (normalIndex < normal.length || sponsoredIndex < sponsored.length) {
            // Add up to 3 normal deals
            for (let i = 0; i < 3 && normalIndex < normal.length; i++) {
                interleaved.push(normal[normalIndex++]);
            }
            // Add 1 sponsored deal
            if (sponsoredIndex < sponsored.length) {
                interleaved.push(sponsored[sponsoredIndex++]);
            }
        }
        return interleaved;
    }, [deals, activeCategory, activeGender, topLocation, searchQuery, sortBy, storeProfiles]);

    return (
        <>
        <PullToRefresh isRTL={isRTL} onRefresh={() => {
            // Fire-and-forget: PullToRefresh caps the spinner regardless,
            // and the realtime channels will deliver any updates we miss.
            refreshDeals();
            return Promise.resolve();
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
                            {REGIONS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                        <select
                            value={topLocation.city}
                            onChange={e => setTopLocation({ ...topLocation, city: e.target.value, mall: '' })}
                            disabled={!topLocation.region}
                            style={{ flex: 1, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border-color)', background: !topLocation.region ? 'var(--gray-100)' : 'var(--card-bg)', fontSize: '0.85rem', fontWeight: 700, appearance: 'none', opacity: !topLocation.region ? 0.6 : 1, minHeight: 38, color: 'var(--text-primary)' }}
                        >
                            <option value="">{isRTL ? 'كل المدن' : 'All Cities'}</option>
                            {filteredCities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>
                    <select
                        value={topLocation.mall}
                        onChange={e => setTopLocation({ ...topLocation, mall: e.target.value })}
                        disabled={!topLocation.city}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border-color)', background: !topLocation.city ? 'var(--gray-100)' : 'var(--card-bg)', fontSize: '0.85rem', fontWeight: 700, appearance: 'none', opacity: !topLocation.city ? 0.6 : 1, minHeight: 38, color: 'var(--text-primary)' }}
                    >
                        <option value="">{isRTL ? 'كل المولات والأسواق' : 'All Malls & Markets'}</option>
                        {filteredLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                </div>
            </div>

            {/* Banner Slider Section */}
            {banners.length > 0 && (
                <div style={{ margin: '16px 0 8px' }}>
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
                    {trendingDeals.map(deal => {
                        const isSponsored = (storeProfiles[deal.storeId] as any)?.is_pinned;
                        return (
                            <div key={deal.id} style={{ width: 175, flexShrink: 0 }}>
                                <DealCard deal={deal} onClick={(id) => history.push(`/deal/${id}`)} isSponsored={isSponsored} />
                            </div>
                        );
                    })}
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
                    {bestDiscounts.map(deal => {
                        const isSponsored = (storeProfiles[deal.storeId] as any)?.is_pinned;
                        return (
                            <div key={deal.id} style={{ width: 175, flexShrink: 0 }}>
                                <DealCard deal={deal} onClick={(id) => history.push(`/deal/${id}`)} isSponsored={isSponsored} />
                            </div>
                        );
                    })}
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
                    filteredDeals.map(deal => {
                        const isSponsored = (storeProfiles[deal.storeId] as any)?.is_pinned;
                        return <DealCard key={deal.id} deal={deal} onClick={(id) => history.push(`/deal/${id}`)} isSponsored={isSponsored} />;
                    })
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
