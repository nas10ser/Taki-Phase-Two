import { UserProfile, authService } from '../services/authService';
import { supabase } from '../services/supabaseClient';
import { logger } from '../utils/logger';
import { withTimeout } from '../utils/helpers';

/**
 * v13.21 — الأعمدة التي تحتاجها واجهة «ملفات المتاجر» فعلاً.
 * كان الجلب `select('*')` فينزّل كل حقول كل تاجر لكل عميل عند كل تغيير.
 */
/**
 * v13.71 — أعمدة الدليل العام للمتاجر (`public.sellers_public`). أسماؤها هي
 * أسماء أعمدة `users` نفسها، فيبقى `mapUserRowToProfile` مُحوِّلاً واحداً
 * للمصدرين. ما ليس هنا (البريد، الجوال، معرّفات البوتات، ملاحظات الإدارة…)
 * لا يخرج للمتصفح إطلاقاً — انظر supabase/migration_v13_71_*.sql.
 */
/**
 * سقف الصفحة الأولى من دليل المتاجر (v13.80). ما فوقه يُجلب بالمعرّف عند
 * ظهور عرضه أو فتح صفحته — انظر `getSellersByIds` و`ensureStoreProfiles`.
 */
export const SELLER_DIRECTORY_CAP = 1000;

export const PUBLIC_SELLER_COLUMNS =
    'id,name,shop,avatar_url,bio,contact_phone,user_type,lat,lng,google_maps_link,working_hours,preferred_lang';

/**
 * هل يوجد العرض العام على الخادم؟ (null = لم نجرّب بعد). نتذكّر النتيجة فلا
 * نُطلق طلباً فاشلاً في كل تحديث قبل تطبيق ترحيل v13.71 على الخادم.
 */
let publicDirectoryAvailable: boolean | null = null;

export const SELLER_PROFILE_COLUMNS =
    'id,name,phone,email,user_type,shop,contact_phone,avatar_url,bio,savings,bookings_count,' +
    'notif_keywords,smart_alerts,preferred_lang,followed_merchants,blocked_merchants,' +
    'lat,lng,google_maps_link,working_hours';

/**
 * مُحوِّل واحد لصف `users` ← ملف المتجر. مشترك بين الجلب الكامل والتحديث
 * اللحظي التفاضلي في AppContext، فلا ينحرف الشكلان أبداً.
 */
export const mapUserRowToProfile = (d: any): UserProfile => ({
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
    googleMapsLink: d.google_maps_link,
    workingHours: d.working_hours,
} as UserProfile);

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
            // v14.06 — عنوان التوصيل: يمرّ بنفس قاعدة الجزئية (undefined = لا تلمس،
            // null = محو مقصود). قيد القاعدة يرفض العنوان بلا إحداثيات رقمية.
            if (p.deliveryAddress !== undefined) dbData.delivery_address = p.deliveryAddress;
            if (p.googleMapsLink !== undefined) dbData.google_maps_link = p.googleMapsLink;
            if (p.workingHours !== undefined) dbData.working_hours = p.workingHours;

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
        // v11.43: via SECURITY DEFINER RPC — the users RLS policy no longer lets
        // anon/buyers be counted directly (PII lockdown), so a table read would
        // under-count. The RPC counts buyers who follow this store safely.
        try {
            const { data, error } = await supabase.rpc('store_follower_count', { p_store_id: storeId });
            if (error) throw error;
            return Number(data) || 0;
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
                    // v14.06 — عنوان التوصيل الدائم. `select('*')` يُرجعه أصلاً،
                    // وكان يسقط في التحويل فيصل التطبيق «بلا عنوان» فيُخفي التوصيل.
                    deliveryAddress: (data.delivery_address && typeof data.delivery_address === 'object')
                        ? data.delivery_address : null,
                    googleMapsLink: data.google_maps_link,
                    workingHours: data.working_hours,
                    isSuperAdmin: data.is_super_admin === true,
                    adminPermissions: Array.isArray(data.admin_permissions) ? data.admin_permissions : []
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

            // v13.71 — نفس مبدأ getAllSellers: الدليل العام أولاً (حقول عامة
            // فقط)، وارتداد للجدول قبل تطبيق الترحيل. و`neq('buyer')` بدل
            // `eq('seller')` حتى يظهر متجر ناصر المملوك لحساب أدمن في البحث.
            if (publicDirectoryAvailable !== false) {
                const viaView = await supabase
                    .from('sellers_public')
                    .select(PUBLIC_SELLER_COLUMNS)
                    .or(`shop.ilike.%${sanitized}%,name.ilike.%${sanitized}%`)
                    .limit(10);
                publicDirectoryAvailable = !viaView.error;
                if (!viaView.error) return (viaView.data as any[] || []).map(mapUserRowToProfile);
            }

            const { data, error } = await supabase
                .from('users')
                .select(SELLER_PROFILE_COLUMNS)
                .neq('user_type', 'buyer')
                .or(`shop.ilike.%${sanitized}%,name.ilike.%${sanitized}%`)
                .limit(10);
            
            if (data && !error) {
                // v13.71 — كان هنا نسخة ثانية يدوية من محوّل الصفوف تنحرف عن
                // `mapUserRowToProfile` (كانت تُسقط `working_hours` مثلاً).
                return (data as any[]).map(mapUserRowToProfile);
            }
        } catch (e) {
            console.error('Failed to search stores', e);
        }
        return [];
    },

    /**
     * v13.80 — دليل المتاجر صار **مسقوفاً**، والباقي يُجلب عند الحاجة.
     *
     * كان يُنزّل صفوف **كل تاجر في المنصّة** عند كل فتح للتطبيق وعند كل تحديث
     * كامل. بعشرات التجار هذا لا يُلاحَظ؛ بمئة ألف تاجر يصير كل فتح تنزيلاً
     * بعشرات الميغابايتات على كل جهاز — وهو أعنف سقف في المشروع قبل الملايين.
     *
     * الآن: صفحة أولى مسقوفة تكفي التصفّح العام، وأي متجر خارجها يُجلب
     * بمعرّفه لحظة ظهور عرضه أو فتح صفحته (`getSellersByIds`). النتيجة على
     * الشاشة واحدة، والحِمل صار بحجم ما يراه المستخدم لا بحجم المنصّة.
     */
    getAllSellers: async (limit: number = SELLER_DIRECTORY_CAP): Promise<UserProfile[]> => {
        try {
            // v13.71 — الدليل العام للمتاجر يُقرأ من `sellers_public` (حقول
            // عامة فقط)، وإن لم يوجد العرض بعد — أي قبل تطبيق ترحيل v13.71 على
            // الخادم — نرتدّ إلى الجدول كما كان. فالنشر آمن في الحالتين.
            if (publicDirectoryAvailable !== false) {
                const viaView = await supabase.from('sellers_public').select(PUBLIC_SELLER_COLUMNS).limit(limit);
                publicDirectoryAvailable = !viaView.error;
                if (!viaView.error) return (viaView.data as any[] || []).map(mapUserRowToProfile);
            }

            // v13.71 — `neq('user_type','buyer')` لا `eq('seller')`: متجر ناصر
            // مملوك لحساب **أدمن**، وكل مرشِّح `user_type='seller'` في هذا
            // المستودع أخفاه تاريخياً (نفس درس قناة realtime في realtimeService).
            // النتيجة كانت: بطاقات متجره بلا شعار ولا ساعات عمل ولا رقم تواصل.
            const { data, error } = await supabase
                .from('users')
                .select(SELLER_PROFILE_COLUMNS)
                .neq('user_type', 'buyer')
                .limit(limit);

            if (data && !error) return (data as any[]).map(mapUserRowToProfile);
        } catch (e) {
            console.error('Failed to fetch all sellers', e);
        }
        return [];
    },

    /**
     * v13.80 — ملفات متاجر بعينها (ما نقص عن الصفحة المسقوفة أعلاه).
     * تُجزَّأ الطلبات فلا يطول رابط الاستعلام مهما كثرت المعرّفات.
     */
    getSellersByIds: async (ids: string[]): Promise<UserProfile[]> => {
        const unique = Array.from(new Set((ids || []).filter(Boolean)));
        if (unique.length === 0) return [];
        const out: UserProfile[] = [];
        const CHUNK = 100;
        for (let i = 0; i < unique.length; i += CHUNK) {
            const slice = unique.slice(i, i + CHUNK);
            try {
                if (publicDirectoryAvailable !== false) {
                    const viaView = await supabase.from('sellers_public').select(PUBLIC_SELLER_COLUMNS).in('id', slice);
                    publicDirectoryAvailable = !viaView.error;
                    if (!viaView.error) { out.push(...((viaView.data as any[]) || []).map(mapUserRowToProfile)); continue; }
                }
                const { data, error } = await supabase
                    .from('users')
                    .select(SELLER_PROFILE_COLUMNS)
                    .in('id', slice)
                    .neq('user_type', 'buyer');
                if (!error && data) out.push(...(data as any[]).map(mapUserRowToProfile));
            } catch (e) {
                console.warn('getSellersByIds chunk failed:', e);
            }
        }
        return out;
    }
};
