/**
 * RefundAction — زرّ الإلغاء على بطاقة الطلب (v14.18)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 ما كان قبله: البطاقة نفسها تقول «🔒 مدفوع — لا تنتهي مهلته ولا يُلغى
 * تلقائياً»، وتحتها بسطور زرُّ «إلغاء الحجز ❌» بلا أي شرط. والقاعدة كانت تُلغيه
 * فعلاً وتُعيد الكمّية للتاجر وتُرسل نصّاً لا يذكر مالاً — فيبقى المشتري بلا
 * بضاعة ولا مال ولا أثر مكتوب. الشاشة كانت تَعِد بحماية لا وجود لها.
 *
 * اليوم:
 *  • طلبٌ غير مدفوع (عند الاستلام): يُلغى بضغطة كما كان — لا مال في الطريق.
 *  • طلبٌ مدفوع: الزرّ يصير «طلب إلغاء واسترداد» بتحذير يذكر **المبلغ** ويشرح
 *    المسار: القرار للتاجر وفق سياسته المعلنة، وتاكي وسيط لا تحتفظ بالمال.
 *  • وبعد الطلب: تظهر حالته الحقيقية (قيد المراجعة · رُفض مع السبب · أُقرّ ·
 *    رُدّ المبلغ بمرجعه وإشعاره الدائن) — لا شاشة تنتظر بلا جواب.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { refundRepository, BookingRefund } from '../repositories/refundRepository';

const money = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);

export const RefundAction: React.FC<{
    booking: any;
    /** إلغاء طلبٍ غير مدفوع — المسار القديم بلا تغيير. */
    onCancel: () => void | Promise<void>;
    /** أعِد تحميل القوائم بعد أي تغيّر في حالة الاسترداد. */
    onChanged?: () => void | Promise<void>;
}> = ({ booking, onCancel, onChanged }) => {
    const { language, customAlert, customConfirm, customPrompt } = useApp();
    const isRTL = language === 'ar';
    const paid = !!booking?.paidAt;
    const amount = Number(booking?.paidAmount) > 0
        ? Number(booking.paidAmount)
        : (Number(booking?.totalAmount) > 0 ? Number(booking.totalAmount) : 0);

    const [refund, setRefund] = useState<BookingRefund | null>(null);
    const [busy, setBusy] = useState(false);
    const [loaded, setLoaded] = useState(false);

    const reload = useCallback(async () => {
        if (!paid || !booking?.barcode) { setLoaded(true); return; }
        const r = await refundRepository.get(booking.barcode);
        setRefund(r);
        setLoaded(true);
    }, [paid, booking?.barcode]);

    useEffect(() => { reload(); }, [reload]);

    const linkBtn: React.CSSProperties = {
        marginTop: 24, background: 'none', border: 'none', color: '#f43f5e',
        fontSize: '0.8rem', fontWeight: 800, cursor: 'pointer', textDecoration: 'underline',
    };

    // ── طلب غير مدفوع: السلوك القديم بلا تغيير ────────────────────────────
    if (!paid) {
        return (
            <button
                disabled={busy}
                onClick={async () => {
                    if (!(await customConfirm(isRTL ? 'إلغاء الحجز؟' : 'Cancel?'))) return;
                    setBusy(true);
                    try { await onCancel(); } finally { setBusy(false); }
                }}
                style={linkBtn}
            >
                {isRTL ? 'إلغاء الحجز ❌' : 'Cancel Booking ❌'}
            </button>
        );
    }

    if (!loaded) return null;

    const box: React.CSSProperties = {
        marginTop: 18, padding: '12px 14px', borderRadius: 14, textAlign: isRTL ? 'right' : 'left',
        background: 'var(--card-bg)', border: '1px solid var(--border-color)',
        fontSize: '0.76rem', fontWeight: 700, lineHeight: 1.8, color: 'var(--text-secondary)',
    };

    // ── مدفوع وبلا طلب بعد: الزرّ يطلب لا يُلغي ───────────────────────────
    if (!refund || refund.status === 'withdrawn' || refund.status === 'declined') {
        const declined = refund?.status === 'declined';
        return (
            <div style={{ width: '100%' }}>
                {declined && (
                    <div style={box}>
                        <div style={{ fontWeight: 900, color: 'var(--text-primary)' }}>
                            {isRTL ? '↩️ اعتذر التاجر عن الاسترداد' : '↩️ The merchant declined the refund'}
                        </div>
                        {refund?.merchantNote && <div style={{ marginTop: 4 }}>{isRTL ? 'السبب: ' : 'Reason: '}{refund.merchantNote}</div>}
                        <div style={{ marginTop: 6 }}>
                            {isRTL
                                ? 'طلبك ما زال قائماً. وإن رأيت في ذلك مخالفة لسياسته المعلنة فارفع شكوى من «📣 الشكاوى» — تاكي تُيسّر التواصل ولا تبتّ في سياسات المتاجر.'
                                : 'Your order still stands. If this contradicts the store\'s published policy, raise a complaint from «📣» — TAKI facilitates but does not adjudicate store policies.'}
                        </div>
                    </div>
                )}
                <button
                    disabled={busy}
                    onClick={async () => {
                        const ok = await customConfirm(isRTL
                            ? `↩️ طلب إلغاء واسترداد\n\nالمبلغ المدفوع: ${money(amount)} ر.س\n\nسيصل طلبك للتاجر، والقرار له وفق سياسة متجره المعلنة. تاكي وسيط لا تحتفظ بالمال ولا تردّه: الدفع ذهب لحساب التاجر مباشرة.\n\nطلبك يبقى قائماً حتى يبتّ فيه، ولا يُلغى بمجرّد الطلب.\n\nهل تريد إرسال الطلب؟`
                            : `↩️ Cancellation & refund request\n\nAmount paid: ${money(amount)} SAR\n\nYour request goes to the merchant; the decision is theirs under their published policy. TAKI is an intermediary, never holds the money and cannot return it: the payment went straight to the merchant's account.\n\nYour order stands until they decide.\n\nSend the request?`);
                        if (!ok) return;
                        const reason = await customPrompt(
                            isRTL ? 'سبب الطلب (اختياري) — يساعد التاجر على البتّ أسرع:' : 'Reason (optional):');
                        setBusy(true);
                        const res = await refundRepository.request(booking.barcode, String(reason || ''));
                        setBusy(false);
                        if (!res.ok) {
                            await customAlert(isRTL ? '⚠️ تعذّر إرسال الطلب. حاول مجدداً.' : '⚠️ Could not send the request.');
                            return;
                        }
                        await reload();
                        await onChanged?.();
                        await customAlert(isRTL
                            ? '✅ وصل طلبك للتاجر. سيصلك إشعار بقراره.'
                            : '✅ Your request reached the merchant. You will be notified of their decision.');
                    }}
                    style={{ ...linkBtn, marginTop: declined ? 12 : 24 }}
                >
                    {isRTL ? '↩️ طلب إلغاء واسترداد' : '↩️ Request cancellation & refund'}
                </button>
            </div>
        );
    }

    // ── قيد المراجعة ───────────────────────────────────────────────────────
    if (refund.status === 'requested') {
        return (
            <div style={{ width: '100%' }}>
                <div style={box}>
                    <div style={{ fontWeight: 900, color: 'var(--text-primary)' }}>
                        {isRTL ? '⏳ طلب الاسترداد عند التاجر' : '⏳ Refund request with the merchant'}
                    </div>
                    <div style={{ marginTop: 4 }}>
                        {isRTL ? `المبلغ: ${money(refund.amount)} ر.س. القرار والتنفيذ على التاجر وفق سياسته المعلنة.`
                               : `Amount: ${money(refund.amount)} SAR. The decision and the payment are the merchant's under their published policy.`}
                    </div>
                </div>
                <button
                    disabled={busy}
                    onClick={async () => {
                        if (!(await customConfirm(isRTL ? 'سحب طلب الاسترداد؟ يبقى طلبك كما هو.' : 'Withdraw the refund request? Your order stays as is.'))) return;
                        setBusy(true);
                        await refundRepository.withdraw(booking.barcode);
                        setBusy(false);
                        await reload();
                        await onChanged?.();
                    }}
                    style={{ ...linkBtn, color: 'var(--text-secondary)', marginTop: 12 }}
                >
                    {isRTL ? 'سحب الطلب' : 'Withdraw request'}
                </button>
            </div>
        );
    }

    // ── أُقرّ الاسترداد وبانتظار التحويل ────────────────────────────────────
    if (refund.status === 'approved') {
        return (
            <div style={{ ...box, borderColor: 'rgba(245,158,11,0.5)' }}>
                <div style={{ fontWeight: 900, color: 'var(--text-primary)' }}>
                    {isRTL ? '💛 أقرّ التاجر الاسترداد' : '💛 The merchant approved the refund'}
                </div>
                <div style={{ marginTop: 4 }}>
                    {isRTL ? `المبلغ ${money(refund.amount)} ر.س مستحقّ لك من التاجر. ويبقى طلبك قائماً هنا حتى يؤكّد التحويل، وعندها يُغلق ويصلك إشعار بالمرجع.`
                           : `${money(refund.amount)} SAR is due to you from the merchant. Your order stays here until they confirm the transfer, and then it closes and you are notified with the reference.`}
                </div>
            </div>
        );
    }

    // ── تمّ الردّ ───────────────────────────────────────────────────────────
    return (
        <div style={{ ...box, borderColor: 'rgba(16,185,129,0.5)' }}>
            <div style={{ fontWeight: 900, color: 'var(--text-primary)' }}>
                {isRTL ? '✅ أكّد التاجر ردّ المبلغ' : '✅ The merchant confirmed the refund'}
            </div>
            <div style={{ marginTop: 4 }}>
                {isRTL ? `المبلغ: ${money(Number(refund.refundAmount ?? refund.amount))} ر.س` : `Amount: ${money(Number(refund.refundAmount ?? refund.amount))} SAR`}
                {refund.refundRef ? ` · ${isRTL ? 'المرجع' : 'Ref'}: ${refund.refundRef}` : ''}
                {refund.creditNoteNo ? ` · ${isRTL ? 'إشعار دائن' : 'Credit note'}: ${refund.creditNoteNo}` : ''}
            </div>
            <div style={{ marginTop: 6 }}>
                {isRTL ? 'مدّة وصول المبلغ لحسابك تحدّدها جهة الدفع (البنك أو البوابة) لا تاكي.'
                       : 'The time for the money to reach your account is set by the payment provider, not TAKI.'}
            </div>
        </div>
    );
};

export default RefundAction;
