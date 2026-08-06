-- ═══════════════════════════════════════════════════════════════════════════
-- v13.67 — ربط عدد المواقع المعروضة بالباقة عند **تغيير الباقة نفسها**
--
-- الثغرة المُثبَتة: المشغّل القائم `tr_branch_display_on_plan_change` معرّف
-- كـ`AFTER UPDATE OF max_branches`، أي لا يعمل إلا إذا ذُكر عمود `max_branches`
-- في جملة التحديث. وتنزيل/ترقية الباقة يجري بتغيير `subscription_package_id`
-- (وبعض الدوال تغيّر الخطة بلا لمس الحدّ إطلاقاً: grant_subscription_bulk،
-- start_trial_for_merchant، ensure_active_subscription، record_subscription_payment)
-- فيبقى الحدّ القديم ويستمر عرض ٢٠ موقعاً على باقةٍ تسمح بواحد. مُثبَت بالاختبار.
--
-- الإصلاح: مشغّل ثانٍ على `subscription_package_id` يشتقّ الحدّ من كتالوج
-- الباقات (platform_settings.location_packages — المصدر الوحيد) ويكتبه في
-- `max_branches`؛ وتلك الكتابة تُطلق المشغّل القائم فتتم المواءمة بآليّته
-- المُختبَرة نفسها. لا تكرار لا نهائياً: الكتابة الداخلية تمسّ `max_branches`
-- وحده فلا تُعيد إطلاق هذا المشغّل.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.tg_branch_cap_on_package_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_pkg_max integer;
BEGIN
  IF NEW.subscription_package_id IS NULL THEN RETURN NEW; END IF;

  SELECT GREATEST(1, (e->>'max')::int) INTO v_pkg_max
    FROM jsonb_array_elements(
           (SELECT value FROM platform_settings WHERE key = 'location_packages')) e
   WHERE NULLIF(e->>'id','') IS NOT NULL
     AND (e->>'id')::int = NEW.subscription_package_id
   LIMIT 1;

  IF v_pkg_max IS NULL THEN RETURN NEW; END IF;

  IF NEW.max_branches IS DISTINCT FROM v_pkg_max THEN
    -- تُطلق `tr_branch_display_on_plan_change` فتُخفي/تُظهر حتى الحدّ الجديد.
    UPDATE public.store_profiles
       SET max_branches = v_pkg_max, updated_at = NOW()
     WHERE store_id = NEW.store_id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tr_branch_cap_on_package_change ON public.store_profiles;
CREATE TRIGGER tr_branch_cap_on_package_change
AFTER UPDATE OF subscription_package_id ON public.store_profiles
FOR EACH ROW
WHEN (NEW.subscription_package_id IS DISTINCT FROM OLD.subscription_package_id)
EXECUTE FUNCTION public.tg_branch_cap_on_package_change();
