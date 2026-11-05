-- ═══════════════════════════════════════════════════════════════════════════
-- v15.46 — ثلاثةُ أعمدةٍ فاتت حارسَ ملفّ المتجر
-- ═══════════════════════════════════════════════════════════════════════════
-- كُشفت أثناء الفحص المستقلّ لإصدارات ٤٢–٤٤، وهي **أقدمُ منها** — لا علاقةَ
-- لها بها، لكنّها ظهرت لأن الفحصَ سأل: «ما الذي يملك التاجرُ كتابتَه بيده؟».
--
-- 🪤 وأوّلُ قياسٍ عندي كان **خاطئاً**، وأقولُه كما وقع: جرّبتُ الهجومَ بحساب
--    متجر ناصر فمرّ، فاستنتجتُ «أيُّ تاجرٍ يمنح نفسَه اشتراكاً». والسببُ أن
--    ذلك الحساب **أدمن**، وبابُ الأدمن في `tr_guard_store_billing` أعفاه
--    بحقّ. وبإعادة القياس على تاجرٍ حقيقيّ (`user_type='seller'`) ظهر أن
--    الاشتراكَ والحدودَ محروسةٌ منذ v13.41 — **وأن ما بقي مفتوحاً أضيقُ بكثير**
--    ممّا ظننتُ أوّلاً، ولا شيءَ فيه يمنح اشتراكاً ولا يرفع إيقافاً:
--
--   ١) `delivery_block_reason` و`delivery_blocked_at` — سجلُّ الإدارة على
--      صفّه: يُعيد كتابةَ السبب ويمحو وقتَ الحظر. (أمّا رفعُ الحظر نفسِه
--      فمحروسٌ منذ قبلُ بـ`taki_guard_delivery_block` — قِيس وتأكّد.)
--   ٢) 🔴 `payment_declared_at` — يُزوَّر فيُفتح البيعُ لمتجرٍ لم يُعلن كيف
--      يُحاسِب، وهي بالضبط البوّابةُ التي بُنيت في v14.08 لسدّها.
--      ومعه `accepts_cod` فيختلف إقرارُه عن المعروض للمشتري.
--   ٣) `hold_pickup_hours` / `hold_delivery_hours` — `merchant_set_booking_holds`
--      ترفض ما فوق سقف المنصّة، و`PATCH` مباشرٌ يكتبه: يُخزَّن ٨٧٦٠ ويُطبَّق ٧٢
--      (الدالّةُ تقصّ بـLEAST) فتكذب بطاقةُ التاجر عليه. أثرٌ على الشاشة لا
--      على الحجز — ولذلك هو الأخفُّ من الثلاثة.
--
-- 🪤 والعلاجُ **توسيعُ الحارس القائم** لا إضافةُ ثانٍ: حارسان على جدولٍ واحد
--    ينحرفان، وأحدُهما يُعفي ما يمنعه الآخر. ويُبنى من نصّه الحيّ.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
     = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.tr_guard_store_billing()') IS NULL
     OR to_regprocedure('public.taki_booking_hold_max()') IS NULL THEN
    RAISE EXCEPTION 'أساسُ v13.41/v15.43 غائب — أوقِفت.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.store_profiles'::regclass
                   AND NOT tgisinternal AND tgname LIKE '%billing%') THEN
    RAISE EXCEPTION 'مشغّلُ الحارس القائم غير مُركَّب — الأساسُ مختلف، أوقِفت.';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.tr_guard_store_billing()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_touches boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_touches :=
         NEW.subscription_plan       IS NOT NULL
      OR NEW.subscription_expires_at IS NOT NULL
      OR NEW.subscription_started_at IS NOT NULL
      OR NEW.subscription_amount     IS NOT NULL
      OR NEW.subscription_package_id IS NOT NULL
      OR NEW.max_branches            IS NOT NULL
      OR coalesce(NEW.discount_percentage, 0) <> 0
      OR coalesce(NEW.is_pinned, false)
      OR coalesce(NEW.is_suspended, false)
      OR NEW.custom_features IS NOT NULL
      OR NEW.admin_notes     IS NOT NULL
      -- v15.46 — أعمدةٌ فاتت الحارسَ الأصلي، وقِيس أنّ تاجراً غيرَ أدمن يكتبها:
      OR coalesce(NEW.delivery_blocked_by_admin, false)
      OR NEW.delivery_block_reason   IS NOT NULL
      OR NEW.delivery_blocked_at     IS NOT NULL
      OR NEW.payment_declared_at     IS NOT NULL
      OR NEW.subscription_canceled_at IS NOT NULL
      OR NEW.last_expiry_warning_at  IS NOT NULL;
  ELSE
    v_touches :=
         NEW.subscription_plan       IS DISTINCT FROM OLD.subscription_plan
      OR NEW.subscription_expires_at IS DISTINCT FROM OLD.subscription_expires_at
      OR NEW.subscription_started_at IS DISTINCT FROM OLD.subscription_started_at
      OR NEW.subscription_amount     IS DISTINCT FROM OLD.subscription_amount
      OR NEW.subscription_package_id IS DISTINCT FROM OLD.subscription_package_id
      OR NEW.max_branches            IS DISTINCT FROM OLD.max_branches
      OR NEW.discount_percentage     IS DISTINCT FROM OLD.discount_percentage
      OR NEW.is_pinned               IS DISTINCT FROM OLD.is_pinned
      OR NEW.is_suspended            IS DISTINCT FROM OLD.is_suspended
      OR NEW.custom_features         IS DISTINCT FROM OLD.custom_features
      OR NEW.admin_notes             IS DISTINCT FROM OLD.admin_notes
      -- 🔴 v15.46 — الأخطرُ فيها الأوّل: الإدارةُ تحظر توصيلَ متجرٍ لسبب،
      --    والمتجرُ كان يرفع الحظرَ عن نفسه بـPATCH واحد. وقِيس على جدّة.
      OR NEW.delivery_blocked_by_admin IS DISTINCT FROM OLD.delivery_blocked_by_admin
      OR NEW.delivery_block_reason   IS DISTINCT FROM OLD.delivery_block_reason
      OR NEW.delivery_blocked_at     IS DISTINCT FROM OLD.delivery_blocked_at
      -- وتزويرُ الإقرار يفتح البيعَ لمتجرٍ لم يقل كيف يُحاسِب (بوّابةُ v14.08)
      OR NEW.payment_declared_at     IS DISTINCT FROM OLD.payment_declared_at
      OR NEW.accepts_cod             IS DISTINCT FROM OLD.accepts_cod
      OR NEW.subscription_canceled_at IS DISTINCT FROM OLD.subscription_canceled_at
      OR NEW.last_expiry_warning_at  IS DISTINCT FROM OLD.last_expiry_warning_at;
  END IF;

  -- v15.46 — ومدى مهلة الحجز يُفحص لكلّ كتابةٍ من المتجر نفسه: كانت
  -- `merchant_set_booking_holds` ترفض ما فوق السقف و`PATCH` مباشرٌ يكتبه،
  -- فيُخزَّن ٨٧٦٠ ويُطبَّق ٧٢ وتكذب بطاقةُ التاجر عليه. (قِيس على جدّة.)
  IF NOT (current_user IN ('postgres', 'service_role', 'supabase_admin') OR public.is_admin()) THEN
    IF NEW.hold_pickup_hours IS NOT NULL
       AND (NEW.hold_pickup_hours < 0.25 OR NEW.hold_pickup_hours > public.taki_booking_hold_max()) THEN
      RAISE EXCEPTION 'forbidden: pickup hold outside the allowed range'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.hold_delivery_hours IS NOT NULL
       AND (NEW.hold_delivery_hours < 0.25 OR NEW.hold_delivery_hours > public.taki_booking_hold_max()) THEN
      RAISE EXCEPTION 'forbidden: delivery hold outside the allowed range'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NOT v_touches THEN
    RETURN NEW;   -- ordinary profile edits (bio, phone, VAT number…) pass through
  END IF;

  -- The activation RPC, admin RPCs, pg_cron renewals and the service role all
  -- run as the owner; the merchant's own session does not.
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'forbidden: subscription, limit, admin-block and declaration fields are not self-editable'
    USING ERRCODE = '42501';
END;
$function$;

-- ── وعيبٌ ثانٍ كشفه الفحص: صفرُ المهلة كان يعني أطولَ انتظار ──────────────
-- 🔴 مِن عملي أنا في v15.44. والمديرُ يقرأ «٠ = بلا مهلة» فيضبطها صفراً،
--    فيصير الزرُّ لا يُفتح إلا قبل انتهاء المهلة بدقيقة. وأسوأُ منه أن توأمَي
--    الموقع والبوت يُرجعان «مفتوح» عند الصفر — فالشاشةُ تعرض الزرَّ والخادمُ
--    يرفضه، وهو ما بُني كلُّ هذا على منعه.
CREATE OR REPLACE FUNCTION public.taki_self_close_opens_at(p_booking bookings)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- 🔴 والسقفُ الخارجيّ ليس تجميلاً: بلا `LEAST` كان فرعُ «أُكِّد» ينفجر.
  --    مهلةُ ١٥ دقيقة (أرضيّةُ v15.43) + تأكيدٌ بعد ٦ ⇒ فتحةٌ عند +١٦ ومهلةٌ
  --    تنتهي عند +١٥ ⇒ **نافذةٌ خالية**، ثمّ يُلغى الطلب. وقِيس أن ٩٫١٪ من
  --    التأكيدات تقع بعد خمس دقائق — فليست حالةً نادرة. ومثلُه أدمنيّاً:
  --    `self_close_minutes` يقبل حتى ١٤٤٠ دقيقة، فرقمٌ كبير كان يُقفل الميزةَ
  --    على المنصّة كلّها بلا أن يقول أحدٌ شيئاً.
  -- ⇒ الزرُّ يُفتح دائماً قبل انتهاء المهلة بدقيقةٍ على الأقلّ، ولا يُفتح
  --   أبداً قبل مهلةِ الختم من لحظة الحجز.
  -- 🔴 v15.46 — صفرٌ يعني «بلا مهلة» لا «بلا إزاحة».
  --    بدون هذا السطر كان `ms = 0` يجعل الفرعَ الاحتياطيّ
  --    `GREATEST(booked+0, expiry-0)` = `expiry`، ثمّ يقصّه السقفُ إلى
  --    `expiry − دقيقة` — أي أن **ضبطَ المهلة على صفر يُنتج أطولَ انتظارٍ
  --    ممكن**، عكسَ ما يقرؤه المدير تماماً. وتوأماه في الموقع والبوت يُرجعان
  --    «مفتوح» عند الصفر، فكانت الشاشةُ تعرض الزرَّ والخادمُ يرفضه.
  SELECT CASE WHEN public.taki_self_close_minutes() <= 0
              THEN COALESCE(p_booking.booked_at, 0)
  ELSE LEAST(
    CASE
      WHEN p_booking.acknowledged_at IS NOT NULL
        THEN GREATEST(COALESCE(p_booking.booked_at, 0) + v.ms,
                      (EXTRACT(EPOCH FROM p_booking.acknowledged_at)*1000)::bigint + v.ms)
      WHEN p_booking.status = 'acknowledged'      -- صفٌّ أُكِّد قبل v15.44
        THEN COALESCE(p_booking.booked_at, 0) + v.ms
      ELSE GREATEST(COALESCE(p_booking.booked_at, 0) + v.ms,
                    COALESCE(p_booking.expiry_time, 0) - v.ms)
    END,
    COALESCE(NULLIF(p_booking.expiry_time, 0), 9223372036854775807) - 60000) END
  FROM (SELECT (public.taki_self_close_minutes() * 60000)::bigint AS ms) v;
$function$;

-- ── تحقّقٌ **سلوكيّ**: الهجومُ يُردّ، والمشروعُ يمرّ ───────────────────────
-- 🪤 ويُختار تاجرٌ **غيرُ أدمن** عمداً: متجر ناصر مملوكٌ لحساب أدمن، وبابُ
--    الأدمن يُعفيه بحقّ — وأوّلُ صيغةٍ لهذا الاختبار استعملته فبدا الحارسُ
--    عاجزاً وهو سليم. يُختبر الحارسُ على من يحرسه.
DO $behave$
DECLARE
  v_store text; v_before timestamptz; v_hold numeric; v_res jsonb; v_n int := 0;
BEGIN
  SELECT sp.store_id INTO v_store FROM public.store_profiles sp
    JOIN public.users u ON u.id = sp.store_id
   WHERE COALESCE(u.user_type,'') = 'seller' AND u.deleted_at IS NULL
   ORDER BY sp.store_id LIMIT 1;
  IF v_store IS NULL THEN
    RAISE EXCEPTION '❌ لا تاجرَ غيرَ أدمن للاختبار — الحارسُ سيُتخطّى بصمت';
  END IF;
  SELECT payment_declared_at INTO v_before FROM public.store_profiles WHERE store_id = v_store;

  BEGIN
    -- 🪤 تهيئةٌ لازمة: الحارسُ يقارن `IS DISTINCT FROM OLD`، فكتابةُ القيمة
    --    نفسِها ليست تغييراً ولا يُفترض أن تُردّ. وأوّلُ صيغةٍ لهذا الاختبار
    --    حاولت رفعَ حظرٍ **غيرِ مفروضٍ أصلاً** فمرّت بحقّ وبدا الحارسُ عاجزاً.
    --    فيُفرض الحظرُ أوّلاً (كنظام) ثمّ يُحاوَل رفعُه (كتاجر).
    UPDATE public.store_profiles
       SET delivery_blocked_by_admin = true,
           delivery_block_reason     = 'سببٌ للاختبار',
           delivery_blocked_at       = now(),
           payment_declared_at       = now(),
           subscription_canceled_at  = now()
     WHERE store_id = v_store;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_store, 'role', 'authenticated')::text, true);

    -- (أ–و) ستُّ محاولاتٍ كلُّها يجب أن تُردّ بـ42501
    -- 🪤 وكلُّ محاولةٍ تُغيّر القيمةَ فعلاً: الحارسُ يقارن `IS DISTINCT FROM OLD`،
    --    فكتابةُ القيمة نفسِها تمرّ بحقّ ولا تُثبت شيئاً. وأوّلُ قياسٍ عندي
    --    وقع في هذا بالضبط فأعطاني ستَّ «ثغرات» أكثرُها وهمٌ.
    FOR i IN 1..6 LOOP
      BEGIN
        SET LOCAL ROLE authenticated;
        CASE i
          WHEN 1 THEN UPDATE public.store_profiles SET delivery_block_reason = 'غيّرتُه' WHERE store_id = v_store;
          WHEN 2 THEN UPDATE public.store_profiles SET delivery_blocked_at = NULL WHERE store_id = v_store;
          WHEN 3 THEN UPDATE public.store_profiles SET payment_declared_at = now() + interval '1 day' WHERE store_id = v_store;
          WHEN 4 THEN UPDATE public.store_profiles SET accepts_cod = NOT COALESCE(accepts_cod,true) WHERE store_id = v_store;
          WHEN 5 THEN UPDATE public.store_profiles SET subscription_canceled_at = NULL WHERE store_id = v_store;
          WHEN 6 THEN UPDATE public.store_profiles SET hold_pickup_hours = 8760 WHERE store_id = v_store;
        END CASE;
        RESET ROLE;
        RAISE EXCEPTION '❌ مرّت المحاولةُ رقم % — الحارسُ لا يحرسها', i;
      EXCEPTION
        WHEN SQLSTATE '42501' THEN RESET ROLE; v_n := v_n + 1;
        WHEN OTHERS THEN RESET ROLE; RAISE;
      END;
    END LOOP;
    IF v_n <> 6 THEN RAISE EXCEPTION '❌ رُدّت % من ٦ فقط', v_n; END IF;

    -- (ز٠) ورفعُ الحظر نفسِه محروسٌ سلفاً بحارسٍ آخر — يُثبَت لا يُفترض
    BEGIN
      SET LOCAL ROLE authenticated;
      UPDATE public.store_profiles SET delivery_blocked_by_admin = false WHERE store_id = v_store;
      RESET ROLE;
      RAISE EXCEPTION '❌ رفع التاجرُ حظرَ التوصيل عن نفسه';
    EXCEPTION
      WHEN SQLSTATE '42501' THEN RESET ROLE;
      WHEN OTHERS THEN RESET ROLE;
        IF SQLERRM LIKE '%❌%' THEN RAISE; END IF;   -- أيُّ حارسٍ ردّه يكفي
    END;

    -- (ز) وما يملكه التاجرُ يبقى مفتوحاً — وإلّا كسرنا لوحتَه
    SET LOCAL ROLE authenticated;
    UPDATE public.store_profiles
       SET phone = '0500000000', refund_policy = 'سياسةٌ تجريبية',
           delivery_note = 'ملاحظة', hold_pickup_hours = 3
     WHERE store_id = v_store;
    RESET ROLE;
    SELECT hold_pickup_hours INTO v_hold FROM public.store_profiles WHERE store_id = v_store;
    IF v_hold IS DISTINCT FROM 3 THEN
      RAISE EXCEPTION '❌ مُنع التاجرُ من تعديل ما يملكه (مهلة=%)', v_hold;
    END IF;

    -- (ح) ودوالُّه المُعتمَدة تعمل كما كانت
    v_res := public.merchant_set_booking_holds(2, 4);
    IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
      RAISE EXCEPTION '❌ كُسرت merchant_set_booking_holds: %', v_res::text;
    END IF;
    IF public.merchant_set_payment_declaration(true) IS NULL THEN
      RAISE EXCEPTION '❌ كُسر إقرارُ طريقة الحساب';
    END IF;

    -- (ط) والنظامُ يكتب ما هو له
    PERFORM set_config('request.jwt.claims', NULL, true);
    UPDATE public.store_profiles SET subscription_canceled_at = NULL, admin_notes = 'نظام'
     WHERE store_id = v_store;
    IF (SELECT admin_notes FROM public.store_profiles WHERE store_id = v_store) <> 'نظام' THEN
      RAISE EXCEPTION '❌ مُنع النظامُ من كتابة حقولِه';
    END IF;

    -- (ي) وصفرُ المهلة يفتح الزرَّ فوراً، ولا يقلبه إلى أطولِ انتظار
    PERFORM set_config('request.jwt.claims', NULL, true);
    UPDATE public.platform_settings
       SET value = jsonb_set(value, '{self_close_minutes}', '0'::jsonb)
     WHERE key = 'booking_holds';
    IF (SELECT public.taki_self_close_opens_at(b) FROM public.bookings b
         WHERE b.expiry_time IS NOT NULL ORDER BY b.booked_at DESC LIMIT 1)
       > (SELECT b.booked_at FROM public.bookings b
           WHERE b.expiry_time IS NOT NULL ORDER BY b.booked_at DESC LIMIT 1) THEN
      RAISE EXCEPTION '❌ مهلةُ صفر ما زالت تؤجّل الفتح';
    END IF;

    RAISE EXCEPTION 'TAKI_V1546_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      BEGIN RESET ROLE; EXCEPTION WHEN OTHERS THEN NULL; END;
      PERFORM set_config('request.jwt.claims', NULL, true);
      IF SQLERRM <> 'TAKI_V1546_ROLLBACK' THEN RAISE; END IF;
  END;

  IF (SELECT payment_declared_at FROM public.store_profiles WHERE store_id = v_store) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION '❌ تسرّب تعديلٌ من الاختبار إلى الإنتاج';
  END IF;
END
$behave$;

-- ── جدولٌ للقراءة ─────────────────────────────────────────────────────────
SELECT 'الأعمدة المحروسة' AS "البند",
  (SELECT count(*)::text FROM (VALUES ('delivery_blocked_by_admin'),('delivery_block_reason'),
      ('delivery_blocked_at'),('payment_declared_at'),('accepts_cod'),('subscription_canceled_at'),
      ('last_expiry_warning_at')) c(col)
    WHERE position(c.col IN pg_get_functiondef('public.tr_guard_store_billing()'::regprocedure))>0)||'/7 جديدة' AS "القيمة"
UNION ALL SELECT 'مدى المهلة مفروضٌ على الكتابة المباشرة',
  CASE WHEN position('taki_booking_hold_max' IN pg_get_functiondef('public.tr_guard_store_billing()'::regprocedure))>0 THEN '✅' ELSE '❌' END
UNION ALL SELECT 'متاجرُ بمهلةٍ خارج المدى',
  (SELECT count(*)::text FROM public.store_profiles
    WHERE (hold_pickup_hours IS NOT NULL AND (hold_pickup_hours < 0.25 OR hold_pickup_hours > public.taki_booking_hold_max()))
       OR (hold_delivery_hours IS NOT NULL AND (hold_delivery_hours < 0.25 OR hold_delivery_hours > public.taki_booking_hold_max())));
