/**
 * Realtime Service — Central hub for ALL real-time synchronization in TAKI.
 * 
 * Handles:
 * - Supabase Realtime channel management with auto-reconnect
 * - Visibility-change re-sync (when user returns to tab/app)
 * - Online/offline detection with automatic data refresh
 * - Heartbeat monitoring to detect stale connections
 * - Focus-based re-hydration for all data types
 * 
 * This ensures ALL services (notifications, bookings, deals, favorites,
 * follows, store profiles, etc.) update in real-time without requiring
 * the user to refresh or re-open the app.
 */

import { supabase } from './supabaseClient';
import { logger } from '../utils/logger';

// ─── Types ──────────────────────────────────────────────────────
type EventCallback = (payload: any) => void;
type CleanupFn = () => void;

interface RealtimeConfig {
    userId?: string | null;
    onNotificationInsert: EventCallback;
    onNotificationUpdate: EventCallback;
    onBookingChange: EventCallback;
    onBookingMessage?: EventCallback;
    onDealChange: EventCallback;
    onRatingChange?: EventCallback;
    onUserChange: EventCallback;
    onFavoriteChange: EventCallback;
    onRefreshAll: () => Promise<void>;
}

// ─── State ──────────────────────────────────────────────────────
let currentConfig: RealtimeConfig | null = null;
let userChannel: ReturnType<typeof supabase.channel> | null = null;
let globalChannel: ReturnType<typeof supabase.channel> | null = null;
let favoritesChannel: ReturnType<typeof supabase.channel> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastActivityAt = Date.now();
// Timestamp of the last time the page was genuinely hidden (backgrounded /
// locked / app-switched). iOS standalone PWAs fire a window `focus` event
// when the soft keyboard is dismissed — e.g. tapping "Send" after typing a
// chat message — even though the app never left the foreground. Treating
// that as a return-from-background kicked off onRefreshAll() (5 heavy
// queries + 5 big setState → a full re-render) right on top of the send,
// which froze the UI for ~6s before the message appeared. We only count a
// focus/visible as a real return when the page was actually hidden first.
let lastHiddenAt = 0;
let isConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30_000; // 30s max backoff
const HEARTBEAT_INTERVAL = 15_000; // Check every 15s
const STALE_THRESHOLD = 60_000; // Consider stale after 60s of no activity

// Track last sync timestamps per data type
const lastSyncAt: Record<string, number> = {
    notifications: 0,
    bookings: 0,
    deals: 0,
    favorites: 0,
    storeProfiles: 0,
    user: 0,
};

// ─── Refresh coalescing ─────────────────────────────────────────
// Multiple subsystems ask for a full re-sync near-simultaneously:
// `visibilitychange` AND `focus` both fire when a tab is re-entered;
// `online` / `pageshow` can pile on top. Without coalescing, returning
// to the app fired onRefreshAll (5 heavy queries) 2-3× back-to-back —
// a major contributor to "الموقع ثقيل". This collapses any burst into a
// single refresh and enforces a minimum gap between full refreshes.
// Explicit pull-to-refresh (forceRefresh) deliberately bypasses it.
let lastRefreshAt = 0;
let refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const REFRESH_MIN_INTERVAL = 6_000; // ignore repeat refreshes within 6s
const REFRESH_DEBOUNCE = 600;       // collapse a burst of triggers into one

function requestRefresh(reason: string) {
    if (!currentConfig) return;
    if (refreshDebounceTimer) return; // a refresh is already queued
    const since = Date.now() - lastRefreshAt;
    if (since < REFRESH_MIN_INTERVAL) {
        logger.info(`⏭️ Refresh (${reason}) skipped — ran ${Math.round(since / 1000)}s ago`);
        return;
    }
    refreshDebounceTimer = setTimeout(() => {
        refreshDebounceTimer = null;
        if (!currentConfig) return;
        lastRefreshAt = Date.now();
        logger.info(`🔄 Coalesced refresh (${reason})`);
        currentConfig.onRefreshAll();
    }, REFRESH_DEBOUNCE);
}

// ─── Visibility & Online Handlers ───────────────────────────────

// True only if the page was genuinely hidden since we last treated the app
// as active. This is what tells a real background→foreground return apart
// from an in-app iOS keyboard-dismiss `focus` (page never hid → no heavy
// re-sync). Real background trips reliably fire visibilitychange→hidden
// and/or pagehide on every modern iOS, so genuine returns still re-sync.
function cameBackFromHidden(): boolean {
    return lastHiddenAt > lastActivityAt;
}

function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
        lastHiddenAt = Date.now();
        return;
    }
    if (document.visibilityState === 'visible') {
        logger.info('👁️ Tab became visible — triggering sync');
        const now = Date.now();
        const elapsed = now - lastActivityAt;

        // Re-sync on a genuine return to foreground. iOS Safari pauses the
        // realtime websocket as soon as the tab loses focus, so even a
        // 2-second dip behind another app means we missed packets. Gated
        // on cameBackFromHidden() so a spurious visible (no preceding
        // hide) can't trigger the heavy onRefreshAll storm.
        if (currentConfig && cameBackFromHidden() && elapsed > 1_000) {
            logger.info(`⏰ Away for ${Math.round(elapsed / 1000)}s — full re-sync`);
            requestRefresh('visibility');
        }

        verifyAndReconnect();
        lastActivityAt = now;
    }
}

// pagehide is the most reliable "the app is going to the background" signal
// on iOS standalone PWAs (visibilitychange is sometimes skipped there).
function handlePageHide() {
    lastHiddenAt = Date.now();
}

// iOS Safari restores the page from the back-forward cache (bfcache) on
// swipe-back / "rerun previous tab" — visibilitychange does NOT fire in
// that path. `pageshow` does, and the `persisted` flag distinguishes a
// bfcache restore (where the websocket is definitely dead) from a normal
// first load.
function handlePageShow(e: PageTransitionEvent) {
    if (e.persisted && currentConfig) {
        logger.info('♻️ Restored from bfcache — full reconnect + re-sync');
        teardownChannels();
        setupChannels(currentConfig);
        requestRefresh('bfcache');
        lastActivityAt = Date.now();
    }
}

function handleOnline() {
    logger.info('🌐 Network came online — reconnecting');
    if (currentConfig) {
        // Small delay to let the network stabilize
        setTimeout(() => {
            if (!currentConfig) return;
            teardownChannels();
            setupChannels(currentConfig);
            requestRefresh('online');
        }, 1000);
    }
}

function handleOffline() {
    logger.info('📡 Network went offline');
    isConnected = false;
}

// Handle page focus (works on mobile browsers better than visibilitychange).
// Only a focus that follows a genuine hide counts as a return — a bare
// focus with the page never hidden is the iOS keyboard-dismiss case (e.g.
// tapping "Send" after typing), which must NOT trigger onRefreshAll().
function handleFocus() {
    const now = Date.now();
    const elapsed = now - lastActivityAt;
    if (currentConfig && cameBackFromHidden() && elapsed > 1_000) {
        logger.info(`🔄 Window focused after ${Math.round(elapsed / 1000)}s — quick sync`);
        requestRefresh('focus');
        verifyAndReconnect();
    }
    lastActivityAt = now;
}

// ─── Heartbeat ──────────────────────────────────────────────────

function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
        const now = Date.now();
        const sinceLastActivity = now - lastActivityAt;

        // If the tab is visible but we haven't gotten any realtime
        // activity in a while, the connection might be dead
        if (document.visibilityState === 'visible' && sinceLastActivity > STALE_THRESHOLD) {
            logger.warn('💓 Heartbeat: connection may be stale, verifying...');
            verifyAndReconnect();
        }
    }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}

// ─── Channel Management ─────────────────────────────────────────

function verifyAndReconnect() {
    // Check if channels are still in a good state
    const channels = supabase.getChannels();
    const hasUserChannel = !currentConfig?.userId || channels.some((c: any) =>
        typeof c?.topic === 'string' && c.topic.includes('rt-user-')
    );
    const hasGlobalChannel = channels.some((c: any) =>
        typeof c?.topic === 'string' && c.topic.includes('rt-global')
    );

    if (currentConfig && (!hasUserChannel || !hasGlobalChannel)) {
        logger.warn('🔄 Channels missing — reconnecting...');
        teardownChannels();
        setupChannels(currentConfig);
    }
}

function teardownChannels() {
    // Remove only our managed channels
    const channels = supabase.getChannels();
    channels
        .filter((c: any) => {
            const topic = typeof c?.topic === 'string' ? c.topic : '';
            return topic.includes('rt-user-') ||
                   topic.includes('rt-global') ||
                   topic.includes('rt-favorites-');
        })
        .forEach((c: any) => supabase.removeChannel(c));

    userChannel = null;
    globalChannel = null;
    favoritesChannel = null;
    isConnected = false;
}

function setupChannels(config: RealtimeConfig) {
    const { userId } = config;

    if (userId) {
        // ─── 1. User-specific channel (notifications + bookings) ────
        userChannel = supabase.channel(`rt-user-${userId}`);

    // Notifications: INSERT
    userChannel.on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`
    }, (payload) => {
        lastActivityAt = Date.now();
        lastSyncAt.notifications = Date.now();
        config.onNotificationInsert(payload);
    });

    // Notifications: UPDATE (mark as read from another device)
    userChannel.on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`
    }, (payload) => {
        lastActivityAt = Date.now();
        config.onNotificationUpdate(payload);
    });

    // Notifications: DELETE
    userChannel.on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'notifications'
    }, (payload) => {
        lastActivityAt = Date.now();
        config.onNotificationUpdate(payload);
    });

    // Bookings: all events (INSERT, UPDATE, DELETE)
    userChannel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bookings'
    }, (payload) => {
        lastActivityAt = Date.now();
        lastSyncAt.bookings = Date.now();
        config.onBookingChange(payload);
    });

    // Booking messages: live thread updates (INSERT for new, UPDATE for read-receipts).
    // RLS already restricts visibility to either party of the booking, so the
    // client receives only messages for bookings it actually has access to.
    userChannel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'booking_messages'
    }, (payload) => {
        lastActivityAt = Date.now();
        config.onBookingMessage?.(payload);
    });

    // User profile changes (for this user — settings, keywords, etc.)
    userChannel.on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'users',
        filter: `id=eq.${userId}`
    }, (payload) => {
        lastActivityAt = Date.now();
        lastSyncAt.user = Date.now();
        config.onUserChange(payload);
    });

        userChannel.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                logger.info('✅ Realtime user channel connected:', userId);
                isConnected = true;
                reconnectAttempts = 0;
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                logger.warn('❌ Realtime user channel error:', status);
                isConnected = false;
                scheduleReconnect();
            } else if (status === 'CLOSED') {
                isConnected = false;
            }
        });
    }

    // ─── 2. Global channel (deals + store profiles) ────────────
    globalChannel = supabase.channel('rt-global');

    // Deals: all events
    globalChannel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'deals'
    }, (payload) => {
        lastActivityAt = Date.now();
        lastSyncAt.deals = Date.now();
        config.onDealChange(payload);
    });

    // Ratings: a review written anywhere (bot / app / another device) lands in the
    // shared `ratings` table. Surface it live so the store average + comments
    // update within seconds instead of waiting for a manual reload (the previous
    // gap that made bot ratings look like they "took minutes" on the website).
    globalChannel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'ratings'
    }, (payload) => {
        lastActivityAt = Date.now();
        config.onRatingChange?.(payload);
    });

    // Store profiles (sellers)
    globalChannel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'users'
    }, (payload) => {
        const newUser = payload.new as any;
        const oldUser = payload.old as any;
        if (newUser?.user_type === 'seller' || oldUser?.user_type === 'seller') {
            lastActivityAt = Date.now();
            lastSyncAt.storeProfiles = Date.now();
            config.onUserChange(payload);
        }
    });

    globalChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
            logger.info('✅ Realtime global channel connected');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            logger.warn('❌ Realtime global channel error:', status);
            scheduleReconnect();
        }
    });

    if (userId) {
        // ─── 3. Favorites channel (for this user) ──────────────────
        favoritesChannel = supabase.channel(`rt-favorites-${userId}`);

        favoritesChannel.on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'favorites',
            filter: `user_id=eq.${userId}`
        }, (payload) => {
            lastActivityAt = Date.now();
            lastSyncAt.favorites = Date.now();
            config.onFavoriteChange(payload);
        });

        favoritesChannel.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                logger.info('✅ Realtime favorites channel connected');
            }
        });
    }
}

function scheduleReconnect() {
    if (reconnectTimer) return;

    // Exponential backoff: 1s, 2s, 4s, 8s, ... up to MAX_RECONNECT_DELAY
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
    reconnectAttempts++;

    logger.info(`🔄 Scheduling reconnect in ${delay}ms (attempt ${reconnectAttempts})`);

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (currentConfig && document.visibilityState === 'visible') {
            teardownChannels();
            setupChannels(currentConfig);
        }
    }, delay);
}

// ─── Public API ─────────────────────────────────────────────────

export const realtimeService = {
    /**
     * Initialize the realtime service for a logged-in user.
     * Sets up all channels, listeners, and background monitors.
     */
    connect(config: RealtimeConfig): CleanupFn {
        logger.info('🚀 Realtime Service: Connecting for user', config.userId || 'guest');

        // Tear down any previous session
        this.disconnect();

        currentConfig = config;
        lastActivityAt = Date.now();
        reconnectAttempts = 0;

        // Setup channels
        setupChannels(config);

        // Start heartbeat monitoring
        startHeartbeat();

        // Register visibility and network listeners
        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        window.addEventListener('focus', handleFocus);
        window.addEventListener('pagehide', handlePageHide);
        window.addEventListener('pageshow', handlePageShow);

        // NOTE: no auto-refresh on connect. Cold load is owned by
        // AppContext.initData(); a login re-connect is hydrated by the
        // SIGNED_IN auth path; a genuine "was away → came back" reconnect
        // goes through the visibility/focus/online/pageshow handlers, which
        // all funnel into the coalesced requestRefresh(). The old
        // unconditional 500 ms onRefreshAll here fired a 5-query refetch
        // right on top of initData on every single page open.

        return () => this.disconnect();
    },

    /**
     * Disconnect all channels and remove all listeners.
     */
    disconnect() {
        logger.info('🔌 Realtime Service: Disconnecting');

        currentConfig = null;
        stopHeartbeat();

        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        if (refreshDebounceTimer) {
            clearTimeout(refreshDebounceTimer);
            refreshDebounceTimer = null;
        }
        // Reset so the first refresh after a genuine reconnect is honored.
        lastRefreshAt = 0;

        teardownChannels();

        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        window.removeEventListener('focus', handleFocus);
        window.removeEventListener('pagehide', handlePageHide);
        window.removeEventListener('pageshow', handlePageShow);
    },

    /**
     * Force a full data refresh right now.
     */
    async forceRefresh() {
        if (currentConfig) {
            logger.info('🔄 Realtime Service: Force refresh (explicit)');
            // Explicit user intent (pull-to-refresh) — bypass the coalescer
            // but still stamp the clock so an incidental focus/visibility
            // event a second later doesn't immediately refetch again.
            if (refreshDebounceTimer) {
                clearTimeout(refreshDebounceTimer);
                refreshDebounceTimer = null;
            }
            lastRefreshAt = Date.now();
            await currentConfig.onRefreshAll();
        }
    },

    /**
     * Get connection status.
     */
    getStatus() {
        return {
            isConnected,
            lastActivityAt,
            reconnectAttempts,
            lastSyncAt: { ...lastSyncAt },
        };
    },

    /**
     * Mark activity — call this from any handler that receives
     * realtime data to keep the heartbeat happy.
     */
    markActivity() {
        lastActivityAt = Date.now();
    }
};
