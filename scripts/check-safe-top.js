#!/usr/bin/env node
/**
 * الحشوُ العلويُّ الآمن — زرُّ الرجوع لا يقع تحت شريط الحالة.
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 بلاغُ ناصر (٢٠ نوفمبر ٢٠٢٦): «عند فتح صفحة شكواي لا زال رمز الرجوع
 *    مرتفع في أعلى الصفحة بحيث إني لا أستطيع النقر عليه — موجود مكان علامة
 *    الشحن في الجوال».
 *
 *    والسببُ مقيس: `MyComplaints` تبني ترويستَها بنفسها (لا `.premium-bar`
 *    ولا `.navbar`)، وحشوُها العلويُّ **١٨ بكسل مكتوبةً باليد بلا inset**.
 *    وصفحاتُ التطبيق تمتدّ **تحت شريط الحالة** على كلّ آيفون لأن
 *    `apple-mobile-web-app-status-bar-style=black-translucent` في
 *    `index.html` — ونتوءُ الجزيرة وحده ٥٩ بكسل.
 *
 * 🔴 **والفخُّ الذي كاد يُشحن وأمسكه القياسُ في المتصفّح**: الصنفُ `page-safe-top`
 *    لا يعمل إن كان على العنصر نفسِه `style={{ padding: '…' }}` — فاختصارُ
 *    `padding` المضمَّن يكتب `padding-top` أيضاً، والمضمَّنُ يعلو على ورقة
 *    الأنماط. قِيس في المتصفّح: `computedPaddingTop = 0px` والزرُّ عند **صفر**
 *    — أي أسوأَ ممّا كان. (وهو عينُ الفخّ المسجَّل عن `style={{ outline }}`.)
 *    ⇒ فالحارسُ يفحص **الأمرين معاً**: وجودَ الصنف، وألّا يُهزَم باختصارٍ مضمَّن.
 *
 * 🪤 ولا يُفحص إلّا من يبني ترويستَه بنفسه: `.premium-bar` و`.navbar` لهما
 *    inset في `styles.css` منذ زمن، وفرضُ الصنف عليهما يُضاعف الحشو.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(root, f), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log('      ' + detail);
    ok ? pass++ : fail++;
};

console.log('\nالحشوُ العلويُّ الآمن — زرُّ الرجوع فوق شريط الحالة');

// ── ① القاعدةُ نفسُها قائمةٌ وبأرضيّة ─────────────────────────────────────
const css = R('src/styles.css');
check('`.page-safe-top` معرَّفٌ في الأنماط', /\.page-safe-top\s*\{/.test(css));
check('وفيه `env(safe-area-inset-top)`',
    /\.page-safe-top\s*\{[^}]*env\(safe-area-inset-top/.test(css));
// 🔴 الأرضيّةُ ليست تجميلاً: على جهازٍ بلا نتوء يعود `env()` **صفراً** بينما
//    الصفحةُ ما زالت تحت شريط الحالة — فبلا `max()` يعود العيبُ كما كان.
check('وله أرضيّةٌ بـ`max()` (جهازٌ بلا نتوء يعود `env()` فيه صفراً)',
    /\.page-safe-top\s*\{[^}]*max\(/.test(css),
    'بلا أرضيّةٍ يسقط الزرُّ تحت شريط الحالة على آيفون SE و٨ بلس');

// ── ② الارتدادُ يسبق `@supports` — وإلّا دهسه ────────────────────────────
const iFallback = css.indexOf('.page-safe-top { padding-top:');
const iSupports = css.indexOf('@supports (padding: env(safe-area-inset-bottom))');
check('ارتدادُ الصنف مكتوبٌ **قبل** كتلة `@supports`',
    iFallback !== -1 && iSupports !== -1 && iFallback < iSupports,
    'التحديدُ واحد فالأخيرُ يفوز — ولو جاء الارتدادُ بعدها لدهس القيمةَ الصحيحة');

// ── ③ كلُّ مستعملٍ للصنف لا يهزمه باختصارٍ مضمَّن ────────────────────────
const { walk } = require('./lib/walk');
const files = walk(root, ['src'], /\.tsx$/).filter((f) => !/node_modules/.test(f));
const offenders = [];
let users = 0;
for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    if (!src.includes('page-safe-top')) continue;
    users++;
    // العنصرُ الحاملُ للصنف: يُقرأ وسمُه كاملاً ويُفحص `style`
    for (const m of src.matchAll(/className="[^"]*page-safe-top[^"]*"[\s\S]{0,400}?>/g)) {
        const tag = m[0];
        // 🪤 `padding:` الاختصار يكتب الأعلى أيضاً؛ و`paddingTop` صريحٌ يدهسه كذلك.
        if (/style=\{\{[^}]*\bpadding\s*:/.test(tag) || /style=\{\{[^}]*\bpaddingTop\s*:/.test(tag)) {
            offenders.push(path.relative(root, f));
        }
    }
}
check(`الصنفُ مستعملٌ فعلاً (${users} ملفّاً)`, users > 0, 'لا أحد يستعمله — قاعدةٌ ميّتة');
check('ولا يهزمه `padding` مضمَّنٌ عند أيّ مستعمل', offenders.length === 0,
    offenders.length ? `يدهسه: ${[...new Set(offenders)].join(' · ')}` : '');

// ── ④ وصفحةُ الشكاوى بعينها — هي البلاغ ──────────────────────────────────
const mc = R('src/pages/MyComplaints.tsx');
check('«شكواي» تستعمل `page-safe-top`', /className="page-safe-top"/.test(mc));
check('وزرُّ رجوعها ٤٤×٤٤ فأكثر (أبل HIG · WCAG 2.5.5)',
    /width:\s*4[4-9]|width:\s*[5-9]\d/.test(mc),
    'هدفٌ أصغر من ٤٤ بكسل يصعب نقرُه — وهو نصفُ الشكوى');
check('ولا ينكمش داخل flex (`flexShrink: 0`)', /flexShrink:\s*0/.test(mc),
    'قِيس بلا هذا: عرضُ الزرّ ٢٧ بكسل بدل ٤٤');

console.log(`\n${fail ? '❌' : '✅'} الحشوُ العلويُّ الآمن: ${pass} ناجحاً · ${fail} فاشلاً`);
process.exit(fail ? 1 : 0);
