-- ═══════════════════════════════════════════════════════════════════════════
-- TAKI — تصدير «عقل القاعدة» من جدة إلى ملف  (خطوة واحدة)
--
-- ⚠️ لماذا هذا الملف مهمّ أكثر مما يبدو:
--
--   التطبيق ينادي **٢١٣** دالة في القاعدة. **١٨٩ منها غير موجودة في
--   المستودع إطلاقاً** — كل تحليلات لوحة المدير، وواجهة البوت كلها، وتصفّح
--   الطلبات، والمسابقات، والمدفوعات، والتقييمات. هذه كُتبت مباشرة على الخادم
--   ولم يُحفظ لها ملف.
--
--   معناه بلا مجاملة: **لو فُقد خادم جدة، لا يستطيع المستودع وحده إعادة بناء
--   التطبيق.** الكود الأمامي موجود، والعقل الذي يشغّله ليس موجوداً.
--
-- الخطوة: شغّل هذا الملف في SQL Editor على جدة، ثم اضغط **Download CSV**
-- فوق جدول النتائج، وأرسل لي الملف الناتج — أحفظه في المستودع فيصير النظام
-- قابلاً لإعادة البناء من الصفر.
--
-- (هذا حلّ إسعافي. الحلّ الدائم نسخة احتياطية آلية يومية `pg_dump` على
--  الخادم نفسه — نضبطها في جلسة مخصّصة.)
-- ═══════════════════════════════════════════════════════════════════════════

SELECT 'FUNCTION' AS kind, p.proname AS name, pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prokind = 'f'

UNION ALL

SELECT 'TRIGGER', c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid)
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND NOT t.tgisinternal

UNION ALL

SELECT 'POLICY', pol.tablename || '.' || pol.policyname,
       'CREATE POLICY ' || quote_ident(pol.policyname) || ' ON public.' || quote_ident(pol.tablename)
       || ' AS ' || pol.permissive || ' FOR ' || pol.cmd
       || ' TO ' || array_to_string(pol.roles, ', ')
       || COALESCE(' USING (' || pol.qual || ')', '')
       || COALESCE(' WITH CHECK (' || pol.with_check || ')', '') || ';'
  FROM pg_policies pol
 WHERE pol.schemaname = 'public'

UNION ALL

SELECT 'INDEX', indexname, indexdef || ';'
  FROM pg_indexes WHERE schemaname = 'public'

UNION ALL

SELECT 'VIEW', table_name,
       'CREATE OR REPLACE VIEW public.' || quote_ident(table_name) || ' AS '
       || pg_get_viewdef(('public.' || quote_ident(table_name))::regclass, true)
  FROM information_schema.views WHERE table_schema = 'public'

ORDER BY 1, 2;
