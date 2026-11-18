-- ═══════════════════════════════════════════════════════════════════════════
-- v16.39 — الجنس والفئة العمرية عند التسجيل
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 طلبُ ناصر (١٧–١٨ نوفمبر ٢٠٢٦): «عند التسجيل أظهر سؤالين: ذكر أو أنثى،
--    والعمر … وسجّلهم في الداتا بيس إذا كان مسموحاً حسب القانون السعودي»،
--    ثمّ: «اجعلها فئة عمرية كل خمس سنوات أو حسب ما تراه في المواقع العالمية».
--
-- 🔴 **ولماذا فئاتٌ عالميّة لا كلّ خمس سنوات** (القرارُ مشروحٌ لأنه مخالفٌ
--    لحرف الطلب وموافقٌ لمقصده): النطاقاتُ الستّة
--        18-24 · 25-34 · 35-44 · 45-54 · 55-64 · 65+
--    هي ما تستعمله Google Analytics وMeta، وثلاثةُ أسبابٍ تُرجّحها:
--      ① **تقليلُ البيانات** — وهو مبدأٌ صريحٌ في نظام حماية البيانات
--         الشخصية السعودي: لا يُجمع إلّا ما يلزم للغرض. والغرضُ هنا تحليلُ
--         سلوكٍ، ويتحقّق بستّ فئاتٍ كما يتحقّق بإحدى عشرة.
--      ② **خطرُ التعرّف** — بقاعدةٍ فيها ستّةُ حسابات، «٣٥-٣٩ + أنثى + مدينة»
--         قد تدلّ على شخصٍ بعينه. والفئاتُ الأوسع تُبقي التحليلَ ممكناً
--         والتعرّفَ صعباً.
--      ③ **المقارنة** — أرقامُنا تصير مقارنةً بأرقام السوق بلا إعادة تجميع.
--    والحدُّ الأدنى ١٨ لأن المنصّة تشترطه أصلاً (`consent_min_age`).
--
-- 🔴 **والقانون**: الجمعُ مسموحٌ بشرط الإفصاح والموافقة — ولذلك تُشحن هذه
--    الهجرةُ **مع** تحديث سياسة الخصوصية ورفع `LEGAL_VERSION`. ولا تُجمع
--    البياناتُ قبل أن يُعلَن جمعُها.
--
-- 🪤 والحقلان **اختياريّان في القاعدة** (`NULL` مسموح): حساباتُ اليوم الستّة
--    لا تحملهما، وأيُّ `NOT NULL` كان سيرفض كلَّ تحديثٍ لصفوفٍ قائمة. والواجهةُ
--    هي التي تسأل، والقاعدةُ تقبل الصمت.
-- 🪤 والقيمُ **مقفلةٌ بقيد CHECK**: بلا ذلك يكتب أيُّ مسارٍ نصّاً حرّاً فتصير
--    الفلترةُ مستحيلةً بعد شهر. (وهو نفسُ درس `notifications_type_check` الذي
--    انحرف عن الكود فسكتت ثلاثةُ مسارات.)
-- 🪤 و`handle_new_user` تقرؤهما بقائمةِ سماحٍ مثل `user_type` تماماً: بياناتُ
--    التسجيل يكتبها المتصفّح، فلا يُثق بها — تُطابَق أو تُهمَل.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
    IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
       LIKE '%TAKI_LAB_TOKYO_MARKER%' THEN
        RAISE EXCEPTION 'هذه هجرةُ إنتاج — ورُفض تنفيذُها على المختبر (طوكيو).';
    END IF;
END $guard$;

-- ── ① العمودان ────────────────────────────────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS gender    text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS age_band  text;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_gender_check;
ALTER TABLE public.users ADD  CONSTRAINT users_gender_check
    CHECK (gender IS NULL OR gender IN ('male', 'female'));

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_age_band_check;
ALTER TABLE public.users ADD  CONSTRAINT users_age_band_check
    CHECK (age_band IS NULL OR age_band IN ('18-24','25-34','35-44','45-54','55-64','65+'));

COMMENT ON COLUMN public.users.gender   IS 'v16.39 — يُسأل عنه عند التسجيل. اختياريّ. male|female.';
COMMENT ON COLUMN public.users.age_band IS 'v16.39 — فئةٌ عمريّة لا تاريخُ ميلاد (تقليلُ البيانات). ستّ فئاتٍ عالميّة من ١٨.';

-- ── ② قراءتُهما من بيانات التسجيل، بقائمة سماح ────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_src text;
  v_detail text;
  v_code text;
  v_ref_store text;
  v_requested text;
  v_type text;
  v_lang text;
  v_gender text;
  v_age text;
BEGIN
  v_src    := NULLIF(btrim(coalesce(new.raw_user_meta_data->>'referral_source', '')), '');
  v_detail := NULLIF(btrim(coalesce(new.raw_user_meta_data->>'referral_source_detail', '')), '');
  v_code   := NULLIF(btrim(coalesce(new.raw_user_meta_data->>'referred_by_code', '')), '');
  IF v_code IS NOT NULL THEN
    SELECT u.id INTO v_ref_store FROM public.users u
     WHERE u.referral_code IS NOT NULL AND upper(u.referral_code) = upper(v_code)
     LIMIT 1;
    IF v_ref_store IS NOT NULL THEN v_src := 'store'; END IF;
  END IF;

  -- v13.42: whitelist. Never let signup metadata name a privileged role.
  v_requested := lower(btrim(coalesce(new.raw_user_meta_data->>'user_type', '')));
  v_type := CASE WHEN v_requested IN ('buyer', 'seller') THEN v_requested ELSE 'buyer' END;

  -- v13.92: لغة الواجهة وقت التسجيل. أي قيمة غير 'en' تُعامَل عربية.
  v_lang := CASE WHEN lower(btrim(coalesce(new.raw_user_meta_data->>'lang', ''))) = 'en'
                 THEN 'en' ELSE 'ar' END;

  -- v16.39 — الجنسُ والفئةُ العمرية: قائمةُ سماحٍ كما لـ`user_type`؛ وأيُّ
  -- قيمةٍ خارجها تصير NULL ولا تُفشل التسجيل (حسابٌ لا يُمنع بسبب حقلٍ اختياريّ).
  v_gender := lower(btrim(coalesce(new.raw_user_meta_data->>'gender', '')));
  v_gender := CASE WHEN v_gender IN ('male', 'female') THEN v_gender ELSE NULL END;

  v_age := btrim(coalesce(new.raw_user_meta_data->>'age_band', ''));
  v_age := CASE WHEN v_age IN ('18-24','25-34','35-44','45-54','55-64','65+') THEN v_age ELSE NULL END;

  INSERT INTO public.users (id, email, phone, name, user_type, shop,
                            referral_source, referral_source_detail, referred_by_store,
                            preferred_lang, gender, age_band)
  VALUES (
    new.id::text,
    new.email,
    new.raw_user_meta_data->>'phone',
    COALESCE(new.raw_user_meta_data->>'name', 'مستخدم'),
    v_type,
    new.raw_user_meta_data->>'shop',
    v_src, v_detail, v_ref_store,
    v_lang,
    v_gender, v_age
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$function$;

-- ── ③ التجهيلُ يشملهما — في نفس الهجرة لا في «هجرةٍ تالية» ────────────────
-- 🪤 قاعدةٌ مسجَّلة منذ v14.77: «أيّ جدولٍ يحمل بياناتٍ شخصيّة يُضاف إلى
--    `purge_expired_accounts` صراحةً — لا يعرفه أحدٌ تلقائياً». وقد غابت
--    `contest_entries` عنها شهوراً بهذا السبب بالضبط.
-- 🔴 ولا يُفصل عن جمعِ البيانات: عمودُ بياناتٍ شخصيّةٍ يُولد اليوم ويُمسح
--    «لاحقاً» يبقى بلا مسار محوٍ إلى أن يُنسى. فالجمعُ والمحوُ يُشحنان معاً.
-- 🪤 ويُعدَّل النصُّ الحيُّ لا نسخةٌ مكتوبةٌ هنا: إعادةُ كتابة الدالّة كاملةً
--    من ذاكرتي تُسقط ما لا أعلمه فيها (درسُ إعادة بناء السياسات من نصّها الحيّ).
DO $purge$
DECLARE
    v_src text;
    v_new text;
BEGIN
    SELECT pg_get_functiondef(p.oid) INTO v_src
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'purge_expired_accounts' AND p.prokind = 'f';
    IF v_src IS NULL THEN
        RAISE EXCEPTION 'purge_expired_accounts غير موجودة — لا يجوز جمعُ بياناتٍ شخصيّةٍ بلا مسار تجهيل';
    END IF;

    IF position('age_band = NULL' in v_src) = 0 THEN
        -- يُحقن العمودان في نفس جملة التجهيل، بعد `consent_ip` تماماً.
        v_new := replace(
            v_src,
            'consent_ip = NULL, consent_user_agent = NULL,',
            'consent_ip = NULL, consent_user_agent = NULL,' || chr(10) ||
            '           gender = NULL, age_band = NULL,'
        );
        IF v_new = v_src THEN
            RAISE EXCEPTION 'تعذّر حقنُ gender/age_band في purge_expired_accounts — تغيّرت المرساة، يُراجَع يدوياً';
        END IF;
        EXECUTE v_new;
    END IF;
END $purge$;

-- ── تحقّقٌ يرفع استثناءً ───────────────────────────────────────────────────
DO $verify$
DECLARE
    v_src  text;
    v_cols int;
BEGIN
    SELECT count(*) INTO v_cols FROM information_schema.columns
     WHERE table_schema='public' AND table_name='users' AND column_name IN ('gender','age_band');
    IF v_cols <> 2 THEN
        RAISE EXCEPTION 'المتوقَّع عمودان (gender · age_band)، والموجود %', v_cols;
    END IF;

    -- القيدان يرفضان ما ليس من القائمة
    BEGIN
        INSERT INTO public.users (id, name, user_type, gender)
        VALUES ('__probe_v1639__', 'probe', 'buyer', 'غير ذلك');
        RAISE EXCEPTION 'قيدُ gender لا يمنع قيمةً خارج القائمة';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO public.users (id, name, user_type, age_band)
        VALUES ('__probe_v1639__', 'probe', 'buyer', '30-35');
        RAISE EXCEPTION 'قيدُ age_band لا يمنع فئةً خارج القائمة';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    DELETE FROM public.users WHERE id = '__probe_v1639__';

    SELECT pg_get_functiondef(p.oid) INTO v_src
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='handle_new_user' AND p.prokind='f';
    -- 🪤 يُجرَّد التعليقُ قبل الفحص: الحارسُ قد يمسك تعليقَه هو (فخٌّ مسجَّل).
    IF position('age_band' in regexp_replace(v_src, '--[^\n]*', '', 'g')) = 0 THEN
        RAISE EXCEPTION 'handle_new_user لا تقرأ age_band';
    END IF;
    IF position('''female''' in v_src) = 0 THEN
        RAISE EXCEPTION 'handle_new_user بلا قائمة سماحٍ للجنس';
    END IF;

    -- ④ والمحوُ دخل فعلاً — وإلّا فنحن نجمع بياناتٍ لا تُمحى.
    SELECT pg_get_functiondef(p.oid) INTO v_src
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='purge_expired_accounts' AND p.prokind='f';
    IF position('age_band = NULL' in v_src) = 0 THEN
        RAISE EXCEPTION 'purge_expired_accounts لا تمسح age_band — مُنع جمعُ بياناتٍ بلا مسار محو';
    END IF;
    IF position('gender = NULL' in v_src) = 0 THEN
        RAISE EXCEPTION 'purge_expired_accounts لا تمسح gender — مُنع جمعُ بياناتٍ بلا مسار محو';
    END IF;

    RAISE NOTICE '✅ gender + age_band: عمودان · قيدان يرفضان الخارج · handle_new_user تقرؤهما بقائمة سماح · والتجهيل يمسحهما';
END $verify$;
