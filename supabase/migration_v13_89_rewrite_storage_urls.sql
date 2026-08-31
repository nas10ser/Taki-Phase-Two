-- ═══════════════════════════════════════════════════════════════════════════
-- TAKI — v13.89 — نقل عناوين الصور المخزَّنة إلى api.takisa.net  (خادم جدة)
--
-- لماذا: `getPublicUrl` تبني العنوان من عنوان القاعدة وقت الرفع، فالصور
-- القديمة محفوظة بعنوان **كامل** يبدأ بـ`141-147-142-147.sslip.io`. وذلك
-- الاسم يعتمد على بقاء رقم الخادم كما هو إلى الأبد — وهو ما لا يُضمن. النقل
-- إلى `api.takisa.net` يجعل الصور مستقلّة عن رقم الخادم.
--
-- ولماذا هذا آمن الآن: الاسمان يخدمان **نفس الخادم** منذ إضافة `api.takisa.net`
-- إلى Caddy، وقد جُرِّبت صورة فعلية عليه (٥٤٥ كيلوبايت · HTTP 200). فحتى لو
-- بقي صفٌّ بالعنوان القديم فهو يعمل، والعكس كذلك.
--
-- الطريقة: لا نخمّن أسماء الجداول. نمسح **كل** عمود نصّي أو مصفوفة نصّية أو
-- jsonb في مخطط public، ونعدّل ما يحتوي العنوان القديم فقط. فلا يفوتنا شعار
-- متجر ولا صورة لافتة ولا حقل داخل jsonb.
--
-- 🔒 المشغّلات مُعطَّلة أثناء العملية عبر `session_replication_role = replica`
--    (تعود وحدها بنهاية المعاملة). بدونها قد تُطلق تعديلاتُ الصفوف مشغّلاتِ
--    إشعارات فيصل للمستخدمين سيلٌ من «حُدِّث العرض» بلا سبب.
--
-- قِيس قبل الكتابة: ٤٣ عنوان صورة في `deals.images` ما زال على الاسم القديم
-- (٣١ أغسطس ٢٠٢٦)، بينما الحزمة المنشورة تشير إلى api.takisa.net وحده.
--
-- آمن للتكرار: تشغيلٌ ثانٍ لا يجد شيئاً فلا يعدّل صفاً.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── حارس: يرفض التنفيذ على مختبر طوكيو ──────────────────────────────────
DO $guard$
BEGIN
    IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
       LIKE '%TAKI_LAB_TOKYO%' THEN
        RAISE EXCEPTION 'توقّف: هذا مختبر طوكيو لا خادم جدة.';
    END IF;
END $guard$;

-- ── ١) تقرير ما قبل: أين يوجد العنوان القديم؟ ───────────────────────────
CREATE OR REPLACE FUNCTION pg_temp._taki_scan_old_host()
RETURNS TABLE ("الجدول" text, "العمود" text, "النوع" text, "صفوف" bigint)
LANGUAGE plpgsql AS $fn$
DECLARE r record; n bigint; q text;
BEGIN
    FOR r IN
        SELECT c.relname AS tbl, a.attname AS col, t.typname AS ty
          FROM pg_class c
          JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = 'public'
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
          JOIN pg_type t ON t.oid = a.atttypid
         WHERE c.relkind = 'r' AND t.typname IN ('text','varchar','_text','jsonb')
           -- ⚠️ الأعمدة المولّدة (GENERATED) لا تقبل التحديث إطلاقاً؛ تركُها
           --    يُسقط الهجرة بـ«can only be updated to DEFAULT». اكتشفها
           --    اختبارُ الآلية على المختبر: bookings.search_norm.
           --    وهي محسوبة من أعمدة أخرى، فتتحدّث وحدها بعد تعديل مصدرها.
           AND a.attgenerated = ''
         ORDER BY 1, 2
    LOOP
        q := format('SELECT count(*) FROM public.%I WHERE %s',
             r.tbl,
             CASE r.ty
               WHEN '_text' THEN format('array_to_string(%I, '','') LIKE ''%%141-147-142-147.sslip.io%%''', r.col)
               WHEN 'jsonb' THEN format('%I::text LIKE ''%%141-147-142-147.sslip.io%%''', r.col)
               ELSE format('%I LIKE ''%%141-147-142-147.sslip.io%%''', r.col)
             END);
        EXECUTE q INTO n;
        IF n > 0 THEN RETURN QUERY SELECT r.tbl::text, r.col::text, r.ty::text, n; END IF;
    END LOOP;
END $fn$;

\echo '════ قبل النقل ════'
SELECT * FROM pg_temp._taki_scan_old_host();

-- ── ٢) النقل ────────────────────────────────────────────────────────────
BEGIN;

-- المشغّلات معطَّلة لهذه المعاملة وحدها — تعود تلقائياً بنهايتها.
SET LOCAL session_replication_role = replica;

DO $mig$
DECLARE r record; q text; n bigint; total bigint := 0;
BEGIN
    FOR r IN
        SELECT c.relname AS tbl, a.attname AS col, t.typname AS ty
          FROM pg_class c
          JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = 'public'
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
          JOIN pg_type t ON t.oid = a.atttypid
         WHERE c.relkind = 'r' AND t.typname IN ('text','varchar','_text','jsonb')
           -- ⚠️ الأعمدة المولّدة (GENERATED) لا تقبل التحديث إطلاقاً؛ تركُها
           --    يُسقط الهجرة بـ«can only be updated to DEFAULT». اكتشفها
           --    اختبارُ الآلية على المختبر: bookings.search_norm.
           --    وهي محسوبة من أعمدة أخرى، فتتحدّث وحدها بعد تعديل مصدرها.
           AND a.attgenerated = ''
    LOOP
        q := CASE r.ty
          WHEN '_text' THEN format(
             'UPDATE public.%I SET %I = (SELECT array_agg(replace(x, %L, %L) ORDER BY o) '
             'FROM unnest(%I) WITH ORDINALITY u(x, o)) '
             'WHERE array_to_string(%I, '','') LIKE %L',
             r.tbl, r.col, '141-147-142-147.sslip.io', 'api.takisa.net',
             r.col, r.col, '%141-147-142-147.sslip.io%')
          WHEN 'jsonb' THEN format(
             'UPDATE public.%I SET %I = replace(%I::text, %L, %L)::jsonb WHERE %I::text LIKE %L',
             r.tbl, r.col, r.col, '141-147-142-147.sslip.io', 'api.takisa.net',
             r.col, '%141-147-142-147.sslip.io%')
          ELSE format(
             'UPDATE public.%I SET %I = replace(%I, %L, %L) WHERE %I LIKE %L',
             r.tbl, r.col, r.col, '141-147-142-147.sslip.io', 'api.takisa.net',
             r.col, '%141-147-142-147.sslip.io%')
        END;
        EXECUTE q;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n > 0 THEN
            RAISE NOTICE 'نُقل %.% ← % صفاً', r.tbl, r.col, n;
            total := total + n;
        END IF;
    END LOOP;
    RAISE NOTICE 'الإجمالي: % صفاً', total;
END $mig$;

COMMIT;

-- ── ٣) التحقّق ──────────────────────────────────────────────────────────
\echo '════ بعد النقل (المتوقّع: لا صفوف) ════'
SELECT * FROM pg_temp._taki_scan_old_host();

\echo '════ عيّنة من العناوين الجديدة ════'
SELECT left(images[1], 72) AS "أول صورة"
  FROM public.deals WHERE images IS NOT NULL AND array_length(images,1) > 0 LIMIT 3;

SELECT
    CASE WHEN COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') LIKE '%TAKI_LAB_TOKYO%'
         THEN '⚠️ مختبر طوكيو' ELSE '🇸🇦 خادم جدة' END AS "الخادم",
    (SELECT count(*) FROM public.deals
      WHERE array_to_string(images, ',') LIKE '%141-147-142-147%') AS "عروض بعنوان قديم (المتوقّع ٠)",
    (SELECT count(*) FROM public.deals
      WHERE array_to_string(images, ',') LIKE '%api.takisa.net%') AS "عروض بالعنوان الجديد";
