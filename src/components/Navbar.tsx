import React, { useState } from 'react';
import { goRegister } from '../utils/returnTo';
import SearchInput from './SearchInput';
import { useHistory, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import Sidebar from './Sidebar';

interface NavbarProps {
    searchQuery?: string;
    onSearchChange?: (q: string) => void;
}

const Navbar: React.FC<NavbarProps> = ({ searchQuery, onSearchChange }) => {
    const history = useHistory();
    const location = useLocation();
    const { language, user, topLocation } = useApp();
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const isRTL = language === 'ar';

    const showLocation = topLocation.city || topLocation.region;
    const locationLabel = topLocation.city
        ? (topLocation.mall || topLocation.city)
        : topLocation.region || (isRTL ? 'كل المناطق' : 'All Regions');

    return (
        <>
            <div className="premium-bar">
                {/* Top Row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                        <button aria-label={isRTL ? 'فتح القائمة' : 'Open menu'} onClick={() => setSidebarOpen(true)}
                            style={{ background: 'rgba(80, 80, 95, 0.2)', border: 'none', fontSize: '1.3rem', width: 44, height: 44, minWidth: 44, minHeight: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>☰</button>
                        {/* ── هُويّةُ تاكي: شارةٌ + اسم (v15.26) ────────────────────────
                            🔴 وأوّلُ صياغةٍ شحنتُها كانت **قصاصةً عائمة**: الرسمةُ وحدها
                               عند ٤٠ بكسل. والقياسُ بالنظر أدانها — نقوشُ السدو تصير
                               نقاطاً فلا يُعرف ما هي، وبلا إطارٍ تبدو مُلصقاً سقط على
                               الشريط. ورأيُ ناصر كان «غير احترافي أبداً»، وهو محقّ.
                            🪤 والعلاجُ هو نمطُ التطبيقات المعروف: **علامةٌ في شارة + اسم**.
                               الشارةُ تمنح الرسمةَ إطاراً فتُقرأ شكلاً ولوناً لا تفصيلاً،
                               والاسمُ يُعيد الهويّة — فترويسةٌ بلا اسمٍ زينةٌ لا علامة.
                            🪤 وألوانُ الشارة **أبيضُ شفّاف** لا لونٌ ثابت: شريطُ الترويسة
                               أخضرُ في الوضع الفاتح وأردوازيٌّ في الداكن وبنفسجيٌّ في
                               المواسم (`--header-gradient` بثلاث قيم)، ولونٌ ثابتٌ كان
                               سيُصادم أحدَها. */}
                        <div style={{
                            width: 46, height: 46, flex: 'none', borderRadius: 15,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: 'linear-gradient(160deg, rgba(255,255,255,.16), rgba(255,255,255,.04))',
                            border: '1px solid rgba(255,255,255,.18)',
                            boxShadow: '0 6px 16px rgba(0,0,0,.30), inset 0 1px 0 rgba(255,255,255,.20)',
                        }}>
                            <img src="/logo-mark.png" alt="TAKI" width={36} height={34}
                                style={{ width: 36, height: 34, objectFit: 'contain', display: 'block' }} />
                        </div>
                        <div>
                            <div className="navbar-logo" style={{
                                fontSize: '1.3rem', fontWeight: 900, letterSpacing: '2.5px', lineHeight: 1,
                                background: 'linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%)',
                                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                            }}>TAKI</div>
                            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.78)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                                📍 {locationLabel}
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        {!user ? (
                            <button onClick={() => goRegister(history)}
                                style={{ padding: '8px 18px', borderRadius: 12, background: 'var(--card-bg)', color: 'var(--primary)', fontWeight: 800, fontSize: '0.85rem', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                                {isRTL ? 'تسجيل' : 'Login'}
                            </button>
                        ) : (
                            <button aria-label={isRTL ? 'الملف الشخصي' : 'Profile'} onClick={() => history.push('/profile')}
                                style={{ width: 44, height: 44, minWidth: 44, minHeight: 44, borderRadius: 14, background: 'rgba(80, 80, 95, 0.2)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', border: '2px solid rgba(80, 80, 95, 0.3)' }}>
                                👤
                            </button>
                        )}
                    </div>
                </div>

                {/* Search */}
                {onSearchChange && (
                    <div className="search-box" style={{ background: 'rgba(80, 80, 90, 0.2)', backdropFilter: 'blur(12px)', border: '1px solid rgba(100, 100, 100, 0.15)', borderRadius: 16, display: 'flex', alignItems: 'center', height: 48 }}>
                        {/* v13.34 — حقل بحالة محلية: الحرف يظهر فوراً، والصفحة
                            تُبلَّغ بعد سكوت قصير — يُنهي «تعليق الكتابة» (بلاغ ناصر) */}
                        <SearchInput
                            className="search-input"
                            placeholder={isRTL ? 'ابحث عن منتج أو محل...' : 'Search for product or store...'}
                            value={searchQuery || ''}
                            onChange={onSearchChange}
                            style={{
                                direction: isRTL ? 'rtl' : 'ltr',
                                color: 'white',
                                flex: 1,
                                fontWeight: 600,
                                border: 'none',
                                background: 'transparent',
                                padding: '0 16px',
                                outline: 'none',
                                /* 16px+ stops iOS Safari from auto-zooming on focus. */
                                fontSize: '16px',
                                minWidth: 0
                            }}
                            inputMode="search"
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck={false}
                        />
                        <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: 10, 
                            padding: isRTL ? '0 12px 0 16px' : '0 16px 0 12px', 
                            borderLeft: isRTL ? 'none' : '1px solid rgba(80, 80, 90, 0.3)',
                            borderRight: isRTL ? '1px solid rgba(80, 80, 90, 0.3)' : 'none',
                            color: 'white',
                            fontWeight: 800,
                            whiteSpace: 'nowrap',
                            fontSize: '0.85rem'
                        }}>
                            <span>🔍</span>
                            <span>{isRTL ? 'بحث' : 'Search'}</span>
                        </div>
                    </div>
                )}
            </div>

            <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        </>
    );
};

export default React.memo(Navbar);
