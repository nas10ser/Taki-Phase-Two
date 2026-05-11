import React, { useEffect, useRef, useState } from 'react';

/**
 * iOS-style swipe-down-to-refresh wrapper. Drop this around any page
 * body that has its own scroll. When the user is already at scrollTop=0
 * and drags downward past the threshold, we show a spinner that
 * tracks the finger; when they release past `triggerDistance`, we run
 * `onRefresh`. The spinner stays visible until the promise resolves.
 *
 * This is `position: relative` and only intercepts touchmove when at
 * the very top of the page — normal scrolling and horizontal swipes
 * are left alone.
 */
interface Props {
    onRefresh: () => Promise<void>;
    /** Disable entirely (e.g. during a known navigation transition). */
    disabled?: boolean;
    /** Pixels of pull required before the refresh fires. Default 80. */
    triggerDistance?: number;
    /** Max stretch shown for visual feedback. Default 120. */
    maxDistance?: number;
    children: React.ReactNode;
    isRTL?: boolean;
}

const PullToRefresh: React.FC<Props> = ({
    onRefresh,
    disabled = false,
    triggerDistance = 80,
    maxDistance = 120,
    children,
    isRTL = true,
}) => {
    const [pullDistance, setPullDistance] = useState(0);
    const [refreshing, setRefreshing] = useState(false);
    const startYRef = useRef<number | null>(null);
    const trackingRef = useRef(false);

    const atTop = () => {
        // We consider "at the top" to mean both the page scroll AND any
        // scrollable ancestor are at 0. document.scrollingElement covers
        // the common case (the page body).
        const se = document.scrollingElement || document.documentElement;
        return (se?.scrollTop ?? 0) <= 0 && (window.scrollY <= 0);
    };

    useEffect(() => {
        if (disabled) return;

        const onTouchStart = (e: TouchEvent) => {
            if (refreshing) return;
            if (!atTop()) {
                startYRef.current = null;
                trackingRef.current = false;
                return;
            }
            if (e.touches.length !== 1) return;
            startYRef.current = e.touches[0].clientY;
            trackingRef.current = true;
        };

        const onTouchMove = (e: TouchEvent) => {
            if (!trackingRef.current || startYRef.current == null) return;
            if (refreshing) return;
            const dy = e.touches[0].clientY - startYRef.current;
            if (dy <= 0) {
                setPullDistance(0);
                return;
            }
            // If we drift away from the very top mid-pull, abort.
            if (!atTop() && dy < 4) return;
            // Resistance: the further you pull, the harder it gets.
            const eased = Math.min(maxDistance, dy * 0.55);
            setPullDistance(eased);
            // Block the native overscroll bounce so the indicator stays
            // visually attached to the page top — only when we're
            // actively pulling, so non-pull scrolls aren't affected.
            if (dy > 6) e.preventDefault();
        };

        const onTouchEnd = async () => {
            if (!trackingRef.current) return;
            trackingRef.current = false;
            const distance = pullDistance;
            startYRef.current = null;
            if (refreshing) return;
            if (distance >= triggerDistance) {
                setRefreshing(true);
                setPullDistance(triggerDistance);
                // Cap the visible spinner at 700 ms so it ALWAYS feels
                // instant. Kick off the actual refresh in the background
                // and don't block the UI on it — on a slow link the data
                // will still update via the realtime channels seconds
                // later, no need to keep spinning at the user.
                const fired = Promise.resolve(onRefresh()).catch(() => {});
                const capped = new Promise(r => setTimeout(r, 700));
                await Promise.race([fired, capped]);
                setRefreshing(false);
                setPullDistance(0);
            } else {
                setPullDistance(0);
            }
        };

        // passive: false so preventDefault works for the bounce-block.
        document.addEventListener('touchstart', onTouchStart, { passive: true });
        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onTouchEnd, { passive: true });
        document.addEventListener('touchcancel', onTouchEnd, { passive: true });

        return () => {
            document.removeEventListener('touchstart', onTouchStart as any);
            document.removeEventListener('touchmove', onTouchMove as any);
            document.removeEventListener('touchend', onTouchEnd as any);
            document.removeEventListener('touchcancel', onTouchEnd as any);
        };
    }, [disabled, refreshing, pullDistance, triggerDistance, maxDistance, onRefresh]);

    const visible = pullDistance > 0 || refreshing;
    const ratio = Math.min(1, pullDistance / triggerDistance);
    const armed = pullDistance >= triggerDistance;

    return (
        <>
            {visible && (
                <div
                    aria-hidden
                    style={{
                        position: 'fixed',
                        top: `calc(env(safe-area-inset-top, 0px) + ${Math.max(4, pullDistance - 38)}px)`,
                        // `left: 50%` + translateX is the only reliably-
                        // centered combo across RTL/LTR. insetInlineStart
                        // flipped to the right edge in RTL, then the
                        // negative translate pushed the spinner toward the
                        // start of the line — visually it landed left of
                        // center on iPhone, not in the middle.
                        left: '50%',
                        transform: 'translateX(-50%)',
                        zIndex: 99998,
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        background: 'var(--card-bg, #ffffff)',
                        boxShadow: '0 6px 22px rgba(0,0,0,0.18)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: refreshing ? 'top 0.15s ease' : 'none',
                        opacity: Math.max(0.4, ratio),
                        pointerEvents: 'none',
                    }}
                >
                    {refreshing ? (
                        <div
                            style={{
                                width: 22,
                                height: 22,
                                borderRadius: '50%',
                                border: '2.5px solid var(--border-color, #e5e7eb)',
                                borderTopColor: '#10b981',
                                animation: 'taki-ptr-spin 0.8s linear infinite',
                            }}
                        />
                    ) : (
                        <div
                            style={{
                                fontSize: 18,
                                color: armed ? '#10b981' : 'var(--text-secondary, #94a3b8)',
                                transform: `rotate(${armed ? 180 : ratio * 180}deg)`,
                                transition: 'transform 0.12s linear, color 0.12s linear',
                                lineHeight: 1,
                            }}
                        >
                            ↓
                        </div>
                    )}
                </div>
            )}
            <style>{`
                @keyframes taki-ptr-spin { to { transform: rotate(360deg); } }
            `}</style>
            <div style={{ transform: `translateY(${Math.min(pullDistance, maxDistance)}px)`, transition: refreshing || pullDistance === 0 ? 'transform 0.12s cubic-bezier(0.2, 0.9, 0.3, 1)' : 'none' }}>
                {children}
            </div>
        </>
    );
};

export default PullToRefresh;
