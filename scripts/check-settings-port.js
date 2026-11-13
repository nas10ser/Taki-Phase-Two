#!/usr/bin/env node
/**
 * حارسُ منفذ الإعدادات الواحد (v16.25) — node scripts/check-settings-port.js
 *
 * ── العيبُ الذي يحرسه ───────────────────────────────────────────────────
 * صفُّ `tax_settings` كان يُجلب **ثلاث مرّاتٍ** في فتحةٍ واحدة: دفعةً في
 * `AppContext`، ومفتاحاً مستقلّاً في `operatorIdentity` (يظهر في **كلّ** صفحةٍ
 * فيها تذييل)، وثالثاً في `useVatMode`. وقِيس على الإنتاج: نداءان
 * لـ`platform_settings` في فتحةِ الرئيسية.
 *
 *   ① كلُّ قارئٍ للإعدادات يمرّ بالمنفذ الواحد، لا بـ`from('platform_settings')`.
 *   ② و`tax_settings` في قائمة الجلب — وإلّا عاد المنفذُ بلا قيمةٍ له
 *      **بصمت** فترتدّ الشاشاتُ إلى الافتراضي وتبدو سليمة (درسُ v14.92).
 *   ③ وأيُّ حفظٍ من لوحة الضريبة يُبطل الدفعةَ — وإلّا قُدّمت القديمةُ دقيقة.
 *
 * 🪤 ويُستثنى ما يقرأ مفاتيحَ **خارج** قائمة الجلب (بوّابةُ الدفع · مفتاحُ
 *    الدفع داخل التطبيق · باقاتُ المواقع): منفذُ الدفعة لا يحملها، فتوجيهُها
 *    إليه يُرجع عدماً. الحارسُ يُقاس بالمفاتيح لا بأسماء الملفّات.
 */
const fs = require('fs');
const path = require('path');
const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '');

let pass = 0, fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? '  ✓' : '  ✗'} ${n}`); if (!ok && d) console.log('      ' + d); ok ? pass++ : fail++; };

console.log('\nمنفذُ الإعدادات الواحد');

const ps = strip(R('src/context/platformSettings.ts'));

// ② المفتاحُ في قائمة الجلب
const keysMatch = /PLATFORM_SETTING_KEYS = \[([\s\S]*?)\];/.exec(ps);
const keysBlock = keysMatch ? keysMatch[1] : '';
check('`tax_settings` داخل قائمة الجلب', /'tax_settings'/.test(keysBlock),
    'مفتاحٌ خارج القائمة يعود بعدمٍ **بلا خطأ**، فترتدّ الشاشةُ إلى الافتراضي');

// ① القرّاءُ الثلاثة يمرّون بالمنفذ
for (const [name, file] of [
    ['AppContext', 'src/context/AppContext.tsx'],
    ['operatorIdentity', 'src/data/operatorIdentity.ts'],
    ['useVatMode', 'src/hooks/useVatMode.ts'],
    ['Subscription', 'src/pages/Subscription.tsx'],
]) {
    const src = strip(R(file));
    check(`${name} يستعمل المنفذ`, /fetchPlatformSetting(Rows)?\(/.test(src));
    const direct = [...src.matchAll(/from\(\s*'platform_settings'\s*\)[\s\S]{0,180}?eq\(\s*'key'\s*,\s*'([a-z_]+)'/g)]
        .map(m => m[1]);
    const batched = direct.filter(k => new RegExp(`'${k}'`).test(keysBlock));
    check(`${name}: لا قراءةَ مباشرةٍ لمفتاحٍ في الدفعة`, batched.length === 0,
        `يقرأ مباشرةً: ${batched.join(' · ')}`);
}

// ③ الإبطالُ بعد الحفظ
const tax = strip(R('src/pages/admin/AdminTax.tsx'));
check('لوحةُ الضريبة تُبطل الدفعةَ بعد الحفظ',
    /invalidatePlatformSettings\(\)/.test(tax) && /invalidateOperatorIdentity\(\)/.test(tax),
    'بلا إبطالٍ يُقدَّم الإعدادُ القديمُ لكلّ قارئٍ حتى تنتهي المهلة');
check('والمنفذُ يُصدّر الإبطال', /export const invalidatePlatformSettings/.test(ps));

// والمنفذُ مشاركٌ للطلب الطائر لا نداءٌ لكلّ سائل
check('المنفذُ يشارك الطلبَ الطائر', /memoAsync\(\s*'platform_settings:batch'/.test(ps));

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail === 0 ? 0 : 1);
