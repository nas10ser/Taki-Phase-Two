/**
 * useNotifBrowse — إشعارات المستخدم صفحةً صفحة (v14.26) + بحثٌ وحذف (v14.63)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 قبله: الشاشة تعرض مصفوفة الحالة العامة، وهي أحدث ١٠٠ صفّ. قِيس على
 * الإنتاج: حساب بـ٧٤٧ إشعاراً ⇒ ٦٤٧ غير مرئية، بلا زرّ ولا رسالة ولا أي أثر
 * يدلّ على أن هناك المزيد.
 *
 * الصفحات تأتي من `browse_notifications` بترقيم المفتاح. وما يصل لحظياً
 * (ريل-تايم) يبقى في الحالة العامة، فنَدمج الاثنين ونزيل التكرار بالمعرّف —
 * وإلا لظهر الإشعار الجديد مرّتين، أو لما ظهر حتى تُحدَّث الصفحة.
 *
 * v14.63 — **البحث من الخادم** لا من الصفحة المحمّلة (وإلا عاد العيب نفسه:
 * من له ٧٥٠ إشعاراً يبحث في آخر ٤٠)، و**الحذف** يُسقط الصفّ محلياً فوراً
 * ويُعدّل العدّادات — بلا جولة جلبٍ كاملة.
 * 🪤 وأثناء البحث لا يُدمج ما وصل لحظياً: رسالةٌ جديدة لا تطابق البحث كانت
 * ستقفز إلى نتائج بحثٍ لا تخصّها.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { notificationRepository, AppNotification } from '../repositories/notificationRepository';

const PAGE = 40;

export function useNotifBrowse(userId: string | undefined, live: AppNotification[], query = '') {
    const [pages, setPages] = useState<AppNotification[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [busy, setBusy] = useState(false);
    const [ready, setReady] = useState(false);
    const [totals, setTotals] = useState({ total: 0, unread: 0, matched: 0 });
    const [removed, setRemoved] = useState<Set<string>>(() => new Set());
    const cursor = useRef<{ at: string; id: string } | null>(null);
    const guard = useRef(0);
    const q = query.trim();

    const loadFirst = useCallback(async () => {
        if (!userId) { setReady(true); return; }
        const run = ++guard.current;
        setBusy(true);
        const p = await notificationRepository.browsePage(null, PAGE, q);
        if (guard.current !== run) return;          // تبديل حساب أو بحث أثناء الجلب
        cursor.current = p.cursor;
        setPages(p.rows); setHasMore(p.hasMore);
        setTotals({ total: p.total, unread: p.unreadTotal, matched: p.matched });
        setBusy(false); setReady(true);
    }, [userId, q]);

    useEffect(() => { setPages([]); setReady(false); cursor.current = null; loadFirst(); }, [loadFirst]);

    const loadMore = useCallback(async () => {
        if (busy || !hasMore || !cursor.current) return;
        const run = guard.current;
        setBusy(true);
        const p = await notificationRepository.browsePage(cursor.current, PAGE, q);
        if (guard.current !== run) return;
        cursor.current = p.cursor;
        setPages(prev => prev.concat(p.rows));
        setHasMore(p.hasMore);
        setTotals({ total: p.total, unread: p.unreadTotal, matched: p.matched });
        setBusy(false);
    }, [busy, hasMore, q]);

    /** حذف صفّ واحد — يُثبَت بالعدد الراجع، فلا يختفي من الشاشة ما بقي في القاعدة. */
    const remove = useCallback(async (n: AppNotification): Promise<boolean> => {
        const ok = await notificationRepository.remove(n.id);
        if (!ok) return false;
        setRemoved(prev => new Set(prev).add(n.id));
        setTotals(t => ({
            total: Math.max(0, t.total - 1),
            matched: Math.max(0, t.matched - 1),
            unread: n.isRead ? t.unread : Math.max(0, t.unread - 1),
        }));
        return true;
    }, []);

    /** حذف كل المقروء — يُرجع العدد المحذوف فعلاً (صفرٌ يعني «لم يُحذف شيء»). */
    const removeRead = useCallback(async (): Promise<number> => {
        if (!userId) return 0;
        const n = await notificationRepository.removeAllRead(userId);
        if (n > 0) { cursor.current = null; await loadFirst(); setRemoved(new Set()); }
        return n;
    }, [userId, loadFirst]);

    // الدمج: الصفحات هي الأساس، وما وصل لحظياً يُضاف فوقها. المعرّف يمنع
    // الازدواج، والحالة الحيّة تفوز لأنها تحمل «قُرئ» بعد الضغط مباشرة.
    const rows = useMemo(() => {
        const map = new Map<string, AppNotification>();
        for (const n of pages) map.set(n.id, n);
        const mine = live.filter(n => n.userId === userId);
        for (const n of mine) {
            // أثناء البحث: نحدّث ما هو معروضٌ أصلاً (حالة «قُرئ») ولا نُقحم جديداً.
            if (q && !map.has(n.id)) continue;
            map.set(n.id, n);
        }
        for (const id of removed) map.delete(id);
        return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
    }, [pages, live, userId, q, removed]);

    // العدّ من الخادم هو الحقيقة. لكن الضغط على إشعار يُعلّمه مقروءاً محلياً
    // قبل أي جولة جديدة، فنطرح ما عُلّم بعد آخر جلب كي لا يتجمّد الرقم.
    const unread = useMemo(() => {
        const readNow = new Set(live.filter(n => n.userId === userId && n.isRead).map(n => n.id));
        const visible = pages.filter(n => !removed.has(n.id));
        const stillUnreadInPage = visible.filter(n => !n.isRead && !readNow.has(n.id)).length;
        const unreadInPage = visible.filter(n => !n.isRead).length;
        return Math.max(0, totals.unread - (unreadInPage - stillUnreadInPage));
    }, [totals.unread, pages, live, userId, removed]);

    return {
        rows, hasMore, busy, ready, loadMore, reload: loadFirst, remove, removeRead,
        total: totals.total, matched: totals.matched, unread, searching: !!q,
    };
}
