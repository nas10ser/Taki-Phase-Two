-- ═══════════════════════════════════════════════════════════════════════════
-- v14.92b — مفتاحُ إعدادٍ لا تراه سياسةُ القراءة = إعدادٌ لا يعمل
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 قِيس، لم يُستنتج: ضُبط `complaints_sla_hours = 6` في القاعدة، وبقيت
--    الواجهة تقول «نردّ خلال ٢٤ ساعة». السبب أن قائمة المفاتيح العامّة
--    مكتوبةٌ في **ثلاثة** مواضع، ودخل المفتاح الجديد اثنين منها فقط:
--      ١. فرعُ التطبيق في الواجهة        ✅ (كان موجوداً)
--      ٢. قائمة الجلب الأوّل             ❌ (أُصلح في `platformSettings.ts`)
--      ٣. **قائمة السماح داخل سياسة RLS** ❌ ← هذا الملفّ
--
-- والعطب صامتٌ تماماً: `SELECT` يعود بصفر صفوف لا بخطأ، فترتدّ الواجهة إلى
--    الافتراضي وتبدو سليمة. وهو نفس فخّ «انحراف قيد CHECK» المسجَّل في قواعد
--    المشروع: كاتبٌ وقارئٌ لنفس المفتاح ينحرفان بلا صوت.
--
-- 🪤 وتُعاد بناءُ السياسة **من نصّها الحيّ** لا من نسخةٍ مكتوبة هنا: قائمةُ
--    المفاتيح قد تكون تغيّرت على الخادم منذ آخر مرّة، وإعادةُ كتابتها من
--    الذاكرة تحذف مفاتيح لا نعلم بها. نُضيف عنصراً واحداً ولا نمسّ الباقي.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── حارس: هذه هجرة إنتاج (جدّة) ────────────────────────────────────────────
DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
END
$guard$;

DO $patch$
DECLARE
  v_qual  text;
  v_roles text;
  v_cmd   text;
BEGIN
  SELECT pg_get_expr(p.polqual, p.polrelid),
         COALESCE(
           (SELECT string_agg(quote_ident(r.rolname), ', ')
              FROM pg_roles r WHERE r.oid = ANY(p.polroles)),
           'public')                       -- 🪤 polroles فارغةٌ تعني public
    INTO v_qual, v_roles
    FROM pg_policy p
   WHERE p.polrelid = 'public.platform_settings'::regclass
     AND p.polname  = 'platform_settings_select';

  IF v_qual IS NULL THEN
    RAISE EXCEPTION 'السياسة platform_settings_select غير موجودة — أوقِفت قبل أن أهدم شيئاً.';
  END IF;

  IF position('''complaints_sla_hours''' IN v_qual) > 0 THEN
    RAISE NOTICE 'ℹ️ المفتاح مُدرَجٌ أصلاً — لا تغيير.';
    RETURN;
  END IF;

  -- الإضافة الجراحية: عنصرٌ واحد داخل نفس مصفوفة المفاتيح، وبقيّةُ الشرط
  -- (وفرعُ الأدمن) تبقى حرفياً كما هي على الخادم.
  v_qual := replace(v_qual, '''merchant_vat''::text]',
                            '''merchant_vat''::text, ''complaints_sla_hours''::text]');
  IF position('''complaints_sla_hours''' IN v_qual) = 0 THEN
    RAISE EXCEPTION 'تعذّر إدراج المفتاح: نصّ السياسة الحيّ لا يطابق المرساة المتوقَّعة. أوقِفت بلا تغيير.';
  END IF;

  v_cmd := format(
    'DROP POLICY IF EXISTS platform_settings_select ON public.platform_settings; '
    'CREATE POLICY platform_settings_select ON public.platform_settings '
    'FOR SELECT TO %s USING (%s);', v_roles, v_qual);
  EXECUTE v_cmd;
  RAISE NOTICE '✅ أُدرج complaints_sla_hours في سياسة القراءة (الأدوار: %)', v_roles;
END
$patch$;

-- ── تحقّقٌ يرفع استثناءً (جدولُ ✅/❌ لا يُفشل psql) ─────────────────────────
DO $verify$
DECLARE v_qual text;
BEGIN
  SELECT pg_get_expr(polqual, polrelid) INTO v_qual
    FROM pg_policy
   WHERE polrelid = 'public.platform_settings'::regclass
     AND polname  = 'platform_settings_select';

  IF v_qual IS NULL OR position('''complaints_sla_hours''' IN v_qual) = 0 THEN
    RAISE EXCEPTION '❌ المفتاح ما زال محجوباً عن القراءة.';
  END IF;
  IF position('''merchant_vat''' IN v_qual) = 0
     OR position('''seasonal_theme''' IN v_qual) = 0
     OR position('''booking_holds''' IN v_qual) = 0 THEN
    RAISE EXCEPTION '❌ فُقدت مفاتيح كانت مسموحة — تراجَعْ فوراً.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.platform_settings WHERE key = 'complaints_sla_hours') THEN
    RAISE EXCEPTION '❌ صفّ complaints_sla_hours غير موجود.';
  END IF;

  RAISE NOTICE '✅ مهلةُ الشكاوى صارت مقروءةً للمستخدم، وبقيّةُ المفاتيح سليمة.';
END
$verify$;
