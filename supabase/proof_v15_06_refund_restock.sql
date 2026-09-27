-- ═══════════════════════════════════════════════════════════════════════════
-- إثباتُ v15.06 — بيعٌ ثمّ استرداد، على المحاور الأربعة (تجربةٌ تُلغى)
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 ليس هجرة: يُدخل حجزاً ويُتمّه ويستردّه. كلُّه داخل `BEGIN … ROLLBACK`.
BEGIN;

ALTER TABLE public.bookings DISABLE TRIGGER USER;
ALTER TABLE public.bookings ENABLE TRIGGER trg_adjust_deal_quantity;
ALTER TABLE public.bookings ENABLE TRIGGER tr_zx_on_hand_on_sale;

-- سطرُ القياس: أربعةُ محاور، كاملُها ومتاحُها
CREATE OR REPLACE FUNCTION pg_temp.snap(p_deal text, p_var text, p_loc text)
RETURNS text LANGUAGE sql STABLE AS $s$
  SELECT format('عرض %s/%s · صنف %s/%s · فرع %s/%s · صنف×فرع %s/%s · محجوز %s',
    d.on_hand, d.quantity,
    (SELECT e->>'onHand' FROM jsonb_array_elements(d.variants) e WHERE e->>'id'=p_var),
    (SELECT e->>'qty'    FROM jsonb_array_elements(d.variants) e WHERE e->>'id'=p_var),
    (SELECT e->>'onHand'   FROM jsonb_array_elements(d.locations) e WHERE e->>'id'=p_loc),
    (SELECT e->>'quantity' FROM jsonb_array_elements(d.locations) e WHERE e->>'id'=p_loc),
    (SELECT e->'variantOnHand'->>p_var FROM jsonb_array_elements(d.locations) e WHERE e->>'id'=p_loc),
    (SELECT e->'variantQtys'->>p_var   FROM jsonb_array_elements(d.locations) e WHERE e->>'id'=p_loc),
    public.taki_open_holds(p_deal, NULL, NULL))
  FROM public.deals d WHERE d.id = p_deal;
$s$;

DO $proof$
-- 🪤 أسماءُ المتغيّرات تبدأ بـ v_ : PL/pgSQL **لا يفرّق بين حالة الحرف**،
--    فمتغيّرٌ اسمه D يلتبس بالاسم المستعار d في كل استعلامٍ داخل الكتلة
--    ويعود «column reference "d" is ambiguous» من مكانٍ لا علاقة له به.
DECLARE
  v_deal text := '1784887696710'; v_var text := 'v_mryrzvhddnxn'; v_loc text := 'primary';
  s0 text; s1 text; s2 text; s3 text; s4 text;
  r jsonb; v_oh int; v_q int; v_vo int; v_vq int;
BEGIN
  -- 🔴 اللقطةُ المرجعية تُؤخذ **قبل** إدراج الحجز. وأوّل نسخةٍ كتبتُها أخذتها
  --    بعده، فكان المحجوز ٤ والمتاح ٧٥، فاتّهمت إرجاعاً صحيحاً (٧٩/٧٩) بأنه
  --    خاطئ. مرجعُ المقارنة جزءٌ من الاختبار لا خلفيّةٌ له.
  s0 := pg_temp.snap(v_deal,v_var,v_loc); RAISE NOTICE '① قبل كل شيء : %', s0;

  -- إدراجُ الحجز (بأعمدةٍ تُقرأ من المخطّط: search_norm عمودٌ مولَّد)
  DECLARE cols text;
  BEGIN
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='bookings' AND is_generated='NEVER';
    EXECUTE format('CREATE TEMP TABLE _r AS SELECT %s FROM public.bookings WHERE deal_id=%L LIMIT 1', cols, v_deal);
    UPDATE _r SET barcode='999999911', status='pending', booked_quantity=4, location_id=v_loc,
      selected_options='[{"c":"v_mryrzvhddnxn","g":"__variant__","qty":3}]'::jsonb,
      paid_at = now(), refund_state = NULL, restocked_qty = 0;
    EXECUTE format('INSERT INTO public.bookings (%s) SELECT %s FROM _r', cols, cols);
  END;
  RAISE NOTICE '② بعد الحجز  : %', pg_temp.snap(v_deal,v_var,v_loc);

  -- إتمامُ البيع: المحجوز يُفرَّغ والكامل ينقص
  UPDATE public.bookings SET status='acknowledged' WHERE barcode='999999911';
  UPDATE public.bookings SET status='completed'    WHERE barcode='999999911';
  s1 := pg_temp.snap(v_deal,v_var,v_loc); RAISE NOTICE '③ بعد البيع  : %', s1;
  IF s1 = s0 THEN RAISE EXCEPTION '❌ البيعُ لم يُنقص شيئاً — الإعدادُ خاطئ.'; END IF;

  -- ── الاسترداد ─────────────────────────────────────────────────────────
  r := public.taki_restock_booking('999999911', NULL, 'refund');
  IF NOT COALESCE((r->>'ok')::boolean,false) THEN RAISE EXCEPTION '❌ الإرجاع فشل: %', r::text; END IF;
  s2 := pg_temp.snap(v_deal,v_var,v_loc); RAISE NOTICE '④ بعد الاسترداد: %', s2;

  -- 🔴 الادّعاء الحاسم: عاد كلُّ شيء إلى ما قبل البيع، على المحاور الأربعة
  IF s2 IS DISTINCT FROM s0 THEN
    RAISE EXCEPTION E'❌ 🔴 الاستردادُ لم يُعد الحالة:\n   قبل      : %\n   بعد الردّ: %', s0, s2;
  END IF;
  RAISE NOTICE '✅ الاستردادُ أعاد المحاور الأربعة إلى ما قبل البيع بالضبط.';

  -- ── نداءٌ ثانٍ لا يُضاعف ───────────────────────────────────────────────
  r := public.taki_restock_booking('999999911', NULL, 'refund');
  IF COALESCE(r->>'already','') <> 'true' AND NOT COALESCE((r->>'already')::boolean,false) THEN
    RAISE EXCEPTION '❌ النداءُ الثاني لم يُعلن أنه مكرَّر: %', r::text;
  END IF;
  s3 := pg_temp.snap(v_deal,v_var,v_loc);
  IF s3 IS DISTINCT FROM s2 THEN
    RAISE EXCEPTION E'❌ 🔴 نداءان ضاعفا البضاعة:\n   بعد الأوّل: %\n   بعد الثاني: %', s2, s3;
  END IF;
  RAISE NOTICE '✅ النداءُ الثاني لم يُضف شيئاً (خاملُ التكرار).';

  -- ── وحارسُ الحالة لم يُفتح: الطلبُ ما زال «مكتملاً» ────────────────────
  IF (SELECT status FROM public.bookings WHERE barcode='999999911') <> 'completed' THEN
    RAISE EXCEPTION '❌ الطلبُ خرج من «مكتمل» — الفاتورة الضريبية المجمّدة تتّكئ على نهائيّتها.';
  END IF;
  IF (SELECT cancelled_by FROM public.bookings WHERE barcode='999999911') IS NOT NULL THEN
    RAISE EXCEPTION '❌ كُتب cancelled_by على طلبٍ مكتمل — صفٌّ متناقض.';
  END IF;
  IF (SELECT restocked_qty FROM public.bookings WHERE barcode='999999911') <> 4 THEN
    RAISE EXCEPTION '❌ سجلُّ الإرجاع خاطئ: %', (SELECT restocked_qty FROM public.bookings WHERE barcode='999999911');
  END IF;
  RAISE NOTICE '✅ الطلبُ ما زال مكتملاً · cancelled_by فارغ · والمُعاد ٤.';

  -- ── وبابُ التسوية الحقيقيّ (الردّ الفوريّ) يُعيدها كذلك ────────────────
  UPDATE public.bookings
     SET restocked_qty = 0, refund_state = 'claiming', refund_claimed_at = now(),
         refund_amount = 10, refund_by = 'merchant'
   WHERE barcode = '999999911';
  -- نُعيد الحالة إلى ما بعد البيع كي يكون للإرجاع ما يُعيده
  PERFORM public.taki_set_on_hand(v_deal,
    (SELECT on_hand FROM deals WHERE id=v_deal) - 4,
    jsonb_build_array(jsonb_build_object('id', v_var,
      'onHand', (SELECT (e->>'onHand')::int - 3 FROM deals d, jsonb_array_elements(d.variants) e
                  WHERE d.id=v_deal AND e->>'id'=v_var))),
    jsonb_build_array(jsonb_build_object('id', v_loc,
      'onHand', (SELECT (e->>'onHand')::int - 4 FROM deals d, jsonb_array_elements(d.locations) e
                  WHERE d.id=v_deal AND e->>'id'=v_loc),
      'variantOnHand', jsonb_build_object(v_var,
        (SELECT (e->'variantOnHand'->>v_var)::int - 3 FROM deals d, jsonb_array_elements(d.locations) e
          WHERE d.id=v_deal AND e->>'id'=v_loc)))),
    NULL, 'sale');
  s4 := pg_temp.snap(v_deal,v_var,v_loc);
  IF s4 IS NOT DISTINCT FROM s0 THEN RAISE EXCEPTION '❌ إعادةُ التهيئة لم تُنقص شيئاً.'; END IF;

  r := public.taki_settle_booking_refund('999999911', true, 'REF-PROOF', 'إثبات');
  IF NOT COALESCE((r->>'ok')::boolean,false) THEN RAISE EXCEPTION '❌ التسوية فشلت: %', r::text; END IF;
  IF pg_temp.snap(v_deal,v_var,v_loc) IS DISTINCT FROM s0 THEN
    RAISE EXCEPTION E'❌ 🔴 بابُ التسوية لم يُعد البضاعة:\n   المطلوب: %\n   الواقع : %', s0, pg_temp.snap(v_deal,v_var,v_loc);
  END IF;
  RAISE NOTICE '✅ بابُ تسوية البوّابة (الردّ الفوريّ) أعاد المحاور الأربعة كذلك.';

  RAISE NOTICE '✅ الإثبات كامل — وكلُّه داخل معاملةٍ تُلغى.';
END
$proof$;

ROLLBACK;

SELECT 'بعد الإلغاء: ' || on_hand::text || ' · حجوزٌ وهميّة: ' ||
       (SELECT count(*) FROM public.bookings WHERE barcode LIKE '9999999%')::text
  FROM public.deals WHERE id = '1784887696710';
