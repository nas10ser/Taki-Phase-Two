-- ═══════════════════════════════════════════════════════════════════════════
-- JEDDAH_v14_20_delete_guard.sql — ثغرة حذف الحساب تمسح طلبات التجار وفواتيرهم
--
-- 🔴 كُشفت بمراجعة خصمية لعمل اليوم، ومقيسة على جدة:
--   `public.users` تمنح `authenticated` صلاحية DELETE، وسياسة `users_delete_own`
--   تسمح لكل مستخدم بمسح صفّه، ولا مشغّل BEFORE DELETE يحرسها. و
--   `bookings.user_id` و`bookings.store_id` كلاهما ON DELETE CASCADE، ومن
--   `bookings` تتسلسل `order_invoices` و`booking_refunds`.
--   النتيجة: نداءٌ واحد من المتصفّح `DELETE /users?id=eq.me` يمسح:
--     • طلبات المستخدم المدفوعة (رغم حارس v14.18 الذي يمنع حذف الطلب نفسه)
--     • فواتيرها الضريبية الصادرة (رقمها مُصدَر ومُسلَّم)
--     • وسجلّات الاسترداد التي تُثبت أن مالاً رُدّ أو لم يُردّ
--   و**تاجرٌ يمسح صفّه يمسح معه كل طلبات كل مشتريه وفواتيرهم**.
--   وهو بعينه ما وصفه سجلّ v14.19 خطراً وتجنّبناه في مسار الثلاثين يوماً —
--   بينما كان الباب الأمامي مفتوحاً طوال الوقت.
--
-- العلاج ثلاث طبقات:
--   ١) سحب صلاحية DELETE عن المستخدم وإسقاط سياسة الحذف الذاتي. مسار حذف
--      الحساب المعتمد هو `soft_delete_my_account` ثم التجهيل بعد ٣٠ يوماً.
--   ٢) مشغّل BEFORE DELETE على `users` يرفض حذف صفٍّ له طلبات أو فواتير مهما
--      كان الدور — حتى `service_role` و`postgres`. الحارس الذي يعتمد على
--      الصلاحيات وحدها يسقط بأول دالّة SECURITY DEFINER جديدة.
--   ٣) `delete_user_account` (المسار الاحتياطي في التطبيق) صارت تُحوِّل إلى
--      المسار الناعم بدل مسح صفّ المصادقة.
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

-- ═══ ١) لا حذف ذاتيّ مباشر ════════════════════════════════════════════════
DROP POLICY IF EXISTS users_delete_own ON public.users;
REVOKE DELETE ON TABLE public.users FROM authenticated;
REVOKE DELETE ON TABLE public.users FROM anon;

-- ═══ ٢) حارسٌ لا يعتمد على الصلاحيات ══════════════════════════════════════
CREATE OR REPLACE FUNCTION public.tr_guard_user_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM public.bookings
   WHERE user_id = OLD.id OR store_id = OLD.id;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'TAKI_USER_HAS_ORDERS: هذا الحساب طرفٌ في % طلباً. الطلبات وفواتيرها الضريبية سجلٌّ لا يُمحى بحذف حساب — استعمل حذف الحساب المعتمد (تعطيل ثم تجهيل بعد ٣٠ يوماً).', v_n
      USING ERRCODE = 'P0015';
  END IF;
  RETURN OLD;
END
$fn$;

DROP TRIGGER IF EXISTS tr_guard_user_delete ON public.users;
CREATE TRIGGER tr_guard_user_delete
  BEFORE DELETE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.tr_guard_user_delete();

-- ═══ ٣) المسار الاحتياطي في التطبيق لا يمسح شيئاً ═════════════════════════
CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_uid text := (auth.uid())::text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  -- v14.20 — كانت تمسح صفّ المصادقة فيتسلسل الحذف إلى الطلبات والفواتير.
  -- اليوم تُحوّل إلى المسار المعتمد: تعطيلٌ فوري ثم تجهيلٌ بعد ثلاثين يوماً
  -- مع إمكانية التراجع — وهو ما تَعِد به الشروط حرفياً.
  UPDATE public.users
     SET deleted_at = now(), purge_after = now() + interval '30 days'
   WHERE id = v_uid;
  UPDATE public.deals SET status = 'paused' WHERE store_id = v_uid AND status = 'active';
END
$fn$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- جدول التحقّق — أوّل سطر فيه اسم الخادم
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS "الفحص",
       COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'standard public schema') AS "النتيجة",
       CASE WHEN COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') NOT LIKE 'TAKI_LAB_TOKYO%'
            THEN '✅ جدة (إنتاج)' ELSE '❌ المختبر' END AS "الحالة";

SELECT 'صلاحية حذف المستخدم للمتصفّح' AS "الفحص",
       CASE WHEN has_table_privilege('authenticated','public.users','DELETE')
             OR has_table_privilege('anon','public.users','DELETE') THEN 'موجودة' ELSE 'مسحوبة' END AS "النتيجة",
       CASE WHEN has_table_privilege('authenticated','public.users','DELETE')
             OR has_table_privilege('anon','public.users','DELETE') THEN '❌' ELSE '✅' END AS "الحالة";

SELECT 'سياسة الحذف الذاتي' AS "الفحص",
       count(*)::text || ' (يجب صفر)' AS "النتيجة",
       CASE WHEN count(*) = 0 THEN '✅' ELSE '❌' END AS "الحالة"
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
 WHERE c.relname = 'users' AND p.polcmd = 'd';

SELECT 'حارس الحذف (يسري على كل الأدوار)' AS "الفحص",
       count(*)::text || '/1' AS "النتيجة",
       CASE WHEN count(*) = 1 THEN '✅' ELSE '❌' END AS "الحالة"
  FROM pg_trigger WHERE tgrelid='public.users'::regclass AND tgname='tr_guard_user_delete';

SELECT 'المسار الاحتياطي لا يمسح المصادقة' AS "الفحص",
       CASE WHEN pg_get_functiondef('public.delete_user_account()'::regprocedure) LIKE '%auth.users%'
            THEN 'ما زال يمسح' ELSE 'يُعطّل فقط' END AS "النتيجة",
       CASE WHEN pg_get_functiondef('public.delete_user_account()'::regprocedure) LIKE '%auth.users%'
            THEN '❌' ELSE '✅' END AS "الحالة";
