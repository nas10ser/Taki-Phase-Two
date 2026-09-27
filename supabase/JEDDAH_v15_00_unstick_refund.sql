-- ═══════════════════════════════════════════════════════════════════════════
-- v15.00 — استردادٌ عالقٌ يحتاج مبرمجاً ليس ميزةً، بل عيبُ تشغيل
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 العيب الذي يُغلقه هذا الملفّ، وقد كُشف في مراجعةِ v14.97 قبل شحنها:
--    حين يُنادي `merchant-pay` بوّابةَ الدفع **بعد** أن حجز الصفّ
--    (`refund_state='claiming'`) ثمّ يموت الاتصال أو يردّ المزوّد حالةً
--    ملتبسة، تبقى النتيجة **مجهولة**: قد يكون المال خرج وقد لا يكون.
--    وقرارُ التصميم هناك صحيح: **لا يُحرَّر الحجز تلقائياً** — لأن تحريره
--    يعني أن نقرةً ثانية قد تُخرج المبلغ مرّةً ثانية، وأربعةٌ من ستّ بوّابات
--    (ميسر · تاب · باي‑تابس · هايبر‑باي) **لا تدعم مفتاح تكرارٍ إطلاقاً**.
--    فطلبٌ عالقٌ أرخص من خصمٍ مزدوج.
--
--    لكنّ الحجز كان **بلا مخرج**: `taki_settle_booking_refund` ممنوحةٌ
--    لـ`service_role` وحده، فلا المتصفّح يناديها ولا شاشةَ إدارةٍ تفعل.
--    أي أن ناصراً — وهو غير مبرمج — يبقى أمام طلبٍ مجمّد وتاجرٍ ينتظر
--    ومشترٍ لا يعلم، ولا يملك إلا أن ينادي مبرمجاً. وهذا وحده سببٌ كافٍ:
--    **كل حالةٍ تُنتجها المنصّة يجب أن يكون لناصر منها مخرجٌ بضغطة.**
--
-- وما يبنيه هذا الملفّ ليس «تحريراً تلقائياً» — بل **قراراً بشرياً مسجَّلاً**:
--   ناصر يفتح كشف حساب البوّابة، ينظر هل خرج المال أم لا، ثمّ يقول أيّهما.
--   والدالّة تكتب قرارَه ومن اتّخذه ومتى وبأي حجّة، ولا تخمّن شيئاً.
--
-- 🪤 ولماذا لا يُمنح التاجرُ هذا الزرّ: لأن الحالة العالقة تعني «قد يكون المال
--    خرج». والتاجر صاحبُ مصلحةٍ في أن يقول «لم يخرج» ليُعيد المحاولة، فيخرج
--    مرّتين. القرارُ عند طرفٍ محايد — ولذلك صلاحيةُ المال لا صلاحيةُ المتاجر.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── حارس: هذه هجرة إنتاج (جدّة) ────────────────────────────────────────────
DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_settle_booking_refund(text,boolean,text,text)') IS NULL THEN
    RAISE EXCEPTION 'v14.97 لم تُطبَّق بعد — لا شيء لأفكّه. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_admin_perm(text)') IS NULL THEN
    RAISE EXCEPTION 'taki_admin_perm غائبة — أوقِفت قبل أن أبني حارساً على فراغ.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) قائمةُ العالقين — ما يراه ناصر قبل أن يقرّر
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.admin_stuck_refunds(int);
CREATE FUNCTION public.admin_stuck_refunds(p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_rows jsonb;
BEGIN
  IF NOT (public.taki_admin_perm('action_view_finance') OR public.taki_admin_perm('tab_launch')) THEN
    RAISE EXCEPTION 'forbidden: action_view_finance required';
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'claimed_at'), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'barcode',      b.barcode,
      'claimed_at',   b.refund_claimed_at,
      -- 🪤 العمر يُحسب على الخادم لا في المتصفّح: جهازُ ناصر قد يكون على
      --    توقيتٍ آخر، و«منذ كم» رقمٌ يُبنى عليه قرارٌ ماليّ.
      'age_minutes',  GREATEST(0, floor(extract(epoch FROM (now() - b.refund_claimed_at)) / 60))::int,
      'amount',       COALESCE(b.refund_amount, b.paid_amount, b.total_amount),
      'provider',     b.payment_provider,
      'payment_ref',  b.payment_ref,
      'reason',       b.refund_reason,
      'store_id',     b.store_id,
      'store_name',   COALESCE(NULLIF(btrim(u.shop), ''), NULLIF(btrim(u.name), ''), '—'),
      'buyer_name',   COALESCE(NULLIF(btrim(b.user_name), ''), '—'),
      'buyer_phone',  b.user_phone,
      'item',         COALESCE(d.item_name, '—')
    ) AS x
    FROM public.bookings b
    LEFT JOIN public.users u ON u.id = b.store_id
    LEFT JOIN public.deals d ON d.id = b.deal_id
    WHERE b.refund_state = 'claiming'
    ORDER BY b.refund_claimed_at
    LIMIT GREATEST(1, LEAST(200, COALESCE(p_limit, 50)))
  ) s;

  RETURN jsonb_build_object('ok', true, 'rows', v_rows,
                            'count', jsonb_array_length(v_rows));
END
$fn$;

REVOKE ALL ON FUNCTION public.admin_stuck_refunds(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_stuck_refunds(int) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_stuck_refunds(int) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) المخرج — قرارٌ بشريّ، لا تخمين
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.admin_unstick_refund(text,text,text,text);
CREATE FUNCTION public.admin_unstick_refund(
  p_barcode    text,
  p_outcome    text,            -- 'refunded' = خرج المال · 'failed' = لم يخرج
  p_note       text,            -- حجّةُ القرار: ما الذي رآه ناصر في كشف البوّابة
  p_refund_ref text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_b public.bookings%ROWTYPE; v_note text; v_res jsonb; v_uid text;
BEGIN
  v_uid := (SELECT auth.uid())::text;
  IF NOT (public.taki_admin_perm('action_view_finance') OR public.taki_admin_perm('tab_launch')) THEN
    RAISE EXCEPTION 'forbidden: action_view_finance required';
  END IF;
  IF p_outcome NOT IN ('refunded', 'failed') THEN
    RAISE EXCEPTION 'BAD_OUTCOME';
  END IF;

  v_note := btrim(COALESCE(p_note, ''));
  -- 🪤 الحجّة إلزامية لا تجميل: هذا القرار يقول «المال خرج» أو «لم يخرج» بلا
  --    دليلٍ من النظام نفسه، فمصدرُه الوحيد ما رآه إنسانٌ في كشف البوّابة.
  --    وبعد شهرٍ لن يتذكّر أحدٌ لماذا — فتُكتب الآن أو لا يُتّخذ القرار.
  IF length(v_note) < 10 THEN
    RAISE EXCEPTION 'NOTE_REQUIRED';
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE barcode = p_barcode FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  -- لا يُفكّ إلا العالق: طلبٌ اكتمل ردُّه أو لم يُطلب ردُّه أصلاً لا يُمسّ.
  IF COALESCE(v_b.refund_state, '') <> 'claiming' THEN
    RAISE EXCEPTION 'NOT_STUCK';
  END IF;

  -- التسويةُ تمرّ بنفس الدالّة التي يمرّ بها المسار الطبيعيّ — لا مسارَ ثانياً
  -- يكتب الحالة بيده، وإلا انحرف المساران (وردُّ الكمّية وإشعارُ المشتري
  -- وإشعارُ الدائن كلُّها هناك).
  v_res := public.taki_settle_booking_refund(
             p_barcode,
             (p_outcome = 'refunded'),
             p_refund_ref,
             'فُكَّ يدوياً من الإدارة: ' || v_note);

  INSERT INTO public.activity_log (user_id, user_type, action, entity_type, entity_id, metadata)
  VALUES (v_uid, 'admin', 'refund_unstuck', 'booking', p_barcode,
          jsonb_build_object('outcome', p_outcome, 'note', v_note,
                             'refund_ref', p_refund_ref,
                             'amount', COALESCE(v_b.refund_amount, v_b.paid_amount),
                             'provider', v_b.payment_provider,
                             'stuck_minutes',
                             GREATEST(0, floor(extract(epoch FROM (now() - v_b.refund_claimed_at)) / 60))::int));

  RETURN jsonb_build_object('ok', true, 'outcome', p_outcome, 'settle', v_res);
END
$fn$;

REVOKE ALL ON FUNCTION public.admin_unstick_refund(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_unstick_refund(text,text,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_unstick_refund(text,text,text,text) TO authenticated;

-- 🪤 `taki_settle_booking_refund` ممنوحةٌ لـ`service_role` وحده، وهذه الدالّة
--    `SECURITY DEFINER` فتناديها بصلاحيّة مالكها — فلا يلزم توسيعُ منحِ تلك.
--    (ولو مُنحت لـ`authenticated` لصار كلُّ مستخدمٍ يختم طلباً «مُردّاً».)

-- ── تسجيلُ الصلاحية كما تفعل بقيّة دوال الإدارة ────────────────────────────
DELETE FROM public.admin_rpc_permissions
 WHERE rpc_name IN ('admin_stuck_refunds', 'admin_unstick_refund');
INSERT INTO public.admin_rpc_permissions (rpc_name, required_perm) VALUES
  ('admin_stuck_refunds',  'action_view_finance'),
  ('admin_unstick_refund', 'action_view_finance');

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) تحقّقٌ يرفع استثناءً — ويُقاس السلوك لا الوجود
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE v_err text; v_ok boolean; n int; v_admin text; v_any text;
BEGIN
  -- (أ) الدالّتان موجودتان بالمنح الصحيح
  IF to_regprocedure('public.admin_stuck_refunds(integer)') IS NULL
     OR to_regprocedure('public.admin_unstick_refund(text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '❌ إحدى الدالّتين لم تُنشأ.';
  END IF;
  IF has_function_privilege('anon', 'public.admin_unstick_refund(text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ الزائر يستطيع فكّ استرداد — منحُ anon لم يُلغَ.';
  END IF;
  IF has_function_privilege('authenticated', 'public.taki_settle_booking_refund(text,boolean,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ التسوية ممنوحةٌ لكل موثَّق — أي مستخدمٍ يختم طلباً «مُردّاً».';
  END IF;

  -- (ب) 🪤 حارسُ الصلاحية يسبق كلَّ تحقّقٍ آخر — وهذا صحيح أمنياً، لكنه
  --     يعني أن جلسة `psql` (بلا `auth.uid()`) **لا تستطيع** بلوغ التحقّقات
  --     الداخلية: تُرفض عند الباب. وهذا بعينه ما أوقعني في v14.96 حين ظننتُ
  --     فحصاً ناجحاً وهو لم يبلغ ما يفحصه. فتُنتحَل هويّةُ أدمنٍ حقيقيّ.
  SELECT id INTO v_admin FROM public.users
   WHERE user_type = 'admin' AND COALESCE(is_super_admin, false) AND deleted_at IS NULL
   LIMIT 1;

  -- أوّلاً: يُثبَت أن الباب مقفل أصلاً (جلسةٌ بلا هويّة)
  BEGIN
    PERFORM public.admin_unstick_refund('__لا_وجود_له__', 'refunded', 'حجّةٌ طويلةٌ بما يكفي للقبول');
    v_err := '(مرّت!)';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF position('forbidden' IN v_err) = 0 THEN
    RAISE EXCEPTION '❌ جلسةٌ بلا صلاحية لم تُرفض — بل «%»', v_err;
  END IF;

  IF v_admin IS NULL THEN
    RAISE NOTICE 'ℹ️ لا أدمن أعلى على هذا الخادم — التحقّقات الداخلية لم تُقَس.';
  ELSE
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    BEGIN
      PERFORM public.admin_unstick_refund('__لا_وجود_له__', 'refunded', 'قصيرة');
      v_err := '(مرّت!)';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    IF v_err <> 'NOTE_REQUIRED' THEN
      RESET ROLE; PERFORM set_config('request.jwt.claims', NULL, true);
      RAISE EXCEPTION '❌ الحجّةُ القصيرة لم تُرفض بـNOTE_REQUIRED بل بـ«%»', v_err;
    END IF;

    BEGIN
      PERFORM public.admin_unstick_refund('__لا_وجود_له__', 'maybe', 'حجّةٌ طويلةٌ بما يكفي للقبول');
      v_err := '(مرّت!)';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    IF v_err <> 'BAD_OUTCOME' THEN
      RESET ROLE; PERFORM set_config('request.jwt.claims', NULL, true);
      RAISE EXCEPTION '❌ نتيجةٌ غير معروفة لم تُرفض بـBAD_OUTCOME بل بـ«%»', v_err;
    END IF;

    BEGIN
      PERFORM public.admin_unstick_refund('__لا_وجود_له__', 'refunded', 'حجّةٌ طويلةٌ بما يكفي للقبول');
      v_err := '(مرّت!)';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    IF v_err <> 'NOT_FOUND' THEN
      RESET ROLE; PERFORM set_config('request.jwt.claims', NULL, true);
      RAISE EXCEPTION '❌ طلبٌ غير موجود لم يُرفض بـNOT_FOUND بل بـ«%»', v_err;
    END IF;

    -- (ج) طلبٌ قائمٌ غيرُ عالق لا يُمسّ — أخطرُ فحصٍ هنا
    SELECT barcode INTO v_any FROM public.bookings
     WHERE COALESCE(refund_state,'') <> 'claiming' LIMIT 1;
    IF v_any IS NOT NULL THEN
      BEGIN
        PERFORM public.admin_unstick_refund(v_any, 'refunded', 'حجّةٌ طويلةٌ بما يكفي للقبول');
        v_err := '(مرّت!)';
      EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
      END;
      IF v_err <> 'NOT_STUCK' THEN
        RESET ROLE; PERFORM set_config('request.jwt.claims', NULL, true);
        RAISE EXCEPTION '❌ طلبٌ غيرُ عالقٍ لم يُرفض بـNOT_STUCK بل بـ«%» — خطرُ ختمِ طلبٍ سليم.', v_err;
      END IF;
    END IF;

    -- والقائمة تُقاس بنفس الهويّة — فهي محروسةٌ بنفس الصلاحية.
    SELECT (public.admin_stuck_refunds(5) ->> 'ok')::boolean INTO v_ok;
    IF NOT COALESCE(v_ok, false) THEN
      RESET ROLE; PERFORM set_config('request.jwt.claims', NULL, true);
      RAISE EXCEPTION '❌ قائمة العالقين لا تعمل بهويّة أدمن.';
    END IF;

    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);
    RAISE NOTICE '✅ التحقّقات الداخلية والقائمة مقيسةٌ بهويّة أدمن حقيقيّ.';
  END IF;

  -- وبلا هويّة: القائمة تُرفض أيضاً (نفس الباب)
  BEGIN
    PERFORM public.admin_stuck_refunds(5);
    v_err := '(مرّت!)';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF position('forbidden' IN v_err) = 0 THEN
    RAISE EXCEPTION '❌ القائمة مفتوحةٌ بلا صلاحية — «%»', v_err;
  END IF;

  SELECT count(*) INTO n FROM public.admin_rpc_permissions
   WHERE rpc_name IN ('admin_stuck_refunds','admin_unstick_refund');
  IF n <> 2 THEN RAISE EXCEPTION '❌ الصلاحيتان لم تُسجَّلا (%/2).', n; END IF;

  RAISE NOTICE '✅ v15.00: لكل استردادٍ عالقٍ مخرجٌ بقرارٍ بشريٍّ مسجَّل — وحجّةٌ إلزامية، ولا يُمسّ طلبٌ سليم.';
END
$verify$;
