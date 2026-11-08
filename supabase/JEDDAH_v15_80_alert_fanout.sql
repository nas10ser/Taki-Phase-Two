-- ═══════════════════════════════════════════════════════════════════════════
-- ساقٌ ثانيةٌ للتنبيه — بريدٌ مباشرٌ من القاعدة، لا يمرّ بالبوت ولا بصندوقه
-- ═══════════════════════════════════════════════════════════════════════════
-- أمرُ ناصر: «التنبيهاتُ لا تصلني»؛ وقرارُه ٨ نوفمبر ٢٠٢٦: **لا تيليجرام ولا
-- واتساب في البداية** (وv15.80 مسحت كلَّ معرِّفاتهما وأضافت
-- `tr_a0_guard_bot_channel_disclosure`). فالساقُ الوحيدة التي صُمِّمت لتصل
-- جوّالَه سريعاً — صندوقُ البوت الصادر — **خارج الحساب نهائياً**، ولا يُبنى
-- عليها شيء.
--
-- 🔴 والقياسُ صحّح الدعوى في اتّجاهين (٨ نوفمبر ٢٠٢٦، على جدّة):
--   • «كلُّ تنبيهٍ يُكتب ثمّ يُسقط بصمت» **غيرُ صحيح لما بعد ٣١ أكتوبر**:
--     دفعُ الويب حيٌّ ومُثبَت (`{"sent":2,"failed":0,"dropped":0}` ثلاثَ مرّات
--     في ٧ نوفمبر، إلى نقطتَي آبل، وكلتاهما لناصر).
--   • وهو **أسوأُ من الدعوى** للتنبيهات الـ٢٨ الأقدم: صفرُ قناةٍ وصلت.
--   • والثقبُ البنيويُّ أعمقُ من كليهما: عنوانُ القناة الباقية
--     `http://kong:8000/functions/v1/send-push` — **داخلَ الصندوق الذي تراقبه**.
--     ومنبّهٌ يموت مع الصندوق ليس منبّهاً.
--
-- ⇒ هذه الهجرةُ تبني الساقَ التي تعمل بلا بوتٍ ولا مفتاحِ إطفاءٍ ولا صندوق:
--   القاعدةُ تنادي `api.resend.com` مباشرةً (قِيس من الصندوق: ٤٠١ بلا مفتاح ⇒
--   يصل)، بمفتاحٍ **موجودٍ أصلاً** على الخادم في `/opt/taki/supabase/.env`
--   (`SMTP_PASS`، ٣٦ محرفاً، يبدأ بـ`re_`) — فلا حسابَ جديد ولا سرَّ جديد.
--
-- 🟢 ومقياسٌ حاسمٌ بلا إرسالِ بريدٍ واحد: نداءُ `GET /api-keys` بذلك المفتاح
--    ردَّ `401 {"name":"restricted_api_key","message":"This API key is
--    restricted to only send emails"}` — أي أنّ المفتاح **حيٌّ وصالح**، وأنّ
--    الشيءَ الوحيدَ المسموحَ به هو `POST /emails` بعينه. (ومفتاحٌ باطل يردّ
--    رسالةً أخرى.) فبُنيت الساقُ على قياسٍ لا على أمل.
--
-- 🪤 واسمُ السرّ في الخزنة **`app_secret:resend_api_key`** لا `resend_api_key`:
--    `public.app_secrets` عرضٌ يقرأ `vault.decrypted_secrets` بمرشّح
--    `name LIKE 'app\_secret:%'` ويقصّ أوّلَ ١١ محرفاً. فاسمٌ بلا البادئة
--    يُخزَّن ولا يُرى — كتابةٌ ناجحةٌ وقراءةٌ فارغة، وهي أسوأُ من الفشل.
--
-- 🔴 والسرُّ **لا يُكتب في هذا الملفّ ولا يُطبع**. يُخزَّن بأمرٍ واحدٍ على
--    الخادم، يقرأ القيمةَ في متغيّرٍ ولا يُظهرها (الأمرُ في ذيل الملفّ،
--    قسم «قبل التنفيذ»). وهذه الهجرةُ **ترفض العمل** إن لم يكن موجوداً —
--    فلا يُشحن موزّعٌ لا يستطيع الإرسال وهو يبدو سليماً.
--
-- 🪤 وعنوانُ البريد **لا يُكتب في المستودع**: المستودعُ عام، وبريدُ ناصر
--    الشخصيُّ فيه هدفُ إغراق. يُقرأ من `auth.users` لحظةَ الهجرة.
-- 🪤 و`alert_email` **لا يُضاف إلى قائمة سماح `platform_settings_select`**
--    خلافاً لقاعدة «ثلاثة مواضع» (v14.92 · v15.25): تلك القاعدةُ لمفتاحٍ
--    **يقرؤه المتصفّح**، وهذا يقرؤه موزّعٌ DEFINER وحده. وإضافتُه إلى
--    القائمة تعني نشرَ بريدِ ناصر لكلّ زائرٍ مجهول. والأدمنُ يقرؤه أصلاً
--    بفرعِ `taki_admin_perm` القائم في نفس السياسة (قِيس من نصّها الحيّ).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- استقلالُ المنبّه — صريحاً، لكلّ ساق
-- ═══════════════════════════════════════════════════════════════════════════
--   ساقٌ ١ · القاعدة ⇒ Resend ⇒ بريد (هذه الهجرة): ثوانٍ. مستقلّةٌ عن البوت
--     وعن مفتاح الإطفاء وعن الصندوق الصادر وعن دفع الويب. **وغيرُ مستقلّةٍ
--     عن الصندوق** — فهي لا تستطيع الإبلاغَ عن موتِه، ولا تُدّعى ذلك.
--   ساقٌ ٢ · GitHub Actions (خارج الهجرة): الوحيدةُ المستقلّةُ عن جدّة
--     وVercel وRender معاً، فهي **الوحيدةُ** التي ترى موتَ الصندوق. وبطيئةٌ
--     قياساً لا تخميناً: ١٠٠ تشغيلٍ مجدوَل لكلّ سيرٍ، وسيطُ الفجوة ٢٨٦ و٢٩١
--     دقيقة، و٩٩/٩٩ فجوةً تتجاوز الساعة. تفصيلُها في ملفَّي السير.
--   ساقٌ ٣ · مراقبٌ على Render (**لم تُبنَ هنا**، فـ`server/bot.js` ليس لي):
--     ستُقصّر كشفَ موتِ الصندوق من ساعاتٍ إلى دقائق — وشرطُها قياسٌ أوّلاً:
--     خطّةُ Render المجّانية تُنيم الخدمةَ، وما يُبقيها مستيقظةً اليومَ هو
--     نبضُ جدّة نفسُه (`taki-heartbeat.sh:32` ينادي `/health` كلَّ عشر دقائق)
--     ⇒ دائرةٌ مفرغة: لو مات جدّة نام المراقب. تفصيلُها في التقرير.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ولا ضجيج (درسٌ مدفوع: v15.24 — إنذارٌ صرخ ٢٤ يوماً عن وظائفَ لم يكن
-- بإمكانها العمل لأن الخادمَ كان مطفأً، فدرَّب ناصراً على تجاهل القناة):
--   • البريدُ يُنادى **داخل تهدئة المنادي** فيرث قواعدَ كتم الضجيج كما هي
--     (النبض: ستُّ ساعات أو تغيُّرُ حالة · السعة: `cooldown_hours`).
--   • وأرضيّةٌ ثانيةٌ داخل الموزّع بالبصمة، فلا يستطيع منادٍ **قادم** أن
--     يُغرق القناةَ بلا تهدئة.
--   • ولا يُتَّهم ماضٍ كان الخادمُ فيه مطفأً: `taki_cron_health` تَقيس
--     التوقّفَ من `alive_since` (مُثبَتٌ هنا بتحقّقٍ يرفع استثناءً إن أُسقط).
--     وقِيس أثرُه فعلاً: فشلُ «الفحوص الأربعة» على GitHub كان ٣٣ تشغيلاً
--     **كلُّها بين ٢٠ و٢٥ أكتوبر** (١٢/١٢ منها فُحصت فكان سببُها الوظائفَ
--     الأسبوعية)، وآخرُ ٦٧ تشغيلاً متتالياً **ناجحةٌ كلُّها**. أي أن الكتمَ
--     يعمل، فلا يُعاد إصلاحُه.
--
-- 🔴 ولا يُحتفظ في سجلّ الإرسال بعنوانِ المستلم ولا بأيّ بيانٍ شخصيّ —
--    فلا شيءَ يُضاف إلى `purge_expired_accounts` (قاعدةُ v14.77 مُحترمة
--    بالتصميم لا بالإضافة).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── حارسُ المختبر وشروطُ الدخول ────────────────────────────────────────────
DO $guard$
DECLARE v_src text; v_n int;
BEGIN
  IF COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
    RAISE EXCEPTION 'pg_net غائب — لا سبيلَ لنداءٍ خارجيّ من القاعدة. أوقِفت.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.app_secrets'::regclass) THEN
    RAISE EXCEPTION 'عرضُ app_secrets غائب. أوقِفت.';
  END IF;

  -- 🔴 السرُّ يُخزَّن **قبل** الهجرة بأمرِ الخادم في قسم «قبل التنفيذ».
  --    وبلا هذا الحارس نشحن موزّعاً عاجزاً يبدو سليماً — وهو عينُ العيب
  --    الذي نُصلحه. ويُفحص الطولُ لا القيمة.
  IF COALESCE((SELECT length(value) FROM public.app_secrets WHERE key='resend_api_key'), 0) < 20 THEN
    RAISE EXCEPTION 'سرُّ app_secret:resend_api_key غائبٌ أو قصير — نفّذ أمرَ «قبل التنفيذ» أوّلاً. أوقِفت.';
  END IF;

  -- وحدةُ النسخة: نسخةٌ واحدةٌ لكلّ دالّةٍ سنُعيد بناءها، وإلّا صار النداءُ
  -- ملتبساً («function is not unique») وسكتت القناةُ كلُّها.
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='taki_write_heartbeat' AND p.prokind='f';
  IF v_n <> 1 THEN RAISE EXCEPTION 'taki_write_heartbeat له % نسخة — أوقِفت.', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='taki_capacity_check' AND p.prokind='f';
  IF v_n <> 1 THEN RAISE EXCEPTION 'taki_capacity_check له % نسخة — أوقِفت.', v_n; END IF;

  -- 🔴 وإعادةُ البناء من **النصّ الحيّ** لا من نسخة المستودع: نسخةُ
  --    `v14_85_saturation_alert.sql` تنقصها كتلةُ v15.24 فعلاً، ونسخةُ
  --    `JEDDAH_v15_52_capacity.sql` تُرجع الحدودَ إلى ٤٠٩٦/٨١٩٢ والحيُّ
  --    ٣٩٤٦٣/٥٩١٩٤. فهذه الهجرةُ ترفض العملَ إن لم يكن الحيُّ هو الأحدث.
  --    🪤 والتعليقُ يُجرَّد قبل الفحص (درسُ v15.00: حارسٌ أمسك تعليقَه هو).
  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='taki_write_heartbeat' AND p.prokind='f';
  IF v_src NOT LIKE '%never_ran_overdue%' THEN
    RAISE EXCEPTION 'النصُّ الحيُّ لـtaki_write_heartbeat بلا كتلة v15.24 — نسخةٌ أقدم. أوقِفت.';
  END IF;
  IF v_src NOT LIKE '%bot_fail_streak%' OR v_src NOT LIKE '%v_streak >= 2%' THEN
    RAISE EXCEPTION 'النصُّ الحيُّ لـtaki_write_heartbeat بلا ارتدادِ v15.33 — أوقِفت.';
  END IF;

  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='taki_capacity_check' AND p.prokind='f';
  IF v_src NOT LIKE '%cooldown_hours%' OR v_src NOT LIKE '%capacity_alerts%' THEN
    RAISE EXCEPTION 'النصُّ الحيُّ لـtaki_capacity_check بلا تهدئةٍ أو بلا جدولِ الإنذار — أوقِفت.';
  END IF;

  -- ولا تُتَّهم فترةُ إطفاءِ الخادم: الكاتمُ هو `alive_since` داخل
  -- `taki_cron_health`. إن أُسقط صار الإنذارُ ضجيجاً من جديد.
  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='taki_cron_health' AND p.prokind='f';
  IF v_src NOT LIKE '%alive_since%' THEN
    RAISE EXCEPTION 'taki_cron_health بلا alive_since — ستتّهم فترةَ إطفاءِ الخادم. أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) إعدادان: عنوانُ التنبيه وقنواتُه
-- ═══════════════════════════════════════════════════════════════════════════
-- العنوانُ يُقرأ من حساب الأدمن لحظةَ الهجرة — فلا بريدَ شخصيّ في مستودعٍ عام.
INSERT INTO public.platform_settings (key, value, description)
SELECT 'alert_email', to_jsonb(au.email), 'عنوانُ بريدِ تنبيهات الخادم (أدمن فقط — ليس في قائمة سماح RLS عمداً)'
  FROM public.users u JOIN auth.users au ON au.id::text = u.id
 WHERE u.user_type = 'admin' AND u.deleted_at IS NULL AND COALESCE(au.email,'') <> ''
 ORDER BY u.created_at
 LIMIT 1
ON CONFLICT (key) DO NOTHING;

-- قنواتُ التنبيه + أرضيّةُ التهدئة داخل الموزّع.
-- 🪤 ولا تيليجرام ولا واتساب هنا: مفتاحٌ لقناةٍ لن تُستعمل يُوهم أنها تعمل.
INSERT INTO public.platform_settings (key, value, description)
VALUES ('alert_channels', '{"email": true, "min_minutes": 30}'::jsonb,
        'قنواتُ تنبيه الخادم وأرضيّةُ التهدئة بالدقائق (أدمن فقط)')
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) سجلُّ الإرسال — لأن غيابَ القناة كان **غيرَ قابلٍ للكشف**
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 `net._http_response` يُنظَّف بعمرٍ قصير (قِيس: ثلاثةُ صفوفٍ وقتَ الفحص)،
--    فـ«لا صفَّ» ليس «لم يُرسل». ولا شيءَ في المنصّة كان يسجّل محاولةَ
--    تسليمِ تنبيه — ولذلك بقي العيبُ أحدَ عشر أسبوعاً بلا أن يُرى.
-- 🔴 ولا عنوانَ مستلمٍ فيه ولا أيَّ بيانٍ شخصيّ: متريّاتُ خادمٍ فقط.
CREATE TABLE IF NOT EXISTS public.taki_alert_log (
  id          bigserial PRIMARY KEY,
  fingerprint text        NOT NULL,
  level       text        NOT NULL,
  channel     text        NOT NULL,
  ok          boolean     NOT NULL,
  reason      text,
  request_id  bigint,
  title       text,
  sent_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS taki_alert_log_fp_idx ON public.taki_alert_log (fingerprint, sent_at DESC);

ALTER TABLE public.taki_alert_log ENABLE ROW LEVEL SECURITY;
-- 🪤 والأدوارُ تُنسخ حرفياً من نظيرِها الحيّ `capacity_alerts_admin`:
--    `TO PUBLIC` مع شرطِ `taki_admin_perm` — لا `TO authenticated`.
DROP POLICY IF EXISTS taki_alert_log_admin ON public.taki_alert_log;
CREATE POLICY taki_alert_log_admin ON public.taki_alert_log
  FOR SELECT TO PUBLIC USING (public.taki_admin_perm('tab_tools'));

REVOKE ALL ON TABLE public.taki_alert_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.taki_alert_log TO authenticated;
REVOKE ALL ON SEQUENCE public.taki_alert_log_id_seq FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) الموزّع — ساقٌ واحدةٌ لا تمرّ بشيءٍ نراقبه داخل الصندوق
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 دالّةٌ جديدة، فلا التباسَ نسخ — ومع ذلك تُحذف أوّلاً صراحةً حتى تكون
--    الهجرةُ خاملةَ التكرار مهما تغيّر التوقيع لاحقاً (`DROP` بلا CASCADE).
DROP FUNCTION IF EXISTS public.taki_alert_dispatch(text, text, text);
DROP FUNCTION IF EXISTS public.taki_alert_dispatch(text, text, text, text);

CREATE OR REPLACE FUNCTION public.taki_alert_dispatch(
  p_title text,
  p_body  text,
  p_level text DEFAULT 'crit',
  p_key   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_chan   jsonb;
  v_to     text;
  v_key    text;
  v_fp     text;
  v_floor  int;
  v_req    bigint;
  v_html   text;
BEGIN
  -- البصمةُ: مفتاحُ المنادي + محتوى الرسالة. فمحتوًى مختلفٌ يمرّ، ومكرَّرٌ
  -- حرفيٌّ يُكتم — وهي أرضيّةٌ **أضعفُ** من تهدئة المنادي عمداً، فلا تُلغيها.
  v_fp := COALESCE(p_key, 'alert') || ':' || md5(COALESCE(p_title,'') || '|' || COALESCE(p_body,''));

  SELECT value INTO v_chan FROM public.platform_settings WHERE key = 'alert_channels';
  IF COALESCE((v_chan->>'email')::boolean, false) IS NOT TRUE THEN
    INSERT INTO public.taki_alert_log (fingerprint, level, channel, ok, reason, title)
    VALUES (v_fp, p_level, 'email', false, 'channel_off', left(COALESCE(p_title,''), 200));
    RETURN jsonb_build_object('sent', false, 'reason', 'channel_off');
  END IF;

  -- 🪤 وقيمةٌ غيرُ رقميّةٍ في الإعداد لا تُجهض التنبيه: `::int` على نصٍّ
  --    فاسدٍ يرفع استثناءً، ومسارٌ مُجهَضٌ هنا يعني تنبيهاً **ضائعاً** بسبب
  --    خطأِ ضبطٍ — فالارتدادُ إلى الافتراضيّ أصحُّ من السقوط.
  BEGIN
    v_floor := GREATEST(COALESCE((v_chan->>'min_minutes')::int, 30), 0);
  EXCEPTION WHEN OTHERS THEN
    v_floor := 30;
  END;
  IF EXISTS (SELECT 1 FROM public.taki_alert_log
              WHERE fingerprint = v_fp AND ok
                AND sent_at > now() - make_interval(mins => v_floor)) THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'deduped');
  END IF;

  SELECT value #>> '{}' INTO v_to FROM public.platform_settings WHERE key = 'alert_email';
  -- 🪤 عنوانٌ مشوَّهٌ يُنتج نداءً يفشل بصمت، فيُفحص بالصيغة قبل الإرسال
  --    (نفسُ حارسِ `contact_emails` في الواجهة — درسُ الرابط المعطوب v14.77).
  IF COALESCE(v_to,'') !~ '^[^[:space:]@]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}$' THEN
    INSERT INTO public.taki_alert_log (fingerprint, level, channel, ok, reason, title)
    VALUES (v_fp, p_level, 'email', false, 'no_address', left(COALESCE(p_title,''), 200));
    RETURN jsonb_build_object('sent', false, 'reason', 'no_address');
  END IF;

  -- 🪤 الخزنةُ تُقرأ **بعد** الفحوص — نفسُ ترتيب v15.51 في
  --    `handle_notification_push`: لا قراءةَ سرٍّ لنداءٍ لن يحدث.
  BEGIN
    SELECT value INTO v_key FROM public.app_secrets WHERE key = 'resend_api_key';
  EXCEPTION WHEN OTHERS THEN
    v_key := NULL;
  END;
  IF COALESCE(v_key,'') = '' THEN
    INSERT INTO public.taki_alert_log (fingerprint, level, channel, ok, reason, title)
    VALUES (v_fp, p_level, 'email', false, 'no_secret', left(COALESCE(p_title,''), 200));
    RETURN jsonb_build_object('sent', false, 'reason', 'no_secret');
  END IF;

  -- الجسمُ عربيٌّ وإنجليزيٌّ معاً: المنصّةُ ثنائيّةُ اللغة، والتنبيهُ يُقرأ
  -- على جوّالٍ قد يكون بأيّ منهما.
  -- 🪤 ولا تهريبَ HTML هنا عن قصدٍ مقيس: المنادِيان الوحيدان يبنيان النصَّ
  --    من ثوابتَ ومن `format()` على أرقامِ خادمٍ وأسماءِ وظائفَ — صفرُ مدخلٍ
  --    من مستخدم. وأيُّ منادٍ **قادمٍ** يحمل نصَّ مستخدمٍ يجب أن يهرّبه قبل
  --    النداء، وإلّا صار البريدُ سطحَ حقنٍ في صندوقِ ناصر.
  v_html :=
      '<div dir="rtl" style="font:16px/1.7 -apple-system,system-ui,sans-serif">'
   || '<h3 style="margin:0 0 8px">' || p_title || '</h3>'
   || '<pre style="white-space:pre-wrap;font:inherit;margin:0">' || COALESCE(p_body,'') || '</pre>'
   || '<p style="color:#666;font-size:13px">المستوى / level: ' || COALESCE(p_level,'') || '</p>'
   || '</div>'
   || '<hr><div dir="ltr" style="font:14px/1.6 -apple-system,system-ui,sans-serif;color:#444">'
   || 'TAKI server alert. This message is sent straight from the database, '
   || 'independently of the bots and of web push.'
   || '</div>';

  BEGIN
    SELECT net.http_post(
      url     := 'https://api.resend.com/emails',
      body    := jsonb_build_object(
                   'from',    'TAKI <no-reply@takisa.net>',
                   'to',      jsonb_build_array(v_to),
                   'subject', p_title,
                   'html',    v_html),
      headers := jsonb_build_object(
                   'Content-Type',  'application/json',
                   'Authorization', 'Bearer ' || v_key),
      timeout_milliseconds := 5000
    ) INTO v_req;
  EXCEPTION WHEN OTHERS THEN
    -- 🔴 و«ابتلاعُ الاستثناء» هنا لا يُخفي العيب: السببُ يُكتب في السجلّ،
    --    فالإدراجُ في معالِج الاستثناء ينجو من تراجعِ الكتلة الداخليّة.
    INSERT INTO public.taki_alert_log (fingerprint, level, channel, ok, reason, title)
    VALUES (v_fp, p_level, 'email', false, 'http_error:' || left(SQLERRM, 120), left(COALESCE(p_title,''), 200));
    RETURN jsonb_build_object('sent', false, 'reason', 'http_error');
  END;

  INSERT INTO public.taki_alert_log (fingerprint, level, channel, ok, reason, request_id, title)
  VALUES (v_fp, p_level, 'email', true, 'queued', v_req, left(COALESCE(p_title,''), 200));

  -- تنظيفٌ ذاتيٌّ بلا كرونٍ جديد: الحجمُ قِيس ٣٣ تنبيهاً في أحد عشر أسبوعاً.
  DELETE FROM public.taki_alert_log WHERE sent_at < now() - interval '180 days';

  RETURN jsonb_build_object('sent', true, 'reason', 'queued', 'request_id', v_req);
END $function$;

REVOKE ALL ON FUNCTION public.taki_alert_dispatch(text, text, text, text) FROM PUBLIC, anon, authenticated;
-- 🪤 والاثنان معاً: `REVOKE … FROM PUBLIC` لا يُلغي منحَ `anon` المباشر،
--    ولا العكس (درسُ v14.25–29).

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) taki_write_heartbeat — **منسوخةٌ حرفياً من نصّها الحيّ** + نداءٌ إضافيّ
-- ═══════════════════════════════════════════════════════════════════════════
-- التغييرانِ الوحيدان موسومان بـ«v15.80 ⟵»:
--   (أ) نداءُ الموزّع داخل كتلة التنبيه القائمة (فيرث تهدئتَها).
--   (ب) سقفُ حجمِ القاعدة يُقرأ من `capacity_limits` بدل ٤٠٩٦ مثبَّتةً:
--       الحيُّ `db_size_warn_mb = 39463`، فالقاعدةُ عند ٤ ج.ب كانت ستُحذّر
--       **دائماً** ضدّ حدٍّ مضبوطٍ على ٣٩ ج.ب — مولّدُ ضجيجٍ من طرازِ v15.24
--       ينتظر مرورَ الزمن. والقاعدةُ اليومَ ٨٨ م.ب فلا عَرَضَ الآن: قنبلةٌ
--       لا حريق. والارتدادُ إلى ٤٠٩٦ محفوظٌ بـ`COALESCE` فالسلوكُ لا يتغيّر
--       إن غاب المفتاح.
CREATE OR REPLACE FUNCTION public.taki_write_heartbeat(p_disk_pct integer, p_mem_pct integer, p_backup_age_hours numeric, p_site_code integer DEFAULT NULL::integer, p_bot_ok boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cron    jsonb := public.taki_cron_health();
  v_sat     jsonb := public.taki_saturation();
  v_dbmb    numeric := round(pg_database_size(current_database()) / 1048576.0, 1);
  v_issues  jsonb := '[]'::jsonb;
  v_status  text := 'ok';
  v_prev    text;
  v_notif   timestamptz;
  v_sent    int := 0;
  v_streak  int := 0;          -- v15.33 — نبضاتُ فشلِ البوت المتتالية
  v_dbwarn  numeric;           -- v15.80 ⟵ سقفُ الحجم من الإعداد لا من الكود
  r         record;
BEGIN
  SELECT coalesce(h.bot_fail_streak,0) INTO v_streak FROM public.system_heartbeat h WHERE h.id = 1;
  IF p_disk_pct >= 90 THEN v_status := 'crit'; v_issues := v_issues || to_jsonb(format('القرص ممتلئ %s%%', p_disk_pct));
  ELSIF p_disk_pct >= 75 THEN v_status := 'warn'; v_issues := v_issues || to_jsonb(format('القرص %s%%', p_disk_pct)); END IF;

  IF p_mem_pct >= 92 THEN v_status := 'crit'; v_issues := v_issues || to_jsonb(format('الذاكرة %s%%', p_mem_pct));
  ELSIF p_mem_pct >= 85 THEN v_status := public.taki_worse(v_status,'warn'); v_issues := v_issues || to_jsonb(format('الذاكرة %s%%', p_mem_pct)); END IF;

  IF p_backup_age_hours >= 36 THEN v_status := 'crit';
    v_issues := v_issues || to_jsonb(format('آخر نسخة احتياطية قبل %s ساعة', round(p_backup_age_hours))); END IF;

  IF (v_cron->>'failed_24h')::int > 0 THEN v_status := 'crit';
    v_issues := v_issues || to_jsonb(format('وظائف فشلت خلال ٢٤ ساعة: %s', v_cron->>'failed_names')); END IF;
  -- v15.24 neverran — `never_ran` كانت تُحسب ولا تُقرأ إطلاقاً: وظيفةٌ
  --   لم تعمل ولا مرّةً واحدة كانت **غيرَ مرئيّة**، وهي أسوأُ من
  --   المتوقّفة (تلك عملت يوماً ما). وتُقال برسالتها هي لا بتلك.
  IF (v_cron->>'never_ran_overdue')::int > 0 THEN v_status := 'crit';
    v_issues := v_issues || to_jsonb(format('وظائف لم تعمل ولا مرّة: %s', v_cron->>'never_ran_overdue_names')); END IF;
  IF (v_cron->>'stalled')::int > 0 THEN v_status := 'crit';
    v_issues := v_issues || to_jsonb(format('وظائف توقّفت عن العمل: %s', v_cron->>'stalled_names')); END IF;

  -- الموقع: NULL يعني «لم يُفحص» لا «سليم». 🪤 الفرق جوهري — لو عُوملت NULL
  -- نجاحاً لصار تعطّلُ أداة الفحص نفسها يُنتج «كل شيء بخير».
  IF p_site_code IS NULL THEN v_status := public.taki_worse(v_status,'warn');
    v_issues := v_issues || to_jsonb('الموقع لم يُفحص (أداة الفحص لم تُبلّغ)'::text);
  ELSIF p_site_code <> 200 THEN v_status := 'crit';
    v_issues := v_issues || to_jsonb(format('الموقع يردّ %s', p_site_code)); END IF;

  -- ── v15.33 · ارتدادٌ على نبضتين ────────────────────────────────────────
  -- قِيس على ٣٧٢٨ نبضةً في سجلّ الخادم: فشلُ البوت وقع **مرّةً واحدة**
  -- (٠٫٠٢٧٪)، والنبضتان المحيطتان بها `ok` — أي أنه لم يكن عطلاً بل لحظةَ
  -- إعادةِ تشغيلٍ تفعلها Render من تلقائها (الخطّة free، وقد أقلع البوت
  -- ٣٠ أكتوبر ٠٥:٣٤ وآخرُ نشرٍ كان ٢٨ أكتوبر). وكلفةُ تلك الصرخة الواحدة
  -- أنها تُدرّب ناصراً على تجاهل القناة التي يجب أن تصرخ يوم يقع عطلٌ حقّ.
  -- ⇒ نبضةٌ واحدة فاشلة ليست دليلاً؛ نبضتان (≈٢٠ دقيقة) دليل.
  -- 🪤 والتأخّرُ ثمنٌ مقصود: الكشفُ صار ≤٢٠ دقيقة بدل ≤١٠.
  -- 🪤 والموقعُ **لا يُمسّ**: فشلُه في السجلّ نفسه = صفر، فلا ضجيجَ يُسكَت،
  --    وعطلُه يراه المشتري. يُقاس قبل أن يُضبط.
  IF p_bot_ok IS NULL THEN
    -- لا معلومة ⇒ لا تغيير في العدّاد (لا تصفيرَ يُضيّع فشلاً سابقاً، ولا
    -- زيادةَ تتّهم البوت بعطل أداةِ الفحص). والتحذيرُ قائمٌ كما كان.
    v_status := public.taki_worse(v_status,'warn');
    v_issues := v_issues || to_jsonb('البوت لم يُفحص (أداة الفحص لم تُبلّغ)'::text);
  ELSIF NOT p_bot_ok THEN
    v_streak := v_streak + 1;
    IF v_streak >= 2 THEN v_status := 'crit';
      v_issues := v_issues || to_jsonb(format('البوت لا يستجيب منذ %s نبضات متتالية (≈%s دقيقة) — أو إحدى خدماته ساقطة',
        v_streak, v_streak * 10)::text);
    END IF;
  ELSE
    v_streak := 0;
  END IF;

  -- v15.80 ⟵ السقفُ من `capacity_limits` (الحيُّ ٣٩٤٦٣ م.ب)، وارتدادُه ٤٠٩٦
  -- فالسلوكُ لا يتغيّر إن غاب المفتاح. وكانت ٤٠٩٦ مثبَّتةً في الكود تخالف
  -- الإعدادَ الحيّ ⇒ تحذيرٌ دائمٌ ينتظر مرورَ الزمن.
  SELECT (value->>'db_size_warn_mb')::numeric INTO v_dbwarn
    FROM public.platform_settings WHERE key = 'capacity_limits';
  IF v_dbmb >= COALESCE(v_dbwarn, 4096) THEN v_status := public.taki_worse(v_status,'warn');
    v_issues := v_issues || to_jsonb(format('حجم القاعدة %s ميجابايت', v_dbmb)); END IF;

  -- ── v14.85: الاقتراب من السقف ─────────────────────────────────────────────
  -- سقفُ التزامن هو `max_connections`، ومسبح PostgREST يأكل منه. تجاوزُه يعني
  -- أن المستخدم التالي يُردّ بـ«too many connections» — وهو عطلٌ كامل لا بطء.
  IF (v_sat->>'conn_pct')::int >= 85 THEN v_status := 'crit';
    v_issues := v_issues || to_jsonb(format('اتصالات القاعدة %s%% من السقف (%s من %s) — المستخدم التالي قد يُردّ',
      v_sat->>'conn_pct', v_sat->>'conn', v_sat->>'max_conn'));
  ELSIF (v_sat->>'conn_pct')::int >= 70 THEN v_status := public.taki_worse(v_status,'warn');
    v_issues := v_issues || to_jsonb(format('اتصالات القاعدة %s%% من السقف — يقترب', v_sat->>'conn_pct'));
  END IF;

  -- استعلامٌ عالق يخنق المسبح قبل أن يمتلئ: عشر ثوانٍ لا مبرّر لها هنا،
  -- فأثقل استعلامٍ حقيقي قِيس **٩٫٤ ميلي ثانية**.
  IF (v_sat->>'longest_ms')::int >= 30000 THEN v_status := 'crit';
    v_issues := v_issues || to_jsonb(format('استعلام عالق منذ %s ثانية', round((v_sat->>'longest_ms')::numeric/1000)));
  ELSIF (v_sat->>'longest_ms')::int >= 10000 THEN v_status := public.taki_worse(v_status,'warn');
    v_issues := v_issues || to_jsonb(format('استعلام بطيء %s ثانية', round((v_sat->>'longest_ms')::numeric/1000)));
  END IF;

  SELECT last_status, notified_at INTO v_prev, v_notif FROM public.system_heartbeat WHERE id = 1;

  UPDATE public.system_heartbeat SET
    seen_at = now(), status = v_status, issues = v_issues, last_status = v_status,
    bot_fail_streak = v_streak,
    metrics = jsonb_build_object('disk_pct', p_disk_pct, 'mem_pct', p_mem_pct,
                                 'db_mb', v_dbmb, 'backup_age_hours', round(p_backup_age_hours,1),
                                 'site_code', p_site_code, 'bot_ok', p_bot_ok, 'cron', v_cron,
                                 'bot_fail_streak', v_streak,
                                 'saturation', v_sat)
  WHERE id = 1;

  -- التنبيه: عند **دخول** حالة حرجة، أو مرّة كل ست ساعات ما دامت قائمة.
  IF v_status = 'crit'
     AND (v_prev IS DISTINCT FROM 'crit' OR v_notif IS NULL OR v_notif < now() - interval '6 hours') THEN
    FOR r IN SELECT u.id FROM public.users u WHERE u.user_type = 'admin' AND u.deleted_at IS NULL LOOP
      INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
      VALUES (r.id, '🚨 تنبيه الخادم', '🚨 Server alert',
              array_to_string(ARRAY(SELECT jsonb_array_elements_text(v_issues)), E'\n'),
              array_to_string(ARRAY(SELECT jsonb_array_elements_text(v_issues)), E'\n'),
              'system', jsonb_build_object('audience','admin','heartbeat',true), now());
      v_sent := v_sent + 1;
    END LOOP;

    -- v15.80 ⟵ ساقٌ ثانية، **إضافيّةٌ** لا بديلة: الإشعارُ أعلاه يبقى كما هو
    -- (مركزُ الإشعارات ودفعُ الويب)، وهذا بريدٌ لا يمرّ بالبوت ولا بمفتاح
    -- إطفائه ولا بصندوقه الصادر. ومرّةً واحدةً لكلّ دخولِ حالةٍ حرجة لا
    -- لكلّ أدمن — فهو **داخلَ** التهدئة لا داخلَ الحلقة.
    -- 🪤 ومحاطٌ بمعالِجٍ خاصٍّ به: النبضُ لا يسقط لأجل بريدٍ فاشل، والسببُ
    --    مسجَّلٌ في `taki_alert_log` فلا يصير الابتلاعُ عمًى.
    BEGIN
      PERFORM public.taki_alert_dispatch(
        '🚨 تنبيه خادم تاكي · TAKI server alert',
        array_to_string(ARRAY(SELECT jsonb_array_elements_text(v_issues)), E'\n'),
        'crit', 'heartbeat');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    UPDATE public.system_heartbeat SET notified_at = now() WHERE id = 1;
  END IF;

  RETURN jsonb_build_object('status', v_status, 'issues', v_issues, 'notified', v_sent, 'saturation', v_sat);
END $function$;
REVOKE ALL ON FUNCTION public.taki_write_heartbeat(integer, integer, numeric, integer, boolean) FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) taki_capacity_check — **منسوخةٌ حرفياً من نصّها الحيّ** + نداءٌ إضافيّ
-- ═══════════════════════════════════════════════════════════════════════════
-- التغييرُ الوحيد موسومٌ بـ«v15.80 ⟵»: نداءُ الموزّع **داخل** كتلةِ المقياس
-- بعد تجاوز التهدئة — فلا بريدَ حيث لا إشعار، ولا إشعارَ بلا بريد.
CREATE OR REPLACE FUNCTION public.taki_capacity_check()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r jsonb := public.taki_capacity_report();
  lim jsonb := r->'limits';
  v_cool interval := make_interval(hours => COALESCE((lim->>'cooldown_hours')::int, 6));
  v_raised int := 0;
  m record;
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      ('db_connections', 'اتصالاتُ القاعدة',      (r->'db_connections'->>'pct')::numeric,
         COALESCE((lim->>'db_connections_warn_pct')::numeric, 70), COALESCE((lim->>'db_connections_crit_pct')::numeric, 85), '٪'),
      ('db_size',        'حجمُ القاعدة',          (r->>'db_size_mb')::numeric,
         COALESCE((lim->>'db_size_warn_mb')::numeric, 4096),       COALESCE((lim->>'db_size_crit_mb')::numeric, 8192), ' م.ب'),
      ('storage',        'حجمُ الصور والملفّات',   (r->>'storage_mb')::numeric,
         COALESCE((lim->>'storage_warn_mb')::numeric, 20480),      COALESCE((lim->>'storage_crit_mb')::numeric, 40960), ' م.ب'),
      ('email_daily',    'بريدُ اليوم (سقفُ المزوّد)', (r->>'email_24h')::numeric,
         COALESCE((lim->>'email_daily_warn')::numeric, 80),        COALESCE((lim->>'email_daily_crit')::numeric, 95), ' رسالة'),
      ('cron_fail',      'وظائفُ الخادم الفاشلة',  (r->>'cron_fail_24h')::numeric,
         COALESCE((lim->>'cron_fail_warn')::numeric, 3),           COALESCE((lim->>'cron_fail_crit')::numeric, 10), '')
    ) AS t(metric, label, val, warn, crit, unit)
  LOOP
    IF m.val >= m.crit OR m.val >= m.warn THEN
      DECLARE
        v_level text := CASE WHEN m.val >= m.crit THEN 'crit' ELSE 'warn' END;
        v_prev  public.capacity_alerts%ROWTYPE;
      BEGIN
        SELECT * INTO v_prev FROM public.capacity_alerts WHERE metric = m.metric;
        -- لا يتكرّر الإنذارُ قبل التهدئة، إلا إن تصاعد من تحذيرٍ إلى حرج.
        -- 🪤 والمقارنةُ برتبةٍ صريحة لا أبجديّة: `GREATEST('crit','warn')='warn'`.
        IF v_prev.metric IS NOT NULL
           AND v_prev.cleared_at IS NULL
           AND v_prev.raised_at > now() - v_cool
           AND NOT (v_level = 'crit' AND v_prev.level = 'warn') THEN
          CONTINUE;
        END IF;

        INSERT INTO public.capacity_alerts (metric, level, value_num, limit_num, raised_at, cleared_at)
        VALUES (m.metric, v_level, m.val, CASE WHEN v_level='crit' THEN m.crit ELSE m.warn END, now(), NULL)
        ON CONFLICT (metric) DO UPDATE
          SET level = EXCLUDED.level, value_num = EXCLUDED.value_num,
              limit_num = EXCLUDED.limit_num, raised_at = now(), cleared_at = NULL;

        INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
        SELECT u.id,
          CASE WHEN v_level='crit' THEN '🔴 بلغت الطاقة القصوى: ' ELSE '🟠 اقتربت الطاقة القصوى: ' END || m.label,
          CASE WHEN v_level='crit' THEN '🔴 Capacity reached: '   ELSE '🟠 Capacity near: '        END || m.metric,
          m.label || ' الآن ' || trim(to_char(m.val, 'FM999999999990.9')) || m.unit
            || ' والحدُّ ' || trim(to_char(CASE WHEN v_level='crit' THEN m.crit ELSE m.warn END, 'FM999999999990.9')) || m.unit
            || '. تُضبط الحدودُ من «الأدوات ← حدود السعة».',
          m.metric || ' is ' || trim(to_char(m.val, 'FM999999999990.9')) || ' (limit '
            || trim(to_char(CASE WHEN v_level='crit' THEN m.crit ELSE m.warn END, 'FM999999999990.9')) || ').',
          'system',
          jsonb_build_object('audience','admin','event','capacity','metric', m.metric,
                             'level', v_level, 'value', m.val),
          now()
        FROM public.users u
        WHERE u.user_type = 'admin' AND u.deleted_at IS NULL;

        -- v15.80 ⟵ ساقٌ ثانية، **إضافيّةٌ** وداخلَ نفس التهدئة أعلاه.
        -- والنصُّ ثنائيُّ اللغة، وبصمةُ الكتم لكلّ مقياسٍ على حِدة فلا يكتم
        -- مقياسٌ غيرَه.
        BEGIN
          PERFORM public.taki_alert_dispatch(
            (CASE WHEN v_level='crit' THEN '🔴 بلغت الطاقة القصوى: ' ELSE '🟠 اقتربت الطاقة القصوى: ' END)
              || m.label || ' · '
              || (CASE WHEN v_level='crit' THEN 'Capacity reached: ' ELSE 'Capacity near: ' END) || m.metric,
            m.label || ' الآن ' || trim(to_char(m.val, 'FM999999999990.9')) || m.unit
              || ' والحدُّ ' || trim(to_char(CASE WHEN v_level='crit' THEN m.crit ELSE m.warn END, 'FM999999999990.9')) || m.unit
              || '. تُضبط الحدودُ من «الأدوات ← حدود السعة».' || E'\n'
              || m.metric || ' is ' || trim(to_char(m.val, 'FM999999999990.9')) || ' (limit '
              || trim(to_char(CASE WHEN v_level='crit' THEN m.crit ELSE m.warn END, 'FM999999999990.9')) || ').',
            v_level, 'capacity:' || m.metric);
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;

        v_raised := v_raised + 1;
      END;
    ELSE
      -- نزل تحت العتبة ⇒ يُطوى بلا ضجيج، فيُنذر من جديدٍ إن عاد.
      UPDATE public.capacity_alerts SET cleared_at = now()
       WHERE metric = m.metric AND cleared_at IS NULL;
    END IF;
  END LOOP;
  RETURN v_raised;
END $function$;
REVOKE ALL ON FUNCTION public.taki_capacity_check() FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- تحقّقٌ بنيويّ — كلُّ تحقّقٍ يرفع استثناءً. جدولُ ✅/❌ لا يُفشل psql.
-- ═══════════════════════════════════════════════════════════════════════════
DO $struct$
DECLARE v_src text; v_pol text;
BEGIN
  -- (١) الموزّع: موجودٌ وDEFINER ومثبَّتُ المسار ومحجوبٌ عن الزائر والموثَّق
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='taki_alert_dispatch'
                    AND p.prosecdef AND p.proconfig::text LIKE '%search_path%') THEN
    RAISE EXCEPTION '❌ taki_alert_dispatch غائبةٌ أو ليست DEFINER بمسارٍ مثبَّت';
  END IF;
  IF has_function_privilege('anon', 'public.taki_alert_dispatch(text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.taki_alert_dispatch(text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ الموزّع ممنوحٌ لـanon أو authenticated — سطحُ إرسالِ بريدٍ مفتوح';
  END IF;

  -- (٢) السجلّ: RLS مفعَّلةٌ ومحجوبٌ عن الزائر
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.taki_alert_log'::regclass) THEN
    RAISE EXCEPTION '❌ taki_alert_log بلا RLS';
  END IF;
  IF has_table_privilege('anon', 'public.taki_alert_log', 'SELECT') THEN
    RAISE EXCEPTION '❌ taki_alert_log مقروءٌ لـanon';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.taki_alert_log', 'SELECT') THEN
    RAISE EXCEPTION '❌ taki_alert_log غيرُ مقروءٍ للأدمن (لا منحَ SELECT للموثَّق)';
  END IF;

  -- (٣) الإعدادان موجودان، والعنوانُ بصيغةٍ صالحة
  IF NOT EXISTS (SELECT 1 FROM public.platform_settings WHERE key='alert_channels') THEN
    RAISE EXCEPTION '❌ مفتاحُ alert_channels غائب';
  END IF;
  IF COALESCE((SELECT value #>> '{}' FROM public.platform_settings WHERE key='alert_email'),'')
     !~ '^[^[:space:]@]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION '❌ alert_email غائبٌ أو بصيغةٍ غير صالحة — لا مستلمَ للتنبيه';
  END IF;

  -- (٤) 🔴 وعنوانُ ناصر **ليس** في قائمة سماح السياسة العامّة.
  --     تحقّقٌ إيجابيٌّ لا سلبيّ: نُثبت أننا لم نُسرّبه لكلّ زائر.
  SELECT pg_get_expr(polqual, polrelid) INTO v_pol FROM pg_policy
   WHERE polrelid='public.platform_settings'::regclass AND polname='platform_settings_select';
  IF v_pol IS NULL THEN RAISE EXCEPTION '❌ سياسةُ platform_settings_select غائبة'; END IF;
  IF v_pol LIKE '%alert_email%' THEN
    RAISE EXCEPTION '❌ alert_email داخل قائمة السماح العامّة — بريدُ ناصر مقروءٌ لأيّ زائر';
  END IF;
  -- وقائمةُ السماح لم تُمسّ: مفتاحٌ قائمٌ نُعرفه لا بدّ أن يبقى
  IF v_pol NOT LIKE '%capacity_limits%' THEN
    RAISE EXCEPTION '❌ قائمةُ السماح تغيّرت — capacity_limits اختفى منها';
  END IF;

  -- (٥) الدالّتان أُعيد بناؤهما **إضافةً** لا استبدالاً: النداءُ الجديد موجود
  --     وكلُّ علاماتِ الإصدارات السابقة باقية. 🪤 والتعليقُ يُجرَّد أوّلاً.
  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='taki_write_heartbeat' AND p.prokind='f';
  IF v_src NOT LIKE '%taki_alert_dispatch%' THEN
    RAISE EXCEPTION '❌ النبضُ لا ينادي الموزّع';
  END IF;
  IF v_src NOT LIKE '%never_ran_overdue%' OR v_src NOT LIKE '%v_streak >= 2%'
     OR v_src NOT LIKE '%bot_fail_streak%' THEN
    RAISE EXCEPTION '❌ إعادةُ بناء النبض أسقطت كتلةَ v15.24 أو ارتدادَ v15.33';
  END IF;
  IF v_src NOT LIKE '%db_size_warn_mb%' THEN
    RAISE EXCEPTION '❌ سقفُ حجمِ القاعدة ما زال مثبَّتاً في الكود';
  END IF;
  IF v_src NOT LIKE '%audience%' OR v_src NOT LIKE '%notifications%' THEN
    RAISE EXCEPTION '❌ إعادةُ بناء النبض أسقطت إشعارَ مركزِ الإشعارات';
  END IF;

  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='taki_capacity_check' AND p.prokind='f';
  IF v_src NOT LIKE '%taki_alert_dispatch%' THEN
    RAISE EXCEPTION '❌ فحصُ السعة لا ينادي الموزّع';
  END IF;
  IF v_src NOT LIKE '%cooldown_hours%' OR v_src NOT LIKE '%cleared_at%' THEN
    RAISE EXCEPTION '❌ إعادةُ بناء فحصِ السعة أسقطت التهدئةَ أو الطيّ';
  END IF;
  IF v_src NOT LIKE '%capacity_alerts%' THEN
    RAISE EXCEPTION '❌ إعادةُ بناء فحصِ السعة أسقطت جدولَ الإنذار';
  END IF;
END
$struct$;

-- ═══════════════════════════════════════════════════════════════════════════
-- تحقّقٌ سلوكيّ — داخل كتلةٍ تُلغى، فلا بريدٌ يُرسل ولا صفٌّ يبقى
-- ═══════════════════════════════════════════════════════════════════════════
-- 🟢 ولماذا لا يُرسل بريدٌ أصلاً: `net.http_post` **تُدرج صفّاً** في
--    `net.http_request_queue` وتُرجع معرّفَه (قِيس من
--    `pg_get_functiondef('net.http_post')`: `insert into
--    net.http_request_queue … returning id`). والجدولُ `UNLOGGED` لكنّه
--    جدولٌ معامليّ، فعاملُ pg_net لا يرى صفّاً غيرَ مُثبَت ⇒ تراجعُ الكتلة
--    يُلغي الطلبَ كلَّه. وهكذا نُثبت الساقَ كاملةً **بلا إرسال**.
-- 🔴 والعدُّ يُرشَّح بعنوان Resend، لا `count(*)` على الطابور كلِّه: إشعارُ
--    مركزِ الإشعارات يُشعل `tr_notification_push` فيُدرج **صفّاً ثانياً**
--    إلى `http://kong:8000` داخل نفس المعاملة (للأدمن اشتراكا دفعٍ مقيسان).
--    فتأكيدٌ على «صفٌّ واحد» كان سيفشل لسببٍ غيرِ السبب المقصود — وهو بالضبط
--    نوعُ الاختبارِ الذي يُبرّئ أو يتّهم بالخطأ. والترشيحُ يُحيّد كذلك أيَّ
--    نداءٍ من جلسةٍ أخرى (القراءةُ READ COMMITTED فلقطتُها تتجدّد كلَّ عبارة).
DO $behave$
DECLARE
  v_q0 bigint; v_q1 bigint; v_res jsonb; v_row record; v_n int;
  C_URL constant text := 'https://api.resend.com/emails';
BEGIN
  BEGIN
    SELECT count(*) INTO v_q0 FROM net.http_request_queue WHERE url = C_URL;

    -- (١) القناةُ مطفأةٌ ⇒ لا إرسال، والسببُ مسجَّل
    UPDATE public.platform_settings SET value = '{"email": false}'::jsonb WHERE key='alert_channels';
    v_res := public.taki_alert_dispatch('t1','b1','crit','test');
    IF (v_res->>'reason') <> 'channel_off' THEN RAISE EXCEPTION '❌ أرسل والقناةُ مطفأة: %', v_res; END IF;
    SELECT count(*) INTO v_q1 FROM net.http_request_queue WHERE url = C_URL;
    IF v_q1 <> v_q0 THEN RAISE EXCEPTION '❌ صفُّ طلبٍ أُدرج والقناةُ مطفأة'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.taki_alert_log WHERE reason='channel_off') THEN
      RAISE EXCEPTION '❌ الكتمُ لم يُسجَّل — ابتلاعٌ أعمى';
    END IF;

    -- (٢) القناةُ مشتعلة ⇒ طلبٌ واحدٌ إلى Resend، بالعنوان الصحيح وبالترويسة
    UPDATE public.platform_settings SET value = '{"email": true, "min_minutes": 30}'::jsonb WHERE key='alert_channels';
    v_res := public.taki_alert_dispatch('t2','b2','crit','test');
    IF (v_res->>'sent')::boolean IS NOT TRUE THEN RAISE EXCEPTION '❌ لم يُرسل: %', v_res; END IF;
    SELECT * INTO v_row FROM net.http_request_queue WHERE id = (v_res->>'request_id')::bigint;
    -- 🔴 و`SELECT … INTO` على صفرِ صفوفٍ يعود بـNULL **بلا خطأ** (درسُ v14.77)،
    --    فكلُّ تأكيدٍ بعده يصير NULL ⇒ `IF` لا تتحقّق ⇒ **نجاحٌ كاذب**. يُشترط
    --    وجودُ الصفّ صراحةً أوّلاً.
    IF v_row.id IS NULL THEN RAISE EXCEPTION '❌ لا صفَّ طلبٍ بالمعرّف المُرجَع — إرسالٌ وهميّ'; END IF;
    IF v_row.url <> C_URL THEN RAISE EXCEPTION '❌ عنوانٌ خاطئ: %', v_row.url; END IF;
    IF v_row.method <> 'POST' THEN RAISE EXCEPTION '❌ طريقةٌ خاطئة: %', v_row.method; END IF;
    IF NOT (v_row.headers ? 'Authorization') THEN RAISE EXCEPTION '❌ بلا ترويسةِ تخويل ⇒ ٤٠١ صامت'; END IF;
    IF (v_row.headers->>'Authorization') NOT LIKE 'Bearer re_%' THEN
      RAISE EXCEPTION '❌ المفتاحُ ليس مفتاحَ Resend (لا يبدأ بـre_)';
    END IF;
    IF convert_from(v_row.body,'UTF8') NOT LIKE '%' ||
       (SELECT value #>> '{}' FROM public.platform_settings WHERE key='alert_email') || '%' THEN
      RAISE EXCEPTION '❌ جسمُ الطلب لا يحمل عنوانَ المستلم';
    END IF;
    -- وثنائيُّ اللغة فعلاً، لا عربيٌّ وحده
    IF convert_from(v_row.body,'UTF8') NOT LIKE '%TAKI server alert%' THEN
      RAISE EXCEPTION '❌ الجسمُ بلا نصٍّ إنجليزيّ';
    END IF;

    -- (٣) مكرَّرٌ حرفيٌّ فوراً ⇒ يُكتم، ولا طلبَ ثانٍ
    SELECT count(*) INTO v_q0 FROM net.http_request_queue WHERE url = C_URL;
    v_res := public.taki_alert_dispatch('t2','b2','crit','test');
    IF (v_res->>'reason') <> 'deduped' THEN RAISE EXCEPTION '❌ كرّر الإرسالَ داخل الأرضيّة: %', v_res; END IF;
    SELECT count(*) INTO v_q1 FROM net.http_request_queue WHERE url = C_URL;
    IF v_q1 <> v_q0 THEN RAISE EXCEPTION '❌ طلبٌ ثانٍ أُدرج لمكرَّر'; END IF;

    -- (٤) ومحتوًى مختلفٌ يمرّ — فالأرضيّةُ لا تكتم عطلاً جديداً
    v_res := public.taki_alert_dispatch('t3','b3','crit','test');
    IF (v_res->>'sent')::boolean IS NOT TRUE THEN RAISE EXCEPTION '❌ كتمَ عطلاً مختلفاً: %', v_res; END IF;

    -- (٥) بلا عنوانٍ صالح ⇒ لا نداءَ ولا استثناء
    UPDATE public.platform_settings SET value = to_jsonb('not-an-email'::text) WHERE key='alert_email';
    SELECT count(*) INTO v_q0 FROM net.http_request_queue WHERE url = C_URL;
    v_res := public.taki_alert_dispatch('t4','b4','crit','test');
    IF (v_res->>'reason') <> 'no_address' THEN RAISE EXCEPTION '❌ عنوانٌ مشوَّهٌ مرّ: %', v_res; END IF;
    SELECT count(*) INTO v_q1 FROM net.http_request_queue WHERE url = C_URL;
    IF v_q1 <> v_q0 THEN RAISE EXCEPTION '❌ نداءٌ خرج بعنوانٍ مشوَّه'; END IF;

    -- (٦) النبضُ: حالةٌ حرجةٌ ⇒ إشعارٌ لكلّ أدمن **و** بريدٌ واحد.
    --     يُثبت أن الساقَ إضافيّةٌ لا بديلة، وأنها لا تمرّ بالبوت.
    UPDATE public.platform_settings SET value = (SELECT to_jsonb(au.email) FROM public.users u
        JOIN auth.users au ON au.id::text=u.id
       WHERE u.user_type='admin' AND u.deleted_at IS NULL ORDER BY u.created_at LIMIT 1)
     WHERE key='alert_email';
    UPDATE public.system_heartbeat SET last_status='ok', notified_at=NULL WHERE id=1;
    SELECT count(*) INTO v_q0 FROM net.http_request_queue WHERE url = C_URL;
    SELECT count(*) INTO v_n FROM public.notifications
     WHERE type='system' AND meta_data->>'heartbeat'='true';
    PERFORM public.taki_write_heartbeat(95, 50, 1, 200, true);   -- قرصٌ ٩٥٪ ⇒ crit
    IF (SELECT count(*) FROM public.notifications
         WHERE type='system' AND meta_data->>'heartbeat'='true') <= v_n THEN
      RAISE EXCEPTION '❌ النبضُ الحرجُ لم يُنتج إشعاراً — إعادةُ البناء أسقطت المسارَ القديم';
    END IF;
    SELECT count(*) INTO v_q1 FROM net.http_request_queue WHERE url = C_URL;
    IF v_q1 <> v_q0 + 1 THEN
      RAISE EXCEPTION '❌ النبضُ الحرجُ أنتج % طلبَ بريدٍ والمنتظرُ واحداً', v_q1 - v_q0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.taki_alert_log WHERE fingerprint LIKE 'heartbeat:%' AND ok) THEN
      RAISE EXCEPTION '❌ بريدُ النبض غيرُ مسجَّل';
    END IF;

    -- (٧) ومفتاحُ البوت مطفأٌ أصلاً (قِيس: false) — ومع ذلك خرج البريد.
    --     هذا هو عقدُ الاستقلال: لا يُسكته مفتاحُ البوت ولا صندوقُه.
    IF COALESCE((SELECT (value)::text FROM public.platform_settings WHERE key='telegram_bot_enabled'),'') <> 'false' THEN
      RAISE EXCEPTION '❌ افتراضُ الاختبار ساقط: مفتاحُ تيليجرام ليس مطفأً';
    END IF;

    -- (٨) السعة: عتبةٌ مستحيلة ⇒ إشعارٌ وبريد، ولا تكرارَ داخل التهدئة
    UPDATE public.platform_settings
       SET value = value || jsonb_build_object('db_size_warn_mb', 1, 'db_size_crit_mb', 2)
     WHERE key='capacity_limits';
    SELECT count(*) INTO v_q0 FROM net.http_request_queue WHERE url = C_URL;
    IF public.taki_capacity_check() < 1 THEN RAISE EXCEPTION '❌ السعةُ لم تُنذر رغم تجاوز العتبة'; END IF;
    SELECT count(*) INTO v_q1 FROM net.http_request_queue WHERE url = C_URL;
    IF v_q1 <= v_q0 THEN RAISE EXCEPTION '❌ إنذارُ السعة بلا بريد'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.taki_alert_log WHERE fingerprint LIKE 'capacity:db_size%' AND ok) THEN
      RAISE EXCEPTION '❌ بريدُ السعة غيرُ مسجَّل';
    END IF;
    SELECT count(*) INTO v_q0 FROM net.http_request_queue WHERE url = C_URL;
    IF public.taki_capacity_check() <> 0 THEN RAISE EXCEPTION '❌ كرّر إنذارَ السعة داخل التهدئة'; END IF;
    IF (SELECT count(*) FROM net.http_request_queue WHERE url = C_URL) <> v_q0 THEN
      RAISE EXCEPTION '❌ بريدٌ ثانٍ خرج داخل التهدئة — ضجيج';
    END IF;

    RAISE EXCEPTION 'TAKI_ALERT_FANOUT_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'TAKI_ALERT_FANOUT_ROLLBACK' THEN RAISE; END IF;
  END;
END
$behave$;

-- ── جدولُ قراءةٍ (بعد التحقّق، لا بدلاً منه) ───────────────────────────────
SELECT 'الخادم' AS "البند",
       COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'جدة — الإنتاج') AS "القيمة"
UNION ALL SELECT 'سرُّ Resend في الخزنة (طول)',
  COALESCE((SELECT length(value)::text FROM public.app_secrets WHERE key='resend_api_key'),'غائب')
UNION ALL SELECT 'عنوانُ التنبيه مضبوط',
  CASE WHEN COALESCE((SELECT value #>> '{}' FROM public.platform_settings WHERE key='alert_email'),'') <> ''
       THEN '✅' ELSE '❌' END
UNION ALL SELECT 'قناةُ البريد',
  COALESCE((SELECT value::text FROM public.platform_settings WHERE key='alert_channels'),'غائب')
UNION ALL SELECT 'عنوانُ التنبيه خارج قائمة سماح RLS (يجب ✅)',
  CASE WHEN (SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
              WHERE polrelid='public.platform_settings'::regclass AND polname='platform_settings_select')
            NOT LIKE '%alert_email%' THEN '✅' ELSE '❌ مكشوف' END
UNION ALL SELECT 'النبضُ ينادي الموزّع',
  CASE WHEN (SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='taki_write_heartbeat' AND p.prokind='f')
            LIKE '%taki_alert_dispatch%' THEN '✅' ELSE '❌' END
UNION ALL SELECT 'فحصُ السعة ينادي الموزّع',
  CASE WHEN (SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='taki_capacity_check' AND p.prokind='f')
            LIKE '%taki_alert_dispatch%' THEN '✅' ELSE '❌' END
UNION ALL SELECT 'سجلُّ الإرسال (صفوف)', (SELECT count(*)::text FROM public.taki_alert_log)
UNION ALL SELECT 'حالةُ النبض الآن', (SELECT status || ' · ' || issues::text FROM public.system_heartbeat WHERE id=1);

-- ═══════════════════════════════════════════════════════════════════════════
-- قبل التنفيذ — خطوةُ الخادم (مرّةً واحدة، لا تُكتب قيمتُها في أي ملفّ)
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 القيمةُ تُمرَّر بـ`PGOPTIONS` لا في نصّ SQL: متغيّرُ الجلسة يسافر في
--    حزمة بدء الاتصال، فلا يظهر في `pg_stat_statements` ولا في سجلّ العبارات
--    — خلافاً لسرٍّ مكتوبٍ داخل العبارة. (وقِيس أنه يصل فعلاً:
--    `PGOPTIONS="-c taki.k=…"` ⇒ `current_setting('taki.k',true)` مطابقة.)
--    و`psql -v` لا يضبط متغيّرَ خادمٍ أصلاً، و`-c "SET …; SELECT …"` يطبع
--    وسمَ `SET` سطراً أوّل فيُفسد أيَّ مُخرَجٍ مولَّد (درسُ v14.50–57).
--
-- ssh -i ~/.ssh/taki_jeddah2 ubuntu@207.127.99.122 'sudo bash -s' <<'EOS'
-- set -euo pipefail
-- V=$(grep -E '^SMTP_PASS=' /opt/taki/supabase/.env | head -1 | cut -d= -f2-)
-- [ ${#V} -ge 20 ] || { echo "SMTP_PASS قصيرٌ أو غائب"; exit 1; }
-- docker exec -i -e PGOPTIONS="-c taki.k=$V" supabase-db \
--   psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f - <<'SQL'
-- DO $do$
-- DECLARE v_id uuid; v_v text := current_setting('taki.k', true);
-- BEGIN
--   IF COALESCE(length(v_v),0) < 20 THEN RAISE EXCEPTION 'لم تصل القيمة'; END IF;
--   -- 🪤 الاسمُ **بالبادئة** `app_secret:` وإلّا خُزِّن ولم يُرَ من `app_secrets`
--   --    (العرضُ يرشّح `name LIKE 'app\_secret:%'` ويقصّ أوّلَ ١١ محرفاً).
--   SELECT id INTO v_id FROM vault.secrets WHERE name = 'app_secret:resend_api_key';
--   IF v_id IS NULL THEN
--     PERFORM vault.create_secret(v_v, 'app_secret:resend_api_key',
--             'مفتاح Resend لبريد تنبيهات الخادم — ساقٌ لا تمرّ بالبوت');
--   ELSE
--     -- 🪤 `vault.update_secret` على مؤشّرٍ ميت تكتب صفرَ صفوفٍ **بلا خطأ**
--     --    (درسُ v14.44) — فالكتابةُ تُثبَت بقراءةٍ بعدها لا بنجاح النداء.
--     PERFORM vault.update_secret(v_id, v_v);
--   END IF;
--   IF COALESCE((SELECT length(value) FROM public.app_secrets WHERE key='resend_api_key'),0) < 20 THEN
--     RAISE EXCEPTION 'الكتابةُ لم تثبت — السرُّ غيرُ مقروءٍ من app_secrets';
--   END IF;
--   RAISE NOTICE 'تمّ: الطولُ %', (SELECT length(value) FROM public.app_secrets WHERE key='resend_api_key');
-- END $do$;
-- SQL
-- EOS
--   والقيمةُ لا تُطبع أبداً — الطولُ وحده.

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — عودةٌ كاملة
-- ═══════════════════════════════════════════════════════════════════════════
-- -- ١) إعادةُ الدالّتين إلى نصّهما قبل الهجرة: يُستخرج من النسخة الاحتياطية
-- --    أو يُعاد تطبيق نسختَيهما السابقتين. وأسرعُ طريقٍ آمن: إطفاءُ القناة
-- --    (سطرٌ واحد) — فالنداءُ يبقى والبريدُ يتوقّف فوراً وبلا نشر:
-- UPDATE public.platform_settings SET value = '{"email": false}'::jsonb WHERE key='alert_channels';
--
-- -- ٢) إزالةُ ما أُضيف (بعد إطفاء القناة):
-- DROP FUNCTION IF EXISTS public.taki_alert_dispatch(text, text, text, text);
-- DROP TABLE IF EXISTS public.taki_alert_log;
-- DELETE FROM public.platform_settings WHERE key IN ('alert_email','alert_channels');
-- -- ⚠️ وإسقاطُ الموزّع **قبل** إعادةِ بناء الدالّتين يجعل نداءَهما يفشل —
-- --    لكنّ النداءَ محاطٌ بمعالِجٍ فيبتلع الخطأ ولا يسقط النبض. ومع ذلك
-- --    الترتيبُ الصحيح: أعِد بناءَ الدالّتين أوّلاً ثمّ أسقِط الموزّع.
--
-- -- ٣) السرّ (اختياريّ — لا يضرّ بقاؤه، ويلزم إن أُعيدت الهجرة).
-- --    🪤 ولا `vault.delete_secret` في هذه النسخة (0.3.1) — قِيس: الخزنةُ
-- --       تُصدِّر `create_secret` و`update_secret` وحدهما. فالحذفُ بالجدول:
-- DELETE FROM vault.secrets WHERE name = 'app_secret:resend_api_key';
