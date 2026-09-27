-- ═══════════════════════════════════════════════════════════════════════════
-- JEDDAH_v14_99_operations_log.sql — جرسُ الأدمن يصمت، والعملية تُسجَّل برقمها
-- ═══════════════════════════════════════════════════════════════════════════
-- طلبُ ناصر حرفياً: «لا أريد للأدمن أن يصله إشعار في الإشعارات عن أي عملية
-- تتم، وإنما ضعها في إدارة العمليات في لوحة التحكّم برقم الكود … وأيضاً في
-- لوحة الأدمن كرقم مرجع».
--
-- ما يجري هنا، وما **لا** يجري:
--   ✔ يُحذف من `handle_booking_notification()` **ثلاثُ حلقاتٍ** كانت تُدخل
--     إشعاراً لكل أدمن عند كل حجزٍ وكل إتمام بيعٍ وكل إلغاء/انتهاء مهلة،
--     ويحلّ محلّها سطرٌ واحد في `public.activity_log` بـ`entity_id = barcode`
--     — وهو **رقم المرجع** الذي طلبه.
--   ✘ ولا يُمَسّ إشعارٌ واحد للمشتري أو للتاجر. هما رزقُ المنصّة: تاجرٌ لا
--     يصله «طلب حجز جديد» يخسر الطلب. كلُّ نصٍّ من نصوصهما منقولٌ حرفياً من
--     التعريف الحيّ، ويُتحقَّق من بقائه في كتلة التحقّق أدناه.
--
-- 🔴 لماذا لا يُعاد بناءُ الدالّة من الذاكرة: هي ١٢٨ سطراً تحمل صياغةَ ستّ
--    رسائل بلغتين وفرعَ «إلغاء الاسترداد» الذي أُضيف في v14.21. فالملف هنا
--    **يُثبت أوّلاً** أن النسخة الحيّة هي النسخة التي قرأناها (ببصماتٍ نصّية)،
--    ويرفض التنفيذ إن كانت قد تغيّرت — فلا نُضيّع تعديلاً لا نعلم به
--    (درس v14.96: «يُقرأ تعريفُه الحيّ ولا يُكتب من الحفظ»).
--
-- 🔴 تصحيحٌ لحسابٍ ورد في وصف المهمّة: «activity_log يكسب بالضبط ما حُذف من
--    الإشعارات» **غير صحيح ولا يجوز أن يُفرَض**. الإشعارُ الواحد كان يُنسخ
--    **لكل أدمن** (حدثٌ واحد ⇐ صفٌّ لكل مسؤول)، فحذفُ ٢٤٠ صفّاً يقابله عددٌ
--    أقلّ من صفوف السجلّ: صفٌّ واحد لكل (رمز طلب × حدث). فالشرطُ المفروض هنا
--    هو الشرط الصحيح: **لا مجموعةَ حدثٍ واحدة تضيع** — كلُّ (barcode, event)
--    حُذف له نظيرٌ في `activity_log`، ويُرفع استثناءٌ إن نقص واحد.
--
-- 🪤 ولا تُحذف إشعاراتُ الأدمن الأخرى (الشكاوى · البلاغات · طلبات الاسم ·
--    التوثيق · النبض): تلك **قراراتٌ تنتظره** لا «عملياتٌ تتم». الحذف مقيَّدٌ
--    بـ`type='booking'` وحده.
--
-- آمنة للتكرار (idempotent): الدفعةُ الثانية تجد صفر إشعارٍ إداريّ من نوع
-- `booking` فتنسخ صفراً وتحذف صفراً، والعلامةُ `from_notification` تمنع
-- ازدواجَ أي صفٍّ لو بقي شيءٌ من دفعةٍ سابقة.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- ── ٠) حارسٌ قبل كل شيء: هذه هجرة إنتاج (جدّة) لا المختبر ───────────────────
DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '') LIKE 'TAKI_LAB_TOKYO%' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر (%). أوقِفت.',
      obj_description('public'::regnamespace, 'pg_namespace');
  END IF;

  IF to_regprocedure('public.taki_admin_perm(text)') IS NULL
     OR to_regprocedure('public.taki_norm(text)') IS NULL THEN
    RAISE EXCEPTION 'خادمٌ ينقصه taki_admin_perm/taki_norm — أوقِفت قبل أن أبني على فراغ.';
  END IF;

  IF to_regclass('public.activity_log') IS NULL THEN
    RAISE EXCEPTION 'public.activity_log غير موجود — وهو وجهةُ كل ما يُنزع من جرس الأدمن.';
  END IF;

  -- 🔴 لو كانت RLS **مفروضة** (FORCE) على activity_log لخضع لها المشغّلُ
  --    نفسه رغم SECURITY DEFINER، وسياسةُ الإدراج تشترط `user_id = auth.uid()`
  --    — أي أن صفّ «أكمل التاجر البيع» (والمنادي مشترٍ) كان سيُرفض، فيسقط
  --    **الحجزُ كلّه**. تُقاس الحالة ولا تُفترض.
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.activity_log'::regclass
               AND relforcerowsecurity) THEN
    RAISE EXCEPTION 'activity_log عليها FORCE ROW LEVEL SECURITY — المشغّل سيُرفض إدراجُه فينكسر الحجز. أوقِفت.';
  END IF;

  IF to_regprocedure('public.handle_booking_notification()') IS NULL THEN
    RAISE EXCEPTION 'handle_booking_notification() غير موجودة — لا أُنشئ مشغّل إشعاراتٍ من عدم.';
  END IF;

  -- 🔴 وأخطرُ ما في هذا الملفّ كلّه، ولا يظهر إلا وقت الحجز الأوّل:
  --    `SECURITY DEFINER` **لا يُلغي RLS** — الذي يُلغيها هو أن يكون الدورُ
  --    المنفِّذ مالكَ الجدول أو متخطّياً لها. وسياسةُ الإدراج على activity_log
  --    هي `user_id = auth.uid() OR user_id IS NULL`، بينما المشغّل يكتب
  --    `store_id` عند الإتمام و`user_id` للمشتري عند حجزٍ من البوت
  --    (`auth.uid()` هناك NULL). فلو لم يتخطَّ المالكُ RLS لرُفض الإدراج
  --    ولسقط **الحجزُ كلّه** — لا السجلّ وحده. يُقاس قبل أن يُشحن.
  IF NOT EXISTS (
      SELECT 1
        FROM pg_proc  p
        JOIN pg_class c ON c.oid = 'public.activity_log'::regclass
        JOIN pg_roles r ON r.oid = p.proowner
       WHERE p.oid = 'public.handle_booking_notification()'::regprocedure
         AND (p.proowner = c.relowner OR r.rolsuper OR r.rolbypassrls)) THEN
    RAISE EXCEPTION
      'مالكُ handle_booking_notification لا يتخطّى RLS على activity_log — الإدراج سيُرفض فيسقط كلُّ حجز. أوقِفت. (الحلّ: ALTER FUNCTION … OWNER TO مالكِ الجدول)';
  END IF;
END
$guard$;

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) حارسُ الانحراف: هل النسخةُ الحيّة هي التي قرأناها؟
-- ═══════════════════════════════════════════════════════════════════════════
-- كلُّ بصمةٍ أدناه سطرٌ **يجب أن يبقى** بعد التعديل (رسائل المشتري والتاجر)
-- أو سطرٌ **يجب أن يُنزع** (حلقات الأدمن الثلاث). فإن غاب أحدُها من النسخة
-- الحيّة فمعناه أن أحداً عدّل الدالّة بعد v14.21، وكتابتي فوقها تمحو تعديله.
DO $drift$
DECLARE
  v_src   text;
  v_keep  text[] := ARRAY[
    '📦 طلب حجز جديد!',        -- التاجر — حجز جديد
    '✅ تم الحجز بنجاح!',       -- المشتري — حجز جديد
    '📦 التاجر استلم طلبك!',    -- المشتري — استلام
    '🎉 تم تسليم طلبك!',        -- المشتري — إتمام
    '🎉 تم الاستلام بنجاح!',    -- التاجر — إتمام
    '⏰ انتهت مدة الحجز',       -- المشتري — انتهاء المهلة
    '⚠️ تم إلغاء الحجز',        -- المشتري — إلغاء
    '⏰ انتهى حجز دون استلام',  -- التاجر — انتهاء المهلة
    '⚠️ تم إلغاء حجز',          -- التاجر — إلغاء
    'COALESCE(NEW.cancelled_by, '''') = ''refund'''  -- صمتُ v14.21 عن الاسترداد
  ];
  v_drop  text[] := ARRAY[
    '🛒 حجز جديد على المنصة',  -- الأدمن — حجز جديد
    '💰 إتمام بيع جديد',        -- الأدمن — إتمام بيع
    '↩️ إلغاء حجز'              -- الأدمن — إلغاء/انتهاء
  ];
  v_f     text;
  v_loops int;
BEGIN
  SELECT pg_get_functiondef('public.handle_booking_notification()'::regprocedure) INTO v_src;

  FOREACH v_f IN ARRAY v_keep LOOP
    IF position(v_f IN v_src) = 0 THEN
      RAISE EXCEPTION 'انحراف: النسخة الحيّة لا تحوي «%» — فهي ليست النسخة التي قرأتُها. أوقِفت قبل أن أمحو تعديلاً لا أعلمه.', v_f;
    END IF;
  END LOOP;

  FOREACH v_f IN ARRAY v_drop LOOP
    IF position(v_f IN v_src) = 0 THEN
      RAISE EXCEPTION 'انحراف: حلقةُ الأدمن «%» غير موجودة أصلاً — شخصٌ سبقني إلى هذا التعديل. أوقِفت.', v_f;
    END IF;
  END LOOP;

  -- ثلاثُ حلقاتٍ لا أكثر ولا أقلّ: رابعةٌ تعني مساراً إدارياً لم أقرأه.
  v_loops := (length(v_src) - length(replace(v_src, 'FOR admin_id IN', ''))) / length('FOR admin_id IN');
  IF v_loops <> 3 THEN
    RAISE EXCEPTION 'انحراف: حلقاتُ الأدمن % لا ٣ — النسخة الحيّة تحمل مساراً لم أقرأه. أوقِفت.', v_loops;
  END IF;

  RAISE NOTICE '✅ النسخة الحيّة تطابق ما قرأتُه: ١٠ بصماتٍ باقية · ٣ حلقات أدمن تُنزع.';
END
$drift$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) عدّادات «قبل» — تُحمل إلى كتلة التحقّق في جدولٍ مؤقّت
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 كتلتا DO لا تتبادلان متغيّرات، والرقمُ المكتوب في تعليقٍ ليس قياساً.
CREATE TEMP TABLE _v1499_counts (k text PRIMARY KEY, n bigint) ON COMMIT DROP;

INSERT INTO _v1499_counts (k, n)
SELECT 'notif_admin_booking_before', count(*)
  FROM public.notifications
 WHERE type = 'booking' AND meta_data->>'audience' = 'admin';

INSERT INTO _v1499_counts (k, n)
SELECT 'notif_admin_other_before', count(*)
  FROM public.notifications
 WHERE type <> 'booking' AND meta_data->>'audience' = 'admin';

INSERT INTO _v1499_counts (k, n)
SELECT 'activity_before', count(*) FROM public.activity_log;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) النقل: كل مجموعة (رمز الطلب × الحدث) تصير صفّاً واحداً في السجلّ
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 البياناتُ تُقرأ من **الحجز نفسه** لا من نصّ الإشعار حيثما أمكن: الكمّية
--    والمبلغ المجمَّد (`total_amount`, v14.11) ومن ألغى (`cancelled_by`).
--    والإشعارُ احتياطٌ لحجزٍ لم يعد موجوداً.
-- 🪤 وتُمادّى المجموعاتُ في جدولٍ مؤقّت **قبل** الإدراج لا بعده: بلا ذلك يصير
--    التحقّقُ لاحقاً «كل صفٍّ منقولٍ له صفٌّ بنفس رمزه وفعله» — وهو الصفُّ
--    نفسه، أي شرطٌ **لا يستطيع أن يفشل** (درس v14.50). الآن يُقاس كل صفٍّ
--    بالإشعار الذي وُلد منه، والإشعارُ يُحذف بعد أن يُثبَت له نظير.
CREATE TEMP TABLE _v1499_groups ON COMMIT DROP AS
    SELECT DISTINCT ON (COALESCE(n.meta_data->>'barcode', 'ntf:' || n.id),
                        COALESCE(n.meta_data->>'event', 'unknown'))
           n.id                                              AS notif_id,
           n.created_at                                      AS at,
           COALESCE(n.meta_data->>'event', 'unknown')        AS ev,
           n.meta_data->>'barcode'                           AS code,
           COALESCE(b.store_id, n.meta_data->>'storeId')     AS store_id,
           COALESCE(b.user_id,  n.meta_data->>'buyerId')     AS buyer_id,
           COALESCE(b.deal_id,  n.meta_data->>'dealId')      AS deal_id,
           b.booked_quantity                                 AS qty,
           b.total_amount                                    AS amount,
           b.cancelled_by                                    AS cancelled_by
      FROM public.notifications n
      LEFT JOIN public.bookings b ON b.barcode = n.meta_data->>'barcode'
     WHERE n.type = 'booking'
       AND n.meta_data->>'audience' = 'admin'
       -- 🪤 خاملةُ التكرار: ما نُقل في دفعةٍ سابقة لا يُنقل مرّتين.
       AND NOT EXISTS (
             SELECT 1 FROM public.activity_log a
              WHERE a.metadata->>'from_notification' = n.id)
     ORDER BY COALESCE(n.meta_data->>'barcode', 'ntf:' || n.id),
              COALESCE(n.meta_data->>'event', 'unknown'),
              n.created_at ASC;

-- عددُ مجموعات الحدث — وهو ما **يجب** أن يكسبه السجلّ، لا عدد الإشعارات.
INSERT INTO _v1499_counts (k, n) SELECT 'groups_before', count(*) FROM _v1499_groups;

-- 🪤 و`user_id` يمرّ بمفتاحٍ أجنبيّ إلى `users` (ON DELETE SET NULL)، فحسابٌ
--    مُجهَّل (v14.19) كان سيُفجّر الإدراج بـ23503. لذلك يُقرأ بـ`SELECT` يعود
--    NULL إن غاب صاحبُه، لا بالقيمة الخام.
INSERT INTO public.activity_log (user_id, user_type, action, entity_type, entity_id, metadata, created_at)
SELECT
    -- الفاعل: المشتري في الحجز والإلغاء · التاجر في الإتمام · لا أحد عند انتهاء المهلة.
    (SELECT u.id FROM public.users u WHERE u.id = CASE
        WHEN s.ev = 'completed' THEN s.store_id
        WHEN s.ev = 'expired'   THEN NULL
        WHEN s.ev = 'cancelled' AND COALESCE(s.cancelled_by,'') = 'seller' THEN s.store_id
        ELSE s.buyer_id END),
    CASE
        WHEN s.ev = 'completed' THEN 'seller'
        WHEN s.ev = 'expired'   THEN 'system'
        WHEN s.ev = 'cancelled' AND COALESCE(s.cancelled_by,'') = 'seller' THEN 'seller'
        ELSE 'buyer' END,
    'booking_' || CASE s.ev WHEN 'new' THEN 'created' ELSE s.ev END,
    'booking',
    s.code,
    jsonb_strip_nulls(jsonb_build_object(
        'store_id', s.store_id, 'buyer_id', s.buyer_id, 'deal_id', s.deal_id,
        'quantity', s.qty, 'amount', s.amount, 'event', s.ev,
        'cancelled_by', s.cancelled_by,
        'from_notification', s.notif_id, 'backfilled', true)),
    s.at
  FROM _v1499_groups s;

INSERT INTO _v1499_counts (k, n)
SELECT 'activity_after_backfill', count(*) FROM public.activity_log;

-- والآن يُحذف ما صار له نظير. الحذفُ بعد النسخ لا قبله — وفي المعاملة نفسها.
WITH gone AS (
    DELETE FROM public.notifications
     WHERE type = 'booking' AND meta_data->>'audience' = 'admin'
    RETURNING 1
)
INSERT INTO _v1499_counts (k, n) SELECT 'notif_deleted', count(*) FROM gone;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) المشغّل: نفس الرسائل للمشتري والتاجر حرفياً · والأدمن إلى السجلّ
-- ═══════════════════════════════════════════════════════════════════════════
-- منقولةٌ من التعريف الحيّ (v14.21) بثلاثة تغييراتٍ لا رابع لها:
--   • حلقةُ الأدمن عند الحجز    ⇐ صفُّ `booking_created`
--   • حلقةُ الأدمن عند الإتمام  ⇐ صفُّ `booking_completed`
--   • حلقةُ الأدمن عند الإلغاء  ⇐ صفُّ `booking_cancelled` / `booking_expired`
-- والمتغيّر `admin_id` لم يعد له مستعمل فحُذف تصريحُه.
CREATE OR REPLACE FUNCTION public.handle_booking_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    item_name   TEXT;
    buyer_name  TEXT;
    seller_name TEXT;
    v_expired   boolean;
    v_now       bigint := (EXTRACT(EPOCH FROM NOW())*1000)::bigint;
BEGIN
    SELECT d.item_name INTO item_name FROM public.deals d WHERE d.id = NEW.deal_id;
    item_name := COALESCE(item_name, 'العرض');
    SELECT COALESCE(u.name, u.shop, '') INTO buyer_name FROM public.users u WHERE u.id = NEW.user_id;
    buyer_name := COALESCE(NULLIF(buyer_name, ''), 'مشتري');
    SELECT COALESCE(u.shop, u.name, '') INTO seller_name FROM public.users u WHERE u.id = NEW.store_id;
    seller_name := COALESCE(NULLIF(seller_name, ''), 'التاجر');

    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
        VALUES (NEW.store_id, '📦 طلب حجز جديد!', '📦 New Booking Request!',
            'طلب جديد من ' || buyer_name || ' لـ ' || item_name || ' (' || NEW.booked_quantity || ' قطعة).'
                || CASE WHEN NEW.prep_time IS NOT NULL AND NEW.prep_time <> '' THEN
                       ' 🕒 الوقت: ' || CASE WHEN NEW.prep_time = 'arrival' THEN 'عند الوصول' ELSE replace(NEW.prep_time,'min','') || ' دقيقة' END ELSE '' END
                || CASE WHEN NEW.notes IS NOT NULL AND NEW.notes <> '' THEN ' 📝 ' || NEW.notes ELSE '' END,
            'New order from ' || buyer_name || ' for ' || item_name || ' (' || NEW.booked_quantity || ' pcs).'
                || CASE WHEN NEW.prep_time IS NOT NULL AND NEW.prep_time <> '' THEN
                       ' 🕒 ETA: ' || CASE WHEN NEW.prep_time = 'arrival' THEN 'On arrival' ELSE replace(NEW.prep_time,'min','') || ' min' END ELSE '' END
                || CASE WHEN NEW.notes IS NOT NULL AND NEW.notes <> '' THEN ' 📝 ' || NEW.notes ELSE '' END,
            'booking',
            jsonb_build_object('audience','seller','event','new','barcode',NEW.barcode,'dealId',NEW.deal_id,'quantity',NEW.booked_quantity,'prepTime',NEW.prep_time,'notes',NEW.notes), NOW());

        INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
        VALUES (NEW.user_id, '✅ تم الحجز بنجاح!', '✅ Booking Confirmed!',
            'تم حجز ' || item_name || ' — الرمز: ' || NEW.barcode || '. سيستلم التاجر طلبك قريباً.',
            item_name || ' booked — Code: ' || NEW.barcode || '. The seller will receive your order shortly.',
            'booking', jsonb_build_object('audience','buyer','event','new','barcode',NEW.barcode,'dealId',NEW.deal_id), NOW());

        -- v14.99 — بدل حلقةٍ تُدخل إشعاراً لكل أدمن: سطرٌ واحد في سجلّ العمليات.
        INSERT INTO public.activity_log (user_id, user_type, action, entity_type, entity_id, metadata)
        VALUES ((SELECT u.id FROM public.users u WHERE u.id = NEW.user_id), 'buyer',
                'booking_created', 'booking', NEW.barcode,
                jsonb_strip_nulls(jsonb_build_object(
                    'store_id', NEW.store_id, 'buyer_id', NEW.user_id, 'deal_id', NEW.deal_id,
                    'quantity', NEW.booked_quantity, 'amount', NEW.total_amount,
                    'event', 'new', 'source', NEW.source, 'fulfillment', NEW.fulfillment)));
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.status = 'acknowledged' THEN
            INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
            VALUES (NEW.user_id, '📦 التاجر استلم طلبك!', '📦 Seller received your order!',
                'استلم ' || seller_name || ' طلبك لـ ' || item_name || ' وهو قيد التجهيز الآن.',
                seller_name || ' received your order for ' || item_name || ' and is preparing it now.',
                'booking', jsonb_build_object('audience','buyer','event','acknowledged','barcode',NEW.barcode,'dealId',NEW.deal_id), NOW());

        ELSIF NEW.status = 'completed' THEN
            INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
            VALUES (NEW.user_id, '🎉 تم تسليم طلبك!', '🎉 Order Delivered!',
                'تم تأكيد استلام ' || item_name || ' من ' || seller_name || '. شكراً لاستخدامك تاكي 💚',
                item_name || ' delivery confirmed by ' || seller_name || '. Thanks for using Taki 💚',
                'booking', jsonb_build_object('audience','buyer','event','completed','barcode',NEW.barcode,'dealId',NEW.deal_id), NOW());
            INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
            VALUES (NEW.store_id, '🎉 تم الاستلام بنجاح!', '🎉 Order Delivered!',
                'استلم ' || buyer_name || ' طلب ' || item_name || ' — تم إغلاق الحجز.',
                buyer_name || ' received the order for ' || item_name || ' — booking closed.',
                'booking', jsonb_build_object('audience','seller','event','completed','barcode',NEW.barcode,'dealId',NEW.deal_id), NOW());

            INSERT INTO public.activity_log (user_id, user_type, action, entity_type, entity_id, metadata)
            VALUES ((SELECT u.id FROM public.users u WHERE u.id = NEW.store_id), 'seller',
                    'booking_completed', 'booking', NEW.barcode,
                    jsonb_strip_nulls(jsonb_build_object(
                        'store_id', NEW.store_id, 'buyer_id', NEW.user_id, 'deal_id', NEW.deal_id,
                        'quantity', NEW.booked_quantity, 'amount', NEW.total_amount,
                        'event', 'completed', 'paid', (NEW.paid_at IS NOT NULL))));

        ELSIF NEW.status = 'cancelled' THEN
            -- v14.21 — إلغاءُ استردادٍ له رسائله الخاصّة من `resolve_booking_refund`
            -- (المبلغ والمرجع والإشعار الدائن). وهذا الفرع يحسب «انتهت المهلة» من
            -- `expiry_time`، والدفع لا يمسحه — فكان المشتري الذي رُدّ ماله يتلقّى
            -- فوق إشعار الردّ «⏰ انتهت مدة حجزك فأُلغي تلقائياً»، وهي كذبة، ويتلقّى
            -- التاجر «أُلغي دون استلام»، والإدارة «انتهاء حجز تلقائي».
            IF COALESCE(NEW.cancelled_by, '') = 'refund' THEN
                RETURN NEW;
            END IF;
            v_expired := (NEW.expiry_time IS NOT NULL AND NEW.expiry_time < v_now);
            INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
            VALUES (NEW.user_id,
                CASE WHEN v_expired THEN '⏰ انتهت مدة الحجز' ELSE '⚠️ تم إلغاء الحجز' END,
                CASE WHEN v_expired THEN '⏰ Booking expired' ELSE '⚠️ Booking Cancelled' END,
                CASE WHEN v_expired THEN 'انتهت مدة حجز ' || item_name || ' (ساعتان) فأُلغي تلقائياً وأُتيح العرض للآخرين.'
                     ELSE 'تم إلغاء حجز ' || item_name || '.' END,
                CASE WHEN v_expired THEN 'Your booking for ' || item_name || ' expired (2h window) and was auto-cancelled.'
                     ELSE 'Booking for ' || item_name || ' has been cancelled.' END,
                'booking', jsonb_build_object('audience','buyer','event', CASE WHEN v_expired THEN 'expired' ELSE 'cancelled' END,'barcode',NEW.barcode,'dealId',NEW.deal_id), NOW());
            INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
            VALUES (NEW.store_id,
                CASE WHEN v_expired THEN '⏰ انتهى حجز دون استلام' ELSE '⚠️ تم إلغاء حجز' END,
                CASE WHEN v_expired THEN '⏰ Booking expired' ELSE '⚠️ Booking Cancelled' END,
                CASE WHEN v_expired THEN 'انتهت مدة حجز ' || item_name || ' من ' || buyer_name || ' دون استلام، وأُلغي تلقائياً.'
                     ELSE 'تم إلغاء حجز ' || item_name || ' من قِبل ' || buyer_name || '.' END,
                CASE WHEN v_expired THEN 'Booking for ' || item_name || ' by ' || buyer_name || ' expired without pickup and was auto-cancelled.'
                     ELSE buyer_name || ' cancelled the booking for ' || item_name || '.' END,
                'booking', jsonb_build_object('audience','seller','event', CASE WHEN v_expired THEN 'expired' ELSE 'cancelled' END,'barcode',NEW.barcode,'dealId',NEW.deal_id), NOW());

            INSERT INTO public.activity_log (user_id, user_type, action, entity_type, entity_id, metadata)
            VALUES (
                (SELECT u.id FROM public.users u WHERE u.id = CASE
                    WHEN v_expired THEN NULL
                    WHEN COALESCE(NEW.cancelled_by,'') = 'seller' THEN NEW.store_id
                    ELSE NEW.user_id END),
                CASE WHEN v_expired THEN 'system'
                     WHEN COALESCE(NEW.cancelled_by,'') = 'seller' THEN 'seller'
                     ELSE 'buyer' END,
                CASE WHEN v_expired THEN 'booking_expired' ELSE 'booking_cancelled' END,
                'booking', NEW.barcode,
                jsonb_strip_nulls(jsonb_build_object(
                    'store_id', NEW.store_id, 'buyer_id', NEW.user_id, 'deal_id', NEW.deal_id,
                    'quantity', NEW.booked_quantity, 'amount', NEW.total_amount,
                    'event', CASE WHEN v_expired THEN 'expired' ELSE 'cancelled' END,
                    'cancelled_by', NEW.cancelled_by)));
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) شاشة «إدارة العمليات» — قراءةٌ واحدة تخدمها
-- ═══════════════════════════════════════════════════════════════════════════
-- لماذا الصلاحية `tab_tools` ولا مفتاحَ جديد: سياسةُ القراءة الحيّة على
-- `public.activity_log` هي
--     activity_select_admin … USING (taki_admin_perm('tab_tools'))
-- أي أن **البيانات نفسها** تقول مَن يقرؤها. فمفتاحٌ ثانٍ للدالّة كان يفتح
-- باباً ثانياً على الجدول نفسه بقاعدةٍ مختلفة، وبابان لبيانٍ واحد يفترقان
-- (درس v14.71: عمودان في جدولين وكاتبان لا يعرف أحدهما الآخر). ومَن يملك
-- `tab_tools` اليوم يرى هذا الجدول أصلاً من تبويب الأدوات — فالشاشة الجديدة
-- **لا توسّع** ما يُرى، بل تُحسن عرضه.
--
-- 🪤 الترقيم بمؤشّر مركّب `(created_at, id)` لا بـ`created_at` وحده: حدثان
--    في المعاملة نفسها يحملان `now()` نفسه بالضبط (وهو الحال عند نسخِ
--    الإشعارات أعلاه)، فمؤشّرٌ زمنيّ صرف بـ`<` **يُسقط** الثاني بين صفحتين،
--    وبـ`<=` يُكرّره إلى الأبد. والمعامل الخامس `p_cursor_id` له قيمةٌ
--    افتراضية فالتوقيع الرباعي يبقى قابلاً للنداء كما هو.
DROP FUNCTION IF EXISTS public.admin_operations_log(integer, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.admin_operations_log(integer, timestamptz, text, text, bigint);
CREATE FUNCTION public.admin_operations_log(
  p_limit     integer     DEFAULT 30,
  p_cursor    timestamptz DEFAULT NULL,
  p_action    text        DEFAULT NULL,
  p_q         text        DEFAULT NULL,
  p_cursor_id bigint      DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_lim   int  := GREATEST(1, LEAST(100, COALESCE(p_limit, 30)));
  v_code  text := NULLIF(regexp_replace(lower(COALESCE(p_q, '')), '\s', '', 'g'), '');
  v_name  text;
  v_rows  jsonb;
  v_n     int;
  v_last  timestamptz;
  v_lastid bigint;
  v_stats jsonb := NULL;
  v_day   timestamptz;
BEGIN
  IF NOT public.taki_admin_perm('tab_tools') THEN
    RAISE EXCEPTION 'غير مصرّح' USING ERRCODE = '42501';
  END IF;

  -- 🪤 العربية تُطبَّع على الطرفين معاً وإلا سقط «الراشد» أمام «راشد» (v13.25).
  v_name := NULLIF(public.taki_norm(COALESCE(p_q, '')), '');

  -- 🪤 كلُّ هذا في استعلامٍ واحد لا في جدولٍ مؤقّت: الدالّة `STABLE`، ودالّةٌ
  --    غير `VOLATILE` لا يُسمح لها بـ`CREATE`/`INSERT` إطلاقاً. وجعلُها
  --    `VOLATILE` لأجل جدولٍ مؤقّت ثمنٌ بلا مقابل.
  WITH page AS (
      SELECT a.*
        FROM public.activity_log a
       WHERE (p_action IS NULL OR a.action = p_action)
         AND (p_cursor IS NULL
              OR (p_cursor_id IS NULL     AND a.created_at < p_cursor)
              OR (p_cursor_id IS NOT NULL AND (a.created_at, a.id) < (p_cursor, p_cursor_id)))
         AND (
              v_code IS NULL
              OR position(v_code IN lower(COALESCE(a.entity_id, ''))) > 0
              OR (v_name IS NOT NULL AND EXISTS (
                   SELECT 1 FROM public.users u
                    WHERE u.id IN (a.user_id, a.metadata->>'store_id', a.metadata->>'buyer_id')
                      AND public.taki_norm(COALESCE(u.shop,'') || ' ' || COALESCE(u.name,''))
                          LIKE '%' || v_name || '%'))
             )
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT v_lim
  ), shaped AS (
      SELECT p.id, p.created_at,
             jsonb_build_object(
               'id',          p.id,
               'at',          p.created_at,
               'action',      p.action,
               'entity_type', p.entity_type,
               'code',        p.entity_id,
               'actor_id',    p.user_id,
               'actor_type',  p.user_type,
               'actor_name',  COALESCE(NULLIF(ua.name,''), NULLIF(ua.shop,'')),
               'store_id',    p.metadata->>'store_id',
               'store_name',  COALESCE(NULLIF(us.shop,''), NULLIF(us.name,'')),
               'buyer_id',    p.metadata->>'buyer_id',
               'buyer_name',  COALESCE(NULLIF(ub.name,''), NULLIF(ub.shop,'')),
               'deal_id',     p.metadata->>'deal_id',
               'quantity',    CASE WHEN jsonb_typeof(p.metadata->'quantity') = 'number'
                                   THEN (p.metadata->>'quantity')::numeric END,
               'amount',      CASE WHEN jsonb_typeof(p.metadata->'amount') = 'number'
                                   THEN (p.metadata->>'amount')::numeric END,
               'event',       p.metadata->>'event',
               'meta',        COALESCE(p.metadata, '{}'::jsonb)
             ) AS x
        FROM page p
        LEFT JOIN public.users ua ON ua.id = p.user_id
        LEFT JOIN public.users us ON us.id = p.metadata->>'store_id'
        LEFT JOIN public.users ub ON ub.id = p.metadata->>'buyer_id'
  )
  SELECT jsonb_agg(s.x ORDER BY s.created_at DESC, s.id DESC),
         count(*)::int,
         (array_agg(s.created_at ORDER BY s.created_at ASC, s.id ASC))[1],
         (array_agg(s.id         ORDER BY s.created_at ASC, s.id ASC))[1]
    INTO v_rows, v_n, v_last, v_lastid
    FROM shaped s;

  -- الأرقام تُحسب للصفحة الأولى وحدها، وهي **عن السجلّ كلّه** لا عن المرشِّح.
  IF p_cursor IS NULL THEN
    v_day := date_trunc('day', now() AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh';
    SELECT jsonb_build_object(
      'today',   (SELECT count(*) FROM public.activity_log WHERE created_at >= v_day),
      'week',    (SELECT count(*) FROM public.activity_log WHERE created_at >= v_day - interval '6 days'),
      'total',   (SELECT count(*) FROM public.activity_log),
      'latest_code', (SELECT a.entity_id FROM public.activity_log a
                       WHERE a.entity_type = 'booking' AND a.entity_id IS NOT NULL
                       ORDER BY a.created_at DESC, a.id DESC LIMIT 1),
      'latest_at',   (SELECT a.created_at FROM public.activity_log a
                       WHERE a.entity_type = 'booking' AND a.entity_id IS NOT NULL
                       ORDER BY a.created_at DESC, a.id DESC LIMIT 1),
      'actions', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('action', t.action, 'n', t.n) ORDER BY t.n DESC)
            FROM (SELECT a.action AS action, count(*) AS n
                    FROM public.activity_log a GROUP BY a.action) t), '[]'::jsonb)
    ) INTO v_stats;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'rows', COALESCE(v_rows, '[]'::jsonb),
    -- صفحةٌ ناقصة = لا مزيد. ولا يُعاد مؤشّرٌ لصفحةٍ فارغة.
    'next_cursor',    CASE WHEN v_n = v_lim THEN to_jsonb(v_last)   ELSE 'null'::jsonb END,
    'next_cursor_id', CASE WHEN v_n = v_lim THEN to_jsonb(v_lastid) ELSE 'null'::jsonb END,
    'stats', COALESCE(v_stats, 'null'::jsonb)
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.admin_operations_log(integer, timestamptz, text, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_operations_log(integer, timestamptz, text, text, bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_operations_log(integer, timestamptz, text, text, bigint) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_operations_log(integer, timestamptz, text, text, bigint) IS
  'v14.99 — سجلّ العمليات لشاشة «إدارة العمليات». محروسة بـtaki_admin_perm(tab_tools) — '
  'وهي الصلاحية نفسها التي تحرس القراءة المباشرة على activity_log، فلا بابان لبيانٍ واحد.';

DELETE FROM public.admin_rpc_permissions WHERE rpc_name = 'admin_operations_log';
INSERT INTO public.admin_rpc_permissions (rpc_name, required_perm) VALUES
  ('admin_operations_log', 'tab_tools');

-- ═══════════════════════════════════════════════════════════════════════════
-- ٦) التحقّق — كلُّ بندٍ يرفع استثناءً. (جدولُ ✅/❌ لا يُفشل psql — درس v14.50)
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  v_src      text;
  v_f        text;
  v_keep     text[] := ARRAY[
    '📦 طلب حجز جديد!', '✅ تم الحجز بنجاح!', '📦 التاجر استلم طلبك!',
    '🎉 تم تسليم طلبك!', '🎉 تم الاستلام بنجاح!', '⏰ انتهت مدة الحجز',
    '⚠️ تم إلغاء الحجز', '⏰ انتهى حجز دون استلام', '⚠️ تم إلغاء حجز',
    'COALESCE(NEW.cancelled_by, '''') = ''refund'''
  ];
  n_left     bigint;
  n_other    bigint;
  n_other0   bigint;
  n_before   bigint;
  n_deleted  bigint;
  n_groups   bigint;
  n_act0     bigint;
  n_act1     bigint;
  n_orphan   bigint;
  v_admin    text;
  v_plain    text;
  v_res      jsonb;
  v_refused  boolean := false;
  v_allowed  boolean := false;
BEGIN
  -- ٦-١ الرسائل الستّ باقيةٌ حرفياً، وحلقاتُ الأدمن ذهبت
  SELECT pg_get_functiondef('public.handle_booking_notification()'::regprocedure) INTO v_src;
  FOREACH v_f IN ARRAY v_keep LOOP
    IF position(v_f IN v_src) = 0 THEN
      RAISE EXCEPTION '❌ سقطت رسالةُ مشترٍ أو تاجر: «%» — هذا يكلّف ناصر طلبات.', v_f;
    END IF;
  END LOOP;
  IF position('FOR admin_id IN' IN v_src) > 0 THEN
    RAISE EXCEPTION '❌ ما زالت في الدالّة حلقةُ أدمن — الجرس لم يصمت.';
  END IF;
  IF position('''audience'',''admin''' IN v_src) > 0 THEN
    RAISE EXCEPTION '❌ ما زالت الدالّة تكتب إشعاراً بجمهور admin.';
  END IF;
  IF position('booking_created' IN v_src) = 0
     OR position('booking_completed' IN v_src) = 0
     OR position('booking_cancelled' IN v_src) = 0
     OR position('booking_expired' IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ أحد أحداث السجلّ الأربعة غير مكتوب في الدالّة.';
  END IF;

  -- ٦-٢ المشغّل ما زال مركَّباً على الحجوزات (دالّةٌ بلا مشغّل = صمتٌ تامّ)
  IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t
       WHERE t.tgrelid = 'public.bookings'::regclass AND NOT t.tgisinternal
         AND t.tgfoid = 'public.handle_booking_notification()'::regprocedure) THEN
    RAISE EXCEPTION '❌ لا مشغّل على bookings ينادي handle_booking_notification — كل الإشعارات ستصمت.';
  END IF;

  -- ٦-٣ لم يبقَ إشعارُ حجزٍ إداريّ، ولم يُمَسّ ما ليس حجزاً
  SELECT count(*) INTO n_left FROM public.notifications
   WHERE type = 'booking' AND meta_data->>'audience' = 'admin';
  IF n_left <> 0 THEN
    RAISE EXCEPTION '❌ بقي % إشعار حجزٍ إداريّ بعد الحذف.', n_left;
  END IF;

  SELECT n INTO n_other0 FROM _v1499_counts WHERE k = 'notif_admin_other_before';
  SELECT count(*) INTO n_other FROM public.notifications
   WHERE type <> 'booking' AND meta_data->>'audience' = 'admin';
  IF n_other <> n_other0 THEN
    RAISE EXCEPTION '❌ تغيّرت إشعاراتُ الأدمن غير الحجز: % ⇐ % — الشكاوى والبلاغات قراراتٌ تنتظره، لا «عمليات».', n_other0, n_other;
  END IF;

  -- ٦-٤ الحساب: ما حُذف يقابله صفٌّ لكل (رمز × حدث) — لا صفٌّ لكل إشعار
  SELECT n INTO n_before  FROM _v1499_counts WHERE k = 'notif_admin_booking_before';
  SELECT n INTO n_deleted FROM _v1499_counts WHERE k = 'notif_deleted';
  SELECT n INTO n_groups  FROM _v1499_counts WHERE k = 'groups_before';
  SELECT n INTO n_act0    FROM _v1499_counts WHERE k = 'activity_before';
  SELECT n INTO n_act1    FROM _v1499_counts WHERE k = 'activity_after_backfill';

  IF n_deleted <> n_before THEN
    RAISE EXCEPTION '❌ حُذف % من % إشعاراً إدارياً — الحذفُ ناقص.', n_deleted, n_before;
  END IF;
  IF (n_act1 - n_act0) <> n_groups THEN
    RAISE EXCEPTION '❌ كسب السجلّ % صفّاً ومجموعاتُ الأحداث % — الحسابُ لا يستقيم.', (n_act1 - n_act0), n_groups;
  END IF;

  -- ولا مجموعةَ حدثٍ ضاعت. 🪤 والقياسُ **من الإشعار إلى السجلّ** لا العكس:
  --    «كل صفٍّ منقولٍ له صفٌّ بنفس رمزه وفعله» شرطٌ يصدُق على الصفّ نفسه،
  --    أي شرطٌ لا يستطيع أن يفشل. هنا يُسأل كلُّ إشعارٍ حُذف: أين وَلَدُك؟
  SELECT count(*) INTO n_orphan FROM _v1499_groups g
   WHERE NOT EXISTS (
     SELECT 1 FROM public.activity_log a
      WHERE a.metadata->>'from_notification' = g.notif_id
        AND a.action = 'booking_' || CASE g.ev WHEN 'new' THEN 'created' ELSE g.ev END
        AND a.entity_id IS NOT DISTINCT FROM g.code);
  IF n_orphan <> 0 THEN
    RAISE EXCEPTION '❌ % مجموعةَ حدثٍ حُذف إشعارُها ولا صفَّ لها في السجلّ — النقل فقد شيئاً.', n_orphan;
  END IF;

  -- ٦-٥ الدالّة موجودة بمنحها الصحيح
  IF to_regprocedure('public.admin_operations_log(integer, timestamptz, text, text, bigint)') IS NULL THEN
    RAISE EXCEPTION '❌ admin_operations_log غير موجودة بعد التنفيذ.';
  END IF;
  IF has_function_privilege('anon', 'public.admin_operations_log(integer, timestamptz, text, text, bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ admin_operations_log ممنوحة لـanon — سجلّ العمليات على الإنترنت المفتوح.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_operations_log(integer, timestamptz, text, text, bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ admin_operations_log بلا منحٍ لـauthenticated — الشاشة لن تُنادى أصلاً.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_rpc_permissions
                  WHERE rpc_name = 'admin_operations_log' AND required_perm = 'tab_tools') THEN
    RAISE EXCEPTION '❌ صفُّ admin_rpc_permissions ناقص.';
  END IF;

  -- ٦-٦ القياس لا الافتراض: تُرفض بلا صلاحية، وتنجح بها
  -- 🪤 يُقرأ الحسابان **قبل** تبديل الدور، ويُعاد الدور قبل أي تحقّقٍ بعده
  --    (درس v14.77: تبديلُ دورٍ ثم تحقّقٌ يتّهم كوداً سليماً).
  SELECT u.id INTO v_admin FROM public.users u
   WHERE u.user_type = 'admin' AND u.deleted_at IS NULL
     AND COALESCE(u.is_super_admin, false)
     AND u.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   LIMIT 1;
  SELECT u.id INTO v_plain FROM public.users u
   WHERE u.user_type <> 'admin' AND u.deleted_at IS NULL
     AND u.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   LIMIT 1;
  IF v_admin IS NULL OR v_plain IS NULL THEN
    RAISE EXCEPTION '❌ لا يوجد حسابان (أدمن أعلى + غير أدمن) لأقيس بهما البوّابة — والاختبارُ الذي لا يختبر شيئاً أسوأ من لا اختبار.';
  END IF;

  -- (أ) غيرُ الأدمن يُرفض
  PERFORM set_config('request.jwt.claim.sub', v_plain, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_plain, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    v_res := public.admin_operations_log(3, NULL, NULL, NULL);
  EXCEPTION WHEN insufficient_privilege THEN
    v_refused := true;
  END;
  PERFORM set_config('role', 'none', true);

  -- (ب) الأدمن الأعلى يُقبل
  PERFORM set_config('request.jwt.claim.sub', v_admin, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    v_res := public.admin_operations_log(3, NULL, NULL, NULL);
    v_allowed := (v_res->>'ok') = 'true';
  EXCEPTION WHEN OTHERS THEN
    v_allowed := false;
  END;
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  IF NOT v_refused THEN
    RAISE EXCEPTION '❌ حسابٌ بلا صلاحية نادى admin_operations_log ولم يُرفض — البوّابة مفتوحة.';
  END IF;
  IF NOT v_allowed THEN
    RAISE EXCEPTION '❌ الأدمن الأعلى نادى admin_operations_log فلم تنجح — الشاشة ستكون فارغة عند ناصر.';
  END IF;

  RAISE NOTICE '✅ v14.99: حُذف % إشعاراً إدارياً · دخل السجلّ % صفّاً (مجموعة حدثٍ لكل رمز) · الرسائل الستّ للمشتري والتاجر باقية · البوّابة تُرفض بلا صلاحية وتُقبل بها.',
    n_deleted, (n_act1 - n_act0);
END
$verify$;

COMMIT;
