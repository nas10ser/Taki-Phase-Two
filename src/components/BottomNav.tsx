import React, { useEffect, useRef, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';

const BottomNav: React.FC = () => {
    const history = useHistory();
    const location = useLocation();
    const { language, user, notifications, darkMode, toggleDarkMode, effectiveUserType } = useApp();

    const isRTL = language === 'ar';

    // X-style auto-hide: drop the bar off-screen when the user scrolls
    // DOWN past a small dead-zone, snap it back the instant they scroll
    // UP. Always visible at the very top of the page so the user can
    // still navigate from a fresh load. Threshold (6 px) is deliberately
    // tiny so a casual flick doesn't toggle it.
    const [hidden, setHidden] = useState(false);
    const lastYRef = useRef(0);

    useEffect(() => {
        const onScroll = () => {
            const y = window.scrollY || window.pageYOffset || 0;
            const dy = y - lastYRef.current;
            if (y <= 8) {
                setHidden(false);
            } else if (dy > 6) {
                setHidden(true);
            } else if (dy < -6) {
                setHidden(false);
            }
            lastYRef.current = y;
        };
        lastYRef.current = window.scrollY || 0;
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    // Whenever the route changes, snap the bar back into view so the user
    // never lands on a new page with the nav still tucked away.
    useEffect(() => { setHidden(false); }, [location.pathname]);

    // Honour admin "view-as" impersonation so the bottom nav matches what
    // the buyer/seller actually sees in preview mode.
    const isSeller = effectiveUserType === 'seller';
    const isAdmin = user?.userType === 'admin';

    const unreadCount = notifications.filter(n => !n.isRead && n.userId === user?.id).length;

    type NavItem = { id: string; icon: string; ar: string; en: string; path: string; badgeCount?: number };
    let items: NavItem[] = [
        { id: 'home', icon: '🏠', ar: 'الرئيسية', en: 'Home', path: '/' },
        { id: 'notifications', icon: '🔔', ar: 'الإشعارات', en: 'Alerts', path: '/notifications', badgeCount: unreadCount },
        { id: 'nearby', icon: '📍', ar: 'حولي', en: 'Nearby', path: '/nearby' },
        { id: 'bookings', icon: '🎟️', ar: 'حجوزاتي', en: 'Bookings', path: '/bookings' },
        { id: 'profile', icon: '👤', ar: 'حسابي', en: 'Profile', path: '/profile' },
    ];

    if (isSeller || isAdmin) {
        items = [
            { id: 'home', icon: '🏠', ar: 'الرئيسية', en: 'Home', path: '/' },
            { id: 'seller', icon: '➕', ar: 'لوحتي', en: 'Dashboard', path: '/seller' },
            { id: 'notifications', icon: '🔔', ar: 'الإشعارات', en: 'Alerts', path: '/notifications', badgeCount: unreadCount },
            { id: 'store', icon: '🏪', ar: 'صفحتي', en: 'My Store', path: `/store/${user.id}` },
            { id: 'profile', icon: '👤', ar: 'حسابي', en: 'Profile', path: '/profile' },
        ];
    }

    return (
        <div
            className="bottom-nav"
            style={{
                transform: hidden ? 'translateY(110%)' : 'translateY(0)',
                transition: 'transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
                willChange: 'transform',
            }}
        >
            {items.map(item => {
                const isActive = location.pathname === item.path ||
                    (item.path === '/' && location.pathname === '/');

                const count = item.badgeCount || 0;
                return (
                    <button key={item.id}
                        className={`nav-item ${isActive ? 'active' : ''}`}
                        onClick={() => history.push(item.path)}
                        style={{ position: 'relative' }}
                    >
                        <span style={{ fontSize: '1.3rem', marginBottom: 2 }}>{item.icon}</span>
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
                                fontSize: '0.65rem',
                                fontWeight: 900,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                border: '2px solid var(--card-bg)',
                                boxShadow: '0 0 0 1px rgba(239,68,68,0.55), 0 2px 6px rgba(239,68,68,0.45)'
                            }}>
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
            >
                <span style={{ fontSize: '1.3rem', marginBottom: 2 }}>{darkMode ? '☀️' : '🌙'}</span>
                <span style={{ fontWeight: 600 }}>{darkMode ? (isRTL ? 'فاتح' : 'Light') : (isRTL ? 'ليلي' : 'Dark')}</span>
            </button>
        </div>
    );
};

export default React.memo(BottomNav);
