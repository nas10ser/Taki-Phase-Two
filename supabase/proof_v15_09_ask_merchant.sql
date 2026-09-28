-- ═══════════════════════════════════════════════════════════════════════════
-- إثباتُ v15.09 — جوابُ التاجر يحكم: «رجعت» و«لم ترجع» (تجربةٌ تُلغى)
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE public.bookings DISABLE TRIGGER USER;
ALTER TABLE public.bookings ENABLE TRIGGER trg_adjust_deal_quantity;
ALTER TABLE public.bookings ENABLE TRIGGER tr_zx_on_hand_on_sale;

DO $proof$
DECLARE
  v_deal text := '1784887696710';
  v_oh0 int; v_oh int; v_cols text; r jsonb; v_msg text;
BEGIN
  SELECT on_hand INTO v_oh0 FROM public.deals WHERE id = v_deal;
  RAISE NOTICE 'ℹ️ الكامل قبل كل شيء: %', v_oh0;

  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='bookings' AND is_generated='NEVER';

  -- ── (أ) «لم ترجع البضاعة» — حالةُ الهدية التي وصفها ناصر ───────────────
  EXECUTE format('CREATE TEMP TABLE _a AS SELECT %s FROM public.bookings WHERE deal_id=%L LIMIT 1', v_cols, v_deal);
  UPDATE _a SET barcode='999999931', status='pending', booked_quantity=3, location_id=NULL,
    selected_options='[]'::jsonb, paid_at=now(), paid_amount=50, total_amount=50,
    payment_provider='moyasar', payment_ref='pay_x', refund_state=NULL, refund_restock=NULL, restocked_qty=0;
  EXECUTE format('INSERT INTO public.bookings (%s) SELECT %s FROM _a', v_cols, v_cols);
  UPDATE public.bookings SET status='acknowledged' WHERE barcode='999999931';
  UPDATE public.bookings SET status='completed'    WHERE barcode='999999931';
  SELECT on_hand INTO v_oh FROM public.deals WHERE id = v_deal;
  IF v_oh <> v_oh0 - 3 THEN RAISE EXCEPTION '❌ البيعُ لم يُنقص ٣ (% ⇐ %).', v_oh0, v_oh; END IF;

  -- التاجر يضغط «ردّ» ويجيب: **لا، أهديتُها له**
  UPDATE public.bookings SET refund_state='claiming', refund_claimed_at=now(),
         refund_amount=50, refund_by='merchant', refund_restock = false
   WHERE barcode='999999931';
  r := public.taki_settle_booking_refund('999999931', true, 'REF-A', 'عيب — أُهديت');
  IF NOT COALESCE((r->>'ok')::boolean,false) THEN RAISE EXCEPTION '❌ التسوية فشلت: %', r::text; END IF;

  SELECT on_hand INTO v_oh FROM public.deals WHERE id = v_deal;
  IF v_oh <> v_oh0 - 3 THEN
    RAISE EXCEPTION '❌ 🔴 البضاعة عادت رغم أن التاجر قال «لم ترجع» (% ⇐ %).', v_oh0 - 3, v_oh;
  END IF;
  IF (SELECT restocked_qty FROM public.bookings WHERE barcode='999999931') <> 0 THEN
    RAISE EXCEPTION '❌ سُجّل إرجاعٌ لم يحدث.';
  END IF;
  -- والرسالةُ تقول ذلك للتاجر، لا تدّعي العكس
  SELECT body_ar INTO v_msg FROM public.notifications
   WHERE meta_data->>'barcode' = '999999931' AND meta_data->>'audience' = 'seller'
   ORDER BY created_at DESC LIMIT 1;
  IF v_msg IS NULL THEN RAISE EXCEPTION '❌ لا إشعارَ للتاجر إطلاقاً.'; END IF;
  IF position('ولم تعُد كمّيته' IN v_msg) = 0 THEN
    RAISE EXCEPTION '❌ الرسالةُ لا تقول إن الكمّية لم تعُد: %', left(v_msg, 200);
  END IF;
  RAISE NOTICE '✅ (أ) «لم ترجع»: الكامل ثابتٌ عند % · ولا إرجاعَ سُجّل · والرسالةُ صادقة.', v_oh;

  -- ── (ب) «نعم رجعت» — على طلبٍ ثانٍ ─────────────────────────────────────
  EXECUTE format('CREATE TEMP TABLE _b AS SELECT %s FROM public.bookings WHERE barcode=%L', v_cols, '999999931');
  UPDATE _b SET barcode='999999932', status='pending', refund_state=NULL, refund_restock=NULL,
                restocked_qty=0, refund_ref=NULL, refunded_at=NULL;
  EXECUTE format('INSERT INTO public.bookings (%s) SELECT %s FROM _b', v_cols, v_cols);
  UPDATE public.bookings SET status='acknowledged' WHERE barcode='999999932';
  UPDATE public.bookings SET status='completed'    WHERE barcode='999999932';
  SELECT on_hand INTO v_oh FROM public.deals WHERE id = v_deal;
  IF v_oh <> v_oh0 - 6 THEN RAISE EXCEPTION '❌ البيعُ الثاني لم يُنقص (% بدل %).', v_oh, v_oh0 - 6; END IF;

  UPDATE public.bookings SET refund_state='claiming', refund_claimed_at=now(),
         refund_amount=50, refund_by='merchant', refund_restock = true
   WHERE barcode='999999932';
  r := public.taki_settle_booking_refund('999999932', true, 'REF-B', 'استُعيدت');
  IF NOT COALESCE((r->>'ok')::boolean,false) THEN RAISE EXCEPTION '❌ التسوية الثانية فشلت: %', r::text; END IF;

  SELECT on_hand INTO v_oh FROM public.deals WHERE id = v_deal;
  IF v_oh <> v_oh0 - 3 THEN
    RAISE EXCEPTION '❌ 🔴 «نعم رجعت» لم تُعد الثلاثة (% بدل %).', v_oh, v_oh0 - 3;
  END IF;
  IF (SELECT restocked_qty FROM public.bookings WHERE barcode='999999932') <> 3 THEN
    RAISE EXCEPTION '❌ سجلُّ الإرجاع خاطئ.';
  END IF;
  SELECT body_ar INTO v_msg FROM public.notifications
   WHERE meta_data->>'barcode' = '999999932' AND meta_data->>'audience' = 'seller'
   ORDER BY created_at DESC LIMIT 1;
  IF v_msg IS NULL THEN RAISE EXCEPTION '❌ لا إشعارَ للتاجر إطلاقاً.'; END IF;
  IF position('وعادت كمّيته' IN v_msg) = 0 THEN
    RAISE EXCEPTION '❌ الرسالةُ لا تقول إن الكمّية عادت: %', left(v_msg, 200);
  END IF;
  -- 🔴 ولا تقول «أُلغي الطلب» لطلبٍ مكتملٍ لم يُلغَ (عيبُ v15.06)
  IF position('وأُلغي الطلب' IN v_msg) > 0 THEN
    RAISE EXCEPTION '❌ 🔴 الرسالةُ تقول «أُلغي الطلب» وهو مكتملٌ لم يُلغَ: %', left(v_msg, 200);
  END IF;
  IF (SELECT status FROM public.bookings WHERE barcode='999999932') <> 'completed' THEN
    RAISE EXCEPTION '❌ الطلبُ خرج من «مكتمل».';
  END IF;
  RAISE NOTICE '✅ (ب) «نعم رجعت»: الكامل عاد إلى % · والمُعاد ٣ · والرسالةُ صادقة ولا تدّعي إلغاءً.', v_oh;

  RAISE NOTICE '✅ الإثبات كامل — جوابُ التاجر هو الذي حكم في الحالتين.';
END
$proof$;

ALTER TABLE public.bookings ENABLE TRIGGER USER;
ROLLBACK;

SELECT 'بعد الإلغاء — الكامل: ' || on_hand::text || ' · حجوزٌ وهميّة: ' ||
       (SELECT count(*) FROM public.bookings WHERE barcode LIKE '9999999%')::text
  FROM public.deals WHERE id='1784887696710';
