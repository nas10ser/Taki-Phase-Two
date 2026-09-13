-- ═══════════════════════════════════════════════════════════════════════════
-- JEDDAH_v14_19_privacy_consent_retention.sql
--   تتبّع الموقع يُمحى بعد ساعة · حذف الحساب يقول الحقيقة · إقرار السنّ
--   وتسجيل الموافقة بالإصدار والوقت وعنوان الإنترنت
--
-- ── ما كان (مقيس على جدة ١٣ سبتمبر ٢٠٢٦) ─────────────────────────────────
--  ١) **تتبّع التوصيل يبقى إلى الأبد.** موقع المندوب نفسه يُمحى فور إغلاق
--     الطلب (مشغّل) وبعد ٦ ساعات خمول (كرون) — لكن **لا شيء يحذف الصفّ**.
--     فيبقى سجلّ «هذا المشتري استلم توصيلاً من هذا المتجر في هذا الوقت» بلا
--     أي انتهاء. قِيس: ٣ صفوف، أقدمها منذ ٩ أيام، كلّها منتهية وبلا موقع.
--  ٢) **حذف الحساب لا يحدث أبداً.** `soft_delete_my_account` تضع `purge_after`
--     بعد ٣٠ يوماً، و`purge_expired_accounts()` موجودة — **ولا كرون يناديها**.
--     وأربعة نصوص في الواجهة تَعِد بالمحو النهائي. وأسوأ من ذلك: تلك الدالّة
--     تمسح صفّ المستخدم، و`bookings.user_id` و`store_id` كلاهما CASCADE — أي
--     أن تفعيلها كما هي **يمسح طلبات التجار وفواتيرهم الضريبية معها**.
--  ٣) **الموافقة القانونية تُدهَس.** بطاقة بوابة الدفع تكتب نسخة اتفاقيّتها في
--     نفس العمود `users.consent_terms_version`، فضاع أثرُ أي إصدارِ شروطٍ وافق
--     عليه اثنان من ستّة مستخدمين. و`consent_ip` فارغ عند **الجميع** بينما
--     الشروط تَعِد بتسجيله. ولا ذكر للسنّ في أي موضع.
--
-- ── القرارات (من ناصر، ١٣ سبتمبر) ─────────────────────────────────────────
--  • «ليس عنوان الطلب وإنما تتبّع الموقع، أمّا الفاتورة فتبقى» ⇒ صفّ التتبّع
--    يُحذف بعد ساعة من إغلاق الطلب، وعنوان الطلب داخل الطلب يبقى ما بقي.
--  • «امسح بياناته الشخصية وأبقِ الطلبات بلا هوية» ⇒ تجهيلٌ لا حذف.
--  • «١٨ سنة».
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

-- ═══ ١) تتبّع التوصيل: ساعة واحدة ثم يُمحى الصفّ ══════════════════════════
CREATE OR REPLACE FUNCTION public.taki_expire_delivery_tracks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_wiped integer; v_deleted integer;
BEGIN
  -- (أ) طلبٌ في الطريق توقّف بثّه ساعةً: يُغلق ويُمحى موقعه. كانت ستّ ساعات،
  --     وهي مدّة يبقى فيها آخر موقع معروف للمندوب قابلاً للقراءة بلا داعٍ.
  UPDATE public.delivery_tracks
     SET status = 'cancelled', lat = NULL, lng = NULL, accuracy_m = NULL,
         heading = NULL, speed_kmh = NULL, remaining_km = NULL, eta_min = NULL,
         ended_at = now(), updated_at = now()
   WHERE status IN ('on_the_way','arrived')
     AND updated_at < now() - interval '1 hour';
  GET DIAGNOSTICS v_wiped = ROW_COUNT;

  -- (ب) وبعد ساعة من إغلاق الطلب **يُحذف الصفّ كلّه**. محوُ الإحداثيات وحده
  --     كان يُبقي سجلّاً دائماً يقول «هذا المشتري استلم توصيلاً من هذا المتجر
  --     في هذا الوقت» — وما لا يُخزَّن لا يُسرَّب. أثر التسليم يبقى على الطلب
  --     نفسه وفاتورته، وهو ما يحتاجه الطرفان عند أي خلاف.
  DELETE FROM public.delivery_tracks
   WHERE COALESCE(ended_at, updated_at) < now() - interval '1 hour'
     AND status IN ('delivered','cancelled');
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_wiped + v_deleted;
END
$fn$;

REVOKE ALL ON FUNCTION public.taki_expire_delivery_tracks() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_expire_delivery_tracks() FROM anon;
REVOKE ALL ON FUNCTION public.taki_expire_delivery_tracks() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_expire_delivery_tracks() TO service_role;

-- كل ١٥ دقيقة بدل كل ساعة: وعدُ «ساعة» يجب ألّا يصير ساعتين لأن الكرون بطيء.
SELECT cron.unschedule('taki-delivery-track-expiry')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'taki-delivery-track-expiry');
SELECT cron.schedule('taki-delivery-track-expiry', '*/15 * * * *',
                     'SELECT public.taki_expire_delivery_tracks();');

-- ═══ ٢) حذف الحساب: تجهيلٌ لا محو، والطلبات تبقى بلا هوية ═════════════════
-- 🔴 `purge_expired_accounts()` القديمة كانت `DELETE FROM users`، و
-- `bookings.user_id` و`bookings.store_id` كلاهما ON DELETE CASCADE — فتفعيلها
-- كان سيمسح مبيعات التجار وفواتيرهم الضريبية مع حساب مشترٍ واحد.
CREATE OR REPLACE FUNCTION public.purge_expired_accounts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_n integer := 0; r record;
BEGIN
  FOR r IN
    SELECT id FROM public.users
     WHERE purge_after IS NOT NULL AND purge_after < now()
       AND COALESCE(is_anonymized, false) = false
  LOOP
    -- (أ) البيانات الشخصية تُمحى نهائياً
    UPDATE public.users
       SET name = 'مستخدم محذوف',
           shop = NULL, bio = NULL, address = NULL, avatar_url = NULL,
           phone = NULL, contact_phone = NULL,
           email = 'deleted+' || substr(md5(id), 1, 12) || '@takisa.invalid',
           lat = NULL, lng = NULL,
           delivery_address = NULL,
           notif_keywords = NULL, smart_alerts = NULL, followed_merchants = NULL,
           telegram_id = NULL, telegram_chat_id = NULL, whatsapp_chat_id = NULL,
           telegram_link_otp = NULL, telegram_link_otp_expires_at = NULL,
           consent_ip = NULL, consent_user_agent = NULL,
           is_anonymized = true, anonymized_at = now(),
           purge_after = NULL
     WHERE id = r.id;

    -- (ب) وما يحمل هويّته خارج صفّه
    DELETE FROM public.user_addresses     WHERE user_id = r.id;
    DELETE FROM public.push_subscriptions WHERE user_id = r.id;
    DELETE FROM public.delivery_tracks    WHERE user_id = r.id;
    UPDATE public.bookings SET user_name = NULL, user_phone = NULL WHERE user_id = r.id;

    -- (ج) والطلبات تبقى كما هي: سجلّ التاجر وفواتيره الضريبية ملكه، والنظام
    --     يُلزمه بحفظها. لا اسم فيها ولا جوال بعد اليوم.
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$fn$;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_anonymized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;

REVOKE ALL ON FUNCTION public.purge_expired_accounts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_expired_accounts() FROM anon;
REVOKE ALL ON FUNCTION public.purge_expired_accounts() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_accounts() TO service_role;

SELECT cron.unschedule('taki-account-purge')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'taki-account-purge');
SELECT cron.schedule('taki-account-purge', '5 1 * * *', 'SELECT public.purge_expired_accounts();');

-- سجلّ النشاط: الخصوصيّة تَعِد بحدٍّ زمني، والدالّة موجودة بلا كرون منذ البداية
-- (أقدم صفّ عمره ١٢٦ يوماً). جدولتُها تجعل النصّ صادقاً.
SELECT cron.unschedule('taki-activity-cleanup')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'taki-activity-cleanup');
SELECT cron.schedule('taki-activity-cleanup', '35 1 * * *', 'SELECT public.cleanup_old_activity();');

COMMIT;

-- ═══ ٣) الموافقة: إصدار الشروط لا تدهسه اتفاقيّة أخرى + السنّ + العنوان ═══
BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS gateway_agreement_version text,
  ADD COLUMN IF NOT EXISTS gateway_agreement_at      timestamptz,
  ADD COLUMN IF NOT EXISTS consent_age_confirmed     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_min_age           integer;

COMMENT ON COLUMN public.users.consent_age_confirmed IS
  'أقرّ المستخدم بأنه أتمّ السنّ الأدنى وقت التسجيل. يُخزَّن الإقرار لا تاريخ الميلاد — أقلّ بيانٍ يكفي للغرض.';

/* v14.19 — دالّة الموافقة:
   • عنوان الإنترنت يُشتقّ **على الخادم** من ترويسة الطلب. كان العميل يُمرّر
     `null` دائماً، والشروط تَعِد بتسجيله — وعدٌ لم يُنفَّذ قطّ (٠ من ٦).
   • `p_kind='gateway'` تكتب في عمودها الخاص فلا تدهس إصدار الشروط.
   • السنّ يُسجَّل إقراراً ورقماً. */
-- 🪤 إضافة معاملات بقيم افتراضية **لا تستبدل** التوقيع القديم: يبقى الاثنان،
-- فيصير نداء بثلاثة معاملات مطابقاً لكليهما ⇒ «function is not unique».
-- الحذف أولاً، صراحةً وبلا CASCADE.
DROP FUNCTION IF EXISTS public.record_user_consent(text, text, text);

CREATE OR REPLACE FUNCTION public.record_user_consent(
  p_terms_version text,
  p_ip            text DEFAULT NULL,
  p_user_agent    text DEFAULT NULL,
  p_kind          text DEFAULT 'terms',
  p_min_age       integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me   text := (SELECT auth.uid()::text);
  v_ip   text;
  v_prev text;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('changed', false, 'error', 'AUTH_REQUIRED'); END IF;

  -- العنوان من الترويسة لا من العميل: ما يُمرّره المتصفّح عن نفسه ليس دليلاً.
  BEGIN
    v_ip := NULLIF(split_part(COALESCE(
      current_setting('request.headers', true)::json->>'x-forwarded-for',
      current_setting('request.headers', true)::json->>'x-real-ip', ''), ',', 1), '');
  EXCEPTION WHEN OTHERS THEN v_ip := NULL; END;
  v_ip := COALESCE(btrim(v_ip), NULLIF(btrim(COALESCE(p_ip, '')), ''));

  IF p_kind = 'gateway' THEN
    UPDATE public.users
       SET gateway_agreement_version = p_terms_version,
           gateway_agreement_at = now()
     WHERE id = v_me;
    RETURN jsonb_build_object('changed', true, 'kind', 'gateway');
  END IF;

  SELECT consent_terms_version INTO v_prev FROM public.users WHERE id = v_me;
  IF v_prev IS NOT DISTINCT FROM p_terms_version AND p_min_age IS NULL THEN
    RETURN jsonb_build_object('changed', false);
  END IF;

  UPDATE public.users
     SET consent_terms_at      = now(),
         consent_privacy_at    = now(),
         consent_refund_at     = now(),
         consent_terms_version = p_terms_version,
         consent_ip            = COALESCE(v_ip, consent_ip),
         consent_user_agent    = COALESCE(NULLIF(btrim(COALESCE(p_user_agent, '')), ''), consent_user_agent),
         consent_age_confirmed = CASE WHEN p_min_age IS NOT NULL THEN true ELSE consent_age_confirmed END,
         consent_min_age       = COALESCE(p_min_age, consent_min_age)
   WHERE id = v_me;

  RETURN jsonb_build_object('changed', true, 'kind', 'terms', 'ip_recorded', v_ip IS NOT NULL);
END
$fn$;

REVOKE ALL ON FUNCTION public.record_user_consent(text,text,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_user_consent(text,text,text,text,integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_user_consent(text,text,text,text,integer) TO authenticated, service_role;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- جدول التحقّق — أوّل سطر فيه اسم الخادم
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS "الفحص",
       COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'standard public schema') AS "النتيجة",
       CASE WHEN COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') NOT LIKE 'TAKI_LAB_TOKYO%'
            THEN '✅ جدة (إنتاج)' ELSE '❌ المختبر' END AS "الحالة";

SELECT 'تتبّع التوصيل يُحذف بعد ساعة' AS "الفحص",
       CASE WHEN pg_get_functiondef('public.taki_expire_delivery_tracks()'::regprocedure) LIKE '%DELETE FROM public.delivery_tracks%'
            THEN 'يُحذف' ELSE 'يبقى' END AS "النتيجة",
       CASE WHEN pg_get_functiondef('public.taki_expire_delivery_tracks()'::regprocedure) LIKE '%DELETE FROM public.delivery_tracks%'
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'كرون التتبّع كل ربع ساعة' AS "الفحص",
       COALESCE((SELECT schedule FROM cron.job WHERE jobname='taki-delivery-track-expiry'),'—') AS "النتيجة",
       CASE WHEN (SELECT schedule FROM cron.job WHERE jobname='taki-delivery-track-expiry') = '*/15 * * * *'
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'حذف الحساب = تجهيل لا محو (الطلبات تبقى)' AS "الفحص",
       CASE WHEN pg_get_functiondef('public.purge_expired_accounts()'::regprocedure) LIKE '%is_anonymized%'
             AND pg_get_functiondef('public.purge_expired_accounts()'::regprocedure) NOT LIKE '%DELETE FROM public.users%'
            THEN 'تجهيل' ELSE 'محو' END AS "النتيجة",
       CASE WHEN pg_get_functiondef('public.purge_expired_accounts()'::regprocedure) LIKE '%is_anonymized%'
             AND pg_get_functiondef('public.purge_expired_accounts()'::regprocedure) NOT LIKE '%DELETE FROM public.users%'
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'كرون حذف الحساب مجدول (كان غائباً)' AS "الفحص",
       COALESCE((SELECT schedule FROM cron.job WHERE jobname='taki-account-purge'),'—') AS "النتيجة",
       CASE WHEN EXISTS (SELECT 1 FROM cron.job WHERE jobname='taki-account-purge') THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'كرون تنظيف سجلّ النشاط' AS "الفحص",
       COALESCE((SELECT schedule FROM cron.job WHERE jobname='taki-activity-cleanup'),'—') AS "النتيجة",
       CASE WHEN EXISTS (SELECT 1 FROM cron.job WHERE jobname='taki-activity-cleanup') THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'أعمدة الموافقة الجديدة' AS "الفحص",
       count(*)::text || '/6' AS "النتيجة",
       CASE WHEN count(*) = 6 THEN '✅' ELSE '❌' END AS "الحالة"
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='users'
   AND column_name IN ('gateway_agreement_version','gateway_agreement_at',
                       'consent_age_confirmed','consent_min_age','is_anonymized','anonymized_at');

SELECT 'توقيع واحد لدالّة الموافقة (لا تعارض)' AS "الفحص",
       count(*)::text || '/1' AS "النتيجة",
       CASE WHEN count(*) = 1 THEN '✅' ELSE '❌' END AS "الحالة"
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='record_user_consent';

SELECT 'اتفاقيّة البوابة لا تدهس إصدار الشروط' AS "الفحص",
       CASE WHEN pg_get_functiondef('public.record_user_consent(text,text,text,text,integer)'::regprocedure) LIKE '%gateway_agreement_version%'
            THEN 'عمود مستقلّ' ELSE 'تدهسه' END AS "النتيجة",
       CASE WHEN pg_get_functiondef('public.record_user_consent(text,text,text,text,integer)'::regprocedure) LIKE '%gateway_agreement_version%'
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'عنوان الإنترنت يُشتقّ على الخادم' AS "الفحص",
       CASE WHEN pg_get_functiondef('public.record_user_consent(text,text,text,text,integer)'::regprocedure) LIKE '%x-forwarded-for%'
            THEN 'نعم' ELSE 'لا' END AS "النتيجة",
       CASE WHEN pg_get_functiondef('public.record_user_consent(text,text,text,text,integer)'::regprocedure) LIKE '%x-forwarded-for%'
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'صفوف تتبّع منتهية ستُحذف في الدورة القادمة' AS "الفحص",
       count(*)::text AS "النتيجة", 'ℹ️ للعلم' AS "الحالة"
  FROM public.delivery_tracks
 WHERE COALESCE(ended_at, updated_at) < now() - interval '1 hour'
   AND status IN ('delivered','cancelled');
