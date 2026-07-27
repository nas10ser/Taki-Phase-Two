import { useCallback, useEffect, useRef, useState } from 'react';
import { Deal } from '../data/mock';
import {
    dealRepository,
    DEALS_PAGE_SIZE,
    type BrowseCursor,
    type BrowseParams,
} from '../repositories/dealRepository';

/**
 * v13.24 — قائمة عروض مدفوعة من الخادم بالكامل.
 *
 * الفرق الجوهري عمّا سبق: الصفحة لم تعد ترشّح مصفوفة محلية، بل تسأل القاعدة
 * عن **الترشيح والترتيب والعدّ** معاً. النتيجة أن ما يظهر للمشتري مطابق حرفياً
 * لما في القاعدة — لا منتج يختفي لأنه خارج النافذة المُحمّلة، ولا عدّاد يكذب.
 *
 * وكل صفحة تالية تُطلب بمؤشّر keyset، فالصفحة الألف تكلّف القاعدة تماماً ما
 * تكلّفه الصفحة الأولى مهما بلغ الكتالوج ملايين.
 */

export type DealBrowseFilters = Omit<BrowseParams, 'cursor' | 'limit'>;

export interface DealBrowseState {
    deals: Deal[];
    /** عدد المطابقات في القاعدة كلها (لا المُحمّل). مسقوف — انظر totalCapped. */
    total: number;
    /** true = المطابقات تجاوزت السقف، فالعرض الصحيح «+5000». */
    totalCapped: boolean;
    hasMore: boolean;
    /** تحميل الصفحة الأولى (تغيّرت الفلاتر) — تُعرض هياكل انتظار. */
    loading: boolean;
    /** تحميل صفحة إضافية بالتمرير — القائمة الحالية تبقى ظاهرة. */
    loadingMore: boolean;
    loadMore: () => Promise<void>;
    reload: () => void;
}

/** تأخير الكتابة قبل إطلاق البحث — يمنع طلباً لكل حرف. */
const QUERY_DEBOUNCE_MS = 320;

export const useDealBrowse = (
    filters: DealBrowseFilters,
    opts?: { pageSize?: number; debounceMs?: number }
): DealBrowseState => {
    const pageSize = opts?.pageSize ?? DEALS_PAGE_SIZE;
    const debounceMs = opts?.debounceMs ?? QUERY_DEBOUNCE_MS;

    const rawQuery = (filters.query || '').trim();
    const [typedQuery, setTypedQuery] = useState(rawQuery);

    // مسح البحث فوري (المستخدم ينتظر رجوع القائمة)، والكتابة مؤجَّلة.
    useEffect(() => {
        if (rawQuery === typedQuery) return;
        if (!rawQuery) { setTypedQuery(''); return; }
        const t = setTimeout(() => setTypedQuery(rawQuery), debounceMs);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rawQuery, debounceMs]);

    const [deals, setDeals] = useState<Deal[]>([]);
    const [total, setTotal] = useState(0);
    const [totalCapped, setTotalCapped] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    // آخر فلاتر فعّالة — في ref حتى لا يعتمد التأثير على هوية الكائن (يُعاد
    // بناؤه كل رسمة عند المستدعي) بل على توقيع قيمه فقط.
    const paramsRef = useRef<DealBrowseFilters>(filters);
    paramsRef.current = { ...filters, query: typedQuery || null };

    // مؤشّر الصفحة التالية + عدّاد أجيال يُلغي نتائج طلب فات أوانه.
    const cursorRef = useRef<BrowseCursor | null>(null);
    const genRef = useRef(0);
    const busyRef = useRef(false);

    // الفاصل «|» ضروري: بدونه يلتبس («ab»,«c») بـ(«a»,«bc») فلا يُعاد الجلب.
    const sig = [
        typedQuery, filters.category, filters.gender, filters.region, filters.city,
        filters.mall, filters.storeId, filters.seasonId, filters.sort, filters.mode,
        filters.openNow, filters.verified,
    ].map(v => String(v ?? '')).join('|');

    // الصفحة الأولى — تعمل عند أي تغيّر في الفلاتر أو البحث.
    useEffect(() => {
        const gen = ++genRef.current;
        cursorRef.current = null;
        busyRef.current = false;
        setLoading(true);
        dealRepository.browse({ ...paramsRef.current, cursor: null, limit: pageSize })
            .then(res => {
                if (gen !== genRef.current) return;   // سبقه طلب أحدث
                setDeals(res.deals);
                setTotal(res.total);
                setTotalCapped(res.totalCapped);
                setHasMore(res.hasMore);
                cursorRef.current = res.cursor;
            })
            .finally(() => { if (gen === genRef.current) setLoading(false); });
    }, [sig, pageSize, reloadKey]);

    const loadMore = useCallback(async () => {
        if (busyRef.current || !cursorRef.current) return;
        const gen = genRef.current;
        busyRef.current = true;
        setLoadingMore(true);
        try {
            const res = await dealRepository.browse({
                ...paramsRef.current, cursor: cursorRef.current, limit: pageSize,
            });
            if (gen !== genRef.current) return;
            setDeals(prev => {
                // keyset لا يكرّر أصلاً، لكن نشر تاجرٍ عرضاً أثناء التمرير قد
                // يزيح الحدود. حارس المُعرّفات يجعل التكرار مستحيلاً بأي حال.
                const seen = new Set(prev.map(d => d.id));
                return prev.concat(res.deals.filter(d => !seen.has(d.id)));
            });
            setHasMore(res.hasMore);
            cursorRef.current = res.cursor;
        } finally {
            busyRef.current = false;
            if (gen === genRef.current) setLoadingMore(false);
        }
    }, [pageSize]);

    const reload = useCallback(() => setReloadKey(k => k + 1), []);

    return { deals, total, totalCapped, hasMore, loading, loadingMore, loadMore, reload };
};

export default useDealBrowse;
