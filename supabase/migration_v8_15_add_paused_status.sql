-- Add 'paused' to the status check constraint on the deals table
-- We first drop the existing constraint and then recreate it with the new value

ALTER TABLE public.deals 
DROP CONSTRAINT IF EXISTS deals_status_check;

ALTER TABLE public.deals 
ADD CONSTRAINT deals_status_check 
CHECK (status IN ('active', 'expired', 'deleted', 'paused'));

-- Update the default if necessary (not needed as 'active' is still fine)
-- COMMENT: This ensures the 'Pause Deal' feature works at the database level.
