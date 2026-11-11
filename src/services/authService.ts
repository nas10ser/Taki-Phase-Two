import { supabase } from './supabaseClient';
import { CONFIG } from '../config';

export interface UserProfile {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    userType: 'buyer' | 'seller' | 'admin';
    shop?: string;
    contactPhone?: string;
    address?: string;
    avatar_url?: string;
    bio?: string;
    savings?: number;
    bookingsCount?: number;
    notifKeywords?: string[]; // legacy — superseded by smartAlerts
    smartAlerts?: SmartAlertRule[];
    followedMerchants?: string[];
    blockedMerchants?: string[];
    preferredLang?: 'ar' | 'en';
    lat?: number;
    lng?: number;
    /**
     * v14.06 — عنوان التوصيل الدائم للمشتري (`users.delivery_address`).
     * الإحداثيات إلزامية في القاعدة لأن نطاق التاجر يُقاس عليها؛ الوسم والتفاصيل
     * والجوال للتاجر ليصل. `null` = محو مقصود، `undefined` = لا تلمس العمود.
     * ⚠️ بيانات شخصية: لا تُدرج في أي قائمة أعمدة عامة (`PUBLIC_SELLER_COLUMNS`).
     */
    deliveryAddress?: {
        label?: string;
        details?: string;
        city?: string;
        phone?: string;
        lat: number;
        lng: number;
    } | null;
    googleMapsLink?: string;
    workingHours?: any;   // ساعات عمل المحل (للتاجر) — see utils/workingHours
    // v11.19 — granular admin permissions. Super admin (Nasser) bypasses
    // every check; staff admins (`isSuperAdmin=false`) only see tabs/actions
    // whose key is present in `adminPermissions`. Both fields are loaded
    // from `public.users` and are also exposed via the `admin_my_permissions`
    // RPC for fresh reads after a privilege change.
    isSuperAdmin?: boolean;
    adminPermissions?: string[];
}

// v11.19 — canonical permission keys. Keep this list in sync with the
// migration (`v11_19_admin_permissions_system`) and with the Admin
// management UI. Adding a new key here is enough to let the super admin
// grant it; the consuming code decides what it gates.
export type AdminPermission =
    | 'tab_overview'
    | 'tab_buyers'
    | 'tab_sellers'
    | 'tab_reports'
    | 'tab_verification'
    | 'tab_analytics'
    | 'tab_tools'
    | 'tab_messages'
    | 'tab_contests'
    | 'tab_launch'
    | 'tab_delivery'
    | 'tab_admins'
    | 'action_impersonate'
    | 'action_view_finance'
    | 'action_delete_deals'
    | 'action_manage_seasonal'
    | 'action_manage_campaigns'
    | 'action_manage_banners'
    | 'action_manage_users'
    | 'action_manage_sponsors'
    | 'action_moderate_messages';

export interface SmartAlertRule {
    regions?: string[];
    cities?: string[];
    malls?: string[];        // location ids
    categories?: string[];
    keywords?: string[];
    coords?: { lat: number; lng: number };
    radiusKm?: number;
}

/**
 * v15.79 — مَحوُ مرفقات المحادثات والشكاوى من مخزون العامل عند الخروج.
 *
 * 🔴 قِيس: `/storage/v1` لم يكن في `API_PATHS` داخل `sw.js`، فمرفقُ محادثةٍ
 *    بعنوانٍ **موقَّعٍ** يسقط في فرع «المخزونُ أوّلاً»، ويُخزَّن بمفتاحِ
 *    العنوان الموقَّع كاملاً، ثمّ **يُقدَّم للأبد متجاهلاً انتهاءَ الرمز** —
 *    على جهازٍ قد يستعمله غيرُ صاحب الحساب بعد خروجه.
 *    (وُجّه الفرعُ في v15.79 إلى الشبكة وحدها، فهذا دفاعٌ ثانٍ لا أوّل.)
 *
 * 🪤 ولا يُمحى المخزونُ كلُّه: `sw.js` لا يَحذف المخزونَ القديم إلا بعد أن
 *    يملك `/index.html` صالحاً، فمَحوٌ شاملٌ عند الخروج يترك جهازاً بلا
 *    شبكةٍ **لا يفتح شيئاً** — وهو عيبُ «الموقع عندي لا يفتح» بعينه.
 *    فالمحوُ مقصورٌ على ما يحمل بياناتِ شخص.
 */
const purgePrivateCache = async (): Promise<void> => {
    try {
        if (typeof caches === 'undefined') return;
        for (const name of await caches.keys()) {
            const c = await caches.open(name);
            for (const req of await c.keys()) {
                if (/\/storage\/v1\//.test(req.url)) await c.delete(req);
            }
        }
    } catch { /* متصفّحٌ بلا Cache Storage، أو تصفّحٌ خاصّ */ }
};

/**
 * v15.80 — سنُّ الأهلية للتعاقد في السعودية، **مصدرٌ واحد**.
 * يُخزَّن إقرارٌ لا تاريخَ ميلاد: أقلُّ بيانٍ شخصيٍّ يكفي للغرض (طلبُ ناصر).
 * 🪤 وكان معرَّفاً داخل `Register.tsx` وحدها، فبوّابةُ الموافقة كانت ستحمل
 *    رقماً ثانياً يَنحرف عنه. وموضعُه هنا لأنّ كاتبَ الإقرار هو من يملك قيمتَه.
 */
export const MIN_AGE = 18;

/** حدثٌ يُبثّ بعد كتابةِ موافقةٍ **مُثبَتةٍ بقراءة** — تسمعه بوّابةُ الموافقة. */
export const CONSENT_EVENT = 'taki:consent-recorded';

/**
 * وسمٌ في الذاكرة لآخر إصدارٍ ثبُتت موافقتُه في هذه الصفحة.
 * 🪤 بلا هذا الوسمِ يقع سباقٌ حقيقيّ: شاشةُ التسجيل تكتب الموافقةَ في نفس
 *    اللحظة التي تظهر فيها الجلسةُ للبوّابة، فتقرأ البوّابةُ الصفَّ قبل
 *    الكتابةِ وتظهر لمن وافق للتوّ. وهو وسمٌ **تابعٌ لكتابةٍ مقروءة** لا
 *    بديلٌ عنها — فليس ثقباً.
 */
let lastRecordedVersion: string | null = null;
export const consentRecordedFor = (version: string): boolean => lastRecordedVersion === version;

export const authService = {
    // Current memory-only profile for synchronous checks
    _profile: null as UserProfile | null,
    getUser: (): UserProfile | null => {
        return authService._profile;
    },

    setUser: (profile: UserProfile): void => {
        authService._profile = profile;
    },

    /**
     * v15.80 — الكاتبُ الوحيد لموافقةِ الشروط في الموقع.
     *
     * 🔴 ولا «أطلقها وانسَها»: الموضعان القائمان كانا ملفوفَين بـ
     *    `try { } catch { }` فارغ، فانقطاعُ شبكةٍ لحظةَ التسجيل كان يُفقد
     *    التوقيعَ القانونيَّ **نهائيّاً وبصمت** — والتعليقُ يَعِد بإعادةِ
     *    محاولةٍ «عند الدخول القادم» لم تُكتب قطّ (قِيس: مطابقةٌ واحدة،
     *    وهي التعليقُ نفسه).
     * 🔴 والكتابةُ لا تُصدَّق حتى تُقرأ: `record_user_consent` تُرجع
     *    `{changed:false,error:'AUTH_REQUIRED'}` **بلا استثناء** إن لم تكن
     *    هناك جلسة، وتُرجع `already` إن لم تكتب شيئاً. فالحُكمُ على الصفِّ
     *    بعدها لا على ردّها (درسُ v14.44: كتابةٌ بصفر صفوفٍ بلا خطأ).
     *
     * ويُستعاد الفشلُ الآن بلا عمل: بوّابةُ الموافقة تسأل عند كلّ فتحة،
     * فكتابةٌ ضائعةٌ تُطلَب مرّةً أخرى بدل أن تُفقد إلى الأبد.
     */
    recordConsent: async (termsVersion: string): Promise<{ ok: boolean; reason?: string }> => {
        let uid: string | undefined;
        try {
            const { data } = await supabase.auth.getSession();
            uid = data?.session?.user?.id;
        } catch { /* تُعالَج أدناه */ }
        if (!uid) return { ok: false, reason: 'AUTH_REQUIRED' };

        try {
            const { data, error } = await supabase.rpc('record_user_consent', {
                p_terms_version: termsVersion,
                // العنوانُ يُشتقّ على الخادم من ترويسة الطلب. ما يقوله
                // المتصفّح عن عنوانه ليس دليلاً.
                p_ip: null,
                p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 250) : null,
                p_kind: 'terms',
                p_min_age: MIN_AGE,
            });
            if (error) return { ok: false, reason: error.message || 'RPC_FAILED' };
            const soft = (data as { error?: string } | null)?.error;
            if (soft) return { ok: false, reason: soft };

            const { data: row, error: readErr } = await supabase
                .from('users')
                .select('consent_terms_version, consent_age_confirmed')
                .eq('id', uid)
                .maybeSingle();
            if (readErr) return { ok: false, reason: readErr.message || 'READBACK_FAILED' };
            if (!row || row.consent_terms_version !== termsVersion || row.consent_age_confirmed !== true) {
                return { ok: false, reason: 'NOT_PERSISTED' };
            }

            lastRecordedVersion = termsVersion;
            try { window.dispatchEvent(new Event(CONSENT_EVENT)); } catch { /* بيئةٌ بلا نافذة */ }
            return { ok: true };
        } catch (e: any) {
            return { ok: false, reason: e?.message || 'NETWORK' };
        }
    },

    logout: async (): Promise<void> => {
        // v15.80 — ويُنسى وسمُ الموافقة مع الجلسة، وإلّا ورث الحسابُ التالي
        // على نفس الصفحة «وافق للتوّ» وهو لم يوافق.
        lastRecordedVersion = null;
        // Clear local cache IMMEDIATELY
        authService._profile = null;
        localStorage.removeItem('supabase.auth.token');
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('sb-') || key.includes('auth-token')) {
                localStorage.removeItem(key);
            }
        });

        try {
            await supabase.auth.signOut();
        } catch (e) {
            console.error('Signout Error', e);
        }
        await purgePrivateCache();
    },

    deleteAccount: async (): Promise<void> => {
        try {
            // Call the RPC function to delete the user account in Supabase
            await supabase.rpc('delete_user_account');
            await supabase.auth.signOut();
        } catch (e) {
            console.error('Delete Account Error', e);
        }
        authService._profile = null;
        localStorage.removeItem('supabase.auth.token');
        await purgePrivateCache();
    },

    isAuthenticated: (): boolean => {
        return authService.getUser() !== null;
    },

    isAdmin: (): boolean => {
        const user = authService.getUser();
        return !!user && user.userType === 'admin';
    },

    isSeller: (): boolean => {
        const user = authService.getUser();
        return user?.userType === 'seller' || user?.userType === 'admin';
    },

    // ----------------------------------------------------
    //                 REAL SUPABASE AUTH
    // ----------------------------------------------------

    signUpWithPhone: async (profile: UserProfile, password: string) => {
        if (!profile.phone) {
            return { data: null, error: { message: 'Phone is required for phone signup' } } as any;
        }
        return await supabase.auth.signUp({
            phone: profile.phone,
            email: profile.email,
            password,
            options: {
                data: {
                    name: profile.name,
                    phone: profile.phone,
                    user_type: profile.userType,
                    shop: profile.shop,
                    contact_phone: profile.contactPhone || profile.phone,
                    address: profile.address || '',
                    savings: profile.savings || 0,
                }
            }
        });
    },

    signUpWithEmail: async (email: string, password: string, userData: { name: string, phone: string, user_type: string, shop?: string | null, contact_phone?: string, address?: string, referral_source?: string | null, referral_source_detail?: string | null, referred_by_code?: string | null, lang?: 'ar' | 'en' }, captchaToken?: string) => {
        return await supabase.auth.signUp({
            email,
            password,
            options: {
                // v13.52 — Cloudflare Turnstile. Passing a token while the auth
                // server still has CAPTCHA switched off is a no-op: GoTrue only
                // looks at this field once the feature is enabled. That is the
                // whole point of shipping the client half first — the day the
                // server switch flips, every page is already sending a token.
                ...(captchaToken ? { captchaToken } : {}),
                // Pin the confirmation link's redirect target to the current
                // origin (https://www.takisa.net in production, or whatever
                // the user's browser shows). Without this, Supabase
                // falls back to its configured Site URL — which defaults to
                // localhost:3000 — and the email link sends the user to a
                // dead "ERR_CONNECTION_REFUSED" page on their phone. The
                // origin still has to be in the project's Redirect-URL
                // allowlist; we document that step in progress.md for v10.55.
                emailRedirectTo: window.location.origin,
                data: {
                    name: userData.name,
                    phone: userData.phone,
                    user_type: userData.user_type,
                    shop: userData.shop || null,
                    contact_phone: userData.contact_phone || userData.phone,
                    address: userData.address || '',
                    // v12.30 — referral attribution; handle_new_user resolves
                    // referred_by_code → the owning store's id server-side.
                    referral_source: userData.referral_source || null,
                    referral_source_detail: userData.referral_source_detail || null,
                    referred_by_code: userData.referred_by_code || null,
                    // v13.92 — لغة الواجهة وقت التسجيل. GoTrue يمرّر
                    // raw_user_meta_data للقالب باسم `.Data`، فهذا الحقل هو
                    // ما يجعل بريد التأكيد يصل عربياً لمن يسجّل بالعربية
                    // وإنجليزياً لمن يسجّل بالإنجليزية. غيابه = عربي.
                    lang: userData.lang === 'en' ? 'en' : 'ar',
                }
            }
        });
    },

    checkPhoneExists: async (phone: string): Promise<boolean> => {
        // 🔴 v13.99 — كان يستعمل `find_email_by_phone`، وهي دالة **تسجيل دخول**
        // تستثني حسابات الإدارة عمداً منذ v12.39 (تدخل بالبريد لا بالجوال).
        // فكانت تُرجع فارغاً لرقم مسجَّل فعلاً ⇒ الموقع يقول «✅ الرقم متاح»
        // لرقم مأخوذ، ثم يفشل التسجيل عند القاعدة بخطأ غامض.
        //
        // السؤال هنا «هل الرقم مأخوذ؟» لا «بأي بريد يدخل صاحبه؟» — و
        // `account_exists` هي دالة هذا السؤال بالضبط، بلا أي استثناء.
        const { data, error } = await supabase.rpc('account_exists', { p_email: null, p_phone: phone });
        // نرمي الخطأ عمداً: «تعذّر الفحص» ليست «متاح». الواجهة تُظهر تحذيراً
        // بدل علامة خضراء كاذبة.
        if (error) throw error;
        return !!(data && (data as any).phone_taken);
    },

    checkEmailExists: async (email: string): Promise<boolean> => {
        // v11.43: route through the SECURITY DEFINER `account_exists` RPC instead
        // of reading public.users directly. The users RLS policy no longer exposes
        // buyer rows to anon, so a direct table read would always miss buyers.
        // 🔴 v13.99 — كان `catch {} return false`: أي خطأ (حدّ محاولات، شبكة)
        // يُترجَم «البريد متاح» ويُظهر علامة خضراء كاذبة على بريد مأخوذ.
        // الفشل الآن يُرمى فتعرضه الواجهة تحذيراً — «لا أعرف» ليست «متاح».
        const { data, error } = await supabase.rpc('account_exists', { p_email: email, p_phone: null });
        if (error) throw error;
        return !!(data && (data as any).email_taken);
    },

    /**
     * Combined check: returns which fields are already taken
     * Used for real-time inline validation during registration.
     * v11.43: backed by the `account_exists` definer RPC (see checkEmailExists).
     */
    checkFieldsAvailability: async (email?: string, phone?: string): Promise<{ emailTaken: boolean; phoneTaken: boolean }> => {
        // v13.99 — لا ابتلاع صامت: «تعذّر الفحص» تُرمى ولا تُقدَّم كـ«متاح».
        const { data, error } = await supabase.rpc('account_exists', { p_email: email ?? null, p_phone: phone ?? null });
        if (error) throw error;
        return {
            emailTaken: !!(data && (data as any).email_taken),
            phoneTaken: !!(data && (data as any).phone_taken),
        };
    },

    verifyOtp: async (phoneOrEmail: string, token: string, type: 'sms' | 'email') => {
        if (type === 'sms') {
            return await supabase.auth.verifyOtp({ phone: phoneOrEmail, token, type: 'sms' });
        } else {
            return await supabase.auth.verifyOtp({ email: phoneOrEmail, token, type: 'email' });
        }
    },

    resendVerification: async (email: string, captchaToken?: string) => {
        // v13.98 — /resend من المسارات التي تحرسها كابتشا GoTrue (مع /signup
        // و/token و/recover). شاشة التحقّق تعرض ودجتها الخاص لهذا السبب.
        return await supabase.auth.resend({
            type: 'signup',
            email,
            ...(captchaToken ? { options: { captchaToken } } : {}),
        } as any);
    },

    signInWithPassword: async (identifier: string, password: string, type: 'phone' | 'email', captchaToken?: string) => {
        const opts = captchaToken ? { captchaToken } : undefined;
        if (type === 'phone') {
            // Normalize phone: digits only, strip 966/00966 country code
            let normalizedPhone = identifier.replace(/\D/g, '');
            if (normalizedPhone.startsWith('00966')) {
                normalizedPhone = '0' + normalizedPhone.slice(5);
            } else if (normalizedPhone.startsWith('966') && normalizedPhone.length > 10) {
                normalizedPhone = '0' + normalizedPhone.slice(3);
            }

            // النمط القديم: الحسابات المسجّلة بالجوال وحده بريدها <الجوال>@taki.app
            const dummyEmail = `${normalizedPhone}@taki.app`;

            // 🔴 v13.96 — كان هنا **سباق**: نداءا دخول متوازيان (البريد من الـRPC،
            // والبريد الوهمي القديم) وأوّلهما ينجح يفوز. صار السباق مستحيلاً بعد
            // تفعيل Turnstile: **الرمز يُستهلك مرة واحدة**، فالنداء الثاني يصل
            // بنفس الرمز فترفضه Cloudflare بـ`timeout-or-duplicate` — أي أن نصف
            // محاولات الدخول كانت ستفشل بخطأ «كابتشا» عشوائياً.
            //
            // البديل تسلسلي: نحسم البريد أولاً (الـRPC يغطّي كل صيغ الجوال
            // وبيانات الحساب)، ثم ننفق الرمز في نداء واحد فقط. تكلفتُه دورةُ
            // شبكة إضافية، وثمنُ السباق كان دخولاً متقطّعاً بلا سبب ظاهر.
            // ═══ v15.86 — المسارُ الخادميّ أوّلاً: البريدُ يُحسم عند الخادم ═══
            // 🔴 كان المتصفّحُ يسأل `find_email_by_phone` **قبل** كلمة المرور،
            //    وهي ممنوحةٌ لـ`anon` — فمن يعرف رقمَ جوّالِ عميلٍ يعرف بريدَه.
            //    الآن يرسل الرقمَ والكلمةَ والكابتشا إلى `phone-login`، فلا يعود
            //    إليه بريدٌ إلّا داخل جلسةٍ صحيحة.
            // 🪤 ولا يرتدّ إلى المسار القديم إلّا حين **لم يُستهلك رمزُ الكابتشا**
            //    (٥xx أو انقطاعُ شبكة). فالرمزُ يُستعمل مرّةً واحدة، وارتدادٌ بعد
            //    ٤٠٠ كان سيُنتج «كابتشا خاطئة» على كلّ محاولةٍ ثانية.
            // 🪤 **شبكةُ أمانٍ ضدّ قفلٍ لا أستطيع قياسَه**: لو رُفض رمزُ الكابتشا
            //    عبر الوسيط لسببٍ لم يُقَس، لكان المستخدمُ يُرفَض كلَّ مرّة.
            //    فأوّلُ فشلِ كابتشا يُطفئ المسارَ الجديد **لبقيّة الجلسة**،
            //    فتمضي المحاولةُ التالية في المسار القديم المُثبَت. أسوأُ ما
            //    يقع عندها محاولةٌ واحدةٌ ضائعة، لا بابٌ مغلق.
            const SRV_OFF = 'taki-phone-login-srv-off';
            let useServer = true;
            try { useServer = sessionStorage.getItem(SRV_OFF) !== '1'; } catch { /* وضعٌ خاصّ */ }
            if (useServer) try {
                const r = await supabase.functions
                    .invoke('phone-login', { body: { phone: normalizedPhone, password, captchaToken } });
                // 🪤 **`invoke` لا يُعيد جسمَ الردّ عند ٤٠٠/٤٢٩** — يضعه في
                //    `error.context` (وهو `Response`). فقراءةُ `data` وحدها
                //    كانت تجعل كلَّ رفضٍ يبدو «خطأً مجهولاً» فيرتدّ إلى المسار
                //    القديم برمزِ كابتشا **مستهلَك** ⇒ فشلٌ مزدوجٌ دائم.
                let srv: any = r.data;
                const fErr: any = r.error;
                if (!srv && fErr?.context && typeof fErr.context.json === 'function') {
                    try { srv = await fErr.context.json(); } catch { /* جسمٌ غيرُ json */ }
                }
                const sess = (srv as any)?.session;
                if ((srv as any)?.ok && sess?.access_token && sess?.refresh_token) {
                    const { data, error } = await supabase.auth.setSession({
                        access_token: sess.access_token, refresh_token: sess.refresh_token,
                    });
                    if (!error && data?.user) return { data, error: null } as any;
                    // 🔴 الجلسةُ صحيحةٌ وصلت، وفشل تثبيتُها محلياً (تخزينٌ ممنوع
                    //    مثلاً). الرمزُ **أُنفق**، فالارتدادُ فشلٌ ثانٍ مؤكَّد.
                    return { error: { message: 'تم التحقّق لكن تعذّر حفظ الجلسة على هذا المتصفّح. جرّب نافذةً عادية (لا خفيّة) أو متصفّحاً آخر.' } } as any;
                }
                const code = String((srv as any)?.error || '');
                if (code === 'rate_limited') return { error: { message: String((srv as any)?.message || 'محاولات كثيرة — أعد المحاولة بعد قليل.') } } as any;
                if (code === 'captcha_failed') {
                    // 🪤 ولا يُشعَل المفتاحُ إلّا إن **أُرسل رمزٌ ورُفض**: الرفضُ
                    //    لغياب الرمز أصلاً لا يقول شيئاً عن الوسيط، وإطفاءُ
                    //    المسار الجديد عنده يُنزله بلا سبب لبقيّة الجلسة.
                    if (captchaToken) { try { sessionStorage.setItem(SRV_OFF, '1'); } catch { /* وضعٌ خاصّ */ } }
                    return { error: { message: 'تعذّر التحقّق من أنك لست روبوتاً. أعد المحاولة.' } } as any;
                }
                // 🪤 والتلميحُ **ثابتٌ للجميع** فلا يكشف وجودَ حساب: حساباتُ
                //    الإدارة لا تُحَلّ بالجوّال أصلاً (بالتصميم منذ v12.39)،
                //    وكان المسارُ القديم يقول ذلك صراحةً — وهو تسريبٌ. فالعبارةُ
                //    الواحدةُ تُنقذ الأدمن ولا تُفرّق بين رقمٍ مسجَّلٍ وغيره.
                if (code === 'invalid_credentials') return { error: { message: 'كلمة المرور أو رقم الجوال غير صحيح، حاول مرة أخرى.\n\n(وإن كان حسابك إدارياً فادخل بالبريد الإلكتروني.)' } } as any;
                // 🪤 `auth_unavailable` = ردٌّ ٥xx من قوقل‑تروو **بعد** أن رأى
                //    الرمز، فقد يكون أُنفق ⇒ لا يُرتدّ، ويُقال للمستخدم الحقيقة.
                if (code === 'auth_unavailable') return { error: { message: 'خدمةُ الدخول غير متاحة الآن. حاول بعد دقيقة.' } } as any;
                // وما بقي (`gate_failed` · `auth_unreachable` · خطأُ شبكة) يعني
                // أن الطلبَ لم يبلغ قوقل‑تروو ⇒ الرمزُ لم يُنفَق ⇒ المسارُ القديم.
            } catch { /* شبكةٌ أو دالّةٌ غائبة ⇒ المسارُ القديم */ }

            let targetEmail: string | null = null;
            try {
                const { data: rpcEmail } = await supabase.rpc('find_email_by_phone', { input_phone: normalizedPhone });
                if (rpcEmail) targetEmail = String(rpcEmail);
            } catch { /* نسقط للنمط القديم أدناه */ }

            const result = await supabase.auth
                .signInWithPassword({ email: targetEmail || dummyEmail, password, options: opts } as any)
                .catch((err: any) => ({ error: { message: err?.message || 'sign-in-failed' } } as any));

            if (result?.data?.user) return result;

            const msg = String(result?.error?.message || '').toLowerCase();
            if (msg.includes('invalid login credentials')) {
                // v13.97 — رسالة أوضح حين لا يُحلّ الرقم إلى بريد: بعض الحسابات
                // (كحسابات الإدارة) تدخل بالبريد وحده منذ v12.39، فالرقم الصحيح
                // يبدو «غير مسجّل». لا نُلمّح لنوع الحساب — نوجّه للبديل فقط.
                return { error: { message: !targetEmail
                    ? 'تعذّر الدخول بهذا الرقم. جرّب البريد الإلكتروني المرتبط بالحساب، أو سجّل حساباً جديداً.'
                    : 'كلمة المرور أو رقم الجوال غير صحيح، حاول مرة أخرى.' } };
            }
            return result;
        } else {
            return await supabase.auth.signInWithPassword({ email: identifier, password, options: opts } as any);
        }
    },

    // OAuth helpers — both use skipBrowserRedirect so the caller can catch
    // "provider is not enabled" / config errors and surface a friendly
    // Arabic message instead of letting Supabase navigate the user away
    // to a black JSON error page on supabase.co.
    signInWithApple: async () => {
        const result = await supabase.auth.signInWithOAuth({
            provider: 'apple',
            options: {
                redirectTo: window.location.origin,
                skipBrowserRedirect: true,
            }
        });
        if (!result.error && result.data?.url) {
            window.location.href = result.data.url;
        }
        return result;
    },

    signInWithGoogle: async () => {
        const result = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin,
                skipBrowserRedirect: true,
                queryParams: {
                    access_type: 'offline',
                    prompt: 'consent'
                }
            }
        });
        if (!result.error && result.data?.url) {
            window.location.href = result.data.url;
        }
        return result;
    },

    /**
     * استعادةُ كلمة المرور **بالجوّال** — والخادمُ يُرسل الرسالة (v15.91).
     * 🔴 كان المتصفّحُ يسأل `find_email_by_phone` فيصله البريدُ كاملاً ثمّ
     *    تُقنّعه الشاشةُ للعرض — والتقنيعُ في الشاشة لا يمنع من ينادي الدالّة
     *    مباشرةً. الآن لا يعود إلّا البريدُ **مُقنَّعاً**، وهو ما كان يُعرض.
     * 🪤 و`stop:false` تعني **لم يُنفَق رمزُ الكابتشا** (٥xx أو شبكة) فيُكمل
     *    المنادي بالمسار القديم بـ`email`. وما عداه يُحسم هنا.
     */
    recoverByPhone: async (digits: string, captchaToken?: string, redirectTo?: string): Promise<{
        stop: boolean; ar: string; en: string; email?: string; masked?: string;
    }> => {
        const NOT_FOUND = {
            stop: true,
            ar: 'لم نجد حساباً بهذا الرقم يمكن استعادته. اكتب بريدك الإلكتروني في الخانة أعلاه.',
            en: 'No recoverable account for this number. Enter your email address in the field above.',
        };
        let srv: any = null;
        try {
            const r = await supabase.functions.invoke('phone-login', { body: {
                action: 'recover', phone: digits, captchaToken, redirectTo,
            } });
            srv = r.data;
            const fe: any = r.error;
            if (!srv && fe?.context?.json) { try { srv = await fe.context.json(); } catch { /* ليس json */ } }
        } catch { /* شبكةٌ ⇒ ارتداد */ }
        if (srv?.ok === true && srv?.found === false) return NOT_FOUND;
        if (srv?.ok === true && srv?.masked) {
            return { stop: true, masked: String(srv.masked),
                ar: `سنرسل رمز الاستعادة إلى بريدك: ${srv.masked}`,
                en: `We'll send the reset code to your email: ${srv.masked}` };
        }
        if (String(srv?.error || '') === 'captcha_failed') {
            return { stop: true, ar: 'تعذّر التحقّق من أنك لست روبوتاً. أعد المحاولة.', en: 'Verification failed. Please try again.' };
        }
        // ارتدادٌ — الرمزُ لم يُنفَق (شبكةُ أمانٍ تُسحب بعد أن يُقاس المسارُ الجديد)
        try {
            const { data } = await supabase.rpc('find_email_by_phone', { input_phone: digits });
            if (data) return { stop: false, ar: '', en: '', email: String(data) };
        } catch { /* لا شيء */ }
        return NOT_FOUND;
    },

    /**
     * تحقّقُ رمز الاستعادة **بالجوّال** — فلا يحتاج المتصفّحُ البريدَ أصلاً.
     * 🔴 ولولا هذه لبقي التسريبُ مفتوحاً: نقلُ الإرسال وحده لا يُغني، لأن
     *    الشاشةَ تحتاج البريدَ **بعد** الإرسال لتُدخل الرمز.
     */
    verifyResetByPhone: async (digits: string, code: string, captchaToken?: string): Promise<{
        ok: boolean; ar: string; en: string;
    }> => {
        let srv: any = null;
        try {
            const r = await supabase.functions.invoke('phone-login', { body: {
                action: 'verify', phone: digits, code, captchaToken,
            } });
            srv = r.data;
            const fe: any = r.error;
            if (!srv && fe?.context?.json) { try { srv = await fe.context.json(); } catch { /* ليس json */ } }
        } catch { /* يُعالَج أدناه */ }
        const sess = srv?.session;
        if (srv?.ok === true && sess?.access_token && sess?.refresh_token) {
            const { data, error } = await supabase.auth.setSession({
                access_token: sess.access_token, refresh_token: sess.refresh_token,
            });
            if (!error && data?.user) return { ok: true, ar: '', en: '' };
            return { ok: false,
                ar: 'تم التحقّق لكن تعذّر حفظ الجلسة على هذا المتصفّح. جرّب نافذةً عادية (لا خفيّة).',
                en: 'Verified, but the session could not be stored in this browser. Try a normal (non-private) window.' };
        }
        const code2 = String(srv?.error || '');
        if (code2 === 'auth_unavailable' || code2 === 'auth_unreachable') {
            return { ok: false, ar: 'خدمةُ التحقّق غير متاحة الآن. حاول بعد دقيقة.', en: 'The verification service is unavailable. Try again in a minute.' };
        }
        return { ok: false,
            ar: '⚠️ الرمز غير صحيح أو انتهت صلاحيته. اضغط «إرسال رمز جديد» بالأسفل.',
            en: '⚠️ The code is wrong or expired. Tap "Send a new code" below.' };
    },

    resetPassword: async (email: string, captchaToken?: string) => {
        // v13.96 — الكابتشا على الخادم تحرس /recover كما تحرس /signup و/token.
        return await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/register`,
            ...(captchaToken ? { captchaToken } : {}),
        } as any);
    },

    // Cancel an unverified signup. Calls the SQL function which removes the
    // auth.users row only if the email is still unconfirmed. Used by the
    // 10-minute verification timeout in the registration flow.
    //
    // v13.40 (security): the RPC used to take the email ALONE, from any
    // anonymous caller. That let anyone delete anyone else's pending signup
    // just by naming their address — and repeating it keeps that person from
    // ever completing registration. The RPC now also demands the account UUID
    // that signUp() handed back, which only the person who actually signed up
    // has. Callers must therefore pass `userId` through.
    cancelUnverifiedSignup: async (email: string, userId: string) => {
        if (!userId) {
            console.error('cancelUnverifiedSignup: userId is required');
            return { error: { message: 'userId is required' } } as any;
        }
        try {
            return await supabase.rpc('cancel_unverified_signup', {
                target_email: email,
                target_id: userId,
            });
        } catch (e) {
            console.error('Failed to cancel unverified signup:', e);
            return { error: e } as any;
        }
    }
};
