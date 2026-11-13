// حارسُ «الدالّةُ الحافّة لا تختم مالاً بلا مبلغ» (v15.79)
// التشغيل: node scripts/check-edge-parity.js
//
// ── ما يحرسه ───────────────────────────────────────────────────────────────
// `?op=return` في `merchant-pay` سطحٌ **بلا أيّ مصادقة** بطبيعته (هو متصفّحُ
// المشتري عائداً من البوّابة؛ قِيس: `curl -X POST …?op=return -d '{}'` ⇒ 303).
// وكان فيه ثقبان يجتمعان فيختمان طلباً «مدفوعاً» بصفر ريال:
//   ① `applyConfirmed` تستبدل المبلغَ الغائب بـ**إجمالي الفاتورة** فتصير
//      المقارنةُ `got >= expected` صحيحةً دائماً فلا تقارن شيئاً.
//   ② و`hyperpay.confirmPayment` تقبل أيَّ `resourcePath` يبدأ بشرطة، فيختار
//      المنادي مسارَ النداء على مضيف المزوّد — ومسارُ التقارير يردّ برمزِ
//      نجاحٍ وبلا `amount`.
// هذا الحارسُ يمنع عودةَ أيٍّ من القطعتين، ويُثبّت جردَ الدوالّ الحافّة.
//
// 🪤 ويُجرَّد التعليقُ قبل أيّ فحصِ نصّ: هذا الملفّ نفسُه يحوي `? expected`
//    و`startsWith('/')` أعلاه، وCLAUDE.md يسجّل سبعَ مرّات أمسك فيها حارسٌ
//    **تعليقَه هو** فبدا سليماً وهو أعمى.
// 🪤 ولا يُفترض `git` (Vercel تبني من أرشيفٍ بلا `.git` — نشرتان ضاعتا بذلك)
//    ولا وجودُ `dist`.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const R = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// 🪤 ولا يُجرَّد التعليقُ بـ`//[^\n]*` السهلة: تأكل `https://api.moyasar.com/…`
//    فتقطع القالبَ ومعه بقيّةُ السطر، فيُقرأ جسمُ مهايئين قراءةً مبتورة
//    ويُتَّهمان بالصمت عن المبلغ وهما ينطقانه. (وقع فعلاً عند أوّل تشغيل.)
//    فالصيغةُ المعتمدة في البيت: سطرٌ كامل، أو ذيلٌ لا تسبقه `:` ولا يحوي نصّاً.
const strip = (src) => src
    .replace(/(^[ \t]*|\{)\/\*[\s\S]*?\*\//gm, '$1')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
    .replace(/([^:])\/\/[^\n'"`]*$/gm, '$1');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log(`      ${detail}`);
    ok ? pass++ : fail++;
};

/**
 * جسمُ دالّةٍ بعدّ العمق من أوّل `{` بعد تعريفها — لا بتعبيرٍ نمطيّ.
 * 🪤 و«النمطُ يمتدّ على الملفّ كلّه» فخٌّ مدفوعُ الثمن: `/fn[\s\S]*?token/`
 *    تنجح على جسمٍ فُرّغ. فالقياسُ على الجسم وحده.
 * 🪤 والعدّادُ يتجاهل ما بين علامتَي تنصيصٍ مفردةٍ أو مزدوجة؛ وما في القوالب
 *    (`${…}`) متوازنٌ ببنيته. ولو ظهر يوماً قوسٌ غيرُ متوازن في نصٍّ، فشِل
 *    الحارسُ **صارخاً** لا صامتاً — وهذا اتّجاهُ الفشل الصحيح.
 */
const bodyAfter = (src, from) => {
    const open = src.indexOf('{', from);
    if (open < 0) return '';
    let depth = 0, q = '';
    for (let i = open; i < src.length; i++) {
        const c = src[i];
        if (q) {
            if (c === '\\') i++;
            else if (c === q) q = '';
            continue;
        }
        if (c === '\'' || c === '"') { q = c; continue; }
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) return src.slice(open + 1, i); }
    }
    return '';
};

const IDX = strip(R('supabase/functions/merchant-pay/index.ts'));
const ADP = strip(R('supabase/functions/merchant-pay/adapters.ts'));

// ═══════════ ١) حجرُ الأساس: `applyConfirmed` لا تخترع مبلغاً ═══════════
// 🪤 والقوسُ جزءٌ من الإبرة: `indexOf('…applyConfirmed')` **بادئةٌ** تطابق
//    `applyConfirmedX` أيضاً، فتمرّ إعادةُ التسمية. قِيس بكسرةٍ لم تكسر.
const applyAt = IDX.indexOf('async function applyConfirmed(');
check('applyConfirmed موجودةٌ باسمها', applyAt >= 0, 'أُعيدت تسميتُها أو حُذفت — والحارسُ يقيس جسمَها بالاسم');
const APPLY = applyAt >= 0 ? bodyAfter(IDX, applyAt) : '';
check('وجسمُها مقروءٌ بعدّ العمق', APPLY.length > 200, `الطول ${APPLY.length}`);

// 🔴 الثقبُ الأصليّ بأيّ هجاء: ثلاثيٌّ أحدُ فرعيه هو المتوقَّع.
check('لا استبدالَ للمبلغ بالمتوقَّع (ثلاثيّ `? expected` / `: expected`)',
    !/\?\s*expected\b/.test(APPLY) && !/:\s*expected\b/.test(APPLY),
    'عودةُ الاستبدال تُلغي المقارنةَ كلَّها: `got >= expected` تصير صحيحةً دائماً');

// والحارسُ الموجب: مجهولٌ ⇒ صفٌّ مسجَّلٌ وخروجٌ بالفشل، **قبل** أيّ ختم.
const unknownAt = APPLY.search(/amount_unknown/);
const paidAt = APPLY.search(/'paid'/);
check('ومبلغٌ غيرُ موجبٍ أو غيرُ منتهٍ يُسجَّل ويرجع false',
    /Number\.isFinite\(/.test(APPLY) && /<=\s*0/.test(APPLY) && /amount_unknown/.test(APPLY),
    'بلا حارسٍ صريح يصير المجهولُ نجاحاً مرّةً أخرى');
check('وترتيبُه قبل ختم «مدفوع» لا بعده',
    unknownAt >= 0 && paidAt >= 0 && unknownAt < paidAt,
    'حارسٌ بعد الختم ليس حارساً (درس v14.96: الكسرةُ وقعت بعد كتلة التحقّق)');

// 🪤 والمرجعُ الموسوم: صفُّ تدقيقٍ بالمرجع الخام يحرق مفتاحَ عدم التكرار.
check('وصفُّ غير المدفوعة بمرجعٍ موسوم لا بالخام',
    /p_payment_ref:\s*`\$\{ref\}#\$\{status\}`/.test(APPLY),
    'UNIQUE(provider,payment_ref) + DO NOTHING ⇒ الخامُ يحبس الدفعةَ الحقيقية أبداً');

// 🪤 وردُّ القاعدة يُقرأ: ترفض `sim` خارج المختبر وتردّ duplicate بلا ختم.
check('والحكمُ الأخير من paid_at في الحجز لا من ردّ الدالّة',
    /ok\s*===\s*false/.test(APPLY) && /select\('paid_at'\)/.test(APPLY),
    'إهمالُ الردّ يجعل الصفحةَ تقول «دُفع» والطلبُ غيرُ مدفوع');

// ═══════════ ٢) مسارُ هايبر باي مثبَّتٌ بقائمةِ سماح ═══════════
check('قائمةُ سماحٍ مثبَّتةُ الطرفين لمسار الدفعة',
    /\/\^\\\/v1\\\/checkouts\\\/\[A-Za-z0-9._-\]\{8,\}\\\/payment\$\//.test(ADP),
    'نمطٌ بلا `^` و`$` يقبل `/v1/checkouts/x/payment/../../query`');

const hpAt = ADP.indexOf('const hyperpay: ProviderAdapter');
const hpConfirmAt = hpAt >= 0 ? ADP.indexOf('async confirmPayment(', hpAt) : -1;
const HP = hpConfirmAt >= 0 ? bodyAfter(ADP, hpConfirmAt) : '';
check('وجسمُ hyperpay.confirmPayment مقروء', HP.length > 200, `الطول ${HP.length}`);
check('ولا بوّابةَ `startsWith(\'/\')` فيه إطلاقاً',
    !/startsWith\(\s*'\/'\s*\)/.test(HP),
    '«يبدأ بشرطة» ليس تحقّقاً — هو تسليمُ اختيارِ المسار للمنادي');
const hpFetchAt = HP.indexOf('fetch(');
const hpGateAt = HP.indexOf('HYPERPAY_RP_OK');
check('والقائمةُ تُفحَص قبل أوّل نداءٍ شبكيّ',
    hpGateAt >= 0 && hpFetchAt >= 0 && hpGateAt < hpFetchAt,
    'النداءُ يحمل مفتاحَ التاجر السريّ — فحصٌ بعده لا يحمي شيئاً');

// ═══════════ ٣) كلُّ مهايئٍ يقول «كم»، لا «نعم» وحدها ═══════════
// 🔴 والعقدُ تغيّر على الجميع بإصلاح حجر الأساس: مهايئٌ لا يُرجع مبلغاً صار
//    `amount_unknown` دائماً — أي لا يُختم عنده طلبٌ أبداً. (بيفورت كان كذلك.)
let confirms = 0, mute = [];
for (let i = ADP.indexOf('async confirmPayment('); i >= 0; i = ADP.indexOf('async confirmPayment(', i + 1)) {
    confirms++;
    const b = bodyAfter(ADP, i);
    if (!/amount/i.test(b)) mute.push(`#${confirms} (طول ${b.length})`);
}
check(`وكلُّ confirmPayment يذكر المبلغ في جسمِه (${confirms} مهايئاً)`,
    confirms >= 7 && mute.length === 0,
    mute.length ? `صامتٌ عن المبلغ: ${mute.join(' · ')}` : `عددُ المهايئات ${confirms} — أقلُّ من المعروف`);

// ═══════════ ٤) ومسارُ العودة لا يختار المنادي مزوّدَه ═══════════
const retAt = IDX.indexOf("op === 'return'");
const RET = retAt >= 0 ? IDX.slice(retAt, IDX.indexOf("return json(404", retAt)) : '';
check('مسارُ العودة مقروء', RET.length > 500, `الطول ${RET.length}`);
check('ويُطابَق المزوّدُ ببوّابة التاجر الحيّة',
    /String\(cfg\.provider \|\| ''\) !== provider/.test(RET),
    'بلا ذلك يُحاكَم الطلبُ بقواعد مهايئٍ لم يُنشئ جلستَه');
check('وبـbookings.payment_provider متى كُتب',
    /booking\.payment_provider/.test(RET) && /bookedProvider &&/.test(RET),
    'شرطٌ مطلق يرفض ١٠٩ طلباً أسبقَ من العمود — والمعلَّقُ يحمي الجديد');
check('ومسارٌ خارج القائمة يوقف العودة',
    /HYPERPAY_RP_OK\.test\(rp\)/.test(RET),
    'التمريرُ إلى المهايئ اعتماداً على حارسه وحده نسخةٌ ثانية تنحرف');

// ═══════════ ٥) جردُ الدوالّ الحافّة — قائمةُ سماحٍ تفشل افتراضاً ═══════════
// 🪤 «قائمةُ ما يُسمح» لا «ما يُمنع»: المنعُ يفشل مفتوحاً (درس v14.80).
//    ودالّةٌ تُضاف أو تُحذف تُفشل البناءَ حتى يُراجعها إنسان — فسطحُ المال
//    والأسرار هنا، لا في `src`.
const ALLOWED = [
    'admin-impersonate', 'bot-chat-attachment', 'bot-upload-image',
    'iap-notify', 'iap-verify', 'merchant-pay', 'phone-login', 'send-push',
    'stock-oauth', 'stock-webhook', 'telegram-auth',
];
const FN_DIR = path.join(ROOT, 'supabase/functions');
const dirs = fs.readdirSync(FN_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();
const fns = dirs.filter((d) => d !== '_shared');
const extra = fns.filter((d) => !ALLOWED.includes(d));
const gone = ALLOWED.filter((d) => !fns.includes(d));
check(`جردُ الدوالّ مطابقٌ للمعروف (${fns.length})`,
    extra.length === 0 && gone.length === 0,
    [extra.length ? `زائدة: ${extra.join(', ')}` : '', gone.length ? `مفقودة: ${gone.join(', ')}` : '']
        .filter(Boolean).join(' · '));
// 🪤 و`_shared` **ليست دالّة**: وحداتٌ مشتركة بلا `index.ts` (فيها `iap.ts`).
//    اشتراطُ `index.ts` فيها كان سيُفشل الحارسَ على كودٍ سليم.
check('و`_shared` قائمةٌ وفيها وحدةٌ واحدة على الأقلّ',
    dirs.includes('_shared')
    && fs.readdirSync(path.join(FN_DIR, '_shared')).some((f) => f.endsWith('.ts')));
const noEntry = fns.filter((d) => !fs.existsSync(path.join(FN_DIR, d, 'index.ts')));
check('ولكلّ دالّةٍ مدخلُها index.ts',
    noEntry.length === 0, noEntry.length ? `بلا مدخل: ${noEntry.join(', ')}` : '');

console.log(`${fail ? '❌' : '✅'} الدوالُّ الحافّة والمبلغُ المجهول: ${pass + fail} فحصاً`);
process.exit(fail ? 1 : 0);
