import React, { useEffect, useRef } from 'react';
import { useHistory } from 'react-router-dom';
import { Sponsorship, sponsorshipRepository } from '../repositories/sponsorshipRepository';

interface Props {
    item: Sponsorship;
    isRTL: boolean;
}

/**
 * Phase 2.5.2 — Inline horizontal banner injected between sections
 * of the buyer's feed. Tracks impression once when first rendered.
 */
const InlineBanner: React.FC<Props> = ({ item, isRTL }) => {
    const history = useHistory();
    const tracked = useRef(false);

    useEffect(() => {
        if (tracked.current) return;
        tracked.current = true;
        sponsorshipRepository.trackImpression(item.id).catch(() => {});
    }, [item.id]);

    const handleClick = () => {
        sponsorshipRepository.trackClick(item.id).catch(() => {});
        if (item.actionUrl) {
            if (item.actionUrl.startsWith('http')) window.open(item.actionUrl, '_blank', 'noopener');
            else history.push(item.actionUrl);
        }
    };

    return (
        <div
            onClick={handleClick}
            role="button"
            aria-label={isRTL ? item.titleAr : item.titleEn}
            style={{
                margin: '8px 16px',
                borderRadius: 16,
                overflow: 'hidden',
                background: 'linear-gradient(110deg, #fff7ed 0%, #fde68a 100%)',
                border: '1.5px solid #fcd34d',
                display: 'flex', alignItems: 'center', gap: 12,
                padding: 12, cursor: item.actionUrl ? 'pointer' : 'default',
                boxShadow: '0 6px 18px rgba(245, 158, 11, 0.18)'
            }}
        >
            {item.imageUrl && (
                <img
                    src={item.imageUrl}
                    alt=""
                    loading="lazy"
                    style={{
                        width: 64, height: 64,
                        objectFit: 'cover', borderRadius: 12, flexShrink: 0
                    }}
                />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                    display: 'inline-block',
                    background: 'rgba(245,158,11,0.15)',
                    color: '#92400e', padding: '2px 8px', borderRadius: 999,
                    fontSize: '0.65rem', fontWeight: 800, marginBottom: 4
                }}>
                    ⭐ {isRTL ? item.badgeLabelAr : item.badgeLabelEn}
                </div>
                <div style={{
                    fontWeight: 900, fontSize: '0.95rem', color: '#1f1300',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                }}>
                    {isRTL ? item.titleAr : item.titleEn}
                </div>
                {(item.bodyAr || item.bodyEn) && (
                    <div style={{
                        fontSize: '0.78rem', color: '#78350f', fontWeight: 600,
                        marginTop: 2, lineHeight: 1.4,
                        overflow: 'hidden', textOverflow: 'ellipsis',
                        display: '-webkit-box', WebkitLineClamp: 2 as any, WebkitBoxOrient: 'vertical' as any
                    }}>
                        {isRTL ? item.bodyAr : item.bodyEn}
                    </div>
                )}
            </div>
            {item.actionUrl && (
                <div style={{
                    fontSize: '1.4rem', color: '#92400e', flexShrink: 0
                }}>
                    {isRTL ? '←' : '→'}
                </div>
            )}
        </div>
    );
};

export default React.memo(InlineBanner);
