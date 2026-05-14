import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useParams, useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useBooking } from '../hooks/useBooking';
import { dealService } from '../services/dealService';
import { getLocation, REGIONS, CITIES } from '../data/mock';
import { SellerTopBar } from '../components/SellerTopBar';
import BottomNav from '../components/BottomNav';
import BarcodeVisual from '../utils/BarcodeVisual';
import { normalizeArabicNumerals, openExternalUrl, resolveDealLocation } from '../utils/helpers';

const StatusTracker = ({ status, isRTL }: { status: string, isRTL: boolean }) => {
    const steps = [
        { key: 'pending', labelAr: 'مؤكد 🎟️', labelEn: 'Confirmed 🎟️' },
        { key: 'acknowledged', labelAr: 'استلمه التاجر 📦', labelEn: 'Seller Received 📦' },
        { key: 'completed', labelAr: 'تم الاستلام ✅', labelEn: 'Received ✅' }
    ];

    const getStatusIndex = (s: string) => {
        if (s === 'completed') return 2;
        if (s === 'acknowledged') return 1;
        return 0;
    };

    const currentIndex = getStatusIndex(status);

    return (
        <div style={{ padding: '24px 16px', background: 'var(--card-bg)', borderRadius: 24, border: '1px solid var(--border-color)', marginBottom: 20, boxShadow: 'var(--shadow-sm)', position: 'relative' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 900, color: 'var(--text-secondary)', marginBottom: 20 }}>
                {isRTL ? 'تتبع حالة الطلب:' : 'Track Order Status:'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', position: 'relative', padding: '0 10px' }}>
                <div style={{ position: 'absolute', top: 12, left: 30, right: 30, height: 4, background: 'var(--gray-100)', borderRadius: 2, zIndex: 0 }} />
                <div style={{
                    position: 'absolute', top: 12,
                    left: isRTL ? 'auto' : 30,
                    right: isRTL ? 30 : 'auto',
                    width: `${(currentIndex / (steps.length - 1)) * 100}%`,
                    height: 4,
                    background: 'var(--primary)',
                    borderRadius: 2, zIndex: 1,
                    transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
                    boxShadow: '0 0 10px var(--primary-glow)'
                }} />

                {steps.map((step, index) => {
                    const isActive = index <= currentIndex;
                    const isCurrent = index === currentIndex;

                    return (
                        <div key={step.key} style={{
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            zIndex: 2,
                            position: 'relative'
                        }}>
                            <div style={{
                                width: 28,
                                height: 28,
                                borderRadius: '50%',
                                background: isActive ? 'var(--primary)' : 'var(--card-bg)',
                                border: isActive ? 'none' : '4px solid var(--gray-100)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'white',
                                fontSize: '0.8rem',
                                transition: 'all 0.3s ease',
                                transform: isActive ? 'scale(1.1)' : 'scale(1)',
                                boxShadow: isCurrent ? '0 0 15px var(--primary-glow)' : 'none'
                            }}>
                                {isActive && '✓'}
                            </div>
                            <div style={{
                                marginTop: 12,
                                fontSize: '0.7rem',
                                fontWeight: 900,
                                color: isActive ? 'var(--text-primary)' : 'var(--gray-400)',
                                whiteSpace: 'nowrap',
                                transition: 'color 0.4s ease'
                            }}>
                                {isRTL ? step.labelAr : step.labelEn}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const ImageZoomViewer: React.FC<{
    images: string[];
    initialIndex: number;
    onClose: () => void;
    isRTL: boolean;
}> = ({ images, initialIndex, onClose, isRTL }) => {
    const [index, setIndex] = useState(initialIndex);
    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [imgError, setImgError] = useState(false);
    const lastTouchDist = React.useRef<number | null>(null);
    const lastTouchPos = React.useRef<{ x: number; y: number } | null>(null);
    // ===== Modern swipe-to-navigate (Instagram-style) =====
    // When the image is at scale 1 (not zoomed), a horizontal drag should
    // translate the whole image with the finger and snap to the next/prev
    // image on release. Vertical drags fall through so the user can still
    // dismiss with a downward fling (handled by clicking the backdrop).
    const [swipeOffsetX, setSwipeOffsetX] = useState(0);
    const [isSwiping, setIsSwiping] = useState(false);
    const swipeStart = React.useRef<{ x: number; y: number; t: number } | null>(null);
    const swipeAxis = React.useRef<'h' | 'v' | null>(null);

    React.useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowRight') setIndex(i => (i + 1) % images.length);
            if (e.key === 'ArrowLeft') setIndex(i => (i - 1 + images.length) % images.length);
        };
        window.addEventListener('keydown', onKey);
        // Lock body scroll while the viewer is open so background scroll
        // doesn't interfere with pinch/wheel gestures on the image.
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [images.length, onClose]);

    const reset = () => { setScale(1); setOffset({ x: 0, y: 0 }); };
    React.useEffect(() => { reset(); setImgError(false); }, [index]);

    const onWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const next = Math.min(4, Math.max(1, scale - e.deltaY * 0.002));
        setScale(next);
        if (next === 1) setOffset({ x: 0, y: 0 });
    };

    const onTouchStart = (e: React.TouchEvent) => {
        if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            lastTouchDist.current = Math.hypot(dx, dy);
            // Cancel any in-flight swipe — pinch takes priority.
            swipeStart.current = null;
            swipeAxis.current = null;
            setIsSwiping(false);
            setSwipeOffsetX(0);
        } else if (e.touches.length === 1) {
            const t = e.touches[0];
            lastTouchPos.current = { x: t.clientX, y: t.clientY };
            // Arm a potential swipe ONLY when not zoomed and there's somewhere
            // to swipe to. While zoomed we still want single-finger pan.
            if (scale <= 1.01 && images.length > 1) {
                swipeStart.current = { x: t.clientX, y: t.clientY, t: Date.now() };
                swipeAxis.current = null;
            }
        }
    };

    const onTouchMove = (e: React.TouchEvent) => {
        if (e.touches.length === 2 && lastTouchDist.current) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.hypot(dx, dy);
            const next = Math.min(4, Math.max(1, scale * (dist / lastTouchDist.current)));
            setScale(next);
            lastTouchDist.current = dist;
        } else if (e.touches.length === 1 && lastTouchPos.current && scale > 1) {
            const dx = e.touches[0].clientX - lastTouchPos.current.x;
            const dy = e.touches[0].clientY - lastTouchPos.current.y;
            setOffset(o => ({ x: o.x + dx, y: o.y + dy }));
            lastTouchPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        } else if (e.touches.length === 1 && swipeStart.current && scale <= 1.01) {
            const t = e.touches[0];
            const dx = t.clientX - swipeStart.current.x;
            const dy = t.clientY - swipeStart.current.y;
            // Lock the gesture axis after the first 8 px of movement so a
            // vertical scroll doesn't accidentally trigger image navigation.
            if (!swipeAxis.current) {
                if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
                    swipeAxis.current = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
                    if (swipeAxis.current === 'h') setIsSwiping(true);
                }
            }
            if (swipeAxis.current === 'h') {
                setSwipeOffsetX(dx);
            }
        }
    };

    const onTouchEnd = () => {
        lastTouchDist.current = null;
        lastTouchPos.current = null;
        if (scale <= 1.05) { setScale(1); setOffset({ x: 0, y: 0 }); }
        // Resolve a horizontal swipe — go next/prev if the user moved past the
        // commit threshold OR flicked quickly. Otherwise spring back.
        if (swipeAxis.current === 'h' && swipeStart.current && images.length > 1) {
            const elapsed = Math.max(1, Date.now() - swipeStart.current.t);
            const speed = Math.abs(swipeOffsetX) / elapsed; // px / ms
            const widthGuess = typeof window !== 'undefined' ? window.innerWidth : 360;
            const commitDistance = Math.max(60, widthGuess * 0.22);
            const commit = Math.abs(swipeOffsetX) > commitDistance || speed > 0.6;
            // Negative dx → finger moved leftward. In LTR that goes to NEXT,
            // in RTL it goes to PREVIOUS — gallery direction follows reading
            // direction, matching every Arabic photo viewer the user knows.
            if (commit) {
                const goNext = isRTL ? (swipeOffsetX > 0) : (swipeOffsetX < 0);
                setIndex(i => goNext
                    ? (i + 1) % images.length
                    : (i - 1 + images.length) % images.length);
            }
        }
        swipeStart.current = null;
        swipeAxis.current = null;
        setIsSwiping(false);
        setSwipeOffsetX(0);
    };

    const node = (
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0,
                zIndex: 99999,
                background: 'rgba(0,0,0,0.94)',
                WebkitBackdropFilter: 'blur(8px)', backdropFilter: 'blur(8px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                animation: 'taki-zoom-fade .2s ease-out',
                overflow: 'hidden'
            }}
        >
            <style>{`@keyframes taki-zoom-fade{from{opacity:0}to{opacity:1}}`}</style>

            <button
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                aria-label={isRTL ? 'إغلاق' : 'Close'}
                style={{
                    position: 'absolute', top: 'calc(env(safe-area-inset-top, 12px) + 16px)',
                    [isRTL ? 'left' : 'right']: 16,
                    background: 'rgba(100, 100, 100, 0.15)', backdropFilter: 'blur(10px)',
                    color: 'white', border: '1px solid rgba(80, 80, 95, 0.25)',
                    width: 44, height: 44, borderRadius: 22, fontSize: '1.4rem', fontWeight: 900,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                } as React.CSSProperties}
            >
                ✕
            </button>

            <div style={{
                position: 'absolute', top: 'calc(env(safe-area-inset-top, 12px) + 16px)',
                [isRTL ? 'right' : 'left']: 20,
                color: 'white', fontWeight: 900, fontSize: '0.9rem',
                background: 'rgba(80, 80, 95, 0.12)', padding: '8px 14px', borderRadius: 14,
                backdropFilter: 'blur(8px)'
            } as React.CSSProperties}>
                {index + 1} / {images.length}
            </div>

            {images.length > 1 && (
                <>
                    <button
                        onClick={(e) => { e.stopPropagation(); setIndex(i => (i - 1 + images.length) % images.length); }}
                        style={{
                            position: 'absolute', top: '50%', transform: 'translateY(-50%)',
                            [isRTL ? 'right' : 'left']: 12,
                            background: 'rgba(100, 100, 100, 0.15)', color: 'white',
                            border: '1px solid rgba(80, 80, 95, 0.25)', width: 48, height: 48, borderRadius: 24,
                            fontSize: '1.4rem', fontWeight: 900, cursor: 'pointer'
                        } as React.CSSProperties}
                        aria-label="prev"
                    >‹</button>
                    <button
                        onClick={(e) => { e.stopPropagation(); setIndex(i => (i + 1) % images.length); }}
                        style={{
                            position: 'absolute', top: '50%', transform: 'translateY(-50%)',
                            [isRTL ? 'left' : 'right']: 12,
                            background: 'rgba(100, 100, 100, 0.15)', color: 'white',
                            border: '1px solid rgba(80, 80, 95, 0.25)', width: 48, height: 48, borderRadius: 24,
                            fontSize: '1.4rem', fontWeight: 900, cursor: 'pointer'
                        } as React.CSSProperties}
                        aria-label="next"
                    >›</button>
                </>
            )}

            {imgError ? (
                <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        color: 'white', textAlign: 'center', padding: 24,
                        background: 'rgba(80, 80, 90, 0.2)', borderRadius: 16,
                        border: '1px solid rgba(100, 100, 100, 0.15)', maxWidth: 320
                    }}
                >
                    <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>🖼️</div>
                    <div style={{ fontWeight: 900, fontSize: '1rem' }}>
                        {isRTL ? 'تعذّر تحميل الصورة' : 'Failed to load image'}
                    </div>
                    <a
                        href={images[index]}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            display: 'inline-block', marginTop: 14, padding: '8px 16px',
                            background: 'var(--card-bg)', color: 'var(--text-primary)', borderRadius: 12,
                            fontWeight: 900, fontSize: '0.85rem', textDecoration: 'none'
                        }}
                    >
                        {isRTL ? 'فتح في تبويب جديد' : 'Open in new tab'}
                    </a>
                </div>
            ) : (
                <img
                    key={images[index]}
                    src={images[index]}
                    alt=""
                    onError={() => setImgError(true)}
                    onClick={(e) => e.stopPropagation()}
                    onWheel={onWheel}
                    onTouchStart={onTouchStart}
                    onTouchMove={onTouchMove}
                    onTouchEnd={onTouchEnd}
                    onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (scale > 1) reset();
                        else setScale(2.2);
                    }}
                    className="taki-zoom-image"
                    style={{
                        display: 'block',
                        width: 'auto', height: 'auto',
                        objectFit: 'contain',
                        // While swiping, follow the finger with a slight rubber-
                        // band damping when there's no neighbor in that direction
                        // (handled by the index wraparound on commit). Pan offset
                        // and scale are independent — they only apply when zoomed.
                        transform: `translate(${offset.x + swipeOffsetX}px, ${offset.y}px) scale(${scale})`,
                        transformOrigin: 'center center',
                        // No transition mid-swipe / mid-pinch — both must follow
                        // the finger in real-time. Spring back on release uses
                        // the same 0.18s cubic.
                        transition: (lastTouchDist.current || isSwiping) ? 'none' : 'transform 0.18s cubic-bezier(0.4,0,0.2,1)',
                        cursor: scale > 1 ? 'grab' : 'zoom-in',
                        userSelect: 'none', touchAction: 'none',
                        boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
                        background: 'rgba(80, 80, 90, 0.2)'
                    }}
                />
            )}

            <div style={{
                position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom, 12px) + 20px)',
                left: '50%', transform: 'translateX(-50%)',
                display: 'flex', gap: 10, alignItems: 'center'
            }}>
                <button
                    onClick={(e) => { e.stopPropagation(); setScale(s => Math.max(1, s - 0.4)); if (scale - 0.4 <= 1) setOffset({x:0,y:0}); }}
                    style={{ width: 42, height: 42, borderRadius: 21, background: 'rgba(100, 100, 100, 0.15)', color: 'white', border: '1px solid rgba(80, 80, 95, 0.25)', fontWeight: 900, fontSize: '1.1rem', cursor: 'pointer' }}
                    aria-label="zoom out"
                >−</button>
                <div style={{ color: 'white', fontWeight: 900, fontSize: '0.8rem', minWidth: 56, textAlign: 'center' }}>
                    {Math.round(scale * 100)}%
                </div>
                <button
                    onClick={(e) => { e.stopPropagation(); setScale(s => Math.min(4, s + 0.4)); }}
                    style={{ width: 42, height: 42, borderRadius: 21, background: 'rgba(100, 100, 100, 0.15)', color: 'white', border: '1px solid rgba(80, 80, 95, 0.25)', fontWeight: 900, fontSize: '1.1rem', cursor: 'pointer' }}
                    aria-label="zoom in"
                >+</button>
                {scale !== 1 && (
                    <button
                        onClick={(e) => { e.stopPropagation(); reset(); }}
                        style={{ marginInlineStart: 8, padding: '0 14px', height: 42, borderRadius: 21, background: 'rgba(100, 100, 100, 0.15)', color: 'white', border: '1px solid rgba(80, 80, 95, 0.25)', fontWeight: 900, fontSize: '0.8rem', cursor: 'pointer' }}
                    >
                        {isRTL ? 'إعادة' : 'Reset'}
                    </button>
                )}
            </div>
        </div>
    );

    return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
};

// Same compact countdown badge used on the home-feed card. Format: "364ي 23س".
const formatRemaining = (createdAt: number, expiresInMinutes: number, isRTL: boolean): { text: string; urgent: boolean; expired: boolean } => {
    const lifespan = (expiresInMinutes || 0) * 60 * 1000;
    const expiry = (createdAt || 0) + lifespan;
    const diff = expiry - Date.now();
    if (diff <= 0) return { text: isRTL ? 'منتهي' : 'Expired', urgent: false, expired: true };

    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff / 3600000) % 24);
    const mins = Math.floor((diff / 60000) % 60);
    const secs = Math.floor((diff / 1000) % 60);
    const urgent = diff < 3600000;

    if (days > 0) return { text: isRTL ? `${days}ي ${hours}س` : `${days}d ${hours}h`, urgent: false, expired: false };
    if (hours > 0) return { text: isRTL ? `${hours}س ${mins}د` : `${hours}h ${mins}m`, urgent, expired: false };
    if (mins > 0) return { text: isRTL ? `${mins}د ${secs.toString().padStart(2, '0')}ث` : `${mins}m ${secs}s`, urgent: true, expired: false };
    return { text: isRTL ? `${secs}ث` : `${secs}s`, urgent: true, expired: false };
};

const DealDetails: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const location = useLocation();
    const queryParams = new URLSearchParams(location.search);
    const linkedBarcode = queryParams.get('barcode');

    const history = useHistory();
    const {
        deals, user, addRating, addReply, toggleRatingLike, removeRating, updateDeal, updateDealStock, language, toggleFollowMerchant, followedMerchants,
        customAlert, customConfirm, bookings, acknowledgeBooking, completeBooking: ctxCompleteBooking,
        storeProfiles
    } = useApp();
    const { bookDeal, isBooked } = useBooking();

    const [reviewScore, setReviewScore] = useState(5);
    const [reviewComment, setReviewComment] = useState('');
    const [showReviewForm, setShowReviewForm] = useState(false);
    const [currentImage, setCurrentImage] = useState(0);
    const [selectedQuantity, setSelectedQuantity] = useState(1);
    const [selectedPrepTime, setSelectedPrepTime] = useState('arrival');
    const [bookingNotes, setBookingNotes] = useState('');
    const [showBookingModal, setShowBookingModal] = useState(false);
    const [manualCode, setManualCode] = useState('');
    const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
    const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
    const [zoomOpen, setZoomOpen] = useState(false);
    const [ticketCollapsed, setTicketCollapsed] = useState(false);
    const [, setNowTick] = useState(0);

    // prepTimeOptions removed, dynamically typed now

    const isRTL = language === 'ar';
    const deal = deals.find(d => d.id === id);

    // Tick once a second so the on-image countdown badge updates live.
    React.useEffect(() => {
        const id = setInterval(() => setNowTick(t => t + 1), 1000);
        return () => clearInterval(id);
    }, []);
    const isSeller = user?.userType === 'seller';
    const isOwner = isSeller && user?.id === deal?.storeId;
    const isFollowed = deal ? followedMerchants.includes(deal.storeId) : false;

    // Find active booking for this user/deal OR linked from notification
    const activeBooking = useMemo(() => {
        if (!deal) return null;
        if (linkedBarcode) {
            return bookings.find(b => b.barcode === linkedBarcode);
        }
        if (user && !isOwner) {
            return bookings.find(b => b.deal.id === deal.id && b.userId === user.id);
        }
        return null;
    }, [bookings, deal, user, isOwner, linkedBarcode]);

    // Auto-collapse the booking ticket once the order is fully received — the
    // barcode/QR are no longer actionable, and a fresh visit shouldn't shove
    // them in the user's face.
    React.useEffect(() => {
        if (activeBooking?.status === 'completed') {
            setTicketCollapsed(true);
        }
    }, [activeBooking?.status]);

    // Notification deep-link: when the buyer taps an alert that points here
    // with `?barcode=X`, force the ticket open so the receipt + merchant
    // reply are the first thing they see — overrides any prior collapse
    // toggle the user might have set on a previous visit.
    React.useEffect(() => {
        if (linkedBarcode && activeBooking && activeBooking.status !== 'completed') {
            setTicketCollapsed(false);
        }
    }, [linkedBarcode, activeBooking?.status]);

    const { incrementDealView } = useApp();
    React.useEffect(() => {
        if (id) {
            incrementDealView(id);
        }
    }, [id]);

    if (!deal) {
        return (
            <div className="empty-state animate-fade-in">
                <div style={{ fontSize: '4rem', marginBottom: 16 }}>🔍</div>
                <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>{isRTL ? 'العرض غير موجود' : 'Deal Not Found'}</div>
                <button onClick={() => history.push('/')} style={{ marginTop: 20, padding: '12px 28px', borderRadius: 14, background: 'var(--dark)', color: 'white', fontWeight: 800, border: 'none' }}>
                    {isRTL ? 'العودة للرئيسية' : 'Go Home'}
                </button>
            </div>
        );
    }

    const { average, count } = dealService.calculateRating(deal.ratings);
    const loc = getLocation(deal.locationId);
    const booked = isBooked(deal.id);
    const images = deal.images.length > 0 ? deal.images : ['https://images.unsplash.com/photo-1543852786-1cf6624b9987?w=800'];

    // A deal is "sold out" only when the seller actually capped the stock and
    // bookings have drained it. Time-based offers (no cap) ignore quantity.
    const hasStockCap = typeof deal.initialQuantity === 'number' && deal.initialQuantity > 0;
    const isSoldOut = deal.quantity !== 'unlimited'
        && typeof deal.quantity === 'number'
        && deal.quantity <= 0
        && hasStockCap;
    const canBook = !isSoldOut;

    const handleBooking = () => {
        if (!user) {
            history.push('/register');
            return;
        }
        if (isSoldOut) return;

        // bookDeal in AppContext: persists to Supabase and notifies both parties.
        bookDeal(deal, selectedQuantity, user.id, selectedPrepTime, bookingNotes);

        // Reserve quantity only when the seller set a real stock cap.
        // Time-based offers stay infinitely bookable until the timer ends.
        // Use updateDealStock (partial UPDATE on quantity only) so we don't
        // re-write the `status` column — the v9.1 trigger blocks any
        // implicit-status write when the merchant's subscription isn't
        // active, and that previously took booking down with it.
        if (hasStockCap && deal.quantity !== 'unlimited') {
            updateDealStock(deal.id, (deal.quantity as number) - selectedQuantity);
        }

        customAlert(isRTL ? "✅ تم تأكيد الحجز بنجاح وسيتم تحويلك لصفحة حجوزاتي" : "✅ Booking confirmed. Redirecting to My Bookings");
        history.push('/bookings');
    };

    const copyCode = async (code: string) => {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(code);
            } else {
                const el = document.createElement('textarea');
                el.value = code;
                el.style.position = 'fixed';
                el.style.opacity = '0';
                document.body.appendChild(el);
                el.select();
                document.execCommand('copy');
                document.body.removeChild(el);
            }
            customAlert(isRTL ? `✅ تم نسخ الرمز: ${code}` : `✅ Code copied: ${code}`);
        } catch {
            customAlert(isRTL ? '❌ تعذّر النسخ، انسخ الرمز يدوياً' : '❌ Copy failed, copy code manually');
        }
    };

    const [submittingReview, setSubmittingReview] = useState(false);
    const handleReview = async () => {
        if (submittingReview) return;
        if (!user) {
            history.push('/register');
            return;
        }
        setSubmittingReview(true);
        const ok = await addRating(deal.id, { score: reviewScore, comment: reviewComment });
        setSubmittingReview(false);
        if (!ok) {
            customAlert(isRTL
                ? '❌ تعذّر إرسال التقييم. تحقق من الاتصال وحاول مرة أخرى.'
                : '❌ Could not submit review. Check your connection and try again.');
            return;
        }
        setShowReviewForm(false);
        setReviewComment('');
        customAlert(isRTL ? '✅ تم إرسال تقييمك — شكراً لمشاركتك!' : '✅ Review submitted — thanks for sharing!');
    };

    // isFavorite, isSeller, isOwner already defined above

    return (
        <div className="page-content" style={{ background: 'var(--body-bg)', direction: isRTL ? 'rtl' : 'ltr', minHeight: '100vh' }}>
            <div className="premium-bar" style={{ paddingBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: user?.userType === 'seller' && user?.id === deal.storeId ? 16 : 0 }}>
                    <button onClick={() => history.goBack()} style={{ background: 'rgba(80, 80, 95, 0.2)', border: 'none', color: 'white', width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem' }}>
                        {isRTL ? '➡️' : '⬅️'}
                    </button>
                    <div style={{ flex: 1, textAlign: 'center', fontWeight: 900, fontSize: '1rem', color: 'white' }}>
                        {deal.shopName}
                    </div>
                    <button onClick={() => { 
                        if(user && deal) toggleFollowMerchant(deal.storeId); 
                        else if(!user) history.push('/register'); 
                    }} style={{ 
                        background: isFollowed ? '#ef4444' : 'rgba(80, 80, 95, 0.2)', 
                        border: 'none', width: 40, height: 40, borderRadius: 12, fontSize: '1.2rem', 
                        display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white',
                        transition: 'all 0.3s ease'
                    }}>
                        {isFollowed ? '❤️' : '🤍'}
                    </button>
                </div>
                <SellerTopBar storeId={deal.storeId} />
            </div>

            {/* Notification Highlight Label */}
            {linkedBarcode && activeBooking && (
                <div style={{ background: 'rgba(245, 158, 11, 0.2)', color: 'var(--secondary)', padding: '12px 16px', fontWeight: 800, fontSize: '0.85rem', textAlign: 'center', borderBottom: '1px solid rgba(245, 158, 11, 0.3)' }}>
                    {isRTL ? '🔍 جاري عرض بيانات الحجز المرتبط بالتنبيه' : '🔍 Viewing booking linked to notification'}
                </div>
            )}

            {/* Image Gallery */}
            <div className="animate-fade-in" style={{ position: 'relative' }}>
                <img src={images[currentImage]} loading="eager" decoding="async" alt={deal.itemName}
                    width={800} height={320}
                    onClick={() => setZoomOpen(true)}
                    style={{ width: '100%', height: 320, objectFit: 'cover', cursor: 'zoom-in' }}
                    onError={(e: React.SyntheticEvent<HTMLImageElement, Event>) => { (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1543852786-1cf6624b9987?w=800'; }} />
                <button
                    onClick={() => setZoomOpen(true)}
                    aria-label={isRTL ? 'تكبير الصورة' : 'Zoom image'}
                    style={{
                        position: 'absolute',
                        bottom: 12,
                        [isRTL ? 'left' : 'right']: 12,
                        background: 'rgba(15,23,42,0.55)',
                        color: 'white',
                        border: '1px solid rgba(80, 80, 95, 0.18)',
                        backdropFilter: 'blur(8px)',
                        borderRadius: 14,
                        padding: '8px 12px',
                        fontWeight: 900,
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        boxShadow: '0 6px 18px rgba(0,0,0,0.25)'
                    } as React.CSSProperties}
                >
                    🔍 {isRTL ? 'تكبير' : 'Zoom'}
                </button>
                {images.length > 1 && (
                    <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 6 }}>
                        {images.map((_, idx) => (
                            <button key={idx} onClick={(e) => { e.stopPropagation(); setCurrentImage(idx); }}
                                style={{ width: idx === currentImage ? 20 : 8, height: 8, borderRadius: 4, background: idx === currentImage ? 'white' : 'rgba(100, 100, 115, 0.5)', border: 'none', transition: 'all 0.2s ease' }} />
                        ))}
                    </div>
                )}
                <div style={{ position: 'absolute', top: 12, right: 12, background: 'linear-gradient(135deg, #ef4444, #dc2626)', color: 'white', padding: '6px 14px', borderRadius: 12, fontWeight: 900, fontSize: '1rem', boxShadow: '0 4px 12px rgba(239,68,68,0.3)' }}>
                    -{deal.discountPercentage}%
                </div>
                {/* Live countdown — same compact badge as the home-feed card. */}
                {(() => {
                    const remaining = formatRemaining(deal.createdAt, deal.expiresInMinutes || 0, isRTL);
                    return (
                        <div style={{
                            position: 'absolute',
                            bottom: 12,
                            [isRTL ? 'right' : 'left']: 12,
                            background: remaining.expired
                                ? 'rgba(100,116,139,0.92)'
                                : remaining.urgent
                                    ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
                                    : 'rgba(15,23,42,0.78)',
                            color: 'white',
                            padding: '6px 12px',
                            borderRadius: 10,
                            fontSize: '0.85rem',
                            fontWeight: 900,
                            backdropFilter: 'blur(8px)',
                            boxShadow: remaining.urgent ? '0 2px 10px rgba(239,68,68,0.45)' : '0 2px 6px rgba(0,0,0,0.25)',
                            animation: remaining.urgent && !remaining.expired ? 'pulse 1.4s ease-in-out infinite' : 'none',
                            display: 'flex', alignItems: 'center', gap: 6
                        } as React.CSSProperties}>
                            <span>{remaining.expired ? '⏹' : '⏱'}</span>
                            <span>{remaining.text}</span>
                        </div>
                    );
                })()}
            </div>

            {zoomOpen && (
                <ImageZoomViewer
                    images={images}
                    initialIndex={currentImage}
                    onClose={() => setZoomOpen(false)}
                    isRTL={isRTL}
                />
            )}

            {/* Content */}
            <div style={{ padding: 16 }}>
                {/* Booking Ticket - USER REQUEST: Appear in product page */}
                {activeBooking && ticketCollapsed && (
                    <button
                        onClick={() => setTicketCollapsed(false)}
                        className="animate-fade-in"
                        style={{
                            width: '100%',
                            background: activeBooking.status === 'completed'
                                ? 'var(--gray-50)'
                                : 'var(--card-bg)',
                            border: activeBooking.status === 'completed'
                                ? '1.5px solid var(--border-color)'
                                : '2px dashed var(--primary)',
                            borderRadius: 20, padding: '14px 18px', marginBottom: 12,
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            cursor: 'pointer', boxShadow: 'var(--shadow-sm)',
                            transition: 'all 0.2s ease', textAlign: 'start'
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{
                                width: 28, height: 28, borderRadius: 14,
                                background: activeBooking.status === 'completed' ? 'var(--primary)' : 'var(--primary)',
                                color: 'white', display: 'inline-flex', alignItems: 'center',
                                justifyContent: 'center', fontSize: '0.85rem', fontWeight: 900
                            }}>✓</span>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                                <span style={{ fontWeight: 900, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                                    {activeBooking.status === 'completed'
                                        ? (isRTL ? 'تم الاستلام بنجاح' : 'Order Received')
                                        : activeBooking.status === 'acknowledged'
                                            ? (isRTL ? 'استلمه التاجر — قيد التجهيز' : 'Seller Received — Preparing')
                                            : (isRTL ? 'حجز مؤكد' : 'Booking Confirmed')}
                                </span>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'monospace', fontWeight: 800 }}>
                                    {activeBooking.barcode}
                                </span>
                            </div>
                        </div>
                        <span style={{ fontSize: '0.78rem', color: 'var(--primary)', fontWeight: 900 }}>
                            {isRTL ? 'عرض التفاصيل ▾' : 'Show details ▾'}
                        </span>
                    </button>
                )}
                {activeBooking && !ticketCollapsed && (
                    <div className="animate-fade-in" style={{ background: 'var(--card-bg)', borderRadius: 24, padding: 20, marginBottom: 12, border: '2px dashed var(--secondary)', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: 'var(--secondary)' }} />

                        <button
                            onClick={() => setTicketCollapsed(true)}
                            aria-label={isRTL ? 'تصغير' : 'Collapse'}
                            style={{
                                position: 'absolute', top: 12,
                                [isRTL ? 'left' : 'right']: 12,
                                background: 'var(--body-bg)', border: '1px solid var(--gray-200)',
                                borderRadius: 10, padding: '4px 10px', fontSize: '0.7rem',
                                fontWeight: 900, color: 'var(--text-secondary)', cursor: 'pointer', zIndex: 2
                            } as React.CSSProperties}
                        >
                            {isRTL ? 'تصغير ▴' : 'Hide ▴'}
                        </button>

                        <StatusTracker status={activeBooking.status} isRTL={isRTL} />

                        {/* Merchant note — shown to buyer after seller acknowledges
                            with a note. Buyer's own note is intentionally NOT shown
                            here to avoid confusion (they wrote it themselves). */}
                        {!isOwner && activeBooking.merchantNote && activeBooking.status !== 'completed' && (
                            <div style={{
                                marginTop: 12,
                                marginBottom: 12,
                                padding: '12px 16px',
                                background: 'rgba(245, 158, 11, 0.12)',
                                border: '1px solid rgba(245, 158, 11, 0.35)',
                                borderRadius: 14,
                                borderRight: isRTL ? '4px solid var(--secondary)' : '1px solid rgba(245, 158, 11, 0.35)',
                                borderLeft: !isRTL ? '4px solid var(--secondary)' : '1px solid rgba(245, 158, 11, 0.35)',
                            }}>
                                <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#b45309', marginBottom: 4 }}>
                                    💬 {isRTL ? 'رسالة من التاجر:' : 'Note from merchant:'}
                                </div>
                                <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                                    {activeBooking.merchantNote}
                                </div>
                            </div>
                        )}

                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ background: 'var(--card-bg)', color: 'var(--text-primary)', padding: '10px 20px', borderRadius: 12, border: '1.5px solid var(--border-color)', fontFamily: 'monospace', fontWeight: 900, fontSize: '1.2rem', letterSpacing: 2, boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)' }}>
                                    {activeBooking.barcode}
                                </div>
                                {!isOwner && (
                                    <button onClick={() => copyCode(activeBooking.barcode)}
                                        style={{ background: 'var(--primary)', color: 'white', border: 'none', borderRadius: 12, padding: '10px 14px', fontWeight: 800, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                                        aria-label={isRTL ? 'نسخ الرمز' : 'Copy code'}>
                                        📋 {isRTL ? 'نسخ' : 'Copy'}
                                    </button>
                                )}
                            </div>
                            
                            <div style={{ background: 'var(--card-bg)', padding: '15px 25px', borderRadius: 16, border: '1.5px solid var(--border-color)', color: 'var(--text-primary)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                                <BarcodeVisual code={activeBooking.barcode} />
                            </div>

                            {/* Verification for Seller */}
                            {isOwner && activeBooking.status !== 'completed' && (
                                <div style={{ width: '100%', marginTop: 10, borderTop: '1px solid var(--gray-100)', paddingTop: 15 }}>
                                    <h4 style={{ margin: '0 0 10px', fontSize: '0.85rem', fontWeight: 800 }}>{isRTL ? 'التحقق من الكود (للتاجر):' : 'Verify Code (Seller Only):'}</h4>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <input 
                                            placeholder={isRTL ? 'أدخل الكود للتأكيد' : 'Enter code to confirm'}
                                            value={manualCode}
                                            onChange={e => setManualCode(e.target.value)}
                                            style={{ flex: 1, padding: 10, borderRadius: 10, border: '1.5px solid var(--gray-200)', outline: 'none' }}
                                        />
                                        <button 
                                            onClick={async () => {
                                                if (manualCode === activeBooking.barcode || manualCode === activeBooking.backupCode) {
                                                    await ctxCompleteBooking(activeBooking.barcode);
                                                    customAlert(isRTL ? '✅ تم تأكيد الحجز وخصم الكمية' : '✅ Booking confirmed and stock deducted');
                                                    setManualCode('');
                                                } else {
                                                    customAlert(isRTL ? '❌ الرمز غير صحيح' : '❌ Invalid code');
                                                }
                                            }}
                                            style={{ padding: '0 16px', borderRadius: 10, background: 'var(--primary)', color: 'white', fontWeight: 800, border: 'none' }}
                                        >
                                            {isRTL ? 'تأكيد' : 'Confirm'}
                                        </button>
                                    </div>
                                    <div style={{ marginTop: 12, textAlign: 'center' }}>
                                        <button 
                                            onClick={() => acknowledgeBooking(activeBooking.barcode)}
                                            style={{ width: '100%', padding: '10px', borderRadius: 10, border: '1.5px solid var(--primary)', color: 'var(--primary)', background: 'none', fontWeight: 800, fontSize: '0.8rem' }}
                                        >
                                            {isRTL ? 'إبلاغ المشتري أني سأجهز الطلب 🕒' : 'Notify buyer I am preparing 🕒'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Title & Price */}
                <div className="animate-fade-in" style={{ background: 'var(--card-bg)', borderRadius: 24, padding: 20, marginBottom: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.04)' }}>
                    <div
                        role="button"
                        tabIndex={0}
                        aria-label={isRTL ? `عرض ${deal.shopName}` : `View ${deal.shopName}`}
                        onClick={() => history.push(`/store/${deal.storeId}`)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); history.push(`/store/${deal.storeId}`); } }}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, cursor: 'pointer', background: 'var(--body-bg)', padding: '12px', borderRadius: 16, border: '1px solid var(--gray-100)', WebkitTapHighlightColor: 'transparent' }}
                    >
                        <div style={{ width: 50, height: 50, borderRadius: 14, background: 'var(--primary-light)', border: '2px solid white', boxShadow: '0 4px 10px rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', overflow: 'hidden' }}>
                            {storeProfiles[deal.storeId]?.avatar ? <img src={storeProfiles[deal.storeId].avatar} alt="Merchant" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🏪'}
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '1rem', color: 'var(--text-primary)', fontWeight: 900 }}>{deal.shopName}</div>
                            <div style={{ fontSize: '0.75rem', color: '#0284c7', fontWeight: 800 }}>{isRTL ? 'عرض التقييمات والملف الشخصي ←' : 'View Reviews & Profile →'}</div>
                        </div>
                    </div>
                    <h1 style={{ fontSize: '1.3rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 12 }}>{deal.itemName}</h1>

                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16 }}>
                        <span style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--danger)' }}>{deal.discountedPrice} ر.س</span>
                        <span style={{ fontSize: '1rem', color: 'var(--gray-400)', textDecoration: 'line-through' }}>{deal.originalPrice} ر.س</span>
                        <span style={{ background: 'var(--gray-100)', color: 'var(--primary)', padding: '3px 10px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 800 }}>
                            {isRTL ? `وفّر ${deal.originalPrice - deal.discountedPrice} ر.س` : `Save ${deal.originalPrice - deal.discountedPrice} SAR`}
                        </span>
                    </div>

                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ background: 'var(--secondary-light)', color: 'var(--secondary)', padding: '6px 14px', borderRadius: 10, fontSize: '0.8rem', fontWeight: 800 }}>
                            ★ {average > 0 ? average : (isRTL ? 'جديد' : 'New')} {count > 0 && `(${count} ${isRTL ? 'تعليق' : 'reviews'})`}
                        </span>
                        <span style={{ background: 'var(--gray-100)', padding: '6px 14px', borderRadius: 10, fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                            📦 {(() => {
                                if (deal.quantity === 'unlimited') return isRTL ? 'كمية لا محدودة' : 'Unlimited quantity';
                                if (typeof deal.quantity === 'number' && deal.quantity > 0) return isRTL ? `${deal.quantity} متبقي` : `${deal.quantity} left`;
                                if (!hasStockCap) return isRTL ? '⏱ عرض زمني' : '⏱ Time-limited';
                                return isRTL ? 'نفذت الكمية' : 'Sold Out';
                            })()}
                        </span>
                        {deal.size && <span style={{ background: 'var(--gray-100)', padding: '6px 14px', borderRadius: 10, fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)' }}>👕 {deal.size}</span>}
                    </div>
                </div>

                {/* Merchant Contact Section */}
                {(storeProfiles[deal.storeId]?.contactPhone || storeProfiles[deal.storeId]?.phone) && (
                    <div className="animate-fade-in" style={{ background: 'var(--card-bg)', borderRadius: 20, padding: 16, marginBottom: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.04)', display: 'flex', gap: 10 }}>
                        <a href={`tel:${storeProfiles[deal.storeId]?.contactPhone || storeProfiles[deal.storeId]?.phone}`} 
                           style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'var(--body-bg)', padding: '12px', borderRadius: 14, color: 'var(--text-primary)', textDecoration: 'none', fontSize: '0.9rem', fontWeight: 800, border: '1.5px solid var(--gray-200)' }}>
                            📞 {isRTL ? 'اتصال' : 'Call'}
                        </a>
                        <a href={`https://wa.me/966${(storeProfiles[deal.storeId]?.contactPhone || storeProfiles[deal.storeId]?.phone)?.replace(/^0/, '')}`} 
                           target="_blank" rel="noopener noreferrer"
                           style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: '#25d366', padding: '12px', borderRadius: 14, color: 'white', textDecoration: 'none', fontSize: '0.9rem', fontWeight: 800 }}>
                            💬 WhatsApp
                        </a>
                    </div>
                )}

                {/* Description */}
                <div className="animate-fade-in" style={{ background: 'var(--card-bg)', borderRadius: 20, padding: 20, marginBottom: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.04)' }}>
                    <h3 style={{ fontWeight: 800, marginBottom: 10, fontSize: '0.95rem' }}>{isRTL ? 'الوصف' : 'Description'}</h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.8, fontWeight: 600 }}>{deal.description}</p>
                </div>

                {/* Location */}
                {(loc || deal.mapLocation) && (() => {
                    // Resolve the deal's region + city via the shared helper so
                    // custom-pin deals (no LOCATIONS entry) still show the
                    // correct Saudi region/city via map-coord fallback.
                    const resolved = resolveDealLocation(deal);
                    const regionName = resolved.regionId ? REGIONS.find(r => r.id === resolved.regionId)?.name : null;
                    const cityName = resolved.cityId ? CITIES.find(c => c.id === resolved.cityId)?.name : null;
                    return (
                    <div className="animate-fade-in" style={{ background: 'var(--card-bg)', borderRadius: 20, padding: 20, marginBottom: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.04)' }}>
                        <h3 style={{ fontWeight: 800, marginBottom: 10, fontSize: '0.95rem' }}>{isRTL ? 'الموقع' : 'Location'}</h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--body-bg)', padding: '12px 16px', borderRadius: 14, marginBottom: 12 }}>
                            <span style={{ fontSize: '1.5rem' }}>📍</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{loc?.name || (isRTL ? 'موقع مخصص للتاجر' : 'Seller Custom Location')}</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--gray-400)', fontWeight: 600, marginTop: 2 }}>{loc?.type === 'mall' ? '🛍️' : '🏛️'} {loc?.type === 'mall' ? (isRTL ? 'مول' : 'Mall') : (isRTL ? 'سوق / محل' : 'Market / Store')}</div>
                                {(regionName || cityName) && (
                                    <div style={{ fontSize: '0.78rem', color: 'var(--primary)', fontWeight: 800, marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                        <span>🗺️</span>
                                        <span>{[regionName, cityName].filter(Boolean).join(isRTL ? ' • ' : ' • ')}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                        <button type="button" onClick={() => {
                            const lat = deal.mapLocation?.lat || loc?.lat || 0;
                            const lng = deal.mapLocation?.lng || loc?.lng || 0;
                            if(lat && lng) {
                                openExternalUrl(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`);
                            }
                        }} style={{ width: '100%', padding: '12px', borderRadius: 14, background: '#e0f2fe', color: '#0369a1', fontWeight: 800, border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, transition: 'background 0.2s' }}>
                            🗺️ {isRTL ? 'الاتجاهات عبر خرائط جوجل' : 'Directions on Google Maps'}
                        </button>
                    </div>
                    );
                })()}


                {/* Reviews */}
                <div className="animate-fade-in" style={{ background: 'var(--card-bg)', borderRadius: 20, padding: 20, marginBottom: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.04)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <h3 style={{ fontWeight: 800, fontSize: '0.95rem' }}>{isRTL ? 'التعليقات والآراء' : 'Reviews & Feedback'} ({count})</h3>
                        {user && user.userType === 'buyer' && (
                            <button onClick={() => {
                                const userBooking = bookings.find((b) => b.deal.id === deal.id && b.userId === user.id && b.status === 'completed');
                                if (userBooking) {
                                    setShowReviewForm(!showReviewForm);
                                } else {
                                    // Allow review even without completed booking for now (MVP)
                                    setShowReviewForm(!showReviewForm);
                                }
                            }}
                                style={{ background: 'var(--dark)', color: 'white', padding: '8px 16px', borderRadius: 10, fontSize: '0.8rem', fontWeight: 700, border: 'none' }}>
                                {isRTL ? '✍️ أضف تعليق' : '✍️ Add Review'}
                            </button>
                        )}
                    </div>

                    {showReviewForm && (
                        <div style={{ background: 'var(--body-bg)', borderRadius: 16, padding: 16, marginBottom: 16 }}>
                            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                                {[1, 2, 3, 4, 5].map(star => (
                                    <button key={star} onClick={() => setReviewScore(star)}
                                        style={{ fontSize: '1.5rem', background: 'none', border: 'none', opacity: star <= reviewScore ? 1 : 0.3 }}>
                                        ⭐
                                    </button>
                                ))}
                            </div>
                            <textarea value={reviewComment} onChange={e => setReviewComment(e.target.value)}
                                placeholder={isRTL ? 'شاركنا تجربتك...' : 'Share your experience...'}
                                style={{ width: '100%', padding: 14, borderRadius: 14, border: '1.5px solid var(--gray-200)', background: 'var(--card-bg)', color: 'var(--text-primary)', minHeight: 80, outline: 'none', resize: 'none', fontSize: '0.9rem' }} />
                            <button onClick={handleReview}
                                disabled={submittingReview}
                                style={{ marginTop: 10, width: '100%', padding: '12px', borderRadius: 12, background: submittingReview ? 'var(--gray-400)' : 'var(--primary)', color: 'white', fontWeight: 800, border: 'none', cursor: submittingReview ? 'default' : 'pointer' }}>
                                {submittingReview
                                    ? (isRTL ? '⏳ جاري الإرسال...' : '⏳ Submitting...')
                                    : (isRTL ? 'إرسال التقييم' : 'Submit Review')}
                            </button>
                        </div>
                    )}

                    {deal.ratings.length > 0 ? deal.ratings.slice(0, 5).map((r, i) => {
                        const ratingKey = r.id || `${r.userId}-${i}`;
                        const liked = !!(user && r.likedBy && r.likedBy.includes(user.id));
                        const canDelete = !!user && (user.id === r.userId || user.userType === 'admin');
                        const canReply = isOwner && !!r.id;
                        return (
                        <div key={ratingKey} style={{ padding: '16px 0', borderBottom: i < deal.ratings.length - 1 ? '1px solid var(--gray-100)' : 'none' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                <span style={{ fontWeight: 800, fontSize: '0.85rem' }}>{r.userName}</span>
                                <span style={{ color: '#f59e0b', fontSize: '0.8rem' }}>{'★'.repeat(r.score)}{'☆'.repeat(5 - r.score)}</span>
                            </div>
                            <p style={{ color: 'var(--text-primary)', fontSize: '0.85rem', lineHeight: 1.6, fontWeight: 500 }}>{r.comment}</p>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 8 }}>
                                <div style={{ fontSize: '0.7rem', color: 'var(--gray-400)', fontWeight: 600 }}>{r.date}</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    {user && r.id && (
                                        <button
                                            type="button"
                                            onClick={() => toggleRatingLike(deal.id, r.id!)}
                                            aria-pressed={liked}
                                            aria-label={liked ? (isRTL ? 'إلغاء الإعجاب' : 'Unlike') : (isRTL ? 'إعجاب' : 'Like')}
                                            style={{
                                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                                padding: '4px 10px', borderRadius: 999,
                                                border: 'none',
                                                background: liked ? 'rgba(239,68,68,0.12)' : 'var(--body-bg)',
                                                color: liked ? '#ef4444' : 'var(--text-secondary)',
                                                fontSize: '0.78rem', fontWeight: 800, cursor: 'pointer',
                                                transition: 'transform 0.12s ease, background 0.2s'
                                            }}
                                            onPointerDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.92)'; }}
                                            onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
                                            onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
                                            onPointerCancel={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
                                        >
                                            <span style={{ fontSize: '0.95rem' }}>{liked ? '❤️' : '🤍'}</span>
                                            <span>{r.likeCount ?? 0}</span>
                                        </button>
                                    )}
                                    {canDelete && (
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                if (!r.id) return;
                                                const ok = await customConfirm(isRTL ? 'حذف هذا التعليق نهائياً؟' : 'Delete this review permanently?');
                                                if (ok) await removeRating(deal.id, r.id);
                                            }}
                                            style={{
                                                padding: '4px 10px', borderRadius: 999, border: 'none',
                                                background: 'rgba(239,68,68,0.08)', color: '#ef4444',
                                                fontSize: '0.78rem', fontWeight: 800, cursor: 'pointer',
                                                transition: 'transform 0.12s ease'
                                            }}
                                            onPointerDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.92)'; }}
                                            onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
                                            onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
                                            onPointerCancel={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
                                            aria-label={isRTL ? 'حذف التعليق' : 'Delete review'}
                                        >
                                            🗑 {isRTL ? 'حذف' : 'Delete'}
                                        </button>
                                    )}
                                </div>
                            </div>

                            {r.reply && (
                                <div style={{ marginTop: 12, padding: '12px', background: 'var(--body-bg)', borderRadius: 14, borderRight: isRTL ? '3px solid var(--primary)' : 'none', borderLeft: !isRTL ? '3px solid var(--primary)' : 'none' }}>
                                    <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--primary)', marginBottom: 4, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                        <span>💬 {isRTL ? 'رد المتجر:' : 'Store Reply:'}</span>
                                        {isOwner && r.id && (
                                            <button
                                                type="button"
                                                onClick={() => addReply(deal.id, r.id!, '')}
                                                style={{ background: 'none', border: 'none', color: 'var(--gray-400)', fontWeight: 700, fontSize: '0.7rem', cursor: 'pointer' }}
                                                aria-label={isRTL ? 'حذف الرد' : 'Remove reply'}
                                            >
                                                ✕ {isRTL ? 'حذف الرد' : 'Remove'}
                                            </button>
                                        )}
                                    </div>
                                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, fontWeight: 600 }}>{r.reply}</p>
                                </div>
                            )}

                            {canReply && !r.reply && (
                                activeReplyId === r.id ? (
                                    <div style={{ marginTop: 12 }}>
                                        <textarea
                                            value={replyDrafts[r.id!] || ''}
                                            onChange={e => setReplyDrafts({ ...replyDrafts, [r.id!]: e.target.value })}
                                            placeholder={isRTL ? 'اكتب ردك على هذا التعليق...' : 'Write your reply...'}
                                            style={{ width: '100%', padding: 12, borderRadius: 12, border: '1.5px solid var(--gray-200)', minHeight: 60, outline: 'none', resize: 'vertical', fontSize: '0.85rem' }}
                                        />
                                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                            <button onClick={async () => {
                                                const text = (replyDrafts[r.id!] || '').trim();
                                                if (!text || !r.id) return;
                                                await addReply(deal.id, r.id, text);
                                                setReplyDrafts(prev => { const n = { ...prev }; delete n[r.id!]; return n; });
                                                setActiveReplyId(null);
                                            }}
                                                style={{ flex: 1, padding: '10px', borderRadius: 12, background: 'var(--primary)', color: 'white', fontWeight: 800, border: 'none', fontSize: '0.85rem', cursor: 'pointer' }}>
                                                {isRTL ? '💬 إرسال الرد' : '💬 Send Reply'}
                                            </button>
                                            <button onClick={() => { setActiveReplyId(null); setReplyDrafts(prev => { const n = { ...prev }; delete n[r.id!]; return n; }); }}
                                                style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--gray-100)', color: 'var(--text-secondary)', fontWeight: 800, border: 'none', fontSize: '0.85rem', cursor: 'pointer' }}>
                                                {isRTL ? 'إلغاء' : 'Cancel'}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <button onClick={() => setActiveReplyId(r.id!)}
                                        style={{ marginTop: 8, padding: '6px 14px', borderRadius: 10, background: 'var(--body-bg)', border: '1px solid var(--gray-200)', color: 'var(--primary)', fontSize: '0.8rem', fontWeight: 800, cursor: 'pointer' }}>
                                        💬 {isRTL ? 'الرد على هذا التعليق' : 'Reply to this review'}
                                    </button>
                                )
                            )}
                        </div>
                        );
                    }) : (
                        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--gray-400)', fontWeight: 700, fontSize: '0.85rem' }}>
                            {isRTL ? 'لا توجد تقييمات بعد - كن أول من يقيّم!' : 'No reviews yet - be the first!'}
                        </div>
                    )}
                </div>

                {/* v10.67 — Book CTA is now part of the scrolling content
                    (was position:fixed). Nasser wanted the seller "احجز الآن"
                    section at the end of the page, scrolling along with the
                    rest of the deal — not parked over the bottom of the
                    screen. A wide bottom margin clears the fixed BottomNav. */}
                <div style={{
                    marginTop: 24,
                    display: 'flex', flexDirection: 'column',
                    background: 'var(--card-bg)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 20,
                    padding: '20px 20px',
                    marginBottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
                    transition: 'background 0.3s ease'
                }}>
                    {isSeller ? (
                        <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 800, padding: '10px' }}>
                            {isRTL ? '👁️ أنت تتصفح كبائع، لا يمكنك الحجز' : '👁️ Viewing as seller, booking disabled'}
                        </div>
                    ) : (
                        <>
                            {!booked && canBook && (
                                <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                                    <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>{isRTL ? 'الكمية:' : 'Quantity:'}</span>
                                    <div style={{ display: 'flex', alignItems: 'center', background: 'var(--gray-100)', borderRadius: 12, overflow: 'hidden' }}>
                                        <button onClick={() => setSelectedQuantity(Math.max(1, selectedQuantity - 1))} style={{ padding: '6px 16px', border: 'none', background: 'none', fontSize: '1.2rem', fontWeight: 800 }}>-</button>
                                        <span style={{ padding: '0 12px', fontWeight: 900 }}>{selectedQuantity}</span>
                                        <button onClick={() => {
                                            if (deal.quantity === 'unlimited' || !hasStockCap) {
                                                setSelectedQuantity(selectedQuantity + 1);
                                            } else {
                                                setSelectedQuantity(Math.min(deal.quantity as number, selectedQuantity + 1));
                                            }
                                        }} style={{ padding: '6px 16px', border: 'none', background: 'none', fontSize: '1.2rem', fontWeight: 800 }}>+</button>
                                    </div>
                                </div>
                            )}
                            <button
                                onClick={() => {
                                    if (!user) {
                                        history.push('/register');
                                        return;
                                    }
                                    if (booked) {
                                        history.push('/bookings');
                                        return;
                                    }
                                    setShowBookingModal(true);
                                }}
                                disabled={isSoldOut && !booked}
                                className={`book-btn ${booked ? 'booked' : ''}`}
                                style={{ opacity: isSoldOut && !booked ? 0.5 : 1, cursor: booked ? 'pointer' : undefined }}
                            >
                                {booked
                                    ? (isRTL ? '✅ تم الحجز — انتقل لحجوزاتي' : '✅ Booked — Go to Bookings')
                                    : isSoldOut
                                        ? (isRTL ? 'نفذت الكمية' : 'Sold Out')
                                        : (isRTL ? `🎟️ احجز الآن — ${deal.discountedPrice * selectedQuantity} ر.س` : `🎟️ Book Now — ${deal.discountedPrice * selectedQuantity} SAR`)}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Booking Modal Overlay
                v10.67 — z-index bumped to 1200 (BottomNav is 1100). Without
                this the BottomNav painted on top of the modal's confirm
                button, so the seller could see the total but never the
                "تأكيد الحجز" button below it. Extra bottom padding on the
                inner sheet leaves a comfortable margin even on phones with
                a thicker home-bar safe area. */}
            {showBookingModal && !isSeller && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 1200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', animation: 'fadeIn 0.2s ease-out' }}>
                    <div style={{ background: 'var(--body-bg)', padding: '24px 20px', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 28px)', borderTopLeftRadius: 30, borderTopRightRadius: 30, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 -10px 40px rgba(0,0,0,0.1)', animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                            <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 900 }}>{isRTL ? 'إتمام الحجز' : 'Complete Booking'}</h2>
                            <button onClick={() => setShowBookingModal(false)} style={{ background: 'var(--gray-200)', color: 'var(--text-primary)', border: 'none', width: 36, height: 36, borderRadius: 18, fontWeight: 900, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                        </div>

                        {/* Product Summary */}
                        <div style={{ background: 'var(--card-bg)', borderRadius: 20, padding: '16px 20px', marginBottom: 12, border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ width: 60, height: 60, borderRadius: 12, background: 'var(--gray-100)', overflow: 'hidden' }}>
                                <img src={images[0]} alt="Product" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: 4 }}>{deal.itemName}</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ fontSize: '0.8rem', color: '#f59e0b', fontWeight: 900 }}>★ {average > 0 ? average : (isRTL ? 'جديد' : 'New')}</span>
                                    <span style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 900 }}>{deal.discountedPrice * selectedQuantity} ر.س</span>
                                </div>
                            </div>
                            {/* Merchant Avatar for Trust */}
                            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--primary-light)', border: '1.5px solid white', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', overflow: 'hidden' }}>
                                {storeProfiles[deal.storeId]?.avatar ? <img src={storeProfiles[deal.storeId].avatar} alt="Merchant" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🏪'}
                            </div>
                        </div>
                        
                        {/* Preparation Time */}
                        <div style={{ background: 'var(--card-bg)', borderRadius: 20, padding: 20, marginBottom: 12, border: '1px solid var(--border-color)' }}>
                            <h3 style={{ fontWeight: 800, marginBottom: 12, fontSize: '0.95rem' }}>{isRTL ? 'وقت تجهيز الطلب بالدقائق' : 'Order Prep Time (Minutes)'}</h3>
                            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                                <input
                                    type="tel"
                                    placeholder={isRTL ? "مثال: 15 دقيقة (أو 0 للاستلام فوراً)" : "e.g. 15 (0 for upon arrival)"}
                                    value={selectedPrepTime === 'arrival' ? '' : selectedPrepTime.replace('min','')}
                                    onChange={(e) => {
                                        const raw = normalizeArabicNumerals(e.target.value).replace(/\D/g, '');
                                        const val = parseInt(raw);
                                        if (isNaN(val) || val < 0) setSelectedPrepTime('arrival');
                                        else setSelectedPrepTime(val + 'min');
                                    }}
                                    style={{ flex: 1, padding: '14px', borderRadius: 14, border: '1.5px solid var(--gray-200)', background: 'var(--body-bg)', fontWeight: 700, fontSize: '0.9rem', outline: 'none', color: 'var(--text-primary)' }}
                                />
                            </div>
                            <div style={{ background: 'rgba(239, 68, 68, 0.15)', padding: '12px', borderRadius: 12, border: '1px solid rgba(239, 68, 68, 0.3)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                                <span style={{ fontSize: '1.2rem' }}>⚠️</span>
                                <p style={{ margin: 0, fontSize: '0.7rem', color: '#991b1b', fontWeight: 700, lineHeight: 1.5 }}>
                                    {isRTL 
                                        ? 'تنبيه: أنت مسؤول عن الحضور بالوقت المحدد. عدم الحضور قد يعرض حجزك للإلغاء.' 
                                        : 'Notice: You are responsible for arriving on time. No-shows may be canceled.'}
                                </p>
                            </div>
                        </div>

                        {/* Notes for Seller */}
                        <div style={{ background: 'var(--card-bg)', borderRadius: 20, padding: 20, marginBottom: 20, border: '1px solid var(--border-color)' }}>
                            <h3 style={{ fontWeight: 800, marginBottom: 12, fontSize: '0.95rem' }}>{isRTL ? 'ملاحظات للتاجر (اختياري)' : 'Notes for Seller (Optional)'}</h3>
                            <textarea
                                value={bookingNotes}
                                onChange={(e) => setBookingNotes(e.target.value)}
                                placeholder={isRTL ? "أضف ملاحظاتك مثل نوع الطلب، تفضيلات معينة..." : "Add your notes here..."}
                                style={{ width: '100%', padding: 14, borderRadius: 14, border: '1.5px solid var(--gray-200)', background: 'var(--body-bg)', minHeight: 80, outline: 'none', resize: 'none', fontSize: '0.9rem', color: 'var(--text-primary)' }}
                            />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, padding: 16, background: 'var(--card-bg)', borderRadius: 16, border: '2px solid var(--gray-200)' }}>
                                <span style={{ fontWeight: 800 }}>{isRTL ? 'إجمالي الدفع عند الاستلام:' : 'Pay at Pickup Total:'}</span>
                                <span style={{ fontSize: '1.3rem', fontWeight: 900, color: 'var(--danger)' }}>{deal.discountedPrice * selectedQuantity} ر.س</span>
                        </div>

                        <button onClick={() => { setShowBookingModal(false); handleBooking(); }} style={{ width: '100%', padding: '16px', borderRadius: 16, background: 'var(--primary)', color: 'white', fontWeight: 900, fontSize: '1.1rem', border: 'none', cursor: 'pointer', boxShadow: '0 8px 20px var(--primary-glow)' }}>
                            {isRTL ? 'تأكيد الحجز النهائي ✅' : 'Confirm Final Booking ✅'}
                        </button>
                    </div>
                </div>
            )}
            <BottomNav />
        </div>
    );
};

export default DealDetails;
