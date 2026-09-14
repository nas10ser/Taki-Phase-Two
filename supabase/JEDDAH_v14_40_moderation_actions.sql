-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.40 — الإدارة تتصرّف في المحتوى المخالف (طلب ناصر ٢، المتبقّي)
-- ════════════════════════════════════════════════════════════════════════════
-- يصل إنذارٌ آليّ «🏷 اسم/وصف عرض يحوي لفظاً محظوراً»، فيرى ناصر النصّ و**لا
-- زرّ يزيل العرض ولا رابط يفتحه** — عليه أن يبحث عنه يدوياً في المتاجر. ولو
-- أراد حذفه فلا يستطيع: سياسة الحذف على `deals` للمالك وحده.
-- ومثله تقييمٌ مسيء: لا إجراء إطلاقاً.
--
-- 🪤 والسبب الجذري أن `moderation_flags` **لا تحفظ مرجعاً للصفّ المخالف**:
-- تحفظ نصّه ومصدره وصاحبه، ولا تحفظ أيّ صفٍّ هو. فلا رابط ولا إجراء ممكن أصلاً.
--
-- وثلاثة مبادئ:
--   • **الإخفاء لا الحذف** للعروض (قرار ناصر العاشر: «لا تحذف اي شيء»).
--     `paused` تُخفيه عن الجميع وتُبقيه وطلباته وفواتيره كما هي.
--   • **الحذف الناعم** للتقييم (`deleted_at`) — العمود موجود وتقرؤه الاستعلامات.
--   • **السبب إلزامي** ويصل صاحبَ المحتوى، ويُسجَّل إنذاراً في سجلّه.
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

ALTER TABLE public.moderation_flags ADD COLUMN IF NOT EXISTS ref_id text;
COMMENT ON COLUMN public.moderation_flags.ref_id IS
  'مرجع الصفّ المخالف: deal.id أو rating.id أو booking.barcode بحسب `source` (v14.40).';

CREATE OR REPLACE FUNCTION public.taki_scan_text_tr()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_content text;
  v_source text;
  v_store text;
  v_offender text;
  v_matched text[];
  v_ref text;
BEGIN
  BEGIN
    IF TG_TABLE_NAME = 'booking_messages' THEN
      v_content := NEW.body;
      v_source := 'chat';
      v_offender := NEW.sender_id;
      v_ref := NEW.barcode;
      SELECT b.store_id INTO v_store FROM bookings b WHERE b.barcode = NEW.barcode LIMIT 1;
    ELSIF TG_TABLE_NAME = 'ratings' THEN
      IF TG_OP = 'UPDATE' AND NEW.comment IS NOT DISTINCT FROM OLD.comment THEN RETURN NEW; END IF;
      v_content := NEW.comment;
      v_source := 'rating';
      v_offender := NEW.user_id;
      v_store := NEW.store_id;
      v_ref := NEW.id::text;
    ELSE -- deals
      IF TG_OP = 'UPDATE'
         AND NEW.item_name IS NOT DISTINCT FROM OLD.item_name
         AND NEW.description IS NOT DISTINCT FROM OLD.description THEN RETURN NEW; END IF;
      v_content := coalesce(NEW.item_name,'') || ' — ' || coalesce(NEW.description,'');
      v_source := 'deal';
      v_offender := NEW.store_id;
      v_store := NEW.store_id;
      v_ref := NEW.id::text;
    END IF;

    v_matched := public.taki_match_terms(v_content);
    IF array_length(v_matched, 1) IS NULL THEN RETURN NEW; END IF;

    -- v14.40 — `ref_id`: بلا مرجعٍ للصفّ المخالف لا يستطيع الأدمن فتح المحتوى
    -- ولا إخفاءه — يقرأ النصّ ويبحث عنه يدوياً في المتاجر.
    INSERT INTO moderation_flags (kind, source, ref_id, store_id, offender_id, offender_name, content, matched)
    VALUES ('text', v_source, v_ref, v_store, v_offender,
            (SELECT coalesce(u.shop, u.name) FROM users u WHERE u.id = v_offender),
            left(v_content, 500), v_matched);
  EXCEPTION WHEN OTHERS THEN
    NULL;   -- moderation must never break chat/rating/deal writes
  END;
  RETURN NEW;
END $function$;


-- ── إخفاء عرض / إعادته ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_hide_deal(
  p_deal_id text, p_hide boolean, p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_d public.deals%ROWTYPE; v_msg text;
BEGIN
  IF NOT public.taki_admin_perm('action_delete_deals') THEN
    RAISE EXCEPTION 'ليست لديك صلاحية إخفاء العروض';
  END IF;
  SELECT * INTO v_d FROM public.deals WHERE id = p_deal_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF p_hide AND COALESCE(btrim(p_reason),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  -- 🪤 `tr_guard_deal_publish` يرفض أي `UPDATE OF status` من العميل، وهذه دالة
  -- مالكة فتتجاوزه. ولا نحذف: الإخفاء يُبقي الطلبات والفواتير المرتبطة سليمة.
  UPDATE public.deals SET status = CASE WHEN p_hide THEN 'paused' ELSE 'active' END
   WHERE id = p_deal_id;

  v_msg := CASE WHEN p_hide
    THEN '🚫 أخفت إدارة تاكي عرضك «' || COALESCE(v_d.item_name,'') || '» — ' || btrim(p_reason)
         || '. عدّله ثم راسل الإدارة لإعادته.'
    ELSE '✅ أُعيد عرضك «' || COALESCE(v_d.item_name,'') || '» للظهور.' END;

  IF p_hide THEN
    INSERT INTO public.user_warnings (user_id, user_role, reason, admin_id)
    VALUES (v_d.store_id, 'seller', v_msg, auth.uid()::text);
  END IF;
  INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
  VALUES (v_d.store_id, CASE WHEN p_hide THEN '🚫 إخفاء عرض' ELSE '✅ إعادة عرض' END,
          CASE WHEN p_hide THEN '🚫 Deal hidden' ELSE '✅ Deal restored' END,
          v_msg, v_msg, 'system',
          jsonb_build_object('audience','seller','dealId', p_deal_id,
                             'actionUrl','/deal/'||p_deal_id,'action_url','/deal/'||p_deal_id));
  RETURN jsonb_build_object('ok', true, 'hidden', p_hide);
END $$;

-- ── حذف تقييم (ناعماً) ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_delete_rating(
  p_rating_id text, p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_r public.ratings%ROWTYPE; v_msg text;
BEGIN
  IF NOT public.taki_admin_perm('action_delete_deals') THEN
    RAISE EXCEPTION 'ليست لديك صلاحية حذف التقييمات';
  END IF;
  IF COALESCE(btrim(p_reason),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;
  SELECT * INTO v_r FROM public.ratings WHERE id = p_rating_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_r.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_DELETED');
  END IF;

  -- حذفٌ ناعم: المتوسط والعدد على `deals` يُعاد حسابهما بمشغّل التقييمات،
  -- والصفّ يبقى دليلاً على ما جرى.
  UPDATE public.ratings SET deleted_at = now() WHERE id = p_rating_id;

  v_msg := '🚫 حذفت إدارة تاكي تقييمك — ' || btrim(p_reason) || '.';
  INSERT INTO public.user_warnings (user_id, user_role, reason, admin_id)
  VALUES (v_r.user_id, 'buyer', v_msg, auth.uid()::text);
  INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
  VALUES (v_r.user_id, '🚫 حذف تقييم', '🚫 Review removed', v_msg, v_msg, 'system',
          jsonb_build_object('audience','user'));
  RETURN jsonb_build_object('ok', true);
END $$;

DO $g$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['admin_hide_deal(text,boolean,text)','admin_delete_rating(text,text)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END
$g$;

INSERT INTO public.admin_rpc_permissions (rpc_name, required_perm) VALUES
  ('admin_hide_deal','action_delete_deals'), ('admin_delete_rating','action_delete_deals')
ON CONFLICT (rpc_name) DO UPDATE SET required_perm = EXCLUDED.required_perm;

-- ── اسم المتجر يدخل الرقابة الآلية ─────────────────────────────────────────
-- كان **الحقل الوحيد الذي يُنتحَل هو الحقل الوحيد غير المفحوص**: الماسح يقرأ
-- اسم العرض ووصفه ولا يمسّ اسم المتجر. الآن يُفحص الاسم المطلوب قبل أن يصل
-- طابور الموافقة أصلاً.
CREATE OR REPLACE FUNCTION public.merchant_request_store_name(p_name text, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  text := auth.uid()::text;
  v_name text := btrim(COALESCE(p_name, ''));
  v_cur  text; v_type text; v_id text; v_bad text[];
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT COALESCE(shop, name), user_type INTO v_cur, v_type FROM public.users WHERE id = v_uid;
  IF v_type NOT IN ('seller','admin') THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_A_MERCHANT'); END IF;
  IF length(v_name) < 2 OR length(v_name) > 60 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_NAME');
  END IF;
  IF v_name = COALESCE(v_cur, '') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SAME_NAME');
  END IF;
  v_bad := public.taki_match_terms(v_name);
  IF array_length(v_bad, 1) IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_WORDS');
  END IF;
  IF EXISTS (SELECT 1 FROM public.users u
             WHERE u.id <> v_uid AND u.deleted_at IS NULL
               AND public.taki_norm(COALESCE(u.shop,'')) = public.taki_norm(v_name)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NAME_TAKEN');
  END IF;
  IF EXISTS (SELECT 1 FROM public.store_name_requests
             WHERE store_id = v_uid AND status = 'requested') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_PENDING');
  END IF;

  INSERT INTO public.store_name_requests (store_id, current_name, wanted_name, reason)
  VALUES (v_uid, v_cur, v_name, NULLIF(btrim(COALESCE(p_reason,'')), ''))
  RETURNING id INTO v_id;

  INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
  SELECT a.id, '🏷 طلب تغيير اسم متجر', '🏷 Store rename request',
         COALESCE(v_cur,'—') || ' ← ' || v_name, COALESCE(v_cur,'—') || ' → ' || v_name,
         'system', jsonb_build_object('audience','admin','actionUrl','/admin?tab=sellers',
                                      'action_url','/admin?tab=sellers','nameRequestId', v_id)
  FROM public.users a WHERE a.user_type = 'admin' AND a.deleted_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'status', 'requested');
END $$;
REVOKE ALL ON FUNCTION public.merchant_request_store_name(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_request_store_name(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_request_store_name(text, text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق
-- ════════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS الفحص,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ مختبر طوكيو'
            ELSE '✅ جدة (الإنتاج)' END AS النتيجة
UNION ALL SELECT 'مرجع المحتوى المخالف',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
                         AND table_name='moderation_flags' AND column_name='ref_id')
            THEN '✅ موجود' ELSE '❌ مفقود' END
UNION ALL SELECT 'الماسح يكتبه',
       CASE WHEN pg_get_functiondef(to_regprocedure('public.taki_scan_text_tr()')) LIKE '%v_ref%'
            THEN '✅ نعم' ELSE '❌ لا' END
UNION ALL SELECT 'إخفاء العرض',
       CASE WHEN to_regprocedure('public.admin_hide_deal(text,boolean,text)') IS NOT NULL
            THEN '✅ موجود' ELSE '❌ مفقود' END
UNION ALL SELECT 'حذف التقييم',
       CASE WHEN to_regprocedure('public.admin_delete_rating(text,text)') IS NOT NULL
            THEN '✅ موجود' ELSE '❌ مفقود' END
UNION ALL SELECT 'كلاهما محروس بالصلاحية',
       (SELECT count(*)::text || '/2' FROM admin_rpc_permissions
        WHERE rpc_name IN ('admin_hide_deal','admin_delete_rating')
          AND required_perm = 'action_delete_deals')
UNION ALL SELECT 'اسم المتجر يُفحص رقابياً',
       CASE WHEN pg_get_functiondef(to_regprocedure('public.merchant_request_store_name(text,text)'))
                 LIKE '%taki_match_terms%' THEN '✅ نعم' ELSE '❌ لا' END;
