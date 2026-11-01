-- ═══════════════════════════════════════════════════════════════════════════
-- v15.41 — «استلمتُ طلبي» للمشتري في طلبات الاستلام أيضاً (أمرُ ناصر)
-- ═══════════════════════════════════════════════════════════════════════════
-- v14.10 أعطت المشتري زرَّ إغلاق الطلب لأن «طلباً سُلِّم فعلاً ونسي التاجرُ
-- ختمَه ينقلب «ملغى» بعد المهلة وتُرجَع كمّيتُه للمخزون فتُباع مرّةً ثانية».
-- لكنها حصرته في **التوصيل**: `fulfillment <> 'delivery'` ⇒ رفضٌ صريح.
-- والعلّةُ نفسُها قائمةٌ في الاستلام من المتجر حرفاً بحرف — بل هي أشيع، لأن
-- الاستلام هو الوضع الافتراضيّ وكلُّ طلبات المنصّة اليوم منه.
--
-- 🪤 ولم يُلغَ الشرط بل صار **مشروطاً بنوع الطلب**: التوصيلُ يبقى محتاجاً
--    إعلانَ التاجر انطلاقَ المندوب — وهو شاهدٌ موضوعيّ على أن التاجر تحرّك —
--    والاستلامُ لا جدولَ تتبُّعٍ له أصلاً فيكفيه أن يكون الطلبُ حيّاً.
-- 🪤 و`completed_by='buyer'` كانت تُسجَّل أصلاً، فيرى التاجرُ من أغلق الطلب.
-- 🪤 والدالّتان **متوأمتان** (الموقع والبوتان) — تُعدَّلان معاً وإلّا صار
--    للمشتري زرٌّ في قناةٍ دون أخرى. وثلاثُ واجهاتٍ تعرض الزرّ: `Bookings.tsx`
--    و`server/bot.js` و`server/flows/whatsapp.js` — وكلُّها تُوسَّع في نفس الإصدار.
-- 🪤 وبُنيتا من **النصّ الحيّ** لا من المستودع.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.buyer_confirm_receipt(text)') IS NULL
     OR to_regprocedure('public.bot_buyer_confirm_receipt(bigint,text,text)') IS NULL THEN
    RAISE EXCEPTION 'دالّتا v14.10 غائبتان — الأساسُ مختلف، أوقِفت.';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.buyer_confirm_receipt(p_barcode text)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  text := auth.uid()::text;
  v_b    public.bookings%ROWTYPE;
  v_trk  text;
  v_out  public.bookings;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND OR v_b.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'لم يتم العثور على الطلب' USING ERRCODE = 'P0002';
  END IF;
  -- 🔴 v15.41 (أمرُ ناصر) — كان الزرُّ لطلبات **التوصيل وحدها**، فطلبُ الاستلام
  -- من المتجر لا يملك المشتري إغلاقَه أبداً. وعلّةُ v14.10 واحدةٌ في الحالتين:
  -- طلبٌ سُلِّم فعلاً ونسي التاجرُ ختمَه ينقلب «ملغى» بعد المهلة وتُرجَع كمّيتُه
  -- للمخزون **فتُباع مرّةً ثانية**. والمشتري هو الشاهدُ الوحيد على الاستلام.
  -- 🪤 والشرطُ لم يُلغَ بل صار **مشروطاً بنوع الطلب**: التوصيلُ يبقى محتاجاً
  --    إعلانَ التاجر انطلاقَ المندوب (شاهدٌ موضوعيّ)، والاستلامُ لا تتبُّعَ له
  --    أصلاً فيكفيه أن يكون الطلبُ حيّاً. و`completed_by='buyer'` تُسجَّل في
  --    الحالتين فيرى التاجرُ من أغلق الطلب.
  IF v_b.status NOT IN ('pending','acknowledged') THEN
    RAISE EXCEPTION 'الطلب مغلق بالفعل' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_b.fulfillment,'pickup') = 'delivery' THEN
    SELECT status INTO v_trk FROM public.delivery_tracks WHERE barcode = v_b.barcode;
    IF COALESCE(v_trk,'') NOT IN ('on_the_way','arrived','delivered') THEN
      RAISE EXCEPTION 'لم يبدأ التاجر التوصيل بعد' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.bookings
     SET status = 'completed', completed_by = 'buyer'
   WHERE barcode = v_b.barcode
     AND status IN ('pending','acknowledged')
  RETURNING * INTO v_out;

  IF v_out.barcode IS NULL THEN
    RAISE EXCEPTION 'الطلب مغلق بالفعل' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
  VALUES (v_out.store_id,
          '✅ أكّد المشتري الاستلام', '✅ Buyer confirmed receipt',
          'أكّد المشتري استلام الطلب ' || v_out.barcode,
          'The buyer confirmed receiving order ' || v_out.barcode,
          'booking',
          jsonb_build_object('audience','seller','event','buyer_confirmed',
                             'barcode', v_out.barcode, 'dealId', v_out.deal_id),
          NOW());

  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bot_buyer_confirm_receipt(p_telegram_id bigint, p_barcode text, p_whatsapp_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid text; v_b public.bookings%ROWTYPE; v_trk text;
BEGIN
  IF NOT public._bot_gate_ok() THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT id INTO v_uid FROM public.users
   WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id) AND deleted_at IS NULL LIMIT 1;
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_linked'); END IF;

  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode)) AND user_id = v_uid;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  -- 🔴 v15.41 (أمرُ ناصر) — كان الزرُّ لطلبات **التوصيل وحدها**، فطلبُ الاستلام
  -- من المتجر لا يملك المشتري إغلاقَه أبداً. وعلّةُ v14.10 واحدةٌ في الحالتين:
  -- طلبٌ سُلِّم فعلاً ونسي التاجرُ ختمَه ينقلب «ملغى» بعد المهلة وتُرجَع كمّيتُه
  -- للمخزون **فتُباع مرّةً ثانية**. والمشتري هو الشاهدُ الوحيد على الاستلام.
  -- 🪤 والشرطُ لم يُلغَ بل صار **مشروطاً بنوع الطلب**: التوصيلُ يبقى محتاجاً
  --    إعلانَ التاجر انطلاقَ المندوب (شاهدٌ موضوعيّ)، والاستلامُ لا تتبُّعَ له
  --    أصلاً فيكفيه أن يكون الطلبُ حيّاً. و`completed_by='buyer'` تُسجَّل في
  --    الحالتين فيرى التاجرُ من أغلق الطلب.
  IF v_b.status NOT IN ('pending','acknowledged') THEN
    RETURN jsonb_build_object('success',false,'error','closed'); END IF;

  IF COALESCE(v_b.fulfillment,'pickup') = 'delivery' THEN
    SELECT status INTO v_trk FROM public.delivery_tracks WHERE barcode = v_b.barcode;
    IF COALESCE(v_trk,'') NOT IN ('on_the_way','arrived','delivered') THEN
      RETURN jsonb_build_object('success',false,'error','not_dispatched'); END IF;
  END IF;

  UPDATE public.bookings SET status='completed', completed_by='buyer'
   WHERE barcode = v_b.barcode AND status IN ('pending','acknowledged');

  INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
  VALUES (v_b.store_id, '✅ أكّد المشتري الاستلام', '✅ Buyer confirmed receipt',
          'أكّد المشتري استلام الطلب ' || v_b.barcode,
          'The buyer confirmed receiving order ' || v_b.barcode,
          'booking',
          jsonb_build_object('audience','seller','event','buyer_confirmed',
                             'barcode', v_b.barcode, 'dealId', v_b.deal_id),
          NOW());

  RETURN jsonb_build_object('success', true, 'barcode', v_b.barcode);
END;
$function$;

-- ── تحقّقٌ سلوكيّ يُفشل الهجرة إن كذبت ──────────────────────────────────────
-- 🪤 يُجرَّد التعليقُ قبل أيّ فحصِ نصّ: شرحُ هذه الهجرة نفسُه يحوي
--    `fulfillment <> 'delivery'` فيُبرّئ الكودَ المكسور (درس v15.40 قبل ساعات).
BEGIN;
DO $test$
DECLARE src_w text; src_b text; v_bc text; v_err text; v_hit boolean; v_uid text; v_sid text;
BEGIN
  src_w := regexp_replace(pg_get_functiondef('public.buyer_confirm_receipt(text)'::regprocedure), '--[^' || chr(10) || ']*', '', 'g');
  src_b := regexp_replace(pg_get_functiondef('public.bot_buyer_confirm_receipt(bigint,text,text)'::regprocedure), '--[^' || chr(10) || ']*', '', 'g');

  -- (أ) لم يعد الاستلامُ مرفوضاً بذاته
  IF position('fulfillment,''pickup'') <> ''delivery''' IN src_w) > 0
     OR position('fulfillment,''pickup'') <> ''delivery''' IN src_b) > 0 THEN
    RAISE EXCEPTION '❌ ما زال الرفضُ القاطع لطلبات الاستلام قائماً';
  END IF;
  -- (ب) وشرطُ التوصيل لم يُلغَ — صار مشروطاً
  IF position('= ''delivery'' THEN' IN src_w) = 0 OR position('= ''delivery'' THEN' IN src_b) = 0 THEN
    RAISE EXCEPTION '❌ شرطُ انطلاق المندوب سقط عن التوصيل — هذا إضعافٌ لا توسعة';
  END IF;
  IF position('on_the_way' IN src_w) = 0 OR position('on_the_way' IN src_b) = 0 THEN
    RAISE EXCEPTION '❌ فحصُ التتبّع غاب كلّياً';
  END IF;

  -- 🪤 والإثباتُ السلوكيّ ليس هنا: إدراجُ حجزٍ يمرّ على ثمانية عشر مشغّلاً
  --    ويكتب فواتير وإشعارات — لا مكانَ له في هجرةٍ تُطبَّق على الإنتاج
  --    (عُرفُ تاكي، ويفرضه `scripts/check-stock-model.js`). مكانُه
  --    `supabase/proof_v15_41_buyer_pickup_receipt.sql` داخل معاملةٍ تُلغى.
  --    وقِيس أن المنصّة اليوم بلا أيّ طلبٍ حيّ (٧٢ مكتمل · ٣٢ ملغى)، فاختبارٌ
  --    يعتمد على صفٍّ قائم كان **لن يُجرى أصلاً** ويمرّ صامتاً.

  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE '✅ بنيويّاً: الرفضُ القاطع للاستلام زال · وشرطُ انطلاق المندوب باقٍ للتوصيل. (السلوكُ يُثبَت في proof_v15_41.)';
END
$test$;
ROLLBACK;

SELECT 'المختبر؟' AS البند, coalesce(obj_description('public'::regnamespace,'pg_namespace'),'لا — جدّة') AS القيمة
UNION ALL SELECT 'الموقع: الاستلام مسموح',
  CASE WHEN position('fulfillment,''pickup'') <> ''delivery''' IN regexp_replace(pg_get_functiondef('public.buyer_confirm_receipt(text)'::regprocedure),'--[^' || chr(10) || ']*','','g')) = 0 THEN '✅' ELSE '❌' END
UNION ALL SELECT 'البوتان: الاستلام مسموح',
  CASE WHEN position('fulfillment,''pickup'') <> ''delivery''' IN regexp_replace(pg_get_functiondef('public.bot_buyer_confirm_receipt(bigint,text,text)'::regprocedure),'--[^' || chr(10) || ']*','','g')) = 0 THEN '✅' ELSE '❌' END
UNION ALL SELECT 'طلباتُ استلامٍ حيّة الآن',
  (SELECT count(*)::text FROM public.bookings WHERE COALESCE(fulfillment,'pickup') <> 'delivery' AND status IN ('pending','acknowledged'));
