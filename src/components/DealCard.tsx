import React, { useEffect, useState } from 'react';
import { Deal, getLocation } from '../data/mock';
import { useApp } from '../context/AppContext';
import { dealService } from '../services/dealService';

interface Props {
    deal: Deal;
    onClick: (id: string) => void;
    isSponsored?: boolean;
}

const GENDER_EMOJI: { [key: string]: string } = {
    all: '👥',
    men: '👨',
    women: '👩',
    kids: '👶',
    other: '✨',
};

// Live countdown shown on each card so the buyer sees urgency.
// Format: "2س 15د" / "5د 23ث" / "30ث" — switches granularity as time runs out.
const formatRemaining = (createdAt: number, expiresInMinutes: number, isRTL: boolean): { text: string; urgent: boolean; expired: boolean } => {
    const lifespan = (expiresInMinutes || 0) * 60 * 1000;
    const expiry = (createdAt || 0) + lifespan;
    const diff = expiry - Date.now();
    if (diff <= 0) return { text: isRTL ? 'منتهي' : 'Expired', urgent: false, expired: true };

    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff / 3600000) % 24);
    const mins = Math.floor((diff / 60000) % 60);
    const secs = Math.floor((diff / 1000) % 60);
    const urgent = diff < 3600000; // less than 1 hour

    if (days > 0) return { text: isRTL ? `${days}ي ${hours}س` : `${days}d ${hours}h`, urgent: false, expired: false };
    if (hours > 0) return { text: isRTL ? `${hours}س ${mins}د` : `${hours}h ${mins}m`, urgent, expired: false };
    if (mins > 0) return { text: isRTL ? `${mins}د ${secs.toString().padStart(2,'0')}ث` : `${mins}m ${secs}s`, urgent: true, expired: false };
    return { text: isRTL ? `${secs}ث` : `${secs}s`, urgent: true, expired: false };
};

const DealCard: React.FC<Props> = ({ deal, onClick, isSponsored }) => {
    const { toggleFollowMerchant, followedMerchants, language } = useApp();
    const { average, count } = dealService.calculateRating(deal.ratings);
    const loc = getLocation(deal.locationId);
    const isFollowed = followedMerchants.includes(deal.storeId);

    const imageUrl = Array.isArray(deal.images) ? deal.images[0] : (deal as unknown as { image?: string }).image || '';
    const isRTL = language === 'ar';

    // Tick the countdown every second so the urgency indicator stays live.
    const [remaining, setRemaining] = useState(() => formatRemaining(deal.createdAt, deal.expiresInMinutes || 0, isRTL));
    useEffect(() => {
        const tick = () => setRemaining(formatRemaining(deal.createdAt, deal.expiresInMinutes || 0, isRTL));
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [deal.createdAt, deal.expiresInMinutes, isRTL]);

    const handleFollowClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        toggleFollowMerchant(deal.storeId);
    };

    return (
        <div
            className={`deal-card animate-fade-in ${isSponsored ? 'shadow-yellow-500/20' : ''}`}
            onClick={() => onClick(deal.id)}
            style={isSponsored ? { border: '2px solid #fbbf24', position: 'relative' } : { position: 'relative' }}
        >
            {isSponsored && (
                <div style={{
                    position: 'absolute',
                    top: -12,
                    [isRTL ? 'right' : 'left']: 16,
                    background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
                    color: '#fff',
                    padding: '2px 12px',
                    borderRadius: '12px',
                    fontSize: '0.7rem',
                    fontWeight: 900,
                    zIndex: 10,
                    boxShadow: '0 2px 4px rgba(245,158,11,0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                }}>
                    <span>⭐</span>
                    {isRTL ? 'برعاية' : 'Sponsored'}
                </div>
            )}
            <div className="deal-card-media" style={{ position: 'relative', overflow: 'hidden', borderTopLeftRadius: isSponsored ? 22 : 24, borderTopRightRadius: isSponsored ? 22 : 24 }}>
                <img
                    src={imageUrl}
                    loading="lazy"
                    decoding="async"
                    width={400}
                    height={400}
                    alt={deal.itemName}
                    /* Square 1:1 — Noon-style density. Shortest aspect that still
                       reads as a photo, keeps cards scannable on phone & desktop. */
                    style={{ width: '100%', aspectRatio: '1 / 1', height: 'auto', objectFit: 'cover', display: 'block', transition: 'transform 0.3s ease' }}
                    onError={(e: React.SyntheticEvent<HTMLImageElement, Event>) => {
                        (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1543332164-6e82f355badc?w=600';
                    }}
                />
                <button
                    onClick={handleFollowClick}
                    aria-label={isFollowed ? (isRTL ? 'إلغاء المتابعة' : 'Unfollow') : (isRTL ? 'متابعة' : 'Follow')}
                    style={{
                        position: 'absolute',
                        top: 8,
                        [isRTL ? 'left' : 'right']: 8,
                        background: 'rgba(255, 255, 255, 0.95)',
                        backdropFilter: 'blur(8px)',
                        border: 'none',
                        /* 36×36 visible — keeps the deal card visually clean — but the global
                           `min-height: 44px` rule from styles.css gives it a real 44px hit area. */
                        width: 36,
                        height: 36,
                        minWidth: 0,
                        minHeight: 0,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 2px 10px rgba(0,0,0,0.12)',
                        color: isFollowed ? '#ef4444' : '#94a3b8',
                        fontSize: '0.95rem',
                        transition: 'all 0.2s ease'
                    }}
                >
                    {isFollowed ? '❤️' : '🤍'}
                </button>
                <div style={{
                    position: 'absolute',
                    bottom: 10,
                    [isRTL ? 'right' : 'left']: 10,
                    background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                    color: 'white',
                    padding: '4px 10px',
                    borderRadius: 8,
                    fontSize: '0.7rem',
                    fontWeight: 900,
                    boxShadow: '0 2px 8px rgba(239,68,68,0.3)'
                }}>
                    -{deal.discountPercentage}%
                </div>
                {/* Live countdown — pulses red in the final hour so urgency reads at a glance. */}
                <div style={{
                    position: 'absolute',
                    bottom: 10,
                    [isRTL ? 'left' : 'right']: 10,
                    background: remaining.expired
                        ? 'rgba(100,116,139,0.92)'
                        : remaining.urgent
                            ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
                            : 'rgba(15,23,42,0.78)',
                    color: 'white',
                    padding: '4px 10px',
                    borderRadius: 8,
                    fontSize: '0.7rem',
                    fontWeight: 900,
                    backdropFilter: 'blur(8px)',
                    boxShadow: remaining.urgent ? '0 2px 10px rgba(239,68,68,0.45)' : '0 2px 6px rgba(0,0,0,0.25)',
                    animation: remaining.urgent && !remaining.expired ? 'pulse 1.4s ease-in-out infinite' : 'none',
                    display: 'flex', alignItems: 'center', gap: 4
                }}>
                    <span style={{ fontSize: '0.75rem' }}>{remaining.expired ? '⏹' : '⏱'}</span>
                    <span>{remaining.text}</span>
                </div>
                {loc && (
                    <div style={{
                        position: 'absolute',
                        top: 10,
                        [isRTL ? 'right' : 'left']: 10,
                        background: 'rgba(0,0,0,0.45)',
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: 8,
                        fontSize: '0.6rem',
                        fontWeight: 600,
                        backdropFilter: 'blur(8px)',
                        maxWidth: 100,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap' as const
                    }}>
                        📍 {loc.name}
                    </div>
                )}
            </div>

            <div style={{ padding: '12px 14px' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 800, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{deal.shopName}</div>
                <div style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 8, display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden' }}>
                    {deal.itemName}
                </div>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: '1.2rem', fontWeight: 950, color: 'var(--danger)' }}>{deal.discountedPrice} ر.س</span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--gray-400)', textDecoration: 'line-through', fontWeight: 700 }}>{deal.originalPrice}</span>
                </div>

                <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 800 }}>
                        {(() => {
                            if (deal.quantity === 'unlimited') return isRTL ? 'الكمية: لامحدودة' : 'Qty: Unlim';
                            if (typeof deal.quantity === 'number' && deal.quantity > 0) {
                                return isRTL ? `الكمية: ${deal.quantity}` : `Qty: ${deal.quantity}`;
                            }
                            const hasCap = typeof deal.initialQuantity === 'number' && deal.initialQuantity > 0;
                            // No stock cap means the seller is running a time-based offer.
                            if (!hasCap) return isRTL ? '⏱ عرض زمني' : '⏱ Time-limited';
                            return isRTL ? 'نفذت' : 'Sold Out';
                        })()}
                    </div>
                    <div style={{ background: 'var(--secondary-light)', color: '#92400e', padding: '4px 10px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 900 }}>
                        ★ {average > 0 ? average : (isRTL ? 'جديد' : 'New')}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default React.memo(DealCard);
