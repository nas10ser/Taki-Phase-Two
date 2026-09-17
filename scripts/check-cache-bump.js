#!/usr/bin/env node
/**
 * check-cache-bump.js — هل رُفع `CACHE_NAME` حين تغيّر كودُ التطبيق؟ (v14.50)
 * ═══════════════════════════════════════════════════════════════════════════
 * القاعدة الثابتة في المشروع: `CACHE_NAME` في `sw.js` يُرفع مع كل نشرٍ يغيّر
 * كود التطبيق، وإلا بقي آيفون على نسخة قديمة بلا أن يشتكي أحد. القاعدة مكتوبة
 * منذ إصدارات، ولم يكن يحرسها شيء إلا أن أتذكّرها.
 *
 * ── لماذا «قائمة سماح» لا «قائمة منع» ──────────────────────────────────────
 * 🪤 لو عرّفنا «تغيّر كود التطبيق» بأنه «أي ملف عدا progress.md وCLAUDE.md»
 * لكان الفحص **يفشل مفتوحاً**: أوّل مجلّد مصدر جديد لا يكون في قائمة المنع،
 * فيمرّ تغييرٌ حقيقي والفحص يقول أخضر. القائمة هنا قائمة **سماح**: ما ليس
 * فيها لا يُطالِب برفع النسخة، وأي مسار جديد يجب أن يُضاف إليها عمداً.
 * فالفشل مغلق: تُنسى الإضافة ⇒ يمرّ التغيير بلا مطالبة، لا العكس… لذلك
 * تُراجَع هذه القائمة عند إضافة أي مجلّد مصدر.
 *
 * ── الاستعمال ───────────────────────────────────────────────────────────────
 *   node scripts/check-cache-bump.js <base> <head>     (الافتراضي HEAD~1 HEAD)
 * يخرج بـ1 إن تغيّر كود التطبيق ولم تتغيّر `CACHE_NAME`.
 */

const { execFileSync } = require('child_process');

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const gitSafe = (...args) => { try { return git(...args); } catch { return null; } };

const ZERO = /^0+$/;
let [base, head] = process.argv.slice(2);
head = head || 'HEAD';

// 🪤 على أوّل دفعة لفرع، وبعد أي `force-push`، تكون `github.event.before`
// أصفاراً كلها. الرجوع إلى الأب المباشر أصدق من تخطّي الفحص بصمت.
if (!base || ZERO.test(base)) base = `${head}~1`;

if (!gitSafe('rev-parse', '--verify', `${base}^{commit}`)) {
    // لا أب (أوّل كوميت في التاريخ) — لا مرجع للمقارنة.
    console.log(`ℹ️ لا يوجد مرجع سابق (${base}) — يُتخطّى فحص رفع النسخة.`);
    process.exit(0);
}

/**
 * قائمة السماح: ما يدخل حزمةَ المتصفّح أو عاملَ الخدمة فعلاً.
 * (`supabase/**` و`server/**` و`scripts/**` و`*.md` ليست منها عمداً:
 *  هجرةٌ أو تعديلُ بوت لا يغيّران ما يخزّنه المتصفّح.)
 */
const APP_PATHS = [
    /^src\//,
    /^api\//,
    /^public\//,
    /^index\.html$/,
    /^sw\.js$/,
    /^manifest\.webmanifest$/,
    /^vercel\.json$/,
    // `package-lock.json` وحده: تغيّرُ تبعيةٍ يغيّر الحزمة فعلاً، أمّا تعديل
    // `scripts` أو `engines` في `package.json` فلا يصل المتصفّح — وإدراجه
    // كان سيطلب رفع نسخةٍ بلا سبب، وطلبٌ بلا سبب يُعلّم تجاهلَ الطلب.
    /^package-lock\.json$/,
    /^\.nvmrc$/,
];

const changed = git('diff', '--name-only', base, head).split('\n').filter(Boolean);
const appChanged = changed.filter((f) => APP_PATHS.some((p) => p.test(f)));

if (appChanged.length === 0) {
    console.log(`✅ لم يتغيّر كود التطبيق بين ${base} و${head} (${changed.length} ملفاً تغيّر، لا شيء منها في حزمة المتصفّح) — لا حاجة لرفع النسخة.`);
    process.exit(0);
}

const readCache = (ref) => {
    const src = gitSafe('show', `${ref}:sw.js`);
    if (src === null) return null;
    const m = src.match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
    return m ? m[1] : null;
};

const before = readCache(base);
const after = readCache(head);

if (after === null) {
    console.error('❌ تعذّرت قراءة CACHE_NAME من sw.js — تغيّر شكل السطر أو حُذف الملف.');
    process.exit(1);
}

/** يستخرج (major, minor) من `taki-cache-vXX.YY` — أو null لو الشكل غير متوقّع. */
const semver = (name) => {
    const m = /v(\d+)\.(\d+)/.exec(name || '');
    return m ? [Number(m[1]), Number(m[2])] : null;
};

// 🪤 كشفه اختبارُ الاختبار: «تغيّرت القيمة» ليست كافية — **تخفيض** الرقم يمرّ
// منها، وهو يخلق اسماً استُعمل سابقاً فقد تبقى منه نسخةٌ مخزَّنة على الجهاز.
// المطلوب أن يتقدّم، لا أن يختلف.
const a = semver(before), b = semver(after);
if (before !== after && a && b && (b[0] < a[0] || (b[0] === a[0] && b[1] < a[1]))) {
    console.error(`
❌ CACHE_NAME تراجع بدل أن يتقدّم: ${before} ← ${after}

   الاسم القديم قد تبقى منه نسخةٌ مخزَّنة على أجهزة المستخدمين، فإعادة
   استعماله تُعيدهم إلى محتوى قديم. ارفع الرقم بدل أن تُنقصه.
`);
    process.exit(1);
}

if (before === after) {
    console.error(`
❌ كودُ التطبيق تغيّر و CACHE_NAME لم يُرفع.

   القيمة في الحالتين: ${after}

   الملفات التي تدخل حزمة المتصفّح وتغيّرت (${appChanged.length}):
${appChanged.slice(0, 20).map((f) => '     • ' + f).join('\n')}${appChanged.length > 20 ? `\n     … و${appChanged.length - 20} غيرها` : ''}

   الإصلاح: ارفع الرقم في sw.js (مثل taki-cache-v14.50) ثم أعد الدفع.
   لماذا يهمّ: بلا رفعه يبقى آيفون على النسخة القديمة ولا يظهر أي خطأ —
   يُبلّغ المستخدم أن «التعديل لم يصل» ويُبحث عن العلّة في المكان الخطأ.
`);
    process.exit(1);
}

console.log(`✅ كودُ التطبيق تغيّر (${appChanged.length} ملفاً) و CACHE_NAME رُفع: ${before} ← ${after}`);
