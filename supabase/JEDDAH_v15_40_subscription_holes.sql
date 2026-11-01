-- ═══════════════════════════════════════════════════════════════════════════
-- v15.40 — ثلاثةُ ثقوبٍ تمنح اشتراكاً مدفوعاً بلا ريال (أمرُ ناصر)
-- ═══════════════════════════════════════════════════════════════════════════
-- v15.31 سدّت ثقبَ الموقع (`subscribe_self_to_package`). والقياسُ على جدّة
-- (١ نوفمبر ٢٠٢٦) يقول إن ثلاثةً بقيت مفتوحة:
--
--  ١) `bot_subscribe_plan` **بلا أيّ فحصِ دفع**: قِيس
--     `position('_taki_sub_payment_ok' IN pg_get_functiondef(...)) > 0` ⇒ false.
--     فحالما يُفتح الوضعُ المدفوع، أيُّ تاجرٍ يضغط «تأكيد الاشتراك» في تيليجرام
--     أو واتساب يأخذ الباقة الكاملة **بصفر ريال**، بتجديدٍ تلقائيّ وفاتورة.
--
--  ٢) `taki_subscription_maintenance` (كرون كلّ ساعة، الدقيقة ٢٠) **يُجدّد
--     الباقات المسعَّرة مجّاناً** ويكتب صفّ دفعةٍ «مدفوعة» بمبلغ الباقة.
--     🔴 وهذا ليس نظرياً: قِيس أنه عمل **مرّتين فعلاً** — ١٣ أغسطس و٦ سبتمبر،
--        ٢٩٩٫٩٩ ر.س لكلٍّ — وهما **كلُّ** «إيراد» تاكي المسجَّل.
--
--  ٣) `record_subscription_payment` ممنوحةٌ لـ`authenticated`: أيُّ تاجرٍ
--     يحقن إيراداتٍ وهمية بلا سقفٍ ولا حدّ معدّل، فيحرق أرقامَ فواتير ضريبية
--     (العدّاد ٦ والصفوف ٢ ⇒ **الفجوات قائمة**)، ويُفجّر بريدَ فاتورةٍ من نطاق
--     تاكي بنصٍّ يختاره، ويُضخّم الإقرار الضريبيّ الربعيّ.
--
-- 🟢 والوضعُ المدفوع **مطفأٌ الآن** — فالثقوبُ مفخَّخةٌ لا نازفة. وهذا بالضبط
--    ما يجب سدُّه **قبل** أن يُفتح، لا بعده.
--
-- 🔴 وجردُ الكُتّاب كشف ما هو أعمق: **أربعة مسارات تكتب `subscription_payments`،
--    وكلُّها تكتب `gateway_provider='simulated'`** — أي أن كلّ «دفعة» في
--    النظام وهميّةٌ بالبناء، لأنه لا توجد بوّابةُ تحصيلٍ لتاكي أصلاً. فبدل
--    ترقيع عشر دوالِّ قراءة، يُمنع **كتابةُ** الصفّ الوهميّ من أصله بمشغّل.
-- 🪤 ولا يُمسّ `admin_grant`: تلك دفعةٌ حقيقيةٌ يقبضها ناصر خارج المنصّة
--    (تحويلٌ بنكيّ) ويُسجّلها بنفسه — منعُها يكسر أداةً مشروعة.
-- 🪤 وبُنيت الدوالُّ الثلاث من **النصّ الحيّ** لا من المستودع.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public._taki_sub_payment_ok(text,integer,numeric)') IS NULL
     OR to_regprocedure('public.taki_is_system_caller()') IS NULL THEN
    RAISE EXCEPTION 'حارسا v15.31/v14.96 غائبان — الأساسُ مختلف، أوقِفت.';
  END IF;
END
$guard$;

-- ١) الدوالّ الثلاث ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bot_subscribe_plan(p_telegram_id bigint, p_package_id integer, p_whatsapp_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_sid text; v_pkgs jsonb; v_pkg jsonb; v_max int; v_price numeric; v_days int; v_exp timestamptz;
BEGIN
  IF NOT public.bot_payments_enabled() THEN RETURN jsonb_build_object('success',false,'error','free_mode'); END IF;
  SELECT id INTO v_sid FROM users WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id) AND user_type IN ('seller','admin') AND deleted_at IS NULL LIMIT 1;
  IF v_sid IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_seller'); END IF;
  SELECT value INTO v_pkgs FROM platform_settings WHERE key='location_packages' LIMIT 1;
  IF v_pkgs IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_packages'); END IF;
  SELECT p INTO v_pkg FROM jsonb_array_elements(v_pkgs) p
    WHERE (p->>'id')::int = p_package_id AND COALESCE((p->>'active')::boolean,true) LIMIT 1;
  IF v_pkg IS NULL THEN RETURN jsonb_build_object('success',false,'error','bad_package'); END IF;

  v_max   := COALESCE((v_pkg->>'max')::int, 1);
  v_days  := COALESCE((v_pkg->>'durationDays')::int, 30);
  v_price := round( COALESCE((v_pkg->>'price')::numeric,0) * (1 - COALESCE((v_pkg->>'discount')::numeric,0)/100), 2 );
  v_exp   := NOW() + (v_days::text || ' days')::interval;

  -- 🔴 v15.40 — نفسُ حارس الويب (v15.31)، وكان **غائباً هنا**: قِيس على جدّة
  --    أن `bot_subscribe_plan` لا تحوي `_taki_sub_payment_ok` إطلاقاً. فحالما
  --    يُفتح الوضعُ المدفوع كان أيُّ تاجرٍ يفتح تيليجرام ويضغط «تأكيد الاشتراك»
  --    فيأخذ الباقةَ الكاملة **بصفر ريال**، بتجديدٍ تلقائيٍّ وفاتورةٍ ضريبية.
  --    والثقبُ هو الذي سُدّ في الموقع v15.31 وبقي مفتوحاً على القناتين.
  IF NOT public._taki_sub_payment_ok(v_sid, p_package_id, v_price) THEN
    RETURN jsonb_build_object('success', false, 'error', 'payment_not_confirmed');
  END IF;

  IF EXISTS (SELECT 1 FROM store_profiles WHERE store_id=v_sid) THEN
    UPDATE store_profiles SET
      subscription_plan='premium', subscription_started_at=NOW(), subscription_expires_at=v_exp,
      auto_renew=true, subscription_canceled_at=NULL, subscription_amount=v_price,
      max_branches=v_max, updated_at=NOW()
    WHERE store_id=v_sid;
  ELSE
    INSERT INTO store_profiles (store_id, subscription_plan, subscription_started_at, subscription_expires_at,
      auto_renew, subscription_canceled_at, subscription_amount, max_branches, updated_at)
    VALUES (v_sid, 'premium', NOW(), v_exp, true, NULL, v_price, v_max, NOW());
  END IF;

  -- 🪤 v15.40 — حُذف إدراجُ صفّ الدفعة: الحارسُ أعلاه لا يمرّ إلّا بدفعةٍ
  --    **مؤكَّدةٍ موجودةٍ أصلاً** في `subscription_payments` بمرجع بوّابة.
  --    فكتابةُ صفٍّ ثانٍ هنا تُضاعف الإيراد وتحرق رقمَ فاتورةٍ ضريبيّة.
  --    وكان يكتب `gateway_provider='simulated'` — أي «لم يصل مال».

  RETURN (SELECT jsonb_build_object('success',true,'plan_ar',v_pkg->>'ar','max_branches',v_max,
        'price',v_price,'expires_at',v_exp,'days',v_days,
        /* v13.36 */
        'vat', t.vat_due, 'total', round(v_price + t.vat_due, 2))
      FROM (SELECT CASE WHEN COALESCE((s.value->>'vat_enabled')::boolean,false)
                         AND COALESCE((s.value->>'prices_include_vat')::boolean,true) = false
                   THEN round(v_price * COALESCE(NULLIF(s.value->>'vat_rate','')::numeric,15) / 100, 2)
                   ELSE 0 END AS vat_due
            FROM (SELECT value FROM platform_settings WHERE key='tax_settings'
                  UNION ALL SELECT '{}'::jsonb LIMIT 1) s) t);
END $function$;

CREATE OR REPLACE FUNCTION public.taki_subscription_maintenance()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$

DECLARE
    v_enabled boolean;
    s_warn jsonb; s_exp jsonb; s_renew jsonb;
    v_days int;
    v_warned  int := 0; v_expired int := 0; v_frozen int := 0; v_banners int := 0;
    v_renewed int := 0;
    r record; vars jsonb; v_title text; v_body text; v_body_en text;
BEGIN
    SELECT (value = 'true'::jsonb) INTO v_enabled
      FROM platform_settings WHERE key = 'payment_gateway_enabled';
    IF v_enabled IS NOT TRUE THEN
        RETURN jsonb_build_object('mode','free','warned',0,'renewed',0,'expired',0,'frozen',0,'banners_hidden',0);
    END IF;

    s_warn  := public.taki_msg_setting('sub_warning');
    s_exp   := public.taki_msg_setting('sub_expired');
    s_renew := public.taki_msg_setting('sub_renewed');
    v_days := LEAST(GREATEST(COALESCE((s_warn->>'days_before')::int, 3), 1), 60);

    IF COALESCE((s_warn->>'enabled')::boolean, true) THEN
        FOR r IN
            UPDATE store_profiles sp
            SET last_expiry_warning_at = NOW()
            WHERE sp.subscription_expires_at IS NOT NULL
              AND lower(COALESCE(sp.subscription_plan,'free')) IN ('premium','trial')
              AND sp.subscription_expires_at > NOW()
              AND sp.subscription_expires_at <= NOW() + (v_days || ' days')::interval
              -- v13.97 (طلب ناصر): لا تحذير لمن سيتجدّد اشتراكه تلقائياً — لا شيء
              -- مطلوبٌ منه، وإنذار «جدّد الآن» لمن لن ينقطع اشتراكه يُدرّب المستخدم
              -- على تجاهل إشعارات المنصة. التجارب تبقى تُحذَّر لأنها تنتهي فعلاً.
              AND NOT (lower(COALESCE(sp.subscription_plan,'')) = 'premium'
                       AND sp.auto_renew IS NOT FALSE
                       AND sp.subscription_canceled_at IS NULL)
              AND (sp.last_expiry_warning_at IS NULL
                   OR sp.last_expiry_warning_at < sp.subscription_expires_at - (v_days || ' days')::interval)
            RETURNING sp.store_id, sp.subscription_expires_at, sp.subscription_plan,
                      sp.auto_renew, sp.subscription_canceled_at, sp.subscription_amount
        LOOP
            vars := jsonb_build_object(
                'store',   COALESCE((SELECT u.name FROM users u WHERE u.id = r.store_id), ''),
                'days',    v_days::text,
                'expires', to_char(r.subscription_expires_at, 'YYYY-MM-DD'));
            v_title   := public.taki_render_template(s_warn->>'title_ar', vars);
            v_body    := public.taki_render_template(s_warn->>'body_ar',  vars);
            v_body_en := public.taki_render_template(s_warn->>'body_en',  vars);
            IF COALESCE((s_warn->'channels'->>'inapp')::boolean, true) THEN
                INSERT INTO notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
                VALUES (r.store_id, v_title,
                        public.taki_render_template(s_warn->>'title_en', vars),
                        v_body,
                        v_body_en,
                        'system', jsonb_build_object('audience','seller','event','sub_warning'), NOW());
            END IF;
            IF COALESCE((s_warn->'channels'->>'email')::boolean, false) THEN
                PERFORM public.taki_queue_email(r.store_id, 'sub_warning', v_title,
                    public.taki_email_wrap(v_title, '<p>' || replace(v_body, E'\n', '<br>') || '</p>'));
            END IF;
            v_warned := v_warned + 1;
        END LOOP;
    END IF;

    -- (a2) v12.67 auto-renew; v12.68 notification gated by sub_renewed setting
    FOR r IN
        UPDATE store_profiles sp
        SET subscription_started_at = NOW(),
            subscription_expires_at = NOW() + (
                GREATEST(1, LEAST(730, COALESCE(
                    ROUND(EXTRACT(EPOCH FROM (sp.subscription_expires_at - sp.subscription_started_at)) / 86400.0)::int,
                    30)))::text || ' days')::interval,
            updated_at = NOW()
        WHERE sp.subscription_expires_at IS NOT NULL
          AND sp.subscription_expires_at <= NOW()
          AND lower(COALESCE(sp.subscription_plan,'free')) = 'premium'
          AND sp.auto_renew IS NOT FALSE
          AND sp.subscription_canceled_at IS NULL
          AND sp.subscription_started_at IS NOT NULL
          -- 🔴 v15.40 — باقةٌ **مسعَّرة** لا تُجدَّد مجّاناً. كان هذا الكرون
          --    (كلّ ساعة، الدقيقة ٢٠) يمدّ اشتراكَ كلّ تاجرٍ «بريميوم» بلا
          --    أيّ خصمٍ من بطاقة، ويكتب صفَّ دفعةٍ «مدفوعة» بمبلغ الباقة.
          --    وقِيس أنه **عمل مرّتين فعلاً** على الإنتاج (١٣ أغسطس و٦ سبتمبر،
          --    ٢٩٩٫٩٩ ر.س لكلٍّ) — وهما كلُّ «إيراد» تاكي المسجَّل.
          --    والتجديدُ الحقيقيّ يلزمه رمزُ بطاقةٍ محفوظٌ عند المزوّد، ولا
          --    يملكه أحدٌ اليوم. فالمسعَّرُ **ينقضي** ويُنبَّه صاحبُه.
          AND COALESCE(sp.subscription_amount, 0) <= 0
        RETURNING sp.store_id, sp.subscription_started_at AS new_start,
                  sp.subscription_expires_at AS new_end,
                  sp.subscription_amount, sp.max_branches
    LOOP
        v_renewed := v_renewed + 1;
        -- 🪤 v15.40 — تجديدٌ بلا مالٍ لا فاتورةَ له: حُذف إدراجُ الدفعة.
        --    وبعد الشرط أعلاه لا يصل هنا إلا ما سعرُه صفر، وصفرٌ لا يُفوتَر.
        UPDATE merchant_subscriptions ms
        SET current_period_start = r.new_start, current_period_end = r.new_end,
            last_renewed_at = NOW(), updated_at = NOW()
        WHERE ms.merchant_id = r.store_id AND ms.status = 'active';
        IF COALESCE((s_renew->>'enabled')::boolean, true) THEN
            vars := jsonb_build_object(
                'store',   COALESCE((SELECT u.name FROM users u WHERE u.id = r.store_id), ''),
                'price',   round(COALESCE(r.subscription_amount,0),2)::text,
                'expires', to_char(r.new_end, 'YYYY-MM-DD'));
            v_title := public.taki_render_template(s_renew->>'title_ar', vars);
            v_body  := public.taki_render_template(s_renew->>'body_ar',  vars);
            IF COALESCE((s_renew->'channels'->>'inapp')::boolean, true) THEN
                INSERT INTO notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
                VALUES (r.store_id, v_title,
                        public.taki_render_template(s_renew->>'title_en', vars),
                        v_body,
                        public.taki_render_template(s_renew->>'body_en', vars),
                        'system', jsonb_build_object('audience','seller','event','sub_renewed'), NOW());
            END IF;
            IF COALESCE((s_renew->'channels'->>'email')::boolean, false) THEN
                PERFORM public.taki_queue_email(r.store_id, 'sub_renewed', v_title,
                    public.taki_email_wrap(v_title, '<p>' || replace(v_body, E'\n', '<br>') || '</p>'));
            END IF;
        END IF;
    END LOOP;

    -- (b) freeze deals of just-expired merchants (unchanged business rule)
    WITH froze AS (
        UPDATE deals d
        SET status = 'paused', subscription_frozen = TRUE
        WHERE d.status = 'active'
          AND d.store_id IN (
              SELECT store_id FROM store_profiles
              WHERE subscription_expires_at IS NOT NULL
                AND subscription_expires_at <= NOW()
                AND lower(COALESCE(subscription_plan,'free')) <> 'free'
          )
        RETURNING d.id
    )
    SELECT COUNT(*) INTO v_frozen FROM froze;

    -- (b2) v12.31 — hide the expired merchant's BANNERS too.
    WITH bfroze AS (
        UPDATE banners b
        SET is_active = FALSE, frozen_reason = 'subscription_expired'
        WHERE b.is_active
          AND b.store_id IS NOT NULL
          AND b.store_id IN (
              SELECT store_id FROM store_profiles
              WHERE subscription_expires_at IS NOT NULL
                AND subscription_expires_at <= NOW()
                AND lower(COALESCE(subscription_plan,'free')) <> 'free'
          )
        RETURNING b.id
    )
    SELECT COUNT(*) INTO v_banners FROM bfroze;

    -- (c) flip expired profiles to free + configurable notice
    FOR r IN
        UPDATE store_profiles
        SET subscription_plan = 'free', updated_at = NOW()
        WHERE subscription_expires_at IS NOT NULL
          AND subscription_expires_at <= NOW()
          AND lower(COALESCE(subscription_plan,'free')) <> 'free'
        RETURNING store_id, subscription_expires_at
    LOOP
        v_expired := v_expired + 1;
        IF COALESCE((s_exp->>'enabled')::boolean, true) THEN
            vars := jsonb_build_object(
                'store',   COALESCE((SELECT u.name FROM users u WHERE u.id = r.store_id), ''),
                'expires', to_char(r.subscription_expires_at, 'YYYY-MM-DD'));
            v_title := public.taki_render_template(s_exp->>'title_ar', vars);
            v_body  := public.taki_render_template(s_exp->>'body_ar',  vars);
            IF COALESCE((s_exp->'channels'->>'inapp')::boolean, true) THEN
                INSERT INTO notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
                VALUES (r.store_id, v_title,
                        public.taki_render_template(s_exp->>'title_en', vars),
                        v_body,
                        public.taki_render_template(s_exp->>'body_en', vars),
                        'system', jsonb_build_object('audience','seller','event','sub_expired'), NOW());
            END IF;
            IF COALESCE((s_exp->'channels'->>'email')::boolean, false) THEN
                PERFORM public.taki_queue_email(r.store_id, 'sub_expired', v_title,
                    public.taki_email_wrap(v_title, '<p>' || replace(v_body, E'\n', '<br>') || '</p>'));
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('mode','paid','warned',v_warned,'renewed',v_renewed,'expired',v_expired,'frozen',v_frozen,'banners_hidden',v_banners,'warn_days',v_days);
END;

$function$;

CREATE OR REPLACE FUNCTION public.record_subscription_payment(p_amount numeric, p_days integer, p_max integer, p_plan_label text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid text := auth.uid()::text; v_id text; v_plan_id text;
BEGIN
  -- 🔴 v15.40 — كانت ممنوحةً لكلّ موثَّق وتُدرج صفّاً `status='paid'` بلا سقفٍ
  --    ولا حدّ معدّل: أيُّ تاجرٍ يحقن إيراداتٍ وهمية، **ويحرق أرقامَ فواتير
  --    ضريبية** (تسلسلٌ لا يجوز أن تكون فيه فجوة)، ويُفجّر بريدَ فاتورةٍ من
  --    نطاق تاكي بنصٍّ يختاره هو، ويُضخّم إقرارَ الضريبة الربعيّ.
  -- 🪤 والمميِّز `taki_is_system_caller()` لا `current_user`: هذه الدالّة
  --    SECURITY DEFINER فـ`current_user` فيها هو المالك لا المنادي (درس v14.96).
  IF NOT public.taki_is_system_caller() THEN
    RAISE EXCEPTION 'SYSTEM_ONLY' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_authenticated'); END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN RETURN jsonb_build_object('success', false, 'error', 'bad_amount'); END IF;
  SELECT id INTO v_plan_id FROM subscription_plans
   WHERE id = p_plan_label OR code = p_plan_label OR name_ar = p_plan_label OR name_en = p_plan_label
   LIMIT 1;
  INSERT INTO subscription_payments (merchant_id, plan_id, amount, currency, status, payment_method, gateway_provider, branches_count, period_start, period_end, paid_at, metadata)
  VALUES (v_uid, v_plan_id, round(p_amount, 2), 'SAR', 'paid', 'web', 'simulated', p_max,
          NOW(), NOW() + (greatest(coalesce(p_days,30),1)::text || ' days')::interval, NOW(),
          jsonb_build_object('source','web','plan_label',p_plan_label))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'payment_id', v_id);
END $function$;

-- ٢) صلاحيةُ تسجيل الدفعة: للخادم وحده ───────────────────────────────────────
-- 🪤 السطران كلاهما لازم: `REVOKE … FROM PUBLIC` لا يُلغي منحَ `authenticated`
--    المباشر، ولا العكس (درس v14.26).
REVOKE ALL ON FUNCTION public.record_subscription_payment(numeric,integer,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_subscription_payment(numeric,integer,integer,text) FROM anon;
REVOKE ALL ON FUNCTION public.record_subscription_payment(numeric,integer,integer,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_subscription_payment(numeric,integer,integer,text) TO service_role;

-- ٣) الحارسُ البنيويّ: لا دفعةَ «مدفوعة» بمالٍ لم يصل ──────────────────────
CREATE OR REPLACE FUNCTION public.tr_guard_fake_sub_payment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- `simulated` تعني حرفياً «لم يمرّ مال». وصفٌّ بمبلغٍ موجب وحالة «مدفوعة»
  -- يدخل الإيرادَ والإقرارَ الضريبيّ ويحرق رقمَ فاتورة — فلا يُقبل بلا مزوّد.
  -- 🪤 ويُسمح بـ`admin_grant` (تحويلٌ بنكيّ قبضه ناصر وسجّله)، وبالمبلغ صفر،
  --    وبحالة `gifted`، وبأيّ مزوّدٍ حقيقيّ (ميسر/تاب/باي‑تابس…).
  IF lower(COALESCE(NEW.status, '')) = 'paid'
     AND COALESCE(NEW.amount, 0) > 0
     AND lower(COALESCE(NEW.gateway_provider, '')) IN ('', 'simulated', 'sim') THEN
    RAISE EXCEPTION 'دفعةُ اشتراكٍ «مدفوعة» بمبلغ % بلا مزوّدٍ حقيقيّ — لا تُسجَّل', NEW.amount
      USING ERRCODE = 'P0030';
  END IF;
  RETURN NEW;
END
$fn$;

-- 🪤 عند الإدراج وحده: صفوفُ الماضي الوهمية قائمةٌ فعلاً، ومشغّلٌ على UPDATE
--    كان سيمنع أيَّ تصحيحٍ إداريٍّ لها لاحقاً.
DROP TRIGGER IF EXISTS tr_guard_fake_sub_payment ON public.subscription_payments;
CREATE TRIGGER tr_guard_fake_sub_payment
  BEFORE INSERT ON public.subscription_payments
  FOR EACH ROW EXECUTE FUNCTION public.tr_guard_fake_sub_payment();

-- ٤) تحقّقٌ سلوكيّ يُفشل الهجرة إن كذبت ──────────────────────────────────────
BEGIN;
DO $test$
DECLARE v_sid text; v_err text; v_hit boolean; v_n int;
  -- جسمُ الدالّة بلا تعليقات
BEGIN
  SELECT store_id INTO v_sid FROM public.store_profiles LIMIT 1;
  IF v_sid IS NULL THEN RAISE EXCEPTION '❌ لا متجرَ للاختبار — الفحصُ لم يُجرَ، وهذا فشل'; END IF;

  -- (أ) سالب: دفعةٌ «مدفوعة» بمبلغٍ موجب ومزوّدٍ وهميّ تُرفض بالرمز بعينه
  v_hit := false;
  BEGIN
    INSERT INTO public.subscription_payments (merchant_id, amount, currency, status, payment_method, gateway_provider)
    VALUES (v_sid, 299.99, 'SAR', 'paid', 'auto', 'simulated');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_hit := position('بلا مزوّدٍ حقيقيّ' IN v_err) > 0;
    IF NOT v_hit THEN RAISE EXCEPTION '❌ رُفضت لسببٍ آخر: %', v_err; END IF;
  END;
  IF NOT v_hit THEN RAISE EXCEPTION '❌ الحارسُ لم يمنع دفعةً وهمية'; END IF;

  -- (ب) موجب: منحةُ الأدمن (تحويلٌ بنكيّ) تمرّ كما كانت
  INSERT INTO public.subscription_payments (merchant_id, amount, currency, status, payment_method, gateway_provider)
  VALUES (v_sid, 299.99, 'SAR', 'paid', 'admin_grant', 'admin_grant');
  -- (ج) موجب: هديّةٌ بصفر تمرّ
  INSERT INTO public.subscription_payments (merchant_id, amount, currency, status, payment_method, gateway_provider)
  VALUES (v_sid, 0, 'SAR', 'gifted', 'admin_grant', 'admin_grant');
  -- (د) موجب: مزوّدٌ حقيقيّ بمرجع يمرّ
  INSERT INTO public.subscription_payments (merchant_id, amount, currency, status, payment_method, gateway_provider, gateway_reference)
  VALUES (v_sid, 299.99, 'SAR', 'paid', 'web', 'moyasar', 'pay_real_123');

  -- (هـ) الدوالّ الثلاث تحمل ما وُعدت به — **بعد تجريد التعليق**.
  -- 🪤 وهذا ليس تجميلاً: أوّلُ نسخةٍ من هذا الفحص مرّت على كسرتين من أربع،
  --    لأن **تعليقي نفسه** يذكر `_taki_sub_payment_ok` و`taki_is_system_caller`
  --    فيُبرّئ الكودَ المكسور. (الفخّ المسجَّل: حارسٌ يقرأ تعليقَه هو.)
  IF position('_taki_sub_payment_ok' IN regexp_replace(pg_get_functiondef('public.bot_subscribe_plan(bigint,integer,text)'::regprocedure), '--[^' || chr(10) || ']*', '', 'g')) = 0
    THEN RAISE EXCEPTION '❌ bot_subscribe_plan بلا حارس دفع'; END IF;
  IF position('INSERT INTO subscription_payments' IN regexp_replace(pg_get_functiondef('public.bot_subscribe_plan(bigint,integer,text)'::regprocedure), '--[^' || chr(10) || ']*', '', 'g')) > 0
    THEN RAISE EXCEPTION '❌ bot_subscribe_plan ما زالت تكتب دفعةً (تضاعفُ الإيراد)'; END IF;
  IF position('COALESCE(sp.subscription_amount, 0) <= 0' IN regexp_replace(pg_get_functiondef('public.taki_subscription_maintenance()'::regprocedure), '--[^' || chr(10) || ']*', '', 'g')) = 0
    THEN RAISE EXCEPTION '❌ الكرون ما زال يُجدّد الباقات المسعَّرة'; END IF;
  IF position('INSERT INTO subscription_payments' IN regexp_replace(pg_get_functiondef('public.taki_subscription_maintenance()'::regprocedure), '--[^' || chr(10) || ']*', '', 'g')) > 0
    THEN RAISE EXCEPTION '❌ الكرون ما زال يكتب دفعةً'; END IF;
  IF position('taki_is_system_caller' IN regexp_replace(pg_get_functiondef('public.record_subscription_payment(numeric,integer,integer,text)'::regprocedure), '--[^' || chr(10) || ']*', '', 'g')) = 0
    THEN RAISE EXCEPTION '❌ record_subscription_payment بلا حارس نظام'; END IF;

  -- (و) والمنحُ سُحب فعلاً — لا نصّاً
  SELECT count(*) INTO v_n FROM information_schema.role_routine_grants
   WHERE routine_schema='public' AND routine_name='record_subscription_payment'
     AND grantee IN ('authenticated','anon');
  IF v_n <> 0 THEN RAISE EXCEPTION '❌ المنحُ ما زال قائماً لـ% دور', v_n; END IF;

  RAISE NOTICE '✅ مُثبَت: الوهميّة تُرفض · والمنحةُ والهديّةُ والمزوّدُ الحقيقيّ يمرّون · والحرّاسُ الثلاثة مشحونون · والمنحُ مسحوب';
END
$test$;
ROLLBACK;

-- ٥) جدولُ القراءة ─────────────────────────────────────────────────────────
SELECT 'المختبر؟' AS البند, coalesce(obj_description('public'::regnamespace,'pg_namespace'),'لا — جدّة') AS القيمة
UNION ALL SELECT 'حارسُ الدفع في البوتين',
  CASE WHEN position('_taki_sub_payment_ok' IN regexp_replace(pg_get_functiondef('public.bot_subscribe_plan(bigint,integer,text)'::regprocedure), '--[^' || chr(10) || ']*', '', 'g'))>0 THEN '✅' ELSE '❌' END
UNION ALL SELECT 'الكرون لا يُجدّد المسعَّر',
  CASE WHEN position('COALESCE(sp.subscription_amount, 0) <= 0' IN regexp_replace(pg_get_functiondef('public.taki_subscription_maintenance()'::regprocedure), '--[^' || chr(10) || ']*', '', 'g'))>0 THEN '✅' ELSE '❌' END
UNION ALL SELECT 'تسجيلُ الدفعة للخادم وحده',
  (SELECT CASE WHEN count(*)=0 THEN '✅' ELSE '❌ ما زال مفتوحاً' END FROM information_schema.role_routine_grants
    WHERE routine_schema='public' AND routine_name='record_subscription_payment' AND grantee IN ('authenticated','anon'))
UNION ALL SELECT 'المشغّل الحارس',
  CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='tr_guard_fake_sub_payment' AND NOT tgisinternal) THEN '✅' ELSE '❌' END
UNION ALL SELECT '⚠️ صفوفٌ وهميّةٌ قائمة (قرارُ ناصر)',
  (SELECT count(*)::text || ' صفّاً · ' || COALESCE(sum(amount),0)::text || ' ر.س'
     FROM public.subscription_payments
    WHERE status='paid' AND lower(COALESCE(gateway_provider,'')) IN ('','simulated','sim') AND amount > 0);
