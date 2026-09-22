#!/usr/bin/env node
/**
 * check-file-size.js — سقّافة لا تتراخى (ratchet) (v14.84)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 الخطر، وقد وقع فعلاً: أربعة ملفّات تجاوزت حدّ الصيانة الآمنة —
 *    `SellerDashboard.tsx` ٥٧٥٨ سطراً · `bot.js` ٤١٧٣ · `AppContext.tsx` ٤٠٤٨
 *    · `DealDetails.tsx` ٣٨٤٥. وملفٌّ لا يُقرأ في جلسة واحدة يصير التعديل فيه
 *    تخميناً، **وهو أعلى مصدرٍ لكسر ميزةٍ أثناء إصلاح أخرى** — وقد كسرنا فعلاً.
 *
 * ولماذا «سقّافة» لا «حدّ واحد»: فرضُ حدٍّ صارم اليوم يعني تقسيم أربعة ملفّات
 * ضخمة دفعةً واحدة — وهو بالضبط نوعُ التغيير الذي يكسر ما لا يُقاس. فالحلّ
 * وسطٌ أمين:
 *   • كل ملفٍّ **جديد** محكومٌ بالحدّ العام فوراً.
 *   • والملفّات الضخمة القائمة مُعلَنةٌ هنا برقمها اليوم، و**لا يُسمح لها
 *     بالنموّ سطراً واحداً**. تنكمش فيُخفَّض رقمها، ولا تكبر أبداً.
 * أي أن الدَّين مُعلَنٌ ومحدود ومُتّجهٌ إلى النقصان، لا مخفيٌّ ومفتوح.
 *
 * 🪤 ولا git هنا: بناء Vercel أرشيفٌ بلا مستودع (درس v14.80b).
 *
 * التحديث بعد تقليصٍ حقيقي:  node scripts/check-file-size.js --update
 */

const fs = require('fs');
const path = require('path');
const { walk } = require('./lib/walk');

const root = path.resolve(__dirname, '..');
const LEDGER = path.join(__dirname, 'file-size-ledger.json');

/** الحدّ العام لأي ملفّ جديد. */
const LIMIT = 1500;

const DIRS = ['src', 'server', 'shared', 'api', 'scripts'];
const EXT = /\.(ts|tsx|js|jsx)$/;
const SKIP = /node_modules|i18n-data\.json/;

const files = walk(root, DIRS, EXT).filter((f) => !SKIP.test(f));

const sizes = {};
for (const f of files) {
    try {
        sizes[f] = fs.readFileSync(path.join(root, f), 'utf8').split('\n').length;
    } catch { /* ملفّ اختفى بين المسح والقراءة */ }
}

const update = process.argv.includes('--update');
let ledger = {};
try { ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { /* أوّل تشغيل */ }

if (update) {
    const next = {};
    for (const [f, n] of Object.entries(sizes)) {
        if (n > LIMIT) next[f] = n;                 // يُسجَّل برقمه الحالي
    }
    fs.writeFileSync(LEDGER, JSON.stringify(next, null, 2) + '\n');
    console.log(`✅ سُجّل ${Object.keys(next).length} ملفّاً متجاوزاً بأرقامها الحالية`);
    process.exit(0);
}

const problems = [];
for (const [f, n] of Object.entries(sizes)) {
    const allowed = ledger[f];
    if (allowed === undefined) {
        // ملفّ غير مُعلَن: الحدّ العام يسري فوراً.
        if (n > LIMIT) {
            problems.push(
                `«${f}» = ${n} سطراً ويتجاوز الحدّ ${LIMIT}.\n` +
                '     يُقسَّم، أو — إن كان تقسيمه الآن أخطرَ من بقائه — يُسجَّل عمداً\n' +
                '     بـ`node scripts/check-file-size.js --update` مع ذكر السبب في الكوميت.'
            );
        }
    } else if (n > allowed) {
        problems.push(
            `«${f}» نما من ${allowed} إلى ${n} سطراً.\n` +
            '     هذا ملفٌّ مُعلَنٌ ضخماً أصلاً، والسقّافة تمنع نموّه: أضف الجديد في\n' +
            '     ملفٍّ منفصل، أو قلّصه أوّلاً ثم حدّث السجلّ.'
        );
    }
}

if (problems.length) {
    console.error('\n❌ البناء متوقّف: حجم الملفّات\n');
    for (const p of problems) console.error('   • ' + p);
    console.error('');
    process.exit(1);
}

const declared = Object.keys(ledger).length;
const shrunk = Object.entries(ledger).filter(([f, n]) => sizes[f] !== undefined && sizes[f] < n);
console.log(`✅ حجم الملفّات: ${declared} ملفّاً ضخماً مُعلَناً، لا نموّ${shrunk.length ? ` · ${shrunk.length} انكمش` : ''}`);
if (shrunk.length) {
    for (const [f, n] of shrunk) console.log(`   ↓ ${f}: ${n} ⇐ ${sizes[f]} (حدّث السجلّ بـ--update)`);
}
