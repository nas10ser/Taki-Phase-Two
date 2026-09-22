-- ════════════════════════════════════════════════════════════════════════════
-- v14.82 — مفتاح إيقاف القياس: وعدٌ في الوثيقة صار زرّاً في الشاشة
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 الثغرة: سياسة الخصوصية تَعِد بحقّ **سحب الموافقة** (القسم ٦)، وقسمُ
--    الكوكيز يُحيل إلى «إعدادات متصفّحك لرفض هذه الملفّات». والقياس في تاكي
--    **لا يمرّ بالكوكيز إطلاقاً** — أربعة مسارات تكتب إلى القاعدة عبر RPC.
--    فمن يتبع إرشادنا حرفياً لا يُوقف شيئاً. وثيقةٌ تَعِد بما لا يُنفَّذ.
--
-- ما يضيفه هذا الملف: عمودٌ واحد ودالّتان، ليتبع الاختيارُ الحسابَ بين
-- الأجهزة. والبوّابة الفعلية في المتصفّح (`analyticsConsent.ts`) — فالزائر
-- بلا حساب مُتتبَّعٌ أيضاً وله الحقّ نفسه.
--
-- 🪤 ولا كتابة مباشرة على `users` من العميل: سياساتُ العمود في هذا المشروع
--    تمنع تعديل الصفّ الخاصّ على أعمدةٍ حسّاسة (درس «الملكية ليست تصريحاً»،
--    v13.41)، والدالّة المالكة هي الطريق القائم لكل تفضيلٍ مشابه.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'رُفض: هذا خادم المختبر (طوكيو) — هجرات الإنتاج تُطبَّق على جدة';
  END IF;
END $guard$;

-- ١) العمود ───────────────────────────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS analytics_opt_out boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.analytics_opt_out IS
  'v14.82 — اختيار المستخدم إيقاف القياس السلوكي. الافتراضي false (مسموح): '
  'القياس مجهول الهوية، والوعد الواجب هو إمكان الإيقاف لا الإيقاف افتراضاً.';

-- ٢) القراءة ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_analytics_opt_out()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid text := auth.uid()::text; v_off boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;   -- زائر: لا رأي للحساب
  SELECT COALESCE(analytics_opt_out, false) INTO v_off FROM users WHERE id = v_uid;
  RETURN v_off;   -- NULL إن لم يوجد صفّ ⇒ العميل يُبقي حالته المحلية
END $function$;

-- ٣) الكتابة ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_analytics_opt_out(p_off boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid text := auth.uid()::text; n int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لحفظ هذا التفضيل على الحساب';
  END IF;
  -- 🪤 صفّي المستخدم وحده: `auth.uid()` لا وسيطٌ من العميل، فلا يُغيّر أحدٌ
  --    تفضيلَ غيره حتى لو نادى الدالّة بمعرّفٍ آخر — لا وسيط معرّفٍ أصلاً.
  UPDATE users SET analytics_opt_out = COALESCE(p_off, false) WHERE id = v_uid;
  GET DIAGNOSTICS n = ROW_COUNT;
  -- الكتابة تُثبَت بالعدد لا بغياب الخطأ (درس الخزنة v14.44).
  IF n <> 1 THEN
    RAISE EXCEPTION 'لم يُحدَّث أي صفّ — التفضيل لم يُحفظ';
  END IF;
  RETURN COALESCE(p_off, false);
END $function$;

-- ٤) الصلاحيات ───────────────────────────────────────────────────────────────
-- 🪤 REVOKE من PUBLIC لا يُلغي منح `anon` المباشر — فالاثنان معاً (v14.29).
REVOKE ALL ON FUNCTION public.get_analytics_opt_out()        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_analytics_opt_out()        FROM anon;
REVOKE ALL ON FUNCTION public.set_analytics_opt_out(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_analytics_opt_out(boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_opt_out()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_analytics_opt_out(boolean) TO authenticated;

-- ٥) تحقّقات تُفشل الهجرة إن كذبت ─────────────────────────────────────────────
DO $verify$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='users' AND column_name='analytics_opt_out';
  IF n <> 1 THEN RAISE EXCEPTION 'العمود لم يُنشأ'; END IF;

  -- الزائر لا يُعطَّل: الصلاحية ممنوعة عنه صراحةً
  IF has_function_privilege('anon', 'public.set_analytics_opt_out(boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon يملك EXECUTE على set_analytics_opt_out — سطحُ كتابةٍ للزائر';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.set_analytics_opt_out(boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated لا يملك EXECUTE — المفتاح لن يعمل';
  END IF;

  -- نسخةٌ واحدة من كلٍّ (لا التباس نداء)
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname IN ('get_analytics_opt_out','set_analytics_opt_out');
  IF n <> 2 THEN RAISE EXCEPTION 'عدد الدوال % لا ٢ — تحميلٌ زائد محتمل', n; END IF;

  RAISE NOTICE '✅ v14.82 مطبَّقة — العمود والدالّتان والصلاحيات';
END $verify$;

SELECT count(*) FILTER (WHERE analytics_opt_out) AS "أوقفوا القياس",
       count(*)                                  AS "إجمالي الحسابات"
  FROM public.users;
