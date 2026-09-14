-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.36 — اسم المتجر: مصدرٌ واحد، وتغييرٌ بموافقة الإدارة (طلب ناصر ٨)
-- ════════════════════════════════════════════════════════════════════════════
-- هذه هي علّة بلاغ ناصر القديم «اسم المتجر القديم يظهر عند الحجز».
--
-- الاسم له **مصدران مستقلّان**:
--   `users.shop`      — الاسم الحقيقي، يقرؤه صفحة المتجر والبوت
--   `deals.shop_name` — عمودٌ ثانٍ NOT NULL، **يكتبه التاجر بيده في نموذج كل
--                        عرض**، ويُجمَّد يوم النشر ولا يتحدّث أبداً
-- فالتاجر يغيّر اسمه ويقرأ «✅ تم حفظ الاسم»، ثم يرى اسمه القديم على عروضه هو،
-- وعلى بطاقاتها في الرئيسية، وفي فاتورة البوت. وعدٌ بما لا يقع.
--
-- 🔴 وأخطر: الحقل نصٌّ حرّ **بلا أي فحص**. أي تاجر مشترك يستطيع نشر عرضٍ اسم
-- متجره فيه «ستاربكس» أو «نون» أو علامة منافس. ولا فهرس فريد على `users.shop`
-- أصلاً، فحسابان يحملان نفس العلامة. والرقابة الآلية تمسح اسم العرض ووصفه
-- **ولا تمسّ اسم المتجر** — الحقل الوحيد الذي يُنتحَل هو الحقل الوحيد غير المفحوص.
--
-- العلاج، وقرار ناصر: **التوثيق أولاً — التغيير يمرّ بموافقة الإدارة.**
--   ١. `deals.shop_name` يصير **مشتقّاً**: مشغّل يكتبه من `users.shop` عند كل
--      إدراج أو تحديث. لا يُزال العمود (يقرؤه كودٌ كثير) لكنه لم يعد يُكتب يدوياً.
--   ٢. طلب تغيير الاسم يمرّ بطابور موافقة على شكل `booking_refunds` نفسه.
--   ٣. الاسم يدخل الرقابة الآلية كبقيّة النصوص.
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

-- ── ١. اسم العرض مشتقٌّ من اسم المتجر، لا يُكتب يدوياً ──────────────────────
CREATE OR REPLACE FUNCTION public.taki_sync_deal_shop_name()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_name text;
BEGIN
  SELECT COALESCE(NULLIF(btrim(u.shop), ''), NULLIF(btrim(u.name), ''), 'متجر')
    INTO v_name FROM public.users u WHERE u.id = NEW.store_id;
  NEW.shop_name := COALESCE(v_name, 'متجر');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_ab_sync_deal_shop_name ON public.deals;
CREATE TRIGGER tr_ab_sync_deal_shop_name
  BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.taki_sync_deal_shop_name();

-- ── ٢. تغيير الاسم لاحقاً يجري على كل عروض المتجر ───────────────────────────
CREATE OR REPLACE FUNCTION public.taki_propagate_store_name()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.shop IS DISTINCT FROM OLD.shop THEN
    UPDATE public.deals
       SET shop_name = COALESCE(NULLIF(btrim(NEW.shop), ''), NULLIF(btrim(NEW.name), ''), 'متجر')
     WHERE store_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_zz_propagate_store_name ON public.users;
CREATE TRIGGER tr_zz_propagate_store_name
  AFTER UPDATE OF shop ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.taki_propagate_store_name();

-- ── ٣. تصحيح ما جُمّد سابقاً ────────────────────────────────────────────────
UPDATE public.deals d
   SET shop_name = COALESCE(NULLIF(btrim(u.shop), ''), NULLIF(btrim(u.name), ''), 'متجر')
  FROM public.users u
 WHERE u.id = d.store_id
   AND d.shop_name IS DISTINCT FROM COALESCE(NULLIF(btrim(u.shop), ''), NULLIF(btrim(u.name), ''), 'متجر');

-- ── ٤. طابور موافقة تغيير الاسم ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_name_requests (
  id           text PRIMARY KEY DEFAULT ('snr_' || replace(gen_random_uuid()::text, '-', '')),
  store_id     text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  current_name text,
  wanted_name  text NOT NULL,
  status       text NOT NULL DEFAULT 'requested'
               CHECK (status IN ('requested','approved','rejected','withdrawn')),
  reason       text,
  admin_note   text,
  admin_id     text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_snr_store  ON public.store_name_requests (store_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_snr_open   ON public.store_name_requests (status) WHERE status = 'requested';
-- طلبٌ مفتوح واحد لكل متجر: طابورٌ يتكدّس فيه عشرة طلبات لنفس المتجر لا يُبتّ فيه.
CREATE UNIQUE INDEX IF NOT EXISTS idx_snr_one_open
  ON public.store_name_requests (store_id) WHERE status = 'requested';

ALTER TABLE public.store_name_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS snr_select_own ON public.store_name_requests;
CREATE POLICY snr_select_own ON public.store_name_requests FOR SELECT TO authenticated
  USING ((SELECT auth.uid())::text = store_id OR (SELECT public.is_admin()));
-- لا سياسة كتابة: كل تغيير يمرّ بالدوال أدناه.

-- ── ٥. التاجر يطلب ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.merchant_request_store_name(p_name text, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  text := auth.uid()::text;
  v_name text := btrim(COALESCE(p_name, ''));
  v_cur  text; v_type text; v_id text;
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
  -- انتحال علامة قائمة: يُرفض قبل أن يصل الطابور أصلاً.
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

-- ── ٦. الإدارة تبتّ ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_resolve_store_name(
  p_id text, p_approve boolean, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE r public.store_name_requests%ROWTYPE; v_msg text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;
  SELECT * INTO r FROM public.store_name_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF r.status <> 'requested' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_DECIDED', 'status', r.status);
  END IF;

  IF p_approve THEN
    -- المشغّل على `users.shop` ينشر الاسم على كل عروض المتجر تلقائياً.
    UPDATE public.users SET shop = r.wanted_name WHERE id = r.store_id;
    v_msg := '✅ اعتُمد اسم متجرك الجديد: ' || r.wanted_name;
  ELSE
    v_msg := '❌ لم يُعتمد تغيير اسم متجرك إلى «' || r.wanted_name || '»'
             || CASE WHEN COALESCE(btrim(p_note),'') <> '' THEN ' — ' || btrim(p_note) ELSE '' END || '.';
  END IF;

  UPDATE public.store_name_requests
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         admin_note = NULLIF(btrim(COALESCE(p_note,'')), ''),
         admin_id = auth.uid()::text, decided_at = now()
   WHERE id = p_id;

  INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
  VALUES (r.store_id, CASE WHEN p_approve THEN '✅ اسم المتجر' ELSE '❌ اسم المتجر' END,
          CASE WHEN p_approve THEN '✅ Store name' ELSE '❌ Store name' END,
          v_msg, v_msg, 'system', jsonb_build_object('audience','seller'));

  RETURN jsonb_build_object('ok', true, 'approved', p_approve);
END $$;
REVOKE ALL ON FUNCTION public.admin_resolve_store_name(text, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_resolve_store_name(text, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_store_name(text, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_store_name_requests(p_status text DEFAULT 'requested')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.requested_at DESC), '[]'::jsonb) INTO v
  FROM (SELECT r.*, u.name AS owner_name, u.phone AS owner_phone
        FROM public.store_name_requests r JOIN public.users u ON u.id = r.store_id
        WHERE p_status IS NULL OR r.status = p_status) t;
  RETURN jsonb_build_object('ok', true, 'rows', v);
END $$;
REVOKE ALL ON FUNCTION public.admin_list_store_name_requests(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_store_name_requests(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_store_name_requests(text) TO authenticated;

-- ── ٧. التاجر لا يغيّر الاسم مباشرةً بعد اليوم ──────────────────────────────
CREATE OR REPLACE FUNCTION public.taki_guard_store_rename()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.shop IS DISTINCT FROM OLD.shop
     AND NOT COALESCE(public.is_admin(), false)
     -- الدوال المالكة (طابور الموافقة) تعمل بلا `auth.uid()` أو بهوية الأدمن،
     -- وهذا الشرط يسمح لها ويمنع التاجر من الكتابة المباشرة من المتصفّح.
     AND auth.uid()::text = NEW.id THEN
    RAISE EXCEPTION 'تغيير اسم المتجر يمرّ بموافقة إدارة تاكي — أرسل طلباً من لوحة التاجر.'
      USING ERRCODE = 'P0020';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_ab_guard_store_rename ON public.users;
CREATE TRIGGER tr_ab_guard_store_rename
  BEFORE UPDATE OF shop ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.taki_guard_store_rename();

-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق
-- ════════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS الفحص,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ مختبر طوكيو'
            ELSE '✅ جدة (الإنتاج)' END AS النتيجة
UNION ALL SELECT 'اسم العرض مشتقّ',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.deals'::regclass
                         AND tgname='tr_ab_sync_deal_shop_name') THEN '✅ مشغّل' ELSE '❌ مفقود' END
UNION ALL SELECT 'تغيير الاسم ينتشر على العروض',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.users'::regclass
                         AND tgname='tr_zz_propagate_store_name') THEN '✅ مشغّل' ELSE '❌ مفقود' END
UNION ALL SELECT 'لا عرضَ يحمل اسماً قديماً',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM public.deals d JOIN public.users u ON u.id = d.store_id
              WHERE d.shop_name IS DISTINCT FROM
                    COALESCE(NULLIF(btrim(u.shop),''), NULLIF(btrim(u.name),''), 'متجر'))
            THEN '✅ صُحّحت كلها' ELSE '❌ ما زال هناك اختلاف' END
UNION ALL SELECT 'طابور الموافقة',
       CASE WHEN to_regclass('public.store_name_requests') IS NOT NULL THEN '✅ موجود' ELSE '❌ مفقود' END
UNION ALL SELECT 'حارس التغيير المباشر',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.users'::regclass
                         AND tgname='tr_ab_guard_store_rename') THEN '✅ مشغّل' ELSE '❌ مفقود' END
UNION ALL SELECT 'دوال الطابور الثلاث',
       CASE WHEN to_regprocedure('public.merchant_request_store_name(text,text)') IS NOT NULL
             AND to_regprocedure('public.admin_resolve_store_name(text,boolean,text)') IS NOT NULL
             AND to_regprocedure('public.admin_list_store_name_requests(text)') IS NOT NULL
            THEN '✅ الثلاث' ELSE '❌ ناقصة' END;
