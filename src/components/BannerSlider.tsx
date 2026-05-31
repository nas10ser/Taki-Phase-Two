import React, { useState, useEffect, useRef } from 'react';
import { useHistory } from 'react-router-dom';
import { Banner } from '../repositories/bannerRepository';
import { openExternalUrl } from '../utils/helpers';

interface BannerSliderProps {
    banners: Banner[];
    isRTL: boolean;
}

/**
 * Banner carousel (v11.30).
 *
 * Noon-style: auto-advances every 5s AND follows the finger on swipe
 * (drag-to-pan with snap + edge resistance). The frame is a fixed 2:1
 * aspect ratio so the admin's crop (1200×600, chosen in BannerImageEditor)
 * displays pixel-faithfully on every device — no per-device re-cropping.
 */
const AUTOPLAY_MS = 5000;

const BannerSlider: React.FC<BannerSliderProps> = ({ banners, isRTL }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [dragPx, setDragPx] = useState(0);
    const [dragging, setDragging] = useState(false);
    const history = useHistory();
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const startXRef = useRef(0);
    const movedRef = useRef(false);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const count = banners.length;
    // Clamp the index if the banner list shrinks under us.
    useEffect(() => {
        if (currentIndex > count - 1) setCurrentIndex(Math.max(0, count - 1));
    }, [count, currentIndex]);

    // Autoplay — paused while the user is actively dragging.
    useEffect(() => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (count > 1 && !dragging) {
            timeoutRef.current = setTimeout(
                () => setCurrentIndex(prev => (prev + 1) % count),
                AUTOPLAY_MS
            );
        }
        return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
    }, [currentIndex, count, dragging]);

    if (count === 0) return null;

    const handleBannerClick = (banner: Banner) => {
        // A swipe must never be read as a tap.
        if (movedRef.current) { movedRef.current = false; return; }
        if (banner.deal_id) {
            history.push(`/deal/${banner.deal_id}`);
        } else if (banner.store_id) {
            history.push(`/store/${banner.store_id}`);
        } else if (banner.target_url) {
            if (banner.target_url.startsWith('http')) {
                openExternalUrl(banner.target_url);
            } else {
                history.push(banner.target_url);
            }
        }
    };

    // ===== Swipe (drag-follow + snap) =====
    // In RTL, advancing moves content to the right (+); in LTR, to the left (−).
    const nextSign = isRTL ? 1 : -1;

    const onStart = (clientX: number) => {
        if (count <= 1) return;
        startXRef.current = clientX;
        movedRef.current = false;
        setDragging(true);
    };
    const onMove = (clientX: number) => {
        if (!dragging) return;
        let dx = clientX - startXRef.current;
        if (Math.abs(dx) > 6) movedRef.current = true;
        // Rubber-band at the ends so the carousel never reveals empty space.
        const towardNext = nextSign > 0 ? dx > 0 : dx < 0;
        const towardPrev = nextSign > 0 ? dx < 0 : dx > 0;
        if ((currentIndex === 0 && towardPrev) || (currentIndex === count - 1 && towardNext)) {
            dx /= 3;
        }
        setDragPx(dx);
    };
    const onEnd = () => {
        if (!dragging) return;
        const width = wrapRef.current?.offsetWidth || 320;
        const threshold = Math.max(40, width * 0.18);
        let next = currentIndex;
        if (Math.abs(dragPx) >= threshold) {
            const towardNext = nextSign > 0 ? dragPx > 0 : dragPx < 0;
            next = towardNext ? currentIndex + 1 : currentIndex - 1;
        }
        next = Math.max(0, Math.min(count - 1, next));
        setDragPx(0);
        setDragging(false);
        setCurrentIndex(next);
    };

    const step = 100 / count;                       // one slide = step% of the inner track
    const basePercent = (isRTL ? 1 : -1) * currentIndex * step;

    return (
        <div
            ref={wrapRef}
            style={{
                position: 'relative', width: '100%', aspectRatio: '2 / 1',
                borderRadius: 24, overflow: 'hidden', marginBottom: 24,
                boxShadow: 'var(--shadow-lg)', touchAction: 'pan-y',
            }}
            onTouchStart={(e) => onStart(e.touches[0].clientX)}
            onTouchMove={(e) => onMove(e.touches[0].clientX)}
            onTouchEnd={onEnd}
            onTouchCancel={onEnd}
            onMouseDown={(e) => onStart(e.clientX)}
            onMouseMove={(e) => { if (dragging) onMove(e.clientX); }}
            onMouseUp={onEnd}
            onMouseLeave={() => { if (dragging) onEnd(); }}
        >
            <div style={{
                display: 'flex',
                width: `${count * 100}%`,
                height: '100%',
                transform: `translateX(calc(${basePercent}% + ${dragPx}px))`,
                transition: dragging ? 'none' : 'transform 0.55s cubic-bezier(0.4, 0, 0.2, 1)',
            }}>
                {banners.map((banner, idx) => (
                    <div
                        key={banner.id}
                        onClick={() => handleBannerClick(banner)}
                        style={{
                            width: `${100 / count}%`,
                            height: '100%',
                            position: 'relative',
                            cursor: 'pointer',
                        }}
                    >
                        <img
                            src={banner.image_url}
                            alt={isRTL ? banner.title_ar : banner.title_en}
                            width={1200}
                            height={600}
                            loading={idx === 0 ? 'eager' : 'lazy'}
                            decoding="async"
                            draggable={false}
                            {...(idx === 0 ? { fetchpriority: 'high' as 'high' } : {})}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                        />
                        {(banner.title_ar || banner.title_en) && (
                            <div style={{
                                position: 'absolute', bottom: 0, left: 0, right: 0,
                                background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)',
                                padding: '40px 20px 20px', color: 'white',
                            }}>
                                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 900 }}>
                                    {isRTL ? banner.title_ar : banner.title_en}
                                </h3>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {count > 1 && (
                <div style={{
                    position: 'absolute', bottom: 15,
                    [isRTL ? 'left' : 'right']: 20,
                    display: 'flex', gap: 6,
                }}>
                    {banners.map((_, idx) => (
                        <div
                            key={idx}
                            onClick={(e) => { e.stopPropagation(); setCurrentIndex(idx); }}
                            style={{
                                width: idx === currentIndex ? 24 : 8,
                                height: 8, borderRadius: 4,
                                background: idx === currentIndex ? 'white' : 'rgba(255,255,255,0.4)',
                                transition: 'all 0.3s ease', cursor: 'pointer',
                                boxShadow: idx === currentIndex ? '0 0 10px rgba(0,0,0,0.3)' : 'none',
                            }}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export default BannerSlider;
