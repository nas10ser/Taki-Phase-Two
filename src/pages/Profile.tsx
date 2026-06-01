import React, { useState, useMemo, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import { useApp } from '../context/AppContext';
import { REGIONS, CITIES, LOCATIONS, Category, CATEGORIES } from '../data/mock';
import { SmartAlertRule } from '../services/authService';
import { normalizeArabicNumerals, getCurrentPositionSafe, geoErrorMessage } from '../utils/helpers';
import AccountSettingsCard from '../components/AccountSettingsCard';

const Profile: React.FC = () => {
    const history = useHistory();
    const {
        user, followedMerchants, deals, language, setLanguage, logout, deleteAccount,
        smartAlerts, addSmartAlert, removeSmartAlert,
        notifications, markNotifRead, bookings,
        storeProfiles, updateStoreProfile, updateProfile, customAlert, customConfirm,
        isAuthReady, effectiveUserType
    } = useApp();

    // Honour admin "view-as" impersonation. When an admin previews as
    // buyer, every display branch below must read effectiveUserType so the
    // page renders the buyer's UI (no shop banner, "Buyer" badge, buyer
    // stats, no seller-only contact section). The real user.userType
    // stays 'admin' — only the rendered surface flips.
    const displayUserType = effectiveUserType;

    const myNotifications = useMemo(
        () => notifications.filter(n => n.userId === user?.id).slice().sort((a, b) => b.createdAt - a.createdAt),
        [notifications, user?.id]
    );

    // Seller stats: completed bookings on their deals
    const sellerStats = useMemo(() => {
        if (user?.userType !== 'seller') return { soldQty: 0, completedCount: 0 };
        const completed = bookings.filter(b =>
            b.status === 'completed' &&
            (b.deal?.storeId === user.id || (b.deal as any)?.store_id === user.id)
        );
        const soldQty = completed.reduce((s, b) => s + (b.bookedQuantity || 1), 0);
        return { soldQty, completedCount: completed.length };
    }, [bookings, user]);

    // Buyer stats: total savings and completed booking count
    const buyerStats = useMemo(() => {
        if (!user || user.userType === 'seller') return { savings: 0, completedCount: 0 };
        const completed = bookings.filter(b =>
            b.status === 'completed' && b.userId === user.id
        );
        const savings = completed.reduce((s, b) => {
            const orig = Number(b.deal?.originalPrice || 0);
            const disc = Number(b.deal?.discountedPrice || 0);
            return s + (orig - disc) * (b.bookedQuantity || 1);
        }, 0);
        return { savings: Math.round(savings), completedCount: completed.length };
    }, [bookings, user]);
    const unreadCount = useMemo(
        () => myNotifications.filter(n => !n.isRead).length,
        [myNotifications]
    );

    // Persist the active tab in sessionStorage so that navigating away
    // (e.g. opening a legal page from "Settings") and coming back via the
    // browser/native back button returns to the same tab the user left.
    const [activeTab, setActiveTab] = useState<'notifications' | 'followed' | 'settings'>(() => {
        try {
            const saved = sessionStorage.getItem('taki:profile:activeTab');
            return saved === 'followed' || saved === 'settings' ? saved : 'notifications';
        } catch { return 'notifications'; }
    });
    useEffect(() => {
        try { sessionStorage.setItem('taki:profile:activeTab', activeTab); } catch { /* ignore */ }
    }, [activeTab]);
    const [newKeyword, setNewKeyword] = useState('');
    const [filterRegion, setFilterRegion] = useState('');
    const [filterCity, setFilterCity] = useState('');
    const [filterMall, setFilterMall] = useState('');
    const [filterCategories, setFilterCategories] = useState<string[]>([]);
    const [filterKm, setFilterKm] = useState('');
    const [preciseCoords, setPreciseCoords] = useState<{lat: number, lng: number} | null>(null);
    const [gettingLocation, setGettingLocation] = useState(false);
    const [contactPhone, setContactPhone] = useState(user?.contactPhone || user?.phone || '');
    const [contactEmail, setContactEmail] = useState(user?.email || '');
    const isRTL = language === 'ar';

    const followedMerchantsList = useMemo(() => {
        return followedMerchants.map(id => {
            const profile = storeProfiles[id];
            const storeDeals = deals.filter(d => d.storeId === id);
            const allRatings = storeDeals.flatMap(d => d.ratings || []);
            const avg = allRatings.length > 0 ? (allRatings.reduce((acc, r) => acc + r.score, 0) / allRatings.length).toFixed(1) : null;

            if (profile) {
                const sp = profile as any;
                return { id, name: sp.shop || sp.name || 'متجر', avatar: sp.avatar_url || sp.avatar, rating: avg };
            }
            const deal = deals.find(d => d.storeId === id);
            if (deal) return { id, name: deal.shopName, avatar: null, rating: avg };
            return { id, name: isRTL ? 'متجر' : 'Store', avatar: null, rating: avg };
        });
    }, [followedMerchants, storeProfiles, deals, isRTL]);

    // Wait for the auth gate before deciding the visitor is a guest.
    // Without this, a refresh on /profile briefly shows the "Welcome"
    // screen for ~1-2s while Supabase rehydrates the session, even
    // for fully-logged-in users.
    if (!isAuthReady) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--body-bg)' }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid var(--border-color)', borderTopColor: '#10b981', animation: 'taki-spin 0.8s linear infinite' }} />
                <style>{`@keyframes taki-spin{to{transform:rotate(360deg)}}`}</style>
            </div>
        );
    }

    if (!user) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, textAlign: 'center', background: 'var(--body-bg)' }}>
                <div style={{ fontSize: '4rem', marginBottom: 20 }}>👋</div>
                <h2 style={{ fontWeight: 900, fontSize: '1.5rem', marginBottom: 8 }}>{isRTL ? 'مرحباً بك في تاكي' : 'Welcome to TAKI'}</h2>
                <p style={{ color: 'var(--text-secondary)', marginBottom: 30, fontWeight: 600 }}>{isRTL ? 'يرجى تسجيل الدخول للوصول لهذه الصفحة' : 'Please login to access this page'}</p>
                <button onClick={() => history.push('/register')}
                    style={{ width: '100%', maxWidth: 320, padding: '16px', borderRadius: 16, background: 'var(--dark)', color: 'white', fontWeight: 900, border: 'none', fontSize: '1rem' }}>
                    {isRTL ? 'تسجيل الدخول' : 'Login / Register'}
                </button>
            </div>
        );
    }

    return (
        <div className="page-content" style={{ background: 'var(--body-bg)', minHeight: '100vh', direction: isRTL ? 'rtl' : 'ltr' }}>
            {/* Profile Header */}
            {/* `position: 'static'` overrides the sticky default from
                .premium-bar. On Home and Nearby the sticky search bar is
                useful, but on Profile the avatar/stats banner is purely
                informational — leaving it pinned ate half the viewport
                whenever the user scrolled down to find the smart-alerts
                form. Static means it scrolls away cleanly. */}
            <div className="premium-bar" style={{ textAlign: 'center', padding: '0 20px 32px', paddingTop: 'calc(env(safe-area-inset-top, 12px) + 12px)', position: 'static' }}>
                {/* Top Actions Bar — No overlap */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingTop: 8 }}>
                    <button onClick={() => history.push('/')}
                        style={{ background: 'rgba(100, 100, 100, 0.15)', backdropFilter: 'blur(10px)', border: '1px solid rgba(80, 80, 95, 0.2)', color: 'white', width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', cursor: 'pointer' }}>
                        {isRTL ? '→' : '←'}
                    </button>
                    <span style={{ color: 'white', fontWeight: 900, fontSize: '1.1rem' }}>{isRTL ? 'الملف الشخصي' : 'Profile'}</span>
                    <button onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
                        style={{ background: 'rgba(100, 100, 100, 0.15)', backdropFilter: 'blur(10px)', border: '1px solid rgba(80, 80, 95, 0.2)', color: 'white', padding: '8px 14px', borderRadius: 12, fontSize: '0.8rem', fontWeight: 800, cursor: 'pointer' }}>
                        {language === 'ar' ? 'EN' : 'عربي'}
                    </button>
                </div>

                <div style={{ width: 100, height: 100, borderRadius: 50, background: 'rgba(80, 80, 95, 0.2)', backdropFilter: 'blur(10px)', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '3rem', border: '4px solid rgba(80, 80, 95, 0.3)', boxShadow: '0 8px 25px rgba(0,0,0,0.1)' }}>
                    👤
                </div>
                <h1 style={{ fontSize: '1.4rem', fontWeight: 900, color: 'white', marginBottom: 4 }}>{displayUserType === 'seller' && user.shop ? user.shop : user.name}</h1>
                {displayUserType === 'seller' && user.shop && user.name && (
                    <div style={{ color: 'rgba(150, 150, 150, 0.8)', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>{user.name}</div>
                )}
                <div style={{ color: 'rgba(200, 200, 200, 0.9)', fontSize: '0.85rem', fontWeight: 700, marginBottom: 20 }}>
                    {displayUserType === 'seller' ? (isRTL ? 'بائع مميز ⭐' : 'Premium Seller ⭐') :
                     displayUserType === 'admin' ? (isRTL ? 'مدير النظام 👑' : 'Admin 👑') :
                     (isRTL ? 'مشتري ⭐' : 'Buyer ⭐')}
                </div>

                <div style={{ display: 'flex', gap: 15, justifyContent: 'center' }}>
                    {displayUserType === 'seller' ? (
                        <>
                            <div style={{ background: 'rgba(80, 80, 90, 0.3)', padding: '12px 20px', borderRadius: 16, minWidth: 100, textAlign: 'center' }}>
                                <div style={{ fontSize: '1.3rem', fontWeight: 900, color: 'white' }}>{sellerStats.soldQty}</div>
                                <div style={{ fontSize: '0.7rem', color: 'rgba(220, 220, 230, 0.85)', fontWeight: 800 }}>{isRTL ? 'كمية مباعة' : 'Units Sold'}</div>
                            </div>
                            <div style={{ background: 'rgba(80, 80, 90, 0.3)', padding: '12px 20px', borderRadius: 16, minWidth: 100, textAlign: 'center' }}>
                                <div style={{ fontSize: '1.3rem', fontWeight: 900, color: 'white' }}>{sellerStats.completedCount}</div>
                                <div style={{ fontSize: '0.7rem', color: 'rgba(220, 220, 230, 0.85)', fontWeight: 800 }}>{isRTL ? 'حجز مكتمل' : 'Completed'}</div>
                            </div>
                        </>
                    ) : (
                        <>
                            <div style={{ background: 'rgba(80, 80, 90, 0.3)', padding: '12px 20px', borderRadius: 16, minWidth: 100, textAlign: 'center' }}>
                                <div style={{ fontSize: '1.3rem', fontWeight: 900, color: 'white' }}>{buyerStats.savings}</div>
                                <div style={{ fontSize: '0.7rem', color: 'rgba(220, 220, 230, 0.85)', fontWeight: 800 }}>{isRTL ? 'توفيرك (ر.س)' : 'Total Savings'}</div>
                            </div>
                            <div style={{ background: 'rgba(80, 80, 90, 0.3)', padding: '12px 20px', borderRadius: 16, minWidth: 100, textAlign: 'center' }}>
                                <div style={{ fontSize: '1.3rem', fontWeight: 900, color: 'white' }}>{buyerStats.completedCount}</div>
                                <div style={{ fontSize: '0.7rem', color: 'rgba(220, 220, 230, 0.85)', fontWeight: 800 }}>{isRTL ? 'حجز مكتمل' : 'Completed'}</div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Tabs */}
            <div style={{ padding: '24px 16px 8px' }}>
                <div style={{ display: 'flex', gap: 6, background: 'var(--chip-inactive-bg)', padding: 5, borderRadius: 18 }}>
                    <button onClick={() => setActiveTab('notifications')} className={`segment-chip${activeTab === 'notifications' ? ' active' : ''}`}>
                        {isRTL ? '🧠 تنبيهات ذكية' : '🧠 Smart Alerts'}
                    </button>
                    <button onClick={() => setActiveTab('followed')} className={`segment-chip${activeTab === 'followed' ? ' active' : ''}`}>
                        {isRTL ? '❤️ المتابعة' : '❤️ Following'}
                    </button>
                    <button onClick={() => setActiveTab('settings')} className={`segment-chip${activeTab === 'settings' ? ' active' : ''}`}>
                        {isRTL ? '⚙️ الإعدادات' : '⚙️ Settings'}
                    </button>
                </div>
            </div>

            <div style={{ padding: 16 }}>
                {activeTab === 'followed' && (
                    <div className="animate-fade-in">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {followedMerchantsList.length > 0 ? followedMerchantsList.map(m => (
                                <div
                                    key={m.id}
                                    role="button"
                                    tabIndex={0}
                                    aria-label={m.name}
                                    onClick={() => history.push(`/store/${m.id}`)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); history.push(`/store/${m.id}`); } }}
                                    style={{ background: 'var(--card-bg)', padding: '14px 16px', borderRadius: 16, border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', boxShadow: 'var(--shadow-sm)', WebkitTapHighlightColor: 'transparent' }}
                                >
                                    <div style={{ width: 50, height: 50, borderRadius: 14, background: m.avatar ? 'transparent' : 'var(--primary-light)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', overflow: 'hidden' }}>
                                        {m.avatar ? <img src={m.avatar} alt="Store" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🏪'}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <span>{m.name}</span>
                                            <span style={{ fontSize: '0.8rem', color: '#f59e0b', fontWeight: 900 }}>
                                                ★ {m.rating || (isRTL ? 'جديد' : 'New')}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--gray-400)', fontWeight: 700 }}>{isRTL ? 'عرض صفحة المتجر' : 'View Store Profile'}</div>
                                    </div>
                                    <div style={{ color: 'var(--primary)', fontSize: '1.2rem' }}>{isRTL ? '←' : '→'}</div>
                                </div>
                            )) : (
                                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--gray-400)' }}>
                                    <div style={{ fontSize: '3rem', marginBottom: 15 }}>🏪</div>
                                    <div style={{ fontWeight: 800 }}>{isRTL ? 'لم تتبع أي متاجر بعد' : 'Not following any stores yet'}</div>
                                    <button onClick={() => history.push('/')} style={{ marginTop: 20, padding: '10px 24px', borderRadius: 12, background: 'var(--accent)', color: 'white', border: 'none', fontWeight: 800 }}>
                                        {isRTL ? 'تصفح العروض' : 'Browse Deals'}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'notifications' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {/* Smart Alerts builder — comes FIRST so the user sees the
                            engine that drives the inbox entries, not after them. */}
                        <SmartAlertsCard
                            isRTL={isRTL}
                            smartAlerts={smartAlerts}
                            addSmartAlert={addSmartAlert}
                            removeSmartAlert={removeSmartAlert}
                            customAlert={customAlert}
                            filterRegion={filterRegion} setFilterRegion={setFilterRegion}
                            filterCity={filterCity} setFilterCity={setFilterCity}
                            filterMall={filterMall} setFilterMall={setFilterMall}
                            filterCategories={filterCategories} setFilterCategories={setFilterCategories}
                            filterKm={filterKm} setFilterKm={setFilterKm}
                            preciseCoords={preciseCoords} setPreciseCoords={setPreciseCoords}
                            gettingLocation={gettingLocation} setGettingLocation={setGettingLocation}
                            newKeyword={newKeyword} setNewKeyword={setNewKeyword}
                        />

                    </div>
                )}

                {activeTab === 'settings' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {/* v11.19 — self-service account management. Lets the
                            user change their display name, phone, email and
                            password from one card. Email + password go
                            through Supabase auth (email-confirmation hop for
                            new email; in-session reset for password). */}
                        <AccountSettingsCard />

                        {displayUserType === 'seller' && (
                        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', padding: 20, borderRadius: 20 }}>
                                <h3 style={{ fontSize: '1rem', fontWeight: 900, marginBottom: 15 }}>{isRTL ? 'معلومات التواصل للمتجر 🏪' : 'Store Contact Info 🏪'}</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    <label style={{ fontSize: '0.8rem', fontWeight: 700, opacity: 0.7 }}>{isRTL ? 'رقم التواصل العام (يظهر للزبائن)' : 'Public Contact Phone (Shown to customers)'}</label>
                                    <input type="tel" value={contactPhone} onChange={e => setContactPhone(normalizeArabicNumerals(e.target.value).replace(/\D/g, ''))} placeholder="05xxxxxxxx" style={{ width: '100%', padding: '14px', borderRadius: 12, border: '1.5px solid var(--gray-200)', fontSize: '0.9rem', outline: 'none', background: 'var(--body-bg)', color: 'var(--text-primary)', fontWeight: 600 }} />
                                    
                                    <label style={{ fontSize: '0.8rem', fontWeight: 700, opacity: 0.7, marginTop: 10 }}>{isRTL ? 'البريد للإشعارات' : 'Email for Notifications'}</label>
                                    <input value={contactEmail} type="email" disabled style={{ width: '100%', padding: '14px', borderRadius: 12, border: '1.5px solid var(--gray-200)', fontSize: '0.9rem', outline: 'none', background: 'var(--gray-100)', color: 'var(--text-secondary)', fontWeight: 600, cursor: 'not-allowed' }} />
                                    
                                    <button 
                                        onClick={async () => {
                                            await updateProfile({ contactPhone });
                                            await customAlert(isRTL ? 'تم حفظ رقم التواصل بنجاح ✅' : 'Contact phone saved successfully ✅');
                                        }} 
                                        style={{ width: '100%', padding: '16px', borderRadius: 14, background: 'var(--primary)', color: 'white', fontWeight: 900, border: 'none', marginTop: 12, fontSize: '1.1rem', boxShadow: '0 4px 15px rgba(16, 185, 129, 0.2)' }}>
                                        {isRTL ? 'حفظ التعديلات' : 'Save Changes'}
                                    </button>
                                </div>
                            </div>
                        )}
                        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', padding: 20, borderRadius: 20 }}>
                            <h3 style={{ fontSize: '1rem', fontWeight: 900, marginBottom: 15 }}>{isRTL ? 'اللغة والتفضيلات' : 'Language & Prefs'}</h3>
                            <button onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
                                style={{ width: '100%', padding: '16px', borderRadius: 15, border: '1.5px solid var(--border-color)', background: 'var(--card-bg)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{isRTL ? 'لغة التطبيق' : 'App Language'}</span>
                                <span style={{ fontWeight: 900, color: 'var(--primary)' }}>{language === 'ar' ? 'العربية' : 'English'}</span>
                            </button>
                        </div>

                        {/* Help & legal box — lives between "language" and
                            "account management" on the Profile/Settings tab.
                            Originally these links lived in the hamburger
                            drawer; v11.6 moves them here so signed-in users
                            find them where they expect (in the same place as
                            language + logout). */}
                        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', padding: 20, borderRadius: 20 }}>
                            <h3 style={{ fontSize: '1rem', fontWeight: 900, marginBottom: 15 }}>{isRTL ? 'المساعدة والصفحات القانونية' : 'Help & Legal'}</h3>
                            {[
                                { icon: '❓', ar: 'الأسئلة الشائعة', en: 'FAQ', path: '/faq' },
                                { icon: 'ℹ️', ar: 'من نحن', en: 'About', path: '/about' },
                                { icon: '📄', ar: 'شروط الاستخدام', en: 'Terms of Service', path: '/terms' },
                                { icon: '🔒', ar: 'سياسة الخصوصية', en: 'Privacy Policy', path: '/privacy' },
                                { icon: '💳', ar: 'سياسة الاسترداد', en: 'Refund Policy', path: '/refund' },
                                { icon: '✉️', ar: 'اتصل بنا', en: 'Contact us', path: '/contact' },
                            ].map((item, idx, arr) => (
                                <button
                                    key={item.path}
                                    onClick={() => history.push(item.path)}
                                    style={{
                                        width: '100%',
                                        padding: '14px 14px',
                                        borderRadius: 12,
                                        border: '1.5px solid var(--border-color)',
                                        background: 'var(--card-bg)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 12,
                                        cursor: 'pointer',
                                        textAlign: isRTL ? 'right' : 'left',
                                        color: 'var(--text-primary)',
                                        fontWeight: 800,
                                        fontSize: '0.92rem',
                                        marginBottom: idx === arr.length - 1 ? 0 : 8,
                                        transition: 'background 0.15s ease, border-color 0.15s ease',
                                    }}
                                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--gray-50, #f8fafc)'; }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--card-bg)'; }}
                                >
                                    <span style={{ fontSize: '1.1rem', width: 26, textAlign: 'center' }} aria-hidden>{item.icon}</span>
                                    <span style={{ flex: 1 }}>{isRTL ? item.ar : item.en}</span>
                                    <span aria-hidden style={{ color: 'var(--gray-400)', fontWeight: 900, fontSize: '1rem' }}>{isRTL ? '‹' : '›'}</span>
                                </button>
                            ))}
                        </div>

                        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', padding: 20, borderRadius: 20 }}>
                            <h3 style={{ fontSize: '1rem', fontWeight: 900, marginBottom: 15 }}>{isRTL ? 'إدارة الحساب' : 'Account Management'}</h3>
                            <button onClick={() => { logout(); history.push('/register'); }} style={{ width: '100%', padding: '16px', borderRadius: 15, background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)', fontWeight: 800, border: 'none', marginBottom: 10 }}>
                                {isRTL ? 'تسجيل الخروج' : 'Logout'}
                            </button>
                            <button onClick={async () => {
                                const confirmMsg = isRTL
                                    ? 'سيتم تعطيل حسابك مؤقتاً. لديك ٣٠ يوماً لاسترجاعه بإعادة تسجيل الدخول، وبعدها سيُحذف نهائياً مع جميع بياناتك. هل تريد المتابعة؟'
                                    : 'Your account will be deactivated. You have 30 days to restore it by logging in again — after that, it and all data will be permanently deleted. Continue?';
                                if (await customConfirm(confirmMsg)) {
                                    await deleteAccount();
                                    history.push('/register');
                                }
                            }}
                                style={{ width: '100%', background: 'none', border: 'none', color: 'var(--gray-400)', fontSize: '0.8rem', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}>
                                {isRTL ? 'حذف الحساب' : 'Delete Account'}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <BottomNav />
        </div>
    );
};

/**
 * Smart-alerts builder. The user composes a rule out of any subset of:
 * regions / cities / malls / categories (multi-select chips) / keywords /
 * radius around a captured location. The rule is matched conjunctively
 * by `tr_deal_smart_notifications` (migration v8.13) — a deal must
 * satisfy every set criterion in a rule to fire one notification.
 *
 * Multiple rules per user are OR'd, and a deal that triggers more
 * than one rule (or also matches a followed merchant) collapses
 * server-side into ONE combined notification listing every reason.
 */
const SmartAlertsCard: React.FC<{
    isRTL: boolean;
    smartAlerts: SmartAlertRule[];
    addSmartAlert: (rule: SmartAlertRule) => Promise<boolean>;
    removeSmartAlert: (idx: number) => Promise<boolean>;
    customAlert: (msg: string) => Promise<void>;
    filterRegion: string; setFilterRegion: (s: string) => void;
    filterCity: string; setFilterCity: (s: string) => void;
    filterMall: string; setFilterMall: (s: string) => void;
    filterCategories: string[]; setFilterCategories: (a: string[]) => void;
    filterKm: string; setFilterKm: (s: string) => void;
    preciseCoords: { lat: number; lng: number } | null;
    setPreciseCoords: (c: { lat: number; lng: number } | null) => void;
    gettingLocation: boolean; setGettingLocation: (b: boolean) => void;
    newKeyword: string; setNewKeyword: (s: string) => void;
}> = ({
    isRTL, smartAlerts, addSmartAlert, removeSmartAlert, customAlert,
    filterRegion, setFilterRegion, filterCity, setFilterCity,
    filterMall, setFilterMall, filterCategories, setFilterCategories,
    filterKm, setFilterKm, preciseCoords, setPreciseCoords,
    gettingLocation, setGettingLocation, newKeyword, setNewKeyword,
}) => {
    const toggleCategory = (id: string) => {
        if (filterCategories.includes(id)) {
            setFilterCategories(filterCategories.filter(c => c !== id));
        } else {
            setFilterCategories([...filterCategories, id]);
        }
    };

    const ruleCount =
        (filterRegion ? 1 : 0) + (filterCity ? 1 : 0) + (filterMall ? 1 : 0) +
        (filterCategories.length > 0 ? 1 : 0) + (newKeyword.trim() ? 1 : 0) +
        (filterKm && preciseCoords ? 1 : 0);

    // v11.41 — cross-browser geolocation that never hangs on Safari; the
    // loading flag always resets in `finally`.
    const handleCaptureLocation = async () => {
        if (gettingLocation) return;
        setGettingLocation(true);
        try {
            const { lat, lng } = await getCurrentPositionSafe();
            setPreciseCoords({ lat, lng });
            customAlert(isRTL ? '📍 تم تحديد موقعك بدقة' : '📍 Location captured');
        } catch (e) {
            customAlert(geoErrorMessage(e, isRTL));
        } finally {
            setGettingLocation(false);
        }
    };

    const [adding, setAdding] = React.useState(false);
    const handleAdd = async () => {
        if (adding) return;
        if (ruleCount === 0) {
            customAlert(isRTL
                ? 'أضف معياراً واحداً على الأقل (منطقة، مدينة، تصنيف، كلمة، أو موقع).'
                : 'Add at least one criterion (region, city, category, keyword, or location).');
            return;
        }
        if (filterKm && !preciseCoords) {
            customAlert(isRTL
                ? 'اضغط "تحديد موقعي" لتفعيل فلتر المسافة، أو احذف الكيلومترات.'
                : 'Press "Capture Location" to use the distance filter, or clear KM.');
            return;
        }

        const rule: SmartAlertRule = {};
        if (filterRegion) rule.regions = [filterRegion];
        if (filterCity) rule.cities = [filterCity];
        if (filterMall) rule.malls = [filterMall];
        if (filterCategories.length > 0) rule.categories = [...filterCategories];
        if (newKeyword.trim()) rule.keywords = [newKeyword.trim()];
        if (filterKm && preciseCoords) {
            rule.coords = preciseCoords;
            rule.radiusKm = Number(filterKm);
        }

        setAdding(true);
        const ok = await addSmartAlert(rule);
        setAdding(false);
        if (!ok) {
            customAlert(isRTL
                ? '❌ تعذّر حفظ التنبيه. تحقق من اتصال الإنترنت وحاول مجدداً.'
                : '❌ Could not save the alert. Check your connection and try again.');
            return;
        }
        // Reset
        setFilterRegion(''); setFilterCity(''); setFilterMall('');
        setFilterCategories([]); setFilterKm(''); setNewKeyword('');
        setPreciseCoords(null);
        customAlert(isRTL
            ? '✅ تم حفظ التنبيه. سيصلك إشعار فور نزول عرض مطابق (أو أي عرض نشط من آخر ٧ أيام).'
            : '✅ Alert saved. You will get a notification the moment a deal matches (or any active deal from the last 7 days).');
    };

    const handleRemove = async (idx: number) => {
        const ok = await removeSmartAlert(idx);
        if (!ok) {
            customAlert(isRTL
                ? '❌ تعذّر الحذف. تحقق من الاتصال وحاول مجدداً.'
                : '❌ Could not remove. Check your connection and try again.');
        }
    };

    const ruleLabel = (r: SmartAlertRule) => {
        const out: string[] = [];
        if (r.regions?.length) out.push((isRTL ? '🗺️ ' : '🗺️ ') + r.regions.map(id => REGIONS.find(x => x.id === id)?.name || id).join('، '));
        if (r.cities?.length) out.push((isRTL ? '🏙️ ' : '🏙️ ') + r.cities.map(id => CITIES.find(x => x.id === id)?.name || id).join('، '));
        if (r.malls?.length) out.push((isRTL ? '🛍️ ' : '🛍️ ') + r.malls.map(id => LOCATIONS.find(x => x.id === id)?.name || id).join('، '));
        if (r.categories?.length) out.push((isRTL ? '🏷️ ' : '🏷️ ') + r.categories.map(id => {
            const c = CATEGORIES.find(x => x.id === id);
            return c ? `${c.emoji} ${isRTL ? c.ar : c.en}` : id;
        }).join('، '));
        if (r.keywords?.length) out.push('🔍 ' + r.keywords.join('، '));
        if (r.radiusKm && r.coords) out.push(`📍 ${r.radiusKm} ${isRTL ? 'كم' : 'km'}`);
        return out.length > 0 ? out.join('  •  ') : (isRTL ? 'تنبيه فارغ' : 'empty rule');
    };

    return (
        <div style={{ background: 'var(--card-bg)', border: '2px solid var(--primary)', borderRadius: 22, padding: 20, boxShadow: '0 10px 30px var(--primary-glow)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: '1.5rem' }}>🧠</span>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 900, margin: 0 }}>{isRTL ? 'تنبيهات ذكية فورية' : 'Smart Alerts'}</h3>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 18, fontWeight: 600, lineHeight: 1.6 }}>
                {isRTL
                    ? 'حدد ما تهتم به وسيصلك إشعار فوري عند نزول عرض مطابق — يمكنك اختيار معيار واحد أو دمج عدة معايير في قاعدة واحدة.'
                    : 'Pick what matters; we ping you the instant a deal matches. Combine criteria in a single rule, or use just one.'}
            </p>

            {/* Region & City */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <select value={filterRegion}
                    onChange={e => { setFilterRegion(e.target.value); setFilterCity(''); setFilterMall(''); }}
                    style={{ flex: 1, minWidth: 130, padding: '12px', borderRadius: 12, border: '1.5px solid var(--border-color)', background: 'var(--card-bg)', fontWeight: 700, fontSize: '0.85rem' }}>
                    <option value="">{isRTL ? 'المنطقة (اختياري)' : 'Region (Opt)'}</option>
                    {REGIONS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <select value={filterCity}
                    onChange={e => { setFilterCity(e.target.value); setFilterMall(''); }}
                    style={{ flex: 1, minWidth: 130, padding: '12px', borderRadius: 12, border: '1.5px solid var(--border-color)', background: 'var(--card-bg)', fontWeight: 700, fontSize: '0.85rem' }}>
                    <option value="">{isRTL ? 'المدينة (اختياري)' : 'City (Opt)'}</option>
                    {CITIES.filter(c => !filterRegion || c.regionId === filterRegion).map(c =>
                        <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
            </div>

            {/* Mall (only if a city is set) */}
            {filterCity && (
                <select value={filterMall} onChange={e => setFilterMall(e.target.value)}
                    style={{ width: '100%', padding: '12px', borderRadius: 12, border: '1.5px solid var(--border-color)', background: 'var(--card-bg)', fontWeight: 700, fontSize: '0.85rem', marginBottom: 10 }}>
                    <option value="">{isRTL ? 'مول/سوق محدد (اختياري)' : 'Specific mall/market (Opt)'}</option>
                    {LOCATIONS.filter(l => l.cityId === filterCity).map(l =>
                        <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
            )}

            {/* Categories — multi-select chips */}
            <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 8 }}>
                    {isRTL ? 'تصنيفات (اختر واحد أو أكثر):' : 'Categories (pick one or more):'}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '4px 2px' }}>
                    {CATEGORIES.filter(c => c.id !== 'all').map(c => {
                        const active = filterCategories.includes(c.id as string);
                        return (
                            <button key={c.id} onClick={() => toggleCategory(c.id as string)}
                                style={{
                                    padding: '7px 13px',
                                    borderRadius: 999,
                                    border: active ? '2px solid var(--primary)' : '1.5px solid var(--border-color)',
                                    background: active ? 'var(--primary)' : 'var(--card-bg)',
                                    color: active ? 'white' : 'var(--text-primary)',
                                    fontWeight: 800, fontSize: '0.78rem',
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap',
                                    minHeight: 36
                                }}>
                                {c.emoji} {isRTL ? c.ar : c.en}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Keyword + KM + capture button */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                <input value={newKeyword} onChange={e => setNewKeyword(e.target.value)}
                    placeholder={isRTL ? 'كلمة مفتاحية (اختياري)' : 'Keyword (Opt)'}
                    style={{ flex: '2 1 160px', minWidth: 0, padding: '12px', borderRadius: 12, border: '1.5px solid var(--border-color)', background: 'var(--card-bg)', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', alignItems: 'center', flex: '1 1 110px', minWidth: 0, background: 'var(--card-bg)', borderRadius: 12, border: '1.5px solid var(--border-color)', padding: '0 10px', boxSizing: 'border-box', overflow: 'hidden' }}>
                    <input type="tel" value={filterKm}
                        onChange={e => setFilterKm(normalizeArabicNumerals(e.target.value).replace(/\D/g, ''))}
                        placeholder={isRTL ? 'مثال: 5' : 'e.g. 5'}
                        style={{ flex: 1, minWidth: 0, width: '100%', padding: '12px 0', border: 'none', background: 'transparent', fontSize: '0.9rem', outline: 'none', textAlign: isRTL ? 'right' : 'left' }} />
                    <span style={{ fontWeight: 900, color: 'var(--text-primary)', fontSize: '0.8rem', marginInlineStart: 6, flexShrink: 0 }}>{isRTL ? 'كم' : 'KM'}</span>
                </div>
                {filterKm && (
                    <button onClick={handleCaptureLocation} disabled={gettingLocation}
                        style={{
                            padding: '0 14px', borderRadius: 12,
                            border: preciseCoords ? '2px solid var(--primary)' : '1.5px solid var(--border-color)',
                            background: preciseCoords ? 'var(--primary)' : 'var(--card-bg)',
                            color: preciseCoords ? 'white' : 'var(--text-primary)', fontWeight: 800, fontSize: '0.78rem',
                            whiteSpace: 'nowrap', cursor: 'pointer', minHeight: 44, flexShrink: 0
                        }}>
                        {gettingLocation ? '⌛' : preciseCoords ? '✅' : (isRTL ? '📍 موقعي' : '📍 Capture')}
                    </button>
                )}
            </div>

            {/* Add button */}
            <button onClick={handleAdd}
                disabled={adding}
                style={{
                    width: '100%', padding: '14px', borderRadius: 14,
                    background: ruleCount > 0 ? 'var(--primary)' : 'var(--card-bg)',
                    color: ruleCount > 0 ? '#ffffff' : 'var(--text-primary)',
                    border: ruleCount > 0 ? 'none' : '1.5px solid var(--border-color)',
                    fontWeight: 900, fontSize: '0.95rem',
                    cursor: adding ? 'default' : 'pointer',
                    transition: 'all .2s ease',
                    opacity: adding ? 0.6 : (ruleCount > 0 ? 1 : 0.7)
                }}>
                {adding
                    ? (isRTL ? '⏳ جاري الحفظ...' : '⏳ Saving...')
                    : (isRTL
                        ? `➕ إضافة قاعدة تنبيه${ruleCount > 1 ? ' (' + ruleCount + ' معايير)' : ''}`
                        : `➕ Add Alert Rule${ruleCount > 1 ? ' (' + ruleCount + ' criteria)' : ''}`)}
            </button>

            {/* Active rules */}
            <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {smartAlerts.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem', padding: '6px 0' }}>
                        {isRTL ? 'لم تُنشئ أي تنبيهات بعد.' : 'No alerts yet.'}
                    </div>
                ) : smartAlerts.map((rule, i) => (
                    <div key={i} style={{ background: 'var(--card-bg)', border: '1.5px solid var(--border-color)', padding: '12px 14px', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ flex: 1, fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>{ruleLabel(rule)}</span>
                        <button onClick={() => handleRemove(i)}
                            style={{ background: 'rgba(239, 68, 68, 0.15)', border: 'none', color: 'var(--danger)', borderRadius: 8, padding: '6px 10px', fontSize: '0.85rem', fontWeight: 900, cursor: 'pointer' }}>
                            ✕
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default Profile;
