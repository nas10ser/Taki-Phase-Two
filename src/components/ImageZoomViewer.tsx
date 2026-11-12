/**
 * ImageZoomViewer — مُكبِّرُ صور العرض (خرج من DealDetails في v15.71)
 * ═══════════════════════════════════════════════════════════════════════════
 * ٣٣٥ سطراً كانت داخل صفحةٍ بـ٣٨٣٨ سطراً، ولا تستعمل معرَّفاً واحداً من
 * الصفحة — فإخراجُها لم يكسر شيئاً وجعل الاثنين مقروءين.
 *
 * 🪤 وما أخرجها **السقّافة** (`check-file-size.js`): رفضت نموَّ الصفحة
 *    بأحدَ عشر سطراً، والقاعدةُ عند الرفض «قلّص لا ترفع السقف». فالسقّافةُ
 *    تُجبر على التصميم الصحيح لا تعيقه — وهذا ثالثُ موضعٍ في المشروع
 *    يُصلحه رفضُها.
 */
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { sizedUrl, heroUrl } from '../utils/thumb';
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
    const [zoomFailedTransform, setZoomFailedTransform] = useState(false);
    // Clamp so a shrunk images[] can never render an out-of-range "4 / 3".
    const idx = Math.min(Math.max(index, 0), Math.max(0, images.length - 1));
    // تُصفَّر مع كل صورة، وإلّا بقي المُكبِّرُ على الأصل الكامل لكلّ ما بعدها.
    React.useEffect(() => { setZoomFailedTransform(false); }, [idx]);

    /**
     * 🔴 v16.14 — **طبقتان: ما هو في يد المتصفّح أوّلاً، ثمّ الأعلى دقّةً.**
     * (بلاغُ ناصر: «عند فتح أيّ صورة تتأخّر في الفتح، تجلس تلفّ».)
     *
     * القياسُ من الإنتاج على صورةٍ حقيقيّة:
     *   · `_h.jpg` الثابت  — ١٢٠ ك.ب · ١٦٤ م.ث · **صفرُ معالجٍ على الخادم**
     *     و**هو نفسُه ما رسمته صفحةُ العرض خلفَ العارض** ⇒ في مخزن المتصفّح.
     *   · تحويلُ ١٦٠٠    — ٢٦٤ ك.ب · ٤٨٠–٩١٤ م.ث · ولا يُخزَّن على الخادم
     *     إطلاقاً (قِيس: الطلبُ الثاني بنفس زمن الأوّل) ⇒ كلُّ فتحةِ مُكبِّر
     *     كانت تُجبر تحويلاً جديداً على **نواةٍ واحدة**، والمستخدمُ ينتظر.
     *
     * ⇒ يُفتح المُكبِّرُ على الطبقة الجاهزة **فوراً وبصفر بايت**، ويُحمَّل
     *   الأعلى دقّةً في الخلفية فيُبدَّل حين يجهز — بلا دوّارةٍ وبلا وميض
     *   (`key` لا يتغيّر فلا يُعاد تركيبُ العنصر).
     * 🪤 ولا يُحمَّل الأعلى إن كان **نفسَ** العنوان (صورةٌ ليست من مستودعنا)
     *    — وإلّا طلبناه مرّتين بلا فائدة.
     */
    const [hiResFor, setHiResFor] = useState('');
    React.useEffect(() => {
        const u = images[idx] || '';
        const hi = u ? sizedUrl(u, 1600, 78) : '';
        if (!u || !hi || hi === heroUrl(u)) { setHiResFor(hi ? u : ''); return; }
        let alive = true;
        const im = new Image();
        im.onload = () => { if (alive) setHiResFor(u); };
        im.src = hi;
        return () => { alive = false; im.onload = null; };
    }, [idx, images]);
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
    // تسخين ذاكرة المتصفّح ليكون التنقّل فورياً بلا فجوة سوداء (v11.35).
    // v14.14 — **الجاران فقط** لا كل الصور: كان فتح العارض يبدأ تحميل كل صور
    // العرض بحجمها الكامل دفعةً واحدة (أكبر صورة مقيسة ٨٫٥ ميجابايت)، فتزدحم
    // الشبكة ويتأخّر ظهور الصورة التي يطلبها المستخدم فعلاً. الجار الواحد
    // يكفي: التنقّل خطوة بخطوة، ولا أحد يقفز عشر صور دفعة.
    React.useEffect(() => {
        const warm = (i: number) => {
            const src = images[i];
            if (!src) return;
            try { const im = new Image(); im.decoding = 'async'; im.src = src; } catch { /* ignore */ }
        };
        warm(index + 1);
        warm(index - 1);
    }, [images, index]);

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
                    /* الجاهزُ أوّلاً ثمّ ١٦٠٠ بكسلاً، ثمّ ارتدادٌ للأصل عند الفشل */
                    src={zoomFailedTransform ? images[idx]
                        : (hiResFor === images[idx]
                            ? sizedUrl(images[idx], 1600, 78)
                            : heroUrl(images[idx]))}
                    alt=""
                    onError={() => {
                        if (!zoomFailedTransform) { setZoomFailedTransform(true); return; }
                        setImgError(true); setImgLoading(false);
                    }}
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

export default ImageZoomViewer;
