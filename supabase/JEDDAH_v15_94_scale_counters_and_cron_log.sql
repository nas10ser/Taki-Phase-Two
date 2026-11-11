-- ═══════════════════════════════════════════════════════════════════════════
-- TAKI · JEDDAH_v15_94_scale_counters_and_cron_log.sql
--
-- أمرُ ناصر (١١ نوفمبر ٢٠٢٦): «الموقع أريده سريعاً جداً حتى مع ملايين
-- المستخدمين». وهذه الهجرةُ تُزيل **ما قِيس** من جدارين داخل القاعدة:
--
-- ① 🔴 **كلُّ فتحةِ عرضٍ كانت كتابةً على `public.deals`.**
--    `increment_deal_view` تُنفّذ `UPDATE deals SET views = views+1` لكلّ
--    مشاهدة، و`deals` **منشورةٌ للريل-تايم بهويّة نسخٍ FULL** (مقيس:
--    `relreplident='f'`) ⇒ كلُّ مشاهدةٍ تكتب **الصفَّ القديم كاملاً** في
--    سجلّ WAL (ومعه مصفوفةُ الصور والوصفُ والشروط)، ثمّ يفكّه مُفكِّكُ
--    الريل-تايم ويبثُّه. والقياس: استعلامُ فكِّ WAL وحده **٤١٫٧٪ من كلّ زمن
--    القاعدة** (٥٩٨٬٦٣١ نداءً · ٩٫١ م.ث لكلّ نداء) — ولتاكي **ستّةُ
--    مستخدمين**. فالكلفةُ تتضاعف خطّياً مع المشاهدات، وهي أكثرُ ما سيقع
--    بالملايين.
--    ⇒ العدّادُ يصير **تجميعاً دوريّاً**: النداءُ يكتب الحدثَ وحده في
--      `analytics_events` (جدولٌ ملحِقٌ غيرُ منشور)، وكرونٌ كلَّ خمس دقائق
--      يجمع ويكتب **صفّاً واحداً لكلّ عرضٍ تغيّر**. فتهبط الكتاباتُ من
--      «واحدةٌ لكلّ مشاهدة» إلى «واحدةٌ لكلّ عرضٍ كلَّ خمس دقائق».
--    🪤 والمؤشّرُ يُهيَّأ على **أحدث حدثٍ قائم** لا على الصفر، وإلّا أُعيد
--       عدُّ ١٣٤٧ حدثاً تاريخياً فوق أرقامٍ تحملها `deals` أصلاً.
--    🪤 وفسحةُ دقيقةٍ قبل الحدّ الأعلى: المعرّفاتُ تُمنح قبل الإيداع، فصفٌّ
--       أصغرُ معرّفاً قد يودَع بعد أكبرَ منه — ولولا الفسحة ضاع عدٌّ بصمت.
--    🪤 ولا تُمسّ هويّةُ النسخ: خفضُها إلى DEFAULT يُسقط أحداثَ الحذف عن أيّ
--       اشتراكٍ مُرشَّح (`store_id=eq.…`) لأن الصفَّ القديم يصير مفتاحاً
--       وحده — وهو الفخُّ نفسُه المكتوب على `notifications`. **قِيس فتُرك.**
--
-- ② 🔴 **سجلُّ الكرون ٦١ م.ب من ٩٢ — ثلثا القاعدة.** يُحتفظ به **٩٠ يوماً**
--    بينما **كلُّ** قارئٍ له لا ينظر أبعدَ من **٢٤ ساعة** (`taki_cron_health`
--    و`taki_capacity_report` قِيسا). و٧١٠٠ صفٍّ يومياً ⇒ ٦٤٠ ألفَ صفٍّ عند
--    اكتمال النافذة. وهو **يُنسخ احتياطياً كلَّ ساعة**: قِيس أن `COPY` عليه
--    يكلّف **١٫٢٣٢ ثانيةَ معالجٍ لكلّ نسخة** (٦٠٦ نسخةً ⇒ ٧٤٧ ثانية).
--    ⇒ الاحتفاظُ **سبعةُ أيّام**: سبعةُ أضعافِ أوسعِ نافذةٍ يحتاجها قارئ —
--      فتبقى قاعدةُ «أوسعُ من نافذة الكشف» قائمةً بهامشٍ ٧×، لا ٩٠×.
--
-- 🪤 وما **لم** يُلمس عمداً: كرونُ المخزون وواثق يدوران كلَّ دقيقة بلا عملٍ
--    (١٢٫٢٪ و٤٫٥٪ من زمن القاعدة). تُركا لأن زمنَ القاعدة كلَّه ١٣٬٠٦٢ ثانيةً
--    في ٢٣ يوماً = **٠٫٦٥٪ من نواةٍ واحدة**، وكلفتُهما **ثابتةٌ لا تنمو مع
--    المستخدمين**. فتحسينُهما يشتري ٠٫١٪ من نواةٍ ويضيف خطرَ تعديلٍ على
--    مسارٍ يعمل. (القاعدةُ: يُحسَّن ما ينمو مع الحمل، لا ما يبدو كبيراً في
--    نسبةٍ مئوية.)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
BEGIN
    IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
        RAISE EXCEPTION 'STOP: هذه هجرةُ إنتاج (جدة) ونحن على مختبر طوكيو.';
    END IF;
END
$guard$;

-- ═══ ① عدّاداتُ العروض: من كتابةٍ لكلّ مشاهدة إلى تجميعٍ كلَّ خمس دقائق ═══

CREATE TABLE IF NOT EXISTS public.deal_counter_cursor (
    only_row   boolean     PRIMARY KEY DEFAULT true CHECK (only_row),
    last_id    bigint      NOT NULL DEFAULT 0,
    synced_at  timestamptz,
    last_deals int         NOT NULL DEFAULT 0
);

ALTER TABLE public.deal_counter_cursor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.deal_counter_cursor FROM PUBLIC;
REVOKE ALL ON TABLE public.deal_counter_cursor FROM anon;
REVOKE ALL ON TABLE public.deal_counter_cursor FROM authenticated;

-- 🪤 يُهيَّأ على أحدثِ حدثٍ قائم: ما قبله محسوبٌ في `deals` فعلاً.
INSERT INTO public.deal_counter_cursor (only_row, last_id)
VALUES (true, COALESCE((SELECT max(id) FROM public.analytics_events), 0))
ON CONFLICT (only_row) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_ae_id_kind_deal
    ON public.analytics_events (id)
    WHERE kind IN ('deal_view', 'deal_click');

CREATE OR REPLACE FUNCTION public.taki_sync_deal_counters()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
    v_lo   bigint;
    v_hi   bigint;
    v_n    int := 0;
BEGIN
    SELECT last_id INTO v_lo FROM public.deal_counter_cursor WHERE only_row FOR UPDATE;
    IF v_lo IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'NO_CURSOR');
    END IF;

    -- 🪤 فسحةُ دقيقة: معرّفُ `identity` يُمنح قبل الإيداع، فترتيبُ الإيداع
    --    قد يخالف ترتيبَ المعرّفات. والحدُّ الأعلى يتجاهل آخرَ دقيقة فلا
    --    يُقفَل على صفٍّ لم يودَع بعد (وإلّا ضاع عدٌّ بصمتٍ إلى الأبد).
    SELECT max(id) INTO v_hi
      FROM public.analytics_events
     WHERE id > v_lo AND created_at < now() - interval '1 minute';

    IF v_hi IS NULL THEN
        UPDATE public.deal_counter_cursor
           SET synced_at = now(), last_deals = 0 WHERE only_row;
        RETURN jsonb_build_object('ok', true, 'deals', 0, 'cursor', v_lo);
    END IF;

    WITH agg AS (
        SELECT e.deal_id,
               count(*) FILTER (WHERE e.kind = 'deal_view')  AS v,
               count(*) FILTER (WHERE e.kind = 'deal_click') AS c
          FROM public.analytics_events e
         WHERE e.id > v_lo AND e.id <= v_hi
           AND e.kind IN ('deal_view', 'deal_click')
           AND e.deal_id IS NOT NULL
         GROUP BY e.deal_id
    ), upd AS (
        UPDATE public.deals d
           SET views  = COALESCE(d.views, 0)  + agg.v,
               clicks = COALESCE(d.clicks, 0) + agg.c
          FROM agg
         WHERE d.id = agg.deal_id AND (agg.v > 0 OR agg.c > 0)
        RETURNING 1
    ) SELECT count(*) INTO v_n FROM upd;

    UPDATE public.deal_counter_cursor
       SET last_id = v_hi, synced_at = now(), last_deals = v_n
     WHERE only_row;

    RETURN jsonb_build_object('ok', true, 'deals', v_n, 'cursor', v_hi);
END
$fn$;

REVOKE ALL ON FUNCTION public.taki_sync_deal_counters() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_sync_deal_counters() FROM anon;
REVOKE ALL ON FUNCTION public.taki_sync_deal_counters() FROM authenticated;

-- ── النداءان: حدثٌ فقط، بلا كتابةٍ على `deals` ────────────────────────────
-- 🪤 ولا يتغيّر التوقيعُ ولا المنح: الواجهةُ والبوتان ينادونهما كما هما.
CREATE OR REPLACE FUNCTION public.increment_deal_view(target_deal_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_store text;
BEGIN
    -- 🔴 لا `UPDATE deals` هنا: الكتابةُ تُجمَّع في `taki_sync_deal_counters`.
    SELECT store_id INTO v_store FROM public.deals WHERE id = target_deal_id;
    IF v_store IS NOT NULL THEN
        INSERT INTO public.analytics_events (kind, user_id, store_id, deal_id)
        VALUES ('deal_view', auth.uid()::text, v_store, target_deal_id);
    END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.increment_deal_click(target_deal_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_store text;
BEGIN
    SELECT store_id INTO v_store FROM public.deals WHERE id = target_deal_id;
    IF v_store IS NOT NULL THEN
        INSERT INTO public.analytics_events (kind, user_id, store_id, deal_id)
        VALUES ('deal_click', auth.uid()::text, v_store, target_deal_id);
    END IF;
END;
$fn$;

-- ═══ ② سجلُّ الكرون: ٩٠ يوماً ⇐ ٧ (وأوسعُ قارئٍ ٢٤ ساعة — قِيس) ═══════════
CREATE OR REPLACE FUNCTION public.taki_cron_log_retention_days()
RETURNS int LANGUAGE sql IMMUTABLE AS $$ SELECT 7 $$;

COMMENT ON FUNCTION public.taki_cron_log_retention_days() IS
 'نافذةُ الاحتفاظ بسجلّ الكرون. أوسعُ قارئٍ ٢٤ ساعة (taki_cron_health · '
 'taki_capacity_report)، فسبعةُ أيّام هامشٌ ٧×. رفعُها يُعيد نموَّ الجدول '
 '(قِيس ٦١ م.ب من ٩٢ عند ٩٠ يوماً) ويُثقل كلَّ نسخةٍ ساعية.';

-- 🪤 وتُعاد بناءُ `taki_cron_seen_sync` **من نصّها الحيّ** بتبديل الرقم وحده —
--    لا من نسخةٍ مكتوبةٍ هنا، وإلّا دُهس أيُّ تعديلٍ لا نعلم به (نفسُ قاعدة
--    إعادة بناء سياسات RLS في v14.92). والتبديلُ **يُتحقَّق من وقوعه**:
--    `replace` على نصٍّ غير موجود لا يُخطئ، فيبدو الإصلاحُ واقعاً وهو لم يقع.
DO $retune$
DECLARE
    v_def text;
    v_new text;
BEGIN
    SELECT pg_get_functiondef('public.taki_cron_seen_sync'::regproc) INTO v_def;
    v_new := replace(v_def,
        'DELETE FROM cron.job_run_details WHERE start_time < now() - interval ''90 days'';',
        'DELETE FROM cron.job_run_details'
        || ' WHERE start_time < now() - make_interval(days => public.taki_cron_log_retention_days());');
    IF v_new = v_def THEN
        RAISE EXCEPTION 'STOP: لم يُعثر على سطر الاحتفاظ ٩٠ يوماً في taki_cron_seen_sync — '
                        'تغيّر نصُّها، فلا تُبدَّل على العمياء.';
    END IF;
    EXECUTE v_new;
END
$retune$;

-- ── جدولةُ تجميع العدّادات ─────────────────────────────────────────────────
-- 🪤 `cron.schedule` بنفس الاسم تُحدّث ولا تُكرّر — فالهجرةُ آمنةُ التكرار.
SELECT cron.schedule('taki-deal-counters', '*/5 * * * *',
                     'SELECT public.taki_sync_deal_counters();');

DO $verify$
DECLARE
    v_bad text := '';
    v_src text;
BEGIN
    -- ① لا كتابةَ على `deals` في نداءِ المشاهدة بعد اليوم
    SELECT regexp_replace(pg_get_functiondef('public.increment_deal_view'::regproc), '--[^\n]*', '', 'g')
      INTO v_src;
    IF v_src ~* 'UPDATE[[:space:]]+(public\.)?deals\M' THEN
        v_bad := v_bad || ' · increment_deal_view ما زالت تكتب على deals';
    END IF;
    IF v_src !~* 'INSERT[[:space:]]+INTO[[:space:]]+(public\.)?analytics_events' THEN
        v_bad := v_bad || ' · increment_deal_view لم تعد تسجّل الحدث ⇒ ضاع العدّ كلّه';
    END IF;

    SELECT regexp_replace(pg_get_functiondef('public.increment_deal_click'::regproc), '--[^\n]*', '', 'g')
      INTO v_src;
    IF v_src ~* 'UPDATE[[:space:]]+(public\.)?deals\M' THEN
        v_bad := v_bad || ' · increment_deal_click ما زالت تكتب على deals';
    END IF;

    -- ② المؤشّرُ مهيَّأٌ على الحاضر لا على الصفر (وإلّا أُعيد عدُّ التاريخ)
    IF (SELECT last_id FROM public.deal_counter_cursor WHERE only_row)
       < COALESCE((SELECT max(id) FROM public.analytics_events), 0) THEN
        v_bad := v_bad || ' · المؤشّرُ خلفَ أحدث حدث ⇒ عدٌّ مكرَّر';
    END IF;

    -- ③ الجدولةُ قائمة
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'taki-deal-counters' AND active) THEN
        v_bad := v_bad || ' · كرونُ تجميع العدّادات غيرُ مجدول';
    END IF;

    -- ④ نافذةُ سجلّ الكرون سرت فعلاً
    IF pg_get_functiondef('public.taki_cron_seen_sync'::regproc) ILIKE '%interval ''90 days''%' THEN
        v_bad := v_bad || ' · نافذةُ ٩٠ يوماً ما زالت في taki_cron_seen_sync';
    END IF;

    -- ⑤ ولا منحَ على الجديد لزائرٍ أو موثَّق
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema='public' AND table_name='deal_counter_cursor'
                  AND grantee IN ('anon','authenticated','PUBLIC')) THEN
        v_bad := v_bad || ' · منحٌ باقٍ على deal_counter_cursor';
    END IF;

    IF v_bad <> '' THEN RAISE EXCEPTION 'فشل التحقّق:%', v_bad; END IF;
    RAISE NOTICE '✅ جدة · v15.94 · المشاهدةُ لم تعد كتابةً على deals · وسجلُّ الكرون ٧ أيّام';
END
$verify$;

COMMIT;

-- ── التنظيفُ الأوّل خارج المعاملة: حذفٌ ثمّ استرجاعُ المساحة ───────────────
-- 🪤 `VACUUM FULL` يأخذ قفلاً حصرياً — والجدولُ لا يقرؤه مستخدم، والعمليةُ
--    ثوانٍ على ٦١ م.ب. (ولا تُوضع داخل المعاملة: VACUUM لا تعمل فيها.)
DELETE FROM cron.job_run_details WHERE start_time < now() - interval '7 days';
VACUUM (FULL, ANALYZE) cron.job_run_details;
