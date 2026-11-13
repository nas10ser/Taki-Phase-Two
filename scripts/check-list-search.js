#!/usr/bin/env node
/**
 * حارسُ بحث القوائم (v16.30) — node scripts/check-list-search.js
 *
 * ── العيبُ الذي يحرسه ───────────────────────────────────────────────────
 * أمرُ ناصر: «كمّل جميعها». فأُضيف حقلُ بحثٍ إلى كلّ شاشةٍ تعرض سجلّات.
 * وأخطرُ ما يقع في عملٍ كهذا **لا يكسر شيئاً ولا يُرى**:
 *
 *   ① **حقلٌ ميّت**: المستخدم يكتب، والشاشةُ تعرض القائمةَ الأصليّة لأن
 *      التصييرَ ما زال على المصفوفة الخام لا على `search.rows`. لا خطأ،
 *      ولا تحذير، ولا فرق في الشاشة — إلّا أن البحثَ لا يبحث.
 *   ② **بحثٌ يكذب**: ترشيحٌ في المتصفّح فوق قائمةٍ مُرقَّمة من الخادم،
 *      فيقول «لا نتيجة» عن سجلٍّ موجودٍ في صفحةٍ لم تُحمَّل. ولذلك
 *      `AdminVerification` تبحث على الخادم (`p_q`) لا هنا.
 *   ③ **فراغٌ يكذب**: «لا سجلَّ عندك» بينما الصحيح «لم أجد ما تبحث عنه».
 *
 * 🪤 وقاعدةُ المطابقة نفسُها يختبرها `test-list-search.js` بالتنفيذ.
 */
const fs = require('fs');
const path = require('path');
const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const strip = (src) => src
    .replace(/(^[ \t]*|\{)\/\*[\s\S]*?\*\//gm, '$1')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '');

let pass = 0, fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? '  ✓' : '  ✗'} ${n}`); if (!ok && d) console.log('      ' + d); ok ? pass++ : fail++; };

console.log('\nبحثُ القوائم في كلّ شاشةِ سجلّات');

// ── ① قاعدةٌ واحدة لا نسخ ────────────────────────────────────────────────
const hook = strip(R('src/hooks/useListSearch.ts'));
check('قاعدةُ المطابقة تمرّ بـ`normalizeText` (توأمُ `taki_norm`)',
    /from '\.\.\/services\/dealService'/.test(hook) && /normalizeText\(/.test(hook),
    'قاعدةُ تطبيعٍ ثانية في المتصفّح تنحرف عن القاعدة');
check('وكلُّ كلمةٍ يجب أن تُطابق (`every` لا `some`)',
    /\.every\(term => hay\.includes\(term\)\)/.test(hook),
    '`some` يجعل «قهوة بارد» تطابق كلَّ قهوة');

// ── ② لكلّ شاشة: الحقلُ موجود، والمعروضُ هو المُرشَّح ────────────────────
// [الملفّ, اسمُ الشاشة, تعبيرُ التصيير المطلوب, التعبيرُ الخام الممنوع]
const SCREENS = [
    ['src/pages/MyComplaints.tsx', 'شكاواي', 'search.rows.map(', '{rows.map('],
    ['src/pages/Contests.tsx', 'المسابقات', 'search.rows.map(', '{shown.map('],
    ['src/pages/Subscription.tsx', 'فواتيري', 'search.rows.map(', '{rows.map('],
    ['src/pages/Profile.tsx', 'المتاجر المتابَعة', 'followedSearch.rows.map(', 'followedMerchantsList.map(m => ('],
    ['src/pages/admin/AdminAdmins.tsx', 'فريق الإدارة', 'search.rows.map(', '{staff.map('],
    ['src/pages/admin/AdminModeration.tsx', 'الإنذارات', 'search.rows.map(', '{flags.map('],
];
for (const [file, name, wanted, forbidden] of SCREENS) {
    const src = strip(R(file));
    check(`${name}: الحقلُ معروض`,
        /ListSearchRow|AdmSearch|SearchField/.test(src), 'لا حقلَ بحثٍ في الشاشة');
    check(`${name}: المعروضُ هو المُرشَّح`,
        src.includes(wanted) && !src.includes(forbidden),
        `حقلٌ ميّت: التصييرُ ما زال على «${forbidden}»`);
}

// ── ③ شاشاتٌ بقوائمَ متعدّدة ──────────────────────────────────────────────
{
    const sd = strip(R('src/pages/StoreDetails.tsx'));
    check('صفحةُ المتجر: التبويباتُ الثلاثة كلُّها مُرشَّحة',
        /activeSearch\.rows\.map\(/.test(sd) && /pastSearch\.rows\.map\(/.test(sd)
        && /reviewSearch\.rows\.map\(/.test(sd),
        'تبويبٌ واحدٌ غيرُ مُرشَّحٍ يجعل البحثَ يبدو متقطّعاً');
    check('ولا بقيّةَ لتصييرٍ خام فيها',
        !/\{storeDeals\.length > 0 \? storeDeals\.map/.test(sd)
        && !/\{allStoreReviews\.length > 0 \? allStoreReviews\.map/.test(sd),
        'قائمةٌ خامٌّ باقيةٌ = حقلٌ ميّتٌ في ذلك التبويب');

    const seller = strip(R('src/pages/SellerDashboard.tsx'));
    check('لوحةُ التاجر: «عروضي» و«التقييمات» مُرشَّحتان',
        /dealSearch\.rows\.map\(/.test(seller) && /const allRatings = reviewSearch\.rows;/.test(seller),
        'حقلٌ ميّتٌ في أحد التبويبين');
    check('وعدّادا «نشطة/سابقة» لا يتبعان البحث',
        /activeCount=\{activeDeals\.length\} expiredCount=\{expiredDeals\.length\}/.test(seller),
        'عدّادٌ يتبع البحث يُبدّل أرقامَ التاجر لمجرّد أنه يكتب');

    const tax = strip(R('src/pages/admin/AdminTax.tsx'));
    check('الزكاة والضريبة: القائمتان مُرشَّحتان',
        /expSearch\.rows\.slice\(0, 30\)/.test(tax) && /paySearch\.rows\.slice\(0, 50\)/.test(tax),
        'البحثُ هنا يوسّع ما يُرى — فلو بقي `slice` على الخام ضاعت فائدتُه');
}

// ── ④ طابورُ التوثيق يبحث على الخادم لا في المتصفّح ──────────────────────
{
    const ver = strip(R('src/pages/admin/AdminVerification.tsx'));
    const repo = strip(R('src/repositories/verificationRepository.ts'));
    const mig = strip(R('supabase/JEDDAH_v16_30_verification_search.sql'));
    check('التوثيق: البحثُ يمرّ إلى الخادم',
        /adminList\(status, PAGE, null, q \|\| null\)/.test(ver) && /p_q: q \|\| null/.test(repo),
        'القائمةُ مُرقَّمة: ترشيحٌ محلّيٌّ يقول «لا نتيجة» عن طلبٍ موجود');
    check('و`q` داخل اعتماد إعادة الجلب',
        /\}, \[status, q\]\);/.test(ver),
        'بلا `q` في الاعتماد لا يُعاد الجلبُ أبداً — حقلٌ ميّتٌ بلا أيّ خطأ');
    check('و«عرض المزيد» يحمل البحثَ معه',
        /adminList\(status, PAGE, next, q \|\| null\)/.test(ver),
        'صفحةٌ تالية بلا بحثٍ تخلط نتائجَ البحث بغيرها');
    check('والدالّةُ على القاعدة تبحث فعلاً',
        /public\.taki_search_key\(v\.doc_number\)/.test(mig) && /taki_norm\(COALESCE\(u\.shop/.test(mig),
        'وعدٌ بلا محرّك');
    check('وصلاحيّاتُها أُعيدت بعد DROP بلا مجهول',
        /REVOKE ALL ON FUNCTION public\.admin_list_verifications[\s\S]{0,220}FROM anon;/.test(mig)
        && /GRANT EXECUTE ON FUNCTION public\.admin_list_verifications[\s\S]{0,160}authenticated/.test(mig),
        'الدالّةُ الجديدة تُولد ممنوحةً لـanon في هذا المشروع');
}

// ── ⑤ فراغُ البحث ليس فراغَ السجلّ ───────────────────────────────────────
for (const [file, name] of [
    ['src/pages/MyComplaints.tsx', 'شكاواي'],
    ['src/pages/Contests.tsx', 'المسابقات'],
    ['src/pages/Favorites.tsx', 'المفضّلة'],
    ['src/pages/admin/AdminVerification.tsx', 'التوثيق'],
]) {
    const src = strip(R(file));
    check(`${name}: فراغُ البحث له نصُّه`,
        /[يت]طابق بحثك|noMatch=/.test(src),   // الفعلُ يتبع جنسَ المعدود: «لا شكوى **ت**طابق»
        '«لا سجلَّ عندك» أثناء بحثٍ لم يطابق تُرسل المستخدمَ خلف شيءٍ يظنّه ضائعاً');
}

// ── ⑥ ولا رسالتان معاً: «لا سجلَّ عندك» تُكتم أثناء البحث ────────────────
// 🔴 قِيس على الإنتاج قبل الإصلاح: صفحةُ المتجر كانت تعرض «🔍 لا نتيجة تطابق
//    بحثك» **و**«📦 لا توجد عروض حالياً» معاً — والثانيةُ كذبٌ على متجرٍ له
//    سبعةُ عروض. فكلُّ فرعِ فراغٍ فوق قائمةٍ مُرشَّحة يُكتم أثناء البحث.
for (const [file, name, needles] of [
    ['src/pages/StoreDetails.tsx', 'صفحةُ المتجر',
        ['activeSearch.active ? null : (', 'pastSearch.active ? null : (', 'reviewSearch.active ? null : (']],
    ['src/pages/Profile.tsx', 'المتاجر المتابَعة', ['followedSearch.active ? null : (']],
]) {
    const src = strip(R(file));
    check(`${name}: لا رسالةَ «لا سجلّ» أثناء البحث`,
        needles.every(n => src.includes(n)),
        'رسالتان متناقضتان على الشاشة نفسِها — وإحداهما كذب');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail === 0 ? 0 : 1);
