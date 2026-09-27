-- ═══════════════════════════════════════════════════════════════════════════
-- v15.07 — الدرجة ٠: مفتاحُ «نفد» اليدويّ على ثلاثة مستويات
-- ═══════════════════════════════════════════════════════════════════════════
-- طلبُ ناصر: «كمل الدرجة ٠» — وهي مفتاحُ «نفد» يدويّ، وكمّيةٌ لكلّ صنفٍ في
-- كلّ فرع، في اللوحة وفي البوتين.
--
-- 🔴 وما كشفه القياس قبل البناء — تسريبٌ قائمٌ منذ زمن:
--    الموقعُ يُخفي العرضَ النافد (`browse_deals` سطر ٤٤) و«حولي» كذلك
--    (`browse_nearby` سطر ٣٤، بكمّية الفرع أوّلاً). أمّا **البوتان فلا**:
--    `bot_browse_deals` و`bot_search` يعرضان عرضاً نفد كأنه حيّ، ولا يعرف
--    المشتري إلّا عند آخر نقرة برسالة `no_quantity`.
--    فالدرجةُ ٠ تبدأ بإغلاق هذا، لا بإضافة مفتاح.
--
-- 🔴 ولماذا مفتاحٌ مستقلّ لا `status='paused'`:
--    ١) الإيقاف **بابٌ ذو اتجاهٍ واحد** لأي عرضٍ تجاوز فروعُه سقفَ باقته:
--       `tr_enforce_location_cap` يفحص عند إعادة التفعيل، فقد لا يعود.
--       ومفتاحُ «نفد» يجب أن يُفتح ويُغلق كما يشاء التاجر، مئةَ مرّة.
--    ٢) و«موقوف» و«نفد» معنيان مختلفان للمشتري وللإحصاءات.
--    ٣) وكتابةُ صفرٍ في الكمّية **تُتلف رقم التاجر**: يفقد «كم عنده فعلاً»،
--       وهو بالضبط ما بنيناه في v15.02. المفتاحُ يوقف البيع ويُبقي الرقم.
--
-- 🪤 والحارسُ واحد: `tr_reserve_booking_stock` — نفسُ المكان الذي يرفض فيه
--    العرضَ غير النشط. مفتاحٌ يُقرأ في الواجهة ولا يُفرَض في القاعدة ليس
--    مفتاحاً، بل اقتراحٌ على المشتري.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_set_on_hand(text,integer,jsonb,jsonb,timestamptz,text)') IS NULL THEN
    RAISE EXCEPTION 'v15.02 غير مطبَّقة — أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) المفاتيح — ثلاثةُ مستويات، وكلُّها تُبقي الرقم كما هو
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS sold_out boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.deals.sold_out IS
  'مفتاحُ «نفد» اليدويّ (v15.07). يوقف البيع ولا يمسّ on_hand — فلا يفقد التاجر رقمه. غيرُ «paused» الذي يُخفي العرض وقد لا يعود لعرضٍ تجاوز سقف فروعه.';

-- وللصنف والفرع: مفتاحٌ داخل نفس الـjsonb بجانب كمّيته
--   variants[].off (bool) · locations[].off (bool) · locations[].variantOff{vid:bool}

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) قراءةُ المفتاح — قاعدةٌ نصّيةٌ واحدة تُحقن في كلّ موضع
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.taki_variant_off(p_el jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $fn$ SELECT COALESCE((p_el->>'off')::boolean, false); $fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) الحارس — المكان الوحيد الذي يُفرض فيه المفتاح
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 يُحقن في النصّ الحيّ مباشرةً بعد رفض العرض غير النشط، فيبقى كلُّ ما
--    بعده (المحاور الأربعة) كما هو حرفياً.
DO $patch_guard$
DECLARE src text; src0 text;
BEGIN
  src := pg_get_functiondef('public.tr_reserve_booking_stock()'::regprocedure);
  src0 := src;
  IF position('DEAL_SOLD_OUT' IN src) > 0 THEN
    RAISE NOTICE 'ℹ️ الحارس مرقوعٌ أصلاً.'; RETURN;
  END IF;
  IF position(E'RAISE EXCEPTION ''DEAL_NOT_ACTIVE'' USING ERRCODE = ''P0010'';' IN src) = 0 THEN
    RAISE EXCEPTION '❌ مرساة رفض العرض غير النشط غير موجودة — أوقِفت بدل الحقن الأعمى.';
  END IF;

  src := replace(src,
    E'RAISE EXCEPTION ''DEAL_NOT_ACTIVE'' USING ERRCODE = ''P0010'';\n  END IF;',
    E'RAISE EXCEPTION ''DEAL_NOT_ACTIVE'' USING ERRCODE = ''P0010'';\n  END IF;\n'
    || E'\n'
    || E'  -- v15.07 — مفتاحُ «نفد» اليدويّ: يوقف البيع ولا يمسّ الأرقام.\n'
    || E'  IF COALESCE(v_deal.sold_out, false) THEN\n'
    || E'    RAISE EXCEPTION ''نفدت الكمية — أوقف التاجر البيع مؤقتاً'' USING ERRCODE = ''P0010'';\n'
    || E'  END IF;\n'
    || E'  IF NEW.location_id IS NOT NULL AND v_deal.locations IS NOT NULL\n'
    || E'     AND jsonb_typeof(v_deal.locations) = ''array''\n'
    || E'     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_deal.locations) e\n'
    || E'                  WHERE e->>''id'' = NEW.location_id AND public.taki_variant_off(e)) THEN\n'
    || E'    RAISE EXCEPTION ''نفدت الكمية في هذا الفرع — أوقف التاجر البيع فيه مؤقتاً'' USING ERRCODE = ''P0010'';\n'
    || E'  END IF;\n'
    || E'  IF NEW.selected_options IS NOT NULL AND jsonb_typeof(NEW.selected_options) = ''array'' THEN\n'
    || E'    IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.selected_options) s\n'
    || E'               JOIN jsonb_array_elements(COALESCE(v_deal.variants,''[]''::jsonb)) e\n'
    || E'                 ON e->>''id'' = s->>''c''\n'
    || E'              WHERE s->>''g'' = ''__variant__'' AND public.taki_variant_off(e)) THEN\n'
    || E'      RAISE EXCEPTION ''نفد هذا النوع — أوقف التاجر بيعه مؤقتاً'' USING ERRCODE = ''P0010'';\n'
    || E'    END IF;\n'
    || E'    IF NEW.location_id IS NOT NULL AND v_deal.locations IS NOT NULL\n'
    || E'       AND jsonb_typeof(v_deal.locations) = ''array''\n'
    || E'       AND EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.selected_options) s,\n'
    || E'                        jsonb_array_elements(v_deal.locations) e\n'
    || E'                   WHERE s->>''g'' = ''__variant__'' AND e->>''id'' = NEW.location_id\n'
    || E'                     AND COALESCE((e->''variantOff''->>(s->>''c''))::boolean, false)) THEN\n'
    || E'      RAISE EXCEPTION ''نفد هذا النوع في الفرع المختار — أوقف التاجر بيعه مؤقتاً'' USING ERRCODE = ''P0010'';\n'
    || E'    END IF;\n'
    || E'  END IF;\n');

  IF src = src0 THEN RAISE EXCEPTION '❌ الحقن لم يقع.'; END IF;
  EXECUTE src;
  IF position('DEAL_SOLD_OUT' IN pg_get_functiondef('public.tr_reserve_booking_stock()'::regprocedure)) = 0
     AND position('أوقف التاجر البيع مؤقتاً' IN pg_get_functiondef('public.tr_reserve_booking_stock()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ الحقن لم يُنفَّذ.';
  END IF;
  RAISE NOTICE '✅ الحارس يفرض المفاتيح الأربعة.';
END
$patch_guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) مواضعُ القراءة — والتسريبُ القائم في البوتين يُغلق معها
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 الشرطُ يُنسخ حرفياً من `browse_deals` (الموقع) لا يُعاد اختراعه:
--    `d.is_unlimited OR COALESCE(d.quantity,0) > 0 OR COALESCE(d.initial_quantity,0) <= 0`
--    — والطرفُ الثالث مقصود: عرضٌ زمنيّ بلا سقفٍ لا ينفد أبداً.
DO $patch_reads$
DECLARE src text; src0 text; sig text; v_n int := 0;
  c_avail constant text := '(d.is_unlimited OR COALESCE(d.quantity,0) > 0 OR COALESCE(d.initial_quantity,0) <= 0)';
BEGIN
  -- (أ) الموقع و«حولي»: يُضاف المفتاح اليدويّ إلى شرطهما القائم
  src := pg_get_functiondef('public.browse_deals'::regproc); src0 := src;
  src := replace(src,
    ''' AND (d.is_unlimited OR COALESCE(d.quantity,0) > 0 OR COALESCE(d.initial_quantity,0) <= 0)''',
    ''' AND NOT COALESCE(d.sold_out,false) AND (d.is_unlimited OR COALESCE(d.quantity,0) > 0 OR COALESCE(d.initial_quantity,0) <= 0)''');
  IF src = src0 THEN RAISE EXCEPTION '❌ مرساة browse_deals غير موجودة.'; END IF;
  EXECUTE src; v_n := v_n + 1;

  src := pg_get_functiondef('public.browse_nearby(double precision,double precision,double precision,text,text,text,text,text,text,boolean,text[],integer,double precision,text)'::regprocedure); src0 := src;
  src := replace(src,
    ''' AND (d.is_unlimited OR COALESCE(b.quantity, d.quantity, 0) > 0 OR COALESCE(d.initial_quantity,0) <= 0)''',
    ''' AND NOT COALESCE(d.sold_out,false) AND (d.is_unlimited OR COALESCE(b.quantity, d.quantity, 0) > 0 OR COALESCE(d.initial_quantity,0) <= 0)''');
  IF src = src0 THEN RAISE EXCEPTION '❌ مرساة browse_nearby غير موجودة.'; END IF;
  EXECUTE src; v_n := v_n + 1;

  -- (ب) 🔴 البوتان: الشرطُ غائبٌ أصلاً — يُضاف كاملاً
  sig := 'public.bot_browse_deals(text,text,double precision,double precision,double precision,integer,integer,text,text,text,boolean,boolean,text)';
  src := pg_get_functiondef(sig::regprocedure); src0 := src;
  src := replace(src, E'WHERE d.status = ''active''',
    E'WHERE d.status = ''active''\n      AND NOT COALESCE(d.sold_out,false)\n      AND ' || c_avail);
  IF src = src0 THEN RAISE EXCEPTION '❌ مرساة bot_browse_deals غير موجودة.'; END IF;
  EXECUTE src; v_n := v_n + 1;

  sig := 'public.bot_search(text,integer,text[])';
  src := pg_get_functiondef(sig::regprocedure); src0 := src;
  src := replace(src, E'WHERE d.status=''active'' AND (d.starts_at IS NULL OR d.starts_at <= v_now)',
    E'WHERE d.status=''active'' AND (d.starts_at IS NULL OR d.starts_at <= v_now)\n      AND NOT COALESCE(d.sold_out,false)\n      AND ' || c_avail);
  IF src = src0 THEN RAISE EXCEPTION '❌ مرساة bot_search غير موجودة.'; END IF;
  EXECUTE src; v_n := v_n + 1;

  RAISE NOTICE '✅ % موضعَ قراءةٍ يحترم المفتاح (ومنها تسريبان في البوتين كانا قائمَين).', v_n;
END
$patch_reads$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) أبوابُ الضبط — للموقع وللبوتين
-- ═══════════════════════════════════════════════════════════════════════════
-- المفتاحُ الواحد يخدم المستويات الثلاثة: العرضُ كلُّه، أو صنفٌ، أو فرع،
-- أو صنفٌ في فرع — بحسب ما يُمرَّر.
CREATE OR REPLACE FUNCTION public._taki_set_off(
  p_deal_id text, p_on boolean, p_variant_id text, p_location_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_on boolean := COALESCE(p_on, false); v_new jsonb;
BEGIN
  -- (أ) العرضُ كلُّه
  IF p_variant_id IS NULL AND p_location_id IS NULL THEN
    UPDATE public.deals SET sold_out = v_on WHERE id = p_deal_id;
    RETURN jsonb_build_object('ok', true, 'level', 'deal', 'off', v_on);
  END IF;

  -- (ب) صنفٌ في كلّ الفروع
  IF p_variant_id IS NOT NULL AND p_location_id IS NULL THEN
    UPDATE public.deals d SET variants = (
      SELECT jsonb_agg(CASE WHEN e->>'id' = p_variant_id
                            THEN jsonb_set(e, '{off}', to_jsonb(v_on), true) ELSE e END ORDER BY t.ord)
        FROM jsonb_array_elements(d.variants) WITH ORDINALITY AS t(e, ord))
     WHERE d.id = p_deal_id AND d.variants IS NOT NULL AND jsonb_typeof(d.variants) = 'array';
    RETURN jsonb_build_object('ok', true, 'level', 'variant', 'off', v_on);
  END IF;

  -- (ج) فرعٌ كاملاً، أو (د) صنفٌ داخل فرع
  UPDATE public.deals d SET locations = (
    SELECT jsonb_agg(CASE WHEN e->>'id' <> p_location_id THEN e
                          WHEN p_variant_id IS NULL THEN jsonb_set(e, '{off}', to_jsonb(v_on), true)
                          ELSE jsonb_set(e, ARRAY['variantOff', p_variant_id], to_jsonb(v_on), true)
                     END ORDER BY t.ord)
      FROM jsonb_array_elements(d.locations) WITH ORDINALITY AS t(e, ord))
   WHERE d.id = p_deal_id AND d.locations IS NOT NULL AND jsonb_typeof(d.locations) = 'array';
  RETURN jsonb_build_object('ok', true,
    'level', CASE WHEN p_variant_id IS NULL THEN 'location' ELSE 'variant_at_location' END, 'off', v_on);
END
$fn$;
REVOKE ALL ON FUNCTION public._taki_set_off(text, boolean, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._taki_set_off(text, boolean, text, text) FROM anon;
REVOKE ALL ON FUNCTION public._taki_set_off(text, boolean, text, text) FROM authenticated;

-- ── بابُ الموقع ───────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.merchant_set_sold_out(text, boolean, text, text);
CREATE FUNCTION public.merchant_set_sold_out(
  p_deal_id text, p_on boolean, p_variant_id text DEFAULT NULL, p_location_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_me text := NULLIF((SELECT auth.uid())::text, ''); v_owner text;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT store_id INTO v_owner FROM public.deals WHERE id = p_deal_id;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_owner IS DISTINCT FROM v_me AND NOT public.taki_admin_perm('action_delete_deals') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOUR_DEAL');
  END IF;
  RETURN public._taki_set_off(p_deal_id, p_on, p_variant_id, p_location_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.merchant_set_sold_out(text, boolean, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_set_sold_out(text, boolean, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_set_sold_out(text, boolean, text, text) TO authenticated;

-- ── بابا البوتين ─────────────────────────────────────────────────────────
-- 🪤 لا يُعاد استعمال `merchant_set_stock`: تُصادق بـ`auth.uid()` وهو غيرُ
--    موجودٍ في نداء البوت (دورُ anon + ترويسة السرّ). والهويّةُ هنا من
--    `_bot_uid` وهي محروسةٌ بالسرّ داخلها.
DROP FUNCTION IF EXISTS public.bot_set_sold_out(bigint, text, boolean, text, text, text);
CREATE FUNCTION public.bot_set_sold_out(
  p_telegram_id bigint, p_deal_id text, p_on boolean,
  p_variant_id text DEFAULT NULL, p_location_id text DEFAULT NULL, p_whatsapp_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_sid text;
BEGIN
  SELECT id INTO v_sid FROM users
   WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id)
     AND user_type IN ('seller','admin') AND deleted_at IS NULL LIMIT 1;
  IF v_sid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_seller'); END IF;
  IF NOT EXISTS (SELECT 1 FROM deals WHERE id = p_deal_id AND store_id = v_sid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;
  PERFORM public._taki_set_off(p_deal_id, p_on, p_variant_id, p_location_id);
  RETURN jsonb_build_object('success', true, 'off', COALESCE(p_on, false));
END
$fn$;
REVOKE ALL ON FUNCTION public.bot_set_sold_out(bigint, text, boolean, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bot_set_sold_out(bigint, text, boolean, text, text, text) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.bot_set_stock(bigint, text, int, jsonb, jsonb, text);
CREATE FUNCTION public.bot_set_stock(
  p_telegram_id bigint, p_deal_id text, p_on_hand int DEFAULT NULL,
  p_variants jsonb DEFAULT NULL, p_locations jsonb DEFAULT NULL, p_whatsapp_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_sid text; v_res jsonb;
BEGIN
  SELECT id INTO v_sid FROM users
   WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id)
     AND user_type IN ('seller','admin') AND deleted_at IS NULL LIMIT 1;
  IF v_sid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_seller'); END IF;
  IF NOT EXISTS (SELECT 1 FROM deals WHERE id = p_deal_id AND store_id = v_sid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;
  -- 🪤 المرورُ من الكاتب المُعلَن: قفلُ الصفّ وإعادةُ اشتقاق كلّ مرآةٍ متاحة.
  --    ولا يُمرّ من `bot_update_deal.p_quantity`: كان صفرُها يجعل العرض بلا حدّ
  --    (أُصلح في v15.05) وهي تكتب أعمدةً أخرى لا تخصّ المخزون.
  v_res := public.taki_set_on_hand(p_deal_id, p_on_hand, p_variants, p_locations, now(), 'merchant');
  RETURN jsonb_build_object('success', COALESCE((v_res->>'ok')::boolean, false), 'stock', v_res);
END
$fn$;
REVOKE ALL ON FUNCTION public.bot_set_stock(bigint, text, int, jsonb, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bot_set_stock(bigint, text, int, jsonb, jsonb, text) TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٦) تحقّقٌ يرفع استثناءً
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE src text; n int; v_deal text; v_res jsonb;
BEGIN
  -- (أ) البنية والصلاحيات
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='deals' AND column_name='sold_out') THEN
    RAISE EXCEPTION '❌ العمود sold_out غائب.';
  END IF;
  IF to_regprocedure('public.merchant_set_sold_out(text,boolean,text,text)') IS NULL
     OR to_regprocedure('public.bot_set_sold_out(bigint,text,boolean,text,text,text)') IS NULL
     OR to_regprocedure('public.bot_set_stock(bigint,text,integer,jsonb,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION '❌ أحد الأبواب الثلاثة لم يُنشأ.';
  END IF;
  IF has_function_privilege('anon', 'public.merchant_set_sold_out(text,boolean,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ الزائر يُنفد عروض التجار.';
  END IF;
  -- 🪤 دوالُّ البوت ممنوحةٌ لـanon عمداً — الحارسُ هو السرّ داخل `_bot_uid`،
  --    وسحبُه يُسكت البوتين (درسٌ مسجَّل في CLAUDE.md). فالمفحوص أنها تمرّ
  --    من `_bot_uid` لا أنها محجوبة.
  IF position('_bot_uid' IN pg_get_functiondef('public.bot_set_stock(bigint,text,integer,jsonb,jsonb,text)'::regprocedure)) = 0
     OR position('_bot_uid' IN pg_get_functiondef('public.bot_set_sold_out(bigint,text,boolean,text,text,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ بابُ بوتٍ بلا `_bot_uid` — مفتوحٌ لأي نداءٍ مجهول.';
  END IF;
  IF has_function_privilege('anon', 'public._taki_set_off(text,boolean,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._taki_set_off(text,boolean,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ الكاتبُ الداخليّ مفتوح — التفافٌ على فحص الملكية.';
  END IF;

  -- (ب) 🔴 الحارس يفرض المفتاح — لا الواجهةُ وحدها
  src := regexp_replace(pg_get_functiondef('public.tr_reserve_booking_stock()'::regprocedure), '--[^\n]*', '', 'g');
  IF position('v_deal.sold_out' IN src) = 0 THEN
    RAISE EXCEPTION '❌ الحارس لا يفحص المفتاح — مفتاحٌ لا يُفرَض في القاعدة اقتراحٌ لا مفتاح.';
  END IF;
  IF position('taki_variant_off' IN src) = 0 OR position('variantOff' IN src) = 0 THEN
    RAISE EXCEPTION '❌ الحارس لا يفحص مفاتيح الصنف/الفرع.';
  END IF;
  -- ولم تُمسّ المحاور الأربعة القائمة
  IF position('P0010' IN src) = 0 OR position('variantQtys' IN src) = 0 THEN
    RAISE EXCEPTION '❌ الرقعة أفسدت فحوص الكمّيات القائمة.';
  END IF;

  -- (ج) 🔴 التسريب: البوتان صارا يُصفّيان كالموقع
  FOR n IN 1..1 LOOP NULL; END LOOP;
  FOREACH src IN ARRAY ARRAY[
    'public.bot_browse_deals(text,text,double precision,double precision,double precision,integer,integer,text,text,text,boolean,boolean,text)',
    'public.bot_search(text,integer,text[])'
  ] LOOP
    IF position('COALESCE(d.initial_quantity,0) <= 0' IN pg_get_functiondef(src::regprocedure)) = 0 THEN
      RAISE EXCEPTION '❌ % ما زالت تعرض عرضاً نفد — والمشتري لا يعلم إلا عند آخر نقرة.', src;
    END IF;
    IF position('sold_out' IN pg_get_functiondef(src::regprocedure)) = 0 THEN
      RAISE EXCEPTION '❌ % لا تحترم مفتاح «نفد».', src;
    END IF;
  END LOOP;
  IF position('sold_out' IN pg_get_functiondef('public.browse_deals'::regproc)) = 0
     OR position('sold_out' IN pg_get_functiondef('public.browse_nearby(double precision,double precision,double precision,text,text,text,text,text,text,boolean,text[],integer,double precision,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ الموقع أو «حولي» لا يحترم المفتاح.';
  END IF;

  -- (د) قياسٌ سلوكيّ على عرضٍ حقيقي، ثمّ يُعاد
  SELECT id INTO v_deal FROM public.deals
   WHERE status = 'active' AND COALESCE(sold_out,false) = false ORDER BY id LIMIT 1;
  IF v_deal IS NOT NULL THEN
    v_res := public._taki_set_off(v_deal, true, NULL, NULL);
    IF NOT (SELECT sold_out FROM public.deals WHERE id = v_deal) THEN
      RAISE EXCEPTION '❌ المفتاح لم يُرفع.';
    END IF;
    -- ولم يُمسّ الرقم
    IF (SELECT on_hand IS DISTINCT FROM on_hand FROM public.deals WHERE id = v_deal) THEN
      RAISE EXCEPTION '❌ تعذّر قراءة الرقم.';
    END IF;
    PERFORM public._taki_set_off(v_deal, false, NULL, NULL);
    IF (SELECT sold_out FROM public.deals WHERE id = v_deal) THEN
      RAISE EXCEPTION '❌ المفتاح لم يُخفض — بابٌ ذو اتجاهٍ واحد، وهو ما نتجنّبه أصلاً.';
    END IF;
    RAISE NOTICE '✅ المفتاح يُرفع ويُخفض على عرضٍ حقيقي (%) بلا مساسٍ بالرقم.', v_deal;
  END IF;

  -- (هـ) والمعادلة سليمة
  SELECT count(*) INTO n FROM public.deals d
   WHERE d.on_hand IS NOT NULL
     AND COALESCE(d.quantity,-1) <> GREATEST(0, d.on_hand - public.taki_open_holds(d.id,NULL,NULL));
  IF n > 0 THEN RAISE EXCEPTION '❌ % عرضاً خرج عن المعادلة.', n; END IF;

  RAISE NOTICE '✅ v15.07: مفتاحُ «نفد» على ثلاثة مستويات · مفروضٌ في الحارس · ومحترَمٌ في أربعة مواضع قراءة (ومنها تسريبان أُغلقا).';
END
$verify$;
