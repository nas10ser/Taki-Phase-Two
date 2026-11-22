-- ════════════════════════════════════════════════════════════════════════════
-- v16.52 — أنواعُ وثيقة التوثيق مفاتيحُ أدمن · وشروطُ كلِّ نوعٍ بحسب نظامه
--           · ومحاولةُ رقمٍ مستعملٍ تُمنع وتُسجَّل وتُعرض على الأدمن
-- ════════════════════════════════════════════════════════════════════════════
-- أمرُ ناصر (٢٠ نوفمبر ٢٠٢٦، ثلاثةُ بنود):
--   ① «أريد خياراتٍ في حساب الأدمن أقدر أخلّي أيّ وحدة من الثلاث تظهر: السجل
--      التجاري، منصّة الأعمال، وثيقة العمل الحر — على غرار مفتاح بوت تيليجرام.
--      لأني قد أبدأ فقط بالسجل التجاري وبعدها منصّة الأعمال.»
--   ② «وتأكّد من كلّ واحدةٍ وشروطها: وثيقةُ العمل الحر يحتاج لها تاريخ انتهاء
--      فتُعطي التاجرَ المبادرةَ بالتحديث قبل انتهائه — وهذا مثالٌ فقط، تحقّق
--      من الثلاثة.»
--   ③ «في حال أراد شخصٌ إضافةَ وثيقةٍ وهي مضافةٌ [لمتجرٍ آخر] فلا يُسمح له،
--      ويأتي الأدمنَ تنبيهٌ في خانةٍ داخل حسابه ليتحقّق.»
--
-- ── ما قِيس على الإنتاج قبل كتابة سطرٍ واحد (٢٠ نوفمبر) ────────────────────
--   · `platform_settings.verification` = {mode, vacation, sla_hours, show_badge}
--     — **بلا أيّ قائمةِ أنواعٍ مسموحة**، و`merchant_submit_verification` تقبل
--     الثلاثة دائماً. فالمفتاحُ غيرُ موجودٍ أصلاً، لا معطَّل.
--   · `store_verifications` **صفرُ صفّ** ⇒ لا بياناتٍ تتأثّر، والتغييرُ آمن.
--   · `doc_expiry` **اختياريٌّ للثلاثة**، فوثيقةُ عملٍ حرٍّ بلا تاريخ لا يصلها
--     تنبيهٌ أبداً ولا تنتهي أبداً — وهو بالضبط ما لاحظه ناصر.
--   · `NUMBER_TAKEN` يمنع مقابل `approved` **وحدها** ⇒ شخصان يُرسلان نفس الرقم
--     في نفس الوقت يمرّان كلاهما، ويبتّ المراجعُ بينهما بلا أن ينبّهه شيء.
--   · 🔴 و`taki_wathq_confirmation_sweep` — الدالّةُ التي ترصد **التأكيد
--     السنويّ للسجل التجاري**، وهو الإشارةُ الوحيدةُ الباقية بعد أن ألغت وزارةُ
--     التجارة تاريخَ الانتهاء — **ليست مجدولةً في الكرون إطلاقاً**: كُتبت ولم
--     تعمل ولا مرّة. (قِيس: ٣٩ وظيفةً في `cron.job`، لا واحدةَ تناديها.)
--
-- ── شروطُ كلّ نوعٍ كما ينصّ عليه نظامُه، لا كما نظنّ ───────────────────────
--   · **السجل التجاري**: لا تاريخَ انتهاءٍ له. نصُّ وزارة التجارة في إعلان
--     نظام السجل التجاري الجديد: «إلغاء تاريخ الانتهاء للسجل التجاري،
--     والاكتفاء بالتأكيد السنوي للبيانات». ⇒ الحقلُ يُلغى لهذا النوع،
--     والمراقبةُ عبر `confirmation_due` من واثق.
--   · **وثيقة العمل الحر**: لها انتهاءٌ حقيقيّ ⇒ التاريخُ **إلزاميّ**.
--   · **منصّة الأعمال**: لا مصدرَ رسميّ يقطع بوجود انتهاءٍ أو عدمه ⇒ اختياريّ،
--     وإن كُتب فيجب أن يكون مستقبلياً. **ولا يُخترع له رقمُ مدّة** (أمرُ ناصر).
--
-- 🪤 ولا تُكتب مدّةٌ برقمٍ في أيّ نصٍّ ظاهرٍ هنا: عتباتُ التنبيه تبقى حيث هي
--    في `taki_expire_verifications`، والنصُّ يُصاغ من `taki_ar_days`.
-- ════════════════════════════════════════════════════════════════════════════

-- ── ⓪ حارسُ الخادم: لا تُنفَّذ على المختبر (طوكيو) ─────────────────────────
DO $guard$
BEGIN
    IF obj_description('public'::regnamespace, 'pg_namespace')
       = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
        RAISE EXCEPTION 'هذه هجرةُ إنتاج — الخادمُ أمامها هو المختبر (طوكيو). أوقِف.';
    END IF;
END $guard$;

-- ════════════════════════════════════════════════════════════════════════════
-- ① سياسةُ التوثيق تحمل أنواعَها — وافتراضُها **الثلاثةُ مفعّلة**
-- ════════════════════════════════════════════════════════════════════════════
-- 🪤 الافتراضُ هو الحالةُ القائمة بالضبط: مفتاحٌ غائبٌ عن `platform_settings`
--    لا يُطفئ شيئاً. فلو أُسقطت هذه الهجرةُ على خادمٍ لم تصله شاشةُ الأدمن بعد
--    بقي كلُّ شيءٍ كما هو. (وعكسُها — الافتراضُ مُطفأ — كان يُغلق التوثيقَ
--    كلَّه لحظةَ التطبيق بلا أن يطلب أحد.)
CREATE OR REPLACE FUNCTION public.taki_verification_policy()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'mode', COALESCE((SELECT CASE WHEN value->>'mode' IN ('off','advisory','required')
                                  THEN value->>'mode' END
                        FROM public.platform_settings WHERE key='verification'), 'off'),
    'sla_hours', GREATEST(1, LEAST(720, COALESCE((
        SELECT floor((value->>'sla_hours')::numeric)::int FROM public.platform_settings
         WHERE key='verification' AND jsonb_typeof(value->'sla_hours')='number'), 24))),
    'vacation',  COALESCE((SELECT value->'vacation'   = 'true'::jsonb FROM public.platform_settings WHERE key='verification'), false),
    'show_badge',COALESCE((SELECT value->'show_badge' = 'true'::jsonb FROM public.platform_settings WHERE key='verification'), false),
    -- أنواعُ الوثيقة المتاحةُ للتاجر — مفتاحٌ لكلٍّ منها، افتراضُه مفعَّل.
    'kinds', jsonb_build_object(
      'cr',          COALESCE((SELECT value->'kinds'->'cr'          = 'false'::jsonb FROM public.platform_settings WHERE key='verification'), false) IS NOT TRUE,
      'business_sa', COALESCE((SELECT value->'kinds'->'business_sa' = 'false'::jsonb FROM public.platform_settings WHERE key='verification'), false) IS NOT TRUE,
      'freelance',   COALESCE((SELECT value->'kinds'->'freelance'   = 'false'::jsonb FROM public.platform_settings WHERE key='verification'), false) IS NOT TRUE)
  );
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- ② خانةُ الأدمن: محاولاتُ استعمال رقمٍ موثَّقٍ لمتجرٍ آخر
-- ════════════════════════════════════════════════════════════════════════════
-- 🪤 صفٌّ واحدٌ لكلّ (متجر × نوع × رقم) لا صفٌّ لكلّ ضغطة: محاولةٌ مكرّرةٌ
--    تَزيد العدّاد ولا تُغرق الخانةَ ولا تُعيد الإشعار. (درس «الإنذارُ الذي
--    لا يُفعل به شيء ضجيج» — v15.24.)
CREATE TABLE IF NOT EXISTS public.verification_dup_attempts (
    id            text PRIMARY KEY DEFAULT ('vda_' || replace(gen_random_uuid()::text,'-','')),
    store_id      text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    doc_kind      text NOT NULL CHECK (doc_kind IN ('business_sa','cr','freelance')),
    doc_number    text NOT NULL,
    claimed_name  text,
    -- صاحبُ الرقم وقتَ المحاولة — لقطةٌ للعرض، والرابطُ هو `owner_store_id`.
    owner_store_id text,
    owner_shop    text,
    owner_status  text,
    attempts      integer NOT NULL DEFAULT 1,
    status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed')),
    admin_id      text,
    admin_note    text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_at       timestamptz NOT NULL DEFAULT now(),
    decided_at    timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vda_unique
    ON public.verification_dup_attempts (store_id, doc_kind, lower(btrim(doc_number)));
CREATE INDEX IF NOT EXISTS idx_vda_open
    ON public.verification_dup_attempts (last_at DESC) WHERE status = 'open';

-- 🔴 الجدولُ الجديد يُولد بكلّ DML ممنوحاً لـ`authenticated` افتراضياً على
--    سوبابيس — فلا يكفي `REVOKE ... FROM PUBLIC` (درسُ v14.25 وv15.81).
ALTER TABLE public.verification_dup_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.verification_dup_attempts FROM PUBLIC;
REVOKE ALL ON public.verification_dup_attempts FROM anon;
REVOKE ALL ON public.verification_dup_attempts FROM authenticated;
GRANT SELECT ON public.verification_dup_attempts TO authenticated;

-- قراءةٌ للأدمن صاحب صلاحية التوثيق وحده — ولا سياسةَ كتابةٍ إطلاقاً:
-- كلُّ كتابةٍ تمرّ بدوال SECURITY DEFINER أدناه.
DROP POLICY IF EXISTS vda_select_admin ON public.verification_dup_attempts;
CREATE POLICY vda_select_admin ON public.verification_dup_attempts
    FOR SELECT TO authenticated
    USING ((SELECT public.taki_admin_perm('tab_verification')));

-- ════════════════════════════════════════════════════════════════════════════
-- ③ إرسالُ طلب التوثيق — المفاتيحُ، وشروطُ التاريخ، وتسجيلُ التكرار
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.merchant_submit_verification(
    p_kind text, p_number text, p_legal_name text, p_expiry date DEFAULT NULL::date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid text := (SELECT auth.uid())::text; v_t text; v_shop text;
        v_num text := btrim(COALESCE(p_number,'')); v_name text := btrim(COALESCE(p_legal_name,''));
        v_id text; v_kinds jsonb; v_expiry date := p_expiry;
        v_owner record; v_first boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT user_type, shop INTO v_t, v_shop FROM public.users WHERE id = v_uid AND deleted_at IS NULL;
  IF v_t IS NULL OR (v_t NOT IN ('seller','admin') AND NULLIF(btrim(COALESCE(v_shop,'')),'') IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_A_MERCHANT');
  END IF;
  IF p_kind NOT IN ('business_sa','cr','freelance') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_KIND'); END IF;

  -- ── أ) مفاتيحُ الأدمن: نوعٌ مطفأٌ لا يُقبل، وإطفاءُ الثلاثة يُغلق البابَ صراحةً
  v_kinds := public.taki_verification_policy()->'kinds';
  IF NOT (v_kinds->>'cr' = 'true' OR v_kinds->>'business_sa' = 'true' OR v_kinds->>'freelance' = 'true') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VERIFICATION_CLOSED'); END IF;
  IF COALESCE(v_kinds->>p_kind,'false') <> 'true' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'KIND_DISABLED'); END IF;

  -- 🪤 فحصُ الشكل **مرشّحُ أخطاءٍ مطبعية لا إثبات**: لا خانة تدقيق منشورة لأي
  --    سجلٍّ سعودي، و`^7[0-9]{9}$` كانت سترفض سجلات `1010…/4030…` السارية.
  IF p_kind = 'cr'        AND v_num !~ '^[0-9]{10}$'   THEN RETURN jsonb_build_object('ok', false, 'error', 'BAD_NUMBER'); END IF;
  IF p_kind = 'business_sa' AND v_num !~ '^[0-9]{5,14}$' THEN RETURN jsonb_build_object('ok', false, 'error', 'BAD_NUMBER'); END IF;
  IF p_kind = 'freelance' AND length(v_num) < 4        THEN RETURN jsonb_build_object('ok', false, 'error', 'BAD_NUMBER'); END IF;
  IF length(v_name) < 3 THEN RETURN jsonb_build_object('ok', false, 'error', 'BAD_NAME'); END IF;

  -- ── ب) شرطُ التاريخ بحسب نظام كلّ وثيقة ───────────────────────────────────
  -- السجلُّ التجاريّ: ألغت وزارةُ التجارة تاريخَ الانتهاء في نظام السجل التجاري
  -- الجديد («إلغاء تاريخ الانتهاء للسجل التجاري، والاكتفاء بالتأكيد السنوي
  -- للبيانات») ⇒ أيُّ تاريخٍ يصل هنا لهذا النوع يُهمَل، ولا يُخزَّن رقمٌ كاذب.
  IF p_kind = 'cr' THEN
    v_expiry := NULL;
  ELSIF p_kind = 'freelance' THEN
    -- وثيقةُ العمل الحر تنتهي فعلاً، والتنبيهُ المبكّر مبنيٌّ على هذا الحقل
    -- وحده — فبلا تاريخٍ لا تنبيهَ أبداً ولا انتهاءَ أبداً.
    IF v_expiry IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'EXPIRY_REQUIRED'); END IF;
  END IF;
  IF v_expiry IS NOT NULL AND v_expiry <= current_date THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EXPIRY_PAST'); END IF;

  IF EXISTS (SELECT 1 FROM public.store_verifications WHERE store_id = v_uid AND status = 'submitted') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_PENDING'); END IF;

  -- ── حدُّ المعدّل **قبل** فحص التكرار، لا بعده ─────────────────────────────
  -- 🔴 وهذا تصحيحٌ لترتيبٍ كتبتُه أوّلاً خطأً: الفحصُ التالي يردّ `NUMBER_TAKEN`
  --    فيكشف **أن رقماً بعينه موثَّقٌ في تاكي**، ويكتب صفّاً ويُنبّه الأدمن.
  --    فلو جاء الحدُّ بعده لاستطاع أحدٌ تجربةَ أرقامٍ بلا سقفٍ ليعرف أيُّها
  --    مسجَّل، **ولأغرق خانةَ الأدمن** بضجيجٍ يُدرّب على تجاهلها (درس v15.24).
  --    وفحوصُ الشكل أعلاه لا تستهلك الحصّة: لا تكشف شيئاً ولا تكتب شيئاً،
  --    وخطأٌ مطبعيٌّ من تاجرٍ شرعيّ يجب ألّا يحرق محاولته.
  --    ٣ محاولات في اليوم: طابورٌ يُغرق أسرعَ ممّا يُفرَّغ يجعل مهلةَ المراجعة كذبة.
  BEGIN
    PERFORM public.taki_rate_check('ver:' || v_uid, 3, 86400, 'RATE_LIMIT');
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TOO_MANY');
  END;

  -- ── ج) رقمٌ يخصّ متجراً آخر: يُمنع · ويُسجَّل · ويُنبَّه عليه الأدمن ────────
  -- 🔴 وكان الشرطُ `status = 'approved'` وحدها، فطلبان متزامنان بنفس الرقم
  --    يمرّان كلاهما ويبتّ المراجعُ بينهما بلا إنذار. الآن المفتوحُ يحجز أيضاً.
  SELECT v.store_id, v.status, u.shop INTO v_owner
    FROM public.store_verifications v
    LEFT JOIN public.users u ON u.id = v.store_id
   WHERE v.status IN ('approved','submitted') AND v.store_id <> v_uid
     AND v.doc_kind = p_kind AND lower(btrim(v.doc_number)) = lower(v_num)
   ORDER BY CASE v.status WHEN 'approved' THEN 0 ELSE 1 END
   LIMIT 1;

  IF v_owner.store_id IS NOT NULL THEN
    INSERT INTO public.verification_dup_attempts
        (store_id, doc_kind, doc_number, claimed_name, owner_store_id, owner_shop, owner_status)
    VALUES (v_uid, p_kind, v_num, v_name, v_owner.store_id, v_owner.shop, v_owner.status)
    ON CONFLICT (store_id, doc_kind, lower(btrim(doc_number))) DO UPDATE
       SET attempts = public.verification_dup_attempts.attempts + 1,
           last_at  = now(),
           claimed_name = EXCLUDED.claimed_name,
           owner_store_id = EXCLUDED.owner_store_id,
           owner_shop = EXCLUDED.owner_shop,
           owner_status = EXCLUDED.owner_status,
           -- محاولةٌ جديدةٌ بعد البتّ تُعيد فتح الصفّ: الأدمنُ يرى أنها تكرّرت.
           status = CASE WHEN public.verification_dup_attempts.status = 'dismissed'
                         THEN 'dismissed' ELSE 'open' END
    RETURNING (xmax = 0) INTO v_first;

    -- إشعارٌ **مرّةً واحدة** عند أوّل محاولة — لا جرسٌ لكلّ ضغطة.
    IF COALESCE(v_first, false) THEN
      INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
      SELECT u.id, '🚨 محاولةُ توثيقٍ برقمٍ مستعمل', '🚨 Duplicate document attempt',
             'متجر «' || COALESCE(NULLIF(v_shop,''),'متجر') || '» حاول التوثيق برقمٍ مسجَّلٍ لمتجرٍ آخر — راجِع «محاولات مكرّرة».',
             'A merchant tried to verify with a document number that belongs to another store.',
             'system',
             jsonb_build_object('audience','admin',
                                'actionUrl','/admin?tab=verification','action_url','/admin?tab=verification')
        FROM public.users u
       WHERE u.user_type = 'admin' AND u.deleted_at IS NULL
         AND (COALESCE(u.is_super_admin,false) OR 'tab_verification' = ANY(COALESCE(u.admin_permissions,'{}'::text[])));
    END IF;

    RETURN jsonb_build_object('ok', false, 'error', 'NUMBER_TAKEN');
  END IF;

  INSERT INTO public.store_verifications (store_id, doc_kind, doc_number, claimed_name, doc_expiry)
  VALUES (v_uid, p_kind, v_num, v_name, v_expiry)
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
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- ④ حالةُ التاجر تحمل الأنواعَ المتاحة — فلا تعرض شاشتُه خياراً يرفضه الخادم
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.my_verification_state()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid text := (SELECT auth.uid())::text; v_t text; v_shop text; r record; g timestamptz;
        v_pol jsonb;
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
  v_pol := public.taki_verification_policy();
  RETURN jsonb_build_object(
    'mode', public.taki_verification_mode(),
    'sla_hours', (v_pol->>'sla_hours')::int,
    'verified', public.taki_store_verified(v_uid),
    'grace_until', g,
    'status', COALESCE(r.status,'none'), 'doc_kind', r.doc_kind, 'doc_number', r.doc_number,
    'legal_name', r.legal_name, 'claimed_name', r.claimed_name, 'doc_expiry', r.doc_expiry,
    'confirmation_due', r.confirmation_due,
    'reject_code', r.reject_code, 'admin_note', r.admin_note,
    'submitted_at', r.submitted_at, 'decided_at', r.decided_at,
    'kinds', v_pol->'kinds',
    'has_open', EXISTS (SELECT 1 FROM public.store_verifications WHERE store_id = v_uid AND status = 'submitted'));
END
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑤ دوالُّ خانة الأدمن
-- ════════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.admin_list_dup_attempts(text, integer);
CREATE FUNCTION public.admin_list_dup_attempts(p_status text DEFAULT 'open', p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_rows jsonb;
BEGIN
  IF NOT (SELECT public.taki_admin_perm('tab_verification')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'last_at' DESC), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object(
             'id', a.id, 'store_id', a.store_id, 'shop', su.shop,
             'owner_name', su.name, 'owner_phone', su.phone,
             'doc_kind', a.doc_kind, 'doc_number', a.doc_number, 'claimed_name', a.claimed_name,
             'owner_store_id', a.owner_store_id,
             'owner_shop', COALESCE(a.owner_shop, ou.shop),
             'owner_status', a.owner_status,
             'attempts', a.attempts, 'status', a.status,
             'admin_note', a.admin_note,
             'created_at', a.created_at, 'last_at', a.last_at, 'decided_at', a.decided_at) AS x
      FROM public.verification_dup_attempts a
      LEFT JOIN public.users su ON su.id = a.store_id
      LEFT JOIN public.users ou ON ou.id = a.owner_store_id
     WHERE (p_status IS NULL OR p_status = 'all' OR a.status = p_status)
     ORDER BY a.last_at DESC
     LIMIT GREATEST(1, LEAST(500, COALESCE(p_limit, 100)))
  ) s;
  RETURN jsonb_build_object('ok', true, 'rows', v_rows,
      'open', (SELECT count(*) FROM public.verification_dup_attempts WHERE status = 'open'));
END
$function$;

DROP FUNCTION IF EXISTS public.admin_resolve_dup_attempt(text, text, text);
CREATE FUNCTION public.admin_resolve_dup_attempt(p_id text, p_action text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid text := (SELECT auth.uid())::text; v_n integer;
BEGIN
  IF NOT (SELECT public.taki_admin_perm('tab_verification')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('reviewed','dismissed','open') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_ACTION'); END IF;
  UPDATE public.verification_dup_attempts
     SET status = p_action, admin_id = v_uid,
         admin_note = NULLIF(btrim(COALESCE(p_note,'')),''),
         decided_at = CASE WHEN p_action = 'open' THEN NULL ELSE now() END
   WHERE id = p_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok', true, 'status', p_action);
END
$function$;

-- 🔴 المنحُ صريحٌ في الاتجاهين: `REVOKE … FROM PUBLIC` لا يُلغي منحَ `anon`
--    المباشر على الدوال الجديدة، ولا العكس (درس v14.26).
REVOKE ALL ON FUNCTION public.admin_list_dup_attempts(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_resolve_dup_attempt(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_dup_attempts(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_dup_attempt(text, text, text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑥ 🔴 جدولةُ مسحِ التأكيد السنويّ — كُتبت الدالّةُ ولم تُنادَ ولا مرّة
-- ════════════════════════════════════════════════════════════════════════════
-- بعد إلغاء تاريخ انتهاء السجل التجاري، التأكيدُ السنويُّ هو الإشارةُ الوحيدة.
-- و`taki_expire_verifications` تقرأ `doc_expiry` وحده ⇒ تاجرُ السجل التجاري
-- لا يصله تنبيهٌ أبداً من ذلك المسار. (٣:٥٠ فجراً بتوقيت الرياض — الخادمُ على
-- ‎+03:00، وبعد مسح الانتهاء ‎1:20 وقبل تحديثات الأمان ‎4:30.)
DO $cron$
BEGIN
    PERFORM cron.unschedule('taki-verification-confirmation');
EXCEPTION WHEN OTHERS THEN NULL;
END $cron$;
SELECT cron.schedule('taki-verification-confirmation', '50 3 * * *',
                     $$SELECT public.taki_wathq_confirmation_sweep();$$);

-- ════════════════════════════════════════════════════════════════════════════
-- ⑦ التحقّق — `DO` يرفع استثناءً، لا جدولُ ✅/❌ لا يُفشل psql (درس v14.51)
-- ════════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE v jsonb; v_n integer;
BEGIN
    -- (أ) السياسةُ تحمل الأنواعَ الثلاثة، وكلُّها مفعّلةٌ افتراضاً
    v := public.taki_verification_policy();
    IF v->'kinds' IS NULL THEN RAISE EXCEPTION 'الفحص ①: السياسةُ بلا kinds'; END IF;
    IF NOT (v->'kinds'->>'cr' = 'true' AND v->'kinds'->>'business_sa' = 'true'
            AND v->'kinds'->>'freelance' = 'true') THEN
        RAISE EXCEPTION 'الفحص ①: الافتراضُ ليس «الثلاثةُ مفعّلة» — %', v->'kinds';
    END IF;

    -- (ب) إطفاءُ نوعٍ يُقرأ فعلاً من `platform_settings` (يُجرَّب ثمّ يُعاد)
    UPDATE public.platform_settings
       SET value = jsonb_set(COALESCE(value,'{}'::jsonb), '{kinds}', '{"freelance":false}'::jsonb, true)
     WHERE key = 'verification';
    v := public.taki_verification_policy();
    IF v->'kinds'->>'freelance' <> 'false' THEN
        RAISE EXCEPTION 'الفحص ②: إطفاءُ وثيقة العمل الحر لم يُقرأ — %', v->'kinds';
    END IF;
    IF v->'kinds'->>'cr' <> 'true' THEN
        RAISE EXCEPTION 'الفحص ②ب: إطفاءُ نوعٍ أطفأ غيرَه — %', v->'kinds';
    END IF;
    UPDATE public.platform_settings SET value = value - 'kinds' WHERE key = 'verification';
    IF (public.taki_verification_policy()->'kinds'->>'freelance') <> 'true' THEN
        RAISE EXCEPTION 'الفحص ②ج: لم تُستعد الحالة';
    END IF;

    -- (ج) الخانةُ موجودةٌ ومقفلةٌ: لا سياسةَ كتابةٍ إطلاقاً
    SELECT count(*) INTO v_n FROM pg_policy
     WHERE polrelid = 'public.verification_dup_attempts'::regclass AND polcmd <> 'r';
    IF v_n <> 0 THEN RAISE EXCEPTION 'الفحص ③: سياسةُ كتابةٍ على خانة المحاولات (%)', v_n; END IF;
    IF has_table_privilege('authenticated','public.verification_dup_attempts','INSERT') THEN
        RAISE EXCEPTION 'الفحص ③ب: `authenticated` يملك INSERT على خانة المحاولات';
    END IF;
    IF has_table_privilege('anon','public.verification_dup_attempts','SELECT') THEN
        RAISE EXCEPTION 'الفحص ③ج: `anon` يقرأ خانة المحاولات';
    END IF;

    -- (د) الدالّتان مُنشأتان ومُجازتان لـ`authenticated` وحده
    IF has_function_privilege('anon','public.admin_list_dup_attempts(text,integer)','EXECUTE') THEN
        RAISE EXCEPTION 'الفحص ④: `anon` ينفّذ admin_list_dup_attempts';
    END IF;

    -- (هـ) مسحُ التأكيد السنويّ مجدولٌ الآن
    SELECT count(*) INTO v_n FROM cron.job
     WHERE jobname = 'taki-verification-confirmation' AND active;
    IF v_n <> 1 THEN RAISE EXCEPTION 'الفحص ⑤: مسحُ التأكيد السنويّ غيرُ مجدول'; END IF;

    -- (و) `my_verification_state` تُعيد الأنواع (تُنادى بلا جلسة ⇒ NULL، فيُقاس نصُّها)
    IF position('''kinds''' IN pg_get_functiondef('public.my_verification_state'::regproc)) = 0 THEN
        RAISE EXCEPTION 'الفحص ⑥: حالةُ التاجر لا تحمل kinds';
    END IF;

    RAISE NOTICE '✅ v16.52 — كلُّ الفحوص الستّة نجحت على %', inet_server_addr();
END $verify$;

SELECT 'الخادم'  AS "البند", COALESCE(host(inet_server_addr()),'محلّي') AS "القيمة"
UNION ALL SELECT 'أنواعُ الوثيقة', (public.taki_verification_policy()->'kinds')::text
UNION ALL SELECT 'خانةُ المحاولات', (SELECT count(*)::text FROM public.verification_dup_attempts)
UNION ALL SELECT 'كرونُ التأكيد', (SELECT schedule FROM cron.job WHERE jobname='taki-verification-confirmation');
