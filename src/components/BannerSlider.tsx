import React, { useState, useEffect, useRef } from 'react';
import { useHistory } from 'react-router-dom';
import { Banner } from '../repositories/bannerRepository';

interface BannerSliderProps {
    banners: Banner[];
    isRTL: boolean;
    height?: number;
}

const BannerSlider: React.FC<BannerSliderProps> = ({ banners, isRTL, height = 180 }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const history = useHistory();
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (banners.length > 1) {
            timeoutRef.current = setTimeout(
                () => setCurrentIndex(i => (i + 1) % banners.length),
                5000
            );
        }
        return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
    }, [currentIndex, banners.length]);

    if (banners.length === 0) return null;

    const handleClick = (banner: Banner) => {
        if (banner.deal_id)        history.push(`/deal/${banner.deal_id}`);
        else if (banner.store_id)  history.push(`/store/${banner.store_id}`);
        else if (banner.target_url) {
            if (banner.target_url.startsWith('http')) window.open(banner.target_url, '_blank');
            else history.push(banner.target_url);
        }
    };

    const isClickable = (b: Banner) => !!(b.deal_id || b.store_id || b.target_url);

    return (
        <div style={{ position: 'relative', width: '100%', height, borderRadius: 24, overflow: 'hidden', marginBottom: 24, boxShadow: 'var(--shadow-lg)' }}>
            <div style={{
                display: 'flex',
                width: `${banners.length * 100}%`,
                height: '100%',
                transform: `translateX(${isRTL ? (currentIndex * (100 / banners.length)) : (-currentIndex * (100 / banners.length))}%)`,
                transition: 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)'
            }}>
                {banners.map(banner => {
                    const showImage = banner.display_type !== 'text' && !!banner.image_url;
                    const showText  = banner.display_type !== 'image' && !!(banner.text_ar || banner.text_en);
                    const title = isRTL ? (banner.title_ar || banner.title_en) : (banner.title_en || banner.title_ar);
                    const text  = isRTL ? (banner.text_ar  || banner.text_en)  : (banner.text_en  || banner.text_ar);
                    return (
                        <div key={banner.id}
                             onClick={() => handleClick(banner)}
                             style={{
                                 width: `${100 / banners.length}%`, height: '100%',
                                 position: 'relative',
                                 cursor: isClickable(banner) ? 'pointer' : 'default',
                                 background: showImage ? '#000' : (banner.bg_color || '#10b981'),
                                 display: 'flex', alignItems: 'center', justifyContent: 'center'
                             }}>
                            {showImage && (
                                <img src={banner.image_url} alt={title || ''}
                                     style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            )}
                            {(showText || title) && (
                                <div style={{
                                    position: 'absolute', inset: 0,
                                    background: showImage ? 'linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0.05))' : 'transparent',
                                    display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
                                    padding: '20px 24px', color: 'white', textAlign: 'center'
                                }}>
                                    {title && (
                                        <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900, textShadow: showImage ? '0 2px 8px rgba(0,0,0,0.5)' : 'none' }}>
                                            {title}
                                        </h3>
                                    )}
                                    {showText && text && (
                                        <p style={{ margin: '6px 0 0', fontSize: '0.95rem', fontWeight: 600, lineHeight: 1.5, textShadow: showImage ? '0 2px 6px rgba(0,0,0,0.5)' : 'none' }}>
                                            {text}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {banners.length > 1 && (
                <div style={{
                    position: 'absolute', bottom: 12,
                    [isRTL ? 'left' : 'right']: 20,
                    display: 'flex', gap: 6
                }}>
                    {banners.map((_, idx) => (
                        <div key={idx}
                             onClick={(e) => { e.stopPropagation(); setCurrentIndex(idx); }}
                             style={{
                                 width: idx === currentIndex ? 24 : 8, height: 8, borderRadius: 4,
                                 background: idx === currentIndex ? 'white' : 'rgba(255,255,255,0.4)',
                                 transition: 'all 0.3s ease', cursor: 'pointer',
                                 boxShadow: idx === currentIndex ? '0 0 10px rgba(0,0,0,0.3)' : 'none'
                             }} />
                    ))}
                </div>
            )}
        </div>
    );
};

export default BannerSlider;
