#!/usr/bin/env node
/**
 * check-verification-kinds.js — أنواعُ الوثيقة وشروطُها (v16.52)
 *
 * ── العيوبُ التي يحرسها ─────────────────────────────────────────────────
 * ① **قائمةٌ تعرض ما يرفضه الخادم.** مفاتيحُ الأدمن تُطفئ نوعاً في القاعدة؛
 *    لو بقيت الشاشةُ تمرّ على `DOC_KINDS` كلِّها لرأى التاجرُ خياراً يُرفض
 *    بعد الضغط — وهو أسوأ من إخفائه.
 * ② **حقلُ تاريخٍ لا يطابق نظامَ وثيقته.** وثيقةُ العمل الحر تنتهي فعلاً،
 *    وبلا تاريخٍ لا يصل التاجرَ تنبيهٌ أبداً ولا تنتهي أبداً — أي أن ميزةَ
 *    «نبّهني قبل الانتهاء» تكون موجودةً وميّتة. والسجلُّ التجاريُّ عكسُها:
 *    لا انتهاءَ له أصلاً، فحقلٌ له يدعو التاجرَ لاختراع تاريخ.
 * ③ **خانةُ المحاولات غيرُ موصولة.** جدولٌ يمتلئ وشاشةٌ لا تعرضه = تنبيهٌ
 *    لا يُفعل به شيء.
 * ④ **الكتابةُ تدهس المفاتيح.** `writePlatformSetting` يستبدل الكائنَ كلَّه،
 *    فحفظُ أيّ حقلٍ آخر بلا `kinds` يُعيد الأنواعَ الثلاثةَ مفتوحةً صامتاً.
 *
 * 🪤 ويُجرَّد التعليقُ قبل أيّ فحصِ نصّ: هذه الملفّاتُ تشرح في تعليقها نفسَ
 *    الأسماء التي يبحث عنها الحارس (وقع هذا الفخُّ تسعَ مرّاتٍ في المشروع).
 */
const fs = require('fs');
const path = require('path');

const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
/** تجريدُ تعليقات JS/TS — بنمطٍ لا يبتلع `accept="image/*"` (درس v16.30). */
const strip = (src) => src
    .replace(/(^[ \t]*|\{)\/\*[\s\S]*?\*\//gm, '$1')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log(`      ${detail}`);
    ok ? pass++ : fail++;
};

console.log('\nتوثيقُ التجّار — الأنواعُ وشروطُها وخانةُ التكرار');

// ── ① شاشةُ التاجر تعرض المفعَّل وحده ─────────────────────────────────────
{
    const card = strip(R('src/components/seller/VerificationCard.tsx'));
    check('شاشةُ التاجر تُرشّح الأنواع بما فتحه الأدمن',
        /availableKinds\s*=\s*DOC_KINDS\.filter/.test(card)
        && /\{availableKinds\.map\(/.test(card),
        'لم أجد ترشيحاً — القائمةُ تمرّ على DOC_KINDS كلِّها فتعرض ما يرفضه الخادم');
    check('ولا تمرّ على DOC_KINDS خاماً في التصيير',
        !/\{DOC_KINDS\.map\(/.test(card),
        'وُجد `{DOC_KINDS.map(` في التصيير — أي أن الترشيح التُفّ عليه');
    check('وحين لا نوعَ مفتوحاً تقول ذلك',
        /noKinds/.test(card) && /التوثيق متوقّف/.test(card),
        'بلا هذا الفرع يرى التاجرُ نموذجاً فارغاً بلا سبب');
}

// ── ② قاعدةُ التاريخ لكلّ نوع: الواجهةُ والقاعدة تقولان الشيءَ نفسه ───────
{
    const card = strip(R('src/components/seller/VerificationCard.tsx'));
    check('الواجهة: وثيقةُ العمل الحر تُلزم التاريخ، والسجلُّ التجاريُّ يُخفيه',
        /kind === 'cr' \? 'none' : kind === 'freelance' \? 'required' : 'optional'/.test(card),
        'قاعدةُ التاريخ غيرُ مطابقةٍ لما تفرضه القاعدة');
    check('ولا يُرسَل تاريخٌ لسجلٍّ تجاريّ',
        /rule === 'none' \? null : \(expiry \|\| null\)/.test(card),
        'يُرسَل تاريخٌ لنوعٍ لا انتهاءَ له');

    const mig = R('supabase/JEDDAH_v16_52_verification_kinds_and_dups.sql')
        .replace(/^\s*--[^\n]*$/gm, '');          // تجريدُ تعليقات SQL
    check('القاعدة: `freelance` بلا تاريخٍ تُرفض بـEXPIRY_REQUIRED',
        /p_kind = 'freelance'[\s\S]{0,400}?EXPIRY_REQUIRED/.test(mig),
        'الهجرةُ لا تُلزم تاريخَ وثيقة العمل الحر');
    check('والقاعدة: `cr` يُلغى تاريخُه (لا انتهاءَ له نظاماً)',
        /p_kind = 'cr' THEN\s*\n\s*v_expiry := NULL;/.test(mig),
        'الهجرةُ تُخزّن تاريخَ انتهاءٍ لسجلٍّ تجاريّ');
    check('والنوعُ المطفأ يُرفض في القاعدة لا في الشاشة وحدها',
        /KIND_DISABLED/.test(mig),
        'الشاشةُ تُخفي والخادمُ يقبل — طلبٌ مباشرٌ يمرّ');
}

// ── ③ خانةُ المحاولات موصولةٌ بالشاشة ─────────────────────────────────────
{
    const screen = strip(R('src/pages/admin/AdminVerification.tsx'));
    check('خانةُ المحاولات معروضةٌ في شاشة التوثيق',
        /<DupAttemptsCard\s*\/>/.test(screen),
        'الجدولُ يمتلئ ولا أحدَ يراه');
    const cardSrc = strip(R('src/components/admin/verification/DupAttemptsCard.tsx'));
    check('وتقرأ من `admin_list_dup_attempts` لا من الجدول مباشرةً',
        /adminDupAttempts/.test(cardSrc) && !/from\('verification_dup_attempts'\)/.test(cardSrc),
        'قراءةٌ مباشرةٌ تلتفّ على فحص الصلاحية في الدالّة');
    check('ولا يُعرض رقمُ وثيقةِ متجرٍ آخر كاملاً',
        /maskNum/.test(cardSrc),
        'الرقمُ معروضٌ خاماً — تسريبٌ لا داعيَ له لأدمنٍ فرعيّ');
}

// ── ④ 🔴 الكتابةُ تحمل المفاتيح — وإلّا مُحيت بصمت ────────────────────────
{
    const pol = strip(R('src/components/admin/verification/VerificationPolicyCard.tsx'));
    const m = /writePlatformSetting\(KEY,\s*\{([\s\S]*?)\}\s*,/.exec(pol);
    check('حفظُ السياسة يكتب `kinds` مع البقيّة', !!m && /kinds:\s*next\.kinds/.test(m[1]),
        'بلا هذا السطر يمحو أيُّ حفظٍ للوضعِ مفاتيحَ الأنواع ويُعيدها كلَّها مفتوحة');
    check('والمفاتيحُ الثلاثةُ تُقرأ بـ`!== false` لا `=== true`',
        /cr:\s*v\?\.kinds\?\.cr !== false/.test(pol),
        'بـ`=== true` يصير المفتاحُ الغائبُ «مطفأ» فيُغلق التوثيقُ عند أوّل قراءة');
    check('وشاشةُ التاجر تقرؤها بنفس القاعدة',
        /cr:\s*d\?\.kinds\?\.cr !== false/.test(strip(R('src/repositories/verificationRepository.ts'))),
        'انحرافُ الافتراض بين الشاشتين يُنتج شاشتين تقولان شيئين');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail === 0 ? 0 : 1);
