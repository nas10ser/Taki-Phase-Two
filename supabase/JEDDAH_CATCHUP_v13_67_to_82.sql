
DO $guard$
BEGIN
    IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '') LIKE 'TAKI_LAB_TOKYO%' THEN
        RAISE EXCEPTION
            'توقّف: هذا خادم المختبر (طوكيو) — هجرات الإنتاج لا تُطبَّق عليه. افتح محرّر خادم جدة وأعد اللصق.';
    END IF;
END $guard$;

-- ╔══════════════════════════════════════════════════════════════════════
-- ║  v13.67 — مواءمة حدّ الفروع عند تغيير الباقة
-- ╚══════════════════════════════════════════════════════════════════════

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

-- ╔══════════════════════════════════════════════════════════════════════
-- ║  v13.71 — دليل المتاجر العام + تضييق صلاحيات الأدمن
-- ╚══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.sellers_public AS
SELECT
    u.id,
    u.name,
    u.shop,
    u.avatar_url,
    u.bio,
    u.contact_phone,          -- رقم التواصل المعلَن للمشترين (ليس جوال الحساب)
    u.user_type,
    u.lat,
    u.lng,
    u.google_maps_link,
    u.working_hours,
    u.preferred_lang,
    u.created_at
FROM public.users u
WHERE u.user_type <> 'buyer'  -- التجار + المتاجر المملوكة لأدمن (درس v13.21)
  AND u.deleted_at IS NULL
  AND COALESCE(u.is_suspended, false) = false;

ALTER VIEW public.sellers_public SET (security_barrier = true);
GRANT SELECT ON public.sellers_public TO anon, authenticated;

DROP POLICY IF EXISTS users_select_all ON public.users;
CREATE POLICY users_select_own_or_admin ON public.users
    FOR SELECT
    USING (
        ((SELECT auth.uid())::text = id)
        OR (SELECT public.is_admin())
    );

DROP POLICY IF EXISTS platform_settings_insert_admin ON public.platform_settings;
DROP POLICY IF EXISTS platform_settings_update_admin ON public.platform_settings;
DROP POLICY IF EXISTS platform_settings_delete_admin ON public.platform_settings;

CREATE POLICY platform_settings_write_scoped ON public.platform_settings
    FOR ALL
    USING (
        (SELECT public.is_super_admin())
        OR public.has_admin_permission('tab_tools')    -- الأدوات/المولات/الرسائل
        OR public.has_admin_permission('tab_launch')   -- الإطلاق/الضريبة/الفواتير
        OR public.has_admin_permission('tab_reports')  -- الإنذارات (moderation_settings)
    )
    WITH CHECK (
        (SELECT public.is_super_admin())
        OR public.has_admin_permission('tab_tools')
        OR public.has_admin_permission('tab_launch')
        OR public.has_admin_permission('tab_reports')
    );

DROP POLICY IF EXISTS banners_insert_admin ON public.banners;
DROP POLICY IF EXISTS banners_update_admin ON public.banners;
DROP POLICY IF EXISTS banners_delete_admin ON public.banners;
CREATE POLICY banners_write_tools ON public.banners
    FOR ALL
    USING ((SELECT public.is_super_admin()) OR public.has_admin_permission('tab_tools'))
    WITH CHECK ((SELECT public.is_super_admin()) OR public.has_admin_permission('tab_tools'));

DROP POLICY IF EXISTS promo_insert_admin ON public.promotional_campaigns;
DROP POLICY IF EXISTS promo_update_admin ON public.promotional_campaigns;
DROP POLICY IF EXISTS promo_delete_admin ON public.promotional_campaigns;
CREATE POLICY promo_write_tools ON public.promotional_campaigns
    FOR ALL
    USING ((SELECT public.is_super_admin()) OR public.has_admin_permission('tab_tools'))
    WITH CHECK ((SELECT public.is_super_admin()) OR public.has_admin_permission('tab_tools'));

DROP POLICY IF EXISTS moderation_terms_admin_all ON public.moderation_terms;
CREATE POLICY moderation_terms_write_reports ON public.moderation_terms
    FOR ALL
    USING ((SELECT public.is_super_admin()) OR public.has_admin_permission('tab_reports'))
    WITH CHECK ((SELECT public.is_super_admin()) OR public.has_admin_permission('tab_reports'));

DROP POLICY IF EXISTS exp_admin_all ON public.expense_invoices;
CREATE POLICY exp_write_launch ON public.expense_invoices
    FOR ALL
    USING ((SELECT public.is_super_admin()) OR public.has_admin_permission('tab_launch'))
    WITH CHECK ((SELECT public.is_super_admin()) OR public.has_admin_permission('tab_launch'));

-- ╔══════════════════════════════════════════════════════════════════════
-- ║  v13.75 — إغلاق كتابة الزائر على الـviews (حرجة)
-- ╚══════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE v record;
BEGIN
    FOR v IN
        SELECT c.oid::regclass AS rel
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
    LOOP
        EXECUTE format(
            'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON %s FROM PUBLIC, anon, authenticated',
            v.rel);
    END LOOP;
END $$;

REVOKE ALL PRIVILEGES ON public.sellers_public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sellers_public TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_sellers_public_readonly()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
    RAISE EXCEPTION
        'sellers_public هو دليل قراءة فقط — الكتابة تتم على جدول users عبر سياساته'
        USING ERRCODE = 'insufficient_privilege';
END;
$function$;

DROP TRIGGER IF EXISTS tr_sellers_public_readonly ON public.sellers_public;
CREATE TRIGGER tr_sellers_public_readonly
    INSTEAD OF INSERT OR UPDATE OR DELETE ON public.sellers_public
    FOR EACH ROW EXECUTE FUNCTION public.tg_sellers_public_readonly();

COMMIT;

SELECT
    CASE WHEN has_table_privilege('anon', 'public.sellers_public', 'SELECT')
         THEN '✅ نعم' ELSE '❌ لا' END      AS "١ الزائر ما زال يقرأ الدليل؟",
    CASE WHEN NOT has_table_privilege('anon', 'public.sellers_public', 'UPDATE')
          AND NOT has_table_privilege('anon', 'public.sellers_public', 'INSERT')
          AND NOT has_table_privilege('anon', 'public.sellers_public', 'DELETE')
         THEN '✅ نعم' ELSE '❌ لا' END      AS "٢ كتابة الزائر مُنعت؟",
    CASE WHEN NOT has_table_privilege('authenticated', 'public.sellers_public', 'UPDATE')
          AND NOT has_table_privilege('authenticated', 'public.sellers_public', 'INSERT')
          AND NOT has_table_privilege('authenticated', 'public.sellers_public', 'DELETE')
         THEN '✅ نعم' ELSE '❌ لا' END      AS "٣ كتابة المسجَّل مُنعت؟",
    CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                       WHERE tgrelid = 'public.sellers_public'::regclass
                         AND tgname = 'tr_sellers_public_readonly' AND NOT tgisinternal)
         THEN '✅ نعم' ELSE '❌ لا' END      AS "٤ الحاجز البنيوي مركّب؟",
    (SELECT count(*)::text FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('v','m')
        AND (has_table_privilege('anon', c.oid, 'UPDATE')
          OR has_table_privilege('anon', c.oid, 'INSERT')
          OR has_table_privilege('anon', c.oid, 'DELETE')))
                                            AS "٥ views أخرى ما زالت مكشوفة (المتوقع 0)";

-- ╔══════════════════════════════════════════════════════════════════════
-- ║  v13.76 — عرض الفروع + صلاحيات الأدمن + مزامنة الإيميل
-- ╚══════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.store_branches
    ADD COLUMN IF NOT EXISTS show_on_store_page boolean NOT NULL DEFAULT false;

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

  SELECT array_agg(DISTINCT r.required_perm) INTO v_reqs
    FROM public.admin_rpc_permissions r
   WHERE v_ctx ~ ('function ' || r.rpc_name || '\(');

  IF v_reqs IS NULL THEN
    RETURN;                       -- غير مُخرَّطة: أي أدمن — لا يُقفل أحد أبداً
  END IF;

  IF NOT (COALESCE(v_perms, '{}'::text[]) && v_reqs) THEN
    RAISE EXCEPTION 'forbidden: this account does not have any of the % permissions', v_reqs
      USING ERRCODE = '42501';
  END IF;
END;
$function$;

ALTER TABLE public.admin_rpc_permissions
    DROP CONSTRAINT IF EXISTS admin_rpc_permissions_pkey;
ALTER TABLE public.admin_rpc_permissions
    ADD CONSTRAINT admin_rpc_permissions_pkey PRIMARY KEY (rpc_name, required_perm);

INSERT INTO public.admin_rpc_permissions (rpc_name, required_perm)
VALUES ('admin_search_users', 'tab_buyers'),
       ('admin_search_users', 'tab_sellers'),
       ('admin_search_users', 'tab_admins')
ON CONFLICT (rpc_name, required_perm) DO NOTHING;

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

-- ╔══════════════════════════════════════════════════════════════════════
-- ║  v13.80 — تحصين الزائر + فهرس الإشعارات + الريل‑تايم
-- ╚══════════════════════════════════════════════════════════════════════

BEGIN;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon;

DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['postgres','supabase_admin','service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            BEGIN
                EXECUTE format(
                    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
                    'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon', r);
            EXCEPTION WHEN insufficient_privilege THEN
                RAISE NOTICE 'تخطّي الامتيازات الافتراضية للدور %', r;
            END;
        END IF;
    END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifs_user_created
    ON public.notifications (user_id, created_at DESC);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='bookings') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='booking_messages') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.booking_messages;
    END IF;
END $$;

COMMIT;

CREATE OR REPLACE FUNCTION public._taki_v1380_audit()
RETURNS TABLE (
    "١- كتابة الزائر مرفوضة"   text,
    "٢- الجداول القادمة محصّنة" text,
    "٣- فهرس الإشعارات"        text,
    "٤- الريل‑تايم للطلبات"     text,
    "٥- RLS على كل الجداول"    text,
    "٦- مسار كل دالة مثبّت"     text
)
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $fn$
DECLARE v_attack text;
BEGIN
    BEGIN
        SET LOCAL ROLE anon;
        BEGIN
            EXECUTE 'UPDATE public.deals SET item_name = item_name WHERE id = ''__taki_probe__''';
            v_attack := '❌';  -- مرّ بلا خطأ ⇒ منحة الكتابة ما زالت قائمة
        EXCEPTION
            WHEN insufficient_privilege THEN v_attack := '✅';
            WHEN OTHERS THEN v_attack := '✅';  -- أي رفض آخر = ممنوع أيضاً
        END;
        RESET ROLE;
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE;
        v_attack := '⚠️';
    END;

    RETURN QUERY SELECT
        v_attack,
        CASE WHEN NOT EXISTS (
            SELECT 1 FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace
            WHERE n.nspname='public' AND d.defaclobjtype='r'
              AND pg_get_userbyid(d.defaclrole) = 'postgres'
              AND array_to_string(d.defaclacl,',') ~ '(^|,)anon=[^/]*[awdD]'
        ) THEN '✅' ELSE '❌' END,
        CASE WHEN EXISTS (
            SELECT 1 FROM pg_indexes WHERE schemaname='public'
              AND indexname='idx_notifs_user_created'
        ) THEN '✅' ELSE '❌' END,
        CASE WHEN (SELECT count(*) FROM pg_publication_tables
                   WHERE pubname='supabase_realtime' AND schemaname='public'
                     AND tablename IN ('bookings','booking_messages')) = 2
        THEN '✅' ELSE '❌' END,
        CASE WHEN NOT EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity
        ) THEN '✅' ELSE '❌' END,
        CASE WHEN NOT EXISTS (
            SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.prosecdef
              AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}')) x
                              WHERE x LIKE 'search_path=%')
        ) THEN '✅' ELSE '❌' END;
END $fn$;

SELECT * FROM public._taki_v1380_audit();

DROP FUNCTION public._taki_v1380_audit();

-- ╔══════════════════════════════════════════════════════════════════════
-- ║  v13.81 — حجز الكمية ذرّياً
-- ╚══════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.tr_reserve_booking_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deal   deals%ROWTYPE;
  v_sel    jsonb;
  v_var    jsonb;
  v_need   int;
  v_avail  int;
  v_bname  text;
  v_capped boolean;
BEGIN
  SET LOCAL lock_timeout = '5s';

  v_need := GREATEST(COALESCE(NEW.booked_quantity, 1), 1);

  SELECT * INTO v_deal FROM deals WHERE id = NEW.deal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'العرض لم يعد موجوداً' USING ERRCODE = 'P0010';
  END IF;

  IF v_deal.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'DEAL_NOT_ACTIVE' USING ERRCODE = 'P0010';
  END IF;

  v_capped := NOT COALESCE(v_deal.is_unlimited, false)
              AND COALESCE(v_deal.initial_quantity, 0) > 0;

  IF v_capped AND COALESCE(v_deal.quantity, 0) < v_need THEN
    RAISE EXCEPTION 'نفدت الكمية — سبقك مشترون آخرون إليها (المتاح الآن: %)',
      GREATEST(COALESCE(v_deal.quantity, 0), 0) USING ERRCODE = 'P0010';
  END IF;

  IF NEW.location_id IS NOT NULL
     AND v_deal.loc_qty_mode = 'per_location'
     AND v_deal.locations IS NOT NULL AND jsonb_typeof(v_deal.locations) = 'array' THEN
    SELECT NULLIF(e->>'quantity','')::int, COALESCE(NULLIF(e->>'name',''), 'الفرع')
      INTO v_avail, v_bname
      FROM jsonb_array_elements(v_deal.locations) e
     WHERE e->>'id' = NEW.location_id
     LIMIT 1;
    IF v_avail IS NOT NULL AND v_avail < v_need THEN
      RAISE EXCEPTION 'نفدت كمية «%» — المتاح الآن بهذا الفرع: %',
        v_bname, GREATEST(v_avail, 0) USING ERRCODE = 'P0010';
    END IF;
  END IF;

  IF v_deal.variants IS NOT NULL AND jsonb_typeof(v_deal.variants) = 'array'
     AND NEW.selected_options IS NOT NULL AND jsonb_typeof(NEW.selected_options) = 'array' THEN
    FOR v_sel IN SELECT * FROM jsonb_array_elements(NEW.selected_options) LOOP
      CONTINUE WHEN v_sel->>'g' IS DISTINCT FROM '__variant__';
      SELECT e INTO v_var FROM jsonb_array_elements(v_deal.variants) e
       WHERE e->>'id' = v_sel->>'c' LIMIT 1;
      CONTINUE WHEN v_var IS NULL OR NOT (v_var ? 'qty') OR NULLIF(v_var->>'qty','') IS NULL;
      IF (v_var->>'qty')::int < GREATEST(COALESCE((v_sel->>'qty')::int, 1), 1) THEN
        RAISE EXCEPTION 'نفدت كمية «%» — المتاح الآن: %',
          COALESCE(v_var->>'label', 'هذا النوع'), GREATEST((v_var->>'qty')::int, 0)
          USING ERRCODE = 'P0010';
      END IF;
    END LOOP;
  END IF;

  IF NEW.location_id IS NOT NULL
     AND v_deal.loc_qty_mode = 'per_location'
     AND v_deal.locations IS NOT NULL AND jsonb_typeof(v_deal.locations) = 'array'
     AND NEW.selected_options IS NOT NULL AND jsonb_typeof(NEW.selected_options) = 'array' THEN
    FOR v_sel IN SELECT * FROM jsonb_array_elements(NEW.selected_options) LOOP
      CONTINUE WHEN v_sel->>'g' IS DISTINCT FROM '__variant__';
      SELECT NULLIF(e->'variantQtys'->>(v_sel->>'c'),'')::int
        INTO v_avail
        FROM jsonb_array_elements(v_deal.locations) e
       WHERE e->>'id' = NEW.location_id AND (e ? 'variantQtys')
       LIMIT 1;
      IF v_avail IS NOT NULL AND v_avail < GREATEST(COALESCE((v_sel->>'qty')::int, 1), 1) THEN
        RAISE EXCEPTION 'نفد هذا النوع في الفرع المختار — المتاح الآن: %',
          GREATEST(v_avail, 0) USING ERRCODE = 'P0010';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.adjust_deal_quantity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sel    jsonb;
  v_dir    int;
  v_need   int;
  v_rows   int;
  v_capped boolean;
BEGIN
    v_need := GREATEST(COALESCE(NEW.booked_quantity, 1), 1);

    IF TG_OP = 'INSERT' THEN
        v_dir := -1;
    ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
        v_dir := 1;
    ELSE
        RETURN NEW;
    END IF;

    SELECT NOT COALESCE(d.is_unlimited, false) AND COALESCE(d.initial_quantity, 0) > 0
      INTO v_capped FROM deals d WHERE d.id = NEW.deal_id;

    IF v_dir = -1 THEN
        IF COALESCE(v_capped, false) THEN
            UPDATE deals SET quantity = quantity - v_need
             WHERE id = NEW.deal_id AND quantity >= v_need;
            GET DIAGNOSTICS v_rows = ROW_COUNT;
            IF v_rows = 0 THEN
                RAISE EXCEPTION 'نفدت الكمية — سبقك مشترون آخرون إليها'
                    USING ERRCODE = 'P0010';
            END IF;
        ELSE
            UPDATE deals SET quantity = GREATEST(0, COALESCE(quantity, 0) - v_need)
             WHERE id = NEW.deal_id AND COALESCE(is_unlimited, false) = FALSE;
        END IF;
    ELSE
        UPDATE deals SET quantity = COALESCE(quantity, 0) + v_need
         WHERE id = NEW.deal_id AND COALESCE(is_unlimited, false) = FALSE;
    END IF;

    IF NEW.selected_options IS NOT NULL AND jsonb_typeof(NEW.selected_options) = 'array' THEN
      FOR v_sel IN SELECT * FROM jsonb_array_elements(NEW.selected_options) LOOP
        CONTINUE WHEN v_sel->>'g' IS DISTINCT FROM '__variant__';
        UPDATE deals d SET variants = (
          SELECT jsonb_agg(
            CASE WHEN e->>'id' = v_sel->>'c' AND (e ? 'qty') AND NULLIF(e->>'qty','') IS NOT NULL
                 THEN jsonb_set(e, '{qty}', to_jsonb(GREATEST(0,
                        (e->>'qty')::int + v_dir * GREATEST(COALESCE((v_sel->>'qty')::int,1),1))))
                 ELSE e END)
          FROM jsonb_array_elements(d.variants) e)
        WHERE d.id = NEW.deal_id
          AND d.variants IS NOT NULL AND jsonb_typeof(d.variants) = 'array'
          AND (v_dir = 1 OR COALESCE((
                SELECT NULLIF(e2->>'qty','')::int FROM jsonb_array_elements(d.variants) e2
                 WHERE e2->>'id' = v_sel->>'c' LIMIT 1), 2147483647)
              >= GREATEST(COALESCE((v_sel->>'qty')::int,1),1));
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_dir = -1 AND v_rows = 0
           AND EXISTS (SELECT 1 FROM deals d2
                        WHERE d2.id = NEW.deal_id
                          AND d2.variants IS NOT NULL
                          AND jsonb_typeof(d2.variants) = 'array') THEN
            RAISE EXCEPTION 'نفدت كمية النوع المختار — سبقك مشترون آخرون إليه'
                USING ERRCODE = 'P0010';
        END IF;
      END LOOP;
    END IF;

    IF NEW.location_id IS NOT NULL THEN
      UPDATE deals d SET locations = (
        SELECT jsonb_agg(
          CASE WHEN e->>'id' = NEW.location_id AND (e ? 'quantity') AND NULLIF(e->>'quantity','') IS NOT NULL
               THEN jsonb_set(e, '{quantity}', to_jsonb(GREATEST(0,
                      (e->>'quantity')::int + v_dir * v_need)))
               ELSE e END)
        FROM jsonb_array_elements(d.locations) e)
      WHERE d.id = NEW.deal_id
        AND d.loc_qty_mode = 'per_location'
        AND d.locations IS NOT NULL AND jsonb_typeof(d.locations) = 'array'
        AND (v_dir = 1 OR COALESCE((
              SELECT NULLIF(e2->>'quantity','')::int FROM jsonb_array_elements(d.locations) e2
               WHERE e2->>'id' = NEW.location_id LIMIT 1), 2147483647) >= v_need);
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_dir = -1 AND v_rows = 0
         AND EXISTS (SELECT 1 FROM deals d2
                      WHERE d2.id = NEW.deal_id AND d2.loc_qty_mode = 'per_location'
                        AND d2.locations IS NOT NULL AND jsonb_typeof(d2.locations) = 'array') THEN
          RAISE EXCEPTION 'نفدت كمية هذا الفرع — سبقك مشترون آخرون إليها'
              USING ERRCODE = 'P0010';
      END IF;
    END IF;

    IF NEW.location_id IS NOT NULL
       AND NEW.selected_options IS NOT NULL AND jsonb_typeof(NEW.selected_options) = 'array' THEN
      FOR v_sel IN SELECT * FROM jsonb_array_elements(NEW.selected_options) LOOP
        CONTINUE WHEN v_sel->>'g' IS DISTINCT FROM '__variant__';
        UPDATE deals d SET locations = (
          SELECT jsonb_agg(
            CASE WHEN e->>'id' = NEW.location_id
                  AND (e ? 'variantQtys')
                  AND ((e->'variantQtys') ? (v_sel->>'c'))
                  AND NULLIF(e->'variantQtys'->>(v_sel->>'c'),'') IS NOT NULL
                 THEN jsonb_set(e, ARRAY['variantQtys', v_sel->>'c'], to_jsonb(GREATEST(0,
                        (e->'variantQtys'->>(v_sel->>'c'))::int + v_dir * GREATEST(COALESCE((v_sel->>'qty')::int,1),1))))
                 ELSE e END)
          FROM jsonb_array_elements(d.locations) e)
        WHERE d.id = NEW.deal_id
          AND d.loc_qty_mode = 'per_location'
          AND d.locations IS NOT NULL AND jsonb_typeof(d.locations) = 'array'
          AND (v_dir = 1 OR COALESCE((
                SELECT NULLIF(e2->'variantQtys'->>(v_sel->>'c'),'')::int
                  FROM jsonb_array_elements(d.locations) e2
                 WHERE e2->>'id' = NEW.location_id AND (e2 ? 'variantQtys') LIMIT 1), 2147483647)
              >= GREATEST(COALESCE((v_sel->>'qty')::int,1),1));
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_dir = -1 AND v_rows = 0
           AND EXISTS (SELECT 1 FROM deals d2
                        WHERE d2.id = NEW.deal_id AND d2.loc_qty_mode = 'per_location'
                          AND d2.locations IS NOT NULL AND jsonb_typeof(d2.locations) = 'array') THEN
            RAISE EXCEPTION 'نفد هذا النوع في الفرع المختار — سبقك مشترون آخرون إليه'
                USING ERRCODE = 'P0010';
        END IF;
      END LOOP;
    END IF;

    RETURN NEW;
END;
$function$;

COMMIT;

-- ╔══════════════════════════════════════════════════════════════════════
-- ║  v13.82 — مستلم رسالة المحادثة
-- ╚══════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.booking_messages ADD COLUMN IF NOT EXISTS recipient_id text;

CREATE OR REPLACE FUNCTION public.tr_booking_message_recipient()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    SELECT CASE WHEN NEW.sender_role = 'buyer' THEN b.store_id ELSE b.user_id END
      INTO NEW.recipient_id
      FROM bookings b
     WHERE b.barcode = NEW.barcode;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tr_booking_message_recipient ON public.booking_messages;
CREATE TRIGGER tr_booking_message_recipient
    BEFORE INSERT ON public.booking_messages
    FOR EACH ROW EXECUTE FUNCTION public.tr_booking_message_recipient();

UPDATE public.booking_messages m
   SET recipient_id = CASE WHEN m.sender_role = 'buyer' THEN b.store_id ELSE b.user_id END
  FROM public.bookings b
 WHERE b.barcode = m.barcode AND m.recipient_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_booking_messages_recipient
    ON public.booking_messages (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_messages_sender
    ON public.booking_messages (sender_id, created_at DESC);

COMMIT;

SELECT
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema='public' AND table_name='booking_messages'
                        AND column_name='recipient_id') THEN '✅' ELSE '❌' END AS "العمود",
    CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                      WHERE tgname='tr_booking_message_recipient' AND NOT tgisinternal) THEN '✅' ELSE '❌' END AS "المشغّل",
    (SELECT count(*) FROM public.booking_messages WHERE recipient_id IS NULL) AS "رسائل بلا مستلم";

SELECT * FROM (
    SELECT 0 AS ord, 'الخادم' AS "البند",
           CASE WHEN COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') LIKE 'TAKI_LAB_TOKYO%'
                THEN '❌ المختبر' ELSE '✅ جدة (الإنتاج)' END AS "الحالة"
    UNION ALL SELECT 1, '٦٧ مواءمة الباقة',
        CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname='tr_branch_cap_on_package_change') THEN '✅' ELSE '❌' END
    UNION ALL SELECT 2, '٧١ دليل المتاجر العام',
        CASE WHEN EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='sellers_public') THEN '✅' ELSE '❌' END
    UNION ALL SELECT 3, '٧٥ الـviews للقراءة فقط',
        CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname='tr_sellers_public_readonly')
              AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                               WHERE n.nspname='public' AND c.relkind IN ('v','m')
                                 AND (has_table_privilege('anon', c.oid, 'UPDATE')
                                   OR has_table_privilege('anon', c.oid, 'INSERT')
                                   OR has_table_privilege('anon', c.oid, 'DELETE')))
             THEN '✅' ELSE '❌' END
    UNION ALL SELECT 4, '٧٦ عمود عرض الفروع',
        CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='store_branches' AND column_name='show_on_store_page') THEN '✅' ELSE '❌' END
    UNION ALL SELECT 5, '٧٦ خريطة صلاحيات البحث',
        CASE WHEN (SELECT count(*) FROM public.admin_rpc_permissions WHERE rpc_name='admin_search_users') = 3 THEN '✅' ELSE '❌' END
    UNION ALL SELECT 6, '٧٦ مزامنة الإيميل المؤكَّد',
        CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname='on_auth_user_updated') THEN '✅' ELSE '❌' END
    UNION ALL SELECT 7, '٨٠ لا كتابة للزائر',
        CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
                               WHERE grantee='anon' AND table_schema='public'
                                 AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')) THEN '✅' ELSE '❌' END
    UNION ALL SELECT 8, '٨٠ فهرس الإشعارات',
        CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_notifs_user_created') THEN '✅' ELSE '❌' END
    UNION ALL SELECT 9, '٨٠ ريل‑تايم الطلبات والمحادثة',
        CASE WHEN (SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime'
                    AND schemaname='public' AND tablename IN ('bookings','booking_messages')) = 2 THEN '✅' ELSE '❌' END
    UNION ALL SELECT 10, '٨١ الخصم الذرّي',
        CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                           WHERE n.nspname='public' AND p.proname='adjust_deal_quantity'
                             AND pg_get_functiondef(p.oid) LIKE '%quantity >= v_need%') THEN '✅' ELSE '❌' END
    UNION ALL SELECT 11, '٨١ بوّاب بلا قفل',
        CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                           WHERE n.nspname='public' AND p.proname='tr_reserve_booking_stock'
                             AND pg_get_functiondef(p.oid) LIKE '%SET LOCAL lock_timeout%'
                             AND NOT EXISTS (SELECT 1 FROM regexp_split_to_table(pg_get_functiondef(p.oid), E'\n') AS ln
                                              WHERE ln !~ '^\s*--' AND ln ILIKE '%FOR UPDATE%')) THEN '✅' ELSE '❌' END
    UNION ALL SELECT 12, '٨٢ مستلم الرسالة',
        CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='booking_messages' AND column_name='recipient_id')
              AND EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname='tr_booking_message_recipient') THEN '✅' ELSE '❌' END
    UNION ALL SELECT 13, '٨٢ رسائل بلا مستلم (المتوقع ٠)',
        (SELECT count(*)::text FROM public.booking_messages WHERE recipient_id IS NULL)
    UNION ALL SELECT 14, 'RLS على كل الجداول',
        CASE WHEN NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                               WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity) THEN '✅' ELSE '❌' END
    UNION ALL SELECT 15, 'مسار كل دالة مثبّت',
        CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                               WHERE n.nspname='public' AND p.prosecdef
                                 AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}')) x WHERE x LIKE 'search_path=%')) THEN '✅' ELSE '❌' END
) t ORDER BY ord;
