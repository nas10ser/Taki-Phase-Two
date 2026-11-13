-- ════════════════════════════════════════════════════════════════════════════
-- JEDDAH v16.28 — البحثُ في الطلبات يشمل **رقمَ الفاتورة**
-- ════════════════════════════════════════════════════════════════════════════
-- طلبُ ناصر (١٣ نوفمبر ٢٠٢٦): «في قائمة السجلات للطلبات — الحاليّة أو السابقة —
-- أريد علامةَ بحثٍ برقم الطلب أو الفاتورة أو الجوال أو اسم المنتج، حتى إذا جاءت
-- شكوى يعثر الجميع على الطلب والفاتورة بسرعة».
--
-- والمقيسُ قبل الكتابة (١٣ نوفمبر، على جدة):
--   ✅ رقمُ الطلب  — موجودٌ في `bookings.search_norm` (مرّتين).
--   ✅ الجوّال     — موجودٌ فيه كذلك (قِيس صفٌّ حقيقيّ: «… 7311320893 0591173715»).
--   ✅ اسمُ المنتج — عبر `deals.name_norm` في فرعٍ ثانٍ من نفس الشرط.
--   ❌ رقمُ الفاتورة — **غيرُ قابلٍ للبحث إطلاقاً**: يعيش في `order_invoices`
--      ولا يمسّه أيُّ فرع. (٩٠ فاتورةً مرقّمة من ١٢٤ صفّاً.)
-- ⇒ هذه الهجرة تُضيف الفرعَ الثالث وحده. لا عمود، ولا مشغّل، ولا ردمَ بيانات.
--
-- 🪤 ولماذا نزعُ الفواصل من الطرفين: `taki_norm('TK-000054')` تُخرج
--    **'tk 000054'** (الشرطةُ تصير مسافة) — قِيس. والناسُ يكتبونها 'TK000054'
--    أو '54'. فبلا النزع يفشل البحثُ على أشيع صيغةٍ يكتبها البشر.
-- 🪤 والدالّة `SECURITY INVOKER`، فـ`EXISTS` على `order_invoices` يخضع لسياستها
--    (`order_invoices_select_parties`: المشتري أو المتجر أو ماليّة الإدارة) —
--    فلا تُوسّع هذه الإضافةُ ما يراه أحد، إنما تُرشّح صفوفاً يراها أصلاً.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── حارسُ المختبر: هذه الهجرة للإنتاج (جدة) وحده ─────────────────────────
DO $lab$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'REFUSED: هذه قاعدةُ المختبر (طوكيو). الهجراتُ تُعتمد على جدة.';
  END IF;
END $lab$;

-- ─── حارسُ الأساس: لا تُستبدل نسخةٌ لا نعرفها ──────────────────────────────
DO $base$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'browse_bookings';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'REFUSED: browse_bookings غير موجودة على هذا الخادم.';
  END IF;
  IF position('dd.name_norm LIKE' IN v_src) = 0 THEN
    RAISE EXCEPTION 'REFUSED: نصُّ الدالّة الحيّ لا يطابق الأساسَ المتوقَّع — راجِعه يدوياً.';
  END IF;
  IF position('order_invoices oi' IN v_src) > 0 THEN
    RAISE NOTICE 'ملاحظة: الفرعُ مطبَّقٌ سلفاً — إعادةُ التطبيق آمنة.';
  END IF;
END $base$;

CREATE OR REPLACE FUNCTION public.browse_bookings(p_scope text DEFAULT 'buyer'::text, p_state text DEFAULT 'all'::text, p_query text DEFAULT NULL::text, p_cursor_ts text DEFAULT NULL::text, p_cursor_id text DEFAULT NULL::text, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_me    text    := auth.uid()::text;
  v_lim   integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_q     text    := public.taki_norm(p_query);
  v_where text;
  v_page  text;
  v_out   jsonb;
  v_total bigint;
  c_cap   constant integer := 5000;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('rows','[]'::jsonb,'has_more',false,'total',0,'total_capped',false);
  END IF;

  -- RLS على bookings يحصر الرؤية أصلاً؛ هذا يفصل دور المشتري عن دور التاجر.
  IF lower(COALESCE(p_scope,'buyer')) = 'seller' THEN
    v_where := format('b.store_id = %L', v_me);
  ELSE
    v_where := format('b.user_id = %L', v_me);
  END IF;

  IF lower(COALESCE(p_state,'all')) = 'active' THEN
    v_where := v_where || ' AND b.status NOT IN (''completed'',''cancelled'')';
  ELSIF lower(COALESCE(p_state,'all')) = 'past' THEN
    v_where := v_where || ' AND b.status IN (''completed'',''cancelled'')';
  END IF;

  -- بحث مُطبَّع عربياً (نفس محرك v13.24): الباركود/اسم المنتج/المتجر/المشتري
  -- v16.28 — وفرعٌ ثالث: رقمُ الفاتورة، يُطابَق بعد نزع الفواصل من الطرفين معاً،
  -- لأن taki_norm('TK-000054') تُخرج 'tk 000054' (الشرطة تصير مسافة) بينما يكتبها
  -- الناس 'TK000054' أو '54'. والرؤيةُ من RLS على order_invoices (مشترٍ/متجر/ماليّة).
  -- 🪤 ولا يُكتب تعليقٌ **بين** حرفين نصّيّين أدناه: الوصلُ الضمنيُّ في PostgreSQL
  --    يشترط مسافةً بيضاء فيها سطرٌ جديد، والتعليقُ يكسره (خطأُ نحوٍ عند التطبيق).
  IF v_q IS NOT NULL THEN
    v_where := v_where || format(
      ' AND (b.search_norm LIKE %1$L'
      '      OR EXISTS (SELECT 1 FROM public.deals dd WHERE dd.id = b.deal_id'
      '                 AND dd.store_id = b.store_id AND dd.name_norm LIKE %1$L)'
      '      OR EXISTS (SELECT 1 FROM public.order_invoices oi WHERE oi.barcode = b.barcode'
      '                 AND replace(public.taki_norm(oi.invoice_no), '' '', '''') LIKE %2$L))',
      '%' || v_q || '%',
      '%' || replace(v_q, ' ', '') || '%');
  END IF;

  EXECUTE format(
    'SELECT count(*)::bigint FROM (SELECT 1 FROM public.bookings b WHERE %s LIMIT %s) z',
    v_where, c_cap + 1) INTO v_total;

  v_page := v_where;
  IF p_cursor_ts IS NOT NULL AND p_cursor_id IS NOT NULL THEN
    v_page := v_page || format(
      ' AND (b.created_at < (%1$L)::timestamptz'
      '   OR (b.created_at = (%1$L)::timestamptz AND b.barcode < %2$L))',
      p_cursor_ts, p_cursor_id);
  END IF;

  EXECUTE format($q$
    WITH page AS (
      SELECT b.* FROM public.bookings b
      WHERE %1$s
      ORDER BY b.created_at DESC, b.barcode DESC
      LIMIT %2$s
    ), ranked AS (
      SELECT p.*, row_number() OVER (ORDER BY p.created_at DESC, p.barcode DESC) AS _rn
      FROM page p
    )
    SELECT jsonb_build_object(
      'rows', COALESCE((
        SELECT jsonb_agg(
          to_jsonb(r) - '_rn'
          || jsonb_build_object('deal', COALESCE(
               (SELECT to_jsonb(d) - 'search_vec' - 'name_norm' - 'loc_keys'
                  FROM public.deals d WHERE d.id = r.deal_id), 'null'::jsonb))
          -- v14.24 — حالة الاسترداد داخل الصفّ. بدونها تُطلق كل بطاقة طلبٍ
          -- مدفوع نداءً مستقلّاً عند الظهور: عشرون طلباً = عشرون نداءً،
          -- وثلاث صفحات = ستّون — أغلبها يعود فارغاً.
          || jsonb_build_object('refund', (
               SELECT jsonb_build_object(
                 'barcode', rf.barcode, 'status', rf.status, 'amount', rf.amount,
                 'opened_by', rf.opened_by, 'reason', rf.reason,
                 'requested_at', rf.requested_at, 'merchant_note', rf.merchant_note,
                 'decided_at', rf.decided_at, 'refunded_at', rf.refunded_at,
                 'refund_amount', rf.refund_amount, 'refund_ref', rf.refund_ref,
                 'refund_method', rf.refund_method, 'credit_note_no', rf.credit_note_no)
                 FROM public.booking_refunds rf WHERE rf.barcode = r.barcode))
          ORDER BY r._rn)
        FROM ranked r WHERE r._rn <= %3$s), '[]'::jsonb),
      'has_more', (SELECT count(*) FROM page) > %3$s,
      'next_ts',  (SELECT r.created_at FROM ranked r WHERE r._rn = %3$s),
      'next_id',  (SELECT r.barcode    FROM ranked r WHERE r._rn = %3$s))
  $q$, v_page, v_lim + 1, v_lim) INTO v_out;

  RETURN COALESCE(v_out, jsonb_build_object('rows','[]'::jsonb,'has_more',false))
       || jsonb_build_object('total', LEAST(v_total, c_cap), 'total_capped', v_total > c_cap);
END $function$;

-- ─── تحقُّقٌ ① بنيويّ: الفرعُ الجديد في النصّ الحيّ ────────────────────────
DO $v1$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'browse_bookings';
  IF position('public.order_invoices oi' IN v_src) = 0 THEN
    RAISE EXCEPTION 'فشل ①: فرعُ الفاتورة غائبٌ عن الدالّة بعد التطبيق.';
  END IF;
  IF position('%2$L' IN v_src) = 0 THEN
    RAISE EXCEPTION 'فشل ①: نمطُ الفاتورة المنزوعِ الفواصل غائب.';
  END IF;
  RAISE NOTICE '① بنيويّ: فرعُ الفاتورة حاضرٌ في الدالّة الحيّة.';
END $v1$;

-- ─── تحقُّقٌ ② سلوكيّ: بحثٌ حقيقيٌّ بهويّة المشتري نفسِه ────────────────────
-- 🪤 لا يصحّ الفحصُ بدور `supabase_admin`: RLS لا تسري عليه فيمرّ الاختبارُ
--    كاذباً. نبدّل الدورَ إلى `authenticated` بمطالبةِ `sub` حقيقيّة، **ثمّ
--    نُعيد الدورَ قبل أيّ قراءةٍ تالية** (درسُ v14.77).
DO $v2$
DECLARE
  v_barcode text; v_inv text; v_buyer text;
  v_hit integer; v_miss integer;
BEGIN
  SELECT oi.barcode, oi.invoice_no, b.user_id
    INTO v_barcode, v_inv, v_buyer
  FROM public.order_invoices oi
  JOIN public.bookings b ON b.barcode = oi.barcode
  WHERE oi.invoice_no IS NOT NULL AND b.user_id IS NOT NULL
  ORDER BY oi.created_at DESC LIMIT 1;

  IF v_barcode IS NULL THEN
    RAISE EXCEPTION 'فشل ②: لا فاتورةَ مرقّمةٌ على هذا الخادم — الفحصُ السلوكيّ لا يُجرى على فراغ.';
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- (أ) الرقمُ كما يطبعه النظام: TK-000054
  SELECT count(*) INTO v_hit FROM jsonb_array_elements(
    (public.browse_bookings('buyer', 'all', v_inv, NULL, NULL, 50))->'rows') e
  WHERE e->>'barcode' = v_barcode;
  -- (ب) الرقمُ كما يكتبه البشر: TK000054  (بلا شرطة)
  SELECT count(*) INTO v_miss FROM jsonb_array_elements(
    (public.browse_bookings('buyer', 'all', replace(v_inv, '-', ''), NULL, NULL, 50))->'rows') e
  WHERE e->>'barcode' = v_barcode;

  EXECUTE 'RESET ROLE';

  IF v_hit <> 1 THEN
    RAISE EXCEPTION 'فشل ②أ: البحثُ بـ% لم يُرجع الطلبَ % (عدد=%).', v_inv, v_barcode, v_hit;
  END IF;
  IF v_miss <> 1 THEN
    RAISE EXCEPTION 'فشل ②ب: البحثُ بلا شرطة (%) لم يُرجع الطلبَ % (عدد=%).',
      replace(v_inv, '-', ''), v_barcode, v_miss;
  END IF;
  RAISE NOTICE '② سلوكيّ: % و% كلاهما يجد الطلبَ %.', v_inv, replace(v_inv, '-', ''), v_barcode;
END $v2$;

-- ─── تحقُّقٌ ③ ضابطٌ سالب: بحثٌ لا يطابق شيئاً يُرجع صفراً ──────────────────
-- بلا هذا الضابط قد يمرّ ② لأن الترشيحَ **أُهمل** لا لأنه نجح.
DO $v3$
DECLARE v_buyer text; v_n integer;
BEGIN
  SELECT b.user_id INTO v_buyer FROM public.bookings b
  WHERE b.user_id IS NOT NULL ORDER BY b.created_at DESC LIMIT 1;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT jsonb_array_length((public.browse_bookings(
    'buyer', 'all', 'ZZQX-لا-يوجد-9988776655', NULL, NULL, 50))->'rows') INTO v_n;
  EXECUTE 'RESET ROLE';

  IF v_n <> 0 THEN
    RAISE EXCEPTION 'فشل ③: بحثٌ عن نصٍّ غير موجود أرجع % صفّاً — الترشيحُ مُهمَل.', v_n;
  END IF;
  RAISE NOTICE '③ ضابطٌ سالب: نصٌّ غير موجود ⇒ صفرُ صفّ.';
END $v3$;
