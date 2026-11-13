#!/usr/bin/env node
/**
 * مرآةُ شريط البحث — **تصييرٌ حقيقيّ** لا بحثٌ نصّيّ (v16.28)
 * ═══════════════════════════════════════════════════════════════════════════
 * `check-order-search.js` يحرس **الوصلات** (أين يُنادى ماذا). وهذا الملفّ
 * يُجيب سؤالاً آخر لا يُجيبه بحثٌ نصّيّ: **ماذا يرى التاجرُ فعلاً؟**
 *
 * ولماذا لزم: لا سبيلَ لفتح لوحة التاجر على الإنتاج من هنا (تحتاج دخولاً)،
 * فالبديلُ الوحيد عن «الكود يبدو صحيحاً» هو ترجمةُ المكوّن نفسِه وتشغيلُه
 * وقراءةُ مخرجه — وهو ما يفعله هذا الملفّ بـ`renderToStaticMarkup`.
 *
 * 🪤 والمعدودُ العربيّ هو أكثرُ ما ينكسر بصمت: «١ نتائج» و«٣ نتيجة» كلاهما
 *    يُصيّر بلا خطأ، ولا يلتقطه إلّا قراءةُ النصّ المخرَج.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const root = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? '  ✓' : '  ✗'} ${n}`); if (!ok && d) console.log('      ' + d); ok ? pass++ : fail++; };

console.log('\nمرآةُ شريط البحث (تصييرٌ حقيقيّ)');

// 🪤 والمخرَجُ **داخل المشروع** لا في /tmp: المكوّن يُنادي `require('react')`،
//    وحلُّ الوحدات يصعد من موضع الملفّ — فمجلّدٌ خارجيٌّ لا يرى `node_modules`.
const out = fs.mkdtempSync(path.join(root, 'node_modules', '.cache-taki-ordsearch-'));
const srcs = [
    'src/components/seller/OrdersToolbar.tsx',
    'src/components/OrderSearchInput.tsx',
    'src/utils/arPlural.ts',
].map(p => path.join(root, p));

const tsc = cp.spawnSync('npx', ['tsc', ...srcs,
    '--outDir', out, '--rootDir', path.join(root, 'src'),
    '--module', 'commonjs', '--target', 'es2019', '--jsx', 'react',
    '--esModuleInterop', '--skipLibCheck', '--moduleResolution', 'node',
], { cwd: root, encoding: 'utf8' });

if (tsc.status !== 0) {
    check('ترجمةُ المكوّن', false, String(tsc.stdout || tsc.stderr).slice(0, 400));
    console.log(`\n❌ ${pass} ناجح · ${fail + 1} فاشل\n`);
    process.exit(1);
}
check('ترجمةُ المكوّن', true);

const React = require(path.join(root, 'node_modules', 'react'));
const { renderToStaticMarkup } = require(path.join(root, 'node_modules', 'react-dom', 'server'));
const Toolbar = require(path.join(out, 'components', 'seller', 'OrdersToolbar.js')).default;

const render = (props) => renderToStaticMarkup(React.createElement(Toolbar, Object.assign({
    filter: 'active', onFilter: () => {}, activeCount: 7, pastCount: 3,
    query: '', onQuery: () => {}, resultCount: null, searching: false, isRTL: true,
}, props)));

// ① الحقلُ موجودٌ ويَعِد بالأربعة — باللغتين
const ar = render({});
const en = render({ isRTL: false });
check('الحقلُ يظهر عربياً بوعدِه الكامل',
    ar.includes('رقم الطلب') && ar.includes('الفاتورة') && ar.includes('الجوّال') && ar.includes('المنتج'),
    'نصُّ الوعد لا يصل الشاشة');
check('ويظهر إنجليزياً كذلك',
    /order no\./i.test(en) && /invoice/i.test(en) && /phone/i.test(en) && /product/i.test(en),
    'طلبُ ناصر: «للغتين»');
check('والتبويبان بعدّاديهما', ar.includes('نشطة') && ar.includes('السجل')
    && ar.includes('>7<') && ar.includes('>3<'),
    'الشريطُ يحمل التبويبين والعددَ معاً');

// ①ب وترتيبُه: الحقلُ **فوق** التبويبين (أمرُ ناصر بعد تجربته على جواله)
check('الحقلُ يسبق التبويبين في الشجرة',
    ar.indexOf('placeholder') < ar.indexOf('نشطة'),
    'البحثُ هو الهدفُ ساعةَ الشكوى — فلا يُدفَن تحت اختيارِ تبويب');

// ② زرُّ المسح يظهر عند وجود نصٍّ وحده
check('لا زرَّ مسحٍ والحقلُ فارغ', !ar.includes('مسح البحث'));
check('ويظهر زرُّ المسح مع النصّ', render({ query: 'TK-54' }).includes('مسح البحث'),
    'بلا زرِّ مسحٍ على الجوّال يعلق المستخدمُ في نتيجةٍ لا يعرف كيف يخرج منها');

// ③ سطرُ النتائج لا يظهر إلّا أثناء البحث، ويقول «جارٍ» قبل وصولها
// 🪤 ولا يُقاس الإخفاءُ بـ«🔍»: العدسةُ أيقونةُ الحقل نفسِه وتظهر دائماً.
//    (أمسكها التصييرُ الحقيقيّ — وكان بحثٌ نصّيٌّ سيُصدّق الادّعاء.)
check('سطرُ النتائج مخفيٌّ بلا بحث',
    !ar.includes('نتيجة') && !ar.includes('نتائج') && !ar.includes('جارٍ البحث'));
check('و«جارٍ البحث» قبل وصول العدد',
    render({ searching: true, query: 'x', resultCount: null }).includes('جارٍ البحث'),
    'عرضُ «0 نتيجة» أثناء التحميل يقول «لا شيء» عن بحثٍ لم يبدأ');

// ④ المعدودُ العربيّ — خمسُ صيغٍ لا صيغة
const counted = (n, rtl = true) => render({ searching: true, query: 'x', resultCount: n, isRTL: rtl });
for (const [n, want] of [[0, '0 نتيجة'], [1, 'نتيجة واحدة'], [2, 'نتيجتان'], [3, '3 نتائج'], [11, '11 نتيجة']]) {
    check(`المعدود ${n} ⇒ «${want}»`, counted(n).includes(want),
        'صيغةٌ واحدة لكلّ الأعداد خطأٌ عربيّ ظاهرٌ للمستخدم');
}
// 🪤 و`enCount` تكتب الصغيرَ حروفاً («one result» · «two results») كما تفعل
//    في الساعات — فتوقُّع «1 result» كان خطأَ الاختبار لا خطأَ الكود.
check('والإنجليزيّ يُفرد ويجمع', counted(1, false).includes('one result')
    && counted(2, false).includes('two results')
    && counted(3, false).includes('3 results')
    && !counted(1, false).includes('one results'),
    '«one results» خطأٌ بالإنجليزية كذلك');

// ⑤ ويقول في أيّ تبويبٍ وجد
check('سطرُ النتائج يُسمّي التبويب',
    counted(3).includes('النشطة') && render({
        searching: true, query: 'x', resultCount: 3, filter: 'history',
    }).includes('السجل'),
    'عددٌ بلا موضعٍ يُوهم أن النتائج من القائمتين معاً');

fs.rmSync(out, { recursive: true, force: true });
console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail === 0 ? 0 : 1);
