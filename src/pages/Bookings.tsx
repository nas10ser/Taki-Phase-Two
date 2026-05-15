import React, { useState, useEffect, useMemo } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import BottomNav from '../components/BottomNav';
import Sidebar from '../components/Sidebar';
import { Booking } from '../repositories/bookingRepository';
import BookingThread from '../components/BookingThread';
import PullToRefresh from '../components/PullToRefresh';

const BookingTimer: React.FC<{ expiry: number, onExpire: () => void }> = ({ expiry, onExpire }) => {
    const [timeLeft, setTimeLeft] = useState(Math.max(0, expiry - Date.now()));

    useEffect(() => {
        const timer = setInterval(() => {
            const newTime = Math.max(0, expiry - Date.now());
            setTimeLeft(newTime);
            if (newTime === 0) {
                onExpire();
                clearInterval(timer);
            }
        }, 1000);
        return () => clearInterval(timer);
    }, [expiry, onExpire]);

    const h = Math.floor(timeLeft / 3600000);
    const m = Math.floor((timeLeft % 3600000) / 60000);
    const s = Math.floor((timeLeft % 60000) / 1000);

    return (
        <span>{String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}</span>
    );
};

const Bookings: React.FC = () => {
    const { bookings, language, cancelBooking, user, customAlert, customConfirm, refreshBookings } = useApp();
    const history = useHistory();
    const location = useLocation();
    const isRTL = language === 'ar';
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [highlightedBarcode, setHighlightedBarcode] = useState<string | null>(null);
    // Default to newest-first so the most recently booked order is visible
    // without scrolling — matches what users expect from inbox-style screens.
    const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

    // Safety net — refetch on mount in case a realtime packet was dropped
    // between the booking commit and this page rendering. The optimistic
    // local insert in `bookDeal` already populates state, but a cold
    // navigation (e.g. user opens /bookings from a notification on a
    // different device) needs this to hydrate.
    useEffect(() => {
        refreshBookings();
    }, [refreshBookings, user?.id]);

    // Guard against bookings whose `deal` payload didn't come back from the
    // server (e.g. the deal was deleted but the booking row remains). Without
    // this, `b.deal.itemName` throws and blanks the whole page on refresh.
    const matchesSearch = (b: any) => {
        const name = b?.deal?.itemName?.toLowerCase?.() ?? '';
        return name.includes(searchTerm.toLowerCase());
    };

    const sortBookings = (list: any[]) => {
        const sign = sortOrder === 'newest' ? -1 : 1;
        return [...list].sort((a, b) => sign * ((a.bookedAt || 0) - (b.bookedAt || 0)));
    };

    const filteredActive = useMemo(() =>
        sortBookings(
            bookings.filter(b => b.userId === user?.id && b.status !== 'completed' && b.status !== 'cancelled')
                    .filter(matchesSearch)
        ),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [bookings, user?.id, searchTerm, sortOrder]
    );

    const filteredPast = useMemo(() =>
        sortBookings(
            bookings.filter(b => b.userId === user?.id && (b.status === 'completed' || b.status === 'cancelled'))
                    .filter(matchesSearch)
        ),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [bookings, user?.id, searchTerm, sortOrder]
    );

    // Auto-expand if only one active booking
    useEffect(() => {
        if (filteredActive.length === 1 && !expandedId) {
            setExpandedId(filteredActive[0].barcode);
        }
    }, [filteredActive, expandedId]);

    // When the user lands here from a booking notification (e.g. "✅ تم الحجز بنجاح"
    // or "💬 رسالة جديدة"), the URL carries ?barcode=XXX. Auto-expand that
    // booking, scroll it into view, and pulse a highlight so the chat thread
    // is immediately visible — no manual searching through the list.
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const target = params.get('barcode');
        if (!target) return;
        if (!bookings.some(b => b.barcode === target && b.userId === user?.id)) return;
        setExpandedId(target);
        setHighlightedBarcode(target);
        requestAnimationFrame(() => {
            const el = document.getElementById(`booking-${target}`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        const t = setTimeout(() => setHighlightedBarcode(null), 3500);
        return () => clearTimeout(t);
    }, [location.search, bookings, user?.id]);

    const copyCode = (code: string) => {
        navigator.clipboard.writeText(code);
        customAlert(isRTL ? '✅ تم نسخ الرمز!' : '✅ Code copied!');
    };

    return (
        <>
        <PullToRefresh isRTL={isRTL} onRefresh={() => {
            // Only the bookings table — the rest of the data on this page
            // (notifications, deals) doesn't need to round-trip on a swipe.
            refreshBookings();
            return Promise.resolve();
        }}>
        <div style={{ minHeight: '100vh', background: 'var(--bg-color)', direction: isRTL ? 'rtl' : 'ltr' }}>
            {/* Header */}
            <div style={{
                background: 'linear-gradient(135deg, var(--primary), var(--primary-dark))',
                // Use the safe-area inset so the header sits BELOW the notch /
                // status bar instead of riding up under it. Previously the
                // inline padding was 24px top, which on iPhone with notch
                // landed the menu icon right next to the camera cutout.
                padding: 'calc(env(safe-area-inset-top, 12px) + 14px) 20px 24px',
                borderBottomLeftRadius: 24,
                borderBottomRightRadius: 24,
                position: 'sticky',
                top: 0,
                zIndex: 100,
                boxShadow: '0 4px 20px rgba(var(--primary-rgb), 0.2)'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <button onClick={() => setSidebarOpen(true)} style={{ background: 'rgba(80, 80, 95, 0.2)', border: 'none', color: 'white', fontSize: '1.4rem', padding: 8, borderRadius: 12, cursor: 'pointer' }}>☰</button>
                    <h1 style={{ color: 'white', fontSize: '1.25rem', fontWeight: 900, margin: 0 }}>{isRTL ? 'حجوزاتي 🎟️' : 'My Bookings 🎟️'}</h1>
                    <div style={{ width: 40 }} />
                </div>
                <div style={{ 
                    background: 'rgba(100, 100, 100, 0.15)', 
                    backdropFilter: 'blur(10px)',
                    borderRadius: 16, 
                    display: 'flex', 
                    alignItems: 'center', 
                    border: '1px solid rgba(80, 80, 95, 0.2)'
                }}>
                    <input 
                        placeholder={isRTL ? 'ابحث في حجوزاتك...' : 'Search your bookings...'}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        style={{ 
                            direction: isRTL ? 'rtl' : 'ltr', 
                            color: 'white', 
                            flex: 1, 
                            fontWeight: 600, 
                            border: 'none', 
                            background: 'transparent', 
                            padding: '12px 16px',
                            outline: 'none',
                            fontSize: '0.9rem'
                        }}
                    />
                    <div style={{ padding: '0 12px', color: 'white', opacity: 0.8 }}>🔍</div>
                </div>
            </div>

            <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

            <div style={{ padding: '24px 16px 120px' }}>
                {/* Sort toggle — applies to both Active and Past sections.
                    Default is newest-first because a buyer's latest order is
                    almost always what they came to check. */}
                {(filteredActive.length > 0 || filteredPast.length > 0) && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 18,
                        background: 'var(--card-bg)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 14,
                        padding: '8px 12px',
                        boxShadow: 'var(--shadow-sm)',
                    }}>
                        <span style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-secondary, var(--gray-400))' }}>
                            {isRTL ? 'الترتيب:' : 'Sort:'}
                        </span>
                        <div style={{
                            display: 'flex',
                            gap: 4,
                            background: 'var(--body-bg)',
                            borderRadius: 999,
                            padding: 3,
                            flex: 1,
                        }}>
                            <button
                                onClick={() => setSortOrder('newest')}
                                aria-pressed={sortOrder === 'newest'}
                                style={{
                                    flex: 1,
                                    padding: '7px 10px',
                                    borderRadius: 999,
                                    border: 'none',
                                    background: sortOrder === 'newest' ? 'var(--primary)' : 'transparent',
                                    color: sortOrder === 'newest' ? '#ffffff' : 'var(--text-primary)',
                                    fontSize: '0.75rem',
                                    fontWeight: 900,
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap',
                                    minHeight: 36,
                                    transition: 'background 0.18s ease',
                                }}
                            >
                                ⬇️ {isRTL ? 'الأحدث أولاً' : 'Newest first'}
                            </button>
                            <button
                                onClick={() => setSortOrder('oldest')}
                                aria-pressed={sortOrder === 'oldest'}
                                style={{
                                    flex: 1,
                                    padding: '7px 10px',
                                    borderRadius: 999,
                                    border: 'none',
                                    background: sortOrder === 'oldest' ? 'var(--primary)' : 'transparent',
                                    color: sortOrder === 'oldest' ? '#ffffff' : 'var(--text-primary)',
                                    fontSize: '0.75rem',
                                    fontWeight: 900,
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap',
                                    minHeight: 36,
                                    transition: 'background 0.18s ease',
                                }}
                            >
                                ⬆️ {isRTL ? 'الأقدم أولاً' : 'Oldest first'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Active Bookings Section */}
                {filteredActive.length > 0 && (
                    <div style={{ marginBottom: 40 }}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 900, color: 'var(--primary)', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
                            🚀 {isRTL ? 'حجوزات نشطة' : 'Active Bookings'}
                            <div style={{ height: 1, flex: 1, background: 'var(--primary)', opacity: 0.1 }} />
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                            {filteredActive.map((booking: any) => {
                                const isExpanded = expandedId === booking.barcode;
                                const isHighlighted = highlightedBarcode === booking.barcode;
                                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${booking.barcode}`;

                                return (
                                    <div key={booking.barcode}
                                        id={`booking-${booking.barcode}`}
                                        onClick={() => setExpandedId(isExpanded ? null : booking.barcode)}
                                        style={{
                                            background: 'var(--card-bg)',
                                            borderRadius: 24,
                                            padding: 20,
                                            border: isHighlighted ? '2px solid var(--secondary)' : (isExpanded ? '2px solid var(--primary)' : '1px solid var(--border-color)'),
                                            boxShadow: isHighlighted ? '0 0 0 4px rgba(245,158,11,0.18), var(--shadow)' : (isExpanded ? '0 10px 40px rgba(0,0,0,0.1)' : 'var(--shadow-sm)'),
                                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                            cursor: 'pointer',
                                            position: 'relative',
                                            overflow: 'hidden'
                                        }}>
                                        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                                            <img 
                                                src={booking.deal?.images?.[0] || 'https://images.unsplash.com/photo-1543332164-6e82f355badc?w=400'}
                                                width={65} height={65} 
                                                alt={booking.deal?.itemName || ''}
                                                onClick={(e) => { e.stopPropagation(); if (booking.deal?.storeId) history.push(`/store/${booking.deal.storeId}`); }}
                                                style={{ width: 65, height: 65, borderRadius: 16, objectFit: 'cover', cursor: 'pointer', border: '1px solid var(--border-color)' }} 
                                            />
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontWeight: 900, fontSize: '1rem', color: 'var(--text-primary)', marginBottom: 4 }}>{booking.deal?.itemName}</div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                                                    <span>{isRTL ? 'التاجر:' : 'Seller:'} {booking.deal?.shopName}</span>
                                                    <span style={{ color: '#f59e0b' }}>★ {(booking.deal as any).rating || (isRTL ? 'جديد' : 'New')}</span>
                                                </div>
                                            </div>
                                            <div style={{ textAlign: 'end' }}>
                                                <div style={{ 
                                                    fontSize: '0.75rem', 
                                                    fontWeight: 900, 
                                                    padding: '6px 12px', 
                                                    borderRadius: 12,
                                                    background: '#e0f2fe',
                                                    color: '#0284c7',
                                                    marginBottom: 6
                                                }}>
                                                    {booking.status === 'acknowledged' ? (isRTL ? 'قيد التجهيز' : 'Preparing') : (isRTL ? 'مؤكد' : 'Confirmed')}
                                                </div>
                                                <div style={{ fontSize: '1rem', fontWeight: 900, color: 'var(--primary)' }}>{booking.deal?.discountedPrice} ر.س</div>
                                            </div>
                                        </div>

                                        {isExpanded && (
                                            <div className="animate-fade-in" style={{ marginTop: 24, paddingTop: 24, borderTop: '2px dashed var(--gray-100)' }} onClick={e => e.stopPropagation()}>
                                                {/* Timer */}
                                                {booking.expiryTime > Date.now() && (
                                                    <div style={{ background: 'var(--dark)', borderRadius: 16, padding: '12px 20px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 800 }}>
                                                            ⏰ {isRTL ? 'ينتهي خلال:' : 'Expires in:'}
                                                        </div>
                                                        <div style={{ color: 'white', fontFamily: 'monospace', fontSize: '1.2rem', fontWeight: 900 }}>
                                                            <BookingTimer expiry={booking.expiryTime} onExpire={() => {}} />
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Tracker */}
                                                <div style={{ background: 'var(--body-bg)', padding: 20, borderRadius: 20, marginBottom: 24, border: '1px solid var(--border-color)' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, minWidth: 60 }}>
                                                            <div style={{ width: 28, height: 28, borderRadius: 14, background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem' }}>✓</div>
                                                            <div style={{ fontSize: '0.65rem', fontWeight: 900, color: 'var(--text-primary)', textAlign: 'center' }}>{isRTL ? 'مؤكد' : 'Confirmed'}</div>
                                                        </div>
                                                        <div style={{ flex: 1, height: 3, background: (booking.status === 'acknowledged' || booking.status === 'completed') ? 'var(--primary)' : 'var(--gray-200)', borderRadius: 2 }} />
                                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, minWidth: 60 }}>
                                                            <div style={{ width: 28, height: 28, borderRadius: 14, background: (booking.status === 'acknowledged' || booking.status === 'completed') ? 'var(--primary)' : 'var(--gray-200)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem' }}>{(booking.status === 'acknowledged' || booking.status === 'completed') ? '✓' : ''}</div>
                                                            <div style={{ fontSize: '0.65rem', fontWeight: 900, color: 'var(--text-primary)', textAlign: 'center' }}>{isRTL ? 'استلمه التاجر' : 'S. Received'}</div>
                                                        </div>
                                                        <div style={{ flex: 1, height: 3, background: booking.status === 'completed' ? 'var(--primary)' : 'var(--gray-200)', borderRadius: 2 }} />
                                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, minWidth: 60 }}>
                                                            <div style={{ width: 28, height: 28, borderRadius: 14, background: booking.status === 'completed' ? 'var(--primary)' : 'var(--gray-200)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem' }}>{booking.status === 'completed' ? '✓' : ''}</div>
                                                            <div style={{ fontSize: '0.65rem', fontWeight: 900, color: 'var(--text-primary)', textAlign: 'center' }}>{isRTL ? 'تم الاستلام' : 'Received'}</div>
                                                        </div>
                                                    </div>
                                                    {/* Seller message — always present so the buyer never wonders
                                                        whether the seller saw the order. If the seller wrote a real
                                                        note we show it; otherwise we narrate the order status.
                                                        The italic + lower-opacity style cues "this is auto-generated". */}
                                                    {(() => {
                                                        const realNote = booking.merchantNote;
                                                        let fallback = '';
                                                        if (!realNote) {
                                                            if (booking.status === 'completed') {
                                                                fallback = isRTL ? '✅ تم تسليم طلبك — شكراً لاستخدامك تاكي 💚' : '✅ Order delivered — thanks for using TAKI 💚';
                                                            } else if (booking.status === 'acknowledged') {
                                                                fallback = isRTL ? '📦 التاجر استلم طلبك وهو قيد التجهيز الآن.' : '📦 The seller received your order and is preparing it now.';
                                                            } else {
                                                                fallback = isRTL ? '⏳ بانتظار التاجر يؤكد استلام طلبك…' : '⏳ Waiting for the seller to acknowledge your order…';
                                                            }
                                                        }
                                                        const noteText = realNote || fallback;
                                                        const isAuto = !realNote;
                                                        return (
                                                            <div style={{ marginTop: 16, padding: 12, background: 'rgba(245, 158, 11, 0.1)', borderRadius: 12, borderRight: isRTL ? '3px solid #f59e0b' : 'none', borderLeft: !isRTL ? '3px solid #f59e0b' : 'none' }}>
                                                                <div style={{ fontSize: '0.7rem', fontWeight: 800, color: '#b45309', marginBottom: 4 }}>
                                                                    💬 {isRTL ? 'رسالة التاجر:' : 'Seller Message:'}
                                                                </div>
                                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 600, fontStyle: isAuto ? 'italic' : 'normal', opacity: isAuto ? 0.85 : 1 }}>
                                                                    {noteText}
                                                                </div>
                                                            </div>
                                                        );
                                                    })()}
                                                    {booking.notes && (
                                                        <div style={{ marginTop: 8, padding: 12, background: 'rgba(59, 130, 246, 0.08)', borderRadius: 12, borderRight: isRTL ? '3px solid #3b82f6' : 'none', borderLeft: !isRTL ? '3px solid #3b82f6' : 'none' }}>
                                                            <div style={{ fontSize: '0.7rem', fontWeight: 800, color: '#1e40af', marginBottom: 4 }}>📝 {isRTL ? 'ملاحظتك:' : 'Your note:'}</div>
                                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 600 }}>{booking.notes}</div>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Buyer↔Seller chat thread (3+3 cap). Hidden once the
                                                    booking is closed-out so old completed orders don't
                                                    surface chat boxes. */}
                                                {booking.status !== 'cancelled' && (
                                                    <BookingThread barcode={booking.barcode} myRole="buyer" />
                                                )}

                                                {/* Code & QR */}
                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                        <div style={{ background: 'var(--body-bg)', padding: '10px 24px', borderRadius: 12, letterSpacing: 4, fontWeight: 900, fontSize: '1.2rem', fontFamily: 'monospace' }}>
                                                            {booking.barcode}
                                                        </div>
                                                        <button onClick={() => copyCode(booking.barcode)} style={{ background: 'var(--primary)', color: 'white', border: 'none', borderRadius: 12, padding: '10px', cursor: 'pointer' }}>📋</button>
                                                    </div>
                                                    <div style={{ padding: 12, background: 'var(--card-bg)', borderRadius: 16, border: '1px solid var(--border-color)' }}>
                                                        <img src={qrUrl} width={120} height={120} alt="QR" />
                                                    </div>
                                                    <div style={{ textAlign: 'center', marginTop: 8 }}>
                                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 800 }}>
                                                            {isRTL ? 'الرمز الاحتياطي:' : 'Backup Code:'} <span style={{ color: 'var(--text-primary)' }}>{booking.backupCode}</span>
                                                        </div>
                                                        <button onClick={async () => {
                                                            if (await customConfirm(isRTL ? 'إلغاء الحجز؟' : 'Cancel?')) cancelBooking(booking.barcode);
                                                        }} style={{ marginTop: 24, background: 'none', border: 'none', color: '#f43f5e', fontSize: '0.8rem', fontWeight: 800, cursor: 'pointer', textDecoration: 'underline' }}>
                                                            {isRTL ? 'إلغاء الحجز ❌' : 'Cancel Booking ❌'}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Past Bookings Section */}
                {filteredPast.length > 0 && (
                    <div>
                        <h3 style={{ fontSize: '1rem', fontWeight: 900, color: 'var(--text-secondary)', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
                            📜 {isRTL ? 'سجل الطلبات السابقة' : 'Past Orders History'}
                            <div style={{ height: 1, flex: 1, background: 'var(--gray-200)', opacity: 0.5 }} />
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                            {filteredPast.map((booking: any) => {
                                const isExpanded = expandedId === booking.barcode;
                                const isHighlighted = highlightedBarcode === booking.barcode;
                                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${booking.barcode}`;

                                return (
                                    <div key={booking.barcode}
                                        id={`booking-${booking.barcode}`}
                                        onClick={() => setExpandedId(isExpanded ? null : booking.barcode)}
                                        style={{
                                            background: 'var(--card-bg)',
                                            borderRadius: 24,
                                            padding: 20,
                                            border: isHighlighted ? '2px solid var(--secondary)' : (isExpanded ? '2px solid var(--primary)' : '1px solid var(--border-color)'),
                                            boxShadow: isHighlighted ? '0 0 0 4px rgba(245,158,11,0.18), var(--shadow)' : undefined,
                                            opacity: isExpanded || isHighlighted ? 1 : 0.75,
                                            transition: 'all 0.3s ease',
                                            cursor: 'pointer'
                                        }}>
                                        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                                            <img 
                                                src={booking.deal?.images?.[0] || 'https://images.unsplash.com/photo-1543332164-6e82f355badc?w=400'}
                                                width={60} height={60} 
                                                alt={booking.deal?.itemName || ''}
                                                onClick={(e) => { e.stopPropagation(); if (booking.deal?.storeId) history.push(`/store/${booking.deal.storeId}`); }}
                                                style={{ width: 60, height: 60, borderRadius: 16, objectFit: 'cover', cursor: 'pointer', border: '1px solid var(--border-color)' }} 
                                            />
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontSize: '1rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 2 }}>{booking.deal?.itemName}</div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                                                    <span>{new Date(booking.bookedAt).toLocaleDateString(isRTL ? 'ar-SA' : 'en-US')}</span>
                                                    <span style={{ color: '#f59e0b' }}>★ {(booking.deal as any).rating || (isRTL ? 'جديد' : 'New')}</span>
                                                </div>
                                            </div>
                                            <div style={{ 
                                                padding: '8px 16px', 
                                                borderRadius: 14, 
                                                fontSize: '0.8rem', 
                                                fontWeight: 900,
                                                background: booking.status === 'completed' ? 'var(--gray-50)' : '#fff1f2',
                                                color: booking.status === 'completed' ? 'var(--primary)' : '#f43f5e'
                                            }}>
                                                {booking.status === 'completed' ? (isRTL ? 'تم التسليم' : 'Delivered') : (isRTL ? 'ملغي' : 'Cancelled')}
                                            </div>
                                        </div>

                                        {isExpanded && (
                                            <div className="animate-fade-in" style={{ marginTop: 24, paddingTop: 24, borderTop: '2px dashed var(--gray-100)' }} onClick={e => e.stopPropagation()}>
                                                {/* Tracker Box */}
                                                <div style={{ background: booking.status === 'completed' ? 'var(--gray-100)' : 'var(--gray-50)', padding: 20, borderRadius: 20, marginBottom: 0, border: booking.status === 'completed' ? '1px solid var(--border-color)' : '1px solid var(--border-color)' }}>
                                                    <h4 style={{ fontSize: '0.85rem', fontWeight: 900, color: 'var(--primary)', marginBottom: 16, marginTop: 0, textAlign: isRTL ? 'right' : 'left' }}>
                                                        {booking.status === 'completed' ? (isRTL ? '🎊 تم الاستلام بنجاح!' : '🎊 Delivery Successful!') : (isRTL ? 'تفاصيل حالة الحجز:' : 'Booking Status Details:')}
                                                    </h4>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, minWidth: 60 }}>
                                                            <div style={{ width: 28, height: 28, borderRadius: 14, background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem' }}>✓</div>
                                                            <div style={{ fontSize: '0.7rem', fontWeight: 900, color: 'var(--text-primary)', textAlign: 'center' }}>{isRTL ? 'مؤكد' : 'Confirmed'}</div>
                                                        </div>
                                                        <div style={{ flex: 1, height: 3, background: 'var(--primary)', borderRadius: 2 }} />
                                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, minWidth: 60 }}>
                                                            <div style={{ width: 28, height: 28, borderRadius: 14, background: (booking.status === 'acknowledged' || booking.status === 'completed') ? 'var(--primary)' : 'var(--gray-200)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem' }}>{(booking.status === 'acknowledged' || booking.status === 'completed') ? '✓' : ''}</div>
                                                            <div style={{ fontSize: '0.7rem', fontWeight: 900, color: 'var(--text-primary)', textAlign: 'center' }}>{isRTL ? 'استلمه التاجر' : 'S. Received'}</div>
                                                        </div>
                                                        <div style={{ flex: 1, height: 3, background: booking.status === 'completed' ? 'var(--primary)' : 'var(--gray-200)', borderRadius: 2 }} />
                                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, minWidth: 60 }}>
                                                            <div style={{ width: 28, height: 28, borderRadius: 14, background: booking.status === 'completed' ? 'var(--primary)' : 'var(--gray-200)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem' }}>{booking.status === 'completed' ? '✓' : ''}</div>
                                                            <div style={{ fontSize: '0.7rem', fontWeight: 900, color: 'var(--text-primary)', textAlign: 'center' }}>{isRTL ? 'تم الاستلام' : 'Received'}</div>
                                                        </div>
                                                    </div>
                                                    {booking.status === 'completed' && (
                                                        <div style={{ marginTop: 16, textAlign: 'center', padding: '10px', background: 'var(--gray-100)', borderRadius: 12 }}>
                                                            <div style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--primary)' }}>
                                                                {isRTL ? 'تم تسليم طلبك بنجاح! شكراً لاستخدامك تاكي ✨' : 'Your order has been delivered! Thanks for using Taki ✨'}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {filteredActive.length === 0 && filteredPast.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '100px 20px' }}>
                        <div style={{ fontSize: '4rem', marginBottom: 20 }}>🎟️</div>
                        <div style={{ fontWeight: 800, color: 'var(--gray-400)', fontSize: '1.1rem' }}>{isRTL ? 'لا توجد حجوزات حالياً' : 'No bookings found'}</div>
                        <button onClick={() => history.push('/')} style={{ marginTop: 24, padding: '14px 36px', borderRadius: 16, background: 'var(--primary)', color: 'white', border: 'none', fontWeight: 900 }}>
                            {isRTL ? 'تصفح العروض' : 'Browse Deals'}
                        </button>
                    </div>
                )}
            </div>
        </div>
        </PullToRefresh>
        {/* Sibling, not child — PullToRefresh's translateY() would otherwise
            re-anchor `position: fixed` to the wrapper instead of the viewport. */}
        <BottomNav />
        </>
    );
};

export default Bookings;
