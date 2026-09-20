/**
 * zatcaTlv.js — ترميز رمز زاتكا (TLV ثم Base64): **نسخةٌ واحدة**
 * ═══════════════════════════════════════════════════════════════════════════
 * الحقول الخمسة بترتيب المرحلة الأولى من الفوترة الإلكترونية:
 *   1 اسم البائع · 2 الرقم الضريبي · 3 التاريخ ISO · 4 الإجمالي شامل الضريبة ·
 *   5 مبلغ الضريبة.
 *
 * 🔴 لماذا وُحِّد (تدقيق ٩ سبتمبر ٢٠٢٦): كان الترميز مكتوباً مرّتين — مرّة في
 *    `src/utils/invoice.ts` ومرّة في `server/lib/invoicePdf.js` — و**اختلف
 *    المخرجان فعلاً** حين يتجاوز اسم البائع ٢٥٥ بايتاً (اسمٌ عربيّ من ١٢٨
 *    حرفاً يكفي): الموقع كتب بايت طولٍ مبتوراً (0xC2) وأبقى كل البايتات،
 *    والبوت كتب 0xFF وقصّ عند ٢٥٥ — أي رمزان مختلفان لمستندٍ ضريبيّ واحد،
 *    وكلاهما غير سليم.
 *
 * 🪤 بايت الطول في TLV **واحد**، فالقيمة الأطول من ٢٥٥ بايتاً يجب أن تُقصّ —
 *    و**على حدّ محرف UTF-8** لا في منتصفه، وإلا خرج للماسح نصٌّ مشوّه.
 *
 * ℹ️ فاتورة **الطلب** لم تعد تمرّ من هنا إطلاقاً: ترميزها في القاعدة
 *    (`public.taki_zatca_tlv`) والطرفان يقرآن `zatca_tlv` جاهزاً من اللقطة
 *    المجمّدة. يبقى هذا الملف لفاتورة **اشتراك تاكي** وحدها (تُبنى في
 *    المتصفّح من `subscription_payments` + إعدادات الضريبة).
 *    و`scripts/test-invoice-encoding.js` يثبّت الاثنين على نفس المتّجهات
 *    الذهبية، فأيّ انحرافٍ بينهما يُفشل البناء بدل أن يمرّ صامتاً.
 *
 * 🪤 CommonJS عمداً (يقرؤه Node وParcel معاً) — تحويله إلى ESM يكسر أي مستهلكٍ
 *    على الخادم بصمت.
 */

const TLV_MAX = 255;

const enc = () => new TextEncoder();

/** قصٌّ آمن إلى `max` بايتاً على حدّ محرف UTF-8 (نظير `public.taki_utf8_clip`). */
function utf8Clip(value, max) {
  const limit = max == null ? TLV_MAX : max;
  const bytes = enc().encode(String(value == null ? '' : value));
  if (bytes.length <= limit) return bytes;
  let k = limit;
  // 0b10xxxxxx = بايت استمرارٍ داخل محرف — نتراجع حتى بداية محرفٍ كامل.
  while (k > 0 && (bytes[k] & 0xC0) === 0x80) k--;
  return bytes.subarray(0, k);
}

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  if (typeof btoa === 'function') return btoa(bin);
  return Buffer.from(bytes).toString('base64');   // Node بلا btoa
}

/**
 * يُرجع نصّ Base64 للحقول الخمسة، أو '' عند أي فشل (لا يكسر طباعةً أبداً).
 */
function zatcaTlvBase64(seller, vat, iso, total, vatAmt) {
  try {
    const parts = [];
    let total_len = 0;
    [seller, vat, iso, total, vatAmt].forEach((v, i) => {
      const b = utf8Clip(v, TLV_MAX);
      parts.push([i + 1, b]);
      total_len += 2 + b.length;
    });
    const out = new Uint8Array(total_len);
    let o = 0;
    for (const [tag, b] of parts) {
      out[o++] = tag;
      out[o++] = b.length;      // ≤ 255 بحكم القصّ أعلاه
      out.set(b, o); o += b.length;
    }
    return toBase64(out);
  } catch {
    return '';
  }
}

module.exports = { zatcaTlvBase64, utf8Clip, TLV_MAX };
