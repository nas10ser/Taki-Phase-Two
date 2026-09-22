#!/usr/bin/env node
/**
 * check-deps.js — حزمةٌ مثبَّتة لا يستوردها أحد (v14.79)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 الثغرة، مقيسة: `clsx` و`lucide-react` و`tailwind-merge` كانت مثبَّتةً في
 *    `dependencies` و**صفر إشارة إليها في المستودع كلّه**. لا تكسر شيئاً، لكن
 *    كل حزمةٍ زائدة سطحُ ثغراتٍ يُفحص ويُرقَّع بلا مقابل — وثغرات هذا المستودع
 *    الأربع كانت كلّها في سلسلة الأدوات لا في كودنا.
 *
 * 🔴 **والفخّ الذي كاد يُوقعني**: `@tensorflow/tfjs` لا يظهر في أي
 *    `import … from` — لأنه يُحمَّل كسولاً: `await import('@tensorflow/tfjs')`
 *    داخل `moderationService.ts`. وحذفُه كان سيُسقط فلترة الصور غير اللائقة
 *    **في الإنتاج** بلا أن يُخطئ البناء. فالفحص يجب أن يرى الاستيراد الديناميكي
 *    كما يرى الساكن — وإلا كان أداةَ تخريب لا أداةَ نظافة.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');

/**
 * حزم تُستعمل بلا استيرادٍ نصّيّ — ولكلٍّ سببٌ مكتوب.
 * (فارغة اليوم؛ تُملأ بسببٍ صريح لا بالتخمين.)
 */
const INDIRECT = {};

function scan(dirs) {
    const files = execFileSync('git', ['ls-files', ...dirs], { cwd: root, encoding: 'utf8' })
        .trim().split('\n').filter(Boolean)
        .filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs|css|html)$/.test(f));
    let out = '';
    for (const f of files) {
        try { out += '\n' + fs.readFileSync(path.join(root, f), 'utf8'); } catch { /* ignore */ }
    }
    return out;
}

/** كل أشكال الاستعمال: ساكن · ديناميكي · require · إعادة تصدير · @import في CSS. */
function isUsed(dep, text) {
    const q = dep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp(`from\\s+['"]${q}(?:/[^'"]*)?['"]`),        // import x from 'dep'
        new RegExp(`import\\s+['"]${q}(?:/[^'"]*)?['"]`),      // import 'dep'
        new RegExp(`import\\s*\\(\\s*['"]${q}(?:/[^'"]*)?['"]`), // await import('dep')  ← tfjs
        new RegExp(`require\\s*\\(\\s*['"]${q}(?:/[^'"]*)?['"]`),
        new RegExp(`@import\\s+['"]${q}`),
    ];
    return patterns.some((p) => p.test(text));
}

const targets = [
    { label: 'الواجهة', pkg: 'package.json', dirs: ['src', 'api', 'shared', 'scripts', 'sw.js', 'index.html'] },
    { label: 'البوت', pkg: 'server/package.json', dirs: ['server'] },
];

const problems = [];
for (const t of targets) {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, t.pkg), 'utf8'));
    const text = scan(t.dirs);
    for (const dep of Object.keys(pkg.dependencies || {})) {
        if (INDIRECT[dep]) continue;
        if (!isUsed(dep, text)) {
            problems.push(`${t.label}: «${dep}» مثبَّتة ولا يستوردها أي ملف (${t.pkg}).`);
        }
    }
}

if (problems.length) {
    console.error('\n❌ البناء متوقّف: حزمٌ بلا استعمال\n');
    for (const p of problems) console.error('   • ' + p);
    console.error(`
   إمّا تُحذف (npm remove <اسمها>)، أو تُضاف إلى INDIRECT في هذا الملفّ بسببٍ مكتوب.
   🪤 وتحقّق أوّلاً من الاستيراد **الديناميكي**: @tensorflow/tfjs يُحمَّل بـ
      await import(...) وحذفُه يُسقط فلترة الصور بلا أن يُخطئ البناء.
`);
    process.exit(1);
}

console.log('✅ كل الحزم المثبَّتة مستعملة (الواجهة والبوت)');
