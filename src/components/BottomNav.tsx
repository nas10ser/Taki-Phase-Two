import React from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
// v15.51 — صيغةُ المعدود من المحرّك الواحد: «طلبان» لا «2 طلب» (قاعدة v14.92).
import { arCount } from '../utils/arPlural';

const ORDERS = { one: 'طلب واحد', two: 'طلبان', twoGen: 'طلبين', few: 'طلبات', many: 'طلباً' };

const BottomNav: React.FC = () => {
    const history = useHistory();
    const location = useLocation();
    const { language, user, notifications, darkMode, toggleDarkMode, effectiveUserType, notifUnread, bookings, storeOpenOrders } = useApp();

    const isRTL = language === 'ar';

    // Honour admin "view-as" impersonation so the bottom nav matches what
    // the buyer/seller actually sees in preview mode. Read ONLY from
    // effectiveUserType — checking `user.userType === 'admin'` as a
    // separate condition was the bug: an admin in "preview as buyer" mode
    // (effectiveUserType='buyer') was still falling into the seller nav
    // because their real userType is admin.
    const showSellerNav = effectiveUserType === 'seller' || effectiveUserType === 'admin';

    // v14.26 — العدّ من الخادم أولاً. النافذة المحلّية أحدث ١٠٠ صفّ، وحسابٌ
    // قِيس عليه ٧٤٧ إشعاراً — فعدّ النافذة كان يُظهر رقماً أصغر من الحقيقة.
    // والنافذة تبقى احتياطاً لثوانٍ قبل وصول أول جواب من الخادم.
    const localUnread = notifications.filter(n => !n.isRead && n.userId === user?.id).length;
    const unreadCount = Math.max(notifUnread || 0, localUnread);

    // 🔴 v15.51 (أمرُ ناصر) — علامةٌ على «حجوزاتي» تقول إن هناك طلباً قائماً.
    // الطلبُ القائم `pending` أو `acknowledged` — نفسُ الشرط الذي تستعمله
    // «حجوزاتي» للفرز (`Bookings.tsx`)، فلا تختلف الشارةُ عمّا يجده بالداخل.
    // 🪤 ولا تُعدّ الطلباتُ المنتهيةُ زمنياً: حجزٌ مضت مهلتُه يُلغى بكرونٍ كلَّ
    //    دقيقتين، فالعدُّ عليه يُظهر شارةً لطلبٍ لا إجراءَ فيه (درس v12.06:
    //    الانتهاءُ بساعة الحائط لا بحالة القاعدة).
    const activeBookings = user
        ? bookings.filter(b =>
            b.userId === user.id
            && (b.status === 'pending' || b.status === 'acknowledged')
            && (!b.expiryTime || b.expiryTime > Date.now())).length
        : 0;

    // 🪤 والشارةُ تُعلن معناها هي: «٣ غير مقروء» صحيحةٌ للجرس وكاذبةٌ على
    //    «حجوزاتي». فلكلّ تبويبٍ صيغتُه، وقارئُ الشاشة يسمع الصحيح.
    type NavItem = { id: string; icon: string; ar: string; en: string; path: string;
                     badgeCount?: number; badgeAr?: (n: number) => string; badgeEn?: (n: number) => string };
    let items: NavItem[] = [
        { id: 'home', icon: '🏠', ar: 'الرئيسية', en: 'Home', path: '/' },
        { id: 'notifications', icon: '🔔', ar: 'الإشعارات', en: 'Alerts', path: '/notifications', badgeCount: unreadCount },
        { id: 'nearby', icon: '📍', ar: 'حولي', en: 'Nearby', path: '/nearby' },
        { id: 'bookings', icon: '🎟️', ar: 'حجوزاتي', en: 'Bookings', path: '/bookings', badgeCount: activeBookings,
          badgeAr: (n) => `${arCount(n, ORDERS)} قائم`, badgeEn: (n) => `${n} active order${n === 1 ? '' : 's'}` },
        { id: 'profile', icon: '👤', ar: 'حسابي', en: 'Profile', path: '/profile' },
    ];

    if (showSellerNav) {
        items = [
            { id: 'home', icon: '🏠', ar: 'الرئيسية', en: 'Home', path: '/' },
            // 🔴 v15.77 (أمرُ ناصر) — نظيرُ شارة «حجوزاتي»: طلباتٌ تنتظر التاجر.
            // 🪤 وصيغةُ المعدود من المحرّك الواحد، و«بانتظارك» لا تتغيّر بالعدد
            //    فتسلم من مطابقة المثنّى («طلبان ينتظرانك») التي تنكسر في الجمع.
            { id: 'seller', icon: '➕', ar: 'لوحتي', en: 'Dashboard', path: '/seller', badgeCount: storeOpenOrders,
              badgeAr: (n) => `${arCount(n, ORDERS)} بانتظارك`, badgeEn: (n) => `${n} order${n === 1 ? '' : 's'} awaiting you` },
            { id: 'notifications', icon: '🔔', ar: 'الإشعارات', en: 'Alerts', path: '/notifications', badgeCount: unreadCount },
            { id: 'store', icon: '🏪', ar: 'صفحتي', en: 'My Store', path: `/store/${user.id}` },
            { id: 'profile', icon: '👤', ar: 'حسابي', en: 'Profile', path: '/profile' },
        ];
    }

    return (
        // v14.63 — معلَمٌ حقيقي (`<nav>`) باسم، و`aria-current` تقول لقارئ الشاشة
        // أيّ تبويب أنت فيه، والشارة تُعلن «٣ غير مقروء» بدل رقمٍ عائم.
        <nav className="bottom-nav" aria-label={isRTL ? 'التنقّل الرئيسي' : 'Main navigation'}>
            {items.map(item => {
                const isActive = location.pathname === item.path ||
                    (item.path === '/' && location.pathname === '/');

                const count = item.badgeCount || 0;
                return (
                    <button key={item.id}
                        className={`nav-item ${isActive ? 'active' : ''}`}
                        onClick={() => history.push(item.path)}
                        aria-current={isActive ? 'page' : undefined}
                        style={{ position: 'relative' }}
                    >
                        <span aria-hidden="true" style={{ fontSize: '1.3rem', marginBottom: 2 }}>{item.icon}</span>
                        {count > 0 && (
                            <span style={{
                                position: 'absolute',
                                top: 2,
                                right: '28%',
                                minWidth: 18,
                                height: 18,
                                padding: '0 4px',
                                background: '#ef4444',
                                color: '#ffffff',
                                borderRadius: 9,
                                fontSize: '0.75rem',
                                fontWeight: 900,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                border: '2px solid var(--card-bg)',
                                boxShadow: '0 0 0 1px rgba(239,68,68,0.55), 0 2px 6px rgba(239,68,68,0.45)'
                            }}
                                aria-label={isRTL
                                    ? (item.badgeAr ? item.badgeAr(count) : `${count} غير مقروء`)
                                    : (item.badgeEn ? item.badgeEn(count) : `${count} unread`)}
                            >
                                {count > 9 ? '9+' : count}
                            </span>
                        )}
                        <span style={{ fontWeight: isActive ? 800 : 600 }}>{isRTL ? item.ar : item.en}</span>
                    </button>
                );
            })}
            <button
                className="nav-item"
                onClick={toggleDarkMode}
                title={isRTL ? 'الوضع الليلي' : 'Dark Mode'}
                aria-label={darkMode ? (isRTL ? 'الوضع الفاتح' : 'Light mode') : (isRTL ? 'الوضع الليلي' : 'Dark mode')}
                aria-pressed={darkMode}
            >
                <span aria-hidden="true" style={{ fontSize: '1.3rem', marginBottom: 2 }}>{darkMode ? '☀️' : '🌙'}</span>
                <span style={{ fontWeight: 600 }}>{darkMode ? (isRTL ? 'فاتح' : 'Light') : (isRTL ? 'ليلي' : 'Dark')}</span>
            </button>
        </nav>
    );
};

export default React.memo(BottomNav);
