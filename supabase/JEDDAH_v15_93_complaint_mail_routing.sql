-- ═══════════════════════════════════════════════════════════════════════════
-- TAKI · JEDDAH_v15_93_complaint_mail_routing.sql
--
-- أمرُ ناصر (١١ نوفمبر ٢٠٢٦): **تُفرز الشكوى إلى صندوقٍ بحسب نوعها.**
--    • مشكلةٌ في التطبيق · مشكلةٌ مع متجر · دفع/سعر  ⇐ `contact_emails.complain`
--    • اقتراح/تحسين · أخرى                          ⇐ `contact_emails.info`
--
-- 🔴 ولماذا **لا** يمرّ هذا عبر `email_outbox`: مُفرِّغُ الطابور يعيش في
--    `server/bot.js` على Render — خدمةٌ قد تكون مطفأةً أو نائمة (قِيس: آخرُ
--    إرسالٍ ٣٠ أكتوبر، وقناتا البوت مطفأتان بقرار ناصر ٨ نوفمبر). فشكوى
--    تُوضع في طابورٍ لا يُفرَّغ = شكوى لا تصل أحداً، **بصمت**. والقاعدةُ تصل
--    الإنترنت بـ`pg_net`، فالطريقُ المباشر إلى Resend أقصرُ وأقلُّ أجزاءً.
--
-- 🪤 و«أُرسلت» ليست «وصلت»: `net.http_post` **لا متزامنة** — تُعيد رقمَ طلبٍ
--    ويصل الردُّ لاحقاً إلى `net._http_response`. ولذلك يُحفَظ رقمُ الطلب في
--    `complaint_mail` فيصير السؤال «هل وصلت الشكوى إلى صندوقها؟» **مقروءاً
--    من القاعدة** لا مُفترَضاً. (نفسُ درس `phone_login_health` في v15.88:
--    مفصلٌ لا يُقاس = مفصلٌ يُظنّ أنه يعمل.)
--
-- 🪤 ولا `EXCEPTION WHEN OTHERS THEN NULL`: ذاك يحوّل العيبَ إلى لا شيء (درس
--    v14.78). الإخفاقُ **يُكتب في صفٍّ** ولا يُسقط الشكوى نفسَها — فالشكوى
--    تصل لوحةَ الإدارة في كلّ الأحوال، والبريدُ قناةٌ ثانية لا وحيدة.
--
-- 🔇 ولا يُطبع مفتاحُ Resend في أيّ مخرَج: يُقرأ في متغيّرٍ من الخزنة.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
BEGIN
    IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
        RAISE EXCEPTION 'STOP: هذه هجرةُ إنتاج (جدة) ونحن على مختبر طوكيو.';
    END IF;
END
$guard$;

-- ── سجلُّ الإرسال: لكلّ شكوى صفٌّ يقول إلى أين ذهبت وبأيّ رقم طلب ─────────
CREATE TABLE IF NOT EXISTS public.complaint_mail (
    complaint_id uuid PRIMARY KEY REFERENCES public.complaints(id) ON DELETE CASCADE,
    category     text        NOT NULL,
    mailbox      text        NOT NULL,          -- 'complain' | 'info'
    to_email     text,
    request_id   bigint,                        -- net._http_response.id
    error        text,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- 🪤 جدولٌ عامّ جديد يُولَد بـ`arwdm` لـ`authenticated` (درس v15.81) — فلا
--    يكفي سحبُ PUBLIC و`anon`. وهذا سجلٌّ تشغيليّ: لا يقرؤه متصفّحٌ إطلاقاً.
ALTER TABLE public.complaint_mail ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.complaint_mail FROM PUBLIC;
REVOKE ALL ON TABLE public.complaint_mail FROM anon;
REVOKE ALL ON TABLE public.complaint_mail FROM authenticated;
GRANT ALL ON TABLE public.complaint_mail TO service_role;

-- ── الموجّه ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.taki_complaint_mail()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
    v_box     text;
    v_to      text;
    v_key     text;
    v_from    text;
    v_subj    text;
    v_html    text;
    v_who     text;
    v_label   text;
    v_req     bigint;
    v_err     text;
BEGIN
    -- ① الصندوق بحسب النوع. 🪤 قائمةُ سماحٍ صريحة لا `CASE ELSE complain`:
    --    نوعٌ جديد يُضاف للتطبيق ولا يُضاف هنا يجب أن **يَظهر** لا أن يُفرَز
    --    بالتخمين إلى صندوق الشكاوى.
    v_box := CASE NEW.category
        WHEN 'app_issue'   THEN 'complain'
        WHEN 'store_issue' THEN 'complain'
        WHEN 'payment'     THEN 'complain'
        WHEN 'suggestion'  THEN 'info'
        WHEN 'other'       THEN 'info'
        ELSE NULL
    END;
    v_label := CASE NEW.category
        WHEN 'app_issue'   THEN 'مشكلة في التطبيق'
        WHEN 'store_issue' THEN 'مشكلة مع متجر'
        WHEN 'payment'     THEN 'دفع / سعر'
        WHEN 'suggestion'  THEN 'اقتراح / تحسين'
        WHEN 'other'       THEN 'أخرى'
        ELSE COALESCE(NEW.category, '—')
    END;

    IF v_box IS NULL THEN
        INSERT INTO public.complaint_mail (complaint_id, category, mailbox, error)
        VALUES (NEW.id, COALESCE(NEW.category,'?'), '—',
                'نوعٌ غيرُ معروفٍ للموجّه — أضِفه إلى taki_complaint_mail')
        ON CONFLICT (complaint_id) DO NOTHING;
        RETURN NEW;
    END IF;

    SELECT NULLIF(btrim(value ->> v_box), '') INTO v_to
      FROM public.platform_settings WHERE key = 'contact_emails';

    SELECT decrypted_secret INTO v_key
      FROM vault.decrypted_secrets WHERE name = 'app_secret:resend_api_key';

    IF v_to IS NULL THEN
        v_err := format('صندوق «%s» غير مضبوط في contact_emails', v_box);
    ELSIF v_key IS NULL OR length(v_key) < 20 THEN
        v_err := 'مفتاح Resend غير موجودٍ في الخزنة';
    END IF;

    IF v_err IS NOT NULL THEN
        INSERT INTO public.complaint_mail (complaint_id, category, mailbox, to_email, error)
        VALUES (NEW.id, NEW.category, v_box, v_to, v_err)
        ON CONFLICT (complaint_id) DO NOTHING;
        RETURN NEW;
    END IF;

    SELECT COALESCE(NULLIF(u.name,''), NULLIF(u.email,''), 'مستخدم')
      INTO v_who FROM public.users u WHERE u.id = NEW.user_id;

    v_subj := format('[%s] %s', v_label,
                     COALESCE(NULLIF(btrim(NEW.subject), ''), left(COALESCE(NEW.message,''), 60)));
    v_from := 'TAKI <no-reply@takisa.net>';

    v_html :=
        '<div dir="rtl" style="font-family:system-ui,-apple-system,Segoe UI,Tahoma,sans-serif;line-height:1.9">'
     || '<h2 style="margin:0 0 10px">📣 ' || v_label || '</h2>'
     || '<p style="margin:0 0 4px"><b>من:</b> ' || COALESCE(v_who,'مستخدم')
     || ' · <b>الدور:</b> ' || COALESCE(NEW.user_role,'—') || '</p>'
     || '<p style="margin:0 0 4px"><b>العنوان:</b> '
     || COALESCE(NULLIF(btrim(NEW.subject),''), '—') || '</p>'
     || '<hr style="border:none;border-top:1px solid #ddd;margin:12px 0">'
     || '<p style="white-space:pre-wrap;margin:0">'
     || replace(replace(replace(COALESCE(NEW.message,''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
     || '</p>'
     || CASE WHEN COALESCE(array_length(NEW.attachments, 1), 0) > 0
             THEN '<p style="margin:12px 0 0"><b>مرفقات:</b> '
                  || array_length(NEW.attachments, 1)
                  || ' — تُفتح من لوحة الإدارة</p>'
             ELSE '' END
     || '<p style="margin:16px 0 0"><a href="https://www.takisa.net/admin?tab=reports">فتح الشكوى في لوحة الإدارة</a></p>'
     || '</div>';

    BEGIN
        SELECT net.http_post(
            url     := 'https://api.resend.com/emails',
            headers := jsonb_build_object(
                           'Authorization', 'Bearer ' || v_key,
                           'Content-Type',  'application/json'),
            body    := jsonb_build_object(
                           'from',     v_from,
                           'to',       jsonb_build_array(v_to),
                           'subject',  v_subj,
                           'html',     v_html),
            timeout_milliseconds := 8000
        ) INTO v_req;
    EXCEPTION WHEN others THEN
        v_err := left(SQLERRM, 300);
    END;

    INSERT INTO public.complaint_mail (complaint_id, category, mailbox, to_email, request_id, error)
    VALUES (NEW.id, NEW.category, v_box, v_to, v_req, v_err)
    ON CONFLICT (complaint_id) DO NOTHING;

    RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.taki_complaint_mail() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_complaint_mail() FROM anon;
REVOKE ALL ON FUNCTION public.taki_complaint_mail() FROM authenticated;

-- 🪤 `tr_zz_…` عمداً: المشغّلات تُنفَّذ **بترتيب الاسم أبجدياً**، و`tr_aa_rate_limit`
--    يجب أن يعضّ أوّلاً فلا يُرسل بريدٌ لشكوى يرفضها حدُّ المعدّل.
DROP TRIGGER IF EXISTS tr_zz_complaint_mail ON public.complaints;
CREATE TRIGGER tr_zz_complaint_mail
    AFTER INSERT ON public.complaints
    FOR EACH ROW EXECUTE FUNCTION public.taki_complaint_mail();

DO $verify$
DECLARE v_bad text := '';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.complaints'::regclass
                      AND tgname = 'tr_zz_complaint_mail') THEN
        v_bad := v_bad || ' · المشغّل لم يُنشأ';
    END IF;
    -- ترتيبُ العضّ: حدُّ المعدّل قبل البريد
    IF (SELECT min(tgname) FROM pg_trigger
         WHERE tgrelid='public.complaints'::regclass AND NOT tgisinternal)
       >= 'tr_zz_complaint_mail' THEN
        v_bad := v_bad || ' · البريد يسبق حدَّ المعدّل في الترتيب';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema='public' AND table_name='complaint_mail'
                  AND grantee IN ('anon','authenticated','PUBLIC')) THEN
        v_bad := v_bad || ' · منحٌ باقٍ على complaint_mail لزائرٍ أو موثَّق';
    END IF;
    IF v_bad <> '' THEN RAISE EXCEPTION 'فشل التحقّق:%', v_bad; END IF;
    RAISE NOTICE '✅ جدة · v15.93 · الشكاوى تُفرز إلى صندوقها: شكوى⇐complain · اقتراح/أخرى⇐info';
END
$verify$;

COMMIT;
