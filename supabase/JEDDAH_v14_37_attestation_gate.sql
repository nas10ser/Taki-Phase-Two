-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.37 — لا نشر قبل الإقرار (طلب ناصر ٩: «نعم التوثيق اولا»)
-- ════════════════════════════════════════════════════════════════════════════
-- إقرار طريقة الحساب (`store_profiles.payment_declared_at`) يُفرض **عند الحجز**
-- لا عند النشر. فالتاجر ينشر عروضه، وتظهر في الرئيسية وفي البحث وفي البوتين،
-- ويضغط المشترون «احجز» فيُرفضون واحداً بعد آخر — والتاجر لا يعرف لماذا لا
-- يبيع شيئاً. عرضٌ حيّ لا يُشترى منه، وهو أسوأ من عرضٍ غير منشور.
--
-- قرار ناصر: **التوثيق أولاً.** والعرض يبقى **مسوّدة** لا يُرفض — كي لا يضيع
-- عمل التاجر، وينشر بضغطة واحدة فور إقراره.
--
-- 🪤 لماذا مسوّدة لا استثناء: رفعُ استثناءٍ يُفقد التاجر كل ما كتبه في النموذج
-- (اسم، سعر، صور، مواقع، اختيارات). و`paused` حالةٌ قائمة في القيد أصلاً
-- (`active` · `expired` · `deleted` · `paused`) ولا تظهر في أي واجهة عامة.
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

CREATE OR REPLACE FUNCTION public.taki_guard_publish_needs_declaration()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_sell jsonb; v_msg text;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  -- لا نُزعج عرضاً نشطاً يُحدَّث لسببٍ آخر وهو مقرٌّ أصلاً.
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' THEN RETURN NEW; END IF;

  v_sell := public.store_can_sell(NEW.store_id);
  IF COALESCE((v_sell->>'ok')::boolean, false) THEN RETURN NEW; END IF;

  NEW.status := 'paused';

  v_msg := CASE v_sell->>'reason'
    WHEN 'no_method' THEN
      '📝 عرضك «' || COALESCE(NEW.item_name,'') || '» حُفظ مسوّدة. أقررتَ ألّا تقبل الدفع عند الاستلام ولا الدفع الإلكتروني — فلا وسيلة لتحصيل ثمنه. عدّل إقرار طريقة الحساب في لوحة التاجر ثم انشره.'
    ELSE
      '📝 عرضك «' || COALESCE(NEW.item_name,'') || '» حُفظ مسوّدة ولم يُنشر: لم تُقرّ بعد بطريقة حساب متجرك. أكمل «إقرار طريقة الحساب» في لوحة التاجر ثم انشره بضغطة.'
  END;

  INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
  VALUES (NEW.store_id, '📝 عرضك محفوظ مسوّدة', '📝 Your deal is saved as a draft',
          v_msg, v_msg, 'system',
          jsonb_build_object('audience','seller','dealId', NEW.id,
                             'actionUrl','/seller','action_url','/seller'));
  RETURN NEW;
END $$;

-- الاسم يبدأ بـ`tr_ac_` عمداً: المشغّلات تعمل بالترتيب الأبجدي، وهذا يجب أن
-- يقع **بعد** حارس الإيقاف (`tr_ab_guard_suspended_publish`) — فالموقوف يُرفض
-- نشرُه رفضاً، ولا يُحوَّل عرضُه إلى مسوّدة كأنه ينقصه إقرار.
DROP TRIGGER IF EXISTS tr_ac_publish_needs_declaration ON public.deals;
CREATE TRIGGER tr_ac_publish_needs_declaration
  BEFORE INSERT OR UPDATE OF status ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.taki_guard_publish_needs_declaration();

-- ── إشعارٌ فور النشر الناجح (طلب ناصر: «وتنبيهه فور النشر») ─────────────────
CREATE OR REPLACE FUNCTION public.taki_notify_deal_published()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_msg text;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' THEN RETURN NEW; END IF;
  v_msg := '✅ نُشر عرضك «' || COALESCE(NEW.item_name,'') || '» وصار ظاهراً للمشترين في الرئيسية والبحث وفي البوتين.';
  INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
  VALUES (NEW.store_id, '✅ نُشر عرضك', '✅ Your deal is live', v_msg, v_msg, 'deal',
          jsonb_build_object('audience','seller','dealId', NEW.id,
                             'actionUrl','/deal/' || NEW.id, 'action_url','/deal/' || NEW.id));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_zy_notify_deal_published ON public.deals;
CREATE TRIGGER tr_zy_notify_deal_published
  AFTER INSERT OR UPDATE OF status ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.taki_notify_deal_published();

-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق
-- ════════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS الفحص,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ مختبر طوكيو'
            ELSE '✅ جدة (الإنتاج)' END AS النتيجة
UNION ALL SELECT 'حارس النشر بلا إقرار',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.deals'::regclass
                         AND tgname='tr_ac_publish_needs_declaration') THEN '✅ مشغّل' ELSE '❌ مفقود' END
UNION ALL SELECT 'إشعار النشر',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.deals'::regclass
                         AND tgname='tr_zy_notify_deal_published') THEN '✅ مشغّل' ELSE '❌ مفقود' END
UNION ALL SELECT 'ترتيب المشغّلات صحيح',
       CASE WHEN (SELECT string_agg(tgname, ' < ' ORDER BY tgname) FROM pg_trigger
                  WHERE tgrelid='public.deals'::regclass AND NOT tgisinternal
                    AND tgname IN ('tr_ab_guard_suspended_publish','tr_ac_publish_needs_declaration'))
                 = 'tr_ab_guard_suspended_publish < tr_ac_publish_needs_declaration'
            THEN '✅ الإيقاف قبل الإقرار' ELSE '❌ الترتيب مقلوب' END
UNION ALL SELECT 'متاجر لم تُقرّ بعد',
       (SELECT count(*)::text FROM users u WHERE u.user_type IN ('seller','admin')
          AND NOT COALESCE((public.store_can_sell(u.id)->>'ok')::boolean,false));
