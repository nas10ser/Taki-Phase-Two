import React, { useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useNotifBrowse } from '../hooks/useNotifBrowse';
import { useApp } from '../context/AppContext';
import Navbar from '../components/Navbar';
import BottomNav from '../components/BottomNav';
import SearchInput from '../components/SearchInput';

const Notifications: React.FC = () => {
    const history = useHistory();
    const {
        notifications,
        markNotifRead,
        markAllNotifsRead,
        language,
        user,
        loading,
        isAuthReady,
        customConfirm,
        customAlert,
    } = useApp();

    const isRTL = language === 'ar';
    // v14.26 — الصفحات من الخادم. الحالة العامة تبقى مصدر ما يصل لحظياً فقط.
    // v14.63 — البحث يُمرَّر إلى الخادم، فيبحث في الجدول كلّه لا في المعروض.
    // 🪤 كل الخطّافات قبل أي `return` مبكّر — أي خطّافٍ بعده يُسقط الصفحة عند
    //    أوّل تبديل بين فرعَي «جارٍ التحميل» و«الشاشة».
    const [q, setQ] = useState('');
    const [busyId, setBusyId] = useState<string | null>(null);
    const feed = useNotifBrowse(user?.id, notifications, q);

    // Wait for the auth gate before deciding the visitor is a guest.
    // Without this check, a refresh on /notifications briefly shows the
    // "Please sign in" screen for ~1-2s while Supabase rehydrates the
    // session — even for fully-logged-in users.
    if (!isAuthReady || loading) {
        return (
            <div style={{ padding: 20, textAlign: 'center', direction: isRTL ? 'rtl' : 'ltr' }}>
                {isRTL ? 'جاري التحميل...' : 'Loading...'}
            </div>
        );
    }

    if (!user) {
        return (
            <div style={{ padding: 40, textAlign: 'center', direction: isRTL ? 'rtl' : 'ltr' }}>
                <div style={{ fontSize: '3rem', marginBottom: 20 }}>🔒</div>
                <h2>{isRTL ? 'يرجى تسجيل الدخول' : 'Please Sign In'}</h2>
                <button 
                    onClick={() => history.push('/register')}
                    style={{
                        marginTop: 20, padding: '12px 24px', borderRadius: 12,
                        background: 'var(--primary)', color: 'white', border: 'none',
                        fontWeight: 900, cursor: 'pointer'
                    }}
                >
                    {isRTL ? 'تسجيل الدخول' : 'Sign In'}
                </button>
                <BottomNav />
            </div>
        );
    }

    const myNotifications = feed.rows;
    const unreadCount = feed.unread;

    return (
        <div className="page-content" style={{ background: 'var(--body-bg)', minHeight: '100vh', paddingBottom: 100, direction: isRTL ? 'rtl' : 'ltr' }}>
            <Navbar />
            
            <div style={{ padding: '20px 16px' }}>
                <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 24, padding: 20, boxShadow: 'var(--shadow-sm)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                        <h1 style={{ fontSize: '1.5rem', fontWeight: 900, margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
                            📬 {isRTL ? 'الإشعارات' : 'Notifications'}
                            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-secondary)', background: 'var(--gray-100)', padding: '4px 12px', borderRadius: 20 }}>
                                {feed.searching
                                    ? (isRTL ? `${feed.matched} من ${feed.total}` : `${feed.matched} of ${feed.total}`)
                                    : feed.total}
                            </span>
                        </h1>
                        {unreadCount > 0 && (
                            <button
                                onClick={markAllNotifsRead}
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                    background: 'var(--primary)', color: '#fff', border: 'none',
                                    padding: '8px 14px', borderRadius: 14, fontWeight: 800,
                                    fontSize: '0.85rem', cursor: 'pointer', boxShadow: 'var(--shadow-sm)'
                                }}
                            >
                                ✓✓ {isRTL ? `قراءة الكل (${unreadCount})` : `Mark all read (${unreadCount})`}
                            </button>
                        )}
                    </div>

                    {/* v14.63 — بحثٌ يمرّ بالخادم + حذفٌ لما قُرئ. كان لا بحث ولا حذف. */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                        <SearchInput
                            value={q}
                            onChange={setQ}
                            aria-label={isRTL ? 'ابحث في إشعاراتك' : 'Search your notifications'}
                            placeholder={isRTL ? '🔍 ابحث في إشعاراتك…' : '🔍 Search your notifications…'}
                            style={{
                                flex: 1, minWidth: 180, padding: '11px 14px', borderRadius: 14,
                                border: '1.5px solid var(--border-color)', background: 'var(--body-bg)',
                                color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.85rem',
                            }}
                        />
                        {feed.total > 0 && (
                            <button
                                onClick={async () => {
                                    const ok = await customConfirm(isRTL
                                        ? 'حذف كل الإشعارات المقروءة؟ لا يمكن التراجع.'
                                        : 'Delete every notification you have already read? This cannot be undone.');
                                    if (!ok) return;
                                    const n = await feed.removeRead();
                                    await customAlert(n > 0
                                        ? (isRTL ? `🗑 حُذف ${n} إشعاراً.` : `🗑 Deleted ${n} notifications.`)
                                        : (isRTL ? 'لا يوجد إشعارٌ مقروء ليُحذف.' : 'There is nothing read to delete.'));
                                }}
                                style={{
                                    padding: '11px 14px', borderRadius: 14, cursor: 'pointer',
                                    border: '1.5px solid var(--border-color)', background: 'var(--card-bg)',
                                    color: 'var(--text-secondary)', fontWeight: 800, fontSize: '0.8rem',
                                }}
                            >
                                🗑 {isRTL ? 'حذف المقروء' : 'Delete read'}
                            </button>
                        )}
                    </div>

                    {myNotifications.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                            {myNotifications.map(n => {
                                const dealId = n.metadata?.dealId;
                                const barcode = n.metadata?.barcode;
                                const storeId = (n.metadata as any)?.storeId as string | undefined;
                                const followerId = n.metadata?.followerId;
                                // Booking notifications are tagged at write time with
                                // meta_data.audience = 'seller' | 'buyer' | 'admin'
                                // (set by the DB trigger handle_booking_notification).
                                // The audience — NOT the current user's role — decides
                                // the destination, because one user can be a seller AND
                                // an admin at the same time. A "📦 طلب حجز جديد!" addressed
                                // to the seller must land on the seller dashboard order
                                // card, even when the recipient is also an admin.
                                //
                                // Admin booking notifications: if the same person is also
                                // the seller (storeId === user.id), open the order card
                                // directly — that's almost always what they want to see.
                                // Otherwise open the universal booking receipt
                                // (/booking/:barcode) — full details in-app, and it
                                // never 404s even after the underlying deal is deleted.
                                const isBookingNotif = n.type === 'booking';
                                const audience = (n.metadata as any)?.audience as 'seller' | 'buyer' | 'admin' | undefined;
                                // v12.35 — broadcast notifications (contest announcements,
                                // platform-mode changes, campaigns) can carry an explicit
                                // INTERNAL destination in meta_data.actionUrl. Only paths
                                // starting with '/' are honored so external URLs from
                                // campaign metadata can never hijack navigation.
                                const rawActionUrl = (n.metadata as any)?.actionUrl;
                                const actionUrl = typeof rawActionUrl === 'string' && rawActionUrl.startsWith('/')
                                    ? rawActionUrl : null;
                                // Booking-related notifications (creation confirmation, seller
                                // acknowledgement, chat messages, completion, cancellation) must
                                // land on the page where the booking + its chat thread lives:
                                //   - buyer audience → /bookings?barcode=…   (auto-expands card + scrolls + highlights)
                                //   - seller audience → /seller?tab=orders&barcode=…
                                //   - admin audience → seller dash if same user, else admin overview
                                // Before v10.69 the buyer flow opened /deal/{id} which sent the
                                // user back to the product page even when they tapped "💬 رسالة
                                // جديدة" — the chat is on Bookings, not on the deal page.
                                // Report-threshold admin alert → the new
                                // Reports & Complaints center tab.
                                const isReportNotif = n.type === 'report';
                                const dest = !isBookingNotif && actionUrl
                                    ? actionUrl
                                    : isReportNotif
                                    ? '/admin?tab=reports'
                                    : isBookingNotif && audience === 'seller' && barcode
                                    ? `/seller?tab=orders&barcode=${barcode}`
                                    : isBookingNotif && audience === 'buyer' && barcode
                                        ? `/bookings?barcode=${barcode}`
                                        : isBookingNotif && audience === 'admin' && storeId === user.id && barcode
                                            ? `/seller?tab=orders&barcode=${barcode}`
                                            : isBookingNotif && audience === 'admin' && barcode
                                                // Admin sale alerts open the universal in-app receipt
                                                // (resolved by barcode). Before v11.57 this branch went to
                                                // /deal/{id}, which showed "العرض غير موجود" the moment the
                                                // deal was deleted (a finished promo or a bot test deal).
                                                ? `/booking/${barcode}`
                                                : isBookingNotif && audience === 'admin'
                                                    ? '/admin?tab=overview'
                                                    : isBookingNotif && barcode
                                                        ? `/booking/${barcode}`
                                                        : isBookingNotif
                                                            ? '/bookings'
                                                            : dealId
                                                                ? `/deal/${dealId}${barcode ? `?barcode=${barcode}` : ''}`
                                                                : n.type === 'follow' || followerId
                                                                    ? '/profile'
                                                                    : n.type === 'marketing'
                                                                        ? '/'
                                                                        : null;

                                const isHighPriority = !n.isRead && (
                                    n.type === 'follow' || 
                                    n.metadata?.followerId ||
                                    n.title.ar.includes('حجز جديد') || 
                                    n.title.en.includes('New Booking') || 
                                    n.title.ar.includes('تفاصيل') || 
                                    n.title.en.includes('Prep') ||
                                    n.title.ar.includes('متابع') ||
                                    n.title.en.includes('Follow')
                                );

                                return (
                                    <div key={n.id} style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
                                    <button
                                        onClick={() => {
                                            if (!n.isRead) markNotifRead(n.id);
                                            if (dest) history.push(dest);
                                        }}
                                        style={{ flex: 1, minWidth: 0,
                                            textAlign: isRTL ? 'right' : 'left',
                                            background: n.isRead ? 'var(--card-bg)' : isHighPriority ? 'var(--danger-light)' : 'var(--notif-unread-bg)',
                                            border: n.isRead ? '1px solid var(--border-color)' : `1.5px solid ${isHighPriority ? 'var(--danger)' : 'var(--accent)'}`,
                                            padding: '16px 18px',
                                            borderRadius: 20,
                                            cursor: dest ? 'pointer' : 'default',
                                            display: 'flex', 
                                            flexDirection: 'column', 
                                            gap: 6,
                                            width: '100%',
                                            position: 'relative',
                                            transition: 'all 0.2s ease',
                                            boxShadow: !n.isRead ? '0 4px 12px var(--accent-glow)' : 'none',
                                            transform: !n.isRead ? 'scale(1.01)' : 'scale(1)'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 900, color: 'var(--text-primary)', fontSize: '1rem' }}>
                                            {!n.isRead && <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', display: 'inline-block', flexShrink: 0 }} />}
                                            {isRTL ? n.title.ar : n.title.en}
                                        </div>
                                        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.5, fontWeight: 500 }}>
                                            {isRTL ? n.body.ar : n.body.en}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 800, marginTop: 4, display: 'flex', justifyContent: 'flex-end' }}>
                                            {/* 🪤 `ar-SA` وحدها تُخرج التاريخ هجرياً — `-u-ca-gregory` إلزامية. */}
                                            {new Date(n.createdAt).toLocaleString(isRTL ? 'ar-SA-u-ca-gregory' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })}
                                        </div>
                                    </button>
                                    <button
                                        onClick={async () => {
                                            setBusyId(n.id);
                                            const ok = await feed.remove(n);
                                            setBusyId(null);
                                            if (!ok) await customAlert(isRTL ? '❌ تعذّر حذف الإشعار.' : '❌ Could not delete that notification.');
                                        }}
                                        disabled={busyId === n.id}
                                        aria-label={isRTL ? 'حذف هذا الإشعار' : 'Delete this notification'}
                                        style={{
                                            flexShrink: 0, width: 44, borderRadius: 16, cursor: 'pointer',
                                            border: '1px solid var(--border-color)', background: 'var(--card-bg)',
                                            color: 'var(--danger)', fontSize: '0.95rem', fontWeight: 900,
                                            opacity: busyId === n.id ? 0.5 : 1,
                                        }}
                                    >🗑</button>
                                    </div>
                                );
                            })}
                            {feed.hasMore && (
                                <button
                                    onClick={feed.loadMore}
                                    disabled={feed.busy}
                                    style={{
                                        marginTop: 6, padding: '13px 0', width: '100%',
                                        background: 'var(--card-bg)', color: 'var(--text-primary)',
                                        border: '1.5px solid var(--border-color)', borderRadius: 16,
                                        fontWeight: 900, fontSize: '0.85rem',
                                        cursor: feed.busy ? 'default' : 'pointer', opacity: feed.busy ? 0.6 : 1,
                                    }}
                                >
                                    {feed.busy
                                        ? (isRTL ? 'جارٍ التحميل…' : 'Loading…')
                                        : (isRTL
                                            ? `عرض المزيد — ظهر ${myNotifications.length} من ${feed.searching ? feed.matched : feed.total}`
                                            : `Show more — ${myNotifications.length} of ${feed.searching ? feed.matched : feed.total}`)}
                                </button>
                            )}
                            {!feed.hasMore && feed.total > 40 && (
                                <div style={{ textAlign: 'center', padding: '10px 0', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>
                                    {isRTL ? `— هذه كل إشعاراتك (${feed.total}) —` : `— that is all (${feed.total}) —`}
                                </div>
                            )}
                        </div>
                    ) : feed.busy && !feed.ready ? (
                        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)', fontWeight: 800 }}>
                            {isRTL ? 'جارٍ تحميل إشعاراتك…' : 'Loading your notifications…'}
                        </div>
                    ) : (
                        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                            <div style={{ fontSize: '4rem', marginBottom: 20 }}>{feed.searching ? '🔍' : '📭'}</div>
                            {feed.searching ? (
                                <>
                                    <h3 style={{ fontWeight: 800 }}>{isRTL ? 'لا إشعار يطابق بحثك' : 'No notification matches your search'}</h3>
                                    <button
                                        onClick={() => setQ('')}
                                        style={{
                                            marginTop: 14, padding: '10px 18px', borderRadius: 14, cursor: 'pointer',
                                            border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 900, fontSize: '0.85rem',
                                        }}
                                    >{isRTL ? 'مسح البحث' : 'Clear search'}</button>
                                </>
                            ) : (
                                <>
                                    <h3 style={{ fontWeight: 800 }}>{isRTL ? 'لا توجد إشعارات حالياً' : 'No notifications yet'}</h3>
                                    <p style={{ fontSize: '0.9rem', marginTop: 10 }}>{isRTL ? 'سنقوم بتنبيهك عند توفر عروض جديدة تهمك' : 'We will notify you when relevant new deals arrive'}</p>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <BottomNav />
        </div>
    );
};

export default Notifications;
