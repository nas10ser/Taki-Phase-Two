-- ════════════════════════════════════════════════════════════════════════════
-- v14.75d — العنوان يصل البوتين أيضاً
-- ════════════════════════════════════════════════════════════════════════════
-- v14.74 أعطت التاجر حقل عنوانٍ لكل موقع على الموقع، والبوتان لا يعرفان العمود:
-- `bot_list_branches` تُرجع الاسم والإحداثيات ولا تُرجع `address`. وقاعدة
-- المشروع صريحة: ما يُفرض في الموقع يُفرض في البوتين.
--
-- ولهذا أثرٌ مباشر على ما طلبه ناصر: حارس التكرار يمنع اسمين متطابقين، لكن
-- فرعين في نفس المدينة يُفرَّق بينهما **بالعنوان**. فمن يدير متجره من المحادثة
-- كان يرى اسمين ولا يرى ما يميّزهما.
--
-- ℹ️ ولا خطر مسحٍ من جهة البوت: `bot_save_branch` تُحدّث بـ`COALESCE` لكل عمود
--    **ولا تمسّ `address` إطلاقاً** (فُحص جسمها) — فالعنوان المكتوب من الموقع
--    ينجو من أي حفظٍ في المحادثة.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'رُفض: هذا خادم المختبر (طوكيو) — هجرات الإنتاج تُطبَّق على جدة';
  END IF;
END $guard$;

BEGIN;

-- 🪤 التوقيع لم يتغيّر فـ`CREATE OR REPLACE` آمنة — ولو أُضيف معاملٌ لوجب
--    `DROP` أولاً وإلا صار النداء ملتبساً وسكت البوتان.
DO $patch$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
    FROM pg_proc WHERE proname='bot_list_branches' AND pronamespace='public'::regnamespace;
  IF v_def IS NULL THEN RAISE EXCEPTION 'فشل: bot_list_branches غير موجودة'; END IF;
  IF position('''address''' in v_def) > 0 THEN
    RAISE NOTICE 'ℹ️ العنوان موجود سلفاً في المخرَج — لا تعديل';
    RETURN;
  END IF;
  -- إضافةٌ جراحية: مفتاحٌ واحد في نفس الكائن، بلا لمس أي منطقٍ آخر.
  v_def := replace(v_def,
    '''id'', b.id, ''kind'',''branch'', ''name'', b.name_ar,',
    '''id'', b.id, ''kind'',''branch'', ''name'', b.name_ar,' || chr(10) ||
    '        ''address'', nullif(btrim(coalesce(b.address, '''')), ''''),');
  IF position('''address''' in v_def) = 0 THEN
    RAISE EXCEPTION 'فشل: لم يُعثر على موضع الإدراج في bot_list_branches';
  END IF;
  EXECUTE v_def;
END $patch$;

COMMIT;

-- ── تحقّقٌ يرفع استثناءً ─────────────────────────────────────────────────────
DO $verify$
DECLARE n int; sid text; tg bigint := 987654321987; v jsonb; it jsonb;
BEGIN
  SELECT count(*) INTO n FROM pg_proc
   WHERE proname='bot_list_branches' AND pronamespace='public'::regnamespace;
  IF n <> 1 THEN RAISE EXCEPTION 'فشل: نسخ bot_list_branches = % (نسختان ⇒ نداءٌ ملتبس)', n; END IF;
  IF pg_get_functiondef('public.bot_list_branches(bigint,text)'::regprocedure) NOT LIKE '%''address''%' THEN
    RAISE EXCEPTION 'فشل: العنوان لم يُضف إلى المخرَج';
  END IF;

  BEGIN
    SELECT u.id INTO sid FROM public.users u
     WHERE u.user_type IN ('seller','admin') AND u.deleted_at IS NULL ORDER BY u.id LIMIT 1;
    UPDATE public.users SET telegram_id = tg WHERE id = sid;
    -- 🪤 المفتاح `branches` لا `items` — أوّل صياغةٍ للاختبار بحثت في مفتاحٍ
    --    غير موجود فبدا العيب في الدالة وهو في الاختبار.
    -- عنوانٌ مفبرك على أحد فروعه ليُقرأ في المخرَج
    -- 🪤 `LIMIT` غير مسموح في `UPDATE` بـPostgreSQL — يُحصر الصفّ باستعلامٍ فرعي.
    UPDATE public.store_branches SET address = 'طريق الملك فهد — اختبار'
     WHERE id = (SELECT id FROM public.store_branches WHERE merchant_id = sid AND is_active ORDER BY created_at LIMIT 1);

    v := public.bot_list_branches(tg, NULL);
    IF coalesce(v->>'success','false') <> 'true' THEN
      RAISE EXCEPTION 'فشل: لم تُرجع القائمة (%)', v::text;
    END IF;
    SELECT x INTO it FROM jsonb_array_elements(coalesce(v->'branches','[]'::jsonb)) x
     WHERE x->>'address' = 'طريق الملك فهد — اختبار' LIMIT 1;
    IF it IS NULL THEN
      RAISE EXCEPTION 'فشل: العنوان لا يظهر في مخرَج البوت (%)', left(v::text, 300);
    END IF;

    RAISE EXCEPTION 'ROLLBACK_TEST_OK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_TEST_OK' THEN RAISE; END IF;
  END;
END $verify$;

SELECT 'v14.75d' AS "الهجرة",
       (SELECT count(*) FROM users WHERE telegram_id = 987654321987) AS "أثرٌ متسرّب";
