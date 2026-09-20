-- ════════════════════════════════════════════════════════════════════════════
-- v14.63 — بحثٌ داخل الإشعارات من الخادم (لا من القائمة المحمّلة)
-- ════════════════════════════════════════════════════════════════════════════
-- لماذا: الترقيم وُضع في v14.26 فانتهى «مقطوعة عند المئة»، وبقي من طلب ناصر
-- **البحث والحذف**. الحذف تكفله سياسة `notifs_delete_own` القائمة (يُنفَّذ من
-- الواجهة مباشرةً مع `.select()` للتحقّق من العدد — الحذف الذي ترفضه RLS يعود
-- بـerror=null وصفر صفوف). والبحث لا يجوز أن يكون على الصفحة المحمّلة وإلا
-- عاد العيب نفسه: من له ٧٥٠ إشعاراً يبحث في آخر ٤٠ فقط.
--
-- 🪤 `CREATE OR REPLACE` مع معاملٍ جديد **لا يستبدل** — يُنشئ نسخة ثانية فيصير
--    النداء ملتبساً («function is not unique») وتسكت الشاشة. فـ`DROP` أولاً،
--    والاثنان في معاملة واحدة فلا توجد لحظةٌ تكون فيها الدالة غائبة.
-- 🪤 والبحث العربي يمرّ بـ`taki_norm` على الطرفين: بدونها «مويه» لا تجد «موية».
-- ════════════════════════════════════════════════════════════════════════════

-- ── حارس المختبر: هذه هجرةُ إنتاج، وطوكيو مختبر ──────────────────────────
DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'رُفض: هذا خادم المختبر (طوكيو) — هجرات الإنتاج تُطبَّق على جدة';
  END IF;
END $guard$;

BEGIN;

DROP FUNCTION IF EXISTS public.browse_notifications(timestamptz, text, integer);

CREATE FUNCTION public.browse_notifications(
  p_cursor_at timestamptz DEFAULT NULL,
  p_cursor_id text        DEFAULT NULL,
  p_limit     integer     DEFAULT 40,
  p_q         text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid  text := auth.uid()::text;
  v_lim  int  := GREATEST(1, LEAST(100, COALESCE(p_limit, 40)));
  v_q    text := NULLIF(btrim(COALESCE(p_q, '')), '');
  v_pat  text;
  v_rows jsonb;
  v_more boolean := false;
  v_unread int;
  v_total  int;
  v_match  int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  END IF;

  -- النمط يُبنى مرّة واحدة بعد التطبيع، والحروف الخاصّة تُهرَّب فلا تُفسّر.
  IF v_q IS NOT NULL THEN
    v_pat := '%' || replace(replace(replace(public.taki_norm(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC, r.id DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT n.*
    FROM public.notifications n
    WHERE n.user_id = v_uid
      AND (
        p_cursor_at IS NULL
        OR n.created_at < p_cursor_at
        OR (n.created_at = p_cursor_at AND n.id < p_cursor_id)
      )
      AND (
        v_pat IS NULL
        OR public.taki_norm(n.title_ar) LIKE v_pat
        OR public.taki_norm(n.title_en) LIKE v_pat
        OR public.taki_norm(n.body_ar)  LIKE v_pat
        OR public.taki_norm(n.body_en)  LIKE v_pat
      )
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT v_lim + 1               -- صفٌّ زائد: به نعرف «هل بعدها المزيد» بلا عدٍّ ثانٍ
  ) r;

  IF jsonb_array_length(v_rows) > v_lim THEN
    v_more := true;
    v_rows := (SELECT jsonb_agg(e) FROM (
                 SELECT e FROM jsonb_array_elements(v_rows) e LIMIT v_lim) s);
  END IF;

  -- العدّان من الجدول كلّه لا من الصفحة — وهذا بيت القصيد.
  SELECT count(*) FILTER (WHERE NOT is_read), count(*)
    INTO v_unread, v_total
  FROM public.notifications WHERE user_id = v_uid;

  -- وعند البحث: عددُ المطابق كلِّه (لا المعروض) حتى لا يكذب العدّاد ثانية.
  IF v_pat IS NULL THEN
    v_match := v_total;
  ELSE
    SELECT count(*) INTO v_match
    FROM public.notifications n
    WHERE n.user_id = v_uid
      AND ( public.taki_norm(n.title_ar) LIKE v_pat
         OR public.taki_norm(n.title_en) LIKE v_pat
         OR public.taki_norm(n.body_ar)  LIKE v_pat
         OR public.taki_norm(n.body_en)  LIKE v_pat );
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'rows', COALESCE(v_rows, '[]'::jsonb), 'has_more', v_more,
    'unread_total', v_unread, 'total', v_total, 'matched', v_match);
END $function$;

REVOKE ALL ON FUNCTION public.browse_notifications(timestamptz, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.browse_notifications(timestamptz, text, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.browse_notifications(timestamptz, text, integer, text) TO authenticated;

COMMIT;

-- ── تحقّقٌ يرفع استثناءً (الجدول وحده لا يُفشل psql) ──────────────────────
DO $verify$
DECLARE
  v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt FROM pg_proc
   WHERE proname = 'browse_notifications' AND pronamespace = 'public'::regnamespace;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'فشل: عدد نسخ browse_notifications = % (المتوقَّع ١ — نسختان تعني نداءً ملتبساً)', v_cnt;
  END IF;

  IF NOT has_function_privilege('authenticated',
        'public.browse_notifications(timestamptz, text, integer, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'فشل: authenticated لا تملك EXECUTE على browse_notifications';
  END IF;

  IF has_function_privilege('anon',
        'public.browse_notifications(timestamptz, text, integer, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'فشل: anon ما زالت تملك EXECUTE — الإشعارات بيانات شخصية';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policy
                  WHERE polrelid = 'public.notifications'::regclass AND polcmd = 'd') THEN
    RAISE EXCEPTION 'فشل: لا سياسة DELETE على notifications — زرّ الحذف سيصمت';
  END IF;
END $verify$;

SELECT 'browse_notifications' AS "الدالة",
       (SELECT count(*) FROM pg_proc WHERE proname = 'browse_notifications') AS "عدد النسخ",
       current_setting('server_version') AS "إصدار الخادم",
       inet_server_addr() AS "الخادم";
