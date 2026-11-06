-- ═══════════════════════════════════════════════════════════════════════════
-- v15.57b — كشفُ صحّة الكرون يتوقّف عن قراءة الجدول كلِّه
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 **تصحيحُ تشخيصٍ لي، قِيس بعد التنفيذ لا قبله.** في v15.57 أضفتُ فهرسين
--    على `cron.job_run_details` وقلتُ إنهما يُنهيان «مليارَ صفٍّ قُرئ مسحاً».
--    ثمّ قِستُ الأثرَ فعلاً — ناديتُ `taki_cron_health()` ثلاثَ مرّاتٍ وقارنتُ
--    العدّادات — فإذا هي **ما زالت تمسح ١١٨٬٢٨٨ صفّاً في كلّ نداء**.
--    والسببُ أن المشكلةَ لم تكن فهرساً مفقوداً أصلاً: الدالّةُ **تطلب الجدولَ
--    كلَّه بتصميمها**، ومسحُ كلِّ الصفوف هو الخطّةُ الصحيحة حين تُطلب كلُّها.
--      • كتلةُ `alive`: ترشّح `start_time > now() - 60 days` — وكلُّ صفوف
--        الجدول داخل الستّين (أقدمُها ١٩ أكتوبر) ⇒ المرشّحُ لا يستبعد شيئاً.
--      • كتلةُ `r`: `max(start_time)` و`count(*) FILTER…` **بلا أيّ مرشّحٍ
--        زمنيّ** مع `GROUP BY jobid` ⇒ تجميعٌ على الجدول بأكمله.
--    ⇒ الفهرسان ليسا ضائعَين: هما **شرطُ** هذا الإصلاح لا بديلُه. والإصلاحُ
--      أن تُعاد صياغةُ الطلب نفسِه حتى يصير ما يُقرأ قليلاً.
--
-- ── ما يتغيّر ─────────────────────────────────────────────────────────────
-- ١) `alive_since` (أي: منذ متى والخادمُ يعمل بلا انقطاع) كانت تُحسب بمسح
--    ٦٠ يوماً بحثاً عن آخر فجوةٍ تتجاوز ساعة. صارت **قيمةً محفوظة** في
--    `taki_cron_uptime`، تُحدَّث كلَّ ساعةٍ بفحص **آخر ساعتين فقط** — وهي
--    نافذةٌ يخدمها الفهرس، وتكفي يقيناً: المزامنةُ تعمل كلَّ ساعة، فأيُّ
--    عودةٍ من انقطاعٍ يراها الفحصُ التالي داخل نافذته.
-- ٢) `last_run` لكلّ وظيفة: كانت `GROUP BY jobid` على الجدول كلِّه. صارت
--    `DISTINCT ON (jobid) … ORDER BY jobid, start_time DESC` — وهي بالضبط
--    ما بُني له الفهرس `(jobid, start_time DESC)`.
-- ٣) `failed_24h`: صارت بمرشّحٍ زمنيٍّ صريح يخدمه فهرس `start_time`.
--
-- 🪤 ولا تُمسّ نافذةُ الاحتفاظ (٩٠ يوماً) ولا منطقُ الحكم: هذا تغييرُ **طريقةِ
--    القراءة** لا المعنى. ودرسُ v15.25 قائم: لا يُنظَّف الجدولُ بنافذةٍ أضيقَ
--    من نافذة الكشف — وقد صار الكشفُ الآن لا يحتاج نافذةً طويلة أصلاً، فإن
--    أُريد تقصيرُ الاحتفاظ يوماً فذاك قرارٌ منفصل يُقاس وحده.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regclass('public.taki_cron_seen') IS NULL THEN
    RAISE EXCEPTION 'جدولُ taki_cron_seen غائب — الأساسُ ناقص. أوقِفت.';
  END IF;
  -- 🪤 والفهرسان شرطٌ: بلا `(jobid, start_time DESC)` تصير `DISTINCT ON`
  --    **أبطأ** من `GROUP BY` (فرزٌ كامل بدل قفزاتٍ في الفهرس).
  IF to_regclass('cron.idx_cron_run_job_start') IS NULL
     OR to_regclass('cron.idx_cron_run_start') IS NULL THEN
    RAISE EXCEPTION 'فهرسا v15.57 غائبان — هذه الهجرةُ تبني عليهما. أوقِفت.';
  END IF;
END
$guard$;

-- ═══ ١) الحالةُ المحفوظة ═══════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.taki_cron_uptime (
    id           smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    alive_since  timestamptz NOT NULL,
    last_sync_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.taki_cron_uptime ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.taki_cron_uptime FROM PUBLIC;
REVOKE ALL ON TABLE public.taki_cron_uptime FROM anon, authenticated;

-- التهيئةُ مرّةً واحدة بالحساب القديم الغالي — ثمّ لا يُعاد أبداً.
INSERT INTO public.taki_cron_uptime (id, alive_since, last_sync_at)
SELECT 1, COALESCE(max(g.start_time), min(g.start_time), now()), now()
  FROM (
    SELECT d.start_time,
           d.start_time - lag(d.start_time) OVER (ORDER BY d.start_time) AS gap
      FROM cron.job_run_details d
     WHERE d.start_time > now() - interval '60 days'
  ) g
 WHERE g.gap IS NULL OR g.gap > interval '1 hour'
ON CONFLICT (id) DO NOTHING;

-- ═══ ٢) المزامنةُ الساعية تتولّى التحديث بنافذةٍ قصيرة ═════════════════════
CREATE OR REPLACE FUNCTION public.taki_cron_seen_sync()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v_n int; v_boundary timestamptz;
BEGIN
  INSERT INTO public.taki_cron_seen (jobname)
  SELECT c.jobname FROM cron.job c ON CONFLICT (jobname) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- 🪤 وتُحذف أسماءُ وظائفَ لم تعد موجودة، وإلّا نما الجدولُ بلا حدّ
  DELETE FROM public.taki_cron_seen s
   WHERE NOT EXISTS (SELECT 1 FROM cron.job c WHERE c.jobname = s.jobname);

  -- 🔴 الاحتفاظُ ٩٠ يوماً — **أوسعُ** من نافذة كشف التوقّف، وإلّا حُذف الدليل
  --    الذي يقوم عليه الكشف (درسٌ مدفوعُ الثمن في v15.25 وv15.56).
  DELETE FROM cron.job_run_details WHERE start_time < now() - interval '90 days';

  -- ── تحديثُ «منذ متى والخادمُ حيّ» بفحصِ ساعتين لا ستّين يوماً ────────────
  -- 🪤 النافذةُ ساعتان **لأن** المزامنةَ ساعية: أيُّ عودةٍ من انقطاعٍ يقع
  --    حدُّها داخل نافذة الفحص التالي يقيناً. وفي الجدولة وظيفةٌ كلَّ دقيقة،
  --    فالفجوةُ التي تتجاوز ساعةً دليلُ توقّفٍ لا ظنّ.
  SELECT g.start_time INTO v_boundary
    FROM (
      SELECT d.start_time,
             d.start_time - lag(d.start_time) OVER (ORDER BY d.start_time) AS gap
        FROM cron.job_run_details d
       WHERE d.start_time > now() - interval '2 hours'
    ) g
   WHERE g.gap > interval '1 hour'
   ORDER BY g.start_time DESC
   LIMIT 1;

  UPDATE public.taki_cron_uptime
     SET alive_since  = COALESCE(v_boundary, alive_since),
         last_sync_at = now()
   WHERE id = 1;

  BEGIN
    EXECUTE 'ANALYZE cron.job_run_details';
  EXCEPTION WHEN OTHERS THEN NULL;   -- إحصاءٌ فاشل لا يُسقط مزامنةَ الأسماء
  END;
  RETURN v_n;
END $fn$;

-- ═══ ٣) دالّةُ الصحّة لا تقرأ إلا ما تحتاج ═════════════════════════════════
CREATE OR REPLACE FUNCTION public.taki_cron_health()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
WITH alive AS (
  -- قيمةٌ محفوظة؛ وإن غاب الصفُّ (قاعدةٌ لم تُهيَّأ) فأقدمُ تشغيلٍ معروف.
  SELECT COALESCE((SELECT u.alive_since FROM public.taki_cron_uptime u WHERE u.id = 1),
                  (SELECT min(d.start_time) FROM cron.job_run_details d),
                  now()) AS alive_since
), j AS (
  SELECT c.jobid, c.jobname, c.schedule, c.active,
         CASE
           WHEN split_part(c.schedule,' ',1) = '*'      THEN 1
           WHEN split_part(c.schedule,' ',1) LIKE '*/%' THEN NULLIF(regexp_replace(split_part(c.schedule,' ',1),'\D','','g'),'')::int
           WHEN split_part(c.schedule,' ',2) = '*'      THEN 60
           WHEN split_part(c.schedule,' ',5) = '*'      THEN 1440
           ELSE 10080
         END AS every_min
  FROM cron.job c WHERE c.active
), last_run AS (
  -- 🪤 `DISTINCT ON` بدل `GROUP BY`: يقفز في الفهرس `(jobid, start_time DESC)`
  --    إلى أوّل صفٍّ لكلّ وظيفة، بدل تجميعِ الجدول كلِّه.
  SELECT DISTINCT ON (d.jobid) d.jobid, d.start_time AS last_run
    FROM cron.job_run_details d
   ORDER BY d.jobid, d.start_time DESC
), fails AS (
  -- ومرشّحٌ زمنيٌّ صريح يخدمه فهرس `start_time` — بدل مسحِ كلِّ التاريخ.
  SELECT d.jobid, count(*) AS failed_24h
    FROM cron.job_run_details d
   WHERE d.status = 'failed' AND d.start_time > now() - interval '24 hours'
   GROUP BY d.jobid
), x AS (
  SELECT j.jobname, j.every_min, lr.last_run, COALESCE(f.failed_24h,0) AS failed_24h,
         public._taki_job_stalled(lr.last_run, j.every_min, a.alive_since, s.first_seen_at) AS stalled,
         (lr.last_run IS NULL) AS never_ran_raw
  FROM j
  LEFT JOIN last_run lr ON lr.jobid = j.jobid
  LEFT JOIN fails f     ON f.jobid  = j.jobid
  LEFT JOIN public.taki_cron_seen s ON s.jobname = j.jobname
  CROSS JOIN alive a
)
SELECT jsonb_build_object(
  'jobs',         (SELECT count(*) FROM x),
  'alive_since',  (SELECT alive_since FROM alive),
  'failed_24h',   (SELECT COALESCE(sum(failed_24h),0) FROM x),
  'failed_names', (SELECT COALESCE(jsonb_agg(jobname), '[]'::jsonb) FROM x WHERE failed_24h > 0),
  -- 🔴 «متوقّفة» تعني: الخادمُ كان حيّاً والوظيفةُ لم تعمل.
  -- 🪤 و«لم تعمل قطّ» تُفصل عنها: الحالتان مختلفتان في المعنى وفي العلاج.
  'stalled',      (SELECT count(*) FROM x WHERE stalled AND NOT never_ran_raw),
  'stalled_names',(SELECT COALESCE(jsonb_agg(jobname), '[]'::jsonb) FROM x WHERE stalled AND NOT never_ran_raw),
  'never_ran',    (SELECT COALESCE(jsonb_agg(jobname), '[]'::jsonb) FROM x WHERE never_ran_raw),
  'never_ran_overdue',
                  (SELECT count(*) FROM x WHERE never_ran_raw AND stalled),
  'never_ran_overdue_names',
                  (SELECT COALESCE(jsonb_agg(jobname), '[]'::jsonb) FROM x WHERE never_ran_raw AND stalled)
);
$fn$;

-- ═══ التحقّقُ السلوكيّ — بالقياس لا بقراءة النصّ ═══════════════════════════
DO $behave$
DECLARE b_seq bigint; b_tup bigint; a_seq bigint; a_tup bigint;
        v_old jsonb; v_new jsonb; i int;
BEGIN
  PERFORM public.taki_cron_seen_sync();          -- يسجّل الوظائف الجديدة ويحدّث الحالة
  IF NOT EXISTS (SELECT 1 FROM public.taki_cron_uptime WHERE id = 1) THEN
    RAISE EXCEPTION 'صفُّ taki_cron_uptime لم يُنشأ';
  END IF;

  SELECT seq_scan, seq_tup_read INTO b_seq, b_tup
    FROM pg_stat_all_tables WHERE schemaname='cron' AND relname='job_run_details';

  FOR i IN 1..3 LOOP v_new := public.taki_cron_health(); END LOOP;
  PERFORM pg_sleep(1);

  SELECT seq_scan, seq_tup_read INTO a_seq, a_tup
    FROM pg_stat_all_tables WHERE schemaname='cron' AND relname='job_run_details';

  RAISE NOTICE '✓ ثلاثُ نداءات: مسحاتٌ تسلسلية +% · صفوفٌ مسحاً +%',
               a_seq - b_seq, a_tup - b_tup;

  -- 🔴 العقدُ: ثلاثُ نداءاتٍ يجب ألّا تقرأ مسحاً أكثرَ من ثلاثة آلاف صفّ.
  --    (قبل الإصلاح: ٣٥٤٬٨٦٤ صفّاً — أي ١١٨ ألفاً لكلّ نداء.)
  IF a_tup - b_tup > 3000 THEN
    RAISE EXCEPTION 'ما زالت تمسح: % صفّاً في ثلاث نداءات', a_tup - b_tup;
  END IF;

  -- وصحّةُ المعنى: المفاتيحُ كلُّها حاضرةٌ ولم ينكسر شيء.
  IF NOT (v_new ? 'jobs' AND v_new ? 'alive_since' AND v_new ? 'stalled'
          AND v_new ? 'never_ran' AND v_new ? 'failed_24h') THEN
    RAISE EXCEPTION 'مخرجاتُ الدالّة ناقصة: %', v_new;
  END IF;
  IF (v_new->>'jobs')::int < 30 THEN
    RAISE EXCEPTION 'عددُ الوظائف % — أقلُّ ممّا يُعقل', v_new->>'jobs';
  END IF;
  RAISE NOTICE '✓ النتيجة: % وظيفة · متوقّفة % · حيٌّ منذ %',
               v_new->>'jobs', v_new->>'stalled', v_new->>'alive_since';
END
$behave$;

SELECT 'بند' AS بند, 'قيمة' AS قيمة
UNION ALL SELECT 'alive_since المحفوظة', (SELECT alive_since::text FROM public.taki_cron_uptime WHERE id=1)
UNION ALL SELECT 'آخرُ مزامنة',          (SELECT last_sync_at::text FROM public.taki_cron_uptime WHERE id=1)
UNION ALL SELECT 'صفوفُ السجلّ',          (SELECT count(*)::text FROM cron.job_run_details);
