#!/usr/bin/env node
/**
 * «عند رفع الباقة يتعذّر التفعيل» — اختبارٌ تنفيذيٌّ على الرسالة والمسار.
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 بلاغُ ناصر (١٩ نوفمبر ٢٠٢٦). والسببُ مقيسٌ لا مُخمَّن:
 *    `paymentService.initiateMoyasarPayment` **محاكاةٌ** ترجع نجاحاً بعد
 *    ١٥٠٠ م.ث، ثمّ `_taki_sub_payment_ok` على الخادم تشترط دفعةً حقيقيّةً
 *    بمرجعِ بوّابة — فالنتيجةُ حتميّة: `payment_not_confirmed`.
 *
 * 🔴 **والحارسُ لا يُمسّ**: هو سدُّ ثغرةِ v15.40 (كان أيُّ تاجرٍ يمنح نفسه
 *    أيَّ باقةٍ مجّاناً). فهذا الفحصُ يُثبت أنّ مسارَ التاجر ما زال يمرّ به،
 *    وأنّ المخرجَ الجديد **للأدمن وحده** وبنداءٍ محروسٍ على الخادم.
 */
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'node_modules', '.cache-subscribe-error');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log('      ' + detail);
    ok ? pass++ : fail++;
};

console.log('\nرفعُ الباقة');

fs.rmSync(out, { recursive: true, force: true });
let subscribeErrorMessage;
try {
    cp.execFileSync('npx', ['tsc', path.join(root, 'src/utils/subscribeError.ts'),
        '--outDir', out, '--rootDir', root, '--module', 'commonjs', '--target', 'es2020',
        '--skipLibCheck', '--esModuleInterop'], { cwd: root, stdio: 'pipe' });
    ({ subscribeErrorMessage } = require(path.join(out, 'src/utils/subscribeError.js')));
} catch (e) {
    check('ترجمةُ `subscribeError.ts`', false, String(e.stdout || e.message).slice(0, 500));
    console.log(`\n❌ رفعُ الباقة: ${pass} ناجحاً · ${fail} فاشلاً`);
    process.exit(1);
}

// ── ① كلُّ رمزٍ يُنتج جملةً عربيّة، بلا لغةِ قاعدةِ بيانات ───────────────
const CODES = ['payment_not_confirmed', 'not_authenticated', 'not_a_merchant',
               'unknown_package', 'package_inactive'];
for (const c of CODES) {
    const m = subscribeErrorMessage(c, true);
    check(`«${c}» ⇒ جملةٌ عربيّة بلا الرمز`,
        /[؀-ۿ]/.test(m) && !m.includes(c), m.slice(0, 80));
}
check('والرسالةُ الإنجليزيّة بلا عربيّة',
    !/[؀-ۿ]/.test(subscribeErrorMessage('payment_not_confirmed', false)));

// 🪤 الرمزُ المجهول يبقى بين قوسين للتشخيص، لكنّ الجملةَ تسبقه
const unknown = subscribeErrorMessage('weird_db_thing_42', true);
check('ورمزٌ مجهول ⇒ جملةٌ أوّلاً ثمّ الرمزُ بين قوسين',
    /[؀-ۿ]/.test(unknown) && unknown.indexOf('weird_db_thing_42') > 20, unknown.slice(0, 60));
check('وفراغٌ/undefined لا يُنتج قوسين فارغين',
    !subscribeErrorMessage(undefined, true).includes('()')
    && !subscribeErrorMessage('', true).includes('()'));

// ── ② وكلُّ رسالةٍ تحمل خطوةً تالية، لا وصفَ عطل ─────────────────────────
for (const c of CODES) {
    const m = subscribeErrorMessage(c, true);
    check(`«${c}» تقول ماذا يفعل`,
        /(أعِد|احفظ|افتح|اختر|حدّث|سجّل|حاول)/.test(m), m.slice(0, 70));
}

// ── ③ والمسارات: التاجرُ يمرّ بالحارس، والأدمنُ بنداءٍ محروسٍ غيره ───────
const strip = (s) => s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^[ \t]*|\{)\/\*[\s\S]*?\*\//gm, '$1')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '');
const sub = strip(fs.readFileSync(path.join(root, 'src/pages/Subscription.tsx'), 'utf8'));

check('مسارُ التاجر ما زال يمرّ بـ`subscribe_self_to_package`',
    sub.includes("'subscribe_self_to_package'"),
    'حذفُه يعني منحَ باقاتٍ بلا تأكيدِ دفع — ثغرةُ v15.40 ثانيةً');
check('والمخرجُ الجديد مشروطٌ بكون المستخدم أدمن',
    /userType === 'admin'[\s\S]{0,120}applyAsAdmin/.test(sub),
    'بلا الشرط يصير متاحاً للتجّار');
check('والأدمنُ يطبّق عبر `adminService.applySubscription` (محروسةٌ على الخادم)',
    /applyAsAdmin[\s\S]{0,900}adminService\.applySubscription/.test(sub));
check('ولا يُطبع رمزُ الخادم خاماً في أيّ تنبيه',
    !/تعذّر تفعيل الاشتراك: /.test(sub),
    'الرسالةُ القديمة كانت تُلحق `payment_not_confirmed` حرفياً');
check('والترجمةُ مستعملةٌ فعلاً', /subscribeErrorMessage\(/.test(sub));

console.log(`\n${fail ? '❌' : '✅'} رفعُ الباقة: ${pass} ناجحاً · ${fail} فاشلاً`);
process.exit(fail ? 1 : 0);
