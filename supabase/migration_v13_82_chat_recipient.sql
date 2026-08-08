-- ═══════════════════════════════════════════════════════════════════════════
-- TAKI — v13.82 — مستلم الرسالة في محادثة الطلب  (خادم جدة)
--
-- لماذا: اشتراك الريل‑تايم على `booking_messages` هو الوحيد الباقي **بلا
-- ترشيح** بعد v13.80 — أي أن خادم الريل‑تايم يُقيّم كل رسالة في المنصّة أمام
-- كل جهاز متصل. والسبب أن الجدول لا يحمل عمود «المستلم» أصلاً: فيه المُرسِل
-- ودوره فقط، والمستلم يُستنتج من صفّ الحجز.
--
-- الحل: عمود `recipient_id` يُملأ **في القاعدة** (مشغّل BEFORE INSERT) لا في
-- الواجهة — فلا يمكن تزويره من العميل، ولا يعتمد على نيّة المُرسِل. بعده
-- يشترك كل جهاز على رسائله هو:  recipient_id = أنا  (الوارد)
--                              sender_id    = أنا  (إيصالات القراءة لرسائلي)
--
-- آمن للتكرار، ولا يمسّ رسالة قائمة إلا بملء العمود الجديد لها.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.booking_messages ADD COLUMN IF NOT EXISTS recipient_id text;

-- الطرف الآخر من الحجز، محسوباً في القاعدة.
CREATE OR REPLACE FUNCTION public.tr_booking_message_recipient()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    SELECT CASE WHEN NEW.sender_role = 'buyer' THEN b.store_id ELSE b.user_id END
      INTO NEW.recipient_id
      FROM bookings b
     WHERE b.barcode = NEW.barcode;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tr_booking_message_recipient ON public.booking_messages;
CREATE TRIGGER tr_booking_message_recipient
    BEFORE INSERT ON public.booking_messages
    FOR EACH ROW EXECUTE FUNCTION public.tr_booking_message_recipient();

-- ملء الرسائل القائمة (مرة واحدة — الصفوف المملوءة لا تُلمس).
UPDATE public.booking_messages m
   SET recipient_id = CASE WHEN m.sender_role = 'buyer' THEN b.store_id ELSE b.user_id END
  FROM public.bookings b
 WHERE b.barcode = m.barcode AND m.recipient_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_booking_messages_recipient
    ON public.booking_messages (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_messages_sender
    ON public.booking_messages (sender_id, created_at DESC);

COMMIT;

-- تحقّق: المتوقّع ✅ ✅ ٠
SELECT
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema='public' AND table_name='booking_messages'
                        AND column_name='recipient_id') THEN '✅' ELSE '❌' END AS "العمود",
    CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                      WHERE tgname='tr_booking_message_recipient' AND NOT tgisinternal) THEN '✅' ELSE '❌' END AS "المشغّل",
    (SELECT count(*) FROM public.booking_messages WHERE recipient_id IS NULL) AS "رسائل بلا مستلم";
