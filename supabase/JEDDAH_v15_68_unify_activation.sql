-- ═══════════════════════════════════════════════════════════════════════════
-- v15.68 — تفعيلُ الاشتراك: **موضعٌ واحدٌ لا ثلاثة**
-- ═══════════════════════════════════════════════════════════════════════════
-- بعد v15.67 صار منطقُ التفعيل في `_taki_apply_package`، ويناديه مسارُ الويب
-- ومسارُ المتجرين. وبقي **مسارُ البوت** بنسخته الخاصّة — فصارت ثلاثاً.
--
-- 🔴 والنسخُ لم تكن متطابقة. قِيس بقراءة النصّ الحيّ، فظهر انحرافان:
--   ١) **افتراضُ `active` معكوس**: البوتُ `COALESCE(…, true)` والويب
--      `COALESCE(…, false)`. أي أن باقةً ناقصةَ المفتاح **تُباع من البوت
--      وحده** — ميزةٌ تفشل مفتوحةً في مسار المال. (وكلُّ الباقات الثماني
--      الحيّة تحمل `active: true` صريحاً، فالتوحيدُ على `false` لا يُغيّر
--      شيئاً اليوم — وهذا قياسٌ لا تخمين.)
--   ٢) **ولا يكتب `subscription_package_id` إطلاقاً**: فتاجرٌ اشترك من
--      البوت لا باقةَ مسجَّلةً له، وتقاريرُ الباقات وشاشاتُها تقرأ عموداً
--      فارغاً بلا أن يشكو أحد.
--
-- ⇒ يُنادى الموضعُ الواحد، ويبقى **شكلُ الإرجاع كما هو حرفاً بحرف** لأن
--   البوتين يقرآن مفاتيحَه الثمانية (`plan_ar` · `max_branches` · `price` ·
--   `expires_at` · `days` · `vat` · `total` · `success`). وتغييرُ مفتاحٍ
--   واحدٍ يُصمت شاشةً في البوت بلا أيّ خطأ.
--
-- 🪤 والحرّاسُ تُنسخ حرفياً: `bot_payments_enabled` (مفتاحُ الإيقاف العامّ)
--    و`_bot_uid` (الهويّة — وهو حارسُ البوت الحقيقيّ لا `_bot_gate_ok` هنا)
--    و`_taki_sub_payment_ok` (الدفعة المؤكَّدة، v15.31). وإسقاطُ أحدها
--    سهواً يُعيد ثغرةً أُغلقت.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'')
     = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه قاعدةُ المختبر (طوكيو) — الهجرةُ لجدة وحدها.';
  END IF;
  IF to_regprocedure('public._taki_apply_package(text,integer)') IS NULL THEN
    RAISE EXCEPTION 'لم تُطبَّق هجرةُ v15.67 — الموضعُ الواحد غير موجود.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.bot_subscribe_plan(
  p_telegram_id bigint, p_package_id integer, p_whatsapp_id text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sid  text;
  v_dry  jsonb;
  v_res  jsonb;
  v_pkg  jsonb;
  v_vat  numeric;
BEGIN
  IF NOT public.bot_payments_enabled() THEN
    RETURN jsonb_build_object('success', false, 'error', 'free_mode');
  END IF;

  SELECT id INTO v_sid FROM users
   WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id)
     AND user_type IN ('seller','admin') AND deleted_at IS NULL LIMIT 1;
  IF v_sid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_seller');
  END IF;

  -- السعرُ والمدّةُ من **الموضع الواحد** — وهو الذي يفصل في `active` أيضاً.
  v_dry := public._taki_apply_package_dry(p_package_id);
  IF NOT COALESCE((v_dry->>'success')::boolean, false) THEN
    -- وتُترجَم رموزُه إلى مفردات البوت القائمة، فلا تنكسر شاشةٌ تقرأ رمزاً.
    RETURN jsonb_build_object('success', false, 'error',
      CASE v_dry->>'error'
        WHEN 'unknown_package'   THEN 'bad_package'
        WHEN 'package_inactive'  THEN 'bad_package'
        ELSE COALESCE(v_dry->>'error', 'bad_package')
      END);
  END IF;

  -- 🔴 v15.31: لا اشتراكَ مدفوعٌ بلا دفعةٍ مؤكَّدةٍ بمرجعٍ من بوّابة.
  IF NOT public._taki_sub_payment_ok(v_sid, p_package_id, (v_dry->>'net')::numeric) THEN
    RETURN jsonb_build_object('success', false, 'error', 'payment_not_confirmed');
  END IF;

  v_res := public._taki_apply_package(v_sid, p_package_id);
  IF NOT COALESCE((v_res->>'success')::boolean, false) THEN RETURN v_res; END IF;

  -- اسمُ الباقة من الكتالوج (البوتُ يعرضه نصّاً).
  SELECT pkg INTO v_pkg FROM public.platform_settings ps,
         LATERAL jsonb_array_elements(ps.value) AS pkg
   WHERE ps.key = 'location_packages' AND (pkg->>'id')::int = p_package_id LIMIT 1;

  -- والضريبةُ تُحسب كما كانت بالضبط (v13.36): فوق السعر، ولا تُحصَّل قبل
  -- تفعيلها من مركز التحكّم.
  SELECT CASE WHEN COALESCE((s.value->>'vat_enabled')::boolean, false)
               AND COALESCE((s.value->>'prices_include_vat')::boolean, true) = false
              THEN round((v_res->>'net')::numeric
                         * COALESCE(NULLIF(s.value->>'vat_rate','')::numeric, 15) / 100, 2)
              ELSE 0 END
    INTO v_vat
    FROM (SELECT value FROM public.platform_settings WHERE key = 'tax_settings'
          UNION ALL SELECT '{}'::jsonb LIMIT 1) s;

  RETURN jsonb_build_object(
    'success', true,
    'plan_ar', v_pkg->>'ar',
    'max_branches', (v_res->>'max_branches')::int,
    'price', (v_res->>'net')::numeric,
    'expires_at', v_res->>'expires_at',
    'days', (v_res->>'days')::int,
    'vat', v_vat,
    'total', round((v_res->>'net')::numeric + v_vat, 2));
END $function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- التحقّق — سلوكيٌّ ويرفع، وداخل معاملةٍ تُلفى (الاختبارُ يُفعّل على تاجرٍ حقيقيّ)
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  v_tg    bigint;
  v_sid   text;
  v_pkg   integer;
  v_r     jsonb;
  v_src   text;
  v_before timestamptz;
  v_pid   integer;
BEGIN
  -- ١) الحرّاسُ الثلاثةُ باقيةٌ في النصّ (ولا يُقرأ تعليقٌ: يُجرَّد أوّلاً).
  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='bot_subscribe_plan' AND p.prokind='f';
  IF v_src NOT LIKE '%bot_payments_enabled%' THEN RAISE EXCEPTION 'سقط مفتاحُ الإيقاف العامّ'; END IF;
  IF v_src NOT LIKE '%_bot_uid%' THEN RAISE EXCEPTION 'سقط حارسُ هويّة البوت'; END IF;
  IF v_src NOT LIKE '%_taki_sub_payment_ok%' THEN RAISE EXCEPTION 'سقط حارسُ الدفع'; END IF;
  IF v_src NOT LIKE '%_taki_apply_package(%' THEN RAISE EXCEPTION 'لم يُنادَ الموضعُ الواحد'; END IF;
  -- ٢) ولا نسخةَ تفعيلٍ باقية: لا كتابةَ مباشرةً في store_profiles.
  IF v_src LIKE '%store_profiles SET%' OR v_src LIKE '%INTO store_profiles%'
     OR v_src LIKE '%INTO public.store_profiles%' THEN
    RAISE EXCEPTION 'ما زالت الدالّةُ تكتب store_profiles بنفسها — النسخةُ الثالثة باقية';
  END IF;

  -- ٣) تاجرٌ له معرّفُ تيليجرام (وإلّا لا يمكن اختبارُ المسار).
  SELECT telegram_id, id INTO v_tg, v_sid FROM public.users
   WHERE telegram_id IS NOT NULL AND user_type IN ('seller','admin') AND deleted_at IS NULL
   ORDER BY id LIMIT 1;
  IF v_tg IS NULL THEN
    RAISE NOTICE 'ℓ لا تاجرَ مرتبطٌ بتيليجرام — فُحص النصُّ والمسارُ الجافّ فقط.';
  ELSE
    SELECT (pkg->>'id')::int INTO v_pkg FROM public.platform_settings ps,
           LATERAL jsonb_array_elements(ps.value) pkg
     WHERE ps.key='location_packages' AND COALESCE((pkg->>'active')::boolean,false)
     ORDER BY (pkg->>'id')::int LIMIT 1;

    -- ٣أ) بلا دفعةٍ مؤكَّدة ⇒ يُرفض (الثغرةُ التي أُغلقت في v15.31).
    DELETE FROM public.subscription_payments
     WHERE merchant_id = v_sid AND created_at > now() - interval '2 hours';
    v_r := public.bot_subscribe_plan(v_tg, v_pkg, NULL);
    IF v_r->>'error' IS DISTINCT FROM 'payment_not_confirmed'
       AND v_r->>'error' IS DISTINCT FROM 'free_mode' THEN
      RAISE EXCEPTION 'البوتُ فعّل بلا دفعةٍ مؤكَّدة: %', v_r;
    END IF;

    IF v_r->>'error' = 'free_mode' THEN
      RAISE NOTICE 'ℓ الوضعُ المجّانيّ مفعَّل — فُحص النصُّ والرفضُ العامّ.';
    ELSE
      -- ٣ب) وبدفعةٍ مؤكَّدةٍ بمرجع ⇒ يُفعَّل، **ويكتب معرّفَ الباقة**.
      INSERT INTO public.subscription_payments
        (id, merchant_id, amount, currency, status, payment_method,
         gateway_provider, gateway_reference, created_at, paid_at)
      VALUES ('TEST-' || gen_random_uuid()::text, v_sid,
              (public._taki_apply_package_dry(v_pkg)->>'net')::numeric, 'SAR', 'paid',
              'test', 'test', 'TEST-REF', now(), now());
      UPDATE public.store_profiles SET subscription_package_id = NULL WHERE store_id = v_sid;
      v_r := public.bot_subscribe_plan(v_tg, v_pkg, NULL);
      IF NOT COALESCE((v_r->>'success')::boolean, false) THEN
        RAISE EXCEPTION 'التفعيلُ فشل بدفعةٍ مؤكَّدة: %', v_r;
      END IF;
      SELECT subscription_package_id INTO v_pid FROM public.store_profiles WHERE store_id = v_sid;
      IF v_pid IS DISTINCT FROM v_pkg THEN
        RAISE EXCEPTION 'معرّفُ الباقة لم يُكتب (%) — العيبُ الذي جاءت الهجرةُ له', v_pid;
      END IF;
      -- ٣ج) وشكلُ الإرجاع كما هو: ثمانيةُ مفاتيح، ولا واحدٌ فارغ.
      FOREACH v_src IN ARRAY ARRAY['success','plan_ar','max_branches','price',
                                   'expires_at','days','vat','total'] LOOP
        IF NOT (v_r ? v_src) THEN
          RAISE EXCEPTION 'مفتاحٌ سقط من إرجاع البوت: % — تُصمت شاشةٌ بلا خطأ', v_src;
        END IF;
        IF v_r->>v_src IS NULL THEN
          RAISE EXCEPTION 'مفتاحُ % فارغٌ في إرجاع البوت', v_src;
        END IF;
      END LOOP;
    END IF;

    -- ٤) وباقةٌ بلا مفتاح `active` تُرفض — كما يرفضها الويب (توحيدُ الافتراض).
    UPDATE public.platform_settings
       SET value = value || jsonb_build_array(jsonb_build_object(
             'id', 99901, 'ar', 'اختبار', 'price', 1, 'max', 1, 'durationDays', 30))
     WHERE key = 'location_packages';
    v_r := public.bot_subscribe_plan(v_tg, 99901, NULL);
    IF COALESCE((v_r->>'success')::boolean, false) THEN
      RAISE EXCEPTION 'باقةٌ بلا active بِيعت من البوت — الانحرافُ باقٍ: %', v_r;
    END IF;
  END IF;

  RAISE NOTICE '✅ موضعٌ واحدٌ للتفعيل · الحرّاسُ الثلاثة · معرّفُ الباقة يُكتب · شكلُ الإرجاع · وافتراضُ active موحَّد';
END $$;
ROLLBACK;

-- ── جدولُ القراءة ────────────────────────────────────────────────────────
SELECT 'الخادم' AS "البند", current_setting('server_version') AS "القيمة",
       CASE WHEN COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ المختبر' ELSE '✅ جدة' END AS "الحالة"
UNION ALL SELECT 'منادو الموضع الواحد',
       (SELECT string_agg(p.proname, ' · ' ORDER BY p.proname) FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname='public' AND p.prokind='f'
           AND regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*','','g')
               LIKE '%_taki_apply_package(%'), '✅'
UNION ALL SELECT 'نسخُ التفعيل الباقية',
       (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.prokind='f' AND p.proname <> '_taki_apply_package'
           AND regexp_replace(pg_get_functiondef(p.oid),'--[^\n]*','','g')
               ~ 'store_profiles[^;]*subscription_expires_at[^;]*max_branches'),
       'ℓ تشمل دوالَّ الأدمن والمنح (مساراتٌ أخرى بحقّها)';
