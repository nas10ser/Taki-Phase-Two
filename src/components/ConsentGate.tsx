import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../services/supabaseClient';
import { LEGAL_VERSION } from '../data/legalVersion';
import { authService, MIN_AGE, CONSENT_EVENT, consentRecordedFor } from '../services/authService';
import { isPasswordRecovery } from '../utils/passwordRecovery';

/**
 * ConsentGate — السؤالُ الوحيد الذي يستطيع النظامُ أن يجيبه دائماً (v15.80)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 العيبُ المقيس: الموافقةَ كانت تُسجّلها **الشاشةُ** التي تُنشئ الحساب لا
 *    النظامُ الذي يملكه. وموضعُ ميلادِ صفِّ `users` واحدٌ (`handle_new_user`،
 *    ولا يمسّ الموافقةَ)، بينما ثلاثُ شاشاتٍ كلٌّ منها مسؤولةٌ عن أن
 *    «تتذكّر»: البريدُ تذكّر، وتيليجرام تذكّر، و**مسارُ OAuth لم يتذكّر قطّ**
 *    وشاشةُ «أكمل بياناتك» التي يُمرّ بها كلُّ قادمٍ منه بلا كودِ موافقةٍ
 *    أصلاً. والنتيجةُ على جدة في ٨ نوفمبر ٢٠٢٦: صفرٌ من ٦ حسابات يحمل
 *    موافقةً على الإصدار الحاليّ، وصفرٌ يحمل إقرارَ السنّ، وصفرٌ يحمل
 *    العنوانَ — وثلاثُ وثائقَ تَعِد بالثلاثة.
 *
 * فلا تُسأل الشاشاتُ أن تتذكّر. يُسأل سؤالٌ واحدٌ في موضعٍ واحد: «هذه الجلسةُ
 * موثَّقةٌ ولا تحمل موافقةً على `LEGAL_VERSION` الحاليّ؟» — سؤالٌ لا يَعرف
 * مزوّداً ولا شاشةً، فيغطّي البريدَ وتيليجرام وقوقل وأبل وأيَّ مسارٍ قادم.
 *
 * 🪤 ولا يُعاد استعمالُ `LocationGate`: ذاك **قابلٌ للإغلاق بالتصميم**
 *    (`onClose` + زرُّ «لاحقاً»)، والموافقةُ لا تُؤجَّل. وهذا الهيكلُ مأخوذٌ
 *    منه شكلاً فقط، وسلوكُه من اتفاقيّةِ بوّابةِ التاجر
 *    (`components/seller/GatewayCard.tsx`): مربّعٌ واحدٌ ثمّ كتابةٌ **تُقرأ
 *    بعدها** ثمّ متابعة.
 *
 * 🪤 ولا يحجبُ أربعةَ أشياء — وكلُّها مقيسةٌ من الكود لا مفترضة:
 *    ① زائرٌ بلا حساب: `!user` (ولا شيءَ يُطلب ممّن لا حساب له).
 *    ② مسارُ استعادةِ كلمة المرور: نفسُ أوّلِ حارسٍ في `AuthRedirector`
 *       (`src/App.tsx:177`) — رمزُ الاستعادة يُنشئ جلسةً، وأيُّ شيءٍ يعلو
 *       شاشةَ تعيينِ الكلمة يمنع المستخدمَ من حفظها (ثمنُ v14.03/14.04).
 *    ③ «المعاينةُ كمستخدم» (`impersonating`): أدمنٌ لا يُوقّع توقيعاً مُلزماً
 *       عن غيره أبداً — نفسُ الخروج المبكّر في `src/App.tsx:183`.
 *    ④ ومفتاحُ الإطفاء `consent_gate_enabled` إن أطفأه المالك.
 *    ولا إعفاءَ للأدمن: الشروط §٢ تُلزم كلَّ مستخدم، وإعفاءُ دورٍ بابٌ خلفيّ.
 *    مخرجُ المالك هو المفتاحُ أعلاه، وهو محميٌّ له وحده في القاعدة.
 *
 * 🪤 وفشلُ الشبكة **لا يحجب**: قراءةٌ فاشلةٌ تُعاد بتباطؤٍ ولا تُقفل التطبيقَ
 *    على تاجرٍ يبيع. أمّا قراءةٌ **ناجحةٌ** بصفر صفوفٍ فتحجب (صفٌّ غائبٌ
 *    يعني حساباً بلا سجلّ).
 */

const BRAND = '#10b981';

const ConsentGate: React.FC = () => {
    const { user, isAuthReady, impersonating, language, logout } = useApp();
    const isRTL = language === 'ar';
    const t = useCallback((ar: string, en: string) => (isRTL ? ar : en), [isRTL]);

    const [needed, setNeeded] = useState(false);
    const [checked, setChecked] = useState(false);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState('');
    // مرجعٌ لا حالة: يُستعمل داخل مؤقّتاتِ إعادةِ المحاولة فلا يُعيد التركيب.
    const triesRef = useRef(0);

    const uid = user?.id;
    const muted = !isAuthReady || !uid || !!impersonating || isPasswordRecovery();

    useEffect(() => {
        if (muted) { setNeeded(false); return; }

        let dead = false;
        let timer: ReturnType<typeof setTimeout>;

        const run = async () => {
            if (dead) return;
            // وافق للتوّ من شاشة التسجيل؟ لا دورةَ شبكةٍ ولا وميضَ بوّابة:
            // الكتابةُ هناك مُثبَتةٌ بقراءةٍ بعدها، فهذا الوسمُ يقينٌ لا تخمين.
            if (consentRecordedFor(LEGAL_VERSION)) { setNeeded(false); return; }

            const { data, error } = await supabase
                .from('users')
                .select('consent_terms_version, consent_age_confirmed')
                .eq('id', uid)
                .maybeSingle();
            if (dead) return;

            if (error) {
                // 🪤 لا تُقفل التطبيقَ على خطأِ شبكة — أعِد المحاولةَ بتباطؤ.
                triesRef.current += 1;
                if (triesRef.current <= 4) {
                    timer = setTimeout(run, 1500 * triesRef.current);
                }
                return;
            }

            const ok = !!data
                && data.consent_terms_version === LEGAL_VERSION
                && data.consent_age_confirmed === true;
            if (ok) { setNeeded(false); return; }

            // مفتاحُ الإطفاء — يُسأل فقط حين تكون البوّابةُ على وشك الظهور،
            // فلا يدفع كلُّ زائرٍ دورةَ شبكةٍ لا تعنيه.
            const { data: ks, error: ksErr } = await supabase
                .from('platform_settings')
                .select('value')
                .eq('key', 'consent_gate_enabled')
                .maybeSingle();
            if (dead) return;
            // 🪤 وافتراضُه **مُشغَّل** (`!== false`) — عكسُ قاعدةِ v15.25
            //    عمداً وبسببٍ: فشلُ ميزةٍ تجاريّةٍ مغلقاً هو الآمن، أمّا بوّابةٌ
            //    قانونيّةٌ فالآمنُ أن تبقى قائمة. وغيابُ الصفّ (قائمةُ سماحٍ
            //    نُسيت ⇒ صفرُ صفوفٍ بلا خطأ) يسقط في الاتّجاه الآمن كذلك.
            //    ولا يُقفَل أحد: القبولُ متاحٌ أمامه في نفس الشاشة.
            const off = !ksErr && ks && (ks as { value: unknown }).value === false;
            setNeeded(!off);
        };

        run();
        // وشاشةُ التسجيل تُبلّغ بعد كتابةٍ مُثبَتة، فتُسحب البوّابةُ فوراً.
        const onRecorded = () => { if (consentRecordedFor(LEGAL_VERSION)) setNeeded(false); };
        window.addEventListener(CONSENT_EVENT, onRecorded);
        return () => { dead = true; clearTimeout(timer); window.removeEventListener(CONSENT_EVENT, onRecorded); };
    }, [muted, uid]);

    // منعُ تمريرِ الصفحةِ تحت الطبقة ما دامت قائمة.
    useEffect(() => {
        if (!needed) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [needed]);

    const accept = async () => {
        if (!checked || saving) return;
        setSaving(true);
        setErr('');
        const r = await authService.recordConsent(LEGAL_VERSION);
        setSaving(false);
        if (r.ok) { setNeeded(false); return; }
        // 🔴 ولا «أطلقها وانسَها»: الكتابةُ تُقرأ بعدها، وفشلُها يُقال.
        //    والبوّابةُ نفسُها هي التعافي — تعود عند الفتحة القادمة.
        setErr(r.reason === 'AUTH_REQUIRED'
            ? t('انتهت جلستك. سجّل الدخول مرّةً أخرى ثمّ وافق.',
                'Your session expired. Please sign in again, then accept.')
            : t('تعذّر حفظ موافقتك. تحقّق من اتّصالك وحاول مرّةً أخرى.',
                'We could not save your consent. Check your connection and try again.'));
    };

    if (!needed) return null;

    const link = (href: string, label: string) => (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#38bdf8', fontWeight: 800, textDecoration: 'underline', textUnderlineOffset: 2 }}
        >
            {label}
        </a>
    );

    return (
        <div
            dir={isRTL ? 'rtl' : 'ltr'}
            role="dialog"
            aria-modal="true"
            style={{
                position: 'fixed', inset: 0, zIndex: 100002,
                background: 'rgba(3, 7, 18, 0.82)', backdropFilter: 'blur(6px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 16, overflowY: 'auto',
                fontFamily: 'Tajawal, system-ui, -apple-system, sans-serif',
            }}
        >
            <div style={{
                background: 'linear-gradient(160deg, #0a1628 0%, #0f1f3a 60%, #081020 100%)',
                color: '#e2e8f0', borderRadius: 24, width: '100%', maxWidth: 440,
                border: '1px solid rgba(148, 163, 184, 0.22)',
                boxShadow: '0 24px 60px rgba(0,0,0,0.5)', overflow: 'hidden',
            }}>
                <div style={{ padding: '24px 22px 18px', textAlign: 'center' }}>
                    <div style={{ fontSize: '2.4rem', marginBottom: 8 }}>⚖️</div>
                    <div style={{ fontSize: '1.14rem', fontWeight: 900, color: '#fff' }}>
                        {t('خطوةٌ واحدة قبل المتابعة', 'One step before you continue')}
                    </div>
                    <div style={{ fontSize: '0.84rem', fontWeight: 600, opacity: 0.8, marginTop: 8, lineHeight: 1.7 }}>
                        {t('نحتاج موافقتك على وثائقنا القانونية بإصدارها الحالي. لن نسألك مرّةً أخرى إلا إذا تغيّرت الوثائق.',
                           'We need your agreement to the current version of our legal documents. We will not ask again unless they change.')}
                    </div>
                </div>

                <div style={{ padding: '0 20px 20px' }}>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
                        <span
                            onClick={(e) => { e.preventDefault(); setChecked(v => !v); }}
                            style={{
                                flexShrink: 0, marginTop: 2, width: 22, height: 22, borderRadius: 6,
                                border: `2px solid ${checked ? BRAND : 'rgba(148, 163, 184, 0.6)'}`,
                                background: checked ? BRAND : 'transparent',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: '#fff', fontSize: 14, fontWeight: 900, transition: 'all 0.2s',
                            }}
                        >
                            {checked ? '✓' : ''}
                        </span>
                        <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => setChecked(e.target.checked)}
                            style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                            aria-label={t('أقرّ بأنني قرأت ووافقت على شروط الاستخدام وسياسة الخصوصية وسياسة الاسترداد',
                                          'I acknowledge I have read and agree to the Terms, Privacy Policy, and Refund Policy')}
                        />
                        <div style={{ fontSize: '0.82rem', lineHeight: 1.7, fontWeight: 600 }}>
                            {t('أُقرّ بأنني قرأت ووافقت على', 'I have read and agree to the')}{' '}
                            {link('/terms', t('شروط الاستخدام', 'Terms of Service'))}
                            {' '}{t('و', 'and the')}{' '}
                            {link('/privacy', t('سياسة الخصوصية', 'Privacy Policy'))}
                            {' '}{t('و', 'and the')}{' '}
                            {link('/refund', t('سياسة الاسترداد', 'Refund Policy'))}
                            {t(`، وأُقرّ بأنني أتممتُ ${MIN_AGE} عاماً، وأتعهّد بتحمّل المسؤولية الكاملة عن أي محتوى أنشره أو معاملة أُجريها على TAKI.`,
                               `, I confirm I am at least ${MIN_AGE} years old, and I take full responsibility for any content I publish or transactions I make on TAKI.`)}
                        </div>
                    </label>

                    <div style={{
                        marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(148, 163, 184, 0.15)',
                        fontSize: '0.74rem', color: 'rgba(180, 195, 220, 0.72)', lineHeight: 1.6, fontWeight: 500,
                    }}>
                        {t(
                            `⚖️ موافقتك توقيع إلكتروني ملزم وفقاً لنظام التعاملات الإلكترونية السعودي (المادة 7). يُسجَّل تاريخ الموافقة ووقتها وإصدار الوثائق (${LEGAL_VERSION}) وعنوان الإنترنت كدليل قانوني.`,
                            `⚖️ Your consent is a legally binding electronic signature under Saudi Electronic Transactions Law (Art. 7). The date, time, document version (${LEGAL_VERSION}) and IP address are logged as legal evidence.`
                        )}
                    </div>

                    {err && (
                        <div style={{
                            marginTop: 12, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.28)',
                            color: '#fca5a5', borderRadius: 12, padding: '10px 12px',
                            fontSize: '0.8rem', fontWeight: 700, lineHeight: 1.6,
                        }}>{err}</div>
                    )}

                    <button
                        onClick={accept}
                        disabled={!checked || saving}
                        style={{
                            width: '100%', padding: 16, borderRadius: 16, border: 'none', marginTop: 16,
                            background: (!checked || saving) ? 'rgba(15,23,42,0.5)' : BRAND,
                            color: '#fff', fontWeight: 900, fontSize: '1rem',
                            cursor: (!checked || saving) ? 'not-allowed' : 'pointer',
                            opacity: (!checked || saving) ? 0.55 : 1, transition: 'all 0.25s',
                        }}
                    >
                        {saving ? t('جاري الحفظ…', 'Saving…') : t('أوافق وأتابع', 'I agree — continue')}
                    </button>

                    {/* ولا بدّ من بديلٍ لمن لا يوافق: البوّابةُ غيرُ قابلةٍ
                        للإغلاق، فبقاءُ المستخدمِ بلا مخرجٍ إلزامٌ لا موافقة.
                        والخروجُ ليس إغلاقاً للبوّابة — هو الاختيارُ الآخر. */}
                    <button
                        onClick={() => { logout(); }}
                        style={{
                            width: '100%', padding: 10, marginTop: 10, background: 'none', border: 'none',
                            color: 'rgba(180, 195, 220, 0.75)', fontWeight: 700, fontSize: '0.78rem',
                            cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit',
                        }}
                    >
                        {t('لا أوافق — تسجيل الخروج', 'I do not agree — sign out')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConsentGate;
