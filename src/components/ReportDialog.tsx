import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../context/AppContext';
import { reportRepository, ReportType, Role } from '../repositories/reportRepository';

/**
 * Reusable report dialog (buyer↔merchant only — enforced server-side by
 * tr_guard_report_insert). Opened from StoreDetails (buyer → seller) and
 * the seller dashboard order cards (seller → buyer). Reason is required;
 * the type chips give the admin Reports center something to filter on.
 */

type Props = {
    reportedId: string;
    reportedRole: Role;
    reportedName?: string;
    isRTL: boolean;
    onClose: () => void;
};

const TYPES: { key: ReportType; ar: string; en: string }[] = [
    { key: 'scam',          ar: 'احتيال أو نصب',        en: 'Scam / fraud' },
    { key: 'no_show',       ar: 'لم يحضر / لم يلتزم',     en: 'No-show / no commitment' },
    { key: 'harassment',    ar: 'تحرّش أو إساءة',         en: 'Harassment / abuse' },
    { key: 'inappropriate', ar: 'محتوى غير لائق',        en: 'Inappropriate content' },
    { key: 'spam',          ar: 'إزعاج / رسائل مزعجة',    en: 'Spam' },
    { key: 'other',         ar: 'أخرى',                  en: 'Other' },
];

const ReportDialog: React.FC<Props> = ({ reportedId, reportedRole, reportedName, isRTL, onClose }) => {
    const { user, customAlert } = useApp();
    const [type, setType] = useState<ReportType>('scam');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);

    const reporterRole = (user?.userType === 'seller' ? 'seller' : 'buyer') as Role;

    const submit = async () => {
        if (busy) return;
        const trimmed = reason.trim();
        if (trimmed.length < 5) {
            customAlert(isRTL ? '⚠️ اكتب سبب البلاغ (5 أحرف على الأقل).' : '⚠️ Please write a reason (min 5 chars).');
            return;
        }
        if (!user?.id) {
            customAlert(isRTL ? '⚠️ سجّل الدخول أولاً.' : '⚠️ Please sign in first.');
            return;
        }
        setBusy(true);
        const res = await reportRepository.create({
            reporterId: user.id,
            reporterRole,
            reportedId,
            reportedRole,
            reportType: type,
            reason: trimmed,
        });
        setBusy(false);
        if (res.ok) {
            onClose();
            customAlert(isRTL
                ? '✅ تم إرسال البلاغ للإدارة. شكراً لمساعدتنا في حماية مجتمع تاكي.'
                : '✅ Report sent to the admin. Thanks for helping keep TAKI safe.');
            return;
        }
        const msg = (() => {
            switch (res.code) {
                case 'same_role':
                    return isRTL
                        ? '❌ لا يمكن الإبلاغ عن حساب من نفس نوع حسابك.'
                        : '❌ You cannot report an account of the same type as yours.';
                case 'self':
                    return isRTL ? '❌ لا يمكنك الإبلاغ عن نفسك.' : '❌ You cannot report yourself.';
                case 'role_not_allowed':
                case 'invalid':
                    return isRTL ? '❌ لا يمكن الإبلاغ عن هذا الحساب.' : '❌ This account cannot be reported.';
                case 'forbidden':
                    return isRTL ? '❌ ليست لديك صلاحية إرسال هذا البلاغ.' : '❌ You are not allowed to send this report.';
                default:
                    return isRTL
                        ? '❌ تعذّر إرسال البلاغ. تحقق من الاتصال وحاول مرة أخرى.'
                        : '❌ Could not send the report. Check your connection and try again.';
            }
        })();
        customAlert(msg);
    };

    const overlay = (
        <div
            dir={isRTL ? 'rtl' : 'ltr'}
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 100000,
                background: 'rgba(0,0,0,0.55)',
                display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                WebkitTapHighlightColor: 'transparent',
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: 'var(--card-bg, #fff)', color: 'var(--text-primary, #111)',
                    width: '100%', maxWidth: 520,
                    borderTopLeftRadius: 24, borderTopRightRadius: 24,
                    padding: 20,
                    paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
                    boxShadow: '0 -8px 30px rgba(0,0,0,0.25)',
                    maxHeight: '88vh', overflowY: 'auto',
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <h3 style={{ margin: 0, fontWeight: 900, fontSize: '1.05rem' }}>
                        🚩 {isRTL ? 'إبلاغ عن' : 'Report'} {reportedName ? `«${reportedName}»` : ''}
                    </h3>
                    <button type="button" onClick={onClose} aria-label={isRTL ? 'إغلاق' : 'Close'}
                        style={{ background: 'var(--body-bg,#eee)', border: 'none', borderRadius: '50%', width: 32, height: 32, fontWeight: 900, cursor: 'pointer', color: 'var(--text-primary,#111)' }}>
                        ✕
                    </button>
                </div>
                <p style={{ marginTop: 0, marginBottom: 14, fontSize: '0.8rem', color: 'var(--text-secondary, #666)', fontWeight: 600, lineHeight: 1.7 }}>
                    {isRTL
                        ? 'بلاغك سرّي ويُراجَع من الإدارة. الإبلاغ الكيدي قد يُعرّض حسابك للمراجعة.'
                        : 'Your report is confidential and reviewed by the admin. Abusive reporting may put your own account under review.'}
                </p>

                <div style={{ fontWeight: 800, fontSize: '0.85rem', marginBottom: 8 }}>
                    {isRTL ? 'نوع البلاغ' : 'Report type'}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                    {TYPES.map(t => {
                        const active = type === t.key;
                        return (
                            <button key={t.key} type="button" onClick={() => setType(t.key)}
                                style={{
                                    padding: '8px 14px', borderRadius: 999,
                                    border: active ? '2px solid var(--primary)' : '1.5px solid var(--gray-200, #ddd)',
                                    background: active ? 'var(--primary)' : 'transparent',
                                    color: active ? '#fff' : 'var(--text-primary, #111)',
                                    fontWeight: 800, fontSize: '0.8rem', cursor: 'pointer',
                                }}>
                                {isRTL ? t.ar : t.en}
                            </button>
                        );
                    })}
                </div>

                <div style={{ fontWeight: 800, fontSize: '0.85rem', marginBottom: 8 }}>
                    {isRTL ? 'تفاصيل السبب' : 'Reason details'}
                </div>
                <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={isRTL ? 'اشرح ما حدث بالتفصيل…' : 'Describe what happened…'}
                    style={{
                        width: '100%', minHeight: 110, padding: 14, borderRadius: 14,
                        border: '1.5px solid var(--gray-200, #ddd)', background: 'var(--body-bg, #f7f7f7)',
                        color: 'var(--text-primary, #111)', outline: 'none', resize: 'vertical',
                        fontSize: '0.9rem', fontFamily: 'inherit',
                    }}
                />

                <button type="button" onClick={submit} disabled={busy}
                    style={{
                        marginTop: 16, width: '100%', padding: 15, borderRadius: 14,
                        background: busy ? 'var(--gray-400, #999)' : '#dc2626', color: '#fff',
                        fontWeight: 900, fontSize: '1rem', border: 'none',
                        cursor: busy ? 'default' : 'pointer',
                    }}>
                    {busy
                        ? (isRTL ? '⏳ جاري الإرسال…' : '⏳ Sending…')
                        : (isRTL ? '🚩 إرسال البلاغ' : '🚩 Send report')}
                </button>
            </div>
        </div>
    );

    return createPortal(overlay, document.body);
};

export default ReportDialog;
