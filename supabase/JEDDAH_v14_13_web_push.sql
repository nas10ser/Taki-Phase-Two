-- ═══════════════════════════════════════════════════════════════════════════
-- JEDDAH_v14_13_web_push.sql — تشغيل إشعارات الجوّال (Web Push)
--
-- الحالة قبل هذا الملف (مقيسة على جدة ١٠ سبتمبر ٢٠٢٦):
--   • دالة `send-push` **غير منشورة** على الخادم (المنشور ست دوال ليست منها).
--   • لا مفتاح `VAPID` في بيئة الخادم إطلاقاً (`grep -c VAPID` = صفر).
--   • جدول `push_subscriptions` فيه صفر صفّ.
--   • المشغّل `handle_notification_push` موجود لكنه يقرأ `taki.push_url` من
--     إعداد جلسة غير مضبوط ⇒ يخرج صامتاً من أول سطر منذ اليوم الأول.
--   أي أن كل الأنبوب مبنيّ ومفصول عن الكهرباء.
--
-- ما يفعله هذا الملف:
--   ١) يحفظ **المفتاح العام** لـVAPID في `platform_settings` ويتيح قراءته
--      للمتصفّح (هو عامٌّ بطبيعته — المتصفّح يحتاجه ليشترك). فلا حاجة لمتغيّر
--      بناء على Vercel ولا خطوة يدوية على ناصر.
--   ٢) يولّد **سرّاً مشتركاً** داخل الخزنة ويُرسله المشغّل في ترويسة لكل نداء.
--      🔒 ضروري: خادم الدوال عندنا `FUNCTIONS_VERIFY_JWT=false` (لأن المشغّل لا
--      يحمل JWT)، فبلا هذا السرّ يستطيع أي أحد دفع إشعار باسم أي مستخدم.
--   ٣) يعيد كتابة `handle_notification_push` ليقرأ العنوان والسرّ من الخزنة
--      لا من `current_setting`. 🪤 `ALTER DATABASE … SET` لا يسري إلا على
--      الاتصالات الجديدة، واتصالات PostgREST مُجمَّعة وطويلة العمر — فكان
--      الإعداد سيبقى غائباً عن الجلسات القائمة بلا أي خطأ ظاهر.
--   ٤) ينظّف اشتراكات الأجهزة الميتة أسبوعياً (لم تُستعمل منذ ٩٠ يوماً).
--
-- المفتاح **الخاص** لا يمرّ من هنا ولا من المستودع: يُضبط في بيئة حاوية الدوال.
--
-- آمنة للتكرار (idempotent) — تُنفَّذ مرّات بلا أثر جانبي.
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

-- ═══ ١) المفتاح العام لـVAPID — يقرؤه المتصفّح ليشترك ═════════════════════
INSERT INTO public.platform_settings (key, value, description)
VALUES (
  'vapid_public_key',
  '"BBFwtOQcohJMOyCv999C7l914x2F9wCF-3bJGT7gbDvmHBAQ2UPjlTWvZxa_57lSej-2IBxCPgK7KVa-DkufxUY"'::jsonb,
  'المفتاح العام لإشعارات الجوّال (Web Push). عامٌّ بطبيعته — المتصفّح يحتاجه ليشترك. نظيره الخاص في بيئة حاوية الدوال وحدها.'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description;

-- قائمة السماح بالقراءة. 🪤 مفتاحٌ غائب عنها يُقرأ صفر صفوف **بلا خطأ ظاهر**
-- فيقع الموقع على افتراضاته (هذا بالضبط ما وقع في v14.10b).
DROP POLICY IF EXISTS platform_settings_select ON public.platform_settings;
CREATE POLICY platform_settings_select ON public.platform_settings
  FOR SELECT USING (
    key = ANY (ARRAY[
      'oauth_google_enabled','oauth_apple_enabled','telegram_bot_enabled',
      'whatsapp_bot_enabled','whatsapp_bot_number','seasonal_theme',
      'season_campaign','sponsor_layout','banner_autoplay_seconds',
      'payment_gateway_enabled','tax_settings','location_packages',
      'booking_holds','vapid_public_key'
    ])
    OR (SELECT public.is_admin())
  );

-- ═══ ٢) السرّ المشترك: يولَّد داخل الخزنة ولا يمرّ بالمستودع ══════════════
DO $s$
DECLARE v_name text := 'app_secret:push_shared_secret';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = v_name) THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'hex'), v_name,
      'سرّ ترويسة x-push-secret بين مشغّل الإشعارات ودالة send-push');
  END IF;
END
$s$;

-- عنوان الدالة كما تراه القاعدة: داخل شبكة الحاويات — لا يخرج للإنترنت ولا
-- يمرّ بـTLS، فأسرع وأقلّ عرضةً للانقطاع من العنوان العام.
DO $u$
DECLARE v_name text := 'app_secret:push_url';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = v_name) THEN
    PERFORM vault.create_secret(
      'http://kong:8000/functions/v1/send-push', v_name,
      'عنوان دالة إشعارات الجوّال داخل شبكة الحاويات');
  END IF;
END
$u$;

-- ═══ ٣) المشغّل: يقرأ من الخزنة ويحمل السرّ في ترويسة ═════════════════════
CREATE OR REPLACE FUNCTION public.handle_notification_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_url    text;
  v_secret text;
BEGIN
  BEGIN
    SELECT value INTO v_url    FROM public.app_secrets WHERE key = 'push_url';
    SELECT value INTO v_secret FROM public.app_secrets WHERE key = 'push_shared_secret';
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;   -- الخزنة غير متاحة: لا نُسقط الإشعار نفسه أبداً
  END;
  IF coalesce(v_url, '') = '' OR coalesce(v_secret, '') = '' THEN
    RETURN NEW;
  END IF;

  -- لا مشترك = لا نداء. يوفّر نداءً لكل إشعار لمستخدم بلا جهاز مسجَّل،
  -- وهي الحالة الغالبة اليوم (١١٧٧ إشعاراً مقابل صفر اشتراك).
  IF NOT EXISTS (SELECT 1 FROM public.push_subscriptions WHERE user_id = NEW.user_id) THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := v_url,
      body := jsonb_build_object(
        'userId',  NEW.user_id,
        'titleAr', NEW.title_ar,
        'titleEn', NEW.title_en,
        'bodyAr',  NEW.body_ar,
        'bodyEn',  NEW.body_en,
        'type',    NEW.type,
        'data',    NEW.meta_data,
        'notifId', NEW.id
      ),
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-push-secret', v_secret
      ),
      timeout_milliseconds := 5000
    );
  EXCEPTION WHEN OTHERS THEN
    -- إشعارٌ في القاعدة أهمّ من دفعةٍ فشلت: لا تُجهض الإدراج أبداً.
    NULL;
  END;
  RETURN NEW;
END;
$function$;

-- ═══ ٤) كنس الأجهزة الميتة أسبوعياً ═══════════════════════════════════════
-- الدالة تحذف ما يرفضه المزوّد بـ410 لحظياً، وهذه تلتقط ما لم يعد يُستعمل
-- أصلاً (جهاز بِيع أو متصفّح أُلغي) فلا ينمو الجدول بلا سقف.
CREATE OR REPLACE FUNCTION public.prune_push_subscriptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.push_subscriptions
   WHERE coalesce(last_used_at, created_at) < now() - interval '90 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$fn$;

REVOKE ALL ON FUNCTION public.prune_push_subscriptions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prune_push_subscriptions() FROM anon;
REVOKE ALL ON FUNCTION public.prune_push_subscriptions() FROM authenticated;

SELECT cron.unschedule('taki-push-prune')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'taki-push-prune');
SELECT cron.schedule('taki-push-prune', '17 4 * * 0', 'SELECT public.prune_push_subscriptions();');

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- جدول التحقّق — أوّل سطر فيه اسم الخادم
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS "الفحص",
       COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'standard public schema')
         || ' @ ' || COALESCE(inet_server_addr()::text, current_setting('cluster_name', true), 'local') AS "النتيجة",
       CASE WHEN COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') NOT LIKE 'TAKI_LAB_TOKYO%'
            THEN '✅ جدة (إنتاج)' ELSE '❌ المختبر' END AS "الحالة";

SELECT 'المفتاح العام محفوظ' AS "الفحص",
       left(COALESCE((SELECT value #>> '{}' FROM public.platform_settings WHERE key='vapid_public_key'),'—'), 18) || '…' AS "النتيجة",
       CASE WHEN length(COALESCE((SELECT value #>> '{}' FROM public.platform_settings WHERE key='vapid_public_key'),'')) = 87
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'المتصفّح يستطيع قراءته' AS "الفحص",
       CASE WHEN pg_get_expr(polqual, polrelid) LIKE '%vapid_public_key%' THEN 'نعم' ELSE 'لا' END AS "النتيجة",
       CASE WHEN pg_get_expr(polqual, polrelid) LIKE '%vapid_public_key%' THEN '✅' ELSE '❌' END AS "الحالة"
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
 WHERE c.relname = 'platform_settings' AND p.polname = 'platform_settings_select';

SELECT 'سرّ الترويسة وعنوان الدالة في الخزنة' AS "الفحص",
       count(*)::text || '/2' AS "النتيجة",
       CASE WHEN count(*) = 2 THEN '✅' ELSE '❌' END AS "الحالة"
  FROM public.app_secrets WHERE key IN ('push_shared_secret','push_url');

SELECT 'المشغّل يقرأ الخزنة ويحمل السرّ' AS "الفحص",
       CASE WHEN pg_get_functiondef('public.handle_notification_push()'::regprocedure) LIKE '%x-push-secret%'
            THEN 'نعم' ELSE 'لا' END AS "النتيجة",
       CASE WHEN pg_get_functiondef('public.handle_notification_push()'::regprocedure) LIKE '%x-push-secret%'
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'كنس الأجهزة الميتة مجدول' AS "الفحص",
       COALESCE((SELECT schedule FROM cron.job WHERE jobname='taki-push-prune'),'—') AS "النتيجة",
       CASE WHEN EXISTS (SELECT 1 FROM cron.job WHERE jobname='taki-push-prune') THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'pg_net جاهز' AS "الفحص",
       COALESCE((SELECT extversion FROM pg_extension WHERE extname='pg_net'),'—') AS "النتيجة",
       CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN '✅' ELSE '❌' END AS "الحالة";
