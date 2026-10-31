// حارسُ «`.default` من استيرادٍ ديناميكيّ لوحدة CommonJS» (v15.39)
// التشغيل: node scripts/check-cjs-dynamic-default.js
//
// ── العيبُ الذي يحرسه، وقد عاش في الإنتاج من v14.79 إلى v15.38 ────────────
// `const QRCode = (await import('qrcode')).default;`
// وحزمة `qrcode` **CommonJS**. وParcel يُسجّلها في الحزمة مُصدِّرةً مفاتيحها
// الحقيقية (`create · toCanvas · toDataURL · toString`) **بلا `default`**.
// فالقيمةُ `undefined`، و`undefined.toDataURL(...)` ترمي **دائماً**.
// ⇒ رمزُ التذكرة لم يُرسم ولا مرّة. قِيس في متصفّحٍ حقيقيّ ببناء Parcel:
//      module keys = create, toCanvas, toDataURL, toString
//      typeof mod.default = undefined
//      (.default)        ❌ Cannot read properties of undefined
//      (.default ?? mod) ✅ رسم
//
// 🪤 ولماذا لم يُمسكه شيء:
//   • **الأنواع تكذب**: `@types/qrcode` تُصرّح بـ`default` بحكم esModuleInterop،
//     فـ`tsc` يُبرّئ السطر. والاستيرادُ **الساكن** يمرّ بمُهايئ Parcel فيعمل —
//     فوجودُ `import QRCode from 'qrcode'` في `utils/zatcaQr.ts` يعمل فعلاً
//     ويُوهم أن الديناميكيّ مثله.
//   • والمكوّن يلتقط الاستثناء ويعرض بديلاً **مصمَّماً ليبدو معقولاً**، فلا
//     خطأ على الشاشة ولا في أي سجلّ يصل أحداً.
//   ⇒ الفحصُ الوحيد الممكن كان **النظر إلى الرمز**. وهذا الحارسُ بديلُه.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const bad = [];

/** هل الحزمة CommonJS؟ (لا `type: module` ولا مدخل ESM) */
const isCjs = (pkg) => {
    try {
        const j = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', pkg, 'package.json'), 'utf8'));
        if (j.type === 'module') return false;
        if (j.module) return false;
        const e = j.exports;
        if (e && typeof e === 'object') {
            const probe = JSON.stringify(e);
            if (probe.includes('"import"')) return false;
        }
        return true;
    } catch { return false; }   // غير مثبَّتة ⇒ لا حكم
};

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);

const files = walk(path.join(root, 'src')).filter(f => /\.(ts|tsx)$/.test(f));
// 🪤 يُجرَّد التعليقُ أوّلاً: هذا الشرحُ نفسه يحوي النمطَ المحظور.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '');
const RE = /\(\s*await\s+import\(\s*['"]([^'".][^'"]*)['"]\s*\)\s*\)\s*\.default/g;

for (const f of files) {
    const src = strip(fs.readFileSync(f, 'utf8'));
    for (const m of src.matchAll(RE)) {
        const pkg = m[1].split('/')[0];
        if (isCjs(pkg)) bad.push(`${path.relative(root, f)} → (await import('${m[1]}')).default — و«${pkg}» حزمةُ CommonJS بلا default`);
    }
}
const check = (n, ok, d) => { console.log(`${ok ? '  ✓' : '  ✗'} ${n}`); if (!ok && d) console.log('      ' + d); ok ? pass++ : fail++; };

check('لا `.default` مباشرةً من استيرادٍ ديناميكيّ لوحدة CommonJS', bad.length === 0, bad.join('\n      '));
// حالةٌ موجبة: الحارسُ يعرف أن qrcode فعلاً CommonJS (وإلّا لم يكن يفحص شيئاً)
check('ويعرف أن «qrcode» حزمةُ CommonJS', isCjs('qrcode'));
// وحالتان سالبتان حقيقيّتان: حزمةٌ `type: module` وأخرى بمدخل ESM.
// 🪤 وكانت هنا `isCjs('react') === false || true` — فحصٌ **لا يستطيع الفشل**.
check('ولا يتّهم حزمةَ «type: module»', isCjs('react-leaflet') === false);
check('ولا يتّهم حزمةً بمدخل ESM', isCjs('@supabase/supabase-js') === false);
// والموضعُ الذي كُسر يحمل الآن الارتداد
const qr = strip(fs.readFileSync(path.join(root, 'src/components/QrImage.tsx'), 'utf8'));
check('و`QrImage` يرتدّ إلى الوحدة نفسها', /\.default\s*\?\?\s*mod/.test(qr));

console.log(fail === 0
    ? `✅ استيرادُ CommonJS الديناميكيّ: ${pass} فحصاً — لا «default» وهمية`
    : `\n❌ البناء متوقّف: ${fail} فشل من ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
