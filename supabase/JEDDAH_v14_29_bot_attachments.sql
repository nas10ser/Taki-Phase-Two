-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.29 — مرفقات محادثة الطلب في البوتين
-- ════════════════════════════════════════════════════════════════════════════
-- الموقع صار يرفق الصور في محادثة الطلب (v14.27). والبوتان يفتحان **نفس**
-- المحادثة، فمرفقٌ يُرسَل من الموقع كان سيختفي عند من يقرأ من تيليجرام، ومشترٍ
-- يصوّر منتجه التالف في تيليجرام لا يجد أين يضعه. محادثةٌ واحدة بنصفين.
--
-- 🪤 لماذا دالّتان جديدتان ولا تكفي `send_booking_message`:
--   تلك تشترط `auth.uid()` وتتحقّق أن `storage.objects.owner = auth.uid()`.
--   والبوت خادمٌ موثوق لا يحمل رمز مستخدم (JWT) إطلاقاً — يمرّ عبر بوّابة
--   `_bot_gate_ok()` بالسرّ المشترك. فالتحقّق هنا يكون بالعضوية في الحجز،
--   والدالة الطرفية `bot-chat-attachment` تكون قد تحقّقت منها قبل الرفع أصلاً.
--
-- ⚠️ قاعدة المشروع: دوال `bot_*` **لا يُلغى `anon` عنها** — البوّابة هي السرّ
-- المشترك في الترويسة، لا دور قاعدة البيانات (درس v12.12).
--
-- الخادم المستهدف: **جدة (الإنتاج)**. يرفض التنفيذ على مختبر طوكيو.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'TOKYO_LAB_REFUSED: هذه هجرة إنتاج. نفّذها على جدة.';
  END IF;
END
$guard$;

-- ── ١. قراءة المحادثة: يظهر المرفق ويُعرف صاحب الجلسة ───────────────────────
CREATE OR REPLACE FUNCTION public.bot_booking_chat(
  p_telegram_id bigint, p_barcode text, p_whatsapp_id text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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

  RETURN jsonb_build_object('success', true, 'role', v_role, 'status', v_b.status, 'barcode', v_b.barcode,
    'uid', v_uid,
    'deal_name', COALESCE(v_deal_name,'العرض'), 'other_name', v_other_name,
    'my_count', COALESCE(v_my,0), 'other_count', COALESCE(v_other,0), 'messages', COALESCE(v_msgs,'[]'::jsonb));
END $$;

-- ── ٢. الإرسال مع مرفق ──────────────────────────────────────────────────────
-- 🪤 `CREATE OR REPLACE` مع معاملٍ **جديد** لا يستبدل: يُنشئ نسخة ثانية بجوار
-- الأولى. وحينها يصير نداء البوت بثلاثة أسماء ملتبساً بين نسختين كلتاهما
-- تقبله، فيفشل بـ«function is not unique» — والبوتان يسكتان بلا خطأ مفهوم.
-- (وقع هذا فعلاً مع `record_user_consent` في v14.19.) فتُحذف القديمة أوّلاً.
DROP FUNCTION IF EXISTS public.bot_send_booking_message(bigint, text, text, text);

CREATE OR REPLACE FUNCTION public.bot_send_booking_message(
  p_telegram_id bigint,
  p_barcode text,
  p_body text,
  p_whatsapp_id text DEFAULT NULL::text,
  p_attachment_path text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid text; v_b bookings%ROWTYPE; v_role text; v_cnt int;
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
  IF v_cnt >= 3 THEN RETURN jsonb_build_object('success', false, 'error', 'limit_reached'); END IF;

  INSERT INTO booking_messages (barcode, sender_id, sender_role, body, attachment_path)
  VALUES (v_b.barcode, v_uid, v_role, v_body, v_att);

  RETURN jsonb_build_object('success', true, 'my_count', v_cnt + 1);
END $$;

-- 🪤 دوال `bot_*` يبقى `anon` قادراً على تنفيذها عمداً: الحارس هو
-- `_bot_gate_ok()` بالسرّ المشترك في الترويسة. إلغاء `anon` هنا يُسقط البوتين
-- كليهما (درس v12.12).
GRANT EXECUTE ON FUNCTION public.bot_booking_chat(bigint, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bot_send_booking_message(bigint, text, text, text, text) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق
-- ════════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS الفحص,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ مختبر طوكيو'
            ELSE '✅ جدة (الإنتاج)' END AS النتيجة
UNION ALL
SELECT 'المحادثة تُرجع المرفق',
       CASE WHEN pg_get_functiondef(to_regprocedure('public.bot_booking_chat(bigint,text,text)'))
                 LIKE '%m.attachment_path%' THEN '✅ نعم' ELSE '❌ لا' END
UNION ALL
SELECT 'الإرسال بخمسة معاملات',
       CASE WHEN to_regprocedure('public.bot_send_booking_message(bigint,text,text,text,text)') IS NOT NULL
            THEN '✅ موجودة' ELSE '❌ مفقودة' END
UNION ALL
SELECT 'لا ازدواج في التحميل الزائد',
       CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='bot_send_booking_message') = 1
            THEN '✅ نسخة واحدة' ELSE '❌ نسختان — نداء البوت سيلتبس' END
UNION ALL
SELECT 'حارس السرّ قائم على الإرسال',
       CASE WHEN pg_get_functiondef(to_regprocedure('public.bot_send_booking_message(bigint,text,text,text,text)'))
                 LIKE '%_bot_gate_ok%' THEN '✅ نعم' ELSE '❌ لا' END
UNION ALL
SELECT 'الزائر يُنفّذ دوال البوت (مقصود)',
       CASE WHEN has_function_privilege('anon','public.bot_send_booking_message(bigint,text,text,text,text)','EXECUTE')
            THEN '✅ نعم — الحارس هو السرّ لا الدور' ELSE '❌ أُلغي فانكسر البوتان' END;
