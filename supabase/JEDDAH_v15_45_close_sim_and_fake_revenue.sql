-- ═══════════════════════════════════════════════════════════════════════════
-- v15.45 — بابُ المال المجّاني يُغلق بالبناء · وإيرادٌ لم يدخل يُقال كما هو
-- ═══════════════════════════════════════════════════════════════════════════
-- أمرُ ناصر: «أكمِل النواقصَ الثلاثة ولا أريد أيّ ثقوبٍ بعد اليوم».
--
-- ١) مزوّدُ `sim` يختم الطلبَ «مدفوعاً» بلا أن يمرّ ريال. وهو اليوم:
--      • مفعَّلٌ على مستوى المنصّة  (`enabled_pay_providers.sim = true`)
--      • **ومفعَّلٌ على متجر ناصر الحيّ** (`provider='sim'` · `is_enabled`
--        · `verified_at` مضبوط · `payment_modes='both'`)
--    أي أن أيَّ زائرٍ يستطيع إتمامَ طلبٍ مدفوعٍ مجّاناً. يُغلق اليوم.
--    🪤 والإغلاقُ **بالبناء لا بمفتاح**: مفتاحٌ يُطفأ يُعاد إشعالُه بضغطة،
--       وقد أُشعل فعلاً مرّةً من قبل. فالقاعدةُ نفسُها ترفض المحاكاةَ على
--       قاعدةِ إنتاج، وتسمح بها على المختبر (وسمُ المخطّط هو الفارق).
--
-- ٢) 🔴 وثقبٌ في عملي أنا (v15.40): `tr_guard_fake_sub_payment` كان
--    **`BEFORE INSERT` وحده**. فحارسُ «لا دفعةَ اشتراكٍ مدفوعة بلا مزوّد»
--    لا يرى `UPDATE` إطلاقاً — وتحويلُ صفٍّ قائم إلى `paid` يمرّ من فوقه.
--    وهو المسارُ الذي تستعمله `confirm_subscription_payment` فعلاً.
--
-- ٣) ودفعتا اشتراكٍ «مدفوعتان» بـ٢٩٩٫٩٩ ريال لكلٍّ (٥٩٩٫٩٨) كتبهما التجديدُ
--    التلقائيّ قبل v15.40 بمزوّدٍ `simulated` — **وهما كلُّ إيراد تاكي
--    المسجَّل**. لم يدخل منهما ريال. تُصحَّح إلى `gifted` (وهي حالةٌ قائمة
--    في القيد، ويسمح بها الحارسُ نفسُه) مع تدوين السبب في `metadata`.
--    🪤 ولا يُحذف الصفّان: الحذفُ يمحو الدليلَ ويثقب تسلسلَ أرقام الفواتير
--       (٣ و٤). والتصحيحُ يجب أن يُرى، لا أن يُخفى.
--    🪤 ولا إشعارَ يخرج للتاجر: `notify_subscription_invoice` تشترط
--       `NEW.status = 'paid'` — و`gifted` لا تُوقظها. (قِيس في نصّها.)
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
     = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.pay_provider_on(text)') IS NULL
     OR to_regprocedure('public.deal_payment_mode(text)') IS NULL
     OR to_regprocedure('public.tr_guard_fake_sub_payment()') IS NULL THEN
    RAISE EXCEPTION 'أساسُ v12.81/v15.40 غائب — أوقِفت.';
  END IF;
END
$guard$;

-- ── ١) «أنا قاعدةُ إنتاج» سؤالٌ يُسأل مرّةً واحدة ──────────────────────────
-- 🪤 والوسمُ معكوسُ المنطق عمداً: المختبرُ **هو** الذي يحمل علامة، فقاعدةٌ
--    جديدة بلا وسمٍ تُعامَل إنتاجاً — والافتراضُ الآمن أن تُمنع المحاكاة لا
--    أن تُسمح. (لو كان الوسمُ على الإنتاج لفتحت قاعدةٌ منسيّةُ الوسم البابَ.)
CREATE OR REPLACE FUNCTION public.taki_is_lab()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
         = 'TAKI_LAB_TOKYO_MARKER_v1382';
$function$;

REVOKE ALL ON FUNCTION public.taki_is_lab() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_is_lab() FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_is_lab() TO authenticated, service_role;

-- ── ٢) المحاكاةُ مطفأةٌ على الإنتاج مهما قال صفُّ الإعدادات ────────────────
-- 🔴 هذه هي نقطةُ الاختناق الحقيقية: `deal_payment_mode` تسأل
--    `pay_provider_on(provider)` قبل كلّ شيء، فإن كذّبتها هنا سقط المتجرُ إلى
--    «الدفع عند الاستلام» ولو بقي صفُّ البوّابة مفعَّلاً. والمفتاحُ في
--    `platform_settings` يبقى — لكنّه لم يَعُد يُصدَّق في المحاكاة.
CREATE OR REPLACE FUNCTION public.pay_provider_on(p_provider text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN lower(COALESCE(p_provider, '')) IN ('sim', 'simulated') AND NOT public.taki_is_lab()
      THEN false
    ELSE COALESCE(
      (SELECT (value ->> p_provider)::boolean FROM public.platform_settings
        WHERE key = 'enabled_pay_providers'), false)
  END;
$function$;

-- ── ٣) ولا تُكتب بوّابةُ محاكاةٍ مفعَّلة على الإنتاج أصلاً ─────────────────
-- 🪤 والرفضُ مشروطٌ بـ`is_enabled` لا بوجود الصفّ: الصفُّ التاريخيُّ يبقى
--    دليلاً (مطفأً)، ولا يستطيع أحدٌ إشعالَه — لا التاجرُ ولا الأدمن.
CREATE OR REPLACE FUNCTION public.tr_guard_sim_gateway()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF lower(COALESCE(NEW.provider, '')) IN ('sim', 'simulated')
     AND COALESCE(NEW.is_enabled, false)
     AND NOT public.taki_is_lab() THEN
    RAISE EXCEPTION 'مزوّدُ المحاكاة لا يُفعَّل على قاعدة الإنتاج — لا مال يمرّ فيه'
      USING ERRCODE = 'P0031';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tr_guard_sim_gateway ON public.merchant_gateways;
CREATE TRIGGER tr_guard_sim_gateway
  BEFORE INSERT OR UPDATE ON public.merchant_gateways
  FOR EACH ROW EXECUTE FUNCTION public.tr_guard_sim_gateway();

-- ── ٤) وإطفاءُ ما هو قائم: صفُّ متجر ناصر ───────────────────────────────────
UPDATE public.merchant_gateways
   SET is_enabled = false, verified_at = NULL, updated_at = now()
 WHERE lower(COALESCE(provider, '')) IN ('sim', 'simulated')
   AND (is_enabled OR verified_at IS NOT NULL);

-- وصفُّ الإعدادات يقول الحقيقةَ أيضاً، فلا يُقرأ «مفعَّل» ويُفهم خطأً.
UPDATE public.platform_settings
   SET value = jsonb_set(value, '{sim}', 'false'::jsonb)
 WHERE key = 'enabled_pay_providers' AND COALESCE((value->>'sim')::boolean, false);

-- ── ٥) ثقبُ v15.40: الحارسُ لم يكن يرى التعديل ─────────────────────────────
-- 🔴 و`confirm_subscription_payment` تُحوّل `pending → paid` بـ`UPDATE` ولا
--    تضع مزوّداً إطلاقاً. فتوسيعُ الحارس إلى `UPDATE` وحده كان سيكسر مسارَ
--    الأدمن السليم (يُرفض بـP0030). ⇒ تُصلَح الدالّةُ معه في نفس الهجرة:
--    تختم `admin_confirmed` فتقول **من** ضمِن الدفعةَ لا أنّها هبطت وحدها.
DROP TRIGGER IF EXISTS tr_guard_fake_sub_payment ON public.subscription_payments;
CREATE TRIGGER tr_guard_fake_sub_payment
  BEFORE INSERT OR UPDATE ON public.subscription_payments
  FOR EACH ROW EXECUTE FUNCTION public.tr_guard_fake_sub_payment();

-- والدالّةُ تُبنى من نصّها الحيّ لا من نسخة المستودع (النسخُ تنحرف).
CREATE OR REPLACE FUNCTION public.confirm_subscription_payment(p_payment_id text, p_gateway_reference text)
 RETURNS merchant_subscriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_payment subscription_payments;
    v_sub merchant_subscriptions;
    v_caller_role TEXT;
BEGIN
    SELECT user_type INTO v_caller_role FROM users WHERE id = auth.uid()::text;
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Only admins can confirm payments';
    END IF;

    SELECT * INTO v_payment FROM subscription_payments WHERE id = p_payment_id;
    IF v_payment IS NULL THEN
        RAISE EXCEPTION 'Payment not found';
    END IF;

    -- v15.45 — ويُختم **من** ضمِن الدفعة: الصفُّ كان يصير «مدفوعاً» بلا أيّ
    -- أثرٍ لمن أقرّ بوصولها ولا كيف. و`tr_guard_fake_sub_payment` صار يرى
    -- التعديلَ أيضاً (كان `BEFORE INSERT` وحده)، فمزوّدٌ فارغٌ يُرفض بحقّ.
    UPDATE subscription_payments
    SET status = 'paid',
        gateway_provider = COALESCE(NULLIF(gateway_provider, ''), 'admin_confirmed'),
        gateway_reference = p_gateway_reference,
        paid_at = NOW()
    WHERE id = p_payment_id;

    UPDATE merchant_subscriptions
    SET status = 'active',
        current_period_start = COALESCE(v_payment.period_start, NOW()),
        current_period_end = COALESCE(v_payment.period_end, NOW() + interval '30 days'),
        last_renewed_at = NOW(),
        updated_at = NOW()
    WHERE id = v_payment.subscription_id
    RETURNING * INTO v_sub;

    INSERT INTO notifications (user_id, title_ar, title_en, body_ar, body_en, type)
    VALUES (v_payment.merchant_id,
        '✅ تم تجديد اشتراكك', '✅ Subscription renewed',
        'استلمنا دفعتك بنجاح. اشتراكك ساري حتى ' ||
            to_char(COALESCE(v_payment.period_end, NOW() + interval '30 days'), 'YYYY-MM-DD'),
        'We received your payment. Your subscription is active until ' ||
            to_char(COALESCE(v_payment.period_end, NOW() + interval '30 days'), 'YYYY-MM-DD'),
        'system');

    RETURN v_sub;
END;
$function$;

-- ── ٦) الإيرادُ الذي لم يدخل: ٢٩٩٫٩٩ × ٢ = ٥٩٩٫٩٨ ريال ────────────────────
-- كتبهما التجديدُ التلقائيّ قبل v15.40 بمزوّدٍ `simulated`. و`gifted` هي
-- الحقيقة: التاجرُ نال الفترةَ ولم يدفع. وكلُّ قارئِ إيرادٍ يرشّح
-- `status='paid'` (قِيس: admin_mrr_monthly · admin_ai_analyst ·
-- analyst_weekly_pulse)، فالرقمُ يسقط من الإيراد ويبقى الصفُّ شاهداً.
UPDATE public.subscription_payments
   SET status = 'gifted',
       metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
         'corrected_in', 'v15.45',
         'corrected_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'),
         'corrected_from', status,
         'correction_reason',
           'تجديدٌ تلقائيّ سجّل دفعةً «مدفوعة» بمزوّد simulated قبل حارس v15.40 — لم يمرّ مال')
 WHERE lower(COALESCE(status, '')) = 'paid'
   AND COALESCE(amount, 0) > 0
   AND lower(COALESCE(gateway_provider, '')) IN ('', 'simulated', 'sim');

-- ── ٧) القفلُ الأخير على الكاتب نفسِه ──────────────────────────────────────
-- 🪤 وتُبنى من نصّها الحيّ لا من نسخة المستودع.
CREATE OR REPLACE FUNCTION public._apply_merchant_payment(p_provider text, p_merchant_id text, p_payment_ref text, p_amount numeric, p_barcode text, p_status text DEFAULT 'paid'::text, p_vat numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_b public.bookings%ROWTYPE; v_rows integer; v_amt text;
BEGIN
  -- 🔴 v15.45 — القفلُ الأخير، وهذه هي الدالّةُ التي تختم `paid_at` فعلاً.
  -- كلُّ الحرّاس قبلها تحرس **الطريق** (pay_provider_on ⇐ _gateway_secrets
  -- ⇐ gatewayLive في الدالّة الحافة)، وهي وحدها كانت بلا فحصٍ خاصّ بها —
  -- فنداءٌ بـservice_role يلتفّ على الطريق كلّه ويختم طلباً «مدفوعاً» بصفر
  -- ريال. ولا يُقاس أمانٌ بعدد الأقفال على الطريق بل بقفلٍ على الباب نفسِه.
  IF lower(COALESCE(p_provider, '')) IN ('sim', 'simulated')
     AND COALESCE(p_status, '') = 'paid'
     AND NOT public.taki_is_lab() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SIM_NOT_ALLOWED');
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE barcode = p_barcode;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'BOOKING_NOT_FOUND'); END IF;

  INSERT INTO public.platform_payment_log
    (booking_barcode, merchant_id, buyer_id, amount, vat_amount, provider, payment_ref, status)
  VALUES (p_barcode, p_merchant_id, v_b.user_id, p_amount, COALESCE(p_vat, 0), p_provider, p_payment_ref, p_status)
  ON CONFLICT (provider, payment_ref) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN jsonb_build_object('ok', true, 'duplicate', true); END IF;

  IF p_status = 'paid' THEN
    UPDATE public.bookings
    SET paid_at = now(), payment_provider = p_provider, payment_ref = p_payment_ref, paid_amount = p_amount
    WHERE barcode = p_barcode AND paid_at IS NULL;
    UPDATE public.merchant_gateways SET fail_count = 0, updated_at = now() WHERE merchant_id = p_merchant_id;

    v_amt := trim(to_char(p_amount, 'FM999999990.09'));
    IF p_provider = 'sim' THEN
      INSERT INTO public.notifications (id, user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
      VALUES
        ('ntf_pay_b_' || (extract(epoch from clock_timestamp())*1000)::bigint || '_' || substr(md5(random()::text), 1, 6),
         v_b.user_id,
         '🧪 (تجريبي) تمت محاكاة دفعتك', '(Test) Simulated payment recorded',
         'وضع تجريبي: سُجّلت محاكاة دفع ' || v_amt || ' ر.س للحجز ' || p_barcode || ' — لم يُخصم أي مبلغ حقيقي.',
         'Test mode: a simulated payment of ' || v_amt || ' SAR was recorded for booking ' || p_barcode || ' — no real money was charged.',
         'booking', jsonb_build_object('audience', 'buyer', 'barcode', p_barcode)),
        ('ntf_pay_s_' || (extract(epoch from clock_timestamp())*1000)::bigint || '_' || substr(md5(random()::text), 1, 6),
         p_merchant_id,
         '🧪 (تجريبي) محاكاة دفعة على حجز', '(Test) Simulated payment on a booking',
         'وضع تجريبي: سُجّلت محاكاة دفع ' || v_amt || ' ر.س على الحجز ' || p_barcode || ' — تنبيه: لا يوجد أي مبلغ حقيقي، هذه تجربة للنظام فقط.',
         'Test mode: a simulated payment of ' || v_amt || ' SAR was recorded on booking ' || p_barcode || ' — note: NO real money was received.',
         'booking', jsonb_build_object('audience', 'seller', 'barcode', p_barcode));
    ELSE
      INSERT INTO public.notifications (id, user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
      VALUES
        ('ntf_pay_b_' || (extract(epoch from clock_timestamp())*1000)::bigint || '_' || substr(md5(random()::text), 1, 6),
         v_b.user_id,
         '💳 تم استلام دفعتك بنجاح', 'Payment received',
         'تم دفع ' || v_amt || ' ر.س إلكترونياً لحساب التاجر مباشرة. حجزك: ' || p_barcode,
         'Paid ' || v_amt || ' SAR directly to the merchant. Booking: ' || p_barcode,
         'booking', jsonb_build_object('audience', 'buyer', 'barcode', p_barcode)),
        ('ntf_pay_s_' || (extract(epoch from clock_timestamp())*1000)::bigint || '_' || substr(md5(random()::text), 1, 6),
         p_merchant_id,
         '💰 دفعة جديدة وصلت حسابك', 'New payment received',
         'استلمت ' || v_amt || ' ر.س في حساب بوابتك عن الحجز ' || p_barcode || ' — المبلغ في حسابك مباشرة دون أي عمولة.',
         'You received ' || v_amt || ' SAR in your gateway account for booking ' || p_barcode || '.',
         'booking', jsonb_build_object('audience', 'seller', 'barcode', p_barcode));
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);
END $function$;

-- ── تحقّقٌ بنيويّ يُفشل الهجرة إن كذبت ─────────────────────────────────────
-- 🪤 يُجرَّد التعليقُ قبل أيّ فحصِ نصّ: شرحُ هذه الهجرة يحوي `sim` و`simulated`
--    فيُبرّئ الكودَ المكسور (v15.40 · v15.22 · v14.97).
DO $verify$
DECLARE
  nude text := '--[^' || chr(10) || ']*';
  s_pay text; s_conf text;
BEGIN
  s_pay  := regexp_replace(pg_get_functiondef('public.pay_provider_on(text)'::regprocedure), nude, '', 'g');
  s_conf := regexp_replace(pg_get_functiondef('public.confirm_subscription_payment(text,text)'::regprocedure), nude, '', 'g');

  IF public.taki_is_lab() THEN
    RAISE EXCEPTION '❌ وسمُ المختبر موجود على قاعدةِ إنتاج — كلُّ الحرّاس ستنفتح';
  END IF;
  IF position('taki_is_lab' IN s_pay) = 0 THEN
    RAISE EXCEPTION '❌ pay_provider_on لا تسأل عن المختبر — المحاكاةُ تعود بمفتاح';
  END IF;
  IF public.pay_provider_on('sim') OR public.pay_provider_on('simulated') THEN
    RAISE EXCEPTION '❌ المحاكاةُ ما زالت مفعَّلةً على الإنتاج';
  END IF;
  IF NOT public.pay_provider_on('moyasar') THEN
    RAISE EXCEPTION '❌ أُطفئ مزوّدٌ حقيقيّ بالخطأ — هذا كسرٌ لا إغلاق';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.merchant_gateways'::regclass
                   AND tgname='tr_guard_sim_gateway' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '❌ حارسُ بوّابة المحاكاة غير مُركَّب';
  END IF;
  IF EXISTS (SELECT 1 FROM public.merchant_gateways
              WHERE lower(COALESCE(provider,'')) IN ('sim','simulated')
                AND (COALESCE(is_enabled,false) OR verified_at IS NOT NULL)) THEN
    RAISE EXCEPTION '❌ ما زالت بوّابةُ محاكاةٍ مفعَّلةً أو موثَّقة';
  END IF;

  -- حارسُ دفعات الاشتراك صار يرى التعديلَ أيضاً
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.subscription_payments'::regclass
                   AND tgname='tr_guard_fake_sub_payment' AND NOT tgisinternal
                   AND pg_get_triggerdef(oid) LIKE '%BEFORE INSERT OR UPDATE%') THEN
    RAISE EXCEPTION '❌ حارسُ دفعات الاشتراك ما زال لا يرى UPDATE';
  END IF;
  IF position('SIM_NOT_ALLOWED' IN regexp_replace(pg_get_functiondef(
       'public._apply_merchant_payment(text,text,text,numeric,text,text,numeric)'::regprocedure), nude, '', 'g')) = 0 THEN
    RAISE EXCEPTION '❌ الكاتبُ النهائيّ بلا قفل — نداءٌ بـservice_role يختم طلباً مجّاناً';
  END IF;
  IF position('admin_confirmed' IN s_conf) = 0 THEN
    RAISE EXCEPTION '❌ تأكيدُ الأدمن بلا مزوّد — الحارسُ الموسَّع سيرفض مسارَه السليم';
  END IF;

  -- ولا دفعةَ «مدفوعة» بلا مزوّدٍ حقيقيّ بقيت
  IF EXISTS (SELECT 1 FROM public.subscription_payments
              WHERE lower(COALESCE(status,'')) = 'paid' AND COALESCE(amount,0) > 0
                AND lower(COALESCE(gateway_provider,'')) IN ('', 'simulated', 'sim')) THEN
    RAISE EXCEPTION '❌ ما زال إيرادٌ وهميّ مسجَّلاً «مدفوعاً»';
  END IF;
  -- والصفّان لم يُحذفا: الدليلُ باقٍ وأرقامُ الفواتير بلا ثقب
  IF (SELECT count(*) FROM public.subscription_payments) < 2 THEN
    RAISE EXCEPTION '❌ حُذف صفُّ دفعة — الدليلُ ضاع وتسلسلُ الفواتير انثقب';
  END IF;
END
$verify$;

-- ── تحقّقٌ **سلوكيّ**: الحارسُ يُجرَّب لا يُقرأ (درس v15.42) ───────────────
-- 🪤 ولا يُدرَج صفٌّ في `subscription_payments` إطلاقاً: `tr_assign_invoice_no`
--    تأخذ الرقمَ من **تسلسل** (`nextval('taki_invoice_seq')`)، والتسلسلُ لا
--    يعود بالإرجاع — فإدراجٌ تجريبيّ يحرق رقمَ فاتورةٍ إلى الأبد ويثقب
--    تسلسلاً يُفترض ألّا ثقبَ فيه. فالتجريبُ على صفٍّ قائم وحده.
DO $behave$
DECLARE
  v_store text; v_mode text; v_sell jsonb; v_id text; v_hit boolean; v_free text;
BEGIN
  SELECT merchant_id INTO v_store FROM public.merchant_gateways
   WHERE lower(COALESCE(provider,'')) IN ('sim','simulated') LIMIT 1;
  -- 🪤 ومتجرٌ حقيقيٌّ بلا بوّابة للتجربة: `merchant_gateways.merchant_id`
  --    مفتاحٌ أجنبيّ إلى `users`، فمعرّفٌ مخترَع يُردّ بـFK لا بحارسنا —
  --    وكان ذلك سيُخفي أنّ الحارسَ لم يُختبر أصلاً.
  SELECT u.id INTO v_free FROM public.users u
   WHERE u.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.merchant_gateways g WHERE g.merchant_id = u.id)
   LIMIT 1;

  BEGIN
    -- (أ) لا تُشعَل بوّابةُ محاكاةٍ قائمة
    IF v_store IS NOT NULL THEN
      BEGIN
        UPDATE public.merchant_gateways SET is_enabled = true WHERE merchant_id = v_store;
        RAISE EXCEPTION '❌ أُشعلت بوّابةُ المحاكاة — الحارسُ لا يحرس';
      EXCEPTION WHEN SQLSTATE 'P0031' THEN NULL;
      END;
    END IF;

    -- (ب) ولا تُنشأ واحدةٌ جديدة مفعَّلة
    BEGIN
      INSERT INTO public.merchant_gateways (merchant_id, provider, is_enabled)
      VALUES (v_free, 'sim', true);
      RAISE EXCEPTION '❌ أُنشئت بوّابةُ محاكاةٍ مفعَّلة';
    EXCEPTION WHEN SQLSTATE 'P0031' THEN NULL;
    END;

    -- (ج) ومزوّدٌ حقيقيٌّ لا يُمنع — الإغلاقُ ليس كسراً
    IF v_free IS NULL THEN
      RAISE EXCEPTION '❌ لا متجرَ بلا بوّابة للتجربة — الاختبارُ سيُتخطّى بصمت';
    END IF;
    INSERT INTO public.merchant_gateways (merchant_id, provider, is_enabled)
    VALUES (v_free, 'moyasar', true);
    IF NOT EXISTS (SELECT 1 FROM public.merchant_gateways WHERE merchant_id = v_free) THEN
      RAISE EXCEPTION '❌ مُنع مزوّدٌ حقيقيّ';
    END IF;

    -- (د) ومتجرُ ناصر سقط إلى «الدفع عند الاستلام» ولم يُمنع من البيع
    IF v_store IS NOT NULL THEN
      v_mode := public.deal_payment_mode(v_store);
      IF v_mode <> 'cod' THEN
        RAISE EXCEPTION '❌ المتجرُ ما زال يعرض الدفعَ الإلكترونيّ (%) بعد إغلاق المحاكاة', v_mode;
      END IF;
      v_sell := public.store_can_sell(v_store);
      IF NOT COALESCE((v_sell->>'ok')::boolean, false) THEN
        RAISE EXCEPTION '❌ توقّف المتجرُ عن البيع بعد الإغلاق: %', v_sell::text;
      END IF;
    END IF;

    -- (د٢) 🔴 والقيمةُ التي تقرؤها **الدالّةُ الحافة** نفسُها مغلقة.
    --      `merchant-pay/index.ts:115` تشترط `provider_enabled === true`،
    --      و`_gateway_secrets` تحسبها بـ`pay_provider_on(g.provider)` — فهذه
    --      هي البوّابةُ الأخيرة قبل `_apply_merchant_payment` التي تختم
    --      `paid_at`. وهي الدالّةُ الوحيدة في السلسلة بلا حارس `sim` خاصّ بها،
    --      فإغلاقُها من هنا هو ما يُغلق المالَ فعلاً لا الواجهةَ فحسب.
    IF v_store IS NOT NULL THEN
      IF COALESCE((public._gateway_secrets(v_store)->>'provider_enabled')::boolean, true) THEN
        RAISE EXCEPTION '❌ بوّابةُ الدالّة الحافة ما زالت مفتوحة — المالُ يُختم مجّاناً';
      END IF;
    END IF;

    -- (د٣) والكاتبُ النهائيّ يرفض المحاكاةَ ولو نُودي مباشرةً
    IF COALESCE((public._apply_merchant_payment(
          'sim', COALESCE(v_store,'x'), 'SIM-TEST-ROLLBACK', 1,
          (SELECT barcode FROM public.bookings LIMIT 1), 'paid', 0)->>'error'), '') <> 'SIM_NOT_ALLOWED' THEN
      RAISE EXCEPTION '❌ الكاتبُ النهائيّ قبل دفعةَ محاكاة';
    END IF;

    -- (هـ) وحارسُ دفعات الاشتراك صار يرى **التعديل**: صفٌّ قائم يُعاد إلى
    --      «مدفوعة» بمزوّدٍ وهميّ ⇒ يُرفض. (ثقبُ v15.40 مسدود.)
    SELECT id INTO v_id FROM public.subscription_payments LIMIT 1;
    IF v_id IS NOT NULL THEN
      BEGIN
        UPDATE public.subscription_payments
           SET status = 'paid', gateway_provider = 'simulated' WHERE id = v_id;
        RAISE EXCEPTION '❌ مرّ تعديلٌ يُسجّل إيراداً وهميّاً — الحارسُ ما زال أعمى عن UPDATE';
      EXCEPTION WHEN SQLSTATE 'P0030' THEN NULL;
      END;
      -- ومزوّدٌ حقيقيٌّ يمرّ، فالحارسُ ليس سدّاً عامّاً
      UPDATE public.subscription_payments
         SET status = 'paid', gateway_provider = 'moyasar' WHERE id = v_id;
      SELECT lower(status) = 'paid' INTO v_hit FROM public.subscription_payments WHERE id = v_id;
      IF NOT COALESCE(v_hit, false) THEN
        RAISE EXCEPTION '❌ رُفضت دفعةٌ بمزوّدٍ حقيقيّ — الحارسُ يمنع السليم';
      END IF;
    END IF;

    -- (و) والإيرادُ المسجَّل صار صفراً
    IF (SELECT COALESCE(sum(amount),0) FROM public.subscription_payments
         WHERE lower(COALESCE(status,'')) = 'paid'
           AND lower(COALESCE(gateway_provider,'')) IN ('', 'simulated', 'sim')) <> 0 THEN
      RAISE EXCEPTION '❌ ما زال إيرادٌ وهميٌّ محسوباً';
    END IF;

    RAISE EXCEPTION 'TAKI_V1545_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM <> 'TAKI_V1545_ROLLBACK' THEN RAISE; END IF;
  END;
END
$behave$;

-- ── جدولٌ للقراءة (الإفشالُ أعلاه) ─────────────────────────────────────────
SELECT 'الخادم' AS "البند", current_setting('server_version') AS "القيمة"
UNION ALL SELECT 'المختبر؟', CASE WHEN public.taki_is_lab() THEN 'نعم ⚠️' ELSE 'لا (إنتاج)' END
UNION ALL SELECT 'المحاكاة مفعَّلة؟', CASE WHEN public.pay_provider_on('sim') THEN '❌ نعم' ELSE '✅ لا' END
UNION ALL SELECT 'ميسر مفعَّل؟', CASE WHEN public.pay_provider_on('moyasar') THEN '✅ نعم' ELSE '❌ لا' END
UNION ALL SELECT 'بوّابةُ محاكاةٍ مفعَّلة', (SELECT count(*)::text FROM public.merchant_gateways
   WHERE lower(COALESCE(provider,'')) IN ('sim','simulated') AND COALESCE(is_enabled,false))
UNION ALL SELECT 'وضعُ الدفع لمتجر ناصر', public.deal_payment_mode('2c0b4cde-79c3-4290-abaa-812a895b1bcb')
UNION ALL SELECT 'متجر ناصر يبيع؟', CASE WHEN COALESCE((public.store_can_sell('2c0b4cde-79c3-4290-abaa-812a895b1bcb')->>'ok')::boolean,false) THEN '✅ نعم' ELSE '❌ لا' END
UNION ALL SELECT 'إيرادُ تاكي المسجَّل (ريال)', (SELECT COALESCE(sum(amount),0)::text FROM public.subscription_payments WHERE lower(COALESCE(status,''))='paid')
UNION ALL SELECT 'دفعاتٌ صُحِّحت إلى gifted', (SELECT count(*)::text FROM public.subscription_payments WHERE status='gifted')
UNION ALL SELECT 'صفوفُ الدفعات (لم تُحذف)', (SELECT count(*)::text FROM public.subscription_payments);
