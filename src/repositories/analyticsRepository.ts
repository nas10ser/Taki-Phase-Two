/**
 * Analytics Repository — high-throughput funnel tracking, server-only.
 *
 * Strategy:
 *   - The client buffers events in-memory and flushes once per second
 *     (or on tab hide / page unload) via the record_analytics_events RPC.
 *   - This keeps Supabase round-trips low while still achieving near-real-
 *     time analytics for the seller dashboard.
 *   - A short-lived sessionId is generated client-side per tab so each visit
 *     can be deduped and time-on-page can be measured.
 */
import { supabase } from '../services/supabaseClient';
import { logger } from '../utils/logger';

export type AnalyticsEvent =
    | 'page_view' | 'deal_view' | 'deal_click'
    | 'click_phone' | 'click_map' | 'click_share'
    | 'click_favorite' | 'click_follow'
    | 'booking_started' | 'booking_abandoned' | 'booking_completed'
    | 'time_on_page';

interface BufferedEvent {
    store_id: string;
    deal_id?: string;
    user_id?: string;
    session_id?: string;
    event_type: AnalyticsEvent;
    duration_ms?: number;
    metadata?: Record<string, any>;
    created_at?: string;
}

export interface StoreFunnel {
    views: number;
    clicks: number;
    bookingStarted: number;
    bookingAbandoned: number;
    bookingCompleted: number;
    abandonedRate: number;
    conversionRate: number;
    uniqueSessions: number;
    avgTimeMs: number;
}

export interface DealFunnel {
    views: number;
    clicks: number;
    bookingStarted: number;
    bookingAbandoned: number;
    bookingCompleted: number;
    favorites: number;
    shares: number;
}

export interface DailyStat {
    day: string;
    views: number;
    clicks: number;
    bookings: number;
}

const SESSION_KEY = 'TAKI_ANALYTICS_SESSION';

const ensureSessionId = (): string => {
    try {
        let sid = sessionStorage.getItem(SESSION_KEY);
        if (!sid) {
            sid = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
            sessionStorage.setItem(SESSION_KEY, sid);
        }
        return sid;
    } catch {
        return `s_${Date.now()}`;
    }
};

let buffer: BufferedEvent[] = [];
let flushTimer: number | null = null;
const FLUSH_INTERVAL_MS = 1500;
const MAX_BUFFER = 50;

const flush = async () => {
    if (buffer.length === 0) return;
    const batch = buffer.splice(0, buffer.length);
    try {
        await supabase.rpc('record_analytics_events', { p_events: batch as any });
    } catch (e: any) {
        // Silent: analytics must never break the app.
        logger.warn('analytics flush failed:', e?.message || e);
    }
};

const scheduleFlush = () => {
    if (flushTimer != null) return;
    flushTimer = window.setTimeout(() => {
        flushTimer = null;
        flush();
    }, FLUSH_INTERVAL_MS);
};

// Flush on tab hide / unload so we don't lose the last-second events.
if (typeof window !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('beforeunload', () => { flush(); });
}

export const analyticsRepository = {
    track: (
        storeId: string,
        eventType: AnalyticsEvent,
        opts?: { dealId?: string; userId?: string; durationMs?: number; metadata?: Record<string, any> }
    ) => {
        if (!storeId) return;
        buffer.push({
            store_id: storeId,
            deal_id: opts?.dealId,
            user_id: opts?.userId,
            session_id: ensureSessionId(),
            event_type: eventType,
            duration_ms: opts?.durationMs,
            metadata: opts?.metadata || {},
            created_at: new Date().toISOString()
        });
        if (buffer.length >= MAX_BUFFER) flush();
        else scheduleFlush();
    },

    flushNow: flush,

    getStoreFunnel: async (storeId: string, days = 30): Promise<StoreFunnel | null> => {
        const start = new Date(Date.now() - days * 86400000).toISOString();
        const end = new Date().toISOString();
        const { data, error } = await supabase.rpc('get_store_funnel', {
            p_store_id: storeId, p_start: start, p_end: end
        });
        if (error || !data || (Array.isArray(data) && data.length === 0)) {
            if (error) logger.warn('get_store_funnel:', error.message);
            return null;
        }
        const r = Array.isArray(data) ? data[0] : data;
        return {
            views: Number(r.views) || 0,
            clicks: Number(r.clicks) || 0,
            bookingStarted: Number(r.booking_started) || 0,
            bookingAbandoned: Number(r.booking_abandoned) || 0,
            bookingCompleted: Number(r.booking_completed) || 0,
            abandonedRate: Number(r.abandoned_rate) || 0,
            conversionRate: Number(r.conversion_rate) || 0,
            uniqueSessions: Number(r.unique_sessions) || 0,
            avgTimeMs: Number(r.avg_time_ms) || 0
        };
    },

    getDealFunnel: async (dealId: string, days = 30): Promise<DealFunnel | null> => {
        const start = new Date(Date.now() - days * 86400000).toISOString();
        const end = new Date().toISOString();
        const { data, error } = await supabase.rpc('get_deal_funnel', {
            p_deal_id: dealId, p_start: start, p_end: end
        });
        if (error || !data || (Array.isArray(data) && data.length === 0)) {
            if (error) logger.warn('get_deal_funnel:', error.message);
            return null;
        }
        const r = Array.isArray(data) ? data[0] : data;
        return {
            views: Number(r.views) || 0,
            clicks: Number(r.clicks) || 0,
            bookingStarted: Number(r.booking_started) || 0,
            bookingAbandoned: Number(r.booking_abandoned) || 0,
            bookingCompleted: Number(r.booking_completed) || 0,
            favorites: Number(r.favorites) || 0,
            shares: Number(r.shares) || 0
        };
    },

    getDaily: async (storeId: string, days = 14): Promise<DailyStat[]> => {
        const { data, error } = await supabase.rpc('get_store_daily', {
            p_store_id: storeId, p_days: days
        });
        if (error) {
            logger.warn('get_store_daily:', error.message);
            return [];
        }
        return (data || []).map((r: any) => ({
            day: r.day,
            views: Number(r.views) || 0,
            clicks: Number(r.clicks) || 0,
            bookings: Number(r.bookings) || 0
        }));
    }
};
