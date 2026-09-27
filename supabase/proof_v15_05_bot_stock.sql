-- ═══════════════════════════════════════════════════════════════════════════
-- إثباتُ v15.05 — بنداءٍ حقيقيّ من هويّة تاجرٍ حقيقيّ (تجربةٌ تُلغى)
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 ليس هجرة: ينادي `bot_update_deal` على عروض تاجرٍ حيّ ثمّ يُلغي كلّ شيء.
--    وسببُ فصله: هجرةٌ لا تعدّل عروضَ تاجرٍ حتى لو أعادتها بعدها — فانقطاعٌ
--    في منتصف الهجرة يترك متجرَه مغيَّراً.
BEGIN;

DO $proof$
DECLARE
  v_tg   bigint;
  v_deal text;
  v_oh0 int; v_q0 int; v_st0 text; v_iq int; v_unl0 boolean;
  r jsonb; v_oh int; v_q int; v_unl boolean;
BEGIN
  SELECT u.telegram_id INTO v_tg FROM users u
   WHERE u.telegram_id IS NOT NULL AND u.user_type IN ('seller','admin') AND u.deleted_at IS NULL LIMIT 1;
  IF v_tg IS NULL THEN RAISE EXCEPTION '❌ لا تاجرَ له تيليجرام — لا يمكن الإثبات.'; END IF;

  SELECT d.id, d.on_hand, d.quantity, d.status, d.initial_quantity, d.is_unlimited
    INTO v_deal, v_oh0, v_q0, v_st0, v_iq, v_unl0
    FROM deals d JOIN users u ON u.id = d.store_id
   WHERE u.telegram_id = v_tg AND d.on_hand IS NOT NULL
     AND d.initial_quantity IS NOT NULL AND d.initial_quantity > d.on_hand
   ORDER BY (d.initial_quantity - d.on_hand) DESC LIMIT 1;
  IF v_deal IS NULL THEN RAISE EXCEPTION '❌ لا عرضَ بفجوةٍ بين الكامل والأصلي.'; END IF;
  RAISE NOTICE 'ℹ️ العرض % — كامل=% أصلي=% حالة=%', v_deal, v_oh0, v_iq, v_st0;

  -- ── (١) إعادةُ التفعيل لا تُحيي بضاعةً مباعة ───────────────────────────
  -- نُنزله إلى «متوقّف» ثمّ نُعيد تفعيله من البوت — وهو المسار الذي كان
  -- يقفز فيه الكامل من ١٣ إلى ٢٠ (سبعُ قطعٍ بيعت تعود للبيع).
  UPDATE deals SET status = 'paused' WHERE id = v_deal;
  r := public.bot_update_deal(p_telegram_id := v_tg, p_deal_id := v_deal, p_status := 'active');
  IF NOT COALESCE((r->>'success')::boolean, false) THEN
    RAISE EXCEPTION '❌ إعادةُ التفعيل فشلت: %', r::text;
  END IF;
  SELECT on_hand, quantity INTO v_oh, v_q FROM deals WHERE id = v_deal;
  IF v_oh <> v_oh0 THEN
    RAISE EXCEPTION '❌ 🔴 إعادةُ التفعيل غيّرت المخزون الكامل: % ⇐ % (الأصلي المعلَن %). بضاعةٌ بيعت عادت للبيع.',
      v_oh0, v_oh, v_iq;
  END IF;
  RAISE NOTICE '✅ إعادةُ التفعيل: الكامل ثابتٌ عند % (ولم يقفز إلى %)', v_oh, v_iq;

  -- ── (٢) «٠» تعني «نفد» لا «بلا حدّ» ────────────────────────────────────
  -- 🔴 هذا هو المسار الذي يسلكه أيُّ مفتاح «نفد» يُكتب بالطريقة البديهية.
  r := public.bot_update_deal(p_telegram_id := v_tg, p_deal_id := v_deal, p_quantity := 0);
  IF NOT COALESCE((r->>'success')::boolean, false) THEN
    RAISE EXCEPTION '❌ كتابةُ الصفر فشلت: %', r::text;
  END IF;
  SELECT on_hand, quantity, is_unlimited INTO v_oh, v_q, v_unl FROM deals WHERE id = v_deal;
  IF COALESCE(v_unl, false) THEN
    RAISE EXCEPTION '❌ 🔴 «٠» جعلت العرض بلا حدّ — عكسُ المقصود تماماً (كامل=%).', v_oh;
  END IF;
  IF v_oh <> 0 OR v_q <> 0 THEN
    RAISE EXCEPTION '❌ «٠» لم تُنفد العرض: كامل=% متاح=%.', v_oh, v_q;
  END IF;
  RAISE NOTICE '✅ «٠»: محدودٌ · كامل=٠ · متاح=٠ — أي «نفد» فعلاً.';

  -- ── (٣) البوت يرى المخزون الكامل ───────────────────────────────────────
  PERFORM public.taki_set_on_hand(v_deal, v_oh0, NULL, NULL, now(), 'proof');
  r := public.bot_get_seller_deal(p_telegram_id := v_tg, p_deal_id := v_deal);
  IF r IS NULL THEN RAISE EXCEPTION '❌ البوت لا يرى العرض.'; END IF;
  IF NOT (r ? 'on_hand') THEN
    RAISE EXCEPTION '❌ 🔴 البطاقة بلا `on_hand` — التاجر يقرأ المتاح ويكتبه فينكمش مخزونه كلّ تعديل.';
  END IF;
  IF (r->>'on_hand')::int <> v_oh0 THEN
    RAISE EXCEPTION '❌ الكامل في البطاقة % والصحيح %.', r->>'on_hand', v_oh0;
  END IF;
  IF NOT (r ? 'variants') OR NOT (r ? 'locations') OR NOT (r ? 'loc_qty_mode') THEN
    RAISE EXCEPTION '❌ الأصناف/الفروع لا تصل البوت — الدرجة ٠ مستحيلة عليه.';
  END IF;
  RAISE NOTICE '✅ البطاقة: كامل=% · وفيها الأصناف والفروع.', r->>'on_hand';

  -- ── (٤) القائمة كذلك ───────────────────────────────────────────────────
  r := public.bot_get_seller_deals(p_telegram_id := v_tg);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r) e WHERE e ? 'on_hand') THEN
    RAISE EXCEPTION '❌ قائمةُ العروض بلا الكامل.';
  END IF;
  RAISE NOTICE '✅ القائمة تحمل الكامل.';

  -- ── (٥) حالةٌ NULL لا تُنقص المخزون ────────────────────────────────────
  DECLARE v_bc text; v_before int;
  BEGIN
    SELECT on_hand INTO v_before FROM deals WHERE id = v_deal;
    ALTER TABLE public.bookings DISABLE TRIGGER USER;
    ALTER TABLE public.bookings ENABLE TRIGGER tr_zx_on_hand_on_sale;
    SELECT barcode INTO v_bc FROM bookings WHERE deal_id = v_deal LIMIT 1;
    IF v_bc IS NOT NULL THEN
      UPDATE bookings SET status = NULL WHERE barcode = v_bc;
      SELECT on_hand INTO v_oh FROM deals WHERE id = v_deal;
      IF v_oh <> v_before THEN
        RAISE EXCEPTION '❌ 🔴 حالةٌ NULL أنقصت المخزون: % ⇐ %.', v_before, v_oh;
      END IF;
      RAISE NOTICE '✅ حالةُ NULL لم تُنقص شيئاً (الكامل ثابتٌ عند %).', v_oh;
    ELSE
      RAISE NOTICE 'ℹ️ لا حجزَ على هذا العرض — فحصُ NULL تخطّي.';
    END IF;
    ALTER TABLE public.bookings ENABLE TRIGGER USER;
  END;

  RAISE NOTICE '✅ الإثبات كامل. (كلُّ ما سبق داخل معاملةٍ تُلغى.)';
END
$proof$;

ROLLBACK;

-- وتأكيدٌ أن شيئاً لم يبقَ
SELECT 'بعد الإلغاء — الكامل: ' || on_hand::text || ' الحالة: ' || status
  FROM public.deals WHERE id = '1778705453968';
