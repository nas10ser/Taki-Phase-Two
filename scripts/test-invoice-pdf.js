// اختبار إجهاد لمولّد فاتورة البوت (v14.06): حالات حديّة تقع فعلاً في الإنتاج.
// التشغيل:  node scripts/test-invoice-pdf.js
// (طلب ضخم بعشرات الخيارات · كلمة بلا فواصل · حقول فارغة · أرقام هائلة · نصوص خبيثة).
// المعيار: لا استثناء، ولا صفحة تتجاوز سقف مواصفة PDF (14400pt)، والعرض ثابت.
const fs = require('fs');
const B = require('../server/lib/invoicePdf.js');
const OUT = require('os').tmpdir();   // نماذج للمعاينة — خارج المستودع

const base = {
  ok: true, role: 'seller', barcode: 'STRESS01', backup_code: 'BK1', status: 'pending',
  item_name: 'صنف', shop_name: 'متجر', quantity: 1, unit_price: 10, total: 10,
  total_source: 'order', paid: false, payment_method: 'cod', items: [], booked_at: 1788444969627,
  fulfillment: 'pickup',
};

const ESC = String.fromCharCode(27);

const cases = {
  A_120_items_with_skus: {
    ...base, quantity: 120, total: 4200,
    items: Array.from({ length: 120 }, (_, i) => ({
      label: `الخيار رقم ${i + 1} — نوع ${i % 7}`, qty: 1, sku: `SKU-${1000 + i}`, kind: i === 0 ? 'main' : 'addon',
    })),
  },
  B_long_unbroken_word: {
    ...base, item_name: 'ا'.repeat(220),
    items: [{ label: 'ب'.repeat(240), qty: 1, sku: 'X'.repeat(60), kind: 'main' }],
    merchant_note: 'ج'.repeat(400),
  },
  C_all_nulls: {
    ok: true, barcode: 'NULLS001', items: null, quantity: null, total: null,
    shop_name: null, item_name: null, booked_at: null, fulfillment: null, delivery: null,
  },
  D_cancelled: { ...base, status: 'cancelled', cancelled_by: 'expired' },
  E_delivery_no_phone: {
    ...base, fulfillment: 'delivery', delivery_fee: 12, total: 22,
    delivery: { label: 'العمل', lat: 26.1, lng: 50.2 },
  },
  F_vat_registered_paid: {
    ...base, vat_number: '310122393500003', vat_rate: 15, vat_base: 8.7, vat_amount: 1.3,
    paid: true, paid_amount: 10, payment_method: 'online', status: 'completed',
  },
  G_injection_like: {
    ...base, shop_name: '<script>alert(1)</script>', item_name: '"; DROP TABLE bookings; --',
    items: [{ label: '${process.exit(1)}', qty: 1, sku: '(){ :;};', kind: 'main' }],
    merchant_note: `${ESC}[31mred`,
  },
  H_emoji_everywhere: {
    ...base, shop_name: '🍔 مطعم البرجر 🔥', item_name: '🥤 مشروب',
    items: [{ label: '🧊 ثلج إضافي', qty: 2, sku: 'ICE1', kind: 'addon' }],
    merchant_note: '✅ جاهز 🚀', buyer_note: '📝 بدون بصل 🧅',
  },
  I_huge_numbers: {
    ...base, quantity: 999999, unit_price: 1234567.891, total: 98765432.109,
    delivery_fee: 999.99, fulfillment: 'delivery', delivery: { label: 'x', lat: 26, lng: 50 },
  },
  K_600_items: {
    ...base, quantity: 600, total: 60000,
    items: Array.from({ length: 600 }, (_, i) => ({
      label: `خيار ${i + 1}`, qty: 1, sku: `S${i}`, kind: i === 0 ? 'main' : 'addon',
    })),
  },
  L_300_items: {
    ...base, quantity: 300, total: 30000,
    items: Array.from({ length: 300 }, (_, i) => ({
      label: `خيار ${i + 1}`, qty: 1, sku: `S${i}`, kind: i === 0 ? 'main' : 'addon',
    })),
  },
  J_bad_coords: {
    ...base, fulfillment: 'delivery', delivery_fee: 5, total: 15,
    delivery: { label: 'عنوان', details: 'تفاصيل', lat: 'abc', lng: null },
  },
};

(async () => {
  let fail = 0;
  for (const [name, v] of Object.entries(cases)) {
    for (const lang of ['ar', 'en']) {
      const t0 = process.hrtime.bigint();
      try {
        const buf = await B.buildInvoicePdf(v, lang);
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        const mb = buf.toString('latin1').match(/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
        const w = mb ? +mb[1] : -1;
        const h = mb ? +mb[2] : -1;
        const bad = [];
        if (!buf.length || buf.subarray(0, 5).toString() !== '%PDF-') bad.push('ليس PDF صالحاً');
        if (h > 14400) bad.push(`ارتفاع ${h} > 14400 (ملف يرفضه القارئ)`);
        if (w !== 420) bad.push(`عرض ${w} ≠ 420`);
        if (ms > 5000) bad.push(`بطيء ${Math.round(ms)}ms`);
        console.log(`${bad.length ? '❌' : '✅'} ${name.padEnd(24)} [${lang}] ${(buf.length / 1024).toFixed(0)}KB ${w}x${h}pt ${Math.round(ms)}ms ${bad.join(' · ')}`);
        if (bad.length) fail++;
        if (lang === 'ar' && /^[ABCIJKL]_/.test(name)) fs.writeFileSync(`${OUT}/stress_${name}.pdf`, buf);
      } catch (e) {
        console.log(`❌ ${name.padEnd(24)} [${lang}] رمى: ${e.message}`);
        fail++;
      }
    }
  }
  console.log(`\nفشل: ${fail}`);
  process.exit(fail ? 1 : 0);
})();
