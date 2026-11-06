-- ═══════════════════════════════════════════════════════════════════════════
-- v15.57 — أعطالُ السعة التي نجت من القياس
-- ═══════════════════════════════════════════════════════════════════════════
-- أمرُ ناصر: «فعلها جميعا اريد ان تصلح جميع الاعطال» — ومعه جدولُ البنود
-- الأربعة. فحصتُها فوجدتُ ثلاثةً منها **حيّةً فعلاً** (الضغط · المجمَّع ·
-- البثّ)، والرابع (سجلُّ الكرون) ما زال معطوباً. ثمّ مُسح صنفُه كلُّه بثماني
-- زوايا متوازية فخرج ٦٥ ادّعاءً — و**كلُّ ما في هذا الملفّ قِيس بنفسي** قبل
-- أن يُكتب، لا بتصديقِ تقرير.
--
-- 🔴 وأُسقط ادّعاءٌ كبيرٌ لأنه كذب: «٨٠٫٥٪ من WAL صورُ صفحاتٍ كاملة فشغّل
--    الضغط». القياسُ من `pg_stat_wal`: ٢٨٩٬١٠٠ FPI من ٤٬٧٠٨٬٩٥٤ سجلّاً
--    = **٦٫١٪** لا ٨٠٫٥٪ — خطأٌ بثلاثةَ عشرَ ضعفاً. فمكسبُ `wal_compression`
--    هامشيٌّ هنا، وتشغيلُه «تحسينٌ» بأثرٍ شبه صفر. **لم يُشغَّل.**
--
-- ── ما قِيس وثبت ──────────────────────────────────────────────────────────
-- ١) `cron.job_run_details` **بلا فهرسٍ غيرِ المفتاح الأساسيّ**، و
--    `seq_tup_read = 1,141,511,677` — مليارٌ ومئةُ مليون صفٍّ قُرئت مسحاً.
--    وهي أعلى قيمةٍ في القاعدة كلِّها بفارقٍ هائل. والماسحان `taki_cron_health`
--    (كلَّ ١٠ دقائق عبر النبض) و`taki_cron_seen_sync` (كلَّ ساعة). وأحدهما
--    يحسب `max(start_time)` لكلّ وظيفةٍ **بلا أيّ مرشّحٍ زمنيّ** ⇒ مسحٌ كامل.
--    ⇒ فهرسان يُنهيان ذلك، والجدولُ يبقى كما هو (الاحتفاظُ ٩٠ يوماً صحيح:
--      نافذةُ الكشف ٦٠، ودرسُ v15.25 أن الأضيقَ يمحو الدليل).
-- ٢) **تسعةُ** أعمدةِ مفتاحٍ أجنبيّ بلا فهرسٍ صالح — لا ستّة. ثلاثةٌ كانت
--    مخفيّةً خلف فهارسَ **جزئيّة** (`WHERE …`) تبدو في الجردة الساذجة
--    مفهرسةً وهي لا تخدم الحذف. وسبعةٌ أمُّها `users` بـCASCADE/SET NULL
--    ⇒ كلُّ حذفِ حسابٍ يمسح سبعةَ جداولَ مسحاً كاملاً. و`site_sessions`
--    أسرعُ جداول المنصّة نموّاً (صفٌّ لكلّ زيارة).
-- ٣) أربعةُ أزواجٍ من الفهارس **متطابقةٌ حرفياً** (نفسُ التعريف بعد الاسم).
--    وكلُّ فهرسٍ يُكلّف على كلّ إدراج. أثقلُها زوجان على
--    `store_analytics_events` التي تُكتب بصفٍّ لكلّ مشاهدةِ عرض.
-- ٤) `auth.audit_log_entries`: **صفرُ حذفٍ منذ نشأتها** (`n_tup_del = 0`)
--    و**صفرُ دالّةٍ في القاعدة تذكرها**. تنمو أبداً بلا قارئ.
-- ٥) `notifications` بلا منظّفٍ زمنيّ: الحاذفُ الوحيد `purge_expired_accounts`
--    (عند حذف حساب). قِيس: **٩٥٩ من ١٬٢٧٢** صفّاً أقدمُ من ٩٠ يوماً، وهي
--    أعلى جداول الإدراج عند النموّ (كلُّ حجزٍ ورسالةٍ وحملةٍ تكتب فيها).
-- ٦) `effective_cache_size` = **١٢٨ م.ب** في ملفّ الإعداد (و`boot_val` ٤ ج.ب)،
--    والجهازُ فيه ٣٫٦ ج.ب متاحةٌ و٣٫٧ buff/cache. فالمخطّطُ يظنّ الذاكرةَ
--    ثلاثين ضعفاً أقلَّ ممّا هي ⇒ يُبالغ في كلفة الفهارس ويميل للمسح التسلسليّ.
--    🪤 وهذا **غير** `shared_buffers`: تلك ١٢٨ م.ب وهي صحيحةٌ على قاعدةٍ
--       ٨٠ م.ب (كلُّها في الذاكرة)، فلا تُخلط بها.
-- ٧) `idle_in_transaction_session_timeout` **غيرُ مضبوطٍ لأيّ دورِ ويب**
--    (anon · authenticated · authenticator) — معاملةٌ خاملةٌ تحتجز أقفالَها
--    إلى الأبد. و`statement_timeout` مضبوطٌ لها (٣–٨ ثوانٍ) فهذا وحده الناقص.
--
-- 🪤 وتنظيفُ الإشعارات **يُبَثّ**: الجدولُ في نشر البثّ، واشتراكُ الحذف في
--    الواجهة كان **بلا مرشّح** (بينما الإضافةُ والتحديثُ مُرشَّحان على
--    `user_id` — صُحّح في نفس الإصدار). فحذفٌ ضخمٌ دفعةً واحدة يُقيَّم أمام
--    كلّ متّصل. ولذلك المنظّفُ **مسقوفٌ بدفعة** يُصرّف الركامَ على أيام.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
DECLARE r record;
BEGIN
  IF COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  -- 🪤 ولا يُسقط فهرسٌ «مكرّر» إلّا إن كان له توأمٌ باقٍ **على هذه القاعدة**:
  --    الهجرةُ تُكتب من قياسٍ على جدة، وتشغيلُها على مخطّطٍ مختلفٍ قد يُسقط
  --    فهرساً وحيداً لا توأمَ له. والشرطُ هنا «له توأمٌ أو هو مُسقَطٌ سلفاً»
  --    فالهجرةُ تبقى **قابلةً لإعادة التشغيل** (وقد لزم ذلك فعلاً).
  FOR r IN SELECT * FROM (VALUES
        ('idx_subs_merchant','merchant_subscriptions_merchant_id_key'),
        ('ix_stock_integrations_store','ux_stock_integrations_store_one'),
        ('idx_an_deal_time','idx_an_deal_created'),
        ('idx_an_store_created','idx_an_store_time')) v(victim, twin)
  LOOP
    IF to_regclass('public.'||r.victim) IS NOT NULL
       AND to_regclass('public.'||r.twin) IS NULL THEN
      RAISE EXCEPTION 'الفهرسُ % مرشَّحٌ للإسقاط وتوأمُه % غيرُ موجود — أوقِفت.', r.victim, r.twin;
    END IF;
  END LOOP;
END
$guard$;

-- ═══ ١) فهرسا سجلّ الكرون — أكبرُ مكسبٍ مفردٍ في القاعدة ═══════════════════
-- 🪤 بلا `CONCURRENTLY`: الهجرةُ كتلةٌ واحدة، وذاك يرفض العملَ داخل معاملة.
--    والجدولُ ٥٠ م.ب على قرصٍ محلّيّ ⇒ ثوانٍ، وكتّابُه وظائفُ كرونٍ تُعاد.
CREATE INDEX IF NOT EXISTS idx_cron_run_start     ON cron.job_run_details (start_time);
CREATE INDEX IF NOT EXISTS idx_cron_run_job_start ON cron.job_run_details (jobid, start_time DESC);

-- ═══ ٢) فهارسُ المفاتيح الأجنبية التسعة ════════════════════════════════════
-- 🔴 والاسمان هنا ينتهيان بـ`_fk` عمداً، ودرسُهما مدفوعُ الثمن في هذه الهجرة
--    نفسها: `CREATE INDEX IF NOT EXISTS <اسم>` يطابق **الاسمَ لا التعريف**.
--    وكان على الجدولين فهرسان بنفس الاسمين المقترحَين وتعريفٍ آخر تماماً:
--      • `idx_contest_entries_user` = UNIQUE على **(contest_id, user_id)**
--        وبشرطٍ جزئيّ — عمودٌ قائدٌ خاطئ، فلا يخدم الحذفَ إطلاقاً.
--      • `idx_delivery_zones_store` = جزئيٌّ `WHERE is_active` — فالمناطقُ
--        المعطّلة خارجَه، والحذفُ يمسحها مسحاً.
--    فمرّت الجملتان **بصمت** («already exists, skipping») وبدا الإصلاحُ تامّاً،
--    ولم يكشفه إلّا التحقّقُ السلوكيّ في آخر الملفّ. ⇒ لا يُسمَّى فهرسٌ جديد
--    باسمٍ قد يكون مأخوذاً، ولا يُصدَّق `IF NOT EXISTS` دليلاً على الوجود.
CREATE INDEX IF NOT EXISTS idx_contest_entries_user_fk ON public.contest_entries (user_id);
CREATE INDEX IF NOT EXISTS idx_site_sessions_user      ON public.site_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_stock_links_store       ON public.stock_links (store_id);
CREATE INDEX IF NOT EXISTS idx_stock_parked_claimed_by ON public.stock_oauth_parked (claimed_by);
CREATE INDEX IF NOT EXISTS idx_stock_queue_integration ON public.stock_refresh_queue (integration_id);
CREATE INDEX IF NOT EXISTS idx_delivery_zones_store_fk ON public.store_delivery_zones (store_id);
CREATE INDEX IF NOT EXISTS idx_ver_grace_opened_by     ON public.store_verification_grace (opened_by);
CREATE INDEX IF NOT EXISTS idx_ver_admin               ON public.store_verifications (admin_id);
CREATE INDEX IF NOT EXISTS idx_ver_store               ON public.store_verifications (store_id);

-- ═══ ٣) إسقاطُ الفهارس المتطابقة ═══════════════════════════════════════════
-- 🪤 ويُبقى في كلّ زوجٍ **الفريدُ** إن وُجد، لأن إسقاطَه يُسقط قيداً لا فهرساً.
DROP INDEX IF EXISTS public.idx_subs_merchant;           -- ≡ merchant_subscriptions_merchant_id_key (فريد — يبقى)
DROP INDEX IF EXISTS public.ix_stock_integrations_store; -- ≡ ux_stock_integrations_store_one (فريد — يبقى)
DROP INDEX IF EXISTS public.idx_an_deal_time;            -- ≡ idx_an_deal_created
DROP INDEX IF EXISTS public.idx_an_store_created;        -- ≡ idx_an_store_time

-- ═══ ٤) منظّفُ سجلّ مصادقة GoTrue ══════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.taki_prune_auth_audit()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v_n int;
BEGIN
  -- 🪤 ٩٠ يوماً: نفسُ نافذةِ `activity_log` المعلَنةِ في سياسة الخصوصية.
  --    ولا قارئَ لهذا الجدول في القاعدة إطلاقاً (قِيس: صفرُ دالّة تذكره)،
  --    فالنافذةُ ليست رهينةَ كشفٍ كما هي في سجلّ الكرون (درس v15.25).
  DELETE FROM auth.audit_log_entries WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.taki_prune_auth_audit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_prune_auth_audit() FROM anon, authenticated;

-- ═══ ٥) منظّفُ الإشعارات — مسقوفٌ بدفعة ════════════════════════════════════
CREATE OR REPLACE FUNCTION public.taki_prune_notifications(p_batch int DEFAULT 2000)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v_n int;
BEGIN
  -- 🔴 السقفُ ليس تجميلاً: الجدولُ في نشرِ البثّ الحيّ، فكلُّ صفٍّ محذوفٍ حدثٌ
  --    يُرسَل ويُقيَّم أمام كلّ متّصل. وبالسقف يُصرَّف الركامُ على أيامٍ بلا أثر.
  -- 🪤 والمقروءُ وحده يُحذف عند ٩٠ يوماً؛ وغيرُ المقروء يُمهَل ١٨٠ — فإشعارٌ
  --    لم يره صاحبُه ليس قمامةً، وحذفُه يُخفي عنه ما لم يعلمه قطّ.
  WITH victims AS (
    SELECT id FROM public.notifications
     WHERE (is_read IS TRUE     AND created_at < now() - interval '90 days')
        OR (is_read IS NOT TRUE AND created_at < now() - interval '180 days')
     ORDER BY created_at
     LIMIT GREATEST(1, LEAST(p_batch, 20000))
  )
  DELETE FROM public.notifications n USING victims v WHERE n.id = v.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.taki_prune_notifications(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_prune_notifications(int) FROM anon, authenticated;

-- ═══ ٦) جدولةُ المنظّفَين ══════════════════════════════════════════════════
SELECT cron.unschedule('taki-auth-audit-prune')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'taki-auth-audit-prune');
SELECT cron.unschedule('taki-notifications-prune')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'taki-notifications-prune');
SELECT cron.schedule('taki-auth-audit-prune',    '25 3 * * *', 'SELECT public.taki_prune_auth_audit()');
SELECT cron.schedule('taki-notifications-prune', '40 3 * * *', 'SELECT public.taki_prune_notifications()');

-- ═══ ٧) إعدادان قِيس أنهما خاطئان ══════════════════════════════════════════
-- 🪤 `ALTER DATABASE … SET` لا يصل جلسات PostgREST المجمَّعة (درسٌ مسجَّل)،
--    فـ`effective_cache_size` يُضبط على مستوى **النظام**، ويسري بإعادة تحميل.
ALTER SYSTEM SET effective_cache_size = '3GB';
SELECT pg_reload_conf();

-- ومهلةُ المعاملة الخاملة تُضبط **لكلّ دور** — وهذه تصل فعلاً: PostgREST يفتح
-- اتصالَه بدور `authenticator` ثمّ `SET ROLE`، وإعدادُ الدور يُطبَّق عند الاتصال
-- (وهو نفسُ الطريق الذي يصل به `statement_timeout` المضبوطُ لها أصلاً).
ALTER ROLE authenticator SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE authenticated SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE anon          SET idle_in_transaction_session_timeout = '15s';

-- ═══ التحقّقُ السلوكيّ — يرفع استثناءً ولا يكتفي بجدول ✅/❌ ════════════════
-- 🪤 درسٌ مدفوعُ الثمن: صفٌّ يقول ❌ لا يُفشل `psql` (الخروجُ صفر). فكلُّ
--    تحقّقٍ هنا `DO` يرفع، والجدولُ أسفلَه للقراءة وحدها.
DO $behave$
DECLARE v_idx int; v_fk int; v_dup int; v_ecs bigint; v_roles int; v_n int;
BEGIN
  SELECT count(*) INTO v_idx FROM pg_indexes
   WHERE schemaname = 'cron' AND tablename = 'job_run_details'
     AND indexname IN ('idx_cron_run_start','idx_cron_run_job_start');
  IF v_idx <> 2 THEN RAISE EXCEPTION 'فهرسا سجلّ الكرون: % من ٢', v_idx; END IF;

  SELECT count(*) INTO v_fk FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
   WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
     AND NOT EXISTS (SELECT 1 FROM pg_index i
                      WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]
                        AND i.indpred IS NULL AND i.indisvalid);
  IF v_fk <> 0 THEN RAISE EXCEPTION 'بقي % مفتاحاً أجنبياً بلا فهرس', v_fk; END IF;

  SELECT count(*) INTO v_dup FROM (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
     GROUP BY tablename, regexp_replace(indexdef,'^CREATE (UNIQUE )?INDEX [^ ]+ ','')
    HAVING count(*) > 1) q;
  IF v_dup <> 0 THEN RAISE EXCEPTION 'بقي % زوجاً من الفهارس المتطابقة', v_dup; END IF;

  SELECT setting::bigint INTO v_ecs FROM pg_settings WHERE name = 'effective_cache_size';
  IF v_ecs < 300000 THEN RAISE EXCEPTION 'effective_cache_size ما زال % (وحدةُ ٨ ك.ب)', v_ecs; END IF;

  SELECT count(*) INTO v_roles FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
   WHERE r.rolname IN ('authenticator','authenticated','anon')
     AND EXISTS (SELECT 1 FROM unnest(s.setconfig) x WHERE x LIKE 'idle_in_transaction%');
  IF v_roles <> 3 THEN RAISE EXCEPTION 'مهلةُ المعاملة الخاملة ضُبطت لـ% أدوارٍ من ٣', v_roles; END IF;

  -- 🪤 ولا يُصدَّق منظّفٌ لم يُنفَّذ (درس «الاختبارُ الذي لا يختبر شيئاً»):
  --    يُستدعى فعلاً ويُشترط أن يحذف — قِيس قبل الهجرة ٩٥٩ مرشّحاً.
  SELECT public.taki_prune_notifications(50) INTO v_n;
  IF v_n = 0 THEN RAISE EXCEPTION 'منظّفُ الإشعارات حذف صفراً والمقيسُ ٩٥٩ مرشّحاً'; END IF;
  RAISE NOTICE '✓ منظّفُ الإشعارات حذف % صفّاً في دفعةِ اختبار', v_n;

  SELECT public.taki_prune_auth_audit() INTO v_n;
  RAISE NOTICE '✓ منظّفُ سجلّ المصادقة نُفِّذ وحذف % صفّاً', v_n;
END
$behave$;

ANALYZE cron.job_run_details;
ANALYZE public.notifications;

-- ═══ جدولُ القراءة ═════════════════════════════════════════════════════════
SELECT 'الخادم' AS بند,
       COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'جدة — الإنتاج') AS قيمة,
       '—' AS حالة
UNION ALL
SELECT 'فهارسُ سجلّ الكرون', count(*)::text, CASE WHEN count(*) = 2 THEN '✅' ELSE '❌' END
  FROM pg_indexes WHERE schemaname='cron' AND tablename='job_run_details' AND indexname LIKE 'idx_cron_run%'
UNION ALL
SELECT 'مفاتيحُ أجنبيّة بلا فهرس', count(*)::text, CASE WHEN count(*) = 0 THEN '✅' ELSE '❌' END
  FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
 WHERE c.contype='f' AND c.connamespace='public'::regnamespace
   AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=c.conrelid AND i.indkey[0]=c.conkey[1]
                     AND i.indpred IS NULL AND i.indisvalid)
UNION ALL
SELECT 'effective_cache_size', (SELECT setting || ' × ٨ ك.ب' FROM pg_settings WHERE name='effective_cache_size'), '✅'
UNION ALL
SELECT 'منظّفاتٌ مجدولة', count(*)::text, CASE WHEN count(*) = 2 THEN '✅' ELSE '❌' END
  FROM cron.job WHERE jobname IN ('taki-auth-audit-prune','taki-notifications-prune')
UNION ALL
SELECT 'إشعاراتٌ باقية', count(*)::text, '—' FROM public.notifications
UNION ALL
SELECT 'سجلُّ المصادقة', count(*)::text, '—' FROM auth.audit_log_entries;
