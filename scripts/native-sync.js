#!/usr/bin/env node
/**
 * native-sync.js — نقلُ حزمة الويب إلى التطبيقين، ثمّ ترقيعُ ما يخصّهما وحدهما.
 * ═══════════════════════════════════════════════════════════════════════════
 * التشغيل:  node scripts/native-sync.js            (بعد `npm run build`)
 *
 * 🔴 **لماذا سياسةُ أمانٍ ثانية ولا تُعدَّل سياسةُ الويب**: التطبيقُ يعمل في
 *    أصلٍ مختلفٍ تماماً — `capacitor://localhost` على آيفون و
 *    `https://localhost` على أندرويد. وإضافةُ هذين إلى سياسة **الموقع**
 *    تُدخل `localhost` في سياسة إنتاجٍ عامّة، وهو بالضبط ما يمنعه
 *    `check-csp.js` — وُضع ذلك الحارسُ بعد أن شُحنت `ws://localhost` فعلاً
 *    إلى الإنتاج. فالصوابُ أن لكلّ أصلٍ سياستَه، لا أن تُضعَّف سياسةُ الويب
 *    لأجل التطبيق.
 *
 * 🪤 ويُشغَّل **بعد كلّ بناء** قبل بناء المنصّتين (وهو ما يفعله سيرُ العمل).
 *    ونسيانُه يعني أن التطبيق يحمل نسخةً قديمة من الواجهة — بلا أيّ خطأ.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NATIVE_ORIGINS = "capacitor://localhost https://localhost";

if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    console.error('❌ لا يوجد dist/index.html — شغّل `npm run build` أوّلاً.');
    process.exit(1);
}

// ١) نقلُ الحزمة وتحديثُ الإضافات في المشروعين.
console.log('→ مزامنة Capacitor …');
execFileSync('npx', ['cap', 'sync'], { cwd: ROOT, stdio: 'inherit' });

// ١ب) إسقاطُ خرائط المصدر من نسخة التطبيق.
// 🔴 قِيس: `dist` ١٣٨ م.ب منها **١١٨ خرائطُ مصدر** (١٨١ ملفّاً). ودخولُها
//    الحزمةَ عيبان لا واحد:
//      • الحجم: حزمةٌ ١٣٨ م.ب بدل ٢٠ — وقوقل تسقّف الحزمةَ الأساسيّة،
//        وأبل تمنع التنزيل على بيانات الجوّال فوق حدٍّ معيّن. أي أن هذا
//        وحدَه كان سيمنع النشر.
//      • والكشف: خريطةُ المصدر تحمل **الكودَ الأصليّ كاملاً** بتعليقاته.
//        وعلى الويب تُخدَم عمداً (ليقرأها Sentry)، أمّا داخل حزمةٍ تُنزَّل
//        على ملايين الأجهزة فلا مبرّر لها إطلاقاً.
// 🪤 وتُسقط من **النسخة المنقولة** لا من `dist`: الويبُ ما زال يحتاجها.
function stripMaps(dir) {
    if (!fs.existsSync(dir)) return 0;
    let n = 0, bytes = 0;
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const f = path.join(d, e.name);
            if (e.isDirectory()) walk(f);
            else if (e.name.endsWith('.map')) { bytes += fs.statSync(f).size; fs.unlinkSync(f); n++; }
        }
    };
    walk(dir);
    if (n) console.log(`   ✓ أُسقطت ${n} خريطةَ مصدر (${(bytes / 1048576).toFixed(0)} م.ب) من ${path.basename(path.dirname(dir))}`);
    return n;
}
for (const d of ['ios/App/App/public', 'android/app/src/main/assets/public']) {
    stripMaps(path.join(ROOT, d));
}

// ٢) ترقيعُ سياسة الأمان في النسخة المنقولة وحدها.
const targets = [
    'ios/App/App/public/index.html',
    'android/app/src/main/assets/public/index.html',
];

let patched = 0;
for (const rel of targets) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { console.log(`ℹ️ ${rel} غير موجود — تُخطّى`); continue; }
    let html = fs.readFileSync(p, 'utf8');

    const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/i);
    if (!m) {
        // 🪤 غيابُ الوسم ليس «لا بأس»: الحزمةُ تُبنى بسياسةٍ محقونة، فغيابُها
        //    يعني أن البناءَ ليس ما نظنّ. يُوقَف بدل أن يُشحن مجهول.
        console.error(`❌ ${rel}: لا وسمَ سياسةِ أمان — البناءُ ليس المتوقَّع.`);
        process.exit(1);
    }
    if (m[1].includes('capacitor://localhost')) { patched++; continue; }   // خاملُ التكرار

    const csp = m[1]
        .replace(/default-src ([^;]+)/, `default-src $1 ${NATIVE_ORIGINS}`)
        .replace(/connect-src ([^;]+)/, `connect-src $1 ${NATIVE_ORIGINS}`)
        // 🪤 و`upgrade-insecure-requests` تُسقط من نسخة التطبيق: لا طلبَ
        //    غيرَ مشفّرٍ عندنا أصلاً، وبعضُ إصدارات WebKit تعاملها معاملةً
        //    غريبةً مع المخطّطات المخصّصة فتحجب مواردَ التطبيق عن نفسه.
        .replace(/;?\s*upgrade-insecure-requests/, '');

    html = html.replace(m[0], `<meta http-equiv="Content-Security-Policy" content="${csp}"`);
    fs.writeFileSync(p, html);
    patched++;
    console.log(`   ✓ ${rel}`);
}

if (!patched) { console.error('❌ لم تُنقل أيُّ حزمةٍ إلى المنصّتين.'); process.exit(1); }

// ٣) التحقّق: يُقرأ الناتجُ لا النيّة.
let bad = 0;
for (const rel of targets) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    const html = fs.readFileSync(p, 'utf8');
    const csp = (html.match(/Content-Security-Policy" content="([^"]+)"/i) || [])[1] || '';
    for (const need of ['capacitor://localhost', 'https://localhost', "connect-src 'self'"]) {
        if (!csp.includes(need)) { console.error(`❌ ${rel}: ناقصٌ «${need}»`); bad = 1; }
    }
    if (csp.includes('upgrade-insecure-requests')) {
        console.error(`❌ ${rel}: لم تُسقط upgrade-insecure-requests`); bad = 1;
    }
    // وحزمةُ الواجهة نفسُها وصلت؟ (ملفٌّ فارغٌ يمرّ بلا هذا الفحص)
    const dir = path.dirname(p);
    const js = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
    if (!js.length) { console.error(`❌ ${rel}: لا حزمةَ جافاسكربت بجواره`); bad = 1; }

    // عقدٌ صريح: صفرُ خريطةِ مصدرٍ، وحجمٌ معقولٌ لحزمةِ متجر.
    let maps = 0, total = 0;
    const walk2 = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk2(f);
        else { total += fs.statSync(f).size; if (e.name.endsWith('.map')) maps++; } } };
    walk2(dir);
    if (maps) { console.error(`❌ ${rel}: بقيت ${maps} خريطةَ مصدر`); bad = 1; }
    const mb = total / 1048576;
    if (mb > 60) { console.error(`❌ ${rel}: الواجهةُ ${mb.toFixed(0)} م.ب — أكبرُ ممّا يُقبل في حزمةِ متجر`); bad = 1; }
    else console.log(`   ✓ ${path.basename(path.dirname(dir))}: واجهةٌ ${mb.toFixed(1)} م.ب · صفرُ خريطة`);
}
if (bad) process.exit(1);

// وسياسةُ الويب **لم تُمَسّ** — يُثبَت لا يُفترض.
const web = fs.readFileSync(path.join(ROOT, 'dist', 'index.html'), 'utf8');
if (web.includes('capacitor://localhost')) {
    console.error('❌ تسرّبت أصولُ التطبيق إلى حزمة الويب — أوقِف.');
    process.exit(1);
}

console.log(`✅ المزامنة: ${patched} منصّة · سياسةٌ خاصّةٌ بالتطبيق · وسياسةُ الويب سليمة`);
