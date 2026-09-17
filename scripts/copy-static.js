#!/usr/bin/env node
/**
 * copy-static.js — نسخ الملفات الثابتة إلى dist بعد البناء (v14.52)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 لماذا وُجد، والخلل الذي يسدّه — وهو أخطر ما كُشف في هذه الجلسة:
 *
 * كان أمر البناء ينتهي هكذا:
 *     … && parcel build … && node fix-head-tags.js && cp -f robots.txt … 2>/dev/null;
 *     cp -R models dist/models 2>/dev/null || true;
 *     cp -R screenshots dist/screenshots 2>/dev/null || true
 *
 * والفاصلة المنقوطة تفصل الأوامر فصلاً تامّاً، وحالةُ خروج السكربت هي حالةُ
 * **آخر** أمر فيه — وآخره `|| true`. فأيّ فشلٍ قبله يُمسح تماماً:
 *   • يفشل parcel  ⇒ البناء يخرج بصفر.
 *   • يفشل typecheck ⇒ البناء يخرج بصفر.  (قِيس فعلاً: exit=0 مع خطأ TS)
 *   • يفشل أي اختبار ⇒ البناء يخرج بصفر.
 *
 * ومعنى ذلك أن **بناء Vercel لم يكن يستطيع الفشل قطّ** منذ أن كُتب هذا السطر.
 * كنّا نظنّ أن «البناء ينجح» دليلٌ على شيء، ولم يكن دليلاً على أي شيء: كان
 * يُنشر ما في `dist` أيّاً كان، ولو كان قديماً أو ناقصاً.
 *
 * فالنسخُ صار خطوةً أخيرة في سلسلة `&&` — تُنفَّذ فقط إن نجح ما قبلها، ولا
 * تُخفي فشله. والملفات الاختيارية تبقى اختيارية **هنا** بصراحة (تُسجَّل ولا
 * تُفشل)، أمّا الأساسية فغيابها يُفشل البناء لأن الموقع لا يعمل بلا بعضها.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

if (!fs.existsSync(DIST)) {
    console.error('❌ لا يوجد مجلّد dist — البناء لم يُنتج شيئاً.');
    process.exit(1);
}

/** ملفات لا يعمل الموقع بلا بعضها: غيابُها خطأٌ يُفشل البناء. */
const REQUIRED_FILES = ['robots.txt', 'og-image.png', 'logo192.png', 'logo512.png', 'offline.html'];
/** مجلّدات اختيارية فعلاً (نماذج الفحص والصور التعريفية). */
const OPTIONAL_DIRS = ['models', 'screenshots'];

const missing = [];
let copied = 0;

for (const f of REQUIRED_FILES) {
    const src = path.join(ROOT, f);
    if (!fs.existsSync(src)) { missing.push(f); continue; }
    fs.copyFileSync(src, path.join(DIST, f));
    copied++;
}

if (missing.length) {
    console.error(`❌ ملفات أساسية مفقودة (${missing.length}): ${missing.join(' · ')}`);
    console.error('   كانت تُنسخ بـ`cp … 2>/dev/null` فيُكتَم غيابها ويُنشر الموقع ناقصاً.');
    process.exit(1);
}

for (const d of OPTIONAL_DIRS) {
    const src = path.join(ROOT, d);
    if (!fs.existsSync(src)) { console.log(`ℹ️ ${d}/ غير موجود — تُخطّي (اختياري)`); continue; }
    fs.cpSync(src, path.join(DIST, d), { recursive: true });
    copied++;
}

console.log(`✅ نُسخت الملفات الثابتة (${copied} عنصراً) — وفشلُ أي خطوة قبل هذه يُفشل البناء الآن.`);
