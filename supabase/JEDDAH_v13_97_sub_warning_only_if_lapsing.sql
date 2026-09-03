-- ============================================================================
-- TAKI · v13.97 — تحذير قرب انتهاء الاشتراك لمن سينتهي اشتراكه فعلاً فقط
-- ============================================================================
-- طلب ناصر: «عند قرب انتهاء الاشتراك ولم يُلغِ التاجر اشتراكه لا تظهر له هذه
-- الرسالة، وإنما أظهرها فقط في حال اشترك وألغى الاشتراك الشهري وقرب الانتهاء».
--
-- قبل هذا: `taki_subscription_maintenance` ترسل التحذير لكل مشترك يقترب تاريخه،
-- ثم **تُلحق** بالنصّ سطراً يقول «سيتجدد تلقائياً». فالتاجر يقرأ عنواناً منذراً
-- «⏳ اشتراكك يقارب الانتهاء — جدّد الآن» ثم يقرأ أن شيئاً لن ينتهي. إنذارٌ
-- كاذب يُدرّب المستخدم على تجاهل إشعارات المنصة.
--
-- بعد هذا: لا يُرسَل التحذير إلا لمن **سينتهي اشتراكه فعلاً**.
--
-- ⚠️ التجارب (trial) تبقى تتلقّى التحذير: هي تنتهي فعلاً ولا تتجدّد، فالتاجر
--    يحتاج المهلة ليقرّر. الاستثناء للتجديد التلقائي وحده.
--
-- 🪤 درس من المحاولة الأولى (وقع فعلاً): كان الحارس يبحث عن
--    «sp.auto_renew IS NOT FALSE» في **كامل** نصّ الدالة — وهو موجود أصلاً في
--    قسم التجديد التلقائي (a2). فظنّ التعديل مطبَّقاً وتخطّاه، **ثم أكّد فحصٌ
--    مبنيّ على النمط نفسه نجاحاً لم يقع**. فحصٌ يتحقّق بنفس افتراض التعديل
--    لا يفحص شيئاً. الآن: المرساة سطرٌ فريد، والفحص داخل كتلة UPDATE وحدها.
--
-- آمنة للتكرار · تُطبَّق على خادم جدة حصراً.
-- ============================================================================

-- ── حارس: يرفض التنفيذ على مختبر طوكيو ──────────────────────────────────────
DO $guard$
BEGIN
  IF coalesce(obj_description('public'::regnamespace, 'pg_namespace'), '')
     = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION
      'رُفض التنفيذ: هذا مختبر طوكيو. هذه هجرة إنتاج وتُطبَّق على خادم جدة فقط.';
  END IF;
END
$guard$;

BEGIN;

DO $migrate$
DECLARE
  v_src    text;
  v_new    text;
  v_anchor text := '              AND (sp.last_expiry_warning_at IS NULL';
  v_cond   text;
  v_blk    text;
  v_pos    int;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE proname = 'taki_subscription_maintenance';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'الدالة taki_subscription_maintenance غير موجودة على هذا الخادم';
  END IF;

  -- كتلة UPDATE الخاصة بالتحذير وحدها (من UPDATE حتى LOOP) — لا كامل الدالة.
  v_pos := position('UPDATE store_profiles sp' in v_src);
  IF v_pos = 0 THEN
    RAISE EXCEPTION 'لم أجد كتلة UPDATE للتحذير — بنية الدالة تغيّرت، أوقفتُ التعديل';
  END IF;
  v_blk := substring(v_src FROM v_pos FOR position('LOOP' in substring(v_src FROM v_pos)));

  IF v_blk LIKE '%AND sp.auto_renew IS NOT FALSE%' THEN
    RAISE NOTICE 'الاستثناء مطبَّق مسبقاً داخل كتلة التحذير — لا تعديل.';
    RETURN;
  END IF;

  IF position(v_anchor in v_src) = 0 THEN
    RAISE EXCEPTION 'لم أجد المرساة (last_expiry_warning_at) — بنية الدالة تغيّرت، أوقفتُ التعديل';
  END IF;

  -- ربط صريح بـ|| : تجاور السلاسل الضمني مع بادئة E لا يُترجم في PostgreSQL.
  v_cond :=
       '              -- v13.97 (طلب ناصر): لا تحذير لمن سيتجدّد اشتراكه تلقائياً —'
    || E'\n              -- لا شيء مطلوبٌ منه، وإنذار «جدّد الآن» لمن لن ينقطع اشتراكه'
    || E'\n              -- يُدرّب المستخدم على تجاهل إشعارات المنصة.'
    || E'\n              AND NOT (lower(COALESCE(sp.subscription_plan,'''')) = ''premium'''
    || E'\n                       AND sp.auto_renew IS NOT FALSE'
    || E'\n                       AND sp.subscription_canceled_at IS NULL)'
    || E'\n'
    || v_anchor;

  v_new := replace(v_src, v_anchor, v_cond);

  -- إزالة إلحاق «سيتجدد تلقائياً»: غير قابل للتحقّق بعد الاستثناء أعلاه.
  IF position('سيتجدد اشتراكك تلقائياً' in v_new) > 0 THEN
    v_new := regexp_replace(
      v_new,
      E'\\n *IF lower\\(COALESCE\\(r\\.subscription_plan.*?\\n *END IF;',
      '', 'n');
  END IF;

  EXECUTE 'CREATE OR REPLACE FUNCTION public.taki_subscription_maintenance() '
          'RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER '
          'SET search_path = public, pg_temp AS $body$' || v_new || '$body$';
  RAISE NOTICE 'الدالة حُدِّثت.';
END
$migrate$;

COMMIT;

-- ── تقرير التحقّق (أول سطر = اسم الخادم) ────────────────────────────────────
SELECT 'الخادم' AS "الفحص",
       coalesce(obj_description('public'::regnamespace, 'pg_namespace'), '(بلا وسم)')
         || ' · db=' || current_database() AS "النتيجة",
       'ℹ️' AS "الحالة"
UNION ALL
-- الفحص داخل كتلة التحذير تحديداً — لا في كامل الدالة (سبب الإنذار الكاذب سابقاً)
SELECT 'الاستثناء داخل كتلة التحذير نفسها',
       CASE WHEN blk LIKE '%AND sp.auto_renew IS NOT FALSE%' THEN 'مطبَّق' ELSE 'غائب' END,
       CASE WHEN blk LIKE '%AND sp.auto_renew IS NOT FALSE%' THEN '✅' ELSE '❌' END
  FROM (SELECT substring(prosrc FROM position('UPDATE store_profiles sp' in prosrc)
                                FOR position('LOOP' in substring(prosrc FROM position('UPDATE store_profiles sp' in prosrc)))) AS blk
          FROM pg_proc WHERE proname = 'taki_subscription_maintenance') q
UNION ALL
SELECT 'سطر «سيتجدد تلقائياً» أُزيل',
       CASE WHEN prosrc NOT LIKE '%سيتجدد اشتراكك تلقائياً%' THEN 'نعم' ELSE 'ما زال' END,
       CASE WHEN prosrc NOT LIKE '%سيتجدد اشتراكك تلقائياً%' THEN '✅' ELSE '❌' END
  FROM pg_proc WHERE proname = 'taki_subscription_maintenance'
UNION ALL
SELECT 'قسم التجديد التلقائي لم يُمسّ',
       CASE WHEN prosrc LIKE '%(a2)%' THEN 'سليم' ELSE 'مفقود' END,
       CASE WHEN prosrc LIKE '%(a2)%' THEN '✅' ELSE '❌' END
  FROM pg_proc WHERE proname = 'taki_subscription_maintenance'
UNION ALL
SELECT 'من سيصله التحذير فعلاً الآن',
       count(*)::text || ' من ' ||
       (SELECT count(*)::text FROM store_profiles x
         WHERE x.subscription_expires_at IS NOT NULL
           AND lower(COALESCE(x.subscription_plan,'free')) IN ('premium','trial')
           AND x.subscription_expires_at > NOW()
           AND x.subscription_expires_at <= NOW() + interval '3 days'),
       'ℹ️'
  FROM store_profiles sp
 WHERE sp.subscription_expires_at IS NOT NULL
   AND lower(COALESCE(sp.subscription_plan,'free')) IN ('premium','trial')
   AND sp.subscription_expires_at > NOW()
   AND sp.subscription_expires_at <= NOW() + interval '3 days'
   AND NOT (lower(COALESCE(sp.subscription_plan,'')) = 'premium'
            AND sp.auto_renew IS NOT FALSE
            AND sp.subscription_canceled_at IS NULL);
