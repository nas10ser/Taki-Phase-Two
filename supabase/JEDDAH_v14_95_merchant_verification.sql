-- ═══════════════════════════════════════════════════════════════════════════
-- v14.94 — توثيق التجّار قبل النشر · وإتمامُ رفع قيد الرسائل (جدّة)
-- ═══════════════════════════════════════════════════════════════════════════
-- طلبُ ناصر: «أي شخصٍ يصير متجراً حيّاً في دقيقتين» — يتوقّف.
--
-- 🔴 ما لا تفعله هذه الهجرة عمداً، وهو أهمّ ما فيها:
--    **لا تلمس `store_can_sell`.** قِيس أنها ليست دالّة نشر بل دالّة **بيع**:
--    تُنادى من `tr_guard_booking_delivery` (JEDDAH_v14_11:289، ترفع P0013 على
--    جدول الحجوزات)، ومن `bot_create_booking` (JEDDAH_v14_08:655)، ومن
--    `src/pages/DealDetails.tsx:1368` في نافذة الحجز. فإضافةُ سبب «غير موثّق»
--    فيها كانت ستجعل الأحد عشر عرضاً الحيّة **غير قابلة للحجز** لحظة التفعيل،
--    والمشتري يرى «هذا المتجر لم يحدّد طريقة الحساب» — كذبةً لا يفسّرها شيء.
--    الحارسُ هنا مشغّلٌ على `public.deals` وحده.
--
-- 🔴 ورموزُ الخطأ قِيست: P0001‑P0021 كلها مستعملة (P0021 لحارس التوصيل في
--    JEDDAH_v14_39:69). الجديد: P0022 ليس تاجراً · P0023 كتابةُ السجل ممنوعة ·
--    P0024 غير موثّق · P0025 عبثٌ بتاريخ إنشاء الحساب.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ٠) حارس: هذه هجرة إنتاج (جدّة) ─────────────────────────────────────────
DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_admin_perm(text)') IS NULL
     OR to_regprocedure('public.taki_norm(text)') IS NULL
     OR to_regprocedure('public.taki_rate_check(text,integer,integer,text)') IS NULL THEN
    RAISE EXCEPTION 'خادمٌ ينقصه taki_admin_perm/taki_norm/taki_rate_check — أوقِفت قبل أن أبني على فراغ.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) الإعداد + مصدرُه الواحد
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO public.platform_settings (key, value, description)
VALUES ('verification',
        '{"mode":"off","sla_hours":24,"vacation":false,"show_badge":false}'::jsonb,
        'توثيق التجّار: off بلا أثر · advisory يُطلب بلا منع · required يمنع نشر عرضٍ جديد لغير الموثّق. vacation يُنزِّل required إلى advisory بضغطة. show_badge يُظهر شارة «موثّق» للمشتري.')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.taki_verification_policy()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'mode', COALESCE((SELECT CASE WHEN value->>'mode' IN ('off','advisory','required')
                                  THEN value->>'mode' END
                        FROM public.platform_settings WHERE key='verification'), 'off'),
    'sla_hours', GREATEST(1, LEAST(720, COALESCE((
        SELECT floor((value->>'sla_hours')::numeric)::int FROM public.platform_settings
         WHERE key='verification' AND jsonb_typeof(value->'sla_hours')='number'), 24))),
    'vacation',  COALESCE((SELECT value->'vacation'   = 'true'::jsonb FROM public.platform_settings WHERE key='verification'), false),
    'show_badge',COALESCE((SELECT value->'show_badge' = 'true'::jsonb FROM public.platform_settings WHERE key='verification'), false)
  );
$fn$;
REVOKE ALL ON FUNCTION public.taki_verification_policy() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_verification_policy() FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_verification_policy() TO authenticated, service_role;

-- الوضع **الفعليّ**: السفر يُنزِّل الإلزام إلى نصيحة. مصدرٌ واحد لا يُحسب مرّتين.
CREATE OR REPLACE FUNCTION public.taki_verification_mode()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN (public.taki_verification_policy()->>'mode') = 'required'
     AND (public.taki_verification_policy()->>'vacation')::boolean THEN 'advisory'
    ELSE public.taki_verification_policy()->>'mode' END;
$fn$;
REVOKE ALL ON FUNCTION public.taki_verification_mode() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_verification_mode() FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_verification_mode() TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) الجدولان — ولا سياسة كتابة على أيٍّ منهما (سابقة store_name_requests)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.store_verifications (
  id           text PRIMARY KEY DEFAULT ('ver_' || replace(gen_random_uuid()::text, '-', '')),
  store_id     text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  doc_kind     text NOT NULL CHECK (doc_kind IN ('business_sa','cr','freelance')),
  doc_number   text NOT NULL,
  legal_name   text,                       -- يكتبه الأدمن من السجل عند الاعتماد
  claimed_name text,                       -- ما كتبه التاجر (لقطة، للمقارنة)
  doc_expiry   date,                       -- NULL = بلا انتهاء (السجل الجديد ألغاه)
  status       text NOT NULL DEFAULT 'submitted'
               CHECK (status IN ('submitted','approved','rejected','withdrawn','expired','superseded','revoked')),
  assurance    text CHECK (assurance IS NULL OR assurance IN ('registry','declared')),
  name_ack     boolean NOT NULL DEFAULT false,
  reject_code  text CHECK (reject_code IS NULL OR reject_code IN
               ('not_found','name_mismatch','expired_doc','suspended_doc','not_owner','duplicate_cr','wrong_activity','other')),
  admin_note   text,
  -- 🪤 SET NULL لا CASCADE: كل وصلات `users` هنا CASCADE، وتقليدُها كان يمحو
  --    سجلّ قرارٍ هو الدليلُ الوحيد على ما جرى (درس v14.77).
  admin_id     text REFERENCES public.users(id) ON DELETE SET NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ver_one_open     ON public.store_verifications (store_id) WHERE status = 'submitted';
CREATE UNIQUE INDEX IF NOT EXISTS idx_ver_one_approved ON public.store_verifications (store_id) WHERE status = 'approved';
-- تفرّدُ الهويّة نفسها: متجران لا يُعتمدان على سجلٍّ واحد. (v14.36 تفحص التفرّد
-- عند الطلب لا عند الاعتماد — وهو بالضبط TOCTOU الذي لا يُكرَّر هنا.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ver_number       ON public.store_verifications (doc_kind, lower(btrim(doc_number))) WHERE status = 'approved';
CREATE INDEX        IF NOT EXISTS idx_ver_queue        ON public.store_verifications (submitted_at) WHERE status = 'submitted';
CREATE INDEX        IF NOT EXISTS idx_ver_expiry       ON public.store_verifications (doc_expiry)   WHERE status = 'approved';

ALTER TABLE public.store_verifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ver_select_own ON public.store_verifications;
CREATE POLICY ver_select_own ON public.store_verifications FOR SELECT TO authenticated
  USING ((SELECT auth.uid())::text = store_id OR (SELECT public.taki_admin_perm('tab_verification')));
-- 🪤 سوبابيس تمنح `authenticated` كل DML على أي جدولٍ عامّ جديد افتراضياً،
--    فـ«لا سياسة كتابة» وحدها ليست حارساً.
REVOKE ALL ON public.store_verifications FROM PUBLIC;
REVOKE ALL ON public.store_verifications FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.store_verifications FROM authenticated;
GRANT SELECT ON public.store_verifications TO authenticated;

-- جدولُ الامتياز الانتقالي: **لا يُشتقّ من عمودٍ يملكه التاجر**.
CREATE TABLE IF NOT EXISTS public.store_verification_grace (
  store_id   text PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  until      timestamptz NOT NULL,
  opened_by  text REFERENCES public.users(id) ON DELETE SET NULL,
  opened_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.store_verification_grace ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vgrace_select_own ON public.store_verification_grace;
CREATE POLICY vgrace_select_own ON public.store_verification_grace FOR SELECT TO authenticated
  USING ((SELECT auth.uid())::text = store_id OR (SELECT public.taki_admin_perm('tab_verification')));
REVOKE ALL ON public.store_verification_grace FROM PUBLIC;
REVOKE ALL ON public.store_verification_grace FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.store_verification_grace FROM authenticated;
GRANT SELECT ON public.store_verification_grace TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) القرّاء
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.taki_store_verified(text);
CREATE FUNCTION public.taki_store_verified(p_store_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.store_verifications v
                  WHERE v.store_id = p_store_id AND v.status = 'approved'
                    AND (v.doc_expiry IS NULL OR v.doc_expiry >= current_date));
$fn$;
REVOKE ALL ON FUNCTION public.taki_store_verified(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_store_verified(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_store_verified(text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.taki_store_grandfathered(text);
CREATE FUNCTION public.taki_store_grandfathered(p_store_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.store_verification_grace g
                  WHERE g.store_id = p_store_id AND g.until > now());
$fn$;
REVOKE ALL ON FUNCTION public.taki_store_grandfathered(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_store_grandfathered(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_store_grandfathered(text) TO authenticated, service_role;

-- شارةُ المشتري — الشيء الوحيد الذي يراه الزائر، وبوّابتُه `show_badge`.
DROP FUNCTION IF EXISTS public.store_is_verified(text);
CREATE FUNCTION public.store_is_verified(p_store_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT (public.taki_verification_policy()->>'show_badge')::boolean
     AND public.taki_store_verified(p_store_id);
$fn$;
REVOKE ALL ON FUNCTION public.store_is_verified(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_is_verified(text) TO anon, authenticated, service_role;

-- سببُ منع النشر — مصدرٌ واحد يقرؤه الموقع والبوتان وشاشةُ الأدمن.
-- NULL = لا مانع. (وهو **ليس** `store_can_sell`، ولا يُنادى من مسار الحجز.)
DROP FUNCTION IF EXISTS public.taki_publish_block(text);
CREATE FUNCTION public.taki_publish_block(p_store_id text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_t text;
BEGIN
  SELECT user_type INTO v_t FROM public.users WHERE id = p_store_id AND deleted_at IS NULL;
  IF v_t IS NULL OR v_t NOT IN ('seller','admin') THEN RETURN 'not_merchant'; END IF;
  IF v_t = 'admin' THEN RETURN NULL; END IF;                 -- متجر المنصّة
  IF public.taki_verification_mode() <> 'required' THEN RETURN NULL; END IF;
  IF public.taki_store_verified(p_store_id) THEN RETURN NULL; END IF;
  IF public.taki_store_grandfathered(p_store_id) THEN RETURN NULL; END IF;
  RETURN 'not_verified';
END
$fn$;
REVOKE ALL ON FUNCTION public.taki_publish_block(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_publish_block(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_publish_block(text) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) مشغّلا `deals` — الموضعُ الوحيد، ويغطّي مسارات النشر الخمسة والنداء المباشر
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 لماذا يُستثنى الأدمن ودورُ النظام: `admin_hide_deal` تُعيد العرض بـ
--    `status='active'` على صفٍّ كان `paused` — فتخطّي «OLD.status='active'»
--    لا يسري، وبلا هذا الاستثناء كان ناصر يضغط «إعادة عرض» فيرى استثناءً خاماً.
--    و`taki_unfreeze_deals_within_cap` تعمل من الكرون بدور النظام.
CREATE OR REPLACE FUNCTION public.taki_guard_deal_merchant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_t text;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  IF current_user IN ('postgres','supabase_admin','service_role') THEN RETURN NEW; END IF;
  IF public.taki_admin_perm('action_delete_deals') OR public.taki_admin_perm('tab_verification')
     OR public.taki_admin_perm('tab_sellers') THEN RETURN NEW; END IF;
  SELECT user_type INTO v_t FROM public.users WHERE id = NEW.store_id AND deleted_at IS NULL;
  IF v_t IS NULL OR v_t NOT IN ('seller','admin') THEN
    RAISE EXCEPTION 'هذا الحساب ليس حساب تاجر — لا يُنشر منه عرض.' USING ERRCODE = 'P0022';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION public.taki_guard_publish_needs_verification()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_same boolean;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  IF current_user IN ('postgres','supabase_admin','service_role') THEN RETURN NEW; END IF;
  IF public.taki_admin_perm('action_delete_deals') OR public.taki_admin_perm('tab_verification')
     OR public.taki_admin_perm('tab_sellers') THEN RETURN NEW; END IF;

  -- 🪤 الامتياز ليس أبدياً ولا يصلح خانةَ نشرٍ دائمة: عرضٌ حيٌّ يُعدَّل **محتواه**
  --    يمرّ بالبوّابة. `dealRepository.save` تُرسل الصفّ كاملاً فتُطلق هذا
  --    الفرع، وبلا فحص المحتوى كان عرضٌ واحد مُعفى يصير منفذاً دائماً:
  --    يُعاد تسميته وتُبدَّل صوره ويُعاد تسعيره بلا حدّ.
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' THEN
    v_same := (NEW.item_name        IS NOT DISTINCT FROM OLD.item_name)
          AND (NEW.description      IS NOT DISTINCT FROM OLD.description)
          AND (NEW.images           IS NOT DISTINCT FROM OLD.images)
          AND (NEW.original_price   IS NOT DISTINCT FROM OLD.original_price)
          AND (NEW.discounted_price IS NOT DISTINCT FROM OLD.discounted_price)
          AND (NEW.category         IS NOT DISTINCT FROM OLD.category);
    IF v_same THEN RETURN NEW; END IF;
  END IF;

  IF public.taki_publish_block(NEW.store_id) = 'not_verified' THEN
    RAISE EXCEPTION 'عرضك لم يُنشر: متجرك غير موثّق بعد. أرسل رقم سجلك من «توثيق المتجر» في لوحة التاجر.'
      USING ERRCODE = 'P0024';
  END IF;
  RETURN NEW;
END
$fn$;

-- 🪤 الترتيب الأبجدي هو كل شيء هنا:
--    `tr_aa_…` أوّلاً (ليس تاجراً) · ثم `tr_ab_guard_suspended_publish` القائم
--    (الموقوف يُقال له «موقوف» لا «غير موثّق») · ثم `tr_abz_…` (غير موثّق) ·
--    ثم `tr_ac_publish_needs_declaration` (وإلا حوّلها إلى paused فخرج حارسي صامتاً).
--    `z` (0x7A) > `_` (0x5F) في ترتيب C، وفي ICU تُهمل العلامة فيُقارَن g<z —
--    فالوضع صحيحٌ في الحالتين. والتحقّق في الأسفل **يقرأ الترتيب الحيّ** ويرفع.
DROP TRIGGER IF EXISTS tr_aa_guard_deal_merchant ON public.deals;
CREATE TRIGGER tr_aa_guard_deal_merchant
  BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW WHEN (NEW.status = 'active')
  EXECUTE FUNCTION public.taki_guard_deal_merchant();

DROP TRIGGER IF EXISTS tr_abz_guard_publish_needs_verification ON public.deals;
CREATE TRIGGER tr_abz_guard_publish_needs_verification
  BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW WHEN (NEW.status = 'active')
  EXECUTE FUNCTION public.taki_guard_publish_needs_verification();

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) قفلُ الكاتب الحرّ لـ`cr_number` + تحصينُ `created_at`
-- ═══════════════════════════════════════════════════════════════════════════
-- قِيس على جدّة: ٠ من ٣ متاجر تحمل رقماً، فالتصفيرُ بلا أثر تاريخيّ —
-- وهو ما يجعل الحارس آمناً أمام الحزمة المنشورة اليوم: `StoreDetails.tsx`
-- تُرسل `cr_number` في **كل** حفظ ملفٍّ (داخل `catch {}` بلا `.select()`)،
-- فبقاء NEW = OLD = NULL يُبقي شرط المشغّل غير مُطلَق.
UPDATE public.store_profiles SET cr_number = NULL WHERE cr_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.taki_guard_store_cr()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.cr_number IS NOT DISTINCT FROM OLD.cr_number THEN RETURN NEW; END IF;
  IF current_user IN ('postgres','supabase_admin','service_role') THEN RETURN NEW; END IF;
  IF public.taki_admin_perm('tab_verification') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'رقم السجل يُحدَّد من طلب التوثيق وحده.' USING ERRCODE = 'P0023';
END
$fn$;
DROP TRIGGER IF EXISTS tr_ad_guard_store_cr ON public.store_profiles;
CREATE TRIGGER tr_ad_guard_store_cr
  BEFORE UPDATE OF cr_number ON public.store_profiles
  FOR EACH ROW EXECUTE FUNCTION public.taki_guard_store_cr();

-- 🔴 `users.created_at` كان قابلاً للكتابة من صاحب الصفّ (`users_update_admin`
--    تسمح `uid()::text = id`، و`tr_guard_user_privileges` يحرس الدور والصلاحيات
--    فقط). أيّ امتيازٍ أو تحليلٍ مبنيٍّ على تاريخ الإنشاء كان مزوَّراً بنداءٍ واحد.
CREATE OR REPLACE FUNCTION public.taki_guard_user_created_at()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.created_at IS NOT DISTINCT FROM OLD.created_at THEN RETURN NEW; END IF;
  IF current_user IN ('postgres','supabase_admin','service_role') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'تاريخ إنشاء الحساب لا يُعدَّل.' USING ERRCODE = 'P0025';
END
$fn$;
DROP TRIGGER IF EXISTS tr_ae_guard_user_created_at ON public.users;
CREATE TRIGGER tr_ae_guard_user_created_at
  BEFORE UPDATE OF created_at ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.taki_guard_user_created_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- ٦) دوال التاجر
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.merchant_submit_verification(text, text, text, date);
CREATE FUNCTION public.merchant_submit_verification(
  p_kind text, p_number text, p_legal_name text, p_expiry date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_uid text := (SELECT auth.uid())::text; v_t text; v_shop text;
        v_num text := btrim(COALESCE(p_number,'')); v_name text := btrim(COALESCE(p_legal_name,''));
        v_id text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT user_type, shop INTO v_t, v_shop FROM public.users WHERE id = v_uid AND deleted_at IS NULL;
  IF v_t IS NULL OR (v_t NOT IN ('seller','admin') AND NULLIF(btrim(COALESCE(v_shop,'')),'') IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_A_MERCHANT');
  END IF;
  IF p_kind NOT IN ('business_sa','cr','freelance') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_KIND'); END IF;
  -- 🪤 فحصُ الشكل **مرشّحُ أخطاءٍ مطبعية لا إثبات**: لا خانة تدقيق منشورة لأي
  --    سجلٍّ سعودي، و`^7[0-9]{9}$` كانت سترفض سجلات `1010…/4030…` السارية.
  IF p_kind = 'cr'        AND v_num !~ '^[0-9]{10}$'   THEN RETURN jsonb_build_object('ok', false, 'error', 'BAD_NUMBER'); END IF;
  IF p_kind = 'business_sa' AND v_num !~ '^[0-9]{5,14}$' THEN RETURN jsonb_build_object('ok', false, 'error', 'BAD_NUMBER'); END IF;
  IF p_kind = 'freelance' AND length(v_num) < 4        THEN RETURN jsonb_build_object('ok', false, 'error', 'BAD_NUMBER'); END IF;
  IF length(v_name) < 3 THEN RETURN jsonb_build_object('ok', false, 'error', 'BAD_NAME'); END IF;

  IF EXISTS (SELECT 1 FROM public.store_verifications WHERE store_id = v_uid AND status = 'submitted') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_PENDING'); END IF;
  IF EXISTS (SELECT 1 FROM public.store_verifications
              WHERE status = 'approved' AND store_id <> v_uid
                AND doc_kind = p_kind AND lower(btrim(doc_number)) = lower(v_num)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NUMBER_TAKEN'); END IF;

  -- ٣ محاولات في اليوم: طابورٌ يُغرق أسرعَ ممّا يُفرَّغ يجعل مهلةَ المراجعة كذبة.
  BEGIN
    PERFORM public.taki_rate_check('ver:' || v_uid, 3, 86400, 'RATE_LIMIT');
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TOO_MANY');
  END;

  INSERT INTO public.store_verifications (store_id, doc_kind, doc_number, claimed_name, doc_expiry)
  VALUES (v_uid, p_kind, v_num, v_name, p_expiry)
  RETURNING id INTO v_id;

  -- إشعارٌ واحد، ولحاملي الصلاحية وحدهم — لا فيضانٌ لكل أدمن (قاعدة المشروع).
  INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
  SELECT u.id, '🪪 طلب توثيق جديد', '🪪 New verification request',
         'طلب توثيق من متجر «' || COALESCE(NULLIF(v_shop,''),'متجر') || '» — بانتظار مراجعتك.',
         'A merchant submitted a verification request.', 'system',
         jsonb_build_object('audience','admin','verificationId', v_id,
                            'actionUrl','/admin?tab=verification','action_url','/admin?tab=verification')
    FROM public.users u
   WHERE u.user_type = 'admin' AND u.deleted_at IS NULL
     AND (COALESCE(u.is_super_admin,false) OR 'tab_verification' = ANY(COALESCE(u.admin_permissions,'{}'::text[])));

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'status', 'submitted');
END
$fn$;
REVOKE ALL ON FUNCTION public.merchant_submit_verification(text, text, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_submit_verification(text, text, text, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_submit_verification(text, text, text, date) TO authenticated;

DROP FUNCTION IF EXISTS public.merchant_withdraw_verification();
CREATE FUNCTION public.merchant_withdraw_verification()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_uid text := (SELECT auth.uid())::text; n int;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  UPDATE public.store_verifications SET status = 'withdrawn', decided_at = now()
   WHERE store_id = v_uid AND status = 'submitted';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'NO_OPEN_REQUEST'); END IF;
  RETURN jsonb_build_object('ok', true);
END
$fn$;
REVOKE ALL ON FUNCTION public.merchant_withdraw_verification() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_withdraw_verification() FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_withdraw_verification() TO authenticated;

DROP FUNCTION IF EXISTS public.my_verification_state();
CREATE FUNCTION public.my_verification_state()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_uid text := (SELECT auth.uid())::text; v_t text; v_shop text; r record; g timestamptz;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT user_type, shop INTO v_t, v_shop FROM public.users WHERE id = v_uid AND deleted_at IS NULL;
  IF v_t IS NULL OR (v_t NOT IN ('seller','admin') AND NULLIF(btrim(COALESCE(v_shop,'')),'') IS NULL) THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.store_verifications
   WHERE store_id = v_uid AND status IN ('submitted','approved')
   ORDER BY CASE status WHEN 'submitted' THEN 0 ELSE 1 END, submitted_at DESC LIMIT 1;
  IF r.id IS NULL THEN
    SELECT * INTO r FROM public.store_verifications WHERE store_id = v_uid
     ORDER BY submitted_at DESC LIMIT 1;
  END IF;
  SELECT until INTO g FROM public.store_verification_grace WHERE store_id = v_uid;
  RETURN jsonb_build_object(
    'mode', public.taki_verification_mode(),
    'sla_hours', (public.taki_verification_policy()->>'sla_hours')::int,
    'verified', public.taki_store_verified(v_uid),
    'grace_until', g,
    'status', COALESCE(r.status,'none'), 'doc_kind', r.doc_kind, 'doc_number', r.doc_number,
    'legal_name', r.legal_name, 'claimed_name', r.claimed_name, 'doc_expiry', r.doc_expiry,
    'reject_code', r.reject_code, 'admin_note', r.admin_note,
    'submitted_at', r.submitted_at, 'decided_at', r.decided_at,
    'has_open', EXISTS (SELECT 1 FROM public.store_verifications WHERE store_id = v_uid AND status = 'submitted'));
END
$fn$;
REVOKE ALL ON FUNCTION public.my_verification_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_verification_state() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_verification_state() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٧) دوال الأدمن — الحارسُ `taki_admin_perm` داخلها، لا `is_admin()`
--     (`is_admin()` **تفشل مفتوحة** إن غاب صفُّ admin_rpc_permissions)
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.admin_list_verifications(text, integer, timestamptz);
CREATE FUNCTION public.admin_list_verifications(
  p_status text DEFAULT 'submitted', p_limit int DEFAULT 50, p_cursor timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_rows jsonb;
BEGIN
  IF NOT public.taki_admin_perm('tab_verification') THEN
    RAISE EXCEPTION 'غير مصرّح' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_agg(x ORDER BY (x->>'submitted_at') DESC) INTO v_rows FROM (
    SELECT jsonb_build_object(
      'id', v.id, 'store_id', v.store_id, 'shop', u.shop, 'owner_name', u.name,
      'owner_phone', u.phone, 'owner_email', u.email,
      'doc_kind', v.doc_kind, 'doc_number', v.doc_number, 'claimed_name', v.claimed_name,
      'legal_name', v.legal_name, 'doc_expiry', v.doc_expiry, 'status', v.status,
      'reject_code', v.reject_code, 'admin_note', v.admin_note,
      'submitted_at', v.submitted_at, 'decided_at', v.decided_at,
      'dup_number', EXISTS (SELECT 1 FROM public.store_verifications d
                             WHERE d.id <> v.id AND d.status IN ('submitted','approved')
                               AND d.doc_kind = v.doc_kind
                               AND lower(btrim(d.doc_number)) = lower(btrim(v.doc_number))),
      'name_matches', (public.taki_norm(COALESCE(v.claimed_name,'')) = public.taki_norm(COALESCE(u.shop,'')))
    ) AS x
      FROM public.store_verifications v JOIN public.users u ON u.id = v.store_id
     WHERE (p_status IS NULL OR v.status = p_status)
       AND (p_cursor IS NULL OR v.submitted_at < p_cursor)
     ORDER BY v.submitted_at DESC LIMIT GREATEST(1, LEAST(200, p_limit))
  ) s;
  RETURN jsonb_build_object('ok', true, 'rows', COALESCE(v_rows, '[]'::jsonb));
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_list_verifications(text, integer, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_verifications(text, integer, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_verifications(text, integer, timestamptz) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_resolve_verification(text, boolean, text, text, text, date, boolean);
CREATE FUNCTION public.admin_resolve_verification(
  p_id text, p_approve boolean, p_legal_name text DEFAULT NULL, p_note text DEFAULT NULL,
  p_reject_code text DEFAULT NULL, p_expiry date DEFAULT NULL, p_name_ack boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE r record; v_uid text := (SELECT auth.uid())::text; v_shop text;
        v_name text := btrim(COALESCE(p_legal_name,'')); v_msg text;
BEGIN
  IF NOT public.taki_admin_perm('tab_verification') THEN
    RAISE EXCEPTION 'غير مصرّح' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.store_verifications WHERE id = p_id FOR UPDATE;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF r.status <> 'submitted' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_DECIDED', 'status', r.status); END IF;

  IF p_approve THEN
    IF length(v_name) < 3 THEN RETURN jsonb_build_object('ok', false, 'error', 'LEGAL_NAME_REQUIRED'); END IF;
    -- إعادةُ فحص التفرّد **تحت القفل**: الفهرس وحده يعطي المراجع انتهاكَ قيدٍ خاماً.
    IF EXISTS (SELECT 1 FROM public.store_verifications d
                WHERE d.status = 'approved' AND d.store_id <> r.store_id
                  AND d.doc_kind = r.doc_kind
                  AND lower(btrim(d.doc_number)) = lower(btrim(r.doc_number))) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'NUMBER_TAKEN'); END IF;
    SELECT shop INTO v_shop FROM public.users WHERE id = r.store_id;
    IF public.taki_norm(v_name) <> public.taki_norm(COALESCE(v_shop,'')) AND NOT COALESCE(p_name_ack,false) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'NAME_MISMATCH_UNACKED',
                                'legal_name', v_name, 'shop', v_shop); END IF;

    UPDATE public.store_verifications SET status = 'superseded', decided_at = now()
     WHERE store_id = r.store_id AND status = 'approved';
    UPDATE public.store_verifications
       SET status = 'approved', legal_name = v_name, doc_expiry = COALESCE(p_expiry, r.doc_expiry),
           assurance = CASE WHEN r.doc_kind = 'freelance' THEN 'declared' ELSE 'registry' END,
           name_ack = COALESCE(p_name_ack,false), admin_note = p_note, admin_id = v_uid,
           reject_code = NULL, decided_at = now()
     WHERE id = r.id;
    -- الفاتورة (v14.17) تقرأ `store_profiles.cr_number` — فالرقمُ المعتمد يُكتب
    -- هنا بدور الأدمن، والمشغّل يستثنيه. أي أن لا نسختين متباعدتين من هويّة.
    UPDATE public.store_profiles SET cr_number = btrim(r.doc_number) WHERE store_id = r.store_id;
    v_msg := '✅ تم توثيق متجرك. الاسم المسجَّل: «' || v_name || '». يمكنك نشر عروضك الآن.';
  ELSE
    UPDATE public.store_verifications
       SET status = 'rejected', reject_code = COALESCE(p_reject_code,'other'),
           admin_note = p_note, admin_id = v_uid, decided_at = now()
     WHERE id = r.id;
    v_msg := '❌ لم يُقبل طلب التوثيق: ' || CASE COALESCE(p_reject_code,'other')
      WHEN 'not_found'      THEN 'الرقم غير موجود في السجل الرسمي.'
      WHEN 'name_mismatch'  THEN 'الاسم في السجل لا يطابق اسم متجرك.'
      WHEN 'expired_doc'    THEN 'السجل/الوثيقة منتهية الصلاحية.'
      WHEN 'suspended_doc'  THEN 'السجل موقوف.'
      WHEN 'not_owner'      THEN 'الوثيقة ليست باسم صاحب الحساب.'
      WHEN 'duplicate_cr'   THEN 'هذا الرقم موثَّق لمتجرٍ آخر.'
      WHEN 'wrong_activity' THEN 'النشاط لا يشمل البيع الإلكتروني.'
      ELSE 'راجع الملاحظة أدناه.' END
      || COALESCE(E'\n' || p_note, '');
  END IF;

  INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
  VALUES (r.store_id, CASE WHEN p_approve THEN '✅ متجرك موثّق' ELSE '❌ طلب التوثيق' END,
          CASE WHEN p_approve THEN '✅ Store verified' ELSE '❌ Verification request' END,
          v_msg, v_msg, 'system',
          jsonb_build_object('audience','seller','actionUrl','/seller','action_url','/seller'));
  RETURN jsonb_build_object('ok', true, 'approved', p_approve);
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_resolve_verification(text, boolean, text, text, text, date, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_resolve_verification(text, boolean, text, text, text, date, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_verification(text, boolean, text, text, text, date, boolean) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_revoke_verification(text, text);
CREATE FUNCTION public.admin_revoke_verification(p_store_id text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE n int := 0; v_paused int := 0; v_msg text;
BEGIN
  IF NOT public.taki_admin_perm('tab_verification') THEN
    RAISE EXCEPTION 'غير مصرّح' USING ERRCODE = '42501'; END IF;
  UPDATE public.store_verifications
     SET status = 'revoked', admin_note = p_reason, admin_id = (SELECT auth.uid())::text, decided_at = now()
   WHERE store_id = p_store_id AND status = 'approved';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_VERIFIED'); END IF;
  UPDATE public.deals SET status = 'paused' WHERE store_id = p_store_id AND status = 'active';
  GET DIAGNOSTICS v_paused = ROW_COUNT;
  v_msg := '🚫 سُحب توثيق متجرك: ' || COALESCE(p_reason,'—') ||
           '. وأُوقفت عروضك مؤقتاً حتى تُعيد التوثيق. (طلباتك القائمة تكمل كما هي.)';
  INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
  VALUES (p_store_id, '🚫 سُحب التوثيق', '🚫 Verification revoked', v_msg, v_msg, 'system',
          jsonb_build_object('audience','seller','actionUrl','/seller','action_url','/seller'));
  RETURN jsonb_build_object('ok', true, 'paused_deals', v_paused);
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_revoke_verification(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_revoke_verification(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_verification(text, text) TO authenticated;

-- الامتيازُ الانتقاليّ: لقطةٌ مجمّدة لمن كان قائماً تلك اللحظة. لا يُشتقّ من عمود.
DROP FUNCTION IF EXISTS public.admin_open_verification_grace(timestamptz);
CREATE FUNCTION public.admin_open_verification_grace(p_until timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE n int;
BEGIN
  IF NOT public.taki_admin_perm('tab_verification') THEN
    RAISE EXCEPTION 'غير مصرّح' USING ERRCODE = '42501'; END IF;
  IF p_until IS NULL OR p_until <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_DATE'); END IF;
  INSERT INTO public.store_verification_grace (store_id, until, opened_by)
  SELECT u.id, p_until, (SELECT auth.uid())::text
    FROM public.users u
   WHERE u.user_type = 'seller' AND u.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM public.store_profiles sp WHERE sp.store_id = u.id)
  ON CONFLICT (store_id) DO UPDATE SET until = EXCLUDED.until, opened_by = EXCLUDED.opened_by, opened_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'stores', n, 'until', p_until);
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_open_verification_grace(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_open_verification_grace(timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_open_verification_grace(timestamptz) TO authenticated;

-- عدّادُ نصف القطر: يُقرأ **قبل** كل تبديل وضع.
DROP FUNCTION IF EXISTS public.admin_verification_stats();
CREATE FUNCTION public.admin_verification_stats()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT public.taki_admin_perm('tab_verification') THEN
    RAISE EXCEPTION 'غير مصرّح' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'mode', public.taki_verification_mode(),
    'policy', public.taki_verification_policy(),
    'pending',  (SELECT count(*) FROM public.store_verifications WHERE status='submitted'),
    'oldest_pending_hours', (SELECT ROUND(EXTRACT(EPOCH FROM (now() - MIN(submitted_at)))/3600)::int
                               FROM public.store_verifications WHERE status='submitted'),
    'approved', (SELECT count(*) FROM public.store_verifications WHERE status='approved'),
    'rejected_30d', (SELECT count(*) FROM public.store_verifications
                      WHERE status='rejected' AND decided_at > now() - interval '30 days'),
    'expiring_30d', (SELECT count(*) FROM public.store_verifications
                      WHERE status='approved' AND doc_expiry IS NOT NULL
                        AND doc_expiry <= (current_date + 30)),
    'merchants', (SELECT count(*) FROM public.users WHERE user_type='seller' AND deleted_at IS NULL),
    'would_block', (SELECT count(*) FROM public.users u
                     WHERE u.user_type='seller' AND u.deleted_at IS NULL
                       AND NOT public.taki_store_verified(u.id)
                       AND NOT public.taki_store_grandfathered(u.id)),
    'would_block_live_deals', (SELECT count(*) FROM public.deals d JOIN public.users u ON u.id=d.store_id
                     WHERE d.status='active' AND u.user_type='seller' AND u.deleted_at IS NULL
                       AND NOT public.taki_store_verified(u.id)
                       AND NOT public.taki_store_grandfathered(u.id)));
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_verification_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_verification_stats() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_verification_stats() TO authenticated;

-- 🔴 الامتيازُ **ليس أبدياً**: تخطّي «OLD.status='active'» يحمي العروض الحيّة
--    إلى ما لا نهاية بنفسه. فإن كان المقصود أن يتوقّف غيرُ الموثّق عن البيع،
--    فلا بدّ من كنسةٍ صريحة — وهي بيدِ ناصر، لا تلقائية.
DROP FUNCTION IF EXISTS public.admin_sweep_unverified_deals(boolean);
CREATE FUNCTION public.admin_sweep_unverified_deals(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE n int := 0; r record; v_msg text;
BEGIN
  IF NOT public.taki_admin_perm('tab_verification') THEN
    RAISE EXCEPTION 'غير مصرّح' USING ERRCODE = '42501'; END IF;
  SELECT count(*) INTO n FROM public.deals d JOIN public.users u ON u.id = d.store_id
   WHERE d.status = 'active' AND u.user_type = 'seller' AND u.deleted_at IS NULL
     AND NOT public.taki_store_verified(u.id) AND NOT public.taki_store_grandfathered(u.id);
  IF p_dry_run THEN RETURN jsonb_build_object('ok', true, 'dry_run', true, 'would_pause', n); END IF;
  FOR r IN SELECT DISTINCT d.store_id FROM public.deals d JOIN public.users u ON u.id = d.store_id
            WHERE d.status = 'active' AND u.user_type = 'seller' AND u.deleted_at IS NULL
              AND NOT public.taki_store_verified(u.id) AND NOT public.taki_store_grandfathered(u.id)
  LOOP
    UPDATE public.deals SET status = 'paused' WHERE store_id = r.store_id AND status = 'active';
    v_msg := '📝 أُوقفت عروضك مؤقتاً: انتهت مهلة التوثيق ولم يصلنا سجلك. أرسله من «توثيق المتجر» وتعود عروضك بضغطة.';
    INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
    VALUES (r.store_id, '📝 عروضك متوقفة', '📝 Your deals are paused', v_msg, v_msg, 'system',
            jsonb_build_object('audience','seller','actionUrl','/seller','action_url','/seller'));
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'dry_run', false, 'paused', n);
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_sweep_unverified_deals(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_sweep_unverified_deals(boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_sweep_unverified_deals(boolean) TO authenticated;

DELETE FROM public.admin_rpc_permissions
 WHERE rpc_name IN ('admin_list_verifications','admin_resolve_verification','admin_revoke_verification',
                    'admin_open_verification_grace','admin_verification_stats','admin_sweep_unverified_deals');
INSERT INTO public.admin_rpc_permissions (rpc_name, required_perm) VALUES
  ('admin_list_verifications','tab_verification'),
  ('admin_resolve_verification','tab_verification'),
  ('admin_revoke_verification','tab_verification'),
  ('admin_open_verification_grace','tab_verification'),
  ('admin_verification_stats','tab_verification'),
  ('admin_sweep_unverified_deals','tab_verification');

-- ═══════════════════════════════════════════════════════════════════════════
-- ٨) بوّابةُ البوتين — قِيس أن `rpc()` في server/bot.js:200 تُرجع **null** عند أي
--    خطأ، فرفعُ استثناءٍ داخل `bot_add_deal` كان سيظهر «فشل النشر» العامّ.
--    فالبوتان يسألان قبل الإرسال، ويُبلّغان أيضاً بنقص الإقرار الذي يُسكِته
--    `tr_ac` اليوم بتحويل العرض إلى مسوّدة مع `success:true`.
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.bot_publish_gate(bigint, text);
CREATE FUNCTION public.bot_publish_gate(p_telegram_id bigint DEFAULT NULL, p_whatsapp_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_uid text; v_block text; v_sell jsonb;
BEGIN
  v_uid := public._bot_uid(p_telegram_id, p_whatsapp_id);
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_seller'); END IF;
  v_block := public.taki_publish_block(v_uid);
  IF v_block IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'ok', false, 'reason', v_block,
      'sla_hours', (public.taki_verification_policy()->>'sla_hours')::int); END IF;
  v_sell := public.store_can_sell(v_uid);
  IF NOT COALESCE((v_sell->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('success', true, 'ok', false, 'reason', v_sell->>'reason'); END IF;
  RETURN jsonb_build_object('success', true, 'ok', true);
END
$fn$;
REVOKE ALL ON FUNCTION public.bot_publish_gate(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bot_publish_gate(bigint, text) TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٩) الكرون: انتهاءُ الصلاحية · إنذارُ تجاوز المهلة
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.taki_expire_verifications();
CREATE FUNCTION public.taki_expire_verifications()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE n int := 0; r record; v_msg text;
BEGIN
  -- تنبيهٌ قبل ١٤ يوماً (مرّةً واحدة — الإشعارُ نفسه لا يتكرّر في اليوم).
  FOR r IN SELECT store_id, doc_expiry FROM public.store_verifications
            WHERE status='approved' AND doc_expiry IS NOT NULL
              AND doc_expiry = (current_date + 14) LOOP
    v_msg := '⚠️ ينتهي توثيق متجرك خلال ١٤ يوماً. جدّده من «توثيق المتجر» — عروضك الحالية تبقى تعمل، لكن لن تستطيع نشر عرضٍ جديد بعد الانتهاء.';
    INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
    VALUES (r.store_id, '⚠️ توثيقك يقترب من الانتهاء', '⚠️ Verification expiring',
            v_msg, v_msg, 'system', jsonb_build_object('audience','seller','actionUrl','/seller','action_url','/seller'));
  END LOOP;

  FOR r IN SELECT id, store_id FROM public.store_verifications
            WHERE status='approved' AND doc_expiry IS NOT NULL AND doc_expiry < current_date LOOP
    UPDATE public.store_verifications SET status='expired', decided_at = now() WHERE id = r.id;
    -- 🪤 الانتهاء **لا يوقف عرضاً حيّاً**: تاريخٌ يمرّ في الواحدة فجراً لا يُسقط
    --    بضاعة تاجرٍ نائم. يمنع النشر الجديد فقط.
    v_msg := '⚠️ انتهت صلاحية توثيق متجرك. عروضك الحالية تعمل، ولا يمكنك نشر عرضٍ جديد حتى تجدّد.';
    INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
    VALUES (r.store_id, '⚠️ انتهى توثيق متجرك', '⚠️ Verification expired',
            v_msg, v_msg, 'system', jsonb_build_object('audience','seller','actionUrl','/seller','action_url','/seller'));
    n := n + 1;
  END LOOP;
  RETURN n;
END
$fn$;
REVOKE ALL ON FUNCTION public.taki_expire_verifications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_expire_verifications() FROM anon;
REVOKE ALL ON FUNCTION public.taki_expire_verifications() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_expire_verifications() TO service_role;

-- مهلةٌ نَعِد بها ولا نفي = فخّ v14.82. فلتصرخ بدل أن تكذب.
DROP FUNCTION IF EXISTS public.taki_verification_sla_alert();
CREATE FUNCTION public.taki_verification_sla_alert()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_h int; v_old int; n int := 0; v_msg text;
BEGIN
  IF public.taki_verification_mode() = 'off' THEN RETURN 0; END IF;
  v_h := (public.taki_verification_policy()->>'sla_hours')::int;
  SELECT ROUND(EXTRACT(EPOCH FROM (now() - MIN(submitted_at)))/3600)::int INTO v_old
    FROM public.store_verifications WHERE status = 'submitted';
  IF v_old IS NULL OR v_old < v_h THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications
              WHERE type='system' AND meta_data->>'kind' = 'ver_sla'
                AND created_at > now() - interval '12 hours') THEN RETURN 0; END IF;
  v_msg := '⏰ طلب توثيقٍ تجاوز المهلة المعلنة (أقدم طلب منذ ' || v_old || ' ساعة). افتح «توثيق التجّار».';
  INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
  SELECT u.id, '⏰ تجاوزُ مهلة التوثيق', '⏰ Verification SLA breached', v_msg, v_msg, 'system',
         jsonb_build_object('audience','admin','kind','ver_sla',
                            'actionUrl','/admin?tab=verification','action_url','/admin?tab=verification')
    FROM public.users u
   WHERE u.user_type='admin' AND u.deleted_at IS NULL
     AND (COALESCE(u.is_super_admin,false) OR 'tab_verification' = ANY(COALESCE(u.admin_permissions,'{}'::text[])));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;
REVOKE ALL ON FUNCTION public.taki_verification_sla_alert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_verification_sla_alert() FROM anon;
REVOKE ALL ON FUNCTION public.taki_verification_sla_alert() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_verification_sla_alert() TO service_role;

-- 🪤 جدّة على `+03:00` لا UTC — تحقّق بـ`date` قبل تصديق الساعة.
SELECT cron.unschedule('taki-verification-expiry') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='taki-verification-expiry');
SELECT cron.schedule('taki-verification-expiry', '20 1 * * *', 'SELECT public.taki_expire_verifications();');
SELECT cron.unschedule('taki-verification-sla')   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='taki-verification-sla');
SELECT cron.schedule('taki-verification-sla',   '10 * * * *', 'SELECT public.taki_verification_sla_alert();');

-- ═══════════════════════════════════════════════════════════════════════════
-- ١٠) مفتاحُ الإعداد يجب أن تراه سياسةُ القراءة — ترقيعٌ من النصّ **الحيّ**
-- ═══════════════════════════════════════════════════════════════════════════
DO $patch$
DECLARE v_qual text; v_roles text;
BEGIN
  SELECT pg_get_expr(p.polqual, p.polrelid),
         COALESCE((SELECT string_agg(quote_ident(r.rolname), ', ')
                     FROM pg_roles r WHERE r.oid = ANY(p.polroles)), 'public')
    INTO v_qual, v_roles
    FROM pg_policy p
   WHERE p.polrelid = 'public.platform_settings'::regclass
     AND p.polname  = 'platform_settings_select';
  IF v_qual IS NULL THEN
    RAISE EXCEPTION 'السياسة platform_settings_select غير موجودة — أوقِفت قبل أن أهدم شيئاً.'; END IF;
  IF position('''verification''' IN v_qual) > 0 THEN
    RAISE NOTICE 'ℹ️ verification مُدرَجٌ أصلاً — لا تغيير.'; RETURN; END IF;
  v_qual := replace(v_qual, '''chat_limits''::text', '''chat_limits''::text, ''verification''::text');
  IF position('''verification''' IN v_qual) = 0 THEN
    RAISE EXCEPTION 'تعذّر إدراج المفتاح: نصّ السياسة الحيّ لا يطابق المرساة. أوقِفت بلا تغيير.'; END IF;
  EXECUTE format(
    'DROP POLICY IF EXISTS platform_settings_select ON public.platform_settings; '
    'CREATE POLICY platform_settings_select ON public.platform_settings '
    'FOR SELECT TO %s USING (%s);', v_roles, v_qual);
  RAISE NOTICE '✅ أُدرج verification في سياسة القراءة (الأدوار: %)', v_roles;
END
$patch$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١١) الخصوصية — ترقيعٌ جراحيّ على `purge_expired_accounts` من نصّها الحيّ
--     (CASCADE لا يعمل: التجهيل لا يحذف صفّ المستخدم)
--     ويسدّ فجوةً قائمة منذ v14.27: `booking_messages` لا يذكرها التجهيل،
--     ولا مفتاح أجنبي من `sender_id` إلى `users`.
-- ═══════════════════════════════════════════════════════════════════════════
DO $purge$
DECLARE v_src text; v_anchor text := '    -- (د) الطلبات تبقى';
BEGIN
  v_src := pg_get_functiondef('public.purge_expired_accounts()'::regprocedure);
  IF position('store_verifications' IN v_src) > 0 AND position('booking_messages' IN v_src) > 0 THEN
    RAISE NOTICE 'ℹ️ التجهيل يشملهما أصلاً — لا تغيير.'; RETURN; END IF;
  IF position(v_anchor IN v_src) = 0 THEN
    RAISE EXCEPTION 'مرساةُ purge_expired_accounts غير موجودة — أوقِفت بلا تغيير.'; END IF;
  v_src := replace(v_src, v_anchor,
    '    -- v14.94 — التوثيق: القرار يبقى أثراً، والهويّة تذهب.' || E'\n' ||
    '    UPDATE public.store_verifications' || E'\n' ||
    '       SET doc_number = NULL, legal_name = NULL, claimed_name = NULL, admin_note = NULL' || E'\n' ||
    '     WHERE store_id = r.id;' || E'\n' ||
    '    -- v14.94 — نصوص المحادثات: فجوةٌ قائمة منذ v14.27، تكبر مع رفع حدّ الرسائل.' || E'\n' ||
    '    DELETE FROM public.booking_messages WHERE sender_id = r.id;' || E'\n' ||
    E'\n' || v_anchor);
  EXECUTE v_src;
  RAISE NOTICE '✅ التجهيل صار يشمل store_verifications و booking_messages.';
END
$purge$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١٢) إتمامُ v14.93 — ثلاث فجواتٍ شحنت مع رفع حدّ الرسائل
-- ═══════════════════════════════════════════════════════════════════════════
-- (أ) صفحةُ البوت: `bot_booking_chat` كانت تُرجع **كل** الرسائل، و
--     `server/bot.js` يبنيها في `ctx.reply` واحد. سقف تيليجرام ٤٠٩٦ محرفاً،
--     و`bot.catch` لا يفعل إلا `console.error` ⇒ شاشةٌ فارغة تماماً بلا خطأ.
CREATE OR REPLACE FUNCTION public.taki_chat_limits()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'per_booking', GREATEST(0, LEAST(1000, COALESCE((
        SELECT floor((value->>'per_booking')::numeric)::int FROM public.platform_settings
         WHERE key='chat_limits' AND jsonb_typeof(value->'per_booking')='number'), 0))),
    'per_hour',    GREATEST(1, LEAST(10000, COALESCE((
        SELECT floor((value->>'per_hour')::numeric)::int FROM public.platform_settings
         WHERE key='chat_limits' AND jsonb_typeof(value->'per_hour')='number'), 120))),
    'bot_page',    GREATEST(5, LEAST(100, COALESCE((
        SELECT floor((value->>'bot_page')::numeric)::int FROM public.platform_settings
         WHERE key='chat_limits' AND jsonb_typeof(value->'bot_page')='number'), 30)))
  );
$fn$;
REVOKE ALL ON FUNCTION public.taki_chat_limits() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_chat_limits() FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_chat_limits() TO authenticated, service_role;

DO $chat$
DECLARE v_src text;
  v_anchor text := '    INTO v_msgs FROM booking_messages m WHERE m.barcode = v_b.barcode;';
BEGIN
  v_src := pg_get_functiondef('public.bot_booking_chat(bigint,text,text)'::regprocedure);
  IF position('bot_page' IN v_src) > 0 THEN RAISE NOTICE 'ℹ️ مقيَّدةٌ أصلاً.'; RETURN; END IF;
  IF position(v_anchor IN v_src) = 0 THEN
    RAISE EXCEPTION 'مرساةُ bot_booking_chat غير موجودة — أوقِفت بلا تغيير.'; END IF;
  v_src := replace(v_src, v_anchor,
    '    INTO v_msgs FROM (SELECT * FROM booking_messages WHERE barcode = v_b.barcode' || E'\n' ||
    '                       ORDER BY created_at DESC' || E'\n' ||
    '                       LIMIT (public.taki_chat_limits()->>''bot_page'')::int) m;');
  EXECUTE v_src;
  RAISE NOTICE '✅ bot_booking_chat تُرجع أحدث صفحةٍ فقط.';
END
$chat$;

-- (ب) قاعدةُ الإغلاق: الموقع كان يرفض `cancelled` وحدها بينما البوت يرفض
--     الثلاث ⇒ طلبٌ مكتمل يصير قناة رسائلٍ دائمة على الموقع بلا حدّ.
DO $close$
DECLARE v_src text; v_anchor text := 'IF booking_row.status IN (''cancelled'') THEN';
BEGIN
  v_src := pg_get_functiondef('public.send_booking_message(text,text,text)'::regprocedure);
  IF position('''cancelled'',''completed'',''expired''' IN replace(v_src, ' ', '')) > 0
     OR position('''completed''' IN v_src) > 0 THEN
    RAISE NOTICE 'ℹ️ قاعدةُ الإغلاق موحّدةٌ أصلاً.'; RETURN; END IF;
  IF position(v_anchor IN v_src) = 0 THEN
    RAISE EXCEPTION 'مرساةُ send_booking_message غير موجودة — أوقِفت بلا تغيير.'; END IF;
  v_src := replace(v_src, v_anchor,
    'IF booking_row.status IN (''cancelled'',''completed'',''expired'') THEN');
  v_src := replace(v_src, 'الحجز ملغى — لا يمكن إرسال رسائل',
    'انتهى هذا الطلب — المحادثة للقراءة فقط');
  EXECUTE v_src;
  RAISE NOTICE '✅ قاعدةُ الإغلاق موحّدة بين الموقع والبوتين.';
END
$close$;

-- (ج) شاشةُ مراقبة الأدمن تحمّل خيطاً كاملاً بلا سقف وتستفتي كل ٨ ثوانٍ.
--     تحسينٌ لا ضمان، ولذلك لا يُؤكَّد في كتلة التحقّق.
DO $mon$
DECLARE v_src text;
BEGIN
  v_src := pg_get_functiondef('public.admin_get_thread_messages(text)'::regprocedure);
  IF position('LIMIT' IN upper(v_src)) > 0 THEN RAISE NOTICE 'ℹ️ مقيَّدةٌ أصلاً.'; RETURN; END IF;
  IF position('ORDER BY bm.created_at ASC' IN v_src) = 0 THEN
    RAISE NOTICE '⚠️ مرساةُ admin_get_thread_messages غير موجودة — تُرِكت كما هي.'; RETURN; END IF;
  v_src := replace(v_src, 'ORDER BY bm.created_at ASC', 'ORDER BY bm.created_at ASC LIMIT 500');
  EXECUTE v_src;
  RAISE NOTICE '✅ admin_get_thread_messages مقيَّدة بـ500.';
END
$mon$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١٣) تحقّقٌ يرفع استثناءً — الجدولُ الجميل لا يُفشل psql
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE n int; v_qual text; v_src text; v_ord text[]; i_aa int; i_ab int; i_abz int; i_ac int;
BEGIN
  -- الجدولان والفهارس والسياسات
  IF to_regclass('public.store_verifications') IS NULL
     OR to_regclass('public.store_verification_grace') IS NULL THEN
    RAISE EXCEPTION '❌ الجدولان لم يُنشآ.'; END IF;
  SELECT count(*) INTO n FROM pg_indexes WHERE schemaname='public'
    AND indexname IN ('idx_ver_one_open','idx_ver_one_approved','idx_ver_number','idx_ver_queue','idx_ver_expiry');
  IF n <> 5 THEN RAISE EXCEPTION '❌ الفهارس %/5.', n; END IF;
  SELECT count(*) INTO n FROM pg_policy WHERE polrelid='public.store_verifications'::regclass;
  IF n <> 1 THEN RAISE EXCEPTION '❌ سياسات store_verifications = % (يجب واحدة قراءة فقط).', n; END IF;
  SELECT count(*) INTO n FROM pg_policy WHERE polrelid='public.store_verification_grace'::regclass;
  IF n <> 1 THEN RAISE EXCEPTION '❌ سياسات store_verification_grace = %.', n; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.store_verifications'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.store_verification_grace'::regclass) THEN
    RAISE EXCEPTION '❌ RLS غير مفعّلة على أحد الجدولين.'; END IF;
  -- السياسة تسأل taki_admin_perm لا is_admin
  SELECT pg_get_expr(polqual, polrelid) INTO v_qual FROM pg_policy
   WHERE polrelid='public.store_verifications'::regclass AND polname='ver_select_own';
  IF position('taki_admin_perm' IN v_qual) = 0 OR position('is_admin' IN v_qual) > 0 THEN
    RAISE EXCEPTION '❌ سياسةُ القراءة لا تستعمل taki_admin_perm.'; END IF;

  -- التاجر لا يكتب حالته بنفسه
  IF has_table_privilege('authenticated','public.store_verifications','INSERT')
     OR has_table_privilege('authenticated','public.store_verifications','UPDATE')
     OR has_table_privilege('authenticated','public.store_verifications','DELETE')
     OR has_table_privilege('authenticated','public.store_verification_grace','INSERT')
     OR has_table_privilege('authenticated','public.store_verification_grace','UPDATE') THEN
    RAISE EXCEPTION '❌ `authenticated` ما زال يملك كتابةً مباشرة — الحالةُ مزوَّرة.'; END IF;
  IF has_table_privilege('anon','public.store_verifications','SELECT') THEN
    RAISE EXCEPTION '❌ الزائر المجهول يقرأ طلبات التوثيق.'; END IF;

  -- الدوال موجودة، وبلا منح anon (عدا شارة المشتري وبوّابة البوت)
  FOR v_src IN SELECT x FROM unnest(ARRAY[
      'public.merchant_submit_verification(text,text,text,date)',
      'public.merchant_withdraw_verification()',
      'public.my_verification_state()',
      'public.admin_list_verifications(text,integer,timestamptz)',
      'public.admin_resolve_verification(text,boolean,text,text,text,date,boolean)',
      'public.admin_revoke_verification(text,text)',
      'public.admin_open_verification_grace(timestamptz)',
      'public.admin_verification_stats()',
      'public.admin_sweep_unverified_deals(boolean)',
      'public.taki_publish_block(text)','public.taki_store_verified(text)',
      'public.taki_store_grandfathered(text)','public.taki_verification_mode()']) x
  LOOP
    IF to_regprocedure(v_src) IS NULL THEN RAISE EXCEPTION '❌ الدالة % غير موجودة.', v_src; END IF;
    IF has_function_privilege('anon', v_src::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '❌ anon يملك تنفيذ % — فحصٌ سالب فشل.', v_src; END IF;
    IF NOT has_function_privilege('authenticated', v_src::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '❌ authenticated لا يملك تنفيذ %.', v_src; END IF;
  END LOOP;
  IF NOT has_function_privilege('anon','public.bot_publish_gate(bigint,text)','EXECUTE') THEN
    RAISE EXCEPTION '❌ البوتان لا يصلان bot_publish_gate.'; END IF;
  IF NOT has_function_privilege('anon','public.store_is_verified(text)','EXECUTE') THEN
    RAISE EXCEPTION '❌ الزائر لا يقرأ شارة التوثيق.'; END IF;

  -- 🔴 الفحص السالب الأهمّ: `store_can_sell` لم تُمسّ، وما زالت مفتوحة للزائر.
  SELECT pg_get_functiondef('public.store_can_sell(text)'::regprocedure) INTO v_src;
  IF position('not_verified' IN v_src) > 0 OR position('taki_store_verified' IN v_src) > 0 THEN
    RAISE EXCEPTION '❌ دخل التوثيق إلى store_can_sell — هذا يُوقف الحجز على كل عرضٍ حيّ.'; END IF;
  IF NOT has_function_privilege('anon','public.store_can_sell(text)','EXECUTE') THEN
    RAISE EXCEPTION '❌ store_can_sell فقدت منح anon — صفحةُ العرض ستنكسر.'; END IF;

  -- المشغّلان + ترتيبُهما الحيّ (لا نصدّق حجّةَ ترتيبٍ نظرية)
  SELECT array_agg(tgname ORDER BY tgname) INTO v_ord FROM pg_trigger
   WHERE tgrelid='public.deals'::regclass AND NOT tgisinternal;
  i_aa  := array_position(v_ord,'tr_aa_guard_deal_merchant');
  i_ab  := array_position(v_ord,'tr_ab_guard_suspended_publish');
  i_abz := array_position(v_ord,'tr_abz_guard_publish_needs_verification');
  i_ac  := array_position(v_ord,'tr_ac_publish_needs_declaration');
  IF i_aa IS NULL OR i_abz IS NULL THEN RAISE EXCEPTION '❌ أحد المشغّلين لم يُركَّب.'; END IF;
  IF i_ab IS NOT NULL AND NOT (i_aa < i_ab AND i_ab < i_abz) THEN
    RAISE EXCEPTION '❌ ترتيب المشغّلات خاطئ: الموقوف سيُقال له «غير موثّق». (%)', v_ord; END IF;
  IF i_ac IS NOT NULL AND NOT (i_abz < i_ac) THEN
    RAISE EXCEPTION '❌ حارس التوثيق بعد حارس الإقرار — سيصمت وتُحوَّل العروض إلى مسوّدات. (%)', v_ord; END IF;

  SELECT pg_get_functiondef('public.taki_guard_publish_needs_verification()'::regprocedure) INTO v_src;
  IF position('P0024' IN v_src) = 0 THEN RAISE EXCEPTION '❌ الحارس لا يرفع P0024.'; END IF;
  IF position('OLD.status' IN v_src) = 0 THEN RAISE EXCEPTION '❌ سقط تخطّي العرض الحيّ — ستُقتل عروضٌ قائمة.'; END IF;
  IF position('item_name' IN v_src) = 0 THEN RAISE EXCEPTION '❌ سقط فحصُ تغيّر المحتوى — العرضُ المُعفى يصير منفذَ نشرٍ دائماً.'; END IF;
  SELECT pg_get_functiondef('public.taki_guard_deal_merchant()'::regprocedure) INTO v_src;
  IF position('P0022' IN v_src) = 0 THEN RAISE EXCEPTION '❌ حارس «ليس تاجراً» لا يرفع P0022.'; END IF;
  IF position('taki_admin_perm' IN v_src) = 0 THEN RAISE EXCEPTION '❌ الأدمن غير مستثنى — «إعادة عرض» ستنفجر.'; END IF;

  -- حارسا العمودين
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.store_profiles'::regclass AND tgname='tr_ad_guard_store_cr')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.users'::regclass AND tgname='tr_ae_guard_user_created_at') THEN
    RAISE EXCEPTION '❌ أحد حارسَي العمودين لم يُركَّب.'; END IF;
  SELECT count(*) INTO n FROM public.store_profiles WHERE cr_number IS NOT NULL;
  IF n <> 0 THEN RAISE EXCEPTION '❌ بقي % رقم سجلٍّ مكتوبٌ يدوياً — الحارس سيرفض كل حفظ ملفٍّ.', n; END IF;

  -- صلاحياتُ الأدمن في القاعدة (بلا هذه الصفوف `is_admin()` تفشل مفتوحة)
  SELECT count(*) INTO n FROM public.admin_rpc_permissions
   WHERE required_perm='tab_verification'
     AND rpc_name IN ('admin_list_verifications','admin_resolve_verification','admin_revoke_verification',
                      'admin_open_verification_grace','admin_verification_stats','admin_sweep_unverified_deals');
  IF n <> 6 THEN RAISE EXCEPTION '❌ صفوف admin_rpc_permissions = %/6.', n; END IF;

  -- الإعداد مقروء، وما كان مسموحاً لم يضع
  SELECT pg_get_expr(polqual, polrelid) INTO v_qual FROM pg_policy
   WHERE polrelid='public.platform_settings'::regclass AND polname='platform_settings_select';
  IF v_qual IS NULL OR position('''verification''' IN v_qual) = 0 THEN
    RAISE EXCEPTION '❌ verification محجوبٌ عن القراءة — الواجهة سترتدّ للافتراضي بصمت.'; END IF;
  IF position('''merchant_vat''' IN v_qual) = 0 OR position('''booking_holds''' IN v_qual) = 0
     OR position('''chat_limits''' IN v_qual) = 0 OR position('''complaints_sla_hours''' IN v_qual) = 0 THEN
    RAISE EXCEPTION '❌ فُقدت مفاتيح كانت مسموحة — تراجَعْ فوراً.'; END IF;
  IF public.taki_verification_mode() <> 'off' THEN
    RAISE EXCEPTION '❌ الوضع الافتراضي ليس off — الهجرة يجب أن تهبط بأثرٍ صفر.'; END IF;

  -- الخصوصية
  SELECT pg_get_functiondef('public.purge_expired_accounts()'::regprocedure) INTO v_src;
  IF position('store_verifications' IN v_src) = 0 OR position('booking_messages' IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ التجهيل لا يشمل الجدولين.'; END IF;

  -- فجوتا v14.93
  SELECT pg_get_functiondef('public.bot_booking_chat(bigint,text,text)'::regprocedure) INTO v_src;
  IF position('bot_page' IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ bot_booking_chat ما زالت بلا سقف — شاشة تيليجرام ستفرغ بصمت.'; END IF;
  SELECT pg_get_functiondef('public.send_booking_message(text,text,text)'::regprocedure) INTO v_src;
  IF position('''completed''' IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ قاعدةُ الإغلاق ما زالت مفترقة — الطلب المكتمل قناةٌ دائمة.'; END IF;

  -- الكرون
  SELECT count(*) INTO n FROM cron.job WHERE jobname IN ('taki-verification-expiry','taki-verification-sla');
  IF n <> 2 THEN RAISE EXCEPTION '❌ مهمّتا الكرون %/2.', n; END IF;

  RAISE NOTICE '✅ v14.94 هبطت بأثرٍ صفر: الوضع off · الحارسان مركَّبان بالترتيب الصحيح · store_can_sell لم تُمسّ · التجهيل يشمل التوثيق والمحادثات.';
END
$verify$;