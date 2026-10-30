-- ═══════════════════════════════════════════════════════════════════════════
-- v15.33 — طريقةُ الحساب: مصدرُ حقيقةٍ واحد (الإقرارُ يَجُبّ إعدادَ التوصيل)
-- ═══════════════════════════════════════════════════════════════════════════
-- سؤالُ ناصر: «خانتان لطريقة الحساب — ولماذا؟ وهل تكتبان نفس الحقل؟»
--
-- الجواب المقيس: **ثلاثُ شاشاتٍ لا اثنتان**، وتكتب كلٌّ منها عموداً مختلفاً:
--   ١) «طريقة الحساب» (PaymentDeclarationCard) ⇒ store_profiles.accepts_cod
--      — إقرارُ المتجر كلِّه، وهو **بوّابةُ كلّ حجزٍ** (استلاماً وتوصيلاً):
--      `store_can_sell` ترفض بـnot_declared ما لم يُختم `payment_declared_at`.
--   ٢) «طرق الدفع المتاحة لعملائك» (GatewayCard) ⇒ merchant_gateways.payment_modes
--   ٣) «خدمة التوصيل» (DeliveryCard) ⇒ store_profiles.delivery_payment
--
-- فهي ليست كاتبين لحقلٍ واحد — لكنّ (١) و(٣) **يتناقضان**، والتناقضُ يَقتل
-- التوصيل. و(٣) افتراضُه «نقداً» و(١) يمكن أن يكون «بطاقة فقط» ⇒
--   • `tr_guard_booking_delivery` يرفض النقدَ (TAKI_STORE_CARD_ONLY)،
--   • و`DealDetails.tsx` تفرض `paymentIntent='cod'` من حقل التوصيل ثمّ
--     تقول «اختر الدفع الإلكتروني» — **ولا زرّ للمشتري يختاره**.
--   ⇒ طريقٌ مسدود: متجرٌ «بطاقة فقط» بتوصيلٍ نقديّ لا يستقبل طلبَ توصيلٍ أبداً.
-- 🟢 ولم يقع بعد: لا متجرَ حيٌّ أقرّ «بطاقة فقط» اليوم (تلزمه بوّابةٌ مفعّلة).
--    فهذا سدُّ عيبٍ كامن قبل أوّل تاجرٍ يبلغه، لا إصلاحُ عطلٍ قائم.
--
-- العلاج — ثلاث طبقات، وكلُّها تقول الشيء نفسه:
--   أ) القراءة: `delivery_quote` تشتقّ طريقةَ الدفع ⇒ تصحّ الصفوفُ القائمة فوراً.
--   ب) الكتابة: `merchant_set_delivery` ترفض نقداً لمتجرٍ أقرّ «بطاقة فقط».
--   ج) والإقرارُ يسحب التوصيلَ معه في النداء نفسه، فلا يبقى صفٌّ متناقض.
--
-- 🪤 ولا تُمسّ `store_can_sell` ولا بطاقةُ الإقرار: هي بوّابةُ **كلّ** حجزٍ لا
--    إعدادُ توصيل. نقلُها إلى «إدارة التوصيل» يُخفيها عن كلّ متجرٍ لا يوصّل،
--    فيعود `not_declared` وتُقفل حجوزاتُه كلُّها (درس v14.08).
-- 🪤 وبُنيت من **النصّ الحيّ** على جدّة لا من المستودع.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='store_profiles' AND column_name='accepts_cod') THEN
    RAISE EXCEPTION 'v14.08 غير مطبَّقة (لا عمود accepts_cod) — أوقِفت.';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.delivery_quote(p_store_id text, p_lat double precision, p_lng double precision, p_location_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  sp   public.store_profiles%ROWTYPE;
  z    public.store_delivery_zones%ROWTYPE;
  -- عرضٌ بلا فرع محدّد = الموقع الأساسي للمتجر. بدون هذه المساواة يسقط كل عرضٍ
  -- ذي موقع واحد (location_id فارغ) خارج نطاقاته المرسومة على 'primary' فلا
  -- يظهر له توصيل أبداً — وهي الحالة الأشيع: متجرٌ بفروع، وعرضٌ في المحل الرئيس.
  v_loc text := coalesce(nullif(btrim(coalesce(p_location_id, '')), ''), 'primary');
  v_zone_count int;
  v_pay text;
BEGIN
  -- v14.39 — مفتاح الإيقاف العام. هذه الدالة هي المختنق الذي تمرّ به كل
  -- المسارات (الموقع والبوتان وحارس الحجز)، فالفحص هنا يُغطّيها جميعاً.
  IF NOT public.taki_delivery_globally_on() THEN
    RETURN jsonb_build_object('enabled', false, 'available', false, 'reason', 'platform_off');
  END IF;

  SELECT * INTO sp FROM public.store_profiles WHERE store_id = p_store_id;
  IF NOT FOUND OR NOT coalesce(sp.delivery_enabled, false) THEN
    RETURN jsonb_build_object('enabled', false, 'available', false, 'reason', 'disabled');
  END IF;
  -- إيقافٌ إداريّ على هذا المتجر بعينه — عمودٌ لا يملكه التاجر فلا يرفعه بضغطة.
  IF coalesce(sp.delivery_blocked_by_admin, false) THEN
    RETURN jsonb_build_object('enabled', false, 'available', false, 'reason', 'admin_blocked');
  END IF;

  -- ── v15.33 · الإقرارُ يحكم ────────────────────────────────────────────
  -- `accepts_cod` إقرارُ المتجر كلِّه (بوّابةُ كلّ حجز)، وعمودُ التوصيل
  -- إعدادُ التوصيل وحده — عمودان في جدولٍ واحد لا يسأل أحدُهما الآخر.
  -- 🔴 وافتراضُ الثاني «نقداً»، فمتجرٌ أقرّ «بطاقة فقط» ثمّ فعّل التوصيل
  --    كان يُعلن نقداً عند الباب. والمشغّل `tr_guard_booking_delivery`
  --    يرفض ذلك النقدَ بـTAKI_STORE_CARD_ONLY، و`DealDetails` تفرض
  --    `paymentIntent='cod'` من هذا الحقل ثمّ تقول «اختر الدفع الإلكتروني»
  --    — **والمشتري لا يملك اختياره**. طريقٌ مسدود، لا تسريبُ نقد.
  -- ⇒ مصدرُ الحقيقة واحد: الإقرارُ يَجُبّ إعدادَ التوصيل عند التعارض.
  v_pay := CASE WHEN NOT coalesce(sp.accepts_cod, true) THEN 'card' ELSE sp.delivery_payment END;

  -- النطاقات التي تحكم هذا الحجز: نطاقات الفرع المختار + النطاقات العامة
  -- (branch_id IS NULL) التي رُسمت قبل ربط النطاق بالفرع أو لمتجر بموقع واحد.
  SELECT count(*) INTO v_zone_count
    FROM public.store_delivery_zones dz
   WHERE dz.store_id = p_store_id AND dz.is_active
     AND (dz.branch_id IS NULL OR (v_loc IS NOT NULL AND dz.branch_id = v_loc));

  IF v_zone_count = 0 THEN
    RETURN jsonb_build_object('enabled', true, 'available', false, 'reason', 'no_zones',
      'payment', v_pay, 'min_order', sp.delivery_min_order,
      'eta_min', sp.delivery_eta_min, 'note', sp.delivery_note);
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RETURN jsonb_build_object('enabled', true, 'available', false, 'reason', 'no_location',
      'payment', v_pay, 'min_order', sp.delivery_min_order,
      'eta_min', sp.delivery_eta_min, 'note', sp.delivery_note);
  END IF;

  SELECT * INTO z FROM public.store_delivery_zones dz
   WHERE dz.store_id = p_store_id AND dz.is_active
     AND (dz.branch_id IS NULL OR (v_loc IS NOT NULL AND dz.branch_id = v_loc))
     AND public._taki_zone_contains(dz, p_lat, p_lng)
   ORDER BY coalesce(dz.fee, sp.delivery_fee) ASC, dz.created_at ASC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('enabled', true, 'available', false, 'reason', 'out_of_zone',
      'payment', v_pay, 'min_order', sp.delivery_min_order,
      'eta_min', sp.delivery_eta_min, 'note', sp.delivery_note);
  END IF;

  RETURN jsonb_build_object(
    'enabled',   true,
    'available', true,
    'zone_id',   z.id,
    'zone_name', z.name,
    'branch_id', z.branch_id,
    'fee',       round(coalesce(z.fee, sp.delivery_fee), 2),
    'min_order', sp.delivery_min_order,
    'payment',   v_pay,
    'eta_min',   sp.delivery_eta_min,
    'note',      sp.delivery_note);
END
$function$;

CREATE OR REPLACE FUNCTION public.merchant_set_delivery(p_enabled boolean, p_payment text, p_fee numeric, p_min_order numeric, p_eta_min integer, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid text := auth.uid()::text; v_type text; v_shop text; v_mode text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT user_type, shop INTO v_type, v_shop FROM public.users WHERE id = v_uid AND deleted_at IS NULL;
  IF v_type IS NULL OR (v_type NOT IN ('seller','admin') AND nullif(btrim(coalesce(v_shop,'')),'') IS NULL) THEN
    RAISE EXCEPTION 'SELLER_ONLY';
  END IF;
  IF p_payment IS NULL OR p_payment NOT IN ('cod','card','both') THEN RAISE EXCEPTION 'BAD_MODE'; END IF;
  -- v15.33 — ولا يُحفظ التعارضُ أصلاً: متجرٌ أقرّ «بطاقة فقط» لا يختار نقداً
  -- للتوصيل. والرفضُ هنا أصدقُ من قبولٍ تُبطله القراءة بصمت.
  IF p_payment IN ('cod','both')
     AND NOT coalesce((SELECT sp2.accepts_cod FROM public.store_profiles sp2 WHERE sp2.store_id = v_uid), true) THEN
    RAISE EXCEPTION 'COD_VS_CARD_ONLY';
  END IF;
  IF coalesce(p_fee, 0) < 0 OR coalesce(p_fee, 0) > 1000 THEN RAISE EXCEPTION 'BAD_FEE'; END IF;
  IF coalesce(p_min_order, 0) < 0 OR coalesce(p_min_order, 0) > 100000 THEN RAISE EXCEPTION 'BAD_MIN'; END IF;
  IF p_eta_min IS NOT NULL AND p_eta_min NOT BETWEEN 0 AND 1440 THEN RAISE EXCEPTION 'BAD_ETA'; END IF;
  IF coalesce(p_enabled, false) AND p_payment IN ('card','both') THEN
    v_mode := public.deal_payment_mode(v_uid);
    IF v_mode NOT IN ('online','both') THEN RAISE EXCEPTION 'GATEWAY_REQUIRED'; END IF;
  END IF;

  INSERT INTO public.store_profiles (store_id, delivery_enabled, delivery_payment, delivery_fee, delivery_min_order, delivery_eta_min, delivery_note)
  VALUES (v_uid, coalesce(p_enabled,false), p_payment, round(coalesce(p_fee,0),2), round(coalesce(p_min_order,0),2), p_eta_min, nullif(left(btrim(coalesce(p_note,'')),300),''))
  ON CONFLICT (store_id) DO UPDATE SET
    delivery_enabled   = EXCLUDED.delivery_enabled,
    delivery_payment   = EXCLUDED.delivery_payment,
    delivery_fee       = EXCLUDED.delivery_fee,
    delivery_min_order = EXCLUDED.delivery_min_order,
    delivery_eta_min   = EXCLUDED.delivery_eta_min,
    delivery_note      = EXCLUDED.delivery_note,
    updated_at         = now();

  RETURN (SELECT jsonb_build_object(
    'delivery_enabled', sp.delivery_enabled, 'delivery_payment', sp.delivery_payment,
    'delivery_fee', sp.delivery_fee, 'delivery_min_order', sp.delivery_min_order,
    'delivery_eta_min', sp.delivery_eta_min, 'delivery_note', sp.delivery_note,
    'zones', (SELECT count(*) FROM public.store_delivery_zones z WHERE z.store_id = v_uid AND z.is_active))
    FROM public.store_profiles sp WHERE sp.store_id = v_uid);
END
$function$;

CREATE OR REPLACE FUNCTION public.merchant_set_payment_declaration(p_accepts_cod boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid text := auth.uid()::text; v_type text; v_shop text; v_mode text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT user_type, shop INTO v_type, v_shop FROM public.users WHERE id = v_uid AND deleted_at IS NULL;
  IF v_type IS NULL OR (v_type NOT IN ('seller','admin') AND nullif(btrim(coalesce(v_shop,'')),'') IS NULL) THEN
    RAISE EXCEPTION 'SELLER_ONLY';
  END IF;
  v_mode := public.deal_payment_mode(v_uid);
  -- رفض النقد بلا بوابة يعني متجراً لا يستطيع تحصيل ريال واحد — نمنعه بدل أن
  -- نتركه يكتشف ذلك من مشترٍ لا يستطيع الحجز.
  IF NOT coalesce(p_accepts_cod, true) AND v_mode NOT IN ('online','both') THEN
    RAISE EXCEPTION 'NEED_GATEWAY_OR_COD';
  END IF;

  INSERT INTO public.store_profiles (store_id, accepts_cod, payment_declared_at)
  VALUES (v_uid, coalesce(p_accepts_cod, true), now())
  ON CONFLICT (store_id) DO UPDATE SET
    accepts_cod = EXCLUDED.accepts_cod,
    payment_declared_at = now(),
    updated_at = now();

  -- v15.33 — إقرارُ «بطاقة فقط» يسحب التوصيلَ النقديّ معه في النداء نفسه،
  -- فلا يبقى في الجدول صفٌّ متناقض يحتاج من يتذكّره.
  IF NOT coalesce(p_accepts_cod, true) THEN
    UPDATE public.store_profiles SET delivery_payment = 'card', updated_at = now()
     WHERE store_id = v_uid AND delivery_payment IS DISTINCT FROM 'card';
  END IF;

  RETURN public.store_can_sell(v_uid);
END
$function$;

-- ── تحقّقٌ سلوكيّ يُفشل الهجرة إن كذبت ──────────────────────────────────────
-- 🪤 داخل معاملةٍ تُلغى: نُبدّل إعدادات متجرٍ حقيقيّ ثمّ نُعيدها بـROLLBACK.
-- 🪤 ولا يُقبل «أيُّ استثناء» دليلاً — يُشترط الرمزُ بعينه (COD_VS_CARD_ONLY).
--    وحارسُ الصلاحية يسبق كلَّ تحقّقٍ داخليّ، فجلسةُ psql بلا auth.uid() تُردّ
--    عند الباب ولا تبلغ ما نفحصه ⇒ ننتحل هويّةَ التاجر نفسه بمطالبات JWT.
BEGIN;
DO $test$
DECLARE v_sid text; r jsonb; v_err text; v_sqlstate text; v_dp text; v_passed boolean;
BEGIN
  SELECT sp.store_id INTO v_sid FROM public.store_profiles sp
   JOIN public.users u ON u.id = sp.store_id AND u.deleted_at IS NULL LIMIT 1;
  IF v_sid IS NULL THEN RAISE EXCEPTION '❌ لا متجرَ للاختبار — الفحصُ لم يُجرَ (وهذا فشلٌ لا نجاح)'; END IF;

  -- (أ) حالةٌ موجبة: متجرٌ يقبل النقد ⇒ إعدادُ التوصيل يمرّ كما هو.
  UPDATE public.store_profiles SET accepts_cod = true, delivery_enabled = true, delivery_payment = 'cod'
   WHERE store_id = v_sid;
  r := public.delivery_quote(v_sid, NULL, NULL, NULL);
  IF (r->>'payment') IS DISTINCT FROM 'cod' THEN
    RAISE EXCEPTION '❌ المسارُ السليم أُقفل: متجرٌ يقبل النقد أعاد payment=%', coalesce(r->>'payment','(غائب)');
  END IF;

  -- (ب) الإقرارُ يحكم: «بطاقة فقط» ⇒ القراءةُ تقول card رغم أن العمود cod.
  UPDATE public.store_profiles SET accepts_cod = false WHERE store_id = v_sid;
  r := public.delivery_quote(v_sid, NULL, NULL, NULL);
  IF (r->>'payment') IS DISTINCT FROM 'card' THEN
    RAISE EXCEPTION '❌ الاشتقاقُ لا يعمل: «بطاقة فقط» أعاد payment=%', coalesce(r->>'payment','(غائب)');
  END IF;

  -- (ج) الكتابةُ تُرفض بالرمز بعينه — بانتحال هويّة التاجر.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sid, 'role', 'authenticated')::text, true);
  v_passed := false;
  BEGIN
    PERFORM public.merchant_set_delivery(true, 'cod', 0, 0, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
    v_passed := position('COD_VS_CARD_ONLY' IN v_err) > 0;
    IF NOT v_passed THEN RAISE EXCEPTION '❌ سقط لسببٍ آخر لا للحارس: % (%)', v_err, v_sqlstate; END IF;
  END;
  IF NOT v_passed THEN RAISE EXCEPTION '❌ الحارسُ لم يمنع: حُفظ نقدٌ لمتجرٍ أقرّ «بطاقة فقط»'; END IF;

  -- (د) والإقرارُ يسحب التوصيلَ معه.
  UPDATE public.store_profiles SET accepts_cod = true, delivery_payment = 'cod' WHERE store_id = v_sid;
  PERFORM public.merchant_set_payment_declaration(false);
  SELECT delivery_payment INTO v_dp FROM public.store_profiles WHERE store_id = v_sid;
  IF v_dp IS DISTINCT FROM 'card' THEN
    RAISE EXCEPTION '❌ الإقرارُ لم يسحب التوصيل (delivery_payment=%)', coalesce(v_dp,'(null)');
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE '✅ مُثبَت على متجرٍ حقيقيّ: نقدٌ يمرّ · «بطاقة فقط» تُشتقّ card · الكتابةُ تُرفض بـCOD_VS_CARD_ONLY · والإقرارُ يسحب التوصيل';
END
$test$;
ROLLBACK;

-- ── جدولُ القراءة ──────────────────────────────────────────────────────────
SELECT 'الخادم' AS البند, current_database() AS القيمة
UNION ALL SELECT 'المختبر؟', coalesce(obj_description('public'::regnamespace,'pg_namespace'),'لا — جدّة')
UNION ALL SELECT 'اشتقاق delivery_quote',
  CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='delivery_quote' AND p.prokind='f'
      AND position('accepts_cod' IN pg_get_functiondef(p.oid)) > 0) THEN '✅ مشحون' ELSE '❌ غائب' END
UNION ALL SELECT 'حارس merchant_set_delivery',
  CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='merchant_set_delivery' AND p.prokind='f'
      AND position('COD_VS_CARD_ONLY' IN pg_get_functiondef(p.oid)) > 0) THEN '✅ مشحون' ELSE '❌ غائب' END
UNION ALL SELECT 'سحبُ الإقرار',
  CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='merchant_set_payment_declaration' AND p.prokind='f'
      AND position('delivery_payment' IN pg_get_functiondef(p.oid)) > 0) THEN '✅ مشحون' ELSE '❌ غائب' END
UNION ALL SELECT 'صفوفٌ متناقضة الآن',
  (SELECT count(*)::text FROM public.store_profiles
    WHERE accepts_cod = false AND delivery_payment IS DISTINCT FROM 'card');
