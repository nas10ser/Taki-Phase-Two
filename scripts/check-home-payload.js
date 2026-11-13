#!/usr/bin/env node
/**
 * حارسُ حمولة الرئيسية (v16.16) — node scripts/check-home-payload.js
 *
 * ── العيبُ الذي يحرسه ───────────────────────────────────────────────────
 * الرئيسيةُ كانت تُطلق **ستّةَ نداءاتٍ** فوق الشبكة (أربعةُ أشرطةٍ + بنرات
 * + مسابقات)، وكلُّ شريطٍ يوسّع نطاقَه **متتابعاً** ⇒ حتّى اثنتا عشرةَ جولةَ
 * شبكةٍ قبل أن تكتمل الصفحة. صارت نداءً واحداً (`taki_home_payload`).
 *
 * وما يُكسر بصمت بعد ذلك ثلاثةُ أشياء، وكلُّها هنا:
 *   ① **عودةُ نداءٍ ثانٍ**: أيُّ `useDealRail` أو جلبٍ مباشرٍ للبنرات/المسابقات
 *      داخل `Home.tsx` يُعيد العيبَ وهو يبدو سليماً تماماً.
 *   ② **سقوطُ شرائح المسابقات**: الدمجُ كان داخل `loadBanners`؛ ولمّا نُقل
 *      الجلبُ إلى الخطّاف سقط الدمجُ سهواً (وقع فعلاً أثناء كتابة v16.16).
 *   ③ **انحرافُ العقد**: الفرزُ والسقوفُ مثبَّتةٌ في دالّة القاعدة. فلو
 *      ظنّ أحدٌ أن `limit` يُمرَّر من الواجهة لصار يُغيّره هنا بلا أثر.
 *
 * 🪤 ويُجرَّد التعليقُ قبل أيّ فحصِ نصّ — هذا الملفُّ يذكر كلَّ اسمٍ يبحث عنه.
 */
const fs = require('fs');
const path = require('path');

const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
    .replace(/([^:])\/\/[^\n'"`]*$/gm, '$1')
    .replace(/^\s*--[^\n]*$/gm, '');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log(`      ${detail}`);
    ok ? pass++ : fail++;
};

console.log('\nحمولةُ الرئيسية — نداءٌ واحد');

const home = strip(R('src/pages/Home.tsx'));
const hook = strip(R('src/hooks/useHomePayload.ts'));
const sql  = strip(R('supabase/JEDDAH_v16_16_home_payload.sql'));

// ① لا نداءَ ثانياً فوق الشبكة من الصفحة نفسِها
check('Home يستعمل الحمولةَ الواحدة', /useHomePayload\s*\(/.test(home));
for (const [name, re] of [
    ['لا useDealRail في الرئيسية', /useDealRail\s*\(/],
    ['لا جلبَ بنراتٍ مباشرٍ منها', /bannerRepository\s*\.\s*getActive/],
    ['لا جلبَ مسابقاتٍ مباشرٍ منها', /contestRepository\s*\.\s*list/],
]) check(name, !re.test(home), 'عاد نداءٌ ثانٍ إلى الرئيسية — والعقدُ نداءٌ واحد');

// ② شرائحُ المسابقات ما زالت تُدمج في نفس الكاروسيل
check('شرائحُ المسابقات تُدمج مع البنرات',
    /home\.contests[\s\S]{0,400}?isContestLive[\s\S]{0,400}?contestMatchesAudience/.test(home)
    && /\.\.\.contestSlides\s*,\s*\.\.\.home\.banners/.test(home),
    'سقطت شرائحُ المسابقات من الكاروسيل — وهي عيبٌ لا يظهر إلّا لمن عنده مسابقةٌ حيّة');

// ③ العقدُ بين الخطّاف ودالّة القاعدة
const sent = [...hook.matchAll(/\bp_[a-z_]+\s*:/g)].map(m => m[0].replace(/\s*:$/, ''));
const declMatch = /CREATE OR REPLACE FUNCTION public\.taki_home_payload\(([\s\S]*?)\)\s*RETURNS/.exec(sql);
const declared = declMatch ? declMatch[1] : '';
const accepted = [...declared.matchAll(/\b(p_[a-z_]+)\s+\w/g)].map(m => m[1]);
check('كلُّ معاملٍ يرسله الخطّاف تقبله الدالّة',
    sent.length > 0 && sent.every(k => accepted.includes(k)),
    `يرسل [${sent.join(', ')}] · تقبل [${accepted.join(', ')}]`);

for (const k of ['trending', 'discount', 'season', 'coming', 'banners', 'contests']) {
    check(`المفتاح «${k}» يُبنى في القاعدة ويُقرأ في الخطّاف`,
        new RegExp(`'${k}'\\s*,`).test(sql) && new RegExp(`\\b${k}\\b`).test(hook));
}

// ④ الأمان: الدالّتان INVOKER في المصدر كما على الخادم
// 🪤 ويُطابَق **إعلانٌ في أوّل سطر** لا ورودُ النصّ: أوّلُ صيغةٍ كتبتُها
//    عدّت أربعاً — تعليقاً في الرأس، والإعلانين، **ورسالةَ الخطأ التي
//    تحذّر من DEFINER**. أي أن الحارسَ أمسك نصَّه هو (ثامنُ مرّةٍ في هذا
//    المشروع)، فسقط على كودٍ سليم.
check('المصدرُ يعلن SECURITY INVOKER للاثنتين',
    (sql.match(/^SECURITY INVOKER$/gm) || []).length === 2,
    `وجدتُ ${(sql.match(/^SECURITY INVOKER$/gm) || []).length} إعلاناً — وDEFINER يتجاوز RLS للمنادي`);

// ⑤ الموسمُ لا يُستعلَم عنه بلا حملةٍ حيّة (استعلامٌ موفَّر لكلّ زائر)
check('شريطُ الموسم مشروطٌ بوجود موسم',
    /COALESCE\(p_season_id, ''\)\s*=\s*''\s*THEN\s*'\[\]'::jsonb/.test(sql)
    && /seasonCampaign\s*&&\s*seasonLive/.test(home));

// ⑥ 🔴 **كابحٌ على إعادة الجلب** — قِيس أنها خرجت ستَّ مرّاتٍ في فتحةٍ
//    واحدة لأن `visibilitychange` و`focus` و`pageshow` تقع متتابعةً عند كلّ
//    عودة، وهي أثقلُ نداءٍ في الصفحة.
check('إعادةُ الجلب مكبوحةٌ بمهلة',
    /REFETCH_MIN_MS/.test(hook) && /throttled:\s*true/.test(hook),
    'بلا كابحٍ تُعيد كلُّ عودةٍ للتطبيق جلبَ الأشرطة الأربعة والبنرات والمسابقات');
check('والجلبةُ الأولى وتغيّرُ النطاق يتجاوزانه',
    /lastAtRef\.current = 0;/.test(hook),
    'وإلّا بقيت الصفحةُ على نطاقٍ تركه المستخدم');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail === 0 ? 0 : 1);
