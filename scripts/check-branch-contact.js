#!/usr/bin/env node
/**
 * check-branch-contact.js — رقمُ تواصلٍ لكلّ فرع (v16.53)
 *
 * ── العيوبُ التي يحرسها ─────────────────────────────────────────────────
 * ① **عمودٌ حيٌّ بلا شاشة.** `store_branches.phone` كان موجوداً منذ زمن
 *    و`branchRepository` يقرؤه ويكتبه — و**صفرُ فرعٍ من عشرة يحمل رقماً**،
 *    لأن لا حقلَ إدخالٍ في أيّ شاشة. وجودُ العمود لم يكن يعني وجودَ الميزة.
 * ② **ارتدادٌ إلى حقلٍ لا وجودَ له.** كتبتُ أوّلاً `booking.deal.contactPhone`
 *    وهو **غيرُ موجودٍ في `Deal` إطلاقاً** — فالرقمُ الموحّد ما كان ليظهر
 *    أبداً، **ولا يكشف ذلك أيُّ خطأ** لأن رقمَ الفرع يُغطّي عليه حين يوجد.
 *    ⇒ يُشترط أن يأتي الارتدادُ من `storeProfiles`، وهو المصدرُ المقيس.
 * ③ **نسخةٌ مجمّدةٌ من رقمِ تواصل.** لو نُسخ الرقمُ داخل الحجز أو العرض
 *    لاتّصل المشتري برقمٍ ميّتٍ بعد أن غيّره التاجر.
 * ④ **تحقُّقٌ في الواجهة وحدها.** `branches_update_own` تسمح للتاجر بالكتابة
 *    مباشرةً على الجدول من المتصفّح — فالحارسُ الحقيقيُّ مشغّلٌ في القاعدة.
 *
 * 🪤 ويُجرَّد التعليقُ قبل أيّ فحصِ نصّ.
 */
const fs = require('fs');
const path = require('path');

const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const strip = (src) => src
    .replace(/(^[ \t]*|\{)\/\*[\s\S]*?\*\//gm, '$1')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const stripSql = (src) => src.replace(/^\s*--[^\n]*$/gm, '');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log(`      ${detail}`);
    ok ? pass++ : fail++;
};

console.log('\nرقمُ تواصلٍ لكلّ فرع');

// ── ① المحرّرُ يكتبه، والعرضُ يقرؤه ───────────────────────────────────────
{
    // 🪤 المدى ملفّان لا ملفّ: صفُّ الموقع خرج إلى مكوّنه في v16.53 حين
    //    رفضت السقّافة نموَّ الصفحة — وحارسٌ مرساتُه ملفٌّ واحدٌ يسقط على
    //    **نقلٍ سليم** بلا أن يتغيّر سلوكٌ واحد (وقع هذا في v16.28).
    const sd = strip(R('src/pages/StoreDetails.tsx'))
        + '\n' + strip(R('src/components/store/StoreBranchRow.tsx'));
    check('محرّرُ بطاقة الموقع فيه حقلُ الرقم',
        /branchDraft\.phone/.test(sd) && /setBranchDraft\(d => \(\{ \.\.\.d, phone:/.test(sd),
        'عمودٌ في القاعدة بلا حقلِ إدخال = ميزةٌ ميّتة (قِيس: صفرُ فرعٍ له رقم)');
    check('والحفظُ يُمرّره إلى المستودع',
        /setCard\(b\.id, \{[\s\S]{0,200}?phone: branchDraft\.phone/.test(sd),
        'الحقلُ يُكتب في الشاشة ولا يصل القاعدة');
    check('وصفحةُ المتجر تعرض اتصالاً وواتساب لكلّ فرع',
        /<BranchContactRow[\s\S]{0,160}?branchPhone=\{b\.phone\}[\s\S]{0,120}?storePhone=\{storeContactPhone\}/.test(sd),
        'لم أجد صفَّ التواصل في صفّ الموقع مع ارتداده إلى الموحّد');
}

// ── ② 🔴 الارتدادُ من مصدرٍ **موجود** ─────────────────────────────────────
{
    const bk = strip(R('src/pages/Bookings.tsx'));
    // 🪤 حدٌّ بعد الاسم إلزاميّ لا تجميل: `/<BranchContactRow/` تطابق
    //    `<BranchContactRowXX` أيضاً — فكسرةُ إعادةِ تسميةٍ مرّت ولم يسقط
    //    الحارس (قِيس: `npm test` خرج بصفر على شاشةٍ لا تعرض الصفَّ إطلاقاً).
    check('شاشةُ الطلبات تعرض صفَّ التواصل بالفرع',
        /<BranchContactRow[\s/>]/.test(bk),
        'المشتري لا يرى رقمَ الفرع الذي حجز منه');
    check('وارتدادُها يقرأ `storeProfiles` لا حقلاً غيرَ موجود',
        /storePhoneOf/.test(bk) && /storeProfiles\[String\(b\?\.deal\?\.storeId/.test(bk),
        'الارتدادُ إلى `deal.contactPhone` أو `booking.storePhone` ميّت: لا وجودَ لهما');
    check('ولا يُقرأ رقمٌ من صفّ الحجز نفسه',
        !/booking\.storePhone/.test(bk) && !/deal\?\.contactPhone/.test(bk),
        'عاد الارتدادُ الميّت');
    // أن الحقل غيرُ موجودٍ فعلاً — يُقاس لا يُفترض
    check('والتأكّدُ مقيس: `Deal` بلا `contactPhone`',
        !/contactPhone/.test(strip(R('src/data/mock.ts'))),
        'صار `Deal` يحمل `contactPhone` — راجِع الارتداد، فقد تغيّرت الحقيقة');
}

// ── ③ لا نسخةَ مجمّدةٍ من الرقم ──────────────────────────────────────────
{
    const hook = strip(R('src/hooks/useBranchPhones.ts'));
    check('الرقمُ يُقرأ حيّاً من `store_branches`',
        /from\('store_branches'\)[\s\S]{0,120}?select\('id, phone'\)/.test(hook),
        'لم أجد القراءة الحيّة');
    check('ونداءٌ واحدٌ لكلّ الطلبات لا نداءٌ لكلّ بطاقة',
        /\.in\('id', missing\)/.test(hook),
        '`in(...)` هو ما يمنع طلباً لكلّ صفّ — وبدونه يصير الحملُ خطّياً');
    // 🪤 والنمطُ **محدَّد**: `phone` وحدها تُطابق رقمَ المشتري (`user_phone`)
    //    ورقمَ عنوان التوصيل — وكلاهما قائمٌ ومقصودٌ منذ زمن. أعطى النمطُ
    //    الواسعُ إيجابيّةً كاذبةً عند أوّل تشغيل. المقصودُ هو رقمُ **المتجر
    //    أو الفرع** وحده.
    check('ولا يُخزَّن رقمُ المتجر أو الفرع داخل الحجز',
        !/\b(store_phone|branch_phone|storePhone|branchPhone|shop_phone|shopPhone)\b/
            .test(strip(R('src/repositories/bookingRepository.ts'))),
        'ظهر رقمُ متجرٍ/فرعٍ في مستودع الحجوزات — نسخةٌ مجمّدةٌ تُنتج رقماً ميّتاً بعد تغييره');
}

// ── ④ الحارسُ الحقيقيُّ في القاعدة لا في الواجهة ──────────────────────────
{
    const mig = stripSql(R('supabase/JEDDAH_v16_53_branch_contact.sql'));
    check('مشغّلٌ يُطبّع رقمَ الفرع ويتحقّق منه في القاعدة',
        /CREATE TRIGGER tr_norm_branch_phone/.test(mig)
        && /BEFORE INSERT OR UPDATE OF phone ON public\.store_branches/.test(mig),
        'تحقُّقُ الواجهة وحده يُلتفّ عليه بطلبٍ مباشر (سياسةٌ ليست حارساً)');
    check('والرفضُ برمزٍ بعينه لا باستثناءٍ عامّ',
        /BRANCH_PHONE_INVALID/.test(mig),
        'فحصٌ يقبل أيَّ استثناءٍ ليس فحصاً');
    check('وتواصلُ الطلب في البوتين يقرأ الفرع',
        /bot_booking_contact[\s\S]*?FROM store_branches sb/.test(mig),
        'البوتان يعرضان الرقمَ الموحّد وحده');
    check('ومقيَّدٌ بمتجر الطلب نفسِه',
        /sb\.id = v_b\.location_id AND sb\.merchant_id = v_b\.store_id/.test(mig),
        'بلا شرط `merchant_id` قد يُقرأ فرعُ متجرٍ آخر بمعرّفٍ متصادم');
    check('والمستودعُ يرفض رقماً لا يُنتج رابطاً صالحاً',
        /waNumber\(raw\)/.test(strip(R('src/repositories/branchRepository.ts'))),
        'زرٌّ يقود إلى «الرقم غير صالح» أسوأ من لا زرّ (درس v14.77)');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail === 0 ? 0 : 1);
