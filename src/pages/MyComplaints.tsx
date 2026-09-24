/**
 * MyComplaints — «شكاواي» (v14.92)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 هذه الشاشة **لم تكن موجودة إطلاقاً**. كان المستخدم يرسل شكواه فيقرأ
 *    «سنراجعها ونتواصل معك» ثم لا شيء: لا يعرف أوصلت، ولا في أي حالٍ هي،
 *    ولا يصله ردٌّ حتى لو غيّرت الإدارة حالتها إلى «تم الحل».
 *
 * الآن: قائمةُ شكاواه بحالاتها، وخيطُ ردودٍ في الاتجاهين، ومرفقاتُه كما
 * أرسلها — والردُّ من الإدارة يصله **إشعاراً** أيضاً لا هنا فقط.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import {
    complaintRepository, MyComplaint, ComplaintReply, ComplaintStatus,
} from '../repositories/complaintRepository';

const STATUS: Record<ComplaintStatus, { ar: string; en: string; bg: string; fg: string }> = {
    open:      { ar: 'مفتوحة',        en: 'Open',      bg: 'var(--adm-warn-bg, #fdf3dd)', fg: 'var(--adm-warn-fg, #92600a)' },
    reviewing: { ar: 'قيد المراجعة',  en: 'Reviewing', bg: 'var(--adm-info-bg, #e6f0f9)', fg: 'var(--adm-info-fg, #1d5f96)' },
    resolved:  { ar: 'تمّ حلّها',      en: 'Resolved',  bg: 'var(--adm-ok-bg, #e8f6ed)',   fg: 'var(--adm-ok-fg, #15803d)' },
    dismissed: { ar: 'أُغلقت',         en: 'Closed',    bg: 'var(--gray-100, #f1f5f9)',    fg: 'var(--text-secondary, #556070)' },
};

const CAT_AR: Record<string, string> = {
    app_issue: 'مشكلة في التطبيق',
    store_issue: 'مشكلة مع متجر',
    payment: 'دفع / سعر',
    suggestion: 'اقتراح',
    other: 'أخرى',
};

const fmt = (iso: string, isRTL: boolean) => {
    const d = new Date(iso);
    // 🪤 `-u-ca-gregory` إلزامي: بدونه يطبع `ar-SA` تاريخاً هجرياً
    //    (فخّ مسجَّل في قواعد المشروع).
    return d.toLocaleString(isRTL ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
};

// ═══════════════════════════════════════════════════════════════════════════

const AttachmentChip: React.FC<{ path: string; isRTL: boolean }> = ({ path, isRTL }) => {
    const [busy, setBusy] = useState(false);
    const isPdf = /\.pdf$/i.test(path);
    const open = async () => {
        if (busy) return;
        setBusy(true);
        // المستودع خاصّ: لا عنوان دائم، وإنما رابطٌ موقّت يُصدره الخادم لصاحبه.
        const url = await complaintRepository.signedUrl(path);
        setBusy(false);
        if (url) window.open(url, '_blank', 'noopener');
    };
    return (
        <button
            type="button"
            onClick={open}
            disabled={busy}
            style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '5px 11px', borderRadius: 999, cursor: 'pointer',
                border: '1px solid var(--border-color, #e2e8f0)',
                background: 'var(--body-bg, #f7f7f7)', color: 'var(--text-primary, #111)',
                fontSize: '0.74rem', fontWeight: 700,
            }}
        >
            <span aria-hidden="true">{isPdf ? '📄' : '🖼️'}</span>
            {busy ? (isRTL ? '…' : '…') : (isRTL ? 'افتح المرفق' : 'Open attachment')}
        </button>
    );
};

const Thread: React.FC<{ complaint: MyComplaint; isRTL: boolean; onChanged: () => void }> = ({
    complaint, isRTL, onChanged,
}) => {
    const { customAlert } = useApp();
    const [replies, setReplies] = useState<ComplaintReply[] | null>(null);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let alive = true;
        (async () => {
            const r = await complaintRepository.thread(complaint.id);
            if (alive) setReplies(r);
        })();
        return () => { alive = false; };
    }, [complaint.id]);

    const send = async () => {
        const body = draft.trim();
        if (!body || busy) return;
        setBusy(true);
        const res = await complaintRepository.reply(complaint.id, body);
        setBusy(false);
        if (!res.ok) {
            customAlert(res.msg || (isRTL ? '❌ تعذّر إرسال الردّ.' : '❌ Could not send the reply.'));
            return;
        }
        setDraft('');
        setReplies(await complaintRepository.thread(complaint.id));
        onChanged();
    };

    return (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--border-color, #e2e8f0)', paddingTop: 12 }}>
            {replies === null ? (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #666)', fontWeight: 700 }}>
                    {isRTL ? 'جارٍ تحميل الردود…' : 'Loading replies…'}
                </div>
            ) : replies.length === 0 ? (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #666)', fontWeight: 700, lineHeight: 1.8 }}>
                    {isRTL
                        ? 'لا ردود بعد. حين يردّ فريق تاكي سيصلك إشعار، ويظهر الردّ هنا.'
                        : 'No replies yet. You will be notified when the TAKI team replies.'}
                </div>
            ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                    {replies.map((r) => {
                        const admin = r.author_role === 'admin';
                        return (
                            <div
                                key={r.id}
                                style={{
                                    padding: '9px 12px', borderRadius: 12,
                                    background: admin ? 'var(--adm-accent-weak, #e7f5ef)' : 'var(--body-bg, #f7f7f7)',
                                    border: '1px solid var(--border-color, #e2e8f0)',
                                }}
                            >
                                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 3 }}>
                                    <span style={{ fontSize: '0.76rem', fontWeight: 900, color: 'var(--text-primary, #111)' }}>
                                        {admin ? (isRTL ? '🛟 فريق تاكي' : '🛟 TAKI team') : (isRTL ? 'أنت' : 'You')}
                                    </span>
                                    <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary, #666)', fontWeight: 600 }}>
                                        {fmt(r.created_at, isRTL)}
                                    </span>
                                </div>
                                <div style={{ fontSize: '0.83rem', lineHeight: 1.8, color: 'var(--text-primary, #111)', whiteSpace: 'pre-wrap' }}>
                                    {r.body}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-end' }}>
                <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={isRTL ? 'أضف ردّاً أو تفصيلاً جديداً…' : 'Add a reply…'}
                    rows={2}
                    style={{
                        flex: 1, minWidth: 0, padding: 10, borderRadius: 12, resize: 'vertical',
                        border: '1.5px solid var(--gray-200, #ddd)', background: 'var(--body-bg, #f7f7f7)',
                        color: 'var(--text-primary, #111)', outline: 'none', fontSize: '0.85rem', fontFamily: 'inherit',
                    }}
                />
                <button
                    type="button"
                    onClick={send}
                    disabled={busy || !draft.trim()}
                    style={{
                        padding: '11px 16px', borderRadius: 12, border: 'none', cursor: 'pointer',
                        background: busy || !draft.trim() ? 'var(--gray-400, #999)' : 'var(--primary)',
                        color: '#fff', fontWeight: 900, fontSize: '0.85rem', whiteSpace: 'nowrap',
                    }}
                >
                    {busy ? '⏳' : (isRTL ? 'إرسال' : 'Send')}
                </button>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════════════════

const MyComplaints: React.FC = () => {
    const { user, language, isAuthReady } = useApp();
    const history = useHistory();
    const isRTL = language === 'ar';
    const [rows, setRows] = useState<MyComplaint[] | null>(null);
    const [openId, setOpenId] = useState<string | null>(null);

    const load = useCallback(async () => {
        const r = await complaintRepository.mine(50);
        setRows(r);
    }, []);

    useEffect(() => {
        if (!isAuthReady) return;
        if (!user?.id) { setRows([]); return; }
        load();
    }, [isAuthReady, user?.id, load]);

    if (isAuthReady && !user?.id) {
        return (
            <div dir={isRTL ? 'rtl' : 'ltr'} style={{ padding: '32px 18px', textAlign: 'center' }}>
                <div style={{ fontSize: '2rem', marginBottom: 10 }} aria-hidden="true">📣</div>
                <p style={{ fontWeight: 800, color: 'var(--text-primary, #111)' }}>
                    {isRTL ? 'سجّل الدخول لمتابعة شكاواك' : 'Sign in to follow your complaints'}
                </p>
                <button
                    type="button"
                    onClick={() => history.push('/register')}
                    style={{ marginTop: 14, padding: '11px 24px', borderRadius: 12, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
                >
                    {isRTL ? 'تسجيل الدخول' : 'Sign in'}
                </button>
            </div>
        );
    }

    return (
        <div dir={isRTL ? 'rtl' : 'ltr'} style={{ padding: '18px 14px 96px', maxWidth: 720, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <button
                    type="button"
                    onClick={() => history.goBack()}
                    aria-label={isRTL ? 'رجوع' : 'Back'}
                    style={{
                        width: 36, height: 36, borderRadius: 10, cursor: 'pointer',
                        border: '1px solid var(--border-color, #e2e8f0)', background: 'var(--card-bg, #fff)',
                        color: 'var(--text-primary, #111)', fontWeight: 900,
                    }}
                >
                    {isRTL ? '→' : '←'}
                </button>
                <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900, color: 'var(--text-primary, #111)' }}>
                    📣 {isRTL ? 'شكاواي' : 'My complaints'}
                </h1>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: '0.82rem', lineHeight: 1.8, color: 'var(--text-secondary, #666)', fontWeight: 600 }}>
                {isRTL
                    ? 'كل شكوى أرسلتها، وحالتها، وردود فريق تاكي عليها. يمكنك الردّ في أي وقت.'
                    : 'Every complaint you sent, its status, and the TAKI team replies. You can reply any time.'}
            </p>

            {rows === null ? (
                <div style={{ display: 'grid', gap: 10 }}>
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="animate-pulse"
                            style={{ height: 96, borderRadius: 16, background: 'var(--gray-100, #f1f5f9)' }} />
                    ))}
                </div>
            ) : rows.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 16px' }}>
                    <div style={{ fontSize: '2rem', marginBottom: 10, opacity: 0.6 }} aria-hidden="true">📭</div>
                    <p style={{ fontWeight: 800, color: 'var(--text-primary, #111)', margin: 0 }}>
                        {isRTL ? 'لم ترسل شكوى بعد' : 'No complaints yet'}
                    </p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #666)', marginTop: 8, lineHeight: 1.8, fontWeight: 600 }}>
                        {isRTL
                            ? 'إن واجهتك مشكلة — في التطبيق أو مع متجر أو في الدفع — أرسلها من زرّ «الشكاوى / تواصل الإدارة» في القائمة، وتابعها هنا.'
                            : 'If something goes wrong, send it from the “Complaints” button in the menu and follow it here.'}
                    </p>
                </div>
            ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                    {rows.map((c) => {
                        const st = STATUS[c.status] ?? STATUS.open;
                        const open = openId === c.id;
                        return (
                            <div
                                key={c.id}
                                style={{
                                    background: 'var(--card-bg, #fff)',
                                    border: `1px solid ${c.unread_admin ? 'var(--primary)' : 'var(--border-color, #e2e8f0)'}`,
                                    borderRadius: 16, padding: 14,
                                }}
                            >
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                                    <span style={{ fontSize: '0.7rem', fontWeight: 900, padding: '2px 10px', borderRadius: 999, background: st.bg, color: st.fg }}>
                                        {isRTL ? st.ar : st.en}
                                    </span>
                                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary, #666)' }}>
                                        {CAT_AR[c.category] ?? c.category}
                                    </span>
                                    {c.unread_admin && (
                                        <span style={{ fontSize: '0.68rem', fontWeight: 900, padding: '2px 9px', borderRadius: 999, background: 'var(--primary)', color: '#fff' }}>
                                            {isRTL ? 'ردٌّ جديد' : 'New reply'}
                                        </span>
                                    )}
                                    <span style={{ marginInlineStart: 'auto', fontSize: '0.68rem', color: 'var(--text-secondary, #666)', fontWeight: 600 }}>
                                        {fmt(c.created_at, isRTL)}
                                    </span>
                                </div>

                                {c.subject && (
                                    <div style={{ fontWeight: 900, fontSize: '0.92rem', color: 'var(--text-primary, #111)', marginBottom: 4 }}>
                                        {c.subject}
                                    </div>
                                )}
                                <div style={{ fontSize: '0.84rem', lineHeight: 1.8, color: 'var(--text-primary, #111)', whiteSpace: 'pre-wrap' }}>
                                    {c.message}
                                </div>

                                {c.attachments?.length > 0 && (
                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                                        {c.attachments.map((p) => <AttachmentChip key={p} path={p} isRTL={isRTL} />)}
                                    </div>
                                )}

                                <button
                                    type="button"
                                    onClick={() => setOpenId(open ? null : c.id)}
                                    aria-expanded={open}
                                    style={{
                                        marginTop: 10, border: 'none', background: 'transparent', cursor: 'pointer',
                                        color: 'var(--primary)', fontWeight: 800, fontSize: '0.8rem', padding: 0,
                                    }}
                                >
                                    {open
                                        ? (isRTL ? '▲ إخفاء الردود' : '▲ Hide replies')
                                        : (isRTL
                                            ? `▼ الردود${c.reply_count ? ` (${c.reply_count})` : ''}`
                                            : `▼ Replies${c.reply_count ? ` (${c.reply_count})` : ''}`)}
                                </button>

                                {open && <Thread complaint={c} isRTL={isRTL} onChanged={load} />}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default MyComplaints;
