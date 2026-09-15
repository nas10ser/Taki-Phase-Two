-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.45 — نواقص إعداد المتجر: تذكيرٌ يلاحق، لا إلزامٌ يمنع (طلب ناصر ٢)
-- ════════════════════════════════════════════════════════════════════════════
-- المقيس على جدة (١٥ سبتمبر ٢٠٢٦):
--   • ثلاثة متاجر من ثلاثة بلا `refund_policy` ⇒ صفحة كل عرضٍ لها تقول
--     للمشتري صراحةً «لم يُعلن هذا المتجر سياسة استرداد» قبل زرّ الحجز.
--   • متجر «الاناقة» بلا `payment_declared_at` ⇒ `store_can_sell` ترفض،
--     فعروضه تبقى مسوّدات ولا يعرف هو لماذا.
--
-- وقرار ناصر قائم: **لا إلزام**. فالعلاج أن يكون التركُ مكلفاً وواضحاً:
--   ١) `merchant_setup_gaps()` — مصدرٌ واحد يقول ما ينقص هذا المتجر. تقرؤه
--      اللافتة في لوحة التاجر والتذكير الأسبوعي معاً، فلا تفترقان أبداً.
--   ٢) تذكير أسبوعي (أحد ٩ صباحاً بتوقيت الرياض) يسمّي الناقص بالاسم، وبفترة
--      تهدئة سبعة أيام فلا يتحوّل إلى إزعاج.
--   ٣) اللافتة في اللوحة **لا تُغلَق** — تختفي وحدها حين يُكمل، لا قبل.
--
-- 🪤 التمييز مقصود: نقصُ سياسة الاسترداد لا يُذكَّر به متجرٌ بلا عروض أصلاً
--    (لا مشترٍ يراه بعد)، أمّا إقرار طريقة الحساب فيُذكَّر به دائماً لأنه هو
--    نفسه ما يمنع النشر.
--
-- الخادم المستهدف: **جدة (الإنتاج)**. يرفض التنفيذ على مختبر طوكيو.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'TOKYO_LAB_REFUSED: هذه هجرة إنتاج. نفّذها على جدة.';
  END IF;
END
$guard$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١) مصدر واحد لِما ينقص المتجر
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.merchant_setup_gaps(p_store_id text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'store_id',              u.id,
    -- سياسة استرداد غائبة، ولها عروضٌ يراها مشترٍ
    'refund_policy_missing', (NULLIF(btrim(COALESCE(sp.refund_policy, '')), '') IS NULL
                              AND EXISTS (SELECT 1 FROM public.deals d WHERE d.store_id = u.id)),
    -- طريقة الحساب لم تُقرّ ⇒ `store_can_sell` ترفض والعروض تبقى مسوّدات
    'payment_undeclared',    (sp.payment_declared_at IS NULL),
    'deals_total',           (SELECT count(*) FROM public.deals d WHERE d.store_id = u.id),
    'deals_live',            (SELECT count(*) FROM public.deals d WHERE d.store_id = u.id AND d.status = 'active')
  )
  FROM public.users u
  LEFT JOIN public.store_profiles sp ON sp.store_id = u.id
  WHERE u.id = p_store_id AND u.deleted_at IS NULL;
$function$;
COMMENT ON FUNCTION public.merchant_setup_gaps(text) IS
  'v14.45 — ما ينقص إعداد المتجر. تقرؤه لافتة اللوحة والتذكير الأسبوعي معاً.';

REVOKE ALL ON FUNCTION public.merchant_setup_gaps(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_setup_gaps(text) FROM anon;
REVOKE ALL ON FUNCTION public.merchant_setup_gaps(text) FROM authenticated;

-- ما يناديه التاجر عن نفسه وحده — لا يكشف حال متجرٍ آخر
CREATE OR REPLACE FUNCTION public.my_setup_gaps()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_uid text := auth.uid()::text; v_type text; v_shop text;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT u.user_type, u.shop INTO v_type, v_shop FROM public.users u WHERE u.id = v_uid AND u.deleted_at IS NULL;
  IF v_type IS NULL THEN RETURN NULL; END IF;
  IF v_type NOT IN ('seller','admin') AND NULLIF(btrim(COALESCE(v_shop,'')), '') IS NULL THEN RETURN NULL; END IF;
  RETURN public.merchant_setup_gaps(v_uid);
END $function$;

REVOKE ALL ON FUNCTION public.my_setup_gaps() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_setup_gaps() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_setup_gaps() TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ٢) التذكير الأسبوعي — يسمّي الناقص، ولا يتكرّر قبل سبعة أيام
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.taki_merchant_setup_reminders()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  r          record;
  v_gaps     jsonb;
  v_refund   boolean;
  v_paydecl  boolean;
  v_ar       text;
  v_en       text;
  v_sent     integer := 0;
BEGIN
  FOR r IN
    SELECT u.id
    FROM public.users u
    WHERE u.deleted_at IS NULL
      AND COALESCE(u.is_suspended, false) = false
      AND (u.user_type IN ('seller','admin') OR NULLIF(btrim(COALESCE(u.shop,'')), '') IS NOT NULL)
  LOOP
    v_gaps    := public.merchant_setup_gaps(r.id);
    v_refund  := COALESCE((v_gaps->>'refund_policy_missing')::boolean, false);
    v_paydecl := COALESCE((v_gaps->>'payment_undeclared')::boolean, false);
    CONTINUE WHEN NOT (v_refund OR v_paydecl);

    -- فترة التهدئة: أسبوع كامل بين تذكيرين لنفس المتجر
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = r.id
        AND n.meta_data->>'kind' = 'setup_gap'
        AND n.created_at > now() - interval '7 days'
    );

    v_ar := ''; v_en := '';
    IF v_paydecl THEN
      v_ar := v_ar || '• لم تُقرّ طريقة الحساب بعد — وعروضك تبقى مسوّدات لا يراها أحد حتى تُقرّها.' || E'\n';
      v_en := v_en || '• You have not declared how you get paid — your deals stay drafts until you do.' || E'\n';
    END IF;
    IF v_refund THEN
      v_ar := v_ar || '• لم تكتب سياسة الاسترداد — وصفحة كل عرضٍ لك تقول للمشتري الآن: «لم يُعلن هذا المتجر سياسة استرداد».' || E'\n';
      v_en := v_en || '• No refund policy yet — every one of your deal pages currently tells buyers: “this store has not published a refund policy”.' || E'\n';
    END IF;
    v_ar := v_ar || E'\nتُكمل ذلك من: لوحة التاجر ← تبويب «إضافة عرض» ← البطاقات في أعلى الصفحة.';
    v_en := v_en || E'\nFinish it in: Seller dashboard → “Add deal” tab → the cards at the top.';

    INSERT INTO public.notifications (id, user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
    VALUES ('ntf_gap_' || (extract(epoch from clock_timestamp())*1000)::bigint || '_' || substr(md5(random()::text), 1, 6),
            r.id,
            '📋 نواقص في إعداد متجرك', 'Your store setup is incomplete',
            v_ar, v_en, 'system',
            jsonb_build_object('audience', 'seller', 'kind', 'setup_gap',
                               'refund_policy_missing', v_refund,
                               'payment_undeclared', v_paydecl));
    v_sent := v_sent + 1;
  END LOOP;
  RETURN v_sent;
END $function$;

REVOKE ALL ON FUNCTION public.taki_merchant_setup_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_merchant_setup_reminders() FROM anon;
REVOKE ALL ON FUNCTION public.taki_merchant_setup_reminders() FROM authenticated;

-- الأحد ٠٦:٠٠ UTC = ٩ صباحاً بتوقيت الرياض (توقيت القاعدة UTC — قِيس)
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'taki-merchant-setup-reminders';
SELECT cron.schedule('taki-merchant-setup-reminders', '0 6 * * 0',
                     'SELECT public.taki_merchant_setup_reminders();');

-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق
-- ════════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS الفحص,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ مختبر طوكيو'
            ELSE '✅ جدة (الإنتاج)' END AS النتيجة
UNION ALL SELECT 'مصدر النواقص',
       CASE WHEN to_regprocedure('public.merchant_setup_gaps(text)') IS NOT NULL THEN '✅ موجود' ELSE '❌ مفقود' END
UNION ALL SELECT 'ما يناديه التاجر',
       CASE WHEN to_regprocedure('public.my_setup_gaps()') IS NOT NULL THEN '✅ موجود' ELSE '❌ مفقود' END
UNION ALL SELECT 'التذكير الأسبوعي مجدول',
       CASE WHEN EXISTS (SELECT 1 FROM cron.job WHERE jobname='taki-merchant-setup-reminders' AND schedule='0 6 * * 0')
            THEN '✅ الأحد ٩ص الرياض' ELSE '❌ غير مجدول' END
UNION ALL SELECT 'لا يقرؤه زائر',
       CASE WHEN NOT has_function_privilege('anon', 'public.my_setup_gaps()', 'EXECUTE')
             AND NOT has_function_privilege('anon', 'public.merchant_setup_gaps(text)', 'EXECUTE')
            THEN '✅ مغلق' ELSE '❌ مكشوف' END;

-- ما ينقص كل متجر اليوم
SELECT COALESCE(NULLIF(u.shop,''), u.name) AS المتجر,
       (public.merchant_setup_gaps(u.id)->>'payment_undeclared')::boolean    AS طريقة_الحساب_ناقصة,
       (public.merchant_setup_gaps(u.id)->>'refund_policy_missing')::boolean AS سياسة_الاسترداد_ناقصة,
       (public.merchant_setup_gaps(u.id)->>'deals_total')::int               AS عروضه
FROM public.users u
WHERE u.deleted_at IS NULL
  AND (u.user_type IN ('seller','admin') OR NULLIF(btrim(COALESCE(u.shop,'')), '') IS NOT NULL)
ORDER BY 1;
