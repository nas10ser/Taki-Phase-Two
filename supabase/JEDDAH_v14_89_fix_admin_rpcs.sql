-- ═══════════════════════════════════════════════════════════════════════════
-- v14.89 — دالّتان في لوحة الإدارة لم تعملا قطّ، وخطؤهما يُبتلع
-- ═══════════════════════════════════════════════════════════════════════════
-- كيف اكتُشفتا: بقياسٍ حيّ لشاشة «التحليلات» أثناء إعادة بناء اللوحة. كلّ
-- فتحةٍ للشاشة تُنتج خطأين في طرفية المتصفّح، و`adminService` يبتلعهما
-- ويُرجع `[]` — فيظهر القسمان فارغين بلا أي أثرٍ يقول إنهما فشلا.
--
-- ١) `admin_bot_analytics` ⇒ «integer out of range»
--    `30*86400000` = ٢٫٥٩ مليار، وكلاهما `integer` — فالضربُ يتجاوز سقف
--    `int4` (٢٫١٤ مليار) **قبل** أن يُسنَد إلى `bigint`.
--    🪤 وهو فخٌّ مسجَّل في قواعد المشروع حرفياً: «cast ::bigint before
--       ms/epoch multiplication». وقع مرّةً أخرى في دالّةٍ أخرى.
--    الأثر: «الحجوزات حسب القناة (آخر ٣٠ يوماً)» — ومعها كل لوحة تحليلات
--    البوتين — لم تُعرض ولا مرّة.
--
-- ٢) `admin_browse_no_book` ⇒ «column reference "user_id" is ambiguous»
--    الدالّة `RETURNS TABLE(user_id text, …)`، وفي جسمها
--      WHERE wv.user_id NOT IN (SELECT user_id FROM window_books …)
--    فـ`user_id` داخل الاستعلام الفرعي تحتمل عمودَ `window_books` ومتغيّرَ
--    الإخراج معاً. الأثر: «شاهدوا ولم يحجزوا» فارغٌ دائماً.
--    🪤 نفس فخّ v14.89 الأول (`get_recent_activity`) — وهو ثالث ظهورٍ له.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
END
$guard$;

-- ── ١) تجاوز العدد الصحيح ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_bot_analytics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v jsonb; v_cut bigint;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden: admin only'; END IF;
  -- 🪤 `30::bigint` قبل الضرب: بدونه يُحسب الطرفان `int4` فيتجاوز السقف.
  v_cut := (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint - (30::bigint * 86400000);
  SELECT jsonb_build_object(
    'tg_linked',   (SELECT count(*) FROM users WHERE telegram_id IS NOT NULL AND deleted_at IS NULL),
    'wa_linked',   (SELECT count(*) FROM users WHERE whatsapp_chat_id IS NOT NULL AND deleted_at IS NULL),
    'both_linked', (SELECT count(*) FROM users WHERE telegram_id IS NOT NULL AND whatsapp_chat_id IS NOT NULL AND deleted_at IS NULL),
    'total_users', (SELECT count(*) FROM users WHERE deleted_at IS NULL),
    'lang_ar',     (SELECT count(*) FROM users WHERE (bot_lang='ar' OR bot_lang IS NULL) AND (telegram_id IS NOT NULL OR whatsapp_chat_id IS NOT NULL) AND deleted_at IS NULL),
    'lang_en',     (SELECT count(*) FROM users WHERE bot_lang='en' AND (telegram_id IS NOT NULL OR whatsapp_chat_id IS NOT NULL) AND deleted_at IS NULL),
    'bookings_total', jsonb_build_object(
       'web',      (SELECT count(*) FROM bookings WHERE source='web'),
       'telegram', (SELECT count(*) FROM bookings WHERE source='telegram'),
       'whatsapp', (SELECT count(*) FROM bookings WHERE source='whatsapp')),
    'bookings_30d', jsonb_build_object(
       'web',      (SELECT count(*) FROM bookings WHERE source='web'      AND booked_at >= v_cut),
       'telegram', (SELECT count(*) FROM bookings WHERE source='telegram' AND booked_at >= v_cut),
       'whatsapp', (SELECT count(*) FROM bookings WHERE source='whatsapp' AND booked_at >= v_cut)),
    'deals_total', jsonb_build_object(
       'web',      (SELECT count(*) FROM deals WHERE source='web'),
       'telegram', (SELECT count(*) FROM deals WHERE source='telegram'),
       'whatsapp', (SELECT count(*) FROM deals WHERE source='whatsapp'))
  ) INTO v;
  RETURN v;
END;
$fn$;

-- ── ٢) المرجع الملتبس ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_browse_no_book(p_days integer DEFAULT 30, p_limit integer DEFAULT 20)
RETURNS TABLE (
    user_id text,
    name text,
    phone text,
    views_count integer,
    last_viewed_at timestamp with time zone,
    deals_seen integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden: admin only'; END IF;

  RETURN QUERY
  WITH window_views AS (
      SELECT al.user_id AS uid,
             count(*)::int AS views_count,
             max(al.created_at) AS last_viewed_at,
             count(DISTINCT al.entity_id)::int AS deals_seen
        FROM activity_log al
       WHERE al.action = 'view_deal'
         AND al.created_at >= NOW() - (p_days || ' days')::interval
         AND al.user_id IS NOT NULL
       GROUP BY al.user_id
  ),
  window_books AS (
      SELECT DISTINCT al.user_id AS uid
        FROM activity_log al
       WHERE al.action = 'book'
         AND al.created_at >= NOW() - (p_days || ' days')::interval
         AND al.user_id IS NOT NULL
  )
  -- 🪤 الأعمدة مؤهَّلةٌ بأسماءٍ لا تصادم عمودَ الإخراج (`uid` لا `user_id`):
  --    بلا ذلك يلتبس `user_id` داخل الاستعلام الفرعي فتفشل الدالّة كلّها.
  SELECT wv.uid, u.name, u.phone, wv.views_count, wv.last_viewed_at, wv.deals_seen
    FROM window_views wv
    JOIN users u ON u.id = wv.uid
   WHERE wv.uid NOT IN (SELECT wb.uid FROM window_books wb)
     AND u.deleted_at IS NULL
   ORDER BY wv.views_count DESC
   LIMIT p_limit;
END;
$fn$;

-- ── تحقّقٌ يرفع استثناءً ──────────────────────────────────────────────────
-- 🪤 ولا يُنفَّذ نداءٌ حقيقي هنا: الدالّتان محروستان بـ`is_admin()` التي تقرأ
--    `auth.uid()` — وهي عَدَمٌ في جلسة الهجرة (دور `supabase_admin`). فتنفيذُهما
--    يُفشل الهجرة **لسببٍ سليم** لا لعيب. التحقّق يقيس ما يمكن قياسه صدقاً:
--    أن الإصلاحين موجودان في نصّ الدالّتين فعلاً.
DO $verify$
DECLARE v_bot text; v_browse text;
BEGIN
  SELECT prosrc INTO v_bot    FROM pg_proc WHERE proname = 'admin_bot_analytics';
  SELECT prosrc INTO v_browse FROM pg_proc WHERE proname = 'admin_browse_no_book';

  IF v_bot IS NULL OR v_browse IS NULL THEN
    RAISE EXCEPTION 'إحدى الدالّتين غير موجودة بعد التنفيذ';
  END IF;
  IF v_bot !~ '30::bigint' THEN
    RAISE EXCEPTION 'تجاوز العدد الصحيح لم يُصلَح — الضرب ما زال بلا ::bigint';
  END IF;
  IF v_browse ~ 'SELECT user_id FROM window_books' THEN
    RAISE EXCEPTION 'المرجع الملتبس ما زال قائماً في admin_browse_no_book';
  END IF;
  IF v_browse !~ 'wb\.uid' THEN
    RAISE EXCEPTION 'التأهيل لم يُطبَّق في admin_browse_no_book';
  END IF;

  RAISE NOTICE '✅ الإصلاحان مُثبَتان في نصّ الدالّتين.';
END
$verify$;
