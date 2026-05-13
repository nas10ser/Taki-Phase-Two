import React, { useEffect, useState, useCallback } from 'react';
import { useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { authService } from '../services/authService';
import { validationService } from '../services/validationService';
import { normalizeArabicNumerals } from '../utils/helpers';
import { supabase } from '../services/supabaseClient';

// Shown after a user signs in via Google/Apple OAuth. The OAuth provider
// gives us email + name but never the Saudi phone number, the buyer/seller
// choice, or the shop name — so we collect those here before letting the
// user into the rest of the app. Existing email/password users skip this
// screen entirely because they fill the same fields during /register.
const CompleteProfile: React.FC = () => {
    const history = useHistory();
    const { user, language, customAlert, updateProfile } = useApp();
    const isRTL = language === 'ar';
    const t = useCallback((ar: string, en: string) => (isRTL ? ar : en), [isRTL]);

    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [userType, setUserType] = useState<'buyer' | 'seller' | ''>('');
    const [shopName, setShopName] = useState('');
    const [phoneError, setPhoneError] = useState('');
    const [phoneChecking, setPhoneChecking] = useState(false);
    const [loading, setLoading] = useState(false);

    // Match the Register page background so iOS rubber-band overscroll
    // doesn't expose the light --body-bg behind the navy gradient.
    useEffect(() => {
        const prevHtmlBg = document.documentElement.style.background;
        const prevBodyBg = document.body.style.background;
        document.documentElement.style.background = '#050a18';
        document.body.style.background = '#050a18';
        return () => {
            document.documentElement.style.background = prevHtmlBg;
            document.body.style.background = prevBodyBg;
        };
    }, []);

    // If no session, bounce to /register. Profile-complete users skip this screen.
    useEffect(() => {
        if (!user) {
            history.replace('/register');
            return;
        }
        const hasPhone = !!user.phone && user.phone.length >= 9;
        const hasShop = user.userType !== 'seller' || !!user.shop;
        if (hasPhone && hasShop) {
            history.replace(user.userType === 'admin' ? '/admin' : user.userType === 'seller' ? '/seller' : '/');
        }
    }, [user, history]);

    // Prefill name from the OAuth provider's metadata so the user doesn't
    // have to retype it. We still let them edit before submitting.
    useEffect(() => {
        if (user?.name && user.name !== 'مستخدم' && !name) {
            setName(user.name);
        }
    }, [user, name]);

    const isPasswordRequired = false; // OAuth flow — no password collected here
    const isPhoneFormatValid = phone.length === 10 && phone.startsWith('05') && validationService.isValidPhone(phone);

    const handlePhoneChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const digits = normalizeArabicNumerals(e.target.value).replace(/\D/g, '').slice(0, 10);
        setPhone(digits);
        if (digits.length === 0) { setPhoneError(''); return; }
        if (digits.length < 10) { setPhoneError(t('⚠️ يجب أن يتكون من 10 أرقام', '⚠️ Must be 10 digits')); return; }
        if (!digits.startsWith('05')) { setPhoneError(t('⚠️ يجب أن يبدأ بـ 05', '⚠️ Must start with 05')); return; }
        setPhoneError('');
    }, [t]);

    const handlePhoneBlur = useCallback(async () => {
        if (!isPhoneFormatValid) return;
        setPhoneChecking(true);
        try {
            const exists = await authService.checkPhoneExists(phone);
            if (exists) {
                setPhoneError(t('الجوال مسجل مسبقا', 'Phone is already registered'));
            }
        } catch {
            // ignore — final check happens on submit
        } finally {
            setPhoneChecking(false);
        }
    }, [phone, isPhoneFormatValid, t]);

    const handleSubmit = async () => {
        if (!name.trim()) {
            await customAlert(t('يرجى إدخال الاسم الكامل', 'Please enter your full name'));
            return;
        }
        if (!userType) {
            await customAlert(t('يرجى اختيار نوع الحساب', 'Please choose account type'));
            return;
        }
        if (!isPhoneFormatValid) {
            setPhoneError(t('⚠️ رقم جوال غير صحيح', '⚠️ Invalid phone'));
            return;
        }
        if (userType === 'seller' && !shopName.trim()) {
            await customAlert(t('يرجى إدخال اسم المحل', 'Please enter the shop name'));
            return;
        }

        setLoading(true);
        try {
            // Phone uniqueness must be checked at submit time too — the user
            // could have left the field, come back later, and the debounced
            // blur check might have been stale.
            const phoneTaken = await authService.checkPhoneExists(phone);
            if (phoneTaken) {
                setPhoneError(t('الجوال مسجل مسبقا', 'Phone is already registered'));
                setLoading(false);
                return;
            }

            // Save to public.users via the partial-aware repository.
            await updateProfile({
                name: validationService.sanitizeText(name, 50),
                phone,
                userType: userType as 'buyer' | 'seller',
                shop: userType === 'seller' ? validationService.sanitizeText(shopName, 80) : undefined,
                contactPhone: phone,
            });

            // Mirror into auth user_metadata so the next session restore
            // (and any trigger reading from raw_user_meta_data) sees the
            // canonical values. The DB row is authoritative either way.
            await supabase.auth.updateUser({
                data: {
                    name,
                    phone,
                    user_type: userType,
                    shop: userType === 'seller' ? shopName : null,
                }
            });

            await customAlert(t('✅ تم إكمال البيانات بنجاح!', '✅ Profile completed successfully!'));
            history.replace(userType === 'seller' ? '/seller' : '/');
        } catch (err: any) {
            await customAlert(t(`خطأ: ${err?.message || err}`, `Error: ${err?.message || err}`));
        } finally {
            setLoading(false);
        }
    };

    const containerStyle: React.CSSProperties = {
        minHeight: '100vh',
        background: 'linear-gradient(160deg, #050a18 0%, #0a1628 30%, #0f1f3a 60%, #081020 100%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: 24, color: 'white',
        direction: isRTL ? 'rtl' : 'ltr',
        fontFamily: 'Tajawal, system-ui, -apple-system, sans-serif',
    };

    const labelStyle: React.CSSProperties = {
        display: 'block', fontSize: '0.82rem', marginBottom: 8,
        opacity: 0.7, fontWeight: 500, letterSpacing: 0.3, color: '#cbd5e1'
    };
    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '15px 18px', borderRadius: 14,
        background: 'rgba(80, 80, 90, 0.2)', border: '1.5px solid rgba(148, 163, 184, 0.25)',
        color: 'white', outline: 'none', fontSize: '0.95rem', fontFamily: 'inherit'
    };
    const typeCardStyle = (active: boolean): React.CSSProperties => ({
        flex: 1, padding: 18, borderRadius: 16,
        background: active ? 'rgba(16, 185, 129, 0.12)' : 'rgba(80, 80, 90, 0.18)',
        border: `1.5px solid ${active ? '#10b981' : 'rgba(148, 163, 184, 0.25)'}`,
        color: 'white', cursor: 'pointer', textAlign: 'center',
        fontWeight: 700, transition: 'all 0.2s'
    });

    const submitDisabled = loading || phoneChecking || !!phoneError || !name.trim() || !userType || !isPhoneFormatValid || (userType === 'seller' && !shopName.trim());

    return (
        <div style={containerStyle}>
            <div style={{ maxWidth: 420, width: '100%', marginTop: 40 }}>
                <div style={{ textAlign: 'center', marginBottom: 28 }}>
                    <div style={{ fontSize: '3rem', marginBottom: 8 }}>👋</div>
                    <h2 style={{ fontSize: '1.6rem', fontWeight: 900, letterSpacing: -0.5, marginBottom: 6 }}>
                        {t('أكمل بياناتك', 'Complete your profile')}
                    </h2>
                    <p style={{ opacity: 0.6, fontSize: '0.9rem', lineHeight: 1.6 }}>
                        {t('سجلت الدخول بنجاح! نحتاج بعض المعلومات الإضافية لاستكمال حسابك.',
                           'You\'re signed in! We need a few extra details to finish setting up your account.')}
                    </p>
                </div>

                <div style={{ display: 'grid', gap: 16 }}>
                    <div>
                        <label style={labelStyle}>{t('الاسم الكامل', 'Full Name')} <span style={{ color: '#ef4444' }}>*</span></label>
                        <input value={name} onChange={e => setName(e.target.value)}
                               placeholder={t('محمد أحمد', 'John Doe')} style={inputStyle} />
                    </div>

                    <div>
                        <label style={labelStyle}>{t('نوع الحساب', 'Account Type')} <span style={{ color: '#ef4444' }}>*</span></label>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button type="button" onClick={() => setUserType('buyer')} style={typeCardStyle(userType === 'buyer')}>
                                <div style={{ fontSize: '1.4rem', marginBottom: 4 }}>🛍️</div>
                                {t('مشتري', 'Buyer')}
                            </button>
                            <button type="button" onClick={() => setUserType('seller')} style={typeCardStyle(userType === 'seller')}>
                                <div style={{ fontSize: '1.4rem', marginBottom: 4 }}>🏪</div>
                                {t('بائع / متجر', 'Seller')}
                            </button>
                        </div>
                    </div>

                    <div>
                        <label style={labelStyle}>{t('رقم الجوال', 'Phone Number')} <span style={{ color: '#ef4444' }}>*</span></label>
                        <input type="tel" value={phone} onChange={handlePhoneChange} onBlur={handlePhoneBlur}
                               placeholder="05xxxxxxxx" inputMode="numeric" dir="ltr"
                               style={{ ...inputStyle, borderColor: phoneError ? '#ef4444' : (isPhoneFormatValid && !phoneChecking ? '#10b981' : 'rgba(148, 163, 184, 0.25)') }} />
                        {phoneError && (
                            <div style={{ marginTop: 8, fontSize: '0.82rem', color: '#fca5a5', fontWeight: 700,
                                background: 'rgba(239,68,68,0.08)', padding: '10px 14px', borderRadius: 12,
                                border: '1px solid rgba(239,68,68,0.2)' }}>
                                {phoneError}
                            </div>
                        )}
                        {phoneChecking && (
                            <div style={{ marginTop: 6, fontSize: '0.78rem', color: '#f59e0b', fontWeight: 600 }}>
                                ⏳ {t('جاري التحقق من التوفر...', 'Checking availability...')}
                            </div>
                        )}
                    </div>

                    {userType === 'seller' && (
                        <div>
                            <label style={labelStyle}>{t('اسم المحل', 'Shop Name')} <span style={{ color: '#ef4444' }}>*</span></label>
                            <input value={shopName} onChange={e => setShopName(e.target.value)}
                                   placeholder={t('بوتيك الأناقة', 'Elegance Boutique')} style={inputStyle} />
                            <div style={{ marginTop: 8, fontSize: '0.75rem', color: 'rgba(180, 195, 220, 0.6)', lineHeight: 1.5 }}>
                                {t('📍 سيتم تحديد موقع المتجر لاحقاً من داخل التطبيق',
                                   '📍 Store location will be set later from inside the app')}
                            </div>
                        </div>
                    )}

                    <button onClick={handleSubmit} disabled={submitDisabled}
                            style={{
                                width: '100%', padding: 17, borderRadius: 16,
                                background: submitDisabled ? 'rgba(15,23,42,0.3)' : 'var(--primary)',
                                color: 'white', border: 'none', fontWeight: 800, fontSize: '1.05rem',
                                marginTop: 16, cursor: submitDisabled ? 'not-allowed' : 'pointer',
                                boxShadow: submitDisabled ? 'none' : '0 8px 25px var(--primary-glow)',
                                opacity: submitDisabled ? 0.5 : 1, transition: 'all 0.3s'
                            }}>
                        {loading ? t('جاري الحفظ...', 'Saving...') : t('متابعة', 'Continue')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CompleteProfile;
