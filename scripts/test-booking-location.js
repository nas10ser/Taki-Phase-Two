#!/usr/bin/env node
/**
 * «هل أنت في منطقة هذا العرض؟» — اختبارٌ **تنفيذيّ** على قرار ما قبل الحجز.
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 أمرُ ناصر (٢٠ نوفمبر ٢٠٢٦): «قبل الحجز تأكّد من أن اللوكيشن يعمل، فقد
 *    يحجز في منطقةٍ غير منطقته — أو اجعله يحطّ المدينة التي هو فيها».
 *
 * 🔴 **والخطرُ معكوسُ المعتاد**: الأسوأُ ليس «لم يُنذِر» بل «أنذر بلا سبب».
 *    تأكيدٌ يظهر لمشترٍ واقفٍ أمام المتجر يُدرّبه على الضغط «نعم» بلا قراءة
 *    — فلا ينفع يوم يكون الإنذارُ صحيحاً. ولذلك تُثبَّت أوّلاً **كلُّ حالةٍ
 *    يجب أن تمرّ بلا سؤال**.
 *
 * 🔴 ولا يُمنع الحجزُ في أيّ حال: مسافرٌ، أو يشتري لأهله، أو يحجز اليوم
 *    ليستلم غداً حين يصل — كلُّها مشروعة. فالمخرجُ تأكيدٌ لا منع.
 */
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'node_modules', '.cache-booking-location');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log('      ' + detail);
    ok ? pass++ : fail++;
};

console.log('\nقرارُ الموقع قبل الحجز');

fs.rmSync(out, { recursive: true, force: true });
let computeBookingLocation, kmBetween, DEFAULT_MAX_KM;
try {
    cp.execFileSync('npx', ['tsc', path.join(root, 'src/utils/bookingLocationRule.ts'),
        '--outDir', out, '--rootDir', root, '--module', 'commonjs', '--target', 'es2020',
        '--skipLibCheck', '--esModuleInterop'],
    { cwd: root, stdio: 'pipe' });
    ({ computeBookingLocation, kmBetween, DEFAULT_MAX_KM } =
        require(path.join(out, 'src/utils/bookingLocationRule.js')));
} catch (e) {
    check('ترجمةُ `bookingLocationRule.ts`', false, String(e.stdout || e.message).slice(0, 500));
    console.log(`\n❌ قرارُ الموقع: ${pass} ناجحاً · ${fail} فاشلاً`);
    process.exit(1);
}

// إحداثيّاتٌ حقيقيّة
const RIYADH = [24.7136, 46.6753];
const DAMMAM = [26.4207, 50.0888];
const KHOBAR = [26.2794, 50.2083];          // ملاصقةٌ للدمام (~٢٠ كم)
const JEDDAH = [21.4858, 39.1925];

const C = (o) => computeBookingLocation(o);

// ── ① ما يجب أن يمرّ **بلا سؤال** — وهذه أخطرُ الحالات ──────────────────
check('التوصيلُ لا يُسأل عنه إطلاقاً (العنوانُ هو الحَكَم)',
    C({ fulfillment: 'delivery', buyerLat: RIYADH[0], buyerLng: RIYADH[1],
        dealLat: JEDDAH[0], dealLng: JEDDAH[1] }).action === 'ok');
check('واقفٌ عند المتجر ⇒ لا سؤال',
    C({ fulfillment: 'pickup', buyerLat: DAMMAM[0], buyerLng: DAMMAM[1],
        dealLat: DAMMAM[0], dealLng: DAMMAM[1] }).action === 'ok');
{
    const r = C({ fulfillment: 'pickup', buyerLat: KHOBAR[0], buyerLng: KHOBAR[1],
                  dealLat: DAMMAM[0], dealLng: DAMMAM[1] });
    check(`الخبر ⇄ الدمام (${r.km.toFixed(0)} كم) ⇒ لا سؤال — مدينتان متلاصقتان`,
        r.action === 'ok', JSON.stringify(r));
}
check('ونفسُ المدينة بلا إحداثيّات ⇒ لا سؤال',
    C({ fulfillment: 'pickup', buyerCityId: 'dammam', dealCityId: 'dammam' }).action === 'ok');
// 🪤 لا نعرف أين هو **ولا أين المتجر** ⇒ سؤالٌ لا يُفيد، فلا يُسأل.
check('مجهولان معاً ⇒ لا سؤال (السؤالُ لن يُمكّن المقارنةَ أصلاً)',
    C({ fulfillment: 'pickup' }).action === 'ok');

// ── ② ما يجب أن يُسأل عنه ───────────────────────────────────────────────
{
    const r = C({ fulfillment: 'pickup', buyerLat: RIYADH[0], buyerLng: RIYADH[1],
                  dealLat: DAMMAM[0], dealLng: DAMMAM[1] });
    check(`الرياض ⇄ الدمام (${r.km.toFixed(0)} كم) ⇒ تأكيد`,
        r.action === 'confirm-far' && r.basis === 'distance', JSON.stringify(r));
}
{
    const r = C({ fulfillment: 'pickup', buyerLat: RIYADH[0], buyerLng: RIYADH[1],
                  dealLat: JEDDAH[0], dealLng: JEDDAH[1] });
    check(`الرياض ⇄ جدة (${r.km.toFixed(0)} كم) ⇒ تأكيد`, r.action === 'confirm-far');
}
check('ومدينتان مختلفتان بلا إحداثيّات ⇒ تأكيد',
    C({ fulfillment: 'pickup', buyerCityId: 'riyadh_city', dealCityId: 'dammam' }).action === 'confirm-far');

// ── ③ «اللوكيشن لا يعمل» — نصُّ أمر ناصر ────────────────────────────────
check('لا GPS ولا مدينةٌ للمشتري + للمتجر مدينة ⇒ يُطلب تحديدُ الموقع',
    C({ fulfillment: 'pickup', dealCityId: 'dammam' }).action === 'ask-location');
check('ولا GPS ولا مدينة + للمتجر إحداثيّات ⇒ يُطلب تحديدُ الموقع',
    C({ fulfillment: 'pickup', dealLat: DAMMAM[0], dealLng: DAMMAM[1] }).action === 'ask-location');
check('ومدينةُ المشتري وحدها بلا مدينة المتجر ⇒ لا سؤال',
    C({ fulfillment: 'pickup', buyerCityId: 'riyadh_city' }).action === 'ok');

// ── ④ المسافةُ تسبق المدينة متى توفّرت ──────────────────────────────────
{
    // 🪤 مدينتان مختلفتان اسماً لكنّ الجهازَ عند المتجر: الإحداثيّاتُ تحكم.
    const r = C({ fulfillment: 'pickup', buyerCityId: 'riyadh_city', dealCityId: 'dammam',
                  buyerLat: DAMMAM[0], buyerLng: DAMMAM[1], dealLat: DAMMAM[0], dealLng: DAMMAM[1] });
    check('إحداثيّاتٌ متطابقة تتقدّم على اسمَي مدينتين مختلفين',
        r.action === 'ok' && r.basis === 'distance', JSON.stringify(r));
}

// ── ⑤ الحدُّ نفسُه ───────────────────────────────────────────────────────
{
    const just = C({ fulfillment: 'pickup', buyerLat: 24.0, buyerLng: 46.6753,
                     dealLat: 24.0, dealLng: 46.6753, maxKm: 10 });
    check('مسافةُ صفرٍ بحدّ ١٠ ⇒ لا سؤال', just.action === 'ok');
    const over = C({ fulfillment: 'pickup', buyerLat: 24.0, buyerLng: 46.6753,
                     dealLat: 24.2, dealLng: 46.6753, maxKm: 10 });
    check(`و٢٢ كم بحدّ ١٠ ⇒ تأكيد (${over.km.toFixed(0)} كم)`, over.action === 'confirm-far');
}
check(`الحدُّ الافتراضيّ ${DEFAULT_MAX_KM} كم`, DEFAULT_MAX_KM === 60);

// ── ⑥ قيمٌ فاسدة لا تُنتج إنذاراً كاذباً ────────────────────────────────
for (const [label, o] of [
    ['إحداثيّاتٌ نصّيّةٌ فاسدة', { fulfillment: 'pickup', buyerLat: 'س', buyerLng: 'ص', dealCityId: 'dammam', buyerCityId: 'dammam' }],
    ['NaN', { fulfillment: 'pickup', buyerLat: NaN, buyerLng: NaN, buyerCityId: 'dammam', dealCityId: 'dammam' }],
    ['null صريح', { fulfillment: 'pickup', buyerLat: null, buyerLng: null, buyerCityId: 'dammam', dealCityId: 'dammam' }],
]) check(`${label} ⇒ يرتدّ إلى المدينة ولا يُنذر`, C(o).action === 'ok', JSON.stringify(C(o)));

// ── ⑦ الهافرساين نفسُه ──────────────────────────────────────────────────
check('الرياض ⇄ جدة ≈ ٨٤٠ كم',
    Math.abs(kmBetween(...RIYADH, ...JEDDAH) - 840) < 40,
    String(kmBetween(...RIYADH, ...JEDDAH)));
check('ونقطةٌ مع نفسها = صفر', kmBetween(...RIYADH, ...RIYADH) === 0);

console.log(`\n${fail ? '❌' : '✅'} قرارُ الموقع قبل الحجز: ${pass} ناجحاً · ${fail} فاشلاً`);
process.exit(fail ? 1 : 0);
