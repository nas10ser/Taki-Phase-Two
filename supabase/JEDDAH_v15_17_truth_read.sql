-- ═══════════════════════════════════════════════════════════════════════════
-- v15.17 — «إشارةٌ ثمّ إعادةُ قراءة» · ورابطٌ لكلّ متجر يُعاد إصدارُه
-- ═══════════════════════════════════════════════════════════════════════════
-- طلبُ ناصر: «أكمل ربط سلّة وزد». وأهمُّ الناقص بندُه الأوّل، وهو صحيحٌ تماماً:
--
-- 🔴 **لا سلّة ولا زد تُرسل حدثاً لتغيّر المخزون.** سلّة أهملت
--    `product.updated`، و`product.quantity.low` لا تنطلق إلا عند حدٍّ منخفض؛
--    وزد عندها `product.update` العامّ وحده. فالرسالةُ الواصلة **إشارة** لا
--    حقيقة، والرقمُ الصحيح يُقرأ من واجهتهم بعدها.
--    ⇒ وبلا هذه الحلقة يكون الربطُ كلُّه تخميناً: تبيع في كاشيرك فلا يتغيّر
--      شيءٌ في تاكي، لأن لا حدثَ خرج أصلاً.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 وأربعةُ قياساتٍ قلبت التصميم عمّا كنتُ سأكتبه — تُقال كما قِيست:
--
-- ١) **القاعدةُ نفسها تصل الإنترنت.** قِيس من داخل حاوية `supabase-db` على
--    جدة: `net.http_get('https://docs.zid.sa/llms.txt')` ⇒ ٢٠٠، و
--    `net.http_get('https://api.salla.dev/admin/v2/store/info')` ⇒ ٤٠١ (أي
--    وصلناه وردّ «غير موثَّق»). ⇒ **فلا دالّة حافةٍ جديدة للعامل.** وهذا
--    أسلمُ لا أسهلُ فقط: كلُّ سطحٍ عامٍّ جديد على هذا الخادم يرث
--    `VERIFY_JWT=false` فيبدأ بلا أيّ حماية ويجب أن يبني حارسَه بنفسه،
--    والتوكناتُ هنا لا تخرج من القاعدة إطلاقاً.
--
-- ٢) **و`pg_net` غيرُ متزامن.** `net.http_get` تُرجع رقمَ طلبٍ فوراً والردُّ
--    يهبط لاحقاً في `net._http_response`. ⇒ فالعاملُ **شطران**: شطرٌ يُرسل
--    وشطرٌ يجمع. وقِيس `pg_net.ttl = 6 hours` فالجامعُ كلَّ دقيقة آمنٌ بفارقٍ
--    كبير — لكنّ ردّاً مفقوداً **يجب أن يُعامَل فشلاً قابلاً للإعادة** لا أن
--    يُنتظر إلى الأبد.
--
-- ٣) **ولا يجوز أن تُعاد القراءةُ داخل الخطّاف.** وثيقةُ زد: ١٠ فشلاتٍ في
--    ساعة ⇒ `degraded`، و٣٠ ⇒ `broken`. ونداءٌ خارجيٌّ متزامنٌ داخل الخطّاف
--    يُطيل الردّ فيُحسب فشلاً. ⇒ الخطّاف يردّ فوراً **ويُدرج في طابور**.
--
-- ٤) **وسقفُ زد ٦٠ نداءً في الدقيقة للتطبيق في المتجر.** ⇒ فالطابور
--    **يُدمج**: خمسون إشارةً لنفس المنتج تصير صفّاً واحداً، ولكلّ اتصالٍ
--    سقفُ نداءاتٍ في كلّ نبضة مشتقٌّ من سقف مزوّده لا مخترَع.
--
-- 🪤 والبندُ الثاني من طلب ناصر: **دائرةُ زد القاطعة ترفض إعادةَ استخدام نفس
--    الرابط.** واليوم الرابطُ هو `?k=<المفتاح>` — أي أن إصلاحَ خطّافٍ معطوب
--    كان يستلزم تدويرَ المفتاح، فيكسر كلَّ نظامٍ آخر يحمله. ⇒ يُفصل
--    **العنوان** عن **السرّ**: مسارٌ لكلّ متجر (`/h/<slug>`) يُعاد إصدارُه
--    بضغطة، والمفتاح يبقى كما هو — ومقبضان مستقلّان.
--    (وقِيس أن المسارَ الفرعيّ يصل دالّة الحافة فعلاً: `/h/abc123` ردّ من
--     الدالّة نفسها لا ٤٠٤.)
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_stock_webhook(text,jsonb,text)') IS NULL
     OR to_regprocedure('public.taki_stock_push(text,jsonb,timestamptz,text)') IS NULL
     OR to_regprocedure('public._taki_provider_map(text)') IS NULL THEN
    RAISE EXCEPTION 'v15.08/12/13 غير مطبَّقة — أوقِفت.';
  END IF;
  IF position('skip_when' IN pg_get_functiondef('public.taki_stock_webhook(text,jsonb,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'v15.15 غير مطبَّقة (لا skip_when في النصّ الحيّ) — أوقِفت.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'pg_net غير مثبَّت — ولا عاملَ بلا نداءٍ خارجيّ. أوقِفت.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'pg_cron غير مثبَّت — أوقِفت.';
  END IF;
  -- 🔴 وأنا على وشك **إعادة تشكيل** `taki_stock_push` (أستخرج حلقةَ التطبيق
  --    منها لتُنادى من العامل بلا مفتاحٍ نصّيّ — والمفتاحُ لا يُخزَّن أصلاً).
  -- 🪤 وأوّلُ صياغةٍ للحارس كانت **بصمةَ md5** للنصّ الحيّ، فأوقفت الهجرةَ
  --    لحظةَ تطبيق v15.16 — وهي أوقفتها **بحقّ**: فالنسخةُ التي كنتُ سأكتبها
  --    مأخوذةٌ من النصّ قبل v15.16، أي أنها كانت **ستُرجع المحاسبةَ المعطوبة
  --    بصمت** («طُبّق» لما لم يُكتب). فصار الحارسُ على **المعنى**: إصلاحُ
  --    v15.16 يجب أن يكون حاضراً، والنسخةُ الجديدة تحمله، والفحصُ يُعيد قياسَه.
  IF position('v15.16 skip' IN
       pg_get_functiondef('public.taki_stock_push(text,jsonb,timestamptz,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'v15.16 غير مطبَّقة على taki_stock_push — ولا يُعاد تشكيلُها قبلها. أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) مسارٌ لكلّ متجر — عنوانٌ يُعاد إصدارُه، منفصلٌ عن السرّ
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.stock_integrations ADD COLUMN IF NOT EXISTS webhook_slug text;
ALTER TABLE public.stock_integrations ADD COLUMN IF NOT EXISTS webhook_rev  int NOT NULL DEFAULT 1;
-- 🪤 وهو **ليس** مُجزَّأً خلافاً للمفتاح، وذلك فرقٌ مقصود: المفتاحُ يُعرض
--    مرّةً ولا يُسترجع، أمّا العنوانُ فيجب أن يُعرض كلَّ مرّةٍ ليُلصق ثانيةً.
--    فهو «عنوانٌ ذو قدرة» (capability URL): سرُّه في طوله، وتخفيفُه أنه
--    يُعاد إصدارُه بضغطة، وأنه يُضاف إليه توقيعُ المنصّة حين يوجد سرُّها.
COMMENT ON COLUMN public.stock_integrations.webhook_slug IS
  'مسارُ خطّاف هذا المتجر (v15.17): /functions/v1/stock-webhook/h/<slug>. يُعاد إصدارُه بلا مسّ المفتاح — دائرةُ زد القاطعة ترفض إعادةَ استخدام رابطٍ عُطّل.';
COMMENT ON COLUMN public.stock_integrations.webhook_rev IS
  'جيلُ الرابط. يُعرض للتاجر ليعرف أيّ رابطٍ لصق — وبلا رقمٍ ظاهر لا يستطيع أن يعرف.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_stock_integrations_slug
  ON public.stock_integrations (webhook_slug) WHERE webhook_slug IS NOT NULL;

-- تعبئةُ ما سبق (صفرُ صفٍّ اليوم — قِيس — لكنها آمنةٌ للتكرار)
UPDATE public.stock_integrations
   SET webhook_slug = encode(extensions.gen_random_bytes(18), 'hex')
 WHERE webhook_slug IS NULL;

GRANT SELECT (id, store_id, provider, segment, label, api_key_last4, webhook_url,
              direction, is_enabled, last_seen_at, created_at,
              field_map, last_payload, last_payload_at, last_note,
              webhook_slug, webhook_rev)
  ON public.stock_integrations TO authenticated;

DROP FUNCTION IF EXISTS public.merchant_reissue_webhook_path(uuid);
CREATE FUNCTION public.merchant_reissue_webhook_path(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_me text := NULLIF((SELECT auth.uid())::text, ''); v_owner text;
        v_slug text; v_rev int;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT store_id INTO v_owner FROM public.stock_integrations WHERE id = p_id;
  IF v_owner IS NULL OR v_owner <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOURS');
  END IF;
  v_slug := encode(extensions.gen_random_bytes(18), 'hex');
  UPDATE public.stock_integrations
     SET webhook_slug = v_slug,
         webhook_rev  = webhook_rev + 1,
         -- 🪤 ويُطفأ وسمُ الحالة: العنوانُ الجديد لم يُجرَّب بعد، وإبقاءُ
         --    «يعمل ✅» عليه كذبٌ حتى تصل أوّلُ رسالةٍ إليه.
         last_note    = 'NEW_URL_NOT_TRIED'
   WHERE id = p_id
   RETURNING webhook_rev INTO v_rev;
  RETURN jsonb_build_object('ok', true, 'slug', v_slug, 'rev', v_rev);
END
$fn$;
REVOKE ALL ON FUNCTION public.merchant_reissue_webhook_path(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_reissue_webhook_path(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_reissue_webhook_path(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) فصلُ «التطبيق» عن «المصادقة» — لأن العامل لا يملك مفتاحاً نصّياً
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 عقبةٌ حقيقية كادت تُفسد التصميم كلَّه: `taki_stock_push` تُصادِق بـ
--    `p_key` النصّيّ، و**المفتاحُ لا يُخزَّن عندنا أصلاً** (sha256 وlast4 فقط —
--    وهو قرارٌ سليم من v15.08). فعاملٌ يعمل داخل القاعدة لا يستطيع مناداتَها.
--    ⇒ تُستخرج حلقةُ التطبيق كما هي إلى دالّةٍ داخلية تُصادِق بـ**معرّف
--      الاتصال**، وتصير `taki_stock_push` غلافاً نحيفاً: مفتاحٌ ⇒ اتصالٌ ⇒ تطبيق.
-- 🪤 والسلوكُ الظاهر يجب أن يبقى **حرفياً** كما هو: نفسُ رموز الأخطاء، ونفسُ
--    حدّ المعدّل، ونفسُ شكل الردّ. والفحصُ في آخر الملفّ يقيس ذلك واحداً واحداً.
DROP FUNCTION IF EXISTS public._taki_stock_apply(uuid, jsonb, timestamptz, text);
CREATE FUNCTION public._taki_stock_apply(
  p_integration_id uuid,
  p_items          jsonb,
  p_observed_at    timestamptz DEFAULT NULL,
  p_event_id       text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_i     public.stock_integrations%ROWTYPE;
  v_at    timestamptz := COALESCE(p_observed_at, now());
  v_it    jsonb;
  v_link  public.stock_links%ROWTYPE;
  v_ok    int := 0; v_skip int := 0;
  v_unmatched jsonb := '[]'::jsonb;
  v_skipwhy   jsonb := '[]'::jsonb;   -- v15.16 skip: لماذا لم يُكتب
  v_res   jsonb;
  v_n     int;
BEGIN
  SELECT * INTO v_i FROM public.stock_integrations
   WHERE id = p_integration_id AND is_enabled AND direction IN ('in','both');
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
    -- v15.16 skip — `taki_set_on_hand` تُرجع `ok:true` مع `skipped` ولا تكتب
    --   شيئاً (UNLIMITED · STALE_OBSERVATION). وعدُّها تطبيقاً كان يجعل
    --   الشاشة تقول «فُهمت وطُبّقت» والرقمُ لم يتحرّك.
    -- 🔴 ويُنقل هذا الإصلاحُ هنا **عمداً ومقيساً**: الاستخراجُ من نصٍّ قديم
    --    كان سيُرجع العيب، والحارسُ في أعلى الملفّ هو الذي كشفه.
    IF COALESCE((v_res->>'ok')::boolean, false)
       AND COALESCE(v_res->>'skipped', '') = '' THEN
      v_ok := v_ok + 1;
    ELSE
      v_skip := v_skip + 1;
      v_skipwhy := v_skipwhy || to_jsonb(COALESCE(NULLIF(v_res->>'skipped', ''),
                                                  NULLIF(v_res->>'error', ''), 'FAILED'));
    END IF;
  END LOOP;

  UPDATE public.stock_integrations SET last_seen_at = now() WHERE id = v_i.id;
  RETURN jsonb_build_object('ok', true, 'applied', v_ok, 'skipped', v_skip,
                            'skip_reasons', v_skipwhy,
                            'unmatched', v_unmatched, 'observed_at', v_at);
END
$fn$;
-- 🪤 داخليّةٌ تماماً: من يناديها يكتب في مخزون أيّ متجرٍ بلا مفتاح.
REVOKE ALL ON FUNCTION public._taki_stock_apply(uuid, jsonb, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._taki_stock_apply(uuid, jsonb, timestamptz, text) FROM anon;
REVOKE ALL ON FUNCTION public._taki_stock_apply(uuid, jsonb, timestamptz, text) FROM authenticated;

-- والغلافُ: مفتاحٌ ⇒ حدُّ معدّل ⇒ اتصالٌ ⇒ تطبيق. بنفسِ السلوك حرفياً.
DROP FUNCTION IF EXISTS public.taki_stock_push(text, jsonb, timestamptz, text);
CREATE FUNCTION public.taki_stock_push(
  p_key         text,
  p_items       jsonb,
  p_observed_at timestamptz DEFAULT NULL,
  p_event_id    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_hash text; v_id uuid;
BEGIN
  IF p_key IS NULL OR length(btrim(p_key)) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_KEY');
  END IF;
  -- 🪤 حدُّ المعدّل **قبل** أيّ عملٍ وعلى بصمة المفتاح لا على المفتاح:
  --    لئلّا يُسجَّل سرٌّ في `rate_limit_counters`.
  v_hash := encode(extensions.digest(btrim(p_key), 'sha256'), 'hex');
  PERFORM public.taki_rate_check('stockpush:' || left(v_hash, 16), 120, 60,
                                 'too many stock pushes — slow down');
  SELECT id INTO v_id FROM public.stock_integrations
   WHERE api_key_hash = v_hash AND is_enabled AND direction IN ('in','both');
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'UNKNOWN_KEY'); END IF;
  RETURN public._taki_stock_apply(v_id, p_items, p_observed_at, p_event_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.taki_stock_push(text, jsonb, timestamptz, text) FROM PUBLIC;
-- 🪤 ممنوحةٌ لـanon عمداً (نفسُ قرار v15.08): نظامُ التاجر يحمل مفتاحَه لا
--    جلسةَ مستخدم، والحارسُ هو المفتاحُ المُجزَّأ وحدُّ المعدّل.
GRANT EXECUTE ON FUNCTION public.taki_stock_push(text, jsonb, timestamptz, text) TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) الطابور — إشارةٌ تُدمج، لا نداءٌ لكلّ رسالة
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stock_refresh_queue (
  id             bigserial PRIMARY KEY,
  integration_id uuid NOT NULL REFERENCES public.stock_integrations(id) ON DELETE CASCADE,
  store_id       text NOT NULL,
  -- NULL = «أعِد قراءة كلّ منتجٍ مربوطٍ بهذا الاتصال»
  external_id    text,
  reason         text NOT NULL CHECK (reason IN ('signal','periodic','manual','connect')),
  signal_event   text,
  due_at         timestamptz NOT NULL DEFAULT now(),
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','awaiting','done','failed')),
  attempts       int NOT NULL DEFAULT 0,
  request_id     bigint,                       -- رقمُ طلب pg_net
  sent_at        timestamptz,
  done_at        timestamptz,
  http_status    int,
  last_error     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.stock_refresh_queue IS
  'طابورُ إعادة القراءة (v15.17). رسالةُ سلّة/زد إشارةٌ لا حقيقة — فالرقمُ يُقرأ من واجهتهم، والنداءُ لا يقع داخل الخطّاف (دائرةُ زد تحسب الردَّ البطيء فشلاً).';

-- 🔴 **الدمجُ هو ما يجعل السقف كافياً**: صفٌّ معلّقٌ واحدٌ لكلّ هدف. خمسون
--    `product.update` في ثانيةٍ تصير نداءً واحداً — وبلا هذا كان سقفُ زد
--    (٦٠/دقيقة) يُستهلك في ثوانٍ ثمّ يبدأ ٤٢٩ فتُعطَّل المزامنة.
CREATE UNIQUE INDEX IF NOT EXISTS ux_stock_refresh_pending
  ON public.stock_refresh_queue (integration_id, COALESCE(external_id, '*'))
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ix_stock_refresh_due
  ON public.stock_refresh_queue (due_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ix_stock_refresh_awaiting
  ON public.stock_refresh_queue (sent_at) WHERE status = 'awaiting';
CREATE INDEX IF NOT EXISTS ix_stock_refresh_store
  ON public.stock_refresh_queue (store_id, created_at DESC);

ALTER TABLE public.stock_refresh_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_refresh_own ON public.stock_refresh_queue;
CREATE POLICY stock_refresh_own ON public.stock_refresh_queue FOR SELECT TO authenticated
  USING (store_id = (SELECT auth.uid())::text OR public.taki_admin_perm('tab_launch'));
-- 🪤 ولا سياسةَ كتابةٍ: كلُّ إدراجٍ من دالّةٍ مالكة. والتاجر يرى طابورَه
--    ليعرف **لماذا** لم يتحدّث رقمُه — وشاشةٌ بلا سببٍ تُعيده إلى ناصر.
REVOKE ALL ON public.stock_refresh_queue FROM anon, authenticated;
GRANT SELECT (id, integration_id, store_id, external_id, reason, signal_event,
              due_at, status, attempts, sent_at, done_at, http_status, last_error, created_at)
  ON public.stock_refresh_queue TO authenticated;

-- ── الإدراج: يُدمج ويُؤجَّل قليلاً ───────────────────────────────────────
-- 🪤 والتأجيلُ الصغير مقصود: نظامُ التاجر يُرسل دفعةَ أحداثٍ متلاحقة عند أيّ
--    تعديل، فقراءةٌ فوريّةً مع أوّلها تُقرأ قبل أن يستقرّ الباقي.
DROP FUNCTION IF EXISTS public._taki_stock_enqueue(uuid, text, text, text, int);
CREATE FUNCTION public._taki_stock_enqueue(
  p_integration_id uuid, p_external_id text, p_reason text,
  p_signal_event text DEFAULT NULL, p_debounce_seconds int DEFAULT 10
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_store text; v_id bigint; v_due timestamptz;
BEGIN
  SELECT store_id INTO v_store FROM public.stock_integrations WHERE id = p_integration_id;
  IF v_store IS NULL THEN RETURN NULL; END IF;
  v_due := now() + make_interval(secs => GREATEST(COALESCE(p_debounce_seconds, 10), 0));
  INSERT INTO public.stock_refresh_queue
    (integration_id, store_id, external_id, reason, signal_event, due_at)
  VALUES (p_integration_id, v_store, NULLIF(btrim(COALESCE(p_external_id,'')),''),
          p_reason, NULLIF(btrim(COALESCE(p_signal_event,'')),''), v_due)
  ON CONFLICT (integration_id, COALESCE(external_id, '*')) WHERE status = 'pending'
  DO UPDATE SET
    -- الأقربُ يفوز: إشارةٌ جديدةٌ لا تُؤخّر قراءةً كانت أوشكت.
    due_at       = LEAST(stock_refresh_queue.due_at, EXCLUDED.due_at),
    signal_event = COALESCE(EXCLUDED.signal_event, stock_refresh_queue.signal_event)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$fn$;
REVOKE ALL ON FUNCTION public._taki_stock_enqueue(uuid, text, text, text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._taki_stock_enqueue(uuid, text, text, text, int) FROM anon;
REVOKE ALL ON FUNCTION public._taki_stock_enqueue(uuid, text, text, text, int) FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) وصفُ القراءة لكلّ مزوّد — بياناتٌ من وثيقته، لا كودٌ لكلّ واحد
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 نفسُ نمط `_taki_provider_map`: المعرفةُ بياناتٌ في مكانٍ واحد. وكلُّ قيمةٍ
--    هنا **قُرئت من وثيقةٍ رسمية ومعها رابطُها**، وما لم تُفتح وثيقتُه يُرجع
--    `NULL` فلا يُقرأ منه شيء — ولا يُخترع اسمُ حقلٍ أبداً (دَرسٌ مدفوع).
--
-- 🔴 وثلاثةُ قياساتٍ قلبت أوّلَ تصميمٍ كتبتُه:
--   ١) **قراءةُ منتجٍ واحدٍ متاحةٌ عند الاثنين** — فلا داعيَ لترقيم كتالوجٍ
--      كامل. سلّة: `GET /products/sku/{sku}`؛ زد: `GET /v1/products/{id}/stocks/`.
--      (وأوّلُ تصميمٍ لي كان سيُرقّم كتالوج سلّة كلَّه: ١٦٧ نداءً لمتجرٍ فيه
--       عشرةُ آلاف منتج، كلَّ عشر دقائق. المدقّقُ أمسكها.)
--   ٢) **وزد تحتاج ترويستين لا واحدة**، وقيمتاهما مختلفتان من نفس الردّ:
--      `Authorization: Bearer <authorization>` و`X-Manager-Token: <access_token>`.
--      ووثيقتهم صريحة: «One without the other fails».
--   ٣) **وسقفُ سلّة لكلّ متجرٍ بحسب باقته** (Plus ١٢٠ · Pro ٣٦٠ · Special ٧٢٠
--      في الدقيقة). ولا نعرف باقةَ التاجر ⇒ **يُفترض الأدنى** دائماً.
CREATE OR REPLACE FUNCTION public._taki_provider_read(p_provider text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE lower(COALESCE(p_provider, ''))
    -- ╭─ سلّة ─ https://docs.salla.dev/product/product-details-sku.md ──────╮
    -- الردّ: {status, success, data:{quantity, unlimited_quantity,
    --         skus:[{sku, stock_quantity, unlimited_quantity}]}}
    -- 🪤 والصنفُ يُطابق بـ`sku` داخل `data.skus[]`؛ وبلا مطابقةٍ يُقرأ
    --    `data.quantity` للمنتج كلّه. والعلَمُ `unlimited_quantity` يُسقط الصفّ.
    WHEN 'salla' THEN jsonb_build_object(
      'shape',  'salla',
      'base',   'https://api.salla.dev/admin/v2',
      'path',   '/products/sku/{id}',
      'rpm',    120,
      'doc',    'https://docs.salla.dev/product/product-details-sku.md',
      'rate_doc','https://docs.salla.dev/rate-limiting.md')
    -- ╭─ زد ─ https://docs.zid.sa/list-product-stocks.md ───────────────────╮
    -- الردّ: {count, next, previous, results:[{id, location:{id,…},
    --         available_quantity, is_infinite}]}  — **بلا غلاف `data`**
    -- 🔴 والكمّيةُ اسمُها `available_quantity` لا `quantity`، و**قد تكون
    --    `null`** (مع `is_infinite: true`) ⇒ فلا تُقرأ صفراً أبداً.
    WHEN 'zid' THEN jsonb_build_object(
      'shape',  'zid',
      'base',   'https://api.zid.sa',
      'path',   '/v1/products/{id}/stocks/',
      'rpm',    60,
      'doc',    'https://docs.zid.sa/list-product-stocks.md',
      'rate_doc','https://docs.zid.sa/rate-limiting-644369m0.md')
    ELSE NULL END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤-ب) ترويساتُ كلّ مزوّد — من ردّ التوكن نفسه
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public._taki_provider_headers(text, jsonb);
CREATE FUNCTION public._taki_provider_headers(p_provider text, p_tok jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE lower(COALESCE(p_provider, ''))
    WHEN 'salla' THEN jsonb_build_object(
      'Authorization', 'Bearer ' || COALESCE(p_tok->>'access_token', ''),
      'Accept', 'application/json')
    -- 🔴 ترويستان، وقيمتاهما **مختلفتان**: `authorization` توكنُ التطبيق
    --    (JWT) و`access_token` توكنُ المتجر. وخلطُهما يُنتج ٤٠١ دائماً.
    WHEN 'zid' THEN jsonb_build_object(
      'Authorization',   'Bearer ' || COALESCE(p_tok->>'authorization', ''),
      'X-Manager-Token', COALESCE(p_tok->>'access_token', ''),
      'Accept', 'application/json')
    ELSE jsonb_build_object('Accept', 'application/json') END;
$fn$;
REVOKE ALL ON FUNCTION public._taki_provider_headers(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._taki_provider_headers(text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public._taki_provider_headers(text, jsonb) FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) قراءةُ الردّ ⇒ كمّيةٌ مطلقةٌ واحدة لهذا السطر
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 **فُصل التحليلُ عن النقل عمداً**: الشبكةُ لا تُختبر في هجرة، أمّا شكلُ
--    الردّ فيُختبر بحمولةٍ منسوخةٍ من الوثيقة حرفياً — وهو الجزءُ الذي يكسر
--    بصمتٍ لو أخطأتُ اسمَ حقل.
-- 🪤 وفرعان صريحان لا «محلّلٌ عامٌّ بمسارات»: الشكلان مختلفان بنيوياً (غلافٌ
--    مقابل جذر · صنفٌ مقابل فرع · علمُ «بلا حدّ» في موضعين)، ومحلّلٌ عامٌّ
--    يُنتج رقماً خاطئاً **بلا خطأ** — وهو أسوأُ ما يمكن أن يحدث لمخزون.
DROP FUNCTION IF EXISTS public._taki_stock_parse_read(text, jsonb, text, text);
CREATE FUNCTION public._taki_stock_parse_read(
  p_provider text, p_body jsonb, p_external_id text, p_location_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_sh  text := lower(COALESCE(public._taki_provider_read(p_provider)->>'shape', ''));
  v_r   jsonb;
  v_q   bigint := NULL;
  v_any boolean := false;
BEGIN
  IF p_body IS NULL OR jsonb_typeof(p_body) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BODY_NOT_OBJECT');
  END IF;

  -- ╭─ سلّة ──────────────────────────────────────────────────────────────╮
  IF v_sh = 'salla' THEN
    IF jsonb_typeof(COALESCE(p_body->'data', 'null'::jsonb)) <> 'object' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'NO_DATA');
    END IF;
    -- الصنفُ أوّلاً: سطرٌ في `data.skus[]` يحمل نفس الـSKU المربوط
    FOR v_r IN SELECT * FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(COALESCE(p_body->'data'->'skus','null'::jsonb)) = 'array'
                      THEN p_body->'data'->'skus' ELSE '[]'::jsonb END) LOOP
      IF COALESCE(v_r->>'sku', '') = p_external_id THEN
        IF lower(COALESCE(v_r->>'unlimited_quantity', '')) IN ('true', '1') THEN
          RETURN jsonb_build_object('ok', false, 'reason', 'UNLIMITED');
        END IF;
        IF COALESCE(v_r->>'stock_quantity', '') ~ '^[0-9]+$' THEN
          RETURN jsonb_build_object('ok', true, 'on_hand', (v_r->>'stock_quantity')::int,
                                    'level', 'variant');
        END IF;
        RETURN jsonb_build_object('ok', false, 'reason', 'QTY_NOT_A_NUMBER');
      END IF;
    END LOOP;
    -- وإلّا فالمنتجُ كلُّه
    IF lower(COALESCE(p_body->'data'->>'unlimited_quantity', '')) IN ('true', '1') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'UNLIMITED');
    END IF;
    IF COALESCE(p_body->'data'->>'quantity', '') ~ '^[0-9]+$' THEN
      RETURN jsonb_build_object('ok', true, 'on_hand', (p_body->'data'->>'quantity')::int,
                                'level', 'product');
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'QTY_NOT_A_NUMBER');
  END IF;

  -- ╭─ زد ───────────────────────────────────────────────────────────────╮
  IF v_sh = 'zid' THEN
    IF jsonb_typeof(COALESCE(p_body->'results', 'null'::jsonb)) <> 'array' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'NO_RESULTS');
    END IF;
    FOR v_r IN SELECT * FROM jsonb_array_elements(p_body->'results') LOOP
      -- فرعٌ بعينه إن كان السطرُ مربوطاً بفرع، وإلّا فكلُّ الفروع
      CONTINUE WHEN p_location_id IS NOT NULL
                AND COALESCE(v_r->'location'->>'id', '') <> p_location_id;
      -- 🔴 «بلا حدّ» يُسقط السطرَ كلَّه ولا يُجمع صفراً: `available_quantity`
      --    تأتي `null` مع `is_infinite: true` في مثال وثيقتهم نفسه.
      IF lower(COALESCE(v_r->>'is_infinite', '')) IN ('true', '1') THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'UNLIMITED');
      END IF;
      IF COALESCE(v_r->>'available_quantity', '') ~ '^[0-9]+$' THEN
        v_q := COALESCE(v_q, 0) + (v_r->>'available_quantity')::bigint;
        v_any := true;
      END IF;
    END LOOP;
    IF NOT v_any THEN
      RETURN jsonb_build_object('ok', false, 'reason',
        CASE WHEN p_location_id IS NULL THEN 'NO_USABLE_RECORD' ELSE 'LOCATION_NOT_FOUND' END);
    END IF;
    -- 🪤 سقفٌ عاقل: `taki_set_on_hand` ترفض السالب، ولا شيءَ يرفض رقماً خرافياً.
    IF v_q > 1000000 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'QTY_ABSURD', 'got', v_q);
    END IF;
    RETURN jsonb_build_object('ok', true, 'on_hand', v_q::int,
      'level', CASE WHEN p_location_id IS NULL THEN 'all_locations' ELSE 'location' END);
  END IF;

  RETURN jsonb_build_object('ok', false, 'reason', 'NO_SHAPE');
END
$fn$;
REVOKE ALL ON FUNCTION public._taki_stock_parse_read(text, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._taki_stock_parse_read(text, jsonb, text, text) FROM anon;
REVOKE ALL ON FUNCTION public._taki_stock_parse_read(text, jsonb, text, text) FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٦) التوكن — في الخزنة بالاسم القانونيّ، لا بمؤشّرٍ يتعفّن
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 درسُ v14.44 حرفياً: مؤشّرُ uuid إلى الخزنة **مفتاحٌ أجنبيٌّ لا تفرضه
--    القاعدة** فيتعفّن بصمت، و`vault.update_secret` على مؤشّرٍ ميت تكتب صفرَ
--    صفوفٍ **بلا استثناء** فيبدو الحفظُ ناجحاً. ⇒ الاسمُ هو المصدر:
--    `stock_tok:<معرّف الاتصال>`، وكلُّ كتابةٍ تُثبَت بقراءةٍ بعدها.
-- 🪤 ولا يُوضع تحت بادئة `app_secret:` لئلّا يظهر في عرض `app_secrets` العامّ.
ALTER TABLE public.stock_integrations ADD COLUMN IF NOT EXISTS oauth_expires_at timestamptz;
ALTER TABLE public.stock_integrations ADD COLUMN IF NOT EXISTS oauth_scope      text;
ALTER TABLE public.stock_integrations ADD COLUMN IF NOT EXISTS oauth_remote_id  text;
ALTER TABLE public.stock_integrations ADD COLUMN IF NOT EXISTS oauth_state      text;
ALTER TABLE public.stock_integrations ADD COLUMN IF NOT EXISTS oauth_req_id     bigint;
ALTER TABLE public.stock_integrations ADD COLUMN IF NOT EXISTS oauth_attempt_at timestamptz;
ALTER TABLE public.stock_integrations ADD COLUMN IF NOT EXISTS connect_nonce    text;
ALTER TABLE public.stock_integrations ADD COLUMN IF NOT EXISTS last_sync_at     timestamptz;
DO $c$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_integrations_oauth_state_chk') THEN
    ALTER TABLE public.stock_integrations ADD CONSTRAINT stock_integrations_oauth_state_chk
      CHECK (oauth_state IS NULL OR oauth_state IN ('idle','inflight','needs_reconnect'));
  END IF;
END $c$;
COMMENT ON COLUMN public.stock_integrations.oauth_remote_id IS
  'معرّفُ المتجر عند المزوّد (سلّة: المفتاح `merchant` وهو عددٌ صحيحٌ في جذر الرسالة لا كائن).';
COMMENT ON COLUMN public.stock_integrations.oauth_state IS
  'قفلُ تحديث التوكن (v15.17). `inflight` ذرّيّ: رمزُ تحديث سلّة **يُستعمل مرّةً واحدة** وإعادةُ استعماله تُبيد الربطَ وتستلزم إعادةَ تثبيت التطبيق ⇒ لا تحديثَ متوازياً، ولا إعادةَ محاولةٍ على نتيجةٍ مجهولة.';
COMMENT ON COLUMN public.stock_integrations.last_sync_at IS
  'آخرُ قراءةٍ ناجحةٍ من واجهة المزوّد. وهو ما يُعرض للتاجر — لا `last_seen_at` (ذاك آخرُ رسالةٍ وصلت، وقد تكون إشارةً لم يُقرأ بعدها رقم).';

GRANT SELECT (id, store_id, provider, segment, label, api_key_last4, webhook_url,
              direction, is_enabled, last_seen_at, created_at,
              field_map, last_payload, last_payload_at, last_note,
              webhook_slug, webhook_rev,
              oauth_expires_at, oauth_scope, oauth_state, last_sync_at)
  ON public.stock_integrations TO authenticated;
-- 🪤 و`oauth_remote_id`/`oauth_req_id`/`connect_nonce`/`inbound_secret` غيرُ
--    ممنوحة: `connect_nonce` سرُّ ربطٍ لمرّةٍ واحدة، وكلُّ عمودٍ ممنوحٍ بلا
--    داعٍ سطحٌ إضافي.

DROP FUNCTION IF EXISTS public._taki_stock_token(uuid);
CREATE FUNCTION public._taki_stock_token(p_integration_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_json text; v_t jsonb;
BEGIN
  SELECT s.decrypted_secret INTO v_json
    FROM vault.decrypted_secrets s
   WHERE s.name = 'stock_tok:' || p_integration_id::text;
  IF v_json IS NULL OR btrim(v_json) = '' THEN RETURN NULL; END IF;
  BEGIN
    v_t := v_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    -- 🪤 سرٌّ مشوّهٌ ليس توكناً: يُعاد NULL فيُقال «غير متّصل»، ولا يُنفَّذ
    --    نداءٌ بترويسةٍ فارغة (٤٠١ تُحسب فشلاً وتُقرّب دائرةَ زد القاطعة).
    RETURN NULL;
  END;
  IF COALESCE(btrim(v_t->>'access_token'), '') = '' THEN RETURN NULL; END IF;
  RETURN v_t;
END
$fn$;
REVOKE ALL ON FUNCTION public._taki_stock_token(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._taki_stock_token(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._taki_stock_token(uuid) FROM authenticated;

-- ── كتابةٌ تُثبَت بقراءة ─────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public._taki_stock_token_set(uuid, jsonb);
CREATE FUNCTION public._taki_stock_token_set(p_integration_id uuid, p_tok jsonb)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_name text := 'stock_tok:' || p_integration_id::text; v_id uuid; v_back jsonb;
BEGIN
  IF p_tok IS NULL OR COALESCE(btrim(p_tok->>'access_token'), '') = '' THEN RETURN false; END IF;
  SELECT id INTO v_id FROM vault.secrets WHERE name = v_name;
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_tok::text, v_name, 'TAKI stock integration token');
  ELSE
    PERFORM vault.update_secret(v_id, p_tok::text, v_name, 'TAKI stock integration token');
  END IF;
  -- 🔴 تُثبَت بقراءة: `vault.update_secret` على مؤشّرٍ ميت تكتب صفرَ صفوفٍ
  --    بلا أيّ استثناء — فحفظٌ بلا قراءةٍ بعده **وهم** (درسٌ مدفوع في v14.44).
  v_back := public._taki_stock_token(p_integration_id);
  RETURN v_back IS NOT NULL
     AND COALESCE(v_back->>'access_token','') = COALESCE(p_tok->>'access_token','');
END
$fn$;
REVOKE ALL ON FUNCTION public._taki_stock_token_set(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._taki_stock_token_set(uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public._taki_stock_token_set(uuid, jsonb) FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٧) ترميزُ المسار — ورمزُ منتجٍ عربيّ ليس حالةً نادرة هنا
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 رمزُ المنتج يُوضع **في المسار** لا في معامل، ورمزٌ فيه مسافةٌ أو حرفٌ
--    عربيّ يُنتج عنواناً معطوباً. والعنوانُ المعطوب لا يُخطئ بالضرورة: قد
--    يعود ٤٠٤ أو ٢٠٠ لمنتجٍ آخر — ولذلك يُرمَّز، ويُقاس بحرفٍ عربيّ.
CREATE OR REPLACE FUNCTION public._taki_urlenc(p text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT COALESCE(string_agg(
    CASE WHEN c ~ '^[A-Za-z0-9._~-]$' THEN c
         ELSE (SELECT string_agg('%' || upper(substring(h FROM n FOR 2)), '' ORDER BY n)
                 FROM (SELECT encode(convert_to(c, 'UTF8'), 'hex') AS h) e,
                      generate_series(1, length(e.h), 2) AS n)
    END, '' ORDER BY i), '')
    FROM regexp_split_to_table(COALESCE(p, ''), '') WITH ORDINALITY AS t(c, i);
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٨) الشطرُ الأوّل من العامل — يوسّع، يحجز، يُرسل
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.taki_stock_refresh_dispatch(int);
CREATE FUNCTION public.taki_stock_refresh_dispatch(p_global_cap int DEFAULT 150)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row   record; v_d jsonb; v_tok jsonb; v_url text; v_req bigint;
  v_sent  int := 0; v_fail int := 0; v_exp int := 0;
BEGIN
  -- ── (أ) توسيعُ «أعِد قراءة كلّ المربوط» إلى صفٍّ لكلّ منتج ────────────
  -- 🔴 كلا المزوّدين يقرأ **منتجاً واحداً** في النداء، فالصفُّ العامّ لا
  --    يُرسل بذاته. والتوسيعُ هنا لا في الخطّاف: الخطّافُ يجب أن يردّ فوراً.
  FOR v_row IN
    SELECT q.id, q.integration_id, q.store_id, q.reason, q.signal_event
      FROM public.stock_refresh_queue q
      JOIN public.stock_integrations i ON i.id = q.integration_id
     WHERE q.status = 'pending' AND q.external_id IS NULL AND q.due_at <= now()
       AND i.is_enabled AND public._taki_provider_read(i.provider) IS NOT NULL
     ORDER BY q.due_at, q.id LIMIT 50
  LOOP
    INSERT INTO public.stock_refresh_queue
      (integration_id, store_id, external_id, reason, signal_event, due_at)
    SELECT v_row.integration_id, v_row.store_id, l.external_id, v_row.reason,
           v_row.signal_event, now()
      FROM public.stock_links l
     WHERE l.integration_id = v_row.integration_id
    ON CONFLICT (integration_id, COALESCE(external_id, '*')) WHERE status = 'pending'
    DO UPDATE SET due_at = LEAST(stock_refresh_queue.due_at, EXCLUDED.due_at);
    GET DIAGNOSTICS v_exp = ROW_COUNT;
    UPDATE public.stock_refresh_queue
       SET status = 'done', done_at = now(),
           last_error = CASE WHEN v_exp = 0 THEN 'NO_LINKS' ELSE NULL END
     WHERE id = v_row.id;
  END LOOP;

  -- ── (ب) الحجزُ في خطوتين، ولسببٍ لغويّ لا تفضيليّ ─────────────────────
  -- 🪤 بوستجرس يرفض `FOR UPDATE` مع دالّةِ نافذة (`row_number`)، وسقفُ كلّ
  --    اتصالٍ يحتاجها. فالحجزُ `UPDATE … WHERE id IN (…)` وهو ذرّيٌّ بنفسه.
  -- 🪤 والصفُّ المحجوز يحمل `request_id IS NULL` حتى يُرسل فعلاً — وهي علامةُ
  --    «حُجز ولم يُرسل» التي يحرسها الجامعُ فيُعيدها إن مات الإرسال.
  CREATE TEMP TABLE IF NOT EXISTS _taki_disp(id bigint PRIMARY KEY) ON COMMIT DROP;
  DELETE FROM _taki_disp;
  INSERT INTO _taki_disp(id)
  WITH cand AS (
    SELECT q.id, i.provider,
           row_number() OVER (PARTITION BY q.integration_id ORDER BY q.due_at, q.id) AS rn
      FROM public.stock_refresh_queue q
      JOIN public.stock_integrations i ON i.id = q.integration_id
     WHERE q.status = 'pending' AND q.external_id IS NOT NULL AND q.due_at <= now()
       AND i.is_enabled
     ORDER BY q.due_at, q.id
     LIMIT GREATEST(COALESCE(p_global_cap, 150), 1)
  )
  SELECT c.id FROM cand c
   -- 🔴 سقفُ النبضة مشتقٌّ من سقف مزوّده لا مخترَع: ٤٠٪ منه، فسحةً لنداءات
   --    التحديث والتسجيل. (زد ٦٠/دقيقة للتطبيق في المتجر ⇒ ٢٤؛ وسلّة يُفترض
   --    أدنى باقاتها ١٢٠ ⇒ ٤٨.)
   WHERE c.rn <= GREATEST(
           (COALESCE((public._taki_provider_read(c.provider)->>'rpm')::int, 60) * 4) / 10, 1);

  UPDATE public.stock_refresh_queue q
     SET status = 'awaiting', request_id = NULL, sent_at = now(), attempts = attempts + 1
   WHERE q.id IN (SELECT id FROM _taki_disp) AND q.status = 'pending';

  FOR v_row IN
    SELECT q.id, q.integration_id, q.external_id, i.provider
      FROM public.stock_refresh_queue q
      JOIN public.stock_integrations i ON i.id = q.integration_id
     WHERE q.id IN (SELECT id FROM _taki_disp) AND q.status = 'awaiting' AND q.request_id IS NULL
  LOOP
    v_d := public._taki_provider_read(v_row.provider);
    IF v_d IS NULL THEN
      UPDATE public.stock_refresh_queue
         SET status = 'failed', last_error = 'NO_READ_DESCRIPTOR', done_at = now() WHERE id = v_row.id;
      v_fail := v_fail + 1; CONTINUE;
    END IF;

    v_tok := public._taki_stock_token(v_row.integration_id);
    IF v_tok IS NULL THEN
      -- 🪤 لا إعادةَ بلا نهاية: اتصالٌ بلا توكن ينتظر ضغطةَ التاجر «اربط
      --    متجرك»، وتلك الضغطةُ تُدرج صفوفاً جديدة. فالإعادةُ دَينٌ صامت.
      UPDATE public.stock_refresh_queue
         SET status = 'failed', last_error = 'NOT_CONNECTED', done_at = now() WHERE id = v_row.id;
      UPDATE public.stock_integrations SET last_note = 'NOT_CONNECTED' WHERE id = v_row.integration_id;
      v_fail := v_fail + 1; CONTINUE;
    END IF;

    v_url := (v_d->>'base')
          || replace(v_d->>'path', '{id}', public._taki_urlenc(v_row.external_id));

    BEGIN
      v_req := net.http_get(url := v_url,
                            headers := public._taki_provider_headers(v_row.provider, v_tok),
                            timeout_milliseconds := 8000);
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.stock_refresh_queue
         SET status = 'pending', last_error = 'DISPATCH:' || left(SQLERRM, 120),
             due_at = now() + make_interval(secs => (30 * power(2, LEAST(attempts, 5)))::int)
       WHERE id = v_row.id;
      v_fail := v_fail + 1; CONTINUE;
    END;

    UPDATE public.stock_refresh_queue SET request_id = v_req WHERE id = v_row.id;
    v_sent := v_sent + 1;
  END LOOP;

  RETURN jsonb_build_object('sent', v_sent, 'failed', v_fail);
END
$fn$;
REVOKE ALL ON FUNCTION public.taki_stock_refresh_dispatch(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_stock_refresh_dispatch(int) FROM anon;
REVOKE ALL ON FUNCTION public.taki_stock_refresh_dispatch(int) FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٩) الشطرُ الثاني — يجمع الردود ويكتب الرقم
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 و`pg_net` غيرُ متزامن: الردُّ يهبط في `net._http_response` ويُحذف بعد
--    `pg_net.ttl = 6 hours` (مقيس). فالجامعُ كلَّ دقيقة آمنٌ بفارقٍ كبير —
--    لكنّ ردّاً **مفقوداً** يُعامَل فشلاً قابلاً للإعادة لا انتظاراً أبدياً.
DROP FUNCTION IF EXISTS public.taki_stock_refresh_collect(int);
CREATE FUNCTION public.taki_stock_refresh_collect(p_cap int DEFAULT 300)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row record; v_resp record; v_body jsonb; v_p jsonb; v_ap jsonb;
  v_ok int := 0; v_none int := 0; v_retry int := 0; v_dead int := 0; v_wait int := 0;
  MAX_TRIES constant int := 8;
BEGIN
  FOR v_row IN
    SELECT q.*, i.provider, l.location_id
      FROM public.stock_refresh_queue q
      JOIN public.stock_integrations i ON i.id = q.integration_id
      LEFT JOIN public.stock_links l
             ON l.integration_id = q.integration_id AND l.external_id = q.external_id
     WHERE q.status = 'awaiting'
     ORDER BY q.sent_at NULLS FIRST, q.id
     LIMIT GREATEST(COALESCE(p_cap, 300), 1)
  LOOP
    -- (أ) حُجز ولم يُرسل: مات الإرسالُ بين الخطوتين ⇒ يُعاد
    IF v_row.request_id IS NULL THEN
      IF v_row.sent_at < now() - interval '2 minutes' THEN
        UPDATE public.stock_refresh_queue
           SET status = CASE WHEN attempts >= MAX_TRIES THEN 'failed' ELSE 'pending' END,
               last_error = 'CLAIMED_NOT_SENT',
               done_at = CASE WHEN attempts >= MAX_TRIES THEN now() END,
               due_at = now() + make_interval(secs => (30 * power(2, LEAST(attempts, 5)))::int)
         WHERE id = v_row.id;
        v_retry := v_retry + 1;
      ELSE
        v_wait := v_wait + 1;
      END IF;
      CONTINUE;
    END IF;

    SELECT * INTO v_resp FROM net._http_response WHERE id = v_row.request_id;

    -- (ب) لم يهبط الردُّ بعد — أو ضاع
    IF NOT FOUND THEN
      IF v_row.sent_at < now() - interval '3 minutes' THEN
        -- 🪤 ثلاثُ دقائق تفوق مهلةَ الطلب (٨ ثوانٍ) بكثير، فالغيابُ بعدها
        --    يعني ضياعَ الردّ (إعادةُ تشغيل عامل pg_net مثلاً) لا بطأً.
        UPDATE public.stock_refresh_queue
           SET status = CASE WHEN attempts >= MAX_TRIES THEN 'failed' ELSE 'pending' END,
               last_error = 'RESPONSE_LOST',
               done_at = CASE WHEN attempts >= MAX_TRIES THEN now() END,
               due_at = now() + make_interval(secs => (30 * power(2, LEAST(attempts, 5)))::int)
         WHERE id = v_row.id;
        v_retry := v_retry + 1;
      ELSE
        v_wait := v_wait + 1;
      END IF;
      CONTINUE;
    END IF;

    -- (ج) شبكةٌ أو مهلة
    IF COALESCE(v_resp.timed_out, false) OR v_resp.error_msg IS NOT NULL THEN
      UPDATE public.stock_refresh_queue
         SET status = CASE WHEN attempts >= MAX_TRIES THEN 'failed' ELSE 'pending' END,
             last_error = 'NET:' || left(COALESCE(v_resp.error_msg, 'TIMEOUT'), 120),
             http_status = v_resp.status_code,
             done_at = CASE WHEN attempts >= MAX_TRIES THEN now() END,
             due_at = now() + make_interval(secs => (30 * power(2, LEAST(attempts, 5)))::int)
       WHERE id = v_row.id;
      v_retry := v_retry + 1; CONTINUE;
    END IF;

    -- (د) ٤٢٩ — وعند زد **لا يُحسب فشلاً** (وثيقتهم صريحة)، فلا يُستهلك
    --     رصيدُ المحاولات، ويُؤجَّل تأجيلاً أطول. ووثيقتاهما توصيان بتراجعٍ أُسّي.
    IF v_resp.status_code = 429 THEN
      UPDATE public.stock_refresh_queue
         SET status = 'pending', http_status = 429, last_error = 'RATE_LIMITED',
             attempts = GREATEST(attempts - 1, 0),
             due_at = now() + interval '90 seconds'
       WHERE id = v_row.id;
      v_retry := v_retry + 1; CONTINUE;
    END IF;

    -- (هـ) توكنٌ مرفوض — لا يُعاد بغبائه: يُوسم الاتصالُ ويُطلب تحديثٌ واحد
    IF v_resp.status_code IN (401, 403) THEN
      UPDATE public.stock_refresh_queue
         SET status = 'failed', http_status = v_resp.status_code,
             last_error = 'TOKEN_REJECTED', done_at = now()
       WHERE id = v_row.id;
      UPDATE public.stock_integrations
         SET last_note = 'TOKEN_REJECTED',
             -- 🔴 ولا يُقفز إلى «needs_reconnect» فوراً: التحديثُ الدوريّ
             --    قد ينجح. لكنّ تاريخَ الانتهاء يُقدَّم ليُحاول الآن.
             oauth_expires_at = LEAST(COALESCE(oauth_expires_at, now()), now())
       WHERE id = v_row.integration_id;
      v_dead := v_dead + 1; CONTINUE;
    END IF;

    IF v_resp.status_code < 200 OR v_resp.status_code > 299 THEN
      UPDATE public.stock_refresh_queue
         SET status = CASE WHEN attempts >= MAX_TRIES THEN 'failed' ELSE 'pending' END,
             http_status = v_resp.status_code, last_error = 'HTTP_' || v_resp.status_code,
             done_at = CASE WHEN attempts >= MAX_TRIES THEN now() END,
             due_at = now() + make_interval(secs => (30 * power(2, LEAST(attempts, 5)))::int)
       WHERE id = v_row.id;
      v_retry := v_retry + 1; CONTINUE;
    END IF;

    -- (و) ٢xx — يُقرأ الرقمُ ويُكتب
    BEGIN
      v_body := v_resp.content::jsonb;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.stock_refresh_queue
         SET status = 'failed', http_status = v_resp.status_code,
             last_error = 'BODY_NOT_JSON', done_at = now() WHERE id = v_row.id;
      v_dead := v_dead + 1; CONTINUE;
    END;

    v_p := public._taki_stock_parse_read(v_row.provider, v_body, v_row.external_id, v_row.location_id);
    IF NOT COALESCE((v_p->>'ok')::boolean, false) THEN
      -- 🪤 «لا شيءَ يُكتب» ليس فشلاً: منتجٌ بلا حدّ أو فرعٌ غير موجودٍ عندهم
      --    حالةٌ مشروعة. تُسجَّل بسببها ويُغلق الصفّ — ولا تُعاد إلى الأبد.
      UPDATE public.stock_refresh_queue
         SET status = 'done', http_status = v_resp.status_code,
             last_error = COALESCE(v_p->>'reason', 'NOT_USABLE'), done_at = now()
       WHERE id = v_row.id;
      v_none := v_none + 1; CONTINUE;
    END IF;

    -- 🪤 `observed_at = now()` صحيحٌ هنا بالضبط: الرقمُ قُرئ الآن من مصدره،
    --    لا من رسالةٍ قد تكون قديمة. ومفتاحُ التكرار صفُّ الطابور نفسه.
    v_ap := public._taki_stock_apply(
              v_row.integration_id,
              jsonb_build_array(jsonb_build_object('external_id', v_row.external_id,
                                                   'on_hand', (v_p->>'on_hand')::int)),
              now(), 'rd:' || v_row.id::text);

    UPDATE public.stock_refresh_queue
       SET status = 'done', http_status = v_resp.status_code, done_at = now(),
           last_error = CASE WHEN COALESCE((v_ap->>'applied')::int, 0) > 0 THEN NULL
                             WHEN jsonb_array_length(COALESCE(v_ap->'unmatched','[]'::jsonb)) > 0
                               THEN 'NOT_LINKED'
                             ELSE COALESCE(v_ap->'skip_reasons'->>0, 'NO_EFFECT') END
     WHERE id = v_row.id;

    IF COALESCE((v_ap->>'applied')::int, 0) > 0 THEN
      UPDATE public.stock_integrations
         SET last_sync_at = now(), last_note = 'SYNCED' WHERE id = v_row.integration_id;
      v_ok := v_ok + 1;
    ELSE
      v_none := v_none + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('applied', v_ok, 'no_write', v_none,
                            'retried', v_retry, 'dead', v_dead, 'in_flight', v_wait);
END
$fn$;
REVOKE ALL ON FUNCTION public.taki_stock_refresh_collect(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_stock_refresh_collect(int) FROM anon;
REVOKE ALL ON FUNCTION public.taki_stock_refresh_collect(int) FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١٠) الخطّافُ: يقبل المسار، ويُدرج إشارةً — ويردّ فوراً
-- ═══════════════════════════════════════════════════════════════════════════
DO $patch$
DECLARE src text; src0 text;
BEGIN
  src := pg_get_functiondef('public.taki_stock_webhook(text,jsonb,text)'::regprocedure);
  src0 := src;
  IF position('v15.17 signal' IN src) > 0 THEN RAISE NOTICE 'ℹ️ مرقوعةٌ أصلاً.'; RETURN; END IF;

  -- (أ) الهويّة: مفتاحٌ **أو** مسارُ المتجر
  IF position(E'   WHERE api_key_hash = v_hash AND is_enabled AND direction IN (''in'',''both'');' IN src) = 0 THEN
    RAISE EXCEPTION '❌ مرساة البحث عن الاتصال غير موجودة — أوقِفت.';
  END IF;
  src := replace(src,
    E'   WHERE api_key_hash = v_hash AND is_enabled AND direction IN (''in'',''both'');',
    E'   -- v15.17 signal — العنوانُ صار مساراً لكلّ متجر (`/h/<slug>`) لأن\n'
    || E'   --   دائرةَ زد القاطعة ترفض إعادةَ استخدام رابطٍ عُطّل («You cannot\n'
    || E'   --   recover a webhook by re-using the same target_url»). فيُفصل\n'
    || E'   --   العنوانُ عن السرّ: المسارُ يُعاد إصدارُه والمفتاحُ يبقى.\n'
    || E'   WHERE (api_key_hash = v_hash OR webhook_slug = btrim(p_key))\n'
    || E'     AND is_enabled AND direction IN (''in'',''both'');');

  -- (ب) الإدراجُ في الطابور — **قبل** كلّ فرعِ إرجاع، فيغطّيها كلَّها
  -- 🔴 وهذا جوهرُ v15.17: لا سلّة ولا زد تُرسل حدثاً لتغيّر المخزون، فالرقمُ
  --    في الرسالة ليس المصدر. ويُدرَج أيضاً حين **لا** تُفهم الرسالة وحين
  --    يُسقطها `skip_when` — فتلك بالضبط الحالاتُ التي تكون فيها إشارةً محضة.
  IF position(E'  IF p_body IS NULL OR jsonb_typeof(p_body) <> ''object'' THEN' IN src) = 0 THEN
    RAISE EXCEPTION '❌ مرساة الإدراج غير موجودة — أوقِفت.';
  END IF;
  src := replace(src, E'  IF p_body IS NULL OR jsonb_typeof(p_body) <> ''object'' THEN',
    E'  -- v15.17 signal — تُدرَج إشارةٌ ويُعاد القراءةُ لاحقاً. ولا يُنادى\n'
    || E'  --   المزوّدُ من هنا إطلاقاً: وثيقةُ زد تحسب الردَّ البطيء فشلاً\n'
    || E'  --   (٣٠ فشلاً في ساعةٍ ⇒ `broken` وتُلغى الأحداثُ المعلّقة).\n'
    || E'  IF public._taki_provider_read(v_i.provider) IS NOT NULL THEN\n'
    || E'    PERFORM public._taki_stock_enqueue(v_i.id, NULL, ''signal'',\n'
    || E'              public._taki_jpath(p_body, ''event''), 10);\n'
    || E'  END IF;\n'
    || E'\n'
    || E'  IF p_body IS NULL OR jsonb_typeof(p_body) <> ''object'' THEN');

  IF src = src0 THEN RAISE EXCEPTION '❌ لم تقع أيّ رقعة.'; END IF;
  EXECUTE src;
  src := pg_get_functiondef('public.taki_stock_webhook(text,jsonb,text)'::regprocedure);
  IF position('v15.17 signal' IN src) = 0
     OR position('webhook_slug = btrim(p_key)' IN src) = 0
     OR position('_taki_stock_enqueue' IN src) = 0 THEN
    RAISE EXCEPTION '❌ الرقعة لم تُنفَّذ كاملةً.';
  END IF;
  RAISE NOTICE '✅ الخطّاف: يقبل المسار · ويُدرج إشارةً · ولا ينادي المزوّد.';
END
$patch$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١١) شبكةُ الأمان — المسحُ الدوريّ، وهو **الضمانُ الحقيقيّ**
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 ولماذا هو الضمان: بيعٌ في كاشير التاجر لا يمرّ بسلّة ولا بزد **لا يُنتج
--    أيّ حدث**. فبلا مسحٍ دوريّ يبقى رقمُنا قديماً بلا أن يشتكي أحد.
--    وبه تصير المزامنةُ **قريبةً من الفورية** (إشارة ⇒ ثوانٍ) **ومضمونةً**
--    (مسحٌ كلَّ عشر دقائق) — وهذا هو ما يُقال للتاجر حرفياً، لا «فوريّة».
DROP FUNCTION IF EXISTS public.taki_stock_refresh_periodic();
CREATE FUNCTION public.taki_stock_refresh_periodic()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_n int := 0; v_row record;
BEGIN
  FOR v_row IN
    SELECT i.id FROM public.stock_integrations i
     WHERE i.is_enabled AND i.direction IN ('in','both')
       AND public._taki_provider_read(i.provider) IS NOT NULL
       AND public._taki_stock_token(i.id) IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.stock_links l WHERE l.integration_id = i.id)
  LOOP
    PERFORM public._taki_stock_enqueue(v_row.id, NULL, 'periodic', NULL, 0);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$fn$;
REVOKE ALL ON FUNCTION public.taki_stock_refresh_periodic() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_stock_refresh_periodic() FROM anon;
REVOKE ALL ON FUNCTION public.taki_stock_refresh_periodic() FROM authenticated;

-- ── تنظيفُ الطابور: سجلٌّ لا مخزن ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.taki_prune_stock_queue()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_n int;
BEGIN
  DELETE FROM public.stock_refresh_queue
   WHERE status IN ('done','failed') AND COALESCE(done_at, created_at) < now() - interval '7 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$fn$;
REVOKE ALL ON FUNCTION public.taki_prune_stock_queue() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_prune_stock_queue() FROM anon;
REVOKE ALL ON FUNCTION public.taki_prune_stock_queue() FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١٢) ما يُقال للتاجر عن السرعة — يُقرأ من الجدولة نفسها، لا يُكتب نصّاً
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 قاعدةُ المشروع: **لا يُكتب رقمُ دقائقَ نصّاً في أيّ مكان** — أوّلُ ضبطٍ
--    يجعله كذباً (درسُ مهلة الحجز، و`holdLabelGen`). فالشاشةُ تسأل القاعدة،
--    والقاعدةُ تقرأ `cron.job` نفسه. فإن غُيّرت الجدولةُ تغيّرت الجملةُ وحدها.
DROP FUNCTION IF EXISTS public.taki_stock_sync_info();
CREATE FUNCTION public.taki_stock_sync_info()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'periodic_minutes', (
      SELECT CASE WHEN schedule ~ '^\*/[0-9]+ \* \* \* \*$'
                  THEN (regexp_replace(schedule, '^\*/([0-9]+).*$', '\1'))::int
                  WHEN schedule = '* * * * *' THEN 1 ELSE NULL END
        FROM cron.job WHERE jobname = 'taki-stock-refresh-periodic' AND active LIMIT 1),
    'debounce_seconds', 10,
    'instant', false);
$fn$;
REVOKE ALL ON FUNCTION public.taki_stock_sync_info() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.taki_stock_sync_info() TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١٣) الجدولة — على الخادم لا على GitHub
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 درسٌ مقيس: `*/10` على GitHub Actions قِيست **٢٠٥ دقيقةً وسيطاً** (أسوأها
--    ٤١٤). فأيُّ كشفٍ أو مزامنةٍ سريعة مكانُها كرون الخادم وحده.
-- 🪤 وخادمُ جدة على `+03:00` لا UTC — ومهامُ الدقيقة لا يهمّها ذلك، أمّا
--    المنظّفُ اليوميّ فوُضع ٣:٥٥ (بعد النسخة ٣:٣٠ وقبل الأمان ٤:٣٠).
SELECT cron.unschedule(j) FROM (VALUES
  ('taki-stock-refresh-dispatch'), ('taki-stock-refresh-collect'),
  ('taki-stock-refresh-periodic'), ('taki-stock-queue-prune')) AS t(j)
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = t.j);

SELECT cron.schedule('taki-stock-refresh-dispatch', '* * * * *',
                     $$SELECT public.taki_stock_refresh_dispatch();$$);
SELECT cron.schedule('taki-stock-refresh-collect',  '* * * * *',
                     $$SELECT public.taki_stock_refresh_collect();$$);
-- 🔴 عشرُ دقائق هي **الوعدُ الحقيقيّ** للتاجر: الإشارةُ تُعطي ثوانيَ، وهذه
--    تُعطي ضماناً حتى لبيعٍ لم يُنتج أيَّ حدثٍ عند المزوّد.
SELECT cron.schedule('taki-stock-refresh-periodic', '*/10 * * * *',
                     $$SELECT public.taki_stock_refresh_periodic();$$);
SELECT cron.schedule('taki-stock-queue-prune', '55 3 * * *',
                     $$SELECT public.taki_prune_stock_queue();$$);

-- ═══════════════════════════════════════════════════════════════════════════
-- ١٤) فحصٌ يرفع استثناءً — وبحمولاتٍ منسوخةٍ من الوثيقتين حرفياً
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  v_me text; v_deal text; v_int uuid; v_oh0 int; v_n int; r jsonb;
  K constant text := 'taki_v1517_probe_0123456789abcdef';
  -- حمولةُ سلّة — من https://docs.salla.dev/product/product-details-sku.md
  SALLA constant jsonb := '{"status":200,"success":true,"data":{"id":532443002,"sku":"250-SS",
    "quantity":9,"unlimited_quantity":false,
    "skus":[{"sku":"250-SS-RED","stock_quantity":90,"unlimited_quantity":false},
            {"sku":"250-SS-BLU","stock_quantity":7,"unlimited_quantity":false}]}}'::jsonb;
  -- حمولةُ زد — من https://docs.zid.sa/list-product-stocks.md (مثالُهم نفسه)
  ZID constant jsonb := '{"count":2,"next":null,"previous":null,"results":[
    {"id":"e44bbf6b","location":{"id":"8ee590fe","name":"الرياض","type":"PHYSICAL"},
     "available_quantity":4,"is_infinite":false},
    {"id":"f55ccf7c","location":{"id":"9ff601gf","name":"جدة","type":"PHYSICAL"},
     "available_quantity":6,"is_infinite":false}]}'::jsonb;
  ZID_INF constant jsonb := '{"count":1,"next":null,"previous":null,"results":[
    {"id":"e44bbf6b","location":{"id":"8ee590fe","name":"الرياض","type":"PHYSICAL"},
     "available_quantity":null,"is_infinite":true}]}'::jsonb;
BEGIN
  -- ── (١) البنية ────────────────────────────────────────────────────────
  IF to_regprocedure('public.taki_stock_refresh_dispatch(integer)') IS NULL
     OR to_regprocedure('public.taki_stock_refresh_collect(integer)') IS NULL
     OR to_regprocedure('public._taki_stock_parse_read(text,jsonb,text,text)') IS NULL
     OR to_regprocedure('public._taki_stock_apply(uuid,jsonb,timestamptz,text)') IS NULL
     OR to_regclass('public.stock_refresh_queue') IS NULL THEN
    RAISE EXCEPTION '❌ أحدُ أجزاء العامل لم يُنشأ.';
  END IF;
  -- 🔴 ولا تُمنح الدوالُّ الداخلية لأحد: من يناديها يكتب في مخزون أيّ متجر
  IF has_function_privilege('anon', 'public._taki_stock_apply(uuid,jsonb,timestamptz,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._taki_stock_apply(uuid,jsonb,timestamptz,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.taki_stock_refresh_dispatch(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._taki_stock_token(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ 🔴 دالّةٌ داخليّة ممنوحةٌ لدورٍ عامّ — سطحُ كتابةٍ في أيّ مخزون.';
  END IF;
  -- وغلافُ المفتاح يبقى كما كان (لم يُكسر أحد)
  IF NOT has_function_privilege('anon', 'public.taki_stock_push(text,jsonb,timestamptz,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ taki_stock_push فقدت منحَ anon — ينكسر كلُّ نظام تاجرٍ قائم.';
  END IF;

  -- ── (٢) ترميزُ المسار: رمزٌ عربيّ ليس حالةً نادرة هنا ─────────────────
  IF public._taki_urlenc('250-SS') <> '250-SS' THEN
    RAISE EXCEPTION '❌ رمزٌ آمنٌ أُفسد بالترميز: %', public._taki_urlenc('250-SS');
  END IF;
  IF public._taki_urlenc('قميص أزرق') ~ ' ' OR public._taki_urlenc('قميص أزرق') !~ '^%' THEN
    RAISE EXCEPTION '❌ رمزٌ عربيٌّ لم يُرمَّز (%) — فالعنوانُ معطوبٌ بلا خطأ.',
      public._taki_urlenc('قميص أزرق');
  END IF;
  IF convert_from(decode(replace(public._taki_urlenc('قميص'), '%', ''), 'hex'), 'UTF8') <> 'قميص' THEN
    RAISE EXCEPTION '❌ الترميزُ لا يرتدّ إلى أصله.';
  END IF;

  -- ── (٣) المحلّل: بحمولات الوثيقتين، وفي الحالات التي تكسر ─────────────
  r := public._taki_stock_parse_read('salla', SALLA, '250-SS-BLU', NULL);
  IF COALESCE(r->>'on_hand','') <> '7' OR COALESCE(r->>'level','') <> 'variant' THEN
    RAISE EXCEPTION '❌ سلّة: الصنفُ لم يُقرأ من data.skus[] (%).', r::text;
  END IF;
  r := public._taki_stock_parse_read('salla', SALLA, '250-SS', NULL);
  IF COALESCE(r->>'on_hand','') <> '9' OR COALESCE(r->>'level','') <> 'product' THEN
    RAISE EXCEPTION '❌ سلّة: المنتجُ لم يُقرأ من data.quantity (%).', r::text;
  END IF;
  -- 🔴 «بلا حدّ» يجب ألّا يصير صفراً — وهو العيبُ الذي كلّف v15.15 هجرةً كاملة
  r := public._taki_stock_parse_read('salla',
         jsonb_set(SALLA, '{data,unlimited_quantity}', 'true'::jsonb), '250-SS', NULL);
  IF COALESCE((r->>'ok')::boolean, true) OR COALESCE(r->>'reason','') <> 'UNLIMITED' THEN
    RAISE EXCEPTION '❌ 🔴 سلّة: منتجٌ بلا حدّ لم يُستثنَ (%).', r::text;
  END IF;
  -- زد: جمعُ الفروع · فرعٌ بعينه · فرعٌ غيرُ موجود · وبلا حدّ
  r := public._taki_stock_parse_read('zid', ZID, 'P1', NULL);
  IF COALESCE(r->>'on_hand','') <> '10' THEN
    RAISE EXCEPTION '❌ زد: مجموعُ الفروع خاطئ (% بدل 10).', r::text;
  END IF;
  r := public._taki_stock_parse_read('zid', ZID, 'P1', '9ff601gf');
  IF COALESCE(r->>'on_hand','') <> '6' THEN
    RAISE EXCEPTION '❌ زد: فرعٌ بعينه لم يُنتقَ (%).', r::text;
  END IF;
  r := public._taki_stock_parse_read('zid', ZID, 'P1', 'NO-SUCH-BRANCH');
  IF COALESCE((r->>'ok')::boolean, true) OR COALESCE(r->>'reason','') <> 'LOCATION_NOT_FOUND' THEN
    RAISE EXCEPTION '❌ 🔴 زد: فرعٌ غيرُ موجودٍ أعطى رقماً — كان سيُكتب مخزونُ فرعٍ آخر (%).', r::text;
  END IF;
  r := public._taki_stock_parse_read('zid', ZID_INF, 'P1', NULL);
  IF COALESCE((r->>'ok')::boolean, true) OR COALESCE(r->>'reason','') <> 'UNLIMITED' THEN
    RAISE EXCEPTION '❌ 🔴 زد: `available_quantity: null` مع `is_infinite` لم يُستثنَ (%).', r::text;
  END IF;
  -- ومزوّدٌ بلا وصفٍ لا يُقرأ منه شيء
  IF COALESCE((public._taki_stock_parse_read('foodics', SALLA, 'X', NULL)->>'ok')::boolean, true) THEN
    RAISE EXCEPTION '❌ قُرئ من مزوّدٍ لم تُفتح وثيقتُه.';
  END IF;
  RAISE NOTICE '✅ المحلّل: سلّة (صنف/منتج/بلا حدّ) · زد (جمع/فرع/فرعٌ مفقود/بلا حدّ) · ومزوّدٌ مجهول.';

  -- ── (٤) عرضٌ واتصالٌ للقياس ───────────────────────────────────────────
  SELECT d.store_id, d.id, d.on_hand INTO v_me, v_deal, v_oh0
    FROM public.deals d
   WHERE d.on_hand IS NOT NULL AND COALESCE(d.is_unlimited, false) = false
     AND public.taki_open_holds(d.id, NULL, NULL) = 0
   ORDER BY d.id LIMIT 1;
  IF v_deal IS NULL THEN RAISE NOTICE 'ℹ️ لا عرضَ صالحٌ — تخطّي الباقي.'; RETURN; END IF;

  INSERT INTO public.stock_integrations
    (store_id, provider, segment, label, api_key_hash, api_key_last4, webhook_slug)
  VALUES (v_me, 'zid', 'ecommerce', 'v1517-verify',
          encode(extensions.digest(K,'sha256'),'hex'), right(K,4),
          encode(extensions.gen_random_bytes(18),'hex'))
  RETURNING id INTO v_int;
  INSERT INTO public.stock_links (integration_id, store_id, deal_id, external_id)
  VALUES (v_int, v_me, v_deal, 'V1517-P1');

  -- ── (٤-ب) 🔴 لا انحدار: إصلاحُ v15.16 لم يضع في إعادة التشكيل ─────────
  -- أوّلُ نسخةٍ كتبتُها لحلقة التطبيق استُخرجت من نصٍّ **قبل** v15.16، فكانت
  -- ستُرجع «طُبّق» لما لم يُكتب. ⇒ يُقاس هنا سلوكياً بعد إعادة التشكيل.
  PERFORM public.taki_stock_push(K, jsonb_build_array(
            jsonb_build_object('external_id', 'V1517-P1', 'on_hand', v_oh0)),
            now(), 'v1517-base');
  r := public.taki_stock_push(K, jsonb_build_array(
         jsonb_build_object('external_id', 'V1517-P1', 'on_hand', v_oh0 + 50)),
         now() - interval '1 hour', 'v1517-stale');
  IF COALESCE((r->>'applied')::int, -1) <> 0
     OR NOT (r->'skip_reasons' @> '["STALE_OBSERVATION"]'::jsonb) THEN
    RAISE EXCEPTION '❌ 🔴 انحدار: إعادةُ التشكيل أعادت محاسبةَ ما قبل v15.16: %', r::text;
  END IF;
  IF (SELECT on_hand FROM public.deals WHERE id = v_deal) <> v_oh0 THEN
    RAISE EXCEPTION '❌ 🔴 كُتب رقمٌ قديمٌ بعد إعادة التشكيل.';
  END IF;
  RAISE NOTICE '✅ لا انحدار: الغلافُ النحيف يحمل محاسبةَ v15.16 سلوكياً.';

  -- ── (٥) المسارُ يعمل هويّةً كالمفتاح ──────────────────────────────────
  r := public.taki_stock_webhook(
         (SELECT webhook_slug FROM public.stock_integrations WHERE id = v_int),
         jsonb_build_object('id','V1517-P1','quantity', v_oh0, 'structure','simple'));
  IF NOT COALESCE((r->>'ok')::boolean, false) THEN
    RAISE EXCEPTION '❌ 🔴 المسارُ لم يُقبل هويّةً — فكلُّ رابطٍ نُعطيه معطوب: %', r::text;
  END IF;
  -- ومسارٌ مجهولٌ يُرفض
  IF COALESCE((public.taki_stock_webhook('0123456789abcdef0123456789abcdef0123',
        '{"id":"x","quantity":1}'::jsonb)->>'ok')::boolean, false) THEN
    RAISE EXCEPTION '❌ 🔴 مسارٌ مجهولٌ قُبل.';
  END IF;

  -- ── (٦) الإشارةُ تُدرج وتُدمج ─────────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.stock_refresh_queue
   WHERE integration_id = v_int AND status = 'pending';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '❌ الخطّافُ لم يُدرج إشارةً واحدة (%).', v_n;
  END IF;
  -- خمسون إشارةً ⇒ صفٌّ واحد. وبلا الدمج يُستهلك سقفُ المزوّد في ثوانٍ.
  FOR i IN 1 .. 50 LOOP
    PERFORM public._taki_stock_enqueue(v_int, NULL, 'signal', 'product.update', 10);
  END LOOP;
  SELECT count(*) INTO v_n FROM public.stock_refresh_queue
   WHERE integration_id = v_int AND status = 'pending';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '❌ 🔴 خمسون إشارةً أنتجت % صفّاً — سقفُ المزوّد يُستهلك فوراً ثمّ ٤٢٩.', v_n;
  END IF;
  RAISE NOTICE '✅ الإدماج: ٥١ إشارةً ⇒ صفٌّ واحد.';

  -- ── (٧) التوسيعُ والسقف ───────────────────────────────────────────────
  -- بلا توكن: التوسيعُ يقع، ثمّ يُغلق الصفُّ بـNOT_CONNECTED — لا إعادةَ أبدية
  UPDATE public.stock_refresh_queue SET due_at = now() WHERE integration_id = v_int;
  PERFORM public.taki_stock_refresh_dispatch(150);
  SELECT count(*) INTO v_n FROM public.stock_refresh_queue
   WHERE integration_id = v_int AND external_id = 'V1517-P1';
  IF v_n < 1 THEN RAISE EXCEPTION '❌ التوسيعُ لم يُنتج صفّاً لكلّ منتج.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_refresh_queue
                  WHERE integration_id = v_int AND last_error = 'NOT_CONNECTED') THEN
    RAISE EXCEPTION '❌ 🔴 اتصالٌ بلا توكن لم يُغلَق — طابورٌ يُعاد إلى الأبد.';
  END IF;
  RAISE NOTICE '✅ التوسيع: صفٌّ لكلّ منتج · وبلا توكن يُغلَق بسببه لا يُعاد.';

  -- ── (٨) التنظيف ───────────────────────────────────────────────────────
  PERFORM public.taki_set_on_hand(v_deal, v_oh0, NULL, NULL, now(), 'init');
  DELETE FROM public.stock_integrations WHERE id = v_int;
  IF (SELECT on_hand FROM public.deals WHERE id = v_deal) <> v_oh0 THEN
    RAISE EXCEPTION '❌ العرضُ لم يعد إلى %.', v_oh0;
  END IF;
  IF EXISTS (SELECT 1 FROM public.stock_refresh_queue
              WHERE store_id = v_me AND integration_id NOT IN
                    (SELECT id FROM public.stock_integrations)) THEN
    RAISE EXCEPTION '❌ صفوفُ طابورٍ لاتصالٍ محذوف — التتالي لا يعمل.';
  END IF;
  RAISE NOTICE '✅ v15.17: الحلقةُ مبنيّةٌ ومقيسة · والمسارُ يُعاد إصدارُه · ولا بقايا.';
END
$verify$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١٥) فحصٌ من الطرف إلى الطرف — نداءٌ **حقيقيّ** إلى سلّة
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 ولماذا يلزم: كلُّ ما سبق يقيس منطقاً. وما لم يُقَس بعد هو الأهمّ عملياً —
--    هل يُبنى العنوانُ صحيحاً؟ هل تصل الترويساتُ؟ هل يهبط الردُّ ويُصنَّف؟
--    ويُقاس بتوكنٍ وهميّ: سلّة تردّ ٤٠١، والمطلوبُ أن يُصنَّف `TOKEN_REJECTED`
--    لا أن يُعاد إلى الأبد.
-- 🪤 وثلاثُ كتلٍ لا كتلةٌ واحدة: `pg_net` غيرُ متزامن، و`now()` مجمَّدةٌ داخل
--    المعاملة — فجمعُ ردٍّ في نفس الكتلة التي أرسلته **مستحيلٌ بنيوياً**.
DO $e2e_a$
DECLARE v_me text; v_deal text; v_int uuid;
  K constant text := 'taki_v1517_e2e_0123456789abcdefgh';
BEGIN
  SELECT d.store_id, d.id INTO v_me, v_deal FROM public.deals d
   WHERE d.on_hand IS NOT NULL ORDER BY d.id LIMIT 1;
  IF v_deal IS NULL THEN RAISE NOTICE 'ℹ️ لا عرض — تخطّي.'; RETURN; END IF;

  INSERT INTO public.stock_integrations
    (store_id, provider, segment, label, api_key_hash, api_key_last4, webhook_slug)
  VALUES (v_me, 'salla', 'ecommerce', 'v1517-e2e',
          encode(extensions.digest(K,'sha256'),'hex'), right(K,4),
          encode(extensions.gen_random_bytes(18),'hex'))
  RETURNING id INTO v_int;
  INSERT INTO public.stock_links (integration_id, store_id, deal_id, external_id)
  VALUES (v_int, v_me, v_deal, 'TAKI-E2E-SKU');

  -- توكنٌ وهميٌّ مخزَّنٌ بالطريق الحقيقيّ — والكتابةُ تُثبَت بقراءة
  IF NOT public._taki_stock_token_set(v_int,
       '{"access_token":"taki_fake_for_e2e_only","scope":"products.read"}'::jsonb) THEN
    RAISE EXCEPTION '❌ 🔴 الخزنةُ قالت «حُفظ» ولم تُقرأ القيمةُ بعدها — نفسُ عيب v14.44.';
  END IF;
  PERFORM public._taki_stock_enqueue(v_int, 'TAKI-E2E-SKU', 'manual', NULL, 0);
  PERFORM public.taki_stock_refresh_dispatch(10);
  IF NOT EXISTS (SELECT 1 FROM public.stock_refresh_queue
                  WHERE integration_id = v_int AND status = 'awaiting' AND request_id IS NOT NULL) THEN
    RAISE EXCEPTION '❌ 🔴 لم يُرسل أيُّ طلبٍ فعلاً: %',
      (SELECT COALESCE(string_agg(status || '/' || COALESCE(last_error,'-'), ', '), 'لا صفوف')
         FROM public.stock_refresh_queue WHERE integration_id = v_int);
  END IF;
  RAISE NOTICE 'ℹ️ أُرسل طلبٌ حقيقيٌّ إلى api.salla.dev — انتظارُ الردّ.';
END
$e2e_a$;

SELECT pg_sleep(9);

DO $e2e_b$
DECLARE v_int uuid; v_q record; r jsonb;
BEGIN
  SELECT id INTO v_int FROM public.stock_integrations WHERE label = 'v1517-e2e';
  IF v_int IS NULL THEN RAISE NOTICE 'ℹ️ لا اتصالَ فحص — تخطّي.'; RETURN; END IF;

  r := public.taki_stock_refresh_collect(50);
  SELECT * INTO v_q FROM public.stock_refresh_queue WHERE integration_id = v_int ORDER BY id DESC LIMIT 1;
  RAISE NOTICE 'ℹ️ الردّ: http=% · الحالة=% · السبب=%',
    COALESCE(v_q.http_status::text,'-'), v_q.status, COALESCE(v_q.last_error,'-');

  IF v_q.http_status IS NULL THEN
    RAISE EXCEPTION '❌ 🔴 لم يهبط أيُّ ردٍّ من سلّة — فالقاعدةُ لا تصل مزوّدَها، والحلقةُ كلُّها معطّلة. %', r::text;
  END IF;
  -- 🔴 والمطلوبُ بعينه: ٤٠١ ⇒ `TOKEN_REJECTED` و`failed` — لا إعادةٌ أبدية
  IF v_q.http_status <> 401 THEN
    RAISE EXCEPTION '❌ توقّعتُ ٤٠١ من توكنٍ وهميّ فجاء % — راجع العنوانَ والترويسات.', v_q.http_status;
  END IF;
  IF v_q.status <> 'failed' OR COALESCE(v_q.last_error,'') <> 'TOKEN_REJECTED' THEN
    RAISE EXCEPTION '❌ ٤٠١ لم يُصنَّف توكناً مرفوضاً (%/%).', v_q.status, v_q.last_error;
  END IF;
  IF (SELECT last_note FROM public.stock_integrations WHERE id = v_int) <> 'TOKEN_REJECTED' THEN
    RAISE EXCEPTION '❌ الاتصالُ لم يُوسَم — فالتاجر لا يعرف لماذا توقّف.';
  END IF;

  DELETE FROM vault.secrets WHERE name = 'stock_tok:' || v_int::text;
  DELETE FROM public.stock_integrations WHERE id = v_int;
  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name LIKE 'stock_tok:%') THEN
    RAISE EXCEPTION '❌ سرُّ فحصٍ بقي في الخزنة.';
  END IF;
  RAISE NOTICE '✅ من الطرف إلى الطرف: العنوانُ والترويساتُ وصلت سلّة · والردُّ هبط · و٤٠١ صُنّف · ولا بقايا.';
END
$e2e_b$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١٦) الجدولُ للقراءة فقط — والتحقّقُ أعلاه هو الذي يُفشل
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'مسارٌ لكلّ متجر' AS "ما",
       CASE WHEN to_regprocedure('public.merchant_reissue_webhook_path(uuid)') IS NOT NULL THEN '✅' ELSE '❌' END AS "الحالة"
UNION ALL SELECT 'طابورُ إعادة القراءة',
  CASE WHEN to_regclass('public.stock_refresh_queue') IS NOT NULL THEN '✅' ELSE '❌' END
UNION ALL SELECT 'الإرسال + الجمع',
  CASE WHEN to_regprocedure('public.taki_stock_refresh_dispatch(integer)') IS NOT NULL
        AND to_regprocedure('public.taki_stock_refresh_collect(integer)') IS NOT NULL THEN '✅' ELSE '❌' END
UNION ALL SELECT 'وصفُ سلّة وزد',
  CASE WHEN public._taki_provider_read('salla') IS NOT NULL
        AND public._taki_provider_read('zid') IS NOT NULL THEN '✅' ELSE '❌' END
UNION ALL SELECT 'مهامُ الكرون الأربع',
  CASE WHEN (SELECT count(*) FROM cron.job WHERE jobname IN
             ('taki-stock-refresh-dispatch','taki-stock-refresh-collect',
              'taki-stock-refresh-periodic','taki-stock-queue-prune') AND active) = 4
       THEN '✅' ELSE '❌' END
UNION ALL SELECT 'دقائقُ المسح (تُقرأ من الجدولة)',
  COALESCE((public.taki_stock_sync_info()->>'periodic_minutes'), '❌');
