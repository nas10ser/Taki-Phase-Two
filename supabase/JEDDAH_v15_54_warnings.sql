-- ═══════════════════════════════════════════════════════════════════════════
-- v15.54 — تنبيهُ «قاربت المهلة» و«المتجر يُغلق»: صياغةٌ صحيحة واستثناءٌ واحد
-- ═══════════════════════════════════════════════════════════════════════════
-- طلبُ ناصر: «عند بلوغ نصف ساعة على انتهاء الحجز ابعث رسالة، وأيضاً على إغلاق
-- المتجر لإعلام المشتري».
--
-- ✅ **والاثنان مبنيّان فعلاً، ويعملان**: قِيس على جدّة أن ٨ حجوزاتٍ أُنذرت
--    بقرب الانتهاء و٧ بقرب الإغلاق. و`minutes_before` **مضبوطةٌ على ٣٠**
--    أصلاً في `message_settings` — أي أن طلبَه الرقميّ منفَّذٌ قبل أن يُطلب.
--    فلا يُعاد بناءُ ما يعمل؛ يُصلح ما فيه خلل:
--
-- 🔴 (أ) **الصياغةُ تكسر العربية عند ٣–١٠**: القالبُ «باقٍ {minutes} دقيقة»
--    يُنتج «3 دقيقة» و«5 دقيقة» — والصواب «3 دقائق». وهي قاعدةُ المشروع
--    الموثَّقة (v14.92): لا يُصاغ معدودٌ يدوياً. فتُضاف `taki_ar_minutes`
--    توأماً لـ`taki_ar_days`، ويُمرَّر النصُّ المصوغ لا الرقمُ الخام.
--    🪤 ولا يُكتب الرقمُ في القالب نفسِه: ناصرٌ يضبطه من لوحته، وأمرُه
--       الثابت ألّا تُكتب مدّةٌ نصّاً إلا بنصٍّ نظاميّ.
--
-- 🔴 (ب) **استثناءُ التوصيل بائت**: الشرطُ يقرأ `delivery_tracks.status`
--    بقائمةٍ، وهو بالضبط ما أصلحته v15.49 (المنظّفُ يكتب `cancelled` بعد
--    ساعةٍ من صمت الهاتف فتعود المهلةُ «جارية» في عين هذه الدالّة وحدها).
--    ⇒ مشترٍ مندوبُه في الطريق كان سيتلقّى «باقٍ ٣٠ دقيقة على انتهاء حجزك»
--    وحجزُه **لا ينتهي**. فتُقرأ الحقيقةُ الواحدة `taki_autocancel_blocked`.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_autocancel_blocked(text,bigint,bigint,boolean)') IS NULL THEN
    RAISE EXCEPTION 'أساسُ v15.49 غائب — أوقِفت.';
  END IF;
END
$guard$;

-- ── ١) صياغةُ الدقائق في القاعدة — توأمُ arPlural في البيئتين الأخريين ────
CREATE OR REPLACE FUNCTION public.taki_ar_minutes(p_n integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_n = 1 THEN 'دقيقة واحدة'
    WHEN p_n = 2 THEN 'دقيقتان'
    WHEN p_n BETWEEN 3 AND 10 THEN p_n::text || ' دقائق'
    ELSE p_n::text || ' دقيقة'
  END;
$function$;

CREATE OR REPLACE FUNCTION public.taki_ar_hours(p_n integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_n = 1 THEN 'ساعة واحدة'
    WHEN p_n = 2 THEN 'ساعتان'
    WHEN p_n BETWEEN 3 AND 10 THEN p_n::text || ' ساعات'
    ELSE p_n::text || ' ساعة'
  END;
$function$;

-- ── ٢) تنبيهُ قرب الانتهاء: صياغةٌ صحيحة وحقيقةٌ واحدة للتوصيل ───────────
DO $rebuild$
DECLARE v_src text; v_out text;
BEGIN
  SELECT pg_get_functiondef('public.warn_expiring_bookings()'::regprocedure) INTO v_src;

  IF position('taki_autocancel_blocked' IN v_src) > 0
     AND position('taki_ar_minutes' IN v_src) > 0 THEN
    RAISE NOTICE 'ℹ️ مُصلَحةٌ أصلاً — لا تغيير';
    RETURN;
  END IF;

  -- (أ) استثناءُ التوصيل: قائمةُ الحالات ⇐ الحقيقةُ الواحدة.
  IF position($old$             AND NOT EXISTS (SELECT 1 FROM public.delivery_tracks t
                              WHERE t.barcode = b.barcode
                                AND t.status IN ('preparing','on_the_way','arrived','delivered'))$old$ IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ لم أتعرّف على شرط التوصيل في النصّ الحيّ — أوقِفت';
  END IF;
  v_out := replace(v_src,
    $old$             AND NOT EXISTS (SELECT 1 FROM public.delivery_tracks t
                              WHERE t.barcode = b.barcode
                                AND t.status IN ('preparing','on_the_way','arrived','delivered'))$old$,
    $new$             AND NOT public.taki_autocancel_blocked(b.barcode, b.booked_at, b.expiry_time, b.paid_at IS NOT NULL)$new$);

  -- (ب) الصياغة: يُمرَّر النصُّ المصوغ مكان الرقم الخام.
  IF position($old2$    vars := jsonb_build_object('minutes', v_min::text, 'item', COALESCE(v_item, 'العرض'));$old2$ IN v_out) = 0 THEN
    RAISE EXCEPTION '❌ لم أتعرّف على بناء المتغيّرات — أوقِفت';
  END IF;
  v_out := replace(v_out,
    $old2$    vars := jsonb_build_object('minutes', v_min::text, 'item', COALESCE(v_item, 'العرض'));$old2$,
    $new2$    -- v15.54 — النصُّ المصوغ لا الرقمُ الخام: «3 دقيقة» خطأٌ نحويّ،
    -- والمحرّكُ واحدٌ في البيئات الثلاث (قاعدة v14.92).
    vars := jsonb_build_object('minutes', public.taki_ar_minutes(v_min),
                               'minutes_num', v_min::text,
                               'item', COALESCE(v_item, 'العرض'));$new2$);

  IF position('taki_autocancel_blocked' IN v_out) = 0
     OR position('taki_ar_minutes' IN v_out) = 0
     OR position('expiry_warned' IN v_out) = 0
     OR position('taki_render_template' IN v_out) = 0 THEN
    RAISE EXCEPTION '❌ الاستبدالُ أفقد الدالّةَ جزءاً — أوقِفت';
  END IF;
  EXECUTE v_out;
END
$rebuild$;

-- ── ٣) وتنبيهُ الإغلاق يُصاغ كذلك ─────────────────────────────────────────
DO $closing$
DECLARE v_src text; v_out text;
BEGIN
  SELECT pg_get_functiondef('public.notify_shops_closing_soon()'::regprocedure) INTO v_src;
  IF position('taki_ar_minutes' IN v_src) > 0 THEN
    RAISE NOTICE 'ℹ️ مُصلَحةٌ أصلاً — لا تغيير';
    RETURN;
  END IF;
  IF position($o$' سيغلق بعد ' || v_mins || ' دقيقة — يُرجى$o$ IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ لم أتعرّف على نصّ الإغلاق — أوقِفت';
  END IF;
  v_out := replace(v_src,
    $o$' سيغلق بعد ' || v_mins || ' دقيقة — يُرجى$o$,
    $n$' سيغلق بعد ' || public.taki_ar_minutes(v_mins) || ' — يُرجى$n$);
  IF position('taki_ar_minutes' IN v_out) = 0 OR position('closing_warned' IN v_out) = 0 THEN
    RAISE EXCEPTION '❌ الاستبدالُ أفقد الدالّةَ جزءاً';
  END IF;
  EXECUTE v_out;
END
$closing$;

-- ═══════════════════════════════════════════════════════════════════════════
-- تحقّقٌ سلوكيّ
-- ═══════════════════════════════════════════════════════════════════════════
DO $behave$
DECLARE v_s jsonb;
BEGIN
  -- (١) الصياغةُ صحيحةٌ في الصيغ الخمس
  IF public.taki_ar_minutes(1)  <> 'دقيقة واحدة' THEN RAISE EXCEPTION '❌ صيغةُ الواحد'; END IF;
  IF public.taki_ar_minutes(2)  <> 'دقيقتان'     THEN RAISE EXCEPTION '❌ صيغةُ الاثنين'; END IF;
  IF public.taki_ar_minutes(3)  <> '3 دقائق'     THEN RAISE EXCEPTION '❌ جمعُ القلّة'; END IF;
  IF public.taki_ar_minutes(30) <> '30 دقيقة'    THEN RAISE EXCEPTION '❌ جمعُ الكثرة'; END IF;
  IF public.taki_ar_hours(2)    <> 'ساعتان'      THEN RAISE EXCEPTION '❌ صيغةُ الساعتين'; END IF;

  -- (٢) العتبةُ إعدادٌ لا ثابت، وهي ٣٠ كما أراد ناصر
  v_s := public.taki_msg_setting('booking_reminder');
  IF COALESCE((v_s->>'minutes_before')::int, 0) <> 30 THEN
    RAISE EXCEPTION '❌ العتبةُ % لا ٣٠', v_s->>'minutes_before';
  END IF;
  IF (v_s->>'title_ar') NOT LIKE '%{minutes}%' THEN
    RAISE EXCEPTION '❌ القالبُ لا يقرأ العتبة — رقمٌ مكتوبٌ نصّاً';
  END IF;

  -- (٣) والدالّتان تقرآن الحقيقةَ الواحدة ولا تُطابقان قائمةً بائتة
  IF position('taki_autocancel_blocked' IN pg_get_functiondef('public.warn_expiring_bookings()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ تنبيهُ الانتهاء ما زال يُطابق حالاتِ التوصيل بقائمة';
  END IF;
  IF position($chk$t.status IN ('preparing','on_the_way','arrived','delivered')$chk$
              IN pg_get_functiondef('public.warn_expiring_bookings()'::regprocedure)) > 0 THEN
    RAISE EXCEPTION '❌ بقيت القائمةُ البائتة في تنبيه الانتهاء';
  END IF;

  -- (٤) وتشغيلٌ حقيقيّ: لا تنفجر ولا تُغرق
  IF public.warn_expiring_bookings() < 0 THEN RAISE EXCEPTION '❌ تنبيهُ الانتهاء فشل'; END IF;
  IF public.notify_shops_closing_soon() < 0 THEN RAISE EXCEPTION '❌ تنبيهُ الإغلاق فشل'; END IF;
END
$behave$;

SELECT 'الخادم' AS "البند", COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'جدة — الإنتاج') AS "القيمة"
UNION ALL SELECT 'عتبةُ التنبيه (دقيقة)', (public.taki_msg_setting('booking_reminder')->>'minutes_before')
UNION ALL SELECT 'صياغةُ ٣٠ · ٣ · ٢ · ١',
  public.taki_ar_minutes(30) || ' · ' || public.taki_ar_minutes(3) || ' · '
  || public.taki_ar_minutes(2) || ' · ' || public.taki_ar_minutes(1)
UNION ALL SELECT 'تنبيهُ الانتهاء يقرأ الحقيقةَ الواحدة',
  CASE WHEN pg_get_functiondef('public.warn_expiring_bookings()'::regprocedure) LIKE '%taki_autocancel_blocked%'
       THEN '✅' ELSE '❌' END
UNION ALL SELECT 'حجوزاتٌ أُنذرت حتى الآن',
  (SELECT count(*) FILTER (WHERE expiry_warned)::text || ' انتهاء · '
       || count(*) FILTER (WHERE closing_warned)::text || ' إغلاق' FROM public.bookings)
UNION ALL SELECT 'الكرون', (SELECT string_agg(jobname || ' (' || schedule || ')', ' · ')
  FROM cron.job WHERE command ILIKE '%taki_process_booking_expiry%');
