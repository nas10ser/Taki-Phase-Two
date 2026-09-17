-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.55 — التنبيه يصل فعلاً: تيليجرام خلال ثوانٍ لا بريدٌ بعد ساعات
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 قياسٌ غيّر التصميم: مراقبة التوقّف مجدولةٌ على GitHub كل **١٠ دقائق** منذ
-- أغسطس. قِست الفجوة الفعلية بين آخر ٣٠ تشغيلاً: **وسيط ٢٠٥ دقيقة**، أصغرها
-- ١٠٠ دقيقة وأكبرها ٤١٤ دقيقة (سبع ساعات). أي أن ناصر يظنّ أن لديه كشفاً خلال
-- عشر دقائق، وحقيقتُه ثلاث ساعات ونصف — وأحياناً سبع.
--
-- السبب ليس عطلاً: جدولة GitHub Actions **بذل أفضل** لا ضمان، وتُخنق بشدّة على
-- الحسابات المجانية. ومراقبةٌ تَعِد بعشر دقائق وتُعطي ثلاث ساعات ليست مراقبةً
-- ناقصة بل **طمأنينةٌ كاذبة** — وهي أسوأ من لا مراقبة، لأن المرء يبني عليها.
--
-- فالأدوار أُعيد توزيعها على ما يُحسنه كلٌّ منهما:
--   • **كرون الخادم** (مُثبَتُ الانضباط: ٣٠٠٥٥ تشغيلاً لوظيفةٍ كل دقيقتين بلا
--     فشل) يفحص كل عشر دقائق ويُنبّه — فهو الطبقة **السريعة**.
--   • **GitHub** يبقى الطبقة **الخارجية**: بطيءٌ لكنه يرى ما لا يراه الخادم —
--     موتَ الخادم نفسه. ولا يُدّعى له انضباطٌ لا يملكه.
--
-- والتنبيه لا يُرسَل بريداً بل يُكتب إشعاراً في `notifications`، فيلتقطه صندوق
-- البوت الصادر خلال **ثلاث ثوانٍ** ويصل جوّال ناصر على تيليجرام. القناة موجودة
-- وتعمل منذ v11.x — لا بنية جديدة ولا سرّ جديد.
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

CREATE OR REPLACE FUNCTION public.taki_worse(a text, b text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  -- 🪤 `GREATEST('crit','warn')` يُعيد 'warn' لأن المقارنة **أبجدية** — فحالةٌ
  -- حرجة تُخفَّض إلى تحذير بمجرّد وجود تحذيرٍ آخر معها. التصعيد يحتاج رتبةً
  -- صريحة لا ترتيب حروف.
  SELECT CASE WHEN 'crit' IN (a,b) THEN 'crit'
              WHEN 'warn' IN (a,b) THEN 'warn'
              ELSE 'ok' END;
$$;

ALTER TABLE public.system_heartbeat ADD COLUMN IF NOT EXISTS notified_at timestamptz;
ALTER TABLE public.system_heartbeat ADD COLUMN IF NOT EXISTS last_status text;

-- ════════════════════════════════════════════════════════════════════════════
-- النبض يشمل الآن الموقع والبوت — والتنبيه جزءٌ منه لا خطوةٌ منفصلة تُنسى
-- ════════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.taki_write_heartbeat(int, int, numeric);

CREATE OR REPLACE FUNCTION public.taki_write_heartbeat(
  p_disk_pct int,
  p_mem_pct int,
  p_backup_age_hours numeric,
  p_site_code int DEFAULT NULL,      -- رمز HTTP من www.takisa.net (NULL = لم يُفحص)
  p_bot_ok boolean DEFAULT NULL      -- البوت حيّ ويخدم؟ (NULL = لم يُفحص)
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_cron    jsonb := public.taki_cron_health();
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

  SELECT last_status, notified_at INTO v_prev, v_notif FROM public.system_heartbeat WHERE id = 1;

  UPDATE public.system_heartbeat SET
    seen_at = now(), status = v_status, issues = v_issues, last_status = v_status,
    metrics = jsonb_build_object('disk_pct', p_disk_pct, 'mem_pct', p_mem_pct,
                                 'db_mb', v_dbmb, 'backup_age_hours', round(p_backup_age_hours,1),
                                 'site_code', p_site_code, 'bot_ok', p_bot_ok, 'cron', v_cron)
  WHERE id = 1;

  -- التنبيه: عند **دخول** حالة حرجة، أو مرّة كل ست ساعات ما دامت قائمة.
  -- 🪤 إشعارٌ كل عشر دقائق يُدرَّب المستقبِل على تجاهله — وتنبيهٌ يُتجاهَل
  -- ليس تنبيهاً. وصمتٌ تامّ بعد الأوّل يُنسي العطل. فالوسط: عند التغيّر، ثم كل ٦س.
  IF v_status = 'crit'
     AND (v_prev IS DISTINCT FROM 'crit' OR v_notif IS NULL OR v_notif < now() - interval '6 hours') THEN
    FOR r IN SELECT u.id FROM public.users u
             WHERE u.user_type = 'admin' AND u.deleted_at IS NULL
               AND COALESCE(u.is_suspended,false) = false
    LOOP
      INSERT INTO public.notifications (id, user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
      VALUES ('ntf_sys_' || (extract(epoch from clock_timestamp())*1000)::bigint || '_' || substr(md5(random()::text),1,6),
              r.id,
              '🚨 تنبيه نظام', 'System alert',
              'خلل في خادم تاكي:' || E'\n• ' || array_to_string(ARRAY(SELECT jsonb_array_elements_text(v_issues)), E'\n• '),
              'TAKI server issue: ' || array_to_string(ARRAY(SELECT jsonb_array_elements_text(v_issues)), ' | '),
              'system', jsonb_build_object('audience','admin','kind','system_alert'));
      v_sent := v_sent + 1;
    END LOOP;
    UPDATE public.system_heartbeat SET notified_at = now() WHERE id = 1;
  END IF;

  -- وعند التعافي: رسالةٌ واحدة تُغلق القصّة، فلا يبقى ناصر يظنّ العطل قائماً.
  IF v_status = 'ok' AND v_prev = 'crit' THEN
    FOR r IN SELECT u.id FROM public.users u
             WHERE u.user_type = 'admin' AND u.deleted_at IS NULL
               AND COALESCE(u.is_suspended,false) = false
    LOOP
      INSERT INTO public.notifications (id, user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
      VALUES ('ntf_sys_' || (extract(epoch from clock_timestamp())*1000)::bigint || '_' || substr(md5(random()::text),1,6),
              r.id, '✅ عاد النظام سليماً', 'System recovered',
              'انتهى الخلل الذي نُبّهت عنه — كل الفحوص سليمة الآن.',
              'The issue is resolved — all checks are green.',
              'system', jsonb_build_object('audience','admin','kind','system_recovered'));
      v_sent := v_sent + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('status', v_status, 'issues', v_issues, 'alerts_sent', v_sent);
END $function$;

REVOKE ALL ON FUNCTION public.taki_write_heartbeat(int,int,numeric,int,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_write_heartbeat(int,int,numeric,int,boolean) FROM anon;
REVOKE ALL ON FUNCTION public.taki_write_heartbeat(int,int,numeric,int,boolean) FROM authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق — يرفع استثناءً فعلاً
-- ════════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE v jsonb; n_before bigint; n_after bigint; admins int;
BEGIN
  SELECT count(*) INTO admins FROM public.users
   WHERE user_type='admin' AND deleted_at IS NULL AND COALESCE(is_suspended,false)=false;
  IF admins < 1 THEN RAISE EXCEPTION 'VERIFY: لا أدمن يستقبل التنبيه — التنبيه بلا مستقبِل'; END IF;

  IF to_regprocedure('public.taki_write_heartbeat(int,int,numeric,int,boolean)') IS NULL THEN
    RAISE EXCEPTION 'VERIFY: الدالة الجديدة مفقودة'; END IF;
  IF to_regprocedure('public.taki_write_heartbeat(int,int,numeric)') IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: النسخة القديمة باقية — النداء سيصير ملتبساً والسكربت يسكت'; END IF;

  -- «لم يُفحص» يجب ألّا يُعامَل نجاحاً.
  v := public.taki_write_heartbeat(11, 11, 5, NULL, NULL);
  IF v->>'status' = 'ok' THEN RAISE EXCEPTION 'VERIFY: غياب الفحص عُومل نجاحاً — %', v; END IF;

  -- وحالةٌ حرجة يجب أن تُنتج إشعاراً فعلياً لكل أدمن.
  SELECT count(*) INTO n_before FROM public.notifications WHERE meta_data->>'kind'='system_alert';
  v := public.taki_write_heartbeat(97, 20, 5, 200, true);
  IF v->>'status' <> 'crit' THEN RAISE EXCEPTION 'VERIFY: قرصٌ ٩٧%% لم يُعتبر حرجاً — %', v; END IF;
  SELECT count(*) INTO n_after FROM public.notifications WHERE meta_data->>'kind'='system_alert';
  IF n_after <= n_before THEN RAISE EXCEPTION 'VERIFY: الحالة الحرجة لم تُنتج إشعاراً — تنبيهٌ بلا رسالة'; END IF;

  -- وتكرارُ نفس الحالة فوراً لا يُكرّر الإشعار (لا إغراق).
  n_before := n_after;
  PERFORM public.taki_write_heartbeat(97, 20, 5, 200, true);
  SELECT count(*) INTO n_after FROM public.notifications WHERE meta_data->>'kind'='system_alert';
  IF n_after <> n_before THEN RAISE EXCEPTION 'VERIFY: الإشعار يتكرّر كل دورة — إغراق'; END IF;

  RAISE NOTICE 'التحقّق مرّ: %ـ أدمن · «لم يُفحص» ليس نجاحاً · الحرج يُنبّه · ولا يُكرّر', admins;
  -- كل ما سبق داخل هذه المعاملة، والاستدعاء الخارجي سيُلغيها.
  RAISE EXCEPTION 'VERIFY_ROLLBACK_OK';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'VERIFY_ROLLBACK_OK' THEN RAISE; END IF;
END
$verify$;
