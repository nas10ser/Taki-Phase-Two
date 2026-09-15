-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.43 — إغلاق نافذة التدوير: تقاعد السرّ القديم
-- ════════════════════════════════════════════════════════════════════════════
-- v14.30 فتحت نافذة تدوير: `_bot_gate_ok()` تقبل `bot_gateway_secret` و
-- `bot_gateway_secret_next` معاً حتى يُحدَّث متغيّر البيئة على Render — فلا
-- ينقطع البوت لحظة واحدة.
--
-- **لا تُشغَّل هذه الهجرة إلا بعد أن يُبلّغ البوت أنه على الجديد**:
--   SELECT which FROM public.bot_gate_usage;   -- يجب أن تقول 'next'
-- وهي نفسها تفحص ذلك وترفض التنفيذ إن لم يكن كذلك — فلا تُغلق النافذة على
-- بوتٍ ما زال يحمل القديم فتُسقطه.
--
-- 🪤 `public.app_secrets` **عرضٌ لا جدول**: يقرأ من خزنة Supabase بأسماء
-- `app_secret:<المفتاح>`. التحديث بـ`vault.update_secret` لا بـ`UPDATE`.
--
-- البوّابة تبقى ثنائية المفتاح عمداً: التدوير القادم يصير بلا انقطاع بلا أي
-- تعديل على الكود — تُنشئ `…_next` وتُحدّث Render ثم تُشغّل هذه الهجرة.
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

  -- بلاغٌ قديم لا يُعتمد: قد يكون البوت أُعيد تشغيله بعده بقيمةٍ أخرى.
  IF v_seen < now() - interval '2 hours' THEN
    RAISE EXCEPTION 'STALE_REPORT: آخر بلاغ من البوت قبل % — أعِد نشره ثم أعِد المحاولة.', v_seen;
  END IF;

  SELECT value INTO v_new FROM public.app_secrets WHERE key = 'bot_gateway_secret_next';
  IF v_new IS NULL OR length(v_new) <> 64 THEN
    RAISE EXCEPTION 'NO_NEW_SECRET: لا يوجد سرّ جديد صالح في الخزنة.';
  END IF;

  -- الترقية: الجديد يصير هو المعتمد.
  SELECT id INTO v_id FROM vault.secrets WHERE name = 'app_secret:bot_gateway_secret';
  PERFORM vault.update_secret(v_id, v_new, 'app_secret:bot_gateway_secret',
                              'سرّ بوّابة البوت — دُوّر ٢٠٢٦-٠٩-١٥ (v14.43)');

  -- وحذف المؤقّت حتى لا يبقى سرّان صالحان بلا سبب.
  DELETE FROM vault.secrets WHERE name = 'app_secret:bot_gateway_secret_next';

  RAISE NOTICE 'اكتمل التدوير: القديم تقاعد، والجديد صار المعتمد.';
END
$rot$;

-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق
-- ════════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS الفحص,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ مختبر طوكيو'
            ELSE '✅ جدة (الإنتاج)' END AS النتيجة
UNION ALL SELECT 'السرّ المؤقّت حُذف',
       CASE WHEN NOT EXISTS (SELECT 1 FROM public.app_secrets WHERE key='bot_gateway_secret_next')
            THEN '✅ لم يعد موجوداً' ELSE '❌ ما زال' END
UNION ALL SELECT 'السرّ المعتمد بطول صحيح',
       CASE WHEN (SELECT length(value) FROM public.app_secrets WHERE key='bot_gateway_secret') = 64
            THEN '✅ ٦٤ محرفاً' ELSE '❌ خطأ' END
UNION ALL SELECT 'البوّابة ما زالت تحرس',
       CASE WHEN (SELECT value FROM public.app_secrets WHERE key='bot_gate_enforced') = '1'
            THEN '✅ مفعّلة' ELSE '❌ معطّلة!' END
UNION ALL SELECT 'البوّابة تبقى ثنائية المفتاح للتدوير القادم',
       CASE WHEN pg_get_functiondef(to_regprocedure('public._bot_gate_ok()'))
                 LIKE '%bot_gateway_secret_next%' THEN '✅ جاهزة' ELSE '⚠️ أُحاديّة' END;
