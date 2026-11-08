#!/usr/bin/env node
/**
 * check-empty-state.js — «لماذا الشبكةُ فارغة؟» جوابٌ واحد لا ثلاثة (v15.81)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 العيبُ الذي يحرسه، مقيساً: جوابُ الشبكةِ الفارغة كان مكتوباً **ثلاث
 *    مرّات** (الرئيسية · كل العروض · حولي). أصلحت v14.63 اثنتين وبقيت
 *    `DealsList` سنةً كاملةً تتّهم «اختياراتك الحالية» أمام زائرٍ لم يختر
 *    شيئاً — وهي صفحةُ هبوطٍ من جوجل. أي أن العيبَ لم يكن في النصّ بل في
 *    **عددِ نسخه**: ما يُكتب ثلاث مرّات ينحرف، ولا شيء يصرخ.
 *    ⇒ فالحارسُ على **الموضع** لا على النصّ: الجملةُ في `EmptyDeals.tsx`
 *      وحدها، وأيُّ نسخةٍ رابعةٍ تُفشل البناء.
 *
 * 🔴 والشقُّ الثاني: بوّابةُ نشر الكتالوج في خريطة الموقع **تفشل مغلقة**.
 *    قِيس في ٨ نوفمبر ٢٠٢٦: العروضُ الستّةُ الحيّةُ كلُّها لحسابِ الأدمن،
 *    والخريطةُ تُسلّمها جوجل بـ`changefreq hourly` — وما يُفهرَس لا يُستردّ.
 *    فتحويلُ `=== true` إلى `!== false` يوماً ما يُعيد النشرَ بصمت.
 *
 * 🪤 ويُجرَّد التعليقُ قبل أيِّ فحصٍ نصّيّ: حارسٌ أمسك **تعليقَه هو** ثلاثَ
 *    مرّاتٍ في هذا المستودع (v15.00 · v15.22). والجملُ أدناه مذكورةٌ في
 *    هذا الملفّ نفسِه، فلو لم يُجرَّد التعليقُ لاتّهم الحارسُ نفسَه.
 * 🪤 ولا git: بناءُ Vercel أرشيفٌ بلا مستودع (درس v14.80b) ⇒ `lib/walk.js`.
 */
const fs = require('fs');
const path = require('path');
const { walk } = require('./lib/walk');

const root = path.resolve(__dirname, '..');

/** الجملُ التي يملكها مكوّنٌ واحد. */
const OWNER = 'src/components/EmptyDeals.tsx';
const PHRASES = [
    'لا توجد عروض ضمن اختياراتك الحالية',
    'No deals match your current filters',
    'لم نجد عروضاً تطابق بحثك',
    'No deals match your search',
];

const SITEMAP = 'api/sitemap.js';
const GATE_KEY = 'sitemap_catalogue_enabled';

const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** السلسلةُ بأكملها بين علامتَي اقتباس — لا جزءاً من جملةٍ أطول. */
const quoted = (phrase) => new RegExp(
    `(['"\`])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`);

const read = (rel) => {
    try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; }
};

const problems = [];

// ① الجملةُ في مكوّنٍ واحد — وفي ذاك المكوّن فعلاً
const files = walk(root, ['src'], /\.(ts|tsx)$/);
for (const phrase of PHRASES) {
    const holders = [];
    for (const rel of files) {
        const src = read(rel);
        // 🪤 سلسلةٌ **كاملة** لا تضمين: `botQuestions.ts` يحمل
        //    «😕 لم نجد عروضاً… جرب تصنيفاً آخر» — نصُّ قناةٍ أخرى لا نسخةٌ
        //    من هذه. فحارسٌ بالتضمين يتّهم البريء (وقع فعلاً أوّل تشغيل).
        if (src && quoted(phrase).test(stripComments(src))) holders.push(rel);
    }
    if (holders.length !== 1 || holders[0] !== OWNER) {
        problems.push(
            `نصُّ الحالةِ الفارغة «${phrase}» في ${holders.length} ملفّاً: ` +
            `${holders.join(' · ') || '(لا شيء)'} — والمالكُ الوحيد ${OWNER}. ` +
            'نسخةٌ ثانية = انحرافٌ قادم (هذا ما وقع بين v14.63 وv15.81).');
    }
}

// ② بوّابةُ خريطة الموقع: موجودةٌ وتفشل مغلقة
const sitemap = read(SITEMAP);
if (sitemap === null) {
    problems.push(`${SITEMAP} غير موجود — بوّابةُ نشر الكتالوج اختفت.`);
} else {
    const code = stripComments(sitemap);
    if (!code.includes(GATE_KEY)) {
        problems.push(`${SITEMAP} لا يقرأ ${GATE_KEY} — الكتالوجُ يُنشر بلا بوّابة.`);
    }
    if (!/\.value\s*===\s*true/.test(code)) {
        problems.push(`${SITEMAP}: البوّابةُ يجب أن تُقارن بـ\`.value === true\` — ` +
            '`!== false` تجعل صفّاً غائباً يعني «انشر» (فشلٌ مفتوح).');
    }
    if (/!==\s*false/.test(code)) {
        problems.push(`${SITEMAP}: وُجد \`!== false\` — فشلٌ مفتوح.`);
    }
}

if (problems.length) {
    console.error('\n✗ حارسُ الحالةِ الفارغة وبوّابةِ الفهرس:\n');
    for (const p of problems) console.error(`   • ${p}`);
    console.error('');
    process.exit(1);
}

console.log(`✅ الحالةُ الفارغة: ${PHRASES.length} جملةً في ${OWNER} وحده · وبوّابةُ الفهرس تفشل مغلقة`);
