#!/usr/bin/env node
/**
 * v15.80 — عقدُ بوّابة الموافقة: مُركَّبةٌ · غيرُ قابلةٍ للإغلاق · وكاتبٌ واحد.
 *
 * 🔴 العيبُ الذي بُنيت لأجله مقيسٌ على جدة في ٨ نوفمبر ٢٠٢٦: صفرٌ من ستّة
 *    حسابات يحمل موافقةً على الإصدار الحاليّ، وصفرٌ يحمل إقرارَ السنّ، وصفرٌ
 *    يحمل العنوانَ — وثلاثُ وثائقَ قانونيّةٍ تَعِد بالثلاثة. والسببُ أنّ
 *    الموافقةَ كانت تُسجّلها **كلُّ شاشةٍ على حدة**، فنَسِيَها مسارُ OAuth
 *    تماماً، والتعليقُ الذي يَعِد بإعادةِ محاولةٍ «عند الدخول القادم» لم
 *    يُكتَب أبداً (مطابقةٌ واحدة في المستودع، وهي التعليقُ نفسه).
 *
 * فثلاثةُ أشياء لا تُستعاد بتحريرٍ عابرٍ لو انكسرت، ولا شيءَ غيرُ هذا الفحص
 * يصرخ لو انكسرت — لأنها كلُّها تفشل **صامتةً**:
 *   ① الطبقةُ مُركَّبةٌ في `App.tsx` بلا شرط. إزالتُها تُعيد العيبَ كاملاً
 *      ولا typecheck ولا اختبارٌ يرى شيئاً.
 *   ② وهي تحمل حارسَي «لا تظهر»: مسارُ الاستعادة والمعاينةُ كمستخدم. سقوطُ
 *      الأوّل يمنع المستخدمَ من تعيين كلمته (ثمنُ v14.03/14.04)، وسقوطُ
 *      الثاني يجعل **أدمناً يُوقّع توقيعاً مُلزماً عن غيره**.
 *   ③ وكاتبُ الموافقة **واحد** (`authService.recordConsent`) — وقائمةُ
 *      السماح قائمةُ سماحٍ لا منع (المنعُ يفشل مفتوحاً، درس v14.80).
 *      وأيُّ شاشةٍ تضيف نداءَها الخاصّ تُعيد نفسَ الجذر: كلٌّ يتذكّر وحده.
 *
 * 🪤 ويُجرَّد التعليقُ قبل الفحص: حرّاسٌ في هذا المستودع أمسكوا **تعليقَهم
 *    هم** خمسَ مرّاتٍ فبرّأوا كوداً معطوباً.
 */
const fs = require('fs');
const path = require('path');
const { walk } = require('./lib/walk');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
/** يُجرَّد تعليقُ السطر وتعليقُ الكتلة وتعليقُ JSX. */
const strip = (src) => src
    .replace(/(^[ \t]*|\{)\/\*[\s\S]*?\*\//gm, '$1')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:])\/\/[^\n'"`]*$/gm, '$1');

const fail = [];

// ① مُركَّبةٌ في App.tsx، باستيرادٍ ساكنٍ وبلا شرطِ تصيير
const app = strip(read('src/App.tsx'));
if (!/import\s+ConsentGate\s+from\s+'\.\/components\/ConsentGate'/.test(app)) {
    fail.push('`src/App.tsx` لا يستورد ConsentGate استيراداً ساكناً — ومكوّنٌ كسولٌ خارج Suspense يرفع استثناءً، وtypecheck لا يراه.');
}
const mount = app.split('\n').filter((l) => /<ConsentGate\b/.test(l));
if (mount.length !== 1) {
    fail.push(`بوّابةُ الموافقة مُصيَّرةٌ ${mount.length} مرّةً في App.tsx — المطلوبُ مرّةٌ واحدة بلا شرط.`);
} else if (/&&|\?|:/.test(mount[0])) {
    fail.push(`<ConsentGate /> مُقيَّدةٌ بشرطٍ في التصيير: «${mount[0].trim()}» — وشرطٌ هنا بابٌ خلفيّ؛ مفتاحُ الإطفاء في القاعدة هو الموضعُ الصحيح.`);
}

// ② حارسا «لا تظهر» + غيرُ قابلةٍ للإغلاق
const gate = strip(read('src/components/ConsentGate.tsx'));
for (const [needle, why] of [
    ['isPasswordRecovery', 'حارسُ مسار استعادة كلمة المرور — بلا ه تمنع الطبقةُ المستخدمَ من تعيين كلمته (v14.03/14.04).'],
    ['impersonating', 'حارسُ «المعاينة كمستخدم» — بلا ه يُوقّع الأدمنُ توقيعاً مُلزماً عن غيره.'],
    ['LEGAL_VERSION', 'الإصدارُ يُقرأ من `data/legalVersion` — ورقمٌ مكتوبٌ هنا يَنحرف عن الوثائق.'],
    ['recordConsent', 'الكتابةُ تمرّ بالكاتب الواحد `authService.recordConsent` الذي يُثبتها بقراءة.'],
]) {
    if (!gate.includes(needle)) fail.push(`\`ConsentGate.tsx\` لا يذكر \`${needle}\`: ${why}`);
}
for (const [re, why] of [
    [/onClose/, 'خاصّيّةُ إغلاق — والموافقةُ لا تُؤجَّل (وهذا ما يُفرّقها عن LocationGate).'],
    [/لاحقاً|\bLater\b/, 'زرُّ «لاحقاً» — إغلاقٌ مُقنَّع.'],
    [/onKeyDown|'Escape'|"Escape"/, 'مخرجٌ بمفتاح Escape.'],
]) {
    if (re.test(gate)) fail.push(`\`ConsentGate.tsx\` صار قابلاً للإغلاق: ${why}`);
}

// ③ كاتبٌ واحد — قائمةُ سماحٍ صريحة
const ALLOWED = new Set([
    'src/services/authService.ts',                  // الكاتبُ الواحد لموافقة الشروط
    'src/components/seller/GatewayCard.tsx',        // اتفاقيّةُ بوّابةِ التاجر (p_kind:'gateway')
]);
const callers = walk(ROOT, ['src', 'server', 'shared', 'api'], /\.(ts|tsx|js|jsx)$/)
    .filter((f) => strip(read(f)).includes('record_user_consent'))
    .filter((f) => !ALLOWED.has(f));
if (callers.length) {
    fail.push(
        'مواضعُ تنادي `record_user_consent` خارج قائمة السماح: ' + callers.join(' · ') +
        '\n     والجذرُ المقيس أنّ كلَّ شاشةٍ كانت تتذكّر وحدها. الكتابةُ تمرّ بـ`authService.recordConsent`.'
    );
}

if (fail.length) {
    console.error('\n❌ البناء متوقّف: عقدُ بوّابة الموافقة\n');
    for (const f of fail) console.error('   • ' + f);
    console.error('');
    process.exit(1);
}
console.log('✅ بوّابةُ الموافقة: مُركَّبةٌ بلا شرط · حارسا الاستعادةِ والمعاينة قائمان · غيرُ قابلةٍ للإغلاق · وكاتبٌ واحد');
