-- ════════════════════════════════════════════════════════════════════════════
-- v14.85 — إن لم نعرف السقف، فلنعرف اقترابنا منه
-- ════════════════════════════════════════════════════════════════════════════
-- بلاغ ناصر: «سقف تحمّل الخادم لم يُقَس ولا مرّة منذ الانتقال».
-- وهو صحيح، **ولا يُقاس على الإنتاج**: قاعدة المشروع منذ v13.31 أن اختبار
-- الحمل على الإنتاج أسقط الموقع خمس ساعات. والبيئة المعزولة غير موجودة بعد.
--
-- فما الذي يُفعل اليوم؟ **قياس الاقتراب بدل قياس السقف.** ما قِيس فعلاً
-- (٢٢ سبتمبر، قراءةً فقط):
--   • العتاد: ٤ أنوية · ٢٤ جيجابايت · حِمل ٠٫١٢ · قرص ١١٪
--   • القاعدة ٤٩ ميجابايت و`shared_buffers` ١٢٨ — أي أنها **كلّها في الذاكرة**
--     (إصابة الكاش ٩٩٫٩٨٪). فالذاكرة ليست السقف، ورفعُ `shared_buffers` تمثيل.
--   • أثقل استعلام حقيقي (`browse_deals`) = **٩٫٤ms**، كلّه من الذاكرة.
--   • سقف التزامن الحقيقي = مسبح PostgREST (١٠) لا العتاد.
-- ⇒ تقديرٌ محسوب (لا مقيس): ١٠ ÷ ٠٫٠٠٩٤ ≈ **ألف طلب/ثانية** للاستعلام الأثقل
--   قبل أن يبدأ الاصطفاف — والمعالج يبلغ حدّه قبل ذلك.
--   وهذا **تقديرٌ بافتراضات**، لا بديل عن اختبار حمل في بيئة معزولة.
--
-- وما يضيفه هذا الملفّ: النبض (كل ١٠ دقائق) صار يقيس **تشبّع الاتصالات**
-- و**أطول استعلامٍ عالق**. فلن نعرف السقف، لكن لن نفاجأ به: التنبيه يصل
-- جوّال ناصر قبل أن يصطفّ المستخدمون.
--
-- 🪤 و`DROP` قبل `CREATE`: إضافة معامل بـ`CREATE OR REPLACE` **لا تستبدل**،
--    بل تُنشئ نسخةً ثانية فيصير النداء ملتبساً («function is not unique»)
--    ويسكت النبض كلّه. (درس v14.25.)
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'رُفض: هذا خادم المختبر (طوكيو) — هجرات الإنتاج تُطبَّق على جدة';
  END IF;
END $guard$;

-- ١) قارئُ التشبّع — يقرأ فقط ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.taki_saturation()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'max_conn',   (SELECT setting::int FROM pg_settings WHERE name = 'max_connections'),
    'conn',       (SELECT count(*)::int FROM pg_stat_activity),
    'conn_pct',   (SELECT round(100.0 * count(*) /
                     NULLIF((SELECT setting::numeric FROM pg_settings WHERE name='max_connections'),0))::int
                   FROM pg_stat_activity),
    'active',     (SELECT count(*)::int FROM pg_stat_activity WHERE state = 'active'),
    -- أطول استعلامٍ **يعمل الآن**: استعلامٌ عالق يخنق المسبح قبل أن يمتلئ.
    -- تُستثنى عمليات الصيانة الطويلة المشروعة (autovacuum) وإلا صرخ كل ليلة.
    'longest_ms', COALESCE((SELECT round(EXTRACT(epoch FROM (now() - query_start)) * 1000)::int
                              FROM pg_stat_activity
                             WHERE state = 'active'
                               AND backend_type = 'client backend'
                               AND query NOT ILIKE '%pg_stat_activity%'
                             ORDER BY query_start ASC LIMIT 1), 0),
    'cache_hit',  (SELECT round(100.0 * sum(heap_blks_hit) /
                     NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0), 2)
                   FROM pg_statio_user_tables)
  );
$function$;

REVOKE ALL ON FUNCTION public.taki_saturation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_saturation() FROM anon;
REVOKE ALL ON FUNCTION public.taki_saturation() FROM authenticated;

-- ٢) النبض يقيس التشبّع ─────────────────────────────────────────────────────
-- 🪤 يُسقَط أوّلاً: المعاملان الجديدان بـCREATE OR REPLACE يُنشئان نسخةً ثانية.
DROP FUNCTION IF EXISTS public.taki_write_heartbeat(integer, integer, numeric, integer, boolean);

CREATE FUNCTION public.taki_write_heartbeat(
  p_disk_pct integer,
  p_mem_pct integer,
  p_backup_age_hours numeric,
  p_site_code integer DEFAULT NULL::integer,
  p_bot_ok boolean DEFAULT NULL::boolean
)
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
  r         record;
BEGIN
  IF p_disk_pct >= 90 THEN v_status := 'crit'; v_issues := v_issues || to_jsonb(format('القرص ممتلئ %s%%', p_disk_pct));
  ELSIF p_disk_pct >= 75 THEN v_status := 'warn'; v_issues := v_issues || to_jsonb(format('القرص %s%%', p_disk_pct)); END IF;

  IF p_mem_pct >= 92 THEN v_status := 'crit'; v_issues := v_issues || to_jsonb(format('الذاكرة %s%%', p_mem_pct));
  ELSIF p_mem_pct >= 85 THEN v_status := public.taki_worse(v_status,'warn'); v_issues := v_issues || to_jsonb(format('الذاكرة %s%%', p_mem_pct)); END IF;

  IF p_backup_age_hours >= 36 THEN v_status := 'crit';
    v_issues := v_issues || to_jsonb(format('آخر نسخة احتياطية قبل %s ساعة', round(p_backup_age_hours))); END IF;

  IF (v_cron->>'failed_24h')::int > 0 THEN v_status := 'crit';
    v_issues := v_issues || to_jsonb(format('وظائف فشلت خلال ٢٤ ساعة: %s', v_cron->>'failed_names')); END IF;
  IF (v_cron->>'stalled')::int > 0 THEN v_status := 'crit';
    v_issues := v_issues || to_jsonb(format('وظائف توقّفت عن العمل: %s', v_cron->>'stalled_names')); END IF;

  -- الموقع: NULL يعني «لم يُفحص» لا «سليم». 🪤 الفرق جوهري — لو عُوملت NULL
  -- نجاحاً لصار تعطّلُ أداة الفحص نفسها يُنتج «كل شيء بخير».
  IF p_site_code IS NULL THEN v_status := public.taki_worse(v_status,'warn');
    v_issues := v_issues || to_jsonb('الموقع لم يُفحص (أداة الفحص لم تُبلّغ)'::text);
  ELSIF p_site_code <> 200 THEN v_status := 'crit';
    v_issues := v_issues || to_jsonb(format('الموقع يردّ %s', p_site_code)); END IF;

  IF p_bot_ok IS NULL THEN v_status := public.taki_worse(v_status,'warn');
    v_issues := v_issues || to_jsonb('البوت لم يُفحص (أداة الفحص لم تُبلّغ)'::text);
  ELSIF NOT p_bot_ok THEN v_status := 'crit';
    v_issues := v_issues || to_jsonb('البوت لا يستجيب أو إحدى خدماته ساقطة'::text); END IF;

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
    metrics = jsonb_build_object('disk_pct', p_disk_pct, 'mem_pct', p_mem_pct,
                                 'db_mb', v_dbmb, 'backup_age_hours', round(p_backup_age_hours,1),
                                 'site_code', p_site_code, 'bot_ok', p_bot_ok, 'cron', v_cron,
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

-- ٣) تحقّقات تُفشل الهجرة إن كذبت ─────────────────────────────────────────────
DO $verify$
DECLARE n int; v jsonb;
BEGIN
  -- 🪤 نسخةٌ واحدة لا نسختان (فخّ التحميل الزائد)
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='taki_write_heartbeat';
  IF n <> 1 THEN RAISE EXCEPTION 'نسختان من taki_write_heartbeat (%) — النداء ملتبس', n; END IF;

  v := public.taki_saturation();
  IF v->>'max_conn' IS NULL OR (v->>'conn')::int < 1 THEN
    RAISE EXCEPTION 'قارئ التشبّع لا يقرأ شيئاً: %', v;
  END IF;
  IF (v->>'conn_pct')::int NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'نسبة الاتصالات خارج المدى: %', v->>'conn_pct';
  END IF;
  RAISE NOTICE '✅ v14.85 — التشبّع: % اتصالاً (%%%) · أطول استعلام %ms · كاش %%%',
    v->>'conn', v->>'conn_pct', v->>'longest_ms', v->>'cache_hit';
END $verify$;
