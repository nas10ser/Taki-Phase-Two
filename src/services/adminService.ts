/**
 * TAKI Admin Service v9.7 — High-performance admin operations
 *
 * كل الاستدعاءات هنا:
 *  - تستخدم RPC الأقل بياناً (SECURITY DEFINER)
 *  - مغلقة بفلتر الأدمن داخل قاعدة البيانات
 *  - رخيصة ومحسّنة (indexes موجودة)
 *  - معاد التحقق على RLS server-side
 */

import { supabase } from './supabaseClient';

// ============================================================
// Types
// ============================================================

export interface LiveStats {
    active_users: number;
    active_buyers: number;
    active_sellers: number;
    bookings_today: number;
    bookings_hour: number;
    bookings_5min: number;
    new_users_today: number;
    total_users: number;
    total_buyers: number;
    total_sellers: number;
    active_deals: number;
    paying_sellers: number;
    mrr: number;
    as_of: string;
}

export interface TimelinePoint {
    bucket: string;
    count: number;
}

export interface ActivityRow {
    id: number;
    user_id: string;
    user_name: string | null;
    user_type: string | null;
    action: string;
    entity_type: string | null;
    entity_id: string | null;
    metadata: any;
    created_at: string;
}

export interface AdminUserRow {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    user_type: 'buyer' | 'seller' | 'admin';
    shop: string | null;
    address: string | null;
    is_suspended: boolean;
    total_bookings: number;
    total_spent: number;
    last_active_at: string | null;
    created_at: string;
    subscription_plan: string | null;
    subscription_expires_at: string | null;
    subscription_amount: number | null;
    discount_percentage: number | null;
}

export interface ApplySubscriptionParams {
    storeId: string;
    plan: 'free' | 'trial' | 'premium';
    startedAt?: Date | null;
    expiresAt?: Date | null;
    discount?: number;
    amount?: number;
    notes?: string;
    sendNotification?: boolean;
}

// ============================================================
// In-memory cache (TTL based) — يقلل الطلبات بنسبة 90%
// ============================================================
const cache = new Map<string, { value: any; expires: number }>();

function getCached<T>(key: string): T | null {
    const hit = cache.get(key);
    if (!hit) return null;
    if (hit.expires < Date.now()) {
        cache.delete(key);
        return null;
    }
    return hit.value as T;
}

function setCached<T>(key: string, value: T, ttlMs: number): T {
    cache.set(key, { value, expires: Date.now() + ttlMs });
    return value;
}

export function clearAdminCache() {
    cache.clear();
}

// ============================================================
// Live Stats (TTL = 3 seconds — صغير جداً للحظية)
// ============================================================
export const adminService = {
    async getLiveStats(minutes = 5, useCache = true): Promise<LiveStats | null> {
        const key = `live_stats:${minutes}`;
        if (useCache) {
            const c = getCached<LiveStats>(key);
            if (c) return c;
        }
        const { data, error } = await supabase.rpc('get_live_stats', { p_minutes: minutes });
        if (error) {
            console.error('[adminService.getLiveStats]', error);
            return null;
        }
        return setCached(key, data as LiveStats, 3000);
    },

    async getBookingsTimeline(
        from: Date,
        to: Date,
        bucket: 'minute' | 'hour' | 'day' = 'hour'
    ): Promise<TimelinePoint[]> {
        const { data, error } = await supabase.rpc('get_bookings_timeline', {
            p_from: from.toISOString(),
            p_to: to.toISOString(),
            p_bucket: bucket,
        });
        if (error) {
            console.error('[adminService.getBookingsTimeline]', error);
            return [];
        }
        return (data as any[]) ?? [];
    },

    async getRecentActivity(limit = 50): Promise<ActivityRow[]> {
        const { data, error } = await supabase.rpc('get_recent_activity', { p_limit: limit });
        if (error) {
            console.error('[adminService.getRecentActivity]', error);
            return [];
        }
        return (data as ActivityRow[]) ?? [];
    },

    async searchUsers(
        query = '',
        userType: 'buyer' | 'seller' | null = null,
        limit = 50,
        offset = 0
    ): Promise<AdminUserRow[]> {
        const { data, error } = await supabase.rpc('admin_search_users', {
            p_query: query,
            p_user_type: userType,
            p_limit: limit,
            p_offset: offset,
        });
        if (error) {
            console.error('[adminService.searchUsers]', error);
            return [];
        }
        return (data as AdminUserRow[]) ?? [];
    },

    async applySubscription(p: ApplySubscriptionParams): Promise<{ success: boolean; error?: string }> {
        const { data, error } = await supabase.rpc('admin_apply_subscription', {
            p_store_id: p.storeId,
            p_plan: p.plan,
            p_started_at: (p.startedAt ?? new Date()).toISOString(),
            p_expires_at: p.expiresAt ? p.expiresAt.toISOString() : null,
            p_discount: p.discount ?? 0,
            p_amount: p.amount ?? 199,
            p_notes: p.notes ?? null,
            p_send_notification: p.sendNotification ?? true,
        });
        if (error) {
            console.error('[adminService.applySubscription]', error);
            return { success: false, error: error.message };
        }
        clearAdminCache();
        return { success: !!data?.success };
    },

    async updateUser(
        userId: string,
        updates: Partial<{
            name: string;
            phone: string;
            email: string;
            shop: string;
            address: string;
            bio: string;
            avatar_url: string;
            is_suspended: boolean;
            admin_notes: string;
            user_type: 'buyer' | 'seller' | 'admin';
        }>
    ): Promise<{ success: boolean; error?: string }> {
        const { data, error } = await supabase.rpc('admin_update_user', {
            p_user_id: userId,
            p_updates: updates,
        });
        if (error) {
            console.error('[adminService.updateUser]', error);
            return { success: false, error: error.message };
        }
        clearAdminCache();
        return { success: !!data?.success };
    },

    async softDeleteUser(userId: string): Promise<{ success: boolean; error?: string }> {
        const { data, error } = await supabase.rpc('admin_soft_delete_user', {
            p_user_id: userId,
        });
        if (error) return { success: false, error: error.message };
        clearAdminCache();
        return { success: !!data?.success };
    },

    async getTopSellers(limit = 20) {
        const { data, error } = await supabase.rpc('admin_top_sellers', { p_limit: limit });
        if (error) return [];
        return data ?? [];
    },

    async getTopBuyers(limit = 20) {
        const { data, error } = await supabase.rpc('admin_top_buyers', { p_limit: limit });
        if (error) return [];
        return data ?? [];
    },

    /**
     * heartbeat — يستدعى كل 30 ثانية للحفاظ على الجلسة "نشطة"
     */
    async heartbeat(page?: string) {
        const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
        const deviceType =
            typeof window !== 'undefined' && window.innerWidth < 768
                ? 'mobile'
                : typeof window !== 'undefined' && window.innerWidth < 1024
                ? 'tablet'
                : 'desktop';
        await supabase.rpc('session_heartbeat', {
            p_page: page ?? (typeof location !== 'undefined' ? location.pathname : null),
            p_user_agent: userAgent.slice(0, 200),
            p_device_type: deviceType,
        });
    },

    /**
     * logActivity — يستدعى عند كل حدث مهم
     */
    async logActivity(
        action: string,
        entityType?: string,
        entityId?: string,
        metadata: Record<string, any> = {}
    ) {
        try {
            await supabase.rpc('log_activity', {
                p_action: action,
                p_entity_type: entityType ?? null,
                p_entity_id: entityId ?? null,
                p_metadata: metadata,
            });
        } catch (e) {
            // silent — non-blocking
        }
    },
};
