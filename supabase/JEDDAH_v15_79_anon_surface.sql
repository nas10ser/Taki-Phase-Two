-- ════════════════════════════════════════════════════════════════════════
-- TAKI · v15.79 — سطحُ الزائرِ المجهول: ما يَفشل مفتوحاً يُقلب مغلقاً
--
-- تُشغَّل على **جدة (الإنتاج)** بالدور `supabase_admin` — لا `postgres`
-- (لا يملك الدوالَّ فيفشل بـ`must be owner of function`).
-- وكلُّ عبارةٍ فيها تحتمل التكرار، وكلُّها تعمل داخل معاملةٍ واحدة
-- (لا `CREATE INDEX CONCURRENTLY` ولا `ALTER TYPE ADD VALUE`).
--
-- ───────────────────────── خلاصةُ القياس ─────────────────────────
-- عشرةُ بنودٍ من تدقيقٍ خصميّ (٨ نوفمبر ٢٠٢٦). **بندان رُدّا** بالقياس
-- ولا يُشحن لهما إصلاحٌ بوصفهما ثغرة:
--
--   ✗ «عنوانُ العميل من اختيار المهاجم» — **مردود**. قِيس على جدة:
--     كلُّ دلاء `rate_limit_counters` تحمل العنوانَ الحقيقيّ
--     (167.86.169.23) وصفرَ دلوٍ يحمل العناوينَ المزوّرة التي أرسلها
--     المدقّق (203.0.113.77 · 198.51.100.1-5). والسببُ: Caddy 2.11.4 بلا
--     `trusted_proxies` **يستبدل** `X-Forwarded-For` بعنوان النظير ولا
--     يُلحقه. فالوسيطُ الأوّل اليومَ صحيح. ويُشحن التعديلُ **تقويةً** لا
--     سدّاً: اليومَ سلوكُه مطابقٌ تماماً (مُثبَتٌ بفحصٍ يرفع استثناءً)،
--     وغداً — لحظةَ تخضير Cloudflare، وهي تستلزم `trusted_proxies` —
--     يصير الوسيطُ الأوّل من اختيار المهاجم **بلا أن يُكسر شيءٌ يُنبّه**.
--
--   ✗ «anon يحمل منحَ أعمدةٍ على ratings» — **مردود كما صيغ**. قِيس:
--     `pg_attribute.attacl` فارغةٌ لكلّ عمود — لا منحَ أعمدةٍ إطلاقاً.
--     المنحُ على **الجدول** (`anon=rm/postgres`)، وما رآه المدقّقُ صفوفُ
--     `information_schema.column_privileges` التي تُفرَد لكلّ عمودٍ حتى
--     مع منحٍ جدوليّ. وسحبُه يستلزم `REVOKE SELECT ON ratings FROM anon`
--     ثمّ منحَ أعمدةٍ — و**ذلك يُفرِّغ التقييماتِ لكلّ زائرٍ مجهول**
--     لأن `dealRepository.hydrateRatings` تقرأ `select('*')` **وتُهمل
--     الخطأ**. فأُخرج من هذه الهجرة ويُسبَق بتغييرٍ في الواجهة.
-- ════════════════════════════════════════════════════════════════════════

-- ═════ ٠ · حارسُ المختبر — أوّلُ عبارةٍ في الملفّ، ولا شيءَ قبلها ═════
DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION '⛔ هذه هجرةُ إنتاج (جدة) — ومُنعت على مختبر طوكيو.';
  END IF;
END $guard$;


-- ════════════════════════════════════════════════════════════════════════
-- ① عنوانُ العميل: مصدرٌ واحد، وعددُ وسائطِنا في موضعٍ مُسمّى
--
-- 🔴 القاعدة: **تُسقَط الوسائطُ التي يُلحقها وسيطُنا نحن، ويُؤخذ آخرُ ما
--    يبقى**. ولا يُؤخذ «آخرُ وسيط» إطلاقاً: قِيس أن Kong يُلحق
--    `realip_remote_addr` (nginx-kong.conf:109-110 → `real_ip_header
--    X-Real-IP` · `real_ip_recursive off` · ولا `set_real_ip_from` ولا
--    `KONG_TRUSTED_IPS` في الحاوية) — أي عنوانَ حاويةِ Caddy، وهو **ثابتٌ
--    لكلّ طلبٍ على الأرض**. فالدلوُ عليه = دلوٌ عالميّ واحد = حجبُ الدخول
--    عن المنصّة كلّها.
-- 🪤 والصيغةُ صحيحةٌ في الحالتين معاً: فمهما أضاف المهاجمُ وسائطَ إلى
--    اليسار، فإن وسيطَنا يُلحق بعد العنوانِ الحقيقيّ دائماً.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._taki_client_ip()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn_ip$
DECLARE
  -- 🔴 المقدارُ الوحيد الذي يُعدَّل: عددُ الوسائط التي تُلحقها سلسلةُ
  --    وكلائنا بآخر الترويسة. اليومَ **واحد** (Kong). والسلسلةُ:
  --      المتصفّح → Caddy (الحافة، بلا trusted_proxies) → Kong → PostgREST
  --    وCloudflare اليومَ سحابةٌ رمادية (DNS فقط). فلحظةَ تخضيرها
  --    يصير العددُ **٢** — ولا موضعَ آخرَ يُعدَّل.
  c_hops  constant int := 1;
  v_raw   text;
  v_arr   text[];
  v_keep  int;
  v_i     int;
  v_cand  text;
BEGIN
  BEGIN
    v_raw := COALESCE(
               nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for',
               nullif(current_setting('request.headers', true), '')::json ->> 'x-real-ip');
  EXCEPTION WHEN OTHERS THEN
    v_raw := NULL;        -- ترويسةٌ مشوّهة ليست سبباً لإسقاط الطلب
  END;
  IF v_raw IS NULL OR btrim(v_raw) = '' THEN RETURN NULL; END IF;

  v_arr  := string_to_array(v_raw, ',');
  v_keep := COALESCE(array_length(v_arr, 1), 0) - c_hops;
  -- ترويسةٌ أقصرُ من السلسلة (مثلاً `x-real-ip` وهي مفردةٌ دائماً) ⇒ الأوّل
  IF v_keep < 1 THEN v_keep := 1; END IF;

  -- 🔴 شبكةُ أمانٍ لا تجميل: لو أخطأ `c_hops` فاستُقرّ على عنوانٍ خاصّ،
  --    صار الحدُّ دلواً عالمياً — فيُتزحزح يساراً حتى أوّلِ عنوانٍ عامّ.
  --    ولا يُتزحزح يميناً أبداً: اليمينُ هو وسيطُنا نحن.
  v_i := v_keep;
  WHILE v_i >= 1 LOOP
    v_cand := nullif(btrim(v_arr[v_i]), '');
    IF v_cand IS NOT NULL AND v_cand !~
       '^(10\.|127\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|0\.|::1$|[fF][cCdD])'
    THEN
      RETURN v_cand;
    END IF;
    v_i := v_i - 1;
  END LOOP;

  -- كلُّ السلسلة خاصّة (نداءٌ من داخل الشبكة) ⇒ كما كانت الدالّةُ تماماً.
  -- وNULL هنا غيرُ خطِر بعد البند ② : يصير الدلوُ `noip` المشترك، فالمهاجمُ
  -- الذي يُفلت من الاستنباط يَخنق **نفسه** ولا يمسّ أحداً.
  RETURN nullif(btrim(v_arr[1]), '');
END
$fn_ip$;

COMMENT ON FUNCTION public._taki_client_ip() IS
  'v15.79 — عنوانُ العميل من الترويسة: تُسقَط وسائطُ وكلائنا (c_hops) ويُؤخذ آخرُ ما يبقى. المصدرُ الوحيد لعنوانٍ تُبنى عليه الحدودُ وسجلُّ الموافقة.';


-- ─── ومصدرُ عنوانِ الموافقة صار نفسَه، و`p_ip` لم تَعُد تُقرأ ───
-- 🔴 `users.consent_ip` سجلٌّ قانونيّ تُحيل إليه الشروطُ دليلاً، فلا يُكتب
--    بما يقوله العميلُ عن نفسه. والوسيطُ يبقى في البصمة حتى لا ينكسر أيُّ
--    منادٍ قائم (وتغييرُ البصمة يُنشئ نسخةً ثانية فيصير النداءُ ملتبساً).
CREATE OR REPLACE FUNCTION public.record_user_consent(
  p_terms_version text,
  p_ip            text DEFAULT NULL::text,
  p_user_agent    text DEFAULT NULL::text,
  p_kind          text DEFAULT 'terms'::text,
  p_min_age       integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn_consent$
DECLARE
  v_me   text := (SELECT auth.uid()::text);
  v_ip   text;
  v_prev text;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('changed', false, 'error', 'AUTH_REQUIRED'); END IF;

  -- العنوان من الترويسة لا من العميل: ما يُمرّره المتصفّح عن نفسه ليس دليلاً.
  -- v15.79 — ومن **دالّةٍ واحدة**: كانت هنا نسخةٌ ثانيةٌ من استخراج العنوان،
  --          فإصلاحُ الأصلِ وحده كان يتركها تنحرف.
  v_ip := public._taki_client_ip();

  IF p_kind = 'gateway' THEN
    UPDATE public.users
       SET gateway_agreement_version = p_terms_version,
           gateway_agreement_at = now()
     WHERE id = v_me;
    RETURN jsonb_build_object('changed', true, 'kind', 'gateway');
  END IF;

  SELECT consent_terms_version INTO v_prev FROM public.users WHERE id = v_me;
  IF v_prev IS NOT DISTINCT FROM p_terms_version AND p_min_age IS NULL THEN
    RETURN jsonb_build_object('changed', false);
  END IF;

  UPDATE public.users
     SET consent_terms_at      = now(),
         consent_privacy_at    = now(),
         consent_refund_at     = now(),
         consent_terms_version = p_terms_version,
         consent_ip            = COALESCE(v_ip, consent_ip),
         consent_user_agent    = COALESCE(NULLIF(btrim(COALESCE(p_user_agent, '')), ''), consent_user_agent),
         consent_age_confirmed = CASE WHEN p_min_age IS NOT NULL THEN true ELSE consent_age_confirmed END,
         consent_min_age       = COALESCE(p_min_age, consent_min_age)
   WHERE id = v_me;

  RETURN jsonb_build_object('changed', true, 'kind', 'terms', 'ip_recorded', v_ip IS NOT NULL);
END
$fn_consent$;


-- ════════════════════════════════════════════════════════════════════════
-- ② الحدُّ يَفشل **مغلقاً** — ودلوٌ لكلّ رقم
--
-- 🔴 كان الفحصان ملفوفين بـ`IF v_ip IS NOT NULL THEN … END IF` في
--    الدالّتين، أي أنّ من يُفلت من استنباط العنوان يُمنح **لا حدَّ
--    إطلاقاً**. وقِيس أنّ الإغلاق لا يكسر شيئاً: صفرُ وظيفةِ كرون
--    (٣٧ وظيفة، لا واحدةَ تنادي أيّاً منهما) وصفرُ دالّةِ قاعدة.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.find_email_by_phone(input_phone text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $fn_fep$
DECLARE
    digits_only TEXT;
    bare        TEXT;
    intl        TEXT;
    country     TEXT;
    found_email TEXT;
    v_ip        TEXT;
BEGIN
    v_ip := public._taki_client_ip();
    -- v15.79 — بلا شرطٍ: عنوانٌ مجهولٌ يسقط في دلوٍ مشترك، لا في فراغ.
    PERFORM public.taki_rate_check('fep1m:' || COALESCE(v_ip, 'noip'), 3, 60,
      '⏳ محاولات كثيرة خلال وقت قصير — انتظر دقيقة ثم أعد المحاولة.');
    PERFORM public.taki_rate_check('fep1h:' || COALESCE(v_ip, 'noip'), 15, 3600,
      '⏳ محاولات كثيرة — أعد المحاولة بعد قليل.');

    digits_only := regexp_replace(COALESCE(input_phone, ''), '\D', '', 'g');

    IF length(digits_only) >= 13 AND left(digits_only, 5) = '00966' THEN
        digits_only := '0' || substring(digits_only from 6);
    ELSIF length(digits_only) >= 12 AND left(digits_only, 3) = '966' THEN
        digits_only := '0' || substring(digits_only from 4);
    END IF;

    IF length(digits_only) < 9 THEN
        RETURN NULL;
    END IF;

    -- v15.79 — دلوٌ لكلّ رقم: **بعد** التطبيع و**بعد** الخروج المبكّر، فلا
    -- يُنشئ نصٌّ مختلَقٌ صفَّ عدٍّ. وترتيبُه بعد دلوَي العنوان مقصود: نموُّ
    -- الصفوف يبقى محصوراً بسقف العنوان (١٥/ساعة) لا بخيال المهاجم.
    -- وموضعُه قبل أيّ بحثٍ في الجدول مقصودٌ أيضاً: فالخنقُ يقع سواءٌ كان
    -- الرقمُ مسجَّلاً أم لا، فلا يصير العدّادُ بنفسه عرّافاً عن وجود حساب.
    --
    -- 🔴 والسقفُ سخيٌّ عن قصدٍ مقيس: هذه الدالّة تُنادى في **كلّ** محاولة
    --    دخولٍ بالجوّال حتى الخاطئة — `src/services/authService.ts:293`
    --    قبل `signInWithPassword` في :298 — بنداءٍ واحدٍ لكلّ محاولة. وسقفُ
    --    العنوان (١٥/ساعة) يَبتُّ قبل هذا السقف لمن على اتّصالٍ واحد، فهذا
    --    الدلوُ لا يَعضُّ إلا هجمةً **موزَّعةً على عناوين كثيرة** — وهي
    --    الحالةُ التي يُفلتها سقفُ العنوان وحده. وشبكاتُ المشغّلين
    --    السعوديّة مشتركةُ العنوان (NAT)، فالمفتاحُ على **الرقم** لا على
    --    العنوان حتى لا يُعاقَب جارٌ بفعل جار.
    PERFORM public.taki_rate_check('fepph:' || digits_only, 20, 3600,
      '⏳ محاولات كثيرة على هذا الرقم — أعد المحاولة بعد قليل، أو ادخل ببريدك الإلكتروني.');

    IF left(digits_only, 1) = '0' THEN
        bare := substring(digits_only from 2);
    ELSE
        bare := digits_only;
    END IF;
    intl    := '+966' || bare;
    country := '966'  || bare;

    -- v12.39: admin accounts are excluded — their emails must never be
    -- resolvable from a phone number (admins log in with email).
    SELECT email INTO found_email
      FROM public.users
     WHERE (phone         IN (digits_only, '0' || bare, bare, intl, country)
        OR contact_phone IN (digits_only, '0' || bare, bare, intl, country))
       AND user_type IS DISTINCT FROM 'admin'
     LIMIT 1;

    IF found_email IS NOT NULL THEN
        RETURN found_email;
    END IF;

    SELECT COALESCE(au.email, au.raw_user_meta_data->>'email') INTO found_email
      FROM auth.users au
     WHERE (au.phone                          IN (digits_only, '0' || bare, bare, intl, country)
        OR au.raw_user_meta_data->>'phone'         IN (digits_only, '0' || bare, bare, intl, country)
        OR au.raw_user_meta_data->>'contact_phone' IN (digits_only, '0' || bare, bare, intl, country))
       AND NOT EXISTS (
         SELECT 1 FROM public.users pu
         WHERE pu.id = au.id::text AND pu.user_type = 'admin'
       )
     LIMIT 1;

    IF found_email IS NOT NULL THEN
      BEGIN
        INSERT INTO public.activity_log (action, entity_type, entity_id, metadata)
        VALUES ('phone_email_lookup', 'auth', left(digits_only, 4) || '****',
                jsonb_build_object('ip', v_ip));
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
    RETURN found_email;
END;
$fn_fep$;


CREATE OR REPLACE FUNCTION public.account_exists(p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_acex$
DECLARE
  v_email_taken boolean := false;
  v_phone_taken boolean := false;
  v_ip          text;
BEGIN
  v_ip := public._taki_client_ip();
  -- v15.79 — بلا شرطٍ (انظر `find_email_by_phone`). ولا دلوَ رقمٍ هنا عن
  -- قصد: `p_phone` تُقرأ **خاماً** (`WHERE phone = p_phone`) فمفتاحٌ على
  -- نصٍّ غيرِ مطبَّعٍ يُنشئ صفَّ عدٍّ لكلّ صيغةِ كتابة — والبديلُ (تطبيعٌ
  -- هنا) يغيّر دلالةَ الفحص. فالحدُّ على العنوان وحده، والبندُ مُسجَّلٌ في
  -- التقرير بوصفه خياراً مؤجَّلاً لا نسياناً.
  PERFORM public.taki_rate_check('acex1m:' || COALESCE(v_ip, 'noip'), 20, 60,
    '⏳ محاولات كثيرة خلال وقت قصير — انتظر دقيقة ثم أعد المحاولة.');
  PERFORM public.taki_rate_check('acex1h:' || COALESCE(v_ip, 'noip'), 200, 3600,
    '⏳ محاولات كثيرة — أعد المحاولة بعد قليل.');

  IF p_email IS NOT NULL AND length(btrim(p_email)) > 0 THEN
    SELECT EXISTS(SELECT 1 FROM public.users WHERE email ILIKE p_email AND deleted_at IS NULL) INTO v_email_taken;
  END IF;
  IF p_phone IS NOT NULL AND length(btrim(p_phone)) > 0 THEN
    SELECT EXISTS(SELECT 1 FROM public.users WHERE phone = p_phone AND deleted_at IS NULL) INTO v_phone_taken;
  END IF;
  RETURN jsonb_build_object('email_taken', v_email_taken, 'phone_taken', v_phone_taken);
END;
$fn_acex$;


-- ════════════════════════════════════════════════════════════════════════
-- ③ بوّابةُ البوت: فقدانُ صفٍّ من الخزنة كان **يفتحها للعالم**
--
-- 🔴 كان أوّلُ شرطٍ فيها:
--      COALESCE((SELECT value … WHERE key='bot_gate_enforced'), '0') <> '1'
--    فغيابُ الصفّ (أو قيمةٌ غيرُ '1') يُرجع TRUE للجميع ويَقصُر قبل أن
--    يُقارَن السرُّ إطلاقاً. وخزنةُ **هذا الخادم بعينه** فقدت مؤشّراً
--    بصمتٍ مرّةً (v14.44)، و`vault.update_secret` على مؤشّرٍ ميت تكتب صفرَ
--    صفوفٍ بلا استثناء. والبوّابةُ هي الحدُّ **الوحيد** بين البوت وأيّ
--    زائرٍ يحمل المفتاحَ العامّ، والهويّةُ وسيطٌ (`p_telegram_id`).
--
--    الآن: مفتاحُ التعطيل **حضورٌ** لا غياب، واسمُه جديد. لا صفّ ⇒ مغلقة.
-- 🪤 والصفُّ القديم `bot_gate_enforced` يبقى في الخزنة **ولا يُقرأ**: حذفُ
--    سرٍّ عمليّةٌ لا تُستعاد، ووجودُه لا يفتح شيئاً. وضبطُه على '0' لاحقاً
--    لا يُعطّل الحارسَ — وهو الاتجاهُ الآمن. (مُسجَّلٌ في التقرير ليُتقاعد
--    بقرارٍ صريح، لا بجانبِ هجرةٍ أخرى.)
-- 🪤 وفرعُ «لا ترويسات» يبقى حرفياً: PostgREST يضعها دائماً، فهو فرعُ
--    المشغّلِ والكرونِ من داخل القاعدة — ولو ضُيِّق لانكسر عملُ الخادم.
-- ════════════════════════════════════════════════════════════════════════

-- 🔴 لغةُ الدالّة `plpgsql` لا `sql`، وهذا **ليس ذوقاً**: الصيغةُ الأولى كانت
--    سلسلةَ `OR` في دالّةِ `sql`، فيُدمجها المُخطِّطُ (inline) ويُقيّم
--    `::json` **بأيّ ترتيبٍ شاء** — فلا تحرسه الفروعُ التي قبله. وقِيس في
--    تجربةٍ مُرجَعةٍ على جدة: مع `request.headers = ''` انفجرت بـ
--      ERROR: invalid input syntax for type json
--      CONTEXT: SQL function "_bot_gate_ok" during startup
--    أي أنها **ترفع استثناءً** بدل أن تُرجع قراراً ⇒ كلُّ دالّةٍ محروسةٍ
--    تنكسر، فيتوقّف البوتان كلّياً. وحالةُ الاختبار (هـ) أدناه هي التي
--    أمسكتها — فالفحصُ الذي يُجرى قبل الشحن هو ما حوّل العطلَ إلى سطرٍ هنا.
-- 🪤 وترويسةٌ ليست JSON سليماً تُعَدّ «لا سرّ» فتُرَدّ، ولا تُرفع استثناءً:
--    مُشوّهٌ من الشبكة يجب أن يكون **رفضاً** لا خمسَ مئة.
CREATE OR REPLACE FUNCTION public._bot_gate_ok()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn_gate$
DECLARE
  v_hdr    text;
  v_sent   text;
BEGIN
  -- v15.79 — تعطيلٌ صريحٌ وغائبٌ افتراضاً. والقيمةُ المطلوبةُ `'1'` بعينها.
  IF COALESCE((SELECT value FROM public.app_secrets WHERE key = 'bot_gate_bypass'), '') = '1' THEN
    RETURN true;
  END IF;

  v_hdr := current_setting('request.headers', true);

  -- لا ترويسات = نداءٌ من داخل القاعدة (مشغّل/كرون/خدمي) لا من متصفّح.
  -- PostgREST يضع الترويسات دائماً، فهذا الفرع غير قابل للوصول من الشبكة.
  IF v_hdr IS NULL OR v_hdr = '' THEN
    RETURN true;
  END IF;

  IF NOT (v_hdr IS JSON) THEN          -- PG16+ ; القاعدة هنا 17.6
    RETURN false;
  END IF;

  v_sent := v_hdr::json ->> 'x-bot-secret';
  IF v_sent IS NULL OR v_sent = '' THEN
    RETURN false;
  END IF;

  -- نافذةُ التدوير: السرُّ والسرُّ التالي مقبولان معاً (كما كانت).
  RETURN EXISTS (
    SELECT 1 FROM public.app_secrets
     WHERE key IN ('bot_gateway_secret', 'bot_gateway_secret_next')
       AND value IS NOT NULL AND value <> ''
       AND value = v_sent
  );
END $fn_gate$;

COMMENT ON FUNCTION public._bot_gate_ok() IS
  'v15.79 — تَفشل مغلقةً: غيابُ صفِّ التعطيل يعني الإنفاذ. ونافذةُ التدوير (السرُّ والسرُّ التالي) قائمةٌ كما كانت.';


-- ════════════════════════════════════════════════════════════════════════
-- ④ `taki_stock_push`: التعرّفُ **قبل** الحدّ
--
-- 🔴 كان الحدُّ يُطبَّق على **بصمة المفتاح الذي يرسله المنادي**، أي قبل أن
--    يُعرَف المنادي. فمفتاحٌ مختلَقٌ جديدٌ في كلّ طلبٍ = دلوٌ جديدٌ في كلّ
--    طلب: الحدُّ لا يَحدُّ، وكلُّ طلبٍ مجهولٍ من الإنترنت **يكتب صفّاً
--    دائماً** في `rate_limit_counters` (ومنظّفُه مرّةً في اليوم — كرون ٢٢).
--    والشقيقةُ `taki_stock_webhook` تفعلها بالترتيب الصحيح أصلاً (v15.20).
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.taki_stock_push(
  p_key         text,
  p_items       jsonb,
  p_observed_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_event_id    text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_push$
DECLARE v_hash text; v_id uuid;
BEGIN
  IF p_key IS NULL OR length(btrim(p_key)) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_KEY');
  END IF;
  v_hash := encode(extensions.digest(btrim(p_key), 'sha256'), 'hex');

  -- v15.79 — التعرّفُ أوّلاً، كما في `taki_stock_webhook`.
  SELECT id INTO v_id FROM public.stock_integrations
   WHERE api_key_hash = v_hash AND is_enabled AND direction IN ('in','both');

  IF v_id IS NULL THEN
    -- 🔴 دلوٌ **واحدٌ مشتركٌ** لكلّ المفاتيح المجهولة: عددُ الصفوف لا ينمو
    --    بمدخلات المهاجم أبداً، صفٌّ واحدٌ لكلّ نافذة.
    -- 🪤 ولا يُرفع استثناءٌ هنا مهما تجاوز: `taki_stock_webhook` تنادي هذه
    --    الدالّةَ **بلا معالج**، وخطأٌ منها يصير ٥٠٢ عند الحافة — و٥٠٢
    --    تُحسب فشلاً عند زد (٣٠ في ساعةٍ ⇒ تعطيلُ الخطّاف وإلغاءُ أحداثه
    --    المعلّقة). فالردُّ يبقى `UNKNOWN_KEY` حرفياً كما كان، والدلوُ
    --    للرصد وتثبيتِ عدد الصفوف لا للرفض.
    BEGIN
      PERFORM public.taki_rate_check('stockpush:unknown', 600, 60, 'unknown stock key flood');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RETURN jsonb_build_object('ok', false, 'error', 'UNKNOWN_KEY');
  END IF;

  -- والمفتاحُ صار **معرّفَ الاتصال** لا بصمةَ السرّ: فسببُ v15.20 («لا
  -- يُسجَّل سرٌّ في `rate_limit_counters`») متحقّقٌ بالبناء لا بالتعمية.
  PERFORM public.taki_rate_check('stockpush:' || v_id::text, 120, 60,
                                 'too many stock pushes — slow down');
  RETURN public._taki_stock_apply(v_id, p_items, p_observed_at, p_event_id);
END
$fn_push$;


-- ════════════════════════════════════════════════════════════════════════
-- ⑤ سحبُ المنحِ — و`REVOKE … FROM PUBLIC` لا يُلغي منحَ anon ولا العكس
--
-- ① `taki_stock_webhook` — تجلس **خلف** فحص التوقيع في دالّة الحافة
--    (`supabase/functions/stock-webhook/index.ts`، وهي تنادي بالدور
--    `service_role` — قِيس: `SUPABASE_SERVICE_ROLE_KEY` في :100). ومنحُها
--    لـ`authenticated` يعني أن أيَّ مستخدمٍ مسجَّلٍ يملك مفتاحَ متجرٍ أو
--    مسارَه يدفع مخزوناً **بلا توقيعٍ ولا سقفِ جسم**.
-- ② `merchant_set_payment_declaration` — دالّةٌ كاتبةٌ ممنوحةٌ لـ`anon`.
--    لوحةُ التاجر تناديها بحسابٍ مسجَّل، فـ`authenticated` يبقى.
-- ════════════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION public.taki_stock_webhook(text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_stock_webhook(text, jsonb, text) FROM anon;
REVOKE ALL ON FUNCTION public.taki_stock_webhook(text, jsonb, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.merchant_set_payment_declaration(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_set_payment_declaration(boolean) FROM anon;


-- ════════════════════════════════════════════════════════════════════════
-- ⑥ `taki_mark_session_booked`: تضييقٌ لا إغلاق
--
-- 🪤 الإغلاقُ ممنوع: v15.78 أبقتها لـ`anon` **عن قصد** ووضعت فحصاً يرفع
--    استثناءً إن سُحبت (JEDDAH_v15_78_revoke_anon_writers.sql:$v3$) —
--    يناديها الزائرُ غيرُ المسجَّل من `src/services/siteVisit.ts:125`.
--    فالعلاجُ في **الجسم**: ثلاثةُ قيودٍ وحدٌّ خشن.
--      · لا تُقلَب جلسةُ مستخدمٍ مسجَّلٍ إلا بحسابه (والحجزُ يستلزم حساباً
--        فـ`auth.uid()` موجودةٌ لحظةَ النداء الحقيقي).
--      · ولا تُقلَب جلسةٌ ميتة: النافذةُ ٣٠ دقيقة — وهي نفسُها نافذةُ
--        «جلسةٍ واحدة» في `track_app_open` لا رقماً مُختلَقاً.
--      · ولا تُعاد الكتابةُ على ما قُلب (خمولُ التكرار).
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.taki_mark_session_booked(p_session text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_mark$
DECLARE
  v_sid text := left(btrim(COALESCE(p_session,'')), 64);
  v_me  text := (SELECT auth.uid())::text;
BEGIN
  IF v_sid = '' THEN RETURN; END IF;

  -- حدٌّ خشنٌ يمنع تمشيطَ معرّفاتِ الجلسات. ولا يُرفع استثناءً: القياسُ لا
  -- يُعطّل حجزاً، والمنادي يبتلع الخطأ أصلاً (siteVisit.ts:125 `.catch`).
  BEGIN
    PERFORM public.taki_rate_check('mkbk:' || COALESCE(public._taki_client_ip(), 'noip'),
                                   30, 60, 'too many conversion marks');
  EXCEPTION WHEN OTHERS THEN RETURN;
  END;

  UPDATE public.site_sessions
     SET booked = true, last_seen_at = now()
   WHERE session_id = v_sid
     AND COALESCE(booked, false) = false
     AND last_seen_at > now() - interval '30 minutes'
     AND (user_id IS NULL OR user_id = v_me);
END
$fn_mark$;


-- ════════════════════════════════════════════════════════════════════════
-- ⑦ تقييماتُ المتجر والعرض: تُسقَط أعمدةُ الهويّة من شكلِ الردّ
--
-- 🔴 كانت `SELECT rt.*` فيعود **كلُّ** صفّ التقييم إلى أيّ زائرٍ مجهول:
--    `user_id` (معرّفُ مصادقةِ المُقيِّم) و`liked_by` (مصفوفةُ معرّفاتِ كلّ
--    من أعجبه) و`replied_by`. فبترقيمِ المتاجر تُبنى خريطةُ «أيُّ حسابٍ
--    قيَّم أيَّ متجر وأعجبه» — وهي بيانُ سلوكٍ شخصيّ.
--    والشقيقةُ المنسَّقة `bot_get_store_reviews` لا تُعيد منها شيئاً — دليلٌ
--    على أنّ هذه الأعمدةَ لم تكن مقصودةً للنشر.
--
-- والبديلُ بوليانيّان يُحسبان في القاعدة فلا يُسلَّم معرّفٌ قطّ:
--     `is_mine`      — هل هذا تقييمي؟ (زرُّ التعديل والحذف)
--     `liked_by_me`  — هل أعجبتُه؟ (حالةُ القلب)
-- و`replied_by` تُسقَط كلّياً: قِيس أنها **لا تُعرض في أيّ موضع** (صفرُ
-- موضعٍ في src/pages و src/components)، وقد تحمل معرّفَ أدمنٍ ردَّ بنفسه.
--
-- ⚠️ تلزمها تغييراتٌ في الواجهة (مذكورةٌ بالسطور في التقرير): الشاشةُ تدمج
--    صفوفَ هذه الدالّة بصفوفٍ تُقرأ من الجدول مباشرةً، فالقارئُ يجب أن
--    يقبل الشكلين (`r.likedByMe ?? r.likedBy?.includes(...)`).
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.browse_store_ratings(
  p_store_id  text,
  p_cursor_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_cursor_id text DEFAULT NULL::text,
  p_limit     integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_bsr$
DECLARE
  v_lim int := GREATEST(1, LEAST(50, COALESCE(p_limit, 10)));
  v_me  text := (SELECT auth.uid())::text;
  v_rows jsonb; v_more boolean := false; v_total int;
BEGIN
  IF p_store_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STORE_REQUIRED');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC, r.id DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    -- v15.79 — أعمدةٌ مُسمّاةٌ لا `rt.*`: أيُّ عمودٍ جديدٍ على `ratings`
    -- لا يُنشر من تلقاء نفسه بعد اليوم.
    SELECT rt.id, rt.deal_id, rt.store_id, rt.user_name, rt.score, rt.comment,
           rt.created_at, rt.reply, rt.replied_at, rt.like_count,
           (v_me IS NOT NULL AND rt.user_id = v_me)                            AS is_mine,
           (v_me IS NOT NULL AND v_me = ANY(COALESCE(rt.liked_by, '{}'::text[]))) AS liked_by_me,
           d.item_name
    FROM public.ratings rt
    JOIN public.deals d ON d.id = rt.deal_id
    WHERE d.store_id = p_store_id
      AND rt.deleted_at IS NULL
      AND (p_cursor_at IS NULL
           OR rt.created_at < p_cursor_at
           OR (rt.created_at = p_cursor_at AND rt.id < p_cursor_id))
    ORDER BY rt.created_at DESC, rt.id DESC
    LIMIT v_lim + 1
  ) r;

  IF jsonb_array_length(v_rows) > v_lim THEN
    v_more := true;
    v_rows := (SELECT jsonb_agg(e) FROM (SELECT e FROM jsonb_array_elements(v_rows) e LIMIT v_lim) s);
  END IF;

  SELECT count(*) INTO v_total
  FROM public.ratings rt JOIN public.deals d ON d.id = rt.deal_id
  WHERE d.store_id = p_store_id AND rt.deleted_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'rows', COALESCE(v_rows,'[]'::jsonb),
                            'has_more', v_more, 'total', v_total);
END
$fn_bsr$;


-- 🪤 وهذه **بلا أيّ منادٍ حيّ**: قِيس صفرَ موضعٍ في src/ و server/ و
--    shared/ و supabase/functions/ (لا الموقعُ ولا البوتان). فتضييقُها
--    مجّانيٌّ تماماً — ويُضيَّق كيلا تُوصَل لاحقاً بشكلٍ مكشوف.
CREATE OR REPLACE FUNCTION public.browse_deal_ratings(
  p_deal_id   text,
  p_cursor_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_cursor_id text DEFAULT NULL::text,
  p_limit     integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_bdr$
DECLARE
  v_lim  int := GREATEST(1, LEAST(50, COALESCE(p_limit, 20)));
  v_me   text := (SELECT auth.uid())::text;
  v_rows jsonb;
  v_more boolean := false;
BEGIN
  IF p_deal_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DEAL_REQUIRED');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC, r.id DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT rt.id, rt.deal_id, rt.store_id, rt.user_name, rt.score, rt.comment,
           rt.created_at, rt.reply, rt.replied_at, rt.like_count,
           (v_me IS NOT NULL AND rt.user_id = v_me)                            AS is_mine,
           (v_me IS NOT NULL AND v_me = ANY(COALESCE(rt.liked_by, '{}'::text[]))) AS liked_by_me
    FROM public.ratings rt
    WHERE rt.deal_id = p_deal_id
      AND rt.deleted_at IS NULL
      AND (
        p_cursor_at IS NULL
        OR rt.created_at < p_cursor_at
        OR (rt.created_at = p_cursor_at AND rt.id < p_cursor_id)
      )
    ORDER BY rt.created_at DESC, rt.id DESC
    LIMIT v_lim + 1
  ) r;

  IF jsonb_array_length(v_rows) > v_lim THEN
    v_more := true;
    v_rows := (SELECT jsonb_agg(e) FROM (
                 SELECT e FROM jsonb_array_elements(v_rows) e LIMIT v_lim) s);
  END IF;

  RETURN jsonb_build_object('ok', true, 'rows', COALESCE(v_rows, '[]'::jsonb), 'has_more', v_more);
END
$fn_bdr$;


-- ════════════════════════════════════════════════════════════════════════
-- ⑧ سياساتُ التخزين: حارسا المسار الذي أُعطي لـ`deals` ولم يُعطَ للاثنين
--
-- 🔴 سياسةُ `deals` تحمل `name !~ '\.\.'` و`array_length(…)=N`، و
--    `chat_write_members` و`complaints_files_write` **لا**. و
--    `taki_chat_member` تفحص المقطعَ الأوّل وحده، فمسارٌ مثل
--    `<باركودي>/../../deals/<معرّفي>/x.jpg` يَعبُر RLS.
-- 🪤 وتُعاد البناءُ من **النصّ الحيّ** (`pg_get_expr`) بإضافة حارسَين فقط،
--    والأدوارُ تُنسخ حرفياً: الاثنان `authenticated` **لا `public`**
--    (خلافاً لسياسةِ `deals`) — وتوسيعُها أو تضييقُها عطلٌ بنفسه (v14.38).
-- 🪤 وعددُ المقاطع من الكود لا من التخمين:
--      chat        `<باركود>/<uuid>.<امتداد>`            = ٢
--                  (src/services/chatAttachments.ts)
--      complaints  `<معرّف>/<معرّف الشكوى>/<uuid>.<امتداد>` = ٣
--                  (src/repositories/complaintRepository.ts)
-- ════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS chat_write_members ON storage.objects;
CREATE POLICY chat_write_members ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat'::text
    AND public.taki_chat_member(name)
    AND owner = auth.uid()
    AND name !~ '\.\.'::text
    AND array_length(string_to_array(name, '/'::text), 1) = 2
  );

DROP POLICY IF EXISTS complaints_files_write ON storage.objects;
CREATE POLICY complaints_files_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'complaints'::text
    AND split_part(name, '/'::text, 1) = (auth.uid())::text
    AND owner = auth.uid()
    AND name !~ '\.\.'::text
    AND array_length(string_to_array(name, '/'::text), 1) = 3
  );


-- ════════════════════════════════════════════════════════════════════════
-- ⑨ وعدُ الحذف: الصفُّ يُجهَّل فلا يَنطلق أيُّ `ON DELETE CASCADE`
--
-- 🔴 الوثيقةُ المنشورة تَعِد «محواً نهائياً للبيانات الشخصية»
--    (src/pages/legal/Privacy.tsx). و`purge_expired_accounts` **تُجهِّل**
--    صفَّ `users` ولا تحذفه — وهو الصحيح (حذفُه كان يمسح مبيعاتِ التجّار
--    وفواتيرَهم الضريبية) — لكنّ أثرَه أنّ **لا شيءَ يتسلسل**، فما لم
--    تُسمِّه الدالّةُ صراحةً يبقى.
--    وجُرِدت الجداولُ من `information_schema` لا من تقريرٍ: كلُّ جدولٍ عامٍّ
--    فيه عمودُ هويّةٍ (`user_id`/`author_id`/`reporter_id`/`offender_id`/
--    `target_id`/`store_id`) ثمّ قُرئت أعمدتُه.
--
-- والقرارُ ثلاثيّ، ومذكورٌ ليطابقه نصُّ الخصوصية حرفاً بحرف:
--   (هـ) **يُحذف** — قياسٌ سلوكيّ لا قيمةَ قانونيّةَ ولا ماليّةَ له.
--   (و)  **يبقى الصفُّ ويذهب النصُّ والهويّةُ** — أثرٌ إداريٌّ لازمٌ للمنصّة
--        (بلاغٌ · شكوى · إنذار)، ولا يصحّ أن يُمحى بطلبِ المُبلَّغ عنه.
--   (ز)  **يبقى كما هو** — أثرٌ ماليٌّ وضريبيّ: `bookings` (مُجهَّلٌ أصلاً)
--        و`order_invoices` (**لقطةٌ مجمّدة — لا تُعاد كتابتُها أبداً**)
--        و`booking_refunds` و`platform_payment_log` و`subscription_payments`
--        و`payment_attempts` و`store_invoice_counters`. وتسلسلُ الفاتورةِ
--        بلا فجوات، فحذفُ صفٍّ منه يكسر ما يُفترض ألّا فجوةَ فيه.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.purge_expired_accounts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn_purge$
DECLARE v_n integer := 0; r record; v_mask text;
BEGIN
  FOR r IN
    SELECT id FROM public.users
     WHERE purge_after IS NOT NULL AND purge_after < now()
       AND COALESCE(is_anonymized, false) = false
  LOOP
    v_mask := 'deleted+' || substr(md5(r.id), 1, 12) || '@takisa.invalid';

    -- (أ) الصفّ العامّ
    UPDATE public.users
       SET name = 'مستخدم محذوف',
           shop = NULL, bio = NULL, address = NULL, avatar_url = NULL,
           phone = NULL, contact_phone = NULL,
           email = v_mask,
           lat = NULL, lng = NULL,
           delivery_address = NULL,
           notif_keywords = NULL, smart_alerts = NULL, followed_merchants = NULL,
           telegram_id = NULL, telegram_chat_id = NULL, whatsapp_chat_id = NULL,
           telegram_link_otp = NULL, telegram_link_otp_expires_at = NULL,
           consent_ip = NULL, consent_user_agent = NULL,
           is_anonymized = true, anonymized_at = now(),
           purge_after = NULL
     WHERE id = r.id;

    -- (ب) صفّ المصادقة **وهويّاته**. 🪤 v14.22 نظّفت `auth.users` وحدها، و
    --     `auth.identities.identity_data` تحمل البريد والاسم والجوال والعنوان.
    BEGIN
      UPDATE auth.users
         SET email = v_mask, phone = NULL, encrypted_password = '',
             raw_user_meta_data = '{}'::jsonb,
             email_change = NULL, phone_change = NULL
       WHERE id::text = r.id;
      UPDATE auth.identities
         SET identity_data = jsonb_build_object('sub', r.id, 'email', v_mask)
       WHERE user_id::text = r.id;
      DELETE FROM auth.refresh_tokens WHERE user_id = r.id;
      DELETE FROM auth.sessions WHERE user_id::text = r.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'auth scrub skipped for %: %', r.id, SQLERRM;
    END;

    -- (ج) ما يحمل هويّته خارج صفّه
    DELETE FROM public.user_addresses     WHERE user_id = r.id;
    DELETE FROM public.push_subscriptions WHERE user_id = r.id;
    DELETE FROM public.delivery_tracks    WHERE user_id = r.id;
    DELETE FROM public.email_outbox       WHERE user_id = r.id;
    DELETE FROM public.notifications      WHERE user_id = r.id;
    UPDATE public.ratings SET user_name = 'مستخدم محذوف' WHERE user_id = r.id;
    -- v14.77 — المشاركات: السجلّ يبقى والهويّة تُجهَّل.
    UPDATE public.contest_entries
       SET name = 'مشارك محذوف', phone = ''
     WHERE user_id = r.id;

    -- v14.94 — التوثيق: القرار يبقى أثراً، والهويّة تذهب.
    UPDATE public.store_verifications
       SET doc_number = NULL, legal_name = NULL, claimed_name = NULL, admin_note = NULL
     WHERE store_id = r.id;
    -- v14.94 — نصوص المحادثات: فجوةٌ قائمة منذ v14.27، تكبر مع رفع حدّ الرسائل.
    DELETE FROM public.booking_messages WHERE sender_id = r.id;

    -- (د) الطلبات تبقى سجلّاً للتاجر، بلا اسم ولا جوال ولا ما يقود لبيته
    UPDATE public.bookings
       SET user_name = NULL, user_phone = NULL,
           delivery_address = CASE
             WHEN delivery_address IS NULL THEN NULL
             ELSE delivery_address - 'phone' - 'details' - 'lat' - 'lng' END
     WHERE user_id = r.id;

    -- ───────────────────────────────────────────────────────────────────
    -- (هـ) v15.79 — قياسٌ سلوكيّ: **يُحذف**. لا قيمةَ قانونيّةَ ولا مالية،
    --      وهو يحمل إحداثيّاتٍ ونصَّ بحثٍ وجهازاً ومُحيلاً وحملةً — كلُّها
    --      مربوطةٌ بالمعرّف، وكانت تبقى ١٨٠ يوماً **بعد** وعدِ المحو.
    DELETE FROM public.analytics_events        WHERE user_id = r.id;
    DELETE FROM public.store_analytics_events  WHERE user_id = r.id;
    DELETE FROM public.site_sessions           WHERE user_id = r.id;
    DELETE FROM public.user_sessions           WHERE user_id = r.id;
    DELETE FROM public.favorites               WHERE user_id = r.id;
    DELETE FROM public.deal_authenticity_votes WHERE user_id = r.id;
    DELETE FROM public.promo_impressions       WHERE user_id = r.id;
    DELETE FROM public.pending_warnings        WHERE user_id = r.id;
    DELETE FROM public.telegram_link_tokens    WHERE user_id = r.id;

    -- (و) v15.79 — أثرٌ إداريٌّ يبقى، ونصُّه الحرُّ وهويّتُه يذهبان. ولا
    --     يُحذف الصفُّ: بلاغٌ أو إنذارٌ لا يُمحى بطلبِ من صدر بحقّه.
    --     🪤 وهذه الخمسةُ **بلا منظّفٍ دوريٍّ إطلاقاً** (صفرُ وظيفةِ كرون
    --        تذكرها) — أي أنّ نصَّها كان يبقى أبداً.
    UPDATE public.complaints
       SET subject = NULL, message = NULL, admin_note = NULL
     WHERE user_id = r.id;
    UPDATE public.complaint_replies SET body = NULL            WHERE author_id  = r.id;
    UPDATE public.reports           SET reason = NULL          WHERE reporter_id = r.id;
    UPDATE public.moderation_flags
       SET offender_name = 'مستخدم محذوف', content = NULL
     WHERE offender_id = r.id;
    UPDATE public.user_warnings
       SET context_message = NULL, context_barcode = NULL
     WHERE user_id = r.id;
    UPDATE public.activity_log      SET user_id = NULL, metadata = NULL WHERE user_id = r.id;
    UPDATE public.admin_impersonation_log
       SET target_email = NULL, ip_address = NULL, user_agent = NULL
     WHERE target_id::text = r.id;

    -- (ز) v15.79 — وللبائع: `store_id` **هو** معرّفُ حسابه. فبياناتُ
    --     الاتّصال شخصيّةٌ وتذهب؛ و`cr_number`/`vat_number` تبقى لأنها
    --     سجلٌّ تجاريٌّ مجمَّدٌ على الفواتير الضريبية أصلاً.
    UPDATE public.store_profiles
       SET email = NULL, phone = NULL, address = NULL,
           bio = NULL, avatar_url = NULL, admin_notes = NULL
     WHERE store_id = r.id;

    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$fn_purge$;


-- ════════════════════════════════════════════════════════════════════════
-- ⑩ إيقافُ القياس يصير **قراراً على الخادم**، والإحداثيّاتُ تُدوَّر
--
-- 🔴 كان المفتاحُ في المتصفّح وحده (`src/services/analyticsConsent.ts`)،
--    فكلُّ منادٍ آخر يتجاوزه: البوتان · حزمةٌ قديمةٌ عالقةٌ على آيفون ·
--    نداءٌ مباشرٌ بالمفتاح العامّ. والوعدُ المنشور «إمكانُ سحب الموافقة».
--    والكتّابُ **خمسةٌ لا ثلاثة**: الثلاثةُ المرصودة + `bot_track_open`
--    (تكتب إحداثيّاتِ المستخدم من `users.lat/lng`) + `track_site_visit`.
--
-- 🔴 والإحداثيّاتُ كانت تُخزَّن بدقّةٍ كاملة (قِيس: ١٣ خانةً عشرية على
--    ١٦٥ صفّاً) والموقفُ المعلن «جمهورٌ على مستوى المدينة وبلا خريطة».
--    فتُدوَّر إلى **خانتين** (≈٥٥٠ متراً): تكفي لإسناد المدينة والمنطقة
--    ولاستعلامِ النطاق في `admin_geo_insights` (مقياسُه كيلومترات)، ولا
--    تكفي لتحديد بيت.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.track_app_open(
  p_source text DEFAULT 'web'::text,
  p_lat    double precision DEFAULT NULL::double precision,
  p_lng    double precision DEFAULT NULL::double precision)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn_tao$
DECLARE v_uid text := auth.uid()::text;
        v_src text := CASE WHEN p_source IN ('web','telegram','whatsapp') THEN p_source ELSE 'web' END;
        -- v15.79 — تدويرٌ عند الكتابة لا عند العرض.
        v_lat double precision := CASE WHEN p_lat BETWEEN -90  AND 90  THEN round(p_lat::numeric, 2)::double precision END;
        v_lng double precision := CASE WHEN p_lng BETWEEN -180 AND 180 THEN round(p_lng::numeric, 2)::double precision END;
BEGIN
    -- v15.79 — الموافقةُ تُفحص على الخادم فتصير قراراً لا تفضيلَ متصفّح.
    IF v_uid IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.users WHERE id = v_uid AND COALESCE(analytics_opt_out, false)
    ) THEN RETURN; END IF;

    -- نفس المستخدم خلال ٣٠ دقيقة = جلسة واحدة (المجهول يعتمد على كبح العميل).
    IF v_uid IS NOT NULL AND EXISTS (
        SELECT 1 FROM analytics_events
        WHERE kind='app_open' AND user_id=v_uid AND source=v_src
          AND created_at > now() - interval '30 minutes'
    ) THEN RETURN; END IF;
    INSERT INTO analytics_events (kind, user_id, source, lat, lng)
    VALUES ('app_open', v_uid, v_src, v_lat, v_lng);
END;
$fn_tao$;


CREATE OR REPLACE FUNCTION public.track_search(p_query text, p_scope text DEFAULT 'home'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn_ts$
DECLARE v_q text := lower(btrim(COALESCE(p_query, '')));
        v_uid text := auth.uid()::text;
BEGIN
    IF length(v_q) < 2 OR length(v_q) > 80 THEN RETURN; END IF;

    -- v15.79 — الموافقةُ على الخادم.
    IF v_uid IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.users WHERE id = v_uid AND COALESCE(analytics_opt_out, false)
    ) THEN RETURN; END IF;

    -- نفس المستخدم + نفس الكلمة خلال ١٠ دقائق = بحث واحد (يمنع تضخيم العدّاد أثناء الكتابة)
    IF v_uid IS NOT NULL AND EXISTS (
        SELECT 1 FROM analytics_events
        WHERE kind='search' AND user_id=v_uid AND query=v_q
          AND created_at > now() - interval '10 minutes'
    ) THEN RETURN; END IF;
    INSERT INTO analytics_events (kind, user_id, query, source)
    VALUES ('search', v_uid, v_q,
            CASE WHEN p_scope IN ('home','deals','nearby') THEN p_scope ELSE 'home' END);
END;
$fn_ts$;


CREATE OR REPLACE FUNCTION public.record_analytics_events(p_events jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $fn_rae$
DECLARE
  v_count INTEGER := 0;
  v_uid   TEXT := auth.uid()::text;
BEGIN
  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' OR jsonb_array_length(p_events) = 0 THEN
    RETURN 0;
  END IF;
  IF jsonb_array_length(p_events) > 50 THEN
    RAISE EXCEPTION 'batch too large';
  END IF;

  -- v15.79 — الموافقةُ على الخادم. وتُرجع صفراً لا خطأً: القياسُ لا يُعطّل.
  IF v_uid IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.users WHERE id = v_uid AND COALESCE(analytics_opt_out, false)
  ) THEN RETURN 0; END IF;

  INSERT INTO public.store_analytics_events (
    store_id, deal_id, user_id, session_id, event_type, duration_ms, metadata, created_at
  )
  SELECT
    ev->>'store_id',
    NULLIF(ev->>'deal_id',''),
    v_uid,                                    -- تختمه القاعدة، ولا يُصدَّق ما يرسله العميل
    NULLIF(ev->>'session_id',''),
    ev->>'event_type',
    NULLIF(ev->>'duration_ms','')::int,
    COALESCE(ev->'metadata','{}'::jsonb),
    -- لا نثق بطابع العميل مطلقاً: نقبله فقط داخل نافذة ±١٠ دقائق من الآن،
    -- وإلا نستخدم وقت الخادم — فلا يستطيع أحد حقن أحداث بتواريخ ماضية/مستقبلية.
    CASE
      WHEN (ev->>'created_at')::timestamptz BETWEEN now() - interval '10 minutes'
                                                AND now() + interval '10 minutes'
      THEN (ev->>'created_at')::timestamptz
      ELSE now()
    END
  FROM jsonb_array_elements(p_events) AS ev
  WHERE NULLIF(ev->>'store_id','') IS NOT NULL
    AND ev->>'event_type' IN ('deal_view','deal_click','click_favorite','click_share',
                              'booking_started','booking_completed','booking_abandoned','time_on_page');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$fn_rae$;


-- 🪤 الكاتبُ الرابع، وهو **بعينه** المسارُ الذي سمّاه التقريرُ متجاوزاً
--    للمفتاح: البوت لا يرى `localStorage` إطلاقاً. وهو يقرأ إحداثيّاتِ
--    المستخدم من صفّه، فيُدوَّر هنا أيضاً.
CREATE OR REPLACE FUNCTION public.bot_track_open(
  p_telegram_id bigint DEFAULT NULL::bigint,
  p_whatsapp_id text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn_bto$
DECLARE v_uid text := public._bot_uid(p_telegram_id, p_whatsapp_id);
        v_src text := CASE WHEN p_telegram_id IS NOT NULL THEN 'telegram' ELSE 'whatsapp' END;
        v_lat double precision; v_lng double precision;
BEGIN
    -- v15.79 — الموافقةُ على الخادم.
    IF v_uid IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.users WHERE id = v_uid AND COALESCE(analytics_opt_out, false)
    ) THEN RETURN; END IF;

    IF v_uid IS NOT NULL AND EXISTS (
        SELECT 1 FROM analytics_events
        WHERE kind='app_open' AND user_id=v_uid AND source=v_src
          AND created_at > now() - interval '30 minutes'
    ) THEN RETURN; END IF;
    -- آخر موقع معروف للمستخدم المربوط (المشترك يشارك موقعه في التطبيق).
    IF v_uid IS NOT NULL THEN
        SELECT round(u.lat::numeric, 2)::double precision,
               round(u.lng::numeric, 2)::double precision
          INTO v_lat, v_lng
          FROM users u WHERE u.id = v_uid;
    END IF;
    INSERT INTO analytics_events (kind, user_id, source, lat, lng)
    VALUES ('app_open', v_uid, v_src, v_lat, v_lng);
END;
$fn_bto$;


-- 🪤 والكاتبُ الخامس الذي لم يُرصَد: `track_site_visit` تكتب الجهازَ
--    والمُحيلَ والحملةَ وصفحةَ الهبوط مربوطةً بالمعرّف. وبوّابةُ المتصفّح
--    تحرسها بالفعل (siteVisit.ts) — فسكوتُ الخادم كان يعني أن حزمةً قديمة
--    أو نداءً مباشراً يتجاوزها.
CREATE OR REPLACE FUNCTION public.track_site_visit(
  p_session  text,
  p_path     text,
  p_referrer text DEFAULT NULL::text,
  p_utm      jsonb DEFAULT '{}'::jsonb,
  p_device   text DEFAULT NULL::text,
  p_pwa      boolean DEFAULT false,
  p_lang     text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_tsv$
DECLARE
    v_sid   text := left(btrim(COALESCE(p_session, '')), 64);
    v_uid   text := auth.uid()::text;
    v_path  text;
    v_host  text;
    v_src   text := left(btrim(COALESCE(p_utm->>'source',   '')), 64);
    v_med   text := left(btrim(COALESCE(p_utm->>'medium',   '')), 64);
    v_camp  text := left(btrim(COALESCE(p_utm->>'campaign', '')), 64);
    v_ref   text := left(btrim(COALESCE(p_utm->>'ref',      '')), 32);
    v_dev   text := CASE WHEN p_device IN ('mobile','tablet','desktop') THEN p_device END;
    v_lang  text := CASE WHEN p_lang IN ('ar','en') THEN p_lang END;
    v_new   integer;
BEGIN
    -- معرّف جلسةٍ مشوّه أو غائب ⇒ لا نكتب شيئاً (ولا نُخطئ: القياس لا يُفشل تصفّحاً).
    IF v_sid !~ '^[A-Za-z0-9_.-]{8,64}$' THEN RETURN; END IF;

    -- v15.79 — الموافقةُ على الخادم.
    IF v_uid IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.users WHERE id = v_uid AND COALESCE(analytics_opt_out, false)
    ) THEN RETURN; END IF;

    -- المسار: بلا مضيف، وبلا أي استعلام (فلا يُخزَّن باركود ولا رمز في العنوان).
    v_path := left(split_part(split_part(COALESCE(p_path, '/'), '?', 1), '#', 1), 120);
    IF v_path = '' THEN v_path := '/'; END IF;
    IF left(v_path, 1) <> '/' THEN v_path := '/' || v_path; END IF;

    -- المُحيل: **اسم المضيف وحده**.
    IF COALESCE(btrim(p_referrer), '') <> '' THEN
        v_host := left(lower(split_part(split_part(regexp_replace(p_referrer, '^[a-z]+://', '', 'i'), '/', 1), ':', 1)), 120);
        IF v_host !~ '^[a-z0-9.-]+\.[a-z]{2,}$' THEN v_host := NULL; END IF;
    END IF;

    -- تحديثُ جلسةٍ قائمة: لا صفّ جديد، ولا يُعاد كتابة مصدر الوصول
    -- (الإسناد لأوّل لمسة — وهو الصحيح: القناة التي جلبته لا التي تنقّل فيها).
    UPDATE public.site_sessions
       SET last_seen_at = now(),
           page_count   = LEAST(page_count + 1, 500),
           last_path    = v_path,
           user_id      = COALESCE(user_id, v_uid)
     WHERE session_id = v_sid;
    IF FOUND THEN RETURN; END IF;

    -- 🪤 الدالّة مفتوحة للزائر، فإنشاء الجلسات محدودٌ عالمياً: أسوأ حالةٍ
    --    مسقوفة بدل نموٍّ بلا حدّ. والتحديث أعلاه لا يمرّ من هنا إطلاقاً.
    SELECT count(*) INTO v_new FROM public.site_sessions
     WHERE started_at > now() - interval '1 minute';
    IF v_new >= 300 THEN RETURN; END IF;

    INSERT INTO public.site_sessions (
        session_id, landing_path, referrer_host, channel,
        utm_source, utm_medium, utm_campaign, ref_code,
        device, is_pwa, lang, last_path, user_id
    ) VALUES (
        v_sid, v_path, v_host, public.taki_traffic_channel(v_host, v_src),
        NULLIF(v_src,''), NULLIF(v_med,''), NULLIF(v_camp,''), NULLIF(v_ref,''),
        v_dev, COALESCE(p_pwa, false), v_lang, v_path, v_uid
    )
    ON CONFLICT (session_id) DO NOTHING;   -- سباقُ تبويبين على نفس الجلسة
END
$fn_tsv$;


-- ─── وما كُتب بدقّةٍ كاملةٍ قبل اليوم يُدوَّر مرّةً واحدة (خاملُ التكرار) ───
UPDATE public.analytics_events
   SET lat = round(lat::numeric, 2)::double precision,
       lng = round(lng::numeric, 2)::double precision
 WHERE (lat IS NOT NULL AND lat <> round(lat::numeric, 2)::double precision)
    OR (lng IS NOT NULL AND lng <> round(lng::numeric, 2)::double precision);


NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════
-- ═════════════════  التحقّق — كلُّه `DO` يرفع استثناءً  ═════════════════
-- 🪤 وجدولُ ✅/❌ **لا يُفشل psql** (v14.50)، فهو في آخر الملفّ للقراءة
--    وحدها وبعد كلّ ما يَبتّ.
-- ════════════════════════════════════════════════════════════════════════

-- ① عنوانُ العميل: سلوكُ اليوم مطابق، والتزويرُ لا يُزيحه
DO $v01$
DECLARE v_old text; v_got text;
BEGIN
  v_old := COALESCE(current_setting('request.headers', true), '');

  -- (أ) شكلُ الإنتاج اليوم: عنوانٌ عامّ ثمّ حاويةُ Caddy ⇒ العنوانُ العامّ
  PERFORM set_config('request.headers', '{"x-forwarded-for":"203.0.113.9, 172.20.0.9"}', true);
  SELECT public._taki_client_ip() INTO v_got;
  IF v_got <> '203.0.113.9' THEN
    RAISE EXCEPTION '❌ انحرافُ سلوك: شكلُ الإنتاج أعطى % بدل 203.0.113.9', COALESCE(v_got,'NULL');
  END IF;

  -- (ب) تزويرٌ بالتقديم — مهما أضاف المهاجمُ يساراً، وسيطُنا يُلحق يميناً
  PERFORM set_config('request.headers', '{"x-forwarded-for":"8.8.8.8, 1.1.1.1, 203.0.113.9, 172.20.0.9"}', true);
  SELECT public._taki_client_ip() INTO v_got;
  IF v_got <> '203.0.113.9' THEN
    RAISE EXCEPTION '❌ التزويرُ بالتقديم أزاح العنوان: %', COALESCE(v_got,'NULL');
  END IF;

  -- (ج) 🔴 ولا يُستقرّ على عنوانٍ خاصّ أبداً: ذاك دلوٌ عالميٌّ واحد = عطلُ
  --     المنصّة. (كسرةُ `c_hops` المحتملة تُمسك هنا.)
  PERFORM set_config('request.headers', '{"x-forwarded-for":"203.0.113.9, 10.0.1.147, 172.20.0.9"}', true);
  SELECT public._taki_client_ip() INTO v_got;
  IF v_got IS NULL OR v_got ~ '^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.)' THEN
    RAISE EXCEPTION '❌ استقرّ على عنوانٍ خاصّ (%) — وهذا خنقٌ عالميّ لا حدٌّ', COALESCE(v_got,'NULL');
  END IF;

  -- (د) `x-real-ip` مفردةٌ دائماً ⇒ لا تُقصّ
  PERFORM set_config('request.headers', '{"x-real-ip":"203.0.113.9"}', true);
  SELECT public._taki_client_ip() INTO v_got;
  IF v_got <> '203.0.113.9' THEN
    RAISE EXCEPTION '❌ x-real-ip المفردة قُصّت: %', COALESCE(v_got,'NULL');
  END IF;

  -- (هـ) بلا ترويسات ⇒ NULL (وهو آمنٌ الآن: البند ② يَفشل مغلقاً)
  PERFORM set_config('request.headers', '', true);
  SELECT public._taki_client_ip() INTO v_got;
  IF v_got IS NOT NULL THEN
    RAISE EXCEPTION '❌ بلا ترويساتٍ أعطت % بدل NULL', v_got;
  END IF;

  PERFORM set_config('request.headers', v_old, true);
  RAISE NOTICE '✅ ① عنوانُ العميل: خمسةُ أشكالٍ مقيسة، ومنها كسرةُ العنوان الخاصّ';
END $v01$;


-- ① ب — ولا نسخةَ ثانيةً لاستخراج العنوان في `record_user_consent`
DO $v02$
DECLARE src text;
BEGIN
  -- 🪤 يُجرَّد التعليقُ أوّلاً: حارسٌ يقرأ تعليقَه هو ليس حارساً (v14.97).
  src := regexp_replace(pg_get_functiondef(
           'public.record_user_consent(text,text,text,text,integer)'::regprocedure),
           '--[^\n]*', '', 'g');
  IF src ~ 'split_part' THEN
    RAISE EXCEPTION '❌ بقيت نسخةٌ ثانية لاستخراج العنوان في record_user_consent';
  END IF;
  IF src !~ '_taki_client_ip' THEN
    RAISE EXCEPTION '❌ record_user_consent لا تنادي _taki_client_ip';
  END IF;
  IF src ~ 'consent_ip\s*=\s*COALESCE\(v_ip,\s*consent_ip\)' IS NOT TRUE THEN
    RAISE EXCEPTION '❌ انكسر كتابةُ consent_ip';
  END IF;
  -- و`p_ip` لم تَعُد تُقرأ في جسم الدالّة (البصمةُ باقيةٌ عمداً)
  IF src ~ 'COALESCE\(p_ip' THEN
    RAISE EXCEPTION '❌ ما زال `p_ip` من العميل يصل إلى سجلّ الموافقة';
  END IF;
  RAISE NOTICE '✅ ① ب سجلُّ الموافقة: مصدرٌ واحد، ولا شيءَ من العميل';
END $v02$;


-- ② الحدُّ يَعضُّ: على العنوان · وبلا عنوان · وعلى الرقم موزَّعاً
DO $v03$
DECLARE v_old text; i int; v_hit boolean := false; v_phone text := '0500000000';
BEGIN
  v_old := COALESCE(current_setting('request.headers', true), '');

  -- (أ) سقفُ الدقيقة على العنوان: الرابعةُ تُرفض
  PERFORM set_config('request.headers',
    '{"x-forwarded-for":"198.51.100.250, 172.20.0.9"}', true);
  BEGIN
    FOR i IN 1..4 LOOP PERFORM public.find_email_by_phone('0599999991'); END LOOP;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_hit := true;
  END;
  IF NOT v_hit THEN RAISE EXCEPTION '❌ سقفُ العنوان (٣/دقيقة) لم يَعضّ'; END IF;

  -- (ب) 🔴 الفشلُ مغلقاً: بلا ترويساتٍ إطلاقاً، لا بدّ أن يَحدَّ أيضاً
  v_hit := false;
  PERFORM set_config('request.headers', '', true);
  BEGIN
    FOR i IN 1..4 LOOP PERFORM public.find_email_by_phone('0599999992'); END LOOP;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_hit := true;
  END;
  IF NOT v_hit THEN
    RAISE EXCEPTION '❌ بلا عنوانٍ لم يُطبَّق أيُّ حدّ — الدالّةُ ما زالت تَفشل مفتوحةً';
  END IF;

  -- (ج) ونفسُ الشيء لـ`account_exists`
  v_hit := false;
  BEGIN
    FOR i IN 1..21 LOOP PERFORM public.account_exists(NULL, '0599999993'); END LOOP;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_hit := true;
  END;
  IF NOT v_hit THEN
    RAISE EXCEPTION '❌ account_exists بلا عنوانٍ لم يُطبَّق عليها حدّ';
  END IF;

  -- (د) دلوُ الرقم: يُثبَت بعناوينَ **مختلفة** لأن سقفَ العنوان يَبتُّ قبله
  --     لمن على اتّصالٍ واحد. الحادي والعشرون على نفس الرقم يُرفض.
  v_hit := false;
  BEGIN
    FOR i IN 1..21 LOOP
      PERFORM set_config('request.headers',
        format('{"x-forwarded-for":"198.51.100.%s, 172.20.0.9"}', i), true);
      PERFORM public.find_email_by_phone(v_phone);
    END LOOP;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_hit := true;
  END;
  IF NOT v_hit THEN RAISE EXCEPTION '❌ دلوُ الرقم (٢٠/ساعة) لم يَعضّ'; END IF;

  -- (هـ) ولا يُنشئ نصٌّ أقصرُ من تسعِ خاناتٍ صفَّ عدٍّ باسم الرقم
  PERFORM set_config('request.headers',
    '{"x-forwarded-for":"198.51.100.251, 172.20.0.9"}', true);
  PERFORM public.find_email_by_phone('123');
  IF EXISTS (SELECT 1 FROM public.rate_limit_counters WHERE bucket_key = 'fepph:123') THEN
    RAISE EXCEPTION '❌ دلوُ الرقم أُنشئ لنصٍّ قصيرٍ — موضعُه قبل الخروج المبكّر';
  END IF;

  PERFORM set_config('request.headers', v_old, true);
  RAISE NOTICE '✅ ② الحدُّ يَعضُّ في أربع حالاتٍ، ولا يُنشئ صفّاً لنصٍّ قصير';
END $v03$;


-- ③ بوّابةُ البوت — فحصٌ **موجبٌ وسالبٌ** على دالّةٍ جسمُها يحمل البوّابة
DO $v04$
DECLARE
  v_old text; v_tg bigint; v_expect text; v_got text; v_ok boolean;
  v_secret text; v_next text; n int;
BEGIN
  -- 🔴 ولا صفَّ تعطيلٍ في الخزنة: غيابُه **هو** الإنفاذ الآن
  SELECT count(*) INTO n FROM public.app_secrets WHERE key = 'bot_gate_bypass';
  IF n <> 0 THEN
    RAISE EXCEPTION '❌ `bot_gate_bypass` موجودٌ في الخزنة — البوّابةُ مُعطَّلة';
  END IF;

  -- 🪤 ولا تُقبل شهادةُ نصٍّ وحدها: يُجرَّد التعليقُ ثمّ يُفحص أنّ الافتراضَ
  --    القديم الفاشلَ مفتوحاً اختفى فعلاً من **جسم** الدالّة.
  IF regexp_replace(pg_get_functiondef('public._bot_gate_ok()'::regprocedure),
                    '--[^\n]*', '', 'g') ~ 'bot_gate_enforced' THEN
    RAISE EXCEPTION '❌ ما زال جسمُ البوّابة يقرأ `bot_gate_enforced` (الافتراضُ الفاشلُ مفتوحاً)';
  END IF;

  -- وحسابٌ مربوطٌ حقيقيّ، وإلّا فالفحصُ **لا يبتّ** — ولا يُقبل مرورُه
  SELECT telegram_id, id INTO v_tg, v_expect
    FROM public.users WHERE telegram_id IS NOT NULL AND deleted_at IS NULL LIMIT 1;
  IF v_tg IS NULL THEN
    RAISE EXCEPTION '❌ لا حسابَ مربوطاً بتيليجرام — فحصُ البوّابة لا يستطيع أن يبتّ (ولا يُقبل مرورُه صامتاً)';
  END IF;

  v_old := COALESCE(current_setting('request.headers', true), '');

  -- (أ) سالب: ترويساتٌ موجودةٌ بسرٍّ خاطئ ⇒ البوّابةُ مغلقة والهويّةُ لا تُحلّ
  PERFORM set_config('request.headers', '{"x-bot-secret":"definitely-not-the-secret"}', true);
  SELECT public._bot_gate_ok() INTO v_ok;
  IF v_ok THEN RAISE EXCEPTION '❌ البوّابةُ فُتحت بسرٍّ خاطئ'; END IF;
  SELECT public._bot_uid(v_tg, NULL) INTO v_got;
  IF v_got IS NOT NULL THEN
    RAISE EXCEPTION '❌ `_bot_uid` حلّت هويّةً بسرٍّ خاطئ — الانتحالُ ممكن';
  END IF;

  -- (ب) سالب: ترويساتٌ بلا سرٍّ إطلاقاً
  PERFORM set_config('request.headers', '{"accept":"application/json"}', true);
  SELECT public._bot_gate_ok() INTO v_ok;
  IF v_ok THEN RAISE EXCEPTION '❌ البوّابةُ فُتحت بلا سرّ'; END IF;

  -- (ج) موجب: بالسرّ الحقيقيّ (يُقرأ في متغيّرٍ ولا يُطبع قطّ)
  SELECT value INTO v_secret FROM public.app_secrets WHERE key = 'bot_gateway_secret';
  IF COALESCE(v_secret,'') = '' THEN RAISE EXCEPTION '❌ `bot_gateway_secret` مفقودٌ من الخزنة'; END IF;
  PERFORM set_config('request.headers',
            jsonb_build_object('x-bot-secret', v_secret)::text, true);
  SELECT public._bot_gate_ok() INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION '❌ 🔴 البوّابةُ رفضت السرَّ الحقيقيَّ — البوتان معطَّلان'; END IF;
  SELECT public._bot_uid(v_tg, NULL) INTO v_got;
  IF v_got IS DISTINCT FROM v_expect THEN
    RAISE EXCEPTION '❌ 🔴 `_bot_uid` لم تحلّ الهويّةَ بالسرّ الصحيح — البوتان معطَّلان';
  END IF;

  -- (د) ونافذةُ التدوير: السرُّ التالي يُقبَل كذلك حين يوجد
  SELECT value INTO v_next FROM public.app_secrets WHERE key = 'bot_gateway_secret_next';
  IF COALESCE(v_next,'') <> '' THEN
    PERFORM set_config('request.headers',
              jsonb_build_object('x-bot-secret', v_next)::text, true);
    SELECT public._bot_gate_ok() INTO v_ok;
    IF NOT v_ok THEN RAISE EXCEPTION '❌ 🔴 انكسرت نافذةُ تدوير السرّ (`…_next` مرفوض)'; END IF;
    RAISE NOTICE '✅ ③ د نافذةُ التدوير: السرُّ التالي موجودٌ ومقبول';
  ELSE
    RAISE NOTICE 'ℹ️ ③ د لا سرَّ تالياً في الخزنة اليوم — فرعُ النافذة باقٍ في النصّ بلا تغيير';
  END IF;

  -- (هـ) وفرعُ «لا ترويسات» باقٍ: الكرونُ والمشغّلُ يعملان
  PERFORM set_config('request.headers', '', true);
  SELECT public._bot_gate_ok() INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION '❌ 🔴 انكسر نداءُ الكرون/المشغّل من داخل القاعدة';
  END IF;

  PERFORM set_config('request.headers', v_old, true);
  RAISE NOTICE '✅ ③ البوّابة: سالبان ومُوجبان مقيسان على دالّةٍ جسمُها يحمل البوّابة';
END $v04$;


-- ④ `taki_stock_push`: عشرةُ مفاتيحَ مجهولةٍ ⇒ صفٌّ واحدٌ لا عشرة
DO $v05$
DECLARE n0 int; n1 int; i int; v_res jsonb;
BEGIN
  SELECT count(*) INTO n0 FROM public.rate_limit_counters WHERE bucket_key LIKE 'stockpush:%';
  FOR i IN 1..10 LOOP
    PERFORM public.taki_stock_push(
      'selftest-unknown-key-' || i::text || '-aaaaaaaaaaaaaaaaaaaaaaaa', '[]'::jsonb);
  END LOOP;
  SELECT count(*) INTO n1 FROM public.rate_limit_counters WHERE bucket_key LIKE 'stockpush:%';
  IF n1 - n0 > 1 THEN
    RAISE EXCEPTION '❌ عشرةُ مفاتيحَ مختلَقةٍ أنشأت % صفّاً — الحدُّ ما زال قبل التعرّف', n1 - n0;
  END IF;

  -- والردُّ يبقى حرفياً كما كان، فلا تنكسر حافةُ الخطّاف
  v_res := public.taki_stock_push(
             'selftest-unknown-key-x-aaaaaaaaaaaaaaaaaaaaaaaa', '[]'::jsonb);
  IF v_res->>'error' IS DISTINCT FROM 'UNKNOWN_KEY' THEN
    RAISE EXCEPTION '❌ تغيّر ردُّ المفتاح المجهول: %', v_res::text;
  END IF;
  IF (public.taki_stock_push('short', '[]'::jsonb)->>'error') IS DISTINCT FROM 'BAD_KEY' THEN
    RAISE EXCEPTION '❌ تغيّر ردُّ المفتاح القصير';
  END IF;
  RAISE NOTICE '✅ ④ المفاتيحُ المجهولة: صفٌّ واحدٌ مشترك، والردُّ UNKNOWN_KEY كما كان';
END $v05$;


-- ⑤ المنحُ: `f | f` على الثلاثة (PUBLIC و anon و authenticated)
DO $v06$
DECLARE v_pub boolean;
BEGIN
  IF has_function_privilege('authenticated','public.taki_stock_webhook(text,jsonb,text)','EXECUTE') THEN
    RAISE EXCEPTION '❌ taki_stock_webhook ما زالت ممنوحةً لـauthenticated';
  END IF;
  IF has_function_privilege('anon','public.taki_stock_webhook(text,jsonb,text)','EXECUTE') THEN
    RAISE EXCEPTION '❌ taki_stock_webhook ما زالت ممنوحةً لـanon';
  END IF;
  SELECT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                  WHERE p.oid='public.taki_stock_webhook(text,jsonb,text)'::regprocedure
                    AND a.grantee = 0) INTO v_pub;
  IF v_pub THEN RAISE EXCEPTION '❌ taki_stock_webhook ما زالت ممنوحةً لـPUBLIC'; END IF;

  -- والمنادي الحقيقيُّ (دالّةُ الحافة) يعمل: `service_role`
  IF NOT has_function_privilege('service_role','public.taki_stock_webhook(text,jsonb,text)','EXECUTE') THEN
    RAISE EXCEPTION '❌ 🔴 انكسرت دالّةُ الحافة: service_role لم يبقَ له تنفيذٌ على taki_stock_webhook';
  END IF;

  IF has_function_privilege('anon','public.merchant_set_payment_declaration(boolean)','EXECUTE') THEN
    RAISE EXCEPTION '❌ merchant_set_payment_declaration ما زالت ممنوحةً لـanon';
  END IF;
  SELECT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                  WHERE p.oid='public.merchant_set_payment_declaration(boolean)'::regprocedure
                    AND a.grantee = 0) INTO v_pub;
  IF v_pub THEN RAISE EXCEPTION '❌ merchant_set_payment_declaration ما زالت ممنوحةً لـPUBLIC'; END IF;
  -- ولوحةُ التاجر تعمل
  IF NOT has_function_privilege('authenticated','public.merchant_set_payment_declaration(boolean)','EXECUTE') THEN
    RAISE EXCEPTION '❌ 🔴 انكسرت لوحةُ التاجر: authenticated فقد التنفيذ على merchant_set_payment_declaration';
  END IF;
  RAISE NOTICE '✅ ⑤ المنحُ: الثلاثةُ مسحوبةٌ، والمنادي المشروعُ باقٍ';
END $v06$;


-- ⑥ قلبُ الجلسة: سالبٌ (جلسةُ غيري) وموجبٌ (جلسةٌ مجهولة) — ويُلفَّان
--    في معاملةٍ فرعيّةٍ تُلغى، فلا يبقى صفُّ اختبارٍ واحد.
DO $v07$
DECLARE v_old_j text; v_other text; v_b boolean;
BEGIN
  v_old_j := COALESCE(current_setting('request.jwt.claims', true), '');
  SELECT id INTO v_other FROM public.users
   WHERE deleted_at IS NULL AND id ~ '^[0-9a-fA-F-]{36}$' LIMIT 1;
  IF v_other IS NULL THEN
    RAISE EXCEPTION '❌ لا مستخدمَ بمعرّفٍ صالحٍ للاختبار — الفحصُ لا يبتّ';
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);   -- زائرٌ مجهول

    INSERT INTO public.site_sessions (session_id, landing_path, last_path, user_id)
    VALUES ('v1579-selftest-owned', '/', '/', v_other);
    PERFORM public.taki_mark_session_booked('v1579-selftest-owned');
    SELECT booked INTO v_b FROM public.site_sessions WHERE session_id = 'v1579-selftest-owned';
    IF v_b THEN
      RAISE EXCEPTION 'SELFTEST_FAIL: زائرٌ مجهولٌ قلب جلسةَ مستخدمٍ مسجَّل';
    END IF;

    INSERT INTO public.site_sessions (session_id, landing_path, last_path)
    VALUES ('v1579-selftest-anon', '/', '/');
    PERFORM public.taki_mark_session_booked('v1579-selftest-anon');
    SELECT booked INTO v_b FROM public.site_sessions WHERE session_id = 'v1579-selftest-anon';
    IF NOT v_b THEN
      RAISE EXCEPTION 'SELFTEST_FAIL: كُسر قياسُ التحويل للجلسة المجهولة';
    END IF;

    RAISE EXCEPTION 'SELFTEST_ROLLBACK';   -- يُلغي صفَّي الاختبار
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SELFTEST_ROLLBACK' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claims', v_old_j, true);
  RAISE NOTICE '✅ ⑥ قلبُ الجلسة: جلسةُ مستخدمٍ محميّة، والجلسةُ المجهولة تُقلَب';
END $v07$;


-- ⑦ شكلُ التقييمات: لا معرّفَ هويّةٍ، والبديلُ البوليانيّ موجود
DO $v08$
DECLARE v_store text; v_res jsonb; v_row jsonb; k text;
BEGIN
  SELECT d.store_id INTO v_store
    FROM public.ratings rt JOIN public.deals d ON d.id = rt.deal_id
   WHERE rt.deleted_at IS NULL LIMIT 1;
  IF v_store IS NULL THEN
    RAISE EXCEPTION '❌ لا تقييمَ حيّاً — الفحصُ لا يستطيع أن يبتّ (ولا يُقبل مرورُه صامتاً)';
  END IF;

  v_res := public.browse_store_ratings(v_store, NULL, NULL, 5);
  IF COALESCE((v_res->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION '❌ browse_store_ratings ردّت: %', v_res::text;
  END IF;
  IF jsonb_array_length(v_res->'rows') = 0 THEN
    RAISE EXCEPTION '❌ صفرُ صفٍّ لمتجرٍ له تقييم — الفحصُ لا يبتّ';
  END IF;
  v_row := v_res->'rows'->0;

  FOREACH k IN ARRAY ARRAY['user_id','liked_by','replied_by','deleted_at'] LOOP
    IF v_row ? k THEN RAISE EXCEPTION '❌ ما زال الشكلُ يُسلّم العمود «%»', k; END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['id','deal_id','user_name','score','comment','created_at',
                           'reply','replied_at','like_count','item_name',
                           'is_mine','liked_by_me'] LOOP
    IF NOT (v_row ? k) THEN RAISE EXCEPTION '❌ سقط المفتاحُ «%» فتُفرَّغ شاشة', k; END IF;
  END LOOP;
  -- والمؤشّرُ الذي تبني عليه الواجهةُ الصفحةَ التالية باقٍ
  IF (v_row->>'created_at') IS NULL OR (v_row->>'id') IS NULL THEN
    RAISE EXCEPTION '❌ انكسر الترقيم: المؤشّرُ (created_at/id) غائب';
  END IF;

  v_res := public.browse_deal_ratings((v_row->>'deal_id'), NULL, NULL, 5);
  IF COALESCE((v_res->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION '❌ browse_deal_ratings ردّت: %', v_res::text;
  END IF;
  IF jsonb_array_length(v_res->'rows') > 0 AND (v_res->'rows'->0 ? 'user_id') THEN
    RAISE EXCEPTION '❌ browse_deal_ratings ما زالت تُسلّم user_id';
  END IF;
  RAISE NOTICE '✅ ⑦ شكلُ التقييمات: صفرُ معرّفِ هويّة، واثنتا عشرةَ مفتاحاً باقية';
END $v08$;


-- ⑧ سياساتُ التخزين: الحارسان موجودان · والأدوارُ كما كانت · والهجومُ يُرفض
DO $v09$
DECLARE r record; v_attack text := 'BC12345/../../deals/u1/x.jpg'; n int := 0;
BEGIN
  FOR r IN
    SELECT p.polname,
           COALESCE((SELECT string_agg(ro.rolname, ',' ORDER BY ro.rolname)
                       FROM pg_roles ro WHERE ro.oid = ANY(p.polroles)), 'PUBLIC') AS roles,
           pg_get_expr(p.polwithcheck, p.polrelid) AS chk
      FROM pg_policy p
     WHERE p.polrelid = 'storage.objects'::regclass
       AND p.polname IN ('chat_write_members','complaints_files_write')
  LOOP
    n := n + 1;
    IF r.roles <> 'authenticated' THEN
      RAISE EXCEPTION '❌ أدوارُ % صارت «%» بدل authenticated — v14.38', r.polname, r.roles;
    END IF;
    IF r.chk !~ '\\\.\\\.' AND r.chk !~ 'name !~' THEN
      RAISE EXCEPTION '❌ % بلا حارسِ `..`', r.polname;
    END IF;
    IF r.chk !~ 'array_length\(string_to_array\(name' THEN
      RAISE EXCEPTION '❌ % بلا حدِّ عددِ المقاطع', r.polname;
    END IF;
    -- 🪤 الإبرةُ تحتمل الصيغتين: نكتب `auth.uid()` في الهجرة، و PostgreSQL
    --    يُعيد التعبيرَ المخزَّن **غيرَ مؤهَّل** (`(owner = uid())`) لأن
    --    `search_path` لسياسات `storage.objects` يحوي `auth`. وإبرةٌ تطلب
    --    `auth.uid()` حرفياً تتّهم سياسةً سليمة — وهذا ما وقع فعلاً في أوّل
    --    تجربةٍ مُرجَعة: «سقط شرطُ المالك» والشرطُ قائمٌ كما كُتب.
    IF r.chk !~ 'owner = (auth\.)?uid\(\)' THEN
      RAISE EXCEPTION '❌ سقط شرطُ المالك من %', r.polname;
    END IF;
  END LOOP;
  IF n <> 2 THEN RAISE EXCEPTION '❌ وُجدت % سياسةً بدل اثنتين', n; END IF;

  -- وشرطُها الأصليُّ لم يُفقد
  IF (SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy
       WHERE polrelid='storage.objects'::regclass AND polname='chat_write_members')
     !~ 'taki_chat_member' THEN
    RAISE EXCEPTION '❌ سقط `taki_chat_member` من سياسة المحادثة';
  END IF;
  IF (SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy
       WHERE polrelid='storage.objects'::regclass AND polname='complaints_files_write')
     !~ 'split_part\(name' THEN
    RAISE EXCEPTION '❌ سقط شرطُ المجلّد من سياسة الشكاوى';
  END IF;

  -- والمنطقُ نفسُه يَرفض مسارَ الهجوم، ويَقبل المسارَ المشروع
  IF v_attack !~ '\.\.' THEN RAISE EXCEPTION '❌ حارسُ `..` لا يُمسك %', v_attack; END IF;
  IF array_length(string_to_array(v_attack, '/'), 1) = 2 THEN
    RAISE EXCEPTION '❌ حدُّ المقاطع لا يُمسك %', v_attack;
  END IF;
  IF array_length(string_to_array('BC12345/8f1e.jpg', '/'), 1) <> 2 THEN
    RAISE EXCEPTION '❌ المسارُ المشروعُ للمحادثة صار مرفوضاً';
  END IF;
  IF array_length(string_to_array('u1/c1/8f1e.pdf', '/'), 1) <> 3 THEN
    RAISE EXCEPTION '❌ المسارُ المشروعُ للشكوى صار مرفوضاً';
  END IF;
  RAISE NOTICE '✅ ⑧ سياساتُ التخزين: الحارسان · الأدوارُ · والهجومُ مرفوضٌ بالمنطق';
END $v09$;


-- ⑨ وعدُ الحذف: كلُّ جدولٍ في القائمة مذكورٌ **في جسم** الدالّة، وهي تعمل
DO $v10$
DECLARE src text; t text; n int;
BEGIN
  -- 🪤 يُجرَّد التعليقُ أوّلاً وإلّا شهد الحارسُ بتعليقه هو (v14.97 · v15.22)
  src := regexp_replace(pg_get_functiondef('public.purge_expired_accounts()'::regprocedure),
                        '--[^\n]*', '', 'g');
  FOREACH t IN ARRAY ARRAY[
      -- (هـ) يُحذف
      'analytics_events','store_analytics_events','site_sessions','user_sessions',
      'favorites','deal_authenticity_votes','promo_impressions','pending_warnings',
      'telegram_link_tokens',
      -- (و) يبقى الصفُّ ويذهب النصّ
      'complaints','complaint_replies','reports','moderation_flags','user_warnings',
      'activity_log','admin_impersonation_log','store_profiles',
      -- وما كان قائماً قبل اليوم — فلا يُسقطه تعديلٌ لاحق
      'user_addresses','push_subscriptions','delivery_tracks','email_outbox',
      'notifications','ratings','contest_entries','store_verifications',
      'booking_messages','bookings'] LOOP
    IF src !~ ('public\.' || t) THEN
      RAISE EXCEPTION '❌ `purge_expired_accounts` لا تمسّ «%» — ووعدُ المحو منشورٌ', t;
    END IF;
  END LOOP;

  -- ولا يُقبل نصٌّ وحده: تُنفَّذ فعلاً. وهي **نفسُ** عمليّةِ كرون ٤٩
  -- (١:٠٥ يومياً) ولا تمسّ إلا ما حلّ أجلُه (قِيس اليومَ: صفرُ حسابٍ منتظر).
  SELECT public.purge_expired_accounts() INTO n;
  IF n IS NULL THEN RAISE EXCEPTION '❌ `purge_expired_accounts` لم تُنفَّذ'; END IF;
  RAISE NOTICE '✅ ⑨ وعدُ الحذف: ٢٦ جدولاً مذكورٌ، والدالّةُ نُفّذت (% حساباً)', n;
END $v10$;


-- ⑩ الموافقةُ تَعضُّ على الخادم، والإحداثيّاتُ مُدوَّرة
DO $v11$
DECLARE
  v_old_j text; v_u text; n0 int; n1 int; v_lat double precision;
BEGIN
  v_old_j := COALESCE(current_setting('request.jwt.claims', true), '');

  -- (أ) التدويرُ — يُقاس بالنداء لا بقراءة النصّ، والصفُّ يُلغى بعده
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM public.track_app_open('web', 26.3731090635167, 50.0858495443724);
    SELECT lat INTO v_lat FROM public.analytics_events ORDER BY id DESC LIMIT 1;
    IF v_lat IS NULL OR abs(v_lat - 26.37) > 1e-9 THEN
      RAISE EXCEPTION 'SELFTEST_FAIL: الإحداثيّةُ خُزّنت % بدل 26.37', COALESCE(v_lat::text,'NULL');
    END IF;
    RAISE EXCEPTION 'SELFTEST_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SELFTEST_ROLLBACK' THEN RAISE; END IF;
  END;

  -- (ب) الموافقةُ: سالبٌ (موقوفٌ ⇒ لا صفّ) وموجبٌ (مفعَّلٌ ⇒ صفّ)
  SELECT id INTO v_u FROM public.users
   WHERE deleted_at IS NULL AND id ~ '^[0-9a-fA-F-]{36}$' LIMIT 1;
  IF v_u IS NULL THEN
    RAISE EXCEPTION '❌ لا مستخدمَ بمعرّفٍ صالحٍ — فحصُ الموافقة لا يبتّ';
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub', v_u, 'role', 'authenticated')::text, true);

    UPDATE public.users SET analytics_opt_out = true WHERE id = v_u;
    SELECT count(*) INTO n0 FROM public.analytics_events;
    PERFORM public.track_search('zz-selftest-optout-zz');
    SELECT count(*) INTO n1 FROM public.analytics_events;
    IF n1 <> n0 THEN
      RAISE EXCEPTION 'SELFTEST_FAIL: القياسُ كتب صفّاً لمستخدمٍ أوقف القياس';
    END IF;

    UPDATE public.users SET analytics_opt_out = false WHERE id = v_u;
    PERFORM public.track_search('zz-selftest-optin-yy');
    SELECT count(*) INTO n1 FROM public.analytics_events;
    IF n1 <> n0 + 1 THEN
      RAISE EXCEPTION 'SELFTEST_FAIL: كُسر القياسُ لمن لم يوقفه (% ⇐ %)', n0, n1;
    END IF;

    RAISE EXCEPTION 'SELFTEST_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SELFTEST_ROLLBACK' THEN RAISE; END IF;
  END;

  -- (ج) والكتّابُ الخمسةُ كلُّهم يسألون العمودَ — تجريدُ التعليق أوّلاً
  IF (SELECT count(*) FROM (
        SELECT unnest(ARRAY[
          'public.track_app_open(text,double precision,double precision)',
          'public.track_search(text,text)',
          'public.record_analytics_events(jsonb)',
          'public.bot_track_open(bigint,text)',
          'public.track_site_visit(text,text,text,jsonb,text,boolean,text)']) AS f) s
       WHERE regexp_replace(pg_get_functiondef(s.f::regprocedure), '--[^\n]*', '', 'g')
             ~ 'analytics_opt_out') <> 5 THEN
    RAISE EXCEPTION '❌ ليس كلُّ الكتّاب الخمسة يسأل `analytics_opt_out`';
  END IF;

  -- (د) ولا صفَّ قديماً بدقّةٍ أعلى من خانتين
  SELECT count(*) INTO n0 FROM public.analytics_events
   WHERE (lat IS NOT NULL AND lat <> round(lat::numeric,2)::double precision)
      OR (lng IS NOT NULL AND lng <> round(lng::numeric,2)::double precision);
  IF n0 <> 0 THEN RAISE EXCEPTION '❌ بقي % صفّاً بإحداثيّةٍ كاملة الدقّة', n0; END IF;

  PERFORM set_config('request.jwt.claims', v_old_j, true);
  RAISE NOTICE '✅ ⑩ الموافقةُ تَعضُّ على الخادم (سالبٌ وموجب)، والإحداثيّاتُ خانتان';
END $v11$;


-- ─────────────────────────── جدولُ القراءة ───────────────────────────
-- (للعين وحدها — وكلُّ ما يَبتُّ سبقه أعلاه)
SELECT 'الخادم' AS بند,
       COALESCE(obj_description('public'::regnamespace,'pg_namespace'), 'جدة — الإنتاج') AS قيمة
UNION ALL SELECT '① عنوانُ العميل: وسائطُ وكلائنا تُسقَط',
  CASE WHEN regexp_replace(pg_get_functiondef('public._taki_client_ip()'::regprocedure),
                           '--[^\n]*','','g') ~ 'c_hops' THEN '✅' ELSE '❌' END
UNION ALL SELECT '① سجلُّ الموافقة من مصدرٍ واحد',
  CASE WHEN regexp_replace(pg_get_functiondef(
         'public.record_user_consent(text,text,text,text,integer)'::regprocedure),
         '--[^\n]*','','g') !~ 'split_part' THEN '✅' ELSE '❌' END
UNION ALL SELECT '② الحدُّ يَفشل مغلقاً (الدالّتان)',
  CASE WHEN regexp_replace(pg_get_functiondef('public.find_email_by_phone(text)'::regprocedure),
                           '--[^\n]*','','g') !~ 'IF v_ip IS NOT NULL'
        AND regexp_replace(pg_get_functiondef('public.account_exists(text,text)'::regprocedure),
                           '--[^\n]*','','g') !~ 'IF v_ip IS NOT NULL'
       THEN '✅' ELSE '❌' END
UNION ALL SELECT '② دلوُ الرقم قائم',
  CASE WHEN regexp_replace(pg_get_functiondef('public.find_email_by_phone(text)'::regprocedure),
                           '--[^\n]*','','g') ~ 'fepph:' THEN '✅' ELSE '❌' END
UNION ALL SELECT '③ بوّابةُ البوت تَفشل مغلقةً',
  CASE WHEN regexp_replace(pg_get_functiondef('public._bot_gate_ok()'::regprocedure),
                           '--[^\n]*','','g') !~ 'bot_gate_enforced' THEN '✅' ELSE '❌' END
UNION ALL SELECT '③ ولا صفَّ تعطيلٍ في الخزنة',
  CASE WHEN NOT EXISTS (SELECT 1 FROM public.app_secrets WHERE key='bot_gate_bypass')
       THEN '✅' ELSE '❌' END
UNION ALL SELECT '④ التعرّفُ قبل الحدّ في taki_stock_push',
  CASE WHEN strpos(regexp_replace(pg_get_functiondef(
              'public.taki_stock_push(text,jsonb,timestamptz,text)'::regprocedure),
              '--[^\n]*','','g'), 'stock_integrations')
          < strpos(regexp_replace(pg_get_functiondef(
              'public.taki_stock_push(text,jsonb,timestamptz,text)'::regprocedure),
              '--[^\n]*','','g'), 'taki_rate_check')
       THEN '✅' ELSE '❌' END
UNION ALL SELECT '⑤ taki_stock_webhook: anon | authenticated',
  has_function_privilege('anon','public.taki_stock_webhook(text,jsonb,text)','EXECUTE')::text
  || ' | ' ||
  has_function_privilege('authenticated','public.taki_stock_webhook(text,jsonb,text)','EXECUTE')::text
UNION ALL SELECT '⑤ merchant_set_payment_declaration: anon | authenticated',
  has_function_privilege('anon','public.merchant_set_payment_declaration(boolean)','EXECUTE')::text
  || ' | ' ||
  has_function_privilege('authenticated','public.merchant_set_payment_declaration(boolean)','EXECUTE')::text
UNION ALL SELECT '⑥ taki_mark_session_booked باقيةٌ للزائر (v15.78)',
  CASE WHEN has_function_privilege('anon','public.taki_mark_session_booked(text)','EXECUTE')
       THEN '✅' ELSE '❌' END
UNION ALL SELECT '⑦ شكلُ التقييمات بلا rt.*',
  CASE WHEN regexp_replace(pg_get_functiondef(
         'public.browse_store_ratings(text,timestamptz,text,integer)'::regprocedure),
         '--[^\n]*','','g') !~ 'rt\.\*' THEN '✅' ELSE '❌' END
UNION ALL SELECT '⑧ حارسا المسار على chat و complaints',
  CASE WHEN (SELECT count(*) FROM pg_policy
              WHERE polrelid='storage.objects'::regclass
                AND polname IN ('chat_write_members','complaints_files_write')
                AND pg_get_expr(polwithcheck, polrelid) ~ 'array_length\(string_to_array\(name') = 2
       THEN '✅' ELSE '❌' END
UNION ALL SELECT '⑨ جداولُ المحو المذكورة في جسم purge',
  (SELECT count(*)::text FROM (
     SELECT unnest(ARRAY['analytics_events','store_analytics_events','site_sessions',
       'user_sessions','favorites','deal_authenticity_votes','promo_impressions',
       'pending_warnings','telegram_link_tokens','complaints','complaint_replies',
       'reports','moderation_flags','user_warnings','activity_log',
       'admin_impersonation_log','store_profiles']) AS t) s
   WHERE regexp_replace(pg_get_functiondef('public.purge_expired_accounts()'::regprocedure),
                        '--[^\n]*','','g') ~ ('public\.' || s.t))
  || ' / 17'
UNION ALL SELECT '⑩ إحداثيّاتٌ بدقّةٍ كاملةٍ باقية',
  (SELECT count(*)::text FROM public.analytics_events
    WHERE (lat IS NOT NULL AND lat <> round(lat::numeric,2)::double precision)
       OR (lng IS NOT NULL AND lng <> round(lng::numeric,2)::double precision));


-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK — إعادةُ كلِّ شيءٍ إلى نصّه الحيّ قبل v15.79
--
-- ⚠️ وهذا تراجعٌ **إلى حالةٍ تَفشل مفتوحةً**: بوّابةُ البوت تعود إلى
--    الافتراض الذي يُفتحها عند فقدان صفٍّ من الخزنة، والحدودُ تعود إلى
--    السقوط بلا حدٍّ عند غياب العنوان. لا يُشغَّل إلا لإنهاء عطلٍ قائم.
-- ⚠️ ولا يُستعاد شيئان: الإحداثيّاتُ المُدوَّرة (الدقّةُ الأصليّةُ ذهبت —
--    وهو المقصود)، وما محاه `purge_expired_accounts` إن كان قد عمل.
--
-- ─── ① عنوانُ العميل وسجلُّ الموافقة ───
-- CREATE OR REPLACE FUNCTION public._taki_client_ip()
--  RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
-- AS $$
--   SELECT nullif(
--            split_part(
--              coalesce(
--                nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for',
--                ''),
--              ',', 1),
--            '');
-- $$;
--   (وفي `record_user_consent` يُعاد موضعُ `v_ip` إلى:
--      BEGIN
--        v_ip := NULLIF(split_part(COALESCE(
--          current_setting('request.headers', true)::json->>'x-forwarded-for',
--          current_setting('request.headers', true)::json->>'x-real-ip', ''), ',', 1), '');
--      EXCEPTION WHEN OTHERS THEN v_ip := NULL; END;
--      v_ip := COALESCE(btrim(v_ip), NULLIF(btrim(COALESCE(p_ip, '')), ''));
--    وبقيّةُ الجسم كما هي في هذا الملفّ.)
--
-- ─── ② الحدُّ يعود يَفشل مفتوحاً ───
--   في `find_email_by_phone` و`account_exists`: يُلفّ الفحصان مرّةً أخرى بـ
--      IF v_ip IS NOT NULL THEN … END IF;
--   وتُحذف `COALESCE(v_ip,'noip')` وسطرُ `fepph:` كاملاً.
--
-- ─── ③ بوّابةُ البوت ───
-- CREATE OR REPLACE FUNCTION public._bot_gate_ok()
--  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
-- AS $$
--   SELECT
--     COALESCE((SELECT value FROM public.app_secrets WHERE key = 'bot_gate_enforced'), '0') <> '1'
--     OR current_setting('request.headers', true) IS NULL
--     OR current_setting('request.headers', true) = ''
--     OR EXISTS (
--       SELECT 1 FROM public.app_secrets
--       WHERE key IN ('bot_gateway_secret', 'bot_gateway_secret_next')
--         AND value IS NOT NULL AND value <> ''
--         AND value = (current_setting('request.headers', true)::json ->> 'x-bot-secret')
--     );
-- $$;
--
-- ─── ④ `taki_stock_push` ───
--   يُعاد ترتيبُ الجسم: بعد `v_hash` يُنادى مباشرةً
--     PERFORM public.taki_rate_check('stockpush:' || left(v_hash, 16), 120, 60,
--                                    'too many stock pushes — slow down');
--   ثمّ `SELECT id INTO v_id …` ثمّ `IF v_id IS NULL THEN RETURN … 'UNKNOWN_KEY'`،
--   وتُحذف كتلةُ الدلو المشترك.
--
-- ─── ⑤ المنح ───
-- GRANT EXECUTE ON FUNCTION public.taki_stock_webhook(text, jsonb, text) TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.merchant_set_payment_declaration(boolean) TO anon;
--
-- ─── ⑥ قلبُ الجلسة ───
-- CREATE OR REPLACE FUNCTION public.taki_mark_session_booked(p_session text)
--  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
-- AS $$
-- BEGIN
--     UPDATE public.site_sessions SET booked = true, last_seen_at = now()
--      WHERE session_id = left(btrim(COALESCE(p_session,'')), 64);
-- END $$;
--
-- ─── ⑦ التقييمات ───
--   في الدالّتين يُعاد `SELECT rt.*, d.item_name` (و`SELECT rt.*` في دالّة
--   العرض)، ويُحذف `v_me` و`is_mine` و`liked_by_me`.
--   🔴 ولا يُتراجَع عنه إلا مع تراجعٍ مقابلٍ في الواجهة، وإلّا بقيت الشاشةُ
--      تقرأ `is_mine` الغائبةَ فيَظهر كلُّ تقييمٍ «ليس لي».
--
-- ─── ⑧ سياساتُ التخزين ───
-- DROP POLICY IF EXISTS chat_write_members ON storage.objects;
-- CREATE POLICY chat_write_members ON storage.objects FOR INSERT TO authenticated
--   WITH CHECK ((bucket_id = 'chat'::text) AND public.taki_chat_member(name)
--               AND (owner = auth.uid()));
-- DROP POLICY IF EXISTS complaints_files_write ON storage.objects;
-- CREATE POLICY complaints_files_write ON storage.objects FOR INSERT TO authenticated
--   WITH CHECK ((bucket_id = 'complaints'::text)
--               AND (split_part(name, '/'::text, 1) = (auth.uid())::text)
--               AND (owner = auth.uid()));
--
-- ─── ⑨ المحو ───
--   تُحذف الكتلتان (هـ) و(و) و(ز) من `purge_expired_accounts` ويبقى ما قبلها.
--
-- ─── ⑩ القياس ───
--   تُحذف كتلةُ `analytics_opt_out` من الخمسة، ويُعاد
--     v_lat := CASE WHEN p_lat BETWEEN -90 AND 90 THEN p_lat END;
--   (و`SELECT u.lat, u.lng INTO v_lat, v_lng` في `bot_track_open`).
--
-- NOTIFY pgrst, 'reload schema';
-- ════════════════════════════════════════════════════════════════════════
