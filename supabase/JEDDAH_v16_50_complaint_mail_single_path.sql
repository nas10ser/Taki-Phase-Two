-- ════════════════════════════════════════════════════════════════════════════
-- v16.50 — الشكوى تُرسَل إلى صندوقها **وحده**، لا إلى بريد حساب الأدمن
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 بلاغُ ناصر (١٩ نوفمبر ٢٠٢٦، وهو **تكرارُ أمرٍ سابق**): «الأحمر يكون على
--    complain@takisa.net والأصفر على info@takisa.net وليس على
--    nalaumari@gmail.com — ولكنك لم تنفّذ».
--
-- 🔴 **وهو محقّ، والخطأُ خطئي.** v15.93 بنت التوجيهَ بحسب النوع وشحنته، لكنّها
--    **لم تمسّ المسار القديم**: فصار لكلّ شكوى **رسالتان**:
--      ① `tr_zz_complaint_mail → taki_complaint_mail` ⇒ الصندوقُ الصحيح ✅
--      ② `tr_zz_new_complaint  → handle_new_complaint` ⇒ `taki_queue_email`
--         لكلّ أدمن، وهي تقرأ `users.email` ⇒ **بريدُ ناصر الشخصيّ** ❌
--
--    والقياسُ على الإنتاج يُثبته حرفاً: شكويان اثنتان في ١٧ نوفمبر، ولكلٍّ
--    منهما صفٌّ في `complaint_mail` (إلى `complain@` و`info@`) **وصفٌّ ثانٍ
--    في `email_outbox` إلى `nalaumari@gmail.com` بعنوان «📮 شكوى جديدة على
--    تاكي»** — في نفس الثانية.
--
-- ⇒ يُزال نداءُ البريد من `handle_new_complaint` وحده. و**الجرسُ يبقى**:
--   إشعارُ لوحة الإدارة هو طابورُ عمل ناصر، ولم يشتكِ منه.
--
-- 🪤 وتُعاد بناءُ الدالّة **من نصّها الحيّ** باقتطاعٍ واحدٍ مُثبَت — لا من
--    نسخةٍ مكتوبةٍ هنا: `handle_new_complaint` غيرُ موجودةٍ في أيّ ملفّ هجرةٍ
--    حديث، فكتابتُها من الذاكرة كانت ستُسقط ما لا أعلمه.
-- ════════════════════════════════════════════════════════════════════════════

-- ── ⓪ حارسُ الخادم: لا تُنفَّذ على المختبر (طوكيو) ─────────────────────────
DO $guard$
BEGIN
    IF obj_description('public'::regnamespace, 'pg_namespace')
       = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
        RAISE EXCEPTION 'هذه هجرةُ إنتاج — الخادمُ أمامها هو المختبر (طوكيو). أوقِف.';
    END IF;
END $guard$;

-- ── ① الاقتطاعُ من النصّ الحيّ، مُثبتاً ────────────────────────────────────
DO $patch$
DECLARE
    v_src text := pg_get_functiondef('public.handle_new_complaint'::regproc);
    v_new text;
BEGIN
    IF position('taki_queue_email' in v_src) = 0 THEN
        RAISE NOTICE 'ℹ️ لا نداءَ بريدٍ في `handle_new_complaint` — مطبَّقةٌ من قبل.';
        RETURN;
    END IF;

    -- كتلةُ `BEGIN … PERFORM taki_queue_email … EXCEPTION … END;` مع تعليقها
    v_new := regexp_replace(v_src,
        '[ \t]*--[^\n]*\n[ \t]*BEGIN\s+PERFORM public\.taki_queue_email.*?EXCEPTION WHEN others THEN NULL;[^\n]*\n[ \t]*END;',
        '    -- 🔴 v16.50 (أمرُ ناصر): لا بريدَ إلى حساب الأدمن الشخصيّ. الشكوى'
     || E'\n    --    تذهب إلى صندوقها بحسب النوع في `taki_complaint_mail`'
     || E'\n    --    (complain@ للمشاكل · info@ للاقتراحات)، والجرسُ هنا يبقى.',
        'g');

    IF v_new = v_src THEN
        RAISE EXCEPTION 'الاقتطاعُ لم يقع — هجرةٌ بلا أثر. (تغيّر شكلُ الكتلة؟)';
    END IF;
    IF position('taki_queue_email' in v_new) > 0 THEN
        RAISE EXCEPTION 'بقي نداءُ بريدٍ في النصّ الجديد — الاقتطاعُ ناقص.';
    END IF;
    IF position('INSERT INTO public.notifications' in v_new) = 0 THEN
        RAISE EXCEPTION 'سقط إشعارُ الجرس مع الاقتطاع — وهو طابورُ عمل الأدمن.';
    END IF;

    EXECUTE v_new;
END $patch$;

-- ── ② التحقّقُ البنيويّ ────────────────────────────────────────────────────
DO $verify$
DECLARE
    v_h text := pg_get_functiondef('public.handle_new_complaint'::regproc);
    v_m text := pg_get_functiondef('public.taki_complaint_mail'::regproc);
    v_box text;
BEGIN
    IF position('taki_queue_email' in v_h) > 0 THEN
        RAISE EXCEPTION 'ما زال يُرسل بريداً إلى حساب الأدمن.';
    END IF;
    IF position('INSERT INTO public.notifications' in v_h) = 0 THEN
        RAISE EXCEPTION 'الجرسُ غائب — الأدمنُ لن يعرف بالشكوى إطلاقاً.';
    END IF;

    -- 🔴 والتوجيهُ بحسب النوع كما أمر ناصر، نوعاً نوعاً
    FOR v_box IN SELECT unnest(ARRAY['app_issue','store_issue','payment']) LOOP
        IF position(format('WHEN ''%s''', v_box) in v_m) = 0 THEN
            RAISE EXCEPTION 'النوعُ % غائبٌ عن التوجيه', v_box;
        END IF;
    END LOOP;
    IF (SELECT count(*) FROM regexp_matches(v_m, 'THEN ''complain''', 'g')) <> 3
       OR (SELECT count(*) FROM regexp_matches(v_m, 'THEN ''info''', 'g')) <> 2 THEN
        RAISE EXCEPTION 'توزيعُ الصناديق انحرف: المتوقَّع ٣ ⇐ complain و٢ ⇐ info';
    END IF;

    IF (SELECT NULLIF(btrim(value->>'complain'),'') FROM public.platform_settings
         WHERE key='contact_emails') IS NULL
       OR (SELECT NULLIF(btrim(value->>'info'),'') FROM public.platform_settings
            WHERE key='contact_emails') IS NULL THEN
        RAISE EXCEPTION 'أحدُ العنوانين غيرُ مضبوط — إزالةُ بريد الأدمن كانت ستقطع التسليم.';
    END IF;

    RAISE NOTICE '✅ v16.50: مسارُ بريدٍ واحد — الصندوقُ بحسب النوع، والجرسُ باقٍ.';
END $verify$;
