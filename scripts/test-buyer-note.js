#!/usr/bin/env node
/**
 * اختبارُ ملاحظة المشتري — **تنفيذيّ**، وعلى الصيغ الثلاث كما هي في البيانات.
 *
 * 🔴 العيبُ الذي يحرسه (قِيس على جدة ١٣ نوفمبر ٢٠٢٦): الفاتورةُ كانت تستخرج
 *    الملاحظةَ بنمطٍ يشترط بادئة `📝` **لم يعد يكتبها أحد** — صفٌّ واحدٌ من
 *    ١٢٤. فمن عشرين ملاحظةٍ حقيقيّةٍ كُتبت، **واحدةٌ فقط وصلت الورقة**.
 *    وهو صامتٌ تماماً: الملاحظةُ تظهر في «حجوزاتي» فيُظنّ أنها وصلت.
 *
 * 🪤 والصيغةُ (ب) هي الفرعُ الذي يُنسى: تفاصيلُ طلبٍ كتبها **النظام** لا
 *    المشتري — وبلا تمييزها تُطبع «📦 تفاصيل الطلب…» بوصفها ملاحظةَ مشترٍ.
 */
const { execFileSync } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const root = path.join(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'taki-bn-'));
try {
    execFileSync('npx', ['tsc', path.join(root, 'src/utils/buyerNote.ts'),
        '--outDir', out, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
        { cwd: root, stdio: 'pipe' });
} catch (e) { console.error('✗ ترجمة:', String(e.stdout || e.message).slice(0, 300)); process.exit(1); }
const { buyerNoteFromNotes: f } = require(path.join(out, 'buyerNote.js'));

let pass = 0, fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? '  ✓' : '  ✗'} ${n}`); if (!ok && d) console.log('      ' + d); ok ? pass++ : fail++; };

console.log('\nملاحظةُ المشتري — الصيغُ الثلاثُ من البيانات الحيّة');

// (أ) مركَّبةٌ بملاحظة — نصٌّ منسوخٌ من صفٍّ حقيقيّ
const A = '📦 تفاصيل الطلب:\n• طفل كبير ×1 (80 ر.س)\n   ↳ نوع اللعبه: لعبة الرمل\n\n📝 سوف ناتي خلال ساعه\n💰 الإجمالي: 80 ر.س';
check('(أ) تُلتقط الملاحظةُ وحدها بلا سطر الإجمالي', f(A) === 'سوف ناتي خلال ساعه', JSON.stringify(f(A)));
// 🪤 وبمسافاتٍ حول النصّ: النموذجُ الأوّل كان نظيفاً فمرّت كسرةُ «لا تشذيب».
const A2 = '📦 x\n📝   سوف ناتي خلال ساعه   \n💰 الإجمالي: 80 ر.س';
check('(أ) ومُشذَّبةً من الطرفين', f(A2) === 'سوف ناتي خلال ساعه', JSON.stringify(f(A2)));

// (ب) مركَّبةٌ بلا ملاحظة
for (const B of [
    '📦 تفاصيل الطلب:\n• علم صغير ×1 (20 ر.س)\n💰 الإجمالي: 20 ر.س',
    '📏 المقاسات: علم صغير ×2 (20 ر.س) + علم كبير ×1 (50 ر.س)\n💰 الإجمالي: 90 ر.س',
    '📦 تفاصيل الطلب:\n↳ الوان الثلاجة: لون اسود',
]) check(`(ب) تفاصيلُ الطلب ليست ملاحظةً — [${B.slice(0, 22)}…]`, f(B) === undefined, JSON.stringify(f(B)));

// (ج) نصٌّ خامّ
for (const [C, want] of [
    ['اريد الحليب حرارتها وسط ', 'اريد الحليب حرارتها وسط'],
    ['حراره وسط', 'حراره وسط'],
    ['الان', 'الان'],
    ['سطرٌ أوّل\nوسطرٌ ثانٍ', 'سطرٌ أوّل\nوسطرٌ ثانٍ'],
]) check(`(ج) النصُّ الخامُّ كاملاً — [${C.slice(0, 18)}…]`, f(C) === want, JSON.stringify(f(C)));

// الفراغ
for (const E of [undefined, null, '', '   ', '\n\t ']) {
    check(`الفراغُ ⇒ undefined [${JSON.stringify(E)}]`, f(E) === undefined, JSON.stringify(f(E)));
}

// 🪤 والملاحظةُ مُشذَّبة: مسافةٌ خلفيّةٌ تكسر المقارنةَ مع توأم القاعدة.
check('المسافاتُ الخلفيّةُ تُشذَّب', f('  نصّ  ') === 'نصّ', JSON.stringify(f('  نصّ  ')));

fs.rmSync(out, { recursive: true, force: true });
console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail === 0 ? 0 : 1);
