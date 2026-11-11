#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TAKI · حارسُ «البريد لا يخرج إلّا بكلمةٍ صحيحة»
 *
 * 🔴 الثغرةُ التي أُغلقت (v15.86): `find_email_by_phone` ممنوحةٌ لـ`anon`،
 *    وكان المتصفّحُ يناديها **قبل** كلمة المرور ليحسم البريد — فمن يعرف رقمَ
 *    جوّالِ عميلٍ يعرف بريدَه. والبديلُ (دخولُ GoTrue بالجوّال مباشرةً)
 *    مستحيلٌ هنا: قِيس على الخادم `GOTRUE_EXTERNAL_PHONE_ENABLED=false`.
 *    ⇒ `supabase/functions/phone-login` تحسم البريدَ بالخدمة.
 *
 * والقواعدُ التي يحرسها هذا الملفّ — كلُّها مقيسةٌ لا مفترَضة:
 *   ١) المتصفّحُ ينادي `phone-login` **قبل** `find_email_by_phone`.
 *   ٢) ويقرأ جسمَ الردّ من `error.context`: قِيس على supabase-js 2.45 أن
 *      `invoke` تُعيد `data=null` عند ٤٠٠ وتضع الجسمَ في `error.context`.
 *      فبلا ذلك يسقط كلُّ رفضٍ إلى المسار القديم **برمزِ كابتشا مستهلَك**
 *      (الرمزُ يُستعمل مرّةً واحدة) ⇒ فشلٌ مزدوجٌ دائمٌ بلا سببٍ ظاهر.
 *   ٣) والدالّةُ تُنادي GoTrue **في الحالتين** — ولو لم يُعثر على بريد —
 *      وإلّا صار زمنُ الردّ واستهلاكُ الرمز عرّافَين عن وجود الحساب.
 *   ٤) وتُمرّر `x-forwarded-for` حرفياً إلى القاعدة وإلى GoTrue: قِيس أن
 *      GoTrue يسجّل **نفسَ العنوان** في المسارين (167.86.169.23 في الاختبار)،
 *      وهو العنوانُ الذي يُرسَل إلى Cloudflare مع رمز الكابتشا.
 *   ٥) ولا تُسجَّل كلمةُ المرور في أيّ سجلّ.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];

const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '');

const read = (rel) => {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { errors.push(`${rel} — غير موجود، والحارسُ مبنيٌّ عليه.`); return null; }
    return strip(fs.readFileSync(p, 'utf8'));
};

// ── طرفُ المتصفّح ──────────────────────────────────────────────────────────
const AUTH = 'src/services/authService.ts';
const auth = read(AUTH);
if (auth) {
    const iInvoke = auth.indexOf("invoke('phone-login'");
    const iRpc = auth.indexOf("rpc('find_email_by_phone'");
    if (iInvoke === -1) {
        errors.push(`${AUTH} — لا ينادي \`phone-login\`؛ فالبريدُ ما زال يُحسم في المتصفّح.`);
    } else if (iRpc !== -1 && iRpc < iInvoke) {
        errors.push(
            `${AUTH} — \`find_email_by_phone\` تُنادى **قبل** \`phone-login\`.\n`
            + '     فالبريدُ يصل المتصفّحَ قبل كلمة المرور، وهي الثغرةُ بعينها.'
        );
    }
    if (!/error\s*\.\s*context|fErr\?\.context|fErr\.context/.test(auth)) {
        errors.push(
            `${AUTH} — لا يقرأ جسمَ الردّ من \`error.context\`.\n`
            + '     قِيس على supabase-js 2.45: `invoke` تُعيد `data=null` عند ٤٠٠ والجسمُ في\n'
            + '     `error.context`. فبلا قراءته يسقط كلُّ رفضٍ إلى المسار القديم برمزِ\n'
            + '     كابتشا مستهلَك — والرمزُ يُستعمل مرّةً واحدة ⇒ فشلٌ مزدوجٌ دائم.'
        );
    }
    if (!/setSession\s*\(/.test(auth)) {
        errors.push(`${AUTH} — لا يُثبّت الجلسةَ العائدة بـ\`setSession\`.`);
    }
    // 🔴 **الشرطُ انقلب في v15.92**: كانت شبكةُ أمانٍ (مفتاحُ `sessionStorage`
    //    وارتدادٌ إلى `find_email_by_phone`) مطلوبةً حتى يُقاس المسارُ الخادميّ.
    //    وقد قِيس بحركةٍ حقيقيّة (دخولٌ ناجحٌ ٢٠٢٦-١١-١١ ٠٢:٢٤، مطابقٌ لجلسةٍ في
    //    `auth.sessions` ولـ`status:200` في سجلّ GoTrue)، ثمّ سُحب منحُ `anon`
    //    عن الدالّة. فالارتدادُ إليها اليومَ **يفشل دائماً**، ويُحوّل فشلَ
    //    كابتشا عابراً إلى فشلٍ دائمٍ لبقيّة الجلسة. ⇒ صفرُ نداءٍ منه.
    for (const [f, src] of [[AUTH, auth], ['src/pages/Register.tsx',
        fs.existsSync(path.join(ROOT, 'src/pages/Register.tsx'))
            ? strip(fs.readFileSync(path.join(ROOT, 'src/pages/Register.tsx'), 'utf8')) : '']]) {
        if (/\brpc\(\s*['"]find_email_by_phone['"]/.test(src)) {
            errors.push(
                `${f} — ينادي \`find_email_by_phone\` من المتصفّح.\n`
                + '     منحُ `anon` عنها مسحوب (v15.87) فالنداءُ يفشل دائماً،\n'
                + '     والبريدُ من الرقم هو التسريبُ الذي أُغلق. استعمل `phone-login`.'
            );
        }
    }
}

// ── دالّةُ الحافة ──────────────────────────────────────────────────────────
const FN = 'supabase/functions/phone-login/index.ts';
const fn = read(FN);
if (fn) {
    const rules = [
        // 🪤 ونهايةُ الاسم مشترطة: كسرةٌ بإعادةِ تسميةٍ جزئيّة
        //    (`taki_phone_login_gate_X`) كانت تمرّ على نمطٍ بلا حدّ.
        ['تنادي بوّابةَ القاعدة', /taki_phone_login_gate(?![A-Za-z0-9_])/],
        ['تمرّر x-forwarded-for إلى القاعدة', /global:\s*\{\s*headers:[\s\S]{0,120}x-forwarded-for/],
        ['تمرّر x-forwarded-for إلى GoTrue', /fetch\([\s\S]{0,600}x-forwarded-for/],
        ['تُفرّق الكابتشا عن بقيّة الرفض', /captcha_failed/],
        ['تُعيد رفضاً موحّداً', /invalid_credentials/],
        ['تُسجّل علامةَ النجاح', /taki_phone_login_mark(?![A-Za-z0-9_])/],
    ];
    for (const [name, re] of rules) {
        if (!re.test(fn)) errors.push(`${FN} — ${name}: غير موجود.`);
    }

    // 🪤 **تُنادى GoTrue في الحالتين**: لا عودةَ مبكّرة حين لا يُعثر على بريد.
    //    الدليلُ البنيويّ: بريدٌ بديلٌ يُبنى ويُستعمل هدفاً.
    if (!/no-such-account\.invalid/.test(fn) || !/const\s+target\s*=\s*email\s*\|\|/.test(fn)) {
        errors.push(
            `${FN} — لا يوجد نداءُ GoTrue للحالة التي لا بريدَ فيها.\n`
            + '     فزمنُ الردّ واستهلاكُ رمز الكابتشا يصيران عرّافَين عن وجود الحساب.'
        );
    }
    // 🪤 والنطاقُ **مسارُ الدخول وحده**: فرعا «استعادة» و«تحقّق الرمز» تعودان
    //    عند `!email` عمداً (الأولى تقول `found:false` — وهو سلوكُ الواجهة
    //    القائم وقرارُ منتجٍ لا أمن، والثانية ترفض رفضاً موحّداً). ومنعٌ شاملٌ
    //    هنا كان سيتّهم كوداً صحيحاً، وإضعافُ الحارس لإسكاته أسوأُ من الاثنين.
    const loginFrom = fn.indexOf('const probeEmail');
    if (loginFrom === -1) {
        errors.push(`${FN} — لم يُعثر على \`probeEmail\`، فلا يمكن تحديدُ مسار الدخول.`);
    } else if (/if\s*\(\s*!\s*email\s*\)\s*return/.test(fn.slice(loginFrom))) {
        errors.push(`${FN} — عودةٌ مبكّرة عند \`!email\` في **مسار الدخول** — تُعيد العرّافَ الزمنيّ.`);
    }

    // ── وفرعا الاستعادة: لا يخرج بريدٌ كاملٌ منهما أبداً ───────────────────
    for (const [needle, name] of [['action === "recover"', 'فرعُ إرسال الاستعادة'],
                                  ['action === "verify"', 'فرعُ تحقّق الرمز']]) {
        if (!fn.includes(needle)) errors.push(`${FN} — ${name} غير موجود؛ فمسارُ «نسيت كلمة المرور» ما زال يحسم البريدَ في المتصفّح.`);
    }
    if (!/masked:\s*maskEmail\(email\)/.test(fn)) {
        errors.push(`${FN} — فرعُ الاستعادة لا يُعيد بريداً **مُقنَّعاً**؛ وإعادتُه كاملاً هي الثغرةُ بعينها.`);
    }
    // 🪤 ولا يُعاد `email` عارياً في أيّ جسم ردّ
    for (const m of fn.match(/json\(\s*\{[^}]*\bemail\b[^}]*\}/g) || []) {
        if (!/masked/.test(m)) errors.push(`${FN} — جسمُ ردٍّ يحمل \`email\` بلا تقنيع: ${m.slice(0, 70)}`);
    }

    // 🔇 ولا تُطبع كلمةُ المرور إطلاقاً
    for (const m of fn.match(/console\.[a-z]+\([^\n]*/g) || []) {
        if (/password|captchaToken|\bemail\b|phone/.test(m)) {
            errors.push(`${FN} — سجلٌّ قد يحمل بياناً حسّاساً: ${m.slice(0, 80)}`);
        }
    }
}

// ── طرفُ القاعدة: الهجرةُ موجودةٌ وتُبقي شبكةَ الأمان عمداً ────────────────
const MIG = 'supabase/JEDDAH_v15_86_phone_login.sql';
const mig = read(MIG);
if (mig) {
    if (!/TAKI_LAB_TOKYO_MARKER_v1382/.test(mig)) {
        errors.push(`${MIG} — بلا حارسِ المختبر.`);
    }
    if (!/RAISE EXCEPTION 'فشل التحقّق/.test(mig)) {
        errors.push(`${MIG} — بلا كتلةِ تحقّقٍ ترفع استثناءً (جدولُ ✅/❌ لا يُفشل psql).`);
    }
    if (/REVOKE[^\n]*find_email_by_phone[^\n]*anon/i.test(mig)) {
        errors.push(
            `${MIG} — تسحب منحَ \`anon\` عن \`find_email_by_phone\`.\n`
            + '     سحبُه قبل أن يُقاس دخولٌ حقيقيٌّ على المسار الجديد يقطع الدخولَ\n'
            + '     بالجوّال عن الجميع بلا شبكةِ أمان. مكانُه هجرةٌ ثانيةٌ مشروطةٌ بالعدّاد.'
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// وتُحلَّل دوالُّ الحافة فعلاً — لا تُقرأ نصّاً
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 عيبٌ أدخلتُه في ١١ نوفمبر ٢٠٢٦ وأوقف الدالّة على الإنتاج فوراً:
//    `let … code = ""` ثمّ `const code = …` أدناه ⇒
//    `SyntaxError: Identifier 'code' has already been declared`، فردّت ٥٠٠
//    على **كلّ** طلب. و`npm run typecheck` لا يراها: ملفّات Deno خارج مشروع
//    TypeScript، والحارسُ كان يقرأ النصّ ولا يُحلّله.
// 🪤 و`--noResolve` مقصود: الاستيراداتُ من `https://esm.sh` لا تُحَلّ هنا،
//    لكنّ أخطاءَ البنية والتعريفِ المكرّر تُكشف كلُّها.
{
    const { execFileSync } = require('child_process');
    const fnDir = path.join(ROOT, 'supabase/functions');
    const files = [];
    for (const d of fs.readdirSync(fnDir, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        for (const f of fs.readdirSync(path.join(fnDir, d.name))) {
            if (f.endsWith('.ts')) files.push(path.join('supabase/functions', d.name, f));
        }
    }
    if (files.length < 8) {
        errors.push(`مُسِح ${files.length} ملفَّ دالّةٍ فقط — مَسحٌ فارغٌ يُنتج «أخضرَ» كاذباً.`);
    }
    // 🪤 **ملفٌّ واحدٌ في كلّ نداء**: مع `--noResolve` تصير الملفّاتُ بلا
    //    استيرادٍ «سكربتات» تتشارك النطاقَ العامّ، فيتّهم `const json` في
    //    `stock-oauth` نظيرَه في دالّةٍ أخرى بـ«إعادة تعريف» — إيجابيّةٌ كاذبة
    //    تُفشل البناءَ على كودٍ سليم. والعزلُ يُنهيها.
    const real = [];
    for (const f of files) {
        try {
            execFileSync('npx', ['tsc', '--noEmit', '--noResolve', '--skipLibCheck',
                '--allowImportingTsExtensions', '--target', 'es2022', '--module', 'esnext',
                '--moduleResolution', 'bundler', f],
                { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (e) {
            const out = String((e.stdout || '') + (e.stderr || ''));
            // 🪤 **قائمةُ سماحٍ لا منع**: نفحص ما لا يعتمد على مكتبةِ البيئة —
            //    أخطاءُ البنية كلُّها (TS1xxx) و«معرّفٌ مكرّر» و«استُعمل قبل
            //    تعريفه». وما عداها تحكمه أنواعُ Deno التي لا يملكها `tsc`
            //    هنا، فتظهر إيجابيّاتٌ كاذبة (مثال مقيس: `crypto.subtle`
            //    في `telegram-auth` ⇒ TS2769 على كودٍ يعمل في الإنتاج).
            //    والمنعُ يفشل مفتوحاً — والسماحُ يفشل مغلقاً، وهو المطلوب هنا.
            for (const l of out.split('\n')) {
                if (/error TS1\d{3}\b/.test(l) || /error TS(2300|2451|2448|2403)\b/.test(l)) real.push(l);
            }
        }
    }
    if (real.length) {
        errors.push('دوالُّ الحافة لا تُحلَّل:\n     ' + real.slice(0, 6).join('\n     '));
    }
}

if (errors.length) {
    console.error('\n❌ البناء متوقّف: الدخولُ بالجوّال');
    for (const e of errors) console.error('   • ' + e);
    console.error('');
    process.exit(1);
}
console.log('✅ الدخولُ بالجوّال: البريدُ والاستعادةُ وتحقّقُ الرمز كلُّها على الخادم · الرفضُ موحّد · العنوانُ يُمرَّر حرفياً · وكلُّ دوالّ الحافة تُحلَّل');
