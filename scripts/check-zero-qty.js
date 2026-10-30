// حارسُ «صفرٌ كمّيةٌ صالحة» (v15.34) — التشغيل: node scripts/check-zero-qty.js
//
// ── العيبُ الذي يحرسه ──────────────────────────────────────────────────────
// تاجرٌ له نوعان وموقعان أراد «كبير ٢٤ في الجوف و**صفر** في الخرج». وكان
// الكودُ يسأل في عشرة مواضع `Number(q) > 0`، فيصير «صفر» و«فارغ» شيئاً
// واحداً: الموقعُ الذي كُتب فيه صفرٌ يُحفظ **مفتوحاً بلا حدّ** — عكسَ القصد.
//
// 🔴 والأخطرُ أن الطريق **ذهابٌ وإياب**: سُدَّ مسارُ الحفظ في v15.33 وبقي
//    مسارُ **القراءة** يُسقط الصفرَ عند فتح العرض للتعديل، فيعود الفرعُ
//    «بلا حدّ» والحفظُ التالي يبيع ما لا يملكه التاجر — بلا خطأ ولا أثر.
//    ⇒ هذا الحارسُ يفحص **الاتجاهين**، لا اتجاهَ الكتابة وحده.
//
// 🪤 ويُجرَّد التعليقُ قبل الفحص: التعليقُ الذي يشرح العيبَ يحوي نصَّ العيب،
//    فحارسٌ ساذجٌ يتّهم النصَّ الذي يحرسه (وقعت ثلاث مرّات في v15.16–22).
const fs = require('fs');
const path = require('path');

const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
/** يُسقط تعليقات // وblock comments والسلاسل الحرفية ذات الـbackticks الطويلة تُبقى. */
const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
    .replace(/([^:])\/\/[^\n'"`]*$/gm, '$1');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log(`      ${detail}`);
    ok ? pass++ : fail++;
};

// ── ١) المُحكّم واحدٌ ومعناه مقيس ───────────────────────────────────────────
const modSrc = R('src/utils/locationQty.ts');
const m = modSrc.match(/export const qtyGiven[^=]*=\s*([^;]+);/);
if (!m) { console.log('❌ لم يُعثر على qtyGiven في src/utils/locationQty.ts'); process.exit(1); }
// نُسقط التعليقَ النوعيّ `(q: unknown): boolean` ونُقيّم الجسم كما هو.
const body = m[1].replace(/\(q:\s*unknown\)\s*:\s*boolean\s*=>/, '(q) =>');
const qtyGiven = eval(`(${body})`);

const TRUTH = [
    ['الصفر رقمٌ حقيقيّ («لا يوجد هنا»)', 0, true],
    ['٢٤', 24, true],
    ['نصّ «5» (ما يرسله الحقل أحياناً)', '5', true],
    ['الفراغ = لم يُحدَّد ⇒ مفتوح', undefined, false],
    ['null لا يصير صفراً', null, false],
    ['نصّ فارغ لا يصير صفراً', '', false],
    ['سالب مرفوض', -1, false],
    ['NaN مرفوض', NaN, false],
];
for (const [name, input, want] of TRUTH) {
    check(`qtyGiven: ${name}`, qtyGiven(input) === want,
        `أعطى ${qtyGiven(input)} والمتوقَّع ${want}`);
}

// ── ٢) لا موضعَ يقيس «موجب» بدل «مكتوب» ────────────────────────────────────
// النمطُ القاتل: مقارنةُ `> 0` على اسمٍ يحمل كمّية. الأسعارُ والأطوالُ لا تُمسّ.
const QTY_GT0 = /\b(qty|qtys|qv|bq|rawV|rawB|onHand|variantOnHand|variantQtys|quantity)\b[^;,\n]{0,40}>\s*0/gi;
for (const f of ['src/pages/SellerDashboard.tsx', 'src/components/seller/LocationQtyGroups.tsx', 'src/utils/locationQty.ts']) {
    const hits = [...strip(R(f)).matchAll(QTY_GT0)].map(x => x[0].trim());
    check(`${f}: لا «كمّية > 0»`, hits.length === 0, `وُجد: ${hits.join(' | ')}`);
}

// ── ٣) الذهابُ والإياب يسألان نفسَ السؤال ──────────────────────────────────
// لو سأل أحدُهما سؤالاً آخر عاد الانحرافُ الصامت: يُحفظ الصفرُ ولا يُقرأ.
const dash = strip(R('src/pages/SellerDashboard.tsx'));
check('مسارُ القراءة (إعادة بناء المجموعات) يسأل qtyGiven',
    /for \(const vId of Object\.keys\(vq\)\)[\s\S]{0,400}?qtyGiven\(rawV\)/.test(dash));
check('كمّيةُ الفرع عند القراءة تسأل qtyGiven',
    /const rawB = l\.onHand \?\? l\.quantity;[\s\S]{0,200}?qtyGiven\(rawB\)/.test(dash));
check('مسارُ الكتابة (خليّة المجموعة) يسأل qtyGiven',
    /g\.locs\.includes\(branchKey\) && qtyGiven\(g\.qty\)/.test(dash));
check('الحفظُ يكتب الصفرَ ولا يُسقطه (المصفوفة)',
    /\.\.\.\(qty !== undefined \? \{ quantity: qty/.test(dash));
check('الحفظُ يكتب الصفرَ ولا يُسقطه (المنتج الواحد)',
    /return \(q !== undefined\) \? \{ quantity: q/.test(dash));
check('الشاشةُ تُحسب التغطية بنفس المُحكّم',
    /groups\.filter\(g => qtyGiven\(g\.qty\)\)/.test(strip(R('src/components/seller/LocationQtyGroups.tsx'))));

// ── ٤) دورةٌ كاملة بالقيم: احفظ ٠ ⇒ اقرأ ⇒ احفظ ⇒ يبقى ٠ ──────────────────
// نموذجٌ مصغّرٌ يستعمل **نفسَ** المُحكّم المستخرَج أعلاه، فيُثبت أن العقد
// (صفرٌ = مفتاحٌ موجودٌ قيمتُه ٠ · مفتوحٌ = مفتاحٌ غائب) ينجو من الدورة.
const saveCell = (q) => (qtyGiven(q) ? { present: true, value: Number(q) } : { present: false });
const loadCell = (cell) => (cell.present && qtyGiven(cell.value) ? Number(cell.value) : undefined);
const round = (q) => loadCell(saveCell(loadCell(saveCell(q))));
check('دورة: ٠ تبقى ٠ (لا تصير «بلا حدّ»)', round(0) === 0, `صارت ${round(0)}`);
check('دورة: ٢٤ تبقى ٢٤', round(24) === 24);
check('دورة: الفراغ يبقى فراغاً (مفتوح)', round(undefined) === undefined);
check('دورة: null يبقى مفتوحاً ولا يصير ٠', round(null) === undefined);

console.log(fail === 0
    ? `✅ صفرٌ كمّيةٌ صالحة: ${pass} فحصاً — الاتجاهان معاً، والمُحكّم واحد`
    : `❌ ${fail} فشل من ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
