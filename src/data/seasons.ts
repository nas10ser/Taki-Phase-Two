// v12.44 — «هوية المواسم»: تعريف المواسم السعودية التي يفعّلها المالك بنقرة
// واحدة من لوحة المدير. التفعيل يكتب platform_settings.seasonal_theme ويصل
// لكل الأجهزة عبر realtime؛ الـCSS في styles.css يقرأ data-season على <html>
// ويبدّل هوية الألوان كاملة (فاتح + داكن). الاختيار يدوي ١٠٠٪ — المالك يقرّر
// التاريخ، لا يوجد تفعيل تلقائي بالتقويم.
// v12.45 — فصل «العيد» عن «رمضان» بهوية مستقلة + إعدادات «عمق الموسم» (fx):
// عناصر متحركة تملأ الشاشة كلها (فوانيس تهبط في رمضان، شموس في الصيف،
// بالونات تصعد في العيد…) عبر SeasonFX.tsx — نفس المعرّفات تُستخدم نصياً
// في البوتين (server/lib/season.js) فأبقِ القائمتين متطابقتي المعرّفات.

export interface SeasonFx {
    /** fall = تهبط من الأعلى للأسفل، rise = تصعد من الأسفل (العيد: بالونات) */
    mode: 'fall' | 'rise';
    /** الرموز المتحركة — تتكرر بالتناوب على كل العناصر، كرّر رمزاً ليهيمن */
    items: string[];
}

export interface Season {
    id: string;
    emoji: string;
    ar: string;
    en: string;
    /** سطر تسويقي يظهر للمتسوّق في بانر الرئيسية */
    taglineAr: string;
    taglineEn: string;
    /** تلميح التوقيت — يظهر للأدمن فقط في بطاقة التفعيل */
    hintAr: string;
    /** معاينة التدرّج في بطاقات الأدمن (ثابتة، لا تتأثر بالثيم الحالي) */
    swatch: string;
    /** عناصر العمق المتحركة عبر كامل الصفحة */
    fx: SeasonFx;
}

export const SEASONS: Season[] = [
    {
        id: 'ramadan',
        emoji: '🏮',
        ar: 'رمضان',
        en: 'Ramadan',
        taglineAr: 'هلّ الشهر… عروض السحور والملابس ومستلزمات رمضان في مكان واحد.',
        taglineEn: 'Ramadan is here — suhoor, fashion and essentials deals in one place.',
        hintAr: 'شهر رمضان (يتقدّم ~١١ يوماً كل سنة)',
        swatch: 'linear-gradient(130deg, #4c1d95, #7c3aed 55%, #c026d3)',
        fx: { mode: 'fall', items: ['🏮', '🌙', '🏮', '✨', '🏮'] },
    },
    {
        id: 'eid',
        emoji: '🎉',
        ar: 'العيد',
        en: 'Eid',
        taglineAr: 'عيدكم مبارك… العيديات والهدايا وعروض العيد وصلت.',
        taglineEn: 'Eid Mubarak — gifts, Eidiyah and celebration deals have arrived.',
        hintAr: 'عيد الفطر وعيد الأضحى — فعّله ليلة العيد',
        swatch: 'linear-gradient(130deg, #701a75, #c026d3 55%, #f59e0b)',
        fx: { mode: 'rise', items: ['🎈', '🎁', '🎈', '✨', '🎉'] },
    },
    {
        id: 'founding',
        emoji: '🐎',
        ar: 'يوم التأسيس',
        en: 'Founding Day',
        taglineAr: 'يوم بدينا… خصومات بروح التراث بمناسبة ٢٢ فبراير.',
        taglineEn: 'Founding Day — heritage-inspired deals for February 22.',
        hintAr: '٢٢ فبراير',
        swatch: 'linear-gradient(130deg, #713f12, #b45309 55%, #d4a24e)',
        fx: { mode: 'fall', items: ['🌴', '🐪', '✨', '🌴'] },
    },
    {
        id: 'national',
        emoji: '🇸🇦',
        ar: 'اليوم الوطني',
        en: 'National Day',
        taglineAr: 'عزّها في علاها… خصومات وطنية ضخمة من متاجر مدينتك.',
        taglineEn: 'National Day — massive green-day discounts from your city’s stores.',
        hintAr: '٢٣ سبتمبر',
        swatch: 'linear-gradient(130deg, #064e2b, #0e8544 60%, #25b06b)',
        // v12.47 — طلب ناصر: بدون علم في العناصر النازلة؛ القلب الأخضر يهيمن.
        fx: { mode: 'fall', items: ['💚', '✨', '💚'] },
    },
    {
        id: 'school',
        emoji: '🎒',
        ar: 'العودة للمدارس',
        en: 'Back to School',
        taglineAr: 'قرطاسية وملابس وأحذية… جهّز أطفالك بأقل الأسعار.',
        taglineEn: 'Stationery, clothes and shoes — get the kids ready for less.',
        hintAr: 'منتصف أغسطس – أول سبتمبر',
        swatch: 'linear-gradient(130deg, #1e3a8a, #3b82f6 60%, #60a5fa)',
        fx: { mode: 'fall', items: ['📚', '✏️', '🎒', '📐'] },
    },
    {
        id: 'white_friday',
        emoji: '🛍️',
        ar: 'الجمعة البيضاء',
        en: 'White Friday',
        taglineAr: 'ذروة التخفيضات… خصومات تتجاوز ٥٠٪ لفترة محدودة.',
        taglineEn: 'Peak sale season — 50%+ discounts for a limited time.',
        hintAr: 'نهاية نوفمبر',
        swatch: 'linear-gradient(130deg, #0b0f1a, #331122 50%, #b91c1c)',
        fx: { mode: 'fall', items: ['🏷️', '💥', '🛍️', '🏷️'] },
    },
    {
        id: 'summer',
        emoji: '☀️',
        ar: 'إجازة الصيف',
        en: 'Summer Break',
        taglineAr: 'صيّف وارتاح… عروض المساء والمولات طول الإجازة.',
        taglineEn: 'Summer break — evening mall deals all season long.',
        hintAr: 'يونيو – أغسطس',
        swatch: 'linear-gradient(130deg, #0d9488, #06b6d4 60%, #fb923c)',
        fx: { mode: 'fall', items: ['☀️', '☀️', '🍉', '☀️', '🕶️'] },
    },
];

export const getSeasonById = (id: string | undefined | null): Season | undefined =>
    SEASONS.find(s => s.id === id);

// ═══════════════════════════════════════════════════════════════════════
// v12.48 — «حملة الموسم»: نافذتان زمنيتان يحددهما المالك يدوياً بالكامل.
//  - نافذة التجار (seller_from → seller_to): فيها فقط يستطيع التاجر وسم
//    منتجاته كعروض موسم (تحرسها القاعدة بـtrigger أيضاً).
//  - النافذة العامة (public_from → public_to): فيها تظهر صفحة /seasonal
//    للمتسوقين في القائمة الجانبية وزر «تسوّق الآن».
// المصدر: platform_settings.season_campaign (jsonb) عبر AppContext realtime.
// ═══════════════════════════════════════════════════════════════════════

export interface SeasonCampaign {
    seasonId: string;
    eventDate?: string;   // YYYY-MM-DD — تاريخ الفعالية نفسه (للعرض فقط)
    sellerFrom?: string;
    sellerTo?: string;
    publicFrom?: string;
    publicTo?: string;
}

export const parseSeasonCampaign = (value: any): SeasonCampaign | null => {
    if (!value || typeof value !== 'object' || typeof value.season_id !== 'string' || !getSeasonById(value.season_id)) return null;
    return {
        seasonId: value.season_id,
        eventDate: typeof value.event_date === 'string' ? value.event_date : undefined,
        sellerFrom: typeof value.seller_from === 'string' ? value.seller_from : undefined,
        sellerTo: typeof value.seller_to === 'string' ? value.seller_to : undefined,
        publicFrom: typeof value.public_from === 'string' ? value.public_from : undefined,
        publicTo: typeof value.public_to === 'string' ? value.public_to : undefined,
    };
};

/** تاريخ اليوم المحلي بصيغة YYYY-MM-DD (جمهور المنصة سعودي — توقيت الجهاز كافٍ). */
const todayStr = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const inWindow = (from?: string, to?: string): boolean => {
    if (!from || !to) return false;
    const t = todayStr();
    return t >= from && t <= to;
};

/** هل باب إضافة عروض الموسم مفتوح للتجار الآن؟ */
export const campaignSellerOpen = (c: SeasonCampaign | null): boolean =>
    !!c && inWindow(c.sellerFrom, c.sellerTo);

/** هل صفحة عروض الموسم ظاهرة للعامة الآن؟ */
export const campaignPublicLive = (c: SeasonCampaign | null): boolean =>
    !!c && inWindow(c.publicFrom, c.publicTo);
