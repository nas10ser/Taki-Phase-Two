import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Deal, getLocation, CITIES } from '../data/mock';
import { getDistance, normalizeArabicNumerals, generateBarcode } from '../utils/helpers';
import { storageService } from '../services/storageService';
import { dealRepository } from '../repositories/dealRepository';
import { userRepository } from '../repositories/userRepository';
import { authService, UserProfile } from '../services/authService';
import { dealService } from '../services/dealService';
import { notificationRepository } from '../repositories/notificationRepository';
import { bookingRepository } from '../repositories/bookingRepository';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { SmartAlertRule } from '../services/authService';
import { pushService } from '../services/pushService';
import { realtimeService } from '../services/realtimeService';
import { supabase } from '../services/supabaseClient';

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

interface Notification {
    id: string;
    userId: string;
    title: { ar: string, en: string };
    body: { ar: string, en: string };
    type: 'booking' | 'deal' | 'system' | 'rating' | 'follow' | 'marketing';
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
    updateDeal: (deal: Deal) => Promise<void>;
    updateDealStock: (dealId: string, newQuantity: number | 'unlimited') => Promise<void>;
    deleteDeal: (id: string) => Promise<void>;
    user: any;
    logout: () => void;
    deleteAccount: () => void;
    favorites: string[];
    toggleFavorite: (dealId: string) => Promise<void>;
    followedMerchants: string[];
    toggleFollowMerchant: (merchantId: string) => Promise<void>;
    notifications: Notification[];
    addNotification: (userId: string, title: { ar: string, en: string }, body: { ar: string, en: string }, type: Notification['type'], metadata?: any) => Promise<void>;
    markNotifRead: (id: string) => void;
    addRating: (dealId: string, ratingData: { score: number, comment: string }) => Promise<void>;
    addReply: (dealId: string, ratingId: string, reply: string) => Promise<void>;
    toggleRatingLike: (dealId: string, ratingId: string) => Promise<void>;
    removeRating: (dealId: string, ratingId: string) => Promise<void>;
    topLocation: TopLocation;
    setTopLocation: (loc: TopLocation) => void;
    notifKeywords: string[];
    addNotifKeyword: (kw: string) => void;
    removeNotifKeyword: (kw: string) => void;
    smartAlerts: SmartAlertRule[];
    addSmartAlert: (rule: SmartAlertRule) => void;
    removeSmartAlert: (idx: number) => void;
    bookings: any[];
    bookDeal: (deal: Deal, quantity?: number, userId?: string, prepTime?: string, notes?: string) => any;
    cancelBooking: (barcode: string) => void;
    completeBooking: (barcode: string) => void;
    acknowledgeBooking: (barcode: string, note?: string) => void;
    customPrompt: (message: string) => Promise<string | null>;
    refreshBookings: () => Promise<void>;
    refreshDeals: () => Promise<void>;
    storeProfiles: Record<string, StoreProfile>;
    updateStoreProfile: (storeId: string, profile: StoreProfile) => void;
    updateProfile: (data: Partial<UserProfile>) => Promise<void>;
    checkMarketingAlerts: (lat?: number, lng?: number) => void;
    darkMode: boolean;
    toggleDarkMode: () => void;
    customAlert: (message: string) => Promise<void>;
    customConfirm: (message: string) => Promise<boolean>;
    // Admin "view-as" impersonation. Reflects what role the UI should
    // render — the underlying user.userType stays unchanged. null = real role.
    viewAs: 'buyer' | 'seller' | null;
    setViewAs: (role: 'buyer' | 'seller' | null) => void;
    effectiveUserType: 'buyer' | 'seller' | 'admin';
    incrementDealView: (dealId: string) => Promise<void>;
    incrementDealClick: (dealId: string) => Promise<void>;
    /** Platform-wide feature flags driven by `platform_settings`. Each flag
     *  is admin-controlled; updates propagate via realtime. */
    platformSettings: { seasonalOffersVisible: boolean };
}


const DATA_VERSION = '4.0'; // Persistence upgrade

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [language, setLanguageState] = useState<'ar' | 'en'>('ar');

    const [deals, setDeals] = useState<Deal[]>([]);
    const dealsRef = useRef<Deal[]>([]);
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
    // True once the initial Supabase session check has resolved (success OR
    // failure). Distinguishes "still hydrating" from "definitively a guest".
    // Without this, AuthRedirector kicks logged-in admins off /admin on
    // refresh because user is briefly null while the session loads.
    const [isAuthReady, setIsAuthReady] = useState<boolean>(false);
    const [favorites, setFavorites] = useState<string[]>([]);
    const favoritesRef = useRef<string[]>([]);
    useEffect(() => { favoritesRef.current = favorites; }, [favorites]);
    const [followedMerchants, setFollowedMerchants] = useState<string[]>([]);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [bookings, setBookings] = useState<any[]>([]);

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

    const [loading, setLoading] = useState(true);

    const [topLocation, setTopLocationState] = useState<TopLocation>({ region: '', city: '', mall: '' });

    const [notifKeywords, setNotifKeywords] = useState<string[]>([]);
    const [smartAlerts, setSmartAlerts] = useState<SmartAlertRule[]>([]);

    const [storeProfiles, setStoreProfiles] = useState<Record<string, StoreProfile>>({});

    // Platform-wide feature flags read from `platform_settings`. Defaults are
    // conservative (off) so the UI never accidentally exposes a section before
    // the admin opts in. Realtime listener below keeps every client in sync
    // the instant the admin flips a toggle.
    const [platformSettings, setPlatformSettings] = useState<{
        seasonalOffersVisible: boolean;
    }>({ seasonalOffersVisible: false });

    // Load platform settings + subscribe to realtime updates so admin toggles
    // propagate to every open tab without requiring a refresh.
    useEffect(() => {
        let cancelled = false;
        const apply = (key: string, value: any) => {
            if (cancelled) return;
            if (key === 'seasonal_offers_visible') {
                setPlatformSettings(prev => ({ ...prev, seasonalOffersVisible: value === true }));
            }
        };
        (async () => {
            try {
                const { data } = await supabase
                    .from('platform_settings')
                    .select('key, value')
                    .in('key', ['seasonal_offers_visible']);
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
                            logger.info(`👤 Session found: ${currentUser.name}`);
                            setUser(currentUser);
                            // Background hydration of user-specific data — does
                            // not gate isAuthReady; pages render immediately.
                            Promise.allSettled([
                                userRepository.getFavorites().then(setFavorites),
                                notificationRepository.fetchByUserId(currentUser.id).then(setNotifications),
                                import('../repositories/bookingRepository').then(({ bookingRepository }) =>
                                    bookingRepository.getByUser(currentUser.id).then(setBookings)
                                ),
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
                        if (fetchedDeals) setDeals(fetchedDeals);
                    }),
                    userRepository.getAllSellers().then(sellers => {
                        if (sellers) {
                            const profiles: Record<string, any> = {};
                            sellers.forEach(s => { profiles[s.id] = s; });
                            setStoreProfiles(profiles);
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
                            setUser(null);
                            authService.setUser(null as any);
                            setBookings([]);
                            setNotifications([]);
                            setFavorites([]);
                            setFollowedMerchants([]);
                            setIsAuthReady(true);
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
                                followedMerchants: []
                            };

                            setUser((prev: any) => {
                                if (prev && prev.id !== optimisticProfile.id) {
                                    setBookings([]);
                                    setNotifications([]);
                                    setFavorites([]);
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

                            // Fetch the canonical profile in the background — never
                            // block the auth callback on it.
                            const { userRepository: ur } = await import('../repositories/userRepository');
                            const existingProfile = await ur.findById(spUser.id).catch(() => null);

                            const profile = existingProfile || optimisticProfile;

                            if (existingProfile) {
                                setUser(existingProfile);
                                setFollowedMerchants(existingProfile.followedMerchants || []);
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
                                br.getByUser(spUser.id).then(setBookings).catch(() => {})
                            );
                            import('../repositories/notificationRepository').then(({ notificationRepository: nr }) =>
                                nr.fetchByUserId(spUser.id).then(setNotifications).catch(() => {})
                            );
                            userRepository.getFavorites().then(setFavorites).catch(() => {});
                            userRepository.getFollowedMerchants().then(setFollowedMerchants).catch(() => {});
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

        // Throttle: once per 24h. Primary throttle is localStorage (per-device,
        // never fails) — the DB column is a backup so different devices stay
        // mostly in sync. Stamp BEFORE creating the notification so a slow
        // network or RLS hiccup can't bypass the gate.
        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;
        const lsKey = `TAKI_LAST_PROMO_${user.id}`;
        try {
            const lsLast = Number(localStorage.getItem(lsKey)) || 0;
            if (lsLast && now - lsLast < dayMs) return;
        } catch {}

        try {
            const { supabase } = await import('../services/supabaseClient');
            const { data: throttleRow } = await supabase
                .from('users')
                .select('last_promo_check_at')
                .eq('id', user.id)
                .maybeSingle();
            if (throttleRow?.last_promo_check_at) {
                const last = new Date(throttleRow.last_promo_check_at).getTime();
                if (now - last < dayMs) {
                    try { localStorage.setItem(lsKey, String(last)); } catch {}
                    return;
                }
            }
        } catch {}

        // Stamp throttle FIRST. If the user closes the tab mid-fetch, we
        // still won't show the notification on the next visit within 24h.
        try { localStorage.setItem(lsKey, String(now)); } catch {}
        const stampDb = async () => {
            try {
                const { supabase } = await import('../services/supabaseClient');
                await supabase.from('users')
                    .update({ last_promo_check_at: new Date(now).toISOString() })
                    .eq('id', user.id);
            } catch {}
        };
        stampDb();

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
        setUser(null);
        setFavorites([]);
        setFollowedMerchants([]);
        setNotifications([]);
        setBookings([]);
        setSmartAlerts([]);
        // Drop the device's push subscription so the previous account
        // doesn't keep receiving alerts on this hardware.
        pushService.unsubscribe().catch(() => {});
        // Don't await — the UI is already in the logged-out state. Awaiting
        // signOut just delays the next interaction (e.g. typing in the login
        // form) without changing the outcome.
        authService.logout().catch(e => console.warn('Signout deferred:', e));
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

        // 1. Optimistic local update first — UI is instant.
        // Functional update + dedup-by-id so a rapid double-click or a
        // realtime INSERT race never produces two rows for the same deal.
        setDeals(prev => {
            const filtered = prev.filter(d => d.id !== dealWithTime.id);
            const next = [dealWithTime, ...filtered];
            return next;
        });

        // 2. Ensure FK target exists in users(id) before deal insert.
        if (user) {
            try {
                await userRepository.saveProfile(user);
            } catch (e) {
                console.warn('Profile sync before deal failed (continuing):', e);
            }
        }

        // 3. Remote upsert. If this fails, surface a clear message but keep local copy.
        try {
            await dealRepository.save(dealWithTime);
            logger.log('✅ Deal saved successfully');
        } catch (error: any) {
            console.error('❌ Failed to save deal to database:', error);
            const msg: string = error?.message || '';
            // Auth-token lock contention is a transient browser-tab race, not
            // a sync failure — the next refresh will pick up the deal. Don't
            // alarm the user.
            const isTransientLock = /lock.*auth-token|stole it|NavigatorLock/i.test(msg);
            if (!isTransientLock) {
                customAlert(
                    language === 'ar'
                        ? `⚠️ تم الحفظ محلياً لكن المزامنة مع السيرفر فشلت. سيتم المحاولة مجدداً عند الاتصال.${msg ? `\n(${msg})` : ''}`
                        : `⚠️ Saved locally but server sync failed. Will retry when reconnected.${msg ? `\n(${msg})` : ''}`
                );
            }
        }
        
        // Note: Follower and Smart Alert notifications are handled 100%
        // server-side by the tr_deal_smart_notifications trigger (migration v8.11).
        // The server fires instantly when the deal row is inserted — no client needed.
    }, [deals, user, language, customAlert]);

    const updateDeal = useCallback(async (deal: Deal) => {
        // Optimistic local update
        setDeals(prev => {
            const next = prev.map(d => d.id === deal.id ? deal : d);
            return next;
        });
        try {
            await dealRepository.save(deal);
            // Re-fetch the row to confirm persistence — guards against the
            // realtime listener missing the UPDATE packet (a recurring issue
            // when the user pauses a deal: the local state showed paused,
            // but a stale realtime echo or a missed packet flipped it back
            // to active until the user manually refreshed several times).
            const fresh = await dealRepository.getById(deal.id).catch(() => null);
            if (fresh) {
                setDeals(prev => prev.map(d => d.id === fresh.id ? fresh : d));
            }
        } catch (error: any) {
            console.error('Failed to update deal in database:', error);
            // Roll back the optimistic update so the UI doesn't lie about
            // what's persisted. The user sees the alert and the deal
            // visibly reverts, instead of appearing to succeed.
            try {
                const original = await dealRepository.getById(deal.id);
                if (original) {
                    setDeals(prev => prev.map(d => d.id === original.id ? original : d));
                }
            } catch { /* best-effort rollback */ }
            const msg: string = error?.message || '';
            const isTransientLock = /lock.*auth-token|stole it|NavigatorLock/i.test(msg);
            customAlert(
                language === 'ar'
                    ? (isTransientLock
                        ? '⚠️ المزامنة تأخرت — حاول مرة أخرى بعد ثوانٍ.'
                        : `⚠️ تعذّر حفظ التغيير في قاعدة البيانات.${msg ? `\n(${msg})` : ''}`)
                    : (isTransientLock
                        ? '⚠️ Sync delayed — try again in a few seconds.'
                        : `⚠️ Could not save change to database.${msg ? `\n(${msg})` : ''}`)
            );
        }
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

    const addRating = useCallback(async (dealId: string, ratingData: { score: number, comment: string }) => {
        const dealToUpdate = deals.find(d => d.id === dealId);
        if (!dealToUpdate || !user) return;

        // Persist to the dedicated `ratings` table (migration v9.17). Old code
        // stored reviews inside the deal row, which never made the round-trip
        // because dealRepository.save() doesn't include ratings — they were
        // silently lost on every page reload.
        const { ratingRepository } = await import('../repositories/ratingRepository');
        const created = await ratingRepository.create({
            dealId,
            userId: user.id,
            userName: user.name || 'مستخدم',
            score: ratingData.score,
            comment: ratingData.comment,
        });
        if (!created) return;

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

        addNotification(
            dealToUpdate.storeId,
            { ar: '⭐ تقييم جديد!', en: '⭐ New Rating!' },
            { ar: `قام العميل ${user.name || 'مجهول'} بتقييم منتجك ${dealToUpdate.itemName} بـ ${ratingData.score} نجوم`, en: `Customer ${user.name || 'Anon'} rated ${dealToUpdate.itemName} with ${ratingData.score} stars` },
            'system',
            { dealId }
        );
    }, [deals, user, addNotification]);

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

    const addSmartAlert = useCallback((rule: SmartAlertRule) => {
        const updated = [...smartAlerts, rule];
        setSmartAlerts(updated);
        if (user) userRepository.saveProfile({ ...user, smartAlerts: updated });
    }, [smartAlerts, user]);

    const removeSmartAlert = useCallback((idx: number) => {
        const updated = smartAlerts.filter((_, i) => i !== idx);
        setSmartAlerts(updated);
        if (user) userRepository.saveProfile({ ...user, smartAlerts: updated });
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
            userPhone: user?.phone || '',
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

    const cancelBooking = useCallback((barcode: string) => {
        // Atomic transition: read + flip status inside the updater so rapid
        // double-clicks can't restore quantity twice or fire two notifications.
        const target = bookings.find(b => b.barcode === barcode);
        if (!target || target.status === 'cancelled' || target.status === 'completed') return;

        setBookings(prev => {
            const updated = prev.map(b => b.barcode === barcode ? { ...b, status: 'cancelled' } : b);
            return updated;
        });

        if (!target) return;

        bookingRepository.updateStatus(barcode, 'cancelled').catch(e =>
            console.warn('Booking status sync deferred:', e?.message || e)
        );

        // Restore reserved quantity to the deal stock. Same partial-update
        // path as booking — never touch `status` so the subscription guard
        // trigger can't block a cancellation either.
        if (target.deal && target.deal.quantity !== 'unlimited') {
            setDeals(prev => {
                const currentDeal = prev.find(d => d.id === target.deal.id);
                if (!currentDeal || currentDeal.quantity === 'unlimited') return prev;
                const restored = (currentDeal.quantity as number) + (target.bookedQuantity || 1);
                const next = prev.map(d => d.id === currentDeal.id ? { ...d, quantity: restored } : d);
                dealRepository.updateQuantity(currentDeal.id, restored).catch(e =>
                    console.warn('Deal qty restore sync deferred:', e?.message || e)
                );
                return next;
            });
        }

        // Notification rows for both buyer and seller are emitted by the
        // server trigger `tr_booking_notification` on the status change.
    }, [user, bookings]);

    const completeBooking = useCallback((barcode: string) => {
        const target = bookings.find(b => b.barcode === barcode);
        if (!target || target.status === 'completed' || target.status === 'cancelled') return;

        setBookings(prev => {
            const updated = prev.map(b => b.barcode === barcode ? { ...b, status: 'completed' } : b);
            return updated;
        });

        bookingRepository.updateStatus(barcode, 'completed').catch(e => {
            console.warn('Booking status sync deferred:', e?.message || e);
            customAlert(language === 'ar'
                ? `⚠️ لم يتم مزامنة التحديث: ${e?.message || 'خطأ غير معروف'}`
                : `⚠️ Sync failed: ${e?.message || 'Unknown error'}`);
        });

        // Notifications for both parties are emitted by the server trigger
        // on this status change. Quantity was reserved at booking time so
        // completion does NOT deduct again.
    }, [bookings, language, customAlert]);

    const acknowledgeBooking = useCallback(async (barcode: string, merchantNote?: string) => {
        const target = bookings.find(b => b.barcode === barcode);
        if (!target || target.status !== 'pending') return;

        // Save merchantNote on its own field so the buyer's `notes` is
        // preserved. Buyer's note (e.g. "extra ketchup") and seller's note
        // (e.g. "ready in 10 min, side door") are independent messages.
        setBookings(prev => {
            const updated = prev.map(b => b.barcode === barcode
                ? { ...b, status: 'acknowledged' as const, merchantNote: merchantNote || b.merchantNote }
                : b);
            return updated;
        });

        bookingRepository.updateStatus(barcode, 'acknowledged', merchantNote).catch(e => {
            console.warn('Booking status sync deferred:', e?.message || e);
            customAlert(language === 'ar'
                ? `⚠️ لم يتم مزامنة التحديث: ${e?.message || 'خطأ غير معروف'}`
                : `⚠️ Sync failed: ${e?.message || 'Unknown error'}`);
        });

        // Buyer notification is emitted by the server trigger on this status
        // change.
    }, [bookings, language, customAlert]);

    // Public refresh — for pages that mount after a booking event and want to
    // guarantee parity with the server even if a realtime packet was missed.
    const refreshBookings = useCallback(async () => {
        if (!user?.id) return;
        try {
            const fresh = await bookingRepository.getByUser(user.id);
            setBookings(fresh);
        } catch (e) {
            console.warn('refreshBookings failed:', e);
        }
    }, [user?.id]);

    // Same idea for deals — Home calls this on mount / focus so a freshly
    // posted deal appears even if the global realtime packet was dropped.
    const refreshDeals = useCallback(async () => {
        try {
            const fresh = await dealRepository.getAll();
            if (fresh) setDeals(fresh);
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
                if (user?.id === n.user_id) showRealTimeAlert(mapped.title, mapped.body);
            },
            onNotificationUpdate: (payload) => {
                if (payload.eventType === 'DELETE') {
                    setNotifications(prev => prev.filter(n => n.id !== payload.old.id));
                } else if (payload.eventType === 'UPDATE' && payload.new) {
                    setNotifications(prev => prev.map(n => n.id === payload.new.id ? { ...n, isRead: !!payload.new.is_read } : n));
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
                                ? { ...b, status: reconcileStatus(b.status, updated.status), notes: updated.notes || b.notes }
                                : b);
                        }
                        return prev;
                    });
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
                                    addNotification(
                                        user.id,
                                        { ar: '💸 انخفض سعر منتج في مفضلتك!', en: '💸 Price drop on a favorite!' },
                                        { ar: `${updated.item_name}: ${updated.discounted_price} ر.س (كان ${before.discounted_price} ر.س)`, en: `${updated.item_name}: ${updated.discounted_price} SAR (was ${before.discounted_price} SAR)` },
                                        'deal',
                                        { dealId: updated.id }
                                    );
                                } else if (restocked) {
                                    addNotification(
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
                     setUser((prev: any) => ({
                         ...prev,
                         name: newUser.name,
                         phone: newUser.phone,
                         shop: newUser.shop,
                         bio: newUser.bio,
                         avatar_url: newUser.avatar_url,
                         contactPhone: newUser.contact_phone,
                         followedMerchants: newFollowed || prev.followedMerchants,
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
                await Promise.allSettled([
                    import('../repositories/dealRepository').then(({ dealRepository: dr }) => dr.getAll().then(fresh => fresh && setDeals(fresh))),
                    user?.id ? import('../repositories/bookingRepository').then(({ bookingRepository: br }) => br.getByUser(user.id).then(setBookings)) : Promise.resolve(),
                    user?.id ? import('../repositories/notificationRepository').then(({ notificationRepository: nr }) => nr.fetchByUserId(user.id).then(setNotifications)) : Promise.resolve(),
                    user?.id ? import('../repositories/userRepository').then(({ userRepository: ur }) => ur.getFavorites().then(setFavorites)) : Promise.resolve(),
                    import('../repositories/userRepository').then(({ userRepository: ur }) => ur.getAllSellers().then(sellers => {
                        const profiles: Record<string, any> = {};
                        sellers.forEach(s => { profiles[s.id] = s; });
                        setStoreProfiles(profiles);
                    }))
                ]);
            }
        });

        return () => disconnect();
    }, [user?.id, showRealTimeAlert, reconcileStatus, addNotification]);

    // Effective user-type for rendering. Admins can flip into buyer/seller
    // preview mode via setViewAs; non-admins always see their real role.
    const effectiveUserType: 'buyer' | 'seller' | 'admin' =
        (user?.userType === 'admin' && viewAs) ? viewAs : (user?.userType || 'buyer');

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

    // Memoize the context value to prevent unnecessary re-renders
    const contextValue = useMemo(() => ({
        language, setLanguage,
        deals, loading, isAuthReady, addDeal, updateDeal, updateDealStock, deleteDeal,
        user, logout, deleteAccount,
        favorites, toggleFavorite,
        followedMerchants, toggleFollowMerchant,
        notifications, addNotification, markNotifRead,
        bookings, bookDeal, cancelBooking, completeBooking, acknowledgeBooking, refreshBookings, refreshDeals,
        addRating, addReply, toggleRatingLike, removeRating,
        topLocation, setTopLocation,
        notifKeywords, addNotifKeyword, removeNotifKeyword,
        smartAlerts, addSmartAlert, removeSmartAlert,
        storeProfiles, updateStoreProfile, updateProfile, checkMarketingAlerts,
        darkMode, toggleDarkMode,
        customAlert, customConfirm, customPrompt,
        viewAs, setViewAs, effectiveUserType,
        incrementDealView, incrementDealClick,
        platformSettings,
    }), [
        language, setLanguage,
        deals, loading, isAuthReady, addDeal, updateDeal, updateDealStock, deleteDeal,
        user, logout, deleteAccount,
        favorites, toggleFavorite,
        followedMerchants, toggleFollowMerchant,
        notifications, addNotification, markNotifRead,
        bookings, bookDeal, cancelBooking, completeBooking, acknowledgeBooking, refreshBookings, refreshDeals,
        addRating, addReply, toggleRatingLike, removeRating,
        topLocation, setTopLocation,
        notifKeywords, addNotifKeyword, removeNotifKeyword,
        smartAlerts, addSmartAlert, removeSmartAlert,
        storeProfiles, updateStoreProfile, updateProfile, checkMarketingAlerts,
        darkMode, toggleDarkMode,
        customAlert, customConfirm, customPrompt,
        viewAs, setViewAs, effectiveUserType,
        incrementDealView, incrementDealClick,
        platformSettings,
    ]);

    return (
        <AppContext.Provider value={contextValue}>
            {children}

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
