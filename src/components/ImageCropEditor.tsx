import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Mobile-first image crop editor. Shown after the seller picks/snaps a
 * photo for an Add Deal so they can frame the product, fix rotation, and
 * downscale to a sane resolution before upload.
 *
 * Gestures
 *   • Single-finger drag → pan the image inside the crop frame.
 *   • Two-finger pinch  → zoom (min = fits frame, max = 5×).
 *   • Mouse wheel       → zoom (desktop fallback).
 *
 * Output
 *   • Always a JPEG ≤ 1600 px on the longest side, quality 0.9.
 *   • Aspect ratio: 1 (default, marketplace-friendly) / 4:3 / 16:9 / free.
 *   • Rotation: in 90° steps via the ↻ button.
 *
 * Why custom instead of `react-image-crop`?
 *   Adding 50 KB of dependency for one screen is overkill, and the
 *   gesture model here mirrors `ImageZoomViewer` so the seller's muscle
 *   memory carries over.
 */

type Aspect = number | 'free';

const ASPECTS: { label: string; value: Aspect }[] = [
    { label: '1:1', value: 1 },
    { label: '4:3', value: 4 / 3 },
    { label: '16:9', value: 16 / 9 },
    { label: 'حر', value: 'free' },
];

type Props = {
    file: File;
    queueIndex: number;    // 1-based position in the current batch (for "1/3")
    queueTotal: number;
    isRTL: boolean;
    onApply: (file: File) => void;
    onSkip: () => void;     // upload original unchanged
    onCancel: () => void;   // drop this file entirely
};

export const ImageCropEditor: React.FC<Props> = ({
    file, queueIndex, queueTotal, isRTL, onApply, onSkip, onCancel,
}) => {
    const [imgUrl, setImgUrl] = useState<string>('');
    const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(null);
    const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
    const [aspect, setAspect] = useState<Aspect>(1);
    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [exporting, setExporting] = useState(false);

    const stageRef = useRef<HTMLDivElement | null>(null);
    const pinchDistRef = useRef<number | null>(null);
    const panRef = useRef<{ x: number; y: number } | null>(null);

    // Lock body scroll while the editor is open.
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, []);

    // Load the picked file into an object URL once; release it on unmount or
    // when a different file is dropped in.
    useEffect(() => {
        const url = URL.createObjectURL(file);
        setImgUrl(url);
        setRotation(0);
        setAspect(1);
        setScale(1);
        setOffset({ x: 0, y: 0 });
        return () => URL.revokeObjectURL(url);
    }, [file]);

    // Compute the crop frame size in CSS pixels — a square (or chosen ratio)
    // inscribed into the available stage area with a comfy 16 px margin.
    const [frameSize, setFrameSize] = useState<{ w: number; h: number }>({ w: 320, h: 320 });
    useEffect(() => {
        const compute = () => {
            const stage = stageRef.current;
            if (!stage) return;
            const padding = 32;
            const availW = stage.clientWidth - padding;
            const availH = stage.clientHeight - padding;
            const ratio = aspect === 'free' ? 1 : aspect;
            let w = availW;
            let h = w / ratio;
            if (h > availH) {
                h = availH;
                w = h * ratio;
            }
            setFrameSize({ w: Math.floor(w), h: Math.floor(h) });
        };
        compute();
        window.addEventListener('resize', compute);
        return () => window.removeEventListener('resize', compute);
    }, [aspect]);

    // Touch + wheel gesture handlers. Keep them simple: pan when 1 finger,
    // pinch when 2 fingers. No fancy momentum — the seller is composing a
    // crop, not scrubbing through a feed.
    const onTouchStart = (e: React.TouchEvent) => {
        if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            pinchDistRef.current = Math.hypot(dx, dy);
        } else if (e.touches.length === 1) {
            panRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
    };
    const onTouchMove = (e: React.TouchEvent) => {
        e.preventDefault();
        if (e.touches.length === 2 && pinchDistRef.current) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.hypot(dx, dy);
            setScale(s => Math.min(5, Math.max(1, s * (dist / pinchDistRef.current!))));
            pinchDistRef.current = dist;
        } else if (e.touches.length === 1 && panRef.current) {
            const dx = e.touches[0].clientX - panRef.current.x;
            const dy = e.touches[0].clientY - panRef.current.y;
            setOffset(o => ({ x: o.x + dx, y: o.y + dy }));
            panRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
    };
    const onTouchEnd = () => {
        pinchDistRef.current = null;
        panRef.current = null;
    };
    const onWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        setScale(s => Math.min(5, Math.max(1, s - e.deltaY * 0.002)));
    };

    // ===== Apply: render to canvas with the final rotation, then export =====
    // Two-step: (1) rasterise the image rotated into an upright temp canvas,
    // (2) crop the visible window from that temp canvas. Keeps the
    // screen-to-pixel math one-dimensional regardless of rotation.
    const apply = async () => {
        if (!imgNatural || !imgUrl || exporting) return;
        setExporting(true);
        try {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error('decode_failed'));
                img.src = imgUrl;
            });

            // Step 1 — rotate into an upright tempCanvas. After this, the
            // tempCanvas dimensions match the visually upright orientation
            // and we no longer have to think about `rotation`.
            const rot = rotation % 360;
            const rotated = rot === 90 || rot === 270;
            const tempW = rotated ? img.naturalHeight : img.naturalWidth;
            const tempH = rotated ? img.naturalWidth : img.naturalHeight;
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = tempW;
            tempCanvas.height = tempH;
            const tCtx = tempCanvas.getContext('2d')!;
            tCtx.translate(tempW / 2, tempH / 2);
            tCtx.rotate((rot * Math.PI) / 180);
            tCtx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

            // Step 2 — figure out which rectangle of tempCanvas the crop
            // frame currently sees. baseScale is the same calculation as
            // the display layer so the export matches the live preview.
            const baseScale = Math.max(frameSize.w / tempW, frameSize.h / tempH);
            const displayedW = tempW * baseScale * scale;
            const displayedH = tempH * baseScale * scale;
            // Crop frame is centered on stage; image is centered + offset.
            // Frame's top-left in temp-image pixel coords:
            const sx = (displayedW / 2 - frameSize.w / 2 - offset.x) / (baseScale * scale);
            const sy = (displayedH / 2 - frameSize.h / 2 - offset.y) / (baseScale * scale);
            const sW = frameSize.w / (baseScale * scale);
            const sH = frameSize.h / (baseScale * scale);

            // Output canvas — cap longest side at 1600 px to keep the
            // upload payload reasonable on mobile data.
            const MAX = 1600;
            let outW = Math.round(sW);
            let outH = Math.round(sH);
            if (Math.max(outW, outH) > MAX) {
                const k = MAX / Math.max(outW, outH);
                outW = Math.round(outW * k);
                outH = Math.round(outH * k);
            }
            const outCanvas = document.createElement('canvas');
            outCanvas.width = outW;
            outCanvas.height = outH;
            const oCtx = outCanvas.getContext('2d')!;
            oCtx.fillStyle = '#000';
            oCtx.fillRect(0, 0, outW, outH);
            oCtx.imageSmoothingEnabled = true;
            oCtx.imageSmoothingQuality = 'high';
            // Clamp the source rect so pan-out-of-bounds gets a black bar
            // instead of CanvasRenderingContext throwing.
            const clampedSX = Math.max(0, Math.min(tempW, sx));
            const clampedSY = Math.max(0, Math.min(tempH, sy));
            const clampedSW = Math.max(1, Math.min(tempW - clampedSX, sW));
            const clampedSH = Math.max(1, Math.min(tempH - clampedSY, sH));
            const dx = ((clampedSX - sx) / sW) * outW;
            const dy = ((clampedSY - sy) / sH) * outH;
            const dw = (clampedSW / sW) * outW;
            const dh = (clampedSH / sH) * outH;
            oCtx.drawImage(tempCanvas,
                clampedSX, clampedSY, clampedSW, clampedSH,
                dx, dy, dw, dh
            );

            const blob: Blob | null = await new Promise(resolve =>
                outCanvas.toBlob(resolve, 'image/jpeg', 0.9)
            );
            if (!blob) throw new Error('encode_failed');
            const out = new File(
                [blob],
                (file.name.replace(/\.[^.]+$/, '') || 'image') + '.jpg',
                { type: 'image/jpeg' }
            );
            onApply(out);
        } catch (err) {
            console.error('Crop apply failed:', err);
            // Fail open — upload original rather than blocking the seller.
            onSkip();
        } finally {
            setExporting(false);
        }
    };

    const node = (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 99998,
            background: 'rgba(0,0,0,0.95)',
            display: 'flex', flexDirection: 'column',
            color: 'white'
        }}>
            {/* Header */}
            <div style={{
                padding: 'calc(env(safe-area-inset-top, 12px) + 14px) 16px 12px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                borderBottom: '1px solid rgba(255,255,255,0.08)'
            }}>
                <button
                    onClick={onCancel}
                    style={{
                        background: 'rgba(255,255,255,0.08)', color: 'white',
                        border: '1px solid rgba(255,255,255,0.15)',
                        width: 44, height: 44, borderRadius: 22,
                        fontSize: '1.3rem', fontWeight: 900, cursor: 'pointer'
                    }}
                    aria-label={isRTL ? 'إلغاء' : 'Cancel'}
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
                onTouchEnd={onTouchEnd}
                onWheel={onWheel}
                style={{
                    flex: 1, position: 'relative', overflow: 'hidden',
                    touchAction: 'none', userSelect: 'none'
                }}
                onLoad={() => {/* noop — image loads via onLoad below */}}
            >
                {imgUrl && (
                    <img
                        src={imgUrl}
                        alt=""
                        onLoad={(e) => {
                            const el = e.currentTarget;
                            setImgNatural({ w: el.naturalWidth, h: el.naturalHeight });
                        }}
                        draggable={false}
                        style={{
                            position: 'absolute',
                            top: '50%', left: '50%',
                            transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg) scale(${(() => {
                                if (!imgNatural || !stageRef.current) return scale;
                                const rotated = rotation === 90 || rotation === 270;
                                const w = rotated ? imgNatural.h : imgNatural.w;
                                const h = rotated ? imgNatural.w : imgNatural.h;
                                const baseScale = Math.max(frameSize.w / w, frameSize.h / h);
                                return baseScale * scale;
                            })()})`,
                            width: imgNatural?.w ? `${imgNatural.w}px` : 'auto',
                            height: imgNatural?.h ? `${imgNatural.h}px` : 'auto',
                            maxWidth: 'none', maxHeight: 'none',
                            pointerEvents: 'none',
                            transformOrigin: 'center center'
                        }}
                    />
                )}

                {/* Crop frame + dark overlay (the inverse: dark outside the frame) */}
                <div
                    aria-hidden="true"
                    style={{
                        position: 'absolute',
                        top: '50%', left: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: frameSize.w, height: frameSize.h,
                        boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
                        border: '2px solid rgba(255,255,255,0.95)',
                        borderRadius: 8,
                        pointerEvents: 'none'
                    }}
                >
                    {/* Rule-of-thirds guides */}
                    <div style={{
                        position: 'absolute', inset: 0,
                        backgroundImage:
                            'linear-gradient(to right, transparent calc(33.33% - 0.5px), rgba(255,255,255,0.35) calc(33.33% - 0.5px) calc(33.33% + 0.5px), transparent calc(33.33% + 0.5px), transparent calc(66.66% - 0.5px), rgba(255,255,255,0.35) calc(66.66% - 0.5px) calc(66.66% + 0.5px), transparent calc(66.66% + 0.5px)),' +
                            'linear-gradient(to bottom, transparent calc(33.33% - 0.5px), rgba(255,255,255,0.35) calc(33.33% - 0.5px) calc(33.33% + 0.5px), transparent calc(33.33% + 0.5px), transparent calc(66.66% - 0.5px), rgba(255,255,255,0.35) calc(66.66% - 0.5px) calc(66.66% + 0.5px), transparent calc(66.66% + 0.5px))'
                    }} />
                </div>
            </div>

            {/* Aspect ratio chips */}
            <div style={{
                display: 'flex', gap: 8, justifyContent: 'center',
                padding: '12px 16px 8px',
                borderTop: '1px solid rgba(255,255,255,0.08)'
            }}>
                {ASPECTS.map(a => (
                    <button
                        key={String(a.value)}
                        onClick={() => setAspect(a.value)}
                        style={{
                            background: aspect === a.value ? '#fff' : 'rgba(255,255,255,0.08)',
                            color: aspect === a.value ? '#0f172a' : 'white',
                            border: '1px solid ' + (aspect === a.value ? '#fff' : 'rgba(255,255,255,0.15)'),
                            borderRadius: 999, padding: '8px 16px',
                            fontWeight: 900, fontSize: '0.85rem',
                            cursor: 'pointer'
                        }}
                    >{a.label}</button>
                ))}
            </div>

            {/* Bottom action bar */}
            <div style={{
                display: 'flex', gap: 10, padding: '8px 16px calc(env(safe-area-inset-bottom, 12px) + 16px)',
                borderTop: '1px solid rgba(255,255,255,0.08)'
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
                    disabled={exporting || !imgNatural}
                    style={{
                        flex: 2, padding: '14px',
                        background: exporting ? '#475569' : 'var(--primary, #0284c7)',
                        color: 'white', border: 'none',
                        borderRadius: 14, fontWeight: 900, fontSize: '0.95rem',
                        cursor: (exporting || !imgNatural) ? 'default' : 'pointer',
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
