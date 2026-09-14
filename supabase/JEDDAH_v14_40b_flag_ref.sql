-- TAKI v14.40b — دالة الإنذارات تُرجع مرجع المحتوى (بلا مرجع لا رابط ولا إجراء)
DO $g$ BEGIN IF obj_description('public'::regnamespace,'pg_namespace')='TAKI_LAB_TOKYO_MARKER_v1382' THEN RAISE EXCEPTION 'TOKYO_LAB_REFUSED'; END IF; END $g$;
CREATE OR REPLACE FUNCTION public.admin_moderation_flags(p_store text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'kind', t.kind, 'source', t.source, 'ref_id', t.ref_id,
      'store_id', t.store_id, 'offender_id', t.offender_id, 'offender_name', t.offender_name,
      'content', t.content, 'matched', t.matched, 'status', t.status,
      'created_at', t.created_at) ORDER BY t.created_at DESC), '[]'::jsonb)
    INTO v
    FROM (
      SELECT mf.* FROM moderation_flags mf
       WHERE (p_store IS NULL OR mf.store_id = p_store OR mf.offender_id = p_store)
         AND (p_status IS NULL OR mf.status = p_status)
       ORDER BY mf.created_at DESC
       LIMIT greatest(1, least(coalesce(p_limit, 200), 2000))
    ) t;
  RETURN coalesce(v, '[]'::jsonb);
END $function$;

SELECT 'الدالة تُرجع المرجع' AS الفحص, CASE WHEN pg_get_functiondef(to_regprocedure('public.admin_moderation_flags(text,text,integer)')) LIKE '%ref_id%' THEN '✅ نعم' ELSE '❌ لا' END AS النتيجة;
