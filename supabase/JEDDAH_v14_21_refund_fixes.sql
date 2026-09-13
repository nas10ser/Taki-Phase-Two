-- ═══════════════════════════════════════════════════════════════════════════
-- JEDDAH_v14_21_refund_fixes.sql — ستّة عيوب كشفتها المراجعة الخصمية لـv14.18
--
-- كُتب هذا الملف بعد مراجعة خصمية لعمل اليوم نفسه. كل بند أدناه **عيبٌ حقيقي**
-- بسيناريو مُعاد، لا ملاحظة أسلوب:
--
--  ١) 🔴 **إلغاء الاسترداد يُطلق إشعار «انتهت المهلة».** `resolve_booking_refund`
--     تضع `status='cancelled'`، فيوقظ ذلك مشغّلَ الإشعارات الذي يحسب «منتهٍ» من
--     `expiry_time` — والدفع لا يمسحه. فكل استرداد يُبتّ بعد المهلة (أي أغلبها)
--     كان يُرسل للمشتري فوق «أكّد التاجر ردّ المبلغ»: «⏰ انتهت مدة حجزك فأُلغي
--     تلقائياً»، وللتاجر «أُلغي دون استلام»، وللإدارة «انتهاء حجز تلقائي».
--     ثلاث رسائل كاذبة على حدث واحد صحيح.
--  ٢) **«أُلغي الطلب وعادت الكمّية» تُقال دائماً** وإن لم يقع إلغاء. طلبٌ اكتمل
--     ثم رُدّ ماله يبقى مكتملاً (البضاعة خرجت فعلاً) ولا تعود كمّيته — والرسالة
--     كانت تؤكّد العكس للتاجر.
--  ٣) **لا قفل على الصفّ**: قراءةٌ بلا `FOR UPDATE` تسمح بسباق بين «استلمتُ
--     طلبي» و«أكّدتُ الردّ».
--  ٤) **حارس «رُدّ أصلاً» بعد فرع `open` لا قبله**: فيُعاد فتح استردادٍ مُغلق،
--     ثم يُصدَر له إشعار دائن ثانٍ ويُهدر رقم من سلسلة التاجر.
--  ٥) **مسار «إلغاء وتسجيل الدَّين» يقول للمشتري «ألغى التاجر طلبك»** بينما
--     الطلب ما زال نشطاً في حجوزاته برمزه القابل للمسح. وعدٌ لا يطابق الشاشة.
--  ٦) **الإشعار الدائن لا يظهر في فاتورة البوتين**: `bot_booking_refund_line`
--     كُتبت ولم تُنادَ قطّ، ومسحوبة أصلاً من الدور الوحيد الذي يملكه البوتان.
--     البديل الصحيح: تُدرَج بيانات الاسترداد داخل `bot_get_booking_invoice`.
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

-- ═══ ١) مشغّل الإشعارات يصمت عن إلغاء الاسترداد ═══════════════════════════
CREATE OR REPLACE FUNCTION public.handle_booking_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    item_name   TEXT;
    buyer_name  TEXT;
    seller_name TEXT;
    admin_id    TEXT;
    v_expired   boolean;
    v_now       bigint := (EXTRACT(EPOCH FROM NOW())*1000)::bigint;
BEGIN
    SELECT d.item_name INTO item_name FROM public.deals d WHERE d.id = NEW.deal_id;
    item_name := COALESCE(item_name, 'العرض');
    SELECT COALESCE(u.name, u.shop, '') INTO buyer_name FROM public.users u WHERE u.id = NEW.user_id;
    buyer_name := COALESCE(NULLIF(buyer_name, ''), 'مشتري');
    SELECT COALESCE(u.shop, u.name, '') INTO seller_name FROM public.users u WHERE u.id = NEW.store_id;
    seller_name := COALESCE(NULLIF(seller_name, ''), 'التاجر');

    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
        VALUES (NEW.store_id, '📦 طلب حجز جديد!', '📦 New Booking Request!',
            'طلب جديد من ' || buyer_name || ' لـ ' || item_name || ' (' || NEW.booked_quantity || ' قطعة).'
                || CASE WHEN NEW.prep_time IS NOT NULL AND NEW.prep_time <> '' THEN
                       ' 🕒 الوقت: ' || CASE WHEN NEW.prep_time = 'arrival' THEN 'عند الوصول' ELSE replace(NEW.prep_time,'min','') || ' دقيقة' END ELSE '' END
                || CASE WHEN NEW.notes IS NOT NULL AND NEW.notes <> '' THEN ' 📝 ' || NEW.notes ELSE '' END,
            'New order from ' || buyer_name || ' for ' || item_name || ' (' || NEW.booked_quantity || ' pcs).'
                || CASE WHEN NEW.prep_time IS NOT NULL AND NEW.prep_time <> '' THEN
                       ' 🕒 ETA: ' || CASE WHEN NEW.prep_time = 'arrival' THEN 'On arrival' ELSE replace(NEW.prep_time,'min','') || ' min' END ELSE '' END
                || CASE WHEN NEW.notes IS NOT NULL AND NEW.notes <> '' THEN ' 📝 ' || NEW.notes ELSE '' END,
            'booking',
            jsonb_build_object('audience','seller','event','new','barcode',NEW.barcode,'dealId',NEW.deal_id,'quantity',NEW.booked_quantity,'prepTime',NEW.prep_time,'notes',NEW.notes), NOW());

        INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
        VALUES (NEW.user_id, '✅ تم الحجز بنجاح!', '✅ Booking Confirmed!',
            'تم حجز ' || item_name || ' — الرمز: ' || NEW.barcode || '. سيستلم التاجر طلبك قريباً.',
            item_name || ' booked — Code: ' || NEW.barcode || '. The seller will receive your order shortly.',
            'booking', jsonb_build_object('audience','buyer','event','new','barcode',NEW.barcode,'dealId',NEW.deal_id), NOW());

        FOR admin_id IN SELECT id FROM public.users WHERE user_type = 'admin' AND COALESCE(deleted_at::text,'') = '' LOOP
            INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
            VALUES (admin_id, '🛒 حجز جديد على المنصة', '🛒 New booking on platform',
                buyer_name || ' حجز ' || item_name || ' من ' || seller_name || ' (' || NEW.booked_quantity || ' قطعة).',
                buyer_name || ' booked ' || item_name || ' from ' || seller_name || ' (' || NEW.booked_quantity || ' pcs).',
                'booking', jsonb_build_object('audience','admin','event','new','admin',true,'barcode',NEW.barcode,'dealId',NEW.deal_id,'storeId',NEW.store_id,'buyerId',NEW.user_id), NOW());
        END LOOP;
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.status = 'acknowledged' THEN
            INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
            VALUES (NEW.user_id, '📦 التاجر استلم طلبك!', '📦 Seller received your order!',
                'استلم ' || seller_name || ' طلبك لـ ' || item_name || ' وهو قيد التجهيز الآن.',
                seller_name || ' received your order for ' || item_name || ' and is preparing it now.',
                'booking', jsonb_build_object('audience','buyer','event','acknowledged','barcode',NEW.barcode,'dealId',NEW.deal_id), NOW());

        ELSIF NEW.status = 'completed' THEN
            INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
            VALUES (NEW.user_id, '🎉 تم تسليم طلبك!', '🎉 Order Delivered!',
                'تم تأكيد استلام ' || item_name || ' من ' || seller_name || '. شكراً لاستخدامك تاكي 💚',
                item_name || ' delivery confirmed by ' || seller_name || '. Thanks for using Taki 💚',
                'booking', jsonb_build_object('audience','buyer','event','completed','barcode',NEW.barcode,'dealId',NEW.deal_id), NOW());
            INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
            VALUES (NEW.store_id, '🎉 تم الاستلام بنجاح!', '🎉 Order Delivered!',
                'استلم ' || buyer_name || ' طلب ' || item_name || ' — تم إغلاق الحجز.',
                buyer_name || ' received the order for ' || item_name || ' — booking closed.',
                'booking', jsonb_build_object('audience','seller','event','completed','barcode',NEW.barcode,'dealId',NEW.deal_id), NOW());
            FOR admin_id IN SELECT id FROM public.users WHERE user_type = 'admin' AND COALESCE(deleted_at::text,'') = '' LOOP
                INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
                VALUES (admin_id, '💰 إتمام بيع جديد', '💰 Sale completed',
                    seller_name || ' أكمل بيع ' || item_name || ' لـ ' || buyer_name || '.',
                    seller_name || ' completed a sale of ' || item_name || ' to ' || buyer_name || '.',
                    'booking', jsonb_build_object('audience','admin','event','completed','admin',true,'barcode',NEW.barcode,'dealId',NEW.deal_id,'storeId',NEW.store_id,'buyerId',NEW.user_id), NOW());
            END LOOP;

        ELSIF NEW.status = 'cancelled' THEN
            -- v14.21 — إلغاءُ استردادٍ له رسائله الخاصّة من `resolve_booking_refund`
            -- (المبلغ والمرجع والإشعار الدائن). وهذا الفرع يحسب «انتهت المهلة» من
            -- `expiry_time`، والدفع لا يمسحه — فكان المشتري الذي رُدّ ماله يتلقّى
            -- فوق إشعار الردّ «⏰ انتهت مدة حجزك فأُلغي تلقائياً»، وهي كذبة، ويتلقّى
            -- التاجر «أُلغي دون استلام»، والإدارة «انتهاء حجز تلقائي».
            IF COALESCE(NEW.cancelled_by, '') = 'refund' THEN
                RETURN NEW;
            END IF;
            v_expired := (NEW.expiry_time IS NOT NULL AND NEW.expiry_time < v_now);
            INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
            VALUES (NEW.user_id,
                CASE WHEN v_expired THEN '⏰ انتهت مدة الحجز' ELSE '⚠️ تم إلغاء الحجز' END,
                CASE WHEN v_expired THEN '⏰ Booking expired' ELSE '⚠️ Booking Cancelled' END,
                CASE WHEN v_expired THEN 'انتهت مدة حجز ' || item_name || ' (ساعتان) فأُلغي تلقائياً وأُتيح العرض للآخرين.'
                     ELSE 'تم إلغاء حجز ' || item_name || '.' END,
                CASE WHEN v_expired THEN 'Your booking for ' || item_name || ' expired (2h window) and was auto-cancelled.'
                     ELSE 'Booking for ' || item_name || ' has been cancelled.' END,
                'booking', jsonb_build_object('audience','buyer','event', CASE WHEN v_expired THEN 'expired' ELSE 'cancelled' END,'barcode',NEW.barcode,'dealId',NEW.deal_id), NOW());
            INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
            VALUES (NEW.store_id,
                CASE WHEN v_expired THEN '⏰ انتهى حجز دون استلام' ELSE '⚠️ تم إلغاء حجز' END,
                CASE WHEN v_expired THEN '⏰ Booking expired' ELSE '⚠️ Booking Cancelled' END,
                CASE WHEN v_expired THEN 'انتهت مدة حجز ' || item_name || ' من ' || buyer_name || ' دون استلام، وأُلغي تلقائياً.'
                     ELSE 'تم إلغاء حجز ' || item_name || ' من قِبل ' || buyer_name || '.' END,
                CASE WHEN v_expired THEN 'Booking for ' || item_name || ' by ' || buyer_name || ' expired without pickup and was auto-cancelled.'
                     ELSE buyer_name || ' cancelled the booking for ' || item_name || '.' END,
                'booking', jsonb_build_object('audience','seller','event', CASE WHEN v_expired THEN 'expired' ELSE 'cancelled' END,'barcode',NEW.barcode,'dealId',NEW.deal_id), NOW());
            FOR admin_id IN SELECT id FROM public.users WHERE user_type = 'admin' AND COALESCE(deleted_at::text,'') = '' LOOP
                INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
                VALUES (admin_id,
                    CASE WHEN v_expired THEN '⏰ انتهاء حجز تلقائي' ELSE '↩️ إلغاء حجز' END, '↩️ Booking cancelled',
                    CASE WHEN v_expired THEN 'انتهت مدة حجز ' || item_name || ' بين ' || buyer_name || ' و' || seller_name || ' تلقائياً.'
                         ELSE 'إلغاء حجز ' || item_name || ' بين ' || buyer_name || ' و' || seller_name || '.' END,
                    'Booking ' || item_name || ' between ' || buyer_name || ' and ' || seller_name || (CASE WHEN v_expired THEN ' expired.' ELSE ' was cancelled.' END),
                    'booking', jsonb_build_object('audience','admin','event', CASE WHEN v_expired THEN 'expired' ELSE 'cancelled' END,'admin',true,'barcode',NEW.barcode,'dealId',NEW.deal_id,'storeId',NEW.store_id,'buyerId',NEW.user_id), NOW());
            END LOOP;
        END IF;
    END IF;
    RETURN NEW;
END;
$function$

;

COMMIT;

-- ═══ ٢-٥) دورة الاسترداد: قفلٌ وترتيبٌ ورسائل تطابق ما جرى ════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_booking_refund(
  p_barcode      text,
  p_action       text,
  p_note         text DEFAULT NULL,
  p_amount       numeric DEFAULT NULL,
  p_ref          text DEFAULT NULL,
  p_method       text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me        text := (SELECT auth.uid()::text);
  v_b         public.bookings%ROWTYPE;
  v_r         public.booking_refunds%ROWTYPE;
  v_admin     boolean;
  v_amt       numeric;
  v_seq       integer;
  v_cn        text;
  v_shop      text;
  v_money     text;
  v_cancelled boolean := false;
  v_rows      integer;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  v_admin := public.is_admin();

  -- v14.21 — قفل صفّ الحجز. بدونه يسبق «استلمتُ طلبي» تأكيدَ الردّ فيقرأ هذا
  -- النداء حالةً قديمة، فيُصدر إشعاراً دائناً ويقول «أُلغي الطلب» ولا إلغاء وقع.
  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode)) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_me <> v_b.store_id AND NOT v_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_MERCHANT');
  END IF;
  IF v_b.paid_at IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_PAID'); END IF;

  SELECT COALESCE(NULLIF(u.shop,''), u.name) INTO v_shop FROM public.users u WHERE u.id = v_b.store_id;

  -- v14.21 — الحارس **قبل** كل فرع. كان بعد فرع `open`، فيُعاد فتح استرداد
  -- مُغلق ثم يُصدَر له إشعار دائن ثانٍ ويُهدر رقم من سلسلة التاجر.
  SELECT * INTO v_r FROM public.booking_refunds WHERE barcode = v_b.barcode FOR UPDATE;
  IF FOUND AND v_r.status = 'refunded' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'status', 'refunded',
                              'credit_note_no', v_r.credit_note_no);
  END IF;

  -- ── التاجر يفتحها بنفسه: يُسجَّل الدَّين ثم يُثبته لاحقاً بمرجع ──────────
  IF p_action = 'open' THEN
    v_amt := round(COALESCE(NULLIF(v_b.paid_amount, 0), v_b.total_amount, 0), 2);
    INSERT INTO public.booking_refunds (barcode, store_id, buyer_id, status, opened_by, amount, merchant_note)
    VALUES (v_b.barcode, v_b.store_id, v_b.user_id, 'approved',
            CASE WHEN v_admin AND v_me <> v_b.store_id THEN 'admin' ELSE 'seller' END,
            v_amt, NULLIF(left(btrim(COALESCE(p_note,'')), 600), ''))
    ON CONFLICT (barcode) DO UPDATE
      SET status = 'approved', merchant_note = EXCLUDED.merchant_note,
          decided_at = now(), decided_by = v_me, updated_at = now();

    -- v14.21 — الصياغة تطابق الشاشة: الطلب **ما زال قائماً** حتى يؤكّد التاجر
    -- التحويل. كانت تقول «ألغى التاجر طلبك» بينما الرمز ما زال قابلاً للمسح.
    PERFORM public._refund_notify(v_b.user_id,
      '↩️ أقرّ التاجر إلغاء طلبك واستردادك', 'The merchant approved cancelling your order and refunding you',
      'أقرّ «' || COALESCE(v_shop,'المتجر') || '» إلغاء الطلب ' || v_b.barcode
        || COALESCE(' (' || NULLIF(btrim(COALESCE(p_note,'')), '') || ')', '')
        || '، والمبلغ ' || trim(to_char(v_amt,'FM999999990.09')) || ' ر.س مستحقّ لك منه. '
        || 'يبقى الطلب في «حجوزاتي» حتى يؤكّد التاجر التحويل، وعندها يُغلق ويصلك إشعار بالمرجع.',
      '"' || COALESCE(v_shop,'The store') || '" approved cancelling order ' || v_b.barcode
        || '. A refund of ' || trim(to_char(v_amt,'FM999999990.09')) || ' SAR is due to you from the merchant. '
        || 'The order stays in «My Bookings» until they confirm the transfer.',
      v_b.barcode, 'buyer', 'refund_approved');

    RETURN jsonb_build_object('ok', true, 'status', 'approved', 'amount', v_amt);
  END IF;

  IF NOT FOUND OR v_r.barcode IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NO_REQUEST'); END IF;

  -- ── رفض ──────────────────────────────────────────────────────────────────
  IF p_action = 'decline' THEN
    UPDATE public.booking_refunds
       SET status = 'declined', decided_at = now(), decided_by = v_me,
           merchant_note = NULLIF(left(btrim(COALESCE(p_note,'')), 600), ''), updated_at = now()
     WHERE barcode = v_b.barcode;

    PERFORM public._refund_notify(v_b.user_id,
      '↩️ ردّ التاجر على طلب الاسترداد', 'The merchant responded to your refund request',
      'اعتذر «' || COALESCE(v_shop,'المتجر') || '» عن الاسترداد للطلب ' || v_b.barcode || ' وفق سياسته المعلنة.'
        || COALESCE(' السبب: ' || NULLIF(btrim(COALESCE(p_note,'')), ''), '')
        || ' طلبك ما زال قائماً. وإن رأيت في ذلك مخالفة لسياسته المعلنة فارفع شكوى من «📣 الشكاوى» — تاكي تُيسّر التواصل ولا تبتّ في السياسات.',
      '"' || COALESCE(v_shop,'The store') || '" declined the refund for order ' || v_b.barcode || ' under its published policy. Your order still stands.',
      v_b.barcode, 'buyer', 'refund_declined');

    RETURN jsonb_build_object('ok', true, 'status', 'declined');
  END IF;

  -- ── تثبيت ردّ المال ──────────────────────────────────────────────────────
  IF p_action <> 'refund' THEN RETURN jsonb_build_object('ok', false, 'error', 'BAD_ACTION'); END IF;

  v_amt := round(COALESCE(p_amount, v_r.amount, 0), 2);
  IF NOT (v_amt > 0) THEN RETURN jsonb_build_object('ok', false, 'error', 'ZERO_AMOUNT'); END IF;

  INSERT INTO public.store_invoice_counters (store_id, last_credit_seq)
  VALUES (v_b.store_id, 1)
  ON CONFLICT (store_id) DO UPDATE
    SET last_credit_seq = public.store_invoice_counters.last_credit_seq + 1, updated_at = now()
  RETURNING last_credit_seq INTO v_seq;
  v_cn := 'CN-' || lpad(v_seq::text, 6, '0');

  UPDATE public.booking_refunds
     SET status = 'refunded', decided_at = COALESCE(decided_at, now()), decided_by = v_me,
         merchant_note = COALESCE(NULLIF(left(btrim(COALESCE(p_note,'')), 600), ''), merchant_note),
         refunded_at = now(), refund_amount = v_amt,
         refund_ref = NULLIF(left(btrim(COALESCE(p_ref,'')), 120), ''),
         refund_method = NULLIF(left(btrim(COALESCE(p_method,'')), 40), ''),
         credit_note_no = v_cn, updated_at = now()
   WHERE barcode = v_b.barcode;

  -- الإلغاء وإعادة الكمّية لطلبٍ لم يُستلم بعد. أمّا طلبٌ اكتمل فالبضاعة خرجت
  -- فعلاً: يبقى مكتملاً ولا تعود كمّيته، والرسالة أدناه تقول ذلك بصدق.
  IF v_b.status IN ('pending','acknowledged') THEN
    UPDATE public.bookings SET status = 'cancelled', cancelled_by = 'refund' WHERE barcode = v_b.barcode;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_cancelled := v_rows > 0;
  END IF;

  v_money := trim(to_char(v_amt, 'FM999999990.09'));

  PERFORM public._refund_notify(v_b.user_id,
    '✅ أكّد التاجر ردّ المبلغ', 'The merchant confirmed your refund',
    'أكّد «' || COALESCE(v_shop,'المتجر') || '» ردّ ' || v_money || ' ر.س عن الطلب ' || v_b.barcode
      || COALESCE(' — المرجع: ' || NULLIF(btrim(COALESCE(p_ref,'')), ''), '')
      || '. إشعار دائن رقم ' || v_cn || ' على فاتورتك. مدّة وصول المبلغ لحسابك تحدّدها جهة الدفع لا تاكي.',
    '"' || COALESCE(v_shop,'The store') || '" confirmed a refund of ' || v_money || ' SAR for order ' || v_b.barcode
      || COALESCE(' — reference: ' || NULLIF(btrim(COALESCE(p_ref,'')), ''), '')
      || '. Credit note ' || v_cn || ' is on your invoice.',
    v_b.barcode, 'buyer', 'refund_done');

  PERFORM public._refund_notify(v_b.store_id,
    '✅ سُجِّل ردّ المبلغ', 'Refund recorded',
    'سُجِّل ردّ ' || v_money || ' ر.س عن الطلب ' || v_b.barcode || ' بإشعار دائن ' || v_cn || '. '
      || CASE WHEN v_cancelled
              THEN 'وأُلغي الطلب وعادت الكمّية للبيع.'
              ELSE 'والطلب ' || CASE WHEN v_b.status = 'completed' THEN 'مكتملٌ' ELSE 'مُغلق' END
                   || ' فلم تعد كمّيته للبيع — البضاعة خرجت فعلاً.' END,
    'A refund of ' || v_money || ' SAR for order ' || v_b.barcode || ' was recorded as credit note ' || v_cn || '. '
      || CASE WHEN v_cancelled THEN 'The order was cancelled and the stock returned.'
              ELSE 'The order was already closed, so the stock did not return.' END,
    v_b.barcode, 'seller', 'refund_done');

  RETURN jsonb_build_object('ok', true, 'status', 'refunded', 'amount', v_amt,
                            'credit_note_no', v_cn, 'order_cancelled', v_cancelled);
END
$fn$;

REVOKE ALL ON FUNCTION public.resolve_booking_refund(text,text,text,numeric,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_booking_refund(text,text,text,numeric,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_booking_refund(text,text,text,numeric,text,text) TO authenticated, service_role;

-- ═══ ٦) الإشعار الدائن داخل فاتورة البوتين ════════════════════════════════
-- الدالّة المنفصلة كانت شِبه ميتة: لا تُنادى، ومسحوبة من دور البوتين. البديل
-- أن تُدرَج بيانات الاسترداد في نفس نداء الفاتورة — نداءٌ واحد وصلاحيةٌ قائمة.
DROP FUNCTION IF EXISTS public.bot_booking_refund_line(text);

COMMIT;

-- ═══ ٧) فاتورة البوتين تحمل الإشعار الدائن ════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.bot_get_booking_invoice(p_uid text, p_barcode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_b       public.bookings%ROWTYPE;
  v_d       public.deals%ROWTYPE;
  v_is_buyer  boolean;
  v_is_seller boolean;
  v_vat     jsonb;
  v_vat_no  text;
  v_cr      text;
  v_total   numeric;
  v_rate    numeric;
  v_base    numeric;
  v_tax     numeric;
  v_items   jsonb := '[]'::jsonb;
  v_sel     jsonb;
  v_row     jsonb;
  v_grp     jsonb;
  v_choice  jsonb;
  v_label   text;
  v_has_variant boolean := false;
  v_loc_name text;
  v_shop    text;
  v_buyer_note text;
  v_inv     public.order_invoices%ROWTYPE;
  v_rf      public.booking_refunds%ROWTYPE;
BEGIN
  IF NOT public._bot_gate_ok() THEN RAISE EXCEPTION 'GATE'; END IF;

  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  v_is_buyer  := v_b.user_id IS NOT DISTINCT FROM p_uid;
  v_is_seller := v_b.store_id IS NOT DISTINCT FROM p_uid;
  IF NOT (v_is_buyer OR v_is_seller) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT * INTO v_d FROM public.deals WHERE id = v_b.deal_id;
  SELECT coalesce(nullif(v_d.shop_name,''), nullif(u.shop,''), u.name) INTO v_shop FROM public.users u WHERE u.id = v_b.store_id;

  -- ── الإجمالي ──────────────────────────────────────────────────────────────
  -- v14.11 — الرقم من العمود الذي كتبه الخادم لحظة الحجز: هو نفسه الذي يُطالَب
  -- به الدفع الإلكتروني، فلا تفترق الفاتورة عن المقبوض. القراءة من الملاحظات
  -- بقيت للحجوزات القديمة وحدها (ما قبل الهجرة)، ثم إعادة حساب كملاذ أخير.
  SELECT * INTO v_inv FROM public.order_invoices WHERE barcode = v_b.barcode;
  -- v14.21 — بيانات الاسترداد في نفس النداء: الإشعار الدائن يجب أن يظهر على
  -- ورقة الفاتورة، وإلا بقيت تقول «مدفوع» عن مالٍ عاد لصاحبه.
  SELECT * INTO v_rf FROM public.booking_refunds WHERE barcode = v_b.barcode;

  v_total := COALESCE(
    NULLIF(v_inv.total, 0),
    NULLIF(v_b.paid_amount, 0),
    v_b.total_amount,
    NULLIF(substring(coalesce(v_b.notes, '') FROM 'الإجمالي:\s*([0-9]+(?:\.[0-9]+)?)'), '')::numeric,
    (public.taki_booking_amount(v_b.deal_id, v_b.booked_quantity, v_b.selected_options, v_b.delivery_fee)->>'total')::numeric);

  -- ── الضريبة: من **لقطة الفاتورة** لا من الإعدادات الحيّة (v14.17) ─────────
  -- كانت تُحسب هنا من دالّة وضع ضريبة **اشتراكات تاكي** ومن رقم التاجر
  -- الضريبي **الحالي**. فكان: (أ) تاجرٌ مسجَّل لا تظهر ضريبته حتى تسجّل تاكي،
  -- (ب) وتعديلُ رقمه لاحقاً يُعيد كتابة كل فاتورة قديمة بأثر رجعي،
  -- (ج) وفرع «تُضاف فوق السعر» كان يُخرج «أساس + ضريبة ≠ إجمالي».
  -- اليوم: الأرقام مجمّدة في `order_invoices` لحظة البيع، ومضمّنة دائماً.
  v_vat_no := NULLIF(btrim(COALESCE(v_inv.seller->>'vat_number', '')), '');
  v_cr     := NULLIF(btrim(COALESCE(v_inv.seller->>'cr_number', '')), '');
  v_rate   := v_inv.vat_rate;
  v_base   := v_inv.vat_base;
  v_tax    := v_inv.vat_amount;

  -- ── العناصر: الأنواع (بدل الصنف الأساسي) والإضافات — كل عنصر برمز كاشيره ─
  v_sel := CASE WHEN jsonb_typeof(coalesce(v_b.selected_options, 'null'::jsonb)) = 'array'
                THEN v_b.selected_options ELSE '[]'::jsonb END;

  FOR v_row IN SELECT * FROM jsonb_array_elements(v_sel) LOOP
    IF v_row->>'g' = '__variant__' THEN
      SELECT vv INTO v_choice
        FROM jsonb_array_elements(coalesce(v_d.variants, '[]'::jsonb)) vv
       WHERE vv->>'id' = v_row->>'c' LIMIT 1;
      v_label := coalesce(v_choice->>'label', v_row->>'c');
      v_has_variant := true;
      v_items := v_items || jsonb_build_object(
        'label', v_label,
        'qty',   coalesce((v_row->>'qty')::int, 1),
        'sku',   nullif(btrim(coalesce(v_choice->>'posSku','')),''),
        'kind',  'variant');
    ELSE
      SELECT gg INTO v_grp
        FROM jsonb_array_elements(coalesce(v_d.options, '[]'::jsonb)) gg
       WHERE gg->>'id' = v_row->>'g' LIMIT 1;
      SELECT cc INTO v_choice
        FROM jsonb_array_elements(coalesce(v_grp->'choices', '[]'::jsonb)) cc
       WHERE cc->>'id' = v_row->>'c' LIMIT 1;
      IF v_choice IS NULL THEN CONTINUE; END IF;
      v_label := CASE WHEN v_grp->>'title' IS NOT NULL
                      THEN (v_grp->>'title') || ': ' || coalesce(v_choice->>'label', '')
                      ELSE coalesce(v_choice->>'label', '') END;
      v_items := v_items || jsonb_build_object(
        'label', v_label,
        'qty',   coalesce((v_row->>'qty')::int, 1),
        'sku',   nullif(btrim(coalesce(v_choice->>'posSku','')),''),
        'kind',  'addon');
    END IF;
  END LOOP;

  -- الصنف الأساسي يُطبع كعنصر (برمز كاشيره) فقط حين لا أنواع — كالموقع تماماً
  IF NOT v_has_variant THEN
    v_items := jsonb_build_array(jsonb_build_object(
      'label', v_d.item_name, 'qty', coalesce(v_b.booked_quantity, 1),
      'sku', nullif(btrim(coalesce(v_d.pos_sku,'')),''), 'kind', 'main')) || v_items;
  END IF;

  -- اسم الفرع المختار (عرض متعدد المواقع)
  IF v_b.location_id IS NOT NULL AND jsonb_typeof(coalesce(v_d.locations,'null'::jsonb)) = 'array' THEN
    SELECT nullif(e->>'name','') INTO v_loc_name FROM jsonb_array_elements(v_d.locations) e
     WHERE e->>'id' = v_b.location_id LIMIT 1;
  END IF;

  -- ملاحظة المشتري الحرّة (بعد 📝 وقبل سطر 💰) — نفس منطق الموقع
  v_buyer_note := nullif(btrim(coalesce(substring(coalesce(v_b.notes,'') FROM '📝\s*([^\n]*(?:\n(?!💰)[^\n]*)*)'), '')), '');

  RETURN jsonb_build_object(
    'ok',            true,
    'role',          CASE WHEN v_is_seller THEN 'seller' ELSE 'buyer' END,
    'barcode',       v_b.barcode,
    'backup_code',   v_b.backup_code,
    'status',        v_b.status,
    'cancelled_by',  v_b.cancelled_by,
    'item_name',     v_d.item_name,
    'main_sku',      nullif(btrim(coalesce(v_d.pos_sku,'')),''),
    'shop_name',     v_shop,
    'store_id',      v_b.store_id,
    'quantity',      v_b.booked_quantity,
    'unit_price',    v_d.discounted_price,
    'original_price',v_d.original_price,
    'total',         v_total,
    'total_source',  CASE WHEN v_inv.total IS NOT NULL AND v_inv.total > 0 THEN 'invoice'
                          WHEN v_b.paid_amount > 0          THEN 'paid'
                          WHEN v_b.total_amount IS NOT NULL THEN 'order'
                          WHEN v_b.notes ~ 'الإجمالي:'    THEN 'order'
                          ELSE 'estimate' END,
    'refund_status',   v_rf.status,
    'credit_note_no',  v_rf.credit_note_no,
    'refund_amount',   v_rf.refund_amount,
    'refund_ref',      v_rf.refund_ref,
    'refunded_at',     v_rf.refunded_at,
    'invoice_no',    v_inv.invoice_no,
    'issued_at',     v_inv.issued_at,
    'seller_name',   COALESCE(v_inv.seller->>'name', v_shop),
    'seller_address',v_inv.seller->>'address',
    'vat_number',    v_vat_no,
    'cr_number',     v_cr,
    'vat_rate',      v_rate,
    'vat_base',      v_base,
    'vat_amount',    v_tax,
    'paid',          v_b.paid_at IS NOT NULL,
    'paid_amount',   v_b.paid_amount,
    'payment_method',v_b.payment_method,
    'items',         v_items,
    'buyer_name',    CASE WHEN v_is_seller THEN v_b.user_name ELSE NULL END,
    'buyer_phone',   CASE WHEN v_is_seller THEN v_b.user_phone ELSE NULL END,
    'prep_time',     v_b.prep_time,
    'notes',         v_b.notes,
    'buyer_note',    v_buyer_note,
    'merchant_note', v_b.merchant_note,
    'location_name', v_loc_name,
    'fulfillment',   coalesce(v_b.fulfillment, 'pickup'),
    'delivery_fee',  v_b.delivery_fee,
    'delivery',      v_b.delivery_address,
    'booked_at',     v_b.booked_at,
    'completed_at',  v_b.completed_at
  );
END;
$function$

;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- جدول التحقّق — أوّل سطر فيه اسم الخادم
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS "الفحص",
       COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'standard public schema') AS "النتيجة",
       CASE WHEN COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') NOT LIKE 'TAKI_LAB_TOKYO%'
            THEN '✅ جدة (إنتاج)' ELSE '❌ المختبر' END AS "الحالة";

SELECT 'مشغّل الإشعارات يصمت عن إلغاء الاسترداد' AS "الفحص",
       CASE WHEN pg_get_functiondef('public.handle_booking_notification()'::regprocedure) LIKE '%= ''refund'' THEN%'
            THEN 'يصمت' ELSE 'يتكلّم' END AS "النتيجة",
       CASE WHEN pg_get_functiondef('public.handle_booking_notification()'::regprocedure) LIKE '%= ''refund'' THEN%'
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'قفل صفّ الحجز قبل البتّ' AS "الفحص",
       CASE WHEN pg_get_functiondef('public.resolve_booking_refund(text,text,text,numeric,text,text)'::regprocedure) LIKE '%FOR UPDATE%'
            THEN 'مقفل' ELSE 'بلا قفل' END AS "النتيجة",
       CASE WHEN pg_get_functiondef('public.resolve_booking_refund(text,text,text,numeric,text,text)'::regprocedure) LIKE '%FOR UPDATE%'
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'رسالة التاجر مشروطة بما جرى فعلاً' AS "الفحص",
       CASE WHEN pg_get_functiondef('public.resolve_booking_refund(text,text,text,numeric,text,text)'::regprocedure) LIKE '%v_cancelled%'
            THEN 'مشروطة' ELSE 'مطلقة' END AS "النتيجة",
       CASE WHEN pg_get_functiondef('public.resolve_booking_refund(text,text,text,numeric,text,text)'::regprocedure) LIKE '%v_cancelled%'
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'فاتورة البوتين تحمل الإشعار الدائن' AS "الفحص",
       CASE WHEN pg_get_functiondef('public.bot_get_booking_invoice(text,text)'::regprocedure) LIKE '%credit_note_no%'
            THEN 'نعم' ELSE 'لا' END AS "النتيجة",
       CASE WHEN pg_get_functiondef('public.bot_get_booking_invoice(text,text)'::regprocedure) LIKE '%credit_note_no%'
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'الدالّة الميتة أُزيلت' AS "الفحص",
       count(*)::text || ' (يجب صفر)' AS "النتيجة",
       CASE WHEN count(*) = 0 THEN '✅' ELSE '❌' END AS "الحالة"
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='bot_booking_refund_line';

-- ═══ ٨) بطاقة الطلب في البوتين تعرض حالة الاسترداد ════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.bot_get_my_bookings(p_telegram_id bigint, p_scope text DEFAULT 'all'::text, p_whatsapp_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid text; v_res jsonb;
BEGIN
  SELECT id INTO v_uid FROM users WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id) AND deleted_at IS NULL LIMIT 1;
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT jsonb_agg(row ORDER BY (row->>'sort_at')::bigint DESC) INTO v_res FROM (
    SELECT jsonb_build_object(
      'barcode', b.barcode, 'deal_id', b.deal_id, 'deal_name', d.item_name, 'shop_name', d.shop_name,
      'store_id', d.store_id,
      'quantity', b.booked_quantity, 'status', b.status, 'image', (d.images)[1],
      'prep_time', b.prep_time, 'notes', b.notes, 'sort_at', b.booked_at,
      'expiry_time', b.expiry_time,
      'deal_expiry_type', d.expiry_type, 'deal_expiry_date', d.expiry_date,
      'unread', (SELECT count(*) FROM booking_messages m WHERE m.barcode = b.barcode AND m.sender_role='seller' AND m.read_at IS NULL),
      'msg_count', (SELECT count(*) FROM booking_messages m WHERE m.barcode = b.barcode),
      'booked_at', to_timestamp(b.booked_at::double precision / 1000),
      'fulfillment', coalesce(b.fulfillment, 'pickup'),
      'delivery_fee', b.delivery_fee,
      'delivery_label', b.delivery_address->>'label',
      'delivery_details', b.delivery_address->>'details',
      'delivery_lat', b.delivery_address->>'lat',
      'delivery_lng', b.delivery_address->>'lng',
      -- v14.10 — البوتان يحتاجانهما ليخفيا عدّاداً كاذباً ويُظهرا زرّ التأكيد
      'paid', b.paid_at IS NOT NULL,
      'dlv_status', (SELECT t.status FROM delivery_tracks t WHERE t.barcode = b.barcode),
      -- v14.21 — حالة الاسترداد على بطاقة الطلب في البوتين، فلا ينتظر المشتري
      -- جواباً لا يراه. (كان السطر مكتوباً في البوت بلا حقلٍ يغذّيه.)
      'refund_status', (SELECT r.status FROM booking_refunds r WHERE r.barcode = b.barcode),
      'credit_note_no', (SELECT r.credit_note_no FROM booking_refunds r WHERE r.barcode = b.barcode),
      'hold_running', (
        b.status IN ('pending','acknowledged')
        AND b.paid_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM delivery_tracks t
                         WHERE t.barcode = b.barcode
                           AND t.status IN ('preparing','on_the_way','arrived','delivered'))
      )
    ) AS row
    FROM bookings b JOIN deals d ON d.id = b.deal_id
    WHERE b.user_id = v_uid
      AND ( p_scope = 'all'
         OR (p_scope = 'current'  AND b.status IN ('pending','acknowledged'))
         OR (p_scope = 'previous' AND b.status IN ('completed','cancelled','expired')) )
    ORDER BY b.booked_at DESC LIMIT 20
  ) t;
  RETURN COALESCE(v_res, '[]'::jsonb);
END; $function$

;

COMMIT;

SELECT 'بطاقة البوتين تحمل حالة الاسترداد' AS "الفحص",
       CASE WHEN pg_get_functiondef(p.oid) LIKE '%refund_status%' THEN 'نعم' ELSE 'لا' END AS "النتيجة",
       CASE WHEN pg_get_functiondef(p.oid) LIKE '%refund_status%' THEN '✅' ELSE '❌' END AS "الحالة"
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='bot_get_my_bookings';
