-- ============================================================
-- v11.73 — Bot seller deal parity with the website
--   * expiry type / date / hours / days, size, gender, upcoming (starts_at)
--   * full edit + re-activate (status), images
--   * branches list: ALL branches + merged active-deal locations
--   * geo pickers: region -> city -> mall/market
-- All new params DEFAULT NULL -> safe during the deploy gap.
-- Applied to project kbmqzxcjdankdgiovctm via MCP apply_migration.
-- ============================================================

-- Canonical location key (shared by cap logic + branches merge) ---------------
CREATE OR REPLACE FUNCTION public.bot__loc_key(p_location_id text, p_lat double precision, p_lng double precision)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN p_location_id IS NOT NULL AND p_location_id <> 'other' AND p_location_id NOT LIKE 'custom~_%' ESCAPE '~'
      THEN 'loc:' || p_location_id
    ELSE 'geo:' || round(coalesce(p_lat,0)::numeric,3)::text || ',' || round(coalesce(p_lng,0)::numeric,3)::text
  END
$$;
GRANT EXECUTE ON FUNCTION public.bot__loc_key(text,double precision,double precision) TO anon, authenticated, service_role;

-- Geo pickers (read the seeded regions/cities/locations tables) ----------------
CREATE OR REPLACE FUNCTION public.bot_geo_regions()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name),'[]'::jsonb) FROM regions
$$;
GRANT EXECUTE ON FUNCTION public.bot_geo_regions() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bot_geo_cities(p_region text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name,'lat',lat,'lng',lng) ORDER BY name),'[]'::jsonb)
  FROM cities WHERE p_region IS NULL OR region_id = p_region
$$;
GRANT EXECUTE ON FUNCTION public.bot_geo_cities(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bot_geo_locations(p_city text, p_type text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name,'type',type,'lat',lat,'lng',lng) ORDER BY name),'[]'::jsonb)
  FROM locations WHERE city_id = p_city AND (p_type IS NULL OR type = p_type)
$$;
GRANT EXECUTE ON FUNCTION public.bot_geo_locations(text,text) TO anon, authenticated, service_role;

-- bot_add_deal — full website parity (expiry/size/gender/upcoming) -------------
DROP FUNCTION IF EXISTS public.bot_add_deal(bigint, text, numeric, numeric, integer, text, text, text[], text, text, double precision, double precision, text, text, text);
CREATE OR REPLACE FUNCTION public.bot_add_deal(
  p_telegram_id bigint, p_item_name text, p_original_price numeric, p_discounted_price numeric,
  p_quantity integer, p_description text, p_category text DEFAULT 'other',
  p_images text[] DEFAULT '{}', p_location_id text DEFAULT NULL, p_custom_location_name text DEFAULT NULL,
  p_map_lat double precision DEFAULT NULL, p_map_lng double precision DEFAULT NULL,
  p_region text DEFAULT NULL, p_city text DEFAULT NULL, p_google_maps_link text DEFAULT NULL,
  p_size text DEFAULT NULL, p_gender text DEFAULT NULL, p_expiry_type text DEFAULT NULL,
  p_expiry_date text DEFAULT NULL, p_expires_in_minutes integer DEFAULT NULL,
  p_starts_at bigint DEFAULT NULL, p_is_unlimited boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_sid text; v_shop text; v_new_id text; v_discount int; v_ref deals%ROWTYPE;
  v_unlimited boolean; v_qty integer; v_minutes integer; v_now bigint;
  v_loc text; v_cust text; v_lat double precision; v_lng double precision;
  v_region text; v_city text; v_gmap text; v_has_loc boolean;
BEGIN
  SELECT id, shop INTO v_sid, v_shop FROM users WHERE telegram_id=p_telegram_id AND user_type='seller' AND deleted_at IS NULL LIMIT 1;
  IF v_sid IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_seller'); END IF;
  IF p_discounted_price >= p_original_price THEN RETURN jsonb_build_object('success',false,'error','invalid_price'); END IF;

  SELECT * INTO v_ref FROM deals WHERE store_id=v_sid ORDER BY created_at DESC LIMIT 1;
  v_has_loc := (p_location_id IS NOT NULL) OR (p_map_lat IS NOT NULL AND p_map_lng IS NOT NULL);
  IF v_has_loc THEN
    v_loc:=p_location_id; v_cust:=p_custom_location_name; v_lat:=p_map_lat; v_lng:=p_map_lng;
    v_region:=p_region; v_city:=p_city; v_gmap:=p_google_maps_link;
  ELSE
    v_loc:=v_ref.location_id; v_cust:=v_ref.custom_location_name; v_lat:=v_ref.map_lat; v_lng:=v_ref.map_lng;
    v_region:=v_ref.region; v_city:=v_ref.city; v_gmap:=v_ref.google_maps_link;
  END IF;

  v_unlimited := COALESCE(p_is_unlimited, (p_quantity IS NULL OR p_quantity = 0));
  v_qty       := CASE WHEN v_unlimited THEN NULL ELSE GREATEST(0, p_quantity) END;
  v_minutes   := COALESCE(p_expires_in_minutes, v_ref.expires_in_minutes, 525600);
  v_discount  := ROUND(((p_original_price - p_discounted_price)/p_original_price)*100);
  v_now       := (EXTRACT(EPOCH FROM NOW())*1000)::bigint;
  v_new_id    := v_now::text;

  BEGIN
    INSERT INTO deals (id, store_id, shop_name, item_name, original_price, discounted_price,
      discount_percentage, quantity, is_unlimited, initial_quantity, images, description, category, status,
      created_at, location_id, custom_location_name, map_lat, map_lng, region, city, google_maps_link,
      expires_in_minutes, prep_time, size, gender, expiry_type, expiry_date, starts_at)
    VALUES (v_new_id, v_sid, v_shop, p_item_name, p_original_price, p_discounted_price,
      v_discount, v_qty, v_unlimited, v_qty, COALESCE(p_images,'{}'), p_description,
      COALESCE(NULLIF(btrim(COALESCE(p_category,'')),''),'other'), 'active',
      v_now, v_loc, v_cust, v_lat, v_lng, v_region, v_city, v_gmap,
      v_minutes, v_ref.prep_time, NULLIF(btrim(COALESCE(p_size,'')),''),
      COALESCE(NULLIF(btrim(COALESCE(p_gender,'')),''),'all'),
      NULLIF(btrim(COALESCE(p_expiry_type,'')),''), NULLIF(btrim(COALESCE(p_expiry_date,'')),''),
      p_starts_at);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'blocked', 'detail', SQLERRM);
  END;
  RETURN jsonb_build_object('success', true, 'deal_id', v_new_id, 'discount', v_discount);
END; $function$;
GRANT EXECUTE ON FUNCTION public.bot_add_deal(bigint,text,numeric,numeric,integer,text,text,text[],text,text,double precision,double precision,text,text,text,text,text,text,text,integer,bigint,boolean) TO anon, authenticated, service_role;

-- bot_update_deal — full edit + re-activate (status) + images ------------------
--   Field edits never touch status/location columns -> no guard/cap trigger.
--   Location changes go through bot_set_deal_location (cap enforced there).
DROP FUNCTION IF EXISTS public.bot_update_deal(bigint, text, text, numeric, numeric, integer, text, text);
CREATE OR REPLACE FUNCTION public.bot_update_deal(
  p_telegram_id bigint, p_deal_id text,
  p_item_name text DEFAULT NULL, p_original_price numeric DEFAULT NULL, p_discounted_price numeric DEFAULT NULL,
  p_quantity integer DEFAULT NULL, p_description text DEFAULT NULL, p_category text DEFAULT NULL,
  p_size text DEFAULT NULL, p_gender text DEFAULT NULL, p_expiry_type text DEFAULT NULL,
  p_expiry_date text DEFAULT NULL, p_expires_in_minutes integer DEFAULT NULL,
  p_starts_at bigint DEFAULT NULL, p_clear_schedule boolean DEFAULT false,
  p_is_unlimited boolean DEFAULT NULL, p_images text[] DEFAULT NULL, p_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_sid text; v_d deals%ROWTYPE; v_orig numeric; v_disc numeric; v_pct int; v_now bigint;
BEGIN
  SELECT id INTO v_sid FROM users WHERE telegram_id=p_telegram_id AND user_type='seller' AND deleted_at IS NULL LIMIT 1;
  IF v_sid IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_seller'); END IF;
  SELECT * INTO v_d FROM deals WHERE id=p_deal_id AND store_id=v_sid LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  v_orig := COALESCE(p_original_price, v_d.original_price);
  v_disc := COALESCE(p_discounted_price, v_d.discounted_price);
  IF v_disc >= v_orig THEN RETURN jsonb_build_object('success',false,'error','invalid_price'); END IF;
  v_pct := CASE WHEN v_orig > 0 THEN round(((v_orig - v_disc)/v_orig)*100) ELSE 0 END;

  -- (1) Field updates — NO status column -> does NOT trip tr_guard_deal_publish / cap.
  UPDATE deals SET
    item_name           = COALESCE(NULLIF(btrim(COALESCE(p_item_name,'')),''), item_name),
    original_price      = v_orig,
    discounted_price    = v_disc,
    discount_percentage = v_pct,
    quantity            = CASE WHEN p_is_unlimited IS TRUE THEN NULL
                               WHEN p_quantity IS NOT NULL THEN GREATEST(0,p_quantity)
                               ELSE quantity END,
    is_unlimited        = CASE WHEN p_is_unlimited IS NOT NULL THEN p_is_unlimited
                               WHEN p_quantity IS NOT NULL THEN (p_quantity = 0)
                               ELSE is_unlimited END,
    description         = CASE WHEN p_description IS NULL THEN description ELSE NULLIF(btrim(p_description),'') END,
    category            = COALESCE(NULLIF(btrim(COALESCE(p_category,'')),''), category),
    size                = CASE WHEN p_size IS NULL THEN size ELSE NULLIF(btrim(p_size),'') END,
    gender              = COALESCE(NULLIF(btrim(COALESCE(p_gender,'')),''), gender),
    expiry_type         = COALESCE(NULLIF(btrim(COALESCE(p_expiry_type,'')),''), expiry_type),
    expiry_date         = CASE WHEN p_expiry_type IS NOT NULL THEN NULLIF(btrim(COALESCE(p_expiry_date,'')),'') ELSE expiry_date END,
    expires_in_minutes  = COALESCE(p_expires_in_minutes, expires_in_minutes),
    starts_at           = CASE WHEN p_clear_schedule IS TRUE THEN NULL
                               WHEN p_starts_at IS NOT NULL THEN p_starts_at
                               ELSE starts_at END,
    images              = CASE WHEN p_images IS NULL THEN images ELSE p_images END
  WHERE id=p_deal_id AND store_id=v_sid;

  -- (2) Status change (re-activate / pause) — separate UPDATE OF status.
  IF p_status IS NOT NULL AND p_status <> v_d.status THEN
    v_now := (EXTRACT(EPOCH FROM NOW())*1000)::bigint;
    BEGIN
      IF p_status = 'active' THEN
        UPDATE deals SET
          status     = 'active',
          created_at = v_now,
          quantity   = CASE WHEN is_unlimited THEN NULL ELSE COALESCE(initial_quantity, quantity) END
        WHERE id=p_deal_id AND store_id=v_sid;
      ELSE
        UPDATE deals SET status = p_status WHERE id=p_deal_id AND store_id=v_sid;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success',false,'error','blocked','detail',SQLERRM);
    END;
  END IF;

  RETURN jsonb_build_object('success',true,'discount',v_pct,
    'reactivated', (p_status='active' AND v_d.status<>'active'));
END; $function$;
GRANT EXECUTE ON FUNCTION public.bot_update_deal(bigint,text,text,numeric,numeric,integer,text,text,text,text,text,text,integer,bigint,boolean,boolean,text[],text) TO anon, authenticated, service_role;

-- bot_get_seller_deal — return ALL fields for edit prefill ---------------------
CREATE OR REPLACE FUNCTION public.bot_get_seller_deal(p_telegram_id bigint, p_deal_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_sid text; v_d deals%ROWTYPE;
BEGIN
  SELECT id INTO v_sid FROM users WHERE telegram_id = p_telegram_id AND user_type = 'seller' AND deleted_at IS NULL LIMIT 1;
  IF v_sid IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_d FROM deals WHERE id = p_deal_id AND store_id = v_sid LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id', v_d.id, 'item_name', v_d.item_name, 'original_price', v_d.original_price,
    'discounted_price', v_d.discounted_price, 'discount_percentage', v_d.discount_percentage,
    'quantity', v_d.quantity, 'is_unlimited', v_d.is_unlimited, 'initial_quantity', v_d.initial_quantity,
    'status', v_d.status, 'category', v_d.category, 'description', v_d.description,
    'size', v_d.size, 'gender', v_d.gender, 'images', COALESCE(v_d.images,'{}'),
    'expiry_type', v_d.expiry_type, 'expiry_date', v_d.expiry_date,
    'expires_in_minutes', v_d.expires_in_minutes, 'starts_at', v_d.starts_at,
    'created_at', v_d.created_at,
    'location_id', v_d.location_id, 'custom_location_name', v_d.custom_location_name,
    'map_lat', v_d.map_lat, 'map_lng', v_d.map_lng, 'region', v_d.region, 'city', v_d.city,
    'google_maps_link', v_d.google_maps_link
  );
END; $function$;

-- bot_list_branches — ALL saved branches (incl. inactive) + merged active-deal
-- locations not saved as a branch (parity with the website chip-picker).
CREATE OR REPLACE FUNCTION public.bot_list_branches(p_telegram_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_sid text; v_max int; v_used int; v_items jsonb;
BEGIN
  SELECT id INTO v_sid FROM users WHERE telegram_id=p_telegram_id AND user_type='seller' AND deleted_at IS NULL LIMIT 1;
  IF v_sid IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_seller'); END IF;
  SELECT COALESCE(max_branches,3) INTO v_max FROM store_profiles WHERE store_id=v_sid;
  IF v_max IS NULL THEN v_max:=3; END IF;

  SELECT COUNT(DISTINCT bot__loc_key(location_id,map_lat,map_lng)) INTO v_used
    FROM deals WHERE store_id=v_sid AND status='active';

  WITH active_keys AS (
    SELECT DISTINCT bot__loc_key(location_id,map_lat,map_lng) AS k
    FROM deals WHERE store_id=v_sid AND status='active'
  ),
  branch_rows AS (
    SELECT
      jsonb_build_object(
        'id', b.id, 'kind','branch', 'name', b.name_ar,
        'region', b.region_id, 'city', b.city_id, 'location_id', b.location_id,
        'map_lat', b.map_lat, 'map_lng', b.map_lng, 'google_maps_link', b.google_maps_link,
        'is_primary', COALESCE(b.is_primary,false), 'is_active', COALESCE(b.is_active,true),
        'locked', bot__loc_key(b.location_id,b.map_lat,b.map_lng) IN (SELECT k FROM active_keys)
      ) AS item,
      (COALESCE(b.is_primary,false))::int AS isp, b.created_at::text AS crt
    FROM store_branches b WHERE b.merchant_id=v_sid
  ),
  deal_locs AS (
    SELECT DISTINCT ON (bot__loc_key(d.location_id,d.map_lat,d.map_lng))
      bot__loc_key(d.location_id,d.map_lat,d.map_lng) AS k,
      d.location_id, d.custom_location_name, d.map_lat, d.map_lng, d.region, d.city, d.google_maps_link, d.created_at
    FROM deals d WHERE d.store_id=v_sid AND d.status='active'
    ORDER BY bot__loc_key(d.location_id,d.map_lat,d.map_lng), d.created_at
  ),
  extra_rows AS (
    SELECT
      jsonb_build_object(
        'id', null, 'kind','deal',
        'name', COALESCE(NULLIF(btrim(COALESCE(dl.custom_location_name,'')),''),
                         (SELECT l.name FROM locations l WHERE l.id=dl.location_id),
                         (SELECT c.name FROM cities c WHERE c.id=dl.city),
                         'موقع عرض نشط'),
        'region', dl.region, 'city', dl.city, 'location_id', dl.location_id,
        'map_lat', dl.map_lat, 'map_lng', dl.map_lng, 'google_maps_link', dl.google_maps_link,
        'is_primary', false, 'is_active', true, 'locked', true
      ) AS item,
      0 AS isp, ('z'||dl.created_at::text) AS crt
    FROM deal_locs dl
    WHERE dl.k NOT IN (
      SELECT bot__loc_key(b.location_id,b.map_lat,b.map_lng) FROM store_branches b WHERE b.merchant_id=v_sid
    )
  )
  SELECT jsonb_agg(item ORDER BY isp DESC, crt) INTO v_items
  FROM (SELECT item,isp,crt FROM branch_rows UNION ALL SELECT item,isp,crt FROM extra_rows) all_rows;

  RETURN jsonb_build_object('success',true,'max',v_max,'used',v_used,'branches',COALESCE(v_items,'[]'::jsonb));
END; $function$;
