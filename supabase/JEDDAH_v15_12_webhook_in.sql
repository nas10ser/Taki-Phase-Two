-- ═══════════════════════════════════════════════════════════════════════════
-- v15.12 — رابطٌ **نعطيه** للتاجر، لا رابطٌ **نطلبه** منه
-- ═══════════════════════════════════════════════════════════════════════════
-- اعتراضُ ناصر على الشاشة، وهو محقّ تماماً:
--   «يوجد رابط … لم أفهم سبب طلبك للرابط وأيّ رابط تقصد أن يضع، وضّح للتاجر».
--
-- 🔴 والخطأُ كان في **التصميم** لا في الشرح: طلبتُ من التاجر عنواناً يستقبل
--    أحداثنا — وذلك يعني أن يبني مبرمجُه نقطةَ استقبال. والتاجرُ ليس عنده
--    مبرمج، وأنظمةُ المتاجر (سلّة · زد · أغلب نقاط البيع) تعمل بالعكس تماماً:
--    **هي تُرسل، وأنت تُعطيها عنواناً**.
--
--    فالاتجاهُ الصحيح: تاكي تُصدر للتاجر رابطاً جاهزاً، يلصقه في إعدادات
--    نظامه مرّةً واحدة، فتصله كلُّ حركة. ولا يكتب شيئاً ولا يفهم شيئاً.
--    والعنوانُ الذي كنتُ أطلبه يبقى — لكن **اختيارياً ومتقدّماً**، لمن عنده
--    نظامٌ يستطيع الاستقبال.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 وكيف نقرأ رسالةً لا نعرف شكلها؟
--    كلُّ نظامٍ يُرسل JSON بشكله هو. والبحثُ في وثائق سلّة وزد لم يُثبت أسماءَ
--    الحقول بيقين — **ومسحُ توثيقٍ سابق في هذا المشروع أنتج اسمَ حقلٍ
--    مختلَقاً لم يمسكه إلا مدقّق**. فلا تُخمَّن الأسماء.
--
--    البديلُ أمتنُ من التخمين وأصدق: الرسالةُ الأولى تُحفظ كما وصلت
--    (`last_payload`)، وتُجرَّب عليها مساراتٌ مرشَّحة. فإن نجحت طُبّقت، وإن
--    لم تنجح **قيل ذلك صراحةً** وعُرضت الرسالةُ الحقيقية لتُربَط حقولها
--    بضغطة. فالخريطةُ تُتعلَّم من رسالةٍ حقيقية لا تُستنسخ من وثيقةٍ قد
--    تتغيّر.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_stock_push(text,jsonb,timestamptz,text)') IS NULL THEN
    RAISE EXCEPTION 'v15.08 غير مطبَّقة — أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) خريطةُ الحقول وآخرُ رسالة
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.stock_integrations ADD COLUMN IF NOT EXISTS field_map jsonb;
ALTER TABLE public.stock_integrations ADD COLUMN IF NOT EXISTS last_payload jsonb;
ALTER TABLE public.stock_integrations ADD COLUMN IF NOT EXISTS last_payload_at timestamptz;
ALTER TABLE public.stock_integrations ADD COLUMN IF NOT EXISTS last_note text;
COMMENT ON COLUMN public.stock_integrations.field_map IS
  'أين يقع المعرّف والكمّية في رسالة هذا النظام (v15.12): {"id":"data.id","qty":"data.quantity"}. NULL = جرّب المرشّحات.';
COMMENT ON COLUMN public.stock_integrations.last_payload IS
  'آخرُ رسالةٍ وصلت كما وصلت — تُعرض للتاجر ليربط حقولها إن لم نفهمها. لا تُخمَّن أسماءُ الحقول من وثيقة.';

GRANT SELECT (id, store_id, provider, segment, label, api_key_last4, webhook_url,
              direction, is_enabled, last_seen_at, created_at,
              field_map, last_payload, last_payload_at, last_note)
  ON public.stock_integrations TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) قراءةُ مسارٍ منقوط داخل JSON
-- ═══════════════════════════════════════════════════════════════════════════
-- `data.product.quantity` أو `items.0.stock` — والأرقامُ تعمل فهارسَ مصفوفات.
CREATE OR REPLACE FUNCTION public._taki_jpath(p_body jsonb, p_path text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE WHEN p_body IS NULL OR COALESCE(btrim(p_path),'') = '' THEN NULL
              ELSE p_body #>> string_to_array(btrim(p_path), '.') END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) البابُ الوارد للأنظمة التي تُرسل بنفسها
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.taki_stock_webhook(text, jsonb, text);
CREATE FUNCTION public.taki_stock_webhook(
  p_key text, p_body jsonb, p_event_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_i      public.stock_integrations%ROWTYPE;
  v_hash   text;
  v_map    jsonb;
  v_id     text; v_qty text;
  v_cand   text[][];
  v_pair   text[];
  v_ev     text;
  v_res    jsonb;
BEGIN
  IF p_key IS NULL OR length(btrim(p_key)) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_KEY');
  END IF;
  v_hash := encode(extensions.digest(btrim(p_key), 'sha256'), 'hex');
  PERFORM public.taki_rate_check('stockhook:' || left(v_hash, 16), 300, 60,
                                 'too many webhooks — slow down');

  SELECT * INTO v_i FROM public.stock_integrations
   WHERE api_key_hash = v_hash AND is_enabled AND direction IN ('in','both');
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'UNKNOWN_KEY'); END IF;

  -- 🔴 تُحفظ الرسالةُ **دائماً** قبل أيّ محاولة فهم: هي الدليلُ الوحيد على
  --    شكلها الحقيقي، وبدونها لا يستطيع أحدٌ ربطَ الحقول إلا بالتخمين.
  UPDATE public.stock_integrations
     SET last_payload = p_body, last_payload_at = now(), last_seen_at = now()
   WHERE id = v_i.id;

  IF p_body IS NULL OR jsonb_typeof(p_body) <> 'object' THEN
    UPDATE public.stock_integrations SET last_note = 'BODY_NOT_OBJECT' WHERE id = v_i.id;
    RETURN jsonb_build_object('ok', true, 'stored', true, 'unmapped', true, 'reason', 'BODY_NOT_OBJECT');
  END IF;

  -- خريطةُ التاجر أوّلاً؛ وإلّا تُجرَّب مرشّحاتٌ شائعة على الرسالة نفسها.
  v_map := v_i.field_map;
  IF v_map IS NOT NULL THEN
    v_id  := public._taki_jpath(p_body, v_map->>'id');
    v_qty := public._taki_jpath(p_body, v_map->>'qty');
  END IF;

  IF v_id IS NULL OR v_qty IS NULL THEN
    -- 🪤 مرشّحاتٌ لا حقائق: كلُّ زوجٍ يُجرَّب على الرسالة الحقيقية، وما ينجح
    --    يُحفظ خريطةً. ولا يُدَّعى أن نظاماً بعينه يستعمل شكلاً بعينه.
    v_cand := ARRAY[
      ARRAY['data.id',            'data.quantity'],
      ARRAY['data.id',            'data.stock_quantity'],
      ARRAY['data.id',            'data.available_quantity'],
      ARRAY['data.product.id',    'data.product.quantity'],
      ARRAY['data.sku',           'data.quantity'],
      ARRAY['id',                 'quantity'],
      ARRAY['id',                 'stock_quantity'],
      ARRAY['sku',                'quantity'],
      ARRAY['product.id',         'product.quantity'],
      ARRAY['payload.id',         'payload.quantity'],
      ARRAY['external_id',        'on_hand']
    ];
    FOR i IN 1 .. array_length(v_cand, 1) LOOP
      v_pair := v_cand[i:i][1:2];
      v_id  := public._taki_jpath(p_body, v_cand[i][1]);
      v_qty := public._taki_jpath(p_body, v_cand[i][2]);
      IF v_id IS NOT NULL AND v_qty IS NOT NULL AND v_qty ~ '^[0-9]+$' THEN
        v_map := jsonb_build_object('id', v_cand[i][1], 'qty', v_cand[i][2], 'learned', true);
        UPDATE public.stock_integrations SET field_map = v_map WHERE id = v_i.id;
        EXIT;
      END IF;
      v_id := NULL; v_qty := NULL;
    END LOOP;
  END IF;

  IF v_id IS NULL OR v_qty IS NULL OR v_qty !~ '^[0-9]+$' THEN
    -- 🔴 يُقال صراحةً، ولا يُردّ خطأً: رسالةٌ لم نفهمها ليست خطأً عند المرسل،
    --    ورفضُها يجعل نظامه يُعيدها إلى الأبد. تُحفظ ويُطلب ربطُ حقولها.
    UPDATE public.stock_integrations SET last_note = 'UNMAPPED' WHERE id = v_i.id;
    RETURN jsonb_build_object('ok', true, 'stored', true, 'unmapped', true,
      'hint', 'open your TAKI stock-link card and map the fields of the message we just received');
  END IF;

  -- معرّفُ الحدث: من الرسالة إن حملته، وإلّا **بصمةُ محتواها**.
  -- 🔴 وأوّلُ نسخةٍ كتبتُها بنَته بـ`jpath(body,'id') || ':' || …` — و`NULL`
  --    مضروبةً في نصٍّ تعطي `NULL` في SQL، فخرج المعرّف فارغاً ورُفضت كلُّ
  --    رسالةٍ بـ`EVENT_ID_REQUIRED`. أمسكه القياسُ السلوكيّ لا القراءة.
  -- 🪤 والبصمةُ وحدها تكفي: رسالتان متطابقتان تماماً تكرارٌ بالتعريف، وضبطُ
  --    نفس الرقم مرّتين لا أثر له أصلاً (الكمّيات مطلقة).
  v_ev := COALESCE(NULLIF(btrim(COALESCE(p_event_id, '')), ''),
                   NULLIF(btrim(COALESCE(public._taki_jpath(p_body, 'event_id'), '')), ''),
                   'h:' || encode(extensions.digest(p_body::text, 'sha256'), 'hex'));

  v_res := public.taki_stock_push(p_key,
             jsonb_build_array(jsonb_build_object('external_id', v_id, 'on_hand', v_qty::int)),
             now(), v_ev);

  UPDATE public.stock_integrations
     SET last_note = CASE WHEN COALESCE((v_res->>'applied')::int, 0) > 0 THEN 'OK'
                          WHEN COALESCE((v_res->>'duplicate')::boolean, false) THEN 'DUPLICATE'
                          WHEN jsonb_array_length(COALESCE(v_res->'unmatched','[]'::jsonb)) > 0 THEN 'NOT_LINKED'
                          ELSE 'NO_EFFECT' END
   WHERE id = v_i.id;

  RETURN jsonb_build_object('ok', true, 'external_id', v_id, 'on_hand', v_qty::int, 'push', v_res);
END
$fn$;

REVOKE ALL ON FUNCTION public.taki_stock_webhook(text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_stock_webhook(text, jsonb, text) FROM anon;
-- 🪤 ليست لـanon: تُنادى من دالّة الحافة بدور الخدمة، لأن جسم الخطّاف يصل
--    خاماً بترويسات المرسل ولا يمرّ عبر PostgREST بمعاملات مسمّاة.
GRANT EXECUTE ON FUNCTION public.taki_stock_webhook(text, jsonb, text) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) ربطُ الحقول بضغطة — من الرسالة الحقيقية
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.merchant_set_field_map(uuid, text, text);
CREATE FUNCTION public.merchant_set_field_map(p_id uuid, p_id_path text, p_qty_path text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_me text := NULLIF((SELECT auth.uid())::text, ''); v_i public.stock_integrations%ROWTYPE;
        v_id text; v_qty text;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT * INTO v_i FROM public.stock_integrations WHERE id = p_id;
  IF v_i.store_id IS NULL OR v_i.store_id <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOURS');
  END IF;
  -- 🔴 ولا تُقبل خريطةٌ لا تعمل على الرسالة الحقيقية: خريطةٌ خاطئة تُسكت
  --    الربطَ بصمت، والتاجر يظنّه يعمل.
  IF v_i.last_payload IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_MESSAGE_YET');
  END IF;
  v_id  := public._taki_jpath(v_i.last_payload, p_id_path);
  v_qty := public._taki_jpath(v_i.last_payload, p_qty_path);
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'ID_PATH_EMPTY'); END IF;
  IF v_qty IS NULL OR v_qty !~ '^[0-9]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'QTY_PATH_NOT_A_NUMBER', 'got', v_qty);
  END IF;
  UPDATE public.stock_integrations
     SET field_map = jsonb_build_object('id', btrim(p_id_path), 'qty', btrim(p_qty_path), 'learned', false),
         last_note = 'MAPPED'
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'sample_id', v_id, 'sample_qty', v_qty::int);
END
$fn$;
REVOKE ALL ON FUNCTION public.merchant_set_field_map(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_set_field_map(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_set_field_map(uuid, text, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) تحقّقٌ يرفع استثناءً — ومعه قياسٌ سلوكيّ على رسائل بأشكالٍ مختلفة
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  v_me text; v_deal text; v_int uuid; v_oh0 int; v_oh int; r jsonb;
  K constant text := 'taki_hook_probe_012345678901234567';
BEGIN
  IF to_regprocedure('public.taki_stock_webhook(text,jsonb,text)') IS NULL
     OR to_regprocedure('public.merchant_set_field_map(uuid,text,text)') IS NULL
     OR to_regprocedure('public._taki_jpath(jsonb,text)') IS NULL THEN
    RAISE EXCEPTION '❌ إحدى الدوال الثلاث لم تُنشأ.';
  END IF;
  IF has_function_privilege('anon', 'public.taki_stock_webhook(text,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ البابُ الوارد مفتوحٌ لـanon مباشرةً — يُنادى من دالّة الحافة وحدها.';
  END IF;
  -- قراءةُ المسار المنقوط
  IF public._taki_jpath('{"a":{"b":{"c":7}}}'::jsonb, 'a.b.c') <> '7' THEN
    RAISE EXCEPTION '❌ المسار المنقوط لا يعمل.';
  END IF;
  IF public._taki_jpath('{"x":[{"q":3},{"q":9}]}'::jsonb, 'x.1.q') <> '9' THEN
    RAISE EXCEPTION '❌ فهرسُ المصفوفة لا يعمل.';
  END IF;

  -- ── قياسٌ سلوكيّ كامل ────────────────────────────────────────────────
  SELECT d.store_id, d.id, d.on_hand INTO v_me, v_deal, v_oh0
    FROM public.deals d
   WHERE d.on_hand IS NOT NULL AND COALESCE(d.is_unlimited,false) = false
     AND public.taki_open_holds(d.id, NULL, NULL) = 0
   ORDER BY d.id LIMIT 1;

  IF v_deal IS NOT NULL THEN
    INSERT INTO public.stock_integrations
      (store_id, provider, segment, label, api_key_hash, api_key_last4)
    VALUES (v_me, 'custom', 'other', 'hook-verify',
            encode(extensions.digest(K, 'sha256'), 'hex'), right(K, 4))
    RETURNING id INTO v_int;
    INSERT INTO public.stock_links (integration_id, store_id, deal_id, external_id)
    VALUES (v_int, v_me, v_deal, 'HOOK-SKU');

    -- (أ) رسالةٌ بشكلٍ شائع ⇒ تُفهَم وتُطبَّق، والخريطةُ تُتعلَّم
    r := public.taki_stock_webhook(K,
      jsonb_build_object('event','product.updated',
        'data', jsonb_build_object('id','HOOK-SKU','quantity', v_oh0 + 9)), NULL);
    IF COALESCE((r->>'unmapped')::boolean, false) THEN
      RAISE EXCEPTION '❌ شكلٌ شائع لم يُفهم: %', r::text;
    END IF;
    SELECT on_hand INTO v_oh FROM public.deals WHERE id = v_deal;
    IF v_oh <> v_oh0 + 9 THEN RAISE EXCEPTION '❌ لم يُطبَّق (% بدل %).', v_oh, v_oh0 + 9; END IF;
    IF (SELECT field_map->>'id' FROM public.stock_integrations WHERE id = v_int) IS NULL THEN
      RAISE EXCEPTION '❌ الخريطةُ لم تُتعلَّم من الرسالة.';
    END IF;

    -- (ب) رسالةٌ بشكلٍ غريب ⇒ تُحفظ ويُقال «لم نفهم»، ولا تُرفض
    r := public.taki_stock_webhook(K,
      jsonb_build_object('weird', jsonb_build_object('code','HOOK-SKU','left', 3)), NULL);
    IF NOT COALESCE((r->>'unmapped')::boolean, false) THEN
      RAISE EXCEPTION '❌ شكلٌ غريب ادُّعي فهمُه: %', r::text;
    END IF;
    IF NOT COALESCE((r->>'ok')::boolean, false) THEN
      RAISE EXCEPTION '❌ رُفضت الرسالة — فيُعيدها نظامُ التاجر إلى الأبد.';
    END IF;
    IF (SELECT last_payload->'weird'->>'code' FROM public.stock_integrations WHERE id = v_int) <> 'HOOK-SKU' THEN
      RAISE EXCEPTION '❌ الرسالةُ لم تُحفظ — فلا دليلَ على شكلها الحقيقي.';
    END IF;

    -- (ج) وربطُ الحقول من الرسالة الحقيقية يُصلحها
    r := public.merchant_set_field_map(v_int, 'weird.code', 'weird.left');
    IF COALESCE((r->>'ok')::boolean, false) THEN
      RAISE EXCEPTION '❌ قُبلت خريطةٌ من مستخدمٍ غير مسجَّل — فحصُ الملكية مفقود.';
    END IF;
    -- (النداءُ أعلاه بلا auth.uid() فيُرفض — وهو المطلوب. والربطُ الحقيقي من الشاشة.)
    UPDATE public.stock_integrations
       SET field_map = jsonb_build_object('id','weird.code','qty','weird.left') WHERE id = v_int;
    r := public.taki_stock_webhook(K,
      jsonb_build_object('weird', jsonb_build_object('code','HOOK-SKU','left', v_oh0 + 4)), NULL);
    SELECT on_hand INTO v_oh FROM public.deals WHERE id = v_deal;
    IF v_oh <> v_oh0 + 4 THEN
      RAISE EXCEPTION '❌ الخريطةُ المربوطة لم تعمل (% بدل %).', v_oh, v_oh0 + 4;
    END IF;

    -- (د) ومفتاحٌ خاطئ يُرفض
    r := public.taki_stock_webhook('taki_wrong_key_99999999999999', '{"data":{"id":"x","quantity":1}}'::jsonb, NULL);
    IF COALESCE((r->>'ok')::boolean, false) THEN RAISE EXCEPTION '❌ مفتاحٌ خاطئ قُبل.'; END IF;

    -- الاستعادة
    PERFORM public.taki_set_on_hand(v_deal, v_oh0, NULL, NULL, NULL, 'init');
    DELETE FROM public.stock_integrations WHERE id = v_int;
    DELETE FROM public.stock_events WHERE deal_id = v_deal;
    SELECT on_hand INTO v_oh FROM public.deals WHERE id = v_deal;
    IF v_oh <> v_oh0 THEN RAISE EXCEPTION '❌ العرض % لم يعد إلى %.', v_deal, v_oh0; END IF;
    RAISE NOTICE '✅ سلوكيّاً: شكلٌ شائع فُهم وتُعلّمت خريطتُه · وغريبٌ حُفظ وقيل «لم نفهم» ولم يُرفض · وخريطةٌ مربوطة عملت · ومفتاحٌ خاطئ رُفض.';
  END IF;

  RAISE NOTICE '✅ v15.12: تاكي تُعطي الرابط ولا تطلبه · والشكلُ يُتعلَّم من رسالةٍ حقيقية لا يُخمَّن من وثيقة.';
END
$verify$;
