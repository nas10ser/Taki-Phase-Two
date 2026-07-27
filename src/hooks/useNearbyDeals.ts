import { useCallback, useEffect, useRef, useState } from 'react';
import { dealRepository, type NearbyDeal, type NearbyParams } from '../repositories/dealRepository';

/**
 * v13.26 — قائمة «حولي» مدفوعة من الخادم على مستوى الفرع.
 *
 * نفس عقد `useDealBrowse` (تأجيل الكتابة، حارس أجيال، ترقيم keyset) لكن
 * المفتاح هنا هو **المسافة** لا التاريخ أو السعر — والصف صفُّ فرعٍ لا صفُّ
 * عرض، فالعرض متعدد المواقع يظهر دبوساً لكل فرع كما كان تماماً.
 */
export interface NearbyState {
    deals: NearbyDeal[];
    total: number;
    totalCapped: boolean;
    hasMore: boolean;
    loading: boolean;
    loadingMore: boolean;
    loadMore: () => Promise<void>;
}

const QUERY_DEBOUNCE_MS = 320;

export const useNearbyDeals = (
    params: Omit<NearbyParams, 'cursor'>,
    opts?: { pageSize?: number; enabled?: boolean }
): NearbyState => {
    const pageSize = opts?.pageSize ?? 30;
    const enabled = opts?.enabled !== false;

    const rawQuery = (params.query || '').trim();
    const [typedQuery, setTypedQuery] = useState(rawQuery);
    useEffect(() => {
        if (rawQuery === typedQuery) return;
        if (!rawQuery) { setTypedQuery(''); return; }
        const t = setTimeout(() => setTypedQuery(rawQuery), QUERY_DEBOUNCE_MS);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rawQuery]);

    const [deals, setDeals] = useState<NearbyDeal[]>([]);
    const [total, setTotal] = useState(0);
    const [totalCapped, setTotalCapped] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(enabled);
    const [loadingMore, setLoadingMore] = useState(false);

    const paramsRef = useRef(params);
    paramsRef.current = { ...params, query: typedQuery || null };

    const cursorRef = useRef<{ dist: number; key: string } | null>(null);
    const genRef = useRef(0);
    const busyRef = useRef(false);

    // الإحداثيات تُقرَّب لأربع خانات (~11م): التتبّع الحيّ يحرّكها كل ثانية،
    // وبدون التقريب يُعاد الجلب بلا داعٍ عند كل اهتزاز في إشارة الـGPS.
    const sig = [
        enabled, pageSize, typedQuery,
        params.lat?.toFixed(4), params.lng?.toFixed(4), params.radiusKm,
        params.category, params.region, params.city, params.locationId, params.locType,
        params.openNow, (params.blocked || []).join(','),
    ].map(v => String(v ?? '')).join('|');

    useEffect(() => {
        if (!enabled) { setDeals([]); setLoading(false); return; }
        const gen = ++genRef.current;
        cursorRef.current = null;
        busyRef.current = false;
        setLoading(true);
        dealRepository.browseNearby({ ...paramsRef.current, cursor: null, limit: pageSize })
            .then(res => {
                if (gen !== genRef.current) return;
                setDeals(res.deals);
                setTotal(res.total);
                setTotalCapped(res.totalCapped);
                setHasMore(res.hasMore);
                cursorRef.current = res.cursor;
            })
            .finally(() => { if (gen === genRef.current) setLoading(false); });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sig]);

    const loadMore = useCallback(async () => {
        if (busyRef.current || !cursorRef.current) return;
        const gen = genRef.current;
        busyRef.current = true;
        setLoadingMore(true);
        try {
            const res = await dealRepository.browseNearby({
                ...paramsRef.current, cursor: cursorRef.current, limit: pageSize,
            });
            if (gen !== genRef.current) return;
            setDeals(prev => {
                const seen = new Set(prev.map(d => d._key));
                return prev.concat(res.deals.filter(d => !seen.has(d._key)));
            });
            setHasMore(res.hasMore);
            cursorRef.current = res.cursor;
        } finally {
            busyRef.current = false;
            if (gen === genRef.current) setLoadingMore(false);
        }
    }, [pageSize]);

    return { deals, total, totalCapped, hasMore, loading, loadingMore, loadMore };
};

export default useNearbyDeals;
