-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.56 — نطاقات التوصيل تخرج من العلن (كشفه توسيع الفحص الأمني)
-- ════════════════════════════════════════════════════════════════════════════
-- قِيس بمفتاح الزائر العلني على الإنتاج: `GET /rest/v1/store_delivery_zones`
-- يُعيد **صفوفاً حقيقية** — معرّف المتجر، ونوع النطاق، وإحداثياته. السياسة
-- كانت `delivery_zones_select_all | SELECT | true` أي للإنترنت كلّه.
--
-- ولا حاجة لذلك إطلاقاً: المشتري لا يقرأ الجدول أبداً — يمرّ بـ`delivery_quote`
-- وهي **SECURITY DEFINER** فتتجاوز RLS. والقارئ المباشر الوحيد في كل الكود هو
-- `src/components/seller/DeliveryCard.tsx` أي لوحةُ التاجر لصفوفه هو.
-- فالكشف كان زائداً بلا مقابل: خريطةُ تغطية كل تاجر متاحةٌ لمنافسيه.
--
-- 🪤 وسياسات الكتابة الثلاث تبقى كما هي حرفياً — لا تُعاد كتابتها. ودرسُ v14.38
-- قائم: **تُنسخ الأدوار حرفياً**؛ السياسة القديمة `TO public` فتبقى كذلك، لأن
-- قصرَها على `authenticated` يغيّر سلوكاً لم يُطلب تغييره.
--
-- الخادم المستهدف: **جدة (الإنتاج)**. يرفض التنفيذ على مختبر طوكيو.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'TOKYO_LAB_REFUSED: هذه هجرة إنتاج. نفّذها على جدة.';
  END IF;
END
$guard$;

DROP POLICY IF EXISTS delivery_zones_select_all ON public.store_delivery_zones;
CREATE POLICY delivery_zones_select_own ON public.store_delivery_zones
  FOR SELECT TO public
  USING (
    ((SELECT auth.uid())::text = store_id)
    OR (SELECT public.taki_admin_perm('tab_sellers'))
  );

-- ولا حاجة لمنح الزائر SELECT على الجدول بعد اليوم: القراءة الوحيدة المشروعة
-- تأتي من مستخدمٍ موثَّق (التاجر) أو من دالة معرّفة (المشتري عبر delivery_quote).
REVOKE SELECT ON public.store_delivery_zones FROM anon;

DO $verify$
DECLARE n int;
BEGIN
  IF has_table_privilege('anon','public.store_delivery_zones','SELECT') THEN
    RAISE EXCEPTION 'VERIFY: الزائر ما زال يملك حقّ القراءة'; END IF;
  SELECT count(*) INTO n FROM pg_policy WHERE polrelid='public.store_delivery_zones'::regclass;
  IF n <> 4 THEN RAISE EXCEPTION 'VERIFY: عدد السياسات % بدل ٤ — سياسةٌ ضاعت', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.store_delivery_zones'::regclass
                   AND polname='delivery_zones_select_own') THEN
    RAISE EXCEPTION 'VERIFY: سياسة القراءة الجديدة مفقودة'; END IF;
  -- والدالة التي يعتمد عليها المشتري يجب أن تبقى معرّفة وإلا انكسر التوصيل.
  IF NOT (SELECT prosecdef FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
          WHERE ns.nspname='public' AND p.proname='delivery_quote' LIMIT 1) THEN
    RAISE EXCEPTION 'VERIFY: delivery_quote ليست SECURITY DEFINER — المشتري سينكسر'; END IF;
  RAISE NOTICE 'التحقّق مرّ: الزائر محجوب · ٤ سياسات · delivery_quote معرّفة';
END
$verify$;
