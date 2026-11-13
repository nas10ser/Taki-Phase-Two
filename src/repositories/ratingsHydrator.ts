/**
 * ratingsHydrator — مسارٌ واحدٌ لجلب قوائم التقييمات (v16.24)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 **ما قِيس على الإنتاج** (فتحُ `/store/<id>` مباشرةً، ١٣ نوفمبر ٢٠٢٦):
 *    نداءان لـ`ratings` بفارق **٣١ م.ث**، ومجموعتا المعرّفات فيهما **متطابقتان
 *    تقريباً** — نفسُ الصفوف تُنزَّل مرّتين:
 *      ① `getFeedPage()` عند الإقلاع يُرطّب تقييمات ٣١ عرضاً.
 *      ② `getByStore(id)` يُرطّب تقييمات عروض المتجر — وأغلبُها من الأولى.
 *    وثالثةٌ كانت تختبئ في `getAll()`: **نسخةٌ ثانيةٌ من نفس الكود** مكتوبةٌ
 *    بيدها داخلها (نسختان تنحرفان — وهو درسٌ مدفوعُ الثمن في هذا المشروع).
 *
 * ⇒ مسارٌ واحد: `hydrateRatingsFor(ids)` يسأل عمّا **لا يملكه فقط**، ويشارك
 *   الطلبَ الطائر، ويحتفظ بالجواب ستّين ثانية. فنداءان متداخلان يصيران واحداً.
 *
 * 🪤 و**التقييماتُ ليست عدّادات**: المتوسّطُ والعددُ مثبّتان على صفّ العرض
 *    (`rating_avg`/`rating_count`) و`DealCard` يقرؤهما مباشرةً منذ v13.24.
 *    فهذه القائمةُ للعرض وحده (مراجعاتُ المتجر · تفاصيلُ العرض · تقييماتُ
 *    لوحة التاجر) — ولذلك تحتمل ذاكرةً قصيرة.
 * 🔴 ولا تحتمل ذاكرةً **بلا إبطال**: من يكتب تقييماً يجب أن يراه فوراً.
 *    `invalidateRatings(dealId)` يُنادى من كلّ مسار كتابةٍ في `AppContext`.
 */
import { supabase } from '../services/supabaseClient';

export interface HydratedRating {
    id: string; userId: string; userName: string; score: number; comment: string;
    date: string; reply?: string; repliedBy?: string; repliedAt?: string;
    likedBy: string[]; likeCount: number;
}

/** سقفُ الصفوف لكلّ طلب — منتجٌ رائجٌ لا يُنزِّل عشرات الآلاف مع الصفحة. */
export const RATINGS_HYDRATE_CAP = 300;
const TTL_MS = 60_000;

const cache = new Map<string, { at: number; rows: HydratedRating[] }>();
let inflight: { ids: Set<string>; p: Promise<void> } | null = null;

export const invalidateRatings = (dealId?: string): void => {
    if (dealId) cache.delete(String(dealId));
    else cache.clear();
};

/** صفٌّ خامٌّ ⇒ الشكلُ الذي تستعمله الواجهة. */
const mapRow = (r: any): HydratedRating => ({
    id: r.id,
    userId: r.user_id,
    userName: r.user_name,
    score: Number(r.score) || 0,
    comment: r.comment ?? '',
    // 🪤 بتوقيت الجهاز لا `toISOString`: الأخيرة (UTC) تُرجع اليومَ للوراء
    //    قبل الثالثة فجراً على توقيت +٣.
    date: r.created_at
        ? (() => { const d = new Date(r.created_at);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })()
        : '',
    reply: r.reply ?? undefined,
    repliedBy: r.replied_by ?? undefined,
    repliedAt: r.replied_at ?? undefined,
    likedBy: Array.isArray(r.liked_by) ? r.liked_by : [],
    likeCount: Number(r.like_count) || 0,
});

const fetchInto = async (ids: string[], at = Date.now()): Promise<void> => {
    const { data, error } = await supabase
        .from('ratings').select('*')
        .in('deal_id', ids)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(RATINGS_HYDRATE_CAP);
    // 🔴 **الفشلُ لا يُخزَّن** — أمسكه الاختبار: كنتُ أُسجّل «لا تقييمات» لكلّ
    //    معرّفٍ طُلب **قبل** فحص الخطأ، فانقطاعُ شبكةٍ لحظيٌّ كان يُجمّد
    //    «صفر مراجعات» على الشاشة دقيقةً كاملة. (نفسُ قاعدة `memoAsync`.)
    if (error) return;
    // 🪤 كلُّ معرّفٍ طُلب يُسجَّل — **حتى بلا تقييمات**. وإلّا أُعيد سؤالُ
    //    الخادم عن كلّ عرضٍ بلا مراجعاتٍ في كلّ تحميلٍ للصفحة.
    for (const id of ids) cache.set(String(id), { at, rows: [] });
    for (const r of (data || [])) {
        const key = String(r.deal_id);
        const hit = cache.get(key);
        if (hit) hit.rows.push(mapRow(r));
    }
};

/** خريطةُ `dealId ⇒ تقييماته`، بأقلّ عددٍ ممكنٍ من النداءات. */
export const hydrateRatingsFor = async (
    rawIds: string[],
    /** لحظةُ القياس — تُمرَّر في الاختبار لعبور المهلة بلا انتظارها حرفياً.
     *  🪤 وبلا هذا المُعامل كان كسرُ «العمرُ يُهمَل» يمرّ أخضر: لا اختبارَ
     *     يستطيع أن ينتظر ستّين ثانية، فبقي الفرعُ بلا قياس. */
    nowMs: number = Date.now(),
): Promise<Record<string, HydratedRating[]>> => {
    const ids = [...new Set(rawIds.map(String))].filter(Boolean);
    if (!ids.length) return {};
    const now = nowMs;
    const fresh = (id: string) => {
        const h = cache.get(id);
        return !!h && now - h.at < TTL_MS;
    };

    let missing = ids.filter(id => !fresh(id));
    // طلبٌ طائرٌ يغطّي بعضَ الناقص ⇒ ننتظره بدل أن نفتح ثانياً.
    if (missing.length && inflight && missing.some(id => inflight!.ids.has(id))) {
        await inflight.p.catch(() => undefined);
        missing = ids.filter(id => !fresh(id));
    }
    if (missing.length) {
        const run = fetchInto(missing, now).catch(() => undefined);
        inflight = { ids: new Set(missing), p: run };
        await run;
        inflight = null;
    }

    const out: Record<string, HydratedRating[]> = {};
    for (const id of ids) out[id] = cache.get(id)?.rows ?? [];
    return out;
};

export default hydrateRatingsFor;
