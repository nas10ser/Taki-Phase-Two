-- ═══════════════════════════════════════════════════════════════════════════
-- إثبات v15.41 — المشتري يُغلق طلبَ **استلام** بيده (داخل معاملةٍ تُلغى)
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 لماذا ملفٌّ مستقلّ لا جزءٌ من الهجرة: إدراجُ حجزٍ يمرّ على ثمانية عشر
--    مشغّلاً ويكتب فواتير وإشعارات ويخصم مخزوناً. لا يُفعل ذلك في هجرةٍ
--    تُطبَّق على الإنتاج (عُرفُ تاكي · `proof_v15_03_hold_survives.sql`).
-- 🪤 وكلُّ شيءٍ هنا داخل `BEGIN … ROLLBACK` — صفرُ أثرٍ باقٍ. وقِيس بعده.
--
-- التشغيل:
--   scp supabase/proof_v15_41_buyer_pickup_receipt.sql ubuntu@207.127.99.122:/tmp/p.sql
--   ssh … 'sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--           -v ON_ERROR_STOP=1 -f - < /tmp/p.sql'
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;
DO $proof$
DECLARE
  v_deal text; v_buyer text; v_store text; -- 🪤 رقمُ الطلب أرقامٌ فقط بلا صفرٍ بادئ (حارس v15.00) — وقد رفض أوّلَ
  --    محاولةٍ لهذا الإثبات، فعمل كما يجب.
  v_bc text := (9000000000 + floor(random()*999999999)::bigint)::text;
  v_err text; v_hit boolean; v_before int; v_after int;
BEGIN
  SELECT d.id, d.store_id INTO v_deal, v_store
    FROM public.deals d WHERE d.status = 'active' LIMIT 1;
  SELECT u.id INTO v_buyer FROM public.users u
   WHERE u.user_type = 'buyer' AND u.deleted_at IS NULL AND u.id IS DISTINCT FROM v_store LIMIT 1;
  IF v_deal IS NULL OR v_buyer IS NULL THEN
    RAISE EXCEPTION '❌ لا عرضٌ حيّ أو لا مشترٍ — الإثباتُ لم يُجرَ، وهذا فشل (عرض=% مشترٍ=%)',
      coalesce(v_deal,'∅'), coalesce(v_buyer,'∅');
  END IF;

  SELECT count(*) INTO v_before FROM public.bookings WHERE status = 'completed';

  -- طلبُ **استلام** حيّ باسم المشتري
  -- 🪤 ونيّةُ الدفع تُشتقّ من إقرار المتجر: حارسُ v15.33 يرفض نقداً لمتجرٍ
  --    أقرّ «بطاقة فقط» — وقد رفض محاولةً هنا، فعمل كما يجب.
  INSERT INTO public.bookings (barcode, deal_id, user_id, store_id, user_name, user_phone,
                               booked_quantity, status, fulfillment, payment_method, backup_code, booked_at, expiry_time)
  VALUES (v_bc, v_deal, v_buyer, v_store, 'إثبات', '0500000000', 1, 'pending', 'pickup',
          CASE WHEN COALESCE((SELECT accepts_cod FROM public.store_profiles WHERE store_id = v_store), true)
               THEN 'cod' ELSE 'online' END,
          (7000000000 + floor(random()*999999999)::bigint)::text,
          (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint,
          (EXTRACT(EPOCH FROM NOW() + interval '2 hours') * 1000)::bigint);

  -- (أ) المشتري يُغلقه — وهذا ما كان مستحيلاً قبل v15.41
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
  PERFORM public.buyer_confirm_receipt(v_bc);
  IF (SELECT status FROM public.bookings WHERE barcode = v_bc) <> 'completed' THEN
    RAISE EXCEPTION '❌ لم يُغلق طلبُ الاستلام'; END IF;
  IF (SELECT completed_by FROM public.bookings WHERE barcode = v_bc) <> 'buyer' THEN
    RAISE EXCEPTION '❌ لم يُسجَّل أن المشتري أغلقه — فلن يعرف التاجرُ من ختمه'; END IF;

  -- (ب) والتاجرُ يُشعَر
  IF NOT EXISTS (SELECT 1 FROM public.notifications
                  WHERE user_id = v_store AND meta_data->>'barcode' = v_bc
                    AND meta_data->>'event' = 'buyer_confirmed') THEN
    RAISE EXCEPTION '❌ لم يصل التاجرَ إشعارُ تأكيد الاستلام'; END IF;

  -- (ج) سالب: لا يُغلق مرّتين
  v_hit := false;
  BEGIN PERFORM public.buyer_confirm_receipt(v_bc);
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_hit := position('مغلق' IN v_err) > 0;
    IF NOT v_hit THEN RAISE EXCEPTION '❌ رُفض لسببٍ آخر: %', v_err; END IF;
  END;
  IF NOT v_hit THEN RAISE EXCEPTION '❌ أُغلق الطلبُ مرّتين'; END IF;

  -- (د) سالب: غيرُ صاحبه لا يُغلقه (التاجرُ نفسه عبر دالّة المشتري)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_store, 'role', 'authenticated')::text, true);
  v_hit := false;
  BEGIN PERFORM public.buyer_confirm_receipt(v_bc);
  EXCEPTION WHEN OTHERS THEN v_hit := true; END;
  IF NOT v_hit THEN RAISE EXCEPTION '❌ أغلق غيرُ صاحب الطلب طلباً ليس له'; END IF;

  -- 🪤 (هـ) شرطُ التوصيل لا يُثبَت هنا: بناءُ طلبِ توصيلٍ صالح يحتاج عنوانَ
  --    مشترٍ داخل نطاقٍ مرسومٍ للفرع، وحارسُ `tr_guard_booking_delivery` يرفض
  --    بلا ذلك (`TAKI_DELIVERY_NO_ADDRESS` — وقد رفض محاولةً هنا فعلاً).
  --    وهو مُثبَتٌ بنيوياً في `JEDDAH_v15_41_buyer_receipt_pickup.sql`: الفحصُ
  --    يشترط بقاءَ `= 'delivery' THEN` و`on_the_way` في الدالّتين، و**كُسر**
  --    بإسقاط الشرط فسقط برسالة «هذا إضعافٌ لا توسعة».

  PERFORM set_config('request.jwt.claims', NULL, true);
  SELECT count(*) INTO v_after FROM public.bookings WHERE status = 'completed';
  RAISE NOTICE '✅ مُثبَت سلوكياً: الاستلام يُغلق بيد المشتري (% ⇐ %) · التاجرُ يُشعَر · لا إغلاقَ مرّتين ولا لغير صاحبه ',
    v_before, v_after;
END
$proof$;
ROLLBACK;

-- وبعد الإلغاء: صفرُ أثر.
SELECT 'حجوزاتُ الإثبات الباقية' AS البند,
       (SELECT count(*)::text FROM public.bookings WHERE user_name = 'إثبات') AS القيمة;
