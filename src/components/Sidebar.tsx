import React, { useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
    const history = useHistory();
    const { user, language, setLanguage, logout, customConfirm, deleteAccount } = useApp();

    const isRTL = language === 'ar';

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

    const menuItems = [
        { id: 'home', icon: '🏠', ar: 'الرئيسية', en: 'Home', path: '/' },
        { id: 'favs', icon: '❤️', ar: 'المفضلة', en: 'Favorites', path: '/profile' },
        { id: 'bookings', icon: '📅', ar: 'حجوزاتي', en: 'My Bookings', path: '/bookings' },
        { id: 'nearby', icon: '📍', ar: 'حولي', en: 'Nearby', path: '/nearby' },
        { id: 'seasonal', icon: '🌙', ar: 'عروض الموسم', en: 'Seasonal Offers', path: '/seasonal' },
    ];

    if (user?.userType === 'seller' || user?.userType === 'admin') {
        menuItems.push({ id: 'seller', icon: '🏪', ar: 'لوحة التاجر', en: 'Seller Dashboard', path: '/seller' });
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
                    paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
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
                        style={{ width: 36, height: 36, borderRadius: 12, border: 'none', background: 'var(--gray-100)', color: 'var(--text-primary, #0f172a)', fontSize: '1.1rem', fontWeight: 900, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        ✕
                    </button>
                </div>

                {/* Navigation */}
                <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {menuItems.map(item => (
                        <button
                            key={item.id}
                            onClick={() => handleNav(item.path)}
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
