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
                // ═══════════════════════════════════════════════════════════
                // 🔴 **أُسقط تسجيلُ الجلسات (Session Replay) في v15.59** —
                //    بقياسٍ لا برأي:
                //      • حزمةُ المراقبة كانت **٤٢٥ ك.ب**، أكثرُها
                //        `@sentry-internal/rrweb` (مسجّلُ الجلسات).
                //      • ومحلّلُ المعالج على جوّالٍ متوسّطٍ مخنوق: **٧٢٩ م.ث**
                //        من الخيط الرئيسيّ على الرئيسية، و**٥٨٥** على «حولي» —
                //        وتقع **بعد أوّل رسم**، أي في اللحظة التي يبدأ فيها
                //        المستخدمُ بالتمرير والنقر. وهذا بعينه «التطبيق ثقيل».
                //      • والمقابل: تسجيلُ ١٠٪ من الجلسات. أي أن **كلّ** زائرٍ
                //        يدفع ٤٢٥ ك.ب من باقته ليُسجَّل واحدٌ من عشرة.
                //    ومراقبةُ الأخطاء — وهي الفائدةُ الحقيقيّة — باقيةٌ كاملةً.
                // 🪤 ولا يكفي ضبطُ المعدّل صفراً: الحزمةُ تُحمَّل بمجرّد **ذكر**
                //    `replayIntegration`؛ وحذفُ النداء هو ما يسمح بهزّ الشجرة
                //    فيخرج `rrweb` من الحزمة أصلاً. (قِيس الفرقُ بعد الحذف.)
                // ═══════════════════════════════════════════════════════════
                integrations: [],
            });
            sentry = mod;
            enabled = true;
            // 🪤 وتُفكّ مِقراضاتُنا هنا: الحزمةُ تُركّب مِقراضَيها، وبقاءُ
            //    الاثنين يُبلّغ كلَّ خطأٍ **مرّتين** فيُفسد العدّ والتنبيه.
            try { detachGuards?.(); } catch { /* ignore */ }
            flushPending();
        })
        .catch(() => {
            // شبكة أو حجبٌ — المراقبة تسقط وحدها ولا تُسقط شيئاً معها.
            pending.length = 0;
        });
    return loading;
}

/** يُزيل المِقراضَين الخفيفين بعد أن تتولّى الحزمةُ المهمّة بنفسها. */
let detachGuards: (() => void) | null = null;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 **لا تُحمَّل حزمةُ المراقبة إلا إذا وقع خطأٌ فعلاً** (v15.59).
 *
 * كانت تُحمَّل عند خمول المتصفّح بعد أوّل رسم — أي **لكلّ زائر**. وقِيس:
 *   • حجمُها **٤١٦ ك.ب** (أكثرُها `rrweb` مسجّلُ الجلسات).
 *   • ومحلّلُ المعالج على جوّالٍ متوسّطٍ مخنوق: **٧٢٩ م.ث** من الخيط
 *     الرئيسيّ على الرئيسية — وتقع **بعد** أوّل رسم، أي في اللحظة التي
 *     يبدأ فيها المستخدمُ بالتمرير والنقر. وذاك بعينه «التطبيق ثقيل».
 * 🪤 وحذفُ `replayIntegration` وحدَه **لم يُخرج** rrweb: `@sentry/browser`
 *    يعتمد على `@sentry-internal/replay` اعتماداً صلباً، فلا يهزّه هزُّ
 *    الشجرة. (جُرّب وقِيس: ٤٢٥ ⇐ ٤١٦ ك.ب فقط.) فالرافعةُ الوحيدة الباقية
 *    هي **ألّا تُحمَّل أصلاً** في الجلسة التي لا خطأ فيها — وهي ٩٩٪ منها.
 *
 * وحتى لا تضيع تغطيةُ الأخطاء: يُركَّب هنا مِقراضان **خفيفان جداً** (بضعةُ
 * أسطرٍ بلا أيّ حزمة) يلتقطان الخطأ غيرَ الملتقط ورفضَ الوعد، فيُكدّسانه
 * ويُطلقان التحميل. وبعد جهوز الحزمة تُركّب هي مِقراضَيها فيُفكّ مِقراضانا
 * منعاً للتكرار.
 * 🪤 والثمنُ المعلَن: **أوّلُ** خطأٍ في الجلسة يصل بلا «فتات المسار»
 *    (breadcrumbs) لأن الحزمةَ لم تكن تُسجّله. وما بعده كاملُ السياق.
 *    وهذا أرخصُ بكثيرٍ من ٤١٦ ك.ب و٧٢٩ م.ث على كلّ جهازٍ في المملكة.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function initSentry(): void {
    if (!DSN || loading || detachGuards) return;

    const onError = (e: ErrorEvent) => {
        captureError(e.error instanceof Error ? e.error : new Error(e.message || 'error'),
                     { src: e.filename, line: e.lineno });
    };
    const onRejection = (e: PromiseRejectionEvent) => {
        const r = e.reason;
        captureError(r instanceof Error ? r : new Error(String(r)), { kind: 'unhandledrejection' });
    };

    try {
        window.addEventListener('error', onError);
        window.addEventListener('unhandledrejection', onRejection);
        detachGuards = () => {
            window.removeEventListener('error', onError);
            window.removeEventListener('unhandledrejection', onRejection);
            detachGuards = null;
        };
    } catch { /* بيئةٌ بلا window — لا شيء */ }
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
