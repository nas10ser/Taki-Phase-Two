import React, { useEffect, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { Sponsorship, sponsorshipRepository } from '../repositories/sponsorshipRepository';
import { useApp } from '../context/AppContext';

interface Props {
    /** Optional pre-fetched list (lets parents share the cache). */
    items?: Sponsorship[];
    /** Sliding cadence in ms (default 5s). */
    intervalMs?: number;
}

/**
 * Phase 2.5.1 — Top hero slider for sponsor banners. Auto-rotates,
 * tracks impressions on view and clicks on tap. Hidden when no
 * active top_slider sponsorships exist.
 */
const TopSlider: React.FC<Props> = ({ items, intervalMs = 5000 }) => {
    const { language, topLocation } = useApp();
    const history = useHistory();
    const isRTL = language === 'ar';
    const [slides, setSlides] = useState<Sponsorship[]>(items || []);
    const [active, setActive] = useState(0);
    const trackedRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (items) { setSlides(items); return; }
        let alive = true;
        sponsorshipRepository.listActive({
            type: 'top_slider',
            city: topLocation.city || undefined,
            mall: topLocation.mall || undefined
        }).then(r => { if (alive) setSlides(r); });
        return () => { alive = false; };
    }, [items, topLocation.city, topLocation.mall]);

    useEffect(() => {
        if (slides.length < 2) return;
        const t = window.setInterval(() => setActive(i => (i + 1) % slides.length), intervalMs);
        return () => clearInterval(t);
    }, [slides.length, intervalMs]);

    useEffect(() => {
        const cur = slides[active];
        if (!cur) return;
        if (trackedRef.current.has(cur.id)) return;
        trackedRef.current.add(cur.id);
        sponsorshipRepository.trackImpression(cur.id).catch(() => {});
    }, [active, slides]);

    if (slides.length === 0) return null;

    const cur = slides[active];
    const title = isRTL ? (cur.titleAr || '') : (cur.titleEn || '');
    const body = isRTL ? (cur.bodyAr || '') : (cur.bodyEn || '');
    const cta = isRTL ? (cur.ctaLabelAr || 'استكشاف') : (cur.ctaLabelEn || 'Explore');

    const handleClick = () => {
        sponsorshipRepository.trackClick(cur.id).catch(() => {});
        if (cur.actionUrl) {
            if (cur.actionUrl.startsWith('http')) window.open(cur.actionUrl, '_blank', 'noopener');
            else history.push(cur.actionUrl);
        }
    };

    return (
        <div
            className="top-slider"
            style={{
                position: 'relative',
                margin: '12px 16px 8px',
                borderRadius: 18,
                overflow: 'hidden',
                background: cur.imageUrl ? '#000' : 'linear-gradient(135deg, #fbbf24, #d97706)',
                cursor: cur.actionUrl ? 'pointer' : 'default',
                boxShadow: '0 10px 24px rgba(217,119,6,0.25)',
                minHeight: 140
            }}
            onClick={handleClick}
            role="button"
            aria-label={title || 'Sponsored banner'}
        >
            {cur.imageUrl && (
                <img
                    src={cur.imageUrl}
                    alt=""
                    style={{
                        position: 'absolute', inset: 0,
                        width: '100%', height: '100%',
                        objectFit: 'cover', opacity: 0.65
                    }}
                />
            )}
            <div style={{
                position: 'relative',
                padding: '18px 20px',
                color: 'white',
                background: cur.imageUrl ? 'linear-gradient(to top, rgba(0,0,0,0.55), rgba(0,0,0,0.0))' : 'transparent'
            }}>
                <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(8px)',
                    padding: '4px 10px', borderRadius: 999,
                    fontSize: '0.7rem', fontWeight: 800, marginBottom: 8
                }}>
                    ⭐ {isRTL ? cur.badgeLabelAr : cur.badgeLabelEn}
                </div>
                <div style={{ fontSize: '1.15rem', fontWeight: 900, marginBottom: 4 }}>{title}</div>
                {body && (
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, opacity: 0.9, lineHeight: 1.5, marginBottom: 8 }}>
                        {body}
                    </div>
                )}
                {cur.actionUrl && (
                    <span style={{
                        display: 'inline-block',
                        background: 'white', color: '#0f172a',
                        padding: '6px 14px', borderRadius: 999,
                        fontSize: '0.8rem', fontWeight: 900,
                        marginTop: 4
                    }}>
                        {cta} {isRTL ? '←' : '→'}
                    </span>
                )}
            </div>

            {slides.length > 1 && (
                <div style={{
                    position: 'absolute', bottom: 8, insetInlineStart: 0, insetInlineEnd: 0,
                    display: 'flex', justifyContent: 'center', gap: 6
                }}>
                    {slides.map((_, i) => (
                        <span key={i} style={{
                            width: i === active ? 18 : 6,
                            height: 6,
                            borderRadius: 3,
                            background: i === active ? 'white' : 'rgba(255,255,255,0.5)',
                            transition: 'all 0.3s ease'
                        }} />
                    ))}
                </div>
            )}
        </div>
    );
};

export default TopSlider;
