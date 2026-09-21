-- ════════════════════════════════════════════════════════════════════════════
-- v14.73b — عنوان المنشأة: نفس الانفصال، يُغلق قبل أن يبدأ
-- ════════════════════════════════════════════════════════════════════════════
-- بلاغ ناصر: «عند النقر على تعديل البروفايل يظهر اختيار الموقع رغم أنها
-- موجودة بالأسفل». قِيس فتبيّن أن الحقل ليس تكراراً لمواقع المتجر — بل شيءٌ
-- آخر تماماً يحمل اسماً مضلّلاً:
--   • `users.address` **ليس** ضمن `PUBLIC_SELLER_COLUMNS`، فلا يصل المتصفّح
--     أصلاً ولا يراه مشترٍ أبداً — رغم أن التعليق في الكود (v13.11) يعد بأنه
--     «عنوان نصّي يظهر للمشترين».
--   • وقارئه الحقيقي واحد: `invoice_customer_details` — أي **عنوان المنشأة
--     على فاتورة اشتراك التاجر** (مستندٌ ضريبيّ B2B يستلمه منّا).
--   • ومواقع المتجر التي يراها المشتري مصدرها `store_branches` وحده
--     (وv13.74 حسمت ذلك: إضافة موقعٍ مكانها لوحة التاجر لا واجهة المتجر).
-- قِيس على جدة: `users.address` فارغ للتجار الثلاثة، ولهم ٤–٥ فروع نشطة.
--
-- 🔴 وفيه نفس عيب v14.71 حرفياً: `invoice_customer_details` تقرأ
--    `coalesce(sp.address, u.address)` — تفضّل `store_profiles` — والموقع يكتب
--    `users.address` وحده. العمودان فارغان اليوم، فالإصلاح **قبل** أن يكتب
--    أوّل تاجر عنوانه، لا بعده.
--
-- 🪤 التوقيع تغيّر (معاملٌ ثالث) ⇒ `DROP` أوّلاً. `CREATE OR REPLACE` كانت
--    ستُنشئ نسخةً ثانية فيصير النداء ملتبساً ويسكت المسار كلّه.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'رُفض: هذا خادم المختبر (طوكيو) — هجرات الإنتاج تُطبَّق على جدة';
  END IF;
END $guard$;

BEGIN;

DROP FUNCTION IF EXISTS public.taki_set_store_card(text, text, text);
DROP FUNCTION IF EXISTS public.merchant_set_store_card(text, text);

CREATE FUNCTION public.taki_set_store_card(
  p_uid        text,
  p_bio        text DEFAULT NULL,   -- NULL = لا تغيّر · '' = امحُ
  p_avatar_url text DEFAULT NULL,
  p_address    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bio    text;
  v_avatar text;
  v_addr   text;
BEGIN
  IF p_uid IS NULL THEN RETURN NULL; END IF;

  v_bio    := CASE WHEN p_bio        IS NULL THEN NULL ELSE nullif(left(btrim(p_bio), 500), '') END;
  v_avatar := CASE WHEN p_avatar_url IS NULL THEN NULL ELSE nullif(btrim(p_avatar_url), '') END;
  v_addr   := CASE WHEN p_address    IS NULL THEN NULL ELSE nullif(left(btrim(p_address), 300), '') END;

  INSERT INTO public.store_profiles (store_id, bio, avatar_url, address, updated_at)
  VALUES (p_uid,
          CASE WHEN p_bio        IS NULL THEN NULL ELSE v_bio    END,
          CASE WHEN p_avatar_url IS NULL THEN NULL ELSE v_avatar END,
          CASE WHEN p_address    IS NULL THEN NULL ELSE v_addr   END,
          now())
  ON CONFLICT (store_id) DO UPDATE SET
    bio        = CASE WHEN p_bio        IS NULL THEN public.store_profiles.bio        ELSE v_bio    END,
    avatar_url = CASE WHEN p_avatar_url IS NULL THEN public.store_profiles.avatar_url ELSE v_avatar END,
    address    = CASE WHEN p_address    IS NULL THEN public.store_profiles.address    ELSE v_addr   END,
    updated_at = now();

  UPDATE public.users SET
    bio        = CASE WHEN p_bio        IS NULL THEN bio        ELSE v_bio    END,
    avatar_url = CASE WHEN p_avatar_url IS NULL THEN avatar_url ELSE v_avatar END,
    address    = CASE WHEN p_address    IS NULL THEN address    ELSE v_addr   END,
    updated_at = now()
  WHERE id = p_uid;

  RETURN (SELECT jsonb_build_object('bio', u.bio, 'avatar_url', u.avatar_url, 'address', u.address)
            FROM public.users u WHERE u.id = p_uid);
END $function$;

REVOKE ALL ON FUNCTION public.taki_set_store_card(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_set_store_card(text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.taki_set_store_card(text, text, text, text) FROM authenticated;

CREATE FUNCTION public.merchant_set_store_card(
  p_bio        text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL,
  p_address    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid  text := auth.uid()::text;
  v_type text;
  v_shop text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT user_type, shop INTO v_type, v_shop
    FROM public.users WHERE id = v_uid AND deleted_at IS NULL;
  IF v_type IS NULL OR (v_type NOT IN ('seller','admin')
      AND nullif(btrim(coalesce(v_shop,'')),'') IS NULL) THEN
    RAISE EXCEPTION 'SELLER_ONLY';
  END IF;
  -- 🪤 حدّ المضيف بالنقطة لا بـ`[^/]*` (فخّ `evil-google.com`)، و`supabase.co`
  --    مقصورٌ على مشروع المعاينة لا كل مشاريع العالم.
  IF p_avatar_url IS NOT NULL AND btrim(p_avatar_url) <> ''
     AND p_avatar_url !~ '^https?://([A-Za-z0-9-]+\.)*(takisa\.net|sslip\.io|kbmqzxcjdankdgiovctm\.supabase\.co)(:[0-9]+)?/' THEN
    RAISE EXCEPTION 'BAD_AVATAR_HOST';
  END IF;
  RETURN public.taki_set_store_card(v_uid, p_bio, p_avatar_url, p_address);
END $function$;

REVOKE ALL ON FUNCTION public.merchant_set_store_card(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_set_store_card(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_set_store_card(text, text, text) TO authenticated;

-- مصالحةٌ آمنة للتكرار (صفر صفوفٍ تفترق اليوم — شبكة أمان)
UPDATE public.store_profiles sp
   SET address = coalesce(nullif(btrim(coalesce(u.address,'')),''), sp.address), updated_at = now()
  FROM public.users u
 WHERE u.id = sp.store_id
   AND coalesce(nullif(btrim(coalesce(u.address,'')),''), sp.address) IS DISTINCT FROM sp.address;

COMMIT;

-- ── تحقّقٌ يرفع استثناءً ─────────────────────────────────────────────────────
DO $verify$
DECLARE n int; sid text; r jsonb;
BEGIN
  FOREACH sid IN ARRAY ARRAY['taki_set_store_card','merchant_set_store_card'] LOOP
    SELECT count(*) INTO n FROM pg_proc
     WHERE proname=sid AND pronamespace='public'::regnamespace;
    IF n <> 1 THEN RAISE EXCEPTION 'فشل: نسخ % = % (نسختان ⇒ نداءٌ ملتبس)', sid, n; END IF;
  END LOOP;
  IF has_function_privilege('anon','public.taki_set_store_card(text, text, text, text)','EXECUTE')
     OR has_function_privilege('authenticated','public.taki_set_store_card(text, text, text, text)','EXECUTE') THEN
    RAISE EXCEPTION 'فشل: الكاتب الداخلي مكشوف';
  END IF;
  IF NOT has_function_privilege('authenticated','public.merchant_set_store_card(text, text, text)','EXECUTE') THEN
    RAISE EXCEPTION 'فشل: باب الموقع غير ممنوح';
  END IF;

  BEGIN
    SELECT u.id INTO sid FROM public.users u
     WHERE (u.user_type IN ('seller','admin') OR nullif(btrim(coalesce(u.shop,'')),'') IS NOT NULL)
       AND u.deleted_at IS NULL ORDER BY u.id LIMIT 1;

    -- العنوان يصل العمودين معاً، والفاتورة تراه
    PERFORM public.taki_set_store_card(sid, NULL, NULL, 'الخبر — حي العليا');
    IF (SELECT address FROM public.users WHERE id=sid) <> 'الخبر — حي العليا'
       OR (SELECT address FROM public.store_profiles WHERE store_id=sid) <> 'الخبر — حي العليا' THEN
      RAISE EXCEPTION 'فشل: العنوان لم يصل العمودين';
    END IF;
    -- 🪤 `invoice_customer_details` تشترط هوية المستدعي (`auth.uid()`)، وأوّل
    --    صياغةٍ لهذا الاختبار نادتها بلا جلسة فأرجعت NULL — فبدا العيب فيها
    --    وهو في الاختبار. الهوية تُضبط صراحةً.
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', sid, 'role','authenticated')::text, true);
    r := public.invoice_customer_details(sid);
    IF coalesce(r->>'address','') <> 'الخبر — حي العليا' THEN
      RAISE EXCEPTION 'فشل: فاتورة الاشتراك لا ترى العنوان (%)', coalesce(r->>'address','∅');
    END IF;

    -- والجزئية: تعديل النبذة وحدها لا يمسّ العنوان
    PERFORM public.taki_set_store_card(sid, 'نبذة', NULL, NULL);
    IF (SELECT address FROM public.users WHERE id=sid) IS NULL THEN
      RAISE EXCEPTION 'فشل: الكتابة الجزئية محت العنوان';
    END IF;

    RAISE EXCEPTION 'ROLLBACK_TEST_OK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_TEST_OK' THEN RAISE; END IF;
  END;
END $verify$;

SELECT 'v14.73b' AS "الهجرة",
       (SELECT count(*) FROM users u JOIN store_profiles sp ON sp.store_id=u.id
         WHERE coalesce(u.address,'') IS DISTINCT FROM coalesce(sp.address,'')) AS "عناوين تفترق";
