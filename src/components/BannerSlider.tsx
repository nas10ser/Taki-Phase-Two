import React, { useState, useEffect, useRef } from 'react';
import { useHistory } from 'react-router-dom';
import { Banner } from '../repositories/bannerRepository';
import { openExternalUrl } from '../utils/helpers';

interface BannerSliderProps {
    banners: Banner[];
    isRTL: boolean;
}

const BannerSlider: React.FC<BannerSliderProps> = ({ banners, isRTL }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const history = useHistory();
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    const resetTimeout = () => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }
    };

    useEffect(() => {
        resetTimeout();
        if (banners.length > 1) {
            timeoutRef.current = setTimeout(
                () => setCurrentIndex((prevIndex) => (prevIndex + 1) % banners.length),
                5000
            );
        }
        return () => resetTimeout();
    }, [currentIndex, banners.length]);

    if (banners.length === 0) return null;

    const handleBannerClick = (banner: Banner) => {
        if (banner.deal_id) {
            history.push(`/deal/${banner.deal_id}`);
        } else if (banner.store_id) {
            history.push(`/store/${banner.store_id}`);
        } else if (banner.target_url) {
            if (banner.target_url.startsWith('http')) {
                openExternalUrl(banner.target_url);
            } else {
                history.push(banner.target_url);
            }
        }
    };

    return (
        <div style={{ position: 'relative', width: '100%', height: 180, borderRadius: 24, overflow: 'hidden', marginBottom: 24, boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ 
                display: 'flex', 
                width: `${banners.length * 100}%`, 
                height: '100%', 
                transform: `translateX(${isRTL ? (currentIndex * (100 / banners.length)) : (-currentIndex * (100 / banners.length))}%)`,
                transition: 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)'
            }}>
                {banners.map((banner, idx) => (
                    <div
                        key={banner.id}
                        onClick={() => handleBannerClick(banner)}
                        style={{
                            width: `${100 / banners.length}%`,
                            height: '100%',
                            position: 'relative',
                            cursor: 'pointer'
                        }}
                    >
                        <img
                            src={banner.image_url}
                            alt={isRTL ? banner.title_ar : banner.title_en}
                            width={1200}
                            height={400}
                            loading={idx === 0 ? 'eager' : 'lazy'}
                            decoding="async"
                            // First banner is the LCP element on Home; prioritize it.
                            {...(idx === 0 ? { fetchpriority: 'high' as 'high' } : {})}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                        {(banner.title_ar || banner.title_en) && (
                            <div style={{ 
                                position: 'absolute', 
                                bottom: 0, 
                                left: 0, 
                                right: 0, 
                                background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)', 
                                padding: '40px 20px 20px',
                                color: 'white'
                            }}>
                                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 900 }}>
                                    {isRTL ? banner.title_ar : banner.title_en}
                                </h3>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {banners.length > 1 && (
                <div style={{ 
                    position: 'absolute', 
                    bottom: 15, 
                    [isRTL ? 'left' : 'right']: 20, 
                    display: 'flex', 
                    gap: 6 
                }}>
                    {banners.map((_, idx) => (
                        <div 
                            key={idx} 
                            onClick={(e) => { e.stopPropagation(); setCurrentIndex(idx); }}
                            style={{ 
                                width: idx === currentIndex ? 24 : 8, 
                                height: 8, 
                                borderRadius: 4, 
                                background: idx === currentIndex ? 'white' : 'rgba(255,255,255,0.4)',
                                transition: 'all 0.3s ease',
                                cursor: 'pointer',
                                boxShadow: idx === currentIndex ? '0 0 10px rgba(0,0,0,0.3)' : 'none'
                            }} 
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export default BannerSlider;
