-- ═══════════════════════════════════════════════════════════════════════════
-- v14.89 — «النشاط اللحظي» لم يعمل قطّ: مرجعٌ ملتبس يُبتلع بصمت
-- ═══════════════════════════════════════════════════════════════════════════
-- كيف اكتُشف: بقياسٍ حيّ أثناء إعادة بناء لوحة الإدارة. فتحُ الشاشة الأولى
-- أعاد `400: column reference "user_type" is ambiguous` من
-- `get_recent_activity` — و`adminService` يبتلع الخطأ ويُرجع `[]`، فيظهر
-- القسم «لا نشاط بعد» بدل أن يقول إنه فشل. أي أن العيب كان غير مرئيّ تماماً.
--
-- السبب: الدالة `RETURNS TABLE(… user_type text …)`، وفي جسمها
--   SELECT user_type INTO v_caller_role FROM users …
-- فـ`user_type` تحتمل عمودَ الجدول ومتغيّرَ الإخراج معاً. PL/pgSQL يرفض.
-- 🪤 وهو نفس الفخّ المسجَّل في قواعد المشروع: «admin RPCs مع RETURNS TABLE:
--    qualify الأعمدة وإلا column reference is ambiguous». وقع مرّةً أخرى.
--
-- وفُحص الخادم كلّه عن نظائره (دوالّ تُرجع TABLE وتقرأ عموداً بنفس الاسم بلا
-- تأهيل): هذه وحدها.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── حارس: هذه الهجرة للإنتاج (جدّة) لا للمختبر ─────────────────────────────
DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.get_recent_activity(p_limit integer DEFAULT 20)
RETURNS TABLE (
    id bigint,
    user_id text,
    user_name text,
    user_type text,
    action text,
    entity_type text,
    entity_id text,
    metadata jsonb,
    created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_caller_role TEXT;
BEGIN
    -- 🪤 `u.user_type` مؤهَّلاً: بلا التأهيل يلتبس بعمود الإخراج فتفشل الدالة
    --    كلّها — وهو ما كان يحدث.
    SELECT u.user_type INTO v_caller_role
      FROM public.users u
     WHERE u.id = auth.uid()::text;

    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Admin only';
    END IF;

    RETURN QUERY
    SELECT a.id, a.user_id, u.name, a.user_type, a.action,
           a.entity_type, a.entity_id, a.metadata, a.created_at
      FROM public.activity_log a
      LEFT JOIN public.users u ON u.id = a.user_id
     ORDER BY a.created_at DESC
     LIMIT p_limit;
END
$fn$;

-- ── تحقّقٌ يرفع استثناءً (لا جدول ✅/❌ لا يُفشل شيئاً — درس v14.50) ────────
DO $verify$
DECLARE
  v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE proname = 'get_recent_activity';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'get_recent_activity غير موجودة بعد التنفيذ';
  END IF;
  IF v_src !~ 'u\.user_type\s+INTO' THEN
    RAISE EXCEPTION 'التأهيل لم يُطبَّق — الدالة ما زالت تقرأ user_type بلا تأهيل';
  END IF;
  RAISE NOTICE '✅ get_recent_activity: المرجع مؤهَّل، والدالة قابلة للنداء.';
END
$verify$;

SELECT 'الخادم' AS "البند", current_setting('server_version') AS "القيمة"
UNION ALL SELECT 'قاعدة', current_database()
UNION ALL SELECT 'الدالة', 'get_recent_activity — أُصلحت';
