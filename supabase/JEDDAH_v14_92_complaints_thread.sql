-- ═══════════════════════════════════════════════════════════════════════════
-- v14.92 — الشكوى تصير محادثة: مرفقاتٌ وردودٌ تصل صاحبها
-- ═══════════════════════════════════════════════════════════════════════════
-- البند الوحيد الذي لم يُبدأ من تدقيق ٩ سبتمبر:
--   «الشكوى صندوقٌ مغلق: ثلاثة حقولٍ بلا مرفقات، وبلا شاشة شكاواي، وبلا
--    ردٍّ يصل صاحبها.»
--
-- 🔴 والأسوأ من النقص أنّ **سياستنا المنشورة تَعِد بما لا يستطيع النموذج
--    استقباله**: صفحة الاسترداد توجّه المشتري إلى زرّ الشكوى وتطلب منه إرفاق
--    رقم العملية ولقطة كشف البنك — والنموذج ثلاثة حقولٍ نصّية بلا أي مرفق.
--    (وعدٌ في نصٍّ قانونيّ لا ينفّذه كود — فخٌّ مسجَّل في قواعد المشروع.)
--
-- ما تبنيه هذه الهجرة:
--   ١. مرفقاتٌ للشكوى في مستودعٍ **خاص** (صور + PDF)، لا يقرؤها إلا صاحبها
--      وفريق الإدارة.
--   ٢. جدول ردودٍ ثنائيّ الاتجاه: ردُّ الإدارة يصل صاحب الشكوى، وله أن يردّ.
--   ٣. إشعارٌ عند كل ردٍّ من الإدارة — فالشكوى لم تعد تُبتلع بصمت.
--   ٤. مهلةُ ردٍّ معلنة (`complaints_sla_hours`) تُقال للمشتري عند الإرسال،
--      وتُضبط من الإعدادات بلا نشر.
--
-- 🪤 وكل ما هنا آمنٌ للتكرار: كل `CREATE POLICY` مسبوقٌ بـ`DROP … IF EXISTS`
--    **لاسمه هو**، وكل دالّةٍ تُسقَط قبل إنشائها (لأن `CREATE OR REPLACE` لا
--    يغيّر نوع الإرجاع، ومعاملٌ جديد يُنشئ نسخةً ثانية ملتبسة).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── حارس: هذه هجرة إنتاج (جدّة) ────────────────────────────────────────────
DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) المرفقات
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS attachments text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.complaints.attachments IS
  'مساراتٌ في مستودع complaints الخاص: <user_id>/<complaint_id>/<file>';

-- مستودعٌ خاص على نمط `chat` (v14.29).
-- 🪤 heic/heif ضروريّان: كاميرا آيفون تُخرجهما، وغيابُهما يرفض صورة هاتفٍ
--    عادية **بقيد الصيغة لا الحجم** — درس v14.72.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('complaints', 'complaints', false, 5242880,
        ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

/**
 * طرفُ الشكوى: صاحبُها (أوّل مقطعٍ في المسار هو معرّفه) أو فريق الإدارة.
 * 🪤 التثبيت بالمسار لا بالامتداد: سياسةٌ تقول `name LIKE '%.jpg'` وحدها
 *    تسمح لأي موثَّقٍ بالكتابة في أي مسار وبأي عدد (درس v14.50).
 */
CREATE OR REPLACE FUNCTION public.taki_complaint_party(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT split_part(p_name, '/', 1) = auth.uid()::text
      OR public.taki_admin_perm('tab_reports');
$fn$;

DROP POLICY IF EXISTS complaints_files_read  ON storage.objects;
DROP POLICY IF EXISTS complaints_files_write ON storage.objects;
DROP POLICY IF EXISTS complaints_files_del   ON storage.objects;

CREATE POLICY complaints_files_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'complaints' AND public.taki_complaint_party(name));

CREATE POLICY complaints_files_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'complaints'
    AND split_part(name, '/', 1) = auth.uid()::text   -- يكتب في مجلّده وحده
    AND owner = auth.uid()
  );

CREATE POLICY complaints_files_del ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'complaints' AND public.taki_complaint_party(name));

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) الردود — الشكوى تصير محادثة
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.complaint_replies (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id uuid NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
    author_id    text NOT NULL,
    -- 'admin' = ردُّ الإدارة (يصل صاحب الشكوى) · 'user' = ردُّ صاحبها
    author_role  text NOT NULL CHECK (author_role IN ('admin','user')),
    body         text NOT NULL CHECK (btrim(body) <> ''),
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS complaint_replies_by_complaint
  ON public.complaint_replies (complaint_id, created_at);

ALTER TABLE public.complaint_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS complaint_replies_select ON public.complaint_replies;
DROP POLICY IF EXISTS complaint_replies_insert ON public.complaint_replies;
DROP POLICY IF EXISTS complaint_replies_admin_all ON public.complaint_replies;

-- 🪤 لا `EXISTS (SELECT FROM complaint_replies)` داخل سياسةٍ على الجدول نفسه
--    (تكرارٌ لا نهائي) — الاستعلام على `complaints` وهو جدولٌ آخر، فآمن.
CREATE POLICY complaint_replies_select ON public.complaint_replies
  FOR SELECT TO authenticated
  USING (
    public.taki_admin_perm('tab_reports')
    OR EXISTS (
      SELECT 1 FROM public.complaints c
       WHERE c.id = complaint_replies.complaint_id
         AND c.user_id = auth.uid()::text
    )
  );

CREATE POLICY complaint_replies_insert ON public.complaint_replies
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()::text
    AND (
      (author_role = 'admin' AND public.taki_admin_perm('tab_reports'))
      OR (author_role = 'user' AND EXISTS (
            SELECT 1 FROM public.complaints c
             WHERE c.id = complaint_replies.complaint_id
               AND c.user_id = auth.uid()::text))
    )
  );

CREATE POLICY complaint_replies_admin_all ON public.complaint_replies
  FOR DELETE TO authenticated
  USING (public.taki_admin_perm('tab_reports'));

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) الدوالّ
-- ═══════════════════════════════════════════════════════════════════════════

-- ── شكاواي: القائمة التي لم تكن موجودة ────────────────────────────────────
DROP FUNCTION IF EXISTS public.my_complaints(integer);
CREATE FUNCTION public.my_complaints(p_limit integer DEFAULT 50)
RETURNS TABLE (
    id            uuid,
    category      text,
    subject       text,
    message       text,
    status        text,
    attachments   text[],
    created_at    timestamptz,
    reply_count   integer,
    last_reply_at timestamptz,
    unread_admin  boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_uid text;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'sign in required'; END IF;

  RETURN QUERY
  SELECT c.id, c.category, c.subject, c.message, c.status, c.attachments, c.created_at,
         COALESCE(r.cnt, 0)::int,
         r.last_at,
         -- «جديد»: آخر ردٍّ من الإدارة بعد آخر ردٍّ منك (أو لم تردّ أصلاً)
         COALESCE(r.last_admin_at > COALESCE(r.last_user_at, c.created_at), false)
    FROM public.complaints c
    LEFT JOIN LATERAL (
      SELECT count(*) AS cnt,
             max(cr.created_at) AS last_at,
             max(cr.created_at) FILTER (WHERE cr.author_role = 'admin') AS last_admin_at,
             max(cr.created_at) FILTER (WHERE cr.author_role = 'user')  AS last_user_at
        FROM public.complaint_replies cr
       WHERE cr.complaint_id = c.id
    ) r ON true
   WHERE c.user_id = v_uid
   ORDER BY COALESCE(r.last_at, c.created_at) DESC
   LIMIT GREATEST(1, LEAST(p_limit, 200));
END;
$fn$;

-- ── خيط الشكوى: ردودها بالترتيب (لصاحبها أو للإدارة) ──────────────────────
DROP FUNCTION IF EXISTS public.complaint_thread(uuid);
CREATE FUNCTION public.complaint_thread(p_id uuid)
RETURNS TABLE (
    id          uuid,
    author_role text,
    author_name text,
    body        text,
    created_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_uid text; v_owner text;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'sign in required'; END IF;

  SELECT c.user_id INTO v_owner FROM public.complaints c WHERE c.id = p_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'complaint not found'; END IF;
  IF v_owner <> v_uid AND NOT public.taki_admin_perm('tab_reports') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT cr.id, cr.author_role,
         -- اسمُ الإدارة لا يُكشف: «فريق تاكي» (لا تسمية أدمن في نصٍّ ظاهر)
         CASE WHEN cr.author_role = 'admin' THEN 'فريق تاكي'
              ELSE COALESCE(u.name, 'أنت') END,
         cr.body, cr.created_at
    FROM public.complaint_replies cr
    LEFT JOIN public.users u ON u.id = cr.author_id
   WHERE cr.complaint_id = p_id
   ORDER BY cr.created_at ASC;
END;
$fn$;

-- ── ردُّ الإدارة: يصل صاحب الشكوى إشعاراً ─────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_complaint_reply(uuid, text, text);
CREATE FUNCTION public.admin_complaint_reply(
    p_id uuid,
    p_body text,
    p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_uid text; v_owner text; v_subject text; v_body text;
BEGIN
  v_uid := auth.uid()::text;
  IF NOT public.taki_admin_perm('tab_reports') THEN
    RAISE EXCEPTION 'forbidden: tab_reports required';
  END IF;

  v_body := btrim(COALESCE(p_body, ''));
  IF v_body = '' THEN RAISE EXCEPTION 'empty reply'; END IF;

  SELECT c.user_id, COALESCE(NULLIF(btrim(c.subject), ''), 'شكواك')
    INTO v_owner, v_subject
    FROM public.complaints c WHERE c.id = p_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'complaint not found'; END IF;

  INSERT INTO public.complaint_replies (complaint_id, author_id, author_role, body)
  VALUES (p_id, v_uid, 'admin', v_body);

  IF p_status IS NOT NULL THEN
    IF p_status NOT IN ('open','reviewing','resolved','dismissed') THEN
      RAISE EXCEPTION 'Bad status';
    END IF;
    UPDATE public.complaints
       SET status = p_status,
           resolved_by = CASE WHEN p_status IN ('resolved','dismissed') THEN v_uid ELSE resolved_by END,
           resolved_at = CASE WHEN p_status IN ('resolved','dismissed') THEN now() ELSE resolved_at END
     WHERE id = p_id;
  END IF;

  -- 🔴 هذا هو جوهر الإصلاح: قبله كانت الإدارة تغيّر الحالة إلى «تم الحل»
  --    و**لا يصل صاحب الشكوى شيء** بأي صورة.
  INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
  VALUES (
    v_owner,
    'ردٌّ على شكواك',
    'Reply to your complaint',
    left(v_body, 160),
    left(v_body, 160),
    'system',
    jsonb_build_object('audience', 'user', 'kind', 'complaint_reply', 'complaint_id', p_id)
  );

  RETURN jsonb_build_object('ok', true, 'complaint_id', p_id, 'notified', v_owner);
END;
$fn$;

-- ── ردُّ صاحب الشكوى ──────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.complaint_reply(uuid, text);
CREATE FUNCTION public.complaint_reply(p_id uuid, p_body text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_uid text; v_owner text; v_body text; v_recent int;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'sign in required'; END IF;

  v_body := btrim(COALESCE(p_body, ''));
  IF v_body = '' THEN RAISE EXCEPTION 'empty reply'; END IF;

  SELECT c.user_id INTO v_owner FROM public.complaints c WHERE c.id = p_id;
  IF v_owner IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- حدُّ معدّل بسيط: عشرة ردودٍ في الساعة لكل مستخدم عبر كل شكاواه.
  SELECT count(*) INTO v_recent
    FROM public.complaint_replies cr
   WHERE cr.author_id = v_uid
     AND cr.author_role = 'user'
     AND cr.created_at > now() - interval '1 hour';
  IF v_recent >= 10 THEN
    RAISE EXCEPTION 'أرسلت ردوداً كثيرة في وقتٍ قصير — انتظر قليلاً ثم أعد المحاولة.'
      USING ERRCODE = 'P0011';
  END IF;

  INSERT INTO public.complaint_replies (complaint_id, author_id, author_role, body)
  VALUES (p_id, v_uid, 'user', v_body);

  -- شكوى ردَّ عليها صاحبها تعود «مفتوحة» — فلا تُدفن تحت «تم الحل».
  UPDATE public.complaints SET status = 'open'
   WHERE id = p_id AND status IN ('resolved','dismissed');

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

-- ── حفظ مسارات المرفقات بعد الرفع ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.complaint_set_attachments(uuid, text[]);
CREATE FUNCTION public.complaint_set_attachments(p_id uuid, p_paths text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_uid text; v_owner text; v_path text;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'sign in required'; END IF;

  SELECT c.user_id INTO v_owner FROM public.complaints c WHERE c.id = p_id;
  IF v_owner IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF COALESCE(array_length(p_paths, 1), 0) > 5 THEN
    RAISE EXCEPTION 'أكثر من خمسة مرفقات لشكوى واحدة.';
  END IF;

  -- 🪤 كل مسارٍ يجب أن يبدأ بمعرّف صاحبه: بلا هذا يستطيع مستخدمٌ ربطَ ملفٍّ
  --    في مجلّد غيره بشكواه، فيقرؤه من خلالها.
  FOREACH v_path IN ARRAY COALESCE(p_paths, ARRAY[]::text[]) LOOP
    IF split_part(v_path, '/', 1) <> v_uid THEN
      RAISE EXCEPTION 'مسار مرفقٍ خارج مجلّدك.';
    END IF;
  END LOOP;

  UPDATE public.complaints SET attachments = COALESCE(p_paths, '{}')
   WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'count', COALESCE(array_length(p_paths, 1), 0));
END;
$fn$;

-- ── الصلاحيات ─────────────────────────────────────────────────────────────
-- 🪤 `REVOKE … FROM PUBLIC` لا يُلغي منح `anon` المباشر ولا العكس — يلزم
--    الاثنان (درس v14.29). ولا شيء هنا للزائر: كلّها تتطلّب جلسة.
REVOKE ALL ON FUNCTION public.my_complaints(integer)                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complaint_thread(uuid)                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complaint_reply(uuid, text)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complaint_set_attachments(uuid, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_complaint_reply(uuid, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.my_complaints(integer)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.complaint_thread(uuid)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.complaint_reply(uuid, text)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.complaint_set_attachments(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_complaint_reply(uuid, text, text) TO authenticated;

GRANT SELECT, INSERT ON public.complaint_replies TO authenticated;
GRANT DELETE ON public.complaint_replies TO authenticated;   -- محروسٌ بسياسة الأدمن

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) مهلة الردّ المعلنة — رقمٌ واحد يُضبط من الإعدادات لا يُكتب نصّاً
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 درس مسجَّل: «لا يُكتب رقم ساعات نصّاً في أي مكان — أوّل ضبط يجعله كذباً».
INSERT INTO public.platform_settings (key, value, description)
VALUES ('complaints_sla_hours', '24'::jsonb, 'المهلة المعلنة للردّ على الشكاوى (بالساعات)')
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) تحقّقٌ يرفع استثناءً — لا جدولَ ✅/❌ لا يُفشل شيئاً (درس v14.50)
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='complaints' AND column_name='attachments') THEN
    RAISE EXCEPTION 'عمود attachments لم يُضف';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='complaints' AND public = false) THEN
    RAISE EXCEPTION 'مستودع complaints غير موجود أو ليس خاصّاً';
  END IF;

  IF to_regclass('public.complaint_replies') IS NULL THEN
    RAISE EXCEPTION 'جدول complaint_replies لم يُنشأ';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='complaint_replies';
  IF n < 3 THEN RAISE EXCEPTION 'سياسات complaint_replies ناقصة (%)', n; END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='storage' AND tablename='objects' AND policyname LIKE 'complaints_files%';
  IF n < 3 THEN RAISE EXCEPTION 'سياسات مرفقات الشكاوى ناقصة (%)', n; END IF;

  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public'
     AND p.proname IN ('my_complaints','complaint_thread','complaint_reply',
                       'complaint_set_attachments','admin_complaint_reply');
  IF n <> 5 THEN RAISE EXCEPTION 'الدوالّ ناقصة: وُجد % من ٥', n; END IF;

  -- 🪤 ولا شيء منها مفتوحٌ للزائر — يُقاس لا يُفترض.
  IF has_function_privilege('anon', 'public.my_complaints(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'my_complaints مفتوحة للزائر';
  END IF;
  IF has_function_privilege('anon', 'public.admin_complaint_reply(uuid, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_complaint_reply مفتوحة للزائر';
  END IF;

  RAISE NOTICE '✅ الشكاوى: مرفقاتٌ ومستودعٌ خاص وردودٌ وإشعار — كلّها مثبَتة.';
END
$verify$;

SELECT 'البند' AS "الجدول", 'القيمة' AS "—"
UNION ALL SELECT 'القاعدة', current_database()
UNION ALL SELECT 'مرفقات', 'عمود attachments + مستودع complaints خاص'
UNION ALL SELECT 'الردود', 'complaint_replies + ٣ سياسات'
UNION ALL SELECT 'الإشعار', 'يُرسَل في admin_complaint_reply'
UNION ALL SELECT 'المهلة', 'platform_settings.complaints_sla_hours';
