-- ═══════════════════════════════════════════════════════════════════════════
-- JEDDAH_v14_10_booking_hold.sql — مهلة الحجز تفرّق بين الاستلام والتوصيل
--                                   + زرّ «استلمت طلبي» للمشتري
--
-- المشكلة التي يعالجها (مقيسة على جدة ١٠ سبتمبر ٢٠٢٦):
--   كل حجز يُكتب له سقف ساعتين ثابت من **العميل** (AppContext.tsx) أو من
--   bot_book_deal (`v_now + 7200000`)، ثم تُلغي `expire_due_bookings` كل ما
--   تجاوز مهلته — كل دقيقتين عبر كرون `taki-booking-expiry`.
--   ولا استثناء فيها لطلب توصيل والمندوب في الطريق، ولا لطلب مدفوع بالبطاقة.
--   فطلبٌ سُلِّم فعلاً ينقلب «ملغى»، وتُرجَع كميته للمخزون فتُباع مرّتين،
--   ويُعرض على تاجره «مدفوع ثم أُلغي — يستوجب استرداداً» عن بضاعة خرجت.
--
-- العلاج بثلاث طبقات، بلا لمس وظيفة الكرون إطلاقاً:
--   ١) الخادم هو من يكتب `expiry_time` عند الإدراج (لا العميل)، بمهلة تختلف
--      بحسب `fulfillment`، مقروءة من صفّ إعدادات واحد.
--   ٢) `expire_due_bookings` تستثني: المدفوع إلكترونياً أبداً، وطلب التوصيل
--      الذي انطلق مندوبه — حتى شبكة أمان `in_progress_hours` كي لا يُحبس
--      المخزون إلى الأبد لو نسي التاجر إغلاق الطلب.
--   ٣) `buyer_confirm_receipt` تمنح المشتري إغلاق طلبه — بشرط أن يكون التاجر
--      قد أعلن الانطلاق فعلاً، وهي الحصانة الوحيدة الحقيقية ضدّ إغلاق طلب
--      لم يصل (لأن حالة المندوب لا يستطيع المشتري كتابتها).
--
-- 🔵 قرارُ تصميم مقصود: التمديد **للتوصيل وحده**. طلب الاستلام يبقى عدّاده
--    ماشياً على ساعتين، لأن المخزون يُخصم لحظة الحجز ولا يعود إلا بالإلغاء،
--    فتمديدُه ٧٢ ساعة يحبس القطعة ٣٦ ضعف ما يحبسه اليوم على أكثر المسارات
--    شيوعاً في المنصّة.
--
-- آمنة للتكرار (idempotent) — تُنفَّذ مرّات بلا أثر جانبي.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- ───────────────────────────────────────────────────────────────────────────
-- حارس الخادم: هذا الملف للإنتاج (جدة) وحده. المختبر (طوكيو) يحمل وسماً.
-- ───────────────────────────────────────────────────────────────────────────
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

-- ═══ ١) صفّ الإعدادات: المكان الوحيد الذي تُكتب فيه الأرقام ═══════════════
INSERT INTO public.platform_settings (key, value, description)
VALUES (
  'booking_holds',
  '{"pickup_hours": 2, "delivery_hours": 6, "in_progress_hours": 72}'::jsonb,
  'مهلة الحجز بالساعات: الاستلام · التوصيل · شبكة أمان الطلب المنطلق'
)
ON CONFLICT (key) DO NOTHING;   -- لا تدهس ضبطاً اختاره ناصر لاحقاً

-- قارئ واحد للأرقام. STABLE فيُخزَّن داخل العبارة الواحدة.
CREATE OR REPLACE FUNCTION public.taki_booking_hold_hours(p_fulfillment text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT GREATEST(
    0.25,                                   -- لا تسمح بمهلة أقصر من ١٥ دقيقة مهما ضُبط
    LEAST(
      8760,                                 -- ولا أطول من سنة
      COALESCE(
        (SELECT CASE WHEN COALESCE(p_fulfillment,'pickup') = 'delivery'
                     THEN (value->>'delivery_hours')::numeric
                     ELSE (value->>'pickup_hours')::numeric END
           FROM public.platform_settings WHERE key = 'booking_holds' LIMIT 1),
        CASE WHEN COALESCE(p_fulfillment,'pickup') = 'delivery' THEN 6 ELSE 2 END
      )
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.taki_booking_grace_hours()
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT GREATEST(1, LEAST(8760, COALESCE(
    (SELECT (value->>'in_progress_hours')::numeric
       FROM public.platform_settings WHERE key = 'booking_holds' LIMIT 1), 72)));
$$;

REVOKE ALL ON FUNCTION public.taki_booking_hold_hours(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_booking_grace_hours()   FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.taki_booking_hold_hours(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.taki_booking_grace_hours()    TO anon, authenticated, service_role;

-- ═══ ٢) الخادم يكتب المهلة، لا العميل ════════════════════════════════════
-- يعمل بعد `tr_ac_booking_delivery` (ترتيب أبجدي) فتكون `fulfillment` نهائية.
CREATE OR REPLACE FUNCTION public.tr_ad_set_booking_hold()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_booked bigint;
BEGIN
  v_booked := COALESCE(NEW.booked_at, (EXTRACT(EPOCH FROM NOW())*1000)::bigint);
  NEW.booked_at   := v_booked;
  -- ⚠️ الدرس المدفوع (v12.07): لا تُقصّ المهلة إلى نهاية العرض إطلاقاً.
  NEW.expiry_time := v_booked
    + (public.taki_booking_hold_hours(COALESCE(NEW.fulfillment,'pickup')) * 3600000)::bigint;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_ad_set_booking_hold ON public.bookings;
CREATE TRIGGER tr_ad_set_booking_hold
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tr_ad_set_booking_hold();

-- ═══ ٣) عمود «من أغلق الطلب» + تجميده على جلسة العميل ════════════════════
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS completed_by text;
COMMENT ON COLUMN public.bookings.completed_by IS
  'seller | buyer | system — من أغلق الطلب. يُكتب من الخادم وحده (أثر تدقيق للنزاعات).';

-- إعادة كتابة الحارس كاملاً (منقول حرفياً من الخادم + سطر completed_by).
CREATE OR REPLACE FUNCTION public.tr_guard_booking_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- The lifecycle RPCs, pg_cron and the payment function all run as the owner.
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF coalesce(NEW.status, 'pending') <> 'pending' THEN
      RAISE EXCEPTION 'forbidden: a new booking must start as pending'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.paid_at          IS NOT NULL
    OR NEW.paid_amount      IS NOT NULL
    OR NEW.payment_provider IS NOT NULL
    OR NEW.payment_ref      IS NOT NULL
    OR NEW.payment_expected IS NOT NULL
    OR NEW.completed_at     IS NOT NULL
    OR NEW.completed_by     IS NOT NULL
    OR NEW.cancelled_by     IS NOT NULL
    OR NEW.merchant_note    IS NOT NULL THEN
      RAISE EXCEPTION 'forbidden: payment and lifecycle fields are set by the server'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE from a client session: identity, money, stock and lifecycle frozen.
  IF NEW.barcode          IS DISTINCT FROM OLD.barcode
  OR NEW.backup_code      IS DISTINCT FROM OLD.backup_code
  OR NEW.deal_id          IS DISTINCT FROM OLD.deal_id
  OR NEW.user_id          IS DISTINCT FROM OLD.user_id
  OR NEW.store_id         IS DISTINCT FROM OLD.store_id
  OR NEW.booked_quantity  IS DISTINCT FROM OLD.booked_quantity
  OR NEW.booked_at        IS DISTINCT FROM OLD.booked_at
  OR NEW.expiry_time      IS DISTINCT FROM OLD.expiry_time
  OR NEW.status           IS DISTINCT FROM OLD.status
  OR NEW.completed_at     IS DISTINCT FROM OLD.completed_at
  OR NEW.completed_by     IS DISTINCT FROM OLD.completed_by
  OR NEW.paid_at          IS DISTINCT FROM OLD.paid_at
  OR NEW.paid_amount      IS DISTINCT FROM OLD.paid_amount
  OR NEW.payment_provider IS DISTINCT FROM OLD.payment_provider
  OR NEW.payment_ref      IS DISTINCT FROM OLD.payment_ref
  OR NEW.payment_expected IS DISTINCT FROM OLD.payment_expected
  OR NEW.payment_method   IS DISTINCT FROM OLD.payment_method
  OR NEW.selected_options IS DISTINCT FROM OLD.selected_options
  OR NEW.cancelled_by     IS DISTINCT FROM OLD.cancelled_by
  OR NEW.merchant_note    IS DISTINCT FROM OLD.merchant_note
  OR NEW.location_id      IS DISTINCT FROM OLD.location_id
  OR NEW.fulfillment      IS DISTINCT FROM OLD.fulfillment
  OR NEW.delivery_address IS DISTINCT FROM OLD.delivery_address
  OR NEW.delivery_fee     IS DISTINCT FROM OLD.delivery_fee THEN
    RAISE EXCEPTION 'forbidden: booking payment and lifecycle fields are server-managed'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- ═══ ٤) الحاصد يستثني المدفوع والمنطلق ═══════════════════════════════════
CREATE OR REPLACE FUNCTION public.expire_due_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now     bigint  := (EXTRACT(EPOCH FROM NOW())*1000)::bigint;
  v_grace   bigint  := (public.taki_booking_grace_hours() * 3600000)::bigint;
  v_count   int;
BEGIN
  WITH upd AS (
    UPDATE public.bookings b
       SET status = 'cancelled', cancelled_by = 'system'
     WHERE b.status IN ('pending','acknowledged')
       AND b.expiry_time IS NOT NULL
       AND b.expiry_time < v_now
       -- (أ) طلبٌ دفع صاحبه بالبطاقة لا يُلغى تلقائياً أبداً. إلغاؤه يخلق
       --     مطالبة استرداد كاذبة، ولا أحد يراجعها.
       AND b.paid_at IS NULL
       -- (ب) طلب توصيل انطلق مندوبه: العدّاد متوقّف — حتى شبكة الأمان.
       AND NOT (
             EXISTS (SELECT 1 FROM public.delivery_tracks t
                      WHERE t.barcode = b.barcode
                        AND t.status IN ('preparing','on_the_way','arrived','delivered'))
             AND b.booked_at + v_grace > v_now
           )
    RETURNING 1
  ) SELECT count(*) INTO v_count FROM upd;
  RETURN COALESCE(v_count,0);
END;
$function$;

-- التنبيه «باقٍ ١٥ دقيقة» يتبع نفس الاستثناءات، وإلا أنذر صاحب طلب لا مهلة عليه.
CREATE OR REPLACE FUNCTION public.warn_expiring_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now bigint := (EXTRACT(EPOCH FROM NOW())*1000)::bigint;
  v_count int := 0; r record; v_item text;
  s jsonb; v_min int; vars jsonb; v_title text; v_body text;
BEGIN
  s := public.taki_msg_setting('booking_reminder');
  IF NOT COALESCE((s->>'enabled')::boolean, true) THEN RETURN 0; END IF;
  v_min := LEAST(GREATEST(COALESCE((s->>'minutes_before')::int, 15), 5), 240);

  FOR r IN SELECT b.* FROM public.bookings b
           WHERE b.status IN ('pending','acknowledged')
             AND COALESCE(b.expiry_warned,false) = false
             AND b.expiry_time > v_now
             AND b.expiry_time <= v_now + (v_min::bigint * 60000)   -- bigint: no int32 overflow
             AND b.paid_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM public.delivery_tracks t
                              WHERE t.barcode = b.barcode
                                AND t.status IN ('preparing','on_the_way','arrived','delivered'))
  LOOP
    SELECT item_name INTO v_item FROM public.deals WHERE id = r.deal_id;
    vars := jsonb_build_object('minutes', v_min::text, 'item', COALESCE(v_item, 'العرض'));
    v_title := public.taki_render_template(s->>'title_ar', vars);
    v_body  := public.taki_render_template(s->>'body_ar',  vars);
    IF COALESCE((s->'channels'->>'inapp')::boolean, true) THEN
        INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
        VALUES (r.user_id, v_title,
                public.taki_render_template(s->>'title_en', vars),
                v_body,
                public.taki_render_template(s->>'body_en', vars),
                'booking',
                jsonb_build_object('audience','buyer','event','warning','barcode',r.barcode,'dealId',r.deal_id),
                NOW());
    END IF;
    IF COALESCE((s->'channels'->>'email')::boolean, false) THEN
        PERFORM public.taki_queue_email(r.user_id, 'booking_reminder', v_title,
            public.taki_email_wrap(v_title, '<p>' || replace(v_body, E'\n', '<br>') || '</p>'));
    END IF;
    UPDATE public.bookings SET expiry_warned = true WHERE barcode = r.barcode;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

-- ═══ ٥) زرّ المشتري «استلمت طلبي» ════════════════════════════════════════
-- الحصانة: لا يُغلق المشتري طلباً إلا بعد أن يعلن التاجر الانطلاق فعلاً.
-- حالة المندوب يكتبها التاجر وحده (delivery_track_set_status يشترط store_id).
DROP FUNCTION IF EXISTS public.buyer_confirm_receipt(text);
CREATE FUNCTION public.buyer_confirm_receipt(p_barcode text)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid  text := auth.uid()::text;
  v_b    public.bookings%ROWTYPE;
  v_trk  text;
  v_out  public.bookings;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND OR v_b.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'لم يتم العثور على الطلب' USING ERRCODE = 'P0002';
  END IF;
  IF COALESCE(v_b.fulfillment,'pickup') <> 'delivery' THEN
    RAISE EXCEPTION 'هذا الزرّ لطلبات التوصيل فقط' USING ERRCODE = 'P0001';
  END IF;
  IF v_b.status NOT IN ('pending','acknowledged') THEN
    RAISE EXCEPTION 'الطلب مغلق بالفعل' USING ERRCODE = 'P0001';
  END IF;

  SELECT status INTO v_trk FROM public.delivery_tracks WHERE barcode = v_b.barcode;
  IF COALESCE(v_trk,'') NOT IN ('on_the_way','arrived','delivered') THEN
    RAISE EXCEPTION 'لم يبدأ التاجر التوصيل بعد' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.bookings
     SET status = 'completed', completed_by = 'buyer'
   WHERE barcode = v_b.barcode
     AND status IN ('pending','acknowledged')
  RETURNING * INTO v_out;

  IF v_out.barcode IS NULL THEN
    RAISE EXCEPTION 'الطلب مغلق بالفعل' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
  VALUES (v_out.store_id,
          '✅ أكّد المشتري الاستلام', '✅ Buyer confirmed receipt',
          'أكّد المشتري استلام الطلب ' || v_out.barcode,
          'The buyer confirmed receiving order ' || v_out.barcode,
          'booking',
          jsonb_build_object('audience','seller','event','buyer_confirmed',
                             'barcode', v_out.barcode, 'dealId', v_out.deal_id),
          NOW());

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.buyer_confirm_receipt(text) FROM PUBLIC;
-- 🪤 فخّ موثَّق: Supabase يمنح anon تنفيذاً افتراضياً لكل دالة جديدة في public،
--    و REVOKE ... FROM PUBLIC لا يلغيه. لا بدّ من REVOKE صريح على anon.
REVOKE ALL ON FUNCTION public.buyer_confirm_receipt(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.buyer_confirm_receipt(text) TO authenticated;

-- نفس الإجراء من البوتين (تيليجرام + واتساب) خلف بوّابة السرّ.
DROP FUNCTION IF EXISTS public.bot_buyer_confirm_receipt(bigint, text, text);
CREATE FUNCTION public.bot_buyer_confirm_receipt(
  p_telegram_id bigint, p_barcode text, p_whatsapp_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_uid text; v_b public.bookings%ROWTYPE; v_trk text;
BEGIN
  IF NOT public._bot_gate_ok() THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT id INTO v_uid FROM public.users
   WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id) AND deleted_at IS NULL LIMIT 1;
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_linked'); END IF;

  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode)) AND user_id = v_uid;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF COALESCE(v_b.fulfillment,'pickup') <> 'delivery' THEN
    RETURN jsonb_build_object('success',false,'error','not_delivery'); END IF;
  IF v_b.status NOT IN ('pending','acknowledged') THEN
    RETURN jsonb_build_object('success',false,'error','closed'); END IF;

  SELECT status INTO v_trk FROM public.delivery_tracks WHERE barcode = v_b.barcode;
  IF COALESCE(v_trk,'') NOT IN ('on_the_way','arrived','delivered') THEN
    RETURN jsonb_build_object('success',false,'error','not_dispatched'); END IF;

  UPDATE public.bookings SET status='completed', completed_by='buyer'
   WHERE barcode = v_b.barcode AND status IN ('pending','acknowledged');

  INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
  VALUES (v_b.store_id, '✅ أكّد المشتري الاستلام', '✅ Buyer confirmed receipt',
          'أكّد المشتري استلام الطلب ' || v_b.barcode,
          'The buyer confirmed receiving order ' || v_b.barcode,
          'booking',
          jsonb_build_object('audience','seller','event','buyer_confirmed',
                             'barcode', v_b.barcode, 'dealId', v_b.deal_id),
          NOW());

  RETURN jsonb_build_object('success', true, 'barcode', v_b.barcode);
END;
$$;

REVOKE ALL ON FUNCTION public.bot_buyer_confirm_receipt(bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bot_buyer_confirm_receipt(bigint, text, text) TO anon, authenticated, service_role;

-- ═══ ٦) البوتان يريان حالة السداد وحالة المندوب ═══════════════════════════
-- (منقولة حرفياً من الخادم + ثلاثة حقول. التوقيع لم يتغيّر فهي استبدال لا نسخة ثانية.)
CREATE OR REPLACE FUNCTION public.bot_get_my_bookings(
  p_telegram_id bigint, p_scope text DEFAULT 'all'::text, p_whatsapp_id text DEFAULT NULL::text)
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
END; $function$;

-- ═══ ٧) إصلاح الطلبات الحيّة القائمة الآن ═════════════════════════════════
-- طلبات توصيل مفتوحة كُتبت بمهلة ساعتين قبل هذه الهجرة: تُمدَّد إلى مهلتها.
UPDATE public.bookings b
   SET expiry_time = b.booked_at + (public.taki_booking_hold_hours('delivery') * 3600000)::bigint
 WHERE b.status IN ('pending','acknowledged')
   AND COALESCE(b.fulfillment,'pickup') = 'delivery'
   AND b.expiry_time < b.booked_at + (public.taki_booking_hold_hours('delivery') * 3600000)::bigint;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- جدول التحقّق — أوّل سطر فيه اسم الخادم، فلا يُخلط الإنتاج بالمختبر.
-- ═══════════════════════════════════════════════════════════════════════════
\echo ''
\echo '════════ نتيجة v14.10 ════════'
SELECT 'الخادم' AS "الفحص",
       COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'JEDDAH (production — no lab marker)') AS "النتيجة",
       '🖥' AS "الحالة";

SELECT 'صفّ الإعدادات booking_holds' AS "الفحص",
       COALESCE((SELECT value::text FROM public.platform_settings WHERE key='booking_holds'),'—') AS "النتيجة",
       CASE WHEN EXISTS (SELECT 1 FROM public.platform_settings WHERE key='booking_holds')
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'مهلة الاستلام / التوصيل / الأمان (ساعات)' AS "الفحص",
       public.taki_booking_hold_hours('pickup')::text || ' / ' ||
       public.taki_booking_hold_hours('delivery')::text || ' / ' ||
       public.taki_booking_grace_hours()::text AS "النتيجة",
       CASE WHEN public.taki_booking_hold_hours('delivery') > public.taki_booking_hold_hours('pickup')
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'مشغّل كتابة المهلة من الخادم' AS "الفحص",
       COALESCE((SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
                  WHERE c.relname='bookings' AND t.tgname='tr_ad_set_booking_hold'),'—') AS "النتيجة",
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
                          WHERE c.relname='bookings' AND t.tgname='tr_ad_set_booking_hold')
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'الحاصد يستثني المدفوع' AS "الفحص", 'paid_at IS NULL' AS "النتيجة",
       CASE WHEN (SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                   WHERE n.nspname='public' AND p.proname='expire_due_bookings')
                 LIKE '%paid_at IS NULL%' THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'الحاصد يستثني المندوب المنطلق' AS "الفحص", 'delivery_tracks' AS "النتيجة",
       CASE WHEN (SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                   WHERE n.nspname='public' AND p.proname='expire_due_bookings')
                 LIKE '%delivery_tracks%' THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'التنبيه يتبع نفس الاستثناءات' AS "الفحص", 'warn_expiring_bookings' AS "النتيجة",
       CASE WHEN (SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                   WHERE n.nspname='public' AND p.proname='warn_expiring_bookings')
                 LIKE '%delivery_tracks%' THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'عمود completed_by' AS "الفحص", 'bookings.completed_by' AS "النتيجة",
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema='public' AND table_name='bookings' AND column_name='completed_by')
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'completed_by مجمَّد على العميل' AS "الفحص", 'tr_guard_booking_integrity' AS "النتيجة",
       CASE WHEN (SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                   WHERE n.nspname='public' AND p.proname='tr_guard_booking_integrity')
                 LIKE '%NEW.completed_by     IS DISTINCT FROM OLD.completed_by%' THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'زرّ المشتري (ويب)' AS "الفحص", 'buyer_confirm_receipt' AS "النتيجة",
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                          WHERE n.nspname='public' AND p.proname='buyer_confirm_receipt')
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'زرّ المشتري (البوتان)' AS "الفحص", 'bot_buyer_confirm_receipt' AS "النتيجة",
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                          WHERE n.nspname='public' AND p.proname='bot_buyer_confirm_receipt')
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'الزائر لا ينفّذ زرّ المشتري' AS "الفحص", 'anon EXECUTE' AS "النتيجة",
       CASE WHEN has_function_privilege('anon','public.buyer_confirm_receipt(text)','EXECUTE')
            THEN '❌ مكشوف' ELSE '✅' END AS "الحالة";

SELECT 'البوتان يريان السداد وحالة المندوب' AS "الفحص", 'bot_get_my_bookings' AS "النتيجة",
       CASE WHEN (SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                   WHERE n.nspname='public' AND p.proname='bot_get_my_bookings')
                 LIKE '%dlv_status%' THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'طلبات توصيل حيّة بمهلة قديمة' AS "الفحص",
       (SELECT count(*)::text FROM public.bookings
         WHERE status IN ('pending','acknowledged')
           AND COALESCE(fulfillment,'pickup')='delivery'
           AND expiry_time < booked_at + (public.taki_booking_hold_hours('delivery')*3600000)::bigint) AS "النتيجة",
       CASE WHEN (SELECT count(*) FROM public.bookings
                   WHERE status IN ('pending','acknowledged')
                     AND COALESCE(fulfillment,'pickup')='delivery'
                     AND expiry_time < booked_at + (public.taki_booking_hold_hours('delivery')*3600000)::bigint) = 0
            THEN '✅' ELSE '❌' END AS "الحالة";
