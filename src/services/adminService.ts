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

export interface ChannelSplit { web: number; telegram: number; whatsapp: number; }
export interface BotAnalytics {
    tg_linked: number;
    wa_linked: number;
    both_linked: number;
    total_users: number;
    lang_ar: number;
    lang_en: number;
    bookings_total: ChannelSplit;
    bookings_30d: ChannelSplit;
    deals_total: ChannelSplit;
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
    /** Location package size: 1 | 3 | 6 | 10. Omit/undefined = leave as-is. */
    maxBranches?: number;
}

export interface AdminReportRow {
    id: string;
    created_at: string;
    report_type: string;
    reason: string;
    status: string;
    admin_note: string | null;
    reporter_id: string;
    reporter_name: string;
    reporter_phone: string | null;
    reporter_role: string;
    reporter_filed_count: number;
    reported_id: string;
    reported_name: string;
    reported_phone: string | null;
    reported_role: string;
    reported_under_review: boolean;
    reported_received_count: number;
    reported_distinct_reporters: number;
}

export interface AdminComplaintRow {
    id: string;
    created_at: string;
    category: string;
    subject: string | null;
    message: string;
    status: string;
    admin_note: string | null;
    user_id: string;
    user_name: string;
    user_phone: string | null;
    user_type: string | null;
    target_id: string | null;
    target_name: string | null;
}

export interface WarnedUser {
    user_id: string;
    name: string | null;
    phone: string | null;
    user_type: string | null;
    is_suspended: boolean;
    warn_count: number;
    last_warned_at: string;
}

export interface UserWarning {
    id: string;
    reason: string;
    context_barcode: string | null;
    context_message: string | null;
    admin_name: string | null;
    created_at: string;
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

    async listReports(filters: {
        query?: string;
        reportedRole?: 'buyer' | 'seller' | null;
        type?: string | null;
        status?: string | null;
        days?: number;
        limit?: number;
        offset?: number;
    } = {}): Promise<AdminReportRow[]> {
        const { data, error } = await supabase.rpc('admin_list_reports', {
            p_query: filters.query ?? '',
            p_reported_role: filters.reportedRole ?? null,
            p_type: filters.type ?? null,
            p_status: filters.status ?? null,
            p_days: filters.days ?? 0,
            p_limit: filters.limit ?? 100,
            p_offset: filters.offset ?? 0,
        });
        if (error) {
            console.error('[adminService.listReports]', error);
            return [];
        }
        return (data as AdminReportRow[]) ?? [];
    },

    async listComplaints(filters: {
        query?: string;
        status?: string | null;
        limit?: number;
        offset?: number;
    } = {}): Promise<AdminComplaintRow[]> {
        const { data, error } = await supabase.rpc('admin_list_complaints', {
            p_query: filters.query ?? '',
            p_status: filters.status ?? null,
            p_limit: filters.limit ?? 100,
            p_offset: filters.offset ?? 0,
        });
        if (error) {
            console.error('[adminService.listComplaints]', error);
            return [];
        }
        return (data as AdminComplaintRow[]) ?? [];
    },

    async setReportStatus(id: string, status: string, note?: string): Promise<{ success: boolean; error?: string }> {
        const { data, error } = await supabase.rpc('admin_set_report_status', {
            p_id: id, p_status: status, p_note: note ?? null,
        });
        if (error) {
            console.error('[adminService.setReportStatus]', error);
            return { success: false, error: error.message };
        }
        return { success: !!data?.success };
    },

    async setComplaintStatus(id: string, status: string, note?: string): Promise<{ success: boolean; error?: string }> {
        const { data, error } = await supabase.rpc('admin_set_complaint_status', {
            p_id: id, p_status: status, p_note: note ?? null,
        });
        if (error) {
            console.error('[adminService.setComplaintStatus]', error);
            return { success: false, error: error.message };
        }
        return { success: !!data?.success };
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
            p_max_branches: p.maxBranches ?? null,
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

    // Top performers — optional [from, to) booking window (null = all-time) and a
    // caller-chosen count. The window filters which bookings count toward the
    // ranking; deal counts stay all-time. (v11.46)
    async getTopSellers(limit = 20, from: Date | null = null, to: Date | null = null) {
        const { data, error } = await supabase.rpc('admin_top_sellers', {
            p_limit: limit,
            p_from: from ? from.toISOString() : null,
            p_to: to ? to.toISOString() : null,
        });
        if (error) { console.error('[adminService.getTopSellers]', error); return []; }
        return data ?? [];
    },

    async getTopBuyers(limit = 20, from: Date | null = null, to: Date | null = null) {
        const { data, error } = await supabase.rpc('admin_top_buyers', {
            p_limit: limit,
            p_from: from ? from.toISOString() : null,
            p_to: to ? to.toISOString() : null,
        });
        if (error) { console.error('[adminService.getTopBuyers]', error); return []; }
        return data ?? [];
    },

    /**
     * Custom-period totals between two calendar dates [from, to). Powers the
     * «تقرير فترة مخصّصة» card so the owner can read exact counts (new buyers /
     * sellers / bookings / GMV / subscriptions) for any window. (v11.46)
     */
    async getRangeSummary(from: Date, to: Date) {
        const { data, error } = await supabase.rpc('admin_range_summary', {
            p_from: from.toISOString(),
            p_to: to.toISOString(),
        });
        if (error) { console.error('[adminService.getRangeSummary]', error); return null; }
        const row = Array.isArray(data) ? data[0] : data;
        return row as {
            new_buyers: number; new_sellers: number; new_users: number;
            bookings: number; completed_bookings: number; cancelled_bookings: number;
            gmv: number; new_subscriptions: number;
        } | null;
    },

    // ── Warnings (strikes) ──────────────────────────────────────────────
    /** Warned users with their strike counts. Filter by role, min-count, search. */
    async listWarnedUsers(filters: { role?: string | null; minCount?: number; search?: string } = {}) {
        const { data, error } = await supabase.rpc('admin_list_warned_users', {
            p_role: filters.role ?? null,
            p_min_count: filters.minCount ?? 1,
            p_search: filters.search ?? '',
        });
        if (error) { console.error('[adminService.listWarnedUsers]', error); return []; }
        return (data ?? []) as WarnedUser[];
    },

    /** One user's warnings (reason + the offending thread/message), newest first. */
    async getUserWarnings(userId: string) {
        const { data, error } = await supabase.rpc('admin_user_warnings', { p_user_id: userId });
        if (error) { console.error('[adminService.getUserWarnings]', error); return []; }
        return (data ?? []) as UserWarning[];
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

    // ─── Platform settings ──────────────────────────────────────────────
    /**
     * Read a value from platform_settings. Returns null if missing.
     * Values are jsonb — could be number, boolean, string, etc.
     */
    async getPlatformSetting<T = any>(key: string): Promise<T | null> {
        const { data, error } = await supabase
            .from('platform_settings')
            .select('value')
            .eq('key', key)
            .maybeSingle();
        if (error) {
            console.warn('[getPlatformSetting]', key, error);
            return null;
        }
        return (data?.value ?? null) as T | null;
    },

    /**
     * Write a platform_settings row. Uses UPDATE first; if no row was matched
     * (i.e., key missing), upserts a fresh row so callers don't need to know
     * which one applies.
     */
    async setPlatformSetting(key: string, value: any, description?: string): Promise<{ success: boolean; error?: string }> {
        const updatePayload: any = { value, updated_at: new Date().toISOString() };
        const { data, error } = await supabase
            .from('platform_settings')
            .update(updatePayload)
            .eq('key', key)
            .select('key');
        if (error) return { success: false, error: error.message };
        if (data && data.length > 0) return { success: true };
        // No existing row — upsert.
        const { error: insErr } = await supabase
            .from('platform_settings')
            .upsert({ key, value, description: description ?? null, updated_at: new Date().toISOString() });
        if (insErr) return { success: false, error: insErr.message };
        return { success: true };
    },

    // ================================================================
    // v12.38 — «🧠 المحلل الذكي» wrappers
    // ================================================================
    /** Full platform analysis (peak hours, funnel, growth, renewals, seller
     *  health, geo/category performance, buyer behavior). Admin-gated RPC. */
    async getAiAnalyst(days = 30): Promise<any | null> {
        const { data, error } = await supabase.rpc('admin_ai_analyst', { p_days: days });
        if (error) { console.error('[adminService.getAiAnalyst]', error); return null; }
        return data;
    },

    /** Per-merchant deep-dive + same-city/category benchmarks. */
    async getAiSellerReport(storeId: string): Promise<any | null> {
        const { data, error } = await supabase.rpc('admin_ai_seller_report', { p_store_id: storeId });
        if (error) { console.error('[adminService.getAiSellerReport]', error); return null; }
        return data;
    },

    /** v12.40 — مستكشف (مدينة × قسم × ساعة): حجوزات/مشاهدات/نقرات الشريحة. */
    async getAiMatrix(city: string | null, category: string | null): Promise<any | null> {
        const { data, error } = await supabase.rpc('admin_ai_matrix', { p_city: city, p_category: category });
        if (error) { console.error('[adminService.getAiMatrix]', error); return null; }
        return data;
    },

    /** v12.40 — تفاعل الأقسام (مشاهدات/نقرات/حجوزات) + أعلى كلمات البحث. */
    async getAiPulse2(): Promise<any | null> {
        const { data, error } = await supabase.rpc('admin_ai_pulse2');
        if (error) { console.error('[adminService.getAiPulse2]', error); return null; }
        return data;
    },

    /** v12.41 — القمع الكامل + الإلغاءات بمن ألغاها + الاحتفاظ + الأسوأ. */
    async getAiFunnel(days = 30): Promise<any | null> {
        const { data, error } = await supabase.rpc('admin_ai_funnel', { p_days: days });
        if (error) { console.error('[adminService.getAiFunnel]', error); return null; }
        return data;
    },

    /** v12.42 — التحكم الكامل بالساعات: أي مدى (يلتف عبر منتصف الليل) + يوم
     *  اختياري → كل شيء داخله (حجوزات/مشترون/تجار/مشاهدات/بحث/نشر) + خريطة
     *  الأسبوع الحرارية (يوم × ساعة). */
    async getAiHours(from: number, to: number, dow: number | null, days = 90): Promise<any | null> {
        const { data, error } = await supabase.rpc('admin_ai_hours', {
            p_from: from, p_to: to, p_dow: dow, p_days: days,
        });
        if (error) { console.error('[adminService.getAiHours]', error); return null; }
        return data;
    },

    /** v12.43 — المحلل المخصص: أي شريحة يحددها المالك يدوياً (تاريخ من/إلى +
     *  ساعات + يوم + مدينة + تصنيف) → تقرير كامل تلقائي. */
    async getAiCustom(p: {
        start: string; end: string;
        hourFrom?: number; hourTo?: number;
        dow?: number | null; city?: string | null; category?: string | null;
    }): Promise<any | null> {
        const { data, error } = await supabase.rpc('admin_ai_custom', {
            p_start: p.start, p_end: p.end,
            p_hour_from: p.hourFrom ?? 0, p_hour_to: p.hourTo ?? 23,
            p_dow: p.dow ?? null, p_city: p.city ?? null, p_category: p.category ?? null,
        });
        if (error) { console.error('[adminService.getAiCustom]', error); return null; }
        return data;
    },

    /** v12.40 — أقرب ٣ منافسين للتاجر (نفس المدينة + التصنيف). */
    async getAiCompetitors(storeId: string): Promise<any | null> {
        const { data, error } = await supabase.rpc('admin_ai_seller_competitors', { p_store_id: storeId });
        if (error) { console.error('[adminService.getAiCompetitors]', error); return null; }
        return data;
    },

    /** Owner-approved send of ONE recommendation to ONE user (+optional email). */
    async notifyUser(p: { userId: string; titleAr: string; bodyAr: string; email?: boolean }): Promise<{ success: boolean; error?: string }> {
        const { data, error } = await supabase.rpc('admin_notify_user', {
            p_user_id: p.userId, p_title_ar: p.titleAr, p_body_ar: p.bodyAr, p_email: !!p.email,
        });
        if (error) return { success: false, error: error.message };
        const d = data as any;
        return { success: !!d?.success, error: d?.error };
    },

    /**
     * v12.35 — one gated broadcast to an audience: in-app notification rows
     * (fanned out per user, reaches web + Telegram via the outbox poller)
     * and/or queued emails (email_outbox → Render SMTP). Admin-only (RPC
     * checks is_admin() internally).
     */
    async broadcastNotification(p: {
        titleAr: string;
        bodyAr?: string;
        audience?: 'all' | 'buyers' | 'sellers';
        type?: string;
        meta?: Record<string, any>;
        inapp?: boolean;
        email?: boolean;
    }): Promise<{ success: boolean; notified: number; emailed: number; error?: string }> {
        const { data, error } = await supabase.rpc('admin_broadcast_notification', {
            p_title_ar: p.titleAr,
            p_body_ar: p.bodyAr ?? '',
            p_audience: p.audience ?? 'all',
            p_type: p.type ?? 'system',
            p_meta: p.meta ?? {},
            p_inapp: p.inapp !== false,
            p_email: !!p.email,
        });
        if (error) {
            console.error('[adminService.broadcastNotification]', error);
            return { success: false, notified: 0, emailed: 0, error: error.message };
        }
        const d = data as any;
        return {
            success: !!d?.success,
            notified: Number(d?.notified) || 0,
            emailed: Number(d?.emailed) || 0,
            error: d?.error,
        };
    },

    /**
     * Convenience: bulk-apply a single uniform subscription to every active
     * seller (used by the "Free for all" / "Paid for all" platform-mode
     * buttons). Returns counts of OK / failed.
     */
    async bulkSetAllActiveSellers(params: {
        plan: 'free' | 'trial' | 'premium';
        amount: number;
        discount: number;
        expiresAt: Date | null;
        notes?: string;
        /** v12.35 — location cap from the default package (unified pricing). */
        maxBranches?: number;
    }): Promise<{ ok: number; failed: number; total: number }> {
        const { data: sellersData, error } = await supabase.rpc('admin_search_users', {
            p_query: '',
            p_user_type: 'seller',
            p_limit: 1000,
            p_offset: 0,
        });
        if (error || !sellersData) return { ok: 0, failed: 0, total: 0 };
        const targets = (sellersData as any[]).filter((s) => !s.is_suspended);
        let ok = 0, failed = 0;
        const CHUNK = 8;
        for (let i = 0; i < targets.length; i += CHUNK) {
            const slice = targets.slice(i, i + CHUNK);
            const results = await Promise.allSettled(
                slice.map((s) =>
                    adminService.applySubscription({
                        storeId: s.id,
                        plan: params.plan,
                        startedAt: new Date(),
                        expiresAt: params.expiresAt,
                        discount: params.discount,
                        amount: params.amount,
                        notes: params.notes,
                        sendNotification: false,
                        maxBranches: params.maxBranches,
                    })
                )
            );
            results.forEach((r) => {
                if (r.status === 'fulfilled' && (r.value as any).success) ok++;
                else failed++;
            });
        }
        return { ok, failed, total: targets.length };
    },

    // ================================================================
    // v10.98 — World-class analytics RPCs (added in
    // v10_98_admin_world_class_analytics migration). Every wrapper here
    // logs its error and returns an empty/zero shape so the UI never
    // crashes on a missing function or transient DB issue.
    // ================================================================

    async getMrrMonthly(months = 12) {
        const { data, error } = await supabase.rpc('admin_mrr_monthly', { p_months: months });
        if (error) { console.error('[adminService.getMrrMonthly]', error); return []; }
        return (data ?? []) as Array<{
            month_key: string; month_label: string;
            paid_amount: number; paid_count: number; refunded_amount: number;
        }>;
    },

    // ===== Malls/markets (locations) management =====
    async listLocations() {
        const { data, error } = await supabase
            .from('locations')
            .select('id,name,name_en,type,city_id,lat,lng');
        if (error) { console.error('[adminService.listLocations]', error); return []; }
        return (data ?? []) as Array<{ id: string; name: string; name_en: string | null; type: 'mall' | 'market'; city_id: string; lat: number; lng: number }>;
    },

    async upsertLocation(p: { id?: string; name: string; name_en?: string; type: 'mall' | 'market'; city_id: string; lat: number; lng: number }) {
        const { data, error } = await supabase.rpc('admin_upsert_location', {
            p_id: p.id ?? null, p_name: p.name, p_name_en: p.name_en ?? null,
            p_type: p.type, p_city_id: p.city_id, p_lat: p.lat, p_lng: p.lng,
        });
        if (error) { console.error('[adminService.upsertLocation]', error); return { success: false, error: error.message }; }
        return data as { success: boolean; id?: string; error?: string };
    },

    async deleteLocation(id: string) {
        const { data, error } = await supabase.rpc('admin_delete_location', { p_id: id });
        if (error) { console.error('[adminService.deleteLocation]', error); return { success: false, error: error.message }; }
        return data as { success: boolean };
    },

    // Bot adoption + channel attribution (web vs telegram vs whatsapp).
    async getBotAnalytics() {
        const { data, error } = await supabase.rpc('admin_bot_analytics');
        if (error) { console.error('[adminService.getBotAnalytics]', error); return null; }
        return (data ?? null) as BotAnalytics | null;
    },

    async getSubscriptionLifecycle() {
        const { data, error } = await supabase.rpc('admin_subscription_lifecycle');
        if (error) { console.error('[adminService.getSubscriptionLifecycle]', error); return []; }
        return (data ?? []) as Array<{ status: string; cnt: number }>;
    },

    async getSubscriptionGrowth(months = 12) {
        const { data, error } = await supabase.rpc('admin_subscription_growth', { p_months: months });
        if (error) { console.error('[adminService.getSubscriptionGrowth]', error); return []; }
        return (data ?? []) as Array<{
            month_key: string; month_label: string;
            new_subs: number; churned_subs: number; net_change: number;
        }>;
    },

    async getActivityHeatmap(days = 30) {
        const { data, error } = await supabase.rpc('admin_activity_heatmap', { p_days: days });
        if (error) { console.error('[adminService.getActivityHeatmap]', error); return []; }
        return (data ?? []) as Array<{ dow: number; hour: number; cnt: number }>;
    },

    async getBookingFunnel(days = 30) {
        const { data, error } = await supabase.rpc('admin_booking_funnel', { p_days: days });
        if (error) { console.error('[adminService.getBookingFunnel]', error); return null; }
        const row = Array.isArray(data) ? data[0] : data;
        return row as {
            total_views: number; unique_viewers: number;
            total_bookings: number; unique_bookers: number;
            conversion_pct: number; avg_views_per_booker: number;
        } | null;
    },

    async getBrowseNoBook(days = 14, limit = 50) {
        const { data, error } = await supabase.rpc('admin_browse_no_book', { p_days: days, p_limit: limit });
        if (error) { console.error('[adminService.getBrowseNoBook]', error); return []; }
        return (data ?? []) as Array<{
            user_id: string; name: string; phone: string | null;
            views_count: number; last_viewed_at: string; deals_seen: number;
        }>;
    },

    async getRevenueForecast() {
        const { data, error } = await supabase.rpc('admin_revenue_forecast');
        if (error) { console.error('[adminService.getRevenueForecast]', error); return null; }
        const row = Array.isArray(data) ? data[0] : data;
        return row as {
            monthly_expected: number;
            paying_sellers: number; free_sellers: number; trial_sellers: number;
            expires_7d: number; expires_30d: number;
            avg_arpu: number;
        } | null;
    },

    async getChurnedSubscribers(days = 90, limit = 100) {
        const { data, error } = await supabase.rpc('admin_churned_subscribers', { p_days: days, p_limit: limit });
        if (error) { console.error('[adminService.getChurnedSubscribers]', error); return []; }
        return (data ?? []) as Array<{
            store_id: string; name: string; shop: string | null;
            phone: string | null; plan: string | null;
            ended_at: string; days_since_churn: number; last_amount: number;
        }>;
    },

    async getSubscriptionTimeline(limit = 200) {
        const { data, error } = await supabase.rpc('admin_subscription_timeline', { p_limit: limit });
        if (error) { console.error('[adminService.getSubscriptionTimeline]', error); return []; }
        return (data ?? []) as Array<{
            store_id: string; name: string; shop: string | null; phone: string | null;
            plan: string; started_at: string | null; expires_at: string | null;
            days_remaining: number | null;
            amount: number; discount: number; net_amount: number;
        }>;
    },

    async getUserCohorts(months = 6) {
        const { data, error } = await supabase.rpc('admin_user_cohorts', { p_months: months });
        if (error) { console.error('[adminService.getUserCohorts]', error); return []; }
        return (data ?? []) as Array<{
            cohort_key: string; cohort_label: string;
            registered: number; active_now: number; booked_ever: number;
            retention_pct: number;
        }>;
    },

    async getDailyMetrics(days = 30) {
        const { data, error } = await supabase.rpc('admin_daily_metrics', { p_days: days });
        if (error) { console.error('[adminService.getDailyMetrics]', error); return []; }
        return (data ?? []) as Array<{
            day_key: string; day_label: string;
            events: number; bookings: number; new_users: number;
            completed_bookings: number; cancelled_bookings: number;
        }>;
    },

    async getCategoryFunnel(days = 30, limit = 12) {
        const { data, error } = await supabase.rpc('admin_category_funnel', { p_days: days, p_limit: limit });
        if (error) { console.error('[adminService.getCategoryFunnel]', error); return []; }
        return (data ?? []) as Array<{
            category: string; views: number; bookings: number; conversion_pct: number;
        }>;
    },

    // ================================================================
    // v10.99 — Investor-grade analytics RPCs
    // ================================================================

    async lookupByDate(date: string) {
        const { data, error } = await supabase.rpc('admin_lookup_by_date', { p_date: date });
        if (error) { console.error('[adminService.lookupByDate]', error); return null; }
        const row = Array.isArray(data) ? data[0] : data;
        return row as {
            target_date: string;
            views_count: number; unique_viewers: number;
            bookings_count: number; unique_bookers: number;
            completed_bookings: number; cancelled_bookings: number;
            gmv: number; savings_delivered: number;
            new_buyers: number; new_sellers: number;
            active_users: number; total_events: number;
        } | null;
    },

    async lookupByMonth(year: number, month: number) {
        const { data, error } = await supabase.rpc('admin_lookup_by_month', { p_year: year, p_month: month });
        if (error) { console.error('[adminService.lookupByMonth]', error); return null; }
        const row = Array.isArray(data) ? data[0] : data;
        return row as {
            label: string;
            views_count: number; bookings_count: number; completed_bookings: number;
            gmv: number; savings_delivered: number;
            new_buyers: number; active_users: number;
            daily_breakdown: Array<{ day: string; views: number; books: number }>;
        } | null;
    },

    async lookupByYear(year: number) {
        const { data, error } = await supabase.rpc('admin_lookup_by_year', { p_year: year });
        if (error) { console.error('[adminService.lookupByYear]', error); return null; }
        const row = Array.isArray(data) ? data[0] : data;
        return row as {
            label: string;
            views_count: number; bookings_count: number; completed_bookings: number;
            gmv: number; savings_delivered: number;
            new_buyers: number; new_sellers: number;
            monthly_breakdown: Array<{ month: string; month_key: string; views: number; books: number; gmv: number }>;
        } | null;
    },

    async getInvestorKpis(days = 30) {
        const { data, error } = await supabase.rpc('admin_investor_kpis', { p_days: days });
        if (error) { console.error('[adminService.getInvestorKpis]', error); return null; }
        const row = Array.isArray(data) ? data[0] : data;
        return row as {
            period_days: number;
            gmv: number; gmv_completed: number; savings_delivered: number;
            total_bookings: number; completed_bookings: number; cancelled_bookings: number;
            avg_order_value: number;
            dau: number; wau: number; mau: number; stickiness_pct: number;
            total_views: number; unique_viewers: number; conversion_pct: number;
            repeat_customer_rate_pct: number;
            mom_gmv_growth_pct: number; mom_bookings_growth_pct: number; mom_new_users_growth_pct: number;
            new_buyers: number; new_sellers: number; net_active_merchants: number;
        } | null;
    },

    async getGeographicBreakdown(days = 30, limit = 20) {
        const { data, error } = await supabase.rpc('admin_geographic_breakdown', { p_days: days, p_limit: limit });
        if (error) { console.error('[adminService.getGeographicBreakdown]', error); return []; }
        return (data ?? []) as Array<{
            city: string; region: string;
            bookings_count: number; completed_bookings: number;
            gmv: number; unique_buyers: number; active_stores: number;
        }>;
    },

    async getRetentionCurve(monthsBack = 6) {
        const { data, error } = await supabase.rpc('admin_retention_curve', { p_months_back: monthsBack });
        if (error) { console.error('[adminService.getRetentionCurve]', error); return []; }
        return (data ?? []) as Array<{
            cohort_month: string; cohort_label: string; cohort_size: number;
            d1_pct: number; d7_pct: number; d30_pct: number; d60_pct: number;
        }>;
    },

    async getGmvMonthly(months = 12) {
        const { data, error } = await supabase.rpc('admin_gmv_monthly', { p_months: months });
        if (error) { console.error('[adminService.getGmvMonthly]', error); return []; }
        return (data ?? []) as Array<{
            month_key: string; month_label: string;
            gmv: number; completed_gmv: number;
            bookings_count: number; completed_count: number;
            avg_order_value: number; savings_delivered: number; unique_buyers: number;
        }>;
    },

    // ================================================================
    // v11.0 — Pre-Launch Suite (health, settings audit, payment scaffold)
    // ================================================================

    async healthCheck() {
        const { data, error } = await supabase.rpc('admin_health_check');
        if (error) { console.error('[adminService.healthCheck]', error); return null; }
        return data as {
            as_of: string;
            admin_user_id: string;
            table_counts: Record<string, number>;
            critical_triggers: Record<string, boolean>;
            critical_indexes: Record<string, boolean>;
            rls_enabled: Record<string, boolean>;
            db_size_bytes: number;
        } | null;
    },

    async listPlatformSettings() {
        const { data, error } = await supabase.rpc('admin_list_platform_settings');
        if (error) { console.error('[adminService.listPlatformSettings]', error); return []; }
        return (data ?? []) as Array<{
            key: string; value: any; description: string | null; updated_at: string;
        }>;
    },

    async getPaymentGatewayStatus() {
        const { data, error } = await supabase.rpc('admin_payment_gateway_status');
        if (error) { console.error('[adminService.getPaymentGatewayStatus]', error); return null; }
        return data as {
            enabled: boolean;
            provider: string;
            has_publishable_key: boolean;
            publishable_key_hint: string | null;
            webhook_url: string;
            has_secret_configured: boolean;
            attempts_total: number;
            attempts_paid: number;
            attempts_failed: number;
        } | null;
    },

    async listPaymentAttempts(days = 30, limit = 100) {
        const { data, error } = await supabase.rpc('admin_list_payment_attempts', { p_days: days, p_limit: limit });
        if (error) { console.error('[adminService.listPaymentAttempts]', error); return []; }
        return (data ?? []) as Array<{
            id: string; merchant_id: string; merchant_name: string | null; merchant_shop: string | null;
            gateway: string; amount: number; currency: string; status: string;
            gateway_reference: string | null; error_message: string | null; created_at: string;
        }>;
    },
};
