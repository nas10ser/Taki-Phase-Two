-- ═══════════════════════════════════════════════════════════════════════════
-- v16.38 — «النشطون الآن» — مسجَّلون وزوّار، بالساعة وبالتفصيل
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 طلبُ ناصر (١٨ نوفمبر ٢٠٢٦): «ولا تنسى تضع بالساعه النشطون لحظيا سواء
--    للمسجلين او الزائرين وايضا تفاصيلهما».
--
-- والقياسُ قبل البناء (جدة، ١٨ نوفمبر): `site_sessions.last_seen_at` **نبضٌ
-- حقيقيٌّ لا طابعُ إنشاء** — ٢٦٤ جلسةً يتأخّر فيها `last_seen_at` عن
-- `started_at` بأكثر من خمس ثوانٍ. فالنشاطُ اللحظيُّ مقيسٌ أصلاً ولا يحتاج
-- تتبّعاً جديداً: آخرُ ساعةٍ ٣ جلسات (١ بحساب · ٢ زائر)، وآخرُ ٢٤ ساعةً ٢٠.
--
-- ⇒ دالّةٌ واحدة تُجيب الأسئلةَ الثلاثة معاً، فلا ثلاثةُ نداءاتٍ لشاشةٍ واحدة:
--   · `now`     — من هو نشطٌ داخل النافذة (افتراضُها ١٥ دقيقة).
--   · `hourly`  — ٢٤ ساعةً مضت، كلُّ ساعةٍ مقسومةٌ مسجَّل/زائر (بتوقيت الرياض).
--   · `details` — تفاصيلُ الجلسات النشطة الآن.
--
-- 🔒 **والخصوصية**: الدالّةُ محروسةٌ بـ`taki_admin_perm('tab_analytics')`،
--    ولا تُرجع عنوانَ إنترنتٍ ولا معرّفاً دائماً (وهما غيرُ مخزَّنين أصلاً).
--    واسمُ المستخدم يظهر **للمسجَّل وحده** — والزائرُ لا اسمَ له ولا يُختلق له.
-- 🪤 ولا يُرجَع `session_id` إلى الواجهة: معرّفُ جلسةٍ حيٌّ بيد شاشةٍ لا حاجةَ
--    له، ووجودُه يُغري بربط الزائر عبر الزيارات. يُستعمل داخلياً للعدّ فقط.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
    IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
       LIKE '%TAKI_LAB_TOKYO_MARKER%' THEN
        RAISE EXCEPTION 'هذه هجرةُ إنتاج — ورُفض تنفيذُها على المختبر (طوكيو).';
    END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.admin_live_now(p_minutes integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    -- السقفُ ٢٤٠ دقيقة: ما فوقها ليس «الآن» بل تقريرُ فترة، وله `admin_site_traffic`.
    v_min  int := GREATEST(1, LEAST(COALESCE(p_minutes, 15), 240));
    v_from timestamptz := now() - (v_min || ' minutes')::interval;
    v jsonb;
BEGIN
    IF NOT public.taki_admin_perm('tab_analytics') THEN
        RAISE EXCEPTION 'forbidden: analytics permission required';
    END IF;

    SELECT jsonb_build_object(
      'minutes', v_min,
      'now', (
        SELECT jsonb_build_object(
          'total',     count(*),
          'signed_in', count(*) FILTER (WHERE user_id IS NOT NULL),
          'guests',    count(*) FILTER (WHERE user_id IS NULL),
          'pwa',       count(*) FILTER (WHERE is_pwa)
        ) FROM site_sessions WHERE last_seen_at >= v_from
      ),
      -- ٢٤ ساعةً مضت. 🪤 التجميعُ على التعبير صراحةً لا `GROUP BY 1`:
      --    الأخيرةُ تشير إلى الكائن المبنيّ (وفيه تجميع) فتُرفض — فخٌّ مسجَّل.
      'hourly', COALESCE((
        SELECT jsonb_agg(x ORDER BY x->>'h')
          FROM (SELECT jsonb_build_object(
                        'h', to_char(date_trunc('hour', last_seen_at AT TIME ZONE 'Asia/Riyadh'), 'YYYY-MM-DD HH24'),
                        'signed_in', count(*) FILTER (WHERE user_id IS NOT NULL),
                        'guests',    count(*) FILTER (WHERE user_id IS NULL),
                        'n', count(*)) AS x
                  FROM site_sessions
                 WHERE last_seen_at >= now() - interval '24 hours'
                 GROUP BY date_trunc('hour', last_seen_at AT TIME ZONE 'Asia/Riyadh')) t
      ), '[]'::jsonb),
      'details', COALESCE((
        SELECT jsonb_agg(x ORDER BY x->>'last_seen' DESC)
          FROM (SELECT jsonb_build_object(
                        'signed_in', (s.user_id IS NOT NULL),
                        -- الاسمُ للمسجَّل وحده؛ والزائرُ يبقى بلا هويّة.
                        'who',       CASE WHEN s.user_id IS NULL THEN NULL ELSE u.name END,
                        'kind',      CASE WHEN s.user_id IS NULL THEN NULL ELSE u.user_type END,
                        'device',    COALESCE(s.device, '?'),
                        'channel',   COALESCE(s.channel, '?'),
                        'lang',      s.lang,
                        'is_pwa',    COALESCE(s.is_pwa, false),
                        'pages',     COALESCE(s.page_count, 0),
                        'path',      s.last_path,
                        'booked',    COALESCE(s.booked, false),
                        'started',   to_char(s.started_at   AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI'),
                        'last_seen', to_char(s.last_seen_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI')) AS x
                  FROM site_sessions s
                  LEFT JOIN users u ON u.id = s.user_id
                 WHERE s.last_seen_at >= v_from
                 ORDER BY s.last_seen_at DESC
                 LIMIT 60) t
      ), '[]'::jsonb)
    ) INTO v;
    RETURN v;
END $function$;

-- الصلاحيةُ كما لأخواتها: الحارسُ داخلَ الجسم، والمنحُ للموثَّقين فقط.
REVOKE ALL ON FUNCTION public.admin_live_now(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_live_now(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_live_now(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_live_now(integer) TO service_role;

-- ── تحقّقٌ يرفع استثناءً ───────────────────────────────────────────────────
DO $verify$
DECLARE
    v_src text;
    v_acl text;
BEGIN
    SELECT pg_get_functiondef(p.oid), array_to_string(p.proacl, ' | ')
      INTO v_src, v_acl
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'admin_live_now' AND p.prokind = 'f';

    IF v_src IS NULL THEN
        RAISE EXCEPTION 'admin_live_now غير موجودة بعد التنفيذ';
    END IF;

    -- نسخةٌ واحدة (فخُّ الحِمل الزائد — أُسقطت نسخةٌ مكرّرةٌ من admin_ai_hours اليوم).
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname='public' AND p.proname='admin_live_now') <> 1 THEN
        RAISE EXCEPTION 'توجد أكثرُ من نسخةٍ من admin_live_now';
    END IF;

    -- الحارسُ قائمٌ في **جسم** الدالّة لا في تعليق (يُجرَّد التعليقُ أوّلاً).
    IF position('taki_admin_perm' in regexp_replace(v_src, '--[^\n]*', '', 'g')) = 0 THEN
        RAISE EXCEPTION 'حارسُ الصلاحية غائبٌ عن جسم admin_live_now';
    END IF;

    -- 🔴 ولا تُمنح للزائر المجهول: هذه الدالّةُ تُرجع أسماءَ مستخدمين.
    IF v_acl IS NOT NULL AND position('anon=' in v_acl) > 0 THEN
        RAISE EXCEPTION 'admin_live_now ممنوحةٌ لـanon — وهي تُرجع أسماء: %', v_acl;
    END IF;

    IF v_acl IS NULL OR position('authenticated=' in v_acl) = 0 THEN
        RAISE EXCEPTION 'admin_live_now غير ممنوحةٍ لـauthenticated — الشاشةُ لن تستطيع نداءها';
    END IF;

    RAISE NOTICE '✅ admin_live_now: نسخةٌ واحدة · الحارسُ قائم · لا منحَ لـanon';
END $verify$;
