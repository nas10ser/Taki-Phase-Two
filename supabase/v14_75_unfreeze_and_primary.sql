-- ════════════════════════════════════════════════════════════════════════════
-- v14.75 — بابٌ لا يُفتح: عروضٌ جُمّدت بالتخفيض ولا شيء في القاعدة يفكّها
-- ════════════════════════════════════════════════════════════════════════════
-- كُشف أثناء تنفيذ v14.74 (رفع سقف تاكي ٣ ⇐ ٥) بفحصٍ خصم، وقِيس على جدة:
--   • `subscription_frozen = TRUE` تُكتب في ثلاث دوال (`freeze_deals_on_downgrade`
--     و`taki_reconcile_location_caps` و`taki_subscription_maintenance`)،
--     و**صفر دوال في القاعدة كلها تكتب FALSE**. أي أن التجميد بابٌ باتّجاهٍ واحد.
--   • تاكي: **٧ من ١٠ عروض مجمّدة** (٥ منها `paused`)، وN15: ٢.
--   • ورفعُ السقف لا يفكّ شيئاً: `freeze_deals_on_downgrade` تعود فوراً عند
--     الترقية، فلا أحد يُراجع ما جُمّد بالأمس.
-- أي أن التاجر يرقّي باقته فيظنّ أن عروضه عادت — ولا تعود، ولا رسالة تقول له.
--
-- الحلّ: دالّة فكٍّ **بنفس منطق التجميد معكوساً** (اتحاد مفاتيح المواقع،
-- الأقدم أولاً)، ومشغّلٌ يناديها عند **رفع** السقف وحده.
--
-- 🪤 الفكّ لا يعني النشر: `guard_deal_publish` يرفض إحياء عرضٍ لتاجرٍ اشتراكه
--    غير فعّال. فتُفكّ العلامة دائماً (فيستعيد التاجر ملكية القرار) ويُحاوَل
--    الإحياء في كتلةٍ فرعية — فإن رفضه الحارس بقي العرض موقوفاً بلا تجميد،
--    وهو الصواب: لا نُعيد نشر عروضٍ لاشتراكٍ منتهٍ من وراء الحارس.
-- 🪤 وترتيب الفكّ = ترتيب التجميد (`created_at ASC`) فلا يفكّ العرضُ الأحدث
--    خانةً يستحقّها الأقدم.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'رُفض: هذا خادم المختبر (طوكيو) — هجرات الإنتاج تُطبَّق على جدة';
  END IF;
END $guard$;

BEGIN;

CREATE OR REPLACE FUNCTION public.taki_unfreeze_deals_within_cap(p_store_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_max        int;
  v_keys       text[] := ARRAY[]::text[];
  v_deal_keys  text[];
  r            record;
  v_unfrozen   int := 0;
  v_republished int := 0;
BEGIN
  SELECT max_branches INTO v_max FROM public.store_profiles WHERE store_id = p_store_id;
  IF v_max IS NULL OR v_max <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_cap');
  END IF;

  -- الأساس: مفاتيح ما هو **حيّ** اليوم (فروع نشطة + عروض نشطة) — هي ما يشغل
  -- الخانات فعلاً، ولا يُفكّ عرضٌ يدفع الاتحاد فوق السقف.
  SELECT COALESCE(array_agg(DISTINCT k), ARRAY[]::text[]) INTO v_keys
    FROM (
      SELECT k FROM public.deals d
        CROSS JOIN LATERAL public._taki_deal_loc_keys(d.location_id, d.map_lat, d.map_lng, d.locations) k
       WHERE d.store_id = p_store_id AND d.status = 'active'
      UNION ALL
      SELECT CASE WHEN b.location_id IS NOT NULL AND b.location_id <> 'other'
                   AND b.location_id NOT LIKE 'custom\_%' ESCAPE '\'
                  THEN 'loc:' || b.location_id
                  ELSE 'geo:' || ROUND(COALESCE(b.map_lat,0)::numeric,3)::text || ',' ||
                                 ROUND(COALESCE(b.map_lng,0)::numeric,3)::text END
        FROM public.store_branches b
       WHERE b.merchant_id = p_store_id AND COALESCE(b.is_active, true)
    ) t;

  FOR r IN
    SELECT d.id,
           ARRAY(SELECT DISTINCT k
                   FROM public._taki_deal_loc_keys(d.location_id, d.map_lat, d.map_lng, d.locations) k) AS keys,
           d.status
      FROM public.deals d
     WHERE d.store_id = p_store_id AND COALESCE(d.subscription_frozen, false)
     ORDER BY d.created_at ASC NULLS FIRST, d.id ASC
  LOOP
    -- العرض بذاته أكبر من السقف ⇒ يبقى مجمّداً (لا خانة تكفيه أصلاً)
    CONTINUE WHEN array_length(r.keys, 1) IS NOT NULL AND array_length(r.keys, 1) > v_max;

    v_deal_keys := ARRAY(SELECT DISTINCT x FROM unnest(v_keys || r.keys) x);
    CONTINUE WHEN array_length(v_deal_keys, 1) > v_max;

    v_keys := v_deal_keys;

    -- (١) تُفكّ العلامة دائماً: القرار يعود للتاجر.
    UPDATE public.deals SET subscription_frozen = false WHERE id = r.id;
    v_unfrozen := v_unfrozen + 1;

    -- (٢) ويُحاول الإحياء — وحارس النشر هو من يبتّ، لا نحن.
    IF r.status = 'paused' THEN
      BEGIN
        UPDATE public.deals SET status = 'active' WHERE id = r.id;
        v_republished := v_republished + 1;
      EXCEPTION WHEN OTHERS THEN
        NULL;   -- اشتراكٌ غير فعّال أو حارسٌ آخر: يبقى موقوفاً بلا تجميد
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'unfrozen', v_unfrozen,
                            'republished', v_republished, 'cap', v_max);
END $function$;

REVOKE ALL ON FUNCTION public.taki_unfreeze_deals_within_cap(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_unfreeze_deals_within_cap(text) FROM anon;
REVOKE ALL ON FUNCTION public.taki_unfreeze_deals_within_cap(text) FROM authenticated;

-- المشغّل: عند **رفع** السقف وحده (الخفض له دالّته منذ زمن).
CREATE OR REPLACE FUNCTION public.tg_unfreeze_on_upgrade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.max_branches IS NOT NULL AND OLD.max_branches IS NOT NULL
     AND NEW.max_branches > OLD.max_branches THEN
    PERFORM public.taki_unfreeze_deals_within_cap(NEW.store_id);
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS tr_unfreeze_on_upgrade ON public.store_profiles;
CREATE TRIGGER tr_unfreeze_on_upgrade
  AFTER UPDATE OF max_branches ON public.store_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_unfreeze_on_upgrade();

-- ── ترقية الموقع الرئيسي في كتابةٍ واحدة ───────────────────────────────────
-- 🔴 لماذا: الإنزال والترقية كتابتان منفصلتان في الواجهة، فإن فشلت الثانية
--    (وv14.74 زادت احتمالها بحارس تكرار الاسم) بقي المتجر **بلا رئيسيّ** —
--    وهي الحالة التي جاء ناصر يشكو منها في تاكي. هنا الاثنتان معاملةٌ واحدة.
CREATE OR REPLACE FUNCTION public.merchant_set_primary_branch(p_branch_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid text := auth.uid()::text; v_mid text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT merchant_id INTO v_mid FROM public.store_branches WHERE id = p_branch_id;
  IF v_mid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF v_mid <> v_uid AND NOT COALESCE(public.taki_admin_perm('tab_sellers'), false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  UPDATE public.store_branches SET is_primary = false, updated_at = now()
   WHERE merchant_id = v_mid AND COALESCE(is_primary, false) AND id <> p_branch_id;
  UPDATE public.store_branches SET is_primary = true, updated_at = now()
   WHERE id = p_branch_id;

  RETURN jsonb_build_object('ok', true, 'branch_id', p_branch_id);
END $function$;

REVOKE ALL ON FUNCTION public.merchant_set_primary_branch(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_set_primary_branch(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_set_primary_branch(text) TO authenticated;

COMMIT;

-- ── فكُّ ما جُمّد فعلاً (لكل متجرٍ له مجمَّد) ────────────────────────────────
DO $run$
DECLARE r record; v jsonb;
BEGIN
  FOR r IN SELECT DISTINCT store_id FROM public.deals WHERE COALESCE(subscription_frozen,false) LOOP
    v := public.taki_unfreeze_deals_within_cap(r.store_id);
    RAISE NOTICE 'متجر % ⇐ %', left(r.store_id,8), v::text;
  END LOOP;
END $run$;

-- ── تحقّقٌ يرفع استثناءً ─────────────────────────────────────────────────────
DO $verify$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_proc
   WHERE proname='taki_unfreeze_deals_within_cap' AND pronamespace='public'::regnamespace;
  IF n <> 1 THEN RAISE EXCEPTION 'فشل: نسخ دالة الفكّ = %', n; END IF;
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid='public.store_profiles'::regclass AND tgname='tr_unfreeze_on_upgrade';
  IF n <> 1 THEN RAISE EXCEPTION 'فشل: مشغّل الفكّ عند الترقية غير مركّب'; END IF;
  IF has_function_privilege('anon','public.taki_unfreeze_deals_within_cap(text)','EXECUTE') THEN
    RAISE EXCEPTION 'فشل: دالة الفكّ مكشوفة لـanon';
  END IF;

  -- لا يتجاوز أي متجرٍ سقفَه بعد الفكّ (وإلا صار الفكّ خرقاً للسقف)
  SELECT count(*) INTO n FROM (
    SELECT sp.store_id, sp.max_branches,
           (SELECT count(DISTINCT k) FROM public.deals d
              CROSS JOIN LATERAL public._taki_deal_loc_keys(d.location_id, d.map_lat, d.map_lng, d.locations) k
             WHERE d.store_id = sp.store_id AND d.status='active') AS used
      FROM public.store_profiles sp WHERE sp.max_branches IS NOT NULL) t
   WHERE used > max_branches;
  IF n <> 0 THEN RAISE EXCEPTION 'فشل: % متجراً تجاوز سقفه بعد الفكّ', n; END IF;
END $verify$;

SELECT 'v14.75' AS "الهجرة",
       (SELECT count(*) FROM deals WHERE subscription_frozen) AS "ما زال مجمّداً",
       (SELECT count(*) FROM deals WHERE store_id='2c0b4cde-79c3-4290-abaa-812a895b1bcb' AND status='active') AS "عروض تاكي النشطة";
