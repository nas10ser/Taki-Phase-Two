#!/usr/bin/env node
/**
 * مهلةُ المراجعة — **ساعاتٌ أم أيام؟** اختبارٌ تنفيذيٌّ لتطابُق النسختين.
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 العيبُ الذي يحرسه، وهو عيبٌ **كان واقعاً** قبل v16.33 ومقيس:
 *    الوعدُ الواحد كان يُصاغ بثلاثة نصوص. عند مهلةِ ٧٢ ساعة:
 *      · بطاقةُ التاجر  (`hoursOrDaysGen`)      ⇐ «٣ أيام»
 *      · شاشةُ المدير   (`arCount(h, HOURS)`)   ⇐ «٧٢ ساعة»
 *      · البوتان        (`publishGate.hoursLabel`) ⇐ «٧٢ ساعة»
 *    أي أن التاجرَ يقرأ وعداً والمديرَ يقرأ غيرَه لنفس الإعداد.
 *
 * 🪤 وv16.33 وحّدت الصياغة — **فصنعت نسخةً ثانيةً من القاعدة نفسِها**:
 *    شرطُ «من ٤٨ فأعلى عند مضاعفِ يومٍ كامل» صار مكتوباً في مكانين، لأن
 *    البوت لا يستورد TypeScript (نفسُ سببِ وجود `shared/arPlural.js`).
 *    ونسختان بلا حارسٍ تنحرفان — وهو الدرسُ المدفوع مرّاتٍ في هذا المشروع.
 *    ⇒ هذا الملفّ **يُشغّل الاثنتين فعلاً** ويقارن مخرجَيهما عدداً عدداً.
 *
 * 🪤 ولا يكفي أن يُقرأ النصّان بـ`grep`: اسمُ الدالّة يختفي بالتصغير، وشرطٌ
 *    مكتوبٌ صحيحاً قد يُنادى خطأً. فالمقياسُ المخرَجُ لا المصدر.
 */
const cp = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const root = path.join(__dirname, '..');

let pass = 0, fail = 0;
const check = (n, ok, d) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${n}`);
    if (!ok && d) console.log('      ' + d);
    ok ? pass++ : fail++;
};

console.log('\nمهلةُ المراجعة — تطابُقُ صياغةِ الموقع والبوتين');

// ── ١) نسخةُ الموقع: تُترجَم وتُشغَّل كما هي، لا تُعاد كتابتها هنا ─────────
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'taki-sla-'));
let hoursOrDaysGen;
try {
    cp.execFileSync('npx', ['tsc',
        path.join(root, 'src/utils/bookingHold.ts'),
        '--outDir', out, '--module', 'commonjs', '--target', 'es2020',
        '--skipLibCheck', '--esModuleInterop'],
    { cwd: root, stdio: 'pipe' });
    ({ hoursOrDaysGen } = require(path.join(out, 'bookingHold.js')));
} catch (e) {
    check('ترجمةُ `bookingHold.ts`', false, String(e.stdout || e.message).slice(0, 400));
}

// ── ٢) نسخةُ البوتين: تُستورد مباشرةً ────────────────────────────────────
const { hoursLabel } = require(path.join(root, 'server/lib/publishGate.js'));

if (typeof hoursOrDaysGen !== 'function') {
    console.log('\n❌ تعذّر تحميل نسخة الموقع — لا مقارنة.');
    process.exit(1);
}

// ── ٣) المقارنة عدداً عدداً ───────────────────────────────────────────────
// المدى يغطّي: ما دون اليوم · اليومَ الكامل (٢٤، ويبقى ساعاتٍ عمداً) · حدَّ
// التحوّل (٤٨) · ما ليس مضاعفَ يوم (٤٩ · ٧١) · وسقفَ الخادم (٧٢٠ = ٣٠ يوماً).
const NUMS = [];
for (let h = 1; h <= 720; h++) NUMS.push(h);

let mismatch = null;
for (const h of NUMS) {
    for (const [lang, isRTL] of [['ar', true], ['en', false]]) {
        const site = hoursOrDaysGen(h, isRTL);
        const bot = hoursLabel(h, lang);
        if (site !== bot) { mismatch = { h, lang, site, bot }; break; }
    }
    if (mismatch) break;
}
check(`الموقعُ والبوتان يقولان نفسَ الجملة لكلّ مهلةٍ من ١ إلى ٧٢٠ (${NUMS.length * 2} مقارنة)`,
    !mismatch,
    mismatch && `عند ${mismatch.h} ساعة [${mismatch.lang}]:\n     الموقع : ${JSON.stringify(mismatch.site)}\n     البوتان: ${JSON.stringify(mismatch.bot)}`);

// ── ٤) الحالاتُ المقصودة — تُثبَّت كي لا تنقلب بصمت ───────────────────────
// 🪤 «٢٤ ساعة» تبقى ساعاتٍ عمداً: هي الوعدُ القائم على الإنتاج اليوم،
//    وتحويلُها إلى «يوم واحد» تغييرُ نصٍّ ظاهرٍ لم يطلبه أحد (v16.23).
check('٢٤ ساعة تبقى «ساعة» لا «يوم واحد»',
    !hoursOrDaysGen(24, true).includes('يوم'), hoursOrDaysGen(24, true));
check('٤٨ ساعة تصير «يومان»',
    hoursOrDaysGen(48, true) === 'يومين', hoursOrDaysGen(48, true));
check('٧٢ ساعة تصير «٣ أيام» — وهي الحالةُ التي كانت تنحرف',
    hoursOrDaysGen(72, true) === '3 أيام', hoursOrDaysGen(72, true));
check('٤٩ ساعة ليست مضاعفَ يومٍ فتبقى ساعات',
    !hoursOrDaysGen(49, true).includes('يوم'), hoursOrDaysGen(49, true));
check('٧٢٠ ساعة = سقفُ الخادم تصير «٣٠ يوماً»',
    hoursOrDaysGen(720, true) === '30 يوماً', hoursOrDaysGen(720, true));
check('الإنجليزية لا تقول «1 days»',
    hoursLabel(48, 'en') === 'two days' && hoursLabel(72, 'en') === '3 days',
    `${hoursLabel(48, 'en')} · ${hoursLabel(72, 'en')}`);

// ── ٥) ارتدادُ البوت عند قيمةٍ فاسدة يبقى كما وُثّق ──────────────────────
// (٢٤ حرفياً — نفسُ `COALESCE(…, 24)` في `taki_verification_policy`.)
check('قيمةٌ فاسدة ⇒ ارتدادُ البوت ٢٤ ساعة لا «0 ساعة»',
    hoursLabel(0, 'ar') === hoursOrDaysGen(24, true) && hoursLabel(NaN, 'ar') === hoursOrDaysGen(24, true),
    `${hoursLabel(0, 'ar')} · ${hoursLabel(NaN, 'ar')}`);

console.log(`\n${fail ? '❌' : '✅'} صياغةُ مهلة المراجعة: ${pass} ناجحاً · ${fail} فاشلاً`);
process.exit(fail ? 1 : 0);
