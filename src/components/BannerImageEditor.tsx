import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * BannerImageEditor — WYSIWYG banner positioner (v11.30).
 *
 * The banner is rendered everywhere at a fixed 2:1 aspect ratio. A raw photo
 * is rarely 2:1, so the admin needs to choose WHICH horizontal band of the
 * image shows. This editor presents the exact banner frame (2:1), lets the
 * admin drag the image up/down/left/right inside it and zoom in, then renders
 * the visible window to a 1200×600 canvas and hands back a ready JPEG File.
 *
 * Because output is pre-cropped to the banner ratio, the result looks
 * identical in the admin preview, the home slider, and on every device —
 * no objectPosition guesswork, no per-device cropping surprises.
 *
 * CORS: the caller always passes a data: or blob: URL (it reads the picked
 * File, or fetches an existing URL into a blob first), so the canvas is never
 * tainted and toBlob always succeeds.
 */

type Props = {
    src: string;                 // data: or blob: URL (never a remote http URL → no taint)
    isRTL: boolean;
    aspect?: number;             // width / height — default 2 (the banner ratio)
    outWidth?: number;           // output width in px — default 1200
    onApply: (file: File) => void;
    onCancel: () => void;
};

const PAD = 22;          // breathing room around the frame inside the stage
const MAX_ZOOM = 3;

export const BannerImageEditor: React.FC<Props> = ({
    src, isRTL, aspect = 2, outWidth = 1200, onApply, onCancel,
}) => {
    const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
    const [loadErr, setLoadErr] = useState(false);
    const [exportErr, setExportErr] = useState(false);
    const [stage, setStage] = useState({ w: 0, h: 0 });
    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [exporting, setExporting] = useState(false);

    const stageRef = useRef<HTMLDivElement | null>(null);
    const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
    const dispatchedRef = useRef(false);

    // Lock body scroll while open.
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, []);

    // Load natural dimensions. src is always same-origin (data:/blob:).
    useEffect(() => {
        let cancelled = false;
        const img = new Image();
        img.onload = () => { if (!cancelled) setNat({ w: img.naturalWidth, h: img.naturalHeight }); };
        img.onerror = () => { if (!cancelled) setLoadErr(true); };
        img.src = src;
        return () => { cancelled = true; };
    }, [src]);

    // Measure stage — synchronous first measure + ResizeObserver for rotation.
    useLayoutEffect(() => {
        if (stageRef.current) {
            setStage({ w: stageRef.current.clientWidth, h: stageRef.current.clientHeight });
        }
    }, []);
    useEffect(() => {
        const measure = () => {
            if (stageRef.current) setStage({ w: stageRef.current.clientWidth, h: stageRef.current.clientHeight });
        };
        let ro: ResizeObserver | null = null;
        if (typeof ResizeObserver !== 'undefined' && stageRef.current) {
            ro = new ResizeObserver(measure);
            ro.observe(stageRef.current);
        }
        window.addEventListener('resize', measure);
        window.addEventListener('orientationchange', measure);
        return () => {
            window.removeEventListener('resize', measure);
            window.removeEventListener('orientationchange', measure);
            ro?.disconnect();
        };
    }, []);

    // ===== Frame geometry: the largest 2:1 frame that fits the padded stage =====
    const availW = Math.max(0, stage.w - PAD * 2);
    const availH = Math.max(0, stage.h - PAD * 2);
    let frameW = availW;
    let frameH = frameW / aspect;
    if (frameH > availH) { frameH = availH; frameW = frameH * aspect; }

    // Cover scale: the image must always fill the frame (no gaps), then zoom in.
    const baseScale = (nat && frameW && frameH) ? Math.max(frameW / nat.w, frameH / nat.h) : 0;
    const eScale = baseScale * zoom;
    const imgW = nat ? nat.w * eScale : 0;
    const imgH = nat ? nat.h * eScale : 0;
    const maxOffX = Math.max(0, (imgW - frameW) / 2);
    const maxOffY = Math.max(0, (imgH - frameH) / 2);

    const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));

    // Re-clamp the pan whenever zoom/frame changes so the frame stays filled.
    useEffect(() => {
        setOffset(o => ({ x: clamp(o.x, maxOffX), y: clamp(o.y, maxOffY) }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [maxOffX, maxOffY]);

    // ===== Drag to pan =====
    const begin = (cx: number, cy: number) => { dragRef.current = { sx: cx, sy: cy, ox: offset.x, oy: offset.y }; };
    const move = (cx: number, cy: number) => {
        const d = dragRef.current;
        if (!d) return;
        setOffset({ x: clamp(d.ox + (cx - d.sx), maxOffX), y: clamp(d.oy + (cy - d.sy), maxOffY) });
    };
    const end = () => { dragRef.current = null; };

    const onTouchStart = (e: React.TouchEvent) => { if (e.touches.length === 1) begin(e.touches[0].clientX, e.touches[0].clientY); };
    const onTouchMove = (e: React.TouchEvent) => {
        if (!dragRef.current || e.touches.length !== 1) return;
        e.preventDefault();
        move(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onMouseDown = (e: React.MouseEvent) => begin(e.clientX, e.clientY);
    const onMouseMove = (e: React.MouseEvent) => { if (dragRef.current) move(e.clientX, e.clientY); };

    // ===== Apply: render the framed window to a 1200×600 canvas → File =====
    const apply = async () => {
        if (dispatchedRef.current || exporting || !nat || !baseScale) return;
        dispatchedRef.current = true;
        setExporting(true);
        setExportErr(false);
        try {
            const img = new Image();
            await new Promise<void>((res, rej) => {
                img.onload = () => res();
                img.onerror = () => rej(new Error('decode_failed'));
                img.src = src;
            });

            const eS = baseScale * zoom;
            const sw = frameW / eS;
            const sh = frameH / eS;
            // Frame's top-left corner mapped from display space back to source px.
            const sx = nat.w / 2 + (-frameW / 2 - offset.x) / eS;
            const sy = nat.h / 2 + (-frameH / 2 - offset.y) / eS;

            const outW = outWidth;
            const outH = Math.round(outWidth / aspect);
            const canvas = document.createElement('canvas');
            canvas.width = outW;
            canvas.height = outH;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('no_ctx');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            // The cover+clamp invariant keeps the rect inside the image; clamp
            // anyway as a rounding guard.
            const csx = Math.max(0, Math.min(nat.w - 1, sx));
            const csy = Math.max(0, Math.min(nat.h - 1, sy));
            const csw = Math.min(nat.w - csx, sw);
            const csh = Math.min(nat.h - csy, sh);
            ctx.drawImage(img, csx, csy, csw, csh, 0, 0, outW, outH);

            const blob: Blob | null = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
            if (!blob) throw new Error('encode_failed');
            const file = new File([blob], `banner_${Date.now()}.jpg`, { type: 'image/jpeg' });
            onApply(file);
        } catch (err) {
            console.error('Banner crop failed:', err);
            setExportErr(true);
            setExporting(false);
            dispatchedRef.current = false; // allow retry
        }
    };

    const headerH = 'calc(env(safe-area-inset-top, 12px) + 58px)';
    const footerH = 'calc(env(safe-area-inset-bottom, 12px) + 132px)';
    const ready = !!nat && !loadErr && baseScale > 0;

    const node = (
        <div
            dir={isRTL ? 'rtl' : 'ltr'}
            style={{
                position: 'fixed', inset: 0, zIndex: 99999,
                background: '#0b0b0c', display: 'flex', flexDirection: 'column',
                color: 'white', overscrollBehavior: 'contain',
            }}
        >
            {/* Header */}
            <div style={{
                height: headerH, paddingTop: 'env(safe-area-inset-top, 12px)',
                paddingLeft: 16, paddingRight: 16,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                borderBottom: '1px solid rgba(255,255,255,0.08)', background: '#0b0b0c',
                position: 'relative', zIndex: 2,
            }}>
                <button
                    onClick={onCancel}
                    aria-label={isRTL ? 'إلغاء' : 'Cancel'}
                    style={{
                        background: 'rgba(255,255,255,0.08)', color: 'white',
                        border: '1px solid rgba(255,255,255,0.15)', width: 42, height: 42,
                        borderRadius: 21, fontSize: '1.25rem', fontWeight: 900, cursor: 'pointer',
                    }}
                >✕</button>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontWeight: 900, fontSize: '0.95rem' }}>
                        {isRTL ? 'حدّد جزء البانر' : 'Position banner'}
                    </div>
                    <div style={{ fontSize: '0.7rem', opacity: 0.7, marginTop: 2 }}>
                        {isRTL ? 'حرّك الصورة لاختيار الجزء الظاهر' : 'Drag to choose the visible part'}
                    </div>
                </div>
                <div style={{ width: 42 }} />
            </div>

            {/* Stage */}
            <div
                ref={stageRef}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={end}
                onTouchCancel={end}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={end}
                onMouseLeave={end}
                style={{
                    flex: 1, position: 'relative', overflow: 'hidden',
                    touchAction: 'none', userSelect: 'none', background: '#0b0b0c',
                    cursor: ready ? 'grab' : 'default',
                }}
            >
                {ready && (
                    <>
                        {/* The image, panned by offset, centered on the frame (= stage center) */}
                        <img
                            src={src}
                            alt=""
                            draggable={false}
                            style={{
                                position: 'absolute', left: '50%', top: '50%',
                                width: imgW, height: imgH, maxWidth: 'none', maxHeight: 'none',
                                transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
                                pointerEvents: 'none', display: 'block',
                            }}
                        />

                        {/* Dim everything outside the 2:1 frame + draw the frame & guide lines */}
                        <div
                            aria-hidden="true"
                            style={{
                                position: 'absolute', left: '50%', top: '50%',
                                width: frameW, height: frameH,
                                transform: 'translate(-50%, -50%)',
                                boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)',
                                border: '2px solid rgba(255,255,255,0.95)',
                                borderRadius: 14, pointerEvents: 'none',
                            }}
                        >
                            {/* Top & bottom accent bars — the band the user is choosing */}
                            <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 4, background: 'linear-gradient(90deg,#f97316,#ef4444)', borderRadius: '12px 12px 0 0' }} />
                            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, background: 'linear-gradient(90deg,#f97316,#ef4444)', borderRadius: '0 0 12px 12px' }} />
                            {/* Center crosshair guides for alignment */}
                            <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 1, background: 'rgba(255,255,255,0.25)' }} />
                            <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, background: 'rgba(255,255,255,0.25)' }} />
                            {/* Size badge */}
                            <div style={{
                                position: 'absolute', top: 8, [isRTL ? 'right' : 'left']: 8,
                                background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
                                padding: '3px 8px', borderRadius: 8, fontSize: '0.65rem', fontWeight: 800,
                            }}>
                                {outWidth}×{Math.round(outWidth / aspect)} — {aspect}:1
                            </div>
                        </div>
                    </>
                )}

                {!ready && !loadErr && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.7, fontWeight: 700 }}>
                        {isRTL ? 'جاري تجهيز الصورة...' : 'Preparing image...'}
                    </div>
                )}
                {loadErr && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', opacity: 0.85, fontWeight: 700 }}>
                        {isRTL ? 'تعذّر عرض الصورة. أغلق وأعد المحاولة برفعها من جهازك.' : 'Could not load the image.'}
                    </div>
                )}
            </div>

            {/* Footer: zoom slider + actions */}
            <div style={{
                height: footerH, paddingBottom: 'env(safe-area-inset-bottom, 12px)',
                paddingLeft: 16, paddingRight: 16, paddingTop: 14,
                display: 'flex', flexDirection: 'column', gap: 12,
                borderTop: '1px solid rgba(255,255,255,0.08)', background: '#0b0b0c',
                position: 'relative', zIndex: 2,
            }}>
                {/* Zoom */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: '0.95rem' }}>🔍</span>
                    <input
                        type="range"
                        min={1} max={MAX_ZOOM} step={0.01}
                        value={zoom}
                        onChange={(e) => setZoom(Number(e.target.value))}
                        disabled={!ready}
                        aria-label={isRTL ? 'تكبير' : 'Zoom'}
                        style={{ flex: 1, accentColor: '#f97316', height: 6 }}
                    />
                    <button
                        type="button"
                        onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}
                        disabled={!ready}
                        style={{
                            background: 'rgba(255,255,255,0.08)', color: 'white',
                            border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10,
                            padding: '6px 10px', fontSize: '0.72rem', fontWeight: 800, cursor: 'pointer',
                        }}
                    >
                        {isRTL ? 'إعادة ضبط' : 'Reset'}
                    </button>
                </div>

                {exportErr && (
                    <div style={{ fontSize: '0.72rem', color: '#fca5a5', fontWeight: 700, textAlign: 'center' }}>
                        {isRTL ? 'تعذّر قص هذه الصورة. جرّب رفعها من جهازك.' : 'Could not crop this image.'}
                    </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 10 }}>
                    <button
                        onClick={onCancel}
                        disabled={exporting}
                        style={{
                            flex: 1, padding: 14, background: 'rgba(255,255,255,0.08)', color: 'white',
                            border: '1px solid rgba(255,255,255,0.15)', borderRadius: 14,
                            fontWeight: 900, fontSize: '0.95rem', cursor: exporting ? 'default' : 'pointer',
                        }}
                    >
                        {isRTL ? 'إلغاء' : 'Cancel'}
                    </button>
                    <button
                        onClick={apply}
                        disabled={exporting || !ready}
                        style={{
                            flex: 2, padding: 14,
                            background: (exporting || !ready) ? '#475569' : 'linear-gradient(90deg,#f97316,#ef4444)',
                            color: 'white', border: 'none', borderRadius: 14,
                            fontWeight: 900, fontSize: '0.95rem',
                            cursor: (exporting || !ready) ? 'default' : 'pointer',
                            boxShadow: '0 8px 24px rgba(239,68,68,0.35)',
                        }}
                    >
                        {exporting ? (isRTL ? 'جاري المعالجة...' : 'Processing...') : (isRTL ? '✓ اعتماد القص' : '✓ Apply')}
                    </button>
                </div>
            </div>
        </div>
    );

    return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
};

export default BannerImageEditor;
