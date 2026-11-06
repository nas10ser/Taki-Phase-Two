-- ═══════════════════════════════════════════════════════════════════════════
-- v15.50 — بابُ الأدمن في حرّاس الطلبات والفواتير · وأرضيّةُ المهلة ساعةً
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 (أ) ثُلمةٌ أُثبتت بالتنفيذ، لا بالقراءة.
--   `tr_guard_booking_integrity` يُجمّد ٢٨ عموداً في الطلبات (الحالة · الدفع ·
--   الفاتورة · الاسترداد · الرمز) ضدّ كتابةِ العميل المباشرة. وفيه سطران:
--       IF current_user IN ('postgres','service_role','supabase_admin') …
--       IF public.is_admin() THEN RETURN NEW;      ← هذا هو الباب
--   و`is_admin()` تُرجع TRUE لأيّ أدمن حين لا يوجد إطارُ `admin_*` على مكدّس
--   النداء — وهي حالةُ **كلّ** كتابةٍ مباشرة على الجدول من المتصفّح (درسُ
--   v14.38، أُصلحت فيه ٦٤ سياسةَ RLS **ولم تُمسّ المشغّلات**).
--   والقياسُ على جدّة بجلسةٍ تنتحل الدورَ والمطالبات كما يفعل PostgREST:
--       current_user=authenticated · session_user=supabase_admin
--       is_admin() = t   ⇒   عمودٌ مجمَّد (`backup_code`) أُعيدت كتابتُه فعلاً
--   وصاحبُ الحساب الأدمنيّ يملك متجراً له **٦١ من ١١٥** حجزاً، و`bookings_update_auth`
--   تسمح لـ`uid = store_id` بالتحديث ⇒ `PATCH` واحد يختم طلباً «مكتملاً» بلا
--   كودٍ ولا مهلة، ويزوّر `completed_by`، ويغيّر `total_amount` و`paid_at`.
--   ومثلُه `tr_guard_store_billing` (الاشتراك · الحدود · حظرُ الإدارة · إقرارُ
--   طريقة الحساب · ومدى مهلة الحجز) — فيه البابُ **مرّتين**.
--
--   🪤 ولماذا الحذفُ آمن، مقيساً لا مُفترضاً: جُرد كلُّ كاتبٍ في الجدولين.
--      `bookings`: ٢٠ دالّة، **كلُّها SECURITY DEFINER** مملوكةٌ للخادم ⇒ يُعفيها
--      السطرُ الأوّل (`current_user`) أصلاً. و**صفرُ دالّةِ `admin_*`** تكتب فيه.
--      `store_profiles`: ٢٠ كاتباً، ١٩ منها DEFINER (ومنها كلُّ `admin_*`)،
--      والعشرون مشغّلٌ داخليّ. ⇒ لا تفقد لوحةُ المدير عملاً واحداً.
--
--   🪤 ويُعاد بناءُ الحارسين **من نصّهما الحيّ** (`pg_get_functiondef`) بحذفِ
--      الفرع وحده — لا من نسخةٍ في المستودع ولا بإعادة كتابةِ ٢٨ عموداً
--      و٢٠ شرطَ اشتراكٍ باليد. والنصُّ يُتحقَّق منه قبل التنفيذ وبعده.
--
-- 🔴 (ب) أمرُ ناصر: «في مدة الاستلام مكتوب من ربع ساعة إلى ٧٢ ساعة، ولكن أقلّ
--   مدّةٍ يضعها التاجر **ساعة**». والأرضيّةُ ٠٫٢٥ مكتوبةٌ في **خمسة** أجسامٍ حيّة
--   وفي أربعة مواضعَ في الكود — فتصير مصدراً واحداً `taki_booking_hold_min()`
--   يقرأ إعداداً يضبطه ناصر، كي لا يُطارَد الرقمُ في ستّة مواضعَ مرّةً أخرى.
--   وقِيس قبل الرفع: **صفرُ متجرٍ** تحت الساعة و**صفرُ حجزٍ قائم** مهلتُه أقصر
--   ⇒ لا ترقيةَ بياناتٍ ولا صفَّ يصير مخالفاً.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.tr_guard_booking_integrity()') IS NULL
     OR to_regprocedure('public.tr_guard_store_billing()') IS NULL THEN
    RAISE EXCEPTION 'أحدُ الحارسين غائب — أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_booking_hold_max()') IS NULL THEN
    RAISE EXCEPTION 'أساسُ مهلة الحجز غائب — أوقِفت.';
  END IF;
END
$guard$;

-- ── ١) الأرضيّةُ مصدرٌ واحد ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.taki_booking_hold_min()
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- أرضيّةُ مهلة الحجز. يضبطها ناصر، ولا تتجاوز السقفَ أبداً (وإلّا صار
  -- المدى مقلوباً فيُرفض كلُّ رقم)، ولا تنزل عن ربع ساعة تقنيّاً.
  SELECT GREATEST(0.25, LEAST(public.taki_booking_hold_max(), COALESCE(
    (SELECT NULLIF(value->>'min_hold_hours','')::numeric
       FROM public.platform_settings WHERE key = 'booking_holds' LIMIT 1), 1)));
$function$;

REVOKE ALL ON FUNCTION public.taki_booking_hold_min() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.taki_booking_hold_min() TO authenticated, service_role;

-- والإعدادُ يُدمج ولا يُدهس (فخُّ «الكاتبُ يستبدل لا يدمج»).
UPDATE public.platform_settings
   SET value = value || jsonb_build_object('min_hold_hours', 1)
 WHERE key = 'booking_holds'
   AND NOT (value ? 'min_hold_hours');

-- ── ٢) الأرضيّةُ تُقرأ لا تُكتب — في الدوالّ الثلاث ────────────────────────
CREATE OR REPLACE FUNCTION public.taki_booking_hold_hours(p_fulfillment text)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT GREATEST(
    public.taki_booking_hold_min(),         -- v15.50: الأرضيّة إعدادٌ لا ثابت
    LEAST(
      8760,                                 -- ولا أطول من سنة
      COALESCE(
        (SELECT CASE WHEN COALESCE(p_fulfillment,'pickup') = 'delivery'
                     THEN (value->>'delivery_hours')::numeric
                     ELSE (value->>'pickup_hours')::numeric END
           FROM public.platform_settings WHERE key = 'booking_holds' LIMIT 1),
        CASE WHEN COALESCE(p_fulfillment,'pickup') = 'delivery' THEN 6 ELSE 2 END
      )
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.taki_booking_hold_hours(p_fulfillment text, p_store_id text)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    -- استثناءُ التاجر، مقصوصاً بين الأرضيّة وسقف المنصّة
    (SELECT GREATEST(public.taki_booking_hold_min(), LEAST(public.taki_booking_hold_max(),
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

CREATE OR REPLACE FUNCTION public.taki_booking_hold_max()
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- 🪤 ولا تنادي هذه `taki_booking_hold_min()`: الأخيرةُ تناديها، فالعكسُ دور.
  SELECT GREATEST(0.25, LEAST(8760, COALESCE(
    (SELECT NULLIF(value->>'max_hold_hours','')::numeric
       FROM public.platform_settings WHERE key = 'booking_holds' LIMIT 1), 72)));
$function$;

-- ── ٣) بوّابةُ التاجر: الرفضُ يُسمّي الأرضيّةَ الحقيقيّة ───────────────────
CREATE OR REPLACE FUNCTION public.merchant_set_booking_holds(p_pickup numeric, p_delivery numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me  text := (SELECT auth.uid()::text);
  v_max numeric := public.taki_booking_hold_max();
  v_min numeric := public.taki_booking_hold_min();
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
  -- 🔴 v15.50 — والأرضيّةُ تُقرأ (`taki_booking_hold_min`) فتُعيدها الرسالةُ
  --    صادقةً: كانت تقول `min: 0.25` نصّاً، فبدّلَها ناصرٌ إلى ساعةٍ وكذبت.
  v_p := p_pickup; v_d := p_delivery;
  IF v_p IS NOT NULL AND (v_p < v_min OR v_p > v_max) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PICKUP_OUT_OF_RANGE', 'min', v_min, 'max', v_max);
  END IF;
  IF v_d IS NOT NULL AND (v_d < v_min OR v_d > v_max) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DELIVERY_OUT_OF_RANGE', 'min', v_min, 'max', v_max);
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
    'hold_min_hours',       v_min,
    'hold_max_hours',       v_max);
END
$function$;

-- ── ٤) وسياسةُ المتجر تُعلن الأرضيّة فلا تُخمّنها الواجهة ──────────────────
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
    -- v15.50 — الأرضيّةُ تصل الواجهةَ كما يصل السقف، فلا رقمَ مكتوبٌ فيها.
    'hold_min_hours',       public.taki_booking_hold_min(),
    'hold_max_hours',       public.taki_booking_hold_max())
    FROM (SELECT 1) z
    LEFT JOIN public.store_profiles sp ON sp.store_id = p_store_id;
$function$;

-- ── ٥) إغلاقُ بابِ الأدمن — إعادةُ بناءٍ من النصّ الحيّ ────────────────────
DO $rebuild$
DECLARE
  v_src  text;
  v_out  text;
  v_hits int;
BEGIN
  -- ============ (أ) حارسُ نزاهة الطلبات ============
  SELECT pg_get_functiondef('public.tr_guard_booking_integrity()'::regprocedure) INTO v_src;

  -- يُتحقَّق من وجود الفرع **قبل** الحذف: استبدالٌ على نصٍّ غائب لا يُخطئ،
  -- فيبدو الإصلاحُ واقعاً وهو لم يقع (فخُّ «كسرةٌ لا تُحقن أصلاً»).
  v_hits := (length(v_src) - length(replace(v_src, 'public.is_admin()', ''))) / length('public.is_admin()');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION '❌ توقّعتُ بابَ أدمنٍ واحداً في tr_guard_booking_integrity فوجدتُ % — أوقِفت', v_hits;
  END IF;
  IF position('backup_code' IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ النصُّ الحيُّ لا يحوي backup_code — لستُ أقرأ الحارسَ الصحيح';
  END IF;

  v_out := regexp_replace(v_src,
    '\s*IF\s+public\.is_admin\(\)\s+THEN\s+RETURN\s+NEW;\s*END\s+IF;', '', 'g');

  IF position('is_admin' IN v_out) > 0 THEN
    RAISE EXCEPTION '❌ بقي is_admin بعد الحذف — النمطُ لم يُطابق الشكلَ الحيّ';
  END IF;
  IF position('backup_code' IN v_out) = 0
     OR position('completed_by' IN v_out) = 0
     OR position('total_amount' IN v_out) = 0
     OR position($$current_user IN ('postgres', 'service_role', 'supabase_admin')$$ IN v_out) = 0 THEN
    RAISE EXCEPTION '❌ الحذفُ أصاب ما لم يُقصد — أعمدةٌ أو إعفاءُ الخادم فُقدت';
  END IF;
  EXECUTE v_out;

  -- ============ (ب) حارسُ الاشتراك والحدود ومدى المهلة ============
  SELECT pg_get_functiondef('public.tr_guard_store_billing()'::regprocedure) INTO v_src;

  v_hits := (length(v_src) - length(replace(v_src, 'public.is_admin()', ''))) / length('public.is_admin()');
  IF v_hits <> 2 THEN
    RAISE EXCEPTION '❌ توقّعتُ بابَي أدمنٍ في tr_guard_store_billing فوجدتُ % — أوقِفت', v_hits;
  END IF;
  IF position('subscription_plan' IN v_src) = 0 OR position('hold_pickup_hours' IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ النصُّ الحيُّ لا يحوي شروطَ الاشتراك والمهلة — لستُ أقرأ الحارسَ الصحيح';
  END IF;

  -- البابُ الأوّل داخل شرطِ مدى المهلة، والثاني فرعٌ مستقلّ. ومعهما تُبدَّل
  -- الأرضيّةُ ٠٫٢٥ بالدالّة — فالحارسُ والبوّابةُ يقولان نفسَ الرقم دائماً.
  v_out := replace(v_src,
    $$IF NOT (current_user IN ('postgres', 'service_role', 'supabase_admin') OR public.is_admin()) THEN$$,
    $$IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN$$);
  v_out := regexp_replace(v_out,
    '\s*IF\s+public\.is_admin\(\)\s+THEN\s+RETURN\s+NEW;\s*END\s+IF;', '', 'g');
  v_out := replace(v_out, '< 0.25 OR', '< public.taki_booking_hold_min() OR');

  IF position('is_admin' IN v_out) > 0 THEN
    RAISE EXCEPTION '❌ بقي is_admin في tr_guard_store_billing بعد الحذف';
  END IF;
  -- 🪤 بلا تجريدِ التعليق يتّهم هذا الفحصُ تعليقاً يشرح الرقمَ القديم.
  IF position('0.25' IN regexp_replace(v_out, '--[^' || chr(10) || ']*', '', 'g')) > 0 THEN
    RAISE EXCEPTION '❌ بقيت أرضيّةٌ ٠٫٢٥ مكتوبةً في جسم الحارس';
  END IF;
  IF position('subscription_plan' IN v_out) = 0
     OR position('delivery_blocked_by_admin' IN v_out) = 0
     OR position('accepts_cod' IN v_out) = 0
     OR position('taki_booking_hold_max()' IN v_out) = 0
     OR position('taki_booking_hold_min()' IN v_out) = 0 THEN
    RAISE EXCEPTION '❌ الحذفُ أصاب ما لم يُقصد في tr_guard_store_billing';
  END IF;
  EXECUTE v_out;
END
$rebuild$;

-- ═══════════════════════════════════════════════════════════════════════════
-- تحقّقٌ سلوكيّ — يُنفَّذ فعلاً بدورٍ ومطالباتٍ كما يصل PostgREST، ثمّ يُلفظ
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 ولا يُثبَت حارسٌ كهذا من جلسة `psql` العادية إطلاقاً: `current_user` فيها
--    `supabase_admin` فيُعفيه السطرُ الأوّل قبل أن يبلغ ما نفحصه (درسُ v14.96،
--    مرّ فيه اختبارٌ كاذباً مرّتين). فيُبدَّل الدورُ وتُحقن المطالبات.
-- 🪤 ولا يُدرَج حجزٌ ولا يُختم طلبٌ: `taki_invoice_seq` لا يرجع بالإرجاع
--    فيثقب تسلسلَ الفواتير ثقباً دائماً. فالعمودُ المُختبَر `backup_code` —
--    مجمَّدٌ بنفس القائمة، وبلا أيّ أثرٍ دوريّ.
DO $behave$
DECLARE
  v_adm  text; v_bc text; v_before text; v_after text;
  v_sel  text; v_res jsonb; v_sealed boolean;
BEGIN
  BEGIN
    SELECT id INTO v_adm FROM public.users WHERE user_type='admin' AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_sel FROM public.users WHERE user_type='seller' AND deleted_at IS NULL LIMIT 1;
    SELECT b.barcode, b.backup_code INTO v_bc, v_before
      FROM public.bookings b JOIN public.users u ON u.id = b.store_id
     WHERE u.user_type='admin' LIMIT 1;
    IF v_adm IS NULL OR v_bc IS NULL OR v_sel IS NULL THEN
      RAISE EXCEPTION '❌ لا بياناتٍ كافيةً للتحقّق — ولم يُجرَ (وهذا فشل)';
    END IF;

    -- ── (١) الأرضيّة ──────────────────────────────────────────────────────
    IF public.taki_booking_hold_min() <> 1 THEN
      RAISE EXCEPTION '❌ الأرضيّةُ ليست ساعةً بل %', public.taki_booking_hold_min();
    END IF;
    IF public.taki_booking_hold_hours('pickup') < 1
       OR public.taki_booking_hold_hours('delivery') < 1 THEN
      RAISE EXCEPTION '❌ مهلةٌ فعّالةٌ أقلُّ من ساعة';
    END IF;
    IF NOT (public.store_policies(v_sel) ? 'hold_min_hours') THEN
      RAISE EXCEPTION '❌ سياسةُ المتجر لا تُعلن الأرضيّة';
    END IF;

    -- ── (٢) جلسةُ عميلٍ أدمن: البابُ يجب أن يكون مسدوداً ─────────────────
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    IF current_user <> 'authenticated' THEN
      RAISE EXCEPTION '❌ لم يُبدَّل الدور — الاختبارُ لم يبلغ الحارس';
    END IF;
    -- وشرطُ وصولٍ مُثبِت: لو كان `is_admin()` كاذباً هنا لمرّ الاختبارُ لسببٍ خاطئ.
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION '❌ is_admin() كاذبةٌ في جلسة الاختبار — فالنجاحُ لا يُثبت إغلاقَ الباب';
    END IF;

    v_sealed := false;
    BEGIN
      UPDATE public.bookings SET backup_code = backup_code || 'Z' WHERE barcode = v_bc;
      SELECT backup_code INTO v_after FROM public.bookings WHERE barcode = v_bc;
      IF v_after IS DISTINCT FROM v_before THEN
        RAISE EXCEPTION '❌ البابُ ما زال مفتوحاً: عمودٌ مجمَّد أُعيدت كتابتُه من جلسةِ أدمن';
      END IF;
      RAISE EXCEPTION '❌ لم يُرفض التحديثُ ولم يتغيّر الصفّ — نتيجةٌ ملتبسة، تُعدّ فشلاً';
    EXCEPTION
      WHEN insufficient_privilege THEN v_sealed := true;
    END;
    IF NOT v_sealed THEN
      RAISE EXCEPTION '❌ لم يُردّ بـ42501 — الحارسُ ليس هو الرادّ';
    END IF;

    -- ── (٣) ومدى المهلة يُفرض على التاجر بالأرضيّة الجديدة ───────────────
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_sel, 'role', 'authenticated')::text, true);
    v_res := public.merchant_set_booking_holds(0.5, NULL);
    IF (v_res->>'error') IS DISTINCT FROM 'PICKUP_OUT_OF_RANGE' THEN
      RAISE EXCEPTION '❌ نصفُ ساعةٍ قُبلت من التاجر: %', v_res::text;
    END IF;
    IF (v_res->>'min')::numeric <> 1 THEN
      RAISE EXCEPTION '❌ رسالةُ الرفض تقول أرضيّةً %، والحقيقةُ ١', v_res->>'min';
    END IF;
    -- وساعةٌ كاملة تُقبل (حالةٌ موجبة — بلا هذا يمرّ حارسٌ يرفض كلَّ شيء)
    v_res := public.merchant_set_booking_holds(1, NULL);
    IF (v_res->>'ok') IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION '❌ الساعةُ نفسُها مرفوضة: %', v_res::text;
    END IF;

    -- ── (٤) والحارسُ يرفض نفسَ القيمة عبر الكتابة المباشرة ───────────────
    v_sealed := false;
    BEGIN
      UPDATE public.store_profiles SET hold_pickup_hours = 0.5 WHERE store_id = v_sel;
      RAISE EXCEPTION '❌ كتابةٌ مباشرةٌ دون الأرضيّة لم تُرفض';
    EXCEPTION
      WHEN insufficient_privilege THEN v_sealed := true;
    END;
    IF NOT v_sealed THEN
      RAISE EXCEPTION '❌ الحارسُ لا يفرض الأرضيّةَ على الكتابة المباشرة';
    END IF;

    RESET ROLE;
    RAISE EXCEPTION 'TAKI_V1550_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'TAKI_V1550_ROLLBACK' THEN RAISE; END IF;
  END;
END
$behave$;

-- ── جدولُ القراءة (لا يُفشل شيئاً — الإفشالُ أعلاه) ────────────────────────
SELECT 'الخادم' AS "البند", COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'جدة — الإنتاج') AS "القيمة"
UNION ALL SELECT 'بابُ الأدمن في حارسَي الطلبات والفواتير',
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public'
                AND p.proname IN ('tr_guard_booking_integrity','tr_guard_store_billing')
                AND pg_get_functiondef(p.oid) LIKE '%is_admin%') = 0
       THEN '✅ مسدود' ELSE '❌ ما زال' END
UNION ALL SELECT 'إعفاءُ الخادم باقٍ في كليهما',
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public'
                AND p.proname IN ('tr_guard_booking_integrity','tr_guard_store_billing')
                AND pg_get_functiondef(p.oid) LIKE '%supabase_admin%') = 2
       THEN '✅' ELSE '❌' END
UNION ALL SELECT 'المشغّلاتُ الثلاثة مفعَّلة',
  (SELECT count(*)::text FROM pg_trigger
    WHERE tgname IN ('tr_ab_guard_booking_integrity',
                     'tr_guard_store_billing_ins', 'tr_guard_store_billing_upd')
      AND NOT tgisinternal AND tgenabled = 'O') || ' / 3'
UNION ALL SELECT 'الأرضيّة / السقف',
  public.taki_booking_hold_min()::text || ' / ' || public.taki_booking_hold_max()::text
UNION ALL SELECT 'صفرُ أرضيّةٍ مكتوبةٍ في الدوالّ الخمس',
  -- 🪤 يُجرَّد التعليقُ قبل الفحص: أوّلُ تشغيلٍ لهذا السطر اتّهم دالّةً سليمة
  --    لأن تعليقَها يذكر الرقمَ القديم. (فخٌّ موثَّق، وقع للمرّة الخامسة.)
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.prokind='f'
                AND p.proname IN ('taki_booking_hold_hours','merchant_set_booking_holds',
                                  'tr_guard_store_billing')
                AND regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g')
                    LIKE '%0.25%') = 0
       THEN '✅' ELSE '❌' END
UNION ALL SELECT 'متاجرُ أو حجوزاتٌ صارت مخالفة',
  (SELECT count(*)::text FROM public.store_profiles
    WHERE (hold_pickup_hours IS NOT NULL AND hold_pickup_hours < public.taki_booking_hold_min())
       OR (hold_delivery_hours IS NOT NULL AND hold_delivery_hours < public.taki_booking_hold_min()))
  || ' متجراً';
