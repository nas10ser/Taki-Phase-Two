/**
 * strip-tfjs-maps v12.31 — يزيل تعليقات sourceMappingURL من حزم TensorFlow/NSFWJS.
 *
 * السبب: خرائط المصدر داخل @tensorflow/tfjs تشير لملفات ‎../src/*.ts غير
 * موجودة في الحزمة المنشورة، وParcel يحاول قراءتها أثناء البناء فيفشل بـ
 * ENOENT (build failed). إزالة سطر sourceMappingURL تجعل Parcel يتجاهل
 * الخرائط المكسورة نهائياً — لا تأثير على عمل المكتبة إطلاقاً.
 * يعمل تلقائياً بعد كل npm install (postinstall) محلياً وعلى Vercel.
 */
const fs = require('fs');
const path = require('path');

const roots = [
    path.join(__dirname, '..', 'node_modules', '@tensorflow'),
    path.join(__dirname, '..', 'node_modules', 'nsfwjs'),
];

let stripped = 0;
const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!e.name.endsWith('.js') && !e.name.endsWith('.mjs') && !e.name.endsWith('.cjs')) continue;
        let src;
        try { src = fs.readFileSync(p, 'utf8'); } catch { continue; }
        const out = src.replace(/^\s*\/\/# sourceMappingURL=.*$/gm, '');
        if (out !== src) {
            fs.writeFileSync(p, out);
            stripped++;
        }
    }
};

roots.forEach(walk);
console.log(`strip-tfjs-maps: cleaned ${stripped} files`);
