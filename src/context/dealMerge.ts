/**
 * dealMerge — دمجُ صفحتين من واجهة العروض، في ملفٍّ واحد.
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 خرجت من `AppContext.tsx` في v16.14 لا تجميلاً: السقّافة
 *    (`scripts/check-file-size.js`) رفضت نموَّ السياق، والقاعدةُ عندنا
 *    «قلّص ولا ترفع السقف». وهذه الدالّةُ **خالصةٌ** (بلا حالةٍ ولا خطّافات)
 *    فمكانُها الطبيعيّ ملفٌّ يُقرأ ويُختبر وحده.
 */
import { Deal } from '../data/mock';

/**
 * v13.22 — دمج صفحتين من الواجهة مع الحفاظ على الترتيب وبلا تكرار.
 * `primary` له الأولوية عند تكرار المعرّف (الصفحة الأحدث من القاعدة تغلب
 * النسخة القديمة في الذاكرة)، والترتيب النهائي `created_at` تنازلياً — نفس
 * ترتيب الاستعلام تماماً فلا «تقفز» البطاقات أمام المستخدم.
 */
export const mergeDealPages = (primary: Deal[], secondary: Deal[]): Deal[] => {
    const byId = new Map<string, Deal>();
    for (const d of secondary) byId.set(d.id, d);
    for (const d of primary) {
        const old = byId.get(d.id);
        // نحافظ على الحقول المُرطَّبة محلياً (تصويت المصداقية) كما في مسار البث
        byId.set(d.id, old ? {
            ...old, ...d,
            authReal: (d as any).authReal ?? (old as any).authReal,
            authFake: (d as any).authFake ?? (old as any).authFake,
            myAuthVote: ((old as any).myAuthVote === true || (old as any).myAuthVote === false)
                ? (old as any).myAuthVote : (d as any).myAuthVote,
            // v13.24 — لا نمحو تقييمات مُرطَّبة بمصفوفة فارغة. المسارات السريعة
            // (browse) لا تجلب صفوف التقييمات لأن البطاقة تكتفي بالمتوسط المثبَّت،
            // فلولا هذا الحارس لأفقدت صفحةَ المتجر وتفاصيلَ العرض مراجعاتها.
            ratings: (Array.isArray(d.ratings) && d.ratings.length) ? d.ratings
                   : ((old.ratings && old.ratings.length) ? old.ratings : (d.ratings || [])),
        } as Deal : d);
    }
    return Array.from(byId.values())
        .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)
            || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
};
