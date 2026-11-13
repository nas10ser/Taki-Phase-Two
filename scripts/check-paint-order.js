#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TAKI · حارسُ «ما يُرسم قبل الصفحة»
 *
 * 🔴 بلاغُ ناصر (٩ نوفمبر ٢٠٢٦): «أوّلَ ما أدخل التطبيق وعند التنقّل بين
 *    الصفحات يظهر الفوتر وبعدها الصفحة تحمّل — المفروض يظهرا سوا».
 *    وقِيس على الإنتاج بمتصفّحٍ حقيقيّ: عند **٢٤٨ م.ث** لم تكن الشاشةُ تحمل
 *    غير نصّ التذييل وحده (١٩٧ محرفاً) فوق دوّارة التحميل، ثم قفز التذييلُ
 *    **٤٢٠٠٠ بكسل** لأسفل عند وصول الصفحة (١٤٠٦ م.ث).
 *
 * والسببُ بنيويّ: `<SiteFooter/>` كان **خارج** حدّ التعليق (`Suspense`) الذي
 * يحرس المسارات، في حدٍّ خاصٍّ به `fallback={null}` — فحين تتأخّر حزمةُ
 * الصفحة يُرسم التذييل وحده على شاشةٍ فارغة.
 *
 * وهو نفسُ صنف عيب «ماني مسجّل» الذي يحرسه `check-auth-flash.js`: **سطحٌ
 * يُعلن حالةً مستقرّة قبل أن تُعرف.** فالقاعدة التي يحرسها هذا الملفّ:
 *   ١) التذييلُ **داخل** حدّ تعليق المسارات، فيُرسم مع الصفحة أو لا يُرسم.
 *   ٢) والتذييلُ **ساكنٌ لا كسول**: حدُّ تعليقٍ لحزمةٍ ثانية يُعيد العيبَ
 *      مصغَّراً (تصل الصفحةُ ثم يقفز التذييلُ بعدها).
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP = 'src/App.tsx';
const appPath = path.join(ROOT, APP);

const errors = [];

if (!fs.existsSync(appPath)) {
    errors.push(`${APP} — غير موجود، والحارسُ مبنيٌّ عليه.`);
}

const raw = fs.existsSync(appPath) ? fs.readFileSync(appPath, 'utf8') : '';

/** 🪤 تُجرَّد التعليقاتُ أوّلاً — حارسٌ أمسك تعليقَه هو سبعَ مرّاتٍ في هذا المشروع. */
const strip = (src) => src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')   // تعليقُ JSX
    .replace(/(^[ \t]*|\{)\/\*[\s\S]*?\*\//gm, '$1')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '');

const src = strip(raw);

// ── ١) حدُّ تعليق المسارات: أين يبدأ وأين ينتهي ────────────────────────────
// 🪤 ولا يُبحث عن `</Suspense>` الأولى: داخل الحدّ حدودٌ أخرى محتملة، فيُعدّ
//    الفتحُ والإغلاق حتى يتوازنا — وإلّا بدا الحدُّ أقصرَ ممّا هو ومرّ خطأ.
const openRe = /<Suspense\s+fallback=\{<RouteFallback\s*\/>\}>/;
const openM = src.match(openRe);
if (!openM) {
    errors.push(
        `${APP} — لم يُعثر على حدّ تعليق المسارات \`<Suspense fallback={<RouteFallback/>}>\`.\n`
        + '     فإمّا تغيّرت بنيةُ الهيكل، وإمّا عطب الكاشف. لا يُمرَّر أيُّ الاحتمالين.'
    );
}

let boundaryStart = -1;
let boundaryEnd = -1;
if (openM) {
    boundaryStart = openM.index + openM[0].length;
    let depth = 1;
    const tagRe = /<Suspense\b|<\/Suspense>/g;
    tagRe.lastIndex = boundaryStart;
    let m;
    while ((m = tagRe.exec(src)) !== null) {
        depth += m[0] === '</Suspense>' ? -1 : 1;
        if (depth === 0) { boundaryEnd = m.index; break; }
    }
    if (boundaryEnd === -1) {
        errors.push(`${APP} — حدُّ تعليق المسارات غيرُ متوازن (لم يُغلَق). الكاشفُ لا يستطيع الحكم.`);
    }
}

// ── ٢) التذييلُ داخل الحدّ ─────────────────────────────────────────────────
const footerIdx = src.indexOf('<SiteFooter');
if (footerIdx === -1) {
    errors.push(`${APP} — \`<SiteFooter />\` غيرُ مُصيَّرٍ إطلاقاً. التذييلُ شرطُ قوقل بلاي (رابط سياسة الخصوصيّة).`);
} else if (boundaryStart !== -1 && boundaryEnd !== -1) {
    if (footerIdx < boundaryStart || footerIdx > boundaryEnd) {
        errors.push(
            `${APP} — \`<SiteFooter />\` **خارج** حدّ تعليق المسارات.\n`
            + '     فحين تتأخّر حزمةُ الصفحة يُرسم التذييلُ وحده على شاشةٍ فارغة ثم يقفز\n'
            + '     لأسفل عند وصولها (قِيس: ٢٤٨ م.ث نصُّ التذييل وحده · ثم قفزةُ ٤٢٠٠٠ بكسل).\n'
            + '     العلاج: ضعه بعد `</Switch>` **داخل** نفس الـ`Suspense`.'
        );
    }
}

// ── ٣) التذييلُ ساكنٌ لا كسول ──────────────────────────────────────────────
if (/const\s+SiteFooter\s*=\s*lazy\s*\(/.test(src)) {
    errors.push(
        `${APP} — \`SiteFooter\` مُعرَّفٌ بـ\`lazy()\`.\n`
        + '     حزمتُه ٢٫٤ ك.ب، وكسلُه يعني حدَّ تعليقٍ ثانياً: تصل الصفحةُ ثمّ يقفز\n'
        + '     التذييلُ بعدها — وهو العيبُ نفسُه مصغَّراً. يُستورد ساكناً.'
    );
}
if (!/^import\s+SiteFooter\s+from\s+'\.\/components\/SiteFooter';$/m.test(src)) {
    errors.push(`${APP} — لا استيرادَ ساكناً لـ\`SiteFooter\`.`);
}

// ── ٤) أرضيّةٌ موجبة: الهيكلُ مقروءٌ فعلاً ─────────────────────────────────
// 🪤 فحصٌ لا يجد مخالفةً يمرّ أخضرَ وإن أُفرغ الملفُّ من مضمونه.
for (const needle of ['<Switch>', '<Route exact path="/"', 'RouteFallback']) {
    if (!src.includes(needle)) {
        errors.push(`${APP} — لا يحوي «${needle}» — الكاشفُ لا يقرأ الهيكل، فخُضرتُه بلا معنى.`);
    }
}

if (errors.length) {
    console.error('\n❌ البناء متوقّف: ترتيبُ الرسم');
    for (const e of errors) console.error('   • ' + e);
    console.error('');
    process.exit(1);
}
console.log('✅ ترتيبُ الرسم: التذييلُ ساكنٌ وداخلَ حدّ تعليق المسارات — يُرسم مع الصفحة لا قبلها');
