import React, { useState, useMemo } from 'react';
import Navbar from '../components/Navbar';
import BottomNav from '../components/BottomNav';
import DealCard from '../components/DealCard';
import TopSlider from '../components/TopSlider';
import InlineBanner from '../components/InlineBanner';
import { REGIONS, CITIES, LOCATIONS, Category, GenderTarget, CATEGORIES, GENDERS, Deal } from '../data/mock';
import { useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { dealService } from '../services/dealService';
import { UserProfile } from '../services/authService';
import { useEffect } from 'react';

const Home: React.FC = () => {
    const history = useHistory();
    const {
        deals, language, topLocation, setTopLocation, loading,
        followedMerchants, toggleFollowMerchant, storeProfiles, refreshDeals,
        sponsoredFeedItems, inlineBanners, topSliderItems, pinnedStoreIds
    } = useApp();
    const [searchQuery, setSearchQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState<Category | 'all'>('all');
    const [activeGender, setActiveGender] = useState<GenderTarget>('all');
    const [sortBy, setSortBy] = useState<'reliability' | 'discount' | 'price' | 'new'>('reliability');
    const [matchingStores, setMatchingStores] = useState<UserProfile[]>([]);

    const isRTL = language === 'ar';

    // Safety net for the buyer's home feed: a fresh fetch on mount and on
    // every tab-focus event guarantees newly posted deals appear without
    // requiring the user to hard-refresh, even if the realtime channel was
    // throttled or dropped a packet.
    useEffect(() => {
        refreshDeals();
        const onVis = () => { if (document.visibilityState === 'visible') refreshDeals(); };
        const onFocus = () => refreshDeals();
        document.addEventListener('visibilitychange', onVis);
        window.addEventListener('focus', onFocus);
        return () => {
            document.removeEventListener('visibilitychange', onVis);
            window.removeEventListener('focus', onFocus);
        };
    }, [refreshDeals]);

    useEffect(() => {
        if (!searchQuery.trim()) {
            setMatchingStores([]);
            return;
        }
        
        // Instant local search for stores
        const query = searchQuery.trim();
        const profiles = Object.values(storeProfiles);
        const matches = profiles.filter(p => {
            const sp = p as any;
            const textToSearch = `${sp.shop || ''} ${sp.name || ''} ${sp.bio || ''}`;
            return dealService.advancedSearchMatch(query, textToSearch);
        }).slice(0, 15);
        
        setMatchingStores(matches as any);
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

    const trendingDeals = useMemo(() => {
        return deals.filter(d => d.status === 'active' && hasStock(d)).sort((a, b) => (b.reliabilityScore || 0) - (a.reliabilityScore || 0)).slice(0, 8);
    }, [deals]);

    const bestDiscounts = useMemo(() => {
        return deals.filter(d => d.status === 'active' && hasStock(d)).sort((a, b) => b.discountPercentage - a.discountPercentage).slice(0, 8);
    }, [deals]);

    const filteredDeals = useMemo(() => {
        let list = deals.filter(d => d.status === 'active' && hasStock(d));

        if (activeCategory !== 'all') list = list.filter(d => d.category === activeCategory || (d.category as string) === 'all');
        if (activeGender !== 'all') list = list.filter(d => d.gender === activeGender || d.gender === 'all');

        // Filter by location
        if (topLocation.mall) {
            list = list.filter(d => d.locationId === topLocation.mall);
        } else if (topLocation.city) {
            const cityLocs = LOCATIONS.filter(l => l.cityId === topLocation.city).map(l => l.id);
            list = list.filter(d => cityLocs.includes(d.locationId));
        } else if (topLocation.region) {
            const regionCities = CITIES.filter(c => c.regionId === topLocation.region).map(c => c.id);
            const regionLocs = LOCATIONS.filter(l => regionCities.includes(l.cityId)).map(l => l.id);
            list = list.filter(d => regionLocs.includes(d.locationId));
        }

        if (searchQuery.trim()) {
            list = list.filter(d => {
                const textToSearch = `${d.itemName} ${d.shopName} ${d.category} ${d.description || ''}`;
                return dealService.advancedSearchMatch(searchQuery, textToSearch);
            });
        }

        if (sortBy === 'discount') list.sort((a, b) => b.discountPercentage - a.discountPercentage);
        if (sortBy === 'price') list.sort((a, b) => a.discountedPrice - b.discountedPrice);
        if (sortBy === 'reliability') list.sort((a, b) => b.reliabilityScore - a.reliabilityScore);

        // Phase 2.6: pinned stores always rank first within the active scope.
        if (pinnedStoreIds.length > 0) {
            const pinSet = new Set(pinnedStoreIds);
            list.sort((a, b) => {
                const ap = pinSet.has(a.storeId) ? 0 : 1;
                const bp = pinSet.has(b.storeId) ? 0 : 1;
                return ap - bp;
            });
        }

        return list;
    }, [deals, activeCategory, activeGender, topLocation, searchQuery, sortBy, pinnedStoreIds]);

    // Phase 2.4: a sponsored deal must be a real deal owned by the sponsoring
    // merchant. Resolve sponsorship.dealId → live Deal once.
    const sponsoredDeals = useMemo(() => {
        return sponsoredFeedItems
            .filter(s => s.type === 'sponsored_deal' && !!s.dealId)
            .map(s => {
                const d = deals.find(x => x.id === s.dealId && x.status === 'active');
                return d ? { sponsorship: s, deal: d } : null;
            })
            .filter(Boolean) as Array<{ sponsorship: typeof sponsoredFeedItems[number]; deal: Deal }>;
    }, [sponsoredFeedItems, deals]);

    // Phase 2.4: weave sponsored cards into the filtered grid every N items.
    const weavedFeed = useMemo(() => {
        if (sponsoredDeals.length === 0) return filteredDeals.map(d => ({ kind: 'deal' as const, deal: d }));
        const interval = Math.max(2, sponsoredDeals[0]?.sponsorship?.insertionInterval || 4);
        const woven: Array<{ kind: 'deal'; deal: Deal } | { kind: 'sponsored'; deal: Deal; sponsorship: any }> = [];
        let sponsoredCursor = 0;
        filteredDeals.forEach((d, idx) => {
            woven.push({ kind: 'deal', deal: d });
            if ((idx + 1) % interval === 0 && sponsoredCursor < sponsoredDeals.length) {
                const s = sponsoredDeals[sponsoredCursor++];
                // Avoid duplicating a sponsored deal that's already in the regular feed.
                if (!filteredDeals.some(x => x.id === s.deal.id)) {
                    woven.push({ kind: 'sponsored', deal: s.deal, sponsorship: s.sponsorship });
                }
            }
        });
        return woven;
    }, [filteredDeals, sponsoredDeals]);

    return (
        <div className="page-content" style={{ background: 'var(--body-bg)', minHeight: '100vh', direction: isRTL ? 'rtl' : 'ltr' }}>
            {loading && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--body-bg)', backdropFilter: 'blur(15px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="spinner" style={{ width: 50, height: 50, border: '5px solid var(--gray-200)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    <p style={{ marginTop: 20, fontWeight: 900, color: 'var(--text-primary)', fontSize: '1.1rem' }}>{isRTL ? 'جاري تجهيز TAKI...' : 'Preparing TAKI...'}</p>
                    
                    <button 
                        onClick={() => {
                            const { setLoading } = (window as any).appContextSetters || {};
                            if (setLoading) setLoading(false);
                            else window.location.reload(); 
                        }}
                        style={{ marginTop: 30, padding: '10px 20px', borderRadius: 12, border: '1.5px solid var(--gray-300)', background: 'none', color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}
                    >
                        {isRTL ? 'تجاوز الانتظار ⏭️' : 'Skip Loading ⏭️'}
                    </button>
                </div>
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

            {/* Phase 2.5.1 — Top sponsor slider */}
            {topSliderItems.length > 0 && <TopSlider items={topSliderItems} />}

            {/* Trending Section */}
            <div style={{ padding: '20px 0 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px 12px' }}>
                    <h2 style={{ fontSize: '1.1rem', fontWeight: 900, color: 'var(--text-primary)' }}>{isRTL ? 'الأكثر تداولاً 🔥' : 'Most Trending 🔥'}</h2>
                </div>
                <div style={{ display: 'flex', gap: 12, padding: '0 16px 10px', overflowX: 'auto' }} className="hide-scrollbar">
                    {trendingDeals.map(deal => (
                        <div key={deal.id} style={{ width: 175, flexShrink: 0 }}>
                            <DealCard deal={deal} onClick={(id) => history.push(`/deal/${id}`)} />
                        </div>
                    ))}
                </div>
            </div>

            {/* Phase 2.5.2 — Inline ad banner between sections */}
            {inlineBanners[0] && (
                <InlineBanner item={inlineBanners[0]} isRTL={isRTL} />
            )}

            {/* High Discount Section */}
            <div style={{ padding: '10px 0 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px 12px' }}>
                    <h2 style={{ fontSize: '1.1rem', fontWeight: 900, color: 'var(--text-primary)' }}>{isRTL ? 'أقوى الخصومات 💸' : 'Highest Discount 💸'}</h2>
                </div>
                <div style={{ display: 'flex', gap: 12, padding: '0 16px 10px', overflowX: 'auto' }} className="hide-scrollbar">
                    {bestDiscounts.map(deal => (
                        <div key={deal.id} style={{ width: 175, flexShrink: 0 }}>
                            <DealCard deal={deal} onClick={(id) => history.push(`/deal/${id}`)} />
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
                                <div key={store.id} onClick={() => history.push(`/store/${store.id}`)} style={{ flexShrink: 0, width: 110, background: 'var(--card-bg)', borderRadius: 16, padding: '12px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.03)', border: '1px solid var(--border-color)', cursor: 'pointer', transition: 'transform 0.2s ease' }}>
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

            <div style={{ padding: '0 16px 10px' }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                    {searchQuery.trim() ? (isRTL ? 'العروض 🛍️' : 'Deals 🛍️') : (isRTL ? 'كل العروض' : 'All Deals')}
                </h2>
            </div>

            {/* Phase 2.6 — Grid focused on product images and clear discount % */}
            <div style={{ padding: '0 16px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
                {weavedFeed.length > 0 ? weavedFeed.map((item, i) => (
                    item.kind === 'sponsored' ? (
                        <DealCard
                            key={`spn-${item.deal.id}-${i}`}
                            deal={item.deal}
                            onClick={(id) => history.push(`/deal/${id}`)}
                            sponsored={{
                                badgeAr: item.sponsorship?.badgeLabelAr,
                                badgeEn: item.sponsorship?.badgeLabelEn
                            }}
                        />
                    ) : (
                        <DealCard
                            key={item.deal.id}
                            deal={item.deal}
                            onClick={(id) => history.push(`/deal/${id}`)}
                            sponsored={pinnedStoreIds.includes(item.deal.storeId) ? { verified: true } : undefined}
                        />
                    )
                )) : (
                    <div style={{ gridColumn: 'span 2', textAlign: 'center', padding: '80px 20px' }}>
                        <div style={{ fontSize: '3rem', marginBottom: 15 }}>🔍</div>
                        <div style={{ fontWeight: 800, color: 'var(--gray-400)' }}>{isRTL ? 'لم نجد عروضاً تطابق هذا البحث' : 'No deals found for this search'}</div>
                    </div>
                )}
            </div>

            <BottomNav />
        </div>
    );
};

export default Home;
