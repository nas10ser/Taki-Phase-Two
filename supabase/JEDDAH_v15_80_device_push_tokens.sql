-- ════════════════════════════════════════════════════════════════════════
-- TAKI · v15.81 — رموزُ الإشعاراتِ الأصليّة (APNs / FCM)
--                 🔴 **مسوَّدةٌ — لم تُشغَّل على جدة بعد.**
--
-- تُشغَّل على **جدة (الإنتاج)** بالدور `supabase_admin`. آمنةٌ للتكرار،
-- وكلُّها داخل معاملةٍ واحدة (لا `CONCURRENTLY` ولا `ALTER TYPE`).
--
-- ───────────────────────── لماذا، ومقيساً ─────────────────────────
-- 🔴 **تطبيقٌ من المتجر لا يستلم Web Push إطلاقاً — وهذه قاعدةُ منصّةٍ لا
--    رأيٌ.** Web Push على آيفون (منذ iOS 16.4) يُسلَّم لتطبيقِ ويبٍ مُضافٍ
--    إلى الشاشة الرئيسية من سفاري وحده. و Capacitor يُصيّر في `WKWebView`،
--    وهناك لا توجد واجهةُ Push أصلاً — ويُقاس من إعدادنا نفسِه:
--    `capacitor.config.ts` يضبط `limitsNavigationsToAppBoundDomains: false`،
--    وهو **المفتاحُ الذي يُشغّل العاملَ الخدميَّ في WKWebView**؛ وبلا عاملٍ
--    خدميّ لا Web Push بحالٍ. ومتصفّحُ أندرويد المدمج (WebView) لا ينفّذ
--    واجهةَ Push كذلك.
--    ⇒ فمَن يُثبّت التطبيقَ من المتجر **لا يصله إشعارٌ واحد** حتى تُوصل
--      APNs/FCM. والمسارُ القائم حيٌّ وسليم: صفّان حقيقيّان في
--      `push_subscriptions` كلاهما `web.push.apple.com` من سفاري الجوّال،
--      أي تطبيقُ ويبٍ على الشاشة الرئيسية — طريقٌ آخرُ تماماً.
--
-- 🔴 وما كان مفقوداً **أربعُ حلقاتٍ**، كلٌّ منها صامتة:
--    ① جسرُ `AppDelegate`: إضافةُ Capacitor **لا تستطيع** جلبَ رمزِ جهازٍ
--      بنفسها — تُراقب `.capacitorDidRegisterForRemoteNotifications` ويجب
--      على التطبيق المضيف بثُّه، ولم يكن في `ios/` سطرٌ واحدٌ يبثّه.
--      (أُصلح في v15.81: `ios/App/App/AppDelegate.swift`.)
--    ② موضعُ نداءٍ: `registerNativePush` بلا منادٍ واحد.
--    ③ جدولُ رموز: **لا وجودَ له** — وهذه الهجرة.
--    ④ وأداةُ الإرسال `send-push` بـVAPID وحدها (قِيس: نسختُها على الخادم
--      مطابقةُ البصمة لنسخة المستودع، وصفرُ ذكرٍ لـAPNs أو FCM).
--
-- 🪤 ولا يُلمَس `push_subscriptions` بحالٍ: مسارُ الويب حيٌّ ومستعمَل، و
--    `handle_notification_push` و`prune_push_subscriptions` (كرون jobid 32،
--    `17 4 * * 0`) و`purge_expired_accounts` كلُّها تقرؤه. والجدولُ هنا
--    **توأمٌ** له لا بديل.
--
-- ⚠️ وما يبقى على ناصر (ولا يُغني عنه كودٌ): مفتاحُ APNs (.p8 + Key ID +
--    Team ID) من حساب أبل، ومشروعُ Firebase لأندرويد (google-services.json
--    + حسابُ خدمةٍ لـFCM HTTP v1). وبلاها يفشل الإرسالُ **مغلقاً** باسمٍ
--    صريح (`APNS_UNSET` / `FCM_UNSET`) لا بتخطٍّ صامت.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ① حارسُ الخادم: هذه هجرةُ إنتاج، وتُرفض على المختبر.
--    🪤 درسٌ مكلّف (٢٢ أغسطس): هجراتُ أسابيعَ ذهبت إلى طوكيو لا إلى جدة.
DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION '⛔ هذه هجرةُ إنتاج (جدة) — ومُنعت على مختبر طوكيو.';
  END IF;
END $guard$;

-- ② شرطٌ مسبقٌ يُفشل الهجرةَ لا يُحذّر: الجدولُ التوأمُ وعمودُ الهويّة.
DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='push_subscriptions') THEN
    RAISE EXCEPTION '❌ `public.push_subscriptions` غائب — هذا الجدولُ توأمُه، وشكلُه مُستنسَخٌ منه.';
  END IF;
  -- 🔴 و`users.id` **نصٌّ** في هذه القاعدة لا uuid. وإنشاءُ عمودٍ بنوعٍ
  --    مختلفٍ يُفشل المفتاحَ الأجنبيّ برسالةٍ عن أنواعٍ غيرِ متوافقة.
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema='public' AND table_name='users' AND column_name='id') <> 'text' THEN
    RAISE EXCEPTION '❌ `users.id` ليس نصّاً — يُراجَع نوعُ `user_id` قبل الإنشاء.';
  END IF;
END $pre$;

-- ③ الجدول ──────────────────────────────────────────────────────────────
-- 🪤 و`token` فريد: الجهازُ الواحد يُصدر رمزاً واحداً، والرمزُ قد ينتقل من
--    حسابٍ إلى آخرَ على نفس الجهاز (يُسلِّم جهازَه لأخيه) — فالوحدانيّةُ على
--    الرمز هي ما يجعل الكتابةَ `ON CONFLICT` تنقل المِلكيّةَ بدل أن تُنشئ
--    صفّاً ثانياً يُسلّم نفسَ الإشعار لصاحبين.
CREATE TABLE IF NOT EXISTS public.device_push_tokens (
  id            bigserial PRIMARY KEY,
  user_id       text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token         text NOT NULL,
  platform      text NOT NULL CHECK (platform IN ('ios','android')),
  app_version   text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_push_tokens_token_key UNIQUE (token)
);
CREATE INDEX IF NOT EXISTS device_push_tokens_user_idx
  ON public.device_push_tokens(user_id);

COMMENT ON TABLE public.device_push_tokens IS
  'رموزُ APNs/FCM لتطبيقَي المتجرين. توأمُ push_subscriptions (ويب) — ولا يُغني أحدُهما عن الآخر: تطبيقُ المتجر لا يستلم Web Push إطلاقاً.';

ALTER TABLE public.device_push_tokens ENABLE ROW LEVEL SECURITY;

-- ④ السياساتُ الأربع — **منسوخةٌ شكلاً ودوراً من `push_subs_*` الحيّة**
-- ───────────────────────────────────────────────────────────────────────
-- 🔴 قِيس على جدة قبل الكتابة (لا من الذاكرة):
--      push_subs_self_select  r  TO public  USING  ((SELECT uid())::text = user_id)
--      push_subs_self_insert  a  TO public  WITH CHECK (نفسُه)
--      push_subs_self_update  w  TO public  USING + WITH CHECK (نفسُه)
--      push_subs_self_delete  d  TO public  USING (نفسُه)
--    ⇒ `TO public` حرفياً، لا `authenticated`. ودرسُ v14.38 صريح: إعادةُ
--      بناءِ ٦٣ سياسةً بـ`authenticated` كانت ستحجب محتوىً عن الزوّار.
--      **تُنسخ الأدوارُ حرفياً عند أيّ إعادة بناء.**
-- 🪤 و`DROP POLICY IF EXISTS` لاسمِها **هو** قبل كلّ إنشاء: «آمنٌ للتكرار»
--    ليس صفةً تلقائيّة.
DROP POLICY IF EXISTS device_tokens_self_select ON public.device_push_tokens;
CREATE POLICY device_tokens_self_select ON public.device_push_tokens
  FOR SELECT TO public
  USING ((SELECT auth.uid())::text = user_id);

DROP POLICY IF EXISTS device_tokens_self_insert ON public.device_push_tokens;
CREATE POLICY device_tokens_self_insert ON public.device_push_tokens
  FOR INSERT TO public
  WITH CHECK ((SELECT auth.uid())::text = user_id);

DROP POLICY IF EXISTS device_tokens_self_update ON public.device_push_tokens;
CREATE POLICY device_tokens_self_update ON public.device_push_tokens
  FOR UPDATE TO public
  USING ((SELECT auth.uid())::text = user_id)
  WITH CHECK ((SELECT auth.uid())::text = user_id);

DROP POLICY IF EXISTS device_tokens_self_delete ON public.device_push_tokens;
CREATE POLICY device_tokens_self_delete ON public.device_push_tokens
  FOR DELETE TO public
  USING ((SELECT auth.uid())::text = user_id);

-- ⑤ المنحُ — **والسحبان معاً** ───────────────────────────────────────────
-- 🪤 `REVOKE … FROM PUBLIC` **لا يُلغي منحَ `anon` المباشر**، ولا العكس.
--    يلزم الاثنان، وهو درسٌ قائمٌ في المشروع منذ v14.25.
-- 🔴 ولا SELECT لـ`anon` هنا خلافاً للتوأم: قِيس أن `push_subscriptions`
--    تحمل `anon|SELECT` (بقيّةٌ قديمة) — ورمزُ جهازٍ مربوطٌ بحسابٍ أقربُ
--    إلى مُعرِّفٍ شخصيّ، فلا يُمنح لزائرٍ مجهولٍ ولو حجبته RLS.
REVOKE ALL ON public.device_push_tokens FROM PUBLIC;
REVOKE ALL ON public.device_push_tokens FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_push_tokens TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_push_tokens TO service_role;
REVOKE ALL ON SEQUENCE public.device_push_tokens_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.device_push_tokens_id_seq FROM anon;
GRANT USAGE, SELECT ON SEQUENCE public.device_push_tokens_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.device_push_tokens_id_seq TO service_role;

-- ⑥ المنظِّف — توأمُ `prune_push_subscriptions` حرفياً ────────────────────
-- 🔴 ونافذتُه **٩٠ يوماً** لأن هذا بعينه ما تقوله سياسةُ الخصوصية في جدول
--    الاستبقاء («اشتراكات الإشعارات غير المستعملة: ٩٠ يوماً»). ولو اختلف
--    الرقمان لصارت الوثيقةُ تَعِد بما لا يُنفَّذ — وذاك أسوأُ من ألّا تَعِد.
CREATE OR REPLACE FUNCTION public.prune_device_push_tokens()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.device_push_tokens
   WHERE coalesce(last_used_at, created_at) < now() - interval '90 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$fn$;
REVOKE ALL ON FUNCTION public.prune_device_push_tokens() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prune_device_push_tokens() FROM anon;
REVOKE ALL ON FUNCTION public.prune_device_push_tokens() FROM authenticated;

-- ⑦ الجدولةُ — نفسُ ساعةِ التوأم (`17 4 * * 0`, jobid 32 الحيّ) ──────────
-- 🪤 وخادمُ جدة على `+03:00` لا UTC — ولذلك تُنسخ الساعةُ من الوظيفة
--    القائمة ولا تُخترع.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='prune_device_push_tokens';
    PERFORM cron.schedule('prune_device_push_tokens', '17 4 * * 0',
                          'SELECT public.prune_device_push_tokens();');
  ELSE
    RAISE EXCEPTION '❌ pg_cron غائب — المنظِّفُ بلا جدولةٍ يعني نموّاً بلا حدّ.';
  END IF;
END $cron$;

-- ⑧ الحلقةُ الخامسة: المُحرِّضُ نفسُه كان يصمت ────────────────────────────
-- 🔴 **وهذه لم تكن في جرد العيوب الأربعة، وبلاها لا يعمل شيءٌ ممّا سبق.**
--    `handle_notification_push` تبدأ بـ:
--      IF NOT EXISTS (SELECT 1 FROM push_subscriptions WHERE user_id = NEW.user_id)
--        THEN RETURN NEW;
--    ⇒ مستخدمُ تطبيقٍ من المتجر له **رمزُ جهازٍ** ولا اشتراكَ ويبٍ، لا
--      يُنادى `send-push` من أجله **إطلاقاً**. فالجدولُ والجسرُ والمنادي
--      كلُّها تعمل، وتبقى الإشعاراتُ صامتةً لسببٍ خامسٍ في موضعٍ خامس.
-- 🪤 والنصُّ أدناه **منسوخٌ من `pg_get_functiondef` الحيّ** (قُرئ من جدة
--    ٩ نوفمبر ٢٠٢٦) وأُضيف إليه شرطٌ واحد — لا يُعاد كتابتُه من الذاكرة،
--    وإلّا حُذف ما لا نعلمه. ولم يُمسّ أيُّ شيءٍ آخرَ فيه: ترتيبُ قراءة
--    الخزنة بعد الفحص (توفيرُ v15.51)، ومعالجُ الاستثناء الذي لا يُجهض
--    إدراجَ الإشعار، وجسمُ الطلب كما هو.
CREATE OR REPLACE FUNCTION public.handle_notification_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url    text;
  v_secret text;
BEGIN

  -- لا مشترك = لا نداء. يوفّر نداءً لكل إشعار لمستخدم بلا جهاز مسجَّل،
  -- وهي الحالة الغالبة اليوم (١١٧٧ إشعاراً مقابل صفر اشتراك).
  -- 🔴 v15.81 — **ويُسأل الجدولان**: تطبيقُ المتجر لا يستلم Web Push
  --    إطلاقاً، فرمزُ الجهاز هو قناتُه الوحيدة. وبسؤال جدولٍ واحدٍ كان
  --    مستخدمُ التطبيق يُستبعَد عند الباب.
  IF NOT EXISTS (SELECT 1 FROM public.push_subscriptions  WHERE user_id = NEW.user_id)
 AND NOT EXISTS (SELECT 1 FROM public.device_push_tokens WHERE user_id = NEW.user_id) THEN
    RETURN NEW;
  END IF;

  -- 🔴 v15.51 — الخزنةُ تُقرأ **بعد** الفحص لا قبله: بثٌّ لمليون مستخدمٍ
  --    كان يقرأ سرّين لكلّ صفّ (مليونا قراءة) قبل أن يسأل إن كان لصاحبه
  --    جهازٌ مسجَّل أصلاً. والفحصُ فهرسٌ على user_id، والقراءةُ أغلى منه.
  BEGIN
    SELECT value INTO v_url    FROM public.app_secrets WHERE key = 'push_url';
    SELECT value INTO v_secret FROM public.app_secrets WHERE key = 'push_shared_secret';
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;   -- الخزنة غير متاحة: لا نُسقط الإشعار نفسه أبداً
  END;
  IF coalesce(v_url, '') = '' OR coalesce(v_secret, '') = '' THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := v_url,
      body := jsonb_build_object(
        'userId',  NEW.user_id,
        'titleAr', NEW.title_ar,
        'titleEn', NEW.title_en,
        'bodyAr',  NEW.body_ar,
        'bodyEn',  NEW.body_en,
        'type',    NEW.type,
        'data',    NEW.meta_data,
        'notifId', NEW.id
      ),
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-push-secret', v_secret
      ),
      timeout_milliseconds := 5000
    );
  EXCEPTION WHEN OTHERS THEN
    -- إشعارٌ في القاعدة أهمّ من دفعةٍ فشلت: لا تُجهض الإدراج أبداً.
    NULL;
  END;
  RETURN NEW;
END;
$function$;

-- ⑨ التحقّق — **كلُّ شرطٍ `DO` يرفع استثناءً، لا جدولُ ✅/❌** ─────────────
-- 🔴 لأن صفّاً يقول ❌ ليس خطأً في SQL، فيخرج `psql` بصفرٍ وتُقرأ الهجرةُ
--    على أنها نجحت (درسُ v14.52، مقيس).
DO $verify$
DECLARE
  v_pol   integer;
  v_roles text;
  v_anon  integer;
BEGIN
  SELECT count(*) INTO v_pol
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relname = 'device_push_tokens';
  IF v_pol <> 4 THEN
    RAISE EXCEPTION '❌ سياساتُ device_push_tokens % لا ٤.', v_pol;
  END IF;

  -- والأدوارُ تُقاس لا تُفترض: `{0}` = `public`، وهو ما عليه التوأم.
  SELECT string_agg(DISTINCT p.polroles::text, ',') INTO v_roles
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relname = 'device_push_tokens';
  IF v_roles <> '{0}' THEN
    RAISE EXCEPTION '❌ أدوارُ السياسات «%» لا «{0}» (public) — التوأمُ `push_subs_*` كلُّه TO public.', v_roles;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.device_push_tokens'::regclass) THEN
    RAISE EXCEPTION '❌ RLS غيرُ مفعّلةٍ على device_push_tokens.';
  END IF;

  SELECT count(*) INTO v_anon
    FROM information_schema.role_table_grants
   WHERE table_schema='public' AND table_name='device_push_tokens' AND grantee IN ('anon','PUBLIC');
  IF v_anon <> 0 THEN
    RAISE EXCEPTION '❌ بقي % منحاً لـanon/PUBLIC على device_push_tokens.', v_anon;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='prune_device_push_tokens') THEN
    RAISE EXCEPTION '❌ المنظِّفُ غيرُ موجود.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='prune_device_push_tokens') THEN
    RAISE EXCEPTION '❌ لا وظيفةَ كرونٍ للمنظِّف.';
  END IF;

  -- والمُحرِّضُ يسأل الجدولَ الجديد فعلاً — **ويُجرَّد التعليقُ قبل الفحص**،
  -- وإلّا أمسك الفحصُ التعليقَ الذي يشرحه (فخٌّ دُفع ثمنُه خمسَ مرّات هنا).
  IF position('device_push_tokens' in
       regexp_replace(pg_get_functiondef(
         (SELECT oid FROM pg_proc WHERE proname='handle_notification_push')),
         '--[^' || chr(10) || ']*', '', 'g')) = 0 THEN
    RAISE EXCEPTION '❌ handle_notification_push لا تسأل device_push_tokens — مستخدمُ التطبيق يُستبعَد عند الباب.';
  END IF;
END $verify$;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════
-- 🔴 **ما يبقى بعد هذه الهجرة — ولا تُعلن «تمّت» بدونه**
-- ① `purge_expired_accounts` **يجب أن تُمدَّد** لتحذف من هذا الجدول.
--    و`ON DELETE CASCADE` على `user_id` لا يكفي: التجهيلُ **لا يحذف الصفَّ
--    من `users`** بل يُفرّغ حقولَه، فيبقى رمزُ جهازٍ مربوطاً بحسابٍ مُجهَّل.
--    وتُعدَّل **من نصّها الحيّ** (`pg_get_functiondef`) بإضافة عبارةٍ واحدة،
--    لا من نسخةٍ مكتوبةٍ في هجرة — وإلّا حُذف ما لا نعلمه.
--    (ويملك هذه الدالّةَ وكيلٌ آخر في هذه الجلسة؛ الطلبُ في التقرير.)
-- ② جدولُ الاستبقاء في `src/pages/legal/Privacy.tsx` يُضاف إليه سطرُ
--    «رموزُ إشعارات التطبيق: ٩٠ يوماً» باللغتين.
-- ③ `ios/App/App/PrivacyInfo.xcprivacy` يُضاف إليه
--    `NSPrivacyCollectedDataTypeDeviceID` (Linked = نعم · Tracking = لا ·
--    الغرض AppFunctionality)، ونظيرُه في استمارةِ «أمان البيانات» عند قوقل
--    («معرّفات الجهاز أو غيرها»). قِيس أنه **غائبٌ** عن الأنواع العشرة
--    المُعلَنة — وكان غيابُه صحيحاً حتى اليوم لأن لا رمزَ كان يُخزَّن.
-- ════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════
-- -- ROLLBACK
-- SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='prune_device_push_tokens';
-- DROP FUNCTION IF EXISTS public.prune_device_push_tokens();
-- DROP TABLE IF EXISTS public.device_push_tokens;   -- ⚠️ يمحو كلَّ رمزِ جهازٍ مسجَّل
-- ════════════════════════════════════════════════════════════════════════
