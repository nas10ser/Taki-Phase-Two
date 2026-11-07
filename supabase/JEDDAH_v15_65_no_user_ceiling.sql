-- ═══════════════════════════════════════════════════════════════════════════
-- v15.65 — لا سقفَ على عدد المستخدمين، وحدودُ القرص تُشتقّ من القرص
-- ═══════════════════════════════════════════════════════════════════════════
-- أمرُ ناصر: «هيأه واجعله بدون سقف ورقم محدد استعدادا لملايين المستخدمين».
--
-- 🔴 وكان في نظام الطاقة سقفٌ على **عدد المستخدمين** نفسِه: تحذيرٌ عند ٥٠٠
--    ألف وحرجٌ عند ٩٠٠ ألف — فبلوغُ المليون كان يُطلق إنذاراً أحمر يقول
--    «بلغت الطاقة القصوى» عن **نجاحٍ** لا عن عطل. وعددُ المستخدمين ليس
--    طاقةً أصلاً: الطاقةُ هي الاتصالاتُ والقرصُ والمعالج — وكلُّها مرصودةٌ
--    أصلاً. فمقياسٌ لا يدلّ على شيءٍ ويصرخ = ضجيجٌ يُدرّب على التجاهل
--    (نفسُ درس v15.24 عن «وظائف توقّفت» أثناء إطفاء الخادم).
--
-- 🔴 وحدودُ الحجم كانت مُعايَرةً لخادمٍ ميت: ٤ ج.ب للقاعدة و٢٠ ج.ب للصور
--    كُتبت لجهاز ٢٤ ج.ب رام و٢٠٠ ج.ب قرص. والجهازُ اليوم غيرُه، والقادمُ
--    غيرُهما. ⇒ تُشتقّ من **القرص المقيس** في `scripts/tune-server.sh`.
--
-- 🪤 وتُعاد بناءُ الدالّة **من نصّها الحيّ** لا من نسخةٍ مكتوبةٍ هنا: فيها
--    منطقُ تهدئةٍ وتصعيدٍ وإشعاراتٍ أُصلح على مراحل، وإعادةُ كتابتها من
--    الذاكرة تُسقط ما لا أعلمه. والفارقُ المسموح سطرٌ واحد محذوف.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'')
     = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه قاعدةُ المختبر (طوكيو) — الهجرةُ لجدة وحدها.';
  END IF;
END $$;

-- ── إزالةُ مقياس «عدد المستخدمين» من نصّ الدالّة الحيّ ───────────────────
DO $$
DECLARE
  src   text;
  out   text;
  n_before int;
  n_after  int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'taki_capacity_check' AND p.prokind = 'f';
  IF src IS NULL THEN RAISE EXCEPTION 'taki_capacity_check غير موجودة'; END IF;

  n_before := length(src);

  -- السطرُ الهدف يبدأ بـ('users', وينتهي عند آخر ''). تُحذف الفاصلةُ
  -- السابقةُ معه كي لا يبقى `,)` فينفجر التحليل.
  out := regexp_replace(
           src,
           ',\s*\(''users''\s*,\s*''عددُ المستخدمين''[^\n]*\n[^\n]*\)',
           '', 'g');

  IF out = src THEN
    RAISE EXCEPTION 'لم يُعثر على مقياس users في نصّ الدالّة — تغيّرت بنيتُها، فلا تُعدَّل عمياء';
  END IF;
  n_after := length(out);
  -- 🪤 حدٌّ على حجم الجَرح: حذفٌ أكبرُ من سطرين يعني أن النمطَ طمِع.
  IF n_before - n_after > 400 THEN
    RAISE EXCEPTION 'الحذفُ أكبرُ ممّا يجب (% محرفاً) — أُوقِف', n_before - n_after;
  END IF;
  IF out LIKE '%users_warn%' OR out LIKE '%users_crit%' THEN
    RAISE EXCEPTION 'بقيت إشارةٌ إلى سقف المستخدمين بعد الحذف';
  END IF;

  EXECUTE out;
  RAISE NOTICE '✅ أُزيل سقفُ المستخدمين (% محرفاً)', n_before - n_after;
END $$;

-- ── وتُنظَّف المفاتيحُ من الإعداد كي لا تُوهم شاشةَ الأدمن بسقفٍ قائم ────
UPDATE public.platform_settings
   SET value = value - 'users_warn' - 'users_crit'
 WHERE key = 'capacity_limits';

-- ── ويُطوى أي إنذارٍ قائمٍ على مقياسٍ لم يبقَ له وجود ────────────────────
UPDATE public.capacity_alerts SET cleared_at = now()
 WHERE metric = 'users' AND cleared_at IS NULL;

-- ── التحقّق: سلوكيٌّ ويرفع ───────────────────────────────────────────────
-- 🪤 وجودُ الدالّة لا يُثبت أنها لا تُنذر: تُنادى فعلاً ويُقرأ الأثر.
--    (ولا تُنادى بلا تنظيفٍ بعدها — فهي تكتب إشعاراتٍ لكل أدمن.)
DO $$
DECLARE
  n_users_alerts int;
  src text;
  raised int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='taki_capacity_check' AND p.prokind='f';
  IF src LIKE '%''users''%' THEN
    RAISE EXCEPTION 'مقياسُ users ما زال في نصّ الدالّة';
  END IF;

  raised := public.taki_capacity_check();

  SELECT count(*) INTO n_users_alerts
    FROM public.capacity_alerts WHERE metric='users' AND cleared_at IS NULL;
  IF n_users_alerts > 0 THEN
    RAISE EXCEPTION 'الدالّةُ ما زالت تُنذر على عدد المستخدمين';
  END IF;

  IF EXISTS (SELECT 1 FROM public.platform_settings
              WHERE key='capacity_limits' AND (value ? 'users_warn' OR value ? 'users_crit')) THEN
    RAISE EXCEPTION 'مفاتيحُ سقف المستخدمين باقيةٌ في الإعداد';
  END IF;

  RAISE NOTICE '✅ لا سقفَ على المستخدمين · الفحصُ نادى وأطلق % إنذاراً', raised;
END $$;

-- ── جدولُ القراءة ────────────────────────────────────────────────────────
SELECT 'الخادم' AS "البند", current_setting('server_version') AS "القيمة",
       CASE WHEN COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ المختبر' ELSE '✅ جدة' END AS "الحالة"
UNION ALL SELECT 'سقفُ المستخدمين', 'users_warn / users_crit',
       CASE WHEN EXISTS (SELECT 1 FROM public.platform_settings
                          WHERE key='capacity_limits' AND (value ? 'users_warn' OR value ? 'users_crit'))
            THEN '❌ باقٍ' ELSE '✅ أُزيل' END
UNION ALL SELECT 'مقاييسُ الطاقة الباقية',
       (SELECT string_agg(DISTINCT metric, ' · ') FROM public.capacity_alerts), 'ℹ️'
UNION ALL SELECT 'إنذاراتٌ قائمة',
       COALESCE((SELECT string_agg(metric||' '||level, ' · ') FROM public.capacity_alerts
                  WHERE cleared_at IS NULL), '(لا شيء)'),
       CASE WHEN EXISTS (SELECT 1 FROM public.capacity_alerts WHERE cleared_at IS NULL)
            THEN '🟠' ELSE '✅' END;
