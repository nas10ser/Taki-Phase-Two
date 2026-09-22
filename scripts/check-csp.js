#!/usr/bin/env node
/**
 * check-csp.js — حارس سياسة الأمان (v14.79)
 * ═══════════════════════════════════════════════════════════════════════════
 * ثلاثة أشياء يمنعها، وكلّها وقعت فعلاً في هذا المستودع:
 *
 *  ١) **نسخةٌ ثانية من السياسة.** كانت مكتوبةً بخطّ اليد في `index.html` وفي
 *     `vercel.json` معاً، وكلتاهما مُنفَّذة، فانحرفتا. المصدر الآن واحد
 *     (`vercel.json`) و`inject-csp.js` يحقنه في البناء — وهذا الفحص يرفض
 *     عودةَ سياسةٍ مكتوبةٍ يدوياً في `index.html`.
 *
 *  ٢) **عناوين تطويرٍ محلّي في سياسة الإنتاج.** `ws://127.0.0.1:*` و
 *     `ws://localhost:*` كانتا تُشحنان فعلاً.
 *
 *  ٣) **مضيفٌ مسموحٌ لا يستعمله أحد.** كل سطرٍ في `connect-src` بابٌ مفتوح:
 *     سبعة وسطاء عامّين كانوا مسموحين ويستقبلون روابط مواقع التجار.
 *     المضيف الذي لا يظهر في الكود يجب أن يخرج من السياسة.
 *
 * 🪤 والمقارنة تتجاهل **التعليقات**: بعد حذف الوسطاء بقيت أسماؤهم في تعليقٍ
 *    يشرح سبب الحذف، وفحصٌ ساذج كان سيعدّها «استعمالاً» فيُبقي الباب مفتوحاً.
 * 🪤 وبعض المضيفات تُستعمل **بلا أن يُذكر اسمها في الكود** (خطوط جوجل تجلب
 *    ملفّات الخطّ من `fonts.gstatic.com` بنفسها). لذلك قائمة استثناءٍ صريحة
 *    ومعلَّلة — لا تُوسَّع إلا بسبب مكتوب.
 */

const fs = require('fs');
const path = require('path');
const { walk } = require('./lib/walk');

const root = path.resolve(__dirname, '..');
const problems = [];

// ── المصدر الوحيد ───────────────────────────────────────────────────────────
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
let policy = null;
for (const e of cfg.headers || []) {
    for (const h of e.headers || []) {
        if (String(h.key).toLowerCase() === 'content-security-policy') policy = String(h.value);
    }
}
if (!policy) {
    console.error('\n❌ لا توجد Content-Security-Policy في vercel.json — وهي المصدر الوحيد.\n');
    process.exit(1);
}

// ── ١) لا نسخة ثانية ────────────────────────────────────────────────────────
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
if (/http-equiv=["']?Content-Security-Policy/i.test(indexHtml)) {
    problems.push(
        'index.html يحمل سياسة أمان مكتوبة يدوياً — وهذه نسخةٌ ثانية تنحرف عن vercel.json.\n' +
        '     السياسة تُكتب في vercel.json وحدها، و scripts/inject-csp.js يحقنها في البناء.'
    );
}

// ── ٢) لا عناوين تطوير في الإنتاج ───────────────────────────────────────────
for (const m of policy.match(/\S*(?:localhost|127\.0\.0\.1)\S*/gi) || []) {
    problems.push(`عنوان تطويرٍ محلّي في سياسة الإنتاج: ${m}`);
}
for (const m of policy.match(/\bws:\/\/\S+/gi) || []) {
    problems.push(`اتصال غير مشفّر (ws://) في سياسة الإنتاج: ${m}`);
}

// ── ٣) كل مضيفٍ مسموح يجب أن يُستعمل ────────────────────────────────────────
/**
 * مضيفات تُستعمل بلا ذكرٍ حرفيّ في الكود — ولكلٍّ سببٌ مكتوب.
 * لا يُضاف إليها شيء بلا سبب: هي الثقب الوحيد في هذا الفحص.
 */
const INDIRECT = {
    'fonts.gstatic.com': 'ملفّات الخطّ يطلبها ملفّ fonts.googleapis.com بنفسه، فلا يظهر اسمها في كودنا',
    '141-147-142-147.sslip.io': 'الاسم القديم للقاعدة — صور العروض القديمة مخزَّنة بعنوانه الكامل',
    '*.supabase.co': 'قاعدة المعاينة (VERCEL_ENV=preview) تُحقن وقت البناء لا في الكود',
    '*.sentry.io': 'يُبنى العنوان داخل حزمة Sentry من الـDSN',
    'challenges.cloudflare.com': 'Turnstile يجلب موارده بنفسه بعد تحميل السكربت',
    'web.telegram.org': 'frame-ancestors — تيليجرام هو من يضع صفحتنا في إطاره (التطبيق المصغّر)، فلا نذكره نحن',
};

/** ملفّات المصدر التي قد تحمل مضيفاً، بلا تعليقات. */
function sourceTextWithoutComments() {
    // 🪤 كان `git ls-files` — وهي تنفجر على Vercel (تبني بلا .git) فأسقطت
    //    نشرَتين. لا فحصَ في سلسلة البناء يفترض وجود git.
    const files = walk(root, [
        'src', 'api', 'shared', 'sw.js', 'index.html', 'manifest.webmanifest', 'public',
    ], /\.(ts|tsx|js|jsx|css|html|json|webmanifest)$/);

    let out = '';
    for (const f of files) {
        let t;
        try { t = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
        // تُزال التعليقات: /* … */ و // … و <!-- … -->
        t = t.replace(/\/\*[\s\S]*?\*\//g, ' ')
             .replace(/<!--[\s\S]*?-->/g, ' ')
             .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
        out += '\n' + t;
    }
    return out;
}

const src = sourceTextWithoutComments();

const hosts = new Set();
for (const tok of policy.split(/[\s;]+/)) {
    const m = /^(?:https?|wss?):\/\/(.+)$/.exec(tok);
    if (m) hosts.add(m[1].replace(/\/$/, ''));
}

const unused = [];
for (const h of hosts) {
    if (INDIRECT[h]) continue;
    // `*.example.com` ⇐ يُطابَق بالجذر
    const needle = h.startsWith('*.') ? h.slice(2) : h;
    if (!src.includes(needle)) unused.push(h);
}
for (const h of unused) {
    problems.push(
        `المضيف «${h}» مسموحٌ في السياسة ولا يظهر في الكود إطلاقاً (خارج التعليقات).\n` +
        '     إمّا يُحذف من vercel.json، أو يُضاف إلى INDIRECT في هذا الملفّ **بسببٍ مكتوب**.'
    );
}

if (problems.length) {
    console.error('\n❌ البناء متوقّف: سياسة الأمان\n');
    for (const p of problems) console.error('   • ' + p);
    console.error('');
    process.exit(1);
}

console.log(`✅ سياسة الأمان: مصدرٌ واحد · بلا عناوين تطوير · ${hosts.size} مضيفاً كلّها مستعملة`);
