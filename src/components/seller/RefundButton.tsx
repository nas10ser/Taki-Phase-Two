/**
 * RefundButton — ردّ المبلغ للمشتري بضغطة واحدة (v14.97)
 * ═══════════════════════════════════════════════════════════════════════════
 * طلبُ ناصر: «إذا حصلت مشكلة وأراد التاجر ردّ المبلغ للمشتري يستطيع بنقرة زر».
 *
 * 🔴 والفرق بين هذه البطاقة و`RefundPanel` جوهريّ، ولا يجوز أن يلتبس على أحد:
 *    • `RefundPanel` (v14.18) **تُسجّل** ردّاً أجراه التاجر بيده في مكانٍ آخر:
 *      تطلب منه رقم مرجع التحويل وتُصدر إشعاراً دائناً. لا تحرّك ريالاً.
 *    • وهذه **تُجريه فعلاً**: تأمر بوّابة التاجر نفسها بإعادة المبلغ إلى بطاقة
 *      المشتري. المال يخرج من **حساب التاجر عند مزوّده** — تاكي لا تحتفظ به
 *      ولا تمرّ به، فلا تستطيع ردّه ولا منعه.
 *
 * 🔴 ولماذا الترتيب هنا «السبب ثمّ التأكيد» لا العكس: درس v14.24 — كان ضغطُ
 *    «إلغاء» على نافذة المرجع يمضي في التسجيل فيُختم استردادٌ لم يقع. فالخطوة
 *    التي لا رجعة فيها تكون **آخر** ما يُضغط، ويسبقها تأكيدٌ صريح بالمبلغ.
 *
 * 🪤 والقفلُ ليس هنا: `taki_claim_booking_refund` على القاعدة تُرجع `ok` مرّةً
 *    واحدة لكلّ ردّ بقفل صفّ الحجز. فتعطيلُ الزرّ أثناء التنفيذ راحةُ عينٍ
 *    للتاجر لا حاجزُ أمان — وضغطتان متلاحقتان لا تُخرجان المبلغ مرّتين حتى لو
 *    سبقت إحداهما إعادةَ التصيير.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { refundRepository, RefundExec } from '../../repositories/refundRepository';

const money = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);

/** 🪤 `ar-SA` وحدها تُخرج التاريخ هجرياً — `-u-ca-gregory` إلزامية. */
const when = (iso: string | null, isRTL: boolean): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(isRTL ? 'ar-SA-u-ca-gregory' : 'en-GB',
        { day: 'numeric', month: 'short', year: 'numeric' })
        + ' · ' + d.toLocaleTimeString(isRTL ? 'ar-SA' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
};

/**
 * أسبابُ الرفض بصيغةٍ يفهمها التاجر. وما ليس في الجدول يُعرض **بنصّه الخام**
 * لا بجملةٍ عامّة: «تعذّر الاتصال» عن بوّابةٍ قالت «المبلغ مستردّ من قبل»
 * تترك التاجر يعيد المحاولة إلى الأبد (درس «الرابط المعطوب لا يُخطئ»).
 */
const REASON: Record<string, { ar: string; en: string }> = {
    GATEWAY_UNAVAILABLE: { ar: 'بوّابة الدفع غير مفعّلة أو مفاتيحها ناقصة — افتح «💳 بوابة الدفع» وتحقّق منها.', en: 'Your payment gateway is not active or its keys are missing — open «Payment gateway» and check.' },
    // 🪤 الرمزُ الذي تُرسله دالّةُ الحافة هو `REFUND_NOT_SUPPORTED` — وكان
    //    المفتاح هنا `REFUND_UNSUPPORTED`، فلا يُطابق أبداً وتضيع أنفعُ رسالة.
    REFUND_NOT_SUPPORTED: { ar: 'مزوّد الدفع لديك لا يدعم الردّ الآلي — ردّ المبلغ من لوحة مزوّدك ثمّ سجّله هنا بزرّ «تأكيد ردّ المبلغ».', en: 'Your provider does not support automated refunds — refund from their dashboard, then record it here.' },
    PROVIDER_CHANGED: { ar: 'بدّلتَ مزوّد الدفع بعد هذا الطلب، ومفاتيحك الجديدة لا تعرف تلك العملية — ردّ المبلغ من لوحة مزوّدك السابق ثمّ سجّله هنا.', en: 'You changed payment providers after this order, so your new keys do not know that transaction — refund from your previous provider, then record it here.' },
    NOT_YOUR_ORDER: { ar: 'هذا الطلب ليس على متجرك.', en: 'This order does not belong to your store.' },
    BOOKING_NOT_FOUND: { ar: 'لم يُعثر على هذا الطلب.', en: 'This order was not found.' },
    ALREADY_REFUNDED: { ar: 'هذا الطلب مستردّ من قبل — لا يُردّ مرّتين.', en: 'This order was already refunded — it cannot be refunded twice.' },
    ALREADY_CLAIMING: { ar: 'هناك نداءُ ردٍّ جارٍ على هذا الطلب الآن. انتظر نتيجته قبل إعادة المحاولة.', en: 'A refund call is already in flight for this order. Wait for its result.' },
    NOT_PAID: { ar: 'هذا الطلب غير مدفوع إلكترونياً — لا مبلغ يُردّ.', en: 'This order was not paid online — there is nothing to refund.' },
    NO_PAYMENT_REF: { ar: 'لا يحمل هذا الطلب مرجع دفعٍ من المزوّد، فلا شيء يُردّ عليه آلياً.', en: 'This order carries no provider payment reference, so it cannot be refunded automatically.' },
    NOT_MERCHANT: { ar: 'هذا الطلب ليس على متجرك.', en: 'This order does not belong to your store.' },
    ZERO_AMOUNT: { ar: 'مبلغ الطلب صفر — لا شيء يُردّ.', en: 'The order amount is zero — nothing to refund.' },
    RATE_LIMITED: { ar: 'محاولات كثيرة في وقت قصير — انتظر دقيقة ثمّ أعِد المحاولة.', en: 'Too many attempts — wait a minute and try again.' },
    NETWORK: { ar: 'تعذّر الوصول للخادم. الطلب **لم يُنفَّذ**؛ تحقّق من اتصالك وأعِد المحاولة.', en: 'Could not reach the server. The refund was NOT executed; check your connection and retry.' },
};

export const RefundButton: React.FC<{
    order: any;
    isRTL: boolean;
    onChanged?: () => void | Promise<void>;
}> = ({ order, isRTL, onChanged }) => {
    // 🪤 كلّ الخطّافات قبل أيّ `return` مبكّر: خطّافٌ بعده يُسقط الشجرة عند أوّل
    //    تبديل بين الفرعين (درس v14.80 — و`react-hooks/rules-of-hooks` يحرسها).
    const { customAlert, customConfirm, customPrompt, platformSettings, platformSettingsReady } = useApp();
    const [exec, setExec] = useState<RefundExec | null>(null);
    const [ready, setReady] = useState(false);
    const [busy, setBusy] = useState(false);

    const barcode: string = order?.barcode || '';
    const paid = !!order?.paidAt;

    const load = useCallback(async () => {
        if (!paid || !barcode) { setReady(true); return; }
        setExec(await refundRepository.execState(barcode));
        setReady(true);
    }, [paid, barcode]);
    useEffect(() => { load(); }, [load]);

    // المبلغ من الصفّ المجمَّد لا من حسابٍ محلّي (v14.11: الخادم يكتب الإجمالي).
    const amount = Number(order?.paidAmount) > 0
        ? Number(order.paidAmount)
        : (Number(order?.totalAmount) > 0 ? Number(order.totalAmount) : 0);

    const doRefund = async () => {
        // ١) السبب — اختياريّ، لكنّه يُطبع على إشعار المشتري فيُسأل أوّلاً.
        const reason = await customPrompt(isRTL
            ? 'سبب ردّ المبلغ (اختياري — يراه المشتري في إشعاره):'
            : 'Reason for the refund (optional — the buyer sees it):');
        if (reason == null) return;      // تراجُعٌ صريح = توقّف

        // ٢) التأكيد الأخير، وفيه المبلغ بالضبط ومن أين يخرج ولا رجعة فيه.
        const ok = await customConfirm(isRTL
            ? `⚠️ ردّ ${money(amount)} ر.س إلى المشتري الآن\n\n`
              + `• المبلغ يخرج من حسابك أنت عند بوّابة الدفع — تاكي لا تحتفظ بمالك ولا تمرّ به.\n`
              + `• العملية تُنفَّذ فوراً ولا يمكن التراجع عنها.\n`
              + `• يصل المشتري إشعارٌ بالمبلغ والمرجع، ويصدر إشعار دائن على فاتورته.\n`
              + `${order?.status === 'pending' || order?.status === 'acknowledged'
                  ? '• وسيُلغى الطلب وتعود الكمّية للبيع.'
                  : '• والطلب مغلق أصلاً، فلن تعود كمّيته للبيع — البضاعة خرجت.'}\n\n`
              + `هل تؤكّد الردّ؟`
            : `⚠️ Refund ${money(amount)} SAR to the buyer now\n\n`
              + `• The money leaves your own gateway account — TAKI never holds it.\n`
              + `• This executes immediately and cannot be undone.\n`
              + `• The buyer is notified with the amount and reference, and a credit note is issued.\n`
              + `${order?.status === 'pending' || order?.status === 'acknowledged'
                  ? '• The order will be cancelled and the stock returned.'
                  : '• The order is already closed, so the stock will not return.'}\n\n`
              + `Confirm the refund?`);
        if (!ok) return;

        setBusy(true);
        const res = await refundRepository.refundPaid(barcode, reason || undefined);
        setBusy(false);
        await load();
        await onChanged?.();

        if (!res.ok) {
            /**
             * 🔴 نتيجةٌ غير معلومة — أخطرُ رسالةٍ في هذه الشاشة كلّها.
             * دالّةُ الحافة تردّ 502 حين ينقطع النداء **بعد** أن يبدأ: المال
             * ربّما خرج فعلاً. الجملةُ العامّة «لم يُنفَّذ الردّ» هنا كذبٌ يدفع
             * التاجر إلى لوحة مزوّده ليردّ المبلغ **مرّةً ثانية** من حسابه.
             * فيُقال الشكّ صراحةً، ولا يُعرض أيّ زرّ إعادة محاولة (القفل يبقى
             * `claiming` فتُصيّر الشاشةُ بطاقةَ «جارٍ التنفيذ» بلا زرّ).
             */
            if (res.error === 'REFUND_OUTCOME_UNKNOWN') {
                await customAlert(isRTL
                    ? '⚠️ لم تصلنا نتيجةٌ مؤكّدة من بوّابتك.\n\n'
                      + 'قد يكون المبلغ خرج فعلاً وقد لا يكون — ولذلك **لا تُعِد المحاولة هنا** '
                      + 'ولا تردّ المبلغ من لوحة مزوّدك قبل التأكّد، حتى لا يُخصم مرّتين.\n\n'
                      + 'افتح سجلّ العمليات عند مزوّد الدفع وابحث عن الطلب ' + barcode + '، '
                      + 'ثمّ راسل دعم تاكي بالنتيجة ليُغلق الطلب على حالته الصحيحة.'
                      + (res.detail ? `\n\n(${res.detail})` : '')
                    : '⚠️ We did not get a confirmed result from your gateway.\n\n'
                      + 'The money may or may not have left — so do NOT retry here, and do not refund '
                      + 'from your provider dashboard before checking, or it could be debited twice.\n\n'
                      + 'Open your provider\'s transaction log, search for order ' + barcode + ', '
                      + 'then contact TAKI support with the result so the order can be closed correctly.'
                      + (res.detail ? `\n\n(${res.detail})` : ''));
                return;
            }
            const known = REASON[res.error || ''];
            // 🪤 يُعرض سببُ المزوّد كما هو حين لا نعرف الرمز — ورمزُه معه دائماً
            //    ليُبحث عنه، بدل «حدث خطأ» التي لا تقود إلى شيء.
            await customAlert('❌ ' + (isRTL
                ? (known ? known.ar : `لم يُنفَّذ الردّ. ردّ مزوّد الدفع: ${res.error}`)
                : (known ? known.en : `The refund was not executed. Provider said: ${res.error}`))
                + (res.detail ? `\n\n(${res.detail})` : ''));
            return;
        }
        // 🪤 خرج المالُ فعلاً لكنّ كتابةَ التسوية تعثّرت: يُقال صراحةً — ولا
        //    يُعرض أبداً كدعوةٍ لإعادة المحاولة (المال لا يعود بإعادة الضغط).
        const settleNote = res.settleFailed
            ? (isRTL
                ? '\n\n⚠️ خرج المبلغ من بوّابتك، لكن تسجيله عندنا تعثّر — قد يتأخّر ظهور '
                  + 'الإشعار الدائن وإشعار المشتري. **لا تُعِد الردّ**، وأبلغ دعم تاكي برقم الطلب.'
                : '\n\n⚠️ The money left your gateway, but recording it here failed — the credit note '
                  + 'and the buyer\'s notification may lag. Do NOT refund again; tell TAKI support the order number.')
            : '';
        await customAlert(isRTL
            ? `✅ نُفِّذ الردّ: ${money(res.amount ?? amount)} ر.س.`
              + (res.creditNoteNo ? `\nإشعار دائن: ${res.creditNoteNo}` : '')
              + `\nمدّة وصول المبلغ لبطاقة المشتري تحدّدها جهة الدفع لا تاكي.`
              + settleNote
            : `✅ Refund executed: ${money(res.amount ?? amount)} SAR.`
              + (res.creditNoteNo ? `\nCredit note: ${res.creditNoteNo}` : '')
              + `\nThe time to reach the buyer's card is set by the payment provider.`
              + settleNote);
    };

    // ── ما لا يُعرض ──────────────────────────────────────────────────────────
    // الزرّ مطفأ من الإدارة · أو الطلب غير مدفوع إلكترونياً · أو الحالة لم تصل.
    // 🪤 ويُنتظر `platformSettingsReady`: الافتراضُ المحلّي «مفتوح»، فعرضُه قبل
    //    وصول القيمة الحقيقية يُومض زرّاً أطفأه ناصر عمداً.
    if (!paid || !ready || !platformSettingsReady) return null;
    if (!platformSettings.refundWindow.merchantButton) return null;

    const wrap: React.CSSProperties = {
        marginTop: 10, padding: '12px 14px', borderRadius: 16,
        background: 'var(--card-bg)', border: '1px solid var(--border-color)',
        fontSize: '0.78rem', fontWeight: 700, lineHeight: 1.8, color: 'var(--text-primary)',
    };

    // ── نُفّذ فعلاً: تأكيدٌ هادئ بالتاريخ، ولا زرّ ────────────────────────────
    if (exec?.state === 'refunded') {
        return (
            <div style={{ ...wrap, background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.4)' }}>
                <div style={{ fontWeight: 900 }}>
                    ✅ {isRTL
                        ? `رُدّ ${money(exec.amount ?? amount)} ر.س للمشتري`
                        : `Refunded ${money(exec.amount ?? amount)} SAR to the buyer`}
                </div>
                <div style={{ marginTop: 4, color: 'var(--text-secondary)' }}>
                    {when(exec.refundedAt, isRTL)}
                    {exec.ref ? (isRTL ? ` · المرجع: ${exec.ref}` : ` · ref: ${exec.ref}`) : ''}
                </div>
            </div>
        );
    }

    // ── نداءٌ جارٍ: لا زرّ ثانياً (والقاعدة ترفضه أصلاً) ─────────────────────
    if (exec?.state === 'claiming') {
        return (
            <div style={wrap}>
                <div style={{ fontWeight: 900 }}>
                    ⏳ {isRTL ? 'جارٍ تنفيذ الردّ عند مزوّد الدفع…' : 'Refund in flight at your payment provider…'}
                </div>
                <div style={{ marginTop: 4, color: 'var(--text-secondary)' }}>
                    {isRTL
                        ? 'بدأ الطلب ' + when(exec.claimedAt, isRTL) + '. حدّث الصفحة بعد قليل لترى النتيجة — ولا تُعِد الضغط حتى لا يلتبس عليك الأمر (القاعدة تمنع الردّ مرّتين).'
                        : 'Started ' + when(exec.claimedAt, isRTL) + '. Refresh shortly to see the result — the database prevents a double refund.'}
                </div>
            </div>
        );
    }

    // ── لم يُنفَّذ بعد (أو فشل) ───────────────────────────────────────────────
    const failed = exec?.state === 'failed';
    return (
        <div style={wrap}>
            <div style={{ fontWeight: 900 }}>
                ↩️ {isRTL ? `ردّ المبلغ للمشتري — ${money(amount)} ر.س` : `Refund the buyer — ${money(amount)} SAR`}
            </div>
            <div style={{ marginTop: 4, color: 'var(--text-secondary)' }}>
                {isRTL
                    ? 'ضغطةٌ واحدة تأمر بوّابتك بإعادة المبلغ إلى بطاقة المشتري. المال في حسابك أنت — تاكي لا تحتفظ به ولا تمرّ به — ولذلك أنت وحدك من يستطيع ردّه، وبلا انتظار أيّ موافقة منّا.'
                    : 'One tap tells your gateway to return the amount to the buyer\'s card. The money is in your own account — TAKI never holds it — so only you can return it, with no approval step from us.'}
            </div>
            {failed && exec?.reason && (
                <div role="alert" style={{ marginTop: 8, padding: '8px 10px', borderRadius: 12,
                    background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.35)' }}>
                    {isRTL ? '⚠️ آخر محاولة لم تنجح — ردّ المزوّد: ' : '⚠️ The last attempt failed — the provider said: '}
                    {exec.reason}
                </div>
            )}
            <button
                type="button" disabled={busy} onClick={doRefund}
                style={{
                    width: '100%', marginTop: 10, padding: '12px', borderRadius: 14, border: 'none',
                    background: busy ? 'var(--border-color)' : 'linear-gradient(135deg,#ef4444,#dc2626)',
                    color: busy ? 'var(--text-secondary)' : '#fff',
                    fontWeight: 900, fontSize: '0.8rem', cursor: busy ? 'default' : 'pointer',
                }}
            >
                {busy
                    ? (isRTL ? '⏳ جارٍ التنفيذ عند بوّابتك — لا تغلق الصفحة…' : '⏳ Executing at your gateway — do not close…')
                    : (failed
                        ? (isRTL ? '🔁 أعِد محاولة ردّ المبلغ' : '🔁 Retry the refund')
                        : (isRTL ? '↩️ ردّ المبلغ للمشتري' : '↩️ Refund the buyer'))}
            </button>
        </div>
    );
};

export default RefundButton;
