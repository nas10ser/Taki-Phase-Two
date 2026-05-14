import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Free-form image crop editor.
 *
 * v10.63 — caller pre-decodes the picked File and hands the editor a
 * data URL + natural dimensions. The editor therefore opens with the
 * image already visible (no "preparing image" state, no fade-in, no
 * "couldn't display" fallback). From the seller's perspective the
 * crop feels like a continuation of the iOS "Use Photo" screen
 * instead of a second, slower page.
 *
 * UX:
 *   • Image renders fit-to-stage (object-fit: contain semantics).
 *   • The white crop frame is fully resizable from its 4 corner handles
 *     and movable by dragging anywhere inside it — no aspect lock.
 *   • Rotate button rotates the underlying image in 90° steps; the
 *     visible bounds and crop frame both reset to the new orientation.
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
    dataUrl: string;
    naturalW: number;
    naturalH: number;
    queueIndex: number;
    queueTotal: number;
    isRTL: boolean;
    onApply: (file: File) => void;
    onSkip: () => void;
    onCancel: () => void;
};

const MIN_FRAME_PX = 60;

export const ImageCropEditor: React.FC<Props> = ({
    file, dataUrl, naturalW, naturalH,
    queueIndex, queueTotal, isRTL,
    onApply, onSkip, onCancel,
}) => {
    const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
    const [stageSize, setStageSize] = useState<{ w: number; h: number }>({ w: 360, h: 540 });
    const [crop, setCrop] = useState<Crop>({ x: 0, y: 0, w: 0, h: 0 });
    const [exporting, setExporting] = useState(false);

    // Synchronously-readable re-entry guard. v10.66 — without this, tapping
    // "تطبيق ومتابعة" (or "تخطّي القص") multiple times in quick succession
    // before the parent's upload finished would call `onApply` / `onSkip`
    // multiple times, queueing the same File N times → the same photo
    // landed in the seller's image grid four times.
    // useRef is read/written synchronously, so the second tap sees the
    // guard already set even if React hasn't re-rendered yet.
    const dispatchingRef = useRef(false);
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

    // Reset rotation + dispatch guard when the source file changes
    // (queue advance). dispatchingRef must clear here so the seller can
    // act on the NEXT photo immediately after applying the previous one.
    useEffect(() => {
        setRotation(0);
        dispatchingRef.current = false;
    }, [file]);

    // Track stage size — initial synchronous measure via useLayoutEffect
    // (so the first paint already has correct geometry, no flicker) plus
    // ResizeObserver for orientation changes.
    useLayoutEffect(() => {
        if (!stageRef.current) return;
        setStageSize({
            w: stageRef.current.clientWidth,
            h: stageRef.current.clientHeight,
        });
    }, []);
    useEffect(() => {
        const measure = () => {
            if (!stageRef.current) return;
            setStageSize({
                w: stageRef.current.clientWidth,
                h: stageRef.current.clientHeight,
            });
        };
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

    // Geometry of the displayed (rotated) image inside the stage.
    const isRotated = rotation === 90 || rotation === 270;
    const visualNW = isRotated ? naturalH : naturalW;
    const visualNH = isRotated ? naturalW : naturalH;
    const fitScale = (visualNW && visualNH && stageSize.w && stageSize.h)
        ? Math.min(stageSize.w / visualNW, stageSize.h / visualNH)
        : 0;
    const displayW = visualNW * fitScale;
    const displayH = visualNH * fitScale;
    const displayX = (stageSize.w - displayW) / 2;
    const displayY = (stageSize.h - displayH) / 2;

    // (Re)initialise the crop frame whenever the displayed image's box changes.
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

    // Wrap onSkip/onCancel with the same re-entry guard as apply() so any
    // of the three terminal actions can only fire once per (queue item).
    const handleSkip = () => {
        if (dispatchingRef.current) return;
        dispatchingRef.current = true;
        onSkip();
    };
    const handleCancel = () => {
        if (dispatchingRef.current) return;
        dispatchingRef.current = true;
        onCancel();
    };

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
        if (dispatchingRef.current || exporting || !fitScale) return;
        dispatchingRef.current = true;
        setExporting(true);
        try {
            const img = new Image();
            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error('decode_failed'));
                img.src = dataUrl;
            });

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = visualNW;
            tempCanvas.height = visualNH;
            const tCtx = tempCanvas.getContext('2d');
            if (!tCtx) throw new Error('no_ctx');
            tCtx.translate(visualNW / 2, visualNH / 2);
            tCtx.rotate((rotation * Math.PI) / 180);
            tCtx.drawImage(img, -naturalW / 2, -naturalH / 2);

            const sx = crop.x / fitScale;
            const sy = crop.y / fitScale;
            const sw = crop.w / fitScale;
            const sh = crop.h / fitScale;

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
                    onClick={handleCancel}
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
                {/* Image — dimensions known from props, so it renders at the
                    correct fit-to-stage size on the very first paint. */}
                <img
                    src={dataUrl}
                    alt=""
                    draggable={false}
                    style={{
                        position: 'absolute',
                        left: '50%', top: '50%',
                        width: naturalW * fitScale,
                        height: naturalH * fitScale,
                        transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                        transformOrigin: 'center center',
                        pointerEvents: 'none',
                        maxWidth: 'none',
                        maxHeight: 'none',
                        display: 'block',
                    }}
                />

                {/* Crop frame + dark outside-the-frame overlay. */}
                {displayW > 0 && displayH > 0 && (
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
                    onClick={handleSkip}
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
                    disabled={exporting}
                    style={{
                        flex: 2, padding: '14px',
                        background: exporting ? '#475569' : 'var(--primary, #0284c7)',
                        color: 'white', border: 'none',
                        borderRadius: 14, fontWeight: 900, fontSize: '0.95rem',
                        cursor: exporting ? 'default' : 'pointer',
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
