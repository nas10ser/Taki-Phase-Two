/**
 * stockProviders.ts — كتالوجُ أنظمة المخزون، مصنَّفاً بالفئة (v15.08)
 * ═══════════════════════════════════════════════════════════════════════════
 * طلبُ ناصر: «وهيّئ النظام في موقعي بحيث يستطيع استقبال جميع أنواع الأنظمة
 * وربطها سواء مواد غذائيه أو غرف فندقيه — جميع الأنظمة المتواجدة، ولها تصنيف
 * في موقعي».
 *
 * 🔴 والحقيقةُ التي يجب أن يراها التاجر قبل أن يختار: **لا أحد يتكامل مسبقاً
 *    مع «كلّ نظام».** فالطريقةُ التي تفي بالطلب فعلاً هي أن يكون العقدُ
 *    مفتوحاً (`taki_stock_push` — أيُّ نظامٍ يتكلّمه)، والكتالوجُ دليلاً
 *    للأنظمة الشائعة، لا وعداً بتكاملٍ جاهزٍ لكلٍّ منها.
 *
 * 🪤 ولذلك `apiVerified` **حقلٌ لا نثر**: مسحُ توثيقٍ سابقٌ في هذا المشروع
 *    أنتج **اسمَ حقلٍ مختلَقاً** في نظام نقاط بيع، ولم يُمسكه إلا مدقّق.
 *    فما لم تُفتح وثيقتُه الرسمية يُكتب `'unverified'` ويُعرض كذلك للتاجر.
 *
 * 🪤 وإفصاحٌ ثانٍ مقصود (`blockedReason`): **الفنادق لا تُربط اليوم**. لا
 *    يوجد في تاكي أيُّ مفهومٍ لليلةٍ أو فترةٍ أو موعد — لا عمود، لا جدول —
 *    والعرضُ الفندقيّ يُباع اليوم كقطعٍ معدودة تماماً كالقميص. فتصنيفُ
 *    الفنادق في كتالوجٍ بلا هذا الإفصاح وعدٌ بما لا يُنفّذه كود.
 *
 * والنمطُ منسوخٌ من `adminPermissions.ts`: واجهةٌ معرَّفة، مصفوفاتٌ مسطَّحة
 * من كائناتٍ حرفية، ومشتقّاتٌ بـ`.filter()`، وتصديرٌ افتراضيّ.
 */

/** فئاتُ الأنظمة — وهي تصنيفُ الموقع الذي طلبه ناصر. */
export type ProviderSegment = 'food' | 'retail' | 'ecommerce' | 'hotel' | 'beauty' | 'other';

export interface SegmentDef {
    id: ProviderSegment;
    nameAr: string;
    nameEn: string;
    icon: string;
    /** هل يستطيع تاكي اليوم أن يمثّل ما يبيعه هذا القطاع؟ */
    supported: boolean;
    /** ولماذا لا، بصراحة — يُعرض للتاجر ولا يُخفى. */
    blockedReason?: string;
}

export const PROVIDER_SEGMENTS: SegmentDef[] = [
    { id: 'food',      nameAr: 'مطاعم ومقاهٍ ومواد غذائية', nameEn: 'Restaurants, cafés & food', icon: '🍽', supported: true },
    { id: 'retail',    nameAr: 'تجزئة ونقاط بيع',           nameEn: 'Retail & POS',              icon: '🏪', supported: true },
    { id: 'ecommerce', nameAr: 'متاجر إلكترونية',            nameEn: 'Online stores',             icon: '🛒', supported: true },
    { id: 'beauty',    nameAr: 'صالونات وعيادات',            nameEn: 'Salons & clinics',          icon: '💈', supported: true },
    {
        id: 'hotel', nameAr: 'فنادق وشقق مفروشة', nameEn: 'Hotels & serviced apartments', icon: '🏨',
        supported: false,
        blockedReason:
            'تاكي اليوم يبيع بالقطعة لا بالليلة: لا يوجد في النظام مفهومُ تاريخِ وصولٍ ومغادرة ولا فترةٍ محجوزة. '
            + 'فربطُ نظام فندقيّ الآن سيُزامن رقماً لا معنى له. يُفتح هذا القطاع حين يُبنى نموذجُ الفترات.',
    },
    { id: 'other',     nameAr: 'أنظمة أخرى',                 nameEn: 'Other systems',             icon: '🔌', supported: true },
];

export interface ProviderDef {
    id: string;
    nameAr: string;
    nameEn: string;
    segment: ProviderSegment;
    /** السعودية أوّلاً — ثمّ العالمية التي تُستعمل هنا. */
    saudi: boolean;
    /**
     * ما تأكّد من **وثيقةٍ رسمية** فقط:
     *   'yes'        — فُتحت الوثيقة وتقول ذلك
     *   'unverified' — لم تُفتح وثيقةٌ رسمية تقولها
     * 🪤 ولا تُرقَّى قيمةٌ إلى 'yes' إلا بفتح الصفحة — لا بمقالٍ ولا بتذكّر.
     */
    publicApi: 'yes' | 'unverified';
    webhooks: 'yes' | 'no' | 'unverified';
    /** هل يمكن **قراءة** المخزون منه؟ وهل يمكن **كتابتُه** فيه؟ */
    stockRead: 'yes' | 'unverified';
    stockWrite: 'yes' | 'unverified';
    docUrl?: string;
    /** ملاحظةٌ تُعرض للتاجر كما هي. */
    noteAr?: string;
}

/**
 * 🪤 كلُّ ما دون 'yes' يُعرض للتاجر بوسم «يحتاج تأكيداً» — لا يُخفى ولا يُجمَّل.
 *    وأيُّ ترقيةٍ تستلزم فتحَ الوثيقة الرسمية وكتابةَ رابطها هنا.
 */
export const PROVIDER_SYSTEMS: ProviderDef[] = [
    // ── متاجر إلكترونية سعودية ───────────────────────────────────────────
    {
        id: 'salla', nameAr: 'سلّة', nameEn: 'Salla', segment: 'ecommerce', saudi: true,
        publicApi: 'yes', webhooks: 'yes', stockRead: 'unverified', stockWrite: 'unverified',
        docUrl: 'https://docs.salla.dev/',
        noteAr: 'واجهةُ تاجرٍ عامّة وتواقيعُ خطّافاتٍ موثَّقة. وكتابةُ الكمّية لم تُؤكَّد من وثيقةٍ رسمية بعد.',
    },
    {
        id: 'zid', nameAr: 'زد', nameEn: 'Zid', segment: 'ecommerce', saudi: true,
        publicApi: 'yes', webhooks: 'yes', stockRead: 'yes', stockWrite: 'unverified',
        docUrl: 'https://docs.zid.sa/',
        noteAr: 'قراءةُ مخزون المنتج موثَّقة. ولا يوجد خطّافٌ للمخزون — الأقربُ تحديثُ المنتج.',
    },
    // ── نقاط بيع سعودية (مطاعم وتجزئة) ───────────────────────────────────
    {
        id: 'foodics', nameAr: 'فودكس', nameEn: 'Foodics', segment: 'food', saudi: true,
        publicApi: 'unverified', webhooks: 'unverified', stockRead: 'unverified', stockWrite: 'unverified',
        docUrl: 'https://developers.foodics.com/',
        noteAr: 'الأشهرُ في مطاعم السعودية. لم نتمكّن من فتح وثيقته الرسمية في هذا المسح — يُؤكَّد قبل أي وعد.',
    },
    {
        id: 'rewaa', nameAr: 'رِواء', nameEn: 'Rewaa', segment: 'retail', saudi: true,
        publicApi: 'unverified', webhooks: 'unverified', stockRead: 'unverified', stockWrite: 'unverified',
        noteAr: 'نظامُ تجزئةٍ سعوديّ واسع الانتشار. لم تُفتح وثيقتُه في هذا المسح.',
    },
    // ── فنادق: مصنَّفةٌ ومُعلَنٌ أنها غيرُ قابلةٍ للربط اليوم ─────────────
    {
        id: 'cloudbeds', nameAr: 'كلاودبِدز', nameEn: 'Cloudbeds', segment: 'hotel', saudi: false,
        publicApi: 'yes', webhooks: 'yes', stockRead: 'unverified', stockWrite: 'unverified',
        docUrl: 'https://hotels.cloudbeds.com/api/',
        noteAr: 'خطّافاتُ إتاحةٍ موثَّقة. ولا يُربط اليوم: تاكي يبيع بالقطعة لا بالليلة.',
    },
    {
        id: 'mews', nameAr: 'ميوز', nameEn: 'Mews', segment: 'hotel', saudi: false,
        publicApi: 'yes', webhooks: 'yes', stockRead: 'unverified', stockWrite: 'unverified',
        docUrl: 'https://mews-systems.gitbook.io/connector-api/',
        noteAr: 'خطّافاتٌ ومقابس ويب، ويشترط ردّاً خلال خمس ثوانٍ. ولا يُربط اليوم لنفس السبب.',
    },
    {
        id: 'opera', nameAr: 'أوبرا كلاود (أوراكل)', nameEn: 'Oracle OPERA Cloud (OHIP)', segment: 'hotel', saudi: false,
        publicApi: 'yes', webhooks: 'unverified', stockRead: 'unverified', stockWrite: 'unverified',
        docUrl: 'https://github.com/oracle/hospitality-api-docs',
        noteAr: 'مواصفاتٌ منشورة وأحداثُ أعمال. تفاصيلُ إدارة الإتاحة لم تُؤكَّد من وثيقة أوراكل نفسها.',
    },
    // ── والبابُ الذي يفي بالطلب فعلاً ────────────────────────────────────
    {
        id: 'custom', nameAr: 'أيُّ نظامٍ آخر — ربطٌ مباشر', nameEn: 'Any other system — direct link',
        segment: 'other', saudi: false,
        publicApi: 'yes', webhooks: 'yes', stockRead: 'yes', stockWrite: 'yes',
        noteAr: 'عقدُ تاكي المفتوح: نظامُك يُرسل كمّياتِك الكاملة بكودها، وتاكي تطرح المحجوز. '
              + 'ويُرسل تاكي إليك كلّ بيعٍ وإرجاعٍ فوراً. يعمل مع أي نظامٍ يستطيع نداءَ رابط.',
    },
];

/** أنظمةُ فئةٍ واحدة. */
export const providersOfSegment = (s: ProviderSegment): ProviderDef[] =>
    PROVIDER_SYSTEMS.filter(p => p.segment === s);

/** ما يُوصى به لتاجرٍ سعوديّ أوّلاً. */
export const SAUDI_PROVIDERS: ProviderDef[] = PROVIDER_SYSTEMS.filter(p => p.saudi);

/** هل يستطيع تاكي تمثيلَ ما يبيعه هذا القطاع اليوم؟ */
export const segmentSupported = (s: ProviderSegment): boolean =>
    PROVIDER_SEGMENTS.find(x => x.id === s)?.supported !== false;

export default PROVIDER_SYSTEMS;
