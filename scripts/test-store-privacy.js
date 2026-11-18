#!/usr/bin/env node
/**
 * بحثُ دليل المتاجر — **لا يُطابق الاسمَ الشخصيَّ لصاحب المتجر**.
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 أمرُ ناصر (١٧ نوفمبر ٢٠٢٦): «ممنوع منعا باتا من اي شخص يبحث في الموقع
 *    ويظهرله حساب الادمن، فهو سري ومخفي تمام».
 *
 *    والمقيسُ على الكود قبل الإصلاح: مسارا البحث كلاهما يطابق `users.name`
 *    (الاسمَ الشخصيّ) — في المتصفّح بوزن ٠٫٩٥، وعلى الخادم بـ
 *    `shop.ilike.%q%,name.ilike.%q%`. فمن يعرف اسمَ صاحبِ متجرٍ يجده به.
 *    وحسابُ الإدارة على جدة اسمُ متجره «تاكي» — فاسمُه الشخصيُّ كان مفتاحاً
 *    يصل إليه.
 *
 * 🪤 ولا يُلغى الارتدادُ إلى الاسم: متجرٌ لم يُسمَّ بعدُ لا يُعثر عليه إطلاقاً
 *    بدونه — وهي حالُ كلّ تاجرٍ في يومه الأوّل. فالشرطُ «إن لم يكن للمتجر اسم».
 */
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'node_modules', '.cache-store-privacy');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log('      ' + detail);
    ok ? pass++ : fail++;
};

console.log('\nبحثُ دليل المتاجر — الاسمُ الشخصيُّ ليس مفتاحاً');

fs.rmSync(out, { recursive: true, force: true });
let mod;
try {
    cp.execFileSync('npx', ['tsc', path.join(root, 'src/utils/storePrivacy.ts'),
        '--outDir', out, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { cwd: root, stdio: 'pipe' });
    mod = require(path.join(out, 'storePrivacy.js'));
} catch (e) {
    check('ترجمةُ `storePrivacy.ts`', false, String(e.stdout || e.message).slice(0, 400));
    console.log(`\n❌ خصوصيةُ الدليل: ${pass} ناجحاً · ${fail} فاشلاً`);
    process.exit(1);
}
const { searchableOwnerName: S, matchesPublicly: M, publicStoreLabel: L } = mod;

// الصفُّ الحقيقيُّ من جدة: حسابُ الإدارة اسمُ متجره «تاكي».
const ADMIN = { shop: 'تاكي', name: 'ناصر العمري' };
const SELLER = { shop: 'N15', name: 'صاحب المتجر' };
const UNNAMED = { shop: '', name: 'تاجر جديد' };

// ── ① جوهرُ الأمر: الاسمُ الشخصيُّ لا يُبحث به ───────────────────────────
check('حسابُ الإدارة: الاسمُ الشخصيُّ غيرُ قابلٍ للبحث', S(ADMIN) === '', JSON.stringify(S(ADMIN)));
check('ولا يُعثر عليه باسم صاحبه', M(ADMIN, 'ناصر') === false);
check('ولا بجزءٍ من اسمه', M(ADMIN, 'العمري') === false);
check('تاجرٌ عاديّ كذلك — لا يُعثر عليه باسم صاحبه', M(SELLER, 'صاحب') === false);

// ── ② ولا يُكسر البحثُ المشروع ────────────────────────────────────────────
check('يُعثر على المتجر باسمه «تاكي»', M(ADMIN, 'تاكي') === true);
check('ويُعثر على «N15»', M(SELLER, 'N15') === true);
check('وبحرفٍ من اسم المتجر', M(SELLER, 'n1') === true);

// ── ③ الارتدادُ لمتجرٍ بلا اسم يبقى (تاجرُ اليوم الأوّل) ─────────────────
check('متجرٌ بلا اسم: اسمُ الحساب يُبحث به', S(UNNAMED) === 'تاجر جديد', JSON.stringify(S(UNNAMED)));
check('ويُعثر عليه به', M(UNNAMED, 'تاجر') === true);
check('وهو نفسُه المعروضُ على بطاقته', L(UNNAMED) === 'تاجر جديد', L(UNNAMED));

// ── ④ المعروضُ على البطاقة لا يتغيّر لمن له اسمُ متجر ────────────────────
check('بطاقةُ حساب الإدارة تعرض «تاكي» لا اسمَ صاحبه', L(ADMIN) === 'تاكي', L(ADMIN));

// ── ⑤ حالاتٌ حدّيّة ───────────────────────────────────────────────────────
check('بحثٌ فارغ لا يطابق شيئاً', M(ADMIN, '   ') === false);
check('مسافاتٌ حول اسم المتجر لا تخدع', S({ shop: '  تاكي  ', name: 'ناصر' }) === '');

console.log(`\n${fail ? '❌' : '✅'} خصوصيةُ دليل المتاجر: ${pass} ناجحاً · ${fail} فاشلاً`);
process.exit(fail ? 1 : 0);
