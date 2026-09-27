#!/usr/bin/env node
/**
 * check-order-code.js — رقم الطلب يُولَّد في مكانين، ولا يُسمح لهما أن ينحرفا (v14.98)
 * ═══════════════════════════════════════════════════════════════════════════
 * النسختان ضرورتان لا إهمال:
 *   • `src/utils/helpers.ts::generateBarcode` — المتصفّح. يولّد الرمز **قبل**
 *     ردّ الخادم ويعرضه للمشتري فوراً (واجهةٌ تفاؤلية)، فلا يستطيع انتظار
 *     جولةِ شبكة ليسأل القاعدة رقماً.
 *   • `public.taki_new_order_code()` — القاعدة. يمرّ بها البوتان عبر
 *     `_bot_gen_barcode()`، وهي وحدها التي تتحقّق من التفرّد.
 *
 * 🔴 والانحرافُ هنا لا يصرخ: مولّدٌ في الموقع طولُه ٨ ومشغّلٌ في القاعدة يقبل
 *    ٦ فأكثر ⇒ يمرّ كلُّ شيء أخضرَ، ويبقى «رقم الطلب» رقمين مختلفي الطول بين
 *    القناتين إلى الأبد. ولذلك يُقاس التطابق هنا، لا يُفترض.
 *
 * 🪤 ولا يصل هذا الحارس إلى القاعدة (يُشغَّل في سلسلة بناء Vercel)، فيقيس
 *    **نصّ ملفّ الهجرة** مقابل **مصدر TypeScript**. أمّا تطابقُ الهجرة مع
 *    الخادم الحيّ فتثبته كتلةُ `DO` داخل الهجرة نفسها (ترفع استثناءً).
 *
 * 🪤 ولا يفترض git ولا `dist` — Vercel تبني من أرشيفٍ بلا `.git`.
 */

const fs = require('fs');
const path = require('path');
const { walk } = require('./lib/walk');

const root = path.resolve(__dirname, '..');
const fail = (m) => { console.error(`\n❌ البناء متوقّف: رقم الطلب\n\n   ${m}\n`); process.exit(1); };
const read = (rel) => {
    try { return fs.readFileSync(path.join(root, rel), 'utf8'); }
    catch (e) { fail(`تعذّرت قراءة ${rel} — ${e.message}`); }
};

const SQL_REL = 'supabase/JEDDAH_v14_98_numeric_order_code.sql';
const TS_REL = 'src/utils/helpers.ts';
const BOT_REL = 'server/bot.js';

const sql = read(SQL_REL);
const ts = read(TS_REL);
const bot = read(BOT_REL);

// ── ١) الطول: معلَنٌ في الملفّين، ويجب أن يتطابق ───────────────────────────
const sqlLenM = sql.match(/--\s*TAKI_ORDER_CODE_LEN\s*=\s*(\d+)/);
if (!sqlLenM) fail(`لم أجد السطر «-- TAKI_ORDER_CODE_LEN = N» في ${SQL_REL}.`);
const sqlLen = Number(sqlLenM[1]);

const tsLenM = ts.match(/export const ORDER_CODE_LEN\s*=\s*(\d+)\s*;/);
if (!tsLenM) fail(`لم أجد «export const ORDER_CODE_LEN = N;» في ${TS_REL}.`);
const tsLen = Number(tsLenM[1]);

if (sqlLen !== tsLen) {
    fail(`طولُ رقم الطلب مختلف:\n     القاعدة (${SQL_REL}) : ${sqlLen}\n     الموقع  (${TS_REL}) : ${tsLen}`);
}
const LEN = sqlLen;

// والثابتُ داخل دالّة القاعدة نفسه لا التعليق وحده — تعليقٌ يكذب أسهلُ من كود.
const sqlConstM = sql.match(/v_len\s+CONSTANT\s+int\s*:=\s*(\d+)\s*;/);
if (!sqlConstM) fail(`لم أجد «v_len CONSTANT int := N;» داخل taki_new_order_code في ${SQL_REL}.`);
if (Number(sqlConstM[1]) !== LEN) {
    fail(`تعليقُ الهجرة يقول ${LEN} وثابتُ الدالّة يقول ${sqlConstM[1]} — أحدهما يكذب.`);
}
if (!new RegExp(`substr\\(\\s*v_pool\\s*,\\s*1\\s*,\\s*v_len\\s*\\)`).test(sql)) {
    fail(`دالّةُ القاعدة لا تقتطع بـ«substr(v_pool, 1, v_len)» — الطولُ المعلَن غير مستعمَل.`);
}

// ── ٢) 🪤 سقفُ تيليجرام: ١٢ خانة، مقروءاً من الكود لا من الذاكرة ───────────
// زرّان يتقاسمان بادئة `cd:` في البوت: أحدهما لطابع الوقت `\d{13,}` والآخر
// للرمز `[A-Za-z0-9]{min,max}`. رمزٌ أطولُ من max يذهب إلى المعالج الخطأ
// **بصمت** (العدّاد يظنّه طابعَ وقت). هذا الحدّ عقدٌ حقيقيّ، فيُقرأ من الملفّ.
const cdM = bot.match(/\^cd:\(\[A-Za-z0-9\]\{(\d+),(\d+)\}\)\$/);
if (!cdM) fail(`لم أجد نمط زرّ العدّاد «^cd:([A-Za-z0-9]{min,max})$» في ${BOT_REL} — لا أستطيع قياس السقف.`);
const [cdMin, cdMax] = [Number(cdM[1]), Number(cdM[2])];
if (LEN < cdMin || LEN > cdMax) {
    fail(`طول رقم الطلب ${LEN} خارج مدى زرّ العدّاد في البوت [${cdMin}، ${cdMax}].\n`
        + `     رمزٌ خارج المدى لا يُرفض — يُلتقط بالنمط الخطأ فيسقط العدّاد بصمت.`);
}
const epochM = bot.match(/\^cd:\(\\d\{(\d+),\}\)\$/);
if (!epochM) fail(`لم أجد نمط طابع الوقت «^cd:(\\d{N,})$» في ${BOT_REL}.`);
if (LEN >= Number(epochM[1])) {
    fail(`طول رقم الطلب ${LEN} يبلغ حدّ طابع الوقت (${epochM[1]}) — النمطان صارا يتقاطعان.`);
}

// ── ٣) شكلُ القاعدة: أرقامٌ فقط · بلا صفرٍ بادئ · والمشغّل على الإدراج وحده ──
if (!/regexp_replace\(\s*gen_random_uuid\(\)::text\s*,\s*'\[\^0-9\]'/.test(sql)) {
    fail('دالّةُ القاعدة لا ترشّح غير الأرقام — قد تُخرج حروفاً.');
}
if (!/ltrim\([\s\S]{0,300}?,\s*'0'\s*\)/.test(sql)) {
    fail('دالّةُ القاعدة لا تحذف الصفر البادئ (`ltrim(… , \'0\')`).');
}
if (!/NEW\.barcode\s*!~\s*'\^\[1-9\]\[0-9\]\{5,\}\$'/.test(sql)) {
    fail('مشغّلُ الحارس لا يفحص «^[1-9][0-9]{5,}$» — أرقامٌ فقط بلا صفرٍ بادئ.');
}
// وكتلةُ التحقّق داخل الهجرة تقيس الشكلَ بنمطٍ مكتوبٍ فيها — وهو موضعٌ ثالثٌ
// يستطيع أن ينحرف عن الطول. (ولو انحرف لمرّت الهجرة خضراءَ وهي تقيس طولاً آخر.)
const verifyShapes = [...sql.matchAll(/'\^\[1-9\]\[0-9\]\{(\d+)\}\$'/g)].map(m => Number(m[1]));
if (!verifyShapes.length) fail(`لم أجد نمطَ التحقّق «'^[1-9][0-9]{N}$'» داخل كتلة DO في ${SQL_REL}.`);
for (const got of verifyShapes) {
    if (got !== LEN - 1) {
        fail(`كتلةُ التحقّق في الهجرة تقيس طولاً ${got + 1} والطول المعلَن ${LEN} — الهجرةُ تُصدّق نفسها على عقدٍ آخر.`);
    }
}

const trigM = sql.match(/CREATE TRIGGER\s+tr_a0_order_code_numeric\s+([\s\S]*?)ON public\.bookings/);
if (!trigM) fail('لم أجد «CREATE TRIGGER tr_a0_order_code_numeric … ON public.bookings» في الهجرة.');
if (!/BEFORE\s+INSERT\s*$/.test(trigM[1].trim())) {
    fail(`المشغّل ليس «BEFORE INSERT» وحده بل «${trigM[1].trim()}».\n`
        + `     لو مسّ UPDATE لسقط كلُّ تعديلٍ على طلبٍ قديمٍ برمزٍ فيه حرف.`);
}

// ── ٤) التوأمُ مُسمّى في مصدر الموقع ────────────────────────────────────────
if (!ts.includes('taki_new_order_code')) {
    fail(`${TS_REL} لا يُسمّي توأمَه في القاعدة (taki_new_order_code) — من يقرأ الدالّة لن يعرف أن لها نسخةً ثانية.`);
}
if (!/tr_a0_order_code_numeric/.test(ts)) {
    fail(`${TS_REL} لا يذكر أنّ السلطة الحقيقية هي مشغّل القاعدة tr_a0_order_code_numeric.`);
}

// ── ٥) 🔴 القياس الحاسم: تُنفَّذ دالّةُ الموقع فعلاً، لا تُقرأ فقط ───────────
// (لا مُجمِّع TypeScript هنا، فيُنزع التوصيفُ نصّياً ثمّ يُتحقّق من وقوع النزع —
//  «استبدالٌ لم يقع» يبدو نجاحاً، وهو الفخّ الذي أسقط حارساً قبله.)
const fnM = ts.match(/export const generateBarcode\s*=\s*([\s\S]*?\n\};)/);
if (!fnM) fail(`لم أجد generateBarcode في ${TS_REL}.`);
let src = fnM[1].replace(/;\s*$/, '');
const stripped = src.replace(
    /\(\s*length\s*:\s*number\s*=\s*ORDER_CODE_LEN\s*\)\s*:\s*string\s*=>/,
    `(length = ${LEN}) =>`
);
if (stripped === src) {
    fail(`تعذّر نزعُ توصيف TypeScript من generateBarcode — توقيعُها تغيّر، فلم أقِس شيئاً.\n     المتوقَّع: «(length: number = ORDER_CODE_LEN): string =>».`);
}
src = stripped;
if (/:\s*(string|number|boolean)\b/.test(src)) {
    fail(`بقي توصيفُ نوعٍ في generateBarcode بعد النزع — لا أستطيع تنفيذها بأمان.`);
}

let gen;
try {
    // تنفيذُ نصّ المصدر نفسه هو المقصود: حارسٌ يقرأ ولا ينفّذ يُصدّق ما يقرأ.
    gen = eval(`(${src})`);
} catch (e) {
    fail(`تعذّر تنفيذ generateBarcode بعد نزع التوصيف — ${e.message}`);
}
if (typeof gen !== 'function') fail('generateBarcode ليست دالّة بعد الاستخراج.');

const SHAPE = new RegExp(`^[1-9][0-9]{${LEN - 1}}$`);
const RUNS = 5000;
const seen = new Set();
for (let i = 0; i < RUNS; i++) {
    let code;
    try { code = gen(); } catch (e) { fail(`generateBarcode انفجرت عند النداء ${i + 1} — ${e.message}`); }
    if (typeof code !== 'string') fail(`generateBarcode أعادت ${typeof code} لا نصّاً.`);
    if (code.length !== LEN) fail(`generateBarcode أعادت «${code}» بطول ${code.length} والمعلَن ${LEN}.`);
    if (!SHAPE.test(code)) {
        const why = /[^0-9]/.test(code) ? 'فيه محرفٌ ليس رقماً' : 'يبدأ بصفر (يضيع في أيّ حقلٍ رقميّ)';
        fail(`generateBarcode أعادت «${code}» — ${why}.`);
    }
    seen.add(code);
}
// وعشوائيّةٌ فعليّة: ٥٠٠٠ نداءٍ من فضاءٍ ٩×١٠⁹ لا يجوز أن تُكرّر إلا نادراً.
if (seen.size < RUNS * 0.99) {
    fail(`${RUNS} نداءً أعطت ${seen.size} رمزاً متمايزاً فقط — المولّد شبه ثابت.`);
}
// وكلُّ خانةٍ يجب أن تتنوّع: مولّدٌ يثبّت خانةً يمرّ من كلّ ما سبق.
for (let pos = 0; pos < LEN; pos++) {
    const distinct = new Set([...seen].map(c => c[pos]));
    if (distinct.size < (pos === 0 ? 8 : 9)) {
        fail(`الخانة رقم ${pos + 1} أخذت ${distinct.size} قيمةً فقط في ${RUNS} نداءً — المولّد منحاز.`);
    }
}

// ── ٦) ولا أبجديّةَ حروفٍ باقية في المولّد ──────────────────────────────────
if (/ABCDEFGHJ/.test(ts)) {
    fail(`ما زالت أبجديّةُ الحروف القديمة (ABCDEFGHJ…) في ${TS_REL} — رقم الطلب يجب أن يكون أرقاماً فقط.`);
}

// ── ٧) ولا منادٍ يفرض طولاً آخر ─────────────────────────────────────────────
// 🪤 `generateBarcode(8)` يمرّ من TypeScript ومن كلّ ما سبق، ويُنتج رقمَ طلبٍ
//    بطولٍ يخالف القاعدة. المنادي يمرّر لا شيء، أو ORDER_CODE_LEN صراحةً.
const files = walk(root, ['src', 'server', 'shared', 'api'], /\.(ts|tsx|js|jsx)$/);
const offenders = [];
for (const rel of files) {
    if (rel === TS_REL) continue;
    let txt;
    try { txt = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
    if (!txt.includes('generateBarcode')) continue;
    for (const m of txt.matchAll(/generateBarcode\s*\(\s*([^)]*?)\s*\)/g)) {
        const arg = m[1].trim();
        if (arg === '' || arg === 'ORDER_CODE_LEN') continue;
        const line = txt.slice(0, m.index).split('\n').length;
        offenders.push(`${rel}:${line} → generateBarcode(${arg})`);
    }
}
if (offenders.length) {
    fail('منادٍ يفرض طولاً لرقم الطلب بدل الطول الموحَّد:\n     '
        + offenders.join('\n     ')
        + `\n\n     الصواب: generateBarcode()  ← بلا وسيط (الطول ${LEN} من ORDER_CODE_LEN).`);
}

console.log(`✅ رقم الطلب: ${LEN} أرقام في الموقع والقاعدة معاً · ${RUNS} توليدةً بلا حرفٍ ولا صفرٍ بادئ · داخل مدى زرّ البوت [${cdMin}،${cdMax}] · لا منادٍ يفرض طولاً`);
