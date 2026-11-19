#!/usr/bin/env node
/**
 * مساراتُ التطبيق — القائمةُ المعلَنة تطابق الموجّهَ فعلاً.
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 العيبُ الذي يحرسه (بلاغُ ناصر ١٩ نوفمبر ٢٠٢٦): «عند رفع إشعار ترويجي
 *    يقول إن الصفحة غير موجودة». والمقيس على جدة: الحملةُ المبثوثة لكلّ
 *    التجّار كانت تحمل `/seller-dashboard?tab=form` **والمسارُ `/seller`**.
 *
 * 🔴 ولا شيء كان يصرخ: قاعدةُ التوجيه في `vercel.json` تُعيد `index.html`
 *    لأيّ مسارٍ بلا امتداد فيردّ **٢٠٠**، ثمّ يعرض الموجّهُ صفحةَ «غير
 *    موجودة». فالسجلّاتُ كلُّها تقول «نجاح» بينما كلُّ تاجرٍ يرى عطلاً.
 *    (نفسُ صنف الفخّ المسجَّل في v14.64: «عنوانٌ خاطئ بلا امتداد يعود ٢٠٠».)
 *
 * ⇒ فالقائمةُ في `src/data/appRoutes.ts` **تُستخرج من `App.tsx` نفسِه**
 *   وتُقارَن حرفاً بحرف. وإعادةُ تسمية مسارٍ تُمسَك عند البناء لا عند أوّل
 *   تاجرٍ يضغط الزرّ.
 *
 * 🪤 ويُجرَّد التعليقُ قبل أيّ فحصٍ نصّيّ: هذا الملفُّ يذكر `/seller-dashboard`
 *    في شرحه، وحارسٌ يقرأ تعليقَه هو فخٌّ وقع في هذا المشروع سبعَ مرّات.
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

console.log('\nمساراتُ التطبيق — المعلَنُ يطابق الموجّه');

const strip = (src) => src
    .replace(/(^[ \t]*|\{)\/\*[\s\S]*?\*\//gm, '$1')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '');

// ── ① ما يعرفه الموجّهُ فعلاً ────────────────────────────────────────────
const app = strip(R('src/App.tsx'));
const routed = new Set();
for (const m of app.matchAll(/<Route\s+[^>]*path="([^"]+)"/g)) routed.add(m[1]);
check('استُخرجت مساراتُ الموجّه', routed.size >= 20, `وُجد ${routed.size}`);

// ── ② ما تعلنه القائمة ───────────────────────────────────────────────────
const decl = strip(R('src/data/appRoutes.ts'));
const declared = new Set();
for (const m of decl.matchAll(/'(\/[^']*)'/g)) declared.add(m[1]);

// `/` ليس في وسوم Route (هو عنصرٌ افتراضيّ) فيُستثنى من المقارنة العكسية.
const missing = [...routed].filter((r) => !declared.has(r));
const extra = [...declared].filter((r) => r !== '/' && r !== '//' && !routed.has(r));

check('كلُّ مسارٍ في الموجّه معلَنٌ في القائمة', missing.length === 0,
    missing.length ? `ناقص: ${missing.join(' · ')}` : '');
check('ولا مسارَ معلَنٌ لا وجودَ له في الموجّه', extra.length === 0,
    extra.length ? `زائد (سيُقبل رابطٌ ميت): ${extra.join(' · ')}` : '');

// ── ③ والدالّةُ تُشغَّل فعلاً — لا يُقرأ نصُّها ───────────────────────────
// 🪤 الملفُّ خالصٌ بلا استيراد، فيُترجَم ويُشغَّل. وفحصُ النصّ وحده كان
//    سيمرّ على دالّةٍ تُعيد `true` دائماً.
const cp = require('child_process');
const out = path.join(root, 'node_modules', '.cache-app-routes');
fs.rmSync(out, { recursive: true, force: true });
let isInternalRoute;
try {
    cp.execFileSync('npx', ['tsc', path.join(root, 'src/data/appRoutes.ts'),
        '--outDir', out, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { cwd: root, stdio: 'pipe' });
    ({ isInternalRoute } = require(path.join(out, 'appRoutes.js')));
} catch (e) {
    check('ترجمةُ appRoutes.ts', false, String(e.stdout || e.message).slice(0, 300));
}

if (typeof isInternalRoute === 'function') {
    const OK = ['/seller', '/seller?tab=form', '/nearby', '/deal/123', '/store/abc',
                '/booking/TK-1', '/', '/deals?type=all', '/profile#x'];
    const BAD = ['/seller-dashboard', '/seller-dashboard?tab=form', '/nope',
                 '//evil.com', 'https://evil.com', '/deal', '/deal/', 'seller'];
    const badOK = OK.filter((u) => !isInternalRoute(u));
    const badBAD = BAD.filter((u) => isInternalRoute(u));
    check(`المساراتُ الصالحة تُقبل (${OK.length})`, badOK.length === 0, `رُفض: ${badOK.join(' · ')}`);
    check(`والميّتةُ تُرفض (${BAD.length})`, badBAD.length === 0, `قُبل: ${badBAD.join(' · ')}`);
    // 🔴 الحالةُ التي أوقعت البلاغ بعينها
    check('«/seller-dashboard?tab=form» مرفوضٌ صراحةً',
        !isInternalRoute('/seller-dashboard?tab=form'));
}

console.log(`\n${fail ? '❌' : '✅'} مساراتُ التطبيق: ${pass} ناجحاً · ${fail} فاشلاً`);
process.exit(fail ? 1 : 0);
