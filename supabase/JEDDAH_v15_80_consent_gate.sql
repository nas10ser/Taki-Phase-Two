-- ════════════════════════════════════════════════════════════════════════
-- TAKI · v15.80 — سجلُّ الموافقة: يُصلَح الكاذبُ منه، ويصير **أوّلَ كتابةٍ
--                 تُحفَظ**، ويُمنَع صاحبُه من تحريره
--
-- تُشغَّل على **جدة (الإنتاج)** بالدور `supabase_admin` (هو مالكُ
-- `record_user_consent` — و`postgres` يفشل بـ`must be owner of function`).
-- آمنةٌ للتكرار · كلُّ عبارةٍ فيها تعمل داخل معاملةٍ واحدة (لا `CONCURRENTLY`
-- ولا `ALTER TYPE`).
--
-- ───────────────────────── لماذا، ومقيساً على جدة (٨ نوفمبر ٢٠٢٦) ─────────
-- العنوانُ الذي وصلني كان «الدخولُ بقوقل/أبل يُنشئ حساباً بلا موافقة». وهو
-- **ليس حيّاً**: `oauth_google_enabled=false` و`oauth_apple_enabled=false`،
-- وGoTrue بلا مزوّدٍ منهما، وستّةُ الحسابات كلُّها `email`. والعيبُ الحقيقيّ
-- أوسعُ من ذلك ولا يتعلّق بمزوّدٍ بعينه:
--      • صفرٌ من ٦ حسابات يحمل موافقةً على `LEGAL_VERSION` الحاليّ
--      • صفرٌ من ٦ يحمل إقرارَ السنّ الذي تَنصّ عليه الشروط §٣ والخصوصيّة §١١
--      • صفرٌ من ٦ يحمل العنوانَ الذي تُسمّيه الشروط §٢ «دليلاً نظاميّاً»
--      • ٣ من ٦ بلا أيّ سجلٍّ إطلاقاً
--      • و٢ من ٦ يحملان سجلّاً **كاذباً**: الدالّةُ القديمة ذاتُ الوُسطاء
--        الثلاثة كتبت `merchant-gateway-agreement-v1` في خانةِ **الشروط**،
--        وv14.19 لم تُصلحه. (قِيس: `gateway_agreement_version` فارغٌ عند
--        الستّة جميعاً، و`consent_privacy_at`/`consent_refund_at` عند
--        الاثنين تحملان لحظةَ قبولِ اتفاقيّةِ البوّابة لا الشروط.)
--      • وأيُّ مستخدمٍ موثَّق يستطيع **تلفيقَ أو محوَ** سجلِّ موافقته بنداءِ
--        PATCH واحد: `authenticated` يملك UPDATE على الأعمدة العشرة،
--        وسياسةُ `users_update_admin` تسمح `uid()::text = id`، وصفرٌ من
--        أربعةَ عشرَ مشغّلاً على `public.users` يحرسها (قِيس بتجريد التعليقات).
--
-- والسببُ الجذريّ: الموافقةَ تُسجّلها **الشاشةُ** التي تُنشئ الحساب، لا
-- النظامُ الذي يملكه. وموضعُ ميلادِ صفِّ `public.users` **واحدٌ** هو
-- `handle_new_user` (ولا يمسّ الموافقةَ إطلاقاً — قِيس `f`)، بينما ثلاثُ
-- شاشاتٍ كلٌّ منها مسؤولةٌ عن أن «تتذكّر». فاثنتان تذكّرتا، ومسارُ OAuth لم
-- يتذكّر قطّ، وشاشةُ «أكمل بياناتك» — التي يُمرّ بها كلُّ قادمٍ من OAuth —
-- بلا كودِ موافقةٍ أصلاً. والتعليقُ في `Register.tsx:770` يَعِد بإعادةِ
-- محاولةٍ «عند الدخول القادم» و`grep` يُثبت أنها **لم تُكتَب أبداً**.
--
-- ⚠️ ولا تُعبّأ موافقةٌ لأحدٍ رجعيّاً: موافقةٌ لم يُعطِها صاحبُها أسوأُ من
--    غيابها (درس v14.82). ولذلك يجب أن يكون `on_current = 0` بعد هذه الهجرة
--    بالضبط كما كان قبلها — ومن يوافق، يوافق من الشاشة.
--
-- ⚠️ وترتيبُ التشغيل: إن شُغّلت هجرةٌ أخرى تمسّ `record_user_consent` أو
--    سياسةَ `platform_settings_select` في نفس اليوم، تُشغَّل هذه **بعدها** —
--    فهي تبني كلتيهما من **نصّهما الحيّ** لا من نسخةٍ مكتوبةٍ هنا.
-- ════════════════════════════════════════════════════════════════════════

-- ① حارسُ المختبر — أوّلُ عبارةٍ دائماً
DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION '⛔ هذه هجرةُ إنتاج (جدة) — ومُنعت على مختبر طوكيو.';
  END IF;
END $guard$;

-- ② شروطٌ مسبقةٌ تُفشل الهجرةَ لا تُحذّر
--
-- 🪤 (أ) الرمزُ `P0032` يجب أن يكون حرّاً. أربعةُ وكلاءٍ يعدّلون هذا المستودعَ
--        اليوم، ورمزٌ مُستهلَكٌ مرّتين يجعل كلَّ منادٍ يفرّع على الخطأ الخطأ.
-- 🪤 (ب) والرايةُ `taki.consent_write` يجب أن تكون **غيرَ مرفوعةٍ** في أوّل
--        الجلسة. وهي رايةٌ محلّيّةُ المعاملة (`set_config(...,true)`) — أي أن
--        أيَّ نداءٍ لـ`record_user_consent` داخل هذه الهجرة يرفعها لبقيّة
--        المعاملة كلِّها. ولذلك كلُّ فحصٍ أدناه يجري داخل كتلةٍ فرعيّةٍ تُلغى،
--        فتُلغى معها الرايةُ ودورُ الجلسة (قِيس).
DO $pre$
DECLARE v_other text; v_flag text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_other
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname <> 'taki_guard_user_consent'
     AND regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') LIKE '%P0032%';
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION '❌ الرمز P0032 مُستعمَلٌ أصلاً في: % — اختر رمزاً آخرَ قبل الشحن.', v_other;
  END IF;

  v_flag := current_setting('taki.consent_write', true);
  IF COALESCE(v_flag, '') <> '' THEN
    RAISE EXCEPTION '❌ الرايةُ taki.consent_write مرفوعةٌ قبل أن نبدأ (%) — الفحوصُ أدناه كانت ستمرّ كاذبةً.', v_flag;
  END IF;

  RAISE NOTICE '✅ ② P0032 حرٌّ · والرايةُ غيرُ مرفوعة';
END $pre$;

-- ③ إصلاحُ السجلّين الكاذبين — **نقلٌ لا اختراع**
--
-- العددُ يُقاس في نفس الجلسة ولا يُحمَل من قياسِ أمس: تاجرٌ يقبل اتفاقيّةَ
-- البوّابة قبل التشغيل يُغيّره (درسُ «لا تُصدّق الـ٢»). والشرطُ
-- `gateway_agreement_version IS NULL` يجعلها آمنةً للتكرار: ما نُقل مرّةً
-- لا يُنقل ثانية.
DO $repair$
DECLARE v_expect int; v_moved int; v_left int; v_before int; v_after int;
BEGIN
  SELECT count(*) INTO v_expect FROM public.users
   WHERE consent_terms_version = 'merchant-gateway-agreement-v1'
     AND gateway_agreement_version IS NULL;
  SELECT count(*) INTO v_before FROM public.users WHERE consent_terms_version IS NOT NULL;

  UPDATE public.users
     SET gateway_agreement_version = consent_terms_version,
         gateway_agreement_at      = consent_terms_at,
         consent_terms_version     = NULL,
         consent_terms_at          = NULL,
         -- قِيس أنّ هاتين تحملان لحظةَ قبولِ اتفاقيّةِ البوّابة نفسِها
         -- (مطابقةً لـ`consent_terms_at` إلى الميكروثانية) — فهما جزءٌ من
         -- السجلِّ الكاذب لا موافقةٌ مستقلّة.
         consent_privacy_at        = NULL,
         consent_refund_at         = NULL
   WHERE consent_terms_version = 'merchant-gateway-agreement-v1'
     AND gateway_agreement_version IS NULL;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  IF v_moved <> v_expect THEN
    RAISE EXCEPTION '❌ قِيس % صفّاً للإصلاح ونُقل % — لا تُكمل على فرقٍ لا يُفسَّر.', v_expect, v_moved;
  END IF;

  SELECT count(*) INTO v_left FROM public.users
   WHERE consent_terms_version = 'merchant-gateway-agreement-v1';
  IF v_left <> 0 THEN
    RAISE EXCEPTION '❌ بقي % صفّاً يحمل إصدارَ اتفاقيّةِ البوّابة في خانةِ الشروط', v_left;
  END IF;

  -- 🔴 ولا موافقةَ مُختَرعة: عددُ من يحمل إصدارَ موافقةٍ يجب أن **ينقص**
  --    بعددِ المنقول بالضبط — لا يزيد صفّاً واحداً. (قِيس قبل التشغيل: ٣
  --    ⇒ ١، وهو الصفُّ القديم على '2026-05-20' ولا يُمسّ.)
  SELECT count(*) INTO v_after FROM public.users WHERE consent_terms_version IS NOT NULL;
  IF v_after <> v_before - v_moved THEN
    RAISE EXCEPTION '❌ عددُ حاملي إصدارِ الموافقة % ⇐ % مع نقلِ % — شيءٌ عبّأ أو محا ما لم يُقصَد', v_before, v_after, v_moved;
  END IF;

  RAISE NOTICE '✅ ③ السجلّاتُ الكاذبة: قِيس % · نُقل % · باقٍ صفر · وحاملو إصدارٍ % ⇐ %', v_expect, v_moved, v_before, v_after;
END $repair$;

-- ④ `record_user_consent` تصير **آمنةً للتكرار** وتحفظ أوّلَ كتابة
--
-- نفسُ البصمة بالضبط ⇒ `CREATE OR REPLACE` وحدها، **ولا وسيطٌ جديد**: وسيطٌ
-- جديد يُنشئ حِملاً ثانياً فيموت كلُّ منادٍ بـ«function is not unique»
-- (درس v14.25). والمنادون الثلاثة: `src/services/authService.ts`
-- (مسارُ الموافقة الوحيد في الموقع) و`src/components/ConsentGate.tsx` عبره
-- و`src/components/seller/GatewayCard.tsx:227` بـ`p_kind:'gateway'`.
--
-- 🔴 وموضعُ رفعِ الراية هو العيبُ الذي كان سيُشحَن: فرعُ `gateway` يُحدّث
--    `gateway_agreement_*` **ويعود** قبل تحديثِ الشروط. فرفعُها قبل تحديثِ
--    الشروط وحده كان سيجعل حارسَ ④ يرفض نداءَ `GatewayCard` نفسَه بـP0032،
--    فلا يستطيع التاجرُ تفعيلَ بوّابةِ دفعه أبداً. تُرفع **مرّةً واحدة**
--    بعد حارسِ الهويّة وقبل أيّ فرع.
CREATE OR REPLACE FUNCTION public.record_user_consent(
  p_terms_version text,
  p_ip text DEFAULT NULL::text,
  p_user_agent text DEFAULT NULL::text,
  p_kind text DEFAULT 'terms'::text,
  p_min_age integer DEFAULT NULL::integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_me   text := (SELECT auth.uid()::text);
  v_ip   text;
  v_prev text;
  v_age  boolean;
  v_same boolean;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('changed', false, 'error', 'AUTH_REQUIRED'); END IF;

  -- 🔴 الرايةُ هنا، مرّةً واحدةً، **قبل فرعِ البوّابة** (انظر أعلاه).
  --    محلّيّةُ المعاملة: تموت بموتها، ولكلّ طلبِ PostgREST معاملتُه، فلا
  --    يستطيع متصفّحٌ رفعَها (ولا دالّةَ عامّةً تأخذ مفتاحَ إعدادٍ من منادٍ).
  PERFORM set_config('taki.consent_write', '1', true);

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

  SELECT consent_terms_version, consent_age_confirmed INTO v_prev, v_age
    FROM public.users WHERE id = v_me;
  v_same := v_prev IS NOT DISTINCT FROM p_terms_version;

  -- v15.80 — العودةُ المبكّرة كانت **لا تُصيب أبداً**: شرطُها القديم
  -- `AND p_min_age IS NULL` ومنادِيا الموقع يُمرّران السنَّ دائماً. فكلُّ
  -- نداءٍ مُعادٍ كان يدهس `consent_terms_at` بـ`now()` — أي أنّ البوّابة التي
  -- تسأل عند كلّ فتحةٍ كانت ستمحو **تاريخَ التوقيع الأصليّ** وهو كلُّ الغرض
  -- من حفظه. الآن: نفسُ الإصدار **وإقرارُ السنّ قائم** ⇒ لا كتابةَ إطلاقاً.
  IF v_same AND (p_min_age IS NULL OR COALESCE(v_age, false)) THEN
    RETURN jsonb_build_object('changed', false, 'already', true);
  END IF;

  UPDATE public.users
     SET -- أوّلُ كتابةٍ تفوز **لنفس الإصدار**؛ وإصدارٌ جديد توقيعٌ جديد
         -- فيستحقّ وقتَه. و`COALESCE` لصفٍّ يحمل إصداراً بلا وقت.
         consent_terms_at      = CASE WHEN v_same THEN COALESCE(consent_terms_at,   now()) ELSE now() END,
         consent_privacy_at    = CASE WHEN v_same THEN COALESCE(consent_privacy_at, now()) ELSE now() END,
         consent_refund_at     = CASE WHEN v_same THEN COALESCE(consent_refund_at,  now()) ELSE now() END,
         consent_terms_version = p_terms_version,
         consent_ip            = COALESCE(v_ip, consent_ip),
         consent_user_agent    = COALESCE(NULLIF(btrim(COALESCE(p_user_agent, '')), ''), consent_user_agent),
         consent_age_confirmed = CASE WHEN p_min_age IS NOT NULL THEN true ELSE consent_age_confirmed END,
         consent_min_age       = COALESCE(p_min_age, consent_min_age)
   WHERE id = v_me;

  RETURN jsonb_build_object('changed', true, 'kind', 'terms', 'ip_recorded', v_ip IS NOT NULL);
END
$fn$;

COMMENT ON FUNCTION public.record_user_consent(text, text, text, text, integer) IS
  'v15.80 — الكاتبُ الوحيد لأعمدة الموافقة. آمنةٌ للتكرار: نفسُ الإصدارِ مع إقرارِ سنٍّ قائمٍ لا يكتب شيئاً، وأوّلُ وقتٍ يُحفَظ.';

-- والصلاحيّاتُ تُعاد تأكيداً لا تخميناً: `REVOKE … FROM PUBLIC` لا يُلغي منحَ
-- `anon` المباشر ولا العكس — يلزمُ الاثنان (درس v14.26).
REVOKE ALL ON FUNCTION public.record_user_consent(text, text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_user_consent(text, text, text, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_user_consent(text, text, text, text, integer) TO authenticated, service_role;

-- ⑤ الدليلُ يصير غيرَ قابلٍ للتلفيق — حارسٌ على الأعمدة العشرة
--
-- 🔴 والمميِّزُ `taki_is_system_caller()` **لا `current_user`**: داخل
--    `SECURITY DEFINER` يملكها `supabase_admin` يكون `current_user` هو
--    المالكَ، فيمرّ الحارسُ على الجميع — أربعةُ حرّاسٍ ضاعت هكذا في v14.93.
--    و`session_user` لا يغيّره `SET ROLE` ولا DEFINER، وكلُّ طلبِ ويبٍ يصل
--    بـ`authenticator` (قِيس من `pg_stat_activity`).
-- 🪤 والرمزُ يسافر في `HINT`: `P0001` وحده يَعبُر PostgREST سليماً، وأيُّ
--    رمزٍ آخرَ يصل الواجهةَ ٥٠٠ عامّاً (درسُ «P0001 وحده»).
-- 🪤 و`BEFORE UPDATE` وحدها — **لا INSERT**: GoTrue يتّصل بـ
--    `supabase_auth_admin` وهو ليس «نظاماً» عند هذا المميِّز، فحارسُ إدراجٍ
--    لغمٌ على مسار التسجيل. والمتبقّي مذكورٌ في التقرير لا مخفيّ:
--    `users_insert_own` + منحُ INSERT يسمحان نظريّاً بإدراجِ صفٍّ بموافقةٍ
--    ملفّقة — ويمنعه المفتاحُ الأساسيّ عمليّاً (الصفُّ يوجد قبل أن تصلح
--    الجلسةُ للاستعمال)، و`authenticated` **لا يملك DELETE على users**
--    (قِيس) فلا طريقَ «احذف ثمّ أدرِج».
CREATE OR REPLACE FUNCTION public.taki_guard_user_consent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- الأعمدةُ العشرة لم تُمسّ ⇒ لا شأنَ لنا (فلا يُعطَّل `saveProfile`
  -- الجزئيّ ولا بطاقةُ المتجر ولا مزامنةُ اللغة ولا أيٌّ من ١٤ مشغّلاً).
  IF  NEW.consent_terms_at          IS NOT DISTINCT FROM OLD.consent_terms_at
  AND NEW.consent_terms_version     IS NOT DISTINCT FROM OLD.consent_terms_version
  AND NEW.consent_privacy_at        IS NOT DISTINCT FROM OLD.consent_privacy_at
  AND NEW.consent_refund_at         IS NOT DISTINCT FROM OLD.consent_refund_at
  AND NEW.consent_ip                IS NOT DISTINCT FROM OLD.consent_ip
  AND NEW.consent_user_agent        IS NOT DISTINCT FROM OLD.consent_user_agent
  AND NEW.consent_age_confirmed     IS NOT DISTINCT FROM OLD.consent_age_confirmed
  AND NEW.consent_min_age           IS NOT DISTINCT FROM OLD.consent_min_age
  AND NEW.gateway_agreement_version IS NOT DISTINCT FROM OLD.gateway_agreement_version
  AND NEW.gateway_agreement_at      IS NOT DISTINCT FROM OLD.gateway_agreement_at
  THEN RETURN NEW;
  END IF;

  -- كتابةٌ صادرةٌ من `record_user_consent` في نفس المعاملة
  IF current_setting('taki.consent_write', true) = '1' THEN RETURN NEW; END IF;

  -- وعملُ الخادم (كرونُ التجهيل · هجرةٌ · خدمةٌ بمفتاح service_role)
  IF public.taki_is_system_caller() THEN RETURN NEW; END IF;

  RAISE EXCEPTION 'سجلُّ الموافقة لا يُعدَّل إلّا من خلال تسجيل الموافقة. / The consent record can only be written by recording consent.'
    USING ERRCODE = 'P0001', HINT = 'P0032';
END
$fn$;

COMMENT ON FUNCTION public.taki_guard_user_consent() IS
  'v15.80 — توقيعٌ إلكترونيٌّ لا يُحرّره صاحبُه: أعمدةُ الموافقة تُكتب من record_user_consent وحدها (P0032).';

DROP TRIGGER IF EXISTS tr_af_guard_user_consent ON public.users;
CREATE TRIGGER tr_af_guard_user_consent
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.taki_guard_user_consent();

-- ⑥ مفتاحُ الإطفاء `consent_gate_enabled` — ومواضعُه ثلاثة لا اثنان
--
-- الفرعُ الثالثُ هو **قائمةُ السماح في RLS**، ونسيانُه يُعيد `SELECT` بصفر
-- صفوفٍ **لا بخطأ** فترتدّ الواجهةُ إلى افتراضها وتبدو سليمة (v14.92 · v15.25).
-- 🪤 وتُعاد بناءُ السياسةِ من **نصّها الحيّ** بإضافةِ عنصرٍ واحد: نسخةٌ مكتوبةٌ
--    هنا كانت ستحذف مفاتيحَ أضافها وكيلٌ آخرُ اليوم (`iap_products` ·
--    `delivery_enabled` موجودتان حيّاً وليستا في أيّ ملفٍّ قرأتُه).
-- 🪤 وأدوارُها تُنسخ حرفيّاً: ٦٣ من ٦٤ سياسةً هنا `TO public`، وإعادةُ بنائها
--    `authenticated` كانت ستحجب البانراتَ والمسابقاتَ عن كلّ زائر (v14.38).
INSERT INTO public.platform_settings (key, value, description)
VALUES ('consent_gate_enabled', 'true'::jsonb,
        'v15.80 — بوّابةُ الموافقة بعد الدخول. مفتاحُ إطفاءٍ لحالةِ عطلٍ فيها: مُشغَّلٌ افتراضاً، وإطفاؤه يجمع الموافقةَ لا يُلزمها.')
ON CONFLICT (key) DO NOTHING;

DO $pol$
DECLARE v_qual text; v_roles text; v_new text; v_after text;
BEGIN
  SELECT pg_get_expr(pol.polqual, pol.polrelid),
         CASE WHEN pol.polroles = '{0}'::oid[] THEN 'public'
              ELSE (SELECT string_agg(quote_ident(r.rolname), ', ')
                      FROM pg_roles r WHERE r.oid = ANY (pol.polroles)) END
    INTO v_qual, v_roles
    FROM pg_policy pol
   WHERE pol.polrelid = 'public.platform_settings'::regclass
     AND pol.polname = 'platform_settings_select';

  IF v_qual IS NULL THEN
    RAISE EXCEPTION '❌ سياسةُ platform_settings_select غائبةٌ حيّاً — لا تُخترَع، تُفحَص.';
  END IF;

  IF position('''consent_gate_enabled''' IN v_qual) > 0 THEN
    RAISE NOTICE 'ℹ️ ⑥ المفتاحُ في قائمة السماح أصلاً — لا إعادةَ بناء (آمنةٌ للتكرار)';
  ELSE
    v_new := replace(v_qual, '''oauth_google_enabled''::text',
                             '''consent_gate_enabled''::text, ''oauth_google_enabled''::text');
    -- 🪤 واستبدالٌ على نصٍّ غائبٍ **لا يُخطئ**: يبدو الحقنُ ناجحاً وهو لم يقع
    --    (درس v14.84). فيُشترط أن يتغيّر النصُّ فعلاً.
    IF v_new = v_qual THEN
      RAISE EXCEPTION '❌ المرساة ''oauth_google_enabled''::text غابت عن نصّ السياسة الحيّ — لم يُحقن شيء.';
    END IF;
    EXECUTE 'DROP POLICY IF EXISTS platform_settings_select ON public.platform_settings';
    EXECUTE format('CREATE POLICY platform_settings_select ON public.platform_settings FOR SELECT TO %s USING (%s)',
                   v_roles, v_new);
  END IF;

  SELECT pg_get_expr(pol.polqual, pol.polrelid) INTO v_after
    FROM pg_policy pol
   WHERE pol.polrelid = 'public.platform_settings'::regclass
     AND pol.polname = 'platform_settings_select';
  IF position('''consent_gate_enabled''' IN COALESCE(v_after, '')) = 0 THEN
    RAISE EXCEPTION '❌ المفتاحُ ليس في قائمةِ السماح بعد إعادة البناء';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy
                  WHERE polrelid = 'public.platform_settings'::regclass
                    AND polname = 'platform_settings_select'
                    AND polroles = '{0}'::oid[]) THEN
    RAISE EXCEPTION '❌ أدوارُ السياسة لم تعد PUBLIC — نُسخت خطأً';
  END IF;
  RAISE NOTICE '✅ ⑥ قائمةُ السماح: المفتاحُ مُدرَج · الأدوارُ public كما كانت';
END $pol$;

-- وإطفاءُ بوّابةٍ قانونيّةٍ قرارُ المالك وحده، لا أدمنٍ فرعيّ
-- 🪤 وتُعاد قائمةُ الحماية من نصّها الحيّ كذلك — لنفس السبب.
DO $prot$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.taki_setting_is_protected(text)'::regprocedure);
  IF position('consent_gate_enabled' IN v_def) > 0 THEN
    RAISE NOTICE 'ℹ️ المفتاحُ محميٌّ أصلاً';
  ELSE
    v_new := replace(v_def, '''vapid_public_key''', '''consent_gate_enabled'', ''vapid_public_key''');
    IF v_new = v_def THEN
      RAISE EXCEPTION '❌ المرساة ''vapid_public_key'' غابت عن taki_setting_is_protected — لم يُحقن شيء.';
    END IF;
    EXECUTE v_new;
  END IF;
  IF NOT public.taki_setting_is_protected('consent_gate_enabled') THEN
    RAISE EXCEPTION '❌ المفتاحُ غيرُ محميٍّ بعد التعديل';
  END IF;
  IF NOT public.taki_setting_is_protected('vapid_public_key') THEN
    RAISE EXCEPTION '❌ مفتاحٌ كان محميّاً فقد حمايته — إعادةُ البناء أكلت عنصراً';
  END IF;
  RAISE NOTICE '✅ ⑥ب إطفاءُ البوّابة محميٌّ (المالكُ وحده) · والقائمةُ القديمةُ سليمة';
END $prot$;

-- ⑦ القياس: كلُّ تحقّقٍ كتلةُ `DO` ترفع استثناءً (جدولُ ✅/❌ لا يُفشل psql)
--
-- 🔴 والفخُّ الذي يُبطل فحوصَ حارسٍ كهذا: جلسةُ `psql` تتّصل بـ
--    `supabase_admin` فيردّ `taki_is_system_caller()` **صحيحاً**، فكلُّ
--    محاولةِ تلفيقٍ تمرّ **بريئةً كاذبة** (v14.96، حيث جاء الرفضُ المرصود من
--    سقفِ المواقع لا من الحارس). والمخرجُ مقيسٌ هنا:
--      `SET LOCAL SESSION AUTHORIZATION authenticated` يُغيّر `session_user`
--      نفسَه (قِيس: `session_user=authenticated` و`taki_is_system_caller()=f`)،
--      وداخل كتلةٍ فرعيّةٍ تُلغى فيعود الدورُ **وتعود الرايةُ** تلقائياً.
--    فالنفيُ مُثبَتٌ هنا بالتنفيذ لا بالقراءة.
DO $verify$
DECLARE
  v_uid text; v_seller text;
  v_state text; v_hint text; v_msg text;
  v_blocked boolean;
  v_r1 jsonb; v_r2 jsonb; v_r3 jsonb;
  v_ver text; v_at timestamptz; v_gw text; v_terms text; v_prev_terms text;
  v_rows int; v_flag text;
BEGIN
  SELECT id INTO v_uid FROM public.users WHERE user_type = 'buyer' ORDER BY created_at LIMIT 1;
  SELECT id INTO v_seller FROM public.users WHERE user_type = 'seller' ORDER BY created_at LIMIT 1;
  IF v_uid IS NULL OR v_seller IS NULL THEN
    RAISE EXCEPTION '❌ لا حسابَ اختبارٍ (مشتري=% · تاجر=%)', v_uid, v_seller;
  END IF;

  -- (أ) المشغّلُ **مُركَّبٌ فعلاً**: حارسٌ غيرُ موصولٍ فشل صامتاً مرّتين هنا.
  IF (SELECT count(*) FROM pg_trigger
       WHERE tgrelid = 'public.users'::regclass
         AND tgname = 'tr_af_guard_user_consent' AND NOT tgisinternal) <> 1 THEN
    RAISE EXCEPTION '❌ (أ) مشغّلُ الموافقة غيرُ مُركَّب على public.users';
  END IF;

  -- (ب) بِنيةُ الحارس: المميِّزُ `taki_is_system_caller` ولا ذِكرَ
  --     لـ`current_user` — **بعد تجريد التعليقات**، فحارسٌ أمسك تعليقَه هو
  --     وقع ثلاثَ مرّاتٍ في هذا المستودع.
  DECLARE v_src text;
  BEGIN
    v_src := regexp_replace(pg_get_functiondef('public.taki_guard_user_consent()'::regprocedure),
                            '--[^\n]*', '', 'g');
    IF position('taki_is_system_caller' IN v_src) = 0 THEN
      RAISE EXCEPTION '❌ (ب) الحارسُ لا ينادي taki_is_system_caller';
    END IF;
    IF position('current_user' IN v_src) > 0 THEN
      RAISE EXCEPTION '❌ (ب) الحارسُ يستعمل current_user — وهو المالكُ داخل DEFINER فيمرّ الجميع (v14.93)';
    END IF;
    IF position('''P0032''' IN v_src) = 0 THEN
      RAISE EXCEPTION '❌ (ب) الرمزُ P0032 لا يُرسَل في HINT';
    END IF;
  END;

  -- (ج) 🔴 موضعُ الراية: **قبل** فرعِ البوّابة. هذا هو الانحدارُ الذي أمسكه
  --     المدقّق — ومقياسُه موضعٌ لا وجود.
  DECLARE v_src2 text; v_pos_flag int; v_pos_gw int;
  BEGIN
    v_src2 := regexp_replace(pg_get_functiondef('public.record_user_consent(text,text,text,text,integer)'::regprocedure),
                             '--[^\n]*', '', 'g');
    v_pos_flag := position('taki.consent_write' IN v_src2);
    v_pos_gw   := position('p_kind = ''gateway''' IN v_src2);
    IF v_pos_flag = 0 THEN RAISE EXCEPTION '❌ (ج) الرايةُ لا تُرفع في record_user_consent'; END IF;
    IF v_pos_gw   = 0 THEN RAISE EXCEPTION '❌ (ج) فرعُ البوّابة غائبٌ — تغيّرت الدالّةُ تحتي'; END IF;
    IF v_pos_flag > v_pos_gw THEN
      RAISE EXCEPTION '❌ (ج) 🔴 الرايةُ تُرفع **بعد** فرعِ البوّابة — نداءُ GatewayCard سيُرفض بـP0032 ولن يستطيع التاجرُ تفعيلَ بوّابته';
    END IF;
  END;

  -- (د) النفيُ بالتنفيذ: مستخدمٌ يُلفّق إقرارَ سنٍّ لنفسه ⇒ يُرفض بـP0032
  --     بعينه. و«أيُّ استثناءٍ» ليس فحصاً (v14.96).
  -- 🪤 وشرطٌ قبل الفحص: القيمةُ الحاليّةُ يجب أن تكون `false` فعلاً، وإلّا
  --    كانت `NEW IS NOT DISTINCT FROM OLD` تُمرّر الكتابةَ وجاز الفحصُ
  --    **بلا أن يُكسر شيء** — وهي بالضبط «كسرةٌ لا تكسر» التي وقعت أربع مرّات.
  IF (SELECT COALESCE(consent_age_confirmed, false) FROM public.users WHERE id = v_uid) THEN
    RAISE EXCEPTION '❌ (د) حسابُ الاختبار يحمل إقرارَ السنّ أصلاً — الفحصُ كان سيمرّ بلا تغييرٍ حقيقيّ';
  END IF;
  v_blocked := false;
  BEGIN
    EXECUTE 'SET LOCAL SESSION AUTHORIZATION authenticated';
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    IF public.taki_is_system_caller() THEN
      RAISE EXCEPTION '❌ (د) تبديلُ الدور لم ينفع — الجلسةُ ما زالت «نظاماً» فالفحصُ كان سيمرّ كاذباً';
    END IF;
    UPDATE public.users SET consent_age_confirmed = true WHERE id = v_uid;
    RAISE EXCEPTION 'SENTINEL_NOT_BLOCKED';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_hint = PG_EXCEPTION_HINT, v_msg = MESSAGE_TEXT;
    IF v_msg = 'SENTINEL_NOT_BLOCKED' THEN
      RAISE EXCEPTION '❌ (د) 🔴 التلفيقُ نجح — الحارسُ لا يحرس شيئاً';
    END IF;
    IF v_msg LIKE '❌%' THEN RAISE; END IF;
    IF v_state <> 'P0001' OR COALESCE(v_hint, '') <> 'P0032' THEN
      RAISE EXCEPTION '❌ (د) رُفض لسببٍ آخرَ لا للسبب المقصود: state=% hint=% msg=%', v_state, v_hint, v_msg;
    END IF;
    v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION '❌ (د) لم يبتّ'; END IF;

  -- وعزلُ الكتلة الفرعيّة مُثبَتٌ لا مفترَض: الدورُ عاد، والرايةُ لم تُرفع.
  IF NOT public.taki_is_system_caller() THEN
    RAISE EXCEPTION '❌ دورُ الجلسة لم يعد بعد إلغاء الكتلة — بقيّةُ الفحوص غيرُ موثوقة';
  END IF;
  v_flag := current_setting('taki.consent_write', true);
  IF COALESCE(v_flag, '') <> '' THEN
    RAISE EXCEPTION '❌ الرايةُ بقيت مرفوعةً بعد إلغاء الكتلة (%) — الفحوصُ التالية كانت ستمرّ كاذبة', v_flag;
  END IF;

  -- (هـ) 🔴 الانحدارُ المضاد: فرعُ البوّابة يجب أن **ينجح** ولا يمسّ الشروط.
  -- 🪤 ويُقاس «لا يمسّ» بالمقارنة بما كان، لا بـ`IS NULL`: الصفرُ صحيحٌ اليوم
  --    وحده، ويومَ يحمل التاجرُ موافقةً حقيقيّةً كان الفحصُ سيتّهم البريء.
  SELECT consent_terms_version INTO v_prev_terms FROM public.users WHERE id = v_seller;
  BEGIN
    EXECUTE 'SET LOCAL SESSION AUTHORIZATION authenticated';
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
    v_r1 := public.record_user_consent('merchant-gateway-agreement-v1', NULL, NULL, 'gateway', NULL);
    SELECT gateway_agreement_version, consent_terms_version INTO v_gw, v_terms
      FROM public.users WHERE id = v_seller;
    RAISE EXCEPTION 'SENTINEL_UNDO';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg LIKE '❌%' THEN RAISE; END IF;
    IF v_msg <> 'SENTINEL_UNDO' THEN
      RAISE EXCEPTION '❌ (هـ) 🔴 مسارُ اتفاقيّةِ البوّابة انكسر: %', v_msg;
    END IF;
  END;
  IF COALESCE(v_r1->>'kind', '') <> 'gateway' THEN
    RAISE EXCEPTION '❌ (هـ) فرعُ البوّابة لم يُرجع kind=gateway: %', v_r1;
  END IF;
  IF v_gw IS DISTINCT FROM 'merchant-gateway-agreement-v1' THEN
    RAISE EXCEPTION '❌ (هـ) عمودُ البوّابة لم يُكتب: %', v_gw;
  END IF;
  IF v_terms IS DISTINCT FROM v_prev_terms THEN
    RAISE EXCEPTION '❌ (هـ) فرعُ البوّابة دهس خانةَ الشروط: % ⇐ % — هذا عينُ العيب الذي أصلحناه في ③', v_prev_terms, v_terms;
  END IF;

  -- (و) الموافقةُ تُكتب فعلاً من الشاشة، و**نداءٌ مُعادٌ لا يُحرّك التوقيع**.
  --     🪤 ولا تُقاس بمقارنةِ وقتين من نداءين: `now()` ثابتةٌ داخل المعاملة،
  --        فمقارنتُها فحصٌ **لا يمكن أن يفشل**. والمقياسُ هنا آليّتان
  --        مُنفصلتان تُجرَّبان كلٌّ على حدة:
  --          • `CASE` تحفظ أوّلَ وقت ⇐ نداءٌ **يكتب** (السنُّ أُنزِل إلى false)
  --            ومعه وقتٌ وسيطٌ قديم، فيجب أن يبقى القديم.
  --          • العودةُ المبكّرة ⇐ نداءٌ ثالثٌ لا يكتب شيئاً (`already=true`).
  BEGIN
    EXECUTE 'SET LOCAL SESSION AUTHORIZATION authenticated';
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    v_r1 := public.record_user_consent('TEST-ONLY-UNDONE', NULL, 'probe-ua', 'terms', 18);
    -- وقتٌ وسيطٌ قديم + سنٌّ غيرُ مُقَرٍّ: الرايةُ مرفوعةٌ في هذه المعاملة
    -- فتمرّ هذه الكتابة، وهو نفسُ الباب الذي يستعمله النظام — لا ثقبٌ جديد.
    UPDATE public.users
       SET consent_terms_at = '2001-01-01T00:00:00Z', consent_age_confirmed = false
     WHERE id = v_uid;
    v_r2 := public.record_user_consent('TEST-ONLY-UNDONE', NULL, 'probe-ua', 'terms', 18);
    SELECT consent_terms_version, consent_terms_at INTO v_ver, v_at
      FROM public.users WHERE id = v_uid;
    v_r3 := public.record_user_consent('TEST-ONLY-UNDONE', NULL, 'probe-ua', 'terms', 18);
    RAISE EXCEPTION 'SENTINEL_UNDO';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg LIKE '❌%' THEN RAISE; END IF;
    IF v_msg <> 'SENTINEL_UNDO' THEN
      RAISE EXCEPTION '❌ (و) مسارُ تسجيلِ الموافقة انكسر: %', v_msg;
    END IF;
  END;
  IF COALESCE(v_r1->>'changed', '') <> 'true' THEN
    RAISE EXCEPTION '❌ (و) أوّلُ نداءٍ لم يكتب: %', v_r1;
  END IF;
  IF v_ver IS DISTINCT FROM 'TEST-ONLY-UNDONE' THEN
    RAISE EXCEPTION '❌ (و) الإصدارُ لم يُحفَظ: %', v_ver;
  END IF;
  IF COALESCE(v_r2->>'changed', '') <> 'true' THEN
    RAISE EXCEPTION '❌ (و) النداءُ الثاني كان يجب أن يكتب إقرارَ السنّ الناقص: %', v_r2;
  END IF;
  IF v_at IS DISTINCT FROM '2001-01-01T00:00:00Z'::timestamptz THEN
    RAISE EXCEPTION '❌ (و) 🔴 أوّلُ وقتٍ لم يُحفَظ — صار % (وهو تاريخُ التوقيع نفسُه)', v_at;
  END IF;
  IF COALESCE(v_r3->>'already', '') <> 'true' THEN
    RAISE EXCEPTION '❌ (و) 🔴 النداءُ المُعاد كتب مرّةً أخرى (%) — والبوّابةُ تسأل عند كلّ فتحةٍ فكان سيمحو تاريخَ التوقيع', v_r3;
  END IF;

  -- (ز) والبوّابةُ تستطيع أن تقرأ ما تحتاج: صفُّها هي، ومفتاحُ الإطفاء.
  --     صفرُ صفٍّ هنا = قائمةُ سماح RLS نُسيت، وهي تَصمت ولا تُخطئ (v14.92).
  BEGIN
    EXECUTE 'SET LOCAL SESSION AUTHORIZATION authenticated';
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO v_rows FROM public.platform_settings WHERE key = 'consent_gate_enabled';
    IF v_rows <> 1 THEN
      RAISE EXCEPTION '❌ (ز) 🔴 مفتاحُ الإطفاء غيرُ مقروءٍ للمستخدم (% صفّاً) — قائمةُ السماح في RLS نُسيت', v_rows;
    END IF;
    SELECT count(*) INTO v_rows FROM public.users WHERE id = v_uid;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION '❌ (ز) المستخدمُ لا يقرأ صفَّ موافقته (% صفّاً) — البوّابةُ كانت ستعمى', v_rows;
    END IF;
    RAISE EXCEPTION 'SENTINEL_UNDO';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg <> 'SENTINEL_UNDO' THEN RAISE; END IF;
  END;

  RAISE NOTICE '✅ ⑦ سبعةُ فحوص: المشغّلُ مُركَّب · المميِّزُ صحيح · الرايةُ قبل فرعِ البوّابة · التلفيقُ مرفوضٌ بـP0032 · البوّابةُ تعمل ولا تدهس الشروط · النداءُ المُعاد لا يكتب · والقراءةُ متاحة';
END $verify$;

-- ⑧ وجدولٌ للقراءة البشريّة — **بعد** كلّ تحقّقٍ رافع
SELECT 'الخادم' AS بند,
       CASE WHEN obj_description('public'::regnamespace, 'pg_namespace') IS NULL
            THEN 'جدة — الإنتاج' ELSE 'مختبر ⚠️' END AS قيمة
UNION ALL SELECT 'حسابات', (SELECT count(*)::text FROM public.users)
UNION ALL SELECT 'سجلٌّ كاذبٌ باقٍ',
       (SELECT count(*)::text FROM public.users WHERE consent_terms_version = 'merchant-gateway-agreement-v1')
UNION ALL SELECT 'اتفاقيّةُ بوّابةٍ في عمودها',
       (SELECT count(*)::text FROM public.users WHERE gateway_agreement_version IS NOT NULL)
UNION ALL SELECT 'حسابات تحمل إصدارَ موافقةٍ (أيّ إصدار)',
       (SELECT count(*)::text FROM public.users WHERE consent_terms_version IS NOT NULL)
UNION ALL SELECT 'حارسُ الموافقة مُركَّب',
       (SELECT CASE WHEN count(*) = 1 THEN '✅' ELSE '❌' END FROM pg_trigger
         WHERE tgrelid = 'public.users'::regclass AND tgname = 'tr_af_guard_user_consent')
UNION ALL SELECT 'مفتاحُ البوّابة',
       (SELECT COALESCE(value::text, '(غائب)') FROM public.platform_settings WHERE key = 'consent_gate_enabled')
UNION ALL SELECT 'المفتاحُ في قائمةِ سماح RLS',
       (SELECT CASE WHEN position('''consent_gate_enabled''' IN pg_get_expr(polqual, polrelid)) > 0
                    THEN '✅' ELSE '❌' END FROM pg_policy
         WHERE polrelid = 'public.platform_settings'::regclass AND polname = 'platform_settings_select')
UNION ALL SELECT 'إطفاءُ البوّابة محميٌّ للمالك',
       (SELECT CASE WHEN public.taki_setting_is_protected('consent_gate_enabled') THEN '✅' ELSE '❌' END);

-- ════════════════════════════════════════════════════════════════════════
-- -- ROLLBACK
-- DROP TRIGGER IF EXISTS tr_af_guard_user_consent ON public.users;
-- DROP FUNCTION IF EXISTS public.taki_guard_user_consent();
-- DELETE FROM public.platform_settings WHERE key = 'consent_gate_enabled';
-- -- وإعادةُ `record_user_consent` إلى نصّها قبل v15.80 (العودةُ المبكّرة
-- -- `AND p_min_age IS NULL` و`now()` غيرَ مشروطة وبلا راية) — نصُّها
-- -- محفوظٌ في supabase/JEDDAH_v15_79_anon_surface.sql إن لزم.
-- -- وقائمتا السماح والحماية تُعاد منهما إضافةُ `consent_gate_enabled` يدويّاً
-- -- بنفس تقنيةِ الحقنِ معكوسةً (replace بالعنصر مع الفاصلة ← بلا شيء).
-- 🪤 ولا رجعةَ لإصلاح ③ ولا يُراد: السجلّان كانا يُقرّان بوثيقةٍ لم يُوافق
--    عليها صاحبُها، والنقلُ أعاد كلَّ قيمةٍ إلى عمودها الصحيح بلا فقدان.
-- ════════════════════════════════════════════════════════════════════════
