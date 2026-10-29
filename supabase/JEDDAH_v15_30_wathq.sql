-- ═══════════════════════════════════════════════════════════════════════════
-- v15.30 — واثق: «هل هذا السجلُّ حقيقيّ؟» بدل «أظنُّه حقيقياً»
-- ═══════════════════════════════════════════════════════════════════════════
-- قرارُ ناصر (٢٩ أكتوبر): «ابدأ بواثق الآن، وانتظر نفاذ لاحقاً».
--
-- 🔴 **وما كشفه القياسُ قبل أن أكتب سطراً، وهو يُبطل نصفَ ورقته:**
--    وزارةُ التجارة تقول حرفياً في بيان النظام الجديد:
--    «إلغاء تاريخ الانتهاء للسجل التجاري، والاكتفاء بالتأكيد السنوي
--     للبيانات، بعد أن كان تاريخ انتهاء السجل محدداً في النظام السابق.»
--    ⇒ **السجلُّ التجاريُّ لم يعد ينتهي.** فنحن نسأل التاجرَ عن «تاريخ
--    انتهاء» لا وجودَ له، وهو إمّا يتركه فارغاً أو يخترعه. والإشارةُ
--    الصحيحة **التأكيدُ السنويّ**: يستحقّ بعد سنةٍ من القيد، ويُقدَّم
--    **قبل ٣٠ يوماً** من استحقاقه — فرقمُ ناصر كان صحيحاً والمعدودُ خاطئاً.
--    (وهذا بالضبط سببُ أن `/status` في واثق تُرجع `confirmationDate` ولا
--     تُرجع تاريخَ انتهاءٍ إطلاقاً — القياسُ فسّر الوثيقة.)
--    ويُشطب السجلُّ بعد **سنةٍ** من تعليقه، لا ٣٠ يوماً كما في النظام السابق.
--
-- 🟢 **والأثرُ الماليّ في صالحنا تماماً:** `GET /status/{id}` سعرُها
--    **٠٫٠٠ ريال** ⇒ مراقبةُ التأكيد السنويّ لكلّ تجّار المنصّة، كلَّ يوم،
--    **بصفر ريال إلى الأبد**. والمدفوعُ وحده: تحويلُ الرقم (٢ ريال، مرّةً
--    لكلّ تاجر) وفحصُ المُلّاك (٥ ريال، وهو **مُطفأٌ** حتى يقرّره ناصر).
--
-- ── حقائقُ واثق المُثبَتة من وثيقتها ومن بوّابتها، لا من الذاكرة ──────────
-- • الترويسةُ اسمُها حرفياً **`apiKey`** — وتعريفُ الأمان في الوثيقة مسمّىً
--   «Authorization» وهو اسمٌ مُضلِّل، فمن يقرأه يكتب الترويسةَ الخاطئة.
-- • الحالةُ تُطابَق **بالمعرّف `id` لا بالاسم**: `/status` تُصيّر المعرّف ١
--   «نشط» وكلُّ بقيّة المسارات تُصيّره «فعال» — ومفتاحُ المخطّط الإنجليزيّ
--   مكتوبٌ `nameEr` (خطأٌ مطبعيّ في وثيقتهم) بينما الأمثلةُ تكتب `nameEn`.
--   ⇒ أيُّ مطابقةٍ نصّيّةٍ تنكسر على أحد الطرفين.
-- • الإنتاجُ يطلب **الرقم الوطنيّ الموحّد (سلسلةُ ٧٠٠)**، ورقمُ السجل
--   العشَريّ لا يصحّ إلّا للسجلّات **المشطوبة**. ⇒ تحويلٌ عند عدم الوجود.
-- • `/owners` **مصفوفةٌ في الجذر** والهويّةُ في `identity.id`؛ ومثالُها
--   المنشور **كائنٌ مفردٌ يخالف مخطّطَها هي** ⇒ القارئُ يقبل الشكلين.
--   (وداخل `/fullinfo` اسمُ المصفوفة `parties` لا `owners` — مصيدةُ نسخ.)
-- • **الاستعلامُ السالب لا يُخصَم** («the negative inquiries are not
--   deducted») ⇒ رقمٌ خاطئٌ من التاجر لا يكلّفنا شيئاً. فالكلفةُ تُحتسب
--   على ٢٠٠ وحدها.
-- • السقفُ **٥ استعلاماتٍ في الثانية** للتجربة والمدفوعة مسبقاً.
-- • والبيئةُ الاختبارية موجودةٌ (`/sandbox/`) خلافاً لما تقوله أسئلتُهم
--   الشائعة — لكنها **لا تحوي `/crNationalNumber` إطلاقاً**، فلا تصلح
--   تمريناً كاملاً على مسار الإنتاج.
--
-- 🔴 **ودرسٌ من داخل هذه الهجرة نفسها، كشفَته كسرةٌ لم تكسر:** كلُّ تأكيدٍ
--    هنا مكتوبٌ بـ`IS DISTINCT FROM` و`IS NOT TRUE` لا بـ`<>` و`NOT`. والسبب
--    أن `(v->>'count')::int <> 1` يصير **NULL** إن غاب المفتاح، و`IF NULL`
--    لا يُنفَّذ — فحارسٌ كتبتُه بـ`<>` **لم يفشل** حين أعطبتُ القارئَ عمداً.
--    وهي نفسُ عائلةِ فخّ `array_length(ARRAY[],1) IS NULL` المسجَّلة هنا.
--
-- 🪤 ولا تُخزَّن هويّةُ أحد: فحصُ المُلّاك يقارن **الأسماء** لا أرقامَ
--    الهويّات، فلا يدخل المنصّةَ رقمُ هويّةٍ واحد. (وحين يُطلب تطابقُ رقم
--    الهويّة فهو قرارٌ منفصل يستلزم سؤال التاجر، ويُسجَّل في الخصوصية.)
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regclass('public.store_verifications') IS NULL THEN
    RAISE EXCEPTION 'جدولُ التوثيق غير موجود — أوقِفت.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'pg_net غير مثبَّت — القاعدةُ لا تستطيع نداء واثق. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_is_system_caller()') IS NULL THEN
    RAISE EXCEPTION 'مميِّزُ المنادي النظاميّ غير موجود — أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_norm(text)') IS NULL THEN
    RAISE EXCEPTION 'مطبِّعُ النصّ العربيّ غير موجود — مطابقةُ أسماء المُلّاك تحتاجه. أوقِفت.';
  END IF;
  IF to_regprocedure('public._taki_urlenc(text)') IS NULL THEN
    RAISE EXCEPTION 'مُرمِّزُ المسار غير موجود (v15.17) — أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_ar_days(integer)') IS NULL THEN
    RAISE EXCEPTION 'جمعُ «يوم» غير موجود (v15.29) — أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) الإعداد — صفٌّ واحد، وبلا سرٍّ فيه
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 لِمَ جدولٌ خاصٌّ لا `platform_settings`؟ لأن ذاك تقرؤه الواجهةُ العامّة
--    عبر قائمةِ سماحٍ في RLS، وحالةُ اشتراكِ واثق وكلفتُه شأنُ الإدارة وحدها.
--    وإدراجُها هناك كان سيُضيف مفتاحاً عامّاً بلا داعٍ (ودرسُ v14.92 أن أي
--    مفتاحٍ جديد يلزمه ثلاثةُ مواضع — فتجنّبُ المفتاح أرخصُ من إضافته).
CREATE TABLE IF NOT EXISTS public.wathq_config (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),
  env             text    NOT NULL DEFAULT 'production'
                          CHECK (env IN ('production', 'sandbox')),
  key_last4       text,
  key_set_at      timestamptz,
  -- فحصُ المُلّاك يكلّف ٥ ريالات للنداء ⇒ **مطفأٌ حتى يقرّره ناصر**
  check_owners    boolean NOT NULL DEFAULT false,
  -- تحويلُ رقم السجل إلى الرقم الوطنيّ يكلّف ٢ ريال، ولا تعمل الميزةُ بدونه
  convert_cr      boolean NOT NULL DEFAULT true,
  -- سقفُ أمانٍ شهريّ بالريال: يتوقّف الطابورُ عند تجاوزه فلا تُستهلك باقةٌ بصمت
  monthly_cap_sar numeric(10,2) NOT NULL DEFAULT 200.00,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.wathq_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.wathq_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wathq_config_admin_read ON public.wathq_config;
CREATE POLICY wathq_config_admin_read ON public.wathq_config
  FOR SELECT TO authenticated
  USING (public.taki_admin_perm('tab_tools')
      OR public.taki_admin_perm('tab_verification'));
-- 🪤 ولا سياسةَ كتابةٍ إطلاقاً: الكتابةُ بدالّةٍ مالكةٍ وحدها، فلا يُلتفّ
--    عليها بـ`PATCH` مباشرٍ على الجدول (درس v14.77).

COMMENT ON TABLE public.wathq_config IS
  'إعدادُ تكامل واثق (v15.30). المفتاحُ نفسه في الخزنة باسم app_secret:wathq_api_key — هنا آخرُ أربعة محارف وحدها.';

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) الوصفُ — بياناتٌ من وثيقة واثق، لا كودٌ لكلّ مسار
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._taki_wathq_cfg()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'env', c.env,
    'base', CASE c.env
              WHEN 'sandbox' THEN 'https://api.wathq.sa/sandbox/commercial-registration'
              ELSE                'https://api.wathq.sa/commercial-registration'
            END,
    'check_owners', c.check_owners,
    'convert_cr',   c.convert_cr,
    'monthly_cap_sar', c.monthly_cap_sar,
    -- 🪤 السقفُ المحليّ ١/ثانية لا ٥: سقفُهم ٥/ثانية، والنبضةُ كلَّ دقيقة
    --    فـ٦٠ نداءً في النبضة تبقى تحت الخُمس. التوفيرُ هنا ليس بخلاً بل
    --    فسحةٌ لأن السقفَ مشتركٌ مع أيّ نداءٍ آخر للمنصّة.
    'per_run_cap', 60,
    'endpoints', jsonb_build_object(
      'status', jsonb_build_object(
        'path', '/status/{id}', 'price', 0.00,
        'query', 'includeDates=true&language=ar'),
      'crnational', jsonb_build_object(
        'path', '/crNationalNumber/{id}', 'price', 2.00, 'query', ''),
      'owners', jsonb_build_object(
        'path', '/owners/{id}', 'price', 5.00, 'query', 'language=ar')
    ))
  FROM public.wathq_config c WHERE c.id;
$fn$;

COMMENT ON FUNCTION public._taki_wathq_cfg() IS
  'وصفُ مسارات واثق وأسعارُها كما نُشرت في بوّابتها (v15.30). status مجّانيّ ⇒ مراقبةُ التأكيد السنويّ بصفر ريال.';

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) المفتاح — في الخزنة بالاسم، وكلُّ كتابةٍ تُثبَت بقراءة
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._taki_wathq_key()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT s.decrypted_secret FROM vault.decrypted_secrets s
   WHERE s.name = 'app_secret:wathq_api_key' LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION public._taki_wathq_key() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._taki_wathq_key() FROM anon;
REVOKE ALL ON FUNCTION public._taki_wathq_key() FROM authenticated;

DROP FUNCTION IF EXISTS public.admin_set_wathq_key(text, text);
CREATE FUNCTION public.admin_set_wathq_key(p_key text, p_env text DEFAULT 'production')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_k text; v_back text;
BEGIN
  IF NOT public.taki_admin_perm('tab_tools') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;
  v_k := btrim(COALESCE(p_key, ''));
  IF length(v_k) < 16 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'KEY_TOO_SHORT');
  END IF;
  IF p_env NOT IN ('production', 'sandbox') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_ENV');
  END IF;

  -- 🪤 الاسمُ فريدٌ في الخزنة، فالإنشاءُ الأعمى باسمٍ موجودٍ يفشل.
  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'app_secret:wathq_api_key') THEN
    PERFORM vault.update_secret(
      (SELECT id FROM vault.secrets WHERE name = 'app_secret:wathq_api_key'),
      v_k, 'app_secret:wathq_api_key', 'مفتاحُ واثق (v15.30)');
  ELSE
    PERFORM vault.create_secret(v_k, 'app_secret:wathq_api_key', 'مفتاحُ واثق (v15.30)');
  END IF;

  -- 🔴 الإثباتُ بالقراءة: `vault.update_secret` على مؤشّرٍ ميت تكتب صفرَ
  --    صفوفٍ **بلا استثناء**، فالحفظُ يبدو ناجحاً وهو وهم (درس v14.44).
  v_back := public._taki_wathq_key();
  IF v_back IS DISTINCT FROM v_k THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECRET_WRITE_FAILED');
  END IF;

  UPDATE public.wathq_config
     SET env = p_env, key_last4 = right(v_k, 4),
         key_set_at = now(), updated_at = now()
   WHERE id;

  RETURN jsonb_build_object('ok', true, 'env', p_env, 'last4', right(v_k, 4));
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_set_wathq_key(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_wathq_key(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_wathq_key(text, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) سجلُّ الفحوص — طابورٌ ودليلٌ في جدولٍ واحد
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 ولِمَ لا جدولُ طابورٍ منفصلٌ عن جدولِ نتائج؟ لأن المراجعَ يحتاج أن يرى
--    **المحاولةَ الفاشلة** كما يرى الناجحة: «واثق لم تردّ» معلومةٌ تغيّر قراره،
--    وحذفُ الصفّ عند النجاح كان سيُخفي الكلفةَ المدفوعة أيضاً.
CREATE TABLE IF NOT EXISTS public.store_verification_checks (
  id            bigserial PRIMARY KEY,
  ver_id        text        NOT NULL REFERENCES public.store_verifications(id) ON DELETE CASCADE,
  kind          text        NOT NULL CHECK (kind IN ('status', 'crnational', 'owners')),
  -- الرقمُ المُستعلَم عنه فعلاً (قد يكون المحوَّل لا ما كتبه التاجر)
  arg           text        NOT NULL,
  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'awaiting', 'done', 'failed', 'skipped')),
  attempts      int         NOT NULL DEFAULT 0,
  due_at        timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  request_id    bigint,
  http_status   int,
  -- 🔴 الكلفةُ تُسجَّل عند ٢٠٠ وحدها: «الاستعلامُ السالب لا يُخصَم» بنصّ واثق.
  cost_sar      numeric(8,2) NOT NULL DEFAULT 0,
  result        jsonb,
  last_error    text,
  done_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wathq_pending ON public.store_verification_checks (due_at, id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_wathq_awaiting ON public.store_verification_checks (sent_at, id)
  WHERE status = 'awaiting';
CREATE INDEX IF NOT EXISTS idx_wathq_ver ON public.store_verification_checks (ver_id, created_at DESC);
-- 🪤 ولا يُستعلَم مرّتان عن نفس الشيء في نفس اللحظة: الدمجُ بمفتاحٍ جزئيّ.
CREATE UNIQUE INDEX IF NOT EXISTS ux_wathq_one_pending
  ON public.store_verification_checks (ver_id, kind, arg)
  WHERE status IN ('pending', 'awaiting');

ALTER TABLE public.store_verification_checks ENABLE ROW LEVEL SECURITY;
-- 🪤 لا سياسةَ قراءةٍ للتاجر: اسمُ المالك من السجل التجاريّ بيانٌ لا يخصّ
--    صاحبَ المتجر غيرَه. المراجعُ يقرأ عبر دالّةٍ مالكة.
DROP POLICY IF EXISTS wathq_checks_admin_read ON public.store_verification_checks;
CREATE POLICY wathq_checks_admin_read ON public.store_verification_checks
  FOR SELECT TO authenticated
  USING (public.taki_admin_perm('tab_verification'));

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) حالةُ السجل على صفّ التوثيق — ما يُقرأ في الشاشة وفي الكرون
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.store_verifications
  ADD COLUMN IF NOT EXISTS registry_state   jsonb,
  ADD COLUMN IF NOT EXISTS registry_at      timestamptz,
  ADD COLUMN IF NOT EXISTS cr_national      text,
  ADD COLUMN IF NOT EXISTS confirmation_due date;

COMMENT ON COLUMN public.store_verifications.registry_state IS
  'خلاصةُ ما قالته واثق: status_id · status_name · legal_name · dates · owner_names · match (v15.30). بياناتٌ للعرض لا للحكم الآليّ.';
COMMENT ON COLUMN public.store_verifications.cr_national IS
  'الرقمُ الوطنيّ الموحّد (سلسلةُ ٧٠٠) — الإنتاجُ في واثق لا يقبل رقمَ السجل العشَريّ للسجلّات السارية.';
COMMENT ON COLUMN public.store_verifications.confirmation_due IS
  '🔴 استحقاقُ **التأكيد السنويّ** لا تاريخَ انتهاء: النظامُ الجديد ألغى انتهاءَ السجل التجاريّ (بيانُ وزارة التجارة). يُشتقّ من confirmationDate + سنة.';

-- ═══════════════════════════════════════════════════════════════════════════
-- ٦) قارئاتُ الردّ — كلُّ مصيدةٍ في وثيقتهم مكتوبةٌ هنا صراحةً
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 المطابقةُ بالمعرّف لا بالاسم. و١ = سارٍ بإجماع كلّ المسارات، لكنّ
--    التسميةَ تختلف («نشط» في `/status` و«فعال» في الباقي) ⇒ نحفظ الاسمَ
--    للعرض ونحكم بالمعرّف.
CREATE OR REPLACE FUNCTION public._taki_wathq_status_ok(p_id int)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$ SELECT p_id = 1; $fn$;

CREATE OR REPLACE FUNCTION public._taki_wathq_parse_status(p_body jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_sid int; v_name text; v_conf text; v_due date;
BEGIN
  IF p_body IS NULL OR jsonb_typeof(p_body) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'why', 'BODY_NOT_OBJECT');
  END IF;

  -- 🪤 المعرّفُ قد يأتي عدداً أو نصّاً حسب المسار — يُقرأ نصّاً ثمّ يُحوَّل.
  BEGIN v_sid := (p_body->>'id')::int; EXCEPTION WHEN OTHERS THEN v_sid := NULL; END;
  v_name := COALESCE(p_body->>'name', p_body->>'nameAr');

  -- التواريخُ كائناتٌ {gregorian, hijri} حين يُطلب includeDates=true.
  -- 🔴 ولا نقرأ الهجريّ إطلاقاً: نسختا الوثيقة تنشران ترتيبين متعاكسين
  --    لنفس الحقل (الإنتاج `1423-07-28` والاختبار `28-07-1423`)، فتحليلُه
  --    تخمينُ ترتيب. والميلاديُّ وحده كافٍ.
  v_conf := COALESCE(p_body#>>'{confirmationDate,gregorian}',
                     p_body#>>'{reactivationDate,gregorian}');
  BEGIN
    IF v_conf IS NOT NULL THEN v_due := (v_conf::date) + interval '1 year'; END IF;
  EXCEPTION WHEN OTHERS THEN v_due := NULL;
  END;

  RETURN jsonb_build_object(
    'ok', v_sid IS NOT NULL,
    'status_id',   v_sid,
    'status_name', v_name,
    'active',      public._taki_wathq_status_ok(v_sid),
    'confirmation_date', v_conf,
    'confirmation_due',  v_due,
    'suspension_date', p_body#>>'{suspensionDate,gregorian}',
    'deletion_date',   p_body#>>'{deletionDate,gregorian}');
END
$fn$;

CREATE OR REPLACE FUNCTION public._taki_wathq_parse_crnational(p_body jsonb)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v text;
BEGIN
  IF p_body IS NULL THEN RETURN NULL; END IF;
  -- الردُّ قد يكون كائناً بمفتاحٍ أو نصّاً مجرّداً — كلاهما يُقبل.
  IF jsonb_typeof(p_body) = 'string' THEN
    v := p_body #>> '{}';
  ELSE
    v := COALESCE(p_body->>'crNationalNumber', p_body->>'id',
                  p_body->>'nationalNumber', p_body->>'entityNumber');
  END IF;
  IF v IS NULL OR v !~ '^[0-9]{6,15}$' THEN RETURN NULL; END IF;
  RETURN v;
END
$fn$;

-- 🔴 `/owners` **مصفوفةٌ في الجذر**، والهويّةُ في `identity.id`. ومثالُها
--    المنشور كائنٌ مفردٌ يخالف مخطّطَها — فالقارئُ يلفُّ المفردَ في مصفوفة.
--    وداخل `/fullinfo` اسمُ المصفوفة `parties` ⇒ يُقبل أيضاً لئلّا ينكسر
--    القارئُ إن استُعمل المسارُ الأغلى يوماً.
CREATE OR REPLACE FUNCTION public._taki_wathq_parse_owners(p_body jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_arr jsonb; v_names text[] := '{}'; v_el jsonb; v_n text;
BEGIN
  IF p_body IS NULL THEN RETURN jsonb_build_object('ok', false, 'why', 'NO_BODY'); END IF;

  IF jsonb_typeof(p_body) = 'array' THEN
    v_arr := p_body;
  ELSIF jsonb_typeof(p_body) = 'object' AND jsonb_typeof(p_body->'parties') = 'array' THEN
    v_arr := p_body->'parties';
  ELSIF jsonb_typeof(p_body) = 'object' AND jsonb_typeof(p_body->'owners') = 'array' THEN
    v_arr := p_body->'owners';
  ELSIF jsonb_typeof(p_body) = 'object' THEN
    v_arr := jsonb_build_array(p_body);          -- مثالُهم المفرد
  ELSE
    RETURN jsonb_build_object('ok', false, 'why', 'SHAPE_UNKNOWN');
  END IF;

  FOR v_el IN SELECT * FROM jsonb_array_elements(v_arr) LOOP
    v_n := COALESCE(v_el->>'name', v_el#>>'{identity,name}');
    IF v_n IS NOT NULL AND btrim(v_n) <> '' THEN
      v_names := v_names || btrim(v_n);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'count', jsonb_array_length(v_arr),
                            'names', to_jsonb(v_names));
END
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٧) الإدراج في الطابور
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._taki_wathq_enqueue(
  p_ver_id text, p_kind text, p_arg text, p_due timestamptz DEFAULT now())
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_id bigint;
BEGIN
  IF p_arg IS NULL OR btrim(p_arg) = '' THEN RETURN NULL; END IF;
  INSERT INTO public.store_verification_checks (ver_id, kind, arg, due_at)
  VALUES (p_ver_id, p_kind, btrim(p_arg), p_due)
  ON CONFLICT (ver_id, kind, arg) WHERE status IN ('pending', 'awaiting')
  DO UPDATE SET due_at = LEAST(store_verification_checks.due_at, EXCLUDED.due_at)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$fn$;

-- يُدرَج تلقائياً عند وصول طلب توثيقٍ بسجلٍّ تجاريّ — ولا شيء للأنواع الأخرى
-- (وثيقةُ العمل الحر ومنصّةُ الأعمال لا واجهةَ لهما، وقد قِيس ذلك).
CREATE OR REPLACE FUNCTION public.tr_wathq_on_submit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.doc_kind = 'cr' AND NEW.status = 'submitted'
     AND public._taki_wathq_key() IS NOT NULL THEN
    PERFORM public._taki_wathq_enqueue(NEW.id, 'status', NEW.doc_number);
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS tr_wathq_on_submit ON public.store_verifications;
CREATE TRIGGER tr_wathq_on_submit
  AFTER INSERT ON public.store_verifications
  FOR EACH ROW EXECUTE FUNCTION public.tr_wathq_on_submit();

-- ═══════════════════════════════════════════════════════════════════════════
-- ٨) الشطرُ الأوّل — يحجز ويُرسل
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 `pg_net` غيرُ متزامن، فالعاملُ شطران كما في مزامنة المخزون. ولا يُنادى
--    من داخل طلب التاجر إطلاقاً: انقطاعُ واثق لا يجوز أن يمنع إرسال طلبه.
DROP FUNCTION IF EXISTS public.taki_wathq_dispatch(int);
CREATE FUNCTION public.taki_wathq_dispatch(p_cap int DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cfg jsonb; v_key text; v_row record; v_ep jsonb; v_url text; v_req bigint;
  v_cap int; v_spent numeric; v_sent int := 0; v_fail int := 0;
BEGIN
  v_cfg := public._taki_wathq_cfg();
  v_key := public._taki_wathq_key();
  IF v_key IS NULL THEN
    -- 🪤 ولا تُوسَم الصفوفُ فاشلةً: الاشتراكُ قد يأتي غداً، والطابورُ ينتظر.
    RETURN jsonb_build_object('sent', 0, 'skipped', 'NO_KEY');
  END IF;

  -- 🔴 سقفُ أمانٍ شهريّ: باقةُ واثق رصيدٌ يُستهلك، وخطأٌ في حلقةٍ قد يحرقه
  --    في ساعة. فالطابورُ يتوقّف — ولا يفشل — عند تجاوز السقف.
  SELECT COALESCE(sum(cost_sar), 0) INTO v_spent
    FROM public.store_verification_checks
   WHERE done_at >= date_trunc('month', now());
  IF v_spent >= (v_cfg->>'monthly_cap_sar')::numeric THEN
    RETURN jsonb_build_object('sent', 0, 'skipped', 'MONTHLY_CAP', 'spent', v_spent);
  END IF;

  v_cap := GREATEST(COALESCE(p_cap, (v_cfg->>'per_run_cap')::int, 60), 1);

  FOR v_row IN
    SELECT c.id, c.kind, c.arg
      FROM public.store_verification_checks c
     WHERE c.status = 'pending' AND c.due_at <= now()
     ORDER BY c.due_at, c.id
     LIMIT v_cap
  LOOP
    v_ep := v_cfg->'endpoints'->v_row.kind;
    IF v_ep IS NULL THEN
      UPDATE public.store_verification_checks
         SET status = 'failed', last_error = 'NO_DESCRIPTOR', done_at = now()
       WHERE id = v_row.id;
      v_fail := v_fail + 1; CONTINUE;
    END IF;

    -- الحجزُ قبل الإرسال، و`request_id IS NULL` علامةُ «حُجز ولم يُرسل».
    UPDATE public.store_verification_checks
       SET status = 'awaiting', request_id = NULL, sent_at = now(), attempts = attempts + 1
     WHERE id = v_row.id AND status = 'pending';
    IF NOT FOUND THEN CONTINUE; END IF;

    v_url := (v_cfg->>'base')
          || replace(v_ep->>'path', '{id}', public._taki_urlenc(v_row.arg))
          || CASE WHEN COALESCE(v_ep->>'query', '') = '' THEN ''
                  ELSE '?' || (v_ep->>'query') END;

    BEGIN
      -- 🔴 الترويسةُ اسمُها حرفياً `apiKey` — وتعريفُ الأمان في وثيقتهم
      --    مسمّىً «Authorization» وهو اسمٌ مُضلِّل لا ترويسة.
      v_req := net.http_get(
        url := v_url,
        headers := jsonb_build_object('apiKey', v_key, 'Accept', 'application/json'),
        timeout_milliseconds := 12000);
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.store_verification_checks
         SET status = 'pending', last_error = 'DISPATCH:' || left(SQLERRM, 120),
             due_at = now() + make_interval(secs => (60 * power(2, LEAST(attempts, 5)))::int)
       WHERE id = v_row.id;
      v_fail := v_fail + 1; CONTINUE;
    END;

    UPDATE public.store_verification_checks SET request_id = v_req WHERE id = v_row.id;
    v_sent := v_sent + 1;
  END LOOP;

  RETURN jsonb_build_object('sent', v_sent, 'failed', v_fail, 'spent_this_month', v_spent);
END
$fn$;
REVOKE ALL ON FUNCTION public.taki_wathq_dispatch(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_wathq_dispatch(int) FROM anon;
REVOKE ALL ON FUNCTION public.taki_wathq_dispatch(int) FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٩) الشطرُ الثاني — يجمع، يحلّل، ويُسلسل الخطوةَ التالية
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.taki_wathq_collect(int);
CREATE FUNCTION public.taki_wathq_collect(p_cap int DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row record; v_resp record; v_body jsonb; v_p jsonb; v_cfg jsonb;
  v_price numeric; v_nat text; v_ver record; v_names text[]; v_match boolean;
  v_ok int := 0; v_retry int := 0; v_dead int := 0; v_wait int := 0;
  MAX_TRIES constant int := 5;
BEGIN
  v_cfg := public._taki_wathq_cfg();

  FOR v_row IN
    SELECT c.* FROM public.store_verification_checks c
     WHERE c.status = 'awaiting'
     ORDER BY c.sent_at NULLS FIRST, c.id
     LIMIT GREATEST(COALESCE(p_cap, 200), 1)
  LOOP
    -- (أ) حُجز ولم يُرسل
    IF v_row.request_id IS NULL THEN
      IF v_row.sent_at < now() - interval '3 minutes' THEN
        UPDATE public.store_verification_checks
           SET status = CASE WHEN attempts >= MAX_TRIES THEN 'failed' ELSE 'pending' END,
               last_error = 'CLAIMED_NOT_SENT',
               done_at = CASE WHEN attempts >= MAX_TRIES THEN now() END,
               due_at = now() + make_interval(secs => (60 * power(2, LEAST(attempts, 5)))::int)
         WHERE id = v_row.id;
        v_retry := v_retry + 1;
      ELSE v_wait := v_wait + 1; END IF;
      CONTINUE;
    END IF;

    SELECT * INTO v_resp FROM net._http_response WHERE id = v_row.request_id;

    -- (ب) لم يهبط بعد — أو ضاع
    IF NOT FOUND THEN
      IF v_row.sent_at < now() - interval '5 minutes' THEN
        UPDATE public.store_verification_checks
           SET status = CASE WHEN attempts >= MAX_TRIES THEN 'failed' ELSE 'pending' END,
               last_error = 'RESPONSE_LOST',
               done_at = CASE WHEN attempts >= MAX_TRIES THEN now() END,
               due_at = now() + make_interval(secs => (60 * power(2, LEAST(attempts, 5)))::int)
         WHERE id = v_row.id;
        v_retry := v_retry + 1;
      ELSE v_wait := v_wait + 1; END IF;
      CONTINUE;
    END IF;

    -- (ج) شبكةٌ أو مهلة
    IF COALESCE(v_resp.timed_out, false) OR v_resp.error_msg IS NOT NULL THEN
      UPDATE public.store_verification_checks
         SET status = CASE WHEN attempts >= MAX_TRIES THEN 'failed' ELSE 'pending' END,
             last_error = 'NET:' || left(COALESCE(v_resp.error_msg, 'TIMEOUT'), 120),
             http_status = v_resp.status_code,
             done_at = CASE WHEN attempts >= MAX_TRIES THEN now() END,
             due_at = now() + make_interval(secs => (60 * power(2, LEAST(attempts, 5)))::int)
       WHERE id = v_row.id;
      v_retry := v_retry + 1; CONTINUE;
    END IF;

    -- (د) ٤٢٩ — لا يُستهلك رصيدُ المحاولات، والسقفُ ٥/ثانية فالتأجيلُ قصير
    IF v_resp.status_code = 429 THEN
      UPDATE public.store_verification_checks
         SET status = 'pending', http_status = 429, last_error = 'RATE_LIMITED',
             attempts = GREATEST(attempts - 1, 0), due_at = now() + interval '60 seconds'
       WHERE id = v_row.id;
      v_retry := v_retry + 1; CONTINUE;
    END IF;

    -- (هـ) مفتاحٌ مرفوض أو رصيدٌ نافد — لا يُعاد بغبائه، ويُنبَّه الأدمن مرّةً
    IF v_resp.status_code IN (401, 403) THEN
      UPDATE public.store_verification_checks
         SET status = 'failed', http_status = v_resp.status_code,
             last_error = 'KEY_REJECTED', done_at = now()
       WHERE id = v_row.id;
      v_dead := v_dead + 1;
      -- 🪤 ولا يُغرَق الأدمن: إشعارٌ واحد كلَّ ١٢ ساعة على الأكثر.
      IF NOT EXISTS (SELECT 1 FROM public.notifications
                      WHERE meta_data->>'code' = 'WATHQ_KEY_REJECTED'
                        AND created_at > now() - interval '12 hours') THEN
        INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
        SELECT u.id, '⚠️ واثق ترفض المفتاح', '⚠️ Wathq rejected the key',
               'ترفض واثق مفتاحَنا (أو نفد رصيدُ الباقة) — فحصُ السجلّات التجارية موقوفٌ حتى يُحدَّث المفتاح.',
               'Wathq rejected our key (or the balance ran out) — commercial-registration checks are paused.',
               'system',
               jsonb_build_object('audience', 'admin', 'code', 'WATHQ_KEY_REJECTED',
                                  'actionUrl', '/admin', 'action_url', '/admin')
          FROM public.users u WHERE u.user_type = 'admin';
      END IF;
      CONTINUE;
    END IF;

    -- (و) ٤٠٤ / ٤٠٠ — رقمٌ غير موجود. **لا يُخصَم** (نصُّ واثق)، فالكلفةُ صفر.
    --     وهنا تقع الخطوةُ الذكيّة: الإنتاجُ لا يقبل رقمَ السجل العشَريّ
    --     للسجلّات السارية، فيُحوَّل مرّةً واحدةً ثمّ يُعاد السؤال.
    IF v_resp.status_code IN (400, 404) THEN
      UPDATE public.store_verification_checks
         SET status = 'done', http_status = v_resp.status_code,
             last_error = 'NOT_FOUND', cost_sar = 0, done_at = now(),
             result = jsonb_build_object('not_found', true)
       WHERE id = v_row.id;

      IF v_row.kind = 'status'
         AND (v_cfg->>'convert_cr')::boolean
         AND v_row.arg ~ '^[0-9]{10}$' AND left(v_row.arg, 1) <> '7'
         AND NOT EXISTS (SELECT 1 FROM public.store_verification_checks
                          WHERE ver_id = v_row.ver_id AND kind = 'crnational') THEN
        PERFORM public._taki_wathq_enqueue(v_row.ver_id, 'crnational', v_row.arg);
      ELSE
        UPDATE public.store_verifications
           SET registry_state = jsonb_build_object('found', false, 'asked', v_row.arg),
               registry_at = now()
         WHERE id = v_row.ver_id;
      END IF;
      v_ok := v_ok + 1; CONTINUE;
    END IF;

    IF v_resp.status_code < 200 OR v_resp.status_code >= 300 THEN
      UPDATE public.store_verification_checks
         SET status = CASE WHEN attempts >= MAX_TRIES THEN 'failed' ELSE 'pending' END,
             http_status = v_resp.status_code, last_error = 'HTTP_' || v_resp.status_code,
             done_at = CASE WHEN attempts >= MAX_TRIES THEN now() END,
             due_at = now() + make_interval(secs => (60 * power(2, LEAST(attempts, 5)))::int)
       WHERE id = v_row.id;
      v_retry := v_retry + 1; CONTINUE;
    END IF;

    -- ── ٢٠٠: هنا وحدها تُحتسب الكلفة ───────────────────────────────────
    BEGIN v_body := v_resp.content::jsonb;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.store_verification_checks
         SET status = 'failed', http_status = 200, last_error = 'BODY_NOT_JSON', done_at = now()
       WHERE id = v_row.id;
      v_dead := v_dead + 1; CONTINUE;
    END;

    v_price := COALESCE((v_cfg->'endpoints'->v_row.kind->>'price')::numeric, 0);
    SELECT * INTO v_ver FROM public.store_verifications WHERE id = v_row.ver_id;

    IF v_row.kind = 'status' THEN
      v_p := public._taki_wathq_parse_status(v_body);
      UPDATE public.store_verification_checks
         SET status = 'done', http_status = 200, cost_sar = v_price,
             result = v_p, done_at = now() WHERE id = v_row.id;

      UPDATE public.store_verifications
         SET registry_state = COALESCE(registry_state, '{}'::jsonb)
                              || jsonb_build_object('found', true)
                              || v_p
                              || jsonb_build_object('asked', v_row.arg),
             registry_at = now(),
             cr_national = CASE WHEN v_row.arg ~ '^7[0-9]{9}$' THEN v_row.arg ELSE cr_national END,
             confirmation_due = COALESCE((v_p->>'confirmation_due')::date, confirmation_due)
       WHERE id = v_row.ver_id;

      -- سلسلةُ المُلّاك — مُطفأةٌ افتراضاً لأنها مدفوعة
      IF (v_cfg->>'check_owners')::boolean AND (v_p->>'active')::boolean THEN
        PERFORM public._taki_wathq_enqueue(v_row.ver_id, 'owners', v_row.arg);
      END IF;
      v_ok := v_ok + 1;

    ELSIF v_row.kind = 'crnational' THEN
      v_nat := public._taki_wathq_parse_crnational(v_body);
      UPDATE public.store_verification_checks
         SET status = 'done', http_status = 200, cost_sar = v_price,
             result = jsonb_build_object('cr_national', v_nat), done_at = now()
       WHERE id = v_row.id;
      IF v_nat IS NOT NULL THEN
        UPDATE public.store_verifications SET cr_national = v_nat WHERE id = v_row.ver_id;
        PERFORM public._taki_wathq_enqueue(v_row.ver_id, 'status', v_nat);
      ELSE
        UPDATE public.store_verifications
           SET registry_state = jsonb_build_object('found', false, 'why', 'NO_NATIONAL_NUMBER'),
               registry_at = now()
         WHERE id = v_row.ver_id;
      END IF;
      v_ok := v_ok + 1;

    ELSE  -- owners
      v_p := public._taki_wathq_parse_owners(v_body);
      SELECT array_agg(x) INTO v_names
        FROM jsonb_array_elements_text(COALESCE(v_p->'names', '[]'::jsonb)) x;
      -- 🪤 المطابقةُ **تُحسب ولا تحكم**: تطابقُ الأسماء العربية بالتطبيع
      --    وحده يُخطئ في كلا الاتجاهين، فالقرارُ للمراجع والرقمُ معلومةٌ له.
      v_match := EXISTS (
        SELECT 1 FROM unnest(COALESCE(v_names, '{}')) n
         WHERE public.taki_norm(n) = public.taki_norm(COALESCE(v_ver.legal_name, v_ver.claimed_name, '')));
      UPDATE public.store_verification_checks
         SET status = 'done', http_status = 200, cost_sar = v_price,
             result = v_p || jsonb_build_object('name_match', v_match), done_at = now()
       WHERE id = v_row.id;
      UPDATE public.store_verifications
         SET registry_state = COALESCE(registry_state, '{}'::jsonb)
                              || jsonb_build_object('owner_names', COALESCE(v_p->'names', '[]'::jsonb),
                                                    'owner_name_match', v_match),
             registry_at = now()
       WHERE id = v_row.ver_id;
      v_ok := v_ok + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('done', v_ok, 'retried', v_retry, 'dead', v_dead, 'waiting', v_wait);
END
$fn$;
REVOKE ALL ON FUNCTION public.taki_wathq_collect(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_wathq_collect(int) FROM anon;
REVOKE ALL ON FUNCTION public.taki_wathq_collect(int) FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١٠) التأكيدُ السنويّ — الإشارةُ الصحيحة، ومراقبتُها بصفر ريال
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 ألغى النظامُ الجديد تاريخَ انتهاء السجل التجاريّ، فالمراقَبُ هو
--    **التأكيدُ السنويّ**. و`GET /status` سعرُها ٠٫٠٠ ⇒ إعادةُ السؤال عن
--    كلّ متجرٍ موثَّقٍ **مجّانيّةٌ تماماً**، فلا داعيَ للبخل في تكرارها.
--    وتُعاد كلَّ سبعة أيّام: تغيّرُ حالةِ سجلٍّ حدثٌ نادر، والتعليقُ لا
--    يُشطب إلّا بعد سنة — فأسبوعٌ كشفٌ وفيرٌ بلا ضجيج.
ALTER TABLE public.store_verifications
  ADD COLUMN IF NOT EXISTS warn_stage_conf smallint NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.store_verifications.warn_stage_conf IS
  'علامةُ تنبيه التأكيد السنويّ: ٠ لا شيء · ١ عند ٣٠ يوماً · ٢ عند ٧ (v15.30).';

-- وتُصفَّر إن تحرّك تاريخُ الاستحقاق (أي أن التاجر أكّد فعلاً).
CREATE OR REPLACE FUNCTION public.tr_reset_verification_warn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.doc_expiry IS DISTINCT FROM OLD.doc_expiry THEN
    NEW.warn_stage := 0;
  END IF;
  IF NEW.confirmation_due IS DISTINCT FROM OLD.confirmation_due THEN
    NEW.warn_stage_conf := 0;
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS tr_reset_verification_warn ON public.store_verifications;
CREATE TRIGGER tr_reset_verification_warn
  BEFORE UPDATE OF doc_expiry, confirmation_due ON public.store_verifications
  FOR EACH ROW EXECUTE FUNCTION public.tr_reset_verification_warn();

DROP FUNCTION IF EXISTS public.taki_wathq_confirmation_sweep();
CREATE FUNCTION public.taki_wathq_confirmation_sweep()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_q int := 0; v_w int := 0; v_row record; v_msg text; v_left int; v_stage smallint;
BEGIN
  -- (أ) إعادةُ السؤال المجّانيّة لكلّ سجلٍّ موثَّقٍ لم يُسأل عنه منذ أسبوع
  IF public._taki_wathq_key() IS NOT NULL THEN
    FOR v_row IN
      SELECT v.id, COALESCE(v.cr_national, v.doc_number) AS num
        FROM public.store_verifications v
       WHERE v.status = 'approved' AND v.doc_kind = 'cr'
         AND (v.registry_at IS NULL OR v.registry_at < now() - interval '7 days')
       ORDER BY v.registry_at NULLS FIRST
       LIMIT 200
    LOOP
      IF public._taki_wathq_enqueue(v_row.id, 'status', v_row.num) IS NOT NULL THEN
        v_q := v_q + 1;
      END IF;
    END LOOP;
  END IF;

  -- (ب) تنبيهُ التأكيد السنويّ — بالمدى وعلامةٍ، كدرس v15.29
  FOR v_row IN
    SELECT id, store_id, (confirmation_due - current_date)::int AS days_left, warn_stage_conf
      FROM public.store_verifications
     WHERE status = 'approved' AND confirmation_due IS NOT NULL
       AND confirmation_due >= current_date
       AND (confirmation_due - current_date) <= 30
       AND warn_stage_conf < 2
     ORDER BY confirmation_due
  LOOP
    v_stage := CASE WHEN v_row.days_left <= 7 THEN 2 ELSE 1 END;
    CONTINUE WHEN v_stage <= v_row.warn_stage_conf;
    v_left := GREATEST(v_row.days_left, 0);
    -- 🪤 ولا يُكتب العددُ نصّاً: يُصاغ من الباقي الحقيقي.
    v_msg := 'ℹ️ يستحقّ **التأكيد السنويّ** لبيانات سجلك التجاري خلال '
          || public.taki_ar_days(v_left)
          || '. أكّده من منصّة المركز السعودي للأعمال — ولا يلزمك تجديدُ السجل، فالنظامُ الجديد ألغى تاريخَ الانتهاء.';
    INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
    VALUES (v_row.store_id, 'ℹ️ التأكيد السنويّ لسجلك', 'ℹ️ Annual CR confirmation due',
            v_msg, v_msg, 'system',
            jsonb_build_object('audience', 'seller', 'actionUrl', '/seller',
                               'action_url', '/seller', 'days_left', v_left,
                               'code', 'CR_ANNUAL_CONFIRMATION'));
    UPDATE public.store_verifications SET warn_stage_conf = v_stage WHERE id = v_row.id;
    v_w := v_w + 1;
  END LOOP;

  RETURN jsonb_build_object('queued', v_q, 'warned', v_w);
END
$fn$;
REVOKE ALL ON FUNCTION public.taki_wathq_confirmation_sweep() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_wathq_confirmation_sweep() FROM anon;
REVOKE ALL ON FUNCTION public.taki_wathq_confirmation_sweep() FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١١) ما يراه المراجع — ولا يحكم نيابةً عنه
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 **لا قرارَ آليّ في النسخة الأولى**، وذلك عن عمد: `store_verifications`
--    فيها صفرُ صفٍّ اليوم، فلا سلوكَ مقيساً نبني عليه رفضاً آلياً. ورفضُ
--    تاجرٍ حقيقيّ خطأً أغلى بكثيرٍ من ثلاثين ثانيةً من نظر المراجع.
DROP FUNCTION IF EXISTS public.admin_verification_registry(text);
CREATE FUNCTION public.admin_verification_registry(p_ver_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_v record; v_checks jsonb; v_cfg jsonb; v_spent numeric;
BEGIN
  IF NOT public.taki_admin_perm('tab_verification') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;
  SELECT * INTO v_v FROM public.store_verifications WHERE id = p_ver_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;

  v_cfg := public._taki_wathq_cfg();
  SELECT COALESCE(sum(cost_sar), 0) INTO v_spent
    FROM public.store_verification_checks WHERE done_at >= date_trunc('month', now());

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'kind', c.kind, 'status', c.status, 'http', c.http_status,
           'cost', c.cost_sar, 'error', c.last_error, 'at', c.done_at,
           'asked', c.arg) ORDER BY c.id DESC), '[]'::jsonb)
    INTO v_checks
    FROM public.store_verification_checks c WHERE c.ver_id = p_ver_id;

  RETURN jsonb_build_object(
    'ok', true,
    'subscribed', public._taki_wathq_key() IS NOT NULL,
    'env', v_cfg->>'env',
    'check_owners', (v_cfg->>'check_owners')::boolean,
    'registry', v_v.registry_state,
    'registry_at', v_v.registry_at,
    'cr_national', v_v.cr_national,
    'confirmation_due', v_v.confirmation_due,
    'claimed_name', v_v.claimed_name,
    'legal_name', v_v.legal_name,
    'checks', v_checks,
    'spent_this_month_sar', v_spent,
    'monthly_cap_sar', (v_cfg->>'monthly_cap_sar')::numeric);
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_verification_registry(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_verification_registry(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_verification_registry(text) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_wathq_state();
CREATE FUNCTION public.admin_wathq_state()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_c record; v_spent numeric; v_cnt jsonb;
BEGIN
  IF NOT (public.taki_admin_perm('tab_tools') OR public.taki_admin_perm('tab_verification')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;
  SELECT * INTO v_c FROM public.wathq_config WHERE id;
  SELECT COALESCE(sum(cost_sar), 0) INTO v_spent
    FROM public.store_verification_checks WHERE done_at >= date_trunc('month', now());
  SELECT jsonb_object_agg(status, n) INTO v_cnt
    FROM (SELECT status, count(*) AS n FROM public.store_verification_checks GROUP BY status) t;
  RETURN jsonb_build_object(
    'ok', true,
    'subscribed', public._taki_wathq_key() IS NOT NULL,
    'env', v_c.env, 'last4', v_c.key_last4, 'set_at', v_c.key_set_at,
    'check_owners', v_c.check_owners, 'convert_cr', v_c.convert_cr,
    'monthly_cap_sar', v_c.monthly_cap_sar,
    'spent_this_month_sar', v_spent,
    'queue', COALESCE(v_cnt, '{}'::jsonb));
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_wathq_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_wathq_state() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_wathq_state() TO authenticated;

DROP FUNCTION IF EXISTS public.admin_set_wathq_options(boolean, boolean, numeric);
CREATE FUNCTION public.admin_set_wathq_options(
  p_check_owners boolean DEFAULT NULL, p_convert_cr boolean DEFAULT NULL,
  p_monthly_cap numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT public.taki_admin_perm('tab_tools') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;
  IF p_monthly_cap IS NOT NULL AND (p_monthly_cap < 0 OR p_monthly_cap > 100000) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_CAP');
  END IF;
  UPDATE public.wathq_config
     SET check_owners    = COALESCE(p_check_owners, check_owners),
         convert_cr      = COALESCE(p_convert_cr, convert_cr),
         monthly_cap_sar = COALESCE(p_monthly_cap, monthly_cap_sar),
         updated_at      = now()
   WHERE id;
  RETURN public.admin_wathq_state();
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_set_wathq_options(boolean, boolean, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_wathq_options(boolean, boolean, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_wathq_options(boolean, boolean, numeric) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١٢) التنظيف والجدولة — على الخادم لا على GitHub
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.taki_prune_wathq_checks();
CREATE FUNCTION public.taki_prune_wathq_checks()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE n int;
BEGIN
  -- 🪤 تُحفظ سنةً كاملة: الكلفةُ دليلٌ ماليّ، ونافذةُ التأكيد السنويّ سنة.
  DELETE FROM public.store_verification_checks
   WHERE done_at IS NOT NULL AND done_at < now() - interval '400 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;

DO $cron$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job
   WHERE jobname IN ('taki-wathq-dispatch', 'taki-wathq-collect',
                     'taki-wathq-sweep', 'taki-wathq-prune');
  PERFORM cron.schedule('taki-wathq-dispatch', '* * * * *',
    $$SELECT public.taki_wathq_dispatch();$$);
  PERFORM cron.schedule('taki-wathq-collect', '* * * * *',
    $$SELECT public.taki_wathq_collect();$$);
  -- المسحُ مجّانيّ، ومرّةً يومياً تكفي — الحالةُ لا تتغيّر في الساعة.
  PERFORM cron.schedule('taki-wathq-sweep', '35 1 * * *',
    $$SELECT public.taki_wathq_confirmation_sweep();$$);
  PERFORM cron.schedule('taki-wathq-prune', '45 3 * * *',
    $$SELECT public.taki_prune_wathq_checks();$$);
END
$cron$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١٣) قياسُ المنطق — بحمولاتٍ على شكل ما تنشره وثيقةُ واثق
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE v jsonb; v_cfg jsonb; v_n text; v_due date;
BEGIN
  -- (أ) 🔴 الحُكمُ بالمعرّف لا بالاسم — وهذه هي المصيدةُ بعينها:
  --     `/status` تُصيّر ١ «نشط» وبقيّةُ المسارات تُصيّره «فعال».
  v := public._taki_wathq_parse_status(
        '{"id":1,"name":"نشط","confirmationDate":{"gregorian":"2026-03-10","hijri":"1447-09-21"}}'::jsonb);
  IF (v->>'active')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'حالةٌ سارية («نشط») لم تُقرأ ساريةً.'; END IF;
  v := public._taki_wathq_parse_status('{"id":1,"name":"فعال"}'::jsonb);
  IF (v->>'active')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'نفسُ المعرّف باسمٍ آخر («فعال») انكسر — أي أن الحكمَ بالاسم.'; END IF;
  v := public._taki_wathq_parse_status('{"id":2,"name":"معلق"}'::jsonb);
  IF (v->>'active')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'حالةٌ غيرُ سارية قُرئت سارية.'; END IF;

  -- (ب) استحقاقُ التأكيد السنويّ = تاريخُ التأكيد + سنة
  v := public._taki_wathq_parse_status(
        '{"id":1,"name":"نشط","confirmationDate":{"gregorian":"2026-03-10"}}'::jsonb);
  IF (v->>'confirmation_due')::date IS DISTINCT FROM DATE '2027-03-10' THEN
    RAISE EXCEPTION 'الاستحقاقُ خاطئ: %', v->>'confirmation_due';
  END IF;

  -- (ج) 🔴 الهجريُّ لا يُقرأ إطلاقاً: النسختان تنشران ترتيبين متعاكسين
  --     (`1423-07-28` في الإنتاج و`28-07-1423` في الاختبار) — فحمولةٌ
  --     هجريّةٌ وحدها يجب أن تعطي استحقاقاً فارغاً لا تاريخاً مخترَعاً.
  v := public._taki_wathq_parse_status('{"id":1,"name":"نشط","confirmationDate":{"hijri":"28-07-1447"}}'::jsonb);
  IF v->>'confirmation_due' IS NOT NULL THEN
    RAISE EXCEPTION 'قُرئ تاريخٌ هجريٌّ وتحويلُه تخمينُ ترتيب: %', v->>'confirmation_due';
  END IF;

  -- (د) المُلّاك: ثلاثةُ أشكالٍ كلُّها منشورةٌ في وثيقتهم أو مخالفةٌ لها
  v := public._taki_wathq_parse_owners(
        '[{"name":"محمد بن عبدالله","identity":{"id":"1234567890"}},{"name":"فهد الشريف"}]'::jsonb);
  IF (v->>'count')::int IS DISTINCT FROM 2
     OR jsonb_array_length(v->'names') IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'مصفوفةُ المُلّاك لم تُقرأ: %', v::text;
  END IF;
  -- 🔴 مثالُهم المنشور كائنٌ مفردٌ **يخالف مخطّطَهم هم** — ولو لم يُقبل
  --    لانكسر القارئُ على أوّل سجلٍّ بمالكٍ واحد.
  v := public._taki_wathq_parse_owners('{"name":"سارة العتيبي","identity":{"id":"1098765432"}}'::jsonb);
  IF (v->>'count')::int IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'الكائنُ المفرد لم يُلفّ في مصفوفة: %', v::text; END IF;
  -- وداخل `/fullinfo` اسمُها `parties` لا `owners`
  v := public._taki_wathq_parse_owners('{"parties":[{"name":"شركة أ"},{"name":"شركة ب"}]}'::jsonb);
  IF (v->>'count')::int IS DISTINCT FROM 2 THEN RAISE EXCEPTION '«parties» لم تُقرأ: %', v::text; END IF;

  -- (هـ) تحويلُ الرقم — كائناً أو نصّاً
  IF public._taki_wathq_parse_crnational('{"crNationalNumber":"7001234567"}'::jsonb) IS DISTINCT FROM '7001234567' THEN
    RAISE EXCEPTION 'الرقمُ الوطنيّ لم يُقرأ من الكائن.';
  END IF;
  IF public._taki_wathq_parse_crnational('"7009876543"'::jsonb) IS DISTINCT FROM '7009876543' THEN
    RAISE EXCEPTION 'الرقمُ الوطنيّ لم يُقرأ من النصّ المجرّد.';
  END IF;
  IF public._taki_wathq_parse_crnational('{"crNationalNumber":"abc"}'::jsonb) IS NOT NULL THEN
    RAISE EXCEPTION 'رقمٌ غيرُ رقميّ قُبل.';
  END IF;

  -- (و) الوصفُ: الترويسةُ والسعرُ المجّانيّ
  v_cfg := public._taki_wathq_cfg();
  IF (v_cfg->'endpoints'->'status'->>'price')::numeric IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'سعرُ /status ليس صفراً — فمراقبةُ التأكيد السنويّ ستكلّف مالاً.';
  END IF;
  IF (v_cfg->'endpoints'->'owners'->>'price')::numeric IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'سعرُ /owners ليس ٥ ريالات.';
  END IF;
  IF (v_cfg->>'check_owners')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION '🔴 فحصُ المُلّاك مُشتغلٌ افتراضاً وهو مدفوع — يجب أن يفشل مغلقاً.';
  END IF;
  IF position('includeDates=true' IN (v_cfg->'endpoints'->'status'->>'query')) = 0 THEN
    RAISE EXCEPTION 'لم تُطلب التواريخ، فلا استحقاقَ تأكيدٍ أبداً.';
  END IF;

  -- (ز) بلا مفتاح: يتخطّى ولا يفشل — فالطابورُ ينتظر الاشتراك ولا يُحرق
  IF public._taki_wathq_key() IS NULL THEN
    IF (public.taki_wathq_dispatch(5)->>'skipped') IS DISTINCT FROM 'NO_KEY' THEN
      RAISE EXCEPTION 'بلا مفتاحٍ لم يتخطَّ الإرسالُ كما يجب.';
    END IF;
  END IF;

  RAISE NOTICE '✅ المنطق: الحكمُ بالمعرّف · الهجريُّ متروك · ثلاثةُ أشكالٍ للمُلّاك · /status مجّانيّ · والمدفوعُ مطفأ.';
END
$verify$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١٤) فحصٌ من الطرف إلى الطرف — نداءٌ **حقيقيّ** إلى api.wathq.sa
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 كلُّ ما سبق يقيس منطقاً. وما لم يُقَس هو الأهمّ: هل يُبنى العنوان؟ هل
--    تصل ترويسةُ `apiKey`؟ هل يهبط الردُّ ويُصنَّف؟ ويُقاس بمفتاحٍ وهميّ —
--    والمطلوبُ بعينه أن تردّ واثق ٤٠١/٤٠٣ وأن يُصنَّف `KEY_REJECTED`.
-- 🪤 وثلاثُ كتلٍ لا كتلةٌ واحدة: `pg_net` يُرسل **بعد** الالتزام، و`now()`
--    مجمَّدةٌ داخل المعاملة — فجمعُ ردٍّ في كتلة إرساله مستحيلٌ بنيوياً.
DO $e2e_a$
DECLARE v_store text; v_had boolean;
  FAKE constant text := 'taki_v1530_e2e_fake_key_0123456789';
BEGIN
  SELECT id INTO v_store FROM public.users ORDER BY created_at LIMIT 1;
  IF v_store IS NULL THEN RAISE NOTICE 'ℹ️ لا مستخدم — تخطّي الفحص الحيّ.'; RETURN; END IF;

  v_had := EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'app_secret:wathq_api_key');
  IF v_had THEN
    RAISE NOTICE 'ℹ️ يوجد مفتاحُ واثق حقيقيّ — لن أدهسه، وأتخطّى الفحصَ الحيّ.';
    RETURN;
  END IF;
  PERFORM vault.create_secret(FAKE, 'app_secret:wathq_api_key', 'مفتاحٌ وهميٌّ لفحص v15.30 — يُحذف في نهاية الهجرة');

  DELETE FROM public.store_verifications WHERE id = 'v1530-e2e';
  -- والإدراجُ وحده يجب أن يُدرج الفحصَ في الطابور (المشغّل)
  INSERT INTO public.store_verifications
    (id, store_id, doc_kind, doc_number, claimed_name, status, submitted_at)
  VALUES ('v1530-e2e', v_store, 'cr', '7001234567', 'فحص v15.30', 'submitted', now());

  IF NOT EXISTS (SELECT 1 FROM public.store_verification_checks
                  WHERE ver_id = 'v1530-e2e' AND kind = 'status' AND status = 'pending') THEN
    RAISE EXCEPTION '❌ المشغّلُ لم يُدرج فحصاً عند وصول الطلب — فلا شيء يعمل تلقائياً.';
  END IF;

  PERFORM public.taki_wathq_dispatch(5);
  IF NOT EXISTS (SELECT 1 FROM public.store_verification_checks
                  WHERE ver_id = 'v1530-e2e' AND status = 'awaiting' AND request_id IS NOT NULL) THEN
    RAISE EXCEPTION '❌ 🔴 لم يُرسل طلبٌ فعلاً: %',
      (SELECT COALESCE(string_agg(status || '/' || COALESCE(last_error, '-'), ', '), 'لا صفوف')
         FROM public.store_verification_checks WHERE ver_id = 'v1530-e2e');
  END IF;
  RAISE NOTICE 'ℹ️ أُرسل طلبٌ حقيقيٌّ إلى api.wathq.sa — انتظارُ الردّ.';
END
$e2e_a$;

SELECT pg_sleep(14);

DO $e2e_b$
DECLARE v_c record; r jsonb; v_fake boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.store_verification_checks WHERE ver_id = 'v1530-e2e')
    INTO v_fake;
  IF NOT v_fake THEN RAISE NOTICE 'ℹ️ لا فحصَ حيّ — تخطّي.'; RETURN; END IF;

  r := public.taki_wathq_collect(50);
  SELECT * INTO v_c FROM public.store_verification_checks
   WHERE ver_id = 'v1530-e2e' ORDER BY id DESC LIMIT 1;
  RAISE NOTICE 'ℹ️ ردُّ واثق: http=% · الحالة=% · السبب=%',
    COALESCE(v_c.http_status::text, '-'), v_c.status, COALESCE(v_c.last_error, '-');

  IF v_c.http_status IS NULL THEN
    RAISE EXCEPTION '❌ 🔴 لم يهبط أيُّ ردٍّ من واثق — فالقاعدةُ لا تصلها والحلقةُ كلُّها معطّلة. %', r::text;
  END IF;
  IF v_c.http_status NOT IN (401, 403) THEN
    RAISE EXCEPTION '❌ توقّعتُ ٤٠١/٤٠٣ من مفتاحٍ وهميّ فجاء % — راجع العنوانَ وترويسةَ apiKey.', v_c.http_status;
  END IF;
  IF v_c.status <> 'failed' OR COALESCE(v_c.last_error, '') <> 'KEY_REJECTED' THEN
    RAISE EXCEPTION '❌ الرفضُ لم يُصنَّف KEY_REJECTED (%/%) — فسيُعاد إلى الأبد.', v_c.status, v_c.last_error;
  END IF;
  IF v_c.cost_sar <> 0 THEN
    RAISE EXCEPTION '❌ استعلامٌ مرفوضٌ احتُسبت له كلفة (%) — ووثيقتهم تقول لا يُخصم.', v_c.cost_sar;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications
                  WHERE meta_data->>'code' = 'WATHQ_KEY_REJECTED'
                    AND created_at > now() - interval '10 minutes') THEN
    RAISE EXCEPTION '❌ مفتاحٌ مرفوضٌ بلا إشعارٍ للأدمن — فالفحصُ يتوقّف بصمت.';
  END IF;

  RAISE NOTICE '✅ من الطرف إلى الطرف: القاعدةُ تصل واثق · الترويسةُ تُقرأ · والرفضُ مصنَّفٌ ومُبلَّغٌ وبلا كلفة.';
END
$e2e_b$;

-- تنظيفُ أثر الفحص — بما فيه المفتاحُ الوهميّ والإشعار
DO $cleanup$
BEGIN
  -- 🪤 ولا يُنظَّف إلّا أثرُ الفحص نفسه: لو كان لناصر مفتاحٌ حقيقيٌّ محفوظ
  --    لتخطّى الفحصُ الحيّ أصلاً، وحينها حذفُ الإشعارات أو تصفيرُ البيانات
  --    يمسح شيئاً حقيقياً. فالعلامةُ وجودُ المفتاح الوهميّ بعينه.
  IF NOT EXISTS (SELECT 1 FROM vault.secrets
                  WHERE name = 'app_secret:wathq_api_key'
                    AND description LIKE '%وهميٌّ لفحص v15.30%') THEN
    RAISE NOTICE 'ℹ️ لم يجرِ الفحصُ الحيّ (مفتاحٌ حقيقيٌّ موجود) — لا شيء يُنظَّف.';
    RETURN;
  END IF;

  DELETE FROM public.notifications
   WHERE meta_data->>'code' = 'WATHQ_KEY_REJECTED' AND created_at > now() - interval '30 minutes';
  DELETE FROM public.store_verification_checks WHERE ver_id = 'v1530-e2e';
  DELETE FROM public.store_verifications WHERE id = 'v1530-e2e';
  DELETE FROM vault.secrets
   WHERE name = 'app_secret:wathq_api_key'
     AND description LIKE '%وهميٌّ لفحص v15.30%';
  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'app_secret:wathq_api_key'
              AND description LIKE '%وهميٌّ لفحص v15.30%') THEN
    RAISE EXCEPTION '❌ 🔴 المفتاحُ الوهميُّ لم يُحذف — لا تترك الهجرةَ بمفتاحٍ ميت في الخزنة.';
  END IF;
  UPDATE public.wathq_config SET key_last4 = NULL, key_set_at = NULL WHERE id;
  RAISE NOTICE '✅ نُظّف أثرُ الفحص: لا مفتاحَ وهميّ · لا صفَّ توثيقٍ · لا إشعار.';
END
$cleanup$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١٥) الخلاصة — للقراءة وحدها
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS "البند", current_setting('server_version') AS "القيمة"
UNION ALL SELECT 'بيئةُ واثق', (public._taki_wathq_cfg()->>'env')
UNION ALL SELECT 'عنوانُ واثق', (public._taki_wathq_cfg()->>'base')
UNION ALL SELECT 'مُشترَكٌ الآن؟',
  CASE WHEN public._taki_wathq_key() IS NOT NULL THEN '✅ المفتاح محفوظ'
       ELSE '⏳ لا مفتاح — الطابورُ ينتظر ولا يفشل' END
UNION ALL SELECT 'فحصُ المُلّاك (مدفوع)',
  CASE WHEN (public._taki_wathq_cfg()->>'check_owners')::boolean THEN '✅ مُشتغل' ELSE '⏳ مطفأ (افتراضٌ مغلق)' END
UNION ALL SELECT 'سقفُ الصرف الشهريّ', (public._taki_wathq_cfg()->>'monthly_cap_sar') || ' ريال'
UNION ALL SELECT 'جدولُ الفحوص',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema='public' AND table_name='store_verification_checks')
       THEN '✅' ELSE '❌' END
UNION ALL SELECT 'مهامُّ واثق',
  COALESCE((SELECT string_agg(jobname || ' @ ' || schedule, ' · ' ORDER BY jobname)
              FROM cron.job WHERE jobname LIKE 'taki-wathq-%'), '❌');
