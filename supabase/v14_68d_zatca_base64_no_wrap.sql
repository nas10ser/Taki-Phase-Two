-- ════════════════════════════════════════════════════════════════════════════
-- v14.68d — 🔴 إصلاح عيبٍ أدخلتُه أنا في v14.68: الرمز كان يحمل أسطراً جديدة
-- ════════════════════════════════════════════════════════════════════════════
-- `encode(bytea, 'base64')` في PostgreSQL **يلفّ السطر كل ٧٦ محرفاً** ويحشر
-- سطراً جديداً. فكان ناتج `taki_zatca_tlv` نصّاً مقطّعاً:
--   طول الرمز القصير ١٢١ محرفاً بدل ١٢٠، وأول سطرٍ جديد عند المحرف ٧٧.
-- ورمزُ QR يحمل ما يُعطى حرفاً بحرف — فكان الماسح يقرأ Base64 فيه أسطر، وهو
-- ليس ما تقرؤه أداة الهيئة.
--
-- 🔴 وقلتُ في v14.68 إن المخرج «مطابقٌ بايتاً ببايت» لنسخة JS — **وكان الحكم
--    خاطئاً**: المقارنة يومها مرّت عبر أنبوب صدَفةٍ ابتلع السطر الجديد. القياس
--    الصحيح اليوم (md5 على الطرفين) يقول: متطابقان **بعد** حذف الأسطر فقط.
--    ولذلك يثبّت التحقّق أدناه المتّجهين الذهبيين نصّاً كاملاً لا بنيةً فقط.
--
-- 🪤 الدرس: مقارنة نصّين عبر `| tail -1` أو `$(...)` تُسقط الأسطر الجديدة
--    بصمت. أي مقارنة ترميزٍ تُحسم بـ`md5` أو بالطول، لا بالعين.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'رُفض: هذا خادم المختبر (طوكيو) — هجرات الإنتاج تُطبَّق على جدة';
  END IF;
END $guard$;

BEGIN;

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
  -- 🪤 `encode(...,'base64')` يلفّ كل ٧٦ محرفاً — والرمز يجب أن يكون سطراً واحداً.
  RETURN translate(encode(buf, 'base64'), E'\n\r', '');
END $function$;

COMMIT;

-- ── تحقّقٌ يرفع استثناءً ─────────────────────────────────────────────────────
-- متّجهان ذهبيان **نصّاً كاملاً**، مطابقان لمخرج `shared/zatcaTlv.js` (قِيسا
-- بـmd5 على الطرفين يوم ٢٠ سبتمبر ٢٠٢٦). ونفس المتّجهين مثبَّتان في
-- `scripts/test-invoice-encoding.js` فيفشل بناء الموقع إن انحرف أحد الطرفين.
DO $verify$
DECLARE
  v_short CONSTANT text := 'AR7Zhdiq2KzYsSDYqtin2YPZiiDZhNmE2LnYt9mI2LECDzMxMDAwMDAwMDAwMDAwMwMYMjAyNi0wOS0yMFQxMDoxNTowMC4wMDBaBAYxMTUuMDAFBTE1LjAw';
  v   text;
  v_l text;
BEGIN
  v := public.taki_zatca_tlv('متجر تاكي للعطور', '310000000000003',
                             '2026-09-20T10:15:00.000Z', '115.00', '15.00');
  IF position(chr(10) in v) > 0 OR position(chr(13) in v) > 0 THEN
    RAISE EXCEPTION 'فشل: الرمز ما زال يحمل سطراً جديداً';
  END IF;
  IF v <> v_short THEN
    RAISE EXCEPTION 'فشل: المتّجه الذهبي القصير لا يطابق (طول % بدل %)', length(v), length(v_short);
  END IF;

  -- الحالة التي كانت تفترق فيها النسختان: اسمٌ أطول من ٢٥٥ بايتاً.
  v_l := public.taki_zatca_tlv(repeat('متجر ', 60), '310000000000003',
                               '2026-09-20T10:15:00.000Z', '115.00', '15.00');
  IF position(chr(10) in v_l) > 0 THEN RAISE EXCEPTION 'فشل: الرمز الطويل ملفوف'; END IF;
  IF md5(v_l) <> '2b1f585b8ac59f9d4f20605e1f2df628' THEN
    RAISE EXCEPTION 'فشل: المتّجه الذهبي الطويل لا يطابق مخرج shared/zatcaTlv.js';
  END IF;
  -- وبايت الطول ٢٥٤ لا ٢٥٥: القصّ على حدّ محرف عربيّ (بايتان) لا في منتصفه.
  IF get_byte(decode(v_l, 'base64'), 1) <> 254 THEN
    RAISE EXCEPTION 'فشل: بايت الطول % — القصّ ليس على حدّ محرف', get_byte(decode(v_l,'base64'), 1);
  END IF;
END $verify$;

SELECT 'v14.68d' AS "الهجرة",
       length(public.taki_zatca_tlv('متجر تاكي للعطور','310000000000003',
              '2026-09-20T10:15:00.000Z','115.00','15.00')) AS "طول الرمز",
       md5(public.taki_zatca_tlv(repeat('متجر ',60),'310000000000003',
              '2026-09-20T10:15:00.000Z','115.00','15.00')) AS "بصمة الطويل";
