-- ═══════════════════════════════════════════════════════════════════════════
-- v13.75 — 🔴 حرجة: `public.sellers_public` كان قابلاً للكتابة من **زائر بلا حساب**
--
-- ما الذي حدث بالضبط
-- ------------------
-- هجرة v13.71 أنشأت دليل المتاجر العام كـ VIEW ثم منحت `GRANT SELECT` فقط.
-- لكن سوبابيس يضبط `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON
-- TABLES TO anon, authenticated` — و«TABLES» في بوستجرس **تشمل الـviews**.
-- فالمنحة الافتراضية سبقت أمرنا وأعطت anon كل الصلاحيات، و`GRANT SELECT`
-- لم يكن يسحب شيئاً. النتيجة على القاعدة:
--
--     anon = arwdDxtm/postgres      ← INSERT + UPDATE + DELETE + TRUNCATE
--     pg_relation_is_updatable = 28 ← الـview قابل للتحديث تلقائياً
--     security_invoker = false      ← الكتابة تُنفَّذ بصلاحية مالك الـview
--
-- والـviews **لا تخضع لـRLS**. فاجتمعت ثلاثة شروط: صلاحية كتابة لـanon +
-- view قابل للتحديث + تنفيذ بصلاحية المالك = **تجاوز كامل لسياسات RLS على
-- جدول `users`** من مفتاح anon العلني الذي يحمله كل زائر في المتصفح.
--
-- الإثبات (نُفِّذ فعلياً داخل معاملة أُلغيت — صفر أثر):
--     SET LOCAL ROLE anon;
--     UPDATE public.sellers_public SET bio='PWNED_BY_ANON', user_type='buyer'
--      WHERE id = <أي تاجر>;
--     → rows=1 | bio: «محل يبيع…» → «PWNED_BY_ANON» | user_type: seller → buyer
--
-- ماذا كان يستطيع المهاجم فعله بلا حساب إطلاقاً:
--   • تغيير اسم/نبذة/جوال/إحداثيات **كل** متجر في المنصة.
--   • `UPDATE … SET user_type='buyer' WHERE user_type='admin'` → تنزيل كل
--     المدراء وشلّ إدارة المنصة.
--   • `DELETE FROM sellers_public` → حذف كل صفوف التجار والمدراء.
--
-- الإصلاح (طبقتان — لا يكفي أن نعتمد على واحدة)
-- ---------------------------------------------
-- (١) سحب صلاحيات الكتابة عن **كل** views مخطط public لا عن هذا الـview وحده،
--     فالفخّ عام لكل view يُنشأ في المخطط. التطبيق لا يكتب في أي view إطلاقاً
--     (فُحص: `sellers_public` و`v_top_*` تُقرأ بـselect فقط، و`app_secrets`
--     تُقرأ بمفتاح الخدمة من الدوال الطرفية) — فالسحب بلا أثر وظيفي.
-- (٢) مُشغّل `INSTEAD OF` على الـview الحسّاس يرفض أي كتابة بخطأ صريح. فحتى
--     لو عادت منحة خاطئة يوماً ما — بهجرة جديدة أو استعادة نسخة احتياطية —
--     تبقى الكتابة مستحيلة.
--     ملاحظة من الاختبار: جُرّبت أولاً قواعد `DO INSTEAD NOTHING` فمنعت
--     الكتابة فعلاً **لكنها تبتلعها بصمت** — يعود الطلب بنجاح وهو لم يفعل
--     شيئاً. الفشل الصامت هو عين الفخّ الذي كلّفنا v13.71 و v13.66، فاستُبدلت
--     بمشغّل يرفع `insufficient_privilege` صراحةً.
--
-- لماذا لا نستخدم `security_invoker = true`؟ لأنه يُخضع القراءة لسياسة
-- `users_select_own_or_admin`، فيرى الزائر صفر متاجر وينهار الدليل العام —
-- وهو عين ما جاءت v13.71 لتوفّره. الصواب: view بصلاحية المالك للقراءة،
-- والكتابة ممنوعة منعاً باتّاً.
--
-- آمنة للتشغيل المتكرّر (idempotent).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── (١) سحب الكتابة عن كل views مخطط public ───────────────────────────────
DO $$
DECLARE v record;
BEGIN
    FOR v IN
        SELECT c.oid::regclass AS rel
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
    LOOP
        EXECUTE format(
            'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON %s FROM PUBLIC, anon, authenticated',
            v.rel);
    END LOOP;
END $$;

-- ── (٢) الدليل العام: قراءة فقط، صراحةً ───────────────────────────────────
REVOKE ALL PRIVILEGES ON public.sellers_public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sellers_public TO anon, authenticated;

-- ── (٣) حاجز بنيوي: الـview يرفض أي كتابة بخطأ صريح، مهما كانت المنح ───────
CREATE OR REPLACE FUNCTION public.tg_sellers_public_readonly()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
    RAISE EXCEPTION
        'sellers_public هو دليل قراءة فقط — الكتابة تتم على جدول users عبر سياساته'
        USING ERRCODE = 'insufficient_privilege';
END;
$function$;

DROP TRIGGER IF EXISTS tr_sellers_public_readonly ON public.sellers_public;
CREATE TRIGGER tr_sellers_public_readonly
    INSTEAD OF INSERT OR UPDATE OR DELETE ON public.sellers_public
    FOR EACH ROW EXECUTE FUNCTION public.tg_sellers_public_readonly();

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- التحقّق — شغّله بعد الهجرة، والمتوقع ✅ في الأعمدة الأربعة كلها
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
    CASE WHEN has_table_privilege('anon', 'public.sellers_public', 'SELECT')
         THEN '✅ نعم' ELSE '❌ لا' END      AS "١ الزائر ما زال يقرأ الدليل؟",
    CASE WHEN NOT has_table_privilege('anon', 'public.sellers_public', 'UPDATE')
          AND NOT has_table_privilege('anon', 'public.sellers_public', 'INSERT')
          AND NOT has_table_privilege('anon', 'public.sellers_public', 'DELETE')
         THEN '✅ نعم' ELSE '❌ لا' END      AS "٢ كتابة الزائر مُنعت؟",
    CASE WHEN NOT has_table_privilege('authenticated', 'public.sellers_public', 'UPDATE')
          AND NOT has_table_privilege('authenticated', 'public.sellers_public', 'INSERT')
          AND NOT has_table_privilege('authenticated', 'public.sellers_public', 'DELETE')
         THEN '✅ نعم' ELSE '❌ لا' END      AS "٣ كتابة المسجَّل مُنعت؟",
    CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                       WHERE tgrelid = 'public.sellers_public'::regclass
                         AND tgname = 'tr_sellers_public_readonly' AND NOT tgisinternal)
         THEN '✅ نعم' ELSE '❌ لا' END      AS "٤ الحاجز البنيوي مركّب؟",
    (SELECT count(*)::text FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('v','m')
        AND (has_table_privilege('anon', c.oid, 'UPDATE')
          OR has_table_privilege('anon', c.oid, 'INSERT')
          OR has_table_privilege('anon', c.oid, 'DELETE')))
                                            AS "٥ views أخرى ما زالت مكشوفة (المتوقع 0)";
