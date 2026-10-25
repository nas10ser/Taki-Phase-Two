-- ═══════════════════════════════════════════════════════════════════════════
-- v15.23 — قرارُ ناصر: قراءةٌ فقط، قيداً في القاعدة لا سكوناً
-- ═══════════════════════════════════════════════════════════════════════════
-- سؤالي عن البند الرابع (الكتابةُ العكسية: بيعٌ في تاكي يُنقص مخزونهم)،
-- وجوابُه (٢٥ أكتوبر ٢٠٢٦): **قراءةٌ فقط في النسخة الأولى.**
--
-- 🪤 ولماذا قيدٌ ولا يكفي أنها «لا تعمل اليوم»: الطابورُ الصادر مبنيٌّ ويعمل،
--    وشرطُ سكونه اليوم عارضٌ (لا `webhook_url` لمتجرٍ مربوطٍ بسلّة أو زد).
--    فأيُّ تعديلٍ لاحقٍ يضبط عنواناً — أو سطرٌ في شاشةٍ جديدة — يُشغّل الكتابةَ
--    **بلا قرارٍ من ناصر**. والقرارُ الذي لا يُفرض ليس قراراً.
--
-- 🔴 والسببُ الذي بُني عليه قرارُه، ويُكتب هنا ليُراجَع يوم يُعاد النظر:
--    أيُّ خطأٍ في حسابنا يصير رقماً خاطئاً **في نظام التاجر نفسه** — وهو
--    مكانٌ لا نملكه ولا نستطيع إصلاحَه له، وخطؤنا يصير خطأه أمام عملائه.
--    يُضاف إليه قياسٌ من وثيقة سلّة: كتابةُ المخزون عندهم **غيرُ فوريّة**
--    («it may take several minutes to finish the process») ⇒ فنافذةُ تعارضٍ
--    بين الرقمين قائمةٌ بطبيعتها.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public._taki_provider_read(text)') IS NULL THEN
    RAISE EXCEPTION 'v15.17 غير مطبَّقة — أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- حارسٌ على الاتجاه — ومعه رمزُ خطأٍ يُقرأ
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.tr_guard_stock_direction()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- يُطبَّق على مزوّدٍ **نقرأ منه** (سلّة · زد): هو وحده الذي تعني الكتابةُ
  -- العكسيّةُ عنده شيئاً، وهو وحده المشمولُ بقرار ٢٥ أكتوبر.
  IF public._taki_provider_read(NEW.provider) IS NOT NULL
     AND COALESCE(NEW.direction, 'in') <> 'in' THEN
    RAISE EXCEPTION 'الكتابةُ العكسية موقوفةٌ بقرارٍ من مالك المنصّة (٢٥ أكتوبر ٢٠٢٦): القراءةُ فقط في النسخة الأولى.'
      USING ERRCODE = 'P0027', HINT = 'READ_ONLY_BY_OWNER_DECISION';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS tr_guard_stock_direction ON public.stock_integrations;
CREATE TRIGGER tr_guard_stock_direction
  BEFORE INSERT OR UPDATE OF direction, provider ON public.stock_integrations
  FOR EACH ROW EXECUTE FUNCTION public.tr_guard_stock_direction();

-- والإنشاءُ يضع الاتجاهَ الصحيح من أوّله، فلا يُرفض طلبُ تاجرٍ بلا سبب
DO $patch$
DECLARE src text; src0 text;
BEGIN
  src := pg_get_functiondef('public.merchant_create_integration(text,text,text,text)'::regprocedure);
  src0 := src;
  IF position('v15.23 readonly' IN src) > 0 THEN RAISE NOTICE 'ℹ️ مرقوعةٌ أصلاً.'; RETURN; END IF;
  IF position(E'(store_id, provider, segment, label, api_key_hash, api_key_last4, webhook_url, webhook_secret, webhook_slug)' IN src) = 0 THEN
    RAISE EXCEPTION '❌ مرساة الإدراج غير موجودة — أوقِفت.';
  END IF;
  src := replace(src,
    E'(store_id, provider, segment, label, api_key_hash, api_key_last4, webhook_url, webhook_secret, webhook_slug)',
    E'-- v15.23 readonly — الاتجاهُ يُحسم عند الإنشاء: مزوّدٌ نقرأ منه يُنشأ\n'
    || E'  --   بـ`in` فقط (قرارُ المالك)، وغيرُه يبقى `both` كما كان.\n'
    || E'  (store_id, provider, segment, label, api_key_hash, api_key_last4, webhook_url, webhook_secret, webhook_slug, direction)');
  src := replace(src,
    E'          encode(extensions.gen_random_bytes(18), ''hex''))',
    E'          encode(extensions.gen_random_bytes(18), ''hex''),\n'
    || E'          CASE WHEN public._taki_provider_read(COALESCE(NULLIF(btrim(p_provider),''''),''custom'')) IS NOT NULL\n'
    || E'               THEN ''in'' ELSE ''both'' END)');
  IF src = src0 THEN RAISE EXCEPTION '❌ لم تقع الرقعة.'; END IF;
  EXECUTE src;
  IF position('v15.23 readonly' IN pg_get_functiondef('public.merchant_create_integration(text,text,text,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ الرقعة لم تُنفَّذ.';
  END IF;
  RAISE NOTICE '✅ الإنشاءُ يضع `in` لسلّة وزد، و`both` لغيرهما.';
END
$patch$;

-- وما هو قائمٌ اليوم يُصحَّح (صفرُ صفٍّ الآن — لكنها آمنةٌ للتكرار)
UPDATE public.stock_integrations SET direction = 'in'
 WHERE public._taki_provider_read(provider) IS NOT NULL AND direction <> 'in';

-- ═══════════════════════════════════════════════════════════════════════════
-- فحصٌ يرفع استثناءً — والكسرةُ هي محاولةُ تشغيل الكتابة
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE v_me text; v_i uuid; v_dir text; v_err text;
BEGIN
  SELECT id INTO v_me FROM public.users
   WHERE user_type IN ('seller','admin') AND deleted_at IS NULL ORDER BY id LIMIT 1;
  IF v_me IS NULL THEN RAISE NOTICE 'ℹ️ لا حساب تاجر — تخطّي.'; RETURN; END IF;

  -- (أ) 🔴 وأوّلُ ما قاسه الفحصُ بلا قصد، ويستحقّ البقاء: **الإدراجُ المباشر
  --     يُرفض أيضاً**، لأن افتراضيّ العمود `both`. وهو **فشلٌ مغلق** مقصود:
  --     أيُّ مسارٍ جديد يُدرج اتصالَ سلّة أو زد بلا تحديد اتجاهٍ يُرفض بصوتٍ
  --     عالٍ بدل أن يُشغّل الكتابةَ بلا قرار. (وفحصي الأوّل أدرج مباشرةً
  --     فسقط — فكان الحارسُ سليماً والفحصُ ناقصاً.)
  BEGIN
    INSERT INTO public.stock_integrations
      (store_id, provider, segment, label, api_key_hash, api_key_last4, webhook_slug)
    VALUES (v_me, 'zid', 'ecommerce', 'v1523-default',
            encode(extensions.digest('v1523d','sha256'),'hex'), 'dddd',
            encode(extensions.gen_random_bytes(18),'hex'));
    RAISE EXCEPTION '❌ 🔴 قُبل إدراجٌ مباشرٌ بالافتراضيّ `both`.';
  EXCEPTION WHEN sqlstate 'P0027' THEN NULL; END;

  -- (أ-ب) واتصالٌ باتجاهٍ صحيحٍ يُقبل
  INSERT INTO public.stock_integrations
    (store_id, provider, segment, label, api_key_hash, api_key_last4, webhook_slug, direction)
  VALUES (v_me, 'zid', 'ecommerce', 'v1523-verify',
          encode(extensions.digest('v1523','sha256'),'hex'), 'rrrr',
          encode(extensions.gen_random_bytes(18),'hex'), 'in')
  RETURNING id, direction INTO v_i, v_dir;
  IF v_dir <> 'in' THEN RAISE EXCEPTION '❌ اتصالُ زد أُنشئ بـ% لا in.', v_dir; END IF;

  -- (ب) 🔴 الكسرة: محاولةُ تشغيل الكتابة العكسية **يجب** أن تُرفض بـP0027
  BEGIN
    UPDATE public.stock_integrations SET direction = 'both' WHERE id = v_i;
    RAISE EXCEPTION '❌ 🔴 قُبل تشغيلُ الكتابة العكسية — قرارُ المالك غيرُ مفروض.';
  EXCEPTION WHEN sqlstate 'P0027' THEN
    NULL;   -- وهو المطلوب بعينه
  END;
  -- 🪤 ويُشترط الرمزُ بعينه لا «أيُّ استثناء»: فحصٌ يقبل أيَّ خطأٍ ليس فحصاً
  --    (درسُ v14.96 — رُصد رفضٌ من سقف المواقع وحُسب نجاحاً للحارس).
  BEGIN
    UPDATE public.stock_integrations SET direction = 'out' WHERE id = v_i;
    RAISE EXCEPTION '❌ 🔴 قُبل `out`.';
  EXCEPTION WHEN sqlstate 'P0027' THEN NULL; END;

  -- (ج) ومزوّدٌ لا نقرأ منه يبقى حرّاً — وإلّا كسر الحارسُ العقدَ المفتوح
  UPDATE public.stock_integrations SET provider = 'custom', direction = 'both' WHERE id = v_i;
  IF (SELECT direction FROM public.stock_integrations WHERE id = v_i) <> 'both' THEN
    RAISE EXCEPTION '❌ 🔴 الحارسُ منع العقدَ المفتوح — وهو ليس مشمولاً بالقرار.';
  END IF;

  -- (د) التنظيف
  DELETE FROM public.stock_integrations WHERE id = v_i;
  IF EXISTS (SELECT 1 FROM public.stock_integrations WHERE label = 'v1523-verify') THEN
    RAISE EXCEPTION '❌ بقيّةُ فحصٍ لم تُحذف.';
  END IF;
  RAISE NOTICE '✅ v15.23: سلّة وزد قراءةٌ فقط قيداً (P0027) · والإدراجُ بالافتراضيّ يُرفض · والعقدُ المفتوح حرٌّ كما كان.';
END
$verify$;
