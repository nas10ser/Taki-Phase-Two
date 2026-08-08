import { useCallback, useEffect, useRef, useState } from 'react';
import {
    bookingRepository,
    mapBookingRow,
    BOOKINGS_PAGE_SIZE,
    type Booking,
    type BookingBrowseParams,
    type BookingCursor,
} from '../repositories/bookingRepository';
import { useApp } from '../context/AppContext';

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

    // ─────────────────────────────────────────────────────────────
    // v13.80 — القائمة صارت حيّة (بلاغ ناصر: «الطلب اكتمل ووصلني الإشعار
    // والبطاقة ما زالت في الجارية ولم تنتقل للسجل»).
    //
    // القائمة مُرقَّمة من الخادم (v13.28)، فكانت جامدة بين النداءات: الريل‑تايم
    // يحدّث مصفوفة السياق وحدها. الآن نستهلك الحدث الخام من السياق ونتصرّف
    // بأقلّ تدخّل ممكن:
    //   • صفّ معروض تغيّرت حالته وما زال ينتمي لهذه القائمة → **ترقيع في مكانه**
    //     (بلا نداء شبكة، وبلا فقدان الصفحات المُحمَّلة ولا موضع التمرير).
    //   • صفّ معروض لم يعد ينتمي (اكتمل/أُلغي في قائمة «الجارية») → يُنزع فوراً
    //     ويُنقص العدّاد.
    //   • صفّ **دخل** هذه القائمة للتوّ (طلب جديد، أو انتقل إلى «السابقة») →
    //     إعادة تحميل مُجمَّعة، لأن الصفّ يحتاج بيانات العرض المرفقة من الخادم.
    //
    // تعريف «الجارية/السابقة» هنا يطابق `browse_bookings` حرفياً:
    // مكتمل أو ملغى = سابق، وما عداه = جارٍ.
    // ─────────────────────────────────────────────────────────────
    const { lastBookingEvent, user } = useApp();
    const listRef = useRef<Booking[]>(bookings);
    listRef.current = bookings;
    const seenSeqRef = useRef(0);
    const rtReloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => { if (rtReloadTimer.current) clearTimeout(rtReloadTimer.current); }, []);

    useEffect(() => {
        if (!enabled || !lastBookingEvent) return;
        if (lastBookingEvent.seq === seenSeqRef.current) return;
        seenSeqRef.current = lastBookingEvent.seq;

        const { type, row } = lastBookingEvent;
        const barcode = row?.barcode;
        if (!barcode) return;

        const known = listRef.current.some(b => b.barcode === barcode);

        if (type === 'DELETE') {
            if (known) {
                setBookings(prev => prev.filter(b => b.barcode !== barcode));
                setTotal(t => Math.max(0, t - 1));
            }
            return;
        }

        // هل يخصّ هذا الصفّ دور هذه القائمة أصلاً؟ (لوحة التاجر تعرض قوائم
        // التاجر، وصفحة الحجوزات قوائم المشتري — ونفس الحساب قد يكون الطرفين.)
        const scope = paramsRef.current.scope || 'buyer';
        const mineHere = scope === 'seller' ? row.store_id === user?.id : row.user_id === user?.id;
        if (!mineHere && !known) return;

        const state = paramsRef.current.state || 'all';
        const isPast = row.status === 'completed' || row.status === 'cancelled';
        const belongs = state === 'all' ? true : (state === 'active' ? !isPast : isPast);

        if (known) {
            if (belongs) {
                setBookings(prev => prev.map(b => b.barcode === barcode ? mapBookingRow(row, b.deal) : b));
            } else {
                setBookings(prev => prev.filter(b => b.barcode !== barcode));
                setTotal(t => Math.max(0, t - 1));
            }
            return;
        }

        if (belongs) {
            // دخل القائمة للتوّ — نحتاج صفّاً كاملاً من الخادم (مع العرض المرفق).
            // تجميع نصف ثانية يمنع عاصفة نداءات حين تتغيّر عدة طلبات معاً.
            if (rtReloadTimer.current) clearTimeout(rtReloadTimer.current);
            rtReloadTimer.current = setTimeout(() => { rtReloadTimer.current = null; reload(); }, 500);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lastBookingEvent?.seq, enabled, user?.id]);

    return { bookings, total, totalCapped, hasMore, loading, loadingMore, loadMore, reload };
};

export default useBookingBrowse;
