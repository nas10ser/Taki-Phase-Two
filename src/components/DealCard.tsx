import React, { useEffect, useState } from 'react';
import { Deal, getLocation } from '../data/mock';
import { useApp } from '../context/AppContext';
import { dealService } from '../services/dealService';
import { isDealComingSoon, formatComingSoonRemaining, dealLifespanStart, sponsorLabelText, SponsorLabel } from '../utils/helpers';

interface Props {
    deal: Deal;
    onClick: (id: string) => void;
    isSponsored?: boolean;
    sponsorLabel?: SponsorLabel;   // 'ad' | 'sponsor' | 'none' — controls the badge text
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

const DealCard: React.FC<Props> = ({ deal, onClick, isSponsored, sponsorLabel }) => {
    const { toggleFollowMerchant, followedMerchants, language } = useApp();
    const { average, count } = dealService.calculateRating(deal.ratings);
    const loc = getLocation(deal.locationId);
    const isFollowed = followedMerchants.includes(deal.storeId);

    const imageUrl = Array.isArray(deal.images) ? deal.images[0] : (deal as unknown as { image?: string }).image || '';
    const isRTL = language === 'ar';

    // v11.20 — Coming Soon overrides the live-countdown. We show the time
    // remaining UNTIL the deal opens instead of UNTIL it expires, with a
    // lock + dim overlay so the buyer instantly understands they can't book.
    const comingSoon = isDealComingSoon(deal);

    // Tick the countdown every second so the urgency indicator stays live.
    // v11.20 — once a scheduled deal flips to live we anchor the lifespan
    // countdown to startsAt (not createdAt) so the merchant's chosen
    // "valid for 2h" actually means 2h starting from launch.
    const [remaining, setRemaining] = useState(() =>
        comingSoon
            ? (() => { const r = formatComingSoonRemaining(deal.startsAt!, isRTL); return { text: r.text, urgent: r.urgent, expired: false }; })()
            : formatRemaining(dealLifespanStart(deal), deal.expiresInMinutes || 0, isRTL)
    );
    useEffect(() => {
        const tick = () => {
            if (isDealComingSoon(deal)) {
                const r = formatComingSoonRemaining(deal.startsAt!, isRTL);
                setRemaining({ text: r.text, urgent: r.urgent, expired: false });
            } else {
                setRemaining(formatRemaining(dealLifespanStart(deal), deal.expiresInMinutes || 0, isRTL));
            }
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [deal.createdAt, deal.expiresInMinutes, deal.startsAt, isRTL]);

    const handleFollowClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        toggleFollowMerchant(deal.storeId);
    };

    return (
        <div
            className={`deal-card animate-fade-in ${isSponsored ? 'taki-sponsored' : ''}`}
            onClick={() => onClick(deal.id)}
            style={isSponsored ? {
                position: 'relative',
                // Premium double gold ring + warm glow. Works on both light and
                // dark themes (gradient border, not a theme-var color).
                border: '2px solid transparent',
                borderRadius: 24,
                backgroundImage: 'linear-gradient(var(--card-bg), var(--card-bg)), linear-gradient(135deg, #fde68a 0%, #f59e0b 45%, #b45309 100%)',
                backgroundOrigin: 'border-box',
                backgroundClip: 'padding-box, border-box',
                boxShadow: '0 6px 22px rgba(245,158,11,0.35)'
            } : { position: 'relative' }}
        >
            {isSponsored && sponsorLabelText(sponsorLabel, isRTL) !== '' && (
                <div style={{
                    // v11.27 — the badge sits INSIDE the card's top edge. The old
                    // `top:-12` placed it above the card, but `.deal-card` has
                    // overflow:hidden so it was clipped (Nasser's screenshot:
                    // half-cut gold strip). Now it's a full-width gold ribbon
                    // pinned to the top of the image — impossible to clip, always
                    // sharp and readable.
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 55%, #b45309 100%)',
                    color: '#fff',
                    padding: '6px 10px',
                    fontSize: '0.82rem',
                    fontWeight: 900,
                    zIndex: 10,
                    boxShadow: '0 2px 8px rgba(180,83,9,0.5)',
                    textShadow: '0 1px 2px rgba(0,0,0,0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    letterSpacing: '0.5px',
                    whiteSpace: 'nowrap',
                    borderTopLeftRadius: 21,
                    borderTopRightRadius: 21
                }}>
                    <span style={{ fontSize: '0.9rem' }}>⭐</span>
                    {sponsorLabelText(sponsorLabel, isRTL)}
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
                    style={{
                        width: '100%', aspectRatio: '1 / 1', height: 'auto', objectFit: 'cover', display: 'block', transition: 'transform 0.3s ease',
                        // v11.20 — Coming Soon dims the image the same way expired
                        // deals do (40% black overlay + 60% brightness). Reads
                        // instantly as "not bookable" without removing the photo.
                        filter: comingSoon ? 'brightness(0.6) saturate(0.85)' : undefined
                    }}
                    onError={(e: React.SyntheticEvent<HTMLImageElement, Event>) => {
                        (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1543332164-6e82f355badc?w=600';
                    }}
                />
                {/* v11.20 — Coming Soon lock overlay. Sits above the image, below
                    the follow / discount / countdown chips so those remain
                    readable. Lock icon + Arabic/English "قريباً" label. */}
                {comingSoon && (
                    <div style={{
                        position: 'absolute', inset: 0,
                        background: 'linear-gradient(135deg, rgba(15,23,42,0.45) 0%, rgba(15,23,42,0.15) 50%, rgba(15,23,42,0.55) 100%)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        pointerEvents: 'none'
                    }}>
                        <div style={{
                            background: 'rgba(15,23,42,0.78)',
                            backdropFilter: 'blur(10px)',
                            color: 'white',
                            padding: '10px 16px',
                            borderRadius: 14,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            fontSize: '0.78rem',
                            fontWeight: 900,
                            boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
                            border: '1.5px solid rgba(255,255,255,0.18)'
                        }}>
                            <span style={{ fontSize: '1.15rem', lineHeight: 1 }}>🔒</span>
                            <span>{isRTL ? 'قريباً' : 'Coming soon'}</span>
                        </div>
                    </div>
                )}
                <button
                    onClick={handleFollowClick}
                    aria-label={isFollowed ? (isRTL ? 'إلغاء المتابعة' : 'Unfollow') : (isRTL ? 'متابعة' : 'Follow')}
                    style={{
                        position: 'absolute',
                        // When the gold sponsor ribbon is shown it occupies the
                        // top strip — drop the heart below it so neither is
                        // covered (v11.27).
                        top: (isSponsored && sponsorLabelText(sponsorLabel, isRTL) !== '') ? 42 : 8,
                        [isRTL ? 'left' : 'right']: 8,
                        zIndex: 11,
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
                {/* Live countdown — pulses red in the final hour so urgency reads
                    at a glance. v11.20: for Coming Soon deals the countdown
                    counts DOWN to the launch (startsAt) and goes solid red
                    in the last 4 hours so the buyer knows it's about to open. */}
                <div style={{
                    position: 'absolute',
                    bottom: 10,
                    [isRTL ? 'left' : 'right']: 10,
                    background: remaining.expired
                        ? 'rgba(100,116,139,0.92)'
                        : comingSoon && remaining.urgent
                            ? 'linear-gradient(135deg, #dc2626, #b91c1c)'
                            : comingSoon
                                ? 'linear-gradient(135deg, #6366f1, #4f46e5)'
                                : remaining.urgent
                                    ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
                                    : 'rgba(15,23,42,0.78)',
                    color: 'white',
                    padding: '4px 10px',
                    borderRadius: 8,
                    fontSize: '0.7rem',
                    fontWeight: 900,
                    backdropFilter: 'blur(8px)',
                    boxShadow: (remaining.urgent || comingSoon) ? '0 2px 10px rgba(99,102,241,0.45)' : '0 2px 6px rgba(0,0,0,0.25)',
                    animation: remaining.urgent && !remaining.expired ? 'pulse 1.4s ease-in-out infinite' : 'none',
                    display: 'flex', alignItems: 'center', gap: 4,
                    zIndex: 2
                }}>
                    <span style={{ fontSize: '0.75rem' }}>{remaining.expired ? '⏹' : comingSoon ? '⏳' : '⏱'}</span>
                    <span>{remaining.text}</span>
                </div>
                {loc && (
                    <div style={{
                        position: 'absolute',
                        // Drop below the gold ribbon when sponsored (v11.27).
                        top: (isSponsored && sponsorLabelText(sponsorLabel, isRTL) !== '') ? 42 : 10,
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
