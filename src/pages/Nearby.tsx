import React, { useState, useMemo, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import { LOCATIONS, getLocation, USER_LOCATION } from '../data/mock';
import { useApp } from '../context/AppContext';
import { MapContainer, TileLayer, Marker, Popup, useMap, Circle, Polygon } from 'react-leaflet';
import { REGIONS, CITIES } from '../data/mock';
import { dealService } from '../services/dealService';
import { CATEGORIES } from '../data/mock';
import { getDistance, resolveDealLocation, isDealComingSoon } from '../utils/helpers';

/**
 * Live-follow controller. The old version called `map.flyTo(center, 12)` on
 * every position change, which (a) snapped the zoom back to 12 each time and
 * (b) animated a fresh fly on every GPS tick — so driving felt like the map
 * never kept up. Now: pick a street-level zoom ONCE, then `panTo` the user
 * on each fix keeping their zoom, so the map tracks them smoothly as they
 * walk/drive. If the user drags the map we pause following (so they can
 * explore); the floating 📍 button flips `follow` back on and re-centers.
 */
const FollowController = ({
    lat, lng, follow, onUserDrag, initZoom = 15,
}: { lat: number; lng: number; follow: boolean; onUserDrag: () => void; initZoom?: number }) => {
    const map = useMap();
    const didInit = React.useRef(false);

    useEffect(() => {
        const onDrag = () => onUserDrag();
        map.on('dragstart', onDrag);
        const t = setTimeout(() => map.invalidateSize(), 0);
        return () => { map.off('dragstart', onDrag); clearTimeout(t); };
    }, [map, onUserDrag]);

    useEffect(() => {
        if (!lat || !lng) return;
        if (!didInit.current) {
            didInit.current = true;
            map.setView([lat, lng], initZoom);
            return;
        }
        if (follow) {
            map.setView([lat, lng], map.getZoom() || 15, { animate: true, duration: 0.5 });
        }
    }, [lat, lng, follow, map]);

    return null;
};

const generateCirclePoints = (lat: number, lng: number, radiusKm: number, numPoints: number = 64) => {
    const points: [number, number][] = [];
    const kmPerLat = 111.32;
    const kmPerLng = 111.32 * Math.cos(lat * Math.PI / 180);

    for (let i = 0; i <= numPoints; i++) {
        const angle = (i * 2 * Math.PI) / numPoints;
        const dLat = (radiusKm * Math.sin(angle)) / kmPerLat;
        const dLng = (radiusKm * Math.cos(angle)) / kmPerLng;
        points.push([lat + dLat, lng + dLng]);
    }
    return points;
};

const Nearby: React.FC = () => {
    const history = useHistory();
    const { deals, language, customAlert, topLocation, storeProfiles, followedMerchants, toggleFollowMerchant, blockedMerchants, liveLocation, requestLiveLocation } = useApp();

    // Deep-link filters (Telegram bot opens /nearby?lat&lng&radius&region&city&mall&cat).
    // The bot's Nearby page + smart-alert radius preview reuse THIS exact map so the
    // owner sees the same light-circle (inside radius) / dark-mask (outside). v11.76
    const urlParams = useMemo(() => {
        const p = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
        const numOf = (k: string) => { const v = parseFloat(p.get(k) || ''); return Number.isFinite(v) ? v : null; };
        const mall = p.get('mall') || '';
        let city = p.get('city') || '';
        let region = p.get('region') || '';
        if (mall && !city) { const l = LOCATIONS.find(x => x.id === mall); if (l) city = l.cityId; }
        if (city && !region) { const c = CITIES.find(x => x.id === city); if (c) region = c.regionId; }
        let centerLat = numOf('lat'), centerLng = numOf('lng');
        if (centerLat == null || centerLng == null) {
            const l = mall ? LOCATIONS.find(x => x.id === mall) : null;
            const c = (!l && city) ? CITIES.find(x => x.id === city) : null;
            const r = (!l && !c && region) ? REGIONS.find(x => x.id === region) : null;
            const src = l || c || r;
            if (src && (src as any).lat) { centerLat = (src as any).lat; centerLng = (src as any).lng; }
        }
        const radius = numOf('radius');
        const initRadius = radius != null ? radius : (region && !city && !mall ? 0 : 30);
        const hasGeo = numOf('lat') != null && numOf('lng') != null;
        const hasFilter = hasGeo || !!region || !!city || !!mall || !!p.get('cat') || radius != null;
        return { centerLat, centerLng, initRadius, region, city, mall, cat: p.get('cat') || '', hasFilter };
    }, []);

    const [userLat, setUserLat] = useState(urlParams.centerLat ?? USER_LOCATION.lat);
    const [userLng, setUserLng] = useState(urlParams.centerLng ?? USER_LOCATION.lng);
    const [userLocationType, setUserLocationType] = useState<'home' | 'work' | 'other' | null>(null);
    // Live-follow: ON by default so the map tracks the user as they move.
    // Dragging the map turns it off (explore freely); the 📍 button re-arms it.
    // OFF when arriving with deep-link filters so the chosen area/radius stays put.
    const [followMode, setFollowMode] = useState(!urlParams.hasFilter);
    const [radius, setRadius] = useState(urlParams.initRadius);
    const [searchQuery, setSearchQuery] = useState('');

    const [selectedRegion, setSelectedRegion] = useState(urlParams.region);
    const [selectedCity, setSelectedCity] = useState(urlParams.city);
    const [selectedCategory, setSelectedCategory] = useState(urlParams.cat || 'all');
    const [locationType, setLocationType] = useState('');
    const [selectedLocationId, setSelectedLocationId] = useState(urlParams.mall);

    // Initial zoom so a deep-linked radius circle fits the screen on open.
    const initZoom = useMemo(() => {
        if (!urlParams.hasFilter) return 15;
        const r = urlParams.initRadius;
        if (!r || r <= 0) return urlParams.region && !urlParams.city ? 8 : 11;
        if (r <= 2) return 13; if (r <= 5) return 12; if (r <= 10) return 11;
        if (r <= 20) return 10; if (r <= 50) return 9; return 8;
    }, [urlParams]);

    const isRTL = language === 'ar';
    const locName = topLocation.mall ? (LOCATIONS.find(l => l.id === topLocation.mall)?.name || topLocation.mall) : topLocation.city || topLocation.region || (isRTL ? 'كل المناطق' : 'All Regions');

    // Live geolocation tracking. watchPosition keeps the user marker and
    // distance/ETA pills updating while the user drives. The browser
    // throttles to whatever the OS allows, but we ask for high accuracy
    // and only react if the new fix moved by ≥ 30 m so we don't redraw
    // the list on every GPS jitter.
    // Live position is owned by the app-wide tracker (AppContext): a single
    // watchPosition that follows the shopper everywhere and persists their
    // location to the DB as they move. Here we just mirror it into the map
    // center + marker while "follow" is on, so the map tracks the user
    // second-by-second as they walk/drive. Dragging the map turns follow off
    // (explore freely); the 📍 button re-arms it. If location is already
    // granted the fix simply flows in — we never re-ask.
    useEffect(() => {
        if (liveLocation && followMode) {
            setUserLat(liveLocation.lat);
            setUserLng(liveLocation.lng);
        }
    }, [liveLocation, followMode]);

    const nearbyDeals = useMemo(() => {
        return deals.map(deal => {
            const loc = getLocation(deal.locationId);
            const lat = deal.mapLocation?.lat || loc?.lat || 0;
            const lng = deal.mapLocation?.lng || loc?.lng || 0;
            const distance = getDistance(userLat, userLng, lat, lng);
            return { ...deal, distance, lat, lng };
        }).filter(d => {
            const lName = getLocation(d.locationId)?.name || '';
            const textToSearch = `${d.itemName} ${d.shopName} ${lName} ${d.category} ${d.description || ''}`;
            const matchesSearch = dealService.advancedSearchMatch(searchQuery, textToSearch);
            const matchesCategory = selectedCategory === 'all' || d.category === selectedCategory || (d.category as string) === 'all';
            
            // Proximity is the main filter, but we also respect strict selections if they exist.
            // resolveDealLocation handles both the (loc → city) chain and the
            // denormalized region/city + map-coord fallback in one call.
            const { regionId: dRegion, cityId: dCity } = resolveDealLocation(d);
            const matchesRegion = !selectedRegion || (dRegion === selectedRegion);
            const matchesCity = !selectedCity || (dCity === selectedCity);
            const matchesLocation = !selectedLocationId || (d.locationId === selectedLocationId);
            
            // Time-based offers (no stock cap) stay visible until the timer
            // expires, even when quantity reads 0. Only true sold-out deals
            // — those the seller capped — are hidden here.
            const hasCap = typeof d.initialQuantity === 'number' && d.initialQuantity > 0;
            const hasStock = d.quantity === 'unlimited'
                || (typeof d.quantity === 'number' && d.quantity > 0)
                || !hasCap;
            const matchesRadius = radius === 0 || d.distance <= radius;
            // v11.20 — exclude Coming Soon deals from the Nearby map+list.
            // The map is for "what can I get RIGHT NOW within X km"; a
            // locked future deal would be visual noise here.
            return matchesRadius && matchesSearch && matchesCategory && matchesRegion && matchesCity && matchesLocation && d.status === 'active' && hasStock && !isDealComingSoon(d) && !blockedMerchants.includes(d.storeId);
        }).sort((a, b) => a.distance - b.distance);
    }, [deals, userLat, userLng, radius, searchQuery, selectedCategory, selectedRegion, selectedCity, selectedLocationId, blockedMerchants]);

    // Store-by-name results — same shared engine as Home/DealsList so search
    // is consistent on every page (stores aren't geo-bound, so a name match
    // shows regardless of radius).
    const matchingStores = useMemo(
        () => (searchQuery.trim() ? dealService.matchStores(searchQuery.trim(), storeProfiles, 12) : []),
        [searchQuery, storeProfiles]
    );

    const [viewMode, setViewMode] = useState<'both' | 'map' | 'list'>('both');
    
    // Calculate initial map height based on viewMode
    const mapHeight = viewMode === 'map' ? '65vh' : '35vh';

    return (
        <div className="page-content" style={{ background: 'var(--body-bg)', minHeight: '100vh', direction: isRTL ? 'rtl' : 'ltr' }}>
            <div className="premium-bar" style={{ paddingBottom: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h1 style={{ fontSize: '1.4rem', fontWeight: 900, color: 'white', margin: 0 }}>
                        {isRTL ? 'خريطة العروض الحصرية 🗺️' : 'Exclusive Deals Map 🗺️'}
                    </h1>
                </div>
                
                <div style={{ background: 'rgba(80, 80, 90, 0.2)', backdropFilter: 'blur(10px)', border: '1px solid rgba(100, 100, 100, 0.15)', padding: '12px 16px', borderRadius: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: '1.2rem' }}>📍</span>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.7rem', color: 'rgba(150, 150, 150, 0.8)', fontWeight: 800, marginBottom: 2 }}>{isRTL ? 'تصفح العروض في:' : 'Browsing deals in:'}</div>
                        <div style={{ fontSize: '1rem', fontWeight: 900, color: 'white' }}>{locName}</div>
                    </div>
                </div>
            </div>

            <div style={{ padding: '16px 16px 12px' }}>
                <div style={{ background: 'var(--card-bg)', borderRadius: 14, padding: '12px', marginBottom: 12, boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 800, marginBottom: 8, color: 'var(--text-primary)' }}>
                        {isRTL ? 'تغيير موقع البحث:' : 'Change Search Location:'}
                    </div>
                    
                    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
                        <select 
                            style={{ flexShrink: 0, padding: '4px 8px', borderRadius: 8, border: '1px solid var(--gray-200)', background: 'var(--body-bg)', outline: 'none', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)', height: 30 }}
                            value={selectedRegion}
                            onChange={e => { 
                                const regId = e.target.value;
                                setSelectedRegion(regId); 
                                setSelectedCity(''); 
                                setSelectedLocationId('');
                                if (regId) {
                                    setFollowMode(false); // browsing a chosen area — don't snap back to GPS
                                    setRadius(0); // Show whole region
                                    const reg = REGIONS.find(r => r.id === regId);
                                    if (reg && reg.lat && reg.lng) {
                                        setUserLat(reg.lat);
                                        setUserLng(reg.lng);
                                    }
                                }
                            }}
                        >
                            <option value="">{isRTL ? 'كل المناطق' : 'All Regions'}</option>
                            {REGIONS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                        <select 
                            style={{ flexShrink: 0, padding: '4px 8px', borderRadius: 8, border: '1px solid var(--gray-200)', background: 'var(--body-bg)', outline: 'none', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)', height: 30 }}
                            value={selectedCity}
                            onChange={e => { 
                                const cityId = e.target.value;
                                setSelectedCity(cityId); 
                                setSelectedLocationId('');
                                if (cityId) {
                                    setFollowMode(false);
                                    setRadius(30); // Default 30km for city
                                    const city = CITIES.find(c => c.id === cityId);
                                    if (city) { setUserLat(city.lat); setUserLng(city.lng); }
                                }
                            }}
                        >
                            <option value="">{isRTL ? 'كل المدن' : 'All Cities'}</option>
                            {CITIES.filter(c => !selectedRegion || c.regionId === selectedRegion).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <select 
                            style={{ flexShrink: 0, padding: '4px 8px', borderRadius: 8, border: '1px solid var(--gray-200)', background: 'var(--body-bg)', outline: 'none', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)', height: 30 }}
                            value={selectedCategory}
                            onChange={e => setSelectedCategory(e.target.value)}
                        >
                            <option value="all">{isRTL ? 'كل التصنيفات' : 'All Categories'}</option>
                            {CATEGORIES.filter(c => c.id !== 'all').map(c => <option key={c.id} value={c.id}>{c.emoji} {isRTL ? c.ar : c.en}</option>)}
                        </select>
                        <select 
                            style={{ flexShrink: 0, padding: '4px 8px', borderRadius: 8, border: '1px solid var(--gray-200)', background: 'var(--body-bg)', outline: 'none', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)', height: 30 }}
                            value={locationType}
                            onChange={e => { setLocationType(e.target.value); setSelectedLocationId(''); }}
                        >
                            <option value="">{isRTL ? 'الكل (أنواع)' : 'All Types'}</option>
                            <option value="mall">{isRTL ? 'مول 🛍️' : 'Mall 🛍️'}</option>
                            <option value="market">{isRTL ? 'سوق 🏛️' : 'Market 🏛️'}</option>
                            <option value="store">{isRTL ? 'محل 🏪' : 'Store 🏪'}</option>
                        </select>
                        <select 
                            style={{ flexShrink: 0, padding: '4px 8px', borderRadius: 8, border: '1px solid var(--gray-200)', background: 'var(--body-bg)', outline: 'none', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)', height: 30 }}
                            value={selectedLocationId}
                            onChange={e => {
                                const locId = e.target.value;
                                setSelectedLocationId(locId);
                                if (locId) {
                                    setFollowMode(false);
                                    const loc = LOCATIONS.find(l => l.id === locId);
                                    if (loc) { setUserLat(loc.lat); setUserLng(loc.lng); }
                                }
                            }}
                        >
                            <option value="">{isRTL ? 'اختر المكان...' : 'Select Place...'}</option>
                            {LOCATIONS.filter(l => (!selectedCity || l.cityId === selectedCity) && (!locationType || l.type === locationType)).map(l => (
                                <option key={l.id} value={l.id}>{l.name}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                    <input 
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder={isRTL ? "البحث عن عرض، مول، محل..." : "Search deal, mall, store..."}
                        style={{ width: '100%', padding: '10px 14px', borderRadius: 12, border: '1.5px solid var(--border-color)', background: 'var(--card-bg)', color: 'var(--text-primary)', outline: 'none', fontWeight: 700, boxShadow: 'var(--shadow-sm)', fontSize: '0.85rem' }}
                    />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 6 }}>
                    <label style={{ fontSize: '0.78rem', fontWeight: 900, color: 'var(--primary)', whiteSpace: 'nowrap' }}>
                        🎯 {isRTL ? 'في حدود:' : 'Within:'}
                    </label>
                    <select value={radius} onChange={e => setRadius(Number(e.target.value))}
                        style={{ background: 'rgba(16, 185, 129, 0.12)', border: '1.5px solid var(--primary)', color: 'var(--primary)', padding: '6px 10px', borderRadius: 10, fontSize: '0.8rem', fontWeight: 900, minHeight: 32 }}>
                        <option value={0}>{isRTL ? 'الكل 🌍' : 'All 🌍'}</option>
                        <option value={1}>1 {isRTL ? 'كم' : 'km'}</option>
                        <option value={2}>2 {isRTL ? 'كم' : 'km'}</option>
                        <option value={5}>5 {isRTL ? 'كم' : 'km'}</option>
                        <option value={10}>10 {isRTL ? 'كم' : 'km'}</option>
                        <option value={20}>20 {isRTL ? 'كم' : 'km'}</option>
                        <option value={30}>30 {isRTL ? 'كم' : 'km'}</option>
                        <option value={50}>50 {isRTL ? 'كم' : 'km'}</option>
                        <option value={100}>100 {isRTL ? 'كم' : 'km'}</option>
                    </select>
                    <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary, var(--gray-400))', whiteSpace: 'nowrap' }}>
                        {nearbyDeals.length} {isRTL ? 'عرض' : 'deals'}
                    </span>
                    <div style={{ flex: 1, minWidth: 10 }} />
                    <button onClick={async () => {
                        // Turn on the app-wide live tracker (Safari-safe, never hangs).
                        // It persists the fix to the account and keeps following the
                        // user; the map mirrors `liveLocation` via the effect above.
                        const ok = await requestLiveLocation();
                        if (ok) {
                            // Tapping "My Location" implies "show me what's around ME" —
                            // drop any manual region/city/mall selection so the radius
                            // does the work (otherwise an old "Makkah" filter yields 0).
                            setSelectedRegion('');
                            setSelectedCity('');
                            setSelectedLocationId('');
                            setLocationType('');
                            setRadius(30);
                            setFollowMode(true); // re-arm live follow
                            customAlert(isRTL ? '✅ تم تفعيل موقعك المباشر — الخريطة تتابعك الآن' : '✅ Live location on — the map now follows you');
                        } else {
                            customAlert(isRTL ? '📍 فعّل إذن الموقع من إعدادات المتصفح لعرض الأقرب إليك' : '📍 Enable location permission to see what\'s nearest you');
                        }
                    }} style={{ background: 'var(--primary)', color: 'white', border: 'none', padding: '8px 16px', borderRadius: 12, fontSize: '0.85rem', fontWeight: 800, whiteSpace: 'nowrap', minHeight: 44 }}>
                        {isRTL ? 'موقعي 📍' : 'My Location 📍'}
                    </button>
                </div>
                
                {/* View Mode Toggle */}
                <div style={{ display: 'flex', gap: 6, marginTop: 8, background: 'var(--chip-inactive-bg)', padding: 5, borderRadius: 18 }}>
                    <button onClick={() => setViewMode('both')} className={`segment-chip${viewMode === 'both' ? ' active' : ''}`}>{isRTL ? 'خريطة وقائمة' : 'Map & List'}</button>
                    <button onClick={() => setViewMode('map')}  className={`segment-chip${viewMode === 'map'  ? ' active' : ''}`}>{isRTL ? 'الخريطة فقط' : 'Map Only'}</button>
                    <button onClick={() => setViewMode('list')} className={`segment-chip${viewMode === 'list' ? ' active' : ''}`}>{isRTL ? 'القائمة فقط' : 'List Only'}</button>
                </div>
            </div>

            {/* Hybrid Map View */}
            {viewMode !== 'list' && (
            <div
                className="animate-fade-in"
                style={{
                    height: mapHeight,
                    margin: '0 16px',
                    borderRadius: 24,
                    overflow: 'hidden',
                    boxShadow: '0 8px 30px rgba(0,0,0,0.1)',
                    // When the list isn't rendered below, the map is the last
                    // element on the page — leave enough room for the fixed
                    // BottomNav (≈ 64 px + safe-area). Otherwise a 24 px
                    // breather is plenty since the list provides its own
                    // bottom padding.
                    // Bigger floor for map-only since nothing sits under it; in
                    // hybrid mode the list provides its own padding-bottom.
                    marginBottom: viewMode === 'map' ? 'calc(env(safe-area-inset-bottom, 0px) + 120px)' : 24,
                    transition: 'height 0.3s ease',
                    position: 'relative',
                }}
            >
                <MapContainer center={[userLat, userLng]} zoom={15} attributionControl={false} style={{ height: '100%', width: '100%' }}>
                    <FollowController lat={userLat} lng={userLng} follow={followMode} onUserDrag={() => setFollowMode(false)} initZoom={initZoom} />
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    
                    {/* Visual Mask for Selection */}
                    {(radius > 0 || selectedRegion || selectedCity) && (
                        <>
                            <Polygon 
                                positions={[
                                    [[ -90, -180 ], [ 90, -180 ], [ 90, 180 ], [ -90, 180 ]], // Outer World
                                    generateCirclePoints(
                                        userLat, 
                                        userLng, 
                                        radius > 0 ? radius : (selectedRegion ? 150 : 30) // Use 150km for Region, 30km for City as visual "All"
                                    ) 
                                ]}
                                pathOptions={{ fillColor: 'var(--dark)', fillOpacity: 0.45, stroke: false }}
                            />
                            <Circle 
                                center={[userLat, userLng]} 
                                radius={(radius > 0 ? radius : (selectedRegion ? 150 : 30)) * 1000} 
                                pathOptions={{ 
                                    color: 'var(--primary)', 
                                    weight: radius > 0 ? 2 : 0, // No border for "All" auto-highlight
                                    fillOpacity: 0.05 
                                }} 
                            />
                        </>
                    )}

                    <Marker position={[userLat, userLng]}>
                        <Popup>{isRTL ? '📍 موقعك الحالي' : '📍 Your Location'}</Popup>
                    </Marker>
                    {nearbyDeals.map(deal => {
                        const d = Number.isFinite(deal.distance) ? deal.distance : 0;
                        const distStr = d < 1 ? `${Math.round(d * 1000)} ${isRTL ? 'م' : 'm'}` : `${d.toFixed(1)} ${isRTL ? 'كم' : 'km'}`;
                        const driveM = Math.max(1, Math.round((d / 35) * 60));
                        const walkM = Math.max(1, Math.round((d / 5) * 60));
                        return (
                            <Marker key={deal.id} position={[deal.lat, deal.lng]}>
                                <Popup>
                                    <div
                                        role="button"
                                        tabIndex={0}
                                        aria-label={deal.itemName}
                                        onClick={() => history.push(`/deal/${deal.id}`)}
                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); history.push(`/deal/${deal.id}`); } }}
                                        style={{ cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
                                    >
                                        <strong>{deal.itemName}</strong><br />
                                        <span style={{ color: 'var(--danger)', fontWeight: 700 }}>{deal.discountedPrice} {isRTL ? 'ر.س' : 'SAR'}</span><br />
                                        <small>📍 {distStr} · 🚗 {driveM} {isRTL ? 'د' : 'min'}{d <= 1 ? ` · 🚶 ${walkM} ${isRTL ? 'د' : 'min'}` : ''}</small>
                                    </div>
                                </Popup>
                            </Marker>
                        );
                    })}
                </MapContainer>
                {/* Recenter / resume-follow control (Google-Maps style). Lit
                    green while actively following; tap to re-arm after a drag. */}
                <button
                    type="button"
                    aria-label={isRTL ? 'تتبّع موقعي' : 'Follow my location'}
                    onClick={() => setFollowMode(true)}
                    style={{
                        position: 'absolute',
                        insetInlineEnd: 14,
                        bottom: viewMode === 'map' ? 'calc(env(safe-area-inset-bottom, 0px) + 28px)' : 16,
                        zIndex: 1000,
                        width: 46, height: 46, borderRadius: '50%',
                        border: 'none',
                        background: followMode ? 'var(--primary)' : 'var(--card-bg)',
                        color: followMode ? '#fff' : 'var(--primary)',
                        boxShadow: '0 6px 18px rgba(0,0,0,0.28)',
                        fontSize: '1.25rem', fontWeight: 900, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        WebkitTapHighlightColor: 'transparent',
                    }}
                >
                    {followMode ? '📍' : '🎯'}
                </button>
            </div>
            )}
            
            {/* List View Below Map */}
            {viewMode !== 'map' && (
            <div style={{ padding: '0 16px calc(env(safe-area-inset-bottom, 0px) + 120px)' }}>
                {searchQuery.trim() && matchingStores.length > 0 && (
                    <div style={{ marginBottom: 18 }}>
                        <h2 style={{ fontSize: '1rem', fontWeight: 900, marginBottom: 12, color: 'var(--text-primary)' }}>{isRTL ? 'المتاجر 🏪' : 'Stores 🏪'}</h2>
                        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }} className="hide-scrollbar">
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
                <h2 style={{ fontSize: '1rem', fontWeight: 900, marginBottom: 16, color: 'var(--text-primary)' }}>
                    {isRTL ? `النتائج القريبة (${nearbyDeals.length})` : `Nearby Results (${nearbyDeals.length})`}
                </h2>
                {nearbyDeals.length > 0 ? nearbyDeals.map(deal => {
                    const dLoc = getLocation(deal.locationId);
                    const dist = Number.isFinite(deal.distance) ? deal.distance : 0;
                    const distLabel = dist < 1
                        ? (isRTL ? `${Math.round(dist * 1000)} م` : `${Math.round(dist * 1000)} m`)
                        : (isRTL ? `${dist.toFixed(1)} كم` : `${dist.toFixed(1)} km`);
                    const isVeryClose = dist <= 2;
                    // Travel time estimates. Walking: 5 km/h (1.4 m/s). Driving in a
                    // Saudi city with signals/traffic: ~35 km/h average. Floor at 1 min
                    // so we never render "0 د".
                    const walkMin = Math.max(1, Math.round((dist / 5) * 60));
                    const driveMin = Math.max(1, Math.round((dist / 35) * 60));
                    const showWalk = dist <= 1; // beyond 1 km walking is impractical — car-only badge
                    const walkLabel = isRTL ? `${walkMin} د` : `${walkMin} min`;
                    const driveLabel = isRTL ? `${driveMin} د` : `${driveMin} min`;
                    return (
                        <div
                            key={deal.id}
                            role="button"
                            tabIndex={0}
                            aria-label={deal.itemName}
                            className="nearby-card animate-fade-in"
                            onClick={() => history.push(`/deal/${deal.id}`)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); history.push(`/deal/${deal.id}`); } }}
                            style={{ cursor: 'pointer', background: 'var(--card-bg)', borderRadius: 20, padding: 12, display: 'flex', gap: 15, marginBottom: 12, border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', WebkitTapHighlightColor: 'transparent', position: 'relative' }}
                        >
                            <img src={deal.images[0]} loading="lazy" decoding="async" width={85} height={85} alt={deal.itemName} style={{ width: 85, height: 85, borderRadius: 16, objectFit: 'cover' }}
                                onError={(e: React.SyntheticEvent<HTMLImageElement, Event>) => { (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1543852786-1cf6624b9987?w=300'; }} />
                             <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deal.shopName}</span>
                                    <span style={{
                                        marginInlineStart: 'auto',
                                        background: isVeryClose ? '#10b981' : 'var(--primary)',
                                        color: '#ffffff',
                                        fontSize: '0.7rem',
                                        fontWeight: 900,
                                        padding: '3px 9px',
                                        borderRadius: 999,
                                        whiteSpace: 'nowrap',
                                        boxShadow: '0 1px 4px rgba(0,0,0,0.18)'
                                    }}>📍 {distLabel}</span>
                                </div>
                                <div style={{ fontWeight: 900, fontSize: '0.95rem', marginBottom: 4, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deal.itemName}</div>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                                    <span style={{ color: 'var(--danger)', fontWeight: 900, fontSize: '1rem' }}>{deal.discountedPrice} ر.س</span>
                                    <span style={{ color: 'var(--gray-400)', textDecoration: 'line-through', fontSize: '0.75rem' }}>{deal.originalPrice}</span>
                                </div>
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: dLoc ? 4 : 0 }}>
                                    <span style={{
                                        background: 'var(--body-bg)',
                                        color: 'var(--text-primary)',
                                        border: '1px solid var(--border-color)',
                                        fontSize: '0.68rem',
                                        fontWeight: 800,
                                        padding: '2px 7px',
                                        borderRadius: 999,
                                        whiteSpace: 'nowrap'
                                    }}>🚗 {driveLabel}</span>
                                    {showWalk && (
                                        <span style={{
                                            background: 'var(--body-bg)',
                                            color: 'var(--text-primary)',
                                            border: '1px solid var(--border-color)',
                                            fontSize: '0.68rem',
                                            fontWeight: 800,
                                            padding: '2px 7px',
                                            borderRadius: 999,
                                            whiteSpace: 'nowrap'
                                        }}>🚶 {walkLabel}</span>
                                    )}
                                </div>
                                {dLoc && (
                                    <div style={{ fontSize: '0.7rem', color: 'var(--gray-400)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        🏷️ {dLoc.name}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                }) : (
                    <div className="empty-state animate-fade-in" style={{ textAlign: 'center', padding: '60px 20px' }}>
                        <div style={{ fontSize: '4rem', marginBottom: 16 }}>📍</div>
                        <div style={{ fontWeight: 800, color: 'var(--gray-400)' }}>{isRTL ? 'لا توجد عروض في هذا النطاق' : 'No deals in this radius'}</div>
                    </div>
                )}
            </div>
            )}

            <BottomNav />
        </div>
    );
};

export default Nearby;
