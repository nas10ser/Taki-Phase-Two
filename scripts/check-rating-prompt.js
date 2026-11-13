#!/usr/bin/env node
/**
 * v15.76 — عقدُ نافذة التقييم: **لكلّ طلبٍ مرّة**، لا لكلّ عمر.
 *
 * 🔴 بلاغُ ناصر ثلاثَ مرّات: «لا يظهر تقييم المصداقيه والمتجر». والسببُ
 *    المقيس لم يكن في «بلا كود» إطلاقاً — بل شرطان عُمريّان:
 *    ① `pending_rating_prompts()` كانت تستبعد الطلبَ إن سبق أن قيّم المشتري
 *       ذلك المتجر **مرّةً في حياته** (تقييمٌ واحد لكلّ متجر بفهرسٍ فريد).
 *    ② والواجهةُ كانت تقفز `prevReview ? 'done' : 'rate'` فوق النجوم.
 *    ③ والتقييمُ السابق كان يُستنبط من العروض المحمَّلة، فإن لم يكن عرضُ
 *       المتجر محمَّلاً ظُنَّ «لا تقييم» ⇒ `addRating` يصطدم بالفهرس = زرٌّ صامت.
 *
 * فهذه الثلاثةُ لا تُستعاد بتحريرٍ عابر. والحارسُ يقرأ المصدرَ **مجرَّداً من
 * التعليقات** — فقد أمسك حارسٌ قبله تعليقَه هو خمسَ مرّات.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
/** يُجرَّد تعليقُ السطر وتعليقُ الكتلة وJSX — فلا يحرس الحارسُ كلامَه. */
const strip = (src) => src
    .replace(/(^[ \t]*|\{)\/\*[\s\S]*?\*\//gm, '$1')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:])\/\/[^\n'"`]*$/gm, '$1');

const fail = [];
const ctx = strip(read('src/context/AppContext.tsx'));
const repo = strip(read('src/repositories/bookingRepository.ts'));
// 🪤 منطقُ الجلب خرج إلى `ratingPrompts.ts` حين رفضت السقّافةُ نموَّ السياق —
//    فمدى الحارس يشمل الملفّين معاً، وإلّا برّأ نفسَه بانتقال كودٍ لا بإصلاح.
const pick = strip(read('src/context/ratingPrompts.ts'));
const both = ctx + '\n' + pick;

// ① لا قفزَ فوق النجوم لمن له تقييمٌ سابق
if (/setRatingStep\(\s*prevReview\s*\?/.test(ctx)) {
    fail.push('الواجهة تقفز فوق خطوة النجوم لمن له تقييمٌ سابق (setRatingStep(prevReview ? …)) — فلا يُسأل عن المتجر بعد أوّل تقييم.');
}
if (!/const proceed = \(\) => setRatingStep\('rate'\)/.test(ctx)) {
    fail.push("خطوةُ المصداقية لا تُفضي إلى النجوم: المتوقَّع proceed = () => setRatingStep('rate').");
}

// ② التقييمُ السابق من حمولة القاعدة لا من العروض المحمَّلة
if (!/next\.prev_rating/.test(both)) {
    fail.push('التقييمُ السابق لا يُقرأ من حمولة pending_rating_prompts (next.prev_rating) — فسيُظنّ «جديداً» ويصطدم بالفهرس الفريد.');
}
if (/\(x\.ratings \|\| \[\]\)\.find\(/.test(both)) {
    fail.push('عاد استنباطُ التقييم السابق من العروض المحمَّلة (x.ratings) — وهو يُخطئ كلّما لم يكن عرضُ المتجر محمَّلاً.');
}

// ③ وسمُ «سُئل» يُكتب على الخادم لا في المتصفّح وحده
if (!/markRatingPromptSeen: async/.test(repo) || !/rpc\('rating_prompt_seen'/.test(repo)) {
    fail.push('bookingRepository.markRatingPromptSeen غائبة أو لا تنادي rating_prompt_seen.');
}
const marks = (ctx.match(/bookingRepository\.markRatingPromptSeen\(/g) || []).length;
if (marks < 2) {
    fail.push(`وسمُ الطلب يُنادى ${marks} مرّة — المتوقَّع موضعان: الإغلاق/«لاحقاً»، ونجاحُ التعديل (وإلا عادت النافذة بعد تقييمٍ تمّ).`);
}

// ④ الهجرةُ التي تحمل القاعدة الجديدة موجودةٌ ومُعبِّرةٌ عنها
const sqlPath = 'supabase/JEDDAH_v15_76_rating_prompt_per_order.sql';
if (!fs.existsSync(path.join(ROOT, sqlPath))) {
    fail.push(`${sqlPath} مفقود — وهو مصدرُ القاعدة الجديدة على جدة.`);
} else {
    const sql = read(sqlPath).replace(/^\s*--.*$/gm, '');
    // 🪤 يُقاس **جسمُ الدالّة** لا الملفّ: كتلةُ التحقّق في الهجرة تحمل الشرطَ
    //    القديم كسلسلةٍ نصّية لتَنفيه — ففحصُ الملفّ كلِّه يتّهم النصَّ الذي يحرسه
    //    (سادسُ وقوعٍ لهذا الفخّ؛ وتجريدُ التعليقات لا يكفي هنا لأنها سلسلة).
    const m = sql.match(/CREATE OR REPLACE FUNCTION public\.pending_rating_prompts\(\)[\s\S]*?AS \$function\$([\s\S]*?)\$function\$/);
    if (!m) {
        fail.push('لم يُعثر على جسم pending_rating_prompts في الهجرة.');
    } else {
        const body = m[1];
        if (!/rating_prompt_at IS NULL/.test(body)) fail.push('جسمُ pending_rating_prompts لا يُرشّح على rating_prompt_at.');
        if (/NOT \(t\.has_rating AND t\.has_vote\)/.test(body)) fail.push('شرطُ العمر القديم عاد إلى جسم pending_rating_prompts.');
        if (!/prev_rating/.test(body) || !/my_vote/.test(body)) fail.push('جسمُ الدالّة لا يُرجع prev_rating/my_vote.');
    }
}

if (fail.length) {
    console.error('❌ عقدُ نافذة التقييم مكسور:');
    for (const f of fail) console.error('   • ' + f);
    process.exit(1);
}
console.log('✅ نافذةُ التقييم: لكلّ طلبٍ مرّة · النجومُ لا تُقفَز · التقييمُ السابق من القاعدة · الوسمُ على الخادم (موضعان)');
