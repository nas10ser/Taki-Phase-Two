/**
 * useNotifBrowse — إشعارات المستخدم صفحةً صفحة (v14.26)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 قبله: الشاشة تعرض مصفوفة الحالة العامة، وهي أحدث ١٠٠ صفّ. قِيس على
 * الإنتاج: حساب بـ٧٤٧ إشعاراً ⇒ ٦٤٧ غير مرئية، بلا زرّ ولا رسالة ولا أي أثر
 * يدلّ على أن هناك المزيد.
 *
 * الصفحات تأتي من `browse_notifications` بترقيم المفتاح. وما يصل لحظياً
 * (ريل-تايم) يبقى في الحالة العامة، فنَدمج الاثنين ونزيل التكرار بالمعرّف —
 * وإلا لظهر الإشعار الجديد مرّتين، أو لما ظهر حتى تُحدَّث الصفحة.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { notificationRepository, AppNotification } from '../repositories/notificationRepository';

const PAGE = 40;

export function useNotifBrowse(userId: string | undefined, live: AppNotification[]) {
    const [pages, setPages] = useState<AppNotification[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [busy, setBusy] = useState(false);
    const [ready, setReady] = useState(false);
    const [totals, setTotals] = useState({ total: 0, unread: 0 });
    const cursor = useRef<{ at: string; id: string } | null>(null);
    const guard = useRef(0);

    const loadFirst = useCallback(async () => {
        if (!userId) { setReady(true); return; }
        const run = ++guard.current;
        setBusy(true);
        const p = await notificationRepository.browsePage(null, PAGE);
        if (guard.current !== run) return;          // تبديل حساب أثناء الجلب
        cursor.current = p.cursor;
        setPages(p.rows); setHasMore(p.hasMore);
        setTotals({ total: p.total, unread: p.unreadTotal });
        setBusy(false); setReady(true);
    }, [userId]);

    useEffect(() => { setPages([]); setReady(false); cursor.current = null; loadFirst(); }, [loadFirst]);

    const loadMore = useCallback(async () => {
        if (busy || !hasMore || !cursor.current) return;
        const run = guard.current;
        setBusy(true);
        const p = await notificationRepository.browsePage(cursor.current, PAGE);
        if (guard.current !== run) return;
        cursor.current = p.cursor;
        setPages(prev => prev.concat(p.rows));
        setHasMore(p.hasMore);
        setTotals({ total: p.total, unread: p.unreadTotal });
        setBusy(false);
    }, [busy, hasMore]);

    // الدمج: الصفحات هي الأساس، وما وصل لحظياً يُضاف فوقها. المعرّف يمنع
    // الازدواج، والحالة الحيّة تفوز لأنها تحمل «قُرئ» بعد الضغط مباشرة.
    const rows = useMemo(() => {
        const mine = live.filter(n => n.userId === userId);
        const map = new Map<string, AppNotification>();
        for (const n of pages) map.set(n.id, n);
        for (const n of mine) map.set(n.id, n);
        return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
    }, [pages, live, userId]);

    // العدّ من الخادم هو الحقيقة. لكن الضغط على إشعار يُعلّمه مقروءاً محلياً
    // قبل أي جولة جديدة، فنطرح ما عُلّم بعد آخر جلب كي لا يتجمّد الرقم.
    const unread = useMemo(() => {
        const readNow = new Set(live.filter(n => n.userId === userId && n.isRead).map(n => n.id));
        const stillUnreadInPage = pages.filter(n => !n.isRead && !readNow.has(n.id)).length;
        const unreadInPage = pages.filter(n => !n.isRead).length;
        return Math.max(0, totals.unread - (unreadInPage - stillUnreadInPage));
    }, [totals.unread, pages, live, userId]);

    return { rows, hasMore, busy, ready, loadMore, reload: loadFirst, total: totals.total, unread };
}
