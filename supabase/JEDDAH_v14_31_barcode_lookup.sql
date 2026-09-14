-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.31 — الباركود يُوجَد دائماً (طلب ناصر ١٠: «لا تحذف اي شيء»)
-- ════════════════════════════════════════════════════════════════════════════
-- القياس الذي أوجب هذا:
--   البوت يبحث عن الباركود داخل قائمةٍ مسقوفة: `bot_get_seller_bookings`
--   تُرجع **٣٠** صفّاً و`bot_get_my_bookings` تُرجع **٢٠**. فحجزُ التاجر
--   الحادي والثلاثون **غير قابل للمسح اليوم** — الماسح يقول «لم نعد نجد هذا
--   الحجز» عن حجزٍ قائم في القاعدة.
--   والماسح في الموقع يبحث في نافذة الحالة (٢٠٠ صفّ) وحدها.
--
-- الحل ليس رفع السقف — أي سقفٍ يُكسَر يوماً. الحل بحثٌ مباشر في القاعدة
-- بالفهرس، يُنادى **فقط حين لا يُوجد الباركود في الذاكرة**، فلا يُضيف جولة
-- شبكة على المسار الشائع.
--
-- 🔒 لا تسريب: من ليس طرفاً في الحجز يتلقّى **نفس** جواب «غير موجود» تماماً،
-- فلا يفرّق بين باركودٍ لا وجود له وباركودٍ ليس له. ولا قيمة للتخمين أصلاً:
-- ٨ محارف من أبجدية ٣٢ = ١٫١ تريليون احتمال.
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

-- الفهرس: `backup_code` لم يكن مفهرساً، فالبحث به كان مسحاً كاملاً للجدول.
CREATE INDEX IF NOT EXISTS idx_bookings_backup_code ON public.bookings (backup_code);

-- ── نواة مشتركة: صفّ الحجز بالشكل الذي تعرفه البوتات والماسح ───────────────
CREATE OR REPLACE FUNCTION public._booking_card(p_barcode text, p_role text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'barcode', b.barcode, 'backup_code', b.backup_code,
    'user_name', COALESCE(b.user_name,'—'), 'user_phone', COALESCE(b.user_phone,'—'),
    'shop_name', COALESCE(NULLIF(u.shop,''), NULLIF(u.name,''), '—'),
    'deal_name', COALESCE(d.item_name,'العرض'), 'deal_id', b.deal_id,
    'quantity', b.booked_quantity, 'status', b.status,
    'notes', COALESCE(b.notes,''), 'merchant_note', COALESCE(b.merchant_note,''),
    'prep_time', b.prep_time, 'sort_at', b.booked_at, 'booked_at', b.booked_at,
    'expiry_time', b.expiry_time,
    'unread', (SELECT count(*) FROM booking_messages m
               WHERE m.barcode = b.barcode
                 AND m.sender_role <> p_role AND m.read_at IS NULL),
    'fulfillment', COALESCE(b.fulfillment,'pickup'),
    'delivery_fee', b.delivery_fee,
    'delivery_label',   b.delivery_address->>'label',
    'delivery_details', b.delivery_address->>'details',
    'delivery_phone',   b.delivery_address->>'phone',
    'delivery_lat',     b.delivery_address->>'lat',
    'delivery_lng',     b.delivery_address->>'lng',
    'payment_method', b.payment_method,
    'paid', b.paid_at IS NOT NULL,
    'paid_amount', b.paid_amount,
    'total_amount', b.total_amount,
    'role', p_role
  )
  FROM public.bookings b
  LEFT JOIN public.deals d ON d.id = b.deal_id
  LEFT JOIN public.users u ON u.id = b.store_id
  WHERE b.barcode = p_barcode;
$$;
REVOKE ALL ON FUNCTION public._booking_card(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._booking_card(text, text) FROM anon, authenticated;

-- ── ١. الموقع: ماسح التاجر وبطاقة المشتري ───────────────────────────────────
DROP FUNCTION IF EXISTS public.lookup_booking_by_code(text);
CREATE FUNCTION public.lookup_booking_by_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  text := auth.uid()::text;
  v_code text := upper(btrim(COALESCE(p_code, '')));
  v_b    public.bookings%ROWTYPE;
  v_role text;
BEGIN
  -- جوابٌ واحد لكل حالات الفشل: لا يفرّق المستمع بين «غير موجود» و«ليس لك».
  IF v_uid IS NULL OR v_code = '' OR length(v_code) > 32 THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT * INTO v_b FROM public.bookings
  WHERE upper(barcode) = v_code OR upper(backup_code) = v_code
  LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;

  IF    v_uid = v_b.store_id THEN v_role := 'seller';
  ELSIF v_uid = v_b.user_id  THEN v_role := 'buyer';
  ELSIF public.is_admin()    THEN v_role := 'admin';
  ELSE  RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object('found', true,
                            'booking', public._booking_card(v_b.barcode, v_role));
END $$;
-- 🪤 المنح المباشر من Supabase و`PUBLIC` منحان مستقلّان — يلزم إلغاؤهما معاً.
REVOKE ALL ON FUNCTION public.lookup_booking_by_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lookup_booking_by_code(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.lookup_booking_by_code(text) TO authenticated;

-- ── ٢. البوتان ──────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.bot_lookup_booking(bigint, text, text);
CREATE FUNCTION public.bot_lookup_booking(
  p_telegram_id bigint, p_code text, p_whatsapp_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  text;
  v_code text := upper(btrim(COALESCE(p_code, '')));
  v_b    public.bookings%ROWTYPE;
  v_role text;
BEGIN
  IF NOT public._bot_gate_ok() THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authorized');
  END IF;
  SELECT id INTO v_uid FROM public.users
  WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id) AND deleted_at IS NULL LIMIT 1;
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_linked'); END IF;
  IF v_code = '' OR length(v_code) > 32 THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  SELECT * INTO v_b FROM public.bookings
  WHERE upper(barcode) = v_code OR upper(backup_code) = v_code
  LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;

  IF    v_uid = v_b.store_id THEN v_role := 'seller';
  ELSIF v_uid = v_b.user_id  THEN v_role := 'buyer';
  ELSE  RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  RETURN jsonb_build_object('success', true, 'role', v_role,
                            'booking', public._booking_card(v_b.barcode, v_role));
END $$;
-- 🪤 دوال `bot_*` يبقى `anon` قادراً على تنفيذها عمداً — الحارس هو السرّ في
-- الترويسة لا دور القاعدة (درس v12.12).
GRANT EXECUTE ON FUNCTION public.bot_lookup_booking(bigint, text, text) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق
-- ════════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS الفحص,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ مختبر طوكيو'
            ELSE '✅ جدة (الإنتاج)' END AS النتيجة
UNION ALL SELECT 'بحث الموقع',
       CASE WHEN to_regprocedure('public.lookup_booking_by_code(text)') IS NOT NULL
            THEN '✅ موجود' ELSE '❌ مفقود' END
UNION ALL SELECT 'بحث البوتين',
       CASE WHEN to_regprocedure('public.bot_lookup_booking(bigint,text,text)') IS NOT NULL
            THEN '✅ موجود' ELSE '❌ مفقود' END
UNION ALL SELECT 'فهرس الرمز الاحتياطي',
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                         AND indexname='idx_bookings_backup_code')
            THEN '✅ موجود' ELSE '❌ مفقود' END
UNION ALL SELECT 'الزائر ممنوع من بحث الموقع',
       CASE WHEN has_function_privilege('anon','public.lookup_booking_by_code(text)','EXECUTE')
            THEN '❌ يملك التنفيذ' ELSE '✅ ممنوع' END
UNION ALL SELECT 'النواة محجوبة عن الجميع',
       CASE WHEN has_function_privilege('anon','public._booking_card(text,text)','EXECUTE')
             OR has_function_privilege('authenticated','public._booking_card(text,text)','EXECUTE')
            THEN '❌ مكشوفة' ELSE '✅ محجوبة' END
UNION ALL SELECT 'حارس السرّ على بحث البوت',
       CASE WHEN pg_get_functiondef(to_regprocedure('public.bot_lookup_booking(bigint,text,text)'))
                 LIKE '%_bot_gate_ok%' THEN '✅ نعم' ELSE '❌ لا' END;
