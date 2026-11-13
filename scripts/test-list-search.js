#!/usr/bin/env node
/**
 * اختبارُ قاعدة المطابقة في بحث القوائم — **تنفيذٌ حقيقيّ** (v16.30)
 * ═══════════════════════════════════════════════════════════════════════════
 * عشرُ شاشاتٍ صارت تُرشّح قوائمَها بـ`listSearchMatch`. وقاعدةُ المطابقة لا
 * تنكسر بصخب: تبقى الشاشةُ تعمل وتعرض نتائجَ ناقصة. فتُترجم الدالّةُ نفسُها
 * وتُشغَّل على حالاتٍ حقيقيّة بدل قراءة الكود.
 *
 * 🪤 وأخطرُ ما يُفحص هنا **التطبيع العربيّ**: مشترٍ يكتب «قهوه» ومنتجٌ اسمه
 *    «قهوة»، أو يكتب «٧٣١١» ورقمُ الطلب لاتينيّ — وكلاهما يقع فعلاً.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const root = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? '  ✓' : '  ✗'} ${n}`); if (!ok && d) console.log('      ' + d); ok ? pass++ : fail++; };

console.log('\nقاعدةُ المطابقة في بحث القوائم');

const out = fs.mkdtempSync(path.join(root, 'node_modules', '.cache-taki-listsearch-'));
const tsc = cp.spawnSync('npx', ['tsc',
    path.join(root, 'src/hooks/useListSearch.ts'),
    path.join(root, 'src/services/dealService.ts'),
    '--outDir', out, '--rootDir', path.join(root, 'src'),
    '--module', 'commonjs', '--target', 'es2019', '--jsx', 'react',
    '--esModuleInterop', '--skipLibCheck', '--moduleResolution', 'node',
], { cwd: root, encoding: 'utf8' });

if (tsc.status !== 0) {
    check('ترجمةُ الخطّاف', false, String(tsc.stdout || tsc.stderr).slice(0, 400));
    console.log(`\n❌ ${pass} ناجح · ${fail} فاشل\n`);
    process.exit(1);
}
check('ترجمةُ الخطّاف', true);

const { listSearchMatch } = require(path.join(out, 'hooks', 'useListSearch.js'));

const CASES = [
    // [الوصف, الحقول, الاستعلام, المتوقَّع]
    ['استعلامٌ فارغ لا يُرشّح شيئاً', ['قهوة اليوم'], '', true],
    ['مسافاتٌ فقط لا تُرشّح', ['قهوة اليوم'], '   ', true],
    ['مطابقةٌ مباشرة', ['قهوة اليوم'], 'قهوة', true],
    ['التاء المربوطة ⇔ الهاء', ['قهوة اليوم'], 'قهوه', true],
    ['والعكس كذلك', ['قهوه سادة'], 'قهوة', true],
    ['الألف بأشكالها', ['أحمد العتيبي'], 'احمد', true],
    ['الأرقام العربية ⇐ لاتينية', ['7311320893'], '٧٣١١', true],
    ['الشرطةُ لا تمنع المطابقة', ['TK 000054'], 'TK-000054', true],
    ['كلمتان بأيّ ترتيب', ['قهوة اليوم حرارة وسط'], 'وسط قهوة', true],
    ['كلمةٌ غائبة ⇒ لا مطابقة', ['قهوة اليوم حرارة وسط'], 'قهوة بارد', false],
    ['نصٌّ غير موجود ⇒ لا مطابقة', ['قهوة اليوم'], 'شاورما', false],
    ['حقولٌ متعدّدة تُجمع', ['قهوة', null, 'مقهى الركن'], 'الركن', true],
    ['العدمُ لا يُسقط المطابقة', [null, undefined, 'مقهى'], 'مقهى', true],
    ['صفٌّ بلا حقولٍ لا يطابق استعلاماً', [null, undefined, ''], 'مقهى', false],
    ['الأرقامُ تُقبل كحقل', [12345, 'فاتورة'], '2345', true],
    ['حروفٌ كبيرة وصغيرة سواء', ['Coffee Today'], 'coffee', true],
];

for (const [name, fields, q, want] of CASES) {
    const got = listSearchMatch(fields, q);
    check(`${name} — «${q}»`, got === want, `توقّعتُ ${want} فجاء ${got}`);
}

fs.rmSync(out, { recursive: true, force: true });
console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail === 0 ? 0 : 1);
