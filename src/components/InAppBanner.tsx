import React, { useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';

/**
 * Non-blocking top notification banner. Replaces the old blocking center
 * "موافق" modal that fired once per unread booking — a merchant taking
 * hundreds of orders could not work through a modal per order. This sits at
 * the top, auto-dismisses, and (crucially) never intercepts taps on the page
 * behind it: the outer layer is pointer-events:none, only the card itself is
 * tappable. Shown identically for buyer and seller.
 */
const AUTO_DISMISS_MS = 5000;

const InAppBanner: React.FC = () => {
    const { inAppBanner, dismissInAppBanner, language } = useApp();
    const history = useHistory();
    const isRTL = language === 'ar';

    useEffect(() => {
        if (!inAppBanner) return;
        const t = setTimeout(() => dismissInAppBanner(), AUTO_DISMISS_MS);
        return () => clearTimeout(t);
    }, [inAppBanner, dismissInAppBanner]);

    if (!inAppBanner) return null;

    const meta = inAppBanner.metadata || {};
    const barcode: string | undefined = meta.barcode;
    const dealId: string | undefined = meta.dealId;
    const audience: 'seller' | 'buyer' | 'admin' | undefined = meta.audience;
    const followerId: string | undefined = meta.followerId;

    // Same destination rules as the Notifications list so a tap lands where
    // the booking + its chat thread live.
    const dest: string | null =
        audience === 'seller' && barcode ? `/seller?tab=orders&barcode=${barcode}`
        : audience === 'buyer' && barcode ? `/bookings?barcode=${barcode}`
        : barcode ? `/bookings?barcode=${barcode}`
        : dealId ? `/deal/${dealId}`
        : followerId ? '/profile'
        : '/notifications';

    const title = isRTL ? inAppBanner.title.ar : inAppBanner.title.en;
    const body = isRTL ? inAppBanner.body.ar : inAppBanner.body.en;

    return (
        <div
            dir={isRTL ? 'rtl' : 'ltr'}
            style={{
                position: 'fixed',
                top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
                left: 0,
                right: 0,
                zIndex: 99998,
                display: 'flex',
                justifyContent: 'center',
                padding: '0 12px',
                pointerEvents: 'none',
            }}
        >
            <div
                role="button"
                tabIndex={0}
                onClick={() => { dismissInAppBanner(); if (dest) history.push(dest); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dismissInAppBanner(); if (dest) history.push(dest); } }}
                className="animate-fade-in"
                style={{
                    pointerEvents: 'auto',
                    width: '100%',
                    maxWidth: 460,
                    background: 'rgba(15, 23, 42, 0.96)',
                    backdropFilter: 'blur(10px)',
                    WebkitBackdropFilter: 'blur(10px)',
                    color: '#fff',
                    borderRadius: 18,
                    boxShadow: '0 12px 34px rgba(0,0,0,0.45)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    padding: '12px 14px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    cursor: 'pointer',
                }}
            >
                <div style={{
                    width: 38, height: 38, borderRadius: 11, flexShrink: 0,
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1.1rem'
                }}>🔔</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                        fontSize: '0.86rem', fontWeight: 900, marginBottom: 2,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                    }}>{title}</div>
                    <div style={{
                        fontSize: '0.78rem', fontWeight: 600, opacity: 0.88, lineHeight: 1.45,
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
                    }}>{body}</div>
                </div>
                <button
                    type="button"
                    aria-label={isRTL ? 'إغلاق' : 'Dismiss'}
                    onClick={(e) => { e.stopPropagation(); dismissInAppBanner(); }}
                    style={{
                        background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff',
                        width: 26, height: 26, minWidth: 26, borderRadius: 8, cursor: 'pointer',
                        fontSize: '0.8rem', fontWeight: 900, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                >✕</button>
            </div>
        </div>
    );
};

export default InAppBanner;
