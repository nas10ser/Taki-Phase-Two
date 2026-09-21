-- ════════════════════════════════════════════════════════════════════════════
-- v14.72 — التذكير الأسبوعي يقول ما تقوله الشاشة بالضبط
-- ════════════════════════════════════════════════════════════════════════════
-- v14.69 بنت مسار الإعداد من `merchant_setup_gaps`، و«لم يُبنَ مصدرٌ ثانٍ» —
-- وهذا صحيح في **مصدر البيانات**. لكن الفحص الموسّع كشف أن الوعد لم يكتمل في
-- **النصّ**: التذكير الأسبوعي يقرأ مفتاحين من أحد عشر، فيقول للتاجر أقلّ ممّا
-- تقوله شاشته، ويرشده إلى مكانٍ خاطئ.
--
-- قِيس على جدة (٢١ سبتمبر ٢٠٢٦):
--   • «الاناقة» ترى على الشاشة أن سياسة الاسترداد متبقّية، **والتذكير لا
--     يذكرها لها إطلاقاً** (شرطُه `refund_policy_missing` مقيَّدٌ بوجود عروض).
--   • وسطر الإرشاد «لوحة التاجر ← تبويب إضافة عرض ← البطاقات في أعلى الصفحة»
--     صار **كذباً** لخطوة «بطاقة المتجر» (v14.71): محرّرها في صفحة «صفحتي».
--   • والإشعار يُبثّ حرفياً إلى تيليجرام وواتساب **بلا وجهة**: لا `actionUrl`
--     في `meta_data`، فتاجرٌ يعيش في المحادثة يتلقّى تعليمات تنقّلٍ في لوحةٍ
--     لا يراها أصلاً.
--
-- ما يتغيّر: **النصّ وحده**. شرط الإطلاق يبقى كما هو (النقصان المكلفان:
-- إقرار الحساب وسياسة الاسترداد) — توسيعه إلى الخطوات الستّ كان سيجعل تاجراً
-- لا يريد شعاراً يُنبَّه أسبوعياً إلى الأبد، وهذا إزعاجٌ لا إرشاد.
-- 🪤 أي أن الفرق بين «ما يُطلق التذكير» و«ما يسرده حين ينطلق» **مقصود**:
--    الأوّل نداءٌ عند ضررٍ واقع، والثاني قائمةٌ كاملة لأنه انطلق أصلاً.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'رُفض: هذا خادم المختبر (طوكيو) — هجرات الإنتاج تُطبَّق على جدة';
  END IF;
END $guard$;

BEGIN;

CREATE OR REPLACE FUNCTION public.taki_merchant_setup_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r          record;
  v_gaps     jsonb;
  v_refund   boolean;
  v_paydecl  boolean;
  v_done     int;
  v_ar       text;
  v_en       text;
  v_sent     integer := 0;
BEGIN
  FOR r IN
    SELECT u.id
    FROM public.users u
    WHERE u.deleted_at IS NULL
      AND COALESCE(u.is_suspended, false) = false
      AND (u.user_type IN ('seller','admin') OR NULLIF(btrim(COALESCE(u.shop,'')), '') IS NOT NULL)
  LOOP
    v_gaps    := public.merchant_setup_gaps(r.id);
    v_refund  := COALESCE((v_gaps->>'refund_policy_missing')::boolean, false);
    v_paydecl := COALESCE((v_gaps->>'payment_undeclared')::boolean, false);
    -- شرط الإطلاق: النقصان المكلفان وحدهما (بلا تغيير عن v14.45).
    CONTINUE WHEN NOT (v_refund OR v_paydecl);

    -- فترة التهدئة: أسبوع كامل بين تذكيرين لنفس المتجر
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = r.id
        AND n.meta_data->>'kind' = 'setup_gap'
        AND n.created_at > now() - interval '7 days'
    );

    -- عدّادٌ يطابق الشريط على الشاشة حرفاً بحرف (الخطوات الستّ نفسها).
    v_done :=   COALESCE((v_gaps->>'pay_declared')::boolean, false)::int
              + COALESCE((v_gaps->>'profile_set')::boolean,  false)::int
              + COALESCE((v_gaps->>'hours_set')::boolean,    false)::int
              + COALESCE((v_gaps->>'refund_set')::boolean,   false)::int
              + COALESCE((v_gaps->>'vat_answered')::boolean, false)::int
              + COALESCE((v_gaps->>'has_live_deal')::boolean,false)::int;

    v_ar := 'أنجزتَ ' || v_done || ' من ٦ خطوات:' || E'\n';
    v_en := 'You have completed ' || v_done || ' of 6 steps:' || E'\n';

    IF NOT COALESCE((v_gaps->>'pay_declared')::boolean, false) THEN
      v_ar := v_ar || '• لم تُقرّ طريقة الحساب — وعروضك تبقى مسوّدات لا يراها أحد حتى تُقرّها.' || E'\n';
      v_en := v_en || '• You have not declared how you get paid — your deals stay drafts until you do.' || E'\n';
    END IF;
    IF NOT COALESCE((v_gaps->>'profile_set')::boolean, false) THEN
      v_ar := v_ar || '• بطاقة متجرك ناقصة (الشعار أو النبذة) — وهي أوّل ما يراه المشتري. تُكمَل من صفحة «صفحتي» ← «تعديل البروفايل».' || E'\n';
      v_en := v_en || '• Your store card is incomplete (logo or blurb) — it is the first thing buyers see. Finish it in “My store” → “Edit profile”.' || E'\n';
    END IF;
    IF NOT COALESCE((v_gaps->>'hours_set')::boolean, false) THEN
      v_ar := v_ar || '• لم تحدّد ساعات العمل — فلا يعرف المشتري متى يستلم.' || E'\n';
      v_en := v_en || '• No opening hours set — buyers cannot tell when to collect.' || E'\n';
    END IF;
    IF NOT COALESCE((v_gaps->>'refund_set')::boolean, false) THEN
      v_ar := v_ar || '• لم تكتب سياسة الاسترداد — وصفحة كل عرضٍ لك تقول للمشتري: «لم يُعلن هذا المتجر سياسة استرداد».' || E'\n';
      v_en := v_en || '• No refund policy — every deal page of yours tells buyers: “this store has not published a refund policy”.' || E'\n';
    END IF;
    IF NOT COALESCE((v_gaps->>'vat_answered')::boolean, false) THEN
      v_ar := v_ar || '• لم تحدّد وضعك الضريبي — وهو ما يحدّد شكل فاتورة كل طلب. وإجابة «غير مسجّل» كافية.' || E'\n';
      v_en := v_en || '• VAT status not stated — it decides the shape of every order invoice. “Not registered” is a complete answer.' || E'\n';
    END IF;
    IF NOT COALESCE((v_gaps->>'has_live_deal')::boolean, false) THEN
      v_ar := v_ar || '• لا عرض حيّ لديك — فمتجرك لا يظهر في الرئيسية ولا في «حولي».' || E'\n';
      v_en := v_en || '• No live deal — your store appears neither on the home feed nor in “Nearby”.' || E'\n';
    END IF;

    v_ar := v_ar || E'\nافتح لوحة التاجر وستجد المسار كاملاً في أعلى الصفحة، وزرّاً لكل خطوة.';
    v_en := v_en || E'\nOpen your seller dashboard — the full path is at the top of the page, with a button per step.';

    INSERT INTO public.notifications (id, user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
    VALUES ('ntf_gap_' || (extract(epoch from clock_timestamp())*1000)::bigint || '_' || substr(md5(random()::text), 1, 6),
            r.id,
            '🧭 جهّز متجرك للبيع', 'Get your store ready to sell',
            v_ar, v_en, 'system',
            jsonb_build_object('audience', 'seller', 'kind', 'setup_gap',
                               -- وجهةٌ حقيقية: البوتان يبثّان الإشعار حرفياً،
                               -- وبلا هذا الحقل يصل التاجرَ إرشادٌ بلا زرّ.
                               'actionUrl', '/seller',
                               'steps_done', v_done,
                               'refund_policy_missing', v_refund,
                               'payment_undeclared', v_paydecl));
    v_sent := v_sent + 1;
  END LOOP;
  RETURN v_sent;
END $function$;

REVOKE ALL ON FUNCTION public.taki_merchant_setup_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_merchant_setup_reminders() FROM anon;
REVOKE ALL ON FUNCTION public.taki_merchant_setup_reminders() FROM authenticated;

COMMIT;

-- ── تحقّقٌ يرفع استثناءً ─────────────────────────────────────────────────────
DO $verify$
DECLARE n int; d text; sid text; body text;
BEGIN
  SELECT count(*) INTO n FROM pg_proc
   WHERE proname='taki_merchant_setup_reminders' AND pronamespace='public'::regnamespace;
  IF n <> 1 THEN RAISE EXCEPTION 'فشل: نسخ الدالة = %', n; END IF;

  IF has_function_privilege('anon','public.taki_merchant_setup_reminders()','EXECUTE')
     OR has_function_privilege('authenticated','public.taki_merchant_setup_reminders()','EXECUTE') THEN
    RAISE EXCEPTION 'فشل: الدالة مكشوفة لمستخدم — الكرون وحده ينادیها';
  END IF;

  d := pg_get_functiondef('public.taki_merchant_setup_reminders()'::regprocedure);
  -- سطر الإرشاد الكاذب لم يبقَ
  IF d LIKE '%تبويب «إضافة عرض» ← البطاقات في أعلى الصفحة%' THEN
    RAISE EXCEPTION 'فشل: سطر الإرشاد القديم ما زال قائماً';
  END IF;
  -- والخطوات الستّ كلها مذكورة
  FOREACH sid IN ARRAY ARRAY['pay_declared','profile_set','hours_set','refund_set','vat_answered','has_live_deal'] LOOP
    IF d NOT LIKE '%' || sid || '%' THEN
      RAISE EXCEPTION 'فشل: الخطوة % غير مذكورة في نصّ التذكير', sid;
    END IF;
  END LOOP;
  IF d NOT LIKE '%actionUrl%' THEN RAISE EXCEPTION 'فشل: الإشعار بلا وجهة'; END IF;

  -- الجدولة باقية
  SELECT count(*) INTO n FROM cron.job WHERE jobname='taki-merchant-setup-reminders';
  IF n <> 1 THEN RAISE EXCEPTION 'فشل: الوظيفة المجدولة غير مسجَّلة (%)', n; END IF;

  -- ── القياس الحقيقي: يُشغَّل داخل كتلةٍ تُلغى، ويُقرأ النصّ الخارج ─────
  BEGIN
    DELETE FROM public.notifications WHERE meta_data->>'kind' = 'setup_gap';  -- تهدئةٌ مؤقّتة داخل الكتلة
    n := public.taki_merchant_setup_reminders();
    IF n < 1 THEN RAISE EXCEPTION 'فشل: لم يُرسل أي تذكير رغم وجود نواقص'; END IF;
    SELECT body_ar INTO body FROM public.notifications
     WHERE meta_data->>'kind'='setup_gap' ORDER BY created_at DESC LIMIT 1;
    IF body NOT LIKE '%من ٦ خطوات%' THEN
      RAISE EXCEPTION 'فشل: النصّ لا يحمل عدّاد الخطوات (%)', left(body, 60);
    END IF;
    IF body LIKE '%تبويب «إضافة عرض»%' THEN
      RAISE EXCEPTION 'فشل: النصّ ما زال يرشد إلى المكان الخاطئ';
    END IF;
    RAISE EXCEPTION 'ROLLBACK_TEST_OK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_TEST_OK' THEN RAISE; END IF;
  END;
END $verify$;

SELECT 'v14.72' AS "الهجرة",
       (SELECT schedule FROM cron.job WHERE jobname='taki-merchant-setup-reminders') AS "الجدولة",
       (SELECT count(*) FROM public.notifications WHERE meta_data->>'kind'='setup_gap') AS "تذكيرات قائمة";
