import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useParams, useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useBooking } from '../hooks/useBooking';
import { dealService } from '../services/dealService';
import { getLocation, REGIONS, CITIES } from '../data/mock';
import { SellerTopBar } from '../components/SellerTopBar';
import BottomNav from '../components/BottomNav';
import BarcodeVisual from '../utils/BarcodeVisual';
import { normalizeArabicNumerals, openExternalUrl, resolveDealLocation, isDealComingSoon, formatComingSoonRemaining, dealLifespanStart, getAuthenticityBadge, getDistance } from '../utils/helpers';
import { getShopStatus, statusPill, todayHoursLabel, weekHoursLines, fmtDuration, fmtClock, CLOSING_SOON_MIN } from '../utils/workingHours';

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

    // A cancelled order is terminal: fill the whole rail and paint it RED
    // with ✕ marks instead of a green ✓ sitting on "Confirmed" (Nasser:
    // "when cancelled the green bar should turn red with an X at Received
    // — that looks better").
    const isCancelled = status === 'cancelled';
    const currentIndex = isCancelled ? steps.length - 1 : getStatusIndex(status);
    const lineColor = isCancelled ? '#ef4444' : 'var(--primary)';
    const glow = isCancelled ? '0 0 10px rgba(239,68,68,0.45)' : '0 0 10px var(--primary-glow)';
    const mark = isCancelled ? '✕' : '✓';

    // Node centres sit at (2i+1)/(2N) of the row. Inset the rail to the
    // first/last node centre so the fill ends EXACTLY on the active node
    // instead of overshooting past it (Nasser: "why is there an extra
    // green strip — at Received it must stop").
    const edgePct = 100 / (2 * steps.length);
    const spanPct = 100 - 2 * edgePct;
    const fillPct = (currentIndex / (steps.length - 1)) * spanPct;

    return (
        <div style={{ padding: '24px 16px', background: 'var(--card-bg)', borderRadius: 24, border: '1px solid var(--border-color)', marginBottom: 20, boxShadow: 'var(--shadow-sm)', position: 'relative' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 900, color: 'var(--text-secondary)', marginBottom: 20 }}>
                {isRTL ? 'تتبع حالة الطلب:' : 'Track Order Status:'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
                <div style={{ position: 'absolute', top: 12, left: `${edgePct}%`, right: `${edgePct}%`, height: 4, background: 'var(--gray-100)', borderRadius: 2, zIndex: 0 }} />
                <div style={{
                    position: 'absolute', top: 12,
                    left: isRTL ? 'auto' : `${edgePct}%`,
                    right: isRTL ? `${edgePct}%` : 'auto',
                    width: `${fillPct}%`,
                    height: 4,
                    background: lineColor,
                    borderRadius: 2, zIndex: 1,
                    transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
                    boxShadow: glow
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
                                background: isActive ? lineColor : 'var(--card-bg)',
                                border: isActive ? 'none' : '4px solid var(--gray-100)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'white',
                                fontSize: '0.8rem',
                                transition: 'all 0.3s ease',
                                transform: isActive ? 'scale(1.1)' : 'scale(1)',
                                boxShadow: isCurrent ? glow : 'none'
                            }}>
                                {isActive && mark}
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
    const [imgLoading, setImgLoading] = useState(true);
    // Clamp so a shrunk images[] can never render an out-of-range "4 / 3".
    const idx = Math.min(Math.max(index, 0), Math.max(0, images.length - 1));
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
    React.useEffect(() => { reset(); setImgError(false); setImgLoading(true); }, [index]);
    // Warm the browser cache for EVERY image the moment the viewer opens, so
    // navigating between them is instant instead of a multi-second black gap
    // (each <img> remount otherwise refetches the full-res photo). v11.35
    React.useEffect(() => {
        images.forEach((src) => { try { const im = new Image(); im.decoding = 'async'; im.src = src; } catch {} });
    }, [images]);

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
                // No fullscreen backdrop-filter: at 0.97 black the blur is
                // invisible anyway, and on iOS it re-rasterised every swipe
                // frame — a major cause of the laggy navigation. v11.35
                background: 'rgba(0,0,0,0.97)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                animation: 'taki-zoom-fade .2s ease-out',
                overflow: 'hidden'
            }}
        >
            <style>{`@keyframes taki-zoom-fade{from{opacity:0}to{opacity:1}}@keyframes taki-spin{to{transform:rotate(360deg)}}`}</style>

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
                {idx + 1} / {images.length}
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
                        href={images[idx]}
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
                    key={images[idx]}
                    src={images[idx]}
                    alt=""
                    onError={() => { setImgError(true); setImgLoading(false); }}
                    onLoad={() => setImgLoading(false)}
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
                        // the finger in real-time. Snappier 0.13s settle on release
                        // so flicking through images feels instant. (v11.99)
                        transition: (lastTouchDist.current || isSwiping) ? 'none' : 'transform 0.13s cubic-bezier(0.33,0,0.2,1)',
                        cursor: scale > 1 ? 'grab' : 'zoom-in',
                        userSelect: 'none', touchAction: 'none',
                        boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
                        background: 'rgba(80, 80, 90, 0.2)'
                    }}
                />
            )}

            {/* Loading spinner — so navigation never looks like a dead black
                screen while the next photo decodes (v11.35). */}
            {!imgError && imgLoading && (
                <div
                    onClick={(e) => e.stopPropagation()}
                    aria-hidden="true"
                    style={{
                        position: 'absolute', width: 46, height: 46, borderRadius: '50%',
                        border: '3px solid rgba(255,255,255,0.22)', borderTopColor: '#fff',
                        animation: 'taki-spin 0.8s linear infinite', pointerEvents: 'none',
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
        deals, user, addRating, updateRating, addReply, toggleRatingLike, removeRating, updateDeal, updateDealStock, language, toggleFollowMerchant, followedMerchants,
        customAlert, customConfirm, bookings, acknowledgeBooking, completeBooking: ctxCompleteBooking,
        storeProfiles, liveLocation
    } = useApp();
    const { bookDeal, isBooked } = useBooking();

    const [reviewScore, setReviewScore] = useState(5);
    const [reviewComment, setReviewComment] = useState('');
    const [showReviewForm, setShowReviewForm] = useState(false);
    const [currentImage, setCurrentImage] = useState(0);
    const [selectedQuantity, setSelectedQuantity] = useState(1);
    // v12.91 — الفرع المختار للعرض متعدد المواقع (من رابط حولي ?loc= أو الأقرب).
    const [selectedLocId, setSelectedLocId] = useState<string>(() => queryParams.get('loc') || '');
    const [selectedPrepTime, setSelectedPrepTime] = useState('arrival');
    const [bookingNotes, setBookingNotes] = useState('');
    const [showBookingModal, setShowBookingModal] = useState(false);
    // v12.66 — «اختيارات لكل قطعة»: كل قطعة محجوزة لها اختياراتها المستقلة
    // (برغر ١ بدون جبنة، برغر ٢ بجبنة — علم كبير ١ أحمر، علم كبير ٢ أزرق).
    // البنية: {مفتاح القطعة → {قسم → {خيار → 1}}}. مفتاح القطعة يشتق من
    // النسخة وترتيبها (vid#i) أو من الكمية للعروض بلا نسخ (q#i).
    // v12.60 — الخيار قد يحمل «سعراً إضافياً» يدخل في مبلغ الحجز لكل قطعة.
    const [pieceOpt, setPieceOpt] = useState<Record<string, Record<string, Record<string, 1>>>>({});
    // v12.61-64 — «نسخ المنتج»: اختيار متعدد بكميات (٣ صغير + ١ كبير) —
    // varSel {نسخة → كمية} يدخل كله في مبلغ الحجز، وfocus يحدد السعر
    // والصورة المعروضين أعلى الصفحة (آخر نسخة لمسها المشتري).
    const [varSel, setVarSel] = useState<Record<string, number>>({});
    const [focusVariantId, setFocusVariantId] = useState<string | null>(null);
    const [manualCode, setManualCode] = useState('');
    const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
    const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
    const [zoomOpen, setZoomOpen] = useState(false);
    const [ticketCollapsed, setTicketCollapsed] = useState(false);
    const [, setNowTick] = useState(0);

    // prepTimeOptions removed, dynamically typed now

    const isRTL = language === 'ar';
    const deal = deals.find(d => d.id === id);

    // v12.53 — عند فتح ورقة الحجز لعرضٍ له اختيارات: صفّر الاختيارات
    // (v12.66: البنية صارت لكل قطعة).
    useEffect(() => {
        if (!showBookingModal || !deal?.options?.length) return;
        setPieceOpt({});
    }, [showBookingModal, deal?.id, deal?.options?.length]);

    // v12.64 — نسخ المنتج: اختيار متعدد بكميات. focusVariant (آخر ما لمسه
    // المشتري — الأولى افتراضياً) يقود السعر الكبير والشطب والصورة، بينما
    // varSel يجمع كل النسخ المختارة بكمياتها في مبلغ الحجز.
    const variants = deal?.variants || [];
    const focusVariant = variants.length ? (variants.find(v => v.id === focusVariantId) || variants[0]) : undefined;
    const unitPrice = focusVariant ? focusVariant.price : (deal?.discountedPrice || 0);
    // v12.62 — لكل نسخة سعرها الأصلي وخصمها الخاص
    const unitOriginal = (focusVariant?.originalPrice && focusVariant.originalPrice > 0)
        ? focusVariant.originalPrice
        : (deal?.originalPrice || 0);
    const unitDiscountPct = unitOriginal > unitPrice && unitOriginal > 0
        ? Math.round(((unitOriginal - unitPrice) / unitOriginal) * 100)
        : (deal?.discountPercentage || 0);
    /** مجموع القطع المختارة من كل النسخ */
    const variantPiecesTotal = variants.length
        ? Object.values(varSel).reduce((s, q) => s + (q || 0), 0)
        : 0;
    /** مجموع مبالغ النسخ المختارة (سعر كل نسخة × كميتها) */
    const variantMoneyTotal = variants.length
        ? Math.round(variants.reduce((s, v) => s + (varSel[v.id] || 0) * v.price, 0) * 100) / 100
        : 0;

    // v12.91 — مواقع العرض المتعددة: الفرع المختار يحدّد مخزونه (per_location)
    // والاتجاهات، ويُمرَّر مع الحجز ليُخصم من مخزون ذلك الفرع.
    const dealLocations = (deal?.locations && deal.locations.length > 1) ? deal.locations : null;
    const perLocationQty = deal?.locQtyMode === 'per_location';
    // v12.93 — عرض عالمي احترافي: نحسب مسافة كل فرع من موقع المشتري ونرتّبها
    // «الأقرب أولاً»، ونعرض «متوفر» للفرع المفتوح (بلا سقف كمية).
    const sortedLocations = React.useMemo(() => {
        if (!dealLocations) return null;
        const uLat = liveLocation?.lat, uLng = liveLocation?.lng;
        const withDist = dealLocations.map(l => {
            const known = l.locationId ? getLocation(l.locationId) : undefined;
            const lat = known?.lat ?? l.lat;
            const lng = known?.lng ?? l.lng;
            const distance = (uLat != null && uLng != null && lat != null && lng != null)
                ? getDistance(uLat, uLng, lat, lng) : null;
            return { ...l, distance };
        });
        return withDist.sort((a, b) => {
            if (a.distance == null && b.distance == null) return 0;
            if (a.distance == null) return 1;
            if (b.distance == null) return -1;
            return a.distance - b.distance;
        });
    }, [dealLocations, liveLocation?.lat, liveLocation?.lng]);
    const activeLoc = dealLocations
        ? (dealLocations.find(l => l.id === selectedLocId) || dealLocations[0])
        : null;
    React.useEffect(() => {
        if (!deal?.locations || deal.locations.length <= 1) return;
        // بلا ?loc= صريح → اختر الأقرب تلقائياً؛ وإلا تحقّق من صلاحية المختار.
        if (!deal.locations.some(l => l.id === selectedLocId)) {
            const nearest = sortedLocations && sortedLocations[0];
            setSelectedLocId((nearest?.id) || deal.locations[0].id);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deal?.id, sortedLocations]);

    // v12.66 — قائمة «القطع» المحجوزة: قطعة لكل وحدة من كل نسخة مختارة
    // (علم كبير ١، علم كبير ٢، علم صغير ١…)، أو حسب الكمية للعروض بلا نسخ.
    // كل قطعة تحمل اختياراتها الخاصة في ورقة الحجز.
    const bookingPieces = useMemo(() => {
        if (!deal?.options?.length) return [] as Array<{ key: string; label: string }>;
        const out: Array<{ key: string; label: string }> = [];
        if (variants.length) {
            for (const v of variants) {
                const q = varSel[v.id] || 0;
                for (let i = 0; i < q; i++) {
                    out.push({ key: `${v.id}#${i}`, label: q > 1 ? `${v.label} ${i + 1}` : v.label });
                }
            }
        } else {
            const total = Math.max(1, selectedQuantity);
            for (let i = 0; i < total; i++) {
                out.push({ key: `q#${i}`, label: isRTL ? `القطعة ${i + 1}` : `Item ${i + 1}` });
            }
        }
        return out;
    }, [deal?.options?.length, variants, varSel, selectedQuantity, isRTL]);

    // v12.66 — مجموع الأسعار الإضافية: سعر كل خيار يُحسب لكل قطعة اختارته
    // (جبنة +٣ على برغرين = +٦).
    const optAddOnTotal = useMemo(() => {
        if (!deal?.options?.length || !bookingPieces.length) return 0;
        let sum = 0;
        for (const piece of bookingPieces) {
            const ps = pieceOpt[piece.key];
            if (!ps) continue;
            for (const grp of deal.options) {
                const sel = ps[grp.id];
                if (!sel) continue;
                for (const cid of Object.keys(sel)) {
                    const price = grp.choices.find(c => c.id === cid)?.price || 0;
                    if (price > 0) sum += price;
                }
            }
        }
        return Math.round(sum * 100) / 100;
    }, [deal?.options, pieceOpt, bookingPieces]);
    // فتح عرض جديد: أول نسخة بكمية ١ (سلاسة — بلا رسائل إلزام)
    React.useEffect(() => {
        setFocusVariantId(null);
        const vs = deal?.variants;
        setVarSel(vs?.length ? { [vs[0].id]: 1 } : {});
    }, [deal?.id]);
    React.useEffect(() => {
        const ii = focusVariant?.imageIndex;
        if (typeof ii === 'number' && deal?.images && ii >= 0 && ii < deal.images.length) {
            setCurrentImage(ii);
        }
    }, [focusVariant?.id]);
    // الكمية الإجمالية للحجز = مجموع قطع النسخ — فتمر تلقائياً عبر فحوصات
    // «حدود الحجز للمشتري» (maxPerBooking…) القائمة.
    React.useEffect(() => {
        if (variants.length && variantPiecesTotal > 0) setSelectedQuantity(variantPiecesTotal);
    }, [variantPiecesTotal, variants.length]);

    /** أساس المبلغ: مجموع النسخ المختارة، أو سعر العرض × الكمية للعروض العادية */
    const baseTotal = Math.round((variants.length ? variantMoneyTotal : unitPrice * selectedQuantity) * 100) / 100;
    /** مبلغ الحجز النهائي شاملاً الإضافات */
    const bookingTotal = deal
        ? Math.round((baseTotal + optAddOnTotal) * 100) / 100
        : 0;

    // v12.81 — الدفع المباشر لحساب التاجر (0% عمولة): وضع طرق دفع تاجر هذا
    // العرض ('cod' افتراضاً — «ادفع الآن» يظهر فقط لتاجر فعّل بوابته واختبرها).
    // القاعدة تتكفل بالسقوط التلقائي لعند الاستلام إذا تعطلت بوابة تاجرٍ
    // وضعُه «إلكتروني فقط».
    const [payMode, setPayMode] = useState<'cod' | 'online' | 'both'>('cod');
    const [payChoice, setPayChoice] = useState<'cod' | 'online'>('cod');
    useEffect(() => {
        if (!showBookingModal || !deal?.storeId) return;
        let alive = true;
        (async () => {
            try {
                const { supabase } = await import('../services/supabaseClient');
                const { data } = await supabase.rpc('deal_payment_mode', { p_store_id: deal.storeId });
                if (!alive) return;
                const m = data === 'online' || data === 'both' ? data : 'cod';
                setPayMode(m);
                setPayChoice(m === 'online' ? 'online' : 'cod');
            } catch { /* عند أي فشل يبقى الافتراضي الآمن: الدفع عند الاستلام */ }
        })();
        return () => { alive = false; };
    }, [showBookingModal, deal?.storeId]);

    // إنشاء الدفعة يتم في Edge Function (تفك سر التاجر من Vault وتنشئ الدفعة
    // على حسابه) — حفظ الحجز fire-and-forget فنعيد المحاولة حتى يصل صفه للقاعدة.
    const payForBooking = async (barcode: string) => {
        const { supabase } = await import('../services/supabaseClient');
        const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                const { data, error } = await supabase.functions.invoke('merchant-pay', {
                    body: { op: 'create', barcode, lang: isRTL ? 'ar' : 'en' },
                });
                let payload: any = data;
                if (error) {
                    try { payload = await (error as any).context?.json?.(); } catch { /* non-JSON */ }
                }
                if (payload?.url) {
                    window.location.href = payload.url;
                    return;
                }
                if (payload?.error === 'BOOKING_NOT_FOUND') {
                    await sleep(900);
                    continue;
                }
                throw new Error(payload?.error || 'CREATE_FAILED');
            } catch {
                if (attempt < 4) await sleep(900);
            }
        }
        customAlert(isRTL
            ? '⚠️ حجزك مؤكد لكن تعذّر فتح صفحة الدفع الآن — افتح «حجوزاتي» واضغط «ادفع الآن»، أو ادفع عند الاستلام.'
            : '⚠️ Your booking is confirmed but the payment page failed to open — use "Pay now" from My Bookings, or pay at pickup.');
        history.push('/bookings');
    };

    // v12.66 — أُلغي ربط v12.54 (مجموع كميات الاختيارات = الكمية): الكمية
    // تُضبط من عدّاد الكمية/عدّادات النسخ، وكل قطعة تختار إضافاتها بنفسها.

    // Tick once a second so the on-image countdown badge updates live.
    React.useEffect(() => {
        const id = setInterval(() => setNowTick(t => t + 1), 1000);
        return () => clearInterval(id);
    }, []);
    const isSeller = user?.userType === 'seller';
    const isOwner = isSeller && user?.id === deal?.storeId;
    const isFollowed = deal ? followedMerchants.includes(deal.storeId) : false;

    // Find the user's CURRENT booking for this deal (or the one linked
    // from a notification). Uses the SAME "still live" rule as
    // useBooking: a `cancelled` booking — or a pending/acknowledged one
    // past its effective 2h hold — is NOT active and must never render
    // as "حجز مؤكد". This buyer had 6 terminal bookings on one deal and
    // the old raw .find() surfaced a stale CANCELLED row as "Booking
    // Confirmed" with a fake live timer, blocking the sense that they
    // could re-book. A recently `completed` booking is still surfaced so
    // the receipt + rating box show. When several qualify, newest wins.
    const activeBooking = useMemo(() => {
        if (!deal) return null;
        const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
        const now = Date.now();
        const recencyOf = (b: any) => b.bookedAt || b.createdAt || 0;
        const stillRelevant = (b: any) => {
            if (!b || b.status === 'cancelled') return false;
            if (b.status === 'completed') return true;
            const eff = Math.min(b.expiryTime || 0, recencyOf(b) + TWO_HOURS_MS);
            return eff > now;
        };
        if (linkedBarcode) {
            const b = bookings.find((x: any) => x.barcode === linkedBarcode);
            return b && stillRelevant(b) ? b : null;
        }
        if (user && !isOwner) {
            return bookings
                .filter((b: any) => b.deal.id === deal.id && b.userId === user.id && stillRelevant(b))
                .sort((a: any, b: any) => recencyOf(b) - recencyOf(a))[0] || null;
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

    // Pre-decode every gallery image the moment the deal is known, so tapping a
    // thumbnail/dot swaps the hero INSTANTLY with no per-image fetch+decode lag.
    // (Nasser: «التنقل بين الصور بطيء أريده سريع جداً» — v11.99) */
    React.useEffect(() => {
        const imgs = deal?.images;
        if (!imgs || imgs.length < 2) return;
        imgs.forEach((src) => { try { const im = new Image(); im.decoding = 'async'; im.src = src; } catch { /* ignore */ } });
    }, [deal?.id]);

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

    // Reviews are shown at the STORE level (mirrors StoreDetails): a
    // buyer who reviewed any of this store's deals must see that review
    // on every deal of the same store. Previously this used deal.ratings
    // (per-deal), so opening a different deal of a store you'd reviewed
    // showed "0 reviews / be the first" even though the store had
    // ratings. Each review keeps its own dealId so reply/like/delete
    // route to the correct underlying deal.
    const storeReviews = deals
        .filter(d => d.storeId === deal.storeId)
        .flatMap(d => (d.ratings || []).map(r => ({ ...r, dealId: d.id, itemName: d.itemName })))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const { average, count } = dealService.calculateRating(storeReviews);
    // v11.97 — one rating per STORE per buyer (anti-inflation: a merchant on a
    // buyer account can't keep re-rating). If they already rated, we show that
    // review (it's in the list) + a follow option instead of an add-review form.
    const myStoreReview = user ? storeReviews.find(r => r.userId === user.id) : undefined;
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
    // v11.20 — Coming Soon: the deal is scheduled and not yet live. Buyer
    // can browse the full page (item info, ratings, store profile) but the
    // book CTA is locked until startsAt passes. We tick the countdown live
    // below so the page can flip to "bookable" automatically the moment
    // the timestamp passes without a refresh.
    const isComingSoon = isDealComingSoon(deal);
    // ساعات عمل المحل — مغلق يمنع الحجز، وقرب الإغلاق (<ساعتين) يحذّر قبل التأكيد. v11.77
    const shopWH = (storeProfiles[deal.storeId] as any)?.workingHours;
    const shopStatus = getShopStatus(shopWH);
    const shopClosed = shopStatus.configured && !shopStatus.open;
    const closingSoon = shopStatus.configured && shopStatus.open && (shopStatus.closesInMin ?? 99999) <= CLOSING_SOON_MIN;
    const canBook = !isSoldOut && !isComingSoon && !shopClosed;

    const handleBooking = async () => {
        if (!user) {
            history.push('/register');
            return;
        }
        if (isSoldOut) return;
        // v11.20 — defense in depth. canBook also gates the modal-open click,
        // but if the buyer somehow opens the modal mid-countdown (e.g. the
        // deal flipped while their modal was already mounted on a previous
        // tab) the booking action stays locked until launch.
        if (isComingSoon) return;

        // Working-hours gate (v11.77). Closed → block with the time to opening.
        // Closing in <2h → warn (the buyer must still collect within the window).
        if (shopClosed) {
            customAlert(isRTL
                ? `🔒 المحل مغلق الآن${shopStatus.opensInMin != null ? ` — يفتح بعد ${fmtDuration(shopStatus.opensInMin, true)}` : ''}\nلا يمكنك الحجز إلا بعد أن يفتح المحل.`
                : `🔒 The shop is closed now${shopStatus.opensInMin != null ? ` — opens in ${fmtDuration(shopStatus.opensInMin, false)}` : ''}\nBooking is available once the shop opens.`);
            return;
        }
        if (closingSoon) {
            const ok = await customConfirm(isRTL
                ? `⏰ المحل سيغلق بعد ${fmtDuration(shopStatus.closesInMin!, true)}\nتأكد أنك تستطيع استلام طلبك قبل الإغلاق. هل تريد المتابعة بالحجز؟`
                : `⏰ The shop closes in ${fmtDuration(shopStatus.closesInMin!, false)}\nMake sure you can collect before closing. Continue?`);
            if (!ok) return;
        }

        // v12.28 — حدود التاجر: كمية الحجز الواحد + عدد المرات + مدة الانتظار.
        // تُفرض نهائياً بتريغر في القاعدة (tr_enforce_booking_rules)؛ الفحص هنا
        // يمنع الحجز المتفائل محلياً ويعرض سبباً واضحاً بدل فشل صامت في المزامنة.
        if (deal.maxPerBooking && selectedQuantity > deal.maxPerBooking) {
            customAlert(isRTL
                ? `🛡 حدد التاجر ${deal.maxPerBooking} كحد أقصى للقطع في الحجز الواحد.`
                : `🛡 The merchant allows at most ${deal.maxPerBooking} unit(s) per booking.`);
            return;
        }
        if (deal.maxBookingsPerBuyer || deal.rebookCooldownMinutes) {
            try {
                const { supabase } = await import('../services/supabaseClient');
                const { data: mine } = await supabase
                    .from('bookings')
                    .select('status, completed_at')
                    .eq('deal_id', deal.id)
                    .eq('user_id', user.id);
                const rows = mine || [];
                if (deal.maxBookingsPerBuyer) {
                    const used = rows.filter(b => ['pending', 'acknowledged', 'completed'].includes(b.status)).length;
                    if (used >= deal.maxBookingsPerBuyer) {
                        customAlert(isRTL
                            ? `⛔ وصلت الحد الأقصى لحجوزات هذا العرض (${deal.maxBookingsPerBuyer} لكل عميل) — حدّده التاجر لإتاحة الفرصة للجميع.`
                            : `⛔ You reached this deal's booking limit (${deal.maxBookingsPerBuyer} per customer).`);
                        return;
                    }
                }
                if (deal.rebookCooldownMinutes) {
                    const lastDone = rows
                        .filter(b => b.status === 'completed' && b.completed_at)
                        .map(b => new Date(b.completed_at as string).getTime())
                        .sort((a, b) => b - a)[0];
                    if (lastDone) {
                        const waitMin = Math.ceil((lastDone + deal.rebookCooldownMinutes * 60000 - Date.now()) / 60000);
                        if (waitMin > 0) {
                            customAlert(isRTL
                                ? `⏳ حدد التاجر مدة انتظار بين الحجوزات — يمكنك حجز هذا العرض مرة أخرى بعد ${fmtDuration(waitMin, true)}.`
                                : `⏳ You can book this deal again in ${fmtDuration(waitMin, false)}.`);
                            return;
                        }
                    }
                }
            } catch { /* التريغر في القاعدة يفرض الحدود على أي حال */ }
        }

        // v12.53 — «اختيارات المنتج»: تحقق من الأقسام المطلوبة، ثم ابنِ نص
        // الاختيارات داخل الملاحظات (يراه التاجر في كل الواجهات والبوتات بلا
        // أي تغيير إضافي). v12.60: كل خيار له «سعر إضافي» يظهر في السطر
        // ويدخل في سطر «الإجمالي» — سقوف الكميات أُلغيت.
        let selectedOptions: Array<{ g: string; c: string; qty?: number }> | undefined;
        let notesWithOptions = bookingNotes;

        // v12.64 — نسخ المنتج: لا حجز بلا قطعة واحدة على الأقل، وكل نسخة
        // مسقوفة بكميتها المتاحة.
        if (variants.length) {
            if (variantPiecesTotal <= 0) {
                customAlert(isRTL
                    ? '🧬 اختر مقاساً واحداً على الأقل (اضغط «+ أضف» على المقاس المطلوب).'
                    : '🧬 Pick at least one version (tap "+ Add" on the size you want).');
                return;
            }
            const over = variants.find(v => typeof v.qty === 'number' && (varSel[v.id] || 0) > v.qty);
            if (over) {
                customAlert(isRTL
                    ? `⛔ المتاح من «${over.label}» ${over.qty} فقط — خفّف الكمية.`
                    : `⛔ Only ${over.qty} available in "${over.label}".`);
                return;
            }
        }

        // v12.66/v12.87 — «اختيارات لكل قطعة» + عرض مجمّع واضح (طلب ناصر):
        // (أ) نتحقق أن الأقسام المطلوبة مختارة لكل قطعة، (ب) نبني selected_options
        // المهيكل للقاعدة/البوتات (qty = عدد القطع التي اختارت الخيار — بلا تغيير)،
        // (ج) نص «تفاصيل الطلب» حيث كل نوع/صنف تحته اختياراته مباشرة بدل فصل
        // «كل المواصفات» عن «كل الاختيارات» (كان يسبّب لخبطة).
        if (deal.options?.length) {
            for (const grp of deal.options) {
                if (!grp.required) continue;
                const missing = bookingPieces.find(p => Object.keys(pieceOpt[p.key]?.[grp.id] || {}).length === 0);
                if (missing) {
                    customAlert(isRTL
                        ? (bookingPieces.length > 1
                            ? `🧩 اختر «${grp.title}» لكل قطعة — ناقص في «${missing.label}».`
                            : `🧩 اختر «${grp.title}» أولاً لإتمام الحجز.`)
                        : (bookingPieces.length > 1
                            ? `🧩 Please choose "${grp.title}" for every item — missing on "${missing.label}".`
                            : `🧩 Please choose "${grp.title}" first.`));
                    return;
                }
            }
            const agg = new Map<string, { g: string; c: string; qty: number }>();
            for (const piece of bookingPieces) {
                const ps = pieceOpt[piece.key] || {};
                for (const grp of deal.options) {
                    for (const cid of Object.keys(ps[grp.id] || {})) {
                        if (!grp.choices.find(c => c.id === cid)) continue;
                        const k = `${grp.id}|${cid}`;
                        const prev = agg.get(k);
                        if (prev) prev.qty += 1; else agg.set(k, { g: grp.id, c: cid, qty: 1 });
                    }
                }
            }
            if (agg.size) selectedOptions = Array.from(agg.values());
        }

        // اختيارات قطعة واحدة كنصوص «العنوان: الاختيار (+سعر)»
        const pieceParts = (pieceKey: string): string[] => {
            const ps = pieceOpt[pieceKey] || {};
            const parts: string[] = [];
            for (const grp of (deal.options || [])) {
                const chosen = Object.keys(ps[grp.id] || {});
                if (!chosen.length) continue;
                const labels: string[] = [];
                for (const cid of chosen) {
                    const choice = grp.choices.find(c => c.id === cid);
                    if (!choice) continue;
                    const priceTag = (choice.price || 0) > 0 ? ` (+${choice.price} ${isRTL ? 'ر.س' : 'SAR'})` : '';
                    labels.push(`${choice.label}${priceTag}`);
                }
                if (labels.length) parts.push(`${grp.title}: ${labels.join('، ')}`);
            }
            return parts;
        };

        // v12.65 — النسخ المختارة تُمرَّر مهيكلة في selected_options بوسم
        // g='__variant__' — حارس القاعدة يخصمها من كمية كل نسخة (المتاح).
        if (variants.length && variantPiecesTotal > 0) {
            const ventries = variants
                .filter(v => (varSel[v.id] || 0) > 0)
                .map(v => ({ g: '__variant__', c: v.id, qty: varSel[v.id] }));
            selectedOptions = [...(selectedOptions || []), ...ventries];
        }

        // v12.87 — «تفاصيل الطلب» المجمّعة: كل نوع/صنف تحته اختياراته مباشرة،
        // ثم ملاحظة المشتري، ثم سطر الإجمالي — يصل موحّداً لكل واجهات التاجر والبوتات.
        const detailLines: string[] = [];
        if (variants.length && variantPiecesTotal > 0) {
            for (const v of variants) {
                const q = varSel[v.id] || 0;
                if (q <= 0) continue;
                detailLines.push(`• ${v.label} ×${q} (${v.price} ${isRTL ? 'ر.س' : 'SAR'})`);
                for (let i = 0; i < q; i++) {
                    const parts = pieceParts(`${v.id}#${i}`);
                    if (!parts.length) continue;
                    const prefix = q > 1 ? `   ↳ (${i + 1}) ` : '   ↳ ';
                    for (const p of parts) detailLines.push(`${prefix}${p}`);
                }
            }
        } else if (deal.options?.length) {
            for (const piece of bookingPieces) {
                const parts = pieceParts(piece.key);
                if (!parts.length) continue;
                if (bookingPieces.length > 1) {
                    detailLines.push(`▪️ ${piece.label}:`);
                    for (const p of parts) detailLines.push(`   ↳ ${p}`);
                } else {
                    for (const p of parts) detailLines.push(`↳ ${p}`);
                }
            }
        }
        if (detailLines.length) {
            const detailText = `📦 ${isRTL ? 'تفاصيل الطلب' : 'Order details'}:\n${detailLines.join('\n')}`;
            notesWithOptions = bookingNotes.trim() ? `${detailText}\n\n📝 ${bookingNotes}` : detailText;
        }
        if ((variants.length && variantPiecesTotal > 0) || optAddOnTotal > 0) {
            const detail = optAddOnTotal > 0
                ? (isRTL ? ` (${baseTotal} + ${optAddOnTotal} إضافات)` : ` (${baseTotal} + ${optAddOnTotal} extras)`)
                : '';
            const tLine = `💰 ${isRTL ? `الإجمالي: ${bookingTotal} ر.س` : `Total: ${bookingTotal} SAR`}${detail}`;
            notesWithOptions = notesWithOptions.trim() ? `${notesWithOptions}\n${tLine}` : tLine;
        }


        // v12.91 — العرض متعدد المواقع: حارس مخزون الفرع المختار (per_location).
        if (perLocationQty && activeLoc && typeof activeLoc.quantity === 'number' && selectedQuantity > activeLoc.quantity) {
            customAlert(isRTL
                ? `⛔ المتاح في «${activeLoc.name || 'هذا الفرع'}» ${activeLoc.quantity} فقط — قلّل الكمية أو اختر فرعاً آخر.`
                : `⛔ Only ${activeLoc.quantity} available at "${activeLoc.name || 'this branch'}".`);
            return;
        }

        // bookDeal in AppContext: persists to Supabase and notifies both parties.
        const newBooking = bookDeal(deal, selectedQuantity, user.id, selectedPrepTime, notesWithOptions, selectedOptions, dealLocations ? (activeLoc?.id || null) : null);

        // Reserve quantity only when the seller set a real stock cap.
        // Time-based offers stay infinitely bookable until the timer ends.
        // Use updateDealStock (partial UPDATE on quantity only) so we don't
        // re-write the `status` column — the v9.1 trigger blocks any
        // implicit-status write when the merchant's subscription isn't
        // active, and that previously took booking down with it.
        if (hasStockCap && deal.quantity !== 'unlimited') {
            updateDealStock(deal.id, (deal.quantity as number) - selectedQuantity);
        }

        // v12.81 — المشتري اختار الدفع الإلكتروني: الحجز يبقى كما هو، ثم
        // نفتح صفحة الدفع المستضافة على حساب تاجر هذا العرض مباشرة.
        if (payChoice === 'online' && payMode !== 'cod' && newBooking?.barcode) {
            customAlert(isRTL
                ? '✅ تم تأكيد الحجز — جاري تحويلك لصفحة الدفع الآمنة…'
                : '✅ Booking confirmed — taking you to the secure payment page…');
            payForBooking(newBooking.barcode);
            return;
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
        // v12.30 — one rating per store, but it's EDITABLE: if the buyer
        // already rated this store, saving UPDATES that rating in place
        // (a merchant product-swap can't freeze an old favourable rating).
        const editing = !!(myStoreReview && myStoreReview.id);
        const ok = editing
            ? await updateRating(myStoreReview!.dealId, myStoreReview!.id!, { score: reviewScore, comment: reviewComment })
            : await addRating(deal.id, { score: reviewScore, comment: reviewComment });
        setSubmittingReview(false);
        if (ok === 'duplicate') {
            setShowReviewForm(false);
            customAlert(isRTL
                ? 'لقد قيّمت هذا المتجر سابقاً — اضغط «تعديل تقييمك» لتحديثه.'
                : 'You already rated this store — tap “Edit your rating” to update it.');
            return;
        }
        if (!ok) {
            customAlert(isRTL
                ? '❌ تعذّر إرسال التقييم. تحقق من الاتصال وحاول مرة أخرى.'
                : '❌ Could not submit review. Check your connection and try again.');
            return;
        }
        setShowReviewForm(false);
        setReviewComment('');
        customAlert(editing
            ? (isRTL ? '✅ تم تحديث تقييمك بنجاح!' : '✅ Your review was updated!')
            : (isRTL ? '✅ تم إرسال تقييمك — شكراً لمشاركتك!' : '✅ Review submitted — thanks for sharing!'));
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
                    width={800} height={400}
                    className="deal-hero-img"
                    onClick={() => setZoomOpen(true)}
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
                    -{unitDiscountPct}%
                </div>
                {/* Live countdown — same compact badge as the home-feed card.
                    v11.20: switches to a Coming-Soon countdown when the deal
                    hasn't launched yet (counts to startsAt, not expiry, and
                    turns solid red inside the final 4 hours). */}
                {(() => {
                    const cs = isComingSoon
                        ? formatComingSoonRemaining(deal.startsAt!, isRTL)
                        : null;
                    const remaining = cs
                        ? { text: cs.text, urgent: cs.urgent, expired: false }
                        : formatRemaining(dealLifespanStart(deal), deal.expiresInMinutes || 0, isRTL);
                    return (
                        <div style={{
                            position: 'absolute',
                            bottom: 12,
                            [isRTL ? 'right' : 'left']: 12,
                            background: remaining.expired
                                ? 'rgba(100,116,139,0.92)'
                                : isComingSoon && remaining.urgent
                                    ? 'linear-gradient(135deg, #dc2626, #b91c1c)'
                                    : isComingSoon
                                        ? 'linear-gradient(135deg, #6366f1, #4f46e5)'
                                        : remaining.urgent
                                            ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
                                            : 'rgba(15,23,42,0.78)',
                            color: 'white',
                            padding: '6px 12px',
                            borderRadius: 10,
                            fontSize: '0.85rem',
                            fontWeight: 900,
                            backdropFilter: 'blur(8px)',
                            boxShadow: (remaining.urgent || isComingSoon) ? '0 2px 10px rgba(99,102,241,0.45)' : '0 2px 6px rgba(0,0,0,0.25)',
                            animation: remaining.urgent && !remaining.expired ? 'pulse 1.4s ease-in-out infinite' : 'none',
                            display: 'flex', alignItems: 'center', gap: 6
                        } as React.CSSProperties}>
                            <span>{remaining.expired ? '⏹' : isComingSoon ? '⏳' : '⏱'}</span>
                            <span>{remaining.text}</span>
                        </div>
                    );
                })()}
                {/* v11.20 — Coming Soon big lock chip overlaying the hero image.
                    Mirrors the card-level overlay so the buyer knows instantly
                    they can browse but not book yet. */}
                {isComingSoon && (
                    <div style={{
                        position: 'absolute', inset: 0,
                        background: 'linear-gradient(135deg, rgba(15,23,42,0.42) 0%, rgba(15,23,42,0.10) 50%, rgba(15,23,42,0.55) 100%)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        pointerEvents: 'none'
                    }}>
                        <div style={{
                            background: 'rgba(15,23,42,0.82)',
                            backdropFilter: 'blur(10px)',
                            color: 'white',
                            padding: '14px 22px',
                            borderRadius: 18,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            fontSize: '1rem',
                            fontWeight: 900,
                            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                            border: '2px solid rgba(255,255,255,0.18)'
                        }}>
                            <span style={{ fontSize: '1.8rem', lineHeight: 1 }}>🔒</span>
                            <div>
                                <div style={{ fontSize: '0.95rem', fontWeight: 900 }}>{isRTL ? 'عرض قادم — مغلق حالياً' : 'Coming soon — locked'}</div>
                                <div style={{ fontSize: '0.78rem', fontWeight: 700, opacity: 0.85, marginTop: 2 }}>{isRTL ? 'تابع العد التنازلي للحجز' : 'Booking opens at launch'}</div>
                            </div>
                        </div>
                    </div>
                )}
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

                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: variants.length ? 10 : 16 }}>
                        <span style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--danger)', transition: 'all 0.2s ease' }}>{unitPrice} ر.س</span>
                        <span style={{ fontSize: '1rem', color: 'var(--gray-400)', textDecoration: 'line-through' }}>{unitOriginal} ر.س</span>
                        {unitOriginal - unitPrice > 0 && (
                            <span style={{ background: 'var(--gray-100)', color: 'var(--primary)', padding: '3px 10px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 800 }}>
                                {isRTL ? `وفّر ${Math.round((unitOriginal - unitPrice) * 100) / 100} ر.س` : `Save ${Math.round((unitOriginal - unitPrice) * 100) / 100} SAR`}
                            </span>
                        )}
                    </div>

                    {/* v12.64 — نسخ المنتج: اختيار متعدد بعدّادات (طلب ناصر: ٣ صغير
                        + ١ كبير في نفس الحجز) — كل صف: اسم + سعر + المتاح + عدّاد
                        +/−، ولمس أي صف يجعل سعره وصورته هما المعروضين أعلاه. */}
                    {variants.length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ fontSize: '0.95rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                                🧬 {isRTL ? 'اختر النوع أو الحجم' : 'Choose type or size'}
                            </div>
                            {variants.map(v => {
                                const q = varSel[v.id] || 0;
                                const picked = q > 0;
                                const cap = typeof v.qty === 'number' ? v.qty : undefined;
                                // سعر النسخة الأصلي المشطوب — سعرها الخاص إن وُجد وإلا سعر العرض
                                const vOriginal = (v.originalPrice && v.originalPrice > 0) ? v.originalPrice : (deal.originalPrice || 0);
                                const setQ = (next: number) => {
                                    const capped = cap !== undefined ? Math.min(next, cap) : next;
                                    setFocusVariantId(v.id);
                                    setVarSel(prev => {
                                        const cur = { ...prev };
                                        if (capped <= 0) delete cur[v.id]; else cur[v.id] = capped;
                                        return cur;
                                    });
                                };
                                return (
                                    <div key={v.id}
                                        role="checkbox"
                                        aria-checked={picked}
                                        tabIndex={0}
                                        onClick={() => { setFocusVariantId(v.id); if (!picked) setQ(1); }}
                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFocusVariantId(v.id); if (!picked) setQ(1); } }}
                                        className={`taki-variant-row${picked ? ' picked' : ''}`}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <span style={{ fontWeight: 900, fontSize: '1.02rem', color: 'var(--text-primary)' }}>{v.label}</span>
                                            <span style={{ fontWeight: 900, fontSize: '0.92rem', color: picked ? 'var(--primary)' : 'var(--text-secondary)', marginInlineStart: 10 }}>{v.price} ر.س</span>
                                            {vOriginal > v.price && (
                                                <span style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--gray-400)', textDecoration: 'line-through', marginInlineStart: 7 }}>{vOriginal} ر.س</span>
                                            )}
                                            {cap !== undefined && (
                                                <div style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-secondary)', marginTop: 4 }}>
                                                    {isRTL ? `المتاح: ${cap}` : `Available: ${cap}`}
                                                </div>
                                            )}
                                        </div>
                                        {picked ? (
                                            <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                <button type="button" onClick={() => setQ(q - 1)}
                                                    aria-label={isRTL ? `تقليل ${v.label}` : `Decrease ${v.label}`}
                                                    style={{ width: 38, height: 38, borderRadius: '50%', border: '1.5px solid var(--border-color)', background: 'var(--card-bg)', color: 'var(--text-primary)', fontWeight: 900, fontSize: '1.15rem', lineHeight: 1, cursor: 'pointer' }}>−</button>
                                                <span style={{ fontWeight: 900, fontSize: '1.05rem', minWidth: 24, textAlign: 'center', color: 'var(--text-primary)' }}>{q}</span>
                                                <button type="button" onClick={() => setQ(q + 1)}
                                                    disabled={cap !== undefined && q >= cap}
                                                    aria-label={isRTL ? `زيادة ${v.label}` : `Increase ${v.label}`}
                                                    style={{ width: 38, height: 38, borderRadius: '50%', border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 900, fontSize: '1.15rem', lineHeight: 1, cursor: 'pointer', opacity: cap !== undefined && q >= cap ? 0.4 : 1 }}>+</button>
                                            </div>
                                        ) : (
                                            <span style={{ fontSize: '0.86rem', fontWeight: 900, color: 'var(--primary)', flexShrink: 0, padding: '6px 12px', borderRadius: 10, border: '1.5px solid var(--primary)', background: 'var(--notif-unread-bg)' }}>
                                                {isRTL ? '+ أضف' : '+ Add'}
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                            {/* ملخص حي للمختار — يطمئن المشتري قبل زر الحجز */}
                            {variantPiecesTotal > 0 && (
                                <div style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--primary)', marginTop: 2, lineHeight: 1.6 }}>
                                    🧺 {variants.filter(v => (varSel[v.id] || 0) > 0).map(v => `${v.label} ×${varSel[v.id]}`).join(' + ')}
                                    {' = '}{variantMoneyTotal} {isRTL ? 'ر.س' : 'SAR'}
                                </div>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ background: 'var(--secondary-light)', color: 'var(--secondary)', padding: '6px 14px', borderRadius: 10, fontSize: '0.8rem', fontWeight: 800 }}>
                            ★ {average > 0 ? average : (isRTL ? 'جديد' : 'New')} {count > 0 && `(${count} ${isRTL ? 'تعليق' : 'reviews'})`}
                        </span>
                        {/* Authenticity badge from buyer real/fake votes. v11.97 */}
                        {(() => {
                            const ab = getAuthenticityBadge(deal.authReal, deal.authFake, isRTL);
                            if (!ab.show) return null;
                            return (
                                <span style={{ background: ab.bg, color: ab.color, padding: '6px 14px', borderRadius: 10, fontSize: '0.8rem', fontWeight: 900 }}>
                                    {ab.label} <span style={{ opacity: 0.7, fontWeight: 700 }}>({ab.total} {isRTL ? 'صوت' : 'votes'})</span>
                                </span>
                            );
                        })()}
                        <span style={{ background: 'var(--gray-100)', padding: '6px 14px', borderRadius: 10, fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                            📦 {(() => {
                                // v12.91 — كمية الفرع المختار عند «كمية لكل موقع»
                                if (perLocationQty && activeLoc && typeof activeLoc.quantity === 'number') {
                                    return activeLoc.quantity > 0
                                        ? (isRTL ? `${activeLoc.quantity} متبقي في ${activeLoc.name || 'الفرع'}` : `${activeLoc.quantity} left at ${activeLoc.name || 'branch'}`)
                                        : (isRTL ? 'نفذت في هذا الفرع' : 'Sold out here');
                                }
                                if (deal.quantity === 'unlimited') return isRTL ? 'كمية لا محدودة' : 'Unlimited quantity';
                                if (typeof deal.quantity === 'number' && deal.quantity > 0) return isRTL ? `${deal.quantity} متبقي` : `${deal.quantity} left`;
                                if (!hasStockCap) return isRTL ? '⏱ عرض زمني' : '⏱ Time-limited';
                                return isRTL ? 'نفذت الكمية' : 'Sold Out';
                            })()}
                        </span>
                        {deal.size && <span style={{ background: 'var(--gray-100)', padding: '6px 14px', borderRadius: 10, fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)' }}>👕 {deal.size}</span>}
                    </div>

                    {/* v12.91 — منتقي الفرع: العرض متوفر في عدة مواقع، يختار المشتري
                        الأقرب/المناسب له فيتحدّث المخزون والاتجاهات والحجز على أساسه. */}
                    {dealLocations && (
                        <div style={{ marginTop: 16 }}>
                            <div style={{ fontSize: '0.95rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                                📍 {isRTL ? `متوفر في ${dealLocations.length} مواقع — اختر الأقرب لك` : `Available at ${dealLocations.length} locations — pick one`}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {(sortedLocations || dealLocations).map((l: any, li: number) => {
                                    const picked = (activeLoc?.id === l.id);
                                    const capped = perLocationQty && typeof l.quantity === 'number';
                                    const out = capped && l.quantity <= 0;
                                    const isNearest = !!(sortedLocations && li === 0 && l.distance != null);
                                    const distStr = l.distance != null
                                        ? (l.distance < 1 ? `${Math.round(l.distance * 1000)} ${isRTL ? 'م' : 'm'}` : `${l.distance.toFixed(1)} ${isRTL ? 'كم' : 'km'}`)
                                        : null;
                                    return (
                                        <div key={l.id}
                                            role="radio"
                                            aria-checked={picked}
                                            tabIndex={0}
                                            onClick={() => { if (!out) setSelectedLocId(l.id); }}
                                            onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !out) { e.preventDefault(); setSelectedLocId(l.id); } }}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 14,
                                                cursor: out ? 'not-allowed' : 'pointer', opacity: out ? 0.5 : 1,
                                                border: picked ? '2px solid var(--primary)' : '1.5px solid var(--border-color)',
                                                background: picked ? 'var(--notif-unread-bg)' : 'var(--card-bg)',
                                                WebkitTapHighlightColor: 'transparent',
                                            }}>
                                            <div style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${picked ? 'var(--primary)' : 'var(--border-color)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                {picked && <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--primary)' }} />}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontWeight: 900, fontSize: '0.9rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                                    {l.name || (isRTL ? 'فرع' : 'Branch')}
                                                    {isNearest && <span style={{ fontSize: '0.6rem', fontWeight: 900, color: '#fff', background: 'var(--primary)', padding: '2px 8px', borderRadius: 999 }}>{isRTL ? '📍 الأقرب' : '📍 Nearest'}</span>}
                                                </div>
                                                <div style={{ fontSize: '0.72rem', fontWeight: 800, marginTop: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                                    {distStr && <span style={{ color: 'var(--primary)' }}>🚗 {distStr}</span>}
                                                    <span style={{ color: out ? 'var(--danger)' : capped ? 'var(--text-secondary)' : 'var(--success)' }}>
                                                        {out ? (isRTL ? 'نفذت الكمية' : 'Sold out')
                                                            : capped ? (isRTL ? `المتاح: ${l.quantity}` : `Available: ${l.quantity}`)
                                                            : (isRTL ? '✅ متوفر' : '✅ Available')}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
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

                {/* Working hours (ساعات عمل المحل) — status + today + full week */}
                {shopStatus.configured && (() => {
                    const pill = statusPill(shopWH, isRTL);
                    const bg = pill.tone === 'open' ? 'rgba(16,185,129,0.12)' : pill.tone === 'soon' ? 'rgba(245,158,11,0.14)' : 'rgba(239,68,68,0.12)';
                    const col = pill.tone === 'open' ? '#10b981' : pill.tone === 'soon' ? '#f59e0b' : '#ef4444';
                    const dot = pill.tone === 'closed' ? '🔴' : pill.tone === 'soon' ? '🟠' : '🟢';
                    const week = weekHoursLines(shopWH, isRTL);
                    return (
                        <div className="animate-fade-in" style={{ background: 'var(--card-bg)', borderRadius: 20, padding: 20, marginBottom: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.04)' }}>
                            <h3 style={{ fontWeight: 800, marginBottom: 10, fontSize: '0.95rem' }}>🕐 {isRTL ? 'ساعات عمل المحل' : 'Working Hours'}</h3>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                                <span style={{ background: bg, color: col, fontWeight: 900, fontSize: '0.8rem', padding: '5px 12px', borderRadius: 999 }}>{dot} {pill.text}</span>
                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', fontWeight: 700 }}>{isRTL ? 'اليوم: ' : 'Today: '}<span style={{ direction: 'ltr', display: 'inline-block' }}>{todayHoursLabel(shopWH, isRTL)}</span></span>
                            </div>
                            <details>
                                <summary style={{ cursor: 'pointer', color: 'var(--primary)', fontWeight: 800, fontSize: '0.8rem' }}>{isRTL ? 'عرض كل أيام الأسبوع' : 'View all week'}</summary>
                                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                                    {week.map((w, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '0.8rem', fontWeight: w.today ? 900 : 700, color: w.today ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                                            <span>{w.day}{w.today ? (isRTL ? ' (اليوم)' : ' (today)') : ''}</span>
                                            <span style={{ direction: 'ltr' }}>{w.label}</span>
                                        </div>
                                    ))}
                                </div>
                            </details>
                        </div>
                    );
                })()}

                {/* Description */}
                <div className="animate-fade-in" style={{ background: 'var(--card-bg)', borderRadius: 20, padding: 20, marginBottom: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.04)' }}>
                    <h3 style={{ fontWeight: 800, marginBottom: 10, fontSize: '0.95rem' }}>{isRTL ? 'الوصف' : 'Description'}</h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.8, fontWeight: 600 }}>{deal.description}</p>
                </div>

                {/* Location — v12.91: عند تعدد المواقع تعرض الفرع المختار من المنتقي أعلاه. */}
                {(loc || deal.mapLocation || dealLocations) && (() => {
                    // v12.91 — الفرع المختار يحكم الاسم والاتجاهات لو العرض متعدد المواقع.
                    const branch = dealLocations && activeLoc ? activeLoc : null;
                    const branchKnown = branch?.locationId ? getLocation(branch.locationId) : null;
                    const dispName = branch ? (branch.name || branchKnown?.name || (isRTL ? 'فرع' : 'Branch')) : (loc?.name || (isRTL ? 'موقع مخصص للتاجر' : 'Seller Custom Location'));
                    const dispType = branch ? branchKnown : loc;
                    const resolved = branch
                        ? (branch.region || branch.city ? { regionId: branch.region, cityId: branch.city } : (branchKnown ? { regionId: CITIES.find(c => c.id === branchKnown.cityId)?.regionId, cityId: branchKnown.cityId } : {}))
                        : resolveDealLocation(deal);
                    const regionName = resolved.regionId ? REGIONS.find(r => r.id === resolved.regionId)?.name : null;
                    const cityName = resolved.cityId ? CITIES.find(c => c.id === resolved.cityId)?.name : null;
                    return (
                    <div className="animate-fade-in" style={{ background: 'var(--card-bg)', borderRadius: 20, padding: 20, marginBottom: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.04)' }}>
                        <h3 style={{ fontWeight: 800, marginBottom: 10, fontSize: '0.95rem' }}>{isRTL ? (branch ? 'موقع الفرع المختار' : 'الموقع') : (branch ? 'Selected branch' : 'Location')}</h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--body-bg)', padding: '12px 16px', borderRadius: 14, marginBottom: 12 }}>
                            <span style={{ fontSize: '1.5rem' }}>📍</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{dispName}</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--gray-400)', fontWeight: 600, marginTop: 2 }}>{dispType?.type === 'mall' ? '🛍️' : '🏛️'} {dispType?.type === 'mall' ? (isRTL ? 'مول' : 'Mall') : (isRTL ? 'سوق / محل' : 'Market / Store')}</div>
                                {(regionName || cityName) && (
                                    <div style={{ fontSize: '0.78rem', color: 'var(--primary)', fontWeight: 800, marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                        <span>🗺️</span>
                                        <span>{[regionName, cityName].filter(Boolean).join(isRTL ? ' • ' : ' • ')}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                        <button type="button" onClick={() => {
                            // Prefer the precise name-search link over approximate coordinates. v12.04
                            const link = branch ? (branch.googleMapsLink || null) : deal.googleMapsLink;
                            if (link) { openExternalUrl(link); return; }
                            const lat = branch ? (branchKnown?.lat || branch.lat || 0) : (deal.mapLocation?.lat || loc?.lat || 0);
                            const lng = branch ? (branchKnown?.lng || branch.lng || 0) : (deal.mapLocation?.lng || loc?.lng || 0);
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
                            myStoreReview ? (
                                // v12.30 — already rated this store → EDIT the rating
                                // (opens the same form prefilled; saving updates in place).
                                <button onClick={() => {
                                    if (!showReviewForm) {
                                        setReviewScore(myStoreReview.score);
                                        setReviewComment(myStoreReview.comment || '');
                                    }
                                    setShowReviewForm(!showReviewForm);
                                }}
                                    style={{ background: 'var(--dark)', color: 'white', padding: '8px 16px', borderRadius: 10, fontSize: '0.8rem', fontWeight: 700, border: 'none' }}>
                                    {isRTL ? '✏️ تعديل تقييمك' : '✏️ Edit your rating'}
                                </button>
                            ) : (
                                <button onClick={() => setShowReviewForm(!showReviewForm)}
                                    style={{ background: 'var(--dark)', color: 'white', padding: '8px 16px', borderRadius: 10, fontSize: '0.8rem', fontWeight: 700, border: 'none' }}>
                                    {isRTL ? '✍️ أضف تعليق' : '✍️ Add Review'}
                                </button>
                            )
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
                                    : myStoreReview
                                        ? (isRTL ? 'حفظ التعديل ✅' : 'Save changes ✅')
                                        : (isRTL ? 'إرسال التقييم' : 'Submit Review')}
                            </button>
                        </div>
                    )}

                    {storeReviews.length > 0 ? storeReviews.slice(0, 5).map((r, i) => {
                        const ratingKey = r.id || `${r.userId}-${i}`;
                        const liked = !!(user && r.likedBy && r.likedBy.includes(user.id));
                        const canDelete = !!user && (user.id === r.userId || user.userType === 'admin');
                        const canReply = isOwner && !!r.id;
                        return (
                        <div key={ratingKey} style={{ padding: '16px 0', borderBottom: i < Math.min(storeReviews.length, 5) - 1 ? '1px solid var(--gray-100)' : 'none' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                <span style={{ fontWeight: 800, fontSize: '0.85rem' }}>{r.userName}</span>
                                <span style={{ color: '#f59e0b', fontSize: '0.8rem' }}>{'★'.repeat(r.score)}{'☆'.repeat(5 - r.score)}</span>
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--primary)', fontWeight: 800, marginBottom: 6 }}>🏷️ {r.itemName}</div>
                            <p style={{ color: 'var(--text-primary)', fontSize: '0.85rem', lineHeight: 1.6, fontWeight: 500 }}>{r.comment}</p>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 8 }}>
                                <div style={{ fontSize: '0.7rem', color: 'var(--gray-400)', fontWeight: 600 }}>{r.date}</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    {user && r.id && (
                                        <button
                                            type="button"
                                            onClick={() => toggleRatingLike(r.dealId, r.id!)}
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
                                                if (ok) await removeRating(r.dealId, r.id);
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

                            {(() => {
                                const isEditing = canReply && activeReplyId === r.id;
                                return (
                                <>
                                    {r.reply && !isEditing && (
                                        <div style={{ marginTop: 12, padding: '12px', background: 'var(--body-bg)', borderRadius: 14, borderRight: isRTL ? '3px solid var(--primary)' : 'none', borderLeft: !isRTL ? '3px solid var(--primary)' : 'none' }}>
                                            <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--primary)', marginBottom: 4, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                                <span>💬 {isOwner ? (isRTL ? 'ردك:' : 'Your reply:') : (isRTL ? 'رد المتجر:' : 'Store Reply:')}</span>
                                                {isOwner && r.id && (
                                                    <div style={{ display: 'flex', gap: 8 }}>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setReplyDrafts(prev => ({ ...prev, [r.id!]: r.reply || '' }));
                                                                setActiveReplyId(r.id!);
                                                            }}
                                                            style={{ background: 'none', border: 'none', color: 'var(--primary)', fontWeight: 800, fontSize: '0.7rem', cursor: 'pointer' }}
                                                            aria-label={isRTL ? 'تعديل الرد' : 'Edit reply'}
                                                        >
                                                            ✏️ {isRTL ? 'تعديل' : 'Edit'}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={async () => {
                                                                const ok = await customConfirm(isRTL ? 'حذف هذا الردّ؟' : 'Remove this reply?');
                                                                if (ok) await addReply(r.dealId, r.id!, '');
                                                            }}
                                                            style={{ background: 'none', border: 'none', color: 'var(--gray-400)', fontWeight: 700, fontSize: '0.7rem', cursor: 'pointer' }}
                                                            aria-label={isRTL ? 'حذف الرد' : 'Remove reply'}
                                                        >
                                                            ✕ {isRTL ? 'حذف الرد' : 'Remove'}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, fontWeight: 600 }}>{r.reply}</p>
                                        </div>
                                    )}

                                    {isEditing && (
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
                                                    await addReply(r.dealId, r.id, text);
                                                    setReplyDrafts(prev => { const n = { ...prev }; delete n[r.id!]; return n; });
                                                    setActiveReplyId(null);
                                                }}
                                                    style={{ flex: 1, padding: '10px', borderRadius: 12, background: 'var(--primary)', color: 'white', fontWeight: 800, border: 'none', fontSize: '0.85rem', cursor: 'pointer' }}>
                                                    {r.reply ? (isRTL ? '💾 حفظ التعديل' : '💾 Save edit') : (isRTL ? '💬 إرسال الرد' : '💬 Send Reply')}
                                                </button>
                                                <button onClick={() => { setActiveReplyId(null); setReplyDrafts(prev => { const n = { ...prev }; delete n[r.id!]; return n; }); }}
                                                    style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--gray-100)', color: 'var(--text-secondary)', fontWeight: 800, border: 'none', fontSize: '0.85rem', cursor: 'pointer' }}>
                                                    {isRTL ? 'إلغاء' : 'Cancel'}
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {canReply && !r.reply && !isEditing && (
                                        <button onClick={() => setActiveReplyId(r.id!)}
                                            style={{ marginTop: 8, padding: '6px 14px', borderRadius: 10, background: 'var(--body-bg)', border: '1px solid var(--gray-200)', color: 'var(--primary)', fontSize: '0.8rem', fontWeight: 800, cursor: 'pointer' }}>
                                            💬 {isRTL ? 'الرد على هذا التعليق' : 'Reply to this review'}
                                        </button>
                                    )}
                                </>
                                );
                            })()}
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
                            {/* v12.64 — مع النسخ: الكمية تُدار من عدّادات المقاسات
                                أعلاه، وهنا ملخص فقط حتى لا يتعارض عدّادان. */}
                            {!booked && canBook && variants.length > 0 && variantPiecesTotal > 0 && (
                                <div style={{ marginBottom: 12, textAlign: 'center', fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                                    🧺 {isRTL ? `القطع: ${variantPiecesTotal}` : `Items: ${variantPiecesTotal}`}
                                    <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>
                                        {' — '}{variants.filter(v => (varSel[v.id] || 0) > 0).map(v => `${v.label} ×${varSel[v.id]}`).join(' + ')}
                                    </span>
                                </div>
                            )}
                            {!booked && canBook && variants.length === 0 && (
                                <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                                    <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>{isRTL ? 'الكمية:' : 'Quantity:'}</span>
                                    <div style={{ display: 'flex', alignItems: 'center', background: 'var(--gray-100)', borderRadius: 12, overflow: 'hidden' }}>
                                        <button onClick={() => setSelectedQuantity(Math.max(1, selectedQuantity - 1))} style={{ padding: '6px 16px', border: 'none', background: 'none', fontSize: '1.2rem', fontWeight: 800 }}>-</button>
                                        <span style={{ padding: '0 12px', fontWeight: 900 }}>{selectedQuantity}</span>
                                        <button onClick={() => {
                                            // v12.28 — سقف التاجر للحجز الواحد يعلو أي زيادة
                                            const capPer = (deal.maxPerBooking && deal.maxPerBooking > 0) ? deal.maxPerBooking : Infinity;
                                            if (deal.quantity === 'unlimited' || !hasStockCap) {
                                                setSelectedQuantity(Math.min(capPer, selectedQuantity + 1));
                                            } else {
                                                setSelectedQuantity(Math.min(capPer, Math.min(deal.quantity as number, selectedQuantity + 1)));
                                            }
                                        }} style={{ padding: '6px 16px', border: 'none', background: 'none', fontSize: '1.2rem', fontWeight: 800 }}>+</button>
                                    </div>
                                </div>
                            )}
                            {!booked && canBook && !!deal.maxPerBooking && (
                                <div style={{ textAlign: 'center', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', marginTop: -6, marginBottom: 10 }}>
                                    {isRTL ? `🛡 الحد الأقصى للحجز الواحد: ${deal.maxPerBooking}` : `🛡 Max per booking: ${deal.maxPerBooking}`}
                                </div>
                            )}
                            {/* v11.20 — Coming Soon block. Instead of the live "احجز
                                الآن" CTA we render a locked, dim button with a
                                live countdown. The buyer can still browse the
                                rest of the page (store profile, ratings, gallery)
                                and the CTA flips to a real bookable button
                                automatically the moment startsAt passes. */}
                            {isComingSoon ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {(() => {
                                        const cs = formatComingSoonRemaining(deal.startsAt!, isRTL);
                                        const urgent = cs.urgent;
                                        return (
                                            <div style={{
                                                background: urgent
                                                    ? 'linear-gradient(135deg, #dc2626, #b91c1c)'
                                                    : 'linear-gradient(135deg, #6366f1, #4f46e5)',
                                                color: 'white',
                                                borderRadius: 18,
                                                padding: '18px 16px',
                                                textAlign: 'center',
                                                boxShadow: urgent
                                                    ? '0 10px 24px rgba(220,38,38,0.4)'
                                                    : '0 10px 24px rgba(99,102,241,0.35)',
                                                animation: urgent ? 'pulse 1.4s ease-in-out infinite' : 'none'
                                            }}>
                                                <div style={{ fontSize: '0.78rem', fontWeight: 800, opacity: 0.9, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                                    <span style={{ fontSize: '1rem' }}>🔒</span>
                                                    {isRTL ? 'يفتح الحجز خلال' : 'Booking opens in'}
                                                </div>
                                                <div style={{ fontSize: '1.9rem', fontWeight: 950, letterSpacing: 1, lineHeight: 1 }}>
                                                    {cs.text}
                                                </div>
                                                <div style={{ fontSize: '0.72rem', fontWeight: 700, opacity: 0.85, marginTop: 8 }}>
                                                    {urgent
                                                        ? (isRTL ? '⚡ آخر ٤ ساعات — جهّز نفسك' : '⚡ Last 4 hours — get ready')
                                                        : (isRTL ? 'تابع الصفحة وحضّر طلبك من الآن' : 'Browse the page and prep ahead')}
                                                </div>
                                            </div>
                                        );
                                    })()}
                                    <button
                                        disabled
                                        className="book-btn"
                                        style={{ opacity: 0.55, cursor: 'not-allowed' }}
                                    >
                                        {isRTL
                                            ? `🔒 احجز الآن — ${bookingTotal} ر.س`
                                            : `🔒 Book Now — ${bookingTotal} SAR`}
                                    </button>
                                </div>
                            ) : shopClosed && !booked ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    <div style={{ background: 'linear-gradient(135deg,#475569,#334155)', color: 'white', borderRadius: 18, padding: '18px 16px', textAlign: 'center', boxShadow: '0 10px 24px rgba(51,65,85,0.35)' }}>
                                        <div style={{ fontSize: '0.78rem', fontWeight: 800, opacity: 0.9, marginBottom: 6 }}>🔒 {isRTL ? 'المحل مغلق الآن' : 'Shop closed now'}</div>
                                        <div style={{ fontSize: '1.5rem', fontWeight: 950, lineHeight: 1.1 }}>
                                            {shopStatus.opensInMin != null ? (isRTL ? `يفتح بعد ${fmtDuration(shopStatus.opensInMin, true)}` : `Opens in ${fmtDuration(shopStatus.opensInMin, false)}`) : (isRTL ? 'مغلق' : 'Closed')}
                                        </div>
                                        <div style={{ fontSize: '0.72rem', fontWeight: 700, opacity: 0.85, marginTop: 8 }}>{isRTL ? 'يفتح الحجز فور فتح المحل' : 'Booking opens when the shop opens'}</div>
                                    </div>
                                    <button disabled className="book-btn" style={{ opacity: 0.55, cursor: 'not-allowed' }}>
                                        {isRTL ? '🔒 المحل مغلق' : '🔒 Shop Closed'}
                                    </button>
                                </div>
                            ) : (
                                <>
                                    {closingSoon && !booked && (
                                        <div style={{ background: 'rgba(245,158,11,0.14)', border: '1px solid #f59e0b', color: 'var(--text-primary)', borderRadius: 14, padding: '10px 12px', marginBottom: 10, fontSize: '0.8rem', fontWeight: 800, textAlign: 'center' }}>
                                            ⏰ {isRTL ? `المحل سيغلق بعد ${fmtDuration(shopStatus.closesInMin!, true)} — تأكد أنك تستلم قبل الإغلاق` : `Shop closes in ${fmtDuration(shopStatus.closesInMin!, false)} — collect before closing`}
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
                                                : (isRTL ? `🎟️ احجز الآن — ${bookingTotal} ر.س` : `🎟️ Book Now — ${bookingTotal} SAR`)}
                                    </button>
                                </>
                            )}
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
                                <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: 4 }}>
                                    {deal.itemName}{variants.length && variantPiecesTotal > 0
                                        ? ` — ${variants.filter(v => (varSel[v.id] || 0) > 0).map(v => `${v.label} ×${varSel[v.id]}`).join(' + ')}`
                                        : ''}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ fontSize: '0.8rem', color: '#f59e0b', fontWeight: 900 }}>★ {average > 0 ? average : (isRTL ? 'جديد' : 'New')}</span>
                                    <span style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 900 }}>{bookingTotal} ر.س</span>
                                </div>
                            </div>
                            {/* Merchant Avatar for Trust */}
                            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--primary-light)', border: '1.5px solid white', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', overflow: 'hidden' }}>
                                {storeProfiles[deal.storeId]?.avatar ? <img src={storeProfiles[deal.storeId].avatar} alt="Merchant" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🏪'}
                            </div>
                        </div>
                        
                        {/* v12.90 — مرونة عالية (طلب ناصر): تعديل الكميات/الأنواع من داخل
                            ورقة الحجز مباشرة — أضِف نوعاً أو احذفه أو غيّر عدده بلا رجوع.
                            القطع والإجمالي والاختيارات تتحدّث فوراً. */}
                        {variants.length > 0 ? (
                            <div style={{ background: 'var(--card-bg)', borderRadius: 20, padding: '14px 16px', marginBottom: 12, border: '1px solid var(--border-color)' }}>
                                <div style={{ fontSize: '0.9rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 10 }}>
                                    🧬 {isRTL ? 'عدّل أنواعك وكمياتها' : 'Adjust your variants'}
                                </div>
                                {variants.map(v => {
                                    const q = varSel[v.id] || 0;
                                    const cap = typeof v.qty === 'number' ? v.qty : undefined;
                                    const setQ = (next: number) => {
                                        const capped = cap !== undefined ? Math.min(next, cap) : next;
                                        setFocusVariantId(v.id);
                                        setVarSel(prev => { const cur = { ...prev }; if (capped <= 0) delete cur[v.id]; else cur[v.id] = capped; return cur; });
                                    };
                                    return (
                                        <div key={v.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderBottom: '1px dashed var(--border-color)' }}>
                                            <div style={{ minWidth: 0, flex: 1 }}>
                                                <span style={{ fontWeight: 900, fontSize: '0.86rem', color: 'var(--text-primary)' }}>{v.label}</span>
                                                <span style={{ fontWeight: 800, fontSize: '0.78rem', color: 'var(--primary)', marginInlineStart: 8 }}>{v.price} ر.س</span>
                                                {cap !== undefined && <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-secondary)', marginInlineStart: 6 }}>({isRTL ? `المتاح ${cap}` : `${cap} left`})</span>}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                                <button type="button" onClick={() => setQ(q - 1)} disabled={q <= 0}
                                                    aria-label={isRTL ? `تقليل ${v.label}` : `Decrease ${v.label}`}
                                                    style={{ width: 34, height: 34, borderRadius: '50%', border: '1.5px solid var(--border-color)', background: 'var(--card-bg)', color: 'var(--text-primary)', fontWeight: 900, fontSize: '1.1rem', lineHeight: 1, cursor: q <= 0 ? 'default' : 'pointer', opacity: q <= 0 ? 0.4 : 1 }}>−</button>
                                                <span style={{ fontWeight: 900, fontSize: '1rem', minWidth: 22, textAlign: 'center', color: 'var(--text-primary)' }}>{q}</span>
                                                <button type="button" onClick={() => setQ(q + 1)} disabled={cap !== undefined && q >= cap}
                                                    aria-label={isRTL ? `زيادة ${v.label}` : `Increase ${v.label}`}
                                                    style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 900, fontSize: '1.1rem', lineHeight: 1, cursor: 'pointer', opacity: cap !== undefined && q >= cap ? 0.4 : 1 }}>+</button>
                                            </div>
                                        </div>
                                    );
                                })}
                                {variantPiecesTotal > 0 && (
                                    <div style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--primary)', marginTop: 8 }}>
                                        🧺 {variants.filter(v => (varSel[v.id] || 0) > 0).map(v => `${v.label} ×${varSel[v.id]}`).join(' + ')} = {variantMoneyTotal} {isRTL ? 'ر.س' : 'SAR'}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div style={{ background: 'var(--card-bg)', borderRadius: 20, padding: '14px 16px', marginBottom: 12, border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ fontSize: '0.9rem', fontWeight: 900, color: 'var(--text-primary)' }}>🔢 {isRTL ? 'الكمية' : 'Quantity'}</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <button type="button" onClick={() => setSelectedQuantity(q => Math.max(1, q - 1))} disabled={selectedQuantity <= 1}
                                        aria-label={isRTL ? 'تقليل' : 'Decrease'}
                                        style={{ width: 36, height: 36, borderRadius: '50%', border: '1.5px solid var(--border-color)', background: 'var(--card-bg)', color: 'var(--text-primary)', fontWeight: 900, fontSize: '1.15rem', lineHeight: 1, cursor: selectedQuantity <= 1 ? 'default' : 'pointer', opacity: selectedQuantity <= 1 ? 0.4 : 1 }}>−</button>
                                    <span style={{ fontWeight: 900, fontSize: '1.1rem', minWidth: 26, textAlign: 'center', color: 'var(--text-primary)' }}>{selectedQuantity}</span>
                                    <button type="button" onClick={() => setSelectedQuantity(q => q + 1)}
                                        aria-label={isRTL ? 'زيادة' : 'Increase'}
                                        style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 900, fontSize: '1.15rem', lineHeight: 1, cursor: 'pointer' }}>+</button>
                                </div>
                            </div>
                        )}

                        {/* v12.66 — «اختيارات لكل قطعة»: بطاقة لكل قطعة محجوزة
                            (برغر ١، برغر ٢، علم صغير…) داخلها أقسام التاجر —
                            radio للقسم الأحادي وcheckbox للمتعدد، فيختار المشتري
                            لكل قطعة إضافاتها بشكل مستقل. زر «مثل السابقة» ينسخ
                            اختيارات القطعة السابقة بضغطة. */}
                        {!!deal.options?.length && bookingPieces.map((piece, pi) => {
                            const multiPiece = bookingPieces.length > 1;
                            const prevKey = pi > 0 ? bookingPieces[pi - 1].key : null;
                            const prevHasSel = !!(prevKey && pieceOpt[prevKey] && Object.values(pieceOpt[prevKey]).some(g => Object.keys(g).length > 0));
                            return (
                                <div key={piece.key} style={{ background: 'var(--card-bg)', borderRadius: 20, padding: 20, marginBottom: 12, border: '1px solid var(--border-color)' }}>
                                    {multiPiece && (
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12, paddingBottom: 10, borderBottom: '1px dashed var(--border-color)' }}>
                                            <div style={{ fontWeight: 900, fontSize: '0.92rem', color: 'var(--primary)' }}>
                                                🧾 {piece.label}
                                            </div>
                                            {prevHasSel && (
                                                <button type="button"
                                                    onClick={() => setPieceOpt(prev => ({ ...prev, [piece.key]: JSON.parse(JSON.stringify(prev[prevKey!] || {})) }))}
                                                    style={{ border: '1px solid var(--border-color)', background: 'var(--gray-100)', color: 'var(--text-primary)', borderRadius: 999, padding: '5px 12px', fontSize: '0.7rem', fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>
                                                    📋 {isRTL ? 'مثل السابقة' : 'Same as previous'}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    {deal.options!.map(grp => {
                                        const sel = pieceOpt[piece.key]?.[grp.id] || {};
                                        return (
                                            <div key={grp.id} style={{ marginBottom: 8 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                                    <h3 style={{ fontWeight: 800, fontSize: '0.95rem', margin: 0 }}>🧩 {grp.title}</h3>
                                                    <span style={{
                                                        fontSize: '0.66rem', fontWeight: 800, padding: '4px 10px', borderRadius: 999,
                                                        background: grp.required ? 'var(--danger-light)' : 'var(--gray-100)',
                                                        color: grp.required ? 'var(--danger)' : 'var(--text-secondary)',
                                                    }}>
                                                        {grp.required
                                                            ? (grp.mode === 'single' ? (isRTL ? 'مطلوب — اختر ١' : 'Required — pick 1') : (isRTL ? 'مطلوب' : 'Required'))
                                                            : (isRTL ? 'اختياري' : 'Optional')}
                                                    </span>
                                                </div>
                                                {grp.choices.map(choice => {
                                                    const picked = !!sel[choice.id];
                                                    const addOn = choice.price || 0;
                                                    const toggle = () => {
                                                        setPieceOpt(prev => {
                                                            const pieceSel = { ...(prev[piece.key] || {}) };
                                                            if (grp.mode === 'single') {
                                                                // radio: خيار واحد فقط في القسم لهذه القطعة
                                                                pieceSel[grp.id] = picked ? {} : { [choice.id]: 1 };
                                                            } else {
                                                                const cur = { ...(pieceSel[grp.id] || {}) };
                                                                if (picked) delete cur[choice.id]; else cur[choice.id] = 1;
                                                                pieceSel[grp.id] = cur;
                                                            }
                                                            return { ...prev, [piece.key]: pieceSel };
                                                        });
                                                    };
                                                    return (
                                                        <div key={choice.id}
                                                            role={grp.mode === 'single' ? 'radio' : 'checkbox'}
                                                            aria-checked={picked}
                                                            tabIndex={0}
                                                            onClick={toggle}
                                                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
                                                            style={{
                                                                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                                                                borderRadius: 14, marginBottom: 8, cursor: 'pointer',
                                                                border: picked ? '1.5px solid var(--primary)' : '1.5px solid var(--border-color)',
                                                                background: picked ? 'var(--notif-unread-bg)' : 'var(--body-bg)',
                                                                transition: 'all 0.15s ease',
                                                                WebkitTapHighlightColor: 'transparent',
                                                            }}>
                                                            <div style={{
                                                                width: 22, height: 22, flexShrink: 0,
                                                                borderRadius: grp.mode === 'single' ? '50%' : 7,
                                                                border: picked ? '6px solid var(--primary)' : '2px solid var(--gray-300)',
                                                                background: picked && grp.mode === 'multi' ? 'var(--primary)' : 'var(--card-bg)',
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                color: '#fff', fontSize: '0.7rem', fontWeight: 900, transition: 'all 0.15s ease',
                                                            }}>{picked && grp.mode === 'multi' ? '✓' : ''}</div>
                                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                                <div style={{ fontWeight: 800, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{choice.label}</div>
                                                            </div>
                                                            {/* v12.60 — السعر الإضافي للخيار: يظهر قبل التأكيد ويُضاف للمبلغ */}
                                                            {addOn > 0 && (
                                                                <span style={{
                                                                    fontSize: '0.76rem', fontWeight: 900, flexShrink: 0,
                                                                    color: picked ? 'var(--primary)' : 'var(--text-secondary)',
                                                                    background: picked ? 'var(--primary-light)' : 'var(--gray-100)',
                                                                    borderRadius: 999, padding: '4px 10px',
                                                                }}>
                                                                    +{addOn} {isRTL ? 'ر.س' : 'SAR'}
                                                                </span>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                                {grp.mode === 'multi' && (
                                                    <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
                                                        {isRTL
                                                            ? (multiPiece ? '💡 يمكنك اختيار أكثر من إضافة لهذه القطعة — ولكل قطعة اختياراتها الخاصة.' : '💡 يمكنك اختيار أكثر من إضافة.')
                                                            : (multiPiece ? '💡 Pick as many add-ons as you like — each item has its own choices.' : '💡 Pick as many add-ons as you like.')}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}

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

                        {/* v12.81 — اختيار طريقة الدفع حسب وضع تاجر العرض:
                            'cod' (الافتراضي) = لا يظهر شيء (كما كان دائماً)،
                            'both' = المشتري يختار، 'online' = إلكتروني فقط. */}
                        {payMode !== 'cod' && (
                            <div style={{ background: 'var(--card-bg)', borderRadius: 20, padding: 20, marginBottom: 12, border: '1px solid var(--border-color)' }}>
                                <h3 style={{ fontWeight: 800, marginBottom: 12, fontSize: '0.95rem' }}>💳 {isRTL ? 'طريقة الدفع' : 'Payment Method'}</h3>
                                {payMode === 'both' ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        {([
                                            { id: 'cod' as const, icon: '🏪', title: isRTL ? 'الدفع عند الاستلام' : 'Pay at pickup', sub: isRTL ? 'تدفع للتاجر عند استلام طلبك' : 'Pay the merchant on pickup' },
                                            { id: 'online' as const, icon: '💳', title: isRTL ? 'ادفع الآن إلكترونياً' : 'Pay now online', sub: isRTL ? 'مدى / فيزا / ماستركارد — عبر بوابة التاجر المرخصة مباشرة' : 'mada / Visa / Mastercard — via the merchant’s licensed gateway' },
                                        ]).map(opt => {
                                            const picked = payChoice === opt.id;
                                            return (
                                                <div key={opt.id}
                                                    role="radio" aria-checked={picked} tabIndex={0}
                                                    onClick={() => setPayChoice(opt.id)}
                                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPayChoice(opt.id); } }}
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14, cursor: 'pointer',
                                                        border: picked ? '1.5px solid var(--primary)' : '1.5px solid var(--border-color)',
                                                        background: picked ? 'var(--notif-unread-bg)' : 'var(--body-bg)',
                                                        transition: 'all 0.15s ease', WebkitTapHighlightColor: 'transparent',
                                                    }}>
                                                    <div style={{ width: 22, height: 22, flexShrink: 0, borderRadius: '50%', border: picked ? '6px solid var(--primary)' : '2px solid var(--gray-300)', background: 'var(--card-bg)' }} />
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ fontWeight: 800, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{opt.icon} {opt.title}</div>
                                                        <div style={{ fontWeight: 700, fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: 2 }}>{opt.sub}</div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: 'var(--body-bg)', border: '1.5px solid var(--primary)', borderRadius: 14, padding: '12px 14px' }}>
                                        <span style={{ fontSize: '1.2rem' }}>💳</span>
                                        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.7 }}>
                                            {isRTL
                                                ? 'هذا التاجر يستقبل الدفع الإلكتروني فقط — بعد تأكيد الحجز ستنتقل لصفحة الدفع الآمنة (مدى / فيزا / ماستركارد) عبر بوابته المرخصة، والمبلغ يصل حسابه مباشرة.'
                                                : 'This merchant accepts online payment only — after confirming you’ll be taken to the secure payment page (mada / Visa / Mastercard) of their licensed gateway.'}
                                        </div>
                                    </div>
                                )}
                                <p style={{ margin: '10px 0 0', fontSize: '0.66rem', fontWeight: 700, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                                    🔒 {isRTL
                                        ? 'الدفع يتم على صفحة بوابة الدفع المرخصة الخاصة بالتاجر — تاكي لا تستلم أموالك.'
                                        : 'Payment happens on the merchant’s licensed gateway page — TAKI never receives your money.'}
                                </p>
                            </div>
                        )}

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, padding: 16, background: 'var(--card-bg)', borderRadius: 16, border: '2px solid var(--gray-200)' }}>
                                <span style={{ fontWeight: 800 }}>{isRTL ? 'الإجمالي:' : 'Total:'}</span>
                                <span style={{ fontSize: '1.3rem', fontWeight: 900, color: 'var(--danger)' }}>
                                    {bookingTotal} ر.س
                                    {/* v12.60 — تفصيل الإضافات حتى لا يستغرب المشتري الزيادة */}
                                    {optAddOnTotal > 0 && (
                                        <span style={{ display: 'block', fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-secondary)', textAlign: isRTL ? 'left' : 'right' }}>
                                            {isRTL ? `منها إضافات: +${optAddOnTotal} ر.س` : `incl. add-ons: +${optAddOnTotal} SAR`}
                                        </span>
                                    )}
                                </span>
                        </div>

                        <div style={{
                            display: 'flex', gap: 10, alignItems: 'flex-start',
                            background: 'rgba(245, 158, 11, 0.12)',
                            border: '1px solid rgba(245, 158, 11, 0.35)',
                            borderRadius: 16, padding: '14px 16px', marginBottom: 18,
                        }}>
                            <span style={{ fontSize: '1.2rem', lineHeight: 1.2 }}>⏳</span>
                            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.7 }}>
                                {isRTL ? (
                                    <>
                                        <span style={{ fontWeight: 900 }}>مدة الحجز ساعتان فقط.</span>{' '}
                                        يُرجى استلام طلبك من المتجر خلال <span style={{ fontWeight: 900 }}>ساعتين</span> من تأكيد الحجز.
                                        وعند انتهاء المهلة دون استلام، يُلغى حجزك تلقائياً ويعود المنتج للبيع — دون أي التزام عليك.
                                    </>
                                ) : (
                                    <>
                                        <span style={{ fontWeight: 900 }}>Your booking is valid for 2 hours only.</span>{' '}
                                        Please collect your order from the store within <span style={{ fontWeight: 900 }}>2 hours</span> of
                                        confirming. If the window passes without pickup, the booking is cancelled automatically and the
                                        item is released back for sale — at no obligation to you.
                                    </>
                                )}
                            </div>
                        </div>

                        <button onClick={() => { setShowBookingModal(false); handleBooking(); }} style={{ width: '100%', padding: '16px', borderRadius: 16, background: 'var(--primary)', color: 'white', fontWeight: 900, fontSize: '1.1rem', border: 'none', cursor: 'pointer', boxShadow: '0 8px 20px var(--primary-glow)' }}>
                            {payChoice === 'online' && payMode !== 'cod'
                                ? (isRTL ? 'تأكيد الحجز والانتقال للدفع 💳' : 'Confirm & Pay Online 💳')
                                : (isRTL ? 'تأكيد الحجز النهائي ✅' : 'Confirm Final Booking ✅')}
                        </button>
                    </div>
                </div>
            )}
            <BottomNav />
        </div>
    );
};

export default DealDetails;
