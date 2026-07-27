import { supabase } from './supabaseClient';

/**
 * v13.29 — ناقل أحداث التحليلات.
 *
 * كان `store_analytics_events` وجدولُه ودوالُّه الثلاث القِمعية (`get_deal_funnel`
 * و`get_store_funnel` و`get_store_daily`) موجودة منذ إصدارات — **ولا أحد يكتب
 * فيها**. صفر حدث. فكل تحليل قِمعي للتاجر كان يعرض أصفاراً، وقائمة الجاهزية
 * تقول «التتبّع جاهز». هذا الملف هو الطرف الناقص.
 *
 * قواعد التصميم:
 *  • **تجميع دفعي**: الأحداث تُكدَّس وتُرسل كل ٥ ثوانٍ أو عند بلوغ ٢٠ حدثاً —
 *    فلا نداء شبكة لكل نقرة، ولا يتأثر شعور المستخدم بالسرعة إطلاقاً.
 *  • **لا يُفقد شيء عند الإغلاق**: `visibilitychange` + `pagehide` يُفرغان الطابور
 *    (مسار iOS الوحيد الموثوق — `beforeunload` لا يُطلق على سفاري الجوال).
 *  • **إزالة تكرار المشاهدة**: نفس المنتج لنفس الجلسة لا يُسجَّل مرتين خلال
 *    ٣٠ دقيقة، وصاحب المتجر لا يُحتسب على منتجه أبداً.
 *  • **صامت تماماً**: القياس لا يجوز أن يُفشل تجربة الشراء. كل خطأ يُبتلع
 *    عمداً بعد تسجيله في وحدة التحكم أثناء التطوير فقط.
 */

export type AnalyticsEvent =
    | 'deal_view'          // فُتحت صفحة المنتج
    | 'deal_click'         // نُقرت بطاقة المنتج
    | 'click_favorite'     // أُضيف للمفضلة
    | 'click_share'        // شُورك
    | 'booking_started'    // فُتحت ورقة الحجز
    | 'booking_completed'  // اكتمل الحجز
    | 'booking_abandoned'  // غادر ورقة الحجز دون إتمام
    | 'time_on_page';      // مدة البقاء على صفحة المنتج

interface QueuedEvent {
    store_id: string;
    deal_id?: string | null;
    session_id: string;
    event_type: AnalyticsEvent;
    duration_ms?: number | null;
    metadata?: Record<string, unknown>;
    created_at: string;
}

const SESSION_KEY = 'taki_an_sid';
const DEDUPE_KEY = 'taki_an_seen';
const FLUSH_MS = 5000;
const MAX_BATCH = 20;
const DEDUPE_WINDOW_MS = 30 * 60 * 1000;   // نصف ساعة — نفس نافذة جلسة app_open

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listenersBound = false;
/** معرّف صاحب المتجر الحالي — لا نحتسب مشاهدات التاجر على منتجاته. */
let selfStoreId: string | null = null;

/** معرّف جلسة ثابت طوال عمر التبويب (لا يعرّف الشخص — لقياس التكرار فقط). */
const sessionId = (): string => {
    try {
        let s = sessionStorage.getItem(SESSION_KEY);
        if (!s) {
            s = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
            sessionStorage.setItem(SESSION_KEY, s);
        }
        return s;
    } catch {
        return 's_nostore';
    }
};

/** true إذا سُجّل هذا المفتاح خلال النافذة — ويُختم الآن إن لم يكن. */
const seenRecently = (key: string): boolean => {
    try {
        const now = Date.now();
        const raw = sessionStorage.getItem(DEDUPE_KEY);
        const map: Record<string, number> = raw ? JSON.parse(raw) : {};
        // نظافة: أسقط ما تجاوز النافذة حتى لا ينمو التخزين بلا حد
        for (const k of Object.keys(map)) if (now - map[k] > DEDUPE_WINDOW_MS) delete map[k];
        if (map[key] && now - map[key] < DEDUPE_WINDOW_MS) return true;
        map[key] = now;
        sessionStorage.setItem(DEDUPE_KEY, JSON.stringify(map));
        return false;
    } catch {
        return false;   // تخزين محجوب → سجّل ولا تمنع
    }
};

const flush = async (): Promise<void> => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    try {
        await supabase.rpc('record_analytics_events', { p_events: batch });
    } catch {
        /* القياس لا يُفشل شيئاً — ولا نعيد المحاولة حتى لا نضخّم الأرقام */
    }
};

const bindLifecycle = () => {
    if (listenersBound || typeof document === 'undefined') return;
    listenersBound = true;
    // إخفاء الصفحة هو المسار الوحيد الموثوق على iOS Safari — `beforeunload`
    // لا يُطلق هناك، فكانت الدفعة الأخيرة ستضيع مع كل خروج.
    const onHide = () => { if (document.visibilityState === 'hidden') void flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', () => { void flush(); });
};

/** يُستدعى من AppContext عند تغيّر المستخدم. */
export const setAnalyticsIdentity = (storeId: string | null): void => {
    selfStoreId = storeId;
};

export const trackEvent = (
    eventType: AnalyticsEvent,
    storeId: string | null | undefined,
    dealId?: string | null,
    opts?: { durationMs?: number; metadata?: Record<string, unknown>; dedupeKey?: string },
): void => {
    try {
        if (!storeId) return;
        // التاجر لا يُضخّم أرقام نفسه بتصفّح منتجاته
        if (selfStoreId && selfStoreId === storeId) return;
        if (opts?.dedupeKey && seenRecently(opts.dedupeKey)) return;

        bindLifecycle();
        queue.push({
            store_id: storeId,
            deal_id: dealId || null,
            session_id: sessionId(),
            event_type: eventType,
            duration_ms: opts?.durationMs ?? null,
            metadata: opts?.metadata || {},
            created_at: new Date().toISOString(),
        });

        if (queue.length >= MAX_BATCH) { void flush(); return; }
        if (!timer) timer = setTimeout(() => { void flush(); }, FLUSH_MS);
    } catch {
        /* صامت عمداً */
    }
};

/**
 * مشاهدة منتج — مُزال التكرار لكل (جلسة، منتج) خلال ٣٠ دقيقة.
 * يُرجع true إذا سُجّلت فعلاً، ليعرف المُستدعي هل يرفع العدّاد الدائم أيضاً.
 */
export const trackDealView = (storeId: string | null | undefined, dealId: string): boolean => {
    if (!storeId) return false;
    if (selfStoreId && selfStoreId === storeId) return false;
    if (seenRecently(`v:${dealId}`)) return false;
    trackEvent('deal_view', storeId, dealId);
    return true;
};

export const flushAnalytics = flush;
