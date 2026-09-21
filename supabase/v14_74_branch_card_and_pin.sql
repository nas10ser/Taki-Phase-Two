-- ════════════════════════════════════════════════════════════════════════════
-- v14.74 — بطاقة الموقع: عنوانٌ لكل فرع · حارسٌ للتكرار · ونقطةٌ لا تكذب
-- ════════════════════════════════════════════════════════════════════════════
-- طلب ناصر (٢١ سبتمبر ٢٠٢٦): «ضيف حقل العنوان للمواقع وصحّح التكرار وحدّث
-- متجر تاكي: ٥ مواقع نشطة وسقف باقتك ٣ ولا موقع رئيسي».
--
-- **القياس الذي بُني عليه كل سطرٍ هنا** (جدة، قراءة فقط):
--   • صفرٌ من عشرة فروع يحمل عنواناً نصّياً — العمود موجود وصفحة المتجر تعرضه
--     منذ زمن، ولم يكن في النظام **حقل إدخالٍ واحد** له. (الحقل يُضاف في
--     الواجهة في نفس الإصدار.)
--   • تاكي `2c0b4cde`: سقف ٣ · **٥ فروع نشطة** · **صفر رئيسي** ·
--     `users.lat/lng` = 26.338729/50.143177 **لا تطابق أيّ فرع** (أقربها على
--     بُعد ~٥ كم). وهذه النقطة تُنشر لجوجل في JSON-LD لصفحة المتجر.
--   • N15 `ced5ba57`: فرعان نشطان اسمهما «الدمام» على بُعد ~٤ كم، **وكلاهما
--     صفر عروض وصفر حجوزات وصفر نطاقات**.
--
-- 🪤 **ولا يُجعل سقف تاكي `NULL`** رغم أن حارس المواقع يُعفي الأدمن عند
--    `max_branches IS NULL`: حارسَ **العرض** يقرأ `coalesce(max_branches, 1)`
--    — فالـ`NULL` تعني «واحد» هناك، أي أن صفحته كانت ستعرض موقعاً واحداً.
--    حارسان يقرآن نفس العمود بمعنيين متضادّين للـNULL. الرقم الصريح وحده آمن.
-- 🪤 ورفع السقف لا يُظهر شيئاً بنفسه: `taki_reconcile_branch_display` **تُخفي
--    الزائد فقط ولا تُظهر** — فالثلاثة الظاهرة تبقى، والاثنان المخفيّان ينتظران
--    ضغطة ناصر. وهذا مقصود: الاختيار له.
-- 🪤 و`freeze_deals_on_downgrade` تعود فوراً عند `NEW >= OLD` فالرفع لا يُجمّد عرضاً.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'رُفض: هذا خادم المختبر (طوكيو) — هجرات الإنتاج تُطبَّق على جدة';
  END IF;
END $guard$;

BEGIN;

-- ── ١) حارسٌ يمنع تكرار الاسم بين المواقع النشطة لنفس التاجر ────────────────
-- لماذا حارسٌ لا تنظيفٌ لمرّة واحدة: التكرار يتولّد من المصدر — اسم الفرع
-- يُشتقّ من اسم المدينة/المول عند حفظ الموقع، فكل موقعين في «الدمام» يخرجان
-- باسمٍ واحد بلا أن يملك التاجر تغييره. الحقل الجديد يُعطيه التغيير، والحارس
-- يمنع تكراراً جديداً قبل أن يقع.
-- 🪤 التطبيع بـ`taki_norm` (نفس قاعدة البحث العربي): «الدمام» و«دمام» و
--    «الـدمام» اسمٌ واحد للعين، فمقارنةٌ حرفية لا تحرس شيئاً.
CREATE OR REPLACE FUNCTION public.taki_guard_branch_name_dup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n text;
BEGIN
  IF NEW.is_active IS DISTINCT FROM true THEN RETURN NEW; END IF;
  v_n := public.taki_norm(COALESCE(NEW.name_ar, ''));
  IF v_n IS NULL OR btrim(v_n) = '' THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM public.store_branches b
     WHERE b.merchant_id = NEW.merchant_id
       AND b.id <> NEW.id
       AND COALESCE(b.is_active, true)
       AND public.taki_norm(COALESCE(b.name_ar, '')) = v_n
  ) THEN
    RAISE EXCEPTION 'BRANCH_NAME_DUP:%', NEW.name_ar
      USING hint = 'لديك موقعٌ نشطٌ بهذا الاسم. سمِّ الموقعين باسمين مختلفين (واكتب عنوان كلٍّ منهما) ليفرّق المشتري بينهما.';
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS tr_guard_branch_name_dup ON public.store_branches;
CREATE TRIGGER tr_guard_branch_name_dup
  BEFORE INSERT OR UPDATE OF name_ar, is_active ON public.store_branches
  FOR EACH ROW EXECUTE FUNCTION public.taki_guard_branch_name_dup();

COMMIT;

-- ── ٢) تصحيح البيانات القائمة (كلٌّ منها مقيسٌ قبله ومُثبتٌ بعده) ───────────
BEGIN;

-- (أ) التكرار في N15: الفرعان صفرُ مراجع. **لا يُحذف ولا يُعطَّل** — يُعاد تسمية
--     الأقدم باسمٍ صريحٍ أنه مؤقّت، فيراه ناصر ويصحّحه بضغطة من المحرّر الجديد.
--     الحذف كان سيُتلف موقعاً قد يكون حقيقياً، والتعطيل كان سيُخفيه عن الواجهة
--     بلا زرّ إعادة تفعيل — فكلاهما أسوأ من اسمٍ مؤقّت ظاهر.
UPDATE public.store_branches
   SET name_ar = 'الدمام (٢) — سمِّ هذا الموقع', updated_at = now()
 WHERE id = 'br_1778962066.882678221f8f'
   AND merchant_id = 'ced5ba57-e5da-4b69-9f33-25165696e7f8'
   AND name_ar = 'الدمام';

-- (ب) متجر تاكي: موقعٌ رئيسيّ — الأكثر استعمالاً بالقياس (١٠ حجوزات · عرض ·
--     نطاق توصيل)، لا الأقدم ولا الأوّل أبجدياً.
UPDATE public.store_branches SET is_primary = false, updated_at = now()
 WHERE merchant_id = '2c0b4cde-79c3-4290-abaa-812a895b1bcb' AND COALESCE(is_primary,false);
UPDATE public.store_branches SET is_primary = true, updated_at = now()
 WHERE id = 'br_1784885628.329092242d95'
   AND merchant_id = '2c0b4cde-79c3-4290-abaa-812a895b1bcb';

-- (ج) السقف يطابق الواقع: ٥ مواقع نشطة فعلاً. رقمٌ صريح لا NULL (انظر الفخّ أعلاه).
UPDATE public.store_profiles SET max_branches = 5, updated_at = now()
 WHERE store_id = '2c0b4cde-79c3-4290-abaa-812a895b1bcb' AND max_branches < 5;

-- (د) النقطة المنشورة تصير نقطة الموقع الرئيسي — فما يُنشر لجوجل يمثّل مكاناً
--     حقيقياً بدل نقطةٍ لا فرع لها.
UPDATE public.users u
   SET lat = b.map_lat, lng = b.map_lng, updated_at = now()
  FROM public.store_branches b
 WHERE u.id = '2c0b4cde-79c3-4290-abaa-812a895b1bcb'
   AND b.id = 'br_1784885628.329092242d95'
   AND b.map_lat IS NOT NULL AND b.map_lng IS NOT NULL;

COMMIT;

-- ── تحقّقٌ يرفع استثناءً ─────────────────────────────────────────────────────
DO $verify$
DECLARE
  n       int;
  v_lat   numeric;
  v_blat  numeric;
  v_mid   text := '2c0b4cde-79c3-4290-abaa-812a895b1bcb';
  v_n15   text := 'ced5ba57-e5da-4b69-9f33-25165696e7f8';
BEGIN
  -- المشغّل موجود ونسخةٌ واحدة من دالّته
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid='public.store_branches'::regclass AND tgname='tr_guard_branch_name_dup';
  IF n <> 1 THEN RAISE EXCEPTION 'فشل: حارس تكرار الاسم غير مركّب (%)', n; END IF;

  -- تاكي: رئيسيٌّ واحد بالضبط
  SELECT count(*) INTO n FROM public.store_branches
   WHERE merchant_id = v_mid AND COALESCE(is_primary,false) AND COALESCE(is_active,true);
  IF n <> 1 THEN RAISE EXCEPTION 'فشل: عدد المواقع الرئيسية لتاكي = % (المتوقَّع ١)', n; END IF;

  -- والسقف يسع النشطة كلها
  SELECT max_branches INTO n FROM public.store_profiles WHERE store_id = v_mid;
  IF n < (SELECT count(*) FROM public.store_branches WHERE merchant_id=v_mid AND is_active) THEN
    RAISE EXCEPTION 'فشل: السقف % أقلّ من عدد المواقع النشطة', n;
  END IF;

  -- والنقطة المنشورة تطابق الموقع الرئيسي
  SELECT u.lat, b.map_lat INTO v_lat, v_blat
    FROM public.users u
    JOIN public.store_branches b ON b.merchant_id = u.id AND COALESCE(b.is_primary,false)
   WHERE u.id = v_mid;
  IF v_lat IS NULL OR v_blat IS NULL OR round(v_lat,5) <> round(v_blat,5) THEN
    RAISE EXCEPTION 'فشل: نقطة المتجر (%) لا تطابق الموقع الرئيسي (%)', v_lat, v_blat;
  END IF;

  -- N15: لا اسمين متطابقين بين النشطة
  SELECT count(*) INTO n FROM (
    SELECT public.taki_norm(name_ar) k FROM public.store_branches
     WHERE merchant_id = v_n15 AND COALESCE(is_active,true)
     GROUP BY 1 HAVING count(*) > 1) t;
  IF n <> 0 THEN RAISE EXCEPTION 'فشل: ما زال في N15 % اسماً مكرّراً', n; END IF;

  -- ولا في المنصّة كلها
  SELECT count(*) INTO n FROM (
    SELECT merchant_id, public.taki_norm(name_ar) k FROM public.store_branches
     WHERE COALESCE(is_active,true)
     GROUP BY 1,2 HAVING count(*) > 1) t;
  IF n <> 0 THEN RAISE EXCEPTION 'فشل: % تكراراً باقياً في المنصّة', n; END IF;

  -- ── الحارس يُجرَّب سالباً: بلا ذلك ليس حارساً ────────────────────────
  BEGIN
    BEGIN
      UPDATE public.store_branches SET name_ar = 'الخبر'
       WHERE id = 'br_1784885628.329092242d95';   -- تاكي: «الخبر» موجود نشطاً
      RAISE EXCEPTION 'فشل: قُبل اسمٌ مكرّر بين موقعين نشطين';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'فشل:%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE 'BRANCH_NAME_DUP%' THEN
        RAISE EXCEPTION 'فشل: رُفض الاسم بسببٍ غير الحارس (%)', SQLERRM;
      END IF;
    END;
    -- واسمٌ مختلف يمرّ (حارسٌ يرفض كل شيء ليس حارساً)
    UPDATE public.store_branches SET name_ar = 'الدمام — فرع الاختبار'
     WHERE id = 'br_1784885628.329092242d95';
    RAISE EXCEPTION 'ROLLBACK_TEST_OK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_TEST_OK' THEN RAISE; END IF;
  END;
END $verify$;

SELECT 'v14.74' AS "الهجرة",
       (SELECT max_branches FROM store_profiles WHERE store_id='2c0b4cde-79c3-4290-abaa-812a895b1bcb') AS "سقف تاكي",
       (SELECT count(*) FROM store_branches WHERE merchant_id='2c0b4cde-79c3-4290-abaa-812a895b1bcb' AND is_active) AS "نشطة",
       (SELECT coalesce(name_ar,'∅') FROM store_branches WHERE merchant_id='2c0b4cde-79c3-4290-abaa-812a895b1bcb' AND is_primary) AS "الرئيسي",
       (SELECT count(*) FROM (SELECT merchant_id, taki_norm(name_ar) k FROM store_branches WHERE coalesce(is_active,true) GROUP BY 1,2 HAVING count(*)>1) t) AS "تكرار باقٍ";
