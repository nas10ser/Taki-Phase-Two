-- ════════════════════════════════════════════════════════════════════════
-- TAKI · v15.78 — ثلاثُ دوالَّ كاتبةٍ كانت مكشوفةً للزائر المجهول
--
-- كُشفت في تدقيقٍ خصميٍّ (٨ نوفمبر ٢٠٢٦). والسببُ الجذريّ معروفٌ ومسجَّل:
-- **سوبابيس تمنح `anon` صلاحيةَ التنفيذ على كلّ دالّةٍ عامّةٍ جديدة تلقائياً**،
-- و`REVOKE … FROM anon` وحده لا يُلغي منحَ PUBLIC ولا العكس — فيلزم الاثنان.
--
-- الثلاثةُ أدواتٌ داخليّة لا يناديها المتصفّح إطلاقاً (قِيس: صفرُ موضعٍ في
-- src/ و server/ و shared/ و scripts/ و supabase/functions/)، ومنادوها
-- الحقيقيّون مشغّلٌ ودوالٌّ بصلاحية المالك وكرونٌ — فالإغلاقُ لا يكسر شيئاً:
--
--   ① _taki_wathq_enqueue(text,text,text,timestamptz)
--      تُدرج صفّاً في store_verification_checks بـver_id و kind و arg من
--      اختيار المنادي. 🔴 وكلُّ صفٍّ منها يصير **نداءً مدفوعاً** إلى واثق
--      لحظةَ تركيب المفتاح (السقفُ ٢٠٠ ريالاً شهرياً) — فزائرٌ مجهولٌ كان
--      يستطيع تسميمَ الطابور وحرقَ الميزانية. أخطرُ الثلاث.
--   ② taki_reconcile_branch_display(text)
--      تُعيد حسابَ فروعِ **أيّ متجرٍ** باسمه — فيُمكن تحريكُ ما يعرضه تاجرٌ.
--   ③ taki_prune_wathq_checks()
--      تحذف الفحوصَ التامّة الأقدمَ من ٤٠٠ يوم. الضررُ محدودٌ بالشرط، لكنّ
--      حذفَ «دليلٍ ماليّ» (تعليقُ الدالّة نفسُها) لا يكون بيد المجهول.
--
-- 🪤 و`taki_mark_session_booked` **تبقى** ممنوحةً لـanon عن قصد: يناديها
--    الزائرُ غيرُ المسجَّل من src/services/siteVisit.ts:125 لقياس الزيارات،
--    وأثرُها صفُّ تحليلاتٍ لا أكثر. إغلاقُها يكسر قياساً قائماً بلا مقابل.
-- ════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION '⛔ هذه هجرةُ إنتاج (جدة) — ومُنعت على مختبر طوكيو.';
  END IF;
END $guard$;

REVOKE ALL ON FUNCTION public._taki_wathq_enqueue(text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._taki_wathq_enqueue(text, text, text, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public._taki_wathq_enqueue(text, text, text, timestamptz) FROM authenticated;

REVOKE ALL ON FUNCTION public.taki_reconcile_branch_display(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_reconcile_branch_display(text) FROM anon;
REVOKE ALL ON FUNCTION public.taki_reconcile_branch_display(text) FROM authenticated;

REVOKE ALL ON FUNCTION public.taki_prune_wathq_checks() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_prune_wathq_checks() FROM anon;
REVOKE ALL ON FUNCTION public.taki_prune_wathq_checks() FROM authenticated;

NOTIFY pgrst, 'reload schema';

-- ───── التحقّق: سالبٌ وموجبٌ، كلُّه DO يرفع استثناءً ─────

-- ① الثلاثةُ أُغلقت على الزائر والموثَّق معاً
DO $v1$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public'
       AND p.proname IN ('_taki_wathq_enqueue','taki_reconcile_branch_display','taki_prune_wathq_checks')
  LOOP
    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION '❌ % ما زالت ممنوحةً لـanon', r.proname;
    END IF;
    IF has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION '❌ % ما زالت ممنوحةً لـauthenticated', r.proname;
    END IF;
  END LOOP;
END $v1$;

-- ② والمالكُ ما زال يقدر — وإلّا انكسر الكرونُ والمشغّل
DO $v2$
DECLARE n int;
BEGIN
  SELECT public.taki_prune_wathq_checks() INTO n;   -- تحذف ما تجاوز ٤٠٠ يوماً فقط
  IF n IS NULL THEN RAISE EXCEPTION '❌ المالك لم يستطع تنفيذ taki_prune_wathq_checks'; END IF;
  RAISE NOTICE '✅ المالكُ ينفّذ prune (حذف % صفّاً)', n;
END $v2$;

-- ③ قياسُ الزيارات لم يُكسر: الزائرُ ما زال يقدر على دالّة التحليلات
DO $v3$
BEGIN
  IF NOT has_function_privilege('anon', 'public.taki_mark_session_booked(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ كُسر قياسُ الزيارات: taki_mark_session_booked لم تبقَ متاحةً للزائر';
  END IF;
END $v3$;

-- ④ ولا دالّةَ كاتبةً أخرى مكشوفةً للزائر بلا حارسٍ وقابلةً للنداء
DO $v4$
DECLARE bad text;
BEGIN
  SELECT string_agg(proname, ', ') INTO bad FROM (
    SELECT p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
       AND p.proname NOT LIKE 'bot_%'
       AND pg_get_function_result(p.oid) <> 'trigger'
       AND regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
             ~* '(INSERT INTO|UPDATE |DELETE FROM)'
       AND regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
             !~* '(auth\.uid\(\)|_bot_gate_ok|taki_is_system_caller|taki_admin_perm|is_admin\(\)|taki_rate_check)'
       AND p.proname <> 'taki_mark_session_booked'   -- استثناءٌ مقصودٌ ومُعلَّل أعلاه
  ) s;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '❌ بقيت دوالُّ كتابةٍ مكشوفةٌ للزائر بلا حارس: %', bad;
  END IF;
END $v4$;

-- ───── جدولُ القراءة ─────
SELECT 'الخادم' AS بند, coalesce(obj_description('public'::regnamespace,'pg_namespace'),'جدة — الإنتاج') AS قيمة
UNION ALL SELECT '_taki_wathq_enqueue مُغلقةٌ على anon',
  CASE WHEN NOT has_function_privilege('anon','public._taki_wathq_enqueue(text,text,text,timestamptz)','EXECUTE') THEN '✅' ELSE '❌' END
UNION ALL SELECT 'taki_reconcile_branch_display مُغلقة',
  CASE WHEN NOT has_function_privilege('anon','public.taki_reconcile_branch_display(text)','EXECUTE') THEN '✅' ELSE '❌' END
UNION ALL SELECT 'taki_prune_wathq_checks مُغلقة',
  CASE WHEN NOT has_function_privilege('anon','public.taki_prune_wathq_checks()','EXECUTE') THEN '✅' ELSE '❌' END
UNION ALL SELECT 'قياسُ الزيارات باقٍ للزائر (مقصود)',
  CASE WHEN has_function_privilege('anon','public.taki_mark_session_booked(text)','EXECUTE') THEN '✅' ELSE '❌' END;
