-- ============================================================================
--  TAKI — migration v13.71
--  ثغرتان مُثبَتتان بالاختبار على نسخة قاعدة الإنتاج (لقطة ٥ أغسطس ٢٠٢٦)
--
--  ⚠️ لم تُطبَّق هذه الهجرة على خادم جدة من جلسة الاكتشاف — سياسة الشبكة في
--     تلك الجلسة كانت تمنع الوصول إلى 141-147-142-147.sslip.io. تُطبَّق يدوياً
--     من SQL Editor في لوحة سوبابيس (جدة)، ثم يُعاد تشغيل اختبارات القسم (ج).
--
--  ملاحظة أمان مهمة: كل السياسات أدناه تبدأ بـ`is_super_admin()` — فالمالك
--  (ناصر) لا يمكن أن يُقفل خارج أي شاشة مهما كانت النتيجة.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- (أ) تسريب بيانات التجار الخاصة لأي زائر — بلا حساب أصلاً
-- ─────────────────────────────────────────────────────────────────────────────
-- الإثبات (شُغِّل بدور `anon` أي بمفتاح anon الموجود في حزمة المتصفح):
--     select email, phone, telegram_chat_id from users where user_type='seller';
--     → <بريد التاجر> | <جواله> | <معرّف تيليجرام له>   ← عادت بقيم حقيقية
--     (حُجبت القيم هنا عمداً: المستودع عام، ولا يجوز أن يحمل بيانات تاجر.)
--
-- السبب: `users_select_all` تسمح بقراءة **كل أعمدة** أي صف تاجر:
--     (deleted_at IS NULL AND user_type='seller') OR auth.uid()=id OR is_admin()
-- وجدول `users` يحمل حقولاً لا علاقة للمشتري بها إطلاقاً: البريد، الجوال،
-- `telegram_chat_id` و`whatsapp_chat_id`، `telegram_link_otp` (!)، `admin_notes`،
-- `consent_ip`/`consent_user_agent`، `admin_permissions`، `booking_ban_reason`.
--
-- الأخطر بينها `telegram_link_otp`: أثناء نافذة ربط التاجر لتيليجرام يستطيع
-- **أي** شخص قراءة الرمز وربط حساب التاجر بتيليجرامه هو — أي اختطاف إشعارات.
-- ثم يليه حصاد بريد/جوال كل التجار آلياً (سبام وتصيّد وانتحال) عند التوسّع.
--
-- الحل: الجدول يعود خاصاً (صاحبه + الأدمن)، والدليل العام للمتاجر ينتقل إلى
-- عرضٍ يحمل الحقول العامة وحدها. العرض `security_invoker=false` (الافتراضي)
-- فيُقرأ بصلاحية مالكه ولا يتأثر بسياسة الجدول.

CREATE OR REPLACE VIEW public.sellers_public AS
SELECT
    u.id,
    u.name,
    u.shop,
    u.avatar_url,
    u.bio,
    u.contact_phone,          -- رقم التواصل المعلَن للمشترين (ليس جوال الحساب)
    u.user_type,
    u.lat,
    u.lng,
    u.google_maps_link,
    u.working_hours,
    u.preferred_lang,
    u.created_at
FROM public.users u
WHERE u.user_type <> 'buyer'  -- التجار + المتاجر المملوكة لأدمن (درس v13.21)
  AND u.deleted_at IS NULL
  AND COALESCE(u.is_suspended, false) = false;

ALTER VIEW public.sellers_public SET (security_barrier = true);
GRANT SELECT ON public.sellers_public TO anon, authenticated;

-- الجدول نفسه: صفّك أنت أو الأدمن فقط.
DROP POLICY IF EXISTS users_select_all ON public.users;
CREATE POLICY users_select_own_or_admin ON public.users
    FOR SELECT
    USING (
        ((SELECT auth.uid())::text = id)
        OR (SELECT public.is_admin())
    );

-- أثر جانبي مقصود: قناة realtime على `users` لم تعد تبثّ صفوف التجار لغير
-- أصحابها (كانت تبثّ الصف كاملاً بكل حقوله الخاصة لكل متصفح متصل!). تحديث
-- ملفات المتاجر يصل الآن عبر إعادة الجلب عند العودة للتطبيق — وهو موجود سلفاً
-- في AppContext (focus/visibility refresh).


-- ─────────────────────────────────────────────────────────────────────────────
-- (ب) صلاحيات الأدمن التفصيلية لا تُطبَّق على الكتابة المباشرة في الجداول
-- ─────────────────────────────────────────────────────────────────────────────
-- v13.46 ربطت الصلاحيات بـ`is_admin()` التي تقرأ إطار النداء بحثاً عن دالة
-- `admin_*`. وهذا يعني — بنصّ الدالة نفسها — أن أي نداء **ليس** من دالة أدمن
-- (سياسة RLS مثلاً) يعود بـTRUE لأي أدمن مهما كانت صلاحياته:
--
--     IF v_perm IS NULL THEN RETURN TRUE; END IF;   -- «سياسة أو مشغّل أو نداء عادي»
--
-- ولوحة التحكم تكتب هذه الجداول **مباشرة** لا عبر RPC:
--   platform_settings ← مفاتيح المنصة كلها (بوابة الدفع، البوتان، الموسم،
--                        إعدادات الإنذارات، الدفع المباشر، مزودو الدفع…)
--   banners / promotional_campaigns / moderation_terms / expense_invoices
--
-- النتيجة: أدمن فرعي أُعطي «البلاغات» فقط يستطيع — من الواجهة أو بنداء REST
-- مباشر — أن يُطفئ بوابة الدفع أو بوت تيليجرام للمنصة كلها. الصلاحيات كانت
-- تحرس التبويبات لا البيانات.

-- platform_settings: مفاتيح المنصة. الكتابة لمن يملك التبويب الذي يكتبها.
DROP POLICY IF EXISTS platform_settings_insert_admin ON public.platform_settings;
DROP POLICY IF EXISTS platform_settings_update_admin ON public.platform_settings;
DROP POLICY IF EXISTS platform_settings_delete_admin ON public.platform_settings;

CREATE POLICY platform_settings_write_scoped ON public.platform_settings
    FOR ALL
    USING (
        (SELECT public.is_super_admin())
        OR public.has_admin_permission('tab_tools')    -- الأدوات/المولات/الرسائل
        OR public.has_admin_permission('tab_launch')   -- الإطلاق/الضريبة/الفواتير
        OR public.has_admin_permission('tab_reports')  -- الإنذارات (moderation_settings)
    )
    WITH CHECK (
        (SELECT public.is_super_admin())
        OR public.has_admin_permission('tab_tools')
        OR public.has_admin_permission('tab_launch')
        OR public.has_admin_permission('tab_reports')
    );

-- banners + promotional_campaigns: تبويب «الأدوات».
DROP POLICY IF EXISTS banners_insert_admin ON public.banners;
DROP POLICY IF EXISTS banners_update_admin ON public.banners;
DROP POLICY IF EXISTS banners_delete_admin ON public.banners;
CREATE POLICY banners_write_tools ON public.banners
    FOR ALL
    USING ((SELECT public.is_super_admin()) OR public.has_admin_permission('tab_tools'))
    WITH CHECK ((SELECT public.is_super_admin()) OR public.has_admin_permission('tab_tools'));

DROP POLICY IF EXISTS promo_insert_admin ON public.promotional_campaigns;
DROP POLICY IF EXISTS promo_update_admin ON public.promotional_campaigns;
DROP POLICY IF EXISTS promo_delete_admin ON public.promotional_campaigns;
CREATE POLICY promo_write_tools ON public.promotional_campaigns
    FOR ALL
    USING ((SELECT public.is_super_admin()) OR public.has_admin_permission('tab_tools'))
    WITH CHECK ((SELECT public.is_super_admin()) OR public.has_admin_permission('tab_tools'));

-- moderation_terms: تبويب «البلاغات/الإنذارات».
DROP POLICY IF EXISTS moderation_terms_admin_all ON public.moderation_terms;
CREATE POLICY moderation_terms_write_reports ON public.moderation_terms
    FOR ALL
    USING ((SELECT public.is_super_admin()) OR public.has_admin_permission('tab_reports'))
    WITH CHECK ((SELECT public.is_super_admin()) OR public.has_admin_permission('tab_reports'));

-- expense_invoices: تبويب «الإطلاق/الضريبة» (فواتير مشتريات المنصة).
DROP POLICY IF EXISTS exp_admin_all ON public.expense_invoices;
CREATE POLICY exp_write_launch ON public.expense_invoices
    FOR ALL
    USING ((SELECT public.is_super_admin()) OR public.has_admin_permission('tab_launch'))
    WITH CHECK ((SELECT public.is_super_admin()) OR public.has_admin_permission('tab_launch'));


-- ─────────────────────────────────────────────────────────────────────────────
-- (ج) اختبارات القبول — شغّلها بعد التطبيق مباشرة
-- ─────────────────────────────────────────────────────────────────────────────
-- 1) الزائر المجهول لم يعد يرى بيانات التاجر الخاصة، ويرى الدليل العام:
--      SET LOCAL ROLE anon;
--      SELECT count(*) FROM users;            -- المتوقع: 0
--      SELECT count(*) FROM sellers_public;   -- المتوقع: عدد المتاجر
--      SELECT email FROM sellers_public;      -- المتوقع: خطأ «column does not exist»
--      RESET ROLE;
--
-- 2) التاجر ما زال يقرأ صفّه كاملاً:
--      SET LOCAL ROLE authenticated;
--      SELECT set_config('request.jwt.claims','{"sub":"<seller-id>","role":"authenticated"}',true);
--      SELECT email, telegram_chat_id FROM users;   -- صفّه هو فقط
--      RESET ROLE;
--
-- 3) أدمن فرعي بلا صلاحيات لا يطفئ المنصة:
--      (بحساب أدمن admin_permissions='{}')
--      UPDATE platform_settings SET value='false' WHERE key='telegram_bot_enabled';
--      -- المتوقع: 0 صفوف (مرفوض) — وكان قبل الهجرة ينجح.
--
-- 4) المالك (super admin) يمرّ في كل ما سبق كما كان.
