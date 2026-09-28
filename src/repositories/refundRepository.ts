/**
 * refundRepository — طلب الإلغاء والاسترداد على طلبٍ مدفوع (v14.18)
 * ═══════════════════════════════════════════════════════════════════════════
 * المبدأ: **تاكي وسيط ولا تملك المال.** الدفع المباشر يذهب من بطاقة المشتري
 * إلى حساب التاجر (٠٪ عمولة، لا تمرّ الأموال بالمنصّة أصلاً)، فلا تستطيع
 * المنصّة أن تردّ مبلغاً لا تحتفظ به. دورها: تُسجّل الطلب، وتُبلّغ الطرفين،
 * وتُثبت ما جرى بتاريخ ومرجع ومبلغ، وتُظهره إشعاراً دائناً على الفاتورة.
 * القرار والتنفيذ للتاجر وفق سياسته المعلنة.
 *
 * كل الكتابات عبر دوال SECURITY DEFINER على القاعدة — لا يكتب المتصفّح صفّاً
 * واحداً في `booking_refunds` مباشرة (لا سياسة كتابة عليها أصلاً).
 */

import { supabase } from '../services/supabaseClient';
import { logger } from '../utils/logger';

export type RefundStatus = 'requested' | 'declined' | 'approved' | 'refunded' | 'withdrawn';

/**
 * v14.97 — حالةُ **التنفيذ** على صفّ الحجز نفسه، لا حالةُ الطلب أعلاه.
 * `null` لم يُطلب قطّ · `claiming` نداءٌ جارٍ عند المزوّد (قفل) ·
 * `refunded` خرج المال فعلاً · `failed` ردَّ المزوّد بالرفض (تُعاد المحاولة).
 */
export type RefundExecState = 'claiming' | 'refunded' | 'failed';

export interface RefundExec {
    state: RefundExecState | null;
    claimedAt: string | null;
    refundedAt: string | null;
    ref: string | null;
    amount: number | null;
    reason: string | null;
}

const EXEC_COLS = 'refund_state, refund_claimed_at, refunded_at, refund_ref, refund_amount, refund_reason';

export interface BookingRefund {
    barcode: string;
    status: RefundStatus;
    amount: number;
    openedBy: 'buyer' | 'seller' | 'admin';
    reason?: string | null;
    requestedAt?: string | null;
    merchantNote?: string | null;
    decidedAt?: string | null;
    refundedAt?: string | null;
    refundAmount?: number | null;
    refundRef?: string | null;
    refundMethod?: string | null;
    creditNoteNo?: string | null;
}

/** يحوّل صفّ القاعدة إلى الشكل الذي تقرؤه الواجهة. مُصدَّر لأن الصفّ
 *  قد يصل داخل `browse_bookings` بلا نداء منفصل (v14.24). */
export const mapRefundRow = (r: any): BookingRefund | null => r ? ({
    barcode: r.barcode,
    status: r.status,
    amount: Number(r.amount) || 0,
    openedBy: r.opened_by,
    reason: r.reason ?? null,
    requestedAt: r.requested_at ?? null,
    merchantNote: r.merchant_note ?? null,
    decidedAt: r.decided_at ?? null,
    refundedAt: r.refunded_at ?? null,
    refundAmount: r.refund_amount != null ? Number(r.refund_amount) : null,
    refundRef: r.refund_ref ?? null,
    refundMethod: r.refund_method ?? null,
    creditNoteNo: r.credit_note_no ?? null,
}) : null;

export const refundRepository = {
    /** حالة الاسترداد لطلبٍ واحد — null إن لم يُفتح طلب بعد. */
    get: async (barcode: string): Promise<BookingRefund | null> => {
        try {
            const { data, error } = await supabase.rpc('get_booking_refund', { p_barcode: barcode });
            if (error) { logger.warn('get_booking_refund:', error.message); return null; }
            return mapRefundRow(data);
        } catch { return null; }
    },

    /** المشتري يطلب إلغاءً واسترداداً. يُرجع رسالة خطأ عربية عند الرفض. */
    request: async (barcode: string, reason?: string): Promise<{ ok: boolean; error?: string; status?: string }> => {
        const { data, error } = await supabase.rpc('request_booking_refund', {
            p_barcode: barcode, p_reason: reason || null,
        });
        if (error) return { ok: false, error: error.message };
        const d: any = data || {};
        if (!d.ok) return { ok: false, error: d.error || 'FAILED' };
        return { ok: true, status: d.status };
    },

    /** المشتري يسحب طلبه. */
    withdraw: async (barcode: string): Promise<{ ok: boolean; error?: string }> => {
        const { data, error } = await supabase.rpc('withdraw_booking_refund', { p_barcode: barcode });
        if (error) return { ok: false, error: error.message };
        const d: any = data || {};
        return d.ok ? { ok: true } : { ok: false, error: d.error || 'FAILED' };
    },

    /**
     * قرار التاجر. `action`:
     *  - `decline` يرفض وفق سياسته المعلنة — الطلب يبقى قائماً
     *  - `refund`  يُثبت ردّ المال بمرجع ومبلغ ⇒ يُلغى الطلب ويصدر إشعار دائن
     *  - `open`    يفتحها بنفسه حين يُلغي طلباً مدفوعاً (نفاد بضاعة) فيُسجَّل الدَّين
     */
    resolve: async (
        barcode: string,
        action: 'decline' | 'refund' | 'open',
        opts: { note?: string; amount?: number; ref?: string; method?: string; restock?: boolean } = {},
    ): Promise<{ ok: boolean; error?: string; creditNoteNo?: string; orderCancelled?: boolean }> => {
        const { data, error } = await supabase.rpc('resolve_booking_refund', {
            p_barcode: barcode,
            p_action: action,
            p_note: opts.note || null,
            p_amount: opts.amount ?? null,
            p_ref: opts.ref || null,
            p_method: opts.method || null,
            // v15.09 — «رجعت البضاعة؟» قرارُ التاجر في هذا الطلب، لا إعدادُ متجره
            p_restock: typeof opts.restock === 'boolean' ? opts.restock : null,
        });
        if (error) return { ok: false, error: error.message };
        const d: any = data || {};
        if (!d.ok) return { ok: false, error: d.error || 'FAILED' };
        return { ok: true, creditNoteNo: d.credit_note_no, orderCancelled: !!d.order_cancelled };
    },

    /**
     * السياسة المعلنة لمتجر — يقرؤها الزائر قبل الحجز.
     * 🪤 يجب التفريق بين «أجاب الخادم ولا سياسة» و«لم يُجب»: كان الفشل العابر
     * يُترجَم على الشاشة «لم يُعلن هذا المتجر سياسة استرداد» — نفيٌ قاطع عن
     * تاجرٍ أعلنها. `ok:false` تعني «تعذّرت القراءة»، لا «لا شيء».
     */
    storePolicies: async (storeId: string): Promise<{ ok: boolean; refundPolicy?: string; storeTerms?: string }> => {
        try {
            const { data, error } = await supabase.rpc('store_policies', { p_store_id: storeId });
            if (error) { logger.warn('store_policies:', error.message); return { ok: false }; }
            const d: any = data || {};
            return { ok: true, refundPolicy: d.refund_policy || undefined, storeTerms: d.store_terms || undefined };
        } catch { return { ok: false }; }
    },

    /**
     * v14.97 — **الردّ الفعليّ بضغطة**: يأمر بوّابة التاجر نفسها بإعادة المبلغ.
     * ═══════════════════════════════════════════════════════════════════════
     * 🔴 وهذا غير `resolve(...,'refund')` تماماً: تلك **تسجّل** ردّاً أجراه
     *    التاجر بيده خارج المنصّة؛ وهذه **تُجريه**. المالُ يخرج من حساب التاجر
     *    عند مزوّده — لا من تاكي، فتاكي لا تملك ريالاً منه أصلاً.
     *
     * والقفلُ في القاعدة لا هنا: `taki_claim_booking_refund` تُرجع `ok` مرّةً
     * واحدة لكلّ ردّ، فضغطتان متلاحقتان أو تبويبان لا يُخرجان المبلغ مرّتين.
     * ودورُ هذه الدالّة أن تنقل سببَ المزوّد كما هو — لا أن تُترجمه إلى
     * «تعذّر الاتصال» فيبقى التاجر لا يعرف لماذا رفضت بوّابته.
     */
    refundPaid: async (
        barcode: string, reason?: string, restock?: boolean | null,
    ): Promise<{ ok: boolean; error?: string; detail?: string; amount?: number; creditNoteNo?: string; settleFailed?: boolean }> => {
        try {
            const { data, error } = await supabase.functions.invoke('merchant-pay', {
                // v15.09 — جوابُ التاجر لهذا الردّ بعينه. `undefined` = لم يُسأل
                //           ⇒ يُؤخذ الجواب المقترَح من ملفّ المتجر.
                body: { op: 'refund', barcode, reason: reason || null,
                        ...(typeof restock === 'boolean' ? { restock } : {}) },
            });
            let payload: any = data;
            // 🪤 دالّةُ الحافة تردّ التفاصيل في جسمٍ بحالةٍ غير 2xx، و`invoke`
            //    تجعله `error` وتُخفي الجسم — فيُقرأ من `context` كما في
            //    مسار «ادفع الآن» (Bookings.tsx). بدونه يضيع سببُ المزوّد.
            if (error) {
                try { payload = await (error as any).context?.json?.(); } catch { /* ردٌّ غير JSON */ }
                if (!payload) return { ok: false, error: 'NETWORK', detail: error.message };
            }
            if (payload?.ok) {
                return {
                    ok: true, amount: Number(payload.amount) || undefined,
                    creditNoteNo: payload.credit_note_no || undefined,
                    settleFailed: !!payload.settle_failed,
                };
            }
            // 🪤 رفضُ المزوّد يعود بحالة 2xx وبمفتاح `reason` لا `error` — وقراءةُ
            //    `error` وحدها كانت تبتلعه وتعرض «REFUND_FAILED» العامّة، وهي
            //    بالضبط الجملةُ التي بُني هذا المسار كلّه على تجنّبها.
            const code = payload?.error || payload?.reason;
            return { ok: false, error: code || 'REFUND_FAILED', detail: payload?.detail || undefined };
        } catch (e) {
            return { ok: false, error: 'NETWORK', detail: (e as Error)?.message };
        }
    },

    /**
     * v14.97 — حالةُ التنفيذ على صفّ الحجز. تُقرأ من الجدول مباشرةً
     * (`bookings_select_own` تسمح للتاجر والمشتري بصفّهما وحده).
     * 🪤 `null` هنا تعني «لم يُطلب ردٌّ قطّ» — ولا تعني «تعذّرت القراءة»:
     *    الفشلُ يعود `null` أيضاً، ولذلك لا يُبنى عليه نفيٌ قاطع في الشاشة،
     *    بل تبقى الأزرار كما هي (درس `storePolicies` أعلاه).
     */
    execState: async (barcode: string): Promise<RefundExec | null> => {
        try {
            const { data, error } = await supabase
                .from('bookings').select(EXEC_COLS).eq('barcode', barcode).maybeSingle();
            if (error) { logger.warn('refund execState:', error.message); return null; }
            if (!data) return null;
            const r: any = data;
            return {
                state: (r.refund_state as RefundExecState) ?? null,
                claimedAt: r.refund_claimed_at ?? null,
                refundedAt: r.refunded_at ?? null,
                ref: r.refund_ref ?? null,
                amount: r.refund_amount != null ? Number(r.refund_amount) : null,
                reason: r.refund_reason ?? null,
            };
        } catch { return null; }
    },

    /** التاجر يحفظ سياسته وشروطه. */
    savePolicies: async (refundPolicy: string, storeTerms: string): Promise<{ ok: boolean; error?: string }> => {
        const { data, error } = await supabase.rpc('merchant_set_policies', {
            p_refund_policy: refundPolicy || null, p_store_terms: storeTerms || null,
        });
        if (error) return { ok: false, error: error.message };
        const d: any = data || {};
        return d.ok ? { ok: true } : { ok: false, error: d.error || 'FAILED' };
    },
};
