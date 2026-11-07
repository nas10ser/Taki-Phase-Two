/**
 * v15.76 — اختيارُ نافذة التقييم: جلبُ بياناتٍ لا توصيلُ حالة.
 *
 * خرج من `AppContext` لأن السقّافة رفضت نموّه (قاعدةُ v14.92: قلّص لا ترفع)
 * — والفصلُ هو الصحيح أصلاً: هنا نداءُ القاعدة وقراءةُ رفض الجهاز وجلبُ
 * العرض الغائب، وهناك ضبطُ الحالة وحده.
 */
import { supabase } from '../services/supabaseClient';
import { logger } from '../utils/logger';
import { dealRepository } from '../repositories/dealRepository';

export const RATE_DISMISS_KEY = 'taki_rate_dismissed_v1';

export type RatingPromptPick = {
    prompt: { barcode: string; dealId: string; storeId: string; storeName: string; myVote: boolean | null };
    step: 'auth' | 'rate';
    stars: number;
    prev: { id: string; dealId: string; score: number; comment: string } | null;
};

/** رفضُ «لاحقاً» محفوظٌ في الجهاز بنافذة ١٤ يوماً (والخادمُ يحفظ الإنجاز). */
export const loadRateDismissed = (): Record<string, number> => {
    try {
        const raw = localStorage.getItem(RATE_DISMISS_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        const cutoff = Date.now() - 14 * 24 * 3600 * 1000;
        return Object.fromEntries(
            Object.entries(parsed as Record<string, number>).filter(([, ts]) => Number(ts) > cutoff)
        );
    } catch { return {}; }   // وضعُ التصفّح الخاص يرمي عند مجرّد القراءة
};

export const pickRatingPrompt = async (o: {
    dismissed: Record<string, number>;
    prompted: Set<string>;
    deals: any[];
    ingestDeals: (d: any[]) => void;
    isAr: boolean;
}): Promise<RatingPromptPick | null> => {
    const { data, error } = await supabase.rpc('pending_rating_prompts');
    if (error) { logger.warn('pending_rating_prompts:', error.message); return null; }
    const rows: any[] = Array.isArray(data) ? data : [];
    const next = rows.find(r => r && r.barcode
        && !o.dismissed[r.barcode] && !o.prompted.has(r.barcode));
    if (!next) return null;

    // العرضُ غير محمَّل؟ اجلبه — خطوةُ «حقيقي/شكلي» تحتاج صفَّه لتعرض
    // التصويتَ السابق وتحدّثه.
    let deal = o.deals.find(x => x.id === next.deal_id);
    if (!deal) {
        try {
            const fetched = await dealRepository.getById(next.deal_id);
            if (fetched) { o.ingestDeals([fetched]); deal = fetched; }
        } catch { /* النافذة تُفتح بلا العرض — النجومُ لا تحتاجه */ }
    }

    // 🔴 v15.76 — التقييمُ السابق من **القاعدة** لا من العروض المحمَّلة: كان
    // البحثُ في `dealsRef` يُخطئ كلّما لم يكن عرضٌ لذلك المتجر في النافذة،
    // فتظنّ الواجهةُ «لا تقييم سابق» ⇒ يصطدم `addRating` بالفهرس الفريد
    // (تقييمٌ واحد لكلّ متجر) فيصير زرّاً صامتاً.
    const pr = next.prev_rating && typeof next.prev_rating === 'object' ? next.prev_rating : null;
    return {
        prompt: {
            barcode: next.barcode, dealId: next.deal_id, storeId: next.store_id,
            storeName: next.shop_name || deal?.shopName || (o.isAr ? 'المتجر' : 'the store'),
            myVote: typeof next.my_vote === 'boolean' ? next.my_vote : null,
        },
        // الخطوةُ الأولى = ما ينقص فعلاً: لم يصوّت ⇒ «حقيقي/شكلي»، وإلّا النجوم.
        step: next.has_vote ? 'rate' : 'auth',
        stars: pr ? Number(pr.score) : 5,
        prev: pr ? { id: String(pr.id), dealId: String(pr.deal_id), score: Number(pr.score), comment: pr.comment || '' } : null,
    };
};

/**
 * v15.77 — عددُ الطلبات التي تنتظر التاجر، للشارة على «لوحتي».
 * 🪤 العدُّ من الخادم: نافذةُ `bookings` المحمَّلة ٢٠٠ صفّاً **للطرفين معاً**،
 *    فتاجرٌ نشطٌ تكذب شارتُه. والمحلّيُّ أرضيّةٌ حتى يصل الجواب.
 */
export const openOrdersFloor = (bookings: any[], storeId: string | undefined): number => {
    if (!storeId) return 0;
    return bookings.filter(b => b.deal?.storeId === storeId
        && (b.status === 'pending' || b.status === 'acknowledged')
        && (!b.expiryTime || b.expiryTime > Date.now())).length;
};
