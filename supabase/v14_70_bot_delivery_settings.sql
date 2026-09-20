-- ════════════════════════════════════════════════════════════════════════════
-- v14.70 — إعدادات التوصيل من داخل البوتين
-- ════════════════════════════════════════════════════════════════════════════
-- طلب ناصر. التاجر الذي يدير متجره من تيليجرام كان مضطرّاً لفتح الموقع ليطفئ
-- التوصيل في يوم زحام أو ليرفع رسومه — وهي أكثر الإعدادات تقلّباً في اليوم.
--
-- **ما لا ينتقل إلى البوت عمداً: رسم النطاق.** النطاق مضلّعٌ يُرسم على خريطة،
-- ولا تُرسم المضلّعات بلوحة مفاتيح محادثة. يبقى على الموقع، والبوت يقول للتاجر
-- كم نطاقاً لديه ويحذّره إن كان صفراً (فالتوصيل «مفعّل» بلا نطاق = لا أحد
-- يستطيع أن يطلب، وهي الحالة التي تبدو سليمة وليست كذلك).
--
-- 🪤 التعديل **جزئيّ**: `NULL` تعني «لا تغيّر». البوت يعدّل حقلاً واحداً في كل
--    خطوة، ولو أرسل الحقول كلها في كل مرّة لدهس ما لم يُسأل عنه. والملاحظة
--    وحدها لها مُحيٍ صريح: نصٌّ فارغ `''` يمسحها (وإلا تعذّر مسحها أبداً).
-- 🪤 وقواعد التحقّق **منسوخة من `merchant_set_delivery` حرفاً بحرف** — نفس
--    الحدود ونفس رموز الأخطاء. لو افترق الطرفان لصار المسموح على الموقع
--    ممنوعاً على البوت ولا أحد يعرف لماذا.
-- 🪤 و`_bot_uid` تنادي `_bot_gate_ok()` داخلها — فالحراسة قائمة. ومع ذلك
--    يُفحص الحارس صراحةً في `bot_set_delivery` لأنها **تكتب**.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'رُفض: هذا خادم المختبر (طوكيو) — هجرات الإنتاج تُطبَّق على جدة';
  END IF;
END $guard$;

BEGIN;

DROP FUNCTION IF EXISTS public.bot_get_delivery(bigint, text);
DROP FUNCTION IF EXISTS public.bot_set_delivery(bigint, text, boolean, text, numeric, numeric, integer, text);

-- ١) القراءة ─────────────────────────────────────────────────────────────────
CREATE FUNCTION public.bot_get_delivery(
  p_telegram_id bigint DEFAULT NULL,
  p_whatsapp_id text   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid  text := public._bot_uid(p_telegram_id, p_whatsapp_id);
  v_type text;
  v_shop text;
  sp     public.store_profiles%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_linked'); END IF;
  SELECT user_type, shop INTO v_type, v_shop FROM public.users WHERE id = v_uid AND deleted_at IS NULL;
  IF v_type IS NULL OR (v_type NOT IN ('seller','admin')
      AND nullif(btrim(coalesce(v_shop,'')),'') IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_seller');
  END IF;

  SELECT * INTO sp FROM public.store_profiles WHERE store_id = v_uid;

  RETURN jsonb_build_object(
    'ok',            true,
    'enabled',       coalesce(sp.delivery_enabled, false),
    'payment',       coalesce(sp.delivery_payment, 'cod'),
    'fee',           coalesce(sp.delivery_fee, 0),
    'min_order',     coalesce(sp.delivery_min_order, 0),
    'eta_min',       sp.delivery_eta_min,
    'note',          sp.delivery_note,
    -- عدد النطاقات: «مفعّل بلا نطاق» يبدو سليماً وليس كذلك — لا أحد يستطيع الطلب.
    'zones',         (SELECT count(*) FROM public.store_delivery_zones z
                       WHERE z.store_id = v_uid AND z.is_active),
    -- نطاقاتٌ لها رسمها الخاص: تعديل الرسم العام لا يمسّها، فلا يُقال للتاجر
    -- «رفعتُ رسومك» وهو لم يرفعها على نصف خريطته.
    'zones_priced',  (SELECT count(*) FROM public.store_delivery_zones z
                       WHERE z.store_id = v_uid AND z.is_active AND z.fee IS NOT NULL),
    'admin_blocked', coalesce(sp.delivery_blocked_by_admin, false),
    'block_reason',  sp.delivery_block_reason,
    'platform_on',   public.taki_delivery_globally_on(),
    -- وضع الدفع: «بطاقة» تحتاج بوابةً عاملة، وبدونها تُرفض بـGATEWAY_REQUIRED.
    'gateway_mode',  public.deal_payment_mode(v_uid)
  );
END $function$;

-- ٢) الكتابة (جزئية) ─────────────────────────────────────────────────────────
CREATE FUNCTION public.bot_set_delivery(
  p_telegram_id bigint   DEFAULT NULL,
  p_whatsapp_id text     DEFAULT NULL,
  p_enabled     boolean  DEFAULT NULL,
  p_payment     text     DEFAULT NULL,
  p_fee         numeric  DEFAULT NULL,
  p_min_order   numeric  DEFAULT NULL,
  p_eta_min     integer  DEFAULT NULL,
  p_note        text     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid   text;
  v_type  text;
  v_shop  text;
  sp      public.store_profiles%ROWTYPE;
  v_en    boolean;
  v_pay   text;
  v_fee   numeric;
  v_min   numeric;
  v_eta   integer;
  v_note  text;
  v_mode  text;
BEGIN
  IF NOT public._bot_gate_ok() THEN RAISE EXCEPTION 'GATE'; END IF;
  v_uid := public._bot_uid(p_telegram_id, p_whatsapp_id);
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_linked'); END IF;
  SELECT user_type, shop INTO v_type, v_shop FROM public.users WHERE id = v_uid AND deleted_at IS NULL;
  IF v_type IS NULL OR (v_type NOT IN ('seller','admin')
      AND nullif(btrim(coalesce(v_shop,'')),'') IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_seller');
  END IF;

  SELECT * INTO sp FROM public.store_profiles WHERE store_id = v_uid;

  -- الدمج: `NULL` = لا تغيّر. والملاحظة وحدها يمسحها نصٌّ فارغ صراحةً.
  v_en   := coalesce(p_enabled,   sp.delivery_enabled,   false);
  v_pay  := coalesce(p_payment,   sp.delivery_payment,   'cod');
  v_fee  := coalesce(p_fee,       sp.delivery_fee,       0);
  v_min  := coalesce(p_min_order, sp.delivery_min_order, 0);
  v_eta  := coalesce(p_eta_min,   sp.delivery_eta_min);
  v_note := CASE WHEN p_note IS NULL THEN sp.delivery_note
                 ELSE nullif(left(btrim(p_note), 300), '') END;

  -- نفس حدود `merchant_set_delivery` ونفس رموزها — لا تُخفَّف ولا تُشدَّد.
  IF v_pay NOT IN ('cod','card','both')                 THEN RETURN jsonb_build_object('ok', false, 'reason', 'BAD_MODE'); END IF;
  IF v_fee < 0  OR v_fee > 1000                          THEN RETURN jsonb_build_object('ok', false, 'reason', 'BAD_FEE');  END IF;
  IF v_min < 0  OR v_min > 100000                        THEN RETURN jsonb_build_object('ok', false, 'reason', 'BAD_MIN');  END IF;
  IF v_eta IS NOT NULL AND v_eta NOT BETWEEN 0 AND 1440  THEN RETURN jsonb_build_object('ok', false, 'reason', 'BAD_ETA');  END IF;
  -- 🪤 فحص البوابة يجري حين **يُطلب** تغييرٌ يمسّ الدفع أو التفعيل، لا في كل
  --    كتابة. الموقع يرسل الحقول الستّة دفعةً واحدة فيُعيد الفحص دائماً؛ أما
  --    البوت فيعدّل حقلاً واحداً. قِيس على جدة: متجرٌ حالته محفوظة
  --    «مفعّل + بطاقة» وبوّابته معطوبة اليوم — فكان تعديل **الرسم وحده** يُرفض
  --    بـGATEWAY_REQUIRED، أي يُحبس التاجر عن إعدادٍ لا علاقة له بالبوابة.
  --    ولا ثغرة: أي طلبٍ يرفع التفعيل أو يحوّل الوضع إلى بطاقة يُفحص كاملاً.
  IF (p_enabled IS NOT NULL OR p_payment IS NOT NULL)
     AND v_en AND v_pay IN ('card','both') THEN
    v_mode := public.deal_payment_mode(v_uid);
    IF v_mode NOT IN ('online','both') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'GATEWAY_REQUIRED');
    END IF;
  END IF;

  INSERT INTO public.store_profiles
      (store_id, delivery_enabled, delivery_payment, delivery_fee, delivery_min_order, delivery_eta_min, delivery_note)
  VALUES (v_uid, v_en, v_pay, round(v_fee, 2), round(v_min, 2), v_eta, v_note)
  ON CONFLICT (store_id) DO UPDATE SET
    delivery_enabled   = EXCLUDED.delivery_enabled,
    delivery_payment   = EXCLUDED.delivery_payment,
    delivery_fee       = EXCLUDED.delivery_fee,
    delivery_min_order = EXCLUDED.delivery_min_order,
    delivery_eta_min   = EXCLUDED.delivery_eta_min,
    delivery_note      = EXCLUDED.delivery_note,
    updated_at         = now();

  -- الردّ = الحالة الجديدة كاملةً (نفس شكل القراءة) فتُعاد رسم البطاقة بلا نداءٍ ثانٍ.
  RETURN public.bot_get_delivery(p_telegram_id, p_whatsapp_id);
END $function$;

-- الحارس هو السرّ (`_bot_gate_ok`) — فلا يُنزع `anon` عن دوال `bot_*`.
GRANT EXECUTE ON FUNCTION public.bot_get_delivery(bigint, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bot_set_delivery(bigint, text, boolean, text, numeric, numeric, integer, text) TO anon, authenticated;

COMMIT;

-- ── تحقّقٌ يرفع استثناءً ─────────────────────────────────────────────────────
DO $verify$
DECLARE
  n    int;
  sid  text;
  tg   bigint;
  v    jsonb;
  v_before jsonb;
BEGIN
  FOREACH sid IN ARRAY ARRAY['bot_get_delivery','bot_set_delivery'] LOOP
    SELECT count(*) INTO n FROM pg_proc
     WHERE proname = sid AND pronamespace='public'::regnamespace;
    IF n <> 1 THEN RAISE EXCEPTION 'فشل: نسخ % = % (نسختان ⇒ نداءٌ ملتبس)', sid, n; END IF;
  END LOOP;

  -- الحارس مذكورٌ فعلاً في نصّ دالة الكتابة (لا يكفي أن نظنّه)
  IF pg_get_functiondef('public.bot_set_delivery(bigint,text,boolean,text,numeric,numeric,integer,text)'::regprocedure)
       NOT LIKE '%_bot_gate_ok%' THEN
    RAISE EXCEPTION 'فشل: دالة الكتابة بلا حارس البوت';
  END IF;

  -- مجهولٌ غير مربوط ⇒ `not_linked` لا بياناتٌ ولا خطأ
  v := public.bot_get_delivery(999999999999::bigint, NULL);
  IF coalesce(v->>'reason','') <> 'not_linked' THEN
    RAISE EXCEPTION 'فشل: معرّف غير مربوط لم يُرفض (%)', v::text;
  END IF;

  -- ── تاجرٌ حقيقيّ داخل كتلةٍ تُلغى ────────────────────────────────────
  BEGIN
    SELECT u.id INTO sid FROM public.users u
     WHERE (u.user_type IN ('seller','admin') OR nullif(btrim(coalesce(u.shop,'')),'') IS NOT NULL)
       AND u.deleted_at IS NULL
     ORDER BY u.id LIMIT 1;
    IF sid IS NULL THEN RAISE EXCEPTION 'فشل: لا تاجر للاختبار'; END IF;

    tg := 987654321987;
    UPDATE public.users SET telegram_id = tg WHERE id = sid;

    v_before := public.bot_get_delivery(tg, NULL);
    IF coalesce(v_before->>'ok','false') <> 'true' THEN
      RAISE EXCEPTION 'فشل: القراءة لم تنجح لتاجرٍ مربوط (%)', v_before::text;
    END IF;
    IF NOT (v_before ? 'zones' AND v_before ? 'admin_blocked' AND v_before ? 'platform_on') THEN
      RAISE EXCEPTION 'فشل: حقولٌ ناقصة في القراءة';
    END IF;

    -- كتابةٌ جزئية: الرسم وحده — ولا يُدهس ما لم يُذكر
    v := public.bot_set_delivery(tg, NULL, NULL, NULL, 17.5, NULL, NULL, NULL);
    IF coalesce(v->>'ok','false') <> 'true' THEN RAISE EXCEPTION 'فشل: الكتابة الجزئية (%)', v::text; END IF;
    IF (v->>'fee')::numeric <> 17.50 THEN RAISE EXCEPTION 'فشل: الرسم لم يُحفظ (%)', v->>'fee'; END IF;
    IF coalesce(v->>'payment','') <> coalesce(v_before->>'payment','') THEN
      RAISE EXCEPTION 'فشل: الكتابة الجزئية دهست وضع الدفع';
    END IF;
    IF coalesce(v->>'enabled','') <> coalesce(v_before->>'enabled','') THEN
      RAISE EXCEPTION 'فشل: الكتابة الجزئية دهست حالة التفعيل';
    END IF;

    -- الحدود تُرفض ولا تُكتب
    IF coalesce(public.bot_set_delivery(tg, NULL, NULL, NULL, 1001, NULL, NULL, NULL)->>'reason','') <> 'BAD_FEE' THEN
      RAISE EXCEPTION 'فشل: رسمٌ فوق السقف لم يُرفض';
    END IF;
    IF coalesce(public.bot_set_delivery(tg, NULL, NULL, 'bitcoin', NULL, NULL, NULL, NULL)->>'reason','') <> 'BAD_MODE' THEN
      RAISE EXCEPTION 'فشل: وضع دفعٍ غير معروف لم يُرفض';
    END IF;
    IF coalesce(public.bot_set_delivery(tg, NULL, NULL, NULL, NULL, NULL, 2000, NULL)->>'reason','') <> 'BAD_ETA' THEN
      RAISE EXCEPTION 'فشل: مدّةٌ خارج الحدّ لم تُرفض';
    END IF;
    IF (public.bot_get_delivery(tg, NULL)->>'fee')::numeric <> 17.50 THEN
      RAISE EXCEPTION 'فشل: كتابةٌ مرفوضة غيّرت البيانات';
    END IF;

    -- ولا ثغرة: طلبٌ يحوّل الوضع إلى «بطاقة» بلا بوابةٍ عاملة يُرفض
    IF public.deal_payment_mode(sid) NOT IN ('online','both') THEN
      IF coalesce(public.bot_set_delivery(tg, NULL, true, 'card', NULL, NULL, NULL, NULL)->>'reason','')
           <> 'GATEWAY_REQUIRED' THEN
        RAISE EXCEPTION 'فشل: قُبل وضع «بطاقة» بلا بوابةٍ عاملة';
      END IF;
    END IF;

    -- الملاحظة: تُكتب، ويمسحها نصٌّ فارغ صراحةً
    v := public.bot_set_delivery(tg, NULL, NULL, NULL, NULL, NULL, NULL, '  التوصيل حتى العاشرة  ');
    IF coalesce(v->>'note','') <> 'التوصيل حتى العاشرة' THEN
      RAISE EXCEPTION 'فشل: الملاحظة لم تُحفظ مشذّبة (%)', coalesce(v->>'note','∅');
    END IF;
    v := public.bot_set_delivery(tg, NULL, NULL, NULL, NULL, NULL, NULL, '');
    IF v->>'note' IS NOT NULL THEN RAISE EXCEPTION 'فشل: النصّ الفارغ لم يمسح الملاحظة'; END IF;

    RAISE EXCEPTION 'ROLLBACK_TEST_OK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_TEST_OK' THEN RAISE; END IF;
  END;
END $verify$;

SELECT 'v14.70' AS "الهجرة",
       has_function_privilege('anon','public.bot_get_delivery(bigint, text)','EXECUTE') AS "قراءة anon",
       has_function_privilege('anon','public.bot_set_delivery(bigint, text, boolean, text, numeric, numeric, integer, text)','EXECUTE') AS "كتابة anon";
