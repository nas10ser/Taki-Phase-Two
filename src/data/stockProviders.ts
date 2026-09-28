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
    /**
     * v15.12 — **أين يلصق التاجر رابطَ تاكي في نظامه.**
     * 🔴 واعتراضُ ناصر هو سببُ وجود هذا الحقل: «لم أفهم سبب طلبك للرابط».
     *    فالأنظمةُ تُرسل ولا تستقبل، وتاكي هي التي تُعطي العنوان. وبلا جملةٍ
     *    تقول «من هنا بالضبط»، يبقى الرابطُ في يد التاجر بلا معنى.
     * 🪤 وتُكتب بصيغةٍ عامّة حين لا تُفتح وثيقةُ النظام: «من إعدادات
     *    الخطّافات/الإشعارات» أصدقُ من اسم زرٍّ لم نره.
     */
    pasteHintAr?: string;
    pasteHintEn?: string;
    /**
     * v15.13 — **هل يستطيع التاجر أن يلصق الرابط بنفسه؟**
     * 🔴 قِيس من وثيقتَي سلّة وزد: **لا**. كلتاهما تشترط تطبيقاً مسجَّلاً
     *    (OAuth) لتسجيل خطّاف. فزدٌّ صريحة: `POST /v1/managers/webhooks`
     *    يتطلّب مفتاحَ شريكٍ و`X-Manager-Token` من OAuth. وسلّة كذلك عبر
     *    بوّابة الشركاء. ⇒ «الصق الرابط» لا تعمل معهما، ووعدُها كذب.
     */
    selfServeWebhook: 'yes' | 'no' | 'unverified';
    /** ما الذي يلزم تاكي لتفعيله — يُقال لناصر لا يُخفى. */
    needsAr?: string;
    /**
     * خريطةُ الحقول **المؤكَّدة من الوثيقة** — تُستعمل افتراضاً لهذا المزوّد
     * بدل التخمين. `null` لمن لم تُفتح وثيقتُه.
     */
    fieldMap?: { id: string; qty: string; variants?: string; variantId?: string; variantQty?: string };
    /** آليّةُ التحقّق من أن الرسالة منه فعلاً. */
    verify?: 'hmac-sha256-raw' | 'basic-auth' | 'none' | 'unverified';
}

/**
 * 🪤 كلُّ ما دون 'yes' يُعرض للتاجر بوسم «يحتاج تأكيداً» — لا يُخفى ولا يُجمَّل.
 *    وأيُّ ترقيةٍ تستلزم فتحَ الوثيقة الرسمية وكتابةَ رابطها هنا.
 */
export const PROVIDER_SYSTEMS: ProviderDef[] = [
    // ── متاجر إلكترونية سعودية ───────────────────────────────────────────
    {
        id: 'salla', nameAr: 'سلّة', nameEn: 'Salla', segment: 'ecommerce', saudi: true,
        publicApi: 'yes', webhooks: 'yes', stockRead: 'yes', stockWrite: 'yes',
        selfServeWebhook: 'unverified',
        verify: 'hmac-sha256-raw',
        fieldMap: { id: 'data.id', qty: 'data.quantity', variants: 'data.skus',
                    variantId: 'id', variantQty: 'stock_quantity' },
        docUrl: 'https://docs.salla.dev/webhooks.md',
        noteAr: 'الكتابةُ للمخزون **مؤكَّدة**: POST /products/quantities/bulk بأنماط increment/decrement/overwrite '
              + '\u2014 وهي غيرُ فوريّة («قد تستغرق عدّة دقائق»)، فلا يُقرأ الرقم بعد الكتابة مباشرةً. '
              + '\u26a0\ufe0f ولا يوجد حدثٌ لتغيّر المخزون: product.updated مُهمَلةٌ عندهم، و product.quantity.low '
              + 'لا تنطلق إلا عند حدٍّ منخفض. فالمزامنةُ الحيّة تحتاج إشارةً ثمّ إعادةَ قراءة.',
        needsAr: 'يلزم تسجيلُ تاكي تطبيقاً في بوّابة شركاء سلّة، ثمّ يأذن التاجر بضغطة. '
               + 'ولا يستطيع التاجر لصقَ الرابط بنفسه بحسب وثيقتهم.',
        pasteHintAr: 'لا يُلصق الرابط يدوياً في سلّة: التسجيلُ يتمّ عبر تطبيق تاكي بعد إذنك بضغطة.',
        pasteHintEn: 'No manual URL pasting in Salla: registration happens through the TAKI app after you approve it.',
    },
    {
        id: 'zid', nameAr: 'زد', nameEn: 'Zid', segment: 'ecommerce', saudi: true,
        publicApi: 'yes', webhooks: 'yes', stockRead: 'yes', stockWrite: 'yes',
        selfServeWebhook: 'no',
        verify: 'basic-auth',
        fieldMap: { id: 'id', qty: 'quantity', variants: 'stocks',
                    variantId: 'id', variantQty: 'available_quantity' },
        docUrl: 'https://docs.zid.sa/webhooks.md',
        noteAr: 'الكتابةُ للمخزون **مؤكَّدة**: PATCH /v1/products/{id}/stocks/ (مفرداً أو دفعةً). '
              + 'ورسالتُهم تصل **بلا غلاف** \u2014 المنتجُ في جذر الرسالة لا داخل data. '
              + '\u26a0\ufe0f ولا حدثَ للمخزون: product.update العامّ فقط. والتحقّقُ عندهم Basic Auth لا توقيعاً، '
              + 'فتُعامَل الرسالةُ إشارةً لا حقيقة، وتُعاد القراءة من واجهتهم قبل التصرّف.',
        needsAr: 'وثيقةُ زد صريحة: تسجيلُ الخطّاف يحتاج مفتاحَ شريكٍ ورمزَ OAuth \u2014 '
               + 'فلا يستطيع التاجر فعلَه بنفسه. يلزم تسجيلُ تاكي تطبيقاً لدى زد.',
        pasteHintAr: 'لا يُلصق الرابط يدوياً في زد: وثيقتُهم تشترط تطبيقاً مسجَّلاً، ويتمّ بإذنك بضغطة.',
        pasteHintEn: 'No manual URL pasting in Zid: their docs require a registered app; it happens after you approve.',
    },
    // ── نقاط بيع سعودية (مطاعم وتجزئة) ───────────────────────────────────
    {
        id: 'foodics', nameAr: 'فودكس', nameEn: 'Foodics', segment: 'food', saudi: true,
        publicApi: 'unverified', webhooks: 'unverified', stockRead: 'unverified', stockWrite: 'unverified',
        docUrl: 'https://developers.foodics.com/',
        noteAr: 'الأشهرُ في مطاعم السعودية. لم نتمكّن من فتح وثيقته الرسمية في هذا المسح — يُؤكَّد قبل أي وعد.',
        pasteHintAr: 'من لوحة فودكس: الإعدادات ← التكاملات/الخطّافات ← أضف عنواناً والصق الرابط. (لم نفتح وثيقته، فقد تختلف التسمية.)',
        pasteHintEn: 'In Foodics: Settings → Integrations/Webhooks → add a URL and paste it. (Docs unopened; naming may differ.)',
        selfServeWebhook: 'unverified',
        verify: 'unverified',
    },
    {
        id: 'rewaa', nameAr: 'رِواء', nameEn: 'Rewaa', segment: 'retail', saudi: true,
        publicApi: 'unverified', webhooks: 'unverified', stockRead: 'unverified', stockWrite: 'unverified',
        noteAr: 'نظامُ تجزئةٍ سعوديّ واسع الانتشار. لم تُفتح وثيقتُه في هذا المسح.',
        pasteHintAr: 'من لوحة رِواء: الإعدادات ← التكاملات ← أضف عنوان استدعاء والصق الرابط. (لم نفتح وثيقته، فقد تختلف التسمية.)',
        pasteHintEn: 'In Rewaa: Settings → Integrations → add a callback URL and paste it. (Docs unopened; naming may differ.)',
        selfServeWebhook: 'unverified',
        verify: 'unverified',
    },
    // ── فنادق: مصنَّفةٌ ومُعلَنٌ أنها غيرُ قابلةٍ للربط اليوم ─────────────
    {
        id: 'cloudbeds', nameAr: 'كلاودبِدز', nameEn: 'Cloudbeds', segment: 'hotel', saudi: false,
        publicApi: 'yes', webhooks: 'yes', stockRead: 'unverified', stockWrite: 'unverified',
        docUrl: 'https://hotels.cloudbeds.com/api/',
        noteAr: 'خطّافاتُ إتاحةٍ موثَّقة. ولا يُربط اليوم: تاكي يبيع بالقطعة لا بالليلة.',
        selfServeWebhook: 'unverified',
        verify: 'unverified',
    },
    {
        id: 'mews', nameAr: 'ميوز', nameEn: 'Mews', segment: 'hotel', saudi: false,
        publicApi: 'yes', webhooks: 'yes', stockRead: 'unverified', stockWrite: 'unverified',
        docUrl: 'https://mews-systems.gitbook.io/connector-api/',
        noteAr: 'خطّافاتٌ ومقابس ويب، ويشترط ردّاً خلال خمس ثوانٍ. ولا يُربط اليوم لنفس السبب.',
        selfServeWebhook: 'unverified',
        verify: 'unverified',
    },
    {
        id: 'opera', nameAr: 'أوبرا كلاود (أوراكل)', nameEn: 'Oracle OPERA Cloud (OHIP)', segment: 'hotel', saudi: false,
        publicApi: 'yes', webhooks: 'unverified', stockRead: 'unverified', stockWrite: 'unverified',
        docUrl: 'https://github.com/oracle/hospitality-api-docs',
        noteAr: 'مواصفاتٌ منشورة وأحداثُ أعمال. تفاصيلُ إدارة الإتاحة لم تُؤكَّد من وثيقة أوراكل نفسها.',
        selfServeWebhook: 'unverified',
        verify: 'unverified',
    },
    // ── والبابُ الذي يفي بالطلب فعلاً ────────────────────────────────────
    {
        id: 'custom', nameAr: 'أيُّ نظامٍ آخر — ربطٌ مباشر', nameEn: 'Any other system — direct link',
        segment: 'other', saudi: false,
        publicApi: 'yes', webhooks: 'yes', stockRead: 'yes', stockWrite: 'yes',
        noteAr: 'عقدُ تاكي المفتوح: نظامُك يُرسل كمّياتِك الكاملة بكودها، وتاكي تطرح المحجوز. '
              + 'ويُرسل تاكي إليك كلّ بيعٍ وإرجاعٍ فوراً. يعمل مع أي نظامٍ يستطيع نداءَ رابط.',
        pasteHintAr: 'ابحث في إعدادات نظامك عن «Webhook» أو «خطّاف» أو «عنوان استدعاء» أو «إشعار تغيّر المخزون»، والصق الرابط هناك. وإن لم يوجد، سلّم الرابط والمفتاح لمن يبرمج نظامك.',
        pasteHintEn: "Look in your system's settings for «Webhook», «callback URL» or «stock change notification», and paste the URL there. If none exists, hand the URL and key to whoever develops your system.",
        selfServeWebhook: 'yes',
        verify: 'unverified',
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
