-- ════════════════════════════════════════════════════════════════════════════
-- JEDDAH v16.30 — بحثٌ في طابور التوثيق (آخرُ قائمةٍ مُرقَّمة بلا بحث)
-- ════════════════════════════════════════════════════════════════════════════
-- أمرُ ناصر: «كمّل جميعها». وجُرِد كلُّ شاشةٍ تعرض سجلّات، فكانت كلُّ
-- الفجوات المتبقّية قوائمَ **كاملةً في الذاكرة** — رُشّحت في المتصفّح
-- (`useListSearch`) — إلّا هذه: `admin_list_verifications` مُرقَّمةٌ بمؤشّرٍ
-- زمنيّ وزرِّ «عرض المزيد»، فترشيحٌ في المتصفّح كان سيبحث في الصفحة
-- المعروضة ويقول «لا نتيجة» عن طلبِ توثيقٍ موجود.
--
-- 🪤 ومعاملٌ جديد ⇒ `CREATE OR REPLACE` **لا يستبدل** بل يُنشئ نسخةً ثانية
--    فيصير النداءُ ملتبساً وتسكت الشاشة (درسُ v14.25). فـ`DROP` أوّلاً.
-- 🔴 والدالّةُ الجديدة تُولد ممنوحةً لـ`anon` بامتيازات `public` الافتراضيّة،
--    فالـ`REVOKE` أدناه هو ما يسدّها — لا الصمت (قِيس في v16.29 بكسرة).
-- ════════════════════════════════════════════════════════════════════════════

DO $lab$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'REFUSED: هذه قاعدةُ المختبر (طوكيو). الهجراتُ تُعتمد على جدة.';
  END IF;
END $lab$;

DO $base$
DECLARE v text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='taki_search_key';
  IF v IS NULL THEN
    RAISE EXCEPTION 'REFUSED: v16.29 غيرُ مطبَّقة — `taki_search_key` غير موجودة.';
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='admin_list_verifications';
  IF v IS NULL OR position('taki_admin_perm(''tab_verification'')' IN v) = 0 THEN
    RAISE EXCEPTION 'REFUSED: نصُّ admin_list_verifications الحيّ لا يطابق الأساسَ المتوقَّع.';
  END IF;
END $base$;

DROP FUNCTION IF EXISTS public.admin_list_verifications(text, integer, timestamptz);

CREATE OR REPLACE FUNCTION public.admin_list_verifications(
  p_status text DEFAULT 'submitted'::text,
  p_limit  integer DEFAULT 50,
  p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_q      text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rows jsonb;
  -- v16.30 — مفتاحُ المعرّفات (رقمُ السجلّ · الجوّال) ومفتاحُ الأسماء، كلٌّ لبابه.
  v_key  text := public.taki_search_key(p_q);
  v_name text := NULLIF(public.taki_norm(COALESCE(p_q, '')), '');
BEGIN
  IF NOT public.taki_admin_perm('tab_verification') THEN
    RAISE EXCEPTION 'غير مصرّح' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_agg(x ORDER BY (x->>'submitted_at') DESC) INTO v_rows FROM (
    SELECT jsonb_build_object(
      'id', v.id, 'store_id', v.store_id, 'shop', u.shop, 'owner_name', u.name,
      'owner_phone', u.phone, 'owner_email', u.email,
      'doc_kind', v.doc_kind, 'doc_number', v.doc_number, 'claimed_name', v.claimed_name,
      'legal_name', v.legal_name, 'doc_expiry', v.doc_expiry, 'status', v.status,
      'reject_code', v.reject_code, 'admin_note', v.admin_note,
      'submitted_at', v.submitted_at, 'decided_at', v.decided_at,
      'dup_number', EXISTS (SELECT 1 FROM public.store_verifications d
                             WHERE d.id <> v.id AND d.status IN ('submitted','approved')
                               AND d.doc_kind = v.doc_kind
                               AND lower(btrim(d.doc_number)) = lower(btrim(v.doc_number))),
      'name_matches', (public.taki_norm(COALESCE(v.claimed_name,'')) = public.taki_norm(COALESCE(u.shop,'')))
    ) AS x
      FROM public.store_verifications v JOIN public.users u ON u.id = v.store_id
     WHERE (p_status IS NULL OR v.status = p_status)
       AND (p_cursor IS NULL OR v.submitted_at < p_cursor)
       AND (
         (v_key IS NULL AND v_name IS NULL)
         OR (v_key IS NOT NULL AND public.taki_search_key(v.doc_number) LIKE '%' || v_key || '%')
         OR (v_key IS NOT NULL AND public.taki_search_key(u.phone)      LIKE '%' || v_key || '%')
         OR (v_name IS NOT NULL AND public.taki_norm(COALESCE(u.shop,'') || ' ' || COALESCE(u.name,''))
             LIKE '%' || v_name || '%')
         OR (v_name IS NOT NULL AND public.taki_norm(COALESCE(v.claimed_name,'') || ' ' || COALESCE(v.legal_name,''))
             LIKE '%' || v_name || '%')
       )
     ORDER BY v.submitted_at DESC LIMIT GREATEST(1, LEAST(200, p_limit))
  ) s;
  RETURN jsonb_build_object('ok', true, 'rows', COALESCE(v_rows, '[]'::jsonb));
END
$function$;

REVOKE ALL ON FUNCTION public.admin_list_verifications(text, integer, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_verifications(text, integer, timestamptz, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_verifications(text, integer, timestamptz, text)
  TO postgres, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق
-- ════════════════════════════════════════════════════════════════════════════

-- ① نسخةٌ واحدة، وصلاحيّاتٌ بلا مجهول
DO $v1$
DECLARE v_n int; v_acl text;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='admin_list_verifications';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'فشل ①: % نسخةً — النداءُ يصير ملتبساً وتسكت الشاشة.', v_n;
  END IF;
  SELECT array_to_string(p.proacl,' | ') INTO v_acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='admin_list_verifications';
  IF v_acl IS NULL OR v_acl LIKE '%anon=%' THEN
    RAISE EXCEPTION 'فشل ①: صلاحيّةُ تنفيذٍ لمجهولٍ على دالّة إدارة — %',
      COALESCE(v_acl, '(افتراضيّة: PUBLIC)');
  END IF;
  IF v_acl NOT LIKE '%authenticated=X%' OR v_acl NOT LIKE '%service_role=X%' THEN
    RAISE EXCEPTION 'فشل ①: الصلاحيّاتُ لم تُعَد بعد DROP — %', v_acl;
  END IF;
  RAISE NOTICE '① نسخةٌ واحدة وصلاحيّاتٌ سليمة — %', v_acl;
END $v1$;

-- ② سلوكيّ: البحثُ يجد طلبَ توثيقٍ حقيقياً، والنصُّ الغائب يُرجع صفراً
DO $v2$
DECLARE
  v_admin text; v_doc text; v_shop text; v_id text; v_n int; v_zero int; v_all int;
BEGIN
  SELECT id INTO v_admin FROM public.users WHERE user_type='admin' ORDER BY created_at LIMIT 1;
  SELECT v.id::text, v.doc_number, u.shop INTO v_id, v_doc, v_shop
  FROM public.store_verifications v JOIN public.users u ON u.id = v.store_id
  ORDER BY v.submitted_at DESC LIMIT 1;

  IF v_admin IS NULL THEN RAISE EXCEPTION 'فشل ②: لا حسابَ أدمن.'; END IF;
  IF v_id IS NULL THEN
    RAISE NOTICE '② تخطٍّ: لا طلبَ توثيقٍ على هذا الخادم — الفحصُ لا يُجرى على فراغ.';
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT jsonb_array_length((public.admin_list_verifications(NULL, 200, NULL, NULL))->'rows') INTO v_all;
  SELECT count(*) INTO v_n FROM jsonb_array_elements(
    (public.admin_list_verifications(NULL, 200, NULL, v_doc))->'rows') e WHERE e->>'id' = v_id;
  SELECT jsonb_array_length((public.admin_list_verifications(NULL, 200, NULL, 'ZZQX-لا-يوجد-99887'))->'rows') INTO v_zero;
  EXECUTE 'RESET ROLE';

  IF v_all = 0 THEN RAISE EXCEPTION 'فشل ②: القائمةُ فارغةٌ بلا بحث — الفحصُ على فراغ.'; END IF;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'فشل ②أ: البحثُ برقم الوثيقة % لم يُرجع الطلبَ % (عدد=%).', v_doc, v_id, v_n;
  END IF;
  IF v_zero <> 0 THEN
    RAISE EXCEPTION 'فشل ②ب: نصٌّ غائبٌ أرجع % صفّاً — الترشيحُ مُهمَل.', v_zero;
  END IF;
  RAISE NOTICE '② البحثُ بـ% وجد الطلبَ، والنصُّ الغائب أرجع صفراً (الكلّ=%).', v_doc, v_all;
END $v2$;
