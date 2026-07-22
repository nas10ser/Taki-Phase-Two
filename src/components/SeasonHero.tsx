import React from 'react';
import { useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { getSeasonById, campaignPublicLive, seasonHeroTexts } from '../data/seasons';

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
    // v12.69 — نص البانر تحت تحكم المالك من لوحة المدير (حملة الموسم)،
    // والفراغ = النص الافتراضي للموسم.
    const hero = seasonHeroTexts(season, platformSettings.seasonCampaign, isRTL);

    return (
        <div className="season-hero animate-fade-in" dir={isRTL ? 'rtl' : 'ltr'}>
            <div className="season-hero-emoji" aria-hidden>{season.emoji}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div className="season-hero-title">{hero.title}</div>
                <div className="season-hero-tagline">{hero.tagline}</div>
            </div>
            <button
                type="button"
                className="season-hero-cta"
                // v12.48 — عندما تكون صفحة عروض الموسم الحصرية مفتوحة للعامة،
                // «تسوّق الآن» يقود إليها مباشرة؛ وإلا يبقى على كل العروض.
                onClick={() => history.push(campaignPublicLive(platformSettings.seasonCampaign) ? '/seasonal' : '/deals?type=all')}
                aria-label={isRTL ? `تسوّق عروض ${season.ar}` : `Shop ${season.en} deals`}
            >
                {isRTL ? 'تسوّق الآن' : 'Shop now'}
            </button>
        </div>
    );
};

export default SeasonHero;
