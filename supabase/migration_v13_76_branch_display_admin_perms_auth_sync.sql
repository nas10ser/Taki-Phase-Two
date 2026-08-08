-- ═══════════════════════════════════════════════════════════════════════════
-- v13.76 — أربعة بنود في ملف واحد (كلها آمنة للتشغيل المتكرّر)
--
--   ١) عرض المواقع على صفحة المتجر (v13.61) — **لم يكن له ملف هجرة إطلاقاً**.
--      طُبِّق على جدة يدوياً فحسب، فلو أُعيد بناء القاعدة من الصفر ضاع. هذا
--      الملف يوثّقه أخيراً، و**لا يمسّ ما هو قائم**: يُنشئ الناقص فقط.
--   ٢) مواءمة المواقع مع الباقة (v13.67) — البند ⚠️ الوحيد في فحص جدة.
--   ٣) صلاحيات الأدمن التفصيلية: سدّ آخر دالة غير مُخرَّطة + إصلاح هشاشة في
--      الحارس المركزي نفسه.
--   ٤) مزامنة الإيميل/الجوال من `auth.users` بعد **تأكيدهما** — المشغّل مفقود،
--      وغيابه هو سبب ثغرة «الإيميل غير المؤكَّد يُكتب في الجدول» (v13.77).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) v13.61 — عمود «معروض على صفحة المتجر» + حارسا سقف الباقة
--    (يُنشأ الناقص فقط — ما هو قائم على جدة يبقى كما هو بلا مساس)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.store_branches
    ADD COLUMN IF NOT EXISTS show_on_store_page boolean NOT NULL DEFAULT false;

-- دالة المواءمة: تُبقي المعروض ضمن حدّ الباقة — الفرع الرئيسي أولاً ثم الأقدم.
-- هذا الترتيب هو نفسه الذي يقرأ به `branchRepository.listDisplayed` فلا تختلف
-- القائمة العامة عن حالة القاعدة أبداً.
CREATE OR REPLACE FUNCTION public.taki_reconcile_branch_display(p_store_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_cap integer;
BEGIN
    SELECT max_branches INTO v_cap FROM public.store_profiles WHERE store_id = p_store_id;
    IF v_cap IS NULL OR v_cap <= 0 THEN RETURN; END IF;

    UPDATE public.store_branches b
       SET show_on_store_page = false, updated_at = NOW()
     WHERE b.merchant_id = p_store_id
       AND b.show_on_store_page
       AND b.id NOT IN (
            SELECT x.id FROM public.store_branches x
             WHERE x.merchant_id = p_store_id
               AND x.show_on_store_page
               AND COALESCE(x.is_active, true)
             ORDER BY x.is_primary DESC NULLS LAST, x.created_at ASC
             LIMIT v_cap);
END;
$function$;

-- حارس (أ): منع تجاوز الحدّ لحظة إظهار فرع.
CREATE OR REPLACE FUNCTION public.tg_enforce_branch_display_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_cap integer; v_shown integer;
BEGIN
    IF NOT NEW.show_on_store_page THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND OLD.show_on_store_page THEN RETURN NEW; END IF;

    SELECT max_branches INTO v_cap FROM public.store_profiles WHERE store_id = NEW.merchant_id;
    IF v_cap IS NULL OR v_cap <= 0 THEN RETURN NEW; END IF;

    SELECT count(*) INTO v_shown FROM public.store_branches
     WHERE merchant_id = NEW.merchant_id AND show_on_store_page
       AND COALESCE(is_active, true) AND id <> NEW.id;

    IF v_shown >= v_cap THEN
        RAISE EXCEPTION 'BRANCH_DISPLAY_CAP:%', v_cap USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$function$;

-- حارس (ب): إعادة المواءمة عند تغيّر حدّ الباقة نفسه.
CREATE OR REPLACE FUNCTION public.tg_branch_display_on_plan_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    PERFORM public.taki_reconcile_branch_display(NEW.store_id);
    RETURN NEW;
END;
$function$;

-- تُركَّب فقط إن كانت غائبة — نسخة جدة العاملة لا تُمسّ.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE NOT tgisinternal AND tgname = 'tr_enforce_branch_display_cap') THEN
        CREATE TRIGGER tr_enforce_branch_display_cap
            BEFORE INSERT OR UPDATE OF show_on_store_page ON public.store_branches
            FOR EACH ROW EXECUTE FUNCTION public.tg_enforce_branch_display_cap();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE NOT tgisinternal AND tgname = 'tr_branch_display_on_plan_change') THEN
        CREATE TRIGGER tr_branch_display_on_plan_change
            AFTER UPDATE OF max_branches ON public.store_profiles
            FOR EACH ROW
            WHEN (NEW.max_branches IS DISTINCT FROM OLD.max_branches)
            EXECUTE FUNCTION public.tg_branch_display_on_plan_change();
    END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) v13.67 — الحدّ يتبع الباقة حتى حين تُغيَّر الباقة وحدها
--
-- الثغرة: `tr_branch_display_on_plan_change` معرّف `AFTER UPDATE OF max_branches`
-- فلا يعمل إلا إذا ذُكر ذلك العمود صراحةً؛ وتنزيل/ترقية الباقة يجري بتغيير
-- `subscription_package_id` (ودوال مثل grant_subscription_bulk تغيّر الخطة بلا
-- لمس الحدّ) — فيبقى الحدّ القديم ويُعرض ٢٠ موقعاً على باقةٍ تسمح بواحد.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.tg_branch_cap_on_package_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_pkg_max integer;
BEGIN
  IF NEW.subscription_package_id IS NULL THEN RETURN NEW; END IF;

  SELECT GREATEST(1, (e->>'max')::int) INTO v_pkg_max
    FROM jsonb_array_elements(
           (SELECT value FROM platform_settings WHERE key = 'location_packages')) e
   WHERE NULLIF(e->>'id','') IS NOT NULL
     AND (e->>'id')::int = NEW.subscription_package_id
   LIMIT 1;

  IF v_pkg_max IS NULL THEN RETURN NEW; END IF;

  IF NEW.max_branches IS DISTINCT FROM v_pkg_max THEN
    -- تُطلق `tr_branch_display_on_plan_change` فتُخفي حتى الحدّ الجديد.
    UPDATE public.store_profiles
       SET max_branches = v_pkg_max, updated_at = NOW()
     WHERE store_id = NEW.store_id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tr_branch_cap_on_package_change ON public.store_profiles;
CREATE TRIGGER tr_branch_cap_on_package_change
AFTER UPDATE OF subscription_package_id ON public.store_profiles
FOR EACH ROW
WHEN (NEW.subscription_package_id IS DISTINCT FROM OLD.subscription_package_id)
EXECUTE FUNCTION public.tg_branch_cap_on_package_change();

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) صلاحيات الأدمن التفصيلية — سدّ آخر فجوة + تقوية الحارس نفسه
--
-- الوضع قبل: الحارس `_admin_require_ctx()` يقرأ اسم الدالة من مكدّس النداء
-- ويبحث عن صلاحيتها في `admin_rpc_permissions`، **وإن لم يجد صفّاً يسمح لأي
-- أدمن**. جرد اليوم: ٨٢ دالة مُخرَّطة و**واحدة غير مُخرَّطة — `admin_search_users`**
-- (تقرأ أسماء المستخدمين وجوالاتهم وبُرُدهم)، فكان أي أدمن فرعي يقرؤها مهما
-- ضاقت صلاحياته.
--
-- ولماذا لم تُخرَّط؟ لأنها تُستدعى من تبويبين (المشترون والتجار)، والحارس كان
-- يقبل **صلاحية واحدة** لكل دالة (`LIMIT 1`) — فأي خيار يقفل أحد التبويبين.
-- وهذا `LIMIT 1` كان هشّاً أصلاً: لو حملت الخريطة صفَّين لدالة واحدة لاختار
-- الحارس أحدهما **عشوائياً**.
--
-- الإصلاح: الحارس يقبل الآن **أيّ صلاحية** من صلاحيات الدالة (تقاطع مصفوفتين)،
-- فصار بالإمكان تخريط `admin_search_users` لثلاث صلاحيات معاً: من يملك أياً
-- منها يبحث، ومن لا يملك أياً منها يُمنع. لا قفل على أحد، ولا ثغرة.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._admin_require_ctx()
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   text;
  v_ctx   text;
  v_reqs  text[];
  v_admin boolean;
  v_super boolean;
  v_perms text[];
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;

  SELECT (u.user_type = 'admin'), u.is_super_admin, u.admin_permissions
    INTO v_admin, v_super, v_perms
    FROM public.users u WHERE u.id = v_uid;

  IF NOT COALESCE(v_admin, false) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_super, false) THEN
    RETURN;                       -- المدير الأعلى: بلا قيود، كما كان دائماً
  END IF;

  GET DIAGNOSTICS v_ctx = PG_CONTEXT;

  -- كل الصلاحيات المقبولة لأي دالة على مكدّس النداء (بدل واحدة عشوائية).
  SELECT array_agg(DISTINCT r.required_perm) INTO v_reqs
    FROM public.admin_rpc_permissions r
   WHERE v_ctx ~ ('function ' || r.rpc_name || '\(');

  IF v_reqs IS NULL THEN
    RETURN;                       -- غير مُخرَّطة: أي أدمن — لا يُقفل أحد أبداً
  END IF;

  -- يكفي أن يملك **واحدة** منها.
  IF NOT (COALESCE(v_perms, '{}'::text[]) && v_reqs) THEN
    RAISE EXCEPTION 'forbidden: this account does not have any of the % permissions', v_reqs
      USING ERRCODE = '42501';
  END IF;
END;
$function$;

-- المفتاح الأساسي كان `rpc_name` وحده، أي **صلاحية واحدة لكل دالة قسراً** —
-- وهو ما جعل `admin_search_users` بلا تخريط أصلاً. صار مركّباً حتى تُقبل عدة
-- صلاحيات لدالة واحدة. (اكتُشف بالفحص: بلا هذا التغيير كان الإدراج التالي
-- يُدرج صفاً واحداً بصمت ويقفل تبويب التجار — فشل صامت آخر.)
ALTER TABLE public.admin_rpc_permissions
    DROP CONSTRAINT IF EXISTS admin_rpc_permissions_pkey;
ALTER TABLE public.admin_rpc_permissions
    ADD CONSTRAINT admin_rpc_permissions_pkey PRIMARY KEY (rpc_name, required_perm);

-- البحث في المستخدمين: يخدم تبويبي «المشترون» و«التجار» وإدارة المدراء.
INSERT INTO public.admin_rpc_permissions (rpc_name, required_perm)
VALUES ('admin_search_users', 'tab_buyers'),
       ('admin_search_users', 'tab_sellers'),
       ('admin_search_users', 'tab_admins')
ON CONFLICT (rpc_name, required_perm) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) مزامنة الإيميل/الجوال بعد **تأكيدهما** فعلاً
--
-- الثغرة التي يسدّها: لا مشغّل على `auth.users` للتحديث — فتغيير الإيميل من
-- «الإعدادات» لم يكن يصل جدول `users` أبداً. عالجته الواجهة بأن تكتب الإيميل
-- الجديد **قبل تأكيده**، وهذا خطأ مزدوج: (أ) من لم يضغط رابط التأكيد يصير
-- جدولنا يقول إيميلاً وGoTrue يقول آخر فينكسر الدخول بالإيميل، و(ب) من سرق
-- جلسةً مفتوحة يكتب بريده هو في ملف الضحية بلا أي تأكيد.
--
-- الآن المصدر الوحيد للحقيقة هو `auth.users` **بعد التأكيد**: لا يُكتب شيء
-- إلا حين يتغيّر البريد المؤكَّد فعلاً (`email_confirmed_at IS NOT NULL`).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_auth_user_updated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    IF NEW.email IS DISTINCT FROM OLD.email
       AND NEW.email IS NOT NULL
       AND NEW.email_confirmed_at IS NOT NULL THEN
        UPDATE public.users SET email = NEW.email WHERE id = NEW.id::text;
    END IF;

    IF NEW.phone IS DISTINCT FROM OLD.phone
       AND NEW.phone IS NOT NULL
       AND NEW.phone_confirmed_at IS NOT NULL THEN
        -- `users.phone` فريد؛ تعارضٌ هنا يعني رقماً مملوكاً لحساب آخر —
        -- نتجاهله بصمت بدل إسقاط عملية المصادقة كلها في GoTrue.
        BEGIN
            UPDATE public.users SET phone = NEW.phone WHERE id = NEW.id::text;
        EXCEPTION WHEN unique_violation THEN NULL;
        END;
    END IF;

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
    AFTER UPDATE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_updated();

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- التحقّق — المتوقع ✅ في الخمسة
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema='public' AND table_name='store_branches'
                         AND column_name='show_on_store_page')
         THEN '✅ نعم' ELSE '❌ لا' END                       AS "١ عمود عرض الفروع؟",
    CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
                       AND tgname='tr_enforce_branch_display_cap')
          AND EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
                       AND tgname='tr_branch_display_on_plan_change')
         THEN '✅ نعم' ELSE '❌ لا' END                       AS "٢ حارسا سقف العرض؟",
    CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
                       AND tgname='tr_branch_cap_on_package_change')
         THEN '✅ نعم' ELSE '❌ لا' END                       AS "٣ مواءمة الباقة v13.67؟",
    CASE WHEN (SELECT count(*) FROM public.admin_rpc_permissions
                WHERE rpc_name='admin_search_users') = 3
         THEN '✅ نعم' ELSE '❌ لا' END                       AS "٤ البحث في المستخدمين مُخرَّط؟",
    CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
                       AND tgname='on_auth_user_updated')
         THEN '✅ نعم' ELSE '❌ لا' END                       AS "٥ مزامنة الإيميل المؤكَّد؟";
