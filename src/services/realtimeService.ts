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
// v13.82 — قناة رسائل المحادثة. `messagesFilterSupported` تصير false إذا
// رفض الخادم الترشيح (خادم لم تُطبَّق عليه هجرة v13.82 بعد)، فنبني القناة
// بلا ترشيح **مباشرة** في كل اشتراك لاحق — لا نعيد المحاولة الفاشلة كل مرة.
let messagesChannel: ReturnType<typeof supabase.channel> | null = null;
let messagesFilterSupported = true;
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
// v13.83 — مهلة استقرار بعد بناء القنوات قبل الحكم عليها بالعطل (القناة تمرّ
// بحالة `joining` قبل `joined`، والحكم عليها قبل ذلك يُنتج حلقة هدم/بناء)،
// وحدّ أدنى بين عمليات إعادة البناء القسرية حتى لا نُرهق شبكة متعثّرة.
const SETUP_GRACE = 12_000;
const RECONNECT_MIN_INTERVAL = 20_000;
let lastSetupAt = 0;
let lastForcedReconnectAt = 0;

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

        verifyAndReconnect('visibility');
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
        verifyAndReconnect('focus');
    }
    lastActivityAt = now;
}

// ─── Heartbeat ──────────────────────────────────────────────────

function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
        if (document.visibilityState !== 'visible') return;

        // v13.83 — الفحص يجري في **كل** نبضة، لا بعد ٦٠ ثانية صمت فقط.
        // الفحص محلّي بالكامل (حالة الـsocket + حالة القنوات) بلا أي طلب
        // شبكة، فتكلفته صفر عملياً. وهذا ما يمسك الحالة التي أبلغ عنها ناصر:
        // المستخدم **داخل** التطبيق يتابع محادثة، فلا يقع أي حدث visibility
        // أو focus يوقظ المزامنة، والـsocket ميت بصمت منذ دقائق.
        verifyAndReconnect('heartbeat');

        // فحص ثانٍ ألطف: القنوات تبدو سليمة لكن لا يصل شيء منذ مدة طويلة —
        // نطلب إعادة جلب تحوّطية (مكبوحة بـrequestRefresh) لا إعادة بناء.
        if (Date.now() - lastActivityAt > STALE_THRESHOLD) {
            requestRefresh('heartbeat-stale');
            lastActivityAt = Date.now();
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

/** حالة قناة بالاسم، أو null إن لم تعد موجودة أصلاً. */
function channelState(topicPart: string): string | null {
    const ch = supabase.getChannels().find((c: any) =>
        typeof c?.topic === 'string' && c.topic.includes(topicPart)
    );
    return ch ? String((ch as any).state || '') : null;
}

/**
 * v13.83 — ما الذي يجعل الريل‑تايم «ميتاً وهو يبدو حيّاً»؟
 *
 * النسخة السابقة كانت تسأل سؤالاً واحداً: «هل كائن القناة موجود في القائمة؟»
 * وهذا السؤال **يُجاب بنعم دائماً**: في `realtime-js` تُنادى `_remove` من مكان
 * واحد فقط (إغلاق القناة بنفسها)، فالقناة التي ماتت بـ`CHANNEL_ERROR` أو
 * `TIMED_OUT` — حين يقتل iOS الـwebsocket، أو ينتقل الجهاز بين Wi‑Fi والبيانات،
 * أو تنتهي مهلة وسيط — **تبقى في `getChannels()` بحالة `errored`**. فكان الفحص
 * يمرّ كل ١٥ ثانية ولا يُعيد الاتصال أبداً، وتتوقّف الرسائل بلا أي إشارة.
 *
 * أُثبت بالتجربة على عميل realtime حقيقي موجَّه لمنفذ غير قابل للوصول:
 *     getChannels() → "realtime:rt-user-TEST=errored"
 *     الفحص القديم → «سليم ✅»   ·   الفحص الجديد → «معطّل ❌»
 *
 * الآن نسأل عن **الصحة لا الوجود**: الـsocket متصل فعلاً، وكل قناة متوقَّعة في
 * حالة `joined` (و`joining` مقبولة لأنها انضمام قيد التنفيذ).
 *
 * قنوات `rt-deal-*` مستثناة عمداً: مؤقّتة تُفتح وتُغلق مع صفحة العرض، فغيابها
 * ليس عطلاً.
 */
function findUnhealthyChannel(): string | null {
    if (!currentConfig) return null;

    // مستوى الـsocket نفسه — أرخص وأصدق فحص، وبلا أي طلب شبكة.
    try {
        if (!supabase.realtime.isConnected()) return 'socket:disconnected';
    } catch {
        /* واجهة غير متاحة — نكمل بفحص القنوات وحدها */
    }

    const hasUser = !!currentConfig.userId;
    const expected: Array<[string, boolean]> = [
        ['rt-global', true],
        ['rt-user-', hasUser],
        // قناة المحادثة المستقلة (v13.82). `rt-msgs` تطابق النسختين:
        // المُرشَّحة `rt-msgs-<id>` والمرتدّة `rt-msgs-fb-<id>`.
        ['rt-msgs', hasUser],
        ['rt-favorites-', hasUser],
    ];

    for (const [topic, required] of expected) {
        if (!required) continue;
        const st = channelState(topic);
        if (st === null) return `${topic}:missing`;
        if (st !== 'joined' && st !== 'joining') return `${topic}:${st}`;
    }
    return null;
}

function verifyAndReconnect(reason: string = 'verify') {
    if (!currentConfig) return;

    // مهلة استقرار بعد كل بناء: القنوات تحتاج لحظات للانضمام، وفحصها قبل ذلك
    // يُنتج حلقة هدم/بناء لا تنتهي. وتغطّي كذلك ارتداد قناة المحادثة في v13.82
    // (تسقط بـCHANNEL_ERROR ثم يُعاد اشتراكها بلا ترشيح مباشرة بعد البناء).
    if (Date.now() - lastSetupAt < SETUP_GRACE) return;

    const problem = findUnhealthyChannel();
    if (!problem) {
        // سليمة — نصفّر عدّاد المحاولات فلا يرث اتصالٌ ناجح تأخيرَ ما قبله.
        isConnected = true;
        reconnectAttempts = 0;
        return;
    }

    if (Date.now() - lastForcedReconnectAt < RECONNECT_MIN_INTERVAL) return;
    lastForcedReconnectAt = Date.now();

    logger.warn(`🔄 Realtime unhealthy (${problem}) via ${reason} — rebuilding channels`);
    isConnected = false;
    teardownChannels();
    setupChannels(currentConfig);

    // ⚠️ جوهري: إعادة الاشتراك **لا تُعيد بثّ** الصفوف التي فاتت أثناء
    // الانقطاع — Supabase لا يحتفظ بها. فبلا إعادة جلب صريحة هنا تبقى رسالة
    // المحادثة مفقودة إلى الأبد رغم نجاح إعادة الاتصال. هذا السطر هو الفرق
    // بين «عاد الاتصال» و«عادت الرسالة».
    requestRefresh(`reconnect:${reason}`);
}

function teardownChannels() {
    // Remove only our managed channels
    const channels = supabase.getChannels();
    channels
        .filter((c: any) => {
            const topic = typeof c?.topic === 'string' ? c.topic : '';
            return topic.includes('rt-user-') ||
                   topic.includes('rt-global') ||
                   topic.includes('rt-deal-') ||
                   topic.includes('rt-msgs') ||
                   topic.includes('rt-favorites-');
        })
        .forEach((c: any) => supabase.removeChannel(c));

    userChannel = null;
    globalChannel = null;
    messagesChannel = null;
    favoritesChannel = null;
    isConnected = false;
}

function setupChannels(config: RealtimeConfig) {
    const { userId } = config;
    // v13.83 — ختم وقت البناء: فحص الصحة يمتنع عن الحكم قبل انقضاء مهلة
    // الاستقرار، وإلا هدم القنوات وهي لا تزال في حالة `joining`.
    lastSetupAt = Date.now();

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

    // ─────────────────────────────────────────────────────────────
    // Bookings — v13.80: مُرشَّحة على الخادم بدل استقبال كل حجوزات المنصّة.
    //
    // كان الاشتراك بلا `filter`، أي أن خادم الريل‑تايم يُقيّم صلاحية **كل**
    // تغيير على `bookings` أمام **كل** متصل ثم يرمي ما لا يخصّه. هذا حسابياً
    // (عدد التغييرات × عدد المتصلين): مقبول بآلاف المستخدمين، ومستحيل
    // بملايينهم — كل حجز في المملكة كان يُقيَّم أمام كل جهاز مفتوح.
    //
    // الآن اشتراكان مُرشَّحان على القاعدة: صفوفي كمشترٍ، وصفوفي كتاجر. الحساب
    // صار بعدد التغييرات وحدها، وما يصل الجهاز يخصّه أصلاً.
    //
    // الحذف يبقى باشتراك ثالث بلا ترشيح **عمداً**: صفّ الحذف في WAL لا يحمل
    // إلا المفتاح الأساسي (`barcode`)، فأي ترشيح على `user_id`/`store_id` لن
    // يطابقه أبداً وتضيع أحداث الحذف. والحذف نادر (الإلغاء تغيير حالة لا حذف)
    // فحِمله لا يُذكر.
    // ─────────────────────────────────────────────────────────────
    const onBooking = (payload: any) => {
        lastActivityAt = Date.now();
        lastSyncAt.bookings = Date.now();
        config.onBookingChange(payload);
    };

    userChannel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bookings',
        filter: `user_id=eq.${userId}`
    }, onBooking);

    userChannel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bookings',
        filter: `store_id=eq.${userId}`
    }, onBooking);

    userChannel.on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'bookings'
    }, onBooking);

    // ─────────────────────────────────────────────────────────────
    // Booking messages — v13.82: قناة مستقلة مُرشَّحة، مع ارتداد آمن.
    //
    // كانت آخر اشتراك بلا ترشيح: كل رسالة في المنصّة تُقيَّم أمام كل جهاز.
    // الترشيح صار ممكناً بعد عمود `recipient_id` (يُملأ بمشغّل في القاعدة،
    // فلا يُزوَّر من العميل):
    //     recipient_id = أنا  → الوارد
    //     sender_id    = أنا  → إيصالات القراءة على رسائلي أنا
    //
    // ولماذا قناة مستقلة؟ لأن الترشيح على عمود غير موجود يُسقط **القناة
    // كلها**. لو كان معها الحجوزات والإشعارات لسقطت هي الأخرى على خادم لم
    // تُطبَّق عليه الهجرة بعد. هنا تسقط وحدها، ويلتقطها الارتداد أدناه:
    // نعيد الاشتراك بلا ترشيح (سلوك ما قبل v13.82 بالضبط) فلا تتعطّل
    // المحادثة لحظة واحدة — مرة واحدة فقط، بلا حلقة إعادة محاولة.
    // ─────────────────────────────────────────────────────────────
    const onMessage = (payload: any) => {
        lastActivityAt = Date.now();
        config.onBookingMessage?.(payload);
    };

    const subscribeMessagesUnfiltered = () => {
        messagesChannel = supabase.channel(`rt-msgs-fb-${userId}`);
        messagesChannel.on('postgres_changes', {
            event: '*', schema: 'public', table: 'booking_messages',
        }, onMessage);
        messagesChannel.subscribe();
    };

    if (!messagesFilterSupported) {
        subscribeMessagesUnfiltered();
    } else {
        messagesChannel = supabase.channel(`rt-msgs-${userId}`);
        messagesChannel.on('postgres_changes', {
            event: '*', schema: 'public', table: 'booking_messages',
            filter: `recipient_id=eq.${userId}`,
        }, onMessage);
        messagesChannel.on('postgres_changes', {
            event: '*', schema: 'public', table: 'booking_messages',
            filter: `sender_id=eq.${userId}`,
        }, onMessage);
        messagesChannel.subscribe((status) => {
            if (status !== 'CHANNEL_ERROR' || !messagesFilterSupported) return;
            // الترشيح مرفوض على هذا الخادم — نسجّلها مرة واحدة ونرتدّ إلى سلوك
            // ما قبل v13.82 فلا تتعطّل المحادثة، وكل اشتراك لاحق يبدأ مرتدّاً.
            messagesFilterSupported = false;
            logger.warn('↩️ booking_messages filter rejected — falling back to unfiltered');
            try { if (messagesChannel) supabase.removeChannel(messagesChannel); } catch { /* ignore */ }
            subscribeMessagesUnfiltered();
        });
    }

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

    // ─────────────────────────────────────────────────────────────
    // Deals + Ratings — v13.81: من بثّ عام إلى ما يخصّ المستخدم فعلاً.
    //
    // كانا مشتركين على **كل** صفوف الجدولين بلا ترشيح. معناه أن كل نقص كمية
    // في أي عرض بأي مدينة (وهو يحدث مع كل حجز في المنصّة) كان يُقيَّم ويُبَثّ
    // إلى **كل جهاز مفتوح**. بعشرات العروض لا يُلاحَظ؛ بمليون عرض ومليون
    // متصل يصير أضخم بند في فاتورة الخادم — وأول ما ينهار.
    //
    // القاعدة الصحيحة: لا أحد يحتاج بثّاً حيّاً لمليون عرض، إنما لما يخصّه:
    //   • التاجر  → عروضه هو وتقييمات متجره (ترشيح على store_id).
    //   • المشتري → العرض المفتوح أمامه الآن (اشتراك موجّه — `watchDeal`).
    //   • البقية  → تحديث عند العودة للتطبيق/السحب للتحديث (قائم منذ v10.22).
    // ─────────────────────────────────────────────────────────────
    if (userId) {
        globalChannel.on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'deals',
            filter: `store_id=eq.${userId}`
        }, (payload) => {
            lastActivityAt = Date.now();
            lastSyncAt.deals = Date.now();
            config.onDealChange(payload);
        });

        globalChannel.on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'ratings',
            filter: `store_id=eq.${userId}`
        }, (payload) => {
            lastActivityAt = Date.now();
            config.onRatingChange?.(payload);
        });
    }

    // Store profiles (sellers)
    //
    // v13.21 — SCALE-CRITICAL: this used to subscribe to EVERY row of `users`
    // and discard non-sellers on the CLIENT. The server still had to evaluate
    // and fan out every buyer row change to every connected client — and the
    // live-location watcher writes users.lat/lng for every shopper as they
    // move. At a million shoppers that is a permanent firehose broadcast to a
    // million sockets (the single most expensive thing the app did).
    // The server-side filter below drops buyers at the source; the merchant's
    // own profile updates still arrive on the per-user channel above
    // (filter: id=eq.<me>), so nothing is lost.
    //
    // The filter is `neq.buyer`, NOT `eq.seller`: Nasser's own store is
    // ADMIN-owned, and every `user_type='seller'` filter in this codebase has
    // historically hidden it (see the admin-owner gate lessons). `neq.buyer`
    // keeps sellers AND admin-owned stores while still dropping the millions
    // of shopper rows that cause the fan-out.
    globalChannel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'users',
        filter: 'user_type=neq.buyer'
    }, (payload) => {
        lastActivityAt = Date.now();
        lastSyncAt.storeProfiles = Date.now();
        config.onUserChange(payload);
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
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                // v13.83 — كانت هذه القناة وحدها بلا أي معالجة خطأ: تسقط
                // فتبقى ساقطة إلى الأبد (المفضّلة تتوقف عن التحديث بصمت).
                logger.warn('❌ Realtime favorites channel error:', status);
                scheduleReconnect();
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
            // v13.83 — نفس درس verifyAndReconnect: إعادة الاشتراك لا تُعيد
            // الصفوف الفائتة، فبلا إعادة الجلب هنا يبقى ما فات مفقوداً.
            requestRefresh('reconnect-backoff');
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
    },

    /**
     * v13.81 — اشتراك موجّه على **عرض واحد**: يستعمله من يفتح صفحة العرض.
     *
     * بعد إلغاء البثّ العام للعروض، هذا هو ما يُبقي «٣ متبقية» تتناقص أمام
     * عين المشتري وهو ينظر إلى الصفحة — وهو الموضع الوحيد الذي تهمّ فيه
     * اللحظية للمشتري. قناة مستقلة لكل عرض مفتوح، تُغلق بمغادرته، فالتكلفة
     * على الخادم بعدد من يشاهدون هذا العرض الآن لا بعدد مستخدمي المنصّة.
     *
     * يُرجع دالة إلغاء الاشتراك (استعملها في `useEffect` cleanup).
     */
    watchDeal(dealId: string, onChange: EventCallback): CleanupFn {
        if (!dealId) return () => {};
        const ch = supabase.channel(`rt-deal-${dealId}`);
        ch.on('postgres_changes', {
            event: '*', schema: 'public', table: 'deals', filter: `id=eq.${dealId}`,
        }, (payload) => {
            lastActivityAt = Date.now();
            lastSyncAt.deals = Date.now();
            onChange(payload);
        });
        ch.subscribe();
        return () => { try { supabase.removeChannel(ch); } catch { /* ignore */ } };
    }
};
