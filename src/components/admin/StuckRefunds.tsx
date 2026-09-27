/**
 * StuckRefunds — مخرجُ ناصر من استردادٍ عالق (v15.00)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 لماذا وُجدت هذه الشاشة أصلاً — وهو أهمّ ما فيها:
 *    حين تُنادى بوّابةُ الدفع **بعد** حجز الصفّ ثمّ يموت الاتصال أو تردّ
 *    البوّابة حالةً ملتبسة، تبقى النتيجة **مجهولة**: قد يكون المال خرج وقد
 *    لا يكون. والنظام حينها **لا يحرّر الحجز تلقائياً عمداً** — لأن تحريره
 *    يعني أن نقرةً ثانية قد تُخرج المبلغ مرّتين، وأربعٌ من ستّ بوّابات
 *    (ميسر · تاب · باي‑تابس · هايبر‑باي) لا تدعم مفتاح تكرارٍ إطلاقاً.
 *    فطلبٌ عالقٌ أرخص من خصمٍ مزدوج.
 *
 *    لكن قبل هذه الشاشة لم يكن للحجز مخرجٌ إلا بمبرمج: `taki_settle_booking_refund`
 *    ممنوحةٌ لـ`service_role` وحده. أي أن ناصراً يقف أمام طلبٍ مجمّد وتاجرٍ
 *    ينتظر ومشترٍ لا يعلم، بلا زرّ. **وكلُّ حالةٍ تُنتجها المنصّة يجب أن يكون
 *    له منها مخرجٌ بضغطة.**
 *
 * وما تفعله هذه الشاشة ليس تخميناً: ناصر يفتح كشف حساب البوّابة، ينظر هل خرج
 * المال أم لا، ثمّ يقول أيّهما — وتُسجَّل حجّتُه ومن قالها ومتى في سجلّ العمليات.
 *
 * 🪤 ولا يُعطى هذا الزرّ للتاجر: الحالة العالقة تعني «قد يكون المال خرج»،
 *    والتاجر صاحبُ مصلحةٍ في أن يقول «لم يخرج» ليُعيد المحاولة فيخرج مرّتين.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../services/supabaseClient';
import { arCount, MINUTES, HOURS } from '../../utils/arPlural';
import { AdmSection, AdmButton, AdmEmpty, AdmError } from './ui';
import { CopyButton } from './CopyButton';

interface StuckRow {
    barcode: string;
    claimed_at: string | null;
    age_minutes: number;
    amount: number | null;
    provider: string | null;
    payment_ref: string | null;
    reason: string | null;
    store_name: string;
    buyer_name: string;
    buyer_phone: string | null;
    item: string;
}

/** «منذ ٤٠ دقيقة» / «منذ ٣ ساعات» — بلا جمعٍ مكتوبٍ بيد. */
const since = (mins: number): string => (mins < 60
    ? `منذ ${arCount(Math.max(0, Math.round(mins)), MINUTES)}`
    : `منذ ${arCount(Math.round(mins / 60), HOURS)}`);

export const StuckRefunds: React.FC = () => {
    const { customAlert, customConfirm, customPrompt } = useApp();
    const [rows, setRows] = useState<StuckRow[] | null>(null);
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState('');

    const load = useCallback(async () => {
        setErr('');
        const { data, error } = await supabase.rpc('admin_stuck_refunds', { p_limit: 50 });
        if (error) { setErr(error.message); setRows([]); return; }
        const payload: any = data;
        if (!payload?.ok) { setErr('تعذّرت القراءة.'); setRows([]); return; }
        setRows((payload.rows || []) as StuckRow[]);
    }, []);

    useEffect(() => { load(); }, [load]);

    const decide = async (r: StuckRow, outcome: 'refunded' | 'failed') => {
        const money = r.amount != null ? `${r.amount} ر.س` : 'المبلغ';
        const head = outcome === 'refunded'
            ? `تؤكّد أن ${money} **خرج فعلاً** من حساب التاجر إلى المشتري؟`
            : `تؤكّد أن ${money} **لم يخرج** من حساب التاجر؟`;
        const tail = outcome === 'refunded'
            ? '\n\nسيُغلق الطلب مُردّاً، وتعود الكمّية للبيع، ويصل المشتري إشعارٌ بأن مبلغه رُدّ.'
            : '\n\nسيُحرَّر القفل فيستطيع التاجر إعادة المحاولة. ولو كان المال قد خرج فعلاً، فإعادةُ المحاولة تُخرجه مرّة ثانية.';
        const ok = await customConfirm(
            `⚠️ قرارٌ ماليّ على الطلب ${r.barcode}\n\n${head}\n` +
            `افتح كشف حساب ${r.provider || 'البوّابة'} وتأكّد قبل أن تجيب — ` +
            `فالنظام لا يعرف الجواب، ولذلك يسألك.${tail}`);
        if (!ok) return;

        // 🪤 الحجّة إلزامية في القاعدة (١٠ محارف): بعد شهرٍ لن يتذكّر أحدٌ لماذا
        //    قيل «خرج» أو «لم يخرج»، ومصدرُ القرار الوحيد ما رآه إنسان.
        const note = await customPrompt(
            `اكتب ما رأيتَه في كشف ${r.provider || 'البوّابة'} (عشرة أحرف على الأقلّ) — يُحفظ مع القرار:`);
        if (!note || note.trim().length < 10) {
            await customAlert('⚠️ لم يُسجَّل القرار: الحجّة مطلوبة ولا تقلّ عن عشرة أحرف.');
            return;
        }

        setBusy(r.barcode);
        const { data, error } = await supabase.rpc('admin_unstick_refund', {
            p_barcode: r.barcode, p_outcome: outcome, p_note: note.trim(), p_refund_ref: null,
        });
        setBusy('');
        if (error) { await customAlert('❌ ' + error.message); return; }
        if (!(data as any)?.ok) { await customAlert('❌ لم يُنفَّذ القرار.'); return; }
        await customAlert(outcome === 'refunded'
            ? '✅ سُجّل أن المبلغ رُدّ — وأُشعر المشتري.'
            : '✅ حُرّر القفل — يستطيع التاجر إعادة المحاولة.');
        await load();
    };

    // لا تُرسم الشاشة إطلاقاً حين لا عالق — فلا تُزحم لوحةً بلا سبب.
    if (rows !== null && rows.length === 0 && !err) return null;

    return (
        <AdmSection
            title="ردودٌ عالقة"
            icon="⚠️"
            desc="استردادٌ نُودي فيه المزوّد ولم تصلنا نتيجته. النظام لا يفكّه وحده عمداً — قرارُك أنت بعد أن تنظر في كشف البوّابة."
        >
            {err && <AdmError message={err} onRetry={load} />}

            {rows === null && (
                <p style={{ fontSize: '.78rem', color: 'var(--adm-fg-3)', margin: 0 }}>جارٍ القراءة…</p>
            )}

            {rows !== null && rows.length === 0 && !err && (
                <AdmEmpty icon="✅" title="لا استردادَ عالقاً" hint="كل الردود وصلت نتيجتها." />
            )}

            {rows !== null && rows.length > 0 && (
                <div style={{ display: 'grid', gap: 10 }}>
                    <p style={{ fontSize: '.76rem', lineHeight: 1.9, color: 'var(--adm-fg-2)', margin: 0 }}>
                        🪤 <strong style={{ color: 'var(--adm-fg)' }}>لا تخمّن.</strong> أربعٌ من ستّ بوّابات لا تمنع
                        الردّ مرّتين، فإجابةُ «لم يخرج» وهو قد خرج تُخرجه ثانيةً من حساب التاجر.
                    </p>
                    {rows.map(r => (
                        <div key={r.barcode} style={{
                            padding: 12, borderRadius: 'var(--adm-r-sm)',
                            border: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                                <span style={{ fontSize: '1rem', fontWeight: 900, color: 'var(--adm-fg)', letterSpacing: '.5px' }}>
                                    {r.barcode}
                                </span>
                                <CopyButton value={r.barcode} label="نسخ رقم الطلب" />
                                <span style={{ fontSize: '.73rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>
                                    {since(r.age_minutes)}
                                </span>
                            </div>
                            <div style={{ fontSize: '.78rem', lineHeight: 1.9, color: 'var(--adm-fg-2)' }}>
                                {r.item} · <strong style={{ color: 'var(--adm-fg)' }}>{r.amount != null ? `${r.amount} ر.س` : '—'}</strong>
                                <br />
                                التاجر: {r.store_name} · المشتري: {r.buyer_name}
                                <br />
                                البوّابة: {r.provider || '—'}
                                {r.payment_ref && <> · مرجع العملية: <code style={{ fontSize: '.72rem' }}>{r.payment_ref}</code></>}
                                {r.reason && <><br />سبب الردّ: {r.reason}</>}
                            </div>
                            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                                <AdmButton variant="primary" disabled={busy === r.barcode}
                                    onClick={() => decide(r, 'refunded')}>
                                    {busy === r.barcode ? 'جارٍ…' : '✅ خرج المال — أغلِقه مُردّاً'}
                                </AdmButton>
                                <AdmButton disabled={busy === r.barcode}
                                    onClick={() => decide(r, 'failed')}>
                                    ↩️ لم يخرج — حرّر القفل
                                </AdmButton>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </AdmSection>
    );
};

export default StuckRefunds;
