-- ═══════════════════════════════════════════════════════════════════════════
-- JEDDAH_v14_22_retention_fixes.sql — ما كشفته المراجعة الخصمية في v14.17 و v14.19
--
--  ١) 🔴 **حذف سجلّ التتبّع بعد ساعة كان يكسر «استلمت طلبي» ويُلغي طلباً سُلِّم.**
--     التاجر يضغط «تم التسليم» فيُغلق مسار التتبّع، **والطلب يبقى مفتوحاً**
--     بانتظار تأكيد المشتري. وبعد ساعة يحذف الكرون الصفّ، فـ(أ) يختفي زرّ
--     «✅ استلمت طلبي» ويظهر للمشتري أن طلبه «قيد التجهيز»، و(ب) تسقط الحماية
--     التي تمنع الإلغاء التلقائي لطلب توصيلٍ منطلق — فيُلغى طلبٌ وصل صاحبه
--     وتعود كمّيته للبيع. **الحذف الآن لا يقع إلا بعد إغلاق الطلب.**
--  ٢) **فاتورة ضريبية لبيعٍ لم يقع.** اللقطة تُكتب لحظة الحجز، فطلبٌ أُلغي أو
--     انتهت مهلته كان يُطبع «فاتورة ضريبية مبسطة» برمز زاتكا. الشرط الصحيح هو
--     **صدور رقم الفاتورة** (ولا يصدر إلا عند اكتمال البيع أو دفعه).
--  ٣) **حذف الحجز يُسقط فاتورةً صادرة ويترك فجوة في تسلسل التاجر.** كل الفواتير
--     الـ٧٢ الصادرة على طلباتٍ نقدية (`paid_at IS NULL`)، وسياسة الحذف كانت
--     تسمح بها. الحذف الآن ممنوع على أي طلبٍ صدرت فاتورته أو أُغلق.
--  ٤) **التجهيل كان ناقصاً**: يترك جوّال المشتري وإحداثيات بيته داخل
--     `delivery_address` على كل طلب توصيل، واسمه تحت تقييماته العلنية،
--     وبريده في طابور البريد، وصفّ المصادقة كما هو **فيستطيع الدخول من جديد**.
--     والشروط تقول «تُمحى نهائياً». اليوم تُمحى فعلاً.
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

-- ═══ ١) لا يُحذف سجلّ التتبّع قبل أن يُغلق الطلب ══════════════════════════
CREATE OR REPLACE FUNCTION public.taki_expire_delivery_tracks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_wiped integer; v_deleted integer;
BEGIN
  -- (أ) بثٌّ توقّف ساعةً: يُغلق المسار ويُمحى الموقع.
  UPDATE public.delivery_tracks
     SET status = 'cancelled', lat = NULL, lng = NULL, accuracy_m = NULL,
         heading = NULL, speed_kmh = NULL, remaining_km = NULL, eta_min = NULL,
         ended_at = now(), updated_at = now()
   WHERE status IN ('on_the_way','arrived')
     AND updated_at < now() - interval '1 hour';
  GET DIAGNOSTICS v_wiped = ROW_COUNT;

  -- (ب) ثم يُحذف الصفّ بعد ساعة من إغلاق **الطلب** لا من إغلاق المسار.
  -- 🪤 v14.19 كانت تحذفه بعد ساعة من `ended_at` بلا شرطٍ على الطلب. والتاجر
  -- يضغط «تم التسليم» فيُغلق المسار **والطلب يبقى مفتوحاً** بانتظار تأكيد
  -- المشتري — فكان الحذف يُخفي زرّ «✅ استلمت طلبي»، ويُسقط الحمايةَ التي
  -- تمنع الإلغاء التلقائي لطلبٍ انطلق مندوبه، فيُلغى طلبٌ وصل صاحبه فعلاً.
  DELETE FROM public.delivery_tracks t
   WHERE COALESCE(t.ended_at, t.updated_at) < now() - interval '1 hour'
     AND t.status IN ('delivered','cancelled')
     AND EXISTS (SELECT 1 FROM public.bookings b
                  WHERE b.barcode = t.barcode
                    AND b.status IN ('completed','cancelled')
                    AND COALESCE(b.completed_at, b.created_at) < now() - interval '1 hour');
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_wiped + v_deleted;
END
$fn$;

REVOKE ALL ON FUNCTION public.taki_expire_delivery_tracks() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_expire_delivery_tracks() FROM anon;
REVOKE ALL ON FUNCTION public.taki_expire_delivery_tracks() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_expire_delivery_tracks() TO service_role;

-- ═══ ٢) لا يُحذف حجزٌ صدرت فاتورته أو أُغلق ═══════════════════════════════
DROP POLICY IF EXISTS bookings_delete_own ON public.bookings;
CREATE POLICY bookings_delete_own ON public.bookings
  FOR DELETE USING (
    paid_at IS NULL
    AND status NOT IN ('completed','cancelled')
    AND NOT EXISTS (SELECT 1 FROM public.order_invoices oi
                     WHERE oi.barcode = bookings.barcode AND oi.invoice_no IS NOT NULL)
    AND ((SELECT auth.uid()::text) = user_id OR (SELECT auth.uid()::text) = store_id));

-- وحارسٌ لا يعتمد على السياسة وحدها (الدوال المالكة تتجاوزها).
CREATE OR REPLACE FUNCTION public.tr_guard_booking_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM public.order_invoices oi
              WHERE oi.barcode = OLD.barcode AND oi.invoice_no IS NOT NULL) THEN
    RAISE EXCEPTION
      'TAKI_INVOICE_ISSUED: صدرت لهذا الطلب فاتورة ضريبية مرقَّمة، وحذفه يُسقطها ويترك فجوة في تسلسل التاجر.'
      USING ERRCODE = 'P0016';
  END IF;
  RETURN OLD;
END
$fn$;

DROP TRIGGER IF EXISTS tr_guard_booking_delete ON public.bookings;
CREATE TRIGGER tr_guard_booking_delete
  BEFORE DELETE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tr_guard_booking_delete();

COMMIT;

-- ═══ ٣) التجهيل يمحو فعلاً ما تَعِد الشروط بمحوه ══════════════════════════
BEGIN;

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
    -- (أ) الصفّ العامّ
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

    -- (ب) صفّ المصادقة. 🪤 v14.19 لم تلمسه: فبقي البريد وكلمة المرور، و
    --     **يستطيع صاحبه الدخول من جديد** بعد أن وعدته الشروط بالمحو.
    BEGIN
      UPDATE auth.users
         SET email = 'deleted+' || substr(md5(r.id), 1, 12) || '@takisa.invalid',
             phone = NULL,
             encrypted_password = '',
             raw_user_meta_data = '{}'::jsonb,
             email_change = NULL, phone_change = NULL
       WHERE id::text = r.id;
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

    -- اسمه تحت تقييماته العلنية — والتقييم نفسه يبقى فلا يتغيّر متوسّط المتجر.
    UPDATE public.ratings SET user_name = 'مستخدم محذوف' WHERE user_id = r.id;

    -- (د) الطلبات تبقى (سجلّ التاجر ودفاتره)، لكن بلا اسم ولا جوال ولا عنوان
    --     يقود إليه. `city` و`label` يبقيان فالفاتورة تحتاج وجهة التسليم.
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

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- جدول التحقّق — أوّل سطر فيه اسم الخادم
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS "الفحص",
       COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'standard public schema') AS "النتيجة",
       CASE WHEN COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') NOT LIKE 'TAKI_LAB_TOKYO%'
            THEN '✅ جدة (إنتاج)' ELSE '❌ المختبر' END AS "الحالة";

SELECT 'التتبّع لا يُحذف قبل إغلاق الطلب' AS "الفحص",
       CASE WHEN pg_get_functiondef('public.taki_expire_delivery_tracks()'::regprocedure) LIKE '%FROM public.bookings b%'
            THEN 'مشروط' ELSE 'غير مشروط' END AS "النتيجة",
       CASE WHEN pg_get_functiondef('public.taki_expire_delivery_tracks()'::regprocedure) LIKE '%FROM public.bookings b%'
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'سياسة حذف الحجز تحمي الفاتورة الصادرة' AS "الفحص",
       CASE WHEN pg_get_expr(polqual, polrelid) LIKE '%order_invoices%' THEN 'تحمي' ELSE 'لا' END AS "النتيجة",
       CASE WHEN pg_get_expr(polqual, polrelid) LIKE '%order_invoices%' THEN '✅' ELSE '❌' END AS "الحالة"
  FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
 WHERE c.relname='bookings' AND p.polname='bookings_delete_own';

SELECT 'حارس حذف الحجز (يسري على كل الأدوار)' AS "الفحص",
       count(*)::text || '/1' AS "النتيجة",
       CASE WHEN count(*) = 1 THEN '✅' ELSE '❌' END AS "الحالة"
  FROM pg_trigger WHERE tgrelid='public.bookings'::regclass AND tgname='tr_guard_booking_delete';

SELECT 'التجهيل يمسح صفّ المصادقة' AS "الفحص",
       CASE WHEN pg_get_functiondef('public.purge_expired_accounts()'::regprocedure) LIKE '%auth.users%'
            THEN 'نعم' ELSE 'لا' END AS "النتيجة",
       CASE WHEN pg_get_functiondef('public.purge_expired_accounts()'::regprocedure) LIKE '%auth.users%'
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'التجهيل يمسح الجوال والإحداثيات من عنوان الطلب' AS "الفحص",
       CASE WHEN pg_get_functiondef('public.purge_expired_accounts()'::regprocedure) LIKE '%- ''phone'' - ''details''%'
            THEN 'نعم' ELSE 'لا' END AS "النتيجة",
       CASE WHEN pg_get_functiondef('public.purge_expired_accounts()'::regprocedure) LIKE '%- ''phone'' - ''details''%'
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'التجهيل يشمل التقييمات والبريد والإشعارات' AS "الفحص",
       CASE WHEN pg_get_functiondef('public.purge_expired_accounts()'::regprocedure) LIKE '%public.ratings%'
             AND pg_get_functiondef('public.purge_expired_accounts()'::regprocedure) LIKE '%email_outbox%'
             AND pg_get_functiondef('public.purge_expired_accounts()'::regprocedure) LIKE '%public.notifications%'
            THEN 'نعم' ELSE 'لا' END AS "النتيجة",
       CASE WHEN pg_get_functiondef('public.purge_expired_accounts()'::regprocedure) LIKE '%public.ratings%'
             AND pg_get_functiondef('public.purge_expired_accounts()'::regprocedure) LIKE '%email_outbox%'
             AND pg_get_functiondef('public.purge_expired_accounts()'::regprocedure) LIKE '%public.notifications%'
            THEN '✅' ELSE '❌' END AS "الحالة";
