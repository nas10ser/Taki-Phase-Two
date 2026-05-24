/**
 * AccountSettingsCard v11.19 — self-service edit for name / phone / email /
 * password. Drops into the Profile "Settings" tab and works for every role
 * (buyer, seller, admin) since every account has these four attributes.
 *
 * Where each write goes:
 *  - name, phone, shop  → updateProfile (partial-aware saveProfile)
 *  - email              → supabase.auth.updateUser({email}) — Supabase
 *    sends a double-confirmation (old + new) before the change settles
 *  - password           → supabase.auth.updateUser({password}) — the user
 *    must re-enter the current password; we sign in once with the current
 *    password to revalidate before applying the new one
 *
 * The card is intentionally collapsible per-section so the buyer who just
 * wants to change their phone doesn't see four open forms at once.
 */
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../services/supabaseClient';
import { normalizeArabicNumerals } from '../utils/helpers';

type Section = 'name' | 'phone' | 'email' | 'password' | null;

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
    const [newPw, setNewPw] = useState('');
    const [confirmPw, setConfirmPw] = useState('');

    if (!user) return null;

    const close = () => {
        setOpen(null);
        setCurrentPw(''); setNewPw(''); setConfirmPw('');
    };

    const saveName = async () => {
        if (busy) return;
        const trimmed = name.trim();
        if (!trimmed) { await customAlert(isRTL ? 'الاسم لا يمكن أن يكون فارغاً' : 'Name cannot be empty'); return; }
        setBusy(true);
        try {
            const patch: any = { name: trimmed };
            if (user.userType === 'seller') patch.shop = shop.trim() || user.shop;
            await updateProfile(patch);
            await customAlert(isRTL ? '✅ تم حفظ الاسم' : '✅ Name saved');
            close();
        } catch (e: any) {
            await customAlert((isRTL ? 'فشل الحفظ: ' : 'Save failed: ') + (e?.message || ''));
        } finally { setBusy(false); }
    };

    const savePhone = async () => {
        if (busy) return;
        const cleaned = normalizeArabicNumerals(phone).replace(/\D/g, '');
        if (!/^05\d{8}$/.test(cleaned)) {
            await customAlert(isRTL ? 'رقم الجوال يجب أن يبدأ بـ 05 ويتكون من 10 أرقام' : 'Phone must start with 05 and be 10 digits');
            return;
        }
        setBusy(true);
        try {
            await updateProfile({ phone: cleaned, contactPhone: cleaned });
            await customAlert(isRTL ? '✅ تم حفظ رقم الجوال' : '✅ Phone saved');
            close();
        } catch (e: any) {
            await customAlert((isRTL ? 'فشل الحفظ: ' : 'Save failed: ') + (e?.message || ''));
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
            // Supabase sends two confirmation emails — one to the old
            // address and one to the new. The change only settles after
            // both are clicked. We surface that explicitly.
            const { error } = await supabase.auth.updateUser({ email: cleaned });
            if (error) throw error;
            // Mirror in our `users` table immediately so the seller page,
            // admin search etc. read the new email without waiting for the
            // auth-triggered DB sync.
            await updateProfile({ email: cleaned });
            await customAlert(
                isRTL
                    ? `📧 أُرسلت رسالة تأكيد إلى:\n- إيميلك القديم (${user.email})\n- إيميلك الجديد (${cleaned})\n\nاضغط الرابط في الاثنين لإتمام التغيير.`
                    : `📧 Confirmation emails were sent to:\n- your old address (${user.email})\n- your new address (${cleaned})\n\nClick the link in both to finalize the change.`
            );
            close();
        } catch (e: any) {
            await customAlert((isRTL ? 'فشل تحديث الإيميل: ' : 'Email update failed: ') + (e?.message || ''));
        } finally { setBusy(false); }
    };

    const savePassword = async () => {
        if (busy) return;
        if (newPw.length < 8) {
            await customAlert(isRTL ? 'كلمة السر يجب أن تكون 8 أحرف على الأقل' : 'Password must be at least 8 characters');
            return;
        }
        if (newPw !== confirmPw) {
            await customAlert(isRTL ? 'كلمتا السر غير متطابقتين' : 'Passwords do not match');
            return;
        }
        if (!currentPw) {
            await customAlert(isRTL ? 'أدخل كلمة السر الحالية للتحقق' : 'Enter current password to verify');
            return;
        }
        setBusy(true);
        try {
            // Revalidate the current password by signing in again. Without
            // this, anyone with a stolen unlocked session could rotate the
            // password — the equivalent of a session hijack becoming
            // permanent account takeover.
            if (user.email) {
                const { error: reauthErr } = await supabase.auth.signInWithPassword({
                    email: user.email,
                    password: currentPw,
                });
                if (reauthErr) {
                    throw new Error(isRTL ? 'كلمة السر الحالية غير صحيحة' : 'Current password is incorrect');
                }
            }
            const { error } = await supabase.auth.updateUser({ password: newPw });
            if (error) throw error;
            await customAlert(isRTL ? '✅ تم تغيير كلمة السر' : '✅ Password changed');
            close();
        } catch (e: any) {
            await customAlert((isRTL ? 'فشل التغيير: ' : 'Change failed: ') + (e?.message || ''));
        } finally { setBusy(false); }
    };

    const Row = ({ id, icon, label, value, action }: { id: Section; icon: string; label: string; value: string; action: string; }) => (
        <button
            onClick={() => setOpen(open === id ? null : id)}
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
                        <input value={name} onChange={e => setName(e.target.value)} placeholder={isRTL ? 'الاسم الجديد' : 'New name'} style={inputStyle} />
                        {user.userType === 'seller' && (
                            <input value={shop} onChange={e => setShop(e.target.value)} placeholder={isRTL ? 'اسم المتجر' : 'Shop name'} style={inputStyle} />
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
                            style={inputStyle}
                        />
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                            {isRTL ? 'يبدأ بـ 05 ويتكون من 10 أرقام' : 'Starts with 05, 10 digits total'}
                        </div>
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
                        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" style={inputStyle} />
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 700, lineHeight: 1.6 }}>
                            {isRTL
                                ? '⚠️ سيرسل Supabase رابط تأكيد إلى إيميلك القديم وإيميلك الجديد. التغيير لا يفعل إلا بعد ضغط الرابطين.'
                                : '⚠️ Supabase sends a confirmation link to both your old and new email. The change settles only after both links are clicked.'}
                        </div>
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
                        <input
                            type="password"
                            value={currentPw}
                            onChange={e => setCurrentPw(e.target.value)}
                            placeholder={isRTL ? 'كلمة السر الحالية' : 'Current password'}
                            autoComplete="current-password"
                            style={inputStyle}
                        />
                        <input
                            type="password"
                            value={newPw}
                            onChange={e => setNewPw(e.target.value)}
                            placeholder={isRTL ? 'كلمة السر الجديدة (8 أحرف على الأقل)' : 'New password (8+ chars)'}
                            autoComplete="new-password"
                            style={inputStyle}
                        />
                        <input
                            type="password"
                            value={confirmPw}
                            onChange={e => setConfirmPw(e.target.value)}
                            placeholder={isRTL ? 'تأكيد كلمة السر الجديدة' : 'Confirm new password'}
                            autoComplete="new-password"
                            style={inputStyle}
                        />
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
