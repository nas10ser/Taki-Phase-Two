-- ════════════════════════════════════════════════════════════════════════════
-- v14.67 — تذكير التقييم يصل البوتين أيضاً
-- ════════════════════════════════════════════════════════════════════════════
-- من تدقيق ٩ سبتمبر: «تذكير التقييم المؤجَّل الذي أُصلح في الموقع لم يصل
-- البوتين، فمن تجاهل إشعار الإتمام لا يُذكَّر ثانيةً».
--
-- الحلّ **لا يُكتب في البوتين**: `pending_rating_prompts()` تعتمد `auth.uid()`
-- وهي هوية جلسة الويب، والبوتان يعرفان المستخدم بمعرّف تيليجرام/واتساب — فنسخُ
-- المنطق إليهما كان سيصير ثالثَ نسخةٍ من نفس القاعدة. بدلها: **إشعارٌ واحد**
-- يُكتب في الجدول، فيصل الجرسَ في الموقع والبوتين معاً عبر صندوق الصادر
-- القائم (`bot_pull_outbox`) بلا سطرٍ واحد في كود البوت.
--
-- 🪤 النوع `rating` مسموحٌ في قيد الجدول (فُحص) — ولو كُتب نوعٌ خارج القيد
--    لفشل الإدراج وسقطت الوظيفة المجدولة كلّها بصمت.
-- 🪤 ولا يُكرَّر التذكير: البصمة في `meta_data->>'ratingReminder'` هي الباركود،
--    وفحصُها شرطٌ في الإدراج نفسه لا في الكود الذي يناديه.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'رُفض: هذا خادم المختبر (طوكيو) — هجرات الإنتاج تُطبَّق على جدة';
  END IF;
END $guard$;

BEGIN;

CREATE OR REPLACE FUNCTION public.enqueue_rating_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n int := 0;
BEGIN
  WITH due AS (
    SELECT b.barcode, b.user_id, b.deal_id, b.store_id,
           COALESCE(d.shop_name, NULLIF(u.shop, ''), u.name, 'المتجر') AS shop_name
      FROM public.bookings b
      LEFT JOIN public.deals d ON d.id = b.deal_id
      LEFT JOIN public.users u ON u.id = b.store_id
     WHERE b.status = 'completed'
       -- نافذةٌ يومٌ إلى ثلاثة: لا نزاحم إشعار الإتمام نفسه، ولا نُذكّر بعد
       -- أن يبرد الطلب فيصير التذكير إزعاجاً.
       AND b.completed_at >= now() - interval '3 days'
       AND b.completed_at <= now() - interval '1 day'
       AND b.user_id IS NOT NULL
       -- لم يقيّم هذا المتجر بعد
       AND NOT EXISTS (
         SELECT 1 FROM public.ratings r
          WHERE r.user_id = b.user_id AND r.store_id = b.store_id AND r.deleted_at IS NULL
       )
       -- ولم يُذكَّر بهذا الطلب من قبل (البصمة = الباركود)
       AND NOT EXISTS (
         SELECT 1 FROM public.notifications n
          WHERE n.user_id = b.user_id
            AND n.meta_data->>'ratingReminder' = b.barcode
       )
     LIMIT 200          -- سقفٌ لكل تشغيلة فلا تتضخّم دفعةٌ واحدة
  ), ins AS (
    INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
    SELECT due.user_id,
           '⭐ كيف كانت تجربتك؟',
           '⭐ How was your experience?',
           'قيّم ' || due.shop_name || ' في دقيقة — تقييمك يساعد غيرك على الاختيار.',
           'Rate ' || due.shop_name || ' in under a minute — your rating helps other buyers choose.',
           'rating',
           jsonb_build_object(
             'audience', 'buyer',
             'barcode', due.barcode,
             'dealId', due.deal_id,
             'storeId', due.store_id,
             'ratingReminder', due.barcode,
             'actionUrl', '/bookings?barcode=' || due.barcode
           )
      FROM due
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;
  RETURN v_n;
END $function$;

-- لا ينادي هذه الدالةَ مستخدمٌ إطلاقاً — الكرون وحده.
REVOKE ALL ON FUNCTION public.enqueue_rating_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_rating_reminders() FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_rating_reminders() FROM authenticated;

COMMIT;

-- الجدولة: مرّة يومياً ١٠ صباحاً بتوقيت الرياض.
-- 🪤 خادم جدة على +03:00 لا UTC (فخّ موثَّق) — فالساعة هنا محلّية فعلاً.
SELECT cron.unschedule('taki-rating-reminders')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'taki-rating-reminders');
SELECT cron.schedule('taki-rating-reminders', '0 10 * * *',
                     $$SELECT public.enqueue_rating_reminders();$$);

-- ── تحقّقٌ يرفع استثناءً ─────────────────────────────────────────────────────
DO $verify$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_proc
   WHERE proname='enqueue_rating_reminders' AND pronamespace='public'::regnamespace;
  IF n <> 1 THEN RAISE EXCEPTION 'فشل: نسخ enqueue_rating_reminders = %', n; END IF;

  IF has_function_privilege('anon','public.enqueue_rating_reminders()','EXECUTE')
     OR has_function_privilege('authenticated','public.enqueue_rating_reminders()','EXECUTE') THEN
    RAISE EXCEPTION 'فشل: الدالة مكشوفة لمستخدمٍ — الكرون وحده ينادیها';
  END IF;

  SELECT count(*) INTO n FROM cron.job WHERE jobname='taki-rating-reminders';
  IF n <> 1 THEN RAISE EXCEPTION 'فشل: الوظيفة المجدولة غير مسجَّلة (%)', n; END IF;

  -- النوع المستعمل يجب أن يكون ضمن قيد الجدول وإلا سقطت الوظيفة بصمت كل يوم.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.notifications'::regclass AND contype='c'
       AND pg_get_constraintdef(oid) LIKE '%''rating''%'
  ) THEN RAISE EXCEPTION 'فشل: نوع الإشعار rating غير مسموح في القيد'; END IF;
END $verify$;

SELECT 'v14.67 rating reminders' AS "الهجرة",
       (SELECT schedule FROM cron.job WHERE jobname='taki-rating-reminders') AS "الجدولة",
       public.enqueue_rating_reminders() AS "أُرسل الآن";
