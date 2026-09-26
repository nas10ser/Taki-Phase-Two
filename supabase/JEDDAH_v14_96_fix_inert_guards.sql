-- ═══════════════════════════════════════════════════════════════════════════
-- v14.96 — أربعةُ حرّاسٍ كانت **بلا أثر إطلاقاً**: `current_user` داخل DEFINER
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 العيب، مقيساً لا مستنتَجاً:
--    حرّاسُ v14.95 الأربعة تبدأ كلُّها بسطرٍ يعفي «دور النظام»:
--        IF current_user IN ('postgres','supabase_admin','service_role') THEN RETURN NEW;
--    وكلُّها `SECURITY DEFINER` مملوكةٌ لـ`supabase_admin`.
--    و**داخل دالّة DEFINER يكون `current_user` هو مالكُ الدالة لا المنادي**.
--    فالشرطُ يتحقّق في كل نداء، ويعود الحارس فوراً، ولا يمنع أحداً أبداً.
--
--    القياس على قاعدةٍ حيّة (مختبر طوكيو، بدور `authenticated`):
--        DEFINER : current_user=postgres      · session_user=postgres
--        INVOKER : current_user=authenticated · session_user=postgres
--    والاختبار الوظيفيّ: تاجرٌ **غير موثّق** نشر عرضاً `active` والوضع
--    `required` — أي أن بوّابة التوثيق كلّها كانت زينةً. ومثلُها قفلُ
--    `cr_number` وحارسُ `created_at` وحارسُ «ليس تاجراً».
--
-- 🪤 ولماذا انخدع النمط: الحارسُ القديم `tr_guard_user_privileges` يستعمل
--    `current_user` **وهو يعمل** — لأنه `SECURITY INVOKER`. فنُسخ الشرطُ ولم
--    يُنسخ وضعُ الأمان معه. **أي شرطٍ على هويّة المنادي داخل DEFINER يُكتب
--    بـ`session_user` أو بمطالبات الطلب، لا بـ`current_user`.**
--
-- 🪤 وحارسٌ «مركَّب» ليس حارساً «يعضّ»: تحقّقُ v14.95 أثبت وجود المشغّلات
--    وترتيبَها، ولم يُثبت أنها ترفض شيئاً. فهذا الملفّ يختبر **السلوك**:
--    يفتعل تاجراً غير موثّقٍ بدور `authenticated` ويشترط أن يُرفض.
--
-- القياس المرجعيّ لأدوار الاتصال الحيّة على جدّة:
--    supabase_admin ×10 (إدارة وكرون) · authenticator ×2 (كل طلبات الويب والبوت)
--    ⇒ فطلبُ المستخدم `session_user='authenticator'`، وعملُ النظام
--      `session_user IN ('postgres','supabase_admin')`. وخدمةُ `service_role`
--      تصل بـ`authenticator` أيضاً فتُميَّز بمطالبة `role` في الطلب.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── حارس: هذه هجرة إنتاج (جدّة) ────────────────────────────────────────────
DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) المميِّز الصحيح: «هل المنادي هو النظام لا مستخدم؟»
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.taki_is_system_caller()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_role text;
BEGIN
  -- `session_user` هو الدور الذي **اتّصلت** به الجلسة، ولا يغيّره
  -- `SET ROLE` ولا `SECURITY DEFINER`. وهو وحده ما يفرّق بين كرونٍ يعمل
  -- على الخادم وبين متصفّحٍ على الإنترنت.
  IF session_user IN ('postgres', 'supabase_admin') THEN RETURN true; END IF;

  -- خدمةٌ تحمل مفتاح `service_role` تصل بنفس اتصال PostgREST
  -- (`authenticator`)، فتُميَّز بمطالبة الدور في الطلب لا بدور الاتصال.
  BEGIN
    v_role := current_setting('request.jwt.claims', true)::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_role := NULL;   -- مطالباتٌ مشوّهة تُعامَل معاملة «ليس نظاماً»
  END;
  RETURN COALESCE(v_role, '') = 'service_role';
END;
$fn$;

REVOKE ALL ON FUNCTION public.taki_is_system_caller() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_is_system_caller() FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_is_system_caller() TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) إعادةُ بناء الحرّاس الأربعة **من نصّها الحيّ** — لا من نسخةٍ في الذاكرة
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 كل حارسٍ فيه منطقٌ خاصّ به (فحصُ تغيّر المحتوى · رسائلُ الأخطاء · الرموز).
--    إعادةُ كتابته هنا من الحفظ تُضيّع ما لا أتذكّره. فيُقرأ تعريفُه الحيّ
--    ويُستبدل **السطرُ الواحد** المعطوب، ثمّ يُتحقّق من وقوع الاستبدال.
DO $patch$
DECLARE
  v_names text[] := ARRAY['taki_guard_publish_needs_verification',
                          'taki_guard_deal_merchant',
                          'taki_guard_store_cr',
                          'taki_guard_user_created_at'];
  v_name text; v_src text; v_new text; v_hits int;
  v_old  text := 'current_user IN (''postgres'',''supabase_admin'',''service_role'')';
  v_old2 text := 'current_user IN (''postgres'', ''supabase_admin'', ''service_role'')';
BEGIN
  FOREACH v_name IN ARRAY v_names LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_src
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = v_name;

    IF v_src IS NULL THEN
      RAISE EXCEPTION '❌ الحارس % غير موجود — أوقِفت قبل أن أبني على فراغ.', v_name;
    END IF;

    IF position('taki_is_system_caller' IN v_src) > 0 THEN
      RAISE NOTICE 'ℹ️ % مُصلَحٌ أصلاً.', v_name;
      CONTINUE;
    END IF;

    v_new := replace(replace(v_src, v_old, 'public.taki_is_system_caller()'),
                     v_old2, 'public.taki_is_system_caller()');

    IF v_new = v_src THEN
      RAISE EXCEPTION '❌ لم أجد الشرط المعطوب في % — نصُّها الحيّ لا يطابق المتوقَّع. أوقِفت بلا تغيير.', v_name;
    END IF;
    IF position('current_user' IN v_new) > 0 THEN
      RAISE EXCEPTION '❌ بقي `current_user` في % بعد الاستبدال.', v_name;
    END IF;

    EXECUTE v_new;
    RAISE NOTICE '✅ أُصلح %', v_name;
  END LOOP;

  -- ولا يبقى في المخطّط حارسُ DEFINER يفحص `current_user` — كاشفٌ عامّ
  -- كي لا يتكرّر النمط في حارسٍ نكتبه غداً.
  SELECT count(*) INTO v_hits
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef
     AND pg_get_functiondef(p.oid) LIKE '%current_user IN (%';
  IF v_hits > 0 THEN
    RAISE EXCEPTION '❌ ما زالت % دالّة DEFINER تفحص current_user — وهو مالكُها دائماً.', v_hits;
  END IF;
END
$patch$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) تحقّقٌ **سلوكيّ** لا هيكليّ: الحارس يجب أن يعضّ
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  v_sys_default boolean;
  v_sys_as_user boolean;
  v_src text; v_name text;
  v_seller text; v_blocked text;
  v_mode_before jsonb;
BEGIN
  -- (أ) المميِّز نفسه: نظامٌ حين يعمل الخادم، وليس نظاماً حين يطلب مستخدم
  v_sys_default := public.taki_is_system_caller();
  IF NOT v_sys_default THEN
    RAISE EXCEPTION '❌ الهجرة نفسها (psql بدور supabase_admin) لا تُعدّ نظاماً — الكرون سيُحجب.';
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', '00000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_sys_as_user := public.taki_is_system_caller();
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);
    RAISE;
  END;

  -- 🪤 على جدّة يتّصل psql بـ`supabase_admin`، فـ`session_user` يبقى كذلك حتى
  --    بعد `SET ROLE`. فهذا الفرع يُثبت أن المميِّز **لا ينهار**، أمّا إثباتُ
  --    أن طلب المتصفّح ليس نظاماً فمرجعُه أن `authenticator` ليس في القائمة —
  --    وهو مقيسٌ من `pg_stat_activity` (authenticator ×2 لكل طلبات الويب).
  IF v_sys_as_user IS NULL THEN
    RAISE EXCEPTION '❌ المميِّز انهار تحت دور authenticated.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    RAISE EXCEPTION '❌ الدور authenticator غير موجود — افتراضُ هذا الحارس باطل على هذا الخادم.';
  END IF;
  IF 'authenticator' = ANY (ARRAY['postgres','supabase_admin']) THEN
    RAISE EXCEPTION '❌ authenticator داخل قائمة النظام — الحارس سيبقى بلا أثر.';
  END IF;

  -- (ب) لا حارسَ يفحص `current_user` بعد اليوم
  FOR v_name IN SELECT unnest(ARRAY['taki_guard_publish_needs_verification',
                                    'taki_guard_deal_merchant',
                                    'taki_guard_store_cr',
                                    'taki_guard_user_created_at'])
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_src
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = v_name;
    IF v_src IS NULL THEN RAISE EXCEPTION '❌ اختفى %', v_name; END IF;
    IF position('taki_is_system_caller' IN v_src) = 0 THEN
      RAISE EXCEPTION '❌ % لا تستعمل المميِّز الصحيح.', v_name;
    END IF;
    IF position('current_user' IN v_src) > 0 THEN
      RAISE EXCEPTION '❌ % ما زالت تفحص current_user.', v_name;
    END IF;
  END LOOP;

  -- (ج) 🪤 **ما لا يستطيع هذا الملفّ إثباته، ويجب أن يقوله صراحةً.**
  --     حاولتُ هنا اختباراً سلوكياً (تاجرٌ غير موثّق ينشر ⇒ يجب أن يُرفض)
  --     فمرّ «بنجاح» — **وكان كاذباً مرّتين**:
  --       ١. `psql` يتّصل بـ`supabase_admin`، فـ`taki_is_system_caller()` تقول
  --          «نظام» بحقّ، ويعود الحارس فوراً كما صُمِّم. لا يمكن لهذا الملفّ
  --          أن ينتحل طلبَ متصفّح: `session_user` لا يتغيّر بـ`SET ROLE`.
  --       ٢. والرفضُ الذي رصدتُه لم يكن من الحارس أصلاً بل من سقف المواقع
  --          (`LOCATION_LIMIT_EXCEEDED`, P0001). أي أن الاختبار كان سيمرّ
  --          حتى لو بقي الحارس معطوباً تماماً.
  --     فالدرس: **فحصٌ يقبل أيَّ استثناء ليس فحصاً** — يُشترط الرمز بعينه.
  --     والإثباتُ السلوكيّ مكانُه طلبٌ حقيقيّ عبر PostgREST (دور
  --     `authenticator`)، ويُجرى من المتصفّح على المختبر لا من هنا.
  --     ما يُثبته هذا الملفّ: أن المميِّز صحيح، وأن الحرّاس الأربعة تستعمله،
  --     وأن `authenticator` **ليس** في قائمة النظام — وهي الشروط الكافية.
  IF public.taki_is_system_caller() THEN
    RAISE NOTICE 'ℹ️ هذه الجلسة «نظام» (session_user=%) فلا يمكنها اختبار الحارس سلوكياً — الإثبات من طلبٍ حقيقيّ.', session_user;
  ELSE
    -- جلسةٌ ليست نظاماً (لا تقع عملياً من psql): يُشترط الرمز بعينه.
    SELECT value INTO v_mode_before FROM public.platform_settings WHERE key = 'verification';
    SELECT u.id INTO v_seller FROM public.users u
     WHERE u.user_type = 'seller' AND u.deleted_at IS NULL
       AND NOT public.taki_store_verified(u.id)
       AND NOT public.taki_store_grandfathered(u.id) LIMIT 1;
    IF v_seller IS NOT NULL THEN
      UPDATE public.platform_settings SET value = jsonb_set(value,'{mode}','"required"') WHERE key='verification';
      BEGIN
        INSERT INTO public.deals (id, store_id, shop_name, item_name, category,
                                  original_price, discounted_price, quantity, status, created_at)
        VALUES ('_v1496_probe_', v_seller, 'فحص', 'فحصُ الحارس', 'other', 100, 50, 1, 'active',
                (extract(epoch FROM now()) * 1000)::bigint);
      EXCEPTION WHEN OTHERS THEN
        v_blocked := SQLSTATE;   -- الرمز، لا مجرّد «وقع استثناء»
      END;
      DELETE FROM public.deals WHERE id = '_v1496_probe_';
      UPDATE public.platform_settings SET value = v_mode_before WHERE key='verification';
      IF COALESCE(v_blocked,'') <> 'P0024' THEN
        RAISE EXCEPTION '❌ الحارس لم يرفض بـP0024 بل بـ«%» — وهذا يعني إمّا أنه بلا أثر وإمّا أن الرفض من حارسٍ آخر.', COALESCE(v_blocked,'لا رفض');
      END IF;
      RAISE NOTICE '✅ الحارس رفض بـP0024 — وهو الرمز الصحيح لا أيُّ رفض.';
    END IF;
  END IF;
  SELECT value INTO v_mode_before FROM public.platform_settings WHERE key = 'verification';

  -- (د) الوضع عاد كما كان، ولا شيء تغيّر في الإنتاج
  IF (SELECT value FROM public.platform_settings WHERE key = 'verification')
     IS DISTINCT FROM v_mode_before THEN
    RAISE EXCEPTION '❌ لم يعد وضعُ التوثيق إلى ما كان عليه.';
  END IF;

  RAISE NOTICE '✅ v14.96: المميِّز صحيح · أربعةُ حرّاسٍ تستعمله · authenticator خارج قائمة النظام · الوضع كما كان (%).',
    v_mode_before->>'mode';
  RAISE NOTICE 'ℹ️ والإثباتُ السلوكيّ لا يُؤخذ من هنا — يُقاس بطلبٍ حقيقيّ من المتصفّح.';
END
$verify$;
