-- ════════════════════════════════════════════════════════════════════════════
-- JEDDAH v16.29 — نفسُ البحث في بقيّة شاشات السجلّات
-- ════════════════════════════════════════════════════════════════════════════
-- أمرُ ناصر بعد تجربته v16.28: «كمل بقية الصفحات».
--
-- والمقيسُ على جدة قبل الكتابة — ماذا يجد كلُّ بحثٍ قائم اليوم:
--   • لوحة التاجر / حجوزاتي → الطلب · الفاتورة · الجوّال · المنتج  ✅ (v16.28)
--   • الإدارة ← المدفوعات   → كودُ الحجز ومرجعُ البوّابة **ببادئةٍ فقط**،
--       ولا فاتورةَ ولا جوّالَ ولا اسم. فمن يشتكي بـ«فاتورتي TK-000054»
--       لم يكن لناصرَ سبيلٌ لإيجادها في اللوحة إطلاقاً.
--   • الإدارة ← إدارة العمليات → كودُ الكيان واسمُ المتجر/المشتري، بلا
--       فاتورةٍ ولا جوّال.
--   • الإدارة ← التوصيل → **لا بحثَ إطلاقاً** (٦ صفوفٍ اليوم، وتكبر).
--
-- 🔴 وقاعدةُ المطابقة تُكتب **مرّةً واحدة**: `taki_search_key()`. كانت في
--    v16.28 سطراً داخل `browse_bookings`، ونسخُها أربع مرّاتٍ يضمن انحرافَها
--    عند أوّل تعديل — وهو الانحرافُ الذي كلّفنا «٦ ساعة» و«٣ رسالة» من قبل.
-- 🪤 وهي للمعرّفات وحدها (فاتورة · جوّال · كود): تحذف المسافات، فلا تصلح
--    للأسماء («قهوة اليوم» تصير «قهوهاليوم»). الأسماءُ تبقى على `taki_norm`.
-- ════════════════════════════════════════════════════════════════════════════

DO $lab$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'REFUSED: هذه قاعدةُ المختبر (طوكيو). الهجراتُ تُعتمد على جدة.';
  END IF;
END $lab$;

-- ─── حارسُ الأساس: النسخُ الحيّةُ هي التي بُنيت عليها هذه الهجرة ──────────
DO $base$
DECLARE v text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='browse_bookings';
  IF v IS NULL OR position('order_invoices oi' IN v) = 0 THEN
    RAISE EXCEPTION 'REFUSED: v16.28 غيرُ مطبَّقة على هذا الخادم — طبّقها أوّلاً.';
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='admin_payment_log';
  IF v IS NULL OR position('l.payment_ref LIKE' IN v) = 0 THEN
    RAISE EXCEPTION 'REFUSED: نصُّ admin_payment_log الحيّ لا يطابق الأساسَ المتوقَّع.';
  END IF;
END $base$;

-- ─── ① القاعدةُ الواحدة لمطابقة المعرّفات ────────────────────────────────
-- 🪤 `IMMUTABLE` تصحّ لأن `taki_norm` كذلك (قِيس: provolatile='i')، وبها
--    يجوز استعمالُها يوماً في فهرسٍ تعبيريّ إن لزم.
CREATE OR REPLACE FUNCTION public.taki_search_key(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public', 'pg_catalog'
AS $fn$
  SELECT NULLIF(replace(public.taki_norm(COALESCE(p, '')), ' ', ''), '');
$fn$;

REVOKE ALL ON FUNCTION public.taki_search_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.taki_search_key(text) TO anon, authenticated, service_role, postgres;

-- 🪤 **ولا تهريبَ لمحارف LIKE هنا، وقد قِيس لا ظُنّ**: كتبتُ أوّلاً مُعيناً
--    يُهرّب `%` و`_` و`\` (تقليداً لـ`browse_notifications`)، ثمّ قِستُ
--    `taki_norm` فوجدتُ خطوتَها الرابعة تُحوّل **كلَّ** ما ليس حرفاً ولا رقماً
--    إلى مسافة: `taki_norm('a%b') = 'a b'` و`taki_norm('%') IS NULL`. فلا
--    محرفَ بدلٍ يبلغ نمطَ LIKE أصلاً، والمُعينُ كان كوداً ميّتاً منذ ولادته.
--    (ولو تغيّرت `taki_norm` يوماً فهنا موضعُ إعادة النظر.)

-- ─── ② بحثُ الطلبات يستعمل القاعدةَ الواحدة (بدل سطرِها المكرّر) ─────────
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
      '                 AND public.taki_search_key(oi.invoice_no) LIKE %2$L))',
      '%' || v_q || '%',
      '%' || COALESCE(public.taki_search_key(p_query), '') || '%');
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

-- ─── ③ المدفوعات: الفاتورة · الجوّال · اسمُ المشتري والتاجر ──────────────
CREATE OR REPLACE FUNCTION public.admin_payment_log(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_merchant text DEFAULT NULL::text, p_provider text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_before_id bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 50, p_search text DEFAULT NULL::text)
 RETURNS TABLE(id bigint, booking_barcode text, merchant_id text, merchant_name text, buyer_id text, buyer_name text, amount numeric, vat_amount numeric, provider text, payment_ref text, status text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_q    text := NULLIF(btrim(COALESCE(p_search, '')), '');
  -- v16.29 — مفتاحُ المعرّفات (فاتورة/جوّال/كود) ومفتاحُ الأسماء، كلٌّ لبابه.
  v_key  text := public.taki_search_key(p_search);
  v_name text := NULLIF(public.taki_norm(COALESCE(p_search, '')), '');
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'ADMIN_ONLY'; END IF;
  RETURN QUERY
  SELECT l.id, l.booking_barcode, l.merchant_id,
         COALESCE(NULLIF(um.shop, ''), um.name) AS merchant_name,
         l.buyer_id, ub.name AS buyer_name,
         l.amount, l.vat_amount, l.provider, l.payment_ref, l.status, l.created_at
  FROM public.platform_payment_log l
  LEFT JOIN public.users um ON um.id = l.merchant_id
  LEFT JOIN public.users ub ON ub.id = l.buyer_id
  WHERE (p_from IS NULL OR l.created_at >= p_from)
    AND (p_to   IS NULL OR l.created_at <  p_to)
    AND (p_merchant IS NULL OR l.merchant_id = p_merchant)
    AND (p_provider IS NULL OR l.provider = p_provider)
    AND (p_status   IS NULL OR l.status = p_status)
    AND (p_before_id IS NULL OR l.id < p_before_id)
    AND (v_q IS NULL
         OR l.booking_barcode LIKE upper(v_q) || '%'
         OR l.payment_ref LIKE v_q || '%'
         OR (v_q ~ '^[0-9]+$' AND l.id = v_q::bigint)
         OR (v_key IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.order_invoices oi
                WHERE oi.barcode = l.booking_barcode
                  AND public.taki_search_key(oi.invoice_no) LIKE '%' || v_key || '%'))
         OR (v_key IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.users u
                WHERE u.id IN (l.buyer_id, l.merchant_id)
                  AND public.taki_search_key(u.phone) LIKE '%' || v_key || '%'))
         OR (v_name IS NOT NULL AND (
               public.taki_norm(COALESCE(ub.name, '')) LIKE '%' || v_name || '%'
            OR public.taki_norm(COALESCE(um.shop, '') || ' ' || COALESCE(um.name, ''))
               LIKE '%' || v_name || '%')))
  ORDER BY l.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
END $function$;

-- ─── ④ إدارة العمليات: الفاتورة · الجوّال ───────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_operations_log(p_limit integer DEFAULT 30, p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone, p_action text DEFAULT NULL::text, p_q text DEFAULT NULL::text, p_cursor_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lim   int  := GREATEST(1, LEAST(100, COALESCE(p_limit, 30)));
  v_code  text := NULLIF(regexp_replace(lower(COALESCE(p_q, '')), '\s', '', 'g'), '');
  v_key   text;   -- v16.29 — مفتاحُ الفاتورة والجوّال
  v_name  text;
  v_rows  jsonb;
  v_n     int;
  v_last  timestamptz;
  v_lastid bigint;
  v_stats jsonb := NULL;
  v_day   timestamptz;
BEGIN
  IF NOT public.taki_admin_perm('tab_tools') THEN
    RAISE EXCEPTION 'غير مصرّح' USING ERRCODE = '42501';
  END IF;

  -- 🪤 العربية تُطبَّع على الطرفين معاً وإلا سقط «الراشد» أمام «راشد» (v13.25).
  v_name := NULLIF(public.taki_norm(COALESCE(p_q, '')), '');
  v_key  := public.taki_search_key(p_q);

  -- 🪤 كلُّ هذا في استعلامٍ واحد لا في جدولٍ مؤقّت: الدالّة `STABLE`، ودالّةٌ
  --    غير `VOLATILE` لا يُسمح لها بـ`CREATE`/`INSERT` إطلاقاً. وجعلُها
  --    `VOLATILE` لأجل جدولٍ مؤقّت ثمنٌ بلا مقابل.
  WITH page AS (
      SELECT a.*
        FROM public.activity_log a
       WHERE (p_action IS NULL OR a.action = p_action)
         AND (p_cursor IS NULL
              OR (p_cursor_id IS NULL     AND a.created_at < p_cursor)
              OR (p_cursor_id IS NOT NULL AND (a.created_at, a.id) < (p_cursor, p_cursor_id)))
         AND (
              v_code IS NULL
              OR position(v_code IN lower(COALESCE(a.entity_id, ''))) > 0
              OR (v_name IS NOT NULL AND EXISTS (
                   SELECT 1 FROM public.users u
                    WHERE u.id IN (a.user_id, a.metadata->>'store_id', a.metadata->>'buyer_id')
                      AND public.taki_norm(COALESCE(u.shop,'') || ' ' || COALESCE(u.name,''))
                          LIKE '%' || v_name || '%'))
              OR (v_key IS NOT NULL AND EXISTS (
                   SELECT 1 FROM public.order_invoices oi
                    WHERE oi.barcode = a.entity_id
                      AND public.taki_search_key(oi.invoice_no) LIKE '%' || v_key || '%'))
              OR (v_key IS NOT NULL AND EXISTS (
                   SELECT 1 FROM public.users u
                    WHERE u.id IN (a.user_id, a.metadata->>'store_id', a.metadata->>'buyer_id')
                      AND public.taki_search_key(u.phone) LIKE '%' || v_key || '%'))
             )
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT v_lim
  ), shaped AS (
      SELECT p.id, p.created_at,
             jsonb_build_object(
               'id',          p.id,
               'at',          p.created_at,
               'action',      p.action,
               'entity_type', p.entity_type,
               'code',        p.entity_id,
               'actor_id',    p.user_id,
               'actor_type',  p.user_type,
               'actor_name',  COALESCE(NULLIF(ua.name,''), NULLIF(ua.shop,'')),
               'store_id',    p.metadata->>'store_id',
               'store_name',  COALESCE(NULLIF(us.shop,''), NULLIF(us.name,'')),
               'buyer_id',    p.metadata->>'buyer_id',
               'buyer_name',  COALESCE(NULLIF(ub.name,''), NULLIF(ub.shop,'')),
               'deal_id',     p.metadata->>'deal_id',
               'quantity',    CASE WHEN jsonb_typeof(p.metadata->'quantity') = 'number'
                                   THEN (p.metadata->>'quantity')::numeric END,
               'amount',      CASE WHEN jsonb_typeof(p.metadata->'amount') = 'number'
                                   THEN (p.metadata->>'amount')::numeric END,
               'event',       p.metadata->>'event',
               'meta',        COALESCE(p.metadata, '{}'::jsonb)
             ) AS x
        FROM page p
        LEFT JOIN public.users ua ON ua.id = p.user_id
        LEFT JOIN public.users us ON us.id = p.metadata->>'store_id'
        LEFT JOIN public.users ub ON ub.id = p.metadata->>'buyer_id'
  )
  SELECT jsonb_agg(s.x ORDER BY s.created_at DESC, s.id DESC),
         count(*)::int,
         (array_agg(s.created_at ORDER BY s.created_at ASC, s.id ASC))[1],
         (array_agg(s.id         ORDER BY s.created_at ASC, s.id ASC))[1]
    INTO v_rows, v_n, v_last, v_lastid
    FROM shaped s;

  -- الأرقام تُحسب للصفحة الأولى وحدها، وهي **عن السجلّ كلّه** لا عن المرشِّح.
  IF p_cursor IS NULL THEN
    v_day := date_trunc('day', now() AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh';
    SELECT jsonb_build_object(
      'today',   (SELECT count(*) FROM public.activity_log WHERE created_at >= v_day),
      'week',    (SELECT count(*) FROM public.activity_log WHERE created_at >= v_day - interval '6 days'),
      'total',   (SELECT count(*) FROM public.activity_log),
      'latest_code', (SELECT a.entity_id FROM public.activity_log a
                       WHERE a.entity_type = 'booking' AND a.entity_id IS NOT NULL
                       ORDER BY a.created_at DESC, a.id DESC LIMIT 1),
      'latest_at',   (SELECT a.created_at FROM public.activity_log a
                       WHERE a.entity_type = 'booking' AND a.entity_id IS NOT NULL
                       ORDER BY a.created_at DESC, a.id DESC LIMIT 1),
      'actions', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('action', t.action, 'n', t.n) ORDER BY t.n DESC)
            FROM (SELECT a.action AS action, count(*) AS n
                    FROM public.activity_log a GROUP BY a.action) t), '[]'::jsonb)
    ) INTO v_stats;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'rows', COALESCE(v_rows, '[]'::jsonb),
    -- صفحةٌ ناقصة = لا مزيد. ولا يُعاد مؤشّرٌ لصفحةٍ فارغة.
    'next_cursor',    CASE WHEN v_n = v_lim THEN to_jsonb(v_last)   ELSE 'null'::jsonb END,
    'next_cursor_id', CASE WHEN v_n = v_lim THEN to_jsonb(v_lastid) ELSE 'null'::jsonb END,
    'stats', COALESCE(v_stats, 'null'::jsonb)
  );
END
$function$;

-- ─── ⑤ التوصيل: بحثٌ من الصفر (ومعاملٌ جديد ⇒ DROP أوّلاً) ──────────────
-- 🪤 `CREATE OR REPLACE` بمعاملٍ جديد **لا يستبدل**: يُنشئ نسخةً ثانية
--    فيصير النداءُ ملتبساً وتسكت الشاشة (درسُ v14.25).
DROP FUNCTION IF EXISTS public.admin_delivery_orders(text, integer, integer);

CREATE OR REPLACE FUNCTION public.admin_delivery_orders(
  p_status text DEFAULT NULL::text,
  p_limit  integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_q      text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v       jsonb;
  v_total bigint;
  v_lim   int  := GREATEST(1, LEAST(200, COALESCE(p_limit,50)));
  v_off   int  := GREATEST(0, COALESCE(p_offset,0));
  v_key   text := public.taki_search_key(p_q);
  v_name  text := NULLIF(public.taki_norm(COALESCE(p_q,'')), '');
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;

  -- 🔴 والمرشّحُ نفسُه يسري على العدّ لا على الصفحة وحدها: قائمةٌ مُرشَّحة
  --    بعدّادٍ غيرِ مُرشَّح تقول «٦ طلبات» وتعرض واحداً — كذبةٌ على الشاشة.
  WITH base AS (
    SELECT b.barcode, b.status, b.booked_at, b.total_amount, b.delivery_fee,
           b.user_name, b.user_phone,
           COALESCE(NULLIF(u.shop,''), u.name) AS store_name, b.store_id,
           d.item_name, b.payment_method, (b.paid_at IS NOT NULL) AS paid,
           b.delivery_address->>'label'   AS addr_label,
           b.delivery_address->>'details' AS addr_details,
           dt.status AS track_status, dt.updated_at AS track_at
    FROM bookings b
    LEFT JOIN users u ON u.id = b.store_id
    LEFT JOIN deals d ON d.id = b.deal_id
    LEFT JOIN delivery_tracks dt ON dt.barcode = b.barcode
    WHERE b.fulfillment = 'delivery'
      AND (p_status IS NULL OR b.status = p_status)
      AND (
        (v_key IS NULL AND v_name IS NULL)
        OR (v_key IS NOT NULL AND public.taki_search_key(b.barcode)    LIKE '%' || v_key || '%')
        OR (v_key IS NOT NULL AND public.taki_search_key(b.user_phone) LIKE '%' || v_key || '%')
        OR (v_key IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.order_invoices oi
               WHERE oi.barcode = b.barcode
                 AND public.taki_search_key(oi.invoice_no) LIKE '%' || v_key || '%'))
        OR (v_name IS NOT NULL AND public.taki_norm(COALESCE(b.user_name,'')) LIKE '%' || v_name || '%')
        OR (v_name IS NOT NULL AND public.taki_norm(COALESCE(d.item_name,''))  LIKE '%' || v_name || '%')
      )
  ), page AS (
    SELECT * FROM base ORDER BY booked_at DESC LIMIT v_lim OFFSET v_off
  )
  SELECT (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.booked_at DESC), '[]'::jsonb) FROM page t),
         (SELECT count(*) FROM base)
    INTO v, v_total;

  RETURN jsonb_build_object('ok', true, 'rows', COALESCE(v, '[]'::jsonb), 'total', v_total);
END $function$;

-- 🔴 الصلاحيّاتُ تُعاد **حرفياً** بعد `DROP`: الدالّةُ الجديدة تُولد بمنحٍ
--    افتراضيّ يشمل `PUBLIC`، والقديمةُ كانت لـ`authenticated` و`service_role`
--    و`postgres` وحدها (قِيس `proacl` قبل التنفيذ).
REVOKE ALL ON FUNCTION public.admin_delivery_orders(text, integer, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delivery_orders(text, integer, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_delivery_orders(text, integer, integer, text) TO postgres, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق — `DO` يرفع استثناءً، فالجدولُ وحده لا يُفشل psql
-- ════════════════════════════════════════════════════════════════════════════

-- ① القاعدةُ الواحدة تعمل كما يكتبها البشر
DO $v1$
BEGIN
  IF public.taki_search_key('TK-000054') <> 'tk000054' THEN
    RAISE EXCEPTION 'فشل ①: مفتاحُ TK-000054 = %', public.taki_search_key('TK-000054');
  END IF;
  IF public.taki_search_key('tk 000054') <> 'tk000054' THEN
    RAISE EXCEPTION 'فشل ①: الصيغةُ المُطبَّعة لا تُعطي نفسَ المفتاح.';
  END IF;
  IF public.taki_search_key('  ') IS NOT NULL THEN
    RAISE EXCEPTION 'فشل ①: الفراغُ يجب أن يكون NULL لا نصّاً فارغاً.';
  END IF;
  RAISE NOTICE '① taki_search_key: TK-000054 ⇔ tk 000054 ⇔ tk000054.';
END $v1$;

-- ② الدوالُّ الأربع تمرّ بالقاعدة الواحدة ولا تكتبها بيدها
-- 🪤 والفحصُ **مقصورٌ عليها**: مسحٌ شاملٌ لكلّ دوالّ `public` اتّهم
--    `browse_notifications` وهي تفعل شيئاً آخر (تهريبَ محارف LIKE) —
--    وصراخٌ كاذبٌ أسوأ من غياب الحارس.
DO $v2$
DECLARE r record; v text;
BEGIN
  FOR r IN SELECT unnest(ARRAY['browse_bookings','admin_payment_log',
                               'admin_operations_log','admin_delivery_orders']) AS nm
  LOOP
    SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') INTO v
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = r.nm;
    IF v IS NULL THEN RAISE EXCEPTION 'فشل ②: % غير موجودة.', r.nm; END IF;
    IF position('taki_search_key(' IN v) = 0 THEN
      RAISE EXCEPTION 'فشل ②: % لا تمرّ بالقاعدة الواحدة.', r.nm;
    END IF;
    IF position('replace(public.taki_norm(' IN v) > 0 THEN
      RAISE EXCEPTION 'فشل ②: % ما زالت تكتب قاعدةَ المطابقة بيدها.', r.nm;
    END IF;
  END LOOP;
  RAISE NOTICE '② الأربعُ تمرّ بالقاعدة الواحدة ولا تكتبها بيدها.';
END $v2$;

-- ③ سلوكيّ: البحثُ برقم الفاتورة يجد الطلبَ في شاشات الإدارة الثلاث
-- 🪤 بدور `supabase_admin` تمرّ `is_admin()`؟ لا — تقرأ `auth.uid()`. فننتحل
--    هويّةَ أدمنٍ حقيقيّ بمطالبةٍ صريحة، ثمّ نُعيد الدور (درسُ v14.96/v14.77).
DO $v3$
DECLARE
  v_admin text; v_inv text; v_bc text; v_n int; v_zero int;
BEGIN
  SELECT id INTO v_admin FROM public.users WHERE user_type = 'admin' ORDER BY created_at LIMIT 1;
  SELECT oi.invoice_no, oi.barcode INTO v_inv, v_bc
  FROM public.order_invoices oi
  JOIN public.platform_payment_log l ON l.booking_barcode = oi.barcode
  WHERE oi.invoice_no IS NOT NULL ORDER BY oi.created_at DESC LIMIT 1;

  IF v_admin IS NULL THEN RAISE EXCEPTION 'فشل ③: لا حسابَ أدمنٍ على هذا الخادم.'; END IF;

  IF v_inv IS NULL THEN
    RAISE NOTICE '③ تخطٍّ: لا عمليةَ دفعٍ لها فاتورةٌ مرقّمة — الفحصُ لا يُجرى على فراغ.';
  ELSE
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_n FROM public.admin_payment_log(
      NULL, NULL, NULL, NULL, NULL, NULL, 50, replace(v_inv, '-', ''))
     WHERE booking_barcode = v_bc;
    SELECT count(*) INTO v_zero FROM public.admin_payment_log(
      NULL, NULL, NULL, NULL, NULL, NULL, 50, 'ZZQX-لا-يوجد-9988776655');
    EXECUTE 'RESET ROLE';
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'فشل ③أ: المدفوعاتُ لم تجد % بالفاتورة % (عدد=%).', v_bc, v_inv, v_n;
    END IF;
    IF v_zero <> 0 THEN
      RAISE EXCEPTION 'فشل ③ب: بحثٌ عن نصٍّ غير موجود أرجع % صفّاً — الترشيحُ مُهمَل.', v_zero;
    END IF;
    RAISE NOTICE '③ المدفوعات: % تجد الطلبَ %، والنصُّ الغائب يُرجع صفراً.', replace(v_inv,'-',''), v_bc;
  END IF;
END $v3$;

-- ④ التوصيل: المعاملُ الجديد موجودٌ ونسخةٌ واحدة، والصلاحياتُ كما كانت
DO $v4$
DECLARE v_n int; v_acl text;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='admin_delivery_orders';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'فشل ④: % نسخةً من admin_delivery_orders — النداءُ يصير ملتبساً.', v_n;
  END IF;
  SELECT array_to_string(p.proacl, ' | ') INTO v_acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='admin_delivery_orders';
  -- 🔴 الدالّةُ الجديدة **تُولد ممنوحةً لـ`anon`** في هذا المشروع (امتيازاتٌ
  --    افتراضيّة على `public`)، فالـ`REVOKE` أعلاه هو ما يسدّها — لا الصمت.
  -- 🪤 و`proacl` **فارغةٌ (NULL)** حين لا تُلمس الصلاحيّات، ومقارنةُ NULL
  --    تُعطي NULL فلا يقع `RAISE` — وهو ثقبٌ في الحارس نفسِه، سُدّ بشرطٍ صريح.
  IF v_acl IS NULL OR v_acl LIKE '%anon=%' THEN
    RAISE EXCEPTION 'فشل ④: صلاحيّةُ تنفيذٍ لمجهولٍ على دالّة إدارة — %',
      COALESCE(v_acl, '(افتراضيّة: PUBLIC)');
  END IF;
  IF v_acl NOT LIKE '%authenticated=X%' OR v_acl NOT LIKE '%service_role=X%' THEN
    RAISE EXCEPTION 'فشل ④: صلاحيّاتُ الدالّة لم تُعَد بعد DROP — %', COALESCE(v_acl,'(فارغة)');
  END IF;
  RAISE NOTICE '④ التوصيل: نسخةٌ واحدة، وصلاحيّاتٌ بلا مجهول — %', v_acl;
END $v4$;

-- ⑤ وبحثُ الطلبات لم ينكسر بإعادة بنائه على القاعدة الواحدة
DO $v5$
DECLARE v_buyer text; v_inv text; v_bc text; v_hit int;
BEGIN
  SELECT oi.barcode, oi.invoice_no, b.user_id INTO v_bc, v_inv, v_buyer
  FROM public.order_invoices oi JOIN public.bookings b ON b.barcode = oi.barcode
  WHERE oi.invoice_no IS NOT NULL AND b.user_id IS NOT NULL
  ORDER BY oi.created_at DESC LIMIT 1;
  IF v_bc IS NULL THEN RAISE EXCEPTION 'فشل ⑤: لا فاتورةَ مرقّمة.'; END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_hit FROM jsonb_array_elements(
    (public.browse_bookings('buyer','all', replace(v_inv,'-',''), NULL, NULL, 50))->'rows') e
   WHERE e->>'barcode' = v_bc;
  EXECUTE 'RESET ROLE';

  IF v_hit <> 1 THEN
    RAISE EXCEPTION 'فشل ⑤: بحثُ الطلبات انكسر بإعادة البناء (عدد=%).', v_hit;
  END IF;
  RAISE NOTICE '⑤ بحثُ الطلبات سليمٌ بعد إعادة بنائه على القاعدة الواحدة.';
END $v5$;

-- ⑥ ومحرفُ البدل لا يبلغ النمطَ: `taki_norm('%')` عدمٌ ⇒ البحثُ بلا مرشّح
-- 🪤 وهذا الفحصُ يُثبّت **سببَ** عدم الحاجة للتهريب، فإن تغيّرت `taki_norm`
--    يوماً فأعادت الرموزَ، سقط هنا قبل أن يصير `%` محرفَ بدلٍ في الإنتاج.
DO $v6$
BEGIN
  IF public.taki_norm('%') IS NOT NULL OR public.taki_norm('a%b') <> 'a b'
     OR public.taki_norm('a_b') <> 'a b' THEN
    RAISE EXCEPTION 'فشل ⑥: taki_norm لم تعد تمسح محارفَ LIKE — يلزم تهريبٌ صريح الآن.';
  END IF;
  RAISE NOTICE '⑥ taki_norm تمسح %% و_ و\\ ⇒ لا محرفَ بدلٍ يبلغ نمطَ LIKE.';
END $v6$;
