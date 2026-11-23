-- ════════════════════════════════════════════════════════════════════════════
-- v16.54 — تعويضُ الأعطال: بضغطةٍ واحدة لتاجرٍ أو لمحدّدين أو للكلّ
-- ════════════════════════════════════════════════════════════════════════════
-- أمرُ ناصر (٢٣ نوفمبر ٢٠٢٦): «زرّ إرجاع المبلغ بضغطةٍ واحدة من الأدمن
-- للتاجر، أو أحدّد تجّاراً معيّنين، أو مثل تحديد الكل، في حال وجود أعطال —
-- بنقرةٍ واحدة، نفس طريقة إرجاع المبلغ من التاجر للمشتري».
--
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 ما قِيس أوّلاً — وهو يُغيّر شكلَ الحلّ لا تفاصيلَه
-- ════════════════════════════════════════════════════════════════════════════
-- ① **تاكي لم تستقبل ريالاً واحداً من تاجرٍ حتى اليوم.** `subscription_payments`
--    فيه **صفّان، كلاهما `gifted`**، ومسارُ الدفع في `src/services/paymentService.ts`
--    (`initiateMoyasarPayment`) **محاكاةٌ صريحة**: `setTimeout` ثمّ
--    `success:true`، بلا أيّ اتّصالٍ ببوّابة. و`platform_payment_log` (٧ صفوف)
--    مدفوعاتُ **طلباتٍ** إلى بوّابة التاجر لا اشتراكات.
--    ⇒ لا يوجد مالٌ في حوزة تاكي تردُّه برمجياً. وهذه نفسُ قاعدة v14.18
--      («تاكي وسيط ولا تملك المال») مطبَّقةً على الطرف الآخر من المعادلة.
--
-- ② ولذلك التعويضُ **نوعان**، والفرقُ بينهما ليس تفضيلاً بل قدرة:
--    · **أيّام** ⇒ تُضاف إلى اشتراك التاجر **فوراً ويقيناً**: تاكي تملك
--      هذا كلَّه، فالتنفيذُ مكتمِلٌ لحظةَ الضغط.
--    · **مبلغ** ⇒ يُسجَّل **التزاماً مستحقّاً** (`pending_cash`) ويُشعَر به
--      التاجر، ثمّ يُحوّله ناصر بنكياً ويختمه بمرجعٍ (`admin_settle_outage_cash`).
--      ولا يُقال «رُدّ المبلغ» قبل المرجع — نفسُ منطق `booking_refunds`:
--      تُسجّل وتُبلّغ وتُثبت، ولا تدّعي ما لم يقع.
--
-- ③ **المصدرُ الحاكم للاشتراك هو `store_profiles.subscription_expires_at`**
--    لا `merchant_subscriptions` — قِيس: يقرؤه ٢٠ دالّةً وستّةُ ملفّات واجهة
--    (`tr_guard_store_billing` · `ensure_active_subscription` · البوت)، بينما
--    الجدولان **لا يتزامنان أصلاً**: متجرُ «تاكي» له صفٌّ في الأوّل بتاريخٍ
--    حتى ٢٠٢٦-١٢-١٩ و**لا صفَّ له في الثاني**، ومتجرا «N15» و«الأناقة» لهما
--    صفٌّ `trial` بلا تاريخٍ و`subscription_expires_at` **فارغ**.
--    ⇒ تُكتب الأيامُ في `store_profiles`، ويُزامَن الآخرُ إن وُجد صفُّه فقط.
--
-- ④ و`grant_subscription_bulk` موجودةٌ منذ زمن و**صفرُ منادٍ لها في الواجهة**
--    (دالّةٌ ميّتة). ولا تصلح أساساً لهذا:
--    · **تدهس الفترة** (`current_period_start = now()`): تاجرٌ له عشرون يوماً
--      باقية ثمّ «تعويضُ» سبعةِ أيّام ⇒ **يخسر ثلاثةَ عشرَ يوماً**. التعويضُ
--      **يُضيف** ولا يستبدل: `GREATEST(القائم, now()) + الأيام`.
--    · وحارسُها `user_type = 'admin'` وحده ⇒ **أيُّ أدمنٍ فرعيّ** يمنح
--      اشتراكاتٍ مجّانيّةً للجميع (نفسُ صنف ثغرة v14.38).
--
-- ════════════════════════════════════════════════════════════════════════════
-- 🔒 الأمن — زرٌّ يمسّ كلَّ التجّار بضغطةٍ واحدة هو أخطرُ زرٍّ في المنصّة
-- ════════════════════════════════════════════════════════════════════════════
--  · صلاحيةٌ **جديدة** `action_grant_credit` لا `is_admin()` ولا
--    `action_view_finance`: تلك **قراءةُ** ماليّات، وهذا فعلٌ يُخرج قيمة.
--  · **مفتاحُ تكرارٍ إلزاميّ** (`p_batch_key`): ضغطتان أو إعادةُ إرسالٍ من
--    الشبكة = دفعةٌ واحدة. وهذا درسُ v14.97 حرفياً: الاسترداد ليس عمليّةً
--    آمنة التكرار، والقفلُ يسبق الأثر لا يتبعه.
--  · `FOR UPDATE` على صفّ المتجر قبل تمديده — فدفعتان متزامنتان لا تتسابقان.
--  · سقوفٌ صلبة: ١–٣٦٥ يوماً · ٠٫٠١–٥٠٬٠٠٠ ر.س · ٥٠٠ تاجرٍ في الدفعة.
--  · سببٌ إلزاميٌّ ≥ ١٠ محارف — يُحفظ ويُعرض في السجلّ وفي إشعار التاجر.
--  · حدُّ معدّل: خمسُ دفعاتٍ في الساعة.
--  · السجلُّ **لا يُحذف ولا يُعدَّل**: لا سياسةَ كتابةٍ على الجدول إطلاقاً،
--    وكلُّ كتابةٍ عبر دوال DEFINER. ولا زرَّ تراجعٍ عن الأيام: التاجرُ قد
--    نشر عروضاً بناءً عليها، وسحبُها بعدَ منحِها يكسر وعداً أُعطي.
--  · و**المعاينةُ قبل التنفيذ** إلزاميّةٌ في الواجهة: يُقاس العددُ والمجموع
--    ويُعرضان قبل الضغط (درسُ «القياس أوّلاً» في كنس العروض غير الموثّقة).
-- ════════════════════════════════════════════════════════════════════════════

-- ── ⓪ حارسُ الخادم: لا تُنفَّذ على المختبر (طوكيو) ─────────────────────────
DO $guard$
BEGIN
    IF obj_description('public'::regnamespace, 'pg_namespace')
       = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
        RAISE EXCEPTION 'هذه هجرةُ إنتاج — الخادمُ أمامها هو المختبر (طوكيو). أوقِف.';
    END IF;
END $guard$;

-- ════════════════════════════════════════════════════════════════════════════
-- ① السجلّ
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.outage_credits (
    id            text PRIMARY KEY DEFAULT ('oc_' || replace(gen_random_uuid()::text,'-','')),
    -- دفعةٌ واحدةٌ لكلّ ضغطة. مشتقٌّ من مفتاح التكرار الذي ترسله الواجهة.
    batch_id      text NOT NULL,
    merchant_id   text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    kind          text NOT NULL CHECK (kind IN ('days','cash')),
    days          integer CHECK (days IS NULL OR (days >= 1 AND days <= 365)),
    amount        numeric(12,2) CHECK (amount IS NULL OR (amount > 0 AND amount <= 50000)),
    currency      text NOT NULL DEFAULT 'SAR',
    -- `applied`      الأيامُ أُضيفت فعلاً (نهائيّ)
    -- `pending_cash` مبلغٌ مستحقٌّ لم يُحوَّل بعد
    -- `paid`         حُوِّل وأُثبت بمرجع
    -- `failed`       تعذّر التحويل، بسببٍ مكتوب
    status        text NOT NULL CHECK (status IN ('applied','pending_cash','paid','failed')),
    reason        text NOT NULL,
    admin_id      text NOT NULL,
    -- لقطةُ ما قبل وبعد — فيُقرأ أثرُ التعويض بعد شهورٍ بلا استنتاج.
    expires_before timestamptz,
    expires_after  timestamptz,
    transfer_ref  text,
    transfer_note text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    settled_at    timestamptz,
    -- عقدٌ صريح: لكلّ نوعٍ حقلُه، ولا صفَّ بلا قيمة.
    CONSTRAINT outage_credits_kind_fields CHECK (
        (kind = 'days' AND days IS NOT NULL AND amount IS NULL)
     OR (kind = 'cash' AND amount IS NOT NULL AND days IS NULL)),
    CONSTRAINT outage_credits_reason_len CHECK (length(btrim(reason)) >= 10)
);

-- تاجرٌ **مرّةً واحدة** في الدفعة — وهذا هو مفتاحُ التكرار الحقيقيّ: إعادةُ
-- الإرسال بنفس `batch_key` تصطدم به فتُهمَل، ولا يُمنح التعويضُ مرّتين.
CREATE UNIQUE INDEX IF NOT EXISTS idx_oc_batch_merchant
    ON public.outage_credits (batch_id, merchant_id);
CREATE INDEX IF NOT EXISTS idx_oc_merchant ON public.outage_credits (merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oc_pending  ON public.outage_credits (created_at DESC) WHERE status = 'pending_cash';

-- 🔴 الجدولُ الجديد يُولد بكلّ DML ممنوحاً لـ`authenticated` على سوبابيس —
--    فلا يكفي `REVOKE … FROM PUBLIC` (درس v14.25 وv15.81).
ALTER TABLE public.outage_credits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.outage_credits FROM PUBLIC;
REVOKE ALL ON public.outage_credits FROM anon;
REVOKE ALL ON public.outage_credits FROM authenticated;
GRANT SELECT ON public.outage_credits TO authenticated;

-- الأدمنُ صاحبُ الصلاحية يقرأ كلَّ شيء · والتاجرُ يقرأ **تعويضاتِه هو**
-- (فيرى في لوحته لماذا امتدّ اشتراكُه). ولا سياسةَ كتابةٍ إطلاقاً.
DROP POLICY IF EXISTS oc_select_admin ON public.outage_credits;
CREATE POLICY oc_select_admin ON public.outage_credits
    FOR SELECT TO authenticated
    USING ((SELECT public.taki_admin_perm('action_grant_credit')));
DROP POLICY IF EXISTS oc_select_own ON public.outage_credits;
CREATE POLICY oc_select_own ON public.outage_credits
    FOR SELECT TO authenticated
    USING (merchant_id = (SELECT auth.uid())::text);

-- ════════════════════════════════════════════════════════════════════════════
-- ② من يشمله النطاق — دالّةٌ واحدةٌ تقرؤها المعاينةُ والتنفيذ
-- ════════════════════════════════════════════════════════════════════════════
-- 🪤 **مصدرٌ واحدٌ للقائمة** عمداً: لو بنت المعاينةُ قائمتَها والتنفيذُ قائمتَه
--    لانحرفتا، فيرى ناصر «١٢ تاجراً» ويُنفَّذ على أربعةَ عشر. وهذا أسوأُ من
--    خطأ: قرارٌ بُني على رقمٍ كاذب.
CREATE OR REPLACE FUNCTION public.taki_outage_scope(p_scope text, p_ids text[])
RETURNS TABLE (merchant_id text, shop text, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT u.id,
         COALESCE(NULLIF(btrim(u.shop),''), NULLIF(btrim(u.name),''), 'متجر'),
         sp.subscription_expires_at
    FROM public.users u
    LEFT JOIN public.store_profiles sp ON sp.store_id = u.id
   WHERE u.deleted_at IS NULL
     -- 🪤 «ليس مشترياً» لا `user_type='seller'`: كلُّ مرشِّحٍ بـ`seller`
     --    يُخفي متجرَ ناصر المملوكَ لحساب أدمن (قاعدةٌ مدفوعةُ الثمن).
     AND u.user_type <> 'buyer'
     AND (NULLIF(btrim(COALESCE(u.shop,'')),'') IS NOT NULL OR u.user_type = 'seller')
     AND (
          (p_scope = 'all')
       OR (p_scope = 'selected' AND u.id = ANY(COALESCE(p_ids, '{}'::text[])))
       -- المشتركون فقط: من له تاريخُ انتهاءٍ سارٍ — وهم من تضرّروا بالعطل فعلاً.
       OR (p_scope = 'subscribed' AND sp.subscription_expires_at IS NOT NULL
                                  AND sp.subscription_expires_at > now())
     )
   ORDER BY 2;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- ③ المعاينة — يُقاس قبل أن يُضغط
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_preview_outage_credit(
    p_scope text, p_ids text[] DEFAULT NULL,
    p_kind text DEFAULT 'days', p_days integer DEFAULT NULL, p_amount numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n integer; v_rows jsonb;
BEGIN
  IF NOT (SELECT public.taki_admin_perm('action_grant_credit')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_scope NOT IN ('all','selected','subscribed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_SCOPE'); END IF;

  SELECT count(*), COALESCE(jsonb_agg(jsonb_build_object(
            'merchant_id', s.merchant_id, 'shop', s.shop, 'expires_at', s.expires_at)
            ORDER BY s.shop), '[]'::jsonb)
    INTO v_n, v_rows
    FROM public.taki_outage_scope(p_scope, p_ids) s;

  RETURN jsonb_build_object(
    'ok', true, 'count', v_n, 'rows', v_rows,
    'kind', p_kind,
    'days', p_days,
    -- المجموعُ يُحسب هنا لا في المتصفّح: رقمٌ يُقرّر عليه لا يُؤتمن عليه العميل.
    'total_amount', CASE WHEN p_kind = 'cash' THEN round(COALESCE(p_amount,0) * v_n, 2) END);
END
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- ④ التنفيذ — ذرّيّ، بمفتاح تكرار، وبسقوفٍ صلبة
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_grant_outage_credit(
    p_batch_key text, p_scope text, p_ids text[], p_kind text,
    p_days integer, p_amount numeric, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_me     text := (SELECT auth.uid())::text;
  v_batch  text;
  v_reason text := btrim(COALESCE(p_reason, ''));
  r        record;
  v_before timestamptz;
  v_after  timestamptz;
  v_done   integer := 0;
  v_skipped integer := 0;
  v_n      integer;
  v_money  text;
BEGIN
  IF NOT (SELECT public.taki_admin_perm('action_grant_credit')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_scope NOT IN ('all','selected','subscribed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_SCOPE'); END IF;
  IF p_kind NOT IN ('days','cash') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_KIND'); END IF;
  IF length(v_reason) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED'); END IF;
  IF NULLIF(btrim(COALESCE(p_batch_key,'')),'') IS NULL THEN
    -- بلا مفتاحٍ لا ضمانَ ضدّ ضغطتين. يُرفض بدل أن يُخترع هنا.
    RETURN jsonb_build_object('ok', false, 'error', 'BATCH_KEY_REQUIRED'); END IF;

  IF p_kind = 'days' THEN
    IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'BAD_DAYS'); END IF;
  ELSE
    IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 50000 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'BAD_AMOUNT'); END IF;
  END IF;

  -- حدُّ المعدّل **قبل** أيّ أثر: خمسُ دفعاتٍ في الساعة تكفي عطلاً حقيقياً،
  -- وتمنع سيناريو «ضغطٌ متكرّرٌ في لحظة ذعر».
  BEGIN
    PERFORM public.taki_rate_check('outage:' || v_me, 5, 3600, 'RATE_LIMIT');
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TOO_MANY');
  END;

  v_batch := 'ocb_' || encode(extensions.digest(v_me || '|' || btrim(p_batch_key), 'sha256'), 'hex');

  SELECT count(*) INTO v_n FROM public.taki_outage_scope(p_scope, p_ids);
  IF v_n = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'EMPTY_SCOPE'); END IF;
  IF v_n > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SCOPE_TOO_LARGE', 'count', v_n); END IF;

  FOR r IN SELECT * FROM public.taki_outage_scope(p_scope, p_ids) LOOP
    -- 🔴 القفلُ على صفّ المتجر قبل قراءته: دفعتان متزامنتان لا تقرآن نفسَ
    --    التاريخ القديم فتكتبان فوق بعضهما (أثرُ أحدهما يضيع صامتاً).
    SELECT sp.subscription_expires_at INTO v_before
      FROM public.store_profiles sp WHERE sp.store_id = r.merchant_id FOR UPDATE;

    IF p_kind = 'days' THEN
      -- 🔴 **يُضاف ولا يَدهس**: `GREATEST(القائم, now())` — فتاجرٌ له عشرون
      --    يوماً باقية يصير عنده سبعةٌ وعشرون لا سبعة. (عيبُ
      --    `grant_subscription_bulk` بعينه، وهو ما جعلها غيرَ صالحةٍ هنا.)
      v_after := GREATEST(COALESCE(v_before, now()), now()) + (p_days || ' days')::interval;

      INSERT INTO public.outage_credits
        (batch_id, merchant_id, kind, days, status, reason, admin_id, expires_before, expires_after)
      VALUES (v_batch, r.merchant_id, 'days', p_days, 'applied', v_reason, v_me, v_before, v_after)
      ON CONFLICT (batch_id, merchant_id) DO NOTHING;
      IF NOT FOUND THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

      -- الكتابةُ في المصدر الحاكم، وبعد نجاح السجلّ لا قبله.
      UPDATE public.store_profiles
         SET subscription_expires_at = v_after, updated_at = now()
       WHERE store_id = r.merchant_id;
      -- 🪤 وتُزامَن المرآةُ **إن وُجد صفُّها فقط**: متجرُ ناصر بلا صفٍّ هناك،
      --    وإنشاءُ صفٍّ له هنا يخترع اشتراكاً لم يوجد.
      UPDATE public.merchant_subscriptions
         SET current_period_end = v_after, updated_at = now()
       WHERE merchant_id = r.merchant_id;

      -- 🪤 `subscription` نوعٌ مسموحٌ في `notifications_type_check` (قِيس):
      --    قيدُ CHECK والكودُ الذي يكتبه ينحرفان بلا صوت، وثلاثةُ مسارات في
      --    هذه المنصّة لم تنجح ولا مرّة بسبب ذلك (v14.78).
      INSERT INTO public.notifications
        (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
      VALUES (r.merchant_id, '🎁 عوّضناك عن العطل', 'Service credit applied',
        'أضفنا ' || public.taki_ar_days(p_days) || ' إلى اشتراكك تعويضاً عن العطل. السبب: ' || v_reason,
        'We added ' || p_days || ' day(s) to your subscription as a service credit. Reason: ' || v_reason,
        'subscription',
        jsonb_build_object('audience','seller','actionUrl','/subscription','action_url','/subscription'));
      v_done := v_done + 1;

    ELSE
      -- مبلغٌ مستحقّ: يُسجَّل ويُشعَر به، **ولا يُدَّعى أنه وصل**.
      INSERT INTO public.outage_credits
        (batch_id, merchant_id, kind, amount, status, reason, admin_id, expires_before)
      VALUES (v_batch, r.merchant_id, 'cash', round(p_amount,2), 'pending_cash', v_reason, v_me, v_before)
      ON CONFLICT (batch_id, merchant_id) DO NOTHING;
      IF NOT FOUND THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

      v_money := trim(to_char(round(p_amount,2), 'FM999999990.09'));
      INSERT INTO public.notifications
        (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
      VALUES (r.merchant_id, '💸 تعويضٌ مستحقٌّ لك', 'A credit is due to you',
        'سجّلنا لك تعويضاً قدره ' || v_money || ' ر.س عن العطل، وسيصلك بالتحويل. السبب: ' || v_reason,
        'We recorded a ' || v_money || ' SAR credit for the outage; it will reach you by transfer. Reason: ' || v_reason,
        'subscription',
        jsonb_build_object('audience','seller','actionUrl','/subscription','action_url','/subscription'));
      v_done := v_done + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'batch_id', v_batch, 'kind', p_kind,
                            'granted', v_done, 'skipped', v_skipped, 'scope_count', v_n);
END
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑤ ختمُ التحويل — «رُدّ المبلغ» لا تُقال إلّا بمرجع
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_settle_outage_cash(
    p_id text, p_ok boolean, p_ref text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_me text := (SELECT auth.uid())::text; r record; v_ref text; v_money text;
BEGIN
  IF NOT (SELECT public.taki_admin_perm('action_grant_credit')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.outage_credits WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF r.kind <> 'cash' THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_CASH'); END IF;
  -- خاملةُ التكرار: إعادةُ إرسالٍ بعد ختمٍ ناجح لا تُصدر إشعاراً ثانياً.
  IF r.status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'ref', r.transfer_ref); END IF;
  IF r.status NOT IN ('pending_cash','failed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_STATE', 'state', r.status); END IF;

  IF NOT COALESCE(p_ok, false) THEN
    UPDATE public.outage_credits
       SET status = 'failed', transfer_note = NULLIF(btrim(COALESCE(p_note,'')),''), settled_at = now()
     WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'state', 'failed');
  END IF;

  -- 🔴 المرجعُ إلزاميٌّ للنجاح: «حُوِّل» بلا مرجعٍ ادّعاءٌ لا إثبات، والتاجرُ
  --    يحتاج ما يراجع به بنكَه.
  v_ref := NULLIF(btrim(COALESCE(p_ref,'')),'');
  IF v_ref IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'REF_REQUIRED'); END IF;

  UPDATE public.outage_credits
     SET status = 'paid', transfer_ref = left(v_ref,120),
         transfer_note = NULLIF(btrim(COALESCE(p_note,'')),''), settled_at = now()
   WHERE id = p_id;

  v_money := trim(to_char(r.amount, 'FM999999990.09'));
  INSERT INTO public.notifications
    (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
  VALUES (r.merchant_id, '✅ حُوِّل تعويضك', 'Your credit was transferred',
    'حوّلنا لك ' || v_money || ' ر.س — المرجع: ' || v_ref || '. ومدّةُ وصوله يحدّدها البنك لا تاكي.',
    'We transferred ' || v_money || ' SAR — reference: ' || v_ref || '.',
    'subscription',
    jsonb_build_object('audience','seller','actionUrl','/subscription','action_url','/subscription'));

  RETURN jsonb_build_object('ok', true, 'state', 'paid', 'ref', v_ref);
END
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑥ السجلّ
-- ════════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.admin_list_outage_credits(text, integer);
CREATE FUNCTION public.admin_list_outage_credits(p_status text DEFAULT 'all', p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_rows jsonb;
BEGIN
  IF NOT (SELECT public.taki_admin_perm('action_grant_credit')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'created_at' DESC), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object(
             'id', c.id, 'batch_id', c.batch_id, 'merchant_id', c.merchant_id,
             'shop', COALESCE(NULLIF(btrim(u.shop),''), NULLIF(btrim(u.name),''), 'متجر'),
             'kind', c.kind, 'days', c.days, 'amount', c.amount,
             'status', c.status, 'reason', c.reason,
             'expires_before', c.expires_before, 'expires_after', c.expires_after,
             'transfer_ref', c.transfer_ref, 'transfer_note', c.transfer_note,
             'created_at', c.created_at, 'settled_at', c.settled_at) AS x
      FROM public.outage_credits c
      LEFT JOIN public.users u ON u.id = c.merchant_id
     WHERE (p_status IS NULL OR p_status = 'all' OR c.status = p_status)
     ORDER BY c.created_at DESC
     LIMIT GREATEST(1, LEAST(1000, COALESCE(p_limit, 200)))
  ) s;
  RETURN jsonb_build_object('ok', true, 'rows', v_rows,
      'pending_cash', (SELECT count(*) FROM public.outage_credits WHERE status='pending_cash'),
      'pending_amount', (SELECT COALESCE(sum(amount),0) FROM public.outage_credits WHERE status='pending_cash'));
END
$function$;

-- 🔴 المنحُ صريحٌ في الاتجاهين (درس v14.26).
REVOKE ALL ON FUNCTION public.taki_outage_scope(text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_preview_outage_credit(text, text[], text, integer, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_grant_outage_credit(text, text, text[], text, integer, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_settle_outage_cash(text, boolean, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_outage_credits(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_preview_outage_credit(text, text[], text, integer, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_outage_credit(text, text, text[], text, integer, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_settle_outage_cash(text, boolean, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_outage_credits(text, integer) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑦ التحقّق — `DO` يرفع استثناءً (جدولُ ✅/❌ لا يُفشل psql — درس v14.51)
-- ════════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE v_n integer;
BEGIN
    -- (أ) لا سياسةَ كتابةٍ إطلاقاً، ولا DML لـ`authenticated`
    SELECT count(*) INTO v_n FROM pg_policy
     WHERE polrelid = 'public.outage_credits'::regclass AND polcmd <> 'r';
    IF v_n <> 0 THEN RAISE EXCEPTION 'الفحص ①: سياسةُ كتابةٍ على سجلّ التعويضات (%)', v_n; END IF;
    IF has_table_privilege('authenticated','public.outage_credits','INSERT')
       OR has_table_privilege('authenticated','public.outage_credits','UPDATE')
       OR has_table_privilege('authenticated','public.outage_credits','DELETE') THEN
        RAISE EXCEPTION 'الفحص ①ب: `authenticated` يملك DML على سجلّ التعويضات';
    END IF;
    IF has_table_privilege('anon','public.outage_credits','SELECT') THEN
        RAISE EXCEPTION 'الفحص ①ج: `anon` يقرأ سجلّ التعويضات';
    END IF;

    -- (ب) دالّةُ النطاق ليست سطحاً عامّاً — تُنادى من الدوالّ وحدها
    IF has_function_privilege('authenticated','public.taki_outage_scope(text,text[])','EXECUTE') THEN
        RAISE EXCEPTION 'الفحص ②: `taki_outage_scope` مكشوفةٌ لـ`authenticated` — تسريبُ قائمة التجّار';
    END IF;
    IF has_function_privilege('anon','public.admin_grant_outage_credit(text,text,text[],text,integer,numeric,text)','EXECUTE') THEN
        RAISE EXCEPTION 'الفحص ②ب: `anon` ينفّذ منحَ التعويض';
    END IF;

    -- (ج) القيودُ تمنع صفّاً بلا قيمةٍ أو بسببٍ قصير
    BEGIN
        INSERT INTO public.outage_credits (batch_id, merchant_id, kind, status, reason, admin_id)
        SELECT 'b_test', id, 'days', 'applied', 'سببٌ طويلٌ كافٍ للاختبار', id FROM public.users LIMIT 1;
        RAISE EXCEPTION 'الفحص ③: صفُّ أيّامٍ بلا `days` قُبل';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO public.outage_credits (batch_id, merchant_id, kind, days, status, reason, admin_id)
        SELECT 'b_test', id, 'days', 7, 'applied', 'قصير', id FROM public.users LIMIT 1;
        RAISE EXCEPTION 'الفحص ③ب: سببٌ قصيرٌ قُبل';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- (د) مفتاحُ التكرار: فهرسٌ فريدٌ على (الدفعة × التاجر)
    SELECT count(*) INTO v_n FROM pg_indexes
     WHERE tablename = 'outage_credits' AND indexname = 'idx_oc_batch_merchant';
    IF v_n <> 1 THEN RAISE EXCEPTION 'الفحص ④: لا فهرسَ فريداً للدفعة — ضغطتان تمنحان مرّتين'; END IF;

    -- (هـ) الأيامُ **تُضاف** لا تَدهس — يُقاس نصُّ الدالّة مجرَّداً من التعليق
    IF position('GREATEST' IN
         regexp_replace(pg_get_functiondef('public.admin_grant_outage_credit'::regproc), '--[^\n]*', '', 'g')) = 0 THEN
        RAISE EXCEPTION 'الفحص ⑤: الأيامُ تُكتب بلا GREATEST — تاجرٌ له رصيدٌ باقٍ يخسره';
    END IF;

    RAISE NOTICE '✅ v16.54 — كلُّ الفحوص الخمسة نجحت';
END $verify$;

SELECT 'سجلُّ التعويضات' AS "البند", count(*)::text AS "القيمة" FROM public.outage_credits
UNION ALL SELECT 'نطاقُ «الكل»',       (SELECT count(*)::text FROM public.taki_outage_scope('all', NULL))
UNION ALL SELECT 'نطاقُ «المشتركون»', (SELECT count(*)::text FROM public.taki_outage_scope('subscribed', NULL));
