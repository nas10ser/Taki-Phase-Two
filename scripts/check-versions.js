#!/usr/bin/env node
/**
 * check-versions.js — أرقام الإصدار لا تتجمّد بعد اليوم (v14.77)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 الثغرة، مقيسة لا مفترضة: `package.json` كان يقول **7.2.0** و
 * `server/package.json` يقول **7.0.0** بينما المنصّة على `v14.76` والبوت على
 * `14.75.0`. رقمٌ متجمّد على بُعد سبع إصداراتٍ كاملة ليس نقصَ تجميل: من يفتح
 * المستودع أوّل مرّة يصدّقه، ويستنتج أن ما أمامه نسخةٌ قديمة أو فرعٌ مهجور.
 *
 * ولماذا تجمّد أصلاً: **لا شيء كان يقرؤه ولا شيء يفحصه.** لا الكود ولا البناء
 * ولا النشر. وما لا يُقرأ ولا يُفحص يتعفّن بصمت — فالعلاج ليس «أن أتذكّر»، بل
 * أن يُفشل البناءَ حين يختلف.
 *
 * مصادر الحقيقة (لا تُكتب الأرقام هنا إطلاقاً):
 *   • الموقع  → `CACHE_NAME` في `sw.js` — وهو مرفوعٌ مع كل نشرٍ بحكم قاعدةٍ
 *     قائمة يحرسها `check-cache-bump.js`، فهو الرقم الحيّ فعلاً.
 *   • البوت   → `BOT_VERSION` في `server/bot.js` — وهو ما يُبلّغه البوت عن
 *     نفسه في `/health` وفي `bot_report_gate`.
 *
 * 🪤 والمقارنة على `<كبير>.<صغير>` وحدها: إصداراتٌ مثل `v14.75b` لا تظهر في
 *    `CACHE_NAME` (لا مكان لحرفٍ فيه)، فاشتراطُ تطابقٍ تامّ كان سيُفشل البناء
 *    على فرقٍ لا وجود له في المصدر أصلاً. الجزء الثالث حرّ.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const problems = [];

// ── الموقع ──────────────────────────────────────────────────────────────────
const sw = read('sw.js');
const mCache = /CACHE_NAME\s*=\s*['"]taki-cache-v(\d+)\.(\d+)['"]/.exec(sw);
if (!mCache) {
    problems.push('sw.js — تعذّر قراءة CACHE_NAME بصيغة `taki-cache-vXX.YY`');
} else {
    const want = `${mCache[1]}.${mCache[2]}`;
    const web = JSON.parse(read('package.json')).version || '';
    if (!new RegExp(`^${want}\\.\\d+$`).test(web)) {
        problems.push(
            `package.json version = «${web}» ولا يطابق CACHE_NAME (${want}).\n` +
            `     الإصلاح: اجعلها «${want}.0» — أو ارفع CACHE_NAME إن كان هو المتخلّف.`
        );
    }
}

// ── البوت ───────────────────────────────────────────────────────────────────
const bot = read('server/bot.js');
const mBot = /BOT_VERSION\s*=\s*['"]([0-9]+\.[0-9]+\.[0-9]+)['"]/.exec(bot);
if (!mBot) {
    problems.push('server/bot.js — تعذّر قراءة BOT_VERSION');
} else {
    const srv = JSON.parse(read('server/package.json')).version || '';
    if (srv !== mBot[1]) {
        problems.push(
            `server/package.json version = «${srv}» ولا يطابق BOT_VERSION (${mBot[1]}).\n` +
            `     الإصلاح: اجعلها «${mBot[1]}» — البوت يُبلّغ هذا الرقم عن نفسه في /health.`
        );
    }
}

if (problems.length) {
    console.error('\n❌ البناء متوقّف: أرقام الإصدار متخلّفة عن مصدرها\n');
    for (const p of problems) console.error('   • ' + p);
    console.error(`
   لماذا يوقف البناء: هذان الرقمان تجمّدا على 7.x بينما المنصّة على 14.x،
   لأن لا شيء كان يقرؤهما ولا يفحصهما. الفحص هو ما يمنع تجمّدهما ثانيةً.
`);
    process.exit(1);
}

console.log('✅ أرقام الإصدار مطابقة لمصدرها (sw.js · server/bot.js)');
