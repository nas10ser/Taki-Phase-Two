import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Deal, getLocation, CITIES } from '../data/mock';
import { getDistance, normalizeArabicNumerals, generateBarcode, getCurrentPositionSafe, Sponsor } from '../utils/helpers';
import { storageService } from '../services/storageService';
import { dealRepository } from '../repositories/dealRepository';
import { userRepository } from '../repositories/userRepository';
import { authService, UserProfile } from '../services/authService';
import { dealService } from '../services/dealService';
import { notificationRepository } from '../repositories/notificationRepository';
import { bookingRepository } from '../repositories/bookingRepository';
import { branchRepository, StoreBranch } from '../repositories/branchRepository';
import { sponsorRepository } from '../repositories/sponsorRepository';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { SmartAlertRule } from '../services/authService';
import { pushService } from '../services/pushService';
import { realtimeService } from '../services/realtimeService';
import { supabase } from '../services/supabaseClient';
import { readSnapshot, writeSnapshot, clearSnapshots } from '../utils/snapshotCache';

interface StoreProfile {
    phone?: string;
    contactPhone?: string;
    email?: string;
    avatar?: string;
    avatar_url?: string;
    bio?: string;
    address?: string;
    subscription_plan?: string;
    subscription_expires_at?: string;
    discount_percentage?: number;
    is_pinned?: boolean;
    max_branches?: number;
}

interface TopLocation {
    region: string;
    city: string;
    mall: string;
}

// The customer's home city — chosen once on first open (GPS or manual pick),
// persisted, and used by Home to rank deals from that city outward. Distinct
// from `topLocation` (the explicit dropdown filter) so the dropdowns stay on
// "All" while the home-city ranking quietly applies.
interface HomeCity {
    regionId: string;
    cityId: string;
}
const HOME_CITY_KEY = 'taki_home_city';
const readHomeCity = (): HomeCity | null => {
    try {
        const raw = localStorage.getItem(HOME_CITY_KEY);
        if (!raw) return null;
        const v = JSON.parse(raw);
        return v && v.cityId ? v : null;
    } catch { return null; }
};

interface Notification {
    id: string;
    userId: string;
    title: { ar: string, en: string };
    body: { ar: string, en: string };
    type: 'booking' | 'deal' | 'system' | 'rating' | 'follow' | 'marketing' | 'report';
    isRead: boolean;
    createdAt: number;
    metadata?: any;
}

interface AppContextType {
    language: 'ar' | 'en';
    setLanguage: (lang: 'ar' | 'en') => void;
    deals: Deal[];
    loading: boolean;
    /** True once the initial Supabase auth check resolves. Use this in
     *  redirect logic instead of `!user` so refreshed protected routes
     *  don't bounce logged-in users to home before hydration. */
    isAuthReady: boolean;
    addDeal: (deal: Deal) => Promise<void>;
    updateDeal: (deal: Deal) => Promise<boolean>;
    updateDealStock: (dealId: string, newQuantity: number | 'unlimited') => Promise<void>;
    deleteDeal: (id: string) => Promise<void>;
    user: any;
    logout: () => void;
    deleteAccount: () => void;
    favorites: string[];
    toggleFavorite: (dealId: string) => Promise<void>;
    followedMerchants: string[];
    toggleFollowMerchant: (merchantId: string) => Promise<void>;
    blockedMerchants: string[];
    toggleBlockMerchant: (merchantId: string) => Promise<void>;
    notifications: Notification[];
    addNotification: (userId: string, title: { ar: string, en: string }, body: { ar: string, en: string }, type: Notification['type'], metadata?: any) => Promise<void>;
    markNotifRead: (id: string) => void;
    addRating: (dealId: string, ratingData: { score: number, comment: string }) => Promise<boolean>;
    addReply: (dealId: string, ratingId: string, reply: string) => Promise<void>;
    toggleRatingLike: (dealId: string, ratingId: string) => Promise<void>;
    removeRating: (dealId: string, ratingId: string) => Promise<void>;
    topLocation: TopLocation;
    setTopLocation: (loc: TopLocation) => void;
    homeCity: HomeCity | null;
    setHomeCity: (c: HomeCity | null) => void;
    notifKeywords: string[];
    addNotifKeyword: (kw: string) => void;
    removeNotifKeyword: (kw: string) => void;
    smartAlerts: SmartAlertRule[];
    addSmartAlert: (rule: SmartAlertRule) => Promise<boolean>;
    removeSmartAlert: (idx: number) => Promise<boolean>;
    bookings: any[];
    bookDeal: (deal: Deal, quantity?: number, userId?: string, prepTime?: string, notes?: string) => any;
    cancelBooking: (barcode: string) => void;
    completeBooking: (barcode: string) => void;
    acknowledgeBooking: (barcode: string, note?: string) => void;
    sendBookingMessage: (barcode: string, body: string) => Promise<void>;
    fetchBookingMessages: (barcode: string) => Promise<void>;
    markBookingMessagesRead: (barcode: string) => Promise<void>;
    customPrompt: (message: string) => Promise<string | null>;
    refreshBookings: () => Promise<void>;
    refreshDeals: () => Promise<void>;
    storeProfiles: Record<string, StoreProfile>;
    sponsors: Record<string, Sponsor>;
    updateStoreProfile: (storeId: string, profile: StoreProfile) => void;
    updateProfile: (data: Partial<UserProfile>) => Promise<void>;
    checkMarketingAlerts: (lat?: number, lng?: number) => void;
    liveLocation: { lat: number; lng: number } | null;
    locationPermission: 'unknown' | 'granted' | 'prompt' | 'denied' | 'unsupported';
    requestLiveLocation: () => Promise<boolean>;
    darkMode: boolean;
    toggleDarkMode: () => void;
    customAlert: (message: string) => Promise<void>;
    customConfirm: (message: string) => Promise<boolean>;
    // Non-blocking top banner for incoming realtime notifications (booking,
    // message, etc.). Replaces the old blocking center "موافق" box so a
    // merchant with hundreds of orders can keep working. Auto-dismisses.
    inAppBanner: { id: string; title: { ar: string; en: string }; body: { ar: string; en: string }; metadata?: any } | null;
    dismissInAppBanner: () => void;
    // Admin "view-as" impersonation. Reflects what role the UI should
    // render — the underlying user.userType stays unchanged. null = real role.
    viewAs: 'buyer' | 'seller' | null;
    setViewAs: (role: 'buyer' | 'seller' | null) => void;
    effectiveUserType: 'buyer' | 'seller' | 'admin';
    /** Admin "act as user" — v11.16 real session swap. After starting,
     *  the Supabase session IS the target's: every read/write/delete is
     *  authorized as the target. Admin's tokens are saved to localStorage
     *  so stopImpersonating restores them. Non-null = active. */
    impersonating: {
        adminId: string;
        adminName: string;
        targetId: string;
        startedAt: string;
    } | null;
    startImpersonating: (targetUserId: string) => Promise<void>;
    stopImpersonating: () => Promise<void>;
    /** v11.19 — granular admin permissions. `isSuperAdmin` (Nasser) bypasses
     *  every check; staff admins only have the permissions present in
     *  `adminPermissions`. `hasPermission` is the gate every tab / action /
     *  delete button should consult before rendering. */
    isSuperAdmin: boolean;
    adminPermissions: string[];
    hasPermission: (perm: string) => boolean;
    incrementDealView: (dealId: string) => Promise<void>;
    incrementDealClick: (dealId: string) => Promise<void>;
    /** Platform-wide feature flags driven by `platform_settings`. Each flag
     *  is admin-controlled; updates propagate via realtime. */
    platformSettings: { seasonalOffersVisible: boolean; oauthGoogleEnabled: boolean; oauthAppleEnabled: boolean };
    /** Seller's saved branches (store_branches table). Drives the
     *  "📍 لوكيشن سابق" chip picker on Add Deal — each chip lets the
     *  seller adopt that branch's region/city/pin in one tap. */
    branches: StoreBranch[];
    saveBranch: (input: Partial<StoreBranch> & { nameAr: string }) => Promise<StoreBranch | null>;
    removeBranch: (id: string) => Promise<void>;
}


const DATA_VERSION = '4.0'; // Persistence upgrade

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [language, setLanguageState] = useState<'ar' | 'en'>('ar');

    // Hydrate the public deal feed synchronously from the last snapshot so
    // the home screen paints real content on the FIRST frame — before the
    // ~300-500 ms (Tokyo ↔ KSA) network round-trip even starts. The live
    // fetch in initData still runs and overwrites this; the snapshot is a
    // render cache, never the source of truth.
    const [deals, setDeals] = useState<Deal[]>(() => readSnapshot<Deal[]>('deals') || []);
    const dealsRef = useRef<Deal[]>(deals);
    useEffect(() => { dealsRef.current = deals; }, [deals]);


    // Tracks deals the seller (or any local action) just wrote, so the
    // realtime echo can't clobber the optimistic status with a stale
    // packet — the recurring "pause flips back to active" bug. Each entry
    // is a per-deal timestamp; entries older than the guard window are
    // ignored.
    const recentLocalDealWritesRef = useRef<Map<string, number>>(new Map());
    const LOCAL_WRITE_GUARD_MS = 5000;
    const markLocalDealWrite = useCallback((dealId: string) => {
        recentLocalDealWritesRef.current.set(dealId, Date.now());
    }, []);
    const isRecentLocalDealWrite = useCallback((dealId: string) => {
        const ts = recentLocalDealWritesRef.current.get(dealId);
        if (!ts) return false;
        if (Date.now() - ts > LOCAL_WRITE_GUARD_MS) {
            recentLocalDealWritesRef.current.delete(dealId);
            return false;
        }
        return true;
    }, []);
    const [user, setUser] = useState<any>(() => {
        try {
            return authService.getUser();
        } catch (e) {
            return null;
        }
    });
    // Admin "act as user" — v11.16 real session swap. The admin's tokens
    // are saved to localStorage before swapping; the Supabase session is
    // replaced with the target's via verifyOtp (edge function admin-impersonate
    // returns the hashed_token). After the swap every Supabase call from
    // this browser is authorized as the target — they can post, delete,
    // message, edit DB rows just as the target would. `impersonating` holds
    // the admin's identity for the exit banner.
    const [impersonating, setImpersonating] = useState<{
        adminId: string; adminName: string; targetId: string; startedAt: string;
    } | null>(() => {
        try {
            // Clear leftover v11.15 keys (deprecated by v11.16 real-swap).
            localStorage.removeItem('TAKI_IMPERSONATE_TARGET');
            localStorage.removeItem('TAKI_IMPERSONATE_ADMIN');
            const raw = localStorage.getItem('TAKI_IMPERSONATION_SESSION');
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return {
                adminId: parsed.adminId,
                adminName: parsed.adminName,
                targetId: parsed.targetId,
                startedAt: parsed.startedAt,
            };
        } catch { return null; }
    });
    // v11.17: drives the banner exit-button spinner + double-tap guard.
    const [stoppingImp, setStoppingImp] = useState(false);
    const stoppingImpRef = useRef(false);
    // True once the initial Supabase session check has resolved (success OR
    // failure). Distinguishes "still hydrating" from "definitively a guest".
    // Without this, AuthRedirector kicks logged-in admins off /admin on
    // refresh because user is briefly null while the session loads.
    const [isAuthReady, setIsAuthReady] = useState<boolean>(false);
    // Tracks the user id we last fully hydrated on an explicit sign-in.
    // Supabase JS can re-fire SIGNED_IN on tab focus / token reload; without
    // this guard a single focus would re-pull every list (the refetch storm
    // behind "الموقع ثقيل"). Cleared on sign-out so a re-login re-hydrates.
    const lastSignInHydratedIdRef = useRef<string | null>(null);
    const [favorites, setFavorites] = useState<string[]>([]);
    const favoritesRef = useRef<string[]>([]);
    useEffect(() => { favoritesRef.current = favorites; }, [favorites]);
    const [followedMerchants, setFollowedMerchants] = useState<string[]>([]);
    const [blockedMerchants, setBlockedMerchants] = useState<string[]>([]);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [bookings, setBookings] = useState<any[]>([]);
    const [branches, setBranches] = useState<StoreBranch[]>([]);

    // Status progression rank for reconciliation — higher = more advanced.
    // This prevents confirmed 'completed' or 'cancelled' states from being reverted
    // by stale or out-of-order Realtime updates (e.g. from a previous acknowledgement broadcast).
    const STATUS_RANK: Record<string, number> = {
        pending: 0,
        acknowledged: 1,
        completed: 2,
        cancelled: 2
    };

    const [promptConfig, setPromptConfig] = useState<{message: string, resolve: (val: string | null) => void} | null>(null);

    const customPrompt = useCallback((message: string): Promise<string | null> => {
        return new Promise(resolve => {
            setPromptConfig({ message, resolve });
        });
    }, []);

    const reconcileStatus = useCallback((localStatus: string, remoteStatus: string) => {
        return (STATUS_RANK[localStatus] || 0) >= (STATUS_RANK[remoteStatus] || 0) ? localStatus : remoteStatus;
    }, []);
    
    // Custom Dialog State
    const [dialogConfig, setDialogConfig] = useState<{type: 'alert'|'confirm', message: string, resolve: (val: any) => void} | null>(null);

    // Post-purchase rating box: opens automatically for the BUYER the moment
    // their booking is marked completed (seller scanned the QR). Distinct
    // from the (removed) booking spam box — this is a one-time "rate the
    // store" prompt the owner explicitly asked for.
    const [ratingPrompt, setRatingPrompt] = useState<{ barcode: string; dealId: string; storeName: string } | null>(null);
    const promptedRatingRef = useRef<Set<string>>(new Set());
    const [ratingStars, setRatingStars] = useState(5);
    const [ratingComment, setRatingComment] = useState('');
    const [ratingSubmitting, setRatingSubmitting] = useState(false);

    // Non-blocking realtime banner (booking/message). One slot — the newest
    // replaces the previous; the <InAppBanner> component auto-dismisses it.
    const [inAppBanner, setInAppBanner] = useState<{ id: string; title: { ar: string; en: string }; body: { ar: string; en: string }; metadata?: any } | null>(null);
    const dismissInAppBanner = useCallback(() => setInAppBanner(null), []);

    const customAlert = useCallback((message: string): Promise<void> => {
        return new Promise(resolve => {
            setDialogConfig({ type: 'alert', message, resolve: () => resolve(undefined) });
        });
    }, []);

    const customConfirm = useCallback((message: string): Promise<boolean> => {
        return new Promise(resolve => {
            setDialogConfig({ type: 'confirm', message, resolve });
        });
    }, []);

    // Refs that always point at the latest dialog callbacks. Used by code paths
    // (e.g. the auth listener) that capture stale closures otherwise.
    const customAlertRef = useRef(customAlert);
    const customConfirmRef = useRef(customConfirm);
    useEffect(() => { customAlertRef.current = customAlert; }, [customAlert]);
    useEffect(() => { customConfirmRef.current = customConfirm; }, [customConfirm]);

    // If we already have a cached deal feed, don't gate the UI behind the
    // full-screen loader — show the cached content instantly and let the
    // background fetch swap it in. Only a true cold start (no snapshot)
    // shows the spinner.
    const [loading, setLoading] = useState(() => !(readSnapshot<Deal[]>('deals') || []).length);

    const [topLocation, setTopLocationState] = useState<TopLocation>({ region: '', city: '', mall: '' });
    const [homeCity, setHomeCityState] = useState<HomeCity | null>(() => readHomeCity());
    const setHomeCity = useCallback((c: HomeCity | null) => {
        setHomeCityState(c);
        try {
            if (c && c.cityId) localStorage.setItem(HOME_CITY_KEY, JSON.stringify(c));
            else localStorage.removeItem(HOME_CITY_KEY);
        } catch { /* private mode / quota — keep in memory only */ }
    }, []);

    const [notifKeywords, setNotifKeywords] = useState<string[]>([]);
    const [smartAlerts, setSmartAlerts] = useState<SmartAlertRule[]>([]);

    const [storeProfiles, setStoreProfiles] = useState<Record<string, StoreProfile>>(
        () => readSnapshot<Record<string, StoreProfile>>('sellers') || {}
    );

    // v11.23 — active sponsors (راعٍ رسمي), keyed by storeId. Loaded once on
    // mount and refreshed via realtime so an admin grant/revoke reflects live.
    const [sponsors, setSponsors] = useState<Record<string, Sponsor>>({});
    useEffect(() => {
        let alive = true;
        const load = async () => {
            const list = await sponsorRepository.getActive();
            if (!alive) return;
            const map: Record<string, Sponsor> = {};
            for (const s of list) map[s.storeId] = s;
            setSponsors(map);
        };
        load();
        let channel: any;
        (async () => {
            const { supabase } = await import('../services/supabaseClient');
            if (!alive) return;
            channel = supabase
                .channel('sponsors-live')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'sponsors' }, () => { load(); })
                .subscribe();
        })();
        return () => {
            alive = false;
            if (channel) import('../services/supabaseClient').then(({ supabase }) => supabase.removeChannel(channel));
        };
    }, []);

    // Platform-wide feature flags read from `platform_settings`. Defaults are
    // conservative (off) so the UI never accidentally exposes a section before
    // the admin opts in. Realtime listener below keeps every client in sync
    // the instant the admin flips a toggle.
    const [platformSettings, setPlatformSettings] = useState<{
        seasonalOffersVisible: boolean;
        oauthGoogleEnabled: boolean;
        oauthAppleEnabled: boolean;
    }>({ seasonalOffersVisible: false, oauthGoogleEnabled: false, oauthAppleEnabled: false });

    // Load platform settings + subscribe to realtime updates so admin toggles
    // propagate to every open tab without requiring a refresh.
    useEffect(() => {
        let cancelled = false;
        const apply = (key: string, value: any) => {
            if (cancelled) return;
            if (key === 'seasonal_offers_visible') {
                setPlatformSettings(prev => ({ ...prev, seasonalOffersVisible: value === true }));
            } else if (key === 'oauth_google_enabled') {
                setPlatformSettings(prev => ({ ...prev, oauthGoogleEnabled: value === true }));
            } else if (key === 'oauth_apple_enabled') {
                setPlatformSettings(prev => ({ ...prev, oauthAppleEnabled: value === true }));
            }
        };
        (async () => {
            try {
                const { data } = await supabase
                    .from('platform_settings')
                    .select('key, value')
                    .in('key', ['seasonal_offers_visible', 'oauth_google_enabled', 'oauth_apple_enabled']);
                (data || []).forEach((r: any) => apply(r.key, r.value));
            } catch (e) {
                console.warn('Platform settings fetch failed:', e);
            }
        })();
        const channel = supabase
            .channel('platform-settings-sync')
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'platform_settings' },
                (payload: any) => {
                    const row = payload.new || payload.old;
                    if (row?.key) apply(row.key, payload.new?.value ?? row.value);
                }
            )
            .subscribe();
        return () => {
            cancelled = true;
            try { supabase.removeChannel(channel); } catch {}
        };
    }, []);

    const [darkMode, setDarkMode] = useState<boolean>(() => {
        try {
            const stored = localStorage.getItem('TAKI_DARK_MODE');
            if (stored === '1') return true;
            if (stored === '0') return false;
            // first-time visitor: respect OS preference
            if (typeof window !== 'undefined' && window.matchMedia) {
                return window.matchMedia('(prefers-color-scheme: dark)').matches;
            }
        } catch { /* localStorage may be blocked (private mode) */ }
        return false;
    });

    // Admin "view as" — lets an admin preview the app as a buyer or
    // seller without changing their actual role. Only meaningful when
    // user.userType === 'admin'; ignored otherwise.
    const [viewAs, setViewAsState] = useState<'buyer' | 'seller' | null>(() => {
        const stored = localStorage.getItem('TAKI_VIEW_AS');
        return stored === 'buyer' || stored === 'seller' ? stored : null;
    });
    const setViewAs = useCallback((role: 'buyer' | 'seller' | null) => {
        setViewAsState(role);
        if (role) localStorage.setItem('TAKI_VIEW_AS', role);
        else localStorage.removeItem('TAKI_VIEW_AS');
    }, []);

    // Apply dark mode class to document + persist preference
    useEffect(() => {
        if (darkMode) {
            document.documentElement.classList.add('dark-mode');
            document.documentElement.classList.remove('light-mode');
        } else {
            document.documentElement.classList.remove('dark-mode');
            document.documentElement.classList.add('light-mode');
        }
        try { localStorage.setItem('TAKI_DARK_MODE', darkMode ? '1' : '0'); } catch { /* ignore */ }
    }, [darkMode]);

    // Request notification permission on mount and (best-effort) subscribe
    // to Web Push so alerts arrive even when the tab is closed.
    useEffect(() => {
        pushService.ensurePermissionAndSubscribe().catch(() => {});
    }, []);

    const toggleDarkMode = useCallback(() => setDarkMode(prev => !prev), []);

    // Periodic expiry check — every 30s. When a deal crosses its expiry,
    // we flip the local status AND push the change to Supabase so every
    // other device sees the same expiry without waiting for their own
    // timer to fire. The seller's own client wins the race in practice
    // (it sees its own deals first), but any client can make the update.
    useEffect(() => {
        const interval = setInterval(() => {
            setDeals(prevDeals => {
                const now = Date.now();
                const expiringIds: string[] = [];
                const updatedDeals = prevDeals.map(deal => {
                    if (deal.status === 'expired') return deal;
                    const lifespanMs = (deal.expiresInMinutes || 120) * 60 * 1000;
                    if (now > (deal.createdAt + lifespanMs)) {
                        expiringIds.push(deal.id);
                        return { ...deal, status: 'expired' as const };
                    }
                    return deal;
                });
                if (expiringIds.length === 0) return prevDeals;
                // Best-effort server sync — only the seller's RLS allows the
                // write, so other clients silently fail and rely on realtime
                // when the seller's client makes the same flip.
                expiringIds.forEach(id => {
                    const deal = updatedDeals.find(d => d.id === id);
                    if (deal) {
                        dealRepository.save(deal).catch(() => {});
                    }
                });
                return updatedDeals;
            });
        }, 30000);
        return () => clearInterval(interval);
    }, []);

    // Note: REAL-TIME DEAL MATCHING ENGINE moved lower to avoid initialization errors.

    useEffect(() => {
        let isInitializing = false;
        // SAFETY: even if every Supabase call hangs (cold start, dropped
        // packet, RLS misconfig), auth must NEVER block the UI for more than
        // 2.5s. After that we treat the visitor as a guest and let them in.
        const safetyTimer = setTimeout(() => {
            setIsAuthReady(true);
            setLoading(false);
        }, 2500);

        const initData = async () => {
            if (isInitializing) return;
            isInitializing = true;
            try {
                logger.info('🚀 Initializing App Context (Direct Remote Only)...');
                logger.info('📡 Fetching state from remote...');
                setLoading(true);

                // FAST PATH — auth check on its own. As soon as it resolves
                // (success or failure), we flip isAuthReady so protected routes
                // can render without waiting for deals/sellers/notifications.
                userRepository.getCurrentUser()
                    .then(async currentUser => {
                        if (currentUser) {
                            // v11.16: real session swap means Supabase already
                            // reports the target as the current user (when
                            // impersonating). Sanity-check that the stored
                            // impersonation metadata still matches the live
                            // session — if it drifted (admin manually restored
                            // session elsewhere), clear the stale localStorage.
                            try {
                                const raw = localStorage.getItem('TAKI_IMPERSONATION_SESSION');
                                if (raw) {
                                    const parsed = JSON.parse(raw);
                                    if (parsed.targetId && parsed.targetId !== currentUser.id) {
                                        localStorage.removeItem('TAKI_IMPERSONATION_SESSION');
                                        setImpersonating(null);
                                    }
                                }
                            } catch {}
                            logger.info(`👤 Session found: ${currentUser.name}`);
                            setUser(currentUser);
                            // initData is now the single owner of cold-load
                            // hydration. The profile is already in hand, so
                            // populate the follow/keyword/smart-alert/language
                            // slices here with ZERO extra network calls. The
                            // auth listener used to re-do all of this on
                            // INITIAL_SESSION (every page open) — that duplicate
                            // pass is now skipped (see onAuthStateChange).
                            setFollowedMerchants(currentUser.followedMerchants || []);
                            setBlockedMerchants((currentUser as any).blockedMerchants || []);
                            setNotifKeywords(currentUser.notifKeywords || []);
                            setSmartAlerts((currentUser as any).smartAlerts || []);
                            const cuLang = (currentUser as any).preferredLang;
                            if (cuLang === 'ar' || cuLang === 'en') {
                                setLanguageState(cuLang);
                                document.dir = cuLang === 'ar' ? 'rtl' : 'ltr';
                            }
                            // Mark this id as hydrated so a SIGNED_IN that
                            // Supabase re-fires on focus doesn't re-pull.
                            lastSignInHydratedIdRef.current = currentUser.id;
                            const uid = currentUser.id;

                            // Instant paint of the user's own lists from the
                            // last snapshot (keyed by uid so a shared device
                            // never shows the previous account). The live
                            // fetch below overwrites these.
                            const snapFav = readSnapshot<string[]>('fav_' + uid);
                            if (snapFav) setFavorites(snapFav);
                            const snapNotif = readSnapshot<Notification[]>('notif_' + uid);
                            if (snapNotif) setNotifications(snapNotif);
                            const snapBk = readSnapshot<any[]>('bk_' + uid);
                            if (snapBk) setBookings(snapBk);

                            // Background hydration of user-specific data — does
                            // not gate isAuthReady; pages render immediately.
                            Promise.allSettled([
                                userRepository.getFavorites().then(f => { setFavorites(f); writeSnapshot('fav_' + uid, f); }),
                                notificationRepository.fetchByUserId(uid).then(n => { setNotifications(n); writeSnapshot('notif_' + uid, n); }),
                                import('../repositories/bookingRepository').then(({ bookingRepository }) =>
                                    // Pass the deals we already have so getByUser
                                    // does NOT re-fetch the entire deals + ratings
                                    // tables (a duplicate Tokyo round-trip on the
                                    // critical path).
                                    bookingRepository.getByUser(uid, dealsRef.current).then(b => { setBookings(b); writeSnapshot('bk_' + uid, b); })
                                ),
                                // Sellers/admins use branches for the "📍 لوكيشن سابق"
                                // chip picker. Buyers don't need them — skip the
                                // round-trip for them.
                                (currentUser.userType === 'seller' || currentUser.userType === 'admin')
                                    ? branchRepository.listByMerchant(uid).then(setBranches)
                                    : Promise.resolve(),
                            ]).catch(() => {});
                        }
                    })
                    .catch((err) => console.warn('Auth check failed:', err))
                    .finally(() => {
                        clearTimeout(safetyTimer);
                        setIsAuthReady(true);
                    });

                // PARALLEL — global data fetch. Doesn't block auth gate.
                Promise.allSettled([
                    dealRepository.getAll().then(fetchedDeals => {
                        if (fetchedDeals) {
                            setDeals(fetchedDeals);
                            writeSnapshot('deals', fetchedDeals);
                        }
                    }),
                    userRepository.getAllSellers().then(sellers => {
                        if (sellers) {
                            const profiles: Record<string, any> = {};
                            sellers.forEach(s => { profiles[s.id] = s; });
                            setStoreProfiles(profiles);
                            writeSnapshot('sellers', profiles);
                        }
                    }),
                ]).finally(() => {
                    setLoading(false);
                });
            } catch (error) {
                console.error('❌ Failed to initialize app data:', error);
                clearTimeout(safetyTimer);
                setLoading(false);
                setIsAuthReady(true);
            } finally {
                isInitializing = false;
            }
        };

        initData();

        // SECURITY: Removed window.appContextSetters debug backdoor

        // Supabase Real-Time Auth Listener
        const authListenerPromise = import('../services/supabaseClient').then(({ supabase }) => {
            try {
                const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
                    try {
                        // Explicit sign-out branch — without this, logging out
                        // left `user` populated until a full reload, so the UI
                        // showed the previous account on a guest session.
                        if (event === 'SIGNED_OUT' || (!session?.user && event !== 'INITIAL_SESSION')) {
                            // v11.16: drop impersonation state too. Note this
                            // ALSO fires when the admin gracefully stops
                            // impersonating — but `stopImpersonating` already
                            // restored admin's session BEFORE this listener
                            // would fire SIGNED_OUT, so this branch only runs
                            // for an actual sign-out / token expiry.
                            try {
                                localStorage.removeItem('TAKI_IMPERSONATION_SESSION');
                            } catch {}
                            setImpersonating(null);
                            setUser(null);
                            authService.setUser(null as any);
                            setBookings([]);
                            setNotifications([]);
                            setFavorites([]);
                            setFollowedMerchants([]);
                            setBranches([]);
                            setIsAuthReady(true);
                            // Re-login (even same account) must re-hydrate.
                            lastSignInHydratedIdRef.current = null;
                            // Wipe every cached snapshot so a shared device
                            // never paints the previous account's lists.
                            clearSnapshots();
                            return;
                        }
                        if (session?.user) {
                            const spUser = session.user;
                            const meta = spUser.user_metadata || {};

                            // Optimistic profile from the JWT — this is enough to
                            // unlock the UI immediately. We rebuild from the real
                            // DB row in the background and merge once it lands, so
                            // a slow `users` query (RLS, cold start, dropped
                            // packet) never leaves the login button hanging.
                            const optimisticProfile = {
                                id: spUser.id,
                                name: meta.name || 'مستخدم',
                                phone: meta.phone || spUser.phone || '',
                                email: meta.email || spUser.email || '',
                                userType: meta.user_type || 'buyer',
                                shop: meta.shop || '',
                                contactPhone: meta.contact_phone || meta.phone || spUser.phone || '',
                                address: meta.address || '',
                                savings: 0,
                                bookingsCount: 0,
                                notifKeywords: [],
                                smartAlerts: [],
                                preferredLang: 'ar',
                                followedMerchants: [],
                                blockedMerchants: []
                            };

                            setUser((prev: any) => {
                                if (prev && prev.id !== optimisticProfile.id) {
                                    setBookings([]);
                                    setNotifications([]);
                                    setFavorites([]);
                                    setBranches([]);
                                }
                                return prev && prev.id === optimisticProfile.id ? prev : optimisticProfile;
                            });
                            // Mirror to authService memory and unlock the UI
                            // even on the very first event — without this, a
                            // refreshed protected route could still bounce a
                            // signed-in user to '/' before the canonical row
                            // arrives.
                            authService.setUser(optimisticProfile as any);
                            setIsAuthReady(true);
                            clearTimeout(safetyTimer);

                            // ── Heavy hydration gate ───────────────────────
                            // The lightweight optimistic profile above already
                            // unlocks the UI correctly. The expensive part
                            // (canonical findById + soft-delete recovery RPC +
                            // re-pull of bookings/notifications/favorites/
                            // followed/branches) must run ONLY on an explicit
                            // sign-in, and only once per signed-in id:
                            //  • INITIAL_SESSION  → initData() already owns the
                            //    full cold-load hydration (no duplicate).
                            //  • TOKEN_REFRESHED  → fires every ~50 min & on
                            //    some focus events — must never refetch.
                            //  • USER_UPDATED     → fires on every
                            //    supabase.auth.updateUser (e.g. the favorites
                            //    metadata mirror) — must never refetch.
                            // This single gate removes the bulk of the
                            // "الموقع ثقيل" duplicate-request storm. Realtime +
                            // the focus/visibility re-sync keep data live.
                            if (event !== 'SIGNED_IN' || lastSignInHydratedIdRef.current === spUser.id) {
                                return;
                            }
                            lastSignInHydratedIdRef.current = spUser.id;

                            // Fetch the canonical profile in the background — never
                            // block the auth callback on it.
                            const { userRepository: ur } = await import('../repositories/userRepository');
                            const existingProfile = await ur.findById(spUser.id).catch(() => null);

                            const profile = existingProfile || optimisticProfile;

                            if (existingProfile) {
                                setUser(existingProfile);
                                setFollowedMerchants(existingProfile.followedMerchants || []);
                                setBlockedMerchants((existingProfile as any).blockedMerchants || []);
                            }

                            // 30-day soft-delete recovery: if the user signs in while
                            // their account is in the grace window, prompt them to
                            // restore it. (migration v9.17 / soft_delete_my_account)
                            try {
                                const { data: status } = await supabase.rpc('get_my_account_status');
                                const row = Array.isArray(status) ? status[0] : status;
                                if (row?.deleted_at) {
                                    const daysLeft = Number(row.days_left) || 0;
                                    const wantsRestore = await customConfirmRef.current(
                                        `هذا الحساب محذوف وسيُمحى نهائياً خلال ${daysLeft} يوم. هل تريد استرجاعه الآن؟`
                                    );
                                    if (wantsRestore) {
                                        const { data: restored, error: restoreErr } = await supabase.rpc('restore_my_account');
                                        if (!restoreErr && restored) {
                                            await customAlertRef.current('✅ تم استرجاع حسابك بنجاح');
                                        } else {
                                            await customAlertRef.current('❌ تعذّر استرجاع الحساب — انتهت فترة السماح');
                                        }
                                    } else {
                                        // User declined — sign them back out so the deletion stands.
                                        try { await supabase.auth.signOut(); } catch {}
                                        setUser(null);
                                        return;
                                    }
                                }
                            } catch {}

                            // Background hydration — never await. Each call updates state
                            // independently as it resolves, so the UI renders the new user
                            // immediately and progressively fills in.
                            import('../repositories/bookingRepository').then(({ bookingRepository: br }) =>
                                br.getByUser(spUser.id, dealsRef.current).then(b => { setBookings(b); writeSnapshot('bk_' + spUser.id, b); }).catch(() => {})
                            );
                            import('../repositories/notificationRepository').then(({ notificationRepository: nr }) =>
                                nr.fetchByUserId(spUser.id).then(n => { setNotifications(n); writeSnapshot('notif_' + spUser.id, n); }).catch(() => {})
                            );
                            userRepository.getFavorites().then(f => { setFavorites(f); writeSnapshot('fav_' + spUser.id, f); }).catch(() => {});
                            userRepository.getFollowedMerchants().then(setFollowedMerchants).catch(() => {});
                            // Branches feed the "📍 لوكيشن سابق" chip picker;
                            // only sellers/admins need them.
                            if (profile.userType === 'seller' || profile.userType === 'admin') {
                                branchRepository.listByMerchant(spUser.id).then(setBranches).catch(() => {});
                            } else {
                                setBranches([]);
                            }
                            setNotifKeywords(profile.notifKeywords || []);
                            setSmartAlerts((profile as any).smartAlerts || []);
                            // Hydrate language from server preference
                            const pref = (profile as any).preferredLang;
                            if (pref === 'ar' || pref === 'en') {
                                setLanguageState(pref);
                                document.dir = pref === 'ar' ? 'rtl' : 'ltr';
                            }

                            // Targeted cleanup — keep global-sync alive so
                            // public deal/store updates still flow even when
                            // no one is signed in.
                            const channels = supabase.getChannels();
                            channels
                                .filter((c: any) => typeof c?.topic === 'string' && c.topic.startsWith('realtime:user-sync-'))
                                .forEach((c: any) => supabase.removeChannel(c));
                        }
                    } catch (authError) {
                        console.error('❌ Auth state change error:', authError);
                    }
                });
                return data;
            } catch (listenerError) {
                console.error('❌ Failed to setup auth listener:', listenerError);
                return null;
            }
        });

        return () => {
            clearTimeout(safetyTimer);
            authListenerPromise.then((l: any) => l?.subscription?.unsubscribe?.());
        };
    }, []);



    // ⚡️ STABILIZATION: Safety Timeout to prevent permanent "Loading" hang
    useEffect(() => {
        if (loading) {
            const timer = setTimeout(() => {
                if (loading) {
                    console.warn('⚠️ App initialization taking too long. Forcing loading state to false.');
                    setLoading(false);
                }
            }, 8000); 
            return () => clearTimeout(timer);
        }
    }, [loading]);

    // Removing all storageService effect calls to comply with "No Local Storage" request


    const setTopLocation = useCallback((loc: TopLocation) => {
        setTopLocationState(loc);
    }, []);

    // Sound helper — throttled so local addNotification + realtime INSERT
    // don't double-ping for the same event.
    const lastSoundAtRef = useRef(0);
    const playNotificationSound = useCallback(() => {
        const now = Date.now();
        if (now - lastSoundAtRef.current < 1500) return;
        lastSoundAtRef.current = now;
        try {
            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
            audio.volume = 0.5;
            audio.play().catch(() => {}); // Browser might block auto-play
        } catch (e) {}
    }, []);

    // Notification display helper
    const showRealTimeAlert = useCallback((title: {ar: string, en: string}, body: {ar: string, en: string}) => {
        if ('Notification' in window && Notification.permission === 'granted') {
            const isAr = language === 'ar';
            new Notification(isAr ? title.ar : title.en, {
                body: isAr ? body.ar : body.en,
                icon: '/logo192.png'
            });
        }
        playNotificationSound();
    }, [language, playNotificationSound]);

    const addNotification = useCallback(async (userId: string, title: { ar: string, en: string }, body: { ar: string, en: string }, type: Notification['type'] = 'system', metadata?: any) => {
        const newNotif: Notification = {
            id: (typeof crypto !== 'undefined' && (crypto as any).randomUUID)
                ? (crypto as any).randomUUID()
                : `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`,
            userId,
            title,
            body,
            type,
            metadata,
            isRead: false,
            createdAt: Date.now()
        };

        // Only mirror into local state if the local user is the recipient —
        // otherwise the sender's notif list would accumulate the receiver's
        // alerts (e.g. a buyer would see "New Booking!" notifs that belong to
        // the seller). The recipient's own client picks it up either via
        // their initial fetch or the realtime listener.
        if (user && user.id === userId) {
            setNotifications(prev => {
                const updated = [newNotif, ...prev];
                return updated;
            });
        }

        // Background remote sync — fire-and-forget, the realtime listener on
        // the recipient's side picks it up and pushes a native browser alert.
        notificationRepository.save(newNotif as any).catch(err =>
            console.warn('Notification remote sync deferred:', err?.message || err)
        );

        // Native alert + sound only when the recipient is the local user.
        if (user && user.id === userId) {
            showRealTimeAlert(title, body);
        }
    }, [user, showRealTimeAlert]);

    const toggleFollowMerchant = useCallback(async (merchantId: string) => {
        const newFollows = followedMerchants.includes(merchantId)
            ? followedMerchants.filter(f => f !== merchantId)
            : [...followedMerchants, merchantId];
        
        // 1. Update State (Optimistic)
        setFollowedMerchants(newFollows);
        
        if (user) {
            // 2. Update cached user profile in memory
            const updatedUser = { ...user, followedMerchants: newFollows };
            setUser(updatedUser);
            authService.setUser(updatedUser);
            
            // 3. Update Supabase (Final Truth)
            // Trigger tr_follow_notification (migration v8.6) will handle the notification instantly
            await userRepository.saveProfile(updatedUser);
        }
    }, [followedMerchants, user]);

    // Buyer blocks a merchant: their deals must vanish from Home/Nearby
    // and never trigger a smart-alert notification. The notification side
    // is enforced server-side (handle_deal_smart_notifications /
    // handle_smart_alerts_backfill skip blocked_merchants); the client
    // filters the lists. Blocking a followed store also drops the follow
    // (following a blocked store is contradictory).
    const toggleBlockMerchant = useCallback(async (merchantId: string) => {
        const isBlocked = blockedMerchants.includes(merchantId);
        const newBlocked = isBlocked
            ? blockedMerchants.filter(b => b !== merchantId)
            : [...blockedMerchants, merchantId];
        const newFollows = (!isBlocked && followedMerchants.includes(merchantId))
            ? followedMerchants.filter(f => f !== merchantId)
            : followedMerchants;

        setBlockedMerchants(newBlocked);
        if (newFollows !== followedMerchants) setFollowedMerchants(newFollows);

        if (user) {
            const updatedUser = { ...user, blockedMerchants: newBlocked, followedMerchants: newFollows };
            setUser(updatedUser);
            authService.setUser(updatedUser);
            await userRepository.saveProfile(updatedUser);
        }
    }, [blockedMerchants, followedMerchants, user]);

    const toggleFavorite = useCallback(async (id: string) => {
        const isAdding = !favorites.includes(id);
        const newFavs = isAdding
            ? [...favorites, id]
            : favorites.filter(f => f !== id);
        
        // 1. Update State (Optimistic)
        setFavorites(newFavs);

        // 2. Update Remote (Final Truth)
        await userRepository.setFavorites(newFavs);

        // If favoriting, also follow the merchant for notifications
        if (isAdding) {
            const deal = deals.find(d => d.id === id);
            if (deal && !followedMerchants.includes(deal.storeId)) {
                await toggleFollowMerchant(deal.storeId);
            }
        }
    }, [favorites, deals, followedMerchants, toggleFollowMerchant]);

    const updateStoreProfile = useCallback((storeId: string, profile: StoreProfile) => {
        // Optimistic local update — UI reacts immediately.
        setStoreProfiles(prev => ({ ...prev, [storeId]: { ...prev[storeId], ...profile } }));

        // Persist to DB. Only the seller themselves can write their own row
        // (RLS), so skip the network call for stores owned by someone else.
        if (!user || user.id !== storeId) return;

        const merged: any = {
            ...user,
            contactPhone: profile.contactPhone ?? profile.phone ?? user.contactPhone,
            phone: profile.phone ?? user.phone,
            email: profile.email ?? user.email,
            avatar_url: (profile as any).avatar_url ?? (profile as any).avatar ?? user.avatar_url,
            bio: profile.bio ?? user.bio,
            address: profile.address ?? user.address,
        };
        setUser(merged);
        authService.setUser(merged);
        userRepository.saveProfile(merged).catch(err => {
            console.error('Failed to persist store profile to DB:', err);
        });
    }, [user]);

    const updateProfile = useCallback(async (data: Partial<UserProfile>) => {
        if (!user) return;
        const updated = { ...user, ...data };
        setUser(updated);
        await userRepository.saveProfile(updated);
    }, [user]);

    const checkMarketingAlerts = useCallback(async (lat?: number, lng?: number) => {
        if (!user) return;

        // Skip admin users entirely — pep-talks for sellers should not fire
        // for an admin even when their JWT user_metadata still says 'seller'
        // (legacy from registration). This was the root cause of "زد مبيعاتك"
        // showing on every refresh for admins.
        if (user.userType === 'admin') return;

        // Throttle: once per 24h. DB column `users.last_promo_check_at` is
        // the authoritative source — no local cache (would split-brain across
        // devices and let the same user see the same promo twice).
        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;

        try {
            const { supabase } = await import('../services/supabaseClient');
            const { data: throttleRow } = await supabase
                .from('users')
                .select('last_promo_check_at')
                .eq('id', user.id)
                .maybeSingle();
            if (throttleRow?.last_promo_check_at) {
                const last = new Date(throttleRow.last_promo_check_at).getTime();
                if (now - last < dayMs) return;
            }
        } catch {}

        // Stamp BEFORE creating the notification so a slow network can't
        // bypass the gate. Awaited so the gate is in place before we move on.
        try {
            const { supabase } = await import('../services/supabaseClient');
            await supabase.from('users')
                .update({ last_promo_check_at: new Date(now).toISOString() })
                .eq('id', user.id);
        } catch {}

        try {
            // Fetch active campaigns from Supabase for this user type
            const { promoRepository } = await import('../repositories/promoRepository');
            const city = topLocation.city || undefined;
            const campaigns = await promoRepository.getActiveCampaigns(
                user.userType as 'buyer' | 'seller',
                city
            );

            if (campaigns.length > 0) {
                for (const campaign of campaigns) {
                    const hasSeen = await promoRepository.hasSeenCampaign(campaign.id, user.id);
                    if (!hasSeen) {
                        addNotification(
                            user.id,
                            { ar: campaign.titleAr, en: campaign.titleEn },
                            { ar: campaign.bodyAr, en: campaign.bodyEn },
                            'marketing',
                            {
                                campaignId: campaign.id,
                                imageUrl: campaign.imageUrl,
                                actionUrl: campaign.actionUrl,
                                actionLabelAr: campaign.actionLabelAr,
                                actionLabelEn: campaign.actionLabelEn
                            }
                        );
                        promoRepository.markAsSeen(campaign.id, user.id);
                        return; // Show one campaign at a time to avoid flooding
                    }
                }
            }
        } catch (e) {
            console.warn('Promo campaign fetch failed, falling back to local alerts:', e);
        }

        // ── Fallback: proximity-based alerts if no Supabase campaigns ──
        if (user.userType === 'buyer' && lat && lng) {
            const hasNearby = deals.some(d => {
                const dLoc = getLocation(d.locationId);
                const dLat = d.mapLocation?.lat || dLoc?.lat || 0;
                const dLng = d.mapLocation?.lng || dLoc?.lng || 0;
                return d.status === 'active' && getDistance(lat, lng, dLat, dLng) <= 5;
            });

            if (hasNearby) {
                addNotification(
                    user.id,
                    { ar: '📍 عروض مذهلة حولك الآن!', en: '📍 Amazing deals near you!' },
                    { ar: 'هناك عروض حصرية قريبة منك جداً، اكتشفها الآن ووفر أكثر! 🛍️', en: 'There are exclusive deals very close to you, explore them now and save more! 🛍️' },
                    'marketing'
                );
            }
        } else if (user.userType === 'seller') {
            addNotification(
                user.id,
                { ar: '📈 زد مبيعاتك الآن!', en: '📈 Boost your sales now!' },
                { ar: 'العملاء يبحثون عن عروض جديدة في منطقتك! أضف عرضاً الآن لجذبهم. 🏬', en: 'Customers are looking for new deals in your area! Post a deal now to attract them. 🏬' },
                'marketing'
            );
        }
    }, [user, deals, addNotification, topLocation]);

    // Fire promotional alerts shortly after the user signs in, regardless
    // of whether they ever visit the Nearby page. Uses the 6-hour throttle
    // already inside checkMarketingAlerts so the user is not spammed.
    useEffect(() => {
        if (!user) return;
        const t = setTimeout(() => { checkMarketingAlerts(); }, 4000);
        return () => clearTimeout(t);
    }, [user?.id, checkMarketingAlerts]);

    // ═══════════════════════════════════════════════════════════════════
    //  Live location (shoppers) — world-class, second-by-second tracking.
    //  If geolocation is already permitted we track silently on every app
    //  open (no nagging). Otherwise the UI shows an "enable" prompt. While
    //  the app is open we follow the user as they walk/drive and persist
    //  their position to `users.lat/lng` (throttled) so the platform can
    //  push "deals near you" by proximity — even when they're not looking.
    // ═══════════════════════════════════════════════════════════════════
    const liveUserRef = useRef<any>(null);
    useEffect(() => { liveUserRef.current = user; }, [user]);
    const checkAlertsRef = useRef(checkMarketingAlerts);
    useEffect(() => { checkAlertsRef.current = checkMarketingAlerts; }, [checkMarketingAlerts]);
    const liveWatchRef = useRef<number | null>(null);
    const lastLiveRef = useRef<{ lat: number; lng: number } | null>(null);
    const lastSaveRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
    const liveAlertedRef = useRef(false);
    const [liveLocation, setLiveLocation] = useState<{ lat: number; lng: number } | null>(null);
    const [locationPermission, setLocationPermission] = useState<'unknown' | 'granted' | 'prompt' | 'denied' | 'unsupported'>('unknown');

    // Persist the live fix to the account — throttled so a moving car doesn't
    // hammer the DB: first fix saves immediately, then only after a real move
    // (≥75 m) AND ≥60 s, or a 5-min heartbeat. Sellers are skipped (not shoppers).
    const persistLiveLocation = useCallback(async (lat: number, lng: number) => {
        const u = liveUserRef.current;
        if (!u?.id || u.userType === 'seller') return;
        const last = lastSaveRef.current;
        if (last) {
            const movedM = getDistance(last.lat, last.lng, lat, lng) * 1000;
            const elapsed = Date.now() - last.at;
            if (!((movedM >= 75 && elapsed >= 60_000) || elapsed >= 300_000)) return;
        }
        lastSaveRef.current = { lat, lng, at: Date.now() };
        try { await supabase.from('users').update({ lat, lng }).eq('id', u.id); } catch { /* best-effort */ }
    }, []);

    const startLiveWatch = useCallback(() => {
        if (liveWatchRef.current != null) return;
        if (!('geolocation' in navigator) || !navigator.geolocation.watchPosition) return;
        liveWatchRef.current = navigator.geolocation.watchPosition(
            pos => {
                const lat = pos.coords.latitude, lng = pos.coords.longitude;
                const prev = lastLiveRef.current;
                const moved = prev ? getDistance(prev.lat, prev.lng, lat, lng) * 1000 : Infinity;
                if (!prev || moved >= 8) { lastLiveRef.current = { lat, lng }; setLiveLocation({ lat, lng }); }
                persistLiveLocation(lat, lng);
                if (!liveAlertedRef.current) { liveAlertedRef.current = true; checkAlertsRef.current?.(lat, lng); }
            },
            () => { /* transient error — keep last known fix */ },
            { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
        );
    }, [persistLiveLocation]);

    const stopLiveWatch = useCallback(() => {
        if (liveWatchRef.current != null) { navigator.geolocation.clearWatch(liveWatchRef.current); liveWatchRef.current = null; }
    }, []);

    // Explicit "enable my location" — fires the browser prompt on a user gesture
    // (Safari-safe), then starts continuous tracking. Returns whether it worked.
    const requestLiveLocation = useCallback(async (): Promise<boolean> => {
        if (!('geolocation' in navigator)) { setLocationPermission('unsupported'); return false; }
        try {
            const { lat, lng } = await getCurrentPositionSafe();
            lastLiveRef.current = { lat, lng };
            setLiveLocation({ lat, lng });
            setLocationPermission('granted');
            await persistLiveLocation(lat, lng);
            startLiveWatch();
            return true;
        } catch {
            setLocationPermission('denied');
            return false;
        }
    }, [persistLiveLocation, startLiveWatch]);

    // On app open: a shopper who already granted location is tracked silently
    // (no re-ask). Otherwise we surface the permission state so the UI prompts.
    useEffect(() => {
        const isShopper = !!user && user.userType !== 'seller';
        if (!isShopper) { stopLiveWatch(); liveAlertedRef.current = false; lastSaveRef.current = null; return; }
        if (!('geolocation' in navigator)) { setLocationPermission('unsupported'); return; }
        let cancelled = false;
        let perm: any = null;
        (async () => {
            try {
                if ((navigator as any).permissions?.query) {
                    perm = await (navigator as any).permissions.query({ name: 'geolocation' });
                    if (cancelled) return;
                    setLocationPermission(perm.state);
                    if (perm.state === 'granted') startLiveWatch();
                    perm.onchange = () => {
                        setLocationPermission(perm.state);
                        if (perm.state === 'granted') startLiveWatch(); else stopLiveWatch();
                    };
                } else {
                    setLocationPermission('prompt'); // older Safari has no Permissions API — CTA requests
                }
            } catch { setLocationPermission('prompt'); }
        })();
        return () => { cancelled = true; if (perm) perm.onchange = null; };
    }, [user?.id, user?.userType, startLiveWatch, stopLiveWatch]);

    const markNotifRead = useCallback((id: string) => {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
        // Sync read status to Supabase
        notificationRepository.markAsRead(id);
    }, []);

    const logout = useCallback(async () => {
        // Clear all per-user state instantly so the UI doesn't flash the
        // outgoing account's data while authService.logout() round-trips. The
        // SIGNED_OUT listener also clears, but doing it here closes the gap
        // between click and Supabase responding.
        try {
            localStorage.removeItem('TAKI_IMPERSONATION_SESSION');
        } catch {}
        setImpersonating(null);
        setUser(null);
        setFavorites([]);
        setFollowedMerchants([]);
        setNotifications([]);
        setBookings([]);
        setSmartAlerts([]);
        clearSnapshots();
        // Drop the device's push subscription so the previous account
        // doesn't keep receiving alerts on this hardware.
        pushService.unsubscribe().catch(() => {});
        // Don't await — the UI is already in the logged-out state. Awaiting
        // signOut just delays the next interaction (e.g. typing in the login
        // form) without changing the outcome.
        authService.logout().catch(e => console.warn('Signout deferred:', e));
    }, []);

    // ============================================================
    // Admin "act as user" — v11.16 real session swap
    // ============================================================
    // start: backs up admin's tokens, calls the admin-impersonate edge
    // function (service-role) to get a magiclink hashed_token, then calls
    // verifyOtp to actually swap the Supabase session to the target. After
    // the swap, every Supabase call is authorized as the target — the
    // admin can post, delete, message, edit DB rows exactly as the target
    // would. The page reloads so all userId-dependent hooks re-bind.
    const startImpersonating = useCallback(async (targetUserId: string) => {
        if (!user || user.userType !== 'admin') {
            await customAlert('⚠️ هذه الخاصية مُتاحة للمدير فَقَط');
            return;
        }
        if (impersonating) {
            await customAlert('⚠️ أنت بِالفِعل تَتَصفَّح حساب آخر — ارجع للمدير أوّلاً');
            return;
        }
        if (targetUserId === user.id) {
            await customAlert('⚠️ لا يُمكنك التَّصفُّح كَحساب المدير نَفسه');
            return;
        }

        // 1. Capture admin's current tokens BEFORE the swap — these are
        //    what we'll use to restore the admin session on exit.
        const { data: sessData, error: sessErr } = await supabase.auth.getSession();
        if (sessErr || !sessData?.session?.access_token || !sessData?.session?.refresh_token) {
            await customAlert('⚠️ تَعذَّر قِراءة جَلسة المدير — حاول تَسجيل دخول جديد');
            return;
        }
        const adminTokens = {
            access_token: sessData.session.access_token,
            refresh_token: sessData.session.refresh_token,
        };

        // 2. Ask the edge function for a magiclink token for the target.
        const { data: efData, error: efErr } = await supabase.functions.invoke('admin-impersonate', {
            body: { targetUserId },
        });
        if (efErr || !efData?.hashed_token) {
            const msg = (efData as any)?.error || efErr?.message || 'خَطأ غَير مَعروف';
            await customAlert('⚠️ ' + msg);
            return;
        }

        // 3. Swap the Supabase session. verifyOtp consumes the hashed_token
        //    and returns a real session for the target. After this, every
        //    Supabase call from this browser is authorized as the target.
        const { error: verifyErr } = await supabase.auth.verifyOtp({
            type: 'magiclink',
            token_hash: efData.hashed_token,
        });
        if (verifyErr) {
            // Restore admin session if the swap clobbered something.
            try {
                await supabase.auth.setSession(adminTokens);
            } catch {}
            await customAlert('⚠️ فَشل تَبديل الجَلسة: ' + verifyErr.message);
            return;
        }

        // 4. Persist the admin's tokens + target metadata so stopImpersonating
        //    can restore the original admin session on exit, and so the
        //    reloaded page can show the banner. We write AFTER the successful
        //    swap to avoid leaving stale state on a failed attempt.
        try {
            localStorage.setItem('TAKI_IMPERSONATION_SESSION', JSON.stringify({
                adminAccessToken: adminTokens.access_token,
                adminRefreshToken: adminTokens.refresh_token,
                adminId: user.id,
                adminName: user.name || 'مدير',
                targetId: targetUserId,
                targetName: efData.target?.name || 'مُستَخدِم',
                targetUserType: efData.target?.userType || 'buyer',
                startedAt: new Date().toISOString(),
            }));
        } catch {
            // localStorage blocked — without it stopImpersonating can't restore.
            // Try to restore admin session right away and bail.
            try { await supabase.auth.setSession(adminTokens); } catch {}
            await customAlert('⚠️ المتصفِّح يَمنع الحفظ المحلي — لا يُمكن بَدء الجَلسة');
            return;
        }

        // 5. Full navigation — every userId-dependent hook rebuilds for the
        //    target. Sellers land on their dashboard, buyers on home.
        const dest = efData.target?.userType === 'seller' ? '/seller' : '/';
        window.location.assign(dest);
    }, [user, impersonating, customAlert]);

    // stop: restores admin's saved tokens via setSession, logs the stop
    // action, and reloads to /admin. v11.17 hardening:
    //   - Audit log is fire-and-forget (RLS denies it while we're on the
    //     target's session anyway — the start row is the security record;
    //     awaiting the failed INSERT was hanging the exit on slow links).
    //   - setSession is wrapped in a 6 s race so a flaky network never
    //     traps the admin inside the impersonation.
    //   - The function ALWAYS reaches a navigation step (success ⇒ /admin,
    //     failure ⇒ /register after sign-out) so the click never feels dead.
    //   - `stoppingImp` state gates double-tap and drives the banner spinner.
    const stopImpersonating = useCallback(async () => {
        if (stoppingImpRef.current) return;
        stoppingImpRef.current = true;
        setStoppingImp(true);

        const raw = (() => {
            try { return localStorage.getItem('TAKI_IMPERSONATION_SESSION'); }
            catch { return null; }
        })();
        if (!raw) {
            window.location.assign('/admin');
            return;
        }

        let backup: any;
        try { backup = JSON.parse(raw); }
        catch {
            try { localStorage.removeItem('TAKI_IMPERSONATION_SESSION'); } catch {}
            window.location.assign('/admin');
            return;
        }

        // Fire-and-forget audit log. RLS will deny this (we're on target's
        // session, is_admin() returns false), so we don't even bother
        // surfacing the error — the start row is the audit record that
        // matters and was inserted server-side via service_role.
        try {
            supabase.from('admin_impersonation_log').insert({
                admin_id: backup.adminId,
                target_id: backup.targetId,
                action: 'stop',
            }).then(() => {}, () => {});
        } catch {}

        // Race setSession against an 8 s timeout so a hung token refresh
        // never strands the admin on the target's account.
        type SetSessionResult = { error: { message: string } | null };
        const restorePromise: Promise<SetSessionResult> = supabase.auth.setSession({
            access_token: backup.adminAccessToken,
            refresh_token: backup.adminRefreshToken,
        }) as unknown as Promise<SetSessionResult>;
        const timeoutPromise: Promise<SetSessionResult> = new Promise((resolve) =>
            setTimeout(() => resolve({ error: { message: 'timeout' } }), 8000)
        );

        let restored = false;
        try {
            const result = await Promise.race([restorePromise, timeoutPromise]);
            if (!result?.error) restored = true;
        } catch { /* fall through */ }

        // ALWAYS clean up local state and navigate, even on failure.
        try { localStorage.removeItem('TAKI_IMPERSONATION_SESSION'); } catch {}
        setImpersonating(null);

        if (restored) {
            window.location.assign('/admin');
        } else {
            try { await supabase.auth.signOut(); } catch {}
            try {
                await customAlertRef.current(
                    '⚠️ انتَهت صَلاحية جَلسة المدير — سَجِّل الدخول مَرَّة أُخرى للعَودة'
                );
            } catch {}
            window.location.assign('/register');
        }
    }, []);

    const deleteAccount = useCallback(async () => {
        // 30-day soft delete with grace period (migration v9.17). The user's
        // row is marked `deleted_at`/`purge_after`; their deals are paused.
        // A subsequent login within 30 days offers recovery.
        try {
            const { supabase } = await import('../services/supabaseClient');
            const { error } = await supabase.rpc('soft_delete_my_account');
            if (error) throw error;
        } catch (e) {
            console.error('Soft delete failed, falling back to hard delete:', e);
            await authService.deleteAccount();
        }
        // Sign out locally so the next visit forces a fresh login (which is
        // the trigger for the recovery prompt).
        try { await authService.logout(); } catch {}
        clearSnapshots();
        setUser(null);
        setFavorites([]);
        setFollowedMerchants([]);
        setNotifications([]);
        setBookings([]);
    }, []);

    const addDeal = useCallback(async (deal: Deal) => {
        logger.log('🛒 Adding deal:', deal.itemName, 'by user:', user?.id);
        const dealWithTime = {
            ...deal,
            status: deal.status || 'active',
            createdAt: deal.createdAt || Date.now(),
            ratings: deal.ratings || []
        };

        // (Removed v10.57) Earlier versions called userRepository.saveProfile(user)
        // here to "ensure FK target exists" before the deal insert. In practice
        // the user row is already created by the handle_new_user trigger at
        // signup, so this pre-write was redundant — and on a stalled auth-token
        // lock it ate half the timeout budget, leaving the spinner stuck.
        // Skipped. If the FK truly is missing (very rare), the deal upsert
        // surfaces a clear "store_id violates foreign key constraint" error
        // for the user to act on.

        // DB-first save — no "saved locally" lie. The UI only reflects
        //    the deal AFTER the database has accepted it. If the DB rejects
        //    (location cap, validation, RLS) the user sees a specific error
        //    and nothing appears in their list. If a transient auth-lock
        //    fires we retry once silently.
        const trySave = async () => {
            await dealRepository.save(dealWithTime);
        };

        try {
            await trySave();
        } catch (error: any) {
            const msg: string = error?.message || '';
            const isTransientLock = /lock.*auth-token|stole it|NavigatorLock/i.test(msg);
            const isLocationCap = /LOCATION_LIMIT_EXCEEDED/i.test(msg);

            if (isLocationCap) {
                customAlert(
                    language === 'ar'
                        ? '⚠️ وصلت لحد المواقع المسموح في باقتك.\n\nاختر موقعاً من مواقعك الحالية، أو احذف كل منتجات أحد المواقع الشاغرة لتفريغ خانة قبل إضافة موقع جديد. للترقية لباقة أكبر تواصل مع إدارة تاكي.'
                        : '⚠️ You\'ve reached your package\'s location limit.\n\nPick one of your existing locations, or free a vacant slot first. Contact TAKI admin to upgrade.'
                );
                return;
            }

            if (isTransientLock) {
                try {
                    await new Promise(r => setTimeout(r, 500));
                    await trySave();
                } catch (retryErr: any) {
                    console.error('❌ Deal save retry failed:', retryErr);
                    customAlert(
                        language === 'ar'
                            ? '⚠️ تعذّر حفظ العرض في قاعدة البيانات. حاول مرة أخرى بعد قليل.'
                            : '⚠️ Could not save deal to database. Try again shortly.'
                    );
                    return;
                }
            } else {
                console.error('❌ Failed to save deal to database:', error);
                customAlert(
                    language === 'ar'
                        ? `⚠️ تعذّر حفظ العرض في قاعدة البيانات.${msg ? `\n${msg}` : ''}`
                        : `⚠️ Could not save deal to database.${msg ? `\n${msg}` : ''}`
                );
                return;
            }
        }

        // 3. DB save succeeded — mirror to local state now. Functional update
        //    + dedup-by-id so a rapid double-click or a realtime INSERT race
        //    can't produce two rows for the same deal.
        setDeals(prev => {
            const filtered = prev.filter(d => d.id !== dealWithTime.id);
            return [dealWithTime, ...filtered];
        });
        logger.log('✅ Deal saved to database');

        // Follower / Smart Alert notifications are fanned out 100% server-side
        // by tr_deal_smart_notifications. The server fires on INSERT — no
        // client work needed.
    }, [user, language, customAlert]);

    const updateDeal = useCallback(async (deal: Deal) => {
        // DB-first: never show an "optimistic" version of a deal that the
        // database might reject. The UI only updates AFTER the DB confirms.
        try {
            await dealRepository.save(deal);
        } catch (error: any) {
            const msg: string = error?.message || '';
            const isTransientLock = /lock.*auth-token|stole it|NavigatorLock/i.test(msg);
            const isLocationCap = /LOCATION_LIMIT_EXCEEDED/i.test(msg);
            console.error('Failed to update deal in database:', error);
            customAlert(
                language === 'ar'
                    ? (isLocationCap
                        ? '⚠️ وصلت لحد المواقع المسموح في باقتك.\n\nاختر موقعاً من مواقعك الحالية، أو احذف كل منتجات أحد المواقع الشاغرة لتفريغ خانة قبل نقل العرض لموقع جديد. للترقية لباقة أكبر تواصل مع إدارة تاكي.'
                        : isTransientLock
                        ? '⚠️ المزامنة تأخرت — حاول مرة أخرى بعد ثوانٍ.'
                        : `⚠️ تعذّر حفظ التغيير في قاعدة البيانات.${msg ? `\n(${msg})` : ''}`)
                    : (isLocationCap
                        ? '⚠️ You\'ve reached your package\'s location limit. Pick an existing location or free a vacant slot. Contact TAKI admin to upgrade.'
                        : isTransientLock
                        ? '⚠️ Sync delayed — try again in a few seconds.'
                        : `⚠️ Could not save change to database.${msg ? `\n(${msg})` : ''}`)
            );
            return false;
        }

        // Re-read the row from DB and apply it to local state. This is the
        // canonical version — any trigger-derived field (region/city
        // backfill, timestamps, etc.) is reflected.
        try {
            const fresh = await dealRepository.getById(deal.id);
            if (fresh) {
                setDeals(prev => prev.map(d => d.id === fresh.id ? fresh : d));
            } else {
                // Row vanished between save and re-read — extremely rare.
                // Fall back to the version we just wrote.
                setDeals(prev => prev.map(d => d.id === deal.id ? deal : d));
            }
        } catch {
            // Read-back failed but write succeeded. Use the version we wrote.
            setDeals(prev => prev.map(d => d.id === deal.id ? deal : d));
        }
        return true;
    }, [customAlert, language]);

    /**
     * Stock-only update used by the booking flow when a buyer reserves N
     * units. Crucially this calls `dealRepository.updateQuantity` which does
     * a partial UPDATE that does NOT touch the `status` column — so the
     * `tr_guard_deal_publish` trigger never fires for buyers, and the
     * SUBSCRIPTION_REQUIRED block can't accidentally cancel a booking.
     */
    const updateDealStock = useCallback(async (dealId: string, newQuantity: number | 'unlimited') => {
        setDeals(prev => prev.map(d => d.id === dealId ? { ...d, quantity: newQuantity } : d));
        try {
            await dealRepository.updateQuantity(dealId, newQuantity);
        } catch (error: any) {
            console.error('Failed to update deal stock:', error);
            // Roll back the optimistic update so the UI reflects reality
            try {
                const original = await dealRepository.getById(dealId);
                if (original) {
                    setDeals(prev => prev.map(d => d.id === original.id ? original : d));
                }
            } catch { /* best-effort rollback */ }
            const msg: string = error?.message || '';
            customAlert(language === 'ar'
                ? `⚠️ تعذّر تحديث الكمية.${msg ? `\n(${msg})` : ''}`
                : `⚠️ Could not update stock.${msg ? `\n(${msg})` : ''}`);
        }
    }, [customAlert, language]);

    const deleteDeal = useCallback(async (id: string) => {
        // Optimistic local removal — stash the deal for potential restoration
        let removedDeal: Deal | undefined;
        setDeals(prev => {
            removedDeal = prev.find(d => d.id === id);
            return prev.filter(d => d.id !== id);
        });
        try {
            await dealRepository.remove(id);
        } catch (error: any) {
            console.error('Failed to delete deal from database:', error);
            // Restore the deal locally since server failed
            if (removedDeal) {
                setDeals(prev => [removedDeal!, ...prev]);
            }
            customAlert(language === 'ar'
                ? `⚠️ فشل حذف العرض من السيرفر: ${error?.message || 'خطأ غير معروف'}`
                : `⚠️ Failed to delete deal from server: ${error?.message || 'Unknown error'}`);
        }
    }, [customAlert, language]);

    // v10.67 — returns a boolean so the caller (DealDetails.handleReview)
    // can distinguish "saved" from "silently dropped" and show the right
    // toast. Previously this returned void and any RLS/network failure
    // looked identical to success — the form closed, no error was raised,
    // and the buyer wondered why their review never appeared.
    const addRating = useCallback(async (dealId: string, ratingData: { score: number, comment: string }): Promise<boolean> => {
        const dealToUpdate = deals.find(d => d.id === dealId);
        if (!dealToUpdate || !user) return false;

        const { ratingRepository } = await import('../repositories/ratingRepository');
        const created = await ratingRepository.create({
            dealId,
            userId: user.id,
            userName: user.name || 'مستخدم',
            score: ratingData.score,
            comment: ratingData.comment,
        });
        if (!created) return false;

        const local = {
            id: created.id,
            userId: created.userId,
            userName: created.userName,
            score: created.score,
            comment: created.comment,
            date: new Date(created.createdAt).toISOString().split('T')[0],
            reply: created.reply || undefined,
            repliedBy: created.repliedBy || undefined,
            repliedAt: created.repliedAt || undefined,
            likedBy: created.likedBy,
            likeCount: created.likeCount,
        };
        setDeals(prev => prev.map(d => d.id === dealId
            ? { ...d, ratings: [...(d.ratings || []), local] }
            : d));

        // The merchant + admin notification is created server-side by the
        // SECURITY DEFINER trigger `tr_rating_notification` on rating
        // INSERT (sets meta_data.audience='seller'). A client-side insert
        // is impossible here anyway: the notifications RLS policy
        // `notifs_insert_self` only allows writing rows for one's own auth
        // uid, so the buyer can never notify the merchant from the client
        // — that silent RLS rejection is exactly why this never arrived.
        return true;
    }, [deals, user]);

    const addReply = useCallback(async (dealId: string, ratingId: string, reply: string) => {
        const { ratingRepository } = await import('../repositories/ratingRepository');
        // Optimistic — the reply lands in the UI before the server round-trip.
        const trimmed = reply.trim();
        let buyerId: string | undefined;
        setDeals(prev => prev.map(d => {
            if (d.id !== dealId) return d;
            return {
                ...d,
                ratings: d.ratings?.map(r => {
                    if (r.id !== ratingId) return r;
                    buyerId = r.userId;
                    return { ...r, reply: trimmed || undefined, repliedBy: user?.id, repliedAt: new Date().toISOString() };
                })
            };
        }));
        const ok = await ratingRepository.setReply(ratingId, trimmed);
        if (!ok) {
            // Rollback by removing the optimistic reply on failure
            setDeals(prev => prev.map(d => {
                if (d.id !== dealId) return d;
                return {
                    ...d,
                    ratings: d.ratings?.map(r => r.id === ratingId ? { ...r, reply: undefined, repliedBy: undefined, repliedAt: undefined } : r)
                };
            }));
            console.warn('Reply persistence failed; rolled back optimistic update');
            return;
        }
        if (buyerId && trimmed) {
            const itemName = deals.find(d => d.id === dealId)?.itemName || '';
            addNotification(
                buyerId,
                { ar: '💬 رد جديد على تعليقك', en: '💬 New reply to your review' },
                { ar: `قام صاحب المحل بالرد على تقييمك لمنتج ${itemName}`, en: `The shop owner replied to your review of ${itemName}` },
                'system',
                { dealId, ratingId }
            );
        }
    }, [deals, user, addNotification]);

    const toggleRatingLike = useCallback(async (dealId: string, ratingId: string) => {
        if (!user) return;
        const { ratingRepository } = await import('../repositories/ratingRepository');
        const me = user.id;
        // Optimistic flip
        let prevState: { liked: boolean; count: number } | null = null;
        setDeals(prev => prev.map(d => {
            if (d.id !== dealId) return d;
            return {
                ...d,
                ratings: d.ratings?.map(r => {
                    if (r.id !== ratingId) return r;
                    const likedBy = r.likedBy || [];
                    const wasLiked = likedBy.includes(me);
                    prevState = { liked: wasLiked, count: r.likeCount ?? 0 };
                    return {
                        ...r,
                        likedBy: wasLiked ? likedBy.filter(x => x !== me) : [...likedBy, me],
                        likeCount: Math.max(0, (r.likeCount ?? 0) + (wasLiked ? -1 : 1)),
                    };
                })
            };
        }));
        const result = await ratingRepository.toggleLike(ratingId);
        if (!result) {
            // Rollback
            if (prevState) {
                setDeals(prev => prev.map(d => {
                    if (d.id !== dealId) return d;
                    return {
                        ...d,
                        ratings: d.ratings?.map(r => {
                            if (r.id !== ratingId) return r;
                            const likedBy = r.likedBy || [];
                            const restored = prevState!.liked ? (likedBy.includes(me) ? likedBy : [...likedBy, me]) : likedBy.filter(x => x !== me);
                            return { ...r, likedBy: restored, likeCount: prevState!.count };
                        })
                    };
                }));
            }
        }
    }, [user]);

    const removeRating = useCallback(async (dealId: string, ratingId: string) => {
        const { ratingRepository } = await import('../repositories/ratingRepository');
        let snapshot: any[] = [];
        setDeals(prev => prev.map(d => {
            if (d.id !== dealId) return d;
            snapshot = d.ratings || [];
            return { ...d, ratings: (d.ratings || []).filter(r => r.id !== ratingId) };
        }));
        const ok = await ratingRepository.remove(ratingId);
        if (!ok) {
            const restore = snapshot;
            setDeals(prev => prev.map(d => d.id === dealId ? { ...d, ratings: restore } : d));
        }
    }, []);

    const addNotifKeyword = useCallback((kw: string) => {
        if (!notifKeywords.includes(kw)) {
            const updated = [...notifKeywords, kw];
            setNotifKeywords(updated);
            // Server is source of truth — no localStorage needed
            if (user) {
                userRepository.saveProfile({ ...user, notifKeywords: updated });
            }
        }
    }, [notifKeywords, user]);

    const removeNotifKeyword = useCallback((kw: string) => {
        const updated = notifKeywords.filter(k => k !== kw);
        setNotifKeywords(updated);
        // Server is source of truth — no localStorage needed
        if (user) {
            userRepository.saveProfile({ ...user, notifKeywords: updated });
        }
    }, [notifKeywords, user]);

    // v10.66 — these were previously fire-and-forget. On iOS Safari the
    // Supabase JS SDK's auth-refresh inTabLock can hang for tens of seconds
    // after a backgrounded tab returns, causing saveProfile() to reject
    // silently. The UI showed the rule "added" while the DB held nothing,
    // and the seller would later wonder why no notification ever arrived.
    // Now we await the round-trip, revert local state on failure, and let
    // the caller (Profile.handleAdd) show a clear toast either way.
    const addSmartAlert = useCallback(async (rule: SmartAlertRule): Promise<boolean> => {
        if (!user) return false;
        const previous = smartAlerts;
        const updated = [...smartAlerts, rule];
        setSmartAlerts(updated);
        try {
            await userRepository.saveProfile({ ...user, smartAlerts: updated });
            return true;
        } catch (err) {
            logger.error('Failed to save smart alert:', err);
            setSmartAlerts(previous);
            return false;
        }
    }, [smartAlerts, user]);

    const removeSmartAlert = useCallback(async (idx: number): Promise<boolean> => {
        if (!user) return false;
        const previous = smartAlerts;
        const updated = smartAlerts.filter((_, i) => i !== idx);
        setSmartAlerts(updated);
        try {
            await userRepository.saveProfile({ ...user, smartAlerts: updated });
            return true;
        } catch (err) {
            logger.error('Failed to remove smart alert:', err);
            setSmartAlerts(previous);
            return false;
        }
    }, [smartAlerts, user]);

    // Booking logic - uses generateBarcode from helpers
    const bookDeal = useCallback((deal: Deal, quantity: number = 1, userId: string = 'anon', prepTime?: string, notes?: string) => {
        const barcode = generateBarcode(8);

        // Bookings always expire within 2 hours of creation, regardless of how
        // long the deal itself stays live. If the deal expires sooner, we cap to
        // its actual end so a buyer can never hold a slot past the deal window.
        const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
        const now = Date.now();
        const dealLifespanMs = (deal.expiresInMinutes || 120) * 60 * 1000;
        const dealEndsAt = (deal.createdAt || now) + dealLifespanMs;
        const expiryTime = Math.min(now + TWO_HOURS_MS, dealEndsAt);

        const booking = {
            deal,
            barcode,
            backupCode: barcode, // Use same code for both to eliminate confusion
            expiryTime,
            bookedAt: now,
            bookedQuantity: quantity,
            userId,
            userName: user?.name || (user as any)?.shop || '',
            userPhone: user?.phone || user?.contactPhone || '',
            prepTime,
            notes,
            status: 'pending' as const
        };

        setBookings(prev => {
            const updated = [booking, ...prev];
            return updated;
        });

        // Persist to remote — the server-side trigger
        // `tr_booking_notification` (migration v8.7) emits both the
        // "New Booking Request" alert to the seller (with prep_time/notes
        // baked in) and the "Booking Confirmed" alert to the buyer. We
        // deliberately do NOT addNotification(...) here to avoid duplicates.
        bookingRepository.save(booking as any).catch(e =>
            console.warn('Booking remote sync deferred:', e?.message || e)
        );

        return booking;
    }, [user]);

    // In-flight tracker: prevents double-tap from a barcode scanner firing
    // two simultaneous status transitions for the same booking. Each entry
    // is cleared as soon as the RPC settles (success or failure).
    const bookingsInFlightRef = useRef<Set<string>>(new Set());

    const cancelBooking = useCallback(async (barcode: string) => {
        const target = bookings.find(b => b.barcode === barcode);
        if (!target || target.status === 'cancelled' || target.status === 'completed') return;
        if (bookingsInFlightRef.current.has(barcode)) return;

        bookingsInFlightRef.current.add(barcode);
        const previousStatus = target.status;
        // Optimistic update — feels instant.
        setBookings(prev => prev.map(b => b.barcode === barcode ? { ...b, status: 'cancelled' } : b));

        try {
            await bookingRepository.updateStatus(barcode, 'cancelled');
            // Restore reserved quantity AFTER the cancel actually committed.
            if (target.deal && target.deal.quantity !== 'unlimited') {
                const currentDeal = dealsRef.current.find(d => d.id === target.deal.id);
                if (currentDeal && currentDeal.quantity !== 'unlimited') {
                    const restored = (currentDeal.quantity as number) + (target.bookedQuantity || 1);
                    setDeals(prev => prev.map(d => d.id === currentDeal.id ? { ...d, quantity: restored } : d));
                    dealRepository.updateQuantity(currentDeal.id, restored).catch(e =>
                        console.warn('Deal qty restore sync deferred:', e?.message || e)
                    );
                }
            }
        } catch (e: any) {
            // RPC rejected the transition (already completed, RLS, etc.).
            // Roll the local row back so the UI matches the DB instead of
            // showing a status that doesn't exist server-side.
            setBookings(prev => prev.map(b => b.barcode === barcode ? { ...b, status: previousStatus } : b));
            customAlert(language === 'ar'
                ? `⚠️ فشل إلغاء الحجز: ${e?.message || 'خطأ غير معروف'}`
                : `⚠️ Cancel failed: ${e?.message || 'Unknown error'}`);
        } finally {
            bookingsInFlightRef.current.delete(barcode);
        }
    }, [bookings, language, customAlert]);

    const completeBooking = useCallback(async (barcode: string) => {
        const target = bookings.find(b => b.barcode === barcode);
        if (!target || target.status === 'completed' || target.status === 'cancelled') return;
        if (bookingsInFlightRef.current.has(barcode)) return;

        bookingsInFlightRef.current.add(barcode);
        const previousStatus = target.status;
        setBookings(prev => prev.map(b => b.barcode === barcode ? { ...b, status: 'completed' } : b));

        try {
            await bookingRepository.updateStatus(barcode, 'completed');
            // Success — server trigger emits buyer + seller + admin notifs.
        } catch (e: any) {
            // The "completion silently reverts" bug lived here: previously
            // we left the optimistic 'completed' in place even on failure,
            // and on the next realtime sync the row reverted to acknowledged
            // because DB never accepted the change. Roll back + tell the
            // user so they can retry.
            setBookings(prev => prev.map(b => b.barcode === barcode ? { ...b, status: previousStatus } : b));
            customAlert(language === 'ar'
                ? `⚠️ فشل تأكيد التسليم: ${e?.message || 'خطأ غير معروف'}. حاول مرة أخرى.`
                : `⚠️ Completion failed: ${e?.message || 'Unknown error'}. Please retry.`);
        } finally {
            bookingsInFlightRef.current.delete(barcode);
        }
    }, [bookings, language, customAlert]);

    const acknowledgeBooking = useCallback(async (barcode: string, merchantNote?: string) => {
        const target = bookings.find(b => b.barcode === barcode);
        if (!target || target.status !== 'pending') return;
        if (bookingsInFlightRef.current.has(barcode)) return;

        bookingsInFlightRef.current.add(barcode);
        const previousStatus = target.status;
        const previousNote = target.merchantNote;
        setBookings(prev => prev.map(b => b.barcode === barcode
            ? { ...b, status: 'acknowledged' as const, merchantNote: merchantNote || b.merchantNote }
            : b));

        try {
            await bookingRepository.updateStatus(barcode, 'acknowledged', merchantNote);
        } catch (e: any) {
            setBookings(prev => prev.map(b => b.barcode === barcode
                ? { ...b, status: previousStatus, merchantNote: previousNote }
                : b));
            customAlert(language === 'ar'
                ? `⚠️ فشل تأكيد استلام الطلب: ${e?.message || 'خطأ غير معروف'}. حاول مرة أخرى.`
                : `⚠️ Acknowledge failed: ${e?.message || 'Unknown error'}. Please retry.`);
        } finally {
            bookingsInFlightRef.current.delete(barcode);
        }
    }, [bookings, language, customAlert]);

    // Public refresh — for pages that mount after a booking event and want to
    // guarantee parity with the server even if a realtime packet was missed.
    const refreshBookings = useCallback(async () => {
        if (!user?.id) return;
        try {
            const fresh = await bookingRepository.getByUser(user.id, dealsRef.current);
            writeSnapshot('bk_' + user.id, fresh);
            setBookings(prev => {
                // Preserve any messages we already fetched per booking — the
                // bookings select doesn't include them.
                const byBarcode: Record<string, any> = {};
                prev.forEach(b => { byBarcode[b.barcode] = b; });
                return fresh.map((b: any) => ({
                    ...b,
                    messages: byBarcode[b.barcode]?.messages,
                }));
            });
        } catch (e) {
            console.warn('refreshBookings failed:', e);
        }
    }, [user?.id]);

    // ── Booking messages thread (buyer ↔ seller, 3+3 cap) ──
    const fetchBookingMessages = useCallback(async (barcode: string) => {
        try {
            const messages = await bookingRepository.getMessages(barcode);
            setBookings(prev => prev.map(b => b.barcode === barcode ? { ...b, messages } : b));
        } catch (e: any) {
            console.warn('fetchBookingMessages failed:', e?.message || e);
        }
    }, []);

    const sendBookingMessage = useCallback(async (barcode: string, body: string) => {
        const text = (body || '').trim();
        if (!text) return;
        try {
            const inserted = await bookingRepository.sendMessage(barcode, text);
            setBookings(prev => prev.map(b => {
                if (b.barcode !== barcode) return b;
                const existing = b.messages || [];
                if (existing.find((m: any) => m.id === inserted.id)) return b;
                return { ...b, messages: [...existing, inserted] };
            }));
        } catch (e: any) {
            customAlert(language === 'ar'
                ? `⚠️ ${e?.message || 'تعذّر إرسال الرسالة'}`
                : `⚠️ ${e?.message || 'Could not send message'}`);
            throw e;
        }
    }, [customAlert, language]);

    const markBookingMessagesRead = useCallback(async (barcode: string) => {
        try {
            await bookingRepository.markMessagesRead(barcode);
            // Optimistic local update so the unread-dot disappears immediately
            setBookings(prev => prev.map(b => {
                if (b.barcode !== barcode || !b.messages) return b;
                const now = Date.now();
                const myRole: 'buyer' | 'seller' | null =
                    b.userId === user?.id ? 'buyer' :
                    (b.deal?.storeId === user?.id ? 'seller' : null);
                if (!myRole) return b;
                return {
                    ...b,
                    messages: b.messages.map((m: any) =>
                        m.senderRole !== myRole && !m.readAt ? { ...m, readAt: now } : m
                    ),
                };
            }));
        } catch (e: any) {
            console.warn('markBookingMessagesRead failed:', e?.message || e);
        }
    }, [user?.id]);

    // Same idea for deals — Home calls this on mount / focus so a freshly
    // posted deal appears even if the global realtime packet was dropped.
    const refreshDeals = useCallback(async () => {
        try {
            const fresh = await dealRepository.getAll();
            if (fresh) { setDeals(fresh); writeSnapshot('deals', fresh); }
        } catch (e) {
            console.warn('refreshDeals failed:', e);
        }
    }, []);

    const setLanguage = useCallback((lang: 'ar' | 'en') => {
        setLanguageState(lang);
        document.dir = lang === 'ar' ? 'rtl' : 'ltr';
        // Persist preference on the server when signed in. Local
        // storage is no longer the source of truth — see migration v8.13.
        if (user) {
            const updated = { ...user, preferredLang: lang };
            setUser(updated);
            authService.setUser(updated);
            userRepository.saveProfile(updated).catch(() => {});
        }
    }, [user]);

    // Stable refs for the realtime handlers. The central realtime effect
    // below must NOT re-subscribe every time these callbacks change identity.
    // `addNotification`/`showRealTimeAlert` are rebuilt whenever the `user`
    // object is replaced — and that happens 3-4× during a single login
    // (null → getCurrentUser → optimistic JWT profile → canonical DB row →
    // language hydrate). Each re-subscribe tore down and rebuilt every
    // Supabase channel mid-handshake, so notification/booking INSERTs were
    // dropped until the user manually refreshed (the "لازم أحدّث 3 مرات"
    // bug). Routing handlers through refs lets the effect depend on
    // `user?.id` alone and keep channels stable for the whole session.
    const showRealTimeAlertRef = useRef(showRealTimeAlert);
    const addNotificationRef = useRef(addNotification);
    const reconcileStatusRef = useRef(reconcileStatus);
    useEffect(() => { showRealTimeAlertRef.current = showRealTimeAlert; }, [showRealTimeAlert]);
    useEffect(() => { addNotificationRef.current = addNotification; }, [addNotification]);
    useEffect(() => { reconcileStatusRef.current = reconcileStatus; }, [reconcileStatus]);

    // 🌍 CENTRAL REALTIME SYNC (Handles visibility, online/offline, etc.)
    useEffect(() => {
        const disconnect = realtimeService.connect({
            userId: user?.id || null,
            onNotificationInsert: (payload) => {
                const n = payload.new as any;
                const mapped: Notification = {
                    id: n.id,
                    userId: n.user_id,
                    title: { ar: n.title_ar, en: n.title_en },
                    body: { ar: n.body_ar, en: n.body_en },
                    type: n.type,
                    isRead: !!n.is_read,
                    createdAt: new Date(n.created_at).getTime(),
                    metadata: n.meta_data
                };
                setNotifications(prev => {
                    if (prev.find(p => p.id === mapped.id)) return prev;
                    return [mapped, ...prev];
                });
                if (user?.id === n.user_id) {
                    // OS notification (if permitted) + the non-blocking in-app
                    // top banner. The banner is what guarantees the BUYER sees
                    // a "new message" heads-up too — previously they got
                    // nothing visible because only the seller had the (now
                    // removed) center box and the OS path is permission-gated.
                    showRealTimeAlertRef.current(mapped.title, mapped.body);
                    setInAppBanner({ id: mapped.id, title: mapped.title, body: mapped.body, metadata: mapped.metadata });
                }
            },
            onNotificationUpdate: (payload) => {
                if (payload.eventType === 'DELETE') {
                    setNotifications(prev => prev.filter(n => n.id !== payload.old.id));
                } else if (payload.eventType === 'UPDATE' && payload.new) {
                    setNotifications(prev => prev.map(n => n.id === payload.new.id ? { ...n, isRead: !!payload.new.is_read } : n));
                }
            },
            onBookingMessage: (payload) => {
                // Live thread updates. INSERT = new message → append.
                // UPDATE = read-receipt (only field that changes is read_at).
                if (payload.eventType === 'INSERT' && payload.new) {
                    const row = payload.new as any;
                    const mapped = {
                        id: row.id,
                        barcode: row.barcode,
                        senderId: row.sender_id,
                        senderRole: row.sender_role,
                        body: row.body,
                        createdAt: new Date(row.created_at).getTime(),
                        readAt: row.read_at ? new Date(row.read_at).getTime() : null,
                    };
                    setBookings(prev => prev.map(b => {
                        if (b.barcode !== mapped.barcode) return b;
                        const existing = b.messages || [];
                        if (existing.find((m: any) => m.id === mapped.id)) return b;
                        return { ...b, messages: [...existing, mapped] };
                    }));
                } else if (payload.eventType === 'UPDATE' && payload.new) {
                    const row = payload.new as any;
                    setBookings(prev => prev.map(b => {
                        if (b.barcode !== row.barcode || !b.messages) return b;
                        return {
                            ...b,
                            messages: b.messages.map((m: any) =>
                                m.id === row.id ? { ...m, readAt: row.read_at ? new Date(row.read_at).getTime() : null } : m
                            ),
                        };
                    }));
                }
            },
            onBookingChange: (payload) => {
                if (payload.eventType === 'INSERT') {
                    const n = payload.new as any;
                    const isMine = n.user_id === user?.id || n.store_id === user?.id;
                    if (!isMine) return;

                    const mapped: any = {
                        barcode: n.barcode,
                        backupCode: n.backup_code,
                        deal: dealsRef.current.find(d => d.id === n.deal_id) || { id: n.deal_id, storeId: n.store_id, itemName: 'تخفيض' },
                        userId: n.user_id,
                        userName: n.user_name || undefined,
                        userPhone: n.user_phone || undefined,
                        bookedQuantity: n.booked_quantity,
                        prepTime: n.prep_time,
                        notes: n.notes,
                        status: n.status as any,
                        bookedAt: n.booked_at,
                        expiryTime: n.expiry_time
                    };
                    setBookings(prev => {
                        if (prev.find(b => b.barcode === mapped.barcode)) return prev;
                        return [mapped, ...prev];
                    });
                } else if (payload.eventType === 'UPDATE' && payload.new) {
                    const updated = payload.new as any;
                    setBookings(prev => {
                        const known = prev.find(b => b.barcode === updated.barcode);
                        if (known) {
                            return prev.map(b => b.barcode === updated.barcode
                                ? { ...b, status: reconcileStatusRef.current(b.status, updated.status), notes: updated.notes || b.notes }
                                : b);
                        }
                        return prev;
                    });
                    // Purchase just completed for THIS buyer → ask them to
                    // rate the store (once, and only if they haven't already).
                    if (updated.status === 'completed'
                        && updated.user_id && updated.user_id === user?.id
                        && !promptedRatingRef.current.has(updated.barcode)) {
                        const d = dealsRef.current.find(x => x.id === updated.deal_id);
                        const alreadyRated = !!(d?.ratings || []).some((r: any) => r.userId === user?.id);
                        if (!alreadyRated) {
                            promptedRatingRef.current.add(updated.barcode);
                            setRatingStars(5);
                            setRatingComment('');
                            setRatingPrompt({
                                barcode: updated.barcode,
                                dealId: updated.deal_id,
                                storeName: d?.shopName || (language === 'ar' ? 'المتجر' : 'the store'),
                            });
                        }
                    }
                } else if (payload.eventType === 'DELETE') {
                    setBookings(prev => prev.filter(b => b.barcode !== payload.old.barcode));
                }
            },
            onDealChange: (payload) => {
                import('../repositories/dealRepository').then(({ dealRepository: dr }) => {
                    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                        const mapped = dr.mapRowToDeal(payload.new) as any;
                        if (mapped.status === 'deleted') {
                            setDeals(prev => prev.filter(d => d.id !== mapped.id));
                            return;
                        }

                        // DEAL MATCHING ENGINE: Notify the buyer if favorited deal price dropped or restocked
                        if (payload.eventType === 'UPDATE' && user?.id && mapped.storeId !== user.id) {
                            const before = payload.old as any;
                            const updated = payload.new as any;
                            if (favoritesRef.current.includes(mapped.id)) {
                                const priceDropped = before?.discounted_price != null && updated.discounted_price != null && updated.discounted_price < before.discounted_price;
                                const restocked = before?.quantity === 0 && updated.quantity && updated.quantity > 0;
                                if (priceDropped) {
                                    addNotificationRef.current(
                                        user.id,
                                        { ar: '💸 انخفض سعر منتج في مفضلتك!', en: '💸 Price drop on a favorite!' },
                                        { ar: `${updated.item_name}: ${updated.discounted_price} ر.س (كان ${before.discounted_price} ر.س)`, en: `${updated.item_name}: ${updated.discounted_price} SAR (was ${before.discounted_price} SAR)` },
                                        'deal',
                                        { dealId: updated.id }
                                    );
                                } else if (restocked) {
                                    addNotificationRef.current(
                                        user.id,
                                        { ar: '📦 منتجك المفضل عاد للتوفر!', en: '📦 Favorite restocked!' },
                                        { ar: `${updated.item_name} في ${updated.shop_name} أصبح متاحاً مجدداً.`, en: `${updated.item_name} at ${updated.shop_name} is available again.` },
                                        'deal',
                                        { dealId: updated.id }
                                    );
                                }
                            }
                        }

                        setDeals(prev => {
                            const exists = prev.find(d => d.id === mapped.id);
                            if (exists) return prev.map(d => d.id === mapped.id ? { ...d, ...mapped } : d);
                            return [mapped, ...prev];
                        });
                    } else if (payload.eventType === 'DELETE') {
                        setDeals(prev => prev.filter(d => d.id !== payload.old.id));
                    }
                });
            },
            onUserChange: (payload) => {
                const newUser = payload.new as any;
                const oldUser = payload.old as any;
                // Update store profiles if seller
                if (newUser?.user_type === 'seller' || oldUser?.user_type === 'seller' || payload.eventType === 'DELETE') {
                    import('../repositories/userRepository').then(({ userRepository: ur }) => {
                        ur.getAllSellers().then(sellers => {
                            const profiles: Record<string, any> = {};
                            sellers.forEach(s => { profiles[s.id] = s; });
                            setStoreProfiles(profiles);
                        });
                    });
                }
                // Update current user if it's me
                if (user?.id && newUser?.id === user.id && payload.eventType === 'UPDATE') {
                     const newFollowed = Array.isArray(newUser.followed_merchants) ? newUser.followed_merchants : undefined;
                     if (newFollowed) {
                         setFollowedMerchants(newFollowed);
                     }
                     const newBlocked = Array.isArray(newUser.blocked_merchants) ? newUser.blocked_merchants : undefined;
                     if (newBlocked) {
                         setBlockedMerchants(newBlocked);
                     }
                     setUser((prev: any) => ({
                         ...prev,
                         name: newUser.name,
                         phone: newUser.phone,
                         shop: newUser.shop,
                         bio: newUser.bio,
                         avatar_url: newUser.avatar_url,
                         contactPhone: newUser.contact_phone,
                         followedMerchants: newFollowed || prev.followedMerchants,
                         blockedMerchants: newBlocked || prev.blockedMerchants,
                     }));
                }
            },
            onFavoriteChange: (payload) => {
               if (payload.eventType === 'INSERT') {
                   setFavorites(prev => prev.includes(payload.new.deal_id) ? prev : [...prev, payload.new.deal_id]);
               } else if (payload.eventType === 'DELETE') {
                   setFavorites(prev => prev.filter(id => id !== payload.old.deal_id));
               }
            },
            onRefreshAll: async () => {
                logger.info('🔄 Full Refresh Triggered');
                const ruid = user?.id;
                await Promise.allSettled([
                    import('../repositories/dealRepository').then(({ dealRepository: dr }) => dr.getAll().then(fresh => { if (fresh) { setDeals(fresh); writeSnapshot('deals', fresh); } })),
                    // Preserve previously-fetched per-booking chat messages — the
                    // bookings select doesn't include them, so a naive setBookings(fresh)
                    // would wipe `messages` on every focus/visibility refresh and force
                    // every open BookingThread to re-fetch from scratch.
                    ruid ? import('../repositories/bookingRepository').then(({ bookingRepository: br }) => br.getByUser(ruid, dealsRef.current).then(fresh => {
                        writeSnapshot('bk_' + ruid, fresh);
                        setBookings(prev => {
                            const byBarcode: Record<string, any> = {};
                            prev.forEach(b => { byBarcode[b.barcode] = b; });
                            return fresh.map((b: any) => ({ ...b, messages: byBarcode[b.barcode]?.messages }));
                        });
                    })) : Promise.resolve(),
                    ruid ? import('../repositories/notificationRepository').then(({ notificationRepository: nr }) => nr.fetchByUserId(ruid).then(n => { setNotifications(n); writeSnapshot('notif_' + ruid, n); })) : Promise.resolve(),
                    ruid ? import('../repositories/userRepository').then(({ userRepository: ur }) => ur.getFavorites().then(f => { setFavorites(f); writeSnapshot('fav_' + ruid, f); })) : Promise.resolve(),
                    import('../repositories/userRepository').then(({ userRepository: ur }) => ur.getAllSellers().then(sellers => {
                        const profiles: Record<string, any> = {};
                        sellers.forEach(s => { profiles[s.id] = s; });
                        setStoreProfiles(profiles);
                        writeSnapshot('sellers', profiles);
                    }))
                ]);
            }
        });

        return () => disconnect();
        // Depend ONLY on the user id. The handlers above read the latest
        // showRealTimeAlert/addNotification/reconcileStatus via refs, so the
        // realtime channels are created once per signed-in user and stay
        // subscribed for the whole session instead of being torn down and
        // rebuilt every time an unrelated callback changes identity.
    }, [user?.id]);

    // Effective user-type for rendering. Admins can flip into buyer/seller
    // preview mode via setViewAs; non-admins always see their real role.
    const effectiveUserType: 'buyer' | 'seller' | 'admin' =
        (user?.userType === 'admin' && viewAs) ? viewAs : (user?.userType || 'buyer');

    // v11.19 — admin permission derivations. Single source of truth; both
    // the dashboard tab filtering and individual action buttons consult
    // `hasPermission`. Super admin always wins; non-admins always lose.
    const isSuperAdmin = user?.userType === 'admin' && user?.isSuperAdmin === true;
    const adminPermissions: string[] = (user?.userType === 'admin' && Array.isArray(user?.adminPermissions))
        ? user!.adminPermissions!
        : [];
    const hasPermission = useCallback((perm: string): boolean => {
        if (!user || user.userType !== 'admin') return false;
        if (user.isSuperAdmin === true) return true;
        return Array.isArray(user.adminPermissions) && user.adminPermissions.includes(perm);
    }, [user]);

    const incrementDealView = async (dealId: string) => {
        try {
            const { error } = await supabase.rpc('increment_deal_view', { target_deal_id: dealId });
            if (error) throw error;
            setDeals(prev => prev.map(d => d.id === dealId ? { ...d, views: (d.views || 0) + 1 } : d));
        } catch (err) { logger.error('View inc error:', err); }
    };

    const incrementDealClick = async (dealId: string) => {
        try {
            const { error } = await supabase.rpc('increment_deal_click', { target_deal_id: dealId });
            if (error) throw error;
            setDeals(prev => prev.map(d => d.id === dealId ? { ...d, clicks: (d.clicks || 0) + 1 } : d));
        } catch (err) { logger.error('Click inc error:', err); }
    };

    const saveBranch = useCallback(async (input: Partial<StoreBranch> & { nameAr: string }): Promise<StoreBranch | null> => {
        if (!user?.id) return null;
        try {
            const saved = await branchRepository.upsert({ ...input, merchantId: user.id });
            if (saved) {
                setBranches(prev => {
                    const idx = prev.findIndex(b => b.id === saved.id);
                    if (idx >= 0) {
                        const next = [...prev];
                        next[idx] = saved;
                        return next;
                    }
                    return [...prev, saved];
                });
            }
            return saved;
        } catch (err) {
            logger.error('saveBranch error:', err);
            throw err;
        }
    }, [user?.id]);

    const removeBranch = useCallback(async (id: string): Promise<void> => {
        const prevList = branches;
        // Optimistic — drop locally first so the chip vanishes instantly.
        setBranches(prev => prev.filter(b => b.id !== id));
        try {
            await branchRepository.remove(id);
        } catch (err) {
            // Roll back on failure so the seller sees the chip again and
            // knows the delete didn't actually land.
            logger.error('removeBranch error:', err);
            setBranches(prevList);
            throw err;
        }
    }, [branches]);

    // Memoize the context value to prevent unnecessary re-renders
    const contextValue = useMemo(() => ({
        language, setLanguage,
        deals, loading, isAuthReady, addDeal, updateDeal, updateDealStock, deleteDeal,
        user, logout, deleteAccount,
        favorites, toggleFavorite,
        followedMerchants, toggleFollowMerchant,
        blockedMerchants, toggleBlockMerchant,
        notifications, addNotification, markNotifRead,
        bookings, bookDeal, cancelBooking, completeBooking, acknowledgeBooking,
        sendBookingMessage, fetchBookingMessages, markBookingMessagesRead,
        refreshBookings, refreshDeals,
        addRating, addReply, toggleRatingLike, removeRating,
        topLocation, setTopLocation,
        homeCity, setHomeCity,
        notifKeywords, addNotifKeyword, removeNotifKeyword,
        smartAlerts, addSmartAlert, removeSmartAlert,
        storeProfiles, sponsors, updateStoreProfile, updateProfile, checkMarketingAlerts,
        liveLocation, locationPermission, requestLiveLocation,
        darkMode, toggleDarkMode,
        customAlert, customConfirm, customPrompt,
        inAppBanner, dismissInAppBanner,
        viewAs, setViewAs, effectiveUserType,
        impersonating, startImpersonating, stopImpersonating,
        isSuperAdmin, adminPermissions, hasPermission,
        incrementDealView, incrementDealClick,
        platformSettings,
        branches, saveBranch, removeBranch,
    }), [
        language, setLanguage,
        deals, loading, isAuthReady, addDeal, updateDeal, updateDealStock, deleteDeal,
        user, logout, deleteAccount,
        favorites, toggleFavorite,
        followedMerchants, toggleFollowMerchant,
        blockedMerchants, toggleBlockMerchant,
        notifications, addNotification, markNotifRead,
        bookings, bookDeal, cancelBooking, completeBooking, acknowledgeBooking,
        sendBookingMessage, fetchBookingMessages, markBookingMessagesRead,
        refreshBookings, refreshDeals,
        addRating, addReply, toggleRatingLike, removeRating,
        topLocation, setTopLocation,
        homeCity, setHomeCity,
        notifKeywords, addNotifKeyword, removeNotifKeyword,
        smartAlerts, addSmartAlert, removeSmartAlert,
        storeProfiles, sponsors, updateStoreProfile, updateProfile, checkMarketingAlerts,
        liveLocation, locationPermission, requestLiveLocation,
        darkMode, toggleDarkMode,
        customAlert, customConfirm, customPrompt,
        inAppBanner, dismissInAppBanner,
        viewAs, setViewAs, effectiveUserType,
        impersonating, startImpersonating, stopImpersonating,
        isSuperAdmin, adminPermissions, hasPermission,
        incrementDealView, incrementDealClick,
        platformSettings,
        branches, saveBranch, removeBranch,
    ]);

    return (
        <AppContext.Provider value={contextValue}>
            {children}

            {/* Admin "act as user" banner — v11.16 full session swap.
                The Supabase session IS the target's, so the admin can post,
                delete, message, and modify DB rows exactly as the target.
                Banner stays fixed on top with a one-tap exit. */}
            {impersonating && user && (
                <style>{`@keyframes taki-spin{to{transform:rotate(360deg)}}`}</style>
            )}
            {impersonating && user && (
                <div
                    style={{
                        position: 'fixed',
                        top: 'env(safe-area-inset-top, 0)',
                        insetInlineStart: 0,
                        insetInlineEnd: 0,
                        zIndex: 99999,
                        background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
                        color: 'white',
                        padding: '10px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        boxShadow: '0 6px 18px rgba(185, 28, 28, 0.55)',
                        fontFamily: 'inherit',
                    }}
                    dir={language === 'ar' ? 'rtl' : 'ltr'}
                >
                    <div style={{
                        fontWeight: 900,
                        fontSize: '0.85rem',
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                    }}>
                        <span style={{ fontSize: '1rem' }}>🔓</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            جَلسة كاملة كَـ <strong>{user?.name || '—'}</strong> ({user?.userType === 'seller' ? 'تاجر' : 'مُشتري'}) — كل تَعديل يَتم بِاسمه
                        </span>
                    </div>
                    <button
                        onClick={stopImpersonating}
                        disabled={stoppingImp}
                        style={{
                            background: 'white',
                            color: '#b91c1c',
                            border: 'none',
                            borderRadius: 999,
                            padding: '6px 14px',
                            fontWeight: 900,
                            fontSize: '0.78rem',
                            cursor: stoppingImp ? 'wait' : 'pointer',
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                            fontFamily: 'inherit',
                            opacity: stoppingImp ? 0.7 : 1,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                        }}
                    >
                        {stoppingImp ? (
                            <>
                                <span style={{
                                    display: 'inline-block', width: 12, height: 12,
                                    borderRadius: '50%',
                                    border: '2px solid rgba(185,28,28,0.3)',
                                    borderTopColor: '#b91c1c',
                                    animation: 'taki-spin 0.7s linear infinite',
                                }} />
                                جاري الرُّجوع...
                            </>
                        ) : (
                            <>🔙 رجوع للمدير</>
                        )}
                    </button>
                </div>
            )}

            {/* Admin "view as" badge — only visible while an admin is
                impersonating a buyer or seller. Tap to return to admin. */}
            {user?.userType === 'admin' && viewAs && (
                <button
                    onClick={() => { setViewAs(null); window.location.assign('/admin'); }}
                    style={{
                        position: 'fixed', bottom: 90, insetInlineStart: 16,
                        zIndex: 9999, padding: '10px 14px', borderRadius: 999,
                        background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                        color: 'white', fontWeight: 900, fontSize: '0.85rem',
                        border: 'none', cursor: 'pointer',
                        boxShadow: '0 6px 18px rgba(245,158,11,0.45)'
                    }}>
                    {language === 'ar'
                        ? `👁️ معاينة كـ${viewAs === 'buyer' ? 'مشترٍ' : 'تاجر'} — رجوع`
                        : `👁️ Previewing as ${viewAs} — exit`}
                </button>
            )}

            {/* Post-purchase store rating box (buyer) */}
            {ratingPrompt && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 99990,
                    background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
                }}>
                    <div className="animate-fade-in" style={{
                        background: 'var(--card-bg)', color: 'var(--text-primary)',
                        borderRadius: 24, width: '100%', maxWidth: 400,
                        boxShadow: '0 24px 60px rgba(0,0,0,0.4)', overflow: 'hidden',
                    }}>
                        <div style={{
                            background: 'linear-gradient(135deg, #0f172a, #334155)', color: '#fff',
                            padding: '22px 20px 18px', textAlign: 'center',
                        }}>
                            <div style={{ fontSize: '2.2rem', marginBottom: 4 }}>⭐</div>
                            <div style={{ fontSize: '1.12rem', fontWeight: 900 }}>
                                {language === 'ar' ? 'نرجو تقييم المتجر' : 'Please rate the store'}
                            </div>
                            <div style={{ fontSize: '0.83rem', fontWeight: 600, opacity: 0.9, marginTop: 5, lineHeight: 1.6 }}>
                                {language === 'ar'
                                    ? `تقييمك يهمّنا 🙏 — كيف كانت تجربتك مع «${ratingPrompt.storeName}»؟`
                                    : `Your feedback matters 🙏 — how was your experience with “${ratingPrompt.storeName}”?`}
                            </div>
                        </div>
                        <div style={{ padding: 20 }}>
                            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
                                {[1, 2, 3, 4, 5].map(star => (
                                    <button
                                        key={star}
                                        type="button"
                                        aria-label={`${star}`}
                                        onClick={() => setRatingStars(star)}
                                        style={{
                                            fontSize: '2rem', background: 'none', border: 'none',
                                            cursor: 'pointer', padding: 2,
                                            filter: star <= ratingStars ? 'none' : 'grayscale(1)',
                                            opacity: star <= ratingStars ? 1 : 0.35,
                                            transition: 'opacity 0.15s ease',
                                        }}
                                    >⭐</button>
                                ))}
                            </div>
                            <textarea
                                value={ratingComment}
                                onChange={e => setRatingComment(e.target.value)}
                                placeholder={language === 'ar' ? 'اكتب تعليقك عن المتجر (اختياري)...' : 'Write your comment about the store (optional)…'}
                                style={{
                                    width: '100%', padding: 14, borderRadius: 14, minHeight: 84,
                                    border: '1.5px solid var(--border-color)', background: 'var(--body-bg)',
                                    color: 'var(--text-primary)', fontSize: '0.9rem', outline: 'none',
                                    resize: 'none', marginBottom: 16, fontFamily: 'inherit',
                                }}
                            />
                            <button
                                onClick={async () => {
                                    if (ratingSubmitting) return;
                                    setRatingSubmitting(true);
                                    const ok = await addRating(ratingPrompt.dealId, { score: ratingStars, comment: ratingComment.trim() });
                                    setRatingSubmitting(false);
                                    setRatingPrompt(null);
                                    if (!ok) {
                                        customAlert(language === 'ar' ? '❌ تعذّر إرسال التقييم، حاول لاحقاً' : '❌ Could not submit your rating, try later');
                                    }
                                }}
                                disabled={ratingSubmitting}
                                style={{
                                    width: '100%', padding: 15, borderRadius: 16, border: 'none',
                                    background: 'var(--primary)', color: '#fff', fontWeight: 900,
                                    fontSize: '0.98rem', cursor: ratingSubmitting ? 'default' : 'pointer',
                                }}
                            >
                                {ratingSubmitting
                                    ? (language === 'ar' ? '⏳ جاري الإرسال...' : '⏳ Submitting…')
                                    : (language === 'ar' ? 'إرسال التقييم ✅' : 'Submit rating ✅')}
                            </button>
                            <button
                                onClick={() => setRatingPrompt(null)}
                                style={{
                                    width: '100%', padding: 10, marginTop: 10, background: 'none',
                                    border: 'none', color: 'var(--text-secondary)', fontWeight: 700,
                                    fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline',
                                }}
                            >
                                {language === 'ar' ? 'لاحقاً' : 'Later'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Global Custom Dialog */}
            {dialogConfig && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999,
                    padding: 20
                }}>
                    <div className="animate-fade-in" style={{
                        background: 'var(--card-bg, white)', color: 'var(--text-primary, #0f172a)',
                        padding: 24, borderRadius: 24, width: '100%', maxWidth: 400,
                        boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
                        textAlign: 'center'
                    }}>
                        <div style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: 24, lineHeight: 1.6 }}>{dialogConfig.message}</div>
                        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                            {dialogConfig.type === 'confirm' && (
                                <button onClick={() => { dialogConfig.resolve(false); setDialogConfig(null); }}
                                    style={{ flex: 1, padding: '12px', borderRadius: 14, border: 'none', background: 'var(--gray-100)', color: 'var(--gray-500, #64748b)', fontWeight: 800, fontSize: '1rem', cursor: 'pointer' }}>
                                    {language === 'ar' ? 'إلغاء' : 'Cancel'}
                                </button>
                            )}
                            <button onClick={() => { dialogConfig.resolve(true); setDialogConfig(null); }}
                                style={{ flex: 1, padding: '12px', borderRadius: 14, border: 'none', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', color: 'white', fontWeight: 800, fontSize: '1rem', cursor: 'pointer' }}>
                                {language === 'ar' ? 'موافق' : 'OK'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {promptConfig && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
                    zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
                }}>
                    <div style={{
                        backgroundColor: 'var(--card-bg)', borderRadius: 24, padding: 24,
                        width: '100%', maxWidth: 400, boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
                        textAlign: 'center'
                    }}>
                        <div style={{ fontSize: '1.1rem', fontWeight: 900, marginBottom: 20, color: 'var(--text-primary)' }}>{promptConfig.message}</div>
                        <textarea 
                            id="custom-prompt-input"
                            autoFocus
                            style={{ 
                                width: '100%', minHeight: 100, padding: 12, borderRadius: 12, 
                                border: '1.5px solid var(--border-color)', background: 'var(--body-bg)', 
                                color: 'var(--text-primary)', fontSize: '1rem', marginBottom: 20, outline: 'none' 
                            }} 
                        />
                        <div style={{ display: 'flex', gap: 12 }}>
                            <button onClick={() => {
                                const val = (document.getElementById('custom-prompt-input') as HTMLTextAreaElement).value;
                                promptConfig.resolve(val);
                                setPromptConfig(null);
                            }} style={{ flex: 1, padding: '14px', borderRadius: 12, backgroundColor: 'var(--primary)', color: 'white', border: 'none', fontWeight: 900, fontSize: '0.95rem' }}>
                                {language === 'ar' ? 'إرسال' : 'Send'}
                            </button>
                            <button onClick={() => {
                                promptConfig.resolve(null);
                                setPromptConfig(null);
                            }} style={{ flex: 1, padding: '14px', borderRadius: 12, backgroundColor: 'var(--gray-200)', color: 'var(--text-secondary)', border: 'none', fontWeight: 800, fontSize: '0.95rem' }}>
                                {language === 'ar' ? 'إلغاء' : 'Cancel'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </AppContext.Provider>
    );
};

export const useApp = () => {
    const context = useContext(AppContext);
    if (!context) throw new Error('useApp must be used within AppProvider');
    return context;
};
