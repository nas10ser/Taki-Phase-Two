import React, { useState, useRef, useCallback } from 'react';
import { useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { validationService } from '../services/validationService';
import { authService } from '../services/authService';
import { normalizeArabicNumerals } from '../utils/helpers';

const Register: React.FC = () => {
    const history = useHistory();
    const { language, setLanguage, customAlert, user } = useApp();

    // UI Flow States
    const [mode, setMode] = useState<'landing' | 'login' | 'type' | 'form' | 'verify'>('landing');
    const [userType, setUserType] = useState<'buyer' | 'seller' | ''>('');
    // Form States
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [shopName, setShopName] = useState('');
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [emailError, setEmailError] = useState('');
    const [phoneError, setPhoneError] = useState('');
    const [emailChecking, setEmailChecking] = useState(false);
    const [phoneChecking, setPhoneChecking] = useState(false);
    const [emailSuccess, setEmailSuccess] = useState(false);
    const [phoneSuccess, setPhoneSuccess] = useState(false);
    const [resending, setResending] = useState(false);
    const emailDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const phoneDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Auto-redirect if the user is suddenly verified while on verify screen
    React.useEffect(() => {
        if (mode === 'verify' && user) {
            customAlert(language === 'ar' ? '✅ تم التحقق بنجاح!' : '✅ Verified successfully!');
            history.push(userType === 'seller' ? '/seller' : '/');
        }
    }, [user, mode, userType, history, language, customAlert]);

    // Force the page background to match the register gradient. Otherwise
    // iOS Safari's rubber-band overscroll exposes the light --body-bg
    // (#f1f5f9) below the navy container, producing a jarring white strip
    // on every pull. Restore on unmount so the rest of the app keeps its
    // normal --body-bg.
    React.useEffect(() => {
        const prevHtmlBg = document.documentElement.style.background;
        const prevBodyBg = document.body.style.background;
        document.documentElement.style.background = '#050a18';
        document.body.style.background = '#050a18';
        return () => {
            document.documentElement.style.background = prevHtmlBg;
            document.body.style.background = prevBodyBg;
        };
    }, []);

    // 🌟 SMART POLLING (Cross-Device Auto-Login) 🌟
    React.useEffect(() => {
        let interval: ReturnType<typeof setInterval>;
        if (mode === 'verify' && email && password) {
            interval = setInterval(async () => {
                try {
                    const response = await authService.signInWithPassword(email, password, 'email');
                    const data = response.data;
                    if (data && data.user) {
                        clearInterval(interval);
                    }
                } catch (e) {
                    // silently fail
                }
            }, 3000);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [mode, email, password]);

    // Password Validation Standards
    const pwCriteria = {
        length: password.length >= 8,
        uppercase: /[A-Z]/.test(password),
        lowercase: /[a-z]/.test(password),
        number: /[0-9]/.test(password),
        special: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]+/.test(password)
    };
    const strengthScore = Object.values(pwCriteria).filter(Boolean).length;
    const isPasswordValid = strengthScore === 5;

    const isRTL = language === 'ar';
    const t = useCallback((ar: string, en: string) => (isRTL ? ar : en), [isRTL]);

    // ⏰ 10-MINUTE VERIFICATION TIMEOUT
    // If the user doesn't verify (link or code) within 10 minutes, the
    // unconfirmed auth.users row is deleted server-side and they are sent
    // back to the landing screen.
    React.useEffect(() => {
        if (mode !== 'verify' || !email) return;
        const timeoutId = setTimeout(async () => {
            await authService.cancelUnverifiedSignup(email);
            await customAlert(t(
                '⏰ انتهت مهلة التحقق (10 دقائق). تم إلغاء التسجيل، يرجى البدء من جديد.',
                '⏰ Verification timeout (10 min). Registration cancelled, please start again.'
            ));
            setEmail('');
            setPassword('');
            setName('');
            setPhone('');
            setShopName('');
            setCode('');
            setMode('landing');
        }, 10 * 60 * 1000);
        return () => clearTimeout(timeoutId);
    }, [mode, email, customAlert, t]);

    const handleForgotPassword = async () => {
        const trimmedEmail = email.trim();
        if (!trimmedEmail) {
            await customAlert(t(
                'يرجى كتابة بريدك الإلكتروني في خانة الإيميل أعلاه أولاً',
                'Please enter your email in the field above first'
            ));
            return;
        }
        if (!validationService.isValidEmail(trimmedEmail)) {
            await customAlert(t(
                'يجب إدخال بريد إلكتروني صحيح لإرسال رابط استعادة كلمة المرور',
                'A valid email is required to send the password reset link'
            ));
            return;
        }

        setLoading(true);
        const { error } = await authService.resetPassword(trimmedEmail);
        setLoading(false);

        if (error) {
            await customAlert(t(
                `تعذر إرسال رابط الاستعادة: ${error.message}`,
                `Could not send reset link: ${error.message}`
            ));
            return;
        }

        await customAlert(t(
            `📧 تم إرسال رابط استعادة كلمة المرور إلى ${trimmedEmail}. تحقق من بريدك (وأيضاً مجلد الرسائل غير المرغوبة).`,
            `📧 Password reset link sent to ${trimmedEmail}. Check your inbox (and spam folder).`
        ));
    };

    const handleLoginSubmit = async () => {
        if (!password) {
            await customAlert(t('الرجاء إدخال كلمة المرور', 'Please enter your password'));
            return;
        }

        const hasArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(email);
        if (hasArabic) {
            setEmailError(t('⚠️ يرجى استخدام أحرف إنجليزية فقط (لا يسمح بالحروف العربية)', '⚠️ Please use English letters only'));
            return;
        }

        const trimmedEmail = email.trim();
        const normalizedIdentifier = normalizeArabicNumerals(trimmedEmail).replace(/\s/g, '');
        const isPhone = /^[0-9]+$/.test(normalizedIdentifier) && normalizedIdentifier.length >= 9;
        const type = isPhone ? 'phone' : 'email';

        setLoading(true);
        // Safety net: if signInWithPassword stalls (network or RPC hang), don't
        // leave the button stuck on "جاري المعالجة" forever — surface a
        // timeout after 10s so the user can retry. The login path now races
        // RPC + dummy-email in parallel so this should rarely fire.
        let timedOut = false;
        const timeoutHandle = setTimeout(() => {
            timedOut = true;
            setLoading(false);
            customAlert(t(
                '⚠️ الشبكة بطيئة جداً. تأكد من الإنترنت وحاول مرة أخرى.',
                '⚠️ Network is too slow. Check your internet and try again.'
            ));
        }, 10000);

        try {
            const result = await authService.signInWithPassword(normalizedIdentifier, password, type);
            if (timedOut) return;
            const error = result?.error;

            // ALWAYS clear the loading state before awaiting any modal — that
            // way the button reads "Sign In" again the moment the alert
            // appears, never sticking on "Processing…".
            clearTimeout(timeoutHandle);
            setLoading(false);

            if (error) {
                let msg = typeof error === 'string' ? error : (error.message || 'بيانات الدخول غير صحيحة');
                if (msg.toLowerCase().includes('invalid login credentials')) {
                    msg = 'كلمة المرور أو البريد/الجوال غير صحيح، يرجى المحاولة مرة أخرى.';
                }
                await customAlert(t(`⚠️ خطأ في الدخول: ${msg}`, `⚠️ Login Error: ${msg}`));
            } else if (!result?.data?.user) {
                await customAlert(t(`⚠️ تعذر تسجيل الدخول، يرجى التأكد من صحة البيانات.`, `⚠️ Unable to login, please check your credentials.`));
            } else {
                // Belt-and-suspenders redirect — the AuthRedirector fires on the
                // user state change, but if anything delays that (rare), we
                // still get the user off /register immediately.
                const meta = result.data.user.user_metadata || {};
                const dest = meta.user_type === 'admin' ? '/admin'
                           : meta.user_type === 'seller' ? '/seller'
                           : '/';
                history.replace(dest);
            }
        } catch (error: any) {
            clearTimeout(timeoutHandle);
            setLoading(false);
            if (timedOut) return;
            const msg = error?.message || (typeof error === 'string' ? error : 'حاول مجدداً');
            await customAlert(t(`⚠️ حدث خطأ غير متوقع: ${msg}`, `⚠️ Unexpected error: ${msg}`));
        }
    };

    const handleProceedToVerify = async () => {
        try {
            setEmailError('');
            setPhoneError('');

            const emailHasArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(email);
            if (emailHasArabic) {
                setEmailError(t('الايميل غير صحيح', 'Invalid email'));
                return;
            }

            const trimmedEmail = email.trim();
            if (!trimmedEmail || !validationService.isValidEmail(trimmedEmail)) {
                setEmailError(t('الايميل غير صحيح', 'Invalid email'));
                return;
            }

            const phoneHasArabicOrLetters = /[^\d]/.test(phone);
            if (phoneHasArabicOrLetters) {
                setPhoneError(t('الجوال غير صحيح', 'Invalid phone'));
                return;
            }

            const normalizedPhone = normalizeArabicNumerals(phone).replace(/\D/g, '');
            if (!normalizedPhone || !validationService.isValidPhone(normalizedPhone)) {
                setPhoneError(t('الجوال غير صحيح', 'Invalid phone'));
                return;
            }

            if (userType === 'seller' && !shopName.trim()) {
                await customAlert(t('يرجى إدخال اسم المحل بشكل صحيح', 'Please enter the shop name correctly'));
                return;
            }
            if (password.length < 6) {
                await customAlert(t('يجب أن تتكون كلمة المرور من 6 أحرف على الأقل', 'Password must be at least 6 characters'));
                return;
            }
            if (!isPasswordValid) {
                await customAlert(t('يرجى التأكد من استيفاء جميع شروط قوة كلمة المرور', 'Please ensure all password strength requirements are met'));
                return;
            }

            setLoading(true);

            // Attempt DB checks if possible
            try {
                const isEmailUsed = await authService.checkEmailExists(trimmedEmail);
                if (isEmailUsed) {
                    setLoading(false);
                    setEmailError(t('الايميل مسجل مسبقا', 'Email is already registered'));
                    return;
                }

                const isPhoneUsed = await authService.checkPhoneExists(normalizedPhone);
                if (isPhoneUsed) {
                    setLoading(false);
                    setPhoneError(t('الجوال مسجل مسبقا', 'Phone is already registered'));
                    return;
                }
            } catch (e) {
                // Silently ignore RLS or network errors during pre-checks
            }

            const userData = {
                name: validationService.sanitizeText(name, 50),
                phone: normalizedPhone,
                user_type: userType,
                shop: userType === 'seller' ? shopName : null,
                contact_phone: normalizedPhone,
                address: '',
            };

            const response = await authService.signUpWithEmail(trimmedEmail, password, userData);

            setLoading(false);

            if (!response) {
                await customAlert(t('لم يتم تلقي استجابة من الخادم، يرجى المحاولة لاحقاً', 'No response from server, please try again later'));
                return;
            }

            if (response.error) {
                const errorStr = String(response.error.message || response.error).toLowerCase();

                if (errorStr.includes('already registered') || errorStr.includes('user already exists') || errorStr.includes('already been registered')) {
                    setEmailError(t('الايميل مسجل مسبقا', 'Email is already registered'));
                } else if (errorStr.includes('duplicate key') || errorStr.includes('unique constraint')) {
                    if (errorStr.includes('phone') || errorStr.includes('جوال')) {
                        setPhoneError(t('الجوال مسجل مسبقا', 'Phone is already registered'));
                    } else {
                        setEmailError(t('الايميل مسجل مسبقا', 'Email is already registered'));
                    }
                } else {
                    await customAlert(t(`خطأ في إنشاء الحساب: ${response.error.message || response.error}`, `Sign up Error: ${response.error.message || response.error}`));
                }
                return;
            }

            const userDataObj = response.data?.user;
            if (userDataObj && Array.isArray(userDataObj.identities) && userDataObj.identities.length === 0) {
                setEmailError(t('الايميل مسجل مسبقا', 'Email is already registered'));
                return;
            }

            if (response.data && response.data.session) {
                await customAlert(t('تم التسجيل بنجاح!', 'Registration successful!'));
                // AuthRedirector will automatically redirect them
                return;
            }

            await customAlert(t('نرجو اتمام التحقق لاكتمال التسجيل، راجع بريدك الإلكتروني', 'Please complete verification to finish registration. Check your email.'));

            setPhone(normalizedPhone);
            setMode('verify');
        } catch (error) {
            setLoading(false);
            console.error("Signup error:", error);
            await customAlert(t('حدث خطأ غير متوقع، يرجى المحاولة مرة أخرى.', 'An unexpected error occurred. Please try again.'));
        }
    };

    const handleVerifySubmit = async () => {
        const normalizedCode = normalizeArabicNumerals(code);
        if (!normalizedCode || normalizedCode.length < 6) {
            await customAlert(t('يرجى إدخال الكود المكون من 6 أرقام الذي وصلك في الإيميل', 'Please enter the 6-digit code from your email'));
            return;
        }

        setLoading(true);
        const { error } = await authService.verifyOtp(email, normalizedCode, 'email');
        setLoading(false);

        if (error) {
            await customAlert(t(`الكود غير صحيح أو انتهت صلاحيته: ${error.message}`, `Invalid or expired code: ${error.message}`));
            return;
        }

        await customAlert(t('✅ تم التحقق والتسجيل بنجاح!', '✅ Registration verified successfully!'));
        history.push(userType === 'seller' ? '/seller' : '/');
    };

    const handleEmailBlur = () => {
        if (!email) return;
        const trimmed = email.trim();
        const hasArabic = /[\u0600-\u06FF]/.test(trimmed);
        const hasSpaces = /\s/.test(trimmed);

        if (hasArabic) {
            setEmailError(t('الرجاء استخدام أحرف إنجليزية فقط في البريد', 'Please use English characters only for email'));
            return;
        }
        if (hasSpaces) {
            setEmailError(t('الايميل لا يجب أن يحتوي على مسافات', 'Email should not contain spaces'));
            return;
        }
        if (mode !== 'login') {
            if (!validationService.isValidEmail(trimmed)) {
                setEmailError(t('الايميل غير صحيح', 'Invalid email'));
                return;
            }
        }

        // Only clear if it's NOT an "already registered" error
        if (emailError !== t('الايميل مسجل مسبقا', 'Email is already registered') &&
            emailError !== t('⚠️ البريد الإلكتروني مسجل مسبقاً لدينا، الرجاء تسجيل الدخول', '⚠️ Email already registered, please log in')) {
            setEmailError('');
        }
    };

    const handlePhoneBlur = () => {
        if (!phone) return;
        if (!validationService.isValidPhone(phone)) {
            setPhoneError(t('رقم الجوال غير صحيح (مثال: 05XXXXXXXX)', 'Invalid phone (e.g., 05XXXXXXXX)'));
        } else if (phoneError !== t('الجوال مسجل مسبقا', 'Phone is already registered') &&
            phoneError !== t('⚠️ رقم الجوال مسجل مسبقاً لدينا، نرجو تسجيل الدخول', '⚠️ Phone already registered, please log in')) {
            setPhoneError('');
        }
    };

    // Enhanced email change handler with immediate validation and error display
    const handleEmailChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        let rawVal = e.target.value;

        // --- Immediate validation & filtering ---
        // 0. Convert Arabic numerals to English digits first
        rawVal = normalizeArabicNumerals(rawVal);
        setEmailSuccess(false);

        const hasArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(rawVal);
        const hasSpaces = /\s/.test(rawVal);

        if (hasArabic) {
            // Remove remaining Arabic letters but keep converted digits
            rawVal = rawVal.replace(/[\u0600-\u066F\u0671-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g, '');
        }
        if (hasSpaces) {
            rawVal = rawVal.replace(/\s/g, '');
        }

        // Force DOM update to discard invalid characters immediately
        if (rawVal !== e.target.value) {
            setEmail(e.target.value);
            setTimeout(() => setEmail(rawVal), 0);
        } else {
            setEmail(rawVal);
        }

        let immediateError = '';

        if (hasArabic) {
            immediateError = t('⚠️ يرجى استخدام أحرف إنجليزية فقط', '⚠️ English characters only');
        } else if (hasSpaces) {
            immediateError = t('⚠️ لا يمكن أن يحتوي على مسافات', '⚠️ No spaces allowed');
        } else if (rawVal.length > 0) {
            const isPotentialPhone = /^\d+$/.test(rawVal.trim());
            if (mode === 'login') {
                // Remove format errors during login to avoid 'invalid email' confusion
                immediateError = '';
            } else {
                if (!validationService.isValidEmail(rawVal.trim())) {
                    immediateError = t('⚠️ صيغة البريد غير صحيحة', '⚠️ Invalid email format');
                }
            }
        }

        setEmailError(immediateError);

        // Clear previous debounce
        if (emailDebounceRef.current) clearTimeout(emailDebounceRef.current);

        const trimmed = rawVal.trim();
        const isPhonePotential = /^\d+$/.test(trimmed);
        // In login mode we skip the existence pre-check entirely: the actual
        // sign-in attempt is the source of truth, and the per-keystroke RPC
        // was making the login feel laggy + showing a misleading green ✅.
        // We still keep the async existence check on register so users learn
        // up front that an email is taken.
        if (mode !== 'login' && trimmed && !hasArabic && !hasSpaces && (isPhonePotential || validationService.isValidEmail(trimmed))) {
            emailDebounceRef.current = setTimeout(async () => {
                setEmailChecking(true);
                try {
                    const exists = await authService.checkEmailExists(trimmed);
                    setEmailChecking(false);
                    if (exists) {
                        const errMsg = t('الايميل مسجل مسبقا', 'Email is already registered');
                        setEmailError(errMsg);
                        setEmailSuccess(false);
                        await customAlert(t('⚠️ هذا البريد الإلكتروني مسجل مسبقاً! يرجى تسجيل الدخول بدلاً من ذلك.', '⚠️ This email is already registered! Please log in instead.'));
                    } else if (!immediateError) {
                        setEmailError('');
                        setEmailSuccess(true);
                    }
                } catch (err: any) {
                    setEmailChecking(false);
                    setEmailSuccess(false);
                    if (err.message?.includes('rate limit')) {
                        setEmailError(t('⚠️ تم تجاوز حد المحاولات، يرجى المحاولة لاحقاً', '⚠️ Rate limit exceeded, please try again later'));
                    } else {
                        setEmailError(t('⚠️ خطأ في التحقق من البريد', '⚠️ Error checking email'));
                    }
                }
            }, 400);
        }
    }, [mode, t]);

    // Enhanced phone change handler: only allow digits (Arabic/English), max 10 digits, convert Arabic numerals
    const handlePhoneChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        let rawVal = e.target.value;

        // 1. Convert any Arabic numerals to English digits
        const converted = normalizeArabicNumerals(rawVal);
        setPhoneSuccess(false);

        // 2. Remove any non-digit character
        let digitsOnly = converted.replace(/\D/g, '');

        // 3. Limit to 10 digits
        if (digitsOnly.length > 10) {
            digitsOnly = digitsOnly.slice(0, 10);
        }

        // Force DOM update to discard typed letters immediately
        if (digitsOnly !== rawVal) {
            setPhone(rawVal);
            setTimeout(() => setPhone(digitsOnly), 0);
        } else {
            setPhone(digitsOnly);
        }

        // 5. Immediate error feedback
        if (digitsOnly.length > 0 && digitsOnly.length < 10) {
            if (!phoneError || !phoneError.includes('مسجل')) {
                setPhoneError(t('⚠️ يجب أن يتكون من 10 أرقام', '⚠️ Must be 10 digits'));
            }
        } else if (digitsOnly.length === 10 && !digitsOnly.startsWith('05')) {
            setPhoneError(t('⚠️ يجب أن يبدأ بـ 05', '⚠️ Must start with 05'));
        } else if (digitsOnly.length === 0) {
            setPhoneError('');
        } else if (digitsOnly.length === 10 && digitsOnly.startsWith('05')) {
            // Clear non-existence errors only
            if (phoneError && !phoneError.includes('مسجل') && !phoneError.includes('registered')) {
                setPhoneError('');
            }
        }

        // Clear previous debounce
        if (phoneDebounceRef.current) clearTimeout(phoneDebounceRef.current);

        // Async existence check for registration mode (not login)
        if (mode !== 'login' && digitsOnly.length >= 10) {
            phoneDebounceRef.current = setTimeout(async () => {
                if (!validationService.isValidPhone(digitsOnly)) {
                    setPhoneError(t('⚠️ رقم الجوال غير صحيح (يجب أن يبدأ بـ 05 ويتكون من 10 أرقام)', '⚠️ Invalid phone (must start with 05 and be 10 digits)'));
                    return;
                }

                setPhoneChecking(true);
                try {
                    const exists = await authService.checkPhoneExists(digitsOnly);
                    setPhoneChecking(false);
                        if (exists) {
                        const errMsg = t('الجوال مسجل مسبقا', 'Phone is already registered');
                        setPhoneError(errMsg);
                        setPhoneSuccess(false);
                        await customAlert(t('⚠️ رقم الجوال هذا مسجل مسبقاً لدينا! يرجى تسجيل الدخول أو استخدام رقم آخر.', '⚠️ This phone number is already registered! Please log in or use another number.'));
                    } else {
                        // Clear error if only existence was the issue
                        if (phoneError && phoneError.includes('مسجل')) {
                            setPhoneError('');
                        }
                        setPhoneSuccess(true);
                    }
                } catch (err: any) {
                    setPhoneChecking(false);
                    setPhoneSuccess(false);
                    if (err.message?.includes('rate limit')) {
                        setPhoneError(t('⚠️ تم تجاوز حد المحاولات، يرجى المحاولة لاحقاً', '⚠️ Rate limit exceeded, please try again later'));
                    } else {
                        setPhoneError(t('⚠️ خطأ في التحقق من الجوال', '⚠️ Error checking phone'));
                    }
                }
            }, 400);
        } else if (digitsOnly.length === 0 && mode !== 'login') {
            setPhoneError('');
        }
    }, [mode, phoneError, t]);

    const handleResendVerification = async () => {
        if (!email) return;
        setResending(true);
        const { error } = await authService.resendVerification(email);
        setResending(false);
        if (error) {
            await customAlert(t(`خطأ في إعادة الإرسال: ${error.message}`, `Resend Error: ${error.message}`));
        } else {
            await customAlert(t('✅ تم إعادة إرسال كود التحقق بنجاح!', '✅ Verification code resent successfully!'));
        }
    };

    const commonContainerStyle: React.CSSProperties = {
        minHeight: '100vh', background: 'linear-gradient(160deg, #050a18 0%, #0a1628 30%, #0f1f3a 60%, #081020 100%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 24, color: 'white',
        direction: isRTL ? 'rtl' : 'ltr', position: 'relative', overflow: 'hidden', fontFamily: 'Tajawal, system-ui, -apple-system, sans-serif'
    };

    const TopHeader = () => (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 50, direction: isRTL ? 'rtl' : 'ltr' }}>
            {mode !== 'landing' ? (
                <button onClick={() => setMode(mode === 'login' || mode === 'form' ? (mode === 'login' ? 'landing' : 'type') : 'landing')}
                    style={{ color: 'rgba(200, 200, 200, 1)', border: 'none', background: 'rgba(80, 80, 90, 0.2)', backdropFilter: 'blur(20px)', fontSize: '1.1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 42, height: 42, borderRadius: '50%', transition: 'all 0.3s' }}>
                    {isRTL ? '→' : '←'}
                </button>
            ) : <div />}
            <button
                onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
                style={{ background: 'rgba(80, 80, 90, 0.2)', backdropFilter: 'blur(20px)', border: '1px solid rgba(80, 80, 90, 0.2)', color: 'rgba(200, 200, 200, 0.9)', padding: '10px 20px', borderRadius: 24, fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5, transition: 'all 0.3s' }}
            >
                {language === 'ar' ? 'English' : 'عربي'}
            </button>
        </div>
    );

    const handleModeSwitch = (newMode: typeof mode) => {
        setMode(newMode);
        setEmailError('');
        setPhoneError('');
        setEmailChecking(false);
        setPhoneChecking(false);
    };

    if (mode === 'landing') {
        return (
            <div style={commonContainerStyle}>
                <style>{`
                    @keyframes floatOrb { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(30px,-20px) scale(1.1)} 66%{transform:translate(-20px,15px) scale(0.95)} }
                    @keyframes fadeUp { from{opacity:0;transform:translateY(30px)} to{opacity:1;transform:translateY(0)} }
                    @keyframes pulse { 0%,100%{opacity:0.6} 50%{opacity:1} }
                    .auth-btn:hover { transform:translateY(-2px); box-shadow:0 8px 30px var(--primary-glow) !important; }
                    .auth-btn-secondary:hover { background:rgba(100, 100, 100, 0.15) !important; border-color:rgba(80, 80, 95, 0.3) !important; }
                `}</style>
                <TopHeader />
                {/* Decorative orbs — wrapped in an absolutely-positioned, overflow-clipping div so the
                    400px orb can never push horizontal scroll on a 280px Galaxy Fold or 320px iPhone SE.
                    Sizes downscale via clamp() so they stay proportional on every phone. */}
                <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
                    <div style={{ position: 'absolute', top: '-15%', right: '-15%', width: 'clamp(220px, 60vw, 400px)', height: 'clamp(220px, 60vw, 400px)', borderRadius: '50%', background: 'radial-gradient(circle, rgba(15,23,42,0.12) 0%, transparent 70%)', filter: 'blur(40px)', animation: 'floatOrb 12s ease-in-out infinite' }} />
                    <div style={{ position: 'absolute', bottom: '-10%', left: '-12%', width: 'clamp(200px, 55vw, 350px)', height: 'clamp(200px, 55vw, 350px)', borderRadius: '50%', background: 'radial-gradient(circle, rgba(14,165,233,0.1) 0%, transparent 70%)', filter: 'blur(40px)', animation: 'floatOrb 15s ease-in-out infinite reverse' }} />
                    <div style={{ position: 'absolute', top: '40%', left: '50%', transform: 'translateX(-50%)', width: 'clamp(160px, 45vw, 250px)', height: 'clamp(160px, 45vw, 250px)', borderRadius: '50%', background: 'radial-gradient(circle, rgba(245,158,11,0.06) 0%, transparent 70%)', filter: 'blur(50px)', animation: 'floatOrb 18s ease-in-out infinite 3s' }} />
                </div>

                <div style={{ marginBottom: 48, textAlign: 'center', marginTop: 120, animation: 'fadeUp 0.8s ease-out' }}>
                    <div style={{ fontSize: '5rem', fontWeight: 900, marginBottom: 4, letterSpacing: -3, background: 'linear-gradient(135deg, var(--primary) 0%, var(--accent) 50%, #8b5cf6 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', filter: 'drop-shadow(0 2px 10px var(--primary-glow))' }}>TAKI</div>
                    <div style={{ fontSize: '1.1rem', opacity: 0.6, fontWeight: 400, letterSpacing: 1 }}>{t('بوابتك للاقتصاد الذكي', 'Your Gateway to Smart Savings')}</div>
                </div>

                <div style={{ width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 14, animation: 'fadeUp 0.8s ease-out 0.2s both' }}>
                    <button className="auth-btn" onClick={() => setMode('login')} style={{ ...primaryButtonStyle, background: 'var(--primary)', boxShadow: '0 4px 20px var(--primary-glow)', fontSize: '1.05rem', letterSpacing: 0.3, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)' }}>
                        {t('تسجيل الدخول', 'Sign In')}
                    </button>
                    <button className="auth-btn-secondary" onClick={() => setMode('type')} style={{ ...primaryButtonStyle, background: 'rgba(80, 80, 90, 0.2)', border: '1.5px solid rgba(80, 80, 95, 0.12)', backdropFilter: 'blur(20px)', fontSize: '1.05rem', letterSpacing: 0.3, transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)' }}>
                        {t('إنشاء حساب جديد', 'Create Account')}
                    </button>
                    <div style={{ textAlign: 'center', marginTop: 16, opacity: 0.35, fontSize: '0.75rem', lineHeight: 1.6 }}>
                        {t('بالدخول، أنت توافق على الشروط والأحكام', 'By continuing, you agree to our Terms & Privacy Policy')}
                    </div>
                </div>
            </div>
        );
    }

    if (mode === 'type') {
        return (
            <div style={commonContainerStyle}>
                <style>{`
                    @keyframes fadeUp { from{opacity:0;transform:translateY(30px)} to{opacity:1;transform:translateY(0)} }
                    .type-card { transition: all 0.4s cubic-bezier(0.4,0,0.2,1) !important; }
                    .type-card:hover { transform:translateY(-3px); border-color:var(--accent) !important; background:rgba(80, 80, 90, 0.2) !important; box-shadow:0 12px 40px rgba(0,0,0,0.3) !important; }
                `}</style>
                <TopHeader />
                <div style={{ animation: 'fadeUp 0.6s ease-out' }}>
                    <h2 style={{ fontSize: '1.6rem', fontWeight: 900, marginBottom: 8, marginTop: 90, textAlign: 'center', letterSpacing: -0.5 }}>{t('اختر نوع الحساب', 'Choose Account Type')}</h2>
                    <p style={{ opacity: 0.45, textAlign: 'center', fontSize: '0.88rem', marginBottom: 32 }}>{t('كيف تريد استخدام تاكي؟', 'How would you like to use TAKI?')}</p>
                </div>
                <div style={{ width: '100%', maxWidth: 420, display: 'grid', gap: 16, animation: 'fadeUp 0.6s ease-out 0.15s both' }}>
                    <button className="type-card" onClick={() => { setUserType('buyer'); setMode('form'); }} style={{ ...cardStyle, padding: 28, border: '1.5px solid rgba(80, 80, 90, 0.2)' }}>
                        <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, rgba(14,165,233,0.15), rgba(15,23,42,0.1))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.8rem', flexShrink: 0 }}>🛍️</div>
                        <div style={{ textAlign: isRTL ? 'right' : 'left' }}>
                            <div style={{ fontSize: '1.15rem', fontWeight: 800, marginBottom: 4 }}>{t('مشتري', 'Buyer')}</div>
                            <div style={{ fontSize: '0.82rem', opacity: 0.5, lineHeight: 1.5 }}>{t('ابحث عن أفضل العروض واحجزها فوراً', 'Discover & book the best deals')}</div>
                        </div>
                    </button>
                    <button className="type-card" onClick={() => { setUserType('seller'); setMode('form'); }} style={{ ...cardStyle, padding: 28, border: '1.5px solid rgba(80, 80, 90, 0.2)' }}>
                        <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(239,68,68,0.1))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.8rem', flexShrink: 0 }}>🏪</div>
                        <div style={{ textAlign: isRTL ? 'right' : 'left' }}>
                            <div style={{ fontSize: '1.15rem', fontWeight: 800, marginBottom: 4 }}>{t('بائع / متجر', 'Seller / Store')}</div>
                            <div style={{ fontSize: '0.82rem', opacity: 0.5, lineHeight: 1.5 }}>{t('اعرض تخفيضاتك وانمو أعمالك', 'Showcase discounts & grow your business')}</div>
                        </div>
                    </button>
                </div>
            </div>
        );
    }

    if (mode === 'login' || mode === 'form') {
        const isLogin = mode === 'login';

        // Password Validation — explicit light colors (CSS var --accent
        // resolves to near-black slate-800 which is invisible on the dark
        // register gradient).
        const STRONG_GREEN = '#10b981';
        const CHECK_OFF = '#94a3b8';
        let strengthColor = CHECK_OFF;
        let strengthLabel = '';
        if (password.length > 0) {
            if (strengthScore <= 2) { strengthColor = '#ef4444'; strengthLabel = t('ضعيفة', 'Weak'); }
            else if (strengthScore <= 4) { strengthColor = '#f59e0b'; strengthLabel = t('متوسطة', 'Fair'); }
            else { strengthColor = STRONG_GREEN; strengthLabel = t('قوية', 'Strong'); }
        }

        // Email Validation
        const isEmailFormatValid = email.trim().length > 0 && validationService.isValidEmail(email.trim()) && !/[\u0600-\u06FF]/.test(email) && !/\s/.test(email);
        const emailExistsError = emailError === t('الايميل مسجل مسبقا', 'Email is already registered') || emailError === t('⚠️ البريد الإلكتروني مسجل مسبقاً لدينا، الرجاء تسجيل الدخول', '⚠️ Email already registered, please log in');
        const isEmailAvailableState = isEmailFormatValid && !emailChecking && !emailExistsError;

        let emailBoxColor = 'rgba(80, 80, 90, 0.3)';
        if (email.length > 0) {
            if (emailError) { emailBoxColor = '#ef4444'; }
            else if (emailChecking) { emailBoxColor = '#f59e0b'; }
            else if (isEmailFormatValid && isEmailAvailableState) { emailBoxColor = 'var(--accent)'; }
        }

        // Phone Validation
        const isPhoneFormatValid = phone.length === 10 && phone.startsWith('05') && validationService.isValidPhone(phone);
        const phoneExistsError = phoneError === t('الجوال مسجل مسبقا', 'Phone is already registered') || phoneError === t('⚠️ رقم الجوال مسجل مسبقاً لدينا، نرجو تسجيل الدخول', '⚠️ Phone already registered, please log in');
        const isPhoneAvailableState = isPhoneFormatValid && !phoneChecking && !phoneExistsError && !phoneError;

        // Submit logic
        const isPhoneInEmailValid = isLogin && email.length >= 10 && /^\d+$/.test(email);
        const isEmailOrPhoneValid = isLogin ? (isEmailFormatValid || isPhoneInEmailValid) : (isEmailFormatValid && isPhoneFormatValid);

        const hasCriticalError = isLogin
            ? (emailError.includes('جاري') || emailError.includes('checking') || (email.length > 0 && !!emailError && !emailError.includes('مسجل') && !emailError.includes('registered') && !/^\d+$/.test(email)))
            : (!!emailError || !!phoneError);

        const isSubmitDisabled = loading || emailChecking || phoneChecking || hasCriticalError || !password || (isLogin ? false : !isPasswordValid);

        // Login = green glow, Register = navy
        const activeBtnColor = isLogin ? '#10b981' : 'var(--primary)';
        const activeBtnGlow = isLogin ? '0 8px 25px rgba(16, 185, 129, 0.45)' : '0 8px 25px var(--primary-glow)';
        const buttonOpacity = isSubmitDisabled ? 0.4 : 1;

        return (
            <div style={commonContainerStyle}>
                <style>{`
                    @keyframes shakeError {
                        0%, 100% { transform: translateX(0); }
                        20%, 60% { transform: translateX(-4px); }
                        40%, 80% { transform: translateX(4px); }
                    }
                    @keyframes fadeUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
                    @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
                    .inline-error {
                        color: #fca5a5; font-size: 0.82rem; margin-top: 8px; font-weight: 700;
                        background: rgba(239,68,68,0.08); padding: 10px 14px; border-radius: 12px;
                        border: 1px solid rgba(239,68,68,0.2); display: flex; align-items: center; gap: 8px;
                        animation: shakeError 0.4s cubic-bezier(.36,.07,.19,.97) both;
                        backdrop-filter: blur(10px);
                    }
                    .auth-input:focus { border-color: var(--accent) !important; box-shadow: 0 0 0 3px var(--primary-glow) !important; }
                    .auth-submit:hover:not(:disabled) { transform:translateY(-2px); box-shadow:0 8px 30px var(--primary-glow) !important; }
                    .auth-submit:disabled { opacity:0.5; cursor:not-allowed; }
                    .apple-btn:hover { transform:translateY(-1px); box-shadow:0 8px 25px rgba(100, 100, 100, 0.15) !important; }
                `}</style>
                <TopHeader />
                <div style={{ marginTop: 65, maxWidth: 400, width: '100%', animation: 'fadeUp 0.5s ease-out' }}>
                    <div style={{ textAlign: 'center', marginBottom: 28 }}>
                        <h2 style={{ fontSize: '1.6rem', fontWeight: 900, letterSpacing: -0.5, marginBottom: 6 }}>{isLogin ? t('تسجيل الدخول', 'Sign In') : t('إنشاء حساب', 'Create Account')}</h2>
                        <p style={{ opacity: 0.4, fontSize: '0.88rem' }}>{isLogin ? t('أهلاً بعودتك! أدخل تفاصيلك للمتابعة', 'Welcome back! Enter your details to continue') : t('أدخل تفاصيل حسابك للبدء', 'Enter your account details to start')}</p>
                    </div>

                    <button className="google-btn" onClick={authService.signInWithGoogle} style={{ ...methodButtonStyle, background: '#ffffff', color: '#1f1f1f', width: '100%', marginBottom: 10, borderRadius: 14, padding: '15px 20px', border: '1px solid rgba(60, 60, 70, 0.15)', boxShadow: '0 2px 12px rgba(0, 0, 0, 0.18)', transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)' }}>
                        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
                            <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
                            <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
                            <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
                            <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
                        </svg>
                        <span style={{ fontWeight: 800, fontSize: '0.95rem' }}>{t('المتابعة عبر Google', 'Continue with Google')}</span>
                    </button>

                    <button className="apple-btn" onClick={authService.signInWithApple} style={{ ...methodButtonStyle, background: 'rgba(60, 60, 70, 0.95)', color: 'var(--text-primary)', width: '100%', marginBottom: 20, borderRadius: 14, padding: '15px 20px', border: 'none', boxShadow: '0 2px 12px rgba(80, 80, 90, 0.2)', transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)' }}>
                        <span style={{ fontSize: '1.2rem' }}>🍎</span><span style={{ fontWeight: 800, fontSize: '0.95rem' }}>{t('المتابعة عبر أبل', 'Continue with Apple')}</span>
                    </button>

                    <div style={{ display: 'flex', alignItems: 'center', margin: '20px 0', opacity: 0.3 }}>
                        <div style={{ flex: 1, height: 1, background: 'linear-gradient(to right, transparent, rgba(80, 80, 95, 0.4), transparent)' }}></div>
                        <span style={{ margin: '0 16px', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 600 }}>{t('أو', 'OR')}</span>
                        <div style={{ flex: 1, height: 1, background: 'linear-gradient(to right, transparent, rgba(80, 80, 95, 0.4), transparent)' }}></div>
                    </div>

                    <div style={{ display: 'grid', gap: 16 }}>
                        {!isLogin && (
                            <div>
                                <label style={labelStyle}>{t('الاسم الكامل', 'Full Name')} <span style={{ color: '#ef4444' }}>*</span></label>
                                <input value={name} onChange={e => setName(e.target.value)} placeholder={t('محمد أحمد', 'John Doe')} style={inputStyle} />
                            </div>
                        )}

                        <div>
                            <label style={labelStyle}>{isLogin ? t('الجوال أو البريد الإلكتروني', 'Phone or Email') : t('البريد الإلكتروني', 'Email Address')} <span style={{ color: '#ef4444' }}>*</span></label>
                            <div style={{ position: 'relative' }}>
                                <input
                                    value={email}
                                    onChange={handleEmailChange}
                                    onBlur={handleEmailBlur}
                                    placeholder={isLogin ? t('05xxxxxxxx أو user@example.com', '05xxxxxxxx or user@email.com') : 'user@example.com'}
                                    style={{ ...inputStyle, paddingLeft: isRTL ? 40 : 18, paddingRight: isRTL ? 18 : 40, borderColor: emailError ? (emailExistsError ? '#ef4444' : '#f59e0b') : (isEmailAvailableState ? '#10b981' : 'rgba(148, 163, 184, 0.25)'), boxShadow: emailError ? (emailExistsError ? '0 0 0 2px rgba(239,68,68,0.15)' : '0 0 0 2px rgba(245,158,11,0.1)') : (isEmailAvailableState ? '0 0 0 2px rgba(16,185,129,0.18)' : 'none') }}
                                    type={isLogin ? "text" : "email"}
                                    dir="ltr"
                                    autoComplete="email"
                                />
                                {emailChecking && <span style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', [isRTL ? 'left' : 'right']: 14, fontSize: '0.85rem', color: '#f59e0b' }}>⏳</span>}
                                {/* Hide success ✅ during login — the actual sign-in is the
                                    source of truth and an early checkmark felt misleading. */}
                                {!emailChecking && !isLogin && emailSuccess && !emailError && <span style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', [isRTL ? 'left' : 'right']: 14, fontSize: '0.85rem', color: '#10b981' }}>✅</span>}
                                {!emailChecking && !isLogin && emailExistsError && <span style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', [isRTL ? 'left' : 'right']: 14, fontSize: '0.85rem', color: '#ef4444' }}>❌</span>}
                            </div>
                            {emailError && <div className="inline-error">{emailError}</div>}
                            {!isLogin && emailChecking && <div style={{ marginTop: 6, fontSize: '0.78rem', color: '#f59e0b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>⏳ {t('جاري التحقق من التوفر...', 'Checking availability...')}</div>}
                            {!isLogin && isEmailAvailableState && !emailError && <div style={{ marginTop: 6, fontSize: '0.78rem', color: '#10b981', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>✅ {t('البريد متاح وصالح', 'Email is available')}</div>}
                        </div>

                        {!isLogin && (
                            <div>
                                <label style={labelStyle}>{t('رقم الجوال', 'Phone Number')} <span style={{ color: '#ef4444' }}>*</span> <span style={{ opacity: 0.4, fontSize: '0.75rem' }}>{t('(يقبل عربي وإنجليزي)', '(Arabic & English digits)')}</span></label>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type="tel"
                                        value={phone}
                                        onChange={handlePhoneChange}
                                        onBlur={handlePhoneBlur}
                                        placeholder="05xxxxxxxx"
                                        style={{ ...inputStyle, paddingLeft: isRTL ? 40 : 18, paddingRight: isRTL ? 18 : 40, borderColor: phoneError ? (phoneExistsError ? '#ef4444' : '#f59e0b') : (isPhoneAvailableState ? '#10b981' : 'rgba(148, 163, 184, 0.25)'), boxShadow: phoneError ? (phoneExistsError ? '0 0 0 2px rgba(239,68,68,0.15)' : '0 0 0 2px rgba(245,158,11,0.1)') : (isPhoneAvailableState ? '0 0 0 2px rgba(16,185,129,0.18)' : 'none') }}
                                        dir="ltr"
                                        inputMode="numeric"
                                    />
                                    {phoneChecking && <span style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', [isRTL ? 'left' : 'right']: 14, fontSize: '0.85rem', color: '#f59e0b' }}>⏳</span>}
                                    {!phoneChecking && phoneSuccess && !phoneError && <span style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', [isRTL ? 'left' : 'right']: 14, fontSize: '0.85rem', color: '#10b981' }}>✅</span>}
                                    {!phoneChecking && phoneExistsError && <span style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', [isRTL ? 'left' : 'right']: 14, fontSize: '0.85rem', color: '#ef4444' }}>❌</span>}
                                </div>
                                {phoneError && <div className="inline-error">{phoneError}</div>}
                                {phoneChecking && <div style={{ marginTop: 6, fontSize: '0.78rem', color: '#f59e0b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>⏳ {t('جاري التحقق من التوفر...', 'Checking availability...')}</div>}
                                {isPhoneAvailableState && !phoneError && <div style={{ marginTop: 6, fontSize: '0.78rem', color: '#10b981', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>✅ {t('الرقم متاح وصالح', 'Phone is available')}</div>}
                            </div>
                        )}

                        <div>
                            <label style={labelStyle}>{t('كلمة المرور', 'Password')} <span style={{ color: '#ef4444' }}>*</span></label>
                            <div style={{ position: 'relative' }}>
                                <input value={password} onChange={e => setPassword(e.target.value)} type={showPassword ? 'text' : 'password'} placeholder="******" style={{ ...inputStyle, paddingRight: isRTL ? 14 : 45, paddingLeft: isRTL ? 45 : 14 }}
                                    onKeyDown={e => { if (e.key === 'Enter') isLogin ? handleLoginSubmit() : handleProceedToVerify(); }}
                                />
                                <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', [isRTL ? 'left' : 'right']: 10, background: 'none', border: 'none', color: 'var(--gray-400)', fontSize: '1.2rem', cursor: 'pointer', padding: 5, zIndex: 5 }}>
                                    {showPassword ? '👁️' : '👁️‍🗨️'}
                                </button>
                            </div>

                            {isLogin && (
                                <div style={{ marginTop: 10, textAlign: isRTL ? 'left' : 'right' }}>
                                    <button
                                        type="button"
                                        onClick={handleForgotPassword}
                                        disabled={loading}
                                        style={{ background: 'none', border: 'none', color: '#38bdf8', fontSize: '0.82rem', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', padding: '4px 0', textDecoration: 'underline', textUnderlineOffset: 3, opacity: loading ? 0.5 : 1 }}
                                    >
                                        {t('نسيت كلمة المرور؟', 'Forgot password?')}
                                    </button>
                                </div>
                            )}

                            {!isLogin && (
                                <div style={{ marginTop: 12, background: 'rgba(15, 25, 45, 0.5)', padding: 12, borderRadius: 12, border: `1px solid ${password.length > 0 ? strengthColor : 'rgba(148, 163, 184, 0.3)'}`, transition: 'border-color 0.3s' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: '0.85rem', fontWeight: 700 }}>
                                        <span style={{ color: '#e2e8f0' }}>{t('قوة الكلمة:', 'Strength:')}</span>
                                        <span style={{ color: strengthColor, fontWeight: 800 }}>{strengthLabel}</span>
                                    </div>
                                    <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                                        {[1, 2, 3, 4, 5].map(step => (
                                            <div key={step} style={{ height: 4, flex: 1, borderRadius: 2, background: password.length > 0 && step <= strengthScore ? strengthColor : 'rgba(148, 163, 184, 0.25)', transition: 'background 0.3s ease' }} />
                                        ))}
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: '0.8rem', fontWeight: 600 }}>
                                        <div style={{ color: pwCriteria.length ? STRONG_GREEN : CHECK_OFF }}>{pwCriteria.length ? '✅' : '⚪'} {t('8 أحرف فما فوق', '8+ chars')}</div>
                                        <div style={{ color: pwCriteria.uppercase ? STRONG_GREEN : CHECK_OFF }}>{pwCriteria.uppercase ? '✅' : '⚪'} {t('حرف كبير', 'Uppercase')}</div>
                                        <div style={{ color: pwCriteria.lowercase ? STRONG_GREEN : CHECK_OFF }}>{pwCriteria.lowercase ? '✅' : '⚪'} {t('حرف صغير', 'Lowercase')}</div>
                                        <div style={{ color: pwCriteria.number ? STRONG_GREEN : CHECK_OFF }}>{pwCriteria.number ? '✅' : '⚪'} {t('رقم', 'Number')}</div>
                                        <div style={{ color: pwCriteria.special ? STRONG_GREEN : CHECK_OFF, gridColumn: 'span 2' }}>{pwCriteria.special ? '✅' : '⚪'} {t('رمز خاص (@#$!)', 'Symbol (@#$!)')}</div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {!isLogin && userType === 'seller' && (
                            <div>
                                <label style={labelStyle}>{t('اسم المحل', 'Shop Name')} <span style={{ color: '#ef4444' }}>*</span></label>
                                <input value={shopName} onChange={e => setShopName(e.target.value)} placeholder={t('بوتيك الأناقة', 'Elegance Boutique')} style={inputStyle} />
                                <div style={{ marginTop: 8, fontSize: '0.75rem', color: 'rgba(180, 195, 220, 0.6)', lineHeight: 1.5 }}>
                                    {t('📍 سيتم تحديد موقع المتجر لاحقاً من داخل التطبيق', '📍 Store location will be set later from inside the app')}
                                </div>
                            </div>
                        )}

                        <button className="auth-submit" onClick={isLogin ? handleLoginSubmit : handleProceedToVerify} disabled={isSubmitDisabled} style={{ ...primaryButtonStyle, background: isSubmitDisabled ? 'rgba(15,23,42,0.2)' : activeBtnColor, opacity: buttonOpacity, marginTop: 16, cursor: isSubmitDisabled ? 'not-allowed' : 'pointer', boxShadow: isSubmitDisabled ? 'none' : activeBtnGlow, transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)' }}>
                            {loading ? t('جاري المعالجة...', 'Processing...') : isLogin ? t('تسجيل الدخول', 'Sign In') : t('إرسال كود التحقق', 'Send Verification Code')}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (mode === 'verify') {
        return (
            <div style={commonContainerStyle}>
                <style>{`
                    @keyframes fadeUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
                    @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
                    @keyframes pulse2 { 0%,100%{opacity:0.5} 50%{opacity:1} }
                    .verify-btn:hover:not(:disabled) { transform:translateY(-2px); box-shadow:0 8px 30px var(--primary-glow) !important; }
                    .verify-action:hover { background:rgba(80, 80, 95, 0.12) !important; border-color:rgba(80, 80, 95, 0.25) !important; }
                `}</style>
                <TopHeader />
                <div style={{ marginTop: 80, textAlign: 'center', maxWidth: 420, width: '100%', padding: '0 20px', animation: 'fadeUp 0.6s ease-out' }}>
                    <div style={{ fontSize: '4rem', marginBottom: 20, animation: 'float 3s ease-in-out infinite' }}>✉️</div>
                    <h2 style={{ fontSize: '1.7rem', fontWeight: 900, marginBottom: 10, letterSpacing: -0.5 }}>{t('أكد حسابك', 'Confirm Your Account')}</h2>
                    <p style={{ opacity: 0.8, lineHeight: 1.7, marginBottom: 16, fontSize: '0.9rem', color: '#cbd5e1' }}>
                        {t('لقد أرسلنا إليك رابط تحقق إلى:', 'We sent a verification link to:')}<br />
                        <strong style={{ color: '#10b981', fontSize: '1rem' }}>{email}</strong>
                    </p>

                    {/* Bilingual waiting message */}
                    <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.35)', borderRadius: 16, padding: '16px 20px', marginBottom: 28, animation: 'pulse2 3s ease-in-out infinite' }}>
                        <p style={{ color: '#10b981', fontWeight: 700, fontSize: '0.9rem', margin: 0, lineHeight: 1.6 }}>
                            {t('افتح بريدك الإلكتروني واضغط على الرابط للتأكيد', 'Open your email and click the verification link')}
                        </p>
                        <p style={{ color: 'rgba(100, 100, 115, 0.5)', fontSize: '0.78rem', marginTop: 8, lineHeight: 1.5 }}>
                            {t('بمجرد التحقق سيتم تسجيل دخولك تلقائياً — حتى لو فتحت الرابط من تطبيق آخر', 'Once verified, you\'ll be logged in automatically — even if you open the link from another app')}
                        </p>
                    </div>

                    <div style={{ background: 'rgba(80, 80, 90, 0.15)', padding: 28, borderRadius: 24, border: '1px solid rgba(80, 80, 90, 0.2)', marginBottom: 24, backdropFilter: 'blur(20px)' }}>
                        <p style={{ fontSize: '0.88rem', marginBottom: 16, fontWeight: 700, opacity: 0.7 }}>{t('✅ الخيار الأساسي: اضغط على الرابط في الإيميل', '✅ Main option: Click the link in your email')}</p>
                        <div style={{ height: 1, background: 'linear-gradient(to right, transparent, rgba(80, 80, 90, 0.3), transparent)', margin: '16px 0' }} />
                        <p style={{ fontSize: '0.82rem', marginBottom: 14, fontWeight: 600, opacity: 0.5 }}>{t('أو إذا وصلك كود من 6 أرقام أدخله هنا:', 'Or if you received a 6-digit code, enter it here:')}</p>

                        <input
                            autoFocus value={code} onChange={e => {
                                let val = normalizeArabicNumerals(e.target.value).replace(/\D/g, '');
                                setCode(val);
                            }}
                            placeholder="— — — — — —" style={{ ...inputStyle, textAlign: 'center', fontSize: '1.6rem', letterSpacing: 10, fontWeight: 900, marginBottom: 20, padding: '18px', borderRadius: 16, background: 'rgba(80, 80, 90, 0.2)' }}
                            maxLength={6}
                            onKeyDown={e => { if (e.key === 'Enter') handleVerifySubmit(); }}
                        />

                        <button className="verify-btn" onClick={handleVerifySubmit} disabled={loading} style={{ ...primaryButtonStyle, opacity: loading ? 0.6 : 1, boxShadow: '0 4px 20px var(--primary-glow)', transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)' }}>
                            {loading ? t('جاري التحقق...', 'Verifying...') : t('تأكيد الكود الرقمي', 'Confirm Code')}
                        </button>
                    </div>

                    <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                        <button
                            className="verify-action"
                            onClick={handleResendVerification}
                            disabled={resending}
                            style={{ flex: 1, padding: '14px', borderRadius: 14, background: 'rgba(80, 80, 90, 0.2)', border: '1px solid rgba(80, 80, 90, 0.2)', color: '#38bdf8', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', opacity: resending ? 0.5 : 1, backdropFilter: 'blur(10px)', transition: 'all 0.3s' }}
                        >
                            {resending ? '⏳...' : t('📧 إعادة إرسال', '📧 Resend Code')}
                        </button>
                        <button
                            className="verify-action"
                            onClick={() => window.location.reload()}
                            style={{ flex: 1, padding: '14px', borderRadius: 14, background: 'rgba(80, 80, 90, 0.2)', border: '1px solid rgba(80, 80, 90, 0.2)', color: 'rgba(150, 150, 150, 0.8)', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', backdropFilter: 'blur(10px)', transition: 'all 0.3s' }}
                        >
                            {t('🔄 تحديث', '🔄 Refresh')}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return null;
};

const cardStyle: React.CSSProperties = { padding: 28, border: '1px solid rgba(80, 80, 90, 0.2)', borderRadius: 28, background: 'rgba(80, 80, 90, 0.15)', backdropFilter: 'blur(24px) saturate(180%)', color: 'white', display: 'flex', alignItems: 'center', gap: 20, transition: 'all 0.4s cubic-bezier(0.4,0,0.2,1)', cursor: 'pointer', WebkitBackdropFilter: 'blur(24px) saturate(180%)' };
const methodButtonStyle: React.CSSProperties = { padding: '16px 20px', borderRadius: 18, border: '1px solid rgba(80, 80, 90, 0.2)', background: 'rgba(80, 80, 90, 0.2)', backdropFilter: 'blur(20px)', color: 'white', fontWeight: 700, fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, transition: 'all 0.3s ease', cursor: 'pointer' };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: '0.82rem', marginBottom: 8, opacity: 0.55, fontWeight: 500, letterSpacing: 0.3 };
const inputStyle: React.CSSProperties = { width: '100%', padding: '15px 18px', borderRadius: 14, background: 'rgba(80, 80, 90, 0.2)', border: '1.5px solid rgba(80, 80, 90, 0.2)', color: 'white', outline: 'none', backdropFilter: 'blur(10px)', transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)', fontSize: '0.95rem', fontFamily: 'inherit' };
const primaryButtonStyle: React.CSSProperties = { width: '100%', padding: 17, borderRadius: 16, background: 'var(--primary)', color: 'white', border: 'none', fontWeight: 800, fontSize: '1.05rem', transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)', cursor: 'pointer', letterSpacing: 0.3 };

export default Register;