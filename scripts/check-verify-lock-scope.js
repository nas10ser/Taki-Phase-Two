#!/usr/bin/env node
/**
 * نطاقُ قفل التوثيق — **ما الذي يُرمَّد فعلاً** قبل توثيق المتجر.
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 العيبُ الذي يحرسه، وقد وقع فعلاً (بلاغُ ناصر ١٩ نوفمبر ٢٠٢٦):
 *    «عند إلزامية التوثيق ممتاز، جميعها تحوّلت للرمادي **ما عدا إدارة
 *     التوصيل بالأسفل** لا زال كما هو».
 *    والسببُ أن `DeliveryCard` تُركَّب في كتلةٍ مستقلّةٍ آخر التبويب (موضعُها
 *    هناك منذ v14.08 عمداً) — فلم يشملها الغلافُ حين لُفّت بقيّةُ البطاقات.
 *    أي أن القفلَ كان **ناقصاً بصمت**: لا خطأ، ولا شيء يصرخ، وبطاقةٌ واحدةٌ
 *    تبقى عاملةً بينما أخواتُها رمادية.
 *
 * ⇒ فالحارسُ يقرأ **نطاقَ الغلاف فعلاً** (بموازنة الوسوم) لا بمجرّد وجود
 *   الاسم في الملفّ: كلُّ مرساةٍ مطلوبةٍ يجب أن تقع **داخل** `<VerifyLock>`.
 *
 * 🪤 و`setup-pay` يجب أن يبقى **خارجَه**: إقرارُ طريقة الحساب أوّلُ ما يُسأل
 *    عنه التاجر، وبلا جوابه ترفض القاعدةُ كلَّ حجزٍ على المتجر أصلاً —
 *    وناصرٌ بدأ قائمةَ الترميد من «ساعات العمل» لا من قبلها. فلو رُمِّد
 *    لصار التاجرُ محبوساً: لا يُقرّ، ولا يُوثَّق، ولا يبيع.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(root, f), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log('      ' + detail);
    ok ? pass++ : fail++;
};

console.log('\nنطاقُ قفل التوثيق — ما الذي يُرمَّد قبل التوثيق');

/**
 * يُرجع نصَّ كلّ كتلة `<VerifyLock …> … </VerifyLock>` في الملفّ، بموازنةِ
 * الوسوم لا بأوّل إغلاقٍ يصادفه (الكتلُ قد تتداخل مستقبلاً).
 * 🪤 ويتجاهل `<VerifyLock ... />` ذاتيَّ الإغلاق: لا محتوى له فلا نطاق.
 */
const lockedRegions = (src) => {
    const out = [];
    const open = /<VerifyLock(\s|>)/g;
    let m;
    while ((m = open.exec(src)) !== null) {
        // نهايةُ وسم الفتح
        let i = src.indexOf('>', m.index);
        if (i === -1) continue;
        if (src[i - 1] === '/') continue;            // ذاتيُّ الإغلاق
        let depth = 1, j = i + 1;
        while (j < src.length && depth > 0) {
            const nextOpen = src.indexOf('<VerifyLock', j);
            const nextClose = src.indexOf('</VerifyLock>', j);
            if (nextClose === -1) break;
            if (nextOpen !== -1 && nextOpen < nextClose) { depth++; j = nextOpen + 11; }
            else { depth--; j = nextClose + 13; }
        }
        if (depth === 0) out.push(src.slice(i + 1, j - 13));
    }
    return out;
};

const dash = R('src/pages/SellerDashboard.tsx');
const cards = R('src/components/seller/SellerSetupCards.tsx');
const regions = [...lockedRegions(dash), ...lockedRegions(cards)];
const insideLock = regions.join('\n');

check('توجد كتلُ قفلٍ فعلاً (لا اسمٌ بلا نطاق)', regions.length >= 3,
    `وُجد ${regions.length} كتلةً — المتوقَّع ٣ على الأقل (البطاقات · النموذج · التوصيل)`);

// ── ما يجب أن يُرمَّد — وقائمتُه هي أمرُ ناصر حرفاً ───────────────────────
const MUST_LOCK = [
    ['ساعات العمل',        /id="setup-hours"/],
    ['سياسة الاسترداد',    /id="setup-refund"/],
    ['الوضع الضريبي',      /id="setup-vat"/],
    ['بوّابة الدفع',        /<GatewayCard[\s/>]/],
    ['ربط المخزون',        /<StockLinkCard[\s/>]/],
    ['رابط الدعوة',        /<ReferralCard[\s/>]/],
    ['نموذج العرض',        /id="setup-dealform"/],
    ['إدارة التوصيل',      /<DeliveryCard[\s/>]/],   // ← البلاغُ الذي وُلد له هذا الحارس
];
for (const [label, re] of MUST_LOCK) {
    check(`«${label}» داخل القفل`, re.test(insideLock),
        'غيرُ مشمولٍ بالغلاف — سيبقى عاملاً بينما أخواتُه رمادية');
}

// ── وما يجب أن يبقى مفتوحاً ──────────────────────────────────────────────
check('«إقرار طريقة الحساب» **خارج** القفل',
    !/id="setup-pay"/.test(insideLock),
    'رُمِّد الإقرار — فيُحبس التاجر: لا يُقرّ ولا يُوثَّق ولا يبيع');

// ── والقفلُ يُقرأ من المصدر الواحد لا يُعاد حسابه في الشاشة ───────────────
check('اللوحةُ تقرأ القفل من `useVerifyLock`', /useVerifyLock\(\)/.test(dash));
check('ولا تحسبه بنفسها', !/mode === 'required'/.test(dash),
    'الشاشةُ تُعيد حساب شرط القفل — مصدرٌ ثانٍ ينحرف عن `verifyLockRule`');

console.log(`\n${fail ? '❌' : '✅'} نطاقُ قفل التوثيق: ${pass} ناجحاً · ${fail} فاشلاً`);
process.exit(fail ? 1 : 0);
