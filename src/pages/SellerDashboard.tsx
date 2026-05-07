import React, { useState, useRef, useEffect } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import BarcodeScanner from '../components/BarcodeScanner';
import DualCalendarPicker from '../components/DualCalendarPicker';
import { REGIONS, CITIES, LOCATIONS, Category, GenderTarget, Deal, findNearestCity, findNearestLocation, CATEGORIES, GENDERS } from '../data/mock';
import { useApp } from '../context/AppContext';
import { useBooking } from '../hooks/useBooking';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import { validationService } from '../services/validationService';
import { logger } from '../utils/logger';
import { normalizeArabicNumerals, toHijri } from '../utils/helpers';
import { storageService } from '../services/storageService';

const LocationMarker = ({ position, autoUpdate }: { position: [number, number], autoUpdate: (lat: number, lng: number) => void }) => {
    useMapEvents({
        click(e) {
            autoUpdate(e.latlng.lat, e.latlng.lng);
        },
    });
    return position ? (
        <Marker 
            position={position} 
            draggable={true} 
            eventHandlers={{
                dragend: (e) => {
                    const markerOrigin = e.target.getLatLng();
                    autoUpdate(markerOrigin.lat, markerOrigin.lng);
                }
            }} 
        />
    ) : null;
};

const MapCenterUpdater = ({ center }: { center: [number, number] }) => {
    const map = useMap();
    React.useEffect(() => {
        if (center[0] && center[1]) {
            map.flyTo(center, 15, { duration: 0.8 }); // 15 zoom for better mall focus
        }
    }, [center[0], center[1], map]);
    return null;
};

const Countdown: React.FC<{ createdAt: number, expiresInMinutes: number, isRTL: boolean }> = ({ createdAt, expiresInMinutes, isRTL }) => {
    const [timeLeft, setTimeLeft] = React.useState('');
    React.useEffect(() => {
        const tick = () => {
            const now = Date.now();
            const lifespan = (expiresInMinutes || 0) * 60 * 1000;
            const expiry = (createdAt || 0) + lifespan;
            const diff = expiry - now;
            if (diff <= 0) {
                setTimeLeft(isRTL ? 'معرض منتهي' : 'Expired');
                return;
            }
            const d = Math.floor(diff / (1000 * 60 * 60 * 24));
            const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
            const m = Math.floor((diff / (1000 * 60)) % 60);
            const s = Math.floor((diff / 1000) % 60);
            if (d > 0) setTimeLeft(`${d}d ${h}h`);
            else setTimeLeft(`${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
        };
        const timer = setInterval(tick, 1000);
        tick();
        return () => clearInterval(timer);
    }, [createdAt, expiresInMinutes, isRTL]);
    return <span>{timeLeft}</span>;
};

// SmartHijriDatePicker is now a separate component

const SellerDashboard: React.FC = () => {
    const history = useHistory();
    const location = useLocation();
    const { addDeal, deleteDeal, updateDeal, deals, language, user, loading, notifications, markNotifRead, storeProfiles, addNotification, bookings, customAlert, customConfirm, customPrompt, addReply, acknowledgeBooking, updateProfile } = useApp();
    const { completeBooking } = useBooking();
    const isRTL = language === 'ar';
    const [view, setView] = useState<'form' | 'products' | 'orders' | 'scanner' | 'notifications' | 'insights'>('form');
    const [scannerOpen, setScannerOpen] = useState(false);
    const [showDualPicker, setShowDualPicker] = useState(false);
    // Stores selected dates from DualCalendarPicker
    const [expiryGregorian, setExpiryGregorian] = useState(''); // YYYY-MM-DD gregorian
    const [expiryHijriDisplay, setExpiryHijriDisplay] = useState(''); // YYYY-MM-DD hijri for display
    const [manualCodes, setManualCodes] = useState<{ [key: string]: string }>({});
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [editingDealId, setEditingDealId] = useState<string | null>(null);
    const [isPaymentEnabled, setIsPaymentEnabled] = useState(false);
    const [isSubscriptionValid, setIsSubscriptionValid] = useState(true);

    // Fetch payment settings
    React.useEffect(() => {
        const checkSub = async () => {
            const { supabase } = await import('../services/supabaseClient');
            const { data } = await supabase.from('platform_settings').select('value').eq('key', 'payment_gateway_enabled').maybeSingle();
            const enabled = data?.value === true;
            setIsPaymentEnabled(enabled);

            if (enabled && user?.id) {
                const profile = storeProfiles[user.id];
                if (!profile || !profile.subscription_expires_at) {
                    setIsSubscriptionValid(false);
                } else {
                    const expiry = new Date(profile.subscription_expires_at).getTime();
                    setIsSubscriptionValid(expiry > Date.now());
                }
            } else {
                setIsSubscriptionValid(true);
            }
        };
        checkSub();
    }, [user, storeProfiles]);

    // Sync view with URL tab parameter
    React.useEffect(() => {
        const params = new URLSearchParams(location.search);
        const tab = params.get('tab');
        if (tab && (['form' , 'products' , 'orders' , 'notifications' , 'scanner' , 'insights'] as const).includes(tab as any)) {
            setView(tab as any);
        } else if (!tab && !params.get('edit')) {
            // Default to form if no tab and not editing
            setView('form');
        }
    }, [location.search]);

    // Handle Edit Mode from URL
    React.useEffect(() => {
        const params = new URLSearchParams(location.search);
        const editId = params.get('edit');
        if (editId) {
            const dealToEdit = deals.find(d => d.id === editId);
            if (dealToEdit && editingDealId !== dealToEdit.id) {
                const origin = params.get('origin') as 'active' | 'expired';
                const source = params.get('source');
                
                handleEdit(dealToEdit, origin || undefined);
                // Ensure we are in form view
                setView('form');
                if (source) (window as any).editSource = source;
            }
        }
    }, [location.search, deals, editingDealId]);

    const reActivateDeal = async (dealId: string) => {
        const deal = deals.find(d => d.id === dealId);
        if (deal) {
            const confirmed = await customConfirm(isRTL ? 'هل تريد تجديد هذا العرض ليعود للظهور في الصفحة الرئيسية؟' : 'Do you want to renew this deal to appear on the home page?');
            if (!confirmed) return;

            // Restore original quantity (or default to 10 if missing for old mocks)
            const restoreQty = deal.initialQuantity !== undefined ? deal.initialQuantity : (deal.quantity === 0 ? 10 : deal.quantity);
            
            const updatedDeal = {
                ...deal,
                quantity: restoreQty,
                createdAt: Date.now(), // FRESH TIMESTAMP
                status: 'active' as const
            };
            
            await updateDeal(updatedDeal);
            customAlert(isRTL ? '✅ تم تجديد العرض بنجاح!' : '✅ Deal renewed successfully!');
        }
    };

    const togglePauseDeal = async (dealId: string) => {
        const deal = deals.find(d => d.id === dealId);
        if (deal) {
            const isCurrentlyPaused = deal.status === 'paused';
            const msg = isCurrentlyPaused 
                ? (isRTL ? 'هل تريد استئناف العرض ليعود نشطاً للمشترين؟' : 'Do you want to resume this deal and make it active for buyers?')
                : (isRTL ? 'هل تريد إيقاف العرض مؤقتاً؟ سينتقل للعروض السابقة ولن يراه المشترون.' : 'Do you want to pause this deal? It will move to previous deals and buyers won\'t see it.');
            
            const confirmed = await customConfirm(msg);
            if (!confirmed) return;

            const updatedDeal = {
                ...deal,
                status: (isCurrentlyPaused ? 'active' : 'paused') as any
            };
            await updateDeal(updatedDeal);
            customAlert(isRTL 
                ? (isCurrentlyPaused ? '✅ تم استئناف العرض بنجاح!' : '⏸️ تم إيقاف العرض مؤقتاً!') 
                : (isCurrentlyPaused ? '✅ Deal resumed!' : '⏸️ Deal paused!')
            );
        }
    };

    // Redirect if not logged in
    useEffect(() => {
        if (!loading && !user) {
            logger.info('🚫 SellerDashboard: No user found, redirecting to home...');
            history.replace('/');
        }
    }, [user, loading, history]);

    const handleGenerateSyncLink = () => {
        const myDeals = deals.filter(d => d.storeId === user?.id);
        const myProfileInfo = storeProfiles[user?.id || ''] || {};
        const allNotifs = notifications || [];
        const allBookings = bookings || [];
        const data = {
            deals: myDeals,
            profiles: { [user?.id || '']: myProfileInfo },
            notifications: allNotifs,
            bookings: allBookings,
            user: user
        };
        const jsonStr = JSON.stringify(data);
        const encoded = btoa(encodeURIComponent(jsonStr).replace(/%([0-9A-F]{2})/g, (match, p1) => {
            return String.fromCharCode(parseInt(p1, 16))
        }));
        const syncUrl = `${window.location.origin.replace(/\/$/, '')}${window.location.pathname}?sync=${encoded}`;
        
        if (navigator.clipboard) {
            navigator.clipboard.writeText(syncUrl).then(() => {
                customAlert(language === 'ar' ? '🚀 تم نسخ رابط المزامنة الشامل! افتحه في أي متصفح آخر.' : '🚀 Full sync link copied! Open it in any other browser.');
            });
        } else {
            const el = document.createElement('textarea');
            el.value = syncUrl;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            customAlert(language === 'ar' ? '🚀 تم نسخ رابط المزامنة الشامل!' : '🚀 Full sync link copied!');
        }
    };

    // toHijri and normalizeArabicNumerals imported from '../utils/helpers'

    // Form State
    const [itemName, setItemName] = useState('');
    const [shopName, setShopName] = useState('');
    const [originalPrice, setOriginalPrice] = useState('');
    const [discountedPrice, setDiscountedPrice] = useState('');
    const [quantity, setQuantity] = useState<number | string>('');
    const [isUnlimited, setIsUnlimited] = useState(false);
    const [expiryType, setExpiryType] = useState<'duration' | 'date' | 'stock' | 'hours'>('hours');
    const [days, setDays] = useState('');
    const [expiryHours, setExpiryHours] = useState('');
    const [expiryDate, setExpiryDate] = useState(''); // Gregorian YYYY-MM-DD (used for calculation)
    const [category, setCategory] = useState<Category | ''>('');
    const [gender, setGender] = useState<GenderTarget>('all');
    const [size, setSize] = useState('');
    const [description, setDescription] = useState('');
    const [images, setImages] = useState<string[]>([]);
    
    // Cascading Location State
    const [selectedRegion, setSelectedRegion] = useState('');
    const [selectedCity, setSelectedCity] = useState(user?.cityId || 'riyadh_city');
    const [locationType, setLocationType] = useState<'mall' | 'market' | 'store' | 'other'>('mall');
    const [locationId, setLocationId] = useState('');
    const [customLocationName, setCustomLocationName] = useState('');
    
    const [googleMapsLink, setGoogleMapsLink] = useState('');
    const [lastResolvedLink, setLastResolvedLink] = useState('');
    const [resolvingLink, setResolvingLink] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [mapPos, setMapPos] = useState<[number, number]>([24.7136, 46.6753]);
    const [submitted, setSubmitted] = useState(false);

    // Auto-resolve link with debounce
    useEffect(() => {
        const timer = setTimeout(() => {
            if (googleMapsLink && googleMapsLink !== lastResolvedLink && googleMapsLink.includes('http')) {
                handleMapLinkUpdate();
            }
        }, 1500);
        return () => clearTimeout(timer);
    }, [googleMapsLink, lastResolvedLink]);

    const handleMapLinkUpdate = async (force: boolean = false) => {
        if (!googleMapsLink) return;
        if (!force && googleMapsLink === lastResolvedLink) return;
        setResolvingLink(true);

        try {
            const cleanLink = normalizeArabicNumerals(googleMapsLink.trim());

            // 0. Direct coordinates: "24.71,46.67" — fast path, no network.
            const directCoord = cleanLink.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
            if (directCoord) {
                const lat = parseFloat(directCoord[1]);
                const lng = parseFloat(directCoord[2]);
                if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
                    setMapPos([lat, lng]);
                    setLastResolvedLink(googleMapsLink);
                    autoUpdateLocation(lat, lng);
                    return [lat, lng];
                }
            }

            const tryExtract = (text: string) => {
                if (!text || typeof text !== 'string' || text.length < 5) return null;
                
                let decoded = text;
                try { decoded = decodeURIComponent(text); } catch(e) {}

                const isValidKSA = (lat: number, lng: number) => {
                    return lat > 15 && lat < 33 && lng > 33 && lng < 56;
                };

                let bestMatch: any = null;
                const trySet = (latStr: string, lngStr: string) => {
                    const lat = parseFloat(latStr);
                    const lng = parseFloat(lngStr);
                    if (isValidKSA(lat, lng)) {
                        bestMatch = [null, latStr, lngStr];
                        return true;
                    }
                    return false;
                };

                const patterns = [
                    /@(-?\d+\.\d+)\s*(?:,|%2C)\s*(-?\d+\.\d+)/gi,
                    /[?&](?:q|ll|query|center|markers|latlng|daddr|destination)=(-?\d+\.\d+)\s*(?:,|%2C)\s*(-?\d+\.\d+)/gi
                ];

                for (const p of patterns) {
                    for (const m of [...text.matchAll(p)]) if (trySet(m[1], m[2])) return bestMatch;
                    const pNoG = new RegExp(p.source, 'gi');
                    for (const m of [...decoded.matchAll(pNoG)]) if (trySet(m[1], m[2])) return bestMatch;
                }

                const latM1 = text.match(/!3d(-?\d+\.\d+)/) || decoded.match(/!3d(-?\d+\.\d+)/);
                const lngM1 = text.match(/!(?:2d|4d)(-?\d+\.\d+)/) || decoded.match(/!(?:2d|4d)(-?\d+\.\d+)/);
                if (latM1 && lngM1 && trySet(latM1[1], lngM1[1])) return bestMatch;

                const brute = [...text.matchAll(/(-?\d+\.\d+)\s*(?:,|%2C)\s*(-?\d+\.\d+)/g), ...decoded.matchAll(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/g)];
                for (const b of brute) {
                    if (trySet(b[1], b[2])) return bestMatch;
                }

                return null;
            };

            let match = tryExtract(cleanLink);

            if (!match && cleanLink.includes('http')) {
                const target = cleanLink.startsWith('http') ? cleanLink : `https://${cleanLink}`;

                // First try our own serverless function — same-origin, no CSP
                // friction, follows redirects server-side. This is the only
                // reliable path for `maps.app.goo.gl` short links pasted from
                // mobile when public proxies are blocked by CSP or throttled.
                try {
                    const ownRes = await fetch(`/api/resolve-map?url=${encodeURIComponent(target)}`, {
                        signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
                    });
                    if (ownRes.ok) {
                        const data = await ownRes.json();
                        if (typeof data?.lat === 'number' && typeof data?.lng === 'number') {
                            match = [null, data.lat.toString(), data.lng.toString()] as any;
                        } else if (data?.url) {
                            const m = tryExtract(data.url);
                            if (m) match = m;
                        }
                    }
                } catch { /* fall through to public proxies */ }

                // Race multiple proxies in PARALLEL — whichever returns
                // resolvable content first wins. Sequential probing was the
                // root cause of `maps.app.goo.gl` failures: when allorigins
                // was throttled, the user waited 8s for it before we tried
                // the next one. Now we wait for the fastest responder.
                const probe = async (url: string): Promise<{ url?: string; html?: string } | null> => {
                    try {
                        const ac = new AbortController();
                        const timeoutId = setTimeout(() => ac.abort(), 7000);
                        const res = await fetch(url, { signal: ac.signal, redirect: 'follow' });
                        clearTimeout(timeoutId);
                        if (!res.ok) return null;
                        const text = await res.text();
                        try {
                            const data = JSON.parse(text);
                            return {
                                html: data.contents || text,
                                url: data?.status?.url || data?.url
                            };
                        } catch {
                            return { html: text };
                        }
                    } catch {
                        return null;
                    }
                };

                // OpenGraph API unfurlers (Microlink, Dub.co) act exactly like
                // WhatsApp or Twitter bots. Google Maps whitelists them and
                // immediately returns a lightweight HTML with `og:image` and
                // `al:android:url` containing coordinates, bypassing all the
                // complex JS/consent redirects that break standard proxies.
                const proxies = [
                    `https://api.microlink.io/?url=${encodeURIComponent(target)}`,
                    `https://api.dub.co/metatags?url=${encodeURIComponent(target)}`,
                    `https://r.jina.ai/${target}`,
                    `https://api.allorigins.win/get?url=${encodeURIComponent(target)}`,
                    `https://corsproxy.io/?${encodeURIComponent(target)}`,
                    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`,
                    `https://thingproxy.freeboard.io/fetch/${target}`
                ];

                const results = match ? [] : await Promise.allSettled(proxies.map(probe));

                for (const r of results) {
                    if (r.status !== 'fulfilled' || !r.value) continue;
                    const { url: resolvedUrl, html } = r.value;
                    if (resolvedUrl) {
                        const m = tryExtract(resolvedUrl);
                        if (m) { match = m; break; }
                    }
                    if (html) {
                        const m = tryExtract(html);
                        if (m) { match = m; break; }
                    }
                }

                // Last resort: geocode the page <title> via Nominatim
                if (!match) {
                    for (const r of results) {
                        if (r.status !== 'fulfilled' || !r.value?.html) continue;
                        const html = r.value.html;
                        
                        // Try to extract title from JSON (Microlink/Dub) or HTML (<title>)
                        let placeName = '';
                        try {
                            const data = JSON.parse(html);
                            placeName = data?.data?.title || data?.title || '';
                        } catch {
                            const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
                            placeName = titleMatch ? titleMatch[1] : '';
                        }

                        placeName = placeName
                            .replace(/\s*[-|·]\s*Google Maps.*$/i, '')
                            .replace(/^Google Maps[:\s-]*/i, '')
                            .trim();
                            
                        if (placeName && placeName.length > 3 && placeName !== 'Google Maps') {
                            try {
                                const geoRes = await fetch(
                                    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(placeName)}&countrycodes=sa&limit=1`
                                ).then(res => res.json()).catch(() => null);
                                if (geoRes && geoRes[0]) {
                                    const lat = parseFloat(geoRes[0].lat);
                                    const lng = parseFloat(geoRes[0].lon);
                                    if (lat > 15 && lat < 33 && lng > 33 && lng < 56) {
                                        match = [null, lat.toString(), lng.toString()] as any;
                                        break;
                                    }
                                }
                            } catch {}
                        }
                    }
                }
            }

            if (match) {
                const lat = parseFloat(match[1]);
                const lng = parseFloat(match[2]);
                if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
                    setMapPos([lat, lng]);
                    setLastResolvedLink(googleMapsLink);
                    autoUpdateLocation(lat, lng);
                    if (force) {
                        customAlert(isRTL ? '✅ تم تحديد الموقع على الخريطة بنجاح!' : '✅ Location successfully pinned on the map!');
                    }
                    return [lat, lng];
                }
            }

            customAlert(isRTL
                ? '❌ تعذّر فتح الرابط المختصر. جرّب نسخ الرابط الطويل من المتصفح، أو الصق الإحداثيات مباشرة بصيغة: 24.7136, 46.6753'
                : '❌ Could not resolve the short link. Try the full URL from your browser, or paste coordinates directly as: 24.7136, 46.6753'
            );
        } catch (err) {
            console.error('Resolution error:', err);
        } finally {
            setResolvingLink(false);
        }
    };


    React.useEffect(() => {
        if (user?.shop && !shopName) setShopName(user.shop);
        // Sync map position with remote profile if available
        if (user?.lat && user?.lng && mapPos[0] === 24.7136 && mapPos[1] === 46.6753) {
            setMapPos([user.lat, user.lng]);
        }
        if (user?.googleMapsLink && !googleMapsLink) {
            setGoogleMapsLink(user.googleMapsLink);
        }
    }, [user, shopName, mapPos]);

    const saveShopLocation = async () => {
        if (!user) return;
        try {
            await updateProfile({ lat: mapPos[0], lng: mapPos[1], googleMapsLink });
            customAlert(isRTL ? '✅ تم حفظ موقع المتجر الدائم بنجاح!' : '✅ Permanent shop location saved successfully!');
        } catch (e: any) {
            console.error('Save shop location error:', e);
            customAlert(isRTL ? '❌ فشل حفظ الموقع. حاول مرة أخرى.' : '❌ Failed to save location. Try again.');
        }
    };

    const normalizedOriginalPrice = normalizeArabicNumerals(originalPrice);
    const normalizedDiscountedPrice = normalizeArabicNumerals(discountedPrice);

    const discount = normalizedOriginalPrice && normalizedDiscountedPrice
        ? Math.round(((Number(normalizedOriginalPrice) - Number(normalizedDiscountedPrice)) / Number(normalizedOriginalPrice)) * 100)
        : 0;

    // Removed auto-centering effect to prevent overwriting manual map pin placement

    const [uploadingImages, setUploadingImages] = useState<boolean>(false);

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        setUploadingImages(true);
        const results = await Promise.all(
            Array.from(files).map(async (file) => {
                // Reject obviously broken inputs early so the user gets a clear msg.
                if (!file.type.startsWith('image/')) {
                    return { ok: false, reason: 'type', name: file.name } as const;
                }
                if (file.size > 8 * 1024 * 1024) {
                    return { ok: false, reason: 'size', name: file.name } as const;
                }
                // Try Supabase storage first.
                const url = await storageService.uploadImage(file);
                if (url) {
                    setImages(prev => [...prev, url].slice(0, 4));
                    return { ok: true, via: 'remote' } as const;
                }
                // Fallback: base64 — works offline / when storage RLS rejects.
                try {
                    const dataUrl = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = (ev) => resolve((ev.target?.result as string) || '');
                        reader.onerror = () => reject(reader.error);
                        reader.readAsDataURL(file);
                    });
                    if (dataUrl) {
                        setImages(prev => [...prev, dataUrl].slice(0, 4));
                        return { ok: true, via: 'local' } as const;
                    }
                } catch (err) {
                    console.error('Local image fallback failed:', err);
                }
                return { ok: false, reason: 'upload', name: file.name } as const;
            })
        );
        setUploadingImages(false);

        const failed = results.filter((r) => !r.ok) as Array<{ ok: false; reason: 'type' | 'size' | 'upload'; name: string }>;
        if (failed.length > 0) {
            const sizeFails = failed.filter((f) => f.reason === 'size');
            const typeFails = failed.filter((f) => f.reason === 'type');
            const uploadFails = failed.filter((f) => f.reason === 'upload');
            const lines: string[] = [];
            if (sizeFails.length) lines.push(isRTL ? `⚠️ ${sizeFails.length} صورة أكبر من 8MB` : `⚠️ ${sizeFails.length} image(s) exceed 8MB`);
            if (typeFails.length) lines.push(isRTL ? `⚠️ ${typeFails.length} ملف ليس صورة` : `⚠️ ${typeFails.length} file(s) not an image`);
            if (uploadFails.length) lines.push(isRTL ? `❌ تعذّر رفع ${uploadFails.length} صورة (تحقق من اتصال الإنترنت)` : `❌ Failed to upload ${uploadFails.length} image(s) (check connection)`);
            customAlert(lines.join('\n'));
        }
    };

    const autoUpdateLocation = (lat: number, lng: number) => {
        setMapPos([lat, lng]);
        
        // 1. Check if near a known Mall/Market
        const nearestLoc = findNearestLocation(lat, lng);
        if (nearestLoc) {
            setLocationType(nearestLoc.type);
            setLocationId(nearestLoc.id);
            setSelectedCity(nearestLoc.cityId);
            const city = CITIES.find(c => c.id === nearestLoc.cityId);
            if (city) setSelectedRegion(city.regionId);
        } else {
            // 2. Not in a mall, find nearest city
            const nearestCity = findNearestCity(lat, lng);
            if (nearestCity) {
                setSelectedCity(nearestCity.id);
                setSelectedRegion(nearestCity.regionId);
            }
            // Default to "Store" (محل) as requested
            setLocationType('store');
            setLocationId('other');
        }
    };

    const handleLocateMe = () => {
        if (!navigator.geolocation) {
            customAlert(isRTL ? 'المتصفح لا يدعم تحديد الموقع' : 'Geolocation not supported');
            return;
        }

        // On iPhone/Safari, Geolocation requires HTTPS. Check if we are in a secure context.
        if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
            customAlert(isRTL 
                ? '⚠️ تحديد الموقع يتطلب اتصالاً آمناً (HTTPS). يرجى التأكد من تشغيل الموقع عبر رابط آمن على الايفون.' 
                : '⚠️ Geolocation requires HTTPS. Please ensure you are using a secure connection on iPhone.');
            // Fallback to default but warn
            autoUpdateLocation(24.7136, 46.6753);
            return;
        }
        
        const options = { 
            enableHighAccuracy: true, 
            timeout: 15000, 
            maximumAge: 0
        };

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                autoUpdateLocation(pos.coords.latitude, pos.coords.longitude);
                customAlert(isRTL ? '✅ تم تحديد موقعك بدقة!' : '✅ Precise location captured!');
            },
            (err) => {
                console.warn('Geolocation error:', err);
                let errorMsg = '';
                if (err.code === 1) {
                    errorMsg = isRTL 
                        ? 'يرجى السماح بصلاحية الموقع من إعدادات المتصفح والجهاز.' 
                        : 'Please enable location permission in browser and device settings.';
                } else if (err.code === 3) {
                    errorMsg = isRTL 
                        ? 'انتهى وقت المحاولة. تأكد من أنك في مكان مفتوح أو مفعل الـ GPS.' 
                        : 'Location request timed out. Ensure GPS is on and try again.';
                } else {
                    errorMsg = isRTL ? 'تعذر الحصول على الموقع بدقة.' : 'Could not get precise location.';
                }
                
                customAlert(errorMsg);
                // Only fallback to Riyadh if the user is truly lost and has no previous coords
                if (mapPos[0] === 24.7136 && mapPos[1] === 46.6753) {
                    autoUpdateLocation(24.7136, 46.6753);
                }
            },
            options
        );
    };

    const [productsTab, setProductsTab] = useState<'active' | 'expired'>('active');
    const [originTab, setOriginTab] = useState<'active' | 'expired'>('active');

    const resetForm = () => {
        setEditingDealId(null);
        setItemName('');
        setOriginalPrice('');
        setDiscountedPrice('');
        setImages([]);
        setQuantity('');
        setDays('');
        setExpiryHours('');
        setExpiryType('hours');
        setSize('');
        setCustomLocationName('');
        setCategory('');
        setDescription('');
        setExpiryDate('');
        setExpiryGregorian('');
        setExpiryHijriDisplay('');
        
        // Reset location to shop defaults
        if (user?.lat && user?.lng) {
            setMapPos([user.lat, user.lng]);
        } else {
            setMapPos([24.7136, 46.6753]);
        }
        setGoogleMapsLink(user?.googleMapsLink || '');
    };

    const handleEdit = (deal: Deal, forceOrigin?: 'active' | 'expired') => {
        setOriginTab(forceOrigin || productsTab);
        setEditingDealId(deal.id);
        setItemName(deal.itemName);
        setShopName(deal.shopName);
        setOriginalPrice(deal.originalPrice.toString());
        setDiscountedPrice(deal.discountedPrice.toString());
        setQuantity(deal.quantity === 'unlimited' ? '' : deal.quantity);
        setIsUnlimited(deal.quantity === 'unlimited');

        // Prefer the seller's original choice (stored on the row) so the
        // edit form opens on the same tab they last picked. Fall back to
        // inferring from `expiresInMinutes` only when the row predates the
        // expiry_type column (older deals from before migration v8.16).
        const savedType = deal.expiryType;
        const minutes = deal.expiresInMinutes || 0;
        if (savedType === 'hours') {
            setExpiryType('hours');
            setExpiryHours(minutes ? (minutes / 60).toString() : '');
            setDays('');
            setExpiryGregorian('');
            setExpiryDate('');
        } else if (savedType === 'duration') {
            setExpiryType('duration');
            setDays(minutes ? Math.ceil(minutes / (24 * 60)).toString() : '');
            setExpiryHours('');
            setExpiryGregorian('');
            setExpiryDate('');
        } else if (savedType === 'date') {
            setExpiryType('date');
            if (deal.expiryDate) {
                setExpiryGregorian(deal.expiryDate);
                // Recompute hijri from the gregorian date for display
                try {
                    const parts = new Intl.DateTimeFormat('en-US-u-ca-islamic-uma', { year: 'numeric', month: '2-digit', day: '2-digit' })
                        .formatToParts(new Date(deal.expiryDate));
                    const hY = parts.find(p => p.type === 'year')?.value || '';
                    const hM = parts.find(p => p.type === 'month')?.value || '';
                    const hD = parts.find(p => p.type === 'day')?.value || '';
                    if (hY && hM && hD) setExpiryHijriDisplay(`${hY}-${hM}-${hD}`);
                } catch {}
            }
            setDays('');
            setExpiryHours('');
        } else if (savedType === 'stock') {
            setExpiryType('stock');
            setDays('');
            setExpiryHours('');
            setExpiryGregorian('');
            setExpiryDate('');
        } else if (minutes) {
            // Legacy heuristic for rows without expiry_type
            if (minutes < 1440) {
                setExpiryType('hours');
                setExpiryHours((minutes / 60).toString());
                setDays('');
            } else {
                setExpiryType('duration');
                setDays(Math.ceil(minutes / (24 * 60)).toString());
                setExpiryHours('');
            }
        }
        
        setCategory(deal.category);
        setGender(deal.gender);
        setSize(deal.size || '');
        setDescription(deal.description);
        setImages(deal.images);
        setGoogleMapsLink(deal.googleMapsLink || '');
        setLastResolvedLink(deal.googleMapsLink || '');
        
        // Restore Location State
        if (deal.mapLocation) {
            setMapPos([deal.mapLocation.lat, deal.mapLocation.lng]);
        }
        
        if (deal.locationId) {
            setLocationId(deal.locationId);
            // Try to find the city/region from the locationId
            const foundLoc = LOCATIONS.find(l => l.id === deal.locationId);
            if (foundLoc) {
                setLocationType(foundLoc.type);
                setSelectedCity(foundLoc.cityId);
                const city = CITIES.find(c => c.id === foundLoc.cityId);
                if (city) setSelectedRegion(city.regionId);
            } else if (deal.locationId.startsWith('custom_')) {
                setLocationType('store');
                // For custom locations, we rely on the saved lat/lng to find the nearest city
                if (deal.mapLocation) {
                    const nearestCity = findNearestCity(deal.mapLocation.lat, deal.mapLocation.lng);
                    if (nearestCity) {
                        setSelectedCity(nearestCity.id);
                        setSelectedRegion(nearestCity.regionId);
                    }
                }
            }
        }
        
        setView('form');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };


    const submitAction = async (stayOnForm: boolean, forcePublish: boolean = true) => {
        if (isSaving) return;
        setIsSaving(true);
        try {
            const existingDeal = editingDealId ? deals.find(d => d.id === editingDealId) : null;
            
            // Auto-resolve link if changed and not resolved yet
            let finalLat = mapPos[0];
            let finalLng = mapPos[1];
            
            if (googleMapsLink && googleMapsLink !== lastResolvedLink) {
                // Add a 5s timeout to link resolution to avoid hanging the entire form submission
                const resolutionPromise = handleMapLinkUpdate();
                const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000));
                
                const resolved = await Promise.race([resolutionPromise, timeoutPromise]);
                if (resolved) {
                    finalLat = resolved[0];
                    finalLng = resolved[1];
                }
            }

        // Validation logic
        const rawQuantity = isUnlimited ? 'unlimited' : (Number(normalizeArabicNumerals(quantity.toString())) || 0);
        // Time-based offers (hours/duration/date) without an explicit quantity
        // are treated as unlimited stock — the timer is what ends them, not a
        // sold-out counter. If the seller picks 'stock' mode the validator
        // below already requires a positive quantity.
        const finalQuantity: number | 'unlimited' = (rawQuantity !== 'unlimited' && rawQuantity <= 0 && expiryType !== 'stock')
            ? 'unlimited'
            : rawQuantity;
        const finalDays = days ? Number(normalizeArabicNumerals(days)) : 0;
        const finalHours = expiryHours ? Number(normalizeArabicNumerals(expiryHours)) : 0;
        const hasDate = expiryType === 'date' && expiryDate;
        const hasHours = expiryType === 'hours' && finalHours > 0;
        const hasDuration = expiryType === 'duration' && finalDays > 0;
        const hasStock = expiryType === 'stock' && !isUnlimited && Number(finalQuantity) > 0;

        if (!itemName || !shopName || !originalPrice || !discountedPrice || !category) {
            await customAlert(isRTL ? 'يرجى ملء جميع الحقول الإجبارية (المعلمة بـ *)' : 'Please fill all required fields');
            return;
        }

        // Logic enforcement:
        // 1. If Unlimited -> needs SOME end signal (hours / days / date).
        //    'stock' is incompatible with unlimited. The seller picks which.
        if (isUnlimited && !hasHours && !hasDuration && !hasDate) {
            await customAlert(isRTL
                ? '⚠️ عند اختيار "لا محدود" حدّد متى ينتهي العرض: بالساعات أو الأيام أو بتاريخ.'
                : '⚠️ Unlimited deals still need an end: hours, days, or a date.');
            return;
        }

        // 2. If Stock-based -> MUST have quantity
        if (expiryType === 'stock' && !isUnlimited && !finalQuantity) {
            await customAlert(isRTL ? '⚠️ يرجى تحديد الكمية المتوفرة' : '⚠️ Please specify available quantity');
            return;
        }

        // 3. Must have at least one expiration method
        if (!hasDate && !hasDuration && !hasStock && !hasHours) {
            await customAlert(isRTL ? '⚠️ يرجى تحديد تاريخ انتهاء أو مدة بالساعات أو الأيام' : '⚠️ Please specify an end date, hours, or duration');
            return;
        }

        // 4. Hours mode needs an explicit hour count — no silent default.
        if (expiryType === 'hours' && !finalHours) {
            await customAlert(isRTL ? '⚠️ حدّد عدد الساعات قبل النشر' : '⚠️ Please specify how many hours');
            return;
        }

        // Price validation: discount must be less than original
        if (Number(normalizeArabicNumerals(discountedPrice)) >= Number(normalizeArabicNumerals(originalPrice))) {
            await customAlert(isRTL ? '⚠️ سعر الخصم يجب أن يكون أقل من السعر الأصلي!' : '⚠️ Discount price must be less than original price!');
            return;
        }

        if (images.length === 0) {
            await customAlert(isRTL ? 'يرجى إضافة صورة واحدة على الأقل' : 'Please add at least one image');
            return;
        }

        const parseHijriAndGetMinutes = (hijriDate: string) => {
            const [y, m, d] = hijriDate.split('-').map(Number);
            if(!y || !m || !d) return 525600;
            const currParts = new Intl.DateTimeFormat('en-US-u-ca-islamic-uma', {year:'numeric', month:'numeric', day:'numeric'}).formatToParts(new Date());
            const cY = parseInt(currParts.find(p=>p.type==='year')?.value||'1445', 10);
            const cM = parseInt(currParts.find(p=>p.type==='month')?.value||'1', 10);
            const cD = parseInt(currParts.find(p=>p.type==='day')?.value||'1', 10);
            let diffDays = (y - cY) * 354 + (m - cM) * 29.5 + (d - cD);
            if (diffDays < 1) diffDays = 1;
            return Math.floor(diffDays * 24 * 60);
        };

        const calcExpiryMinutes = () => {
            if (expiryType === 'hours') {
                return finalHours * 60;
            }
            if (expiryType === 'date') {
                // Use gregorian date if available, else hijri
                if (expiryGregorian) {
                    return Math.max(1, Math.floor((new Date(expiryGregorian).getTime() - Date.now()) / 60000));
                }
                if (expiryDate) {
                    return parseHijriAndGetMinutes(expiryDate);
                }
            }
            return (finalDays ? finalDays * 24 * 60 : 525600);
        };

        const normOrig = Number(normalizeArabicNumerals(originalPrice.toString())) || 0;
        const normDisc = Number(normalizeArabicNumerals(discountedPrice.toString())) || 0;
        const discountPerc = normOrig > 0 ? Math.round((1 - normDisc / normOrig) * 100) : 0;

        const newDeal: Deal = {
            id: editingDealId || Date.now().toString(),
            storeId: user?.id || (existingDeal ? existingDeal.storeId : 'manual'),
            shopName,
            itemName,
            category: category as Category,
            gender,
            size,
            originalPrice: normOrig,
            discountedPrice: normDisc,
            discountPercentage: Math.max(0, Math.min(100, discountPerc)),
            images,
            description: validationService.sanitizeText(description, 1000),
            locationId: locationId === 'other' ? `custom_${Date.now()}` : locationId,
            googleMapsLink,
            mapLocation: { lat: finalLat, lng: finalLng },
            reliabilityScore: existingDeal ? existingDeal.reliabilityScore : 100,
            expiresInMinutes: calcExpiryMinutes(),
            expiryType,
            expiryDate: expiryType === 'date' ? (expiryGregorian || undefined) : undefined,
            quantity: finalQuantity,
            initialQuantity: finalQuantity,
            ratings: existingDeal ? existingDeal.ratings : [],
            createdAt: Date.now(), // Always refresh timestamp on publish/save to ensure fresh countdown
            status: forcePublish ? 'active' : (existingDeal?.status || 'active') as any
        };

            if (editingDealId) {
                await updateDeal(newDeal);
                if (!stayOnForm) {
                    setEditingDealId(null);
                }
            } else {
                await addDeal(newDeal);
            }
            
            setSubmitted(true);
            setTimeout(() => {
                setSubmitted(false);
                if (!stayOnForm) {
                    resetForm();
                    
                    const source = (window as any).editSource;
                    if (source === 'store') {
                        delete (window as any).editSource;
                        history.goBack();
                    } else {
                        setView('products');
                        if (editingDealId) setProductsTab(originTab); // Return to previous tab
                    }
                } else {
                    // If staying on form during edit, don't reset everything, just show success
                    if (!editingDealId) resetForm();
                }
            }, 1500);

        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        const confirmed = await customConfirm(isRTL ? 'هل تريد حذف هذا العرض نهائياً؟ لا يمكن التراجع عن هذه الخطوة.' : 'Are you sure you want to delete this deal permanently? This action cannot be undone.');
        if (confirmed) {
            try {
                await deleteDeal(id);
                customAlert(isRTL ? '🗑️ تم حذف العرض بنجاح' : '🗑️ Deal deleted successfully');
            } catch (err) {
                customAlert(isRTL ? '❌ فشل حذف العرض' : '❌ Failed to delete deal');
            }
        }
    };

    const myProducts = deals.filter(d => 
        (user?.id && d.storeId === user.id) || 
        (user?.shop && d.shopName === user.shop) ||
        (user?.name && d.shopName === user.name)
    );
    const myOrders = bookings.filter(b => myProducts.some(p => p.id === b.deal.id));
    const activeOrders = myOrders.filter(b => b.status === 'pending' || b.status === 'acknowledged');
    const pastOrders = myOrders.filter(b => b.status === 'completed' || b.status === 'cancelled');
    const [processedNotifIds, setProcessedNotifIds] = useState<Set<string>>(new Set());
    useEffect(() => {
        if (!loading && user) {
            const unreadBookingNotifs = notifications
                .filter(n => n.userId === user.id && !n.isRead && n.type === 'booking')
                .sort((a, b) => a.createdAt - b.createdAt);
            
            unreadBookingNotifs.forEach(n => {
                if (!processedNotifIds.has(n.id)) {
                    setProcessedNotifIds(prev => new Set(prev).add(n.id));
                    customAlert(`${isRTL ? n.title.ar : n.title.en}\n\n${isRTL ? n.body.ar : n.body.en}`);
                }
            });
        }
    }, [notifications, user, loading, processedNotifIds, isRTL, customAlert]);

    const myDeals = deals.filter(d => d.storeId === user?.id);
    
    // Check if a deal has timed out based on its creation date and lifespan
    const isTimedOut = (d: any) => {
        const lifespanMs = (d.expiresInMinutes || 120) * 60 * 1000;
        return Date.now() > (d.createdAt + lifespanMs);
    };

    // A deal is "sold out" only when the seller actually picked a stock cap
    const isSoldOut = (d: any) => d.quantity !== 'unlimited'
        && typeof d.quantity === 'number' && d.quantity <= 0
        && typeof d.initialQuantity === 'number' && d.initialQuantity > 0;

    // Filters must be strictly mutually exclusive to prevent "appearing in both"
    const activeDeals = myDeals.filter(d => 
        d.status === 'active' && !isSoldOut(d) && !isTimedOut(d)
    );
    
    const expiredDeals = myDeals.filter(d => 
        d.status === 'expired' || 
        d.status === 'paused' || 
        (d.status === 'active' && (isSoldOut(d) || isTimedOut(d)))
    );

    const inputGroupStyle: React.CSSProperties = {
        display: 'flex', gap: 16, marginBottom: 20
    };

    const labelStyle: React.CSSProperties = {
        fontSize: '0.85rem', fontWeight: 800, color: 'var(--gray-600)', display: 'block', marginBottom: 8
    };

    const fieldInputStyle: React.CSSProperties = {
        width: '100%', padding: '12px 14px', borderRadius: 12, border: '1px solid var(--gray-200)',
        fontSize: '0.9rem', outline: 'none', transition: 'all 0.2s ease', background: 'var(--body-bg)', fontWeight: 500
    };

    return (
        <div className="page-content" style={{ background: 'var(--body-bg)', paddingBottom: 80, direction: isRTL ? 'rtl' : 'ltr' }}>
            <div className="premium-bar" style={{ paddingBottom: 24, background: 'var(--header-gradient)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                    <div>
                        <h1 style={{ fontSize: '1.8rem', fontWeight: 900, color: 'white', margin: 0, textShadow: '0 2px 10px rgba(0,0,0,0.2)' }}>
                            {isRTL ? 'اضف خصوماتك هنا 📊' : 'Add your discounts here 📊'}
                        </h1>
                        <p style={{ fontSize: '0.8rem', color: 'rgba(150, 150, 165, 0.7)', fontWeight: 700, marginTop: 4 }}>
                            {user ? (isRTL ? `مرحباً بك، ${(user as any)?.shop || user?.name}` : `Welcome، ${(user as any)?.shop || user?.name}`) : ''}
                        </p>
                    </div>
                </div>

                <div style={{ display: 'flex', background: 'rgba(80, 80, 90, 0.2)', backdropFilter: 'blur(10px)', borderRadius: 16, padding: 6, overflowX: 'auto', gap: 4, scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
                    {(['form', 'products', 'orders', 'scanner', 'insights'] as const).map(tab => {
                        const unreadOrdersCount = notifications.filter(n => n.userId === user?.id && !n.isRead && n.type === 'booking').length;
                        const badgeCount = tab === 'orders' ? unreadOrdersCount : 0;

                        return (
                            <button key={tab} onClick={() => {
                                history.push(`/seller?tab=${tab}`);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                                if (tab === 'orders') {
                                    notifications.filter(n => n.userId === user?.id && !n.isRead && n.type === 'booking').forEach(n => markNotifRead(n.id));
                                }
                            }} style={{
                                flex: 1, minWidth: 85, padding: '12px 4px', borderRadius: 16, border: 'none',
                                background: view === tab ? 'var(--accent)' : 'rgba(255, 255, 255, 0.1)',
                                color: 'white',
                                fontWeight: 900, fontSize: '0.85rem', transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)', cursor: 'pointer',
                                display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center', position: 'relative',
                                boxShadow: view === tab ? '0 10px 20px rgba(0,0,0,0.2)' : 'none'
                            }}>
                                <span style={{ fontSize: '1rem' }}>
                                    {tab === 'form' ? (editingDealId ? '✏️' : '➕') :
                                     tab === 'products' ? '📦' :
                                     tab === 'orders' ? '🔔' :
                                     tab === 'scanner' ? '📷' :
                                     '📊'}
                                </span>
                                <span style={{ whiteSpace: 'nowrap' }}>
                                    {tab === 'form' ? (isRTL ? (editingDealId ? 'تعديل' : 'إضافة') : (editingDealId ? 'Edit' : 'Add')) : 
                                     tab === 'products' ? (isRTL ? 'عروضي' : 'Deals') :
                                     tab === 'orders' ? (isRTL ? 'الطلبات' : 'Orders') :
                                     tab === 'scanner' ? (isRTL ? 'سكانر' : 'Scanner') :
                                     (isRTL ? 'تحليلات' : 'Insights')}
                                </span>

                                {badgeCount > 0 && (
                                    <span style={{
                                        position: 'absolute', top: -5, right: -5,
                                        background: '#ef4444', color: 'white',
                                        width: 20, height: 20, borderRadius: '50%',
                                        fontSize: '0.7rem', fontWeight: 900,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        border: '2px solid white', boxShadow: '0 2px 8px rgba(239, 68, 68, 0.3)'
                                    }}>
                                        {badgeCount > 99 ? '99+' : badgeCount}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {loading && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--body-bg)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.95 }}>
                    <div className="spinner" style={{ width: 40, height: 40, border: '4px solid var(--gray-200)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    <p style={{ marginTop: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{isRTL ? 'جاري التحميل...' : 'Loading...'}</p>
                </div>
            )}

            <div style={{ padding: 16 }}>
                {view === 'form' && (!isPaymentEnabled || isSubscriptionValid) ? (
                    <form onSubmit={(e) => { e.preventDefault(); submitAction(false); }} style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 24, padding: '24px 20px', boxShadow: 'var(--shadow-lg)' }}>
                        {submitted && <div style={{ background: 'var(--gray-100)', color: 'var(--primary)', padding: '12px', borderRadius: 16, marginBottom: 20, textAlign: 'center', fontWeight: 700 }}>✅ {isRTL ? 'تم الحفظ بنجاح' : 'Saved Successfully'}</div>}
                        
                        {editingDealId && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--gray-100)' }}>
                                <div style={{ fontWeight: 900, color: 'var(--primary)', fontSize: '1.1rem' }}>{isRTL ? 'تعديل العرض الحالي' : 'Editing Current Deal'}</div>
                                <button type="button" onClick={resetForm} style={{ background: 'var(--gray-100)', color: 'var(--gray-600)', border: 'none', padding: '6px 12px', borderRadius: 12, fontWeight: 800, fontSize: '0.8rem' }}>
                                    {isRTL ? 'إلغاء التعديل' : 'Cancel Edit'}
                                </button>
                            </div>
                        )}

                        <div style={inputGroupStyle}>
                            <div style={{ flex: 1 }}>
                                <label style={labelStyle}>{isRTL ? 'اسم المنتج' : 'Item Name'}</label>
                                <input style={fieldInputStyle} value={itemName} onChange={e => setItemName(e.target.value)} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={labelStyle}>{isRTL ? 'اسم المحل' : 'Shop Name'}</label>
                                <input style={fieldInputStyle} value={shopName} onChange={e => setShopName(e.target.value)} />
                            </div>
                        </div>

                        <div style={inputGroupStyle}>
                            <div style={{ flex: 1 }}>
                                <label style={labelStyle}>{isRTL ? 'التصنيف' : 'Category'}</label>
                                <select style={fieldInputStyle} value={category} onChange={e => setCategory(e.target.value as Category)}>
                                    <option value="">{isRTL ? 'اختر..' : 'Select..'}</option>
                                    {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.emoji} {isRTL ? c.ar : c.en}</option>)}
                                </select>
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={labelStyle}>{isRTL ? 'المقاس (اختياري)' : 'Size (Optional)'}</label>
                                <input style={fieldInputStyle} value={size} onChange={e => setSize(e.target.value)} placeholder="S, M, 42..." />
                            </div>
                        </div>

                        <div style={inputGroupStyle}>
                            <div style={{ flex: 1 }}>
                                <label style={labelStyle}>{isRTL ? 'الفئة المستهدفة' : 'Target'}</label>
                                <select style={fieldInputStyle} value={gender} onChange={e => setGender(e.target.value as GenderTarget)}>
                                    {GENDERS.map(g => <option key={g.id} value={g.id}>{isRTL ? g.ar : g.en}</option>)}
                                </select>
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={labelStyle}>
                                    {isRTL ? 'الكمية' : 'Quantity'}
                                    <label style={{ 
                                        display: 'inline-flex', 
                                        alignItems: 'center', 
                                        gap: 4, 
                                        float: isRTL ? 'left' : 'right', 
                                        color: '#38bdf8', // Brighter color for visibility in Dark Mode
                                        cursor: 'pointer',
                                        fontSize: '0.75rem'
                                    }}>
                                        <input type="checkbox" checked={isUnlimited} onChange={e => {
                                            setIsUnlimited(e.target.checked);
                                            // 'stock' is the only mode incompatible with unlimited —
                                            // hours / days / date all make sense. Only swap away
                                            // from 'stock' so we don't trample the seller's choice.
                                            if (e.target.checked && expiryType === 'stock') {
                                                setExpiryType('hours');
                                            }
                                        }} />
                                        {isRTL ? 'لامحدود' : 'Unlim'}
                                    </label>
                                </label>
                                <input type="tel" style={{...fieldInputStyle, opacity: isUnlimited ? 0.5 : 1}} value={isUnlimited ? '' : quantity} disabled={isUnlimited} placeholder={isRTL ? 'مثال: 50' : 'e.g. 50'} onChange={e => {
                                    const val = normalizeArabicNumerals(e.target.value).replace(/\D/g, '');
                                    setQuantity(val === '' ? '' : Number(val));
                                    if (!isUnlimited && val) setExpiryType('stock');
                                }} />
                            </div>
                        </div>

                        <div style={inputGroupStyle}>
                            <div style={{ flex: 1 }}>
                                <label style={labelStyle}>{isRTL ? 'السعر الأصلي' : 'Original Price'}</label>
                                <input type="tel" style={fieldInputStyle} placeholder={isRTL ? 'مثال: 120' : 'e.g. 120'} value={originalPrice} onChange={e => setOriginalPrice(normalizeArabicNumerals(e.target.value).replace(/\D/g, ''))} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={labelStyle}>{isRTL ? 'السعر بعد الخصم' : 'Final Price'}</label>
                                <input type="tel" style={fieldInputStyle} placeholder={isRTL ? 'مثال: 80' : 'e.g. 80'} value={discountedPrice} onChange={e => setDiscountedPrice(normalizeArabicNumerals(e.target.value).replace(/\D/g, ''))} />
                            </div>
                        </div>

                        <div style={{ marginBottom: 20 }}>
                            <label style={labelStyle}>{isRTL ? 'نظام انتهاء العرض' : 'Offer Expiry System'}</label>
                            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                                <button type="button" onClick={() => setExpiryType('hours')} style={{ flex: 1, padding: '10px', borderRadius: 12, border: '1.5px solid', borderColor: expiryType === 'hours' ? 'var(--primary)' : 'var(--gray-200)', background: expiryType === 'hours' ? 'var(--primary)' : 'transparent', color: expiryType === 'hours' ? 'white' : 'var(--text-primary)', fontWeight: 800, fontSize: '0.75rem' }}>
                                    {isRTL ? 'بالساعات' : 'By Hours'}
                                </button>
                                <button type="button" onClick={() => setExpiryType('duration')} style={{ flex: 1, padding: '10px', borderRadius: 12, border: '1.5px solid', borderColor: expiryType === 'duration' ? 'var(--primary)' : 'var(--gray-200)', background: expiryType === 'duration' ? 'var(--primary)' : 'transparent', color: expiryType === 'duration' ? 'white' : 'var(--text-primary)', fontWeight: 800, fontSize: '0.75rem' }}>
                                    {isRTL ? 'بالأيام' : 'By Days'}
                                </button>
                                <button type="button" onClick={() => setExpiryType('date')} style={{ flex: 1, padding: '10px', borderRadius: 12, border: '1.5px solid', borderColor: expiryType === 'date' ? 'var(--primary)' : 'var(--gray-200)', background: expiryType === 'date' ? 'var(--primary)' : 'transparent', color: expiryType === 'date' ? 'white' : 'var(--text-primary)', fontWeight: 800, fontSize: '0.75rem' }}>
                                    {isRTL ? 'بالتاريخ' : 'By Date'}
                                </button>
                                <button type="button" disabled={isUnlimited} onClick={() => setExpiryType('stock')} style={{ flex: 1, padding: '10px', borderRadius: 12, border: '1.5px solid', borderColor: expiryType === 'stock' ? 'var(--primary)' : 'var(--gray-200)', background: expiryType === 'stock' ? 'var(--primary)' : 'transparent', color: expiryType === 'stock' ? 'white' : 'var(--text-primary)', fontWeight: 800, fontSize: '0.75rem', opacity: isUnlimited ? 0.3 : 1 }}>
                                    {isRTL ? 'بالكمية' : 'By Stock'}
                                </button>
                            </div>

                            {expiryType === 'hours' && (
                                <div style={{ flex: 1 }}>
                                    <label style={labelStyle}>{isRTL ? 'مدة الصلاحية (بالساعات)' : 'Validity (Hours)'}</label>
                                    <input type="tel" style={fieldInputStyle} value={expiryHours} onChange={e => setExpiryHours(normalizeArabicNumerals(e.target.value).replace(/\D/g, ''))} placeholder={isRTL ? 'مثال: 2 ساعة' : 'e.g. 2 hours'} />
                                </div>
                            )}

                            {expiryType === 'duration' && (
                                <div style={{ flex: 1 }}>
                                    <label style={labelStyle}>{isRTL ? 'مدة الصلاحية (بالأيام)' : 'Validity (Days)'} {isUnlimited && <span style={{color:'var(--danger)'}}>*</span>}</label>
                                    <input type="tel" style={fieldInputStyle} value={days} onChange={e => setDays(normalizeArabicNumerals(e.target.value).replace(/\D/g, ''))} placeholder={isRTL ? 'مثال: 30 يوم' : 'e.g. 30 days'} />
                                </div>
                            )}

                            {expiryType === 'date' && (
                                <div>
                                    <label style={labelStyle}>{isRTL ? 'تاريخ الانتهاء (هجري + ميلادي)' : 'Expiry Date (Hijri + Gregorian)'}</label>
                                    {/* Dual Calendar Trigger Button */}
                                    <button
                                        type="button"
                                        onClick={() => setShowDualPicker(true)}
                                        style={{
                                            ...fieldInputStyle,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            cursor: 'pointer',
                                            textAlign: isRTL ? 'right' : 'left',
                                            border: (expiryGregorian || expiryDate)
                                                ? '1.5px solid var(--primary)'
                                                : '1px solid var(--gray-200)',
                                            background: (expiryGregorian || expiryDate)
                                                ? 'var(--notif-unread-bg)'
                                                : 'var(--gray-50)',
                                        }}
                                    >
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                            {(expiryGregorian || expiryDate) ? (
                                                <>
                                                    <span style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                                                        {expiryHijriDisplay
                                                            ? (() => {
                                                                const [y, m, d] = expiryHijriDisplay.split('-').map(Number);
                                                                const mName = isRTL
                                                                    ? ['محرم','صفر','ربيع الأول','ربيع الآخر','جمادى الأولى','جمادى الآخرة','رجب','شعبان','رمضان','شوال','ذو القعدة','ذو الحجة'][m-1]
                                                                    : ['Muharram','Safar','Rabi\' al-Awwal','Rabi\' al-Thani','Jumada al-Ula','Jumada al-Akhirah','Rajab','Sha\'ban','Ramadan','Shawwal','Dhu al-Qi\'dah','Dhu al-Hijjah'][m-1];
                                                                return `${d} ${mName} ${y}هـ`;
                                                              })()
                                                            : expiryDate}
                                                    </span>
                                                    {expiryGregorian && (
                                                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                                            {new Date(expiryGregorian).toLocaleDateString(isRTL ? 'ar-SA' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })}
                                                        </span>
                                                    )}
                                                </>
                                            ) : (
                                                <span style={{ color: 'var(--gray-400)', fontWeight: 600, fontSize: '0.88rem' }}>
                                                    {isRTL ? 'اضغط لاختيار التاريخ...' : 'Tap to select date...'}
                                                </span>
                                            )}
                                        </div>
                                        <span style={{ fontSize: '1.3rem' }}>📅</span>
                                    </button>
                                </div>
                            )}
                        </div>

                        {discount > 0 && <div style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#b91c1c', padding: '10px', borderRadius: 12, textAlign: 'center', fontWeight: 900, marginBottom: 20 }}>{isRTL ? `خصم ${discount}% 🔥` : `Discount ${discount}% 🔥`}</div>}

                        <div style={{ marginBottom: 15 }}>
                            <label style={labelStyle}>{isRTL ? 'صور المنتج (حتى 4 صور)' : 'Item Photos (Up to 4)'}</label>
                            
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                                {images.map((img, idx) => (
                                    <div key={idx} style={{ position: 'relative', height: 130, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--gray-200)' }}>
                                        <img src={img} loading="lazy" alt="Upload" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        <button
                                            type="button"
                                            aria-label={isRTL ? 'حذف الصورة' : 'Remove image'}
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setImages(prev => prev.filter((_, i) => i !== idx));
                                            }}
                                            style={{
                                                position: 'absolute', top: 6,
                                                [isRTL ? 'left' : 'right']: 6,
                                                background: 'rgba(220, 38, 38, 0.95)', color: 'white',
                                                border: '2px solid white', borderRadius: '50%',
                                                width: 32, height: 32, fontSize: '0.95rem', fontWeight: 900,
                                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                boxShadow: '0 2px 6px rgba(0,0,0,0.25)', zIndex: 2,
                                                lineHeight: 1, padding: 0
                                            } as React.CSSProperties}
                                        >✕</button>
                                        {idx === 0 && (
                                            <span style={{
                                                position: 'absolute', bottom: 6,
                                                [isRTL ? 'right' : 'left']: 6,
                                                background: 'var(--accent)', color: 'white',
                                                fontSize: '0.65rem', fontWeight: 900, padding: '3px 8px', borderRadius: 8
                                            } as React.CSSProperties}>{isRTL ? 'الرئيسية' : 'Main'}</span>
                                        )}
                                    </div>
                                ))}
                                {images.length < 4 && (
                                    <label
                                        htmlFor="seller-image-upload"
                                        style={{
                                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                            height: 130, borderRadius: 12, border: '2px dashed var(--primary)',
                                            cursor: uploadingImages ? 'default' : 'pointer', background: 'var(--notif-unread-bg)', color: 'var(--primary)',
                                            transition: 'background 0.2s ease', WebkitTapHighlightColor: 'transparent',
                                            opacity: uploadingImages ? 0.6 : 1, pointerEvents: uploadingImages ? 'none' : 'auto'
                                        }}
                                    >
                                        <input
                                            id="seller-image-upload"
                                            ref={fileInputRef}
                                            type="file"
                                            multiple
                                            accept="image/*"
                                            onChange={handleImageUpload}
                                            onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
                                            style={{ display: 'none' }}
                                        />
                                        {uploadingImages ? (
                                            <div className="spinner" style={{ width: 24, height: 24, border: '3px solid var(--gray-200)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                                        ) : (
                                            <>
                                                <span style={{ fontSize: '1.5rem', marginBottom: 4 }}>📸</span>
                                                <span style={{ fontSize: '0.75rem', fontWeight: 800 }}>{isRTL ? 'إضافة صورة' : 'Add Image'}</span>
                                            </>
                                        )}
                                    </label>
                                )}
                            </div>
                        </div>

                        <div style={{ marginBottom: 15 }}>
                            <label style={labelStyle}>{isRTL ? 'شرح تفصيلي للمنتج' : 'Description'}</label>
                            <textarea style={{ ...fieldInputStyle, minHeight: 120 }} value={description}
                                onChange={e => setDescription(e.target.value)}
                                placeholder={isRTL ? 'اكتب تفاصيل منتجك هنا بحرية...' : 'Write your product details here...'} />
                            <div style={{ fontSize: '0.7rem', textAlign: 'left', opacity: 0.6, marginTop: 4 }}>{description.split(/\s+/).filter(w => w.length > 0).length} {isRTL ? 'كلمة' : 'words'}</div>
                        </div>

                        <div style={{ marginBottom: 15 }}>
                            <label style={labelStyle}>{isRTL ? 'الموقع والمكان' : 'Location & Venue'}</label>
                            
                            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                                <select style={{ ...fieldInputStyle, flex: 1 }} value={selectedRegion} onChange={e => { setSelectedRegion(e.target.value); setSelectedCity(''); }}>
                                    <option value="">{isRTL ? 'اختر المنطقة' : 'Region'}</option>
                                    {REGIONS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                </select>
                                <select style={{ ...fieldInputStyle, flex: 1 }} value={selectedCity} onChange={e => {
                                    const val = e.target.value;
                                    setSelectedCity(val);
                                    if (val !== 'other') {
                                        const city = CITIES.find(c => c.id === val);
                                        if (city) setMapPos([city.lat, city.lng]);
                                    }
                                }}>
                                    <option value="">{isRTL ? 'اختر المدينة' : 'City'}</option>
                                    {CITIES.filter(c => !selectedRegion || c.regionId === selectedRegion).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    <option value="other">{isRTL ? 'أخرى' : 'Other'}</option>
                                </select>
                            </div>

                            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                                <select style={{ ...fieldInputStyle, flex: 1 }} value={locationType} onChange={e => { setLocationType(e.target.value as any); setLocationId(''); }}>
                                    <option value="mall">{isRTL ? 'مول 🛍️' : 'Mall 🛍️'}</option>
                                    <option value="market">{isRTL ? 'سوق 🏛️' : 'Market 🏛️'}</option>
                                    <option value="store">{isRTL ? 'محل 🏪' : 'Store 🏪'}</option>
                                    <option value="other">{isRTL ? 'أخرى 📍' : 'Other 📍'}</option>
                                </select>
                                <select style={{ ...fieldInputStyle, flex: 2 }} value={locationId} onChange={e => {
                                    const val = e.target.value;
                                    setLocationId(val);
                                    if(val !== 'other') {
                                        const loc = LOCATIONS.find(l => l.id === val);
                                        if (loc) setMapPos([loc.lat, loc.lng]);
                                    }
                                }}>
                                    <option value="">{isRTL ? 'اختر المكان...' : 'Select Location...'}</option>
                                    {LOCATIONS.filter(l => l.cityId === selectedCity && l.type === locationType).map(l => (
                                        <option key={l.id} value={l.id}>{l.name}</option>
                                    ))}
                                    <option value="other">{isRTL ? 'أخرى (منطقة مخصصة)' : 'Other'}</option>
                                </select>
                            </div>
                            
                            {locationId === 'other' && (
                                <input style={{ ...fieldInputStyle, marginBottom: 8 }} placeholder={isRTL ? 'اسم الموقع المخصص' : 'Custom Location Name'} value={customLocationName} onChange={e => setCustomLocationName(e.target.value)} />
                            )}
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 700, marginBottom: 6 }}>
                                {isRTL
                                    ? '💡 يمكنك لصق رابط قوقل ماب (مختصر أو طويل) أو الإحداثيات مباشرة بصيغة: 24.7136, 46.6753'
                                    : '💡 Paste a Google Maps link (short or long) — or coordinates as: 24.7136, 46.6753'}
                            </div>
                            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                                <input
                                    style={{ ...fieldInputStyle, flex: 1 }}
                                    placeholder={isRTL ? 'رابط قوقل ماب أو إحداثيات' : 'Google Maps link or coordinates'}
                                    value={googleMapsLink}
                                    onChange={e => setGoogleMapsLink(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            handleMapLinkUpdate(true);
                                        }
                                    }}
                                />
                                <button
                                    type="button"
                                    disabled={resolvingLink}
                                    onClick={() => handleMapLinkUpdate(true)}
                                    style={{
                                        padding: '0 16px',
                                        borderRadius: 12,
                                        background: resolvingLink ? 'var(--gray-300)' : 'var(--primary)',
                                        color: 'white',
                                        border: 'none',
                                        fontWeight: 800,
                                        fontSize: '0.85rem',
                                        cursor: resolvingLink ? 'default' : 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        boxShadow: 'var(--shadow-sm)'
                                    }}
                                >
                                    {resolvingLink ? (
                                        <div className="spinner" style={{ width: 16, height: 16, border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                                    ) : '📍'}
                                    {isRTL ? (resolvingLink ? 'جاري..' : 'تحديد') : (resolvingLink ? 'Wait..' : 'Set')}
                                </button>
                            </div>
                            <div style={{
                                fontSize: '0.7rem',
                                color: 'var(--text-secondary)',
                                background: 'var(--notif-unread-bg)',
                                padding: '8px 12px',
                                borderRadius: 10,
                                marginBottom: 8,
                                lineHeight: 1.5
                            }}>
                                💡 {isRTL
                                    ? 'إذا لم يتعرّف على رابط قوقل ماب، اضغط على الخريطة مباشرة لتثبيت الدبوس على موقع متجرك (يمكنك سحبه أيضاً).'
                                    : "If the Google Maps link doesn't resolve, tap the map directly to drop a pin (you can drag it too)."}
                            </div>
                            <div style={{ height: 200, borderRadius: 16, overflow: 'hidden', border: '1.5px solid var(--gray-200)' }}>
                                <MapContainer center={mapPos} zoom={13} style={{ height: '100%', width: '100%' }}>
                                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                                    <MapCenterUpdater center={mapPos} />
                                    <LocationMarker position={mapPos} autoUpdate={autoUpdateLocation} />
                                </MapContainer>
                            </div>
                            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                                <button
                                    type="button"
                                    onClick={handleLocateMe}
                                    style={{
                                        flex: 1,
                                        padding: '12px',
                                        borderRadius: 12,
                                        background: 'var(--primary)',
                                        color: 'white',
                                        fontWeight: 800,
                                        border: 'none',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: 8,
                                        boxShadow: '0 4px 12px rgba(2, 132, 199, 0.2)',
                                        cursor: 'pointer'
                                    }}
                                >
                                    📍 {isRTL ? 'تحديد موقعي' : 'Locate Me'}
                                </button>
                                <button
                                    type="button"
                                    onClick={saveShopLocation}
                                    style={{
                                        flex: 1.5,
                                        padding: '12px',
                                        borderRadius: 12,
                                        background: 'var(--primary)',
                                        color: '#ffffff',
                                        fontWeight: 900,
                                        border: '2px solid var(--primary)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: 8,
                                        cursor: 'pointer'
                                    }}
                                >
                                    ⭐ {isRTL ? 'حفظ كموقع دائم للمتجر' : 'Set Permanent Shop Loc'}
                                </button>
                            </div>
                            <div style={{ marginTop: 8, fontSize: '0.75rem', color: 'var(--gray-400)', textAlign: 'center', fontWeight: 600 }}>
                                {isRTL ? 'سيتم تحديث المنطقة والمدينة ونوع الموقع تلقائياً' : 'Region, City, and Venue Type will update automatically'}
                            </div>
                        </div>


                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 20 }}>
                                <div style={{ display: 'flex', gap: 10 }}>
                                    <button 
                                        type="button"
                                        onClick={() => submitAction(false, true)}
                                        disabled={isSaving || resolvingLink}
                                        style={{
                                            flex: 2, padding: '16px', borderRadius: 16,
                                            background: isSaving ? 'var(--gray-300)' : 'linear-gradient(135deg, var(--primary), var(--primary-dark))',
                                            color: 'white', fontWeight: 900, border: 'none', fontSize: '1rem',
                                            boxShadow: isSaving ? 'none' : '0 6px 20px var(--primary-glow)', 
                                            cursor: isSaving ? 'default' : 'pointer',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10
                                        }}
                                    >
                                        {isSaving ? (
                                            <div className="spinner" style={{ width: 20, height: 20, border: '3px solid white', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                                        ) : (
                                            isRTL ? (editingDealId ? 'حفظ التعديلات والنشر' : 'حفظ وإضافة العرض') : (editingDealId ? 'Save & Publish' : 'Save & Add Deal')
                                        )}
                                    </button>
                                    
                                    {editingDealId && (
                                        <button type="button" onClick={() => submitAction(false, false)} style={{
                                            flex: 1, padding: '16px', borderRadius: 16, border: '1.5px solid var(--border-color)',
                                            background: 'var(--card-bg)', color: 'var(--text-primary)', fontWeight: 800, fontSize: '0.85rem', cursor: 'pointer'
                                        }}>
                                            💾 {isRTL ? 'حفظ التعديل فقط' : 'Save Only'}
                                        </button>
                                    )}
                                </div>

                                {editingDealId && (
                                    <button 
                                        type="button" 
                                        onClick={() => {
                                            resetForm();
                                            const source = (window as any).editSource;
                                            if (source === 'store') {
                                                delete (window as any).editSource;
                                                history.goBack();
                                            } else {
                                                setView('products');
                                                setProductsTab(originTab);
                                            }
                                            setEditingDealId(null);
                                        }} 
                                        style={{ width: '100%', padding: '14px', borderRadius: 16, border: 'none', background: 'var(--body-bg)', color: 'var(--text-secondary)', fontWeight: 800, fontSize: '0.9rem', cursor: 'pointer' }}
                                    >
                                        ❌ {isRTL ? 'إلغاء التعديل والعودة' : 'Cancel & Go Back'}
                                    </button>
                                )}

                                {!editingDealId && (
                                    <button type="button" onClick={() => submitAction(true)} style={{
                                        flex: 1, padding: '16px', borderRadius: 16, border: '1.5px solid var(--border-color)',
                                        background: 'var(--card-bg)', color: 'var(--text-primary)', fontWeight: 800, fontSize: '0.85rem', cursor: 'pointer'
                                    }}>
                                        {isRTL ? 'إضافة وتكرار' : 'Add Another'}
                                    </button>
                                )}
                            </div>
                    </form>
                ) : view === 'products' ? (
                    <div>
                        {/* Tabs for Active/Expired */}
                        <div style={{ display: 'flex', gap: 10, marginBottom: 20, background: 'var(--card-bg)', padding: 6, borderRadius: 16, border: '1px solid var(--border-color)' }}>
                            <button 
                                onClick={() => setProductsTab('active')}
                                style={{ flex: 1, padding: '12px', borderRadius: 12, border: 'none', background: productsTab === 'active' ? 'var(--dark)' : 'transparent', color: productsTab === 'active' ? 'white' : 'var(--text-secondary)', fontWeight: 800, fontSize: '0.9rem', transition: 'all 0.2s', cursor: 'pointer' }}
                            >
                                {isRTL ? 'عروض نشطة' : 'Active'} ({activeDeals.length})
                            </button>
                            <button 
                                onClick={() => setProductsTab('expired')}
                                style={{ flex: 1, padding: '12px', borderRadius: 12, border: 'none', background: productsTab === 'expired' ? 'var(--dark)' : 'transparent', color: productsTab === 'expired' ? 'white' : 'var(--text-secondary)', fontWeight: 800, fontSize: '0.9rem', transition: 'all 0.2s', cursor: 'pointer' }}
                            >
                                {isRTL ? 'عروض سابقة' : 'Past'} ({expiredDeals.length})
                            </button>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                            {(productsTab === 'active' ? activeDeals : expiredDeals).map(deal => {
                                const isActiveDeal = activeDeals.some(d => d.id === deal.id);
                                const isOutOfStock = deal.quantity !== 'unlimited' && typeof deal.quantity === 'number' && deal.quantity <= 0;
                                return (
                                <div key={deal.id} className="animate-fade-in" style={{ background: 'var(--card-bg)', backdropFilter: 'blur(10px)', borderRadius: 24, overflow: 'hidden', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow)', transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)', opacity: !isActiveDeal ? 0.7 : 1 }}>
                                    <img
                                        loading="lazy"
                                        decoding="async"
                                        width={400}
                                        height={180}
                                        src={deal.images[0]}
                                        alt={deal.itemName}
                                        style={{ width: '100%', height: 180, objectFit: 'cover', filter: !isActiveDeal ? 'grayscale(50%)' : 'none' }}
                                        onError={(e: React.SyntheticEvent<HTMLImageElement, Event>) => { (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1543332164-6e82f355badc?w=400'; }}
                                    />
                                    <div style={{ padding: 16 }}>
                                        <div style={{ fontSize: '0.95rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                            <span>{deal.itemName}</span>
                                            {isOutOfStock && <span style={{ fontSize: '0.65rem', background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', padding: '2px 6px', borderRadius: 8, fontWeight: 900, whiteSpace: 'nowrap' }}>{isRTL ? 'نفدت الكمية 🚫' : 'Out of stock 🚫'}</span>}
                                            {!isOutOfStock && !isActiveDeal && <span style={{ fontSize: '0.65rem', background: 'var(--body-bg)', color: 'var(--text-secondary)', padding: '2px 6px', borderRadius: 8, fontWeight: 900, whiteSpace: 'nowrap' }}>{isRTL ? 'منتهي ⏳' : 'Expired ⏳'}</span>}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{isRTL ? 'الكمية:' : 'Qty:'} <span style={{ color: 'var(--text-primary)', fontWeight: 800 }}>{deal.quantity}</span></div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                                            <div style={{ color: 'var(--text-primary)', fontWeight: 900, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                {deal.discountedPrice} <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{isRTL ? 'ر.س' : 'SAR'}</span>
                                            </div>
                                            <div style={{ display: 'flex', gap: 8 }}>
                                                {isActiveDeal ? (
                                                    <>
                                                        <button onClick={() => handleEdit(deal)} style={{ flex: 1, background: 'var(--body-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 12, padding: '8px', fontWeight: 800, cursor: 'pointer', transition: 'all 0.2s ease' }}>
                                                            ✏️ {isRTL ? 'تعديل' : 'Edit'}
                                                        </button>
                                                        <button onClick={() => togglePauseDeal(deal.id)} style={{ flex: 1, background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: 12, padding: '8px', fontWeight: 800, cursor: 'pointer', transition: 'all 0.2s ease' }}>
                                                            ⏸️ {isRTL ? 'إيقاف' : 'Pause'}
                                                        </button>
                                                        <button onClick={() => handleDelete(deal.id)} style={{ flex: 1, background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 12, padding: '8px', fontWeight: 800, cursor: 'pointer', transition: 'all 0.2s ease' }}>
                                                            🗑️ {isRTL ? 'حذف' : 'Delete'}
                                                        </button>
                                                    </>
                                                ) : (
                                                     <div style={{ display: 'flex', gap: 6, width: '100%' }}>
                                                         <button onClick={(e) => { 
                                                             e.stopPropagation(); 
                                                             if (deal.status === 'paused') togglePauseDeal(deal.id);
                                                             else reActivateDeal(deal.id); 
                                                         }} title={deal.status === 'paused' ? (isRTL ? 'استئناف العرض' : 'Resume Deal') : (isRTL ? 'تجديد العرض' : 'Renew Deal')} style={{
                                                            flex: 1.4, background: deal.status === 'paused' ? 'var(--primary)' : 'linear-gradient(135deg, #0284c7, #0369a1)', color: 'white',
                                                             border: 'none', borderRadius: 12, padding: '10px 4px', fontWeight: 900,
                                                             cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)', fontSize: '0.78rem',
                                                             boxShadow: deal.status === 'paused' ? '0 4px 12px var(--primary-glow)' : '0 4px 12px rgba(2, 132, 199, 0.25)',
                                                             display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                                                             whiteSpace: 'nowrap'
                                                         }}>
                                                             {deal.status === 'paused' ? (isRTL ? '▶️ استئناف' : '▶️ Resume') : (isRTL ? '🔄 تجديد' : '🔄 Renew')}
                                                         </button>
                                                         <button onClick={(e) => { e.stopPropagation(); handleEdit(deal); }} title={isRTL ? 'تعديل العرض' : 'Edit Deal'} style={{
                                                             flex: 1, background: 'var(--body-bg)', color: 'var(--text-primary)',
                                                             border: '1px solid var(--border-color)', borderRadius: 12, padding: '10px 4px',
                                                             fontWeight: 800, cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)', fontSize: '0.78rem',
                                                             display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                                                             whiteSpace: 'nowrap'
                                                         }}>
                                                             ✏️ {isRTL ? 'تعديل' : 'Edit'}
                                                         </button>
                                                         <button onClick={(e) => { e.stopPropagation(); handleDelete(deal.id); }} title={isRTL ? 'حذف العرض' : 'Delete Deal'} style={{
                                                             flex: 1, background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444',
                                                             border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 12, padding: '10px 4px',
                                                             fontWeight: 800, cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)', fontSize: '0.78rem',
                                                             display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                                                             whiteSpace: 'nowrap'
                                                         }}>
                                                             🗑️ {isRTL ? 'حذف' : 'Delete'}
                                                         </button>
                                                     </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )})}
                        </div>
                    </div>
                ) : view === 'orders' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {activeOrders.length > 0 ? activeOrders.map(order => (
                            <div key={order.barcode} className="animate-fade-in" style={{ background: 'var(--card-bg)', backdropFilter: 'blur(10px)', borderRadius: 24, padding: 20, border: '1px solid var(--border-color)', boxShadow: 'var(--shadow)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                                    <div style={{ fontWeight: 900, fontSize: '1.05rem', color: 'var(--text-primary)' }}>{order.deal.itemName}</div>
                                    <div style={{ color: 'var(--primary)', fontWeight: 900, background: 'var(--gray-100)', padding: '4px 12px', borderRadius: 20 }}>{order.bookedQuantity} {isRTL ? 'قطع' : 'pcs'}</div>
                                </div>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 600 }}>
                                    {isRTL ? '👤 المشتري:' : '👤 Buyer:'}{' '}
                                    <span style={{ color: 'var(--text-primary)', fontWeight: 800 }}>
                                        {(order as any).userName || (order.userId ? order.userId.substring(0, 8) + '…' : '—')}
                                    </span>
                                    {(order as any).userPhone && (
                                        <a href={`tel:${(order as any).userPhone}`} style={{ marginInlineStart: 10, color: '#0284c7', fontWeight: 800, textDecoration: 'none' }}>
                                            📞 {(order as any).userPhone}
                                        </a>
                                    )}
                                </div>
                                {order.prepTime && (
                                    <div style={{ marginBottom: 12, padding: '8px 14px', background: '#e0f2fe', borderRadius: 12, display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 800, color: '#0369a1', fontSize: '0.85rem' }}>
                                        🕒 {isRTL ? 'وقت التجهيز / الوصول:' : 'Prep / ETA:'}{' '}
                                        {order.prepTime === 'arrival'
                                            ? (isRTL ? 'عند الوصول' : 'On Arrival')
                                            : `${order.prepTime} ${isRTL ? 'دقيقة' : 'min'}`}
                                    </div>
                                )}
                                {order.notes && (
                                    <div style={{ marginBottom: 16, padding: '12px 16px', background: 'rgba(245, 158, 11, 0.2)', borderRadius: 12, borderRight: isRTL ? '4px solid #f59e0b' : 'none', borderLeft: !isRTL ? '4px solid #f59e0b' : 'none' }}>
                                        <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#d97706', marginBottom: 4 }}>
                                            {isRTL ? 'ملاحظات المشتري:' : 'Buyer Notes:'}
                                        </div>
                                        <div style={{ fontSize: '1rem', fontWeight: 900, color: 'var(--secondary)', lineHeight: 1.5 }}>
                                            {order.notes}
                                        </div>
                                    </div>
                                )}
                                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                    {order.status === 'pending' && (
                                        <button onClick={async () => {
                                            const note = await customPrompt(isRTL ? 'اكتب ملاحظة للمشتري (اختياري):' : 'Write a note to the buyer (optional):');
                                            acknowledgeBooking(order.barcode, note || undefined);
                                        }}
                                            style={{ width: '100%', padding: '12px', borderRadius: 16, background: 'var(--dark)', color: 'white', fontWeight: 800, border: 'none', cursor: 'pointer', marginBottom: 8 }}>
                                            {isRTL ? 'تأكيد استلام الطلب 📦' : 'Confirm Receipt of Order 📦'}
                                        </button>
                                    )}
                                    {order.status === 'acknowledged' && (
                                        <div style={{ width: '100%', padding: '10px', borderRadius: 12, background: 'var(--gray-100)', color: 'var(--primary)', fontWeight: 800, textAlign: 'center', marginBottom: 8, fontSize: '0.85rem' }}>
                                            ✅ {isRTL ? 'تم تأكيد الاستلام - بانتظار الكود' : 'Receipt Confirmed - Awaiting Code'}
                                        </div>
                                    )}
                                    <button onClick={() => setScannerOpen(true)} style={{ flex: 1, padding: '12px', borderRadius: 16, background: 'var(--body-bg)', border: '1px solid var(--border-color)', fontWeight: 800, color: 'var(--text-primary)', transition: 'all 0.2s', cursor: 'pointer' }}>
                                        {isRTL ? '📷 مسح الكود' : '📷 Scan'}
                                    </button>
                                    <div style={{ display: 'flex', flex: 2, gap: 8 }}>
                                        <input
                                            placeholder={isRTL ? "الرمز المرجعي.." : "Enter code.."}
                                            style={{...fieldInputStyle, padding: '12px', flex: 1, minWidth: 100, marginBottom: 0}}
                                            value={manualCodes[order.barcode] || ''}
                                            onChange={e => setManualCodes({...manualCodes, [order.barcode]: e.target.value})}
                                            onKeyDown={async e => {
                                                if (e.key === 'Enter') {
                                                    const enteredCode = normalizeArabicNumerals(manualCodes[order.barcode]?.trim().toUpperCase() || '');
                                                    const targetBarcode = order.barcode?.trim().toUpperCase();
                                                    const targetBackup = order.backupCode?.trim().toUpperCase();
                                                    if ((enteredCode === targetBarcode || enteredCode === targetBackup) && enteredCode) {
                                                        if (await customConfirm(isRTL ? 'هل تم استلام المنتج؟' : 'Product received?')) {
                                                            completeBooking(order.barcode);
                                                            setManualCodes(prev => { const n = { ...prev }; delete n[order.barcode]; return n; });
                                                        }
                                                    } else {
                                                        await customAlert(isRTL ? 'رمز غير صحيح!' : 'Invalid code!');
                                                    }
                                                }
                                            }}
                                        />
                                        <button onClick={async () => {
                                            const rawInput = manualCodes[order.barcode] || '';
                                            const enteredCode = normalizeArabicNumerals(rawInput.trim().toUpperCase());
                                            const targetBarcode = (order.barcode || '').trim().toUpperCase();
                                            const targetBackup = (order.backupCode || '').trim().toUpperCase();
                                            if ((enteredCode === targetBarcode || enteredCode === targetBackup) && enteredCode) {
                                                if (await customConfirm(isRTL ? 'هل تم استلام المنتج؟' : 'Product received?')) {
                                                    completeBooking(order.barcode);
                                                    setManualCodes(prev => { const n = { ...prev }; delete n[order.barcode]; return n; });
                                                }
                                            } else {
                                                await customAlert(isRTL ? 'رمز غير صحيح!' : 'Invalid code!');
                                            }
                                        }}
                                            style={{ width: 60, height: 48, borderRadius: 12, background: 'var(--primary)', color: 'white', border: 'none', fontWeight: 900, cursor: 'pointer' }}>
                                            {isRTL ? 'تحقق' : 'Go'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )) : (
                            <div style={{ textAlign: 'center', padding: 40, opacity: 0.5 }}>{isRTL ? 'لا توجد طلبات نشطة حالياً' : 'No active orders'}</div>
                        )}
                    </div>
                ) : view === 'insights' ? (
                    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                        {/* Summary Cards */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <div style={{ background: 'var(--card-bg)', padding: 20, borderRadius: 24, border: '1px solid var(--border-color)', textAlign: 'center', boxShadow: 'var(--shadow-sm)' }}>
                                <div style={{ fontSize: '1.8rem', marginBottom: 4 }}>👁️</div>
                                <div style={{ fontSize: '1.3rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                                    {myDeals.reduce((acc, d) => acc + (d.views || 0), 0)}
                                </div>
                                <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)' }}>
                                    {isRTL ? 'إجمالي المشاهدات' : 'Total Views'}
                                </div>
                            </div>
                            <div style={{ background: 'var(--card-bg)', padding: 20, borderRadius: 24, border: '1px solid var(--border-color)', textAlign: 'center', boxShadow: 'var(--shadow-sm)' }}>
                                <div style={{ fontSize: '1.8rem', marginBottom: 4 }}>🎟️</div>
                                <div style={{ fontSize: '1.3rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                                    {myOrders.length}
                                </div>
                                <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)' }}>
                                    {isRTL ? 'إجمالي الحجوزات' : 'Total Bookings'}
                                </div>
                            </div>
                        </div>

                        {/* Conversion Card */}
                        <div style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-dark))', padding: 24, borderRadius: 24, color: 'white', position: 'relative', overflow: 'hidden' }}>
                            <div style={{ position: 'absolute', top: -20, right: -20, width: 100, height: 100, background: 'rgba(255,255,255,0.1)', borderRadius: '50%' }} />
                            <div style={{ position: 'relative', zIndex: 1 }}>
                                <div style={{ fontSize: '0.85rem', fontWeight: 800, opacity: 0.9, marginBottom: 8 }}>
                                    {isRTL ? 'معدل التحويل الإجمالي' : 'Overall Conversion Rate'}
                                </div>
                                <div style={{ fontSize: '2rem', fontWeight: 900 }}>
                                    {(() => {
                                        const views = myDeals.reduce((acc, d) => acc + (d.views || 0), 0);
                                        return views > 0 ? ((myOrders.length / views) * 100).toFixed(1) : '0';
                                    })()}%
                                </div>
                                <div style={{ marginTop: 12, height: 6, background: 'rgba(255,255,255,0.2)', borderRadius: 3 }}>
                                    <div style={{ 
                                        width: `${Math.min(100, (myDeals.reduce((acc, d) => acc + (d.views || 0), 0) > 0 ? (myOrders.length / myDeals.reduce((acc, d) => acc + (d.views || 0), 0)) * 100 : 0))}%`, 
                                        height: '100%', background: 'white', borderRadius: 3, boxShadow: '0 0 10px white' 
                                    }} />
                                </div>
                            </div>
                        </div>

                        {/* Detailed Table */}
                        <div style={{ background: 'var(--card-bg)', borderRadius: 24, padding: 20, border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
                            <h3 style={{ fontSize: '1rem', fontWeight: 900, marginBottom: 16 }}>{isRTL ? 'أداء العروض' : 'Deals Performance'}</h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {myDeals.sort((a, b) => (b.views || 0) - (a.views || 0)).map(deal => {
                                    const dealBookings = myOrders.filter(b => b.deal.id === deal.id).length;
                                    const conversion = (deal.views || 0) > 0 ? ((dealBookings / (deal.views || 1)) * 100).toFixed(1) : '0';
                                    return (
                                        <div key={deal.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--gray-50)' }}>
                                            <img src={deal.images[0]} style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover' }} />
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 2 }}>{deal.itemName}</div>
                                                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                                                    {isRTL ? 'المشاهدات:' : 'Views:'} {deal.views || 0} | {isRTL ? 'الحجوزات:' : 'Bookings:'} {dealBookings}
                                                </div>
                                            </div>
                                            <div style={{ textAlign: 'end' }}>
                                                <div style={{ fontSize: '0.85rem', fontWeight: 900, color: 'var(--primary)' }}>{conversion}%</div>
                                                <div style={{ fontSize: '0.65rem', color: 'var(--gray-400)', fontWeight: 700 }}>{isRTL ? 'تحويل' : 'Conv.'}</div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div style={{ textAlign: 'center', padding: '20px 0' }}>
                        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 24, padding: 30, boxShadow: 'var(--shadow)' }}>
                            <div style={{ fontSize: '4rem', marginBottom: 16 }}>📷</div>
                            <h3 style={{ fontSize: '1.2rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 8 }}>
                                {isRTL ? 'التحقق من حجز المشتري' : 'Verify Buyer Booking'}
                            </h3>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600, marginBottom: 24, lineHeight: 1.6 }}>
                                {isRTL
                                    ? 'استخدم الكاميرا لمسح باركود المشتري عند وصوله، أو أدخل الرمز يدوياً للتحقق من صلاحية الحجز.'
                                    : 'Use the camera to scan the buyer\'s barcode on arrival, or enter the code manually to verify the booking.'}
                            </p>
                            <button onClick={() => setScannerOpen(true)} style={{
                                width: '100%', padding: '16px', borderRadius: 16,
                                background: 'linear-gradient(135deg, var(--primary), var(--primary-dark))',
                                color: 'white', fontWeight: 900, border: 'none', fontSize: '1rem',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10
                            }}>
                                <span>📷</span> {isRTL ? 'فتح السكانر' : 'Open Scanner'}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <BarcodeScanner isOpen={scannerOpen} onClose={() => setScannerOpen(false)} />
            <DualCalendarPicker
                isOpen={showDualPicker}
                onClose={() => setShowDualPicker(false)}
                onSelect={({ hijri, gregorian }) => {
                    setExpiryDate(hijri);         // hijri for parseHijriAndGetMinutes fallback
                    setExpiryGregorian(gregorian); // gregorian for accurate minutes calc
                    setExpiryHijriDisplay(hijri);  // hijri YYYY-MM-DD for display label
                }}
                isRTL={isRTL}
                currentHijri={expiryHijriDisplay}
                currentGregorian={expiryGregorian}
            />
            <BottomNav />
        </div>
    );
};

export default SellerDashboard;
