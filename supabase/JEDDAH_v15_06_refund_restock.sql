-- ═══════════════════════════════════════════════════════════════════════════
-- v15.06 — «وفي حالة الاسترداد ترجع الكميه» (طلب ناصر، ٢٧ سبتمبر ٢٠٢٦)
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 ما قِيس على الإنتاج قبل هذا الملفّ — نصفُ الطلب يعمل ونصفُه مستحيل:
--
--   • استردادُ طلبٍ **لم يُستلم بعد** (pending/acknowledged) يُعيد الكمّية
--     كاملةً على المحاور الأربعة — مقيسٌ، ولا يحتاج شيئاً.
--   • واستردادُ طلبٍ **مكتمل** لا يُعيد شيئاً إطلاقاً: لا المتاح ولا المخزون
--     الكامل. و`tr_on_hand_on_sale` أنقص الكامل لحظة الإتمام، و**صفرُ دالّةٍ
--     في القاعدة كلّها تزيده**. والإشعارُ يقول للتاجر صراحةً:
--     «فلم تعد كمّيته للبيع — البضاعة خرجت فعلاً».
--
-- وهذا لم يكن عيباً بل **قراراً** من v14.21: بضاعةٌ خرجت من الرفّ لا تعود
-- بقرارٍ برمجيّ. وناصر يُبدّل القرار صراحةً. فالمنفَّذ هنا هو قرارُه — مع
-- إبقاء القرار في يد التاجر كما في v15.01:
--   الافتراضُ **يُعيد**، ولكلّ تاجرٍ مفتاحٌ يُطفئه (خدمةٌ أُدّيت · سلعةٌ
--   تلفت · ردٌّ جزئيّ)، ولكلّ نداءٍ تجاوزٌ صريح.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 خمسةُ فخاخٍ قِيست، وكلُّها كانت ستُسقط تنفيذاً بديهياً:
--
-- ١) **لا يُفتح `guard_booking_status`.** إعادةُ حجزٍ مكتمل إلى «ملغى» تبدو
--    الطريقَ الطبيعي، لكنّ الحارس يُعيد الحالة صامتاً (`NEW.status :=
--    OLD.status`) بلا استثناء — فـ`psql` يقول `UPDATE 1` ولا شيء يتغيّر.
--    وهو محقّ: الفاتورة الضريبية مجمّدة وتسلسلُها بلا فجوات و
--    `tr_guard_booking_delete` كلُّها تتّكئ على أن «مكتمل» حالةٌ نهائية.
--    ⇒ الإرجاعُ حدثٌ مستقلّ (`restocked_qty`) لا انعكاسُ حالة.
--
-- ٢) **`cancelled_by` تنجو من ذلك الحارس وحدَها**، فكتابةٌ ساذجة تترك صفّاً
--    يقول «مكتمل» و«ألغاه الاسترداد» معاً — تناقضٌ لا يُنبّه عليه أحد. قِيس.
--
-- ٣) **بابان لا باب.** `resolve_booking_refund` (قرارُ التاجر على طلبٍ) و
--    `taki_settle_booking_refund` (تسويةُ بوّابة الدفع، وهي التي تعمل فعلاً
--    في الردّ الفوريّ). رقعةُ أحدهما تُصلح باباً لا يُفتح. و
--    `admin_unstick_refund` يفوّض إلى الثاني فيُشفى معه.
--
-- ٤) **لا يُبنى إرجاعٌ بجمعٍ يدويّ على المحاور.** `taki_set_on_hand` هي
--    الكاتبُ المُعلَن: تقفل الصفّ، وتُطفئ رايةَ `tr_b0_stock_declare`،
--    وتُعيد اشتقاق **كلّ** مرآةٍ متاحة من المحجوز الحيّ. جمعٌ يدويّ على
--    `on_hand` وحده يكسر المعادلة لأن المحجوز صفرٌ أصلاً لطلبٍ مكتمل.
--
-- ٥) **الإرجاع يجب أن يكون خاملَ التكرار.** نداءان (إدارةٌ ثمّ إعادةُ
--    محاولة) يُضاعفان البضاعة. `bookings.restocked_qty` سجلٌّ لا عدّاد:
--    يقول كم عاد فعلاً، ويمنع الزيادة عن `booked_quantity`.
--
-- 🪤 وفخٌّ سادس يُغلق هنا لأنه يمسّ نفس الأسطر: **البيعُ كان يُقدّم علامةَ
--    الملاحظة** (`stock_observed_at = now()`)، فدفعةٌ من نظام التاجر لحظتُها
--    أقدمُ من آخر بيع تُرفض بصمت وتعود `ok:true` مع `skipped`. ونظامٌ يستطلع
--    كلّ دقيقة كانت كتاباتُه تُبتلع بلا خطأ. العلامةُ من الآن **للملاحظات
--    الخارجية وحدها**؛ حركاتُنا الداخلية (بيعٌ وإرجاع) لا تُقدّمها.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_set_on_hand(text,integer,jsonb,jsonb,timestamptz,text)') IS NULL
     OR to_regprocedure('public.taki_is_system_caller()') IS NULL THEN
    RAISE EXCEPTION 'v15.02/v14.96 غير مطبَّقتين — أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) سجلُّ ما عاد فعلاً — لا عدّاد
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS restocked_qty int NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.bookings.restocked_qty IS
  'كم وحدةً عادت للمخزون من هذا الطلب (v15.06). يمنع الإرجاع المزدوج، ويسجّل الردّ الجزئي.';

-- ومفتاحُ التاجر: الافتراضُ يُعيد، كما قال ناصر — ومن شاء أطفأه.
ALTER TABLE public.store_profiles ADD COLUMN IF NOT EXISTS refund_restocks boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.store_profiles.refund_restocks IS
  'هل يُعيد الاستردادُ البضاعةَ للمخزون تلقائياً؟ (v15.06) افتراضاً نعم. يُطفأ لمن يبيع خدمةً أو لا يستعيد التالف.';

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) الإرجاع — الدالّة الوحيدة التي تزيد المخزون
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.taki_restock_booking(text, int, text);
CREATE FUNCTION public.taki_restock_booking(
  p_barcode text,
  p_qty     int  DEFAULT NULL,      -- NULL = كلُّ ما لم يُرجَع بعد
  p_reason  text DEFAULT 'refund'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_b        public.bookings%ROWTYPE;
  v_d        public.deals%ROWTYPE;
  v_left     int;
  v_n        int;
  v_variants jsonb;
  v_locs     jsonb;
  v_res      jsonb;
BEGIN
  IF NOT public.taki_is_system_caller() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE barcode = p_barcode FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;

  -- 🪤 الطلبُ غيرُ المكتمل يعود بمسارِ الإلغاء (`adjust_deal_quantity`) — وهو
  --    مقيسٌ وصحيح على المحاور الأربعة. إرجاعُه هنا **أيضاً** يُضاعف البضاعة.
  IF v_b.status IS DISTINCT FROM 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'NOT_COMPLETED', 'status', v_b.status);
  END IF;

  v_left := GREATEST(0, GREATEST(COALESCE(v_b.booked_quantity, 1), 1) - COALESCE(v_b.restocked_qty, 0));
  v_n := LEAST(GREATEST(COALESCE(p_qty, v_left), 0), v_left);
  IF v_n <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'restocked_qty', v_b.restocked_qty);
  END IF;

  -- 🪤 القفلُ على العرض قبل قراءة أرقامه: الإرجاعُ يُحسب من الرقم الحيّ لا من
  --    رقمٍ قُرئ قبل القفل — وإلا دهس نداءان أحدُهما الآخر.
  SELECT * INTO v_d FROM public.deals WHERE id = v_b.deal_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'DEAL_GONE'); END IF;
  IF COALESCE(v_d.is_unlimited, false) OR v_d.on_hand IS NULL THEN
    -- عرضٌ بلا حدّ لا مخزونَ له يُعاد؛ ويُسجَّل الإرجاع كي لا يُعاد النداء.
    UPDATE public.bookings SET restocked_qty = COALESCE(restocked_qty, 0) + v_n WHERE barcode = p_barcode;
    RETURN jsonb_build_object('ok', true, 'skipped', 'UNLIMITED', 'restocked_qty', v_n);
  END IF;

  -- الأصناف المختارة: كلُّ صنفٍ يعود بكمّيته هو (وليس بكمّية الطلب).
  IF v_d.variants IS NOT NULL AND jsonb_typeof(v_d.variants) = 'array'
     AND v_b.selected_options IS NOT NULL AND jsonb_typeof(v_b.selected_options) = 'array' THEN
    SELECT jsonb_agg(jsonb_build_object('id', e->>'id', 'onHand',
             GREATEST(0, COALESCE(NULLIF(e->>'onHand','')::int, 0) + COALESCE(pick.q, 0))))
      INTO v_variants
      FROM jsonb_array_elements(v_d.variants) e
      JOIN LATERAL (
        SELECT sum(GREATEST(COALESCE((s->>'qty')::int, 1), 1))::int AS q
          FROM jsonb_array_elements(v_b.selected_options) s
         WHERE s->>'g' = '__variant__' AND s->>'c' = e->>'id') pick ON pick.q IS NOT NULL
     WHERE (e ? 'onHand');
  END IF;

  -- الفرع: كمّيةُ الطلب، وأصنافُه داخله بكمّياتها.
  IF v_b.location_id IS NOT NULL AND v_d.loc_qty_mode = 'per_location'
     AND v_d.locations IS NOT NULL AND jsonb_typeof(v_d.locations) = 'array' THEN
    SELECT jsonb_agg(jsonb_build_object(
             'id', e->>'id',
             'onHand', GREATEST(0, COALESCE(NULLIF(e->>'onHand','')::int, 0) + v_n),
             'variantOnHand', COALESCE((
                SELECT jsonb_object_agg(vo.key,
                         GREATEST(0, COALESCE(NULLIF(vo.value #>> '{}','')::int, 0)
                                   + COALESCE((SELECT sum(GREATEST(COALESCE((s->>'qty')::int,1),1))::int
                                                 FROM jsonb_array_elements(v_b.selected_options) s
                                                WHERE s->>'g' = '__variant__' AND s->>'c' = vo.key), 0)))
                  FROM jsonb_each(e->'variantOnHand') vo), '{}'::jsonb)))
      INTO v_locs
      FROM jsonb_array_elements(v_d.locations) e
     WHERE e->>'id' = v_b.location_id AND (e ? 'onHand');
  END IF;

  v_res := public.taki_set_on_hand(v_b.deal_id, v_d.on_hand + v_n, v_variants, v_locs, NULL, p_reason);
  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SET_FAILED', 'detail', v_res);
  END IF;

  UPDATE public.bookings SET restocked_qty = COALESCE(restocked_qty, 0) + v_n WHERE barcode = p_barcode;

  RETURN jsonb_build_object('ok', true, 'restocked', v_n,
                            'restocked_qty', COALESCE(v_b.restocked_qty, 0) + v_n,
                            'on_hand', v_res->'on_hand', 'available', v_res->'available');
END
$fn$;

REVOKE ALL ON FUNCTION public.taki_restock_booking(text, int, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_restock_booking(text, int, text) FROM anon;
REVOKE ALL ON FUNCTION public.taki_restock_booking(text, int, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_restock_booking(text, int, text) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) علامةُ الملاحظة للخارج وحده — لا لحركاتنا الداخلية
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 العيب، مقيساً: `tr_on_hand_on_sale` كان يكتب `stock_observed_at = now()`
--    عند كل بيع. فنظامُ التاجر الذي يستطلع كلّ دقيقة ويدفع رقماً لحظتُه
--    أقدمُ من آخر بيعٍ تُرفض كتابتُه بـ`STALE_OBSERVATION` — **والردّ
--    `ok: true`**. أي أن نظامه يُسجّل نجاحاً ولا يصل شيء.
--    والعلامةُ معناها «آخر مرّةٍ نظرنا فيها إلى رفّ التاجر»، والبيعُ عندنا
--    ليس نظراً إلى رفّه. فتبقى كما هي.
--
-- 🪤 و`p_observed_at = NULL` صار يعني «حركةٌ داخلية» لا «الآن»:
--    `taki_set_on_hand(..., NULL, 'refund')` لا تُقدّم العلامة، بينما
--    `merchant_set_stock` تمرّر `now()` صراحةً لأنها إعلانُ تاجرٍ حقيقيّ.
DO $patch_watermark$
DECLARE src text; src0 text;
BEGIN
  -- (أ) البيع لا يُقدّم العلامة
  src := pg_get_functiondef('public.tr_on_hand_on_sale()'::regprocedure);
  src0 := src;
  src := replace(src,
    E'         stock_observed_at = now(), stock_source = ''sale''',
    E'         stock_source = ''sale''   -- v15.06: العلامةُ للملاحظات الخارجية وحدها');
  IF src = src0 THEN RAISE EXCEPTION '❌ مرساة علامة البيع غير موجودة — أوقِفت.'; END IF;
  EXECUTE src;
  IF position('stock_observed_at = now()' IN pg_get_functiondef('public.tr_on_hand_on_sale()'::regprocedure)) > 0 THEN
    RAISE EXCEPTION '❌ البيع ما زال يُقدّم العلامة.';
  END IF;

  -- (ب) و`taki_set_on_hand` تُقدّمها فقط حين تُعطى لحظةً صراحةً
  src := pg_get_functiondef('public.taki_set_on_hand(text,integer,jsonb,jsonb,timestamptz,text)'::regprocedure);
  src0 := src;
  IF position('UPDATE public.deals SET stock_observed_at = v_at, stock_source = p_source' IN src) = 0 THEN
    RAISE EXCEPTION '❌ مرساة كتابة العلامة غير موجودة — أوقِفت.';
  END IF;
  src := replace(src,
    'UPDATE public.deals SET stock_observed_at = v_at, stock_source = p_source',
    'UPDATE public.deals SET stock_observed_at = CASE WHEN p_observed_at IS NULL THEN stock_observed_at ELSE v_at END, stock_source = p_source');
  IF src = src0 THEN RAISE EXCEPTION '❌ رقعة العلامة لم تقع.'; END IF;
  EXECUTE src;
  IF position('WHEN p_observed_at IS NULL THEN stock_observed_at' IN
       pg_get_functiondef('public.taki_set_on_hand(text,integer,jsonb,jsonb,timestamptz,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ رقعة العلامة لم تُنفَّذ.';
  END IF;
  RAISE NOTICE '✅ العلامة صارت للملاحظات الخارجية وحدها.';
END
$patch_watermark$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) بابا التسوية — كلاهما، وبرقعةٍ من النصّ الحيّ
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 الرسالةُ تتغيّر مع السلوك في نفس النداء: نصٌّ يقول «البضاعة خرجت فعلاً»
--    بعد أن صارت تعود **كذبٌ للتاجر**، وهو أسوأ من صمت.
DO $patch_refund$
DECLARE sig text; src text; src0 text; v_hits int := 0;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.resolve_booking_refund(text,text,text,numeric,text,text)',
    'public.taki_settle_booking_refund(text,boolean,text,text)'
  ] LOOP
    src := pg_get_functiondef(sig::regprocedure);
    src0 := src;

    IF position('taki_restock_booking' IN src) > 0 THEN
      RAISE NOTICE 'ℹ️ % مرقوعةٌ أصلاً.', sig; CONTINUE;
    END IF;

    -- (أ) فرعُ الإرجاع بعد فرع الإلغاء القائم
    IF src ~ 'IF v_b\.status IN \(''pending'', ?''acknowledged''\) THEN' THEN
      src := regexp_replace(src,
        '(IF v_b\.status IN \(''pending'', ?''acknowledged''\) THEN\s*\n\s*UPDATE public\.bookings SET status = ''cancelled'', cancelled_by = ''refund''\s*\n?\s*WHERE barcode = v_b\.barcode;)',
        E'\\1\n'
        '  -- v15.06 (طلب ناصر): والمكتملُ تعود بضاعته كذلك — ما لم يُطفئه التاجر.\n'
        '  -- 🪤 ولا يُنقل إلى «ملغى»: guard_booking_status يُعيد الحالة صامتاً،\n'
        '  --    والفاتورة الضريبية المجمّدة تتّكئ على نهائيّتها. الإرجاعُ حدثٌ مستقلّ.\n'
        '  ELSIF v_b.status = ''completed''\n'
        '        AND COALESCE((SELECT sp.refund_restocks FROM public.store_profiles sp\n'
        '                       WHERE sp.store_id = v_b.store_id), true) THEN\n'
        '    PERFORM public.taki_restock_booking(v_b.barcode, NULL, ''refund'');');
    ELSE
      RAISE EXCEPTION '❌ مرساة فرع الإلغاء غير موجودة في % — أوقِفت.', sig;
    END IF;

    -- (ب) والرسالة تُصدُق
    src := replace(src,
      'فلم تعد كمّيته للبيع — البضاعة خرجت فعلاً.',
      'وعادت كمّيته إلى مخزونك تلقائياً. تُطفئ ذلك من سياسات متجرك متى شئت.');
    src := replace(src,
      'والطلب مُغلق أصلاً فلم تعد كمّيته للبيع — البضاعة خرجت فعلاً.',
      'والطلب مُغلق أصلاً، وعادت كمّيته إلى مخزونك تلقائياً.');
    -- 🔴 والتعليقُ القديم يشرح قاعدة v14.21 التي بُدِّلت للتوّ. تعليقٌ يقول
    --    عكسَ ما يفعله الكود أخطرُ من غيابه: القارئُ التالي يصدّقه.
    src := replace(src,
      '-- نفس قاعدة v14.21 حرفياً: الطلبُ المفتوح يُلغى وتعود كمّيته، والمكتملُ لا —',
      '-- v15.06 (طلب ناصر) بدّلت قاعدة v14.21: المفتوحُ يُلغى وتعود كمّيته،');
    src := replace(src,
      '-- البضاعة خرجت فعلاً، فلا نَعِد التاجر بما لن يحدث.',
      '-- والمكتملُ تعود بضاعته بـtaki_restock_booking ما لم يُطفئه التاجر.');
    src := replace(src,
      '-- الإلغاء وإعادة الكمّية لطلبٍ لم يُستلم بعد. أمّا طلبٌ اكتمل فالبضاعة خرجت',
      '-- الإلغاء وإعادة الكمّية لطلبٍ لم يُستلم بعد. والمكتملُ تعود بضاعته أيضاً');
    src := replace(src,
      '-- فعلاً: يبقى مكتملاً ولا تعود كمّيته، والرسالة أدناه تقول ذلك بصدق.',
      '-- منذ v15.06: يبقى مكتملاً (الفاتورة مجمّدة) وتعود الكمّية حدثاً مستقلّاً.');

    IF src = src0 THEN RAISE EXCEPTION '❌ لم تقع أيُّ رقعة على % .', sig; END IF;
    EXECUTE src;

    IF position('taki_restock_booking' IN pg_get_functiondef(sig::regprocedure)) = 0 THEN
      RAISE EXCEPTION '❌ % ما زالت بلا نداء الإرجاع بعد التنفيذ.', sig;
    END IF;
    -- 🪤 يُفحص النصّ **بتعليقاته** هنا عمداً: تعليقٌ يقول إن البضاعة لا تعود
    --    بعد أن صارت تعود يُضلّل القارئ التالي كما تُضلّل الرسالةُ التاجر.
    IF position('البضاعة خرجت فعلاً' IN pg_get_functiondef(sig::regprocedure)) > 0 THEN
      RAISE EXCEPTION '❌ % ما زال فيها «البضاعة خرجت فعلاً» (رسالةً أو تعليقاً) — وكلاهما صار كذباً.', sig;
    END IF;
    v_hits := v_hits + 1;
    RAISE NOTICE '✅ % — الإرجاع والرسالة.', sig;
  END LOOP;

  IF v_hits = 0 THEN RAISE NOTICE 'ℹ️ لا رقعة (كلاهما مرقوعٌ سلفاً).'; END IF;
END
$patch_refund$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) بابُ التاجر لإطفائه
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.merchant_set_refund_restock(boolean);
CREATE FUNCTION public.merchant_set_refund_restock(p_on boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_me text := NULLIF((SELECT auth.uid())::text, '');
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  INSERT INTO public.store_profiles (store_id, refund_restocks) VALUES (v_me, COALESCE(p_on, true))
  ON CONFLICT (store_id) DO UPDATE SET refund_restocks = COALESCE(p_on, true);
  RETURN jsonb_build_object('ok', true, 'refund_restocks', COALESCE(p_on, true));
END
$fn$;

REVOKE ALL ON FUNCTION public.merchant_set_refund_restock(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_set_refund_restock(boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_set_refund_restock(boolean) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٦) تحقّقٌ يرفع استثناءً
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 والسلوكيُّ الكامل (بيعٌ ثمّ استردادٌ على المحاور الأربعة) في
--    `supabase/proof_v15_06_refund_restock.sql` داخل معاملةٍ تُلغى.
DO $verify$
DECLARE src text; n int;
BEGIN
  -- (أ) البنية
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='bookings' AND column_name='restocked_qty') THEN
    RAISE EXCEPTION '❌ bookings.restocked_qty غائب — الإرجاع بلا سجلّ فيتكرّر.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='store_profiles' AND column_name='refund_restocks') THEN
    RAISE EXCEPTION '❌ مفتاح التاجر غائب.';
  END IF;
  IF to_regprocedure('public.taki_restock_booking(text,integer,text)') IS NULL
     OR to_regprocedure('public.merchant_set_refund_restock(boolean)') IS NULL THEN
    RAISE EXCEPTION '❌ إحدى الدالّتين لم تُنشأ.';
  END IF;

  -- (ب) الصلاحيات: الإرجاع بابٌ داخليّ لا يُفتح لموثَّقٍ ولا لزائر
  IF has_function_privilege('anon', 'public.taki_restock_booking(text,integer,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.taki_restock_booking(text,integer,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ بابُ الإرجاع مفتوح — أيُّ مستخدمٍ يزيد مخزون أيّ تاجر.';
  END IF;
  IF has_function_privilege('anon', 'public.merchant_set_refund_restock(boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ الزائر يغيّر سياسة متجر.';
  END IF;

  -- (ج) البابان كلاهما يُناديان الإرجاع، ولا يقول أحدهما إن البضاعة لا تعود
  FOR n IN 1..1 LOOP NULL; END LOOP;
  IF position('taki_restock_booking' IN pg_get_functiondef('public.resolve_booking_refund(text,text,text,numeric,text,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ بابُ قرار التاجر لا يُعيد البضاعة.';
  END IF;
  IF position('taki_restock_booking' IN pg_get_functiondef('public.taki_settle_booking_refund(text,boolean,text,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ بابُ تسوية البوّابة لا يُعيد البضاعة — وهو الذي يعمل في الردّ الفوريّ.';
  END IF;
  IF position('البضاعة خرجت فعلاً' IN pg_get_functiondef('public.resolve_booking_refund(text,text,text,numeric,text,text)'::regprocedure)) > 0
     OR position('البضاعة خرجت فعلاً' IN pg_get_functiondef('public.taki_settle_booking_refund(text,boolean,text,text)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION '❌ الرسالةُ ما زالت تقول إن البضاعة لا تعود — كذبٌ للتاجر.';
  END IF;

  -- (د) 🔴 ولم يُفتح حارسُ الحالة، ولم يُكتب cancelled_by على مكتمل
  src := regexp_replace(pg_get_functiondef('public.guard_booking_status()'::regprocedure), '--[^\n]*', '', 'g');
  IF position('NEW.status := OLD.status' IN src) = 0 THEN
    RAISE EXCEPTION '❌ حارسُ الحالة فقد منعَه — الفاتورة الضريبية المجمّدة تتّكئ عليه.';
  END IF;
  FOR n IN 1..1 LOOP NULL; END LOOP;
  IF (SELECT count(*) FROM public.bookings
       WHERE status = 'completed' AND cancelled_by IS NOT NULL) > 0 THEN
    RAISE EXCEPTION '❌ صفوفٌ تقول «مكتمل» و«ملغى» معاً.';
  END IF;

  -- (هـ) البيعُ لم يعد يُقدّم علامة الملاحظة
  IF position('stock_observed_at = now()' IN
       regexp_replace(pg_get_functiondef('public.tr_on_hand_on_sale()'::regprocedure), '--[^\n]*', '', 'g')) > 0 THEN
    RAISE EXCEPTION '❌ البيعُ ما زال يُقدّم العلامة — دفعةُ نظام التاجر ستُبتلع بـok:true.';
  END IF;

  -- (و) والإرجاع يمرّ من الكاتب المُعلَن لا بجمعٍ يدويّ
  src := regexp_replace(pg_get_functiondef('public.taki_restock_booking(text,integer,text)'::regprocedure), '--[^\n]*', '', 'g');
  IF position('taki_set_on_hand' IN src) = 0 THEN
    RAISE EXCEPTION '❌ الإرجاع لا يمرّ من taki_set_on_hand — المرايا المتاحة لن تُعاد اشتقاقها.';
  END IF;
  IF position('FOR UPDATE' IN src) = 0 THEN
    RAISE EXCEPTION '❌ الإرجاع بلا قفل — نداءان يقرآن نفس الرقم.';
  END IF;
  IF position('restocked_qty' IN src) = 0 THEN
    RAISE EXCEPTION '❌ الإرجاع بلا سجلّ — نقرتان تُضاعفان البضاعة.';
  END IF;

  -- (ز) والمعادلة سليمة
  SELECT count(*) INTO n FROM public.deals d
   WHERE d.on_hand IS NOT NULL
     AND COALESCE(d.quantity,-1) <> GREATEST(0, d.on_hand - public.taki_open_holds(d.id,NULL,NULL));
  IF n > 0 THEN RAISE EXCEPTION '❌ % عرضاً خرج عن المعادلة.', n; END IF;

  RAISE NOTICE '✅ v15.06: الاستردادُ يُعيد البضاعة في البابين · خاملَ التكرار · بقفل · والرسالةُ تصدُق · وحارسُ الحالة لم يُمسّ.';
END
$verify$;
