#!/usr/bin/env node
/**
 * قفلُ التوثيق في لوحة التاجر — اختبارٌ **تنفيذيّ** على دالّة القرار نفسِها.
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 أمرُ ناصر (١٨ نوفمبر ٢٠٢٦): «اجعلها رماديه الى التوثيق: ساعات عمل المحل
 *    وسياسة الاسترداد وما تحتها، حتى يتم توثيق المتجر».
 *
 * 🔴 **والخطرُ هنا معكوسُ المعتاد**: العيبُ الأسوأ ليس «لم يُقفل» بل «قُفل
 *    على من يحقّ له». قفلٌ خاطئٌ يُرمِّد لوحةَ تاجرٍ مسموحٍ له فيظنّ متجرَه
 *    معطّلاً — ولا رسالةَ خطأٍ تقول له إن الخطأ عندنا. فالاختبارُ يُثبت
 *    **المسموحَ أوّلاً** ثمّ الممنوع.
 *
 * والقاعدة: الترميدُ وعدٌ بأن «الخادمَ لن يقبل هذا». فكلُّ حالةٍ يقبلها
 * الخادمُ يجب أن تبقى مفتوحة:
 *   · الوضع `off`      — التوثيقُ مُطفأ ولا شيء يُمنع.
 *   · الوضع `advisory` — النشرُ **مفتوحٌ تماماً** (نصُّ وصف الوضع في اللوحة).
 *   · مهلةٌ انتقاليّة سارية — امتيازُ نشرٍ صريحٌ منحه الأدمن.
 *   · حالةٌ لم تُحسم بعد — لا يُقفل شيءٌ ريثما يُجيب الخادم.
 */
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'node_modules', '.cache-verify-lock');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log('      ' + detail);
    ok ? pass++ : fail++;
};

console.log('\nقفلُ التوثيق — المسموحُ يبقى مفتوحاً، والممنوعُ وحده يُرمَّد');

fs.rmSync(out, { recursive: true, force: true });
let computeVerifyLock;
try {
    cp.execFileSync('npx', ['tsc', path.join(root, 'src/components/seller/verifyLockRule.ts'),
        '--outDir', out, '--rootDir', root, '--module', 'commonjs', '--target', 'es2020',
        '--skipLibCheck', '--esModuleInterop'],
    { cwd: root, stdio: 'pipe' });
    fs.cpSync(path.join(root, 'shared'), path.join(out, 'shared'), { recursive: true });
    ({ computeVerifyLock } = require(path.join(out, 'src/components/seller/verifyLockRule.js')));
} catch (e) {
    check('ترجمةُ `VerifyLock.tsx`', false, String(e.stdout || e.message).slice(0, 500));
    console.log(`\n❌ قفلُ التوثيق: ${pass} ناجحاً · ${fail} فاشلاً`);
    process.exit(1);
}

const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);          // ١٨ نوفمبر ٢٠٢٦ ظهراً
const iso = (deltaMs) => new Date(NOW + deltaMs).toISOString();
const S = (mode, verified, graceUntil = null) => ({ mode, verified, graceUntil });

// ── ⓪ الأدمن: لا رماد عليه إطلاقاً (أمرُ ناصر ١٩ نوفمبر) ─────────────────
// 🔴 وهذا أوّلُ ما يُفحص: متجرُ «تاكي» مملوكٌ لحساب أدمن، وترميدُ لوحته
//    يُطفئ كتالوجَ المنصّة نفسَه.
check('أدمن + required + غيرُ موثّق ⇒ لا قفل',
    computeVerifyLock(S('required', false, null), NOW, 'admin') === false);
check('أدمن ولو انتهت مهلتُه ⇒ لا قفل',
    computeVerifyLock(S('required', false, iso(-864e5)), NOW, 'admin') === false);
check('والتاجرُ في نفس الحالة **يُقفل** (الاستثناءُ للأدمن وحده)',
    computeVerifyLock(S('required', false, null), NOW, 'seller') === true);
check('ونوعٌ غيرُ معروفٍ لا يُعفى',
    computeVerifyLock(S('required', false, null), NOW, undefined) === true);

// ── ① المسموحُ يبقى مفتوحاً — وهذه هي الحالاتُ التي تُعطّل متجراً لو أخطأنا ──
check('الحالةُ لم تُحسم بعد ⇒ لا قفل', computeVerifyLock(null, NOW) === false);
check('الوضع off ⇒ لا قفل', computeVerifyLock(S('off', false), NOW) === false);
check('الوضع advisory (النشرُ مفتوح) ⇒ لا قفل', computeVerifyLock(S('advisory', false), NOW) === false);
check('required + موثّق ⇒ لا قفل', computeVerifyLock(S('required', true), NOW) === false);
check('required + مهلةٌ سارية (يوم) ⇒ لا قفل',
    computeVerifyLock(S('required', false, iso(864e5)), NOW) === false);
check('required + مهلةٌ سارية بدقيقة ⇒ لا قفل',
    computeVerifyLock(S('required', false, iso(60_000)), NOW) === false);
check('موثّقٌ ومعه مهلةٌ منتهية ⇒ لا قفل (التوثيقُ يكفي)',
    computeVerifyLock(S('required', true, iso(-864e5)), NOW) === false);

// ── ② الممنوعُ يُرمَّد ────────────────────────────────────────────────────
check('required + غيرُ موثّق + بلا مهلة ⇒ قفل',
    computeVerifyLock(S('required', false, null), NOW) === true);
check('required + مهلةٌ انتهت أمس ⇒ قفل',
    computeVerifyLock(S('required', false, iso(-864e5)), NOW) === true);
check('required + مهلةٌ انتهت قبل ثانية ⇒ قفل',
    computeVerifyLock(S('required', false, iso(-1000)), NOW) === true);

// ── ③ قيمةٌ فاسدةٌ في المهلة لا تفتح القفل خلسةً ─────────────────────────
// 🪤 `new Date('غير تاريخ')` تعطي NaN، و`NaN > now` كاذب — فيبقى القفل.
check('مهلةٌ بنصٍّ فاسد ⇒ قفل (لا تُقرأ امتيازاً)',
    computeVerifyLock(S('required', false, 'ليس تاريخاً'), NOW) === true);
check('مهلةٌ فارغة ⇒ قفل', computeVerifyLock(S('required', false, ''), NOW) === true);

// ── ④ الحدُّ بالضبط: اللحظةُ نفسُها ليست «سارية» ──────────────────────────
check('مهلةٌ تنتهي في هذه اللحظة ⇒ قفل',
    computeVerifyLock(S('required', false, iso(0)), NOW) === true);

// ═══════════════════════════════════════════════════════════════════════════
// جدولُ «هل يُطالَب بالدفع؟» — بعبارة ناصر حرفاً
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 تأكيدُ ناصر (١٩ نوفمبر ٢٠٢٦): «طبعاً في حال التوثيق ليس إلزامياً وتم وضع
//    إلزام الدفع، فإنه **يلزم الدفع**».
//    أي أن تأجيلَ الدفع ليس عاماً: هو مقصورٌ على من **يمنعه التوثيقُ من
//    النشر**. ومن يستطيع النشرَ يدفع.
//
// 🪤 والرابطُ في `SellerDashboard.checkSub` سطرٌ واحد:
//        if (verifyLocked) { setIsSubscriptionValid(true); return; }
//    فـ«الدفعُ مؤجَّل» ⇔ `computeVerifyLock(...) === true` بالضبط. ولذلك
//    يُفحص الجدولُ هنا بعبارة الدفع لا بعبارة القفل: لو انقلب المعنى يوماً
//    سقط هذا القسمُ وإن بقي قسمُ القفل أخضر.
const paymentDeferred = (state, userType) => computeVerifyLock(state, NOW, userType);

console.log('\n  — هل يُطالَب التاجرُ بالدفع؟ (إلزامُ الدفع مفعَّل) —');

// ① التوثيقُ **ليس** إلزامياً ⇒ يلزم الدفع (نصُّ تأكيد ناصر)
check('التوثيق مُطفأ (off) + غيرُ موثّق ⇒ **يلزم الدفع**',
    paymentDeferred(S('off', false), 'seller') === false);
check('التوثيق «نصيحة» (advisory) + غيرُ موثّق ⇒ **يلزم الدفع**',
    paymentDeferred(S('advisory', false), 'seller') === false);
check('التوثيق «نصيحة» ولو انتهت مهلتُه ⇒ **يلزم الدفع**',
    paymentDeferred(S('advisory', false, iso(-864e5)), 'seller') === false);

// ② التوثيقُ إلزاميٌّ وهو موثّق ⇒ يستطيع النشر ⇒ يلزم الدفع
check('إلزاميّ + موثّق ⇒ **يلزم الدفع**',
    paymentDeferred(S('required', true), 'seller') === false);
check('إلزاميّ + مهلةٌ انتقاليّةٌ سارية (يستطيع النشر) ⇒ **يلزم الدفع**',
    paymentDeferred(S('required', false, iso(864e5)), 'seller') === false);

// ③ الحالةُ الوحيدة التي يُؤجَّل فيها: ممنوعٌ من النشر بسبب التوثيق
check('إلزاميّ + غيرُ موثّق + بلا مهلة ⇒ يُؤجَّل الدفع وحدها',
    paymentDeferred(S('required', false, null), 'seller') === true);

// ④ والأدمن لا يُطالَب أصلاً (ليس تاجراً يدفع)
check('الأدمن: لا قفلَ ولا مطالبة',
    paymentDeferred(S('required', false, null), 'admin') === false);

console.log(`\n${fail ? '❌' : '✅'} قفلُ التوثيق: ${pass} ناجحاً · ${fail} فاشلاً`);
process.exit(fail ? 1 : 0);
