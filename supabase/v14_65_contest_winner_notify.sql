-- ════════════════════════════════════════════════════════════════════════════
-- v14.65 — الفائز يُبلَّغ، وتسليم الجائزة يُوثَّق
-- ════════════════════════════════════════════════════════════════════════════
-- من تدقيق ٩ سبتمبر: «الفائزون يُعلنون في صفحة المسابقات العامة فيستطيع الفائز
-- أن يرى نفسه، لكن **لا يصله إشعار**، ولا يوجد حقل يوثّق تسليم الجائزة — وهي
-- ثغرة توثيق في مسابقة بجوائز».
--
-- الربط بين المشارك وحسابه بالجوال (كما في `my_contest_entry` تماماً): المشاركة
-- تُختم باسم الحساب وجواله من الخادم، فالجوال هو المفتاح الموجود.
--
-- 🪤 نوع الإشعار `system`: قيد `notifications_type_check` يسمح بستّة أنواع
--    وليس فيها `contest` — ولو كتبناها لفشل الإدراج **داخل** دالة السحب
--    فسقط السحب كلّه.
-- 🪤 و`CREATE OR REPLACE` هنا آمن لأن التوقيع لم يتغيّر؛ ولو أُضيف معامل لوجب
--    `DROP` أولاً وإلا صار النداء ملتبساً.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'رُفض: هذا خادم المختبر (طوكيو) — هجرات الإنتاج تُطبَّق على جدة';
  END IF;
END $guard$;

BEGIN;

-- ١) توثيق التسليم ───────────────────────────────────────────────────────────
ALTER TABLE public.contest_entries
  ADD COLUMN IF NOT EXISTS prize_delivered    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS prize_delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS prize_note         text;

-- ٢) السحب يُبلّغ الفائز ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.draw_contest_winners(p_contest_id uuid, p_count integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v        jsonb;
  v_title  text;
  v_prize  text;
  v_sent   int := 0;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden: admin only'; END IF;

  SELECT title, COALESCE(NULLIF(btrim(prize), ''), '') INTO v_title, v_prize
    FROM contests WHERE id = p_contest_id;

  -- Never reset existing winners; draw only from not-yet-winners.
  WITH picked AS (
    SELECT id FROM contest_entries
    WHERE contest_id = p_contest_id AND qualified = true AND is_winner = false
    ORDER BY random() LIMIT GREATEST(1, COALESCE(p_count, 1))
  ), upd AS (
    UPDATE contest_entries e SET is_winner = true
    FROM picked WHERE e.id = picked.id
    RETURNING e.name, e.phone, e.created_at
  )
  SELECT jsonb_agg(jsonb_build_object('name', name, 'phone', phone) ORDER BY created_at) INTO v FROM upd;

  UPDATE contests SET status = 'drawn', updated_at = now() WHERE id = p_contest_id;

  -- v14.65 — إشعارٌ لكل فائزٍ له حساب. الربط بالجوال، ومن لا حساب له لا يُبلَّغ
  -- (يبقى الإعلان العام كما هو). الإدراج لا يُسقط السحب إن تعذّر.
  BEGIN
    WITH winners AS (
      SELECT DISTINCT u.id AS user_id
      FROM contest_entries e
      JOIN users u ON nullif(btrim(u.phone), '') = e.phone
      WHERE e.contest_id = p_contest_id AND e.is_winner = true
    ), ins AS (
      INSERT INTO notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
      SELECT w.user_id,
             '🎉 مبروك! فزت في المسابقة',
             '🎉 Congratulations! You won',
             'فزت في «' || COALESCE(v_title, 'المسابقة') || '»'
               || CASE WHEN v_prize <> '' THEN ' — الجائزة: ' || v_prize ELSE '' END
               || '. سنتواصل معك لتسليم الجائزة.',
             'You won “' || COALESCE(v_title, 'the contest') || '”'
               || CASE WHEN v_prize <> '' THEN ' — prize: ' || v_prize ELSE '' END
               || '. We will contact you to hand it over.',
             'system',
             jsonb_build_object('audience', 'buyer', 'actionUrl', '/contests', 'contestId', p_contest_id)
      FROM winners w
      -- لا يُكرَّر الإشعار على سحبةٍ ثانية لنفس المسابقة
      WHERE NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.user_id = w.user_id
          AND n.type = 'system'
          AND n.meta_data->>'contestId' = p_contest_id::text
      )
      RETURNING 1
    )
    SELECT count(*) INTO v_sent FROM ins;
  EXCEPTION WHEN OTHERS THEN
    v_sent := -1;   -- تعذّر الإبلاغ: السحب صحيح والجدول يقول ذلك
  END;

  RETURN jsonb_build_object('winners', COALESCE(v, '[]'::jsonb), 'notified', v_sent);
END $function$;

-- ٣) تعليم الجائزة مُسلَّمة ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_prize_delivered(
  p_entry_id uuid,
  p_delivered boolean,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_rows int;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden: admin only'; END IF;
  UPDATE contest_entries
     SET prize_delivered    = COALESCE(p_delivered, false),
         prize_delivered_at = CASE WHEN COALESCE(p_delivered, false) THEN now() ELSE NULL END,
         prize_note         = NULLIF(btrim(COALESCE(p_note, '')), '')
   WHERE id = p_entry_id AND is_winner = true;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  -- صفر صفوف = المعرّف خاطئ أو ليس فائزاً. لا يُقال «تمّ» بلا صفّ.
  RETURN jsonb_build_object('ok', v_rows = 1, 'updated', v_rows);
END $function$;

REVOKE ALL ON FUNCTION public.admin_set_prize_delivered(uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_prize_delivered(uuid, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_prize_delivered(uuid, boolean, text) TO authenticated;

COMMIT;

-- ── تحقّقٌ يرفع استثناءً ─────────────────────────────────────────────────────
DO $verify$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='contest_entries'
     AND column_name IN ('prize_delivered','prize_delivered_at','prize_note');
  IF n <> 3 THEN RAISE EXCEPTION 'فشل: أعمدة توثيق التسليم = % (المتوقَّع ٣)', n; END IF;

  SELECT count(*) INTO n FROM pg_proc
   WHERE proname='admin_set_prize_delivered' AND pronamespace='public'::regnamespace;
  IF n <> 1 THEN RAISE EXCEPTION 'فشل: نسخ admin_set_prize_delivered = %', n; END IF;

  IF has_function_privilege('anon','public.admin_set_prize_delivered(uuid, boolean, text)','EXECUTE') THEN
    RAISE EXCEPTION 'فشل: anon تملك EXECUTE على دالة إدارية';
  END IF;

  SELECT count(*) INTO n FROM pg_proc WHERE proname='draw_contest_winners';
  IF n <> 1 THEN RAISE EXCEPTION 'فشل: نسخ draw_contest_winners = % (نسختان ⇒ نداءٌ ملتبس)', n; END IF;

  -- نوع الإشعار المستعمل يجب أن يكون ضمن قيد الجدول، وإلا سقط السحب كلّه.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.notifications'::regclass AND contype='c'
       AND pg_get_constraintdef(oid) LIKE '%''system''%'
  ) THEN RAISE EXCEPTION 'فشل: نوع الإشعار system غير مسموح في القيد'; END IF;
END $verify$;

SELECT 'v14.65 contest winners' AS "الهجرة",
       (SELECT count(*) FROM pg_proc WHERE proname='admin_set_prize_delivered') AS "دالة التسليم",
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name='contest_entries' AND column_name LIKE 'prize%') AS "أعمدة التوثيق";
