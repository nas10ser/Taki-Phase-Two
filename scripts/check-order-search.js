#!/usr/bin/env node
/**
 * حارسُ البحث في الطلبات (v16.28) — node scripts/check-order-search.js
 *
 * ── ما يحرسه ────────────────────────────────────────────────────────────
 * طلبُ ناصر: «بحثٌ في قائمة الطلبات — الحاليّة والسابقة — برقم الطلب أو
 * الفاتورة أو الجوّال أو المنتج». وثلاثةُ أخطاءٍ تُفرغ هذا الطلب من معناه
 * **بلا أن تكسر شاشةً واحدة**:
 *
 *   ① **وعدٌ بلا محرّك**: الحقلُ يقول «أو الفاتورة» والقاعدةُ لا تبحث فيها.
 *      (وهي الحالُ قبل هذا الإصدار: قِيس على جدة — البحثُ بـ`TK-000054`
 *      أرجع **صفرَ صفّ** بينما رقمُ الطلب أرجع صفّاً.) فالحارسُ يربط
 *      نصَّ الحقل بفرع `order_invoices` في الهجرة.
 *   ② **بحثٌ في المتصفّح**: القوائمُ مُرقَّمةٌ من الخادم (٢٠ صفّاً)، فترشيحٌ
 *      محلّيٌّ يقول «لا نتائج» عن طلبٍ **موجود** — أسوأُ من غياب البحث.
 *   ③ **بحثٌ يُرشّح الإحصاءات**: لو جرى البحثُ على القائمتين اللتين تُغذّيان
 *      `myOrders` لتبدّلت أرقامُ `SellerAnalytics` وعدّادا اللوحة لمجرّد أن
 *      التاجر يكتب في مربّع بحث.
 *
 * 🪤 وفراغُ البحث ليس فراغَ الحساب: «لا توجد طلبات» أثناء بحثٍ لم يطابق كذبةٌ
 *    صغيرة تُرسل التاجرَ يبحث عن طلبٍ يظنّه ضائعاً.
 */
const fs = require('fs');
const path = require('path');
const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '');

let pass = 0, fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? '  ✓' : '  ✗'} ${n}`); if (!ok && d) console.log('      ' + d); ok ? pass++ : fail++; };

console.log('\nالبحثُ في الطلبات');

const input = strip(R('src/components/OrderSearchInput.tsx'));
const toolbar = strip(R('src/components/seller/OrdersToolbar.tsx'));
const seller = strip(R('src/pages/SellerDashboard.tsx'));
const buyer = strip(R('src/pages/Bookings.tsx'));
const mig = strip(R('supabase/JEDDAH_v16_28_order_search.sql'));

// ── ① الوعدُ ومحرّكُه ─────────────────────────────────────────────────────
// النصُّ المعروض يَعِد بأربعة حقول؛ ولكلٍّ منها فرعٌ يجب أن يوجد فعلاً.
const promisesInvoice = /الفاتورة/.test(input) && /invoice/i.test(input);
check('الحقلُ يَعِد بالبحث في رقم الفاتورة (عربي/إنجليزي)', promisesInvoice,
    'إن سقط الوعدُ فلا معنى للحارس — أو أن الميزةَ تراجعت بصمت');
check('وفرعُ الفاتورة موجودٌ في هجرة القاعدة',
    /order_invoices oi/.test(mig) && /oi\.barcode = b\.barcode/.test(mig),
    'وعدٌ بلا محرّك: الحقلُ يقول «أو الفاتورة» والقاعدةُ لا تبحث فيها');
check('ويُطابَق بلا فواصل (TK-000054 ⇔ TK000054)',
    /replace\(public\.taki_norm\(oi\.invoice_no\), '' '', ''''\)/.test(mig),
    "taki_norm('TK-000054') تُخرج 'tk 000054'، والناسُ يكتبونها بلا شرطة");
check('والفروعُ الثلاثة الأخرى باقية (الطلب/الجوّال · المنتج)',
    /b\.search_norm LIKE/.test(mig) && /dd\.name_norm LIKE/.test(mig),
    'إضافةُ فرعٍ لا تُسقط فرعاً — رقمُ الطلب والجوّال في search_norm');

// ── ② البحثُ على الخادم، وفي التبويب المعروض ──────────────────────────────
check('لوحةُ التاجر تبحث عبر `useBookingBrowse` بمعامل `query`',
    /useBookingBrowse\(\s*\{\s*scope: 'seller', state: ordersFilter === 'active' \? 'active' : 'past', query: orderQuery \}/.test(seller),
    'بحثٌ محلّيٌّ يبحث في الصفحة المُحمَّلة وحدها فيقول «لا نتائج» عن طلبٍ موجود');
check('وقائمةُ البحث مربوطةٌ بالتبويب المعروض',
    /state: ordersFilter === 'active' \? 'active' : 'past'/.test(seller),
    "بحثٌ مثبَّتٌ على 'active' يجعل البحثَ في «السجل» يعرض نتائجَ النشطة");
check('ولا نداءَ ما دام الحقلُ فارغاً (`enabled`)',
    /\{ enabled: searchingOrders \}/.test(seller),
    'نداءٌ دائمٌ يضيف طلباً لكلّ فتحةِ لوحةٍ بلا أن يبحث أحد');
check('صفحةُ المشتري تمرّر البحثَ للقائمتين معاً',
    (buyer.match(/scope: 'buyer', state: '(active|past)', query: searchTerm/g) || []).length === 2,
    'بحثٌ في قائمةٍ دون أختها يُخفي نصفَ النتائج بلا أيّ أثر');

// ── ③ الإحصاءاتُ لا تُرشَّح ───────────────────────────────────────────────
check('`myOrders` يبقى على القائمتين غيرِ المُرشَّحتين',
    /const myOrders = activeOrders\.concat\(pastOrders\);/.test(seller),
    'ربطُه بقائمة البحث يُبدّل أرقامَ التحليلات والعدّادات أثناء الكتابة');
check('ونتائجُ البحث لا تدخل `SellerAnalytics`',
    /<SellerAnalytics myDeals=\{myDeals\} myOrders=\{myOrders\}/.test(seller),
    'تمريرُ القائمة المعروضة يجعل التحليلاتِ تتبع مربّعَ البحث');

// ── ④ فراغُ البحث ليس فراغَ الحساب ────────────────────────────────────────
check('لوحةُ التاجر تستعمل نصَّ الفراغ المدرِكَ للبحث',
    /emptyOrdersText\(/.test(seller) && /emptyOrdersLabel\(/.test(seller),
    '«لا توجد طلبات» أثناء بحثٍ لم يطابق تُرسل التاجرَ خلف طلبٍ يظنّه ضائعاً');
check('وصفحةُ المشتري كذلك',
    /emptyOrdersLabel\(!!searchTerm\.trim\(\)/.test(buyer),
    'نفسُ الكذبة في الشاشة الثانية');

// ── ⑤ نصٌّ واحدٌ لا نسختان · ومعدودٌ عربيٌّ صحيح ──────────────────────────
check('الشاشتان تستوردان الحقلَ المشترَك',
    /from '\.\.\/components\/OrderSearchInput'/.test(buyer) && /OrdersToolbar/.test(seller),
    'نسختان من نصّ الوعد تنحرفان عند أوّل تعديل');
check('ولا حقلَ بحثٍ خامّ بقي في صفحة المشتري',
    !/<input[^>]*placeholder=\{isRTL \? 'ابحث/.test(buyer),
    'حقلٌ ثانٍ بنصّه الخاصّ يَعِد بغير ما يفعله المحرّك');
check('وعددُ النتائج يُصاغ بمحرّك الجمع لا باليد',
    /arCount\(resultCount, RESULTS\)/.test(toolbar) && !/\$\{resultCount\} نتيجة/.test(toolbar),
    '«٣ نتيجة» خطأٌ عربيّ — المحرّكُ `arPlural` هو المكان الوحيد');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail === 0 ? 0 : 1);
