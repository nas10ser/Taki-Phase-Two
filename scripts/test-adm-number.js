#!/usr/bin/env node
/**
 * حقلُ الرقم في اللوحة — اختبارٌ **تنفيذيّ** على الدالّتين اللتين يناديهما.
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 العيبان (بلاغُ ناصر بلقطةٍ مُعلَّمة، ١٧ نوفمبر ٢٠٢٦):
 *    ① «عند محاوله مسح عدد الايام ... يجبرني ان يكون رقم واحد» — النمطُ
 *       `Number(e.target.value) || 1` يحوّل الفراغَ إلى ١، فيستحيل المسح.
 *    ② «اريد الادخال يدعم اللغة العربيه كسائر الموقع» — `type="number"`
 *       يرفض «٣٠» في سفاري iOS فتعود القيمةُ فارغة.
 *
 * 🪤 ولا تُعاد كتابةُ المنطق هنا: تُترجَم الوحدةُ الحقيقيّة وتُشغَّل دالّتاها
 *    نفسُهما — وهما اللتان يناديهما `AdmNumber` في `onChange` و`onBlur`.
 *    (درسُ v15.81: حارسٌ يقارن **إعادةَ تنفيذٍ مكتوبةً فيه** يمرّ أخضرَ
 *     بينما الكودُ الحقيقيُّ مكسور.)
 *
 * 🪤 و`shared/` يُنسخ إلى مخرَج الترجمة: `helpers.ts` يستورد `shared/phone`
 *    وهو JavaScript لا يُصدره `tsc`، فبلا النسخ يفشل التحميلُ بـ
 *    «Cannot find module '../../shared/phone'» — وهو فشلُ أداةٍ لا فشلُ كود.
 */
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'node_modules', '.cache-adm-number');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log('      ' + detail);
    ok ? pass++ : fail++;
};

console.log('\nحقلُ الرقم في اللوحة — المسحُ والأرقامُ العربية');

fs.rmSync(out, { recursive: true, force: true });
let mod;
try {
    cp.execFileSync('npx', ['tsc', path.join(root, 'src/components/admin/ui/AdmNumber.tsx'),
        '--outDir', out, '--rootDir', root, '--module', 'commonjs', '--target', 'es2020',
        '--jsx', 'react', '--skipLibCheck', '--esModuleInterop'],
    { cwd: root, stdio: 'pipe' });
    fs.cpSync(path.join(root, 'shared'), path.join(out, 'shared'), { recursive: true });
    mod = require(path.join(out, 'src/components/admin/ui/AdmNumber.js'));
} catch (e) {
    check('ترجمةُ `AdmNumber.tsx`', false, String(e.stdout || e.message).slice(0, 400));
    console.log(`\n❌ حقلُ الرقم: ${pass} ناجحاً · ${fail} فاشلاً`);
    process.exit(1);
}

const { admNumSanitize: S, admNumCommit: C, AdmNumber } = mod;
check('الوحدةُ تُصدّر المكوّنَ ودالّتيه', typeof AdmNumber === 'function' && typeof S === 'function' && typeof C === 'function');

// ── ① العيبُ الأصليّ: المسح ───────────────────────────────────────────────
// هذا هو الاختبارُ الذي يسقط لو عاد النمطُ القديم.
check('مسحُ الخانة يُبقيها فارغةً — لا يرتدّ إلى «1»', S('') === '', JSON.stringify(S('')));
check('محوُ آخر رقمٍ من «30» يُعطي «3» لا «1»', S('3') === '3', JSON.stringify(S('3')));

// ── ② الأرقامُ العربية ────────────────────────────────────────────────────
check('«٣٠» تصير «30»', S('٣٠') === '30', JSON.stringify(S('٣٠')));
check('«٧» تصير «7»', S('٧') === '7', JSON.stringify(S('٧')));
check('«١٢٣٤٥٦٧٨٩٠» كاملةً', S('١٢٣٤٥٦٧٨٩٠') === '1234567890', JSON.stringify(S('١٢٣٤٥٦٧٨٩٠')));
check('خليطٌ «٣a٥» ⇒ «35»', S('٣a٥') === '35', JSON.stringify(S('٣a٥')));
check('الرموزُ تُطرح ولا تُفسد', S('-١٢.٥') === '125', JSON.stringify(S('-١٢.٥')));

// ── ③ القصُّ عند الخروج وحده ──────────────────────────────────────────────
check('فارغ + min=1 ⇒ 1', C('', { min: 1, max: 3650 }) === 1, String(C('', { min: 1, max: 3650 })));
check('فارغ + fallback=7 ⇒ 7', C('', { min: 1, max: 3650, fallback: 7 }) === 7, String(C('', { min: 1, max: 3650, fallback: 7 })));
check('«30» تمرّ كما هي', C('30', { min: 1, max: 3650 }) === 30, String(C('30', { min: 1, max: 3650 })));
check('«5000» تُقصّ إلى 3650', C('5000', { min: 1, max: 3650 }) === 3650, String(C('5000', { min: 1, max: 3650 })));
check('«0» تُرفع إلى min=1', C('0', { min: 1, max: 3650 }) === 1, String(C('0', { min: 1, max: 3650 })));
check('min=0 يقبل الصفر', C('0', { min: 0 }) === 0, String(C('0', { min: 0 })));
check('نصٌّ فاسد ⇒ الافتراض', C('abc', { min: 1 }) === 1, String(C('abc', { min: 1 })));

// ── ④ الفرقُ الجوهريّ: أثناء الكتابة لا قصّ، وعند الخروج يُقصّ ────────────
// من يكتب «٣٠» وحدُّه ٢٠ يجب أن يرى «30» وهو يكتب، ثمّ «20» عند الخروج.
check('أثناء الكتابة: «٣٠» تبقى «30» ولو تجاوزت الحدّ', S('٣٠') === '30');
check('عند الخروج: «30» تُقصّ إلى 20', C(S('٣٠'), { min: 1, max: 20 }) === 20, String(C(S('٣٠'), { min: 1, max: 20 })));

console.log(`\n${fail ? '❌' : '✅'} حقلُ الرقم في اللوحة: ${pass} ناجحاً · ${fail} فاشلاً`);
process.exit(fail ? 1 : 0);
