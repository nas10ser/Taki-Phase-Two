-- TAKI v14.39b — مفتاحا الإيقاف يسريان في delivery_quote
DO $g$ BEGIN IF obj_description('public'::regnamespace,'pg_namespace')='TAKI_LAB_TOKYO_MARKER_v1382' THEN RAISE EXCEPTION 'TOKYO_LAB_REFUSED'; END IF; END $g$;
CREATE OR REPLACE FUNCTION public.delivery_quote(p_store_id text, p_lat double precision, p_lng double precision, p_location_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  sp   public.store_profiles%ROWTYPE;
  z    public.store_delivery_zones%ROWTYPE;
  -- عرضٌ بلا فرع محدّد = الموقع الأساسي للمتجر. بدون هذه المساواة يسقط كل عرضٍ
  -- ذي موقع واحد (location_id فارغ) خارج نطاقاته المرسومة على 'primary' فلا
  -- يظهر له توصيل أبداً — وهي الحالة الأشيع: متجرٌ بفروع، وعرضٌ في المحل الرئيس.
  v_loc text := coalesce(nullif(btrim(coalesce(p_location_id, '')), ''), 'primary');
  v_zone_count int;
BEGIN
  -- v14.39 — مفتاح الإيقاف العام. هذه الدالة هي المختنق الذي تمرّ به كل
  -- المسارات (الموقع والبوتان وحارس الحجز)، فالفحص هنا يُغطّيها جميعاً.
  IF NOT public.taki_delivery_globally_on() THEN
    RETURN jsonb_build_object('enabled', false, 'available', false, 'reason', 'platform_off');
  END IF;

  SELECT * INTO sp FROM public.store_profiles WHERE store_id = p_store_id;
  IF NOT FOUND OR NOT coalesce(sp.delivery_enabled, false) THEN
    RETURN jsonb_build_object('enabled', false, 'available', false, 'reason', 'disabled');
  END IF;
  -- إيقافٌ إداريّ على هذا المتجر بعينه — عمودٌ لا يملكه التاجر فلا يرفعه بضغطة.
  IF coalesce(sp.delivery_blocked_by_admin, false) THEN
    RETURN jsonb_build_object('enabled', false, 'available', false, 'reason', 'admin_blocked');
  END IF;

  -- النطاقات التي تحكم هذا الحجز: نطاقات الفرع المختار + النطاقات العامة
  -- (branch_id IS NULL) التي رُسمت قبل ربط النطاق بالفرع أو لمتجر بموقع واحد.
  SELECT count(*) INTO v_zone_count
    FROM public.store_delivery_zones dz
   WHERE dz.store_id = p_store_id AND dz.is_active
     AND (dz.branch_id IS NULL OR (v_loc IS NOT NULL AND dz.branch_id = v_loc));

  IF v_zone_count = 0 THEN
    RETURN jsonb_build_object('enabled', true, 'available', false, 'reason', 'no_zones',
      'payment', sp.delivery_payment, 'min_order', sp.delivery_min_order,
      'eta_min', sp.delivery_eta_min, 'note', sp.delivery_note);
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RETURN jsonb_build_object('enabled', true, 'available', false, 'reason', 'no_location',
      'payment', sp.delivery_payment, 'min_order', sp.delivery_min_order,
      'eta_min', sp.delivery_eta_min, 'note', sp.delivery_note);
  END IF;

  SELECT * INTO z FROM public.store_delivery_zones dz
   WHERE dz.store_id = p_store_id AND dz.is_active
     AND (dz.branch_id IS NULL OR (v_loc IS NOT NULL AND dz.branch_id = v_loc))
     AND public._taki_zone_contains(dz, p_lat, p_lng)
   ORDER BY coalesce(dz.fee, sp.delivery_fee) ASC, dz.created_at ASC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('enabled', true, 'available', false, 'reason', 'out_of_zone',
      'payment', sp.delivery_payment, 'min_order', sp.delivery_min_order,
      'eta_min', sp.delivery_eta_min, 'note', sp.delivery_note);
  END IF;

  RETURN jsonb_build_object(
    'enabled',   true,
    'available', true,
    'zone_id',   z.id,
    'zone_name', z.name,
    'branch_id', z.branch_id,
    'fee',       round(coalesce(z.fee, sp.delivery_fee), 2),
    'min_order', sp.delivery_min_order,
    'payment',   sp.delivery_payment,
    'eta_min',   sp.delivery_eta_min,
    'note',      sp.delivery_note);
END
$function$;
SELECT 'الإيقاف العام يسري' AS الفحص,
       CASE WHEN pg_get_functiondef(to_regprocedure('public.delivery_quote(text,double precision,double precision,text)'))
                 LIKE '%taki_delivery_globally_on%' THEN '✅ نعم' ELSE '❌ لا' END AS النتيجة
UNION ALL SELECT 'إيقاف المتجر يسري',
       CASE WHEN pg_get_functiondef(to_regprocedure('public.delivery_quote(text,double precision,double precision,text)'))
                 LIKE '%delivery_blocked_by_admin%' THEN '✅ نعم' ELSE '❌ لا' END;
