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

// ─── Visibility & Online Handlers ───────────────────────────────

function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
        logger.info('👁️ Tab became visible — triggering sync');
        const now = Date.now();
        const elapsed = now - lastActivityAt;

        // If we've been away for more than 10 seconds, do a full refresh
        if (elapsed > 10_000 && currentConfig) {
            logger.info(`⏰ Away for ${Math.round(elapsed / 1000)}s — full re-sync`);
            currentConfig.onRefreshAll();
        }

        // Also verify channels are still connected
        verifyAndReconnect();
        lastActivityAt = now;
    }
}

function handleOnline() {
    logger.info('🌐 Network came online — reconnecting');
    if (currentConfig) {
        // Small delay to let the network stabilize
        setTimeout(() => {
            teardownChannels();
            setupChannels(currentConfig!);
            currentConfig!.onRefreshAll();
        }, 1000);
    }
}

function handleOffline() {
    logger.info('📡 Network went offline');
    isConnected = false;
}

// Handle page focus (works on mobile browsers better than visibilitychange)
function handleFocus() {
    const now = Date.now();
    const elapsed = now - lastActivityAt;
    if (elapsed > 5_000 && currentConfig) {
        logger.info(`🔄 Window focused after ${Math.round(elapsed / 1000)}s — quick sync`);
        currentConfig.onRefreshAll();
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

        // Do an initial full sync to catch anything missed while disconnected
        setTimeout(() => {
            config.onRefreshAll();
        }, 500);

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

        teardownChannels();

        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        window.removeEventListener('focus', handleFocus);
    },

    /**
     * Force a full data refresh right now.
     */
    async forceRefresh() {
        if (currentConfig) {
            logger.info('🔄 Realtime Service: Force refresh');
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
