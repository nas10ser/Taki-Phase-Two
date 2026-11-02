-- ═══════════════════════════════════════════════════════════════════════════
-- إثباتُ v15.42 — سلوكيٌّ على جدّة، كلُّه داخل معاملةٍ تُرجَع (ROLLBACK)
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 لم يكن في القاعدة طلبٌ حيٌّ واحد (قِيس: صفر `pending`/`acknowledged`)،
--    فالإثباتُ يصنع طلبَه ثم يمحوه. و`tr_guard_booking_integrity` يُعفي
--    `supabase_admin` فيُمكن تعديلُ `booked_at` — وهو ما يُشيخ الطلبَ دقائقَ
--    بلا انتظارٍ حقيقيّ.
-- 🪤 والانتحالُ بـ`request.jwt.claims` وحدها تكفي: دوالُّ الصلاحية تسأل
--    `auth.uid()` لا الدور، والدوالُّ DEFINER تتجاوز RLS أصلاً (درس v14.96:
--    جلسةُ psql «نظام» فلا يُثبت بها حارسٌ يسأل `session_user` — وهذه تسأل
--    `auth.uid()` فتُنتحَل بصدق).
-- 🪤 و`payment_method='card'` إلزاميّة: متجرُ ناصر لا يقبل النقد
--    (`TAKI_STORE_CARD_ONLY` — حارسُ v14.08/v15.33)، فطلبٌ بلا طريقةِ دفعٍ
--    يُرفض عند الباب فلا يبلغ ما نفحصه. وهذا ثالثُ حارسٍ يردُّ ملفَّ إثبات —
--    وكلُّها تعمل كما صُمّمت.
-- 🪤 ويُتحقَّق من **الأثر** لا من غياب الخطأ (درس v15.33): كلُّ نجاحٍ يُقرأ
--    من الصفّ بعده (`status` و`completed_by`).
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
BEGIN;

DO $proof$
DECLARE
  v_deal   text := '1793442128481';
  v_buyer  text := '1d38446e-a7c7-488a-b356-ced05acf358e';
  v_store  text := '2c0b4cde-79c3-4290-abaa-812a895b1bcb';
  v_bc1    text := '9100000001';
  v_bc2    text := '9100000002';
  v_now    bigint := (EXTRACT(EPOCH FROM NOW())*1000)::bigint;
  v_det    text;
  v_code   text;
  v_status text;
  v_by     text;
  v_min    numeric := public.taki_self_close_minutes();
BEGIN
  IF v_min <> 10 THEN
    RAISE EXCEPTION 'المهلةُ المضبوطة % لا ١٠ — الإثباتُ مبنيٌّ على عشر دقائق', v_min;
  END IF;

  -- ── طلبان جديدان، لحظةُ حجزهما الآن ────────────────────────────────────
  INSERT INTO public.bookings (barcode, backup_code, deal_id, user_id, store_id,
                               booked_quantity, status, booked_at, fulfillment, source, payment_method)
  VALUES (v_bc1, '9100000011', v_deal, v_buyer, v_store, 1, 'pending', v_now, 'pickup', 'web', 'card'),
         (v_bc2, '9100000012', v_deal, v_buyer, v_store, 1, 'pending', v_now, 'pickup', 'web', 'card');

  -- ═══ ١) المشتري: الزرُّ مرفوضٌ في الدقيقة الأولى ═══════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role','authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_buyer, true);

  BEGIN
    PERFORM public.buyer_confirm_receipt(v_bc1);
    RAISE EXCEPTION '❌ قُبل الختمُ الذاتيّ لحظةَ الحجز — المهلةُ لا تحرس';
  EXCEPTION WHEN SQLSTATE 'P0028' THEN
    GET STACKED DIAGNOSTICS v_det = PG_EXCEPTION_DETAIL;
    IF v_det::integer NOT BETWEEN 595 AND 600 THEN
      RAISE EXCEPTION '❌ المتبقّي % ثانية — المتوقّع ≈٦٠٠', v_det;
    END IF;
    RAISE NOTICE '✅ ١) رُفض بـP0028 والمتبقّي % ثانية', v_det;
  END;

  -- والطلبُ ما زال حيّاً — الرفضُ لم يُغيّر شيئاً
  SELECT status INTO v_status FROM public.bookings WHERE barcode = v_bc1;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION '❌ الحالةُ صارت % بعد رفضٍ — الرفضُ كتب', v_status;
  END IF;

  -- ═══ ٢) الثُّلمة سُدّت: المشتري لا يختم طلبه بنداءٍ مباشر ══════════════
  BEGIN
    PERFORM public.complete_booking(v_bc1);
    RAISE EXCEPTION '❌ المشتري ختم طلبه عبر complete_booking — الثُّلمةُ قائمة';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    RAISE NOTICE '✅ ٢) complete_booking رفضت المشتري بـP0002';
  END;

  -- ═══ ٣) بعد عشر دقائق: يُقبل، ويُقرأ الأثر من الصفّ ════════════════════
  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM set_config('request.jwt.claim.sub', NULL, true);
  UPDATE public.bookings SET booked_at = v_now - 11*60000 WHERE barcode = v_bc1;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role','authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_buyer, true);
  PERFORM public.buyer_confirm_receipt(v_bc1);

  SELECT status, completed_by INTO v_status, v_by FROM public.bookings WHERE barcode = v_bc1;
  IF v_status <> 'completed' OR v_by <> 'buyer' THEN
    RAISE EXCEPTION '❌ بعد المهلة: الحالة % والخاتم % — لم يقع الأثر', v_status, v_by;
  END IF;
  RAISE NOTICE '✅ ٣) بعد المهلة ختم المشتري الطلب فعلاً (status=% · by=%)', v_status, v_by;

  -- ═══ ٤) اختصارُ التاجر: مرفوضٌ مبكّراً، مقبولٌ بعد المهلة ══════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_store, 'role','authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_store, true);

  BEGIN
    PERFORM public.merchant_handover_booking(v_bc2);
    RAISE EXCEPTION '❌ اختصارُ التاجر عمل لحظةَ الحجز — المهلةُ لا تحرس';
  EXCEPTION WHEN SQLSTATE 'P0028' THEN
    RAISE NOTICE '✅ ٤أ) اختصارُ التاجر رُفض بـP0028 مبكّراً';
  END;

  -- ومسارُ الكود يعمل الآن بلا أيّ انتظار — هذا شرطُ عدم إيذاء الواقف بالصندوق
  PERFORM public.complete_booking(v_bc2);
  SELECT status INTO v_status FROM public.bookings WHERE barcode = v_bc2;
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION '❌ مسارُ الكود للتاجر لم يختم الطلب (status=%)', v_status;
  END IF;
  RAISE NOTICE '✅ ٤ب) مسارُ الكود للتاجر فوريٌّ بلا مهلة (status=%)', v_status;

  -- ═══ ٥) اختصارُ التاجر بعد المهلة — على طلبٍ ثالث ══════════════════════
  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM set_config('request.jwt.claim.sub', NULL, true);
  INSERT INTO public.bookings (barcode, backup_code, deal_id, user_id, store_id,
                               booked_quantity, status, booked_at, fulfillment, source, payment_method)
  VALUES ('9100000003', '9100000013', v_deal, v_buyer, v_store, 1, 'pending',
          v_now - 11*60000, 'pickup', 'web', 'card');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_store, 'role','authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_store, true);
  PERFORM public.merchant_handover_booking('9100000003');
  SELECT status, completed_by INTO v_status, v_by FROM public.bookings WHERE barcode = '9100000003';
  IF v_status <> 'completed' OR v_by <> 'seller' THEN
    RAISE EXCEPTION '❌ اختصارُ التاجر بعد المهلة: status=% by=%', v_status, v_by;
  END IF;
  RAISE NOTICE '✅ ٥) اختصارُ التاجر بعد المهلة ختم الطلب (status=% · by=%)', v_status, v_by;

  -- ═══ ٦) الاختصارُ ليس للمشتري ══════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', NULL, true);
  INSERT INTO public.bookings (barcode, backup_code, deal_id, user_id, store_id,
                               booked_quantity, status, booked_at, fulfillment, source, payment_method)
  VALUES ('9100000004', '9100000014', v_deal, v_buyer, v_store, 1, 'pending',
          v_now - 11*60000, 'pickup', 'web', 'card');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role','authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_buyer, true);
  BEGIN
    PERFORM public.merchant_handover_booking('9100000004');
    RAISE EXCEPTION '❌ المشتري نادى اختصارَ التاجر بنجاح';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    RAISE NOTICE '✅ ٦) الاختصارُ رفض المشتري بـP0002';
  END;

  -- ═══ ٧) مهلةُ صفرٍ تُعطّل الحارس (قيمةٌ صالحة، لا عطل) ═════════════════
  PERFORM set_config('request.jwt.claims', NULL, true);
  UPDATE public.platform_settings
     SET value = value || jsonb_build_object('self_close_minutes', 0)
   WHERE key = 'booking_holds';
  IF public.taki_self_close_minutes() <> 0 THEN
    RAISE EXCEPTION '❌ ضبطُ الصفر لم يصل الدالّة';
  END IF;
  INSERT INTO public.bookings (barcode, backup_code, deal_id, user_id, store_id,
                               booked_quantity, status, booked_at, fulfillment, source, payment_method)
  -- 🪤 ومشترياً آخر: حدُّ «٤ حجوزاتٍ في الدقيقة لكلّ مستخدم» (v13.15) يسقط
  --    الإثباتَ نفسَه عند الطلب الخامس — وهو حارسٌ سليم، فالإثباتُ يتأقلم.
  VALUES ('9100000005', '9100000015', v_deal, v_store, v_store, 1, 'pending', v_now, 'pickup', 'web', 'card');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_store, 'role','authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_store, true);
  PERFORM public.buyer_confirm_receipt('9100000005');
  SELECT status INTO v_status FROM public.bookings WHERE barcode = '9100000005';
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION '❌ مهلةُ الصفر ما زالت تحجب (status=%)', v_status;
  END IF;
  RAISE NOTICE '✅ ٧) مهلةُ صفر ⇒ الختمُ فوريّ — الرقمُ يُضبط فعلاً لا يُزيَّن';

  RAISE NOTICE '════════ الإثباتُ السلوكيّ: ٧/٧ ✅ ════════';
END
$proof$;

ROLLBACK;

-- ── الأثرُ صفر: لا طلبَ ولا ضبطَ بقي ───────────────────────────────────────
SELECT 'طلباتُ الإثبات الباقية' AS "البند",
       (SELECT count(*)::text FROM public.bookings WHERE barcode LIKE '91000000%') AS "القيمة"
UNION ALL
SELECT 'مهلةُ الختم الذاتيّ بعد الإرجاع', public.taki_self_close_minutes()::text;
