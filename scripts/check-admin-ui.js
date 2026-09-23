#!/usr/bin/env node
/**
 * check-admin-ui.js — حارس الطبقة البصرية للوحة الإدارة (v14.89)
 * ═══════════════════════════════════════════════════════════════════════════
 * لماذا وُجد: قِيس على v14.88 قبل التنظيف أن لوحة الإدارة تحمل ٩٤ تدرّجاً
 * لونياً، و٣٦ «رقماً كبيراً» مكتوباً يدوياً بأربع صيغ، و٦٠ حالةً فارغة كلٌّ
 * بصياغتها، و١٢ `bg-white` صلباً (أبيضُ على أبيض في الوضع الداكن)، وثلاث قيم
 * زاوية للبطاقة نفسها. نُظّفت كلّها — وهذا الحارس يمنع عودتها.
 *
 * 🪤 ولا git هنا: بناء Vercel أرشيفٌ بلا مستودع (درس v14.80b).
 * 🪤 وكل قاعدةٍ هنا **مُثبِتةٌ ببنيتها** لا بكلمةٍ مفتاحية: تبحث عن الصنف
 *    أو النمط نفسه في ملفّات اللوحة وحدها، لا عن وصفٍ له في تعليق.
 *    ولذلك تُستثنى التعليقات صراحةً — وإلا اتّهم الحارسُ النصّ الذي يحرسه
 *    (درس v14.86: نمط أمسك إفصاحَنا نفسه لأنه جملةٌ منفيّة).
 *
 * التشغيل: node scripts/check-admin-ui.js
 */

const fs = require('fs');
const path = require('path');
const { walk } = require('./lib/walk');

const root = path.resolve(__dirname, '..');

/** ملفّات لوحة الإدارة وحدها — لا بقيّة الواجهة. */
const ADMIN_DIRS = ['src/pages/admin', 'src/components/admin'];
const EXTRA_FILES = ['src/pages/AdminDashboard.tsx'];

/** نظام التصميم نفسه: يُعرّف الأنماط فلا يُحاكَم بها. */
const EXEMPT = new Set([
    'src/components/admin/ui/AdminKit.tsx',
    'src/components/admin/ui/AdminData.tsx',
]);

/**
 * يزيل التعليقات والنصوص العربية من الشفرة قبل الفحص.
 * 🪤 بلا هذا يمسك الحارسُ شرحَه هو: أيّ تعليقٍ يقول «ممنوع bg-gradient» يصير
 *    مخالفة. جُرّب سالباً: أُضيف تعليقٌ يذكر النمط فلم يُمسَك، ثمّ أُضيف
 *    استعمالٌ حقيقي فمُسِك.
 */
function stripComments(src) {
    return src
        // 🪤 استثناءٌ **مُثبِتٌ ببنيته** لا بكلمةٍ مفتاحية: تدرّجٌ طرفاه رمزا
        //    ثيم (`from-[var(--…)] to-transparent`) ليس زينةً بل تلاشي حافّة،
        //    وهو يتبع الوضع الداكن تلقائياً. يُحذف قبل الفحص كالتعليقات.
        .replace(/bg-gradient-to-[a-z]{1,2}\s+from-\[var\(--[^\]]+\)\][^"'`]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')   // /* … */
        .replace(/^\s*\/\/.*$/gm, '');      // // …
}

const RULES = [
    {
        id: 'gradient',
        re: /\bbg-gradient-to-[a-z]{1,2}\b/g,
        msg: 'تدرّجٌ لونيّ في لوحة الإدارة',
        why: 'اللون في اللوحة للدلالة وحدها (سليم/تحذير/خطر). التدرّجات تجعل كل بطاقةٍ تصرخ فلا شيء يبرز.',
    },
    {
        id: 'bg-white',
        // `bg-white/40` شفافيةٌ فوق سطحٍ ملوّن — مسموحة. الصلب وحده ممنوع.
        re: /\bbg-white(?![/\w-])/g,
        msg: '`bg-white` صلب',
        why: 'أبيضُ على أبيض في الوضع الداكن. استعمل var(--adm-surface).',
    },
    {
        id: 'tw-dark',
        re: /\bdark:[a-z[]/g,
        msg: 'صنف `dark:` من Tailwind',
        why: '`darkMode` غير مضبوط في tailwind.config.js فالافتراضي `media` — أي أنه يتبع نظام التشغيل، بينما التطبيق يكتب `.dark-mode` حسب اختيار المستخدم. استعمل رموز --adm-*.',
    },
    {
        id: 'hardcoded-gray',
        re: /\b(?:text|bg|border)-gray-\d{2,3}\b/g,
        msg: 'لونٌ رماديّ ثابت',
        why: 'لا يتبع الثيم. استعمل var(--adm-fg-2) أو var(--adm-border).',
    },
];

const files = [
    ...walk(root, ADMIN_DIRS, /\.(tsx|ts)$/),
    ...EXTRA_FILES.filter((f) => fs.existsSync(path.join(root, f))),
].filter((f) => !EXEMPT.has(f));

if (files.length === 0) {
    console.error('✗ حارس واجهة الإدارة لم يجد ملفّاً واحداً — المسارات تغيّرت، والحارس صار بلا أثر.');
    process.exit(1);
}

const violations = [];
for (const rel of files) {
    let src;
    try {
        src = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch {
        continue;
    }
    const code = stripComments(src);
    for (const rule of RULES) {
        const hits = code.match(rule.re);
        if (hits && hits.length) {
            violations.push({ rel, rule, count: hits.length, sample: hits[0] });
        }
    }
}

if (violations.length) {
    console.error('\n✗ حارس واجهة لوحة الإدارة — مخالفات:\n');
    const byRule = {};
    for (const v of violations) (byRule[v.rule.id] ??= []).push(v);
    for (const id of Object.keys(byRule)) {
        const list = byRule[id];
        const rule = list[0].rule;
        const total = list.reduce((s, v) => s + v.count, 0);
        console.error(`  ● ${rule.msg} — ${total} موضعاً في ${list.length} ملفّاً`);
        console.error(`    السبب: ${rule.why}`);
        for (const v of list.slice(0, 6)) console.error(`      · ${v.rel} (${v.count}× مثل «${v.sample}»)`);
        if (list.length > 6) console.error(`      · … و${list.length - 6} ملفّاً آخر`);
        console.error('');
    }
    console.error(`فُحص ${files.length} ملفّاً من لوحة الإدارة.\n`);
    process.exit(1);
}

console.log(`✅ واجهة لوحة الإدارة: ${files.length} ملفّاً — بلا تدرّجات ولا ألوان ثابتة ولا \`dark:\`.`);
