-- ════════════════════════════════════════════════════════════════════════════
-- v14.72d — الشاشة تقول أيّ نصفٍ ناقص من بطاقة المتجر
-- ════════════════════════════════════════════════════════════════════════════
-- `profile_set` مفتاحٌ واحد يشترط **الشعار والنبذة معاً**، فالشاشة تقول
-- «متبقّية» ولا تقول أيّهما. والأسوأ: صفحة المتجر تعرض نصّاً تسويقياً جاهزاً
-- (`defaultBio`) حين لا نبذة، فتاجرٌ رفع شعاره وحده **يرى صفحةً تبدو مكتملة**
-- — شعارٌ حاضر ونبذةٌ كاملة — وشريطُ التقدّم يصرّ أنه لم يُنجز. وهذا النوع من
-- التناقض هو ما يجعل التاجر يتوقّف عن تصديق الشريط كلّه.
--
-- 🪤 `profile_set` تبقى كما هي حرفياً (تقرؤها v14.72 في نصّ التذكير الأسبوعي).
--    المفتاحان الجديدان **يصفان** لا يستبدلان.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'رُفض: هذا خادم المختبر (طوكيو) — هجرات الإنتاج تُطبَّق على جدة';
  END IF;
END $guard$;

BEGIN;

CREATE OR REPLACE FUNCTION public.merchant_setup_gaps(p_store_id text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'store_id',              u.id,
    'refund_policy_missing', (NULLIF(btrim(COALESCE(sp.refund_policy, '')), '') IS NULL
                              AND EXISTS (SELECT 1 FROM public.deals d WHERE d.store_id = u.id)),
    'payment_undeclared',    (sp.payment_declared_at IS NULL),
    'deals_total',           (SELECT count(*) FROM public.deals d WHERE d.store_id = u.id),
    'deals_live',            (SELECT count(*) FROM public.deals d WHERE d.store_id = u.id AND d.status = 'active'),
    'pay_declared',          (sp.payment_declared_at IS NOT NULL),
    'hours_set',             (u.working_hours IS NOT NULL),
    'refund_set',            (NULLIF(btrim(COALESCE(sp.refund_policy, '')), '') IS NOT NULL),
    'vat_answered',          (sp.vat_status IS NOT NULL),
    'has_live_deal',         (EXISTS (SELECT 1 FROM public.deals d
                                       WHERE d.store_id = u.id AND d.status = 'active')),
    'profile_set',           (NULLIF(btrim(COALESCE(u.bio, sp.bio, '')), '') IS NOT NULL
                          AND NULLIF(btrim(COALESCE(u.avatar_url, sp.avatar_url, '')), '') IS NOT NULL),
    -- v14.72d — النصفان، ليقول السطرُ على الشاشة أيّهما الناقص بالضبط.
    'bio_set',               (NULLIF(btrim(COALESCE(u.bio, sp.bio, '')), '') IS NOT NULL),
    'avatar_set',            (NULLIF(btrim(COALESCE(u.avatar_url, sp.avatar_url, '')), '') IS NOT NULL)
  )
  FROM public.users u
  LEFT JOIN public.store_profiles sp ON sp.store_id = u.id
  WHERE u.id = p_store_id AND u.deleted_at IS NULL;
$function$;

COMMIT;

DO $verify$
DECLARE g jsonb; sid text; k text;
BEGIN
  SELECT u.id INTO sid FROM public.users u
   WHERE (u.user_type IN ('seller','admin') OR nullif(btrim(coalesce(u.shop,'')),'') IS NOT NULL)
     AND u.deleted_at IS NULL ORDER BY u.id LIMIT 1;
  g := public.merchant_setup_gaps(sid);
  FOREACH k IN ARRAY ARRAY['profile_set','bio_set','avatar_set','pay_declared','hours_set',
                           'refund_set','vat_answered','has_live_deal',
                           'refund_policy_missing','payment_undeclared'] LOOP
    IF NOT (g ? k) THEN RAISE EXCEPTION 'فشل: المفتاح % غائب', k; END IF;
  END LOOP;
  -- اتّساق: `profile_set` = النصفان معاً، دائماً
  IF (g->>'profile_set')::boolean
       <> ((g->>'bio_set')::boolean AND (g->>'avatar_set')::boolean) THEN
    RAISE EXCEPTION 'فشل: profile_set لا تساوي حاصل النصفين';
  END IF;

  -- ويُقاس على الحالات الثلاث داخل كتلةٍ تُلغى
  BEGIN
    PERFORM public.taki_set_store_card(sid, 'نبذة', '');
    g := public.merchant_setup_gaps(sid);
    IF NOT (g->>'bio_set')::boolean OR (g->>'avatar_set')::boolean
       OR (g->>'profile_set')::boolean THEN
      RAISE EXCEPTION 'فشل: نبذةٌ بلا شعار لم تُوصف صحيحاً';
    END IF;
    PERFORM public.taki_set_store_card(sid, '', 'https://api.takisa.net/x/y.jpg');
    g := public.merchant_setup_gaps(sid);
    IF (g->>'bio_set')::boolean OR NOT (g->>'avatar_set')::boolean
       OR (g->>'profile_set')::boolean THEN
      RAISE EXCEPTION 'فشل: شعارٌ بلا نبذة لم يُوصف صحيحاً';
    END IF;
    RAISE EXCEPTION 'ROLLBACK_TEST_OK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_TEST_OK' THEN RAISE; END IF;
  END;
END $verify$;

SELECT left(u.id,8) AS "التاجر",
       (public.merchant_setup_gaps(u.id)->>'avatar_set') AS "شعار",
       (public.merchant_setup_gaps(u.id)->>'bio_set')    AS "نبذة"
  FROM public.users u
 WHERE u.user_type IN ('seller','admin') OR nullif(btrim(coalesce(u.shop,'')),'') IS NOT NULL
 ORDER BY 1;
