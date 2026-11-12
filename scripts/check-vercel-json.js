#!/usr/bin/env node
/**
 * check-vercel-json.js — `vercel.json` يُرفض بمفتاحٍ واحدٍ لا تعرفه Vercel.
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 العيبُ الذي وُلد منه (١٢ نوفمبر ٢٠٢٦): أضفتُ `"_comment"` داخل كائن
 *    `rewrites` لشرح قاعدةٍ جديدة. البناءُ المحلّيّ **أخضر** (JSON سليم،
 *    `npm run build` ينجح، كلُّ الحرّاس تمرّ) — و**Vercel أسقطت النشرة**:
 *      The `vercel.json` schema validation failed:
 *      `rewrites[1]` should NOT have additional property `_comment`
 *    فالتحقّقُ يقع على خوادمهم **قبل** البناء، فلا سجلَّ بناءٍ يُقرأ ولا
 *    رسالةَ خطأ محليّة. وهو امتدادٌ مباشرٌ لدرس v14.86: «بناءٌ محلّيٌّ أخضر
 *    ليس دليلاً على بناء Vercel».
 *
 * 🪤 والتعليقُ في `vercel.json` **مستحيلٌ أصلاً** — لا JSONC ولا مفتاحَ شرح.
 *    الشرحُ مكانُه رسالةُ الكوميت وهذا الملفّ، لا الإعداد.
 *
 * ما يفحصه: أن كلّ كائنٍ في `redirects`/`rewrites`/`headers` لا يحمل إلّا
 * المفاتيحَ التي تقبلها Vercel. قائمةُ **سماحٍ** لا منع (درس v14.57: المنعُ
 * يفشل مفتوحاً — مفتاحٌ جديدٌ مخترَع يمرّ).
 */
const fs = require('fs');
const path = require('path');

const P = path.join(__dirname, '..', 'vercel.json');
const ALLOWED = {
    redirects: new Set(['source', 'destination', 'permanent', 'statusCode', 'has', 'missing']),
    rewrites:  new Set(['source', 'destination', 'has', 'missing']),
    headers:   new Set(['source', 'headers', 'has', 'missing']),
};
const HEADER_ITEM = new Set(['key', 'value']);

let cfg;
try {
    cfg = JSON.parse(fs.readFileSync(P, 'utf8'));
} catch (e) {
    console.error('❌ vercel.json ليس JSON سليماً: ' + e.message);
    process.exit(1);
}

const bad = [];
for (const section of Object.keys(ALLOWED)) {
    const list = cfg[section];
    if (list === undefined) continue;
    if (!Array.isArray(list)) { bad.push(`${section} ليست مصفوفة`); continue; }
    list.forEach((item, i) => {
        if (!item || typeof item !== 'object') { bad.push(`${section}[${i}] ليس كائناً`); return; }
        for (const k of Object.keys(item)) {
            if (!ALLOWED[section].has(k)) {
                bad.push(`${section}[${i}] فيه مفتاحٌ لا تقبله Vercel: «${k}»`);
            }
        }
        if (section === 'headers' && Array.isArray(item.headers)) {
            item.headers.forEach((h, j) => {
                for (const k of Object.keys(h || {})) {
                    if (!HEADER_ITEM.has(k)) bad.push(`headers[${i}].headers[${j}] فيه «${k}»`);
                }
            });
        }
    });
}

// 🪤 وأيُّ مفتاحٍ جذريٍّ مخترَع يُسقط النشرة كذلك.
const ROOT_OK = new Set([
    '$schema', 'redirects', 'rewrites', 'headers', 'cleanUrls', 'trailingSlash',
    'buildCommand', 'outputDirectory', 'installCommand', 'devCommand', 'framework',
    'functions', 'crons', 'regions', 'images', 'public', 'github', 'git', 'ignoreCommand', 'routes',
]);
for (const k of Object.keys(cfg)) {
    if (!ROOT_OK.has(k)) bad.push(`مفتاحٌ جذريٌّ غيرُ معروف: «${k}»`);
}

if (bad.length) {
    console.error('❌ vercel.json سيُرفض من Vercel قبل أن يبدأ البناء:');
    for (const b of bad) console.error('   · ' + b);
    console.error('   (ولا تعليقات في vercel.json — الشرحُ في رسالة الكوميت.)');
    process.exit(1);
}

const n = ['redirects', 'rewrites', 'headers'].reduce((a, s) => a + (cfg[s] || []).length, 0);
console.log(`✅ vercel.json: ${n} قاعدةً، صفرُ مفتاحٍ ترفضه Vercel`);
