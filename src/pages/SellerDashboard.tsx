import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import BarcodeScanner from '../components/BarcodeScanner';
import BookingThread from '../components/BookingThread';
import DualCalendarPicker from '../components/DualCalendarPicker';
import ImageCropEditor from '../components/ImageCropEditor';
import CameraCapture from '../components/CameraCapture';
import ReportDialog from '../components/ReportDialog';
import SubscriptionStatusCard from '../components/SubscriptionStatusCard';
import WorkingHoursEditor from '../components/WorkingHoursEditor';
import ReferralCard from '../components/seller/ReferralCard';
import SellerAnalytics from '../components/seller/SellerAnalytics';
import { REGIONS, CITIES, LOCATIONS, Category, GenderTarget, Deal, findNearestCity, findNearestLocation, CATEGORIES, GENDERS , geoName } from '../data/mock';
import { useApp } from '../context/AppContext';
import { useBooking } from '../hooks/useBooking';
import { DEFAULT_MAX_LOCATIONS, packageLabel } from '../data/packages';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import { validationService } from '../services/validationService';
import { logger } from '../utils/logger';
import { normalizeArabicNumerals, toHijri, withTimeout, TimeoutError, sanitizeDecimalInput, getCurrentPositionSafe, geoErrorMessage } from '../utils/helpers';
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
        if (!center[0] || !center[1]) return;
        // Three-phase pan. Earlier versions did a single setTimeout(0)
        // pan-with-animation which silently failed on iOS Safari when the
        // success modal opened over the map: the alert's enter-animation
        // briefly redrew the layer above the map, Leaflet's `invalidateSize`
        // measured the wrong tile grid, and `setView` with `animate: true`
        // never finished. The pin moved in state but the map stayed at
        // Riyadh — exactly what Nasser saw with the Sakaka link.
        //
        // Fix:
        //   1. Pan IMMEDIATELY with `animate: false` so the camera is
        //      already on-target before any modal can interfere.
        //   2. Re-issue `invalidateSize + setView` after 300ms so that if
        //      the container was 0-height during phase 1 (e.g. parent
        //      animating in, modal closing), the second pass lands on the
        //      correct tile grid.
        //   3. Use try/catch — Leaflet throws if the map was just torn
        //      down (rare, but happens during fast view switches).
        try {
            map.setView(center, 15, { animate: false });
        } catch { /* map may be mid-teardown; phase 2 covers it */ }

        const t = setTimeout(() => {
            try {
                map.invalidateSize();
                map.setView(center, 15, { animate: false });
            } catch { /* swallow — best-effort */ }
        }, 300);
        return () => clearTimeout(t);
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
    const { addDeal, deleteDeal, updateDeal, deals, language, user, loading, notifications, markNotifRead, storeProfiles, addNotification, bookings, customAlert, customConfirm, customPrompt, addReply, acknowledgeBooking, updateProfile, updateStoreProfile, branches, saveBranch, removeBranch } = useApp();
    const { completeBooking, cancelBooking } = useBooking();
    const isRTL = language === 'ar';
    const [view, setView] = useState<'form' | 'products' | 'orders' | 'scanner' | 'notifications' | 'insights' | 'reviews'>('form');
    // ساعات عمل المحل — تُحفظ في ملف التاجر (ثابتة عبر المنتجات حتى يغيّرها). v11.77
    const [hoursSaving, setHoursSaving] = useState(false);
    const myWorkingHours = (storeProfiles[user?.id || ''] as any)?.workingHours ?? (user as any)?.workingHours;
    const handleSaveHours = useCallback(async (wh: any) => {
        if (!user) return;
        setHoursSaving(true);
        try {
            updateStoreProfile(user.id, { workingHours: wh } as any);
            await customAlert(isRTL ? '✅ تم حفظ ساعات العمل' : '✅ Working hours saved');
        } finally { setHoursSaving(false); }
    }, [user, updateStoreProfile, customAlert, isRTL]);
    const [ordersFilter, setOrdersFilter] = useState<'active' | 'history'>('active');
    // Reviews tab — Facebook-style inline reply state. activeReplyId picks
    // which rating is currently in "compose" mode; replyDrafts holds the
    // half-typed text per-rating so switching focus doesn't lose it.
    const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
    const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
    const [highlightedBarcode, setHighlightedBarcode] = useState<string | null>(null);
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
    // The store's location package size (store_profiles.max_branches): 1/3/6/10.
    // Admin-controlled from Admin → Sellers. Falls back to the base 3.
    const [maxLocations, setMaxLocations] = useState<number>(DEFAULT_MAX_LOCATIONS);

    // Fetch payment settings + check subscription status.
    //
    // SOURCES OF TRUTH (v11.22): the admin "apply subscription" RPC
    // (`admin_apply_subscription`) writes the merchant's plan + expiry into
    // `store_profiles` (subscription_plan / subscription_expires_at). The newer
    // billing lifecycle lives in `merchant_subscriptions` (status + trial/period
    // dates). Before v11.22 this gate read ONLY `merchant_subscriptions`, so an
    // admin activation — which lands in `store_profiles` — never unlocked the
    // seller (they stayed on the locked "Add" screen). We now unlock if EITHER
    // store says the seller is subscribed.
    //
    // It's also a reusable callback that re-runs on focus / tab visibility and a
    // realtime change to this seller's rows, so an activation appears without a
    // full PWA reinstall.
    const checkSub = useCallback(async () => {
        const { supabase } = await import('../services/supabaseClient');
        const { data } = await supabase.from('platform_settings').select('value').eq('key', 'payment_gateway_enabled').maybeSingle();
        const enabled = data?.value === true;
        setIsPaymentEnabled(enabled);

        // Read the location package (max_branches) AND the admin-written
        // subscription mirror (plan + expiry) in a single store_profiles query.
        // The seller can always read their own row (RLS: own store_id).
        let mirrorOk = false;
        if (user?.id) {
            const { data: sp } = await supabase
                .from('store_profiles')
                .select('max_branches, subscription_plan, subscription_expires_at')
                .eq('store_id', user.id)
                .maybeSingle();
            setMaxLocations(Number(sp?.max_branches) > 0 ? Number(sp!.max_branches) : DEFAULT_MAX_LOCATIONS);

            const plan = (sp?.subscription_plan ?? 'free').toString().toLowerCase();
            const exp = sp?.subscription_expires_at ? new Date(sp.subscription_expires_at).getTime() : null;
            // A non-free plan with no expiry, or an expiry still in the future.
            mirrorOk = plan !== 'free' && plan !== '' && (exp === null || exp > Date.now());
        }

        // Admins are not paying merchants — they always pass.
        if (user?.userType === 'admin') {
            setIsSubscriptionValid(true);
            return;
        }

        if (!enabled || !user?.id) {
            setIsSubscriptionValid(true);
            return;
        }

        const { data: sub } = await supabase
            .from('merchant_subscriptions')
            .select('status, trial_ends_at, current_period_end')
            .eq('merchant_id', user.id)
            .maybeSingle();

        const now = Date.now();
        const trialOk = !!sub && sub.status === 'trial'
            && !!sub.trial_ends_at
            && new Date(sub.trial_ends_at).getTime() > now;
        const activeOk = !!sub && (sub.status === 'active' || sub.status === 'gifted')
            && (!sub.current_period_end || new Date(sub.current_period_end).getTime() > now);

        // Unlock on ANY positive signal (billing row OR admin-written mirror).
        setIsSubscriptionValid(Boolean(trialOk || activeOk || mirrorOk));
    }, [user]);

    React.useEffect(() => {
        checkSub();
    }, [checkSub]);

    // Re-check when the seller returns to the app — this is what makes an admin
    // activation appear without a reinstall.
    React.useEffect(() => {
        const onFocus = () => { checkSub(); };
        const onVisible = () => { if (document.visibilityState === 'visible') checkSub(); };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [checkSub]);

    // Realtime: live-unlock the instant an admin activates this seller's
    // subscription. Watches BOTH the billing row and the store_profiles mirror,
    // scoped to this merchant, and cleans up on unmount.
    React.useEffect(() => {
        if (!user?.id) return;
        let channel: any;
        let active = true;
        (async () => {
            const { supabase } = await import('../services/supabaseClient');
            if (!active) return;
            channel = supabase
                .channel(`seller-sub-${user.id}`)
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: 'merchant_subscriptions', filter: `merchant_id=eq.${user.id}` },
                    () => { checkSub(); })
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: 'store_profiles', filter: `store_id=eq.${user.id}` },
                    () => { checkSub(); })
                .subscribe();
        })();
        return () => {
            active = false;
            if (channel) {
                import('../services/supabaseClient').then(({ supabase }) => supabase.removeChannel(channel));
            }
        };
    }, [user?.id, checkSub]);

    // Sync view with URL tab parameter. An `edit=` param always means form
    // view, even if deals haven't loaded yet — guarantees the form tab is
    // active the instant the deal arrives so the user never lands on scanner.
    React.useEffect(() => {
        const params = new URLSearchParams(location.search);
        const tab = params.get('tab');
        const editId = params.get('edit');
        if (editId) {
            setView('form');
        } else if (tab && (['form' , 'products' , 'orders' , 'notifications' , 'scanner' , 'insights' , 'reviews'] as const).includes(tab as any)) {
            setView(tab as any);
        } else if (!tab) {
            setView('form');
        }
    }, [location.search]);

    // Notification deep-link: when a "📦 طلب حجز جديد!" alert is tapped,
    // it routes here as /seller?tab=orders&barcode=XXX. Once the orders
    // tab is rendered AND the booking has loaded, scroll the matching
    // card into view and flash a highlight ring so the seller sees which
    // order the alert was about. The highlight clears after 3s so it
    // doesn't permanently mark the row.
    React.useEffect(() => {
        const params = new URLSearchParams(location.search);
        const barcode = params.get('barcode');
        if (!barcode || view !== 'orders') return;
        setHighlightedBarcode(barcode);
        const scrollTimer = window.setTimeout(() => {
            const el = document.getElementById(`order-${barcode}`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 250);
        const clearTimer = window.setTimeout(() => setHighlightedBarcode(null), 3000);
        return () => { window.clearTimeout(scrollTimer); window.clearTimeout(clearTimer); };
    }, [location.search, view, bookings.length]);

    // Handle Edit Mode from URL — fills form fields once deals arrive.
    React.useEffect(() => {
        const params = new URLSearchParams(location.search);
        const editId = params.get('edit');
        if (editId) {
            const dealToEdit = deals.find(d => d.id === editId);
            if (dealToEdit && editingDealId !== dealToEdit.id) {
                const origin = params.get('origin') as 'active' | 'expired';
                const source = params.get('source');

                handleEdit(dealToEdit, origin || undefined);
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
                createdAt: Date.now(), // fresh timestamp → same duration, counted from the renew tap
                status: 'active' as const
            };

            const ok = await updateDeal(updatedDeal);
            if (!ok) {
                // The renew was REJECTED by the DB (most commonly: this
                // deal's location slot was deleted/changed, so the
                // server location-cap trigger refuses to re-activate it).
                // Previously we showed "renewed successfully" anyway and
                // the deal silently stayed in the past list. Instead,
                // open it in the edit form — the "deleted location"
                // banner + current-location chips there let the seller
                // re-pick a valid location, and Save then truly renews.
                // updateDeal already surfaced the specific DB reason.
                handleEdit(deal);
                setView('form');
                return;
            }
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
    // v12.28 — حدود الحجز للمشتري (منع السوق السوداء): '' أو 0 = بلا حد
    const [maxPerBooking, setMaxPerBooking] = useState<number | string>('');
    const [maxBookingsPerBuyer, setMaxBookingsPerBuyer] = useState<number | string>('');
    const [rebookCooldownMinutes, setRebookCooldownMinutes] = useState<number>(0);
    const [expiryType, setExpiryType] = useState<'duration' | 'date' | 'stock' | 'hours'>('hours');
    const [days, setDays] = useState('');
    const [expiryHours, setExpiryHours] = useState('');
    const [expiryDate, setExpiryDate] = useState(''); // Gregorian YYYY-MM-DD (used for calculation)
    // v11.20 — Coming Soon scheduling. Off by default so existing sellers
    // see no behavior change. When ON we capture a single datetime-local
    // value (browser-native picker, native validation). The 30-day cap is
    // enforced both here (max attribute) AND inside submitAction so even a
    // tampered input can't sneak in a year-out date.
    const [scheduledEnabled, setScheduledEnabled] = useState(false);
    const [scheduledAt, setScheduledAt] = useState(''); // YYYY-MM-DDTHH:mm
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
    // Tracks WHICH save button the seller clicked so we only spin THAT
    // button, not every save button on the form. Without this, clicking
    // "Save & Add Deal" makes "Add Another" also spin (both read isSaving),
    // which looks like the form has frozen.
    const [submitMode, setSubmitMode] = useState<'publish' | 'addAnother' | 'saveOnly' | null>(null);
    // Re-entrance guard for handleMapLinkUpdate. The auto-resolve effect
    // and a manual Save click can both call it within the same render
    // window, kicking off two parallel proxy cascades. Ref instead of
    // state so it's immediately visible to the concurrent caller.
    const resolutionInFlightRef = useRef(false);
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
        // Prevent parallel resolutions. Otherwise the debounced auto-resolve
        // and a Save click both spin up proxy cascades, doubling network
        // traffic and (worse) racing each other into setLastResolvedLink.
        if (resolutionInFlightRef.current) return;
        resolutionInFlightRef.current = true;
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

            // Mark this link as attempted (even on failure) so we don't
            // hammer the proxies on every subsequent submit / save click.
            // Without this, the user pastes a link that can't be resolved,
            // then every "Save" button waits another 3s on the same failed
            // resolution. Now: try once, remember the attempt, move on.
            setLastResolvedLink(googleMapsLink);

            // Only nag the user with the error toast on explicit attempts
            // ("Set" button or Enter key). Silent failures from the debounced
            // auto-resolve would otherwise pop up unprompted while typing.
            if (force) {
                customAlert(isRTL
                    ? '❌ تعذّر فتح الرابط المختصر. جرّب نسخ الرابط الطويل من المتصفح، أو الصق الإحداثيات مباشرة بصيغة: 24.7136, 46.6753'
                    : '❌ Could not resolve the short link. Try the full URL from your browser, or paste coordinates directly as: 24.7136, 46.6753'
                );
            }
        } catch (err) {
            console.error('Resolution error:', err);
            // Same belt-and-braces: don't retry on the next click.
            setLastResolvedLink(googleMapsLink);
        } finally {
            setResolvingLink(false);
            resolutionInFlightRef.current = false;
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

    const [savingShopLocation, setSavingShopLocation] = useState(false);

    const saveShopLocation = async () => {
        if (!user || savingShopLocation) return;
        setSavingShopLocation(true);
        try {
            let lat = mapPos[0];
            let lng = mapPos[1];

            // Only try resolving if we genuinely haven't tried THIS link yet.
            // handleMapLinkUpdate now stamps lastResolvedLink on every attempt
            // (success OR failure), so a second click on a broken link won't
            // re-burn 3 seconds chasing the same dead proxies. Cap at 2s so
            // even the first attempt feels instant on a slow link.
            if (googleMapsLink && googleMapsLink !== lastResolvedLink) {
                const resolved = await Promise.race([
                    handleMapLinkUpdate(),
                    new Promise<null>(r => setTimeout(() => r(null), 2000))
                ]);
                if (resolved && Array.isArray(resolved)) {
                    lat = resolved[0];
                    lng = resolved[1];
                }
            }

            try {
                // 15s ceiling. Earlier versions awaited `updateProfile` with
                // no timeout — a stalled Supabase auth refresh (queued behind
                // the inTabLock) would leave this spinner running until the
                // user gave up and force-quit Safari. Now: if 15s passes
                // without the DB acknowledging, we throw, the user gets a
                // clear retry toast, and the button becomes pressable again.
                // 30s ceiling — the deal triggers (handle_deal_smart_notifications +
                // tr_enforce_location_cap) plus AP-NE1 → KSA RTT can push profile
                // writes past 15s on flaky 4G. 30s preserves the "don't hang
                // forever" guarantee without firing spurious timeouts on slow
                // connections that would have completed successfully.
                await withTimeout(updateProfile({ lat, lng, googleMapsLink }), 30000);
                // Mirror the saved shop location into store_branches as a
                // pinned/primary branch so it shows up in the picker too.
                // The user pressed "💾 حفظ موقع المتجر" explicitly — they
                // want it persisted in BOTH places. Marked is_primary=true so
                // we can tell it apart from per-deal branches later. Failures
                // here are swallowed because the profile write already
                // succeeded and the toast above already fired — branching is
                // a convenience side-effect.
                try {
                    if (user?.id) {
                        const primaryLabel = (shopName && shopName.trim().length > 0)
                            ? shopName.trim()
                            : (locationId && locationId !== 'other'
                                ? (LOCATIONS.find(l => l.id === locationId)?.name || (isRTL ? 'متجري' : 'My store'))
                                : (customLocationName || (isRTL ? 'متجري' : 'My store')));
                        const persistedLocationId = (
                            locationId
                            && locationId !== 'other'
                            && !locationId.startsWith('custom_')
                        ) ? locationId : null;
                        // Replace an existing primary row instead of creating
                        // a second one each time the seller re-saves their
                        // shop location.
                        const existingPrimary = branches.find(b => b.merchantId === user.id && b.isPrimary);
                        await saveBranch({
                            ...(existingPrimary ? { id: existingPrimary.id } : {}),
                            nameAr: primaryLabel,
                            locationId: persistedLocationId,
                            regionId: selectedRegion || null,
                            cityId: selectedCity || null,
                            mapLat: lat,
                            mapLng: lng,
                            googleMapsLink: googleMapsLink || null,
                            isPrimary: true,
                        });
                    }
                } catch (branchErr) {
                    console.warn('Primary branch upsert non-fatal error:', branchErr);
                }
                customAlert(isRTL ? '✅ تم حفظ موقع المتجر الدائم بنجاح!' : '✅ Permanent shop location saved successfully!');
            } catch (e: any) {
                console.error('Save shop location error:', e);
                const isTimeout = e instanceof TimeoutError;
                customAlert(isRTL
                    ? (isTimeout
                        ? '⏱️ تأخر الحفظ. تأكد من اتصال الإنترنت ثم حاول مرة أخرى.'
                        : '❌ فشل حفظ الموقع. حاول مرة أخرى.')
                    : (isTimeout
                        ? '⏱️ Save timed out. Check your connection and try again.'
                        : '❌ Failed to save location. Try again.'));
            }
        } finally {
            setSavingShopLocation(false);
        }
    };

    const normalizedOriginalPrice = normalizeArabicNumerals(originalPrice);
    const normalizedDiscountedPrice = normalizeArabicNumerals(discountedPrice);

    const discount = normalizedOriginalPrice && normalizedDiscountedPrice
        ? Math.round(((Number(normalizedOriginalPrice) - Number(normalizedDiscountedPrice)) / Number(normalizedOriginalPrice)) * 100)
        : 0;

    // Inline price-sanity check. Computed every render so the form gives
    // instant red-border feedback the moment the seller mistypes — the
    // pre-submit alert was firing only AFTER they hit save, by which point
    // they'd already filled out the location/expiry sections for nothing.
    // Save buttons read this to stay disabled until the discount is
    // genuinely lower than the original price.
    const priceInvalid = (() => {
        if (!originalPrice || !discountedPrice) return false;
        const o = Number(normalizedOriginalPrice) || 0;
        const d = Number(normalizedDiscountedPrice) || 0;
        return o > 0 && d > 0 && d >= o;
    })();

    // === Location-limit accounting (package-driven, admin-controlled) ===
    // MAX_LOCATIONS is the store's package size (1/3/6/10) from
    // store_profiles.max_branches. The hard block is enforced server-side by
    // enforce_seller_location_cap; this just powers the hint + chip colors.
    const MAX_LOCATIONS = maxLocations;
    const locKeyOf = (d: { locationId?: string | null; mapLocation?: { lat?: number; lng?: number } }): string => {
        const lid = d.locationId;
        if (lid && typeof lid === 'string' && !lid.startsWith('custom_') && lid !== 'other') {
            return `loc:${lid}`;
        }
        const lat = Math.round((d.mapLocation?.lat ?? 0) * 1000) / 1000;
        const lng = Math.round((d.mapLocation?.lng ?? 0) * 1000) / 1000;
        return `geo:${lat},${lng}`;
    };
    const activeLocationKeys = React.useMemo(() => {
        if (!user?.id) return new Set<string>();
        return new Set(
            deals.filter(d => d.storeId === user.id && d.status === 'active').map(locKeyOf)
        );
    }, [deals, user?.id]);
    // Pick one sample deal per active location so we can render selectable
    // chips ("📍 الراشد مول") elsewhere in the form — used for the renewal
    // banner when a seller's expired deal points to a now-deleted slot.
    const activeLocationsList = React.useMemo(() => {
        if (!user?.id) return [] as Array<{ key: string; deal: Deal }>;
        const seen = new Set<string>();
        const list: Array<{ key: string; deal: Deal }> = [];
        for (const d of deals) {
            if (d.storeId !== user.id || d.status !== 'active') continue;
            const k = locKeyOf(d);
            if (seen.has(k)) continue;
            seen.add(k);
            list.push({ key: k, deal: d });
        }
        return list;
    }, [deals, user?.id]);

    // Human-readable label for a deal's location, used in the chip text.
    // MUST be declared BEFORE `mergedLocationChips` — the useMemo factory
    // runs on first render and dereferences `locNameOf`. v10.59 had it
    // declared later and crashed the whole seller dashboard with a TDZ
    // "Cannot access 'locNameOf' before initialization" on load.
    const locNameOf = (d: Deal): string => {
        if (d.locationId && typeof d.locationId === 'string'
            && !d.locationId.startsWith('custom_') && d.locationId !== 'other') {
            const loc = LOCATIONS.find(l => l.id === d.locationId);
            if (loc) return geoName(loc, language);
        }
        if (d.city) {
            const city = CITIES.find(c => c.id === d.city);
            if (city) return geoName(city, language);
        }
        if (d.mapLocation?.lat && d.mapLocation?.lng) {
            return `${d.mapLocation.lat.toFixed(3)}, ${d.mapLocation.lng.toFixed(3)}`;
        }
        return isRTL ? 'موقع مخصص' : 'Custom location';
    };

    // Unified shape that drives the "📍 لوكيشن سابق" chip picker.
    // Two sources feed it:
    //   1. DB-saved branches (store_branches table) — these expose a `branchId`
    //      so the chip can render an "✕" delete button that hits `removeBranch`.
    //   2. Locations the seller is currently using on active deals (auto-derived
    //      so the picker isn't empty for sellers who haven't explicitly saved
    //      any branch yet). No delete button — you'd remove these by editing
    //      or expiring the underlying deal.
    // Branch entries shadow deal entries at the same location key, so a deal
    // location that's also been saved as a branch appears once (with X).
    type LocationChip = {
        key: string;
        label: string;
        branchId?: string;
        locationId?: string | null;
        regionId?: string | null;
        cityId?: string | null;
        lat?: number;
        lng?: number;
    };
    const mergedLocationChips: LocationChip[] = React.useMemo(() => {
        const out: LocationChip[] = [];
        const seen = new Set<string>();
        // Branches first so their X delete button takes precedence on dupes.
        for (const b of branches) {
            if (b.merchantId !== user?.id || b.isActive === false) continue;
            const key = locKeyOf({
                locationId: b.locationId || null,
                mapLocation: { lat: b.mapLat ?? 0, lng: b.mapLng ?? 0 }
            });
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
                key,
                label: b.nameAr || (isRTL ? 'موقع محفوظ' : 'Saved location'),
                branchId: b.id,
                locationId: b.locationId,
                regionId: b.regionId,
                cityId: b.cityId,
                lat: b.mapLat ?? undefined,
                lng: b.mapLng ?? undefined,
            });
        }
        for (const { key, deal: d } of activeLocationsList) {
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
                key,
                label: locNameOf(d),
                locationId: d.locationId,
                regionId: d.region,
                cityId: d.city,
                lat: d.mapLocation?.lat,
                lng: d.mapLocation?.lng,
            });
        }
        return out;
    }, [branches, activeLocationsList, user?.id, isRTL]);
    const currentCandidateKey = locKeyOf({
        locationId: locationId === 'other' ? null : locationId,
        mapLocation: { lat: mapPos[0], lng: mapPos[1] }
    });
    const locationIsExisting = activeLocationKeys.has(currentCandidateKey);
    // The cap applies on edits too: moving an existing deal to a brand-new
    // location is blocked if the seller is already at 3 distinct locations.
    // (If they kept the same location, locationIsExisting is true and the
    // edit goes through unimpeded.) Admin still bypasses.
    const wouldExceedLimit = !locationIsExisting
        && activeLocationKeys.size >= MAX_LOCATIONS
        && user?.userType !== 'admin';

    // Renewal-of-deleted-location case: the seller hit "Renew" on an
    // expired deal whose original location slot got freed because every
    // other deal in that location also expired. The form opens pre-filled
    // with the old (now-orphan) location, the cap stops them from saving,
    // and the seller has no idea why. Detect this exact shape so we can
    // show a specific banner with the 3 current location chips for
    // one-tap reassignment.
    const editingDealRef = editingDealId ? deals.find(d => d.id === editingDealId) : null;
    const editingFromDeletedLocation = !!(
        editingDealRef
        && editingDealRef.status !== 'active'
        && !activeLocationKeys.has(currentCandidateKey)
        && activeLocationKeys.size >= MAX_LOCATIONS
        && user?.userType !== 'admin'
    );

    // Shared "adopt this location into the form" helper. Both the renewal
    // banner (Deal source) and the always-on chip picker (LocationChip
    // source) funnel through here so they can't drift.
    const adoptLocationChip = (c: { locationId?: string | null; regionId?: string | null; cityId?: string | null; lat?: number; lng?: number }) => {
        const lid = c.locationId;
        const isCustom = !lid || lid === 'other' || (typeof lid === 'string' && lid.startsWith('custom_'));
        if (isCustom) {
            setLocationType('other');
            setLocationId('other');
        } else {
            const loc = LOCATIONS.find(l => l.id === lid);
            if (loc) {
                setLocationType(loc.type as any);
            }
            setLocationId(lid);
        }
        if (c.regionId) setSelectedRegion(c.regionId);
        if (c.cityId) setSelectedCity(c.cityId);
        if (c.lat != null && c.lng != null) {
            setMapPos([c.lat, c.lng]);
        }
        // Clear any pasted Google Maps link so it doesn't fight the new pin.
        setGoogleMapsLink('');
        setLastResolvedLink('');
    };
    const adoptLocationFromDeal = (d: Deal) => adoptLocationChip({
        locationId: d.locationId,
        regionId: d.region,
        cityId: d.city,
        lat: d.mapLocation?.lat,
        lng: d.mapLocation?.lng,
    });

    // Delete confirmation for a saved branch (the X button on a chip).
    // Optimistic — context drops it from `branches` immediately and rolls
    // back if the DB delete fails.
    const handleRemoveBranch = async (branchId: string, label: string) => {
        const ok = await customConfirm(isRTL
            ? `حذف "${label}" من اللوكيشنات المحفوظة؟ هذا يحذفه من الـDB ولا يؤثر على عروضك النشطة.`
            : `Remove "${label}" from your saved locations? This deletes it from the DB and does not affect any active deal.`);
        if (!ok) return;
        try {
            await removeBranch(branchId);
        } catch {
            await customAlert(isRTL ? '❌ فشل حذف اللوكيشن. حاول مرة أخرى.' : '❌ Failed to delete. Try again.');
        }
    };

    // Removed auto-centering effect to prevent overwriting manual map pin placement

    const [uploadingImages, setUploadingImages] = useState<boolean>(false);
    const [showCamera, setShowCamera] = useState<boolean>(false);
    const [reportBuyer, setReportBuyer] = useState<{ id: string; name?: string } | null>(null);
    const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
    // Crop pipeline. Each item is the original File plus pre-decoded
    // dimensions and a data URL. Pre-decoding here (instead of inside the
    // editor) means the editor opens with the picture already visible —
    // no "preparing image" state, no broken "couldn't display" fallback.
    // From the seller's perspective the crop now feels like a continuation
    // of the iOS "Use Photo" screen instead of a slow second page.
    type CropQueueItem = {
        file: File;
        dataUrl: string;
        naturalW: number;
        naturalH: number;
    };
    const [cropQueue, setCropQueue] = useState<CropQueueItem[]>([]);
    const [cropIndex, setCropIndex] = useState(0);

    // Decode a picked File into a data URL + intrinsic dimensions. Returns
    // null when the browser refuses to decode the image (some HEIC variants
    // on older iOS, files corrupted in transit, etc.).
    const preDecodeFile = async (f: File): Promise<{ dataUrl: string; w: number; h: number } | null> => {
        try {
            const dataUrl: string = await new Promise((resolve, reject) => {
                const fr = new FileReader();
                fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : '');
                fr.onerror = () => reject(fr.error);
                fr.readAsDataURL(f);
            });
            if (!dataUrl) return null;
            const dims = await new Promise<{ w: number; h: number } | null>((resolve) => {
                const im = new Image();
                im.onload = () => {
                    if (im.naturalWidth > 0 && im.naturalHeight > 0) {
                        resolve({ w: im.naturalWidth, h: im.naturalHeight });
                    } else {
                        resolve(null);
                    }
                };
                im.onerror = () => resolve(null);
                im.src = dataUrl;
            });
            if (!dims) return null;
            return { dataUrl, w: dims.w, h: dims.h };
        } catch {
            return null;
        }
    };

    // Validates types/sizes, pre-decodes each survivor, then queues for
    // the crop editor. Files that won't decode are uploaded as-is so the
    // seller never sees a broken crop page.
    const ingestFiles = async (files: File[] | FileList | null | undefined) => {
        if (!files || files.length === 0) return;
        const accepted: File[] = [];
        const rejected: Array<{ reason: 'type' | 'size'; name: string }> = [];
        for (const f of Array.from(files)) {
            if (!f.type.startsWith('image/')) {
                rejected.push({ reason: 'type', name: f.name });
                continue;
            }
            if (f.size > 8 * 1024 * 1024) {
                rejected.push({ reason: 'size', name: f.name });
                continue;
            }
            accepted.push(f);
        }
        if (rejected.length > 0) {
            const sizeFails = rejected.filter((f) => f.reason === 'size').length;
            const typeFails = rejected.filter((f) => f.reason === 'type').length;
            const lines: string[] = [];
            if (sizeFails) lines.push(isRTL ? `⚠️ ${sizeFails} صورة أكبر من 8MB` : `⚠️ ${sizeFails} image(s) exceed 8MB`);
            if (typeFails) lines.push(isRTL ? `⚠️ ${typeFails} ملف ليس صورة` : `⚠️ ${typeFails} file(s) not an image`);
            customAlert(lines.join('\n'));
        }
        if (accepted.length === 0) return;
        // Respect the 4-image cap when queueing.
        const remainingSlots = Math.max(0, 4 - images.length - cropQueue.length);
        const toProcess = accepted.slice(0, remainingSlots);
        if (toProcess.length === 0) {
            customAlert(isRTL ? '⚠️ الحد الأقصى 4 صور' : '⚠️ Maximum 4 images');
            return;
        }
        // Decode each file sequentially. Successful ones land in the crop
        // queue (and the editor pops as soon as the first one is ready);
        // decode failures get uploaded as-is.
        for (const f of toProcess) {
            const decoded = await preDecodeFile(f);
            if (decoded) {
                setCropQueue(prev => {
                    // Reset the displayed counter to 1 for a fresh batch
                    // (queue was empty) — without this, picking 2 photos
                    // after already processing 3 would show "4/5" not "1/2".
                    if (prev.length === 0) setCropIndex(0);
                    return [...prev, { file: f, dataUrl: decoded.dataUrl, naturalW: decoded.w, naturalH: decoded.h }];
                });
            } else {
                await uploadCroppedFile(f);
            }
        }
    };

    // Upload one cropped/original File to storage, then advance the queue.
    const uploadCroppedFile = async (cropped: File) => {
        setUploadingImages(true);
        try {
            const url = await storageService.uploadImage(cropped);
            if (url) {
                setImages(prev => [...prev, url].slice(0, 4));
            } else {
                // Local fallback so the seller doesn't lose the photo if
                // storage is flaky — same path as before the crop step.
                try {
                    const dataUrl = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = (ev) => resolve((ev.target?.result as string) || '');
                        reader.onerror = () => reject(reader.error);
                        reader.readAsDataURL(cropped);
                    });
                    if (dataUrl) {
                        setImages(prev => [...prev, dataUrl].slice(0, 4));
                    } else {
                        customAlert(isRTL ? '❌ تعذّر رفع الصورة (تحقق من اتصال الإنترنت)' : '❌ Image upload failed (check connection)');
                    }
                } catch {
                    customAlert(isRTL ? '❌ تعذّر رفع الصورة' : '❌ Image upload failed');
                }
            }
        } finally {
            setUploadingImages(false);
        }
    };

    const advanceCropQueue = (dropCurrent: boolean = false) => {
        setCropQueue(prev => prev.slice(1));
        setCropIndex(i => i + (dropCurrent ? 0 : 1));
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        ingestFiles(e.target.files);
        // Reset the input so picking the same file twice still fires onChange.
        // Without this, "edit → re-select same photo" silently no-ops.
        e.target.value = '';
    };

    // Generic over HTMLElement so the same handlers work whether the
    // dropzone is rendered as <div> or <label> (label htmlFor pattern).
    const handleDrop = (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(false);
        if (uploadingImages) return;
        const dropped = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
        if (dropped.length === 0) return;
        ingestFiles(dropped);
    };

    const handleDragOver = (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (!uploadingImages && !isDraggingOver) setIsDraggingOver(true);
    };

    const handleDragLeave = (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(false);
    };

    // Clipboard paste — listens at document level only while seller form is mounted
    // and the active view is the form. Lets users Cmd+V an image directly from
    // their clipboard (screenshot, copied image, etc.) without ever opening the
    // file picker.
    useEffect(() => {
        if (view !== 'form') return;
        const onPaste = (e: ClipboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
            const items = e.clipboardData?.items;
            if (!items) return;
            const pastedFiles: File[] = [];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.kind === 'file' && item.type.startsWith('image/')) {
                    const file = item.getAsFile();
                    if (file) pastedFiles.push(file);
                }
            }
            if (pastedFiles.length > 0) {
                e.preventDefault();
                ingestFiles(pastedFiles);
            }
        };
        document.addEventListener('paste', onPaste);
        return () => document.removeEventListener('paste', onPaste);
    }, [view, uploadingImages]);

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

    // v11.41 — geolocation via the cross-browser helper so it NEVER hangs on
    // Safari (its built-in timeout is unreliable). `locating` always resets in
    // `finally`, so the button can't get stuck on the "⏳" state.
    const [locating, setLocating] = useState(false);
    const handleLocateMe = async () => {
        if (locating) return;
        // iOS/Safari requires HTTPS for geolocation.
        if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
            customAlert(isRTL
                ? '⚠️ تحديد الموقع يتطلب اتصالاً آمناً (HTTPS). أو اضغط على الخريطة لتثبيت الدبوس يدوياً.'
                : '⚠️ Geolocation requires HTTPS. Or tap the map to drop the pin manually.');
            return;
        }
        setLocating(true);
        try {
            const { lat, lng } = await getCurrentPositionSafe();
            autoUpdateLocation(lat, lng);
            customAlert(isRTL ? '✅ تم تحديد موقعك!' : '✅ Location captured!');
        } catch (e) {
            customAlert(geoErrorMessage(e, isRTL));
        } finally {
            setLocating(false);
        }
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
        setMaxPerBooking('');
        setMaxBookingsPerBuyer('');
        setRebookCooldownMinutes(0);
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
        // v11.20 — reset Coming Soon scheduling
        setScheduledEnabled(false);
        setScheduledAt('');

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
        setMaxPerBooking(deal.maxPerBooking || '');
        setMaxBookingsPerBuyer(deal.maxBookingsPerBuyer || '');
        setRebookCooldownMinutes(deal.rebookCooldownMinutes || 0);

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
        
        // v11.20 — restore Coming Soon scheduling when editing.
        if (typeof deal.startsAt === 'number' && deal.startsAt > Date.now()) {
            setScheduledEnabled(true);
            // Convert ms → YYYY-MM-DDTHH:mm in the browser's local timezone
            // so the datetime-local input shows the same moment the
            // merchant originally picked.
            const d = new Date(deal.startsAt);
            const pad = (n: number) => n.toString().padStart(2, '0');
            setScheduledAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
        } else {
            setScheduledEnabled(false);
            setScheduledAt('');
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

        // === SYNCHRONOUS VALIDATION FIRST — no spinner, no network ===
        // The previous flow flipped isSaving=true, then waited up to 5s
        // resolving the Maps link, THEN ran validation. So if any field
        // was missing the user stared at a spinner for 5 seconds before
        // seeing an alert. Validate everything cheap first — only enter
        // the saving state once we know we're actually going to write.
        const existingDeal = editingDealId ? deals.find(d => d.id === editingDealId) : null;

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

        // 4. v11.20 — Coming Soon validation. Schedule must be in the
        //    future (no upper cap as of v11.21). We use the user's local
        //    timezone (datetime-local has no tz info) which matches the
        //    merchant's intent — they typed a wall-clock time, not a UTC offset.
        let computedStartsAt: number | undefined;
        if (scheduledEnabled) {
            if (!scheduledAt) {
                await customAlert(isRTL ? '⚠️ يرجى اختيار تاريخ ووقت بدء العرض' : '⚠️ Please pick a scheduled start date+time');
                return;
            }
            const startMs = new Date(scheduledAt).getTime();
            if (isNaN(startMs)) {
                await customAlert(isRTL ? '⚠️ تاريخ غير صالح' : '⚠️ Invalid date');
                return;
            }
            const minMs = Date.now() + 10 * 60 * 1000; // at least 10 min ahead
            if (startMs < minMs) {
                await customAlert(isRTL
                    ? '⚠️ يجب أن يكون موعد البدء بعد ١٠ دقائق على الأقل من الآن'
                    : '⚠️ Schedule must be at least 10 minutes in the future');
                return;
            }
            // v11.21 — the 30-day lead-time cap was removed (merchants may
            // schedule as far ahead as they like). The one hard rule left:
            // when the offer ends on a fixed DATE, the launch must land before
            // that date — otherwise the deal would go live already expired.
            // Hours / days / stock anchor their lifespan to startsAt, so they
            // can never collide with the launch time.
            if (expiryType === 'date' && expiryGregorian) {
                const expiryMs = new Date(expiryGregorian).getTime();
                if (!isNaN(expiryMs) && startMs >= expiryMs) {
                    await customAlert(isRTL
                        ? '⚠️ موعد بدء العرض يجب أن يكون قبل تاريخ انتهاء العرض. عدّل أحد التاريخين.'
                        : '⚠️ The launch time must be before the deal\'s expiry date. Adjust one of them.');
                    return;
                }
            }
            computedStartsAt = startMs;
        }

        // 4. Hours mode needs an explicit hour count — no silent default.
        if (expiryType === 'hours' && !finalHours) {
            await customAlert(isRTL ? '⚠️ حدّد عدد الساعات قبل النشر' : '⚠️ Please specify how many hours');
            return;
        }

        // Price validation: discount must be less than original. The inline
        // priceInvalid flag also disables the save buttons, so this branch
        // is the belt-and-braces fallback for keyboard submits.
        if (Number(normalizeArabicNumerals(discountedPrice)) >= Number(normalizeArabicNumerals(originalPrice))) {
            await customAlert(isRTL ? '⚠️ سعر الخصم يجب أن يكون أقل من السعر الأصلي!' : '⚠️ Discount price must be less than original price!');
            return;
        }

        if (images.length === 0) {
            await customAlert(isRTL ? 'يرجى إضافة صورة واحدة على الأقل' : 'Please add at least one image');
            return;
        }

        // === Validation passed — NOW start the spinner and do async work ===
        // submitMode tells the render which button to spin. The button
        // callbacks set this before calling submitAction.
        setIsSaving(true);
        try {
            // Auto-resolve link if changed and not resolved yet. 3s cap (was
            // 5s) — the cheaper proxies usually answer well inside this and
            // we'd rather save with the user's current pin than make them
            // stare at a spinner.
            let finalLat = mapPos[0];
            let finalLng = mapPos[1];

            if (googleMapsLink && googleMapsLink !== lastResolvedLink) {
                // 2s cap (was 3s). The proxy cascade either resolves in
                // under a second or fails — there's no middle case worth
                // waiting for. If it times out the seller's current map
                // pin is what we save.
                const resolutionPromise = handleMapLinkUpdate();
                const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000));

                const resolved = await Promise.race([resolutionPromise, timeoutPromise]);
                if (resolved && Array.isArray(resolved)) {
                    finalLat = resolved[0];
                    finalLng = resolved[1];
                }
            }

            // === LOCATION-LIMIT enforcement (base plan: 3 distinct locations) ===
            // Distinct = unique catalogued mall/store ID, or unique rounded
            // coords (~110m) for custom pins. Two custom pins inside the same
            // building therefore don't split into two "locations".
            //
            // Applies to BOTH new deals AND edits — the cap is on the seller's
            // set of distinct locations, not on the operation. If they want to
            // move a deal to a 4th location they have to free a slot first
            // (delete every deal in one of their existing locations).
            // Admins bypass entirely.
            if (user?.userType !== 'admin') {
                const MAX_LOCATIONS = maxLocations;

                const locKeyOf = (d: { locationId?: string | null; mapLocation?: { lat?: number; lng?: number } }): string => {
                    const lid = d.locationId;
                    if (lid && typeof lid === 'string' && !lid.startsWith('custom_') && lid !== 'other') {
                        return `loc:${lid}`;
                    }
                    const lat = Math.round((d.mapLocation?.lat ?? 0) * 1000) / 1000;
                    const lng = Math.round((d.mapLocation?.lng ?? 0) * 1000) / 1000;
                    return `geo:${lat},${lng}`;
                };

                // Active set INCLUDES the deal being edited (so saving an edit
                // that keeps the same location is always allowed — the deal's
                // existing key is in the set). The block fires only when the
                // *new* key isn't in the set AND the set is already full.
                const myActive = deals.filter(d => d.storeId === user?.id && d.status === 'active');
                const activeKeys = new Set(myActive.map(locKeyOf));

                const candidateKey = locKeyOf({
                    locationId: locationId === 'other' ? null : locationId,
                    mapLocation: { lat: finalLat, lng: finalLng }
                });

                if (!activeKeys.has(candidateKey) && activeKeys.size >= MAX_LOCATIONS) {
                    await customAlert(isRTL
                        ? `⚠️ ${packageLabel(MAX_LOCATIONS, true)}: تسمح بـ${MAX_LOCATIONS} ${MAX_LOCATIONS === 1 ? 'موقع' : 'مواقع'} فقط (${activeKeys.size}/${MAX_LOCATIONS}).\n\nاختر موقعاً من مواقعك الحالية، أو احذف كل منتجات أحد المواقع الشاغرة لتفريغ خانة قبل إضافة موقع جديد. للترقية لباقة أكبر تواصل مع إدارة تاكي.`
                        : `⚠️ ${packageLabel(MAX_LOCATIONS, false)}: allows ${MAX_LOCATIONS} location${MAX_LOCATIONS === 1 ? '' : 's'} only (${activeKeys.size}/${MAX_LOCATIONS}).\n\nPick one of your existing locations, or free a vacant slot first. Contact TAKI admin to upgrade.`);
                    return;
                }
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
                // v11.21 — anchor a date-based expiry to the scheduled launch
                // (if any) so a Coming Soon deal expires EXACTLY on the picked
                // date instead of drifting past it. computedStartsAt is
                // undefined for non-scheduled deals → falls back to now, which
                // preserves the original behaviour.
                const anchor = computedStartsAt ?? Date.now();
                if (expiryGregorian) {
                    return Math.max(1, Math.floor((new Date(expiryGregorian).getTime() - anchor) / 60000));
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
            // v12.26 — denormalized region/city follow the STRONGEST location
            // signal, not the dropdowns:
            //   1. A real catalogued mall/market → its exact city+region.
            //   2. An explicitly-set pin (GPS/link/map tap — anything that moved
            //      it off the default Riyadh center) → nearest city to the pin.
            //   3. Only with no mall and no pin → the dropdown selection.
            // Was: dropdowns first — selectedCity defaults to riyadh_city, so a
            // deal pinned in Dammam saved as «الرياض» and surfaced under the
            // wrong region in every filter (web + bots read these columns).
            ...(() => {
                const chosenLoc = LOCATIONS.find(l => l.id === locationId);
                if (chosenLoc) {
                    const c = CITIES.find(c2 => c2.id === chosenLoc.cityId);
                    return { region: c?.regionId, city: chosenLoc.cityId };
                }
                const pinMoved = Math.abs(finalLat - 24.7136) > 1e-6 || Math.abs(finalLng - 46.6753) > 1e-6;
                if (pinMoved) {
                    const nearest = findNearestCity(finalLat, finalLng);
                    if (nearest) return { region: nearest.regionId, city: nearest.id };
                }
                return { region: selectedRegion || undefined, city: selectedCity || undefined };
            })(),
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
            status: forcePublish ? 'active' : (existingDeal?.status || 'active') as any,
            // v11.20 — startsAt is set ONLY when scheduling is on. Editing
            // an already-launched deal CANNOT push it back into the future
            // (computedStartsAt is undefined unless the toggle is on AND a
            // future date is picked), so a buyer who opened the locked
            // detail page mid-launch never sees the lock reappear.
            startsAt: computedStartsAt,
            // v12.28 — حدود الحجز: undefined = بلا حد (يُحفظ NULL في القاعدة)
            maxPerBooking: Number(normalizeArabicNumerals(String(maxPerBooking))) || undefined,
            maxBookingsPerBuyer: Number(normalizeArabicNumerals(String(maxBookingsPerBuyer))) || undefined,
            rebookCooldownMinutes: rebookCooldownMinutes || undefined
        };

            // 20s ceiling per DB write. Without this, a stalled Supabase
            // call (auth refresh hung in the inTabLock, or a flaky mobile
            // network) leaves "حفظ وإضافة العرض" / "إضافة وتكرار" spinning
            // forever — the exact symptom Nasser hit. On timeout we surface
            // a retry toast and reset the spinner so the form is usable.
            try {
                if (editingDealId) {
                    await withTimeout(updateDeal(newDeal), 40000);
                    if (!stayOnForm) {
                        setEditingDealId(null);
                    }
                } else {
                    await withTimeout(addDeal(newDeal), 40000);
                }
                // Auto-save this deal's location as a re-usable branch so it
                // shows up in the "📍 لوكيشن سابق" chip picker next time.
                // Skipped if a branch already exists at the same locKey
                // (locKeyOf normalizes to 'loc:<id>' or 'geo:<lat,lng>' so
                // dupes from custom pins at the same spot collapse).
                try {
                    const newKey = locKeyOf({
                        locationId: newDeal.locationId,
                        mapLocation: newDeal.mapLocation
                    });
                    const already = branches.some(b => {
                        if (b.merchantId !== user?.id) return false;
                        const bk = locKeyOf({
                            locationId: b.locationId || null,
                            mapLocation: { lat: b.mapLat ?? 0, lng: b.mapLng ?? 0 }
                        });
                        return bk === newKey;
                    });
                    if (!already && user?.id) {
                        const labelDeal: Deal = newDeal;
                        const branchLabel = (() => {
                            const direct = locNameOf(labelDeal);
                            if (direct && direct.trim().length > 0) return direct;
                            return customLocationName || (isRTL ? 'موقع مخصص' : 'Custom location');
                        })();
                        // Persist non-custom locationId so the saved row points
                        // at a known LOCATIONS entry; custom pins keep null so
                        // dedupe uses the geo: key.
                        const persistedLocationId = (
                            newDeal.locationId
                            && typeof newDeal.locationId === 'string'
                            && !newDeal.locationId.startsWith('custom_')
                            && newDeal.locationId !== 'other'
                        ) ? newDeal.locationId : null;
                        // Fire-and-forget — a failed branch upsert MUST NOT
                        // surface as a deal-save error. The deal already
                        // landed; the branch is a convenience side-effect.
                        saveBranch({
                            nameAr: branchLabel,
                            locationId: persistedLocationId,
                            regionId: newDeal.region ?? null,
                            cityId: newDeal.city ?? null,
                            mapLat: newDeal.mapLocation?.lat ?? null,
                            mapLng: newDeal.mapLocation?.lng ?? null,
                            googleMapsLink: googleMapsLink || null,
                        }).catch(() => {});
                    }
                } catch {}
            } catch (e: any) {
                if (e instanceof TimeoutError) {
                    await customAlert(isRTL
                        ? '⏱️ تأخر الحفظ. تأكد من اتصال الإنترنت ثم حاول مرة أخرى.'
                        : '⏱️ Save timed out. Check your connection and try again.');
                    return;
                }
                throw e;
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
            setSubmitMode(null);
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
    // v10.73 — the blocking center "موافق" box that fired for EVERY unread
    // booking notification was removed. A merchant taking hundreds of orders
    // could not work through a modal-per-order. Booking/message alerts now
    // surface ONLY via (1) the non-blocking top banner (AppContext) and
    // (2) the in-app Notifications list — same for buyer and seller.

    const myDeals = deals.filter(d => d.storeId === user?.id);
    
    // Check if a deal has timed out based on its creation date and lifespan.
    // v11.20 — scheduled deals don't start their lifespan clock until startsAt,
    // so a "2 hours" deal scheduled a week out is NOT immediately timed-out.
    const isTimedOut = (d: any) => {
        const lifespanStart = (typeof d.startsAt === 'number') ? Math.max(d.startsAt, d.createdAt || 0) : (d.createdAt || 0);
        const lifespanMs = (d.expiresInMinutes || 120) * 60 * 1000;
        return Date.now() > (lifespanStart + lifespanMs);
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
        fontSize: '0.9rem', outline: 'none', transition: 'all 0.2s ease',
        background: 'var(--body-bg)', color: 'var(--text-primary)', fontWeight: 500
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
                    {(['form', 'products', 'orders', 'reviews', 'scanner', 'insights'] as const).map(tab => {
                        const unreadOrdersCount = notifications.filter(n => n.userId === user?.id && !n.isRead && n.type === 'booking').length;
                        const badgeCount = tab === 'orders' ? unreadOrdersCount : 0;

                        return (
                            <button key={tab} type="button" onClick={() => {
                                // Flip view IMMEDIATELY so the tab feels instant —
                                // not waiting for the URL effect to round-trip.
                                setView(tab);
                                history.push(`/seller?tab=${tab}`);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                                if (tab === 'orders') {
                                    notifications.filter(n => n.userId === user?.id && !n.isRead && n.type === 'booking').forEach(n => markNotifRead(n.id));
                                }
                            }} style={{
                                flex: 1, minWidth: 85, padding: '12px 4px', borderRadius: 16, border: 'none',
                                background: view === tab ? 'var(--accent)' : 'rgba(255, 255, 255, 0.1)',
                                color: 'white',
                                fontWeight: 900, fontSize: '0.85rem', transition: 'transform 0.15s ease, background 0.2s, box-shadow 0.2s', cursor: 'pointer',
                                display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center', position: 'relative',
                                transform: view === tab ? 'scale(1.02)' : 'scale(1)',
                                boxShadow: view === tab ? '0 10px 20px rgba(0,0,0,0.2)' : 'none'
                            }}
                            onPointerDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.96)'; }}
                            onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = view === tab ? 'scale(1.02)' : 'scale(1)'; }}
                            onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = view === tab ? 'scale(1.02)' : 'scale(1)'; }}
                            onPointerCancel={(e) => { (e.currentTarget as HTMLElement).style.transform = view === tab ? 'scale(1.02)' : 'scale(1)'; }}
                            >
                                <span style={{ fontSize: '1rem' }}>
                                    {tab === 'form' ? (editingDealId ? '✏️' : '➕') :
                                     tab === 'products' ? '📦' :
                                     tab === 'orders' ? '🔔' :
                                     tab === 'reviews' ? '⭐' :
                                     tab === 'scanner' ? '📷' :
                                     '📊'}
                                </span>
                                <span style={{ whiteSpace: 'nowrap' }}>
                                    {tab === 'form' ? (isRTL ? (editingDealId ? 'تعديل' : 'إضافة') : (editingDealId ? 'Edit' : 'Add')) :
                                     tab === 'products' ? (isRTL ? 'عروضي' : 'Deals') :
                                     tab === 'orders' ? (isRTL ? 'الطلبات' : 'Orders') :
                                     tab === 'reviews' ? (isRTL ? 'التقييمات' : 'Reviews') :
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

            {/* Subscription status strip (v11.38) — always visible: plan, days
                left, and a tap-through to the manage page. Hidden in free mode
                (the card returns null when there's no paid subscription). */}
            {isPaymentEnabled && <SubscriptionStatusCard compact />}

            {/* Pending-orders banner — appears no matter which tab the seller
                is on, so they never miss a booking that's waiting for receipt
                confirmation. Tap = jumps to the Orders tab where the
                "تأكيد استلام الطلب" button is rendered per-order. */}
            {(() => {
                const pendingCount = myOrders.filter(b => b.status === 'pending').length;
                if (pendingCount === 0 || view === 'orders') return null;
                return (
                    <button
                        type="button"
                        onClick={() => { setView('orders'); history.push('/seller?tab=orders'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            margin: '12px 16px 0',
                            padding: '14px 16px',
                            borderRadius: 16,
                            background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
                            color: 'white',
                            border: 'none',
                            cursor: 'pointer',
                            boxShadow: '0 6px 18px rgba(239, 68, 68, 0.35)',
                            width: 'calc(100% - 32px)',
                            textAlign: isRTL ? 'right' : 'left',
                            fontFamily: 'inherit'
                        }}
                    >
                        <span style={{ fontSize: '1.6rem', flexShrink: 0 }}>🔔</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 900, fontSize: '0.95rem' }}>
                                {isRTL
                                    ? `لديك ${pendingCount} ${pendingCount === 1 ? 'طلب جديد' : pendingCount === 2 ? 'طلبان جديدان' : 'طلبات جديدة'} بانتظار تأكيدك`
                                    : `${pendingCount} new ${pendingCount === 1 ? 'order' : 'orders'} waiting for your confirmation`}
                            </div>
                            <div style={{ fontSize: '0.78rem', opacity: 0.95, fontWeight: 600, marginTop: 2 }}>
                                {isRTL ? 'اضغط لفتح قائمة الطلبات وتأكيد الاستلام' : 'Tap to open the orders list and confirm receipt'}
                            </div>
                        </div>
                        <span style={{ fontSize: '1.4rem', fontWeight: 900, flexShrink: 0 }}>{isRTL ? '‹' : '›'}</span>
                    </button>
                );
            })()}

            {loading && (
                <div
                    aria-live="polite"
                    style={{
                        position: 'fixed',
                        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        zIndex: 1000,
                        background: 'var(--card-bg)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 999,
                        padding: '8px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        boxShadow: '0 6px 20px rgba(0,0,0,0.15)',
                        pointerEvents: 'none'
                    }}
                >
                    <div className="spinner" style={{ width: 16, height: 16, border: '2px solid var(--gray-200)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    <span style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '0.85rem' }}>{isRTL ? 'جاري التحميل...' : 'Loading...'}</span>
                </div>
            )}

            <div style={{ padding: 16 }}>
                {/* ساعات عمل المحل — بطاقة مستقلة أعلى تبويب الإضافة (تُحفظ في الملف لا في العرض) */}
                {view === 'form' && user && (
                    <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <WorkingHoursEditor value={myWorkingHours} isRTL={isRTL} saving={hoursSaving} onSave={handleSaveHours} />
                        {/* v12.30 — رابط دعوة العملاء + باركود QR (الإحالة تُنسب للمتجر) */}
                        <ReferralCard isRTL={isRTL} onAlert={customAlert} />
                    </div>
                )}
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

                        {/* v12.28 — حدود الحجز للمشتري (اختياري): منع السوق السوداء */}
                        <details style={{ background: 'var(--gray-100)', borderRadius: 14, padding: '10px 12px', marginBottom: 14 }}>
                            <summary style={{ cursor: 'pointer', fontWeight: 800, fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                                {isRTL ? '🛡 حدود الحجز للمشتري (اختياري)' : '🛡 Buyer booking limits (optional)'}
                                <span style={{ display: 'block', fontWeight: 600, fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                                    {isRTL ? 'حدّد كم قطعة يحجز العميل في المرة الواحدة، وكم مرة يحق له الحجز — لمنع الاحتكار وإعادة البيع' : 'Cap units per booking and how often one buyer can book — prevents resellers'}
                                </span>
                            </summary>
                            <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
                                <div>
                                    <label style={labelStyle}>{isRTL ? 'أقصى عدد قطع في الحجز الواحد' : 'Max units per single booking'}</label>
                                    <input type="tel" style={fieldInputStyle} value={maxPerBooking} placeholder={isRTL ? 'فارغ = بدون حد' : 'Empty = no limit'} onChange={e => {
                                        const val = normalizeArabicNumerals(e.target.value).replace(/\D/g, '');
                                        setMaxPerBooking(val === '' ? '' : Number(val));
                                    }} />
                                </div>
                                <div>
                                    <label style={labelStyle}>{isRTL ? 'كم مرة يحق للمشتري الواحد حجز هذا العرض؟' : 'How many times may one buyer book this deal?'}</label>
                                    <input type="tel" style={fieldInputStyle} value={maxBookingsPerBuyer} placeholder={isRTL ? 'فارغ = غير محدود (١ = مرة واحدة فقط)' : 'Empty = unlimited (1 = once only)'} onChange={e => {
                                        const val = normalizeArabicNumerals(e.target.value).replace(/\D/g, '');
                                        setMaxBookingsPerBuyer(val === '' ? '' : Number(val));
                                    }} />
                                </div>
                                <div>
                                    <label style={labelStyle}>{isRTL ? 'مدة الانتظار قبل حجز جديد (بعد استلام الحجز السابق)' : 'Wait time before re-booking (after pickup)'}</label>
                                    <select style={fieldInputStyle as any} value={rebookCooldownMinutes} onChange={e => setRebookCooldownMinutes(Number(e.target.value) || 0)}>
                                        <option value={0}>{isRTL ? 'بدون انتظار — يحجز فوراً' : 'No wait'}</option>
                                        <option value={30}>{isRTL ? '٣٠ دقيقة' : '30 minutes'}</option>
                                        <option value={60}>{isRTL ? 'ساعة' : '1 hour'}</option>
                                        <option value={180}>{isRTL ? '٣ ساعات' : '3 hours'}</option>
                                        <option value={360}>{isRTL ? '٦ ساعات' : '6 hours'}</option>
                                        <option value={720}>{isRTL ? '١٢ ساعة' : '12 hours'}</option>
                                        <option value={1440}>{isRTL ? '٢٤ ساعة' : '24 hours'}</option>
                                        <option value={4320}>{isRTL ? '٣ أيام' : '3 days'}</option>
                                        <option value={10080}>{isRTL ? 'أسبوع' : '1 week'}</option>
                                    </select>
                                </div>
                            </div>
                        </details>

                        <div style={inputGroupStyle}>
                            <div style={{ flex: 1 }}>
                                <label style={labelStyle}>{isRTL ? 'السعر الأصلي' : 'Original Price'}</label>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    style={{
                                        ...fieldInputStyle,
                                        borderColor: priceInvalid ? 'var(--danger)' : (fieldInputStyle as any).borderColor,
                                        boxShadow: priceInvalid ? '0 0 0 1px var(--danger) inset' : (fieldInputStyle as any).boxShadow
                                    }}
                                    placeholder={isRTL ? 'مثال: 16.50' : 'e.g. 16.50'}
                                    value={originalPrice}
                                    onChange={e => setOriginalPrice(sanitizeDecimalInput(normalizeArabicNumerals(e.target.value)))}
                                />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={labelStyle}>{isRTL ? 'السعر بعد الخصم' : 'Final Price'}</label>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    style={{
                                        ...fieldInputStyle,
                                        borderColor: priceInvalid ? 'var(--danger)' : (fieldInputStyle as any).borderColor,
                                        boxShadow: priceInvalid ? '0 0 0 1px var(--danger) inset' : (fieldInputStyle as any).boxShadow
                                    }}
                                    placeholder={isRTL ? 'مثال: 12.34' : 'e.g. 12.34'}
                                    value={discountedPrice}
                                    onChange={e => setDiscountedPrice(sanitizeDecimalInput(normalizeArabicNumerals(e.target.value)))}
                                />
                            </div>
                        </div>
                        {priceInvalid && (
                            <div
                                role="alert"
                                style={{
                                    margin: '-12px 0 16px',
                                    padding: '10px 14px',
                                    borderRadius: 12,
                                    background: 'rgba(239, 68, 68, 0.12)',
                                    border: '1px solid rgba(239, 68, 68, 0.4)',
                                    color: 'var(--danger)',
                                    fontSize: '0.82rem',
                                    fontWeight: 800,
                                    lineHeight: 1.5
                                }}
                            >
                                ⚠️ {isRTL
                                    ? 'سعر الخصم يجب أن يكون أقل من السعر الأصلي. تاكي للتخفيضات فقط.'
                                    : 'Discount price must be lower than the original price. TAKI is a discounts-only platform.'}
                            </div>
                        )}

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

                        {/* v11.20 — Coming Soon scheduling. Toggle is OFF by
                            default; turning it ON reveals the datetime picker
                            with a floor of "10 min from now" and no upper cap
                            (v11.21). The deal saves with a future startsAt,
                            stays HIDDEN from buyers until 7 days before launch,
                            then surfaces locked with a live countdown until
                            startsAt passes and bookings open automatically. */}
                        <div style={{ marginBottom: 20 }}>
                            <label style={labelStyle}>{isRTL ? 'جدولة العرض (اختياري)' : 'Schedule Launch (Optional)'}</label>
                            <div
                                role="button"
                                tabIndex={0}
                                onClick={() => setScheduledEnabled(v => { if (v) setScheduledAt(''); return !v; })}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setScheduledEnabled(v => { if (v) setScheduledAt(''); return !v; }); } }}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 12,
                                    padding: '14px 16px', borderRadius: 14,
                                    border: scheduledEnabled ? '1.5px solid var(--primary)' : '1.5px solid var(--gray-200)',
                                    background: scheduledEnabled ? 'var(--notif-unread-bg)' : 'var(--gray-50)',
                                    cursor: 'pointer', WebkitTapHighlightColor: 'transparent'
                                }}
                            >
                                <div style={{ fontSize: '1.4rem' }}>⏳</div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 900, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                                        {isRTL ? 'عرض قادم — Coming Soon' : 'Coming Soon launch'}
                                    </div>
                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600, marginTop: 2, lineHeight: 1.4 }}>
                                        {isRTL
                                            ? 'جهّز العرض من الآن، يبدأ تلقائياً في الوقت المحدد. لا يستطيع المشتري الحجز قبل الموعد.'
                                            : 'Prep ahead — deal stays locked until launch time.'}
                                    </div>
                                </div>
                                <div style={{
                                    width: 44, height: 26, borderRadius: 999,
                                    background: scheduledEnabled ? 'var(--primary)' : 'var(--gray-300)',
                                    position: 'relative', transition: 'background 0.2s ease',
                                    flexShrink: 0
                                }}>
                                    <div style={{
                                        position: 'absolute', top: 3,
                                        [isRTL ? 'right' : 'left']: scheduledEnabled ? 21 : 3,
                                        width: 20, height: 20, borderRadius: '50%',
                                        background: 'white',
                                        transition: 'all 0.2s ease',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                    }} />
                                </div>
                            </div>

                            {scheduledEnabled && (
                                <div style={{ marginTop: 12 }}>
                                    <label style={{ ...labelStyle, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                                        {isRTL ? 'موعد بدء العرض' : 'Launch time'}
                                    </label>
                                    <input
                                        type="datetime-local"
                                        value={scheduledAt}
                                        onChange={(e) => setScheduledAt(e.target.value)}
                                        min={(() => {
                                            // min = now + 10 minutes (local tz). datetime-local has
                                            // no tz info so we format from the user's wall clock.
                                            const d = new Date(Date.now() + 10 * 60 * 1000);
                                            const pad = (n: number) => n.toString().padStart(2, '0');
                                            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                                        })()}
                                        style={{
                                            ...fieldInputStyle,
                                            border: scheduledAt ? '1.5px solid var(--primary)' : '1px solid var(--gray-200)',
                                            colorScheme: 'light',
                                        }}
                                    />
                                    {scheduledAt && (() => {
                                        const startMs = new Date(scheduledAt).getTime();
                                        if (isNaN(startMs)) return null;
                                        const diff = startMs - Date.now();
                                        if (diff <= 0) return null;
                                        const days = Math.floor(diff / 86400000);
                                        const hours = Math.floor((diff / 3600000) % 24);
                                        const inWindow = diff <= 7 * 24 * 60 * 60 * 1000;
                                        return (
                                            <div style={{
                                                marginTop: 8,
                                                padding: '10px 12px',
                                                borderRadius: 10,
                                                background: inWindow ? 'rgba(99,102,241,0.12)' : 'rgba(245,158,11,0.12)',
                                                border: inWindow ? '1px solid rgba(99,102,241,0.35)' : '1px solid rgba(245,158,11,0.35)',
                                                color: 'var(--text-primary)',
                                                fontSize: '0.78rem',
                                                fontWeight: 700,
                                                lineHeight: 1.5,
                                                display: 'flex', gap: 8, alignItems: 'flex-start'
                                            }}>
                                                <span style={{ fontSize: '1rem' }}>{inWindow ? '⏳' : '📅'}</span>
                                                <span>
                                                    {isRTL
                                                        ? (inWindow
                                                            ? `سيظهر العرض في "العروض القادمة" ويبدأ خلال ${days > 0 ? days + 'ي ' : ''}${hours}س`
                                                            : `العرض محفوظ ومجدول. سيظهر للمشترين قبل أسبوع من البدء (يبقى ${days} يوماً للظهور).`)
                                                        : (inWindow
                                                            ? `Will appear in Coming Soon — launches in ${days > 0 ? days + 'd ' : ''}${hours}h`
                                                            : `Saved & scheduled. Visible to buyers 7 days before launch (${days} days until visible).`)}
                                                </span>
                                            </div>
                                        );
                                    })()}
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
                                    <div
                                        role="button"
                                        tabIndex={uploadingImages ? -1 : 0}
                                        onClick={() => { if (!uploadingImages) setShowCamera(true); }}
                                        onKeyDown={(e) => {
                                            if (!uploadingImages && (e.key === 'Enter' || e.key === ' ')) {
                                                e.preventDefault();
                                                setShowCamera(true);
                                            }
                                        }}
                                        onDrop={handleDrop}
                                        onDragOver={handleDragOver}
                                        onDragEnter={handleDragOver}
                                        onDragLeave={handleDragLeave}
                                        aria-label={isRTL ? 'إضافة صور' : 'Add photos'}
                                        style={{
                                            position: 'relative',
                                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                            height: 130, borderRadius: 12,
                                            border: isDraggingOver ? '2px solid var(--primary)' : '2px dashed var(--primary)',
                                            cursor: uploadingImages ? 'default' : 'pointer',
                                            background: isDraggingOver ? 'var(--primary-light)' : 'var(--notif-unread-bg)',
                                            color: 'var(--primary)',
                                            transition: 'background 0.2s ease, border-color 0.2s ease', WebkitTapHighlightColor: 'transparent',
                                            opacity: uploadingImages ? 0.6 : 1,
                                            userSelect: 'none', overflow: 'hidden'
                                        }}
                                    >
                                        {/* Hidden gallery input. Tapping the tile opens the live
                                            in-app camera; this input is opened from the camera's
                                            "Studio" button and is also the drop/paste target. */}
                                        <input
                                            id="seller-image-upload"
                                            ref={fileInputRef}
                                            type="file"
                                            multiple
                                            accept="image/*"
                                            disabled={uploadingImages}
                                            onChange={handleImageUpload}
                                            onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
                                            aria-hidden="true"
                                            tabIndex={-1}
                                            style={{
                                                position: 'absolute',
                                                width: 1, height: 1,
                                                padding: 0, margin: -1,
                                                overflow: 'hidden',
                                                clip: 'rect(0,0,0,0)',
                                                whiteSpace: 'nowrap',
                                                border: 0
                                            }}
                                        />
                                        {uploadingImages ? (
                                            <div className="spinner" style={{ width: 24, height: 24, border: '3px solid var(--gray-200)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', pointerEvents: 'none' }} />
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none', textAlign: 'center', padding: '0 8px' }}>
                                                <span style={{ fontSize: '1.6rem', marginBottom: 4 }}>📸</span>
                                                <span style={{ fontSize: '0.75rem', fontWeight: 800 }}>{isRTL ? 'إضافة صور' : 'Add Photos'}</span>
                                                <span style={{ fontSize: '0.6rem', fontWeight: 600, opacity: 0.9, marginTop: 4 }}>
                                                    {isRTL ? 'كاميرا • قص • المزيد' : 'Camera • crop • more'}
                                                </span>
                                            </div>
                                        )}
                                    </div>
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

                            {/* Location-limit hint. Computed from the seller's active
                                deals (rounded coords / location IDs). Turns amber on
                                3/3 with a new pin and red when blocked. Visible during
                                edits too — the cap applies to both create and edit. */}
                            {user?.userType !== 'admin' && (
                                <div
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        padding: '8px 12px', borderRadius: 10, marginBottom: 10,
                                        background: wouldExceedLimit
                                            ? 'rgba(239, 68, 68, 0.12)'
                                            : (activeLocationKeys.size >= MAX_LOCATIONS && !locationIsExisting
                                                ? 'rgba(245, 158, 11, 0.12)'
                                                : 'rgba(16, 185, 129, 0.10)'),
                                        border: '1px solid ' + (wouldExceedLimit
                                            ? 'rgba(239, 68, 68, 0.35)'
                                            : 'rgba(16, 185, 129, 0.25)'),
                                        fontSize: '0.78rem', fontWeight: 800,
                                        color: wouldExceedLimit ? 'var(--danger)' : 'var(--text-primary)',
                                        lineHeight: 1.5
                                    }}
                                >
                                    <span style={{ fontSize: '1rem' }}>📍</span>
                                    <span style={{ flex: 1 }}>
                                        {isRTL
                                            ? `${packageLabel(MAX_LOCATIONS, true)} — ${MAX_LOCATIONS === 1 ? 'موقع واحد فقط' : `حتى ${MAX_LOCATIONS} مواقع`} • المستخدم حالياً ${activeLocationKeys.size} / ${MAX_LOCATIONS}`
                                            : `${packageLabel(MAX_LOCATIONS, false)} — ${MAX_LOCATIONS === 1 ? '1 location only' : `up to ${MAX_LOCATIONS} locations`} • using ${activeLocationKeys.size} / ${MAX_LOCATIONS}`}
                                        {wouldExceedLimit && (
                                            <span style={{ display: 'block', fontWeight: 700, fontSize: '0.72rem', marginTop: 3 }}>
                                                {isRTL
                                                    ? (editingDealId
                                                        ? '⚠️ نقل المنتج لموقع جديد ممنوع — وصلت للحد. اختر أحد مواقعك الحالية، أو احذف كل منتجات أحد المواقع لتفريغ خانة.'
                                                        : '⚠️ موقع جديد ممنوع — وصلت للحد. اختر أحد مواقعك الحالية، أو احذف كل منتجات أحد المواقع لتفريغ خانة.')
                                                    : (editingDealId
                                                        ? '⚠️ Moving this deal to a new location is blocked — pick an existing one or empty a slot first.'
                                                        : '⚠️ This is a new location — limit reached. Pick an existing one or free a slot.')}
                                            </span>
                                        )}
                                        {!wouldExceedLimit && locationIsExisting && activeLocationKeys.size > 0 && (
                                            <span style={{ display: 'block', fontWeight: 700, fontSize: '0.72rem', marginTop: 3, color: 'var(--primary)' }}>
                                                {isRTL ? '✓ موقع مستخدم من قبل — لن يُحسب كخانة جديدة.' : '✓ Existing location — no new slot used.'}
                                            </span>
                                        )}
                                    </span>
                                </div>
                            )}

                            {/* Renewal banner: the seller hit "تجديد" on an expired
                                deal that used a now-deleted location slot. Show the
                                3 current locations as one-tap chips so they can
                                reassign without navigating away. */}
                            {editingFromDeletedLocation && (
                                <div
                                    style={{
                                        padding: '12px 14px', borderRadius: 14, marginBottom: 12,
                                        background: 'rgba(245, 158, 11, 0.12)',
                                        border: '1.5px solid rgba(245, 158, 11, 0.4)'
                                    }}
                                >
                                    <div style={{ fontSize: '0.85rem', fontWeight: 900, color: 'var(--secondary)', marginBottom: 4 }}>
                                        {isRTL
                                            ? '⚠️ تم حذف لوكيشن العرض السابق'
                                            : '⚠️ This deal\'s previous location was removed'}
                                    </div>
                                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: 10 }}>
                                        {isRTL
                                            ? `انتهت كل عروض موقعه السابق فحُذفت الخانة. تم تغيير موقعك السابق — اختر أحد مواقعك الحالية (${activeLocationKeys.size}/${MAX_LOCATIONS}) لتجديد هذا العرض:`
                                            : `All deals in its old location expired, so the slot was freed. Your previous location was reassigned — pick one of your current locations (${activeLocationKeys.size}/${MAX_LOCATIONS}) to renew this deal:`}
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                        {activeLocationsList.map(({ key, deal }) => (
                                            <button
                                                key={key}
                                                type="button"
                                                onClick={() => adoptLocationFromDeal(deal)}
                                                style={{
                                                    background: 'var(--card-bg)',
                                                    color: 'var(--text-primary)',
                                                    border: '1.5px solid var(--primary)',
                                                    borderRadius: 999,
                                                    padding: '8px 14px',
                                                    fontSize: '0.82rem',
                                                    fontWeight: 900,
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 6,
                                                    WebkitTapHighlightColor: 'transparent'
                                                }}
                                            >
                                                📍 {locNameOf(deal)}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                                <select style={{ ...fieldInputStyle, flex: 1 }} value={selectedRegion} onChange={e => { setSelectedRegion(e.target.value); setSelectedCity(''); }}>
                                    <option value="">{isRTL ? 'اختر المنطقة' : 'Region'}</option>
                                    {REGIONS.map(r => <option key={r.id} value={r.id}>{geoName(r, language)}</option>)}
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
                                    {CITIES.filter(c => !selectedRegion || c.regionId === selectedRegion).map(c => <option key={c.id} value={c.id}>{geoName(c, language)}</option>)}
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
                                        <option key={l.id} value={l.id}>{geoName(l, language)}</option>
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
                            {/* Always-on "previous location" picker — saved branches
                                from store_branches (DB-backed, X to delete) merged
                                with active-deal locations (auto-derived, no delete).
                                One tap adopts region+city+type+pin so the map and
                                filters update together. Hidden during the renewal-
                                of-deleted-slot flow because that banner already
                                shows the same chips above. */}
                            {mergedLocationChips.length > 0 && !editingFromDeletedLocation && (
                                <div style={{
                                    background: 'var(--card-bg)',
                                    border: '1.5px solid var(--gray-200)',
                                    borderRadius: 14,
                                    padding: '10px 12px',
                                    marginBottom: 8
                                }}>
                                    <div style={{
                                        fontSize: '0.75rem',
                                        fontWeight: 800,
                                        color: 'var(--text-primary)',
                                        marginBottom: 6,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6
                                    }}>
                                        📍 {isRTL ? 'مواقعك — اضغط لاستخدامه فوراً' : 'Your locations — tap to reuse'}
                                    </div>
                                    {/* Legend: green = tied to live deals (counts toward the
                                        package, locked from deletion). amber = a free saved
                                        slot the seller can delete to make room. */}
                                    <div style={{
                                        display: 'flex', flexWrap: 'wrap', gap: 12,
                                        fontSize: '0.68rem', fontWeight: 700,
                                        color: 'var(--text-secondary)', marginBottom: 9, lineHeight: 1.5
                                    }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                            <span style={{ width: 11, height: 11, borderRadius: 3, background: 'rgba(16,185,129,0.85)', display: 'inline-block' }} />
                                            {isRTL ? '🔒 نشط — مرتبط بعروض ويُحتسب (لا يُحذف حتى تنتهي/تُحذف عروضه)' : '🔒 Active — tied to deals & counted (locked until its deals end)'}
                                        </span>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                            <span style={{ width: 11, height: 11, borderRadius: 3, background: 'rgba(245,158,11,0.9)', display: 'inline-block' }} />
                                            {isRTL ? 'شاغر — لا يُحتسب، يمكنك حذفه ✕ لتفريغ خانة' : 'Vacant — not counted, delete ✕ to free a slot'}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                        {mergedLocationChips.map(chip => {
                                            const isSelected = chip.key === currentCandidateKey;
                                            // Locked = this location currently powers ≥1 active
                                            // deal → it consumes a package slot and MUST NOT be
                                            // deletable until those deals end/are removed.
                                            const isLocked = activeLocationKeys.has(chip.key);
                                            // Vacant = a saved branch with no live deal → free,
                                            // safe to delete to open a slot.
                                            const isVacant = !!chip.branchId && !isLocked;

                                            const colors = isSelected
                                                ? { bg: 'var(--primary)', fg: '#fff', bd: 'var(--primary)' }
                                                : isLocked
                                                    ? { bg: 'rgba(16,185,129,0.14)', fg: 'var(--text-primary)', bd: 'rgba(16,185,129,0.55)' }
                                                    : isVacant
                                                        ? { bg: 'rgba(245,158,11,0.14)', fg: 'var(--text-primary)', bd: 'rgba(245,158,11,0.6)' }
                                                        : { bg: 'var(--body-bg)', fg: 'var(--text-primary)', bd: 'var(--gray-200)' };

                                            return (
                                                <div
                                                    key={chip.key}
                                                    style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'stretch',
                                                        background: colors.bg,
                                                        color: colors.fg,
                                                        border: '1.5px solid ' + colors.bd,
                                                        borderRadius: 999,
                                                        overflow: 'hidden',
                                                        transition: 'background 0.15s ease, color 0.15s ease'
                                                    }}
                                                >
                                                    <button
                                                        type="button"
                                                        onClick={() => adoptLocationChip(chip)}
                                                        title={isLocked
                                                            ? (isRTL ? 'مرتبط بعروض نشطة — يُحتسب ضمن باقتك' : 'Tied to active deals — counts toward your package')
                                                            : (isRTL ? 'موقع شاغر محفوظ' : 'Vacant saved location')}
                                                        style={{
                                                            background: 'transparent',
                                                            color: 'inherit',
                                                            border: 'none',
                                                            padding: '7px 13px',
                                                            fontSize: '0.8rem',
                                                            fontWeight: 800,
                                                            cursor: 'pointer',
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: 6,
                                                            WebkitTapHighlightColor: 'transparent'
                                                        }}
                                                    >
                                                        {isLocked ? '🔒' : '📍'} {chip.label}
                                                        {isVacant && (
                                                            <span style={{ fontSize: '0.62rem', fontWeight: 800, opacity: 0.85 }}>
                                                                {isRTL ? '• شاغر' : '• vacant'}
                                                            </span>
                                                        )}
                                                    </button>
                                                    {isVacant ? (
                                                        <button
                                                            type="button"
                                                            aria-label={isRTL ? 'حذف اللوكيشن الشاغر' : 'Delete vacant location'}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleRemoveBranch(chip.branchId!, chip.label);
                                                            }}
                                                            style={{
                                                                background: 'rgba(220,38,38,0.10)',
                                                                color: 'var(--danger)',
                                                                border: 'none',
                                                                borderInlineStart: '1px solid rgba(245,158,11,0.5)',
                                                                padding: '0 11px',
                                                                fontSize: '0.85rem',
                                                                fontWeight: 900,
                                                                cursor: 'pointer',
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                WebkitTapHighlightColor: 'transparent'
                                                            }}
                                                        >
                                                            ✕
                                                        </button>
                                                    ) : isLocked ? (
                                                        <span
                                                            aria-hidden
                                                            title={isRTL ? 'لا يمكن حذفه حتى تنتهي أو تُحذف كل عروضه' : 'Cannot delete until all its deals end or are removed'}
                                                            style={{
                                                                background: isSelected ? 'rgba(255,255,255,0.18)' : 'rgba(16,185,129,0.18)',
                                                                color: isSelected ? '#fff' : 'rgb(5,150,105)',
                                                                borderInlineStart: '1px solid ' + (isSelected ? 'rgba(255,255,255,0.35)' : 'rgba(16,185,129,0.4)'),
                                                                padding: '0 10px',
                                                                fontSize: '0.78rem',
                                                                fontWeight: 900,
                                                                display: 'inline-flex',
                                                                alignItems: 'center'
                                                            }}
                                                        >
                                                            🔒
                                                        </span>
                                                    ) : null}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
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
                                {/* attributionControl=false drops the default Leaflet
                                    badge, which includes a Ukraine flag glyph baked
                                    into the library's prefix string. We don't need
                                    the badge here — the map is a picker, not a
                                    publishing surface. */}
                                <MapContainer center={mapPos} zoom={13} attributionControl={false} style={{ height: '100%', width: '100%' }}>
                                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                                    <MapCenterUpdater center={mapPos} />
                                    <LocationMarker position={mapPos} autoUpdate={autoUpdateLocation} />
                                </MapContainer>
                            </div>
                            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                                <button
                                    type="button"
                                    onClick={handleLocateMe}
                                    disabled={locating}
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
                                        cursor: locating ? 'default' : 'pointer',
                                        opacity: locating ? 0.7 : 1,
                                    }}
                                >
                                    {locating
                                        ? <>⏳ {isRTL ? 'جاري التحديد...' : 'Locating…'}</>
                                        : <>📍 {isRTL ? 'تحديد موقعي' : 'Locate Me'}</>}
                                </button>
                                <button
                                    type="button"
                                    onClick={saveShopLocation}
                                    disabled={savingShopLocation}
                                    style={{
                                        flex: 1.5,
                                        padding: '12px',
                                        borderRadius: 12,
                                        background: savingShopLocation ? 'var(--gray-300)' : 'var(--primary)',
                                        color: '#ffffff',
                                        fontWeight: 900,
                                        border: '2px solid ' + (savingShopLocation ? 'var(--gray-300)' : 'var(--primary)'),
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: 8,
                                        cursor: savingShopLocation ? 'default' : 'pointer'
                                    }}
                                >
                                    {savingShopLocation ? (
                                        <div className="spinner" style={{ width: 18, height: 18, border: '2.5px solid white', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                                    ) : (
                                        <>⭐ {isRTL ? 'حفظ كموقع دائم للمتجر' : 'Set Permanent Shop Loc'}</>
                                    )}
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
                                        onClick={() => { setSubmitMode('publish'); submitAction(false, true); }}
                                        disabled={isSaving || resolvingLink || priceInvalid || wouldExceedLimit}
                                        style={{
                                            flex: 2, padding: '16px', borderRadius: 16,
                                            background: (isSaving || priceInvalid || wouldExceedLimit) ? 'var(--gray-300)' : 'linear-gradient(135deg, var(--primary), var(--primary-dark))',
                                            color: 'white', fontWeight: 900, border: 'none', fontSize: '1rem',
                                            boxShadow: (isSaving || priceInvalid || wouldExceedLimit) ? 'none' : '0 6px 20px var(--primary-glow)',
                                            cursor: (isSaving || priceInvalid || wouldExceedLimit) ? 'not-allowed' : 'pointer',
                                            opacity: (priceInvalid || wouldExceedLimit) ? 0.6 : 1,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10
                                        }}
                                    >
                                        {(isSaving && submitMode === 'publish') ? (
                                            <div className="spinner" style={{ width: 20, height: 20, border: '3px solid white', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                                        ) : (
                                            isRTL ? (editingDealId ? 'حفظ التعديلات والنشر' : 'حفظ وإضافة العرض') : (editingDealId ? 'Save & Publish' : 'Save & Add Deal')
                                        )}
                                    </button>

                                    {editingDealId && (
                                        <button
                                            type="button"
                                            onClick={() => { setSubmitMode('saveOnly'); submitAction(false, false); }}
                                            disabled={isSaving || priceInvalid || wouldExceedLimit}
                                            style={{
                                                flex: 1, padding: '16px', borderRadius: 16, border: '1.5px solid var(--border-color)',
                                                background: 'var(--card-bg)', color: 'var(--text-primary)', fontWeight: 800, fontSize: '0.85rem',
                                                cursor: (isSaving || priceInvalid || wouldExceedLimit) ? 'not-allowed' : 'pointer',
                                                opacity: (priceInvalid || wouldExceedLimit) ? 0.6 : 1,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
                                            }}
                                        >
                                            {(isSaving && submitMode === 'saveOnly') ? (
                                                <div className="spinner" style={{ width: 18, height: 18, border: '2.5px solid var(--text-secondary)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                                            ) : (
                                                <>💾 {isRTL ? 'حفظ التعديل فقط' : 'Save Only'}</>
                                            )}
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
                                    <button
                                        type="button"
                                        onClick={() => { setSubmitMode('addAnother'); submitAction(true); }}
                                        disabled={isSaving || resolvingLink || priceInvalid || wouldExceedLimit}
                                        style={{
                                            flex: 1, padding: '16px', borderRadius: 16, border: '1.5px solid var(--border-color)',
                                            background: 'var(--card-bg)', color: 'var(--text-primary)', fontWeight: 800, fontSize: '0.85rem',
                                            cursor: (isSaving || priceInvalid || wouldExceedLimit) ? 'not-allowed' : 'pointer',
                                            opacity: (priceInvalid || wouldExceedLimit) ? 0.6 : 1,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
                                        }}
                                    >
                                        {(isSaving && submitMode === 'addAnother') ? (
                                            <div className="spinner" style={{ width: 18, height: 18, border: '2.5px solid var(--text-secondary)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                                        ) : (
                                            isRTL ? 'إضافة وتكرار' : 'Add Another'
                                        )}
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

                        <div className="taki-deals-grid" style={{ display: 'grid', gap: 12 }}>
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
                        {/* Sub-tabs: نشطة (active) / السجل (history). History lets the
                            merchant scroll back through completed + cancelled orders. */}
                        <div style={{ display: 'flex', gap: 8, padding: 6, background: 'var(--card-bg)', borderRadius: 16, border: '1px solid var(--border-color)' }}>
                            {(['active', 'history'] as const).map(f => {
                                const count = f === 'active' ? activeOrders.length : pastOrders.length;
                                const label = f === 'active'
                                    ? (isRTL ? 'نشطة' : 'Active')
                                    : (isRTL ? 'السجل' : 'History');
                                const icon = f === 'active' ? '🔔' : '📜';
                                const selected = ordersFilter === f;
                                return (
                                    <button
                                        key={f}
                                        type="button"
                                        onClick={() => setOrdersFilter(f)}
                                        style={{
                                            flex: 1, padding: '10px 12px', borderRadius: 12, border: 'none',
                                            background: selected ? 'var(--accent)' : 'transparent',
                                            color: selected ? 'white' : 'var(--text-secondary)',
                                            fontWeight: 900, fontSize: '0.85rem',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                            cursor: 'pointer', transition: 'all 0.2s ease',
                                            boxShadow: selected ? '0 6px 14px rgba(0,0,0,0.15)' : 'none'
                                        }}>
                                        <span>{icon}</span>
                                        <span>{label}</span>
                                        <span style={{
                                            background: selected ? 'rgba(255,255,255,0.25)' : 'var(--gray-100)',
                                            color: selected ? 'white' : 'var(--text-primary)',
                                            padding: '2px 8px', borderRadius: 10, fontSize: '0.72rem', fontWeight: 900
                                        }}>{count}</span>
                                    </button>
                                );
                            })}
                        </div>
                        {ordersFilter === 'history' ? (
                            pastOrders.length > 0 ? (
                                [...pastOrders].sort((a, b) => (b.bookedAt || 0) - (a.bookedAt || 0)).map(order => {
                                    const isCompleted = order.status === 'completed';
                                    const statusLabel = isCompleted
                                        ? (isRTL ? 'مكتمل' : 'Completed')
                                        : (isRTL ? 'ملغي' : 'Cancelled');
                                    const statusColor = isCompleted ? '#059669' : '#dc2626';
                                    const statusBg = isCompleted ? 'rgba(5, 150, 105, 0.12)' : 'rgba(220, 38, 38, 0.12)';
                                    const statusIcon = isCompleted ? '✅' : '❌';
                                    const when = order.bookedAt
                                        ? new Date(order.bookedAt).toLocaleString(isRTL ? 'ar-SA' : 'en-US', {
                                            year: 'numeric', month: 'short', day: 'numeric',
                                            hour: '2-digit', minute: '2-digit'
                                          })
                                        : '';
                                    return (
                                        <div
                                            key={order.barcode}
                                            className="animate-fade-in"
                                            style={{
                                                background: 'var(--card-bg)', backdropFilter: 'blur(10px)',
                                                borderRadius: 24, padding: 18, border: '1px solid var(--border-color)',
                                                boxShadow: 'var(--shadow-sm)', opacity: 0.95
                                            }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 10 }}>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontWeight: 900, fontSize: '1rem', color: 'var(--text-primary)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {order.deal?.itemName || (isRTL ? 'عرض محذوف' : 'Deleted deal')}
                                                    </div>
                                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                                                        🕒 {when}
                                                    </div>
                                                </div>
                                                <div style={{
                                                    background: statusBg, color: statusColor,
                                                    padding: '6px 12px', borderRadius: 14, fontSize: '0.78rem',
                                                    fontWeight: 900, whiteSpace: 'nowrap',
                                                    display: 'flex', alignItems: 'center', gap: 4
                                                }}>
                                                    <span>{statusIcon}</span>
                                                    <span>{statusLabel}</span>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                                                <div style={{ background: 'var(--gray-100)', padding: '5px 10px', borderRadius: 10 }}>
                                                    {isRTL ? '👤 المشتري:' : '👤 Buyer:'}{' '}
                                                    <span style={{ color: 'var(--text-primary)', fontWeight: 800 }}>
                                                        {(order as any).userName || (order.userId ? order.userId.substring(0, 8) + '…' : '—')}
                                                    </span>
                                                </div>
                                                {order.userId && (
                                                    <button type="button"
                                                        onClick={() => setReportBuyer({ id: order.userId, name: (order as any).userName })}
                                                        title={isRTL ? 'إبلاغ عن المشتري للإدارة' : 'Report this buyer to admin'}
                                                        style={{ background: 'rgba(220,38,38,0.10)', color: '#dc2626', border: 'none', padding: '5px 10px', borderRadius: 10, fontWeight: 800, fontSize: '0.78rem', cursor: 'pointer' }}>
                                                        🚩 {isRTL ? 'إبلاغ' : 'Report'}
                                                    </button>
                                                )}
                                                <div style={{ background: 'var(--gray-100)', padding: '5px 10px', borderRadius: 10 }}>
                                                    {isRTL ? '📦 الكمية:' : '📦 Qty:'}{' '}
                                                    <span style={{ color: 'var(--text-primary)', fontWeight: 800 }}>{order.bookedQuantity}</span>
                                                </div>
                                                <div style={{ background: 'var(--gray-100)', padding: '5px 10px', borderRadius: 10, direction: 'ltr', fontFamily: 'monospace' }}>
                                                    #{order.barcode}
                                                </div>
                                            </div>
                                            {order.notes && (
                                                <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(59, 130, 246, 0.08)', borderRadius: 12, fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                                                    📝 {order.notes}
                                                </div>
                                            )}
                                            {order.merchantNote && (
                                                <div style={{ marginTop: 8, padding: '10px 14px', background: 'rgba(245, 158, 11, 0.12)', borderRadius: 12, fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                                                    💬 {order.merchantNote}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            ) : (
                                <div style={{ textAlign: 'center', padding: 40, opacity: 0.5 }}>{isRTL ? 'لا يوجد سجل طلبات بعد' : 'No order history yet'}</div>
                            )
                        ) : activeOrders.length > 0 ? activeOrders.map(order => (
                            <div
                                key={order.barcode}
                                id={`order-${order.barcode}`}
                                className={`animate-fade-in${highlightedBarcode === order.barcode ? ' taki-order-highlight' : ''}`}
                                style={{ background: 'var(--card-bg)', backdropFilter: 'blur(10px)', borderRadius: 24, padding: 20, border: highlightedBarcode === order.barcode ? '2px solid var(--secondary)' : '1px solid var(--border-color)', boxShadow: highlightedBarcode === order.barcode ? '0 0 0 4px rgba(245,158,11,0.18), var(--shadow)' : 'var(--shadow)', transition: 'all 0.3s ease' }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                                    <div style={{ fontWeight: 900, fontSize: '1.05rem', color: 'var(--text-primary)' }}>{order.deal.itemName}</div>
                                    <div style={{ color: 'var(--primary)', fontWeight: 900, background: 'var(--gray-100)', padding: '4px 12px', borderRadius: 20 }}>{order.bookedQuantity} {isRTL ? 'قطع' : 'pcs'}</div>
                                </div>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 600 }}>
                                    {isRTL ? '👤 المشتري:' : '👤 Buyer:'}{' '}
                                    <span style={{ color: 'var(--text-primary)', fontWeight: 800 }}>
                                        {(order as any).userName || (order.userId ? order.userId.substring(0, 8) + '…' : '—')}
                                    </span>
                                    {order.userId && (
                                        <button type="button"
                                            onClick={() => setReportBuyer({ id: order.userId, name: (order as any).userName })}
                                            title={isRTL ? 'إبلاغ عن المشتري للإدارة' : 'Report this buyer to admin'}
                                            style={{ marginInlineStart: 10, background: 'rgba(220,38,38,0.10)', color: '#dc2626', border: 'none', padding: '3px 10px', borderRadius: 10, fontWeight: 800, fontSize: '0.75rem', cursor: 'pointer' }}>
                                            🚩 {isRTL ? 'إبلاغ' : 'Report'}
                                        </button>
                                    )}
                                    {(() => {
                                        // v11.19 — masked phone call. The merchant no
                                        // longer sees the raw number; instead a button
                                        // labelled "📞 اتصال" opens a confirm prompt
                                        // and only then triggers the tel: dialer
                                        // (where the OS dialer naturally shows the
                                        // number). After completion + 2h, the button
                                        // disappears entirely so old orders can't be
                                        // mined for buyer phone numbers.
                                        const phone = (order as any).userPhone as string | undefined;
                                        if (!phone) return null;
                                        const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
                                        const completedAt = (order as any).completedAt as number | undefined;
                                        const hidden = order.status === 'completed'
                                            && completedAt
                                            && (Date.now() - completedAt) > TWO_HOURS_MS;
                                        if (hidden) return null;
                                        const buyerName = (order as any).userName as string | undefined;
                                        return (
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    const ok = await customConfirm(
                                                        isRTL
                                                            ? `هل تريد الاتصال بـ${buyerName ? ' «' + buyerName + '»' : 'المشتري'}؟`
                                                            : `Call ${buyerName ? buyerName : 'this buyer'}?`
                                                    );
                                                    if (ok) {
                                                        window.location.href = `tel:${phone}`;
                                                    }
                                                }}
                                                title={isRTL ? 'اتصال بالمشتري (الرقم لا يظهر في التطبيق)' : 'Call buyer (number is hidden in the app)'}
                                                style={{
                                                    marginInlineStart: 10,
                                                    background: 'rgba(2,132,199,0.12)',
                                                    color: '#0284c7',
                                                    fontWeight: 900,
                                                    border: '1px solid rgba(2,132,199,0.25)',
                                                    padding: '4px 12px',
                                                    borderRadius: 12,
                                                    fontSize: '0.78rem',
                                                    cursor: 'pointer',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: 4,
                                                }}
                                            >
                                                📞 {isRTL ? 'اتصال' : 'Call'}
                                            </button>
                                        );
                                    })()}
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
                                    <div style={{ marginBottom: 12, padding: '12px 16px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: 12, borderRight: isRTL ? '4px solid #3b82f6' : 'none', borderLeft: !isRTL ? '4px solid #3b82f6' : 'none' }}>
                                        <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#1e40af', marginBottom: 4 }}>
                                            📝 {isRTL ? 'ملاحظات المشتري:' : 'Buyer Notes:'}
                                        </div>
                                        <div style={{ fontSize: '1rem', fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                                            {order.notes}
                                        </div>
                                    </div>
                                )}
                                {order.merchantNote && (
                                    <div style={{ marginBottom: 16, padding: '12px 16px', background: 'rgba(245, 158, 11, 0.2)', borderRadius: 12, borderRight: isRTL ? '4px solid #f59e0b' : 'none', borderLeft: !isRTL ? '4px solid #f59e0b' : 'none' }}>
                                        <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#d97706', marginBottom: 4 }}>
                                            💬 {isRTL ? 'ملاحظتك للمشتري:' : 'Your note to buyer:'}
                                        </div>
                                        <div style={{ fontSize: '1rem', fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                                            {order.merchantNote}
                                        </div>
                                    </div>
                                )}
                                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                    {order.status === 'pending' && (
                                        <button onClick={async () => {
                                            const note = await customPrompt(isRTL ? 'اكتب ملاحظة للمشتري (اختياري):' : 'Write a note to the buyer (optional):');
                                            acknowledgeBooking(order.barcode, note || undefined);
                                        }}
                                            style={{ width: '100%', padding: '12px', borderRadius: 16, background: 'linear-gradient(135deg, #059669, #047857)', color: 'white', fontWeight: 800, border: 'none', cursor: 'pointer', marginBottom: 8, boxShadow: '0 4px 12px rgba(5, 150, 105, 0.25)' }}>
                                            {isRTL ? 'تأكيد استلام الطلب 📦' : 'Confirm Receipt of Order 📦'}
                                        </button>
                                    )}
                                    {order.status === 'acknowledged' && (
                                        <div style={{ width: '100%', padding: '10px', borderRadius: 12, background: 'var(--gray-100)', color: 'var(--text-primary)', fontWeight: 800, textAlign: 'center', marginBottom: 8, fontSize: '0.85rem' }}>
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
                                {(order.status === 'pending' || order.status === 'acknowledged') && (
                                    <button onClick={async () => {
                                        const ok = await customConfirm(isRTL
                                            ? '⚠️ سيتم إلغاء الطلب نهائياً وإعادة الكمية للمخزون، وسيُبلَّغ المشتري. هل أنت متأكد؟'
                                            : '⚠️ This will permanently cancel the order, restore the stock and notify the buyer. Are you sure?');
                                        if (!ok) return;
                                        cancelBooking(order.barcode);
                                        customAlert(isRTL ? 'تم إلغاء الطلب بنجاح' : 'Order Cancelled Successfully');
                                    }}
                                        style={{ width: '100%', padding: '12px', borderRadius: 16, background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.35)', fontWeight: 800, color: 'var(--danger)', cursor: 'pointer', marginTop: 10 }}>
                                        {isRTL ? '❌ إلغاء الطلب' : '❌ Cancel Order'}
                                    </button>
                                )}
                                {/* Seller↔Buyer chat thread (3+3). Lives at the bottom of
                                    each active order card so the seller sees buyer messages
                                    and can reply without leaving the dashboard. */}
                                <BookingThread barcode={order.barcode} myRole="seller" />
                            </div>
                        )) : (
                            <div style={{ textAlign: 'center', padding: 40, opacity: 0.5 }}>{isRTL ? 'لا توجد طلبات نشطة حالياً' : 'No active orders'}</div>
                        )}
                    </div>
                ) : view === 'insights' ? (
                    <SellerAnalytics myDeals={myDeals} myOrders={myOrders} isRTL={isRTL} />
                ) : view === 'reviews' ? (
                    // Reviews tab — aggregates every rating across this
                    // seller's deals into one feed with a Facebook-style
                    // inline reply box per row. Uses `addReply` from
                    // AppContext, which already routes to the
                    // `set_rating_reply` RPC (SECURITY DEFINER, only the
                    // store owner can write the reply column).
                    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {(() => {
                            const allRatings = myDeals.flatMap(d =>
                                (d.ratings || []).map(r => ({ ...r, dealId: d.id, dealName: (d as any).itemName || (d as any).title || '' }))
                            ).sort((a: any, b: any) => {
                                const ta = new Date(a.createdAt || a.date || 0).getTime();
                                const tb = new Date(b.createdAt || b.date || 0).getTime();
                                return tb - ta;
                            });

                            if (allRatings.length === 0) {
                                return (
                                    <div style={{ textAlign: 'center', padding: 40, opacity: 0.6 }}>
                                        <div style={{ fontSize: '3rem', marginBottom: 10 }}>⭐</div>
                                        <div style={{ fontWeight: 800, color: 'var(--text-secondary)' }}>
                                            {isRTL ? 'لا توجد تقييمات على عروضك بعد.' : 'No reviews on your deals yet.'}
                                        </div>
                                    </div>
                                );
                            }

                            return allRatings.map((r: any) => {
                                const isEditing = activeReplyId === r.id;
                                return (
                                <div key={r.id} style={{
                                    background: 'var(--card-bg)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: 18,
                                    padding: 16,
                                    boxShadow: 'var(--shadow-sm)'
                                }}>
                                    {/* Reviewer header */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                        <span style={{ fontWeight: 900, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{r.userName || (isRTL ? 'مستخدم' : 'User')}</span>
                                        <span style={{ color: '#f59e0b', fontSize: '0.9rem' }}>{'★'.repeat(r.score)}{'☆'.repeat(5 - r.score)}</span>
                                    </div>

                                    {/* Which deal this is on */}
                                    {r.dealName && (
                                        <div style={{ fontSize: '0.72rem', color: 'var(--primary)', fontWeight: 800, marginBottom: 6 }}>🏷️ {r.dealName}</div>
                                    )}

                                    {/* The review text */}
                                    <p style={{ color: 'var(--text-primary)', fontSize: '0.9rem', lineHeight: 1.6, fontWeight: 500, margin: '6px 0' }}>{r.comment}</p>

                                    {/* Date */}
                                    <div style={{ fontSize: '0.7rem', color: 'var(--gray-400)', fontWeight: 600, marginBottom: 8 }}>
                                        {(r.createdAt || r.date) ? new Date(r.createdAt || r.date).toLocaleString(isRTL ? 'ar-SA' : 'en-US') : ''}
                                    </div>

                                    {/* Existing reply — hidden while editing so the textarea
                                        below takes its place (no double-display). */}
                                    {r.reply && !isEditing && (
                                        <div style={{
                                            marginTop: 10,
                                            padding: 12,
                                            background: 'var(--body-bg)',
                                            borderRadius: 12,
                                            borderRight: isRTL ? '3px solid var(--primary)' : 'none',
                                            borderLeft: !isRTL ? '3px solid var(--primary)' : 'none'
                                        }}>
                                            <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--primary)', marginBottom: 4, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                                <span>💬 {isRTL ? 'ردك:' : 'Your reply:'}</span>
                                                <div style={{ display: 'flex', gap: 8 }}>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setReplyDrafts(prev => ({ ...prev, [r.id]: r.reply || '' }));
                                                            setActiveReplyId(r.id);
                                                        }}
                                                        style={{ background: 'none', border: 'none', color: 'var(--primary)', fontWeight: 800, fontSize: '0.72rem', cursor: 'pointer' }}
                                                    >
                                                        ✏️ {isRTL ? 'تعديل' : 'Edit'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={async () => {
                                                            const ok = await customConfirm(isRTL ? 'حذف هذا الردّ؟' : 'Remove this reply?');
                                                            if (ok) await addReply(r.dealId, r.id, '');
                                                        }}
                                                        style={{ background: 'none', border: 'none', color: 'var(--gray-400)', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer' }}
                                                    >
                                                        ✕ {isRTL ? 'حذف الردّ' : 'Remove'}
                                                    </button>
                                                </div>
                                            </div>
                                            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0, fontWeight: 600 }}>{r.reply}</p>
                                        </div>
                                    )}

                                    {/* Compose UI — handles both first-reply and edit. */}
                                    {isEditing && (
                                        <div style={{ marginTop: 10 }}>
                                            <textarea
                                                value={replyDrafts[r.id] || ''}
                                                onChange={e => setReplyDrafts({ ...replyDrafts, [r.id]: e.target.value })}
                                                placeholder={isRTL ? 'اكتب ردك على هذا التعليق...' : 'Write your reply...'}
                                                style={{ width: '100%', padding: 12, borderRadius: 12, border: '1.5px solid var(--gray-200)', minHeight: 70, outline: 'none', resize: 'vertical', fontSize: '0.9rem' }}
                                            />
                                            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                                <button
                                                    type="button"
                                                    onClick={async () => {
                                                        const text = (replyDrafts[r.id] || '').trim();
                                                        if (!text) return;
                                                        await addReply(r.dealId, r.id, text);
                                                        setReplyDrafts(prev => { const n = { ...prev }; delete n[r.id]; return n; });
                                                        setActiveReplyId(null);
                                                    }}
                                                    style={{ flex: 1, padding: '10px', borderRadius: 12, background: 'var(--primary)', color: 'white', fontWeight: 800, border: 'none', fontSize: '0.9rem', cursor: 'pointer' }}
                                                >
                                                    {r.reply ? (isRTL ? '💾 حفظ التعديل' : '💾 Save edit') : (isRTL ? '💬 إرسال الردّ' : '💬 Send reply')}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setActiveReplyId(null);
                                                        setReplyDrafts(prev => { const n = { ...prev }; delete n[r.id]; return n; });
                                                    }}
                                                    style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--gray-100)', color: 'var(--text-secondary)', fontWeight: 800, border: 'none', fontSize: '0.9rem', cursor: 'pointer' }}
                                                >
                                                    {isRTL ? 'إلغاء' : 'Cancel'}
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Reply CTA — only when no reply yet AND not editing. */}
                                    {!r.reply && !isEditing && (
                                        <button
                                            type="button"
                                            onClick={() => setActiveReplyId(r.id)}
                                            style={{ marginTop: 6, padding: '6px 14px', borderRadius: 10, background: 'var(--body-bg)', border: '1px solid var(--gray-200)', color: 'var(--primary)', fontSize: '0.8rem', fontWeight: 800, cursor: 'pointer' }}
                                        >
                                            💬 {isRTL ? 'الردّ على هذا التعليق' : 'Reply to this review'}
                                        </button>
                                    )}
                                </div>
                                );
                            });
                        })()}
                    </div>
                ) : view === 'form' ? (
                    // Form tab is active but the seller's subscription isn't.
                    // Previously this fell through to the Scanner panel below,
                    // which made tapping "إضافة" look like it opened Scanner.
                    <div style={{ textAlign: 'center', padding: '20px 0' }}>
                        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 24, padding: 30, boxShadow: 'var(--shadow)' }}>
                            <div style={{ fontSize: '4rem', marginBottom: 16 }}>🔒</div>
                            <h3 style={{ fontSize: '1.2rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 8 }}>
                                {isRTL ? 'الاشتراك مطلوب لإضافة عروض' : 'Subscription Required'}
                            </h3>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600, marginBottom: 24, lineHeight: 1.6 }}>
                                {isRTL
                                    ? 'لم نجد اشتراكاً نشطاً لمتجرك. فعّل اشتراكك أو تواصل مع الإدارة لتفعيل تجربتك المجانية.'
                                    : 'No active subscription found for your store. Activate your plan or contact admin to enable a free trial.'}
                            </p>
                            <button
                                onClick={() => history.push('/subscription')}
                                style={{
                                    width: '100%', padding: '16px', borderRadius: 16,
                                    background: 'linear-gradient(135deg, var(--primary), var(--primary-dark))',
                                    color: 'white', fontWeight: 900, border: 'none', fontSize: '1rem',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10
                                }}
                            >
                                <span>💳</span> {isRTL ? 'إدارة الاشتراك' : 'Manage Subscription'}
                            </button>
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
            {cropQueue.length > 0 && (
                <ImageCropEditor
                    file={cropQueue[0].file}
                    dataUrl={cropQueue[0].dataUrl}
                    naturalW={cropQueue[0].naturalW}
                    naturalH={cropQueue[0].naturalH}
                    queueIndex={cropIndex + 1}
                    queueTotal={cropIndex + cropQueue.length}
                    isRTL={isRTL}
                    onApply={(cropped) => {
                        // v10.66 — advance the queue SYNCHRONOUSLY so the
                        // editor unmounts (or swaps to the next photo)
                        // immediately. The upload runs in the background;
                        // if the seller is processing several photos in
                        // a row they no longer have to wait for each
                        // upload to complete before the next crop appears.
                        // This also kills the duplicate-photo bug where
                        // a slow upload kept the editor visible long
                        // enough for an impatient seller to tap "Apply"
                        // again.
                        advanceCropQueue(false);
                        uploadCroppedFile(cropped);
                    }}
                    onSkip={() => {
                        // Capture the original File before advancing —
                        // after advanceCropQueue() React has scheduled a
                        // setCropQueue update, and even though the closure
                        // here still sees the old array, capturing once
                        // is clearer.
                        const original = cropQueue[0].file;
                        advanceCropQueue(false);
                        uploadCroppedFile(original);
                    }}
                    onCancel={() => {
                        advanceCropQueue(true);
                    }}
                />
            )}
            {showCamera && (
                <CameraCapture
                    maxShots={Math.max(0, 4 - images.length - cropQueue.length)}
                    isRTL={isRTL}
                    onClose={() => setShowCamera(false)}
                    onCapture={uploadCroppedFile}
                    onPickStudio={() => {
                        // Open the OS gallery SYNCHRONOUSLY inside this tap.
                        // The old setTimeout() broke iOS user-activation, so
                        // Safari collapsed the multi-select picker to a SINGLE
                        // photo (the "studio only picks one" regression — it
                        // used to grab up to 4 like WhatsApp). The hidden
                        // <input multiple> lives in the form, which is still
                        // mounted under the camera portal, so its ref is valid
                        // right now. CameraCapture already stopped its stream
                        // before calling this; just close the camera after.
                        fileInputRef.current?.click();
                        setShowCamera(false);
                    }}
                />
            )}
            {reportBuyer && (
                <ReportDialog
                    reportedId={reportBuyer.id}
                    reportedRole="buyer"
                    reportedName={reportBuyer.name}
                    isRTL={isRTL}
                    onClose={() => setReportBuyer(null)}
                />
            )}
            <BottomNav />
        </div>
    );
};

export default SellerDashboard;
