-- ═══════════════════════════════════════════════════════════════════════════
-- v15.24 — إنذارٌ لا يُفعل به شيء · ووظيفةٌ لا تعمل أبداً ولا يراها أحد
-- ═══════════════════════════════════════════════════════════════════════════
-- بلاغُ ناصر: إشعاراتُ «🚨 تنبيه الخادم — وظائف توقّفت عن العمل» كلَّ ٦ ساعات،
-- و«الفحوص الأربعة» على GitHub ساقطةٌ منذ ٢٣ أكتوبر. **وسببُهما واحد.**
--
-- ما قِيس (لا استُنتج):
--   • الوظائفُ الثلاث المُتَّهَمة (`taki-analyst-weekly-pulse` ·
--     `taki-push-prune` · `taki-merchant-setup-reminders`) **عملت اليوم
--     بنجاح وبصفر فشل**، وكلُّها **أسبوعيّة** (كلَّ أحد).
--   • والفحصُ يسقط في خطوة «نبض الخادم» وحدها (خطوتان قبلها تنجحان) لأن
--     `system_health_public` يردّ `status <> 'ok'`.
--   • وحدُّ «متوقّفة» = ٣× الفترة + ١٠ دقائق = **٢١ يوماً** للأسبوعيّة.
--     والخادمُ كان **مطفأً من ٢ إلى ١٩ أكتوبر** (نفدت الباقة المجّانية).
--     ⇒ فآخرُ تشغيلٍ قبل اليوم كان قبل ٢٤ يوماً ⇒ «متوقّفة» = صحيحةٌ حسابياً
--       **وبلا معنى عملياً**: لا أحدَ يملك إصلاحَ ماضٍ، والانتظارُ حتى الأحد
--       التالي هو العلاج الوحيد.
--
-- 🔴 **وإنذارٌ لا يُفعل به شيء ليس إنذاراً — هو ضجيج.** وضررُه مقيس: ١٢ رسالةَ
--    فشلٍ من GitHub وأربعةُ إشعاراتٍ على جوّال ناصر، وكلُّها تُدرّب على تجاهل
--    القناة التي يجب أن تصرخ يوم يقع عطلٌ حقيقي.
--
-- 🔴 **وعيبٌ ثانٍ انكشف أثناء القياس:** `taki_cron_health()` تحسب `never_ran`
--    ولا تستعملها الدالّةُ الحاكمة إطلاقاً. أي أن **وظيفةً لم تعمل ولا مرّةً
--    واحدة غيرُ مرئيّة تماماً** — وهي أسوأُ من المتوقّفة (تلك عملت يوماً ما).
--    قِيس الآن: `never_ran` فيها وظيفتان حقيقيّتان.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- العلاج، ومبدؤه واحد: **لا تُتّهم وظيفةٌ بفترةٍ كان الخادمُ فيها مطفأً.**
--   والخادمُ «كان حيّاً» إثباتُه في `cron.job_run_details` نفسه: هناك وظيفةٌ
--   تعمل كلّ دقيقة، فأيُّ فجوةٍ تتجاوز ساعةً = توقّف. ومنها يُشتقّ
--   `alive_since` = بدايةُ آخر فترة تشغيلٍ متّصلة.
--   ⇒ فتُتّهم الوظيفةُ فقط إن كان الخادمُ حيّاً **مدّةً تتجاوز فترتَها كاملةً**.
-- 🪤 ولا يُستعمل جدولُ النبض لذلك: قِيس أنه **صفٌّ واحدٌ يُدهَس** (upsert)،
--    فلا تاريخَ فيه أصلاً.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_cron_health()') IS NULL
     OR to_regproc('public.taki_write_heartbeat') IS NULL THEN
    RAISE EXCEPTION 'دوالُّ النبض غير موجودة — أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) متى رأينا هذه الوظيفة أوّلَ مرّة — فلا تُلام على ما قبل وجودها
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 و`cron.job` **لا تحمل تاريخَ إنشاء**، فبلا هذا الجدول تُتَّهم وظيفةٌ
--    أُنشئت قبل دقيقةٍ بأنها «لم تعمل أبداً».
CREATE TABLE IF NOT EXISTS public.taki_cron_seen (
  jobname       text PRIMARY KEY,
  first_seen_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.taki_cron_seen IS
  'أوّلُ مرّةٍ رُصدت فيها وظيفةُ كرون (v15.24). pg_cron لا يحفظ تاريخَ الإنشاء، وبلا هذا تُتَّهم وظيفةٌ جديدةٌ بأنها «لم تعمل أبداً».';
ALTER TABLE public.taki_cron_seen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.taki_cron_seen FROM anon, authenticated;

-- وتُسجَّل الموجوداتُ الآن بوقتٍ ماضٍ، فلا تُعطى مهلةً لا تستحقّها
INSERT INTO public.taki_cron_seen (jobname, first_seen_at)
SELECT c.jobname, COALESCE((SELECT min(d.start_time) FROM cron.job_run_details d WHERE d.jobid = c.jobid), now())
  FROM cron.job c
ON CONFLICT (jobname) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) الحكمُ على وظيفةٍ واحدة — دالّةٌ نقيّةٌ تُختبر
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 فُصلت عمداً عن الاستعلام: منطقُ «متى تُتَّهم» هو ما يكسر، والاستعلامُ
--    حولَه لا يُختبر في هجرة. (نفسُ فصلِ المحلّل عن النقل في v15.17.)
CREATE OR REPLACE FUNCTION public._taki_job_stalled(
  p_last_run    timestamptz,
  p_every_min   int,
  p_alive_since timestamptz,
  p_first_seen  timestamptz DEFAULT NULL,
  p_now         timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT
    -- الخادمُ لم يُكمل فترةً واحدةً من فترات هذه الوظيفة منذ عودته
    -- ⇒ لا تُتَّهم: غيابُها مُفسَّرٌ بالتوقّف لا بعطلٍ فيها.
    CASE WHEN p_alive_since IS NULL
           OR p_now - p_alive_since < make_interval(mins => COALESCE(p_every_min, 1440) + 10)
         THEN false
    -- ولا تُتَّهم وظيفةٌ رُصدت حديثاً ولم تمضِ فترتُها بعد
         WHEN p_first_seen IS NOT NULL
          AND p_now - p_first_seen < make_interval(mins => COALESCE(p_every_min, 1440) + 10)
         THEN false
    -- لم تعمل قطّ، والخادمُ حيٌّ منذ فترةٍ كاملة ⇒ عطلٌ حقيقيّ
         WHEN p_last_run IS NULL THEN true
    -- 🪤 والمقارنةُ من **أحدثِ** الزمنين: آخرِ تشغيلٍ أو عودةِ الخادم.
    --    فبعد توقّفٍ طويل لا تُحسب أيّامُ التوقّف على الوظيفة.
         ELSE GREATEST(p_last_run, p_alive_since)
              < p_now - make_interval(mins => COALESCE(p_every_min, 1440) * 3 + 10)
    END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) والاستعلامُ يستعملها، ويُعلن ما يعرف
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.taki_cron_health()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
WITH alive AS (
  -- بدايةُ آخر فترة تشغيلٍ متّصلة: أيُّ فجوةٍ تتجاوز ساعةً = الخادمُ كان مطفأً
  -- (وفي الجدولة وظيفةٌ تعمل كلّ دقيقة، فالفجوةُ دليلٌ لا ظنّ).
  SELECT COALESCE(max(g.start_time), min(g.start_time), now()) AS alive_since
    FROM (
      SELECT d.start_time,
             d.start_time - lag(d.start_time) OVER (ORDER BY d.start_time) AS gap
        FROM cron.job_run_details d
       WHERE d.start_time > now() - interval '60 days'
    ) g
   WHERE g.gap IS NULL OR g.gap > interval '1 hour'
), j AS (
  SELECT c.jobid, c.jobname, c.schedule, c.active,
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
         public._taki_job_stalled(r.last_run, j.every_min, a.alive_since, s.first_seen_at) AS stalled,
         (r.last_run IS NULL) AS never_ran_raw
  FROM j
  LEFT JOIN r ON r.jobid = j.jobid
  LEFT JOIN public.taki_cron_seen s ON s.jobname = j.jobname
  CROSS JOIN alive a
)
SELECT jsonb_build_object(
  'jobs',         (SELECT count(*) FROM x),
  'alive_since',  (SELECT alive_since FROM alive),
  'failed_24h',   (SELECT COALESCE(sum(failed_24h),0) FROM x),
  'failed_names', (SELECT COALESCE(jsonb_agg(jobname), '[]'::jsonb) FROM x WHERE failed_24h > 0),
  -- 🔴 «متوقّفة» صارت تعني: الخادمُ كان حيّاً والوظيفةُ لم تعمل.
  -- 🪤 ويُفصل «لم تعمل قطّ» عنها برسالةٍ خاصّة: الحالتان مختلفتان في المعنى
  --    وفي العلاج (تلك انكسرت، وهذه لم تُركَّب أصلاً)، وخلطُهما يُنتج
  --    «وظائف توقّفت: []» حين لا يوجد إلا النوع الثاني.
  'stalled',      (SELECT count(*) FROM x WHERE stalled AND NOT never_ran_raw),
  'stalled_names',(SELECT COALESCE(jsonb_agg(jobname), '[]'::jsonb) FROM x WHERE stalled AND NOT never_ran_raw),
  'never_ran',    (SELECT COALESCE(jsonb_agg(jobname), '[]'::jsonb) FROM x WHERE never_ran_raw),
  'never_ran_overdue',
                  (SELECT count(*) FROM x WHERE never_ran_raw AND stalled),
  'never_ran_overdue_names',
                  (SELECT COALESCE(jsonb_agg(jobname), '[]'::jsonb) FROM x WHERE never_ran_raw AND stalled)
);
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) والحكمُ يرى «لم تعمل قطّ» — وكان أعمى عنها تماماً
-- ═══════════════════════════════════════════════════════════════════════════
DO $patch$
DECLARE src text; src0 text;
BEGIN
  src := pg_get_functiondef('public.taki_write_heartbeat'::regproc);
  src0 := src;
  IF position('v15.24 neverran' IN src) > 0 THEN RAISE NOTICE 'ℹ️ مرقوعةٌ أصلاً.'; RETURN; END IF;
  IF position(E'  IF (v_cron->>''stalled'')::int > 0 THEN v_status := ''crit'';' IN src) = 0 THEN
    RAISE EXCEPTION '❌ مرساة الوظائف المتوقّفة غير موجودة — أوقِفت.';
  END IF;
  src := replace(src,
    E'  IF (v_cron->>''stalled'')::int > 0 THEN v_status := ''crit'';',
    E'  -- v15.24 neverran — `never_ran` كانت تُحسب ولا تُقرأ إطلاقاً: وظيفةٌ\n'
    || E'  --   لم تعمل ولا مرّةً واحدة كانت **غيرَ مرئيّة**، وهي أسوأُ من\n'
    || E'  --   المتوقّفة (تلك عملت يوماً ما). وتُقال برسالتها هي لا بتلك.\n'
    || E'  IF (v_cron->>''never_ran_overdue'')::int > 0 THEN v_status := ''crit'';\n'
    || E'    v_issues := v_issues || to_jsonb(format(''وظائف لم تعمل ولا مرّة: %s'', v_cron->>''never_ran_overdue_names'')); END IF;\n'
    || E'  IF (v_cron->>''stalled'')::int > 0 THEN v_status := ''crit'';');
  IF src = src0 THEN RAISE EXCEPTION '❌ لم تقع الرقعة.'; END IF;
  EXECUTE src;
  IF position('v15.24 neverran' IN pg_get_functiondef('public.taki_write_heartbeat'::regproc)) = 0 THEN
    RAISE EXCEPTION '❌ الرقعة لم تُنفَّذ.';
  END IF;
  RAISE NOTICE '✅ ٤) «لم تعمل قطّ» صارت مرئيّةً برسالتها.';
END
$patch$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) تسجيلُ الوظائف الجديدة تلقائياً — ومنظّفٌ لسجلّ التشغيل
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.taki_cron_seen_sync()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_n int;
BEGIN
  INSERT INTO public.taki_cron_seen (jobname)
  SELECT c.jobname FROM cron.job c ON CONFLICT (jobname) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- 🪤 وتُحذف أسماءُ وظائفَ لم تعد موجودة، وإلّا نما الجدولُ بلا حدّ
  DELETE FROM public.taki_cron_seen s
   WHERE NOT EXISTS (SELECT 1 FROM cron.job c WHERE c.jobname = s.jobname);
  -- 🔴 و`cron.job_run_details` بلا تنظيفٍ إطلاقاً: قِيس ١٧١٬٩٨٤ صفّاً منذ
  --    ٥ أغسطس (≈٢٢٠٠ يومياً). ويُحتفظ بـ٩٠ يوماً — أوسعَ من نافذة كشف
  --    التوقّف (٦٠ يوماً) بهامشٍ واضح، وإلّا حُذف الدليلُ الذي يقوم عليه.
  DELETE FROM cron.job_run_details WHERE start_time < now() - interval '90 days';
  RETURN v_n;
END
$fn$;
REVOKE ALL ON FUNCTION public.taki_cron_seen_sync() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_cron_seen_sync() FROM anon;
REVOKE ALL ON FUNCTION public.taki_cron_seen_sync() FROM authenticated;

SELECT cron.unschedule('taki-cron-seen-sync')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'taki-cron-seen-sync');
SELECT cron.schedule('taki-cron-seen-sync', '7 * * * *',
                     $$SELECT public.taki_cron_seen_sync();$$);

-- 🪤 وتُنادى **مرّةً الآن**: الوظيفةُ أُنشئت بعد التعبئة أعلاه فبقيت بلا تاريخِ
--    رصد. وبلا تاريخٍ لا تُمهَل، و`last_run` فارغ ⇒ تُتَّهم فوراً بأنها «لم
--    تعمل قطّ» — وهي الحالةُ التي وُجد هذا الجدولُ لمنعها بالضبط.
--    (أمسكه فحصُ هذه الهجرة نفسها — وهو ترتيبٌ ناقصٌ منّي لا عيبٌ في المنطق.)
SELECT public.taki_cron_seen_sync();

-- ═══════════════════════════════════════════════════════════════════════════
-- ٦) فحصٌ يرفع استثناءً — والكسراتُ هي الحالاتُ الثلاث بعينها
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  N constant timestamptz := '2026-10-25 12:00:00+00';
  v jsonb; v_names text;
BEGIN
  -- ╔═ (أ) الحالةُ التي أنتجت البلاغ: وظيفةٌ أسبوعيّة بعد توقّفٍ طويل ═════╗
  -- آخرُ تشغيلٍ قبل ٢٤ يوماً، والخادمُ عاد قبل ٦ أيام فقط ⇒ **لا تُتَّهم**:
  -- لم يمرّ عليه أسبوعٌ كاملٌ حيّاً بعد.
  IF public._taki_job_stalled(N - interval '24 days', 10080, N - interval '6 days', NULL, N) THEN
    RAISE EXCEPTION '❌ 🔴 اتُّهمت وظيفةٌ أسبوعيّة بفترةٍ كان الخادمُ فيها مطفأً — وهو البلاغُ نفسه.';
  END IF;

  -- ╔═ (ب) 🔴 الكسرة: نفسُ الوظيفة والخادمُ حيٌّ منذ ٣٠ يوماً ⇒ **تُتَّهم** ══╗
  --    ولولا هذا لصار الحارسُ يسكت عن عطلٍ حقيقيّ — وهو أسوأُ من الضجيج.
  IF NOT public._taki_job_stalled(N - interval '24 days', 10080, N - interval '30 days', NULL, N) THEN
    RAISE EXCEPTION '❌ 🔴 لم تُتَّهم وظيفةٌ لم تعمل ٢٤ يوماً والخادمُ حيٌّ ٣٠ — الحارسُ صار أعمى.';
  END IF;

  -- ╔═ (ج) وظيفةٌ أسبوعيّةٌ عملت اليوم: سليمةٌ في الحالتين ═════════════════╗
  IF public._taki_job_stalled(N - interval '4 hours', 10080, N - interval '60 days', NULL, N) THEN
    RAISE EXCEPTION '❌ وظيفةٌ عملت قبل ٤ ساعاتٍ عُدَّت متوقّفة.';
  END IF;

  -- ╔═ (د) لم تعمل قطّ ═════════════════════════════════════════════════════╗
  --   · ورُصدت قبل دقائق ⇒ لا تُلام (لم تمضِ فترتُها)
  IF public._taki_job_stalled(NULL, 1440, N - interval '30 days', N - interval '10 minutes', N) THEN
    RAISE EXCEPTION '❌ وظيفةٌ أُنشئت قبل عشر دقائق اتُّهمت بأنها لا تعمل.';
  END IF;
  --   · ورُصدت قبل أسبوعٍ والخادمُ حيّ ⇒ **تُتَّهم** (وكانت غيرَ مرئيّةٍ تماماً)
  IF NOT public._taki_job_stalled(NULL, 1440, N - interval '30 days', N - interval '7 days', N) THEN
    RAISE EXCEPTION '❌ 🔴 وظيفةٌ لم تعمل أسبوعاً كاملاً بقيت غيرَ مرئيّة.';
  END IF;

  -- ╔═ (هـ) ولا تُتَّهم وظيفةُ الدقيقة لحظةَ عودة الخادم ════════════════════╗
  IF public._taki_job_stalled(N - interval '3 days', 1, N - interval '5 minutes', NULL, N) THEN
    RAISE EXCEPTION '❌ اتُّهمت وظيفةٌ دقيقيّةٌ بعد خمس دقائق من عودة الخادم.';
  END IF;
  --   وبعد ساعةٍ من العودة تُتَّهم بحقّ (٣ دقائق + ١٠ سماحاً)
  IF NOT public._taki_job_stalled(N - interval '3 days', 1, N - interval '1 hour', NULL, N) THEN
    RAISE EXCEPTION '❌ 🔴 وظيفةٌ دقيقيّةٌ صامتةٌ ساعةً كاملةً لم تُتَّهم.';
  END IF;
  RAISE NOTICE '✅ منطقُ الاتّهام: توقّفُ الخادم يُعفي · والعطلُ الحقيقيّ يُتَّهم · والجديدةُ تُمهَل.';

  -- ╔═ (و) وعلى الحيّ: الحالةُ الآن يجب أن تكون نظيفة ══════════════════════╗
  v := public.taki_cron_health();
  IF (v->>'stalled')::int <> 0 THEN
    RAISE EXCEPTION '❌ ما زالت وظائفُ متوقّفة: %', v->>'stalled_names';
  END IF;
  IF (v->>'failed_24h')::int <> 0 THEN
    RAISE EXCEPTION '❌ وظائفُ فشلت خلال ٢٤ ساعة: %', v->>'failed_names';
  END IF;
  IF v->>'alive_since' IS NULL THEN RAISE EXCEPTION '❌ لم تُحسب بدايةُ التشغيل المتّصل.'; END IF;
  -- 🪤 وتُقاس أنها بعد عودة الخادم (١٩ أكتوبر) لا قبلها — وإلّا فالحسابُ وهم
  IF (v->>'alive_since')::timestamptz < '2026-10-19'::timestamptz THEN
    RAISE EXCEPTION '❌ 🔴 بدايةُ التشغيل المتّصل (%) قبل عودة الخادم — الفجوةُ لم تُكتشف.', v->>'alive_since';
  END IF;
  RAISE NOTICE 'ℹ️ الخادمُ حيٌّ بلا انقطاعٍ منذ % · ووظائفُ لم تعمل بعد: %',
    v->>'alive_since', v->>'never_ran';

  -- ╔═ (ز) والحكمُ العامّ يرى الحالتين ══════════════════════════════════════╗
  IF position('never_ran_overdue' IN pg_get_functiondef('public.taki_write_heartbeat'::regproc)) = 0 THEN
    RAISE EXCEPTION '❌ الحكمُ ما زال أعمى عن «لم تعمل قطّ».';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.taki_cron_seen) THEN
    RAISE EXCEPTION '❌ جدولُ أوّل رصدٍ فارغ.';
  END IF;
  SELECT string_agg(jobname, ', ') INTO v_names FROM cron.job c
   WHERE NOT EXISTS (SELECT 1 FROM public.taki_cron_seen s WHERE s.jobname = c.jobname);
  IF v_names IS NOT NULL THEN RAISE EXCEPTION '❌ وظائفُ بلا تاريخِ رصد: %', v_names; END IF;

  RAISE NOTICE '✅ v15.24: الإنذارُ لا يتّهم ماضياً مطفأً · و«لم تعمل قطّ» صارت مرئيّة.';
END
$verify$;
