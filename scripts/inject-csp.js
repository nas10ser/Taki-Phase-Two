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
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const distFile = path.join(root, 'dist', 'index.html');

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

if (/http-equiv=["']?Content-Security-Policy/i.test(html)) {
    console.error('✗ dist/index.html يحمل سياسةً أصلاً — نسختان مرّةً أخرى. أُوقف البناء.');
    process.exit(1);
}

// النسخة المحقونة بلا `frame-ancestors` (يتجاهله meta) — والترويسة تحمله.
const metaPolicy = policy
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d && !/^frame-ancestors\b/i.test(d))
    .join('; ');

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
