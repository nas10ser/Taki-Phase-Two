#!/usr/bin/env node
/**
 * check-bot-pii-logs.js — لا تُطبع بياناتُ عميلٍ في سجلّ Render (v15.79)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 **العيبُ الذي كان، وهو مسارٌ عاديّ لا حالةٌ نادرة.** موضعان:
 *      server/bot.js         `console.error('WA delivery FAILED →', st.recipient_id, …)`
 *      server/lib/emailOutbox.js  `console.error('email send:', m.to_email, …)`
 *    الأوّلُ يطبع جوّالَ مشترٍ سعوديّ كاملاً بصيغة E.164، والثاني بريدَه —
 *    وكلاهما على **فشلٍ متوقَّع**: رقمٌ ليس على واتساب · نافذةُ ٢٤ ساعةً
 *    مغلقة · قالبٌ مرفوض · بريدٌ مرتدّ. أي أن السجلَّ يتحوّل مع الوقت إلى
 *    قائمةِ جوّالاتٍ وبرائدِ قاعدةِ العملاء كلِّها.
 *    وسجلُّ Render سطحٌ **خارج** خادم جدة: لا تسري عليه RLS، ولا يبلغه
 *    `purge_expired_accounts` بعد ثلاثين يوماً، ولا تذكره سياسةُ الخصوصية.
 *    وهو نفسُ صنفِ العيب المسجَّل في CLAUDE.md: «سجلّاتُ المحادثات سطحُ
 *    أسرار» — وُجد فيها مفتاحُ Render حيّاً وتوكن GitHub. والقاعدةُ التي
 *    استُخلصت هناك («لا تطبع قيمة سرّ أبداً») تمتدّ إلى بيانات الأشخاص.
 *
 * ما يُفحص: **وسائطُ** نداء `console.*` وحدها — لا الملفّ، ولا نصُّ الرسالة.
 * 🪤 ولو فُحص النصُّ لسقط الفحصُ على ثلاثة أبرياء قِيسوا فعلاً:
 *      `console.log('… سحب من email_outbox كل 45 ثانية')`
 *      `console.error('email send: outbox id=%s %s', m.id, e.message)`
 *      `console.warn('email poll:', e.message)`
 *    وهي نصوصٌ لا بيانات. وهذا الفخُّ مسجَّلٌ في هذا المشروع **ثلاث مرّات**
 *    (v14.97 · v15.22 · وحارسُ «فاتورة المرحلة الثانية»): حارسٌ يتّهم النصَّ
 *    الذي يحرسه. ⇒ تُجرَّد السلاسلُ **والتعليقات** قبل المطابقة، ويبقى
 *    التعبيرُ وحده (`m.to_email` · `st.recipient_id`).
 * 🪤 وتُجرَّد السلاسلُ بمحلِّلٍ محرفاً محرفاً لا بتعبيرٍ نمطيّ: `'https://x'`
 *    فيه `//`، فشطبُ التعليقات بـ`/\/\/.*$/` يأكل نصفَ السطر ويُخفي عيباً.
 */

const fs = require('fs');
const path = require('path');
const { walk } = require('./lib/walk');

const root = path.resolve(__dirname, '..');
const SELF = 'scripts/check-bot-pii-logs.js';   // 🪤 الحارسُ يُعفي نفسَه: أسماءُ الحقول مكتوبةٌ فيه بالضرورة
const DIRS = ['server', 'shared'];
const EXT = /\.js$/;

/**
 * أسماءُ الحقول التي تحمل بياناتَ شخصٍ في هذا المخطّط.
 * والحدُّ `_` و`.` يُعدّان فاصلَين، فـ`p_phone` و`user.email` يُمسكان،
 * و`phoneDigits` و`emailOutbox` لا — لأنّ ما بعدهما حرفٌ أو رقم.
 */
const PII = ['to_email', 'recipient_id', 'whatsapp_chat_id', 'user_phone', 'phone', 'email'];
const PII_RE = new RegExp(`(?<![A-Za-z0-9])(${PII.join('|')})(?![A-Za-z0-9])`, 'i');

/**
 * يُجرّد التعليقاتَ والسلاسلَ (مفردة · مزدوجة · قالبية) **وحروفَ التعابير
 * النمطية** بمسحٍ محرفاً محرفاً. يُبدّل كلَّ واحدةٍ بمسافاتٍ بنفس الطول
 * حتى لا تتزحزح المواضع ولا أرقامُ الأسطر.
 *
 * 🪤 وتجاهلُ التعابير النمطية أسقط الصياغةَ الأولى من هذا الحارس، **وقِيس**:
 *    `stripMd` في `bot.js` فيه `/\\([_*[\]()~`>#+\-=|{}.!\\])/g` — وفيه
 *    **علامةُ قالبٍ خلفية**. فظنّها الماسحُ بدايةَ سلسلةٍ قالبية والتهم ما
 *    بعدها، فرأى الحارسُ ٢١ نداءَ `console` من ٦١ — أي أنه كان يصرخ «نظيف»
 *    وهو أعمى عن ثلثَي الملفّ. ولهذا بالضبط وُضعت بوّابةُ المدى أدناه.
 */
function stripStringsAndComments(src) {
    // 🪤 و`Array.from(src)` **خطأ هنا** وقد قِيس: هي تُقسّم بنقاطِ الترميز،
    //    و`src[i]` يُفهرس بوحداتِ UTF-16 — فأوّلُ إيموجي في الملفّ (وهذا
    //    المشروع مملوءٌ بها: ⚠️ 🔴 🪤) يُزحزح المصفوفةَ عن النصّ، فيتوه
    //    الماسحُ ويرى ٣ نداءاتِ `console` من ٤٢ في `bot.js`. و`split('')`
    //    يُقسّم بوحداتِ UTF-16 فيتطابق الفهرسان.
    const out = src.split('');
    const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
    // المحرفُ الدالُّ السابق — يُقرأ من `out` لا من `src`، فما سبق جُرّد أصلاً.
    const prevSig = (i) => { let k = i - 1; while (k >= 0 && /\s/.test(out[k])) k--; return k >= 0 ? out[k] : ''; };
    let i = 0;
    while (i < src.length) {
        const c = src[i], n = src[i + 1];
        if (c === '/' && n === '/') { let j = i; while (j < src.length && src[j] !== '\n') j++; blank(i, j); i = j; continue; }
        if (c === '/' && n === '*') { const j = src.indexOf('*/', i + 2); const e = j < 0 ? src.length : j + 2; blank(i, e); i = e; continue; }
        if (c === '/') {
            // تمييزُ التعبير النمطيّ من القسمة: التعبيرُ لا يأتي بعد معرِّفٍ
            // ولا رقمٍ ولا `)` ولا `]`. وما بعد كلمةِ `return` تعبيرٌ دائماً.
            const p = prevSig(i);
            // نافذةٌ خلفيّةٌ محدودة (لا `slice` للملفّ كلّه: ذاك O(n²) على ٤١٢٣ سطراً)
            const back = out.slice(Math.max(0, i - 12), i).join('').trimEnd();
            const kw = /(?:^|[^A-Za-z0-9_$])(return|typeof|case|in|of|do|else|void|delete|yield|await)$/.test(back);
            if (p === '' || kw || /[(,=:[!&|?{};+\-*%~^<>]/.test(p)) {
                let j = i + 1, cls = false;
                while (j < src.length && src[j] !== '\n') {
                    if (src[j] === '\\') { j += 2; continue; }
                    if (src[j] === '[') cls = true;
                    else if (src[j] === ']') cls = false;
                    else if (src[j] === '/' && !cls) { j++; break; }
                    j++;
                }
                blank(i + 1, Math.max(i + 1, j - 1));
                i = j; continue;
            }
            i++; continue;
        }
        if (c === '\'' || c === '"' || c === '`') {
            let j = i + 1;
            while (j < src.length) {
                if (src[j] === '\\') { j += 2; continue; }
                if (src[j] === c) { j++; break; }
                j++;
            }
            blank(i + 1, Math.max(i + 1, j - 1));
            i = j; continue;
        }
        i++;
    }
    return out.join('');
}

/** يستخرج نصَّ وسائط كلّ نداء `console.*` بعدّ الأقواس. */
function consoleCalls(clean) {
    const calls = [];
    const re = /console\s*\.\s*[A-Za-z]+\s*\(/g;
    let m;
    while ((m = re.exec(clean))) {
        let depth = 1, i = m.index + m[0].length;
        const start = i;
        while (i < clean.length && depth > 0) {
            if (clean[i] === '(') depth++;
            else if (clean[i] === ')') depth--;
            i++;
        }
        calls.push({ args: clean.slice(start, i - 1), line: clean.slice(0, m.index).split('\n').length });
        re.lastIndex = i;
    }
    return calls;
}

const files = walk(root, DIRS, EXT).filter(f => f !== SELF);
const problems = [];
let scanned = 0, calls = 0;

for (const f of files) {
    let src;
    try { src = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    scanned++;
    const clean = stripStringsAndComments(src);
    for (const c of consoleCalls(clean)) {
        calls++;
        const hit = PII_RE.exec(c.args);
        if (hit) problems.push(`${f}:${c.line} — «${hit[1]}» داخل وسائط console.*  ⟨${c.args.trim().replace(/\s+/g, ' ').slice(0, 90)}⟩`);
    }
}

// 🪤 وفحصٌ لا يرى شيئاً ليس فحصاً ناجحاً: لو تغيّرت أسماءُ الملفّات أو المسارات
//    فصفرُ نداءٍ ممسوح يعني مدىً ضائعاً لا كوداً نظيفاً. (درسُ «غير موجود ليس نجاحاً».)
if (scanned < 10 || calls < 50) {
    console.error(`\n❌ البناء متوقّف: مدى فحص PII ضاع — ${scanned} ملفّاً و${calls} نداءَ console فقط.`);
    console.error('   المتوقّع عشراتُ الملفّات ومئاتُ النداءات تحت server/ و shared/.');
    console.error('   تحقّق من DIRS/EXT في scripts/check-bot-pii-logs.js قبل تصديق النتيجة.\n');
    process.exit(1);
}

if (problems.length) {
    console.error('\n❌ البناء متوقّف: بياناتُ عميلٍ في سجلّ الخادم\n');
    for (const p of problems) console.error('   • ' + p);
    console.error('\n   سجلُّ Render خارجَ جدة وخارجَ RLS وخارجَ تجهيلِ الثلاثين يوماً.');
    console.error('   اطبع **معرّفاً يُربط** بدلاً من البيانات: `m.id` لصفّ الطابور،');
    console.error('   و`st.id` لمعرّف ميتا — والمستلمُ محفوظٌ في صفّ القاعدة المفتاحُه هو.\n');
    process.exit(1);
}

console.log(`✅ لا بياناتَ عميلٍ في السجلّات: ${calls} نداءَ console في ${scanned} ملفّاً`);
