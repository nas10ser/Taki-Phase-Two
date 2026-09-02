-- ============================================================================
-- TAKI · v13.95 — فاتورة الحجز في البوتات
-- ============================================================================
-- طلب ناصر: «أضف الفواتير في البوتات عند الحجز — لم تظهر خانة الفاتورة».
--
-- دوال البوت الحالية (bot_get_my_bookings / bot_get_seller_bookings) لا تُرجع
-- سعراً ولا حالة دفع ولا الخيارات المختارة — فلا يمكن بناء فاتورة منها. هذه
-- الدالة تُرجع كل ما تحتاجه الفاتورة في نداء واحد، لصاحب الحجز أو تاجره فقط.
--
-- الحماية: نفس نمط bot_get_pay_info — بوابة السر أولاً، ثم ملكية الصفّ.
--   ⚠️ لا يُلغى إذن anon على دوال bot_* (البوت يناديها بمفتاح anon خلف
--      بوابة x-bot-secret) — راجع v12.12.
--
-- آمنة للتكرار · تُطبَّق على خادم جدة حصراً.
-- ============================================================================

-- ── حارس: يرفض التنفيذ على مختبر طوكيو ──────────────────────────────────────
DO $guard$
BEGIN
  IF coalesce(obj_description('public'::regnamespace, 'pg_namespace'), '')
     = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION
      'رُفض التنفيذ: هذا مختبر طوكيو. هذه هجرة إنتاج وتُطبَّق على خادم جدة فقط.';
  END IF;
END
$guard$;

BEGIN;

-- CREATE OR REPLACE لا يغيّر نوع الإرجاع، فنُسقط أولاً (بلا CASCADE).
DROP FUNCTION IF EXISTS public.bot_get_booking_invoice(text, text);

CREATE FUNCTION public.bot_get_booking_invoice(p_uid text, p_barcode text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_b       public.bookings%ROWTYPE;
  v_d       public.deals%ROWTYPE;
  v_is_buyer  boolean;
  v_is_seller boolean;
  v_vat     jsonb;
  v_vat_no  text;
  v_cr      text;
  v_total   numeric;
  v_rate    numeric;
  v_base    numeric;
  v_tax     numeric;
  v_items   jsonb := '[]'::jsonb;
  v_sel     jsonb;
  v_row     jsonb;
  v_grp     jsonb;
  v_choice  jsonb;
  v_label   text;
BEGIN
  IF NOT public._bot_gate_ok() THEN RAISE EXCEPTION 'GATE'; END IF;

  SELECT * INTO v_b FROM public.bookings WHERE barcode = p_barcode;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- الملكية: المشتري صاحب الحجز، أو التاجر صاحب المتجر. لا أحد غيرهما —
  -- الفاتورة تحمل اسم المشتري ورقمه، فهي بيانات شخصية لا تُفتح لثالث.
  v_is_buyer  := v_b.user_id IS NOT DISTINCT FROM p_uid;
  v_is_seller := v_b.store_id IS NOT DISTINCT FROM p_uid;
  IF NOT (v_is_buyer OR v_is_seller) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT * INTO v_d FROM public.deals WHERE id = v_b.deal_id;

  -- ── الإجمالي ──────────────────────────────────────────────────────────────
  -- المصدر الأدق أولاً: مبلغ الدفع الإلكتروني الفعلي. ثم سطر «الإجمالي: ‹رقم›»
  -- الذي تكتبه الواجهة في الملاحظات (يشمل الإضافات والنسخ). وأخيراً حساب
  -- تقديري من سعر العرض × الكمية — يُعلَّم مصدره حتى لا يُقدَّم يقيناً وهو ظنّ.
  IF v_b.paid_amount IS NOT NULL AND v_b.paid_amount > 0 THEN
    v_total := v_b.paid_amount;
  ELSE
    v_total := NULLIF(substring(coalesce(v_b.notes, '') FROM 'الإجمالي:\s*([0-9]+(?:\.[0-9]+)?)'), '')::numeric;
  END IF;
  IF v_total IS NULL AND v_d.discounted_price IS NOT NULL THEN
    v_total := v_d.discounted_price * coalesce(v_b.booked_quantity, 1);
  END IF;

  -- ── الضريبة ───────────────────────────────────────────────────────────────
  -- تُعرض فقط حين تكون مفعّلة على المنصة **و** التاجر مسجّل ضريبياً — عرض
  -- تفصيل ضريبي لتاجر غير مسجّل ادّعاء لا يجوز.
  v_vat := public.bot_vat_mode();
  SELECT sp.vat_number, sp.cr_number INTO v_vat_no, v_cr
    FROM public.store_profiles sp WHERE sp.store_id = v_b.store_id;

  IF coalesce((v_vat->>'enabled')::boolean, false)
     AND nullif(btrim(coalesce(v_vat_no, '')), '') IS NOT NULL
     AND v_total IS NOT NULL THEN
    v_rate := coalesce((v_vat->>'rate')::numeric, 15);
    IF coalesce((v_vat->>'add_on_top')::boolean, false) THEN
      v_base := round(v_total, 2);
      v_tax  := round(v_total * v_rate / 100, 2);
    ELSE
      -- الأسعار شاملة الضريبة: نفصلها من الإجمالي لا نضيفها فوقه.
      v_base := round(v_total / (1 + v_rate / 100), 2);
      v_tax  := round(v_total - v_base, 2);
    END IF;
  END IF;

  -- ── العناصر: النسخ والإضافات المختارة ────────────────────────────────────
  v_sel := CASE WHEN jsonb_typeof(coalesce(v_b.selected_options, 'null'::jsonb)) = 'array'
                THEN v_b.selected_options ELSE '[]'::jsonb END;

  FOR v_row IN SELECT * FROM jsonb_array_elements(v_sel) LOOP
    IF v_row->>'g' = '__variant__' THEN
      SELECT vv INTO v_choice
        FROM jsonb_array_elements(coalesce(v_d.variants, '[]'::jsonb)) vv
       WHERE vv->>'id' = v_row->>'c' LIMIT 1;
      v_label := coalesce(v_choice->>'label', v_row->>'c');
    ELSE
      SELECT gg INTO v_grp
        FROM jsonb_array_elements(coalesce(v_d.options, '[]'::jsonb)) gg
       WHERE gg->>'id' = v_row->>'g' LIMIT 1;
      SELECT cc INTO v_choice
        FROM jsonb_array_elements(coalesce(v_grp->'choices', '[]'::jsonb)) cc
       WHERE cc->>'id' = v_row->>'c' LIMIT 1;
      IF v_choice IS NULL THEN CONTINUE; END IF;
      v_label := CASE WHEN v_grp->>'title' IS NOT NULL
                      THEN (v_grp->>'title') || ': ' || coalesce(v_choice->>'label', '')
                      ELSE coalesce(v_choice->>'label', '') END;
    END IF;
    v_items := v_items || jsonb_build_object(
      'label', v_label,
      'qty',   coalesce((v_row->>'qty')::int, 1),
      'kind',  CASE WHEN v_row->>'g' = '__variant__' THEN 'variant' ELSE 'addon' END);
  END LOOP;

  RETURN jsonb_build_object(
    'ok',            true,
    'role',          CASE WHEN v_is_seller THEN 'seller' ELSE 'buyer' END,
    'barcode',       v_b.barcode,
    'status',        v_b.status,
    'cancelled_by',  v_b.cancelled_by,
    'item_name',     v_d.item_name,
    'shop_name',     v_d.shop_name,
    'store_id',      v_b.store_id,
    'quantity',      v_b.booked_quantity,
    'unit_price',    v_d.discounted_price,
    'original_price',v_d.original_price,
    'total',         v_total,
    -- من أين جاء الإجمالي: مدفوع فعلياً · محسوب من الطلب · تقدير من سعر العرض
    'total_source',  CASE WHEN v_b.paid_amount > 0 THEN 'paid'
                          WHEN v_b.notes ~ 'الإجمالي:' THEN 'order'
                          ELSE 'estimate' END,
    'vat_number',    v_vat_no,
    'cr_number',     v_cr,
    'vat_rate',      v_rate,
    'vat_base',      v_base,
    'vat_amount',    v_tax,
    'paid',          v_b.paid_at IS NOT NULL,
    'paid_amount',   v_b.paid_amount,
    'payment_method',v_b.payment_method,
    'items',         v_items,
    'buyer_name',    CASE WHEN v_is_seller THEN v_b.user_name ELSE NULL END,
    'buyer_phone',   CASE WHEN v_is_seller THEN v_b.user_phone ELSE NULL END,
    'prep_time',     v_b.prep_time,
    'notes',         v_b.notes,
    'merchant_note', v_b.merchant_note,
    'booked_at',     v_b.booked_at,
    'completed_at',  v_b.completed_at
  );
END;
$fn$;

-- نفس نمط بقية دوال البوت: تُنادى بمفتاح anon من خلف بوابة x-bot-secret.
REVOKE ALL ON FUNCTION public.bot_get_booking_invoice(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bot_get_booking_invoice(text, text) TO anon, authenticated, service_role;

COMMIT;

-- ── تقرير التحقّق (أول سطر = اسم الخادم) ────────────────────────────────────
SELECT 'الخادم' AS "الفحص",
       coalesce(obj_description('public'::regnamespace, 'pg_namespace'), '(بلا وسم)')
         || ' · db=' || current_database() AS "النتيجة",
       'ℹ️' AS "الحالة"
UNION ALL
SELECT 'دالة bot_get_booking_invoice',
       CASE WHEN count(*) = 1 THEN 'موجودة' ELSE 'مفقودة' END,
       CASE WHEN count(*) = 1 THEN '✅' ELSE '❌' END
  FROM pg_proc WHERE proname = 'bot_get_booking_invoice'
UNION ALL
SELECT 'بوابة السر داخلها',
       CASE WHEN prosrc LIKE '%_bot_gate_ok%' THEN 'مفعّلة' ELSE 'غائبة' END,
       CASE WHEN prosrc LIKE '%_bot_gate_ok%' THEN '✅' ELSE '❌' END
  FROM pg_proc WHERE proname = 'bot_get_booking_invoice'
UNION ALL
SELECT 'مسار البحث مثبَّت',
       CASE WHEN proconfig::text LIKE '%search_path%' THEN 'نعم' ELSE 'لا' END,
       CASE WHEN proconfig::text LIKE '%search_path%' THEN '✅' ELSE '❌' END
  FROM pg_proc WHERE proname = 'bot_get_booking_invoice'
UNION ALL
SELECT 'إذن anon (لازم لدوال البوت)',
       CASE WHEN has_function_privilege('anon', 'public.bot_get_booking_invoice(text,text)', 'EXECUTE')
            THEN 'ممنوح' ELSE 'مفقود' END,
       CASE WHEN has_function_privilege('anon', 'public.bot_get_booking_invoice(text,text)', 'EXECUTE')
            THEN '✅' ELSE '❌' END
UNION ALL
SELECT 'PUBLIC محروم (لا وصول بلا بوابة)',
       CASE WHEN has_function_privilege('public', 'public.bot_get_booking_invoice(text,text)', 'EXECUTE')
            THEN 'ما زال يملك' ELSE 'محروم' END,
       CASE WHEN has_function_privilege('public', 'public.bot_get_booking_invoice(text,text)', 'EXECUTE')
            THEN '❌' ELSE '✅' END;
