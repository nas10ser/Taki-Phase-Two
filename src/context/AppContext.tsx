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
    addDeal: (deal: Deal) => Promise<void>;
    updateDeal: (deal: Deal) => Promise<void>;
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
    addReply: (dealId: string, userId: string, reply: string) => Promise<void>;
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

    const [loading, setLoading] = useState(true);

    const [topLocation, setTopLocationState] = useState<TopLocation>({ region: '', city: '', mall: '' });

    const [notifKeywords, setNotifKeywords] = useState<string[]>([]);
    const [smartAlerts, setSmartAlerts] = useState<SmartAlertRule[]>([]);

    const [storeProfiles, setStoreProfiles] = useState<Record<string, StoreProfile>>({});

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
        const initData = async () => {
            if (isInitializing) return;
            isInitializing = true;
            try {
                logger.info('🚀 Initializing App Context (Direct Remote Only)...');
                
                // SECURITY: Sync link feature removed — it accepted unsigned
                // Base64 payloads from URL params, allowing session hijacking.
                // Data synchronisation now relies exclusively on Supabase auth.

                logger.info('📡 Fetching state from remote...');
                setLoading(true);

                // Initial fetch
                await Promise.allSettled([
                    dealRepository.getAll().then(fetchedDeals => {
                        if (fetchedDeals) setDeals(fetchedDeals);
                    }),
                    userRepository.getCurrentUser().then(async currentUser => {
                        if (currentUser) {
                            logger.info(`👤 Session found: ${currentUser.name}`);
                            setUser(currentUser);
                            
                            // Background hydration
                            await Promise.allSettled([
                                userRepository.getFavorites().then(setFavorites),
                                notificationRepository.fetchByUserId(currentUser.id).then(setNotifications),
                                import('../repositories/bookingRepository').then(({ bookingRepository }) => 
                                    bookingRepository.getByUser(currentUser.id).then(setBookings)
                                )
                            ]);
                        }
                    }),
                    userRepository.getAllSellers().then(sellers => {
                        if (sellers) {
                            const profiles: Record<string, any> = {};
                            sellers.forEach(s => { profiles[s.id] = s; });
                            setStoreProfiles(profiles);
                        }
                    })
                ]);
            } catch (error) {
                console.error('❌ Failed to initialize app data:', error);
            } finally {
                setLoading(false);
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

                            // Fetch the canonical profile in the background — never
                            // block the auth callback on it.
                            const { userRepository: ur } = await import('../repositories/userRepository');
                            const existingProfile = await ur.findById(spUser.id).catch(() => null);

                            const profile = existingProfile || optimisticProfile;

                            if (existingProfile) {
                                setUser(existingProfile);
                                setFollowedMerchants(existingProfile.followedMerchants || []);
                            }

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
        setStoreProfiles(prev => {
            const updated = { ...prev, [storeId]: profile };
            // No localStorage — server is the source of truth for profiles
            return updated;
        });
    }, []);

    const updateProfile = useCallback(async (data: Partial<UserProfile>) => {
        if (!user) return;
        const updated = { ...user, ...data };
        setUser(updated);
        await userRepository.saveProfile(updated);
    }, [user]);

    const checkMarketingAlerts = useCallback(async (lat?: number, lng?: number) => {
        if (!user) return;

        // Server-side throttle: users.last_promo_check_at gates re-checks
        // to once per 6 hours. Falls back to in-memory ref if the column
        // is missing (older databases).
        const now = Date.now();
        const sixHours = 6 * 60 * 60 * 1000;
        try {
            const { supabase } = await import('../services/supabaseClient');
            const { data: throttleRow } = await supabase
                .from('users')
                .select('last_promo_check_at')
                .eq('id', user.id)
                .maybeSingle();
            if (throttleRow?.last_promo_check_at) {
                const last = new Date(throttleRow.last_promo_check_at).getTime();
                if (now - last < sixHours) return;
            }
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
                // Show campaigns the user hasn't seen yet
                let shownAny = false;
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
                        shownAny = true;
                        break; // Show one campaign at a time to avoid flooding
                    }
                }
                if (shownAny) {
                    try {
                        const { supabase } = await import('../services/supabaseClient');
                        await supabase
                            .from('users')
                            .update({ last_promo_check_at: new Date().toISOString() })
                            .eq('id', user.id);
                    } catch {}
                    return;
                }
            }
        } catch (e) {
            console.warn('Promo campaign fetch failed, falling back to local alerts:', e);
        }

        // ── Fallback: proximity-based alerts if no Supabase campaigns ──
        // Throttle is shared with the campaign branch via users.last_promo_check_at.
        const stampThrottle = async () => {
            try {
                const { supabase } = await import('../services/supabaseClient');
                await supabase.from('users')
                    .update({ last_promo_check_at: new Date().toISOString() })
                    .eq('id', user.id);
            } catch {}
        };

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
                stampThrottle();
            }
        } else if (user.userType === 'seller') {
            addNotification(
                user.id,
                { ar: '📈 زد مبيعاتك الآن!', en: '📈 Boost your sales now!' },
                { ar: 'العملاء يبحثون عن عروض جديدة في منطقتك! أضف عرضاً الآن لجذبهم. 🏬', en: 'Customers are looking for new deals in your area! Post a deal now to attract them. 🏬' },
                'marketing'
            );
            stampThrottle();
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
        setUser(null);
        setFavorites([]);
        setFollowedMerchants([]);
        setNotifications([]);
        setBookings([]);
        await authService.deleteAccount();
        // No localStorage to clear — server is source of truth
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
        if (dealToUpdate) {
            const newRating = {
                id: Date.now().toString(),
                userId: user?.id || 'anon',
                userName: user?.name || 'Anonymous',
                score: ratingData.score,
                comment: ratingData.comment,
                date: new Date().toISOString().split('T')[0]
            };
            const updatedDeal = { ...dealToUpdate, ratings: [...(dealToUpdate.ratings || []), newRating] };
            setDeals(prev => prev.map(d => d.id === dealId ? updatedDeal : d));
            await dealRepository.save(updatedDeal);

            // NOTIFY SELLER
            addNotification(
                dealToUpdate.storeId,
                { ar: '⭐ تقييم جديد!', en: '⭐ New Rating!' },
                { ar: `قام العميل ${user?.name || 'مجهول'} بتقييم منتجك ${dealToUpdate.itemName} بـ ${ratingData.score} نجوم`, en: `Customer ${user?.name || 'Anon'} rated ${dealToUpdate.itemName} with ${ratingData.score} stars` },
                'system',
                { dealId }
            );
        }
    }, [deals, user, addNotification]);

    const addReply = useCallback(async (dealId: string, userId: string, reply: string) => {
        const updatedDeals = deals.map(d => {
            if (d.id === dealId) {
                return {
                    ...d,
                    ratings: d.ratings?.map(r => r.userId === userId ? { ...r, reply } : r)
                };
            }
            return d;
        });
        setDeals(updatedDeals);

        // NOTIFY BUYER
        addNotification(
            userId,
            { ar: '💬 رد جديد على تعليقك', en: '💬 New reply to your review' },
            { ar: `قام صاحب المحل بالرد على تقييمك لمنتج ${deals.find(d => d.id === dealId)?.itemName}`, en: `The shop owner replied to your review of ${deals.find(d => d.id === dealId)?.itemName}` },
            'system',
            { dealId }
        );
    }, [deals, addNotification]);

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

        // Restore reserved quantity to the deal stock.
        if (target.deal && target.deal.quantity !== 'unlimited') {
            setDeals(prev => {
                const currentDeal = prev.find(d => d.id === target.deal.id);
                if (!currentDeal || currentDeal.quantity === 'unlimited') return prev;
                const restored = (currentDeal.quantity as number) + (target.bookedQuantity || 1);
                const next = prev.map(d => d.id === currentDeal.id ? { ...d, quantity: restored } : d);
                dealRepository.save({ ...currentDeal, quantity: restored }).catch(e =>
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

    const acknowledgeBooking = useCallback(async (barcode: string, note?: string) => {
        const target = bookings.find(b => b.barcode === barcode);
        if (!target || target.status !== 'pending') return;

        setBookings(prev => {
            const updated = prev.map(b => b.barcode === barcode ? { ...b, status: 'acknowledged' as const, notes: note || b.notes } : b);
            return updated;
        });

        bookingRepository.updateStatus(barcode, 'acknowledged', note).catch(e => {
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
        deals, loading, addDeal, updateDeal, deleteDeal,
        user, logout, deleteAccount,
        favorites, toggleFavorite,
        followedMerchants, toggleFollowMerchant,
        notifications, addNotification, markNotifRead,
        bookings, bookDeal, cancelBooking, completeBooking, acknowledgeBooking, refreshBookings, refreshDeals,
        addRating, addReply,
        topLocation, setTopLocation,
        notifKeywords, addNotifKeyword, removeNotifKeyword,
        smartAlerts, addSmartAlert, removeSmartAlert,
        storeProfiles, updateStoreProfile, updateProfile, checkMarketingAlerts,
        darkMode, toggleDarkMode,
        customAlert, customConfirm, customPrompt,
        viewAs, setViewAs, effectiveUserType,
        incrementDealView, incrementDealClick,
    }), [
        language, setLanguage,
        deals, loading, addDeal, updateDeal, deleteDeal,
        user, logout, deleteAccount,
        favorites, toggleFavorite,
        followedMerchants, toggleFollowMerchant,
        notifications, addNotification, markNotifRead,
        bookings, bookDeal, cancelBooking, completeBooking, acknowledgeBooking, refreshBookings, refreshDeals,
        addRating, addReply,
        topLocation, setTopLocation,
        notifKeywords, addNotifKeyword, removeNotifKeyword,
        smartAlerts, addSmartAlert, removeSmartAlert,
        storeProfiles, updateStoreProfile, updateProfile, checkMarketingAlerts,
        darkMode, toggleDarkMode,
        customAlert, customConfirm, customPrompt,
        viewAs, setViewAs, effectiveUserType,
        incrementDealView, incrementDealClick
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
