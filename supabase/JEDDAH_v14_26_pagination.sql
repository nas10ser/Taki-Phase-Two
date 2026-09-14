-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.26 — لا شيء يسقط: ترقيم الإشعارات والمراجعات
-- ════════════════════════════════════════════════════════════════════════════
-- القياس الذي أوجب هذا (١٤ سبتمبر ٢٠٢٦ على الإنتاج):
--   حسابٌ واحد لديه ٧٤٧ إشعاراً. وصفحة الإشعارات تجلب ١٠٠ وتتوقّف، بلا زرّ
--   «المزيد» ولا أي أثر. أي **٦٤٧ إشعاراً غير مرئية اليوم فعلاً** — لا في
--   المستقبل ولا عند النموّ.
--   والعدّاد على الشريط السفلي يعدّ غير المقروء **داخل المئة وحدها**، فيقول
--   «٣» ومعه سبعمئة.
--
-- المراجعات نفس الداء: سقف ١٠٠ لكل عرض ثم انقطاع صامت.
--
-- الحل هو نفس نهج `browse_deals` و`browse_bookings`: ترقيم بالمفتاح
-- (keyset) لا بالإزاحة — فصفحةٌ تُقرأ بعد وصول إشعار جديد لا تُكرّر صفّاً
-- ولا تُسقطه. والعدّ على الخادم لا في المتصفّح.
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

-- ── ١. الإشعارات ───────────────────────────────────────────────────────────
-- الترتيب (created_at DESC, id DESC): `created_at` وحده يتعادل — إشعارات
-- الحجز الواحد تُكتب في نفس المللي ثانية من نفس المشغّل. بلا فاصل ثانٍ
-- ثابت، صفٌّ يُكرَّر وآخر يُبتلع عند حدّ الصفحة.
DROP FUNCTION IF EXISTS public.browse_notifications(timestamptz, text, integer);
CREATE FUNCTION public.browse_notifications(
  p_cursor_at timestamptz DEFAULT NULL,
  p_cursor_id text        DEFAULT NULL,
  p_limit     integer     DEFAULT 40
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  text := auth.uid()::text;
  v_lim  int  := GREATEST(1, LEAST(100, COALESCE(p_limit, 40)));
  v_rows jsonb;
  v_more boolean := false;
  v_unread int;
  v_total  int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
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

  RETURN jsonb_build_object(
    'ok', true, 'rows', COALESCE(v_rows, '[]'::jsonb), 'has_more', v_more,
    'unread_total', v_unread, 'total', v_total);
END $$;

-- 🪤 فخّان متعاكسان، ولا بدّ من الاثنين معاً:
--   • الإلغاء من `anon` وحده لا يفعل شيئاً — المنح موروث من `PUBLIC`.
--   • والإلغاء من `PUBLIC` وحده لا يكفي — Supabase يمنح `anon` منحاً **مباشراً**
--     على كل دالة جديدة في `public`، وهو منحٌ مستقلّ لا يزيله الأول.
-- القياس أثبته: بعد REVOKE … FROM PUBLIC وحده قال الفحص «❌ الزائر يملك التنفيذ».
REVOKE ALL ON FUNCTION public.browse_notifications(timestamptz, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.browse_notifications(timestamptz, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.browse_notifications(timestamptz, text, integer) TO authenticated;

-- ── ٢. المراجعات ───────────────────────────────────────────────────────────
-- عامّة عمداً: المشتري يقرأ مراجعات العرض قبل أن يسجّل دخوله.
-- المتوسط والعدد يبقيان من `deals.rating_avg`/`rating_count` فلا يتأثران بالصفحة.
DROP FUNCTION IF EXISTS public.browse_deal_ratings(text, timestamptz, text, integer);
CREATE FUNCTION public.browse_deal_ratings(
  p_deal_id   text,
  p_cursor_at timestamptz DEFAULT NULL,
  p_cursor_id text        DEFAULT NULL,
  p_limit     integer     DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_lim  int := GREATEST(1, LEAST(50, COALESCE(p_limit, 20)));
  v_rows jsonb;
  v_more boolean := false;
BEGIN
  IF p_deal_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DEAL_REQUIRED');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC, r.id DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT rt.*
    FROM public.ratings rt
    WHERE rt.deal_id = p_deal_id
      AND rt.deleted_at IS NULL
      AND (
        p_cursor_at IS NULL
        OR rt.created_at < p_cursor_at
        OR (rt.created_at = p_cursor_at AND rt.id < p_cursor_id)
      )
    ORDER BY rt.created_at DESC, rt.id DESC
    LIMIT v_lim + 1
  ) r;

  IF jsonb_array_length(v_rows) > v_lim THEN
    v_more := true;
    v_rows := (SELECT jsonb_agg(e) FROM (
                 SELECT e FROM jsonb_array_elements(v_rows) e LIMIT v_lim) s);
  END IF;

  RETURN jsonb_build_object('ok', true, 'rows', COALESCE(v_rows, '[]'::jsonb), 'has_more', v_more);
END $$;

REVOKE ALL ON FUNCTION public.browse_deal_ratings(text, timestamptz, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.browse_deal_ratings(text, timestamptz, text, integer) TO anon, authenticated;

-- الفهرس الذي يجعل ترقيم المراجعات فورياً بدل مسح الجدول.
CREATE INDEX IF NOT EXISTS idx_ratings_deal_created
  ON public.ratings (deal_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق
-- ════════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS الفحص,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ مختبر طوكيو'
            ELSE '✅ جدة (الإنتاج)' END AS النتيجة
UNION ALL
SELECT 'دالة ترقيم الإشعارات',
       CASE WHEN to_regprocedure('public.browse_notifications(timestamptz,text,integer)') IS NOT NULL
            THEN '✅ موجودة' ELSE '❌ مفقودة' END
UNION ALL
SELECT 'دالة ترقيم المراجعات',
       CASE WHEN to_regprocedure('public.browse_deal_ratings(text,timestamptz,text,integer)') IS NOT NULL
            THEN '✅ موجودة' ELSE '❌ مفقودة' END
UNION ALL
SELECT 'الزائر ممنوع من الإشعارات',
       CASE WHEN has_function_privilege('anon',
              'public.browse_notifications(timestamptz,text,integer)','EXECUTE')
            THEN '❌ يملك التنفيذ' ELSE '✅ ممنوع' END
UNION ALL
SELECT 'الزائر يقرأ المراجعات',
       CASE WHEN has_function_privilege('anon',
              'public.browse_deal_ratings(text,timestamptz,text,integer)','EXECUTE')
            THEN '✅ يملك التنفيذ' ELSE '❌ ممنوع' END
UNION ALL
SELECT 'فهرس المراجعات',
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                         WHERE schemaname='public' AND indexname='idx_ratings_deal_created')
            THEN '✅ موجود' ELSE '❌ مفقود' END;
