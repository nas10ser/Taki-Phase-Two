-- Persist the seller's chosen expiry mode (hours / days / date / stock)
-- and, for date-mode, the gregorian end date the seller picked. Without
-- these the edit form has to guess from `expires_in_minutes` and ends up
-- showing the wrong tab — e.g. a deal that ends "by date" reopens as
-- "by duration" with the days the seller never typed.

ALTER TABLE public.deals
    ADD COLUMN IF NOT EXISTS expiry_type TEXT,
    ADD COLUMN IF NOT EXISTS expiry_date TEXT;

ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_expiry_type_check;
ALTER TABLE public.deals
    ADD CONSTRAINT deals_expiry_type_check
    CHECK (expiry_type IS NULL OR expiry_type IN ('hours', 'duration', 'date', 'stock'));
