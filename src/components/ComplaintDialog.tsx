import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../context/AppContext';
import { complaintRepository, ComplaintCategory } from '../repositories/complaintRepository';

/**
 * User-facing complaint form (#3). Opened from the side menu. Writes to
 * `complaints`, which surfaces in the admin Reports & Complaints center
 * (not email-only — the owner reviews everything there).
 */

type Props = { isRTL: boolean; onClose: () => void };

const CATS: { key: ComplaintCategory; ar: string; en: string }[] = [
    { key: 'app_issue',   ar: 'مشكلة في التطبيق', en: 'App issue' },
    { key: 'store_issue', ar: 'مشكلة مع متجر',     en: 'Store issue' },
    { key: 'payment',     ar: 'دفع / سعر',         en: 'Payment / price' },
    { key: 'suggestion',  ar: 'اقتراح / تحسين',    en: 'Suggestion' },
    { key: 'other',       ar: 'أخرى',              en: 'Other' },
];

const ComplaintDialog: React.FC<Props> = ({ isRTL, onClose }) => {
    const { user, customAlert } = useApp();
    const [cat, setCat] = useState<ComplaintCategory>('app_issue');
    const [subject, setSubject] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        if (busy) return;
        const msg = message.trim();
        if (msg.length < 5) {
            customAlert(isRTL ? '⚠️ اكتب تفاصيل الشكوى (5 أحرف على الأقل).' : '⚠️ Please describe your complaint (min 5 chars).');
            return;
        }
        if (!user?.id) {
            customAlert(isRTL ? '⚠️ سجّل الدخول أولاً.' : '⚠️ Please sign in first.');
            return;
        }
        setBusy(true);
        const res = await complaintRepository.create({
            userId: user.id,
            userRole: user.userType,
            category: cat,
            subject,
            message: msg,
        });
        setBusy(false);
        if (res.ok) {
            onClose();
            customAlert(isRTL
                ? '✅ تم إرسال شكواك للإدارة. سنراجعها ونتواصل معك إن لزم.'
                : '✅ Your complaint was sent to the admin. We will review it.');
        } else {
            customAlert(isRTL
                ? '❌ تعذّر الإرسال. تحقق من الاتصال وحاول مرة أخرى.'
                : '❌ Could not send. Check your connection and try again.');
        }
    };

    const overlay = (
        <div dir={isRTL ? 'rtl' : 'ltr'} onClick={onClose}
            style={{ position: 'fixed', inset: 0, zIndex: 100001, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <div onClick={(e) => e.stopPropagation()}
                style={{
                    background: 'var(--card-bg, #fff)', color: 'var(--text-primary, #111)',
                    width: '100%', maxWidth: 520, borderTopLeftRadius: 24, borderTopRightRadius: 24,
                    padding: 20, paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
                    boxShadow: '0 -8px 30px rgba(0,0,0,0.25)', maxHeight: '88vh', overflowY: 'auto',
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <h3 style={{ margin: 0, fontWeight: 900, fontSize: '1.05rem' }}>
                        📣 {isRTL ? 'إرسال شكوى للإدارة' : 'Send a complaint'}
                    </h3>
                    <button type="button" onClick={onClose} aria-label={isRTL ? 'إغلاق' : 'Close'}
                        style={{ background: 'var(--body-bg,#eee)', border: 'none', borderRadius: '50%', width: 32, height: 32, fontWeight: 900, cursor: 'pointer', color: 'var(--text-primary,#111)' }}>
                        ✕
                    </button>
                </div>
                <p style={{ marginTop: 0, marginBottom: 14, fontSize: '0.8rem', color: 'var(--text-secondary, #666)', fontWeight: 600, lineHeight: 1.7 }}>
                    {isRTL
                        ? 'شكواك تصل الإدارة مباشرة وتُراجَع من مركز التحكم.'
                        : 'Your complaint goes straight to the admin and is reviewed in the control center.'}
                </p>

                <div style={{ fontWeight: 800, fontSize: '0.85rem', marginBottom: 8 }}>{isRTL ? 'النوع' : 'Category'}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                    {CATS.map(c => {
                        const active = cat === c.key;
                        return (
                            <button key={c.key} type="button" onClick={() => setCat(c.key)}
                                style={{
                                    padding: '8px 14px', borderRadius: 999,
                                    border: active ? '2px solid var(--primary)' : '1.5px solid var(--gray-200, #ddd)',
                                    background: active ? 'var(--primary)' : 'transparent',
                                    color: active ? '#fff' : 'var(--text-primary, #111)',
                                    fontWeight: 800, fontSize: '0.8rem', cursor: 'pointer',
                                }}>
                                {isRTL ? c.ar : c.en}
                            </button>
                        );
                    })}
                </div>

                <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder={isRTL ? 'العنوان (اختياري)' : 'Subject (optional)'}
                    style={{
                        width: '100%', padding: 13, borderRadius: 12, marginBottom: 10,
                        border: '1.5px solid var(--gray-200, #ddd)', background: 'var(--body-bg, #f7f7f7)',
                        color: 'var(--text-primary, #111)', outline: 'none', fontSize: '0.9rem', fontFamily: 'inherit',
                    }}
                />
                <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={isRTL ? 'اكتب تفاصيل شكواك…' : 'Describe your complaint…'}
                    style={{
                        width: '100%', minHeight: 120, padding: 14, borderRadius: 14,
                        border: '1.5px solid var(--gray-200, #ddd)', background: 'var(--body-bg, #f7f7f7)',
                        color: 'var(--text-primary, #111)', outline: 'none', resize: 'vertical',
                        fontSize: '0.9rem', fontFamily: 'inherit',
                    }}
                />

                <button type="button" onClick={submit} disabled={busy}
                    style={{
                        marginTop: 16, width: '100%', padding: 15, borderRadius: 14,
                        background: busy ? 'var(--gray-400, #999)' : 'var(--primary)', color: '#fff',
                        fontWeight: 900, fontSize: '1rem', border: 'none', cursor: busy ? 'default' : 'pointer',
                    }}>
                    {busy
                        ? (isRTL ? '⏳ جاري الإرسال…' : '⏳ Sending…')
                        : (isRTL ? '📣 إرسال الشكوى' : '📣 Send complaint')}
                </button>
            </div>
        </div>
    );

    return createPortal(overlay, document.body);
};

export default ComplaintDialog;
