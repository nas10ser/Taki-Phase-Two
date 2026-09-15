import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Cloudflare Turnstile — the bot check in front of registration.
 *
 * The site key is public by design: it only says "this widget belongs to TAKI",
 * and Cloudflare refuses it on any hostname not listed in the widget's config.
 * The half that actually proves anything is the SECRET key, which never comes
 * near the browser — it lives in the auth server (Supabase today, GoTrue on our
 * own box after the Oracle move) and is what verifies the token server-side.
 *
 * Ordering matters here: this widget goes live BEFORE the server starts
 * demanding a token. A token nobody checks is harmless; a server demanding a
 * token no page produces locks everybody out of signing up. So the client ships
 * first, the server switch flips second.
 *
 * ── v14.46 — الفشل الصامت (بلاغ ناصر بلقطة ٢ سبتمبر) ──────────────────────
 * قِيس على الإنتاج في ١٥ سبتمبر بمتصفّح حقيقي على `www.takisa.net`: الودجت
 * **يعمل** ويُصدر رمزاً — وهو مضبوط في Cloudflare على النمط **غير المرئي**،
 * فصندوقه يبقى فارغاً في الحالة السليمة. هذا هو سبب «الفراغ» الذي يراه الناظر.
 *
 * 🪤 ولذلك بالضبط كان الفشل كارثيَّ العرض: حين تتعذّر Cloudflare (شبكة، حجب،
 * انقطاع) لا يظهر **أي شيء** — لا رسالة ولا زرّ — ويكتشف المستخدم الرفض فقط
 * بعد أن يملأ النموذج ويضغط «إرسال»، فيقرأ «تعذّر التحقق من أنك لست روبوتاً»
 * بلا أن يعرف ما الذي يفعله. والكابتشا صارت مفروضة على الخادم منذ ٣ سبتمبر
 * (`GOTRUE_SECURITY_CAPTCHA_ENABLED=true`)، فالرمز لم يعد تحسيناً.
 *
 * فالآن: الفشل يقول اسمه في مكانه، ومعه زرّ إعادة محاولة يُعيد بناء الودجت.
 */
const SITE_KEY = process.env.TURNSTILE_SITE_KEY || '0x4AAAAAAEHE5xdLn_Bn5wIN';
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

declare global {
    interface Window {
        turnstile?: {
            render: (el: HTMLElement, opts: Record<string, unknown>) => string;
            remove: (id: string) => void;
            reset: (id?: string) => void;
        };
    }
}

let scriptPromise: Promise<void> | null = null;

/** Load the Cloudflare script once per page, no matter how many widgets mount. */
const loadScript = (): Promise<void> => {
    if (window.turnstile) return Promise.resolve();
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = SCRIPT_URL;
        s.async = true;
        s.defer = true;
        s.onload = () => resolve();
        s.onerror = () => { scriptPromise = null; reject(new Error('turnstile script failed')); };
        document.head.appendChild(s);
    });
    return scriptPromise;
};

interface Props {
    /** Fires with a fresh token, or with '' when it expires and must be redone. */
    onToken: (token: string) => void;
    isRTL?: boolean;
    /**
     * v13.96 — عدّاد يزيده الأب بعد كل محاولة فاشلة فيُطلب رمز جديد.
     *
     * 🔴 رمز Turnstile **يُستهلك مرة واحدة**: بعد أول إرسال ترفضه Cloudflare
     * بـ`timeout-or-duplicate`. فبدون هذا، محاولة دخول ثانية بعد كلمة مرور
     * خاطئة تفشل بخطأ «كابتشا» مضلّل — والمستخدم يظنّ الموقع معطّلاً.
     */
    resetSignal?: number;
}

const TurnstileWidget: React.FC<Props> = ({ onToken, isRTL = true, resetSignal = 0 }) => {
    const holder = useRef<HTMLDivElement | null>(null);
    const widgetId = useRef<string | null>(null);
    // Keep the latest callback without re-rendering the widget on every parent
    // render — re-rendering it would wipe a token the user already solved for.
    const cb = useRef(onToken);
    cb.current = onToken;

    /** 'pending' حتى يصل رمز أو يقع خطأ — لا نُخيف المستخدم أثناء الانتظار. */
    const [failed, setFailed] = useState(false);
    /** v14.46 — زيادته تُعيد بناء الودجت من الصفر بعد فشل. */
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;

        loadScript()
            .then(() => {
                if (cancelled || !holder.current || !window.turnstile) return;
                widgetId.current = window.turnstile.render(holder.current, {
                    sitekey: SITE_KEY,
                    language: isRTL ? 'ar' : 'en',
                    callback: (token: string) => { if (!cancelled) setFailed(false); cb.current(token); },
                    'expired-callback': () => cb.current(''),
                    // انتهاء الصلاحية ليس عطلاً: Cloudflare تُجدّد وحدها. أمّا
                    // `error-callback` فهو تعذُّرٌ فعليّ يستحق أن يُرى.
                    'error-callback': () => { if (!cancelled) setFailed(true); cb.current(''); },
                });
            })
            .catch(() => {
                // Cloudflare unreachable (offline, blocked). نقولها في مكانها بدل
                // أن نترك فراغاً يكتشفه المستخدم عند الإرسال وحده.
                if (!cancelled) { setFailed(true); cb.current(''); }
            });

        return () => {
            cancelled = true;
            if (widgetId.current && window.turnstile) {
                try { window.turnstile.remove(widgetId.current); } catch { /* already gone */ }
                widgetId.current = null;
            }
        };
        // يُعاد البناء عند ضغط «أعد المحاولة» وحده. isRTL only picks the widget's
        // language at creation time.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [attempt]);

    // إعادة التحدّي بعد محاولة فاشلة — نتخطّى أول تشغيل حتى لا نمسح رمزاً
    // حلّه المستخدم للتوّ قبل أن يُرسله.
    const firstRun = useRef(true);
    useEffect(() => {
        if (firstRun.current) { firstRun.current = false; return; }
        if (!widgetId.current || !window.turnstile) return;
        cb.current('');
        try { window.turnstile.reset(widgetId.current); } catch { /* الودجت اختفى */ }
    }, [resetSignal]);

    const retry = useCallback(() => {
        setFailed(false);
        setAttempt(n => n + 1);
    }, []);

    return (
        <div className="flex justify-center my-3" style={{ flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div ref={holder} />
            {failed && (
                <div
                    role="alert"
                    style={{
                        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                        justifyContent: 'center', padding: '9px 14px', borderRadius: 12,
                        border: '1px solid rgba(245,158,11,0.45)', background: 'rgba(245,158,11,0.10)',
                        fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)',
                        textAlign: 'center',
                    }}
                >
                    <span>
                        {isRTL
                            ? '⚠️ تعذّر التحقّق من أنك لست روبوتاً — تحقّق من اتصالك ثم أعد المحاولة.'
                            : '⚠️ The human check could not load — check your connection and retry.'}
                    </span>
                    <button
                        type="button"
                        onClick={retry}
                        style={{
                            padding: '6px 14px', borderRadius: 9, border: 'none', cursor: 'pointer',
                            background: '#b45309', color: '#fff', fontWeight: 900, fontSize: '0.72rem',
                            fontFamily: 'inherit',
                        }}
                    >
                        {isRTL ? '↻ أعد المحاولة' : '↻ Retry'}
                    </button>
                </div>
            )}
        </div>
    );
};

export default TurnstileWidget;
