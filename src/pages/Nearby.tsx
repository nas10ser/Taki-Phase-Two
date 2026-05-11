import React, { useState, useMemo, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import { LOCATIONS, getLocation, USER_LOCATION } from '../data/mock';
import { useApp } from '../context/AppContext';
import { MapContainer, TileLayer, Marker, Popup, useMap, Circle, Polygon } from 'react-leaflet';
import { REGIONS, CITIES } from '../data/mock';
import { dealService } from '../services/dealService';
import { CATEGORIES } from '../data/mock';
import { getDistance, resolveDealLocation } from '../utils/helpers';

const MapUpdater = ({ center }: { center: [number, number] }) => {
    const map = useMap();
    useEffect(() => {
        map.flyTo(center, 12);
    }, [center, map]);
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
    const { deals, language, customAlert, topLocation, checkMarketingAlerts } = useApp();
    const [userLat, setUserLat] = useState(USER_LOCATION.lat);
    const [userLng, setUserLng] = useState(USER_LOCATION.lng);
    const [userLocationType, setUserLocationType] = useState<'home' | 'work' | 'other' | null>(null);
    const [radius, setRadius] = useState(30);
    const [searchQuery, setSearchQuery] = useState('');
    
    const [selectedRegion, setSelectedRegion] = useState('');
    const [selectedCity, setSelectedCity] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [locationType, setLocationType] = useState('');
    const [selectedLocationId, setSelectedLocationId] = useState('');

    const isRTL = language === 'ar';
    const locName = topLocation.mall ? (LOCATIONS.find(l => l.id === topLocation.mall)?.name || topLocation.mall) : topLocation.city || topLocation.region || (isRTL ? 'كل المناطق' : 'All Regions');

    useEffect(() => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                pos => { 
                    const lat = pos.coords.latitude;
                    const lng = pos.coords.longitude;
                    setUserLat(lat); 
                    setUserLng(lng);
                    // Trigger marketing alert check
                    checkMarketingAlerts(lat, lng);
                },
                () => { /* Use default */ }
            );
        }
    }, [checkMarketingAlerts]);

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
            return matchesRadius && matchesSearch && matchesCategory && matchesRegion && matchesCity && matchesLocation && d.status === 'active' && hasStock;
        }).sort((a, b) => a.distance - b.distance);
    }, [deals, userLat, userLng, radius, searchQuery, selectedCategory, selectedRegion, selectedCity, selectedLocationId]);

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
                    <button onClick={() => {
                        if (navigator.geolocation) {
                            navigator.geolocation.getCurrentPosition(
                                pos => {
                                    setUserLat(pos.coords.latitude);
                                    setUserLng(pos.coords.longitude);
                                    customAlert(isRTL ? '✅ تم تحديث موقعك المباشر بنجاح!' : '✅ Location updated successfully!');
                                },
                                () => { customAlert(isRTL ? "لا يمكن الوصول للموقع" : "Cannot access location"); }
                            );
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
            <div className="animate-fade-in" style={{ height: mapHeight, margin: '0 16px', borderRadius: 24, overflow: 'hidden', boxShadow: '0 8px 30px rgba(0,0,0,0.1)', marginBottom: 24, transition: 'height 0.3s ease' }}>
                <MapContainer center={[userLat, userLng]} zoom={12} style={{ height: '100%', width: '100%' }}>
                    <MapUpdater center={[userLat, userLng]} />
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
                                        <small>📍 {distStr} · 🚗 {driveM} {isRTL ? 'د' : 'min'}{d <= 3 ? ` · 🚶 ${walkM} ${isRTL ? 'د' : 'min'}` : ''}</small>
                                    </div>
                                </Popup>
                            </Marker>
                        );
                    })}
                </MapContainer>
            </div>
            )}
            
            {/* List View Below Map */}
            {viewMode !== 'map' && (
            <div style={{ padding: '0 16px 100px' }}>
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
                    const showWalk = dist <= 3; // beyond 3 km walking is impractical
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
