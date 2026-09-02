-- ============================================================================
-- TAKI · v13.92 — لغة المستخدم في بيانات الحساب (لبريد GoTrue ثنائي اللغة)
-- ============================================================================
-- الهدف: يقرأ قالبُ البريد على GoTrue الحقل `raw_user_meta_data->>'lang'`
-- (يصل للقالب باسم `.Data.lang`). هذه الهجرة تضمن أن ذلك الحقل موجود
-- ومطابق للغة المستخدم دائماً:
--   (١) handle_new_user يحفظ لغة التسجيل في users.preferred_lang
--   (٢) تعبئة رجعية للحسابات القائمة من preferred_lang
--   (٣) تريجر يزامن أي تغيير لاحق في اللغة إلى بيانات الحساب
--       فيصل بريد «إعادة تعيين كلمة المرور» بلغة المستخدم الحالية.
-- آمنة للتكرار · تُطبَّق على خادم جدة حصراً.
-- ============================================================================

-- ── حارس: يرفض التنفيذ على مختبر طوكيو ──────────────────────────────────────
DO $guard$
BEGIN
  IF coalesce(obj_description('public'::regnamespace, 'pg_namespace'), '')
     = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION
      'رُفض التنفيذ: هذا مختبر طوكيو. هذه هجرة إنتاج وتُطبَّق على خادم جدة فقط.';
  END IF;
END
$guard$;

BEGIN;

-- ── (١) لغة التسجيل تُحفظ في الملف الشخصي ───────────────────────────────────
-- بدونها يسجّل مستخدمٌ بالإنجليزية فيجد الموقع عربياً بعد التأكيد، والأسوأ:
-- أول حفظٍ للملف الشخصي يكتب preferred_lang='ar' فيسحب معه بيانات الحساب.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_src text;
  v_detail text;
  v_code text;
  v_ref_store text;
  v_requested text;
  v_type text;
  v_lang text;
BEGIN
  v_src    := NULLIF(btrim(coalesce(new.raw_user_meta_data->>'referral_source', '')), '');
  v_detail := NULLIF(btrim(coalesce(new.raw_user_meta_data->>'referral_source_detail', '')), '');
  v_code   := NULLIF(btrim(coalesce(new.raw_user_meta_data->>'referred_by_code', '')), '');
  IF v_code IS NOT NULL THEN
    SELECT u.id INTO v_ref_store FROM public.users u
     WHERE u.referral_code IS NOT NULL AND upper(u.referral_code) = upper(v_code)
     LIMIT 1;
    IF v_ref_store IS NOT NULL THEN v_src := 'store'; END IF;
  END IF;

  -- v13.42: whitelist. Never let signup metadata name a privileged role.
  v_requested := lower(btrim(coalesce(new.raw_user_meta_data->>'user_type', '')));
  v_type := CASE WHEN v_requested IN ('buyer', 'seller') THEN v_requested ELSE 'buyer' END;

  -- v13.92: لغة الواجهة وقت التسجيل. أي قيمة غير 'en' تُعامَل عربية.
  v_lang := CASE WHEN lower(btrim(coalesce(new.raw_user_meta_data->>'lang', ''))) = 'en'
                 THEN 'en' ELSE 'ar' END;

  INSERT INTO public.users (id, email, phone, name, user_type, shop,
                            referral_source, referral_source_detail, referred_by_store,
                            preferred_lang)
  VALUES (
    new.id::text,
    new.email,
    new.raw_user_meta_data->>'phone',
    COALESCE(new.raw_user_meta_data->>'name', 'مستخدم'),
    v_type,
    new.raw_user_meta_data->>'shop',
    v_src, v_detail, v_ref_store,
    v_lang
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$fn$;

-- ── (٢) مزامنة اللغة من الملف الشخصي إلى بيانات الحساب ──────────────────────
-- تُستدعى من تريجر على public.users. SECURITY DEFINER لأن auth.users يملكها
-- دور آخر. لا تكتب إلا مفتاح 'lang' وبقيمة مقيَّدة بـ'ar'|'en' — فلا سطح
-- لحقن أي شيء آخر في بيانات الحساب.
CREATE OR REPLACE FUNCTION public.sync_auth_lang()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $fn$
DECLARE
  v_lang text;
BEGIN
  v_lang := CASE WHEN lower(btrim(coalesce(new.preferred_lang, ''))) = 'en'
                 THEN 'en' ELSE 'ar' END;

  UPDATE auth.users au
     SET raw_user_meta_data =
           jsonb_set(coalesce(au.raw_user_meta_data, '{}'::jsonb),
                     '{lang}', to_jsonb(v_lang), true)
   WHERE au.id::text = new.id
     AND coalesce(au.raw_user_meta_data->>'lang', '') IS DISTINCT FROM v_lang;

  RETURN new;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sync_auth_lang() FROM PUBLIC;

DROP TRIGGER IF EXISTS tr_sync_auth_lang ON public.users;
CREATE TRIGGER tr_sync_auth_lang
  AFTER UPDATE OF preferred_lang ON public.users
  FOR EACH ROW
  -- الشرط ضروري: «UPDATE OF <عمود>» يشتعل بمجرد ذكر العمود في SET ولو لم
  -- تتغير قيمته، فبدونه يكتب أي حفظٍ للملف الشخصي 'ar' فوق اختيار إنجليزي.
  WHEN (old.preferred_lang IS DISTINCT FROM new.preferred_lang)
  EXECUTE FUNCTION public.sync_auth_lang();

-- ── (٣) تعبئة رجعية للحسابات القائمة ────────────────────────────────────────
UPDATE auth.users au
   SET raw_user_meta_data =
         jsonb_set(coalesce(au.raw_user_meta_data, '{}'::jsonb),
                   '{lang}',
                   to_jsonb(CASE WHEN lower(btrim(coalesce(u.preferred_lang, ''))) = 'en'
                                 THEN 'en' ELSE 'ar' END),
                   true)
  FROM public.users u
 WHERE u.id = au.id::text
   AND coalesce(au.raw_user_meta_data->>'lang', '')
       IS DISTINCT FROM (CASE WHEN lower(btrim(coalesce(u.preferred_lang, ''))) = 'en'
                              THEN 'en' ELSE 'ar' END);

COMMIT;

-- ── تقرير التحقّق (أول سطر = اسم الخادم) ────────────────────────────────────
SELECT 'الخادم' AS "الفحص",
       coalesce(obj_description('public'::regnamespace, 'pg_namespace'), '(بلا وسم)')
         || ' · db=' || current_database()
         || ' · host=' || coalesce(inet_server_addr()::text,
                                   current_setting('listen_addresses', true),
                                   'local-socket') AS "النتيجة",
       'ℹ️' AS "الحالة"
UNION ALL
SELECT 'handle_new_user يحفظ اللغة',
       CASE WHEN prosrc LIKE '%preferred_lang%' THEN 'نعم' ELSE 'لا' END,
       CASE WHEN prosrc LIKE '%preferred_lang%' THEN '✅' ELSE '❌' END
  FROM pg_proc WHERE proname = 'handle_new_user'
UNION ALL
SELECT 'دالة sync_auth_lang',
       CASE WHEN count(*) = 1 THEN 'موجودة' ELSE 'مفقودة' END,
       CASE WHEN count(*) = 1 THEN '✅' ELSE '❌' END
  FROM pg_proc WHERE proname = 'sync_auth_lang'
UNION ALL
SELECT 'تريجر tr_sync_auth_lang',
       CASE WHEN count(*) = 1 THEN 'مركَّب' ELSE 'مفقود' END,
       CASE WHEN count(*) = 1 THEN '✅' ELSE '❌' END
  FROM pg_trigger WHERE tgname = 'tr_sync_auth_lang' AND NOT tgisinternal
UNION ALL
SELECT 'حسابات بلا lang في بياناتها',
       count(*)::text,
       CASE WHEN count(*) = 0 THEN '✅' ELSE '❌' END
  FROM auth.users au
  JOIN public.users u ON u.id = au.id::text
 WHERE au.raw_user_meta_data->>'lang' IS NULL
UNION ALL
SELECT 'lang مطابق لـ preferred_lang',
       count(*)::text || ' غير مطابق',
       CASE WHEN count(*) = 0 THEN '✅' ELSE '❌' END
  FROM auth.users au
  JOIN public.users u ON u.id = au.id::text
 WHERE coalesce(au.raw_user_meta_data->>'lang', '')
       IS DISTINCT FROM (CASE WHEN lower(btrim(coalesce(u.preferred_lang, ''))) = 'en'
                              THEN 'en' ELSE 'ar' END);
