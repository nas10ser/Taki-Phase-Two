import { useEffect, useRef, useState } from 'react';
import { Deal } from '../data/mock';
import { dealRepository, type BrowseParams } from '../repositories/dealRepository';

/**
 * v13.25 — شريط عروض واحد (الأكثر تداولاً / أقوى الخصومات / الموسم / القادمة)
 * مدفوع من الخادم.
 *
 * كانت الأشرطة تُرتَّب من النافذة المُحمّلة، فـ«أقوى الخصومات» كانت تعرض أقوى
 * خصم بين آخر ٣٠ عرضاً — لا أقوى خصم عندك. الآن كل شريط استعلام مستقل مرتَّب
 * على القاعدة كلها بفهرسه الخاص، ولا يجلب إلا الأصناف التي يعرضها فعلاً.
 *
 * **التوسّع التدريجي** بدل الفرز بالقرب: القاعدة تُسأل عن مدينة المستخدم أولاً،
 * فإن لم تكتمل الحصة تُستكمل من منطقته ثم من المملكة كلها — مع استبعاد ما ظهر.
 * كل خطوة ضربة فهرس واحدة، بعكس «رتّب كل شيء بالقرب» التي تُجبر القاعدة على
 * فرز الكتالوج كاملاً عند كل فتح للرئيسية.
 */
export interface DealRailScope {
    /** مدينة المستخدم — أول نطاق يُسأل. */
    city?: string | null;
    /** منطقته — النطاق الثاني. */
    region?: string | null;
    /** false = لا توسّع: التزم بالنطاق المحدد حرفياً (المستخدم اختاره بنفسه). */
    expand?: boolean;
}

export const useDealRail = (
    params: Omit<BrowseParams, 'cursor' | 'excludeIds'>,
    scope: DealRailScope,
    enabled = true
): { deals: Deal[]; loading: boolean } => {
    const [deals, setDeals] = useState<Deal[]>([]);
    const [loading, setLoading] = useState(enabled);

    const paramsRef = useRef(params);
    paramsRef.current = params;

    const target = Math.max(1, params.limit ?? 8);
    const sig = [
        enabled, target, params.sort, params.mode, params.category, params.gender,
        params.seasonId, params.storeId, params.query,
        scope.city, scope.region, scope.expand,
        (params.blocked || []).join(','),
    ].map(v => String(v ?? '')).join('|');

    useEffect(() => {
        if (!enabled) { setDeals([]); setLoading(false); return; }
        let alive = true;
        setLoading(true);

        (async () => {
            const base = { ...paramsRef.current, limit: target };
            // نطاقات متدرّجة: المدينة ← المنطقة ← المملكة. عند اختيار المستخدم
            // نطاقاً صراحةً (expand=false) نلتزم به ولا نوسّع.
            const scopes: Array<{ city?: string | null; region?: string | null }> =
                scope.expand === false
                    ? [{ city: scope.city, region: scope.region }]
                    : [
                        ...(scope.city   ? [{ city: scope.city }]     : []),
                        ...(scope.region ? [{ region: scope.region }] : []),
                        {},
                    ];

            const acc: Deal[] = [];
            const seen = new Set<string>();
            for (const s of scopes) {
                if (acc.length >= target) break;
                const res = await dealRepository.browse({
                    ...base,
                    city: s.city ?? null,
                    region: s.region ?? null,
                    limit: target - acc.length,
                    excludeIds: seen.size ? Array.from(seen) : null,
                });
                for (const d of res.deals) {
                    if (seen.has(d.id)) continue;
                    seen.add(d.id);
                    acc.push(d);
                }
                if (!res.deals.length) continue;
            }
            if (alive) { setDeals(acc); setLoading(false); }
        })().catch(() => { if (alive) { setDeals([]); setLoading(false); } });

        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sig]);

    return { deals, loading };
};

export default useDealRail;
