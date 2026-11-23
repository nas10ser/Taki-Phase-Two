/**
 * outageCreditRepository — تعويضُ الأعطال (v16.54)
 * ═══════════════════════════════════════════════════════════════════════════
 * أمرُ ناصر: «زرّ إرجاع المبلغ بضغطةٍ واحدة من الأدمن للتاجر، أو أحدّد تجّاراً
 * معيّنين، أو تحديد الكل، في حال وجود أعطال».
 *
 * 🔴 **ولماذا نوعان لا نوعٌ واحد** — والسببُ قياسٌ لا تفضيل: `subscription_payments`
 *    فيه صفّان كلاهما `gifted`، ومسارُ دفع الاشتراك في `paymentService.ts`
 *    **محاكاةٌ** (`setTimeout` ثمّ `success:true`). أي أن تاكي **لم تستقبل
 *    ريالاً من تاجرٍ قطّ**، فلا مالَ في حوزتها تردُّه برمجياً:
 *      · `days` ⇒ أيّامُ اشتراكٍ تُضاف **فوراً ويقيناً** (تاكي تملكها كاملةً).
 *      · `cash` ⇒ يُسجَّل **التزاماً مستحقّاً** ويُشعَر به التاجر، ثمّ يُحوّله
 *        ناصر بنكياً ويختمه بمرجع. ولا يُقال «رُدّ» قبل المرجع — نفسُ منطق
 *        `booking_refunds`: تُسجّل وتُبلّغ وتُثبت ولا تدّعي ما لم يقع.
 *
 * 🪤 ومفتاحُ التكرار يُولَّد **مرّةً واحدةً عند فتح النموذج** لا عند الضغط:
 *    لو وُلِّد عند الضغط لصار لكلّ ضغطةٍ مفتاحٌ جديد — أي لا حمايةَ أصلاً.
 */
import { supabase } from '../services/supabaseClient';
import { logger } from '../utils/logger';

export type CreditScope = 'all' | 'selected' | 'subscribed';
export type CreditKind = 'days' | 'cash';
export type CreditStatus = 'applied' | 'pending_cash' | 'paid' | 'failed';

export interface ScopeRow {
    merchantId: string;
    shop: string;
    expiresAt: string | null;
}

export interface CreditPreview {
    count: number;
    rows: ScopeRow[];
    /** مجموعُ المبلغ — يحسبه **الخادم** لا المتصفّح (رقمٌ يُقرَّر عليه). */
    totalAmount: number | null;
}

export interface CreditRow {
    id: string;
    batchId: string;
    merchantId: string;
    shop: string;
    kind: CreditKind;
    days: number | null;
    amount: number | null;
    status: CreditStatus;
    reason: string;
    expiresBefore: string | null;
    expiresAfter: string | null;
    transferRef: string | null;
    transferNote: string | null;
    createdAt: string;
    settledAt: string | null;
}

const mapScope = (d: any): ScopeRow => ({
    merchantId: String(d.merchant_id),
    shop: String(d.shop || 'متجر'),
    expiresAt: d.expires_at ?? null,
});

const mapRow = (d: any): CreditRow => ({
    id: d.id,
    batchId: d.batch_id,
    merchantId: d.merchant_id,
    shop: String(d.shop || 'متجر'),
    kind: d.kind as CreditKind,
    days: d.days == null ? null : Number(d.days),
    amount: d.amount == null ? null : Number(d.amount),
    status: d.status as CreditStatus,
    reason: String(d.reason || ''),
    expiresBefore: d.expires_before ?? null,
    expiresAfter: d.expires_after ?? null,
    transferRef: d.transfer_ref ?? null,
    transferNote: d.transfer_note ?? null,
    createdAt: d.created_at,
    settledAt: d.settled_at ?? null,
});

/**
 * رموزُ الرفض ونصُّها — **مكانٌ واحد**، والدوالُّ تُرجع الرمزَ لا الجملة
 * (نفسُ قاعدة `verificationRepository`).
 */
const ERRORS: Record<string, string> = {
    FORBIDDEN:          'لا تملك صلاحية «تعويض الأعطال». اطلبها من الأدمن الأعلى.',
    BAD_SCOPE:          'اختر من تُعوّض: تاجراً، أو المشتركين، أو الكل.',
    BAD_KIND:           'اختر نوع التعويض.',
    BAD_DAYS:           'عدد الأيام يجب أن يكون بين يومٍ واحد و٣٦٥ يوماً.',
    BAD_AMOUNT:         'المبلغ يجب أن يكون أكبر من صفر ولا يتجاوز ٥٠٬٠٠٠ ر.س.',
    REASON_REQUIRED:    'اكتب سبب التعويض — يُحفظ في السجلّ ويصل التاجر مع الإشعار.',
    BATCH_KEY_REQUIRED: 'تعذّر تأمين الطلب ضد التكرار. حدّث الصفحة وأعد المحاولة.',
    EMPTY_SCOPE:        'لا يوجد تاجرٌ ضمن هذا النطاق.',
    SCOPE_TOO_LARGE:    'النطاق أكبر من ٥٠٠ تاجراً في الدفعة الواحدة. قسّمه.',
    TOO_MANY:           'نفّذت دفعاتٍ كثيرة في الساعة الأخيرة. انتظر قليلاً.',
    NOT_FOUND:          'لم أجد هذا التعويض — حدّث القائمة.',
    NOT_CASH:           'هذا تعويضُ أيامٍ لا مبلغ — لا تحويل له.',
    BAD_STATE:          'حالة هذا التعويض لا تسمح بالختم الآن.',
    REF_REQUIRED:       'اكتب مرجع التحويل البنكي — بدونه لا يُختم «حُوِّل».',
};

export const creditErrorText = (code: string | null | undefined): string | null =>
    (code && ERRORS[code]) || null;

export const outageCreditRepository = {
    /** من سيُشمل وكم — **يُقاس قبل أن يُضغط**. */
    preview: async (scope: CreditScope, ids: string[] | null, kind: CreditKind,
                    days: number | null, amount: number | null):
        Promise<{ ok: boolean; data?: CreditPreview; error?: string; msg?: string }> => {
        const { data, error } = await supabase.rpc('admin_preview_outage_credit', {
            p_scope: scope, p_ids: ids, p_kind: kind, p_days: days, p_amount: amount,
        });
        if (error) { logger.error('credit preview', error); return { ok: false, msg: error.message }; }
        if (data?.ok !== true) return { ok: false, error: String(data?.error || '') };
        return {
            ok: true,
            data: {
                count: Number(data.count) || 0,
                rows: (data.rows || []).map(mapScope),
                totalAmount: data.total_amount == null ? null : Number(data.total_amount),
            },
        };
    },

    grant: async (p: {
        batchKey: string; scope: CreditScope; ids: string[] | null;
        kind: CreditKind; days: number | null; amount: number | null; reason: string;
    }): Promise<{ ok: boolean; granted?: number; skipped?: number; error?: string; msg?: string }> => {
        const { data, error } = await supabase.rpc('admin_grant_outage_credit', {
            p_batch_key: p.batchKey, p_scope: p.scope, p_ids: p.ids,
            p_kind: p.kind, p_days: p.days, p_amount: p.amount, p_reason: p.reason,
        });
        if (error) { logger.error('credit grant', error); return { ok: false, msg: error.message }; }
        // 🪤 `ok:false` يصل بـ`error=null` — فمن يفحص الخطأ وحده يقول «تمّ» عن لا شيء.
        if (data?.ok !== true) return { ok: false, error: String(data?.error || '') };
        return { ok: true, granted: Number(data.granted) || 0, skipped: Number(data.skipped) || 0 };
    },

    settle: async (id: string, ok: boolean, ref?: string, note?: string):
        Promise<{ ok: boolean; already?: boolean; error?: string; msg?: string }> => {
        const { data, error } = await supabase.rpc('admin_settle_outage_cash', {
            p_id: id, p_ok: ok, p_ref: ref ?? null, p_note: note ?? null,
        });
        if (error) { logger.error('credit settle', error); return { ok: false, msg: error.message }; }
        if (data?.ok !== true) return { ok: false, error: String(data?.error || '') };
        return { ok: true, already: data.already === true };
    },

    list: async (status: CreditStatus | 'all' = 'all'):
        Promise<{ ok: boolean; rows?: CreditRow[]; pendingCash?: number; pendingAmount?: number; msg?: string }> => {
        const { data, error } = await supabase.rpc('admin_list_outage_credits', {
            p_status: status, p_limit: 300,
        });
        if (error) { logger.error('credit list', error); return { ok: false, msg: error.message }; }
        if (data?.ok !== true) return { ok: false, msg: String(data?.error || '') };
        return {
            ok: true,
            rows: (data.rows || []).map(mapRow),
            pendingCash: Number(data.pending_cash) || 0,
            pendingAmount: Number(data.pending_amount) || 0,
        };
    },
};

export default outageCreditRepository;
