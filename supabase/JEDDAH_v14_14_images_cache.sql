-- ═══════════════════════════════════════════════════════════════════════════
-- JEDDAH_v14_14_images_cache.sql — وزن الصور وتخزينها في الجوّال
--
-- الحالة قبل هذا الملف (مقيسة على جدة ١٠–١١ سبتمبر):
--   • ١٧٢ ملفاً في مستودع `deals` بترويسة **no-cache** مجموعها ١٣٢ ميجابايت،
--     مقابل ١٨ ملفاً فقط بترويسة سنة. أي أن الجوّال يعيد تحميل الصورة نفسها
--     في كل فتحة للتطبيق.
--   • أكبر صورة مقيسة: ٨٫٥ ميجابايت — تُحمَّل كاملةً داخل بطاقة عرض صغيرة.
--   • خدمة التصغير (`supabase-imgproxy`) **تعمل فعلاً**، ومسار
--     `/storage/v1/render/image/...` يردّ ٢٠٠ — لكن لا أحد يستعملها.
--
-- 🔵 القرار الهندسي (وسببه بلغة بسيطة):
--   التصغير الفوري عبر `render/image` يعمل لكل صورة بلا استثناء، لكن **كل طلب
--   أوّل يكلّف الخادم معالجة**، والنطاق على Cloudflare بسحابة رمادية أي بلا
--   ذاكرة وسيطة — فالخادم وحده يتحمّل كل تصغير.
--   ولذلك: نستعمل خدمة التصغير **مولِّداً مرّة واحدة** لا خادماً دائماً —
--   نطلب منها النسخة المصغّرة، ونحفظها ملفاً ثابتاً `<الاسم>_t.jpg` بترويسة
--   سنة. فبعدها كل طلب هو ملفٌّ ثابت لا معالجة فيه، ويبقى النظام واحداً كما
--   صُمّم في v13.71 (علامة `t=1` في الرابط تعني «لهذه الصورة مصغّرة مؤكَّدة»).
--   ويبقى `render/image` **شبكة أمان في الكود**: أي صورة بلا مصغّرة مؤكَّدة
--   تُطلب مصغَّرةً لحظياً بدل تحميل الأصل — فلا تعود تقع فجوة كالتي وقعت.
--
-- هذا الملف يُثبّت الجزء القاعدي (الترويسة + الوسم). توليد المصغّرات نفسه
-- جرى بنصّ تشغيلي على الخادم (يستدعي خدمة التصغير ويرفع الناتج).
--
-- آمنة للتكرار (idempotent).
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
     LIKE 'TAKI_LAB_TOKYO%' THEN
    RAISE EXCEPTION
      'REFUSED: this migration targets the Jeddah production server, but this database is the Tokyo lab (%).',
      obj_description('public'::regnamespace, 'pg_namespace');
  END IF;
END
$guard$;

BEGIN;

-- ═══ ١) ترويسة التخزين: سنة كاملة بدل no-cache ════════════════════════════
-- أسماء الملفات فريدة (طابع زمني + عشوائي) والرفع بـ`upsert:false`، فلا يمكن
-- أن يتغيّر محتوى اسمٍ قائم ⇒ التخزين الطويل آمن بلا احتمال «صورة بايتة».
UPDATE storage.objects
   SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{cacheControl}', '"max-age=31536000"')
 WHERE bucket_id = 'deals'
   AND coalesce(metadata->>'cacheControl', '') <> 'max-age=31536000';

-- ═══ ٢) وسم الروابط التي صار لها مصغّرة فعلاً ═════════════════════════════
-- العلامة تُكتب **فقط** حين تكون المصغّرة موجودة في المستودع يقيناً — علامة
-- كاذبة تعني طلباً فاشلاً ثم ارتداداً، وهو ما رآه ناصر «صوراً ناقصة» في v13.71.
UPDATE public.deals d
   SET images = (
     SELECT array_agg(
       CASE WHEN u LIKE '%/public/deals/%'
                 AND NOT (split_part(u, '?', 2) ~ '(^|[&;])t=1([&;]|$)')
                 AND EXISTS (SELECT 1 FROM storage.objects o
                              WHERE o.bucket_id = 'deals'
                                AND o.name = regexp_replace(split_part(u, '?', 1),
                                      '^.*/deals/(.+)\.[A-Za-z0-9]+$', '\1') || '_t.jpg')
            THEN u || CASE WHEN position('?' in u) > 0 THEN '&' ELSE '?' END || 't=1'
            ELSE u END
       ORDER BY ord)
       FROM unnest(d.images) WITH ORDINALITY AS t(u, ord))
 WHERE EXISTS (
   SELECT 1 FROM unnest(d.images) x
    WHERE x LIKE '%/public/deals/%'
      AND NOT (split_part(x, '?', 2) ~ '(^|[&;])t=1([&;]|$)')
      AND EXISTS (SELECT 1 FROM storage.objects o
                   WHERE o.bucket_id = 'deals'
                     AND o.name = regexp_replace(split_part(x, '?', 1),
                           '^.*/deals/(.+)\.[A-Za-z0-9]+$', '\1') || '_t.jpg'));

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- جدول التحقّق — أوّل سطر فيه اسم الخادم
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS "الفحص",
       COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'standard public schema')
         || ' @ ' || COALESCE(inet_server_addr()::text, current_setting('cluster_name', true), 'local') AS "النتيجة",
       CASE WHEN COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') NOT LIKE 'TAKI_LAB_TOKYO%'
            THEN '✅ جدة (إنتاج)' ELSE '❌ المختبر' END AS "الحالة";

SELECT 'ملفات بلا ترويسة سنة (يجب صفر)' AS "الفحص",
       count(*)::text AS "النتيجة",
       CASE WHEN count(*) = 0 THEN '✅' ELSE '❌' END AS "الحالة"
  FROM storage.objects
 WHERE bucket_id = 'deals' AND coalesce(metadata->>'cacheControl','') <> 'max-age=31536000';

SELECT 'روابط الصور الموسومة بمصغّرة' AS "الفحص",
       count(*) FILTER (WHERE split_part(u,'?',2) ~ '(^|[&;])t=1([&;]|$)')::text || '/' || count(*)::text AS "النتيجة",
       CASE WHEN count(*) = count(*) FILTER (WHERE split_part(u,'?',2) ~ '(^|[&;])t=1([&;]|$)')
            THEN '✅' ELSE '❌' END AS "الحالة"
  FROM (SELECT unnest(images) AS u FROM public.deals) z
 WHERE u LIKE '%/public/deals/%';

SELECT 'كل رابط موسوم له مصغّرة فعلية' AS "الفحص",
       count(*)::text || ' رابط بعلامة بلا ملف' AS "النتيجة",
       CASE WHEN count(*) = 0 THEN '✅' ELSE '❌' END AS "الحالة"
  FROM (SELECT unnest(images) AS u FROM public.deals) z
 WHERE u LIKE '%/public/deals/%'
   AND split_part(u,'?',2) ~ '(^|[&;])t=1([&;]|$)'
   AND NOT EXISTS (SELECT 1 FROM storage.objects o
                    WHERE o.bucket_id='deals'
                      AND o.name = regexp_replace(split_part(u,'?',1),'^.*/deals/(.+)\.[A-Za-z0-9]+$','\1') || '_t.jpg');

SELECT 'وزن ما تعرضه البطاقات' AS "الفحص",
       pg_size_pretty(sum(size_thumb)) || ' بدل ' || pg_size_pretty(sum(size_orig))
         || ' (' || round(100.0*sum(size_thumb)/nullif(sum(size_orig),0), 1) || '%)' AS "النتيجة",
       CASE WHEN sum(size_thumb) < sum(size_orig) / 2 THEN '✅' ELSE '❌' END AS "الحالة"
  FROM (
    SELECT (so.metadata->>'size')::bigint AS size_orig, (st.metadata->>'size')::bigint AS size_thumb
      FROM (SELECT DISTINCT
              regexp_replace(split_part(u,'?',1),'^.*/deals/(.+)\.[A-Za-z0-9]+$','\1') AS stem,
              regexp_replace(split_part(u,'?',1),'^.*/deals/(.+)$','\1') AS orig
              FROM (SELECT unnest(images) AS u FROM public.deals) q
             WHERE u LIKE '%/public/deals/%') f
      JOIN storage.objects so ON so.bucket_id='deals' AND so.name = f.orig
      JOIN storage.objects st ON st.bucket_id='deals' AND st.name = f.stem || '_t.jpg') w;

-- 🔴 للعلم لا للتنفيذ: ملفات في المستودع لا يشير إليها أي عرض (بقايا عروض
-- حُذفت أو صور استُبدلت). لا تُحذف إلا بقرار من ناصر — الحذف لا رجعة فيه.
SELECT 'ملفات لا يستعملها أي عرض (بقايا)' AS "الفحص",
       count(*)::text || ' ملفاً · ' || pg_size_pretty(sum((metadata->>'size')::bigint)) AS "النتيجة",
       'ℹ️ للعلم' AS "الحالة"
  FROM storage.objects o
 WHERE o.bucket_id = 'deals'
   AND NOT EXISTS (
     SELECT 1 FROM (SELECT unnest(images) AS u FROM public.deals) z
      WHERE split_part(z.u,'?',1) LIKE '%/deals/' || o.name
         OR split_part(z.u,'?',1) LIKE '%/deals/' || regexp_replace(o.name, '_t\.jpg$', '') || '.%');
