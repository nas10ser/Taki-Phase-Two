-- ════════════════════════════════════════════════════════════════════════════
-- v14.69 — مسار إعداد مرشد للتاجر الجديد: **مصدر النواقص نفسه، لا مصدرٌ ثانٍ**
-- ════════════════════════════════════════════════════════════════════════════
-- طلب ناصر: «مسار إعداد مرشد للتاجر الجديد». والقاعدة التي تعلّمناها غالياً:
-- شاشةٌ تحسب نواقصها بنفسها تفترق عن الإشعار الذي يذكّر بها. فالمسار يقرأ
-- `merchant_setup_gaps` عينها — تُضاف إليها مفاتيح، ولا يُبنى مصدرٌ ثانٍ.
--
-- 🪤 المفتاحان القديمان (`refund_policy_missing` · `payment_undeclared`) **لم
--    تتغيّر دلالتهما بحرف**: التذكير الأسبوعي (`taki_merchant_setup_reminders`)
--    يقرؤهما بالاسم، وأي تغييرٍ في معناهما يجعله ينبّه متاجر لا ينبغي تنبيهها.
--    و`refund_policy_missing` مشروطة بوجود عروض عمداً (لا تُلام على سياسةٍ
--    لمتجرٍ لا يبيع بعد) — أما المسار فيحتاج حالةً **غير مشروطة** ليبقى عدد
--    خطواته خمساً من أوّل يوم، فله مفتاحه الخاص `refund_set`.
--
-- 🪤 والمفاتيح الجديدة كلّها **بصيغة الإنجاز** (`*_set` / `*_declared`) لا
--    النقص: «أنجزتَ ٣ من ٥» تُقرأ من إيجابٍ لا من نفيٍ مزدوج.
--
-- الخطوات الخمس — كلّها قابلة للإصلاح اليوم من لوحة التاجر، ولكلٍّ أثرٌ يراه
-- المشتري أو يمنع البيع:
--   ١ إقرار طريقة الحساب  ⇐ بدونه ترفض القاعدة كل حجز والعروض تبقى مسوّدات
--   ٢ ساعات العمل         ⇐ بدونها لا يعرف المشتري متى يستلم
--   ٣ سياسة الاسترداد     ⇐ صفحة كل عرضٍ تقول للمشتري إنه لم يُعلنها
--   ٤ الوضع الضريبي       ⇐ يحدّد شكل فاتورة كل طلب
--   ٥ عرضٌ حيّ واحد       ⇐ متجرٌ بلا عرضٍ حيّ لا يظهر لأحد
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
    -- ── المفتاحان القديمان: دلالتهما كما هي حرفياً (يقرؤهما التذكير الأسبوعي)
    'refund_policy_missing', (NULLIF(btrim(COALESCE(sp.refund_policy, '')), '') IS NULL
                              AND EXISTS (SELECT 1 FROM public.deals d WHERE d.store_id = u.id)),
    'payment_undeclared',    (sp.payment_declared_at IS NULL),
    'deals_total',           (SELECT count(*) FROM public.deals d WHERE d.store_id = u.id),
    'deals_live',            (SELECT count(*) FROM public.deals d WHERE d.store_id = u.id AND d.status = 'active'),
    -- ── v14.69 — خطوات المسار المرشد (صيغة الإنجاز) ─────────────────────
    'pay_declared',          (sp.payment_declared_at IS NOT NULL),
    'hours_set',             (u.working_hours IS NOT NULL),
    'refund_set',            (NULLIF(btrim(COALESCE(sp.refund_policy, '')), '') IS NOT NULL),
    'vat_answered',          (sp.vat_status IS NOT NULL),
    'has_live_deal',         (EXISTS (SELECT 1 FROM public.deals d
                                       WHERE d.store_id = u.id AND d.status = 'active'))
  )
  FROM public.users u
  LEFT JOIN public.store_profiles sp ON sp.store_id = u.id
  WHERE u.id = p_store_id AND u.deleted_at IS NULL;
$function$;

COMMIT;

-- ── تحقّقٌ يرفع استثناءً ─────────────────────────────────────────────────────
DO $verify$
DECLARE
  n   int;
  g   jsonb;
  sid text;
  k   text;
BEGIN
  SELECT count(*) INTO n FROM pg_proc
   WHERE proname='merchant_setup_gaps' AND pronamespace='public'::regnamespace;
  IF n <> 1 THEN RAISE EXCEPTION 'فشل: نسخ merchant_setup_gaps = % (نسختان ⇒ نداءٌ ملتبس)', n; END IF;

  -- متجرٌ حقيقيّ: كل المفاتيح موجودة ومن النوع المنطقي المتوقَّع
  SELECT u.id INTO sid FROM public.users u
   WHERE u.user_type IN ('seller','admin') OR NULLIF(btrim(COALESCE(u.shop,'')),'') IS NOT NULL
   ORDER BY u.id LIMIT 1;
  IF sid IS NULL THEN RAISE EXCEPTION 'فشل: لا يوجد تاجرٌ للاختبار'; END IF;
  g := public.merchant_setup_gaps(sid);

  FOREACH k IN ARRAY ARRAY['pay_declared','hours_set','refund_set','vat_answered','has_live_deal'] LOOP
    IF NOT (g ? k) THEN RAISE EXCEPTION 'فشل: المفتاح % غائب', k; END IF;
    IF jsonb_typeof(g->k) <> 'boolean' THEN
      RAISE EXCEPTION 'فشل: المفتاح % ليس منطقياً (%)', k, jsonb_typeof(g->k);
    END IF;
  END LOOP;

  -- المفتاحان القديمان باقيان بنفس الاسم والنوع (وإلا صمت التذكير الأسبوعي)
  IF jsonb_typeof(g->'refund_policy_missing') <> 'boolean'
     OR jsonb_typeof(g->'payment_undeclared') <> 'boolean' THEN
    RAISE EXCEPTION 'فشل: أحد مفتاحَي التذكير الأسبوعي تغيّر';
  END IF;

  -- اتّساق: `pay_declared` نقيض `payment_undeclared` دائماً
  IF (g->>'pay_declared')::boolean = (g->>'payment_undeclared')::boolean THEN
    RAISE EXCEPTION 'فشل: pay_declared و payment_undeclared لا يتناقضان';
  END IF;

  -- اتّساق: `has_live_deal` يطابق عدّاد العروض الحيّة
  IF (g->>'has_live_deal')::boolean <> ((g->>'deals_live')::int > 0) THEN
    RAISE EXCEPTION 'فشل: has_live_deal يخالف deals_live';
  END IF;
END $verify$;

SELECT u.id AS "التاجر",
       (public.merchant_setup_gaps(u.id)->>'pay_declared')  AS "الحساب",
       (public.merchant_setup_gaps(u.id)->>'hours_set')     AS "الساعات",
       (public.merchant_setup_gaps(u.id)->>'refund_set')    AS "الاسترداد",
       (public.merchant_setup_gaps(u.id)->>'vat_answered')  AS "الضريبة",
       (public.merchant_setup_gaps(u.id)->>'has_live_deal') AS "عرض حيّ"
  FROM public.users u
 WHERE u.user_type IN ('seller','admin') OR NULLIF(btrim(COALESCE(u.shop,'')),'') IS NOT NULL
 ORDER BY u.id;
