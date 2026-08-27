-- ═══════════════════════════════════════════════════════════════════════════
-- TAKI — الحسم النهائي لسطح البوت  (خادم جدة)  —  للقراءة فقط
--
-- نتيجة التشخيص السابق على جدة: البوّابة **تعمل**.
--   _bot_gate_ok موجود · app_secrets مضبوط · bot_gate_enforced = '1'
--   · _bot_uid يستدعي الحارس.
--
-- لكن قائمة «٦٧ دالّة لا تستدعي الحارس» كانت **عنواناً مضلّلاً كتبته أنا**:
-- الحماية في تاكي طبقتان — إمّا استدعاء `_bot_gate_ok()` مباشرة (١٢ دالّة)،
-- وإمّا المرور عبر `_bot_uid()` الذي يستدعيه بنفسه (عشرات الدوال). فالدالّة
-- التي لا تستدعي الحارس مباشرة قد تكون محميّة تماماً.
--
-- السؤال الصحيح إذن: أيّ دالّة متاحة للزائر **ولا تمرّ بأيّ من الطريقين**؟
-- وهل تأخذ هويّة مستخدم (p_telegram_id / p_whatsapp_id)؟ فإن جمعت الأمرين
-- فهي انتحال شخصية حقيقي. وإن كانت بلا هويّة فهي قراءة عامة مقصودة.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ١) سطح الانتحال الحقيقي ─────────────────────────────────────────────
--     المتوقّع: لا صفّ واحد بـ«🚨». والقراءات العامة تظهر بـ«عام — مقصود».
SELECT
    p.proname AS "الدالة",
    CASE WHEN pg_get_function_identity_arguments(p.oid) ILIKE '%p\_telegram\_id%'
           OR pg_get_function_identity_arguments(p.oid) ILIKE '%p\_whatsapp\_id%'
         THEN '🚨 تأخذ هويّة مستخدم وبلا حماية'
         ELSE '✅ عام — مقصود' END AS "الحكم"
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname LIKE 'bot\_%'
   AND has_function_privilege('anon', p.oid, 'EXECUTE')
   AND pg_get_functiondef(p.oid) NOT ILIKE '%\_bot\_gate\_ok%'
   AND pg_get_functiondef(p.oid) NOT ILIKE '%\_bot\_uid%'
 ORDER BY 2, 1;

-- ── ٢) العدّ المختصر ─────────────────────────────────────────────────────
SELECT
    count(*) FILTER (WHERE g OR u)                          AS "محميّة (حارس أو هويّة)",
    count(*) FILTER (WHERE NOT (g OR u) AND ident)          AS "🚨 مكشوفة وتأخذ هويّة",
    count(*) FILTER (WHERE NOT (g OR u) AND NOT ident)      AS "عامة مقصودة"
  FROM (
    SELECT pg_get_functiondef(p.oid) ILIKE '%\_bot\_gate\_ok%' AS g,
           pg_get_functiondef(p.oid) ILIKE '%\_bot\_uid%'      AS u,
           (pg_get_function_identity_arguments(p.oid) ILIKE '%p\_telegram\_id%'
         OR pg_get_function_identity_arguments(p.oid) ILIKE '%p\_whatsapp\_id%') AS ident
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname LIKE 'bot\_%'
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ) t;

-- ── ٣) الدوال الإدارية: يجب ألّا يستطيع الزائر استدعاء أيّ منها ─────────
SELECT count(*) AS "🚨 دوال admin_ متاحة للزائر (المتوقّع ٠)"
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND p.proname LIKE 'admin\_%'
   AND has_function_privilege('anon', p.oid, 'EXECUTE');

-- ── ٤) كل دالّة بصلاحية المالك يجب أن يكون مسارها مثبَّتاً ───────────────
SELECT count(*) AS "🚨 دوال SECURITY DEFINER بلا search_path (المتوقّع ٠)"
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef
   AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}')) x
                    WHERE x LIKE 'search_path=%');

-- ── ٥) RLS على كل جدول ──────────────────────────────────────────────────
SELECT count(*) AS "🚨 جداول بلا RLS (المتوقّع ٠)"
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity;
