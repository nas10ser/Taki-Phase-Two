-- ═══════════════════════════════════════════════════════════════════════════
-- v15.56 — تصحيحُ خطأٍ من صنعي، ونتيجةُ جردِ «ما لا فائدة فيه»
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 **خطأٌ أُقرّ به**: في v15.52 قلتُ إن `cron.job_run_details` «لم يُنظَّف
--    ولم يُحصَ ولا مرّة»، وأضفتُ منظّفاً بنافذة **٣٠ يوماً**. والقياسُ بعد
--    مراجعةٍ ثانية (بأمر ناصر: «تأكّد قبل الحذف») أثبت شيئين:
--
--    ١) **المنظّفُ كان موجوداً أصلاً**: `taki_cron_seen_sync` تحذف بعد
--       **٩٠ يوماً**، وتعليقُها يشرح القاعدةَ حرفاً: «أوسعَ من نافذة كشف
--       التوقّف (٦٠ يوماً)». والجدولُ بدا «غيرَ منظَّف» لأن أقدمَ صفٍّ فيه
--       من ١٩ أكتوبر — يومَ إعادةِ بناء الخادم — أي ١٨ يوماً فقط.
--
--    ٢) ونافذتي **٣٠ يوماً أضيقُ من نافذة القراءة (٦٠)**: `taki_cron_health`
--       تحسب `alive_since` بالبحث عن آخر فجوةٍ تتجاوز ساعةً خلال ٦٠ يوماً.
--       فبعد شهرٍ من التشغيل المتّصل كان `alive_since` سيصير «قبل ٣٠ يوماً»
--       بدل لحظةِ الإقلاع الحقيقيّة ⇒ **تساهلٌ في كشف توقّف الوظائف
--       الأسبوعيّة**. وهو بعينه فخُّ v15.25 الذي أحذّر منه — ووقعتُ فيه.
--
--    ⇒ يُسقط منظّفي ووظيفتُه، ويبقى المنظّفُ الصحيح. ويُضاف **الشيءُ الناقص
--      فعلاً**: `ANALYZE` — الجدولُ كان بلا إحصاءٍ إطلاقاً (`last_analyze`
--      و`last_autoanalyze` كلاهما NULL)، فكلُّ استعلامٍ عليه يُخطَّط أعمى.
--
-- ── ونتيجةُ جرد «ما لا فائدة فيه» (قياسٌ لا حدس) ──────────────────────────
--   • **الصورُ اليتيمة: ٣ ملفّات / ٥٣٨ ك.ب — لا ٥٠**. وتدرّجُ القياس درسٌ:
--       فحصٌ على `deals.images` وحدها ⇒ ٥٠ ملفاً (٣٫٨ م.ب)
--       + استثناءُ المصغّرات المشتقّة (`_t.jpg` يُشتقّ اسمُها ولا تُذكر) ⇒ ٧
--       + فحصُ **كلّ** الأعمدة الخمسة عشر الحاملة لصورة ⇒ **٣**
--     أي أن ٤٧ من ٥٠ **مستعملة**، وحذفُها بالقياس الأوّل كان سيمحو صوراً حيّة.
--     ولا تُحذف الثلاثة: المكسبُ نصفُ ميغابايت والخطرُ ليس صفراً.
--   • **الفهارسُ بصفر استعمال: تُترك**. سبعةُ فهارسَ (~٨٠٠ ك.ب) لم تُمسح قطّ —
--     وستّةُ مستخدمين لا يُثبتون شيئاً عن مليون. وفهرسُ البحث الثلاثيّ
--     (`trgm`) بالذات هو ما يُبقي البحثَ حيّاً عند النموّ.
--   • **صفرُ صفٍّ ميت** يحتاج `VACUUM` في المنصّة كلّها.
--   ⇒ الخلاصةُ الصادقة: **لا شيءَ معتبَرٌ يُنظَّف**. والحجمُ (٥٠ م.ب) ليس
--     قمامةً بل سجلُّ ٩٠ يوماً لستِّ وظائفَ تعمل كلَّ دقيقة.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_cron_seen_sync()') IS NULL THEN
    RAISE EXCEPTION 'المنظّفُ الأصليُّ غائب — لا يُسقط البديلُ قبله. أوقِفت.';
  END IF;
  -- 🪤 ولا يُسقط منظّفي قبل التحقّق أن الأصليَّ **يحذف فعلاً** بنافذةٍ أوسع.
  IF position('90 days' IN pg_get_functiondef('public.taki_cron_seen_sync()'::regprocedure)) = 0
     OR position('DELETE FROM cron.job_run_details' IN pg_get_functiondef('public.taki_cron_seen_sync()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'المنظّفُ الأصليُّ لا يحذف بنافذة ٩٠ يوماً — أوقِفت.';
  END IF;
END
$guard$;

-- ── ١) يُسقط المنظّفُ المكرَّر ووظيفتُه ───────────────────────────────────
SELECT cron.unschedule('taki-prune-cron-log')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'taki-prune-cron-log');
DROP FUNCTION IF EXISTS public.taki_prune_cron_log();

-- ── ٢) ويُضاف ما كان ناقصاً فعلاً: الإحصاء ────────────────────────────────
DO $analyze$
DECLARE v_src text; v_out text;
BEGIN
  SELECT pg_get_functiondef('public.taki_cron_seen_sync()'::regprocedure) INTO v_src;
  IF position('ANALYZE' IN upper(v_src)) > 0 THEN
    RAISE NOTICE 'ℹ️ الإحصاءُ مضافٌ أصلاً';
    RETURN;
  END IF;
  IF position($o$  DELETE FROM cron.job_run_details WHERE start_time < now() - interval '90 days';$o$ IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ لم أتعرّف على سطر الحذف في النصّ الحيّ — أوقِفت';
  END IF;
  v_out := replace(v_src,
    $o$  DELETE FROM cron.job_run_details WHERE start_time < now() - interval '90 days';$o$,
    $n$  DELETE FROM cron.job_run_details WHERE start_time < now() - interval '90 days';
  -- 🔴 v15.56 — والإحصاءُ هو ما كان ناقصاً حقّاً: الجدولُ بلا `last_analyze`
  --    ولا `last_autoanalyze` منذ نشأته، فكلُّ استعلامٍ عليه — ومنه كشفُ
  --    التوقّف نفسُه — يُخطَّط على تقديرٍ أعمى. و`autovacuum` لا يلمس
  --    مخطّط `cron` بإعداداتِ هذا التركيب (قِيس: NULL للاثنين).
  BEGIN
    EXECUTE 'ANALYZE cron.job_run_details';
  EXCEPTION WHEN OTHERS THEN NULL;   -- إحصاءٌ فاشل لا يُسقط مزامنةَ الأسماء
  END;$n$);
  IF position('ANALYZE' IN upper(v_out)) = 0
     OR position('taki_cron_seen' IN v_out) = 0
     OR position('90 days' IN v_out) = 0 THEN
    RAISE EXCEPTION '❌ الاستبدالُ أفقد الدالّةَ جزءاً — أوقِفت';
  END IF;
  EXECUTE v_out;
END
$analyze$;

ANALYZE cron.job_run_details;

-- ═══════════════════════════════════════════════════════════════════════════
-- تحقّقٌ سلوكيّ
-- ═══════════════════════════════════════════════════════════════════════════
DO $behave$
DECLARE v_before bigint; v_after bigint; v_health jsonb;
BEGIN
  -- (١) منظّفٌ واحدٌ لا اثنان، والنافذةُ أوسعُ من نافذة الكشف
  IF to_regprocedure('public.taki_prune_cron_log()') IS NOT NULL THEN
    RAISE EXCEPTION '❌ المنظّفُ المكرَّر ما زال قائماً';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'taki-prune-cron-log') THEN
    RAISE EXCEPTION '❌ وظيفةُ المنظّف المكرَّر ما زالت مجدوَلة';
  END IF;
  IF position('90 days' IN pg_get_functiondef('public.taki_cron_seen_sync()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ ضاعت نافذةُ التسعين يوماً';
  END IF;
  -- 🪤 وهذا الشرطُ أُضيف بعد كسرةٍ مرّت: صفُّ ❌ في جدول القراءة **لا يُفشل
  --    psql** (فخُّ v14.50)، فالإفشالُ يكون هنا لا هناك.
  IF position('ANALYZE' IN upper(pg_get_functiondef('public.taki_cron_seen_sync()'::regprocedure))) = 0 THEN
    RAISE EXCEPTION '❌ الإحصاءُ لم يُضف — الجدولُ يبقى بلا إحصاءٍ فيُخطَّط أعمى';
  END IF;

  -- (٢) المزامنةُ تعمل ولا تحذف شيئاً اليوم (أقدمُ صفٍّ أحدثُ من ٩٠ يوماً)
  SELECT count(*) INTO v_before FROM cron.job_run_details;
  PERFORM public.taki_cron_seen_sync();
  SELECT count(*) INTO v_after  FROM cron.job_run_details;
  IF v_after > v_before THEN RAISE EXCEPTION '❌ المزامنةُ زادت الصفوف'; END IF;

  -- (٣) وصحّةُ الكرون ما زالت تُحسب وتعرف لحظةَ الإقلاع
  v_health := public.taki_cron_health();
  IF (v_health->>'alive_since') IS NULL THEN
    RAISE EXCEPTION '❌ كشفُ التوقّف فقد لحظةَ الإقلاع';
  END IF;
  IF (v_health->>'jobs')::int < 10 THEN
    RAISE EXCEPTION '❌ عددُ الوظائف % — القراءةُ معطوبة', v_health->>'jobs';
  END IF;
END
$behave$;

SELECT 'الخادم' AS "البند", COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'جدة — الإنتاج') AS "القيمة"
UNION ALL SELECT 'منظّفاتُ سجلّ الكرون (يجب ١)',
  (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f'
      AND pg_get_functiondef(p.oid) LIKE '%DELETE FROM cron.job_run_details%')
UNION ALL SELECT 'نافذةُ التنظيف / نافذةُ الكشف', '90 يوماً / 60 يوماً ✅ أوسع'
UNION ALL SELECT 'الإحصاءُ مضاف',
  CASE WHEN position('ANALYZE' IN upper(pg_get_functiondef('public.taki_cron_seen_sync()'::regprocedure))) > 0
       THEN '✅' ELSE '❌' END
UNION ALL SELECT 'سجلُّ الكرون', (SELECT count(*)::text FROM cron.job_run_details) || ' صفّاً · '
  || pg_size_pretty(pg_total_relation_size('cron.job_run_details'))
UNION ALL SELECT 'صورٌ يتيمةٌ فعلاً (بعد فحص ١٥ عموداً)', '3 ملفّات · 538 ك.ب — تُركت عمداً'
UNION ALL SELECT 'صحّةُ الكرون', public.taki_cron_health()::text;
