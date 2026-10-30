-- ═══════════════════════════════════════════════════════════════════════════
-- v15.31 — أربعُ ثغراتٍ قِيست على الإنتاج، وامتيازٌ يجب ألّا يكون موجوداً
-- ═══════════════════════════════════════════════════════════════════════════
-- جردةُ الإطلاق (٣٠ أكتوبر) أخرجت ٥٥ بنداً، وهذه أربعةٌ منها **قِستُها
-- بنفسي على القاعدة الحيّة** ولا تحتمل انتظار قرار.
--
-- 🔴 ١) **اشتراكٌ مدفوعٌ يُمنح بلا مال.** `subscribe_self_to_package` ممنوحةٌ
--    لـ`authenticated`، وتقرأ السعر من الكتالوج (أُصلح ذلك في v13.43 فلم يبقَ
--    تلاعبٌ بالسعر) — لكنها **لا تتحقّق من دفعةٍ إطلاقاً**: تحسب `v_net` ثمّ
--    تتجاهله وتكتب `subscription_plan='premium'`. والواجهةُ «تدفع» عبر
--    `paymentService.initiateMoyasarPayment` وهي `setTimeout(1500)` تُرجع
--    `moy_<عشوائي>` بلا نداء شبكةٍ واحد. أي أن تاجراً موثَّقاً يمنح نفسه
--    **الباقة ٨ (٩٩٩٫٩٩ ريال · ٣٠ موقعاً)** بنداءٍ واحد. وفي الجدول صفّان
--    «مدفوعان» بمجموع ٥٩٩٫٩٨ ريالاً لم يصل منها ريال.
--    ⇒ تُرفض الدالّة الآن ما لم توجد دفعةٌ **مؤكَّدةٌ بمرجعِ بوّابة**، ومسارُ
--      ناصر يبقى كما هو (`admin_apply_subscription` · `grant_subscription_bulk`).
--
-- 🔴 ٢) **ملاحظاتُ الإدارة ومبالغُ الاشتراك مقروءةٌ لأيّ زائرٍ مجهول.** قِيس
--    بنداءٍ حقيقيّ بمفتاح الإنتاج العامّ: عاد `admin_notes` و`subscription_amount`
--    لكلّ متجر. والسياسةُ `store_profiles_select_all USING (true) TO public`
--    و`anon` له `SELECT` على **الجدول كلّه** (٣٨ عموداً فيها `email` و`phone`
--    و`address` — فارغةٌ اليوم، تسرّب لحظةَ يملؤها تاجر).
--    🪤 ولا يُصلح ذلك بسياسةٍ: التسريبُ **عموديّ** وRLS أفقيّة. والمنعُ
--       بـ`REVOKE` على عمودٍ **لا أثرَ له تحت منحٍ على الجدول** (درس مسجَّل)
--       ⇒ يُسحب منحُ الجدول ثمّ تُمنح الأعمدةُ العامّة وحدها.
--
-- 🔴 ٣) **`authenticated` يملك `TRUNCATE` على ٦٠ جدولاً من ٧٣** — ومنها
--    `users` و`bookings` و`order_invoices` و`platform_settings`. و`TRUNCATE`
--    **يتجاوز RLS كلياً** ولا يُشعل مشغّلات الصفوف، فحارسا v14.20
--    (`tr_guard_user_delete` و`tr_guard_booking_delete`) لا يمنعانه.
--    🟢 **وقِيس أنه غيرُ قابلٍ للاستغلال اليوم**: PostgREST لا تُصدر `TRUNCATE`
--       إطلاقاً، و**صفرُ دالّةٍ في القاعدة كلّها تحتوي الكلمة** (قِيس). فهذه
--       مخالفةُ «أقلّ امتياز» تنتظر أوّلَ ثغرةِ حقنٍ أو أوّلَ دالّةٍ بـSQL
--       ديناميكيّ لتصير محوَ قاعدةٍ كاملاً — لا بلاغَ عن اختراقٍ واقع.
--       وهي **افتراضُ سوبابيس** (`GRANT ALL` يشمل TRUNCATE)، فتسري على كلّ
--       جدولٍ جديد ⇒ تُصحَّح الامتيازاتُ الافتراضية أيضاً وإلّا رجعت.
--
-- 🔴 ٤) **`find_email_by_phone` تُعيد البريدَ كاملاً لزائرٍ مجهول.** قِيس:
--    `{"input_phone":"05…"}` ⇒ بريدٌ كاملٌ نصّاً. والحدُّ ١٠/دقيقة و٦٠/ساعة
--    لكلّ عنوان — أي ١٤٤٠ بريداً في اليوم من عنوانٍ واحد.
--    🪤 ولا تُحذف: مسارُ الدخول بالجوّال يحتاجها (GoTrue يطلب بريداً)، وحذفُها
--       يقفل الدخول على كلّ من يدخل برقمه. فتُضيَّق الحدودُ ويُسجَّل كلُّ
--       استخراجٍ ناجح ليصير الحصدُ مرئياً — **وهذا تضييقٌ لا إغلاق**، والإغلاق
--       الكامل يحتاج قرار ناصر (دالّةُ حافةٍ تُرسل الاستعادة بنفسها فلا يرى
--       المتصفّحُ بريداً إطلاقاً).
--    🪤 وأوّلُ فحصٍ لها عندي **مرّ كاذباً**: ناديتُها بـ`p_phone` فعادت
--       `PGRST202` فظننتُها محميّة — والاسمُ الحقيقيّ `input_phone`.
--       «غير موجود» ليس نجاحاً، ودرسُ المشروع يعيد نفسَه.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.subscribe_self_to_package(integer)') IS NULL THEN
    RAISE EXCEPTION 'دالّةُ الاشتراك غير موجودة — أوقِفت.';
  END IF;
  IF to_regclass('public.subscription_payments') IS NULL THEN
    RAISE EXCEPTION 'جدولُ الدفعات غير موجود — أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) سحبُ TRUNCATE و TRIGGER و REFERENCES — ومن الامتيازات الافتراضية أيضاً
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 ولا تُسحب `DELETE`: تلك تخضع لـRLS وتُشعل الحرّاس، وسحبُها يكسر حذفَ
--    المستخدم لحجزه ومفضّلاته. المقصودُ وحده ما **يتجاوز** الحراسة.
DO $priv$
DECLARE v_before int; v_after int; v_role text;
BEGIN
  SELECT count(*) INTO v_before FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND privilege_type IN ('TRUNCATE','TRIGGER','REFERENCES')
     AND grantee IN ('anon','authenticated');

  REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

  -- 🔴 **والامتيازُ الافتراضيُّ مملوكٌ لمانحٍ بعينه، لا للمخطّط.**
  --    `ALTER DEFAULT PRIVILEGES` بلا `FOR ROLE` تمسّ افتراضاتِ **المنادي
  --    وحده** — وأنا `supabase_admin`، بينما قِيس أن مالكَ الصفوف في
  --    `pg_default_acl` هو **`postgres`**. فالصيغةُ بلا `FOR ROLE` تنجح
  --    بلا خطأٍ ولا تغيّر شيئاً، وحارسُ القسم ٧ هو ما كشف ذلك.
  --    ولا يُخمَّن المانح: يُقرأ من `pg_default_acl` ويُدار عليه.
  FOR v_role IN
    SELECT DISTINCT d.defaclrole::regrole::text
      FROM pg_default_acl d, aclexplode(d.defaclacl) a
     WHERE d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r'
       AND a.grantee::regrole::text IN ('anon','authenticated')
       AND a.privilege_type IN ('TRUNCATE','TRIGGER','REFERENCES')
  LOOP
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
      || 'REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated',
      v_role);
    RAISE NOTICE 'ℹ️ صُحّحت الامتيازاتُ الافتراضية للمانح %.', v_role;
  END LOOP;

  SELECT count(*) INTO v_after FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND privilege_type IN ('TRUNCATE','TRIGGER','REFERENCES')
     AND grantee IN ('anon','authenticated');

  IF v_after IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '❌ بقي % امتيازاً خطيراً بعد السحب (كان %).', v_after, v_before;
  END IF;
  RAISE NOTICE '✅ سُحب % امتيازاً (TRUNCATE/TRIGGER/REFERENCES) وصار العددُ صفراً.', v_before;
END
$priv$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) ملفُّ المتجر — أعمدةٌ عامّةٌ وحدها للزائر، ولا ملاحظاتٍ إدارية لأحدٍ منهما
-- ═══════════════════════════════════════════════════════════════════════════
-- الأعمدةُ العامّة مُشتقّةٌ من قراءةِ الشاشات لا من التخمين: صفحةُ المتجر
-- تقرأ الرقمَ الضريبيّ والسجلَّ (إفصاحٌ نظاميّ)، وسياسةُ الاسترداد والشروط
-- تُعرضان في صفحة المتجر وصفحة العرض، وبياناتُ التوصيل تُعرض للمشتري.
REVOKE SELECT ON public.store_profiles FROM anon;
GRANT  SELECT (store_id, vat_number, cr_number, vat_status, avatar_url, bio,
               refund_policy, store_terms, accepts_cod, is_suspended,
               delivery_enabled, delivery_payment, delivery_fee,
               delivery_min_order, delivery_eta_min, delivery_note,
               instant_refund, max_branches)
  ON public.store_profiles TO anon;

-- وللموثَّق: كلُّ شيءٍ إلّا الملاحظاتَ الإدارية.
-- 🪤 ويبقى مفتوحاً للعلم: `subscription_amount` يقرؤه أيُّ موثَّقٍ لأي متجر.
--    فصلُه يحتاج نقلَ شاشات التاجر إلى دالّةٍ مالكة — تغييرٌ أوسع لا يُشحن
--    على عجل، وسُجّل ليُقرَّر.
REVOKE SELECT ON public.store_profiles FROM authenticated;
GRANT  SELECT (store_id, phone, email, avatar_url, bio, address, updated_at,
               subscription_plan, subscription_expires_at, discount_percentage,
               is_pinned, max_branches, subscription_amount,
               subscription_started_at, is_suspended, custom_features,
               auto_renew, subscription_canceled_at, last_expiry_warning_at,
               subscription_package_id, vat_number, cr_number, vat_status,
               delivery_enabled, delivery_payment, delivery_fee,
               delivery_min_order, delivery_eta_min, delivery_note,
               accepts_cod, payment_declared_at, refund_policy, store_terms,
               delivery_blocked_by_admin, delivery_block_reason,
               delivery_blocked_at, instant_refund)
  ON public.store_profiles TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) الاشتراكُ لا يُمنح بلا دفعةٍ مؤكَّدة
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 الحارسُ **داخل الدالّة** لا في الواجهة ولا بمفتاحٍ في الإعدادات: الدالّةُ
--    تُنادى مباشرةً عبر PostgREST، فمفتاحُ الواجهة يُلتفّ عليه بنداءٍ واحد.
-- 🪤 والباقةُ المجّانيّة تبقى متاحةً: سعرُ صفرٍ لا يحتاج دفعة.
CREATE OR REPLACE FUNCTION public._taki_sub_payment_ok(
  p_uid text, p_package_id int, p_net numeric)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(p_net, 0) <= 0 OR EXISTS (
    SELECT 1 FROM public.subscription_payments sp
     WHERE sp.merchant_id = p_uid
       AND sp.status = 'paid'
       -- 🔴 مرجعُ البوّابة شرطٌ لا تجميل: الدفعاتُ التي تكتبها الواجهةُ بعد
       --    المحاكاة تأتي **بلا مرجع**، فهي لا تُمرّر هذا الشرط أبداً.
       AND COALESCE(sp.gateway_reference, '') <> ''
       AND sp.amount >= p_net
       AND sp.created_at > now() - interval '2 hours');
$fn$;
REVOKE ALL ON FUNCTION public._taki_sub_payment_ok(text, int, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._taki_sub_payment_ok(text, int, numeric) FROM anon;
REVOKE ALL ON FUNCTION public._taki_sub_payment_ok(text, int, numeric) FROM authenticated;

DO $patch$
DECLARE src text; anchor constant text :=
  '  v_end   := v_now + make_interval(days => v_days);';
BEGIN
  src := pg_get_functiondef('public.subscribe_self_to_package(integer)'::regprocedure);
  IF position('_taki_sub_payment_ok' IN src) > 0 THEN
    RAISE NOTICE 'ℹ️ الحارسُ مزروعٌ أصلاً — لا تكرار.';
    RETURN;
  END IF;
  IF position(anchor IN src) = 0 THEN
    RAISE EXCEPTION '❌ لم أجد المرساة في نصّ الدالّة الحيّ — لا يُرقَّع نصٌّ لا يُطابق.';
  END IF;
  src := replace(src, anchor, anchor
    || E'\n\n  -- 🔴 v15.31: لا اشتراكَ مدفوعٌ بلا دفعةٍ مؤكَّدةٍ بمرجعٍ من بوّابة.\n'
    || E'  IF NOT public._taki_sub_payment_ok(v_uid, p_package_id, v_net) THEN\n'
    || E'    RETURN jsonb_build_object(''success'', false, ''error'', ''payment_not_confirmed'');\n'
    || E'  END IF;\n');
  EXECUTE src;
  IF position('_taki_sub_payment_ok' IN
       pg_get_functiondef('public.subscribe_self_to_package(integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ الترقيعُ لم يسرِ — و`replace` على نصٍّ غائبٍ لا يُخطئ.';
  END IF;
  RAISE NOTICE '✅ زُرع حارسُ الدفع داخل subscribe_self_to_package.';
END
$patch$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) مزوّدُ المحاكاة لا يُربط بمتجرٍ من لوحة التاجر
-- ═══════════════════════════════════════════════════════════════════════════
DO $sim$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.merchant_set_gateway(text,text,text,text,jsonb)'::regprocedure);
  IF position('SIM_NOT_ALLOWED' IN src) > 0 THEN
    RAISE NOTICE 'ℹ️ حارسُ المحاكاة مزروعٌ أصلاً.'; RETURN;
  END IF;
  IF src !~ '\mBEGIN\M' THEN RAISE EXCEPTION '❌ لم أجد بداية جسم الدالّة.'; END IF;
  src := regexp_replace(src, '\mBEGIN\M',
       E'BEGIN\n  -- 🔴 v15.31: `sim` تختم الطلبَ «مدفوعاً» بلا مال — فلا تُربط\n'
    || E'  --    من لوحة التاجر إطلاقاً. ولناصر مسارُه الإداريّ إن أراد اختباراً.\n'
    || E'  IF lower(COALESCE(p_provider, '''')) = ''sim'' THEN\n'
    || E'    RETURN jsonb_build_object(''ok'', false, ''error'', ''SIM_NOT_ALLOWED'');\n'
    || E'  END IF;\n');
  EXECUTE src;
  IF position('SIM_NOT_ALLOWED' IN
       pg_get_functiondef('public.merchant_set_gateway(text,text,text,text,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ حارسُ المحاكاة لم يسرِ.';
  END IF;
  RAISE NOTICE '✅ زُرع حارسُ `sim` في merchant_set_gateway.';
END
$sim$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) استخراجُ البريد من الجوّال — تضييقٌ وتسجيل، لا إغلاق
-- ═══════════════════════════════════════════════════════════════════════════
DO $fep$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.find_email_by_phone(text)'::regprocedure);
  IF position('''fep1m:''' IN src) = 0 THEN
    RAISE EXCEPTION '❌ لم أجد حدَّ المعدّل في النصّ الحيّ.';
  END IF;
  src := replace(src, 'public.taki_rate_check(''fep1m:'' || v_ip, 10, 60,',
                      'public.taki_rate_check(''fep1m:'' || v_ip, 3, 60,');
  src := replace(src, 'public.taki_rate_check(''fep1h:'' || v_ip, 60, 3600,',
                      'public.taki_rate_check(''fep1h:'' || v_ip, 15, 3600,');
  -- وتسجيلُ كلّ استخراجٍ ناجح: الحصدُ يصير مرئياً بدل أن يكون صامتاً.
  -- 🪤 ويُلفّ بمعالجِ استثناء: هذه دالّةٌ في **مسار الدخول**، وسجلٌّ فاشل
  --    لا يجوز أن يقفل الدخول على أحد.
  IF position(E'    RETURN found_email;\nEND;' IN src) = 0 THEN
    RAISE EXCEPTION '❌ لم أجد مرساةَ الإرجاع الأخيرة.';
  END IF;
  src := replace(src, E'    RETURN found_email;\nEND;',
       E'    IF found_email IS NOT NULL THEN\n'
    || E'      BEGIN\n'
    || E'        INSERT INTO public.activity_log (action, entity_type, entity_id, metadata)\n'
    || E'        VALUES (''phone_email_lookup'', ''auth'', left(digits_only, 4) || ''****'',\n'
    || E'                jsonb_build_object(''ip'', v_ip));\n'
    || E'      EXCEPTION WHEN OTHERS THEN NULL;\n'
    || E'      END;\n'
    || E'    END IF;\n'
    || E'    RETURN found_email;\nEND;');
  EXECUTE src;
  src := pg_get_functiondef('public.find_email_by_phone(text)'::regprocedure);
  IF position('fep1m:'' || v_ip, 3, 60' IN src) = 0 THEN
    RAISE EXCEPTION '❌ التضييقُ لم يسرِ.';
  END IF;
  IF position('phone_email_lookup' IN src) = 0 THEN
    RAISE EXCEPTION '❌ التسجيلُ لم يُزرع.';
  END IF;
  RAISE NOTICE '✅ ضُيّق الحدُّ إلى ٣/دقيقة و١٥/ساعة، ويُسجَّل كلُّ استخراجٍ ناجح.';
END
$fep$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٦) «الوضعُ المدفوع» يعود مُطفأً — وهو قرارُ ناصر في v14.10
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 كان `false` بقراره لأن الدفعَ محاكاة، وهو اليوم `true` بلا أثرٍ في أيّ
--    سجلّ. ومع حارس الدفع أعلاه صار الزرُّ يفشل على أي حال — فالإطفاءُ يجعل
--    الشاشةَ صادقةً بدل أن تَعِد ثمّ تُخطئ.
UPDATE public.platform_settings
   SET value = 'false'::jsonb
 WHERE key = 'payment_gateway_enabled' AND value IS DISTINCT FROM 'false'::jsonb;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٧) القياس — ولا «تمّ» قبله
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE n int; v_m text;
BEGIN
  -- (أ) صفرُ امتيازٍ خطير
  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE table_schema='public' AND privilege_type IN ('TRUNCATE','TRIGGER','REFERENCES')
     AND grantee IN ('anon','authenticated');
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'بقي % امتيازاً.', n; END IF;

  -- (ب) والامتيازاتُ الافتراضية لا تُعيدها على جدولٍ جديد
  IF EXISTS (
    SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a
     WHERE d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r'
       AND a.grantee::regrole::text IN ('anon','authenticated')
       AND a.privilege_type IN ('TRUNCATE','TRIGGER','REFERENCES')) THEN
    RAISE EXCEPTION 'الامتيازاتُ الافتراضية ما زالت تمنح ما سُحب — فأوّلُ جدولٍ جديد يُعيد العيب.';
  END IF;

  -- (ج) الزائرُ لا يرى الملاحظاتَ ولا المبالغ، ويرى الرقمَ الضريبيّ
  IF has_column_privilege('anon', 'public.store_profiles', 'admin_notes', 'SELECT') THEN
    RAISE EXCEPTION 'الزائرُ ما زال يقرأ admin_notes.';
  END IF;
  IF has_column_privilege('anon', 'public.store_profiles', 'subscription_amount', 'SELECT') THEN
    RAISE EXCEPTION 'الزائرُ ما زال يقرأ مبلغَ الاشتراك.';
  END IF;
  IF NOT has_column_privilege('anon', 'public.store_profiles', 'vat_number', 'SELECT') THEN
    RAISE EXCEPTION 'الزائرُ لم يعد يقرأ الرقمَ الضريبيّ — وذاك إفصاحٌ نظاميّ على صفحة المتجر.';
  END IF;
  IF has_column_privilege('authenticated', 'public.store_profiles', 'admin_notes', 'SELECT') THEN
    RAISE EXCEPTION 'الموثَّقُ ما زال يقرأ admin_notes.';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.store_profiles', 'delivery_fee', 'SELECT') THEN
    RAISE EXCEPTION 'كُسرت شاشةُ التوصيل للتاجر.';
  END IF;

  -- (د) حارسُ الدفع — **شرطاً شرطاً**، ولسببٍ مدفوعِ الثمن:
  --     أوّلُ اختبارٍ كتبتُه هنا اكتفى بالدفعتين القائمتين، وهما من أغسطس
  --     وسبتمبر ⇒ ترفضهما **نافذةُ الساعتين** لا غيابُ المرجع. فأعطبتُ شرطَ
  --     المرجع عمداً و**مرّ الاختبار** — أي أنه كان يُبرّئ الشرطَ الخطأ.
  --     🪤 القاعدةُ المستخلَصة: حارسٌ من عدّة شروطٍ مقترنة يحتاج **حالةً لكلّ
  --        شرط**، وحالةً موجبةً تُثبت أن المسارَ السليم لم يُقفل.
  v_m := NULL;
  SELECT id INTO v_m FROM public.users WHERE user_type IN ('seller','admin')
   ORDER BY created_at LIMIT 1;
  IF v_m IS NOT NULL THEN
    INSERT INTO public.subscription_payments (id, merchant_id, amount, status, created_at, currency)
    VALUES ('v1531-probe', v_m, 999.99, 'paid', now(), 'SAR');

    -- (د-١) حديثةٌ بلا مرجعِ بوّابة ⇒ تُرفض
    IF public._taki_sub_payment_ok(v_m, 8, 999.99) IS NOT FALSE THEN
      RAISE EXCEPTION '🔴 دفعةٌ حديثةٌ بلا مرجعٍ أجازت الاشتراك — شرطُ المرجع لا يعمل.';
    END IF;
    -- (د-٢) بمرجعٍ ومبلغٍ ناقص ⇒ تُرفض
    UPDATE public.subscription_payments
       SET gateway_reference = 'probe_ref', amount = 10 WHERE id = 'v1531-probe';
    IF public._taki_sub_payment_ok(v_m, 8, 999.99) IS NOT FALSE THEN
      RAISE EXCEPTION '🔴 مبلغٌ أقلُّ من سعر الباقة أجاز الاشتراك.';
    END IF;
    -- (د-٣) 🟢 بمرجعٍ وبالمبلغ الكامل ⇒ **تُقبل**، وإلّا فالحارسُ يقفل البيعَ
    --        إلى الأبد بعد ربط بوّابةٍ حقيقية بدل أن يحرسه.
    UPDATE public.subscription_payments SET amount = 999.99 WHERE id = 'v1531-probe';
    IF public._taki_sub_payment_ok(v_m, 8, 999.99) IS NOT TRUE THEN
      RAISE EXCEPTION '🔴 دفعةٌ حقيقيّةٌ كاملةٌ رُفضت — الحارسُ يقفل البيعَ لا يحرسه.';
    END IF;
    -- (د-٤) وخارج نافذة الساعتين ⇒ تُرفض
    UPDATE public.subscription_payments
       SET created_at = now() - interval '3 hours' WHERE id = 'v1531-probe';
    IF public._taki_sub_payment_ok(v_m, 8, 999.99) IS NOT FALSE THEN
      RAISE EXCEPTION '🔴 دفعةٌ عمرُها ٣ ساعات أجازت الاشتراك — النافذةُ لا تعمل.';
    END IF;

    DELETE FROM public.subscription_payments WHERE id = 'v1531-probe';
    IF EXISTS (SELECT 1 FROM public.subscription_payments WHERE id = 'v1531-probe') THEN
      RAISE EXCEPTION '❌ صفُّ القياس لم يُحذف — لا تُترك دفعةُ فحصٍ في سجلٍّ ماليّ.';
    END IF;
  END IF;
  -- وباقةُ الصفر تبقى متاحة
  IF public._taki_sub_payment_ok('من-لا-دفعةَ-له', 1, 0) IS NOT TRUE THEN
    RAISE EXCEPTION 'باقةٌ بسعرِ صفرٍ مُنعت — وذاك خطأ.';
  END IF;

  -- (هـ) والمفتاحُ عاد مطفأً
  IF (SELECT value FROM public.platform_settings WHERE key='payment_gateway_enabled')
     IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'الوضعُ المدفوع ما زال مُشتغلاً.';
  END IF;

  RAISE NOTICE '✅ v15.31: صفرُ امتيازٍ يتجاوز RLS · الزائرُ بلا ملاحظاتٍ ولا مبالغ · لا اشتراكَ بلا دفعةٍ بمرجع · والمحاكاةُ ممنوعة.';
END
$verify$;

SELECT 'الخادم' AS "البند", current_setting('server_version') AS "القيمة"
UNION ALL SELECT 'TRUNCATE/TRIGGER/REFERENCES للزائر والموثَّق',
  (SELECT count(*)::text FROM information_schema.role_table_grants
    WHERE table_schema='public' AND privilege_type IN ('TRUNCATE','TRIGGER','REFERENCES')
      AND grantee IN ('anon','authenticated'))
UNION ALL SELECT 'الزائر يقرأ admin_notes؟',
  CASE WHEN has_column_privilege('anon','public.store_profiles','admin_notes','SELECT')
       THEN '❌ نعم' ELSE '✅ لا' END
UNION ALL SELECT 'حارسُ الدفع مزروع؟',
  CASE WHEN position('_taki_sub_payment_ok' IN
    pg_get_functiondef('public.subscribe_self_to_package(integer)'::regprocedure)) > 0
  THEN '✅' ELSE '❌' END
UNION ALL SELECT 'حارسُ sim مزروع؟',
  CASE WHEN position('SIM_NOT_ALLOWED' IN
    pg_get_functiondef('public.merchant_set_gateway(text,text,text,text,jsonb)'::regprocedure)) > 0
  THEN '✅' ELSE '❌' END
UNION ALL SELECT 'الوضعُ المدفوع',
  (SELECT value::text FROM public.platform_settings WHERE key='payment_gateway_enabled');
