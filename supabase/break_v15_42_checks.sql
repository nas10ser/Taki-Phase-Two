-- ═══════════════════════════════════════════════════════════════════════════
-- كسرُ حرّاس v15.42 — هل تفشل فعلاً، وللسبب المقصود؟
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 أهمُّ ما أثبته هذا الملفّ (كسرة ١): **الفحصُ النصّيّ وحده عاجز.** كسرةٌ
--    تُبقي `taki_self_close_minutes` و`P0028` مكتوبين وتُصفّر `v_left` قبلهما
--    تمرّ عليه كاملاً — والحارسُ ميّت. ولذلك أُضيف إلى الهجرة تحقّقٌ **سلوكيّ**
--    يصنع طلباً ويجرّبه، وهو الذي يُسقط تلك الكسرة. أي أن هذا الملفّ لم يُصدّق
--    الحارسَ بل كشف عجزَه فأُصلحت الهجرة.
-- 🪤 وكلُّ كسرةٍ تُثبَت **وقوعاً** قبل أن تُقرأ نتيجتُها: `replace` على نصٍّ
--    غائب لا يُخطئ ولا يكسر شيئاً (درس v14.84 · v15.22 · v15.40).
-- 🪤 ومنطقُ الفحصين منسوخٌ في `pg_temp` لأن إعادةَ تشغيل الهجرة تُصلح الكسرةَ
--    فتُبرّئ نفسَها. والنسختان **مستخرجتان من ملفّ الهجرة آلياً** (لا مكتوبتان
--    يدوياً) وتُشغَّلان على القاعدة السليمة أوّلاً — فلا تنحرفان ولا تكذبان.
-- 🪤 وعلامةُ فشلِ **الهيكل** `BTBUG` منفصلةٌ عن علامة فشل **الفحص** (❌):
--    خلطتُهما أوّلاً فصار الهيكلُ يُعيد رفعَ نجاحِ الفحص فيبدو الفحصُ عاجزاً
--    وهو سليم — أي أن اختبارَ الاختبار كان يكذب في الاتجاه المعاكس.
-- وكلُّ كسرةٍ في معاملةٍ تُرجَع: صفرُ أثرٍ على الإنتاج.
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

CREATE FUNCTION pg_temp.v42_check() RETURNS void LANGUAGE plpgsql AS $chk$
DECLARE
  nude  text := '--[^' || chr(10) || ']*';
  src_w text; src_b text; src_m text; src_c text; v_min numeric;
BEGIN
  src_w := regexp_replace(pg_get_functiondef('public.buyer_confirm_receipt(text)'::regprocedure), nude, '', 'g');
  src_b := regexp_replace(pg_get_functiondef('public.bot_buyer_confirm_receipt(bigint,text,text)'::regprocedure), nude, '', 'g');
  src_m := regexp_replace(pg_get_functiondef('public.merchant_handover_booking(text)'::regprocedure), nude, '', 'g');
  src_c := regexp_replace(pg_get_functiondef('public.complete_booking(text)'::regprocedure), nude, '', 'g');
  v_min := public.taki_self_close_minutes();
  IF v_min IS NULL OR v_min <= 0 THEN RAISE EXCEPTION 'CHK_A: المهلةُ صفر'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.platform_settings WHERE key='booking_holds' AND value ? 'self_close_minutes') THEN RAISE EXCEPTION 'CHK_A2: الحقلُ غائب'; END IF;
  IF position('taki_self_close_minutes' IN src_w)=0 OR position('P0028' IN src_w)=0 THEN RAISE EXCEPTION 'CHK_B_WEB: المهلةُ غائبةٌ عن الموقع'; END IF;
  IF position('taki_self_close_minutes' IN src_b)=0 OR position('too_soon' IN src_b)=0 THEN RAISE EXCEPTION 'CHK_B_BOT: المهلةُ غائبةٌ عن البوتين'; END IF;
  IF position('taki_self_close_minutes' IN src_m)=0 OR position('P0028' IN src_m)=0 THEN RAISE EXCEPTION 'CHK_B_MER: المهلةُ غائبةٌ عن اختصار التاجر'; END IF;
  IF position('on_the_way' IN src_w)=0 OR position('on_the_way' IN src_b)=0 THEN RAISE EXCEPTION 'CHK_C: حارسُ المندوب سقط'; END IF;
  IF position('caller = user_id' IN src_c)>0 THEN RAISE EXCEPTION 'CHK_D: ثُلمةُ المشتري أُعيدت'; END IF;
  IF position('caller = store_id' IN src_c)=0 THEN RAISE EXCEPTION 'CHK_D2: صلاحيةُ التاجر سقطت'; END IF;
  IF position('store_id IS DISTINCT FROM v_uid' IN src_m)=0 THEN RAISE EXCEPTION 'CHK_E: الاختصارُ بلا تحقّقِ ملكيّة'; END IF;
  IF has_function_privilege('anon','public.merchant_handover_booking(text)','EXECUTE') THEN RAISE EXCEPTION 'CHK_F: الزائرُ يملك الاختصار'; END IF;
  IF NOT has_function_privilege('authenticated','public.merchant_handover_booking(text)','EXECUTE') THEN RAISE EXCEPTION 'CHK_F2: التاجرُ لا يملك الاختصار'; END IF;
END
$chk$;

-- ⬇️ مستخرجةٌ آلياً من كتلة `DO $behave$` في ملفّ الهجرة — لا منسوخةٌ يدوياً.
CREATE FUNCTION pg_temp.v42_behave() RETURNS void LANGUAGE plpgsql AS $bhv$
DECLARE
  v_deal  text; v_store text; v_buyer text;
  v_now   bigint := (EXTRACT(EPOCH FROM NOW())*1000)::bigint;
  v_bc    text;
  v_st    text; v_by text; v_det text;
BEGIN
  SELECT d.id, d.store_id INTO v_deal, v_store
    FROM public.deals d
   WHERE d.status = 'active' AND COALESCE(d.quantity,0) > 1
     AND COALESCE((public.store_can_sell(d.store_id)->>'ok')::boolean,false)
   ORDER BY d.quantity DESC LIMIT 1;
  IF v_deal IS NULL THEN
    RAISE EXCEPTION '❌ لا عرضَ صالحاً للاختبار السلوكيّ — لا يُعتمد فحصٌ نصّيٌّ وحده';
  END IF;

  SELECT u.id INTO v_buyer FROM public.users u
   WHERE u.id <> v_store AND u.deleted_at IS NULL ORDER BY u.created_at LIMIT 1;
  IF v_buyer IS NULL THEN
    RAISE EXCEPTION '❌ لا مشتريَ للاختبار السلوكيّ';
  END IF;

  v_bc := '98' || lpad(((random()*99999999)::bigint)::text, 8, '7');

  BEGIN
    -- طلبٌ لحظتُه الآن. 🪤 و`payment_method` لازمة: متجرٌ لا يقبل النقد يرفض
    -- الطلبَ عند الباب (`TAKI_STORE_CARD_ONLY`) فلا يبلغ ما نفحصه.
    INSERT INTO public.bookings (barcode, backup_code, deal_id, user_id, store_id,
                                 booked_quantity, status, booked_at, fulfillment, source, payment_method)
    VALUES (v_bc, v_bc, v_deal, v_buyer, v_store, 1, 'pending', v_now, 'pickup', 'web', 'card');

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_buyer, true);

    -- (ح١) المهلةُ تحجب فعلاً لحظةَ الحجز
    BEGIN
      PERFORM public.buyer_confirm_receipt(v_bc);
      RAISE EXCEPTION '❌ قُبل الختمُ الذاتيّ لحظةَ الحجز — الحارسُ ميّتٌ وإن كان رمزُه مكتوباً';
    EXCEPTION
      WHEN SQLSTATE 'P0028' THEN
        GET STACKED DIAGNOSTICS v_det = PG_EXCEPTION_DETAIL;
        IF COALESCE(v_det,'0')::integer <= 0 THEN
          RAISE EXCEPTION '❌ رُفض بـP0028 والمتبقّي % — الحسابُ مقلوب', v_det;
        END IF;
    END;

    SELECT status INTO v_st FROM public.bookings WHERE barcode = v_bc;
    IF v_st <> 'pending' THEN
      RAISE EXCEPTION '❌ الرفضُ كتب في الصفّ (status=%)', v_st;
    END IF;

    -- (ح٢) وتسمح فعلاً بعد مضيّها — وإلّا كان الحارسُ سدّاً دائماً
    PERFORM set_config('request.jwt.claims', NULL, true);
    PERFORM set_config('request.jwt.claim.sub', NULL, true);
    UPDATE public.bookings
       SET booked_at = v_now - ((public.taki_self_close_minutes() + 1) * 60000)::bigint
     WHERE barcode = v_bc;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_buyer, true);
    PERFORM public.buyer_confirm_receipt(v_bc);
    SELECT status, completed_by INTO v_st, v_by FROM public.bookings WHERE barcode = v_bc;
    IF v_st <> 'completed' OR v_by <> 'buyer' THEN
      RAISE EXCEPTION '❌ بعد المهلة لم يقع الختم (status=% · by=%)', v_st, v_by;
    END IF;

    -- (ح٣) الثُّلمة: المشتري لا يختم بنداءٍ مباشر
    -- 🪤 وعلى طلبٍ **ثانٍ** لا بإحياء الأوّل: `tr_guard_booking_status` يمنع
    --    إحياءَ المختوم (v14.29)، فالإحياءُ كان سيُسقط الهجرةَ لسببٍ آخر.
    PERFORM set_config('request.jwt.claims', NULL, true);
    PERFORM set_config('request.jwt.claim.sub', NULL, true);
    v_bc := '97' || lpad(((random()*99999999)::bigint)::text, 8, '7');
    INSERT INTO public.bookings (barcode, backup_code, deal_id, user_id, store_id,
                                 booked_quantity, status, booked_at, fulfillment, source, payment_method)
    VALUES (v_bc, v_bc, v_deal, v_buyer, v_store, 1, 'pending', v_now, 'pickup', 'web', 'card');
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_buyer, true);
    BEGIN
      PERFORM public.complete_booking(v_bc);
      RAISE EXCEPTION '❌ المشتري ختم طلبه عبر complete_booking — الثُّلمةُ قائمة';
    EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
    END;

    PERFORM set_config('request.jwt.claims', NULL, true);
    PERFORM set_config('request.jwt.claim.sub', NULL, true);
    RAISE EXCEPTION 'TAKI_V1542_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM set_config('request.jwt.claims', NULL, true);
      PERFORM set_config('request.jwt.claim.sub', NULL, true);
      IF SQLERRM <> 'TAKI_V1542_ROLLBACK' THEN RAISE; END IF;
  END;
END
$bhv$;

DO $t$ BEGIN
  PERFORM pg_temp.v42_check();
  PERFORM pg_temp.v42_behave();
  RAISE NOTICE '✅ ٠) النسختان تمرّان على القاعدة السليمة';
END $t$;

-- ═══ كسرة ١: الحارسُ مُعطَّلٌ ورمزُه مكتوب — الفحصُ النصّيّ أعمى عنها ══════
-- 🔴 هذه الكسرةُ هي سببُ وجود التحقّق السلوكيّ في الهجرة. تُثبَت هنا مرّتين:
--    أن الفحصَ النصّيّ **يمرّ** (وهذا عجزُه، موثَّقاً لا مخفيّاً)، وأن السلوكيّ
--    **يسقط**.
BEGIN;
DO $b$
DECLARE src text; broke text; text_passed boolean := false;
BEGIN
  src := pg_get_functiondef('public.buyer_confirm_receipt(text)'::regprocedure);
  broke := replace(src, 'v_left := ceil(', 'v_left := 0; PERFORM ceil(');
  IF broke = src THEN RAISE EXCEPTION 'BTBUG: الكسرةُ لم تُحقن — المرساةُ غير موجودة'; END IF;
  EXECUTE broke;
  IF position('v_left := 0;' IN pg_get_functiondef('public.buyer_confirm_receipt(text)'::regprocedure)) = 0
     THEN RAISE EXCEPTION 'BTBUG: الكسرةُ لم تسرِ على الدالّة الحيّة'; END IF;

  BEGIN PERFORM pg_temp.v42_check(); text_passed := true; EXCEPTION WHEN OTHERS THEN text_passed := false; END;
  IF NOT text_passed THEN
    RAISE EXCEPTION 'BTBUG: تغيّر سلوكُ الفحص النصّيّ — حُدِّث التوثيق';
  END IF;
  RAISE NOTICE '⚠️ ١أ) الفحصُ النصّيّ مرّ على حارسٍ ميّت — عجزٌ موثَّق';

  BEGIN
    PERFORM pg_temp.v42_behave();
    RAISE EXCEPTION 'BTBUG: الحارسُ ميّتٌ والتحقّقُ السلوكيّ مرّ';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'BTBUG%' THEN RAISE; END IF;
    RAISE NOTICE '✅ ١ب) التحقّقُ السلوكيّ أسقطها بـ«%»', SQLERRM;
  END;
END $b$;
ROLLBACK;

-- ═══ كسرة 2: إسقاطُ المهلة نصّاً من مسار الموقع ═════════════════════════════════════════
BEGIN;
DO $b$
DECLARE src text; broke text;
BEGIN
  src := pg_get_functiondef('public.buyer_confirm_receipt(text)'::regprocedure);
  broke := regexp_replace(src, 'IF v_left > 0 THEN.*?END IF;', '', 'n');
  broke := replace(broke, 'v_left := ceil(', 'v_left := 0; PERFORM ceil(');
  broke := replace(broke, 'public.taki_self_close_minutes()', '0');
  IF broke = src THEN RAISE EXCEPTION 'BTBUG: الكسرةُ لم تُحقن'; END IF;
  EXECUTE broke;
  IF position('taki_self_close_minutes' IN pg_get_functiondef('public.buyer_confirm_receipt(text)'::regprocedure)) > 0
     THEN RAISE EXCEPTION 'BTBUG: الكسرةُ لم تسرِ'; END IF;
  BEGIN
    PERFORM pg_temp.v42_check();
    RAISE EXCEPTION 'BTBUG: كسرة 2 لم يُسقطها أيُّ فحص';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'BTBUG%' THEN RAISE; END IF;
    RAISE NOTICE '✅ 2) إسقاطُ المهلة نصّاً من مسار الموقع ⇒ سقطت بـ«%»', SQLERRM;
  END;
END $b$;
ROLLBACK;

-- ═══ كسرة 3: إعادةُ ثُلمة المشتري إلى complete_booking ═════════════════════════════════════════
BEGIN;
DO $b$
DECLARE src text; broke text;
BEGIN
  src := pg_get_functiondef('public.complete_booking(text)'::regprocedure);
  broke := replace(src, 'AND caller = store_id', 'AND (caller = store_id OR caller = user_id)');
  IF broke = src THEN RAISE EXCEPTION 'BTBUG: الكسرةُ لم تُحقن'; END IF;
  EXECUTE broke;
  IF position('caller = user_id' IN pg_get_functiondef('public.complete_booking(text)'::regprocedure)) = 0
     THEN RAISE EXCEPTION 'BTBUG: الكسرةُ لم تسرِ'; END IF;
  BEGIN
    PERFORM pg_temp.v42_check();
    PERFORM pg_temp.v42_behave();
    RAISE EXCEPTION 'BTBUG: كسرة 3 لم يُسقطها أيُّ فحص';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'BTBUG%' THEN RAISE; END IF;
    RAISE NOTICE '✅ 3) إعادةُ ثُلمة المشتري إلى complete_booking ⇒ سقطت بـ«%»', SQLERRM;
  END;
END $b$;
ROLLBACK;

-- ═══ كسرة 4: منحُ الزائر صلاحيةَ اختصار التاجر ═════════════════════════════════════════
BEGIN;
DO $b$
DECLARE src text; broke text;
BEGIN
  GRANT EXECUTE ON FUNCTION public.merchant_handover_booking(text) TO anon;
  IF NOT has_function_privilege('anon','public.merchant_handover_booking(text)','EXECUTE')
     THEN RAISE EXCEPTION 'BTBUG: المنحُ لم يسرِ'; END IF;
  BEGIN
    PERFORM pg_temp.v42_check();
    RAISE EXCEPTION 'BTBUG: كسرة 4 لم يُسقطها أيُّ فحص';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'BTBUG%' THEN RAISE; END IF;
    RAISE NOTICE '✅ 4) منحُ الزائر صلاحيةَ اختصار التاجر ⇒ سقطت بـ«%»', SQLERRM;
  END;
END $b$;
ROLLBACK;

-- ═══ كسرة 5: محوُ الحقل من صفّ الإعدادات ═════════════════════════════════════════
BEGIN;
DO $b$
DECLARE src text; broke text;
BEGIN
  UPDATE public.platform_settings SET value = value - 'self_close_minutes' WHERE key='booking_holds';
  IF EXISTS (SELECT 1 FROM public.platform_settings WHERE key='booking_holds' AND value ? 'self_close_minutes')
     THEN RAISE EXCEPTION 'BTBUG: المحوُ لم يسرِ'; END IF;
  BEGIN
    PERFORM pg_temp.v42_check();
    RAISE EXCEPTION 'BTBUG: كسرة 5 لم يُسقطها أيُّ فحص';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'BTBUG%' THEN RAISE; END IF;
    RAISE NOTICE '✅ 5) محوُ الحقل من صفّ الإعدادات ⇒ سقطت بـ«%»', SQLERRM;
  END;
END $b$;
ROLLBACK;

-- ═══ كسرة 6: إسقاطُ حارس انطلاق المندوب (إضعافٌ تحت ستار توسعة) ═════════════════════════════════════════
BEGIN;
DO $b$
DECLARE src text; broke text;
BEGIN
  src := pg_get_functiondef('public.buyer_confirm_receipt(text)'::regprocedure);
  broke := replace(src, '''on_the_way'',''arrived'',''delivered''', '''anything''');
  IF broke = src THEN RAISE EXCEPTION 'BTBUG: الكسرةُ لم تُحقن'; END IF;
  EXECUTE broke;
  IF position('on_the_way' IN pg_get_functiondef('public.buyer_confirm_receipt(text)'::regprocedure)) > 0
     THEN RAISE EXCEPTION 'BTBUG: الكسرةُ لم تسرِ'; END IF;
  BEGIN
    PERFORM pg_temp.v42_check();
    RAISE EXCEPTION 'BTBUG: كسرة 6 لم يُسقطها أيُّ فحص';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'BTBUG%' THEN RAISE; END IF;
    RAISE NOTICE '✅ 6) إسقاطُ حارس انطلاق المندوب (إضعافٌ تحت ستار توسعة) ⇒ سقطت بـ«%»', SQLERRM;
  END;
END $b$;
ROLLBACK;

-- ═══ كسرة 7: حارسٌ يحجب دائماً — والحالةُ الموجبة لا بدّ منها ═════════════════════════════════════════
BEGIN;
DO $b$
DECLARE src text; broke text;
BEGIN
  src := pg_get_functiondef('public.buyer_confirm_receipt(text)'::regprocedure);
  broke := replace(src, 'IF v_left > 0 THEN', 'IF v_left > -999999 THEN');
  IF broke = src THEN RAISE EXCEPTION 'BTBUG: الكسرةُ لم تُحقن'; END IF;
  EXECUTE broke;
  IF position('-999999' IN pg_get_functiondef('public.buyer_confirm_receipt(text)'::regprocedure)) = 0
     THEN RAISE EXCEPTION 'BTBUG: الكسرةُ لم تسرِ'; END IF;
  BEGIN
    PERFORM pg_temp.v42_behave();
    RAISE EXCEPTION 'BTBUG: كسرة 7 لم يُسقطها أيُّ فحص';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'BTBUG%' THEN RAISE; END IF;
    RAISE NOTICE '✅ 7) حارسٌ يحجب دائماً — والحالةُ الموجبة لا بدّ منها ⇒ سقطت بـ«%»', SQLERRM;
  END;
END $b$;
ROLLBACK;

-- ── القاعدةُ سليمةٌ بعد كلّ شيء ─────────────────────────────────────────────
DO $t$ BEGIN
  PERFORM pg_temp.v42_check();
  PERFORM pg_temp.v42_behave();
  RAISE NOTICE '════════ ٧/٧ كسرات كسرت · والقاعدةُ سليمة ✅ ════════';
END $t$;

SELECT 'طلباتُ الكسر الباقية' AS "البند",
       (SELECT count(*)::text FROM public.bookings WHERE barcode LIKE '98%' OR barcode LIKE '97%') AS "القيمة";
