/**
 * Optional error monitoring (v11.44 · كسولٌ منذ v14.83).
 *
 * يبقى **صامتاً تماماً** حتى يُضبط `SENTRY_DSN` وقت البناء
 * (Vercel ▸ Project ▸ Settings ▸ Environment Variables ثم إعادة نشر).
 * والقياس لا يجوز أن يُعطّل التطبيق أو يُبطئه، فكل نداء محروس.
 *
 * ── لماذا صار كسولاً (v14.83) ──────────────────────────────────────────────
 * 🔴 كان `import * as Sentry from '@sentry/react'` **ساكناً**، و`index.tsx`
 *    يستورد هذا الملفّ عند الإقلاع — فتدخل الحزمة كاملةً (ومعها **Session
 *    Replay** وهي أثقل أجزائها) في **حزمة الدخول** التي يحمّلها كل زائر،
 *    قبل أن يرى حرفاً واحداً. قِيس: حزمة الدخول ٨١٣ كيلوبايت.
 *    والأسوأ: الاستيراد الساكن يدخل الحزمة **حتى حين لا يوجد DSN أصلاً** —
 *    أي ثِقلٌ كامل مقابل صفر فائدة.
 *
 * ما صار: `import('@sentry/react')` ديناميكيّ **بعد أوّل رسم وعند خمول
 * المتصفّح**، ولا يُنادى إطلاقاً بلا DSN.
 *
 * 🪤 **ولا يُفقد خطأ وقع قبل أن تجهز الحزمة**: الأخطاء تُكدَّس في طابورٍ صغير
 *    وتُفرَغ لحظة الجهوز. ولولا ذلك لكان أخطر وقتٍ في عمر الصفحة (أوّل ثانية،
 *    حيث تقع أخطاء الإقلاع) هو الوقت الوحيد غير المراقَب — وهو عكس الغرض.
 * 🪤 وسقف الطابور ٢٠: خطأٌ متكرّر في حلقةٍ لا يجوز أن يأكل الذاكرة.
 */

const DSN = (process.env.SENTRY_DSN || '').trim();

type SentryModule = typeof import('@sentry/react');

let sentry: SentryModule | null = null;
let enabled = false;
let loading: Promise<void> | null = null;

/** أخطاء وقعت قبل جهوز الحزمة — تُفرَغ عند الجهوز. */
const pending: Array<{ err: unknown; context?: Record<string, unknown> }> = [];
const PENDING_MAX = 20;

/** يُفرغ ما تكدّس قبل الجهوز. */
function flushPending(): void {
    if (!sentry || !enabled) { pending.length = 0; return; }
    for (const p of pending.splice(0, pending.length)) {
        try {
            sentry.captureException(p.err, p.context ? { extra: p.context } : undefined);
        } catch { /* لا يُعطّل المراقبةُ التطبيقَ أبداً */ }
    }
}

/** يجلب الحزمة ويُهيّئها مرّةً واحدة. */
function load(): Promise<void> {
    if (loading) return loading;
    loading = import('@sentry/react')
        .then((mod) => {
            mod.init({
                dsn: DSN,
                environment: process.env.NODE_ENV || 'production',
                tracesSampleRate: 0.1,
                // Scrub obvious PII from any captured request/headers before sending.
                sendDefaultPii: false,
                integrations: [
                    // Session Replay — a privacy-safe "video" of what the user did
                    // right before an error. maskAllText + blockAllMedia ensure names,
                    // phones, prices and images are NEVER recorded — only the layout
                    // and the actions (taps/navigation) are. (v11.52)
                    mod.replayIntegration({ maskAllText: true, blockAllMedia: true }),
                ],
                // Capture 100% of sessions that hit an error (the ones worth watching)
                // + a light 10% sample of normal sessions for context.
                replaysOnErrorSampleRate: 1.0,
                replaysSessionSampleRate: 0.1,
            });
            sentry = mod;
            enabled = true;
            flushPending();
        })
        .catch(() => {
            // شبكة أو حجبٌ — المراقبة تسقط وحدها ولا تُسقط شيئاً معها.
            pending.length = 0;
        });
    return loading;
}

/**
 * يبدأ التحميل **بعد** أوّل رسم وعند خمول المتصفّح، فلا ينافس ظهور المحتوى.
 * وبلا DSN لا يُحمَّل شيء إطلاقاً.
 */
export function initSentry(): void {
    if (!DSN || loading) return;
    const start = () => { void load(); };
    try {
        const ric = (window as unknown as {
            requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void;
        }).requestIdleCallback;
        // 🪤 سفاري لا يعرف `requestIdleCallback` حتى اليوم — وهو متصفّح أكثر
        //    مستخدمينا. الارتداد إلى مؤقّت لازمٌ لا تجميل.
        if (typeof ric === 'function') ric(start, { timeout: 5000 });
        else setTimeout(start, 2000);
    } catch {
        setTimeout(start, 2000);
    }
}

export function captureError(err: unknown, context?: Record<string, unknown>): void {
    if (!DSN) return;                       // المراقبة مطفأة أصلاً
    try {
        if (sentry && enabled) {
            sentry.captureException(err, context ? { extra: context } : undefined);
            return;
        }
        // لم تجهز بعد: يُكدَّس ويُستعجل التحميل — فخطأ الإقلاع لا يضيع.
        if (pending.length < PENDING_MAX) pending.push({ err, context });
        void load();
    } catch {
        /* ignore */
    }
}

export const sentryEnabled = (): boolean => enabled;
