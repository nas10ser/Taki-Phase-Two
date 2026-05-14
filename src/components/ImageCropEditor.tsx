import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Free-form image crop editor.
 *
 * UX:
 *   • Image is rendered fit-to-stage (object-fit: contain semantics).
 *   • The white crop frame is fully resizable from its 4 corner handles
 *     and movable by dragging anywhere inside it — no aspect lock.
 *   • Rotate button rotates the underlying image in 90° steps; the
 *     visible bounds and crop frame both reset to the new orientation.
 *
 * Why a full rewrite from v10.60:
 *   The previous pinch-zoom-over-fixed-frame model (Instagram-style) had
 *   two real bugs Nasser hit:
 *     - The image rendered at its natural pixel size for one frame
 *       before `onLoad` set the natural dimensions, blowing up the
 *       layout on iPhone captures (4032×3024) so the crop window was
 *       just a tiny black square with no visible image inside.
 *     - The aspect-ratio buttons were confusing and one of them
 *       (16:9) felt swapped on a portrait phone.
 *   The fit-to-stage + draggable-corners model is closer to iOS
 *   Photos and removes both classes of bug.
 *
 * Export:
 *   1. Rasterise the rotated image onto a temp canvas (upright frame).
 *   2. Crop the visible window from that temp canvas using the
 *      crop rect mapped from display-px to image-px.
 *   3. Encode JPEG q=0.9, capped at 1600 px on the longest side.
 */

type Crop = { x: number; y: number; w: number; h: number };

type Props = {
    file: File;
    queueIndex: number;
    queueTotal: number;
    isRTL: boolean;
    onApply: (file: File) => void;
    onSkip: () => void;
    onCancel: () => void;
};

const MIN_FRAME_PX = 60;

export const ImageCropEditor: React.FC<Props> = ({
    file, queueIndex, queueTotal, isRTL, onApply, onSkip, onCancel,
}) => {
    const [imgUrl, setImgUrl] = useState('');
    const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(null);
    const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
    const [stageSize, setStageSize] = useState<{ w: number; h: number }>({ w: 360, h: 540 });
    const [crop, setCrop] = useState<Crop>({ x: 0, y: 0, w: 0, h: 0 });
    const [loadFailed, setLoadFailed] = useState(false);
    const [exporting, setExporting] = useState(false);

    const stageRef = useRef<HTMLDivElement | null>(null);
    const dragRef = useRef<
        | { mode: 'move'; sx: number; sy: number; start: Crop }
        | { mode: 'resize'; corner: 'tl' | 'tr' | 'bl' | 'br'; sx: number; sy: number; start: Crop }
        | null
    >(null);

    // Lock body scroll while the editor is open.
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, []);

    // Load the picked File → object URL. Reset everything when the file changes.
    useEffect(() => {
        setImgNatural(null);
        setLoadFailed(false);
        setRotation(0);
        if (!file) {
            setImgUrl('');
            return;
        }
        const url = URL.createObjectURL(file);
        setImgUrl(url);
        return () => {
            URL.revokeObjectURL(url);
        };
    }, [file]);

    // Track stage size — both initial measure and live resize via ResizeObserver.
    useEffect(() => {
        const measure = () => {
            if (!stageRef.current) return;
            setStageSize({
                w: stageRef.current.clientWidth,
                h: stageRef.current.clientHeight,
            });
        };
        measure();
        let ro: ResizeObserver | null = null;
        if (typeof ResizeObserver !== 'undefined' && stageRef.current) {
            ro = new ResizeObserver(measure);
            ro.observe(stageRef.current);
        }
        window.addEventListener('resize', measure);
        return () => {
            window.removeEventListener('resize', measure);
            ro?.disconnect();
        };
    }, []);

    // Geometry of the displayed (rotated) image inside the stage. All four
    // are derived from imgNatural + rotation + stageSize so there's no state
    // to keep in sync.
    const isRotated = rotation === 90 || rotation === 270;
    const visualNW = imgNatural ? (isRotated ? imgNatural.h : imgNatural.w) : 0;
    const visualNH = imgNatural ? (isRotated ? imgNatural.w : imgNatural.h) : 0;
    const fitScale = (visualNW && visualNH && stageSize.w && stageSize.h)
        ? Math.min(stageSize.w / visualNW, stageSize.h / visualNH)
        : 0;
    const displayW = visualNW * fitScale;
    const displayH = visualNH * fitScale;
    const displayX = (stageSize.w - displayW) / 2;
    const displayY = (stageSize.h - displayH) / 2;

    // (Re)initialise the crop frame whenever the displayed image's box changes.
    // The frame starts at 90% of the image, centered — gives the seller an
    // obvious target to grab without making them think.
    useEffect(() => {
        if (!displayW || !displayH) return;
        const margin = 0.05;
        setCrop({
            x: displayW * margin,
            y: displayH * margin,
            w: displayW * (1 - margin * 2),
            h: displayH * (1 - margin * 2),
        });
    }, [displayW, displayH]);

    // ===== Touch + mouse drag handlers =====
    // The stage receives all gestures. Hit-testing decides whether the user
    // is grabbing a corner (resize) or the body of the frame (move).
    const pointFromEvent = (clientX: number, clientY: number) => {
        const rect = stageRef.current!.getBoundingClientRect();
        return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const hitTest = (sx: number, sy: number):
        | { kind: 'corner'; corner: 'tl' | 'tr' | 'bl' | 'br' }
        | { kind: 'move' }
        | null => {
        const fx = displayX + crop.x;
        const fy = displayY + crop.y;
        const fw = crop.w;
        const fh = crop.h;
        const corners: Array<{ name: 'tl' | 'tr' | 'bl' | 'br'; x: number; y: number }> = [
            { name: 'tl', x: fx,      y: fy },
            { name: 'tr', x: fx + fw, y: fy },
            { name: 'bl', x: fx,      y: fy + fh },
            { name: 'br', x: fx + fw, y: fy + fh },
        ];
        for (const c of corners) {
            if (Math.hypot(sx - c.x, sy - c.y) < 36) {
                return { kind: 'corner', corner: c.name };
            }
        }
        if (sx >= fx && sx <= fx + fw && sy >= fy && sy <= fy + fh) {
            return { kind: 'move' };
        }
        return null;
    };

    const beginDrag = (sx: number, sy: number) => {
        const hit = hitTest(sx, sy);
        if (!hit) return;
        if (hit.kind === 'corner') {
            dragRef.current = { mode: 'resize', corner: hit.corner, sx, sy, start: { ...crop } };
        } else {
            dragRef.current = { mode: 'move', sx, sy, start: { ...crop } };
        }
    };

    const updateDrag = (sx: number, sy: number) => {
        if (!dragRef.current) return;
        const d = dragRef.current;
        const dx = sx - d.sx;
        const dy = sy - d.sy;
        const s = d.start;
        if (d.mode === 'move') {
            setCrop({
                x: Math.max(0, Math.min(displayW - s.w, s.x + dx)),
                y: Math.max(0, Math.min(displayH - s.h, s.y + dy)),
                w: s.w,
                h: s.h,
            });
            return;
        }
        // resize — each corner pulls in its own direction. We clamp BOTH to
        // the displayed image bounds AND to a minimum size, taking care to
        // hold the opposite corner stationary.
        let nx = s.x, ny = s.y, nw = s.w, nh = s.h;
        const rightAnchorX = s.x + s.w;
        const bottomAnchorY = s.y + s.h;
        switch (d.corner) {
            case 'br': {
                nw = Math.max(MIN_FRAME_PX, Math.min(displayW - s.x, s.w + dx));
                nh = Math.max(MIN_FRAME_PX, Math.min(displayH - s.y, s.h + dy));
                break;
            }
            case 'tl': {
                const newX = Math.max(0, Math.min(rightAnchorX - MIN_FRAME_PX, s.x + dx));
                const newY = Math.max(0, Math.min(bottomAnchorY - MIN_FRAME_PX, s.y + dy));
                nx = newX; ny = newY;
                nw = rightAnchorX - newX;
                nh = bottomAnchorY - newY;
                break;
            }
            case 'tr': {
                const newY = Math.max(0, Math.min(bottomAnchorY - MIN_FRAME_PX, s.y + dy));
                ny = newY;
                nh = bottomAnchorY - newY;
                nw = Math.max(MIN_FRAME_PX, Math.min(displayW - s.x, s.w + dx));
                break;
            }
            case 'bl': {
                const newX = Math.max(0, Math.min(rightAnchorX - MIN_FRAME_PX, s.x + dx));
                nx = newX;
                nw = rightAnchorX - newX;
                nh = Math.max(MIN_FRAME_PX, Math.min(displayH - s.y, s.h + dy));
                break;
            }
        }
        setCrop({ x: nx, y: ny, w: nw, h: nh });
    };

    const endDrag = () => { dragRef.current = null; };

    const onTouchStart = (e: React.TouchEvent) => {
        if (e.touches.length !== 1) return;
        const p = pointFromEvent(e.touches[0].clientX, e.touches[0].clientY);
        beginDrag(p.x, p.y);
    };
    const onTouchMove = (e: React.TouchEvent) => {
        if (!dragRef.current || e.touches.length !== 1) return;
        e.preventDefault();
        const p = pointFromEvent(e.touches[0].clientX, e.touches[0].clientY);
        updateDrag(p.x, p.y);
    };
    const onMouseDown = (e: React.MouseEvent) => {
        const p = pointFromEvent(e.clientX, e.clientY);
        beginDrag(p.x, p.y);
    };
    const onMouseMove = (e: React.MouseEvent) => {
        if (!dragRef.current) return;
        const p = pointFromEvent(e.clientX, e.clientY);
        updateDrag(p.x, p.y);
    };

    // ===== Apply: render cropped output to canvas → File =====
    const apply = async () => {
        if (!imgNatural || !imgUrl || exporting || !fitScale) return;
        setExporting(true);
        try {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error('decode_failed'));
                img.src = imgUrl;
            });

            // Step 1 — rotate the source image into an upright temp canvas
            // sized at the post-rotation natural pixel dimensions. After this
            // we don't have to worry about rotation again.
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = visualNW;
            tempCanvas.height = visualNH;
            const tCtx = tempCanvas.getContext('2d');
            if (!tCtx) throw new Error('no_ctx');
            tCtx.translate(visualNW / 2, visualNH / 2);
            tCtx.rotate((rotation * Math.PI) / 180);
            tCtx.drawImage(img, -imgNatural.w / 2, -imgNatural.h / 2);

            // Step 2 — map the crop rect from display-px to image-natural-px
            // by dividing by the fit scale.
            const sx = crop.x / fitScale;
            const sy = crop.y / fitScale;
            const sw = crop.w / fitScale;
            const sh = crop.h / fitScale;

            // Step 3 — size the output canvas, capped at 1600 px on the
            // longest side. Bigger doesn't add visible detail on a phone.
            const MAX = 1600;
            let outW = Math.round(sw);
            let outH = Math.round(sh);
            if (Math.max(outW, outH) > MAX) {
                const k = MAX / Math.max(outW, outH);
                outW = Math.round(outW * k);
                outH = Math.round(outH * k);
            }
            outW = Math.max(1, outW);
            outH = Math.max(1, outH);

            const outCanvas = document.createElement('canvas');
            outCanvas.width = outW;
            outCanvas.height = outH;
            const oCtx = outCanvas.getContext('2d');
            if (!oCtx) throw new Error('no_ctx');
            oCtx.imageSmoothingEnabled = true;
            oCtx.imageSmoothingQuality = 'high';
            oCtx.drawImage(
                tempCanvas,
                Math.max(0, sx), Math.max(0, sy),
                Math.min(visualNW - Math.max(0, sx), sw),
                Math.min(visualNH - Math.max(0, sy), sh),
                0, 0, outW, outH
            );

            const blob: Blob | null = await new Promise(r =>
                outCanvas.toBlob(r, 'image/jpeg', 0.9)
            );
            if (!blob) throw new Error('encode_failed');
            const safeBase = (file.name.replace(/\.[^.]+$/, '') || 'image');
            const out = new File([blob], safeBase + '.jpg', { type: 'image/jpeg' });
            onApply(out);
        } catch (err) {
            console.error('Crop apply failed:', err);
            // Fail open — upload the original rather than blocking the seller.
            onSkip();
        } finally {
            setExporting(false);
        }
    };

    // ===== Render =====
    const headerH = 'calc(env(safe-area-inset-top, 12px) + 60px)';
    const footerH = 'calc(env(safe-area-inset-bottom, 12px) + 76px)';

    const cornerStyle: React.CSSProperties = {
        position: 'absolute',
        width: 22, height: 22,
        background: '#fff',
        border: '2px solid #0f172a',
        borderRadius: 11,
        boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
        pointerEvents: 'none',
    };

    const node = (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 99998,
            background: '#000',
            display: 'flex', flexDirection: 'column',
            color: 'white',
            overscrollBehavior: 'contain',
        }}>
            {/* Header */}
            <div style={{
                height: headerH,
                paddingTop: 'env(safe-area-inset-top, 12px)',
                paddingLeft: 16, paddingRight: 16,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                background: '#000',
                position: 'relative', zIndex: 2,
            }}>
                <button
                    onClick={onCancel}
                    aria-label={isRTL ? 'إلغاء' : 'Cancel'}
                    style={{
                        background: 'rgba(255,255,255,0.08)', color: 'white',
                        border: '1px solid rgba(255,255,255,0.15)',
                        width: 44, height: 44, borderRadius: 22,
                        fontSize: '1.3rem', fontWeight: 900, cursor: 'pointer'
                    }}
                >✕</button>
                <div style={{ fontWeight: 900, fontSize: '0.95rem' }}>
                    {isRTL ? `قص الصورة ${queueIndex}/${queueTotal}` : `Crop ${queueIndex}/${queueTotal}`}
                </div>
                <button
                    onClick={() => setRotation(r => ((r + 90) % 360) as 0 | 90 | 180 | 270)}
                    aria-label={isRTL ? 'تدوير' : 'Rotate'}
                    style={{
                        background: 'rgba(255,255,255,0.08)', color: 'white',
                        border: '1px solid rgba(255,255,255,0.15)',
                        width: 44, height: 44, borderRadius: 22,
                        fontSize: '1.2rem', fontWeight: 900, cursor: 'pointer'
                    }}
                >↻</button>
            </div>

            {/* Stage */}
            <div
                ref={stageRef}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={endDrag}
                onTouchCancel={endDrag}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={endDrag}
                onMouseLeave={endDrag}
                style={{
                    flex: 1, position: 'relative', overflow: 'hidden',
                    touchAction: 'none', userSelect: 'none',
                    background: '#000',
                }}
            >
                {/* The image itself — sized to displayed dimensions and rotated
                    around its center. Hidden until imgNatural is known so the
                    user never sees a giant unscaled flash. */}
                {imgUrl && !loadFailed && (
                    <img
                        src={imgUrl}
                        alt=""
                        draggable={false}
                        onLoad={(e) => {
                            const el = e.currentTarget;
                            if (el.naturalWidth > 0 && el.naturalHeight > 0) {
                                setImgNatural({ w: el.naturalWidth, h: el.naturalHeight });
                            } else {
                                setLoadFailed(true);
                            }
                        }}
                        onError={() => setLoadFailed(true)}
                        style={{
                            position: 'absolute',
                            left: '50%', top: '50%',
                            width: imgNatural ? imgNatural.w * fitScale : 1,
                            height: imgNatural ? imgNatural.h * fitScale : 1,
                            transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                            transformOrigin: 'center center',
                            pointerEvents: 'none',
                            opacity: imgNatural ? 1 : 0,
                            transition: 'opacity 0.15s ease',
                            maxWidth: 'none',
                            maxHeight: 'none',
                            display: 'block',
                        }}
                    />
                )}

                {/* Loading state */}
                {imgUrl && !imgNatural && !loadFailed && (
                    <div style={{
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'rgba(255,255,255,0.7)', fontWeight: 800, fontSize: '0.9rem',
                        pointerEvents: 'none',
                    }}>
                        {isRTL ? '⏳ جاري تحضير الصورة...' : '⏳ Preparing image...'}
                    </div>
                )}

                {/* Decode-failed state — let the seller upload the original or skip. */}
                {loadFailed && (
                    <div style={{
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: 24, textAlign: 'center',
                    }}>
                        <div style={{
                            background: 'rgba(255,255,255,0.06)', borderRadius: 16,
                            border: '1px solid rgba(255,255,255,0.12)',
                            padding: 20, maxWidth: 320,
                        }}>
                            <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>🖼️</div>
                            <div style={{ fontWeight: 900, fontSize: '1rem', marginBottom: 6 }}>
                                {isRTL ? 'تعذّر عرض الصورة' : 'Failed to display image'}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)', lineHeight: 1.6, marginBottom: 14 }}>
                                {isRTL
                                    ? 'يمكنك رفعها بدون قص أو إلغاؤها.'
                                    : 'You can upload it uncropped or cancel.'}
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                    onClick={onCancel}
                                    style={{
                                        flex: 1, padding: '10px', borderRadius: 12,
                                        background: 'rgba(255,255,255,0.08)', color: 'white',
                                        border: '1px solid rgba(255,255,255,0.15)',
                                        fontWeight: 900, fontSize: '0.85rem', cursor: 'pointer'
                                    }}
                                >{isRTL ? 'إلغاء' : 'Cancel'}</button>
                                <button
                                    onClick={onSkip}
                                    style={{
                                        flex: 1, padding: '10px', borderRadius: 12,
                                        background: 'var(--primary, #0284c7)', color: 'white',
                                        border: 'none',
                                        fontWeight: 900, fontSize: '0.85rem', cursor: 'pointer'
                                    }}
                                >{isRTL ? 'رفع بدون قص' : 'Upload anyway'}</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Crop frame + dark outside-the-frame overlay. Rendered only
                    once the image is loaded so corners line up with real pixels. */}
                {imgNatural && (
                    <>
                        <div
                            aria-hidden="true"
                            style={{
                                position: 'absolute',
                                left: displayX + crop.x,
                                top: displayY + crop.y,
                                width: crop.w,
                                height: crop.h,
                                boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
                                border: '2px solid rgba(255,255,255,0.95)',
                                borderRadius: 4,
                                pointerEvents: 'none',
                            }}
                        >
                            {/* Rule-of-thirds guides */}
                            <div style={{
                                position: 'absolute', inset: 0,
                                pointerEvents: 'none',
                                backgroundImage:
                                    'linear-gradient(to right, transparent calc(33.33% - 0.5px), rgba(255,255,255,0.35) calc(33.33% - 0.5px) calc(33.33% + 0.5px), transparent calc(33.33% + 0.5px), transparent calc(66.66% - 0.5px), rgba(255,255,255,0.35) calc(66.66% - 0.5px) calc(66.66% + 0.5px), transparent calc(66.66% + 0.5px)),' +
                                    'linear-gradient(to bottom, transparent calc(33.33% - 0.5px), rgba(255,255,255,0.35) calc(33.33% - 0.5px) calc(33.33% + 0.5px), transparent calc(33.33% + 0.5px), transparent calc(66.66% - 0.5px), rgba(255,255,255,0.35) calc(66.66% - 0.5px) calc(66.66% + 0.5px), transparent calc(66.66% + 0.5px))'
                            }} />
                        </div>
                        {/* Corner handles — visual only; hit-testing is done in
                            the stage handler using crop+displayBox geometry. */}
                        {([
                            { name: 'tl', x: displayX + crop.x - 11,           y: displayY + crop.y - 11 },
                            { name: 'tr', x: displayX + crop.x + crop.w - 11,  y: displayY + crop.y - 11 },
                            { name: 'bl', x: displayX + crop.x - 11,           y: displayY + crop.y + crop.h - 11 },
                            { name: 'br', x: displayX + crop.x + crop.w - 11,  y: displayY + crop.y + crop.h - 11 },
                        ] as const).map(c => (
                            <div key={c.name} style={{ ...cornerStyle, left: c.x, top: c.y }} />
                        ))}
                    </>
                )}
            </div>

            {/* Bottom action bar */}
            <div style={{
                height: footerH,
                paddingBottom: 'env(safe-area-inset-bottom, 12px)',
                paddingLeft: 16, paddingRight: 16, paddingTop: 12,
                display: 'flex', gap: 10,
                borderTop: '1px solid rgba(255,255,255,0.08)',
                background: '#000',
                position: 'relative', zIndex: 2,
            }}>
                <button
                    onClick={onSkip}
                    disabled={exporting}
                    style={{
                        flex: 1, padding: '14px',
                        background: 'rgba(255,255,255,0.08)',
                        color: 'white', border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: 14, fontWeight: 900, fontSize: '0.95rem',
                        cursor: exporting ? 'default' : 'pointer'
                    }}
                >
                    {isRTL ? 'تخطّي القص' : 'Skip crop'}
                </button>
                <button
                    onClick={apply}
                    disabled={exporting || !imgNatural || loadFailed}
                    style={{
                        flex: 2, padding: '14px',
                        background: (exporting || !imgNatural || loadFailed) ? '#475569' : 'var(--primary, #0284c7)',
                        color: 'white', border: 'none',
                        borderRadius: 14, fontWeight: 900, fontSize: '0.95rem',
                        cursor: (exporting || !imgNatural || loadFailed) ? 'default' : 'pointer',
                        boxShadow: '0 8px 24px rgba(2, 132, 199, 0.35)'
                    }}
                >
                    {exporting
                        ? (isRTL ? 'جاري المعالجة...' : 'Processing...')
                        : (isRTL ? '✓ تطبيق ومتابعة' : '✓ Apply & continue')}
                </button>
            </div>
        </div>
    );

    return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
};

export default ImageCropEditor;
