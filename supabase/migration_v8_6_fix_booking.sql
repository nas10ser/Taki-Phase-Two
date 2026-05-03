-- Fix deal quantity deduction securely

CREATE OR REPLACE FUNCTION adjust_deal_quantity()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Deduct quantity on new booking
        UPDATE deals 
        SET quantity = GREATEST(0, quantity - NEW.booked_quantity)
        WHERE id = NEW.deal_id AND is_unlimited = FALSE;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Restore quantity if cancelled
        IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
            UPDATE deals 
            SET quantity = quantity + NEW.booked_quantity 
            WHERE id = NEW.deal_id AND is_unlimited = FALSE;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_adjust_deal_quantity ON bookings;
CREATE TRIGGER trg_adjust_deal_quantity
AFTER INSERT OR UPDATE ON bookings
FOR EACH ROW EXECUTE FUNCTION adjust_deal_quantity();
