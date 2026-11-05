// حارسُ «بابُ المال المجّاني مغلقٌ بالبناء» (v15.45)
// التشغيل: node scripts/check-sim-closed.js
//
// ── ما يحرسه ───────────────────────────────────────────────────────────────
// مزوّدُ `sim` يختم الطلبَ «مدفوعاً» بلا أن يمرّ ريال. كان مفعَّلاً على المنصّة
// **وعلى متجر ناصر الحيّ**، أي أن أيّ زائرٍ يشتري مجّاناً. والإغلاقُ بمفتاحٍ
// وحده لا يكفي: المفاتيحُ تُعاد. فالقاعدةُ ترفضه بالبناء، وهذا الحارسُ يمنع
// عودةَ أيٍّ من قطع ذلك البناء.
//
// 🪤 ويُجرَّد التعليقُ قبل أيّ فحصِ نصّ — هذا الملفّ نفسُه يحوي `sim`
//    و`simulated` و`paid`.
const fs = require('fs');
const path = require('path');

const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
    .replace(/([^:])\/\/[^\n'"`]*$/gm, '$1');
const stripSql = (s) => s.replace(/^--[^\n]*$/gm, '').replace(/--[^\n]*$/gm, '');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log(`      ${detail}`);
    ok ? pass++ : fail++;
};

const MIG = 'supabase/JEDDAH_v15_45_close_sim_and_fake_revenue.sql';
const migAll = stripSql(R(MIG));
// 🪤 وكلُّ فحصٍ نصّيٍّ يقتصر على أجسام الكود دون كتلتَي التحقّق: هما تبحثان
//    عن نفس الرموز فتُبقيانها حيّةً في النصّ ولو مات الكودُ الحقيقيّ. وقعت
//    ثلاث مرّات في v15.44 وكُشفت بكسرةٍ لم تكسر.
const mig = migAll.slice(0, migAll.indexOf('DO $verify$'));

// ── ١) الإغلاقُ بالبناء لا بمفتاح ──────────────────────────────────────────
check('المختبرُ يُعرَّف بوسمه، والإنتاجُ هو الافتراض',
    /CREATE OR REPLACE FUNCTION public\.taki_is_lab/.test(mig)
    && /TAKI_LAB_TOKYO_MARKER_v1382/.test(mig));
check('نقطةُ الاختناق: pay_provider_on تكذّب المحاكاةَ على الإنتاج',
    /pay_provider_on[\s\S]*?IN \('sim', 'simulated'\)[\s\S]*?NOT public\.taki_is_lab\(\)[\s\S]*?THEN false/.test(mig),
    'بدونها يكفي إعادةُ المفتاح في platform_settings لفتح الباب');
check('ولا يُطفأ مزوّدٌ حقيقيّ معها',
    /ELSE COALESCE\([\s\S]*?enabled_pay_providers/.test(mig));
check('ومشغّلٌ يرفض بوّابةَ محاكاةٍ مفعَّلة',
    /tr_guard_sim_gateway/.test(mig) && /P0031/.test(mig));
check('والمشغّلُ على الإدراج والتعديل معاً',
    /CREATE TRIGGER tr_guard_sim_gateway\s*\n\s*BEFORE INSERT OR UPDATE ON public\.merchant_gateways/.test(mig));
// 🪤 والرفضُ مشروطٌ بالتفعيل لا بالوجود: الصفُّ التاريخيّ دليلٌ يبقى مطفأً.
check('ويُبقي الصفَّ التاريخيَّ دليلاً (يرفض التفعيل لا الوجود)',
    /COALESCE\(NEW\.is_enabled, false\)/.test(mig)
    && !/DELETE FROM public\.merchant_gateways/.test(mig));
check('وأُطفئ ما هو قائم', /UPDATE public\.merchant_gateways[\s\S]*?is_enabled = false/.test(mig));

// ── ٢) ثقبُ v15.40: الحارسُ كان أعمى عن التعديل ────────────────────────────
check('حارسُ دفعات الاشتراك صار يرى UPDATE',
    /CREATE TRIGGER tr_guard_fake_sub_payment\s*\n\s*BEFORE INSERT OR UPDATE ON public\.subscription_payments/.test(mig),
    'كان BEFORE INSERT وحده، فتحويلُ صفٍّ قائم إلى paid كان يمرّ');
// 🔴 وتوسيعُه وحده كان سيكسر مسارَ الأدمن السليم: confirm_subscription_payment
//    تُحوّل pending→paid بلا مزوّد، فتُرفض بـP0030. فالإصلاحان يُشحنان معاً.
check('ومسارُ الأدمن يختم مزوّداً فلا يُرفض بحقّ',
    /gateway_provider = COALESCE\(NULLIF\(gateway_provider, ''\), 'admin_confirmed'\)/.test(mig));

// ── ٣) الإيرادُ الذي لم يدخل: يُصحَّح ولا يُمحى ────────────────────────────
check('التصحيحُ إلى gifted لا حذف',
    /UPDATE public\.subscription_payments[\s\S]*?SET status = 'gifted'/.test(mig)
    && !/DELETE FROM public\.subscription_payments/.test(mig),
    'الحذفُ يمحو الدليلَ ويثقب تسلسلَ أرقام الفواتير');
check('والسببُ مدوَّنٌ في الصفّ نفسِه',
    /correction_reason/.test(mig) && /corrected_in/.test(mig));
check('ويُصيب الصفوفَ الوهميّة وحدها',
    /WHERE lower\(COALESCE\(status, ''\)\) = 'paid'[\s\S]*?IN \('', 'simulated', 'sim'\)/.test(mig),
    'شرطٌ أوسع كان سيُسقط إيراداً حقيقياً');

// ── ٤) ولا يُحرق رقمُ فاتورةٍ في الاختبار ──────────────────────────────────
// 🔴 `tr_assign_invoice_no` تأخذ الرقم من **تسلسل** (`nextval`)، والتسلسلُ لا
//    يعود بالإرجاع. فإدراجٌ تجريبيٌّ واحد يثقب تسلسلاً يُفترض ألّا ثقبَ فيه.
check('الاختبارُ السلوكيّ لا يُدرج في subscription_payments',
    !/INSERT INTO public\.subscription_payments/.test(migAll),
    'nextval لا يُرجَع بالـROLLBACK — الإدراجُ يحرق رقمَ فاتورةٍ أبداً');

// ── ٥) تحقّقٌ سلوكيٌّ لا نصّيٌّ وحده (درس v15.42) ──────────────────────────
check('الهجرة تُجرّب الحارسَ لا تقرؤه', /DO \$behave\$/.test(migAll));
for (const [name, re] of [
    ['لا تُشعَل بوّابةُ محاكاةٍ قائمة', /SQLSTATE 'P0031'/],
    ['ولا تُنشأ جديدةٌ مفعَّلة', /INSERT INTO public\.merchant_gateways[\s\S]*?'sim', true/],
    ['ومزوّدٌ حقيقيٌّ لا يُمنع', /'moyasar', true/],
    ['والمتجرُ يسقط إلى cod ولا يتوقّف عن البيع', /store_can_sell\(v_store\)/],
    ['وتعديلٌ وهميٌّ يُرفض بـP0030', /SQLSTATE 'P0030'/],
]) check(`السلوكيّ: ${name}`, re.test(migAll));

// ── ٦) القفلُ الأخير على الكاتب نفسِه ──────────────────────────────────────
// 🔴 كلُّ ما سبق يحرس **الطريق**؛ وهذه تحرس **الباب**: `_apply_merchant_payment`
//    هي التي تختم `paid_at`، ونداءٌ بـservice_role يلتفّ على الطريق كلّه.
check('الكاتبُ النهائيّ يرفض المحاكاة',
    /_apply_merchant_payment[\s\S]*?SIM_NOT_ALLOWED/.test(mig),
    'بدونه يبقى قفلٌ واحدٌ ناقصاً على الباب نفسِه');
check('والسلوكيّ يجرّب النداءَ المباشر', /SIM_NOT_ALLOWED/.test(migAll.slice(migAll.indexOf('DO $behave$'))));

// ── ٧) والواجهةُ لا تَعِد بما ترفضه القاعدة ────────────────────────────────
const gw = strip(R('src/components/seller/GatewayCard.tsx'));
check('بطاقةُ البوّابة تقول إن المحاكاة موقوفةٌ على الحيّ',
    /موقوف على المنصّة الحيّة/.test(gw) && /switched off on the live platform/.test(gw),
    'بلا ذلك يختارها التاجرُ ويصطدم برفضٍ لا يفهمه');
check('والخيارُ الموقوفُ غيرُ قابلٍ للاختيار',
    /disabled=\{!enabledIds\.includes\(p\.id\)\}/.test(gw),
    'مرئيٌّ ليعرف ما عنده، ومعطَّلٌ فلا يصطدم بطريقٍ مسدود');

console.log(`${fail ? '❌' : '✅'} بابُ المحاكاة والإيرادُ الوهميّ: ${pass + fail} فحصاً`);
process.exit(fail ? 1 : 0);
