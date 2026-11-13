/**
 * geoCache — قائمةُ المولات والأسواق: نداءٌ واحدٌ كلَّ ساعاتٍ لا كلَّ إقلاع (v16.20)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 **ما قِيس** (١٣ نوفمبر ٢٠٢٦، كما يستلمها المتصفّحُ مضغوطةً):
 *      locations            **٧٬٨٠٣ بايت**  ← الأثقلُ في الإقلاع كلِّه
 *      deals (٣١ صفّاً)       ٥٬٦٩٨
 *      taki_home_payload     ٣٬١٢٧
 *      sellers_public          ٧٢٣ · sponsors ٤٧١ · platform_settings ٢٨٥
 *    أي أن **جدولَ مرجعٍ شبهِ ثابت** كان أثقلَ من كتالوج العروض نفسِه،
 *    ويُجلب كاملاً في كلّ فتحةٍ للتطبيق من كلّ جهاز.
 *
 * 🪤 وللقائمة **بديلٌ مدمجٌ في الحزمة** (`data/mock.ts: LOCATIONS`) — فالنداءُ
 *    تحسينٌ لا شرط، وتخزينُه لا يُعطّل شيئاً: أسوأُ الحالات قائمةٌ عمرُها
 *    ساعاتٌ قليلة، وهي تتغيّر حين يضيف ناصرٌ مولاً (مرّاتٍ في السنة).
 * 🔴 ولذلك **يُبطَّل المخزونُ صراحةً** من «إدارة المولات» عند أيّ حفظ
 *    (`reloadGeo({ force: true })`) — فالمحرِّرُ يرى تعديلَه فوراً.
 *    ويبقى الآخرون على قائمةٍ قد تتأخّر ساعاتٍ، وهذا هو الثمنُ المُعلَن.
 */
export interface GeoRow {
    id: string; name: string; nameEn?: string;
    type: 'mall' | 'market'; cityId: string; lat: number; lng: number;
}

const KEY = 'taki-geo-v1';
/** ستُّ ساعات — أطولُ من جلسةِ تصفّحٍ، وأقصرُ من يومٍ كامل. */
export const GEO_TTL_MS = 6 * 60 * 60 * 1000;

/** صفٌّ خامٌ من القاعدة ⇒ الشكلُ الذي تستعمله الواجهة. */
export const mapGeoRow = (r: any): GeoRow => ({
    id: String(r.id),
    name: r.name,
    nameEn: r.name_en || undefined,
    type: r.type === 'market' ? 'market' : 'mall',
    cityId: r.city_id,
    lat: Number(r.lat),
    lng: Number(r.lng),
});

/** القائمةُ المخزّنة إن كانت ما تزال طازجة، وإلّا `null`. */
export const readGeoCache = (nowMs: number = Date.now()): GeoRow[] | null => {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const o = JSON.parse(raw);
        // 🪤 وصفرٌ من الصفوف ليس مخزوناً صالحاً: الجلبُ الأصليُّ يرفض الفراغ
        //    («أبقِ البديلَ المدمج»)، فخزنُه هنا يُجمّد الفراغَ ساعاتٍ.
        if (!o || !Array.isArray(o.rows) || o.rows.length === 0) return null;
        if (!Number.isFinite(o.at) || nowMs - o.at >= GEO_TTL_MS) return null;
        // 🪤 وساعةُ الجهاز قد تُضبط إلى الوراء فيصير `at` في المستقبل —
        //    ومخزونٌ «لم يأتِ بعد» يبقى طازجاً أبداً. يُرفض.
        if (o.at > nowMs + 60_000) return null;
        return o.rows as GeoRow[];
    } catch { return null; }
};

export const writeGeoCache = (rows: GeoRow[], nowMs: number = Date.now()): void => {
    try {
        if (!Array.isArray(rows) || rows.length === 0) return;
        localStorage.setItem(KEY, JSON.stringify({ at: nowMs, rows }));
    } catch { /* تخزينٌ ممنوع — المخزونُ راحةٌ لا شرط */ }
};

export const clearGeoCache = (): void => {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
};
