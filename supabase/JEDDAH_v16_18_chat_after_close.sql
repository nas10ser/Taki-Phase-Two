-- ═══════════════════════════════════════════════════════════════════════════
-- v16.18 — محادثةُ الطلب تبقى مفتوحةً بعد إغلاقه، بنافذةٍ مضبوطة
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 **بلاغُ ناصر (١٣ نوفمبر ٢٠٢٦)، وهو تناقضٌ مقيس:**
--    «في قسم الأسئلة، عندما يريد المشتري يتواصل مع التاجر للاسترداد كتبتَ أن
--     الطريقة عبر الشات — علماً أن الشات يغلق بعد الاستلام. فكيف يتواصل معه؟»
--
--    والتحقّق من نصّ الدالّة الحيّة:
--        IF booking_row.status IN ('cancelled','completed','expired') THEN
--            RAISE EXCEPTION 'انتهى هذا الطلب — المحادثة للقراءة فقط';
--    أي أن المحادثة تُقفل **في اللحظة نفسِها** التي يكتشف فيها المشتري عيباً
--    في بضاعته. و`src/pages/legal/FAQ.tsx` يقول في موضعين «تواصل مع التاجر
--    عبر شات الحجز» — **وعدٌ في نصٍّ قانونيٍّ لا ينفّذه الكود**، وهو أخطرُ
--    أنواع العيوب عندنا (قاعدة CLAUDE.md: وثيقةٌ تَعِد بما لا يُنفَّذ).
--
-- ── لماذا هذا الحلُّ لا «شاتٌ عامّ مع أيّ تاجر» ───────────────────────────
-- بحثٌ في المنصّات العالميّة (١٣ نوفمبر ٢٠٢٦):
--   · **أمازون**: المراسلةُ مربوطةٌ بالطلب، ومفتوحةٌ **٣٠ يوماً بعده**،
--     ولأغراض الطلب والإرجاع وحدها.
--   · **نون** (أقربُ مثالٍ خليجيّ): أضيقُ من ذلك — التاجرُ لا يراسل إلّا
--     عميلاً **قدّم طلبَ إرجاع**.
--   · **Etsy**: المراسلةُ داخل المنصّة، والاسترداد مدعومٌ ١٨٠ يوماً.
--   · والشاتُ المفتوح (نمط Mercari) يوجد — لكنّه يستلزم فريقَ أمانٍ يرصد
--     الاحتيالَ وتسريبَ الصفقات خارج المنصّة، ويفتح سطحَ إزعاجٍ لكلّ تاجر.
-- ⇒ والأرخصُ على خادمنا بفارقٍ كبير: **صفرُ جدولٍ جديد · صفرُ قناةِ ريل‑تايم
--   جديدة · صفرُ سياسةِ RLS جديدة.** نفسُ المحادثة، وشرطٌ زمنيٌّ واحدٌ يتبدّل.
--
-- 🪤 والمدّةُ **لا تُكتب في نصٍّ أبداً**: مفتاحٌ في `platform_settings` يضبطه
--    ناصر، وكلُّ نصٍّ ظاهرٍ يقرؤه حيّاً (قاعدةُ «لا تُكتب مدّةٌ برقم»).
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
       LIKE 'TAKI_LAB_TOKYO_MARKER%' THEN
    RAISE EXCEPTION 'هذه هجرةُ إنتاج — ورُفضت لأنها تُنفَّذ على المختبر (طوكيو).';
  END IF;
END
$guard$;

-- ── ① المفتاح، في المواضع الثلاثة التي تلزمه ─────────────────────────────
-- (أ) الصفّ نفسُه
INSERT INTO public.platform_settings (key, value, description)
VALUES ('chat_after_close_hours', '72'::jsonb,
        'كم ساعةً تبقى محادثةُ الطلب مفتوحةً بعد إغلاقه (تسليم/إلغاء/انتهاء). 0 = تُقفل فوراً.')
ON CONFLICT (key) DO NOTHING;

-- (ب) 🔴 قائمةُ السماح في RLS — **تُعاد بناؤها من نصّها الحيّ** بإضافة عنصرٍ
--     واحد، لا من نسخةٍ مكتوبةٍ هنا. (درسُ v14.92: نسخةٌ مكتوبةٌ تحذف مفاتيحَ
--     لا نعلم بها؛ ومفتاحٌ خارج القائمة يعود `SELECT` عنه **بصفر صفٍّ لا
--     بخطأ** ⇒ ترتدّ الواجهةُ إلى الافتراضي وتبدو سليمةً تماماً.)
--     وتُنسخ الأدوارُ حرفياً (`public`) — وإلّا حُجبت الإعداداتُ عن الزوّار.
DO $policy$
DECLARE
    v_qual  text;
    v_roles text;
BEGIN
    SELECT qual, roles::text INTO v_qual, v_roles
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'platform_settings'
       AND policyname = 'platform_settings_select';
    IF v_qual IS NULL THEN
        RAISE EXCEPTION 'لم أجد سياسةَ القراءة platform_settings_select';
    END IF;

    IF position('''chat_after_close_hours''' in v_qual) > 0 THEN
        RAISE NOTICE 'المفتاحُ في قائمة السماح أصلاً — لا تعديل.';
        RETURN;
    END IF;

    -- الإضافةُ داخل نفس المصفوفة، بعد أوّل عنصرٍ منها تماماً.
    v_qual := regexp_replace(v_qual, '(key = ANY \(ARRAY\[)',
                             '\1''chat_after_close_hours''::text, ');
    IF position('''chat_after_close_hours''' in v_qual) = 0 THEN
        RAISE EXCEPTION 'تعذّر حقنُ المفتاح في نصّ السياسة — لم أُعدّل شيئاً';
    END IF;

    EXECUTE 'DROP POLICY IF EXISTS platform_settings_select ON public.platform_settings';
    EXECUTE format('CREATE POLICY platform_settings_select ON public.platform_settings '
                   'FOR SELECT TO %s USING (%s)',
                   trim(both '{}' from v_roles), v_qual);
END
$policy$;

-- ── ② قارئُ الإعداد: مكانٌ واحدٌ يُسأل، لا رقمٌ مكرّر ────────────────────
CREATE OR REPLACE FUNCTION public.taki_chat_after_close_hours()
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
    SELECT GREATEST(0, LEAST(8760, COALESCE(
        (SELECT NULLIF(value #>> '{}', '')::numeric
           FROM public.platform_settings WHERE key = 'chat_after_close_hours'), 72)));
$fn$;
REVOKE ALL ON FUNCTION public.taki_chat_after_close_hours() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.taki_chat_after_close_hours() TO anon, authenticated, service_role;

-- ── ③ القاعدةُ **مرّةً واحدة**، ويناديها الموضعان ────────────────────────
-- 🔴 **وهذا ما كشفه الإثباتُ السلوكيّ، ولولاه لشُحن إصلاحٌ لا يعمل:**
--    رقّعتُ أوّلاً `send_booking_message` وحدها، فرُفضت الرسالةُ **داخل
--    النافذة**. والسبب أن القاعدة مكتوبةٌ في **موضعين**: الدالّة ومشغّلٌ على
--    الجدول (`tr_guard_message_block`) — وهو الذي يحرس البوتين أيضاً لأنهما
--    لا يمرّان بدالّة الويب. وتعليقُ المشغّل نفسُه يقول إن النصَّ «منسوخٌ
--    حرفياً» من الدالّة، وهو بالضبط ما ينحرف عند أوّل تعديل.
-- ⇒ فلا يُرقَّع الموضعان، بل تخرج القاعدةُ إلى **دالّةٍ واحدةٍ** يناديها
--   كلاهما. فلا نسخةَ ثانيةٌ تنحرف بعد اليوم.
CREATE OR REPLACE FUNCTION public.taki_chat_window_open(
    p_status       text,
    p_completed_at timestamptz,
    p_expiry_ms    bigint
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
    SELECT CASE
        -- طلبٌ قائم: المحادثةُ مفتوحةٌ دائماً.
        WHEN COALESCE(p_status, '') NOT IN ('cancelled', 'completed', 'expired') THEN true
        -- صفرٌ يعني «تُقفل لحظةَ الإغلاق» — وهو السلوكُ القديم بالضبط.
        WHEN public.taki_chat_after_close_hours() <= 0 THEN false
        -- 🪤 وبلا لحظةِ إغلاقٍ معروفةٍ **تُقفل**: الافتراضُ الآمنُ هو الأضيق،
        --    وإلّا بقيت محادثةُ صفٍّ ناقصِ البيانات مفتوحةً أبداً.
        ELSE COALESCE(p_completed_at,
                      to_timestamp(p_expiry_ms / 1000.0),
                      now() - interval '100 years')
             >= now() - make_interval(secs => public.taki_chat_after_close_hours() * 3600)
    END;
$fn$;
REVOKE ALL ON FUNCTION public.taki_chat_window_open(text, timestamptz, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.taki_chat_window_open(text, timestamptz, bigint)
    TO anon, authenticated, service_role;

-- 🪤 ولا تُعاد كتابةُ الدالّتين كلتيهما: يُستبدل **الشرطُ وحده** في نصّهما
--    الحيّ، فلا يضيع ما أُضيف إليهما (المرفقات · الحجب · حدودُ الإغراق).
DO $patch$
DECLARE
    v_src  text;
    v_new  text;
    v_old  text;
    v_fn   text;
    v_hit  int := 0;
BEGIN
    FOREACH v_fn IN ARRAY ARRAY['send_booking_message', 'tr_guard_message_block'] LOOP
        SELECT pg_get_functiondef(p.oid) INTO v_src
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = v_fn;
        IF v_src IS NULL THEN RAISE EXCEPTION 'لم أجد %', v_fn; END IF;

        IF position('taki_chat_window_open' in v_src) > 0 THEN
            RAISE NOTICE '% مرقَّعةٌ أصلاً — لا تعديل.', v_fn;
            v_hit := v_hit + 1;
            CONTINUE;
        END IF;

        -- صيغةُ الشرط تختلف بين الاثنتين (مسافاتٌ واسمُ المتغيّر)، فيُلتقط بنمط.
        SELECT m[1] INTO v_old FROM regexp_matches(
            v_src,
            '(IF\s+\w+\.status\s+IN\s*\(\s*''cancelled''\s*,\s*''completed''\s*,\s*''expired''\s*\)\s+THEN)',
            'g') AS m LIMIT 1;
        IF v_old IS NULL THEN
            RAISE EXCEPTION 'لم أجد شرطَ الإغلاق في % — لم أُعدّل شيئاً', v_fn;
        END IF;

        v_new := replace(v_src, v_old,
            'IF NOT public.taki_chat_window_open('
            || (CASE WHEN v_fn = 'send_booking_message' THEN 'booking_row' ELSE 'v_b' END)
            || '.status, '
            || (CASE WHEN v_fn = 'send_booking_message' THEN 'booking_row' ELSE 'v_b' END)
            || '.completed_at, '
            || (CASE WHEN v_fn = 'send_booking_message' THEN 'booking_row' ELSE 'v_b' END)
            || '.expiry_time) THEN');

        IF v_new = v_src THEN
            RAISE EXCEPTION 'الاستبدالُ لم يقع في % — لم أُعدّل شيئاً', v_fn;
        END IF;
        EXECUTE v_new;
        v_hit := v_hit + 1;
    END LOOP;

    IF v_hit <> 2 THEN
        RAISE EXCEPTION 'رُقّع % موضعاً من ٢ — والقاعدةُ في موضعين', v_hit;
    END IF;
END
$patch$;

-- ── ④ التحقّق: كتلٌ ترفع استثناءً ────────────────────────────────────────
DO $verify$
DECLARE
    v_src   text;
    v_hours numeric;
    v_cnt   int;
BEGIN
    -- (أ) القارئُ يعمل ويحترم المدى
    v_hours := public.taki_chat_after_close_hours();
    IF v_hours IS NULL OR v_hours < 0 OR v_hours > 8760 THEN
        RAISE EXCEPTION 'قارئُ المهلة أعاد قيمةً خارج المدى: %', v_hours;
    END IF;

    -- (ب) 🔴 المفتاحُ **مقروءٌ فعلاً تحت سياسة القراءة** — لا مجرّدُ وجوده
    --     في الجدول. هذا هو عينُ ما سقط في v14.92: صفٌّ موجودٌ وسياسةٌ لا
    --     تراه ⇒ صفرُ صفٍّ بلا خطأ. ويُقاس بدور `anon` لا بدور المالك.
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_cnt FROM public.platform_settings WHERE key = 'chat_after_close_hours';
    RESET ROLE;
    IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'الزائرُ لا يرى مفتاحَ مهلة المحادثة (% صفّاً) — الإعدادُ لن يعمل وسيصمت', v_cnt;
    END IF;

    -- (ج) وبقيّةُ المفاتيح لم تسقط من القائمة أثناء إعادة البناء
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_cnt FROM public.platform_settings
     WHERE key IN ('booking_holds','chat_limits','refund_window','tax_settings','contact_emails');
    RESET ROLE;
    IF v_cnt < 4 THEN
        RAISE EXCEPTION 'سقطت مفاتيحُ من قائمة السماح بعد إعادة البناء (بقي % من ٥)', v_cnt;
    END IF;

    -- (د‑٠) 🔴 **جدولُ حقيقةِ القاعدة نفسِها.**
    --     كُشف بكسرةٍ: جعلتُ فرعَ «الطلبُ القائم» يسقط، فمرّ الاختبارُ
    --     السلوكيُّ أخضر — لأنه يجرّب **طلباً مكتملاً** في الحالتين ولا يمسّ
    --     المسارَ العاديّ إطلاقاً. والمسارُ العاديُّ هو كلُّ طلباتِ المنصّة.
    IF NOT public.taki_chat_window_open('pending', NULL,
            (extract(epoch from now() - interval '400 hours') * 1000)::bigint) THEN
        RAISE EXCEPTION 'طلبٌ قائمٌ أُقفلت محادثتُه — وهذا مسارُ كلّ الطلبات الحيّة';
    END IF;
    IF NOT public.taki_chat_window_open('acknowledged', NULL, NULL) THEN
        RAISE EXCEPTION 'طلبٌ مؤكَّدٌ أُقفلت محادثتُه';
    END IF;
    IF NOT public.taki_chat_window_open('completed', now() - interval '1 hour', NULL) THEN
        RAISE EXCEPTION 'طلبٌ أُغلق قبل ساعةٍ ومحادثتُه مقفلةٌ — النافذةُ لا تعمل';
    END IF;
    IF public.taki_chat_window_open('completed', now() - interval '400 hours', NULL) THEN
        RAISE EXCEPTION 'محادثةٌ بقيت مفتوحةً بعد انتهاء النافذة';
    END IF;
    IF public.taki_chat_window_open('cancelled', NULL, NULL) THEN
        RAISE EXCEPTION 'صفٌّ بلا لحظةِ إغلاقٍ يجب أن يُقفل — الافتراضُ هو الأضيق';
    END IF;

    -- (د) 🔴 **الموضعان معاً** يناديان القاعدةَ الواحدة — ولا نسخةَ ثانية.
    FOR v_src IN SELECT pg_get_functiondef(p.oid)
                   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public'
                    AND p.proname IN ('send_booking_message', 'tr_guard_message_block') LOOP
        IF position('taki_chat_window_open' in v_src) = 0 THEN
            RAISE EXCEPTION 'موضعٌ بلا القاعدة الواحدة — المحادثةُ ما زالت تُقفل لحظةَ الإغلاق';
        END IF;
        -- 🪤 والشرطُ القديمُ لم يبقَ مزدوجاً: نسخةٌ باقيةٌ تُبطل الإصلاحَ بصمت.
        IF v_src ~ 'IF\s+\w+\.status\s+IN\s*\(\s*''cancelled''' THEN
            RAISE EXCEPTION 'بقي الشرطُ القديمُ إلى جانب الجديد — أحدُهما سيمنع';
        END IF;
    END LOOP;
    -- وما بقي من حرّاس المحادثة لم يضع أثناء الترقيع
    SELECT pg_get_functiondef(p.oid) INTO v_src
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'send_booking_message' AND p.prokind = 'f';
    IF position('taki_chat_limits' in v_src) = 0 OR position('attachment' in v_src) = 0 THEN
        RAISE EXCEPTION 'حرّاسُ الإغراق أو المرفقات سقطت أثناء الترقيع';
    END IF;

    RAISE NOTICE '✅ مهلةُ المحادثة بعد الإغلاق: % ساعة · المفتاحُ مقروءٌ للزائر · البوّابةُ حيّة.', v_hours;
END
$verify$;

-- ── ⑤ الإثباتُ السلوكيُّ: تُقبل داخل النافذة وتُرفض بعدها ────────────────
-- 🪤 والكتلةُ **تُلغي كتابتَها بنفسها**: تنتهي برفع استثناءٍ بعلامةٍ متّفقٍ
--    عليها، فتُلغى المعاملةُ الفرعيّة (الرسالةُ المُدرَجة وتعديلُ الطلب)
--    وتبقى الهجرةُ كلُّها قائمة. فلا تُترك بياناتُ اختبارٍ في الإنتاج.
-- 🔴 ولماذا سلوكيّ أصلاً: الفحصُ النصّيُّ يُثبت أن الاسمَ مكتوبٌ في الجسم،
--    ولا يُثبت أن الشرطَ **يسمح** ولا أنه **يمنع**. وقد مرّ عندنا فحصٌ نصّيٌّ
--    على جسمٍ مُفرَّغ أكثرَ من مرّة.
DO $behave$
DECLARE
    v_bar  text;
    v_uid  text;
    v_mid  text;
    v_ok   boolean;
BEGIN
    SELECT b.barcode, b.user_id INTO v_bar, v_uid
      FROM public.bookings b
     WHERE b.status = 'completed' AND b.completed_at IS NOT NULL
     ORDER BY b.completed_at DESC LIMIT 1;
    IF v_bar IS NULL THEN
        RAISE EXCEPTION 'لا طلبَ مكتملاً على القاعدة — لا يمكن إثباتُ النافذة سلوكياً';
    END IF;

    BEGIN
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

        -- ① أُغلق قبل ساعةٍ (داخل النافذة) ⇒ تُقبل
        UPDATE public.bookings SET completed_at = now() - interval '1 hour' WHERE barcode = v_bar;
        SELECT (public.send_booking_message(v_bar, 'فحصُ نافذةِ المحادثة — يُلغى')).id INTO v_mid;
        IF v_mid IS NULL THEN
            RAISE EXCEPTION 'رُفضت الرسالةُ داخل النافذة — وهي المقصودةُ بالإصلاح';
        END IF;

        -- ② أُغلق قبل ٤٠٠ ساعة (خارج النافذة) ⇒ تُرفض، وبالسبب المقصود
        UPDATE public.bookings SET completed_at = now() - interval '400 hours' WHERE barcode = v_bar;
        v_ok := false;
        BEGIN
            PERFORM public.send_booking_message(v_bar, 'يجب أن تُرفض');
        EXCEPTION WHEN OTHERS THEN
            IF SQLERRM LIKE '%للقراءة فقط%' THEN v_ok := true; ELSE RAISE; END IF;
        END;
        IF NOT v_ok THEN
            RAISE EXCEPTION 'قُبلت رسالةٌ بعد انتهاء النافذة — البوّابةُ لا تمنع';
        END IF;

        RAISE EXCEPTION 'TAKI_PROBE_ROLLBACK';
    EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('request.jwt.claims', '', true);
        IF SQLERRM <> 'TAKI_PROBE_ROLLBACK' THEN RAISE; END IF;
    END;

    RAISE NOTICE '✅ سلوكياً: تُقبل داخل النافذة · تُرفض بعدها · ولا أثرَ للفحص.';
END
$behave$;
