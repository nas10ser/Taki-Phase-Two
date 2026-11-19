#!/usr/bin/env node
/**
 * «جدّدتُ المنتج فبقي في المنتهية» — اختبارٌ تنفيذيٌّ على سببه.
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 بلاغُ ناصر (١٩ نوفمبر ٢٠٢٦): «عند تجديد منتجٍ منتهيةٍ كمّيته والنقرِ على
 *    تجديد يحوّلني لصفحة العروض النشطة **ولكن يبقى في العروض المنتهية**».
 *
 *    وقِيس على الإنتاج قبل كتابةِ سطر: عرضُ «كوووووووورة» حالتُه `active`
 *    وكمّيتُه ٢٠ من ٢٠ وعمرُه سنة — ومع ذلك يُصنَّف منتهياً، لأن عموداً
 *    ثالثاً مرفوع: `deals.sold_out = true`. و`isDealSoldOut` تقرؤه **قبل**
 *    الكمّية، فاستعادةُ الكمّية وحدها لا تُحرّك شيئاً.
 *
 * 🪤 **والعمودُ لا تكتبه حمولةُ الحفظ أصلاً**: `dealRepository.save` تبني
 *    كائناً صريحاً بلا `sold_out` — فوضعُ `soldOut:false` في كائن العرض
 *    كان سيبدو إصلاحاً ولا يكتب شيئاً. الكاتبُ الوحيد `merchant_set_sold_out`.
 */
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'node_modules', '.cache-renew-sold-out');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log('      ' + detail);
    ok ? pass++ : fail++;
};

console.log('\nتجديدُ عرضٍ نفدت كمّيته');

fs.rmSync(out, { recursive: true, force: true });
let isDealSoldOut, hasStockCap;
try {
    cp.execFileSync('npx', ['tsc', path.join(root, 'src/utils/dealAvailability.ts'),
        '--outDir', out, '--rootDir', root, '--module', 'commonjs', '--target', 'es2020',
        '--skipLibCheck', '--esModuleInterop'], { cwd: root, stdio: 'pipe' });
    ({ isDealSoldOut, hasStockCap } = require(path.join(out, 'src/utils/dealAvailability.js')));
} catch (e) {
    check('ترجمةُ `dealAvailability.ts`', false, String(e.stdout || e.message).slice(0, 500));
    console.log(`\n❌ تجديدُ عرضٍ نفدت كمّيته: ${pass} ناجحاً · ${fail} فاشلاً`);
    process.exit(1);
}

// ── ① الحالةُ التي أبلغ عنها ناصر، بأرقامٍ من الإنتاج ────────────────────
//    «كوووووووورة»: نشطٌ · كمّيةٌ ٢٠ من ٢٠ · ومفتاحُ «نفد» مرفوع
const afterRenew = { quantity: 20, initialQuantity: 20, soldOut: true };
check('عرضٌ جُدّدت كمّيتُه كاملةً ومفتاحُ «نفد» مرفوع ⇒ ما زال «نفد»',
    isDealSoldOut(afterRenew) === true,
    'لو مرّ هذا لما كان ثمّةَ عيب — وهو عينُ ما رآه ناصر');
check('وإطفاءُ المفتاح وحده يُعيده للبيع',
    isDealSoldOut({ ...afterRenew, soldOut: false }) === false);

// ── ② والكمّيةُ وحدها تعمل حين لا يكون المفتاحُ مرفوعاً ──────────────────
check('كمّيةٌ صفرٌ على عرضٍ مسقوف ⇒ نفد',
    isDealSoldOut({ quantity: 0, initialQuantity: 20, soldOut: false }) === true);
check('واستعادةُ الكمّية تُعيده',
    isDealSoldOut({ quantity: 20, initialQuantity: 20, soldOut: false }) === false);
check('وعرضٌ زمنيٌّ بلا سقفٍ لا ينفد أبداً',
    hasStockCap({ quantity: 0, initialQuantity: 0 }) === false
    && isDealSoldOut({ quantity: 0, initialQuantity: 0, soldOut: false }) === false);

// ── ③ والكاتبُ الصحيح — بنيوياً ──────────────────────────────────────────
const strip = (s) => s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^[ \t]*|\{)\/\*[\s\S]*?\*\//gm, '$1')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '');

const renewal = strip(fs.readFileSync(path.join(root, 'src/utils/dealRenewal.ts'), 'utf8'));
check('`clearSoldOut` تنادي `merchant_set_sold_out` بـ`p_on:false`',
    /merchant_set_sold_out/.test(renewal) && /p_on:\s*false/.test(renewal));
check('وتُثبت النجاحَ بـ`ok` لا بغياب الخطأ وحده',
    /\.ok\s*===\s*true/.test(renewal),
    'كتابةٌ ترفضها RLS تعود error=null — فلا يُقال «تمّ» بلا دليل');

// 🪤 ولا تُكتب من حمولة الحفظ — لو كُتبت لظُنّ أن `soldOut:false` يكفي
const repo = strip(fs.readFileSync(path.join(root, 'src/repositories/dealRepository.ts'), 'utf8'));
const saveBody = repo.slice(repo.indexOf('save: async'), repo.indexOf('saveDeals:'));
check('وحمولةُ `save` لا تحمل `sold_out` (فالنداءُ هو الطريقُ الوحيد)',
    !/sold_out:/.test(saveBody));

// ── ④ ومسارا التجديد كلاهما يُطفئه **قبل** الحفظ ─────────────────────────
// 🪤 **ويُقاس داخل جسم `reActivateDeal` وحدَه.** أوّلُ صيغةٍ كتبتُها قاست
//    على الملفّ كلِّه، فحين نقلتُ النداءَ عمداً إلى ما بعد الحفظ **مرّ الفحصُ
//    كاذباً**: وجد `updateDeal` أخرى في `togglePauseDeal` بعده فظنّ الترتيبَ
//    سليماً. (الفخُّ المسجَّل: «نمطُ الحارس يمسح الملفَّ كلَّه».)
const bodyOf = (src, name) => {
    const a = src.indexOf(`const ${name} = async`);
    if (a === -1) return '';
    const b = src.indexOf('\n    const ', a + 10);
    return src.slice(a, b === -1 ? src.length : b);
};
for (const [label, file] of [
    ['لوحةُ التاجر', 'src/pages/SellerDashboard.tsx'],
    ['صفحةُ المتجر', 'src/pages/StoreDetails.tsx'],
]) {
    const body = bodyOf(strip(fs.readFileSync(path.join(root, file), 'utf8')), 'reActivateDeal');
    const at  = body.indexOf('await clearSoldOut(');
    const upd = body.indexOf('await updateDeal(');
    check(`${label}: التجديدُ يُطفئ «نفد» قبل الحفظ`,
        at !== -1 && upd !== -1 && at < upd,
        at === -1 ? 'لا نداءَ إطفاءٍ في جسم «تجديد»'
        : upd === -1 ? 'لم يُعثر على الحفظ في جسم «تجديد»'
        : 'النداءُ بعد الحفظ ⇒ إعادةُ القراءة تلتقط القيمةَ القديمة');
}

console.log(`\n${fail ? '❌' : '✅'} تجديدُ عرضٍ نفدت كمّيته: ${pass} ناجحاً · ${fail} فاشلاً`);
process.exit(fail ? 1 : 0);
