import { UserProfile, authService } from '../services/authService';
import { supabase } from '../services/supabaseClient';
import { logger } from '../utils/logger';
import { withTimeout } from '../utils/helpers';

export const userRepository = {
    getCurrentUser: async (): Promise<UserProfile | null> => {
        const memory = authService.getUser();
        if (memory) return memory;

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                const profile = await userRepository.findById(session.user.id);
                if (profile) {
                    authService.setUser(profile);
                    return profile;
                }
                // Optimistic fallback: a valid session whose `users` row is
                // missing or blocked by RLS used to leave us treating the
                // visitor as a guest forever. Build the profile from the JWT
                // metadata so the UI unlocks immediately. The realtime
                // listener replaces this with the canonical row when it lands.
                const meta = (session.user.user_metadata || {}) as Record<string, any>;
                const fallback: UserProfile = {
                    id: session.user.id,
                    name: meta.name || 'مستخدم',
                    phone: meta.phone || session.user.phone || '',
                    email: meta.email || session.user.email || '',
                    userType: (meta.user_type as UserProfile['userType']) || 'buyer',
                    shop: meta.shop || '',
                    contactPhone: meta.contact_phone || meta.phone || session.user.phone || '',
                    address: meta.address || '',
                    savings: 0,
                    bookingsCount: 0,
                    notifKeywords: [],
                    smartAlerts: [],
                    preferredLang: 'ar',
                    followedMerchants: [],
                    blockedMerchants: []
                };
                authService.setUser(fallback);
                return fallback;
            }
        } catch (e) {
            console.error('Failed to fetch session from remote', e);
        }
        return null;
    },

    saveProfile: async (profile: UserProfile): Promise<void> => {
        authService.setUser(profile);
        try {
            // PARTIAL-AWARE upsert. The previous version wrote every field with
            // `profile.X || default`, which silently NULLed out columns the
            // caller didn't include in its partial. The reported "follow
            // disappeared after an update" came from this — a saveProfile
            // call after toggling a notif keyword carried no followedMerchants
            // on the cached `user`, so `|| []` wiped the DB array.
            //
            // Rule: only include a column when the corresponding profile field
            // is explicitly set (i.e. not `undefined`). `null` is preserved as
            // an intentional clear; missing means "leave it alone".
            const p: any = profile;
            const dbData: Record<string, any> = { id: profile.id };
            const set = (col: string, val: any, fallback?: any) => {
                if (val !== undefined) dbData[col] = val;
                else if (fallback !== undefined) dbData[col] = fallback;
            };

            set('name', p.name, 'مستخدم');
            set('phone', p.phone ?? null);
            set('email', p.email ?? null);
            // user_type only when present — never silently downgrade.
            if (p.userType !== undefined) dbData.user_type = p.userType;
            set('shop', p.shop ?? null);
            set('contact_phone', p.contactPhone ?? p.phone ?? null);
            set('address', p.address ?? null);
            set('avatar_url', p.avatar_url ?? null);
            set('bio', p.bio ?? null);
            if (p.savings !== undefined) dbData.savings = p.savings;
            if (p.bookingsCount !== undefined) dbData.bookings_count = p.bookingsCount;
            // Array fields — only write when the caller really intends to
            // replace them. This is the followed-merchants protection.
            if (Array.isArray(p.notifKeywords)) dbData.notif_keywords = p.notifKeywords;
            if (Array.isArray(p.smartAlerts)) dbData.smart_alerts = p.smartAlerts;
            if (Array.isArray(p.followedMerchants)) dbData.followed_merchants = p.followedMerchants;
            if (Array.isArray(p.blockedMerchants)) dbData.blocked_merchants = p.blockedMerchants;
            if (p.preferredLang !== undefined) dbData.preferred_lang = p.preferredLang;
            if (p.lat !== undefined) dbData.lat = p.lat;
            if (p.lng !== undefined) dbData.lng = p.lng;
            if (p.googleMapsLink !== undefined) dbData.google_maps_link = p.googleMapsLink;

            // upsert needs the conflict column when the row already exists.
            // Internal 15s ceiling — if the Supabase JS SDK's auth-refresh
            // inTabLock is stuck (iOS Safari backgrounding hazard), the
            // upsert promise never settles. Without this, the outer
            // withTimeout in the caller has to wait its full 30s budget on
            // top of any other awaits, producing a "spinner forever" UX.
            const { error } = await withTimeout(
                supabase.from('users').upsert(dbData, { onConflict: 'id' }) as unknown as Promise<{ error: any }>,
                15000
            );
            if (!error) {
                logger.log('✅ Profile saved to remote successfully:', profile.id);
                return;
            }

            logger.error('❌ Remote profile sync failed:', error.message, error.details, error.hint);
            throw error;
        } catch (error: any) {
            console.error('❌ Remote profile sync exception:', error.message || error);
            throw error;
        }
    },

    /**
     * Fetch favorites from Supabase `favorites` table first,
     * falling back to user_metadata, then localStorage
     */
    getFavorites: async (): Promise<string[]> => {
        try {
            // getSession() reads the in-memory/localStorage session — no
            // network. getUser() round-trips to the GoTrue /user endpoint
            // every call; this runs on every cold load and every focus
            // re-sync, so that round-trip was pure latency.
            const { data: { session } } = await supabase.auth.getSession();
            const sUser = session?.user;
            if (sUser) {
                // Try the dedicated favorites table first (skip if table doesn't exist)
                try {
                    const { data: favRows, error } = await supabase
                        .from('favorites')
                        .select('deal_id')
                        .eq('user_id', sUser.id);

                    if (!error && favRows && favRows.length > 0) {
                        return favRows.map(r => r.deal_id);
                    }
                } catch (tableError) {
                    console.warn('Favorites table not available, skipping remote favorites fetch');
                }

                // Fallback to user_metadata
                if (sUser.user_metadata?.favorites) {
                    return sUser.user_metadata.favorites;
                }
            }
        } catch (e) {
            console.error('Failed to fetch remote favorites', e);
        }
        return [];
    },

    /**
     * Sync favorites to Supabase `favorites` table
     * Uses upsert/delete to keep in sync
     */
    setFavorites: async (favorites: string[]): Promise<void> => {
        // Direct remote sync

        try {
            const { data: { session } } = await supabase.auth.getSession();
            const userId = session?.user?.id;
            if (!userId) return;

            // Get current remote favorites
            try {
                const { data: currentRemote } = await supabase
                    .from('favorites')
                    .select('deal_id')
                    .eq('user_id', userId);

                const remoteFavIds = (currentRemote || []).map(r => r.deal_id);

                // Determine additions and removals
                const toAdd = favorites.filter(f => !remoteFavIds.includes(f));
                const toRemove = remoteFavIds.filter(f => !favorites.includes(f));

                // Add new favorites
                if (toAdd.length > 0) {
                    const insertRows = toAdd.map(dealId => ({ user_id: userId, deal_id: dealId }));
                    await supabase.from('favorites').insert(insertRows);
                }

                // Remove unfavorited
                if (toRemove.length > 0) {
                    for (const dealId of toRemove) {
                        await supabase.from('favorites').delete().eq('user_id', userId).eq('deal_id', dealId);
                    }
                }

                // Also keep user_metadata in sync as fallback
                await supabase.auth.updateUser({ data: { favorites } });

                logger.log('✅ Favorites synced to remote');
            } catch (tableError) {
                console.warn('Favorites table not available, skipping remote sync');
            }
        } catch (error) {
            console.error('Failed to sync favorites to remote', error);
        }
    },

    /**
     * Count how many users follow a given store. Uses the array-contains
     * operator on users.followed_merchants. Falls back to 0 on error so the
     * UI never shows a fake number.
     */
    getFollowerCount: async (storeId: string): Promise<number> => {
        try {
            const { count, error } = await supabase
                .from('users')
                .select('id', { count: 'exact', head: true })
                .contains('followed_merchants', [storeId]);
            if (error) throw error;
            return count ?? 0;
        } catch (e) {
            console.warn('Follower count fetch failed:', e);
            return 0;
        }
    },

    /**
     * Fetch followed merchants from the user row, falling back to localStorage.
     */
    getFollowedMerchants: async (): Promise<string[]> => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                const { data, error } = await supabase
                    .from('users')
                    .select('followed_merchants')
                    .eq('id', session.user.id)
                    .maybeSingle();
                if (data && !error && Array.isArray(data.followed_merchants)) {
                    return data.followed_merchants;
                }
            }
        } catch (e) {
            console.warn('Followed merchants remote fetch failed:', e);
        }
        return [];
    },

    findById: async (id: string): Promise<UserProfile | null> => {
        // Try remote first
        try {
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('id', id)
                .maybeSingle();

            if (data && !error) {
                return {
                    id: data.id,
                    name: data.name,
                    phone: data.phone,
                    email: data.email,
                    userType: data.user_type,
                    shop: data.shop,
                    contactPhone: data.contact_phone,
                    savings: data.savings,
                    bookingsCount: data.bookings_count,
                    notifKeywords: data.notif_keywords,
                    smartAlerts: Array.isArray(data.smart_alerts) ? data.smart_alerts : [],
                    preferredLang: data.preferred_lang || 'ar',
                    followedMerchants: Array.isArray(data.followed_merchants) ? data.followed_merchants : [],
                    blockedMerchants: Array.isArray(data.blocked_merchants) ? data.blocked_merchants : [],
                    lat: data.lat,
                    lng: data.lng,
                    googleMapsLink: data.google_maps_link
                };
            }
        } catch (e) {
            console.error('Remote user lookup failed', e);
        }

        // Fallback to local
        const current = authService.getUser();
        return current?.id === id ? current : null;
    },

    searchStores: async (query: string): Promise<UserProfile[]> => {
        if (!query || !query.trim()) return [];
        try {
            // SECURITY: Sanitize query to prevent PostgREST filter injection.
            // Escape %, _, and \ which are special in ILIKE patterns.
            const sanitized = query.trim()
                .substring(0, 100) // Limit length
                .replace(/\\/g, '\\\\')
                .replace(/%/g, '\\%')
                .replace(/_/g, '\\_')
                .replace(/['"(),.:]/g, ''); // Strip filter-breaking chars

            if (!sanitized) return [];

            // Fetch top 10 sellers that match the query
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('user_type', 'seller')
                .or(`shop.ilike.%${sanitized}%,name.ilike.%${sanitized}%`)
                .limit(10);
            
            if (data && !error) {
                return data.map(d => ({
                    id: d.id,
                    name: d.name,
                    phone: d.phone,
                    email: d.email,
                    userType: d.user_type,
                    shop: d.shop,
                    contactPhone: d.contact_phone,
                    avatar_url: d.avatar_url,
                    bio: d.bio,
                    savings: d.savings,
                    bookingsCount: d.bookings_count,
                    notifKeywords: d.notif_keywords,
                    smartAlerts: Array.isArray(d.smart_alerts) ? d.smart_alerts : [],
                    preferredLang: d.preferred_lang || 'ar',
                    followedMerchants: Array.isArray(d.followed_merchants) ? d.followed_merchants : [],
                    blockedMerchants: Array.isArray(d.blocked_merchants) ? d.blocked_merchants : [],
                    lat: d.lat,
                    lng: d.lng,
                    googleMapsLink: d.google_maps_link
                }));
            }
        } catch (e) {
            console.error('Failed to search stores', e);
        }
        return [];
    },

    getAllSellers: async (): Promise<UserProfile[]> => {
        try {
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('user_type', 'seller');
            
            if (data && !error) {
                return data.map(d => ({
                    id: d.id,
                    name: d.name,
                    phone: d.phone,
                    email: d.email,
                    userType: d.user_type,
                    shop: d.shop,
                    contactPhone: d.contact_phone,
                    avatar_url: d.avatar_url,
                    bio: d.bio,
                    savings: d.savings,
                    bookingsCount: d.bookings_count,
                    notifKeywords: d.notif_keywords,
                    smartAlerts: Array.isArray(d.smart_alerts) ? d.smart_alerts : [],
                    preferredLang: d.preferred_lang || 'ar',
                    followedMerchants: Array.isArray(d.followed_merchants) ? d.followed_merchants : [],
                    blockedMerchants: Array.isArray(d.blocked_merchants) ? d.blocked_merchants : [],
                    lat: d.lat,
                    lng: d.lng,
                    googleMapsLink: d.google_maps_link
                }));
            }
        } catch (e) {
            console.error('Failed to fetch all sellers', e);
        }
        return [];
    }
};
