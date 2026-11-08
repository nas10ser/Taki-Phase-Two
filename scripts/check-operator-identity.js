#!/usr/bin/env node
/**
 * check-operator-identity.js — هويّةُ المُشغِّل: مصدرٌ واحدٌ وأسطحٌ موصولة (v15.81)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 العيبُ المقيس الذي أنشأ هذا الحارس: المنصّة تُلزم تجّارها بسجلٍّ تجاريٍّ
 *    موثَّقٍ (`verification.mode='required'` على جدّة ومشغّلٌ حيٌّ على `deals`)
 *    **وهويّتُها هي غائبةٌ عن كلّ سطحٍ عامّ**. والغيابُ لا يُمسكه أيٌّ من
 *    حرّاس `npm test` السابقة: كلُّها تمنع **الادّعاءَ الزائد** (مثل
 *    `test-zatca-phase-disclosure.js`)، ولا حارسَ يمنع **النقصَ الواجب**.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ما يفحصه، وكلُّ بندٍ منه مكسورٌ مرّةً قبل تصديقه
 * ═══════════════════════════════════════════════════════════════════════════
 * ١) **عقدٌ سلوكيٌّ مُنفَّذ لا نصٌّ مقروء**: تُنادى دوالُّ `shared/operatorIdentity.js`
 *    فعلاً بمُدخلاتٍ فارغةٍ ومكتملةٍ ويُقاس مُخرَجها. والسببُ أن فحصاً نصّياً
 *    لا يُثبت حياةً (درس `feedback_text_check_cannot_prove_liveness`): جسمُ
 *    دالّةٍ مُفرَّغٌ يُبقي كلَّ الأسماء في مكانها.
 * ٢) **لا قيمةَ هويّةٍ مكتوبةٌ في سطحٍ عامّ**: ولا رقمَ بعشر خاناتٍ أو خمسَ
 *    عشرة، ولا قراءةً مباشرةً لأعضاء jsonb (`cr_number`…) خارج المُطبِّع
 *    الوحيد، ولا علامةً تجاريّةً تُستعمل اسماً نظامياً.
 * ٣) **الأسطحُ موصولةٌ فعلاً**: استيرادٌ **وموضعُ تصيير** معاً — استيرادٌ بلا
 *    تصييرٍ تهزّه الشجرةُ فلا يبقى شيء (درس v14.86: كسرةٌ لا تكسر).
 * ٤) **مرساةُ البيانات المنظّمة قائمةٌ وفارغةٌ من القيم**: الحقنُ لحظيٌّ، فلو
 *    زالت المرساةُ لم يُحقن شيءٌ **ولا يُخطئ أحد**.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🟠 والمرحلةُ الثانية **تُحذِّر ولا تُفشِل** (خروجٌ صفر)
 * ═══════════════════════════════════════════════════════════════════════════
 * القيمُ الأربعُ في `platform_settings.tax_settings` ويحرّرها ناصرٌ من لوحة
 * المدير. فالنقصُ لا يرفعه غيرُه، وحارسٌ يسقط عليه يُوقف كلَّ نشرةٍ لسببٍ لا
 * يملك أحدٌ هنا إصلاحَه. والفراغُ **آمنٌ تماماً**: البيانُ لا يُعرض أصلاً.
 * فيُقال بصوتٍ عالٍ في كلّ بناءٍ (ومع `::warning::` ليُقرأ من سجلّ GitHub بلا
 * توكن) ولا يُسقط شيئاً.
 *
 * 🪤 ويُسمّى المضيفُ الذي قُرئت منه القيمُ **دائماً**: فحصٌ يقول «سليمة» ولا
 *    يقول من أيّ قاعدةٍ قرأ قد يُطمئن على المختبر و`.env` المحلّي يشير إليه
 *    (درس v14.77). وغيابُ الشبكة أو المتغيّرات **ليس فشلاً** — يُقال صراحةً
 *    إن القيمَ الحيّةَ لم تُقرأ.
 *
 * 🪤 ويُجرَّد التعليقُ قبل أيّ بحث: هذا الملفُّ وملفُّ القواعد يسمّيان العلامةَ
 *    التجاريّةَ وأسماءَ الأعضاء ليشرحا الخطر — وفخُّ «الحارسُ يتّهم النصَّ
 *    الذي يحرسه» وقع في هذا المستودع تسعَ مرّات قبل اليوم.
 */
const fs = require('fs');
const path = require('path');
const { walk } = require('./lib/walk');

const ROOT = path.resolve(__dirname, '..');
const SELF = path.relative(ROOT, __filename);
/** 🪤 المُطبِّعُ الوحيد — يُسمح له بذكر أسماء الأعضاء، فهو الذي يقرؤها. */
const SOURCE = 'shared/operatorIdentity.js';

const problems = [];
const fail = (where, what) => problems.push(`${where} — ${what}`);

// ═══════════════════════════════════════════════════════════════════════════
// تجريدُ التعليقات: كتليّ ثمّ HTML ثمّ سطريّ (و`//` داخل عنوانٍ ليست تعليقاً)
// ═══════════════════════════════════════════════════════════════════════════
const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((ln) => {
        const i = ln.search(/(^|[^:])\/\//);
        if (i < 0) return ln;
        const cut = ln.indexOf('//', i);
        return ln.slice(0, cut);
    })
    .join('\n');

const read = (rel) => {
    try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return null; }
};

// ═══════════════════════════════════════════════════════════════════════════
// ١) العقدُ السلوكيّ — يُنفَّذ، فلا يمرّ جسمٌ مُفرَّغ
// ═══════════════════════════════════════════════════════════════════════════
const M = require(path.join(ROOT, SOURCE));

const FULL_RAW = {
    entity_name: 'شركةُ قياسٍ للتجارة',
    cr_number: '١٢٣٤٥٦٧٨٩٠',
    entity_address: 'مبنى ٠٠٠٠، شارعُ القياس، الرياض ٠٠٠٠٠',
    vat_number: '',
};

const behaviour = () => {
    const where = SOURCE;
    const empty = M.normalizeOperatorIdentity(undefined);

    // الفارغُ فارغٌ فعلاً — ولا قيمةَ افتراضيّةٍ مخبوءةٌ في المُطبِّع
    for (const k of ['legalName', 'registryNumber', 'vatNumber', 'nationalAddress']) {
        if (empty[k] !== '') fail(where, `هويّةٌ فارغةٌ أعادت قيمةً لـ${k} — لا قيمَ في المصدر`);
    }
    if (M.operatorIdentityIsComplete(empty)) fail(where, 'هويّةٌ فارغةٌ عُدَّت مكتملة');
    if (M.operatorIdentityLine(empty, 'ar') !== '') fail(where, 'سطرُ هويّةٍ فارغةٍ ليس فراغاً (لافتةٌ معلّقة)');
    if (M.operatorIdentityLine(empty, 'en') !== '') fail(where, 'سطرُ هويّةٍ فارغةٍ بالإنجليزية ليس فراغاً');
    if (M.operatorIdentityLd(empty) !== null) fail(where, 'بياناتٌ منظّمةٌ بُنيت على هويّةٍ فارغة');

    // 🔴 العلامةُ التجاريّةُ ليست اسماً نظامياً — فتُعَدّ غيرَ مُعطاة
    const brandOnly = M.normalizeOperatorIdentity({
        entity_name: 'TAKI - تاكي', cr_number: FULL_RAW.cr_number, entity_address: FULL_RAW.entity_address,
    });
    if (M.operatorIdentityIsComplete(brandOnly)) {
        fail(where, 'علامةٌ تجاريّةٌ قُبلت اسماً نظامياً — وهو بيانٌ غيرُ صحيح');
    }

    // المكتملةُ تعمل
    const full = M.normalizeOperatorIdentity(FULL_RAW);
    if (!M.operatorIdentityIsComplete(full)) fail(where, 'هويّةٌ مكتملةٌ عُدَّت ناقصة');
    const line = M.operatorIdentityLine(full, 'ar');
    for (const v of [full.legalName, full.registryNumber, full.nationalAddress]) {
        if (!line.includes(v)) fail(where, `سطرُ الهويّة لا يحمل «${v}»`);
    }
    const ld = M.operatorIdentityLd(full);
    if (!ld || ld.legalName !== full.legalName || ld.identifier !== full.registryNumber) {
        fail(where, 'البياناتُ المنظّمةُ لا تحمل الاسمَ النظاميَّ ورقمَ السجلّ');
    }
    if (ld && !(ld.address && ld.address.streetAddress === full.nationalAddress)) {
        fail(where, 'البياناتُ المنظّمةُ بلا عنوانٍ وطنيّ');
    }
    // 🪤 ولا `vatID` فارغة: مفتاحٌ فارغٌ يُقرأ ادّعاءَ تسجيلٍ لا غيابَه
    if (ld && 'vatID' in ld) fail(where, '`vatID` أُضيفت بلا رقمٍ ضريبيّ — ادّعاءُ تسجيل');
    if (M.operatorVatIsRegistered(full)) fail(where, 'رقمٌ ضريبيٌّ فارغٌ عُدَّ تسجيلاً');

    const withVat = M.normalizeOperatorIdentity({ ...FULL_RAW, vat_number: '300000000000003' });
    if (!M.operatorVatIsRegistered(withVat)) fail(where, 'رقمٌ ضريبيٌّ موجودٌ لم يُعَدّ تسجيلاً');
    const ldVat = M.operatorIdentityLd(withVat);
    if (!ldVat || ldVat.vatID !== '300000000000003') fail(where, '`vatID` غابت مع وجود رقمٍ ضريبيّ');

    // ٧) التنبيهُ في **الاتجاهين** — فحصُ الاتجاه الواحد يُبقي عيبَ
    //    «تنبيهٌ لا ينقضي أبداً» قائماً
    const warnEmpty = M.operatorIdentityWarnLines(empty, 'قاعدةُ قياس');
    if (!warnEmpty.length) fail(where, 'هويّةٌ ناقصةٌ بلا تنبيه');
    for (const f of M.REQUIRED_FIELDS) {
        if (!warnEmpty.some((l) => l.includes(f.key))) fail(where, `التنبيهُ لا يسمّي الحقلَ الناقص ${f.key}`);
    }
    if (!warnEmpty.some((l) => l.includes('قاعدةُ قياس'))) {
        fail(where, 'التنبيهُ لا يسمّي القاعدةَ التي قُرئت منها القيم');
    }
    if (M.operatorIdentityWarnLines(full, 'x').length) fail(where, 'هويّةٌ مكتملةٌ ما زالت تُنبّه — تنبيهٌ لا ينقضي');
};

// ═══════════════════════════════════════════════════════════════════════════
// ٢) لا قيمةَ هويّةٍ مكتوبةٌ في سطحٍ عامّ
// ═══════════════════════════════════════════════════════════════════════════
/** أسطحُ الهويّة العامّة — ما يقرؤه زائرٌ بلا حساب. */
const SURFACE_DIRS = ['src/pages/legal'];
const SURFACE_FILES = [
    'src/components/SiteFooter.tsx',
    'src/components/OperatorIdentityBlock.tsx',
    'src/data/operatorIdentity.ts',
    SOURCE,
];

const surfaceFiles = () => [
    ...walk(ROOT, SURFACE_DIRS, /\.(ts|tsx)$/),
    ...SURFACE_FILES,
].filter((f) => f !== SELF);

/** أعضاءُ jsonb — لا تُقرأ إلّا في المُطبِّع الوحيد. */
const RAW_MEMBERS = /\b(entity_name|cr_number|vat_number|entity_address)\b/;
/** 🪤 الشرطةُ ثلاثةُ محارفَ مختلفة، فلا يُكتفى بواحد. */
const BRAND_AS_NAME = /TAKI\s*[—–\-]\s*تاكي/;

/**
 * 🪤 ويُطبَع عددُ الملفّات الممسوحة: مسحٌ فارغٌ يمرّ أخضرَ وهو لا يفحص شيئاً
 *    (توقيعُ مُساعِدٍ خاطئ أفرغ مسحَ حارسٍ هنا من قبل، فمرّ وهو أعمى).
 */
let scanned = 0;

const noHardcoded = () => {
    const files = surfaceFiles();
    scanned = files.length;
    if (scanned < 10) fail('المدى', `مسحٌ ضيّقٌ مريب: ${scanned} ملفّاً فقط — سبعُ صفحاتٍ قانونيّةٍ وحدها أكثر`);
    for (const rel of files) {
        const raw = read(rel);
        if (raw == null) { fail(rel, 'سطحٌ معلَنٌ غيرُ موجود — المدى انحرف'); continue; }
        const src = stripComments(raw);
        src.split('\n').forEach((ln, i) => {
            const at = `${rel}:${i + 1}`;
            if (/(?<![0-9])[0-9]{10}(?![0-9])/.test(ln) || /(?<![0-9])[0-9]{15}(?![0-9])/.test(ln)) {
                fail(at, 'رقمٌ بعشر/خمسَ عشرةَ خانةً مكتوبٌ في سطحٍ عامّ — السجلُّ والرقمُ الضريبيُّ يُقرآن من الإعداد');
            }
            if (rel !== SOURCE && RAW_MEMBERS.test(ln)) {
                fail(at, `قراءةٌ مباشرةٌ لعضوِ jsonb — تمرّ عبر ${SOURCE} وحده`);
            }
            if (BRAND_AS_NAME.test(ln)) {
                fail(at, 'علامةٌ تجاريّةٌ مكتوبةٌ في سطحِ هويّة — الاسمُ النظاميُّ يُقرأ من الإعداد');
            }
        });
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// ٣) الأسطحُ موصولةٌ: استيرادٌ **وتصييرٌ**
// ═══════════════════════════════════════════════════════════════════════════
const WIRED = [
    'src/components/SiteFooter.tsx',
    'src/pages/legal/Terms.tsx',
    'src/pages/legal/Privacy.tsx',
    'src/pages/legal/Contact.tsx',
    'src/pages/legal/About.tsx',
    'src/pages/legal/Refund.tsx',
    'src/pages/legal/DeleteAccount.tsx',
    'src/pages/legal/FAQ.tsx',
];

const wiring = () => {
    for (const rel of WIRED) {
        const raw = read(rel);
        if (raw == null) { fail(rel, 'سطحٌ واجبُ الوصل غيرُ موجود'); continue; }
        const src = stripComments(raw);
        if (!/import\s+OperatorIdentityBlock\s+from/.test(src)) {
            fail(rel, 'بلا استيرادِ `OperatorIdentityBlock` — سطحٌ عامٌّ بلا هويّة');
        }
        // 🪤 واستيرادٌ بلا تصييرٍ تهزّه الشجرة: الموضعُ هو الدليل
        if (!/<OperatorIdentityBlock\b/.test(src)) {
            fail(rel, 'يستورد البيانَ ولا يُصيّره — استيرادٌ تهزّه الشجرةُ فلا يبقى شيء');
        }
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// ٣ب) البوّابةُ **قبل** المصرف لا بعده
// ═══════════════════════════════════════════════════════════════════════════
/**
 * 🔴 وجودُ `return null` لا يكفي — موضعُه هو كلُّ شيء. بوّابةٌ بعد أوّل تصييرٍ
 *    تُخرج اللافتاتَ الفارغةَ ثمّ تمنعها، وهو العيبُ نفسُه. وهذا الفخُّ وقع
 *    هنا قبلاً: «نافذةٌ متماثلةٌ أرضاها حارسٌ **بعد** المصرف».
 */
const gateBeforeSink = () => {
    const rel = 'src/components/OperatorIdentityBlock.tsx';
    const raw = read(rel);
    if (raw == null) { fail(rel, 'مكوّنُ البيان غيرُ موجود'); return; }
    const src = stripComments(raw);
    const gate = src.search(/if\s*\(\s*!\s*\w+\.complete\s*\)\s*return\s+null\s*;/);
    if (gate < 0) {
        fail(rel, 'بلا بوّابةِ `if (!…​.complete) return null;` — لافتةٌ فارغةٌ قد تُعرض');
        return;
    }
    /**
     * 🪤 والمصرفُ **أوّلُ `return` في الملفّ** لا «`return (` يتبعه `<`».
     *    كتبتُ الثانيةَ أوّلاً فنقلتُ البوّابةَ إلى ما بعد التصيير **ومرّ
     *    الفحصُ**: صار بين `return (` و`<` سطرُ البوّابةِ نفسُه فلم يطابق
     *    النمطَ. أي أنّ الحارسَ كان يَقيس شكلَ السطر لا الترتيبَ المقصود —
     *    وهو عينُ فخّ «نافذةٌ أرضاها حارسٌ بعد المصرف». كُسِر فصُحّح.
     */
    const firstReturn = src.search(/\breturn\b/);
    if (firstReturn >= 0 && firstReturn < gate) {
        fail(rel, 'البوّابةُ **بعد** أوّل `return` — تُعرض اللافتةُ الفارغةُ ثمّ تُمنع');
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// ٤) مرساةُ البيانات المنظّمة: قائمةٌ، وبلا قيمةِ هويّةٍ مكتوبة
// ═══════════════════════════════════════════════════════════════════════════
const jsonLd = () => {
    const rel = 'index.html';
    const raw = read(rel);
    if (raw == null) { fail(rel, 'غيرُ موجود'); return; }
    if (!/id="taki-org-ld"/.test(raw)) {
        fail(rel, 'مرساةُ `id="taki-org-ld"` غائبة — الحقنُ اللحظيُّ لا يجد وسمَه ولا يُخطئ');
    }
    if (!/#organization/.test(raw)) {
        fail(rel, 'عقدةُ `#organization` غائبة — لا موضعَ للهويّة في البيانات المنظّمة');
    }
    const src = stripComments(raw);
    for (const k of ['legalName', 'vatID', 'taxID', 'identifier']) {
        if (new RegExp(`"${k}"`).test(src)) {
            fail(rel, `«${k}» مكتوبٌ نصّاً — قيمُ الهويّة تُحقن من الإعداد الحيّ لا من الملفّ`);
        }
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// المرحلةُ الثانية — تنبيهٌ بخروجٍ صفر
// ═══════════════════════════════════════════════════════════════════════════
const fromDotenv = (() => {
    const out = {};
    for (const f of ['.env', '.env.local']) {
        let raw;
        try { raw = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
        for (const line of raw.split('\n')) {
            const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
            if (!m) continue;
            let v = m[2].trim();
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
            out[m[1]] = v;
        }
    }
    return out;
})();
const envVar = (k) => process.env[k] || fromDotenv[k] || '';

/** يقرأ الإعدادَ الحيَّ بأفضل جهد. `null` تعني «لم تُقرأ» لا «فارغة». */
const liveIdentity = async () => {
    const url = envVar('SUPABASE_URL');
    const key = envVar('SUPABASE_ANON_KEY');
    if (!url || !key) return { id: null, host: '' };
    let host = '';
    try { host = new URL(url).host; } catch { return { id: null, host: '' }; }
    try {
        const res = await fetch(
            `${url.replace(/\/$/, '')}/rest/v1/platform_settings?key=eq.tax_settings&select=value`,
            // 🪤 `globalThis.` صريحةً: بيئةُ المدقّق لا تُعرّف `AbortSignal`
            //    (`no-undef`)، ومهلةٌ بلا سقفٍ تُعلّق البناءَ على شبكةٍ بطيئة.
            { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: globalThis.AbortSignal.timeout(6000) },
        );
        if (!res.ok) return { id: null, host };
        const rows = await res.json();
        if (!Array.isArray(rows) || !rows.length) return { id: null, host };
        return { id: M.normalizeOperatorIdentity(rows[0].value), host };
    } catch {
        return { id: null, host };                 // لا شبكةَ وقتَ البناء ليست فشلاً
    }
};

const main = async () => {
    behaviour();
    noHardcoded();
    wiring();
    gateBeforeSink();
    jsonLd();

    if (problems.length) {
        console.error('❌ هويّةُ المُشغِّل — خللٌ بنيويّ:');
        for (const p of problems) console.error(`   • ${p}`);
        console.error('   الإصلاحُ وصلُ السطح أو إزالةُ القيمة المكتوبة، لا استثناءُ الملفّ.');
        process.exit(1);
    }
    console.log(`✅ هويّةُ المُشغِّل: ${scanned} ملفّاً مُسِح بلا قيمٍ مكتوبة · ${WIRED.length} سطحاً موصولاً ومُصيَّراً · بوّابةٌ قبل المصرف · مرساةُ البيانات المنظّمة قائمة`);

    const { id, host } = await liveIdentity();
    if (!id) {
        console.log(`ℹ️ القيمُ الحيّةُ لم تُقرأ${host ? ` (${host})` : ' (لا متغيّرات قاعدةٍ في هذه البيئة)'} — فلا حكمَ على اكتمالها من هنا.`);
        return;
    }
    const lines = M.operatorIdentityWarnLines(id, host);
    if (!lines.length) {
        console.log(`✅ وهويّةُ المُشغِّل مكتملةٌ على ${host} — البيانُ يُعرض على كلّ سطحٍ عامّ.`);
        return;
    }
    console.log('');
    console.log('⚠️ ══════════════════════════════════════════════════════════');
    for (const l of lines) {
        console.log(`⚠️  ${l}`);
        console.log(`::warning::${l}`);          // يُقرأ من سجلّ GitHub بلا توكن
    }
    console.log('⚠️ ══════════════════════════════════════════════════════════');
    console.log('');
};

main();
