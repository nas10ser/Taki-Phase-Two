#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TAKI · حارسُ رابط الخريطة — لا يُفتح رابطٌ يكتبه تاجرٌ بلا بوّابة
 *
 * 🔴 ما يحرسه (قِيس ٨ نوفمبر ٢٠٢٦ على الكود الحيّ):
 *   `deals.google_maps_link` و`users.google_maps_link` و`store_branches.google_maps_link`
 *   **يكتبها التاجر**، وكان `src/pages/DealDetails.tsx` يفتحها كما هي حرفياً في
 *   زرّ «الاتجاهات». فمتجرٌ واحدٌ خبيث يُحوّل كلَّ من يضغط الزرَّ إلى أيّ عنوانٍ
 *   شاء — وصل إليه من صفحةٍ على `takisa.net` فيثق بها. وهذا تحويلٌ غيرُ
 *   مُتحقَّقٍ منه (open redirect) على سطحٍ موثوق، لا مجرّد رابطٍ خاطئ.
 *
 * 🪤 ولا يكفي أن يكون المضيفُ تحت `google.com`:
 *     • `sites.google.com` يستضيف صفحةَ المهاجم **نفسها** بلا أيّ وسيط.
 *     • `www.google.com/url?q=…` محوّلٌ مفتوح.
 *   ولذلك القاعدةُ في `isMapUrl` تطلب مساراً `/maps` لمضيفات قوقل العامّة،
 *   وتقبل أيَّ مسارٍ على مضيفات الخرائط وحدها.
 *
 * 🪤 ولاحقةُ نقطةٍ لازمة: `endsWith('google.com')` يقبل `evil-google.com`،
 *   وهو بعينه الفخُّ الذي كلّف v14.71 (`https://evil-takisa.net/`).
 *
 * ولماذا حارسٌ لا تعليقٌ: القاعدةُ في موضعٍ واحد، والشاشاتُ التي تعرض متجراً
 * خمسٌ ويزيدن. أوّلُ شاشةٍ جديدة تكتب `openExternalUrl(link)` تُعيد الثغرةَ
 * بلا أن يلاحظ أحد — فهذا الفحصُ هو ما يلاحظ.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { walk } = require('./lib/walk');   // 🪤 لا git: Vercel تبني من أرشيف

const ROOT = path.resolve(__dirname, '..');
const SELF = path.relative(ROOT, __filename);
const GATE_FILE = 'src/utils/mapLinks.ts';
const BOT_GATE_FILE = 'server/lib/geo.js';

/** تُجرَّد التعليقاتُ قبل أيّ فحصٍ نصّيّ — الحارسُ أمسك تعليقَه سبعَ مرّاتٍ قبل اليوم. */
function strip(src) {
    return src
        .replace(/(^[ \t]*|\{)\/\*[\s\S]*?\*\//gm, '$1')
        // سطرٌ كاملٌ تعليق، أو ذيلٌ لا يسبقه ':' (فلا يُقطع `https://…`) وبلا علامات اقتباس
        .replace(/^[ \t]*\/\/[^\n]*/gm, '')
        .replace(/([^:'"`\\])\/\/[^'"`\n]*$/gm, '$1');
}

const GATES = ['isMapUrl', 'placeLink', 'directionsLink', 'mapHref', 'mapUrlOk'];
/** المواضعُ التي تُخرِج رابطاً إلى المتصفّح. */
const SINKS = ['openExternalUrl', 'window.open', 'window.location', 'location.href', 'href='];

const errors = [];
const notes = [];

// ── ① لا منفذٍ بلا بوّابة ────────────────────────────────────────────────────
let scanned = 0;
let sinkSites = 0;
const detected = new Set();
// 🪤 توقيعُ walk هو (root, targets[], match) ويُعيد مساراتٍ **نسبيّة**.
//    كتبتُه أوّلاً كأنه (dir, extensions[]) فعاد بصفر ملفّ ومرّ الحارسُ أخضرَ
//    وهو لا يفحص شيئاً — «فحصٌ لا يستطيع أن يفشل». ولذلك يلي هذه الحلقةَ
//    شرطُ حدٍّ أدنى للملفّات الممسوحة.
for (const rel of walk(ROOT, ['src'], /\.(ts|tsx)$/)) {
    const abs = path.join(ROOT, rel);
    if (rel === GATE_FILE || rel === SELF) continue;        // الحارسُ والقاعدةُ مُعفيان من نفسيهما
    const src = strip(fs.readFileSync(abs, 'utf8'));
    scanned++;
    const lines = src.split('\n');
    // 🪤 ولا يُفحص سطراً سطراً: الحقلُ والفتحُ يقعان على **سطرين مختلفين** دائماً
    //    تقريباً (`const link = …;` ثمّ `openExternalUrl(link)`). كتبتُه سطرياً
    //    أوّلاً فعاد بصفر منفذٍ ومرّ أخضرَ — وهو لا يرى الموضعَ الذي أصلحتُه قبل
    //    دقائق. فالوحدةُ نافذةٌ لا سطر.
    lines.forEach((line, i) => {
        if (!/google_?[mM]aps[_]?[lL]ink/.test(line)) return;
        // 🔴 المدى يبدأ من سطرِ الحقل و**ينتهي عند سطرِ الفتح** — لا بعده.
        //    وهذا ليس تدقيقاً زائداً: كسرتي الأولى أزالت البوّابةَ من المنفذ
        //    **فمرّ الحارسُ أخضر**، لأن نافذةً متماثلةً (±٤) كانت تضمّ نداءَ
        //    `directionsLink` الواقعَ **بعد** الفتح بأربعة أسطر — فأرضت الشرطَ
        //    بوّابةٌ لا تحرس هذا المنفذ. بوّابةٌ بعد الفتح ليست بوّابة.
        // 🪤 والمنفذُ قد يسبق الحقلَ أو يتبعَه، وكلا الشكلين حقيقيّ هنا:
        //    `href={directionsLink({ … googleMapsLink … })}` المنفذُ أعلى بثلاثة،
        //    و`const link = …;` ثمّ `openExternalUrl(link)` المنفذُ أدنى بواحد.
        //    فمَسحٌ باتّجاهٍ واحدٍ يُضيّع أحدهما — ومسحي الأماميُّ أضاع السليمَ
        //    منهما فعلاً. يُؤخذ أقربُ منفذٍ في الاتجاهين، ويُفحص **المدى بينهما**.
        let sinkAt = -1;
        for (let d = 0; d <= 8 && sinkAt === -1; d++) {
            for (const j of [i + d, i - d]) {
                if (j < 0 || j >= lines.length) continue;
                if (SINKS.some((s) => lines[j].includes(s))) { sinkAt = j; break; }
            }
        }
        if (sinkAt === -1) return;                      // لا منفذَ قريباً ⇒ تخزينٌ أو تمريرٌ
        sinkSites++;
        detected.add(rel);
        // المدى المُغلَق بين الاثنين — فبوّابةٌ خارجَه لا تحرس هذا المنفذ.
        const win = lines.slice(Math.min(i, sinkAt), Math.max(i, sinkAt) + 1).join('\n');
        if (!GATES.some((g) => win.includes(g))) {
            errors.push(
                `${rel}:${i + 1} → المنفذ ${sinkAt + 1} — رابطٌ يكتبه التاجر يُفتح بلا بوّابة.\n`
                + `     ${line.trim().slice(0, 120)}\n`
                + `     العلاج: مرّره بـisMapUrl أو استعمل placeLink / directionsLink من ${GATE_FILE}.`
            );
        }
    });
}

// ── ② والقاعدةُ نفسُها قائمةٌ وصحيحةُ الشكل ─────────────────────────────────
// 🪤 إثباتٌ موجبٌ لازم: فحصٌ لا يجد منفذاً مكشوفاً يمرّ أخضرَ وإن كانت القاعدةُ
//    قد أُفرِغت. فهنا نشترط وجودَها ببنيتها.
function requireGate(rel, needles) {
    if (!fs.existsSync(path.join(ROOT, rel))) {
        errors.push(`${rel} — غير موجود، والقاعدةُ لا بدّ أن تسكن موضعاً.`);
        return;
    }
    const body = strip(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    for (const [label, re] of needles) {
        if (!re.test(body)) errors.push(`${rel} — ${label}`);
    }
}
requireGate(GATE_FILE, [
    ['لا تُعرَّف isMapUrl إطلاقاً', /isMapUrl\s*=/],
    ['لا تشترط https — فـjavascript: و data: تمرّان', /protocol\s*!==\s*'https:'/],
    ["لا لاحقةَ نقطةٍ في مطابقة المضيف ('.' + host) — فـevil-google.com يُقبل", /endsWith\(\s*'\.'\s*\+/],
    ['لا تُفرّق مضيفات الخرائط عن مضيفات قوقل العامّة — فـsites.google.com يُقبل', /MAP_ONLY_HOSTS/],
    ['لا تشترط مسار /maps على مضيفات قوقل العامّة', /\/maps/],
]);

// ── ③ ونسخةُ البوتين: نفسُ القاعدة في الطرفين ───────────────────────────────
// البوتان يعرضان نفسَ الحقل، فقاعدةٌ في الويب وحدها نصفُ إغلاق.
if (fs.existsSync(path.join(ROOT, BOT_GATE_FILE))) {
    const body = strip(fs.readFileSync(path.join(ROOT, BOT_GATE_FILE), 'utf8'));
    const emits = /google_maps_link/.test(body);
    const gated = /isMapUrl|mapUrlOk/.test(body);
    if (emits && !gated) {
        errors.push(
            `${BOT_GATE_FILE} — يُخرِج google_maps_link بلا بوّابةِ مضيف.\n`
            + `     نفسُ الحقل يُعرَض في البوتين، فبوّابةٌ في الويب وحدها نصفُ إغلاق.`
        );
    } else if (emits && gated) {
        notes.push(`${BOT_GATE_FILE}: البوّابةُ قائمة`);
    }
}

// ── ④ ومَسحٌ فارغٌ ليس نجاحاً ───────────────────────────────────────────────
// 🪤 وأرضيّةُ «عددٍ أدنى من المنافذ» كانت رقماً **اخترعتُه** (٣)، والمقيس ٢.
//    رقمٌ مُخترعٌ يُفشل البناءَ على كودٍ سليم — وهو عيبٌ لا حرص. فالأرضيّةُ
//    الصحيحةُ أسماءُ الأسطح المقيسة: إن عطب كاشفي اختفت هذه ولم يُرصد شيء.
const MUST_DETECT = ['src/pages/DealDetails.tsx', 'src/components/StoreBranchesMap.tsx'];
for (const m of MUST_DETECT) {
    if (!detected.has(m)) {
        errors.push(
            `${m} — مَرّ بلا رصدِ منفذٍ أصلاً، وهو سطحٌ **مقيسٌ** يُخرِج رابطَ تاجر.`
            + ' أي أنّ الكاشفَ نفسَه عطب (وقع هذا مرّتين: مَسحٌ فارغٌ، ثمّ فحصٌ سطريٌّ'
            + ' والحقلُ والفتحُ على سطرين) — لا أنّ الموضعَ صار آمناً.'
        );
    }
}
// والبوّابةُ مستعملةٌ لا معرَّفةً وحدها:
const users = walk(ROOT, ['src'], /\.(ts|tsx)$/)
    .filter((r) => r !== GATE_FILE && /placeLink|directionsLink|isMapUrl/.test(strip(fs.readFileSync(path.join(ROOT, r), 'utf8'))));
if (users.length < 2) {
    errors.push(`البوّابةُ معرَّفةٌ ويستعملها ${users.length} ملفّاً فقط — تعريفٌ بلا استعمالٍ ليس حمايةً.`);
}

if (scanned < 100) {
    errors.push(
        `مُسِح ${scanned} ملفّاً فقط من src/ — والمشروع فيه مئات.`
        + ' مَسحٌ فارغٌ يُنتج «أخضرَ» كاذباً، وهذا ما وقع فعلاً أوّلَ مرّة.'
    );
}

// ── الحكم ───────────────────────────────────────────────────────────────────
if (errors.length) {
    console.error('\n❌ البناء متوقّف: بوّابةُ رابط الخريطة');
    for (const e of errors) console.error('   • ' + e);
    console.error('');
    process.exit(1);
}
console.log(
    `✅ بوّابةُ رابط الخريطة: ${scanned} ملفّاً · ${sinkSites} منفذاً كلُّها محروسة`
    + (notes.length ? ` · ${notes.join(' · ')}` : '')
);
