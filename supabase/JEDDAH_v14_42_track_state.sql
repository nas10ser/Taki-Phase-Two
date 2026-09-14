-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.42 — حالة التوصيل في القاعدة لا في ذاكرة المحادثة (طلب ناصر ٧)
-- ════════════════════════════════════════════════════════════════════════════
-- ثلاثة أفعال كانت مفقودة أو وهمية في البوتين:
--
--  ١. **«إيقاف البثّ» لا يكتب شيئاً في القاعدة.** يمسح حقلاً في ذاكرة المحادثة
--     ويقول للتاجر «أوقفنا إرسال موقعك للعميل». والحقيقة أن صفّ `delivery_tracks`
--     يبقى `on_the_way`، فيظلّ المشتري يرى دبّوساً حيّاً حتى تنقضي نافذة
--     الطزاجة. وعدٌ بخصوصية لا تقع.
--  ٢. **«وصلت» و«تم التسليم» غير موجودتين إطلاقاً** في أي من البوتين: الحالتان
--     معرَّفتان كـ«تسميات للعرض» فقط. فتاجرٌ يدير متجره من تيليجرام لا يستطيع
--     أن ينقل طلباً إلى «وصل المندوب»، ومشتريه لا يرى «📍 وصل موقعك» أبداً.
--  ٣. **وحالة الزرّ تُقرأ من الذاكرة**: بعد أي إعادة تشغيل لخادم البوت (وهي
--     تقع مع كل نشر) تعرض البطاقة «🚚 بثّ موقعي» كأنّ لا بثّ جارياً، بينما صفّ
--     القاعدة ما زال `on_the_way`.
--
-- وملاحظة التاجر عند الإتمام كانت تُستعمل لصياغة إشعارٍ عابر ولا تُحفظ على
-- الطلب، فلا يراها المشتري في «💬 ملاحظة التاجر».
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

-- ── حالة التتبّع من البوتين ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bot_delivery_track_status(
  p_telegram_id bigint, p_barcode text, p_status text, p_whatsapp_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_uid text; v_b public.bookings%ROWTYPE; v_msg text;
BEGIN
  IF NOT public._bot_gate_ok() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF p_status NOT IN ('on_the_way','arrived','delivered','cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_status');
  END IF;
  SELECT id INTO v_uid FROM public.users
   WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id) AND deleted_at IS NULL LIMIT 1;
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_linked'); END IF;

  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  -- التاجر وحده يحرّك حالة التوصيل: هو من يوصّل.
  IF v_b.store_id IS DISTINCT FROM v_uid THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;
  IF COALESCE(v_b.fulfillment,'pickup') <> 'delivery' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_delivery');
  END IF;
  IF p_status IN ('on_the_way','arrived') AND v_b.status = 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_acknowledged');
  END IF;

  INSERT INTO public.delivery_tracks (barcode, store_id, user_id, status, updated_at)
  VALUES (upper(btrim(p_barcode)), v_b.store_id, v_b.user_id, p_status, now())
  ON CONFLICT (barcode) DO UPDATE
    SET status = EXCLUDED.status, updated_at = now();

  -- المشتري يُشعَر بما يعنيه فعلاً. «ألغي البثّ» ليس خبراً سيئاً فلا نُقلقه به.
  v_msg := CASE p_status
    WHEN 'arrived'   THEN '📍 وصل المندوب إلى عنوانك — طلبك عند الباب.'
    WHEN 'delivered' THEN '✅ سُلّم طلبك. إن لم تستلمه فراسل التاجر فوراً.'
    ELSE NULL END;
  IF v_msg IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
    VALUES (v_b.user_id,
            CASE p_status WHEN 'arrived' THEN '📍 وصل المندوب' ELSE '✅ سُلّم طلبك' END,
            CASE p_status WHEN 'arrived' THEN '📍 Courier arrived' ELSE '✅ Delivered' END,
            v_msg, v_msg, 'booking',
            jsonb_build_object('audience','buyer','barcode', v_b.barcode,
                               'actionUrl','/bookings?barcode='||v_b.barcode,
                               'action_url','/bookings?barcode='||v_b.barcode));
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', p_status, 'barcode', v_b.barcode);
END $$;
-- 🪤 دوال `bot_*` يبقى `anon` قادراً على تنفيذها — الحارس هو السرّ (درس v12.12).
GRANT EXECUTE ON FUNCTION public.bot_delivery_track_status(bigint, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.bot_complete_booking(p_telegram_id bigint, p_barcode text, p_message text DEFAULT NULL::text, p_whatsapp_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_sid text; v_b bookings%ROWTYPE; v_msg text; v_deal_name text;
BEGIN
  SELECT id INTO v_sid FROM users WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id) AND user_type IN ('seller','admin') AND deleted_at IS NULL LIMIT 1;
  IF v_sid IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_seller'); END IF;
  SELECT * INTO v_b FROM bookings WHERE barcode=UPPER(p_barcode) AND store_id=v_sid LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_b.status='completed' THEN RETURN jsonb_build_object('success',false,'error','already_completed'); END IF;
  IF v_b.status='cancelled' THEN RETURN jsonb_build_object('success',false,'error','cancelled'); END IF;
  -- v14.42 — ملاحظة التاجر تُحفظ على الطلب لا في نصّ إشعارٍ عابر.
  -- 🪤 كانت `p_message` تُستعمل لصياغة الإشعار **فقط**: التاجر يكتب «تُرك عند
  -- الحارس» فتصل رسالةً تُقرأ مرّة وتضيع، ولا تظهر في بطاقة الطلب ولا في
  -- «💬 ملاحظة التاجر» التي يقرؤها المشتري في الموقع.
  UPDATE bookings
     SET status='completed', completed_at=NOW(),
         merchant_note = COALESCE(NULLIF(btrim(COALESCE(p_message,'')),''), merchant_note)
   WHERE barcode=UPPER(p_barcode) AND store_id=v_sid;

  v_msg := NULLIF(btrim(COALESCE(p_message,'')),'');
  IF v_msg IS NOT NULL THEN
    SELECT item_name INTO v_deal_name FROM deals WHERE id=v_b.deal_id;
    INSERT INTO notifications (id, user_id, title_ar, title_en, body_ar, body_en, type, is_read, meta_data, created_at)
    VALUES (
      'ntf_'||(extract(epoch from now())*1000)::bigint::text||substr(md5(random()::text),1,6),
      v_b.user_id,
      '💬 رسالة من المتجر', '💬 Message from the store',
      v_msg, v_msg, 'booking', false,
      jsonb_build_object('audience','buyer','event','completed_note','barcode',v_b.barcode,
                         'dealId',v_b.deal_id,'bot_message_ar',v_msg,'bot_message_en',v_msg),
      now()
    );
  END IF;
  RETURN jsonb_build_object('success',true,'user_name',COALESCE(v_b.user_name,'—'),'quantity',v_b.booked_quantity);
END; $function$;


-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق
-- ════════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS الفحص,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ مختبر طوكيو'
            ELSE '✅ جدة (الإنتاج)' END AS النتيجة
UNION ALL SELECT 'حالة التتبّع من البوت',
       CASE WHEN to_regprocedure('public.bot_delivery_track_status(bigint,text,text,text)') IS NOT NULL
            THEN '✅ موجودة' ELSE '❌ مفقودة' END
UNION ALL SELECT 'محروسة بالسرّ',
       CASE WHEN pg_get_functiondef(to_regprocedure('public.bot_delivery_track_status(bigint,text,text,text)'))
                 LIKE '%_bot_gate_ok%' THEN '✅ نعم' ELSE '❌ لا' END
UNION ALL SELECT 'التاجر وحده يحرّكها',
       CASE WHEN pg_get_functiondef(to_regprocedure('public.bot_delivery_track_status(bigint,text,text,text)'))
                 LIKE '%store_id IS DISTINCT FROM v_uid%' THEN '✅ نعم' ELSE '❌ لا' END
UNION ALL SELECT 'ملاحظة التاجر تُحفظ',
       CASE WHEN pg_get_functiondef(to_regprocedure('public.bot_complete_booking(bigint,text,text,text)'))
                 LIKE '%merchant_note%' THEN '✅ نعم' ELSE '❌ ما زالت تضيع' END;
