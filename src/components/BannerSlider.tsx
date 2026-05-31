import React, { useState, useEffect, useRef } from 'react';
import { useHistory } from 'react-router-dom';
import { Banner } from '../repositories/bannerRepository';
import { openExternalUrl } from '../utils/helpers';

interface BannerSliderProps {
    banners: Banner[];
    isRTL: boolean;
}

/**
 * Banner carousel (v11.33) — seamless INFINITE, both-direction, momentum swipe.
 *
 * How the infinite loop works: we render the real slides flanked by one clone
 * each side — [cloneOfLast, ...reals, cloneOfFirst]. The position index `pos`
 * walks over this extended track. Swiping/auto-advancing past either edge lands
 * on a clone, and the moment that transition ends we jump (with animation
 * disabled) to the identical real slide. The user never sees a wall — they can
 * keep dragging in EITHER direction forever, and it feels continuous.
 *
 * Smoothness: the finger is tracked 1:1 during a drag (no transition), and on
 * release we ease with a long decelerate curve. A fast flick (velocity-based)
 * advances even on a short drag, so it feels light and responsive.
 */
const AUTOPLAY_MS = 4500;
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';   // easeOutQuint — smooth decelerate
const DIST_RATIO = 0.16;                          // drag past 16% of width → advance
const VEL_THRESHOLD = 0.35;                        // px/ms → a flick

const BannerSlider: React.FC<BannerSliderProps> = ({ banners, isRTL }) => {
    const count = banners.length;
    const loop = count > 1;
    // Extended track with a clone on each side for seamless wrap-around.
    const slides = loop ? [banners[count - 1], ...banners, banners[0]] : banners;
    const slideCount = slides.length;            // count + 2 when looping
    const step = 100 / slideCount;               // one slide = step% of the track

    const [pos, setPos] = useState(loop ? 1 : 0); // index into `slides`
    const [dragPx, setDragPx] = useState(0);
    const [dragging, setDragging] = useState(false);
    const [animate, setAnimate] = useState(true); // false = instant jump (clone reset)
    const [duration, setDuration] = useState(0.5);

    const history = useHistory();
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const startXRef = useRef(0);
    const lastXRef = useRef(0);
    const lastTRef = useRef(0);
    const velRef = useRef(0);
    const movedRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const realIndex = loop ? (((pos - 1) % count) + count) % count : pos;

    // Reset when the banner set changes (e.g. admin toggles one).
    useEffect(() => { setPos(loop ? 1 : 0); setDragPx(0); /* eslint-disable-next-line */ }, [count]);

    // Autoplay — always "next", paused while dragging.
    useEffect(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (loop && !dragging) {
            timerRef.current = setTimeout(() => { setDuration(0.55); setAnimate(true); setPos(p => p + 1); }, AUTOPLAY_MS);
        }
        return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }, [pos, dragging, loop]);

    // After easing INTO a clone, snap (no animation) to the identical real slide.
    const handleTransitionEnd = (e: React.TransitionEvent) => {
        if (!loop || e.target !== e.currentTarget || e.propertyName !== 'transform') return;
        if (pos === slideCount - 1) { setAnimate(false); setPos(1); }          // firstClone → first real
        else if (pos === 0) { setAnimate(false); setPos(count); }              // lastClone → last real
    };

    // Re-enable animation once the no-anim jump has painted (double rAF).
    useEffect(() => {
        if (animate) return;
        const id = requestAnimationFrame(() => requestAnimationFrame(() => setAnimate(true)));
        return () => cancelAnimationFrame(id);
    }, [animate, pos]);

    if (count === 0) return null;

    const handleBannerClick = (banner: Banner) => {
        if (movedRef.current) { movedRef.current = false; return; } // a swipe is not a tap
        if (banner.deal_id) history.push(`/deal/${banner.deal_id}`);
        else if (banner.store_id) history.push(`/store/${banner.store_id}`);
        else if (banner.target_url) {
            if (banner.target_url.startsWith('http')) openExternalUrl(banner.target_url);
            else history.push(banner.target_url);
        }
    };

    // ===== Drag (1:1 follow) + velocity flick =====
    const onStart = (x: number) => {
        if (!loop) return;
        // Normalize off a clone first so a rapid second swipe can't overrun it.
        if (pos === 0) { setAnimate(false); setPos(count); }
        else if (pos === slideCount - 1) { setAnimate(false); setPos(1); }
        startXRef.current = x;
        lastXRef.current = x;
        lastTRef.current = Date.now();
        velRef.current = 0;
        movedRef.current = false;
        setDragging(true);
    };
    const onMove = (x: number) => {
        if (!dragging) return;
        const now = Date.now();
        const dt = now - lastTRef.current;
        if (dt > 0) velRef.current = (x - lastXRef.current) / dt; // px/ms
        lastXRef.current = x;
        lastTRef.current = now;
        const dx = x - startXRef.current;
        if (Math.abs(dx) > 6) movedRef.current = true;
        setDragPx(dx);
    };
    const onEnd = () => {
        if (!dragging) return;
        const width = wrapRef.current?.offsetWidth || 320;
        const dist = dragPx;
        const vel = velRef.current;
        // Direction of "next": RTL advances by moving content right (dx > 0),
        // LTR by moving it left (dx < 0).
        let dir = 0;
        if (Math.abs(vel) > VEL_THRESHOLD) {
            const flickNext = isRTL ? vel > 0 : vel < 0;
            dir = flickNext ? 1 : -1;
        } else if (Math.abs(dist) > width * DIST_RATIO) {
            const dragNext = isRTL ? dist > 0 : dist < 0;
            dir = dragNext ? 1 : -1;
        }
        setDragPx(0);
        setDragging(false);
        if (dir !== 0) { setDuration(Math.abs(vel) > VEL_THRESHOLD ? 0.34 : 0.46); setAnimate(true); setPos(p => p + dir); }
    };

    const goToReal = (idx: number) => { setDuration(0.5); setAnimate(true); setPos(loop ? idx + 1 : idx); };

    const basePercent = (isRTL ? 1 : -1) * pos * step;

    return (
        <div
            ref={wrapRef}
            style={{
                // Inset card: rounded corners + side margins (set by the Home wrapper).
                position: 'relative', width: '100%', aspectRatio: '2 / 1',
                borderRadius: 20, overflow: 'hidden', touchAction: 'pan-y',
                boxShadow: 'var(--shadow-lg)',
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
            <div
                onTransitionEnd={handleTransitionEnd}
                style={{
                    display: 'flex',
                    width: `${slideCount * 100}%`,
                    height: '100%',
                    transform: `translateX(calc(${basePercent}% + ${dragPx}px))`,
                    transition: (dragging || !animate) ? 'none' : `transform ${duration}s ${EASE}`,
                    willChange: 'transform',
                }}
            >
                {slides.map((banner, idx) => (
                    <div
                        key={`${banner.id}-${idx}`}
                        onClick={() => handleBannerClick(banner)}
                        style={{ width: `${step}%`, height: '100%', position: 'relative', cursor: 'pointer' }}
                    >
                        <img
                            src={banner.image_url}
                            alt={isRTL ? banner.title_ar : banner.title_en}
                            width={1200}
                            height={600}
                            loading={idx <= 1 ? 'eager' : 'lazy'}
                            decoding="async"
                            draggable={false}
                            {...(idx === 1 ? { fetchpriority: 'high' as 'high' } : {})}
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
                            onClick={(e) => { e.stopPropagation(); goToReal(idx); }}
                            style={{
                                width: idx === realIndex ? 24 : 8,
                                height: 8, borderRadius: 4,
                                background: idx === realIndex ? 'white' : 'rgba(255,255,255,0.4)',
                                transition: 'all 0.3s ease', cursor: 'pointer',
                                boxShadow: idx === realIndex ? '0 0 10px rgba(0,0,0,0.3)' : 'none',
                            }}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export default BannerSlider;
