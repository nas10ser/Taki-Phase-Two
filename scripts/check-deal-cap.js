#!/usr/bin/env node
/**
 * «عددُ المنتجات بلا حدّ» — حارسٌ يُثبّت قرارَ ناصر (١٧ نوفمبر ٢٠٢٦).
 * ═══════════════════════════════════════════════════════════════════════════
 * نصُّ القرار حرفياً: «الالتزام بالباقة ضروري جدا ولكن عدد لا محدود من
 * المنتجات هذا قصدي… بالنسبه للمواقع يلتزم بالباقه ولكن عدد لا نهائي من
 * المنتجات يستطيع يضيفها».
 *
 * ⇒ **المواقعُ تتبع الباقة** (`store_profiles.max_branches` وحارسُه
 *   `enforce_seller_location_cap` — لا يمسّهما هذا الملفّ إطلاقاً)،
 *   **وعددُ المنتجات بلا سقف** — في أيّ طبقة.
 *
 * ── لماذا حارسٌ وليس تعليقاً ───────────────────────────────────────────────
 * 🔴 لأن السقفَ **موجودٌ في المخطّط أصلاً وميّت**: العمود
 *    `store_profiles.max_deals_per_month` مُعلَنٌ منذ v9.1
 *    (`supabase/migration_v9_1_phase2_subscriptions.sql`) و**صفرُ مرجعٍ** له في
 *    الكود كلِّه. فهو فخٌّ جاهز: جلسةٌ قادمة تراه فتظنّه ميزةً ناقصة فتوصّله،
 *    فيصير لكلّ تاجرٍ سقفٌ لم يطلبه أحد — وبصمت، لأن الرفضَ سيبدو «خطأ حفظ».
 * 🔴 وناصر قال إن الباقات ستُضاف ويُغيَّر سعرُها. ولحظةُ تحرير كتالوج الباقات
 *    هي **بالضبط** اللحظةُ التي يُضاف فيها حقلٌ اسمه «عدد المنتجات».
 *
 * 🪤 وأنماطُ الفحص قِيست على الشجرة الحقيقيّة قبل أن تُكتب: النمطُ الفضفاض
 *    `deal.{0,12}(limit|cap|quota)` أعطى **١١ إيجابيةً كاذبة** في تصدير
 *    القاعدة (منها `enforce_seller_location_cap` و`LIMIT` في SQL)، والنمطان
 *    المعتمدان أعطيا **صفراً**. فالمعيارُ قياسٌ لا حدس.
 * 🪤 ويُجرَّد التعليقُ قبل أي فحصٍ نصّيّ — وإلّا أمسك الحارسُ تعليقَه هو
 *    (فخٌّ وقع في هذا المشروع سبعَ مرّات)، وهذا الملفُّ يذكر الأسماءَ التي يمنعها.
 *
 * ℹ️ حدٌّ واحدٌ **لم أستطع قياسَه** في جلسة ١٧ نوفمبر، ويُذكر كي لا يُظنّ مقيساً:
 *    `PGRST_DB_MAX_ROWS` على PostgREST الحيّ. إن كان مضبوطاً فسيقصّ **كلَّ**
 *    استجابة عند حدّه، فيرى تاجرٌ له آلافُ المنتجات بعضَها فقط. وهو غيرُ مضبوط
 *    في ملفّ compose الذي عندنا، والسقفُ (إن وُجد) أكبرُ بكثير من أيّ متجرٍ
 *    اليوم (٢٢ عرضاً على المنصّة كلّها). يُقاس عند أوّل متجرٍ يقترب من الألف.
 */
const fs = require('fs');
const path = require('path');
const { walk } = require('./lib/walk');

const root = path.resolve(__dirname, '..');
const R = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/** يُجرّد التعليقات قبل أي فحصٍ نصّيّ. (النمطُ المصحَّح في v16.30: تعليقُ
 *  الكتلة يبدأ في أوّل السطر أو بعد `{` — وإلّا ابتلع `accept="image/*"`
 *  أربعةَ عشرَ ألفَ محرفٍ من كودٍ حقيقيّ.) */
const strip = (src) => src
    .replace(/(^[ \t]*|\{)\/\*[\s\S]*?\*\//gm, '$1')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
    .replace(/--[^\n]*/g, '');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log('      ' + detail);
    ok ? pass++ : fail++;
};

console.log('\nعددُ المنتجات بلا حدّ — والمواقعُ تتبع الباقة');

// ── ① العمودُ الميّت يبقى ميّتاً ──────────────────────────────────────────
const DIRS = ['src', 'server', 'shared', 'api'];
const files = walk(root, DIRS, /\.(ts|tsx|js|jsx)$/).filter((f) => !/node_modules/.test(f));
const wired = [];
for (const f of files) {
    const rel = path.relative(root, f);
    if (rel === path.join('scripts', 'check-deal-cap.js')) continue;   // الحارسُ يُعفى من نفسه
    if (strip(fs.readFileSync(f, 'utf8')).includes('max_deals_per_month')) wired.push(rel);
}
check(`العمودُ الميّت \`max_deals_per_month\` غيرُ موصولٍ بشيء (فُحص ${files.length} ملفّاً)`,
    wired.length === 0,
    wired.length ? 'وُصِل في: ' + wired.join(' · ') : '');

// ── ② كتالوجُ الباقات يبيع مواقعَ لا منتجات ───────────────────────────────
const pkg = R('src/data/packages.ts');
const iface = (pkg.match(/export interface LocationPackage\s*\{([\s\S]*?)\n\}/) || ['', ''])[1];
check('قُرئ تعريفُ `LocationPackage`', iface.trim().length > 0, 'لم أجد التعريف — راجع `src/data/packages.ts`');
const pkgField = strip(iface).match(/^\s*(\w+)\s*[?:][^\n]*$/gm) || [];
const offending = pkgField.filter((l) => /deal|product|منتج/i.test(l));
check('ولا حقلَ فيه يَعِد بعدد منتجات — فالباقةُ مواقعُ وسعرٌ ومدّة',
    offending.length === 0,
    offending.join(' | '));

// ── ③ لا سقفَ عددٍ في عقل القاعدة الحيّ ───────────────────────────────────
// النمطان قِيسا بصفر مطابقةٍ على التصدير الحقيقيّ قبل اعتمادهما.
const BAD_SQL = [/\b(max|limit)_deals?\b/i, /deals?_(limit|quota|cap)\b/i];
const livePath = 'supabase/schema/10-live-db-logic.sql';
if (fs.existsSync(path.join(root, livePath))) {
    const live = strip(R(livePath));
    const hits = BAD_SQL.map((re) => (live.match(new RegExp(re.source, 'gi')) || [])).flat();
    check(`ولا سقفَ عددٍ في «${livePath}»`, hits.length === 0,
        hits.length ? 'وُجد: ' + [...new Set(hits)].join(' · ') : '');
} else {
    check(`«${livePath}» موجودٌ ليُفحص`, false, 'لقطةُ عقل القاعدة مفقودة — شغّل `bash scripts/export-db-logic.sh`');
}

// ── ④ قائمةُ منتجات التاجر تُجلب كاملةً بلا سقف ───────────────────────────
// 🪤 المرساةُ جسمُ الدالّة لا الملفّ: في `dealRepository.ts` دوالُّ ترقيمٍ
//    أخرى (`_feedPage`) تستعمل `.limit()` بحقّ، فالفحصُ على الملفّ كلِّه كان
//    سيتّهمها — وهو فخُّ «النمطُ يمتدّ على الملفّ كلّه» المسجَّل عندنا.
const repo = strip(R('src/repositories/dealRepository.ts'));
const byStore = (repo.match(/getByStore:\s*async[\s\S]*?\n {4}\},/) || [''])[0] || '';
check('قُرئ جسمُ `getByStore`', byStore.length > 0, 'لم أجد الدالّة — راجع المرساة');
check('وقائمةُ منتجات التاجر تُجلب بلا `.limit(` — فيرى كلَّ ما نشر',
    byStore.length > 0 && !/\.limit\s*\(/.test(byStore),
    byStore.length ? (byStore.match(/\.limit\s*\([^)]*\)/) || [''])[0] : '');

console.log(`\n${fail ? '❌' : '✅'} سقفُ المنتجات: ${pass} ناجحاً · ${fail} فاشلاً`);
if (fail) {
    console.error('\n   🔴 قرارُ ناصر (١٧ نوفمبر): المواقعُ تتبع الباقة، وعددُ المنتجات بلا حدّ.');
    console.error('      إن كان التغييرُ مقصوداً فغيّر القرارَ معه — لا الحارسَ وحده.\n');
}
process.exit(fail ? 1 : 0);
