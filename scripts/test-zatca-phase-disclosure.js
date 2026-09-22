// اختبار إفصاح مرحلة الفوترة الإلكترونية (v14.86)
// التشغيل:  node scripts/test-zatca-phase-disclosure.js
//
// المعيار شيئان لا واحد:
//   ١) الإفصاح **موجود** حيث يبدأ التعرّض (شاشة الوضع الضريبي، لحظة تسجيل
//      التاجر رقمه) — لا في صفحةٍ قانونية لا تُقرأ.
//   ٢) و**لا ادّعاء** للمرحلة الثانية في أي نصّ ظاهر. الادّعاء وحده مخالفة،
//      والمنصّة لا تنفّذ منها شيئاً.
//
// 🪤 ولماذا اختبارٌ أصلاً على نصٍّ في شاشة: لأن النصوص تُحذف في أثناء «تنظيف
//    الواجهة» بلا أن يشتكي شيء — وهذا الإفصاح تحديداً هو الفرق بين تاجرٍ يعرف
//    التزامه وتاجرٍ يُفاجأ به عند التدقيق.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '✅' : '❌'} ${name}`);
    if (!ok && detail) console.log(`     ${detail}`);
    ok ? pass++ : fail++;
};

// ── ١) الإفصاح حيث يبدأ التعرّض ────────────────────────────────────────────
const card = read('src/components/seller/VatStatusCard.tsx');
check('شاشة الوضع الضريبي تقول «المرحلة الأولى فقط» (عربي)',
    /المرحلة الأولى فقط/.test(card),
    'الإفصاح يجب أن يكون في الشاشة التي يسجّل فيها التاجر رقمه');
check('وتذكر أن المرحلة الثانية غير منفّذة (عربي)',
    /المرحلة\s*\n?\s*<\/strong>|المرحلة الثانية/.test(card) && /غير\s*\n?\s*منفّذة|منفّذة لدينا/.test(card));
check('وتقول ماذا يفعل الملزَم بها',
    /من نظامك المعتمد/.test(card),
    'لا يكفي أن نقول «غير منفّذة» — يجب أن نقول ماذا يفعل');
check('الإفصاح بالإنجليزية أيضاً',
    /Phase 1 only/.test(card) && /Phase 2/.test(card) && /not/.test(card));

// ── ٢) لا ادّعاء بالامتثال للمرحلة الثانية ─────────────────────────────────
// يُمسح كل ما يراه المستخدم: الواجهة والبوتان والصفحات القانونية.
const SCAN = [
    'src', 'server/bot.js', 'server/flows/whatsapp.js', 'server/lib', 'index.html',
];
const CLAIMS = [
    /المرحلة الثانية\s*(?:مفعّل|مطبَّق|منفَّذ|جاهز|متوافق)/,
    /متوافق(?:ة|ون)?\s+مع\s+المرحلة\s+الثانية/,
    /phase\s*2\s*(?:compliant|ready|enabled|supported)/i,
    /(?:we|taki)\s+(?:are|is)\s+(?:fully\s+)?(?:zatca|fatoora)[- ]?(?:integrated|compliant)/i,
    /مرتبط(?:ون|ة)?\s+ب(?:بوّابة\s+)?فاتورة/,
];
// 🪤 وأُسقط نمطٌ جُرِّب فصرخ كذباً: `fatoora integration` وحده ليس ادّعاءً —
//    إفصاحُنا نفسه يقول «(Fatoora integration and cryptographic stamping) is
//    **not** implemented»، فالنمط أمسك جملةً **منفيّة** واتّهم النصّ الذي
//    يحرسه. الأنماط يجب أن تكون **مُثبِتةً ببنيتها** لا مجرّد كلماتٍ مفتاحية،
//    وإلا كان الحارس يُعلّم تجاهلَ نفسه.
function walkFiles(rel) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return [];
    if (fs.statSync(abs).isFile()) return [rel];
    return fs.readdirSync(abs).flatMap((e) => walkFiles(path.join(rel, e)));
}
const files = SCAN.flatMap(walkFiles).filter((f) => /\.(ts|tsx|js|jsx|html|json)$/.test(f));
const claims = [];
for (const f of files) {
    let t;
    try { t = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    // تُزال التعليقات: شرحُ ما لا ننفّذه ليس ادّعاءً بتنفيذه.
    t = t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
    for (const re of CLAIMS) if (re.test(t)) claims.push(`${f} ⇐ ${re}`);
}
check('لا ادّعاء بامتثال المرحلة الثانية في أي نصّ ظاهر',
    claims.length === 0,
    claims.join('\n     '));

// ── ٣) البند مُوثَّقٌ لا منسيّ ───────────────────────────────────────────────
check('البند المؤجَّل موثَّق مع شرط فتحه',
    fs.existsSync(path.join(root, 'supabase/ops/ZATCA-PHASE2.md')));
const doc = fs.existsSync(path.join(root, 'supabase/ops/ZATCA-PHASE2.md'))
    ? read('supabase/ops/ZATCA-PHASE2.md') : '';
check('والوثيقة تقول متى يُفتح البند', /متى يُفتح هذا البند/.test(doc));
check('وتقول إن التعرّض اليوم صفر (بقياس)', /التعرّض اليوم = صفر/.test(doc));

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} نجح · ${fail} فشل`);
process.exit(fail === 0 ? 0 : 1);
