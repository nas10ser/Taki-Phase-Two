-- ═══════════════════════════════════════════════════════════════════════════
-- v14.93 — المحادثة لم تعد ثلاث رسائل: الحدّ صار إعداداً، وافتراضُه «بلا حدّ»
-- ═══════════════════════════════════════════════════════════════════════════
-- طلبُ ناصر: «أزل القيود من عدد الرسائل — ٣ لا تكفي مع التوصيل».
--
-- 🔴 والعيبُ الأعمق أن الرقم ٣ كان **مثبَّتاً نصّاً في تسعة مواضع**: دالتين
--    في القاعدة، ومكوّن المحادثة في الموقع، وبوت تيليجرام، وتدفّق واتساب،
--    وخمس سلاسل ترجمة تحمل «/3» داخلها. أي أن تغييره كان يعني نشراً كاملاً
--    وتعديلَ البوتين — وهذا بالضبط ما تمنعه قاعدة المشروع: **لا يُكتب رقمٌ
--    نصّاً في أي مكان، أوّلُ ضبطٍ يجعله كذباً.**
--
-- ما تبنيه هذه الهجرة:
--   ١. مفتاح `chat_limits` = { per_booking, per_hour }. و`per_booking = 0`
--      تعني **بلا حدّ** — وهو الافتراضُ الجديد.
--   ٢. `taki_chat_limits()` مصدرٌ واحد تقرؤه كل الطبقات.
--   ٣. الدوال الثلاث تقرأ منه بدل الرقم المثبَّت.
--   ٤. 🪤 **الجدار الخفيّ**: حارس الإغراق `tr_rate_limit_message` كان ٣٠ رسالة
--      في الساعة **لكل شخصٍ عبر كل حجوزاته** — لا لكل حجز. برفع حدّ الثلاث
--      يصير هو القيدَ الفعليّ: تاجرٌ يدير ١٥ طلب توصيل برسالتين لكلٍّ يصطدم به
--      ويرى «رسائل كثيرة» بلا سبب مفهوم. فصار هو أيضاً إعداداً، افتراضُه ١٢٠.
--   ٥. صياغةُ العدد بالعربية صحيحة (`رسالة/رسالتان/رسائل`) — فـ«٣ رسالة» خطأ،
--      وهو نفس العيب الذي كلّفنا إصلاحاً في v14.92.
--
-- 🪤 ولا تُسقَط أيٌّ من دوال `bot_*` ثم تُنشأ: الإسقاط يُضيّع منحَ `anon`
--    وحارسُها هو السرّ لا الدور (قاعدة مشروع). `CREATE OR REPLACE` تُبقي المنح،
--    وأنواعُ الإرجاع هنا لم تتغيّر فهي المسار الصحيح.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── حارس: هذه هجرة إنتاج (جدّة) ────────────────────────────────────────────
DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) الإعداد + مصدرُه الواحد
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.platform_settings (key, value, description, updated_at)
VALUES ('chat_limits',
        '{"per_booking": 0, "per_hour": 120}'::jsonb,
        'حدود محادثة الحجز: per_booking لكل طرف في الطلب (0 = بلا حدّ) · per_hour حارس إغراق لكل مرسِل',
        now())
ON CONFLICT (key) DO NOTHING;   -- لا تدهس ضبطاً اختاره ناصر لاحقاً

/**
 * حدود المحادثة من مصدرها الوحيد.
 * 🪤 SECURITY DEFINER لأن `platform_settings` محميّ بسياسةٍ ذات قائمة سماح،
 *    والدوال المنادية تعمل بدور المستخدم. والقيم تُنقّى هنا مرّةً واحدة فلا
 *    يُكرَّر التحقّق في ثلاث دوال (ولا ينحرف بينها).
 */
CREATE OR REPLACE FUNCTION public.taki_chat_limits()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'per_booking', GREATEST(0, LEAST(1000, COALESCE((
        SELECT floor((value->>'per_booking')::numeric)::int
        FROM public.platform_settings WHERE key = 'chat_limits'
          AND jsonb_typeof(value->'per_booking') = 'number'), 0))),
    'per_hour',    GREATEST(1, LEAST(10000, COALESCE((
        SELECT floor((value->>'per_hour')::numeric)::int
        FROM public.platform_settings WHERE key = 'chat_limits'
          AND jsonb_typeof(value->'per_hour') = 'number'), 120)))
  );
$fn$;

REVOKE ALL ON FUNCTION public.taki_chat_limits() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_chat_limits() FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_chat_limits() TO authenticated, service_role;

/**
 * صياغةُ عدد الرسائل بالعربية. «٣ رسالة» خطأٌ نحويّ يراه المستخدم.
 * ١ ⇒ رسالة واحدة · ٢ ⇒ رسالتان · ٣‑١٠ ⇒ N رسائل · ما فوق ⇒ N رسالة.
 */
CREATE OR REPLACE FUNCTION public.taki_ar_messages(p_n int)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN p_n = 1 THEN 'رسالة واحدة'
    WHEN p_n = 2 THEN 'رسالتان'
    WHEN p_n BETWEEN 3 AND 10 THEN p_n::text || ' رسائل'
    ELSE p_n::text || ' رسالة'
  END;
$fn$;

REVOKE ALL ON FUNCTION public.taki_ar_messages(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_ar_messages(int) FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_ar_messages(int) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) حارس الإغراق يقرأ الإعداد (كان ٣٠ مثبَّتة)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.tr_rate_limit_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_per_hour int;
BEGIN
  IF public._taki_user_is_admin(NEW.sender_id) THEN RETURN NEW; END IF;
  v_per_hour := (public.taki_chat_limits()->>'per_hour')::int;
  PERFORM public.taki_rate_check(
    'ms1h:' || NEW.sender_id, v_per_hour, 3600,
    '⏳ رسائل كثيرة خلال وقت قصير — انتظر قليلاً ثم أعد المحاولة.');
  RETURN NEW;
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) الموقع: send_booking_message
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.send_booking_message(p_barcode text, p_body text, p_attachment_path text DEFAULT NULL::text)
RETURNS booking_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  caller      text := auth.uid()::text;
  booking_row public.bookings;
  v_role      text;
  sent_count  int;
  v_cap       int;
  inserted    public.booking_messages;
  clean_body  text;
  v_att       text := NULLIF(btrim(COALESCE(p_attachment_path, '')), '');
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لإرسال الرسالة' USING ERRCODE = '28000';
  END IF;

  clean_body := btrim(p_body);
  -- رسالةٌ بمرفقٍ بلا نصّ مشروعة (صورة تكفي)، لكن الجدول يمنع النصّ الفارغ.
  IF clean_body = '' AND v_att IS NOT NULL THEN clean_body := '📎'; END IF;
  IF clean_body = '' OR length(clean_body) > 500 THEN
    RAISE EXCEPTION 'الرسالة يجب أن تكون بين ١ و ٥٠٠ حرف' USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO booking_row FROM public.bookings WHERE barcode = p_barcode;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'لم يتم العثور على الحجز' USING ERRCODE = 'P0002';
  END IF;

  IF caller = booking_row.user_id THEN v_role := 'buyer';
  ELSIF caller = booking_row.store_id THEN v_role := 'seller';
  ELSE RAISE EXCEPTION 'ليست لديك صلاحية للكتابة على هذا الحجز' USING ERRCODE = '42501';
  END IF;

  IF booking_row.status IN ('cancelled') THEN
    RAISE EXCEPTION 'الحجز ملغى — لا يمكن إرسال رسائل' USING ERRCODE = 'P0001';
  END IF;

  -- المرفق يُصدَّق على ثلاثة: أنه رُفع فعلاً، وأنه تحت هذا الباركود، وأن
  -- المرسِل هو من رفعه. بلا ذلك يستطيع طرفٌ أن يُشير إلى مرفق محادثةٍ أخرى.
  IF v_att IS NOT NULL THEN
    IF split_part(v_att, '/', 1) <> p_barcode THEN
      RAISE EXCEPTION 'المرفق لا يخصّ هذا الطلب' USING ERRCODE = 'P0017';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM storage.objects o
      WHERE o.bucket_id = 'chat' AND o.name = v_att AND o.owner = auth.uid()
    ) THEN
      RAISE EXCEPTION 'المرفق غير موجود أو ليس لك' USING ERRCODE = 'P0017';
    END IF;
  END IF;

  -- v14.93 — الحدّ من الإعداد، و0 تعني بلا حدّ. (كان ٣ مثبَّتة، ومع التوصيل
  -- كانت المحادثة تُقفل قبل أن يتّفق الطرفان على العنوان أصلاً.)
  v_cap := (public.taki_chat_limits()->>'per_booking')::int;
  IF v_cap > 0 THEN
    SELECT COUNT(*) INTO sent_count
    FROM public.booking_messages
    WHERE barcode = p_barcode AND sender_role = v_role;

    IF sent_count >= v_cap THEN
      RAISE EXCEPTION 'وصلت الحد الأقصى (%). اتصل بالطرف الآخر مباشرة.',
        public.taki_ar_messages(v_cap) USING ERRCODE = 'P0004';
    END IF;
  END IF;

  INSERT INTO public.booking_messages (barcode, sender_id, sender_role, body, attachment_path)
  VALUES (p_barcode, caller, v_role, clean_body, v_att)
  RETURNING * INTO inserted;

  RETURN inserted;
END $function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) البوتان: bot_send_booking_message + bot_booking_chat
--    (تُستبدلان بلا إسقاط — الإسقاط يُضيّع منح anon وحارسُها السرّ)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.bot_send_booking_message(p_telegram_id bigint, p_barcode text, p_body text, p_whatsapp_id text DEFAULT NULL::text, p_attachment_path text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid text; v_b bookings%ROWTYPE; v_role text; v_cnt int; v_cap int;
  v_body text := btrim(COALESCE(p_body, ''));
  v_att  text := NULLIF(btrim(COALESCE(p_attachment_path, '')), '');
BEGIN
  IF NOT public._bot_gate_ok() THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authorized');
  END IF;

  SELECT id INTO v_uid FROM users WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id) AND deleted_at IS NULL LIMIT 1;
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_linked'); END IF;

  -- صورةٌ بلا نصّ رسالةٌ كاملة، لكن الجدول يمنع النصّ الفارغ.
  IF v_body = '' AND v_att IS NOT NULL THEN v_body := '📎'; END IF;
  IF v_body = '' OR length(v_body) > 500 THEN
    RETURN jsonb_build_object('success', false, 'error', 'bad_body');
  END IF;

  SELECT * INTO v_b FROM bookings WHERE barcode = UPPER(p_barcode) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_uid = v_b.user_id THEN v_role := 'buyer';
  ELSIF v_uid = v_b.store_id THEN v_role := 'seller';
  ELSE RETURN jsonb_build_object('success', false, 'error', 'not_authorized'); END IF;

  IF v_b.status IN ('cancelled','completed','expired') THEN
    RETURN jsonb_build_object('success', false, 'error', 'chat_closed');
  END IF;

  -- المرفق تحت مجلّد هذا الحجز، وموجودٌ فعلاً. (المِلكية تحقّقت منها الدالة
  -- الطرفية قبل الرفع — البوت لا يحمل هوية قاعدة بيانات ليُقارَن بها.)
  IF v_att IS NOT NULL THEN
    IF split_part(v_att, '/', 1) <> v_b.barcode THEN
      RETURN jsonb_build_object('success', false, 'error', 'attachment_outside_booking');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'chat' AND o.name = v_att) THEN
      RETURN jsonb_build_object('success', false, 'error', 'attachment_missing');
    END IF;
  END IF;

  SELECT count(*) INTO v_cnt FROM booking_messages WHERE barcode = v_b.barcode AND sender_role = v_role;
  -- v14.93 — الحدّ من الإعداد، و0 = بلا حدّ.
  v_cap := (public.taki_chat_limits()->>'per_booking')::int;
  IF v_cap > 0 AND v_cnt >= v_cap THEN
    RETURN jsonb_build_object('success', false, 'error', 'limit_reached', 'cap', v_cap);
  END IF;

  INSERT INTO booking_messages (barcode, sender_id, sender_role, body, attachment_path)
  VALUES (v_b.barcode, v_uid, v_role, v_body, v_att);

  RETURN jsonb_build_object('success', true, 'my_count', v_cnt + 1, 'cap', v_cap);
END $function$;

CREATE OR REPLACE FUNCTION public.bot_booking_chat(p_telegram_id bigint, p_barcode text, p_whatsapp_id text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid text; v_b bookings%ROWTYPE; v_role text; v_msgs jsonb; v_my int; v_other int;
        v_other_name text; v_deal_name text;
BEGIN
  SELECT id INTO v_uid FROM users WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id) AND deleted_at IS NULL LIMIT 1;
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_linked'); END IF;
  SELECT * INTO v_b FROM bookings WHERE barcode = UPPER(p_barcode) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_uid = v_b.user_id THEN v_role := 'buyer';
  ELSIF v_uid = v_b.store_id THEN v_role := 'seller';
  ELSE RETURN jsonb_build_object('success', false, 'error', 'not_authorized'); END IF;

  UPDATE booking_messages SET read_at = NOW()
    WHERE barcode = v_b.barcode AND sender_role <> v_role AND read_at IS NULL;

  -- `attachment` مسارٌ داخل مستودع خاصّ، لا عنوان يُفتح. البوت يبادله برابط
  -- موقّع قصير العمر عبر الدالة الطرفية، وهي تتحقّق من العضوية مرّة أخرى.
  SELECT jsonb_agg(jsonb_build_object('role', m.sender_role, 'body', m.body, 'at', m.created_at,
                                      'mine', (m.sender_role = v_role),
                                      'attachment', m.attachment_path) ORDER BY m.created_at)
    INTO v_msgs FROM booking_messages m WHERE m.barcode = v_b.barcode;
  SELECT count(*) FILTER (WHERE sender_role = v_role), count(*) FILTER (WHERE sender_role <> v_role)
    INTO v_my, v_other FROM booking_messages WHERE barcode = v_b.barcode;

  IF v_role = 'buyer' THEN SELECT COALESCE(NULLIF(shop,''), NULLIF(name,''), 'التاجر') INTO v_other_name FROM users WHERE id = v_b.store_id;
  ELSE v_other_name := COALESCE(NULLIF(v_b.user_name,''), 'المشتري'); END IF;
  SELECT item_name INTO v_deal_name FROM deals WHERE id = v_b.deal_id;

  -- v14.93 — `cap` يُعاد للبوتين كي لا يُثبِّتا الرقم نصّاً في واجهتهما. 0 = بلا حدّ.
  RETURN jsonb_build_object('success', true, 'role', v_role, 'status', v_b.status, 'barcode', v_b.barcode,
    'uid', v_uid,
    'deal_name', COALESCE(v_deal_name,'العرض'), 'other_name', v_other_name,
    'cap', (public.taki_chat_limits()->>'per_booking')::int,
    'my_count', COALESCE(v_my,0), 'other_count', COALESCE(v_other,0), 'messages', COALESCE(v_msgs,'[]'::jsonb));
END $function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) المفتاح يجب أن تراه سياسةُ القراءة — وإلا فهو إعدادٌ لا يعمل (درس v14.92)
-- ═══════════════════════════════════════════════════════════════════════════

DO $patch$
DECLARE v_qual text; v_roles text;
BEGIN
  SELECT pg_get_expr(p.polqual, p.polrelid),
         COALESCE((SELECT string_agg(quote_ident(r.rolname), ', ')
                     FROM pg_roles r WHERE r.oid = ANY(p.polroles)), 'public')
    INTO v_qual, v_roles
    FROM pg_policy p
   WHERE p.polrelid = 'public.platform_settings'::regclass
     AND p.polname  = 'platform_settings_select';

  IF v_qual IS NULL THEN
    RAISE EXCEPTION 'السياسة platform_settings_select غير موجودة — أوقِفت قبل أن أهدم شيئاً.';
  END IF;

  IF position('''chat_limits''' IN v_qual) > 0 THEN
    RAISE NOTICE 'ℹ️ chat_limits مُدرَجٌ أصلاً — لا تغيير.';
    RETURN;
  END IF;

  -- إضافةٌ جراحية على النصّ **الحيّ**: لا تُعاد كتابة القائمة من الذاكرة،
  -- فقد تكون على الخادم مفاتيحُ لا نعلم بها.
  v_qual := replace(v_qual, '''merchant_vat''::text',
                            '''merchant_vat''::text, ''chat_limits''::text');
  IF position('''chat_limits''' IN v_qual) = 0 THEN
    RAISE EXCEPTION 'تعذّر إدراج المفتاح: نصّ السياسة الحيّ لا يطابق المرساة. أوقِفت بلا تغيير.';
  END IF;

  EXECUTE format(
    'DROP POLICY IF EXISTS platform_settings_select ON public.platform_settings; '
    'CREATE POLICY platform_settings_select ON public.platform_settings '
    'FOR SELECT TO %s USING (%s);', v_roles, v_qual);
  RAISE NOTICE '✅ أُدرج chat_limits في سياسة القراءة (الأدوار: %)', v_roles;
END
$patch$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٦) تحقّقٌ يرفع استثناءً — الجدول الجميل لا يُفشل psql
-- ═══════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE v_lim jsonb; v_qual text; v_src text; n int;
BEGIN
  -- الإعداد يُقرأ ويُنقّى
  v_lim := public.taki_chat_limits();
  IF (v_lim->>'per_booking') IS NULL OR (v_lim->>'per_hour') IS NULL THEN
    RAISE EXCEPTION '❌ taki_chat_limits لا تُرجع المفتاحين.';
  END IF;
  IF (v_lim->>'per_booking')::int <> 0 THEN
    RAISE EXCEPTION '❌ الافتراض ليس «بلا حدّ» (per_booking=%).', v_lim->>'per_booking';
  END IF;
  IF (v_lim->>'per_hour')::int < 30 THEN
    RAISE EXCEPTION '❌ حارس الإغراق أضيق من السابق (%) — كان ٣٠.', v_lim->>'per_hour';
  END IF;

  -- صياغةُ العربية
  IF public.taki_ar_messages(1) <> 'رسالة واحدة'
     OR public.taki_ar_messages(2) <> 'رسالتان'
     OR public.taki_ar_messages(3) <> '3 رسائل'
     OR public.taki_ar_messages(11) <> '11 رسالة' THEN
    RAISE EXCEPTION '❌ صياغة عدد الرسائل غير صحيحة.';
  END IF;

  -- لا رقمَ ٣ مثبَّتاً باقياً في أيٍّ من الدوال الثلاث
  FOR v_src IN
    SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
    WHERE n2.nspname = 'public' AND p.prokind = 'f'
      AND p.proname IN ('send_booking_message','bot_send_booking_message')
  LOOP
    IF v_src ~ '(sent_count|v_cnt)\s*>=\s*3\M' THEN
      RAISE EXCEPTION '❌ ما زال الحدّ ٣ مثبَّتاً في إحدى الدوال.';
    END IF;
    IF position('taki_chat_limits' IN v_src) = 0 THEN
      RAISE EXCEPTION '❌ إحدى الدوال لا تقرأ الإعداد.';
    END IF;
  END LOOP;

  -- البوت يستلم `cap` كي لا يُثبِّت الرقم في واجهته
  SELECT pg_get_functiondef(p.oid) INTO v_src FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
   WHERE n2.nspname='public' AND p.prokind='f' AND p.proname='bot_booking_chat';
  IF position('''cap''' IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ bot_booking_chat لا تُعيد cap.';
  END IF;

  -- حارس الإغراق صار يقرأ الإعداد
  SELECT pg_get_functiondef(p.oid) INTO v_src FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
   WHERE n2.nspname='public' AND p.prokind='f' AND p.proname='tr_rate_limit_message';
  IF position('taki_chat_limits' IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ حارس الإغراق ما زال برقمٍ مثبَّت.';
  END IF;

  -- المفتاح مقروءٌ للمستخدم
  SELECT pg_get_expr(polqual, polrelid) INTO v_qual FROM pg_policy
   WHERE polrelid='public.platform_settings'::regclass AND polname='platform_settings_select';
  IF v_qual IS NULL OR position('''chat_limits''' IN v_qual) = 0 THEN
    RAISE EXCEPTION '❌ chat_limits محجوبٌ عن القراءة — الواجهة سترتدّ للافتراضي بصمت.';
  END IF;
  IF position('''merchant_vat''' IN v_qual) = 0 OR position('''booking_holds''' IN v_qual) = 0
     OR position('''complaints_sla_hours''' IN v_qual) = 0 THEN
    RAISE EXCEPTION '❌ فُقدت مفاتيح كانت مسموحة — تراجَعْ فوراً.';
  END IF;

  -- البوتان ما زالا موصولين (منحُ anon لم يضع بالاستبدال)
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace n2 ON n2.oid=p.pronamespace
   WHERE n2.nspname='public' AND p.proname IN ('bot_send_booking_message','bot_booking_chat')
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF n <> 2 THEN
    RAISE EXCEPTION '❌ دوال البوت فقدت منح anon (%/2) — البوتان سيصمتان.', n;
  END IF;

  RAISE NOTICE '✅ المحادثة بلا حدّ لكل طلب · حارس الإغراق % /ساعة · الرقم صار إعداداً في مكانٍ واحد.',
    v_lim->>'per_hour';
END
$verify$;
