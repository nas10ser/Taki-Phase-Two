-- ═══════════════════════════════════════════════════════════════════════════
-- v16.37 — «كم شخصٍ دخل، وكم سجّل، وكم لم يسجّل» في شاشة الزوّار
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 طلبُ ناصر (١٧ نوفمبر ٢٠٢٦): «اريد تحليل كامل لزائرين الموقع غير المسجلين
--    على غرار المسجلين — كم شخص دخل، سجّل، ولم يسجّل، والمجموع الذي دخلوا
--    اليوم أو أي عدد أيام أضعه، وكم سواء كان مسجلاً في الموقع أو لا».
--
-- والمقيسُ قبل التعديل (جدة، ١٨ نوفمبر): `site_sessions` فيها **٧٩٢ جلسة**
-- منذ ٢٢ سبتمبر — ١٢٤ بحساب و**٦٦٨ بلا حساب** (٨٤٪). أي أن البيانات كانت
-- موجودةً كاملةً، و`admin_site_traffic` تُرجع `signed_in` بالفعل — والشاشةُ
-- وحدها لا تعرض الزوّارَ بلا حساب. فالناقصُ طرفان لا ثلاثة:
--   ① عرضُ «بلا حساب» (أُصلح في الشاشة، بلا هجرة).
--   ② **عددُ من سجّل فعلاً في الفترة** — وهو وحده ما يحتاج هذه الهجرة.
--
-- 🪤 ولا تُغيَّر صيغةُ الإرجاع ولا التوقيع: `CREATE OR REPLACE` على دالّةٍ
--    بنفس المُعاملات ونفس `RETURNS jsonb` — فلا `DROP` ولا نداءٌ ملتبس
--    (فخُّ v14.25: مُعاملٌ جديد يُنشئ نسخةً ثانية فيصمت المنادون).
-- 🪤 والمفاتيحُ تُضاف ولا يُمسّ قائمٌ — فنسخةُ الموقع القديمة تبقى تعمل حتى
--    تصلها النشرة.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── حارسٌ يرفض التنفيذ على المختبر ─────────────────────────────────────────
DO $guard$
BEGIN
    IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
       LIKE '%TAKI_LAB_TOKYO_MARKER%' THEN
        RAISE EXCEPTION 'هذه هجرةُ إنتاج — ورُفض تنفيذُها على المختبر (طوكيو).';
    END IF;
END $guard$;

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
      -- v16.37 — من سجّل فعلاً في الفترة. حسابٌ مستقلٌّ عن الجلسات عمداً:
      -- الجلسةُ قد تبدأ بلا حساب ثمّ يُسجّل صاحبُها، فلا يُقرأ التسجيلُ من
      -- `site_sessions`. 🪤 والمحذوفون مستثنون (`deleted_at IS NULL`) فلا
      -- يُعدّ من ألغى حسابَه تسجيلاً قائماً.
      'signups', (
        SELECT jsonb_build_object(
          'total',  count(*),
          'buyers', count(*) FILTER (WHERE user_type = 'buyer'),
          'stores', count(*) FILTER (WHERE user_type <> 'buyer')
        ) FROM users WHERE created_at >= v_from AND deleted_at IS NULL
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

-- ── تحقّقٌ يرفع استثناءً (لا جدولَ ✅/❌ — ذاك لا يُفشل psql) ───────────────
DO $verify$
DECLARE
    v_src  text;
    v_keys text[];
BEGIN
    SELECT pg_get_functiondef(p.oid) INTO v_src
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'admin_site_traffic' AND p.prokind = 'f';

    IF v_src IS NULL THEN
        RAISE EXCEPTION 'admin_site_traffic غير موجودة بعد التنفيذ';
    END IF;

    -- ① المفتاحُ الجديد موجودٌ في **جسم** الدالّة لا في تعليقٍ فوقها.
    --    🪤 يُجرَّد التعليقُ أوّلاً: حارسٌ سابقٌ في هذا المشروع أمسك تعليقَه هو.
    IF position('''signups''' in regexp_replace(v_src, '--[^\n]*', '', 'g')) = 0 THEN
        RAISE EXCEPTION 'المفتاح signups لم يدخل جسمَ الدالّة';
    END IF;

    -- ② نسخةٌ واحدة لا نسختان (فخُّ الحِمل الزائد).
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname='public' AND p.proname='admin_site_traffic') <> 1 THEN
        RAISE EXCEPTION 'توجد أكثرُ من نسخةٍ من admin_site_traffic — النداءُ سيصير ملتبساً';
    END IF;

    -- ③ وما زالت محروسةً بالصلاحية (لا تُفتح للجميع بالخطأ).
    IF position('taki_admin_perm' in v_src) = 0 THEN
        RAISE EXCEPTION 'حارسُ الصلاحية سقط من admin_site_traffic';
    END IF;

    -- ④ والعدُّ يعمل فعلاً: يُنفَّذ الاستعلامُ نفسُه خارج الدالّة (داخلها
    --    يَحرسه `taki_admin_perm` وجلسةُ psql بلا `auth.uid()` فتُرفض عند الباب
    --    — درسُ v15.00). المقصودُ إثباتُ أن الأعمدة موجودةٌ والنوعُ صالح.
    PERFORM count(*) FROM users
     WHERE created_at >= now() - interval '30 days' AND deleted_at IS NULL;

    SELECT array_agg(k ORDER BY k) INTO v_keys FROM (
        SELECT jsonb_object_keys(jsonb_build_object('total',1,'buyers',2,'stores',3)) AS k
    ) q;
    IF v_keys IS DISTINCT FROM ARRAY['buyers','stores','total'] THEN
        RAISE EXCEPTION 'شكلُ signups غير متوقَّع: %', v_keys;
    END IF;

    RAISE NOTICE '✅ admin_site_traffic: أُضيف signups (total · buyers · stores) — نسخةٌ واحدة والحارسُ قائم';
END $verify$;
