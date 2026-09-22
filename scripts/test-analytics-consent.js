// اختبار بوّابة الموافقة على القياس (v14.82)
// التشغيل:  node scripts/test-analytics-consent.js
//
// المعيار: **كل** مسار جمعٍ يفحص البوّابة قبل أن يبني حدثاً أو يلمس الشبكة.
// وهذا اختبارٌ **بنيويّ** لا سلوكيّ عمداً: المسارات الأربعة تعيش في المتصفّح
// (localStorage · supabase · window)، ومحاكاتها كاملةً تختبر المحاكاة لا الكود.
// فالمقياس هنا: هل الحارس موجودٌ في الموضع الصحيح من الملفّ الحقيقي؟
//
// 🪤 ولماذا «قبل أوّل استعمال» لا «موجود في الملفّ»: حارسٌ بعد بناء الحدث
//    يمنع الإرسال ولا يمنع التجميع — والوعد أن **لا يُجمَع** شيء.

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

// ── ١) المسارات الأربعة تحرس نفسها ─────────────────────────────────────────
// لكلٍّ: الملفّ · الدالّة التي تبدأ الجمع · **أوّل عملِ جمعٍ داخلها**.
// 🪤 وكان المقياس أوّلاً «الحارس قبل نداء الشبكة»، ففشل على `analyticsTracker`
//    بلا ذنب: نداءُ `record_analytics_events` يعيش في `flush()` المعرَّفة
//    **قبل** `trackEvent` في الملفّ، فالبحث من نقطة الدخول لا يجده (‎-1).
//    الكود كان سليماً والاختبار هو المخطئ. المقياس الصحيح: الحارس قبل
//    **أوّل عملٍ** داخل الدالّة نفسها — وهو ما يضمن ألّا يُجمَّع شيء أصلاً.
const PATHS = [
    {
        label: 'analyticsTracker.trackEvent (سلوك داخل التطبيق)',
        file: 'src/services/analyticsTracker.ts',
        entry: 'export const trackEvent',
        work: 'queue.push(',                       // التكديس في الذاكرة
        network: "supabase.rpc('record_analytics_events'",
    },
    {
        label: 'searchTracker.trackSearch (أحداث البحث)',
        file: 'src/services/searchTracker.ts',
        entry: 'export const trackSearch',
        work: 'setTimeout(',
        network: "rpc('track_search'",
    },
    {
        label: 'siteVisit.trackVisit (الزيارة والمصدر)',
        file: 'src/services/siteVisit.ts',
        entry: 'export const trackVisit',
        work: "rpc('track_site_visit'",
        network: "rpc('track_site_visit'",
    },
    {
        label: 'siteVisit.markVisitBooked (إتمام الحجز)',
        file: 'src/services/siteVisit.ts',
        entry: 'export const markVisitBooked',
        work: "rpc('taki_mark_session_booked'",
        network: "rpc('taki_mark_session_booked'",
    },
    {
        label: 'AppContext track_app_open (فتح التطبيق)',
        file: 'src/context/AppContext.tsx',
        entry: "const OPEN_KEY = 'TAKI_APPOPEN_AT'",
        work: "supabase.rpc('track_app_open'",
        network: "supabase.rpc('track_app_open'",
    },
];

for (const p of PATHS) {
    const src = read(p.file);
    const iEntry = src.indexOf(p.entry);
    const from = iEntry < 0 ? 0 : iEntry;
    const iGuard = src.indexOf('analyticsAllowed()', from);
    const iWork = src.indexOf(p.work, from);

    check(`${p.label}: نقطة الدخول موجودة`, iEntry >= 0, `لم أجد «${p.entry}» في ${p.file}`);
    check(`${p.label}: مسار الإرسال ما زال قائماً`,
        src.includes(p.network),
        `لم أجد «${p.network}» — إن حُذف المسار فالاختبار يحرس عدماً`);
    check(`${p.label}: الحارس قبل أوّل عملِ جمع`,
        iEntry >= 0 && iGuard > iEntry && iWork > iGuard,
        `entry=${iEntry} guard=${iGuard} work(${p.work})=${iWork}`);
}

// ── ٢) البوّابة نفسها: الافتراضي، والفشل المغلق ────────────────────────────
const consent = read('src/services/analyticsConsent.ts');
check('الافتراضي «مسموح» حين لا قيمة مخزَّنة',
    /localStorage\.getItem\(OPT_OUT_KEY\)\s*!==\s*'1'/.test(consent),
    'المقارنة يجب أن تكون: موقوفٌ فقط حين القيمة "1" بالضبط');
check('متصفّحٌ يمنع التخزين ⇒ لا يُعطَّل القياس (فشلٌ مفتوح مقصود ومكتوب)',
    /catch\s*\{[\s\S]{0,120}cached = true;/.test(consent),
    'الاستثناء يجب أن يُرجع true لا أن يرمي');
check('الإيقاف يمحو أثر القياس من المتصفّح',
    /if \(!allowed\) clearTraces\(\);/.test(consent),
    'وإلا بقي معرّف الجلسة فعاد القياس بنفس الهوية عند إعادة التفعيل');
check('معرّف الجلسة ضمن ما يُمحى',
    /TRACE_KEYS[\s\S]{0,160}taki_an_sid/.test(consent));
check('المزامنة من الحساب قراءةٌ فقط (لا تكتب)',
    !/syncAnalyticsConsentFromAccount[\s\S]{0,700}set_analytics_opt_out/.test(consent),
    'لو كتبت، لدهس جهازٌ لم يُضبط اختيارَ جهازٍ ضُبط عمداً');

// ── ٣) الوثيقة لم تعد تَعِد بما لا يُنفَّذ ──────────────────────────────────
const privacy = read('src/pages/legal/Privacy.tsx');
check('قسم الكوكيز لم يعد يدّعي أن إعدادات المتصفّح تُوقف القياس',
    !/إعدادات متصفّحك لرفض هذه الملفّات/.test(privacy),
    'النصّ القديم ما زال موجوداً');
check('الوثيقة تقول صراحةً إن القياس لا يمرّ بالكوكيز',
    /لا يمرّ بملفّات تعريف الارتباط/.test(privacy));
check('المفتاح داخل الوثيقة نفسها (يصله الزائر بلا حساب)',
    /<AnalyticsToggleRow/.test(privacy) && /AnalyticsToggleRow/.test(privacy));
check('حقّ سحب الموافقة يشير إلى المفتاح (عربي)',
    /مفتاحُ إيقافٍ مباشر/.test(privacy));
check('حقّ سحب الموافقة يشير إلى المفتاح (إنجليزي)',
    /direct off switch/.test(privacy));

// ── ٤) المفتاح في «حسابي» أيضاً، وبحالةٍ واحدة ─────────────────────────────
const profile = read('src/pages/Profile.tsx');
check('المفتاح في «حسابي»', /<AnalyticsToggleRow\s*\/>/.test(profile));
const toggle = read('src/components/AnalyticsToggleRow.tsx');
check('النسختان تتشاركان الحالة عبر حدثٍ واحد',
    /CONSENT_EVENT/.test(toggle) && /addEventListener\(CONSENT_EVENT/.test(toggle),
    'مفتاحان لا يتزامنان = مفتاحان يتناقضان');
check('فشلُ المزامنة لا يُرجع المفتاح (الإيقاف سرى فعلاً على الجهاز)',
    /لا نُرجع المفتاح/.test(toggle));

// ── ٥) الإصدار القانوني تحرّك مع تغيّر النصّ ───────────────────────────────
const legal = read('src/data/legalVersion.ts');
check('LEGAL_VERSION تحرّك بعد تعديل الوثيقة',
    !/LEGAL_VERSION = '2026-09-13'/.test(legal),
    'قاعدة المشروع: أي تعديل قانوني يُغيّر الرقم');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} نجح · ${fail} فشل`);
process.exit(fail === 0 ? 0 : 1);
