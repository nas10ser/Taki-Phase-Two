#!/usr/bin/env node
/**
 * native-env.js — بيئةُ بناء تطبيقَي المتجرين (v15.58)
 * ═══════════════════════════════════════════════════════════════════════════
 * المشكلة: بناءُ التطبيقين يجري على منصّات GitHub، ويحتاج `SUPABASE_URL`
 * و`SUPABASE_ANON_KEY` كأيّ بناءٍ للواجهة. وضبطُهما يحتاج «أسرارَ مستودع»
 * لا أملك إليها طريقاً برمجياً (لا `gh` على الجهاز، وتوكن GitHub في ملفّ
 * المفاتيح **ميت** — جُرّب فردّ 401).
 *
 * ── ولماذا هذا آمنٌ تماماً ─────────────────────────────────────────────────
 * • القيمتان **عامّتان بطبيعتهما**: العنوانُ عامّ، والمفتاحُ `anon` **يُسلَّم
 *   لكلّ زائرٍ في حزمة المتصفّح** — هو الآن في `path0.*.js` على الموقع، يقرؤه
 *   أيُّ أحد بنقرتين. وحمايةُ البيانات في RLS لا في إخفاء هذا المفتاح.
 * • وهو نفسُ ما يفعله `scripts/preview-env.js` منذ v14.61 وبنفس السبب.
 * • ولا يعمل هذا الملفّ إلا حين `TAKI_NATIVE_BUILD=1` — فبناءُ Vercel
 *   لا يمرّ من هنا إطلاقاً، ومتغيّراتُه المضبوطةُ هناك هي التي تسود.
 *
 * 🔴 **وعند تدوير المفتاح العامّ**: يُحدَّث هذا الملفُّ أيضاً (مكتوبٌ في
 *    `supabase/ops/ROTATE-JWT.md`). وبلا ذلك يُبنى التطبيقُ بمفتاحٍ ميت
 *    فيفشل كلُّ طلبٍ فيه بـ401 — ولا شيءَ في البناء يصرخ.
 */
const fs = require('fs');
const path = require('path');

if (process.env.TAKI_NATIVE_BUILD !== '1') process.exit(0);

const NATIVE = {
    SUPABASE_URL: 'https://api.takisa.net',
    SUPABASE_ANON_KEY:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InRha2ktaHMyNTYtcm90LTIwMjYtMTEifQ.' +
        'eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzkzOTk4NzgzLCJleHAiOjE5NTE2Nzg3ODN9.' +
        'hjzVR-m20NEt41bkh6MD8QLb3LOUzlNWjYJsiCb_xQU',
};

const envPath = path.resolve(__dirname, '..', '.env');
let existing = '';
try { existing = fs.readFileSync(envPath, 'utf8'); } catch { /* لا ملف — يُنشأ */ }

const lines = [];
for (const [k, v] of Object.entries(NATIVE)) {
    if (process.env[k]) continue;                              // البيئةُ تسود
    if (new RegExp(`^${k}=`, 'm').test(existing)) continue;      // ولا تُدهس قيمةٌ موجودة
    lines.push(`${k}=${v}`);
}
if (!lines.length) { console.log('ℹ️ بناءُ تطبيق: المتغيّراتُ مضبوطةٌ سلفاً.'); process.exit(0); }

fs.writeFileSync(envPath, (existing ? existing.replace(/\n*$/, '\n') : '') + lines.join('\n') + '\n');
console.log('✅ بناءُ تطبيق: كُتبت ' + lines.length + ' قيمةً عامّة في .env');
