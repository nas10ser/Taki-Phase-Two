-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.38 — الصلاحيات الفرعية تحرس فعلاً (طلب ناصر ٣)
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 **ثغرة مقيسة، لا مُستنتَجة.** جرّبتُ على الإنتاج (داخل معاملة أُلغيت) أدمن
-- فرعياً صلاحيته `tab_overview` وحدها، فـ:
--     • قرأ **جوّالات وبُرُد كل العملاء** بنداء جدولٍ مباشر
--     • و**أوقف متجرين** بـ`UPDATE` واحد يتجاوز كل الدوال الإدارية
--
-- السبب: `is_admin()` تبحث عن إطار `admin_*` على مكدّس النداء لتعرف أي صلاحية
-- تُطلب. وحين لا يوجد إطار — أي عند قراءة أو كتابة **مباشرة على الجدول** من
-- المتصفّح عبر PostgREST — تُرجع TRUE بلا شرط. و٦٤ سياسة RLS مبنيّة عليها.
--
-- فالنموذج كلّه يحرس الأبواب ويترك الجدران.
--
-- لا خطر اليوم: ناصر الأدمن الوحيد وهو `is_super_admin`، والحارس الجديد يُمرّره
-- دائماً. لكنه ينفجر لحظة منح أول صلاحية فرعية — وهو ما طلبه.
--
-- 🪤 وفخٌّ كِدتُ أقع فيه: ٦٣ من ٦٤ سياسة كانت `TO public` لا `TO authenticated`.
-- إعادة بنائها بـ`authenticated` كانت ستحجب **البانرات والمسابقات عن الزوّار
-- المجهولين** — كسرٌ صامت في واجهة عامة. الأدوار تُنسَخ كما هي حرفياً.
--
-- وكل سياسة أُعيد بناؤها **من نصّها الحيّ** لا بإعادة كتابة يدوية: تُستبدل
-- `is_admin()` وحدها ويبقى كل شرطٍ آخر (صفّك · متجرك · طرفا الطلب) كما هو.
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

-- ── الحارس الواعي بالصلاحية ─────────────────────────────────────────────────
-- لا يعتمد على مكدّس النداء إطلاقاً: يسأل صفّ المستخدم مباشرةً. فيصحّ في
-- السياسات كما يصحّ داخل الدوال.
CREATE OR REPLACE FUNCTION public.taki_admin_perm(p_perm text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = (SELECT auth.uid())::text
      AND u.user_type = 'admin'
      AND u.deleted_at IS NULL
      AND ( COALESCE(u.is_super_admin, false)
         OR p_perm = ANY(COALESCE(u.admin_permissions, '{}'::text[])) )
  );
$$;
REVOKE ALL ON FUNCTION public.taki_admin_perm(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.taki_admin_perm(text) TO anon, authenticated;

-- ══ سياسات مُعاد بناؤها آلياً من نصّها الحيّ ══
-- 🪤 الأدوار تُنسَخ كما هي. ٦٣ من ٦٤ سياسة كانت `TO public`، وتقييدها
--    بـ`authenticated` كان سيحجب البانرات والمسابقات عن الزوّار المجهولين.

DROP POLICY IF EXISTS activity_select_admin ON public.activity_log;
CREATE POLICY activity_select_admin ON public.activity_log FOR SELECT
  USING (( SELECT public.taki_admin_perm('tab_tools')));

DROP POLICY IF EXISTS admin_draws_admin_all ON public.admin_draws;
CREATE POLICY admin_draws_admin_all ON public.admin_draws FOR ALL
  USING (( SELECT public.taki_admin_perm('tab_contests')))
  WITH CHECK (( SELECT public.taki_admin_perm('tab_contests')));

DROP POLICY IF EXISTS admin_imp_log_insert ON public.admin_impersonation_log;
CREATE POLICY admin_imp_log_insert ON public.admin_impersonation_log FOR INSERT
  WITH CHECK (( SELECT public.taki_admin_perm('action_impersonate')));

DROP POLICY IF EXISTS admin_imp_log_select ON public.admin_impersonation_log;
CREATE POLICY admin_imp_log_select ON public.admin_impersonation_log FOR SELECT
  USING (( SELECT public.taki_admin_perm('action_impersonate')));

DROP POLICY IF EXISTS banners_select ON public.banners;
CREATE POLICY banners_select ON public.banners FOR SELECT
  USING ((((is_active = true) AND ((expires_at IS NULL) OR (expires_at > now()))) OR ( SELECT public.taki_admin_perm('action_manage_banners'))));

DROP POLICY IF EXISTS booking_refunds_select_parties ON public.booking_refunds;
CREATE POLICY booking_refunds_select_parties ON public.booking_refunds FOR SELECT
  USING (((( SELECT (uid())::text AS uid) = buyer_id) OR (( SELECT (uid())::text AS uid) = store_id) OR ( SELECT public.taki_admin_perm('action_view_finance'))));

DROP POLICY IF EXISTS complaints_delete_admin ON public.complaints;
CREATE POLICY complaints_delete_admin ON public.complaints FOR DELETE
  USING (( SELECT public.taki_admin_perm('tab_reports')));

DROP POLICY IF EXISTS complaints_insert ON public.complaints;
CREATE POLICY complaints_insert ON public.complaints FOR INSERT
  WITH CHECK ((((( SELECT uid() AS uid))::text = user_id) OR ( SELECT public.taki_admin_perm('tab_reports'))));

DROP POLICY IF EXISTS complaints_select ON public.complaints;
CREATE POLICY complaints_select ON public.complaints FOR SELECT
  USING ((((( SELECT uid() AS uid))::text = user_id) OR ( SELECT public.taki_admin_perm('tab_reports'))));

DROP POLICY IF EXISTS complaints_update_admin ON public.complaints;
CREATE POLICY complaints_update_admin ON public.complaints FOR UPDATE
  USING (( SELECT public.taki_admin_perm('tab_reports')))
  WITH CHECK (( SELECT public.taki_admin_perm('tab_reports')));

DROP POLICY IF EXISTS entries_delete_admin ON public.contest_entries;
CREATE POLICY entries_delete_admin ON public.contest_entries FOR DELETE
  USING (( SELECT public.taki_admin_perm('tab_contests')));

DROP POLICY IF EXISTS entries_select_admin ON public.contest_entries;
CREATE POLICY entries_select_admin ON public.contest_entries FOR SELECT
  USING (( SELECT public.taki_admin_perm('tab_contests')));

DROP POLICY IF EXISTS entries_update_admin ON public.contest_entries;
CREATE POLICY entries_update_admin ON public.contest_entries FOR UPDATE
  USING (( SELECT public.taki_admin_perm('tab_contests')))
  WITH CHECK (( SELECT public.taki_admin_perm('tab_contests')));

DROP POLICY IF EXISTS contests_delete_admin ON public.contests;
CREATE POLICY contests_delete_admin ON public.contests FOR DELETE
  USING (( SELECT public.taki_admin_perm('tab_contests')));

DROP POLICY IF EXISTS contests_insert_admin ON public.contests;
CREATE POLICY contests_insert_admin ON public.contests FOR INSERT
  WITH CHECK (( SELECT public.taki_admin_perm('tab_contests')));

DROP POLICY IF EXISTS contests_select_public ON public.contests;
CREATE POLICY contests_select_public ON public.contests FOR SELECT
  USING (((status = ANY (ARRAY['active'::text, 'closed'::text, 'drawn'::text])) OR ( SELECT public.taki_admin_perm('tab_contests'))));

DROP POLICY IF EXISTS contests_update_admin ON public.contests;
CREATE POLICY contests_update_admin ON public.contests FOR UPDATE
  USING (( SELECT public.taki_admin_perm('tab_contests')))
  WITH CHECK (( SELECT public.taki_admin_perm('tab_contests')));

DROP POLICY IF EXISTS delivery_tracks_select_parties ON public.delivery_tracks;
CREATE POLICY delivery_tracks_select_parties ON public.delivery_tracks FOR SELECT
  USING ((((( SELECT uid() AS uid))::text = user_id) OR ((( SELECT uid() AS uid))::text = store_id) OR ( SELECT public.taki_admin_perm('tab_sellers'))));

DROP POLICY IF EXISTS email_outbox_admin_read ON public.email_outbox;
CREATE POLICY email_outbox_admin_read ON public.email_outbox FOR SELECT
  USING (( SELECT public.taki_admin_perm('tab_tools')));

DROP POLICY IF EXISTS subs_delete_admin ON public.merchant_subscriptions;
CREATE POLICY subs_delete_admin ON public.merchant_subscriptions FOR DELETE
  USING (( SELECT public.taki_admin_perm('tab_sellers')));

DROP POLICY IF EXISTS subs_insert_admin ON public.merchant_subscriptions;
CREATE POLICY subs_insert_admin ON public.merchant_subscriptions FOR INSERT
  WITH CHECK (( SELECT public.taki_admin_perm('tab_sellers')));

DROP POLICY IF EXISTS subs_select ON public.merchant_subscriptions;
CREATE POLICY subs_select ON public.merchant_subscriptions FOR SELECT
  USING ((((( SELECT uid() AS uid))::text = merchant_id) OR ( SELECT public.taki_admin_perm('tab_sellers'))));

DROP POLICY IF EXISTS subs_update_admin ON public.merchant_subscriptions;
CREATE POLICY subs_update_admin ON public.merchant_subscriptions FOR UPDATE
  USING (( SELECT public.taki_admin_perm('tab_sellers')))
  WITH CHECK (( SELECT public.taki_admin_perm('tab_sellers')));

DROP POLICY IF EXISTS moderation_flags_admin_all ON public.moderation_flags;
CREATE POLICY moderation_flags_admin_all ON public.moderation_flags FOR ALL
  USING (( SELECT public.taki_admin_perm('tab_reports')))
  WITH CHECK (( SELECT public.taki_admin_perm('tab_reports')));

DROP POLICY IF EXISTS order_invoices_select_parties ON public.order_invoices;
CREATE POLICY order_invoices_select_parties ON public.order_invoices FOR SELECT
  USING (((( SELECT (uid())::text AS uid) = buyer_id) OR (( SELECT (uid())::text AS uid) = store_id) OR ( SELECT public.taki_admin_perm('action_view_finance'))));

DROP POLICY IF EXISTS payment_attempts_self ON public.payment_attempts;
CREATE POLICY payment_attempts_self ON public.payment_attempts FOR SELECT
  USING ((( SELECT public.taki_admin_perm('action_view_finance')) OR (merchant_id = (( SELECT uid() AS uid))::text)));

DROP POLICY IF EXISTS pin_delete_admin ON public.pinned_stores;
CREATE POLICY pin_delete_admin ON public.pinned_stores FOR DELETE
  USING (( SELECT public.taki_admin_perm('action_manage_seasonal')));

DROP POLICY IF EXISTS pin_insert_admin ON public.pinned_stores;
CREATE POLICY pin_insert_admin ON public.pinned_stores FOR INSERT
  WITH CHECK (( SELECT public.taki_admin_perm('action_manage_seasonal')));

DROP POLICY IF EXISTS pin_update_admin ON public.pinned_stores;
CREATE POLICY pin_update_admin ON public.pinned_stores FOR UPDATE
  USING (( SELECT public.taki_admin_perm('action_manage_seasonal')))
  WITH CHECK (( SELECT public.taki_admin_perm('action_manage_seasonal')));

DROP POLICY IF EXISTS ppl_select_parties ON public.platform_payment_log;
CREATE POLICY ppl_select_parties ON public.platform_payment_log FOR SELECT
  USING ((((( SELECT uid() AS uid))::text = merchant_id) OR ((( SELECT uid() AS uid))::text = buyer_id) OR ( SELECT public.taki_admin_perm('action_view_finance'))));
-- تُترك عمداً: platform_settings.platform_settings_select (SELECT) — التطبيق يقرأ الإعدادات

DROP POLICY IF EXISTS reports_delete_admin ON public.reports;
CREATE POLICY reports_delete_admin ON public.reports FOR DELETE
  USING (( SELECT public.taki_admin_perm('tab_reports')));

DROP POLICY IF EXISTS reports_insert ON public.reports;
CREATE POLICY reports_insert ON public.reports FOR INSERT
  WITH CHECK ((((( SELECT uid() AS uid))::text = reporter_id) OR ( SELECT public.taki_admin_perm('tab_reports'))));

DROP POLICY IF EXISTS reports_select_admin ON public.reports;
CREATE POLICY reports_select_admin ON public.reports FOR SELECT
  USING (( SELECT public.taki_admin_perm('tab_reports')));

DROP POLICY IF EXISTS reports_update_admin ON public.reports;
CREATE POLICY reports_update_admin ON public.reports FOR UPDATE
  USING (( SELECT public.taki_admin_perm('tab_reports')))
  WITH CHECK (( SELECT public.taki_admin_perm('tab_reports')));

DROP POLICY IF EXISTS sa_cities_geo_delete_admin ON public.sa_cities_geo;
CREATE POLICY sa_cities_geo_delete_admin ON public.sa_cities_geo FOR DELETE
  USING (( SELECT public.taki_admin_perm('tab_tools')));

DROP POLICY IF EXISTS sa_cities_geo_insert_admin ON public.sa_cities_geo;
CREATE POLICY sa_cities_geo_insert_admin ON public.sa_cities_geo FOR INSERT
  WITH CHECK (( SELECT public.taki_admin_perm('tab_tools')));

DROP POLICY IF EXISTS sa_cities_geo_update_admin ON public.sa_cities_geo;
CREATE POLICY sa_cities_geo_update_admin ON public.sa_cities_geo FOR UPDATE
  USING (( SELECT public.taki_admin_perm('tab_tools')))
  WITH CHECK (( SELECT public.taki_admin_perm('tab_tools')));

DROP POLICY IF EXISTS sponsors_delete_admin ON public.sponsors;
CREATE POLICY sponsors_delete_admin ON public.sponsors FOR DELETE
  USING (( SELECT public.taki_admin_perm('action_manage_sponsors')));

DROP POLICY IF EXISTS sponsors_insert_admin ON public.sponsors;
CREATE POLICY sponsors_insert_admin ON public.sponsors FOR INSERT
  WITH CHECK (( SELECT public.taki_admin_perm('action_manage_sponsors')));

DROP POLICY IF EXISTS sponsors_update_admin ON public.sponsors;
CREATE POLICY sponsors_update_admin ON public.sponsors FOR UPDATE
  USING (( SELECT public.taki_admin_perm('action_manage_sponsors')))
  WITH CHECK (( SELECT public.taki_admin_perm('action_manage_sponsors')));

DROP POLICY IF EXISTS spn_delete_admin ON public.sponsorships;
CREATE POLICY spn_delete_admin ON public.sponsorships FOR DELETE
  USING (( SELECT public.taki_admin_perm('action_manage_sponsors')));

DROP POLICY IF EXISTS spn_insert_admin ON public.sponsorships;
CREATE POLICY spn_insert_admin ON public.sponsorships FOR INSERT
  WITH CHECK (( SELECT public.taki_admin_perm('action_manage_sponsors')));

DROP POLICY IF EXISTS spn_update_admin ON public.sponsorships;
CREATE POLICY spn_update_admin ON public.sponsorships FOR UPDATE
  USING (( SELECT public.taki_admin_perm('action_manage_sponsors')))
  WITH CHECK (( SELECT public.taki_admin_perm('action_manage_sponsors')));

DROP POLICY IF EXISTS branches_delete_own ON public.store_branches;
CREATE POLICY branches_delete_own ON public.store_branches FOR DELETE
  USING ((((( SELECT uid() AS uid))::text = merchant_id) OR ( SELECT public.taki_admin_perm('tab_sellers'))));

DROP POLICY IF EXISTS branches_insert_own ON public.store_branches;
CREATE POLICY branches_insert_own ON public.store_branches FOR INSERT
  WITH CHECK ((((( SELECT uid() AS uid))::text = merchant_id) OR ( SELECT public.taki_admin_perm('tab_sellers'))));

DROP POLICY IF EXISTS branches_update_own ON public.store_branches;
CREATE POLICY branches_update_own ON public.store_branches FOR UPDATE
  USING ((((( SELECT uid() AS uid))::text = merchant_id) OR ( SELECT public.taki_admin_perm('tab_sellers'))))
  WITH CHECK ((((( SELECT uid() AS uid))::text = merchant_id) OR ( SELECT public.taki_admin_perm('tab_sellers'))));

DROP POLICY IF EXISTS delivery_zones_delete_own ON public.store_delivery_zones;
CREATE POLICY delivery_zones_delete_own ON public.store_delivery_zones FOR DELETE
  USING ((((( SELECT uid() AS uid))::text = store_id) OR ( SELECT public.taki_admin_perm('tab_sellers'))));

DROP POLICY IF EXISTS delivery_zones_insert_own ON public.store_delivery_zones;
CREATE POLICY delivery_zones_insert_own ON public.store_delivery_zones FOR INSERT
  WITH CHECK ((((( SELECT uid() AS uid))::text = store_id) OR ( SELECT public.taki_admin_perm('tab_sellers'))));

DROP POLICY IF EXISTS delivery_zones_update_own ON public.store_delivery_zones;
CREATE POLICY delivery_zones_update_own ON public.store_delivery_zones FOR UPDATE
  USING ((((( SELECT uid() AS uid))::text = store_id) OR ( SELECT public.taki_admin_perm('tab_sellers'))))
  WITH CHECK ((((( SELECT uid() AS uid))::text = store_id) OR ( SELECT public.taki_admin_perm('tab_sellers'))));

DROP POLICY IF EXISTS snr_select_own ON public.store_name_requests;
CREATE POLICY snr_select_own ON public.store_name_requests FOR SELECT TO authenticated
  USING ((((( SELECT uid() AS uid))::text = store_id) OR ( SELECT public.taki_admin_perm('tab_sellers'))));

DROP POLICY IF EXISTS store_profiles_insert ON public.store_profiles;
CREATE POLICY store_profiles_insert ON public.store_profiles FOR INSERT
  WITH CHECK ((((( SELECT uid() AS uid))::text = store_id) OR ( SELECT public.taki_admin_perm('tab_sellers'))));

DROP POLICY IF EXISTS store_profiles_update ON public.store_profiles;
CREATE POLICY store_profiles_update ON public.store_profiles FOR UPDATE
  USING ((((( SELECT uid() AS uid))::text = store_id) OR ( SELECT public.taki_admin_perm('tab_sellers'))))
  WITH CHECK ((((( SELECT uid() AS uid))::text = store_id) OR ( SELECT public.taki_admin_perm('tab_sellers'))));

DROP POLICY IF EXISTS pay_delete_admin ON public.subscription_payments;
CREATE POLICY pay_delete_admin ON public.subscription_payments FOR DELETE
  USING (( SELECT public.taki_admin_perm('action_view_finance')));

DROP POLICY IF EXISTS pay_insert_admin ON public.subscription_payments;
CREATE POLICY pay_insert_admin ON public.subscription_payments FOR INSERT
  WITH CHECK (( SELECT public.taki_admin_perm('action_view_finance')));

DROP POLICY IF EXISTS pay_select ON public.subscription_payments;
CREATE POLICY pay_select ON public.subscription_payments FOR SELECT
  USING ((((( SELECT uid() AS uid))::text = merchant_id) OR ( SELECT public.taki_admin_perm('action_view_finance'))));

DROP POLICY IF EXISTS pay_update_admin ON public.subscription_payments;
CREATE POLICY pay_update_admin ON public.subscription_payments FOR UPDATE
  USING (( SELECT public.taki_admin_perm('action_view_finance')))
  WITH CHECK (( SELECT public.taki_admin_perm('action_view_finance')));

DROP POLICY IF EXISTS plans_delete_admin ON public.subscription_plans;
CREATE POLICY plans_delete_admin ON public.subscription_plans FOR DELETE
  USING (( SELECT public.taki_admin_perm('tab_sellers')));

DROP POLICY IF EXISTS plans_insert_admin ON public.subscription_plans;
CREATE POLICY plans_insert_admin ON public.subscription_plans FOR INSERT
  WITH CHECK (( SELECT public.taki_admin_perm('tab_sellers')));

DROP POLICY IF EXISTS plans_update_admin ON public.subscription_plans;
CREATE POLICY plans_update_admin ON public.subscription_plans FOR UPDATE
  USING (( SELECT public.taki_admin_perm('tab_sellers')))
  WITH CHECK (( SELECT public.taki_admin_perm('tab_sellers')));

DROP POLICY IF EXISTS sessions_select_admin ON public.user_sessions;
CREATE POLICY sessions_select_admin ON public.user_sessions FOR SELECT
  USING (( SELECT public.taki_admin_perm('tab_tools')));

DROP POLICY IF EXISTS user_warnings_admin_all ON public.user_warnings;
CREATE POLICY user_warnings_admin_all ON public.user_warnings FOR ALL
  USING (( SELECT public.taki_admin_perm('tab_reports')))
  WITH CHECK (( SELECT public.taki_admin_perm('tab_reports')));

DROP POLICY IF EXISTS users_select_own_or_admin ON public.users;
CREATE POLICY users_select_own_or_admin ON public.users FOR SELECT
  USING ((((( SELECT uid() AS uid))::text = id) OR ( SELECT public.taki_admin_perm('tab_buyers'))));

DROP POLICY IF EXISTS users_update_admin ON public.users;
CREATE POLICY users_update_admin ON public.users FOR UPDATE
  USING ((( SELECT public.taki_admin_perm('action_manage_users')) OR ((( SELECT uid() AS uid))::text = id)))
  WITH CHECK ((( SELECT public.taki_admin_perm('action_manage_users')) OR ((( SELECT uid() AS uid))::text = id)));

-- أُعيد بناء 63 سياسة · تُركت 1

-- ── `admin_update_user` كانت بلا أي حارس صلاحية ────────────────────────────
-- تفحص «هل المنادي أدمن» وتنصرف. فأي أدمن فرعي يُعيد تسمية أي حساب أو يغيّر
-- بريده أو جوّاله أو نوعه. أُضيفت إلى الخريطة كي يسري عليها الحارس.
INSERT INTO public.admin_rpc_permissions (rpc_name, required_perm)
VALUES ('admin_update_user', 'action_manage_users')
ON CONFLICT DO NOTHING;

-- الدوال التي أضفتُها اليوم تدخل الخريطة أيضاً — دالةٌ خارج الخريطة تسقط على
-- fail-open وتصير مفتوحة لكل أدمن فرعي.
INSERT INTO public.admin_rpc_permissions (rpc_name, required_perm) VALUES
  ('admin_reports_summary',          'tab_reports'),
  ('admin_campaign_audience',        'action_manage_campaigns'),
  ('admin_list_store_name_requests', 'tab_sellers'),
  ('admin_resolve_store_name',       'tab_sellers')
ON CONFLICT DO NOTHING;

-- ── الصلاحيات الستّ الميّتة تُربط بما تحرسه فعلاً ───────────────────────────
-- كانت مربّعات اختيار بلا قارئ في الكود ولا في القاعدة: ناصر يمنع أدمن فرعياً
-- من «الأمور المالية» فيقرأ الأرقام المالية كاملةً.
UPDATE public.admin_rpc_permissions SET required_perm = 'action_view_finance'
 WHERE rpc_name IN ('admin_finance_overview','admin_revenue_series','admin_gmv_stats',
                    'admin_list_invoices','admin_investor_pack','admin_subscription_revenue');
UPDATE public.admin_rpc_permissions SET required_perm = 'action_manage_campaigns'
 WHERE rpc_name IN ('admin_broadcast_notification','broadcast_campaign');
UPDATE public.admin_rpc_permissions SET required_perm = 'action_manage_sponsors'
 WHERE rpc_name LIKE 'admin_set_sponsor%' OR rpc_name LIKE 'admin_sponsor%';
UPDATE public.admin_rpc_permissions SET required_perm = 'action_manage_seasonal'
 WHERE rpc_name LIKE '%pin_store%' OR rpc_name LIKE 'admin_season%';
UPDATE public.admin_rpc_permissions SET required_perm = 'action_manage_users'
 WHERE rpc_name IN ('admin_soft_delete_user','admin_suspend_account','admin_set_booking_ban');

-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق
-- ════════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS الفحص,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ مختبر طوكيو'
            ELSE '✅ جدة (الإنتاج)' END AS النتيجة
UNION ALL SELECT 'الحارس الواعي بالصلاحية',
       CASE WHEN to_regprocedure('public.taki_admin_perm(text)') IS NOT NULL
            THEN '✅ موجود' ELSE '❌ مفقود' END
UNION ALL SELECT 'سياسات بقيت على is_admin العارية',
       (SELECT count(*)::text FROM pg_policies
        WHERE schemaname='public'
          AND (qual LIKE '%is_admin%' OR with_check LIKE '%is_admin%')
          AND COALESCE(qual,'') NOT LIKE '%has_admin_permission%'
          AND COALESCE(qual,'') NOT LIKE '%taki_admin_perm%'
          AND COALESCE(with_check,'') NOT LIKE '%taki_admin_perm%')
UNION ALL SELECT 'سياسات صارت واعية بالصلاحية',
       (SELECT count(*)::text FROM pg_policies
        WHERE schemaname='public'
          AND (qual LIKE '%taki_admin_perm%' OR with_check LIKE '%taki_admin_perm%'))
UNION ALL SELECT 'الزائر ما زال يرى البانرات',
       CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                         AND tablename='banners' AND policyname='banners_select'
                         AND 'public' = ANY(roles))
            THEN '✅ نعم' ELSE '❌ حُجبت عنه' END
UNION ALL SELECT 'تعديل الحسابات صار محروساً',
       CASE WHEN EXISTS (SELECT 1 FROM public.admin_rpc_permissions
                         WHERE rpc_name='admin_update_user')
            THEN '✅ في الخريطة' ELSE '❌ ما زال مفتوحاً' END
UNION ALL SELECT 'دوال admin_* بلا خريطة',
       (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname LIKE 'admin\_%'
          AND NOT EXISTS (SELECT 1 FROM public.admin_rpc_permissions r WHERE r.rpc_name=p.proname));
