#!/usr/bin/env node
/**
 * موضعُ ملاحظة المشتري في الفاتورة — اختبارٌ **تنفيذيّ** على المخرَج نفسِه.
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 بلاغُ ناصر (٢٠ نوفمبر ٢٠٢٦، بسهمٍ أحمر على لقطتين): «ملاحظة المشتري
 *    المفروض تكون **تحت الخيار بالضبط** في الفاتورة لكي يراها التاجر،
 *    وليس تحت».
 *
 *    وكانت تُطبع بعد كتلة الدفع وقبل خانة التوقيع — أي في **ذيل الورقة**،
 *    بعيدةً عن الصنف الذي تصفه. والتاجرُ يقرأ الصنفَ وخياراته ثمّ يُجهّز
 *    الطلب، فملاحظةٌ تحت التوقيع تُقرأ **بعد** أن يكون قد جهّزه — أي بعد
 *    فوات أوانها. وهذا عيبُ تشغيلٍ لا تنسيق: «سوف اتي قريبا» تُقرأ متأخّرة.
 *
 * 🪤 ولا يُقاس هذا بقراءة المصدر: ترتيبُ السطور في الملفّ ليس ترتيبَ المخرَج
 *    بالضرورة (قوالبُ متداخلة ودوالُّ تُستدعى). فيُبنى HTML فعلاً وتُقارن
 *    **مواضعُ** الكتل فيه.
 * 🪤 و`printInvoice.ts` يستورد عميلَ سوبابيس، وهو يرمي في Node بلا متغيّرات
 *    بيئة — فتُضبط قيمٌ وهميّةٌ هنا. ولا شبكةَ في هذا الاختبار إطلاقاً:
 *    `buildHtml` تبني نصّاً وحسب.
 */
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'node_modules', '.cache-invoice-note');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log('      ' + detail);
    ok ? pass++ : fail++;
};

console.log('\nموضعُ ملاحظة المشتري في الفاتورة');

fs.rmSync(out, { recursive: true, force: true });
let buildHtml;
try {
    cp.execFileSync('npx', ['tsc',
        path.join(root, 'src/utils/printInvoice.ts'),
        '--outDir', out, '--rootDir', root, '--module', 'commonjs', '--target', 'es2020',
        '--skipLibCheck', '--esModuleInterop', '--resolveJsonModule'],
    { cwd: root, stdio: 'pipe' });
    fs.cpSync(path.join(root, 'shared'), path.join(out, 'shared'), { recursive: true });
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
    process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
    ({ buildHtml } = require(path.join(out, 'src/utils/printInvoice.js')));
} catch (e) {
    check('ترجمةُ `printInvoice.ts`', false, String(e.stdout || e.message).slice(0, 600));
    console.log(`\n❌ موضعُ الملاحظة: ${pass} ناجحاً · ${fail} فاشلاً`);
    process.exit(1);
}

// طلبٌ يشبه لقطةَ ناصر: صنفٌ بخيار، ملاحظةُ مشترٍ، دفعٌ عند الاستلام.
// 🪤 الحقولُ بأسمائها الحقيقيّة من `InvoiceData` — لا مخترعةً. وأوّلُ نسخةٍ
//    من هذا الاختبار استعملت `lineItems`/`total`/`unitPrice` فلم يُطبع سطرُ
//    الإجمالي ولا الخيارات إطلاقاً، ومرّت فحوصُ الترتيب على مخرَجٍ ناقص.
//    (اختبارٌ يقيس ما لم يُبنَ لا يقيس شيئاً.)
const DATA = {
    isRTL: true,
    shopName: 'تاكي',
    barcode: '9395449333',
    itemName: 'قهوة اليوم',
    quantity: 1,
    unitPrice: 11,
    buyerName: 'Nass',
    buyerPhone: '0591173715',
    fulfillment: 'pickup',
    paymentMethod: 'cod',
    paidOnline: false,
    prepTime: 30,
    totalText: '15.00 ر.س',
    totalAmount: 15,
    buyerNote: 'سوف اتي قريبا',
    items: [
        { label: 'كبير', qty: 1, kind: 'main' },
        { label: 'نوع الكوب: كوب ورقي', qty: 1, kind: 'addon' },
    ],
};

let html;
try { html = buildHtml(DATA); }
catch (e) {
    check('بناءُ الفاتورة لا يرمي', false, String(e && e.message));
    console.log(`\n❌ موضعُ الملاحظة: ${pass} ناجحاً · ${fail} فاشلاً`);
    process.exit(1);
}

// 🪤 تُقاس المواضعُ في **الجسم** وحده: القياسُ على الملفّ كلّه يمسك
//    `buyer-note` داخل `<style>` — أي قاعدةَ تنسيقٍ لا كتلةً مطبوعة.
const body  = html.slice(html.indexOf('<body>'));
const iItems = body.indexOf('class="items"');
const iNote  = body.indexOf('ملاحظة المشتري');
const iTotal = body.indexOf('الإجمالي');
const iPay   = body.indexOf('الدفع عند الاستلام');
const iStamp = body.indexOf('توقيع/ختم التاجر');

check('الملاحظةُ مطبوعةٌ أصلاً', iNote !== -1, 'لم تظهر في المخرَج');
check('وكتلةُ الأصناف موجودة', iItems !== -1);
check('والخياراتُ مطبوعةٌ فعلاً (وإلّا قِيس الترتيبُ على ورقةٍ ناقصة)',
    body.includes('كبير') && body.includes('كوب ورقي'),
    'لم تُطبع الخيارات — راجِع أسماء الحقول');
check('والإجمالي موجود', iTotal !== -1);

// 🔴 جوهرُ البلاغ: **بعد** الأصناف و**قبل** الإجمالي.
check('الملاحظة **بعد** الأصناف (تحت الخيار)', iNote > iItems,
    `الأصناف عند ${iItems} والملاحظة عند ${iNote}`);
check('والملاحظة **قبل** الإجمالي', iNote < iTotal,
    `الملاحظة عند ${iNote} والإجمالي عند ${iTotal}`);
check('وقبل كتلة الدفع', iPay === -1 || iNote < iPay,
    `الملاحظة عند ${iNote} والدفع عند ${iPay}`);
check('وقبل خانة التوقيع (لا في ذيل الورقة)', iStamp === -1 || iNote < iStamp,
    `الملاحظة عند ${iNote} والتوقيع عند ${iStamp}`);

// ولها تمييزٌ بصريّ: ملاحظةٌ بلون الورق تُقرأ كأنها سطرُ تفاصيل.
check('ولها تمييزٌ بصريّ (`buyer-note`)', body.includes('buyer-note'),
    'بلا تمييزٍ تذوب بين سطور الفاتورة');

// وطلبٌ بلا ملاحظة لا يطبع كتلةً فارغة.
const noNote = buildHtml({ ...DATA, buyerNote: '' });
const noNoteBody = noNote.slice(noNote.indexOf('<body>'));
check('وبلا ملاحظةٍ لا تُطبع كتلةٌ فارغة', !noNoteBody.includes('ملاحظة المشتري'));

console.log(`\n${fail ? '❌' : '✅'} موضعُ ملاحظة المشتري: ${pass} ناجحاً · ${fail} فاشلاً`);
process.exit(fail ? 1 : 0);
