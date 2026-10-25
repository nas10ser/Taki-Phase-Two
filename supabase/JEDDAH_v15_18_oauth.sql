-- ═══════════════════════════════════════════════════════════════════════════
-- v15.18 — رموزُ OAuth لكلّ تاجر: خزنةٌ · قفلٌ ذرّيّ · ومخرجٌ بضغطة
-- ═══════════════════════════════════════════════════════════════════════════
-- بندُ ناصر الثالث: «حفظُ رموز OAuth لكلّ تاجر في الخزنة + تحديثٌ دوريّ».
--
-- 🔴 وأخطرُ ما في هذا الملفّ كلِّه، مقيسٌ من وثيقة سلّة حرفياً:
--    **رمزُ التحديث يُستعمل مرّةً واحدة.** وإعادةُ استعماله تُبطله **وتُلغي
--    كلَّ التوكنات المرتبطة به** وتستلزم **إعادةَ تثبيت التطبيق من متجر سلّة**.
--    («Refresh tokens are single-use only… attempting to use it twice
--      invalidates…»، وعمرُ التوكن ١٤ يوماً وعمرُ رمز التحديث شهرٌ واحد.)
--    ⇒ فهذه عمليّةٌ **غيرُ آمنةٍ للتكرار بطبيعتها**، وهي نفسُ فئة الاسترداد
--      في v14.97. والقواعدُ منقولةٌ منها حرفياً:
--        • قفلٌ ذرّيٌّ في القاعدة **قبل** النداء (`inflight`)، لا في الواجهة.
--        • **نتيجةٌ مجهولة لا تُعاد تلقائياً** — تُوسَم `needs_reconnect`.
--        • ولكلّ حالةٍ تُنتجها المنصّة **مخرجٌ بضغطة** (زرُّ «أعِد الربط»).
--
-- 🪤 وقياسٌ ثانٍ غيّر المعماريّة (أُجري على الخادم الآن لا استُنتج):
--    `POST https://accounts.salla.sa/oauth2/token` بجسمٍ **JSON** يردّ ٤٠٠
--    `invalid_request` (لم يُقرأ)، وبجسمٍ **form-encoded** يردّ ٤٠١
--    `invalid_client` (قُرئ وفشل على العميل الوهميّ وحده). وزد كذلك.
--    و`pg_net` لا يُرسل إلا `jsonb`. ⇒ **تبادلُ الرموز وتحديثُها لا يمكن أن
--    يجري داخل القاعدة**، فيجري في دالّة حافة، والقاعدةُ تحتفظ بالأسرار
--    والأقفال وتُسلّم للدالّة ما تحتاجه فقط.
--
-- 🪤 وقياسٌ ثالث: «الوضعُ السهل» في سلّة يبدأ برابط تثبيت
--    `https://s.salla.sa/apps/install/{app-id}` و**لا يدعم `state`** — فالتوكن
--    يصل بـ`merchant` وحده (عددٌ صحيحٌ في جذر الرسالة لا كائن). ⇒ المطابقةُ
--    بنافذةِ طلبٍ قصيرة، **وإن التبست لا تُخمَّن**: تُحفظ الرسالةُ جانباً
--    ويربطها التاجر برقم متجره. وزد بخلافها تُعيد `state` كما هو، فمطابقتُها
--    يقينية.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public._taki_stock_token_set(uuid,jsonb)') IS NULL
     OR to_regprocedure('public._taki_stock_enqueue(uuid,text,text,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'v15.17 غير مطبَّقة — أوقِفت.';
  END IF;
  IF to_regclass('public.app_secrets') IS NULL THEN
    RAISE EXCEPTION 'عرضُ app_secrets غير موجود — أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) بياناتُ تطبيق تاكي عند كلّ منصّة — في الخزنة، وغائبةٌ اليوم
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 وقِيس أنها غائبة: بحثٌ شامل في `~/Desktop/TAKI/محلّي/` كلِّه لم يجد ذكراً
--    لسلّة ولا زد (والنتيجتان الوحيدتان كانتا كلمة «سلسلة»). ⇒ فلا تطبيقَ
--    مسجَّلاً بعد، والشاشةُ **تقول ذلك للتاجر** ولا تعرض زرّاً لا يعمل.
DROP FUNCTION IF EXISTS public._taki_stock_app(text);
CREATE FUNCTION public._taki_stock_app(p_provider text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v text;
BEGIN
  SELECT value INTO v FROM public.app_secrets
   WHERE key = 'stock_' || lower(COALESCE(p_provider,'')) || '_app';
  IF v IS NULL OR btrim(v) = '' THEN RETURN NULL; END IF;
  RETURN v::jsonb;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION public._taki_stock_app(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._taki_stock_app(text) FROM anon;
REVOKE ALL ON FUNCTION public._taki_stock_app(text) FROM authenticated;

-- سرٌّ يحرس نداءَ مهمّةِ التحديث للدالّة الطرفية (نمطُ `push_shared_secret`)
DO $s$
DECLARE v text;
BEGIN
  SELECT value INTO v FROM public.app_secrets WHERE key = 'stock_oauth_secret';
  IF v IS NULL OR btrim(v) = '' THEN
    -- 🪤 يُولَّد **على الخادم** ولا يُطبع أبداً: سرٌّ مرّ في محادثةٍ صار معروفاً.
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
                                'app_secret:stock_oauth_secret',
                                'TAKI stock OAuth job secret (v15.18)');
    RAISE NOTICE 'ℹ️ وُلّد سرُّ مهمّة التحديث (لم يُطبع).';
  END IF;
END
$s$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) رسائلُ توكنٍ لم نستطع نسبتَها — تُحفظ ولا تُخمَّن
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stock_oauth_parked (
  id         bigserial PRIMARY KEY,
  provider   text NOT NULL,
  remote_id  text,
  secret_name text,                 -- اسمُ السرّ في الخزنة، لا السرّ
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_by uuid REFERENCES public.stock_integrations(id) ON DELETE SET NULL,
  claimed_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_stock_oauth_parked_open
  ON public.stock_oauth_parked (provider, created_at DESC) WHERE claimed_by IS NULL;
COMMENT ON TABLE public.stock_oauth_parked IS
  'توكنٌ وصل ولم نستطع نسبتَه إلى متجرٍ بيقين (v15.18). سلّة لا تُعيد `state` في الوضع السهل ⇒ إن فُتحت نافذتا طلبٍ معاً لا يُخمَّن: يُحفظ هنا ويربطه التاجر برقم متجره. 🪤 ولا يُحفظ التوكنُ في الجدول — اسمُه في الخزنة فقط.';

ALTER TABLE public.stock_oauth_parked ENABLE ROW LEVEL SECURITY;
-- 🪤 ولا سياسةَ قراءةٍ لأحد: الصفُّ يحمل معرّفَ متجرٍ عند مزوّدٍ ولا يخصّ تاجراً
--    بعينه قبل الربط. والشاشةُ تسأل دالّةً مالكةً تُرجع الوجودَ لا المحتوى.
REVOKE ALL ON public.stock_oauth_parked FROM anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) زرُّ «اربط متجرك» — ويُولَّد الـstate على الخادم لا في المتصفّح
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.merchant_stock_connect_url(uuid);
CREATE FUNCTION public.merchant_stock_connect_url(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_me text := NULLIF((SELECT auth.uid())::text, '');
        v_i public.stock_integrations%ROWTYPE; v_app jsonb; v_nonce text;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT * INTO v_i FROM public.stock_integrations WHERE id = p_id;
  IF v_i.store_id IS NULL OR v_i.store_id <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOURS');
  END IF;
  v_app := public._taki_stock_app(v_i.provider);
  -- 🔴 يُقال صريحاً ولا يُعرض زرٌّ لا يعمل: تطبيقُ تاكي غيرُ مسجَّلٍ بعد.
  IF v_app IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'APP_NOT_REGISTERED',
      'provider', v_i.provider);
  END IF;

  v_nonce := encode(extensions.gen_random_bytes(16), 'hex');
  UPDATE public.stock_integrations
     SET connect_nonce = v_nonce, oauth_attempt_at = now(),
         last_note = 'CONNECT_STARTED'
   WHERE id = p_id;

  IF lower(v_i.provider) = 'zid' THEN
    -- مقيسٌ من https://docs.zid.sa/authorization.md — و`state` تُعاد كما هي
    IF COALESCE(v_app->>'client_id','') = '' OR COALESCE(v_app->>'redirect_uri','') = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'APP_INCOMPLETE');
    END IF;
    RETURN jsonb_build_object('ok', true, 'mode', 'redirect',
      'url', 'https://oauth.zid.sa/oauth/authorize'
          || '?client_id='    || public._taki_urlenc(v_app->>'client_id')
          || '&redirect_uri=' || public._taki_urlenc(v_app->>'redirect_uri')
          || '&response_type=code'
          || '&state='        || public._taki_urlenc(p_id::text || ':' || v_nonce),
      'window_minutes', 30);
  END IF;

  IF lower(v_i.provider) = 'salla' THEN
    -- 🪤 ولا `state` هنا: «الوضعُ السهل» يبدأ برابط تثبيت، والتوكن يصل إلى
    --    عنوان التطبيق العامّ بـ`merchant` وحده. فالنسبةُ بنافذةِ ٣٠ دقيقة،
    --    وإن التبست **لا تُخمَّن** (القسم ٥).
    IF COALESCE(v_app->>'app_id','') = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'APP_INCOMPLETE');
    END IF;
    RETURN jsonb_build_object('ok', true, 'mode', 'install',
      'url', 'https://s.salla.sa/apps/install/' || public._taki_urlenc(v_app->>'app_id'),
      'window_minutes', 30);
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'PROVIDER_HAS_NO_OAUTH');
END
$fn$;
REVOKE ALL ON FUNCTION public.merchant_stock_connect_url(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_stock_connect_url(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_stock_connect_url(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) حسابُ انتهاء التوكن — قاعدةٌ واحدة، وللمنصّتين صيغتان مختلفتان
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 وتناقضٌ في وثيقة سلّة نفسها أمسكه المدقّق: `expires` في حدث
--    `app.store.authorize` **طابعٌ زمنيّ يونكس** (تحذيرُهم صريح)، وفي ردّ
--    «الوضع المخصّص» **عددُ ثوانٍ**. ⇒ لا يُكتب محلّلٌ واحدٌ للاثنين.
--    والقاعدةُ هنا: `expires` كبيرة (> ١٠⁹) ⇒ طابعٌ زمنيّ؛ وإلّا ⇒ ثوانٍ.
--    وزد تُرسل `expires_in` ثوانيَ صراحةً (٩٤٦٠٨٠٠٠ = ثلاثُ سنوات).
DROP FUNCTION IF EXISTS public._taki_stock_token_expiry(jsonb);
CREATE FUNCTION public._taki_stock_token_expiry(p_tok jsonb)
RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE v numeric;
BEGIN
  v := NULLIF(btrim(COALESCE(p_tok->>'expires_in', '')), '')::numeric;
  IF v IS NOT NULL AND v > 0 THEN RETURN now() + make_interval(secs => v::int); END IF;
  v := NULLIF(btrim(COALESCE(p_tok->>'expires', '')), '')::numeric;
  IF v IS NULL OR v <= 0 THEN RETURN NULL; END IF;
  IF v > 1000000000 THEN RETURN to_timestamp(v); END IF;
  RETURN now() + make_interval(secs => v::int);
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) استلامُ التوكن — تُنادى بدور الخدمة من دالّة الحافة وحدها
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.taki_stock_oauth_store(uuid, jsonb, text);
CREATE FUNCTION public.taki_stock_oauth_store(p_id uuid, p_tok jsonb, p_remote_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_i public.stock_integrations%ROWTYPE; v_exp timestamptz;
BEGIN
  SELECT * INTO v_i FROM public.stock_integrations WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NO_INTEGRATION'); END IF;
  IF p_tok IS NULL OR COALESCE(btrim(p_tok->>'access_token'), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_ACCESS_TOKEN');
  END IF;
  -- 🔴 الكتابةُ تُثبَت بقراءة: `vault.update_secret` على مؤشّرٍ ميت تكتب صفرَ
  --    صفوفٍ **بلا استثناء** — فحفظٌ بلا قراءةٍ بعده وهمٌ (درسُ v14.44).
  IF NOT public._taki_stock_token_set(p_id, p_tok) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECRET_WRITE_FAILED');
  END IF;
  v_exp := public._taki_stock_token_expiry(p_tok);
  UPDATE public.stock_integrations
     SET oauth_expires_at = v_exp,
         oauth_scope      = NULLIF(btrim(COALESCE(p_tok->>'scope','')), ''),
         oauth_remote_id  = COALESCE(NULLIF(btrim(COALESCE(p_remote_id,'')), ''), oauth_remote_id),
         oauth_state      = 'idle',
         oauth_req_id     = NULL,
         connect_nonce    = NULL,
         last_note        = 'CONNECTED'
   WHERE id = p_id;
  -- وأوّلُ مزامنةٍ فوراً: ربطٌ لا يُظهر رقماً صحيحاً بعده يبدو معطوباً.
  PERFORM public._taki_stock_enqueue(p_id, NULL, 'connect', NULL, 0);
  RETURN jsonb_build_object('ok', true, 'expires_at', v_exp);
END
$fn$;
REVOKE ALL ON FUNCTION public.taki_stock_oauth_store(uuid, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_stock_oauth_store(uuid, jsonb, text) FROM anon;
REVOKE ALL ON FUNCTION public.taki_stock_oauth_store(uuid, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_stock_oauth_store(uuid, jsonb, text) TO service_role;

-- ── حلُّ الـstate عند زد: يقينيّ ────────────────────────────────────────
DROP FUNCTION IF EXISTS public.taki_stock_oauth_resolve_state(text);
CREATE FUNCTION public.taki_stock_oauth_resolve_state(p_state text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_id uuid; v_nonce text; v_i public.stock_integrations%ROWTYPE; v_app jsonb;
BEGIN
  IF p_state IS NULL OR position(':' IN p_state) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_STATE');
  END IF;
  BEGIN
    v_id := split_part(p_state, ':', 1)::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_STATE');
  END;
  v_nonce := split_part(p_state, ':', 2);
  SELECT * INTO v_i FROM public.stock_integrations WHERE id = v_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NO_INTEGRATION'); END IF;
  -- 🪤 ويُقارن النونس بطولٍ ثابت لا بـ`=` على نصٍّ فارغ: اتصالٌ بلا نونس
  --    (لم يُطلب ربطُه) كان سيُطابق `state` بنونسٍ فارغ.
  IF COALESCE(v_i.connect_nonce, '') = '' OR length(v_nonce) <> 32
     OR v_i.connect_nonce <> v_nonce THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STATE_MISMATCH');
  END IF;
  IF v_i.oauth_attempt_at IS NULL OR v_i.oauth_attempt_at < now() - interval '30 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'WINDOW_EXPIRED');
  END IF;
  v_app := public._taki_stock_app(v_i.provider);
  IF v_app IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'APP_NOT_REGISTERED'); END IF;
  RETURN jsonb_build_object('ok', true, 'integration_id', v_i.id, 'provider', v_i.provider,
    'client_id', v_app->>'client_id', 'client_secret', v_app->>'client_secret',
    'redirect_uri', v_app->>'redirect_uri');
END
$fn$;
REVOKE ALL ON FUNCTION public.taki_stock_oauth_resolve_state(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_stock_oauth_resolve_state(text) FROM anon;
REVOKE ALL ON FUNCTION public.taki_stock_oauth_resolve_state(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_stock_oauth_resolve_state(text) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٦) سلّة: نسبةٌ بنافذة — وإن التبست **لا تُخمَّن**
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.taki_stock_oauth_bind_salla(text, jsonb);
CREATE FUNCTION public.taki_stock_oauth_bind_salla(p_remote_id text, p_tok jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_id uuid; v_n int; v_park bigint; v_name text;
BEGIN
  IF p_tok IS NULL OR COALESCE(btrim(p_tok->>'access_token'),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_ACCESS_TOKEN');
  END IF;

  -- (أ) أقوى مطابقة: متجرٌ ربط قبلاً بنفس الرقم (إعادةُ تفويضٍ أو تجديد)
  SELECT id INTO v_id FROM public.stock_integrations
   WHERE lower(provider) = 'salla'
     AND COALESCE(oauth_remote_id,'') = COALESCE(btrim(p_remote_id),'~')
   LIMIT 1;

  -- (ب) وإلّا: نافذةُ طلبٍ مفتوحة، **وواحدةٌ فقط**
  IF v_id IS NULL THEN
    SELECT count(*) INTO v_n FROM public.stock_integrations
     WHERE lower(provider) = 'salla' AND connect_nonce IS NOT NULL
       AND oauth_attempt_at > now() - interval '30 minutes';
    IF v_n = 1 THEN
      SELECT id INTO v_id FROM public.stock_integrations
       WHERE lower(provider) = 'salla' AND connect_nonce IS NOT NULL
         AND oauth_attempt_at > now() - interval '30 minutes';
    END IF;
  END IF;

  IF v_id IS NOT NULL THEN
    RETURN public.taki_stock_oauth_store(v_id, p_tok, p_remote_id)
           || jsonb_build_object('matched_by', CASE WHEN v_n IS NULL THEN 'remote_id' ELSE 'window' END);
  END IF;

  -- (ج) 🔴 لا تُخمَّن: تُحفظ جانباً. وتخمينُ متجرٍ يعني تسليمَ توكنِ تاجرٍ
  --     لتاجرٍ آخر — وهو أسوأُ ما يمكن أن يحدث في هذا الملفّ كلِّه.
  v_name := 'stock_park:' || encode(extensions.gen_random_bytes(12), 'hex');
  PERFORM vault.create_secret(p_tok::text, v_name, 'TAKI parked stock OAuth token (v15.18)');
  INSERT INTO public.stock_oauth_parked (provider, remote_id, secret_name)
  VALUES ('salla', NULLIF(btrim(COALESCE(p_remote_id,'')),''), v_name)
  RETURNING id INTO v_park;
  RETURN jsonb_build_object('ok', false,
    'error', CASE WHEN COALESCE(v_n,0) > 1 THEN 'AMBIGUOUS_CLAIM' ELSE 'NO_OPEN_CLAIM' END,
    'parked', v_park, 'open_claims', COALESCE(v_n, 0));
END
$fn$;
REVOKE ALL ON FUNCTION public.taki_stock_oauth_bind_salla(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_stock_oauth_bind_salla(text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.taki_stock_oauth_bind_salla(text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_stock_oauth_bind_salla(text, jsonb) TO service_role;

-- ── مخرجُ التاجر: يكتب رقمَ متجره فيُربط المحفوظُ جانباً ────────────────
-- 🪤 ولا تُعرض قائمةُ الأرقام المحفوظة لأحد: ذاك يُطلع تاجراً على أرقام
--    متاجر غيره. يُكتب الرقمُ ويُقال «وُجد» أو «لم يوجد» — لا أكثر.
DROP FUNCTION IF EXISTS public.merchant_stock_claim_parked(uuid, text);
CREATE FUNCTION public.merchant_stock_claim_parked(p_id uuid, p_remote_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_me text := NULLIF((SELECT auth.uid())::text, '');
        v_owner text; v_prov text; v_p record; v_tok jsonb; r jsonb;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT store_id, lower(provider) INTO v_owner, v_prov
    FROM public.stock_integrations WHERE id = p_id;
  IF v_owner IS NULL OR v_owner <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOURS');
  END IF;
  IF COALESCE(btrim(p_remote_id), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'REMOTE_ID_REQUIRED');
  END IF;
  SELECT * INTO v_p FROM public.stock_oauth_parked
   WHERE provider = v_prov AND claimed_by IS NULL
     AND remote_id = btrim(p_remote_id)
   ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;

  SELECT decrypted_secret::jsonb INTO v_tok FROM vault.decrypted_secrets WHERE name = v_p.secret_name;
  IF v_tok IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'SECRET_GONE'); END IF;

  r := public.taki_stock_oauth_store(p_id, v_tok, btrim(p_remote_id));
  IF NOT COALESCE((r->>'ok')::boolean, false) THEN RETURN r; END IF;

  UPDATE public.stock_oauth_parked SET claimed_by = p_id, claimed_at = now() WHERE id = v_p.id;
  DELETE FROM vault.secrets WHERE name = v_p.secret_name;
  RETURN jsonb_build_object('ok', true, 'expires_at', r->>'expires_at');
END
$fn$;
REVOKE ALL ON FUNCTION public.merchant_stock_claim_parked(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_stock_claim_parked(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_stock_claim_parked(uuid, text) TO authenticated;

-- عدٌّ بلا محتوى، ليعرف التاجر أن هناك ما ينتظر ربطه
DROP FUNCTION IF EXISTS public.merchant_stock_parked_count(uuid);
CREATE FUNCTION public.merchant_stock_parked_count(p_id uuid)
RETURNS int
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_me text := NULLIF((SELECT auth.uid())::text, ''); v_owner text; v_prov text;
BEGIN
  IF v_me IS NULL THEN RETURN 0; END IF;
  SELECT store_id, lower(provider) INTO v_owner, v_prov
    FROM public.stock_integrations WHERE id = p_id;
  IF v_owner IS NULL OR v_owner <> v_me THEN RETURN 0; END IF;
  RETURN (SELECT count(*) FROM public.stock_oauth_parked
           WHERE provider = v_prov AND claimed_by IS NULL
             AND created_at > now() - interval '7 days');
END
$fn$;
REVOKE ALL ON FUNCTION public.merchant_stock_parked_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_stock_parked_count(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_stock_parked_count(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٧) التحديثُ الدوريّ — محاولةٌ واحدة، وقفلٌ ذرّيّ، ونتيجةٌ مجهولة لا تُعاد
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 القاعدةُ المالية نفسُها من v14.97، مُسقطةً على رمزٍ لا على مال:
--    عمليّةٌ **غيرُ آمنةٍ للتكرار** ⇒ القفلُ في القاعدة قبل النداء، لا بعده
--    ولا في الواجهة. و«إعادةُ المحاولة» على نتيجةٍ مجهولة ليست حرصاً — هي
--    **الطريقُ المؤكَّد لقتل الربط**: ثانيَ استعمالٍ لرمز سلّة يُبيد التفويضَ
--    كلَّه ويستلزم إعادةَ تثبيتٍ من متجرها.
DROP FUNCTION IF EXISTS public.taki_stock_token_refresh_claim(int);
CREATE FUNCTION public.taki_stock_token_refresh_claim(p_limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_out jsonb := '[]'::jsonb; v_row record; v_app jsonb; v_tok jsonb;
BEGIN
  -- 🪤 عتبتان مختلفتان، وكلتاهما مقيسةٌ من الوثيقة:
  --    سلّة: التوكن ١٤ يوماً ورمزُ التحديث شهرٌ ⇒ يُحدَّث عند **٣ أيام**
  --          (داخل نافذة الشهر بفارقٍ واسع، وقبل الانتهاء بوقتٍ كافٍ).
  --    زد:   `expires_in` ٩٤٦٠٨٠٠٠ ثانية = **ثلاثُ سنوات** ⇒ **٣٠ يوماً**.
  --    🪤 وملاحظةٌ لناصر: «سنةٌ واحدة» التي كنتَ تذكرها صارت ثلاثاً — السنةُ
  --       للتوكنات المُصدَرة قبل منتصف ٢٠٢٥ بحسب وثيقتهم.
  FOR v_row IN
    UPDATE public.stock_integrations i
       SET oauth_state = 'inflight', oauth_attempt_at = now()
     WHERE i.id IN (
       SELECT x.id FROM public.stock_integrations x
        WHERE x.is_enabled
          AND COALESCE(x.oauth_state, 'idle') = 'idle'
          AND x.oauth_expires_at IS NOT NULL
          AND x.oauth_expires_at < now() + CASE lower(x.provider)
                WHEN 'salla' THEN interval '3 days'
                WHEN 'zid'   THEN interval '30 days'
                ELSE interval '3 days' END
        ORDER BY x.oauth_expires_at
        LIMIT GREATEST(COALESCE(p_limit, 20), 1))
       AND COALESCE(i.oauth_state, 'idle') = 'idle'
    RETURNING i.id, i.provider
  LOOP
    v_app := public._taki_stock_app(v_row.provider);
    v_tok := public._taki_stock_token(v_row.id);
    IF v_app IS NULL OR v_tok IS NULL
       OR COALESCE(btrim(v_tok->>'refresh_token'), '') = '' THEN
      -- 🔴 لا رمزَ تحديثٍ أصلاً ⇒ لا محاولة. ويُوسَم فوراً لأن الانتظارَ
      --    حتى الانتهاء يعني انقطاعاً مفاجئاً بلا سابق إنذار للتاجر.
      UPDATE public.stock_integrations
         SET oauth_state = 'needs_reconnect', last_note = 'NO_REFRESH_TOKEN'
       WHERE id = v_row.id;
      CONTINUE;
    END IF;
    v_out := v_out || jsonb_build_object(
      'integration_id', v_row.id, 'provider', lower(v_row.provider),
      'client_id', v_app->>'client_id', 'client_secret', v_app->>'client_secret',
      'refresh_token', v_tok->>'refresh_token');
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'jobs', v_out);
END
$fn$;
REVOKE ALL ON FUNCTION public.taki_stock_token_refresh_claim(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_stock_token_refresh_claim(int) FROM anon;
REVOKE ALL ON FUNCTION public.taki_stock_token_refresh_claim(int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_stock_token_refresh_claim(int) TO service_role;

DROP FUNCTION IF EXISTS public.taki_stock_token_refresh_done(uuid, text, jsonb, text);
CREATE FUNCTION public.taki_stock_token_refresh_done(
  p_id uuid, p_outcome text, p_tok jsonb DEFAULT NULL, p_error text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_state text; r jsonb;
BEGIN
  SELECT oauth_state INTO v_state FROM public.stock_integrations WHERE id = p_id;
  IF v_state IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NO_INTEGRATION'); END IF;
  IF v_state <> 'inflight' THEN
    -- 🪤 ردٌّ على قفلٍ غير قائم: إمّا نتيجةٌ متأخّرةٌ جداً وإمّا نداءٌ مكرّر.
    --    لا يُطبَّق — فتطبيقُه قد يدهس توكناً أحدثَ منه.
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_INFLIGHT', 'state', v_state);
  END IF;

  IF p_outcome = 'ok' THEN
    r := public.taki_stock_oauth_store(p_id, p_tok, NULL);
    IF NOT COALESCE((r->>'ok')::boolean, false) THEN
      -- فشلُ الحفظ بعد نجاح التحديث = التوكنُ الجديد ضاع ⇒ لا يُعاد الرمزُ
      --    القديمُ أبداً (استُهلك). المخرجُ إعادةُ ربطٍ بضغطة.
      UPDATE public.stock_integrations
         SET oauth_state = 'needs_reconnect', last_note = 'REFRESH_SAVE_FAILED'
       WHERE id = p_id;
      RETURN r;
    END IF;
    RETURN jsonb_build_object('ok', true);
  END IF;

  -- 🔴 كلُّ ما ليس نجاحاً صريحاً ⇒ `needs_reconnect`. وهذا **ليس تشاؤماً**:
  --    رمزُ التحديث استُهلك أو قد يكون استُهلك، ومحاولةٌ ثانيةٌ به تُبيد
  --    التفويضَ نهائياً. وكلفةُ الخطأ هنا غيرُ متناظرة: ضغطةٌ من التاجر
  --    مقابل إعادةِ تثبيتٍ من متجر سلّة.
  UPDATE public.stock_integrations
     SET oauth_state = 'needs_reconnect',
         last_note = CASE WHEN p_outcome = 'auth_failed' THEN 'REFRESH_REJECTED'
                          ELSE 'REFRESH_UNKNOWN' END
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'parked', true, 'outcome', p_outcome,
                            'detail', left(COALESCE(p_error, ''), 200));
END
$fn$;
REVOKE ALL ON FUNCTION public.taki_stock_token_refresh_done(uuid, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_stock_token_refresh_done(uuid, text, jsonb, text) FROM anon;
REVOKE ALL ON FUNCTION public.taki_stock_token_refresh_done(uuid, text, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_stock_token_refresh_done(uuid, text, jsonb, text) TO service_role;

-- ── القفلُ العالق: يُوسَم ولا يُحرَّر ───────────────────────────────────
-- 🔴 وهذا عكسُ ما تفعله كلُّ الطوابير الأخرى في تاكي عمداً: `inflight` عالقٌ
--    يعني أنّنا **لا نعرف** هل استُهلك الرمز. وتحريرُه إلى `idle` يعني
--    محاولةً ثانيةً بنفس الرمز ⇒ إبادةٌ محتملة. فالعالقُ يصير `needs_reconnect`.
CREATE OR REPLACE FUNCTION public.taki_stock_token_reap()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_n int;
BEGIN
  UPDATE public.stock_integrations
     SET oauth_state = 'needs_reconnect', last_note = 'REFRESH_STUCK'
   WHERE oauth_state = 'inflight' AND oauth_attempt_at < now() - interval '10 minutes';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$fn$;
REVOKE ALL ON FUNCTION public.taki_stock_token_reap() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_stock_token_reap() FROM anon;
REVOKE ALL ON FUNCTION public.taki_stock_token_reap() FROM authenticated;

-- ── إلغاءُ التثبيت عندهم ⇒ قطعُ الربط عندنا ─────────────────────────────
DROP FUNCTION IF EXISTS public.taki_stock_oauth_revoke(text, text);
CREATE FUNCTION public.taki_stock_oauth_revoke(p_provider text, p_remote_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.stock_integrations
   WHERE lower(provider) = lower(COALESCE(p_provider,''))
     AND COALESCE(oauth_remote_id,'') = COALESCE(btrim(p_remote_id),'~');
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  DELETE FROM vault.secrets WHERE name = 'stock_tok:' || v_id::text;
  UPDATE public.stock_integrations
     SET oauth_state = NULL, oauth_expires_at = NULL, connect_nonce = NULL,
         last_note = 'UNINSTALLED_AT_PROVIDER'
   WHERE id = v_id;
  -- 🪤 ولا يُطفأ الاتصالُ نفسه: التاجر قد يُعيد التثبيت، وإطفاءُ الاتصال
  --    يمحو روابطَ منتجاته التي ربطها بيده.
  RETURN jsonb_build_object('ok', true, 'integration_id', v_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.taki_stock_oauth_revoke(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_stock_oauth_revoke(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.taki_stock_oauth_revoke(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_stock_oauth_revoke(text, text) TO service_role;

-- ── ومخرجُ التاجر: فصلُ الربط بضغطة ────────────────────────────────────
DROP FUNCTION IF EXISTS public.merchant_stock_disconnect(uuid);
CREATE FUNCTION public.merchant_stock_disconnect(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_me text := NULLIF((SELECT auth.uid())::text, ''); v_owner text;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT store_id INTO v_owner FROM public.stock_integrations WHERE id = p_id;
  IF v_owner IS NULL OR v_owner <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOURS');
  END IF;
  DELETE FROM vault.secrets WHERE name = 'stock_tok:' || p_id::text;
  UPDATE public.stock_integrations
     SET oauth_state = NULL, oauth_expires_at = NULL, oauth_scope = NULL,
         connect_nonce = NULL, last_note = 'DISCONNECTED'
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END
$fn$;
REVOKE ALL ON FUNCTION public.merchant_stock_disconnect(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_stock_disconnect(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_stock_disconnect(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٨) إطلاقُ المهمّة — والقاعدةُ تنادي الدالّة الطرفية، لا العكس
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.taki_stock_token_refresh_kick()
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_sec text; v_req bigint;
BEGIN
  -- لا عملَ ⇒ لا نداء. (مهمّةٌ تنادي كلَّ نصف ساعةٍ بلا داعٍ دَينٌ صامت.)
  IF NOT EXISTS (
    SELECT 1 FROM public.stock_integrations
     WHERE is_enabled AND COALESCE(oauth_state,'idle') = 'idle'
       AND oauth_expires_at IS NOT NULL
       AND oauth_expires_at < now() + interval '30 days') THEN
    RETURN NULL;
  END IF;
  SELECT value INTO v_sec FROM public.app_secrets WHERE key = 'stock_oauth_secret';
  IF COALESCE(v_sec,'') = '' THEN RAISE WARNING 'stock_oauth_secret مفقود — لا تحديث.'; RETURN NULL; END IF;
  -- 🪤 العنوانُ العامّ لا `SUPABASE_URL`: ذاك داخل الحاوية `http://kong:8000`
  --    (درسٌ مسجَّل). وقِيس أن القاعدة تصل `api.takisa.net` فعلاً.
  v_req := net.http_post(
    url := 'https://api.takisa.net/functions/v1/stock-oauth/refresh',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-stock-oauth-secret', v_sec),
    timeout_milliseconds := 20000);
  RETURN v_req;
END
$fn$;
REVOKE ALL ON FUNCTION public.taki_stock_token_refresh_kick() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_stock_token_refresh_kick() FROM anon;
REVOKE ALL ON FUNCTION public.taki_stock_token_refresh_kick() FROM authenticated;

SELECT cron.unschedule(j) FROM (VALUES
  ('taki-stock-token-refresh'), ('taki-stock-token-reap')) AS t(j)
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = t.j);
-- كلُّ نصف ساعة: العتبةُ ثلاثةُ أيامٍ عند سلّة، فهذا فائضٌ كبيرٌ من الفرص.
SELECT cron.schedule('taki-stock-token-refresh', '*/30 * * * *',
                     $$SELECT public.taki_stock_token_refresh_kick();$$);
SELECT cron.schedule('taki-stock-token-reap', '*/5 * * * *',
                     $$SELECT public.taki_stock_token_reap();$$);

-- ═══════════════════════════════════════════════════════════════════════════
-- ٩) فحصٌ يرفع استثناءً — وبأسرارِ اختبارٍ تُحذف في نهايته
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  v_me text; v_a uuid; v_b uuid; r jsonb; v_n int; v_st text; v_jobs jsonb;
  FAKE_APP constant text :=
    '{"client_id":"taki_test_cid","client_secret":"taki_test_sec","app_id":"999999","redirect_uri":"https://www.takisa.net/stock/oauth/zid"}';
BEGIN
  SELECT id INTO v_me FROM public.users
   WHERE user_type IN ('seller','admin') AND deleted_at IS NULL ORDER BY id LIMIT 1;
  IF v_me IS NULL THEN RAISE NOTICE 'ℹ️ لا حساب تاجر — تخطّي.'; RETURN; END IF;

  -- ── (١) الصلاحيات: لا دالّةَ خدمةٍ ممنوحةٌ لدورٍ عامّ ──────────────────
  IF has_function_privilege('anon', 'public.taki_stock_oauth_store(uuid,jsonb,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.taki_stock_oauth_store(uuid,jsonb,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.taki_stock_oauth_bind_salla(text,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.taki_stock_token_refresh_claim(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public._taki_stock_app(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._taki_stock_app(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ 🔴 دالّةُ أسرارٍ أو ربطٍ ممنوحةٌ لدورٍ عامّ.';
  END IF;

  -- ── (٢) بلا تطبيقٍ مسجَّل: يُقال صريحاً ولا يُعرض زرٌّ لا يعمل ─────────
  DELETE FROM vault.secrets WHERE name IN ('app_secret:stock_salla_app','app_secret:stock_zid_app');
  INSERT INTO public.stock_integrations
    (store_id, provider, segment, label, api_key_hash, api_key_last4, webhook_slug)
  VALUES (v_me, 'zid', 'ecommerce', 'v1518-a', encode(extensions.digest('a1518','sha256'),'hex'),
          'aaaa', encode(extensions.gen_random_bytes(18),'hex'))
  RETURNING id INTO v_a;
  r := public.merchant_stock_connect_url(v_a);
  IF COALESCE(r->>'error','') <> 'AUTH_REQUIRED' AND COALESCE(r->>'error','') <> 'NOT_YOURS' THEN
    RAISE EXCEPTION '❌ نداءٌ بلا جلسةٍ لم يُرفض: %', r::text;
  END IF;
  RAISE NOTICE 'ℹ️ (٢) زرُّ الربط يحرس الهويّة أوّلاً (%).', r->>'error';

  -- ── (٣) حسابُ الانتهاء: الصيغتان المتناقضتان في وثيقة سلّة ────────────
  -- `expires` طابعٌ زمنيّ (حدثُ app.store.authorize)
  IF public._taki_stock_token_expiry(
       jsonb_build_object('access_token','x','expires', 4102444800)) < now() + interval '365 days' THEN
    RAISE EXCEPTION '❌ 🔴 طابعٌ زمنيٌّ يونكس قُرئ ثوانيَ — فالتوكنُ يُظنّ منتهياً فوراً.';
  END IF;
  -- `expires` عددُ ثوانٍ (ردُّ الوضع المخصّص: ١٢٠٩٥٩٩ ≈ أسبوعان)
  IF public._taki_stock_token_expiry(jsonb_build_object('access_token','x','expires', 1209599))
       NOT BETWEEN now() + interval '13 days' AND now() + interval '15 days' THEN
    RAISE EXCEPTION '❌ عددُ ثوانٍ لم يُقرأ مدّةً.';
  END IF;
  -- زد: `expires_in` ثلاثُ سنوات
  IF public._taki_stock_token_expiry(jsonb_build_object('access_token','x','expires_in', 94608000))
       < now() + interval '1000 days' THEN
    RAISE EXCEPTION '❌ `expires_in` زد لم يُقرأ (ثلاثُ سنوات).';
  END IF;
  IF public._taki_stock_token_expiry('{"access_token":"x"}'::jsonb) IS NOT NULL THEN
    RAISE EXCEPTION '❌ توكنٌ بلا انتهاءٍ أُعطي تاريخاً مخترَعاً.';
  END IF;
  RAISE NOTICE '✅ (٣) الانتهاء: طابعٌ يونكس · ثوانٍ · expires_in · وبلا حقلٍ ⇒ NULL.';

  -- ── (٤) 🔴 الأخطر: توكنُ سلّة لا يُسلَّم لمتجرٍ مخطوء ─────────────────
  PERFORM vault.create_secret(FAKE_APP, 'app_secret:stock_salla_app', 'TEST ONLY — v15.18 verify');
  UPDATE public.stock_integrations SET provider = 'salla' WHERE id = v_a;
  INSERT INTO public.stock_integrations
    (store_id, provider, segment, label, api_key_hash, api_key_last4, webhook_slug)
  VALUES (v_me, 'salla', 'ecommerce', 'v1518-b', encode(extensions.digest('b1518','sha256'),'hex'),
          'bbbb', encode(extensions.gen_random_bytes(18),'hex'))
  RETURNING id INTO v_b;

  -- (٤-أ) صفرُ نوافذَ مفتوحة ⇒ يُحفظ جانباً ولا يُربط
  r := public.taki_stock_oauth_bind_salla('7777777',
         '{"access_token":"tok_a","refresh_token":"ref_a","expires":1209599}'::jsonb);
  IF COALESCE((r->>'ok')::boolean, false) OR COALESCE(r->>'error','') <> 'NO_OPEN_CLAIM' THEN
    RAISE EXCEPTION '❌ 🔴 توكنٌ بلا نافذةِ طلبٍ رُبط بمتجرٍ — تخمينُ هويّة: %', r::text;
  END IF;

  -- (٤-ب) نافذتان مفتوحتان ⇒ **لا يُخمَّن**
  UPDATE public.stock_integrations
     SET connect_nonce = encode(extensions.gen_random_bytes(16),'hex'), oauth_attempt_at = now()
   WHERE id IN (v_a, v_b);
  r := public.taki_stock_oauth_bind_salla('8888888',
         '{"access_token":"tok_b","refresh_token":"ref_b","expires":1209599}'::jsonb);
  IF COALESCE((r->>'ok')::boolean, false) OR COALESCE(r->>'error','') <> 'AMBIGUOUS_CLAIM' THEN
    RAISE EXCEPTION '❌ 🔴 التبستِ النافذتان فخُمّن متجر — توكنُ تاجرٍ لتاجرٍ آخر: %', r::text;
  END IF;

  -- (٤-ج) نافذةٌ واحدة ⇒ يُربط
  UPDATE public.stock_integrations SET connect_nonce = NULL WHERE id = v_b;
  r := public.taki_stock_oauth_bind_salla('9999999',
         '{"access_token":"tok_c","refresh_token":"ref_c","expires":1209599}'::jsonb);
  IF NOT COALESCE((r->>'ok')::boolean, false) THEN
    RAISE EXCEPTION '❌ نافذةٌ واحدةٌ واضحةٌ لم تُربط: %', r::text;
  END IF;
  IF COALESCE((SELECT oauth_remote_id FROM public.stock_integrations WHERE id = v_a),'') <> '9999999'
     OR public._taki_stock_token(v_a) IS NULL THEN
    RAISE EXCEPTION '❌ رُبط بلا حفظٍ فعليّ للتوكن.';
  END IF;

  -- (٤-د) وإعادةُ التفويض تُطابق بالرقم مباشرةً ولو أُغلقت النافذة
  UPDATE public.stock_integrations SET connect_nonce = NULL, oauth_attempt_at = NULL WHERE id = v_a;
  r := public.taki_stock_oauth_bind_salla('9999999',
         '{"access_token":"tok_d","refresh_token":"ref_d","expires":1209599}'::jsonb);
  IF NOT COALESCE((r->>'ok')::boolean, false) OR COALESCE(r->>'matched_by','') <> 'remote_id' THEN
    RAISE EXCEPTION '❌ إعادةُ التفويض لم تُطابق بالرقم: %', r::text;
  END IF;
  IF COALESCE(public._taki_stock_token(v_a)->>'access_token','') <> 'tok_d' THEN
    RAISE EXCEPTION '❌ التوكنُ الجديد لم يُكتب فوق القديم.';
  END IF;
  RAISE NOTICE '✅ (٤) سلّة: بلا نافذةٍ لا يُربط · والتباسٌ لا يُخمَّن · وواحدةٌ تُربط · وإعادةُ التفويض بالرقم.';

  -- ── (٥) القفلُ الذرّيّ للتحديث — والكسرةُ هنا ─────────────────────────
  UPDATE public.stock_integrations
     SET oauth_state = 'idle', oauth_expires_at = now() + interval '1 day' WHERE id = v_a;
  v_jobs := public.taki_stock_token_refresh_claim(20);
  IF jsonb_array_length(COALESCE(v_jobs->'jobs','[]'::jsonb)) <> 1 THEN
    RAISE EXCEPTION '❌ توكنٌ يقترب من الانتهاء لم يُحجز: %', v_jobs::text;
  END IF;
  IF COALESCE((SELECT oauth_state FROM public.stock_integrations WHERE id = v_a),'') <> 'inflight' THEN
    RAISE EXCEPTION '❌ القفلُ لم يُوضع.';
  END IF;
  -- 🔴 الكسرة: نبضةٌ ثانيةٌ متوازية **يجب** أن تجد صفراً. ولولا ذلك جرى
  --    تحديثان برمزٍ واحدٍ يُستعمل مرّةً ⇒ إبادةُ تفويض التاجر.
  v_jobs := public.taki_stock_token_refresh_claim(20);
  IF jsonb_array_length(COALESCE(v_jobs->'jobs','[]'::jsonb)) <> 0 THEN
    RAISE EXCEPTION '❌ 🔴 القفلُ لا يمنع نبضةً ثانية — تحديثان برمزٍ واحدٍ يُبيدان التفويض: %', v_jobs::text;
  END IF;

  -- (٥-ب) نتيجةٌ مجهولة ⇒ `needs_reconnect` لا إعادة
  r := public.taki_stock_token_refresh_done(v_a, 'unknown', NULL, 'socket closed');
  SELECT oauth_state INTO v_st FROM public.stock_integrations WHERE id = v_a;
  IF v_st <> 'needs_reconnect' THEN
    RAISE EXCEPTION '❌ 🔴 نتيجةٌ مجهولةٌ أُعيدت إلى idle (%) — المحاولةُ الثانية تقتل الربط.', v_st;
  END IF;
  -- وهي لا تُحجز ثانيةً أبداً
  v_jobs := public.taki_stock_token_refresh_claim(20);
  IF jsonb_array_length(COALESCE(v_jobs->'jobs','[]'::jsonb)) <> 0 THEN
    RAISE EXCEPTION '❌ 🔴 اتصالٌ في needs_reconnect حُجز للتحديث.';
  END IF;

  -- (٥-ج) والقفلُ العالق يُوسَم ولا يُحرَّر
  UPDATE public.stock_integrations
     SET oauth_state = 'inflight', oauth_attempt_at = now() - interval '20 minutes' WHERE id = v_a;
  PERFORM public.taki_stock_token_reap();
  SELECT oauth_state INTO v_st FROM public.stock_integrations WHERE id = v_a;
  IF v_st <> 'needs_reconnect' THEN
    RAISE EXCEPTION '❌ 🔴 قفلٌ عالقٌ حُرِّر إلى % بدل needs_reconnect.', v_st;
  END IF;
  -- وردٌّ متأخّرٌ على قفلٍ غير قائم لا يُطبَّق
  r := public.taki_stock_token_refresh_done(v_a, 'ok',
         '{"access_token":"tok_late"}'::jsonb, NULL);
  IF COALESCE((r->>'ok')::boolean, false) THEN
    RAISE EXCEPTION '❌ 🔴 ردٌّ متأخّرٌ طُبّق على قفلٍ غير قائم: %', r::text;
  END IF;
  RAISE NOTICE '✅ (٥) القفل: نبضةٌ واحدة · ومجهولٌ ⇒ إعادةُ ربطٍ · وعالقٌ يُوسَم · ومتأخّرٌ يُرفض.';

  -- ── (٦) حلُّ الـstate عند زد ──────────────────────────────────────────
  PERFORM vault.create_secret(FAKE_APP, 'app_secret:stock_zid_app', 'TEST ONLY — v15.18 verify');
  UPDATE public.stock_integrations
     SET provider = 'zid', connect_nonce = repeat('a', 32), oauth_attempt_at = now() WHERE id = v_b;
  IF NOT COALESCE((public.taki_stock_oauth_resolve_state(v_b::text || ':' || repeat('a',32))->>'ok')::boolean, false) THEN
    RAISE EXCEPTION '❌ stateٌ صحيحٌ لم يُحلّ.';
  END IF;
  IF COALESCE(public.taki_stock_oauth_resolve_state(v_b::text || ':' || repeat('b',32))->>'error','') <> 'STATE_MISMATCH' THEN
    RAISE EXCEPTION '❌ 🔴 نونسٌ خاطئٌ قُبل.';
  END IF;
  -- 🔴 والكسرةُ المهمّة: اتصالٌ **بلا نونس** لا يُطابق نونساً فارغاً
  UPDATE public.stock_integrations SET connect_nonce = NULL WHERE id = v_b;
  IF COALESCE(public.taki_stock_oauth_resolve_state(v_b::text || ':')->>'error','') NOT IN ('STATE_MISMATCH','BAD_STATE') THEN
    RAISE EXCEPTION '❌ 🔴 اتصالٌ بلا نونسٍ طابق stateً فارغاً — ربطٌ بلا طلب.';
  END IF;
  UPDATE public.stock_integrations
     SET connect_nonce = repeat('c',32), oauth_attempt_at = now() - interval '2 hours' WHERE id = v_b;
  IF COALESCE(public.taki_stock_oauth_resolve_state(v_b::text || ':' || repeat('c',32))->>'error','') <> 'WINDOW_EXPIRED' THEN
    RAISE EXCEPTION '❌ نافذةٌ منتهيةٌ قُبلت.';
  END IF;
  RAISE NOTICE '✅ (٦) زد: stateٌ صحيحٌ يُحلّ · وخاطئٌ وفارغٌ ومنتهيةٌ تُرفض.';

  -- ── (٧) التنظيف ───────────────────────────────────────────────────────
  DELETE FROM vault.secrets WHERE name IN ('app_secret:stock_salla_app','app_secret:stock_zid_app');
  DELETE FROM vault.secrets WHERE name LIKE 'stock_tok:%' OR name LIKE 'stock_park:%';
  DELETE FROM public.stock_oauth_parked;
  DELETE FROM public.stock_integrations WHERE id IN (v_a, v_b);
  IF EXISTS (SELECT 1 FROM public.stock_integrations WHERE label LIKE 'v1518-%')
     OR EXISTS (SELECT 1 FROM vault.secrets WHERE name LIKE 'stock_tok:%' OR name LIKE 'stock_park:%'
                   OR name IN ('app_secret:stock_salla_app','app_secret:stock_zid_app')) THEN
    RAISE EXCEPTION '❌ بقيّةُ فحصٍ لم تُحذف.';
  END IF;
  IF (SELECT count(*) FROM public.app_secrets WHERE key = 'stock_oauth_secret') <> 1 THEN
    RAISE EXCEPTION '❌ سرُّ مهمّة التحديث مفقود.';
  END IF;
  RAISE NOTICE '✅ v15.18: الرموزُ في الخزنة · قفلٌ ذرّيّ · ومجهولٌ لا يُعاد · ولا بقايا (وتطبيقُ تاكي غيرُ مسجَّلٍ بعد — عمداً).';
END
$verify$;
