import { createClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
        '[TAKI] Missing Supabase environment variables. ' +
        'Set SUPABASE_URL and SUPABASE_ANON_KEY in your .env before starting the app.'
    );
}

export const supabaseConfig = {
    url: supabaseUrl,
    key: supabaseAnonKey
};

// Custom auth lock: serialise token-refresh attempts within this tab so a
// fresh request can never "steal" the lock from a still-running one. The
// default Web Locks adapter throws "another request stole it" when the
// browser revokes a stale lock; that warning was bubbling up to users via
// the deal-save error toast. A simple in-tab promise queue avoids it
// entirely without weakening security (cross-tab coordination still works
// through localStorage events).
let authQueue: Promise<unknown> = Promise.resolve();
const inTabLock = async <T,>(_name: string, _acquireTimeout: number, fn: () => Promise<T>): Promise<T> => {
    const run = authQueue.then(() => fn());
    authQueue = run.catch(() => undefined);
    return run;
};

// v13.58 — الجلسة تُحفظ بمفتاح ثابت ('sb-taki-auth') لا يتغيّر بتغيّر الخادم،
// فعند نقل قاعدة البيانات إلى خادم آخر تبقى الجلسة القديمة في المتصفح ويرفضها
// الخادم الجديد لأنها موقّعة بمفتاح مختلف. النتيجة: التطبيق يظنّ المستخدم داخلاً
// بينما كل طلب يفشل بصمت، فتظهر الحجوزات والطلبات والمنتجات فارغة — بلاغ ناصر.
// نتحقّق هنا من أن مُصدِر التوكن (iss) هو هذا الخادم، وإلا نمسح الجلسة فوراً
// ليُطلب تسجيل الدخول بوضوح بدل صفحات فارغة.
const AUTH_STORAGE_KEY = 'sb-taki-auth';
const dropForeignSession = () => {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return;
        const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
        if (!raw) return;
        const token = JSON.parse(raw)?.access_token;
        if (typeof token !== 'string' || token.split('.').length !== 3) return;
        const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        const issuer = String(claims?.iss || '');
        if (issuer && !issuer.startsWith(supabaseUrl)) {
            window.localStorage.removeItem(AUTH_STORAGE_KEY);
            logger.log('🔄 جلسة قديمة من خادم سابق — أُزيلت، يلزم تسجيل الدخول من جديد');
        }
    } catch { /* أي فشل هنا لا يجوز أن يمنع إقلاع التطبيق */ }
};
dropForeignSession();

// شبكة أمان ثانية: لو رفض الخادم التوكن أثناء الاستخدام (منتهٍ أو غير صالح)،
// امسح الجلسة وأعد التحميل مرة واحدة فقط بدل إظهار صفحات فارغة بلا تفسير.
let recovering = false;
const fetchWithAuthRecovery: typeof fetch = async (input, init) => {
    const res = await fetch(input, init);
    if (res.status === 401 && !recovering && typeof window !== 'undefined'
        && window.localStorage?.getItem(AUTH_STORAGE_KEY)) {
        try {
            const body = await res.clone().text();
            if (/JWS|JWT|invalid.*token|expired/i.test(body)) {
                recovering = true;
                window.localStorage.removeItem(AUTH_STORAGE_KEY);
                logger.log('🔄 التوكن مرفوض من الخادم — إعادة تحميل لتسجيل الدخول');
                window.location.reload();
            }
        } catch { /* تجاهل */ }
    }
    return res;
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: AUTH_STORAGE_KEY,
        lock: inTabLock as any
    },
    global: { fetch: fetchWithAuthRecovery },
    realtime: {
        params: { eventsPerSecond: 10 }
    }
});

logger.log('🔗 Database Layer Initialized: Connected to Supabase');
