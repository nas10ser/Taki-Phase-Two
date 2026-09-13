-- ═══════════════════════════════════════════════════════════════════════════
-- JEDDAH_v14_23_review_round3.sql — الجولة الثالثة من المراجعة الخصمية
--
--  ١) **«تُمحى بياناتك نهائياً» ما زالت غير صادقة.** v14.22 نظّفت `auth.users`،
--     لكن `auth.identities.identity_data` تحمل على هذا الخادم: البريد والاسم
--     والجوال وجوال التواصل والعنوان — ولا شيء يمسحها. فالوعد المكتوب في ثلاثة
--     مواضع يظلّ كاذباً بعد الثلاثين يوماً.
--  ٢) **الخصوصية تَعِد بحذف جلسات الدخول بعد ٣٠ يوماً** تحت عنوان «المدد
--     المطبَّقة فعلياً» — ولا شيء يحذف `auth.sessions` إطلاقاً (أقدم جلسة حيّة
--     عمرها ٣٩ يوماً)، والوظيفة الوحيدة التي تلمس جدول جلسات تحذف عند **٧**
--     أيام لا ٣٠. إمّا أن يُطبَّق الرقم أو يُحذف الوعد — والأصحّ أن يُطبَّق.
--
-- آمنة للتكرار (idempotent).
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
     LIKE 'TAKI_LAB_TOKYO%' THEN
    RAISE EXCEPTION
      'REFUSED: this migration targets the Jeddah production server, but this database is the Tokyo lab (%).',
      obj_description('public'::regnamespace, 'pg_namespace');
  END IF;
END
$guard$;

BEGIN;

-- ═══ ١) التجهيل يشمل هويّات المصادقة ══════════════════════════════════════
CREATE OR REPLACE FUNCTION public.purge_expired_accounts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_n integer := 0; r record; v_mask text;
BEGIN
  FOR r IN
    SELECT id FROM public.users
     WHERE purge_after IS NOT NULL AND purge_after < now()
       AND COALESCE(is_anonymized, false) = false
  LOOP
    v_mask := 'deleted+' || substr(md5(r.id), 1, 12) || '@takisa.invalid';

    -- (أ) الصفّ العامّ
    UPDATE public.users
       SET name = 'مستخدم محذوف',
           shop = NULL, bio = NULL, address = NULL, avatar_url = NULL,
           phone = NULL, contact_phone = NULL,
           email = v_mask,
           lat = NULL, lng = NULL,
           delivery_address = NULL,
           notif_keywords = NULL, smart_alerts = NULL, followed_merchants = NULL,
           telegram_id = NULL, telegram_chat_id = NULL, whatsapp_chat_id = NULL,
           telegram_link_otp = NULL, telegram_link_otp_expires_at = NULL,
           consent_ip = NULL, consent_user_agent = NULL,
           is_anonymized = true, anonymized_at = now(),
           purge_after = NULL
     WHERE id = r.id;

    -- (ب) صفّ المصادقة **وهويّاته**. 🪤 v14.22 نظّفت `auth.users` وحدها، و
    --     `auth.identities.identity_data` تحمل البريد والاسم والجوال والعنوان.
    BEGIN
      UPDATE auth.users
         SET email = v_mask, phone = NULL, encrypted_password = '',
             raw_user_meta_data = '{}'::jsonb,
             email_change = NULL, phone_change = NULL
       WHERE id::text = r.id;
      UPDATE auth.identities
         SET identity_data = jsonb_build_object('sub', r.id, 'email', v_mask)
       WHERE user_id::text = r.id;
      DELETE FROM auth.refresh_tokens WHERE user_id = r.id;
      DELETE FROM auth.sessions WHERE user_id::text = r.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'auth scrub skipped for %: %', r.id, SQLERRM;
    END;

    -- (ج) ما يحمل هويّته خارج صفّه
    DELETE FROM public.user_addresses     WHERE user_id = r.id;
    DELETE FROM public.push_subscriptions WHERE user_id = r.id;
    DELETE FROM public.delivery_tracks    WHERE user_id = r.id;
    DELETE FROM public.email_outbox       WHERE user_id = r.id;
    DELETE FROM public.notifications      WHERE user_id = r.id;
    UPDATE public.ratings SET user_name = 'مستخدم محذوف' WHERE user_id = r.id;

    -- (د) الطلبات تبقى سجلّاً للتاجر، بلا اسم ولا جوال ولا ما يقود لبيته
    UPDATE public.bookings
       SET user_name = NULL, user_phone = NULL,
           delivery_address = CASE
             WHEN delivery_address IS NULL THEN NULL
             ELSE delivery_address - 'phone' - 'details' - 'lat' - 'lng' END
     WHERE user_id = r.id;

    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$fn$;

REVOKE ALL ON FUNCTION public.purge_expired_accounts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_expired_accounts() FROM anon;
REVOKE ALL ON FUNCTION public.purge_expired_accounts() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_accounts() TO service_role;

-- ═══ ٢) جلسات الدخول: ٣٠ يوماً كما تقول الخصوصية ══════════════════════════
CREATE OR REPLACE FUNCTION public.cleanup_old_activity()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
    DELETE FROM activity_log WHERE created_at < NOW() - INTERVAL '90 days';
    -- v14.23 — كانت ٧ أيام والخصوصية تقول ٣٠ تحت «المدد المطبَّقة فعلياً».
    DELETE FROM user_sessions WHERE last_seen_at < NOW() - INTERVAL '30 days';
    -- وجلسات المصادقة نفسها لم يكن يحذفها شيء إطلاقاً.
    BEGIN
      DELETE FROM auth.sessions       WHERE COALESCE(updated_at, created_at) < NOW() - INTERVAL '30 days';
      DELETE FROM auth.refresh_tokens WHERE COALESCE(updated_at, created_at) < NOW() - INTERVAL '30 days';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'auth session prune skipped: %', SQLERRM;
    END;
END
$fn$;

REVOKE ALL ON FUNCTION public.cleanup_old_activity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_old_activity() FROM anon;
REVOKE ALL ON FUNCTION public.cleanup_old_activity() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_activity() TO service_role;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- جدول التحقّق — أوّل سطر فيه اسم الخادم
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS "الفحص",
       COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'standard public schema') AS "النتيجة",
       CASE WHEN COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') NOT LIKE 'TAKI_LAB_TOKYO%'
            THEN '✅ جدة (إنتاج)' ELSE '❌ المختبر' END AS "الحالة";

SELECT 'التجهيل يمسح هويّات المصادقة' AS "الفحص",
       CASE WHEN pg_get_functiondef('public.purge_expired_accounts()'::regprocedure) LIKE '%auth.identities%'
            THEN 'نعم' ELSE 'لا' END AS "النتيجة",
       CASE WHEN pg_get_functiondef('public.purge_expired_accounts()'::regprocedure) LIKE '%auth.identities%'
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'جلسات الدخول ٣٠ يوماً كما تقول الخصوصية' AS "الفحص",
       CASE WHEN pg_get_functiondef('public.cleanup_old_activity()'::regprocedure) LIKE '%auth.sessions%'
             AND pg_get_functiondef('public.cleanup_old_activity()'::regprocedure) LIKE '%user_sessions WHERE last_seen_at < NOW() - INTERVAL ''30 days''%'
            THEN 'مطبَّقة' ELSE 'غير مطبَّقة' END AS "النتيجة",
       CASE WHEN pg_get_functiondef('public.cleanup_old_activity()'::regprocedure) LIKE '%auth.sessions%'
             AND pg_get_functiondef('public.cleanup_old_activity()'::regprocedure) LIKE '%user_sessions WHERE last_seen_at < NOW() - INTERVAL ''30 days''%'
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'كرون التنظيف قائم' AS "الفحص",
       COALESCE((SELECT schedule FROM cron.job WHERE jobname='taki-activity-cleanup'),'—') AS "النتيجة",
       CASE WHEN EXISTS (SELECT 1 FROM cron.job WHERE jobname='taki-activity-cleanup') THEN '✅' ELSE '❌' END AS "الحالة";
