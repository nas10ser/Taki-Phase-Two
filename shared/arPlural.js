/**
 * shared/arPlural.js — جمعُ العدد بالعربية للبوتين (v14.93)
 * ═══════════════════════════════════════════════════════════════════════════
 * توأمُ `src/utils/arPlural.ts` (الموقع) و`public.taki_ar_messages()` (القاعدة).
 *
 * 🪤 ثلاث نسخٍ في ثلاث بيئات ليست ترفاً بل ضرورة: لا يستطيع البوت استيراد
 *    TypeScript، ولا القاعدةُ استدعاء JavaScript. والخطر أن تنحرف النسخ —
 *    ولذلك `npm test` يقارنها جميعاً (`scripts/check-ar-plural.js`)، ويُفشل
 *    البناء إن اختلفت واحدةٌ عن الأخريات في أي عددٍ من ٠ إلى ١٠٠.
 *
 * 🪤 والسبب الذي جعلها لازمة: سلاسل البوت كانت `{0} رسائل`، فحدٌّ قيمتُه ١
 *    يُنتج «1 رسائل». وهو نفس العيب الذي صُحّح في الساعات مرّتين.
 *
 * ونمطُ الوحدة المشتركة مسبوقٌ في هذا المشروع: `shared/phone.js` أُنشئ لأن
 * صياغة رقم واتساب كانت منسوخةً فانحرفت، ورابطٌ معطوبٌ لا يُخطئ ولا يُسجَّل.
 */

/** الصيغ الخمس التي تحتاجها العربية لأي معدود. */
const FORMS = {
    messages: { one: 'رسالة واحدة', two: 'رسالتان', twoGen: 'رسالتين', few: 'رسائل', many: 'رسالة' },
    hours:    { one: 'ساعة واحدة',  two: 'ساعتان',  twoGen: 'ساعتين',  few: 'ساعات', many: 'ساعة' },
    minutes:  { one: 'دقيقة واحدة', two: 'دقيقتان', twoGen: 'دقيقتين', few: 'دقائق', many: 'دقيقة' },
};

/**
 * العدد مصوغاً بالعربية. `genitive` لما بعد حرف الجرّ («خلال ساعتين»).
 * الكسور تُعامَل معاملة ما فوق العشرة («٠٫٥ ساعة») — ومهلة الحجز تقبل ربع ساعة.
 */
function arCount(n, forms, genitive = false) {
    const f = typeof forms === 'string' ? FORMS[forms] : forms;
    if (!f) throw new Error(`arCount: صيغةٌ غير معروفة «${forms}»`);
    if (!Number.isFinite(n)) return `${n} ${f.many}`;
    if (!Number.isInteger(n)) return `${n} ${f.many}`;
    if (n === 1) return f.one;
    if (n === 2) return genitive ? (f.twoGen || f.two) : f.two;
    if (n >= 3 && n <= 10) return `${n} ${f.few}`;
    return `${n} ${f.many}`;
}

/** الإنجليزية تُخطئ أيضاً: «1 messages». */
function enCount(n, one, many) {
    return n === 1 ? `one ${one}` : n === 2 ? `two ${many}` : `${n} ${many}`;
}

/** «٣ رسائل» — يطابق `taki_ar_messages()` في القاعدة حرفاً بحرف. */
const arMessages = (n) => arCount(n, 'messages');
const enMessages = (n) => enCount(n, 'message', 'messages');

/** يختار الصيغة حسب لغة البوت. */
const countMessages = (n, lang) => (lang === 'en' ? enMessages(n) : arMessages(n));

module.exports = { arCount, enCount, arMessages, enMessages, countMessages, FORMS };
