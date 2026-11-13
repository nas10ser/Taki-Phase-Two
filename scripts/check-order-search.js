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

// ── ⑥ بقيّةُ شاشات السجلّات (v16.29) ─────────────────────────────────────
const mig29 = strip(R('supabase/JEDDAH_v16_29_admin_record_search.sql'));
const inv = strip(R('src/pages/admin/AdminInvoices.tsx'));
const ops = strip(R('src/pages/admin/AdminOperations.tsx'));
const dlv = strip(R('src/pages/admin/AdminDelivery.tsx'));

check('قاعدةُ المطابقة في دالّةٍ واحدة (`taki_search_key`)',
    /CREATE OR REPLACE FUNCTION public\.taki_search_key/.test(mig29),
    'نسخُ القاعدة في كلّ دالّة يضمن انحرافَها عند أوّل تعديل');
for (const [name, fn] of [
    ['المدفوعات', 'admin_payment_log'],
    ['إدارة العمليات', 'admin_operations_log'],
    ['التوصيل', 'admin_delivery_orders'],
]) {
    // 🪤 ويُقصّ الجسمُ عند **الدالّة التالية** لا بعددٍ ثابتٍ من المحارف:
    //    نافذةُ ٦٠٠٠ محرفٍ كانت تبتلع الدالّةَ التي تليها، فمرّت كسرةٌ
    //    حقيقيّة (حُذف فرعُ الفاتورة من «المدفوعات» ووجده الحارسُ في جارتها).
    const i = mig29.indexOf(`FUNCTION public.${fn}`);
    const nx = i > 0 ? mig29.indexOf('FUNCTION public.', i + 20) : -1;
    const body = i > 0 ? mig29.slice(i, nx > 0 ? nx : undefined) : '';
    check(`${name}: فرعُ الفاتورة في الدالّة`,
        /order_invoices oi/.test(body) && /taki_search_key\(oi\.invoice_no\)/.test(body),
        'الشاشةُ تَعِد بالبحث في الفاتورة والدالّةُ لا تبحث فيها');
}
// 🪤 والوعدُ يُقاس في **نصّ الحقل** لا في الملفّ كلِّه: جملةُ الفراغ تذكر
//    «الفاتورة» أيضاً، فنزعُها من الـplaceholder كان يمرّ بلا أن يسقط شيء.
const promises = (src) => /placeholder=\{?"[^"]*الفاتورة[^"]*"/.test(src);
check('وحقولُ الإدارة الثلاثة تَعِد بالفاتورة',
    promises(inv) && promises(ops) && promises(dlv),
    'وعدٌ ناقصٌ في نصّ الحقل يُخفي ميزةً مبنيّة عن من يحتاجها');
check('التوصيل يمرّر البحثَ إلى الخادم',
    /p_q: q \|\| null/.test(dlv),
    'ترشيحٌ في المتصفّح يبحث في المعروض وحده ويقول «لا نتائج» عن طلبٍ موجود');
check('ونصُّ البحث ضمن اعتماد إعادة الجلب',
    /\}, \[status, shown, q\]\);/.test(dlv),
    'بلا `q` في الاعتماد لا يُعاد الجلبُ أبداً — حقلُ بحثٍ ميّتٌ بلا أيّ خطأ');
check('وفراغُ البحث في التوصيل لا يقول «لا طلبات»',
    /q \? 'لا طلب يطابق بحثك'/.test(dlv),
    'نفسُ الكذبة في الشاشة الثالثة');
check('والهجرةُ تُعيد صلاحيّاتِ دالّة التوصيل بعد DROP',
    /REVOKE ALL ON FUNCTION public\.admin_delivery_orders[\s\S]{0,200}FROM anon;/.test(mig29)
    && /GRANT EXECUTE ON FUNCTION public\.admin_delivery_orders[\s\S]{0,120}authenticated/.test(mig29),
    'الدالّةُ الجديدة تُولد ممنوحةً لـanon في هذا المشروع — الـREVOKE هو ما يسدّها');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail === 0 ? 0 : 1);
