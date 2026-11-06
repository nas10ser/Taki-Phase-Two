// حارسُ «الرسالةُ تعبر الأنبوب» (v15.53) — node scripts/check-error-codes.js
//
// ── ما يحرسه ───────────────────────────────────────────────────────────────
// 🔴 عيبٌ قِيس على الإنتاج بطلبٍ حقيقيّ عبر HTTP: **PostgREST يُمرّر `P0001`
//    وحدها** إلى المستخدم (٤٠٠ ومعها الرسالة)، وكلَّ `P00xx` غيرها يحوّلها
//    إلى **٥٠٠ ونصٍّ عامّ `Something went wrong`** بـ`text/plain`.
//
//        P0001 ⇒ 400  {"code":"P0001", … ,"message":"<الرسالة>"}
//        P0024 ⇒ 500  Something went wrong
//
//    وكانت في المنصّة ٢٤ رمزاً في ٥٣ موضعاً — أي أن كلَّ حارسٍ كُتبت له رسالةٌ
//    عربيّةٌ دقيقة كان يقول للمستخدم جملةً عمياء: نفادُ الكمّية · مهلةُ الختم ·
//    التوصيلُ خارج النطاق · حدُّ الطلبات · ومتجرٌ غير موثَّق (شكوى ناصر).
//
// العقدُ المحروس: أيُّ `RAISE … USING ERRCODE` في هجرةٍ جديدة يرفع `P0001`،
// والرمزُ الآليُّ في `HINT` — فالرسالةُ تصل والعميلُ يبقى قادراً على التفريع.
//
// 🪤 ومداه ملفّاتُ المستودع: ١٨٩ دالّة على الخادم بلا ملفّ، وقد حُوّلت كلُّها
//    في v15.53 بهجرةٍ تقرأ النصَّ الحيّ. فهذا يحرس الجديدَ لا يجرد القديم.
// 🪤 ويُجرَّد التعليقُ قبل الفحص: حارسٌ أمسك تعليقَه هو خمسَ مرّات في هذا
//    المشروع — ومنها شرحُ هذا العيب نفسِه داخل الهجرة التي تُصلحه.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'supabase');
const stripSql = (s) => s.replace(/^[ \t]*--[^\n]*$/gm, '').replace(/--[^\n]*$/gm, '');
/** رقمُ الإصدار من اسم الملفّ — الحكمُ على الجديد وحده. */
const verOf = (f) => { const m = f.match(/v(\d+)[_.](\d+)/i); return m ? Number(m[1]) + Number(m[2]) / 100 : 0; };
const JUDGE_FROM = 15.53;

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log(`      ${detail}`);
    ok ? pass++ : fail++;
};

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
check('وُجدت ملفّاتُ هجرة', files.length > 0, 'مدى الحارس فارغ — فحصٌ لا يفحص');

// الرمزُ المحظور: أيُّ P00xx عدا P0001.
const BAD = /ERRCODE\s*=\s*'(P0(?:0(?:0[02-9]|[1-9][0-9])))'/g;
let offenders = 0;
for (const f of files.sort((a, b) => verOf(a) - verOf(b))) {
    if (verOf(f) < JUDGE_FROM) continue;
    const sql = stripSql(fs.readFileSync(path.join(dir, f), 'utf8'));
    // 🪤 ويُستثنى ما يَرِد داخل **كتلةِ تحويلٍ** تُصلح العيب نفسه (regexp_replace
    //    على النمط)، وإلّا اتّهم الحارسُ الهجرةَ التي وُلد منها.
    const body = sql.replace(/regexp_replace\([\s\S]*?\);/g, '').replace(/\$re\$[\s\S]*?\$re\$/g, '').replace(/\$rp\$[\s\S]*?\$rp\$/g, '');
    let m; BAD.lastIndex = 0;
    const hits = [];
    while ((m = BAD.exec(body))) hits.push(m[1]);
    if (hits.length) {
        offenders++;
        check(`${f}: صفرُ رمزٍ لا يعبر PostgREST`, false,
            `وُجد ${hits.join(' · ')} — تُرفع بـ\`ERRCODE = 'P0001', HINT = '<الرمز>'\` وإلّا صارت الرسالةُ «Something went wrong».`);
    }
}
check('صفرُ هجرةٍ جديدة ترفع رمزاً لا يعبر', offenders === 0);

// والعميلُ يقرأ الرمزَ من موضعه الجديد.
const reader = path.join(__dirname, '..', 'src', 'utils', 'pgError.ts');
check('قارئُ الرمز موجود', fs.existsSync(reader));
if (fs.existsSync(reader)) {
    const src = fs.readFileSync(reader, 'utf8');
    check('ويقرأ hint قبل code', /o\.hint/.test(src) && src.indexOf('o.hint') < src.indexOf('o.code'),
        'بعد v15.53 يصير `code` هو P0001 لكلّ شيء — فالرمزُ الآليُّ في `hint`.');
}
const stale = [];
for (const rel of ['src/repositories/complaintRepository.ts', 'src/repositories/ratingRepository.ts']) {
    const p = path.join(__dirname, '..', rel);
    if (!fs.existsSync(p)) { stale.push(`${rel} (غائب)`); continue; }
    if (/\.code\s*===\s*'P0(?!001)/.test(fs.readFileSync(p, 'utf8'))) stale.push(rel);
}
check('ولا عميلٌ يقارن `code` برمزٍ مخصَّص', stale.length === 0, stale.join(' · '));

console.log(fail === 0
    ? `\n✅ رسائلُ الحرّاس تعبر إلى المستخدم (${pass} فحصاً)`
    : `\n❌ ${fail} فحصاً سقط من ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
