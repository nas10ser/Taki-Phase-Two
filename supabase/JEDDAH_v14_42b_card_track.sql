-- TAKI v14.42b — حالة التوصيل داخل بطاقات البوت
DO $g$ BEGIN IF obj_description('public'::regnamespace,'pg_namespace')='TAKI_LAB_TOKYO_MARKER_v1382' THEN RAISE EXCEPTION 'TOKYO_LAB_REFUSED'; END IF; END $g$;
CREATE OR REPLACE FUNCTION public.bot_get_seller_bookings(p_telegram_id bigint, p_scope text DEFAULT 'current'::text, p_whatsapp_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_sid text; v_res jsonb;
BEGIN
  SELECT id INTO v_sid FROM users WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id) AND user_type IN ('seller','admin') AND deleted_at IS NULL LIMIT 1;
  IF v_sid IS NULL THEN RETURN NULL; END IF;
  SELECT jsonb_agg(row ORDER BY (row->>'sort_at')::bigint DESC) INTO v_res FROM (
    SELECT jsonb_build_object(
      'barcode', b.barcode, 'user_name', COALESCE(b.user_name,'—'), 'user_phone', COALESCE(b.user_phone,'—'),
      'deal_name', d.item_name, 'quantity', b.booked_quantity, 'status', b.status,
      'notes', COALESCE(b.notes,''), 'prep_time', b.prep_time, 'sort_at', b.booked_at,
      'expiry_time', b.expiry_time,
      'unread', (SELECT count(*) FROM booking_messages m WHERE m.barcode = b.barcode AND m.sender_role='buyer' AND m.read_at IS NULL),
      'booked_at', to_timestamp(b.booked_at::double precision / 1000),
      'fulfillment', coalesce(b.fulfillment, 'pickup'),
      'delivery_fee', b.delivery_fee,
      'delivery_label', b.delivery_address->>'label',
      'delivery_details', b.delivery_address->>'details',
      'delivery_phone', b.delivery_address->>'phone',
      'delivery_lat', b.delivery_address->>'lat',
      'delivery_lng', b.delivery_address->>'lng',
      -- v14.42 — حالة التوصيل من القاعدة: بلا هذا يقرأ البوت الحالةَ من ذاكرة
      -- المحادثة التي تُمسح مع كل إعادة تشغيل، فيعرض «ابدأ البثّ» وهو جارٍ.
      'dlv_status', (SELECT dt.status FROM delivery_tracks dt WHERE dt.barcode = b.barcode),
      'payment_method', b.payment_method,
      'paid', b.paid_at IS NOT NULL
    ) AS row
    FROM bookings b JOIN deals d ON d.id = b.deal_id
    WHERE b.store_id = v_sid
      AND ( p_scope = 'all'
         OR (p_scope = 'current'  AND b.status IN ('pending','acknowledged'))
         OR (p_scope = 'previous' AND b.status IN ('completed','cancelled','expired')) )
    ORDER BY b.booked_at DESC LIMIT 30
  ) t;
  RETURN COALESCE(v_res, '[]'::jsonb);
END; $function$;

CREATE OR REPLACE FUNCTION public._booking_card(p_barcode text, p_role text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'barcode', b.barcode, 'backup_code', b.backup_code,
    'user_name', COALESCE(b.user_name,'—'), 'user_phone', COALESCE(b.user_phone,'—'),
    'shop_name', COALESCE(NULLIF(u.shop,''), NULLIF(u.name,''), '—'),
    'deal_name', COALESCE(d.item_name,'العرض'), 'deal_id', b.deal_id,
    'quantity', b.booked_quantity, 'status', b.status,
    'notes', COALESCE(b.notes,''), 'merchant_note', COALESCE(b.merchant_note,''),
    'prep_time', b.prep_time, 'sort_at', b.booked_at, 'booked_at', b.booked_at,
    'expiry_time', b.expiry_time,
    'unread', (SELECT count(*) FROM booking_messages m
               WHERE m.barcode = b.barcode
                 AND m.sender_role <> p_role AND m.read_at IS NULL),
    'fulfillment', COALESCE(b.fulfillment,'pickup'),
    'delivery_fee', b.delivery_fee,
    'delivery_label',   b.delivery_address->>'label',
    'delivery_details', b.delivery_address->>'details',
    'delivery_phone',   b.delivery_address->>'phone',
    'delivery_lat',     b.delivery_address->>'lat',
    'delivery_lng',     b.delivery_address->>'lng',
    -- v14.42 — حالة التوصيل من القاعدة: بلا هذا يقرأ البوت الحالةَ من ذاكرة
    -- المحادثة التي تُمسح مع كل إعادة تشغيل، فيعرض «ابدأ البثّ» وهو جارٍ.
    'dlv_status', (SELECT dt.status FROM delivery_tracks dt WHERE dt.barcode = b.barcode),
    'payment_method', b.payment_method,
    'paid', b.paid_at IS NOT NULL,
    'paid_amount', b.paid_amount,
    'total_amount', b.total_amount,
    'role', p_role
  )
  FROM public.bookings b
  LEFT JOIN public.deals d ON d.id = b.deal_id
  LEFT JOIN public.users u ON u.id = b.store_id
  WHERE b.barcode = p_barcode;
$function$;
SELECT 'بطاقة قائمة التاجر' AS الفحص,
  CASE WHEN pg_get_functiondef(to_regprocedure('public.bot_get_seller_bookings(bigint,text,text)')) LIKE '%dlv_status%'
  THEN '✅ تُرجع الحالة' ELSE '❌ لا' END AS النتيجة
UNION ALL SELECT 'بطاقة البحث بالباركود',
  CASE WHEN pg_get_functiondef(to_regprocedure('public._booking_card(text,text)')) LIKE '%dlv_status%'
  THEN '✅ تُرجع الحالة' ELSE '❌ لا' END;
