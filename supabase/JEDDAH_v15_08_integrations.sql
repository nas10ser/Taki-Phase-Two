-- ═══════════════════════════════════════════════════════════════════════════
-- v15.08 — الدرجة ١: ربطُ مخزون تاكي بنظام التاجر نفسه
-- ═══════════════════════════════════════════════════════════════════════════
-- طلبُ ناصر: «اريد ربط مباشر بكل الانظمه الموجوده … في حال نقص عن طريق حضور
-- شخص أو حجز شخص آخر من خارج برنامج تاكي ونقص من نظام كاشير مثلاً ينقص بشكل
-- أوتوماتيكي … ويستطيع ربطها بكود أو رابط أو موقع … وهيّئ النظام في موقعي
-- بحيث يستطيع استقبال جميع أنواع الأنظمة … ولها تصنيف في موقعي».
-- وأضاف بعدها: «وفي حالة الاسترداد ترجع الكميه … من نظام المخزون حق التاجر».
--
-- 🔴 والحقيقةُ التي يجب أن تُقال أوّلاً: **لا أحدَ يستطيع أن يتكامل مسبقاً مع
--    «كلّ نظامٍ موجود».** فودكس وريوا وسلّة وزد وكلاودبِدز وميوز وأوبرا… لكلٍّ
--    عقدُه وتوثيقُه وتغييراتُه. ومن يَعِد بذلك يَعِد بما لا يُنفَّذ.
--    والطريقةُ التي تفي بطلبك فعلاً ثلاثُ طبقات:
--      ١) **عقدٌ واحد مفتوح** يتكلّمه أيُّ نظامٍ في العالم — وهو هذا الملفّ.
--      ٢) مُحوّلاتٌ جاهزة للأنظمة الشائعة في السعودية، تُضاف واحداً واحداً.
--      ٣) وكتالوجٌ مصنَّفٌ بالفئة في الموقع يختار منه التاجر (في المستودع:
--         `src/data/stockProviders.ts`).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 قراراتٌ مبنيّةٌ على ما قِيس، لا على ما يبدو أسهل:
--
-- ١) **كمّياتٌ مطلقة لا فروق.** نظامُ التاجر يقول «عندي ٢٠» لا «انقص ١».
--    رسالةٌ ضائعة مع الفروق تُخرج الرقمَين عن التطابق إلى الأبد؛ ومع المطلق
--    تُصحّحها الرسالةُ التالية وحدها.
--
-- ٢) **`observed_at` إلزاميّ.** الشبكةُ لا تضمن ترتيباً، ورسالتان قد تصلان
--    مقلوبتين. `taki_set_on_hand` ترفض الأقدم أصلاً — وv15.06 أصلحت العيب
--    الذي كان يجعل **بيعاً** يُقدّم العلامة فيبتلع دفعةَ النظام بـ`ok:true`.
--
-- ٣) **`event_id` إلزاميّ.** إعادةُ المحاولة عند انقطاعٍ شائعة، وبلا مفتاح
--    تكرارٍ تُطبَّق الرسالة مرّتين. الجدولُ `stock_inbox` يمنعها.
--
-- ٤) **المفتاح لا يُخزَّن أبداً.** يُولَّد على الخادم، يُعطى مرّةً واحدة،
--    ويُحفظ منه `sha256` وآخرُ أربعة محارف للعرض. (نفسُ نمط `merchant_gateways`:
--    الأسرارُ في الخزنة والجدولُ يحمل مؤشّراً وlast4.)
--
-- ٥) **الربطُ بكودٍ أو رابط**: `stock_links.external_id` هو «الكود» عند
--    التاجر، و`external_url` رابطُ المنتج في نظامه. وكلاهما يشير إلى **سطرٍ
--    واحد** عندنا: عرضٌ، أو صنفٌ فيه، أو فرع.
--    🪤 ولا يُستعمل `pos_sku` مفتاحَ ربط: قِيس — عرضٌ واحد من ٢١ يحمله، وصفرُ
--    خيارٍ إضافيّ، ولا قيدَ تفرّدٍ عليه في القاعدة كلّها.
--
-- ٦) **والاتجاهُ الآخر مبنيٌّ هنا أيضاً** (طلبُ ناصر عن الاسترداد): كلُّ حركةٍ
--    في مخزوننا تُكتب في `stock_events` — بيعٌ وإرجاعٌ وإعلانٌ ومزامنة — وهو
--    طابورُ تسليمٍ بنفس نمط `email_outbox` المُجرَّب على هذا الخادم.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_set_on_hand(text,integer,jsonb,jsonb,timestamptz,text)') IS NULL
     OR to_regprocedure('public.taki_rate_check(text,integer,integer,text)') IS NULL THEN
    RAISE EXCEPTION 'v15.02 أو حارس المعدّل غير موجود — أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) الاتصال — نظامٌ واحدٌ لتاجرٍ واحد
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stock_integrations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider       text NOT NULL,                 -- رمزٌ من الكتالوج، أو 'custom'
  segment        text,                          -- food | retail | hotel | beauty | ecommerce | other
  label          text,                          -- ما يسمّيه التاجر
  api_key_hash   text NOT NULL,                 -- sha256 — المفتاح نفسه لا يُخزَّن
  api_key_last4  text NOT NULL,
  webhook_url    text,                          -- إلى أين نُرسل حركاتنا
  webhook_secret text,                          -- سرُّ التوقيع (HMAC) — يُولَّد على الخادم
  direction      text NOT NULL DEFAULT 'both' CHECK (direction IN ('in','out','both')),
  is_enabled     boolean NOT NULL DEFAULT true,
  last_seen_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_stock_integrations_key ON public.stock_integrations (api_key_hash);
CREATE INDEX IF NOT EXISTS ix_stock_integrations_store ON public.stock_integrations (store_id);
COMMENT ON TABLE public.stock_integrations IS
  'ربطُ متجرٍ بنظام مخزونه (v15.08). المفتاح لا يُخزَّن — sha256 وlast4 فقط، كما في merchant_gateways.';

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) الربطُ بكودٍ أو رابط — «كود عندهم» ⇄ «سطرٌ عندنا»
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stock_links (
  id             bigserial PRIMARY KEY,
  integration_id uuid NOT NULL REFERENCES public.stock_integrations(id) ON DELETE CASCADE,
  store_id       text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  deal_id        text NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  variant_id     text,                          -- NULL = العرضُ كلُّه
  location_id    text,                          -- NULL = كلُّ الفروع
  external_id    text NOT NULL,                 -- «الكود» في نظام التاجر
  external_url   text,                          -- «الرابط» إلى المنتج عندهم
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- 🪤 كودٌ واحدٌ عند التاجر يشير إلى **سطرٍ واحد** عندنا. وبلا هذا القيد تصل
--    دفعةٌ واحدة فتكتب في عرضين، ولا يُكتشف ذلك إلا من شكوى مشترٍ.
CREATE UNIQUE INDEX IF NOT EXISTS ux_stock_links_ext
  ON public.stock_links (integration_id, external_id);
CREATE INDEX IF NOT EXISTS ix_stock_links_deal ON public.stock_links (deal_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) صندوقُ الوارد — مفتاحُ التكرار
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stock_inbox (
  integration_id uuid NOT NULL REFERENCES public.stock_integrations(id) ON DELETE CASCADE,
  event_id       text NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_id, event_id)
);
COMMENT ON TABLE public.stock_inbox IS
  'مفاتيحُ الأحداث المستلَمة (v15.08). إعادةُ المحاولة عند انقطاعٍ شائعة، وبلا هذا تُطبَّق الرسالة مرّتين.';

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) سجلُّ الحركات — وهو الاتجاهُ الآخر: نحن نُخبر نظامَهم
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 نمطُ `email_outbox` المُجرَّب على هذا الخادم: محاولاتٌ ومهلةٌ وخطأٌ أخير،
--    والسحبُ بـ`FOR UPDATE SKIP LOCKED` فلا يلتقط عاملان نفسَ الصفّ.
CREATE TABLE IF NOT EXISTS public.stock_events (
  id             bigserial PRIMARY KEY,
  store_id       text NOT NULL,
  deal_id        text NOT NULL,
  variant_id     text,
  location_id    text,
  reason         text NOT NULL,                 -- sale | refund | declare | sync
  delta          int,                           -- موجبٌ يعود، سالبٌ يخرج، NULL لإعلانٍ مطلق
  on_hand_after  int,
  barcode        text,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  attempts       int NOT NULL DEFAULT 0,
  last_error     text,
  picked_at      timestamptz,
  sent_at        timestamptz
);
CREATE INDEX IF NOT EXISTS ix_stock_events_pending
  ON public.stock_events (id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ix_stock_events_store ON public.stock_events (store_id, occurred_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) RLS — التاجر يرى اتصالَه وروابطَه وحركاتِه، ولا يرى مفتاحه أحد
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.stock_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_links        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_inbox        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_events       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_integrations_own ON public.stock_integrations;
CREATE POLICY stock_integrations_own ON public.stock_integrations FOR SELECT TO authenticated
  USING (store_id = (SELECT auth.uid())::text OR public.taki_admin_perm('tab_launch'));
DROP POLICY IF EXISTS stock_links_own ON public.stock_links;
CREATE POLICY stock_links_own ON public.stock_links FOR SELECT TO authenticated
  USING (store_id = (SELECT auth.uid())::text OR public.taki_admin_perm('tab_launch'));
DROP POLICY IF EXISTS stock_events_own ON public.stock_events;
CREATE POLICY stock_events_own ON public.stock_events FOR SELECT TO authenticated
  USING (store_id = (SELECT auth.uid())::text OR public.taki_admin_perm('tab_launch'));
-- 🪤 ولا سياسةَ كتابةٍ إطلاقاً: كلُّ كتابةٍ تمرّ من دالّةٍ مالكة تفحص الملكية.
--    وصندوقُ الوارد بلا سياسةِ قراءةٍ أيضاً — لا شيء فيه يخصّ إنساناً.

-- ولا يُقرأ المفتاح ولا السرّ من الجدول مهما كانت السياسة
REVOKE ALL ON public.stock_integrations FROM anon, authenticated;
GRANT SELECT (id, store_id, provider, segment, label, api_key_last4, webhook_url,
              direction, is_enabled, last_seen_at, created_at)
  ON public.stock_integrations TO authenticated;
GRANT SELECT ON public.stock_links, public.stock_events TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٦) البابُ الوارد — `taki_stock_push`
-- ═══════════════════════════════════════════════════════════════════════════
-- يُنادى من نظام التاجر مباشرةً:
--   POST https://api.takisa.net/rest/v1/rpc/taki_stock_push
--   { "p_key": "<مفتاحه>", "p_event_id": "<فريد>", "p_observed_at": "<ISO>",
--     "p_items": [ { "external_id": "SKU-123", "on_hand": 20 }, … ] }
--
-- 🪤 ولا حاجةَ لدالّةٍ طرفية (edge function): PostgREST يعرض هذا أصلاً، وأيُّ
--    سطحٍ عامٍّ جديد على هذا الخادم يرث `VERIFY_JWT=false` فيبدأ **بلا أيّ
--    حماية** ويجب أن يبني حارسَه بنفسه. الدالّةُ هنا تحرس نفسها: مفتاحٌ
--    مُجزَّأ، وحدُّ معدّل، ومفتاحُ تكرار.
DROP FUNCTION IF EXISTS public.taki_stock_push(text, jsonb, timestamptz, text);
CREATE FUNCTION public.taki_stock_push(
  p_key         text,
  p_items       jsonb,
  p_observed_at timestamptz DEFAULT NULL,
  p_event_id    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_i     public.stock_integrations%ROWTYPE;
  v_hash  text;
  v_at    timestamptz := COALESCE(p_observed_at, now());
  v_it    jsonb;
  v_link  public.stock_links%ROWTYPE;
  v_ok    int := 0; v_skip int := 0;
  v_unmatched jsonb := '[]'::jsonb;
  v_res   jsonb;
  v_n     int;
BEGIN
  IF p_key IS NULL OR length(btrim(p_key)) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_KEY');
  END IF;
  -- 🪤 حدُّ المعدّل **قبل** أيّ عملٍ وعلى بصمة المفتاح لا على المفتاح:
  --    لئلّا يُسجَّل سرٌّ في `rate_limit_counters`.
  v_hash := encode(extensions.digest(btrim(p_key), 'sha256'), 'hex');
  PERFORM public.taki_rate_check('stockpush:' || left(v_hash, 16), 120, 60,
                                 'too many stock pushes — slow down');

  SELECT * INTO v_i FROM public.stock_integrations
   WHERE api_key_hash = v_hash AND is_enabled AND direction IN ('in','both');
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'UNKNOWN_KEY'); END IF;

  IF p_event_id IS NULL OR btrim(p_event_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_ID_REQUIRED',
      'hint', 'send a unique id per push so a retry cannot apply twice');
  END IF;
  BEGIN
    INSERT INTO public.stock_inbox (integration_id, event_id) VALUES (v_i.id, btrim(p_event_id));
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'event_id', p_event_id);
  END;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ITEMS_REQUIRED');
  END IF;
  IF jsonb_array_length(p_items) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TOO_MANY_ITEMS', 'max', 500);
  END IF;

  FOR v_it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_link FROM public.stock_links
     WHERE integration_id = v_i.id AND external_id = v_it->>'external_id';
    IF NOT FOUND THEN
      -- 🪤 كودٌ غيرُ مربوط **ليس خطأً في الرسالة**: يُعاد في الردّ ليراه
      --    نظامُ التاجر ويربطه، ولا يُسقط بقيّة الأصناف معه.
      v_unmatched := v_unmatched || to_jsonb(COALESCE(v_it->>'external_id',''));
      CONTINUE;
    END IF;
    v_n := NULLIF(v_it->>'on_hand','')::int;
    IF v_n IS NULL OR v_n < 0 THEN v_skip := v_skip + 1; CONTINUE; END IF;

    v_res := public.taki_set_on_hand(
      v_link.deal_id,
      CASE WHEN v_link.variant_id IS NULL AND v_link.location_id IS NULL THEN v_n ELSE NULL END,
      CASE WHEN v_link.variant_id IS NOT NULL AND v_link.location_id IS NULL
           THEN jsonb_build_array(jsonb_build_object('id', v_link.variant_id, 'onHand', v_n)) END,
      CASE WHEN v_link.location_id IS NOT NULL THEN jsonb_build_array(
             CASE WHEN v_link.variant_id IS NULL
                  THEN jsonb_build_object('id', v_link.location_id, 'onHand', v_n)
                  ELSE jsonb_build_object('id', v_link.location_id,
                         'variantOnHand', jsonb_build_object(v_link.variant_id, v_n)) END) END,
      v_at, 'sync');
    IF COALESCE((v_res->>'ok')::boolean, false) THEN v_ok := v_ok + 1; ELSE v_skip := v_skip + 1; END IF;
  END LOOP;

  UPDATE public.stock_integrations SET last_seen_at = now() WHERE id = v_i.id;
  RETURN jsonb_build_object('ok', true, 'applied', v_ok, 'skipped', v_skip,
                            'unmatched', v_unmatched, 'observed_at', v_at);
END
$fn$;

REVOKE ALL ON FUNCTION public.taki_stock_push(text, jsonb, timestamptz, text) FROM PUBLIC;
-- 🪤 ممنوحةٌ لـanon عمداً: نظامُ التاجر يحمل المفتاح العامّ ومفتاحَه هو، لا
--    جلسةَ مستخدم. والحارسُ هو المفتاح المُجزَّأ وحدُّ المعدّل — نفسُ منطق
--    `bot_*` التي تُحرس بالسرّ لا بالدور.
GRANT EXECUTE ON FUNCTION public.taki_stock_push(text, jsonb, timestamptz, text) TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٧) أبوابُ التاجر — إنشاءُ الاتصال والربط
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.merchant_create_integration(text, text, text, text);
CREATE FUNCTION public.merchant_create_integration(
  p_provider text, p_segment text DEFAULT NULL,
  p_label text DEFAULT NULL, p_webhook_url text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_me text := NULLIF((SELECT auth.uid())::text, ''); v_key text; v_sec text; v_id uuid;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  IF p_webhook_url IS NOT NULL AND p_webhook_url !~ '^https://' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'HTTPS_REQUIRED');
  END IF;
  -- 🪤 يُولَّد على الخادم: مفتاحٌ يمرّ عبر متصفّحٍ أو محادثةٍ صار معروفاً.
  v_key := 'taki_' || encode(extensions.gen_random_bytes(24), 'hex');
  v_sec := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.stock_integrations
    (store_id, provider, segment, label, api_key_hash, api_key_last4, webhook_url, webhook_secret)
  VALUES (v_me, COALESCE(NULLIF(btrim(p_provider),''),'custom'), NULLIF(btrim(p_segment),''),
          NULLIF(btrim(p_label),''),
          encode(extensions.digest(v_key,'sha256'),'hex'), right(v_key, 4),
          NULLIF(btrim(p_webhook_url),''), v_sec)
  RETURNING id INTO v_id;
  -- 🔴 المفتاحُ يُعاد **مرّةً واحدة فقط** ولا يمكن استرجاعُه بعدها.
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'api_key', v_key,
    'webhook_secret', v_sec, 'shown_once', true,
    'endpoint', 'https://api.takisa.net/rest/v1/rpc/taki_stock_push');
END
$fn$;
REVOKE ALL ON FUNCTION public.merchant_create_integration(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_create_integration(text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_create_integration(text, text, text, text) TO authenticated;

DROP FUNCTION IF EXISTS public.merchant_link_product(uuid, text, text, text, text, text);
CREATE FUNCTION public.merchant_link_product(
  p_integration_id uuid, p_deal_id text, p_external_id text,
  p_variant_id text DEFAULT NULL, p_location_id text DEFAULT NULL, p_external_url text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_me text := NULLIF((SELECT auth.uid())::text, ''); v_store text;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT store_id INTO v_store FROM public.stock_integrations WHERE id = p_integration_id;
  IF v_store IS NULL OR v_store <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOUR_INTEGRATION');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.deals WHERE id = p_deal_id AND store_id = v_me) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOUR_DEAL');
  END IF;
  IF p_external_id IS NULL OR btrim(p_external_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EXTERNAL_ID_REQUIRED');
  END IF;
  INSERT INTO public.stock_links
    (integration_id, store_id, deal_id, variant_id, location_id, external_id, external_url)
  VALUES (p_integration_id, v_me, p_deal_id, NULLIF(btrim(p_variant_id),''),
          NULLIF(btrim(p_location_id),''), btrim(p_external_id), NULLIF(btrim(p_external_url),''))
  ON CONFLICT (integration_id, external_id) DO UPDATE
    SET deal_id = EXCLUDED.deal_id, variant_id = EXCLUDED.variant_id,
        location_id = EXCLUDED.location_id, external_url = EXCLUDED.external_url;
  RETURN jsonb_build_object('ok', true);
END
$fn$;
REVOKE ALL ON FUNCTION public.merchant_link_product(uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_link_product(uuid, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_link_product(uuid, text, text, text, text, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٨) الاتجاهُ الآخر — كلُّ حركةٍ عندنا تصير حدثاً يُسلَّم إليهم
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 لا يُكتب حدثٌ لمتجرٍ بلا اتصالٍ صادر: جدولٌ ينمو بلا قارئ دَينٌ صامت.
CREATE OR REPLACE FUNCTION public._taki_stock_event(
  p_deal_id text, p_variant_id text, p_location_id text,
  p_reason text, p_delta int, p_on_hand_after int, p_barcode text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_store text;
BEGIN
  SELECT store_id INTO v_store FROM public.deals WHERE id = p_deal_id;
  IF v_store IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_integrations
                  WHERE store_id = v_store AND is_enabled
                    AND direction IN ('out','both') AND webhook_url IS NOT NULL) THEN
    RETURN;
  END IF;
  INSERT INTO public.stock_events
    (store_id, deal_id, variant_id, location_id, reason, delta, on_hand_after, barcode)
  VALUES (v_store, p_deal_id, p_variant_id, p_location_id, p_reason, p_delta, p_on_hand_after, p_barcode);
END
$fn$;
REVOKE ALL ON FUNCTION public._taki_stock_event(text,text,text,text,int,int,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._taki_stock_event(text,text,text,text,int,int,text) FROM anon, authenticated;

-- ── يُربط بالكاتبين: البيعُ المباشر، وكلُّ ما يمرّ من الكاتب المُعلَن ──────
DO $wire$
DECLARE src text;
BEGIN
  -- (أ) البيع
  src := pg_get_functiondef('public.tr_on_hand_on_sale()'::regprocedure);
  IF position('_taki_stock_event' IN src) = 0 THEN
    IF position(E'  RETURN NEW;\nEND' IN src) = 0 THEN
      RAISE EXCEPTION '❌ مرساة نهاية مشغّل البيع غير موجودة.';
    END IF;
    -- 🪤 سلسلةٌ واحدة لا نصوصٌ متجاورة: ربطُ `E'…'` بـ`'…'` خطأُ تركيبٍ في
    --    PostgreSQL، وقد أسقط هذه الهجرة مرّةً قبل الآن.
    src := replace(src, E'  RETURN NEW;\nEND',
      E'  -- v15.08: يُخبَر نظامُ التاجر بأن قطعةً خرجت\n  PERFORM public._taki_stock_event(NEW.deal_id, NULL, NEW.location_id, ''sale'', -v_need, (SELECT on_hand FROM public.deals WHERE id = NEW.deal_id), NEW.barcode);\n  RETURN NEW;\nEND');
    EXECUTE src;
    IF position('_taki_stock_event' IN pg_get_functiondef('public.tr_on_hand_on_sale()'::regprocedure)) = 0 THEN
      RAISE EXCEPTION '❌ ربطُ حدث البيع لم يقع.';
    END IF;
  END IF;

  -- (ب) الإعلانُ والمزامنةُ والإرجاع — كلُّها تمرّ من `taki_set_on_hand`
  src := pg_get_functiondef('public.taki_set_on_hand(text,integer,jsonb,jsonb,timestamptz,text)'::regprocedure);
  IF position('_taki_stock_event' IN src) = 0 THEN
    IF position('  PERFORM set_config(''taki.stock_derived'', ''0'', true);' IN src) = 0 THEN
      RAISE EXCEPTION '❌ مرساة مخرج الكاتب المُعلَن غير موجودة.';
    END IF;
    src := replace(src, '  PERFORM set_config(''taki.stock_derived'', ''0'', true);',
      E'  -- v15.08: كلُّ إعلانٍ أو مزامنةٍ أو إرجاعٍ يصير حدثاً لنظام التاجر\n  PERFORM public._taki_stock_event(p_deal_id, NULL, NULL, p_source, NULL, v_d.on_hand, NULL);\n  PERFORM set_config(''taki.stock_derived'', ''0'', true);');
    EXECUTE src;
    IF position('_taki_stock_event' IN pg_get_functiondef(
         'public.taki_set_on_hand(text,integer,jsonb,jsonb,timestamptz,text)'::regprocedure)) = 0 THEN
      RAISE EXCEPTION '❌ ربطُ حدث الإعلان لم يقع.';
    END IF;
  END IF;
  RAISE NOTICE '✅ الحركاتُ تُسجَّل: بيعٌ · إعلانٌ · مزامنةٌ · إرجاع.';
END
$wire$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٩) عاملُ التسليم — نفسُ نمط طابور البريد المُجرَّب هنا
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.bot_pull_stock_events(int);
CREATE FUNCTION public.bot_pull_stock_events(p_limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_rows jsonb;
BEGIN
  IF NOT public._bot_gate_ok() THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;
  -- 🪤 `SKIP LOCKED` فلا يلتقط عاملان نفسَ الصفّ، و`picked_at` يُعيد العالق
  --    بعد عشر دقائق — عاملٌ مات وهو ممسكٌ بصفٍّ لا يجوز أن يُجمّده أبداً.
  WITH claimed AS (
    SELECT e.id FROM public.stock_events e
     WHERE e.status = 'pending'
       AND (e.picked_at IS NULL OR e.picked_at < now() - interval '10 minutes')
       AND e.attempts < 8
     ORDER BY e.id
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
     FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.stock_events e SET picked_at = now(), attempts = e.attempts + 1
      FROM claimed c WHERE e.id = c.id RETURNING e.*
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', u.id, 'store_id', u.store_id, 'deal_id', u.deal_id,
    'variant_id', u.variant_id, 'location_id', u.location_id,
    'reason', u.reason, 'delta', u.delta, 'on_hand', u.on_hand_after,
    'barcode', u.barcode, 'occurred_at', u.occurred_at,
    'external_id', (SELECT l.external_id FROM public.stock_links l
                     WHERE l.deal_id = u.deal_id
                       AND l.variant_id IS NOT DISTINCT FROM u.variant_id
                       AND l.location_id IS NOT DISTINCT FROM u.location_id LIMIT 1),
    'webhook_url', i.webhook_url, 'webhook_secret', i.webhook_secret
  ) ORDER BY u.id), '[]'::jsonb) INTO v_rows
  FROM upd u
  LEFT JOIN LATERAL (SELECT * FROM public.stock_integrations si
                      WHERE si.store_id = u.store_id AND si.is_enabled
                        AND si.direction IN ('out','both') AND si.webhook_url IS NOT NULL
                      ORDER BY si.created_at LIMIT 1) i ON true;
  RETURN jsonb_build_object('ok', true, 'events', v_rows);
END
$fn$;
REVOKE ALL ON FUNCTION public.bot_pull_stock_events(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bot_pull_stock_events(int) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.bot_mark_stock_event(bigint, boolean, text);
CREATE FUNCTION public.bot_mark_stock_event(p_id bigint, p_ok boolean, p_error text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT public._bot_gate_ok() THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;
  UPDATE public.stock_events
     SET status = CASE WHEN COALESCE(p_ok,false) THEN 'sent'
                       WHEN attempts >= 8 THEN 'failed' ELSE 'pending' END,
         sent_at = CASE WHEN COALESCE(p_ok,false) THEN now() ELSE sent_at END,
         last_error = left(COALESCE(p_error, ''), 500),
         picked_at = CASE WHEN COALESCE(p_ok,false) THEN picked_at ELSE NULL END
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END
$fn$;
REVOKE ALL ON FUNCTION public.bot_mark_stock_event(bigint, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bot_mark_stock_event(bigint, boolean, text) TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١٠) تحقّقٌ يرفع استثناءً — ومعه قياسٌ سلوكيّ كامل
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  n int; v_store text; v_deal text; v_int uuid; v_key text; v_res jsonb;
  v_oh0 int; v_oh1 int; v_ev int;
BEGIN
  -- (أ) البنية
  FOR n IN (SELECT 1 FROM (VALUES ('stock_integrations'),('stock_links'),('stock_inbox'),('stock_events')) v(t)
             WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables
                                WHERE table_schema='public' AND table_name=v.t)) LOOP
    RAISE EXCEPTION '❌ جدولٌ ناقص.';
  END LOOP;
  IF to_regprocedure('public.taki_stock_push(text,jsonb,timestamptz,text)') IS NULL
     OR to_regprocedure('public.merchant_create_integration(text,text,text,text)') IS NULL
     OR to_regprocedure('public.merchant_link_product(uuid,text,text,text,text,text)') IS NULL
     OR to_regprocedure('public.bot_pull_stock_events(integer)') IS NULL THEN
    RAISE EXCEPTION '❌ إحدى الدوال الأربع لم تُنشأ.';
  END IF;

  -- (ب) 🔴 لا يُقرأ المفتاح ولا السرّ من الجدول مهما كانت السياسة
  IF has_column_privilege('authenticated', 'public.stock_integrations', 'api_key_hash', 'SELECT')
     OR has_column_privilege('authenticated', 'public.stock_integrations', 'webhook_secret', 'SELECT') THEN
    RAISE EXCEPTION '❌ المفتاح أو سرُّ التوقيع مقروءٌ من الجدول — منحُ الجدول يُبطل منعَ العمود.';
  END IF;
  IF has_table_privilege('anon', 'public.stock_integrations', 'SELECT') THEN
    RAISE EXCEPTION '❌ الزائر يقرأ اتصالات التجار.';
  END IF;
  IF has_function_privilege('anon', 'public.merchant_create_integration(text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ الزائر يُنشئ اتصالاً.';
  END IF;
  -- والبابُ الوارد مفتوحٌ لـanon عمداً (نظامُ التاجر لا جلسةَ له) — يُفحص
  -- أنه يحرس نفسه: بصمةُ مفتاحٍ وحدُّ معدّل ومفتاحُ تكرار.
  DECLARE src text := regexp_replace(pg_get_functiondef('public.taki_stock_push(text,jsonb,timestamptz,text)'::regprocedure), '--[^\n]*', '', 'g');
  BEGIN
    IF position('taki_rate_check' IN src) = 0 THEN
      RAISE EXCEPTION '❌ البابُ الوارد بلا حدّ معدّل — وهو مفتوحٌ للإنترنت.';
    END IF;
    IF position('stock_inbox' IN src) = 0 THEN
      RAISE EXCEPTION '❌ البابُ الوارد بلا مفتاح تكرار — إعادةُ محاولةٍ تُطبَّق مرّتين.';
    END IF;
    IF position('digest' IN src) = 0 THEN
      RAISE EXCEPTION '❌ البابُ الوارد يقارن المفتاح خاماً.';
    END IF;
    -- 🪤 ولا يُسجَّل المفتاح في عدّاد المعدّل
    IF position('taki_rate_check(''stockpush:'' || left(v_hash' IN src) = 0 THEN
      RAISE EXCEPTION '❌ عدّادُ المعدّل قد يحمل المفتاح نفسه بدل بصمته.';
    END IF;
  END;

  -- (ج) قياسٌ سلوكيّ كامل: اتصالٌ ⇐ ربطٌ ⇐ دفعةٌ ⇐ أثرٌ ⇐ حدثٌ صادر
  SELECT d.id, d.store_id, d.on_hand INTO v_deal, v_store, v_oh0
    FROM public.deals d
   WHERE d.on_hand IS NOT NULL AND COALESCE(d.is_unlimited,false) = false
     AND public.taki_open_holds(d.id, NULL, NULL) = 0
   ORDER BY d.id LIMIT 1;

  IF v_deal IS NOT NULL THEN
    INSERT INTO public.stock_integrations
      (store_id, provider, segment, label, api_key_hash, api_key_last4, webhook_url, webhook_secret)
    VALUES (v_store, 'custom', 'other', 'verify',
            encode(extensions.digest('taki_verify_key_0123456789','sha256'),'hex'), '6789',
            'https://example.invalid/hook', 'sec')
    RETURNING id INTO v_int;
    INSERT INTO public.stock_links (integration_id, store_id, deal_id, external_id)
    VALUES (v_int, v_store, v_deal, 'VERIFY-SKU-1');

    v_res := public.taki_stock_push('taki_verify_key_0123456789',
      jsonb_build_array(jsonb_build_object('external_id','VERIFY-SKU-1','on_hand', v_oh0 + 13),
                        jsonb_build_object('external_id','NOT-LINKED','on_hand', 5)),
      now(), 'verify-event-1');
    IF NOT COALESCE((v_res->>'ok')::boolean,false) OR (v_res->>'applied')::int <> 1 THEN
      RAISE EXCEPTION '❌ الدفعةُ لم تُطبَّق: %', v_res::text;
    END IF;
    IF jsonb_array_length(v_res->'unmatched') <> 1 THEN
      RAISE EXCEPTION '❌ الكودُ غيرُ المربوط لم يُعَد في الردّ — نظامُ التاجر لن يعرف ما يربطه.';
    END IF;
    SELECT on_hand INTO v_oh1 FROM public.deals WHERE id = v_deal;
    IF v_oh1 <> v_oh0 + 13 THEN
      RAISE EXCEPTION '❌ المخزون لم يتغيّر بالدفعة (% ⇐ %).', v_oh0, v_oh1;
    END IF;

    -- 🔴 والتكرار: نفسُ الحدث مرّةً ثانية لا يُطبَّق
    v_res := public.taki_stock_push('taki_verify_key_0123456789',
      jsonb_build_array(jsonb_build_object('external_id','VERIFY-SKU-1','on_hand', v_oh0 + 99)),
      now(), 'verify-event-1');
    IF NOT COALESCE((v_res->>'duplicate')::boolean,false) THEN
      RAISE EXCEPTION '❌ حدثٌ مكرَّر طُبِّق ثانيةً: %', v_res::text;
    END IF;
    SELECT on_hand INTO v_oh1 FROM public.deals WHERE id = v_deal;
    IF v_oh1 <> v_oh0 + 13 THEN
      RAISE EXCEPTION '❌ التكرارُ غيّر المخزون إلى %.', v_oh1;
    END IF;

    -- ومفتاحٌ خاطئ يُرفض
    v_res := public.taki_stock_push('taki_wrong_key_9999999999999',
      jsonb_build_array(jsonb_build_object('external_id','VERIFY-SKU-1','on_hand', 1)), now(), 'x');
    IF COALESCE((v_res->>'ok')::boolean,false) THEN
      RAISE EXCEPTION '❌ مفتاحٌ خاطئ قُبل.';
    END IF;

    -- والحدثُ الصادر كُتب
    SELECT count(*) INTO v_ev FROM public.stock_events
     WHERE deal_id = v_deal AND reason = 'sync' AND status = 'pending';
    IF v_ev < 1 THEN
      RAISE EXCEPTION '❌ لم يُكتب حدثٌ صادر — الاتجاهُ الآخر معطَّل.';
    END IF;

    -- الاستعادة الكاملة
    PERFORM public.taki_set_on_hand(v_deal, v_oh0, NULL, NULL, NULL, 'init');
    DELETE FROM public.stock_events WHERE deal_id = v_deal;
    DELETE FROM public.stock_integrations WHERE label = 'verify';
    SELECT on_hand INTO v_oh1 FROM public.deals WHERE id = v_deal;
    IF v_oh1 <> v_oh0 THEN RAISE EXCEPTION '❌ العرض % لم يعد إلى %.', v_deal, v_oh0; END IF;
    RAISE NOTICE '✅ سلوكيّاً: دفعةٌ طُبِّقت (%⇐%) · كودٌ غيرُ مربوطٍ أُعيد · تكرارٌ رُفض · مفتاحٌ خاطئ رُفض · حدثٌ صادر كُتب · وأُعيد كلُّ شيء.', v_oh0, v_oh0 + 13;
  END IF;

  -- (د) والمعادلة سليمة
  SELECT count(*) INTO n FROM public.deals d
   WHERE d.on_hand IS NOT NULL
     AND COALESCE(d.quantity,-1) <> GREATEST(0, d.on_hand - public.taki_open_holds(d.id,NULL,NULL));
  IF n > 0 THEN RAISE EXCEPTION '❌ % عرضاً خرج عن المعادلة.', n; END IF;

  RAISE NOTICE '✅ v15.08: عقدٌ واحد يتكلّمه أيُّ نظام · كمّياتٌ مطلقة · لحظةُ ملاحظةٍ ومفتاحُ تكرار · والاتجاهُ الآخر مسجَّل.';
END
$verify$;
