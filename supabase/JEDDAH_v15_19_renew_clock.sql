-- ═══════════════════════════════════════════════════════════════════════════
-- v15.19 — الساعةُ الخاطئة: ربطُ زد كان سيموت صامتاً بعد سنة
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 عيبٌ في v15.18 نفسها، أمسكه تدقيقٌ خصوميٌّ على وثيقة زد، ويُقال كما هو:
--
--    v15.18 تُجدّد التوكنَ بالنظر إلى **انتهائه هو** (`oauth_expires_at`)
--    قبله بثلاثين يوماً عند زد. و`expires_in` عند زد **٩٤٦٠٨٠٠٠ ثانية = ثلاث
--    سنوات**. أي أن أوّلَ تجديدٍ كان سيقع بعد **سنتين وأحد عشر شهراً**.
--
--    ولكنّ **رمزَ التحديث عند زد يعيش سنةً واحدة**:
--      «The refresh token lasts 1 year while the access token lasts 3»
--      (docs.zid.sa/oauth-troubleshooting.md)
--    ⇒ فالرمزُ يموت قبل أوّل استعمالٍ له بسنتين، ويبقى التوكنُ يعمل سنتين
--      إضافيّتين ثمّ ينقطع الربطُ **بلا أيّ إنذار ولا أيّ سبيلٍ آليّ للتجديد**،
--      ويحتاج التاجرُ إعادةَ تفويضٍ من الصفر.
--
-- 🪤 والدرسُ المعمَّم: **الساعةُ التي تُجدَّد عليها ليست ساعةَ التوكن بل ساعةَ
--    ما تُجدَّد به.** وأقصرُ العمرَين هو الحاكم دائماً. وعند سلّة الأمرُ معكوس
--    (توكنٌ ١٤ يوماً ورمزُ تحديثٍ شهرٌ) فبدا التصميمُ صحيحاً — وتعميمُ حالة
--    سلّة على زد هو الخطأ بعينه.
--
-- 🪤 وعلاجُه عمودٌ صريح `oauth_renew_at` **يُحسب لحظةَ الحفظ** لا شرطٌ في
--    الاستعلام: شرطٌ في الاستعلام يعني أنّ تغييرَ العتبة لاحقاً يحتاج تذكّرَ
--    موضعه، وعمودٌ محسوبٌ يُرى في الشاشة ويُراجَع.
--
-- وثلاثةُ تصحيحاتٍ أصغر من نفس التدقيق:
--   • **سقفُ زد ٦٠/دقيقة أرضيّةٌ لا عقد** («can be configured by Zid, so treat
--     60/60s as a floor, not a contract») ⇒ لا يُصمَّم على حدّه.
--   • **ونطاقُ سقف سلّة غيرُ موثَّق**: هل الحصّة لكلّ تطبيقٍ أم مشتركةٌ بين كلّ
--     تطبيقات المتجر؟ زد تقول «per application per store» صراحةً وسلّة لا
--     تقول ⇒ يُفترض الأسوأ ويُخفَّض نصيبُنا.
--   • **وترويسةُ زد تُرسل بالاسمين معاً بنفس القيمة**: وثيقتُهم تقول
--     «Send it as `X-Manager-Token` (preferred) **or** `Access-Token`… Never
--     send both with **different** values» ⇒ فالاسمان بنفس القيمة مسموحان
--     صراحةً، ويغطّيان أيَّ نقطةِ نهايةٍ تقرأ أحدهما فقط. و`Accept-Language`
--     يُرسل صريحاً (وثيقتُهم: «Defaults to `en` if not specified»).
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_stock_token_refresh_claim(integer)') IS NULL THEN
    RAISE EXCEPTION 'v15.18 غير مطبَّقة — أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) متى يُجدَّد — عمودٌ صريحٌ يُحسب لحظةَ الحفظ
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.stock_integrations ADD COLUMN IF NOT EXISTS oauth_renew_at timestamptz;
COMMENT ON COLUMN public.stock_integrations.oauth_renew_at IS
  'متى يُجدَّد التوكن (v15.19) — محسوبٌ على عمر **رمز التحديث** لا عمر التوكن. زد: رمزٌ سنةٌ وتوكنٌ ثلاثُ سنوات ⇒ يُجدَّد عند ١٠ أشهر. سلّة: توكنٌ ١٤ يوماً ورمزٌ شهر ⇒ عند ١١ يوماً.';

DROP FUNCTION IF EXISTS public._taki_stock_renew_at(text, jsonb);
CREATE FUNCTION public._taki_stock_renew_at(p_provider text, p_tok jsonb)
RETURNS timestamptz
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
    -- بلا رمزِ تحديثٍ لا تجديدَ ممكن (وتُوسَم حالتُه في مكانٍ آخر)
    WHEN COALESCE(btrim(COALESCE(p_tok->>'refresh_token','')), '') = '' THEN NULL
    -- 🔴 سلّة: التوكنُ ١٤ يوماً ورمزُ التحديث شهر ⇒ الحاكمُ هو التوكن.
    --    (docs.salla.dev/authorization.md: «Access tokens expire after 2 weeks
    --     (14 days)» و«A refresh token lasts for 1 month»)
    WHEN lower(COALESCE(p_provider,'')) = 'salla' THEN now() + interval '11 days'
    -- 🔴 زد: التوكنُ ثلاثُ سنوات ورمزُ التحديث **سنةٌ واحدة** ⇒ الحاكمُ هو
    --    الرمز. (docs.zid.sa/oauth-troubleshooting.md: «The refresh token
    --    lasts 1 year while the access token lasts 3»)
    WHEN lower(COALESCE(p_provider,'')) = 'zid'   THEN now() + interval '10 months'
    -- ومزوّدٌ مجهولُ العمر: شهرٌ احتياطاً، فأقصرُ الأعمار المعروفة شهر.
    ELSE now() + interval '25 days' END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) الحفظُ يكتبه — رقعةٌ من النصّ الحيّ
-- ═══════════════════════════════════════════════════════════════════════════
DO $patch$
DECLARE src text; src0 text;
BEGIN
  src := pg_get_functiondef('public.taki_stock_oauth_store(uuid,jsonb,text)'::regprocedure);
  src0 := src;
  IF position('v15.19 renew' IN src) > 0 THEN RAISE NOTICE 'ℹ️ مرقوعةٌ أصلاً.'; RETURN; END IF;
  IF position(E'     SET oauth_expires_at = v_exp,' IN src) = 0 THEN
    RAISE EXCEPTION '❌ مرساة الحفظ غير موجودة — أوقِفت.';
  END IF;
  src := replace(src, E'     SET oauth_expires_at = v_exp,',
    E'     SET oauth_expires_at = v_exp,\n'
    || E'         -- v15.19 renew — على ساعة **رمز التحديث** لا ساعة التوكن.\n'
    || E'         oauth_renew_at   = public._taki_stock_renew_at(v_i.provider, p_tok),');
  IF src = src0 THEN RAISE EXCEPTION '❌ لم تقع الرقعة.'; END IF;
  EXECUTE src;
  IF position('v15.19 renew' IN pg_get_functiondef('public.taki_stock_oauth_store(uuid,jsonb,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ الرقعة لم تُنفَّذ.';
  END IF;
  RAISE NOTICE '✅ ١) الحفظُ يكتب موعدَ التجديد.';
END
$patch$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) والحجزُ يقرأه — لا عتبةً مشتقّةً من انتهاء التوكن
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.taki_stock_token_refresh_claim(int);
CREATE FUNCTION public.taki_stock_token_refresh_claim(p_limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_out jsonb := '[]'::jsonb; v_row record; v_app jsonb; v_tok jsonb;
BEGIN
  FOR v_row IN
    UPDATE public.stock_integrations i
       SET oauth_state = 'inflight', oauth_attempt_at = now()
     WHERE i.id IN (
       SELECT x.id FROM public.stock_integrations x
        WHERE x.is_enabled
          AND COALESCE(x.oauth_state, 'idle') = 'idle'
          -- 🔴 v15.19: الشرطُ على موعد التجديد وحده. وv15.18 كانت تقيس انتهاءَ
          --    التوكن، فربطُ زد (توكنٌ ٣ سنوات · رمزٌ سنة) كان سيُجدَّد بعد
          --    سنتين و١١ شهراً برمزٍ ميتٍ منذ سنتين ⇒ موتٌ صامت.
          AND x.oauth_renew_at IS NOT NULL
          AND x.oauth_renew_at < now()
        ORDER BY x.oauth_renew_at
        LIMIT GREATEST(COALESCE(p_limit, 20), 1))
       AND COALESCE(i.oauth_state, 'idle') = 'idle'
    RETURNING i.id, i.provider
  LOOP
    v_app := public._taki_stock_app(v_row.provider);
    v_tok := public._taki_stock_token(v_row.id);
    IF v_app IS NULL OR v_tok IS NULL
       OR COALESCE(btrim(v_tok->>'refresh_token'), '') = '' THEN
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

-- وبوّابةُ الإطلاق تسأل نفسَ السؤال
CREATE OR REPLACE FUNCTION public.taki_stock_token_refresh_kick()
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_sec text; v_req bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.stock_integrations
     WHERE is_enabled AND COALESCE(oauth_state,'idle') = 'idle'
       AND oauth_renew_at IS NOT NULL AND oauth_renew_at < now()) THEN
    RETURN NULL;   -- لا عملَ ⇒ لا نداء
  END IF;
  SELECT value INTO v_sec FROM public.app_secrets WHERE key = 'stock_oauth_secret';
  IF COALESCE(v_sec,'') = '' THEN RAISE WARNING 'stock_oauth_secret مفقود — لا تحديث.'; RETURN NULL; END IF;
  -- 🪤 العنوانُ العامّ لا `SUPABASE_URL` (ذاك `http://kong:8000` داخل الحاوية).
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

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) الترويساتُ والسقوف — تصحيحاتُ نفس التدقيق
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._taki_provider_headers(p_provider text, p_tok jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE lower(COALESCE(p_provider, ''))
    WHEN 'salla' THEN jsonb_build_object(
      'Authorization', 'Bearer ' || COALESCE(p_tok->>'access_token', ''),
      'Accept', 'application/json')
    -- 🔴 ترويستان بقيمتين **مختلفتين**: `authorization` توكنُ التطبيق (JWT)
    --    و`access_token` توكنُ المتجر. وخلطُهما يُنتج ٤٠١ دائماً.
    -- 🪤 ويُرسل توكنُ المتجر **بالاسمين** بنفس القيمة: وثيقتُهم تمنع إرسالهما
    --    بقيمتين **مختلفتين** وحدها، وبعضُ نقاط النهاية موثَّقةٌ بـ`Access-Token`
    --    وبعضُها بـ`X-Manager-Token` وأولويّتُهما غيرُ مُثبتة. فالاسمان معاً
    --    يُغطّيان الاثنين بلا مخالفةٍ للوثيقة.
    -- 🪤 و`Accept-Language` صريحاً: وثيقتُهم «Defaults to `en` if not specified»
    --    — والاعتمادُ على افتراضٍ موثَّقٍ أضعفُ من كتابته.
    WHEN 'zid' THEN jsonb_build_object(
      'Authorization',   'Bearer ' || COALESCE(p_tok->>'authorization', ''),
      'X-Manager-Token', COALESCE(p_tok->>'access_token', ''),
      'Access-Token',    COALESCE(p_tok->>'access_token', ''),
      'Accept',          'application/json',
      'Accept-Language', 'en')
    ELSE jsonb_build_object('Accept', 'application/json') END;
$fn$;

CREATE OR REPLACE FUNCTION public._taki_provider_read(p_provider text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE lower(COALESCE(p_provider, ''))
    -- سلّة — https://docs.salla.dev/product/product-details-sku.md
    -- 🪤 و`rpm` هنا **٦٠ لا ١٢٠** عمداً: أدنى باقةٍ موثَّقة ١٢٠/دقيقة، لكنّ
    --    وثيقةَ سلّة **لا تقول** هل الحصّة لكلّ تطبيقٍ أم مشتركةٌ بين كلّ
    --    تطبيقات المتجر (زد تقول «per application per store» صراحةً وسلّة لا).
    --    ⇒ يُفترض الأسوأ: نصفُ الأدنى. وتاجرٌ يستعمل تطبيقاتٍ أخرى لا يتعطّل
    --      بسببنا.
    WHEN 'salla' THEN jsonb_build_object(
      'shape',  'salla',
      'base',   'https://api.salla.dev/admin/v2',
      'path',   '/products/sku/{id}',
      'rpm',    60,
      'doc',    'https://docs.salla.dev/product/product-details-sku.md',
      'rate_doc','https://docs.salla.dev/rate-limiting.md')
    -- زد — https://docs.zid.sa/list-product-stocks.md
    -- 🪤 و٦٠/دقيقة **أرضيّةٌ لا عقد**: «can be configured by Zid, so treat
    --    60/60s as a floor, not a contract». ⇒ نصيبُنا ٤٠٪ منها لا أكثر.
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
-- ٥) فحصٌ يرفع استثناءً — والكسرةُ هي العيبُ نفسه
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  v_me text; v_i uuid; v_jobs jsonb; v_ren timestamptz; v_hdr jsonb;
BEGIN
  -- (١) الساعةُ الصحيحة لكلّ مزوّد
  v_ren := public._taki_stock_renew_at('zid', '{"refresh_token":"r","expires_in":94608000}'::jsonb);
  IF v_ren > now() + interval '11 months' OR v_ren < now() + interval '9 months' THEN
    RAISE EXCEPTION '❌ 🔴 موعدُ تجديد زد خارج نافذة السنة (%) — الرمزُ يموت قبله.', v_ren;
  END IF;
  v_ren := public._taki_stock_renew_at('salla', '{"refresh_token":"r","expires":1209599}'::jsonb);
  IF v_ren > now() + interval '13 days' OR v_ren < now() + interval '9 days' THEN
    RAISE EXCEPTION '❌ موعدُ تجديد سلّة خارج نافذة الأسبوعين (%).', v_ren;
  END IF;
  IF public._taki_stock_renew_at('zid', '{"access_token":"a"}'::jsonb) IS NOT NULL THEN
    RAISE EXCEPTION '❌ أُعطي موعدُ تجديدٍ لتوكنٍ بلا رمز تحديث.';
  END IF;

  -- (٢) 🔴 الكسرة: توكنُ زد ينتهي بعد ثلاث سنوات — ومع ذلك **يجب** أن يُحجز
  --     للتجديد بعد عشرة أشهر. وv15.18 لم تكن تحجزه إطلاقاً.
  SELECT id INTO v_me FROM public.users
   WHERE user_type IN ('seller','admin') AND deleted_at IS NULL ORDER BY id LIMIT 1;
  IF v_me IS NULL THEN RAISE NOTICE 'ℹ️ لا حساب تاجر — تخطّي.'; RETURN; END IF;

  PERFORM vault.create_secret('{"client_id":"t","client_secret":"t","redirect_uri":"https://www.takisa.net/x"}',
                              'app_secret:stock_zid_app', 'TEST ONLY — v15.19 verify');
  INSERT INTO public.stock_integrations
    (store_id, provider, segment, label, api_key_hash, api_key_last4, webhook_slug)
  VALUES (v_me, 'zid', 'ecommerce', 'v1519-verify',
          encode(extensions.digest('v1519','sha256'),'hex'), 'zzzz',
          encode(extensions.gen_random_bytes(18),'hex'))
  RETURNING id INTO v_i;

  PERFORM public.taki_stock_oauth_store(v_i,
    '{"access_token":"a","authorization":"j","refresh_token":"r","expires_in":94608000}'::jsonb, '1234');
  SELECT oauth_renew_at INTO v_ren FROM public.stock_integrations WHERE id = v_i;
  IF v_ren IS NULL THEN RAISE EXCEPTION '❌ الحفظُ لم يكتب موعدَ التجديد.'; END IF;
  IF (SELECT oauth_expires_at FROM public.stock_integrations WHERE id = v_i) < now() + interval '1000 days' THEN
    RAISE EXCEPTION '❌ انتهاءُ التوكن لم يُقرأ ثلاثَ سنوات.';
  END IF;
  -- الآن: لا يُحجز بعد (لم يحن موعدُه)
  IF jsonb_array_length(public.taki_stock_token_refresh_claim(20)->'jobs') <> 0 THEN
    RAISE EXCEPTION '❌ حُجز توكنٌ لم يحن موعدُ تجديده.';
  END IF;
  -- وبعد عشرة أشهرٍ (تُحاكى بإرجاع الموعد): يُحجز **رغم** أن التوكن لم ينته
  UPDATE public.stock_integrations SET oauth_renew_at = now() - interval '1 day' WHERE id = v_i;
  v_jobs := public.taki_stock_token_refresh_claim(20);
  IF jsonb_array_length(COALESCE(v_jobs->'jobs','[]'::jsonb)) <> 1 THEN
    RAISE EXCEPTION '❌ 🔴 لم يُحجز للتجديد مع أنّ رمزَه على وشك الموت: %', v_jobs::text;
  END IF;
  IF COALESCE(v_jobs->'jobs'->0->>'refresh_token','') <> 'r' THEN
    RAISE EXCEPTION '❌ رمزُ التحديث لم يُسلَّم للمهمّة.';
  END IF;

  -- (٣) الترويسات: الاسمان بنفس القيمة، والقيمتان مختلفتان بين الترويستين
  v_hdr := public._taki_provider_headers('zid',
    '{"access_token":"MGR","authorization":"JWT"}'::jsonb);
  IF COALESCE(v_hdr->>'X-Manager-Token','') <> 'MGR'
     OR COALESCE(v_hdr->>'Access-Token','') <> 'MGR'
     OR COALESCE(v_hdr->>'Authorization','') <> 'Bearer JWT'
     OR COALESCE(v_hdr->>'Accept-Language','') <> 'en' THEN
    RAISE EXCEPTION '❌ ترويساتُ زد خاطئة: %', v_hdr::text;
  END IF;
  -- 🔴 وخلطُهما هو العيبُ الذي يُنتج ٤٠١ دائماً — فليُقَس أنهما لا يتساويان
  IF (v_hdr->>'Authorization') = ('Bearer ' || (v_hdr->>'X-Manager-Token')) THEN
    RAISE EXCEPTION '❌ 🔴 نفسُ القيمة في الترويستين — خلطُ توكن التطبيق بتوكن المتجر.';
  END IF;

  -- (٤) السقوفُ خُفّضت عمداً
  IF (public._taki_provider_read('salla')->>'rpm')::int <> 60
     OR (public._taki_provider_read('zid')->>'rpm')::int <> 60 THEN
    RAISE EXCEPTION '❌ السقوفُ لم تُخفَّض إلى الافتراض المتحفّظ.';
  END IF;

  -- (٥) التنظيف
  DELETE FROM vault.secrets WHERE name LIKE 'stock_tok:%' OR name = 'app_secret:stock_zid_app';
  DELETE FROM public.stock_integrations WHERE id = v_i;
  IF EXISTS (SELECT 1 FROM public.stock_integrations WHERE label = 'v1519-verify')
     OR EXISTS (SELECT 1 FROM vault.secrets WHERE name LIKE 'stock_tok:%'
                   OR name = 'app_secret:stock_zid_app') THEN
    RAISE EXCEPTION '❌ بقيّةُ فحصٍ لم تُحذف.';
  END IF;
  RAISE NOTICE '✅ v15.19: التجديدُ على ساعة رمز التحديث · وترويسةُ زد بالاسمين · والسقوفُ متحفّظة.';
END
$verify$;
