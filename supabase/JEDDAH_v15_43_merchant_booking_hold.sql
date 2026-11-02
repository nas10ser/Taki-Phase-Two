-- ═══════════════════════════════════════════════════════════════════════════
-- v15.43 — مهلةُ الحجز بيد التاجر، لا بيد ناصر
-- ═══════════════════════════════════════════════════════════════════════════
-- أمرُ ناصر: «اجعل التاجر هو من يحدّد مدّة الحجز في النظام وليس أنا. مثال:
-- أنا حدّدت ساعتين للحجز والاستلام — اجعل التاجر هو من يحدّد مدّة الحجز
-- والاستلام كم، كما في الصورة» (بطاقةُ «⏳ مهلة الحجز» في لوحة المدير).
--
-- والعلّةُ عمليّة: مخبزٌ يريد نصفَ ساعة (الخبزُ يبرد)، ومعرضُ أثاثٍ يريد
-- يومين (العميلُ يأتي بسيّارة نقل). ورقمٌ واحدٌ للمنصّة كلّها يُظلم الاثنين،
-- وناصرٌ ليس طرفاً في تلك المفاضلة أصلاً — صاحبُ البضاعة هو من يعرف.
--
-- 🪤 والمنصّةُ تبقى سقفاً لا حاكماً: `max_hold_hours` (٧٢ افتراضاً) أقصى ما
--    يملك التاجرُ اختيارَه — فمهلةُ سنةٍ تُجمّد مخزوناً مباعاً وتُفرّغ العرض.
--    والأرضيّةُ ربعُ ساعة كما كانت.
-- 🪤 و`NULL` تعني «اتبع افتراضَ المنصّة» لا «صفر». ولذلك عمودان قابلان
--    للعدم لا عمودان بافتراضٍ مكتوب: التاجرُ الذي لم يختر يتحرّك مع ضبط
--    ناصر، والذي اختار يبقى على اختياره. (درس v15.33: الصفرُ قيمةٌ صالحة
--    والفراغُ معنىً آخر — فلا يُخلطان.)
-- 🔴 والحجوزاتُ القائمة تبقى على ما وُعدت به: `tr_ad_set_booking_hold`
--    مشغّلُ `BEFORE INSERT` **وحده** (قِيس: `pg_get_triggerdef`)، فلا يُعاد
--    حسابُ `expiry_time` لصفٍّ قائم أبداً — ولا حاجة لشرطٍ إضافيّ.
-- 🪤 والرقمُ يُعرض قبل الحجز في الموقع والبوتين، فـ`store_policies` (الممنوحة
--    للزائر أصلاً) تُعيد **المهلةَ الفعّالة محسوبةً** لا الاستثناءَ الخام —
--    فلا تُعاد كتابةُ سلسلة الارتداد في أربع واجهات تنحرف.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
     = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_booking_hold_hours(text)') IS NULL
     OR to_regprocedure('public.store_policies(text)') IS NULL THEN
    RAISE EXCEPTION 'أساسُ v14.10/v14.18 غائب — أوقِفت.';
  END IF;
  -- والمشغّلُ يجب أن يبقى BEFORE INSERT وحده، وإلّا دهس التعديلُ وعدَ الحجز.
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.bookings'::regclass
               AND tgname='tr_ad_set_booking_hold'
               AND pg_get_triggerdef(oid) NOT LIKE '%BEFORE INSERT ON%') THEN
    RAISE EXCEPTION 'مشغّلُ المهلة لم يبقَ BEFORE INSERT — الحجوزاتُ القائمة في خطر. أوقِفت.';
  END IF;
END
$guard$;

-- ── ١) عمودان في ملفّ المتجر: العدمُ يعني «اتبع المنصّة» ────────────────────
ALTER TABLE public.store_profiles
  ADD COLUMN IF NOT EXISTS hold_pickup_hours   numeric,
  ADD COLUMN IF NOT EXISTS hold_delivery_hours numeric;

ALTER TABLE public.store_profiles DROP CONSTRAINT IF EXISTS store_profiles_hold_sane_chk;
ALTER TABLE public.store_profiles ADD CONSTRAINT store_profiles_hold_sane_chk CHECK (
  (hold_pickup_hours   IS NULL OR (hold_pickup_hours   >= 0.25 AND hold_pickup_hours   <= 8760)) AND
  (hold_delivery_hours IS NULL OR (hold_delivery_hours >= 0.25 AND hold_delivery_hours <= 8760))
);

-- ── ٢) سقفُ المنصّة: حقلٌ خامس في نفس المفتاح (لا فخَّ المواضع الثلاثة) ─────
UPDATE public.platform_settings
   SET value = value || jsonb_build_object('max_hold_hours', 72)
 WHERE key = 'booking_holds'
   AND NOT (value ? 'max_hold_hours');

CREATE OR REPLACE FUNCTION public.taki_booking_hold_max()
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT GREATEST(0.25, LEAST(8760, COALESCE(
    (SELECT NULLIF(value->>'max_hold_hours','')::numeric
       FROM public.platform_settings WHERE key = 'booking_holds' LIMIT 1), 72)));
$function$;

REVOKE ALL ON FUNCTION public.taki_booking_hold_max() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_booking_hold_max() FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_booking_hold_max() TO authenticated, service_role;

-- ── ٣) المُحكّم: استثناءُ المتجر ← افتراضُ المنصّة ← افتراضُ الكود ──────────
-- 🪤 واستثناءُ التاجر وحده يُقصّ بسقف المنصّة. أمّا رقمُ ناصر فيبقى كما ضبطه
--    (حتى ٨٧٦٠): قصُّه بسقفٍ يضبطه هو نفسُه يعني إعداداً يدهس إعداداً — ووعداً
--    لا يفهم المرءُ لمَ لم يسرِ.
CREATE OR REPLACE FUNCTION public.taki_booking_hold_hours(p_fulfillment text, p_store_id text)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    -- استثناءُ التاجر، مقصوصاً بين الأرضيّة وسقف المنصّة
    (SELECT GREATEST(0.25, LEAST(public.taki_booking_hold_max(),
              CASE WHEN COALESCE(p_fulfillment,'pickup') = 'delivery'
                   THEN sp.hold_delivery_hours ELSE sp.hold_pickup_hours END))
       FROM public.store_profiles sp
      WHERE sp.store_id = p_store_id
        AND (CASE WHEN COALESCE(p_fulfillment,'pickup') = 'delivery'
                  THEN sp.hold_delivery_hours ELSE sp.hold_pickup_hours END) IS NOT NULL
      LIMIT 1),
    -- وإلّا افتراضُ المنصّة كما كان حرفاً بحرف
    public.taki_booking_hold_hours(p_fulfillment)
  );
$function$;

REVOKE ALL ON FUNCTION public.taki_booking_hold_hours(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_booking_hold_hours(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_booking_hold_hours(text, text) TO authenticated, service_role;

-- ── ٤) المشغّل يسأل عن متجرِ هذا الحجز ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tr_ad_set_booking_hold()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booked bigint;
BEGIN
  v_booked := COALESCE(NEW.booked_at, (EXTRACT(EPOCH FROM NOW())*1000)::bigint);
  NEW.booked_at   := v_booked;
  -- ⚠️ الدرس المدفوع (v12.07): لا تُقصّ المهلة إلى نهاية العرض إطلاقاً.
  -- v15.43 — والمهلةُ مهلةُ **هذا المتجر**: استثناؤه إن وُجد، وإلّا المنصّة.
  NEW.expiry_time := v_booked
    + (public.taki_booking_hold_hours(COALESCE(NEW.fulfillment,'pickup'), NEW.store_id) * 3600000)::bigint;
  RETURN NEW;
END;
$function$;

-- ── ٥) الزائرُ يقرأ المهلةَ الفعّالة قبل أن يحجز ───────────────────────────
-- 🪤 وبـ`LEFT JOIN` على صفٍّ واحد: الصيغةُ القديمة كانت تُعيد `NULL` **كلّياً**
--    لمتجرٍ بلا صفّ في `store_profiles` — فمهلتُه لن تصل الواجهةَ أبداً وهي
--    أهمُّ ما تحتاجه. والمهلةُ الفعّالة لا تكون عدماً أبداً.
-- 🪤 و`*_custom` هي الخامُ (عدمٌ = يتبع المنصّة) — تحتاجها شاشةُ التاجر
--    وحدها لتعرف أهو مختارٌ أم متبوع. ولا تُستعمل للعرض للمشتري.
CREATE OR REPLACE FUNCTION public.store_policies(p_store_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'refund_policy', NULLIF(btrim(COALESCE(sp.refund_policy, '')), ''),
    'store_terms',   NULLIF(btrim(COALESCE(sp.store_terms,   '')), '')))
    || jsonb_build_object(
    'hold_pickup_hours',    public.taki_booking_hold_hours('pickup',   p_store_id),
    'hold_delivery_hours',  public.taki_booking_hold_hours('delivery', p_store_id),
    'hold_pickup_custom',   sp.hold_pickup_hours,
    'hold_delivery_custom', sp.hold_delivery_hours,
    'hold_max_hours',       public.taki_booking_hold_max())
    FROM (SELECT 1) z
    LEFT JOIN public.store_profiles sp ON sp.store_id = p_store_id;
$function$;

REVOKE ALL ON FUNCTION public.store_policies(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_policies(text) TO anon, authenticated, service_role;

-- ── ٦) التاجر يضبط مهلته ────────────────────────────────────────────────────
-- 🪤 وتُثبَت الكتابةُ بقراءةٍ بعدها: «ok:true» بلا قراءةٍ وهمٌ (درس الخزنة
--    v14.44 — `UPDATE … WHERE` بصفر صفوفٍ لا يُخطئ، وv15.16 — `ok:true`
--    من `taki_set_on_hand` تعني أحياناً «لم أكتب»).
CREATE OR REPLACE FUNCTION public.merchant_set_booking_holds(p_pickup numeric, p_delivery numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me  text := (SELECT auth.uid()::text);
  v_max numeric := public.taki_booking_hold_max();
  v_p   numeric;
  v_d   numeric;
  v_rp  numeric;
  v_rd  numeric;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u
                  WHERE u.id = v_me AND u.user_type <> 'buyer' AND u.deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_A_MERCHANT');
  END IF;

  -- العدمُ يعني «اتبع المنصّة»؛ وما دون الأرضيّة أو فوق السقف يُرفض صريحاً
  -- لا يُقصّ بصمت: التاجرُ كتب رقماً، فتغييرُه تحت يده دون أن يُقال كذبٌ هادئ.
  v_p := p_pickup; v_d := p_delivery;
  IF v_p IS NOT NULL AND (v_p < 0.25 OR v_p > v_max) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PICKUP_OUT_OF_RANGE', 'min', 0.25, 'max', v_max);
  END IF;
  IF v_d IS NOT NULL AND (v_d < 0.25 OR v_d > v_max) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DELIVERY_OUT_OF_RANGE', 'min', 0.25, 'max', v_max);
  END IF;

  INSERT INTO public.store_profiles (store_id, hold_pickup_hours, hold_delivery_hours)
  VALUES (v_me, v_p, v_d)
  ON CONFLICT (store_id) DO UPDATE
    SET hold_pickup_hours   = EXCLUDED.hold_pickup_hours,
        hold_delivery_hours = EXCLUDED.hold_delivery_hours,
        updated_at          = now();

  SELECT sp.hold_pickup_hours, sp.hold_delivery_hours INTO v_rp, v_rd
    FROM public.store_profiles sp WHERE sp.store_id = v_me;
  IF v_rp IS DISTINCT FROM v_p OR v_rd IS DISTINCT FROM v_d THEN
    RETURN jsonb_build_object('ok', false, 'error', 'WRITE_NOT_CONFIRMED');
  END IF;

  RETURN jsonb_build_object('ok', true,
    'hold_pickup_custom',   v_rp,
    'hold_delivery_custom', v_rd,
    'hold_pickup_hours',    public.taki_booking_hold_hours('pickup',   v_me),
    'hold_delivery_hours',  public.taki_booking_hold_hours('delivery', v_me),
    'hold_max_hours',       v_max);
END
$function$;

REVOKE ALL ON FUNCTION public.merchant_set_booking_holds(numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_set_booking_holds(numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_set_booking_holds(numeric, numeric) TO authenticated, service_role;

-- ── تحقّقٌ بنيويّ يُفشل الهجرة إن كذبت ─────────────────────────────────────
-- 🪤 يُجرَّد التعليقُ قبل أيّ فحصِ نصّ (درس v15.40 · v15.22 · v14.97).
DO $verify$
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
$verify$;

-- ── تحقّقٌ **سلوكيّ**: الأثرُ يقع فعلاً، ويُرجَع بعده ──────────────────────
-- 🔴 والفحصُ النصّيّ أعلاه لا يكفي — أُثبت ذلك قبل ساعاتٍ في v15.42: كسرةٌ
--    تُبقي الأسماءَ مكتوبةً وتُبطل الحارسَ تمرّ على كلّ فحصٍ نصّيّ. فالحكمُ
--    هنا: طلبٌ يُصنع ويُقاس `expiry_time - booked_at` ثم يُمحى.
DO $behave$
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
$behave$;

-- ── جدولٌ للقراءة (الإفشالُ أعلاه) ─────────────────────────────────────────
SELECT 'الخادم' AS "البند", current_setting('server_version') AS "القيمة"
UNION ALL SELECT 'المختبر؟', COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'(لا وسم)')
UNION ALL SELECT 'صفّ الإعدادات', (SELECT value::text FROM public.platform_settings WHERE key='booking_holds')
UNION ALL SELECT 'سقفُ المنصّة (ساعة)', public.taki_booking_hold_max()::text
UNION ALL SELECT 'عمودا المتجر', (SELECT count(*)::text FROM information_schema.columns
   WHERE table_schema='public' AND table_name='store_profiles'
     AND column_name IN ('hold_pickup_hours','hold_delivery_hours')) || '/2'
UNION ALL SELECT 'المشغّل يسأل عن المتجر', CASE WHEN position('NEW.store_id' IN pg_get_functiondef('public.tr_ad_set_booking_hold()'::regprocedure))>0 THEN '✅' ELSE '❌' END
UNION ALL SELECT 'الزائر يقرأ المهلة', CASE WHEN has_function_privilege('anon','public.store_policies(text)','EXECUTE') THEN '✅' ELSE '❌' END
UNION ALL SELECT 'متاجرُ لها استثناء', (SELECT count(*)::text FROM public.store_profiles
   WHERE hold_pickup_hours IS NOT NULL OR hold_delivery_hours IS NOT NULL);
