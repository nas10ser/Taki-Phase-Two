#!/usr/bin/env node
/**
 * لكلّ مكوّنٍ كسولٍ حدُّه — وإلّا انفجرت الخريطة.
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 العيبُ الذي وُلد له هذا الحارس، وقد وقع فعلاً (بلاغُ ناصر ١٩ نوفمبر
 *    ٢٠٢٦ + تقريرُ سنتري من الإنتاج): «عند محاولة تعديل المنتج ووضعِ تاريخٍ
 *    له **يعلق**… وحتى عند تغيير موقعه يوجد تعليق».
 *        Error: Map container is already initialized.
 *          at _initContainer (leaflet/src/map/Map.js:1094)
 *          at x (react-leaflet/lib/MapContainer.js:30)
 *
 *    كانت `SellerDashboard` تلفّ **جسدَها كلَّه** بحدِّ `Suspense` واحدٍ وفيه
 *    **ثلاثةَ عشرَ مكوّناً كسولاً** مع خريطة الموقع. وإخفاءُ حدٍّ في React 18
 *    ليس إظهارَ بديلٍ فحسب — إنه `disappearLayoutEffects` التي **تفصل
 *    مراجعَ عقد DOM** وتُبقي التأثيراتِ الخاملة، فتبقى خريطةُ ليفلت حيّةً
 *    وختمُها `_leaflet_id` على العقدة. وعند الكشف `reappearLayoutEffects`
 *    تُعيد ربطَ المرجع على **نفس العقدة**، و`react-leaflet@4` يلتقط
 *    `context === null` في مُغلَّفٍ بمصفوفةٍ فارغة ⇒ يُنشئ خريطةً ثانية
 *    ⇒ يرمي. (كلُّ خطوةٍ قُرئت من المصدر المثبَّت، لا من الذاكرة.)
 *
 *    ⇒ فتحُ التقويمِ الكسول كان يُخفي الخريطة ويكشفها = انفجار = «يعلق».
 *
 * ── الاستثناءاتُ الثلاثة وسببُ كلٍّ منها (قائمةُ سماحٍ صريحة) ─────────────
 *   · `App.tsx`            — حدُّ المسارات: مسارٌ واحدٌ مركَّبٌ في كلّ لحظة،
 *                            والتبديلُ **يُفكّك** السابق لا يُخفيه.
 *   · `AdminDashboard.tsx` — حدُّ التبويب: تبويبٌ واحدٌ في كلّ لحظة، كذلك.
 *   · `lazyBoundary.tsx`   — هو نفسُه الأداة.
 *
 * 🪤 ويُجرَّد التعليقُ قبل أيّ عدّ (الفخُّ المسجَّل: «الحارسُ يقرأ تعليقَه هو»)،
 *    وبالنمط المُصحَّح في v16.30 الذي لا يبتلع `image/*`.
 */
const fs = require('fs');
const path = require('path');
const { walk } = require('./lib/walk');

const root = path.join(__dirname, '..');

/** أين يجوز `lazy(` خاماً، ولماذا. */
const ALLOW = new Set([
    'src/App.tsx',
    'src/pages/AdminDashboard.tsx',
    'src/utils/lazyBoundary.tsx',
]);

const strip = (s) => s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^[ \t]*|\{)\/\*[\s\S]*?\*\//gm, '$1')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log('      ' + detail);
    ok ? pass++ : fail++;
};

console.log('\nلكلّ مكوّنٍ كسولٍ حدُّه');

const files = walk(root, ['src'], /\.(ts|tsx)$/);

// ── ① لا `lazy(` خاماً خارج قائمة السماح ────────────────────────────────
const offenders = [];
for (const f of files) {
    if (ALLOW.has(f)) continue;
    const src = strip(fs.readFileSync(path.join(root, f), 'utf8'));
    if (/(?:React\.)?\blazy\s*\(/.test(src)) offenders.push(f);
}
check('لا `React.lazy` خارج قائمة السماح — `lazyBoundary` بدلاً منها',
    offenders.length === 0,
    offenders.join(' · ') + ' ⇐ استعمل `lazyBoundary(() => import(…))`');

// ── ② ولوحةُ التاجر بلا حدٍّ جامع: هو عينُ العيب ─────────────────────────
const seller = strip(fs.readFileSync(path.join(root, 'src/pages/SellerDashboard.tsx'), 'utf8'));
check('لوحةُ التاجر بلا حدِّ `Suspense` جامع', !/<Suspense\b/.test(seller),
    'حدٌّ يلفّ اللوحة يُخفي الخريطةَ عند أوّل تحميلٍ كسول ⇒ «Map container is already initialized»');
check('وكلُّ كسولٍ فيها عبر `lazyBoundary`',
    (seller.match(/lazyBoundary\(\(\) => import\(/g) || []).length >= 9,
    'عددُ المحدودين أقلُّ من المعروف (٩)');

// ── ③ والأداةُ نفسُها تحمل حدّاً حقيقياً ─────────────────────────────────
const lb = strip(fs.readFileSync(path.join(root, 'src/utils/lazyBoundary.tsx'), 'utf8'));
check('`lazyBoundary` يلفّ المكوّنَ بـ`<Suspense>`',
    /<Suspense[\s\S]{0,200}<Inner/.test(lb),
    'بلا الحدّ تصير الأداةُ `React.lazy` باسمٍ آخر');

// ── ④ وكلُّ صفحةٍ تحمل خريطةً لا تحمل `lazy(` خاماً ───────────────────────
//    (الحالةُ التي انفجرت فعلاً: خريطةٌ وكسولون في حدٍّ واحد.)
const mapFiles = files.filter(f =>
    /<MapContainer\b/.test(strip(fs.readFileSync(path.join(root, f), 'utf8'))));
check(`صفحاتُ الخرائط معروفةٌ ومقيسة (${mapFiles.length})`, mapFiles.length > 0);
const mapOffenders = mapFiles.filter(f => offenders.includes(f));
check('ولا واحدةَ منها تحمل `lazy(` خاماً', mapOffenders.length === 0, mapOffenders.join(' · '));

console.log(`\n${fail ? '❌' : '✅'} حدودُ المكوّنات الكسولة: ${pass} ناجحاً · ${fail} فاشلاً`);
process.exit(fail ? 1 : 0);
