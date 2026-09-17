-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.57 — رفع الصور: مجلّدُ صاحبه، وسقفُ عددٍ وحجم (طلب ناصر ٣)
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 المقيس على الإنتاج قبل هذه الهجرة — سياسة الكتابة على مستودع `deals`:
--     ((bucket_id = 'deals') AND (lower(name) LIKE '%.jpg' OR … '%.gif'))
-- لا فحصَ مالك، ولا فحصَ مسار، ولا سقفَ عدد. أي أن **أي مستخدم موثَّق** — ولو
-- مشترياً بلا متجر — يستطيع:
--   • الرفع بأي اسم وفي أي مسار، بما فيه مسارٌ يبدو مجلّد تاجرٍ آخر.
--   • الرفع بلا عدد: عشرة آلاف ملفٍ بحجم ١٠ ميجابايت = تخزينٌ مجاني على حسابنا.
-- وحدُّ الحجم الوحيد القائم هو `file_size_limit` على المستودع (١٠ ميجابايت).
--
-- الحاصل فعلياً اليوم: ٩١ ملفاً · ٣٦ ميجابايت. فالحدود أدناه سخيّةٌ جداً على
-- استعمالٍ حقيقي وضيّقةٌ على إساءة.
--
-- 🪤 وما لا يُلمس: مستودع `chat` سياستُه سليمة أصلاً
--   (`taki_chat_member(name) AND owner = uid()`) وعضويّتُه **مشتقّة من المسار**
--   — فأي تغيير في شكل المسار هناك يكسر المحادثات. لا يُقترب منه.
-- 🪤 ومسار البوت `deals/bot/…` يرفع بمفتاح الخدمة فيتجاوز RLS — غير متأثّر،
--   وملفاته `owner IS NULL` (قِيس: ٢٢ ملفاً).
-- 🪤 والصور القائمة (٩١) تبقى في مكانها وتُقرأ كما هي: المستودع **عام** فالقراءة
--   لا تمرّ بسياسة أصلاً، وعناوينها محفوظة في `deals.images`.
--
-- الخادم المستهدف: **جدة (الإنتاج)**. يرفض التنفيذ على مختبر طوكيو.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'TOKYO_LAB_REFUSED: هذه هجرة إنتاج. نفّذها على جدة.';
  END IF;
END
$guard$;

-- ── ١) الرفع في مجلّد صاحبه وحده ────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users upload deal images" ON storage.objects;
CREATE POLICY "Authenticated users upload deal images" ON storage.objects
  FOR INSERT TO public
  WITH CHECK (
    bucket_id = 'deals'
    AND owner = auth.uid()
    -- المجلّد الأوّل **هو** معرّف الرافع. لا تكفي `LIKE uid || '/%'` وحدها:
    -- اسمٌ مثل `<uid>/../ghayri/x.jpg` يطابقها، فنشترط ألّا يحوي الباقي شرطة
    -- مائلة ولا نقطتين متتاليتين.
    AND split_part(name, '/', 1) = auth.uid()::text
    AND name !~ '\.\.'
    AND array_length(string_to_array(name, '/'), 1) = 2
    AND (lower(name) LIKE '%.jpg' OR lower(name) LIKE '%.jpeg'
         OR lower(name) LIKE '%.png' OR lower(name) LIKE '%.webp')
  );

-- ── ٢) سقف عددٍ لكل مستخدم — مشغّل لأن السياسة لا تستطيع العدّ بأمان ───────
CREATE OR REPLACE FUNCTION storage.taki_deals_quota()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = storage, public, pg_temp
AS $function$
DECLARE
  v_max   int := 600;    -- ٣٠٠ صورة + مصغّراتها. الحاصل اليوم ٩١ لكل المتاجر.
  v_count int;
BEGIN
  IF NEW.bucket_id <> 'deals' OR NEW.owner IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_count FROM storage.objects
   WHERE bucket_id = 'deals' AND owner = NEW.owner;
  IF v_count >= v_max THEN
    RAISE EXCEPTION 'STORAGE_QUOTA_EXCEEDED: بلغتَ سقف % ملفاً. احذف صوراً قديمة أو راسل الإدارة.', v_max
      USING ERRCODE = 'P0012';
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS tr_taki_deals_quota ON storage.objects;
CREATE TRIGGER tr_taki_deals_quota
  BEFORE INSERT ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION storage.taki_deals_quota();

-- ── ٣) سقف الحجم يُشدَّد: ١٠ ميجابايت سخيّ لصورة عرض ──────────────────────
-- أكبر صورة قائمة اليوم أقلّ من ٢٥٠ كيلوبايت بعد الضغط في المتصفّح، والضغط
-- ليس ضماناً (يُتجاوَز بنداء المستودع مباشرة) — فالسقف الخادمي هو الضمان.
UPDATE storage.buckets SET file_size_limit = 4194304 WHERE id = 'deals';

DO $verify$
DECLARE v_chk text; v_max bigint;
BEGIN
  SELECT pg_get_expr(polwithcheck, polrelid) INTO v_chk FROM pg_policy
   WHERE polrelid='storage.objects'::regclass AND polname='Authenticated users upload deal images';
  IF v_chk IS NULL THEN RAISE EXCEPTION 'VERIFY: سياسة الرفع مفقودة'; END IF;
  IF v_chk NOT LIKE '%split_part%' THEN RAISE EXCEPTION 'VERIFY: السياسة لا تفرض المجلّد'; END IF;
  IF v_chk NOT LIKE '%owner%' THEN RAISE EXCEPTION 'VERIFY: السياسة لا تفحص المالك'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='tr_taki_deals_quota' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'VERIFY: مشغّل السقف مفقود'; END IF;
  SELECT file_size_limit INTO v_max FROM storage.buckets WHERE id='deals';
  IF v_max <> 4194304 THEN RAISE EXCEPTION 'VERIFY: سقف الحجم % لا ٤ ميجابايت', v_max; END IF;
  -- ومستودع المحادثات لم يُمَسّ.
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='storage.objects'::regclass
                   AND polname='chat_write_members') THEN
    RAISE EXCEPTION 'VERIFY: سياسة المحادثات ضاعت'; END IF;
  RAISE NOTICE 'التحقّق مرّ: المجلّد والمالك مفروضان · السقف ٦٠٠ ملفاً · الحجم ٤ ميجابايت · المحادثات سليمة';
END
$verify$;
DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'TOKYO_LAB_REFUSED'; END IF;
END
$guard$;

-- v14.57ب — ورفعُ صور العروض للتجّار والإدارة وحدهم.
-- قِيس: كل مناديات `storageService.uploadImage` أربعة، وكلها أسطح تاجر أو أدمن
-- (لوحة التاجر · صفحة المتجر · أدوات الإدارة · المسابقات). لا مشترٍ يرفع هنا
-- إطلاقاً — ومرفقات المحادثة مستودعٌ آخر بسياسته الخاصة.
-- وفائدتُه الأمنية: فحصُ المحتوى (NSFW) يعمل في **المتصفّح**، ويُتجاوَز بنداء
-- المستودع مباشرة. فقصرُ الرفع على حساباتٍ معروفةٍ ومحاسَبة يُضيّق السطح كثيراً
-- إلى أن يُنقل الفحص إلى الخادم.
CREATE OR REPLACE FUNCTION public.taki_can_upload_deal_image()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = (SELECT auth.uid())::text
      AND u.deleted_at IS NULL
      AND COALESCE(u.is_suspended, false) = false
      AND (u.user_type IN ('seller','admin') OR NULLIF(btrim(COALESCE(u.shop,'')), '') IS NOT NULL)
  );
$$;
REVOKE ALL ON FUNCTION public.taki_can_upload_deal_image() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_can_upload_deal_image() FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_can_upload_deal_image() TO authenticated;

DROP POLICY IF EXISTS "Authenticated users upload deal images" ON storage.objects;
CREATE POLICY "Authenticated users upload deal images" ON storage.objects
  FOR INSERT TO public
  WITH CHECK (
    bucket_id = 'deals'
    AND owner = auth.uid()
    AND split_part(name, '/', 1) = auth.uid()::text
    AND name !~ '\.\.'
    AND array_length(string_to_array(name, '/'), 1) = 2
    AND (lower(name) LIKE '%.jpg' OR lower(name) LIKE '%.jpeg'
         OR lower(name) LIKE '%.png' OR lower(name) LIKE '%.webp')
    AND public.taki_can_upload_deal_image()
  );

DO $verify$
DECLARE v text;
BEGIN
  SELECT pg_get_expr(polwithcheck, polrelid) INTO v FROM pg_policy
   WHERE polrelid='storage.objects'::regclass AND polname='Authenticated users upload deal images';
  IF v NOT LIKE '%taki_can_upload_deal_image%' THEN RAISE EXCEPTION 'VERIFY: قصرُ التجار غير مفروض'; END IF;
  IF v NOT LIKE '%split_part%' OR v NOT LIKE '%owner%' THEN RAISE EXCEPTION 'VERIFY: ضاع شرطٌ من السياسة'; END IF;
  IF has_function_privilege('anon','public.taki_can_upload_deal_image()','EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY: الزائر ينادي دالة الصلاحية'; END IF;
  RAISE NOTICE 'التحقّق مرّ: التجّار وحدهم · المجلّد والمالك مفروضان';
END
$verify$;
