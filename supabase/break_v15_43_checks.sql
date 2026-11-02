-- ═══════════════════════════════════════════════════════════════════════════
-- كسرُ حرّاس v15.43 — هل تفشل فعلاً، وللسبب المقصود؟
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 كلُّ كسرةٍ تُثبَت **وقوعاً** قبل أن تُقرأ نتيجتُها.
-- 🪤 والنسختان مستخرجتان **آلياً** من كتلتَي `DO $verify$` و`DO $behave$` في
--    ملفّ الهجرة، وتُشغَّلان على القاعدة السليمة أوّلاً — فلا تنحرفان.
-- 🪤 وعلامةُ فشل **الهيكل** `BTBUG` منفصلةٌ عن علامة فشل **الفحص** (❌):
--    خلطُهما يجعل الهيكلَ يُعيد رفعَ نجاحِ الفحص فيبدو الفحصُ عاجزاً وهو سليم
--    (وقعت في v15.42 قبل ساعات).
-- كلُّ كسرةٍ في معاملةٍ تُرجَع: صفرُ أثرٍ على الإنتاج.
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

CREATE FUNCTION pg_temp.v43_verify() RETURNS void LANGUAGE plpgsql AS $vf$
DECLARE
  nude text := '--[^' || chr(10) || ']*';
  src_t text; src_r text;
BEGIN
  src_t := regexp_replace(pg_get_functiondef('public.tr_ad_set_booking_hold()'::regprocedure), nude, '', 'g');
  src_r := regexp_replace(pg_get_functiondef('public.store_policies(text)'::regprocedure), nude, '', 'g');

  IF position('NEW.store_id' IN src_t) = 0 THEN
    RAISE EXCEPTION '❌ المشغّل لا يسأل عن متجر الحجز — المهلةُ ما زالت واحدةً للمنصّة';
  END IF;
  IF position('taki_booking_hold_hours' IN src_r) = 0 THEN
    RAISE EXCEPTION '❌ store_policies لا تُعيد المهلةَ الفعّالة — الواجهةُ ستحسبها بنفسها فتنحرف';
  END IF;
  IF to_regprocedure('public.taki_booking_hold_hours(text)') IS NULL THEN
    RAISE EXCEPTION '❌ نسخةُ المعامل الواحد سقطت — أيُّ منادٍ قديمٍ سينكسر';
  END IF;
  IF has_function_privilege('anon','public.merchant_set_booking_holds(numeric,numeric)','EXECUTE') THEN
    RAISE EXCEPTION '❌ الزائرُ يملك ضبطَ مهلة أيّ متجر';
  END IF;
  IF NOT has_function_privilege('anon','public.store_policies(text)','EXECUTE') THEN
    RAISE EXCEPTION '❌ الزائرُ لا يقرأ المهلة — ولا بدّ أن يراها قبل الحجز';
  END IF;
  IF public.taki_booking_hold_max() <> 72 THEN
    RAISE EXCEPTION '❌ سقفُ المنصّة % لا ٧٢', public.taki_booking_hold_max();
  END IF;
END
$vf$;

CREATE FUNCTION pg_temp.v43_behave() RETURNS void LANGUAGE plpgsql AS $bh$
DECLARE
  v_deal text; v_store text; v_buyer text;
  v_now  bigint := (EXTRACT(EPOCH FROM NOW())*1000)::bigint;
  v_bc   text;
  v_hold numeric;
  v_got  numeric;
  v_plat numeric := public.taki_booking_hold_hours('pickup');
  v_keep bigint;
  v_res  jsonb;
BEGIN
  SELECT d.id, d.store_id INTO v_deal, v_store
    FROM public.deals d
   WHERE d.status = 'active' AND COALESCE(d.quantity,0) > 2
     AND COALESCE((public.store_can_sell(d.store_id)->>'ok')::boolean,false)
   ORDER BY d.quantity DESC LIMIT 1;
  IF v_deal IS NULL THEN
    RAISE EXCEPTION '❌ لا عرضَ صالحاً للاختبار السلوكيّ — لا يُعتمد فحصٌ نصّيٌّ وحده';
  END IF;
  SELECT u.id INTO v_buyer FROM public.users u
   WHERE u.id <> v_store AND u.deleted_at IS NULL ORDER BY u.created_at LIMIT 1;
  IF v_buyer IS NULL THEN RAISE EXCEPTION '❌ لا مشتريَ للاختبار السلوكيّ'; END IF;

  BEGIN
    -- (أ) بلا استثناء ⇒ مهلةُ المنصّة
    v_bc := '96' || lpad(((random()*99999999)::bigint)::text, 8, '7');
    INSERT INTO public.bookings (barcode, backup_code, deal_id, user_id, store_id,
                                 booked_quantity, status, booked_at, fulfillment, source, payment_method)
    VALUES (v_bc, v_bc, v_deal, v_buyer, v_store, 1, 'pending', v_now, 'pickup', 'web', 'card');
    SELECT (expiry_time - booked_at)/3600000.0 INTO v_got FROM public.bookings WHERE barcode = v_bc;
    IF v_got IS DISTINCT FROM v_plat THEN
      RAISE EXCEPTION '❌ بلا استثناء: المهلةُ المطبَّقة % والمتوقّع % (افتراض المنصّة)', v_got, v_plat;
    END IF;
    SELECT expiry_time INTO v_keep FROM public.bookings WHERE barcode = v_bc;

    -- (ب) باستثناءٍ للمتجر ⇒ مهلةُ المتجر — وهذا هو كلُّ الإصدار
    v_hold := CASE WHEN v_plat = 5 THEN 7 ELSE 5 END;   -- رقمٌ يختلف عن المنصّة يقيناً
    INSERT INTO public.store_profiles (store_id, hold_pickup_hours)
    VALUES (v_store, v_hold)
    ON CONFLICT (store_id) DO UPDATE SET hold_pickup_hours = EXCLUDED.hold_pickup_hours;
    IF public.taki_booking_hold_hours('pickup', v_store) <> v_hold THEN
      RAISE EXCEPTION '❌ المُحكّم لا يرى استثناءَ المتجر';
    END IF;
    v_bc := '95' || lpad(((random()*99999999)::bigint)::text, 8, '7');
    INSERT INTO public.bookings (barcode, backup_code, deal_id, user_id, store_id,
                                 booked_quantity, status, booked_at, fulfillment, source, payment_method)
    VALUES (v_bc, v_bc, v_deal, v_buyer, v_store, 1, 'pending', v_now, 'pickup', 'web', 'card');
    SELECT (expiry_time - booked_at)/3600000.0 INTO v_got FROM public.bookings WHERE barcode = v_bc;
    IF v_got IS DISTINCT FROM v_hold THEN
      RAISE EXCEPTION '❌ باستثناء %: المهلةُ المطبَّقة % — الاستثناءُ لا يسري على الحجز', v_hold, v_got;
    END IF;

    -- (ج) والتوصيلُ لم يتبدّل معه: عمودان لا عمود
    IF public.taki_booking_hold_hours('delivery', v_store)
       <> public.taki_booking_hold_hours('delivery') THEN
      RAISE EXCEPTION '❌ استثناءُ الاستلام سرى على التوصيل أيضاً — خلطُ عمودين';
    END IF;

    -- (د) والحجزُ القائم بقي على وعده
    IF (SELECT expiry_time FROM public.bookings WHERE barcode LIKE '96%' LIMIT 1) IS DISTINCT FROM v_keep THEN
      RAISE EXCEPTION '❌ تغيّرت مهلةُ حجزٍ قائم بعد ضبط التاجر — وهذا نقضُ وعدٍ للمشتري';
    END IF;

    -- (هـ) السقفُ يُرفض صريحاً لا يُقصّ بصمت
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_store, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_store, true);
    v_res := public.merchant_set_booking_holds(public.taki_booking_hold_max() + 1, NULL);
    IF COALESCE((v_res->>'ok')::boolean, true) OR v_res->>'error' <> 'PICKUP_OUT_OF_RANGE' THEN
      RAISE EXCEPTION '❌ قُبلت مهلةٌ فوق السقف: %', v_res::text;
    END IF;

    -- (و) والضبطُ السليم يقع ويُقرأ
    v_res := public.merchant_set_booking_holds(1.5, 3);
    IF NOT COALESCE((v_res->>'ok')::boolean, false)
       OR (v_res->>'hold_pickup_hours')::numeric <> 1.5
       OR (v_res->>'hold_delivery_hours')::numeric <> 3 THEN
      RAISE EXCEPTION '❌ الضبطُ السليم لم يقع: %', v_res::text;
    END IF;
    IF (public.store_policies(v_store)->>'hold_pickup_hours')::numeric <> 1.5 THEN
      RAISE EXCEPTION '❌ قراءةُ الزائر لا ترى مهلةَ المتجر';
    END IF;

    -- (ز) و«اتبع المنصّة» يُعاد بالعدم
    v_res := public.merchant_set_booking_holds(NULL, NULL);
    IF (v_res ? 'hold_pickup_custom') AND v_res->>'hold_pickup_custom' IS NOT NULL THEN
      RAISE EXCEPTION '❌ العدمُ لم يُعِد المتجرَ إلى افتراض المنصّة: %', v_res::text;
    END IF;
    IF (public.store_policies(v_store)->>'hold_pickup_hours')::numeric <> v_plat THEN
      RAISE EXCEPTION '❌ بعد الإرجاع لم تعد المهلةُ إلى افتراض المنصّة';
    END IF;

    PERFORM set_config('request.jwt.claims', NULL, true);
    PERFORM set_config('request.jwt.claim.sub', NULL, true);
    RAISE EXCEPTION 'TAKI_V1543_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM set_config('request.jwt.claims', NULL, true);
      PERFORM set_config('request.jwt.claim.sub', NULL, true);
      IF SQLERRM <> 'TAKI_V1543_ROLLBACK' THEN RAISE; END IF;
  END;
END
$bh$;

DO $t$ BEGIN
  PERFORM pg_temp.v43_verify();
  PERFORM pg_temp.v43_behave();
  RAISE NOTICE '✅ ٠) النسختان تمرّان على القاعدة السليمة';
END $t$;

-- ═══ كسرة 1: المشغّل يعود لمهلةٍ واحدةٍ للمنصّة ═══
BEGIN;
DO $b$
DECLARE src text; broke text;
BEGIN
  src := pg_get_functiondef('public.tr_ad_set_booking_hold()'::regprocedure);
  broke := replace(src, ', NEW.store_id)', ')');
  IF broke = src THEN RAISE EXCEPTION 'BTBUG: الكسرةُ لم تُحقن'; END IF;
  EXECUTE broke;
  IF position('NEW.store_id' IN pg_get_functiondef('public.tr_ad_set_booking_hold()'::regprocedure)) > 0
     THEN RAISE EXCEPTION 'BTBUG: الكسرةُ لم تسرِ'; END IF;
  BEGIN
    PERFORM pg_temp.v43_verify();
    PERFORM pg_temp.v43_behave();
    RAISE EXCEPTION 'BTBUG: كسرة 1 لم يُسقطها أيُّ فحص';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'BTBUG%' THEN RAISE; END IF;
    RAISE NOTICE '✅ 1) المشغّل يعود لمهلةٍ واحدةٍ للمنصّة ⇒ سقطت بـ«%»', SQLERRM;
  END;
END $b$;
ROLLBACK;

-- ═══ كسرة 2: المُحكّم يتجاهل استثناءَ المتجر (الأسماءُ باقية) ═══
BEGIN;
DO $b$
DECLARE src text; broke text;
BEGIN
  src := pg_get_functiondef('public.taki_booking_hold_hours(text,text)'::regprocedure);
  broke := replace(src, 'WHERE sp.store_id = p_store_id', 'WHERE sp.store_id = p_store_id || ''zz''');
  IF broke = src THEN RAISE EXCEPTION 'BTBUG: الكسرةُ لم تُحقن'; END IF;
  EXECUTE broke;
  IF position('p_store_id || ''zz''' IN pg_get_functiondef('public.taki_booking_hold_hours(text,text)'::regprocedure)) = 0
     THEN RAISE EXCEPTION 'BTBUG: الكسرةُ لم تسرِ'; END IF;
  BEGIN
    PERFORM pg_temp.v43_behave();
    RAISE EXCEPTION 'BTBUG: كسرة 2 لم يُسقطها أيُّ فحص';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'BTBUG%' THEN RAISE; END IF;
    RAISE NOTICE '✅ 2) المُحكّم يتجاهل استثناءَ المتجر (الأسماءُ باقية) ⇒ سقطت بـ«%»', SQLERRM;
  END;
END $b$;
ROLLBACK;

-- ═══ كسرة 3: قراءةُ الزائر لا تُعيد المهلةَ الفعّالة ═══
BEGIN;
DO $b$
DECLARE src text; broke text;
BEGIN
  EXECUTE $x$CREATE OR REPLACE FUNCTION public.store_policies(p_store_id text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $y$
    SELECT jsonb_build_object('refund_policy', sp.refund_policy) FROM public.store_profiles sp
     WHERE sp.store_id = p_store_id; $y$;$x$;
  IF position('taki_booking_hold_hours' IN pg_get_functiondef('public.store_policies(text)'::regprocedure)) > 0
     THEN RAISE EXCEPTION 'BTBUG: الكسرةُ لم تسرِ'; END IF;
  BEGIN
    PERFORM pg_temp.v43_verify();
    RAISE EXCEPTION 'BTBUG: كسرة 3 لم يُسقطها أيُّ فحص';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'BTBUG%' THEN RAISE; END IF;
    RAISE NOTICE '✅ 3) قراءةُ الزائر لا تُعيد المهلةَ الفعّالة ⇒ سقطت بـ«%»', SQLERRM;
  END;
END $b$;
ROLLBACK;

-- ═══ كسرة 4: الزائرُ يُمنح ضبطَ مهلة أيّ متجر ═══
BEGIN;
DO $b$
DECLARE src text; broke text;
BEGIN
  GRANT EXECUTE ON FUNCTION public.merchant_set_booking_holds(numeric,numeric) TO anon;
  IF NOT has_function_privilege('anon','public.merchant_set_booking_holds(numeric,numeric)','EXECUTE')
     THEN RAISE EXCEPTION 'BTBUG: المنحُ لم يسرِ'; END IF;
  BEGIN
    PERFORM pg_temp.v43_verify();
    RAISE EXCEPTION 'BTBUG: كسرة 4 لم يُسقطها أيُّ فحص';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'BTBUG%' THEN RAISE; END IF;
    RAISE NOTICE '✅ 4) الزائرُ يُمنح ضبطَ مهلة أيّ متجر ⇒ سقطت بـ«%»', SQLERRM;
  END;
END $b$;
ROLLBACK;

-- ═══ كسرة 5: السقفُ يُقصّ بصمتٍ بدل أن يُرفض ═══
BEGIN;
DO $b$
DECLARE src text; broke text;
BEGIN
  src := pg_get_functiondef('public.merchant_set_booking_holds(numeric,numeric)'::regprocedure);
  broke := replace(src, 'RETURN jsonb_build_object(''ok'', false, ''error'', ''PICKUP_OUT_OF_RANGE'', ''min'', 0.25, ''max'', v_max);',
                        'v_p := LEAST(v_max, GREATEST(0.25, v_p));');
  IF broke = src THEN RAISE EXCEPTION 'BTBUG: الكسرةُ لم تُحقن'; END IF;
  EXECUTE broke;
  IF position('PICKUP_OUT_OF_RANGE' IN pg_get_functiondef('public.merchant_set_booking_holds(numeric,numeric)'::regprocedure)) > 0
     THEN RAISE EXCEPTION 'BTBUG: الكسرةُ لم تسرِ'; END IF;
  BEGIN
    PERFORM pg_temp.v43_behave();
    RAISE EXCEPTION 'BTBUG: كسرة 5 لم يُسقطها أيُّ فحص';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'BTBUG%' THEN RAISE; END IF;
    RAISE NOTICE '✅ 5) السقفُ يُقصّ بصمتٍ بدل أن يُرفض ⇒ سقطت بـ«%»', SQLERRM;
  END;
END $b$;
ROLLBACK;

-- ═══ كسرة 6: استثناءُ الاستلام يسري على التوصيل (خلطُ عمودين) ═══
BEGIN;
DO $b$
DECLARE src text; broke text;
BEGIN
  src := pg_get_functiondef('public.taki_booking_hold_hours(text,text)'::regprocedure);
  broke := replace(src, 'THEN sp.hold_delivery_hours ELSE sp.hold_pickup_hours END', 'THEN sp.hold_pickup_hours ELSE sp.hold_pickup_hours END');
  IF broke = src THEN RAISE EXCEPTION 'BTBUG: الكسرةُ لم تُحقن'; END IF;
  EXECUTE broke;
  IF position('hold_delivery_hours' IN pg_get_functiondef('public.taki_booking_hold_hours(text,text)'::regprocedure)) > 0
     THEN RAISE EXCEPTION 'BTBUG: الكسرةُ لم تسرِ'; END IF;
  BEGIN
    PERFORM pg_temp.v43_behave();
    RAISE EXCEPTION 'BTBUG: كسرة 6 لم يُسقطها أيُّ فحص';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'BTBUG%' THEN RAISE; END IF;
    RAISE NOTICE '✅ 6) استثناءُ الاستلام يسري على التوصيل (خلطُ عمودين) ⇒ سقطت بـ«%»', SQLERRM;
  END;
END $b$;
ROLLBACK;

-- ═══ كسرة ٧: المشغّلُ يفرض المهلةَ على UPDATE أيضاً — وحارسُ الهجرة يرفض ═══
-- 🔴 وهذا أخطرُ ما في الإصدار: لو فُرضت المهلةُ على التعديل، لتبدّلت مهلةُ
--    كلِّ حجزٍ قائمٍ لحظةَ ضبط التاجر — نقضُ وعدٍ قيل للمشتري.
BEGIN;
DO $b$
BEGIN
  CREATE TRIGGER tr_ad_set_booking_hold_bad BEFORE UPDATE ON public.bookings
    FOR EACH ROW EXECUTE FUNCTION public.tr_ad_set_booking_hold();
  ALTER TRIGGER tr_ad_set_booking_hold ON public.bookings RENAME TO tr_ad_keep;
  ALTER TRIGGER tr_ad_set_booking_hold_bad ON public.bookings RENAME TO tr_ad_set_booking_hold;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.bookings'::regclass
                   AND tgname='tr_ad_set_booking_hold'
                   AND pg_get_triggerdef(oid) LIKE '%BEFORE UPDATE ON%') THEN
    RAISE EXCEPTION 'BTBUG: الكسرةُ لم تسرِ';
  END IF;
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.bookings'::regclass
                 AND tgname='tr_ad_set_booking_hold'
                 AND pg_get_triggerdef(oid) NOT LIKE '%BEFORE INSERT ON%') THEN
      RAISE EXCEPTION 'مشغّلُ المهلة لم يبقَ BEFORE INSERT — الحجوزاتُ القائمة في خطر. أوقِفت.';
    END IF;
    RAISE EXCEPTION 'BTBUG: حارسُ الهجرة لم يرَ المشغّلَ المكسور';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'BTBUG%' THEN RAISE; END IF;
    RAISE NOTICE '✅ ٧) مشغّلٌ على UPDATE ⇒ حارسُ الهجرة يرفض بـ«%»', SQLERRM;
  END;
END $b$;
ROLLBACK;

-- ── القاعدةُ سليمةٌ بعد كلّ شيء ─────────────────────────────────────────────
DO $t$ BEGIN
  PERFORM pg_temp.v43_verify();
  PERFORM pg_temp.v43_behave();
  RAISE NOTICE '════════ ٧/٧ كسرات كسرت · والقاعدةُ سليمة ✅ ════════';
END $t$;

-- 🪤 ويُضيَّق نمطُ الفحص: `LIKE '95%'` أمسك حجزاً حقيقياً من ١٩ مايو
--    (`952JW2KC` — الرموزُ كانت أبجدية قبل v15.00) فبدا أثراً باقياً وليس كذلك.
--    أرقامُ الإثبات عشرُ خاناتٍ كلُّها أرقام وتنتهي بسبعاتٍ من الحشو.
SELECT 'متاجرُ لها استثناء بعد كلّ الكسر' AS "البند",
       (SELECT count(*)::text FROM public.store_profiles
         WHERE hold_pickup_hours IS NOT NULL OR hold_delivery_hours IS NOT NULL) AS "القيمة"
UNION ALL SELECT 'طلباتُ الإثبات الباقية',
       (SELECT count(*)::text FROM public.bookings
         WHERE barcode ~ '^9[5-8][0-9]{8}$');
