// اختبار قرار عرض التوصيل في البوتين (v14.06) — كل فرع بحالته وحالاته الحديّة.
// التشغيل:  node scripts/test-delivery-logic.js
// المعيار: ما يعرضه البوت = ما سيقبله حارس القاعدة. أي انحراف = وعدٌ يُخلَف.
const { deliveryOffer, forcedPayment } = require('../server/lib/delivery.js');

let pass = 0, fail = 0;
const check = (name, got, want) => {
    const ok = Object.entries(want).every(([k, v]) => JSON.stringify(got[k]) === JSON.stringify(v));
    console.log(`${ok ? '✅' : '❌'} ${name}`);
    if (!ok) {
        for (const [k, v] of Object.entries(want)) {
            if (JSON.stringify(got[k]) !== JSON.stringify(v)) console.log(`     ${k}: توقّعنا ${JSON.stringify(v)} فجاء ${JSON.stringify(got[k])}`);
        }
    }
    ok ? pass++ : fail++;
};

// ── لا يُسأل المستخدم إطلاقاً (المسار القديم يبقى كما كان) ──────────────────
check('متجر لا يوصّل', deliveryOffer({ ok: true, enabled: false }, 100), { ask: false, canDeliver: false, reason: 'off' });
check('الدالة أعادت خطأ (not_linked)', deliveryOffer({ ok: false, error: 'not_linked' }, 100), { ask: false, canDeliver: false });
check('انقطاع الشبكة (null)', deliveryOffer(null, 100), { ask: false, canDeliver: false });
check('ناتج مشوّه (بلا ok)', deliveryOffer({ enabled: true, available: true }, 100), { ask: false });
check('متجر يوصّل بلا نطاقات (no_zones)', deliveryOffer({ ok: true, enabled: true, available: false, has_address: true, reason: 'no_zones' }, 100), { ask: true, canDeliver: false, reason: 'out_of_zone' });

// ── يُسأل ولا يستطيع (السبب يُقال للمستخدم) ─────────────────────────────────
check('لا عنوان محفوظ', deliveryOffer({ ok: true, enabled: true, has_address: false, available: false, reason: 'no_location', min_order: 0 }, 100),
    { ask: true, canDeliver: false, reason: 'no_address' });
check('عنوان خارج النطاق', deliveryOffer({ ok: true, enabled: true, has_address: true, available: false, reason: 'out_of_zone' }, 100),
    { ask: true, canDeliver: false, reason: 'out_of_zone' });
check('تحت الحد الأدنى', deliveryOffer({ ok: true, enabled: true, has_address: true, available: true, min_order: 100, fee: 7.5 }, 22),
    { ask: true, canDeliver: false, reason: 'min_order', minOrder: 100 });
check('على الحد الأدنى بالضبط ⇒ مسموح', deliveryOffer({ ok: true, enabled: true, has_address: true, available: true, min_order: 100, fee: 7.5 }, 100),
    { ask: true, canDeliver: true, reason: null });

// ── متاح: الرسوم وطريقة الدفع والمدة ───────────────────────────────────────
check('متاح برسوم', deliveryOffer({ ok: true, enabled: true, has_address: true, available: true, fee: 7.5, min_order: 0, payment: 'cod', eta_min: 45, zone_name: 'حول المتجر', label: 'المنزل' }, 50),
    { ask: true, canDeliver: true, fee: 7.5, payment: 'cod', eta: 45, zoneName: 'حول المتجر', label: 'المنزل' });
check('متاح مجاناً (رسوم صفر)', deliveryOffer({ ok: true, enabled: true, has_address: true, available: true, fee: 0, min_order: 0, payment: 'both' }, 50),
    { canDeliver: true, fee: 0, payment: 'both' });
check('بطاقة فقط', deliveryOffer({ ok: true, enabled: true, has_address: true, available: true, payment: 'card', fee: 10 }, 50),
    { canDeliver: true, payment: 'card' });
check('طريقة دفع مجهولة ⇒ تُعامَل نقداً (فشل مغلق)', deliveryOffer({ ok: true, enabled: true, has_address: true, available: true, payment: 'bitcoin' }, 50),
    { canDeliver: true, payment: 'cod' });
check('رسوم نصّية من jsonb', deliveryOffer({ ok: true, enabled: true, has_address: true, available: true, fee: '12.50', min_order: '0' }, 50),
    { canDeliver: true, fee: 12.5 });
check('رسوم فاسدة ⇒ صفر لا NaN', deliveryOffer({ ok: true, enabled: true, has_address: true, available: true, fee: 'abc' }, 50),
    { canDeliver: true, fee: 0 });
check('eta غائب ⇒ null (لا يُطبع سطر مدة)', deliveryOffer({ ok: true, enabled: true, has_address: true, available: true }, 50),
    { canDeliver: true, eta: null });
check('zone_name غائب ⇒ نصّ فارغ لا undefined', deliveryOffer({ ok: true, enabled: true, has_address: true, available: true }, 50),
    { canDeliver: true, zoneName: '' });
check('goods غير رقمي ⇒ لا يتجاوز الحد الأدنى', deliveryOffer({ ok: true, enabled: true, has_address: true, available: true, min_order: 100 }, NaN),
    { canDeliver: false, reason: 'min_order' });

// ── اقتران الدفع ───────────────────────────────────────────────────────────
console.log(`${forcedPayment('card') === 'online' ? '✅' : '❌'} بطاقة فقط ⇒ الدفع إلكتروني إلزاماً`);
forcedPayment('card') === 'online' ? pass++ : fail++;
console.log(`${forcedPayment('cod') === 'cod' ? '✅' : '❌'} عند الاستلام فقط ⇒ نقداً`);
forcedPayment('cod') === 'cod' ? pass++ : fail++;
console.log(`${forcedPayment('both') === null ? '✅' : '❌'} الاثنان ⇒ الاختيار للمشتري`);
forcedPayment('both') === null ? pass++ : fail++;

console.log(`\nنتيجة: ${pass} ناجح · ${fail} فاشل`);
process.exit(fail ? 1 : 0);
