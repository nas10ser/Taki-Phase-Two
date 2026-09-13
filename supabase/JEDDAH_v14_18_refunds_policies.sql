-- ═══════════════════════════════════════════════════════════════════════════
-- JEDDAH_v14_18_refunds_policies.sql
--   الطلب المدفوع لا يُلغى بضغطة · حالة استرداد كاملة · سياسة التاجر المعلنة
--
-- ── ما كان (مقيس على جدة ١٣ سبتمبر ٢٠٢٦) ─────────────────────────────────
--  ١) **لا مسار واحد يرفض إلغاء طلب مدفوع.** `cancel_booking` و
--     `bot_cancel_booking` تشترطان الحالة والهوية فقط — كلمة `paid_at` لا ترد
--     في جسم أيٍّ منهما. الدالّة الوحيدة التي تحترم الدفع هي `expire_due_bookings`
--     (الإلغاء التلقائي). أي أن المؤقّت يحمي الطلب المدفوع، والإصبع تلغيه.
--  ٢) وبطاقة الطلب في «حجوزاتي» تقول حرفياً «🔒 مدفوع — لا يُلغى تلقائياً»
--     وتحتها بسطور زرُّ «إلغاء الحجز ❌» بلا أي شرط. الشاشة تَعِد بحماية
--     لا وجود لها.
--  ٣) والإلغاء يُعيد الكمّية للتاجر فوراً (`adjust_deal_quantity`) ويُرسل نصّاً
--     لا يذكر مالاً إطلاقاً: «تم إلغاء الحجز». فالمشتري الذي دفع بالبطاقة يتلقّى
--     نفس نصّ من لم يدفع شيئاً، ولا أثر في أي جدول أن مالاً بقي عند التاجر.
--  ٤) **لا وجود لاسترداد في النظام كلّه**: لا جدول، ولا دالّة، ولا حالة، ولا
--     مهايئ مزوّد فيه `refund`. و`AdminInvoices` يعرض تسمية «مستردة» لحالة
--     لا يكتبها أحد.
--  ٥) **لا حقل لسياسة التاجر** في القاعدة ولا في الواجهة — بينما صفحة الاسترداد
--     تَعِد المشتري: «اطّلع قبل الحجز على سياسة الاسترداد المُعلَنة في صفحة
--     المتجر أو العرض»، والأسئلة الشائعة تنصح التاجر بنشرها. وعدٌ بلا مكان.
--
-- ── المبدأ الذي يحكم التصميم ──────────────────────────────────────────────
--  تاكي **وسيط ولا تملك المال**. الاسترداد والاستبدال بين التاجر والمشتري،
--  والقرار للتاجر وفق سياسته المعلنة. دور المنصّة: أن تُسجّل الطلب، وتُبلّغ
--  الطرفين، وتُثبت ما جرى بتاريخ ومرجع ومبلغ، وتُظهره على الفاتورة إشعاراً
--  دائناً. ولا تبتّ. (وهو نصّ Refund.tsx الحيّ: «تتدخّل تاكي كميسِّر للتواصل
--  فقط دون أن تكون ملزَمة بنتيجة معيّنة».)
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

-- ═══ ١) سياسة التاجر المعلنة ══════════════════════════════════════════════
ALTER TABLE public.store_profiles
  ADD COLUMN IF NOT EXISTS refund_policy text,
  ADD COLUMN IF NOT EXISTS store_terms   text;

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.store_profiles'::regclass
                    AND conname='store_profiles_policies_chk') THEN
    ALTER TABLE public.store_profiles
      ADD CONSTRAINT store_profiles_policies_chk CHECK (
        (refund_policy IS NULL OR length(refund_policy) <= 1500)
        AND (store_terms IS NULL OR length(store_terms) <= 1500));
  END IF;
END
$c$;

COMMENT ON COLUMN public.store_profiles.refund_policy IS
  'سياسة الاسترداد والاستبدال التي يكتبها التاجر ويُلزَم بها. تُعرض للمشتري قبل الحجز.';
COMMENT ON COLUMN public.store_profiles.store_terms IS
  'شروط إضافية يضيفها التاجر (مواعيد، ضمان، شروط الاستخدام…). تُعرض مع السياسة.';

-- الكتابة للتاجر نفسه وحده، والنصّ يُقَصّ على الخادم لا في المتصفّح.
CREATE OR REPLACE FUNCTION public.merchant_set_policies(
  p_refund_policy text,
  p_store_terms   text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me text := (SELECT auth.uid()::text);
  v_r  text;
  v_t  text;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  v_r := NULLIF(left(btrim(COALESCE(p_refund_policy, '')), 1500), '');
  v_t := NULLIF(left(btrim(COALESCE(p_store_terms,   '')), 1500), '');

  INSERT INTO public.store_profiles (store_id, refund_policy, store_terms)
  VALUES (v_me, v_r, v_t)
  ON CONFLICT (store_id) DO UPDATE
    SET refund_policy = EXCLUDED.refund_policy,
        store_terms   = EXCLUDED.store_terms,
        updated_at    = now();

  RETURN jsonb_build_object('ok', true, 'refund_policy', v_r, 'store_terms', v_t);
END
$fn$;

REVOKE ALL ON FUNCTION public.merchant_set_policies(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_set_policies(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_set_policies(text, text) TO authenticated, service_role;

-- قارئٌ عامّ للبوتين وللزائر (السياسة مُعلَنة عمداً — المشتري يقرؤها قبل الحجز).
CREATE OR REPLACE FUNCTION public.store_policies(p_store_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'refund_policy', NULLIF(btrim(COALESCE(sp.refund_policy, '')), ''),
    'store_terms',   NULLIF(btrim(COALESCE(sp.store_terms,   '')), '')))
    FROM public.store_profiles sp WHERE sp.store_id = p_store_id;
$fn$;

REVOKE ALL ON FUNCTION public.store_policies(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_policies(text) TO anon, authenticated, service_role;

-- ═══ ٢) عدّاد الإشعارات الدائنة — سلسلة مستقلّة لكل تاجر ══════════════════
ALTER TABLE public.store_invoice_counters
  ADD COLUMN IF NOT EXISTS last_credit_seq integer NOT NULL DEFAULT 0;

-- ═══ ٣) جدول الاسترداد ════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.booking_refunds (
  barcode        text PRIMARY KEY REFERENCES public.bookings(barcode) ON DELETE CASCADE,
  store_id       text NOT NULL,
  buyer_id       text NOT NULL,
  status         text NOT NULL DEFAULT 'requested',
  opened_by      text NOT NULL,              -- 'buyer' | 'seller' | 'admin'
  amount         numeric NOT NULL DEFAULT 0, -- إجمالي الفاتورة وقت الطلب
  reason         text,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz,
  decided_by     text,
  merchant_note  text,
  refunded_at    timestamptz,
  refund_amount  numeric,
  refund_ref     text,
  refund_method  text,
  credit_note_no text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_refunds_status_chk
    CHECK (status IN ('requested','declined','approved','refunded','withdrawn')),
  CONSTRAINT booking_refunds_sane CHECK (
    amount >= 0 AND amount <= 1000000
    AND (refund_amount IS NULL OR (refund_amount >= 0 AND refund_amount <= 1000000))
    AND (reason IS NULL OR length(reason) <= 600)
    AND (merchant_note IS NULL OR length(merchant_note) <= 600)
    AND (refund_ref IS NULL OR length(refund_ref) <= 120)
    AND (refund_method IS NULL OR length(refund_method) <= 40))
);

COMMENT ON TABLE public.booking_refunds IS
  'طلب إلغاء واسترداد على طلبٍ مدفوع. تاكي تُسجّل وتُبلّغ وتُثبت — ولا تبتّ. القرار للتاجر وفق سياسته المعلنة.';

CREATE INDEX IF NOT EXISTS idx_booking_refunds_store  ON public.booking_refunds (store_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_refunds_buyer  ON public.booking_refunds (buyer_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_refunds_open   ON public.booking_refunds (status) WHERE status IN ('requested','approved');

ALTER TABLE public.booking_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.booking_refunds FROM PUBLIC;
REVOKE ALL ON TABLE public.booking_refunds FROM anon;
GRANT SELECT ON TABLE public.booking_refunds TO authenticated;
GRANT ALL ON TABLE public.booking_refunds TO service_role;

DROP POLICY IF EXISTS booking_refunds_select_parties ON public.booking_refunds;
CREATE POLICY booking_refunds_select_parties ON public.booking_refunds
  FOR SELECT USING (
    (SELECT auth.uid()::text) = buyer_id
    OR (SELECT auth.uid()::text) = store_id
    OR (SELECT public.is_admin()));

COMMIT;

-- ═══ ٤) الحارس: طلبٌ مدفوع لا يُلغى بضغطة ═════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.cancel_booking(p_barcode text)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    caller  text := (SELECT auth.uid()::text);
    updated public.bookings;
    v_b     public.bookings%ROWTYPE;
BEGIN
    IF caller IS NULL THEN
        RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE = '28000';
    END IF;

    -- v14.18 — الطلب المدفوع إلكترونياً لا يُلغى بضغطة واحدة. مالٌ خرج من حساب
    -- المشتري ووصل حساب التاجر مباشرة (تاكي لا تمرّ بها الأموال أصلاً)، فإلغاءٌ
    -- صامت يُعيد الكمّية للتاجر ويترك المشتري بلا بضاعة ولا مال ولا أثر مكتوب.
    -- المسار الصحيح: طلب إلغاء واسترداد يُسجَّل ويُبلَّغ ويُثبَّت بمرجع ومبلغ.
    SELECT * INTO v_b FROM public.bookings WHERE barcode = p_barcode;
    IF FOUND AND v_b.paid_at IS NOT NULL
       AND (caller = v_b.store_id OR caller = v_b.user_id) THEN
        RAISE EXCEPTION 'TAKI_PAID_NEEDS_REFUND' USING ERRCODE = 'P0014';
    END IF;

    UPDATE public.bookings
    SET status = 'cancelled',
        cancelled_by = CASE WHEN caller = store_id THEN 'seller' ELSE 'buyer' END
    WHERE barcode = p_barcode
      AND status IN ('pending', 'acknowledged')
      AND (caller = store_id OR caller = user_id)
    RETURNING * INTO updated;

    IF updated.barcode IS NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.bookings
            WHERE barcode = p_barcode
              AND (caller = store_id OR caller = user_id)
        ) THEN
            RAISE EXCEPTION 'الحجز مغلق ولا يمكن إلغاؤه' USING ERRCODE = 'P0001';
        ELSE
            RAISE EXCEPTION 'لم يتم العثور على الحجز' USING ERRCODE = 'P0002';
        END IF;
    END IF;

    RETURN updated;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bot_cancel_booking(
  p_telegram_id bigint, p_barcode text, p_whatsapp_id text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_uid text; v_b bookings%ROWTYPE;
BEGIN
  SELECT id INTO v_uid FROM users WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id) AND deleted_at IS NULL LIMIT 1;
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_linked'); END IF;
  SELECT * INTO v_b FROM bookings WHERE barcode = UPPER(p_barcode) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_b.user_id <> v_uid AND v_b.store_id <> v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;
  -- v14.18 — نفس حارس الموقع حرفياً: البوتان لا يفتحان باباً يُغلقه الموقع.
  IF v_b.paid_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'paid_needs_refund', 'barcode', v_b.barcode);
  END IF;
  IF v_b.status NOT IN ('pending','acknowledged') THEN
    RETURN jsonb_build_object('success', false, 'error', 'cannot_cancel', 'status', v_b.status);
  END IF;
  UPDATE bookings
     SET status = 'cancelled',
         cancelled_by = CASE WHEN v_uid = v_b.store_id THEN 'seller' ELSE 'buyer' END
   WHERE barcode = UPPER(p_barcode);
  RETURN jsonb_build_object('success', true);
END; $function$;

-- 🪤 سياسة الحذف `bookings_delete_own` تسمح لأي طرف بمسح صفّ الحجز مباشرةً،
-- وحارس السلامة لا يغطّي DELETE. أي أن الحارس أعلاه كان يُلتَفّ عليه بمسح
-- الطلب كلّه — ومعه الفاتورة وطلب الاسترداد. الحذف الآن لغير المدفوع فقط.
DROP POLICY IF EXISTS bookings_delete_own ON public.bookings;
CREATE POLICY bookings_delete_own ON public.bookings
  FOR DELETE USING (
    paid_at IS NULL
    AND ((SELECT auth.uid()::text) = user_id OR (SELECT auth.uid()::text) = store_id));

COMMIT;

-- ═══ ٥) دورة الاسترداد ════════════════════════════════════════════════════
BEGIN;

-- إشعار موحَّد الشكل — نفس بنية `handle_booking_notification` كي تصل للبوتين.
CREATE OR REPLACE FUNCTION public._refund_notify(
  p_user_id text, p_title_ar text, p_title_en text,
  p_body_ar text, p_body_en text, p_barcode text, p_audience text, p_event text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  INSERT INTO public.notifications (id, user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
  VALUES ('ntf_rf_' || (extract(epoch from clock_timestamp())*1000)::bigint || '_' || substr(md5(random()::text), 1, 6),
          p_user_id, p_title_ar, p_title_en, p_body_ar, p_body_en, 'booking',
          jsonb_build_object('audience', p_audience, 'event', p_event, 'barcode', p_barcode));
$fn$;

REVOKE ALL ON FUNCTION public._refund_notify(text,text,text,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._refund_notify(text,text,text,text,text,text,text,text) FROM anon;
REVOKE ALL ON FUNCTION public._refund_notify(text,text,text,text,text,text,text,text) FROM authenticated;

/* المشتري يطلب إلغاءً واسترداداً. لا يُلغي الطلب بنفسه ولا يُعيد الكمّية:
   الطلب قائم حتى يبتّ التاجر، وإلا بيعت القطعة مرّتين قبل أن يُردّ المال. */
CREATE OR REPLACE FUNCTION public.request_booking_refund(p_barcode text, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me   text := (SELECT auth.uid()::text);
  v_b    public.bookings%ROWTYPE;
  v_amt  numeric;
  v_cur  public.booking_refunds%ROWTYPE;
  v_shop text;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_me <> v_b.user_id THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_BUYER'); END IF;
  IF v_b.paid_at IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_PAID'); END IF;

  SELECT * INTO v_cur FROM public.booking_refunds WHERE barcode = v_b.barcode;
  IF FOUND AND v_cur.status IN ('requested','approved','refunded') THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'status', v_cur.status);
  END IF;

  v_amt := round(COALESCE(NULLIF(v_b.paid_amount, 0), v_b.total_amount, 0), 2);

  INSERT INTO public.booking_refunds (barcode, store_id, buyer_id, status, opened_by, amount, reason)
  VALUES (v_b.barcode, v_b.store_id, v_b.user_id, 'requested', 'buyer', v_amt,
          NULLIF(left(btrim(COALESCE(p_reason, '')), 600), ''))
  ON CONFLICT (barcode) DO UPDATE
    SET status = 'requested', opened_by = 'buyer', amount = EXCLUDED.amount,
        reason = EXCLUDED.reason, requested_at = now(),
        decided_at = NULL, decided_by = NULL, merchant_note = NULL, updated_at = now();

  SELECT COALESCE(NULLIF(u.shop,''), u.name) INTO v_shop FROM public.users u WHERE u.id = v_b.store_id;

  PERFORM public._refund_notify(v_b.store_id,
    '↩️ طلب إلغاء واسترداد', 'Refund request',
    'طلب المشتري إلغاء الطلب ' || v_b.barcode || ' واسترداد ' || trim(to_char(v_amt,'FM999999990.09')) || ' ر.س. القرار لك وفق سياستك المعلنة — من لوحتك.',
    'The buyer asked to cancel order ' || v_b.barcode || ' and be refunded ' || trim(to_char(v_amt,'FM999999990.09')) || ' SAR. The decision is yours under your published policy.',
    v_b.barcode, 'seller', 'refund_requested');

  PERFORM public._refund_notify(v_b.user_id,
    '↩️ وصل طلبك للتاجر', 'Your request was sent',
    'أرسلنا طلب الإلغاء والاسترداد للطلب ' || v_b.barcode || ' إلى «' || COALESCE(v_shop,'المتجر') || '». القرار والتنفيذ عليه وفق سياسته المعلنة — تاكي وسيط لا تحتفظ بالمال ولا تبتّ فيه.',
    'Your cancellation and refund request for order ' || v_b.barcode || ' was sent to "' || COALESCE(v_shop,'the store') || '". The decision and the payment are theirs under their published policy — TAKI is an intermediary and never holds the money.',
    v_b.barcode, 'buyer', 'refund_requested');

  RETURN jsonb_build_object('ok', true, 'status', 'requested', 'amount', v_amt);
END
$fn$;

REVOKE ALL ON FUNCTION public.request_booking_refund(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_booking_refund(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_booking_refund(text, text) TO authenticated, service_role;

/* قرار التاجر (أو الإدارة لاشتراكات تاكي وحدها، وهنا للحالات الإدارية).
   p_action: 'decline' يرفض ويبقى الطلب قائماً · 'refund' يُثبت ردّ المال
   بمرجع ومبلغ، فيُلغى الطلب وتعود الكمّية ويصدر إشعار دائن على الفاتورة.
   'open' يفتحها التاجر بنفسه حين يُلغي طلباً مدفوعاً (نفاد البضاعة مثلاً)،
   فيُسجَّل الدَّين عليه بدل إلغاءٍ صامت لا أثر له. */
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
  v_me    text := (SELECT auth.uid()::text);
  v_b     public.bookings%ROWTYPE;
  v_r     public.booking_refunds%ROWTYPE;
  v_admin boolean;
  v_amt   numeric;
  v_seq   integer;
  v_cn    text;
  v_shop  text;
  v_money text;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  v_admin := public.is_admin();

  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_me <> v_b.store_id AND NOT v_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_MERCHANT');
  END IF;
  IF v_b.paid_at IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_PAID'); END IF;

  SELECT COALESCE(NULLIF(u.shop,''), u.name) INTO v_shop FROM public.users u WHERE u.id = v_b.store_id;

  -- التاجر يفتحها بنفسه: يُسجَّل الدَّين ثم يُثبته لاحقاً بمرجع.
  IF p_action = 'open' THEN
    v_amt := round(COALESCE(NULLIF(v_b.paid_amount, 0), v_b.total_amount, 0), 2);
    INSERT INTO public.booking_refunds (barcode, store_id, buyer_id, status, opened_by, amount, merchant_note)
    VALUES (v_b.barcode, v_b.store_id, v_b.user_id, 'approved',
            CASE WHEN v_admin AND v_me <> v_b.store_id THEN 'admin' ELSE 'seller' END,
            v_amt, NULLIF(left(btrim(COALESCE(p_note,'')), 600), ''))
    ON CONFLICT (barcode) DO UPDATE
      SET status = 'approved', merchant_note = EXCLUDED.merchant_note,
          decided_at = now(), decided_by = v_me, updated_at = now();

    PERFORM public._refund_notify(v_b.user_id,
      '↩️ التاجر ألغى طلبك — والمبلغ مستحقّ لك', 'Merchant cancelled — a refund is due to you',
      'ألغى «' || COALESCE(v_shop,'المتجر') || '» الطلب ' || v_b.barcode || '، والمبلغ ' || trim(to_char(v_amt,'FM999999990.09')) || ' ر.س مستحقّ لك منه. سيصلك إشعار عند تأكيد الردّ.',
      '"' || COALESCE(v_shop,'The store') || '" cancelled order ' || v_b.barcode || '. A refund of ' || trim(to_char(v_amt,'FM999999990.09')) || ' SAR is due to you from the merchant.',
      v_b.barcode, 'buyer', 'refund_approved');

    RETURN jsonb_build_object('ok', true, 'status', 'approved', 'amount', v_amt);
  END IF;

  SELECT * INTO v_r FROM public.booking_refunds WHERE barcode = v_b.barcode;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NO_REQUEST'); END IF;
  IF v_r.status = 'refunded' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'status', 'refunded', 'credit_note_no', v_r.credit_note_no);
  END IF;

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
      '"' || COALESCE(v_shop,'The store') || '" declined the refund for order ' || v_b.barcode || ' under its published policy. Your order still stands. You may raise a complaint from «📣» — TAKI facilitates but does not adjudicate policies.',
      v_b.barcode, 'buyer', 'refund_declined');

    RETURN jsonb_build_object('ok', true, 'status', 'declined');
  END IF;

  -- ── تثبيت ردّ المال ──────────────────────────────────────────────────────
  IF p_action <> 'refund' THEN RETURN jsonb_build_object('ok', false, 'error', 'BAD_ACTION'); END IF;

  v_amt := round(COALESCE(p_amount, v_r.amount, 0), 2);
  IF NOT (v_amt > 0) THEN RETURN jsonb_build_object('ok', false, 'error', 'ZERO_AMOUNT'); END IF;

  -- إشعار دائن بسلسلة مستقلّة لكل تاجر — ذرّي كترقيم الفواتير.
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

  -- الآن فقط يُلغى الطلب: المال عاد فعلاً، فتعود الكمّية للبيع.
  IF v_b.status IN ('pending','acknowledged') THEN
    UPDATE public.bookings SET status = 'cancelled', cancelled_by = 'refund' WHERE barcode = v_b.barcode;
  END IF;

  v_money := trim(to_char(v_amt, 'FM999999990.09'));

  PERFORM public._refund_notify(v_b.user_id,
    '✅ أكّد التاجر ردّ المبلغ', 'The merchant confirmed your refund',
    'أكّد «' || COALESCE(v_shop,'المتجر') || '» ردّ ' || v_money || ' ر.س عن الطلب ' || v_b.barcode
      || COALESCE(' — المرجع: ' || NULLIF(btrim(COALESCE(p_ref,'')), ''), '')
      || '. إشعار دائن رقم ' || v_cn || ' على فاتورتك. مدّة وصول المبلغ لحسابك تحدّدها جهة الدفع لا تاكي.',
    '"' || COALESCE(v_shop,'The store') || '" confirmed a refund of ' || v_money || ' SAR for order ' || v_b.barcode
      || COALESCE(' — reference: ' || NULLIF(btrim(COALESCE(p_ref,'')), ''), '')
      || '. Credit note ' || v_cn || ' is on your invoice. The time to reach your account is set by the payment provider, not TAKI.',
    v_b.barcode, 'buyer', 'refund_done');

  PERFORM public._refund_notify(v_b.store_id,
    '✅ سُجِّل ردّ المبلغ', 'Refund recorded',
    'سُجِّل ردّ ' || v_money || ' ر.س عن الطلب ' || v_b.barcode || ' بإشعار دائن ' || v_cn || '، وأُلغي الطلب وعادت الكمّية للبيع.',
    'A refund of ' || v_money || ' SAR for order ' || v_b.barcode || ' was recorded as credit note ' || v_cn || '; the order is cancelled and the stock returned.',
    v_b.barcode, 'seller', 'refund_done');

  RETURN jsonb_build_object('ok', true, 'status', 'refunded', 'amount', v_amt, 'credit_note_no', v_cn);
END
$fn$;

REVOKE ALL ON FUNCTION public.resolve_booking_refund(text,text,text,numeric,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_booking_refund(text,text,text,numeric,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_booking_refund(text,text,text,numeric,text,text) TO authenticated, service_role;

/* المشتري يسحب طلبه (غيّر رأيه أو حلّها مع التاجر). */
CREATE OR REPLACE FUNCTION public.withdraw_booking_refund(p_barcode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_me text := (SELECT auth.uid()::text); v_r public.booking_refunds%ROWTYPE;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT * INTO v_r FROM public.booking_refunds WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_me <> v_r.buyer_id THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_BUYER'); END IF;
  IF v_r.status <> 'requested' THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_PENDING', 'status', v_r.status); END IF;
  UPDATE public.booking_refunds SET status = 'withdrawn', updated_at = now() WHERE barcode = v_r.barcode;
  PERFORM public._refund_notify(v_r.store_id,
    '↩️ سحب المشتري طلب الاسترداد', 'The buyer withdrew the refund request',
    'سحب المشتري طلب الإلغاء والاسترداد للطلب ' || v_r.barcode || '. الطلب قائم كما هو.',
    'The buyer withdrew the cancellation/refund request for order ' || v_r.barcode || '. The order stands.',
    v_r.barcode, 'seller', 'refund_withdrawn');
  RETURN jsonb_build_object('ok', true, 'status', 'withdrawn');
END
$fn$;

REVOKE ALL ON FUNCTION public.withdraw_booking_refund(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.withdraw_booking_refund(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.withdraw_booking_refund(text) TO authenticated, service_role;

/* قارئ حالة الاسترداد لطرفَي الطلب (الموقع والبوتان). */
CREATE OR REPLACE FUNCTION public.get_booking_refund(p_barcode text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_me text := (SELECT auth.uid()::text); v_r public.booking_refunds%ROWTYPE;
BEGIN
  IF v_me IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_r FROM public.booking_refunds WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_me <> v_r.buyer_id AND v_me <> v_r.store_id AND NOT public.is_admin() THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'barcode', v_r.barcode, 'status', v_r.status, 'amount', v_r.amount,
    'opened_by', v_r.opened_by, 'reason', v_r.reason, 'requested_at', v_r.requested_at,
    'merchant_note', v_r.merchant_note, 'decided_at', v_r.decided_at,
    'refunded_at', v_r.refunded_at, 'refund_amount', v_r.refund_amount,
    'refund_ref', v_r.refund_ref, 'refund_method', v_r.refund_method,
    'credit_note_no', v_r.credit_note_no);
END
$fn$;

REVOKE ALL ON FUNCTION public.get_booking_refund(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_booking_refund(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_booking_refund(text) TO authenticated, service_role;

COMMIT;

-- ═══ ٦) البوتان: نفس الدورة بالحرف (كل تعديل يمسّ القناتين معاً) ══════════
BEGIN;

CREATE OR REPLACE FUNCTION public.bot_request_booking_refund(
  p_telegram_id bigint, p_barcode text, p_reason text DEFAULT NULL, p_whatsapp_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid text; v_b public.bookings%ROWTYPE; v_amt numeric; v_shop text; v_cur public.booking_refunds%ROWTYPE;
BEGIN
  SELECT id INTO v_uid FROM public.users
   WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id) AND deleted_at IS NULL LIMIT 1;
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_linked'); END IF;
  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND OR v_b.user_id <> v_uid THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_b.paid_at IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_paid'); END IF;

  SELECT * INTO v_cur FROM public.booking_refunds WHERE barcode = v_b.barcode;
  IF FOUND AND v_cur.status IN ('requested','approved','refunded') THEN
    RETURN jsonb_build_object('success', true, 'already', true, 'status', v_cur.status);
  END IF;

  v_amt := round(COALESCE(NULLIF(v_b.paid_amount, 0), v_b.total_amount, 0), 2);
  INSERT INTO public.booking_refunds (barcode, store_id, buyer_id, status, opened_by, amount, reason)
  VALUES (v_b.barcode, v_b.store_id, v_b.user_id, 'requested', 'buyer', v_amt,
          NULLIF(left(btrim(COALESCE(p_reason,'')), 600), ''))
  ON CONFLICT (barcode) DO UPDATE
    SET status='requested', opened_by='buyer', amount=EXCLUDED.amount, reason=EXCLUDED.reason,
        requested_at=now(), decided_at=NULL, decided_by=NULL, merchant_note=NULL, updated_at=now();

  SELECT COALESCE(NULLIF(u.shop,''), u.name) INTO v_shop FROM public.users u WHERE u.id = v_b.store_id;
  PERFORM public._refund_notify(v_b.store_id,
    '↩️ طلب إلغاء واسترداد', 'Refund request',
    'طلب المشتري إلغاء الطلب ' || v_b.barcode || ' واسترداد ' || trim(to_char(v_amt,'FM999999990.09')) || ' ر.س. القرار لك وفق سياستك المعلنة.',
    'The buyer asked to cancel order ' || v_b.barcode || ' and be refunded ' || trim(to_char(v_amt,'FM999999990.09')) || ' SAR.',
    v_b.barcode, 'seller', 'refund_requested');
  PERFORM public._refund_notify(v_b.user_id,
    '↩️ وصل طلبك للتاجر', 'Your request was sent',
    'أرسلنا طلبك للطلب ' || v_b.barcode || ' إلى «' || COALESCE(v_shop,'المتجر') || '». القرار والتنفيذ عليه — تاكي وسيط لا تحتفظ بالمال ولا تبتّ فيه.',
    'Your request for order ' || v_b.barcode || ' was sent to "' || COALESCE(v_shop,'the store') || '".',
    v_b.barcode, 'buyer', 'refund_requested');

  RETURN jsonb_build_object('success', true, 'status', 'requested', 'amount', v_amt);
END
$fn$;

CREATE OR REPLACE FUNCTION public.bot_get_booking_refund(
  p_telegram_id bigint, p_barcode text, p_whatsapp_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_uid text; v_r public.booking_refunds%ROWTYPE;
BEGIN
  SELECT id INTO v_uid FROM public.users
   WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id) AND deleted_at IS NULL LIMIT 1;
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_r FROM public.booking_refunds WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_uid <> v_r.buyer_id AND v_uid <> v_r.store_id THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('status', v_r.status, 'amount', v_r.amount,
    'merchant_note', v_r.merchant_note, 'refund_amount', v_r.refund_amount,
    'refund_ref', v_r.refund_ref, 'credit_note_no', v_r.credit_note_no,
    'refunded_at', v_r.refunded_at, 'requested_at', v_r.requested_at);
END
$fn$;

-- ⚠️ دوال bot_* تُنادى بمفتاح anon خلف بوّابة `_bot_gate_ok()` — سحبُ anon عنها
--    يكسر البوتين (درس CLAUDE.md). الحماية من البوّابة لا من سحب الصلاحية.
GRANT EXECUTE ON FUNCTION public.bot_request_booking_refund(bigint,text,text,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bot_get_booking_refund(bigint,text,text) TO anon, authenticated, service_role;

COMMIT;

-- ═══ ٧) الإشعار الدائن يظهر على فاتورة البوتين ════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.bot_booking_refund_line(p_barcode text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT jsonb_build_object(
      'status', r.status, 'credit_note_no', r.credit_note_no,
      'refund_amount', r.refund_amount, 'refund_ref', r.refund_ref, 'refunded_at', r.refunded_at)
    FROM public.booking_refunds r WHERE r.barcode = upper(btrim(p_barcode));
$fn$;

REVOKE ALL ON FUNCTION public.bot_booking_refund_line(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bot_booking_refund_line(text) FROM anon;
REVOKE ALL ON FUNCTION public.bot_booking_refund_line(text) FROM authenticated;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- جدول التحقّق — أوّل سطر فيه اسم الخادم
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS "الفحص",
       COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'standard public schema') AS "النتيجة",
       CASE WHEN COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') NOT LIKE 'TAKI_LAB_TOKYO%'
            THEN '✅ جدة (إنتاج)' ELSE '❌ المختبر' END AS "الحالة";

SELECT 'حقول سياسة التاجر' AS "الفحص",
       count(*)::text || '/2' AS "النتيجة",
       CASE WHEN count(*) = 2 THEN '✅' ELSE '❌' END AS "الحالة"
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='store_profiles'
   AND column_name IN ('refund_policy','store_terms');

SELECT 'جدول الاسترداد' AS "الفحص",
       count(*)::text || '/1' AS "النتيجة",
       CASE WHEN count(*) = 1 THEN '✅' ELSE '❌' END AS "الحالة"
  FROM information_schema.tables WHERE table_schema='public' AND table_name='booking_refunds';

SELECT 'الموقع يرفض إلغاء طلب مدفوع' AS "الفحص",
       CASE WHEN pg_get_functiondef('public.cancel_booking(text)'::regprocedure) LIKE '%TAKI_PAID_NEEDS_REFUND%'
            THEN 'يرفض' ELSE 'يسمح' END AS "النتيجة",
       CASE WHEN pg_get_functiondef('public.cancel_booking(text)'::regprocedure) LIKE '%TAKI_PAID_NEEDS_REFUND%'
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'البوتان يرفضان كذلك' AS "الفحص",
       CASE WHEN pg_get_functiondef(p.oid) LIKE '%paid_needs_refund%' THEN 'يرفضان' ELSE 'يسمحان' END AS "النتيجة",
       CASE WHEN pg_get_functiondef(p.oid) LIKE '%paid_needs_refund%' THEN '✅' ELSE '❌' END AS "الحالة"
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='bot_cancel_booking';

SELECT 'حذف الطلب المدفوع ممنوع (الالتفاف على الحارس)' AS "الفحص",
       CASE WHEN pg_get_expr(polqual, polrelid) LIKE '%paid_at IS NULL%' THEN 'ممنوع' ELSE 'ممكن' END AS "النتيجة",
       CASE WHEN pg_get_expr(polqual, polrelid) LIKE '%paid_at IS NULL%' THEN '✅' ELSE '❌' END AS "الحالة"
  FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
 WHERE c.relname='bookings' AND p.polname='bookings_delete_own';

SELECT 'دوال الدورة الخمس موجودة' AS "الفحص",
       count(*)::text || '/5' AS "النتيجة",
       CASE WHEN count(*) = 5 THEN '✅' ELSE '❌' END AS "الحالة"
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN
   ('request_booking_refund','resolve_booking_refund','withdraw_booking_refund',
    'get_booking_refund','bot_request_booking_refund');

SELECT 'الزائر لا يقرأ طلبات الاسترداد' AS "الفحص",
       CASE WHEN has_table_privilege('anon','public.booking_refunds','SELECT') THEN 'يقرأ' ELSE 'ممنوع' END AS "النتيجة",
       CASE WHEN has_table_privilege('anon','public.booking_refunds','SELECT') THEN '❌' ELSE '✅' END AS "الحالة";

SELECT 'السياسة المعلنة يقرؤها الزائر (عمداً)' AS "الفحص",
       CASE WHEN has_function_privilege('anon','public.store_policies(text)','EXECUTE') THEN 'يقرأ' ELSE 'محجوب' END AS "النتيجة",
       CASE WHEN has_function_privilege('anon','public.store_policies(text)','EXECUTE') THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'طلبات استرداد قائمة' AS "الفحص",
       (SELECT count(*) FROM public.booking_refunds)::text || ' · طلبات مدفوعة: ' ||
       (SELECT count(*) FROM public.bookings WHERE paid_at IS NOT NULL)::text AS "النتيجة",
       'ℹ️ للعلم' AS "الحالة";
