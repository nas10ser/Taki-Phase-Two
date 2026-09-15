-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.47 — تدوير ثانٍ لسرّ بوّابة البوت (خطأ مني، لا حادث)
-- ════════════════════════════════════════════════════════════════════════════
-- في ١٥ سبتمبر ٢٠٢٦ كنتُ أقرأ `~/Desktop/TAKI-مفاتيح-الخدمات.txt` بأمرٍ يُفترض
-- أن يُمَوِّه القيم، فلم يُمَوِّه: كل سرٍّ فيه مكتوبٌ على سطرٍ مستقلّ بلا `=`،
-- فمرّ من المرشّح كما هو وطُبع في سجلّ الجلسة. أربعة: مفتاح Render وتوكن GitHub
-- وكلمة لوحة Studio **وسرّ بوّابة البوت**.
--
-- هذا هو نفس الخطأ الذي وثّقتُه بالأمس («لا تطبع قيمة سرّ أبداً») — ارتكبتُه
-- بعد يومٍ واحد من كتابته. والقاعدة تُشدَّد: **لا يُقرأ ملف المفاتيح بأمرٍ
-- يطبع مخرجاته إطلاقاً.** يُقرأ بـ`grep -o` داخل متغيّر ويُستعمل `$VAR` وحده.
--
-- ما أستطيع تدويره بنفسي دوّرتُه: هذا السرّ. والاثنان الباقيان (Render و
-- GitHub) يحتاجان لوحتيهما فطلبتُهما من ناصر.
--
-- النافذة كما وثّقها v14.30: `_bot_gate_ok()` تقبل السرّين معاً، فأُنشئ الجديد
-- في الخزنة (مُولَّداً على الخادم بـ`gen_random_bytes`) ثم حُدّث متغيّر Render
-- بـ`PUT` ثم نُشر البوت. وهذه الهجرة تُغلق النافذة — وترفض التنفيذ ما لم
-- يُبلّغ البوت أنه على الجديد وما لم يكن بلاغه طازجاً.
--
-- الخادم المستهدف: **جدة (الإنتاج)**. يرفض التنفيذ على مختبر طوكيو.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'TOKYO_LAB_REFUSED: هذه هجرة إنتاج. نفّذها على جدة.';
  END IF;
END
$guard$;

DO $rot$
DECLARE
  v_new   text;
  v_old   text;
  v_which text;
  v_seen  timestamptz;
  v_id    uuid;
BEGIN
  SELECT which, seen_at INTO v_which, v_seen FROM public.bot_gate_usage WHERE id = 1;

  IF v_which IS DISTINCT FROM 'next' THEN
    RAISE EXCEPTION
      'BOT_STILL_ON_OLD_SECRET: البوت يُبلّغ «%» لا «next» (آخر بلاغ %). إغلاق النافذة الآن يُسقطه.',
      COALESCE(v_which,'لا بلاغ'), COALESCE(v_seen::text,'—');
  END IF;

  IF v_seen < now() - interval '2 hours' THEN
    RAISE EXCEPTION 'STALE_REPORT: آخر بلاغ من البوت قبل % — أعِد نشره ثم أعِد المحاولة.', v_seen;
  END IF;

  SELECT value INTO v_new FROM public.app_secrets WHERE key = 'bot_gateway_secret_next';
  SELECT value INTO v_old FROM public.app_secrets WHERE key = 'bot_gateway_secret';
  IF v_new IS NULL OR length(v_new) <> 64 THEN
    RAISE EXCEPTION 'NO_NEW_SECRET: لا يوجد سرّ جديد صالح في الخزنة.';
  END IF;
  IF v_new = v_old THEN
    RAISE EXCEPTION 'SAME_SECRET: الجديد يطابق القديم — لا تدوير فعلياً.';
  END IF;

  -- الترقية: الجديد يصير هو المعتمد.
  SELECT id INTO v_id FROM vault.secrets WHERE name = 'app_secret:bot_gateway_secret';
  PERFORM vault.update_secret(v_id, v_new, 'app_secret:bot_gateway_secret',
                              'سرّ بوّابة البوت — دُوّر ٢٠٢٦-٠٩-١٥ مرّتين (v14.47)');

  -- وحذف المؤقّت حتى لا يبقى سرّان صالحان بلا سبب.
  DELETE FROM vault.secrets WHERE name = 'app_secret:bot_gateway_secret_next';

  -- البلاغ يعود إلى 'current': البوت يحمل الآن القيمة المعتمدة نفسها.
  UPDATE public.bot_gate_usage SET which = 'current' WHERE id = 1;
END
$rot$;

-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق
-- ════════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS الفحص,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ مختبر طوكيو'
            ELSE '✅ جدة (الإنتاج)' END AS النتيجة
UNION ALL SELECT 'سرٌّ معتمد واحد فقط',
       CASE WHEN (SELECT count(*) FROM public.app_secrets WHERE key LIKE 'bot_gateway_secret%') = 1
            THEN '✅ واحد' ELSE '❌ أكثر من واحد' END
UNION ALL SELECT 'لا سرّ مؤقّت متبقٍّ',
       CASE WHEN NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'app_secret:bot_gateway_secret_next')
            THEN '✅ حُذف' ELSE '❌ باقٍ' END
UNION ALL SELECT 'طول السرّ المعتمد',
       CASE WHEN (SELECT length(value) FROM public.app_secrets WHERE key='bot_gateway_secret') = 64
            THEN '✅ ٦٤ محرفاً' ELSE '❌ غير متوقّع' END
UNION ALL SELECT 'البوّابة ما زالت ثنائية المفتاح',
       CASE WHEN pg_get_functiondef('public._bot_gate_ok()'::regprocedure) LIKE '%bot_gateway_secret_next%'
            THEN '✅ التدوير القادم بلا انقطاع' ELSE '❌ صارت مفتاحاً واحداً' END;
