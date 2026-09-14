-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.27 — مرفقات محادثة الطلب · ترقيم مراجعات المتجر
-- ════════════════════════════════════════════════════════════════════════════
-- قرار ناصر: «لا أريد لتاكي أن تتدخّل إلا في حال تصعّد الموضوع — داخل محادثة
-- الطلب». فالمرفق يعيش في المحادثة بين المشتري والتاجر وحدهما، ولا يذهب إلى
-- نموذج شكوى ولا إلى الإدارة.
--
-- ولذلك المستودع **خاص لا عام**: صورة منتجٍ تالف داخل محادثةٍ خاصّة لا يجوز أن
-- يفتحها كل من يخمّن عنوانها. مستودع `deals` عام (وهو صحيح — العروض للناس)،
-- لكن نسخ نفس النهج هنا كان سيجعل أدلّة النزاعات مكشوفة للإنترنت.
--
-- ومراجعات المتجر: صفحة العرض تعرض **٥ مراجعات** و`slice(0,5)` هو كل الحكاية،
-- بلا زرّ ولا رسالة. السادسة غير موجودة في نظر المشتري.
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

-- ── ١. مستودع المرفقات: خاصّ ────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('chat', 'chat', false, 5242880,
        ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif'])
ON CONFLICT (id) DO UPDATE
  SET public = false,                       -- لو أنشأه أحد عاماً يوماً، يُغلق هنا
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── ٢. من يملك هذه المحادثة؟ ────────────────────────────────────────────────
-- مسار الملف: <barcode>/<uuid>.<ext> — أول جزء هو الباركود.
-- تُستعمل داخل سياسات storage.objects، ولذلك SECURITY DEFINER: السياسة لا
-- تستطيع قراءة `public.bookings` بحقوق المتصفّح.
CREATE OR REPLACE FUNCTION public.taki_chat_member(p_object_name text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid text := auth.uid()::text;
  v_bc  text;
BEGIN
  IF v_uid IS NULL OR p_object_name IS NULL THEN RETURN false; END IF;
  v_bc := split_part(p_object_name, '/', 1);
  IF v_bc = '' OR v_bc = p_object_name THEN RETURN false; END IF;   -- لا مجلّد ⇒ مرفوض
  RETURN EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.barcode = v_bc AND (b.user_id = v_uid OR b.store_id = v_uid)
  );
END $$;
REVOKE ALL ON FUNCTION public.taki_chat_member(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_chat_member(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_chat_member(text) TO authenticated;

DROP POLICY IF EXISTS chat_read_members  ON storage.objects;
DROP POLICY IF EXISTS chat_write_members ON storage.objects;
DROP POLICY IF EXISTS chat_no_update     ON storage.objects;
DROP POLICY IF EXISTS chat_no_delete     ON storage.objects;

CREATE POLICY chat_read_members ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'chat' AND public.taki_chat_member(name));
CREATE POLICY chat_write_members ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat' AND public.taki_chat_member(name) AND owner = auth.uid());
-- لا تعديل ولا حذف عمداً: المرفق **دليل**. من يرفع صورة ثم يمحوها بعد أن
-- يقرأها الطرف الآخر يُفرغ المحادثة من قيمتها كسجلّ لما جرى.

-- ── ٣. العمود ───────────────────────────────────────────────────────────────
ALTER TABLE public.booking_messages
  ADD COLUMN IF NOT EXISTS attachment_path text;

COMMENT ON COLUMN public.booking_messages.attachment_path IS
  'اسم الكائن داخل مستودع chat الخاص (<barcode>/<uuid>.<ext>) — لا عنوان عام. يُقرأ برابط موقّع مؤقّت.';

-- ── ٤. الإرسال مع مرفق ──────────────────────────────────────────────────────
-- نوع الإرجاع `booking_messages` اكتسب عموداً، و`CREATE OR REPLACE` لا يغيّر
-- نوع الإرجاع — فلا بدّ من الحذف أولاً. والمعامل الثالث بقيمة افتراضية كي
-- يبقى نداء البوتين ذي المعاملين عاملاً كما هو.
DROP FUNCTION IF EXISTS public.send_booking_message(text, text);
DROP FUNCTION IF EXISTS public.send_booking_message(text, text, text);
CREATE FUNCTION public.send_booking_message(
  p_barcode text,
  p_body    text,
  p_attachment_path text DEFAULT NULL
) RETURNS public.booking_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  caller      text := auth.uid()::text;
  booking_row public.bookings;
  v_role      text;
  sent_count  int;
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

  SELECT COUNT(*) INTO sent_count
  FROM public.booking_messages
  WHERE barcode = p_barcode AND sender_role = v_role;

  IF sent_count >= 3 THEN
    RAISE EXCEPTION 'وصلت الحد الأقصى (٣ رسائل). اتصل بالطرف الآخر مباشرة.' USING ERRCODE = 'P0004';
  END IF;

  INSERT INTO public.booking_messages (barcode, sender_id, sender_role, body, attachment_path)
  VALUES (p_barcode, caller, v_role, clean_body, v_att)
  RETURNING * INTO inserted;

  RETURN inserted;
END $$;

REVOKE ALL ON FUNCTION public.send_booking_message(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_booking_message(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.send_booking_message(text, text, text) TO authenticated;

-- ── ٥. ترقيم مراجعات المتجر ─────────────────────────────────────────────────
-- المراجعة تُكتب على عرض، والمشتري يراها على كل عروض المتجر — فالترقيم على
-- مستوى المتجر لا العرض، مطابقةً لما تعرضه الشاشة.
DROP FUNCTION IF EXISTS public.browse_store_ratings(text, timestamptz, text, integer);
CREATE FUNCTION public.browse_store_ratings(
  p_store_id  text,
  p_cursor_at timestamptz DEFAULT NULL,
  p_cursor_id text        DEFAULT NULL,
  p_limit     integer     DEFAULT 10
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_lim int := GREATEST(1, LEAST(50, COALESCE(p_limit, 10)));
  v_rows jsonb; v_more boolean := false; v_total int;
BEGIN
  IF p_store_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STORE_REQUIRED');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC, r.id DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT rt.*, d.item_name
    FROM public.ratings rt
    JOIN public.deals d ON d.id = rt.deal_id
    WHERE d.store_id = p_store_id
      AND rt.deleted_at IS NULL
      AND (p_cursor_at IS NULL
           OR rt.created_at < p_cursor_at
           OR (rt.created_at = p_cursor_at AND rt.id < p_cursor_id))
    ORDER BY rt.created_at DESC, rt.id DESC
    LIMIT v_lim + 1
  ) r;

  IF jsonb_array_length(v_rows) > v_lim THEN
    v_more := true;
    v_rows := (SELECT jsonb_agg(e) FROM (SELECT e FROM jsonb_array_elements(v_rows) e LIMIT v_lim) s);
  END IF;

  SELECT count(*) INTO v_total
  FROM public.ratings rt JOIN public.deals d ON d.id = rt.deal_id
  WHERE d.store_id = p_store_id AND rt.deleted_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'rows', COALESCE(v_rows,'[]'::jsonb),
                            'has_more', v_more, 'total', v_total);
END $$;

REVOKE ALL ON FUNCTION public.browse_store_ratings(text, timestamptz, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.browse_store_ratings(text, timestamptz, text, integer) TO anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_ratings_created_id
  ON public.ratings (created_at DESC, id DESC) WHERE deleted_at IS NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق
-- ════════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS الفحص,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ مختبر طوكيو'
            ELSE '✅ جدة (الإنتاج)' END AS النتيجة
UNION ALL
SELECT 'مستودع chat خاصّ',
       CASE WHEN EXISTS (SELECT 1 FROM storage.buckets WHERE id='chat' AND public = false)
            THEN '✅ خاصّ' ELSE '❌ عام أو مفقود' END
UNION ALL
SELECT 'عمود المرفق',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema='public' AND table_name='booking_messages'
                           AND column_name='attachment_path')
            THEN '✅ موجود' ELSE '❌ مفقود' END
UNION ALL
SELECT 'سياستا المرفقات',
       CASE WHEN (SELECT count(*) FROM pg_policies WHERE schemaname='storage'
                  AND tablename='objects' AND policyname IN ('chat_read_members','chat_write_members')) = 2
            THEN '✅ الاثنتان' ELSE '❌ ناقصة' END
UNION ALL
SELECT 'لا تعديل ولا حذف للمرفقات',
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage'
                  AND tablename='objects' AND cmd IN ('UPDATE','DELETE')
                  AND qual LIKE '%chat%')
            THEN '✅ ممنوعان' ELSE '❌ توجد سياسة' END
UNION ALL
SELECT 'إرسال الرسالة بثلاثة معاملات',
       CASE WHEN to_regprocedure('public.send_booking_message(text,text,text)') IS NOT NULL
            THEN '✅ موجودة' ELSE '❌ مفقودة' END
UNION ALL
SELECT 'ترقيم مراجعات المتجر',
       CASE WHEN to_regprocedure('public.browse_store_ratings(text,timestamptz,text,integer)') IS NOT NULL
            THEN '✅ موجودة' ELSE '❌ مفقودة' END
UNION ALL
SELECT 'الزائر ممنوع من الإرسال',
       CASE WHEN has_function_privilege('anon','public.send_booking_message(text,text,text)','EXECUTE')
            THEN '❌ يملك التنفيذ' ELSE '✅ ممنوع' END;
