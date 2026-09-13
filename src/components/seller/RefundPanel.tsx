/**
 * RefundPanel — قرار التاجر في طلب إلغاء واسترداد (v14.18)
 * ═══════════════════════════════════════════════════════════════════════════
 * القرار للتاجر وحده وفق سياسته المعلنة — تاكي لا تبتّ ولا تحتفظ بالمال.
 * ودور هذه البطاقة أن تجعل القرار **موثّقاً**: مبلغ ومرجع وتاريخ، وإشعارٌ
 * دائن على الفاتورة، وإشعارٌ للمشتري بكل خطوة.
 *
 * تحلّ محلّ زرّ «❌ إلغاء الطلب» على الطلبات المدفوعة: إلغاءٌ صامت لطلبٍ دفع
 * صاحبه كان يُعيد الكمّية للتاجر ويترك المشتري بلا بضاعة ولا مال ولا أثر.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { refundRepository, BookingRefund } from '../../repositories/refundRepository';

const money = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);

export const RefundPanel: React.FC<{
    order: any;
    isRTL: boolean;
    onChanged?: () => void | Promise<void>;
}> = ({ order, isRTL, onChanged }) => {
    const { customAlert, customConfirm, customPrompt } = useApp();
    const paid = !!order?.paidAt;
    const amount = Number(order?.paidAmount) > 0
        ? Number(order.paidAmount)
        : (Number(order?.totalAmount) > 0 ? Number(order.totalAmount) : 0);

    const [refund, setRefund] = useState<BookingRefund | null>(null);
    const [busy, setBusy] = useState(false);
    const [ready, setReady] = useState(false);

    const reload = useCallback(async () => {
        if (!paid || !order?.barcode) { setReady(true); return; }
        setRefund(await refundRepository.get(order.barcode));
        setReady(true);
    }, [paid, order?.barcode]);
    useEffect(() => { reload(); }, [reload]);

    if (!paid || !ready) return null;

    const wrap: React.CSSProperties = {
        marginTop: 10, padding: '12px 14px', borderRadius: 16,
        background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.4)',
        fontSize: '0.78rem', fontWeight: 700, lineHeight: 1.8, color: 'var(--text-primary)',
    };
    const btn = (bg: string): React.CSSProperties => ({
        flex: 1, minWidth: 120, padding: '10px 12px', borderRadius: 12, border: 'none',
        background: bg, color: '#fff', fontWeight: 900, fontSize: '0.78rem',
        cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
    });

    const doRefund = async (r: BookingRefund | null) => {
        const due = Number(r?.amount ?? amount);
        // v14.21 — الطلب المكتمل لا يُلغى ولا تعود كمّيته (البضاعة خرجت فعلاً)،
        // فلا نَعِد التاجر بما لن يحدث.
        const stillOpen = order.status === 'pending' || order.status === 'acknowledged';
        const ok = await customConfirm(isRTL
            ? `تأكيد ردّ المبلغ\n\nالمبلغ: ${money(due)} ر.س\n\nأكّد هذا فقط بعد أن ترسل المبلغ فعلاً من بوابتك أو حسابك. سيُسجَّل إشعار دائن على الفاتورة ويصل المشتري إشعار.\n\n${stillOpen ? 'وسيُلغى الطلب وتعود الكمّية للبيع.' : 'والطلب مغلق أصلاً، فلن تعود كمّيته للبيع — البضاعة خرجت.'}`
            : `Confirm refund\n\nAmount: ${money(due)} SAR\n\nConfirm only after you actually sent the money. A credit note is recorded and the buyer is notified.\n\n${stillOpen ? 'The order will be cancelled and the stock returned.' : 'The order is already closed, so the stock will not return.'}`);
        if (!ok) return;
        const ref = await customPrompt(isRTL
            ? 'رقم مرجع التحويل (من بوابتك أو بنكك) — يُطبع على الفاتورة:'
            : 'Transfer reference (from your gateway or bank) — printed on the invoice:');
        setBusy(true);
        const res = await refundRepository.resolve(order.barcode, 'refund', {
            amount: due, ref: String(ref || ''), method: isRTL ? 'بوابة الدفع' : 'gateway',
        });
        setBusy(false);
        if (!res.ok) { await customAlert('⚠️ ' + (res.error || '')); return; }
        await reload(); await onChanged?.();
        await customAlert(isRTL
            ? `✅ سُجِّل الردّ. إشعار دائن: ${res.creditNoteNo}${res.orderCancelled ? '\nوأُلغي الطلب وعادت الكمّية للبيع.' : '\nوالطلب مغلق أصلاً، فلم تعد كمّيته للبيع.'}`
            : `✅ Refund recorded. Credit note: ${res.creditNoteNo}${res.orderCancelled ? '\nThe order was cancelled and the stock returned.' : '\nThe order was already closed, so the stock did not return.'}`);
    };

    // ── لا طلب بعد: التاجر يملك إلغاءً يُسجّل الدَّين عليه ─────────────────
    if (!refund || refund.status === 'withdrawn' || refund.status === 'declined') {
        if (!(order.status === 'pending' || order.status === 'acknowledged')) return null;
        return (
            <div style={wrap}>
                <div style={{ fontWeight: 900 }}>
                    💳 {isRTL ? `طلب مدفوع إلكترونياً — ${money(amount)} ر.س` : `Paid online — ${money(amount)} SAR`}
                </div>
                <div style={{ marginTop: 4, color: 'var(--text-secondary)' }}>
                    {isRTL
                        ? 'لا يُلغى هذا الطلب بضغطة: المال في حسابك أنت، فإلغاؤه يترك المشتري بلا بضاعة ولا مال. إن اضطررت للإلغاء (نفاد البضاعة مثلاً) يُسجَّل المبلغ ديناً عليك ويبقى الطلب قائماً حتى تؤكّد ردّه.'
                        : 'This order cannot be cancelled with one tap: the money is in your account. If you must cancel (out of stock), the amount is recorded as owed to the buyer until you confirm the refund.'}
                </div>
                {refund?.status === 'declined' && (
                    <div style={{ marginTop: 6, color: 'var(--text-secondary)' }}>
                        {isRTL ? 'سبق أن رفضتَ طلب استرداد على هذا الطلب.' : 'You previously declined a refund request on this order.'}
                    </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                    <button disabled={busy} style={btn('linear-gradient(135deg,#f59e0b,#d97706)')}
                        onClick={async () => {
                            // v14.21 — الصياغة تطابق ما يحدث: هذا **إقرار** بالإلغاء
                            // ويُسجّل الدَّين؛ والطلب لا يُغلق إلا عند تأكيد التحويل.
                            const ok = await customConfirm(isRTL
                                ? `⚠️ إقرار إلغاء طلب مدفوع\n\nالمبلغ ${money(amount)} ر.س يُسجَّل ديناً عليك للمشتري ويصله إشعار بذلك.\n\nالطلب يبقى قائماً حتى تؤكّد التحويل من نفس البطاقة — وعندها يُغلق وتعود الكمّية للبيع.\n\nهل تريد المتابعة؟`
                                : `⚠️ Approve cancelling a paid order\n\n${money(amount)} SAR is recorded as owed to the buyer and they are notified.\n\nThe order stays open until you confirm the transfer from this card — only then is it closed and the stock returned.\n\nContinue?`);
                            if (!ok) return;
                            const note = await customPrompt(isRTL ? 'سبب الإلغاء (يصل المشتري):' : 'Cancellation reason (sent to the buyer):');
                            setBusy(true);
                            const res = await refundRepository.resolve(order.barcode, 'open', { note: String(note || '') });
                            setBusy(false);
                            if (!res.ok) { await customAlert('⚠️ ' + (res.error || '')); return; }
                            await reload(); await onChanged?.();
                        }}>
                        {isRTL ? '❌ أقرّ الإلغاء وسجّل الدَّين' : '❌ Approve cancelling & record the debt'}
                    </button>
                </div>
            </div>
        );
    }

    // ── طلب المشتري قيد المراجعة ───────────────────────────────────────────
    if (refund.status === 'requested') {
        return (
            <div style={{ ...wrap, background: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.4)' }}>
                <div style={{ fontWeight: 900 }}>
                    ↩️ {isRTL ? `طلب إلغاء واسترداد — ${money(refund.amount)} ر.س` : `Cancellation & refund request — ${money(refund.amount)} SAR`}
                </div>
                {refund.reason && (
                    <div style={{ marginTop: 4, color: 'var(--text-secondary)' }}>
                        {isRTL ? 'سبب المشتري: ' : 'Buyer reason: '}{refund.reason}
                    </div>
                )}
                <div style={{ marginTop: 6, color: 'var(--text-secondary)' }}>
                    {isRTL
                        ? 'القرار لك وفق سياسة متجرك المعلنة. تاكي تُسجّل وتُبلّغ ولا تبتّ.'
                        : 'The decision is yours under your published policy. TAKI records and notifies; it does not adjudicate.'}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                    <button disabled={busy} style={btn('linear-gradient(135deg,#10b981,#059669)')}
                        onClick={() => doRefund(refund)}>
                        {isRTL ? '✅ أكّدت ردّ المبلغ' : '✅ I refunded it'}
                    </button>
                    <button disabled={busy} style={btn('linear-gradient(135deg,#64748b,#475569)')}
                        onClick={async () => {
                            const note = await customPrompt(isRTL
                                ? 'سبب الرفض وفق سياستك المعلنة (يصل المشتري):'
                                : 'Reason for declining, per your published policy (sent to the buyer):');
                            if (note == null) return;
                            setBusy(true);
                            const res = await refundRepository.resolve(order.barcode, 'decline', { note: String(note || '') });
                            setBusy(false);
                            if (!res.ok) { await customAlert('⚠️ ' + (res.error || '')); return; }
                            await reload(); await onChanged?.();
                        }}>
                        {isRTL ? '↩️ اعتذار وفق السياسة' : '↩️ Decline per policy'}
                    </button>
                </div>
            </div>
        );
    }

    // ── أقررتَ الاسترداد ولم تؤكّد التحويل بعد ──────────────────────────────
    if (refund.status === 'approved') {
        return (
            <div style={wrap}>
                <div style={{ fontWeight: 900 }}>
                    💛 {isRTL ? `مبلغ مستحقّ للمشتري — ${money(refund.amount)} ر.س` : `Owed to the buyer — ${money(refund.amount)} SAR`}
                </div>
                <div style={{ marginTop: 4, color: 'var(--text-secondary)' }}>
                    {isRTL ? 'الطلب ما زال قائماً. حوِّل المبلغ من بوابتك ثم أكّده هنا — عندها يُغلق الطلب ويُسجَّل إشعار دائن على الفاتورة.'
                           : 'Transfer it from your gateway, then confirm here so a credit note is recorded on the invoice.'}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button disabled={busy} style={btn('linear-gradient(135deg,#10b981,#059669)')}
                        onClick={() => doRefund(refund)}>
                        {isRTL ? '✅ أكّدت ردّ المبلغ' : '✅ I refunded it'}
                    </button>
                </div>
            </div>
        );
    }

    // ── تمّ ────────────────────────────────────────────────────────────────
    return (
        <div style={{ ...wrap, background: 'rgba(16,185,129,0.10)', borderColor: 'rgba(16,185,129,0.4)' }}>
            <div style={{ fontWeight: 900 }}>
                ✅ {isRTL ? `رُدّ المبلغ — ${money(Number(refund.refundAmount ?? refund.amount))} ر.س` : `Refunded — ${money(Number(refund.refundAmount ?? refund.amount))} SAR`}
            </div>
            <div style={{ marginTop: 4, color: 'var(--text-secondary)' }}>
                {refund.creditNoteNo ? `${isRTL ? 'إشعار دائن' : 'Credit note'}: ${refund.creditNoteNo}` : ''}
                {refund.refundRef ? ` · ${isRTL ? 'المرجع' : 'Ref'}: ${refund.refundRef}` : ''}
            </div>
        </div>
    );
};

export default RefundPanel;
