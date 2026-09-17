-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.53 — نبض الخادم: مراقبةٌ من الخارج بلا مفتاحٍ في مستودعٍ عام
-- ════════════════════════════════════════════════════════════════════════════
-- طلب ناصر: أربعة فحوص دورية — صحّة البوت · نجاح الوظائف المجدولة · قراءة صفّ
-- حقيقي من القاعدة · والقرص والذاكرة وحجم القاعدة. مع تنبيهٍ يصله.
--
-- 🪤 والعقبة الحقيقية ليست الفحوص بل **من يملك حقّ الفحص**: المراقبة تعمل على
-- خوادم GitHub من مستودعٍ **عام**، فلا يمكن أن تحمل مفتاح SSH ولا كلمة القاعدة.
-- والحلّ المعتاد — «ضع سرّاً في GitHub» — يعني أن ناصر يضبط شيئاً، ويعني سرّاً
-- إضافياً يُدار ويُدوَّر ويُنسى.
--
-- فالاتجاه مقلوب: **الخادم يدفع نبضه** إلى جدولٍ في قاعدته كل عشر دقائق (كرون
-- محلّي، يملك كل الصلاحيات لأنه داخل الخادم)، والمراقبةُ الخارجية تقرأ **الحكم**
-- لا الأرقام. وميزة هذا الاتجاه أنه يكشف سقوط الخادم نفسه: لا نبضَ جديد ⇒
-- «قديم» ⇒ إنذار. المراقبةُ التي تسأل الخادمَ عن صحّته تصمت حين يموت.
--
-- وما يُكشف للزائر حكمٌ فقط (`ok`/`warn`/`crit` وقائمة عللٍ بالعربية) — أمّا
-- الأرقام الخام (نسبة القرص، الذاكرة، حجم القاعدة) فللأدمن وحده.
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

-- ════════════════════════════════════════════════════════════════════════════
-- ١) صفّ النبض — واحدٌ لا أكثر
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.system_heartbeat (
  id         smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  seen_at    timestamptz NOT NULL DEFAULT now(),
  status     text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','warn','crit')),
  issues     jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics    jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.system_heartbeat ENABLE ROW LEVEL SECURITY;
-- لا سياسة قراءة ولا كتابة: الكتابة من داخل الخادم بدور المالك، والقراءة
-- بالدالتين أدناه وحدهما. فلا يصل الزائر إلى الأرقام الخام بأي حال.

INSERT INTO public.system_heartbeat (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- ٢) حكم الوظائف المجدولة — يُحسب في القاعدة لا في سكربت
-- ════════════════════════════════════════════════════════════════════════════
-- يكشف عطلين مختلفين: وظيفةٌ **تفشل**، ووظيفةٌ **توقّفت عن العمل أصلاً** —
-- والثانية أخطر لأنها صامتة تماماً: لا سجلّ فشل، فقط لا شيء.
CREATE OR REPLACE FUNCTION public.taki_cron_health()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
WITH j AS (
  SELECT c.jobid, c.jobname, c.schedule, c.active,
         -- الفترة المتوقّعة بالدقائق، مشتقّةً من صيغة الجدولة نفسها:
         CASE
           WHEN split_part(c.schedule,' ',1) = '*'            THEN 1
           WHEN split_part(c.schedule,' ',1) LIKE '*/%'       THEN NULLIF(regexp_replace(split_part(c.schedule,' ',1),'\D','','g'),'')::int
           WHEN split_part(c.schedule,' ',2) = '*'            THEN 60
           WHEN split_part(c.schedule,' ',5) = '*'            THEN 1440
           ELSE 10080
         END AS every_min
  FROM cron.job c WHERE c.active
), r AS (
  SELECT d.jobid,
         max(d.start_time) AS last_run,
         count(*) FILTER (WHERE d.status = 'failed' AND d.start_time > now() - interval '24 hours') AS failed_24h
  FROM cron.job_run_details d GROUP BY d.jobid
), x AS (
  SELECT j.jobname, j.every_min, r.last_run, COALESCE(r.failed_24h,0) AS failed_24h,
         -- «متوقّفة» = لم تعمل منذ ثلاثة أضعاف فترتها + عشر دقائق سماحاً.
         (r.last_run IS NOT NULL
          AND r.last_run < now() - make_interval(mins => (j.every_min * 3 + 10))) AS stalled
  FROM j LEFT JOIN r ON r.jobid = j.jobid
)
SELECT jsonb_build_object(
  'jobs',        (SELECT count(*) FROM x),
  'failed_24h',  (SELECT COALESCE(sum(failed_24h),0) FROM x),
  'failed_names',(SELECT COALESCE(jsonb_agg(jobname), '[]'::jsonb) FROM x WHERE failed_24h > 0),
  'stalled',     (SELECT count(*) FROM x WHERE stalled),
  'stalled_names',(SELECT COALESCE(jsonb_agg(jobname), '[]'::jsonb) FROM x WHERE stalled),
  'never_ran',   (SELECT COALESCE(jsonb_agg(jobname), '[]'::jsonb) FROM x WHERE last_run IS NULL)
);
$function$;
REVOKE ALL ON FUNCTION public.taki_cron_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_cron_health() FROM anon;
REVOKE ALL ON FUNCTION public.taki_cron_health() FROM authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ٣) ما تقرؤه المراقبة الخارجية — حكمٌ لا أرقام
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.system_health_public()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'status',      h.status,
    'issues',      h.issues,
    'seen_at',     h.seen_at,
    'age_seconds', GREATEST(0, floor(extract(epoch FROM (now() - h.seen_at)))::bigint)
  )
  FROM public.system_heartbeat h WHERE h.id = 1;
$function$;
-- يُقرأ من خارج الخادم بمفتاح `anon` العلني — ولذلك لا يُرجع رقماً خاماً واحداً.
REVOKE ALL ON FUNCTION public.system_health_public() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.system_health_public() TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ٤) التفاصيل الكاملة — للأدمن وحده
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_system_health()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE h public.system_heartbeat%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'ADMIN_ONLY'; END IF;
  SELECT * INTO h FROM public.system_heartbeat WHERE id = 1;
  RETURN jsonb_build_object(
    'status', h.status, 'issues', h.issues, 'metrics', h.metrics, 'seen_at', h.seen_at,
    'age_seconds', GREATEST(0, floor(extract(epoch FROM (now() - h.seen_at)))::bigint),
    'cron', public.taki_cron_health(),
    'db_size', pg_size_pretty(pg_database_size(current_database()))
  );
END $function$;
REVOKE ALL ON FUNCTION public.admin_system_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_system_health() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_system_health() TO authenticated;
DELETE FROM public.admin_rpc_permissions WHERE rpc_name = 'admin_system_health';
INSERT INTO public.admin_rpc_permissions (rpc_name, required_perm) VALUES ('admin_system_health','tab_launch');

-- ════════════════════════════════════════════════════════════════════════════
-- ٥) ما يكتبه الخادم — دالةٌ واحدة يناديها سكربت النبض
-- ════════════════════════════════════════════════════════════════════════════
-- العتبات هنا لا في السكربت: تعديلها لا يحتاج دخولاً على الخادم، والسكربت
-- يبقى جاهلاً بالسياسة فلا تفترق نسختان منها.
CREATE OR REPLACE FUNCTION public.taki_write_heartbeat(
  p_disk_pct int, p_mem_pct int, p_backup_age_hours numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_cron    jsonb := public.taki_cron_health();
  v_dbmb    numeric := round(pg_database_size(current_database()) / 1048576.0, 1);
  v_issues  jsonb := '[]'::jsonb;
  v_status  text := 'ok';
  v_add     text;
BEGIN
  IF p_disk_pct >= 90 THEN v_status := 'crit'; v_add := format('القرص ممتلئ %s%%', p_disk_pct);
  ELSIF p_disk_pct >= 75 THEN v_status := 'warn'; v_add := format('القرص %s%%', p_disk_pct); END IF;
  IF v_add IS NOT NULL THEN v_issues := v_issues || to_jsonb(v_add); v_add := NULL; END IF;

  IF p_mem_pct >= 92 THEN v_status := 'crit'; v_add := format('الذاكرة %s%%', p_mem_pct);
  ELSIF p_mem_pct >= 85 THEN v_status := GREATEST(v_status,'warn'); v_add := format('الذاكرة %s%%', p_mem_pct); END IF;
  IF v_add IS NOT NULL THEN v_issues := v_issues || to_jsonb(v_add); v_add := NULL; END IF;

  -- النسخة الاحتياطية: الكاملة ليلية، فأكثر من ٣٦ ساعة يعني أنها لم تُؤخذ.
  IF p_backup_age_hours >= 36 THEN v_status := 'crit';
    v_issues := v_issues || to_jsonb(format('آخر نسخة احتياطية قبل %s ساعة', round(p_backup_age_hours)));
  END IF;

  IF (v_cron->>'failed_24h')::int > 0 THEN v_status := 'crit';
    v_issues := v_issues || to_jsonb(format('وظائف فشلت خلال ٢٤ ساعة: %s', v_cron->>'failed_names'));
  END IF;
  IF (v_cron->>'stalled')::int > 0 THEN v_status := 'crit';
    v_issues := v_issues || to_jsonb(format('وظائف توقّفت عن العمل: %s', v_cron->>'stalled_names'));
  END IF;

  -- حجم القاعدة: ليس خطراً بذاته، لكن قفزةً مفاجئة تستحقّ نظرة.
  IF v_dbmb >= 4096 THEN v_status := GREATEST(v_status,'warn');
    v_issues := v_issues || to_jsonb(format('حجم القاعدة %s ميجابايت', v_dbmb));
  END IF;

  UPDATE public.system_heartbeat SET
    seen_at = now(), status = v_status, issues = v_issues,
    metrics = jsonb_build_object('disk_pct', p_disk_pct, 'mem_pct', p_mem_pct,
                                 'db_mb', v_dbmb, 'backup_age_hours', round(p_backup_age_hours,1),
                                 'cron', v_cron)
  WHERE id = 1;

  RETURN jsonb_build_object('status', v_status, 'issues', v_issues);
END $function$;
REVOKE ALL ON FUNCTION public.taki_write_heartbeat(int,int,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_write_heartbeat(int,int,numeric) FROM anon;
REVOKE ALL ON FUNCTION public.taki_write_heartbeat(int,int,numeric) FROM authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق — ويرفع استثناءً عند الفشل، لا يطبع ❌ ويمضي
-- ════════════════════════════════════════════════════════════════════════════
-- 🪤 قِيس في ١٧ سبتمبر أن جدول «✅/❌» في نهاية كل هجرة **لا يُفشل psql**:
-- صفٌّ يقول ❌ ليس خطأً في SQL، فالخروج صفر. فكل «تحقّق» آليّ في ٥٥ ملفاً كان
-- زينةً. من هنا فصاعداً: الجدول للقراءة، و`DO` يرفع الاستثناء فعلاً.
DO $verify$
DECLARE v jsonb;
BEGIN
  IF to_regclass('public.system_heartbeat') IS NULL THEN RAISE EXCEPTION 'VERIFY: جدول النبض مفقود'; END IF;
  IF to_regprocedure('public.system_health_public()') IS NULL THEN RAISE EXCEPTION 'VERIFY: الدالة العامة مفقودة'; END IF;
  IF to_regprocedure('public.taki_cron_health()') IS NULL THEN RAISE EXCEPTION 'VERIFY: دالة الوظائف مفقودة'; END IF;
  IF NOT has_function_privilege('anon','public.system_health_public()','EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY: المراقبة الخارجية لن تستطيع القراءة'; END IF;
  IF has_function_privilege('anon','public.taki_cron_health()','EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY: تفاصيل الوظائف مكشوفة للزائر'; END IF;
  IF has_function_privilege('anon','public.taki_write_heartbeat(int,int,numeric)','EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY: الزائر يستطيع تزوير النبض'; END IF;
  v := public.taki_cron_health();
  IF (v->>'jobs')::int < 1 THEN RAISE EXCEPTION 'VERIFY: لم تُقرأ أي وظيفة مجدولة'; END IF;
  RAISE NOTICE 'التحقّق مرّ: % وظيفة · % فاشلة · % متوقّفة',
    v->>'jobs', v->>'failed_24h', v->>'stalled';
END
$verify$;

SELECT 'الخادم' AS الفحص,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ مختبر طوكيو' ELSE '✅ جدة' END AS النتيجة
UNION ALL SELECT 'حكم الوظائف', public.taki_cron_health()::text
UNION ALL SELECT 'ما تراه المراقبة', public.system_health_public()::text;
