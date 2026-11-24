-- ════════════════════════════════════════════════════════════════════════════
-- v16.55 — إشعارُ الفائز بيد ناصر لا تلقائياً · وزرٌّ بجانب كلّ فائز
-- ════════════════════════════════════════════════════════════════════════════
-- أمرُ ناصر (٢٤ نوفمبر ٢٠٢٦): «أبغى الإشعار بعد ما يتحدّد الفائز وأنا اللي
-- أعطيه، وليس أوتوماتيكياً — لأنه قد يكون أحد الشروط أن يضع حسابه في التواصل
-- وأتأكّد أنه متابعني؛ فلو انرسل للفائز أوتوماتيك قد لا يتحقّق الشرط. وإنما
-- بعد فوزه يُوضع إشعارٌ جنبه: إرسال إشعار».
--
-- ── ما قِيس قبل كتابة سطرٍ واحد (٢٤ نوفمبر) ───────────────────────────────
--   · `draw_contest_winners` **تُرسل الإشعارَ داخلها** فور السحب — هذا هو
--     المسارُ التلقائيّ الذي يطلب ناصر فصلَه.
--   · و`admin_custom_draw` **لا تُشعر أصلاً** (سحبٌ عامٌّ من المستخدمين لا من
--     مشاركات المسابقة) ⇒ لا تُمسّ.
--   · `contests.notify_inapp` موجودٌ في الجدول و**لا تقرؤه أيُّ دالّة** —
--     عمودٌ ميّت، فلا يصلح مفتاحاً لهذا.
--   · والحالةُ الحيّة: **فائزان**، وكلاهما **أُشعر فعلاً** (إشعارٌ واحدٌ لكلّ
--     مسابقة في `notifications`). ⇒ العمودُ الجديد **يُردَم من الواقع** لا
--     يُترك فارغاً، وإلّا ظهر الزرُّ لفائزٍ أُشعر فأُرسل له ثانيةً.
--
-- 🔴 وثلاثُ دوالِّ مسابقاتٍ تحرسها `is_admin()` — وهي تُرجع TRUE لأيّ أدمنٍ
--    عند النداء المباشر من المتصفّح (ثغرةُ v14.38 المقيسة) ⇒ أدمنٌ فرعيّ
--    بصلاحية «الرئيسية» وحدها **يسحب الفائزين ويُلغيهم**. تُصحَّح الثلاثُ
--    إلى `taki_admin_perm('tab_contests')` — وهنّ في صميم ما تمسّه هذه الهجرة.
-- ════════════════════════════════════════════════════════════════════════════

-- ── ⓪ حارسُ الخادم: لا تُنفَّذ على المختبر (طوكيو) ─────────────────────────
DO $guard$
BEGIN
    IF obj_description('public'::regnamespace, 'pg_namespace')
       = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
        RAISE EXCEPTION 'هذه هجرةُ إنتاج — الخادمُ أمامها هو المختبر (طوكيو). أوقِف.';
    END IF;
END $guard$;

-- ════════════════════════════════════════════════════════════════════════════
-- ① أثرُ الإشعار على صفّ الفائز
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.contest_entries
    ADD COLUMN IF NOT EXISTS notified_at timestamptz,
    ADD COLUMN IF NOT EXISTS notified_by text;

-- 🔴 **ردمٌ من الواقع لا تركٌ فارغ.** الفائزان القائمان أُشعرا فعلاً بالمسار
--    التلقائيّ؛ ولو بقي العمودُ NULL لظهر لهما زرُّ «أرسل إشعاراً» فأُرسل
--    مرّةً ثانية. التاريخُ يُؤخذ من الإشعار نفسِه لا من `now()`.
UPDATE public.contest_entries e
   SET notified_at = n.created_at,
       notified_by = 'auto:pre-v16.55'
  FROM (
    SELECT DISTINCT ON (user_id, meta_data->>'contestId')
           user_id, meta_data->>'contestId' AS contest_id, created_at
      FROM public.notifications
     WHERE title_ar LIKE '%فزت في المسابقة%'
       AND meta_data->>'contestId' IS NOT NULL
     ORDER BY user_id, meta_data->>'contestId', created_at
  ) n
 WHERE e.is_winner
   AND e.notified_at IS NULL
   AND e.user_id = n.user_id
   AND e.contest_id::text = n.contest_id;

-- ════════════════════════════════════════════════════════════════════════════
-- ② السحبُ لا يُشعر — يسحب ويُعيد الفائزين فقط
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.draw_contest_winners(p_contest_id uuid, p_count integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v jsonb;
BEGIN
  -- 🔴 `taki_admin_perm` لا `is_admin()`: الأخيرةُ تُرجع TRUE لأيّ أدمنٍ عند
  --    النداء المباشر من المتصفّح، فكان أدمنٌ فرعيٌّ يسحب الفائزين (v14.38).
  IF NOT (SELECT public.taki_admin_perm('tab_contests')) THEN
    RAISE EXCEPTION 'forbidden: contests permission required' USING ERRCODE = '42501';
  END IF;

  -- Never reset existing winners; draw only from not-yet-winners.
  WITH picked AS (
    SELECT id FROM contest_entries
    WHERE contest_id = p_contest_id AND qualified = true AND is_winner = false
    ORDER BY random() LIMIT GREATEST(1, COALESCE(p_count, 1))
  ), upd AS (
    UPDATE contest_entries e SET is_winner = true
    FROM picked WHERE e.id = picked.id
    RETURNING e.name, e.phone, e.created_at
  )
  SELECT jsonb_agg(jsonb_build_object('name', name, 'phone', phone) ORDER BY created_at) INTO v FROM upd;

  UPDATE contests SET status = 'drawn', updated_at = now() WHERE id = p_contest_id;

  -- 🔴 v16.55 (أمرُ ناصر) — **لا إشعارَ هنا.** كان يُرسَل لحظةَ السحب، وشروطُ
  --    بعض المسابقات لا تُفحص آلياً (أن يضع حسابه في التواصل · أن يكون
  --    متابِعاً)، فيصل الفائزَ تهنئةٌ قبل أن يتحقّق ناصرُ من شرطه. والإشعارُ
  --    الآن بزرٍّ بجانب كلّ فائز: `admin_notify_contest_winner`.
  --    و`notified` يبقى في الردّ **صفراً** عمداً: المنادي القديم يقرؤه، وحذفُ
  --    المفتاح كان سيجعله `undefined` فيعرض «أُشعر غير معروف».
  RETURN jsonb_build_object('winners', COALESCE(v, '[]'::jsonb), 'notified', 0,
                            'manual_notify', true);
END
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- ③ الزرّ: إشعارُ فائزٍ واحد، بيد الأدمن
-- ════════════════════════════════════════════════════════════════════════════
-- 🪤 **فرديٌّ بالقصد، ولا زرَّ «أشعِر الجميع».** الغرضُ كلُّه أن يتحقّق ناصر
--    من شرط كلّ فائزٍ على حدة قبل أن يهنّئه — وزرُّ «الكلّ» يُعيد المسارَ
--    التلقائيَّ بخطوةٍ إضافية ويُلغي سببَ الطلب.
CREATE OR REPLACE FUNCTION public.admin_notify_contest_winner(p_entry_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_me    text := (SELECT auth.uid())::text;
  e       public.contest_entries%ROWTYPE;
  v_title text;
  v_prize text;
  v_uid   text;
BEGIN
  IF NOT (SELECT public.taki_admin_perm('tab_contests')) THEN
    RAISE EXCEPTION 'forbidden: contests permission required' USING ERRCODE = '42501';
  END IF;

  -- القفلُ قبل القراءة: ضغطتان متزامنتان لا تقرآن `notified_at` الفارغ معاً.
  SELECT * INTO e FROM public.contest_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT e.is_winner THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_WINNER'); END IF;

  -- خاملةُ التكرار: ضغطةٌ ثانية لا تُرسل تهنئةً ثانية.
  IF e.notified_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'notified_at', e.notified_at);
  END IF;

  -- 🪤 الربطُ بالحساب لا بنصّ الجوال (درس v14.77: من غيّر جوّاله بعد المشاركة
  --    كان يضيع)، والجوالُ مسارٌ احتياطيٌّ للصفوف الأقدم.
  v_uid := e.user_id;
  IF v_uid IS NULL THEN
    SELECT u.id INTO v_uid FROM public.users u
     WHERE NULLIF(btrim(u.phone),'') = btrim(e.phone) AND u.deleted_at IS NULL
     LIMIT 1;
  END IF;
  IF v_uid IS NULL THEN
    -- لا حسابَ ⇒ لا صندوقَ إشعاراتٍ يصله شيء. يُقال صراحةً بدل ختمٍ كاذب.
    RETURN jsonb_build_object('ok', false, 'error', 'NO_ACCOUNT');
  END IF;

  SELECT c.title, COALESCE(NULLIF(btrim(c.prize), ''), '') INTO v_title, v_prize
    FROM public.contests c WHERE c.id = e.contest_id;

  INSERT INTO public.notifications
    (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
  VALUES (v_uid,
    '🎉 مبروك! فزت في المسابقة',
    '🎉 Congratulations! You won',
    'فزت في «' || COALESCE(v_title, 'المسابقة') || '»'
      || CASE WHEN v_prize <> '' THEN ' — الجائزة: ' || v_prize ELSE '' END
      || '. سنتواصل معك لتسليم الجائزة.',
    'You won "' || COALESCE(v_title, 'the contest') || '"'
      || CASE WHEN v_prize <> '' THEN ' — prize: ' || v_prize ELSE '' END
      || '. We will contact you to hand it over.',
    'contest',
    jsonb_build_object('audience', 'buyer', 'actionUrl', '/contests',
                       'action_url', '/contests', 'contestId', e.contest_id));

  UPDATE public.contest_entries
     SET notified_at = now(), notified_by = v_me
   WHERE id = p_entry_id;

  RETURN jsonb_build_object('ok', true, 'notified_at', now(), 'user_id', v_uid);
END
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- ④ «إلغاء الفائزين» يُصفّر أثرَ الإشعار — وحارسُه يُصحَّح
-- ════════════════════════════════════════════════════════════════════════════
-- 🪤 التصفيرُ مقصود: «إلغاء الفائزين» بدءٌ من جديدٍ صراحةً، فمن فاز ثانيةً
--    بعد إعادة السحب يستحقّ زرّاً يُضغط له. والإشعارُ القديم يبقى في صندوقه
--    شاهداً — ولا تمحوه المنصّة من تلقائها.
DO $fix$
DECLARE v_src text; v_new text;
BEGIN
  v_src := pg_get_functiondef('public.admin_reset_contest_winners'::regproc);
  -- يُستبدل الحارسُ من **النصّ الحيّ** لا من نسخةٍ مكتوبةٍ هنا: الدالّةُ قد
  -- تحمل منطقاً لا نعلمه، وكتابتُها من الذاكرة كانت ستُسقطه (درس v16.50).
  IF position('is_admin()' IN v_src) = 0 THEN
    RAISE EXCEPTION 'لم أجد is_admin() في admin_reset_contest_winners — تغيّرت المرساة، أوقِف';
  END IF;
  v_new := replace(v_src, 'public.is_admin()', '(SELECT public.taki_admin_perm(''tab_contests''))');
  v_new := replace(v_new, 'NOT is_admin()', 'NOT (SELECT public.taki_admin_perm(''tab_contests''))');
  IF position('is_admin()' IN regexp_replace(v_new, 'taki_admin_perm', 'X', 'g')) > 0 THEN
    RAISE EXCEPTION 'بقيَ is_admin() في admin_reset_contest_winners بعد الاستبدال';
  END IF;
  EXECUTE v_new;
END $fix$;

DO $fix2$
DECLARE v_src text; v_new text;
BEGIN
  v_src := pg_get_functiondef('public.admin_custom_draw'::regproc);
  IF position('is_admin()' IN v_src) = 0 THEN
    RAISE EXCEPTION 'لم أجد is_admin() في admin_custom_draw — تغيّرت المرساة، أوقِف';
  END IF;
  v_new := replace(v_src, 'public.is_admin()', '(SELECT public.taki_admin_perm(''tab_contests''))');
  v_new := replace(v_new, 'NOT is_admin()', 'NOT (SELECT public.taki_admin_perm(''tab_contests''))');
  IF position('is_admin()' IN regexp_replace(v_new, 'taki_admin_perm', 'X', 'g')) > 0 THEN
    RAISE EXCEPTION 'بقيَ is_admin() في admin_custom_draw بعد الاستبدال';
  END IF;
  EXECUTE v_new;
END $fix2$;

-- وتصفيرُ أثر الإشعار عند إعادة البدء — يُضاف إلى الدالّة المصحَّحة للتوّ.
DO $fix3$
DECLARE v_src text; v_new text;
BEGIN
  v_src := pg_get_functiondef('public.admin_reset_contest_winners'::regproc);
  IF position('notified_at' IN v_src) > 0 THEN
    RETURN;                                   -- خاملةُ التكرار
  END IF;
  IF position('is_winner = false' IN v_src) = 0 THEN
    RAISE EXCEPTION 'لم أجد تصفيرَ is_winner في admin_reset_contest_winners — أوقِف';
  END IF;
  v_new := replace(v_src, 'is_winner = false',
                   'is_winner = false, notified_at = NULL, notified_by = NULL');
  EXECUTE v_new;
END $fix3$;

REVOKE ALL ON FUNCTION public.admin_notify_contest_winner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_notify_contest_winner(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑤ التحقّق — `DO` يرفع استثناءً (جدولُ ✅/❌ لا يُفشل psql — درس v14.51)
-- ════════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE v_n integer; v_src text;
BEGIN
    -- (أ) السحبُ لم يعد يُشعر — يُقاس **جسمُ الدالّة** مجرَّداً من التعليق
    v_src := regexp_replace(pg_get_functiondef('public.draw_contest_winners'::regproc), '--[^\n]*', '', 'g');
    IF position('INSERT INTO notifications' IN v_src) > 0
       OR position('INSERT INTO public.notifications' IN v_src) > 0 THEN
        RAISE EXCEPTION 'الفحص ①: السحبُ ما زال يُرسل إشعاراً تلقائياً';
    END IF;

    -- (ب) ولا تُستعمل `is_admin()` في أيّ دالّة مسابقاتٍ مسّتها الهجرة
    FOR v_src IN
        SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.prokind = 'f'
           AND p.proname IN ('draw_contest_winners','admin_reset_contest_winners','admin_custom_draw')
           AND position('is_admin()' IN regexp_replace(
                 regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g'),
                 'taki_admin_perm', 'X', 'g')) > 0
    LOOP
        RAISE EXCEPTION 'الفحص ②: % ما زالت تحرسها is_admin() — أيُّ أدمنٍ فرعيّ ينفّذها', v_src;
    END LOOP;

    -- (ج) دالّةُ الإشعار موجودةٌ ومقفلةٌ عن المجهول
    IF has_function_privilege('anon','public.admin_notify_contest_winner(uuid)','EXECUTE') THEN
        RAISE EXCEPTION 'الفحص ③: `anon` ينفّذ إشعارَ الفائز';
    END IF;

    -- (د) الردمُ وقع: كلُّ فائزٍ له إشعارٌ في الصندوق صار له `notified_at`
    SELECT count(*) INTO v_n
      FROM public.contest_entries e
     WHERE e.is_winner AND e.notified_at IS NULL
       AND EXISTS (SELECT 1 FROM public.notifications n
                    WHERE n.user_id = e.user_id
                      AND n.meta_data->>'contestId' = e.contest_id::text
                      AND n.title_ar LIKE '%فزت في المسابقة%');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'الفحص ④: % فائزاً أُشعر فعلاً وبقي عمودُه فارغاً ⇒ سيُشعر مرّتين', v_n;
    END IF;

    -- (هـ) وإعادةُ البدء تُصفّر الأثر
    IF position('notified_at = NULL' IN
         pg_get_functiondef('public.admin_reset_contest_winners'::regproc)) = 0 THEN
        RAISE EXCEPTION 'الفحص ⑤: «إلغاء الفائزين» لا يُصفّر أثرَ الإشعار';
    END IF;

    RAISE NOTICE '✅ v16.55 — كلُّ الفحوص الخمسة نجحت';
END $verify$;

SELECT 'فائزون' AS "البند", count(*)::text AS "القيمة" FROM public.contest_entries WHERE is_winner
UNION ALL SELECT 'منهم أُشعروا', (SELECT count(*)::text FROM public.contest_entries WHERE is_winner AND notified_at IS NOT NULL)
UNION ALL SELECT 'بانتظار إشعارك', (SELECT count(*)::text FROM public.contest_entries WHERE is_winner AND notified_at IS NULL);
