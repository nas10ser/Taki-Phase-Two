import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ImageCropEditor from './ImageCropEditor';

/**
 * In-app camera with an inline per-shot crop loop.
 *
 * The native <input capture> camera on iOS returns ONE photo then closes,
 * forcing the seller to reopen for every image. This keeps a live
 * getUserMedia stream open and runs a tight loop:
 *
 *   viewfinder → shoot → crop THIS shot right away → choose:
 *      • «المزيد»  → back to the viewfinder for the next shot
 *      • «تم»      → finish, close
 *
 * The crop step reuses the existing ImageCropEditor, so it looks and
 * behaves exactly like the gallery crop. Each cropped/skip'd shot is
 * handed to the parent (onCapture) which uploads + appends it; the
 * stream is kept alive across crop/choice so «المزيد» is instant
 * (tracks are only stopped on finish/unmount, killing the camera light).
 *
 * iOS Safari: requires HTTPS (production is) + a user gesture (mounted
 * from a tap). <video> MUST be playsInline+muted or it goes fullscreen.
 */

type Pending = { file: File; dataUrl: string; w: number; h: number };
type Mode = 'camera' | 'crop' | 'choice';

type Props = {
    maxShots: number;
    isRTL: boolean;
    onCapture: (file: File) => void;
    onPickStudio: () => void;
    onClose: () => void;
};

const CAPTURE_MAX_DIM = 1600;

const CameraCapture: React.FC<Props> = ({
    maxShots,
    isRTL,
    onCapture,
    onPickStudio,
    onClose,
}) => {
    const cap = Math.max(1, maxShots);
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [mode, setMode] = useState<Mode>('camera');
    const [pending, setPending] = useState<Pending | null>(null);
    const [count, setCount] = useState(0);
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

    const attachVideo = useCallback(async () => {
        const v = videoRef.current;
        const s = streamRef.current;
        if (!v || !s) return;
        if (v.srcObject !== s) v.srcObject = s;
        try {
            await v.play();
        } catch {
            /* autoplay policy — the stream still renders */
        }
    }, []);

    const startStream = useCallback(
        async (m: 'environment' | 'user') => {
            setReady(false);
            setError(null);
            stopStream();
            if (!navigator.mediaDevices?.getUserMedia) {
                setError(
                    isRTL
                        ? 'متصفحك لا يدعم الكاميرا داخل التطبيق — استخدم «الاستوديو».'
                        : 'In-app camera not supported — use “Studio”.',
                );
                return;
            }
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: { ideal: m },
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                    },
                    audio: false,
                });
                streamRef.current = stream;
                setReady(true);
                attachVideo();
            } catch (e: any) {
                const denied =
                    e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
                setError(
                    denied
                        ? isRTL
                            ? 'تم رفض إذن الكاميرا. فعّله من إعدادات المتصفح، أو استخدم «الاستوديو».'
                            : 'Camera permission denied. Enable it in settings, or use “Studio”.'
                        : isRTL
                          ? 'تعذّر فتح الكاميرا. استخدم «الاستوديو» بدلاً منها.'
                          : 'Could not open the camera. Use “Studio” instead.',
                );
            }
        },
        [isRTL, stopStream, attachVideo],
    );

    // Acquire once on mount; release on unmount.
    useEffect(() => {
        startStream(facing);
        return stopStream;
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

    // The <video> unmounts during crop/choice (mode-exclusive render) but
    // the stream stays alive — re-attach it whenever we return to the
    // viewfinder so «المزيد» resumes instantly with no re-permission.
    useEffect(() => {
        if (mode === 'camera' && ready) attachVideo();
    }, [mode, ready, attachVideo]);

    const flip = useCallback(() => {
        const next = facing === 'environment' ? 'user' : 'environment';
        setFacing(next);
        startStream(next);
    }, [facing, startStream]);

    const capture = useCallback(() => {
        if (busy || !ready || count >= cap) return;
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

            const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
            canvas.toBlob(
                (blob) => {
                    if (!blob) {
                        setBusy(false);
                        return;
                    }
                    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
                    const file = new File([blob], `taki-cam-${id}.jpg`, {
                        type: 'image/jpeg',
                        lastModified: Date.now(),
                    });
                    setPending({ file, dataUrl, w, h });
                    setMode('crop');
                    setBusy(false);
                },
                'image/jpeg',
                0.9,
            );
        } catch {
            setBusy(false);
        }
    }, [busy, ready, count, cap]);

    const commitShot = useCallback(
        (f: File) => {
            onCapture(f);
            setCount((c) => c + 1);
            setPending(null);
            setMode('choice');
        },
        [onCapture],
    );

    const finish = useCallback(() => {
        stopStream();
        onClose();
    }, [stopStream, onClose]);

    const goStudio = useCallback(() => {
        stopStream();
        onPickStudio();
    }, [stopStream, onPickStudio]);

    // --- Crop step: reuse the exact gallery crop editor ---------------
    if (mode === 'crop' && pending) {
        return (
            <ImageCropEditor
                file={pending.file}
                dataUrl={pending.dataUrl}
                naturalW={pending.w}
                naturalH={pending.h}
                queueIndex={count + 1}
                queueTotal={count + 1}
                isRTL={isRTL}
                onApply={(cropped) => commitShot(cropped)}
                onSkip={() => pending && commitShot(pending.file)}
                onCancel={() => {
                    setPending(null);
                    setMode('camera');
                }}
            />
        );
    }

    const atLimit = count >= cap;

    // --- Choice step: المزيد / تم ------------------------------------
    if (mode === 'choice') {
        const overlay = (
            <div dir={isRTL ? 'rtl' : 'ltr'} style={sheetStyle}>
                <div style={{ textAlign: 'center', padding: '0 28px' }}>
                    <div style={{ fontSize: '3rem', marginBottom: 10 }}>✅</div>
                    <div style={{ fontWeight: 900, fontSize: '1.15rem', marginBottom: 6 }}>
                        {isRTL
                            ? `تمت إضافة ${count} ${count === 1 ? 'صورة' : 'صور'}`
                            : `${count} photo${count === 1 ? '' : 's'} added`}
                    </div>
                    <div style={{ opacity: 0.8, fontSize: '0.9rem', fontWeight: 600 }}>
                        {atLimit
                            ? isRTL
                                ? 'اكتمل الحد الأقصى للصور'
                                : 'Photo limit reached'
                            : isRTL
                              ? 'تبي تضيف صورة ثانية؟'
                              : 'Add another photo?'}
                    </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 320, marginTop: 30 }}>
                    {!atLimit && (
                        <button
                            type="button"
                            onClick={() => setMode('camera')}
                            style={primaryBtnStyle}
                        >
                            📷 {isRTL ? 'المزيد' : 'More'}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={finish}
                        style={atLimit ? primaryBtnStyle : secondaryBtnStyle}
                    >
                        ✓ {isRTL ? `تم (${count})` : `Done (${count})`}
                    </button>
                </div>
            </div>
        );
        return createPortal(overlay, document.body);
    }

    // --- Error overlay ----------------------------------------------
    if (error) {
        const overlay = (
            <div dir={isRTL ? 'rtl' : 'ltr'} style={sheetStyle}>
                <div style={{ textAlign: 'center', padding: '0 32px' }}>
                    <div style={{ fontSize: '2.6rem', marginBottom: 12 }}>📷</div>
                    <div style={{ fontWeight: 800, lineHeight: 1.8, fontSize: '0.98rem' }}>
                        {error}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 26 }}>
                    <button type="button" onClick={goStudio} style={primaryBtnStyle}>
                        🖼️ {isRTL ? 'الاستوديو' : 'Studio'}
                    </button>
                    <button type="button" onClick={finish} style={secondaryBtnStyle}>
                        {isRTL ? 'إغلاق' : 'Close'}
                    </button>
                </div>
            </div>
        );
        return createPortal(overlay, document.body);
    }

    // --- Camera viewfinder ------------------------------------------
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
                    onClick={finish}
                    aria-label={isRTL ? 'إغلاق' : 'Close'}
                    style={iconBtnStyle}
                >
                    ✕
                </button>
                <span style={{ fontWeight: 900, fontSize: '0.95rem' }}>
                    {isRTL ? `${count} / ${cap} صور` : `${count} / ${cap}`}
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
                {!ready && (
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
            </div>

            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '16px 24px',
                    paddingBottom: 'calc(18px + env(safe-area-inset-bottom))',
                    gap: 14,
                }}
            >
                <button
                    type="button"
                    onClick={goStudio}
                    style={{
                        width: 78,
                        background: 'rgba(255,255,255,0.16)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 14,
                        padding: '10px 6px',
                        fontWeight: 800,
                        fontSize: '0.74rem',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 3,
                    }}
                >
                    <span style={{ fontSize: '1.2rem' }}>🖼️</span>
                    {isRTL ? 'الاستوديو' : 'Studio'}
                </button>

                <button
                    type="button"
                    onClick={capture}
                    disabled={!ready || busy || atLimit}
                    aria-label={isRTL ? 'التقاط صورة' : 'Capture'}
                    style={{
                        width: 76,
                        height: 76,
                        borderRadius: '50%',
                        background: '#fff',
                        border: '5px solid rgba(255,255,255,0.45)',
                        opacity: !ready || atLimit ? 0.4 : 1,
                        transition: 'transform 0.08s ease',
                        transform: busy ? 'scale(0.9)' : 'scale(1)',
                    }}
                />

                <button
                    type="button"
                    onClick={finish}
                    disabled={count === 0}
                    style={{
                        width: 78,
                        background: 'transparent',
                        border: 'none',
                        color: '#fff',
                        fontWeight: 900,
                        fontSize: '0.95rem',
                        opacity: count === 0 ? 0.35 : 1,
                    }}
                >
                    {isRTL ? `تم (${count})` : `Done (${count})`}
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

const sheetStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 100000,
    background: 'rgba(0,0,0,0.92)',
    color: '#fff',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
    userSelect: 'none',
};

const primaryBtnStyle: React.CSSProperties = {
    flex: 1,
    background: '#fff',
    color: '#000',
    border: 'none',
    borderRadius: 999,
    padding: '15px 24px',
    fontWeight: 900,
    fontSize: '1rem',
};

const secondaryBtnStyle: React.CSSProperties = {
    flex: 1,
    background: 'rgba(255,255,255,0.16)',
    color: '#fff',
    border: 'none',
    borderRadius: 999,
    padding: '15px 24px',
    fontWeight: 900,
    fontSize: '1rem',
};

export default CameraCapture;
