/**
 * AccountSettingsCard — تعديل الاسم / الجوال / الإيميل / كلمة السر.
 *
 * v13.77 — أُعيدت كتابة طبقة الأمان بعد جرد كشف أربع ثغرات حقيقية في نسخة
 * v11.19. القاعدة المتّبعة في المنصّات الجادّة: **أي تغيير يمسّ هوية الدخول
 * (جوال · إيميل · كلمة سر) يتطلّب إعادة مصادقة بكلمة السر الحالية**، ولا يُكتب
 * أي مُعرِّف في قاعدتنا قبل أن يؤكّده صاحبه.
 *
 * الثغرات التي سُدّت:
 *
 *  ١) 🔴 تغيير كلمة السر بلا تحقّق لحسابات الجوال. كان الشرط:
 *        if (user.email) { …signInWithPassword… }
 *     وتاكي منصّة **جوال أولاً**؛ كثير من الحسابات لا يحمل ملفها إيميلاً، فكان
 *     الشرط يسقط و**تُغيَّر كلمة السر بلا أي تحقّق**. أي جلسة مسروقة (جهاز
 *     مفتوح، توكن مسرّب) تتحوّل إلى استيلاء دائم على الحساب — وهو عين ما كتب
 *     التعليق أنه يمنعه. الآن نقرأ بريد المصادقة من **الجلسة الحيّة** لا من
 *     الملف الشخصي (كل حساب في GoTrue له بريد ولو لم يظهر في ملفه)، وإن تعذّر
 *     نرفض التغيير — **الفشل مُغلق لا مفتوح**.
 *
 *  ٢) 🔴 الإيميل غير المؤكَّد كان يُكتب في جدول `users` فوراً. نتيجتان: من لم
 *     يضغط رابط التأكيد يصير جدولنا يقول بريداً وGoTrue يقول آخر فينكسر الدخول
 *     بالإيميل؛ ومن سرق جلسةً يكتب بريده هو في ملف الضحية بلا تأكيد. الآن
 *     المصدر الوحيد للحقيقة هو `auth.users` بعد التأكيد، ومشغّل
 *     `on_auth_user_updated` (v13.76) يُنزل القيمة المؤكَّدة إلى جدولنا وحده.
 *
 *  ٣) الجوال والإيميل كانا يُغيَّران بلا إعادة مصادقة — والجوال هو **مُعرِّف
 *     الدخول** في تاكي (`find_email_by_phone`)، فتغييره من جلسة مسروقة يحوّل
 *     الدخول للمهاجم. صارا يتطلّبان كلمة السر الحالية.
 *
 *  ٤) بعد تغيير كلمة السر لم تكن الجلسات الأخرى تُنهى — فمن سرق الجلسة يبقى
 *     داخلاً رغم تغيير الضحية لكلمتها. الآن تُنهى كل الجلسات الأخرى فوراً.
 *
 * وأُضيف: حدّ لمحاولات كلمة السر الخاطئة (تهدئة محلية فوق حدّ GoTrue)، وقياس
 * قوة كلمة السر، ورسالة عربية واضحة حين يكون الجوال مسجّلاً لحساب آخر (قيد
 * `users_phone_key` كان يعيد خطأ بوستجرس خاماً).
 */
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../services/supabaseClient';
import { normalizeArabicNumerals } from '../utils/helpers';
import TurnstileWidget from './TurnstileWidget';
import PasswordField, { pwIsStrong, pwChecks } from './PasswordField';

type Section = 'name' | 'phone' | 'email' | 'password' | null;

/** أقصى محاولات خاطئة لكلمة السر الحالية قبل تهدئة إجبارية. */
const MAX_REAUTH_TRIES = 5;
const COOLDOWN_MS = 60_000;

const AccountSettingsCard: React.FC = () => {
    const { user, language, updateProfile, customAlert } = useApp();
    const isRTL = language === 'ar';
    const [open, setOpen] = useState<Section>(null);
    const [busy, setBusy] = useState(false);

    const [name, setName] = useState(user?.name || '');
    const [shop, setShop] = useState(user?.shop || '');
    const [phone, setPhone] = useState(user?.phone || '');
    const [email, setEmail] = useState(user?.email || '');
    const [currentPw, setCurrentPw] = useState('');
    // v13.99 — إعادة المصادقة تنادي signInWithPassword أي المسار /token، وهو
    // **محروس بالكابتشا** منذ v13.98. بدون رمز يفشل تغيير الجوال والإيميل
    // وكلمة السر جميعاً بخطأ «no captcha_token found». الرمز يُستهلك مرة
    // واحدة، فنجدّد التحدّي بعد كل محاولة.
    const [captchaToken, setCaptchaToken] = useState('');
    const [captchaNonce, setCaptchaNonce] = useState(0);
    const renewCaptcha = () => { setCaptchaToken(''); setCaptchaNonce(n => n + 1); };
    const [newPw, setNewPw] = useState('');
    const [confirmPw, setConfirmPw] = useState('');

    // تهدئة محلية: تمنع تجربة كلمات سر بالتسلسل من داخل الصفحة.
    const [failedTries, setFailedTries] = useState(0);
    const [cooldownUntil, setCooldownUntil] = useState(0);

    if (!user) return null;

    const close = () => {
        setOpen(null);
        setCurrentPw(''); setNewPw(''); setConfirmPw(''); renewCaptcha();
    };

    /**
     * إعادة المصادقة — البوابة الوحيدة لكل تغيير يمسّ هوية الدخول.
     *
     * تقرأ بريد المصادقة من **الجلسة الحيّة** لا من الملف الشخصي: حسابات
     * الجوال في تاكي تدخل عبر `find_email_by_phone` فلها بريد في GoTrue ولو
     * كان حقل `email` في ملفها فارغاً. الاعتماد على الملف هو ما فتح الثغرة (١).
     *
     * ترمي عند الفشل — فلا يمكن لمسار استدعاء أن «ينسى» فحص النتيجة.
     */
    const reauthenticate = async (password: string): Promise<void> => {
        if (Date.now() < cooldownUntil) {
            const secs = Math.ceil((cooldownUntil - Date.now()) / 1000);
            throw new Error(isRTL
                ? `محاولات كثيرة خاطئة — انتظر ${secs} ثانية ثم أعد المحاولة.`
                : `Too many failed attempts — wait ${secs}s and try again.`);
        }
        if (!password) {
            throw new Error(isRTL ? 'أدخل كلمة السر الحالية للتحقق.' : 'Enter your current password.');
        }

        const { data, error: sessErr } = await supabase.auth.getUser();
        const authEmail = data?.user?.email;
        if (sessErr || !authEmail) {
            // فشل مُغلق: لا نُكمل بلا تحقّق مهما كان السبب.
            throw new Error(isRTL
                ? 'تعذّر التحقّق من جلستك. سجّل خروجاً ثم دخولاً وأعد المحاولة.'
                : 'Could not verify your session. Sign out, sign in again, and retry.');
        }

        const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password, options: captchaToken ? { captchaToken } : undefined } as any);
        if (error) {
            const tries = failedTries + 1;
            setFailedTries(tries);
            if (tries >= MAX_REAUTH_TRIES) {
                setCooldownUntil(Date.now() + COOLDOWN_MS);
                setFailedTries(0);
            }
            throw new Error(isRTL ? 'كلمة السر الحالية غير صحيحة.' : 'Current password is incorrect.');
        }
        setFailedTries(0);
    };

    /** رسالة عربية مفهومة بدل خطأ بوستجرس الخام. */
    const humanError = (e: any): string => {
        const raw = String(e?.message || e || '');
        if (/users_phone_key|duplicate key|unique constraint/i.test(raw)) {
            return isRTL ? 'رقم الجوال مسجَّل لحساب آخر.' : 'This phone number belongs to another account.';
        }
        if (/already registered|already been registered|email_exists/i.test(raw)) {
            return isRTL ? 'هذا البريد مسجَّل لحساب آخر.' : 'This email belongs to another account.';
        }
        if (/rate limit|too many/i.test(raw)) {
            return isRTL ? 'محاولات كثيرة — أعد المحاولة بعد قليل.' : 'Too many attempts — try again shortly.';
        }
        // v14.01 — الخادم يرفض بـweak_password لسببين مختلفين تماماً، ولا يُفرّق
        // بينهما في رمز الخطأ: (أ) الشروط الخمسة، (ب) ورودها في تسريبات معروفة.
        // نميّزهما من نصّ الرسالة لأن العلاج مختلف: الأولى تُصلَح بالتعديل،
        // والثانية تحتاج كلمة أخرى تماماً مهما بلغت قوّتها الظاهرة.
        if (/known to be weak|pwned|breach|easy to guess/i.test(raw)) {
            return isRTL
                ? '🔓 كلمة السر هذه ظهرت في تسريبات معروفة على الإنترنت. اختر واحدة أخرى.'
                : '🔓 This password appeared in known data breaches. Choose a different one.';
        }
        if (/at least one character of each|should be at least/i.test(raw)) {
            return isRTL
                ? 'كلمة السر لا تستوفي الشروط الخمسة — راجع القائمة أسفل الحقل.'
                : 'The password misses one of the five requirements — see the checklist below the field.';
        }
        if (/captcha/i.test(raw)) {
            return isRTL
                ? '🤖 انتهت صلاحية التحقّق من أنك لست روبوتاً. انتظر علامة الصح ثم أعد المحاولة.'
                : '🤖 The human check expired. Wait for the green tick, then try again.';
        }
        return raw;
    };

    const saveName = async () => {
        if (busy) return;
        // A: control chars are stripped via escape sequences, never raw bytes.
        // A raw byte turns the file binary in git and breaks grep and review.
        const trimmed = name.replace(/[\u0000-\u001F\u007F]/g, '').trim();
        if (trimmed.length < 2 || trimmed.length > 60) {
            await customAlert(isRTL ? 'الاسم يجب أن يكون بين حرفين و٦٠ حرفاً.' : 'Name must be 2–60 characters.');
            return;
        }
        setBusy(true);
        try {
            const patch: any = { name: trimmed };
            if (user.userType === 'seller') patch.shop = shop.trim() || user.shop;
            await updateProfile(patch);
            await customAlert(isRTL ? '✅ تم حفظ الاسم' : '✅ Name saved');
            close();
        } catch (e: any) {
            renewCaptcha();
            await customAlert((isRTL ? 'فشل الحفظ: ' : 'Save failed: ') + humanError(e));
        } finally { setBusy(false); }
    };

    const savePhone = async () => {
        if (busy) return;
        const cleaned = normalizeArabicNumerals(phone).replace(/\D/g, '');
        if (!/^05\d{8}$/.test(cleaned)) {
            await customAlert(isRTL ? 'رقم الجوال يجب أن يبدأ بـ 05 ويتكون من 10 أرقام' : 'Phone must start with 05 and be 10 digits');
            return;
        }
        if (cleaned === (user.phone || '')) {
            await customAlert(isRTL ? 'هذا هو رقمك الحالي.' : 'This is already your number.');
            return;
        }
        setBusy(true);
        try {
            // الجوال مُعرِّف الدخول في تاكي — تغييره يحتاج إثبات ملكية الحساب.
            await reauthenticate(currentPw);
            await updateProfile({ phone: cleaned, contactPhone: cleaned });
            await customAlert(isRTL ? '✅ تم حفظ رقم الجوال' : '✅ Phone saved');
            close();
        } catch (e: any) {
            renewCaptcha();
            await customAlert((isRTL ? 'فشل الحفظ: ' : 'Save failed: ') + humanError(e));
        } finally { setBusy(false); }
    };

    const saveEmail = async () => {
        if (busy) return;
        const cleaned = email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
            await customAlert(isRTL ? 'بريد إلكتروني غير صالح' : 'Invalid email');
            return;
        }
        if (cleaned === (user.email || '').toLowerCase()) {
            await customAlert(isRTL ? 'هذا هو إيميلك الحالي' : 'This is already your email');
            return;
        }
        setBusy(true);
        try {
            await reauthenticate(currentPw);
            const { error } = await supabase.auth.updateUser({ email: cleaned });
            if (error) throw error;
            // ⚠️ لا نكتب البريد في جدول `users` هنا عمداً — لم يُؤكَّد بعد.
            // مشغّل `on_auth_user_updated` (v13.76) ينزله بعد التأكيد وحده.
            await customAlert(
                isRTL
                    ? `📧 أُرسل رابط تأكيد إلى ${cleaned}.\n\nلن يتغيّر بريدك في تاكي إلا بعد ضغط الرابط — وحتى ذلك الحين ادخل ببريدك القديم.`
                    : `📧 A confirmation link was sent to ${cleaned}.\n\nYour TAKI email changes only after you click it — until then, sign in with your old address.`
            );
            close();
        } catch (e: any) {
            renewCaptcha();
            await customAlert((isRTL ? 'فشل تحديث الإيميل: ' : 'Email update failed: ') + humanError(e));
        } finally { setBusy(false); }
    };

    /** قوة كلمة السر — يعيد رسالة الخطأ أو null إن كانت مقبولة. */
    const passwordProblem = (pw: string): string | null => {
        // v14.01 — الشروط الخمسة نفسها المفروضة عند التسجيل **وعلى خادم جدة**.
        // كانت هنا قاعدة أضعف (حروف + أرقام فقط)، فكان تغيير كلمة السر من
        // الإعدادات باباً خلفياً لكلمة أضعف مما يقبله التسجيل.
        if (!pwIsStrong(pw)) {
            const c = pwChecks(pw);
            const missing = [
                !c.length && (isRTL ? '٨ أحرف' : '8 characters'),
                !c.uppercase && (isRTL ? 'حرف كبير' : 'an uppercase letter'),
                !c.lowercase && (isRTL ? 'حرف صغير' : 'a lowercase letter'),
                !c.number && (isRTL ? 'رقم' : 'a number'),
                !c.special && (isRTL ? 'رمز خاص' : 'a symbol'),
            ].filter(Boolean).join(isRTL ? ' · ' : ', ');
            return (isRTL ? 'ينقصها: ' : 'Missing: ') + missing;
        }
        if (/^(.)\1+$/.test(pw)) return isRTL ? 'كلمة السر ضعيفة جداً.' : 'Password is too weak.';
        // لا تكن جوالك أو بريدك — أول ما يجرّبه المهاجم.
        const localPart = (user.email || '').split('@')[0];
        if (user.phone && pw.includes(user.phone)) {
            return isRTL ? 'لا تجعل كلمة السر رقم جوالك.' : 'Do not use your phone number as the password.';
        }
        if (localPart && localPart.length >= 4 && pw.toLowerCase().includes(localPart.toLowerCase())) {
            return isRTL ? 'لا تجعل كلمة السر جزءاً من بريدك.' : 'Do not use part of your email as the password.';
        }
        return null;
    };

    const savePassword = async () => {
        if (busy) return;
        const problem = passwordProblem(newPw);
        if (problem) { await customAlert(problem); return; }
        if (newPw !== confirmPw) {
            await customAlert(isRTL ? 'كلمتا السر غير متطابقتين' : 'Passwords do not match');
            return;
        }
        if (newPw === currentPw) {
            await customAlert(isRTL ? 'كلمة السر الجديدة مطابقة للحالية.' : 'New password matches the current one.');
            return;
        }
        setBusy(true);
        try {
            // إلزامية لكل الحسابات بلا استثناء — هذه كانت الثغرة (١).
            await reauthenticate(currentPw);

            const { error } = await supabase.auth.updateUser({ password: newPw });
            if (error) throw error;

            // إنهاء كل الجلسات الأخرى: من كان داخلاً بجلسة مسروقة يخرج فوراً،
            // وجلستك أنت على هذا الجهاز تبقى.
            let othersRevoked = true;
            try {
                const { error: soErr } = await supabase.auth.signOut({ scope: 'others' });
                if (soErr) othersRevoked = false;
            } catch { othersRevoked = false; }

            await customAlert(
                othersRevoked
                    ? (isRTL ? '✅ تم تغيير كلمة السر، وأُنهيت جلساتك على الأجهزة الأخرى.'
                             : '✅ Password changed, and your sessions on other devices were signed out.')
                    : (isRTL ? '✅ تم تغيير كلمة السر. (تعذّر إنهاء الجلسات الأخرى — سجّل خروجاً من الأجهزة الأخرى يدوياً.)'
                             : '✅ Password changed. (Could not sign out other devices — do it manually.)')
            );
            close();
        } catch (e: any) {
            renewCaptcha();
            await customAlert((isRTL ? 'فشل التغيير: ' : 'Change failed: ') + humanError(e));
        } finally { setBusy(false); }
    };

    const Row = ({ id, icon, label, value, action }: { id: Section; icon: string; label: string; value: string; action: string; }) => (
        <button
            onClick={() => { setOpen(open === id ? null : id); setCurrentPw(''); renewCaptcha(); }}
            style={{
                width: '100%',
                padding: 14,
                borderRadius: 12,
                border: '1.5px solid var(--border-color)',
                background: open === id ? 'var(--gray-100)' : 'var(--card-bg)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
                textAlign: isRTL ? 'right' : 'left',
                color: 'var(--text-primary)',
            }}
        >
            <span style={{ fontSize: '1.1rem', width: 26, textAlign: 'center' }}>{icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>{label}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 800 }}>{open === id ? '×' : action}</span>
        </button>
    );

    const inputStyle: React.CSSProperties = {
        width: '100%', padding: 12, borderRadius: 10, border: '1.5px solid var(--gray-200)',
        fontSize: '0.9rem', outline: 'none', background: 'var(--body-bg)', color: 'var(--text-primary)', fontWeight: 600
    };
    const primaryBtn: React.CSSProperties = {
        flex: 1, padding: 12, borderRadius: 12, background: 'var(--primary)', color: 'white',
        fontWeight: 900, border: 'none', fontSize: '0.95rem', cursor: 'pointer'
    };
    const ghostBtn: React.CSSProperties = {
        padding: '12px 18px', borderRadius: 12, background: 'var(--gray-100)', color: 'var(--text-secondary)',
        fontWeight: 800, border: 'none', fontSize: '0.9rem', cursor: 'pointer'
    };
    const noteStyle: React.CSSProperties = {
        fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 700, lineHeight: 1.6
    };

    /**
     * حقل «كلمة السر الحالية» — يظهر في كل قسم حسّاس بنصّ واحد موحّد.
     *
     * يُستدعى **كدالة** `{currentPasswordField()}` لا كمكوّن `<X />` عمداً:
     * المكوّن المُعرَّف داخل جسم مكوّن آخر يحمل هوية جديدة في كل رسم، فيرى React
     * نوعاً مختلفاً ويفكّ الشجرة ويعيد تركيبها — أي أن الحقل **يفقد التركيز بعد
     * كل حرف يُكتب فيه**. الاستدعاء كدالة يُدرج العناصر بلا حدّ مكوّن فلا يحدث
     * ذلك. (نفس درس TDZ في v10.61: ترتيب التعريف وشكله ليسا تفصيلاً تجميلياً.)
     */
    const currentPasswordField = () => (
        <>
            <div style={{ ...noteStyle, color: '#b45309' }}>
                🔒 {isRTL
                    ? 'هذا تغيير يمسّ دخولك للحساب، فنطلب كلمة السر الحالية للتأكد أنك أنت.'
                    : 'This changes how you sign in, so we ask for your current password.'}
            </div>
            <PasswordField
                value={currentPw}
                onChange={setCurrentPw}
                isRTL={isRTL}
                hideChecklist
                autoComplete="current-password"
                placeholder={isRTL ? 'كلمة السر الحالية' : 'Current password'}
                inputStyle={inputStyle}
            />
            <TurnstileWidget onToken={setCaptchaToken} isRTL={isRTL} resetSignal={captchaNonce} />
        </>
    );

    return (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', padding: 20, borderRadius: 20 }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 900, marginBottom: 15 }}>
                {isRTL ? '👤 بيانات الحساب' : '👤 Account Info'}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Row
                    id="name"
                    icon="🪪"
                    label={isRTL ? 'الاسم' : 'Name'}
                    value={user.name || '—'}
                    action={isRTL ? 'تعديل' : 'Edit'}
                />
                {open === 'name' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, background: 'var(--body-bg)', borderRadius: 12 }}>
                        <input value={name} onChange={e => setName(e.target.value)} placeholder={isRTL ? 'الاسم الجديد' : 'New name'} maxLength={60} style={inputStyle} />
                        {user.userType === 'seller' && (
                            <input value={shop} onChange={e => setShop(e.target.value)} placeholder={isRTL ? 'اسم المتجر' : 'Shop name'} maxLength={60} style={inputStyle} />
                        )}
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={saveName} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
                                {busy ? (isRTL ? '⏳ جاري الحفظ...' : '⏳ Saving...') : (isRTL ? '💾 حفظ الاسم' : '💾 Save')}
                            </button>
                            <button onClick={close} style={ghostBtn}>{isRTL ? 'إلغاء' : 'Cancel'}</button>
                        </div>
                    </div>
                )}

                <Row
                    id="phone"
                    icon="📱"
                    label={isRTL ? 'رقم الجوال' : 'Phone'}
                    value={user.phone || '—'}
                    action={isRTL ? 'تعديل' : 'Edit'}
                />
                {open === 'phone' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, background: 'var(--body-bg)', borderRadius: 12 }}>
                        <input
                            type="tel"
                            value={phone}
                            onChange={e => setPhone(normalizeArabicNumerals(e.target.value).replace(/\D/g, ''))}
                            placeholder="05xxxxxxxx"
                            maxLength={10}
                            autoComplete="tel"
                            style={inputStyle}
                        />
                        <div style={noteStyle}>
                            {isRTL ? 'يبدأ بـ 05 ويتكون من 10 أرقام — وبه تسجّل دخولك.' : 'Starts with 05, 10 digits — you sign in with it.'}
                        </div>
                        {currentPasswordField()}
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={savePhone} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
                                {busy ? (isRTL ? '⏳ جاري الحفظ...' : '⏳ Saving...') : (isRTL ? '💾 حفظ الجوال' : '💾 Save')}
                            </button>
                            <button onClick={close} style={ghostBtn}>{isRTL ? 'إلغاء' : 'Cancel'}</button>
                        </div>
                    </div>
                )}

                <Row
                    id="email"
                    icon="✉️"
                    label={isRTL ? 'البريد الإلكتروني' : 'Email'}
                    value={user.email || '—'}
                    action={isRTL ? 'تعديل' : 'Edit'}
                />
                {open === 'email' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, background: 'var(--body-bg)', borderRadius: 12 }}>
                        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" style={inputStyle} />
                        <div style={noteStyle}>
                            {isRTL
                                ? '⚠️ سيصلك رابط تأكيد على البريد الجديد. لن يتغيّر بريدك في تاكي إلا بعد ضغطه — وحتى ذلك الحين ادخل ببريدك القديم.'
                                : '⚠️ A confirmation link goes to the new address. Your TAKI email changes only after you click it — until then, sign in with the old one.'}
                        </div>
                        {currentPasswordField()}
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={saveEmail} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
                                {busy ? (isRTL ? '⏳ جاري الإرسال...' : '⏳ Sending...') : (isRTL ? '📧 إرسال رابط التأكيد' : '📧 Send confirmation')}
                            </button>
                            <button onClick={close} style={ghostBtn}>{isRTL ? 'إلغاء' : 'Cancel'}</button>
                        </div>
                    </div>
                )}

                <Row
                    id="password"
                    icon="🔑"
                    label={isRTL ? 'كلمة السر' : 'Password'}
                    value={isRTL ? '•••••• (يمكن تغييرها في أي وقت)' : '•••••• (Change anytime)'}
                    action={isRTL ? 'تغيير' : 'Change'}
                />
                {open === 'password' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, background: 'var(--body-bg)', borderRadius: 12 }}>
                        {currentPasswordField()}
                        <PasswordField
                            value={newPw}
                            onChange={setNewPw}
                            isRTL={isRTL}
                            placeholder={isRTL ? 'كلمة السر الجديدة' : 'New password'}
                            inputStyle={inputStyle}
                        />
                        {newPw.length > 0 && (
                            <div style={{ ...noteStyle, color: passwordProblem(newPw) ? '#dc2626' : '#059669' }}>
                                {passwordProblem(newPw) || (isRTL ? '✅ كلمة سر مقبولة' : '✅ Password looks good')}
                            </div>
                        )}
                        <PasswordField
                            value={confirmPw}
                            onChange={setConfirmPw}
                            isRTL={isRTL}
                            hideChecklist
                            placeholder={isRTL ? 'تأكيد كلمة السر الجديدة' : 'Confirm new password'}
                            inputStyle={inputStyle}
                        />
                        <div style={noteStyle}>
                            {isRTL
                                ? 'بعد التغيير ستُنهى جلساتك على الأجهزة الأخرى تلقائياً.'
                                : 'Your sessions on other devices will be signed out automatically.'}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={savePassword} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
                                {busy ? (isRTL ? '⏳ جاري التغيير...' : '⏳ Changing...') : (isRTL ? '🔒 تغيير كلمة السر' : '🔒 Change password')}
                            </button>
                            <button onClick={close} style={ghostBtn}>{isRTL ? 'إلغاء' : 'Cancel'}</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AccountSettingsCard;
