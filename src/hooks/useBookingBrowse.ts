import { useCallback, useEffect, useRef, useState } from 'react';
import {
    bookingRepository,
    BOOKINGS_PAGE_SIZE,
    type Booking,
    type BookingBrowseParams,
    type BookingCursor,
} from '../repositories/bookingRepository';

/**
 * v13.28 — قائمة طلبات مدفوعة من الخادم بترقيم keyset.
 *
 * نفس عقد `useDealBrowse`: تأجيل الكتابة، حارس أجيال يُلغي نتائج طلب فات
 * أوانه، وحارس تكرار بالباركود. الفرق أن مفتاح الترتيب هنا طابع الإنشاء
 * والباركود — فالصفحة المئة تكلّف القاعدة ما تكلّفه الأولى مهما بلغ عدد طلبات
 * التاجر.
 */
export interface BookingBrowseState {
    bookings: Booking[];
    total: number;
    totalCapped: boolean;
    hasMore: boolean;
    loading: boolean;
    loadingMore: boolean;
    loadMore: () => Promise<void>;
    reload: () => void;
}

const QUERY_DEBOUNCE_MS = 320;

export const useBookingBrowse = (
    params: Omit<BookingBrowseParams, 'cursor'>,
    opts?: { pageSize?: number; enabled?: boolean }
): BookingBrowseState => {
    const pageSize = opts?.pageSize ?? BOOKINGS_PAGE_SIZE;
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

    const [bookings, setBookings] = useState<Booking[]>([]);
    const [total, setTotal] = useState(0);
    const [totalCapped, setTotalCapped] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(enabled);
    const [loadingMore, setLoadingMore] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    const paramsRef = useRef(params);
    paramsRef.current = { ...params, query: typedQuery || null };

    const cursorRef = useRef<BookingCursor | null>(null);
    const genRef = useRef(0);
    const busyRef = useRef(false);

    const sig = [enabled, pageSize, typedQuery, params.scope, params.state]
        .map(v => String(v ?? '')).join('|');

    useEffect(() => {
        if (!enabled) { setBookings([]); setLoading(false); return; }
        const gen = ++genRef.current;
        cursorRef.current = null;
        busyRef.current = false;
        setLoading(true);
        bookingRepository.browse({ ...paramsRef.current, cursor: null, limit: pageSize })
            .then(res => {
                if (gen !== genRef.current) return;
                setBookings(res.bookings);
                setTotal(res.total);
                setTotalCapped(res.totalCapped);
                setHasMore(res.hasMore);
                cursorRef.current = res.cursor;
            })
            .finally(() => { if (gen === genRef.current) setLoading(false); });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sig, reloadKey]);

    const loadMore = useCallback(async () => {
        if (busyRef.current || !cursorRef.current) return;
        const gen = genRef.current;
        busyRef.current = true;
        setLoadingMore(true);
        try {
            const res = await bookingRepository.browse({
                ...paramsRef.current, cursor: cursorRef.current, limit: pageSize,
            });
            if (gen !== genRef.current) return;
            setBookings(prev => {
                const seen = new Set(prev.map(b => b.barcode));
                return prev.concat(res.bookings.filter(b => !seen.has(b.barcode)));
            });
            setHasMore(res.hasMore);
            cursorRef.current = res.cursor;
        } finally {
            busyRef.current = false;
            if (gen === genRef.current) setLoadingMore(false);
        }
    }, [pageSize]);

    const reload = useCallback(() => setReloadKey(k => k + 1), []);

    return { bookings, total, totalCapped, hasMore, loading, loadingMore, loadMore, reload };
};

export default useBookingBrowse;
