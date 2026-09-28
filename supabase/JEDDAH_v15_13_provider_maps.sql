-- ═══════════════════════════════════════════════════════════════════════════
-- v15.13 — خرائطُ سلّة وزد **من وثيقتَيهما**، لا تخميناً
-- ═══════════════════════════════════════════════════════════════════════════
-- طلبُ ناصر: «اربط سلّة وزد كمُحوّلات جاهزة». وفُتحت وثيقتاهما فعلاً هذه
-- المرّة (‎.md‎ خام + OpenAPI + مخطّطات مُصيَّرة)، فصار ما يلي **مؤكَّداً**:
--
--   سلّة: الرسالةُ بغلاف — المنتجُ في `data`.
--         المعرّف `data.id` · الكمّية `data.quantity`
--         والأصناف `data.skus[]` بـ`id` و`stock_quantity`.
--         والتحقّق: HMAC-SHA256 على **الجسم الخام** في `X-Salla-Signature`.
--   زد:   الرسالةُ **بلا غلاف** — المنتجُ في جذرها.
--         المعرّف `id` · الكمّية `quantity` · والمواقع `stocks[]` بـ
--         `id` و`available_quantity`.
--         والتحقّق: **لا توقيع** — Basic Auth فقط.
--
-- 🔴 وثلاثُ حقائقَ تقلب فهمي السابق، وتُقال لناصر كما هي:
--   ١) **لا واحدةَ منهما تُرسل حدثاً لتغيّر المخزون.** سلّة أهملت
--      `product.updated`، و`product.quantity.low` لا تنطلق إلا عند حدٍّ منخفض.
--      وزد عندها `product.update` العامّ فقط. ⇒ الرسالةُ **إشارة** لا حقيقة،
--      والرقمُ الصحيح يُقرأ من واجهتهم بعدها.
--   ٢) **ولا واحدةَ منهما تسمح للتاجر بتسجيل رابطٍ بنفسه.** زد صريحة: يلزم
--      مفتاحُ شريكٍ ورمزُ OAuth. وسلّة كذلك عبر بوّابة الشركاء. ⇒ «الصق
--      الرابط» لا تعمل معهما — ووعدُها للتاجر كذب.
--   ٣) **وكلتاهما تسمح بالكتابة للمخزون** (سلّة `POST /products/quantities/bulk`
--      وهي **غيرُ فوريّة**، وزد `PATCH /v1/products/{id}/stocks/`). أي أن
--      المزامنة ثنائيّةُ الاتجاه ممكنةٌ فعلاً — بعد تسجيل التطبيق.
--
-- 🪤 وما يُبنى هنا هو **الطرفُ المستقبِل جاهزاً**: حين يُسجَّل تطبيقُ تاكي
--    لديهما، تكون القاعدةُ تفهم شكلَ رسالتيهما من أوّل رسالة بلا تعلّمٍ ولا
--    تخمين. وما قبل ذلك لا يُوعَد به في الشاشة.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_stock_webhook(text,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'v15.12 غير مطبَّقة — أوقِفت.';
  END IF;
END
$guard$;

-- سرُّ التحقّق الوارد (غيرُ سرّ التوقيع الصادر): يُضبط لحظة تسجيل الخطّاف
-- لدى المنصّة، فيُحفظ هنا ليُتحقَّق به من كلّ رسالة.
ALTER TABLE public.stock_integrations ADD COLUMN IF NOT EXISTS inbound_secret text;
COMMENT ON COLUMN public.stock_integrations.inbound_secret IS
  'سرُّ التحقّق من الرسائل الواردة (v15.13): توقيعُ سلّة HMAC، أو كلمةُ Basic Auth عند زد. غيرُ webhook_secret الصادر.';

-- ═══════════════════════════════════════════════════════════════════════════
-- خريطةُ المزوّد المؤكَّدة — تُجرَّب **قبل** المرشّحات العامّة
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._taki_provider_map(p_provider text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE lower(COALESCE(p_provider, ''))
    -- سلّة: غلافٌ حول المنتج (مؤكَّد من docs.salla.dev/webhook-events/products.md)
    WHEN 'salla' THEN '{"id":"data.id","qty":"data.quantity","source":"salla-docs"}'::jsonb
    -- زد: المنتجُ في الجذر بلا غلاف (مؤكَّد من docs.zid.sa/webhook-events-product)
    WHEN 'zid'   THEN '{"id":"id","qty":"quantity","source":"zid-docs"}'::jsonb
    ELSE NULL END;
$fn$;

DO $patch$
DECLARE src text; src0 text;
BEGIN
  src := pg_get_functiondef('public.taki_stock_webhook(text,jsonb,text)'::regprocedure);
  src0 := src;
  IF position('_taki_provider_map' IN src) > 0 THEN
    RAISE NOTICE 'ℹ️ مرقوعةٌ أصلاً.'; RETURN;
  END IF;
  IF position(E'  v_map := v_i.field_map;' IN src) = 0 THEN
    RAISE EXCEPTION '❌ مرساة الخريطة غير موجودة — أوقِفت.';
  END IF;
  -- خريطةُ التاجر أوّلاً (تعلُّمٌ أو ربطٌ يدويّ)، ثمّ خريطةُ المزوّد المؤكَّدة،
  -- ثمّ المرشّحاتُ العامّة. والترتيبُ مقصود: ما تعلّمناه من رسالةٍ حقيقية
  -- أصدقُ من وثيقةٍ قد تكون تغيّرت.
  src := replace(src, E'  v_map := v_i.field_map;',
    E'  v_map := COALESCE(v_i.field_map, public._taki_provider_map(v_i.provider));');
  IF src = src0 THEN RAISE EXCEPTION '❌ الحقن لم يقع.'; END IF;
  EXECUTE src;
  IF position('_taki_provider_map' IN pg_get_functiondef('public.taki_stock_webhook(text,jsonb,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ الحقن لم يُنفَّذ.';
  END IF;
  RAISE NOTICE '✅ خريطةُ المزوّد المؤكَّدة تُجرَّب قبل المرشّحات.';
END
$patch$;

GRANT SELECT (id, store_id, provider, segment, label, api_key_last4, webhook_url,
              direction, is_enabled, last_seen_at, created_at,
              field_map, last_payload, last_payload_at, last_note)
  ON public.stock_integrations TO authenticated;
-- 🪤 و`inbound_secret` **غيرُ ممنوح**: سرٌّ يُقرأ من الجدول سرٌّ ضائع.

-- ═══════════════════════════════════════════════════════════════════════════
-- تحقّقٌ يرفع استثناءً
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE r jsonb;
BEGIN
  IF public._taki_provider_map('salla')->>'id' <> 'data.id'
     OR public._taki_provider_map('salla')->>'qty' <> 'data.quantity' THEN
    RAISE EXCEPTION '❌ خريطةُ سلّة خاطئة — وهي مؤكَّدةٌ من وثيقتهم (غلافُ data).';
  END IF;
  IF public._taki_provider_map('zid')->>'id' <> 'id'
     OR public._taki_provider_map('zid')->>'qty' <> 'quantity' THEN
    RAISE EXCEPTION '❌ خريطةُ زد خاطئة — رسالتُهم بلا غلاف، المنتجُ في الجذر.';
  END IF;
  IF public._taki_provider_map('custom') IS NOT NULL THEN
    RAISE EXCEPTION '❌ خريطةٌ مُخترعة لمزوّدٍ لم تُفتح وثيقتُه.';
  END IF;
  -- 🔴 والفرقُ الحاسم بين الشكلين يُقاس، لا يُفترض
  IF public._taki_jpath('{"data":{"id":"A","quantity":5}}'::jsonb,
       public._taki_provider_map('salla')->>'qty') <> '5' THEN
    RAISE EXCEPTION '❌ شكلُ سلّة لا يُقرأ.';
  END IF;
  IF public._taki_jpath('{"id":"B","quantity":9}'::jsonb,
       public._taki_provider_map('zid')->>'qty') <> '9' THEN
    RAISE EXCEPTION '❌ شكلُ زد لا يُقرأ.';
  END IF;
  -- وخريطةُ سلّة لا تقرأ رسالةَ زد والعكس — وإلّا فالتمييزُ وهم
  IF public._taki_jpath('{"id":"B","quantity":9}'::jsonb,
       public._taki_provider_map('salla')->>'qty') IS NOT NULL THEN
    RAISE EXCEPTION '❌ خريطةُ سلّة تقرأ رسالةَ زد — الشكلان ليسا مميَّزين.';
  END IF;

  IF has_column_privilege('authenticated', 'public.stock_integrations', 'inbound_secret', 'SELECT') THEN
    RAISE EXCEPTION '❌ سرُّ التحقّق الوارد مقروء.';
  END IF;

  RAISE NOTICE '✅ v15.13: خريطتا سلّة وزد من وثيقتَيهما · ومُميَّزتان · وسرُّ التحقّق محجوب.';
END
$verify$;
