-- ════════════════════════════════════════════════════════════════════════════
-- v14.78 — القيد يعرف ثلاثة أنواعٍ تكتبها المنصّة منذ إصدارات
-- ════════════════════════════════════════════════════════════════════════════
-- بلاغ ناصر (٢١ سبتمبر، بصورة): عند تفعيل مسابقته ظهر
--   «⚠️ تعذّر إرسال الإشعار: new row for relation "notifications"
--     violates check constraint "notifications_type_check"»
--
-- السبب جذرٌ واحد لثلاثة أعطال: `notifications_type_check` يسمح بستّة أنواع
-- (booking · deal · system · rating · follow · marketing)، **والمنصّة تكتب
-- ثلاثةً غيرها**. قِيس على جدة: صفر صفّ من كلٍّ منها منذ إنشاء الجدول — أي أن
-- المسارات الثلاثة لم تنجح **ولا مرّة واحدة**.
--
--   🔴 ١) 'report' — `handle_report_threshold` (مشغّل AFTER INSERT على reports).
--         و**لا معالج استثناء فيها**، فالانتهاك يُلغي إدراج البلاغ نفسه:
--         المبلّغ الثالث على حسابٍ واحد يرى «❌ تعذّر إرسال البلاغ. تحقق من
--         الاتصال» — فيُلام إنترنتُه. والأسوأ أنه **عالقٌ إلى الأبد**: عدّاد
--         المبلّغين المتمايزين لا يبلغ ٣ أبداً لأن كل بلاغٍ ثالث يُلغى،
--         فالحساب لا يدخل المراجعة ولا يصل الأدمن إشعار. أي أن **عتبة الرقابة
--         كلّها ميّتة**. (قِيس بمحاكاة ثلاثة مبلّغين داخل معاملةٍ ثم تراجُع.)
--
--   🔴 ٢) 'subscription' — `taki_store_profiles_subscription_notify` بفرعيه
--         (`sub_new` و`sub_cancelled`). وهذه تنتهي بـ
--         `EXCEPTION WHEN OTHERS THEN RAISE WARNING … RETURN NEW;`
--         فالانتهاك **يُبتلع بصمت**: الاشتراك يُفعَّل والتاجر لا يصله
--         «🎉 تم تفعيل اشتراكك» أبداً، ولا خطأ في أي شاشة.
--         والقياس حاسم: إخوتُها اللواتي يكتبن 'system' (`sub_renewed` و
--         `sub_warning`) لهنّ صفوف، وهاتان صفر.
--
--   🔴 ٣) 'contest' — `contestRepository.announce()` تمرّر `p_type:'contest'`
--         إلى `admin_broadcast_notification`، وهي تُدرج ما يصلها بلا قائمة
--         سماح. وهذا وحده ما رآه ناصر لأنه المسار الوحيد الذي **يُظهر** الخطأ.
--
-- الحلّ: القيد يعترف بما تكتبه المنصّة فعلاً. والأنواع الثلاثة ليست غريبة
-- عليها — البوتان يحملان أيقوناتٍ لها في `NOTIF_ICON`، والموقع والبوت يوجّهان
-- `type='report'` إلى مركز البلاغات. أي أن المستهلكين كانوا جاهزين والكاتب
-- ممنوعاً.
--
-- 🪤 ولماذا لم يُكتشف طوال هذه المدّة: عطلان من الثلاثة **صامتان تماماً**
--    (أحدهما مبتلَعٌ بمعالج استثناء، والآخر يظهر للمبلّغ كعطل شبكة)، والثالث
--    لا يظهر إلا للأدمن وحده وقت التفعيل. لا سجلّ ولا عدّاد ولا لوحة تقول شيئاً.
--    ولذلك أُضيف `taki_audit_notification_types()` ليكشف الانحراف بالقياس.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'رُفض: هذا خادم المختبر (طوكيو) — هجرات الإنتاج تُطبَّق على جدة';
  END IF;
END $guard$;

-- ١) القيد يعترف بالأنواع الثلاثة ────────────────────────────────────────────
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY[
    'booking'::text, 'deal'::text, 'system'::text, 'rating'::text,
    'follow'::text, 'marketing'::text,
    -- v14.78 — ثلاثةٌ تكتبها المنصّة منذ إصدارات وكان القيد يرفضها:
    'report'::text,        -- عتبة البلاغات ⇒ تنبيه الأدمن
    'subscription'::text,  -- تفعيل/إلغاء اشتراك التاجر
    'contest'::text        -- إعلان مسابقة
  ]));

-- ٢) البثّ يرفض نوعاً مجهولاً بصوتٍ مفهوم ──────────────────────────────────────
-- 🪤 `admin_broadcast_notification` كانت تُدرج `p_type` كما يصلها بلا أي قائمة
--    سماح، فأي خطأٍ إملائي من أي نداءٍ مستقبلاً يعود بنفس الخطأ الخام الذي رآه
--    ناصر. الآن تقول اسم النوع والقائمة المقبولة، ولا تُسقط البثّ في عمق المكدّس.
CREATE OR REPLACE FUNCTION public.taki_notification_type_guard(p_type text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v text := COALESCE(NULLIF(btrim(p_type), ''), 'system');
BEGIN
  IF v NOT IN ('booking','deal','system','rating','follow','marketing',
               'report','subscription','contest') THEN
    RAISE EXCEPTION
      'نوع إشعار غير معروف: «%». المقبول: booking · deal · system · rating · follow · marketing · report · subscription · contest',
      v USING ERRCODE = '22023';
  END IF;
  RETURN v;
END $function$;

-- 🪤 لا مِنحة لأحد: الحارس يُنادى من داخل دوالّ SECURITY DEFINER وحدها، فهي
--    تنفّذه بصلاحية مالكها. ومنحُه لـ`authenticated` كان سطحاً زائداً بلا داعٍ
--    (وREVOKE من PUBLIC لا يُلغي منح `anon` المباشر — فالاثنان معاً).
REVOKE ALL ON FUNCTION public.taki_notification_type_guard(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_notification_type_guard(text) FROM anon;
REVOKE ALL ON FUNCTION public.taki_notification_type_guard(text) FROM authenticated;

-- ٢ب) البثّ يستعمل الحارس بدل تمرير ما يصله كما هو ─────────────────────────
-- 🪤 أُعيدت الدالّة **كاملةً** لا بترقيعٍ نصّيّ على جسمها الحيّ (درس v14.63)،
--    وما دونها حرفُ حرفٍ من النسخة القائمة على جدة، والفرق سطرٌ واحد:
--    التحقّق من النوع **قبل** أي عمل، فيُقال السبب بدل خطأ قيدٍ خام في العمق.
CREATE OR REPLACE FUNCTION public.admin_broadcast_notification(
    p_title_ar text, p_body_ar text DEFAULT ''::text, p_audience text DEFAULT 'all'::text,
    p_type text DEFAULT 'system'::text, p_meta jsonb DEFAULT '{}'::jsonb,
    p_inapp boolean DEFAULT true, p_email boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_notified int := 0;
    v_emailed  int := 0;
    v_html     text;
    v_type     text;
    r RECORD;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'forbidden: admin only';
    END IF;
    IF COALESCE(btrim(p_title_ar), '') = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'empty_title');
    END IF;
    -- v14.78 — النوع يُتحقّق منه أوّلاً: كان يُمرَّر كما يصل، فأي قيمةٍ خارج
    -- القيد تُفجّر الإدراج برسالةٍ إنجليزية خام يراها المدير كما رآها ناصر.
    v_type := public.taki_notification_type_guard(p_type);
    IF NOT p_inapp AND NOT p_email THEN
        RETURN jsonb_build_object('success', true, 'notified', 0, 'emailed', 0);
    END IF;

    IF p_inapp THEN
        INSERT INTO notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
        SELECT u.id,
               p_title_ar, p_title_ar,
               COALESCE(p_body_ar, ''), COALESCE(p_body_ar, ''),
               v_type,
               COALESCE(p_meta, '{}'::jsonb) || jsonb_build_object('broadcast', true),
               NOW()
        FROM users u
        WHERE u.deleted_at IS NULL
          AND CASE
                -- «التجار» يشمل حسابات الأدمن المالكة لمتاجر (قاعدة v11.79)
                WHEN p_audience = 'sellers' THEN u.user_type IN ('seller', 'admin')
                WHEN p_audience = 'buyers'  THEN u.user_type IN ('buyer', 'admin')
                ELSE TRUE
              END;
        GET DIAGNOSTICS v_notified = ROW_COUNT;
    END IF;

    IF p_email THEN
        -- Minimal HTML-escape so a title with < or & can't break the email.
        v_html := '<p style="font-size:15px;line-height:1.9;margin:0">'
                  || replace(replace(replace(replace(COALESCE(p_body_ar, ''),
                       '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), E'\n', '<br>')
                  || '</p>';
        FOR r IN
            SELECT u.id FROM users u
            WHERE u.deleted_at IS NULL
              AND CASE
                    WHEN p_audience = 'sellers' THEN u.user_type IN ('seller', 'admin')
                    WHEN p_audience = 'buyers'  THEN u.user_type IN ('buyer', 'admin')
                    ELSE TRUE
                  END
        LOOP
            -- taki_queue_email validates the address and skips bot placeholders.
            IF public.taki_queue_email(r.id, 'admin_broadcast', p_title_ar,
                                       public.taki_email_wrap(p_title_ar, v_html)) THEN
                v_emailed := v_emailed + 1;
            END IF;
        END LOOP;
    END IF;

    RETURN jsonb_build_object('success', true, 'notified', v_notified, 'emailed', v_emailed);
END $function$;

-- ٣) كاشفُ الانحراف: أي دالّة تكتب نوعاً يرفضه القيد؟ ────────────────────────
-- 🪤 يقرأ فقط. ويستثني حرفيّات jsonb: `jsonb_build_object('dates', …)` كان
--    يظهر «نوعاً» اسمه `dates` في أوّل صياغةٍ لهذا الكاشف — وكاشفٌ يصرخ كذباً
--    يُعلّم تجاهلَ صراخه. فالمطابقة على الحرفيّة التي تسبق وسيط `meta_data`
--    **داخل دالّةٍ تُدرج في notifications**، ثم تُستثنى أسماءُ مفاتيح معروفة.
CREATE OR REPLACE FUNCTION public.taki_audit_notification_types()
RETURNS TABLE(fn text, bad_type text)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH f AS (
    SELECT p.proname::text AS fn, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind IN ('f','p')
  ), ins AS (
    SELECT fn, def FROM f WHERE def ~* 'INSERT INTO (public\.)?notifications'
  ), lit AS (
    SELECT fn,
           (regexp_matches(def,
             $re$'([a-z_]+)'\s*,\s*(?:jsonb_build_object|'\{|COALESCE\s*\(\s*p_meta|p_meta|v_meta)$re$,
             'g'))[1] AS t
      FROM ins
  ), allowed AS (
    SELECT unnest(ARRAY['booking','deal','system','rating','follow','marketing',
                        'report','subscription','contest']) AS t
  )
  SELECT DISTINCT l.fn, l.t
    FROM lit l
   WHERE l.t NOT IN (SELECT t FROM allowed)
     -- مفاتيح jsonb معروفة ليست أنواعاً (سببُ أوّل إنذارٍ كاذب)
     AND l.t NOT IN ('dates','notified','audience','event','barcode','channels')
   ORDER BY 1, 2;
$function$;

REVOKE ALL ON FUNCTION public.taki_audit_notification_types() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_audit_notification_types() FROM anon;

-- ٤) تحقّقات تُفشل الهجرة إن كذبت ─────────────────────────────────────────────
DO $verify$
DECLARE d text; n int; bad text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO d FROM pg_constraint
   WHERE conrelid='public.notifications'::regclass AND conname='notifications_type_check';
  IF d IS NULL THEN RAISE EXCEPTION 'القيد اختفى ولم يُعَد إنشاؤه'; END IF;
  FOREACH bad IN ARRAY ARRAY['report','subscription','contest','booking','deal','system','rating','follow','marketing'] LOOP
    IF strpos(d, chr(39) || bad || chr(39)) = 0 THEN
      RAISE EXCEPTION 'القيد الجديد لا يسمح بـ«%» — وهو مستعمل', bad;
    END IF;
  END LOOP;

  -- 🪤 لا يُختبر القيد بإدراجٍ في الجدول الحيّ: `tr_notification_push` مشغّلٌ
  --    AFTER INSERT يُرسل دفعاً حقيقياً إلى جوّال مستخدمٍ حقيقي. الاختبار
  --    السلوكيّ (موجب وسالب) يجري في معاملةٍ تُرجَع، خارج الهجرة.

  -- حارس الدالّة: موجب وسالب
  IF public.taki_notification_type_guard('contest') <> 'contest' THEN
    RAISE EXCEPTION 'الحارس رفض نوعاً صحيحاً';
  END IF;
  IF public.taki_notification_type_guard('') <> 'system' THEN
    RAISE EXCEPTION 'الحارس لم يرتدّ إلى system عند الفراغ';
  END IF;
  BEGIN
    PERFORM public.taki_notification_type_guard('نوع_مختلق');
    RAISE EXCEPTION 'الحارس قبل نوعاً مختلقاً';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;

  -- دالّة البثّ تستعمل الحارس فعلاً
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n2 ON n2.oid=p.pronamespace
   WHERE n2.nspname='public' AND p.proname='admin_broadcast_notification';
  IF d NOT LIKE '%taki_notification_type_guard%' THEN
    RAISE EXCEPTION 'دالّة البثّ ما زالت تمرّر p_type بلا حارس';
  END IF;
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace n2 ON n2.oid=p.pronamespace
   WHERE n2.nspname='public' AND p.proname='admin_broadcast_notification';
  IF n <> 1 THEN RAISE EXCEPTION 'نسختان من دالّة البثّ — النداء صار ملتبساً (%)', n; END IF;

  -- الكاشف يجب أن يعود فارغاً الآن
  SELECT count(*) INTO n FROM public.taki_audit_notification_types();
  IF n <> 0 THEN
    SELECT string_agg(fn || ' ⇐ ' || bad_type, ' · ') INTO bad FROM public.taki_audit_notification_types();
    RAISE EXCEPTION 'ما زالت دوالٌّ تكتب أنواعاً مرفوضة: %', bad;
  END IF;

  RAISE NOTICE '✅ v14.78 مطبَّقة — القيد ٩ أنواع · الحارس يعمل · الكاشف نظيف';
END $verify$;

SELECT pg_get_constraintdef(oid) AS "القيد بعد الهجرة"
  FROM pg_constraint
 WHERE conrelid='public.notifications'::regclass AND conname='notifications_type_check';
