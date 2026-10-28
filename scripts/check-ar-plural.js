#!/usr/bin/env node
/**
 * check-ar-plural.js — ثلاث نسخٍ للجمع العربي، ولا يُسمح لها أن تنحرف (v14.93)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 الخطر الحقيقي، وقد وقع نظيرُه مرّتين في هذا المشروع: قاعدةٌ لغوية واحدة
 *    مكتوبة في أكثر من مكان تنحرف بلا صوت. «٦ ساعة» (v14.92) و«٣ رسالة»
 *    (v14.93) كلاهما من هذا الباب.
 *
 * والنُّسخ ثلاثٌ بالضرورة لا بالإهمال:
 *   • `src/utils/arPlural.ts`   — الموقع (TypeScript، يُحزَم بـParcel)
 *   • `shared/arPlural.js`      — البوتان (CommonJS على Render)
 *   • `public.taki_ar_messages()` — القاعدة (رسالة الخطأ P0004 تأتي منها)
 * لا يستورد أيٌّ منها الآخر: بيئاتٌ ثلاث لا تتكلّم لغةً واحدة.
 *
 * فهذا الحارس يقارن **النسختين اللتين يمكن تشغيلهما هنا** عدداً عدداً،
 * ويقارن نصّ دالّة القاعدة بجدول الصيغ نفسه. أما تطابقُها الحيّ مع الخادم
 * فيُثبَت في الهجرة نفسها (`DO` يرفع استثناءً).
 *
 * 🪤 ولا يفترض git ولا `dist`: يُشغَّل داخل سلسلة البناء على Vercel أيضاً.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const fail = (m) => { console.error(`\n❌ البناء متوقّف: الجمع العربي\n\n   ${m}\n`); process.exit(1); };

// ── ١) نسخة البوتين: تُحمَّل مباشرةً ───────────────────────────────────────
let shared;
try {
    shared = require(path.join(root, 'shared', 'arPlural.js'));
} catch (e) {
    fail(`تعذّر تحميل shared/arPlural.js — ${e.message}`);
}

// ── ٢) نسخة الموقع: تُقرأ نصّاً وتُترجم يدوياً (لا مُجمِّع TS هنا) ─────────
const tsPath = path.join(root, 'src', 'utils', 'arPlural.ts');
let ts;
try { ts = fs.readFileSync(tsPath, 'utf8'); } catch { fail('src/utils/arPlural.ts غير موجود.'); }

// 🪤 `DAYS` لا يسكن `arPlural.ts` بل شاشةَ المراجعة — فالبحث في الملفّين معاً،
//    وإلّا صرخ الحارسُ كذباً على صيغةٍ موجودة (قاعدةُ المشروع: صراخٌ كاذب أسوأ
//    من غياب الحارس).
const verPath = path.join(root, 'src', 'components', 'admin', 'verification', 'verificationStatus.ts');
let verSrc = '';
try { verSrc = fs.readFileSync(verPath, 'utf8'); } catch { verSrc = ''; }

/** يستخرج كائن صيغةٍ من مصدر TypeScript بلا تنفيذ. */
const formsFromTs = (name) => {
    const re = new RegExp(`export const ${name}: ArForms = \\{([\\s\\S]*?)\\};`);
    const m = ts.match(re) || verSrc.match(re);
    if (!m) fail(`لم أجد الصيغة «${name}» في ${path.relative(root, tsPath)} ولا في ${path.relative(root, verPath)}.`);
    const out = {};
    for (const [, k, v] of m[1].matchAll(/(\w+)\s*:\s*'([^']*)'/g)) out[k] = v;
    return out;
};

const tsMessages = formsFromTs('MESSAGES');
const tsHours = formsFromTs('HOURS');
const tsMinutes = formsFromTs('MINUTES');

// ── ٣) الصيغ يجب أن تتطابق حرفاً بحرف ─────────────────────────────────────
const cmp = (label, a, b) => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
        if (a[k] !== b[k]) {
            fail(`صيغة «${label}.${k}» مختلفة:\n     الموقع : ${JSON.stringify(a[k])}\n     البوتان: ${JSON.stringify(b[k])}`);
        }
    }
};
cmp('messages', tsMessages, shared.FORMS.messages);
cmp('hours', tsHours, shared.FORMS.hours);
cmp('minutes', tsMinutes, shared.FORMS.minutes);

// ── ٤) ومخرجاتُهما يجب أن تتطابق لكل عددٍ واقعيّ ───────────────────────────
/** إعادةُ تنفيذ منطق TS من نصّه، كي لا نقارن الوحدة بنفسها. */
const tsArCount = (n, f, genitive = false) => {
    if (!Number.isFinite(n)) return `${n} ${f.many}`;
    if (!Number.isInteger(n)) return `${n} ${f.many}`;
    if (n === 1) return f.one;
    if (n === 2) return genitive ? (f.twoGen || f.two) : f.two;
    if (n >= 3 && n <= 10) return `${n} ${f.few}`;
    return `${n} ${f.many}`;
};

const NUMS = [];
for (let i = 0; i <= 100; i++) NUMS.push(i);
NUMS.push(0.25, 0.5, 1.5, 2.5, 8760, NaN, Infinity);

let checked = 0;
for (const n of NUMS) {
    for (const [label, tsF, shKey] of [['messages', tsMessages, 'messages'], ['hours', tsHours, 'hours'], ['minutes', tsMinutes, 'minutes']]) {
        for (const gen of [false, true]) {
            const a = tsArCount(n, tsF, gen);
            const b = shared.arCount(n, shKey, gen);
            if (a !== b) {
                fail(`«${label}» عند n=${n}${gen ? ' (مجرور)' : ''}:\n     الموقع : ${JSON.stringify(a)}\n     البوتان: ${JSON.stringify(b)}`);
            }
            checked++;
        }
    }
}

// ── ٥) الحالات التي كانت خاطئة فعلاً — تُثبَّت كي لا تعود ──────────────────
const MUST = [
    [1, 'رسالة واحدة'], [2, 'رسالتان'], [3, '3 رسائل'], [10, '10 رسائل'], [11, '11 رسالة'],
];
for (const [n, want] of MUST) {
    if (shared.arMessages(n) !== want) {
        fail(`arMessages(${n}) = ${JSON.stringify(shared.arMessages(n))} والمتوقَّع ${JSON.stringify(want)}.`);
    }
}
// «1 hours» و«1 messages» — العيب الإنجليزي المقابل
if (shared.enMessages(1) !== 'one message' || shared.enMessages(3) !== '3 messages') {
    fail('صياغة العدد بالإنجليزية غير صحيحة (تذكّر «1 messages»).');
}
// الكسور: «٠٫٥ ساعات» كانت تُكتب جمعَ قلّة، والمهلة تقبل ربع ساعة
if (shared.arCount(0.5, 'hours') !== '0.5 ساعة' || shared.arCount(0.25, 'hours') !== '0.25 ساعة') {
    fail('الكسور تُصاغ جمعَ قلّة — «٠٫٥ ساعات» خطأ، ومهلة الحجز تقبل ربع ساعة.');
}

// ── ٦) لا نصَّ عددٍ مثبَّتاً في سلاسل البوت ────────────────────────────────
// ── ٥٫٥) «يوم» في القاعدة ↔ «يوم» في الواجهة (v15.29) ──────────────────────
// 🪤 `taki_expire_verifications` تبني نصَّ التنبيه بـ`taki_ar_days()` داخل
//    القاعدة، وشاشةُ المراجعة تبني نصَّها بـ`DAYS` في TypeScript. بيئتان لا
//    تستوردان بعضهما — وهو بالضبط الوضعُ الذي أنتج «٦ ساعة» و«٣ رسالة».
//    فالحارسُ يقرأ الصيغ من ملفّ الهجرة نفسه ويقارنها حرفاً بحرف.
const migPath = path.join(root, 'supabase', 'JEDDAH_v15_29_verification_clock.sql');
let mig;
try { mig = fs.readFileSync(migPath, 'utf8'); } catch { fail(`${path.relative(root, migPath)} غير موجود — نسخةُ القاعدة من جمع «يوم» مفقودة.`); }

const sqlDays = {};
{
    const body = mig.match(/CREATE OR REPLACE FUNCTION public\.taki_ar_days[\s\S]*?\$fn\$([\s\S]*?)\$fn\$/);
    if (!body) fail('لم أجد نصّ `taki_ar_days` في ملفّ الهجرة.');
    const b = body[1];
    const one = b.match(/p_n = 1 THEN '([^']*)'/);
    const two = b.match(/p_n = 2 THEN '([^']*)'/);
    const few = b.match(/BETWEEN 3 AND 10 THEN p_n::text \|\| ' ([^']*)'/);
    const many = b.match(/ELSE p_n::text \|\| ' ([^']*)'/);
    if (!one || !two || !few || !many) fail('نصُّ `taki_ar_days` لا يطابق الشكل المتوقَّع — راجعه يدوياً.');
    Object.assign(sqlDays, { one: one[1], two: two[1], few: few[1], many: many[1] });
}

const tsDays = formsFromTs('DAYS');
for (const k of ['one', 'two', 'few', 'many']) {
    if (tsDays[k] !== sqlDays[k]) {
        fail(`صيغة «days.${k}» مختلفة:\n     الواجهة: ${JSON.stringify(tsDays[k])}\n     القاعدة : ${JSON.stringify(sqlDays[k])}`);
    }
}

const i18nPath = path.join(root, 'server', 'lib', 'i18n-data.json');
let i18n;
try { i18n = JSON.parse(fs.readFileSync(i18nPath, 'utf8')); } catch (e) { fail(`i18n-data.json — ${e.message}`); }

// 🪤 نمطٌ فضفاض يتّهم البريء: «رسائلك: {3}» ليست جمعَ عددٍ بل عنوانُ حقل،
//    و«{2}\nرسائلك» طابقت لأن `\s` تشمل السطر الجديد. فالمعدودُ هنا يجب
//    ألّا يتلوه حرفٌ عربيّ (فتخرج «رسائلك» و«ساعاتنا»)، وأن يسبقه العدد مباشرةً.
const BAD = /(٣|3)\s*(رسائل|رسالة|messages?)(?![\u0600-\u06FF])|\{\d\}[ \t]*(رسائل|ساعات)(?![\u0600-\u06FF])/;
const offenders = [];
for (const [key, entry] of Object.entries(i18n)) {
    if (!entry || typeof entry !== 'object') continue;
    for (const [lang, txt] of Object.entries(entry)) {
        if (typeof txt === 'string' && BAD.test(txt)) offenders.push(`${key} [${lang}] = ${JSON.stringify(txt)}`);
    }
}
if (offenders.length) {
    fail('سلاسل تُثبّت العدد أو تجمعه نصّاً — تُمرَّر العبارة مصوغة من الكود:\n     ' + offenders.join('\n     '));
}

console.log(`✅ الجمع العربي: نسختان متطابقتان (${checked} مقارنة) · «يوم» في القاعدة = «يوم» في الواجهة · سلاسل البوت بلا عددٍ مثبَّت`);
