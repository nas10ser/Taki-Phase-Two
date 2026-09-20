-- ════════════════════════════════════════════════════════════════════════════
-- v14.68 — ترميز رمز زاتكا: مصدرٌ واحد في القاعدة بدل نسختين
-- ════════════════════════════════════════════════════════════════════════════
-- من تدقيق ٩ سبتمبر: «ترميز الفاتورة الضريبية مكتوب مرّتين (مرة للموقع ومرة
-- للبوت) فلو صُحّح أحدهما وحده أصدرت المنصّة مستندين ضريبيين مختلفين لنفس
-- العملية».
--
-- 🔴 والتكرار لم يكن نظرياً: قِيس على نفس المدخلات فاختلف المخرجان حين يتجاوز
--    اسم البائع ٢٥٥ بايتاً (اسمٌ عربيّ من ١٢٨ حرفاً يكفي):
--      الموقع → AcLZhdiq2KzYsSDZhdiq… (يكتب طولاً مبتوراً ٠xC2 ويُبقي كل البايتات)
--      البوت  → Af/Zhdiq2KzYsSDZhdiq… (يكتب ٠xFF ويقصّ البايتات عند ٢٥٥)
--    أي رمزان مختلفان على مستندٍ ضريبيّ واحد. وكلاهما غير سليم: بايت الطول في
--    TLV واحد، فالقيمة الأطول من ٢٥٥ **يجب** أن تُقصّ — وعلى حدّ محرف UTF-8
--    لا في منتصفه، وإلا خرج للماسح نصٌّ مشوّه.
--
-- الحلّ: الترميز في القاعدة، والطرفان يقرآن الناتج. وكلاهما **يقرأ أصلاً**
-- نفس اللقطة المجمّدة (`order_invoices`) عبر `get_order_invoice` و
-- `bot_get_booking_invoice` — فلا يتغيّر مصدر الأرقام، يتغيّر مكان الترميز فقط.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'رُفض: هذا خادم المختبر (طوكيو) — هجرات الإنتاج تُطبَّق على جدة';
  END IF;
END $guard$;

BEGIN;

/**
 * قصٌّ آمن إلى `p_max` بايتاً على حدّ محرف UTF-8.
 * 🪤 `left(s, n)` تعدّ **المحارف** لا البايتات، و`substring(bytea)` تقصّ في
 *    منتصف المحرف. فنقصّ بالمحارف ونتحقّق بالبايتات.
 */
CREATE OR REPLACE FUNCTION public.taki_utf8_clip(p_text text, p_max int DEFAULT 255)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE s text := COALESCE(p_text, ''); n int;
BEGIN
  IF octet_length(s) <= p_max THEN RETURN s; END IF;
  n := length(s);
  WHILE n > 0 AND octet_length(left(s, n)) > p_max LOOP
    n := n - 1;
  END LOOP;
  RETURN left(s, n);
END $function$;

/**
 * ترميز TLV ثم Base64 للمرحلة الأولى من الفوترة الإلكترونية.
 * الحقول الخمسة بالترتيب: اسم البائع · الرقم الضريبي · التاريخ ISO ·
 * الإجمالي شامل الضريبة · مبلغ الضريبة.
 */
CREATE OR REPLACE FUNCTION public.taki_zatca_tlv(
  p_seller  text,
  p_vat     text,
  p_iso     text,
  p_total   text,
  p_vat_amt text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  vals  text[] := ARRAY[
    public.taki_utf8_clip(p_seller),  public.taki_utf8_clip(p_vat),
    public.taki_utf8_clip(p_iso),     public.taki_utf8_clip(p_total),
    public.taki_utf8_clip(p_vat_amt)
  ];
  buf   bytea := '\x'::bytea;
  b     bytea;
  i     int;
BEGIN
  FOR i IN 1..5 LOOP
    b := convert_to(COALESCE(vals[i], ''), 'UTF8');
    buf := buf
        || set_byte('\x00'::bytea, 0, i)                      -- الوسم
        || set_byte('\x00'::bytea, 0, octet_length(b))        -- الطول (بايت واحد)
        || b;                                                 -- القيمة
  END LOOP;
  RETURN encode(buf, 'base64');
END $function$;

REVOKE ALL ON FUNCTION public.taki_utf8_clip(text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_zatca_tlv(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_zatca_tlv(text, text, text, text, text) FROM anon;
-- لا تُمنح لأحد: تُستدعى من داخل دوال الفاتورة وحدها، فلا يُمرّر أحدٌ أرقاماً
-- من عنده ويحصل على رمزٍ يبدو رسمياً.

COMMIT;

-- ── تحقّقٌ يرفع استثناءً ─────────────────────────────────────────────────────
DO $verify$
DECLARE
  v text;
  v_long text;
BEGIN
  -- متّجه ذهبي: نفس مخرج نسختَي JS للاسم القصير (تحقّق يدوياً قبل الكتابة).
  v := public.taki_zatca_tlv('متجر تاكي للعطور', '310000000000003',
                             '2026-09-20T10:15:00.000Z', '115.00', '15.00');
  IF v IS NULL OR v = '' THEN RAISE EXCEPTION 'فشل: الترميز أرجع فراغاً'; END IF;
  IF decode(v, 'base64') IS NULL THEN RAISE EXCEPTION 'فشل: الناتج ليس Base64 صالحاً'; END IF;
  -- الوسم الأول = 1 وطوله = عدد بايتات الاسم
  IF get_byte(decode(v,'base64'), 0) <> 1 THEN RAISE EXCEPTION 'فشل: الوسم الأول ليس ١'; END IF;
  IF get_byte(decode(v,'base64'), 1) <> octet_length(convert_to('متجر تاكي للعطور','UTF8')) THEN
    RAISE EXCEPTION 'فشل: بايت الطول لا يطابق عدد بايتات الاسم';
  END IF;

  -- الحالة التي اختلف فيها الطرفان: اسمٌ أطول من ٢٥٥ بايتاً.
  v_long := public.taki_zatca_tlv(repeat('متجر ', 60), '310000000000003',
                                  '2026-09-20T10:15:00.000Z', '115.00', '15.00');
  IF get_byte(decode(v_long,'base64'), 1) > 255 THEN
    RAISE EXCEPTION 'فشل: بايت الطول تجاوز ٢٥٥';
  END IF;
  -- والقصّ على حدّ محرف: النصّ المقصوص يجب أن يُقرأ UTF-8 سليماً
  IF public.taki_utf8_clip(repeat('متجر ', 60)) IS NULL
     OR octet_length(convert_to(public.taki_utf8_clip(repeat('متجر ', 60)), 'UTF8')) > 255 THEN
    RAISE EXCEPTION 'فشل: القصّ تجاوز ٢٥٥ بايتاً';
  END IF;

  IF has_function_privilege('anon','public.taki_zatca_tlv(text, text, text, text, text)','EXECUTE') THEN
    RAISE EXCEPTION 'فشل: anon تملك EXECUTE على مولّد الرمز الضريبي';
  END IF;
END $verify$;

SELECT 'v14.68 zatca' AS "الهجرة",
       public.taki_zatca_tlv('متجر تاكي للعطور', '310000000000003',
                             '2026-09-20T10:15:00.000Z', '115.00', '15.00') AS "المتّجه الذهبي";
