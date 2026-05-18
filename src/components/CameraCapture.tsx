import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * In-app camera (WhatsApp-style multi-shot).
 *
 * The native <input capture> camera on iOS returns ONE photo then closes,
 * forcing the seller to reopen + retake for every image. This component
 * keeps a live getUserMedia stream open so the seller can fire several
 * shots in a row, review the strip, drop bad ones, then return all at
 * once. Captured frames are framed JPEGs already, so they bypass the
 * crop editor — re-cropping each shot would reintroduce the exact
 * friction this screen removes.
 *
 * iOS Safari notes: requires HTTPS (production is) + a user gesture
 * (mounted from a tap). <video> MUST be playsInline+muted or it goes
 * fullscreen. Tracks are stopped on unmount so the camera light dies.
 */

type Shot = { id: string; file: File; thumb: string };

type Props = {
    maxShots: number;
    isRTL: boolean;
    onDone: (files: File[]) => void;
    onClose: () => void;
};

const CAPTURE_MAX_DIM = 1600;

const CameraCapture: React.FC<Props> = ({ maxShots, isRTL, onDone, onClose }) => {
    const cap = Math.max(1, maxShots);
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [shots, setShots] = useState<Shot[]>([]);
    const [facing, setFacing] = useState<'environment' | 'user'>('environment');
    const [error, setError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const [busy, setBusy] = useState(false);

    const stopStream = useCallback(() => {
        const s = streamRef.current;
        if (s) {
            s.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
        }
    }, []);

    const startStream = useCallback(async (mode: 'environment' | 'user') => {
        setReady(false);
        setError(null);
        stopStream();
        if (!navigator.mediaDevices?.getUserMedia) {
            setError(
                isRTL
                    ? 'متصفحك لا يدعم الكاميرا داخل التطبيق — استخدم زر «الاستديو».'
                    : 'In-app camera not supported on this browser — use “Studio”.',
            );
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: mode },
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
                audio: false,
            });
            streamRef.current = stream;
            const v = videoRef.current;
            if (v) {
                v.srcObject = stream;
                // iOS needs an explicit play() inside/after the gesture.
                try {
                    await v.play();
                } catch {
                    /* autoplay policy — the stream still renders */
                }
            }
            setReady(true);
        } catch (e: any) {
            const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
            setError(
                denied
                    ? isRTL
                        ? 'تم رفض إذن الكاميرا. فعّله من إعدادات المتصفح، أو استخدم زر «الاستديو».'
                        : 'Camera permission denied. Enable it in browser settings, or use “Studio”.'
                    : isRTL
                      ? 'تعذّر فتح الكاميرا. استخدم زر «الاستديو» بدلاً منها.'
                      : 'Could not open the camera. Use “Studio” instead.',
            );
        }
    }, [isRTL, stopStream]);

    useEffect(() => {
        startStream(facing);
        return stopStream;
        // facing handled by flip(); mount-once acquisition.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Lock body scroll while the full-screen camera is open.
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prev;
        };
    }, []);

    const flip = useCallback(() => {
        const next = facing === 'environment' ? 'user' : 'environment';
        setFacing(next);
        startStream(next);
    }, [facing, startStream]);

    const capture = useCallback(async () => {
        if (busy || shots.length >= cap) return;
        const v = videoRef.current;
        if (!v || !v.videoWidth || !v.videoHeight) return;
        setBusy(true);
        try {
            const vw = v.videoWidth;
            const vh = v.videoHeight;
            const scale = Math.min(1, CAPTURE_MAX_DIM / Math.max(vw, vh));
            const w = Math.max(1, Math.round(vw * scale));
            const h = Math.max(1, Math.round(vh * scale));

            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.drawImage(v, 0, 0, w, h);

            const blob = await new Promise<Blob | null>((resolve) =>
                canvas.toBlob(resolve, 'image/jpeg', 0.85),
            );
            if (!blob) return;

            // Small data-URL thumb for the strip. data: keeps us inside
            // the existing CSP img-src (no blob: directive needed).
            const tScale = 200 / Math.max(w, h);
            const tc = document.createElement('canvas');
            tc.width = Math.max(1, Math.round(w * tScale));
            tc.height = Math.max(1, Math.round(h * tScale));
            tc.getContext('2d')?.drawImage(v, 0, 0, tc.width, tc.height);
            const thumb = tc.toDataURL('image/jpeg', 0.6);

            const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
            const file = new File([blob], `taki-cam-${id}.jpg`, {
                type: 'image/jpeg',
                lastModified: Date.now(),
            });
            setShots((prev) => [...prev, { id, file, thumb }]);
        } finally {
            setBusy(false);
        }
    }, [busy, shots.length, cap]);

    const removeShot = useCallback((id: string) => {
        setShots((prev) => prev.filter((s) => s.id !== id));
    }, []);

    const finish = useCallback(() => {
        stopStream();
        onDone(shots.map((s) => s.file));
    }, [shots, stopStream, onDone]);

    const cancel = useCallback(() => {
        stopStream();
        onClose();
    }, [stopStream, onClose]);

    const full = shots.length >= cap;

    const overlay = (
        <div
            dir={isRTL ? 'rtl' : 'ltr'}
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 100000,
                background: '#000',
                display: 'flex',
                flexDirection: 'column',
                color: '#fff',
                WebkitTapHighlightColor: 'transparent',
                userSelect: 'none',
            }}
        >
            {/* Top bar */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 16px',
                    paddingTop: 'calc(14px + env(safe-area-inset-top))',
                }}
            >
                <button
                    type="button"
                    onClick={cancel}
                    aria-label={isRTL ? 'إغلاق' : 'Close'}
                    style={iconBtnStyle}
                >
                    ✕
                </button>
                <span style={{ fontWeight: 900, fontSize: '0.95rem' }}>
                    {isRTL ? `${shots.length} / ${cap} صور` : `${shots.length} / ${cap}`}
                </span>
                <button
                    type="button"
                    onClick={flip}
                    aria-label={isRTL ? 'تبديل الكاميرا' : 'Flip camera'}
                    style={iconBtnStyle}
                >
                    ⟲
                </button>
            </div>

            {/* Viewfinder */}
            <div
                style={{
                    flex: 1,
                    position: 'relative',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        transform: facing === 'user' ? 'scaleX(-1)' : 'none',
                    }}
                />
                {!ready && !error && (
                    <div style={centerMsgStyle}>
                        <div
                            className="spinner"
                            style={{
                                width: 36,
                                height: 36,
                                border: '4px solid rgba(255,255,255,0.25)',
                                borderTopColor: '#fff',
                                borderRadius: '50%',
                                animation: 'spin 1s linear infinite',
                            }}
                        />
                        <span style={{ marginTop: 14, fontWeight: 700 }}>
                            {isRTL ? 'جارٍ فتح الكاميرا…' : 'Opening camera…'}
                        </span>
                    </div>
                )}
                {error && (
                    <div style={{ ...centerMsgStyle, padding: '0 32px', textAlign: 'center' }}>
                        <span style={{ fontSize: '2.4rem', marginBottom: 12 }}>📷</span>
                        <span style={{ fontWeight: 800, lineHeight: 1.7 }}>{error}</span>
                        <button
                            type="button"
                            onClick={cancel}
                            style={{
                                marginTop: 22,
                                background: '#fff',
                                color: '#000',
                                border: 'none',
                                borderRadius: 999,
                                padding: '12px 28px',
                                fontWeight: 900,
                                fontSize: '0.95rem',
                            }}
                        >
                            {isRTL ? 'حسناً' : 'OK'}
                        </button>
                    </div>
                )}
            </div>

            {/* Thumbnail strip */}
            {shots.length > 0 && (
                <div
                    style={{
                        display: 'flex',
                        gap: 8,
                        overflowX: 'auto',
                        padding: '10px 14px',
                        background: 'rgba(0,0,0,0.4)',
                    }}
                >
                    {shots.map((s) => (
                        <div
                            key={s.id}
                            style={{ position: 'relative', flex: '0 0 auto' }}
                        >
                            <img
                                src={s.thumb}
                                alt=""
                                style={{
                                    width: 58,
                                    height: 58,
                                    objectFit: 'cover',
                                    borderRadius: 10,
                                    border: '2px solid rgba(255,255,255,0.85)',
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => removeShot(s.id)}
                                aria-label={isRTL ? 'حذف اللقطة' : 'Remove shot'}
                                style={{
                                    position: 'absolute',
                                    top: -6,
                                    [isRTL ? 'left' : 'right']: -6,
                                    background: 'rgba(220,38,38,0.97)',
                                    color: '#fff',
                                    border: '2px solid #fff',
                                    borderRadius: '50%',
                                    width: 22,
                                    height: 22,
                                    fontSize: '0.7rem',
                                    fontWeight: 900,
                                    lineHeight: 1,
                                    padding: 0,
                                } as React.CSSProperties}
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Controls */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '18px 26px',
                    paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
                    gap: 16,
                }}
            >
                <div style={{ width: 76, fontSize: '0.78rem', opacity: 0.85, fontWeight: 700 }}>
                    {full
                        ? isRTL
                            ? 'اكتمل العدد'
                            : 'Limit reached'
                        : isRTL
                          ? 'صوّر بحرية'
                          : 'Tap to shoot'}
                </div>

                <button
                    type="button"
                    onClick={capture}
                    disabled={!ready || full || busy}
                    aria-label={isRTL ? 'التقاط صورة' : 'Capture'}
                    style={{
                        width: 74,
                        height: 74,
                        borderRadius: '50%',
                        background: '#fff',
                        border: '5px solid rgba(255,255,255,0.45)',
                        opacity: !ready || full ? 0.4 : 1,
                        transition: 'transform 0.08s ease',
                        transform: busy ? 'scale(0.9)' : 'scale(1)',
                    }}
                />

                <button
                    type="button"
                    onClick={finish}
                    disabled={shots.length === 0}
                    style={{
                        width: 76,
                        textAlign: isRTL ? 'left' : 'right',
                        background: 'transparent',
                        border: 'none',
                        color: '#fff',
                        fontWeight: 900,
                        fontSize: '1rem',
                        opacity: shots.length === 0 ? 0.4 : 1,
                    }}
                >
                    {isRTL ? `تم (${shots.length})` : `Done (${shots.length})`}
                </button>
            </div>
        </div>
    );

    return createPortal(overlay, document.body);
};

const iconBtnStyle: React.CSSProperties = {
    width: 40,
    height: 40,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.18)',
    color: '#fff',
    border: 'none',
    fontSize: '1.1rem',
    fontWeight: 900,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
};

const centerMsgStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
};

export default CameraCapture;
