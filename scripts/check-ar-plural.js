#!/usr/bin/env node
/**
 * check-ar-plural.js — ثلاث نسخٍ للجمع العربي، ولا يُسمح لها أن تنحرف (v14.93)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 الخطر الحقيقي، وقد وقع نظيرُه مرّتين في هذا المشروع: قاعدةٌ لغوية واحدة
 *    مكتوبة في أكثر من مكان تنحرف بلا صوت. «٦ ساعة» (v14.92) و«٣ رسالة»
 *    (v14.93) كلاهما من هذا الباب.
 *
 * والنُّسخ ثلاثٌ بالضرورة لا بالإهمال:
 *   • `src/utils/arPlural.ts`   — الموقع (TypeScript، يُحزَم بـParcel)
 *   • `shared/arPlural.js`      — البوتان (CommonJS على Render)
 *   • `public.taki_ar_messages()` — القاعدة (رسالة الخطأ P0004 تأتي منها)
 * لا يستورد أيٌّ منها الآخر: بيئاتٌ ثلاث لا تتكلّم لغةً واحدة.
 *
 * فهذا الحارس يقارن **النسختين اللتين يمكن تشغيلهما هنا** عدداً عدداً،
 * ويقارن نصّ دالّة القاعدة بجدول الصيغ نفسه. أما تطابقُها الحيّ مع الخادم
 * فيُثبَت في الهجرة نفسها (`DO` يرفع استثناءً).
 *
 * 🪤 ولا يفترض git ولا `dist`: يُشغَّل داخل سلسلة البناء على Vercel أيضاً.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const fail = (m) => { console.error(`\n❌ البناء متوقّف: الجمع العربي\n\n   ${m}\n`); process.exit(1); };

// ── ١) نسخة البوتين: تُحمَّل مباشرةً ───────────────────────────────────────
let shared;
try {
    shared = require(path.join(root, 'shared', 'arPlural.js'));
} catch (e) {
    fail(`تعذّر تحميل shared/arPlural.js — ${e.message}`);
}

// ── ٢) نسخة الموقع: تُقرأ نصّاً وتُترجم يدوياً (لا مُجمِّع TS هنا) ─────────
const tsPath = path.join(root, 'src', 'utils', 'arPlural.ts');
let ts;
try { ts = fs.readFileSync(tsPath, 'utf8'); } catch { fail('src/utils/arPlural.ts غير موجود.'); }

// 🪤 `DAYS` وأخواتها لا تسكن `arPlural.ts` بل كتالوجَ اللوحة — فالبحث في
//    الملفّين معاً، وإلّا صرخ الحارسُ كذباً على صيغةٍ موجودة (قاعدةُ المشروع:
//    صراخٌ كاذب أسوأ من غياب الحارس). وكان الكتالوج في `verificationStatus.ts`
//    حتى v15.81، فنُقل إلى `ui/adminForms.ts` ليجده كلُّ الشاشات.
const verPath = path.join(root, 'src', 'components', 'admin', 'ui', 'adminForms.ts');
let verSrc = '';
try { verSrc = fs.readFileSync(verPath, 'utf8'); } catch { verSrc = ''; }

/** يستخرج كائن صيغةٍ من مصدر TypeScript بلا تنفيذ. */
const formsFromTs = (name) => {
    const re = new RegExp(`export const ${name}: ArForms = \\{([\\s\\S]*?)\\};`);
    const m = ts.match(re) || verSrc.match(re);
    if (!m) fail(`لم أجد الصيغة «${name}» في ${path.relative(root, tsPath)} ولا في ${path.relative(root, verPath)}.`);
    const out = {};
    for (const [, k, v] of m[1].matchAll(/(\w+)\s*:\s*'([^']*)'/g)) out[k] = v;
    return out;
};

const tsMessages = formsFromTs('MESSAGES');
const tsHours = formsFromTs('HOURS');
const tsMinutes = formsFromTs('MINUTES');

// ── ٣) الصيغ يجب أن تتطابق حرفاً بحرف ─────────────────────────────────────
const cmp = (label, a, b) => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
        if (a[k] !== b[k]) {
            fail(`صيغة «${label}.${k}» مختلفة:\n     الموقع : ${JSON.stringify(a[k])}\n     البوتان: ${JSON.stringify(b[k])}`);
        }
    }
};
cmp('messages', tsMessages, shared.FORMS.messages);
cmp('hours', tsHours, shared.FORMS.hours);
cmp('minutes', tsMinutes, shared.FORMS.minutes);

// ── ٣٫٥) 🔴 v15.81 — وخوارزميّةُ الموقع نفسُها تُقرأ، لا صيغُه وحدها ────────
// 🔴 ثقبٌ قِيس بالتنفيذ قبل سدّه: كان القسمُ ٤ يقارن **إعادةَ تنفيذٍ مكتوبةً
//    في هذا السكربت** بنسخةِ البوتين — ولا ينظر إلى `arPlural.ts` إطلاقاً إلّا
//    لاستخراج جداول الصيغ. فحُقنت كسرةٌ في قلب المحرّك (`f.few` ⇐ `f.many` في
//    فرع ٣–١٠، أي «٣ ساعة» لكل مستخدم) وأُثبت وقوعُها على القرص بـ`grep`،
//    **فمرّ الحارسُ أخضرَ بـ٦٤٨ مقارنة**. أي أن «نسختان متطابقتان» كانت تعني
//    «السكربتُ يطابق البوت»، والموقعُ خارج الحساب.
//    والعلاجُ قراءةُ جسمِ الدالّة من الملفّين ومقارنةُ سطورِه حرفاً بحرف.
/**
 * يستخرج توقيعَ `arCount` وجسمَه من مصدرٍ، بلا تعليقاتٍ ولا مسافاتٍ زائدة.
 * 🪤 والمرساةُ `export const` / `function` لا كلمةُ `arCount` وحدها: أوّلُ
 *    نسخةٍ من هذا الفحص رسَت على ذِكرِ الاسم **في تعليقٍ فوق الدالّة** فاتّهمت
 *    كوداً سليماً — وهو الفخُّ المكتوبُ في ترويسة هذا الملفّ بعينه.
 */
const arCountDecl = (src, label) => {
    const m = src.match(/(?:export const|function)\s+arCount\s*=?\s*\(([\s\S]*?)\)\s*(?::[^{=]*)?(?:=>)?\s*\{([\s\S]*?)\n\}/);
    if (!m) fail(`لم أجد تعريفَ \`arCount\` في ${label} — غيّرَ أحدٌ شكلَ الدالّة.`);
    return m;
};
const arCountBody = (src, label) => {
    const m = arCountDecl(src, label);
    return m[2]
        .split('\n')
        .map((l) => l.replace(/\/\/.*$/, '').trim())
        .filter(Boolean)
        // سطرانِ يخصّان نسخةَ البوتين وحدها (تقبل اسمَ صيغةٍ نصّاً).
        .filter((l) => !l.startsWith('const f =') && !l.startsWith('if (!f) throw'));
};
{
    const a = arCountBody(ts, 'src/utils/arPlural.ts');
    const b = arCountBody(fs.readFileSync(path.join(root, 'shared', 'arPlural.js'), 'utf8'), 'shared/arPlural.js');
    if (a.length !== b.length || a.some((l, i) => l !== b[i])) {
        fail('خوارزميّةُ `arCount` انحرفت بين الموقع والبوتين:\n'
            + `     الموقع : ${JSON.stringify(a)}\n     البوتان: ${JSON.stringify(b)}`);
    }
    // ومُعامل التنسيق لا يُحذف من إحداهما وحدها (v15.81).
    for (const [lbl, src] of [['الموقع', ts], ['البوتان', fs.readFileSync(path.join(root, 'shared', 'arPlural.js'), 'utf8')]]) {
        const params = arCountDecl(src, lbl)[1];
        if (!/\bfmt\b/.test(params)) {
            fail(`نسخةُ ${lbl} من \`arCount\` بلا مُعامل \`fmt\` — والتوأمُ يحمله، فسيسقط شكلُ الرقم في لوحة الإدارة.`
                + `\n     التوقيعُ المقروء: (${params.trim()})`);
        }
    }
}

// ── ٤) ومخرجاتُهما يجب أن تتطابق لكل عددٍ واقعيّ ───────────────────────────
/** إعادةُ تنفيذ منطق TS من نصّه، كي لا نقارن الوحدة بنفسها. */
const tsArCount = (n, f, genitive = false) => {
    if (!Number.isFinite(n)) return `${n} ${f.many}`;
    if (!Number.isInteger(n)) return `${n} ${f.many}`;
    if (n === 1) return f.one;
    if (n === 2) return genitive ? (f.twoGen || f.two) : f.two;
    if (n >= 3 && n <= 10) return `${n} ${f.few}`;
    return `${n} ${f.many}`;
};

const NUMS = [];
for (let i = 0; i <= 100; i++) NUMS.push(i);
NUMS.push(0.25, 0.5, 1.5, 2.5, 8760, NaN, Infinity);

let checked = 0;
for (const n of NUMS) {
    for (const [label, tsF, shKey] of [['messages', tsMessages, 'messages'], ['hours', tsHours, 'hours'], ['minutes', tsMinutes, 'minutes']]) {
        for (const gen of [false, true]) {
            const a = tsArCount(n, tsF, gen);
            const b = shared.arCount(n, shKey, gen);
            if (a !== b) {
                fail(`«${label}» عند n=${n}${gen ? ' (مجرور)' : ''}:\n     الموقع : ${JSON.stringify(a)}\n     البوتان: ${JSON.stringify(b)}`);
            }
            checked++;
        }
    }
}

// ── ٥) الحالات التي كانت خاطئة فعلاً — تُثبَّت كي لا تعود ──────────────────
const MUST = [
    [1, 'رسالة واحدة'], [2, 'رسالتان'], [3, '3 رسائل'], [10, '10 رسائل'], [11, '11 رسالة'],
];
for (const [n, want] of MUST) {
    if (shared.arMessages(n) !== want) {
        fail(`arMessages(${n}) = ${JSON.stringify(shared.arMessages(n))} والمتوقَّع ${JSON.stringify(want)}.`);
    }
}
// «1 hours» و«1 messages» — العيب الإنجليزي المقابل
if (shared.enMessages(1) !== 'one message' || shared.enMessages(3) !== '3 messages') {
    fail('صياغة العدد بالإنجليزية غير صحيحة (تذكّر «1 messages»).');
}
// الكسور: «١٫٥ ساعات» تُكتب جمعَ قلّة خطأً. وأرضيّةُ المهلة ساعةٌ منذ v15.50
// لكنّ الكسورَ باقيةٌ فوقها (١٫٥ · ٢٫٥)، فالقاعدةُ تبقى محروسة.
if (shared.arCount(0.5, 'hours') !== '0.5 ساعة' || shared.arCount(1.5, 'hours') !== '1.5 ساعة') {
    fail('الكسور تُصاغ جمعَ قلّة — «١٫٥ ساعات» خطأ.');
}

// ── ٥٫٧) 🔴 v15.50 — لا عبارةَ معدودٍ مصنوعةً بيدها في شاشات المهلة ───────
// 🪤 الثقبُ الذي أنجى ستَّ عباراتٍ خاطئةً حيّة: مدى هذا الحارس كان خمسةَ
//    ملفّات، **وصفرَ شاشةٍ من شاشات المهلة**. فمرّ أخضرَ وهو لا ينظر — و«لم
//    يُنظر» ليس «سليم». (قِيس: رسالةُ نجاح الأدمن كانت تطبع «2 ساعة» و«6 ساعة»
//    و«10 دقيقة» — ثلاثةُ أخطاءٍ نحويّة.) والمدى يُوسَّع، فالقاعدةُ تُفرض حيث
//    تُكتب العبارةُ لا حيث يسكن المحرّك.
//
// 🔴 v15.81 — والمدى صار **مشتقّاً لا مكتوباً**، وهذا هو الإصلاح الحقيقي.
//    قِيس: الحارسُ كان يقرأ **خمسةَ ملفّات من ٤٠٠**، فمرّ أخضرَ على ١٤٣ موضعاً
//    في لوحة الإدارة تصنع معدوداتها بيدها — منها «١٠ دقيقة» و«١ ساعة» و«٣ ساعة»
//    تُرسم على الشاشة لحظةَ فتح بطاقةِ تأخير الإنذار، و«منحناك 14 يوم» تُبثّ
//    إلى **التجّار** من `AdminSellers`. والثقبُ نفسُه كان قد سُدّ في v15.50
//    بإضافة الملفّات المكسورة إلى مصفوفةٍ حرفيّة — أي أنه سُدّ في مكانه وانتقل
//    مجلّداً واحداً. وقائمةُ ملفّاتٍ تُصان بيدٍ **حارسٌ يفشل مفتوحاً ببنيته**.
//    (ولا `git ls-files`: بناءُ Vercel أرشيفٌ بلا مستودع — درس v14.80b.)
const { walk } = require('./lib/walk');

/** شاشاتُ المهلة: تُفحص بالنمط الصارم — لا رقمَ مهلةٍ نصّاً ولو كان صحيحاً. */
const HAND_MADE = [
    'src/components/admin/BookingHoldsCard.tsx',
    'src/components/seller/HoldHoursCard.tsx',
    'src/hooks/useStoreHold.ts',
    'server/lib/holds.js',
];

/**
 * 🔴 **كلُّ `src/` — لا لوحةُ الإدارة وحدها** (وُسِّع ٩ نوفمبر ٢٠٢٦).
 *    كان المدى `src/pages/admin` و`src/components/admin`، فمرّ الحارسُ أخضرَ
 *    و٢٦ عبارةَ معدودٍ مخالفةً للنحو **في الشاشات التي يراها المشترون**:
 *    «خلال ٣ يوم» عند استعادة الحساب · «≈ ٥ دقيقة» في التوصيل · «١ / ١ صور»
 *    في الكاميرا · «٢ ساعة» و«٣٠ يوم» في حقول التاجر. ومداً ضيّقاً يُنتج
 *    «أخضرَ» لا يصف إلا ما ينظر إليه.
 * 🪤 ويُستثنى `src/utils/arPlural.ts` نفسُه: صيغُه **هي** الصواب، فالحارسُ
 *    كان يتّهم كتالوجَه هو — نفسُ فخّ «الحارس يقرأ تعليقَه».
 */
const PANEL = walk(root, ['src'], /\.tsx?$/)
    .filter((f) => !/^src\/utils\/arPlural\.ts$/.test(f)
        && !/^src\/components\/admin\/ui\/adminForms\.ts$/.test(f));
const EXPR = '\\$\\{[^}]*\\}';
const LIT = '[0-9]+(?:\\.[0-9]+)?|[٠-٩]+';
const NUM = `(?:${EXPR}|${LIT})`;
// 🪤 واللاحقةُ تمنع الحروفَ **والحركات** معاً: بلا الحركات يطابق «صف» داخل
//    «صفّاً» (الشدّةُ ليست حرفاً) فيُتَّهم نصٌّ سليم. ولا تُستعمل كتلةُ العربية
//    كلّها، ففيها الفاصلةُ `،` فتُبتلع نصوصٌ صحيحة (قِيس في v15.50).
const AR_LETTER = '[ء-ْٱ-ۓ]';
const UNITS = 'ساعات|ساعتان|ساعتين|ساعة|دقائق|دقيقتان|دقيقة|أيام|يومان|يوماً|يوم';
const HAND_AR = new RegExp(NUM + '\\s*(?:' + UNITS + ')(?!' + AR_LETTER + ')');
// 🔴 وفخٌّ قِيس بالتنفيذ عند توسيع المدى: `NUM + '\\s+…days?\\b'` يطابق أصنافَ
//    Tailwind — «flex-1 min-w-0» فيها «1 min» ثمّ `-` وهو حدُّ كلمةٍ لاتينيّ.
//    قِيس: ٢٨ إصابةً في ١٢ ملفّاً، **كلُّها زائفة وصفرُ حقيقية**. فيُشترط حدُّ
//    نصٍّ قبل العدد، ولا تتلو الوحدةَ شُرطةٌ ولا حرف.
const HAND_EN = new RegExp('(?:^|[\\s"\'`>({,])(?:' + NUM + ')\\s+(?:hours?|minutes?|mins?|days?)(?![-\\w])');
const HAND_RE = { test: (l) => HAND_AR.test(l) || HAND_EN.test(l) };

/**
 * تجريدُ التعليقات **بحفظِ الأسطر**.
 * 🔴 القديمُ كان `.replace(/(^[ \t]*|\{)\/\*[\s\S]*?\*\//gm, '$1')` — يحذف أسطرَ التعليق فيزحف
 *    كلُّ رقمِ سطرٍ بعده. قِيس عند توسيع المدى: قال الحارسُ `AdminAdmins.tsx:234`
 *    والسطرُ الحقيقي **٢٥١** — كذبةٌ بسبعةَ عشرَ سطراً. وفي مشروعٍ ترويساتُ
 *    ملفّاته أربعون سطرَ تعليقٍ عربيّ، هذا يُرسل المصلحَ إلى موضعٍ آخر.
 */
const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
    .replace(/([^:])\/\/[^\n'"`]*$/gm, '$1');

for (const rel of HAND_MADE) {
    let src = '';
    try { src = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { fail(`${rel} غير موجود — مدى الحارس يشير إلى ملفٍّ ذهب.`); }
    // التعليقاتُ تُجرَّد أوّلاً: حارسٌ يقرأ تعليقَه هو اتُّهم به كودٌ سليمٌ خمسَ مرّات.
    const bare = strip(src);
    const hit = bare.split('\n').findIndex((l) => HAND_RE.test(l));
    if (hit >= 0) {
        fail(`${rel}:${hit + 1} يصنع عبارةَ معدودٍ بيده — «${bare.split('\n')[hit].trim().slice(0, 90)}».\n`
            + `   تُصاغ بـ\`holdLabel\`/\`minutesLabel\` (الموقع) أو \`label\`/\`arCount\` (البوتان).`);
    }
}

// ── ٥٫٨) 🔴 v15.81 — اللوحة: معدودٌ مصنوعٌ بيدٍ، أو ساكنٌ مخالفُ النحو ───────
// وهنا **نمطان لا نمطٌ واحد**، والتفريقُ بينهما هو ما يمنع الصراخَ الكاذب:
//   (أ) عددٌ **مُقحَم** (`${n}`) يتلوه معدودٌ عارٍ ⇒ عيبٌ دائماً: العبارةُ
//       تُبنى لحظةَ العرض فتصحّ في صيغةٍ من خمسٍ وتُخطئ في أربع.
//   (ب) عددٌ **ساكن** يتلوه معدود ⇒ عيبٌ **فقط** إن خالف ما يُنتجه المحرّك.
//       فـ«٧ أيام» و«٣٠ يوماً» تسميتا مدىٍ ثابتتان وصحيحتان نحواً، واتّهامُهما
//       هو ما يحوّل ١٤٣ عيباً حقيقياً إلى «٢٤٢ أزمة» فيُطمر الحقيقيُّ فيها.
//       قِيس: ٩٥ عبارةً ساكنة، **تسعٌ** منها فقط مخالفة («30 يوم» · «20 تاجر»).
// 🪤 والمعدوداتُ لا تُكتب هنا: تُقرأ من الكتالوج نفسه، وإلّا انحرفت القائمتان.
const CATALOGUE = {};
for (const src of [verSrc, ts]) {
    for (const [, name, body] of src.matchAll(/export const (\w+): ArForms = \{([\s\S]*?)\};/g)) {
        const f = {};
        for (const [, k, v] of body.matchAll(/(\w+)\s*:\s*'([^']*)'/g)) f[k] = v;
        CATALOGUE[name] = f;
    }
}
// 🪤 وحارسُ الحارس: مسحٌ فارغٌ يبدو نجاحاً. قِيس في هذه الجلسة أن توقيعَ
//    `walk` ثلاثُ وسائط لا وسيطان، وأن نداءً بوسيطين يُعيد **صفرَ ملفّات**.
if (Object.keys(CATALOGUE).length < 20) {
    fail(`كتالوجُ المعدودات قُرئ بـ${Object.keys(CATALOGUE).length} صيغةً فقط — المسحُ شبه فارغ، فالفحصُ لا ينظر.`);
}
// 🪤 والأرضيّةُ أسماءُ أسطحٍ مقيسةٍ مع العدد: عددٌ وحده يمرّ لو تغيّر المدى
//    إلى شجرةٍ أخرى بنفس الحجم، وقد وقع مثلُه في حارسٍ آخر.
const MUST_SEE = [
    'src/pages/admin/AdminAnalytics.tsx',       // اللوحة
    'src/context/AppContext.tsx',               // قلبُ التطبيق — كان خارج المدى
    'src/pages/SellerDashboard.tsx',            // شاشاتُ التاجر — كانت خارج المدى
    'src/components/DeliveryTrackMap.tsx',      // شاشةُ المشتري — كانت خارج المدى
];
for (const m of MUST_SEE) {
    if (!PANEL.includes(m)) fail(`المدى لا يحوي «${m}» — سطحٌ مقيسٌ لهذا العيب، فغيابُه عطبٌ في الكاشف لا سلامةٌ في الكود.`);
}
if (PANEL.length < 150) {
    fail(`المدى ${PANEL.length} ملفّاً — أقلُّ من المتوقَّع بكثير، فالحارسُ لا يرى الواجهة.`);
}

/**
 * كلُّ معدودٍ قد يظهر بعد رقم: `few` و`many`، **وجذرُ المفرد** معهما.
 *
 * 🔴 وهذا الثالثُ هو الذي كان يُفلت أخطرَ العيوب، وقِيس: بـ`few`/`many` وحدهما
 *    أمسك الحارسُ ٩٥ موضعاً وفاته ٤٨ — ومنها «منحناك ${trialDays} يوم» التي
 *    تُبثّ إلى **كلّ تاجر**، و«${r.ok} متجر»، و«20 تاجر». فجذرُ المفرد («يوم»
 *    من «يوم واحد») هو أشيعُ شكلٍ للعيب، ولا تُنتجه الدالّةُ بعد عددٍ أبداً.
 * 🪤 ويُشتقّ من `one` لا يُكتب: قائمةٌ مكتوبةٌ بيدٍ تنحرف عن الكتالوج — وهو
 *    العيبُ عينُه الذي نحرسه.
 */
const COUNTED = new Set();
for (const f of Object.values(CATALOGUE)) {
    if (f.few) COUNTED.add(f.few);
    if (f.many) COUNTED.add(f.many);
    if (f.one) COUNTED.add(f.one.split(' ')[0]);
}
const NOUNS = [...COUNTED].sort((a, b) => b.length - a.length).join('|');

const toLatin = (s) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
// 🪤 ويُبحث في جذرِ المفرد أيضاً: «30 يوم» جذرُها `one` لا `few`/`many`، فبلا
//    هذا السطر كان الحارسُ يقول «الصوابُ 30 ؟» — إنذارٌ صحيحٌ بنصيحةٍ فارغة.
const formOf = (token) => Object.values(CATALOGUE).find((f) => f.few === token || f.many === token)
    || Object.values(CATALOGUE).find((f) => f.one && f.one.split(' ')[0] === token);
/** هل يُنتج المحرّكُ «N TOKEN» لصيغةٍ ما في الكتالوج؟ */
const engineAccepts = (n, token) => Object.values(CATALOGUE).some((f) =>
    [false, true].some((g) => tsArCount(n, f, g) === `${n} ${token}`));

const PANEL_EXPR = new RegExp(`(${EXPR})\\s*(${NOUNS})(?!${AR_LETTER})`, 'g');
// 🪤 والعيبُ الذي يستحيل على نمطِ «رقمٌ ثمّ معدود» رؤيتُه: معدودٌ خلف `${`
//    ثانٍ — «${count} ${audience === 'seller' ? 'بائع' : …}» (مثالُ ناصر نفسِه،
//    «٢ بائع»). فله نمطُه: مُقحَمٌ يتلوه مُقحَمٌ فيه معدودٌ بين علامتَي تنصيص.
const PANEL_TERNARY = new RegExp(`${EXPR}\\s*\\$\\{[^}]*'(?:${NOUNS})'`, 'g');
const PANEL_LIT = new RegExp(`(?:^|[^0-9٠-٩.])(${LIT})\\s*(${NOUNS})(?!${AR_LETTER})`, 'g');

const panelHits = [];
for (const rel of PANEL) {
    const bare = strip(fs.readFileSync(path.join(root, rel), 'utf8'));
    bare.split('\n').forEach((line, i) => {
        const at = `${rel}:${i + 1}`;
        for (const m of line.matchAll(PANEL_EXPR)) {
            panelHits.push(`${at} — «${m[1].slice(0, 32)} ${m[2]}» عبارةٌ مبنيّةٌ بيدها؛ تُصاغ بـ\`arCount(n, <الصيغة>)\` (وفي اللوحة \`admCount\`).`);
        }
        for (const m of line.matchAll(PANEL_TERNARY)) {
            panelHits.push(`${at} — «${m[0].slice(0, 60)}» معدودٌ داخل شرطٍ بعد عدد؛ تُختار الصيغةُ لا الكلمة.`);
        }
        for (const m of line.matchAll(PANEL_LIT)) {
            const n = Number(toLatin(m[1]));
            if (Number.isFinite(n) && !engineAccepts(n, m[2])) {
                const f = formOf(m[2]);
                const right = f ? tsArCount(n, f).replace(/^[^ ]+ /, '') : '؟';
                panelHits.push(`${at} — «${m[1]} ${m[2]}» مخالفةٌ للنحو؛ الصوابُ «${m[1]} ${right}».`);
            }
        }
    });
}
if (panelHits.length) {
    fail(`الواجهة: ${panelHits.length} عبارةَ معدودٍ مصنوعةً بيدها أو مخالفةً لنحوها:\n     `
        + panelHits.slice(0, 25).join('\n     ')
        + (panelHits.length > 25 ? `\n     … و${panelHits.length - 25} غيرها.` : '')
        + '\n\n   الصيغُ المشتركة في `src/utils/arPlural.ts`، وصيغُ اللوحة وغلافُها `admCount` في `src/components/admin/ui/adminForms.ts`.');
}

// ── ٦) لا نصَّ عددٍ مثبَّتاً في سلاسل البوت ────────────────────────────────
// ── ٥٫٥) «يوم» في القاعدة ↔ «يوم» في الواجهة (v15.29) ──────────────────────
// 🪤 `taki_expire_verifications` تبني نصَّ التنبيه بـ`taki_ar_days()` داخل
//    القاعدة، وشاشةُ المراجعة تبني نصَّها بـ`DAYS` في TypeScript. بيئتان لا
//    تستوردان بعضهما — وهو بالضبط الوضعُ الذي أنتج «٦ ساعة» و«٣ رسالة».
//    فالحارسُ يقرأ الصيغ من ملفّ الهجرة نفسه ويقارنها حرفاً بحرف.
const migPath = path.join(root, 'supabase', 'JEDDAH_v15_29_verification_clock.sql');
let mig;
try { mig = fs.readFileSync(migPath, 'utf8'); } catch { fail(`${path.relative(root, migPath)} غير موجود — نسخةُ القاعدة من جمع «يوم» مفقودة.`); }

const sqlDays = {};
{
    const body = mig.match(/CREATE OR REPLACE FUNCTION public\.taki_ar_days[\s\S]*?\$fn\$([\s\S]*?)\$fn\$/);
    if (!body) fail('لم أجد نصّ `taki_ar_days` في ملفّ الهجرة.');
    const b = body[1];
    const one = b.match(/p_n = 1 THEN '([^']*)'/);
    const two = b.match(/p_n = 2 THEN '([^']*)'/);
    const few = b.match(/BETWEEN 3 AND 10 THEN p_n::text \|\| ' ([^']*)'/);
    const many = b.match(/ELSE p_n::text \|\| ' ([^']*)'/);
    if (!one || !two || !few || !many) fail('نصُّ `taki_ar_days` لا يطابق الشكل المتوقَّع — راجعه يدوياً.');
    Object.assign(sqlDays, { one: one[1], two: two[1], few: few[1], many: many[1] });
}

const tsDays = formsFromTs('DAYS');
for (const k of ['one', 'two', 'few', 'many']) {
    if (tsDays[k] !== sqlDays[k]) {
        fail(`صيغة «days.${k}» مختلفة:\n     الواجهة: ${JSON.stringify(tsDays[k])}\n     القاعدة : ${JSON.stringify(sqlDays[k])}`);
    }
}

const i18nPath = path.join(root, 'server', 'lib', 'i18n-data.json');
let i18n;
try { i18n = JSON.parse(fs.readFileSync(i18nPath, 'utf8')); } catch (e) { fail(`i18n-data.json — ${e.message}`); }

// 🪤 نمطٌ فضفاض يتّهم البريء: «رسائلك: {3}» ليست جمعَ عددٍ بل عنوانُ حقل،
//    و«{2}\nرسائلك» طابقت لأن `\s` تشمل السطر الجديد. فالمعدودُ هنا يجب
//    ألّا يتلوه حرفٌ عربيّ (فتخرج «رسائلك» و«ساعاتنا»)، وأن يسبقه العدد مباشرةً.
const BAD = /(٣|3)\s*(رسائل|رسالة|messages?)(?![\u0600-\u06FF])|\{\d\}[ \t]*(رسائل|ساعات)(?![\u0600-\u06FF])/;
const offenders = [];
for (const [key, entry] of Object.entries(i18n)) {
    if (!entry || typeof entry !== 'object') continue;
    for (const [lang, txt] of Object.entries(entry)) {
        if (typeof txt === 'string' && BAD.test(txt)) offenders.push(`${key} [${lang}] = ${JSON.stringify(txt)}`);
    }
}
if (offenders.length) {
    fail('سلاسل تُثبّت العدد أو تجمعه نصّاً — تُمرَّر العبارة مصوغة من الكود:\n     ' + offenders.join('\n     '));
}

// 🪤 والمدى يُطبع مع النجاح عمداً: «نسختان متطابقتان (٦٤٨ مقارنة)» كانت تُقرأ
//    اطمئناناً وهي تعني «السكربتُ يطابق البوت» و**خمسةَ ملفّاتٍ من ٤٠٠**.
//    الأرقامُ التي تُصدّق خضرةَ حارسٍ هي أرقامُ مداه لا أرقامُ مقارناته.
console.log(`✅ الجمع العربي: ${checked} مقارنةً للمخرجات · خوارزميّةُ \`arCount\` متطابقةٌ نصّاً `
    + `· «يوم» في القاعدة = «يوم» في الواجهة · سلاسل البوت بلا عددٍ مثبَّت\n`
    + `   المدى: ${HAND_MADE.length} ملفَّ مهلة + ${PANEL.length} ملفَّ واجهة، `
    + `بكتالوج ${Object.keys(CATALOGUE).length} صيغةٍ و${COUNTED.size} معدوداً`);
