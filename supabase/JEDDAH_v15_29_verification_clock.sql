-- ═══════════════════════════════════════════════════════════════════════════
-- v15.29 — ساعةُ انتهاء التوثيق: تنبيهٌ لا يضيع بيومٍ فائت
-- ═══════════════════════════════════════════════════════════════════════════
-- طلبُ ناصر (٢٨ أكتوبر): «تخزين تاريخ الانتهاء + مهمّة يومية تنبّه قبل
-- ٣٠ يوماً من الانتهاء». التخزينُ قائمٌ منذ v14.95 (`doc_expiry`) والمهمّةُ
-- قائمةٌ (`taki-verification-expiry` الساعة ١:٢٠ فجراً) — لكن **المهلة ١٤
-- يوماً لا ٣٠**، وفيها عيبٌ أخطر من الرقم.
--
-- 🔴 **العيب: `doc_expiry = (current_date + 14)` مساواةٌ لا مدى.** فالتنبيه
--    يُطلق في يومٍ واحدٍ بعينه؛ وإن لم تدر المهمّةُ ذلك اليوم **ضاع التنبيه
--    إلى الأبد بلا أثر**. وليس هذا احتمالاً نظرياً: هذا الخادمُ نفسه كان
--    مطفأً من ٢ إلى ١٩ أكتوبر ٢٠٢٦ (نفدت الباقةُ المجّانية) — سبعةَ عشرَ
--    يوماً متّصلة، أي سبعةَ عشرَ تنبيهاً كانت ستسقط صامتة.
--
-- ✅ **العلاج: مدى + علامة.** `days_left <= عتبة` (فلا يضيع يومٌ فائت) مع
--    `warn_stage` يمنع التكرار (فلا يُقصف التاجر كلّ ليلة). والعلامةُ تُصفَّر
--    تلقائياً إن تغيّر تاريخ الانتهاء — وإلّا لم يُنبَّه على الوثيقة المجدَّدة.
--
-- 🪤 وعتبتان لا واحدة: ٣٠ يوماً (مهلةُ تصرّف) ثمّ ٧ (تذكيرٌ أخير). ومن يراها
--    لأوّل مرّةٍ وقد بقي ٥ أيّام يأخذ الأقرب وحده، لا التنبيهين معاً.
--
-- 🪤 و**لا يُكتب العددُ نصّاً**: «٣٠ يوماً» في نصٍّ ثابتٍ يكذب لحظةَ تتغيّر
--    العتبة، و«١ أيام» عيبٌ وقع في هذا المشروع مرّتين (v14.92 الساعات،
--    v14.93 الرسائل). فالعبارةُ تُصاغ من **الباقي الحقيقي** عبر
--    `taki_ar_days()` — توأمُ `DAYS` في `verificationStatus.ts`،
--    و`scripts/check-ar-plural.js` يقارنهما ويُفشل البناء إن انحرفا.
--
-- 🪤 وما لم يتغيّر عمداً: **الانتهاء لا يوقف عرضاً حيّاً** — يمنع النشر
--    الجديد وحده. تاريخٌ يمرّ في الواحدة فجراً لا يُسقط بضاعةَ تاجرٍ نائم.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regclass('public.store_verifications') IS NULL THEN
    RAISE EXCEPTION 'جدولُ التوثيق غير موجود — أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_expire_verifications()') IS NULL THEN
    RAISE EXCEPTION 'دالّةُ الانتهاء غير موجودة — أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) جمعُ «يوم» بالعربية — نسخةُ القاعدة من `DAYS`
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.taki_ar_days(p_n integer)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN p_n = 1 THEN 'يوم واحد'
    WHEN p_n = 2 THEN 'يومان'
    WHEN p_n BETWEEN 3 AND 10 THEN p_n::text || ' أيام'
    ELSE p_n::text || ' يوماً'
  END;
$fn$;

COMMENT ON FUNCTION public.taki_ar_days(integer) IS
  'جمعُ «يوم» بالعربية — توأمُ DAYS في src/components/admin/verification/verificationStatus.ts (v15.29).';

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) العلامة — في أيّ عتبةٍ نُبّه هذا الصفّ
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.store_verifications
  ADD COLUMN IF NOT EXISTS warn_stage smallint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.store_verifications.warn_stage IS
  '٠ لم يُنبَّه · ١ نُبّه عند ٣٠ يوماً · ٢ نُبّه عند ٧. تُصفَّر إن تغيّر doc_expiry (v15.29).';

-- تصفيرُ العلامة عند تغيّر تاريخ الانتهاء — وإلّا لم تُنبَّه وثيقةٌ جُدِّدت.
CREATE OR REPLACE FUNCTION public.tr_reset_verification_warn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.doc_expiry IS DISTINCT FROM OLD.doc_expiry THEN
    NEW.warn_stage := 0;
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS tr_reset_verification_warn ON public.store_verifications;
CREATE TRIGGER tr_reset_verification_warn
  BEFORE UPDATE OF doc_expiry ON public.store_verifications
  FOR EACH ROW EXECUTE FUNCTION public.tr_reset_verification_warn();

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) الدالّة — مدى وعلامة بدل مساواةِ يومٍ واحد
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.taki_expire_verifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n int := 0;
  r record;
  v_msg text;
  v_left int;
  v_stage smallint;
BEGIN
  -- ① التنبيه: عتبتان، بالمدى لا بالمساواة، ومرّةً واحدةً لكلّ عتبة.
  --    🪤 `ORDER BY doc_expiry` ليس تجميلاً: لو حُدّ العددُ يوماً ما فالأقربُ
  --       انتهاءً أولى بالتنبيه.
  FOR r IN
    SELECT id, store_id, (doc_expiry - current_date)::int AS days_left, warn_stage
      FROM public.store_verifications
     WHERE status = 'approved'
       AND doc_expiry IS NOT NULL
       AND doc_expiry >= current_date          -- المنتهي يُعالَج في ②
       AND (doc_expiry - current_date) <= 30
       AND warn_stage < 2
     ORDER BY doc_expiry
  LOOP
    -- العتبةُ المستحقّة: ٧ تعلو ٣٠، ولا يُنبَّه بعتبةٍ سبق تجاوزُها.
    v_stage := CASE WHEN r.days_left <= 7 THEN 2 ELSE 1 END;
    CONTINUE WHEN v_stage <= r.warn_stage;

    v_left := GREATEST(r.days_left, 0);
    v_msg := '⚠️ ينتهي توثيق متجرك خلال ' || public.taki_ar_days(v_left)
          || '. جدّده من «توثيق المتجر» — عروضك الحالية تبقى تعمل، لكن لن تستطيع نشر عرضٍ جديد بعد الانتهاء.';

    INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
    VALUES (r.store_id, '⚠️ توثيقك يقترب من الانتهاء', '⚠️ Verification expiring',
            v_msg, v_msg, 'system',
            jsonb_build_object('audience', 'seller', 'actionUrl', '/seller',
                               'action_url', '/seller', 'days_left', v_left));

    UPDATE public.store_verifications SET warn_stage = v_stage WHERE id = r.id;
  END LOOP;

  -- ② الانتهاء — كما كان: يمنع النشر الجديد ولا يُسقط عرضاً حيّاً.
  FOR r IN SELECT id, store_id FROM public.store_verifications
            WHERE status = 'approved' AND doc_expiry IS NOT NULL AND doc_expiry < current_date LOOP
    UPDATE public.store_verifications SET status = 'expired', decided_at = now() WHERE id = r.id;
    v_msg := '⚠️ انتهت صلاحية توثيق متجرك. عروضك الحالية تعمل، ولا يمكنك نشر عرضٍ جديد حتى تجدّد.';
    INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
    VALUES (r.store_id, '⚠️ انتهى توثيق متجرك', '⚠️ Verification expired',
            v_msg, v_msg, 'system',
            jsonb_build_object('audience', 'seller', 'actionUrl', '/seller', 'action_url', '/seller'));
    n := n + 1;
  END LOOP;

  RETURN n;
END
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) القياس — ولا «تمّ» قبله
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  v_store text;
  v_id    text;
  v_n     int;
  v_txt   text;
  v_stage smallint;
BEGIN
  -- (أ) صيغُ الجمع — الحالات التي أخطأت فعلاً في هذا المشروع من قبل.
  IF public.taki_ar_days(1)  <> 'يوم واحد'  THEN RAISE EXCEPTION 'جمع اليوم: ١'; END IF;
  IF public.taki_ar_days(2)  <> 'يومان'     THEN RAISE EXCEPTION 'جمع اليوم: ٢'; END IF;
  IF public.taki_ar_days(3)  <> '3 أيام'    THEN RAISE EXCEPTION 'جمع اليوم: ٣'; END IF;
  IF public.taki_ar_days(10) <> '10 أيام'   THEN RAISE EXCEPTION 'جمع اليوم: ١٠'; END IF;
  IF public.taki_ar_days(11) <> '11 يوماً'  THEN RAISE EXCEPTION 'جمع اليوم: ١١'; END IF;
  IF public.taki_ar_days(30) <> '30 يوماً'  THEN RAISE EXCEPTION 'جمع اليوم: ٣٠'; END IF;

  -- متجرٌ وهميّ لا يلمس بيانات أحد.
  SELECT id INTO v_store FROM public.users ORDER BY created_at LIMIT 1;
  IF v_store IS NULL THEN RAISE EXCEPTION 'لا مستخدم للقياس عليه.'; END IF;

  v_id := 'v1529-probe';
  DELETE FROM public.notifications WHERE meta_data ? 'days_left' AND user_id = v_store;
  DELETE FROM public.store_verifications WHERE id = v_id;

  -- (ب) **العيبُ القديم بعينه**: وثيقةٌ تنتهي بعد ٢٥ يوماً — يومٌ لم يكن
  --     يساوي ١٤ قطّ، فالنصُّ القديم كان يتجاهلها صامتاً.
  INSERT INTO public.store_verifications
    (id, store_id, doc_kind, doc_number, claimed_name, doc_expiry, status, assurance, submitted_at)
  VALUES (v_id, v_store, 'cr', '0000000000', 'قياس v15.29',
          current_date + 25, 'approved', 'registry', now());

  PERFORM public.taki_expire_verifications();

  SELECT count(*), max(body_ar) INTO v_n, v_txt
    FROM public.notifications
   WHERE user_id = v_store AND meta_data ? 'days_left';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'العتبة ٣٠: توقّعتُ تنبيهاً واحداً ووجدتُ %. (هذا هو العيبُ القديم إن كان صفراً.)', v_n;
  END IF;
  IF position('25 يوماً' IN v_txt) = 0 THEN
    RAISE EXCEPTION 'النصُّ لا يحمل الباقي الحقيقي: %', v_txt;
  END IF;

  SELECT warn_stage INTO v_stage FROM public.store_verifications WHERE id = v_id;
  IF v_stage <> 1 THEN RAISE EXCEPTION 'العلامةُ لم تُكتب (warn_stage=%)', v_stage; END IF;

  -- (ج) تشغيلٌ ثانٍ في نفس اليوم لا يُكرّر التنبيه.
  PERFORM public.taki_expire_verifications();
  SELECT count(*) INTO v_n FROM public.notifications
   WHERE user_id = v_store AND meta_data ? 'days_left';
  IF v_n <> 1 THEN RAISE EXCEPTION 'تكرار: صار العدد % بعد تشغيلٍ ثانٍ.', v_n; END IF;

  -- (د) العتبةُ الثانية تُطلق تنبيهاً واحداً إضافياً.
  UPDATE public.store_verifications SET doc_expiry = current_date + 5 WHERE id = v_id;
  SELECT warn_stage INTO v_stage FROM public.store_verifications WHERE id = v_id;
  IF v_stage <> 0 THEN RAISE EXCEPTION 'المشغّل لم يُصفّر العلامة عند تغيّر التاريخ (=%).', v_stage; END IF;

  PERFORM public.taki_expire_verifications();
  SELECT count(*) INTO v_n FROM public.notifications
   WHERE user_id = v_store AND meta_data ? 'days_left';
  IF v_n <> 2 THEN RAISE EXCEPTION 'العتبة ٧: توقّعتُ تنبيهين ووجدتُ %.', v_n; END IF;
  SELECT warn_stage INTO v_stage FROM public.store_verifications WHERE id = v_id;
  IF v_stage <> 2 THEN RAISE EXCEPTION 'العلامةُ الثانية لم تُكتب (=%)', v_stage; END IF;

  -- (هـ) الانتهاء ما زال يعمل.
  UPDATE public.store_verifications SET doc_expiry = current_date - 1 WHERE id = v_id;
  PERFORM public.taki_expire_verifications();
  IF (SELECT status FROM public.store_verifications WHERE id = v_id) <> 'expired' THEN
    RAISE EXCEPTION 'الانتهاءُ لم يُطبَّق.';
  END IF;

  -- تنظيفٌ كامل: لا يبقى أثرُ القياس في بيانات أحد.
  DELETE FROM public.notifications WHERE user_id = v_store AND meta_data ? 'days_left';
  DELETE FROM public.notifications
   WHERE user_id = v_store AND title_ar = '⚠️ انتهى توثيق متجرك'
     AND created_at > now() - interval '5 minutes';
  DELETE FROM public.store_verifications WHERE id = v_id;

  RAISE NOTICE '✅ v15.29: العتبتان تعملان بالمدى لا بالمساواة · لا تكرار · التصفير عند التجديد · الانتهاء سليم.';
END
$verify$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) الخلاصة — للقراءة وحدها (الحُكم أعلاه يرفع استثناءً)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS "البند", current_setting('server_version') AS "القيمة"
UNION ALL SELECT 'taki_ar_days(30)', public.taki_ar_days(30)
UNION ALL SELECT 'عمود warn_stage',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='public' AND table_name='store_verifications'
                       AND column_name='warn_stage') THEN '✅' ELSE '❌' END
UNION ALL SELECT 'مشغّل التصفير',
  CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                     WHERE tgrelid='public.store_verifications'::regclass
                       AND tgname='tr_reset_verification_warn') THEN '✅' ELSE '❌' END
UNION ALL SELECT 'المهمّة اليومية',
  COALESCE((SELECT schedule FROM cron.job WHERE jobname='taki-verification-expiry'), '❌');
