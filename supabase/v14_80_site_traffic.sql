-- ════════════════════════════════════════════════════════════════════════════
-- v14.80 — قياس الزوّار ومصادرهم (طلب ناصر: «لا أعرف كم زائراً ومن أين»)
-- ════════════════════════════════════════════════════════════════════════════
-- ما كان مقيساً قبل اليوم: كل ما تقيسه المنصّة **مربوطٌ بـ`store_id`** —
-- `store_analytics_events` (٧٨ صفّاً) قِمَع التاجر، و`analytics_events`
-- (٧٨٨ صفّاً) أحداثٌ داخل التطبيق. ولا عمود `referrer` ولا `utm_*` ولا `path`
-- في أيٍّ منهما، و`document.referrer` لا يظهر في `src/` إطلاقاً. أي أن قناة
-- الوصول **غير قابلة للقياس على مستوى المخطّط** لا «غير معروضة».
-- والنتيجة: زائرٌ يفتح الصفحة الرئيسية ويخرج = **غير مرئيّ تماماً**.
--
-- وما يحتاجه ناصر ثلاثة أسئلة بعينها، وهذا الجدول يجيبها كلّها:
--   كم زائراً؟        ⇐ عدد الجلسات في اليوم
--   من أي قناة؟       ⇐ `channel` (تُشتقّ على الخادم، فلا تختلف نسختان)
--   أي صفحة أوقفتهم؟  ⇐ `last_path` لجلسةٍ لم تحجز
--
-- ── الخصوصية: ما لا يُخزَّن هنا عمداً ──────────────────────────────────────
--  • **لا عنوان إنترنت ولا بصمة جهاز ولا كعكة.** المعرّف الوحيد
--    `session_id` من `sessionStorage` — يموت بإغلاق التبويب ولا يُعرّف شخصاً.
--  • المُحيل يُختزل إلى **اسم المضيف وحده** على الخادم: المسار والاستعلام
--    يُقصّان قبل الكتابة، فلا يتسرّب ما كان يقرؤه الزائر في موقعٍ آخر.
--  • المسارات تُنظَّف من كل استعلامٍ عدا `utm_*`، فلا يُخزَّن رمز دعوةٍ أو
--    باركود وقع في العنوان.
--  • `user_id` يُكتب فقط إن كان الزائر داخلاً أصلاً، ووصلتُه `SET NULL`.
--  • حذفٌ تلقائي بعد **١٨٠ يوماً**.
--
-- 🪤 والدالّة مفتوحة للزائر (`anon`) بالضرورة — وهذه سابقةٌ قائمة
--    (`track_app_open` كذلك منذ إصدارات). ولأنها مفتوحة، فيها **حدٌّ عالميّ**
--    على إنشاء الجلسات: لا تُنشأ أكثر من ٣٠٠ جلسة في الدقيقة مهما كان المصدر،
--    فأسوأ حالةٍ محدودة بدل نموٍّ بلا سقف. والتحديث على جلسةٍ قائمة لا يُنشئ
--    صفّاً، و`page_count` مسقوفٌ بـ٥٠٠ فلا يُنفخ إلى ما لا نهاية.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'رُفض: هذا خادم المختبر (طوكيو) — هجرات الإنتاج تُطبَّق على جدة';
  END IF;
END $guard$;

-- ١) الجدول ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.site_sessions (
    session_id    text PRIMARY KEY,
    started_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    landing_path  text        NOT NULL DEFAULT '/',
    referrer_host text,
    channel       text        NOT NULL DEFAULT 'direct',
    utm_source    text,
    utm_medium    text,
    utm_campaign  text,
    ref_code      text,
    device        text,
    is_pwa        boolean     NOT NULL DEFAULT false,
    lang          text,
    page_count    integer     NOT NULL DEFAULT 1,
    last_path     text,
    user_id       text REFERENCES public.users(id) ON DELETE SET NULL,
    booked        boolean     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_site_sessions_started ON public.site_sessions (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_sessions_channel ON public.site_sessions (channel, started_at DESC);

ALTER TABLE public.site_sessions ENABLE ROW LEVEL SECURITY;

-- القراءة للأدمن وحده: الجدول يحمل سلوك تصفّحٍ، وإن كان بلا هوية.
DROP POLICY IF EXISTS site_sessions_admin_read ON public.site_sessions;
CREATE POLICY site_sessions_admin_read ON public.site_sessions
    FOR SELECT TO authenticated
    USING (public.taki_admin_perm('tab_analytics'));

-- لا سياسة كتابة إطلاقاً: الكتابة عبر الدالّة المالكة وحدها.
REVOKE ALL ON public.site_sessions FROM PUBLIC;
REVOKE ALL ON public.site_sessions FROM anon;
GRANT SELECT ON public.site_sessions TO authenticated;

-- ٢) اشتقاق القناة — **على الخادم** فلا تفترق نسختان ─────────────────────────
CREATE OR REPLACE FUNCTION public.taki_traffic_channel(p_host text, p_utm_source text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN COALESCE(btrim(p_utm_source), '') <> '' THEN lower(btrim(p_utm_source))
    WHEN COALESCE(btrim(p_host), '') = ''        THEN 'direct'
    WHEN p_host ~ '(^|\.)takisa\.net$'           THEN 'internal'
    WHEN p_host ~ '(^|\.)(google|bing|duckduckgo|yandex|yahoo)\.' THEN 'search'
    WHEN p_host ~ '(^|\.)instagram\.com$'        THEN 'instagram'
    WHEN p_host ~ '(^|\.)(twitter\.com|x\.com|t\.co)$' THEN 'twitter'
    WHEN p_host ~ '(^|\.)(facebook\.com|fb\.me)$'THEN 'facebook'
    WHEN p_host ~ '(^|\.)snapchat\.com$'         THEN 'snapchat'
    WHEN p_host ~ '(^|\.)tiktok\.com$'           THEN 'tiktok'
    WHEN p_host ~ '(^|\.)linkedin\.com$'         THEN 'linkedin'
    WHEN p_host ~ '(^|\.)(t\.me|telegram\.org|telegram\.me)$' THEN 'telegram'
    WHEN p_host ~ '(^|\.)(wa\.me|whatsapp\.com)$' THEN 'whatsapp'
    ELSE 'referral'
  END;
$function$;

-- ٣) تسجيل الزيارة ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.track_site_visit(
    p_session   text,
    p_path      text,
    p_referrer  text    DEFAULT NULL,
    p_utm       jsonb   DEFAULT '{}'::jsonb,
    p_device    text    DEFAULT NULL,
    p_pwa       boolean DEFAULT false,
    p_lang      text    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_sid   text := left(btrim(COALESCE(p_session, '')), 64);
    v_uid   text := auth.uid()::text;
    v_path  text;
    v_host  text;
    v_src   text := left(btrim(COALESCE(p_utm->>'source',   '')), 64);
    v_med   text := left(btrim(COALESCE(p_utm->>'medium',   '')), 64);
    v_camp  text := left(btrim(COALESCE(p_utm->>'campaign', '')), 64);
    v_ref   text := left(btrim(COALESCE(p_utm->>'ref',      '')), 32);
    v_dev   text := CASE WHEN p_device IN ('mobile','tablet','desktop') THEN p_device END;
    v_lang  text := CASE WHEN p_lang IN ('ar','en') THEN p_lang END;
    v_new   integer;
BEGIN
    -- معرّف جلسةٍ مشوّه أو غائب ⇒ لا نكتب شيئاً (ولا نُخطئ: القياس لا يُفشل تصفّحاً).
    IF v_sid !~ '^[A-Za-z0-9_.-]{8,64}$' THEN RETURN; END IF;

    -- المسار: بلا مضيف، وبلا أي استعلام (فلا يُخزَّن باركود ولا رمز في العنوان).
    v_path := left(split_part(split_part(COALESCE(p_path, '/'), '?', 1), '#', 1), 120);
    IF v_path = '' THEN v_path := '/'; END IF;
    IF left(v_path, 1) <> '/' THEN v_path := '/' || v_path; END IF;

    -- المُحيل: **اسم المضيف وحده**.
    IF COALESCE(btrim(p_referrer), '') <> '' THEN
        v_host := left(lower(split_part(split_part(regexp_replace(p_referrer, '^[a-z]+://', '', 'i'), '/', 1), ':', 1)), 120);
        IF v_host !~ '^[a-z0-9.-]+\.[a-z]{2,}$' THEN v_host := NULL; END IF;
    END IF;

    -- تحديثُ جلسةٍ قائمة: لا صفّ جديد، ولا يُعاد كتابة مصدر الوصول
    -- (الإسناد لأوّل لمسة — وهو الصحيح: القناة التي جلبته لا التي تنقّل فيها).
    UPDATE public.site_sessions
       SET last_seen_at = now(),
           page_count   = LEAST(page_count + 1, 500),
           last_path    = v_path,
           user_id      = COALESCE(user_id, v_uid)
     WHERE session_id = v_sid;
    IF FOUND THEN RETURN; END IF;

    -- 🪤 الدالّة مفتوحة للزائر، فإنشاء الجلسات محدودٌ عالمياً: أسوأ حالةٍ
    --    مسقوفة بدل نموٍّ بلا حدّ. والتحديث أعلاه لا يمرّ من هنا إطلاقاً.
    SELECT count(*) INTO v_new FROM public.site_sessions
     WHERE started_at > now() - interval '1 minute';
    IF v_new >= 300 THEN RETURN; END IF;

    INSERT INTO public.site_sessions (
        session_id, landing_path, referrer_host, channel,
        utm_source, utm_medium, utm_campaign, ref_code,
        device, is_pwa, lang, last_path, user_id
    ) VALUES (
        v_sid, v_path, v_host, public.taki_traffic_channel(v_host, v_src),
        NULLIF(v_src,''), NULLIF(v_med,''), NULLIF(v_camp,''), NULLIF(v_ref,''),
        v_dev, COALESCE(p_pwa, false), v_lang, v_path, v_uid
    )
    ON CONFLICT (session_id) DO NOTHING;   -- سباقُ تبويبين على نفس الجلسة
END $function$;

REVOKE ALL ON FUNCTION public.track_site_visit(text,text,text,jsonb,text,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_site_visit(text,text,text,jsonb,text,boolean,text) TO anon, authenticated;

-- ٤) وسمُ الجلسة التي حجزت — ليُقاس التحويل لا الزيارات وحدها ────────────────
CREATE OR REPLACE FUNCTION public.taki_mark_session_booked(p_session text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    UPDATE public.site_sessions SET booked = true, last_seen_at = now()
     WHERE session_id = left(btrim(COALESCE(p_session,'')), 64);
END $function$;

REVOKE ALL ON FUNCTION public.taki_mark_session_booked(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.taki_mark_session_booked(text) TO anon, authenticated;

-- ٥) قراءة الأدمن ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_site_traffic(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_days int := GREATEST(1, LEAST(COALESCE(p_days, 30), 365));
    v_from timestamptz := now() - (v_days || ' days')::interval;
    v jsonb;
BEGIN
    IF NOT public.taki_admin_perm('tab_analytics') THEN
        RAISE EXCEPTION 'forbidden: analytics permission required';
    END IF;

    SELECT jsonb_build_object(
      'days', v_days,
      'totals', (
        SELECT jsonb_build_object(
          'sessions',  count(*),
          'booked',    count(*) FILTER (WHERE booked),
          'bounced',   count(*) FILTER (WHERE page_count <= 1),
          'signed_in', count(*) FILTER (WHERE user_id IS NOT NULL),
          'pwa',       count(*) FILTER (WHERE is_pwa)
        ) FROM site_sessions WHERE started_at >= v_from
      ),
      'daily', COALESCE((
        SELECT jsonb_agg(x ORDER BY x->>'d')
          FROM (SELECT jsonb_build_object(
                        'd', to_char(date_trunc('day', started_at AT TIME ZONE 'Asia/Riyadh'), 'YYYY-MM-DD'),
                        'n', count(*),
                        'booked', count(*) FILTER (WHERE booked)) AS x
                  FROM site_sessions WHERE started_at >= v_from
                 -- 🪤 `GROUP BY 1` هنا يشير إلى `x` نفسه (وهو يحوي تجميعاً)
                 --    لا إلى التاريخ — فيُرفض. التجميع على التعبير صراحةً.
                 GROUP BY date_trunc('day', started_at AT TIME ZONE 'Asia/Riyadh')) t
      ), '[]'::jsonb),
      'channels', COALESCE((
        SELECT jsonb_agg(x ORDER BY (x->>'n')::int DESC)
          FROM (SELECT jsonb_build_object(
                        'channel', channel, 'n', count(*),
                        'booked', count(*) FILTER (WHERE booked)) AS x
                  FROM site_sessions WHERE started_at >= v_from
                 GROUP BY channel) t
      ), '[]'::jsonb),
      'referrers', COALESCE((
        SELECT jsonb_agg(x ORDER BY (x->>'n')::int DESC)
          FROM (SELECT jsonb_build_object('host', referrer_host, 'n', count(*)) AS x
                  FROM site_sessions
                 WHERE started_at >= v_from AND referrer_host IS NOT NULL
                 GROUP BY referrer_host ORDER BY count(*) DESC LIMIT 12) t
      ), '[]'::jsonb),
      'landing', COALESCE((
        SELECT jsonb_agg(x ORDER BY (x->>'n')::int DESC)
          FROM (SELECT jsonb_build_object('path', landing_path, 'n', count(*)) AS x
                  FROM site_sessions WHERE started_at >= v_from
                 GROUP BY landing_path ORDER BY count(*) DESC LIMIT 12) t
      ), '[]'::jsonb),
      -- «أي صفحة أوقفتهم»: آخر صفحة لجلسةٍ لم تحجز
      'exits', COALESCE((
        SELECT jsonb_agg(x ORDER BY (x->>'n')::int DESC)
          FROM (SELECT jsonb_build_object('path', last_path, 'n', count(*)) AS x
                  FROM site_sessions
                 WHERE started_at >= v_from AND NOT booked AND last_path IS NOT NULL
                 GROUP BY last_path ORDER BY count(*) DESC LIMIT 12) t
      ), '[]'::jsonb),
      'campaigns', COALESCE((
        SELECT jsonb_agg(x ORDER BY (x->>'n')::int DESC)
          FROM (SELECT jsonb_build_object(
                        'source', utm_source, 'medium', utm_medium, 'campaign', utm_campaign,
                        'n', count(*), 'booked', count(*) FILTER (WHERE booked)) AS x
                  FROM site_sessions
                 WHERE started_at >= v_from AND utm_source IS NOT NULL
                 GROUP BY utm_source, utm_medium, utm_campaign ORDER BY count(*) DESC LIMIT 12) t
      ), '[]'::jsonb),
      'devices', COALESCE((
        SELECT jsonb_agg(x ORDER BY (x->>'n')::int DESC)
          FROM (SELECT jsonb_build_object('device', COALESCE(device,'?'), 'n', count(*)) AS x
                  FROM site_sessions WHERE started_at >= v_from
                 GROUP BY COALESCE(device,'?')) t
      ), '[]'::jsonb)
    ) INTO v;
    RETURN v;
END $function$;

REVOKE ALL ON FUNCTION public.admin_site_traffic(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_site_traffic(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_site_traffic(integer) TO authenticated;

-- ٦) احتفاظٌ محدود: ١٨٠ يوماً ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_old_site_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE n int;
BEGIN
    WITH d AS (DELETE FROM public.site_sessions
                WHERE started_at < now() - interval '180 days' RETURNING 1)
    SELECT count(*) INTO n FROM d;
    RETURN COALESCE(n, 0);
END $function$;

REVOKE ALL ON FUNCTION public.purge_old_site_sessions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_old_site_sessions() FROM anon;
REVOKE ALL ON FUNCTION public.purge_old_site_sessions() FROM authenticated;

SELECT cron.unschedule('taki-purge-site-sessions')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'taki-purge-site-sessions');
SELECT cron.schedule('taki-purge-site-sessions', '20 4 * * *',
                     $$SELECT public.purge_old_site_sessions();$$);

-- ٧) تحقّقات تُفشل الهجرة إن كذبت ─────────────────────────────────────────────
DO $verify$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM information_schema.tables
     WHERE table_schema='public' AND table_name='site_sessions';
    IF n <> 1 THEN RAISE EXCEPTION 'الجدول لم يُنشأ'; END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='site_sessions' AND relrowsecurity) THEN
        RAISE EXCEPTION 'RLS غير مفعّلة على site_sessions';
    END IF;

    IF has_table_privilege('anon', 'public.site_sessions', 'INSERT')
       OR has_table_privilege('anon', 'public.site_sessions', 'SELECT') THEN
        RAISE EXCEPTION 'الزائر يملك صلاحية مباشرة على الجدول — الكتابة بالدالّة وحدها';
    END IF;

    IF NOT has_function_privilege('anon', 'public.track_site_visit(text,text,text,jsonb,text,boolean,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'الزائر لا يستطيع تسجيل زيارته — لا قياس إطلاقاً';
    END IF;
    IF has_function_privilege('anon', 'public.admin_site_traffic(integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'تقرير الزوّار مكشوف للزائر';
    END IF;

    -- اشتقاق القناة: موجب وسالب
    IF public.taki_traffic_channel('www.google.com', NULL) <> 'search' THEN RAISE EXCEPTION 'جوجل لم تُصنَّف بحثاً'; END IF;
    IF public.taki_traffic_channel(NULL, NULL) <> 'direct' THEN RAISE EXCEPTION 'بلا مُحيل ليست مباشرة'; END IF;
    IF public.taki_traffic_channel('www.instagram.com', NULL) <> 'instagram' THEN RAISE EXCEPTION 'انستقرام'; END IF;
    IF public.taki_traffic_channel('evil-google.com', NULL) = 'search' THEN RAISE EXCEPTION 'مضيفٌ مزيّف صُنّف بحثاً — النمط بلا نقطة'; END IF;
    IF public.taki_traffic_channel('x.com', 'instagram') <> 'instagram' THEN RAISE EXCEPTION 'utm يجب أن يسبق المُحيل'; END IF;

    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='taki-purge-site-sessions') THEN
        RAISE EXCEPTION 'وظيفة الحذف لم تُجدوَل';
    END IF;

    RAISE NOTICE '✅ v14.80 مطبَّقة — قياس الزوّار جاهز';
END $verify$;

SELECT count(*) AS "جلسات" FROM public.site_sessions;
