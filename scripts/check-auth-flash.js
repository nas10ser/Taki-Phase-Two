#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TAKI · حارسُ «ومضةِ غير المسجَّل»
 *
 * 🔴 بلاغُ ناصر (٩ نوفمبر ٢٠٢٦): «أوّلَ ما أدخل الموقع يطلع أني ماني مسجّل
 *    ثلاثَ ثوانٍ، وبعدها يدخّلني فجأة». وقِيس: `src/components/Navbar.tsx`
 *    كانت تكتب `{!user ? <زرُّ تسجيل> : <صورة>}` — شرطان لحالاتٍ **ثلاث**.
 *    فأوّلُ رسمٍ يقع قبل أن تُحسم الجلسة، و`user` حينها `null`، فتُعلن الشاشةُ
 *    «غيرُ مسجّل» **وهي لا تعلم بعد**، ثمّ تتراجع.
 *
 * والقاعدةُ التي يحرسها هذا الملفّ: **«غيرُ مسجّل» و«لا نعرف بعد» ليستا شيئاً
 * واحداً.** فأيُّ مكوّنٍ يرسم نصّاً أو زرّاً موجَّهاً لغير المسجَّل بناءً على
 * `!user` وحده، يجب أن يقرأ `isAuthReady` كذلك.
 *
 * 🪤 ولا يكفي أن يُخفى الزرُّ حتى تُحسم الجلسة: ذاك يُبطئ **الزائر الحقيقيّ**
 *    بلا سبب. ولذلك `Navbar` تقرأ `hasStoredSession()` — سؤالٌ متزامنٌ بلا
 *    شبكة — فمن له جلسةٌ محفوظة يرى مربّعاً محايداً بحجم الصورة، ومن لا جلسةَ
 *    له يرى «تسجيل» **فوراً**. وقِيس الاثنان في المتصفّح: عند ٣٢٥ م.ث مع
 *    جلسةٍ محفوظة ⇒ مربّعٌ محايد ولا «تسجيل»؛ وعند ٣٢٣ م.ث بلا جلسة ⇒
 *    «تسجيل» ولا مربّع.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { walk } = require('./lib/walk');   // 🪤 لا git: Vercel تبني من أرشيف

const ROOT = path.resolve(__dirname, '..');
const SELF = path.relative(ROOT, __filename);

/** تُجرَّد التعليقاتُ قبل أيّ فحصٍ نصّيّ — حارسٌ أمسك تعليقَه هو سبعَ مرّاتٍ هنا. */
const strip = (src) => src
    .replace(/(^[ \t]*|\{)\/\*[\s\S]*?\*\//gm, '$1')
    .replace(/^[ \t]*\/\/[^\n]*/gm, '')
    .replace(/([^:'"`\\])\/\/[^'"`\n]*$/gm, '$1');

/** نصٌّ/زرٌّ لا يُعرض إلّا لغير المسجَّل — أي ادّعاءٌ بأنه ليس مسجّلاً. */
const CTA = ['تسجيل', 'Login', 'Sign in', 'سجّل', 'يرجى تسجيل الدخول', 'goRegister'];

const errors = [];
let scanned = 0;
const flagged = [];

for (const rel of walk(ROOT, ['src'], /\.tsx$/)) {
    if (rel === SELF) continue;
    const src = strip(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    scanned++;
    const lines = src.split('\n');
    lines.forEach((line, i) => {
        // فرعٌ يتفرّع على غياب المستخدم
        if (!/\{\s*!\s*user\s*(\?|&&)/.test(line)) return;
        // والنافذةُ بعده: هل يعرض دعوةَ تسجيل؟
        const win = lines.slice(i, i + 12).join('\n');
        if (!CTA.some((c) => win.includes(c))) return;
        flagged.push(rel + ':' + (i + 1));
        if (!/isAuthReady/.test(src)) {
            errors.push(
                `${rel}:${i + 1} — دعوةُ تسجيلٍ تتفرّع على \`!user\` وحده، بلا \`isAuthReady\`.\n`
                + `     ${line.trim().slice(0, 100)}\n`
                + '     فأوّلُ رسمٍ — قبل حسم الجلسة — يقول لمستخدمٍ مسجَّلٍ إنه غيرُ مسجّل.\n'
                + '     العلاج: حالةٌ ثالثة. و`hasStoredSession()` من services/supabaseClient\n'
                + '     تُجيب متزامنةً، فلا يتأخّر الزائرُ الحقيقيُّ ولا يُكذَب على المسجَّل.'
            );
        }
    });
}

// ── إثباتٌ موجب: الترويسةُ بعينها تحمل الحالات الثلاث ──────────────────────
// 🪤 فحصٌ لا يجد مخالفةً يمرّ أخضرَ وإن أُفرغ الإصلاحُ من مضمونه. فالأرضيّةُ
//    أسماءُ الأسطح المقيسة لا عددٌ مُخترَع.
const NAV = 'src/components/Navbar.tsx';
const navPath = path.join(ROOT, NAV);
if (!fs.existsSync(navPath)) {
    errors.push(`${NAV} — غير موجود، والحارسُ مبنيٌّ عليه.`);
} else {
    const nav = strip(fs.readFileSync(navPath, 'utf8'));
    if (!/hasStoredSession/.test(nav)) {
        errors.push(`${NAV} — لا تسأل \`hasStoredSession()\`، فالحالةُ الوسطى غير مميَّزة.`);
    }
    if (!/isAuthReady/.test(nav)) {
        errors.push(`${NAV} — لا تقرأ \`isAuthReady\`.`);
    }
    if (!flagged.some((f) => f.startsWith(NAV + ':'))) {
        errors.push(
            `${NAV} — مرّ بلا رصدِ دعوةِ تسجيلٍ أصلاً، وهو السطحُ المقيسُ لهذا العيب.`
            + ' أي أنّ الكاشفَ عطب، لا أنّ الموضعَ صار آمناً.'
        );
    }
}
if (scanned < 100) {
    errors.push(`مُسِح ${scanned} ملفّاً فقط من src/ — مَسحٌ فارغٌ يُنتج «أخضرَ» كاذباً.`);
}

// ── والدالّةُ نفسُها تحكم بالرمز الصحيح ────────────────────────────────────
const CLI = 'src/services/supabaseClient.ts';
const cli = fs.existsSync(path.join(ROOT, CLI)) ? strip(fs.readFileSync(path.join(ROOT, CLI), 'utf8')) : '';
if (!/export const hasStoredSession/.test(cli)) {
    errors.push(`${CLI} — \`hasStoredSession\` غيرُ مُصدَّرة.`);
} else if (!/refresh_token/.test(cli.slice(cli.indexOf('hasStoredSession'), cli.indexOf('hasStoredSession') + 700))) {
    errors.push(
        `${CLI} — \`hasStoredSession\` لا تحكم بـ\`refresh_token\`.\n`
        + '     🪤 والحكمُ برمز الوصول خطأ: عمرُه ساعة، فعائدٌ بعد يومين جلستُه\n'
        + '     **ستُستعاد** ويُحكم عليه بأنه غيرُ مسجّل — وهو العيبُ بعينه.'
    );
}

if (errors.length) {
    console.error('\n❌ البناء متوقّف: ومضةُ «غير المسجَّل»');
    for (const e of errors) console.error('   • ' + e);
    console.error('');
    process.exit(1);
}
console.log(`✅ حالةُ الدخول: ${scanned} ملفّاً · ${flagged.length} دعوةَ تسجيلٍ كلُّها تعرف الفرق بين «غير مسجّل» و«لا نعرف بعد»`);
