/**
 * operatorIdentity.js — هويّةُ مُشغِّل المنصّة: **قواعدُها لا قيمُها** (v15.81)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 العيبُ الذي أنشأ هذا الملفّ، مقيسٌ لا مُقدَّر: المنصّة **تُلزم تجّارها**
 *    بسجلٍّ تجاريٍّ أو وثيقةِ عملٍ حرّ — `platform_settings.verification`
 *    على جدّة `{"mode":"required"}` ومشغّلٌ حيٌّ على `deals` يمنع النشرَ بلا
 *    توثيق — **وهويّتُها هي غائبةٌ عن كلِّ سطحٍ عامّ**: صفرُ رقمٍ بعشر خاناتٍ
 *    أو خمسَ عشرةَ في الصفحات القانونيّة السبع ولا في التذييل ولا في
 *    `index.html`، و«الطرفُ الأوّل» في الشروط مُعرَّفٌ بـ«صاحبِ المنصّة» —
 *    أي أن الزائرَ بلا حسابٍ **لا يملك خصماً معلومَ الهويّة** يقاضيه.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 ولماذا لا قيمَ في هذا الملفّ — وهذا هو القرارُ الأهمّ فيه
 * ═══════════════════════════════════════════════════════════════════════════
 * القيمُ الأربع موجودةٌ أصلاً منذ v13.35 في `platform_settings.tax_settings`
 * (`entity_name` · `cr_number` · `vat_number` · `entity_address`)، **وناصرٌ
 * يملك شاشةً يحرّرها كلَّها**: لوحةُ المدير ← «الزكاة والضريبة»
 * (`src/pages/admin/AdminTax.tsx`، أربعةُ حقولٍ في بطاقةٍ واحدة). والمفتاحُ
 * **داخلَ قائمةِ السماح العامّة** في `platform_settings_select` (قِيس بتنفيذٍ
 * بدور `anon`: الصفُّ يُقرأ) — فالقراءةُ العامّة لا تحتاج هجرةً ولا مفتاحاً
 * جديداً ولا تغييراً في `platformSettings.ts`.
 *
 * فلو كُتبت القيمُ هنا لصار لها **مصدران**: ملفٌّ يحتاج نشراً ووكيلاً، وشاشةٌ
 * يملكها ناصر. وهذا عينُ الانحراف الذي أنشأ هذا البند. ⇒ **القيمةُ في
 * القاعدة، والقاعدةُ هنا.** وهذا نفسُ ما يفعله `src/hooks/useVatMode.ts`
 * بالمفتاح نفسِه منذ v13.38 (قراءةٌ لحظيّةٌ بذاكرةٍ مشتركة): ناصرٌ يحفظ
 * فيَسري الأثرُ بلا نشرِ سطرٍ واحد.
 *
 * ولماذا `shared/` لا `src/`: هذه قواعدُ نصٍّ قانونيٍّ يحتاجها المتصفّحُ
 * (الصفحاتُ والتذييلُ وبطاقةُ JSON-LD) **وأيُّ سكربتٍ أو خادمٍ** يطبع بياناً
 * رسمياً. وهو العرفُ المثبَت هنا: `shared/phone.js` · `shared/zatcaTlv.js` ·
 * `shared/arPlural.js` — و`allowJs` في `tsconfig` يستنتج أنواعَها بلا `.d.ts`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 و«الاسمُ التجاريُّ ليس اسماً نظامياً»
 * ═══════════════════════════════════════════════════════════════════════════
 * `entity_name` على جدّة اليوم `TAKI — تاكي` — وهو **الافتراضُ المكتوبُ في
 * الكود** في موضعين، لا اسمٌ مُستخرجٌ من سجلّ. ونشرُه تحت عنوان «الاسمُ
 * النظاميّ» بيانٌ **غيرُ صحيح**، وهو نفسُ خطأِ الوعدِ بما لا يُنفَّذ الذي
 * كلّفنا هذا الإصدار. ⇒ القوالبُ التجاريّة تُعَدّ **غيرَ مُعطاة**، فلا يُعرض
 * البيانُ حتى يُدخل ناصرٌ الاسمَ كما في الشهادة بالضبط.
 *
 * 🪤 ولا رقمَ ولا مدّةَ نصّاً هنا: لا عددَ خاناتٍ للسجلّ (الوثائقُ الحرّة
 *    تخالفه)، ولا مهلةَ ردٍّ. الموجودُ = موجود، والغائبُ يُخفي السطر.
 *    والرقمُ الضريبيُّ **اختياريٌّ عمداً**: المنصّة غيرُ مسجَّلةٍ في ضريبة
 *    القيمة المضافة (`vat_enabled=false`)، ونشرُ رقمٍ ضريبيٍّ لمن ليس مسجَّلاً
 *    مخالفة. فيُنشر حين يوجد وحده.
 */

const { toLatinDigits } = require('./phone');

/**
 * 🪤 أسماءٌ تجاريّةٌ/علاماتٌ تُعَدّ «غيرَ مُعطاة» لغرضِ الاسم النظاميّ.
 *    المقارنةُ بعد تطبيعِ المسافات والشُرَط، لأن `TAKI - تاكي` و`TAKI — تاكي`
 *    و`TAKI – تاكي` ثلاثُ محارفَ مختلفة لشرطةٍ واحدة.
 */
const BRAND_ALIASES = ['taki', 'تاكي', 'taki تاكي', 'منصة تاكي', 'منصه تاكي', 'taki saudi', 'takisa'];

/** يُسوّي النصَّ للمقارنة: مسافاتٌ واحدة · شُرَطٌ تُحذف · همزاتٌ تُبسَّط. */
function foldForCompare(s) {
    return String(s == null ? '' : s)
        // تطويلٌ وتشكيل — بالترميز، وفي صنفين لا صنفٍ واحد.
        // 🪤 علاماتُ التشكيل **محارفُ تركيب**: فالتطويلُ إن جاورها في صنفٍ
        //    واحدٍ قُرئ معها حرفاً مركَّباً فرفضه `no-misleading-character-class`
        //    **وإن كُتب بالترميز**. وبالمحارف المجرّدة تَلتصق في المحرّر بما قبلها.
        .replace(/\u0640/g, '')
        .replace(/[\u064B-\u0652]/g, '')
        .replace(/[—–\-_·,،.]/g, ' ')
        .replace(/[إأآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/** هل النصُّ علامةٌ تجاريّةٌ لا اسمٌ نظاميّ؟ */
function isBrandAlias(s) {
    const f = foldForCompare(s);
    return f === '' || BRAND_ALIASES.includes(f);
}

/**
 * يقرأ صفَّ `platform_settings.tax_settings` ويُخرج الهويّةَ مُطبَّعة.
 * 🪤 ويقبل `null`/`undefined`/نصّاً — القيمةُ تصل من jsonb فقد تأتي أيَّ شكل.
 * @param {any} raw قيمةُ المفتاح كما جاءت من القاعدة
 */
function normalizeOperatorIdentity(raw) {
    const v = raw && typeof raw === 'object' ? raw : {};
    const txt = (x) => String(x == null ? '' : x).trim();
    const numish = (x) => toLatinDigits(txt(x)).trim();
    const legalRaw = txt(v.entity_name);
    return {
        /** الاسمُ النظاميّ كما في الشهادة — فارغٌ إن كان علامةً تجاريّة. */
        legalName: isBrandAlias(legalRaw) ? '' : legalRaw,
        /** رقمُ السجلّ التجاريّ أو وثيقةِ العمل الحرّ. */
        registryNumber: numish(v.cr_number),
        /** الرقمُ الضريبيّ — `''` حين لا تسجيل، وهو الحالُ اليوم. */
        vatNumber: numish(v.vat_number),
        /** العنوانُ الوطنيُّ سطراً واحداً كما تُدخله الشاشة. */
        nationalAddress: txt(v.entity_address),
    };
}

/** هويّةٌ فارغةٌ — تُستعمل قبل وصول الصفّ وعند فشل القراءة. */
function emptyOperatorIdentity() {
    return { legalName: '', registryNumber: '', vatNumber: '', nationalAddress: '' };
}

/**
 * الحقولُ اللازمةُ للإفصاح، بأسمائها **في القاعدة** لا في الكود — لأن ما
 * يراه ناصرٌ على الشاشة هو حقلُ القاعدة، فالرسالةُ تسمّي ما سيفتحه.
 */
const REQUIRED_FIELDS = [
    { key: 'entity_name', pick: 'legalName', ar: 'اسم المنشأة النظاميّ', en: 'Legal entity name' },
    { key: 'cr_number', pick: 'registryNumber', ar: 'السجل التجاري / وثيقة العمل الحر', en: 'Commercial register / freelance document' },
    { key: 'entity_address', pick: 'nationalAddress', ar: 'العنوان الوطني للمنشأة', en: 'National address' },
];

/** الحقولُ اللازمةُ الناقصة — قائمةٌ فارغةٌ تعني «مكتملة». */
function operatorIdentityGaps(id) {
    const d = id || emptyOperatorIdentity();
    return REQUIRED_FIELDS.filter((f) => !String(d[f.pick] || '').trim());
}

/**
 * 🔴 البوّابةُ الوحيدة: لا يُعرض شيءٌ إلّا باكتمالِ الثلاثة.
 *    و«الرقمُ الضريبيّ» خارجَها عمداً (غيرُ مسجَّلين، فلا رقم).
 */
function operatorIdentityIsComplete(id) {
    return operatorIdentityGaps(id).length === 0;
}

/** هل المنصّة مسجَّلةٌ في ضريبة القيمة المضافة فعلاً (رقمٌ موجود)؟ */
function operatorVatIsRegistered(id) {
    return !!String((id || {}).vatNumber || '').trim();
}

/** تسمياتُ البيان في اللغتين — موضعٌ واحدٌ لها فلا تنحرف نسختان. */
function operatorIdentityLabels(lang) {
    const ar = lang !== 'en';
    return {
        heading: ar ? 'هويّةُ مُشغِّل المنصّة' : 'Platform operator',
        legalName: ar ? 'الاسم النظامي' : 'Legal name',
        registry: ar ? 'السجل التجاري / وثيقة العمل الحر' : 'Commercial register / freelance document',
        vat: ar ? 'الرقم الضريبي' : 'VAT number',
        address: ar ? 'العنوان الوطني' : 'National address',
        noVat: ar
            ? 'المنصّة غير مسجَّلة في ضريبة القيمة المضافة، فلا رقم ضريبي لها.'
            : 'The platform is not registered for VAT, so it holds no VAT number.',
        // 🪤 يُسمّى النظامُ بالاسم ولا يُذكر رقمُ مادّةٍ ولا مدّة: الإفصاحُ عن
        //    هويّة مُقدِّم الخدمة وبيانات التواصل مطلوبٌ في نظام التجارة
        //    الإلكترونية ولائحته التنفيذية، ورقمُ المادّة لا يُنسخ من الذاكرة.
        basis: ar
            ? 'يُنشر هذا البيان وفقاً لنظام التجارة الإلكترونية السعودي ولائحته التنفيذية.'
            : 'This disclosure is published pursuant to the Saudi E-Commerce Law and its Implementing Regulations.',
    };
}

/**
 * سطرٌ واحدٌ جاهزٌ للنصّ العاديّ (بريد · PDF · بوت)، أو `''` حين النقص.
 * 🔴 و`''` لا «الاسم: » فارغةً: لافتةٌ بلا قيمةٍ هي العيبُ عينه.
 */
function operatorIdentityLine(id, lang) {
    if (!operatorIdentityIsComplete(id)) return '';
    const L = operatorIdentityLabels(lang);
    const parts = [
        `${L.legalName}: ${id.legalName}`,
        `${L.registry}: ${id.registryNumber}`,
        `${L.address}: ${id.nationalAddress}`,
    ];
    if (operatorVatIsRegistered(id)) parts.splice(2, 0, `${L.vat}: ${id.vatNumber}`);
    return parts.join(' · ');
}

/**
 * الزيادةُ على عقدةِ `Organization` في schema.org، أو `null` حين النقص.
 * 🪤 و`vatID` **لا تُضاف بقيمةٍ فارغة**: مفتاحٌ فارغٌ في بياناتٍ منظّمة يُقرأ
 *    ادّعاءَ تسجيلٍ لا غيابَه. و`streetAddress` تحمل السطرَ كما هو لأن
 *    الشاشةَ تُدخل العنوانَ الوطنيّ سطراً واحداً — وتفكيكُه بتعبيرٍ نمطيّ
 *    تخمينٌ يُنتج عنواناً خاطئاً بثقة.
 */
function operatorIdentityLd(id) {
    if (!operatorIdentityIsComplete(id)) return null;
    const out = {
        legalName: id.legalName,
        identifier: id.registryNumber,
        address: {
            '@type': 'PostalAddress',
            streetAddress: id.nationalAddress,
            addressCountry: 'SA',
        },
    };
    if (operatorVatIsRegistered(id)) out.vatID = id.vatNumber;
    return out;
}

/**
 * أسطرُ التنبيه حين تكون الهويّةُ ناقصة — **تُحذِّر ولا تُفشِل**.
 * 🔴 ولا تُفشِل عمداً: الفراغُ آمنٌ (البيانُ لا يُعرض أصلاً)، والنقصُ لا
 *    يرفعه إلّا ناصر — فحارسٌ يسقط عليه يُوقف كلَّ نشرةٍ لسببٍ لا يملك أحدٌ
 *    غيرُه إصلاحَه. لكنّه يُقال بصوتٍ عالٍ في كلّ بناء فلا يُنسى.
 * @param {object} id الهويّةُ المُطبَّعة
 * @param {string} [host] المضيفُ الذي قُرئت منه — يُسمّى دائماً، لأن فحصاً
 *   لا يقول من أيّ قاعدةٍ قرأ قد يُطمئن على المختبر (درس v14.77).
 */
function operatorIdentityWarnLines(id, host) {
    const gaps = operatorIdentityGaps(id);
    if (!gaps.length) return [];
    const where = host ? ` (قُرئت من ${host})` : '';
    const lines = [
        `هويّةُ مُشغِّل المنصّة ناقصةٌ${where} — فلا يُعرض البيانُ على أيّ صفحةٍ عامّة.`,
    ];
    for (const f of gaps) {
        lines.push(`ناقصٌ: ${f.ar} (${f.key})`);
    }
    lines.push('يُدخلها ناصر من: لوحة المدير ← «الزكاة والضريبة» ← بطاقة «فواتير اشتراكات التجار» — ثم «حفظ».');
    lines.push('والأسطحُ المُعطَّلة حتى ذلك: تذييلُ الموقع · الصفحاتُ القانونيّة السبع · بطاقةُ البيانات المنظّمة.');
    return lines;
}

module.exports = {
    normalizeOperatorIdentity,
    emptyOperatorIdentity,
    operatorIdentityGaps,
    operatorIdentityIsComplete,
    operatorVatIsRegistered,
    operatorIdentityLabels,
    operatorIdentityLine,
    operatorIdentityLd,
    operatorIdentityWarnLines,
    isBrandAlias,
    REQUIRED_FIELDS,
};
