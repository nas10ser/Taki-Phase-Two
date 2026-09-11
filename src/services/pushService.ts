/**
 * pushService — اشتراك إشعارات الجوّال (Web Push) — v14.13
 * ═══════════════════════════════════════════════════════════════════════════
 * الإرسال يتم على الخادم: مشغّل `tr_notification_push` على جدول `notifications`
 * ينادي دالة `send-push` التي تُرسل لكل أجهزة صاحب الإشعار.
 *
 * 🪤 ما أُصلح هنا (v14.13):
 *   ١) **الإذن كان يُطلب لحظة فتح التطبيق** مقابل لا شيء يراه المستخدم — وهو
 *      أسوأ وقت لطلبه: أغلب الناس يرفضون، والرفض على الويب شبه نهائي (لا
 *      يُعاد السؤال). صار الطلب بزرٍّ صريح بعد أول حجز ناجح، حين يكون للإشعار
 *      معنى واضح: «طلبك جاهز» و«مندوبك انطلق».
 *   ٢) **تسجيل عامل الخدمة كان مربوطاً بطلب الإذن** — انتقل إلى `sw-cleanup`
 *      فصار يعمل دائماً بلا سؤال.
 *   ٣) **المفتاح العام كان يُنتظر من متغيّر بناء** لم يُضبط قط، فكانت الدالة
 *      تخرج صامتة. صار يُقرأ من `platform_settings.vapid_public_key` لحظياً —
 *      لا خطوة بناء ولا متغيّر بيئة على Vercel.
 */

import { supabase } from './supabaseClient';
import { logger } from '../utils/logger';

/** حالة الإشعارات على هذا الجهاز — تقودُ ما يُعرض للمستخدم. */
export type PushState =
    | 'unsupported'     // متصفّح بلا Push (أو iOS في المتصفّح لا كتطبيق مثبَّت)
    | 'ios-needs-install' // آيفون: لا إشعارات إلا بعد «إضافة إلى الشاشة الرئيسية»
    | 'denied'          // المستخدم رفض — لا يُعاد السؤال، يُفتح من إعدادات المتصفّح
    | 'off'             // يمكن التفعيل
    | 'on';             // مفعّل ومشترك

let _vapidCache: string | null = null;

/** المفتاح العام من القاعدة (عامٌّ بطبيعته — المتصفّح يحتاجه ليشترك). */
async function vapidKey(): Promise<string> {
    if (_vapidCache !== null) return _vapidCache;
    try {
        const { data } = await supabase
            .from('platform_settings').select('value').eq('key', 'vapid_public_key').maybeSingle();
        _vapidCache = typeof data?.value === 'string' ? data.value : '';
    } catch {
        _vapidCache = '';
    }
    return _vapidCache;
}

const urlBase64ToUint8Array = (b64: string): Uint8Array => {
    const padding = '='.repeat((4 - (b64.length % 4)) % 4);
    const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
};

const arrayBufferToBase64 = (buf: ArrayBuffer | null): string => {
    if (!buf) return '';
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
};

const isIOS = (): boolean =>
    typeof navigator !== 'undefined' &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1));

/** التطبيق مثبَّت على الشاشة الرئيسية؟ شرطٌ لا مفرّ منه لإشعارات آيفون. */
const isStandalone = (): boolean => {
    if (typeof window === 'undefined') return false;
    return (window.navigator as any).standalone === true
        || window.matchMedia?.('(display-mode: standalone)').matches === true;
};

/** لا يُسجِّل عاملاً جديداً — التسجيل مسؤولية `sw-cleanup` وحدها. */
async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
    try {
        return (await navigator.serviceWorker.getRegistration('/'))
            || (await navigator.serviceWorker.ready.catch(() => null));
    } catch {
        return null;
    }
}

/** يكتب/يحدّث صفّ الاشتراك. يُرجع true عند النجاح. */
async function persist(sub: PushSubscription, userId?: string): Promise<boolean> {
    const json = sub.toJSON?.() as any;
    const endpoint = json?.endpoint || (sub as any).endpoint;
    const p256dh = json?.keys?.p256dh || arrayBufferToBase64(sub.getKey?.('p256dh') || null);
    const auth = json?.keys?.auth || arrayBufferToBase64(sub.getKey?.('auth') || null);
    if (!endpoint || !p256dh || !auth) return false;

    let uid = userId;
    if (!uid) {
        try { uid = (await supabase.auth.getUser()).data?.user?.id; } catch { /* ignore */ }
    }
    if (!uid) return false;

    // ⚠️ الكتابة تُرجع خطأً يجب فحصه — زرٌّ صامت يقول «تم» وهو لم يتم
    // هو بالضبط ما يجعل المستخدم ينتظر إشعاراً لن يصل.
    const { error } = await supabase.from('push_subscriptions').upsert({
        user_id: uid,
        endpoint,
        p256dh,
        auth,
        user_agent: navigator.userAgent.slice(0, 240),
        last_used_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
    if (error) {
        logger.warn('Push subscription upsert failed:', error.message);
        return false;
    }
    return true;
}

export const pushService = {
    /** ماذا نعرض للمستخدم على هذا الجهاز تحديداً؟ */
    status: async (): Promise<PushState> => {
        if (typeof window === 'undefined' || !('Notification' in window)) {
            return isIOS() && !isStandalone() ? 'ios-needs-install' : 'unsupported';
        }
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            return isIOS() && !isStandalone() ? 'ios-needs-install' : 'unsupported';
        }
        // آيفون لا يوصّل إشعاراً إلا للتطبيق المثبَّت — قوله صراحةً أفضل من صمت.
        if (isIOS() && !isStandalone()) return 'ios-needs-install';
        if (Notification.permission === 'denied') return 'denied';
        if (Notification.permission !== 'granted') return 'off';
        try {
            const reg = await getRegistration();
            const sub = await reg?.pushManager.getSubscription();
            return sub ? 'on' : 'off';
        } catch {
            return 'off';
        }
    },

    /**
     * يُنادى **من ضغطة زرّ صريحة فقط**: يطلب الإذن، ينشئ الاشتراك، يحفظه.
     * يُرجع الحالة النهائية كي يعرض المتّصل الرسالة الصحيحة.
     */
    enable: async (userId?: string): Promise<PushState> => {
        const pre = await pushService.status();
        if (pre === 'unsupported' || pre === 'ios-needs-install' || pre === 'denied') return pre;

        let perm = Notification.permission;
        if (perm === 'default') {
            try { perm = await Notification.requestPermission(); } catch { return 'off'; }
        }
        if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';

        const key = await vapidKey();
        if (!key) { logger.warn('VAPID public key missing — push disabled'); return 'off'; }

        const reg = await getRegistration();
        if (!reg) return 'off';

        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
            try {
                sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(key) as unknown as BufferSource,
                });
            } catch (e) {
                logger.warn('Push subscribe failed:', (e as any)?.message || e);
                return 'off';
            }
        }
        if (!sub) return 'off';
        return (await persist(sub, userId)) ? 'on' : 'off';
    },

    /**
     * تحديث صامت لاشتراك قائم — لا يطلب إذناً ولا يعرض شيئاً.
     * يُنادى عند الإقلاع فقط حين يكون الإذن ممنوحاً أصلاً، كي يبقى الصفّ
     * حيّاً (`last_used_at`) ولا يكنسه تنظيف التسعين يوماً.
     */
    refreshIfEnabled: async (userId?: string): Promise<void> => {
        try {
            if (typeof window === 'undefined' || !('Notification' in window)) return;
            if (Notification.permission !== 'granted') return;
            if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
            const reg = await getRegistration();
            const sub = await reg?.pushManager.getSubscription();
            if (sub) await persist(sub, userId);
        } catch { /* صامتة عمداً */ }
    },

    /** إيقاف الإشعارات على هذا الجهاز (زرّ صريح، أو خروج من الحساب). */
    disable: async (): Promise<void> => {
        try {
            const reg = await getRegistration();
            const sub = await reg?.pushManager.getSubscription();
            if (!sub) return;
            const endpoint = sub.endpoint;
            await sub.unsubscribe().catch(() => {});
            await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
        } catch { /* ignore */ }
    },

    /** اسم قديم أبقيناه للتوافق مع مسار الخروج. */
    unsubscribe: async (): Promise<void> => { await pushService.disable(); },
};
