-- ════════════════════════════════════════════════════════════════════════════
-- v14.71 — بطاقة المتجر: نسخةٌ واحدة، وخطوةٌ سادسة في مسار الإعداد
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 عيبٌ قِيس على الإنتاج اليوم (٢٠ سبتمبر ٢٠٢٦)، **وكنتُ أنا قد قلتُ خطأً
--    إن محرّر الشعار والنبذة غير موجود أصلاً** — وهو موجودٌ في صفحة «صفحتي».
--    العيب الحقيقي أدقّ وأسوأ: **نسختان من نفس البيانات**.
--      • الموقع يكتب `users.bio` و`users.avatar_url` وحدهما
--        (`userRepository.saveProfile` ← جدول `users`).
--      • والبوتان يقرآن `store_profiles.bio`، ويفضّلان `store_profiles.avatar_url`.
--    فالنبذة التي يكتبها التاجر على الموقع **لا يراها أحدٌ في البوت إطلاقاً**.
--
--    القياس (داخل كتلةٍ أُلغيت على جدة): كُتبت نبذةٌ في `users` كما يكتبها
--    الموقع حرفياً، ثم سُئل `bot_get_store` فأرجع **∅ لا شيء**.
--
--    وهي نفس عائلة العيب الذي كلّفنا `deals.shop_name`: نسخةٌ ثانية لا يكتبها
--    إلا نصفُ المسارات.
--
-- الحلّ: **كاتبٌ واحد** يكتب العمودين معاً، تناديه ثلاثةُ أبواب:
--    الموقع (`merchant_set_store_card`) · البوتان (`bot_update_store_bio`).
-- فلا يبقى في النظام مسارٌ يكتب نصف البطاقة.
--
-- 🪤 التعديل جزئيّ: `NULL` = لا تغيّر، ونصٌّ فارغ `''` = محوٌ صريح. (نفس
--    اصطلاح `bot_set_delivery` في v14.70 — لا اصطلاح ثانٍ في نفس المشروع.)
-- 🪤 وقراءة البوت تُقلب إلى `users` أولاً: هو العمود الذي لا يكون أبداً أقدم
--    من الآخر (البوت كان يكتب الاثنين، والموقع يكتب `users` وحده).
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'رُفض: هذا خادم المختبر (طوكيو) — هجرات الإنتاج تُطبَّق على جدة';
  END IF;
END $guard$;

BEGIN;

-- ١) الكاتب الوحيد ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.taki_set_store_card(
  p_uid        text,
  p_bio        text DEFAULT NULL,   -- NULL = لا تغيّر · '' = امحُ
  p_avatar_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bio    text;
  v_avatar text;
BEGIN
  IF p_uid IS NULL THEN RETURN NULL; END IF;

  v_bio    := CASE WHEN p_bio        IS NULL THEN NULL
                   ELSE nullif(left(btrim(p_bio), 500), '') END;
  v_avatar := CASE WHEN p_avatar_url IS NULL THEN NULL
                   ELSE nullif(btrim(p_avatar_url), '') END;

  -- 🪤 صفّ `store_profiles` قد لا يوجد أصلاً (تاجرٌ لم يشترك بعد) — فالإدراج
  --    لازم، وإلا ضاع نصف الكتابة بصمت كما كان يحدث.
  INSERT INTO public.store_profiles (store_id, bio, avatar_url, updated_at)
  VALUES (p_uid,
          CASE WHEN p_bio        IS NULL THEN NULL ELSE v_bio    END,
          CASE WHEN p_avatar_url IS NULL THEN NULL ELSE v_avatar END,
          now())
  ON CONFLICT (store_id) DO UPDATE SET
    bio        = CASE WHEN p_bio        IS NULL THEN public.store_profiles.bio
                      ELSE v_bio END,
    avatar_url = CASE WHEN p_avatar_url IS NULL THEN public.store_profiles.avatar_url
                      ELSE v_avatar END,
    updated_at = now();

  UPDATE public.users SET
    bio        = CASE WHEN p_bio        IS NULL THEN bio        ELSE v_bio    END,
    avatar_url = CASE WHEN p_avatar_url IS NULL THEN avatar_url ELSE v_avatar END,
    updated_at = now()
  WHERE id = p_uid;

  RETURN (SELECT jsonb_build_object('bio', u.bio, 'avatar_url', u.avatar_url)
            FROM public.users u WHERE u.id = p_uid);
END $function$;

-- لا يناديها مستخدمٌ مباشرةً: الأبواب الثلاثة وحدها (وكلٌّ منها يحرس هويّته).
REVOKE ALL ON FUNCTION public.taki_set_store_card(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_set_store_card(text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.taki_set_store_card(text, text, text) FROM authenticated;

-- ٢) باب الموقع ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.merchant_set_store_card(
  p_bio        text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL
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
  -- 🪤 الرابط يجب أن يكون رابط تخزيننا نحن: حقلٌ حرّ يسمح بحقن رابطٍ خارجي
  --    يتعقّب كل مَن يفتح صفحة المتجر (أو يُستبدل لاحقاً بصورةٍ أخرى).
  -- 🪤 حدّ المضيف يُثبَّت بالنقطة لا بـ`[^/]*`: النمط المتساهل يقبل
  --    `https://evil-takisa.net/` — وهو نفس فخّ `evil-google.com` الذي رصده
  --    فحص SSRF في هذا المشروع. كل مقطعٍ هنا لا بدّ أن ينتهي بنقطة قبل النطاق.
  IF p_avatar_url IS NOT NULL AND btrim(p_avatar_url) <> ''
     AND p_avatar_url !~ '^https?://([A-Za-z0-9-]+\.)*(takisa\.net|sslip\.io|supabase\.co)(:[0-9]+)?/' THEN
    RAISE EXCEPTION 'BAD_AVATAR_HOST';
  END IF;
  RETURN public.taki_set_store_card(v_uid, p_bio, p_avatar_url);
END $function$;

REVOKE ALL ON FUNCTION public.merchant_set_store_card(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_set_store_card(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_set_store_card(text, text) TO authenticated;

-- ٣) باب البوتين: نفس الكاتب، فلا تبقى خوارزميةُ كتابةٍ ثانية ────────────────
CREATE OR REPLACE FUNCTION public.bot_update_store_bio(
  p_telegram_id bigint,
  p_bio text,
  p_whatsapp_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_sid text; v_res jsonb;
BEGIN
  SELECT id INTO v_sid FROM public.users
   WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id)
     AND user_type IN ('seller','admin') AND deleted_at IS NULL LIMIT 1;
  IF v_sid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_seller'); END IF;
  -- نصٌّ فارغ = محوٌ صريح (نفس ما كانت تفعله النسخة السابقة عبر NULLIF).
  v_res := public.taki_set_store_card(v_sid, coalesce(p_bio, ''), NULL);
  RETURN jsonb_build_object('success', true, 'bio', v_res->>'bio');
END $function$;

-- ٤) القراءة: `users` أولاً — العمود الذي لا يكون أقدم من الآخر أبداً ────────
CREATE OR REPLACE FUNCTION public.taki_store_card(p_store_id text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'bio',    coalesce(nullif(btrim(coalesce(u.bio, '')), ''),        sp.bio),
    'avatar', coalesce(nullif(btrim(coalesce(u.avatar_url, '')), ''), sp.avatar_url))
  FROM public.users u
  LEFT JOIN public.store_profiles sp ON sp.store_id = u.id
  WHERE u.id = p_store_id;
$function$;
REVOKE ALL ON FUNCTION public.taki_store_card(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_store_card(text) FROM anon;

-- ٥) مصالحةٌ لمرّة واحدة: ما كتبه الموقع يُنسخ إلى الصفّ الآخر ───────────────
-- (قِيس قبلها: صفرُ صفوفٍ تفترق اليوم — فهذه شبكة أمانٍ لا إصلاح، وتبقى
--  آمنة للتكرار.)
UPDATE public.store_profiles sp
   SET bio        = coalesce(nullif(btrim(coalesce(u.bio,'')),''),        sp.bio),
       avatar_url = coalesce(nullif(btrim(coalesce(u.avatar_url,'')),''), sp.avatar_url),
       updated_at = now()
  FROM public.users u
 WHERE u.id = sp.store_id
   AND ( coalesce(nullif(btrim(coalesce(u.bio,'')),''),        sp.bio) IS DISTINCT FROM sp.bio
      OR coalesce(nullif(btrim(coalesce(u.avatar_url,'')),''), sp.avatar_url) IS DISTINCT FROM sp.avatar_url );

-- ٦) الخطوة السادسة في مسار الإعداد ─────────────────────────────────────────
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
                                       WHERE d.store_id = u.id AND d.status = 'active')),
    -- ── v14.71 — بطاقة المتجر: شعارٌ ونبذة. يُقرآن من `users` (المصدر الذي
    --    يكتبه الموقع) مع ارتدادٍ إلى `store_profiles` للصفوف القديمة.
    'profile_set',           (NULLIF(btrim(COALESCE(u.bio, sp.bio, '')), '') IS NOT NULL
                          AND NULLIF(btrim(COALESCE(u.avatar_url, sp.avatar_url, '')), '') IS NOT NULL)
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
  sid text;
  g   jsonb;
  v   jsonb;
  b   jsonb;
BEGIN
  FOREACH sid IN ARRAY ARRAY['taki_set_store_card','merchant_set_store_card',
                             'bot_update_store_bio','taki_store_card','merchant_setup_gaps'] LOOP
    SELECT count(*) INTO n FROM pg_proc
     WHERE proname = sid AND pronamespace='public'::regnamespace;
    IF n <> 1 THEN RAISE EXCEPTION 'فشل: نسخ % = % (نسختان ⇒ نداءٌ ملتبس)', sid, n; END IF;
  END LOOP;

  -- الكاتب الداخلي مقفلٌ على المستخدمين
  IF has_function_privilege('anon','public.taki_set_store_card(text, text, text)','EXECUTE')
     OR has_function_privilege('authenticated','public.taki_set_store_card(text, text, text)','EXECUTE') THEN
    RAISE EXCEPTION 'فشل: الكاتب الداخلي مكشوف لمستخدم';
  END IF;
  IF NOT has_function_privilege('authenticated','public.merchant_set_store_card(text, text)','EXECUTE') THEN
    RAISE EXCEPTION 'فشل: باب الموقع غير ممنوح للموثَّقين';
  END IF;

  SELECT u.id INTO sid FROM public.users u
   WHERE (u.user_type IN ('seller','admin') OR nullif(btrim(coalesce(u.shop,'')),'') IS NOT NULL)
     AND u.deleted_at IS NULL ORDER BY u.id LIMIT 1;
  IF sid IS NULL THEN RAISE EXCEPTION 'فشل: لا تاجر للاختبار'; END IF;

  g := public.merchant_setup_gaps(sid);
  IF NOT (g ? 'profile_set') THEN RAISE EXCEPTION 'فشل: مفتاح profile_set غائب'; END IF;
  IF jsonb_typeof(g->'profile_set') <> 'boolean' THEN RAISE EXCEPTION 'فشل: profile_set ليس منطقياً'; END IF;
  -- المفاتيح الخمسة السابقة باقية (وإلا انكسر مسار v14.69 في كل متصفّح)
  FOREACH sid IN ARRAY ARRAY['pay_declared','hours_set','refund_set','vat_answered','has_live_deal'] LOOP
    IF NOT (g ? sid) THEN RAISE EXCEPTION 'فشل: المفتاح % سقط', sid; END IF;
  END LOOP;
  IF jsonb_typeof(g->'refund_policy_missing') <> 'boolean'
     OR jsonb_typeof(g->'payment_undeclared') <> 'boolean' THEN
    RAISE EXCEPTION 'فشل: أحد مفتاحَي التذكير الأسبوعي تغيّر';
  END IF;

  -- ── الاختبار الحقيقي داخل كتلةٍ تُلغى ─────────────────────────────────
  BEGIN
    SELECT u.id INTO sid FROM public.users u
     WHERE (u.user_type IN ('seller','admin') OR nullif(btrim(coalesce(u.shop,'')),'') IS NOT NULL)
       AND u.deleted_at IS NULL ORDER BY u.id LIMIT 1;

    -- كتابةٌ واحدة ⇒ العمودان معاً
    PERFORM public.taki_set_store_card(sid, 'نبذةُ اختبار', 'https://api.takisa.net/storage/v1/object/public/deals/x/y.jpg');
    IF (SELECT bio FROM public.users WHERE id=sid) <> 'نبذةُ اختبار'
       OR (SELECT bio FROM public.store_profiles WHERE store_id=sid) <> 'نبذةُ اختبار' THEN
      RAISE EXCEPTION 'فشل: النبذة لم تصل العمودين معاً';
    END IF;

    -- والبوت صار يراها (هذا هو العيب الذي قِيس)
    b := public.bot_get_store(NULL::bigint, sid, NULL::text);
    IF coalesce(b->>'bio','') <> 'نبذةُ اختبار' THEN
      RAISE EXCEPTION 'فشل: البوت ما زال لا يرى نبذة الموقع (%)', coalesce(b->>'bio','∅');
    END IF;

    -- الجزئية: تعديل النبذة وحدها لا يمسّ الشعار
    PERFORM public.taki_set_store_card(sid, 'نبذةٌ ثانية', NULL);
    IF (SELECT avatar_url FROM public.users WHERE id=sid) IS NULL THEN
      RAISE EXCEPTION 'فشل: الكتابة الجزئية محت الشعار';
    END IF;

    -- والمحو الصريح بنصٍّ فارغ
    PERFORM public.taki_set_store_card(sid, '', NULL);
    IF (SELECT bio FROM public.users WHERE id=sid) IS NOT NULL
       OR (SELECT bio FROM public.store_profiles WHERE store_id=sid) IS NOT NULL THEN
      RAISE EXCEPTION 'فشل: النصّ الفارغ لم يمحُ النبذة من العمودين';
    END IF;

    -- الخطوة السادسة تتبع البيانات فعلاً
    PERFORM public.taki_set_store_card(sid, 'نبذة', 'https://api.takisa.net/storage/v1/object/public/deals/x/y.jpg');
    IF NOT (public.merchant_setup_gaps(sid)->>'profile_set')::boolean THEN
      RAISE EXCEPTION 'فشل: profile_set لم تصر true رغم اكتمال البطاقة';
    END IF;
    PERFORM public.taki_set_store_card(sid, NULL, '');
    IF (public.merchant_setup_gaps(sid)->>'profile_set')::boolean THEN
      RAISE EXCEPTION 'فشل: profile_set بقيت true بلا شعار';
    END IF;

    RAISE EXCEPTION 'ROLLBACK_TEST_OK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_TEST_OK' THEN RAISE; END IF;
  END;

  -- ── الحارس يُجرَّب سالباً: مضيفٌ متنكّر، وصورةٌ مضمّنة base64 ──────────
  -- (حارسٌ لا يُختبر رفضُه ليس حارساً — ونمط `[^/]*` المتساهل كان يقبل الأول.)
  FOREACH sid IN ARRAY ARRAY[
      'https://evil-takisa.net/x.jpg',
      'https://takisa.net.evil.com/x.jpg',
      'http://attacker.tld/pixel.gif',
      'data:image/jpeg;base64,/9j/4AAQSkZJRg'] LOOP
    BEGIN
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', (SELECT id FROM public.users
                                   WHERE user_type IN ('seller','admin') ORDER BY id LIMIT 1),
                          'role','authenticated')::text, true);
      PERFORM public.merchant_set_store_card(NULL, sid);
      RAISE EXCEPTION 'فشل: قُبل رابط شعارٍ خارجي (%)', left(sid, 40);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'فشل:%' THEN RAISE; END IF;
      IF SQLERRM <> 'BAD_AVATAR_HOST' THEN
        RAISE EXCEPTION 'فشل: رُفض الرابط بسببٍ غير الحارس (% ⇐ %)', left(sid,30), SQLERRM;
      END IF;
    END;
  END LOOP;
END $verify$;

SELECT 'v14.71' AS "الهجرة",
       (SELECT count(*) FROM users u JOIN store_profiles sp ON sp.store_id=u.id
         WHERE coalesce(u.bio,'') IS DISTINCT FROM coalesce(sp.bio,'')) AS "نُبذٌ تفترق",
       (SELECT count(*) FROM users u JOIN store_profiles sp ON sp.store_id=u.id
         WHERE coalesce(u.avatar_url,'') IS DISTINCT FROM coalesce(sp.avatar_url,'')) AS "شعاراتٌ تفترق";
