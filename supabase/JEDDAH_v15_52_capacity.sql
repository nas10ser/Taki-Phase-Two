-- ═══════════════════════════════════════════════════════════════════════════
-- v15.52 — سعةٌ لملايين: الهدرُ يُقطع، والسقوفُ تُنذر قبل أن تُضرب
-- ═══════════════════════════════════════════════════════════════════════════
-- أمرُ ناصر: «اجعل الموقع مستعدّاً تماماً لملايين المستخدمين، وأبلِغ الأدمن
-- حين تصل أيُّ طاقةٍ قصوى».
--
-- والقياسُ على جدّة (نواةٌ واحدة · ٥٫٩ ج.ب · قاعدةٌ ٨٠ م.ب · ٦ مستخدمين):
--   • **٦٥٪ من زمن القاعدة ليس مستخدمين**: كرونٌ ٣٨٪ وريل-تايم ٢٧٪.
--   • `cron.job_run_details` = **٢٦٢ ألف صفّ · ٥٠ م.ب · ٦٢٪ من حجم القاعدة**،
--     و`last_autovacuum` و`last_autoanalyze` **كلاهما NULL** — لم يُنظَّف ولم
--     يُحصَ ولا مرّة. وأثقلُ عملٍ واحد على القاعدة `COPY` منه (١٫٣ ثانيةٍ للنداء).
--   • **سبعةُ جداولَ منشورةٌ للريل-تايم بصفر مشترك**، وقِيس في المستودع صفرُ
--     ارتباطٍ لكلٍّ منها. وأثقلُها `user_sessions`: ٨٨٢٦ كتابة و`REPLICA
--     IDENTITY FULL` ⇒ الصفُّ القديم **كاملاً** يُكتب في WAL ثمّ يُفكَّك
--     ويُرسَل إلى خادم الريل-تايم **لأجل لا أحد**. وبملايين المستخدمين (صفُّ
--     جلسةٍ لكل فتح تطبيق) هذا أكبرُ بندِ هدرٍ على المسار، **وينمو بحجم
--     الكتابة لا بعدد الأنوية** — فلا يُصلحه خادمٌ أكبر.
--
-- 🪤 ولا يُلمس جدولٌ له مشتركٌ واحد: `bookings` · `booking_messages` ·
--    `notifications` · `deals` · `users` · `favorites` · `ratings` ·
--    `sponsors` · `store_profiles` · `platform_settings` · `merchant_subscriptions`
--    تبقى كما هي. والقياسُ كان على المستودع **وعلى اسم الجدول في الارتباط**،
--    لا على الحدس.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    RAISE EXCEPTION 'نشرةُ الريل-تايم غائبة — أوقِفت.';
  END IF;
END
$guard$;

-- ── ١) منظّفُ سجلّ الكرون ──────────────────────────────────────────────────
-- 🪤 ونافذةُ التنظيف **أوسعُ** من نافذة كشف التوقّف (درس v15.25): حذفُ ما
--    يقوم عليه الكشفُ يُعمي الإنذارَ الذي بُني ليصرخ.
CREATE OR REPLACE FUNCTION public.taki_prune_cron_log()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $function$
DECLARE v_n integer;
BEGIN
  DELETE FROM cron.job_run_details WHERE end_time < now() - interval '30 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- 🔴 والإحصاءُ ليس تجميلاً: الجدولُ بلا `last_autoanalyze` إطلاقاً، فكلُّ
  --    استعلامٍ عليه (ومنه كشفُ التوقّف نفسُه) يُخطَّط أعمى.
  IF v_n > 0 THEN EXECUTE 'ANALYZE cron.job_run_details'; END IF;
  RETURN v_n;
END $function$;
REVOKE ALL ON FUNCTION public.taki_prune_cron_log() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('taki-prune-cron-log', '25 4 * * *', 'SELECT public.taki_prune_cron_log();')
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='taki-prune-cron-log');

-- تنظيفةٌ أولى فوراً، وإحصاءٌ مهما كان العدد (الجدولُ بلا إحصاءٍ منذ نشأته).
SELECT public.taki_prune_cron_log();
ANALYZE cron.job_run_details;

-- ── ٢) الريل-تايم: ما لا يستمع إليه أحدٌ لا يُبَثّ ────────────────────────
DO $pub$
DECLARE t text; v_dropped int := 0;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_sessions','activity_log','subscription_payments',
                           'sponsorships','pinned_stores','store_branches',
                           'promotional_campaigns'] LOOP
    IF EXISTS (SELECT 1 FROM pg_publication_tables
                WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
      v_dropped := v_dropped + 1;
    END IF;
    -- وبعد خروجه من النشرة لا معنى لـ`REPLICA IDENTITY FULL`: كانت تُضاعف
    -- حجمَ WAL لكلّ تحديثٍ بلا قارئ.
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='public' AND c.relname=t AND c.relreplident='f') THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY DEFAULT', t);
    END IF;
  END LOOP;
  RAISE NOTICE 'أُخرج % جدولاً من نشرة الريل-تايم', v_dropped;
END
$pub$;

-- ── ٣) إنذارُ السعة — «أبلِغ الأدمن حين تصل أيُّ طاقةٍ قصوى» (أمرُ ناصر) ──
-- 🪤 وإنذارٌ لا يُفعل به شيء ليس إنذاراً بل ضجيج (درس v15.24): فلكلّ مقياسٍ
--    عتبتان (تحذير/حرج)، ولا يتكرّر الإنذارُ الواحد قبل مضيّ مهلةِ تهدئة،
--    ويعود إلى الصمت وحده حين ينزل المقياسُ تحت العتبة.
-- 🪤 ولا رقمَ مكتوبٌ في أيّ نصٍّ ظاهر: العتباتُ إعدادٌ يضبطه ناصر، والنصُّ
--    يقرؤها (أمرُه الثابت: لا مدّةَ ولا حدَّ يُكتب نصّاً إلا بنصٍّ نظاميّ).
INSERT INTO public.platform_settings (key, value)
SELECT 'capacity_limits', jsonb_build_object(
  'db_connections_warn_pct', 70, 'db_connections_crit_pct', 85,
  'db_size_warn_mb', 4096,       'db_size_crit_mb', 8192,
  'storage_warn_mb', 20480,      'storage_crit_mb', 40960,
  'email_daily_warn', 80,        'email_daily_crit', 95,
  'email_daily_quota', 100,
  'cron_fail_warn', 3,           'cron_fail_crit', 10,
  'users_warn', 500000,          'users_crit', 900000,
  'cooldown_hours', 6)
WHERE NOT EXISTS (SELECT 1 FROM public.platform_settings WHERE key = 'capacity_limits');

-- والمفتاحُ في ثلاثة مواضعَ لا اثنين (فخُّ v14.92): فرعُ التطبيق وقائمةُ الجلب
-- في الكود، **وقائمةُ السماح في سياسة القراءة** — وتُعاد بناءُ السياسة من
-- نصّها الحيّ بإضافة عنصرٍ واحد، وتُنسخ أدوارُها حرفياً.
DO $allow$
DECLARE v_q text; v_roles text; v_new text;
BEGIN
  SELECT pg_get_expr(polqual, polrelid),
         COALESCE(string_agg(r::regrole::text, ', '), 'public')
    INTO v_q, v_roles
    FROM pg_policy p, LATERAL unnest(CASE WHEN p.polroles = '{0}' THEN ARRAY[]::oid[] ELSE p.polroles END) r
   WHERE p.polrelid = 'public.platform_settings'::regclass AND p.polname = 'platform_settings_select'
   GROUP BY pg_get_expr(polqual, polrelid);
  IF v_q IS NULL THEN
    SELECT pg_get_expr(polqual, polrelid) INTO v_q FROM pg_policy
     WHERE polrelid='public.platform_settings'::regclass AND polname='platform_settings_select';
    v_roles := 'public';
  END IF;
  IF v_q IS NULL THEN RAISE EXCEPTION '❌ سياسةُ قراءة الإعدادات غائبة — أوقِفت'; END IF;
  IF position('capacity_limits' IN v_q) > 0 THEN
    RAISE NOTICE 'ℹ️ المفتاحُ في قائمة السماح أصلاً';
    RETURN;
  END IF;
  IF position('booking_holds' IN v_q) = 0 THEN
    RAISE EXCEPTION '❌ لم أتعرّف على قائمة السماح في السياسة الحيّة — أوقِفت';
  END IF;
  v_new := replace(v_q, '''booking_holds''', '''booking_holds'', ''capacity_limits''');
  IF v_new = v_q THEN RAISE EXCEPTION '❌ لم يقع الإدراج — أوقِفت'; END IF;
  EXECUTE format('DROP POLICY IF EXISTS platform_settings_select ON public.platform_settings');
  EXECUTE format('CREATE POLICY platform_settings_select ON public.platform_settings FOR SELECT TO %s USING (%s)',
                 v_roles, v_new);
END
$allow$;

CREATE TABLE IF NOT EXISTS public.capacity_alerts (
  metric      text PRIMARY KEY,
  level       text NOT NULL,
  value_num   numeric,
  limit_num   numeric,
  raised_at   timestamptz NOT NULL DEFAULT now(),
  cleared_at  timestamptz
);
ALTER TABLE public.capacity_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS capacity_alerts_admin ON public.capacity_alerts;
CREATE POLICY capacity_alerts_admin ON public.capacity_alerts FOR SELECT TO public
  USING (public.taki_admin_perm('tab_tools'));
REVOKE ALL ON TABLE public.capacity_alerts FROM anon, authenticated;
GRANT SELECT ON TABLE public.capacity_alerts TO authenticated;

/** قراءةٌ واحدةٌ لكلّ المقاييس — تقرؤها شاشةُ الأدمن ويقرؤها الإنذار. */
CREATE OR REPLACE FUNCTION public.taki_capacity_report()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lim jsonb;
  v_conn_used int; v_conn_max int;
  v_db_mb numeric; v_store_mb numeric; v_mail int; v_cronfail int; v_users bigint;
BEGIN
  SELECT COALESCE(value,'{}'::jsonb) INTO v_lim FROM public.platform_settings WHERE key='capacity_limits';
  SELECT count(*) INTO v_conn_used FROM pg_stat_activity;
  v_conn_max := current_setting('max_connections')::int;
  v_db_mb := round(pg_database_size(current_database()) / 1048576.0, 1);
  SELECT round(COALESCE(sum((metadata->>'size')::bigint),0) / 1048576.0, 1) INTO v_store_mb
    FROM storage.objects;
  SELECT count(*) INTO v_mail FROM public.email_outbox
   WHERE created_at > now() - interval '24 hours' AND status <> 'failed';
  SELECT count(*) INTO v_cronfail FROM cron.job_run_details
   WHERE status <> 'succeeded' AND end_time > now() - interval '24 hours';
  SELECT count(*) INTO v_users FROM public.users WHERE deleted_at IS NULL;

  RETURN jsonb_build_object(
    'limits', v_lim,
    'db_connections', jsonb_build_object('used', v_conn_used, 'max', v_conn_max,
                        'pct', round(100.0 * v_conn_used / GREATEST(v_conn_max,1), 1)),
    'db_size_mb',   v_db_mb,
    'storage_mb',   v_store_mb,
    'email_24h',    v_mail,
    'cron_fail_24h', v_cronfail,
    'users',        v_users,
    'at', now());
END $function$;
REVOKE ALL ON FUNCTION public.taki_capacity_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.taki_capacity_report() TO authenticated, service_role;

/** الإنذارُ نفسُه — يُنادى كلَّ ربع ساعة، ويصمت حين ينزل المقياسُ تحت العتبة. */
CREATE OR REPLACE FUNCTION public.taki_capacity_check()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r jsonb := public.taki_capacity_report();
  lim jsonb := r->'limits';
  v_cool interval := make_interval(hours => COALESCE((lim->>'cooldown_hours')::int, 6));
  v_raised int := 0;
  m record;
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      ('db_connections', 'اتصالاتُ القاعدة',      (r->'db_connections'->>'pct')::numeric,
         COALESCE((lim->>'db_connections_warn_pct')::numeric, 70), COALESCE((lim->>'db_connections_crit_pct')::numeric, 85), '٪'),
      ('db_size',        'حجمُ القاعدة',          (r->>'db_size_mb')::numeric,
         COALESCE((lim->>'db_size_warn_mb')::numeric, 4096),       COALESCE((lim->>'db_size_crit_mb')::numeric, 8192), ' م.ب'),
      ('storage',        'حجمُ الصور والملفّات',   (r->>'storage_mb')::numeric,
         COALESCE((lim->>'storage_warn_mb')::numeric, 20480),      COALESCE((lim->>'storage_crit_mb')::numeric, 40960), ' م.ب'),
      ('email_daily',    'بريدُ اليوم (سقفُ المزوّد)', (r->>'email_24h')::numeric,
         COALESCE((lim->>'email_daily_warn')::numeric, 80),        COALESCE((lim->>'email_daily_crit')::numeric, 95), ' رسالة'),
      ('cron_fail',      'وظائفُ الخادم الفاشلة',  (r->>'cron_fail_24h')::numeric,
         COALESCE((lim->>'cron_fail_warn')::numeric, 3),           COALESCE((lim->>'cron_fail_crit')::numeric, 10), ''),
      ('users',          'عددُ المستخدمين',        (r->>'users')::numeric,
         COALESCE((lim->>'users_warn')::numeric, 500000),          COALESCE((lim->>'users_crit')::numeric, 900000), '')
    ) AS t(metric, label, val, warn, crit, unit)
  LOOP
    IF m.val >= m.crit OR m.val >= m.warn THEN
      DECLARE
        v_level text := CASE WHEN m.val >= m.crit THEN 'crit' ELSE 'warn' END;
        v_prev  public.capacity_alerts%ROWTYPE;
      BEGIN
        SELECT * INTO v_prev FROM public.capacity_alerts WHERE metric = m.metric;
        -- لا يتكرّر الإنذارُ قبل التهدئة، إلا إن تصاعد من تحذيرٍ إلى حرج.
        -- 🪤 والمقارنةُ برتبةٍ صريحة لا أبجديّة: `GREATEST('crit','warn')='warn'`.
        IF v_prev.metric IS NOT NULL
           AND v_prev.cleared_at IS NULL
           AND v_prev.raised_at > now() - v_cool
           AND NOT (v_level = 'crit' AND v_prev.level = 'warn') THEN
          CONTINUE;
        END IF;

        INSERT INTO public.capacity_alerts (metric, level, value_num, limit_num, raised_at, cleared_at)
        VALUES (m.metric, v_level, m.val, CASE WHEN v_level='crit' THEN m.crit ELSE m.warn END, now(), NULL)
        ON CONFLICT (metric) DO UPDATE
          SET level = EXCLUDED.level, value_num = EXCLUDED.value_num,
              limit_num = EXCLUDED.limit_num, raised_at = now(), cleared_at = NULL;

        INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
        SELECT u.id,
          CASE WHEN v_level='crit' THEN '🔴 بلغت الطاقة القصوى: ' ELSE '🟠 اقتربت الطاقة القصوى: ' END || m.label,
          CASE WHEN v_level='crit' THEN '🔴 Capacity reached: '   ELSE '🟠 Capacity near: '        END || m.metric,
          m.label || ' الآن ' || trim(to_char(m.val, 'FM999999999990.9')) || m.unit
            || ' والحدُّ ' || trim(to_char(CASE WHEN v_level='crit' THEN m.crit ELSE m.warn END, 'FM999999999990.9')) || m.unit
            || '. تُضبط الحدودُ من «الأدوات ← حدود السعة».',
          m.metric || ' is ' || trim(to_char(m.val, 'FM999999999990.9')) || ' (limit '
            || trim(to_char(CASE WHEN v_level='crit' THEN m.crit ELSE m.warn END, 'FM999999999990.9')) || ').',
          'system',
          jsonb_build_object('audience','admin','event','capacity','metric', m.metric,
                             'level', v_level, 'value', m.val),
          now()
        FROM public.users u
        WHERE u.user_type = 'admin' AND u.deleted_at IS NULL;

        v_raised := v_raised + 1;
      END;
    ELSE
      -- نزل تحت العتبة ⇒ يُطوى بلا ضجيج، فيُنذر من جديدٍ إن عاد.
      UPDATE public.capacity_alerts SET cleared_at = now()
       WHERE metric = m.metric AND cleared_at IS NULL;
    END IF;
  END LOOP;
  RETURN v_raised;
END $function$;
REVOKE ALL ON FUNCTION public.taki_capacity_check() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('taki-capacity-check', '*/15 * * * *', 'SELECT public.taki_capacity_check();')
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='taki-capacity-check');

-- ═══════════════════════════════════════════════════════════════════════════
-- تحقّقٌ سلوكيّ
-- ═══════════════════════════════════════════════════════════════════════════
DO $behave$
DECLARE r jsonb; v_n int; v_admin int; v_before int;
BEGIN
  BEGIN
    -- (١) التقريرُ يُنتج كلَّ المقاييس بأرقامٍ لا بأصفارٍ وهميّة
    r := public.taki_capacity_report();
    IF (r->'db_connections'->>'max')::int < 10 THEN RAISE EXCEPTION '❌ max_connections غيرُ مقروء'; END IF;
    IF (r->>'db_size_mb')::numeric <= 0 THEN RAISE EXCEPTION '❌ حجمُ القاعدة صفر'; END IF;
    IF NOT (r ? 'storage_mb' AND r ? 'email_24h' AND r ? 'cron_fail_24h' AND r ? 'users') THEN
      RAISE EXCEPTION '❌ التقريرُ ناقصُ مقاييس';
    END IF;

    -- (٢) بالحدود الحقيقيّة: صمتٌ تام (المنصّةُ بعيدةٌ عن كلّ سقف)
    SELECT count(*) INTO v_before FROM public.notifications
     WHERE type='system' AND meta_data->>'event'='capacity';
    v_n := public.taki_capacity_check();
    IF v_n <> 0 THEN RAISE EXCEPTION '❌ أنذر % مقياساً والمنصّةُ خالية — ضجيج', v_n; END IF;

    -- (٣) وبعتبةٍ مستحيلة: يُنذر فعلاً، ويصل كلَّ أدمن
    UPDATE public.platform_settings
       SET value = value || jsonb_build_object('db_size_warn_mb', 1, 'db_size_crit_mb', 2)
     WHERE key='capacity_limits';
    v_n := public.taki_capacity_check();
    IF v_n < 1 THEN RAISE EXCEPTION '❌ لم يُنذر رغم تجاوز العتبة'; END IF;
    SELECT count(*) INTO v_admin FROM public.notifications n JOIN public.users u ON u.id=n.user_id
     WHERE u.user_type='admin' AND n.type='system' AND n.meta_data->>'metric'='db_size';
    IF v_admin = 0 THEN RAISE EXCEPTION '❌ الإنذارُ لم يصل أيَّ أدمن'; END IF;

    -- (٤) ولا يتكرّر داخل التهدئة
    IF public.taki_capacity_check() <> 0 THEN
      RAISE EXCEPTION '❌ كرّر الإنذارَ داخل مهلة التهدئة — ضجيج';
    END IF;

    -- (٥) ويصمت ويُطوى حين تعود العتبةُ معقولة
    UPDATE public.platform_settings
       SET value = value || jsonb_build_object('db_size_warn_mb', 4096, 'db_size_crit_mb', 8192)
     WHERE key='capacity_limits';
    PERFORM public.taki_capacity_check();
    IF EXISTS (SELECT 1 FROM public.capacity_alerts WHERE metric='db_size' AND cleared_at IS NULL) THEN
      RAISE EXCEPTION '❌ بقي الإنذارُ قائماً بعد نزول المقياس';
    END IF;

    RAISE EXCEPTION 'TAKI_V1552_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'TAKI_V1552_ROLLBACK' THEN RAISE; END IF;
  END;
END
$behave$;

-- ── جدولُ القراءة ─────────────────────────────────────────────────────────
SELECT 'الخادم' AS "البند", COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'جدة — الإنتاج') AS "القيمة"
UNION ALL SELECT 'جداولُ الريل-تايم بعد التنظيف',
  (SELECT count(*)::text FROM pg_publication_tables WHERE pubname='supabase_realtime')
UNION ALL SELECT 'منها بلا مشترك (يجب ٠)',
  (SELECT count(*)::text FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public'
      AND tablename IN ('user_sessions','activity_log','subscription_payments',
                        'sponsorships','pinned_stores','store_branches','promotional_campaigns'))
UNION ALL SELECT 'سجلُّ الكرون (صفوف)', (SELECT count(*)::text FROM cron.job_run_details)
UNION ALL SELECT 'منظّفُ السجلّ مجدوَل',
  CASE WHEN EXISTS (SELECT 1 FROM cron.job WHERE jobname='taki-prune-cron-log' AND active) THEN '✅' ELSE '❌' END
UNION ALL SELECT 'إنذارُ السعة مجدوَل',
  CASE WHEN EXISTS (SELECT 1 FROM cron.job WHERE jobname='taki-capacity-check' AND active) THEN '✅' ELSE '❌' END
UNION ALL SELECT 'مفتاحُ الحدود في قائمة سماح RLS',
  CASE WHEN (SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
              WHERE polrelid='public.platform_settings'::regclass AND polname='platform_settings_select')
            LIKE '%capacity_limits%' THEN '✅' ELSE '❌' END
UNION ALL SELECT 'التقريرُ الآن', public.taki_capacity_report()::text;
