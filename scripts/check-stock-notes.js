#!/usr/bin/env node
/**
 * check-stock-notes.js — كلُّ وسمِ حالةٍ تكتبه القاعدة له نصٌّ في الشاشة (v15.20)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 الدرسُ الذي وُلد منه: تدقيقٌ خصوميٌّ قاس أنّ القاعدة تكتب أكثرَ من عشرين
 *    وسمَ حالةٍ في `stock_integrations.last_note`، والشاشةُ تعرف ثلاثةً.
 *    فخمسةٌ من ثمانية أوسمةٍ كانت تُصيَّر «رسالةٌ وصلت» بلا تفسير — ومتجرُ
 *    زدٍّ لا يُزامن شيئاً يبدو مُزامَناً.
 *    وهو نفسُ انحراف `notifications_type_check` (يسمح بستّة والكودُ يكتب تسعة).
 *
 * 🪤 ولا يسأل قاعدةً: بناءُ Vercel أرشيفٌ بلا شبكةٍ ولا `.git` (درسان مدفوعان).
 *    فالمصدرُ ملفّاتُ الهجرة في المستودع — وهي ما يُطبَّق فعلاً.
 * 🪤 ويُستثنى ما ليس وسماً: `CASE WHEN … THEN 'OK'` داخل تعبيرٍ مُركَّب يُلتقط
 *    بنفس النمط، ولذلك يُقرأ **كلُّ** نصٍّ حرفيٍّ مُسنَدٍ إلى `last_note` أو
 *    مُرجَعٍ في `'reason'` ثمّ يُرشَّح بما يُشبه الوسمَ (حروفٌ كبيرةٌ وشُرَط سفلية).
 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

const sqlDir = path.join(root, 'supabase');
// 🪤 مقصورٌ على ملفّات المخزون: أوّلُ صياغةٍ مسحت `supabase/*.sql` كلَّها
//    فالتقطت `'reason','BAD_ETA'` من دوالّ التوصيل و`GATEWAY_REQUIRED` من
//    الدفع — **فصرخ الحارسُ كذباً**. وقاعدةُ المشروع: قاعدةٌ تصرخ كذباً أسوأ
//    من غيابها (أُسقطت قاعدتا مدقّقٍ بعد قياسٍ لنفس السبب).
const files = fs.readdirSync(sqlDir)
    .filter(f => f.endsWith('.sql') && /stock|integration|webhook|oauth|parent_zero|provider|renew|silent|truth/i.test(f));

const written = new Set();
const LITERAL = /[A-Z][A-Z0-9_]{2,}/;
for (const f of files) {
    const src = fs.readFileSync(path.join(sqlDir, f), 'utf8');
    // last_note = 'X'  ·  last_note = ''X''  (داخل رقعةٍ مُهرَّبة)
    for (const m of src.matchAll(/last_note\s*=\s*'{1,2}([^']+)'{1,2}/g)) {
        if (LITERAL.test(m[1])) written.add(m[1]);
    }
}
// وأسبابُ الطابور — جوابُ «لماذا لم يتحرّك رقمي»
const qReasons = new Set();
const DYNAMIC = /^(HTTP_|NET:|DISPATCH:)/;
for (const f of files) {
    const src = fs.readFileSync(path.join(sqlDir, f), 'utf8');
    for (const m of src.matchAll(/last_error\s*=\s*'{1,2}([^'|]+)'{1,2}/g)) {
        const v = m[1].trim();
        if (LITERAL.test(v) && !DYNAMIC.test(v) && !v.includes('(')) qReasons.add(v);
    }
    for (const m of src.matchAll(/'{1,2}reason'{1,2}\s*,\s*'{1,2}([A-Z][A-Z0-9_]+)'{1,2}/g)) {
        qReasons.add(m[1]);
    }
    // 🪤 وثلاثةُ أشكالٍ أخرى يكتب بها نفسُ الحقل، وبلا مسحها يصرخ الحارسُ
    //    «نصٌّ بلا كاتب» على سبعةَ عشرَ وسماً **تُكتب فعلاً** — وتحذيرٌ ضجيجيٌّ
    //    يُدرّب على تجاهل الحارس:
    //      to_jsonb('X')  ·  THEN 'X'  ·  ELSE 'X'   (داخل CASE أو مصفوفة أسباب)
    for (const m of src.matchAll(/to_jsonb\(\s*'{1,2}([A-Z][A-Z0-9_]+)'{1,2}/g)) qReasons.add(m[1]);
    for (const m of src.matchAll(/\b(?:THEN|ELSE)\s+'{1,2}([A-Z][A-Z0-9_]{2,})'{1,2}/g)) qReasons.add(m[1]);
}

const ui = fs.readFileSync(path.join(root, 'src/data/stockNotes.ts'), 'utf8');
const known = new Set();
for (const m of ui.matchAll(/^\s{4}([A-Z][A-Z0-9_]+):\s*\{/gm)) known.add(m[1]);

// أوسمةٌ تُكتب ثمّ تُقرأ آليّاً ولا تُعرض نصّاً للتاجر
const INTERNAL = new Set(['NO_READ_DESCRIPTOR']);

const missing = [...written, ...qReasons].filter(w => !known.has(w) && !INTERNAL.has(w)).sort();
const stale = [...known].filter(k => !written.has(k) && !qReasons.has(k)).sort();

if (missing.length) {
    console.error('❌ أوسمةُ حالةٍ تكتبها القاعدة ولا نصَّ لها في الشاشة:');
    for (const m of missing) console.error('   · ' + m);
    console.error('   أضِفها في src/data/stockNotes.ts — وسمٌ بلا نصٍّ يُصيَّر «رسالةٌ وصلت» بلا تفسير.');
    process.exit(1);
}
if (stale.length) {
    // 🪤 تحذيرٌ لا فشل: وسمٌ في الشاشة بلا كاتبٍ في الهجرات ليس خطراً —
    //    قد يكون وسمَ نسخةٍ قديمةٍ ما زال في قاعدةٍ حيّة.
    console.warn('⚠️  نصوصٌ في الشاشة لا كاتبَ لها في الهجرات (تُترك): ' + stale.join(', '));
}
console.log(`✅ أوسمةُ المخزون: ${written.size} وسمَ حالةٍ و${qReasons.size} سببَ طابورٍ تكتبها القاعدة — كلُّها مشروحةٌ للتاجر`);
