-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.33 — الحملات تصل من تقصدهم · البلاغات لا تُبتَر · الشكوى تُسمَع
-- ════════════════════════════════════════════════════════════════════════════
-- (طلب ناصر ٥، وجزءٌ من ٤)
--
-- ثلاثة عيوب مقيسة:
--
-- ١. **حملةٌ لمدينة واحدة تصل المملكة كلها.** نموذج الحملة فيه «مدينة» و«منطقة»
--    ويُحفظان في `target_city`/`target_region`، و`_broadcast_campaign_core`
--    **لا يقرؤهما إطلاقاً**: الفلترة على `target_audience` وحدها. فحملةُ ناصر
--    للرياض تُشعر كل مشترٍ وتاجر في السعودية، وتستهلك سقف الظهور، وتُسجَّل
--    انطباعاتٍ لمن لا تعنيهم.
--    🪤 و`users` **بلا عمود مدينة** أصلاً (قِيس). المتاح: إحداثيات المستخدم
--    (٣ من ٦ اليوم) وتاريخ حجوزاته. فنستنتج المدينة منهما معاً، ونُظهر لناصر
--    **عدد من ستصلهم قبل الإرسال** — فالاستهداف الذي يُقصي نصف الناس يجب أن
--    يكون مرئياً لا صامتاً.
--
-- ٢. **الحملة تصل المحذوفين والموقوفين.** لا شرط `deleted_at` ولا `is_suspended`.
--
-- ٣. **زرّ الحملة في البوتين لا يظهر أبداً.** القاعدة تكتب `actionUrl` بالسنام
--    (camelCase) والبوت يقرأ `action_url` بالشرطة السفلية — مفتاحان لا يلتقيان.
--    نكتب الاثنين، فتعمل الصفوف الجديدة والقديمة معاً.
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

-- ── ١. هل يقع هذا المستخدم داخل استهداف الحملة؟ ─────────────────────────────
-- المدينة تُستنتج من مصدرين، أيّهما أصاب كفى:
--   (أ) أقرب مدينة لإحداثياته المحفوظة (المتتبّع يكتبها وهو يتنقّل)
--   (ب) مدينة أي متجرٍ حجز منه سابقاً
-- ومن لا يملك أيّاً منهما لا يُستهدَف — وهذا صحيح، لكنه يجب أن يكون معلوماً،
-- ولذلك `admin_campaign_audience` أدناه.
CREATE OR REPLACE FUNCTION public.taki_user_in_campaign(
  p_uid text, p_city text, p_region text
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_city text := NULLIF(btrim(COALESCE(p_city, '')), '');
  v_reg  text := NULLIF(btrim(COALESCE(p_region, '')), '');
  v_lat double precision; v_lng double precision;
  v_near text; v_near_reg text;
BEGIN
  IF v_city IS NULL AND v_reg IS NULL THEN RETURN true; END IF;   -- بلا استهداف = الجميع

  -- (ب) سابقة الحجز — أرخص وأدقّ من الإحداثيات، فنبدأ بها.
  IF EXISTS (
    SELECT 1 FROM public.bookings b JOIN public.deals d ON d.id = b.deal_id
    WHERE b.user_id = p_uid
      AND (v_city IS NULL OR d.city   = v_city)
      AND (v_reg  IS NULL OR d.region = v_reg)
  ) THEN RETURN true; END IF;

  -- وللتاجر: مدينة عروضه هو.
  IF EXISTS (
    SELECT 1 FROM public.deals d
    WHERE d.store_id = p_uid
      AND (v_city IS NULL OR d.city   = v_city)
      AND (v_reg  IS NULL OR d.region = v_reg)
  ) THEN RETURN true; END IF;

  -- (أ) أقرب مدينة لإحداثياته.
  SELECT lat, lng INTO v_lat, v_lng FROM public.users WHERE id = p_uid;
  IF v_lat IS NULL OR v_lng IS NULL THEN RETURN false; END IF;
  SELECT g.city_id, g.region_id INTO v_near, v_near_reg
  FROM public.sa_cities_geo g
  ORDER BY ((g.lat - v_lat) ^ 2 + (g.lng - v_lng) ^ 2) ASC
  LIMIT 1;
  RETURN (v_city IS NULL OR v_near = v_city) AND (v_reg IS NULL OR v_near_reg = v_reg);
END $$;
REVOKE ALL ON FUNCTION public.taki_user_in_campaign(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_user_in_campaign(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_user_in_campaign(text, text, text) TO authenticated;

-- ── ٢. البثّ: يستهدف فعلاً، ويتجنّب المحذوف والموقوف، ويكتب المفتاحين ───────
CREATE OR REPLACE FUNCTION public._broadcast_campaign_core(
  p_campaign_id text, p_force boolean DEFAULT false
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE camp RECORD; affected INTEGER := 0;
BEGIN
  SELECT * INTO camp FROM public.promotional_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campaign % not found', p_campaign_id; END IF;

  IF p_force THEN
    DELETE FROM public.promo_impressions WHERE campaign_id = camp.id;
  END IF;

  INSERT INTO public.notifications (
    user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
  SELECT u.id, camp.title_ar, camp.title_en, camp.body_ar, camp.body_en, 'marketing',
    jsonb_build_object(
      'campaignId',    camp.id,
      'imageUrl',      camp.image_url,
      'actionUrl',     camp.action_url,
      'actionLabelAr', camp.action_label_ar,
      'actionLabelEn', camp.action_label_en,
      -- 🪤 البوتان يقرآن الشرطة السفلية. مفتاحٌ واحد بالسنام كان يعني أن زرّ
      -- الحملة لا يظهر في تيليجرام ولا واتساب أبداً، وناصر يملأ «رابط عند
      -- الضغط» ولا يجد أحدٌ ما يضغطه.
      'action_url',    camp.action_url,
      'image_url',     camp.image_url,
      'action_label_ar', camp.action_label_ar,
      'action_label_en', camp.action_label_en),
    NOW()
  FROM public.users u
  WHERE (camp.target_audience = 'all' OR u.user_type = camp.target_audience)
    AND u.deleted_at IS NULL
    AND COALESCE(u.is_suspended, false) = false
    AND public.taki_user_in_campaign(u.id, camp.target_city, camp.target_region)
    AND NOT EXISTS (SELECT 1 FROM public.promo_impressions p
                    WHERE p.campaign_id = camp.id AND p.user_id = u.id);

  GET DIAGNOSTICS affected = ROW_COUNT;

  INSERT INTO public.promo_impressions (campaign_id, user_id, seen_at, clicked)
  SELECT camp.id, u.id, NOW(), FALSE
  FROM public.users u
  WHERE (camp.target_audience = 'all' OR u.user_type = camp.target_audience)
    AND u.deleted_at IS NULL
    AND COALESCE(u.is_suspended, false) = false
    AND public.taki_user_in_campaign(u.id, camp.target_city, camp.target_region)
  ON CONFLICT (campaign_id, user_id) DO NOTHING;

  UPDATE public.promotional_campaigns
     SET current_impressions = COALESCE(current_impressions, 0) + affected,
         last_broadcast_at = NOW()
   WHERE id = camp.id;

  RETURN affected;
END $$;

-- ── ٣. كم شخصاً ستصل هذه الحملة؟ ────────────────────────────────────────────
-- يُعرض قبل الإرسال: استهدافٌ يُقصي نصف الناس صامتاً أسوأ من استهدافٍ معلن.
CREATE OR REPLACE FUNCTION public.admin_campaign_audience(p_campaign_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE camp RECORD; v_all int; v_hit int; v_new int;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;
  SELECT * INTO camp FROM public.promotional_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;

  SELECT count(*) INTO v_all FROM public.users u
  WHERE (camp.target_audience = 'all' OR u.user_type = camp.target_audience)
    AND u.deleted_at IS NULL AND COALESCE(u.is_suspended,false) = false;

  SELECT count(*) INTO v_hit FROM public.users u
  WHERE (camp.target_audience = 'all' OR u.user_type = camp.target_audience)
    AND u.deleted_at IS NULL AND COALESCE(u.is_suspended,false) = false
    AND public.taki_user_in_campaign(u.id, camp.target_city, camp.target_region);

  SELECT count(*) INTO v_new FROM public.users u
  WHERE (camp.target_audience = 'all' OR u.user_type = camp.target_audience)
    AND u.deleted_at IS NULL AND COALESCE(u.is_suspended,false) = false
    AND public.taki_user_in_campaign(u.id, camp.target_city, camp.target_region)
    AND NOT EXISTS (SELECT 1 FROM public.promo_impressions p
                    WHERE p.campaign_id = camp.id AND p.user_id = u.id);

  RETURN jsonb_build_object('ok', true, 'eligible', v_all, 'targeted', v_hit,
                            'will_receive', v_new,
                            'targeted_city', camp.target_city, 'targeted_region', camp.target_region);
END $$;
REVOKE ALL ON FUNCTION public.admin_campaign_audience(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_campaign_audience(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_campaign_audience(text) TO authenticated;

-- ── ٤. الشكوى تُسمَع فور وصولها ─────────────────────────────────────────────
-- كان: لا إشعار، ولا بريد، ولا شارة. تُكتشف الشكوى فقط إن فتح ناصر التبويب صدفةً.
CREATE OR REPLACE FUNCTION public.handle_new_complaint()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE a RECORD; v_from text; v_body text;
BEGIN
  SELECT COALESCE(NULLIF(name,''), NULLIF(email,''), 'مستخدم') INTO v_from
  FROM public.users WHERE id = NEW.user_id;
  v_body := COALESCE(v_from, 'مستخدم') || ': ' || left(COALESCE(NEW.message, NEW.subject, ''), 160);

  FOR a IN SELECT id FROM public.users
           WHERE user_type = 'admin' AND deleted_at IS NULL
  LOOP
    INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
    VALUES (a.id, '📮 شكوى جديدة', '📮 New complaint', v_body, v_body, 'system',
            jsonb_build_object('audience','admin', 'complaintId', NEW.id,
                               'actionUrl', '/admin?tab=reports',
                               'action_url', '/admin?tab=reports'));
    -- البريد هو القناة الوحيدة التي تصل ناصر وهو خارج التطبيق وبلا إشعارات مثبَّتة.
    BEGIN
      PERFORM public.taki_queue_email(a.id, 'admin_complaint',
        '📮 شكوى جديدة على تاكي',
        '<div dir="rtl" style="font-family:system-ui"><h2>📮 شكوى جديدة</h2><p>'
        || coalesce(v_body,'') || '</p><p><a href="https://www.takisa.net/admin?tab=reports">فتح لوحة البلاغات</a></p></div>');
    EXCEPTION WHEN others THEN NULL;  -- تعذّر البريد لا يمنع الشكوى من الوصول
    END;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_zz_new_complaint ON public.complaints;
CREATE TRIGGER tr_zz_new_complaint
  AFTER INSERT ON public.complaints
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_complaint();

-- ── ٥. إنفاق المشتري: رقمٌ حقيقي لا عمودٌ ميّت ──────────────────────────────
-- `users.total_spent` معرّف منذ البداية بـDEFAULT 0 **ولا يكتبه أحد في المنصّة
-- كلها** (قِيس: صفر لكل الحسابات الستّة). فبطاقة المشتري تقول «٠ ر.س مصروفة»
-- مهما أنفق، ومرشّح «الأكثر إنفاقاً» يرتّب بقيمة ثابتة فلا يرتّب شيئاً.
-- المصدر الصحيح `bookings.total_amount` — الإجمالي المُجمَّد وقت الحجز
-- (١٠٤/١٠٤ حجز يحمله). لا نُحيي العمود الميّت: نحسب حيّاً كما يفعل عدّاد الحجوزات.
CREATE OR REPLACE FUNCTION public.taki_user_spend(p_uid text)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(b.total_amount), 0)::numeric
  FROM public.bookings b
  WHERE b.user_id = p_uid AND b.status = 'completed';
$$;
REVOKE ALL ON FUNCTION public.taki_user_spend(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_user_spend(text) FROM anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق
-- ════════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS الفحص,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ مختبر طوكيو'
            ELSE '✅ جدة (الإنتاج)' END AS النتيجة
UNION ALL SELECT 'الحملة تستهدف المدينة',
       CASE WHEN pg_get_functiondef(to_regprocedure('public._broadcast_campaign_core(text,boolean)'))
                 LIKE '%taki_user_in_campaign%' THEN '✅ نعم' ELSE '❌ لا' END
UNION ALL SELECT 'الحملة تتجنّب المحذوف والموقوف',
       CASE WHEN pg_get_functiondef(to_regprocedure('public._broadcast_campaign_core(text,boolean)'))
                 LIKE '%is_suspended%' THEN '✅ نعم' ELSE '❌ لا' END
UNION ALL SELECT 'زرّ الحملة يصل البوتين',
       CASE WHEN pg_get_functiondef(to_regprocedure('public._broadcast_campaign_core(text,boolean)'))
                 LIKE '%''action_url''%' THEN '✅ المفتاحان' ELSE '❌ بالسنام فقط' END
UNION ALL SELECT 'عدّاد جمهور الحملة',
       CASE WHEN to_regprocedure('public.admin_campaign_audience(text)') IS NOT NULL
            THEN '✅ موجود' ELSE '❌ مفقود' END
UNION ALL SELECT 'تنبيه الشكوى الجديدة',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.complaints'::regclass
                         AND tgname='tr_zz_new_complaint') THEN '✅ موجود' ELSE '❌ مفقود' END
UNION ALL SELECT 'حاسبة الإنفاق الحيّة',
       CASE WHEN to_regprocedure('public.taki_user_spend(text)') IS NOT NULL
            THEN '✅ موجودة' ELSE '❌ مفقودة' END;
