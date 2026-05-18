import React, { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import ComplaintDialog from './ComplaintDialog';

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
    const history = useHistory();
    const { user, isAuthReady, language, setLanguage, logout, customConfirm, deleteAccount, setViewAs, viewAs, effectiveUserType, darkMode, toggleDarkMode, platformSettings } = useApp();

    const isRTL = language === 'ar';
    // Admin-only UI guards. We require BOTH `userType === 'admin'` (DB-backed)
    // and `isAuthReady` so the sidebar never flashes admin controls based on
    // a stale optimistic profile (e.g. legacy JWT user_metadata mismatch).
    const isRealAdmin = isAuthReady && user?.userType === 'admin';
    const [showComplaint, setShowComplaint] = useState(false);

    // Lock body scroll while open so the page underneath doesn't move when
    // the user scrolls inside the panel on iOS Safari.
    useEffect(() => {
        if (!isOpen) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [isOpen]);

    // Close on Escape — a small accessibility win.
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    // Bookings is a buyer-only surface — sellers fulfil bookings from the
    // Seller Dashboard, so showing them an empty "حجوزاتي" page was pure
    // dead-end UI. Hide it whenever the *effective* role is seller (covers
    // real sellers and admins previewing as seller).
    const isSellerView = effectiveUserType === 'seller';

    const menuItems = [
        { id: 'home', icon: '🏠', ar: 'الرئيسية', en: 'Home', path: '/' },
        { id: 'favs', icon: '❤️', ar: 'المفضلة', en: 'Favorites', path: '/profile' },
        ...(!isSellerView ? [{ id: 'bookings', icon: '📅', ar: 'حجوزاتي', en: 'My Bookings', path: '/bookings' }] : []),
        { id: 'nearby', icon: '📍', ar: 'حولي', en: 'Nearby', path: '/nearby' },
    ];
    // Seasonal offers section — admin can show/hide globally from
    // platform_settings.seasonal_offers_visible. Hidden by default.
    if (platformSettings.seasonalOffersVisible) {
        menuItems.push({ id: 'seasonal', icon: '🌙', ar: 'عروض الموسم', en: 'Seasonal Offers', path: '/seasonal' });
    }

    if (isAuthReady && (user?.userType === 'seller' || user?.userType === 'admin')) {
        menuItems.push({ id: 'seller', icon: '🏪', ar: 'لوحة التاجر', en: 'Seller Dashboard', path: '/seller' });
    }
    if (isRealAdmin) {
        menuItems.push({ id: 'admin', icon: '🛠️', ar: 'مركز الإدارة', en: 'Admin Center', path: '/admin' });
    }
    // Complaints / contact admin — any signed-in user (#3 entry point).
    if (isAuthReady && user) {
        menuItems.push({ id: 'complaint', icon: '📣', ar: 'الشكاوى / تواصل الإدارة', en: 'Complaints / Contact admin', path: '__complaint__' });
    }

    const handleNav = (path: string) => {
        history.push(path);
        onClose();
    };

    const side: 'right' | 'left' = isRTL ? 'right' : 'left';
    // Slide via transform — cheaper than animating a positional property and
    // avoids the layout thrash that was clipping the top items behind the
    // sticky header on first paint.
    const translateX = isOpen ? '0' : (side === 'right' ? '110%' : '-110%');

    return (
        <>
            <div
                onClick={onClose}
                aria-hidden={!isOpen}
                style={{
                    position: 'fixed', inset: 0, background: 'rgba(8, 12, 24, 0.55)',
                    backdropFilter: 'blur(4px)',
                    WebkitBackdropFilter: 'blur(4px)',
                    zIndex: 2999,
                    opacity: isOpen ? 1 : 0,
                    pointerEvents: isOpen ? 'auto' : 'none',
                    transition: 'opacity 0.25s ease'
                }}
            />

            <aside
                role="dialog"
                aria-modal="true"
                aria-hidden={!isOpen}
                dir={isRTL ? 'rtl' : 'ltr'}
                style={{
                    position: 'fixed',
                    top: 0,
                    bottom: 0,
                    [side]: 0,
                    width: 'min(86vw, 320px)',
                    maxWidth: 320,
                    background: 'var(--card-bg, #ffffff)',
                    color: 'var(--text-primary, #0f172a)',
                    zIndex: 3000,
                    transform: `translateX(${translateX})`,
                    transition: 'transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)',
                    // v10.67 — was env(...) + 16px, which on iPhone left
                    // "🏠 الرئيسية" sitting right next to the status bar.
                    // 36px gives the menu the same breathing room you'd
                    // see in a native iOS drawer (sits roughly level with
                    // the battery glyph instead of crowding the notch).
                    paddingTop: 'calc(env(safe-area-inset-top, 0px) + 36px)',
                    paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
                    paddingInline: 18,
                    display: 'flex',
                    flexDirection: 'column',
                    overflowY: 'auto',
                    boxShadow: side === 'right'
                        ? '-12px 0 40px rgba(0,0,0,0.25)'
                        : '12px 0 40px rgba(0,0,0,0.25)',
                    WebkitOverflowScrolling: 'touch'
                }}
            >
                {/* Header row: avatar + name + close */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 26 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 16, background: 'linear-gradient(135deg, var(--primary, #00897b), var(--primary-dark, #00695c))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', color: 'white', fontWeight: 900 }}>
                        {user ? (user.name || 'U').charAt(0).toUpperCase() : '👤'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 900, fontSize: '1rem', color: 'var(--text-primary, #0f172a)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {user ? user.name : (isRTL ? 'زائر' : 'Guest')}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--gray-500, #64748b)', fontWeight: 700, marginTop: 2 }}>
                            {user
                                ? (user.userType === 'seller' ? (isRTL ? 'بائع ⭐' : 'Seller ⭐') : user.userType === 'admin' ? (isRTL ? 'مدير 👑' : 'Admin 👑') : (isRTL ? 'مشتري' : 'Buyer'))
                                : (isRTL ? 'لم يتم تسجيل الدخول' : 'Not signed in')}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label={isRTL ? 'إغلاق' : 'Close'}
                        style={{ width: 44, height: 44, minWidth: 44, minHeight: 44, borderRadius: 12, border: 'none', background: 'var(--gray-100)', color: 'var(--text-primary, #0f172a)', fontSize: '1.15rem', fontWeight: 900, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        ✕
                    </button>
                </div>

                {/* Navigation. `flex: 1` used to push the settings block all
                    the way to the bottom of the viewport, leaving a big empty
                    column on phones with only 4 menu items. Plain flex-column
                    keeps the items + settings stacked naturally with their
                    intrinsic spacing. */}
                <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {menuItems.map(item => (
                        <button
                            key={item.id}
                            onClick={() => {
                                if (item.path === '__complaint__') { setShowComplaint(true); onClose(); }
                                else handleNav(item.path);
                            }}
                            style={{
                                width: '100%',
                                padding: '13px 14px',
                                borderRadius: 12,
                                border: 'none',
                                background: 'transparent',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 14,
                                cursor: 'pointer',
                                textAlign: isRTL ? 'right' : 'left',
                                color: 'var(--text-primary, #0f172a)',
                                fontWeight: 800,
                                fontSize: '0.95rem',
                                transition: 'background 0.15s ease'
                            }}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--gray-50, #f8fafc)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                        >
                            <span style={{ fontSize: '1.2rem', width: 28, textAlign: 'center' }}>{item.icon}</span>
                            <span>{isRTL ? item.ar : item.en}</span>
                        </button>
                    ))}
                </nav>

                {showComplaint && (
                    <ComplaintDialog isRTL={isRTL} onClose={() => setShowComplaint(false)} />
                )}

                {/* Footer: settings + auth */}
                <div style={{ borderTop: '1px solid var(--border-color, #e2e8f0)', paddingTop: 16, marginTop: 16 }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--gray-400, #94a3b8)', fontWeight: 800, marginBottom: 10, textAlign: isRTL ? 'right' : 'left', letterSpacing: 0.5 }}>
                        {isRTL ? 'الإعدادات' : 'SETTINGS'}
                    </div>

                    <button onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
                        style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid var(--border-color, #e2e8f0)', background: 'var(--card-bg, white)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, color: 'var(--text-primary, #0f172a)', cursor: 'pointer' }}>
                        <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>{isRTL ? 'تغيير اللغة' : 'Change Language'}</span>
                        <span style={{ fontWeight: 900, color: '#0284c7', fontSize: '0.85rem' }}>{language === 'ar' ? 'English' : 'عربي'}</span>
                    </button>

                    <button onClick={toggleDarkMode}
                        aria-pressed={darkMode}
                        style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid var(--border-color, #e2e8f0)', background: 'var(--card-bg, white)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, color: 'var(--text-primary, #0f172a)', cursor: 'pointer' }}>
                        <span style={{ fontWeight: 800, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span aria-hidden>{darkMode ? '🌙' : '☀️'}</span>
                            {isRTL ? (darkMode ? 'الوضع الليلي' : 'الوضع الفاتح') : (darkMode ? 'Dark Mode' : 'Light Mode')}
                        </span>
                        <span aria-hidden style={{
                            position: 'relative', width: 38, height: 22, borderRadius: 999,
                            background: darkMode ? 'var(--primary, #0f172a)' : 'var(--gray-200, #e2e8f0)',
                            transition: 'background 0.25s ease',
                        }}>
                            <span style={{
                                position: 'absolute', top: 2,
                                [isRTL ? 'right' : 'left']: darkMode ? 18 : 2,
                                width: 18, height: 18, borderRadius: '50%',
                                background: '#ffffff', boxShadow: '0 2px 4px rgba(0,0,0,.2)',
                                transition: `${isRTL ? 'right' : 'left'} 0.25s ease`,
                            }} />
                        </span>
                    </button>

                    {isRealAdmin && (
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ fontSize: '0.7rem', color: 'var(--gray-400)', fontWeight: 800, marginBottom: 8, letterSpacing: 0.5 }}>{isRTL ? 'وضع المعاينة (للإدارة)' : 'PREVIEW MODE'}</div>
                            <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={() => { setViewAs('buyer'); onClose(); history.push('/'); }} 
                                    style={{ flex: 1, padding: '8px', borderRadius: 10, border: 'none', background: effectiveUserType === 'buyer' && viewAs ? 'var(--primary)' : 'var(--gray-100)', color: effectiveUserType === 'buyer' && viewAs ? 'white' : 'var(--text-primary)', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer' }}>
                                    🛒 {isRTL ? 'مشتري' : 'Buyer'}
                                </button>
                                <button onClick={() => { setViewAs('seller'); onClose(); history.push('/seller'); }}
                                    style={{ flex: 1, padding: '8px', borderRadius: 10, border: 'none', background: effectiveUserType === 'seller' && viewAs ? 'var(--primary)' : 'var(--gray-100)', color: effectiveUserType === 'seller' && viewAs ? 'white' : 'var(--text-primary)', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer' }}>
                                    🏪 {isRTL ? 'تاجر' : 'Seller'}
                                </button>
                                <button onClick={() => { setViewAs(null); onClose(); history.push('/admin'); }}
                                    style={{ flex: 1, padding: '8px', borderRadius: 10, border: 'none', background: !viewAs ? 'var(--primary)' : 'var(--gray-100)', color: !viewAs ? 'white' : 'var(--text-primary)', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer' }}>
                                    🛠️ {isRTL ? 'مدير' : 'Admin'}
                                </button>
                            </div>
                        </div>
                    )}

                    {!user ? (
                        <button
                            onClick={() => { onClose(); history.push('/register'); }}
                            style={{ width: '100%', padding: '12px', borderRadius: 12, border: 'none', background: 'var(--primary, #00897b)', color: 'white', fontWeight: 900, cursor: 'pointer', fontSize: '0.9rem' }}>
                            {isRTL ? 'تسجيل الدخول / إنشاء حساب' : 'Login / Sign up'}
                        </button>
                    ) : (
                        <>
                            <button
                                onClick={() => { logout(); onClose(); history.push('/'); }}
                                style={{ width: '100%', padding: '12px', borderRadius: 12, border: 'none', background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, justifyContent: 'center', cursor: 'pointer', fontSize: '0.9rem' }}
                            >
                                <span>🚪</span> {isRTL ? 'تسجيل الخروج' : 'Logout'}
                            </button>
                            <button
                                onClick={async () => {
                                    if (await customConfirm(isRTL ? 'هل أنت متأكد من حذف الحساب؟ سيتم حذف جميع بياناتك نهائياً.' : 'Are you sure? All your data will be permanently deleted.')) {
                                        deleteAccount();
                                        onClose();
                                        history.push('/register');
                                    }
                                }}
                                style={{ width: '100%', padding: '8px', color: 'var(--text-secondary)', background: 'none', border: 'none', fontSize: '0.72rem', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}
                            >
                                {isRTL ? 'حذف الحساب نهائياً' : 'Delete Account'}
                            </button>
                        </>
                    )}
                </div>
            </aside>
        </>
    );
};

export default React.memo(Sidebar);
