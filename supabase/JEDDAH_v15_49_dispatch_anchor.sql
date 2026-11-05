-- ═══════════════════════════════════════════════════════════════════════════
-- v15.49 — انطلاقُ المندوب لا يُنسى
-- ═══════════════════════════════════════════════════════════════════════════
-- كشفه الفحصُ المستقلّ لإصدارات ٤٢–٤٤، وهو **أخطرُ** ما خرج به — وليس من
-- صنع تلك الإصدارات بل من تقاطعها مع التوصيل (v14.07):
--
--   `delivery_tracks.status` يحمل معنيين لا يجوز اجتماعهما: «أين المندوبُ
--   الآن» و«هل انطلق أصلاً». والمنظّفُ `taki_expire_delivery_tracks` يكتب
--   `status = 'cancelled'` بعد ساعةٍ من صمت الهاتف — وهو **مسحُ بثٍّ بائت**
--   لا رجوعٌ عن الانطلاق. لكنّ ثلاثة قُرّاء يقرؤونه رجوعاً:
--     · `buyer_confirm_receipt` ترفض بـ«لم يبدأ التاجر التوصيل بعد»
--     · `expire_due_bookings` تُسقط حمايةَ الطلب المنطلق فتُلغيه
--     · والواجهةُ والبوتان يُخفون الزرّ بلا سطرٍ يقول لماذا
--
--   السيناريو المقيس: تاجرٌ ينطلق، يسلّم البضاعة، ويغلق اللوحة بلا «تم
--   التسليم». بعد ساعة: المشترية تفقد زرَّ التأكيد، ثمّ يُلغى الطلبُ الذي
--   في يدها تلقائياً وتعود بضاعتُه للبيع. وهذا بعينه عطبُ v14.10 الذي
--   بُنيت الميزةُ لمنعه.
--
-- العلاجُ **بنيويّ لا نصّيّ**: عمودُ انطلاقٍ `dispatched_at` يطبعه مشغّلٌ
-- عند أيّ حالةِ انطلاق، **ولا يملك أحدٌ محوَه** — فلا يُعاد العيبُ بكاتبٍ
-- جديد لا يعرف القاعدة. ثمّ حقيقتان تُقرآن بدل القائمة:
--   `taki_delivery_dispatched`   — هل غادرت البضاعةُ المتجر؟
--   `taki_delivery_hold_stopped` — هل توقّف عدّادُ الإلغاء التلقائي؟
--
-- 🪤 و`started_at` وحده لا يكفي: `delivery_track_set_status` تطبعه عند
--    `on_the_way` **وحدها**، فتاجرٌ يضغط «وصل» أو «تم التسليم» مباشرةً
--    يترك العمود فارغاً — ثمّ يمحو المنظّفُ الحالةَ فيضيع الانطلاق.
--
-- 🔴 وثانياً: شبكةُ الأمان كانت تساوي صفراً عند الحدّ. `in_progress_hours`
--    (٧٢) هي نفسُها `max_hold_hours` (٧٢)، والحمايةُ = الفرقُ بينهما ⇒ تاجرُ
--    توصيلٍ يضبط مهلته على أقصى ما تعرضه بطاقته يُلغى طلبُه **ومندوبه في
--    الطريق**. والعلاجُ لا يُنقص مهلةَ أحد: كلّ طلبٍ منطلقٍ يُحمى حتى
--    **ساعةٍ بعد انتهاء مهلته هو** على الأقلّ، أيّاً كانت.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regclass('public.delivery_tracks') IS NULL THEN
    RAISE EXCEPTION 'جدولُ التتبّع غائب — أوقِفت.';
  END IF;
  -- 🪤 المنظّفُ هو سببُ العيب؛ إن غاب فالهجرةُ تُصلح ما لا يُكسر.
  IF to_regprocedure('public.taki_expire_delivery_tracks()') IS NULL THEN
    RAISE EXCEPTION 'منظّفُ المسارات غائب — أوقِفت.';
  END IF;
END
$guard$;

-- ── ١) عمودُ الانطلاق ──────────────────────────────────────────────────────
ALTER TABLE public.delivery_tracks ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;

COMMENT ON COLUMN public.delivery_tracks.dispatched_at IS
  'لحظةُ مغادرة البضاعة المتجر. تُطبع مرّةً ولا تُمحى أبداً (tr_bu_stamp_dispatch). '
  'و`status` حالةٌ لحظيّة يكتبها المنظّفُ — فلا يُستدلّ منها على الانطلاق.';

-- وملءٌ لما مضى: كلُّ صفٍّ يحمل أثرَ انطلاقٍ يُطبع بأقدم أثرٍ متاح.
UPDATE public.delivery_tracks
   SET dispatched_at = COALESCE(started_at, ended_at, updated_at, created_at)
 WHERE dispatched_at IS NULL
   AND (started_at IS NOT NULL OR status IN ('on_the_way','arrived','delivered'));

-- ── ٢) مشغّلٌ يطبع الانطلاق ويمنع محوه ───────────────────────────────────
-- 🪤 وهو **قبل** الكتابة لا بعدها: الطابعُ بعد الكتابة لا يستطيع ردّ محوٍ وقع.
CREATE OR REPLACE FUNCTION public.tr_stamp_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- أيُّ حالةِ انطلاقٍ تطبع، و`started_at` المطبوع سابقاً يطبع أيضاً.
  IF NEW.status IN ('on_the_way','arrived','delivered') OR NEW.started_at IS NOT NULL THEN
    NEW.dispatched_at := COALESCE(NEW.dispatched_at, now());
  END IF;
  -- ولا يُمحى بعد طبعه — ولو كتبها الكودُ صراحةً NULL.
  IF TG_OP = 'UPDATE' AND OLD.dispatched_at IS NOT NULL THEN
    NEW.dispatched_at := OLD.dispatched_at;
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS tr_bu_stamp_dispatch ON public.delivery_tracks;
CREATE TRIGGER tr_bu_stamp_dispatch
  BEFORE INSERT OR UPDATE ON public.delivery_tracks
  FOR EACH ROW EXECUTE FUNCTION public.tr_stamp_dispatch();

-- ── ٣) الحقيقتان ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.taki_delivery_dispatched(p_barcode text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.delivery_tracks t
     WHERE t.barcode = upper(btrim(p_barcode))
       AND (t.dispatched_at IS NOT NULL
            OR t.started_at IS NOT NULL
            OR t.status IN ('on_the_way','arrived','delivered')));
$function$;

CREATE OR REPLACE FUNCTION public.taki_delivery_hold_stopped(p_barcode text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- «توقّف العدّاد» أوسعُ من «انطلق»: التجهيزُ وحده يوقفه (v14.10).
  SELECT EXISTS (
    SELECT 1 FROM public.delivery_tracks t
     WHERE t.barcode = upper(btrim(p_barcode))
       AND (t.dispatched_at IS NOT NULL
            OR t.started_at IS NOT NULL
            OR t.status IN ('preparing','on_the_way','arrived','delivered')));
$function$;

-- 🪤 المنحُ الافتراضيّ لـ`anon` قائمٌ على كلّ دالّةٍ عامّةٍ جديدة، و`REVOKE
--    FROM PUBLIC` لا يُلغيه وحده — فالاثنان معاً (فخٌّ موثَّق، وقع أربع مرّات).
REVOKE ALL ON FUNCTION public.taki_delivery_dispatched(text)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.taki_delivery_hold_stopped(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.taki_delivery_dispatched(text)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.taki_delivery_hold_stopped(text) TO authenticated, service_role;

-- ── ٤) القارئُ الأوّل: زرُّ المشتري على الموقع ─────────────────────────────
-- (منسوخةٌ من `pg_get_functiondef` الحيّ؛ المتغيّرُ سطرُ البوّابة وحده.)
CREATE OR REPLACE FUNCTION public.buyer_confirm_receipt(p_barcode text)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  text := auth.uid()::text;
  v_b    public.bookings%ROWTYPE;
  v_left integer;
  v_anchor bigint;
  v_out  public.bookings;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND OR v_b.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'لم يتم العثور على الطلب' USING ERRCODE = 'P0002';
  END IF;
  -- v15.41 — الزرُّ لكلّ طلبٍ حيّ، والتوصيلُ وحده يشترط انطلاقَ المندوب.
  IF v_b.status NOT IN ('pending','acknowledged') THEN
    RAISE EXCEPTION 'الطلب مغلق بالفعل' USING ERRCODE = 'P0001';
  END IF;

  -- 🔴 v15.49 — «انطلق» لا «أين هو الآن». كانت تقرأ `status` فكان المنظّفُ
  --    يسحب الزرَّ من يد مشترٍ استلم بضاعته فعلاً بعد ساعةٍ من صمت الهاتف.
  IF COALESCE(v_b.fulfillment,'pickup') = 'delivery'
     AND NOT public.taki_delivery_dispatched(v_b.barcode) THEN
    RAISE EXCEPTION 'لم يبدأ التاجر التوصيل بعد' USING ERRCODE = 'P0001';
  END IF;

  -- 🔴 v15.42 — المهلةُ قبل أن يُسمح بالختم الذاتيّ.
  -- 🪤 ولا تُصاغ الدقائقُ نصّاً هنا: العربيّةُ تحتاج خمسَ صيغٍ للمعدود، ومحرّكُها
  --    في ثلاثة مواضع مقيسة (`arPlural`) — ورابعٌ في SQL يعني انحرافاً. فالرسالةُ
  --    تخلو من المعدود، والثواني المتبقّية في `DETAIL` تصوغها الواجهة.
  -- 🔴 v15.44 (أمرُ ناصر) — الساعةُ تبدأ من **تأكيد التاجر**؛ وإن لم يؤكّد
  --    فتحةٌ احتياطيّة في آخر المهلة كي لا تبقى المشترية بلا مخرج (١٤٪ من
  --    الطلبات المكتملة لم تُؤكَّد قطّ — قِيس). والرمزُ يفرّق **سببَ** الانتظار
  --    فتقول الشاشةُ الصدق: أتنتظرُ شخصاً أم وقتاً.
  v_anchor := public.taki_self_close_opens_at(v_b);
  v_left := ceil((v_anchor - (EXTRACT(EPOCH FROM NOW())*1000)::bigint) / 1000.0);
  IF v_left > 0 AND v_b.acknowledged_at IS NULL AND v_b.status <> 'acknowledged' THEN
    RAISE EXCEPTION 'لم يؤكّد التاجر استلام طلبك بعد'
      USING ERRCODE = 'P0029', DETAIL = v_left::text;
  END IF;
  IF v_left > 0 THEN
    RAISE EXCEPTION 'لم تمضِ المهلة بعد استلام المتجر للطلب'
      USING ERRCODE = 'P0028', DETAIL = v_left::text;
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
$function$;

-- ── ٥) القارئُ الثاني: زرُّ المشتري في البوتين ──────────────────────────────
CREATE OR REPLACE FUNCTION public.bot_buyer_confirm_receipt(p_telegram_id bigint, p_barcode text, p_whatsapp_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid text; v_b public.bookings%ROWTYPE; v_left integer; v_anchor bigint;
BEGIN
  IF NOT public._bot_gate_ok() THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT id INTO v_uid FROM public.users
   WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id) AND deleted_at IS NULL LIMIT 1;
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_linked'); END IF;

  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode)) AND user_id = v_uid;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  -- v15.41 — الزرُّ لكلّ طلبٍ حيّ، والتوصيلُ وحده يشترط انطلاقَ المندوب.
  IF v_b.status NOT IN ('pending','acknowledged') THEN
    RETURN jsonb_build_object('success',false,'error','closed'); END IF;

  -- 🔴 v15.49 — نفسُ حقيقة الانطلاق التي يقرؤها الموقع، لا نسخةٌ ثانية.
  IF COALESCE(v_b.fulfillment,'pickup') = 'delivery'
     AND NOT public.taki_delivery_dispatched(v_b.barcode) THEN
    RETURN jsonb_build_object('success',false,'error','not_dispatched'); END IF;

  -- 🔴 v15.42 — نفسُ المهلة، ونفسُ الساعة. والثواني تعود للبوت فيصوغها بـ
  -- `shared/arPlural.js` — فلا رقمَ مكتوبٌ نصّاً في سلسلةٍ ولا في SQL.
  -- 🔴 v15.44 (أمرُ ناصر) — الساعةُ تبدأ من **تأكيد التاجر**؛ وإن لم يؤكّد
  --    فتحةٌ احتياطيّة في آخر المهلة كي لا تبقى المشترية بلا مخرج.
  v_anchor := public.taki_self_close_opens_at(v_b);
  v_left := ceil((v_anchor - (EXTRACT(EPOCH FROM NOW())*1000)::bigint) / 1000.0);
  IF v_left > 0 AND v_b.acknowledged_at IS NULL AND v_b.status <> 'acknowledged' THEN
    RETURN jsonb_build_object('success',false,'error','not_acknowledged','wait_seconds',v_left); END IF;
  IF v_left > 0 THEN
    RETURN jsonb_build_object('success',false,'error','too_soon','wait_seconds',v_left); END IF;

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
$function$;

-- ── ٦) القارئُ الثالث: الإلغاءُ التلقائي ───────────────────────────────────
-- 🪤 والشرطُ يخرج إلى دالّةٍ بوسائطَ صريحة لسببٍ واحد: شرطٌ داخل `UPDATE`
--    جامعٍ **لا يمكن إثباته** إلا بإلغاء طلبٍ حقيقيّ. وبهذه الصيغة يُنادى
--    بأرقامٍ مُفترضة فيُقاس قرارُه هو لا نسخةٌ منه.
CREATE OR REPLACE FUNCTION public.taki_autocancel_blocked(
  p_barcode text, p_booked_at bigint, p_expiry_time bigint, p_paid boolean)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- (أ) طلبٌ دفع صاحبه بالبطاقة لا يُلغى تلقائياً أبداً. إلغاؤه يخلق مطالبة
  --     استرداد كاذبة، ولا أحد يراجعها.
  SELECT COALESCE(p_paid, false)
      -- (ب) وطلبُ توصيلٍ توقّف عدّاده: محميٌّ حتى تنتهي شبكةُ الأمان.
      -- 🔴 v15.49 — تُقرأ حقيقةُ الانطلاق لا `status`: كان المنظّفُ يكتب
      --    `cancelled` بعد ساعةٍ من صمت الهاتف فتسقط الحمايةُ ويُلغى طلبٌ
      --    وصل صاحبَه فعلاً وتعود بضاعتُه للبيع.
      -- 🔴 وشبكةُ الأمان كانت تساوي صفراً عند الحدّ (مهلةٌ ٧٢ وشبكةٌ ٧٢):
      --    فكلُّ طلبٍ يُحمى حتى **ساعةٍ بعد انتهاء مهلته هو** على الأقلّ،
      --    فلا تُنقص مهلةُ تاجرٍ ولا تبقى الحمايةُ معدومةً عند أيّ ضبط.
      OR ( public.taki_delivery_hold_stopped(p_barcode)
           AND GREATEST(
                 COALESCE(p_booked_at, 0) + (public.taki_booking_grace_hours() * 3600000)::bigint,
                 COALESCE(p_expiry_time, 0) + 3600000)
               > (EXTRACT(EPOCH FROM NOW())*1000)::bigint );
$function$;
REVOKE ALL ON FUNCTION public.taki_autocancel_blocked(text,bigint,bigint,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.taki_autocancel_blocked(text,bigint,bigint,boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.expire_due_bookings()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now     bigint  := (EXTRACT(EPOCH FROM NOW())*1000)::bigint;
  v_count   int;
BEGIN
  WITH upd AS (
    UPDATE public.bookings b
       SET status = 'cancelled', cancelled_by = 'system'
     WHERE b.status IN ('pending','acknowledged')
       AND b.expiry_time IS NOT NULL
       AND b.expiry_time < v_now
       -- حقيقةٌ واحدة: الدفعُ بالبطاقة وشبكةُ أمان المنطلق كلاهما داخلها.
       AND NOT public.taki_autocancel_blocked(b.barcode, b.booked_at, b.expiry_time, b.paid_at IS NOT NULL)
    RETURNING 1
  ) SELECT count(*) INTO v_count FROM upd;
  RETURN COALESCE(v_count,0);
END;
$function$;

-- ── ٧) القارئُ الرابع: بطاقاتُ البوتين ─────────────────────────────────────
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
      -- v15.44 — مرساةُ «الختم بلا كود» بالمللي (كـ`expiry_time`/`sort_at`).
      -- 🪤 ولا تُقرأ `booked_at` أعلاه لذلك: هي **نصُّ وقتٍ** لا رقم، و`Number()`
      --    عليها تُنتج NaN بصمت — وهو ما جعل بوّابةَ v15.42 ميّتةً في البوتين.
      'ack_at_ms', CASE WHEN b.acknowledged_at IS NULL THEN NULL
                        ELSE (EXTRACT(EPOCH FROM b.acknowledged_at)*1000)::bigint END,
      'booked_at_ms', b.booked_at,
      'fulfillment', coalesce(b.fulfillment, 'pickup'),
      'delivery_fee', b.delivery_fee,
      'delivery_label', b.delivery_address->>'label',
      'delivery_details', b.delivery_address->>'details',
      'delivery_lat', b.delivery_address->>'lat',
      'delivery_lng', b.delivery_address->>'lng',
      -- v14.10 — البوتان يحتاجانهما ليخفيا عدّاداً كاذباً ويُظهرا زرّ التأكيد
      'paid', b.paid_at IS NOT NULL,
      'dlv_status', (SELECT t.status FROM delivery_tracks t WHERE t.barcode = b.barcode),
      -- 🔴 v15.49 — وحقيقةُ الانطلاق صريحةً: `dlv_status` حالةٌ لحظيّة يكتبها
      --    المنظّفُ `cancelled` بعد ساعةٍ من صمت الهاتف، فمطابقتُها بقائمةٍ
      --    كانت تُخفي زرَّ التأكيد عن مشترٍ استلم بضاعته.
      'dlv_dispatched', public.taki_delivery_dispatched(b.barcode),
      -- v14.21 — حالة الاسترداد على بطاقة الطلب في البوتين، فلا ينتظر المشتري
      -- جواباً لا يراه. (كان السطر مكتوباً في البوت بلا حقلٍ يغذّيه.)
      'refund_status', (SELECT r.status FROM booking_refunds r WHERE r.barcode = b.barcode),
      'credit_note_no', (SELECT r.credit_note_no FROM booking_refunds r WHERE r.barcode = b.barcode),
      'hold_running', (
        b.status IN ('pending','acknowledged')
        AND b.paid_at IS NULL
        AND NOT public.taki_delivery_hold_stopped(b.barcode)
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

-- ── ٨) وشاشةُ التتبّع تُعلن الحقيقة بدل أن يستنبطها كلُّ عميلٍ من قائمة ─────
-- أربعُ قوائمٍ كانت تُنسخ في الموقع والبوتين (`DELIVERY_STARTED` ·
-- `HOLD_STOPPED_STAGES` · `DLV_DISPATCHED` · `WA_DLV_DISPATCHED`)، وكلُّها
-- تنحرف عن القاعدة بمجرّد إضافة حالةٍ واحدة. فالقاعدةُ تقولها الآن حقلاً.
CREATE OR REPLACE FUNCTION public.delivery_track_get(p_barcode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid  text := auth.uid()::text;
  v_b    public.bookings%ROWTYPE;
  v_t    public.delivery_tracks%ROWTYPE;
  v_is_seller boolean;
  v_is_buyer  boolean;
  v_fresh boolean;
  v_store_lat double precision;
  v_store_lng double precision;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'auth'); END IF;
  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  v_is_seller := v_b.store_id IS NOT DISTINCT FROM v_uid;
  v_is_buyer  := v_b.user_id  IS NOT DISTINCT FROM v_uid;
  IF NOT (v_is_seller OR v_is_buyer OR public.is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF coalesce(v_b.fulfillment,'pickup') <> 'delivery' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_delivery');
  END IF;

  SELECT * INTO v_t FROM public.delivery_tracks WHERE barcode = v_b.barcode;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'status', 'preparing', 'live', false,
      'dispatched', false, 'hold_stopped', false,
      'destination', jsonb_build_object('lat', nullif(v_b.delivery_address->>'lat','')::double precision,
                                        'lng', nullif(v_b.delivery_address->>'lng','')::double precision));
  END IF;

  -- «حيّ» = نبضة خلال دقيقتين. أقدم من ذلك يُعرَض كآخر موقع معروف بوقته، ولا
  -- يُقدَّم كأنه الآن — إشارة متجمّدة تُعرض كحيّة تُفقد الثقة بالميزة كلها.
  v_fresh := v_t.lat IS NOT NULL AND v_t.updated_at > now() - interval '2 minutes'
             AND v_t.status IN ('on_the_way','arrived');

  SELECT u.lat, u.lng INTO v_store_lat, v_store_lng FROM public.users u WHERE u.id = v_b.store_id;

  RETURN jsonb_build_object(
    'ok', true,
    'role', CASE WHEN v_is_seller THEN 'seller' ELSE 'buyer' END,
    'status', v_t.status,
    'live', v_fresh,
    -- 🔴 v15.49 — حقيقتان صريحتان: «غادرت البضاعة» و«توقّف العدّاد». و`status`
    --    يبقى للعرض وحده — المنظّفُ يكتبه `cancelled` فلا يُستدلّ منه.
    'dispatched', (v_t.dispatched_at IS NOT NULL OR v_t.started_at IS NOT NULL
                   OR v_t.status IN ('on_the_way','arrived','delivered')),
    'hold_stopped', (v_t.dispatched_at IS NOT NULL OR v_t.started_at IS NOT NULL
                   OR v_t.status IN ('preparing','on_the_way','arrived','delivered')),
    'dispatched_at', v_t.dispatched_at,
    -- الإحداثيات لا تخرج إلا وهي حيّة وأثناء التوصيل: صفٌّ منتهٍ لا موقع فيه أصلاً.
    'lat', CASE WHEN v_fresh THEN v_t.lat ELSE NULL END,
    'lng', CASE WHEN v_fresh THEN v_t.lng ELSE NULL END,
    'heading', CASE WHEN v_fresh THEN v_t.heading ELSE NULL END,
    'accuracy_m', CASE WHEN v_fresh THEN v_t.accuracy_m ELSE NULL END,
    'remaining_km', CASE WHEN v_fresh THEN v_t.remaining_km ELSE NULL END,
    'eta_min', CASE WHEN v_fresh THEN v_t.eta_min ELSE NULL END,
    'updated_at', v_t.updated_at,
    'started_at', v_t.started_at,
    'ended_at', v_t.ended_at,
    'age_sec', GREATEST(0, EXTRACT(EPOCH FROM (now() - v_t.updated_at)))::int,
    'destination', jsonb_build_object(
        'lat', nullif(v_b.delivery_address->>'lat','')::double precision,
        'lng', nullif(v_b.delivery_address->>'lng','')::double precision,
        'label', v_b.delivery_address->>'label',
        -- تفاصيل العنوان للتاجر (هو من يصل)، والمشتري يعرف عنوانه أصلاً.
        'details', CASE WHEN v_is_seller THEN v_b.delivery_address->>'details' ELSE NULL END,
        'phone',   CASE WHEN v_is_seller THEN v_b.delivery_address->>'phone'   ELSE NULL END),
    'store', jsonb_build_object('lat', v_store_lat, 'lng', v_store_lng,
                                'name', (SELECT coalesce(nullif(u.shop,''), u.name) FROM public.users u WHERE u.id = v_b.store_id)),
    'booking_status', v_b.status
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.bot_delivery_track_get(p_telegram_id bigint, p_whatsapp_id text, p_barcode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid text; v_b public.bookings%ROWTYPE; v_t public.delivery_tracks%ROWTYPE; v_fresh boolean; v_seller boolean;
BEGIN
  IF NOT public._bot_gate_ok() THEN RAISE EXCEPTION 'GATE'; END IF;
  v_uid := public._bot_uid(p_telegram_id, p_whatsapp_id);
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_linked'); END IF;

  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  v_seller := v_b.store_id IS NOT DISTINCT FROM v_uid;
  IF NOT (v_seller OR v_b.user_id IS NOT DISTINCT FROM v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF coalesce(v_b.fulfillment,'pickup') <> 'delivery' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_delivery');
  END IF;

  SELECT * INTO v_t FROM public.delivery_tracks WHERE barcode = v_b.barcode;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'status', 'preparing', 'live', false,
    'dispatched', false, 'role', CASE WHEN v_seller THEN 'seller' ELSE 'buyer' END); END IF;

  v_fresh := v_t.lat IS NOT NULL AND v_t.updated_at > now() - interval '2 minutes'
             AND v_t.status IN ('on_the_way','arrived');
  RETURN jsonb_build_object(
    'ok', true,
    'role', CASE WHEN v_seller THEN 'seller' ELSE 'buyer' END,
    'status', v_t.status,
    'live', v_fresh,
    -- 🔴 v15.49 — نفسُ الحقيقة التي يقرؤها الموقع.
    'dispatched', (v_t.dispatched_at IS NOT NULL OR v_t.started_at IS NOT NULL
                   OR v_t.status IN ('on_the_way','arrived','delivered')),
    'remaining_km', CASE WHEN v_fresh THEN v_t.remaining_km ELSE NULL END,
    'eta_min', CASE WHEN v_fresh THEN v_t.eta_min ELSE NULL END,
    'age_sec', GREATEST(0, EXTRACT(EPOCH FROM (now() - v_t.updated_at)))::int,
    'lat', CASE WHEN v_fresh THEN v_t.lat ELSE NULL END,
    'lng', CASE WHEN v_fresh THEN v_t.lng ELSE NULL END,
    'label', v_b.delivery_address->>'label');
END
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- تحقّقٌ سلوكيّ — يُشغَّل فعلاً على القاعدة ثمّ يُلفظ بالاستثناء فلا يبقى صفّ
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 ولا يُدرَج حجزٌ أبداً: `taki_invoice_seq` لا يرجع بالإرجاع، فإدراجُ
--    اختبارٍ يثقب تسلسلَ الفواتير الضريبيّ ثقباً دائماً. فيُستعار باركودُ
--    حجزٍ قائم (المفتاحُ الأجنبيّ يفرض ذلك) ويُحذف صفُّ المسار بالإرجاع.
-- 🪤 وتُستعمل 'arrived' لا 'on_the_way': مشغّلُ `tr_delivery_started_notify`
--    يُشعر المشتري عند 'on_the_way' وحدها — والاختبارُ لا يُزعج أحداً.
--    وهي **الحالةُ الأسوأ** أصلاً: `started_at` يبقى فارغاً عندها.
DO $behave$
DECLARE
  v_bc text; v_sid text; v_usr text;
  v_now bigint := (EXTRACT(EPOCH FROM NOW())*1000)::bigint;
  v_stamp timestamptz; v_keep timestamptz;
BEGIN
  BEGIN
    SELECT b.barcode, b.store_id, b.user_id INTO v_bc, v_sid, v_usr
      FROM public.bookings b
     WHERE NOT EXISTS (SELECT 1 FROM public.delivery_tracks t WHERE t.barcode = b.barcode)
     ORDER BY b.booked_at DESC LIMIT 1;
    IF v_bc IS NULL THEN
      RAISE EXCEPTION '❌ لا حجزَ صالحٌ للاختبار — التحقّقُ لم يُجرَ (وهذا فشل)';
    END IF;

    -- (٠) قبل أيّ صفّ: لا انطلاق ولا توقّف.
    IF public.taki_delivery_dispatched(v_bc) OR public.taki_delivery_hold_stopped(v_bc) THEN
      RAISE EXCEPTION '❌ طلبٌ بلا مسارٍ يُقرأ منطلقاً';
    END IF;
    IF public.taki_autocancel_blocked(v_bc, v_now - 7200000, v_now - 3600000, false) THEN
      RAISE EXCEPTION '❌ طلبٌ منتهٍ بلا توصيلٍ يُقرأ محميّاً من الإلغاء';
    END IF;

    -- (١) «وصل المندوب» مباشرةً — بلا 'on_the_way' فـ`started_at` فارغ.
    INSERT INTO public.delivery_tracks (barcode, store_id, user_id, status)
    VALUES (v_bc, v_sid, v_usr, 'arrived');
    SELECT dispatched_at, started_at INTO v_stamp, v_keep
      FROM public.delivery_tracks WHERE barcode = v_bc;
    IF v_stamp IS NULL THEN
      RAISE EXCEPTION '❌ dispatched_at لم يُطبع عند «وصل»';
    END IF;
    IF v_keep IS NOT NULL THEN
      RAISE EXCEPTION '❌ افتراضُ الاختبار خاطئ: started_at مطبوعٌ عند «وصل» فالحالةُ الأسوأ لم تُختبر';
    END IF;

    -- (٢) صمتُ ساعةٍ ⇒ المنظّفُ يكتب 'cancelled' — وهو موضعُ العيب بعينه.
    UPDATE public.delivery_tracks SET updated_at = now() - interval '3 hours' WHERE barcode = v_bc;
    PERFORM public.taki_expire_delivery_tracks();
    IF (SELECT status FROM public.delivery_tracks WHERE barcode = v_bc) IS DISTINCT FROM 'cancelled' THEN
      RAISE EXCEPTION '❌ المنظّفُ لم يُلغِ المسار — الاختبارُ لم يبلغ موضعَ العيب';
    END IF;

    -- (٣) ومع ذلك: الانطلاقُ محفوظ، والعدّادُ متوقّف، والطلبُ محميّ.
    IF NOT public.taki_delivery_dispatched(v_bc) THEN
      RAISE EXCEPTION '❌ نُسي الانطلاقُ بعد إلغاء المسار — العيبُ قائم';
    END IF;
    IF NOT public.taki_delivery_hold_stopped(v_bc) THEN
      RAISE EXCEPTION '❌ عادَ عدّادُ الإلغاء يمشي على طلبٍ منطلق';
    END IF;
    IF NOT public.taki_autocancel_blocked(v_bc, v_now - 7200000, v_now - 3600000, false) THEN
      RAISE EXCEPTION '❌ فقد الطلبُ المنطلقُ حمايتَه من الإلغاء التلقائي';
    END IF;

    -- (٤) ولا يملك أحدٌ محوَ المرساة — ولو كتبها NULL صراحةً.
    UPDATE public.delivery_tracks SET dispatched_at = NULL WHERE barcode = v_bc;
    IF (SELECT dispatched_at FROM public.delivery_tracks WHERE barcode = v_bc) IS DISTINCT FROM v_stamp THEN
      RAISE EXCEPTION '❌ أمكن محوُ مرساةِ الانطلاق — فالعيبُ سيعود بأيّ كاتبٍ جديد';
    END IF;

    -- (٥) والنقيض: مسارُ تجهيزٍ لم ينطلق لا يُقرأ منطلقاً أبداً.
    DELETE FROM public.delivery_tracks WHERE barcode = v_bc;
    INSERT INTO public.delivery_tracks (barcode, store_id, user_id, status)
    VALUES (v_bc, v_sid, v_usr, 'preparing');
    IF public.taki_delivery_dispatched(v_bc) THEN
      RAISE EXCEPTION '❌ «قيد التجهيز» يُقرأ انطلاقاً — فالزرُّ يُعطى قبل أن تغادر البضاعة';
    END IF;
    IF NOT public.taki_delivery_hold_stopped(v_bc) THEN
      RAISE EXCEPTION '❌ «قيد التجهيز» لم يوقف العدّاد (قاعدةُ v14.10)';
    END IF;

    -- (٦) وشبكةُ الأمان لا تساوي صفراً عند الحدّ: مهلةٌ ٧٢ وشبكةٌ ٧٢.
    -- طلبٌ حُجز قبل ٧٢ ساعةٍ ودقيقة، ومهلتُه انتهت قبل دقيقة ⇒ لا بدّ أن يبقى محميّاً.
    IF NOT public.taki_autocancel_blocked(
         v_bc, v_now - (72*3600000 + 60000), v_now - 60000, false) THEN
      RAISE EXCEPTION '❌ شبكةُ الأمان معدومةٌ عند الحدّ — طلبٌ منطلقٌ يُلغى ومندوبه في الطريق';
    END IF;

    RAISE EXCEPTION 'TAKI_V1549_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'TAKI_V1549_ROLLBACK' THEN RAISE; END IF;
  END;
END
$behave$;

-- ── جدولُ القراءة (لا يُفشل شيئاً — الإفشالُ أعلاه) ────────────────────────
SELECT 'الخادم' AS "البند", COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'جدة — الإنتاج') AS "القيمة"
UNION ALL SELECT 'عمودُ الانطلاق',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='public' AND table_name='delivery_tracks' AND column_name='dispatched_at')
       THEN '✅' ELSE '❌' END
UNION ALL SELECT 'مشغّلُ الطبع',
  CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.delivery_tracks'::regclass
                      AND tgname='tr_bu_stamp_dispatch' AND NOT tgisinternal AND tgenabled <> 'D')
       THEN '✅' ELSE '❌' END
UNION ALL SELECT 'القرّاءُ الستّة',
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public'
                AND p.proname IN ('buyer_confirm_receipt','bot_buyer_confirm_receipt',
                                  'taki_autocancel_blocked','bot_get_my_bookings',
                                  'delivery_track_get','bot_delivery_track_get')
                AND (pg_get_functiondef(p.oid) LIKE '%taki_delivery_dispatched%'
                  OR pg_get_functiondef(p.oid) LIKE '%taki_delivery_hold_stopped%'
                  OR pg_get_functiondef(p.oid) LIKE '%dispatched_at%')) = 6
       THEN '✅' ELSE '❌' END
UNION ALL SELECT 'لا منحَ للزائر',
  CASE WHEN NOT has_function_privilege('anon','public.taki_delivery_dispatched(text)','EXECUTE')
        AND NOT has_function_privilege('anon','public.taki_delivery_hold_stopped(text)','EXECUTE')
        AND NOT has_function_privilege('anon','public.taki_autocancel_blocked(text,bigint,bigint,boolean)','EXECUTE')
       THEN '✅' ELSE '❌' END
UNION ALL SELECT 'ومنحٌ للموثَّق',
  CASE WHEN has_function_privilege('authenticated','public.taki_delivery_dispatched(text)','EXECUTE')
       THEN '✅' ELSE '❌' END;
