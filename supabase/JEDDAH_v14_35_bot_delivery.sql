-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.35 — تسعير التوصيل بالفرع · عناوين متعددة في البوتين · وسدّ تسريب
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 **تسريب مؤكَّد يُسدّ هنا أولاً.** `bot_delivery_quote` و
-- `bot_delivery_quote_at` **لا تناديان `_bot_gate_ok()` إطلاقاً**، وكلتاهما
-- ممنوحة لـ`anon`. فأي شخص على الإنترنت يستدعيها بلا أي سرّ، بمعرّف تيليجرام
-- مخمَّن (رقمٌ متسلسل قابل للعدّ)، فيستلم **وسم عنوان ذلك المستخدم وتفاصيله**
-- ومسافته من المتجر. لا حاجة لحساب ولا لرمز.
-- بقيّة دوال `bot_*` تحرس نفسها (`bot_get_pay_info` مثلاً) — هاتان سقطتا.
--
-- وثلاثة عيوب وظيفية من طلب ناصر السابع:
--  ١. تسعير التوصيل يقيس المسافة من **المحل الرئيس** لا من الفرع الذي عليه
--     الطلب. فمشترٍ بجوار فرعٍ قريب يُرفض «خارج النطاق» لأن الفرع الرئيس بعيد،
--     أو يُحاسَب برسوم فرعٍ لن يخرج منه طلبه.
--  ٢. البوتان لا يعرفان العناوين المتعددة: الموقع يحفظ حتى عشرة عناوين
--     (`user_addresses`) والبوت يستعمل `users.delivery_address` وحده — أي
--     العنوان الافتراضي، بلا أي خيار.
--  ٣. رسالة «خارج النطاق» تُقال أيضاً حين **لا نطاق للمتجر أصلاً**، وهما حالتان
--     مختلفتان: الأولى «عنوانك بعيد» والثانية «التاجر لم يرسم نطاقاً بعد».
--
-- الخادم المستهدف: **جدة (الإنتاج)**. يرفض التنفيذ على مختبر طوكيو.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'TOKYO_LAB_REFUSED: هذه هجرة إنتاج. نفّذها على جدة.';
  END IF;
END
$guard$;

-- ── ١. سدّ التسريب + التسعير بالفرع + العنوان المختار ───────────────────────
CREATE OR REPLACE FUNCTION public.bot_delivery_quote(
  p_telegram_id bigint, p_whatsapp_id text, p_store_id text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.bot_delivery_quote_at(p_telegram_id, p_whatsapp_id, p_store_id, NULL, NULL);
END $$;

DROP FUNCTION IF EXISTS public.bot_delivery_quote_at(bigint, text, text, text);
CREATE OR REPLACE FUNCTION public.bot_delivery_quote_at(
  p_telegram_id bigint, p_whatsapp_id text, p_store_id text,
  p_location_id text DEFAULT NULL, p_address_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_uid text; v_lat float8; v_lng float8; v_label text; v_details text; v_q jsonb;
BEGIN
  -- 🔒 الحارس. غيابُه كان يجعل هذه الدالة بوّابةً مفتوحة لعناوين الناس.
  IF NOT public._bot_gate_ok() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  v_uid := public._bot_uid(p_telegram_id, p_whatsapp_id);
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_linked'); END IF;

  IF p_address_id IS NOT NULL THEN
    -- `user_id = v_uid` شرطٌ لا تجميل: بدونه يقرأ أيّ باحثٍ عنوان غيره بمعرّفه.
    SELECT a.lat, a.lng, a.label, a.details INTO v_lat, v_lng, v_label, v_details
    FROM public.user_addresses a WHERE a.id = p_address_id AND a.user_id = v_uid;
    IF v_lat IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'address_not_found'); END IF;
  ELSE
    -- الافتراضي: أوّل عنوان مُعلَّم افتراضياً، وإلا الحقل القديم على المستخدم.
    SELECT a.lat, a.lng, a.label, a.details INTO v_lat, v_lng, v_label, v_details
    FROM public.user_addresses a WHERE a.user_id = v_uid
    ORDER BY a.is_default DESC, a.created_at ASC LIMIT 1;
    IF v_lat IS NULL THEN
      SELECT nullif(u.delivery_address->>'lat','')::float8, nullif(u.delivery_address->>'lng','')::float8,
             u.delivery_address->>'label', u.delivery_address->>'details'
        INTO v_lat, v_lng, v_label, v_details
      FROM public.users u WHERE u.id = v_uid;
    END IF;
  END IF;

  v_q := public.delivery_quote(p_store_id, v_lat, v_lng, p_location_id);
  RETURN v_q || jsonb_build_object(
    'ok', true,
    'has_address', (v_lat IS NOT NULL),
    'label', v_label, 'details', v_details,
    'address_id', p_address_id, 'location_id', p_location_id);
END $$;

-- 🪤 دوال `bot_*` يبقى `anon` قادراً على تنفيذها عمداً — الحارس هو السرّ في
-- الترويسة (درس v12.12). الخلل لم يكن في المنح بل في غياب نداء الحارس.
GRANT EXECUTE ON FUNCTION public.bot_delivery_quote(bigint, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bot_delivery_quote_at(bigint, text, text, text, text) TO anon, authenticated;

-- ── ٢. عناوين المشتري للبوتين ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bot_my_addresses(
  p_telegram_id bigint, p_whatsapp_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_uid text; v_rows jsonb;
BEGIN
  IF NOT public._bot_gate_ok() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  v_uid := public._bot_uid(p_telegram_id, p_whatsapp_id);
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_linked'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', a.id, 'label', COALESCE(NULLIF(a.label,''),'عنوان'),
           'details', COALESCE(a.details,''), 'city', a.city,
           'is_default', a.is_default)
         ORDER BY a.is_default DESC, a.created_at ASC), '[]'::jsonb)
    INTO v_rows
  FROM public.user_addresses a WHERE a.user_id = v_uid;

  RETURN jsonb_build_object('ok', true, 'rows', v_rows);
END $$;
GRANT EXECUTE ON FUNCTION public.bot_my_addresses(bigint, text) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق
-- ════════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS الفحص,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ مختبر طوكيو'
            ELSE '✅ جدة (الإنتاج)' END AS النتيجة
UNION ALL SELECT 'حارس السرّ على تسعير التوصيل',
       CASE WHEN pg_get_functiondef(to_regprocedure('public.bot_delivery_quote_at(bigint,text,text,text,text)'))
                 LIKE '%_bot_gate_ok%' THEN '✅ موجود' ELSE '❌ ما زال مفتوحاً' END
UNION ALL SELECT 'الغلاف القديم يحرس أيضاً',
       CASE WHEN pg_get_functiondef(to_regprocedure('public.bot_delivery_quote(bigint,text,text)'))
                 LIKE '%bot_delivery_quote_at%' THEN '✅ يمرّ بالحارس' ELSE '❌ لا' END
UNION ALL SELECT 'التسعير يقبل الفرع',
       CASE WHEN to_regprocedure('public.bot_delivery_quote_at(bigint,text,text,text,text)') IS NOT NULL
            THEN '✅ نعم' ELSE '❌ لا' END
UNION ALL SELECT 'العنوان يُقيَّد بصاحبه',
       CASE WHEN pg_get_functiondef(to_regprocedure('public.bot_delivery_quote_at(bigint,text,text,text,text)'))
                 LIKE '%a.user_id = v_uid%' THEN '✅ نعم' ELSE '❌ لا' END
UNION ALL SELECT 'قائمة عناوين البوت',
       CASE WHEN to_regprocedure('public.bot_my_addresses(bigint,text)') IS NOT NULL
            THEN '✅ موجودة' ELSE '❌ مفقودة' END
UNION ALL SELECT 'لا ازدواج في التحميل الزائد',
       CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='bot_delivery_quote_at') = 1
            THEN '✅ نسخة واحدة' ELSE '❌ نسختان' END;
