-- ════════════════════════════════════════════════════════════════════════════
-- v14.72b — حارس رابط الشعار يضيق إلى نطاقاتنا نحن
-- ════════════════════════════════════════════════════════════════════════════
-- حارس v14.71 كان يقبل `*.supabase.co` كاملاً — أي **أي مشروع Supabase في
-- العالم**. سطحٌ ضيّق (صورة لا سكربت) لكنه حقيقيّ: رابطٌ على مشروع غريب يعني
-- أن خادماً ليس لنا يرى عنوان كل من يفتح صفحة ذلك المتجر.
--
-- 🪤 ولا يُحذف `supabase.co` كلّه: **بيئة المعاينة** تبني روابطها من مشروع
--    طوكيو، فحذفُه يكسر رفع الشعار في المعاينة بخطأٍ مُبهم. يُضيَّق إلى مشروع
--    المعاينة بعينه.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'رُفض: هذا خادم المختبر (طوكيو) — هجرات الإنتاج تُطبَّق على جدة';
  END IF;
END $guard$;

BEGIN;

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
  -- 🪤 حدّ المضيف يُثبَّت بالنقطة لا بـ`[^/]*`: النمط المتساهل يقبل
  --    `https://evil-takisa.net/` — نفس فخّ `evil-google.com` في فحص SSRF.
  -- 🪤 و`supabase.co` مقصورٌ على مشروع المعاينة وحده لا على كل المشاريع.
  IF p_avatar_url IS NOT NULL AND btrim(p_avatar_url) <> ''
     AND p_avatar_url !~ '^https?://([A-Za-z0-9-]+\.)*(takisa\.net|sslip\.io|kbmqzxcjdankdgiovctm\.supabase\.co)(:[0-9]+)?/' THEN
    RAISE EXCEPTION 'BAD_AVATAR_HOST';
  END IF;
  RETURN public.taki_set_store_card(v_uid, p_bio, p_avatar_url);
END $function$;

COMMIT;

-- ── تحقّقٌ يرفع استثناءً ─────────────────────────────────────────────────────
DO $verify$
DECLARE u text; sid text; ok boolean;
BEGIN
  SELECT id INTO sid FROM public.users
   WHERE user_type IN ('seller','admin') AND deleted_at IS NULL ORDER BY id LIMIT 1;
  IF sid IS NULL THEN RAISE EXCEPTION 'فشل: لا تاجر للاختبار'; END IF;

  -- مرفوضة
  FOREACH u IN ARRAY ARRAY[
      'https://other-project.supabase.co/storage/v1/object/public/x.jpg',
      'https://evil-takisa.net/x.jpg',
      'https://takisa.net.evil.com/x.jpg',
      'data:image/jpeg;base64,/9j/4AAQ'] LOOP
    BEGIN
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', sid, 'role','authenticated')::text, true);
      PERFORM public.merchant_set_store_card(NULL, u);
      RAISE EXCEPTION 'فشل: قُبل مضيفٌ غريب (%)', left(u, 45);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'فشل:%' THEN RAISE; END IF;
      IF SQLERRM <> 'BAD_AVATAR_HOST' THEN
        RAISE EXCEPTION 'فشل: رُفض بسببٍ غير الحارس (% ⇐ %)', left(u,30), SQLERRM;
      END IF;
    END;
  END LOOP;

  -- ومقبولة (داخل كتلةٍ تُلغى)
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', sid, 'role','authenticated')::text, true);
    FOREACH u IN ARRAY ARRAY[
        'https://api.takisa.net/storage/v1/object/public/deals/a/b.jpg',
        'https://141-147-142-147.sslip.io/storage/v1/object/public/deals/a/b.jpg',
        'https://kbmqzxcjdankdgiovctm.supabase.co/storage/v1/object/public/deals/a/b.jpg'] LOOP
      PERFORM public.merchant_set_store_card(NULL, u);
    END LOOP;
    RAISE EXCEPTION 'ROLLBACK_TEST_OK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_TEST_OK' THEN
      RAISE EXCEPTION 'فشل: رُفض رابطٌ مشروع (%)', SQLERRM;
    END IF;
  END;
END $verify$;

SELECT 'v14.72b' AS "الهجرة", 'حارس المضيف ضُيِّق وجُرِّب على ٧ روابط' AS "النتيجة";
