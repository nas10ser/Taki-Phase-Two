import React from 'react';

interface Props {
    labelAr?: string;
    labelEn?: string;
    isRTL: boolean;
    /** Verified-merchant tone vs sponsored tone */
    variant?: 'sponsored' | 'verified';
    size?: 'sm' | 'md';
}

/**
 * Gold "Sponsored" or "Verified" pill rendered on top of cards. Phase 2.4
 * requirement: every paid placement must be visually distinct.
 */
const SponsoredBadge: React.FC<Props> = ({
    labelAr, labelEn, isRTL, variant = 'sponsored', size = 'sm'
}) => {
    const label = isRTL
        ? (labelAr || (variant === 'verified' ? 'موثّق ✓' : 'برعاية'))
        : (labelEn || (variant === 'verified' ? 'Verified ✓' : 'Sponsored'));

    const isLg = size === 'md';
    const padY = isLg ? 5 : 3;
    const padX = isLg ? 12 : 8;

    return (
        <span
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: `${padY}px ${padX}px`,
                borderRadius: 999,
                background: variant === 'verified'
                    ? 'linear-gradient(135deg, #3b82f6, #1d4ed8)'
                    : 'linear-gradient(135deg, #fbbf24, #d97706)',
                color: variant === 'verified' ? 'white' : '#1f1300',
                fontSize: isLg ? '0.78rem' : '0.65rem',
                fontWeight: 900,
                letterSpacing: '0.3px',
                boxShadow: variant === 'verified'
                    ? '0 4px 10px rgba(37,99,235,0.4)'
                    : '0 4px 10px rgba(217,119,6,0.4)',
                whiteSpace: 'nowrap'
            }}
        >
            <span style={{ fontSize: isLg ? '0.85rem' : '0.75rem' }}>
                {variant === 'verified' ? '🛡️' : '⭐'}
            </span>
            {label}
        </span>
    );
};

export default React.memo(SponsoredBadge);
