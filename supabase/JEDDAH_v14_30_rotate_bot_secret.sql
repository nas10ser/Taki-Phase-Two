-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.30 — تدوير سرّ بوّابة البوت بلا انقطاع
-- ════════════════════════════════════════════════════════════════════════════
-- السبب: السرّ ظهر في مخرجات فحصٍ يوم ١٤ سبتمبر ٢٠٢٦ فصار مكتوباً في سجلّ
-- جلسةٍ على جهاز ناصر. ليس في المستودع ولا في تاريخ Git، لكن التدوير هو الصواب.
--
-- 🪤 لماذا لا يُستبدل مباشرةً: السرّ يعيش في مكانين — هذه القاعدة، وبيئة خدمة
-- البوت على Render. وتغييرُ أحدهما وحده **يُسقط البوتين فوراً** حتى يُحدَّث
-- الآخر. ولا أملك وصولاً برمجياً إلى Render.
--
-- الحل: نافذة تدوير. سرّان صالحان معاً:
--   `bot_gateway_secret`      — القديم، يبقى يعمل حتى يُحدَّث Render
--   `bot_gateway_secret_next` — الجديد، يعمل من الآن
-- فيُحدّث ناصر Render في أي وقت بلا عجلة، ثم نُرقّي الجديد ونحذف القديم في
-- هجرة v14.31. لا ثانية انقطاع.
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

-- ── ١. توليد السرّ الجديد على الخادم نفسه ───────────────────────────────────
-- يُولَّد هنا لا في جلسة Claude: فلا يمرّ في أي سجلّ محادثة، ولا يُكتب في أي
-- ملف في المستودع العام. ٦٤ محرفاً ست عشرياً = ٢٥٦ بت من عشوائية القاعدة.
INSERT INTO public.app_secrets (key, value)
VALUES ('bot_gateway_secret_next', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (key) DO NOTHING;   -- إن وُجد فالتدوير جارٍ أصلاً: لا نُبدّله تحت أقدام Render

-- ── ٢. البوّابة تقبل الاثنين خلال النافذة ───────────────────────────────────
CREATE OR REPLACE FUNCTION public._bot_gate_ok()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    COALESCE((SELECT value FROM public.app_secrets WHERE key = 'bot_gate_enforced'), '0') <> '1'
    -- لا ترويسات = نداءٌ من داخل القاعدة (مشغّل/كرون/خدمي) لا من متصفّح.
    -- PostgREST يضع الترويسات دائماً، فهذا الفرع غير قابل للوصول من الشبكة.
    OR current_setting('request.headers', true) IS NULL
    OR current_setting('request.headers', true) = ''
    OR EXISTS (
      SELECT 1 FROM public.app_secrets
      WHERE key IN ('bot_gateway_secret', 'bot_gateway_secret_next')
        AND value IS NOT NULL AND value <> ''
        AND value = (current_setting('request.headers', true)::json ->> 'x-bot-secret')
    );
$$;

-- ── ٣. أي السرّين يستعمله البوت فعلاً؟ ──────────────────────────────────────
-- بلا هذا لا أستطيع أن أعرف متى صار آمناً حذفُ القديم، فأبقى أخمّن. البوت
-- يناديها عند كل إقلاع، فتُسجّل الإجابة في القاعدة وأقرؤها أنا.
CREATE TABLE IF NOT EXISTS public.bot_gate_usage (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  which       text NOT NULL,
  seen_at     timestamptz NOT NULL DEFAULT now(),
  bot_version text
);
ALTER TABLE public.bot_gate_usage ENABLE ROW LEVEL SECURITY;
-- لا سياسات: لا أحد يقرؤه من الشبكة. تُكتب بدالة DEFINER وتُقرأ عبر SSH وحده.

CREATE OR REPLACE FUNCTION public.bot_report_gate(p_version text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_hdr text; v_which text;
BEGIN
  IF NOT public._bot_gate_ok() THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authorized');
  END IF;
  v_hdr := current_setting('request.headers', true)::json ->> 'x-bot-secret';
  SELECT CASE key WHEN 'bot_gateway_secret_next' THEN 'next' ELSE 'current' END
    INTO v_which
  FROM public.app_secrets
  WHERE key IN ('bot_gateway_secret', 'bot_gateway_secret_next') AND value = v_hdr
  LIMIT 1;

  INSERT INTO public.bot_gate_usage (id, which, seen_at, bot_version)
  VALUES (1, COALESCE(v_which, 'unknown'), now(), p_version)
  ON CONFLICT (id) DO UPDATE
    SET which = EXCLUDED.which, seen_at = EXCLUDED.seen_at, bot_version = EXCLUDED.bot_version;

  RETURN jsonb_build_object('success', true, 'using', COALESCE(v_which, 'unknown'));
END $$;

-- 🪤 دوال `bot_*` يبقى `anon` قادراً على تنفيذها عمداً — الحارس هو السرّ في
-- الترويسة لا دور القاعدة (درس v12.12). إلغاؤه يُسقط البوتين.
GRANT EXECUTE ON FUNCTION public.bot_report_gate(text) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق
-- ════════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS الفحص,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ مختبر طوكيو'
            ELSE '✅ جدة (الإنتاج)' END AS النتيجة
UNION ALL
SELECT 'السرّ الجديد وُلّد',
       CASE WHEN (SELECT length(value) FROM app_secrets WHERE key='bot_gateway_secret_next') = 64
            THEN '✅ ٦٤ محرفاً' ELSE '❌ مفقود أو قصير' END
UNION ALL
SELECT 'الجديد يخالف القديم',
       CASE WHEN (SELECT value FROM app_secrets WHERE key='bot_gateway_secret_next')
              <> (SELECT value FROM app_secrets WHERE key='bot_gateway_secret')
            THEN '✅ مختلفان' ELSE '❌ متطابقان!' END
UNION ALL
SELECT 'البوّابة تقبل السرّين',
       CASE WHEN pg_get_functiondef(to_regprocedure('public._bot_gate_ok()'))
                 LIKE '%bot_gateway_secret_next%' THEN '✅ نعم' ELSE '❌ لا' END
UNION ALL
SELECT 'البوّابة ما زالت تحرس',
       CASE WHEN (SELECT value FROM app_secrets WHERE key='bot_gate_enforced') = '1'
            THEN '✅ مفعّلة' ELSE '❌ معطّلة!' END
UNION ALL
SELECT 'دالة الإبلاغ',
       CASE WHEN to_regprocedure('public.bot_report_gate(text)') IS NOT NULL
            THEN '✅ موجودة' ELSE '❌ مفقودة' END
UNION ALL
SELECT 'جدول الاستعمال محميّ',
       CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE oid='public.bot_gate_usage'::regclass)
             AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bot_gate_usage')
            THEN '✅ RLS بلا سياسات ⇒ لا قراءة من الشبكة' ELSE '❌ مكشوف' END;
