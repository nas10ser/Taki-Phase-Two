#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TAKI · حارسُ «لا مصطلحاتٍ في وجه المستخدم»
 *
 * 🔴 أمرُ ناصر (٩ نوفمبر ٢٠٢٦، مع لقطةِ شاشة): «احذف عبارة ‹تعذّر حفظ التغيير
 *    في قاعدة البيانات› فهي لا تفيد المستخدمين وليس لهم علاقة، أمّا بقيّة
 *    العبارة بالأسفل فأبقِها.»
 *    وكان التاجرُ يرى سطرين: جملةً تقنيّةً لا يفعل بها شيئاً، ثمّ بين قوسين
 *    **الجملةَ الوحيدة المفيدة** (سبب الرفض وخطوته التالية).
 *
 * والقاعدةُ التي يحرسها هذا الملفّ: **رسالةُ فشلٍ تُعرض لمشترٍ أو تاجر لا
 * تذكر «قاعدة البيانات» ولا «database».** فالمستخدم لا يملك قاعدةً ولا يصلحها.
 *
 * 🪤 والمدى مضبوطٌ عن قصد — ثلاثةُ استثناءاتٍ قِيست، وكلُّها صحيحةٌ كما هي:
 *    • `console.*` و`logger.*` — سجلٌّ للمطوّر لا نصٌّ للمستخدم.
 *    • شاشاتُ الإدارة (أيُّ مسارٍ فيه مجلّد `admin`) — ناصر هو المُشغّل هناك،
 *      والمصطلحُ دقّةٌ لا ضجيج.
 *    • النصُّ القانونيّ (`src/pages/legal/`) — «قاعدة البيانات» فيه **أصلٌ
 *      مملوك** في بند الملكيّة الفكريّة ووصفُ تشفيرٍ في «عن تاكي»، لا رسالةَ
 *      فشل. وتعديلُ وثيقةٍ قانونيّةٍ بحجّة مصطلحٍ خطأٌ في ذاته.
 *
 * 🪤 ولا يكفي حذفُ الجملة التقنيّة: لو حُذفت وحدها لصار التنبيهُ **فارغاً**
 *    حين لا يحمل الخطأُ نصّاً. فالحارسُ يقيس `saveErrorMessage` **بتشغيلها**
 *    على الحالات الحديّة، لا بقراءة نصّها.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { walk } = require('./lib/walk');   // 🪤 لا git: Vercel تبني من أرشيف

const ROOT = path.resolve(__dirname, '..');
const SELF = path.relative(ROOT, __filename);

const strip = (src) => src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '');

const isExempt = (rel) => /(^|\/)admin\//.test(rel)
    || rel.startsWith('src/pages/legal/')
    || rel === SELF;

/**
 * مفرداتُ «الخادم» التي لا تعني شيئاً للمستخدم.
 * 🔴 و«قاعدة البيانات» وحدها لا تكفي — نقضٌ خصميّ (٩ نوفمبر): الجملةُ نفسُها
 *    بصيغةٍ أقصر «لم يُحفَظ التغيير **في القاعدة**» كانت **تُفلت بكلمةٍ واحدة**
 *    في `branchRepository.setCard`، وهي تصل التاجرَ من `StoreDetails`.
 *    فالمفرداتُ كلُّها: قاعدة البيانات · القاعدة · الـDB · السيرفر · database.
 */
const DB_AR = /قاعد[ً-ْ]?ة[ً-ْ]?\s+ال[ً-ْ]?بيانات|ال[ً-ْ]?قاعدة|الـ\s?DB\b|السيرفر/;
const DB_EN = /\bdatabase\b/i;
/** فعلُ فشلٍ أو حفظ — فالمخالفةُ هي **رسالةُ الفشل** لا ذكرُ الكلمة مطلقاً. */
const FAIL_AR = /تعذّر|تعذر|لم\s+يُ?حفظ|لم\s+يُحفَظ|فشل|خطأ|تعطّل/;
const FAIL_EN = /\b(could not|couldn't|cannot|failed|unable|error)\b/i;

const errors = [];
let scanned = 0;
let flagged = 0;

for (const rel of walk(ROOT, ['src'], /\.tsx?$/)) {
    if (isExempt(rel)) continue;
    scanned++;
    const lines = strip(fs.readFileSync(path.join(ROOT, rel), 'utf8')).split('\n');
    lines.forEach((line, i) => {
        if (/\b(console|logger)\s*\./.test(line)) return;      // سجلُّ المطوّر
        const ar = DB_AR.test(line) && FAIL_AR.test(line);
        const en = DB_EN.test(line) && FAIL_EN.test(line);
        if (!ar && !en) return;
        flagged++;
        errors.push(
            `${rel}:${i + 1} — رسالةُ فشلٍ تذكر قاعدة البيانات.\n`
            + `     ${line.trim().slice(0, 110)}\n`
            + '     المستخدم لا يملك قاعدةً ولا يصلحها: قل ماذا حدث وما الخطوة التالية.\n'
            + '     وللحفظ المرفوض من الخادم: `saveErrorMessage(err, isRTL)` في utils/publishError.'
        );
    });
}

// ── أرضيّةٌ: المَسحُ وقع فعلاً وعلى الأسطح المقيسة ─────────────────────────
// 🪤 فحصٌ بمدىً فارغٍ يمرّ أخضرَ دائماً. والأرضيّةُ أسماءٌ مع عدد، لا عددٌ وحده.
const MUST_SEE = [
    'src/context/AppContext.tsx',
    'src/repositories/branchRepository.ts',
    'src/utils/publishError.ts',
];
const seen = new Set(walk(ROOT, ['src'], /\.tsx?$/).filter((f) => !isExempt(f)));
for (const m of MUST_SEE) {
    if (!seen.has(m)) errors.push(`المدى لا يحوي «${m}» — سطحٌ مقيسٌ لهذا العيب، فغيابُه عطبٌ في الكاشف.`);
}
if (scanned < 150) {
    errors.push(`مُسِح ${scanned} ملفّاً فقط — مَسحٌ شبه فارغٍ يُنتج «أخضرَ» كاذباً.`);
}

// ── والسلوك يُقاس بالتشغيل لا بالقراءة ────────────────────────────────────
const PE = path.join(ROOT, 'src/utils/publishError.ts');
if (!fs.existsSync(PE)) {
    errors.push('src/utils/publishError.ts — غير موجود.');
} else {
    const ts = fs.readFileSync(PE, 'utf8');
    if (!/export function saveErrorMessage/.test(ts)) {
        errors.push('src/utils/publishError.ts — `saveErrorMessage` غيرُ مُصدَّرة.');
    } else {
        // تُنفَّذ فعلاً: النصُّ وحده لا يُثبت أنها لا تُرجع فارغاً.
        const js = ts
            .replace(/export (function|const|default)/g, '$1')
            .replace(/: string \| null/g, '').replace(/: string/g, '')
            .replace(/: boolean/g, '').replace(/: any/g, '')
            .replace(/^default publishErrorMessage;$/m, '');
        let saveErrorMessage;
        try {
            // eslint-disable-next-line no-eval
            saveErrorMessage = eval(js + '\n;saveErrorMessage');
        } catch (e) {
            errors.push(`تعذّر تشغيل publishError.ts للقياس: ${e.message}`);
        }
        if (saveErrorMessage) {
            const CASES = [
                ['خطأٌ فارغٌ تماماً', {}],
                ['رمزٌ بلا نصّ', { code: '42501', message: '' }],
                ['إنجليزيٌّ تقنيّ', { message: 'JWT expired' }],
                ['حارسٌ عربيّ', { code: 'P0001', message: 'عرضك لم يُنشر: متجرك غير موثّق بعد.', hint: 'P0024' }],
            ];
            for (const [name, err] of CASES) {
                for (const rtl of [true, false]) {
                    let out;
                    try { out = saveErrorMessage(err, rtl); } catch (e) { out = null; }
                    if (typeof out !== 'string' || !out.trim()) {
                        errors.push(`saveErrorMessage — «${name}» (${rtl ? 'ar' : 'en'}) أعادت نصّاً فارغاً. تنبيهٌ صامتٌ أسوأ من مصطلح.`);
                    } else if (DB_AR.test(out) || DB_EN.test(out)) {
                        errors.push(`saveErrorMessage — «${name}» (${rtl ? 'ar' : 'en'}) ما زالت تذكر قاعدة البيانات: ${out.slice(0, 80)}`);
                    }
                }
            }
        }
    }
}

// ── ومسارا «إضافة» و«تعديل» ينادِيانها معاً فلا ينحرفان ثانيةً ────────────
const CTX = path.join(ROOT, 'src/context/AppContext.tsx');
if (fs.existsSync(CTX)) {
    const ctx = strip(fs.readFileSync(CTX, 'utf8'));
    const uses = (ctx.match(/saveErrorMessage\(/g) || []).length;
    if (uses < 2) {
        errors.push(
            `src/context/AppContext.tsx — \`saveErrorMessage\` تُنادى ${uses} مرّةً فقط.\n`
            + '     مسارا «إضافة عرض» و«تعديل عرض» كلاهما يرفضه الخادمُ بنفس الحرّاس،\n'
            + '     وكان «تعديل» لا يترجمها فيرى التاجرُ نصّ الحارس خاماً. الاثنان أو انحراف.'
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// إحصاءٌ لا يزيد: التنبيهاتُ التي تحقن نصَّ الخطأ الخام
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 كشف تدقيقٌ خصميّ (٩ نوفمبر) **٢٣ موضعاً** تُلصق `error.message` أو
//    `res.error` داخل تنبيهٍ للمستخدم، فيصله رمزٌ لاتينيٌّ أو جملةُ بوستجرس
//    إنجليزيّة. أُصلح منها ما يُقاس بلا كسرِ مسارٍ لا أستطيع تجربته، وبقي
//    الباقي — ومسارا التسجيل والاسترداد لا يُجرَّبان بلا حسابٍ حقيقيّ.
// 🪤 فالحارسُ هنا **سقفٌ ينزل ولا يرتفع** (نمطُ `file-size-ledger`): يمنع
//    ظهورَ موضعٍ جديد، ويُجبر على تحديث الرقم كلَّما نقص. ومنعٌ شاملٌ اليوم
//    كان سيُسقط البناءَ على عملٍ لم يُنجَز بعد، فيُرفع الحارسُ أو يُلتفَّ
//    عليه — وذاك أسوأُ من رقمٍ صادقٍ ينزل.
const RAW_CALL = /(customAlert|customConfirm|setErr|setError|setMsg)\s*\(/;
const RAW_INTERP = /\$\{[^}]*\b(error|err|res|e)\??\.(message|error|detail|code)\b|\+\s*\(?\s*(error|err|res)\??\.(message|error)/;
const RAW_CENSUS = 17;   // ⬇️ يُخفَّض فقط. آخرُ قياس: ٩ نوفمبر ٢٠٢٦ (v15.85)
let rawHits = 0;
const rawWhere = [];
for (const rel of walk(ROOT, ['src'], /\.tsx?$/)) {
    if (isExempt(rel)) continue;
    const lines = strip(fs.readFileSync(path.join(ROOT, rel), 'utf8')).split('\n');
    lines.forEach((line, i) => {
        if (/\b(console|logger)\s*\./.test(line)) return;
        if (!RAW_CALL.test(line)) return;
        const win = lines.slice(Math.max(0, i - 1), i + 4).join('\n');
        if (!RAW_INTERP.test(win)) return;
        rawHits++;
        rawWhere.push(`${rel}:${i + 1}`);
    });
}
if (rawHits > RAW_CENSUS) {
    errors.push(
        `تنبيهاتٌ تحقن نصَّ الخطأ الخام: ${rawHits} والسقفُ ${RAW_CENSUS}.\n`
        + `     ${rawWhere.slice(0, 6).join(' · ')}${rawWhere.length > 6 ? ' …' : ''}\n`
        + '     لا يُضاف موضعٌ جديد: استعمل `saveErrorMessage` أو `reasonText`.'
    );
} else if (rawHits < RAW_CENSUS) {
    errors.push(
        `تنبيهاتُ النصّ الخام نزلت إلى ${rawHits} (السقفُ المسجَّل ${RAW_CENSUS}).\n`
        + '     حدّث `RAW_CENSUS` إلى الرقم الجديد — فسقفٌ أعلى من الواقع يسمح برجوعٍ صامت.'
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// ولا يُقال للمستخدم «نجح» وقد فشل
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 كشف التدقيقُ أنّ `addDeal` كانت `Promise<void>`، و`updateDeal` تُرجع
//    بوليان **تُهمَله الشاشة** — فيظهر «✅ تم الحفظ بنجاح» **فوق نافذة الرفض
//    نفسِها**، ويظنّ التاجرُ عرضَه منشوراً وهو غيرُ محفوظ. وهذا أخطرُ من أيّ
//    مصطلحٍ: المصطلحُ يُربك، و«نجح» الكاذبةُ تُضلّل.
// 🪤 وهو نفسُ فخّ `useBooking` المسجَّل (v14.80): غلافٌ يبتلع الوعد فينتظر
//    المنادي `undefined` ويمضي.
{
    const ctxSrc = fs.existsSync(CTX) ? strip(fs.readFileSync(CTX, 'utf8')) : '';
    for (const fn of ['addDeal', 'updateDeal']) {
        const re = new RegExp(`${fn}:\\s*\\(deal: Deal\\) => Promise<boolean>`);
        if (ctxSrc && !re.test(ctxSrc)) {
            errors.push(`src/context/AppContext.tsx — \`${fn}\` لا تُعلن \`Promise<boolean>\`؛ فالمنادي لا يستطيع أن يعرف أن الحفظ رُفض.`);
        }
    }
    const SD = path.join(ROOT, 'src/pages/SellerDashboard.tsx');
    if (fs.existsSync(SD)) {
        const sd = strip(fs.readFileSync(SD, 'utf8'));
        if (!/const\s+saved\s*=/.test(sd) || !/if\s*\(!saved\)\s*return;/.test(sd)) {
            errors.push(
                'src/pages/SellerDashboard.tsx — نتيجةُ الحفظ لا تُقرأ قبل «✅ تم الحفظ بنجاح».\n'
                + '     يلزم `const saved = …` ثمّ `if (!saved) return;` قبل `setSubmitted(true)`.'
            );
        }
    }
}

if (errors.length) {
    console.error('\n❌ البناء متوقّف: مصطلحاتٌ في وجه المستخدم');
    for (const e of errors) console.error('   • ' + e);
    console.error('');
    process.exit(1);
}
console.log(`✅ لغةُ المستخدم: ${scanned} ملفّاً · صفرُ رسالةِ فشلٍ تذكر الخادم · ${rawHits}/${RAW_CENSUS} تنبيهاً بنصٍّ خام · و\`saveErrorMessage\` لا تُرجع فارغاً في ٨ حالات`);
