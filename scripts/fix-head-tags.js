#!/usr/bin/env node
/**
 * v13.97 — يُعيد وسمَي <head> و</head> إلى dist/index.html بعد البناء.
 * ---------------------------------------------------------------------------
 * لماذا؟ مُصغِّر Parcel (htmlnano) يحذف الوسوم الاختيارية، فتخرج الصفحة هكذا:
 *     <!DOCTYPE html><html lang=ar dir=rtl><meta charset=UTF-8>…<body>
 * وهذا **HTML5 صحيح تماماً** والمتصفحات تبنيه ضمنياً — لكن مدقّق ملكية
 * Google Search Console يبحث عن قسم <head> **حرفياً**، فيفشل التوثيق برسالة:
 *     «Your meta tag is not in the <head> section of your home page»
 *
 * جُرّب `.htmlnanorc` و`.htmlnanorc.json` بخيار removeOptionalTags:false
 * فلم يُحترم أيّهما في هذا الإصدار — فالحلّ خطوة صريحة مقيسة بدل إعداد صامت.
 *
 * الكلفة: ١٣ بايتاً. والمقابل: توثيق يعمل، وأدوات فحص أخرى (مدقّقات SEO،
 * قارئات المشاركة) تفترض وجود <head> أيضاً.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'dist', 'index.html');

if (!fs.existsSync(file)) {
    console.error('✗ لم أجد dist/index.html — هل جرى البناء؟');
    process.exit(1);
}

let html = fs.readFileSync(file, 'utf8');

if (html.includes('<head>') && html.includes('</head>')) {
    console.log('✓ <head> موجود أصلاً — لا تعديل.');
    process.exit(0);
}

// كل ما بين وسم <html …> و<body> هو محتوى الترويسة في مخرَج Parcel.
const htmlTag = html.match(/<html[^>]*>/i);
const bodyIdx = html.search(/<body[^>]*>/i);

if (!htmlTag || bodyIdx === -1) {
    console.error('✗ بنية غير متوقّعة: لم أجد <html …> أو <body>. لم أعدّل شيئاً.');
    process.exit(1);
}

const openIdx = html.indexOf(htmlTag[0]) + htmlTag[0].length;
if (openIdx >= bodyIdx) {
    console.error('✗ ترتيب غير متوقّع (<body> قبل نهاية <html …>). لم أعدّل شيئاً.');
    process.exit(1);
}

html = html.slice(0, openIdx) + '<head>' + html.slice(openIdx, bodyIdx) + '</head>' + html.slice(bodyIdx);
fs.writeFileSync(file, html);

// تحقّق بعد الكتابة — لا نكتفي بأننا «فعلنا الصواب».
const out = fs.readFileSync(file, 'utf8');
const h = out.indexOf('</head>');
const checks = [
    ['<head> أُضيف', out.includes('<head>')],
    ['</head> أُضيف', out.includes('</head>')],
    ['charset داخل head', out.indexOf('charset') < h && out.indexOf('charset') !== -1],
    ['canonical داخل head', out.indexOf('canonical') < h && out.indexOf('canonical') !== -1],
    ['root خارج head', out.indexOf('id=root') > h],
];
const gv = out.indexOf('google-site-verification');
if (gv !== -1) checks.push(['وسم توثيق جوجل داخل head', gv < h]);

let ok = true;
for (const [label, pass] of checks) {
    console.log(`${pass ? '✓' : '✗'} ${label}`);
    if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
