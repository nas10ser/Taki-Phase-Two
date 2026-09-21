-- ════════════════════════════════════════════════════════════════════════════
-- v14.76 — السقف يتبع الباقة، لا رقماً أكتبه أنا
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 **تصحيح خطأٍ ارتكبتُه في v14.74.** رفعتُ سقف متجر «تاكي» من ٣ إلى ٥
--    «ليطابق الواقع» — وكان الحكم مقلوباً: الواقع هو المخالف. قال ناصر:
--    «باقته كانت ٦ ثم نزل الاشتراك لـ٣، لذلك تراها بهذه الحالة». أي أن
--    المواقع الخمسة **بقايا الباقة القديمة**، والسقف ٣ كان **صحيحاً**
--    والتجميد كان **إنفاذاً صحيحاً** لتخفيضٍ مقصود. فدهستُ قيمةً سليمة برقمٍ
--    من عندي. يُعاد إلى ٣.
--
-- ولماذا لم يتبع السقفُ الباقةَ أصلاً؟ الربط **قائمٌ ويعمل**:
--   لوحة المدير ← «الباقات والأسعار» ← حفظ ⇒ `admin_sync_package_limits()`
--   ⇒ `UPDATE store_profiles SET max_branches = <max الباقة>`
--      `WHERE subscription_package_id = <id الباقة>`
-- والسبب الوحيد أن متجر تاكي خارجه: **`subscription_package_id` فارغ عنده**
-- (قِيس: NULL). فمهما عدّل ناصر الباقات في لوحته لا يصل متجرَه شيء.
--
-- فالعلاج ليس رقماً جديداً — بل **ربطُه بالباقة**:
--   الكتالوج الحيّ: ١ ⇒ موقع · **٢ ⇒ ٣ مواقع** · ٣ ⇒ ٦ · ٤ ⇒ ١٠ …
--   وهو تماماً ما وصفه: كان على «٣ مواقع» بعد نزوله من «٦».
--
-- ℹ️ والربط **لا يمسّ المال**: قِيس أن `subscription_package_id` لا يقرؤه أي
--    مسار فوترةٍ تلقائي — يكتبه `admin_apply_subscription` و
--    `subscribe_self_to_package` وحدهما (اشتراكٌ صريح). و`subscription_amount`
--    يبقى كما هو بلا لمس.
--
-- 🪤 وخفضُ السقف ٥ ⇒ ٣ يُطلق `freeze_deals_on_downgrade` فيُعيد تجميد ما
--    يتجاوز الثلاثة — وهو **الإنفاذ الصحيح** الذي أبطلتُه بالرفع، لا عطبٌ جديد.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'رُفض: هذا خادم المختبر (طوكيو) — هجرات الإنتاج تُطبَّق على جدة';
  END IF;
END $guard$;

BEGIN;

-- ── ١) الثقب الذي سمح بالانفلات: متجرٌ بلا باقة لا تصله تعديلات اللوحة أبداً
--       ولا شيء يقول ذلك. المزامنة صارت **تعدّ غير المرتبطين وتُسمّيهم**،
--       فيظهر النقص في لوحة المدير بدل أن يبقى صامتاً.
CREATE OR REPLACE FUNCTION public.admin_sync_package_limits()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_caller text; v_role text; v_updated int := 0; v_unbound int := 0; v_names jsonb;
BEGIN
  PERFORM public._admin_require_ctx();
  v_caller := auth.uid()::text;
  SELECT user_type INTO v_role FROM users WHERE id = v_caller;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;

  WITH pkgs AS (
    SELECT (e->>'id')::int AS pid, GREATEST(1, (e->>'max')::int) AS pmax
      FROM jsonb_array_elements(
             (SELECT value FROM platform_settings WHERE key = 'location_packages')) e
     WHERE NULLIF(e->>'id','') IS NOT NULL AND NULLIF(e->>'max','') IS NOT NULL
  ), upd AS (
    UPDATE store_profiles sp
       SET max_branches = p.pmax, updated_at = NOW()
      FROM pkgs p
     WHERE sp.subscription_package_id = p.pid
       AND sp.max_branches IS DISTINCT FROM p.pmax
    RETURNING 1
  )
  SELECT count(*) INTO v_updated FROM upd;

  -- v14.76 — المتاجر التي لا باقة لها: سقفها رقمٌ حرّ لا يتبع اللوحة.
  SELECT count(*), COALESCE(jsonb_agg(jsonb_build_object(
           'store_id', sp.store_id,
           'name', COALESCE(NULLIF(btrim(u.shop),''), u.name),
           'max_branches', sp.max_branches)), '[]'::jsonb)
    INTO v_unbound, v_names
    FROM store_profiles sp
    JOIN users u ON u.id = sp.store_id
   WHERE sp.subscription_package_id IS NULL
     AND u.deleted_at IS NULL;

  RETURN jsonb_build_object('success', true,
                            'stores_updated', COALESCE(v_updated, 0),
                            'stores_unbound', COALESCE(v_unbound, 0),
                            'unbound', v_names);
END $function$;

COMMIT;

-- ── ٢) ربط متجر «تاكي» بالباقة التي وصفها ناصر (٣ مواقع) ───────────────────
-- خطوتان منفصلتان عمداً: الربط أولاً (يُطلق `tg_branch_cap_on_package_change`)
-- ثم مطابقة السقف عبر نفس المنطق الذي تستعمله اللوحة — لا رقماً مكتوباً بيدي.
BEGIN;

UPDATE public.store_profiles
   SET subscription_package_id = 2, updated_at = now()
 WHERE store_id = '2c0b4cde-79c3-4290-abaa-812a895b1bcb'
   AND subscription_package_id IS DISTINCT FROM 2;

UPDATE public.store_profiles sp
   SET max_branches = p.pmax, updated_at = now()
  FROM (
    SELECT (e->>'id')::int AS pid, GREATEST(1, (e->>'max')::int) AS pmax
      FROM jsonb_array_elements(
             (SELECT value FROM platform_settings WHERE key='location_packages')) e
  ) p
 WHERE sp.store_id = '2c0b4cde-79c3-4290-abaa-812a895b1bcb'
   AND sp.subscription_package_id = p.pid
   AND sp.max_branches IS DISTINCT FROM p.pmax;

-- والعرض يعود لاختيار ناصر قبل تدخّلي: «الدمام» كانت مخفيّة، وأنا أظهرتُها
-- في v14.74b لمّا كان السقف ٥. السقف عاد ٣، فيعود اختياره.
UPDATE public.store_branches
   SET show_on_store_page = false, updated_at = now()
 WHERE id = 'br_1784885628.329092242d95'
   AND merchant_id = '2c0b4cde-79c3-4290-abaa-812a895b1bcb';

COMMIT;

-- ── تحقّقٌ يرفع استثناءً ─────────────────────────────────────────────────────
DO $verify$
DECLARE
  v_mid  text := '2c0b4cde-79c3-4290-abaa-812a895b1bcb';
  v_pid  int; v_max int; v_pkgmax int; n int; v_shown int;
BEGIN
  SELECT subscription_package_id, max_branches INTO v_pid, v_max
    FROM public.store_profiles WHERE store_id = v_mid;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'فشل: المتجر ما زال بلا باقة'; END IF;

  SELECT GREATEST(1, (e->>'max')::int) INTO v_pkgmax
    FROM jsonb_array_elements((SELECT value FROM platform_settings WHERE key='location_packages')) e
   WHERE (e->>'id')::int = v_pid;
  IF v_pkgmax IS NULL THEN RAISE EXCEPTION 'فشل: الباقة % غير موجودة في الكتالوج', v_pid; END IF;
  IF v_max IS DISTINCT FROM v_pkgmax THEN
    RAISE EXCEPTION 'فشل: السقف % لا يطابق حدّ الباقة %', v_max, v_pkgmax;
  END IF;
  IF v_max <> 3 THEN RAISE EXCEPTION 'فشل: السقف % والمنتظَر ٣ (باقة ٣ مواقع)', v_max; END IF;

  -- لا يتجاوز العرضُ السقف
  SELECT count(*) INTO v_shown FROM public.store_branches
   WHERE merchant_id = v_mid AND show_on_store_page;
  IF v_shown > v_max THEN RAISE EXCEPTION 'فشل: الظاهرة % فوق السقف %', v_shown, v_max; END IF;

  -- الرئيسيّ واحدٌ ما زال (إصلاح v14.74 لا يُنقَض بهذا التصحيح)
  SELECT count(*) INTO n FROM public.store_branches
   WHERE merchant_id = v_mid AND COALESCE(is_primary,false) AND COALESCE(is_active,true);
  IF n <> 1 THEN RAISE EXCEPTION 'فشل: المواقع الرئيسية = % (المتوقَّع ١)', n; END IF;

  -- والمزامنة تُبلّغ عن غير المرتبطين
  IF pg_get_functiondef('public.admin_sync_package_limits()'::regprocedure)
       NOT LIKE '%stores_unbound%' THEN
    RAISE EXCEPTION 'فشل: المزامنة لا تُبلّغ عن المتاجر غير المرتبطة';
  END IF;
END $verify$;

SELECT 'v14.76' AS "الهجرة",
       (SELECT subscription_package_id FROM store_profiles WHERE store_id='2c0b4cde-79c3-4290-abaa-812a895b1bcb') AS "الباقة",
       (SELECT max_branches FROM store_profiles WHERE store_id='2c0b4cde-79c3-4290-abaa-812a895b1bcb') AS "السقف",
       (SELECT count(*) FROM deals WHERE store_id='2c0b4cde-79c3-4290-abaa-812a895b1bcb' AND status='active') AS "عروض نشطة",
       (SELECT count(*) FROM deals WHERE store_id='2c0b4cde-79c3-4290-abaa-812a895b1bcb' AND subscription_frozen) AS "مجمّدة",
       (SELECT count(*) FROM store_profiles WHERE subscription_package_id IS NULL) AS "متاجر بلا باقة";
