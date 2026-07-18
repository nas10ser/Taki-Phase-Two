// v12.44 — «هوية المواسم»: تعريف المواسم السعودية التي يفعّلها المالك بنقرة
// واحدة من لوحة المدير. التفعيل يكتب platform_settings.seasonal_theme ويصل
// لكل الأجهزة عبر realtime؛ الـCSS في styles.css يقرأ data-season على <html>
// ويبدّل هوية الألوان كاملة (فاتح + داكن). الاختيار يدوي ١٠٠٪ — المالك يقرّر
// التاريخ، لا يوجد تفعيل تلقائي بالتقويم.

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
}

export const SEASONS: Season[] = [
    {
        id: 'ramadan',
        emoji: '🌙',
        ar: 'رمضان والعيد',
        en: 'Ramadan & Eid',
        taglineAr: 'هلّ الشهر… عروض السحور والعيديات والملابس في مكان واحد.',
        taglineEn: 'Ramadan is here — suhoor, Eid gifts and fashion deals in one place.',
        hintAr: 'رمضان + العيد (يتقدّم ~١١ يوماً كل سنة)',
        swatch: 'linear-gradient(130deg, #4c1d95, #7c3aed 55%, #c026d3)',
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
    },
];

export const getSeasonById = (id: string | undefined | null): Season | undefined =>
    SEASONS.find(s => s.id === id);
