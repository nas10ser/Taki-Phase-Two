-- ═══════════════════════════════════════════════════════════════════════════
-- v15.33 — إنذارُ البوت: ارتدادٌ على نبضتين (وإلّا فهو ضجيج)
-- ═══════════════════════════════════════════════════════════════════════════
-- بلاغُ ناصر: «يأتيني إشعار: 🚨 تنبيه الخادم — البوت لا يستجيب أو إحدى خدماته
-- ساقطة». والقياسُ على الإنتاج (جدّة، ٣٠ أكتوبر ٢٠٢٦):
--
--   • السجلّ `/var/log/taki-heartbeat.log` فيه **٣٧٢٨ نبضة** (كلّ ١٠ دقائق).
--   • ظهر البوتُ ساقطاً في **واحدةٍ منها** — ٠٫٠٢٧٪ — والنبضتان المحيطتان
--     بها `ok`. أي أنه **لم يكن عطلاً**، بل لحظةُ إقلاع.
--   • والإقلاعُ مُثبَت: البوتُ أقلع ٣٠ أكتوبر ٠٥:٣٤ وآخرُ نشرٍ كان
--     ٢٨ أكتوبر ١١:٢٧ UTC ⇒ العمليةُ تُعاد من تلقائها (خطّة Render `free`).
--     وإعادةُ التشغيل تتجاوز مهلةَ الفحص (`curl --max-time 25`).
--   • وفحصُ الموقع في السجلّ نفسه: **صفرُ فشل**، و«لم يُفحص»: **صفر**.
--
-- 🔴 وقاعدةُ ناصر من v15.24: «إنذارٌ لا يُفعل به شيء ليس إنذاراً — هو ضجيج».
--    صرخةٌ لا يملك أحدٌ إصلاحَها تُدرّب على تجاهل القناة التي يجب أن تصرخ
--    يوم يقع عطلٌ حقيقيّ. ⇒ نبضةٌ واحدة ليست دليلاً؛ نبضتان دليل.
--
-- 🪤 ولماذا لا يُخفَّض إلى `warn` بدل `ok`: خطوةُ النبض في
--    `.github/workflows/health-checks.yml` تشترط `status = 'ok'` حرفياً
--    (`if d.get('status') != 'ok': sys.exit(1)`)، فـ`warn` تُسقط «الفحوص
--    الأربعة» وتُرسل بريدَ فشلٍ من GitHub — أي نفسُ الضجيج بقناةٍ أخرى.
--    وهو عينُ الفخّ الذي وقع في v15.24. فالنبضةُ الأولى تبقى `ok`،
--    و**عدّادُها محفوظٌ في `metrics.bot_fail_streak`** فلا يضيع الأثر.
--
-- 🪤 والثمنُ مقصودٌ ومُعلَن: الكشفُ صار ≤٢٠ دقيقة بدل ≤١٠.
--
-- 🔴 وبُنيت هذه الهجرة من **النصّ الحيّ** لا من نسخة المستودع: قورنا فتبيّن
--    أن `supabase/v14_85_saturation_alert.sql` **تنقصه كتلةُ
--    `never_ran_overdue`** المضافة في v15.24 — فالبناءُ من المستودع كان
--    سيمحو إصلاحَ v15.24 بصمت.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regclass('public.system_heartbeat') IS NULL THEN
    RAISE EXCEPTION 'v14.53 غير مطبَّقة (لا جدول system_heartbeat) — أوقِفت.';
  END IF;
  -- حارسُ ألّا نكتب فوق نسخةٍ أحدث لا نعرفها.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'taki_write_heartbeat' AND p.prokind = 'f'
                    AND position('never_ran_overdue' IN pg_get_functiondef(p.oid)) > 0) THEN
    RAISE EXCEPTION 'النصّ الحيّ لا يحوي كتلة never_ran_overdue (v15.24) — الأساسُ مختلف، أوقِفت.';
  END IF;
END
$guard$;

-- ١) العدّاد ─────────────────────────────────────────────────────────────────
ALTER TABLE public.system_heartbeat
  ADD COLUMN IF NOT EXISTS bot_fail_streak smallint NOT NULL DEFAULT 0;

-- ٢) الدالّة ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.taki_write_heartbeat(p_disk_pct integer, p_mem_pct integer, p_backup_age_hours numeric, p_site_code integer DEFAULT NULL::integer, p_bot_ok boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cron    jsonb := public.taki_cron_health();
  v_sat     jsonb := public.taki_saturation();
  v_dbmb    numeric := round(pg_database_size(current_database()) / 1048576.0, 1);
  v_issues  jsonb := '[]'::jsonb;
  v_status  text := 'ok';
  v_prev    text;
  v_notif   timestamptz;
  v_sent    int := 0;
  v_streak  int := 0;          -- v15.33 — نبضاتُ فشلِ البوت المتتالية
  r         record;
BEGIN
  SELECT coalesce(h.bot_fail_streak,0) INTO v_streak FROM public.system_heartbeat h WHERE h.id = 1;
  IF p_disk_pct >= 90 THEN v_status := 'crit'; v_issues := v_issues || to_jsonb(format('القرص ممتلئ %s%%', p_disk_pct));
  ELSIF p_disk_pct >= 75 THEN v_status := 'warn'; v_issues := v_issues || to_jsonb(format('القرص %s%%', p_disk_pct)); END IF;

  IF p_mem_pct >= 92 THEN v_status := 'crit'; v_issues := v_issues || to_jsonb(format('الذاكرة %s%%', p_mem_pct));
  ELSIF p_mem_pct >= 85 THEN v_status := public.taki_worse(v_status,'warn'); v_issues := v_issues || to_jsonb(format('الذاكرة %s%%', p_mem_pct)); END IF;

  IF p_backup_age_hours >= 36 THEN v_status := 'crit';
    v_issues := v_issues || to_jsonb(format('آخر نسخة احتياطية قبل %s ساعة', round(p_backup_age_hours))); END IF;

  IF (v_cron->>'failed_24h')::int > 0 THEN v_status := 'crit';
    v_issues := v_issues || to_jsonb(format('وظائف فشلت خلال ٢٤ ساعة: %s', v_cron->>'failed_names')); END IF;
  -- v15.24 neverran — `never_ran` كانت تُحسب ولا تُقرأ إطلاقاً: وظيفةٌ
  --   لم تعمل ولا مرّةً واحدة كانت **غيرَ مرئيّة**، وهي أسوأُ من
  --   المتوقّفة (تلك عملت يوماً ما). وتُقال برسالتها هي لا بتلك.
  IF (v_cron->>'never_ran_overdue')::int > 0 THEN v_status := 'crit';
    v_issues := v_issues || to_jsonb(format('وظائف لم تعمل ولا مرّة: %s', v_cron->>'never_ran_overdue_names')); END IF;
  IF (v_cron->>'stalled')::int > 0 THEN v_status := 'crit';
    v_issues := v_issues || to_jsonb(format('وظائف توقّفت عن العمل: %s', v_cron->>'stalled_names')); END IF;

  -- الموقع: NULL يعني «لم يُفحص» لا «سليم». 🪤 الفرق جوهري — لو عُوملت NULL
  -- نجاحاً لصار تعطّلُ أداة الفحص نفسها يُنتج «كل شيء بخير».
  IF p_site_code IS NULL THEN v_status := public.taki_worse(v_status,'warn');
    v_issues := v_issues || to_jsonb('الموقع لم يُفحص (أداة الفحص لم تُبلّغ)'::text);
  ELSIF p_site_code <> 200 THEN v_status := 'crit';
    v_issues := v_issues || to_jsonb(format('الموقع يردّ %s', p_site_code)); END IF;

  -- ── v15.33 · ارتدادٌ على نبضتين ────────────────────────────────────────
  -- قِيس على ٣٧٢٨ نبضةً في سجلّ الخادم: فشلُ البوت وقع **مرّةً واحدة**
  -- (٠٫٠٢٧٪)، والنبضتان المحيطتان بها `ok` — أي أنه لم يكن عطلاً بل لحظةَ
  -- إعادةِ تشغيلٍ تفعلها Render من تلقائها (الخطّة free، وقد أقلع البوت
  -- ٣٠ أكتوبر ٠٥:٣٤ وآخرُ نشرٍ كان ٢٨ أكتوبر). وكلفةُ تلك الصرخة الواحدة
  -- أنها تُدرّب ناصراً على تجاهل القناة التي يجب أن تصرخ يوم يقع عطلٌ حقّ.
  -- ⇒ نبضةٌ واحدة فاشلة ليست دليلاً؛ نبضتان (≈٢٠ دقيقة) دليل.
  -- 🪤 والتأخّرُ ثمنٌ مقصود: الكشفُ صار ≤٢٠ دقيقة بدل ≤١٠.
  -- 🪤 والموقعُ **لا يُمسّ**: فشلُه في السجلّ نفسه = صفر، فلا ضجيجَ يُسكَت،
  --    وعطلُه يراه المشتري. يُقاس قبل أن يُضبط.
  IF p_bot_ok IS NULL THEN
    -- لا معلومة ⇒ لا تغيير في العدّاد (لا تصفيرَ يُضيّع فشلاً سابقاً، ولا
    -- زيادةَ تتّهم البوت بعطل أداةِ الفحص). والتحذيرُ قائمٌ كما كان.
    v_status := public.taki_worse(v_status,'warn');
    v_issues := v_issues || to_jsonb('البوت لم يُفحص (أداة الفحص لم تُبلّغ)'::text);
  ELSIF NOT p_bot_ok THEN
    v_streak := v_streak + 1;
    IF v_streak >= 2 THEN v_status := 'crit';
      v_issues := v_issues || to_jsonb(format('البوت لا يستجيب منذ %s نبضات متتالية (≈%s دقيقة) — أو إحدى خدماته ساقطة',
        v_streak, v_streak * 10)::text);
    END IF;
  ELSE
    v_streak := 0;
  END IF;

  IF v_dbmb >= 4096 THEN v_status := public.taki_worse(v_status,'warn');
    v_issues := v_issues || to_jsonb(format('حجم القاعدة %s ميجابايت', v_dbmb)); END IF;

  -- ── v14.85: الاقتراب من السقف ─────────────────────────────────────────────
  -- سقفُ التزامن هو `max_connections`، ومسبح PostgREST يأكل منه. تجاوزُه يعني
  -- أن المستخدم التالي يُردّ بـ«too many connections» — وهو عطلٌ كامل لا بطء.
  IF (v_sat->>'conn_pct')::int >= 85 THEN v_status := 'crit';
    v_issues := v_issues || to_jsonb(format('اتصالات القاعدة %s%% من السقف (%s من %s) — المستخدم التالي قد يُردّ',
      v_sat->>'conn_pct', v_sat->>'conn', v_sat->>'max_conn'));
  ELSIF (v_sat->>'conn_pct')::int >= 70 THEN v_status := public.taki_worse(v_status,'warn');
    v_issues := v_issues || to_jsonb(format('اتصالات القاعدة %s%% من السقف — يقترب', v_sat->>'conn_pct'));
  END IF;

  -- استعلامٌ عالق يخنق المسبح قبل أن يمتلئ: عشر ثوانٍ لا مبرّر لها هنا،
  -- فأثقل استعلامٍ حقيقي قِيس **٩٫٤ ميلي ثانية**.
  IF (v_sat->>'longest_ms')::int >= 30000 THEN v_status := 'crit';
    v_issues := v_issues || to_jsonb(format('استعلام عالق منذ %s ثانية', round((v_sat->>'longest_ms')::numeric/1000)));
  ELSIF (v_sat->>'longest_ms')::int >= 10000 THEN v_status := public.taki_worse(v_status,'warn');
    v_issues := v_issues || to_jsonb(format('استعلام بطيء %s ثانية', round((v_sat->>'longest_ms')::numeric/1000)));
  END IF;

  SELECT last_status, notified_at INTO v_prev, v_notif FROM public.system_heartbeat WHERE id = 1;

  UPDATE public.system_heartbeat SET
    seen_at = now(), status = v_status, issues = v_issues, last_status = v_status,
    bot_fail_streak = v_streak,
    metrics = jsonb_build_object('disk_pct', p_disk_pct, 'mem_pct', p_mem_pct,
                                 'db_mb', v_dbmb, 'backup_age_hours', round(p_backup_age_hours,1),
                                 'site_code', p_site_code, 'bot_ok', p_bot_ok, 'cron', v_cron,
                                 'bot_fail_streak', v_streak,
                                 'saturation', v_sat)
  WHERE id = 1;

  -- التنبيه: عند **دخول** حالة حرجة، أو مرّة كل ست ساعات ما دامت قائمة.
  IF v_status = 'crit'
     AND (v_prev IS DISTINCT FROM 'crit' OR v_notif IS NULL OR v_notif < now() - interval '6 hours') THEN
    FOR r IN SELECT u.id FROM public.users u WHERE u.user_type = 'admin' AND u.deleted_at IS NULL LOOP
      INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
      VALUES (r.id, '🚨 تنبيه الخادم', '🚨 Server alert',
              array_to_string(ARRAY(SELECT jsonb_array_elements_text(v_issues)), E'\n'),
              array_to_string(ARRAY(SELECT jsonb_array_elements_text(v_issues)), E'\n'),
              'system', jsonb_build_object('audience','admin','heartbeat',true), now());
      v_sent := v_sent + 1;
    END LOOP;
    UPDATE public.system_heartbeat SET notified_at = now() WHERE id = 1;
  END IF;

  RETURN jsonb_build_object('status', v_status, 'issues', v_issues, 'notified', v_sent, 'saturation', v_sat);
END $function$;

REVOKE ALL ON FUNCTION public.taki_write_heartbeat(integer,integer,numeric,integer,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_write_heartbeat(integer,integer,numeric,integer,boolean) FROM anon;
REVOKE ALL ON FUNCTION public.taki_write_heartbeat(integer,integer,numeric,integer,boolean) FROM authenticated;

-- ٣) تحقّقٌ سلوكيّ يُفشل الهجرة إن كذبت ──────────────────────────────────────
-- 🪤 داخل معاملةٍ تُلغى: النداءُ الثاني يُدرج إشعاراً حقيقياً للأدمن، فلا
--    يجوز أن يبقى. و`ROLLBACK` يمحو كلَّ أثر (الدالّةُ ليست autonomous).
-- 🪤 والتحقّقُ يشترط **الرسالةَ بعينها** لا «أي استثناء» ولا «أي حالة»:
--    حالةُ النبض قد تكون حرجةً لسببٍ آخر (كرون مثلاً) فيمرّ فحصٌ كسولٌ كاذباً.
BEGIN;
DO $test$
DECLARE r jsonb; v_s int; BOT text := 'البوت لا يستجيب'; NOTP text := 'البوت لم يُفحص';
BEGIN
  UPDATE public.system_heartbeat SET bot_fail_streak = 0 WHERE id = 1;

  -- (أ) حالةٌ موجبة: البوت سليم ⇒ لا رسالةَ بوتٍ إطلاقاً، والعدّاد صفر.
  r := public.taki_write_heartbeat(10, 20, 1.0, 200, true);
  IF position(BOT IN (r->>'issues')) > 0 THEN RAISE EXCEPTION '❌ المسارُ السليم أُقفل: بوتٌ حيّ أنتج «%»', BOT; END IF;
  SELECT bot_fail_streak INTO v_s FROM public.system_heartbeat WHERE id = 1;
  IF v_s <> 0 THEN RAISE EXCEPTION '❌ العدّاد لم يُصفَّر عند النجاح (=%)', v_s; END IF;

  -- (ب) «لم يُفحص» يبقى تحذيراً ولا يلمس العدّاد.
  r := public.taki_write_heartbeat(10, 20, 1.0, 200, NULL);
  IF position(NOTP IN (r->>'issues')) = 0 THEN RAISE EXCEPTION '❌ تحذيرُ «لم يُفحص» ضاع: %', r->>'issues'; END IF;
  SELECT bot_fail_streak INTO v_s FROM public.system_heartbeat WHERE id = 1;
  IF v_s <> 0 THEN RAISE EXCEPTION '❌ NULL غيّرت العدّاد (=%)', v_s; END IF;

  -- (ج) نبضةٌ فاشلةٌ واحدة ⇒ صامتة، والعدّاد ١.
  r := public.taki_write_heartbeat(10, 20, 1.0, 200, false);
  IF position(BOT IN (r->>'issues')) > 0 THEN RAISE EXCEPTION '❌ الارتدادُ لا يعمل: نبضةٌ واحدة صرخت'; END IF;
  SELECT bot_fail_streak INTO v_s FROM public.system_heartbeat WHERE id = 1;
  IF v_s <> 1 THEN RAISE EXCEPTION '❌ العدّاد لم يُكتب بعد أوّل فشل (=%)', v_s; END IF;

  -- (د) نبضةٌ ثانية ⇒ تصرخ. (كسرةٌ معكوسة: لو مرّت لصار الإنذار ميتاً.)
  r := public.taki_write_heartbeat(10, 20, 1.0, 200, false);
  IF position(BOT IN (r->>'issues')) = 0 THEN RAISE EXCEPTION '❌ الإنذارُ مات: نبضتان متتاليتان لم تصرخا — %', r->>'issues'; END IF;
  IF (r->>'status') <> 'crit' THEN RAISE EXCEPTION '❌ نبضتان فاشلتان ولم تُنتجا crit (=%)', r->>'status'; END IF;

  -- (هـ) التعافي يُصفّر.
  r := public.taki_write_heartbeat(10, 20, 1.0, 200, true);
  SELECT bot_fail_streak INTO v_s FROM public.system_heartbeat WHERE id = 1;
  IF v_s <> 0 THEN RAISE EXCEPTION '❌ العدّاد لم يُصفَّر بعد التعافي (=%)', v_s; END IF;

  RAISE NOTICE '✅ مُثبَت: سليم ⇒ صامت · NULL ⇒ تحذير بلا عدّ · ١ ⇒ صامت · ٢ ⇒ صرخة · تعافٍ ⇒ تصفير';
END
$test$;
ROLLBACK;

-- ٤) جدولُ القراءة (للعين — والتحقّقُ أعلاه هو الذي يُفشل) ──────────────────
SELECT 'الخادم' AS البند, current_setting('server_version') AS القيمة
UNION ALL SELECT 'القاعدة', current_database()
UNION ALL SELECT 'المختبر؟', coalesce(obj_description('public'::regnamespace,'pg_namespace'),'لا — جدّة')
UNION ALL SELECT 'عمود bot_fail_streak',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='public' AND table_name='system_heartbeat' AND column_name='bot_fail_streak')
       THEN '✅ موجود' ELSE '❌ غائب' END
UNION ALL SELECT 'الارتداد في الدالّة',
  CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                     WHERE n.nspname='public' AND p.proname='taki_write_heartbeat' AND p.prokind='f'
                       AND position('v_streak >= 2' IN pg_get_functiondef(p.oid)) > 0)
       THEN '✅ مشحون' ELSE '❌ غائب' END
UNION ALL SELECT 'كتلة never_ran_overdue (v15.24)',
  CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                     WHERE n.nspname='public' AND p.proname='taki_write_heartbeat' AND p.prokind='f'
                       AND position('never_ran_overdue' IN pg_get_functiondef(p.oid)) > 0)
       THEN '✅ باقية' ELSE '❌ مُحيت' END
UNION ALL SELECT 'العدّاد الآن', (SELECT bot_fail_streak::text FROM public.system_heartbeat WHERE id=1);
