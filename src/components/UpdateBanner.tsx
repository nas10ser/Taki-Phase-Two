import React, { useEffect, useState } from 'react';
import { applySwUpdate } from '../sw-cleanup';
import { useApp } from '../context/AppContext';

/**
 * Floating top banner that appears when a new service worker is ready.
 * Tapping "تحديث الآن" swaps to the new build inside the current Safari
 * tab — no force-quit / re-open needed. See sw-cleanup.ts for the
 * detection pipeline.
 */
const UpdateBanner: React.FC = () => {
    const { language } = useApp();
    const isRTL = language === 'ar';

    const [available, setAvailable] = useState(false);
    const [applying, setApplying] = useState(false);

    useEffect(() => {
        const onAvail = () => setAvailable(true);
        window.addEventListener('taki:sw-update-available', onAvail);
        return () => window.removeEventListener('taki:sw-update-available', onAvail);
    }, []);

    if (!available) return null;

    const handleUpdate = async () => {
        if (applying) return;
        setApplying(true);
        try {
            await applySwUpdate();
            // applySwUpdate triggers controllerchange → page reload.
            // If for some reason that path doesn't fire within a couple
            // seconds we hard-reload to guarantee fresh code.
            setTimeout(() => window.location.reload(), 2500);
        } catch {
            window.location.reload();
        }
    };

    return (
        <div
            role="status"
            aria-live="polite"
            style={{
                position: 'fixed',
                top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
                insetInlineStart: 12,
                insetInlineEnd: 12,
                zIndex: 99999,
                background: 'linear-gradient(135deg, #10b981, #059669)',
                color: '#ffffff',
                borderRadius: 14,
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                boxShadow: '0 10px 30px rgba(16, 185, 129, 0.35)',
                fontWeight: 800,
                direction: isRTL ? 'rtl' : 'ltr',
                animation: 'taki-update-banner-in 0.35s cubic-bezier(0.2, 0.9, 0.3, 1)',
            }}
        >
            <style>{`
                @keyframes taki-update-banner-in {
                    from { transform: translateY(-20px); opacity: 0; }
                    to   { transform: translateY(0);     opacity: 1; }
                }
            `}</style>
            <span style={{ fontSize: '1.3rem' }}>🆕</span>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.88rem', fontWeight: 900 }}>
                    {isRTL ? 'تحديث جديد جاهز' : 'A new version is ready'}
                </div>
                <div style={{ fontSize: '0.72rem', fontWeight: 600, opacity: 0.95 }}>
                    {isRTL ? 'اضغط للتحديث بدون مغادرة التطبيق' : 'Tap to refresh — stay in the app'}
                </div>
            </div>
            <button
                onClick={handleUpdate}
                disabled={applying}
                style={{
                    background: '#ffffff',
                    color: '#047857',
                    border: 'none',
                    padding: '8px 14px',
                    borderRadius: 10,
                    fontWeight: 900,
                    fontSize: '0.78rem',
                    minHeight: 36,
                    cursor: applying ? 'wait' : 'pointer',
                    whiteSpace: 'nowrap',
                }}
            >
                {applying ? (isRTL ? '…جاري' : 'Updating…') : (isRTL ? 'تحديث الآن' : 'Update now')}
            </button>
        </div>
    );
};

export default UpdateBanner;
