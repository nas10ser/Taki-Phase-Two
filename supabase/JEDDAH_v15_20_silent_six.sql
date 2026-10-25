-- ═══════════════════════════════════════════════════════════════════════════
-- v15.20 — ستُّ حالاتٍ صامتة: مخرجٌ مفقود · ٥٠٠ على رقمٍ عشريّ · وسرٌّ يُوزَّع
-- ═══════════════════════════════════════════════════════════════════════════
-- بقيّةُ ما أكّده التدقيق الخصوميّ وقِسته بنفسي على جدة. وكلُّها من فئةٍ واحدة:
-- **المنصّةُ تُنتج حالةً ثمّ لا تقول عنها شيئاً ولا تُخرج منها.**
--
-- ١) 🔴 **خريطةُ حقولٍ خاطئةٌ بلا مخرج.** محرّرُ الخريطة في الشاشة لا يظهر إلا
--      حين `last_note = 'UNMAPPED'`. فتاجرٌ ربط حقلاً خاطئاً مرّةً يصير وسمُه
--      `MAPPED` ثمّ `OK`، فيختفي المحرّرُ **إلى الأبد** ولا دالّةَ تُصفّر
--      الخريطة. ⇒ ربطٌ معطوبٌ دائمٌ بضغطةٍ واحدة. (وهي نفسُ قاعدة «لكلّ حالةٍ
--      تُنتجها المنصّة مخرجٌ بضغطة» التي بُنيت لأجلها شاشةُ الردود العالقة.)
--
-- ٢) 🔴 **رقمٌ عشريٌّ واحد يُسقط الدفعة كلَّها بـ٥٠٠.** `(v_it->>'on_hand')::int`
--      داخل الحلقة بلا معالجِ استثناء. فنظامٌ يبيع بالوزن (لحمٌ · خضار — وهو
--      قطاعٌ مُعلَنٌ مدعوماً في الكتالوج) يُرسل `1.5` فتنفجر المعاملةُ كلُّها:
--      لا صنفَ يُكتب، والردُّ خطأٌ لا «تجاوَزنا صنفاً». ولا يستطيع ذلك التاجر
--      أن يُزامن **ولا مرّةً واحدة**.
--
-- ٣) 🔴 **وحدُّ المعدّل داخل الخطّاف يُجهض حفظَ الحمولة نفسها.**
--      `taki_rate_check` ترفع `P0011`، فتُلغى المعاملةُ كلُّها — ومنها
--      `UPDATE … last_payload` الذي يقوم عليه كلُّ تصميم «تعلُّم الشكل».
--      فرسالةٌ خُنقت لا تترك أثراً في أيّ مكان. **وأسوأُ من ذلك**: الاستثناءُ
--      يصل دالّةَ الحافة فتردّ ٥٠٢، و**٥٠٢ تُحسب فشلاً عند زد** ⇒ ثلاثون منها
--      في ساعةٍ تُعطّل الخطّاف وتُلغي أحداثَه المعلّقة.
--      🪤 والعلاجُ مقيسٌ من وثيقتهم: **٤٢٩ لا تُحسب فشلاً** («HTTP 429 Too
--         Many Requests responses are not counted as failures»). فالخنقُ يُبلَّغ
--         ٤٢٩ لا ٥٠٢، والحمولةُ تُحفظ أوّلاً.
--
-- ٤) 🔴 **رابطٌ على محورٍ غيرِ موجودٍ في العرض = لا شيء، ويُقال «طُبّق».**
--      `taki_set_on_hand` تتجاهل فرعَ الأصناف كلَّه إن لم يكن للعرض `variants`،
--      وتُرجع `ok:true` بلا `skipped`. فتاجرٌ ربط كودَ صنفٍ بعرضٍ بلا أصناف
--      يرى «✅ طُبّقت» ولا يتحرّك رقم.
--
-- ٥) 🔴 **و`bot_pull_stock_events` تُعيد `webhook_secret` نصّاً لكلّ حدث** —
--      أي أن تسريبَ سرِّ بوّابة البوت يصير **قدرةً على انتحال تاكي أمام كلّ
--      تاجر**. والسرُّ كان يخرج لأن البوت يوقّع الجسم بنفسه. ⇒ تُبنى الرسالةُ
--      ويُوقَّع **في القاعدة**، ويصير البوتُ ناقلاً أعمى. (وهذا يُلغي أيضاً
--      مصدرَي حقيقةٍ لشكل الجسم — وترتيبُ المفاتيح يغيّر البصمة.)
--
-- ٦) 🔴 **ولا قيدَ تفرّدٍ على `store_id`، والشاشةُ تقرأ `limit(1)`.** فاتصالٌ
--      ثانٍ (خطأُ شبكةٍ عابرٌ في الإنشاء يكفي) يصير **غيرَ مرئيٍّ ولا يُحذف**،
--      والتاجر يحمل مفتاحاً لا تعرفه شاشتُه. ومعه: الإنشاءُ مفتوحٌ لأيّ
--      مستخدمٍ موثَّق **بما فيهم المشترون**.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public._taki_stock_apply(uuid,jsonb,timestamptz,text)') IS NULL THEN
    RAISE EXCEPTION 'v15.17 غير مطبَّقة — أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) المخرج: تصفيرُ خريطة الحقول
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.merchant_clear_field_map(uuid);
CREATE FUNCTION public.merchant_clear_field_map(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_me text := NULLIF((SELECT auth.uid())::text, ''); v_owner text;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT store_id INTO v_owner FROM public.stock_integrations WHERE id = p_id;
  IF v_owner IS NULL OR v_owner <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOURS');
  END IF;
  -- 🪤 ويُعاد الوسمُ إلى `UNMAPPED` إن كانت هناك حمولةٌ محفوظة، فيظهر المحرّرُ
  --    مرّةً أخرى بالرسالة الحقيقية أمام التاجر. وإلّا فلا وسم.
  UPDATE public.stock_integrations
     SET field_map = NULL,
         last_note = CASE WHEN last_payload IS NOT NULL THEN 'UNMAPPED' ELSE NULL END
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END
$fn$;
REVOKE ALL ON FUNCTION public.merchant_clear_field_map(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_clear_field_map(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_clear_field_map(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢+٤) الحلقةُ لا تنفجر على صنفٍ واحد، ومحورٌ مفقودٌ يُقال
-- ═══════════════════════════════════════════════════════════════════════════
DO $patch$
DECLARE src text; src0 text;
BEGIN
  src := pg_get_functiondef('public._taki_stock_apply(uuid,jsonb,timestamptz,text)'::regprocedure);
  src0 := src;
  IF position('v15.20 item' IN src) > 0 THEN RAISE NOTICE 'ℹ️ مرقوعةٌ أصلاً.'; RETURN; END IF;
  IF position(E'    v_n := NULLIF(v_it->>''on_hand'','''')::int;\n    IF v_n IS NULL OR v_n < 0 THEN v_skip := v_skip + 1; CONTINUE; END IF;' IN src) = 0 THEN
    RAISE EXCEPTION '❌ مرساة التحويل الرقميّ غير موجودة — أوقِفت.';
  END IF;
  src := replace(src,
    E'    v_n := NULLIF(v_it->>''on_hand'','''')::int;\n    IF v_n IS NULL OR v_n < 0 THEN v_skip := v_skip + 1; CONTINUE; END IF;',
    -- v15.20 item ٢: صنفٌ برقمٍ غيرِ صحيحٍ يُتجاوَز، ولا تنفجر الدفعة
    E'    -- v15.20 item 2 — رقمٌ عشريٌّ أو نصٌّ كان يرفع استثناءً فيُجهض الدفعةَ\n'
    || E'    --   كلَّها بـ٥٠٠. ونظامٌ يبيع بالوزن يرسل 1.5 — وهو قطاعٌ مُعلَنٌ مدعوماً.\n'
    || E'    BEGIN\n'
    || E'      v_n := NULLIF(btrim(COALESCE(v_it->>''on_hand'','''')), '''')::int;\n'
    || E'    EXCEPTION WHEN OTHERS THEN\n'
    || E'      v_n := NULL;\n'
    || E'      v_skipwhy := v_skipwhy || to_jsonb(''QTY_NOT_AN_INTEGER''::text);\n'
    || E'      v_skip := v_skip + 1; CONTINUE;\n'
    || E'    END;\n'
    || E'    IF v_n IS NULL OR v_n < 0 THEN\n'
    || E'      v_skip := v_skip + 1;\n'
    || E'      v_skipwhy := v_skipwhy || to_jsonb(CASE WHEN v_n IS NULL THEN ''QTY_MISSING'' ELSE ''QTY_NEGATIVE'' END::text);\n'
    || E'      CONTINUE;\n'
    || E'    END IF;\n'
    || E'    -- v15.20 item 4 — محورُ الربط يجب أن يوجد في العرض فعلاً: رابطٌ على\n'
    || E'    --   صنفٍ في عرضٍ بلا أصناف يتجاهله `taki_set_on_hand` بصمتٍ ويردّ\n'
    || E'    --   `ok:true` — فيُعَدّ تطبيقاً والرقمُ لم يتحرّك.\n'
    || E'    IF v_link.variant_id IS NOT NULL AND NOT EXISTS (\n'
    || E'         SELECT 1 FROM public.deals d, jsonb_array_elements(COALESCE(d.variants,''[]''::jsonb)) e\n'
    || E'          WHERE d.id = v_link.deal_id AND e->>''id'' = v_link.variant_id) THEN\n'
    || E'      v_skip := v_skip + 1;\n'
    || E'      v_skipwhy := v_skipwhy || to_jsonb(''LINK_VARIANT_MISSING''::text);\n'
    || E'      CONTINUE;\n'
    || E'    END IF;\n'
    || E'    IF v_link.location_id IS NOT NULL AND NOT EXISTS (\n'
    || E'         SELECT 1 FROM public.deals d, jsonb_array_elements(COALESCE(d.locations,''[]''::jsonb)) e\n'
    || E'          WHERE d.id = v_link.deal_id AND e->>''id'' = v_link.location_id) THEN\n'
    || E'      v_skip := v_skip + 1;\n'
    || E'      v_skipwhy := v_skipwhy || to_jsonb(''LINK_LOCATION_MISSING''::text);\n'
    || E'      CONTINUE;\n'
    || E'    END IF;');
  IF src = src0 THEN RAISE EXCEPTION '❌ لم تقع الرقعة.'; END IF;
  EXECUTE src;
  IF position('v15.20 item' IN pg_get_functiondef('public._taki_stock_apply(uuid,jsonb,timestamptz,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ الرقعة لم تُنفَّذ.';
  END IF;
  RAISE NOTICE '✅ ٢+٤) صنفٌ معطوبٌ يُتجاوَز بسببه · ومحورٌ مفقودٌ يُقال.';
END
$patch$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) الخنقُ: ردٌّ لا استثناء · وبعد التعرّف لا قبله
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 وفحصي أمسك أمراً أدقَّ مما قاله التدقيق، ويُقال كما قِيس: حدُّ المعدّل
--    كان يسبق **البحثَ عن الاتصال** أصلاً — فالرسالةُ المخنوقة لم تكن
--    تُحفظ قطّ (لا أنها حُفظت ثمّ أُلغيت). والترتيبُ نفسُه عيبان:
--      • لا أثرَ لرسالةٍ خُنقت في أيّ مكان، والتاجر لا يعرف لماذا توقّف رقمُه.
--      • ومفتاحٌ **مجهول** يستهلك الحصّة ويُنشئ صفَّ عدٍّ في
--        `rate_limit_counters` لكلّ مفتاحٍ مخترَع ⇒ سطحُ إنهاكٍ مجّانيّ
--        لأيّ أحدٍ على الإنترنت.
--    ⇒ يُنقل الحارسُ **بعد** التعرّف: فالمجهولُ يُرفض قبل أن يمسّ العدّاد،
--      والمعروفُ المخنوق يُوسَم **مرّةً واحدة** (وسمٌ لكلّ دفقةٍ لا لكلّ رسالة،
--      وإلّا هدم الوسمُ الغرضَ من الحدّ نفسه).
DO $patch$
DECLARE src text; src0 text; v_blk text;
BEGIN
  src := pg_get_functiondef('public.taki_stock_webhook(text,jsonb,text)'::regprocedure);
  src0 := src;
  IF position('v15.20 throttle2' IN src) > 0 THEN RAISE NOTICE 'ℹ️ مرقوعةٌ أصلاً.'; RETURN; END IF;

  -- (أ) تُنزع الكتلةُ القديمة أو الأصلية من موضعها السابق للتعرّف
  IF position('v15.20 throttle' IN src) > 0 THEN
    v_blk := substr(src, position(E'  -- v15.20 throttle' IN src));
    v_blk := left(v_blk, position(E'  END;' IN v_blk) + 6);
    src := replace(src, v_blk, '');
  ELSIF position(E'  PERFORM public.taki_rate_check(''stockhook:'' || left(v_hash, 16), 300, 60,\n                                 ''too many webhooks — slow down'');' IN src) > 0 THEN
    src := replace(src,
      E'  PERFORM public.taki_rate_check(''stockhook:'' || left(v_hash, 16), 300, 60,\n                                 ''too many webhooks — slow down'');', '');
  ELSE
    RAISE EXCEPTION '❌ لم يُعثر على كتلة حدّ المعدّل بأيّ صيغة — أوقِفت.';
  END IF;

  -- (ب) وتُزرع بعد `UNKNOWN_KEY`
  IF position(E'  IF NOT FOUND THEN RETURN jsonb_build_object(''ok'', false, ''error'', ''UNKNOWN_KEY''); END IF;' IN src) = 0 THEN
    RAISE EXCEPTION '❌ مرساة UNKNOWN_KEY غير موجودة — أوقِفت.';
  END IF;
  src := replace(src,
    E'  IF NOT FOUND THEN RETURN jsonb_build_object(''ok'', false, ''error'', ''UNKNOWN_KEY''); END IF;',
    E'  IF NOT FOUND THEN RETURN jsonb_build_object(''ok'', false, ''error'', ''UNKNOWN_KEY''); END IF;\n'
    || E'\n'
    || E'  -- v15.20 throttle2 — **بعد** التعرّف: مفتاحٌ مجهولٌ لا يمسّ العدّاد،\n'
    || E'  --   والمخنوقُ يُوسَم مرّةً لكلّ دفقة. ويُردّ خنقاً لا خطأً: ٥٠٢ تُحسب\n'
    || E'  --   فشلاً عند زد (٣٠ في ساعةٍ ⇒ تعطيلُ الخطّاف وإلغاءُ أحداثه)،\n'
    || E'  --   و٤٢٩ **لا تُحسب فشلاً** بنصّ وثيقتهم.\n'
    || E'  BEGIN\n'
    || E'    PERFORM public.taki_rate_check(''stockhook:'' || left(v_hash, 16), 300, 60,\n'
    || E'                                   ''too many webhooks — slow down'');\n'
    || E'  EXCEPTION WHEN OTHERS THEN\n'
    || E'    UPDATE public.stock_integrations SET last_note = ''THROTTLED''\n'
    || E'     WHERE id = v_i.id AND COALESCE(last_note, '''') <> ''THROTTLED'';\n'
    || E'    RETURN jsonb_build_object(''ok'', true, ''throttled'', true, ''retry_after'', 60);\n'
    || E'  END;');

  IF src = src0 THEN RAISE EXCEPTION '❌ لم تقع الرقعة.'; END IF;
  EXECUTE src;
  src := pg_get_functiondef('public.taki_stock_webhook(text,jsonb,text)'::regprocedure);
  IF position('v15.20 throttle2' IN src) = 0 THEN RAISE EXCEPTION '❌ الرقعة لم تُنفَّذ.'; END IF;
  -- 🔴 والترتيبُ يُقاس لا يُفترض: الحارسُ **بعد** UNKNOWN_KEY
  IF position('UNKNOWN_KEY' IN src) > position('taki_rate_check' IN src) THEN
    RAISE EXCEPTION '❌ 🔴 الحارسُ ما زال قبل التعرّف — مفتاحٌ مجهولٌ يستهلك العدّاد.';
  END IF;
  IF position('v15.20 throttle' IN src) <> position('v15.20 throttle2' IN src) THEN
    RAISE EXCEPTION '❌ بقيت كتلتا خنقٍ في النصّ.';
  END IF;
  RAISE NOTICE '✅ ٣) الخنقُ بعد التعرّف · ردٌّ لا استثناء · ووسمٌ لكلّ دفقة.';
END
$patch$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) القاعدةُ تبني الجسمَ وتوقّعه — والبوتُ ناقلٌ أعمى
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 وأوّلُ صياغةٍ كتبتُها كانت **رقعةً على تخمين**: افترضتُ اسمَ متغيّر صفٍّ
--    (`r`) لم أقرأه. ثمّ قرأتُ النصّ الحيّ فكان `u`، و`external_id` استعلامٌ
--    فرعيّ لا عمود. فأُعيدت الكتابةُ كاملةً من النصّ الحيّ.
-- 🪤 و**الجسمُ يُبنى هنا وحده**: `jsonb` لا يحفظ ترتيبَ المفاتيح، فمحاولةُ
--    مطابقة `JSON.stringify` في البوت بايتاً ببايت وهمٌ. والحلُّ أن يكون
--    للجسم كاتبٌ واحدٌ (القاعدة) وللبوت نقلٌ حرفيّ — فالتوقيعُ فوق البايتات
--    المرسَلة فعلاً مهما كان ترتيبُها.
DROP FUNCTION IF EXISTS public.bot_pull_stock_events(integer);
CREATE FUNCTION public.bot_pull_stock_events(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_rows jsonb;
BEGIN
  IF NOT public._bot_gate_ok() THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;
  -- 🪤 `SKIP LOCKED` فلا يلتقط عاملان نفسَ الصفّ، و`picked_at` يُعيد العالق
  --    بعد عشر دقائق — عاملٌ مات وهو ممسكٌ بصفٍّ لا يجوز أن يُجمّده أبداً.
  WITH claimed AS (
    SELECT e.id FROM public.stock_events e
     WHERE e.status = 'pending'
       AND (e.picked_at IS NULL OR e.picked_at < now() - interval '10 minutes')
       AND e.attempts < 8
     ORDER BY e.id
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
     FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.stock_events e SET picked_at = now(), attempts = e.attempts + 1
      FROM claimed c WHERE e.id = c.id RETURNING e.*
  ), joined AS (
    SELECT u.*, i.webhook_url, i.webhook_secret, i.id AS integration_id,
           -- 🪤 ويُقيَّد البحثُ بالاتصال نفسه: بلا ذلك يُؤخذ كودُ منتجٍ من
           --    اتصالٍ آخر لنفس المتجر. (وقيدُ التفرّد في القسم ٦ يجعلها
           --    مستحيلةً عملياً — والقيدان معاً لا أحدُهما.)
           (SELECT l.external_id FROM public.stock_links l
             WHERE l.integration_id = i.id AND l.deal_id = u.deal_id
               AND l.variant_id IS NOT DISTINCT FROM u.variant_id
               AND l.location_id IS NOT DISTINCT FROM u.location_id LIMIT 1) AS external_id
      FROM upd u
      LEFT JOIN LATERAL (SELECT * FROM public.stock_integrations si
                          WHERE si.store_id = u.store_id AND si.is_enabled
                            AND si.direction IN ('out','both') AND si.webhook_url IS NOT NULL
                          ORDER BY si.created_at LIMIT 1) i ON true
  ), bodied AS (
    SELECT j.*, (jsonb_build_object(
      'event_id', j.id, 'reason', j.reason, 'deal_id', j.deal_id,
      'external_id', j.external_id, 'variant_id', j.variant_id,
      'location_id', j.location_id, 'delta', j.delta,
      'on_hand', j.on_hand_after, 'barcode', j.barcode,
      'occurred_at', j.occurred_at))::text AS body_raw
      FROM joined j
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', b.id, 'store_id', b.store_id, 'webhook_url', b.webhook_url,
    'body_raw', b.body_raw,
    -- v15.20 sign — لا يخرج السرُّ من القاعدة أبداً.
    'signature', 'sha256=' || encode(
        extensions.hmac(b.body_raw, COALESCE(b.webhook_secret, ''), 'sha256'), 'hex')
  ) ORDER BY b.id), '[]'::jsonb) INTO v_rows FROM bodied b;
  RETURN jsonb_build_object('ok', true, 'events', v_rows);
END
$fn$;
REVOKE ALL ON FUNCTION public.bot_pull_stock_events(integer) FROM PUBLIC;
-- 🪤 واستثناءُ `bot_*` قائمٌ عمداً: الحارسُ هو `_bot_gate_ok()` بالسرّ لا بالدور.
GRANT EXECUTE ON FUNCTION public.bot_pull_stock_events(integer) TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٦) اتصالٌ واحدٌ لكلّ متجر — قيداً لا اصطلاحاً · وللتجّار لا للمشترين
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 والتصميمُ كان «واحدٌ لكلّ متجر» منذ v15.08 لكنه لم يكن **قيداً**، والشاشةُ
--    تقرأ `limit(1)` — فاتصالٌ ثانٍ يصير غيرَ مرئيٍّ ولا يُحذف. وخطأُ شبكةٍ
--    عابرٌ عند الإنشاء يكفي لإنتاجه.
DO $u$
DECLARE v_dups int;
BEGIN
  SELECT count(*) INTO v_dups FROM (
    SELECT store_id FROM public.stock_integrations GROUP BY store_id HAVING count(*) > 1) d;
  IF v_dups > 0 THEN
    RAISE EXCEPTION '❌ يوجد % متجرٍ بأكثر من اتصال — يُراجَع يدوياً قبل القيد.', v_dups;
  END IF;
END
$u$;
CREATE UNIQUE INDEX IF NOT EXISTS ux_stock_integrations_store_one
  ON public.stock_integrations (store_id);

DO $patch$
DECLARE src text; src0 text;
BEGIN
  src := pg_get_functiondef('public.merchant_create_integration(text,text,text,text)'::regprocedure);
  src0 := src;
  IF position('v15.20 seller' IN src) > 0 THEN RAISE NOTICE 'ℹ️ مرقوعةٌ أصلاً.'; RETURN; END IF;
  IF position(E'  IF v_me IS NULL THEN RETURN jsonb_build_object(''ok'', false, ''error'', ''AUTH_REQUIRED''); END IF;' IN src) = 0 THEN
    RAISE EXCEPTION '❌ مرساة الحارس غير موجودة — أوقِفت.';
  END IF;
  -- 🪤 و`user_type <> 'buyer'` لا `= 'seller'`: متجرُ ناصر مملوكٌ لحساب أدمن،
  --    وكلُّ مرشِّح `= 'seller'` يُخفيه (درسٌ مسجَّل في CLAUDE.md).
  src := replace(src,
    E'  IF v_me IS NULL THEN RETURN jsonb_build_object(''ok'', false, ''error'', ''AUTH_REQUIRED''); END IF;',
    E'  IF v_me IS NULL THEN RETURN jsonb_build_object(''ok'', false, ''error'', ''AUTH_REQUIRED''); END IF;\n'
    || E'  -- v15.20 seller — كان مفتوحاً لأيّ مستخدمٍ موثَّق بما فيهم المشترون.\n'
    || E'  --   و`<> ''buyer''` لا `= ''seller''`: متجرُ تاكي مملوكٌ لحساب أدمن.\n'
    || E'  IF NOT EXISTS (SELECT 1 FROM public.users u\n'
    || E'                  WHERE u.id = v_me AND COALESCE(u.user_type,''buyer'') <> ''buyer''\n'
    || E'                    AND u.deleted_at IS NULL) THEN\n'
    || E'    RETURN jsonb_build_object(''ok'', false, ''error'', ''SELLERS_ONLY'');\n'
    || E'  END IF;\n'
    || E'  IF EXISTS (SELECT 1 FROM public.stock_integrations s WHERE s.store_id = v_me) THEN\n'
    || E'    RETURN jsonb_build_object(''ok'', false, ''error'', ''ALREADY_LINKED'',\n'
    || E'      ''hint'', ''delete or rotate the existing link instead of creating a second one'');\n'
    || E'  END IF;');
  IF src = src0 THEN RAISE EXCEPTION '❌ لم تقع الرقعة.'; END IF;
  EXECUTE src;
  IF position('v15.20 seller' IN pg_get_functiondef('public.merchant_create_integration(text,text,text,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ الرقعة لم تُنفَّذ.';
  END IF;
  RAISE NOTICE '✅ ٦) الإنشاءُ للتجّار · واحدٌ لكلّ متجر · وقيدٌ في القاعدة.';
END
$patch$;

-- ويُولَّد المسارُ لحظةَ الإنشاء (v15.17 أضافت العمودَ ولم تمسّ الإنشاء)
DO $patch$
DECLARE src text; src0 text;
BEGIN
  src := pg_get_functiondef('public.merchant_create_integration(text,text,text,text)'::regprocedure);
  src0 := src;
  IF position('webhook_slug' IN src) > 0 THEN RAISE NOTICE 'ℹ️ المسارُ يُولَّد أصلاً.'; RETURN; END IF;
  IF position(E'(store_id, provider, segment, label, api_key_hash, api_key_last4, webhook_url, webhook_secret)' IN src) = 0 THEN
    RAISE EXCEPTION '❌ مرساة الإدراج غير موجودة — أوقِفت.';
  END IF;
  src := replace(src,
    E'(store_id, provider, segment, label, api_key_hash, api_key_last4, webhook_url, webhook_secret)',
    E'(store_id, provider, segment, label, api_key_hash, api_key_last4, webhook_url, webhook_secret, webhook_slug)');
  src := replace(src,
    E'          NULLIF(btrim(p_webhook_url),''''), v_sec)',
    E'          NULLIF(btrim(p_webhook_url),''''), v_sec,\n'
    || E'          encode(extensions.gen_random_bytes(18), ''hex''))');
  -- ويُعاد الرابطُ الجاهز في نفس الردّ، فلا تبنيه الواجهةُ من المفتاح
  src := replace(src,
    E'    ''endpoint'', ''https://api.takisa.net/rest/v1/rpc/taki_stock_push'');',
    E'    ''endpoint'', ''https://api.takisa.net/rest/v1/rpc/taki_stock_push'',\n'
    || E'    ''hook_url'', ''https://api.takisa.net/functions/v1/stock-webhook/h/''\n'
    || E'               || (SELECT webhook_slug FROM public.stock_integrations WHERE id = v_id));');
  IF src = src0 THEN RAISE EXCEPTION '❌ لم تقع الرقعة.'; END IF;
  EXECUTE src;
  IF position('webhook_slug' IN pg_get_functiondef('public.merchant_create_integration(text,text,text,text)'::regprocedure)) = 0
     OR position('hook_url' IN pg_get_functiondef('public.merchant_create_integration(text,text,text,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ الرقعة لم تُنفَّذ كاملةً.';
  END IF;
  RAISE NOTICE '✅ ٦-ب) الإنشاءُ يُولّد المسارَ ويُعيد الرابطَ الجاهز.';
END
$patch$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٧) فحصٌ يرفع استثناءً — وكلُّ حارسٍ يُجرَّب في الشرط الذي يكسره
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  v_me text; v_deal text; v_int uuid; v_oh0 int; v_oh int; r jsonb; v_pfx text;
  v_t0 timestamptz := now();
  K constant text := 'taki_v1520_probe_0123456789abcdef';
BEGIN
  -- ── (٠) البنيةُ والصلاحيات ────────────────────────────────────────────
  IF to_regprocedure('public.merchant_clear_field_map(uuid)') IS NULL THEN
    RAISE EXCEPTION '❌ مخرجُ تصفير الخريطة غير موجود.';
  END IF;
  IF has_function_privilege('anon', 'public.merchant_clear_field_map(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ مخرجُ التصفير ممنوحٌ للزائر.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE tablename = 'stock_integrations' AND indexname = 'ux_stock_integrations_store_one') THEN
    RAISE EXCEPTION '❌ قيدُ «اتصالٌ واحدٌ لكلّ متجر» غير موجود.';
  END IF;
  -- و`hmac` موجودةٌ فعلاً (وإلّا فالتوقيعُ في القاعدة وهم)
  IF encode(extensions.hmac('abc', 'k', 'sha256'), 'hex') IS NULL THEN
    RAISE EXCEPTION '❌ extensions.hmac غير متاحة.';
  END IF;
  IF position('webhook_secret'', i.webhook_secret' IN pg_get_functiondef('public.bot_pull_stock_events(integer)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION '❌ 🔴 السرُّ ما زال يخرج من bot_pull_stock_events.';
  END IF;
  IF position('body_raw' IN pg_get_functiondef('public.bot_pull_stock_events(integer)'::regprocedure)) = 0
     OR position('extensions.hmac' IN pg_get_functiondef('public.bot_pull_stock_events(integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ الجسمُ والتوقيعُ لا يُبنيان في القاعدة.';
  END IF;
  IF position('SELLERS_ONLY' IN pg_get_functiondef('public.merchant_create_integration(text,text,text,text)'::regprocedure)) = 0
     OR position('hook_url' IN pg_get_functiondef('public.merchant_create_integration(text,text,text,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ حارسُ الإنشاء أو الرابطُ الجاهز مفقود.';
  END IF;

  -- ── عرضٌ واتصالٌ للقياس ───────────────────────────────────────────────
  SELECT d.store_id, d.id, d.on_hand INTO v_me, v_deal, v_oh0
    FROM public.deals d
   WHERE d.on_hand IS NOT NULL AND COALESCE(d.is_unlimited, false) = false
     AND public.taki_open_holds(d.id, NULL, NULL) = 0
   ORDER BY d.id LIMIT 1;
  IF v_deal IS NULL THEN RAISE NOTICE 'ℹ️ لا عرضَ صالحٌ — تخطّي السلوكيّ.'; RETURN; END IF;

  INSERT INTO public.stock_integrations
    (store_id, provider, segment, label, api_key_hash, api_key_last4, webhook_slug)
  VALUES (v_me, 'custom', 'other', 'v1520-verify',
          encode(extensions.digest(K,'sha256'),'hex'), right(K,4),
          encode(extensions.gen_random_bytes(18),'hex'))
  RETURNING id INTO v_int;
  INSERT INTO public.stock_links (integration_id, store_id, deal_id, external_id)
  VALUES (v_int, v_me, v_deal, 'V1520-OK');
  -- رابطٌ على محورِ صنفٍ لا يوجد في العرض
  INSERT INTO public.stock_links (integration_id, store_id, deal_id, external_id, variant_id)
  VALUES (v_int, v_me, v_deal, 'V1520-BADVAR', 'no-such-variant-id');

  -- ╔═ (أ) 🔴 رقمٌ عشريٌّ لا يُسقط الدفعة ═══════════════════════════════════╗
  r := public.taki_stock_push(K, jsonb_build_array(
         jsonb_build_object('external_id', 'V1520-OK',  'on_hand', '1.5'),
         jsonb_build_object('external_id', 'V1520-OK',  'on_hand', v_oh0 + 2)),
         now(), 'v1520-decimal');
  IF NOT COALESCE((r->>'ok')::boolean, false) THEN
    RAISE EXCEPTION '❌ 🔴 رقمٌ عشريٌّ أسقط الدفعةَ كلَّها: %', r::text;
  END IF;
  IF NOT (r->'skip_reasons' @> '["QTY_NOT_AN_INTEGER"]'::jsonb) THEN
    RAISE EXCEPTION '❌ سببُ التجاوُز لم يُقَل: %', r::text;
  END IF;
  IF COALESCE((r->>'applied')::int, 0) <> 1 THEN
    RAISE EXCEPTION '❌ الصنفُ السليمُ في نفس الدفعة لم يُطبَّق: %', r::text;
  END IF;
  SELECT on_hand INTO v_oh FROM public.deals WHERE id = v_deal;
  IF v_oh <> v_oh0 + 2 THEN RAISE EXCEPTION '❌ الرقمُ السليم لم يُكتب (%).', v_oh; END IF;
  RAISE NOTICE '✅ أ) عشريٌّ يُتجاوَز بسببه · والسليمُ في نفس الدفعة يُكتب.';

  -- ╔═ (ب) 🔴 محورٌ مفقودٌ يُقال، ولا يُعَدّ تطبيقاً ════════════════════════╗
  r := public.taki_stock_push(K, jsonb_build_array(
         jsonb_build_object('external_id', 'V1520-BADVAR', 'on_hand', v_oh0 + 9)),
         now(), 'v1520-badvar');
  IF COALESCE((r->>'applied')::int, -1) <> 0 THEN
    RAISE EXCEPTION '❌ 🔴 رابطٌ على صنفٍ غيرِ موجودٍ عُدّ تطبيقاً: %', r::text;
  END IF;
  IF NOT (r->'skip_reasons' @> '["LINK_VARIANT_MISSING"]'::jsonb) THEN
    RAISE EXCEPTION '❌ سببُ المحور المفقود لم يُقَل: %', r::text;
  END IF;
  RAISE NOTICE '✅ ب) محورٌ مفقود: لا تطبيقَ، والسببُ مُعلَن.';

  -- ╔═ (ج) 🔴 الخنقُ ردٌّ لا استثناء، والحمولةُ تبقى محفوظة ════════════════╗
  v_pfx := 'stockhook:' || left(encode(extensions.digest(K, 'sha256'), 'hex'), 16);
  -- تُستهلك الحصّةُ بنداءِ الحارس مباشرةً (أرخصُ من ٣٠٠ رسالةٍ حقيقية)
  FOR i IN 1 .. 301 LOOP
    BEGIN PERFORM public.taki_rate_check(v_pfx, 300, 60, 'x'); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
  r := public.taki_stock_webhook(K, jsonb_build_object('id','V1520-OK','quantity', v_oh0 + 3));
  IF NOT COALESCE((r->>'throttled')::boolean, false) THEN
    RAISE EXCEPTION '❌ 🔴 الخنقُ لم يُبلَّغ خنقاً — فيصل الحافةَ خطأً فتردّ ٥٠٢ وتُعطَّل دائرةُ زد: %', r::text;
  END IF;
  IF NOT COALESCE((r->>'ok')::boolean, false) THEN
    RAISE EXCEPTION '❌ الخنقُ رُدّ خطأً لا خنقاً: %', r::text;
  END IF;
  -- والأثرُ موجود: وسمٌ يقول للتاجر لماذا توقّف رقمُه
  IF COALESCE((SELECT last_note FROM public.stock_integrations WHERE id = v_int), '') <> 'THROTTLED' THEN
    RAISE EXCEPTION '❌ 🔴 رسالةٌ خُنقت بلا أيّ أثر — والتاجر لا يعرف لماذا توقّف رقمُه.';
  END IF;
  -- 🔴 ومفتاحٌ مجهولٌ يُرفض **بلا** أن يمسّ العدّاد
  IF COALESCE((public.taki_stock_webhook('taki_unknown_key_0123456789abcdef',
        '{"id":"x","quantity":1}'::jsonb)->>'error'), '') <> 'UNKNOWN_KEY' THEN
    RAISE EXCEPTION '❌ مفتاحٌ مجهولٌ لم يُرفض بـUNKNOWN_KEY.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rate_limit_counters
              WHERE bucket_key = 'stockhook:' || left(encode(extensions.digest('taki_unknown_key_0123456789abcdef','sha256'),'hex'), 16)) THEN
    RAISE EXCEPTION '❌ 🔴 مفتاحٌ مجهولٌ أنشأ صفَّ عدٍّ — سطحُ إنهاكٍ مجّانيّ.';
  END IF;
  RAISE NOTICE '✅ ج) الخنقُ ردٌّ موسومٌ · ومجهولٌ لا يمسّ العدّاد.';

  -- ╔═ (د) اتصالٌ ثانٍ لنفس المتجر يُرفض قيداً ═════════════════════════════╗
  BEGIN
    INSERT INTO public.stock_integrations
      (store_id, provider, segment, label, api_key_hash, api_key_last4)
    VALUES (v_me, 'custom', 'other', 'v1520-dup',
            encode(extensions.digest('dup1520','sha256'),'hex'), 'dupx');
    RAISE EXCEPTION '❌ 🔴 قُبل اتصالٌ ثانٍ لنفس المتجر — يصير غيرَ مرئيٍّ ولا يُحذف.';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE '✅ د) اتصالٌ ثانٍ مرفوضٌ قيداً.';
  END;

  -- ╔═ (هـ) الاستعادة ══════════════════════════════════════════════════════╗
  PERFORM public.taki_set_on_hand(v_deal, v_oh0, NULL, NULL, now(), 'init');
  DELETE FROM public.stock_integrations WHERE id = v_int;
  DELETE FROM public.stock_events WHERE deal_id = v_deal AND occurred_at >= v_t0;
  SELECT on_hand INTO v_oh FROM public.deals WHERE id = v_deal;
  IF v_oh <> v_oh0 THEN RAISE EXCEPTION '❌ العرضُ % لم يعد إلى %.', v_deal, v_oh0; END IF;
  IF EXISTS (SELECT 1 FROM public.stock_integrations WHERE label LIKE 'v1520-%') THEN
    RAISE EXCEPTION '❌ بقيّةُ فحصٍ لم تُحذف.';
  END IF;
  RAISE NOTICE '✅ v15.20: ستُّ حالاتٍ صامتة سُدّت، وكلُّها قِيست في الشرط الذي يكسرها.';
END
$verify$;
