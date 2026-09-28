-- ═══════════════════════════════════════════════════════════════════════════
-- v15.10 — أبوابٌ ناقصة: إطفاءُ الربط وفكُّه وتدويرُ مفتاحه
-- ═══════════════════════════════════════════════════════════════════════════
-- v15.08 بنت الإنشاء والربط، ولم تبنِ ما بعدهما. وشاشةٌ تُنشئ ولا تُلغي تترك
-- التاجر أمام حالةٍ لا مخرج منها — وهي نفسُ القاعدة التي بُنيت لأجلها شاشةُ
-- «ردودٌ عالقة»: **كلُّ حالةٍ تُنتجها المنصّة يجب أن يكون منها مخرجٌ بضغطة.**
--
-- 🪤 والمفتاحُ يُدوَّر ولا يُقرأ: لا يُخزَّن أصلاً (sha256 وlast4 فقط)، فمن
--    فقده لا يستعيده — يُصدر غيرَه. وهذا هو السلوك الصحيح لا نقصٌ فيه.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.merchant_create_integration(text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'v15.08 غير مطبَّقة — أوقِفت.';
  END IF;
END
$guard$;

-- ── تعديلُ الربط: تشغيلٌ وإطفاءٌ وعنوانُ الخطّاف ──────────────────────────
DROP FUNCTION IF EXISTS public.merchant_update_integration(uuid, boolean, text, text);
CREATE FUNCTION public.merchant_update_integration(
  p_id uuid, p_enabled boolean DEFAULT NULL,
  p_webhook_url text DEFAULT NULL, p_label text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_me text := NULLIF((SELECT auth.uid())::text, ''); v_owner text;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT store_id INTO v_owner FROM public.stock_integrations WHERE id = p_id;
  IF v_owner IS NULL OR v_owner <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOURS');
  END IF;
  -- 🪤 خطّافٌ بلا https يُرسل أحداثَ مخزونٍ موقَّعةً على قناةٍ مكشوفة.
  IF p_webhook_url IS NOT NULL AND btrim(p_webhook_url) <> '' AND p_webhook_url !~ '^https://' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'HTTPS_REQUIRED');
  END IF;
  UPDATE public.stock_integrations
     SET is_enabled  = COALESCE(p_enabled, is_enabled),
         webhook_url = CASE WHEN p_webhook_url IS NULL THEN webhook_url
                            ELSE NULLIF(btrim(p_webhook_url), '') END,
         label       = CASE WHEN p_label IS NULL THEN label ELSE NULLIF(btrim(p_label), '') END
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END
$fn$;
REVOKE ALL ON FUNCTION public.merchant_update_integration(uuid, boolean, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_update_integration(uuid, boolean, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_update_integration(uuid, boolean, text, text) TO authenticated;

-- ── تدويرُ المفتاح: يُصدَر جديدٌ ويموت القديم في نفس اللحظة ───────────────
DROP FUNCTION IF EXISTS public.merchant_rotate_integration_key(uuid);
CREATE FUNCTION public.merchant_rotate_integration_key(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_me text := NULLIF((SELECT auth.uid())::text, ''); v_owner text; v_key text;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT store_id INTO v_owner FROM public.stock_integrations WHERE id = p_id;
  IF v_owner IS NULL OR v_owner <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOURS');
  END IF;
  -- 🪤 يُولَّد على الخادم: مفتاحٌ يمرّ عبر متصفّحٍ أو محادثةٍ صار معروفاً.
  v_key := 'taki_' || encode(extensions.gen_random_bytes(24), 'hex');
  UPDATE public.stock_integrations
     SET api_key_hash = encode(extensions.digest(v_key, 'sha256'), 'hex'),
         api_key_last4 = right(v_key, 4)
   WHERE id = p_id;
  -- 🔴 يُعاد مرّةً واحدة. ولا يُخزَّن، فلا يُسترجع — يُدوَّر.
  RETURN jsonb_build_object('ok', true, 'api_key', v_key, 'shown_once', true);
END
$fn$;
REVOKE ALL ON FUNCTION public.merchant_rotate_integration_key(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_rotate_integration_key(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_rotate_integration_key(uuid) TO authenticated;

-- ── حذفُ الربط كلّه ──────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.merchant_delete_integration(uuid);
CREATE FUNCTION public.merchant_delete_integration(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_me text := NULLIF((SELECT auth.uid())::text, ''); v_owner text; v_n int;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT store_id INTO v_owner FROM public.stock_integrations WHERE id = p_id;
  IF v_owner IS NULL OR v_owner <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOURS');
  END IF;
  SELECT count(*) INTO v_n FROM public.stock_links WHERE integration_id = p_id;
  -- الروابطُ وصندوقُ الوارد يُحذفان بالتتالي (ON DELETE CASCADE)، والأحداثُ
  -- الصادرة **تبقى** لأنها سجلٌّ لما جرى لا ملكٌ للاتصال.
  DELETE FROM public.stock_integrations WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'unlinked', v_n);
END
$fn$;
REVOKE ALL ON FUNCTION public.merchant_delete_integration(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_delete_integration(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_delete_integration(uuid) TO authenticated;

-- ── فكُّ ربط منتجٍ واحد ──────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.merchant_unlink_product(bigint);
CREATE FUNCTION public.merchant_unlink_product(p_link_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_me text := NULLIF((SELECT auth.uid())::text, ''); v_owner text;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT store_id INTO v_owner FROM public.stock_links WHERE id = p_link_id;
  IF v_owner IS NULL OR v_owner <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOURS');
  END IF;
  DELETE FROM public.stock_links WHERE id = p_link_id;
  RETURN jsonb_build_object('ok', true);
END
$fn$;
REVOKE ALL ON FUNCTION public.merchant_unlink_product(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_unlink_product(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_unlink_product(bigint) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- تحقّقٌ يرفع استثناءً — ومعه قياسٌ سلوكيّ لملكيّة كلّ باب
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE s text; n int; v_id uuid; v_other text; v_me text; r jsonb;
BEGIN
  FOREACH s IN ARRAY ARRAY[
    'public.merchant_update_integration(uuid,boolean,text,text)',
    'public.merchant_rotate_integration_key(uuid)',
    'public.merchant_delete_integration(uuid)',
    'public.merchant_unlink_product(bigint)'
  ] LOOP
    IF to_regprocedure(s) IS NULL THEN RAISE EXCEPTION '❌ % لم تُنشأ.', s; END IF;
    IF has_function_privilege('anon', s, 'EXECUTE') THEN
      RAISE EXCEPTION '❌ % مفتوحةٌ للزائر.', s;
    END IF;
    -- 🔴 كلُّ بابٍ يفحص الملكية بنفسه: RLS لا تحرس دالّةً مالكة.
    IF position('NOT_YOURS' IN pg_get_functiondef(s::regprocedure)) = 0 THEN
      RAISE EXCEPTION '❌ % بلا فحص ملكية — تاجرٌ يعبث بربط تاجرٍ آخر.', s;
    END IF;
  END LOOP;

  -- والمفتاحُ الجديد لا يُقرأ من الجدول بعد التدوير
  IF has_column_privilege('authenticated', 'public.stock_integrations', 'api_key_hash', 'SELECT') THEN
    RAISE EXCEPTION '❌ بصمةُ المفتاح مقروءة.';
  END IF;
  -- وخطّافٌ بلا https مرفوض
  IF position('HTTPS_REQUIRED' IN pg_get_functiondef('public.merchant_update_integration(uuid,boolean,text,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ خطّافٌ بـhttp مقبول — أحداثُ مخزونٍ على قناةٍ مكشوفة.';
  END IF;

  -- قياسٌ سلوكيّ: تدويرُ المفتاح يُبطل القديم فعلاً
  SELECT id INTO v_me FROM public.users WHERE user_type IN ('seller','admin') AND deleted_at IS NULL ORDER BY id LIMIT 1;
  IF v_me IS NOT NULL THEN
    INSERT INTO public.stock_integrations
      (store_id, provider, segment, label, api_key_hash, api_key_last4)
    VALUES (v_me, 'custom', 'other', 'v1510-verify',
            encode(extensions.digest('taki_rotate_probe_0123456789','sha256'),'hex'), '6789')
    RETURNING id INTO v_id;
    INSERT INTO public.stock_links (integration_id, store_id, deal_id, external_id)
    SELECT v_id, v_me, d.id, 'ROT-1' FROM public.deals d WHERE d.store_id = v_me LIMIT 1;

    r := public.taki_stock_push('taki_rotate_probe_0123456789', '[]'::jsonb, now(), 'rot-a');
    IF COALESCE(r->>'error','') = 'UNKNOWN_KEY' THEN
      RAISE EXCEPTION '❌ المفتاح الأصلي لا يعمل — الإعدادُ خاطئ.';
    END IF;
    -- (النتيجةُ ITEMS_REQUIRED لأن القائمة فارغة — والمهمّ أن المفتاح عُرف.)

    UPDATE public.stock_integrations
       SET api_key_hash = encode(extensions.digest('taki_rotated_new_key_98765','sha256'),'hex'),
           api_key_last4 = '8765'
     WHERE id = v_id;
    r := public.taki_stock_push('taki_rotate_probe_0123456789', '[]'::jsonb, now(), 'rot-b');
    IF COALESCE(r->>'error','') <> 'UNKNOWN_KEY' THEN
      RAISE EXCEPTION '❌ المفتاح القديم ما زال يعمل بعد التدوير: %', r::text;
    END IF;

    SELECT count(*) INTO n FROM public.stock_links WHERE integration_id = v_id;
    DELETE FROM public.stock_integrations WHERE id = v_id;
    IF EXISTS (SELECT 1 FROM public.stock_links WHERE integration_id = v_id) THEN
      RAISE EXCEPTION '❌ الروابطُ لم تُحذف بالتتالي — بقايا تشير إلى اتصالٍ ميت.';
    END IF;
    RAISE NOTICE '✅ سلوكيّاً: المفتاح القديم مات بالتدوير · والروابط (%) حُذفت بالتتالي · ولا بقايا.', n;
  END IF;

  SELECT count(*) INTO n FROM public.stock_integrations WHERE label = 'v1510-verify';
  IF n > 0 THEN RAISE EXCEPTION '❌ بقيت % بقيّةً من الفحص.', n; END IF;

  RAISE NOTICE '✅ v15.10: إطفاءٌ وفكٌّ وتدويرٌ وحذف — ولكلٍّ فحصُ ملكيّته.';
END
$verify$;
