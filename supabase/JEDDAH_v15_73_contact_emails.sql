-- ═══════════════════════════════════════════════════════════════════════════
-- v15.73 — عناوينُ التواصل المنشورة (فارغةٌ = لا تُعرض)
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 الثغرةُ التي جاءت لها، مقيسةٌ لا مُفترَضة: **زائرٌ بلا حسابٍ لم يكن
--    يملك طريقةً واحدةً للتواصل مع المنصّة.**
--      • `/complaints` تعرض «سجّل الدخول» لمن لا حساب له.
--      • وكلُّ دوالّ الشكاوى (`my_complaints` · `complaint_thread` ·
--        `complaint_reply` · `complaint_set_attachments`) ممنوحةٌ لـ
--        `authenticated` **وحده**.
--      • وصفحةُ «اتصل بنا» تُحيل إلى زرٍّ **بالاسم ولا تربطه**، ولا تحمل
--        عنوانَ بريدٍ واحداً.
--    أي أن صفحةَ «اتصل بنا» لا تقول كيف تتصل. ومراجعُ متجرِ التطبيقات
--    وجهةٌ رقابيّةٌ كلاهما يبدأ من هناك.
--
-- 🪤 والعنوانُ لا يُنشر حتى يُؤكَّد صندوقُه. حاولتُ الفحصَ بـRCPT TO بلا
--    إرسالٍ (فحصٌ قياسيٌّ لا يُرسل رسالة) من جهاز ناصر ومن خادم جدة فكلاهما
--    **محجوبُ المنفذ ٢٥** (عادةُ مزوّدي السحابة). فلا سبيلَ لي للتحقّق،
--    والنشرُ بلا تحقّقٍ يعني مستخدماً يشكو إلى الفراغ — وهو أسوأُ من غياب
--    العنوان، لأنه يُوهمه أن شكواه وصلت.
--    ⇒ فارغٌ افتراضاً، ويُنشر بـ`scripts/set-contact-emails.js` بعد تأكيده.
--
-- ℓ وسجلّاتُ البريد مقيسة: MX الجذر إلى **زوهو** (فالصناديقُ تُنشأ من لوحته)،
--   و`send.takisa.net` بـSPF أمازون/Resend و DKIM — أي أن الإرسالَ من نطاقٍ
--   فرعيٍّ والاستقبالَ على الجذر، وهما مستقلّان. فإنشاءُ صندوقٍ لا يمسّ
--   الإرسالَ ولا يحتاج سجلَّ SPF ثانياً على الجذر (وذاك ممنوعٌ بأمر ناصر).
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'')
     = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه قاعدةُ المختبر (طوكيو) — الهجرةُ لجدة وحدها.';
  END IF;
END $$;

INSERT INTO public.platform_settings (key, value)
VALUES ('contact_emails', '{"info": "", "complain": ""}'::jsonb)
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE q text; roles text; new_q text;
BEGIN
  SELECT pg_get_expr(pol.polqual, pol.polrelid),
         COALESCE(NULLIF(array_to_string(ARRAY(
           SELECT r.rolname FROM pg_roles r WHERE r.oid = ANY(pol.polroles)), ','), ''), 'public')
    INTO q, roles
    FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
   WHERE c.relname = 'platform_settings' AND pol.polname = 'platform_settings_select';
  IF q IS NULL THEN RAISE EXCEPTION 'سياسةُ قراءة الإعدادات غير موجودة'; END IF;
  IF q LIKE '%''contact_emails''%' THEN
    RAISE NOTICE 'ℓ contact_emails مدرجٌ أصلاً.';
  ELSE
    new_q := regexp_replace(q, '(ARRAY\[)', '\1''contact_emails''::text, ');
    IF new_q = q THEN RAISE EXCEPTION 'لم يُعثر على ARRAY[ في نصّ السياسة'; END IF;
    EXECUTE 'DROP POLICY platform_settings_select ON public.platform_settings';
    EXECUTE format('CREATE POLICY platform_settings_select ON public.platform_settings '
                 || 'FOR SELECT TO %s USING (%s)', roles, new_q);
    RAISE NOTICE '✅ أُدرج contact_emails (الأدوار: %)', roles;
  END IF;
END $$;

-- ── التحقّق: **الزائرُ** يقرؤه فعلاً (لا وجودُ الاسم في النصّ) ───────────
BEGIN;
DO $$
DECLARE v_n integer; v_v jsonb;
BEGIN
  SET LOCAL ROLE anon;
  -- 🪤 ولا `max(jsonb)`: لا تجميعةَ ترتيبٍ لهذا النوع في بوستجرس. يُقرأ الصفّ.
  SELECT count(*) INTO v_n FROM public.platform_settings WHERE key='contact_emails';
  SELECT value INTO v_v FROM public.platform_settings WHERE key='contact_emails';
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'الزائرُ يقرأ % صفّاً (المتوقَّع ١) — سترتدّ الصفحةُ إلى الفراغ بلا خطأ', v_n;
  END IF;
  IF COALESCE(v_v->>'info','') <> '' OR COALESCE(v_v->>'complain','') <> '' THEN
    RAISE EXCEPTION 'عنوانٌ منشورٌ بلا تأكيدِ صندوق: %', v_v;
  END IF;
  RAISE NOTICE '✅ الزائرُ يقرأ المفتاح · وهو فارغٌ (لا عنوانَ منشور)';
END $$;
ROLLBACK;

SELECT 'الخادم' AS "البند", current_setting('server_version') AS "القيمة",
       CASE WHEN COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ المختبر' ELSE '✅ جدة' END AS "الحالة"
UNION ALL SELECT 'contact_emails',
       COALESCE((SELECT value::text FROM public.platform_settings WHERE key='contact_emails'), '(غائب)'),
       CASE WHEN (SELECT value FROM public.platform_settings WHERE key='contact_emails')
                 = '{"info": "", "complain": ""}'::jsonb
            THEN '✅ فارغٌ — بانتظار تأكيدِ الصناديق' ELSE 'ℓ مضبوط' END
UNION ALL SELECT 'في سماح RLS', 'platform_settings_select',
       CASE WHEN (SELECT pg_get_expr(pol.polqual, pol.polrelid) FROM pg_policy pol
                    JOIN pg_class c ON c.oid=pol.polrelid
                   WHERE c.relname='platform_settings'
                     AND pol.polname='platform_settings_select') LIKE '%contact_emails%'
            THEN '✅' ELSE '❌' END;
