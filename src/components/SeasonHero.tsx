import React from 'react';
import { useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { getSeasonById } from '../data/seasons';

/**
 * v12.44 — بانر «هوية الموسم» أعلى الرئيسية.
 * يظهر فقط عندما يفعّل المالك موسماً من لوحة المدير (أدوات الإدارة →
 * هوية المواسم). الخلفية والتوهّج والكرات الضوئية كلها متغيرات CSS
 * لكل موسم — فاتح وداكن — فلا يحتاج الكومبوننت أي ألوان مضمّنة.
 */
const SeasonHero: React.FC = () => {
    const history = useHistory();
    const { platformSettings, language } = useApp();
    const season = getSeasonById(platformSettings.seasonalTheme);
    if (!season) return null;
    const isRTL = language === 'ar';

    return (
        <div className="season-hero animate-fade-in" dir={isRTL ? 'rtl' : 'ltr'}>
            <div className="season-hero-emoji" aria-hidden>{season.emoji}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div className="season-hero-title">
                    {isRTL ? `عروض ${season.ar}` : `${season.en} Deals`}
                </div>
                <div className="season-hero-tagline">
                    {isRTL ? season.taglineAr : season.taglineEn}
                </div>
            </div>
            <button
                type="button"
                className="season-hero-cta"
                onClick={() => history.push('/deals?type=all')}
                aria-label={isRTL ? `تسوّق عروض ${season.ar}` : `Shop ${season.en} deals`}
            >
                {isRTL ? 'تسوّق الآن' : 'Shop now'}
            </button>
        </div>
    );
};

export default SeasonHero;
