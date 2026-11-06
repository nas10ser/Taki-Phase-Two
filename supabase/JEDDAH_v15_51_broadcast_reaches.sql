-- ═══════════════════════════════════════════════════════════════════════════
-- v15.51 — البثُّ يصل · وأثرُ المشاهدة لا يُحرق الإشعار
-- ═══════════════════════════════════════════════════════════════════════════
-- شكوى ناصر: «عملتُ إعلاناً ترويجياً ونشرتُه فوراً ولم يعمل».
-- والقياسُ على جدّة أثبت **عطبين متراكبين**، كلاهما يُنتج صفراً:
--
-- 🔴 (أ) جدولُ `promo_impressions` يحمل معنيين لا يجوز اجتماعهما:
--     «رأى البانر» و«أُرسل له الإشعار». والبثُّ يستثني كلَّ من له صفٌّ فيه
--     (`NOT EXISTS`)، **والمتصفّحُ يكتب الصفَّ لحظةَ عرض البانر على الشاشة**.
--     ⇒ من رأى البانر لا يصله الإشعارُ أبداً، **وأيُّ بثٍّ ثانٍ يعود صفراً**
--     لأن البثَّ الأوّل ملأ الجدول. قِيس على الحملات الأربع النشطة:
--       reach_now = 0 · 0 · 0 · 0   (والجمهور 2 · 2 · 2 · 3)
--     وثلاثٌ منها `last_broadcast_at IS NULL` بعد ١٦٠+ يوماً: لم تُبثَّ قطّ.
--     وهذا بعينه صنفُ عيب v15.49 (عمودٌ بمعنيين) على سطحٍ آخر.
--
-- 🔴 (ب) ومتجرُ ناصر يملكه حسابٌ `user_type='admin'`، ومرشِّحُ الجمهور
--     `u.user_type = camp.target_audience` ⇒ حملةٌ موجَّهةٌ «للبائعين»
--     **لا تشمله**. قِيس: حسابُ الأدمن فيه ٦٣٨ إشعاراً و**صفرٌ** من نوع
--     `marketing` منذ النشأة. وهو فخُّ `CLAUDE.md` الموثَّق حرفاً:
--     «كل مرشِّح `user_type='seller'` يُخفي متجر ناصر ⇒ استعمل `neq('buyer')`».
--
-- 🔴 (ج) وبثٌّ لمليون مستخدمٍ كان سيُشعل مشغّلَ الدفع مليونَ مرّة، وكلُّ مرّةٍ
--     تقرأ **سرّين من الخزنة قبل** أن تسأل «هل لهذا المستخدم جهازٌ مسجَّل؟».
--     فتُعكس الخطوتان: الفحصُ الرخيص أوّلاً (فهرسٌ على `user_id`)، والخزنةُ
--     لا تُقرأ إلا لمن له اشتراكٌ فعليّ. قِيس اليوم: ٢ اشتراك من ٦ مستخدمين.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public._broadcast_campaign_core(text,boolean)') IS NULL
     OR to_regclass('public.promo_impressions') IS NULL THEN
    RAISE EXCEPTION 'أساسُ الحملات غائب — أوقِفت.';
  END IF;
END
$guard$;

-- ── ١) فصلُ «رأى» عن «أُرسل إليه» ──────────────────────────────────────────
ALTER TABLE public.promo_impressions ADD COLUMN IF NOT EXISTS notified_at timestamptz;

COMMENT ON COLUMN public.promo_impressions.notified_at IS
  'لحظةُ إرسال إشعار الحملة. و`seen_at` لحظةُ ظهور البانر على الشاشة — '
  'معنيان مختلفان: المشاهدةُ لا تُحرق الإشعار، والبثُّ لا يُزوّر مشاهدة.';

-- ملءٌ دقيق: يُعدّ «مُرسَلاً» من له صفُّ إشعارٍ فعليّ لهذه الحملة، لا أكثر.
-- 🪤 ولا يُعدّ الجميعُ مُرسَلاً إليهم (يُبقي الوصولَ صفراً للأبد) ولا أحدٌ
--    (يُعيد إشعاراً وصل فعلاً). والمعيارُ أثرٌ قائمٌ في `notifications`.
UPDATE public.promo_impressions p
   SET notified_at = p.seen_at
 WHERE p.notified_at IS NULL
   AND EXISTS (SELECT 1 FROM public.notifications n
                WHERE n.user_id = p.user_id
                  AND n.type = 'marketing'
                  AND n.meta_data->>'campaignId' = p.campaign_id);

CREATE INDEX IF NOT EXISTS idx_promo_impressions_notified
  ON public.promo_impressions (campaign_id) WHERE notified_at IS NOT NULL;

-- ── ٢) قلبُ البثّ ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._broadcast_campaign_core(p_campaign_id text, p_force boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE camp RECORD; affected INTEGER := 0;
BEGIN
  SELECT * INTO camp FROM public.promotional_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campaign % not found', p_campaign_id; END IF;

  -- v15.51 — الإعادةُ تمحو **أثرَ الإرسال** وحده ولا تمحو المشاهدة: حذفُ الصفّ
  -- كان يُلغي سجلَّ من رأى البانر أيضاً، وهو بيانٌ لا يُستعاد.
  IF p_force THEN
    UPDATE public.promo_impressions SET notified_at = NULL WHERE campaign_id = camp.id;
  END IF;

  WITH aud AS (
    -- 🪤 الجمهورُ لا يُطابَق بـ`user_type` حرفياً: متجرُ ناصر يملكه حسابُ أدمن،
    --    فـ«البائعون» كانت تستثنيه. قاعدةُ المشروع: `<> 'buyer'` لا `= 'seller'`.
    SELECT u.id
      FROM public.users u
     WHERE ( camp.target_audience = 'all'
          OR (camp.target_audience = 'seller' AND u.user_type <> 'buyer')
          OR (camp.target_audience = 'buyer'  AND u.user_type =  'buyer')
          OR (camp.target_audience NOT IN ('all','seller','buyer') AND u.user_type = camp.target_audience))
       AND u.deleted_at IS NULL
       AND COALESCE(u.is_suspended, false) = false
       AND public.taki_user_in_campaign(u.id, camp.target_city, camp.target_region)
  ),
  fresh AS (
    SELECT a.id FROM aud a
     WHERE NOT EXISTS (SELECT 1 FROM public.promo_impressions p
                        WHERE p.campaign_id = camp.id AND p.user_id = a.id
                          AND p.notified_at IS NOT NULL)
  ),
  ins AS (
    INSERT INTO public.notifications (
      user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
    SELECT f.id, camp.title_ar, camp.title_en, camp.body_ar, camp.body_en, 'marketing',
      jsonb_build_object(
        'campaignId',    camp.id,
        'audience',      'buyer',
        'imageUrl',      camp.image_url,
        'actionUrl',     camp.action_url,
        'actionLabelAr', camp.action_label_ar,
        'actionLabelEn', camp.action_label_en,
        -- 🪤 البوتان يقرآن الشرطة السفلية. مفتاحٌ واحد بالسنام كان يعني أن زرّ
        -- الحملة لا يظهر في تيليجرام ولا واتساب أبداً، وناصر يملأ «رابط عند
        -- الضغط» ولا يجد أحدٌ ما يضغطه.
        'action_url',    camp.action_url,
        'image_url',     camp.image_url,
        'action_label_ar', camp.action_label_ar,
        'action_label_en', camp.action_label_en),
      NOW()
      FROM fresh f
    RETURNING user_id
  )
  INSERT INTO public.promo_impressions (campaign_id, user_id, seen_at, notified_at)
  SELECT camp.id, i.user_id, NOW(), NOW() FROM ins i
  ON CONFLICT (campaign_id, user_id) DO UPDATE SET notified_at = NOW();

  GET DIAGNOSTICS affected = ROW_COUNT;

  UPDATE public.promotional_campaigns
     SET current_impressions = COALESCE(current_impressions, 0) + affected,
         last_broadcast_at = NOW()
   WHERE id = camp.id;

  RETURN affected;
END $function$;

-- ── ٣) وللوحة طريقٌ لإعادة الإرسال ────────────────────────────────────────
-- 🪤 معاملٌ جديد على دالّةٍ قائمة = **نسخةٌ ثانية** لا استبدال، فيصير النداءُ
--    ملتبساً («function is not unique») وتسكت الشاشة. الإسقاطُ أوّلاً، بلا CASCADE.
DROP FUNCTION IF EXISTS public.broadcast_campaign(text);
CREATE OR REPLACE FUNCTION public.broadcast_campaign(p_campaign_id text, p_force boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Only admins can broadcast campaigns';
    END IF;
    RETURN public._broadcast_campaign_core(p_campaign_id, COALESCE(p_force, false));
END;
$function$;
REVOKE ALL ON FUNCTION public.broadcast_campaign(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.broadcast_campaign(text, boolean) TO authenticated, service_role;

-- ── ٤) وعدّادُ المشاهدة يُكتب بصلاحيّة الخادم لا من المتصفّح ───────────────
-- 🔴 `promoRepository` كان يُحدّث `promotional_campaigns.current_impressions`
--    من العميل، وسياسةُ `promo_write_tools` تشترط صلاحيّةَ أدوات الإدارة لكلّ
--    الأوامر ⇒ مشترٍ أو بائع يُصيب **صفر صفوف بلا خطأ**، والنتيجةُ مُبتلَعة.
--    قِيس: ثلاثُ حملاتٍ لها صفوفُ مشاهدةٍ و`current_impressions = 0`.
CREATE OR REPLACE FUNCTION public.taki_mark_campaign_seen(p_campaign_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid text := (SELECT auth.uid()::text); v_new boolean := false;
BEGIN
  IF v_uid IS NULL OR COALESCE(btrim(p_campaign_id),'') = '' THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.promotional_campaigns WHERE id = p_campaign_id) THEN
    RETURN false;
  END IF;
  INSERT INTO public.promo_impressions (campaign_id, user_id, seen_at)
  VALUES (p_campaign_id, v_uid, NOW())
  ON CONFLICT (campaign_id, user_id) DO UPDATE SET seen_at = COALESCE(public.promo_impressions.seen_at, NOW());
  -- العدّادُ يُحسب من الحقيقة لا يُراكَم: مجموعُ من رآها فعلاً.
  UPDATE public.promotional_campaigns c
     SET current_impressions = (SELECT count(*) FROM public.promo_impressions p WHERE p.campaign_id = c.id)
   WHERE c.id = p_campaign_id;
  RETURN true;
END $function$;
REVOKE ALL ON FUNCTION public.taki_mark_campaign_seen(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.taki_mark_campaign_seen(text) TO authenticated, service_role;

-- ── ٥) مشغّلُ الدفع: الفحصُ الرخيصُ قبل قراءةِ الخزنة ─────────────────────
-- 🪤 يُعاد بناؤه من نصّه الحيّ بنقل الكتلة وحدها — لا بإعادة كتابةِ حمولةٍ
--    من تسعة حقول قد تنحرف عمّا تقرؤه دالّةُ الحافة.
DO $reorder$
DECLARE v_src text; v_out text; v_vault text; v_check text;
BEGIN
  SELECT pg_get_functiondef('public.handle_notification_push()'::regprocedure) INTO v_src;

  v_vault := '  BEGIN
    SELECT value INTO v_url    FROM public.app_secrets WHERE key = ''push_url'';
    SELECT value INTO v_secret FROM public.app_secrets WHERE key = ''push_shared_secret'';
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;   -- الخزنة غير متاحة: لا نُسقط الإشعار نفسه أبداً
  END;
  IF coalesce(v_url, '''') = '''' OR coalesce(v_secret, '''') = '''' THEN
    RETURN NEW;
  END IF;
';
  v_check := '  -- لا مشترك = لا نداء. يوفّر نداءً لكل إشعار لمستخدم بلا جهاز مسجَّل،
  -- وهي الحالة الغالبة اليوم (١١٧٧ إشعاراً مقابل صفر اشتراك).
  IF NOT EXISTS (SELECT 1 FROM public.push_subscriptions WHERE user_id = NEW.user_id) THEN
    RETURN NEW;
  END IF;
';

  IF position(v_vault IN v_src) = 0 OR position(v_check IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ لم أتعرّف على كتلتَي الخزنة والفحص في النصّ الحيّ — أوقِفت';
  END IF;
  IF position(v_vault IN v_src) > position(v_check IN v_src) THEN
    RAISE NOTICE 'ℹ️ الترتيبُ صحيحٌ أصلاً — لا تغيير';
    RETURN;
  END IF;

  v_out := replace(v_src, v_vault, '');
  v_out := replace(v_out, v_check, v_check || E'\n' ||
    '  -- 🔴 v15.51 — الخزنةُ تُقرأ **بعد** الفحص لا قبله: بثٌّ لمليون مستخدمٍ' || E'\n' ||
    '  --    كان يقرأ سرّين لكلّ صفّ (مليونا قراءة) قبل أن يسأل إن كان لصاحبه' || E'\n' ||
    '  --    جهازٌ مسجَّل أصلاً. والفحصُ فهرسٌ على user_id، والقراءةُ أغلى منه.' || E'\n' ||
    v_vault);

  IF position('push_subscriptions' IN v_out) = 0
     OR position('net.http_post' IN v_out) = 0
     OR position('push_shared_secret' IN v_out) = 0
     OR position('notifId' IN v_out) = 0 THEN
    RAISE EXCEPTION '❌ النقلُ أفقد الدالّةَ جزءاً — أوقِفت';
  END IF;
  IF position(v_check IN v_out) > position(v_vault IN v_out) THEN
    RAISE EXCEPTION '❌ لم ينعكس الترتيبُ فعلاً';
  END IF;
  EXECUTE v_out;
END
$reorder$;

-- ═══════════════════════════════════════════════════════════════════════════
-- تحقّقٌ سلوكيّ — بثٌّ حقيقيّ ثمّ إرجاع
-- ═══════════════════════════════════════════════════════════════════════════
DO $behave$
DECLARE
  v_adm text; v_camp text; v_before int; v_sent int; v_again int; v_forced int; v_aud int;
  v_admin_got int;
BEGIN
  BEGIN
    SELECT id INTO v_adm FROM public.users WHERE user_type='admin' AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_camp FROM public.promotional_campaigns
     WHERE is_active AND target_audience = 'seller' ORDER BY created_at DESC LIMIT 1;
    IF v_adm IS NULL OR v_camp IS NULL THEN
      RAISE EXCEPTION '❌ لا بياناتٍ للتحقّق — لم يُجرَ (وهذا فشل)';
    END IF;

    -- الحالةُ قبل: الوصولُ صفرٌ بالضبط (وهو العيبُ المُبلَّغ)
    SELECT count(*) INTO v_before FROM public.notifications
     WHERE user_id = v_adm AND type = 'marketing';
    IF v_before <> 0 THEN
      RAISE EXCEPTION '❌ افتراضُ الاختبار خاطئ: للأدمن % إشعارَ تسويق أصلاً', v_before;
    END IF;

    -- (١) بثٌّ عاديّ: يجب أن يصل الأدمن (حملةُ «البائعين» تشمل مالكَ المتجر)
    v_sent := public._broadcast_campaign_core(v_camp, false);
    SELECT count(*) INTO v_admin_got FROM public.notifications
     WHERE user_id = v_adm AND type='marketing' AND meta_data->>'campaignId' = v_camp;
    IF v_admin_got = 0 THEN
      RAISE EXCEPTION '❌ البثُّ لم يصل حسابَ الأدمن المالكَ للمتجر (أُرسل %)', v_sent;
    END IF;
    IF v_sent = 0 THEN
      RAISE EXCEPTION '❌ البثُّ أعاد صفراً — العيبُ قائم';
    END IF;

    -- (٢) بثٌّ ثانٍ بلا إجبار: يجب ألّا يُكرّر (وإلّا صار إغراقاً)
    v_again := public._broadcast_campaign_core(v_camp, false);
    IF v_again <> 0 THEN
      RAISE EXCEPTION '❌ البثُّ الثاني كرّر % إشعاراً — إغراق', v_again;
    END IF;

    -- (٣) وبالإجبار يُعاد الإرسال **للجمهور كلّه** لا لمن لم يصله فقط.
    -- 🪤 وأوّلُ صياغةٍ لهذا الشرط اشترطت تساويَ الرقمين فسقطت بحقّ: البثُّ
    --    العاديّ أوصل ١ (الباقون وُسموا «أُرسل إليهم» في الملء) والإعادةُ ٣.
    --    فالتوقّعُ كان خاطئاً لا الكود — والمعيارُ الصحيح حجمُ الجمهور.
    SELECT count(*) INTO v_aud
      FROM public.users u, public.promotional_campaigns c
     WHERE c.id = v_camp
       AND ( c.target_audience = 'all'
          OR (c.target_audience = 'seller' AND u.user_type <> 'buyer')
          OR (c.target_audience = 'buyer'  AND u.user_type =  'buyer'))
       AND u.deleted_at IS NULL AND COALESCE(u.is_suspended,false) = false
       AND public.taki_user_in_campaign(u.id, c.target_city, c.target_region);
    v_forced := public._broadcast_campaign_core(v_camp, true);
    IF v_forced <> v_aud THEN
      RAISE EXCEPTION '❌ الإعادةُ أوصلت % والجمهورُ % — ناقصة', v_forced, v_aud;
    END IF;
    IF v_forced < v_sent THEN
      RAISE EXCEPTION '❌ الإعادةُ أقلُّ من البثّ العاديّ (% < %)', v_forced, v_sent;
    END IF;

    -- (٤) والمشاهدةُ لا تحرق الإشعار: صفُّ مشاهدةٍ جديد ثمّ إجبارٌ ⇒ ما زال يصل
    PERFORM public._broadcast_campaign_core(v_camp, true);
    INSERT INTO public.promo_impressions (campaign_id, user_id, seen_at)
    VALUES (v_camp, v_adm, NOW())
    ON CONFLICT (campaign_id, user_id) DO UPDATE SET seen_at = NOW(), notified_at = NULL;
    IF public._broadcast_campaign_core(v_camp, false) = 0 THEN
      RAISE EXCEPTION '❌ مشاهدةُ البانر ما زالت تُحرق الإشعار';
    END IF;

    RAISE EXCEPTION 'TAKI_V1551_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'TAKI_V1551_ROLLBACK' THEN RAISE; END IF;
  END;
END
$behave$;

-- ── جدولُ القراءة ─────────────────────────────────────────────────────────
SELECT 'الخادم' AS "البند", COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'جدة — الإنتاج') AS "القيمة"
UNION ALL SELECT 'عمودُ notified_at',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='promo_impressions' AND column_name='notified_at') THEN '✅' ELSE '❌' END
UNION ALL SELECT 'صفوفٌ وُسمت «أُرسلت» بالملء',
  (SELECT count(*)::text FROM public.promo_impressions WHERE notified_at IS NOT NULL)
UNION ALL SELECT 'broadcast_campaign بمعاملِ إعادة',
  CASE WHEN to_regprocedure('public.broadcast_campaign(text,boolean)') IS NOT NULL
        AND to_regprocedure('public.broadcast_campaign(text)') IS NULL THEN '✅ نسخةٌ واحدة' ELSE '❌' END
UNION ALL SELECT 'الجمهورُ يشمل مالكَ المتجر الأدمن',
  CASE WHEN pg_get_functiondef('public._broadcast_campaign_core(text,boolean)'::regprocedure)
            LIKE '%u.user_type <> ''buyer''%' THEN '✅' ELSE '❌' END
UNION ALL SELECT 'الدفعُ يفحص الاشتراكَ قبل الخزنة',
  CASE WHEN position('push_subscriptions' IN pg_get_functiondef('public.handle_notification_push()'::regprocedure))
          < position('push_url' IN pg_get_functiondef('public.handle_notification_push()'::regprocedure))
       THEN '✅' ELSE '❌' END
UNION ALL SELECT 'الوصولُ الآن لو بُثَّت كلُّ حملةٍ نشطة',
  (SELECT string_agg(r::text, ' · ') FROM (
     SELECT (SELECT count(*) FROM public.users u
              WHERE (c.target_audience='all'
                  OR (c.target_audience='seller' AND u.user_type <> 'buyer')
                  OR (c.target_audience='buyer'  AND u.user_type = 'buyer'))
                AND u.deleted_at IS NULL AND COALESCE(u.is_suspended,false)=false
                AND public.taki_user_in_campaign(u.id, c.target_city, c.target_region)
                AND NOT EXISTS (SELECT 1 FROM public.promo_impressions p
                                 WHERE p.campaign_id=c.id AND p.user_id=u.id AND p.notified_at IS NOT NULL)) AS r
       FROM public.promotional_campaigns c WHERE c.is_active ORDER BY c.created_at DESC) z);
