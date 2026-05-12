-- ============================================================================
-- v10.46 — Server-side enforcement of the 3-locations-per-seller cap
-- ============================================================================
--
-- Until now the cap (v10.42-v10.45) was enforced client-side only. A direct
-- API call (curl, another client, a future bug) could bypass it. This
-- trigger mirrors the client's locKeyOf() / activeLocationKeys logic so the
-- row is rejected at the DB itself.
--
-- Key match must be exact between client and trigger or the seller sees a
-- DB error for a deal the UI thought was fine. Both:
--   - prefix 'loc:' for catalogued location_id (mall/market/store)
--   - prefix 'geo:' for custom pins, rounded to 3 decimals (~110m)
--
-- Triggered on:
--   - INSERT (any new deal)
--   - UPDATE OF status, location_id, map_lat, map_lng (the only fields
--     that can change the active-location set)
-- Pure description / price / image edits skip the check.
--
-- Bypass: only fires when NEW.status='active'; admin user_type also bypasses.
-- Editing a deal at its own existing location is always allowed because the
-- count excludes the row being updated (d.id <> NEW.id).
--
-- Applied via Supabase MCP on 2026-05-12.

CREATE OR REPLACE FUNCTION public.enforce_seller_location_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role TEXT;
    v_max INT := 3;
    v_new_key TEXT;
    v_distinct INT;
BEGIN
    IF NEW.status IS DISTINCT FROM 'active' THEN
        RETURN NEW;
    END IF;

    SELECT user_type INTO v_role FROM users WHERE id = NEW.store_id;
    IF v_role = 'admin' THEN
        RETURN NEW;
    END IF;

    IF NEW.location_id IS NOT NULL
       AND NEW.location_id <> 'other'
       AND NEW.location_id NOT LIKE 'custom\_%' ESCAPE '\'
    THEN
        v_new_key := 'loc:' || NEW.location_id;
    ELSE
        v_new_key := 'geo:' ||
            ROUND(COALESCE(NEW.map_lat, 0)::numeric, 3)::text ||
            ',' ||
            ROUND(COALESCE(NEW.map_lng, 0)::numeric, 3)::text;
    END IF;

    SELECT COUNT(*) INTO v_distinct
    FROM (
        SELECT DISTINCT
            CASE
                WHEN d.location_id IS NOT NULL
                     AND d.location_id <> 'other'
                     AND d.location_id NOT LIKE 'custom\_%' ESCAPE '\'
                THEN 'loc:' || d.location_id
                ELSE 'geo:' ||
                     ROUND(COALESCE(d.map_lat, 0)::numeric, 3)::text || ',' ||
                     ROUND(COALESCE(d.map_lng, 0)::numeric, 3)::text
            END AS k
        FROM deals d
        WHERE d.store_id = NEW.store_id
          AND d.status = 'active'
          AND d.id <> NEW.id
    ) sub;

    IF EXISTS (
        SELECT 1 FROM deals d
        WHERE d.store_id = NEW.store_id
          AND d.status = 'active'
          AND d.id <> NEW.id
          AND (
            CASE
                WHEN d.location_id IS NOT NULL
                     AND d.location_id <> 'other'
                     AND d.location_id NOT LIKE 'custom\_%' ESCAPE '\'
                THEN 'loc:' || d.location_id
                ELSE 'geo:' ||
                     ROUND(COALESCE(d.map_lat, 0)::numeric, 3)::text || ',' ||
                     ROUND(COALESCE(d.map_lng, 0)::numeric, 3)::text
            END = v_new_key
          )
    ) THEN
        RETURN NEW;
    END IF;

    IF v_distinct >= v_max THEN
        RAISE EXCEPTION 'LOCATION_LIMIT_EXCEEDED: Plan allows % distinct locations (currently %).', v_max, v_distinct
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_location_cap ON public.deals;
CREATE TRIGGER tr_enforce_location_cap
    BEFORE INSERT OR UPDATE OF status, location_id, map_lat, map_lng
    ON public.deals
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_seller_location_cap();
