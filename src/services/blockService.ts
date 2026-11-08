import { supabase } from './supabaseClient';

/**
 * blockService — الحجبُ بين شخصين (v15.80)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 لماذا وُجد: كان في التطبيق «حظرٌ» **لا يحجب**. `users.blocked_merchants`
 *    مصفوفةُ نصٍّ على صفِّ الحاجب، مفتاحُها *متجرٌ*، لا تقرؤها إلّا دوالُّ
 *    التصفية التي ترسم القوائم — وصفرُ دالّةٍ كاتبةٍ للرسائل تقرؤها. أي أنّ
 *    المحجوبَ كان يُراسلك ويصلك إشعارُه ودفعُه، والزرُّ يُخفي عروضَه فقط.
 *    ولا شكلَ فيه يحجب به **التاجرُ مشترياً**: اسمُ العمود يلزمه أن يعني عكسَه.
 *
 * فالمصدرُ الواحد الآن جدولُ `user_blocks` (الاتجاهان)، ويُفرَض في القاعدة
 * بمشغّلٍ على `booking_messages` نفسِه لا بشرطٍ داخل دالّة — لأنّ كتّابَ
 * المحادثة أكثرُ من واحد. و`users.blocked_merchants` صارت **مرآةً** يحفظها
 * مشغّلٌ واحد، فدوالُّ التصفية القائمة تعمل بلا إعادة كتابة.
 *
 * 🪤 ولا يعلم المحجوبُ أنه محجوب: سياسةُ القراءة تُظهر صفوفَ الحاجب وحده،
 *    فهذه الدالّةُ تُرجع **من حجبتَ أنت** ولا تستطيع أن تقول من حجبك. ولذلك
 *    نصُّ الرفض في الواجهة محايدٌ حين لا يكون الحجبُ حجبَك — وإلّا صار
 *    الحجبُ دعوةً للانتقام.
 *
 * 🪤 وكلُّ كتابةٍ تُفحص بـ`error` **وبعددِ الصفوف**: رفضُ RLS للحذف يعود
 *    بـ`error=null` وصفرِ صفوف، فزرٌّ لا يقرأ العدد يكذب (قاعدةُ الأزرار
 *    الصامتة). ولذلك `.select()` مُسلسلةٌ على الإدراج والحذف معاً.
 */

export interface BlockRow {
    /** معرّفُ الطرف المحجوب (حسابُ متجرٍ أو مشترٍ — الجدولُ لا يفرّق). */
    blockedId: string;
    reason: string | null;
    /** ISO. عليها تُحسب رسائلُ الطلب الجاري المسموحة — فلا تُستعمل للعرض فقط. */
    createdAt: string;
}

export type BlockResult = { ok: true } | { ok: false; error: string };

/**
 * ذاكرةٌ على مستوى الوحدة: كلُّ بطاقةِ طلبٍ تُركّب `BookingThread`، فجلبُ
 * القائمة لكلٍّ منها كان سيصير عشرةَ نداءاتٍ في شاشةٍ واحدة. والمشتركون
 * يُستدعَون بعد كلّ كتابة فلا تبقى شاشةٌ على حالةٍ قديمة.
 */
let cache: BlockRow[] | null = null;
let inflight: Promise<BlockRow[]> | null = null;
const listeners = new Set<(rows: BlockRow[]) => void>();

const announce = (rows: BlockRow[]) => {
    cache = rows;
    for (const fn of listeners) {
        // مشتركٌ واحدٌ يرمي لا يُسقط البقيّة.
        try { fn(rows); } catch { /* غير قاتل */ }
    }
};

const fetchRows = async (): Promise<BlockRow[]> => {
    const { data, error } = await supabase
        .from('user_blocks')
        .select('blocked_id, reason, created_at')
        .order('created_at', { ascending: false });
    if (error) {
        // زائرٌ بلا حساب أو جلسةٌ منتهية: قائمةٌ فارغة لا شاشةٌ مكسورة.
        console.warn('blocks fetch failed:', error.message);
        return [];
    }
    return (data || []).map((r: any) => ({
        blockedId: r.blocked_id,
        reason: r.reason ?? null,
        createdAt: r.created_at,
    }));
};

export const blockService = {
    /** ما في الذاكرة الآن بلا شبكة — للرسم الأوّل بلا وميض. */
    peek: (): BlockRow[] | null => cache,

    /** من حجبتَ أنت. يُجلب مرّةً ويُشارَك بين كلّ من يسأل في نفس اللحظة. */
    list: async (force = false): Promise<BlockRow[]> => {
        if (!force && cache) return cache;
        if (!inflight) {
            inflight = fetchRows().finally(() => { inflight = null; });
        }
        const rows = await inflight;
        announce(rows);
        return rows;
    },

    /**
     * حجبُ طرف. السببُ اختياريٌّ وسقفُه في القاعدة ٣٠٠ محرفاً.
     * 🪤 و`blockerId` يُمرَّر ولا يُسأل عنه `auth.getUser()`: ذاك نداءُ شبكةٍ
     *    لكلّ نقرة، والمنادي يملك المعرّفَ أصلاً. وسياسةُ RLS هي الحَكَم على
     *    كلّ حالٍ (`uid() = blocker_id`) فلا يُغني تمريرُه عن شيء.
     */
    block: async (blockerId: string, blockedId: string, reason?: string): Promise<BlockResult> => {
        if (!blockerId) return { ok: false, error: 'auth' };
        if (blockerId === blockedId) return { ok: false, error: 'self' };

        const clean = (reason || '').trim();
        const { data, error } = await supabase
            .from('user_blocks')
            .insert({
                blocker_id: blockerId,
                blocked_id: blockedId,
                reason: clean ? clean.slice(0, 300) : null,
            })
            .select('blocked_id');

        // 23505 = الصفُّ موجودٌ أصلاً ⇒ النتيجةُ المطلوبة قائمة، لا خطأ.
        if (error && error.code !== '23505') return { ok: false, error: error.message };
        if (!error && (!data || data.length === 0)) return { ok: false, error: 'rejected' };
        await blockService.list(true);
        return { ok: true };
    },

    /** فكُّ الحجب **حذفٌ** لا تعديلُ عَلَم — ولا UPDATE ممنوحٌ على الجدول. */
    unblock: async (blockerId: string, blockedId: string): Promise<BlockResult> => {
        if (!blockerId) return { ok: false, error: 'auth' };

        const { error } = await supabase
            .from('user_blocks')
            .delete()
            .eq('blocker_id', blockerId)
            .eq('blocked_id', blockedId)
            .select('blocked_id');

        if (error) return { ok: false, error: error.message };
        // 🪤 صفرُ صفوفٍ بلا خطأ يعني أحدَ أمرين: رفضَ RLS، أو صفّاً غيرَ
        //    موجودٍ أصلاً — والثاني نتيجةٌ مطلوبة. فالحُكمُ على **الحالة بعد
        //    الكتابة** لا على العدد: يُعاد الجلبُ ويُسأل هل بقي الصفّ.
        const rows = await blockService.list(true);
        if (rows.some(r => r.blockedId === blockedId)) return { ok: false, error: 'rejected' };
        return { ok: true };
    },

    /** يُستدعى بعد كلّ تغيير، ويُرجع دالّةَ إلغاءِ الاشتراك. */
    subscribe: (fn: (rows: BlockRow[]) => void): (() => void) => {
        listeners.add(fn);
        return () => { listeners.delete(fn); };
    },

    /** خروجُ مستخدمٍ ودخولُ آخر: لا تُسرَّب قائمةُ الأوّل إلى الثاني. */
    reset: () => { cache = null; inflight = null; },
};
