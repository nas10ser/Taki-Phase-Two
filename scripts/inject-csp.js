#!/usr/bin/env node
/**
 * inject-csp.js — سياسة أمانٍ واحدة، تُكتب مرّةً وتُحقَن (v14.79)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 الثغرة، مقيسة لا مفترضة: السياسة كانت مكتوبةً **بخطّ اليد مرّتين** —
 *    في `index.html` كوسم `<meta>` وفي `vercel.json` كترويسة — **وكلتاهما
 *    مُنفَّذة**: الطلب يجب أن يمرّ من الاثنتين معاً. وقد **انحرفتا فعلاً**:
 *      • `index.html` كان يحمل `ws://127.0.0.1:*` و`ws://localhost:*` —
 *        عناوينَ تطويرٍ محلّي **شُحنت إلى الإنتاج**.
 *      • و`vercel.json` وحدها تحمل `upgrade-insecure-requests`.
 *    أي أن نسختين اختلفتا بلا أن يصرخ شيء، وهذا بالضبط ما يجعل تعديل واحدةٍ
 *    منهما «حجباً صامتاً» لا يظهر إلا كميزةٍ مكسورة عند مستخدم.
 *
 * ما صار: **`vercel.json` هي المصدر الوحيد**. و`index.html` في المستودع لم
 * يعد يحمل سياسةً إطلاقاً، وهذه الخطوة تحقن الترويسة نفسها في
 * `dist/index.html` بعد البناء — فالدفاع طبقتان كما كان، والنصّ مصدرٌ واحد،
 * والانحراف صار مستحيلاً لا مراقَباً.
 *
 * 🪤 `frame-ancestors` **يتجاهله المتصفّح في وسم meta** ويطبع تحذيراً في
 *    الطرفية. يُحذف من النسخة المحقونة وحدها — ويبقى في الترويسة حيث يعمل.
 * 🪤 ولا تعمل هذه الخطوة على `index.html` في المستودع أبداً: التطوير المحلّي
 *    بلا سياسة عمداً (ولذلك كانت عناوين `ws://` هناك أصلاً).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 v15.79 — قاعدةُ المعاينة تخرج من سياسة الإنتاج (S8-04)
 * ═══════════════════════════════════════════════════════════════════════════
 * ما كان: `connect-src` تسمح بـ`https://*.supabase.co` و`wss://*.supabase.co`
 * — **نمطٌ يستطيع أيُّ إنسانٍ أن يسجّل مضيفاً داخله** في دقيقتين بمشروعٍ
 * مجّانيّ. أي أنّ سياسةَ الأمان، التي وظيفتُها منعُ البيانات من الخروج لحظةَ
 * وقوع تنفيذِ سكربتٍ على أصلنا، كانت تحمل **نقطةَ تصريفٍ جاهزة**. ولم يكن
 * النمطُ للإنتاج أصلاً: الإنتاج يتكلّم `api.takisa.net` وحده، والنمطُ موجودٌ
 * من أجل بيئة المعاينة (قاعدةُ طوكيو).
 *
 * ما صار، على خطوتين لأن **الترويسةَ واحدةٌ للبيئتين**:
 *   ١) في `vercel.json` أُسقط النمطُ وحلَّ مكانَه **مضيفُ المعاينة بعينه**
 *      (`kbmqzxcjdankdgiovctm.supabase.co`). فزال الثقبُ الأصليّ: لا أحدَ
 *      يستطيع تسجيلَ هذا المضيف — هو لنا.
 *   ٢) وهنا: يُحذف ذلك المضيفُ من النسخة المحقونة **إلّا في بناء المعاينة**
 *      (`VERCEL_ENV === 'preview'`، تحقنها Vercel تلقائياً كما في
 *      `scripts/preview-env.js`).
 *
 * 🪤 ولماذا تكفي الخطوةُ الثانية مع أن الترويسةَ تحمل المضيف: المتصفّح
 *    يُنفّذ **كلَّ** سياسةٍ يستلمها، والمطلوبُ هو **تقاطعُها** لا اتّحادُها
 *    (CSP §«Multiple policies»). فمضيفٌ في الترويسة وغائبٌ عن الـmeta =
 *    **محجوبٌ فعلاً** في الإنتاج. وفي المعاينة يحضر في الاثنتين فيعمل.
 *    والوسمُ يُدسّ بعد `<meta charset>` مباشرةً — قبل أيّ مورد — فالتقاطعُ
 *    سارٍ على كلّ طلبٍ بلا استثناء.
 * 🪤 ولا يُستعمل شرطُ `has: host` في `vercel.json` بدلاً من هذا: ترويستان
 *    بنفس المفتاح تُنتجان سياستين تتقاطعان أيضاً، وسلوكُ الدمج عند Vercel
 *    لا يُقاس إلّا بنشرةٍ فعليّة — فاخترتُ ما أستطيع قياسَه هنا.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const distFile = path.join(root, 'dist', 'index.html');

/**
 * مضيفُ قاعدة المعاينة — **مثبَّتٌ بعينه لا بنمط**، ونفسُه في
 * `scripts/preview-env.js`. و`scripts/check-csp.js` يرفض انحرافَ الاثنين.
 */
const PREVIEW_DB_HOST = 'kbmqzxcjdankdgiovctm.supabase.co';

/** يُسقط كلَّ وسمٍ يشير إلى مضيف المعاينة من كلّ توجيه. */
function stripPreviewHost(pol) {
    return pol
        .split(';')
        .map((d) => d
            .trim()
            .split(/\s+/)
            .filter((tok) => tok !== `https://${PREVIEW_DB_HOST}` && tok !== `wss://${PREVIEW_DB_HOST}`)
            .join(' '))
        .filter(Boolean)
        .join('; ');
}

/** يقرأ السياسة من مصدرها الوحيد. */
function policyFromVercelJson() {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
    for (const entry of cfg.headers || []) {
        for (const h of entry.headers || []) {
            if (String(h.key).toLowerCase() === 'content-security-policy') return String(h.value);
        }
    }
    return null;
}

const policy = policyFromVercelJson();
if (!policy) {
    console.error('✗ لم أجد Content-Security-Policy في vercel.json — وهي المصدر الوحيد.');
    process.exit(1);
}

if (!fs.existsSync(distFile)) {
    console.error('✗ لم أجد dist/index.html — هل جرى البناء؟');
    process.exit(1);
}

let html = fs.readFileSync(distFile, 'utf8');

// 🔴 v14.82 — كان هنا `process.exit(1)` إن وُجد وسمُ سياسةٍ في `dist`، وهو
//    **عيبٌ أدخلتُه أنا**: Parcel يُبقي `dist/index.html` من بناءٍ سابق حين
//    يضرب كاشُه، فيجد الوسمَ الذي حقنتُه أنا بالأمس ويُعلنه «نسخةً ثانية»
//    فيُفشل البناء. (قِيس: `npm run build` مرّتين متتاليتين ⇒ الثانية حمراء.)
//    وVercel تبني نظيفاً فالإنتاج لم يتأثّر — أي أن العيب كان يضرب التحقّق
//    المحلّي وحده، وهو أسوأ موضعٍ له.
//
//    والتمييز الصحيح: نسخةٌ **مكتوبة يدوياً في المصدر** يمسكها `check-csp.js`
//    على `index.html` قبل البناء. وما يوجد في `dist` أثرُ حقنةٍ سابقة لا أكثر،
//    فيُزال ويُعاد بناؤه — الحقن عمليةٌ **خاملة التكرار** (idempotent).
const before = html;
html = html.replace(/\s*<meta[^>]*http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '');
if (html !== before) {
    console.log('  ↳ أُزيلت حقنةٌ سابقة من dist (بناءٌ متكرّر بكاش Parcel) قبل إعادة الحقن.');
}

// النسخة المحقونة بلا `frame-ancestors` (يتجاهله meta) — والترويسة تحمله.
let metaPolicy = policy
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d && !/^frame-ancestors\b/i.test(d))
    .join('; ');

// ── قاعدةُ المعاينة: تبقى في بناء المعاينة وتُحذف من كلّ بناءٍ آخر ──────────
const isPreview = process.env.VERCEL_ENV === 'preview';
if (isPreview) {
    console.log(`  ↳ بناءُ معاينة (VERCEL_ENV=preview) — أُبقي مضيفُ قاعدة المعاينة ${PREVIEW_DB_HOST}`);
} else {
    const trimmed = stripPreviewHost(metaPolicy);
    if (trimmed !== metaPolicy) {
        metaPolicy = trimmed;
        console.log(`  ↳ أُسقط مضيفُ قاعدة المعاينة (${PREVIEW_DB_HOST}) من النسخة المحقونة`
            + ' — فتقاطعُ الترويسة والـmeta يحجبه فعلاً.');
    }
}

const tag = `<meta http-equiv="Content-Security-Policy" content="${metaPolicy.replace(/"/g, '&quot;')}">`;

// تُوضع أوّل ما يمكن داخل <head>: أي مورد يُشار إليه قبل الوسم لا تغطّيه.
const at = html.indexOf('<meta charset');
if (at === -1) {
    console.error('✗ لم أجد <meta charset> لأضع السياسة بعده.');
    process.exit(1);
}
const close = html.indexOf('>', at) + 1;
html = html.slice(0, close) + tag + html.slice(close);

fs.writeFileSync(distFile, html);
console.log(`✓ حُقنت السياسة في dist/index.html من vercel.json (${metaPolicy.split(';').length} توجيهاً)`);
