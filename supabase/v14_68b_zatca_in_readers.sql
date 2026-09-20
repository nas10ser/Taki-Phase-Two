-- ════════════════════════════════════════════════════════════════════════════
-- v14.68b — الطرفان يقرآن الرمز بدل أن يُرمّز كلٌّ منهما بنفسه
-- ════════════════════════════════════════════════════════════════════════════
-- القارئان يقرآن أصلاً نفس اللقطة المجمّدة (`order_invoices`)، فلا يتغيّر مصدر
-- الأرقام — يُضاف إلى كل منهما حقلٌ واحد `zatca_tlv` يُرمَّز في القاعدة.
--
-- 🪤 التوقيع لم يتغيّر في الدالّتين، فـ`CREATE OR REPLACE` آمنة هنا. ولو أُضيف
--    معاملٌ لوجب `DROP` أولاً وإلا صار النداء ملتبساً وسكت البوتان.
-- 🪤 ولا يُنتَج رمزٌ لفاتورةٍ بلا ضريبة: الهيئة تشترطه على الفاتورة الضريبية،
--    ومنشأةٌ غير مسجَّلة لا تُصدر واحدة. `NULL` هنا تعني «لا رمز» صراحةً.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'رُفض: هذا خادم المختبر (طوكيو) — هجرات الإنتاج تُطبَّق على جدة';
  END IF;
END $guard$;

BEGIN;

CREATE OR REPLACE FUNCTION public.get_order_invoice(p_barcode text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me  text := (SELECT auth.uid()::text);
  v_row public.order_invoices%ROWTYPE;
  v_vat text;
BEGIN
  IF v_me IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_row FROM public.order_invoices WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_me <> COALESCE(v_row.buyer_id, '') AND v_me <> v_row.store_id AND NOT public.is_admin() THEN
    RETURN NULL;
  END IF;
  v_vat := NULLIF(btrim(COALESCE(v_row.seller->>'vat_number', '')), '');
  RETURN jsonb_build_object(
    'barcode',    v_row.barcode,
    'invoice_no', v_row.invoice_no,
    'issued_at',  v_row.issued_at,
    'currency',   v_row.currency,
    'total',      v_row.total,
    'vat_rate',   v_row.vat_rate,
    'vat_base',   v_row.vat_base,
    'vat_amount', v_row.vat_amount,
    'seller',     v_row.seller,
    -- v14.68 — الرمز من القاعدة: نسختان في الواجهتين كانتا تختلفان لاسمٍ طويل.
    'zatca_tlv',  CASE
                    WHEN v_row.vat_amount IS NULL OR v_vat IS NULL THEN NULL
                    ELSE public.taki_zatca_tlv(
                           COALESCE(v_row.seller->>'name', ''),
                           v_vat,
                           to_char(COALESCE(v_row.issued_at, v_row.created_at, now())
                                     AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                           to_char(v_row.total, 'FM9999999990.00'),
                           to_char(v_row.vat_amount, 'FM9999999990.00'))
                  END);
END
$function$;

COMMIT;

-- ── تحقّقٌ يرفع استثناءً ─────────────────────────────────────────────────────
DO $verify$
DECLARE n int; v jsonb;
BEGIN
  SELECT count(*) INTO n FROM pg_proc
   WHERE proname='get_order_invoice' AND pronamespace='public'::regnamespace;
  IF n <> 1 THEN RAISE EXCEPTION 'فشل: نسخ get_order_invoice = % (نسختان ⇒ نداءٌ ملتبس)', n; END IF;

  -- الحقل موجود في المخرَج (يُقاس على صفٍّ حقيقي بهوية مالكه)
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', (SELECT buyer_id FROM public.order_invoices WHERE buyer_id IS NOT NULL LIMIT 1),
                      'role','authenticated')::text, true);
  SELECT public.get_order_invoice((SELECT barcode FROM public.order_invoices
                                    WHERE buyer_id IS NOT NULL LIMIT 1)) INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'فشل: لم تُرجع الدالة فاتورةً لمالكها'; END IF;
  IF NOT (v ? 'zatca_tlv') THEN RAISE EXCEPTION 'فشل: حقل zatca_tlv غير موجود في المخرَج'; END IF;
END $verify$;

SELECT 'v14.68b' AS "الهجرة",
       (SELECT count(*) FROM order_invoices) AS "فواتير",
       (SELECT count(*) FROM order_invoices WHERE vat_amount IS NOT NULL) AS "بضريبة";
