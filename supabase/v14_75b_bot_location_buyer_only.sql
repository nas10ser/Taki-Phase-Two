-- ════════════════════════════════════════════════════════════════════════════
-- v14.75b — دبّوس المتجر لا تحرّكه مشاركةُ موقعٍ في المحادثة
-- ════════════════════════════════════════════════════════════════════════════
-- قاعدةُ ناصر قائمةٌ منذ v13.11 ومكتوبةٌ في الموقع نصّاً:
--   «لا نكتب الموقع الحيّ إلا لحساب مشترٍ صِرف. التاجر — وكذلك المتجر المملوك
--    لأدمن — له موقعٌ ثابت يحفظه من لوحته؛ لو كتبنا فوق `users.lat/lng` بموقع
--    الجهاز الحيّ لضاع دبّوس المتجر المحفوظ.»
-- (`persistLiveLocation` في `AppContext.tsx` تفرضها: `userType !== 'buyer'` ⇒ لا كتابة.)
--
-- 🔴 والبوتان **لا يعرفان هذه القاعدة**: `bot_set_location` تكتب العمودين لأي
--    حسابٍ مربوط، تاجراً كان أو مشترياً، بلا فحص نوعٍ إطلاقاً. فتاجرٌ يشارك
--    موقعه في المحادثة ليتصفّح «حولي» **يحرّك دبّوس متجره المنشور** — وهو
--    الدبّوس الذي يُنشر لجوجل في JSON-LD على صفحة متجره.
--    قِيس اليوم: نقطة متجر N15 المنشورة تبعد ~٦٫٩ كم عن فرعه الرئيسي وتنطبق
--    على فرعٍ غير رئيسي — أي أنها تحرّكت من غير مسار «حفظ الموقع».
--
-- وهذا خرقٌ لقاعدة المشروع: ما يُفرض في الموقع يُفرض في البوتين.
--
-- 🪤 والحراسة تُوضع **في القاعدة** لا في ملفَّي البوت: الدالة هي المختنق الذي
--    يمرّ به الطرفان، فحارسٌ واحد هنا يُغني عن حارسين يفترقان بعد أول تعديل.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'رُفض: هذا خادم المختبر (طوكيو) — هجرات الإنتاج تُطبَّق على جدة';
  END IF;
END $guard$;

BEGIN;

CREATE OR REPLACE FUNCTION public.bot_set_location(
  p_telegram_id bigint,
  p_lat double precision,
  p_lng double precision,
  p_whatsapp_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid text; v_type text; v_shop text;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat < -90 OR p_lat > 90
     OR p_lng < -180 OR p_lng > 180 THEN
    RETURN jsonb_build_object('success', false, 'error', 'bad_coords');
  END IF;

  SELECT id, user_type, shop INTO v_uid, v_type, v_shop
    FROM public.users
   WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id) AND deleted_at IS NULL;
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_linked'); END IF;

  -- نفس شرط الموقع حرفاً بحرف: مشترٍ صِرف فقط.
  IF v_type IS DISTINCT FROM 'buyer'
     OR nullif(btrim(coalesce(v_shop, '')), '') IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'store_pin_protected');
  END IF;

  UPDATE public.users SET lat = p_lat, lng = p_lng WHERE id = v_uid;
  RETURN jsonb_build_object('success', true);
END $function$;

COMMIT;

-- ── تحقّقٌ يرفع استثناءً ─────────────────────────────────────────────────────
DO $verify$
DECLARE
  n   int;
  sid text;
  bid text;
  tg  bigint := 987654321987;
  v   jsonb;
  v_lat double precision;
BEGIN
  SELECT count(*) INTO n FROM pg_proc
   WHERE proname='bot_set_location' AND pronamespace='public'::regnamespace;
  IF n <> 1 THEN RAISE EXCEPTION 'فشل: نسخ bot_set_location = %', n; END IF;

  BEGIN
    -- (١) تاجر: نقطته **لا** تتحرّك
    SELECT u.id INTO sid FROM public.users u
     WHERE (u.user_type IN ('seller','admin') OR nullif(btrim(coalesce(u.shop,'')),'') IS NOT NULL)
       AND u.deleted_at IS NULL ORDER BY u.id LIMIT 1;
    IF sid IS NULL THEN RAISE EXCEPTION 'فشل: لا تاجر للاختبار'; END IF;
    UPDATE public.users SET telegram_id = tg WHERE id = sid;
    SELECT lat INTO v_lat FROM public.users WHERE id = sid;

    v := public.bot_set_location(tg, 24.7136, 46.6753, NULL);
    IF coalesce(v->>'error','') <> 'store_pin_protected' THEN
      RAISE EXCEPTION 'فشل: قُبل تحريك دبّوس متجر من المحادثة (%)', v::text;
    END IF;
    IF (SELECT lat FROM public.users WHERE id = sid) IS DISTINCT FROM v_lat THEN
      RAISE EXCEPTION 'فشل: تحرّكت نقطة التاجر رغم الرفض';
    END IF;
    UPDATE public.users SET telegram_id = NULL WHERE id = sid;

    -- (٢) مشترٍ صِرف: نقطته **تتحرّك** (حارسٌ يرفض الجميع ليس حارساً)
    SELECT u.id INTO bid FROM public.users u
     WHERE u.user_type = 'buyer' AND nullif(btrim(coalesce(u.shop,'')),'') IS NULL
       AND u.deleted_at IS NULL ORDER BY u.id LIMIT 1;
    IF bid IS NOT NULL THEN
      UPDATE public.users SET telegram_id = tg WHERE id = bid;
      v := public.bot_set_location(tg, 24.7136, 46.6753, NULL);
      IF coalesce(v->>'success','false') <> 'true' THEN
        RAISE EXCEPTION 'فشل: رُفض موقع مشترٍ صِرف (%)', v::text;
      END IF;
      IF (SELECT round(lat::numeric,4) FROM public.users WHERE id = bid) <> 24.7136 THEN
        RAISE EXCEPTION 'فشل: لم يُحفظ موقع المشتري';
      END IF;
    ELSE
      RAISE NOTICE 'ℹ️ لا مشترٍ صِرف في القاعدة — اختُبر الرفض وحده';
    END IF;

    RAISE EXCEPTION 'ROLLBACK_TEST_OK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_TEST_OK' THEN RAISE; END IF;
  END;
END $verify$;

SELECT 'v14.75b' AS "الهجرة",
       (SELECT count(*) FROM users WHERE telegram_id = 987654321987) AS "أثرٌ متسرّب";
