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

const map = (r: any): BookingRefund | null => r ? ({
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
            return map(data);
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
        opts: { note?: string; amount?: number; ref?: string; method?: string } = {},
    ): Promise<{ ok: boolean; error?: string; creditNoteNo?: string }> => {
        const { data, error } = await supabase.rpc('resolve_booking_refund', {
            p_barcode: barcode,
            p_action: action,
            p_note: opts.note || null,
            p_amount: opts.amount ?? null,
            p_ref: opts.ref || null,
            p_method: opts.method || null,
        });
        if (error) return { ok: false, error: error.message };
        const d: any = data || {};
        if (!d.ok) return { ok: false, error: d.error || 'FAILED' };
        return { ok: true, creditNoteNo: d.credit_note_no };
    },

    /** السياسة المعلنة لمتجر — يقرؤها الزائر قبل الحجز. */
    storePolicies: async (storeId: string): Promise<{ refundPolicy?: string; storeTerms?: string } | null> => {
        try {
            const { data } = await supabase.rpc('store_policies', { p_store_id: storeId });
            const d: any = data || null;
            if (!d) return null;
            return { refundPolicy: d.refund_policy || undefined, storeTerms: d.store_terms || undefined };
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
