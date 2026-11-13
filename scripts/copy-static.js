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
const REQUIRED_FILES = ['robots.txt', 'og-image.png', 'logo192.png', 'logo512.png',
    'offline.html', 'apple-touch-icon.png', 'logo-mark.png',
    // v15.50 — علامةُ ٥١٢ لشاشة الدخول. والإدراجُ هنا **هو** الحارس: السطرُ
    // ٥٤ يُفشل البناءَ عند غيابها، وبلا الإدراج تُنشر الصفحةُ بصورةٍ ٤٠٤.
    'logo-mark.webp',
    // v15.59 — علامةُ الترويسة الصغيرة (٧ ك.ب بدل ١٠٠). والإدراجُ هنا **هو**
    // الحارس: غيابُها يُفشل البناء، وبلا الإدراج تُنشر الترويسةُ بصورة ٤٠٤
    // ثمّ ترتدّ إلى PNG الكبيرة — أي يعود العيبُ كاملاً وبصمت.
    'logo-mark-sm.webp', 'logo-mark-sm.png',
    // 🔴 v16.02 — صوتُ الإشعار. والإدراجُ هنا **هو** الحارس: غيابُه يُفشل
    //    البناء. وكان الصوتُ يُحمَّل من `assets.mixkit.co` فحجبته سياسةُ
    //    الأمان (`media-src` يرتدّ إلى `default-src 'self'`) و`catch` فارغٌ
    //    ابتلع الخطأ ⇒ **لم يُسمع ولا مرّة** منذ كُتب. صار ملفّاً عندنا:
    //    ٢٫٦ ك.ب، نغمتان ناعمتان، ٠٫٣٥ ثانية.
    'notify.mp3',
    // 🔴 v16.32 — `favicon.ico` عند الجذر. والإدراجُ هنا **هو** الحارس:
    //    غيابُه يُفشل البناء. وقِيس قبله أن `/favicon.ico` يردّ **٤٠٤**،
    //    فسفاري يطلبه تلقائياً ثمّ يرتدّ إلى مخزونه القديم — ولذلك ظهر
    //    المربّعُ الأخضر بحرف T في «Add Bookmark» بينما كلُّ أيقوناتنا
    //    الحيّة عنابيّة. ويُبنى بـ`node scripts/build-favicon.js`.
    'favicon.ico'];
/** مجلّدات اختيارية فعلاً (نماذج الفحص والصور التعريفية). */
// v15.56 — و`.well-known`: يحمل `assetlinks.json` الذي يربط حزمةَ أندرويد
// (TWA) بالنطاق. اختياريٌّ لأنه لا يُكتب إلا بعد أن تصدر بصمةُ التوقيع من
// Play Console (`node scripts/set-assetlinks.js <البصمة>`)، والموقعُ يعمل
// بلا أندرويد تماماً. 🪤 ولا يُنشَر قالبٌ غيرُ معبَّأ: السطرُ أدناه يُفشل
// البناءَ إن بقي المَوضعُ `__SHA256_FINGERPRINT__` — فبصمةٌ خاطئة تُنتج
// تطبيقاً يعرض **شريطَ عنوان متصفّح** بلا أي رسالة خطأ.
const OPTIONAL_DIRS = ['models', 'screenshots', '.well-known'];
// 🪤 و`fonts/` **لا يُنسخ هنا**: Parcel يرى `url(/fonts/…woff2)` في الورقة
//    فيحزمها بنفسه ويبصمها (`tajawal-arabic-400.1be156fe.woff2`) ويُعيد كتابة
//    حتى وسومَ `preload`. فنسخُها هنا ينتج **نسخةً ثانيةً بـ٩٣ ك.ب لا
//    يطلبها أحد** — قِيس: ١٠ في الجذر مبصومةً و١٠ في `fonts/` ميتة.
//    والحارسُ مكانُه المُخرَج لا المصدر (أدناه).

const missing = [];
let copied = 0;

for (const f of REQUIRED_FILES) {
    const src = path.join(ROOT, f);
    if (!fs.existsSync(src)) { missing.push(f); continue; }
    fs.copyFileSync(src, path.join(DIST, f));
    copied++;
}

// 🔴 v15.50 — وجودُ الملفّ ليس دقّته. علامةُ شاشة الدخول تُعرض بـ١٦٨ CSS px،
//    فأقلُّ من ٥١٢ بكسلاً يعود ضبابياً على الجوال — وهو العيبُ الذي أبلغ عنه
//    ناصر. فيُقاس العرضُ من ترويسة WebP نفسها، لا من حجم الملفّ (بديلٌ ضعيف).
{
    const f = path.join(DIST, 'logo-mark.webp');
    if (fs.existsSync(f)) {
        const b = fs.readFileSync(f);
        const riff = b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP';
        const w = (riff && b.slice(12, 16).toString() === 'VP8X') ? b.readUIntLE(24, 3) + 1 : 0;
        if (!riff) { console.error('❌ logo-mark.webp ليست WebP صالحة.'); process.exit(1); }
        if (w < 512) {
            console.error(`❌ logo-mark.webp عرضُها ${w || '؟'} بكسلاً والمطلوب ٥١٢ على الأقلّ —`);
            console.error('   تُعاد ببناء العلامة من `branding/taki-logo-master.png` (المتتبَّع).');
            process.exit(1);
        }
    }
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

// 🔴 v15.56 — قالبُ ربطِ أندرويد غيرُ المعبَّأ يُفشل البناء. ولماذا خطأٌ لا
//    تحذير: الربطُ ببصمةٍ وهمية يفشل **بصمت** عند أندرويد فيظهر التطبيقُ
//    وفيه شريطُ عنوان المتصفّح، وهو عيبٌ يراه كلُّ من ينزّله ولا يُسجَّل
//    في أي سجلّ. وغيابُ الملفّ أصدقُ من ملفٍّ كاذب.
{
    const al = path.join(DIST, '.well-known', 'assetlinks.json');
    if (fs.existsSync(al)) {
        const t = fs.readFileSync(al, 'utf8');
        if (t.includes('__SHA256_FINGERPRINT__')) {
            console.error('❌ .well-known/assetlinks.json ما زال قالباً غيرَ معبَّأ.');
            console.error('   يُكتب بـ: node scripts/set-assetlinks.js <البصمة من Play Console>');
            process.exit(1);
        }
    }
}

console.log(`✅ نُسخت الملفات الثابتة (${copied} عنصراً) — وفشلُ أي خطوة قبل هذه يُفشل البناء الآن.`);

// ═══════════════════════════════════════════════════════════════════════════
// v15.66 — حارسُ الخطّ المستضاف ذاتياً، **على المُخرَج لا على المصدر**
// ───────────────────────────────────────────────────────────────────────────
// الخطُّ صار من عندنا، فغيابُه يعني موقعاً وتطبيقاً يعرضان العربيةَ بخطّ
// النظام — عيبٌ يراه كلُّ مستخدم ولا يظهر في أيّ سجلّ ولا يُفشل أي بناء.
//
// 🪤 ويُقاس من `dist` لا من `fonts/`: المصدرُ الكاملُ لا يُثبت حزمةً كاملة
//    (Parcel قد يُسقط قاعدةً أو لا يحزم ملفّاً، وقد غيّر الأسماءَ فعلاً).
// 🪤 والعددُ شرطٌ لا تزيين: تسعُ قواعدَ بدل عشرٍ تُسقط وزناً بصمت فيُرسم
//    العنوانُ بوزنٍ آخر ولا يشكو أحد.
// 🪤 ولا يُثبت وجودُ القاعدة أن الملفَّ موجود: كلُّ عنوانٍ في الورقة يُتتبَّع
//    إلى ملفٍّ على القرص — و`url()` إلى ملفٍّ غائب يعود ٤٠٤ بلا أي خطأ CSS.
{
    // 🔴 الورقةُ تُختار من **ما تربطه الصفحةُ فعلاً** لا بأوّل ملفٍّ في
    //    ترتيب المجلّد. و`Parcel` لا ينظّف `dist`، فبقايا بناءٍ سابقٍ تجتمع
    //    مع الحالي — وقِيس: سبعُ أوراقٍ من بناءٍ قديم مع ورقةِ الحاليّ في
    //    نفس المجلّد. فكان الحارسُ قد يُصادق **ورقةَ الأمس** ويمرّ أخضرَ
    //    على بناءٍ اليوم بلا خطّ. (ونفسُ درس «dist يحتفظ بقطعٍ قديمة».)
    //    والمرساةُ موجودةٌ في اليد أصلاً: نفسُ الكتلة تقرأ `index.html` بعد
    //    أسطرٍ قليلةٍ لفحص التحميل المسبق.
    const indexHtml = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
    const linked = [...indexHtml.matchAll(/<link[^>]*rel=["']?stylesheet["']?[^>]*href=["']?([^"'\s>]+\.css)/g)]
        .map((m) => m[1].replace(/^\//, ''));
    if (!linked.length) {
        console.error('❌ لا ورقةَ أنماطٍ مربوطةً في dist/index.html — الصفحةُ بلا تنسيق.');
        process.exit(1);
    }
    let css = null;
    for (const rel of linked) {
        const f = path.join(DIST, rel);
        if (!fs.existsSync(f)) {
            console.error(`❌ الصفحةُ تربط ${rel} ولا وجودَ له في dist.`);
            process.exit(1);
        }
        const t = fs.readFileSync(f, 'utf8');
        if (t.includes('@font-face')) { css = t; break; }
    }
    if (!css) {
        console.error('❌ لا قاعدة @font-face في الورقة التي تربطها الصفحة'
                    + ` (${linked.join(' · ')}) — الخطُّ لم يُحزَم في هذا البناء.`);
        process.exit(1);
    }
    const EXPECTED = 10;   // عربيّ + لاتينيّ × ٥ أوزان (٤٠٠ ٥٠٠ ٧٠٠ ٨٠٠ ٩٠٠)
    const rules = (css.match(/@font-face/g) || []).length;
    if (rules !== EXPECTED) {
        console.error(`❌ قواعدُ @font-face ${rules} والمتوقَّع ${EXPECTED} — سقط وزنٌ أو مقطع.`);
        process.exit(1);
    }
    const urls = [...css.matchAll(/url\(["']?([^"')]*\.woff2)["']?\)/g)].map((m) => m[1]);
    if (urls.length !== EXPECTED) {
        console.error(`❌ عناوينُ woff2 في الورقة ${urls.length} والمتوقَّع ${EXPECTED}.`);
        process.exit(1);
    }
    for (const u of urls) {
        const f = path.join(DIST, u.replace(/^\//, ''));
        if (!fs.existsSync(f)) {
            console.error(`❌ الورقةُ تطلب ${u} ولا وجودَ له في dist — سيعود ٤٠٤ بلا أي خطأ ظاهر.`);
            process.exit(1);
        }
        if (fs.statSync(f).size < 1024) {
            console.error(`❌ ${u} حجمُه ${fs.statSync(f).size} بايت — ملفٌّ معطوب.`);
            process.exit(1);
        }
    }
    // والتحميلُ المسبق يجب أن يشير إلى ملفٍّ **تطلبه الورقةُ فعلاً**، وإلّا
    // نُزّل خطٌّ مرّتين بعنوانين (أسوأُ من لا تحميلٍ مسبق).
    const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
    const pre = [...html.matchAll(/<link[^>]*rel=["']?preload["']?[^>]*href=["']?([^"'\s>]+\.woff2)/g)]
        .map((m) => m[1]);
    if (pre.length < 2) {
        console.error(`❌ وسومُ preload للخطّ ${pre.length} والمتوقَّع ٢ على الأقلّ.`);
        process.exit(1);
    }
    for (const u of pre) {
        if (!urls.includes(u) && !urls.includes(u.replace(/^\//, ''))) {
            console.error(`❌ preload يشير إلى ${u} ولا تطلبه الورقة — تنزيلٌ مهدور.`);
            process.exit(1);
        }
    }
    console.log(`✅ الخطُّ المستضاف: ${rules} قاعدة · ${urls.length} ملفّاً موجوداً · ${pre.length} تحميلاً مسبقاً مطابقاً`);
}
