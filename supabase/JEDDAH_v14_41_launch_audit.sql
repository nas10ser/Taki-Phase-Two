-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.41 — قائمة ما قبل الإطلاق تقيس بدل أن تَعِد (طلب ناصر ٤)
-- ════════════════════════════════════════════════════════════════════════════
-- كانت ٤٨ بنداً **مكتوبة باليد** في ملف: حالةُ كل بند نصٌّ كتبتُه أنا، لا قياس.
-- وثلاثة منها كانت تكذب صراحةً:
--   • «RLS مفعّل على كل الجداول الحساسة — فحص الـHealth Check يتأكد منها».
--     الفحص لا يتضمّن **أي** فحص RLS. لو انطفأ RLS على `users` غداً لبقي البند
--     أخضر و«٢١ فحصاً» كلها خضراء.
--   • «النسخ الاحتياطي — Supabase يأخذ snapshots تلقائية». غير صحيح منذ
--     الانتقال إلى الاستضافة الذاتية في ٥ أغسطس.
--   • «Rate limiting — راجعه في Dashboard». مطبَّقٌ في القاعدة منذ v13.15،
--     والبند يطلب عملاً منجزاً ويوجّه إلى لوحةٍ لم تعد قاعدته.
--
-- وناصر لا يستطيع تعليم بندٍ يدويّ وحفظه: ينجز شيئاً خارج المنصّة فلا أثر له.
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

-- ── حالة البنود اليدوية ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.launch_checklist_state (
  item_id   text PRIMARY KEY,
  done      boolean NOT NULL DEFAULT false,
  note      text,
  admin_id  text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.launch_checklist_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lcs_admin_read ON public.launch_checklist_state;
CREATE POLICY lcs_admin_read ON public.launch_checklist_state FOR SELECT
  USING ((SELECT public.taki_admin_perm('tab_launch')));
-- لا سياسة كتابة: التعليم يمرّ بالدالة وحدها فيُسجَّل من علّمه ومتى.

CREATE OR REPLACE FUNCTION public.admin_set_launch_item(
  p_item_id text, p_done boolean, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.taki_admin_perm('tab_launch') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF COALESCE(btrim(p_item_id),'') = '' THEN RETURN jsonb_build_object('ok', false); END IF;
  INSERT INTO public.launch_checklist_state (item_id, done, note, admin_id, updated_at)
  VALUES (btrim(p_item_id), p_done, NULLIF(btrim(COALESCE(p_note,'')),''), auth.uid()::text, now())
  ON CONFLICT (item_id) DO UPDATE
    SET done = EXCLUDED.done, note = EXCLUDED.note,
        admin_id = EXCLUDED.admin_id, updated_at = now();
  RETURN jsonb_build_object('ok', true, 'item', p_item_id, 'done', p_done);
END $$;

-- ── الفحص الحقيقي ──────────────────────────────────────────────────────────
-- كل بندٍ هنا **يُقاس من القاعدة لحظة النداء**. ما لا يمكن قياسه من القاعدة
-- (النسخ الاحتياطية مثلاً، وهي خارج الخادم عمداً) يُقال عنه ذلك صراحةً بدل
-- أن يُطلى بالأخضر.
CREATE OR REPLACE FUNCTION public.admin_launch_audit()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_no_rls int; v_unguarded int; v_anon_write int; v_crons int;
  v_undeclared int; v_vat_rate text; v_gw int; v_gw_ok int;
  v_suspend_ok boolean; v_perm_policies int; v_bare_admin int;
BEGIN
  IF NOT public.taki_admin_perm('tab_launch') THEN RAISE EXCEPTION 'Not allowed'; END IF;

  SELECT count(*) INTO v_no_rls FROM pg_tables t
   WHERE t.schemaname = 'public'
     AND NOT (SELECT relrowsecurity FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE c.relname = t.tablename AND n.nspname = 'public');

  SELECT count(*) INTO v_unguarded FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'admin\_%'
     AND pg_get_functiondef(p.oid) NOT LIKE '%is_admin%'
     AND pg_get_functiondef(p.oid) NOT LIKE '%_admin_require_ctx%'
     AND pg_get_functiondef(p.oid) NOT LIKE '%taki_admin_perm%'
     AND pg_get_functiondef(p.oid) NOT LIKE '%is_super_admin%'
     AND pg_get_functiondef(p.oid) NOT LIKE '%user_type%';

  SELECT count(*) INTO v_anon_write FROM information_schema.role_table_grants
   WHERE grantee = 'anon' AND table_schema = 'public'
     AND privilege_type IN ('INSERT','UPDATE','DELETE');

  SELECT count(*) INTO v_crons FROM cron.job WHERE active;

  SELECT count(*) INTO v_undeclared FROM public.users u
   WHERE u.user_type IN ('seller','admin') AND u.deleted_at IS NULL
     AND NOT COALESCE((public.store_can_sell(u.id)->>'ok')::boolean, false);

  SELECT (value #>> '{}') INTO v_vat_rate FROM public.platform_settings WHERE key = 'merchant_vat';
  SELECT count(*), count(*) FILTER (WHERE verified_at IS NOT NULL)
    INTO v_gw, v_gw_ok FROM public.merchant_gateways;

  v_suspend_ok := pg_get_functiondef(to_regprocedure('public.admin_suspend_account(text,boolean,text)'))
                  LIKE '%banned_until%';

  SELECT count(*) INTO v_perm_policies FROM pg_policies
   WHERE schemaname='public' AND (qual LIKE '%taki_admin_perm%' OR with_check LIKE '%taki_admin_perm%');
  SELECT count(*) INTO v_bare_admin FROM pg_policies
   WHERE schemaname='public' AND (qual LIKE '%is_admin%' OR with_check LIKE '%is_admin%')
     AND COALESCE(qual,'') NOT LIKE '%has_admin_permission%'
     AND COALESCE(qual,'') NOT LIKE '%taki_admin_perm%'
     AND COALESCE(with_check,'') NOT LIKE '%taki_admin_perm%';

  RETURN jsonb_build_object('measured_at', now(), 'checks', jsonb_build_array(
    jsonb_build_object('id','rls','ok', v_no_rls = 0,
      'detail', CASE WHEN v_no_rls = 0 THEN 'كل جداول public عليها RLS — قِيس الآن'
                     ELSE v_no_rls || ' جدولاً بلا RLS' END),
    jsonb_build_object('id','admin-rpc','ok', v_unguarded = 0,
      'detail', CASE WHEN v_unguarded = 0 THEN 'كل دوال admin_* عليها حارس — قِيس الآن'
                     ELSE v_unguarded || ' دالة بلا حارس' END),
    jsonb_build_object('id','subperms','ok', v_bare_admin <= 1,
      'detail', v_perm_policies || ' سياسة واعية بالصلاحية الفرعية · ' || v_bare_admin || ' بقيت على is_admin العارية'),
    jsonb_build_object('id','anon-write','ok', v_anon_write = 0,
      'detail', CASE WHEN v_anon_write = 0 THEN 'الزائر لا يملك كتابة على أي جدول'
                     ELSE v_anon_write || ' منح كتابة للزائر' END),
    jsonb_build_object('id','rate-limit','ok', to_regclass('public.rate_limit_counters') IS NOT NULL,
      'detail','مطبَّق في القاعدة منذ v13.15 — لا علاقة له بلوحة supabase.com'),
    jsonb_build_object('id','crons','ok', v_crons >= 15,
      'detail', v_crons || ' مهمة جدولة مفعّلة'),
    jsonb_build_object('id','suspension','ok', v_suspend_ok,
      'detail', CASE WHEN v_suspend_ok THEN 'الإيقاف يمنع الدخول ويُنهي الجلسات — قِيس'
                     ELSE 'الإيقاف يضبط عموداً فقط' END),
    jsonb_build_object('id','attestation','ok', v_undeclared = 0,
      'detail', CASE WHEN v_undeclared = 0 THEN 'كل المتاجر أقرّت بطريقة الحساب'
                     ELSE v_undeclared || ' متجراً لم يُقرّ — عروضه تبقى مسوّدة' END),
    jsonb_build_object('id','vat','ok', COALESCE(v_vat_rate,'0') <> '0',
      'detail','نسبة ضريبة التجار: ' || COALESCE(v_vat_rate,'غير مضبوطة')),
    jsonb_build_object('id','payment','ok', v_gw_ok > 0,
      'detail', v_gw || ' بوابة مسجّلة · ' || v_gw_ok || ' موثّقة'),
    jsonb_build_object('id','backup','ok', NULL,
      'detail','لا يُقاس من القاعدة عمداً: النسخ خارج الخادم. الحارس الحقيقي هو الفحص اليومي على GitHub')
  ));
END $$;

DO $g$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['admin_launch_audit()','admin_set_launch_item(text,boolean,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END
$g$;

DELETE FROM public.admin_rpc_permissions WHERE rpc_name IN ('admin_launch_audit','admin_set_launch_item');
INSERT INTO public.admin_rpc_permissions (rpc_name, required_perm) VALUES
  ('admin_launch_audit','tab_launch'), ('admin_set_launch_item','tab_launch');

-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق
-- ════════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS الفحص,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ مختبر طوكيو'
            ELSE '✅ جدة (الإنتاج)' END AS النتيجة
UNION ALL SELECT 'الفحص الحقيقي',
       CASE WHEN to_regprocedure('public.admin_launch_audit()') IS NOT NULL THEN '✅ موجود' ELSE '❌ مفقود' END
UNION ALL SELECT 'حفظ البند اليدوي',
       CASE WHEN to_regclass('public.launch_checklist_state') IS NOT NULL THEN '✅ موجود' ELSE '❌ مفقود' END
UNION ALL SELECT 'لا كتابة مباشرة على الحالة',
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                             AND tablename='launch_checklist_state' AND cmd <> 'SELECT')
            THEN '✅ عبر الدالة وحدها' ELSE '❌ مكشوف' END;
