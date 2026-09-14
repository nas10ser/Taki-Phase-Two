/**
 * useStoreReviews — مراجعات المتجر صفحةً صفحة (v14.27)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 قبله: صفحة العرض تعرض `storeReviews.slice(0, 5)` — خمساً، ولا زرّ ولا
 * رسالة ولا أي أثر يدلّ على السادسة. ومصدر تلك الخمس نفسه مسقوف: المراجعات
 * تُحمَّل مع صفحة العروض بسقفٍ **واحد لثلاثين عرضاً** (٣٠٠ صفّاً)، فعرضٌ رائج
 * قد يبتلع الحصّة ويُجوّع البقية.
 *
 * المتوسط والعدد يبقيان من `deals.rating_avg`/`rating_count` المثبَّتين على
 * الصفّ، فلا يتأثّران بالصفحة — وهو نهج المتاجر العالمية نفسه.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { logger } from '../utils/logger';

const PAGE = 10;

export interface StoreReview {
    id: string;
    dealId: string;
    itemName?: string;
    userId: string;
    userName: string;
    score: number;
    comment: string;
    date: string;
    reply?: string;
    repliedBy?: string;
    likeCount?: number;
    likedBy?: string[];
}

const fromRow = (r: any): StoreReview => ({
    id: r.id,
    dealId: r.deal_id,
    itemName: r.item_name ?? undefined,
    userId: r.user_id,
    userName: r.user_name,
    score: Number(r.score) || 0,
    comment: r.comment ?? '',
    // بتوقيت الجهاز — toISOString (UTC) يُرجع اليوم للوراء قبل ٣ فجراً
    date: r.created_at
        ? (() => { const d = new Date(r.created_at);
                   return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })()
        : '',
    reply: r.reply ?? undefined,
    repliedBy: r.replied_by ?? undefined,
    likeCount: Number(r.like_count) || 0,
    // بلا هذا يظهر إعجابُ المستخدم مُلغًى على الصفحات المجلوبة من الخادم،
    // فيضغط مرّة ثانية ويُلغي إعجابه وهو يظنّ أنه يضيفه.
    likedBy: Array.isArray(r.liked_by) ? r.liked_by : [],
});

export function useStoreReviews(storeId: string | undefined, enabled = true) {
    const [rows, setRows] = useState<StoreReview[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [total, setTotal] = useState(0);
    const [busy, setBusy] = useState(false);
    const [ready, setReady] = useState(false);
    const cursor = useRef<{ at: string; id: string } | null>(null);
    const guard = useRef(0);

    const fetchPage = useCallback(async (first: boolean) => {
        if (!storeId || !enabled) { setReady(true); return; }
        const run = first ? ++guard.current : guard.current;
        setBusy(true);
        try {
            const { data, error } = await supabase.rpc('browse_store_ratings', {
                p_store_id: storeId,
                p_cursor_at: first ? null : (cursor.current?.at ?? null),
                p_cursor_id: first ? null : (cursor.current?.id ?? null),
                p_limit: PAGE,
            });
            if (guard.current !== run) return;
            if (error) { logger.warn('browse_store_ratings:', error.message); return; }
            const d: any = data || {};
            if (!d.ok) return;
            const raw: any[] = Array.isArray(d.rows) ? d.rows : [];
            const last = raw[raw.length - 1];
            if (last) cursor.current = { at: last.created_at, id: last.id };
            setRows(prev => {
                const next = first ? raw.map(fromRow) : prev.concat(raw.map(fromRow));
                // حارس: صفحةٌ تُعاد بنفس المؤشّر لن تُضاعف الصفوف.
                const seen = new Set<string>();
                return next.filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true)));
            });
            setHasMore(!!d.has_more);
            setTotal(Number(d.total) || 0);
        } finally {
            if (guard.current === run) { setBusy(false); setReady(true); }
        }
    }, [storeId, enabled]);

    useEffect(() => { cursor.current = null; setRows([]); setReady(false); fetchPage(true); }, [fetchPage]);

    return { rows, hasMore, total, busy, ready, loadMore: () => fetchPage(false), reload: () => fetchPage(true) };
}
