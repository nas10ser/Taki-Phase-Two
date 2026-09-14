-- ═══════════════════════════════════════════════════════════════════════════
-- JEDDAH_v14_24_browse_refund.sql — حالة الاسترداد داخل صفّ الطلب
--
-- كشفت المراجعة الخصمية أن كل بطاقة طلبٍ مدفوع تُطلق نداء `get_booking_refund`
-- مستقلّاً عند ظهورها. عشرون طلباً في صفحة = عشرون نداءً، وثلاث صفحات = ستّون
-- نداءً متزامناً على خادم جدة، وأغلبها يعود فارغاً. وهي نفس الفجوة التي عولجت
-- للبوتين في v14.21 عبر `bot_get_my_bookings`، وبقيت في الموقع.
--
-- آمنة للتكرار (idempotent).
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
     LIKE 'TAKI_LAB_TOKYO%' THEN
    RAISE EXCEPTION
      'REFUSED: this migration targets the Jeddah production server, but this database is the Tokyo lab (%).',
      obj_description('public'::regnamespace, 'pg_namespace');
  END IF;
END
$guard$;

BEGIN;

CREATE OR REPLACE FUNCTION public.browse_bookings(p_scope text DEFAULT 'buyer'::text, p_state text DEFAULT 'all'::text, p_query text DEFAULT NULL::text, p_cursor_ts text DEFAULT NULL::text, p_cursor_id text DEFAULT NULL::text, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_me    text    := auth.uid()::text;
  v_lim   integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_q     text    := public.taki_norm(p_query);
  v_where text;
  v_page  text;
  v_out   jsonb;
  v_total bigint;
  c_cap   constant integer := 5000;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('rows','[]'::jsonb,'has_more',false,'total',0,'total_capped',false);
  END IF;

  -- RLS على bookings يحصر الرؤية أصلاً؛ هذا يفصل دور المشتري عن دور التاجر.
  IF lower(COALESCE(p_scope,'buyer')) = 'seller' THEN
    v_where := format('b.store_id = %L', v_me);
  ELSE
    v_where := format('b.user_id = %L', v_me);
  END IF;

  IF lower(COALESCE(p_state,'all')) = 'active' THEN
    v_where := v_where || ' AND b.status NOT IN (''completed'',''cancelled'')';
  ELSIF lower(COALESCE(p_state,'all')) = 'past' THEN
    v_where := v_where || ' AND b.status IN (''completed'',''cancelled'')';
  END IF;

  -- بحث مُطبَّع عربياً (نفس محرك v13.24): الباركود/اسم المنتج/المتجر/المشتري
  IF v_q IS NOT NULL THEN
    v_where := v_where || format(
      ' AND (b.search_norm LIKE %1$L'
      '      OR EXISTS (SELECT 1 FROM public.deals dd WHERE dd.id = b.deal_id'
      '                 AND dd.store_id = b.store_id AND dd.name_norm LIKE %1$L))' /* v13.31 */,
      '%' || v_q || '%');
  END IF;

  EXECUTE format(
    'SELECT count(*)::bigint FROM (SELECT 1 FROM public.bookings b WHERE %s LIMIT %s) z',
    v_where, c_cap + 1) INTO v_total;

  v_page := v_where;
  IF p_cursor_ts IS NOT NULL AND p_cursor_id IS NOT NULL THEN
    v_page := v_page || format(
      ' AND (b.created_at < (%1$L)::timestamptz'
      '   OR (b.created_at = (%1$L)::timestamptz AND b.barcode < %2$L))',
      p_cursor_ts, p_cursor_id);
  END IF;

  EXECUTE format($q$
    WITH page AS (
      SELECT b.* FROM public.bookings b
      WHERE %1$s
      ORDER BY b.created_at DESC, b.barcode DESC
      LIMIT %2$s
    ), ranked AS (
      SELECT p.*, row_number() OVER (ORDER BY p.created_at DESC, p.barcode DESC) AS _rn
      FROM page p
    )
    SELECT jsonb_build_object(
      'rows', COALESCE((
        SELECT jsonb_agg(
          to_jsonb(r) - '_rn'
          || jsonb_build_object('deal', COALESCE(
               (SELECT to_jsonb(d) - 'search_vec' - 'name_norm' - 'loc_keys'
                  FROM public.deals d WHERE d.id = r.deal_id), 'null'::jsonb))
          -- v14.24 — حالة الاسترداد داخل الصفّ. بدونها تُطلق كل بطاقة طلبٍ
          -- مدفوع نداءً مستقلّاً عند الظهور: عشرون طلباً = عشرون نداءً،
          -- وثلاث صفحات = ستّون — أغلبها يعود فارغاً.
          || jsonb_build_object('refund', (
               SELECT jsonb_build_object(
                 'barcode', rf.barcode, 'status', rf.status, 'amount', rf.amount,
                 'opened_by', rf.opened_by, 'reason', rf.reason,
                 'requested_at', rf.requested_at, 'merchant_note', rf.merchant_note,
                 'decided_at', rf.decided_at, 'refunded_at', rf.refunded_at,
                 'refund_amount', rf.refund_amount, 'refund_ref', rf.refund_ref,
                 'refund_method', rf.refund_method, 'credit_note_no', rf.credit_note_no)
                 FROM public.booking_refunds rf WHERE rf.barcode = r.barcode))
          ORDER BY r._rn)
        FROM ranked r WHERE r._rn <= %3$s), '[]'::jsonb),
      'has_more', (SELECT count(*) FROM page) > %3$s,
      'next_ts',  (SELECT r.created_at FROM ranked r WHERE r._rn = %3$s),
      'next_id',  (SELECT r.barcode    FROM ranked r WHERE r._rn = %3$s))
  $q$, v_page, v_lim + 1, v_lim) INTO v_out;

  RETURN COALESCE(v_out, jsonb_build_object('rows','[]'::jsonb,'has_more',false))
       || jsonb_build_object('total', LEAST(v_total, c_cap), 'total_capped', v_total > c_cap);
END $function$

;

COMMIT;

SELECT 'الخادم' AS "الفحص",
       COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'standard public schema') AS "النتيجة",
       CASE WHEN COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') NOT LIKE 'TAKI_LAB_TOKYO%'
            THEN '✅ جدة (إنتاج)' ELSE '❌ المختبر' END AS "الحالة";

SELECT 'صفّ الطلب يحمل حالة الاسترداد' AS "الفحص",
       CASE WHEN pg_get_functiondef(p.oid) LIKE '%booking_refunds rf%' THEN 'نعم' ELSE 'لا' END AS "النتيجة",
       CASE WHEN pg_get_functiondef(p.oid) LIKE '%booking_refunds rf%' THEN '✅' ELSE '❌' END AS "الحالة"
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='browse_bookings';
